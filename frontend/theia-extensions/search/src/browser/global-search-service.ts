/**
 * Service de recherche globale GeoApp.
 * 
 * Recherche simultanément dans :
 * 1. Tous les widgets GeoApp ouverts (via DOM text extraction)
 * 2. La base de données backend (géocaches, logs, notes)
 */

import { injectable, inject } from '@theia/core/shared/inversify';
import { ApplicationShell } from '@theia/core/lib/browser';
import { Widget } from '@theia/core/lib/browser/widgets/widget';
import { SearchOptions, DEFAULT_SEARCH_OPTIONS } from '../common/search-protocol';
import { searchInDomNode, buildSearchRegex } from './search-engine';

/**
 * Snippet de contexte autour d'un match.
 */
export interface SearchSnippet {
    prefix: string;
    match: string;
    suffix: string;
    offset: number;
}

/**
 * Résultat de recherche dans un widget ouvert.
 */
export interface WidgetSearchResult {
    widgetId: string;
    widgetTitle: string;
    widgetIconClass: string;
    matchCount: number;
    snippets: SearchSnippet[];
}

/**
 * Résultat de recherche dans une géocache (base de données).
 */
export interface GeocacheSearchResult {
    id: number;
    gc_code: string;
    name: string;
    type: string | null;
    zone_id: number;
    total_matches: number;
    matches_in: Record<string, { count: number; snippets: SearchSnippet[] }>;
}

/**
 * Résultat de recherche dans un log (base de données).
 */
export interface LogSearchResult {
    id: number;
    geocache_id: number;
    geocache_gc_code: string | null;
    geocache_name: string | null;
    author: string | null;
    log_type: string | null;
    date: string | null;
    total_matches: number;
    snippets: SearchSnippet[];
}

/**
 * Résultat de recherche dans une note (base de données).
 */
export interface NoteSearchResult {
    id: number;
    note_type: string;
    source: string;
    total_matches: number;
    snippets: SearchSnippet[];
    linked_geocaches: { id: number; gc_code: string; name: string }[];
    updated_at: string | null;
}

/**
 * Résultat de recherche dans un plugin (base de données).
 */
export interface PluginSearchResult {
    id: number;
    name: string;
    version: string;
    description: string | null;
    author: string | null;
    categories: string[];
    source: string;
    enabled: boolean;
    total_matches: number;
    matches_in: Record<string, { count: number; snippets: SearchSnippet[] }>;
}

/**
 * Résultat de recherche dans un alphabet (fichiers).
 */
export interface AlphabetSearchResult {
    id: string;
    name: string;
    description: string;
    aliases: string[];
    total_matches: number;
    matches_in: Record<string, { count: number; snippets: SearchSnippet[] }>;
}

/**
 * État complet de la recherche globale.
 */
export interface GlobalSearchState {
    query: string;
    options: SearchOptions;
    isSearching: boolean;
    /** Recherche dans les widgets ouverts */
    widgetResults: WidgetSearchResult[];
    /** Recherche dans les géocaches (DB) */
    geocacheResults: GeocacheSearchResult[];
    /** Recherche dans les logs (DB) */
    logResults: LogSearchResult[];
    /** Recherche dans les notes (DB) */
    noteResults: NoteSearchResult[];
    /** Recherche dans les plugins (DB) */
    pluginResults: PluginSearchResult[];
    /** Recherche dans les alphabets (fichiers) */
    alphabetResults: AlphabetSearchResult[];
    /** Erreur éventuelle */
    error: string | null;
    /** Nombre total de résultats */
    totalCount: number;
    /** Scope actif */
    scope: 'all' | 'open_tabs' | 'database' | 'geocaches' | 'plugins' | 'alphabets' | 'logs' | 'notes';
}

export const INITIAL_GLOBAL_SEARCH_STATE: GlobalSearchState = {
    query: '',
    options: { ...DEFAULT_SEARCH_OPTIONS },
    isSearching: false,
    widgetResults: [],
    geocacheResults: [],
    logResults: [],
    noteResults: [],
    pluginResults: [],
    alphabetResults: [],
    error: null,
    totalCount: 0,
    scope: 'all'
};

export type GlobalSearchStateListener = (state: GlobalSearchState) => void;

/**
 * IDs des widgets GeoApp qui participent à la recherche globale.
 */
const GEOAPP_WIDGET_ID_PREFIXES = [
    'plugin-executor-widget',
    'geocache.details.widget',
    'geocache.logs.widget',
    'geocache.notes.widget',
    'zone-geocaches-widget',
    'formula-solver-widget',
    'alphabet-viewer',
    'plugins-browser-widget',
    'batch-plugin-executor-widget',
    'geocache-image-editor-widget',
    'geocache-log-editor-widget'
];

const CONTEXT_CHARS = 60;

@injectable()
export class GlobalSearchService {

    @inject(ApplicationShell)
    protected readonly shell!: ApplicationShell;

