import Cluster from 'ol/source/Cluster';
import VectorSource from 'ol/source/Vector';
import { Feature } from 'ol';
import { Point } from 'ol/geom';

/**
 * Configuration du clustering pour les géocaches
 */
export interface ClusterConfig {
    /** Distance en pixels pour grouper les features */
    distance: number;
    /** Nombre minimum de features pour former un cluster */
    minDistance: number;
    /** Zoom à partir duquel désactiver le clustering */
    disableClusteringAtZoom?: number;
}

/**
 * Configuration par défaut du clustering
 */
export const DEFAULT_CLUSTER_CONFIG: ClusterConfig = {
    distance: 50,
    minDistance: 20,
    disableClusteringAtZoom: 15
};

/**
 * Crée une source de clustering à partir d'une source vectorielle
 */
export function createClusterSource(
    vectorSource: VectorSource<Feature<Point>>,
    config: Partial<ClusterConfig> = {}
): any {
    const finalConfig = { ...DEFAULT_CLUSTER_CONFIG, ...config };

    const clusterSource = new Cluster({
        distance: finalConfig.distance,
        minDistance: finalConfig.minDistance,
        source: vectorSource,
        // Fonction pour déterminer si on doit créer un cluster en fonction du zoom
        geometryFunction: (feature) => {
            return feature.getGeometry() as Point;
        }
    });

    return clusterSource;
}

/**
 * Détermine si le clustering doit être actif pour un niveau de zoom donné
 */
export function shouldEnableClustering(zoom: number, config: ClusterConfig = DEFAULT_CLUSTER_CONFIG): boolean {
    if (config.disableClusteringAtZoom === undefined) {
        return true;
    }
    return zoom < config.disableClusteringAtZoom;
}

/**
 * Met à jour dynamiquement la distance de clustering en fonction du zoom
 * Plus on zoom, plus la distance diminue
 */
export function getAdaptiveClusterDistance(zoom: number): number {
    if (zoom < 8) {
        return 80; // Distance élevée pour les zooms éloignés
    } else if (zoom < 12) {
        return 50; // Distance moyenne
    } else if (zoom < 15) {
        return 30; // Distance réduite
    } else {
        return 0; // Pas de clustering aux zooms proches
    }
}

/**
 * Calcule les statistiques d'un cluster
 */
export function getClusterStats(cluster: Feature): {
    count: number;
    foundCount: number;
    types: Map<string, number>;
} {
    const features = cluster.get('features') as Feature<Point>[];
    
    const stats = {
        count: features.length,
        foundCount: 0,
        types: new Map<string, number>()
    };

    for (const feature of features) {
        const props = feature.getProperties();
        
        if (props.found) {
            stats.foundCount++;
        }

        const cacheType = props.cache_type || 'Unknown';
        stats.types.set(cacheType, (stats.types.get(cacheType) || 0) + 1);
    }

    return stats;
}

/**
 * Extrait toutes les features d'un cluster
 */
export function getFeaturesFromCluster(cluster: Feature): Feature<Point>[] {
    return cluster.get('features') as Feature<Point>[] || [];
}

