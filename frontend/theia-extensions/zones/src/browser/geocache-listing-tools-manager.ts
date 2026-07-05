import { injectable, inject } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import {
    ToolCallResult,
    ToolInvocationRegistry,
    ToolRequest,
    ToolRequestParameters
} from '@theia/ai-core';
import { BackendApiClient, getErrorMessage } from './backend-api-client';
import { buildGeocacheFullListingContext, GeocachePromptData } from './geocache-chat-prompt-shared';

interface GetGeocacheListingArgs {
    geocache_id?: number | string;
    max_description_chars?: number | string;
}

/**
 * Expose un tool read-only qui renvoie le listing COMPLET d'une geocache au modele.
 * Le contexte injecte a l'ouverture du chat tronque la description (1500 caracteres) ;
 * pour une mystery l'enigme est souvent dans la partie coupee. Ce tool donne un moyen
 * deterministe de recuperer le texte integral plutot que de deviner.
 */
@injectable()
export class GeocacheListingToolsManager implements FrontendApplicationContribution {

    static readonly PROVIDER_NAME = 'geoapp.geocache';

    @inject(ToolInvocationRegistry)
    protected readonly toolRegistry!: ToolInvocationRegistry;

    @inject(BackendApiClient)
    protected readonly apiClient!: BackendApiClient;

    async onStart(): Promise<void> {
        await this.toolRegistry.registerTool(this.createGetListingTool());
    }

    protected createGetListingTool(): ToolRequest {
        return {
            id: 'geoapp.geocache.get-listing',
            name: 'get_geocache_listing',
            description: 'Renvoie le listing COMPLET d une geocache (description integrale, indices decodes, waypoints, checkers), sans la troncature du contexte initial. A appeler quand l enigme n est pas entierement visible dans l extrait fourni.',
            providerName: GeocacheListingToolsManager.PROVIDER_NAME,
            parameters: {
                type: 'object',
                properties: {
                    geocache_id: {
                        type: 'number',
                        description: 'ID GeoApp de la geocache.'
                    },
                    max_description_chars: {
                        type: 'number',
                        description: 'Limite optionnelle de caracteres pour la description (defaut 12000).'
                    }
                },
                required: ['geocache_id'],
                additionalProperties: false
            } as ToolRequestParameters,
            handler: async (argString: string) => this.getGeocacheListing(argString)
        };
    }

    protected async getGeocacheListing(argString: string): Promise<ToolCallResult> {
        try {
            const args = this.parseArguments(argString) as GetGeocacheListingArgs;
            const geocacheId = this.toNumber(args.geocache_id);
            if (!geocacheId) {
                return this.stringify({ status: 'error', error: 'geocache_id est requis.' });
            }

            const data = await this.apiClient.requestJson<GeocachePromptData>(
                `/api/geocaches/${geocacheId}`,
                {},
                'Erreur lors du chargement du listing de la geocache'
            );

            const maxDescriptionChars = this.toNumber(args.max_description_chars);
            const listing = buildGeocacheFullListingContext(
                data,
                maxDescriptionChars ? { maxDescriptionChars } : undefined
            );

            return this.stringify({
                status: 'ok',
                geocache_id: geocacheId,
                gc_code: data.gc_code,
                name: data.name,
                description_truncated: listing.descriptionTruncated,
                listing: listing.text,
            });
        } catch (error) {
            return this.stringify({
                status: 'error',
                error: getErrorMessage(error, 'Erreur lors du chargement du listing de la geocache')
            });
        }
    }

    protected toNumber(value: unknown): number | undefined {
        if (typeof value === 'number' && Number.isFinite(value)) {
            return value;
        }
        if (typeof value === 'string' && value.trim()) {
            const numeric = Number(value.trim());
            return Number.isFinite(numeric) ? numeric : undefined;
        }
        return undefined;
    }

    protected parseArguments(argString: string): Record<string, unknown> {
        if (!argString || !argString.trim()) {
            return {};
        }
        return JSON.parse(argString);
    }

    protected stringify(value: unknown): string {
        return JSON.stringify(value, null, 2);
    }
}
