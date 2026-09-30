/**
 * Registre statique des vues latérales gérées par GeoApp.
 *
 * Source unique partagée par le layout par défaut (`initializeLayout`), le
 * dialogue « Personnaliser les barres latérales » et le reset GeoApp. Les IDs et
 * commandes des autres extensions restent des littéraux centralisés ici afin de
 * ne pas créer de dépendances circulaires entre Zones, Plugins, Alphabets,
 * Recherche, Calculatrice et Formula Solver.
 *
 * Voir documentation/barres-laterales-personnalisation-spec.md §3.2 et §5.1.
 */

export type GeoAppSidebarArea = 'left' | 'right';

export interface GeoAppSidebarViewDescriptor {
    /** Widget factory ID (WidgetManager). */
    readonly id: string;
    readonly label: string;
    readonly iconClass: string;
    /** Commande d'ouverture existante — le contrôleur l'exécute en priorité. */
    readonly openCommandId: string;
    readonly defaultArea: GeoAppSidebarArea;
    readonly defaultRank: number;
    /** Présente au premier démarrage / après « Restaurer les barres latérales ». */
    readonly defaultVisible: boolean;
}

/**
 * Valeurs du tableau §3.2 de la spec : les rangs préservent l'ordre actuel, la
 * Calculatrice est ouvrable mais non forcée, Formula Solver reste à droite par
 * défaut sans être reforcé après un déplacement utilisateur.
 */
export const GEOAPP_SIDEBAR_VIEWS: readonly GeoAppSidebarViewDescriptor[] = [
    {
        id: 'zones.tree.widget',
        label: 'Zones',
        iconClass: 'fa fa-map-marker',
        openCommandId: 'zones:open',
        defaultArea: 'left',
        defaultRank: 100,
        defaultVisible: true,
    },
    {
        id: 'geoapp-map-manager',
        label: 'Cartes',
        iconClass: 'fa fa-map',
        openCommandId: 'geoapp.mapManager.open',
        defaultArea: 'left',
        defaultRank: 200,
        defaultVisible: true,
    },
    {
        id: 'geoapp-global-search-widget',
        label: 'Recherche globale',
        iconClass: 'codicon codicon-search',
        openCommandId: 'geoapp.globalSearch.open',
        defaultArea: 'left',
        defaultRank: 300,
        defaultVisible: true,
    },
    {
        id: 'mysterai-plugins-browser',
        label: 'Plugins',
        iconClass: 'fa fa-puzzle-piece',
        openCommandId: 'plugins.openBrowser',
        defaultArea: 'left',
        defaultRank: 400,
        defaultVisible: true,
    },
    {
        id: 'alphabets-list',
        label: 'Alphabets',
        iconClass: 'fa fa-language',
        openCommandId: 'alphabets.openList',
        defaultArea: 'left',
        defaultRank: 450,
        defaultVisible: true,
    },
    {
        id: 'geocaching-friends-widget',
        label: 'Amis',
        iconClass: 'codicon codicon-organization',
        openCommandId: 'geoapp.friends.open',
        defaultArea: 'left',
        defaultRank: 460,
        defaultVisible: false,
    },
    {
        id: 'geoapp-trackables-widget',
        label: 'Trackables',
        iconClass: 'fa fa-bug',
        openCommandId: 'geoapp.trackables.open',
        defaultArea: 'left',
        defaultRank: 470,
        defaultVisible: false,
    },
    {
        id: 'geoapp.calculator',
        label: 'Calculatrice',
        iconClass: 'codicon codicon-symbol-operator',
        openCommandId: 'geoapp.calculator.open',
        defaultArea: 'left',
        defaultRank: 480,
        defaultVisible: false,
    },
    {
        id: 'formula-solver:widget',
        label: 'Formula Solver',
        iconClass: 'codicon codicon-symbol-variable',
        openCommandId: 'formula-solver:open',
        defaultArea: 'right',
        defaultRank: 500,
        defaultVisible: true,
    },
];