    private state: GlobalSearchState = { ...INITIAL_GLOBAL_SEARCH_STATE };
    private listeners: GlobalSearchStateListener[] = [];
    private debounceTimer: ReturnType<typeof setTimeout> | null = null;
    private abortController: AbortController | null = null;

    get currentState(): GlobalSearchState {
        return { ...this.state };
    }

    onStateChange(listener: GlobalSearchStateListener): { dispose: () => void } {
        this.listeners.push(listener);
        return {
            dispose: () => {
                const idx = this.listeners.indexOf(listener);
                if (idx >= 0) {
                    this.listeners.splice(idx, 1);
                }
            }
        };
    }

    /**
     * Lance la recherche globale (debounced).
     */
    search(query: string, options?: Partial<SearchOptions>, scope?: 'all' | 'open_tabs' | 'database'): void {
        this.state.query = query;
        if (options) {
            this.state.options = { ...this.state.options, ...options };
        }
        if (scope) {
            this.state.scope = scope;
        }

        if (!query.trim()) {
            this.clearResults();
            return;
        }

        // Debounce 300ms
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
        }
        this.debounceTimer = setTimeout(() => {
            this.debounceTimer = null;
            this.executeSearch();
        }, 300);
    }

    /**
     * Met à jour les options et relance la recherche.
     */
    updateOptions(options: Partial<SearchOptions>): void {
        this.state.options = { ...this.state.options, ...options };
        if (this.state.query.trim()) {
            if (this.debounceTimer) {
                clearTimeout(this.debounceTimer);
            }
            this.debounceTimer = setTimeout(() => {
                this.debounceTimer = null;
                this.executeSearch();
            }, 300);
        }
    }

    /**
     * Met à jour le scope de recherche.
     */
    updateScope(scope: 'all' | 'open_tabs' | 'database' | 'geocaches' | 'plugins' | 'alphabets' | 'logs' | 'notes'): void {
        this.state.scope = scope;
        this.notifyListeners();
        if (this.state.query.trim()) {
            this.search(this.state.query);
        }
    }

    /**
     * Efface tous les résultats.
     */
    clearResults(): void {
        if (this.abortController) {
            this.abortController.abort();
            this.abortController = null;
        }
        this.state = {
            ...INITIAL_GLOBAL_SEARCH_STATE,
            query: this.state.query,
            options: { ...this.state.options },
            scope: this.state.scope
        };
        this.notifyListeners();
    }

    /**
     * Active un widget et scrolle vers un match.
     */
    async revealInWidget(widgetId: string): Promise<void> {
        const allWidgets = this.getOpenGeoAppWidgets();
        const widget = allWidgets.find(w => w.id === widgetId);
        if (widget) {
            this.shell.activateWidget(widget.id);
        }
    }

    /**
     * Ouvre une géocache par son ID (dispatch un custom event).
     * Utilise le même événement que la carte pour ouvrir les détails.
     */
    openGeocache(geocacheId: number): void {
        window.dispatchEvent(new CustomEvent('geoapp-open-geocache-details', {
            detail: { geocacheId }
        }));
    }

    /**
     * Ouvre un plugin par son nom (dispatch un custom event).
     */
    openPlugin(pluginName: string): void {
        window.dispatchEvent(new CustomEvent('geoapp-open-plugin', {
            detail: { pluginName }
        }));
    }

    /**
     * Ouvre un alphabet par son ID (dispatch un custom event).
     */
    openAlphabet(alphabetId: string): void {
        window.dispatchEvent(new CustomEvent('geoapp-open-alphabet', {
            detail: { alphabetId }
        }));
    }

    /**
     * Exécute la recherche complète.
     */
    private async executeSearch(): Promise<void> {
        const query = this.state.query.trim();
        if (!query) {
            return;
        }

        // Annuler la recherche précédente
        if (this.abortController) {
            this.abortController.abort();
        }
        this.abortController = new AbortController();

        // Valider la regex
        if (this.state.options.useRegex) {
            const regex = buildSearchRegex(query, this.state.options);
            if (!regex) {
                this.state.error = 'Expression régulière invalide';
                this.state.isSearching = false;
                this.notifyListeners();
                return;
            }
        }

        this.state.isSearching = true;
        this.state.error = null;
        this.notifyListeners();

        try {
            const scope = this.state.scope;

            // Recherche dans les widgets ouverts
            if (scope === 'all' || scope === 'open_tabs') {
                this.searchInOpenWidgets(query);
            } else {
                this.state.widgetResults = [];
            }

            // Recherche dans la base de données
            if (scope === 'all' || scope === 'database' || scope === 'geocaches' || scope === 'plugins' || scope === 'alphabets' || scope === 'logs' || scope === 'notes') {
                await this.searchInDatabase(query, this.abortController.signal, scope);
            } else {
                this.state.geocacheResults = [];
                this.state.logResults = [];
                this.state.noteResults = [];
                this.state.pluginResults = [];
                this.state.alphabetResults = [];
            }

            this.state.totalCount =
                this.state.widgetResults.length +
                this.state.geocacheResults.length +
                this.state.logResults.length +
                this.state.noteResults.length +
                this.state.pluginResults.length +
                this.state.alphabetResults.length;

            this.state.isSearching = false;
            this.notifyListeners();

        } catch (e: any) {
            if (e.name === 'AbortError') {
                return; // Recherche annulée, pas d'erreur
            }
            this.state.error = e.message || 'Erreur de recherche';
            this.state.isSearching = false;
            this.notifyListeners();
        }
    }

    /**
     * Recherche dans tous les widgets GeoApp ouverts.
     */
    private searchInOpenWidgets(query: string): void {
        const widgets = this.getOpenGeoAppWidgets();
        const results: WidgetSearchResult[] = [];

        for (const widget of widgets) {
            try {
                const matches = searchInDomNode(widget.node, query, this.state.options);
                if (matches.length > 0) {
                    // Extraire des snippets depuis le DOM
                    const textContent = this.getWidgetTextContent(widget);
                    const snippets = this.extractSnippets(textContent, query);

                    results.push({
                        widgetId: widget.id,
                        widgetTitle: widget.title.label || widget.id,
                        widgetIconClass: widget.title.iconClass || '',
                        matchCount: matches.length,
                        snippets
                    });
                }
            } catch (e) {
                console.warn(`[GlobalSearch] Error searching widget ${widget.id}:`, e);
            }
        }

        results.sort((a, b) => b.matchCount - a.matchCount);
        this.state.widgetResults = results;
    }

    /**
     * Recherche dans la base de données via l'API backend.
     */
    private async searchInDatabase(query: string, signal: AbortSignal, scope: 'all' | 'database' | 'geocaches' | 'plugins' | 'alphabets' | 'logs' | 'notes'): Promise<void> {
        const params = new URLSearchParams({
            q: query,
            case_sensitive: String(this.state.options.caseSensitive),
            use_regex: String(this.state.options.useRegex),
            use_wildcard: String(this.state.options.useWildcard),
            scope,
            limit: '50'
        });

        const response = await fetch(`http://localhost:8000/api/search?${params}`, { signal });

        if (!response.ok) {
            const data = await response.json();
            throw new Error(data.error || `HTTP ${response.status}`);
        }

        const data = await response.json();
        this.state.geocacheResults = data.geocaches || [];
        this.state.logResults = data.logs || [];
        this.state.noteResults = data.notes || [];
        this.state.pluginResults = data.plugins || [];
        this.state.alphabetResults = data.alphabets || [];
    }

    /**
     * Retourne tous les widgets GeoApp ouverts.
     */
    private getOpenGeoAppWidgets(): Widget[] {
        const allWidgets: Widget[] = [
            ...this.shell.getWidgets('main'),
            ...this.shell.getWidgets('bottom'),
            ...this.shell.getWidgets('left'),
            ...this.shell.getWidgets('right')
        ];

        return allWidgets.filter(w => {
            const id = String(w.id);
            return GEOAPP_WIDGET_ID_PREFIXES.some(prefix => id.startsWith(prefix));
        });
    }

    /**
     * Extrait le texte visible d'un widget en excluant l'overlay de recherche.
     */
    private getWidgetTextContent(widget: Widget): string {
        const clone = widget.node.cloneNode(true) as HTMLElement;
        const overlay = clone.querySelector('#geoapp-search-overlay-container');
        if (overlay) {
            overlay.remove();
        }
        return clone.textContent || '';
    }

    /**
     * Extrait des snippets de contexte pour un query dans un texte.
     */
    private extractSnippets(text: string, query: string, maxSnippets: number = 3): SearchSnippet[] {
        const regex = buildSearchRegex(query, this.state.options);
        if (!regex) {
            return [];
        }

        const snippets: SearchSnippet[] = [];
        let match: RegExpExecArray | null;
        const globalRegex = new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : regex.flags + 'g');

        while ((match = globalRegex.exec(text)) !== null && snippets.length < maxSnippets) {
            const start = Math.max(0, match.index - CONTEXT_CHARS);
            const end = Math.min(text.length, match.index + match[0].length + CONTEXT_CHARS);

            snippets.push({
                prefix: (start > 0 ? '…' : '') + text.slice(start, match.index),
                match: match[0],
                suffix: text.slice(match.index + match[0].length, end) + (end < text.length ? '…' : ''),
                offset: match.index
            });
        }

        return snippets;
    }

    private notifyListeners(): void {
        const stateCopy = { ...this.state };
        for (const listener of this.listeners) {
            try {
                listener(stateCopy);
            } catch (e) {
                console.error('[GlobalSearch] Error in listener:', e);
            }
        }
    }
}
