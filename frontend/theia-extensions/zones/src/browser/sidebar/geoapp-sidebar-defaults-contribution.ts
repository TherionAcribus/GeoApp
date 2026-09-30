/**
 * Layout latéral par défaut de GeoApp.
 *
 * `initializeLayout` n'est appelé par Theia que lorsqu'aucun layout valide n'a
 * pu être restauré (premier démarrage, stockage vide ou corrompu) — c'est le
 * seul endroit où les vues par défaut sont créées. Après une restauration
 * normale, rien n'est rajouté : une vue fermée par l'utilisateur reste absente.
 *
 * Il n'existe plus de liste `hiddenWidgets` persistée : le layout Theia est la
 * seule source de vérité. L'ancienne migration du widget Plugins a été
 * abandonnée : `vsx-extensions-view-container` est désormais le vrai widget
 * Extensions de `@theia/vsx-registry` — le renommer aurait corrompu le layout ;
 * il est fermé par la politique `SIDEBAR_WIDGET_IDS_TO_HIDE` de
 * `theia-ide-contribution.tsx`.
 *
 * Voir documentation/barres-laterales-personnalisation-spec.md §5.3.
 */

import { injectable, inject } from '@theia/core/shared/inversify';
import {
    ApplicationShell,
    FrontendApplication,
    FrontendApplicationContribution,
    WidgetManager,
} from '@theia/core/lib/browser';
import { GEOAPP_SIDEBAR_VIEWS } from './geoapp-sidebar-views';

@injectable()
export class GeoAppSidebarDefaultsContribution implements FrontendApplicationContribution {

    @inject(ApplicationShell)
    protected readonly shell: ApplicationShell;

    @inject(WidgetManager)
    protected readonly widgetManager: WidgetManager;

    async initializeLayout(_app: FrontendApplication): Promise<void> {
        for (const view of GEOAPP_SIDEBAR_VIEWS) {
            if (!view.defaultVisible) {
                continue;
            }
            try {
                const widget = await this.widgetManager.getOrCreateWidget(view.id);
                if (!widget.isAttached) {
                    await this.shell.addWidget(widget, {
                        area: view.defaultArea,
                        rank: view.defaultRank,
                    });
                }
                // Pas d'activateWidget : enchaîner les vues sans les révéler
                // une à une, la plus haute restera visible par rang.
            } catch (error) {
                // Une factory manquante n'empêche pas les autres défauts.
                console.error(`[GeoAppSidebar] Impossible de créer la vue « ${view.label} » (${view.id})`, error);
            }
        }
    }
}

