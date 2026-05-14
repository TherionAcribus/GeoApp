import * as React from 'react';
import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser';
import { CommandService } from '@theia/core/lib/common';
import { DocContentService } from './doc-content-service';
import { DocSearchService } from './doc-search-service';
import { DocNavigationTree } from './doc-navigation-tree';
import { DocViewer } from './doc-viewer';
import { DocChapter, DocPageMeta, DocSearchResult } from './doc-types';

import './style/doc-widget.css';

export const DOC_WIDGET_ID = 'geoapp-documentation';
export const DOC_WIDGET_LABEL = 'Documentation GeoApp';

interface DocWidgetState {
    chapters: DocChapter[];
    activePage: DocPageMeta | null;
    searchQuery: string;
    searchResults: DocSearchResult[];
    highlightAnchor: string | null;
    isSearching: boolean;
    initialized: boolean;
}

@injectable()
export class DocWidget extends ReactWidget {

    static readonly ID = DOC_WIDGET_ID;
    static readonly LABEL = DOC_WIDGET_LABEL;

    @inject(DocContentService)
    protected readonly contentService: DocContentService;

    @inject(DocSearchService)
    protected readonly searchService: DocSearchService;

    @inject(CommandService)
    protected readonly commandService: CommandService;

    private widgetState: DocWidgetState = {
        chapters: [],
        activePage: null,
        searchQuery: '',
        searchResults: [],
        highlightAnchor: null,
        isSearching: false,
        initialized: false,
    };

    private searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;

    @postConstruct()
    protected init(): void {
        this.id = DOC_WIDGET_ID;
        this.title.label = DOC_WIDGET_LABEL;
        this.title.caption = DOC_WIDGET_LABEL;
        this.title.iconClass = 'codicon codicon-book';
        this.title.closable = true;
        this.addClass('doc-widget');
        this.initializeContent();
    }

    private async initializeContent(): Promise<void> {
        await this.contentService.initialize();
        await this.searchService.initialize();

        const chapters = this.contentService.getChapters();
        let activePage: DocPageMeta | null = null;

        if (chapters.length > 0 && chapters[0].pages.length > 0) {
            activePage = chapters[0].pages[0];
        }

        this.widgetState = {
            ...this.widgetState,
            chapters,
            activePage,
            initialized: true,
        };
        this.update();
    }

    private handleSelectPage(pageId: string): void {
        const page = this.contentService.getPage(pageId);
        this.widgetState = {
            ...this.widgetState,
            activePage: page || null,
            searchQuery: '',
            searchResults: [],
            highlightAnchor: null,
        };
        this.update();
    }

    private handleSearchChange(query: string): void {
        this.widgetState = { ...this.widgetState, searchQuery: query };
        this.update();

        if (this.searchDebounceTimer !== null) {
            clearTimeout(this.searchDebounceTimer);
        }

        if (!query.trim()) {
            this.widgetState = { ...this.widgetState, searchResults: [], isSearching: false };
            this.update();
            return;
        }

        this.widgetState = { ...this.widgetState, isSearching: true };
        this.update();

        this.searchDebounceTimer = setTimeout(() => {
            const results = this.searchService.search(query);
            this.widgetState = { ...this.widgetState, searchResults: results, isSearching: false };
            if (results.length > 0) {
                const first = results[0];
                const page = this.contentService.getPage(first.pageId);
                this.widgetState = {
                    ...this.widgetState,
                    activePage: page || this.widgetState.activePage,
                    highlightAnchor: first.sectionAnchor,
                };
            }
            this.update();
        }, 280);
    }

    private handleSearchResultClick(result: DocSearchResult): void {
        const page = this.contentService.getPage(result.pageId);
        this.widgetState = {
            ...this.widgetState,
            activePage: page || null,
            highlightAnchor: result.sectionAnchor,
            searchQuery: '',
            searchResults: [],
        };
        this.update();
    }

