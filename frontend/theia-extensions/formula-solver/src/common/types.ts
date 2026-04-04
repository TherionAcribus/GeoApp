/**
 * Types partagés pour l'extension Formula Solver.
 */

export type FragmentKind = 'cardinal' | 'degrees' | 'minutes' | 'decimal';
export type FragmentStatus = 'fixed' | 'pending' | 'ok' | 'length-mismatch' | 'empty' | 'invalid';

export interface FormulaFragment {
    kind: FragmentKind;
    label: string;
    raw: string;
    cleaned: string;
    variables: string[];
    expectedLength?: number;
    actualLength?: number;
    status: FragmentStatus;
    notes?: string;
    index?: number;
}

export interface CoordinateFragments {
    original: string;
    cardinal: FormulaFragment;
    degrees: FormulaFragment;
    minutes: FormulaFragment;
    decimals: FormulaFragment[];
}

export interface FormulaFragments {
    north: CoordinateFragments;
    east: CoordinateFragments;
}

export interface Formula {
    id: string;
    north: string;
    east: string;
    source: string;
    text_output: string;
    confidence: number;
    fragments?: FormulaFragments;
}

export interface Question {
    letter: string;
    question: string;
    answer?: string | number;
}

export type ValueType = 'value' | 'checksum' | 'reduced' | 'length' | 'custom';

export interface LetterValue {
    letter: string;
    rawValue: string;
    value: number;
    type: ValueType;
    values?: number[];
    isList?: boolean;
}

export interface CalculatedCoordinates {
    latitude: number;
    longitude: number;
    ddm: string;
    dms: string;
    decimal: string;
}

export interface CalculationResult {
    status: 'success' | 'error';
    coordinates?: CalculatedCoordinates;
    distance?: {
        km: number;
        miles: number;
    };
    calculation_steps?: {
        north_original: string;
        east_original: string;
        north_substituted: string;
        east_substituted: string;
    };
    error?: string;
}

export interface FormulaSolverState {
    currentStep: 'detect' | 'questions' | 'values' | 'calculate';
    geocacheId?: number;
    gcCode?: string;
    geocacheName?: string;
    text?: string;
    originLat?: number;
    originLon?: number;
    formulas: Formula[];
    selectedFormula?: Formula;
    questions: Question[];
    values: Map<string, LetterValue>;
    result?: CalculationResult;
    loading: boolean;
    error?: string;
}

export interface ValueOperation {
    type: ValueType;
    label: string;
    description: string;
    icon: string;
    calculate: (input: string) => number;
}
