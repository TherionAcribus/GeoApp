/**
 * Contrôleur des vues latérales GeoApp — façade unique derrière le dialogue
 * « Personnaliser les barres latérales » et la commande de reset.
 *
 * Principes (spec §5.2) :
 * - pas de liste `hiddenWidgets` persistée : la visibilité est lue depuis le
 *   shell (`widget.isAttached`), la zone depuis `shell.getAreaFor(widget)` ;
 * - les opérations sont sérialisées pour empêcher un double clic de lancer
 *   deux créations du même widget ;
 * - chaque action utilisateur aboutie déclenche une sauvegarde explicite du
 *   layout via `LayoutAutoSaveContribution.requestSave()` ;
 * - `onDidChange` informe le dialogue des changements d'état (y compris ceux
 *   venant d'ailleurs, p. ex. une fermeture d'onglet à la souris).
 */

import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { ApplicationShell, WidgetManager } from '@theia/core/lib/browser';
import { CommandRegistry, Emitter, Event } from '@theia/core/lib/common';
import { Widget } from '@lumino/widgets';
import { LayoutAutoSaveContribution } from '../layout-auto-save-contribution';
import {
    GEOAPP_SIDEBAR_VIEWS,
    GeoAppSidebarArea,
    GeoAppSidebarViewDescriptor,
} from './geoapp-sidebar-views';
import {
    GeoAppSidebarViewPlacement,
    placementFor,
    resetActionFor,
    SidebarOperationQueue,
} from './geoapp-sidebar-view-state';

export type { GeoAppSidebarViewPlacement } from './geoapp-sidebar-view-state';

export interface GeoAppSidebarViewState {
    readonly descriptor: GeoAppSidebarViewDescriptor;
    /** Vrai si le widget est actuellement attaché au shell. */
    readonly visible: boolean;
    /** Zone courante dérivée du layout (pas d'un réglage persisté). */
    readonly placement: GeoAppSidebarViewPlacement;
    /** Index dans la tab bar de sa zone (-1 si inconnu). */
    readonly index: number;
}

@injectable()
export class GeoAppSidebarController {

    @inject(ApplicationShell)
    protected readonly shell: ApplicationShell;

    @inject(WidgetManager)
    protected readonly widgetManager: WidgetManager;

    @inject(CommandRegistry)
    protected readonly commandRegistry: CommandRegistry;

    @inject(LayoutAutoSaveContribution)
    protected readonly layoutAutoSave: LayoutAutoSaveContribution;

    protected readonly onDidChangeEmitter = new Emitter<void>();
    /** Émis après toute modification de placement (contrôleur ou utilisateur). */
    readonly onDidChange: Event<void> = this.onDidChangeEmitter.event;

    /** Sérialise les opérations utilisateur (show/hide/reset). */
    protected readonly queue = new SidebarOperationQueue();

    @postConstruct()
    protected init(): void {
        // Les fermetures/ouvertures natives (clic sur la croix d'un onglet,
        // glisser-déposer) doivent aussi rafraîchir le dialogue ouvert.
        this.shell.onDidAddWidget(() => this.fireDidChange());
        this.shell.onDidRemoveWidget(() => this.fireDidChange());
    }

    protected fireDidChange(): void {
        this.onDidChangeEmitter.fire();
    }

    getViewStates(): GeoAppSidebarViewState[] {
        return GEOAPP_SIDEBAR_VIEWS.map(descriptor => this.computeState(descriptor));
    }

    protected computeState(descriptor: GeoAppSidebarViewDescriptor): GeoAppSidebarViewState {
        const widget = this.widgetManager.tryGetWidget(descriptor.id);
        const visible = Boolean(widget?.isAttached);
        const area = widget?.isAttached ? this.shell.getAreaFor(widget) : undefined;
        return {
            descriptor,
            visible,
            placement: placementFor(visible, area),
            index: visible ? this.tabIndex(area, widget!) : -1,
        };
    }

    protected tabIndex(area: ApplicationShell.Area | undefined, widget: Widget): number {
        const handler = area === 'left' ? this.shell.leftPanelHandler
            : area === 'right' ? this.shell.rightPanelHandler : undefined;
        if (!handler) {
            return -1;
        }
        return handler.tabBar.titles.findIndex(title => title.owner === widget);
    }