    private handleAskAI(): void {
        const query = this.widgetState.searchQuery.trim();
        const prompt = query
            ? `@Aide ${query}`
            : '@Aide ';
        try {
            this.commandService.executeCommand('workbench.action.chat.open', { query: prompt });
        } catch {
            this.commandService.executeCommand('chat.open').catch(() => {});
        }
    }

    protected render(): React.ReactNode {
        const { chapters, activePage, searchQuery, searchResults, highlightAnchor, isSearching, initialized } = this.widgetState;

        if (!initialized) {
            return (
                <div className="doc-widget-loading">
                    <span className="codicon codicon-loading codicon-modifier-spin" />
                    <span>Chargement de la documentation...</span>
                </div>
            );
        }

        return (
            <div className="doc-widget-root">
                <div className="doc-sidebar">
                    <div className="doc-sidebar-header">
                        <span className="codicon codicon-book" />
                        <span className="doc-sidebar-title">Documentation</span>
                    </div>
                    <DocNavigationTree
                        chapters={chapters}
                        activePage={activePage?.id || null}
                        onSelectPage={id => this.handleSelectPage(id)}
                    />
                </div>

                <div className="doc-main">
                    <div className="doc-toolbar">
                        <div className="doc-search-bar">
                            <span className="codicon codicon-search doc-search-icon" />
                            <input
                                type="text"
                                className="doc-search-input"
                                placeholder="Rechercher dans la documentation..."
                                value={searchQuery}
                                onChange={e => this.handleSearchChange(e.target.value)}
                                onKeyDown={e => {
                                    if (e.key === 'Escape') {
                                        this.handleSearchChange('');
                                    }
                                }}
                            />
                            {searchQuery && (
                                <button
                                    className="doc-search-clear"
                                    onClick={() => this.handleSearchChange('')}
                                    title="Effacer la recherche"
                                >
                                    <span className="codicon codicon-close" />
                                </button>
                            )}
                            {isSearching && (
                                <span className="codicon codicon-loading codicon-modifier-spin doc-search-spinner" />
                            )}
                        </div>
                        <button
                            className="doc-ask-ai-btn"
                            onClick={() => this.handleAskAI()}
                            title="Poser une question à l'IA (@Aide)"
                        >
                            <span className="codicon codicon-sparkle" />
                            <span>Demander à l'IA</span>
                        </button>
                    </div>

                    {searchQuery && searchResults.length > 0 && (
                        <div className="doc-search-results">
                            <div className="doc-search-results-header">
                                {searchResults.length} résultat{searchResults.length > 1 ? 's' : ''} pour « {searchQuery} »
                            </div>
                            {searchResults.map((result, i) => (
                                <button
                                    key={i}
                                    className="doc-search-result-item"
                                    onClick={() => this.handleSearchResultClick(result)}
                                >
                                    <div className="doc-search-result-path">
                                        <span className="doc-search-result-page">{result.pageTitle}</span>
                                        {result.sectionTitle !== result.pageTitle && (
                                            <>
                                                <span className="doc-search-result-sep"> › </span>
                                                <span className="doc-search-result-section">{result.sectionTitle}</span>
                                            </>
                                        )}
                                    </div>
                                    <div className="doc-search-result-excerpt">{result.excerpt}</div>
                                </button>
                            ))}
                        </div>
                    )}

                    {searchQuery && searchResults.length === 0 && !isSearching && (
                        <div className="doc-search-no-results">
                            <span className="codicon codicon-search-stop" />
                            <span>Aucun résultat pour « {searchQuery} »</span>
                            <button className="doc-ask-ai-btn doc-ask-ai-btn-inline" onClick={() => this.handleAskAI()}>
                                <span className="codicon codicon-sparkle" />
                                Demander à @Aide
                            </button>
                        </div>
                    )}

                    <DocViewer
                        page={activePage}
                        searchResults={searchResults}
                        searchQuery={searchQuery}
                        highlightAnchor={highlightAnchor}
                    />
                </div>
            </div>
        );
    }
}
