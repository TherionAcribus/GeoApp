/**
 * Widget sidebar pour la recherche globale GeoApp.
 * 
 * Recherche dans tous les widgets ouverts + base de données.
 * Résultats groupés par source avec snippets cliquables.
 */

import * as React from '@theia/core/shared/react';
import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget, Message } from '@theia/core/lib/browser';
import {
    GlobalSearchService,
    GlobalSearchState,
    INITIAL_GLOBAL_SEARCH_STATE,
    WidgetSearchResult,
    GeocacheSearchResult,
    LogSearchResult,
    NoteSearchResult,
    PluginSearchResult,
    AlphabetSearchResult,
    SearchSnippet
} from './global-search-service';

@injectable()
export class GlobalSearchWidget extends ReactWidget {

    static readonly ID = 'geoapp-global-search-widget';
    static readonly LABEL = 'Recherche Globale';

    @inject(GlobalSearchService)
    protected readonly globalSearchService!: GlobalSearchService;

    private searchState: GlobalSearchState = { ...INITIAL_GLOBAL_SEARCH_STATE };
    private stateDisposable: { dispose: () => void } | null = null;

    @postConstruct()
    protected init(): void {
        this.id = GlobalSearchWidget.ID;
        this.title.label = GlobalSearchWidget.LABEL;
        this.title.caption = 'Recherche globale dans GeoApp';
        this.title.iconClass = 'codicon codicon-search';
        this.title.closable = true;
        this.node.tabIndex = 0;
        this.addClass('geoapp-global-search-widget');

        this.stateDisposable = this.globalSearchService.onStateChange(state => {
            this.searchState = state;
            this.update();
        });

        // Force le premier rendu React
        this.update();
    }

    dispose(): void {
        if (this.stateDisposable) {
            this.stateDisposable.dispose();
            this.stateDisposable = null;
        }
        super.dispose();
    }

    protected onActivateRequest(msg: Message): void {
        super.onActivateRequest(msg);
        // Focus l'input de recherche
        const input = this.node.querySelector<HTMLInputElement>('.geoapp-gs-input');
        if (input) {
            input.focus();
        } else {
            this.node.focus();
        }
    }

    protected render(): React.ReactNode {
        return <GlobalSearchComponent
            state={this.searchState}
            onSearch={(query, options, scope) => this.globalSearchService.search(query, options, scope as any)}
            onUpdateOptions={(options) => this.globalSearchService.updateOptions(options)}
            onUpdateScope={(scope) => this.globalSearchService.updateScope(scope)}
            onClear={() => this.globalSearchService.clearResults()}
            onRevealInWidget={(widgetId) => this.globalSearchService.revealInWidget(widgetId)}
            onOpenGeocache={(id) => this.globalSearchService.openGeocache(id)}
            onOpenPlugin={(name) => this.globalSearchService.openPlugin(name)}
            onOpenAlphabet={(id) => this.globalSearchService.openAlphabet(id)}
        />;
    }
}

/**
 * Composant React pour l'interface de recherche globale.
 */
