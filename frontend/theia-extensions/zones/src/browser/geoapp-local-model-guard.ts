export interface GeoAppLocalModelLike {
    id: string;
    vendor?: string;
}

export interface GeoAppOpenAiCompatibleModelPreference {
    id?: string;
    model?: string;
    url?: string;
    provider?: string;
    deployment?: string;
    apiVersion?: string | boolean;
    useResponseApi?: boolean;
}

export interface GeoAppLocalModelPreferences {
    ollamaHost?: string;
    lmstudioBaseUrl?: string;
    openAiCustomModels?: unknown;
    vercelCustomModels?: unknown;
    localModelIds?: unknown;
}

export type GeoAppLocalModelStatus = 'local' | 'remote' | 'unknown';

export interface GeoAppLocalModelCheck {
    status: GeoAppLocalModelStatus;
    modelId: string;
    host?: string;
    source:
        | 'cloud-model-id'
        | 'local-model-allowlist'
        | 'openai-compatible-endpoint'
        | 'ollama-endpoint'
        | 'lmstudio-endpoint'
        | 'unknown';
    reason: string;
}

const KNOWN_CLOUD_MODEL_PREFIXES = [
    'openrouter/',
    'openai/',
    'anthropic/',
    'google/',
    'gemini/',
    'azure/',
    'codex/',
    'huggingface/',
    'vercel/openai/',
    'vercel/anthropic/',
    'vercel/google/',
];

export function checkGeoAppLocalModel(
    model: GeoAppLocalModelLike | undefined,
    preferences: GeoAppLocalModelPreferences = {}
): GeoAppLocalModelCheck {
    const modelId = normalizeIdentifier(model?.id);
    if (!modelId) {
        return {
            status: 'unknown',
            modelId: '',
            source: 'unknown',
            reason: 'aucun modèle résolu',
        };
    }

    if (hasKnownCloudModelPrefix(modelId)) {
        return {
            status: 'remote',
            modelId,
            source: 'cloud-model-id',
            reason: `le modèle « ${modelId} » utilise un fournisseur cloud identifiable`,
        };
    }

    if (matchesModelAllowlist(modelId, preferences.localModelIds)) {
        return {
            status: 'local',
            modelId,
            source: 'local-model-allowlist',
            reason: `le modèle « ${modelId} » est explicitement déclaré local`,
        };
    }

    const customEndpoint = findOpenAiCompatibleEndpoint(
        modelId,
        preferences.openAiCustomModels,
        preferences.vercelCustomModels
    );
    if (customEndpoint) {
        const endpoint = inspectLocalEndpoint(customEndpoint);
        return {
            status: endpoint.status,
            modelId,
            host: endpoint.host,
            source: 'openai-compatible-endpoint',
            reason: endpoint.status === 'local'
                ? `le modèle « ${modelId} » pointe vers l’endpoint local « ${endpoint.host} »`
                : endpoint.status === 'remote'
                    ? `le modèle « ${modelId} » pointe vers l’hôte distant « ${endpoint.host} »`
                    : `l’endpoint du modèle « ${modelId} » n’est pas vérifiable comme local`,
        };
    }

    if (modelId.startsWith('ollama/') || normalizeIdentifier(model?.vendor) === 'ollama') {
        const endpoint = inspectLocalEndpoint(preferences.ollamaHost || 'http://localhost:11434');
        return {
            status: endpoint.status,
            modelId,
            host: endpoint.host,
            source: 'ollama-endpoint',
            reason: endpoint.status === 'local'
                ? `le modèle Ollama « ${modelId} » utilise l’hôte local « ${endpoint.host} »`
                : endpoint.status === 'remote'
                    ? `le modèle Ollama « ${modelId} » utilise l’hôte distant « ${endpoint.host} »`
                    : `l’hôte Ollama du modèle « ${modelId} » n’est pas vérifiable comme local`,
        };
    }

    if (modelId.startsWith('lmstudio/') || normalizeIdentifier(model?.vendor) === 'lmstudio') {
        const endpoint = inspectLocalEndpoint(preferences.lmstudioBaseUrl || 'http://localhost:1234');
        return {
            status: endpoint.status,
            modelId,
            host: endpoint.host,
            source: 'lmstudio-endpoint',
            reason: endpoint.status === 'local'
                ? `le modèle LM Studio « ${modelId} » utilise l’hôte local « ${endpoint.host} »`
                : endpoint.status === 'remote'
                    ? `le modèle LM Studio « ${modelId} » utilise l’hôte distant « ${endpoint.host} »`
                    : `l’hôte LM Studio du modèle « ${modelId} » n’est pas vérifiable comme local`,
        };
    }

    if (isKnownCloudVendor(model?.vendor)) {
        return {
            status: 'remote',
            modelId,
            source: 'cloud-model-id',
            reason: `le modèle « ${modelId} » utilise un fournisseur cloud identifiable`,
        };
    }

    return {
        status: 'unknown',
        modelId,
        source: 'unknown',
        reason: `le modèle « ${modelId} » n’est pas vérifiable comme local`,
    };
}

