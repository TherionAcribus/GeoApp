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
import { SearchService } from './search-service';

/**
 * Périmètre de recherche. Union unique réutilisée dans le service et le widget
 * (évite la dérive entre les multiples signatures qui la redéclaraient).
 */
export type SearchScope = 'all' | 'open_tabs' | 'database' | 'geocaches' | 'plugins' | 'alphabets' | 'logs' | 'notes';

/** Endpoint de l'API de recherche backend. */
const SEARCH_API_URL = 'http://localhost:8000/api/search';

/** Longueur minimale de requête avant de déclencher une recherche. */
export const MIN_QUERY_LENGTH = 2;

/** Totaux réels par catégorie (avant troncature côté backend). */
export interface SearchCounts {
    geocaches: number;
    logs: number;
    notes: number;
    plugins: number;
    alphabets: number;
}

const EMPTY_COUNTS: SearchCounts = { geocaches: 0, logs: 0, notes: 0, plugins: 0, alphabets: 0 };

/** Résultats de recherche issus de la base de données backend. */
interface DatabaseSearchResults {
    geocacheResults: GeocacheSearchResult[];
    logResults: LogSearchResult[];
    noteResults: NoteSearchResult[];
    pluginResults: PluginSearchResult[];
    alphabetResults: AlphabetSearchResult[];
    counts: SearchCounts;
    /** Le backend a interrompu le scan (budget temps) : résultats partiels. */
    partial: boolean;
}

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
    /** Totaux réels par catégorie DB (avant troncature ; pour afficher « 50+ »). */
    counts: SearchCounts;
    /** Le backend a interrompu le scan (budget temps) : résultats partiels. */
    partial: boolean;
    /** Scope actif */
    scope: SearchScope;
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
    counts: { ...EMPTY_COUNTS },
    partial: false,
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

/** Widgets ciblés à l'ouverture d'un résultat de recherche. */
const DETAILS_WIDGET_ID = 'geocache.details.widget';
const NOTES_WIDGET_ID = 'geocache.notes.widget';

/** Attente de l'ouverture (asynchrone) du panneau Notes. */
const WIDGET_WAIT_TIMEOUT_MS = 5000;
const WIDGET_POLL_INTERVAL_MS = 150;

/** Délai laissé à une activation pour se stabiliser avant vérification. */
const ACTIVATION_SETTLE_MS = 300;

/** Tentatives d'activation du panneau Notes face aux activations concurrentes. */
const NOTES_ACTIVATION_ATTEMPTS = 3;

const delay = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

@injectable()
export class GlobalSearchService {

    @inject(ApplicationShell)
    protected readonly shell!: ApplicationShell;

