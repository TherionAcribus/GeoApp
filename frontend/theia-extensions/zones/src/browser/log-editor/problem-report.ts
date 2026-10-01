/**
 * Signalement d'un problème (Needs Maintenance / Needs Archived) depuis l'éditeur de logs.
 *
 * Comme c:geo : un second log, envoyé après le log principal et seulement s'il a réussi
 * (ou seul, quand la cache est en « Ne pas loguer »), à la même date. Règles pures ici,
 * testées dans `tests/problem-report.test.ts` ; l'orchestration reste dans le widget.
 * Voir documentation/garmin-visites-technique.md.
 */

import {
    GeocacheListItem,
    LogTypeValue,
    ProblemCategory,
    ProblemReport,
    ProblemReportsRecord,
    ProblemSubmitStatus,
} from './types';

export interface ProblemCategoryInfo {
    code: ProblemCategory;
    label: string;
    /** Type de log créé sur Geocaching.com. */
    logTypeLabel: 'Needs Maintenance' | 'Needs Archived';
    /** Texte proposé, modifiable (préférence `geoApp.logs.problemTexts`, puis dans l'éditeur). */
    defaultText: string;
    /** Types de log principal incompatibles (on ne dit pas « disparue » d'une cache trouvée). */
    excludedMainLogTypes: readonly LogTypeValue[];
    /** Faux pour les catégories qui supposent un contenant (carnet, boîte). */
    allowedOnVirtual: boolean;
}

export const PROBLEM_CATEGORIES: readonly ProblemCategoryInfo[] = [
    {
        code: 'needsMaintenance', label: 'Besoin de maintenance', logTypeLabel: 'Needs Maintenance',
        defaultText: 'Cette cache a besoin d\'une intervention de son propriétaire.',
        excludedMainLogTypes: [], allowedOnVirtual: true,
    },
    {
        code: 'logFull', label: 'Carnet plein', logTypeLabel: 'Needs Maintenance',
        defaultText: 'Le carnet de logs est plein.',
        excludedMainLogTypes: ['dnf'], allowedOnVirtual: false,
    },
    {
        code: 'logWet', label: 'Carnet mouillé', logTypeLabel: 'Needs Maintenance',
        defaultText: 'Le carnet de logs est mouillé.',
        excludedMainLogTypes: ['dnf'], allowedOnVirtual: false,
    },
    {
        code: 'damaged', label: 'Contenant abîmé', logTypeLabel: 'Needs Maintenance',
        defaultText: 'Le contenant est abîmé.',
        excludedMainLogTypes: ['dnf'], allowedOnVirtual: false,
    },
    {
        code: 'missing', label: 'Cache peut-être disparue', logTypeLabel: 'Needs Maintenance',
        defaultText: 'La cache a peut-être disparu.',
        excludedMainLogTypes: ['found'], allowedOnVirtual: true,
    },
    {
        code: 'other', label: 'Autre problème', logTypeLabel: 'Needs Maintenance',
        defaultText: 'Il y a un problème avec cette cache.',
        excludedMainLogTypes: [], allowedOnVirtual: true,
    },
    {
        code: 'archive', label: 'Cache à archiver', logTypeLabel: 'Needs Archived',
        defaultText: 'Cette cache devrait être archivée.',
        excludedMainLogTypes: [], allowedOnVirtual: true,
    },
];

const CATEGORY_BY_CODE = new Map(PROBLEM_CATEGORIES.map(c => [c.code, c]));

export function getProblemCategory(code: ProblemCategory): ProblemCategoryInfo {
    return CATEGORY_BY_CODE.get(code) ?? PROBLEM_CATEGORIES[0];
}

export function isProblemCategory(value: unknown): value is ProblemCategory {
    return typeof value === 'string' && CATEGORY_BY_CODE.has(value as ProblemCategory);
}

