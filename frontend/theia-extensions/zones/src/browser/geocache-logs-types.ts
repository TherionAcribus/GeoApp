/**
 * Formes de données des logs telles que le backend les renvoie, et budget de
 * l'analyse IA.
 *
 * Extraites du widget parce que l'analyse IA les lit aussi : elle récupère les
 * logs stockés par ses propres moyens (tous, pas seulement la page affichée) et
 * n'a aucune raison de dépendre du widget pour connaître leur forme.
 *
 * Ce module ne dépend ni de React ni de Theia : c'est ce qui permet au module de
 * prompt, qui lit ces constantes, de rester testable tel quel.
 */

/**
 * Plafond de logs soumis au modèle.
 *
 * Au-delà, le prompt grossit sans rien apprendre : les logs d'une géocache très
 * fréquentée se répètent, et les plus anciens parlent d'un état de la cache qui
 * n'existe plus. Les logs retenus sont les plus récents.
 */
export const LOGS_ANALYSIS_MAX_LOGS = 100;

/**
 * Longueur maximale du texte d'un log transmis au modèle.
 *
 * Quelques logs-fleuves (récits de randonnée, listes de remerciements) suffisent
 * à doubler la taille du prompt. Couper à cette longueur garde l'information
 * utile — les indices et les avertissements arrivent tôt dans un log — tout en
 * bornant le coût.
 */
export const LOGS_ANALYSIS_MAX_TEXT_LENGTH = 1500;

/** Un log de géocache, tel que `GET /api/geocaches/<id>/logs` le renvoie. */
export interface GeocacheLogDto {
    id: number;
    external_id: string;
    author: string;
    author_guid?: string;
    text: string;
    date: string | null;
    log_type: string;
    is_favorite: boolean;
    is_friend_log?: boolean;
    /** Log écrit avec le compte connecté (`sp=true` côté backend, ou soumission locale). */
    is_own_log?: boolean;
    created_at: string | null;
}

/** Réponse de `GET /api/geocaches/<id>/logs`. */
export interface LogsApiResponse {
    geocache_id: number;
    gc_code: string;
    /** Nombre de logs stockés localement. */
    total_count: number;
    /** Nombre de logs sur Geocaching.com, `null` tant qu'on ne l'a pas appris. */
    total_available?: number | null;
    friends_count?: number;
    offset: number;
    limit: number;
    logs: GeocacheLogDto[];
}
