/**
 * Vue « Cartes » homogénéisée sur `AbstractViewContribution` (spec §5.5) :
 * commande de bascule `geoapp.mapManager.open` (l'ID existant est conservé —
 * les raccourcis et appels continuent de fonctionner), zone gauche rang 200
 * par défaut, entrée unique dans `Affichage > Vues`.
 *
 * `registerMenus` est volontairement réécrit sans `super.registerMenus` : la
 * classe de base enregistrerait la même commande sans `order` — une entrée
 * dupliquée (cf. fix appliqué à Alphabets/Calculatrice/Plugins).
 */

import { injectable } from '@theia/core/shared/inversify';
import { MenuModelRegistry } from '@theia/core/lib/common';
import { AbstractViewContribution, CommonMenus } from '@theia/core/lib/browser';
import { MapManagerWidget } from './map-manager-widget';

@injectable()
export class MapManagerViewContribution extends AbstractViewContribution<MapManagerWidget> {

    constructor() {
        super({
            widgetId: MapManagerWidget.ID,
            widgetName: 'Cartes',
            defaultWidgetOptions: { area: 'left', rank: 200 },
            toggleCommandId: 'geoapp.mapManager.open',
        });
    }

    override registerMenus(menus: MenuModelRegistry): void {
        menus.registerMenuAction(CommonMenus.VIEW_VIEWS, {
            commandId: this.toggleCommand!.id,
            label: 'Cartes',
            order: '0.7',
        });
    }
}
