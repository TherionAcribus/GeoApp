/**
 * Gestionnaire de sessions sauvegardées pour le Formula Solver.
 * Utilise le localStorage pour persister les sessions entre les ouvertures.
 */

import { Formula, Question, LetterValue, CalculationResult } from '../common/types';
import { AnswerDetail } from './strategies/types';

export interface FormulaSession {
    geocacheId: number;
    gcCode: string;
    geocacheName?: string;
    savedAt: number;
    currentStep: 'detect' | 'questions' | 'values' | 'calculate';
    text?: string;
    originLat?: number;
    originLon?: number;
    formulas: Formula[];
    selectedFormula?: Formula;
    questions: Question[];
    /** Map<string, LetterValue> sérialisée en tableau de paires */
    values: [string, LetterValue][];
    result?: CalculationResult;
    /** Map<string, AnswerDetail> sérialisée en tableau de paires */
    answerDetails: [string, AnswerDetail][];
    /** Map<string, string> sérialisée en tableau de paires */
    perLetterExtraInfo: [string, string][];
    questionsAiUserHint: string;
    bruteForceResults: Array<{
        id: string;
        label: string;
        values: Record<string, number>;
        coordinates?: any;
    }>;
}

export interface SessionIndex {
    geocacheId: number;
    gcCode: string;
    geocacheName?: string;
    savedAt: number;
}

const SESSIONS_INDEX_KEY = 'geoapp:formula-solver:sessions-index';
const SESSION_PREFIX = 'geoapp:formula-solver:session:';
/** Chaque session embarque le texte du listing : on borne leur nombre. */
const MAX_SESSIONS = 30;

export class FormulaSessionManager {

    static listSessions(): SessionIndex[] {
        try {
            const raw = localStorage.getItem(SESSIONS_INDEX_KEY);
            return raw ? JSON.parse(raw) : [];
        } catch {
            return [];
        }
    }

    static hasSavedSession(geocacheId: number): boolean {
        return localStorage.getItem(SESSION_PREFIX + geocacheId) !== null;
    }

    static getSessionMeta(geocacheId: number): SessionIndex | undefined {
        return this.listSessions().find(s => s.geocacheId === geocacheId);
    }

    /**
     * Enregistre une session. Les sessions les plus anciennes au-delà de
     * `MAX_SESSIONS` sont supprimées ; si le stockage est plein, d'autres le
     * sont jusqu'à ce que l'écriture passe.
     *
     * @returns false si la session n'a pas pu être enregistrée
     */
    static saveSession(session: FormulaSession): boolean {
        // Index sans la session en cours, le plus récent en premier
        const others = this.listSessions().filter(s => s.geocacheId !== session.geocacheId);
        const entry: SessionIndex = {
            geocacheId: session.geocacheId,
            gcCode: session.gcCode,
            geocacheName: session.geocacheName,
            savedAt: session.savedAt
        };
        const payload = JSON.stringify(session);

        while (others.length >= MAX_SESSIONS) {
            localStorage.removeItem(SESSION_PREFIX + others.pop()!.geocacheId);
        }

        for (;;) {
            try {
                localStorage.setItem(SESSION_PREFIX + session.geocacheId, payload);
                localStorage.setItem(SESSIONS_INDEX_KEY, JSON.stringify([entry, ...others]));
                return true;
            } catch {
                // Stockage plein : libérer la session la plus ancienne et réessayer
                const oldest = others.pop();
                if (!oldest) {
                    localStorage.removeItem(SESSION_PREFIX + session.geocacheId);
                    return false;
                }
                localStorage.removeItem(SESSION_PREFIX + oldest.geocacheId);
            }
        }
    }

    static loadSession(geocacheId: number): FormulaSession | undefined {
        try {
            const raw = localStorage.getItem(SESSION_PREFIX + geocacheId);
            return raw ? JSON.parse(raw) : undefined;
        } catch {
            return undefined;
        }
    }

    static deleteSession(geocacheId: number): void {
        localStorage.removeItem(SESSION_PREFIX + geocacheId);
        const index = this.listSessions().filter(s => s.geocacheId !== geocacheId);
        localStorage.setItem(SESSIONS_INDEX_KEY, JSON.stringify(index));
    }

    static formatDate(timestamp: number): string {
        return new Date(timestamp).toLocaleDateString('fr-FR', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    }
}