    /**
     * Affiche une vue : la commande d'ouverture existante est préférée (elle
     * applique les bonnes options par défaut), `WidgetManager` sert de repli.
     * Révèle la vue — « cocher » doit rendre la vue visible immédiatement.
     *
     * Certaines commandes (Amis, Trackables) attachent leur widget en zone
     * centrale : comme la case à cocher signifie « épinglée en barre
     * latérale », le widget est ensuite déplacé vers sa zone par défaut
     * (`addWidget` reparente un widget déjà attaché).
     */
    async showView(descriptor: GeoAppSidebarViewDescriptor): Promise<void> {
        return this.queue.enqueue(async () => {
            let widget = this.widgetManager.tryGetWidget(descriptor.id);
            if (!widget?.isAttached) {
                if (this.commandRegistry.getCommand(descriptor.openCommandId)) {
                    try {
                        await this.commandRegistry.executeCommand(descriptor.openCommandId);
                    } catch (error) {
                        console.warn(`[GeoAppSidebar] La commande ${descriptor.openCommandId} a échoué pour « ${descriptor.label} », repli direct`, error);
                    }
                }
                widget = this.widgetManager.tryGetWidget(descriptor.id)
                    ?? await this.widgetManager.getOrCreateWidget(descriptor.id);
            }

            const area = widget.isAttached ? this.shell.getAreaFor(widget) : undefined;
            if (area !== 'left' && area !== 'right') {
                await this.shell.addWidget(widget, {
                    area: descriptor.defaultArea,
                    rank: descriptor.defaultRank,
                });
            }
            await this.shell.revealWidget(descriptor.id);
            this.layoutAutoSave.requestSave();
            this.fireDidChange();
        });
    }

    /**
     * Masque une vue : il faut fermer explicitement le widget. Le `toggleView`
     * natif des `AbstractViewContribution` replie le panneau sans détacher
     * l'icône de l'Activity Bar.
     */
    async hideView(descriptor: GeoAppSidebarViewDescriptor): Promise<void> {
        return this.queue.enqueue(async () => {
            const widget = this.widgetManager.tryGetWidget(descriptor.id);
            if (widget?.isAttached) {
                await this.shell.closeWidget(descriptor.id);
            }
            this.layoutAutoSave.requestSave();
            this.fireDidChange();
        });
    }

    /** Bascule selon l'état courant — point d'entrée des cases à cocher. */
    async setViewVisible(descriptor: GeoAppSidebarViewDescriptor, visible: boolean): Promise<void> {
        return visible ? this.showView(descriptor) : this.hideView(descriptor);
    }

    /**
     * Reset limité au registre : ne touche qu'aux IDs connus — jamais la
     * commande Theia `reset.layout` qui effacerait tout le workbench (§7).
     * Les vues `defaultVisible` retrouvent leur zone/rang ; les autres sont
     * fermées. Les éditeurs centraux, cartes inférieures et terminaux ne sont
     * pas des IDs du registre : ils sont préservés.
     */
    async resetToDefaults(): Promise<void> {
        return this.queue.enqueue(async () => {
            for (const descriptor of GEOAPP_SIDEBAR_VIEWS) {
                try {
                    await this.resetView(descriptor);
                } catch (error) {
                    console.error(`[GeoAppSidebar] Reset impossible pour « ${descriptor.label} » (${descriptor.id})`, error);
                }
            }
            this.layoutAutoSave.requestSave();
            this.fireDidChange();
        });
    }

    protected async resetView(descriptor: GeoAppSidebarViewDescriptor): Promise<void> {
        const widget = this.widgetManager.tryGetWidget(descriptor.id);
        const attached = Boolean(widget?.isAttached);
        const currentArea = attached ? this.shell.getAreaFor(widget!) : undefined;

        switch (resetActionFor(descriptor, attached, currentArea)) {
            case 'leave':
                // Absente comme prévu, ou déjà dans sa zone par défaut :
                // ne pas recréer, conserver l'état interne du widget.
                return;
            case 'close':
                // Masquée par défaut : fermer si présente.
                await this.shell.closeWidget(descriptor.id);
                return;
            case 'recreate':
                // Mal placée (autre zone, main, bottom) ou absente alors
                // qu'elle est par défaut : fermer puis recréer au rang/zone
                // par défaut. La fermeture dispose le widget, donc
                // getOrCreateWidget repart sur une instance neuve.
                if (attached) {
                    await this.shell.closeWidget(descriptor.id);
                }
                await this.shell.addWidget(
                    await this.widgetManager.getOrCreateWidget(descriptor.id),
                    { area: descriptor.defaultArea, rank: descriptor.defaultRank },
                );
                return;
        }
    }

    /** Zone par défaut de chaque vue, pour les groupes du dialogue. */
    areaLabel(area: GeoAppSidebarArea): string {
        return area === 'left' ? 'Barre gauche' : 'Barre droite';
    }
}
