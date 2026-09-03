/**
 * Mise en forme du bundle d'analyse de sortie pour l'IA.
 *
 * Ce module ne produit que des **données** : l'instruction de tâche et le plan du rapport
 * vivent dans le prompt système de l'agent `geoapp-outing-analyzer`. La seule exception
 * est la ligne finale, qui rappelle la commande.
 *
 * Deux partis pris de rédaction :
 *
 * - **une section absente vaut mieux qu'une section vide** : « Hint : aucun » coûte des
 *   tokens et n'apprend rien ;
 * - **les drapeaux non résolus sont écrits en toutes lettres** (`NON RÉSOLU`), parce que
 *   c'est ce marqueur que le prompt système va chercher pour déclencher la recherche de
 *   l'outil précis dans le listing, le hint et les logs.
 *
 * Fonctions pures, sans dépendance Theia : testables telles quelles.
 */

import {
    OutingAnalysisBundle,
    OutingAnalysisGeocache,
    OutingDetailLevel,
    OutingGearSignal,
    OutingHealthLevel,
    OutingLogExcerpt,
} from './outing-analysis-types';

export interface OutingPromptContext {
    zoneName?: string;
    /** Date de la sortie, au format lisible. Par défaut, la date du jour. */
    outingDate?: string;
    detailLevel: OutingDetailLevel;
}

export interface OutingPromptSize {
    chars: number;
    approxTokens: number;
}

/**
 * Ratio caractères/token retenu pour le français, volontairement conservateur :
 * mieux vaut surestimer le coût et avertir un peu trop tôt que laisser partir un
 * prompt qui dépasse la fenêtre du modèle.
 */
const CHARS_PER_TOKEN = 3.6;

const HEALTH_LABELS: Record<OutingHealthLevel, string> = {
    ok: 'saine',
    watch: 'à surveiller',
    risky: 'risquée',
    very_risky: 'très risquée',
    unknown: 'inconnue (aucun log local)',
};

const SOLVED_LABELS: Record<string, string> = {
    solved: 'oui',
    in_progress: 'en cours',
    not_solved: 'non',
};

/** Nombre de logs récents conservés dans le prompt selon le niveau de détail. */
const RECENT_LOGS_IN_PROMPT: Record<OutingDetailLevel, number> = {
    light: 3,
    standard: 5,
    full: 10,
};

function isFilled(value: unknown): boolean {
    return value !== undefined && value !== null && String(value).trim() !== '';
}

function formatDate(iso: string | null | undefined): string {
    if (!isFilled(iso)) {
        return '';
    }
    // Les dates du bundle sont ISO : la partie calendaire suffit, l'heure n'apporte rien.
    return String(iso).slice(0, 10);
}

function formatNumber(value: number | null | undefined): string {
    return value === null || value === undefined ? '?' : String(value);
}

/** Une ligne « - Clé : valeur », omise si la valeur est vide. */
function bullet(label: string, value: unknown): string | undefined {
    return isFilled(value) ? `- ${label} : ${String(value).trim()}` : undefined;
}

