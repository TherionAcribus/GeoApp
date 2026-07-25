import * as React from 'react';
import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget, WidgetManager } from '@theia/core/lib/browser';
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

    @inject(WidgetManager)
    protected readonly widgetManager: WidgetManager;

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
            // On affiche seulement les résultats : la page active ne change qu'au
            // clic sur un résultat ou sur Entrée, pour ne pas faire sauter la page
            // sous les yeux de l'utilisateur pendant qu'il tape.
            this.widgetState = { ...this.widgetState, searchResults: results, isSearching: false };
            this.update();
        }, 280);
    }

    private handleSearchSubmit(): void {
        const results = this.widgetState.searchResults;
        if (results.length > 0) {
            this.handleSearchResultClick(results[0]);
        }
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

    // Identifiants Theia (et non VS Code) du widget de chat IA et de sa commande d'ouverture.
    private static readonly CHAT_VIEW_WIDGET_ID = 'chat-view-widget';
    private static readonly CHAT_TOGGLE_COMMAND_ID = 'aiChat:toggle';

    private async handleAskAI(): Promise<void> {
        const query = this.widgetState.searchQuery.trim();
        const prompt = query ? `@Aide ${query}` : '@Aide ';

        // N'ouvrir le chat que s'il n'est pas déjà visible : `aiChat:toggle` le
        // refermerait s'il l'était déjà.
        const existing = this.widgetManager.tryGetWidget(DocWidget.CHAT_VIEW_WIDGET_ID);
        if (!existing || !existing.isVisible) {
            try {
                await this.commandService.executeCommand(DocWidget.CHAT_TOGGLE_COMMAND_ID);
            } catch (e) {
                console.error('[DocWidget] Impossible d\'ouvrir le chat IA:', e);
                return;
            }
        }

        this.prefillChatInput(prompt);
    }

    /**
     * Préremplit l'éditeur Monaco de l'input du chat avec `prompt`, sans envoyer.
     * L'éditeur est créé de façon asynchrone après l'ouverture du widget : on
     * réessaie brièvement tant qu'il n'est pas disponible.
     */
    private prefillChatInput(prompt: string, attempt: number = 0): void {
        const chatWidget = this.widgetManager.tryGetWidget<any>(DocWidget.CHAT_VIEW_WIDGET_ID);
        const editor = chatWidget?.inputWidget?.editor;
        const control = editor?.getControl?.();

        if (control) {
            control.setValue(prompt);
            const model = control.getModel?.();
            if (model) {
                const lastLine = model.getLineCount();
                control.setPosition({ lineNumber: lastLine, column: model.getLineMaxColumn(lastLine) });
            }
            chatWidget.inputWidget.activate?.();
            return;
        }

        if (attempt < 20) {
            setTimeout(() => this.prefillChatInput(prompt, attempt + 1), 100);
        }
    }

    private handleNavigateInternal(href: string): void {
        const target = this.resolveInternalLink(href);
        if (!target) {
            return;
        }
        const page = this.contentService.getPage(target.pageId);
        this.widgetState = {
            ...this.widgetState,
            activePage: page || this.widgetState.activePage,
            highlightAnchor: target.anchor,
            searchQuery: '',
            searchResults: [],
        };
        this.update();
    }

    /**
     * Résout un lien Markdown interne (relatif au fichier courant) vers un id de
     * page et une éventuelle ancre. Les ids de page suivent la convention
     * dossier/fichier → « dossier.fichier » (cf. generate-docs-manifest.mjs).
     */
    private resolveInternalLink(href: string): { pageId: string; anchor: string | null } | null {
        if (!href) {
            return null;
        }
        const hashIndex = href.indexOf('#');
        const rawPath = hashIndex === -1 ? href : href.slice(0, hashIndex);
        const rawHash = hashIndex === -1 ? '' : href.slice(hashIndex + 1);
        const anchor = rawHash ? decodeURIComponent(rawHash) : null;

        const current = this.widgetState.activePage;
        if (!current) {
            return null;
        }

        // Lien purement ancre (#section) : rester sur la page courante.
        if (!rawPath.trim()) {
            return { pageId: current.id, anchor };
        }

        // Résolution du chemin relatif par rapport au dossier de la page courante.
        const currentDir = current.id.split('.').slice(0, -1);
        const stack = [...currentDir];
        const cleanPath = rawPath.replace(/\.md$/i, '');
        for (const part of cleanPath.split('/')) {
            if (part === '' || part === '.') {
                continue;
            }
            if (part === '..') {
                stack.pop();
            } else {
                stack.push(part);
            }
        }
        const targetId = stack.join('.');
        if (!this.contentService.getPage(targetId)) {
            return null;
        }
        return { pageId: targetId, anchor };
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
                                    } else if (e.key === 'Enter') {
                                        e.preventDefault();
                                        this.handleSearchSubmit();
                                    }
                                }}
                            />
                            {searchQuery && (
                                <button
                                    className="doc-search-clear"
                                    onClick={() => this.handleSearchChange('')}
                                    title="Effacer la recherche"
                                    aria-label="Effacer la recherche"
                                >
                                    <span className="codicon codicon-close" aria-hidden="true" />
                                </button>
                            )}
                            {isSearching && (
                                <span className="codicon codicon-loading codicon-modifier-spin doc-search-spinner" />
                            )}
                        </div>
                        <button
                            className="doc-ask-ai-btn"
                            onClick={() => void this.handleAskAI()}
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
                            <button className="doc-ask-ai-btn doc-ask-ai-btn-inline" onClick={() => void this.handleAskAI()}>
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
                        onNavigate={href => this.handleNavigateInternal(href)}
                    />
                </div>
            </div>
        );
    }
}
