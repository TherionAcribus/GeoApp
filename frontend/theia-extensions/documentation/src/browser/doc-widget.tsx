import * as React from 'react';
import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget, WidgetManager, StorageService } from '@theia/core/lib/browser';
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
    activeResultIndex: number;
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

    @inject(StorageService)
    protected readonly storageService: StorageService;

    private static readonly LAST_PAGE_STORAGE_KEY = 'geoapp.documentation.lastPageId';

    private widgetState: DocWidgetState = {
        chapters: [],
        activePage: null,
        searchQuery: '',
        searchResults: [],
        activeResultIndex: 0,
        highlightAnchor: null,
        isSearching: false,
        initialized: false,
    };

    private searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
    private resultsRef = React.createRef<HTMLDivElement>();

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

        // Restaure la dernière page consultée si elle existe toujours.
        const lastPageId = await this.storageService.getData<string>(DocWidget.LAST_PAGE_STORAGE_KEY);
        if (lastPageId) {
            activePage = this.contentService.getPage(lastPageId) || null;
        }
        if (!activePage && chapters.length > 0 && chapters[0].pages.length > 0) {
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

    private saveLastPage(pageId: string): void {
        void this.storageService.setData(DocWidget.LAST_PAGE_STORAGE_KEY, pageId);
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
        if (page) {
            this.saveLastPage(page.id);
        }
        this.update();
    }

    private handleSearchChange(query: string): void {
        if (this.searchDebounceTimer !== null) {
            clearTimeout(this.searchDebounceTimer);
        }

        if (!query.trim()) {
            this.widgetState = { ...this.widgetState, searchQuery: query, searchResults: [], activeResultIndex: 0, isSearching: false };
            this.update();
            return;
        }

        // Un seul update() synchrone : on affiche le texte tapé et le spinner en même temps.
        this.widgetState = { ...this.widgetState, searchQuery: query, isSearching: true };
        this.update();

        this.searchDebounceTimer = setTimeout(() => {
            const results = this.searchService.search(query);
            // On affiche seulement les résultats : la page active ne change qu'au
            // clic sur un résultat ou sur Entrée, pour ne pas faire sauter la page
            // sous les yeux de l'utilisateur pendant qu'il tape.
            this.widgetState = { ...this.widgetState, searchResults: results, activeResultIndex: 0, isSearching: false };
            this.update();
        }, 280);
    }

    /**
     * Déplace la sélection dans la liste de résultats (flèches haut/bas) et fait
     * défiler l'élément actif dans la vue.
     */
    private moveResultSelection(delta: number): void {
        const count = this.widgetState.searchResults.length;
        if (count === 0) {
            return;
        }
        const next = Math.min(count - 1, Math.max(0, this.widgetState.activeResultIndex + delta));
        if (next === this.widgetState.activeResultIndex) {
            return;
        }
        this.widgetState = { ...this.widgetState, activeResultIndex: next };
        this.update();
        requestAnimationFrame(() => {
            const el = this.resultsRef.current?.querySelector(`[data-result-idx="${next}"]`);
            el?.scrollIntoView({ block: 'nearest' });
        });
    }

    private handleSearchSubmit(): void {
        const results = this.widgetState.searchResults;
        const idx = this.widgetState.activeResultIndex;
        if (results.length > 0) {
            this.handleSearchResultClick(results[Math.min(idx, results.length - 1)] || results[0]);
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
        if (page) {
            this.saveLastPage(page.id);
        }
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
        if (page) {
            this.saveLastPage(page.id);
        }
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

    /** Liste des pages à plat, dans l'ordre d'affichage des chapitres. */
    private getFlatPages(): DocPageMeta[] {
        const flat: DocPageMeta[] = [];
        for (const chapter of this.widgetState.chapters) {
            flat.push(...chapter.pages);
        }
        return flat;
    }

    private getAdjacentPages(): { prev: DocPageMeta | null; next: DocPageMeta | null } {
        const active = this.widgetState.activePage;
        if (!active) {
            return { prev: null, next: null };
        }
        const flat = this.getFlatPages();
        const idx = flat.findIndex(p => p.id === active.id);
        if (idx === -1) {
            return { prev: null, next: null };
        }
        return {
            prev: idx > 0 ? flat[idx - 1] : null,
            next: idx < flat.length - 1 ? flat[idx + 1] : null,
        };
    }

    private handleTocClick(anchor: string): void {
        this.widgetState = { ...this.widgetState, highlightAnchor: anchor };
        this.update();
    }

    protected render(): React.ReactNode {
        const { chapters, activePage, searchQuery, searchResults, activeResultIndex, highlightAnchor, isSearching, initialized } = this.widgetState;

        if (!initialized) {
            return (
                <div className="doc-widget-loading">
                    <span className="codicon codicon-loading codicon-modifier-spin" />
                    <span>Chargement de la documentation...</span>
                </div>
            );
        }

        const { prev, next } = this.getAdjacentPages();
        // Sommaire : sections de niveau 2/3 de la page courante (on exclut le titre h1).
        const tocSections = activePage
            ? this.contentService.getSectionsForPage(activePage.id).filter(s => s.level >= 2)
            : [];

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
                                    } else if (e.key === 'ArrowDown') {
                                        e.preventDefault();
                                        this.moveResultSelection(1);
                                    } else if (e.key === 'ArrowUp') {
                                        e.preventDefault();
                                        this.moveResultSelection(-1);
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
                        <div className="doc-search-results" ref={this.resultsRef}>
                            <div className="doc-search-results-header" aria-live="polite">
                                {searchResults.length} résultat{searchResults.length > 1 ? 's' : ''} pour « {searchQuery} »
                            </div>
                            {searchResults.map((result, i) => (
                                <button
                                    key={i}
                                    data-result-idx={i}
                                    className={`doc-search-result-item ${i === activeResultIndex ? 'active' : ''}`}
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

                    <div className="doc-main-body">
                        <DocViewer
                            page={activePage}
                            searchResults={searchResults}
                            searchQuery={searchQuery}
                            highlightAnchor={highlightAnchor}
                            prevPage={prev}
                            nextPage={next}
                            onNavigate={href => this.handleNavigateInternal(href)}
                            onNavigatePage={id => this.handleSelectPage(id)}
                        />
                        {tocSections.length > 1 && (
                            <nav className="doc-toc" aria-label="Sommaire de la page">
                                <div className="doc-toc-title">Sur cette page</div>
                                <ul className="doc-toc-list">
                                    {tocSections.map(section => (
                                        <li
                                            key={section.id}
                                            className={`doc-toc-item doc-toc-level-${section.level}`}
                                        >
                                            <button
                                                className={`doc-toc-link ${highlightAnchor === section.anchor ? 'active' : ''}`}
                                                onClick={() => this.handleTocClick(section.anchor)}
                                            >
                                                {section.title}
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            </nav>
                        )}
                    </div>
                </div>
            </div>
        );
    }
}
