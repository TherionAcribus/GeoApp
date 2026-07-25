/**
 * Service de géocodage (recherche textuelle d'adresses / lieux) pour la carte.
 *
 * Deux fournisseurs sont supportés :
 *  - Photon (photon.komoot.io) : gratuit, sans clé API, utilisé par défaut.
 *  - Geoapify (api.geoapify.com) : plus performant mais nécessite une clé API.
 *
 * Les deux APIs supportent CORS et sont donc appelées directement depuis le
 * navigateur (frontend), sans passer par le backend Flask.
 */

export type GeocodingProviderId = 'photon' | 'geoapify';

/** Un résultat de recherche géocodé. */
export interface GeocodingResult {
    /** Libellé lisible de l'adresse / du lieu. */
    label: string;
    latitude: number;
    longitude: number;
    /** Fournisseur ayant produit ce résultat. */
    provider: GeocodingProviderId;
    /** Étendue optionnelle [minLon, minLat, maxLon, maxLat] (WGS84). */
    bbox?: [number, number, number, number];
}

/** Configuration de géocodage, dérivée des préférences GeoApp. */
export interface GeocodingConfig {
    provider: GeocodingProviderId;
    geoapifyApiKey: string;
    autoFallback: boolean;
    /** Langue préférée pour les résultats (ex. "fr"). */
    lang?: string;
    /** Nombre maximal de résultats. */
    limit?: number;
}

/** Résultat global d'une recherche, incluant les métadonnées de fournisseur. */
export interface GeocodingOutcome {
    results: GeocodingResult[];
    /** Fournisseur ayant effectivement répondu. */
    usedProvider: GeocodingProviderId;
    /** true si le fournisseur principal a échoué et qu'un secours a été utilisé. */
    fellBack: boolean;
    /** Message d'erreur du fournisseur principal, si une bascule a eu lieu. */
    primaryError?: string;
}

/** Erreur de géocodage (réseau, HTTP, requête invalide). */
export class GeocodingError extends Error {
    constructor(
        message: string,
        readonly provider?: GeocodingProviderId,
        readonly cause?: unknown
    ) {
        super(message);
        this.name = 'GeocodingError';
    }
}

const DEFAULT_LIMIT = 6;
const REQUEST_TIMEOUT_MS = 12000;

/** Langues supportées par Photon (les autres retombent sur le défaut anglais). */
const PHOTON_SUPPORTED_LANGS = new Set(['de', 'en', 'fr']);

export const GEOCODING_PROVIDER_LABELS: Record<GeocodingProviderId, string> = {
    photon: 'Photon',
    geoapify: 'Geoapify'
};

/** Indique si une clé Geoapify utilisable est renseignée. */
export function hasGeoapifyKey(config: Pick<GeocodingConfig, 'geoapifyApiKey'>): boolean {
    return Boolean(config.geoapifyApiKey && config.geoapifyApiKey.trim());
}

/**
 * Détermine l'ordre des fournisseurs à essayer selon la configuration.
 * - Si "geoapify" est demandé sans clé valide, on retombe sur "photon".
 * - Si le fallback est actif, on ajoute l'autre fournisseur (Geoapify uniquement
 *   si une clé valide est disponible).
 */
export function resolveProviderChain(config: GeocodingConfig): GeocodingProviderId[] {
    const geoapifyUsable = hasGeoapifyKey(config);

    let primary: GeocodingProviderId = config.provider;
    if (primary === 'geoapify' && !geoapifyUsable) {
        primary = 'photon';
    }

    const chain: GeocodingProviderId[] = [primary];

    if (config.autoFallback) {
        const other: GeocodingProviderId = primary === 'photon' ? 'geoapify' : 'photon';
        const otherUsable = other === 'geoapify' ? geoapifyUsable : true;
        if (otherUsable) {
            chain.push(other);
        }
    }

    return chain;
}

