/**
 * Contribution Theia pour le système de recherche GeoApp.
 * 
 * Enregistre les commandes (find, findNext, findPrevious, close),
 * les keybindings (Ctrl+F, F3, Shift+F3, Escape),
 * et gère le cycle de vie de l'overlay React.
 */

import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { CommandContribution, CommandRegistry, Command } from '@theia/core/lib/common';
import { KeybindingContribution, KeybindingRegistry } from '@theia/core/lib/browser/keybinding';
import { FrontendApplicationContribution, FrontendApplication, ApplicationShell } from '@theia/core/lib/browser';
import { ContextKeyService, ContextKey } from '@theia/core/lib/browser/context-key-service';
import { SearchService } from './search-service';
import { SearchOverlayRenderer } from './search-overlay-renderer';

/**
 * Commandes de recherche GeoApp.
 */
export namespace GeoAppSearchCommands {
    export const FIND: Command = {
        id: 'geoapp.search.find',
        label: 'GeoApp: Rechercher dans la page'
    };
    export const FIND_NEXT: Command = {
        id: 'geoapp.search.findNext',
        label: 'GeoApp: Occurrence suivante'
    };
    export const FIND_PREVIOUS: Command = {
        id: 'geoapp.search.findPrevious',
        label: 'GeoApp: Occurrence précédente'
    };
    export const CLOSE_SEARCH: Command = {
        id: 'geoapp.search.close',
        label: 'GeoApp: Fermer la recherche'
    };
}

/**
 * Liste des IDs de widgets GeoApp (non-éditeurs) qui supportent la recherche.
 * Le Ctrl+F ne sera intercepté que pour ces widgets.
 */
const GEOAPP_SEARCHABLE_WIDGET_IDS = [
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
    'geocache-log-editor-widget',
    'geocaching-auth-widget',
    'map-widget',
    'map-manager-widget'
];

/**
 * Vérifie si un widget est un widget GeoApp custom (pas un éditeur Monaco).
 */
function isGeoAppWidget(widget: any): boolean {
    if (!widget || !widget.id) {
        return false;
    }
    const widgetId = String(widget.id);
    return GEOAPP_SEARCHABLE_WIDGET_IDS.some(id => widgetId.startsWith(id));
}

@injectable()
export class SearchContribution implements CommandContribution, KeybindingContribution, FrontendApplicationContribution {

    @inject(SearchService)
    protected readonly searchService!: SearchService;

    @inject(SearchOverlayRenderer)
    protected readonly overlayRenderer!: SearchOverlayRenderer;

    @inject(ApplicationShell)
    protected readonly shell!: ApplicationShell;

    @inject(ContextKeyService)
    protected readonly contextKeyService!: ContextKeyService;

    private searchOpenContextKey!: ContextKey<boolean>;

    @postConstruct()
    protected init(): void {
        this.searchOpenContextKey = this.contextKeyService.createKey('geoappSearchOpen', false);

        // Synchroniser le context key avec l'état de la recherche
        this.searchService.onStateChange(state => {
            this.searchOpenContextKey.set(state.isOpen);
        });
    }

    onStart(_app: FrontendApplication): void {
        // Écouter les changements de widget actif
        this.shell.onDidChangeActiveWidget(() => {
            if (this.searchService.isOpen) {
                const targetWidget = this.searchService.getTargetWidget();
                const activeWidget = this.shell.activeWidget;

                // Si le widget actif a changé et que le nouveau n'est pas l'overlay lui-même,
                // fermer la recherche
                if (targetWidget && activeWidget && targetWidget !== activeWidget) {
                    // Ne pas fermer si le focus est dans l'overlay de recherche
                    const overlayContainer = this.searchService.getOverlayContainer();
                    if (overlayContainer && overlayContainer.contains(document.activeElement)) {
                        return;
                    }
                    this.searchService.close();
                    this.overlayRenderer.unmount();
                }
            }
        });
    }

    registerCommands(commands: CommandRegistry): void {
        commands.registerCommand(GeoAppSearchCommands.FIND, {
            execute: () => {
                this.searchService.open();
                this.overlayRenderer.render();
            },
            isEnabled: () => {
                const activeWidget = this.shell.activeWidget;
                return !!activeWidget && isGeoAppWidget(activeWidget);
            }
        });

        commands.registerCommand(GeoAppSearchCommands.FIND_NEXT, {
            execute: () => {
                if (this.searchService.isOpen) {
                    this.searchService.nextMatch();
                }
            },
            isEnabled: () => this.searchService.isOpen
        });

        commands.registerCommand(GeoAppSearchCommands.FIND_PREVIOUS, {
            execute: () => {
                if (this.searchService.isOpen) {
                    this.searchService.previousMatch();
                }
            },
            isEnabled: () => this.searchService.isOpen
        });

        commands.registerCommand(GeoAppSearchCommands.CLOSE_SEARCH, {
            execute: () => {
                if (this.searchService.isOpen) {
                    this.searchService.close();
                    this.overlayRenderer.unmount();
                }
            },
            isEnabled: () => this.searchService.isOpen
        });
    }

    registerKeybindings(keybindings: KeybindingRegistry): void {
        // Ctrl+F : ouvrir la recherche (seulement sur widgets GeoApp)
        keybindings.registerKeybinding({
            command: GeoAppSearchCommands.FIND.id,
            keybinding: 'ctrlcmd+f',
            when: '!editorFocus && !terminalFocus'
        });

        // F3 : occurrence suivante
        keybindings.registerKeybinding({
            command: GeoAppSearchCommands.FIND_NEXT.id,
            keybinding: 'f3'
        });

        // Shift+F3 : occurrence précédente
        keybindings.registerKeybinding({
            command: GeoAppSearchCommands.FIND_PREVIOUS.id,
            keybinding: 'shift+f3'
        });

        // Escape : fermer la recherche
        keybindings.registerKeybinding({
            command: GeoAppSearchCommands.CLOSE_SEARCH.id,
            keybinding: 'escape',
            when: 'geoappSearchOpen'
        });
    }
}
