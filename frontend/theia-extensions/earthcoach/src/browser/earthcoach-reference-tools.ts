import { injectable, inject } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import {
    ToolInvocationRegistry,
    ToolRequest,
    ToolRequestParameters,
} from '@theia/ai-core';

const PROVIDER_NAME = 'geoapp.earthcoach';

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

@injectable()
export class EarthCoachReferenceTools implements FrontendApplicationContribution {

    static readonly SEARCH_REFERENCE_TOOL_ID = 'earthcoach.search_reference';

    @inject(ToolInvocationRegistry)
    protected readonly toolRegistry!: ToolInvocationRegistry;

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
            description: 'Recherche des references pedagogiques externes sur Wikipedia/Wikimedia Commons pour expliquer un terme geologique. Retourne des sources et images educational_reference; ne retourne jamais une observation de terrain.',
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
            }),
            handler: async (argString: string) => {
                const args = parseArgs(argString);
                const query = String(args.query || '').trim();
                if (!query) {
                    return err('query is required');
                }
                const language = args.language === 'en' ? 'en' : 'fr';
                const includeImages = args.include_images !== false;
                try {
                    const [articles, images] = await Promise.all([
                        this.searchWikipedia(query, language),
                        includeImages ? this.searchCommonsImages(query) : Promise.resolve([]),
                    ]);
                    return ok({
                        query,
                        language,
                        origin: 'educational_reference',
                        articles,
                        images,
                        usage_rule: 'Ces resultats sont des references pedagogiques externes. Ne les presente jamais comme une observation utilisateur ni comme une image du listing.',
                    });
                } catch (error: any) {
                    return err(error?.message || String(error));
                }
            },
        };
    }

    protected async searchWikipedia(query: string, language: 'fr' | 'en'): Promise<Array<{
        title: string;
        summary?: string;
        url?: string;
        thumbnailUrl?: string;
        origin: 'educational_reference';
        source: string;
    }>> {
        const endpoint = `https://${language}.wikipedia.org/w/api.php`;
        const params = new URLSearchParams({
            action: 'query',
            generator: 'search',
            gsrsearch: query,
            gsrlimit: '3',
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

    protected async searchCommonsImages(query: string): Promise<Array<{
        id: string;
        title: string;
        imageUrl?: string;
        thumbnailUrl?: string;
        pageUrl?: string;
        description?: string;
        license?: string;
        origin: 'educational_reference';
        source: 'Wikimedia Commons';
    }>> {
        const params = new URLSearchParams({
            action: 'query',
            generator: 'search',
            gsrsearch: query,
            gsrnamespace: '6',
            gsrlimit: '5',
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
}
