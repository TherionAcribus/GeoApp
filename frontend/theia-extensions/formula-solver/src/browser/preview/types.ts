export type Axis = 'north' | 'east';

export type PreviewStatus = 'valid' | 'incomplete' | 'invalid';

export type PreviewIssueLevel = 'info' | 'warn' | 'error';

export interface PreviewIssue {
    level: PreviewIssueLevel;
    code: string;
    message: string;
    axis: Axis;
    segmentId?: 'cardinal' | 'degrees' | 'minutes' | 'decimals';
    suspectLetters?: string[];
}

export interface PreviewDigitSegment {
    id: 'degrees' | 'minutes' | 'decimals';
    rawExpression: string;
    expectedLength: number;
    /**
     * Chaîne affichable (préférence UI): digits + lettres + expressions.
     * Exemple: 'ABC', '(A+B)C', '49'
     */
    displayText: string;
    /** Chaîne numérique interne (digits + '?'), peut dépasser expectedLength si overflow. */
    displayDigits: string;
    /** Vrai si aucun '?' et uniquement des digits. */
    isFullyResolved: boolean;
    /** Ensemble des lettres vues dans cette expression. */
    usedLetters: string[];
    /** Lettres manquantes (pas de valeur). */
    missingLetters: string[];
    /** Valeur minimale possible si '?' (remplacé par 0), undefined si non calculable. */
    minValue?: number;
    /** Valeur maximale possible si '?' (remplacé par 9), undefined si non calculable. */
    maxValue?: number;
    /** Indique que le moteur a appliqué un padding (leading zeros). */
    padded?: boolean;

    /**
     * Provenance par caractère de displayDigits.
     * Chaque entrée contient les lettres "responsables" de ce caractère (uniquement si ce caractère provient d'une valeur fournie).
     * Sert à calculer des suspects plus fins (ex: minutes `6?` => suspect uniquement la lettre du `6`).
     */
    sourcesPerChar?: string[][];
}

export interface AxisPreview {
    axis: Axis;
    cardinal: string;
    status: PreviewStatus;
    message: string;
    display: string;
    degrees: PreviewDigitSegment;
    minutes: PreviewDigitSegment;
    decimals: PreviewDigitSegment;
    missingLetters: string[];
    issues: PreviewIssue[];
    /** Lettres suspectes (issues error), prêtes pour l'UI (champs à surligner). */
    suspectLetters: string[];
    /** Si complet et valide, valeur en degrés décimaux. */
    decimalDegrees?: number;
    /** Intervalle possible (même si partiel). */
    minDecimalDegrees?: number;
    maxDecimalDegrees?: number;
}

export interface CoordinatePreviewState {
    north: AxisPreview;
    east: AxisPreview;
}

