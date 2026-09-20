/**
 * Mise en forme des logs d'une géocache pour l'analyse IA.
 *
 * Trois partis pris :
 *
 * - **le périmètre est dit au modèle**, pas seulement à l'utilisateur. Un modèle
 *   qui reçoit cinquante logs sans savoir que la cache en compte trois cents
 *   écrit « les trouveurs signalent tous que… » ; on lui demande donc
 *   explicitement de ne pas conclure à l'exhaustivité ;
 * - **du texte plutôt que du JSON** : `JSON.stringify` d'une liste de logs coûte
 *   des accolades, des guillemets et des échappements à chaque ligne, pour une
 *   information que trois lignes d'en-tête portent aussi bien ;
 * - **le rendu est du Markdown** : le panneau le rend désormais comme tel, donc
 *   autant le demander au modèle.
 *
 * Fonctions pures, sans dépendance Theia : testables telles quelles.
 */

import { GeocacheLogDto, LOGS_ANALYSIS_MAX_TEXT_LENGTH } from './geocache-logs-types';

export interface LogsAnalysisPromptContext {
    /** Hint officiel de la géocache, déjà déchiffré. */
    hint?: string;
    /** Logs à analyser, du plus récent au plus ancien. */
    logs: GeocacheLogDto[];
    /** Nombre de logs stockés localement (avant plafonnement). */
    storedCount: number;
    /** Nombre de logs sur Geocaching.com, `undefined` si inconnu. */
    totalAvailable?: number;
    /** Longueur au-delà de laquelle le texte d'un log est coupé. */
    maxTextLength?: number;
}

/** Date d'un log en format court, pour l'en-tête d'une entrée. */
function formatLogDate(dateStr: string | null): string {
    if (!dateStr) {
        return 'date inconnue';
    }
    try {
        return new Date(dateStr).toLocaleDateString('fr-FR', {
            day: 'numeric', month: 'short', year: 'numeric'
        });
    } catch {
        return dateStr;
    }
}

/**
 * Coupe un log trop long sur une frontière d'espace et le signale.
 *
 * La marque compte : sans elle, un log coupé au milieu d'une phrase peut se lire
 * comme une information incomplète plutôt que tronquée.
 */
export function truncateLogText(text: string, maxLength: number = LOGS_ANALYSIS_MAX_TEXT_LENGTH): string {
    const normalized = (text || '').trim();
    if (normalized.length <= maxLength) {
        return normalized;
    }
    const cut = normalized.slice(0, maxLength);
    const lastSpace = cut.lastIndexOf(' ');
    const kept = lastSpace > maxLength * 0.6 ? cut.slice(0, lastSpace) : cut;
    return `${kept.trimEnd()} […log tronqué]`;
}

/**
 * Phrase qui décrit le périmètre de l'analyse.
 *
 * Elle sert deux fois : dans le prompt (pour que le modèle nuance) et,
 * reformulée, dans l'interface (pour que l'utilisateur sache ce qu'il lit).
 */
export function describeAnalysisScope(
    analyzedCount: number, storedCount: number, totalAvailable?: number
): string {
    const parts = [`${analyzedCount} log${analyzedCount > 1 ? 's' : ''} analysé${analyzedCount > 1 ? 's' : ''}`];
    if (storedCount > analyzedCount) {
        parts.push(`sur ${storedCount} chargés`);
    }
    if (totalAvailable !== undefined && totalAvailable > Math.max(storedCount, analyzedCount)) {
        parts.push(`sur ${totalAvailable} présents sur Geocaching.com`);
    }
    return parts.join(' ');
}

/** Rend un log en trois lignes : en-tête, texte, séparation. */
function formatLog(log: GeocacheLogDto, maxTextLength: number): string {
    const favorite = log.is_favorite ? ' ⭐' : '';
    const header = `[${log.log_type}] ${formatLogDate(log.date)} — ${log.author}${favorite}`;
    const text = truncateLogText(log.text, maxTextLength);
    return text ? `${header}\n${text}` : header;
}

/**
 * Construit le message envoyé au modèle pour l'analyse des logs.
 *
 * Renvoie aussi le nombre de logs réellement inclus : c'est lui qu'on stocke
 * avec l'analyse, et qui permettra d'écrire « faite sur N logs ».
 */
export function buildLogsAnalysisPrompt(
    context: LogsAnalysisPromptContext
): { prompt: string; analyzedCount: number } {
    const maxTextLength = context.maxTextLength ?? LOGS_ANALYSIS_MAX_TEXT_LENGTH;
    const logs = context.logs;
    const scope = describeAnalysisScope(logs.length, context.storedCount, context.totalAvailable);

    const partialWarning = isPartialScope(logs.length, context.storedCount, context.totalAvailable)
        ? "\nCes logs ne sont PAS tous ceux de la cache : ce sont les plus récents. "
            + "Ne présente donc aucune observation comme valable pour l'ensemble des visiteurs, "
            + "et signale-le si une conclusion demanderait des logs plus anciens.\n"
        : '';

    const prompt = `Tu es un assistant pour géocacheurs. Analyse les logs suivants et le hint (indice) d'une géocache.

Ton objectif est d'extraire et de résumer les informations UTILES pour un géocacheur qui veut trouver cette cache :
- Indices ou conseils mentionnés par les trouveurs
- Avertissements (cache difficile d'accès, terrain dangereux, besoin d'équipement spécial, etc.)
- Informations sur l'état de la cache (endommagée, humide, pleine, etc.)
- Conseils pratiques (meilleur moment pour y aller, parking, discrétion, etc.)
- Informations sur la difficulté réelle vs. la difficulté annoncée

NE MENTIONNE PAS :
- Les simples "TFTC" ou remerciements sans information
- Les logs qui ne contiennent aucune information utile
- Les détails personnels des géocacheurs

Réponds en **Markdown** : titres de niveau 2 (\`##\`) par section, listes à puces, gras pour ce
qui mérite l'œil. Sois concis et pertinent, et n'invente rien qui ne soit dans les logs.
Une section sans contenu ne doit pas être écrite du tout.

PÉRIMÈTRE : ${scope}, du plus récent au plus ancien.${partialWarning}
HINT (indice officiel) :
${context.hint?.trim() || 'Aucun hint fourni'}

LOGS :
${logs.map(log => formatLog(log, maxTextLength)).join('\n\n---\n\n')}`;

    return { prompt, analyzedCount: logs.length };
}

/** `true` quand l'analyse ne voit qu'une partie des logs de la géocache. */
export function isPartialScope(
    analyzedCount: number, storedCount: number, totalAvailable?: number
): boolean {
    if (storedCount > analyzedCount) {
        return true;
    }
    return totalAvailable !== undefined && totalAvailable > analyzedCount;
}