    @inject(SearchService)
    protected readonly searchService!: SearchService;

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
    search(query: string, options?: Partial<SearchOptions>, scope?: SearchScope): void {
        this.state.query = query;
        if (options) {
            this.state.options = { ...this.state.options, ...options };
        }
        if (scope) {
            this.state.scope = scope;
        }

        // En-deçà de la longueur minimale, on n'interroge ni le backend ni le
        // DOM (évite les scans inutiles sur 1 caractère). Le widget affiche
        // alors une invite plutôt qu'un « aucun résultat » trompeur.
        if (query.trim().length < MIN_QUERY_LENGTH) {
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
    updateScope(scope: SearchScope): void {
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
     * Une fois les détails ouverts, surligne les termes recherchés via la
     * recherche in-page.
     */
    openGeocache(geocacheId: number): void {
        const query = this.state.query.trim();
        const options: SearchOptions = { ...this.state.options };

        window.dispatchEvent(new CustomEvent('geoapp-open-geocache-details', {
            detail: { geocacheId }
        }));

        if (query) {
            this.highlightInDetailsWhenReady(query, options);
        }
    }

    /**
     * Ouvre la géocache portant une note : ses détails dans l'espace principal,
     * puis le panneau Notes positionné sur cette géocache, où la requête est
     * surlignée.
     */
    openNote(geocacheId: number, gcCode?: string, name?: string): void {
        const query = this.state.query.trim();
        const options: SearchOptions = { ...this.state.options };

        window.dispatchEvent(new CustomEvent('geoapp-open-geocache-details', {
            detail: { geocacheId, name }
        }));
        window.dispatchEvent(new CustomEvent('open-geocache-notes', {
            detail: { geocacheId, gcCode, name }
        }));

        void this.focusNotesWhenReady(query ? { query, options } : undefined);
    }

    /**
     * Attend l'attachement du panneau Notes (son ouverture est asynchrone) puis
     * l'active. Les détails de la géocache s'ouvrant en parallèle et volant
     * l'activation quand leur chargement se termine après le nôtre, on ré-active
     * jusqu'à ce que le panneau reste actif — sinon le surlignage in-page, qui
     * cible le widget actif, s'appliquerait aux détails au lieu des notes.
     */
    private async focusNotesWhenReady(highlight?: { query: string; options: SearchOptions }): Promise<void> {
        const notes = await this.waitForWidget(NOTES_WIDGET_ID, WIDGET_WAIT_TIMEOUT_MS);
        if (!notes) {
            return;
        }

        for (let attempt = 0; attempt < NOTES_ACTIVATION_ATTEMPTS; attempt++) {
            void this.shell.activateWidget(notes.id);
            await delay(ACTIVATION_SETTLE_MS);
            if (this.shell.activeWidget === notes) {
                break;
            }
        }

        if (highlight && this.shell.activeWidget === notes) {
            this.triggerHighlight(highlight.query, highlight.options);
        }
    }

    /**
     * Résout dès qu'un widget attaché dont l'ID commence par `idPrefix` existe,
     * ou `undefined` au bout de `timeoutMs`.
     */
    private async waitForWidget(idPrefix: string, timeoutMs: number): Promise<Widget | undefined> {
        const deadline = Date.now() + timeoutMs;
        for (;;) {
            const widget = this.shell.widgets.find(w => String(w.id).startsWith(idPrefix) && w.isAttached);
            if (widget || Date.now() >= deadline) {
                return widget;
            }
            await delay(WIDGET_POLL_INTERVAL_MS);
        }
    }

    /**
     * Ouvre la recherche in-page sur le widget actif, pré-remplie avec la
     * requête, pour surligner les termes trouvés.
     */
    private triggerHighlight(query: string, options: SearchOptions): void {
        try {
            this.searchService.open();
            this.searchService.updateOptions({ ...options });
            this.searchService.updateQuery(query);
        } catch {
            // best-effort : le surlignage ne doit jamais casser l'ouverture
        }
        // Re-déclenche pour rattraper le contenu chargé de façon asynchrone
        // (le contenu est fetché puis rendu après l'activation du widget).
        setTimeout(() => {
            try {
                if (this.searchService.isOpen) {
                    this.searchService.updateQuery(query);
                }
            } catch {
                // best-effort
            }
        }, 900);
    }

    /**
     * Dès que le widget de détails de géocache devient actif, ouvre la
     * recherche in-page pré-remplie avec la requête pour surligner les termes.
     * Best-effort : n'interfère pas si le widget n'apparaît pas (timeout).
     */
    private highlightInDetailsWhenReady(query: string, options: SearchOptions): void {
        let settled = false;
        const cleanup = () => {
            if (settled) {
                return;
            }
            settled = true;
            disposable.dispose();
            clearTimeout(timer);
        };

        const onActive = (widget: { id: string | number } | null | undefined) => {
            if (settled || !widget) {
                return;
            }
            if (!String(widget.id).startsWith(DETAILS_WIDGET_ID)) {
                return;
            }
            cleanup();
            // Laisser le widget s'attacher/rendre avant de chercher.
            setTimeout(() => this.triggerHighlight(query, options), 250);
        };

        const disposable = this.shell.onDidChangeActiveWidget((args: any) => onActive(args?.newValue));
        // Filet : ne pas laisser le listener vivre indéfiniment.
        const timer = setTimeout(cleanup, 4000);
        // Cas où le widget de détails serait déjà l'actif.
        onActive(this.shell.activeWidget as { id: string | number } | null);
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
        this.state.partial = false;
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
     * Collecte les résultats de recherche dans les widgets GeoApp ouverts.
     * Fonction pure (ne modifie pas l'état), partagée par la recherche
     * interactive et la recherche programmatique (searchDirect).
     */
    private collectWidgetResults(query: string, options: SearchOptions): WidgetSearchResult[] {
        const widgets = this.getOpenGeoAppWidgets();
        const results: WidgetSearchResult[] = [];

        for (const widget of widgets) {
            try {
                const matches = searchInDomNode(widget.node, query, options);
                if (matches.length > 0) {
                    const textContent = this.getWidgetTextContent(widget);
                    const snippets = this.extractSnippets(textContent, query, 3, options);

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
        return results;
    }

    /**
     * Recherche dans tous les widgets GeoApp ouverts (met à jour l'état).
     */
    private searchInOpenWidgets(query: string): void {
        this.state.widgetResults = this.collectWidgetResults(query, this.state.options);
    }

    /**
     * Appelle l'API de recherche backend et retourne les résultats bruts.
     * Source unique de vérité pour l'endpoint et le mapping de la réponse,
     * partagée par la recherche interactive et searchDirect.
     */
    private async fetchDatabaseResults(
        query: string,
        scope: SearchScope,
        options: SearchOptions,
        limit: number,
        signal?: AbortSignal
    ): Promise<DatabaseSearchResults> {
        const params = new URLSearchParams({
            q: query,
            case_sensitive: String(options.caseSensitive),
            use_regex: String(options.useRegex),
            use_wildcard: String(options.useWildcard),
            scope,
            limit: String(limit)
        });

        const response = await fetch(`${SEARCH_API_URL}?${params}`, signal ? { signal } : {});

        if (!response.ok) {
            let message = `HTTP ${response.status}`;
            try {
                const data = await response.json();
                message = data.error || message;
            } catch {
                // corps non-JSON : on garde le message HTTP par défaut
            }
            throw new Error(message);
        }

        const data = await response.json() as Record<string, unknown>;
        return {
            geocacheResults: (data['geocaches'] as GeocacheSearchResult[]) || [],
            logResults: (data['logs'] as LogSearchResult[]) || [],
            noteResults: (data['notes'] as NoteSearchResult[]) || [],
            pluginResults: (data['plugins'] as PluginSearchResult[]) || [],
            alphabetResults: (data['alphabets'] as AlphabetSearchResult[]) || [],
            counts: { ...EMPTY_COUNTS, ...(data['counts'] as Partial<SearchCounts> | undefined) },
            partial: data['partial'] === true
        };
    }

    /**
     * Recherche dans la base de données via l'API backend (met à jour l'état).
     */
    private async searchInDatabase(query: string, signal: AbortSignal, scope: SearchScope): Promise<void> {
        const results = await this.fetchDatabaseResults(query, scope, this.state.options, 50, signal);
        this.state.geocacheResults = results.geocacheResults;
        this.state.logResults = results.logResults;
        this.state.noteResults = results.noteResults;
        this.state.pluginResults = results.pluginResults;
        this.state.alphabetResults = results.alphabetResults;
        this.state.counts = results.counts;
        this.state.partial = results.partial;
    }

    /**
     * Retourne tous les widgets GeoApp ouverts.
     */
    protected getOpenGeoAppWidgets(): Widget[] {
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
    protected extractSnippets(text: string, query: string, maxSnippets: number = 3, options?: SearchOptions): SearchSnippet[] {
        const regex = buildSearchRegex(query, options ?? this.state.options);
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

    /**
     * Recherche immédiate sans debounce, pour usage programmatique (outils IA).
     * Ne modifie pas l'état interne du service.
     */
    async searchDirect(
        query: string,
        scope: SearchScope = 'all'
    ): Promise<DatabaseSearchResults & {
        widgetResults: WidgetSearchResult[];
        totalCount: number;
    }> {
        const emptyDb: DatabaseSearchResults = {
            geocacheResults: [], logResults: [], noteResults: [], pluginResults: [], alphabetResults: [], counts: { ...EMPTY_COUNTS }, partial: false
        };
        const trimmed = query.trim();
        if (!trimmed) {
            return { widgetResults: [], ...emptyDb, totalCount: 0 };
        }

        const opts: SearchOptions = { ...DEFAULT_SEARCH_OPTIONS };

        const widgetResults = (scope === 'all' || scope === 'open_tabs')
            ? this.collectWidgetResults(trimmed, opts)
            : [];

        let db: DatabaseSearchResults = { ...emptyDb };
        if (scope !== 'open_tabs') {
            try {
                db = await this.fetchDatabaseResults(trimmed, scope, opts, 20);
            } catch {
                // usage programmatique : on échoue silencieusement
            }
        }

        const totalCount = widgetResults.length + db.geocacheResults.length + db.logResults.length
            + db.noteResults.length + db.pluginResults.length + db.alphabetResults.length;
        return { widgetResults, ...db, totalCount };
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