function quoteBlock(text: string): string {
    return text
        .split('\n')
        .map(line => `  > ${line.trim()}`)
        .join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// Blocs par géocache
// ─────────────────────────────────────────────────────────────────────────────

function formatIdentityLine(geocache: OutingAnalysisGeocache): string {
    const parts = [
        isFilled(geocache.type) ? `Type : ${geocache.type}` : undefined,
        isFilled(geocache.size) ? `Taille : ${geocache.size}` : undefined,
        `D ${formatNumber(geocache.difficulty)} / T ${formatNumber(geocache.terrain)}`,
        isFilled(geocache.favorites_count) ? `Favoris : ${geocache.favorites_count}` : undefined,
        isFilled(geocache.logs_count) ? `Logs : ${geocache.logs_count}` : undefined,
    ].filter(Boolean);
    return `- ${parts.join(' | ')}`;
}

function formatStatusLine(geocache: OutingAnalysisGeocache): string {
    const solved = SOLVED_LABELS[geocache.solved || ''] || geocache.solved || 'inconnu';
    const coordinates = isFilled(geocache.coordinates)
        ? `${geocache.coordinates}${geocache.is_corrected ? ' (corrigées)' : ' (publiées)'}`
        : 'inconnues';
    return `- Statut : ${geocache.status || 'inconnu'} | Résolue : ${solved} | Coordonnées : ${coordinates}`;
}

function formatHealthLine(geocache: OutingAnalysisGeocache): string {
    const { level, reasons } = geocache.health;
    const label = HEALTH_LABELS[level] || level;
    const detail = reasons.length > 0 ? ` — ${reasons.join(' ; ')}` : '';
    return `- Santé : ${label}${detail}`;
}

/**
 * Ligne des signaux matériel.
 *
 * Le suffixe `(NON RÉSOLU)` n'est pas cosmétique : c'est la consigne au modèle d'aller
 * chercher l'outil précis dans le texte plutôt que de se contenter du drapeau.
 */
function formatGearSignals(signals: OutingGearSignal[]): string | undefined {
    const gear = signals.filter(signal => signal.kind === 'gear');
    if (gear.length === 0) {
        return undefined;
    }
    const rendered = gear.map(signal =>
        signal.resolved ? `${signal.signal} (${signal.label})` : `${signal.signal} (NON RÉSOLU : ${signal.label})`
    );
    return `- Signaux matériel : ${rendered.join(', ')}`;
}

function formatContextSignals(signals: OutingGearSignal[]): string | undefined {
    const context = signals.filter(signal => signal.kind === 'context');
    if (context.length === 0) {
        return undefined;
    }
    return `- Contexte : ${context.map(signal => signal.label).join(', ')}`;
}

function formatAttributes(geocache: OutingAnalysisGeocache): string | undefined {
    if (geocache.attributes.length === 0) {
        return undefined;
    }
    const rendered = geocache.attributes.map(
        attribute => (attribute.is_negative ? `NON ${attribute.label}` : attribute.label)
    );
    return `- Attributs : ${rendered.join(', ')}`;
}

function formatWaypoints(geocache: OutingAnalysisGeocache): string | undefined {
    if (geocache.waypoints_count === 0) {
        return undefined;
    }
    const named = geocache.waypoints
        .map(waypoint => [waypoint.prefix, waypoint.name].filter(isFilled).join(' '))
        .filter(label => label.trim() !== '');
    const detail = named.length > 0 ? ` (${named.join(', ')})` : '';
    return `- Waypoints : ${geocache.waypoints_count}${detail}`;
}

function formatLogLine(log: OutingLogExcerpt, options: { withType?: boolean; withMatched?: boolean }): string {
    const head = [formatDate(log.date), log.author].filter(isFilled).join(', ');
    const type = options.withType && isFilled(log.type) ? ` ${log.type} —` : '';
    const matched = options.withMatched && log.matched && log.matched.length > 0
        ? ` (matériel repéré : ${log.matched.join(', ')})`
        : '';
    return `  > [${head}]${type} « ${log.text_excerpt} »${matched}`;
}

function formatLogSection(
    title: string,
    logs: OutingLogExcerpt[],
    options: { withType?: boolean; withMatched?: boolean } = {}
): string | undefined {
    if (logs.length === 0) {
        return undefined;
    }
    return [`- ${title} :`, ...logs.map(log => formatLogLine(log, options))].join('\n');
}

function formatGeocacheBlock(
    geocache: OutingAnalysisGeocache,
    index: number,
    detailLevel: OutingDetailLevel
): string {
    const listing = geocache.listing_excerpt.trim();
    const showListing = detailLevel !== 'light' && listing !== '';
    const recentLimit = RECENT_LOGS_IN_PROMPT[detailLevel];

    const lines: Array<string | undefined> = [
        `### ${index}. ${geocache.gc_code} — ${geocache.name}`,
        formatIdentityLine(geocache),
        formatStatusLine(geocache),
        geocache.unsolved_mystery
            ? '- ALERTE : mystery non résolue, les coordonnées publiées ne sont pas les bonnes.'
            : undefined,
        formatHealthLine(geocache),
        formatAttributes(geocache),
        formatGearSignals(geocache.gear_signals),
        formatContextSignals(geocache.gear_signals),
        formatWaypoints(geocache),
        bullet('Hint', geocache.hint),
        showListing
            ? `- Listing${geocache.listing_truncated ? ' (extrait tronqué)' : ''} :\n${quoteBlock(listing)}`
            : undefined,
        formatLogSection('Logs mentionnant du matériel', geocache.gear_logs, { withMatched: true }),
        formatLogSection('Logs suggérant une recherche longue', geocache.search_effort_logs),
        formatLogSection('Logs récents', geocache.recent_logs.slice(0, recentLimit), { withType: true }),
    ];

    return lines.filter(Boolean).join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// En-tête
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Section « Fiabilité des données ».
 *
 * Elle passe **avant** les géocaches, pour que le modèle sache ce qu'il ne sait pas
 * avant de lire quoi que ce soit. Sans cette précaution, une cache sans logs se lit
 * comme une cache sans problème.
 */
function formatReliabilitySection(bundle: OutingAnalysisBundle): string | undefined {
    const lines: string[] = [];

    if (bundle.without_local_logs.length > 0) {
        lines.push(
            `- ${bundle.without_local_logs.length} géocache(s) sans logs locaux : `
            + `${bundle.without_local_logs.join(', ')}. Leur santé n'est PAS évaluable et aucune `
            + `information de log n'est disponible pour elles. N'en tire aucune conclusion.`
        );
    }

    if (bundle.stats.unsolved_mysteries > 0) {
        const unsolved = bundle.geocaches
            .filter(geocache => geocache.unsolved_mystery)
            .map(geocache => geocache.gc_code);
        lines.push(
            `- ${bundle.stats.unsolved_mysteries} mystery(s) non résolue(s) : ${unsolved.join(', ')}. `
            + `Sans coordonnées corrigées, s'y déplacer ne sert à rien.`
        );
    }

    if (bundle.stats.unresolved_gear_signals > 0) {
        lines.push(
            `- ${bundle.stats.unresolved_gear_signals} drapeau(x) matériel NON RÉSOLU(S) : `
            + `l'attribut signale un besoin sans dire lequel. Cherche l'objet précis dans le `
            + `listing, le hint et les logs, et dis-le clairement quand tu ne le trouves pas.`
        );
    }

    if (bundle.missing.length > 0) {
        lines.push(
            `- ${bundle.missing.length} géocache(s) demandée(s) mais introuvable(s) en base : `
            + `elles ne figurent pas ci-dessous.`
        );
    }

    if (lines.length === 0) {
        return undefined;
    }

    return ['## Fiabilité des données', ...lines].join('\n');
}

function formatHeader(bundle: OutingAnalysisBundle, context: OutingPromptContext): string {
    const zone = context.zoneName?.trim() || 'sélection';
    const count = bundle.geocaches.length;
    const outingDate = context.outingDate?.trim() || formatDate(bundle.generated_at);

    return [
        `# Analyse de sortie — ${zone} — ${count} géocache(s)`,
        `Date de la sortie : ${outingDate}`,
        `Données extraites le : ${formatDate(bundle.generated_at)}`,
        `Niveau de détail : ${context.detailLevel}`,
    ].join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// API publique
// ─────────────────────────────────────────────────────────────────────────────

export function buildOutingAnalysisPrompt(
    bundle: OutingAnalysisBundle,
    context: OutingPromptContext
): string {
    const sections: Array<string | undefined> = [
        formatHeader(bundle, context),
        formatReliabilitySection(bundle),
    ];

    if (bundle.geocaches.length > 0) {
        sections.push('## Géocaches');
        bundle.geocaches.forEach((geocache, position) => {
            sections.push(formatGeocacheBlock(geocache, position + 1, context.detailLevel));
        });
    } else {
        sections.push('## Géocaches\n\nAucune géocache exploitable dans cette sélection.');
    }

    sections.push('Produis le rapport de préparation de sortie selon ton format.');

    return sections.filter(Boolean).join('\n\n');
}

/**
 * Taille du prompt, pour avertir avant l'envoi.
 *
 * L'estimation de tokens est approximative par construction — chaque modèle a son
 * tokenizer. Elle sert à repérer un ordre de grandeur problématique, pas à décider.
 */
export function estimateOutingPromptSize(prompt: string): OutingPromptSize {
    const chars = prompt.length;
    return { chars, approxTokens: Math.ceil(chars / CHARS_PER_TOKEN) };
}