const GlobalSearchComponent: React.FC<{
    state: GlobalSearchState;
    onSearch: (query: string, options?: any, scope?: 'all' | 'open_tabs' | 'database' | 'geocaches' | 'plugins' | 'alphabets') => void;
    onUpdateOptions: (options: any) => void;
    onUpdateScope: (scope: 'all' | 'open_tabs' | 'database' | 'geocaches' | 'plugins' | 'alphabets') => void;
    onClear: () => void;
    onRevealInWidget: (widgetId: string) => void;
    onOpenGeocache: (id: number) => void;
    onOpenPlugin: (name: string) => void;
    onOpenAlphabet: (id: string) => void;
}> = ({ state, onSearch, onUpdateOptions, onUpdateScope, onClear, onRevealInWidget, onOpenGeocache, onOpenPlugin, onOpenAlphabet }) => {

    const inputRef = React.useRef<HTMLInputElement>(null);
    const [localQuery, setLocalQuery] = React.useState(state.query);

    // Synchroniser le localQuery avec le state quand il change de l'extérieur
    React.useEffect(() => {
        if (state.query !== localQuery && !state.query) {
            setLocalQuery('');
        }
    }, [state.query]);

    const handleQueryChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const value = e.target.value;
        setLocalQuery(value);
        onSearch(value);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Escape') {
            setLocalQuery('');
            onClear();
        }
    };

    const hasResults = state.widgetResults.length > 0
        || state.geocacheResults.length > 0
        || state.logResults.length > 0
        || state.noteResults.length > 0
        || state.pluginResults.length > 0
        || state.alphabetResults.length > 0;

    const hasQuery = localQuery.trim().length > 0;

    return (
        <div className='geoapp-gs-container'>
            {/* Barre de recherche */}
            <div className='geoapp-gs-header'>
                <div className='geoapp-gs-input-row'>
                    <input
                        ref={inputRef}
                        className='geoapp-gs-input'
                        type='text'
                        placeholder='Rechercher partout…'
                        value={localQuery}
                        onChange={handleQueryChange}
                        onKeyDown={handleKeyDown}
                        autoFocus
                    />
                    {hasQuery && (
                        <button
                            className='geoapp-gs-clear-btn'
                            onClick={() => { setLocalQuery(''); onClear(); }}
                            title='Effacer'
                        >✕</button>
                    )}
                </div>

                {/* Options */}
                <div className='geoapp-gs-options-row'>
                    <button
                        className={`geoapp-gs-toggle ${state.options.caseSensitive ? 'active' : ''}`}
                        onClick={() => onUpdateOptions({ caseSensitive: !state.options.caseSensitive })}
                        title='Sensible à la casse (Alt+C)'
                    >Aa</button>
                    <button
                        className={`geoapp-gs-toggle ${state.options.useWildcard ? 'active' : ''}`}
                        onClick={() => onUpdateOptions({ useWildcard: !state.options.useWildcard, useRegex: false })}
                        title='Jokers * et ? (Alt+W)'
                    >*?</button>
                    <button
                        className={`geoapp-gs-toggle ${state.options.useRegex ? 'active' : ''}`}
                        onClick={() => onUpdateOptions({ useRegex: !state.options.useRegex, useWildcard: false })}
                        title='Expression régulière (Alt+R)'
                    >.*</button>

                    <span className='geoapp-gs-separator' />

                    {/* Scope selector */}
                    <select
                        className='geoapp-gs-scope'
                        value={state.scope}
                        onChange={(e) => onUpdateScope(e.target.value as any)}
                    >
                        <option value='all'>Tout</option>
                        <option value='open_tabs'>Onglets ouverts</option>
                        <option value='database'>Base de données</option>
                        <option value='geocaches'>Géocaches</option>
                        <option value='plugins'>Plugins</option>
                        <option value='alphabets'>Alphabets</option>
                    </select>
                </div>
            </div>

            {/* Status */}
            {state.isSearching && (
                <div className='geoapp-gs-status'>
                    <span className='geoapp-gs-spinner' /> Recherche en cours…
                </div>
            )}

            {state.error && (
                <div className='geoapp-gs-error'>{state.error}</div>
            )}

            {/* Résultats */}
            <div className='geoapp-gs-results'>
                {!hasQuery && !state.isSearching && (
                    <div className='geoapp-gs-placeholder'>
                        Tapez un terme pour rechercher dans les onglets ouverts et la base de données.
                    </div>
                )}

                {hasQuery && !state.isSearching && !hasResults && !state.error && (
                    <div className='geoapp-gs-no-results'>Aucun résultat pour « {localQuery} »</div>
                )}

                {/* Widgets ouverts */}
                {state.widgetResults.length > 0 && (
                    <ResultSection title={`Onglets ouverts (${state.widgetResults.length})`} icon='codicon-window'>
                        {state.widgetResults.map(r => (
                            <WidgetResultItem key={r.widgetId} result={r} onReveal={onRevealInWidget} />
                        ))}
                    </ResultSection>
                )}

                {/* Géocaches (DB) */}
                {state.geocacheResults.length > 0 && (
                    <ResultSection title={`Géocaches (${state.geocacheResults.length})`} icon='codicon-globe'>
                        {state.geocacheResults.map(r => (
                            <GeocacheResultItem key={r.id} result={r} onOpen={onOpenGeocache} />
                        ))}
                    </ResultSection>
                )}

                {/* Logs (DB) */}
                {state.logResults.length > 0 && (
                    <ResultSection title={`Logs (${state.logResults.length})`} icon='codicon-comment'>
                        {state.logResults.map(r => (
                            <LogResultItem key={r.id} result={r} onOpen={onOpenGeocache} />
                        ))}
                    </ResultSection>
                )}

                {/* Notes (DB) */}
                {state.noteResults.length > 0 && (
                    <ResultSection title={`Notes (${state.noteResults.length})`} icon='codicon-note'>
                        {state.noteResults.map(r => (
                            <NoteResultItem key={r.id} result={r} />
                        ))}
                    </ResultSection>
                )}

                {/* Plugins (DB) */}
                {state.pluginResults.length > 0 && (
                    <ResultSection title={`Plugins (${state.pluginResults.length})`} icon='codicon-extensions'>
                        {state.pluginResults.map(r => (
                            <PluginResultItem key={r.id} result={r} onOpen={onOpenPlugin} />
                        ))}
                    </ResultSection>
                )}

                {/* Alphabets (fichiers) */}
                {state.alphabetResults.length > 0 && (
                    <ResultSection title={`Alphabets (${state.alphabetResults.length})`} icon='codicon-symbol-text'>
                        {state.alphabetResults.map(r => (
                            <AlphabetResultItem key={r.id} result={r} onOpen={onOpenAlphabet} />
                        ))}
                    </ResultSection>
                )}
            </div>
        </div>
    );
};

