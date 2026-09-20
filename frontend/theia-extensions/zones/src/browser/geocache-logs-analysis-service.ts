/**
 * Analyse IA des logs d'une géocache : lecture des logs à analyser, et
 * persistance du résultat.
 *
 * Deux problèmes que ce service règle, et qui n'en faisaient qu'un dans le
 * widget :
 *
 * - **le périmètre** : analyser « ce qui est affiché » faisait porter l'analyse
 *   sur la première page de pagination (25 logs), sans le dire. Le modèle
 *   concluait sur un quart des logs d'une cache qui en compte trois cents.
 *   `collectLogsToAnalyze()` va chercher les logs **stockés**, tous, plafond
 *   compris, indépendamment de ce que la liste montre ;
 * - **la persistance** : une analyse coûte un appel de modèle. Elle est donc
 *   enregistrée côté backend (une par géocache) et relue à l'ouverture, avec
 *   les compteurs qui disent sur quoi elle a porté.
 */
import { inject, injectable } from '@theia/core/shared/inversify';
import { BackendApiClient } from './backend-api-client';
import { GeocacheLogDto, LOGS_ANALYSIS_MAX_LOGS, LogsApiResponse } from './geocache-logs-types';

/** Analyse stockée pour une géocache, telle que le backend la renvoie. */
export interface GeocacheLogsAnalysisDto {
    id: number;
    geocache_id: number;
    /** Réponse du modèle, en Markdown. */
    content: string;
    model_id?: string | null;
    /** Nombre de logs effectivement soumis au modèle. */
    analyzed_count?: number | null;
    /** Nombre de logs stockés au moment de l'analyse. */
    stored_count?: number | null;
    /** Nombre de logs sur Geocaching.com au moment de l'analyse. */
    total_available?: number | null;
    created_at?: string | null;
    updated_at?: string | null;
}

/** Ce qu'on envoie au backend pour enregistrer une analyse. */
export interface GeocacheLogsAnalysisInput {
    content: string;
    model_id?: string;
    analyzed_count?: number;
    stored_count?: number;
    total_available?: number;
}

/** Logs à analyser, avec le périmètre qu'ils représentent. */
export interface LogsAnalysisSelection {
    logs: GeocacheLogDto[];
    /** Nombre de logs stockés localement (avant plafonnement). */
    storedCount: number;
    /** Nombre de logs sur Geocaching.com, `undefined` si inconnu. */
    totalAvailable?: number;
}

interface LogsAnalysisApiResponse {
    geocache_id: number;
    gc_code: string;
    analysis: GeocacheLogsAnalysisDto | null;
}

@injectable()
export class GeocacheLogsAnalysisService {

    constructor(
        @inject(BackendApiClient) protected readonly apiClient: BackendApiClient
    ) { }

    /**
     * Récupère les logs sur lesquels l'analyse doit porter.
     *
     * C'est une lecture des logs **stockés** (gratuite, immédiate) : elle ne
     * déclenche aucun appel à Geocaching.com. Si des logs manquent en base,
     * c'est au bandeau « il en reste » du panneau de proposer d'aller les
     * chercher — l'analyse, elle, dit ensuite honnêtement sur combien de logs
     * elle a travaillé.
     */
    async collectLogsToAnalyze(
        geocacheId: number,
        max: number = LOGS_ANALYSIS_MAX_LOGS
    ): Promise<LogsAnalysisSelection> {
        const data = await this.apiClient.requestJson<LogsApiResponse>(
            `/api/geocaches/${geocacheId}/logs?limit=${max}&offset=0`,
            {},
            'Impossible de lire les logs à analyser'
        );

        return {
            logs: data.logs,
            storedCount: data.total_count,
            totalAvailable: data.total_available ?? undefined
        };
    }

    /** Analyse déjà stockée, `undefined` si la géocache n'en a pas encore. */
    async load(geocacheId: number): Promise<GeocacheLogsAnalysisDto | undefined> {
        const data = await this.apiClient.requestJson<LogsAnalysisApiResponse>(
            `/api/geocaches/${geocacheId}/logs/analysis`,
            {},
            "Impossible de lire l'analyse des logs"
        );
        return data.analysis ?? undefined;
    }

    /** Enregistre l'analyse, en remplaçant celle qui existait. */
    async save(geocacheId: number, input: GeocacheLogsAnalysisInput): Promise<GeocacheLogsAnalysisDto> {
        const data = await this.apiClient.requestJson<LogsAnalysisApiResponse>(
            `/api/geocaches/${geocacheId}/logs/analysis`,
            this.apiClient.createJsonInit('PUT', input),
            "Impossible d'enregistrer l'analyse des logs"
        );
        if (!data.analysis) {
            throw new Error("Le backend n'a pas renvoyé l'analyse enregistrée");
        }
        return data.analysis;
    }

    /** Supprime l'analyse stockée. Supprimer ce qui n'existe pas n'est pas une erreur. */
    async clear(geocacheId: number): Promise<void> {
        await this.apiClient.requestVoid(
            `/api/geocaches/${geocacheId}/logs/analysis`,
            this.apiClient.createJsonInit('DELETE'),
            "Impossible de supprimer l'analyse des logs"
        );
    }
}
