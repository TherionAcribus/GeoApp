/**
 * Accès aux plans de sortie enregistrés.
 *
 * Trois consommateurs, trois besoins différents : le panneau lit un plan entier et coche
 * ses lignes, les tables demandent des drapeaux pour un lot de codes, la capture écrit.
 * Ils partagent ce service pour une raison : quand un plan change, tout ce qui l'affiche
 * doit changer avec lui. D'où `onDidChangePlans`, émis à chaque écriture.
 *
 * Le cache des drapeaux évite de redemander la même chose à chaque rendu de table — une
 * table se redessine à chaque tri, à chaque filtre et à chaque sélection. Il est vidé dès
 * qu'un plan est écrit ou supprimé : un badge périmé serait pire qu'un badge absent,
 * puisqu'il prétendrait décrire la dernière analyse.
 */

import { inject, injectable } from '@theia/core/shared/inversify';
import { Emitter, Event } from '@theia/core';
import { BackendApiClient } from './backend-api-client';
import {
    OutingPlanCacheFlags,
    OutingPlanContent,
    OutingPlanRecord,
} from './outing-plan-types';

export interface SaveOutingPlanRequest {
    zoneName: string;
    outingDate: string;
    gcCodes: string[];
    plan: unknown;
    markdown?: string;
    source?: 'tool' | 'parsed' | 'manual';
    modelName?: string;
}

export interface SaveOutingPlanResult {
    plan: OutingPlanRecord;
    /** Coupes appliquées par la normalisation serveur : à afficher, pas à ignorer. */
    warnings: string[];
}

@injectable()
export class OutingPlanService {

    @inject(BackendApiClient)
    protected readonly apiClient!: BackendApiClient;

    protected readonly onDidChangePlansEmitter = new Emitter<void>();

    /** Émis après toute écriture : sauvegarde, coche, suppression. */
    get onDidChangePlans(): Event<void> {
        return this.onDidChangePlansEmitter.event;
    }

    protected flagsCache = new Map<string, OutingPlanCacheFlags>();
    protected flagsMisses = new Set<string>();

    async savePlan(request: SaveOutingPlanRequest): Promise<SaveOutingPlanResult> {
        const result = await this.apiClient.requestJson<SaveOutingPlanResult>(
            '/api/outing-plans',
            this.apiClient.createJsonInit('POST', {
                zone_name: request.zoneName,
                outing_date: request.outingDate,
                gc_codes: request.gcCodes,
                plan: request.plan,
                markdown: request.markdown,
                source: request.source,
                model_name: request.modelName,
            }),
            "Impossible d'enregistrer le plan de sortie"
        );
        this.invalidate();
        return result;
    }

    async listPlans(options: { outingDate?: string; zoneName?: string; limit?: number } = {}):
        Promise<OutingPlanRecord[]> {
        const params = new URLSearchParams();
        if (options.outingDate) {
            params.set('outing_date', options.outingDate);
        }
        if (options.zoneName !== undefined) {
            params.set('zone_name', options.zoneName);
        }
        if (options.limit) {
            params.set('limit', `${options.limit}`);
        }
        const query = params.toString();
        const response = await this.apiClient.requestJson<{ plans: OutingPlanRecord[] }>(
            `/api/outing-plans${query ? `?${query}` : ''}`,
            {},
            'Impossible de charger les plans de sortie'
        );
        return response.plans || [];
    }

    async getPlan(planId: number): Promise<OutingPlanRecord> {
        const response = await this.apiClient.requestJson<{ plan: OutingPlanRecord }>(
            `/api/outing-plans/${planId}`,
            {},
            'Impossible de charger le plan de sortie'
        );
        return response.plan;
    }

    async setChecked(planId: number, checked: string[]): Promise<OutingPlanRecord> {
        const response = await this.apiClient.requestJson<{ plan: OutingPlanRecord }>(
            `/api/outing-plans/${planId}`,
            this.apiClient.createJsonInit('PATCH', { checked }),
            "Impossible d'enregistrer la checklist"
        );
        this.onDidChangePlansEmitter.fire();
        return response.plan;
    }

    /**
     * Attache le rapport rédigé à un plan déjà enregistré.
     *
     * Les deux voies de capture ne portent pas la même chose : le tool transmet la
     * structure mais ignore le texte, que seule la lecture de la réponse fournit. C'est
     * pourtant ce texte qui part à l'export.
     */
    async attachMarkdown(planId: number, markdown: string): Promise<OutingPlanRecord> {
        const response = await this.apiClient.requestJson<{ plan: OutingPlanRecord }>(
            `/api/outing-plans/${planId}`,
            this.apiClient.createJsonInit('PATCH', { markdown }),
            "Impossible d'enregistrer le rapport"
        );
        this.onDidChangePlansEmitter.fire();
        return response.plan;
    }

    async deletePlan(planId: number): Promise<void> {
        await this.apiClient.requestJson(
            `/api/outing-plans/${planId}`,
            this.apiClient.createJsonInit('DELETE'),
            'Impossible de supprimer le plan de sortie'
        );
        this.invalidate();
    }

    /**
     * Drapeaux d'analyse pour un lot de codes GC.
     *
     * Seuls les codes encore inconnus partent au serveur ; les absences déjà constatées
     * sont mémorisées elles aussi, sans quoi une table dont aucune cache n'est couverte
     * par un plan rappellerait le serveur à chaque rendu.
     */
    async fetchFlags(gcCodes: string[]): Promise<Map<string, OutingPlanCacheFlags>> {
        const wanted = Array.from(new Set(
            (gcCodes || []).map(code => (code || '').trim().toUpperCase()).filter(Boolean)
        ));

        const missing = wanted.filter(
            code => !this.flagsCache.has(code) && !this.flagsMisses.has(code)
        );

        if (missing.length > 0) {
            try {
                const response = await this.apiClient.requestJson<{
                    flags: Record<string, OutingPlanCacheFlags>;
                }>(
                    '/api/outing-plans/flags',
                    this.apiClient.createJsonInit('POST', { gc_codes: missing }),
                    'Impossible de charger les drapeaux de sortie'
                );
                const flags = response.flags || {};
                for (const code of missing) {
                    const entry = flags[code];
                    if (entry) {
                        this.flagsCache.set(code, entry);
                    } else {
                        this.flagsMisses.add(code);
                    }
                }
            } catch (error) {
                // Les badges sont un confort : une table qui s'affiche sans eux vaut mieux
                // qu'une table qui ne s'affiche pas. L'échec est tracé, pas propagé.
                console.warn('[OutingPlanService] Drapeaux de sortie indisponibles', error);
                return new Map();
            }
        }

        const result = new Map<string, OutingPlanCacheFlags>();
        for (const code of wanted) {
            const entry = this.flagsCache.get(code);
            if (entry) {
                result.set(code, entry);
            }
        }
        return result;
    }

    /** Vide le cache des drapeaux et prévient les vues. */
    invalidate(): void {
        this.flagsCache.clear();
        this.flagsMisses.clear();
        this.onDidChangePlansEmitter.fire();
    }
}

/** Vrai quand un contenu de plan est exploitable : version connue et au moins une section. */
export function isUsableOutingPlan(plan: OutingPlanContent | undefined): boolean {
    if (!plan || typeof plan !== 'object') {
        return false;
    }
    return (plan.checklist?.length || 0) > 0
        || (plan.alerts?.length || 0) > 0
        || (plan.per_cache?.length || 0) > 0;
}
