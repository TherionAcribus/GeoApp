/**
 * Types et interfaces pour le système d'alphabets.
 * Définit la structure des données échangées entre frontend et backend.
 */

/**
 * Configuration d'un alphabet.
 */
export interface Alphabet {
    id: string;
    name: string;
    description: string;
    type: string;
    tags?: string[];
    sources?: AlphabetSource[];
    alphabetConfig: AlphabetConfig;
    source?: 'official' | 'custom';
    search_score?: number;
    search_matches?: string[];
}

/**
 * Configuration spécifique d'un alphabet (polices ou images).
 */
export interface AlphabetConfig {
    type: 'font' | 'images';
    fontFile?: string;
    imageFormat?: string;
    imageDir?: string;
    lowercaseSuffix?: string;
    uppercaseSuffix?: string;
    hasUpperCase: boolean;
    characters: AlphabetCharacters;
}

/**
 * Définition des caractères disponibles dans un alphabet.
 */
export interface AlphabetCharacters {
    letters: 'all' | string[];
    numbers: 'all' | string[];
    special?: Record<string, string>;
}

/**
 * Source ou crédit d'un alphabet.
 */
export interface AlphabetSource {
    type: 'reference' | 'font' | 'credit' | 'author';
    label: string;
    url?: string;
    author?: string;
    description?: string;
}

/**
 * Options de recherche pour les alphabets.
 */
export interface AlphabetSearchOptions {
    query: string;
    search_in_name?: boolean;
    search_in_tags?: boolean;
    search_in_readme?: boolean;
}

/**
 * Filtres pour la liste des alphabets.
 */
export interface AlphabetFilters {
    source?: 'official' | 'custom';
    type?: 'font' | 'images';
    tags?: string[];
}

/**
 * Coordonnées GPS détectées.
 */
export interface DetectedCoordinates {
    exist: boolean;
    ddm_lat?: string;
    ddm_lon?: string;
    ddm?: string;
    decimal_latitude?: number;
    decimal_longitude?: number;
    source?: string;
    confidence?: number;
}

/**
 * Information de distance calculée.
 */
export interface DistanceInfo {
    meters: number;
    miles: number;
    status: 'ok' | 'warning' | 'far';
}

/**
 * Géocache associée (informations minimales).
 */
export interface AssociatedGeocache {
    id?: string;
    databaseId?: number;
    code: string;
    name: string;
    gc_lat?: string;
    gc_lon?: string;
}

/**
 * État du zoom par section.
 */
export interface ZoomState {
    enteredSymbols: number;
    decodedText: number;
    availableSymbols: number;
    pinnedSymbols: number;
    pinnedText: number;
    pinnedCoordinates: number;
}

/**
 * État de l'épinglage par section.
 */
export interface PinnedState {
    symbols: boolean;
    text: boolean;
    coordinates: boolean;
}

/**
 * État exportable/importable d'un alphabet.
 */
export interface AlphabetState {
    alphabet_id: string;
    entered_chars: string[];
    decoded_text: string;
    associated_geocache?: AssociatedGeocache;
    timestamp: string;
}

/**
 * Constantes pour les commandes.
 */
export namespace AlphabetsCommands {
    export const OPEN_LIST = {
        id: 'alphabets.openList',
        label: 'Alphabets: Ouvrir la liste'
    };
    
    export const REFRESH = {
        id: 'alphabets.refresh',
        label: 'Alphabets: Actualiser'
    };
    
    export const OPEN_VIEWER = {
        id: 'alphabets.openViewer',
        label: 'Alphabets: Ouvrir un alphabet'
    };
    
    export const DISCOVER = {
        id: 'alphabets.discover',
        label: 'Alphabets: Redécouvrir les alphabets'
    };
    
    export const DELETE_LAST_SYMBOL = {
        id: 'alphabets.deleteLastSymbol',
        label: 'Alphabets: Supprimer le dernier symbole'
    };
    
    export const ADD_SPACE = {
        id: 'alphabets.addSpace',
        label: 'Alphabets: Ajouter un espace'
    };
    
    export const UNDO = {
        id: 'alphabets.undo',
        label: 'Alphabets: Annuler'
    };
    
    export const REDO = {
        id: 'alphabets.redo',
        label: 'Alphabets: Refaire'
    };
    
    export const EXPORT_STATE = {
        id: 'alphabets.exportState',
        label: 'Alphabets: Exporter l\'état'
    };
    
    export const IMPORT_STATE = {
        id: 'alphabets.importState',
        label: 'Alphabets: Importer un état'
    };
}