/** Même règle que le backend (`log_problems.is_virtual_cache_type`). */
export function isVirtualCacheType(cacheType: string | undefined): boolean {
    const lowered = (cacheType || '').toLowerCase();
    return ['virtual', 'webcam', 'earthcache', 'earth cache'].some(marker => lowered.includes(marker));
}

/** Raison du refus si la catégorie est incompatible avec le type de log ou la cache, sinon `undefined`. */
export function problemCategoryRefusal(
    code: ProblemCategory,
    mainLogType: LogTypeValue,
    cacheType: string | undefined
): string | undefined {
    const category = getProblemCategory(code);
    if (category.excludedMainLogTypes.includes(mainLogType)) {
        return mainLogType === 'found'
            ? 'Incompatible avec un log « Trouvée »'
            : 'Incompatible avec un log « Non trouvée »';
    }
    if (!category.allowedOnVirtual && isVirtualCacheType(cacheType)) {
        return 'Sans objet pour une cache sans contenant';
    }
    return undefined;
}

/** Texte proposé : celui des préférences s'il est renseigné, sinon le texte par défaut. */
export function defaultProblemText(code: ProblemCategory, overrides?: Record<string, unknown>): string {
    const custom = overrides?.[code];
    return typeof custom === 'string' && custom.trim() ? custom.trim() : getProblemCategory(code).defaultText;
}

/** Un signalement reste à envoyer tant qu'il n'est ni parti, ni peut-être parti. */
export function isProblemPending(
    report: ProblemReport | undefined,
    status: ProblemSubmitStatus | undefined
): boolean {
    return report !== undefined && status !== 'ok' && status !== 'uncertain';
}

export interface ProblemValidationIssue {
    gc: GeocacheListItem;
    message: string;
}

/** Vérifications avant envoi : texte présent, catégorie compatible avec le log principal. */
export function validateProblemReports(
    geocaches: GeocacheListItem[],
    reports: Record<number, ProblemReport>,
    status: Record<number, ProblemSubmitStatus>,
    getLogType: (geocacheId: number) => LogTypeValue
): ProblemValidationIssue[] {
    const issues: ProblemValidationIssue[] = [];
    for (const gc of geocaches) {
        const report = reports[gc.id];
        if (!isProblemPending(report, status[gc.id])) {
            continue;
        }
        if (!report!.text.trim()) {
            issues.push({ gc, message: `${gc.gc_code} : le texte du signalement est vide.` });
            continue;
        }
        const refusal = problemCategoryRefusal(report!.category, getLogType(gc.id), gc.cache_type);
        if (refusal) {
            issues.push({ gc, message: `${gc.gc_code} : « ${getProblemCategory(report!.category).label} » — ${refusal.toLowerCase()}.` });
        }
    }
    return issues;
}

/** Ligne du récapitulatif avant envoi, ou `undefined` s'il n'y a rien à signaler. */
export function describePendingProblems(
    geocaches: GeocacheListItem[],
    reports: Record<number, ProblemReport>,
    status: Record<number, ProblemSubmitStatus>
): string | undefined {
    let maintenance = 0;
    let archive = 0;
    for (const gc of geocaches) {
        const report = reports[gc.id];
        if (!isProblemPending(report, status[gc.id])) {
            continue;
        }
        if (getProblemCategory(report!.category).logTypeLabel === 'Needs Archived') {
            archive += 1;
        } else {
            maintenance += 1;
        }
    }
    const parts: string[] = [];
    if (maintenance > 0) {
        parts.push(`${maintenance} × Needs Maintenance`);
    }
    if (archive > 0) {
        parts.push(`${archive} × Needs Archived`);
    }
    return parts.length > 0
        ? `⚠️ Signalement${maintenance + archive > 1 ? 's' : ''} : ${parts.join(', ')} — public${maintenance + archive > 1 ? 's' : ''}, le propriétaire est prévenu`
        : undefined;
}

