import { injectable, inject } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { MessageService } from '@theia/core';
import { PreferenceService } from '@theia/core/lib/common/preferences/preference-service';
import {
    ToolCallResult,
    ToolInvocationRegistry,
    ToolRequest,
    ToolRequestParameters
} from '@theia/ai-core';
import { BackendApiClient, getErrorMessage } from './backend-api-client';
import { GeoAppWidgetEventsService, GeocacheChangedEvent } from './geoapp-widget-events-service';

type FoundCoordinatesTarget = 'default' | 'corrected_coordinates' | 'waypoint' | 'note';
type EffectiveFoundCoordinatesTarget = Exclude<FoundCoordinatesTarget, 'default'>;

interface SaveFoundCoordinatesArgs {
    geocache_id?: number | string;
    target?: FoundCoordinatesTarget;
    coordinates_raw?: string;
    latitude?: number | string;
    longitude?: number | string;
    confidence?: number | string;
    label?: string;
    note?: string;
    source?: string;
    force?: boolean;
}

@injectable()
export class FoundCoordinatesToolsManager implements FrontendApplicationContribution {

    static readonly PROVIDER_NAME = 'geoapp.found-coordinates';

    @inject(ToolInvocationRegistry)
    protected readonly toolRegistry!: ToolInvocationRegistry;

    @inject(BackendApiClient)
    protected readonly apiClient!: BackendApiClient;

    @inject(PreferenceService)
    protected readonly preferenceService!: PreferenceService;

    @inject(GeoAppWidgetEventsService)
    protected readonly widgetEventsService!: GeoAppWidgetEventsService;

    @inject(MessageService)
    protected readonly messages!: MessageService;

    async onStart(): Promise<void> {
        await this.toolRegistry.registerTool(this.createSaveFoundCoordinatesTool());
    }

    protected createSaveFoundCoordinatesTool(): ToolRequest {
        return {
            id: 'geoapp.coordinates.save-found',
            name: 'save_found_coordinates',
            description: 'Enregistre une coordonnee trouvee par l IA dans GeoApp: coordonnees corrigees, nouveau waypoint ou note. target="default" respecte les preferences utilisateur.',
            providerName: FoundCoordinatesToolsManager.PROVIDER_NAME,
            parameters: {
                type: 'object',
                properties: {
                    geocache_id: {
                        type: 'number',
                        description: 'ID GeoApp de la geocache.'
                    },
                    target: {
                        type: 'string',
                        description: 'Destination: default, corrected_coordinates, waypoint ou note.',
                        enum: ['default', 'corrected_coordinates', 'waypoint', 'note']
                    },
                    coordinates_raw: {
                        type: 'string',
                        description: 'Coordonnee au format geocaching, ex: N 50° 17.090 W 107° 49.238.'
                    },
                    latitude: {
                        type: 'number',
                        description: 'Latitude decimale si coordinates_raw n est pas disponible.'
                    },
                    longitude: {
                        type: 'number',
                        description: 'Longitude decimale si coordinates_raw n est pas disponible.'
                    },
                    confidence: {
                        type: 'number',
                        description: 'Confiance du resultat entre 0 et 1.'
                    },
                    label: {
                        type: 'string',
                        description: 'Nom du waypoint ou titre court de la note.'
                    },
                    note: {
                        type: 'string',
                        description: 'Contexte a ajouter dans le waypoint ou la note.'
                    },
                    source: {
                        type: 'string',
                        description: 'Outil ou calcul source, ex: coordinate_projection.'
                    },
                    force: {
                        type: 'boolean',
                        description: 'True si l utilisateur a explicitement demande la sauvegarde, pour ignorer le mode manuel et le seuil.'
                    }
                },
                required: ['geocache_id'],
                additionalProperties: false
            } as ToolRequestParameters,
            handler: async (argString: string) => this.saveFoundCoordinates(argString)
        };
    }

