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
 * classe séparée `GeoAppLegacyPluginsMigrationContribution` (fin de fichier).
 *
 * Voir documentation/barres-laterales-personnalisation-spec.md §5.3.
 */

import { injectable, inject } from '@theia/core/shared/inversify';
import {
    ApplicationShell,
    FrontendApplication,
    FrontendApplicationContribution,
    StorageService,
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

/**
 * Migration historique : l'ancien widget Plugins (`vsx-extensions-view-container`)
 * a été remplacé par `mysterai-plugins-browser`. S'exécute après la restauration
 * du layout (un widget restauré doit être remplacé, pas seulement absent au
 * premier démarrage) — à migrer vers `ApplicationShellLayoutMigration` en lot 4.
 */
@injectable()
export class GeoAppLegacyPluginsMigrationContribution implements FrontendApplicationContribution {

    protected readonly pluginsMigrationStorageKey = 'geoapp.leftPanel.pluginsWidgetMigration.v1';

    @inject(ApplicationShell)
    protected readonly shell: ApplicationShell;

    @inject(WidgetManager)
    protected readonly widgetManager: WidgetManager;

    @inject(StorageService)
    protected readonly storageService: StorageService;

    async onDidInitializeLayout(_app: FrontendApplication): Promise<void> {
        const alreadyMigrated = await this.storageService.getData<boolean>(this.pluginsMigrationStorageKey, false);
        if (alreadyMigrated) {
            return;
        }

        const legacyWidget = this.widgetManager.tryGetWidget('vsx-extensions-view-container');
        const desiredWidget = this.widgetManager.tryGetWidget('mysterai-plugins-browser');

        if (legacyWidget?.isAttached && !desiredWidget?.isAttached && this.shell.getAreaFor(legacyWidget) === 'left') {
            legacyWidget.close();
        }

        await this.storageService.setData(this.pluginsMigrationStorageKey, true);
    }
}