/** Ne garde que les signalements des géocaches chargées (brouillon, historique). */
export function sanitizeProblemReports(
    raw: unknown,
    knownIds: ReadonlySet<number>
): ProblemReportsRecord {
    const result: ProblemReportsRecord = { reports: {}, status: {}, references: {} };
    if (!raw || typeof raw !== 'object') {
        return result;
    }
    const source = raw as Partial<ProblemReportsRecord>;
    for (const [key, value] of Object.entries(source.reports ?? {})) {
        const id = Number(key);
        if (knownIds.has(id) && value && isProblemCategory(value.category) && typeof value.text === 'string') {
            result.reports[id] = { category: value.category, text: value.text };
        }
    }
    for (const [key, value] of Object.entries(source.status ?? {})) {
        const id = Number(key);
        if (knownIds.has(id) && (value === 'ok' || value === 'failed' || value === 'uncertain')) {
            result.status[id] = value;
        }
    }
    for (const [key, value] of Object.entries(source.references ?? {})) {
        const id = Number(key);
        if (knownIds.has(id) && typeof value === 'string') {
            result.references[id] = value;
        }
    }
    return result;
}

export interface ProblemSubmitResult {
    status: ProblemSubmitStatus;
    logReferenceCode?: string;
    error?: string;
}

const PROBLEM_SUBMIT_TIMEOUT_MS = 30_000;

/**
 * Envoie un signalement, **en un seul essai** : contrairement au log principal, rien
 * ne garantit qu'un doublon serait refusé par Geocaching.com. Toute issue où le
 * signalement a pu partir sans réponse est `uncertain`.
 */
export async function submitProblemReport(
    backendBaseUrl: string,
    geocacheId: number,
    payload: { category: ProblemCategory; text: string; date: string; mainLogType: LogTypeValue }
): Promise<ProblemSubmitResult> {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), PROBLEM_SUBMIT_TIMEOUT_MS);
    try {
        const res = await fetch(`${backendBaseUrl}/api/geocaches/${geocacheId}/logs/report-problem`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
                category: payload.category,
                text: payload.text,
                date: payload.date,
                main_log_type: payload.mainLogType,
            }),
            signal: controller.signal,
        });
        let body: any = undefined;
        try {
            body = await res.json();
        } catch {
            body = undefined;
        }
        if (res.ok && typeof body?.log_reference_code === 'string') {
            return { status: 'ok', logReferenceCode: body.log_reference_code };
        }
        const errorCode = typeof body?.error_code === 'string' ? body.error_code : undefined;
        if (errorCode === 'UNKNOWN_REMOTE_OUTCOME') {
            return { status: 'uncertain', error: 'Réponse perdue : le signalement a peut-être été créé.' };
        }
        const detail = typeof body?.error === 'string' ? ` : ${body.error}` : '';
        return { status: 'failed', error: `Signalement refusé${detail}` };
    } catch {
        // Délai dépassé ou connexion coupée : la requête a pu être traitée sans que
        // la réponse revienne. Dans le doute, on ne renvoie pas.
        return { status: 'uncertain', error: 'Pas de réponse du backend : le signalement a peut-être été créé.' };
    } finally {
        window.clearTimeout(timer);
    }
}

/** Préférence : textes proposés par catégorie (objet `{ code: texte }`). */
export const PROBLEM_TEXTS_PREF = 'geoApp.logs.problemTexts';

/** Bilan des signalements après un envoi, ou `undefined` si aucun n'est parti. */
export function describeProblemOutcome(counts: { ok: number; failed: number; uncertain: number }): string | undefined {
    const parts: string[] = [];
    if (counts.ok > 0) {
        parts.push(`${counts.ok} envoyé${counts.ok > 1 ? 's' : ''}`);
    }
    if (counts.failed > 0) {
        parts.push(`${counts.failed} en échec`);
    }
    if (counts.uncertain > 0) {
        parts.push(`${counts.uncertain} à vérifier sur la page de la cache`);
    }
    return parts.length > 0 ? `Signalements : ${parts.join(', ')}.` : undefined;
}
