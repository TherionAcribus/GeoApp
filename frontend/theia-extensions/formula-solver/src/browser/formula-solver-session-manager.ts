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

    static saveSession(session: FormulaSession): void {
        localStorage.setItem(SESSION_PREFIX + session.geocacheId, JSON.stringify(session));
        // Mettre à jour l'index (le plus récent en premier)
        const index = this.listSessions().filter(s => s.geocacheId !== session.geocacheId);
        index.unshift({
            geocacheId: session.geocacheId,
            gcCode: session.gcCode,
            geocacheName: session.geocacheName,
            savedAt: session.savedAt
        });
        localStorage.setItem(SESSIONS_INDEX_KEY, JSON.stringify(index));
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
