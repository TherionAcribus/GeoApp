/**
 * Suivi des onglets de fiche géocache : lequel est au premier plan, et lesquels
 * sont ouverts.
 *
 * Les panneaux latéraux (Logs) n'ont pas de géocache à eux : ils affichent celle
 * d'un onglet. Sans ce service, chacun devrait fouiller le shell et deviner ce
 * qu'est une fiche géocache.
 *
 * Le service ne connaît pas `GeocacheDetailsWidget` : il reconnaît un onglet à
 * sa méthode `getGeocacheRef()`. C'est la même souplesse que le canard typé de
 * la recherche in-page, et ça évite un cycle d'imports entre la fiche et les
 * panneaux qui la suivent.
 */
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { ApplicationShell, Widget } from '@theia/core/lib/browser';
import { Emitter, Event as TheiaEvent } from '@theia/core/lib/common/event';
import { GeocacheTabRef } from './geocache-logs-scope';

/**
 * Émis par une fiche géocache quand elle change de géocache **sans changer
 * d'onglet** — c'est le cas du remplacement intelligent, où cliquer une autre
 * cache réutilise l'onglet courant. Le shell ne signale rien dans ce cas : sans
 * cet événement, un panneau qui suit l'onglet actif resterait sur l'ancienne.
 */
export const GEOCACHE_DETAILS_TAB_CHANGED_EVENT = 'geoapp-geocache-details-tab-changed';

export interface GeocacheDetailsTabChangedDetail {
    widgetId: string;
}

/** Un onglet de fiche géocache, vu de l'extérieur. */
export interface GeocacheTabWidget extends Widget {
    getGeocacheRef(): GeocacheTabRef | undefined;
}

export function isGeocacheTabWidget(widget: Widget | undefined | null): widget is GeocacheTabWidget {
    return !!widget && typeof (widget as unknown as Partial<GeocacheTabWidget>).getGeocacheRef === 'function';
}

@injectable()
export class GeocacheDetailsTracker {

    @inject(ApplicationShell)
    protected readonly shell!: ApplicationShell;

    /**
     * Dernier onglet de fiche passé au premier plan.
     *
     * On garde le widget et non sa géocache : un onglet qui change de contenu
     * reste le même onglet, et `getActive()` lit donc toujours la valeur à jour.
     */
    protected activeTab?: GeocacheTabWidget;

    protected readonly onDidChangeActiveEmitter = new Emitter<GeocacheTabRef | undefined>();
    readonly onDidChangeActive: TheiaEvent<GeocacheTabRef | undefined> = this.onDidChangeActiveEmitter.event;

    @postConstruct()
    protected init(): void {
        this.shell.onDidChangeCurrentWidget(({ newValue }) => {
            if (isGeocacheTabWidget(newValue)) {
                this.setActiveTab(newValue);
                return;
            }
            // Donner le focus au panneau Logs ne change pas la géocache « en
            // cours » : on ne lâche l'onglet retenu que s'il a disparu.
            if (this.activeTab?.isDisposed) {
                this.setActiveTab(undefined);
            }
        });

        if (typeof window !== 'undefined') {
            window.addEventListener(GEOCACHE_DETAILS_TAB_CHANGED_EVENT, this.handleTabChanged as EventListener);
        }
    }

    /** Géocache de l'onglet au premier plan, `undefined` si aucun n'est ouvert. */
    getActive(): GeocacheTabRef | undefined {
        const tab = this.resolveActiveTab();
        return tab?.getGeocacheRef();
    }

    /**
     * Géocaches des onglets ouverts, sans doublon.
     *
     * Deux onglets peuvent porter la même géocache (duplication explicite) :
     * les proposer deux fois dans une liste de choix n'aurait aucun sens,
     * puisque c'est la géocache qu'on choisit, pas l'onglet.
     */
    getOpenTabs(): GeocacheTabRef[] {
        const seen = new Set<number>();
        const refs: GeocacheTabRef[] = [];
        for (const widget of this.shell.getWidgets('main')) {
            if (!isGeocacheTabWidget(widget) || widget.isDisposed) {
                continue;
            }
            const ref = widget.getGeocacheRef();
            if (!ref || seen.has(ref.geocacheId)) {
                continue;
            }
            seen.add(ref.geocacheId);
            refs.push(ref);
        }
        return refs;
    }

    /**
     * Onglet retenu, ou à défaut celui que le shell donne pour courant — le cas
     * du tout premier appel, avant qu'aucun changement n'ait été observé (layout
     * restauré au démarrage).
     */
    protected resolveActiveTab(): GeocacheTabWidget | undefined {
        if (this.activeTab && !this.activeTab.isDisposed) {
            return this.activeTab;
        }
        this.activeTab = undefined;
        for (const candidate of [this.shell.activeWidget, this.shell.currentWidget]) {
            if (isGeocacheTabWidget(candidate) && !candidate.isDisposed) {
                this.activeTab = candidate;
                return candidate;
            }
        }
        return undefined;
    }

    protected setActiveTab(tab: GeocacheTabWidget | undefined): void {
        const previous = this.activeTab;
        this.activeTab = tab;
        if (previous === tab) {
            return;
        }
        this.onDidChangeActiveEmitter.fire(this.getActive());
    }

    /**
     * Une fiche a changé de géocache. Seule celle de l'onglet au premier plan
     * intéresse les panneaux : les autres travaillent en arrière-plan.
     */
    protected handleTabChanged = (event: Event): void => {
        const detail = (event as CustomEvent<GeocacheDetailsTabChangedDetail>).detail;
        const active = this.resolveActiveTab();
        if (!detail?.widgetId || !active || active.id !== detail.widgetId) {
            return;
        }
        this.onDidChangeActiveEmitter.fire(this.getActive());
    };

    dispose(): void {
        if (typeof window !== 'undefined') {
            window.removeEventListener(GEOCACHE_DETAILS_TAB_CHANGED_EVENT, this.handleTabChanged as EventListener);
        }
        this.onDidChangeActiveEmitter.dispose();
    }
}
