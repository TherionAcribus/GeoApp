/**
 * Service central de recherche GeoApp.
 * 
 * Orchestre le moteur de recherche, le surlignage DOM,
 * et la communication avec l'overlay React.
 * Gère l'état de la recherche pour le widget actif.
 */

import { injectable, inject } from '@theia/core/shared/inversify';
import { ApplicationShell } from '@theia/core/lib/browser';
import { Widget } from '@theia/core/lib/browser/widgets/widget';
import {
    SearchState,
    SearchOptions,
    SearchMatch,
    SearchableContent,
    INITIAL_SEARCH_STATE,
    DEFAULT_SEARCH_OPTIONS,
    isSearchableWidget,
    hasCustomHighlighting
} from '../common/search-protocol';
import { searchInContents, searchInDomNode, buildSearchRegex } from './search-engine';
import { applyHighlights, clearHighlights, scrollToHighlight } from './search-highlight';

/**
 * Événement émis quand l'état de la recherche change.
 */
export type SearchStateChangeListener = (state: SearchState) => void;

@injectable()
export class SearchService {

    @inject(ApplicationShell)
    protected readonly shell!: ApplicationShell;

    /** État courant de la recherche */
    private state: SearchState = { ...INITIAL_SEARCH_STATE };

    /** Widget actuellement ciblé par la recherche */
    private targetWidget: Widget | null = null;

    /** Conteneur DOM de l'overlay (créé dynamiquement) */
    private overlayContainer: HTMLDivElement | null = null;

    /** Listeners de changement d'état */
    private listeners: SearchStateChangeListener[] = [];

    /** Erreur regex courante */
    private _regexError: string | null = null;

    /** Dernier terme de recherche persisté entre ouvertures */
    private persistedQuery: string = '';
    private persistedOptions: SearchOptions = { ...DEFAULT_SEARCH_OPTIONS };

    /** Timer pour debounce de la recherche */
    private debounceTimer: ReturnType<typeof setTimeout> | null = null;
    private static readonly DEBOUNCE_MS = 250;

    /** MutationObserver pour re-appliquer les highlights après changement DOM */
    private mutationObserver: MutationObserver | null = null;
    private mutationDebounceTimer: ReturnType<typeof setTimeout> | null = null;

    get searchState(): SearchState {
        return this.state;
    }

    get regexError(): string | null {
        return this._regexError;
    }

    get isOpen(): boolean {
        return this.state.isOpen;
    }

    /**
     * Ouvre la recherche sur le widget actif.
     */
    open(): void {
        const activeWidget = this.shell.activeWidget;
        if (!activeWidget) {
            return;
        }

        // Si déjà ouvert sur le même widget, juste focus l'input
        if (this.state.isOpen && this.targetWidget === activeWidget) {
            this.notifyListeners();
            return;
        }

        // Si ouvert sur un autre widget, fermer d'abord
        if (this.state.isOpen) {
            this.closeInternal(false);
        }

        this.targetWidget = activeWidget;

        // Créer le conteneur de l'overlay
        this.createOverlayContainer();

        this.state = {
            ...INITIAL_SEARCH_STATE,
            query: this.persistedQuery,
            options: { ...this.persistedOptions },
            isOpen: true
        };

        // Si on a un terme persisté, relancer la recherche
        if (this.persistedQuery) {
            this.executeSearch();
        }

        this.notifyListeners();
    }

    /**
     * Ferme la recherche et nettoie les surlignages.
     */
    close(): void {
        this.closeInternal(true);
    }

    private closeInternal(notify: boolean): void {
        // Nettoyer les surlignages
        if (this.targetWidget) {
            if (hasCustomHighlighting(this.targetWidget)) {
                (this.targetWidget as any).clearSearchHighlights();
            } else {
                clearHighlights(this.targetWidget.node);
            }
        }

        // Supprimer le conteneur de l'overlay
        this.removeOverlayContainer();

        // Persister le terme et les options
        this.persistedQuery = this.state.query;
        this.persistedOptions = { ...this.state.options };

        this.state = { ...INITIAL_SEARCH_STATE };
        this.targetWidget = null;
        this._regexError = null;

        if (notify) {
            this.notifyListeners();
        }
    }