function hasKnownCloudModelPrefix(modelId: string): boolean {
    return KNOWN_CLOUD_MODEL_PREFIXES.some(prefix => modelId.startsWith(prefix));
}

function isKnownCloudVendor(vendor?: string): boolean {
    const normalizedVendor = normalizeIdentifier(vendor);
    return normalizedVendor === 'openrouter'
        || normalizedVendor === 'openai'
        || normalizedVendor === 'anthropic'
        || normalizedVendor === 'google'
        || normalizedVendor === 'gemini'
        || normalizedVendor === 'azure'
        || normalizedVendor === 'codex'
        || normalizedVendor === 'huggingface';
}

function findOpenAiCompatibleEndpoint(
    modelId: string,
    openAiCustomModels: unknown,
    vercelCustomModels: unknown
): string | undefined {
    for (const entry of toOpenAiCompatibleModels(openAiCustomModels)) {
        if (isOpenAiCompatibleEntry(entry) && entryIds(entry).includes(modelId)) {
            return entry.url;
        }
    }
    for (const entry of toOpenAiCompatibleModels(vercelCustomModels)) {
        if (isOpenAiCompatibleEntry(entry) && entryIds(entry).some(id => `vercel/${id}` === modelId)) {
            return entry.url;
        }
    }
    return undefined;
}

function toOpenAiCompatibleModels(value: unknown): GeoAppOpenAiCompatibleModelPreference[] {
    if (!Array.isArray(value)) {
        return [];
    }
    return value.filter((entry): entry is GeoAppOpenAiCompatibleModelPreference =>
        !!entry && typeof entry === 'object'
    );
}

function isOpenAiCompatibleEntry(entry: GeoAppOpenAiCompatibleModelPreference): boolean {
    return (!entry.provider || normalizeIdentifier(entry.provider) === 'openai')
        && !entry.deployment
        && !entry.apiVersion
        && !entry.useResponseApi;
}

function entryIds(entry: GeoAppOpenAiCompatibleModelPreference): string[] {
    return [entry.id, entry.model]
        .map(normalizeIdentifier)
        .filter(Boolean);
}

function matchesModelAllowlist(modelId: string, value: unknown): boolean {
    return toAllowlist(value).some(pattern =>
        pattern.endsWith('*')
            ? modelId.startsWith(pattern.slice(0, -1))
            : modelId === pattern
    );
}

function toAllowlist(value: unknown): string[] {
    const raw = Array.isArray(value)
        ? value
        : typeof value === 'string'
            ? value.split(/[\n,]/)
            : [];
    return raw
        .map(item => normalizeIdentifier(item))
        .filter(Boolean);
}

function inspectLocalEndpoint(value: unknown): { status: GeoAppLocalModelStatus; host?: string } {
    const raw = typeof value === 'string' ? value.trim() : '';
    if (!raw) {
        return { status: 'unknown' };
    }

    let url: URL;
    try {
        url = new URL(raw);
    } catch {
        return { status: 'unknown' };
    }

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        return { status: 'unknown', host: url.host };
    }

    const hostname = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
    return {
        status: isLocalHostname(hostname) ? 'local' : 'remote',
        host: url.host,
    };
}

function isLocalHostname(hostname: string): boolean {
    if (hostname === 'localhost'
        || hostname.endsWith('.localhost')
        || hostname === 'host.docker.internal'
        || hostname.endsWith('.local')) {
        return true;
    }
    if (isPrivateIpv4(hostname)) {
        return true;
    }
    return hostname === '::1'
        || hostname.startsWith('fc')
        || hostname.startsWith('fd')
        || hostname.startsWith('fe80');
}

function isPrivateIpv4(hostname: string): boolean {
    const parts = hostname.split('.');
    if (parts.length !== 4 || parts.some(part => !/^\d{1,3}$/.test(part))) {
        return false;
    }
    const numbers = parts.map(Number);
    if (numbers.some(part => part < 0 || part > 255)) {
        return false;
    }
    const [a, b] = numbers;
    return a === 0
        || a === 10
        || a === 127
        || (a === 169 && b === 254)
        || (a === 172 && b >= 16 && b <= 31)
        || (a === 192 && b === 168);
}

function normalizeIdentifier(value: unknown): string {
    return typeof value === 'string' ? value.trim().toLowerCase() : '';
}
