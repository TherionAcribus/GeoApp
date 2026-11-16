import { injectable, inject } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import {
    ToolInvocationRegistry,
    ToolRequest,
} from '@theia/ai-core';
import { buildParams, err, ok, parseArgs, toPositiveInteger } from './earthcoach-tool-utils';
import { GeocacheNotesService } from 'theia-ide-zones-ext/lib/browser/geocache-notes-service';
import { GeoAppWidgetEventsService } from 'theia-ide-zones-ext/lib/browser/geoapp-widget-events-service';

const PROVIDER_NAME = 'geoapp.earthcoach';

export interface SaveEarthCoachNoteOptions {
    geocacheId: number;
    content: string;
    title?: string;
}

@injectable()
export class EarthCoachNoteTools implements FrontendApplicationContribution {

    static readonly SAVE_NOTE_TOOL_ID = 'earthcoach.save_note';

    @inject(ToolInvocationRegistry)
    protected readonly toolRegistry!: ToolInvocationRegistry;

    @inject(GeocacheNotesService)
    protected readonly notesService!: GeocacheNotesService;

    @inject(GeoAppWidgetEventsService)
    protected readonly widgetEventsService!: GeoAppWidgetEventsService;

    async onStart(): Promise<void> {
        try {
            await this.toolRegistry.registerTool(this.createSaveNoteTool());
        } catch (error) {
            console.warn('[EarthCoach] Could not register note tool', error);
        }
    }

    buildAllTools(): ToolRequest[] {
        return [this.createSaveNoteTool()];
    }

    protected createSaveNoteTool(): ToolRequest {
        return {
            id: EarthCoachNoteTools.SAVE_NOTE_TOOL_ID,
            name: 'earthcoach_save_note',
            description: 'Enregistre dans les notes GeoApp une synthese EarthCoach explicitement demandee par l utilisateur. La note est marquee source=earthcoach et ne doit pas inventer d observation terrain.',
            providerName: PROVIDER_NAME,
            parameters: buildParams({
                geocache_id: {
                    type: 'number',
                    description: 'ID GeoApp de la geocache cible. Utiliser l ID fourni dans le contexte EarthCoach.',
                    required: true,
                },
                content: {
                    type: 'string',
                    description: 'Synthese a enregistrer. Elle doit rester fondee sur le listing, les notes et les observations fournies.',
                    required: true,
                },
                title: {
                    type: 'string',
                    description: 'Titre court optionnel pour la note, par exemple "Checklist terrain" ou "Synthese observations".',
                    required: false,
                },
            }),
            // Pas de confirmAlwaysAllow : les tools s'executent par defaut, une
            // confirmation reste possible via ai-features.chat.toolConfirmation.
            handler: async (argString: string) => {
                const args = parseArgs(argString);
                try {
                    const geocacheId = toPositiveInteger(args.geocache_id);
                    if (!geocacheId) {
                        return err('geocache_id is required');
                    }
                    const content = String(args.content || '').trim();
                    if (!content) {
                        return err('content is required');
                    }
                    const title = typeof args.title === 'string' ? args.title.trim() : undefined;
                    await this.saveEarthCoachNote({ geocacheId, content, title });
                    return ok({
                        geocache_id: geocacheId,
                        source: 'earthcoach',
                        note_type: 'system',
                        saved: true,
                    });
                } catch (error: any) {
                    return err(error?.message || String(error));
                }
            },
        };
    }

    async saveEarthCoachNote(options: SaveEarthCoachNoteOptions): Promise<void> {
        const content = this.buildNoteContent(options.content, options.title);
        await this.notesService.createNote(options.geocacheId, {
            content,
            note_type: 'system',
            source: 'earthcoach',
            source_plugin: 'earthcoach',
        });
        this.widgetEventsService.notifyGeocacheChanged({
            geocacheId: options.geocacheId,
            reason: 'note-created',
            source: 'chat',
        });
    }

    protected buildNoteContent(content: string, title?: string): string {
        const heading = title?.trim() || 'Synthese EarthCoach';
        return [
            `[EarthCoach] ${heading}`,
            '',
            content.trim(),
        ].join('\n');
    }

}
