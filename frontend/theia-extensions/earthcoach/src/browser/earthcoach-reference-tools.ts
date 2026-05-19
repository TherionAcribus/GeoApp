import { injectable, inject } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import {
    ToolInvocationRegistry,
    ToolRequest,
    ToolRequestParameters,
} from '@theia/ai-core';
import { PreferenceService } from '@theia/core/lib/common/preferences/preference-service';
import {
    EARTHCOACH_REFERENCES_ALLOWED_SOURCES_PREF,
    EARTHCOACH_REFERENCES_LANGUAGE_PREF,
    EARTHCOACH_REFERENCES_MAX_ARTICLES_PREF,
    EARTHCOACH_REFERENCES_MAX_IMAGES_PREF,
    EARTHCOACH_REFERENCES_WEB_ENABLED_PREF,
} from './earthcoach-preferences';

const PROVIDER_NAME = 'geoapp.earthcoach';
const REFERENCE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_ALLOWED_SOURCES = 'wikipedia,wikimedia';
type EarthCoachReferenceSource = 'wikipedia' | 'wikimedia';

function ok(data: unknown): string {
    return JSON.stringify({ success: true, data });
}

function err(message: string): string {
    return JSON.stringify({ success: false, error: message });
}

function buildParams(
    props: Record<string, { type: string; description: string; required?: boolean; enum?: string[] }>
): ToolRequestParameters {
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const [key, value] of Object.entries(props)) {
        const { required: isRequired, ...rest } = value;
        properties[key] = rest;
        if (isRequired) {
            required.push(key);
        }
    }
    return { type: 'object', properties, required, additionalProperties: false } as ToolRequestParameters;
}

function parseArgs(argString: string): Record<string, unknown> {
    try {
        return JSON.parse(argString || '{}') as Record<string, unknown>;
    } catch {
        return {};
    }
}

interface WikipediaSearchPage {
    pageid: number;
    title: string;
    extract?: string;
    fullurl?: string;
    thumbnail?: {
        source?: string;
    };
}

interface WikimediaImagePage {
    pageid: number;
    title: string;
    imageinfo?: Array<{
        url?: string;
        thumburl?: string;
        descriptionurl?: string;
        extmetadata?: {
            ImageDescription?: { value?: string };
            ObjectName?: { value?: string };
            Artist?: { value?: string };
            LicenseShortName?: { value?: string };
        };
    }>;
}

export interface EarthCoachReferenceArticle {
    title: string;
    summary?: string;
    url?: string;
    thumbnailUrl?: string;
    origin: 'educational_reference';
    source: string;
}

export interface EarthCoachReferenceImage {
    id: string;
    title: string;
    imageUrl?: string;
    thumbnailUrl?: string;
    pageUrl?: string;
    description?: string;
    license?: string;
    origin: 'educational_reference';
    source: 'Wikimedia Commons';
}

export interface EarthCoachReferenceSearchResult {
    query: string;
    language: 'fr' | 'en';
    origin: 'educational_reference';
    articles: EarthCoachReferenceArticle[];
    images: EarthCoachReferenceImage[];
    allowed_sources: EarthCoachReferenceSource[];
    from_cache?: boolean;
    usage_rule: string;
}

interface ReferenceCacheEntry {
    createdAt: number;
    result: EarthCoachReferenceSearchResult;
}

@injectable()
export class EarthCoachReferenceTools implements FrontendApplicationContribution {

    static readonly SEARCH_REFERENCE_TOOL_ID = 'earthcoach.search_reference';

    @inject(ToolInvocationRegistry)
    protected readonly toolRegistry!: ToolInvocationRegistry;

    @inject(PreferenceService)
    protected readonly preferenceService!: PreferenceService;

    protected readonly referenceCache = new Map<string, ReferenceCacheEntry>();

    async onStart(): Promise<void> {
        try {
            await this.toolRegistry.registerTool(this.createSearchReferenceTool());
        } catch (error) {
            console.warn('[EarthCoach] Could not register reference tool', error);
        }
    }

    buildAllTools(): ToolRequest[] {
        return [this.createSearchReferenceTool()];
    }

