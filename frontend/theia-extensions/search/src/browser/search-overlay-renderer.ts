/**
 * Renderer pour l'overlay de recherche GeoApp.
 * 
 * Gère le rendu React de l'overlay dans le conteneur DOM
 * créé par le SearchService. Écoute les changements d'état
 * pour mettre à jour l'overlay.
 */

import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import * as React from '@theia/core/shared/react';
import { createRoot, Root } from '@theia/core/shared/react-dom/client';
import { SearchService } from './search-service';
import { SearchOverlay } from './search-overlay';
import { SearchState } from '../common/search-protocol';

@injectable()
export class SearchOverlayRenderer {

    @inject(SearchService)
    protected readonly searchService!: SearchService;

    private stateDisposable: { dispose: () => void } | null = null;
    private root: Root | null = null;

    @postConstruct()
    protected init(): void {
        // Écouter les changements d'état pour mettre à jour le rendu
        this.stateDisposable = this.searchService.onStateChange((state: SearchState) => {
            if (state.isOpen) {
                this.renderOverlay(state);
            } else {
                this.unmount();
            }
        });
    }

    /**
     * Effectue le rendu initial de l'overlay.
     */
    render(): void {
        const state = this.searchService.searchState;
        if (state.isOpen) {
            this.renderOverlay(state);
        }
    }

    /**
     * Rend l'overlay React dans le conteneur DOM.
     */
    private renderOverlay(state: SearchState): void {
        const container = this.searchService.getOverlayContainer();
        if (!container) {
            return;
        }

        // Le conteneur principal a pointer-events: none,
        // mais l'overlay lui-même doit être interactif
        const overlayElement = React.createElement(SearchOverlay, {
            initialQuery: state.query,
            initialOptions: state.options,
            matches: state.matches,
            activeMatchIndex: state.activeMatchIndex,
            regexError: this.searchService.regexError,
            onQueryChange: (query: string) => {
                this.searchService.updateQuery(query);
            },
            onOptionsChange: (options) => {
                this.searchService.updateOptions(options);
            },
            onNextMatch: () => {
                this.searchService.nextMatch();
            },
            onPreviousMatch: () => {
                this.searchService.previousMatch();
            },
            onClose: () => {
                this.searchService.close();
                this.unmount();
            }
        });

        // Wrapper avec pointer-events: auto pour rendre l'overlay interactif
        const wrapper = React.createElement('div', {
            style: { pointerEvents: 'auto' }
        }, overlayElement);

        if (!this.root) {
            this.root = createRoot(container);
        }
        this.root.render(wrapper);
    }

    /**
     * Démonte l'overlay React.
     */
    unmount(): void {
        if (this.root) {
            this.root.unmount();
            this.root = null;
        }
    }

    /**
     * Nettoyage.
     */
    dispose(): void {
        this.unmount();
        if (this.stateDisposable) {
            this.stateDisposable.dispose();
            this.stateDisposable = null;
        }
    }
}
