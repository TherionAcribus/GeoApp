import TileLayer from 'ol/layer/Tile';
import OSM from 'ol/source/OSM';
import XYZ from 'ol/source/XYZ';

export interface TileProvider {
    id: string;
    name: string;
    attribution: string;
    createSource: () => any;
}

/**
 * Liste des fournisseurs de tuiles disponibles
 */
export const TILE_PROVIDERS: TileProvider[] = [
    {
        id: 'osm',
        name: 'OpenStreetMap',
        attribution: '© OpenStreetMap contributors',
        createSource: () => new OSM()
    },
    {
        id: 'osm-fr',
        name: 'OpenStreetMap France',
        attribution: '© OpenStreetMap contributors',
        createSource: () => new XYZ({
            url: 'https://{a-c}.tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png',
            attributions: '© OpenStreetMap France'
        })
    },
    {
        id: 'topo',
        name: 'OpenTopoMap',
        attribution: '© OpenTopoMap (CC-BY-SA)',
        createSource: () => new XYZ({
            url: 'https://{a-c}.tile.opentopomap.org/{z}/{x}/{y}.png',
            attributions: 'Map data: © OpenStreetMap contributors, SRTM | Map style: © OpenTopoMap (CC-BY-SA)',
            maxZoom: 17
        })
    },
    {
        id: 'satellite',
        name: 'Satellite (ESRI)',
        attribution: '© ESRI',
        createSource: () => new XYZ({
            url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
            attributions: 'Tiles © Esri — Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community',
            maxZoom: 19
        })
    },
    {
        id: 'cycle',
        name: 'OpenCycleMap',
        attribution: '© OpenCycleMap',
        createSource: () => new XYZ({
            url: 'https://{a-c}.tile.thunderforest.com/cycle/{z}/{x}/{y}.png',
            attributions: 'Maps © Thunderforest, Data © OpenStreetMap contributors',
            maxZoom: 18
        })
    },
    {
        id: 'humanitarian',
        name: 'Humanitarian',
        attribution: '© HOT',
        createSource: () => new XYZ({
            url: 'https://{a-c}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png',
            attributions: '© Humanitarian OpenStreetMap Team'
        })
    }
];

/**
 * Récupère un fournisseur de tuiles par son ID
 */
export function getTileProvider(id: string): TileProvider | undefined {
    return TILE_PROVIDERS.find(provider => provider.id === id);
}

/**
 * Crée une couche de tuiles à partir d'un fournisseur
 */
export function createTileLayer(providerId: string = 'osm'): any {
    const provider = getTileProvider(providerId) || TILE_PROVIDERS[0];
    return new TileLayer({
        source: provider.createSource(),
        properties: {
            name: 'baseLayer',
            providerId: provider.id
        }
    });
}

/**
 * ID du fournisseur par défaut
 */
export const DEFAULT_PROVIDER_ID = 'osm';