    protected createSearchReferenceTool(): ToolRequest {
        return {
            id: EarthCoachReferenceTools.SEARCH_REFERENCE_TOOL_ID,
            name: 'earthcoach_search_reference',
            description: 'Recherche des references pedagogiques externes autorisees par les preferences EarthCoach pour expliquer un terme geologique. Retourne des sources et images educational_reference; ne retourne jamais une observation de terrain.',
            providerName: PROVIDER_NAME,
            parameters: buildParams({
                query: {
                    type: 'string',
                    description: 'Terme ou notion geologique a rechercher, par exemple "calcaire coquillier", "faille normale", "basalte".',
                    required: true,
                },
                language: {
                    type: 'string',
                    description: 'Langue Wikipedia a utiliser. Valeurs conseillees: "fr" ou "en". Defaut: "fr".',
                    required: false,
                    enum: ['fr', 'en'],
                },
                include_images: {
                    type: 'boolean',
                    description: 'Inclure des images pedagogiques Wikimedia Commons. Defaut: true.',
                    required: false,
                },
                max_images: {
                    type: 'number',
                    description: 'Nombre maximal d images a retourner. Defaut: preference EarthCoach.',
                    required: false,
                },
            }),
            handler: async (argString: string) => {
                const args = parseArgs(argString);
                const query = String(args.query || '').trim();
                if (!query) {
                    return err('query is required');
                }
                try {
                    return ok(await this.searchReference({
                        query,
                        language: args.language === 'en' ? 'en' : args.language === 'fr' ? 'fr' : undefined,
                        includeImages: args.include_images !== false,
                        maxImages: this.toNumber(args.max_images),
                    }));
                } catch (error: any) {
                    return err(error?.message || String(error));
                }
            },
        };
    }

    async searchReference(options: {
        query: string;
        language?: 'fr' | 'en';
        includeImages?: boolean;
        maxArticles?: number;
        maxImages?: number;
    }): Promise<EarthCoachReferenceSearchResult> {
        if (!this.preferenceService.get(EARTHCOACH_REFERENCES_WEB_ENABLED_PREF, true)) {
            throw new Error('La recherche web EarthCoach est desactivee dans les preferences.');
        }

        const query = options.query.trim();
        if (!query) {
            throw new Error('query is required');
        }

        const language = options.language || this.getDefaultLanguage();
        const maxArticles = this.clampNumber(options.maxArticles ?? this.preferenceService.get(EARTHCOACH_REFERENCES_MAX_ARTICLES_PREF, 3), 1, 8);
        const maxImages = this.clampNumber(options.maxImages ?? this.preferenceService.get(EARTHCOACH_REFERENCES_MAX_IMAGES_PREF, 5), 0, 12);
        const allowedSources = this.getAllowedSources();
        if (!allowedSources.length) {
            throw new Error('Aucune source EarthCoach autorisee dans les preferences.');
        }
        const includeArticles = allowedSources.includes('wikipedia');
        const includeImages = options.includeImages !== false && maxImages > 0 && allowedSources.includes('wikimedia');
        const cacheKey = this.buildCacheKey(query, language, maxArticles, maxImages, includeImages, allowedSources);
        const cached = this.getCachedResult(cacheKey);
        if (cached) {
            return cached;
        }
        const [articles, images] = await Promise.all([
            includeArticles ? this.searchWikipedia(query, language, maxArticles) : Promise.resolve([]),
            includeImages ? this.searchCommonsImages(query, maxImages) : Promise.resolve([]),
        ]);
        const result: EarthCoachReferenceSearchResult = {
            query,
            language,
            origin: 'educational_reference',
            articles,
            images,
            allowed_sources: allowedSources,
            from_cache: false,
            usage_rule: 'Ces resultats sont des references pedagogiques externes. Ne les presente jamais comme une observation utilisateur ni comme une image du listing.',
        };
        this.referenceCache.set(cacheKey, {
            createdAt: Date.now(),
            result: this.cloneResult(result),
        });
        return result;
    }

    protected async searchWikipedia(query: string, language: 'fr' | 'en', limit: number): Promise<EarthCoachReferenceArticle[]> {
        const endpoint = `https://${language}.wikipedia.org/w/api.php`;
        const params = new URLSearchParams({
            action: 'query',
            generator: 'search',
            gsrsearch: query,
            gsrlimit: String(limit),
            prop: 'extracts|info|pageimages',
            exintro: '1',
            explaintext: '1',
            exsentences: '3',
            inprop: 'url',
            piprop: 'thumbnail',
            pithumbsize: '640',
            redirects: '1',
            format: 'json',
            origin: '*',
        });
        const response = await fetch(`${endpoint}?${params.toString()}`);
        if (!response.ok) {
            throw new Error(`Wikipedia HTTP ${response.status}`);
        }
        const payload = await response.json() as { query?: { pages?: Record<string, WikipediaSearchPage> } };
        return Object.values(payload.query?.pages || {})
            .sort((left, right) => left.pageid - right.pageid)
            .map(page => ({
                title: page.title,
                summary: page.extract,
                url: page.fullurl,
                thumbnailUrl: page.thumbnail?.source,
                origin: 'educational_reference' as const,
                source: `Wikipedia ${language}`,
            }));
    }

