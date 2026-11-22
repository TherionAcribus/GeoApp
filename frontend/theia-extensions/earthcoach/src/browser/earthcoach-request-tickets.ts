import { EarthCoachPreparedRequest } from './earthcoach-workspace-types';
import { LoggingTask } from './earthcoach-types';

/**
 * Ce qu'il faut pour capturer une reponse sans l'instantane complet du
 * dossier : celui-ci ne vit qu'en memoire (listing HTML, observations) et se
 * perd au redemarrage ou quand la Map le chasse. Le ticket, leger, est copie
 * dans le stockage local.
 */
export interface EarthCoachRequestTicket {
    requestId: string;
    geocacheId: number;
    action: 'analyze' | 'resolve';
    /** Consignes photo de l'instantane : elles ne recoivent jamais de proposition. */
    photoTaskIds: string[];
    /** Reprise ciblee : resultat et proposition a remplacer. */
    refine?: { resultId: number; proposalIndex?: number };
    /** Generation de reponse finale : resultat source. */
    finalResultId?: number;
    /** Le modele a pose des questions de precision (earthcoach_ask_user). */
    awaitingInput?: boolean;
    createdAt: number;
}

type TicketStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export const EARTHCOACH_REQUEST_TICKETS_KEY = 'geoapp.earthcoach.requestTickets';
const MAX_TICKETS = 50;
const TICKET_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Ids numeriques des consignes photo (`logging-task-5` -> `5`). */
export function photoInstructionTaskIds(loggingTasks: LoggingTask[]): string[] {
    return loggingTasks
        .filter(task => task.kind === 'photo')
        .map(task => String(task.id).replace(/^logging-task-/, ''));
}

export function ticketFromPreparedRequest(request: EarthCoachPreparedRequest, now = Date.now()): EarthCoachRequestTicket {
    return {
        requestId: request.requestId,
        geocacheId: request.geocacheId,
        action: request.action === 'resolve' ? 'resolve' : 'analyze',
        photoTaskIds: photoInstructionTaskIds(request.loggingTasks),
        refine: request.refine
            ? { resultId: request.refine.resultId, proposalIndex: request.refine.proposalIndex }
            : undefined,
        awaitingInput: request.awaitingInput?.length ? true : undefined,
        createdAt: now,
    };
}

function defaultStorage(): TicketStorage | undefined {
    try {
        return typeof window !== 'undefined' ? window.localStorage : undefined;
    } catch {
        return undefined;
    }
}

/**
 * Tickets de requete, bornes en nombre et en age. Sans stockage disponible
 * (tests, stockage bloque), ils restent en memoire.
 */
export class EarthCoachRequestTickets {
    protected memory: Record<string, EarthCoachRequestTicket> = {};

    constructor(
        protected readonly storage: TicketStorage | undefined = defaultStorage(),
        protected readonly now: () => number = Date.now
    ) { }

    get(requestId: string | undefined): EarthCoachRequestTicket | undefined {
        return requestId ? this.read()[requestId] : undefined;
    }

    put(ticket: EarthCoachRequestTicket): void {
        const tickets = this.read();
        delete tickets[ticket.requestId];
        tickets[ticket.requestId] = ticket;
        this.write(tickets);
    }

    update(requestId: string, patch: Partial<EarthCoachRequestTicket>): void {
        const tickets = this.read();
        const current = tickets[requestId];
        if (current) {
            tickets[requestId] = { ...current, ...patch };
            this.write(tickets);
        }
    }

    protected read(): Record<string, EarthCoachRequestTicket> {
        let tickets = this.memory;
        if (this.storage) {
            try {
                const raw = this.storage.getItem(EARTHCOACH_REQUEST_TICKETS_KEY);
                tickets = raw ? JSON.parse(raw) as Record<string, EarthCoachRequestTicket> : {};
            } catch {
                tickets = this.memory;
            }
        }
        const oldest = this.now() - TICKET_TTL_MS;
        const fresh: Record<string, EarthCoachRequestTicket> = {};
        for (const [id, ticket] of Object.entries(tickets || {})) {
            if (ticket && typeof ticket.requestId === 'string' && typeof ticket.geocacheId === 'number' && ticket.createdAt >= oldest) {
                fresh[id] = ticket;
            }
        }
        return fresh;
    }

    protected write(tickets: Record<string, EarthCoachRequestTicket>): void {
        // Ordre d'insertion = anciennete : on ne garde que les plus recents.
        const entries = Object.entries(tickets).slice(-MAX_TICKETS);
        const kept = Object.fromEntries(entries);
        this.memory = kept;
        if (!this.storage) {
            return;
        }
        try {
            this.storage.setItem(EARTHCOACH_REQUEST_TICKETS_KEY, JSON.stringify(kept));
        } catch {
            // Stockage plein ou bloque : le ticket reste au moins en memoire.
        }
    }
}
