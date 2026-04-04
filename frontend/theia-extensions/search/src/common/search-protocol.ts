/**
 * Protocole de recherche GeoApp.
 * 
 * Définit les interfaces pour le système de recherche in-page
 * réutilisable sur tous les widgets Theia de GeoApp.
 */

/**
 * Un bloc de contenu cherchable au sein d'un widget.
 */
export interface SearchableContent {
    /** Identifiant unique du bloc (ex: "result_3", "description") */
    id: string;
    /** Texte brut cherchable */
    text: string;
    /** Référence DOM optionnelle pour scroll/highlight */
    element?: HTMLElement;
}

/**
 * Un match trouvé par le moteur de recherche.
 */
export interface SearchMatch {
    /** Index global du match (0-based) */
    index: number;
    /** ID du bloc SearchableContent où se trouve le match */
    contentId: string;
    /** Offset de début dans le texte du bloc */
    startOffset: number;
    /** Offset de fin dans le texte du bloc */
    endOffset: number;
    /** Texte capturé */
    matchText: string;
}

/**
 * Options de recherche.
 */
export interface SearchOptions {
    /** Recherche sensible à la casse */
    caseSensitive: boolean;
    /** Mode regex activé */
    useRegex: boolean;
    /** Mode wildcard activé (* et ?) */
    useWildcard: boolean;
}

/**
 * État complet de la recherche.
 */
export interface SearchState {
    /** Terme de recherche actuel */
    query: string;
    /** Options de recherche */
    options: SearchOptions;
    /** Tous les matches trouvés */
    matches: SearchMatch[];
    /** Index du match actif (courant) */
    activeMatchIndex: number;
    /** La recherche est-elle ouverte */
    isOpen: boolean;
}

/**
 * Interface qu'un widget peut implémenter pour fournir
 * un contenu cherchable structuré. Optionnel — le système
 * fonctionne en mode fallback DOM si non implémenté.
 */
export interface SearchableWidget {
    /** Retourne le contenu textuel cherchable du widget */
    getSearchableContent(): SearchableContent[];
    /** Scrolle vers et surligne un match spécifique (optionnel, sinon DOM highlighting) */
    revealMatch?(match: SearchMatch): void;
    /** Efface tous les surlignages de recherche (optionnel, sinon DOM clearing) */
    clearSearchHighlights?(): void;
}

/**
 * Type guard pour vérifier si un widget implémente SearchableWidget.
 */
export function isSearchableWidget(widget: any): widget is SearchableWidget {
    return widget
        && typeof widget.getSearchableContent === 'function';
}

/**
 * Vérifie si le widget gère ses propres highlights (méthodes complètes).
 */
export function hasCustomHighlighting(widget: any): boolean {
    return isSearchableWidget(widget)
        && typeof widget.revealMatch === 'function'
        && typeof widget.clearSearchHighlights === 'function';
}

/**
 * Options par défaut pour la recherche.
 */
export const DEFAULT_SEARCH_OPTIONS: SearchOptions = {
    caseSensitive: false,
    useRegex: false,
    useWildcard: false
};

/**
 * État initial de la recherche.
 */
export const INITIAL_SEARCH_STATE: SearchState = {
    query: '',
    options: { ...DEFAULT_SEARCH_OPTIONS },
    matches: [],
    activeMatchIndex: -1,
    isOpen: false
};
