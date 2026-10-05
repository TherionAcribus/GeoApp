/**
 * Définitions des colonnes du tableau des géocaches : ids, libellés, colonnes
 * visibles par défaut et normalisation de la préférence
 * `geoApp.geocaches.table.visibleColumns`.
 *
 * Isolées de `geocaches-table.tsx` (qui importe React, TanStack et du CSS)
 * pour être réutilisables par des modules non-UI — stores de persistance,
 * tools IA (`doc-action-tools.ts`).
 */

export type GeocachesTableColumnId =
    | 'gc_code'
    | 'name'
    | 'cache_type'
    | 'difficulty'
    | 'terrain'
    | 'size'
    | 'solved'
    | 'found'
    | 'placed_at'
    | 'has_notes'
    | 'created_at'
    | 'found_date'
    | 'coordinates'
    | 'is_corrected'
    | 'waypoints_count'
    | 'favorites_count'
    | 'favorites_percent'
    | 'owner'
    | 'finds_count'
    // `friends_found` n'apparaît pas dans GEOCACHES_TABLE_COLUMN_DEFINITIONS : la
    // colonne « 👥 » est pilotée par le mode sortie, pas par le menu Colonnes. Elle
    // garde son identifiant parce qu'elle reste une colonne du tableau — et parce
    // que des préférences enregistrées la contiennent encore (elles sont ignorées).
    | 'friends_found'
    | 'outing_flags'
    | 'status'
    | 'need_maintenance'
    | 'distance'
    | 'zone_name';

export interface GeocachesTableColumnDefinition {
    id: GeocachesTableColumnId;
    label: string;
    description: string;
}

export const DEFAULT_GEOCACHES_TABLE_VISIBLE_COLUMNS: GeocachesTableColumnId[] = [
    'gc_code',
    'name',
    'cache_type',
    'difficulty',
    'terrain',
    'size',
    'solved',
    'found',
    'favorites_count',
    'owner',
];

export const GEOCACHES_TABLE_COLUMN_DEFINITIONS: GeocachesTableColumnDefinition[] = [
    { id: 'gc_code', label: 'Code GC', description: 'Identifiant public de la cache.' },
    { id: 'name', label: 'Nom', description: 'Nom de la cache.' },
    { id: 'cache_type', label: 'Type', description: 'Type de cache avec icône.' },
    { id: 'difficulty', label: 'D', description: 'Difficulté.' },
    { id: 'terrain', label: 'T', description: 'Terrain.' },
    { id: 'size', label: 'Taille', description: 'Taille du contenant.' },
    { id: 'solved', label: 'Résolution', description: 'État de résolution pour Mystery, Unknown et Letterbox.' },
    { id: 'found', label: 'Trouvée', description: 'Indique si la cache a été trouvée.' },
    { id: 'placed_at', label: 'Posée le', description: 'Date de pose de la cache.' },
    { id: 'has_notes', label: 'Notes', description: 'Présence de notes locales ou personnelles.' },
    { id: 'created_at', label: 'Ajoutée le', description: "Date d'ajout dans GeoApp." },
    { id: 'found_date', label: 'Découverte le', description: 'Date de découverte connue.' },
    { id: 'coordinates', label: 'Coordonnées', description: 'Coordonnées affichées ou décimales.' },
    { id: 'is_corrected', label: 'Corrigée', description: 'Indique si les coordonnées sont corrigées.' },
    { id: 'waypoints_count', label: 'Waypoints', description: 'Nombre de waypoints associes.' },
    { id: 'favorites_count', label: 'Favoris', description: 'Nombre de points favoris.' },
    { id: 'favorites_percent', label: '%PF', description: 'Part des trouvailles qui ont donné un point favori.' },
    { id: 'owner', label: 'Propriétaire', description: 'Propriétaire de la cache.' },
    // Remplace l'ancienne colonne `logs_count`, qui annonçait « Logs » mais ne
    // comptait que les logs chargés dans GeoApp. Les préférences enregistrées qui
    // la contiennent encore sont ignorées — l'identifiant n'existe plus.
    { id: 'finds_count', label: 'Trouvailles', description: 'Nombre de Found it annoncé par Geocaching.com.' },
    { id: 'outing_flags', label: 'Sortie', description: "Signaux de la dernière analyse IA de sortie (matériel, santé, bloquant)." },
    { id: 'status', label: 'Statut', description: 'Statut de la cache sur Geocaching.com (active, désactivée, archivée).' },
    { id: 'need_maintenance', label: 'Maintenance', description: 'Indique si le propriétaire a demandé une attention particulière (Need Maintenance).' },
    { id: 'distance', label: 'Distance', description: "Distance à vol d'oiseau depuis l'origine des distances (clic droit sur une ligne pour la définir)." },
    { id: 'zone_name', label: 'Zone', description: "Zone où la cache est rangée (utile dans le tableau d'un dossier)." },
];

export const ALL_GEOCACHES_TABLE_COLUMN_IDS = GEOCACHES_TABLE_COLUMN_DEFINITIONS.map(def => def.id);

export const GEOCACHES_TABLE_COLUMN_DEFINITION_BY_ID = new Map<GeocachesTableColumnId, GeocachesTableColumnDefinition>(
    GEOCACHES_TABLE_COLUMN_DEFINITIONS.map(def => [def.id, def])
);

/**
 * Normalise une valeur de `geoApp.geocaches.table.visibleColumns` : ids inconnus
 * et doublons ignorés ; liste vide ou illisible → colonnes par défaut.
 */
export function normalizeGeocachesTableVisibleColumnIds(raw: unknown): GeocachesTableColumnId[] {
    if (!Array.isArray(raw)) {
        return [...DEFAULT_GEOCACHES_TABLE_VISIBLE_COLUMNS];
    }
    const valid = new Set<GeocachesTableColumnId>(ALL_GEOCACHES_TABLE_COLUMN_IDS);
    const normalized: GeocachesTableColumnId[] = [];
    for (const value of raw) {
        if (typeof value === 'string' && valid.has(value as GeocachesTableColumnId) && !normalized.includes(value as GeocachesTableColumnId)) {
            normalized.push(value as GeocachesTableColumnId);
        }
    }
    return normalized.length > 0 ? normalized : [...DEFAULT_GEOCACHES_TABLE_VISIBLE_COLUMNS];
}