    protected async saveFoundCoordinates(argString: string): Promise<ToolCallResult> {
        try {
            const args = this.parseArguments(argString) as SaveFoundCoordinatesArgs;
            const geocacheId = this.toNumber(args.geocache_id);
            if (!geocacheId) {
                return this.stringify({ status: 'error', error: 'geocache_id est requis.' });
            }

            const confidence = this.toNumber(args.confidence);
            const force = Boolean(args.force);
            const requestedTarget = this.normalizeTarget(args.target);
            const policy = this.readPolicy();

            if (requestedTarget === 'default' && !force && policy.autoSave !== 'confident') {
                return this.stringify({
                    status: 'skipped',
                    reason: 'La sauvegarde automatique des coordonnees trouvees est en mode manuel.',
                    preference: 'geoApp.chat.foundCoordinates.autoSave'
                });
            }

            if (requestedTarget === 'default' && !force && confidence === undefined) {
                return this.stringify({
                    status: 'skipped',
                    reason: 'Confiance absente: la sauvegarde automatique demande un score de confiance.',
                    threshold: policy.threshold
                });
            }

            if (requestedTarget === 'default' && !force && confidence !== undefined && confidence < policy.threshold) {
                return this.stringify({
                    status: 'skipped',
                    reason: `Confiance insuffisante (${confidence} < ${policy.threshold}).`,
                    confidence,
                    threshold: policy.threshold
                });
            }

            const target = requestedTarget === 'default' ? policy.defaultTarget : requestedTarget;
            const coordinatesRaw = this.normalizeCoordinatesRaw(args.coordinates_raw)
                || this.formatDecimalCoordinates(this.toNumber(args.latitude), this.toNumber(args.longitude));
            if (!coordinatesRaw) {
                return this.stringify({
                    status: 'error',
                    error: 'Fournis coordinates_raw ou latitude + longitude.'
                });
            }

            const source = (args.source || 'GeoApp Chat').trim();
            const label = (args.label || 'Coordonnees trouvees par IA').trim();
            const note = this.buildNote(coordinatesRaw, args.note, source, confidence);

            const result = await this.persist(target, geocacheId, coordinatesRaw, label, note);
            this.notifyChanged(geocacheId, target);
            this.messages.info(this.toUserMessage(target, coordinatesRaw));

            return this.stringify({
                status: 'ok',
                target,
                geocache_id: geocacheId,
                coordinates_raw: coordinatesRaw,
                confidence,
                result
            });
        } catch (error) {
            return this.stringify({
                status: 'error',
                error: getErrorMessage(error, 'Erreur lors de la sauvegarde des coordonnees trouvees')
            });
        }
    }

    protected async persist(
        target: EffectiveFoundCoordinatesTarget,
        geocacheId: number,
        coordinatesRaw: string,
        label: string,
        note: string
    ): Promise<unknown> {
        if (target === 'corrected_coordinates') {
            return this.apiClient.requestOptionalJson(
                `/api/geocaches/${geocacheId}/coordinates`,
                this.apiClient.createJsonInit('PUT', { coordinates_raw: coordinatesRaw }),
                'Erreur lors de la mise a jour des coordonnees corrigees'
            );
        }

        if (target === 'waypoint') {
            return this.apiClient.requestOptionalJson(
                `/api/geocaches/${geocacheId}/waypoints`,
                this.apiClient.createJsonInit('POST', {
                    prefix: 'AI',
                    lookup: 'FINAL',
                    name: label,
                    type: 'Final Location',
                    gc_coords: coordinatesRaw,
                    note
                }),
                'Erreur lors de la creation du waypoint'
            );
        }

        return this.apiClient.requestOptionalJson(
            `/api/geocaches/${geocacheId}/notes`,
            this.apiClient.createJsonInit('POST', {
                content: note,
                note_type: 'ai-coordinate',
                source: 'user',
                source_plugin: 'GeoApp Chat'
            }),
            'Erreur lors de la creation de la note'
        );
    }

