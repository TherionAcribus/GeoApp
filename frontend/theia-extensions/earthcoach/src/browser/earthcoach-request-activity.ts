import { Emitter, Event } from '@theia/core';
import { injectable } from '@theia/core/shared/inversify';

/** Ce qu'EarthCoach est en train de faire pour le dossier. */
export type EarthCoachActivityKind = 'analyze' | 'resolve' | 'refine' | 'final' | 'log';

export interface EarthCoachActivity {
    requestId: string;
    geocacheId: number;
    kind: EarthCoachActivityKind;
    /** Precision affichee, ex. « Q3 » pour une reprise ciblee. */
    label?: string;
    /** Conversation qui porte la requete, connue une fois la requete partie. */
    sessionId?: string;
    /** `awaiting_input` : le modele a pose des questions dans le chat. */
    phase: 'running' | 'awaiting_input';
    startedAt: number;
}

/**
 * Requetes EarthCoach en cours, pour la banniere du dossier. Purement en
 * memoire : une reponse de chat ne survit pas a un redemarrage non plus.
 *
 * Cycle : `start` au dispatch, `attachSession` quand le bridge a envoye la
 * requete, `markAwaitingInput` / `resume` autour d'un tour de precision, puis
 * `settle` a la fin de la reponse — qui garde une requete en attente de
 * precisions, puisque la conversation continue.
 */
@injectable()
export class EarthCoachRequestActivity {
    protected readonly activities = new Map<string, EarthCoachActivity>();
    protected readonly changedEmitter = new Emitter<void>();

    get onDidChange(): Event<void> {
        return this.changedEmitter.event;
    }

    start(activity: Omit<EarthCoachActivity, 'phase' | 'startedAt'> & { startedAt?: number }): void {
        // Relancer depuis le dossier, c'est renoncer a repondre aux questions
        // en suspens : leur banniere n'a plus lieu d'etre.
        for (const [requestId, existing] of this.activities) {
            if (existing.geocacheId === activity.geocacheId && existing.phase === 'awaiting_input') {
                this.activities.delete(requestId);
            }
        }
        this.activities.set(activity.requestId, {
            ...activity,
            phase: 'running',
            startedAt: activity.startedAt ?? Date.now(),
        });
        this.changedEmitter.fire();
    }

    has(requestId: string | undefined): boolean {
        return requestId !== undefined && this.activities.has(requestId);
    }

    attachSession(requestId: string, sessionId: string | undefined): void {
        this.patch(requestId, { sessionId });
    }

    markAwaitingInput(requestId: string, sessionId?: string): void {
        this.patch(requestId, sessionId ? { phase: 'awaiting_input', sessionId } : { phase: 'awaiting_input' });
    }

    /** L'utilisateur a repondu dans le chat : EarthCoach reprend la main. */
    resume(requestId: string): void {
        this.patch(requestId, { phase: 'running' });
    }

    /** Fin d'une reponse : la requete s'arrete, sauf si elle attend des precisions. */
    settle(requestId: string | undefined): void {
        const activity = requestId ? this.activities.get(requestId) : undefined;
        if (activity && activity.phase === 'running') {
            this.activities.delete(activity.requestId);
            this.changedEmitter.fire();
        }
    }

    dismiss(requestId: string): void {
        if (this.activities.delete(requestId)) {
            this.changedEmitter.fire();
        }
    }

    /** Requetes de cette geocache, la plus recente d'abord. */
    forGeocache(geocacheId: number): EarthCoachActivity[] {
        return [...this.activities.values()]
            .filter(activity => activity.geocacheId === geocacheId)
            .sort((left, right) => right.startedAt - left.startedAt);
    }

    protected patch(requestId: string, patch: Partial<EarthCoachActivity>): void {
        const activity = this.activities.get(requestId);
        if (!activity) {
            return;
        }
        this.activities.set(requestId, { ...activity, ...patch });
        this.changedEmitter.fire();
    }
}