/**
 * Recherche une adresse / un lieu. Essaie les fournisseurs dans l'ordre déterminé
 * par la configuration, avec bascule automatique en cas d'échec (erreur réseau /
 * HTTP). Une réponse valide mais vide (aucun résultat) n'est PAS considérée comme
 * un échec et ne déclenche pas de bascule.
 *
 * @throws GeocodingError si tous les fournisseurs échouent, ou si la requête est vide.
 */
export async function geocodeAddress(query: string, config: GeocodingConfig): Promise<GeocodingOutcome> {
    const trimmed = query.trim();
    if (!trimmed) {
        throw new GeocodingError('La recherche est vide.');
    }

    const chain = resolveProviderChain(config);
    let primaryError: string | undefined;

    for (let i = 0; i < chain.length; i++) {
        const provider = chain[i];
        try {
            const results = await queryProvider(provider, trimmed, config);
            return {
                results,
                usedProvider: provider,
                fellBack: i > 0,
                primaryError
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (i === 0) {
                primaryError = message;
            }
            const isLast = i === chain.length - 1;
            if (isLast) {
                throw new GeocodingError(message, provider, error);
            }
            // Sinon : on tente le fournisseur suivant.
        }
    }

    // Ne devrait jamais arriver : chain contient toujours au moins un fournisseur.
    throw new GeocodingError('Aucun fournisseur de recherche disponible.');
}

function queryProvider(
    provider: GeocodingProviderId,
    query: string,
    config: GeocodingConfig
): Promise<GeocodingResult[]> {
    switch (provider) {
        case 'geoapify':
            return geocodeGeoapify(query, config);
        case 'photon':
        default:
            return geocodePhoton(query, config);
    }
}

async function fetchJson(url: string, provider: GeocodingProviderId): Promise<any> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let response: Response;
    try {
        response = await fetch(url, {
            method: 'GET',
            headers: { Accept: 'application/json' },
            signal: controller.signal
        });
    } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
            throw new GeocodingError('Délai de recherche dépassé.', provider, error);
        }
        throw new GeocodingError('Impossible de contacter le service de recherche (réseau).', provider, error);
    } finally {
        clearTimeout(timeout);
    }

    if (!response.ok) {
        const detail = response.status === 401 || response.status === 403
            ? ' (clé API invalide ou quota dépassé)'
            : '';
        throw new GeocodingError(`Le service de recherche a répondu ${response.status}${detail}.`, provider);
    }

    try {
        return await response.json();
    } catch (error) {
        throw new GeocodingError('Réponse du service de recherche illisible.', provider, error);
    }
}

// --- Photon ---------------------------------------------------------------

async function geocodePhoton(query: string, config: GeocodingConfig): Promise<GeocodingResult[]> {
    const limit = config.limit ?? DEFAULT_LIMIT;
    const params = new URLSearchParams({
        q: query,
        limit: String(limit)
    });

    const lang = normalizeLang(config.lang);
    if (lang && PHOTON_SUPPORTED_LANGS.has(lang)) {
        params.set('lang', lang);
    }

    const data = await fetchJson(`https://photon.komoot.io/api/?${params.toString()}`, 'photon');
    const features: any[] = Array.isArray(data?.features) ? data.features : [];

    return features
        .map(feature => photonFeatureToResult(feature))
        .filter((result): result is GeocodingResult => result !== undefined);
}

function photonFeatureToResult(feature: any): GeocodingResult | undefined {
    const coords = feature?.geometry?.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) {
        return undefined;
    }
    const longitude = Number(coords[0]);
    const latitude = Number(coords[1]);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        return undefined;
    }

    return {
        label: buildPhotonLabel(feature?.properties ?? {}),
        latitude,
        longitude,
        provider: 'photon',
        bbox: parseBbox(feature?.properties?.extent, 'photon')
    };
}

/**
 * Compose un libellé lisible à partir des propriétés Photon (qui ne fournit pas
 * de champ "formatted"). Ordre : nom, rue, code postal + ville, région, pays.
 */
