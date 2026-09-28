export const GEOAPP_LOCAL_MODEL_IDS_PREF = 'geoApp.ai.localModelIds';

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

export interface GeoAppLocalEndpointCheck {
    status: GeoAppLocalModelStatus;
    host?: string;
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

export function checkGeoAppLocalEndpoint(value: unknown): GeoAppLocalEndpointCheck {
    return inspectLocalEndpoint(value);
}

function inspectLocalEndpoint(value: unknown): GeoAppLocalEndpointCheck {
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
    return isLocalIpv6(hostname);
}

function isPrivateIpv4(hostname: string): boolean {
    const numbers = parseIpv4(hostname);
    if (!numbers) {
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

function parseIpv4(value: string): number[] | undefined {
    const parts = value.split('.');
    if (parts.length !== 4 || parts.some(part => !/^\d{1,3}$/.test(part))) {
        return undefined;
    }
    const numbers = parts.map(Number);
    return numbers.some(part => part < 0 || part > 255) ? undefined : numbers;
}

function isLocalIpv6(hostname: string): boolean {
    const groups = parseIpv6Groups(hostname.split('%')[0]);
    if (!groups) {
        return false;
    }

    const isLoopback = groups.slice(0, 7).every(group => group === 0) && groups[7] === 1;
    const isIpv4Mapped = groups.slice(0, 5).every(group => group === 0) && groups[5] === 0xffff;
    if (isLoopback) {
        return true;
    }
    if (isIpv4Mapped) {
        return isPrivateIpv4([
            groups[6] >> 8,
            groups[6] & 0xff,
            groups[7] >> 8,
            groups[7] & 0xff,
        ].join('.'));
    }
    return (groups[0] >= 0xfc00 && groups[0] <= 0xfdff)
        || (groups[0] >= 0xfe80 && groups[0] <= 0xfebf);
}

function parseIpv6Groups(value: string): number[] | undefined {
    const hasCompression = value.includes('::');
    if (!value.includes(':') || value.split('::').length > 2) {
        return undefined;
    }

    const [left, right] = hasCompression ? value.split('::') : [value, ''];
    const leftGroups = parseIpv6Side(left);
    const rightGroups = parseIpv6Side(right);
    if (!leftGroups || !rightGroups) {
        return undefined;
    }

    const groups = [...leftGroups, ...rightGroups];
    if (!hasCompression) {
        return groups.length === 8 ? groups : undefined;
    }
    if (groups.length >= 8) {
        return undefined;
    }
    return [
        ...leftGroups,
        ...new Array<number>(8 - groups.length).fill(0),
        ...rightGroups,
    ];
}

function parseIpv6Side(value: string): number[] | undefined {
    if (value === '') {
        return [];
    }
    const parts = value.split(':');
    if (parts.some(part => !part)) {
        return undefined;
    }

    const groups: number[] = [];
    for (const [index, part] of parts.entries()) {
        if (/^[0-9a-f]{1,4}$/i.test(part)) {
            groups.push(Number.parseInt(part, 16));
            continue;
        }
        const ipv4 = index === parts.length - 1 ? parseIpv4(part) : undefined;
        if (!ipv4) {
            return undefined;
        }
        groups.push((ipv4[0] << 8) | ipv4[1], (ipv4[2] << 8) | ipv4[3]);
    }
    return groups;
}

export function isGeoAppStrictLocalAgent(agentId: string | undefined): boolean {
    const id = normalizeIdentifier(agentId);
    return id === 'geoapp-chat-local' || id === 'geoapp-formula-solver-local';
}

function normalizeIdentifier(value: unknown): string {
    return typeof value === 'string' ? value.trim().toLowerCase() : '';
}