    /**
     * Met à jour la query de recherche (avec debounce).
     */
    updateQuery(query: string): void {
        this.state.query = query;
        this.persistedQuery = query;
        this._regexError = null;
        this.debouncedExecuteSearch();
    }

    /**
     * Met à jour les options de recherche (avec debounce).
     */
    updateOptions(options: SearchOptions): void {
        this.state.options = { ...options };
        this.persistedOptions = { ...options };
        this._regexError = null;
        this.debouncedExecuteSearch();
    }

    /**
     * Exécute la recherche avec un délai de debounce.
     */
    private debouncedExecuteSearch(): void {
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
        }
        this.debounceTimer = setTimeout(() => {
            this.debounceTimer = null;
            this.executeSearch();
            this.notifyListeners();
        }, SearchService.DEBOUNCE_MS);
    }

    /**
     * Navigue vers le match suivant.
     */
    nextMatch(): void {
        if (this.state.matches.length === 0) {
            return;
        }
        this.state.activeMatchIndex = (this.state.activeMatchIndex + 1) % this.state.matches.length;
        this.highlightAndScroll();
        this.notifyListeners();
    }

    /**
     * Navigue vers le match précédent.
     */
    previousMatch(): void {
        if (this.state.matches.length === 0) {
            return;
        }
        this.state.activeMatchIndex =
            (this.state.activeMatchIndex - 1 + this.state.matches.length) % this.state.matches.length;
        this.highlightAndScroll();
        this.notifyListeners();
    }

    /**
     * Retourne le conteneur DOM de l'overlay (pour le rendu React).
     */
    getOverlayContainer(): HTMLDivElement | null {
        return this.overlayContainer;
    }

    /**
     * Retourne le widget ciblé par la recherche.
     */
    getTargetWidget(): Widget | null {
        return this.targetWidget;
    }

    /**
     * Enregistre un listener de changement d'état.
     */
    onStateChange(listener: SearchStateChangeListener): { dispose: () => void } {
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
     * Exécute la recherche sur le widget ciblé.
     */
    private executeSearch(): void {
        if (!this.targetWidget || !this.state.query) {
            this.state.matches = [];
            this.state.activeMatchIndex = -1;
            this.clearCurrentHighlights();
            return;
        }

        // Vérifier la validité de la regex si mode regex activé
        if (this.state.options.useRegex) {
            const regex = buildSearchRegex(this.state.query, this.state.options);
            if (!regex) {
                this._regexError = 'Expression régulière invalide';
                this.state.matches = [];
                this.state.activeMatchIndex = -1;
                this.clearCurrentHighlights();
                return;
            }
        }

        let matches: SearchMatch[];

        if (hasCustomHighlighting(this.targetWidget)) {
            // Mode structuré complet : le widget fournit contenu ET gère ses highlights
            const contents = (this.targetWidget as any).getSearchableContent();
            matches = searchInContents(contents, this.state.query, this.state.options);
        } else {
            // Mode DOM : recherche dans le DOM du widget (offsets alignés avec les text nodes)
            matches = searchInDomNode(this.targetWidget.node, this.state.query, this.state.options);
        }

        this.state.matches = matches;

        // Garder l'index actif dans les bornes, ou revenir à 0
        if (matches.length > 0) {
            if (this.state.activeMatchIndex < 0 || this.state.activeMatchIndex >= matches.length) {
                this.state.activeMatchIndex = 0;
            }
        } else {
            this.state.activeMatchIndex = -1;
        }

        this.highlightAndScroll();
    }

    /**
     * Applique les surlignages et scrolle vers le match actif.
     */
    private highlightAndScroll(): void {
        this.applyHighlightsInternal(true);
    }

    /**
     * Applique les surlignages SANS scroller.
     * Utilisé par le MutationObserver pour ne pas interférer avec le scroll utilisateur.
     */
    private highlightOnly(): void {
        this.applyHighlightsInternal(false);
    }

    /**
     * Implémentation commune pour le highlight avec ou sans scroll.
     */
    private applyHighlightsInternal(shouldScroll: boolean): void {
        if (!this.targetWidget) {
            return;
        }

        if (hasCustomHighlighting(this.targetWidget)) {
            // Le widget gère ses propres surlignages
            (this.targetWidget as any).clearSearchHighlights();
            if (this.state.matches.length > 0 && this.state.activeMatchIndex >= 0) {
                const activeMatch = this.state.matches[this.state.activeMatchIndex];
                (this.targetWidget as any).revealMatch(activeMatch);
            }
        } else {
            // Mode DOM highlighting (fallback ou SearchableWidget sans custom highlighting)
            const activeMark = applyHighlights(
                this.targetWidget.node,
                this.state.matches,
                this.state.activeMatchIndex
            );
            if (activeMark && shouldScroll) {
                scrollToHighlight(activeMark);
            }
        }
    }

    /**
     * Efface les surlignages courants.
     */
    private clearCurrentHighlights(): void {
        if (!this.targetWidget) {
            return;
        }
        if (hasCustomHighlighting(this.targetWidget)) {
            (this.targetWidget as any).clearSearchHighlights();
        } else {
            clearHighlights(this.targetWidget.node);
        }
    }

    /**
     * Crée le conteneur DOM pour l'overlay React.
     */
    private createOverlayContainer(): void {
        this.removeOverlayContainer();

        if (!this.targetWidget) {
            return;
        }

        const widgetNode = this.targetWidget.node;

        this.overlayContainer = document.createElement('div');
        this.overlayContainer.id = 'geoapp-search-overlay-container';
        this.overlayContainer.style.position = 'sticky';
        this.overlayContainer.style.top = '0';
        this.overlayContainer.style.left = '0';
        this.overlayContainer.style.right = '0';
        this.overlayContainer.style.zIndex = '1000';
        this.overlayContainer.style.pointerEvents = 'none';
        this.overlayContainer.style.display = 'flex';
        this.overlayContainer.style.justifyContent = 'flex-end';
        this.overlayContainer.style.height = '0';
        this.overlayContainer.style.overflow = 'visible';

        // Empêcher les clics dans l'overlay de propager vers Theia
        // (évite que Theia change le widget actif et ferme la recherche)
        this.overlayContainer.addEventListener('mousedown', (e: MouseEvent) => {
            e.stopPropagation();
        }, true);
        this.overlayContainer.addEventListener('focusin', (e: FocusEvent) => {
            e.stopPropagation();
        }, true);

        // Insérer en premier enfant pour que sticky fonctionne en haut du scroll
        widgetNode.insertBefore(this.overlayContainer, widgetNode.firstChild);

        // Démarrer le MutationObserver pour re-appliquer les highlights
        this.startMutationObserver(widgetNode);
    }

    /**
     * Supprime le conteneur DOM de l'overlay.
     */
    private removeOverlayContainer(): void {
        this.stopMutationObserver();
        if (this.overlayContainer && this.overlayContainer.parentNode) {
            this.overlayContainer.parentNode.removeChild(this.overlayContainer);
        }
        this.overlayContainer = null;
    }

    /**
     * Démarre un MutationObserver pour détecter les changements DOM
     * (ex: React re-renders) et re-appliquer les highlights.
     */
    private startMutationObserver(widgetNode: HTMLElement): void {
        this.stopMutationObserver();
        this.mutationObserver = new MutationObserver(() => {
            // Debounce pour éviter de re-appliquer trop souvent
            if (this.mutationDebounceTimer) {
                clearTimeout(this.mutationDebounceTimer);
            }
            this.mutationDebounceTimer = setTimeout(() => {
                this.mutationDebounceTimer = null;
                if (this.state.isOpen && this.state.matches.length > 0 && !isSearchableWidget(this.targetWidget!)) {
                    this.highlightOnly();
                }
            }, 100);
        });
        this.mutationObserver.observe(widgetNode, {
            childList: true,
            subtree: true,
            characterData: true
        });
    }

    /**
     * Arrête le MutationObserver.
     */
    private stopMutationObserver(): void {
        if (this.mutationDebounceTimer) {
            clearTimeout(this.mutationDebounceTimer);
            this.mutationDebounceTimer = null;
        }
        if (this.mutationObserver) {
            this.mutationObserver.disconnect();
            this.mutationObserver = null;
        }
    }

    /**
     * Notifie tous les listeners d'un changement d'état.
     */
    private notifyListeners(): void {
        const stateCopy = { ...this.state };
        for (const listener of this.listeners) {
            try {
                listener(stateCopy);
            } catch (e) {
                console.error('[GeoAppSearch] Error in state change listener:', e);
            }
        }
    }
}