    protected async searchCommonsImages(query: string, limit: number): Promise<EarthCoachReferenceImage[]> {
        const params = new URLSearchParams({
            action: 'query',
            generator: 'search',
            gsrsearch: query,
            gsrnamespace: '6',
            gsrlimit: String(limit),
            prop: 'imageinfo',
            iiprop: 'url|extmetadata',
            iiurlwidth: '640',
            format: 'json',
            origin: '*',
        });
        const response = await fetch(`https://commons.wikimedia.org/w/api.php?${params.toString()}`);
        if (!response.ok) {
            throw new Error(`Wikimedia Commons HTTP ${response.status}`);
        }
        const payload = await response.json() as { query?: { pages?: Record<string, WikimediaImagePage> } };
        return Object.values(payload.query?.pages || {})
            .map(page => {
                const info = page.imageinfo?.[0];
                const title = this.cleanCommonsTitle(page.title);
                return {
                    id: String(page.pageid),
                    title,
                    imageUrl: info?.url,
                    thumbnailUrl: info?.thumburl || info?.url,
                    pageUrl: info?.descriptionurl,
                    description: this.cleanHtml(info?.extmetadata?.ImageDescription?.value || info?.extmetadata?.ObjectName?.value),
                    license: info?.extmetadata?.LicenseShortName?.value,
                    origin: 'educational_reference' as const,
                    source: 'Wikimedia Commons' as const,
                };
            })
            .filter(image => Boolean(image.thumbnailUrl || image.imageUrl));
    }

    protected cleanCommonsTitle(title: string): string {
        return title.replace(/^File:/, '').replace(/^Fichier:/, '').replace(/_/g, ' ');
    }

    protected cleanHtml(value?: string): string | undefined {
        const text = (value || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        return text || undefined;
    }

    protected getDefaultLanguage(): 'fr' | 'en' {
        return String(this.preferenceService.get(EARTHCOACH_REFERENCES_LANGUAGE_PREF, 'fr')) === 'en' ? 'en' : 'fr';
    }

    protected getAllowedSources(): EarthCoachReferenceSource[] {
        const raw = String(this.preferenceService.get(EARTHCOACH_REFERENCES_ALLOWED_SOURCES_PREF, DEFAULT_ALLOWED_SOURCES));
        const values = raw
            .split(',')
            .map(value => value.trim().toLowerCase())
            .filter(Boolean);
        const allowed = new Set<EarthCoachReferenceSource>();
        for (const value of values) {
            if (value === 'wikipedia' || value === 'wikimedia') {
                allowed.add(value);
            }
        }
        return [...allowed].sort();
    }

    protected buildCacheKey(
        query: string,
        language: 'fr' | 'en',
        maxArticles: number,
        maxImages: number,
        includeImages: boolean,
        allowedSources: EarthCoachReferenceSource[]
    ): string {
        return JSON.stringify({
            query: query.trim().toLowerCase(),
            language,
            maxArticles,
            maxImages,
            includeImages,
            allowedSources: [...allowedSources].sort(),
        });
    }

    protected getCachedResult(cacheKey: string): EarthCoachReferenceSearchResult | undefined {
        const entry = this.referenceCache.get(cacheKey);
        if (!entry) {
            return undefined;
        }
        if (Date.now() - entry.createdAt > REFERENCE_CACHE_TTL_MS) {
            this.referenceCache.delete(cacheKey);
            return undefined;
        }
        const result = this.cloneResult(entry.result);
        result.from_cache = true;
        return result;
    }

    protected cloneResult(result: EarthCoachReferenceSearchResult): EarthCoachReferenceSearchResult {
        return JSON.parse(JSON.stringify(result)) as EarthCoachReferenceSearchResult;
    }

    protected toNumber(value: unknown): number | undefined {
        if (typeof value === 'number' && Number.isFinite(value)) {
            return value;
        }
        if (typeof value === 'string' && value.trim()) {
            const parsed = Number(value);
            return Number.isFinite(parsed) ? parsed : undefined;
        }
        return undefined;
    }

    protected clampNumber(value: unknown, min: number, max: number): number {
        const parsed = this.toNumber(value);
        if (parsed === undefined) {
            return min;
        }
        return Math.max(min, Math.min(max, Math.round(parsed)));
    }
}