function buildPhotonLabel(props: Record<string, any>): string {
    const parts: string[] = [];
    const name: string | undefined = props.name;

    if (name) {
        parts.push(name);
    }

    const street = props.street
        ? (props.housenumber ? `${props.housenumber} ${props.street}` : props.street)
        : undefined;
    if (street && street !== name) {
        parts.push(street);
    }

    const cityLine = [props.postcode, props.city].filter(Boolean).join(' ');
    if (cityLine) {
        parts.push(cityLine);
    }

    if (props.state && props.state !== props.city) {
        parts.push(props.state);
    }
    if (props.country) {
        parts.push(props.country);
    }

    return parts.filter(Boolean).join(', ') || 'Résultat sans nom';
}

// --- Geoapify -------------------------------------------------------------

async function geocodeGeoapify(query: string, config: GeocodingConfig): Promise<GeocodingResult[]> {
    if (!hasGeoapifyKey(config)) {
        throw new GeocodingError('Aucune clé API Geoapify n\'est configurée.', 'geoapify');
    }

    const limit = config.limit ?? DEFAULT_LIMIT;
    const params = new URLSearchParams({
        text: query,
        limit: String(limit),
        format: 'geojson',
        apiKey: config.geoapifyApiKey.trim()
    });

    const lang = normalizeLang(config.lang);
    if (lang) {
        params.set('lang', lang);
    }

    const data = await fetchJson(`https://api.geoapify.com/v1/geocode/search?${params.toString()}`, 'geoapify');
    const features: any[] = Array.isArray(data?.features) ? data.features : [];

    return features
        .map(feature => geoapifyFeatureToResult(feature))
        .filter((result): result is GeocodingResult => result !== undefined);
}

function geoapifyFeatureToResult(feature: any): GeocodingResult | undefined {
    const props = feature?.properties ?? {};
    const coords = feature?.geometry?.coordinates;

    let longitude = Number(props.lon);
    let latitude = Number(props.lat);
    if ((!Number.isFinite(latitude) || !Number.isFinite(longitude)) && Array.isArray(coords) && coords.length >= 2) {
        longitude = Number(coords[0]);
        latitude = Number(coords[1]);
    }
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        return undefined;
    }

    return {
        label: props.formatted || props.address_line1 || props.name || 'Résultat sans nom',
        latitude,
        longitude,
        provider: 'geoapify',
        bbox: parseBbox(props.bbox, 'geoapify')
    };
}

// --- Helpers --------------------------------------------------------------

function normalizeLang(lang?: string): string | undefined {
    if (!lang) {
        return undefined;
    }
    const base = lang.toLowerCase().split(/[-_]/)[0];
    return base || undefined;
}

/**
 * Normalise une bbox provenant de Photon (`extent` = [minLon, maxLat, maxLon, minLat])
 * ou de Geoapify (`bbox` = { lon1, lat1, lon2, lat2 } ou [minLon, minLat, maxLon, maxLat]).
 */
function parseBbox(raw: any, provider: GeocodingProviderId): [number, number, number, number] | undefined {
    if (!raw) {
        return undefined;
    }

    let minLon: number;
    let minLat: number;
    let maxLon: number;
    let maxLat: number;

    if (Array.isArray(raw) && raw.length >= 4) {
        if (provider === 'photon') {
            // Photon extent : [minLon, maxLat, maxLon, minLat]
            minLon = Number(raw[0]);
            maxLat = Number(raw[1]);
            maxLon = Number(raw[2]);
            minLat = Number(raw[3]);
        } else {
            // Convention GeoJSON : [minLon, minLat, maxLon, maxLat]
            minLon = Number(raw[0]);
            minLat = Number(raw[1]);
            maxLon = Number(raw[2]);
            maxLat = Number(raw[3]);
        }
    } else if (typeof raw === 'object') {
        minLon = Number(raw.lon1);
        minLat = Number(raw.lat1);
        maxLon = Number(raw.lon2);
        maxLat = Number(raw.lat2);
    } else {
        return undefined;
    }

    const values = [minLon, minLat, maxLon, maxLat];
    if (values.some(value => !Number.isFinite(value))) {
        return undefined;
    }

    return [
        Math.min(minLon, maxLon),
        Math.min(minLat, maxLat),
        Math.max(minLon, maxLon),
        Math.max(minLat, maxLat)
    ];
}
