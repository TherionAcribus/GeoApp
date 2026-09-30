/**
 * Layout latéral par défaut de GeoApp.
 *
 * `initializeLayout` n'est appelé par Theia que lorsqu'aucun layout valide n'a
 * pu être restauré (premier démarrage, stockage vide ou corrompu) — c'est le
 * seul endroit où les vues par défaut sont créées. Après une restauration
 * normale, rien n'est rajouté : une vue fermée par l'utilisateur reste absente.
 *
 * Il n'existe plus de liste `hiddenWidgets` persistée : le layout Theia est la
 * seule source de vérité. La migration de l'ancien widget Plugins vit dans la
 * classe séparée `GeoAppPluginsLayoutTransformer` (fin de fichier).
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
import { ShellLayoutTransformer } from '@theia/core/lib/browser/shell/shell-layout-restorer';
import { renameLegacyPluginsFactoryId } from './geoapp-plugins-layout-migration';
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

/**
 * Migration historique : l'ancien widget Plugins (`vsx-extensions-view-container`)
 * a été remplacé par `mysterai-plugins-browser`.
 *
 * Implémentée via `ShellLayoutTransformer` : le renommage du `factoryId` se
 * produit dans `transformLayoutOnRestore`, **avant** l'inflation du layout —
 * l'ancien widget n'est donc jamais instancié, ni fermé après coup (aucun
 * `setTimeout`, aucun flag de migration persisté : la donnée corrigée est
 * réécrite à la prochaine sauvegarde).
 *
 * `ApplicationShellLayoutMigration` ne convenait pas : ses versions sont une
 * union fermée (2.0–6.0) pilotée par Theia ; un layout déjà en 6.0 ne déclencherait
 * jamais notre migration.
 */
@injectable()
export class GeoAppPluginsLayoutTransformer implements ShellLayoutTransformer {

    transformLayoutOnRestore(layoutData: ApplicationShell.LayoutData): void {
        const renamed = renameLegacyPluginsFactoryId(layoutData);
        if (renamed > 0) {
            console.info(`[GeoAppSidebar] Migration Plugins : ${renamed} description(s) « vsx-extensions-view-container » renommée(s).`);
        }
    }
}