    protected notifyChanged(geocacheId: number, target: EffectiveFoundCoordinatesTarget): void {
        const reason: GeocacheChangedEvent['reason'] = target === 'waypoint'
            ? 'waypoint-created'
            : target === 'note'
                ? 'note-created'
                : 'corrected-coordinates-updated';
        this.widgetEventsService.notifyGeocacheChanged({
            geocacheId,
            reason,
            source: 'chat'
        });
    }

    protected toUserMessage(target: EffectiveFoundCoordinatesTarget, coordinatesRaw: string): string {
        if (target === 'corrected_coordinates') {
            return `Coordonnees corrigees mises a jour: ${coordinatesRaw}`;
        }
        if (target === 'waypoint') {
            return `Waypoint IA cree: ${coordinatesRaw}`;
        }
        return `Note IA ajoutee: ${coordinatesRaw}`;
    }

    protected buildNote(coordinatesRaw: string, note: string | undefined, source: string, confidence: number | undefined): string {
        const parts = [
            `Coordonnees trouvees par IA: ${coordinatesRaw}`,
            `Source: ${source}`,
            confidence !== undefined ? `Confiance: ${confidence}` : undefined,
            note?.trim() ? `Contexte: ${note.trim()}` : undefined
        ].filter((part): part is string => Boolean(part));
        return parts.join('\n');
    }

    protected readPolicy(): { autoSave: 'manual' | 'confident'; defaultTarget: EffectiveFoundCoordinatesTarget; threshold: number } {
        const autoSaveRaw = String(this.preferenceService.get('geoApp.chat.foundCoordinates.autoSave', 'manual') || 'manual');
        const targetRaw = String(this.preferenceService.get('geoApp.chat.foundCoordinates.defaultTarget', 'waypoint') || 'waypoint');
        const threshold = this.toNumber(this.preferenceService.get('geoApp.chat.foundCoordinates.confidenceThreshold', 0.85)) ?? 0.85;
        return {
            autoSave: autoSaveRaw === 'confident' ? 'confident' : 'manual',
            defaultTarget: this.normalizeEffectiveTarget(targetRaw),
            threshold: Math.max(0, Math.min(1, threshold))
        };
    }

    protected normalizeTarget(value: unknown): FoundCoordinatesTarget {
        const raw = String(value || 'default').trim();
        if (raw === 'corrected_coordinates' || raw === 'waypoint' || raw === 'note') {
            return raw;
        }
        return 'default';
    }

    protected normalizeEffectiveTarget(value: unknown): EffectiveFoundCoordinatesTarget {
        const raw = String(value || 'waypoint').trim();
        if (raw === 'corrected_coordinates' || raw === 'note') {
            return raw;
        }
        return 'waypoint';
    }

    protected normalizeCoordinatesRaw(value: unknown): string | undefined {
        if (typeof value !== 'string') {
            return undefined;
        }
        const trimmed = value.trim();
        if (!trimmed) {
            return undefined;
        }
        return trimmed.replace(/\s*,\s*/g, ' ').replace(/\s+/g, ' ');
    }

    protected formatDecimalCoordinates(latitude: number | undefined, longitude: number | undefined): string | undefined {
        if (latitude === undefined || longitude === undefined) {
            return undefined;
        }
        if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
            return undefined;
        }
        const latDir = latitude >= 0 ? 'N' : 'S';
        const lonDir = longitude >= 0 ? 'E' : 'W';
        const absLat = Math.abs(latitude);
        const absLon = Math.abs(longitude);
        const latDeg = Math.floor(absLat);
        const lonDeg = Math.floor(absLon);
        const latMin = ((absLat - latDeg) * 60).toFixed(3);
        const lonMin = ((absLon - lonDeg) * 60).toFixed(3);
        return `${latDir} ${latDeg}° ${latMin} ${lonDir} ${lonDeg.toString().padStart(3, '0')}° ${lonMin}`;
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