/**
 * Section pliable de résultats.
 */
const ResultSection: React.FC<{
    title: string;
    icon: string;
    children: React.ReactNode;
}> = ({ title, icon, children }) => {
    const [collapsed, setCollapsed] = React.useState(false);

    return (
        <div className='geoapp-gs-section'>
            <div className='geoapp-gs-section-header' onClick={() => setCollapsed(!collapsed)}>
                <span className={`codicon ${collapsed ? 'codicon-chevron-right' : 'codicon-chevron-down'}`} />
                <span className={`codicon ${icon}`} style={{ marginLeft: 4, marginRight: 6 }} />
                <span className='geoapp-gs-section-title'>{title}</span>
            </div>
            {!collapsed && (
                <div className='geoapp-gs-section-body'>
                    {children}
                </div>
            )}
        </div>
    );
};

/**
 * Affiche un snippet avec le match en surbrillance.
 */
const SnippetDisplay: React.FC<{ snippet: SearchSnippet }> = ({ snippet }) => (
    <span className='geoapp-gs-snippet'>
        <span className='geoapp-gs-snippet-text'>{snippet.prefix}</span>
        <mark className='geoapp-gs-snippet-match'>{snippet.match}</mark>
        <span className='geoapp-gs-snippet-text'>{snippet.suffix}</span>
    </span>
);

/**
 * Résultat d'un widget ouvert.
 */
const WidgetResultItem: React.FC<{
    result: WidgetSearchResult;
    onReveal: (widgetId: string) => void;
}> = ({ result, onReveal }) => (
    <div className='geoapp-gs-result-item' onClick={() => onReveal(result.widgetId)}>
        <div className='geoapp-gs-result-header'>
            <span className={`geoapp-gs-result-icon ${result.widgetIconClass}`} />
            <span className='geoapp-gs-result-title'>{result.widgetTitle}</span>
            <span className='geoapp-gs-result-badge'>{result.matchCount}</span>
        </div>
        {result.snippets.slice(0, 2).map((s, i) => (
            <div key={i} className='geoapp-gs-result-snippet'>
                <SnippetDisplay snippet={s} />
            </div>
        ))}
    </div>
);

/**
 * Résultat d'une géocache (DB).
 */
const GeocacheResultItem: React.FC<{
    result: GeocacheSearchResult;
    onOpen: (id: number) => void;
}> = ({ result, onOpen }) => {
    const fieldLabels: Record<string, string> = {
        name: 'Nom',
        gc_code: 'Code',
        owner: 'Propriétaire',
        description: 'Description',
        description_override: 'Description modifiée',
        hints: 'Indices',
        hints_override: 'Indices modifiés',
        personal_note: 'Note personnelle',
        coordinates: 'Coordonnées',
        original_coordinates: 'Coord. originales'
    };

    const matchedFields = Object.keys(result.matches_in);

    return (
        <div className='geoapp-gs-result-item' onClick={() => onOpen(result.id)}>
            <div className='geoapp-gs-result-header'>
                <span className='codicon codicon-globe geoapp-gs-result-icon' />
                <span className='geoapp-gs-result-title'>
                    {result.gc_code} — {result.name}
                </span>
                <span className='geoapp-gs-result-badge'>{result.total_matches}</span>
            </div>
            <div className='geoapp-gs-result-fields'>
                {matchedFields.slice(0, 3).map(field => {
                    const info = result.matches_in[field];
                    return (
                        <div key={field} className='geoapp-gs-result-field'>
                            <span className='geoapp-gs-field-label'>{fieldLabels[field] || field}</span>
                            {info.snippets.slice(0, 1).map((s, i) => (
                                <div key={i} className='geoapp-gs-result-snippet'>
                                    <SnippetDisplay snippet={s} />
                                </div>
                            ))}
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

/**
 * Résultat d'un log (DB).
 */
const LogResultItem: React.FC<{
    result: LogSearchResult;
    onOpen: (id: number) => void;
}> = ({ result, onOpen }) => (
    <div className='geoapp-gs-result-item' onClick={() => onOpen(result.geocache_id)}>
        <div className='geoapp-gs-result-header'>
            <span className='codicon codicon-comment geoapp-gs-result-icon' />
            <span className='geoapp-gs-result-title'>
                {result.geocache_gc_code} — {result.author} ({result.log_type})
            </span>
            <span className='geoapp-gs-result-badge'>{result.total_matches}</span>
        </div>
        {result.snippets.slice(0, 1).map((s, i) => (
            <div key={i} className='geoapp-gs-result-snippet'>
                <SnippetDisplay snippet={s} />
            </div>
        ))}
    </div>
);

/**
 * Résultat d'une note (DB).
 */
const NoteResultItem: React.FC<{
    result: NoteSearchResult;
}> = ({ result }) => (
    <div className='geoapp-gs-result-item'>
        <div className='geoapp-gs-result-header'>
            <span className='codicon codicon-note geoapp-gs-result-icon' />
            <span className='geoapp-gs-result-title'>
                Note ({result.note_type})
                {result.linked_geocaches.length > 0 && (
                    <span className='geoapp-gs-note-link'> — {result.linked_geocaches.map(g => g.gc_code).join(', ')}</span>
                )}
            </span>
            <span className='geoapp-gs-result-badge'>{result.total_matches}</span>
        </div>
        {result.snippets.slice(0, 1).map((s, i) => (
            <div key={i} className='geoapp-gs-result-snippet'>
                <SnippetDisplay snippet={s} />
            </div>
        ))}
    </div>
);

/**
 * Résultat d'un plugin (DB).
 */
const PluginResultItem: React.FC<{
    result: PluginSearchResult;
    onOpen: (name: string) => void;
}> = ({ result, onOpen }) => {
    const matchedFields = Object.keys(result.matches_in);

    return (
        <div className='geoapp-gs-result-item' onClick={() => onOpen(result.name)}>
            <div className='geoapp-gs-result-header'>
                <span className='codicon codicon-extensions geoapp-gs-result-icon' />
                <span className='geoapp-gs-result-title'>
                    {result.name} v{result.version}
                    {!result.enabled && <span style={{ opacity: 0.5 }}> (désactivé)</span>}
                </span>
                <span className='geoapp-gs-result-badge'>{result.total_matches}</span>
            </div>
            {result.description && (
                <div style={{ paddingLeft: 20, fontSize: 11, opacity: 0.7, marginBottom: 2 }}>
                    {result.description}
                </div>
            )}
            {result.categories.length > 0 && (
                <div style={{ paddingLeft: 20, fontSize: 11, opacity: 0.6 }}>
                    {result.categories.join(' • ')}
                </div>
            )}
            {matchedFields.slice(0, 2).map(field => {
                const info = result.matches_in[field];
                return info.snippets.slice(0, 1).map((s, i) => (
                    <div key={`${field}-${i}`} className='geoapp-gs-result-snippet'>
                        <SnippetDisplay snippet={s} />
                    </div>
                ));
            })}
        </div>
    );
};

/**
 * Résultat d'un alphabet (fichiers).
 */
const AlphabetResultItem: React.FC<{
    result: AlphabetSearchResult;
    onOpen: (id: string) => void;
}> = ({ result, onOpen }) => {
    const matchedFields = Object.keys(result.matches_in);

    return (
        <div className='geoapp-gs-result-item' onClick={() => onOpen(result.id)}>
            <div className='geoapp-gs-result-header'>
                <span className='codicon codicon-symbol-text geoapp-gs-result-icon' />
                <span className='geoapp-gs-result-title'>
                    {result.name}
                </span>
                <span className='geoapp-gs-result-badge'>{result.total_matches}</span>
            </div>
            {result.description && (
                <div style={{ paddingLeft: 20, fontSize: 11, opacity: 0.7, marginBottom: 2 }}>
                    {result.description}
                </div>
            )}
            {result.aliases.length > 0 && (
                <div style={{ paddingLeft: 20, fontSize: 11, opacity: 0.6 }}>
                    Alias: {result.aliases.join(', ')}
                </div>
            )}
            {matchedFields.slice(0, 2).map(field => {
                const info = result.matches_in[field];
                return info.snippets.slice(0, 1).map((s, i) => (
                    <div key={`${field}-${i}`} className='geoapp-gs-result-snippet'>
                        <SnippetDisplay snippet={s} />
                    </div>
                ));
            })}
        </div>
    );
};
