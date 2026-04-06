import * as React from 'react';
import { injectable, inject } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { MessageService } from '@theia/core';
import { ApplicationShell, ConfirmDialog, StatefulWidget } from '@theia/core/lib/browser';
import { CommandService } from '@theia/core';
import { LanguageModelRegistry, LanguageModelService, UserRequest, getJsonOfResponse, getTextOfResponse, isLanguageModelParsedResponse } from '@theia/ai-core';
import { getAttributeIconUrl } from './geocache-attributes-icons-data';
import { PluginExecutorContribution } from '@mysterai/theia-plugins/lib/browser/plugins-contribution';
import { GeocacheContext } from '@mysterai/theia-plugins/lib/browser/plugin-executor-widget';
import { FormulaSolverSolveFromGeocacheCommand } from '@mysterai/theia-formula-solver/lib/browser/formula-solver-contribution';
import { PreferenceService } from '@theia/core/lib/common/preferences/preference-service';
import { PreferenceScope } from '@theia/core/lib/common/preferences/preference-scope';
import { GeocacheImagesPanel } from './geocache-images-panel';
import { GeoAppTranslateDescriptionAgentId } from './geoapp-translate-description-agent';
import { BackendApiClient, getErrorMessage } from './backend-api-client';
import { CoordinatesEditor } from './geocache-coordinates-editor';
import { DescriptionEditor } from './geocache-description-editor';
import { GeocachesService } from './geocaches-service';
import {
    GeocacheDetailsService,
    SaveWaypointInput,
    UpdateDescriptionInput,
    UpdateTranslatedContentInput
} from './geocache-details-service';
import {
    DescriptionVariant,
    GeocacheAttribute,
    GeocacheChecker,
    GeocacheDto,
    GeocacheImage,
    GeocacheWaypoint,
    WaypointPrefillPayload
} from './geocache-details-types';
import {
    calculateAntipode,
    calculateProjection,
    htmlToRawText,
    parseGCCoords,
    rawTextToHtml,
    rot13,
    toGCFormat
} from './geocache-details-utils';
import { WaypointsEditorWrapper } from './geocache-waypoints-editor';
import { GeoAppWidgetEventsService } from './geoapp-widget-events-service';
import {
    GeoAppChatProfile,
    GeoAppChatWorkflowProfile,
    GeoAppChatWorkflowKind
} from './geoapp-chat-agent';
import {
    buildGeocacheGeoAppOpenChatDetail,
} from './geocache-chat-prompt-shared';
import {
    dispatchGeoAppOpenChatRequest,
    GeoAppWorkflowResolutionPreview,
    resolveGeoAppChatProfileForWorkflow,
    resolveGeoAppChatWorkflowKindFromOrchestrator,
} from './geoapp-chat-shared';

interface PluginAddWaypointDetail {
    gcCoords: string;
    pluginName?: string;
    geocache?: {
        gcCode: string;
        name?: string;
    };
    sourceResultText?: string;
    waypointTitle?: string;
    waypointNote?: string;
    autoSave?: boolean;
    decimalLatitude?: number;
    decimalLongitude?: number;
}

const GEOAPP_CHAT_PROFILE_MENU_OPTIONS: Array<{ value: GeoAppChatWorkflowProfile; label: string }> = [
    { value: 'default', label: 'Auto' },
    { value: 'fast', label: 'Fast' },
    { value: 'strong', label: 'Strong' },
    { value: 'web', label: 'Web' },
    { value: 'local', label: 'Local' },
];

interface SerializedGeocacheDetailsState {
    geocacheId?: number;
    lastAccessTimestamp?: number;
}

@injectable()
export class GeocacheDetailsWidget extends ReactWidget implements StatefulWidget {
    static readonly ID = 'geocache.details.widget';

    protected geocacheId?: number;
    protected data?: GeocacheDto;
    protected isLoading = false;
    protected notesCount: number | undefined;
    protected waypointEditorCallback?: (prefill?: WaypointPrefillPayload) => void;
    protected isSavingWaypoint = false;
    protected interactionTimerId: number | undefined;
    protected descriptionVariant: DescriptionVariant = 'original';
    protected descriptionVariantGeocacheId: number | undefined;
    protected isTranslatingDescription = false;
    protected isTranslatingAllContent = false;
    protected lastAccessTimestamp: number = Date.now();
    protected archiveStatus: 'synced' | 'needs_sync' | 'none' | 'loading' = 'none';
    protected archiveUpdatedAt: string | undefined = undefined;
    protected isSyncingArchive = false;
    protected chatWorkflowPreview: GeoAppChatWorkflowKind = 'general';
    protected chatProfilePreview: GeoAppChatProfile = 'fast';
    protected chatProfileOverride: GeoAppChatWorkflowProfile = 'default';
    protected isChatRoutingPreviewLoading = false;
    protected isChatProfileMenuOpen = false;
    private readonly geocacheChangeDisposable: { dispose: () => void };

    private readonly displayDecodedHintsPreferenceKey = 'geoApp.geocache.hints.displayDecoded';
    private readonly descriptionDefaultVariantPreferenceKey = 'geoApp.geocache.description.defaultVariant';
    private readonly externalLinksOpenModePreferenceKey = 'geoApp.geocache.externalLinks.openMode';
    private readonly imagesStorageDefaultModePreferenceKey = 'geoApp.images.storage.defaultMode';
    private readonly imagesGalleryThumbnailSizePreferenceKey = 'geoApp.images.gallery.thumbnailSize';
    private readonly imagesGalleryHiddenDomainsPreferenceKey = 'geoApp.images.gallery.hiddenDomains';
    private readonly ocrDefaultEnginePreferenceKey = 'geoApp.ocr.defaultEngine';
    private readonly ocrDefaultLanguagePreferenceKey = 'geoApp.ocr.defaultLanguage';
    private readonly ocrLmstudioBaseUrlPreferenceKey = 'geoApp.ocr.lmstudio.baseUrl';
    private readonly ocrLmstudioModelPreferenceKey = 'geoApp.ocr.lmstudio.model';

    private readonly handleContentClick = (): void => {
        this.emitInteraction('click');
    };

    private readonly handleContentScroll = (): void => {
        this.emitInteraction('scroll');
    };

    // Map pour stocker les métadonnées GeoApp des sessions de chat
    constructor(
        @inject(MessageService) protected readonly messages: MessageService,
        @inject(ApplicationShell) protected readonly shell: ApplicationShell,
        @inject(PluginExecutorContribution) protected readonly pluginExecutorContribution: PluginExecutorContribution,
        @inject(CommandService) protected readonly commandService: CommandService,
        @inject(PreferenceService) protected readonly preferenceService: PreferenceService,
        @inject(LanguageModelRegistry) protected readonly languageModelRegistry: LanguageModelRegistry,
        @inject(LanguageModelService) protected readonly languageModelService: LanguageModelService,
        @inject(BackendApiClient) protected readonly apiClient: BackendApiClient,
        @inject(GeocachesService) protected readonly geocachesService: GeocachesService,
        @inject(GeocacheDetailsService) protected readonly geocacheDetailsService: GeocacheDetailsService,
        @inject(GeoAppWidgetEventsService) protected readonly widgetEventsService: GeoAppWidgetEventsService
    ) {
        super();
        this.id = GeocacheDetailsWidget.ID;
        this.title.label = 'Géocache';
        this.title.caption = 'Détails Géocache';
        this.title.closable = true;
        this.title.iconClass = 'fa fa-map-marker';
        this.addClass('theia-geocache-details-widget');

        this.node.tabIndex = 0;
        this.geocacheChangeDisposable = this.widgetEventsService.onDidChangeGeocache(event => {
            if (event.geocacheId === this.geocacheId) {
                void this.load();
            }
        });
    }

    protected onAfterAttach(msg: any): void {
        super.onAfterAttach(msg);
        this.addEventListeners();
        this.addInteractionListeners();
    }

    protected onBeforeDetach(msg: any): void {
        this.removeInteractionListeners();
        this.removeEventListeners();
        super.onBeforeDetach(msg);
    }

    dispose(): void {
        this.geocacheChangeDisposable.dispose();
        super.dispose();
    }

    private handlePluginAddWaypointEvent = (event: CustomEvent<PluginAddWaypointDetail>): void => {
        if (!event.detail?.gcCoords) {
            return;
        }

        // Vérifier que l'événement concerne bien cette géocache (si info fournie)
        const eventGcCode = event.detail.geocache?.gcCode;
        if (eventGcCode && this.data?.gc_code && eventGcCode !== this.data.gc_code) {
            return;
        }

        const title = event.detail.waypointTitle || (event.detail.pluginName ? `Résultat ${event.detail.pluginName}` : undefined);
        const note = event.detail.waypointNote || event.detail.sourceResultText;

        if (event.detail.autoSave) {
            this.autoSaveWaypoint(event.detail.gcCoords, title, note).catch(error => {
                console.error('[GeocacheDetailsWidget] autoSaveWaypoint error', error);
            });
            return;
        }

        this.addWaypointWithCoordinates(event.detail.gcCoords, {
            title,
            note
        });
        const source = event.detail.pluginName ? ` (plugin ${event.detail.pluginName})` : '';
        this.messages.info(`Waypoint prérempli depuis le Plugin Executor${source}`);
    };

    private handleCoordinatesUpdatedEvent = (event: CustomEvent<{ geocacheId: number; gcCode: string }>): void => {
        if (!event.detail?.geocacheId || !this.data) {
            return;
        }

        // Vérifier que l'événement concerne bien cette géocache
        if (event.detail.geocacheId !== this.data.id && event.detail.gcCode !== this.data.gc_code) {
            return;
        }

        // Recharger les données de la géocache
        this.load().catch(error => {
            console.error('[GeocacheDetailsWidget] Error reloading after coordinates update:', error);
        });
    };

    private addEventListeners(): void {
        if (typeof window === 'undefined') {
            return;
        }

        window.removeEventListener('geoapp-plugin-add-waypoint', this.handlePluginAddWaypointEvent as EventListener);
        window.addEventListener('geoapp-plugin-add-waypoint', this.handlePluginAddWaypointEvent as EventListener);

        window.removeEventListener('geoapp-geocache-coordinates-updated', this.handleCoordinatesUpdatedEvent as EventListener);
        window.addEventListener('geoapp-geocache-coordinates-updated', this.handleCoordinatesUpdatedEvent as EventListener);
    }

    private removeEventListeners(): void {
        if (typeof window === 'undefined') {
            return;
        }

        window.removeEventListener('geoapp-plugin-add-waypoint', this.handlePluginAddWaypointEvent as EventListener);
        window.removeEventListener('geoapp-geocache-coordinates-updated', this.handleCoordinatesUpdatedEvent as EventListener);
    }

    private addInteractionListeners(): void {
        if (typeof window === 'undefined') {
            return;
        }
        this.node.addEventListener('click', this.handleContentClick, true);
        this.node.addEventListener('scroll', this.handleContentScroll, true);
    }

    private removeInteractionListeners(): void {
        if (typeof window === 'undefined') {
            return;
        }
        this.node.removeEventListener('click', this.handleContentClick, true);
        this.node.removeEventListener('scroll', this.handleContentScroll, true);
        this.clearMinOpenTimeTimer();
    }

    /**
     * Ouvre le formulaire d'ajout de waypoint avec des coordonnées pré-remplies
     * Méthode publique appelable depuis d'autres widgets (ex: carte)
     */
    public addWaypointWithCoordinates(gcCoords: string, options?: { title?: string; note?: string; autoSave?: boolean }): void {
        if (options?.autoSave) {
            void this.autoSaveWaypoint(gcCoords, options.title, options.note);
            return;
        }

        if (this.waypointEditorCallback) {
            // Activer le widget pour le rendre visible
            this.shell.activateWidget(this.id);
            // Ouvrir le formulaire d'ajout de waypoint
            this.waypointEditorCallback({
                coords: gcCoords,
                title: options?.title,
                note: options?.note
            });
        } else {
            this.messages.warn('Le formulaire de waypoint n\'est pas encore chargé');
        }
    }

    private emitInteraction(type: 'click' | 'scroll' | 'min-open-time'): void {
        if (typeof window === 'undefined') {
            return;
        }
        window.dispatchEvent(new CustomEvent('geoapp-geocache-tab-interaction', {
            detail: {
                widgetId: this.id,
                geocacheId: this.geocacheId,
                type
            }
        }));
    }

    private setupMinOpenTimeTimer(): void {
        this.clearMinOpenTimeTimer();

        if (typeof window === 'undefined') {
            return;
        }

        const enabled = this.preferenceService.get('geoApp.ui.tabs.smartReplace.interaction.minOpenTimeEnabled', true) as boolean;
        if (!enabled) {
            return;
        }

        const timeoutSeconds = this.preferenceService.get('geoApp.ui.tabs.smartReplaceTimeout', 30) as number;
        if (!timeoutSeconds || timeoutSeconds <= 0) {
            return;
        }

        this.interactionTimerId = window.setTimeout(() => {
            this.emitInteraction('min-open-time');
        }, timeoutSeconds * 1000);
    }

    private clearMinOpenTimeTimer(): void {
        if (this.interactionTimerId !== undefined) {
            window.clearTimeout(this.interactionTimerId);
            this.interactionTimerId = undefined;
        }
    }

    private notifyGeocacheChanged(reason: 'waypoint-created' | 'waypoint-deleted' | 'corrected-coordinates-updated'): void {
        if (!this.geocacheId) {
            return;
        }
        this.widgetEventsService.notifyGeocacheChanged({
            geocacheId: this.geocacheId,
            reason,
            source: 'details'
        });
    }

    private async saveWaypointFromEditor(
        waypointId: number | 'new' | undefined,
        payload: SaveWaypointInput
    ): Promise<void> {
        if (!this.geocacheId) {
            throw new Error('Aucune géocache chargée');
        }

        try {
            await this.geocacheDetailsService.saveWaypoint(this.geocacheId, waypointId, payload);
            await this.load();
            this.notifyGeocacheChanged(waypointId === 'new' || waypointId === undefined ? 'waypoint-created' : 'corrected-coordinates-updated');
            this.messages.info('Waypoint sauvegardé');
        } catch (error) {
            console.error('[GeocacheDetailsWidget] saveWaypointFromEditor error', error);
            this.messages.error(getErrorMessage(error, 'Erreur lors de la sauvegarde du waypoint'));
            throw error;
        }
    }

    private async saveDescriptionOverrides(payload: UpdateDescriptionInput): Promise<void> {
        if (!this.geocacheId) {
            throw new Error('Aucune géocache chargée');
        }

        try {
            await this.geocacheDetailsService.updateDescription(this.geocacheId, payload);
            this.descriptionVariant = 'modified';
            await this.load();
            this.messages.info('Description mise à jour');
        } catch (error) {
            console.error('[GeocacheDetailsWidget] saveDescriptionOverrides error', error);
            this.messages.error(getErrorMessage(error, 'Erreur lors de la mise à jour de la description'));
            throw error;
        }
    }

    private async resetDescriptionOverrides(): Promise<void> {
        if (!this.geocacheId) {
            throw new Error('Aucune géocache chargée');
        }

        try {
            await this.geocacheDetailsService.resetDescription(this.geocacheId);
            this.descriptionVariant = 'original';
            await this.load();
            this.messages.info('Description réinitialisée');
        } catch (error) {
            console.error('[GeocacheDetailsWidget] resetDescriptionOverrides error', error);
            this.messages.error(getErrorMessage(error, 'Erreur lors de la réinitialisation de la description'));
            throw error;
        }
    }

    private async saveCoordinates(coordinatesRaw: string): Promise<void> {
        if (!this.geocacheId) {
            throw new Error('Aucune géocache chargée');
        }

        try {
            await this.geocachesService.updateCoordinates(this.geocacheId, coordinatesRaw);
            await this.load();
            this.notifyGeocacheChanged('corrected-coordinates-updated');
            this.messages.info('Coordonnées mises à jour');
        } catch (error) {
            console.error('[GeocacheDetailsWidget] saveCoordinates error', error);
            this.messages.error(getErrorMessage(error, 'Erreur lors de la mise à jour des coordonnées'));
            throw error;
        }
    }

    private async resetCoordinates(): Promise<void> {
        if (!this.geocacheId) {
            throw new Error('Aucune géocache chargée');
        }

        try {
            await this.geocacheDetailsService.resetCoordinates(this.geocacheId);
            await this.load();
            this.notifyGeocacheChanged('corrected-coordinates-updated');
            this.messages.info('Coordonnées réinitialisées');
        } catch (error) {
            console.error('[GeocacheDetailsWidget] resetCoordinates error', error);
            this.messages.error(getErrorMessage(error, 'Erreur lors de la réinitialisation des coordonnées'));
            throw error;
        }
    }

    private async pushCorrectedCoordinatesToGeocaching(): Promise<void> {
        if (!this.geocacheId || !this.data) {
            throw new Error('Aucune géocache chargée');
        }

        if (!this.data.is_corrected) {
            this.messages.warn('Aucune coordonnée corrigée à envoyer. Corrigez d\'abord les coordonnées.');
            return;
        }

        try {
            await this.geocacheDetailsService.pushCorrectedCoordinates<{ error?: string }>(this.geocacheId);
            this.messages.info(`✅ Coordonnées envoyées vers Geocaching.com (${this.data.gc_code || this.geocacheId})`);
        } catch (error) {
            console.error('[GeocacheDetailsWidget] pushCorrectedCoordinatesToGeocaching error', error);
            this.messages.error(getErrorMessage(error, 'Erreur réseau lors de l\'envoi vers Geocaching.com'));
            throw error;
        }
    }

    private async updateSolvedStatus(newStatus: 'not_solved' | 'in_progress' | 'solved'): Promise<void> {
        if (!this.geocacheId) {
            throw new Error('Aucune géocache chargée');
        }

        try {
            await this.geocacheDetailsService.updateSolvedStatus(this.geocacheId, newStatus);
            if (this.data) {
                this.data.solved = newStatus;
            }
            this.messages.info('Statut mis à jour');
        } catch (error) {
            console.error('[GeocacheDetailsWidget] updateSolvedStatus error', error);
            this.messages.error(getErrorMessage(error, 'Erreur lors de la mise à jour du statut'));
            throw error;
        }
    }

    private async autoSaveWaypoint(gcCoords: string, title?: string, note?: string): Promise<void> {
        if (!this.geocacheId) {
            this.messages.error('Aucune géocache chargée pour créer le waypoint');
            return;
        }
        if (this.isSavingWaypoint) {
            this.messages.warn('Création de waypoint déjà en cours');
            return;
        }

        this.isSavingWaypoint = true;
        try {
            await this.geocachesService.createWaypoint(this.geocacheId, {
                name: title || 'Waypoint détecté',
                gc_coords: gcCoords,
                note: note || ''
            });
            await this.load();
            this.notifyGeocacheChanged('waypoint-created');
            this.messages.info('Waypoint créé automatiquement depuis le plugin');
        } catch (error) {
            console.error('[GeocacheDetailsWidget] autoSaveWaypoint failed', error);
            this.messages.error(getErrorMessage(error, 'Impossible de créer automatiquement le waypoint'));
        } finally {
            this.isSavingWaypoint = false;
        }
    }

    /**
     * Supprime un waypoint depuis un autre widget (ex: carte)
     * Méthode publique appelable depuis d'autres widgets
     */
    public async deleteWaypointById(waypointId: number): Promise<void> {
        if (!this.data?.waypoints) {
            this.messages.error('Aucune donnée de géocache chargée');
            return;
        }

        const waypoint = this.data.waypoints.find(w => w.id === waypointId);
        if (!waypoint) {
            this.messages.error('Waypoint introuvable');
            return;
        }

        await this.deleteWaypoint(waypointId, waypoint.name || 'ce waypoint');
    }

    /**
     * Définit un waypoint comme coordonnées corrigées depuis un autre widget (ex: carte)
     * Méthode publique appelable depuis d'autres widgets
     */
    public async setWaypointAsCorrectedCoords(waypointId: number): Promise<void> {
        if (!this.data?.waypoints) {
            this.messages.error('Aucune donnée de géocache chargée');
            return;
        }

        const waypoint = this.data.waypoints.find(w => w.id === waypointId);
        if (!waypoint) {
            this.messages.error('Waypoint introuvable');
            return;
        }

        await this.setAsCorrectedCoords(waypointId, waypoint.name || 'ce waypoint');
    }

    /**
     * Ouvre le Formula Solver avec la géocache actuelle
     */
    protected solveFormula = async (): Promise<void> => {
        if (!this.data || !this.geocacheId) {
            this.messages.warn('Aucune géocache chargée');
            return;
        }

        try {
            await this.commandService.executeCommand(
                FormulaSolverSolveFromGeocacheCommand.id,
                this.geocacheId
            );
        } catch (error) {
            console.error('Erreur lors de l\'ouverture du Formula Solver:', error);
            this.messages.error('Impossible d\'ouvrir le Formula Solver');
        }
    };

    /**
     * Ouvre le Plugin Executor avec le contexte de la géocache actuelle
     */
    protected analyzeWithPlugins = (): void => {
        const context = this.buildPluginExecutorContext();
        if (!context) {
            return;
        }

        console.log('[GeocacheDetailsWidget] Context sent to executor:', context);

        // Ouvrir le Plugin Executor avec ce contexte
        this.pluginExecutorContribution.openWithContext(context);
    };

    /**
     * Ouvre le Plugin Executor spécifiquement pour l'analyse de page (analysis_web_page)
     */
    protected analyzePage = (): void => {
        const context = this.buildPluginExecutorContext();
        if (!context) {
            return;
        }

        // Ouvrir directement avec analysis_web_page et exécution automatique
        this.pluginExecutorContribution.openWithContext(context, 'analysis_web_page', true);
    };

    protected analyzeCode = (): void => {
        const context = this.buildPluginExecutorContext();
        if (!context) {
            return;
        }

        this.pluginExecutorContribution.openWithContext(context, 'metasolver', true);
    };

    private buildPluginExecutorContext(): GeocacheContext | undefined {
        if (!this.data) {
            this.messages.warn('Aucune géocache chargée');
            return undefined;
        }

        const descriptionHtml = this.getEffectiveDescriptionHtml(this.data, this.descriptionVariant);

        const coordinatesRaw = this.data.coordinates_raw || this.data.original_coordinates_raw;
        let contextCoordinates: GeocacheContext['coordinates'] = undefined;
        if (coordinatesRaw) {
            let lat = this.data.latitude;
            let lon = this.data.longitude;

            if (lat === undefined || lat === null || lon === undefined || lon === null) {
                const raw = coordinatesRaw.replace(',', ' ');
                const parts = raw.match(/([NS].*?)([EW].*)/i);
                if (parts?.[1] && parts?.[2]) {
                    const parsed = parseGCCoords(parts[1].trim(), parts[2].trim());
                    if (parsed) {
                        lat = parsed.lat;
                        lon = parsed.lon;
                    }
                }
            }

            if (lat !== undefined && lat !== null && lon !== undefined && lon !== null) {
                contextCoordinates = {
                    latitude: lat,
                    longitude: lon,
                    coordinatesRaw
                };
            }
        }

        return {
            geocacheId: this.data.id,
            gcCode: this.data.gc_code || `GC${this.data.id}`,
            name: this.data.name,
            coordinates: contextCoordinates,
            description: descriptionHtml,
            hint: this.getDecodedHints(this.data),
            difficulty: this.data.difficulty,
            terrain: this.data.terrain,
            waypoints: this.data.waypoints,
            images: this.data.images,
            checkers: this.data.checkers
        };
    }

    setGeocache(context: { geocacheId: number; name?: string }): void {
        this.geocacheId = context.geocacheId;
        this.lastAccessTimestamp = Date.now();
        this.notesCount = undefined;
        this.archiveStatus = 'none';
        this.archiveUpdatedAt = undefined;
        if (context.name) {
            this.title.label = `Géocache - ${context.name}`;
        } else if (this.data?.name) {
            this.title.label = `Géocache - ${this.data.name}`;
        } else {
            this.title.label = `Géocache - ${this.geocacheId}`;
        }
        this.setupMinOpenTimeTimer();
        this.update();
        this.load();
    }

    /**
     * Appelé quand le widget devient actif
     * Réactive automatiquement la carte correspondante
     */
    protected onActivateRequest(msg: any): void {
        super.onActivateRequest(msg);
        this.node.focus();
        this.reactivateMap();
    }

    /**
     * Fournit le contenu structuré pour la recherche in-page (SearchableWidget duck-typing).
     * Retourne les blocs de texte cherchables extraits des données de la géocache.
     */
    getSearchableContent(): { id: string; text: string; element?: HTMLElement }[] {
        const d = this.data;
        if (!d) {
            return [];
        }

        const contents: { id: string; text: string; element?: HTMLElement }[] = [];

        // En-tête : nom, code, type, owner
        const headerParts = [d.name, d.gc_code, d.type, d.owner].filter(Boolean);
        if (headerParts.length > 0) {
            contents.push({ id: 'header', text: headerParts.join(' ') });
        }

        // Coordonnées
        const coordParts = [d.coordinates_raw, d.original_coordinates_raw].filter(Boolean);
        if (coordParts.length > 0) {
            contents.push({ id: 'coordinates', text: coordParts.join(' ') });
        }

        // Description (variante affichée)
        const descHtml = this.getEffectiveDescriptionHtml(d, this.descriptionVariant);
        if (descHtml) {
            contents.push({ id: 'description', text: htmlToRawText(descHtml) });
        }

        // Indices (hints)
        const decodedHints = this.getDecodedHints(d);
        if (decodedHints) {
            contents.push({ id: 'hints', text: decodedHints });
        } else if (d.hints) {
            contents.push({ id: 'hints', text: d.hints });
        }

        // Waypoints
        if (d.waypoints && d.waypoints.length > 0) {
            const wpTexts = d.waypoints.map(wp => {
                const parts = [wp.prefix, wp.name, wp.type, wp.gc_coords, wp.note, wp.note_override].filter(Boolean);
                return parts.join(' ');
            });
            contents.push({ id: 'waypoints', text: wpTexts.join('\n') });
        }

        // Checkers
        if (d.checkers && d.checkers.length > 0) {
            const checkerTexts = d.checkers.map(c => [c.name, c.url].filter(Boolean).join(' '));
            contents.push({ id: 'checkers', text: checkerTexts.join('\n') });
        }

        return contents;
    }

    /**
     * Appelé quand le widget va être fermé
     * Ferme automatiquement la carte correspondante
     */
    protected onCloseRequest(msg: any): void {
        // Fermer la carte de géocache associée avant de fermer l'onglet
        this.closeAssociatedMap();

        // Appeler la méthode parente pour la fermeture normale
        super.onCloseRequest(msg);
        this.removeEventListeners();
        this.removeInteractionListeners();
    }

    /**
     * Ferme la carte associée à cette géocache
     */
    private closeAssociatedMap(): void {
        if (this.geocacheId && this.data?.gc_code) {
            const mapId = `geoapp-map-geocache-${this.geocacheId}`;
            const existingMap = this.shell.getWidgets('bottom').find(w => w.id === mapId);

            if (existingMap) {
                console.log('[GeocacheDetailsWidget] Fermeture de la carte géocache associée:', this.geocacheId);
                existingMap.close();
            }
        }
    }

    protected getGcPersonalNoteAutoSyncMode(): 'manual' | 'onNotesOpen' | 'onDetailsOpen' {
        const raw = this.preferenceService.get('geoApp.notes.gcPersonalNote.autoSyncMode', 'manual') as string;
        if (raw === 'onNotesOpen' || raw === 'onDetailsOpen' || raw === 'manual') {
            return raw;
        }
        return 'manual';
    }

    protected getDefaultDescriptionVariant(data: GeocacheDto): DescriptionVariant {
        const raw = this.preferenceService.get(this.descriptionDefaultVariantPreferenceKey, 'auto') as string;
        const hasModified = Boolean(data.description_override_raw) || Boolean(data.description_override_html);
        if (raw === 'original') {
            return 'original';
        }
        if (raw === 'modified') {
            return hasModified ? 'modified' : 'original';
        }
        return hasModified ? 'modified' : 'original';
    }

    protected getEffectiveDescriptionHtml(data: GeocacheDto, variant: DescriptionVariant): string {
        if (variant === 'modified') {
            if (data.description_override_html) {
                return data.description_override_html;
            }
            if (data.description_override_raw) {
                return rawTextToHtml(data.description_override_raw);
            }
            return '';
        }

        if (data.description_html) {
            return data.description_html;
        }
        if (data.description_raw) {
            return rawTextToHtml(data.description_raw);
        }
        return '';
    }

    protected async translateDescriptionToFrench(): Promise<void> {
        if (!this.data || !this.geocacheId) {
            this.messages.warn('Aucune géocache chargée');
            return;
        }

        if (this.isTranslatingDescription) {
            return;
        }

        const hasModified = Boolean(this.data.description_override_raw) || Boolean(this.data.description_override_html);
        if (hasModified) {
            const dialog = new ConfirmDialog({
                title: 'Traduire la description',
                msg: 'Une description modifiée existe déjà. Voulez-vous la remplacer par la traduction ?'
            });
            const ok = await dialog.open();
            if (!ok) {
                return;
            }
        }

        const sourceHtml = this.getEffectiveDescriptionHtml(this.data, 'original');
        if (!sourceHtml.trim()) {
            this.messages.warn('Description originale vide');
            return;
        }

        this.isTranslatingDescription = true;
        this.update();

        try {
            const languageModel = await this.languageModelRegistry.selectLanguageModel({
                agent: GeoAppTranslateDescriptionAgentId,
                purpose: 'chat',
                identifier: 'default/universal'
            });

            if (!languageModel) {
                this.messages.error('Aucun modèle IA n\'est configuré pour la traduction (vérifie la configuration IA de Theia)');
                return;
            }

            const prompt =
                'Tu es un traducteur. Traduis en français le contenu TEXTUEL du HTML fourni, en conservant le HTML.\n'
                + '- Ne change pas les balises, attributs, liens, images, classes, ids.\n'
                + '- Ne traduis pas les coordonnées, codes GC, URLs, ni les identifiants techniques.\n'
                + '- Ne renvoie que le HTML final, sans markdown, sans explications.';

            const request: UserRequest = {
                messages: [
                    { actor: 'user', type: 'text', text: `${prompt}\n\nHTML:\n${sourceHtml}` },
                ],
                agentId: GeoAppTranslateDescriptionAgentId,
                requestId: `geoapp-translate-description-${Date.now()}`,
                sessionId: `geoapp-translate-description-session-${Date.now()}`,
            };

            const response = await this.languageModelService.sendRequest(languageModel, request);
            let translatedHtml = '';
            if (isLanguageModelParsedResponse(response)) {
                translatedHtml = JSON.stringify(response.parsed);
            } else {
                try {
                    translatedHtml = await getTextOfResponse(response);
                } catch {
                    const jsonResponse = await getJsonOfResponse(response) as any;
                    translatedHtml = typeof jsonResponse === 'string' ? jsonResponse : String(jsonResponse);
                }
            }

            translatedHtml = (translatedHtml || '').toString();
            translatedHtml = translatedHtml
                .replace(/\[THINK\][\s\S]*?\[\/THINK\]/gi, '')
                .replace(/<think>[\s\S]*?<\/think>/gi, '')
                .replace(/\[ANALYSIS\][\s\S]*?\[\/ANALYSIS\]/gi, '')
                .replace(/<analysis>[\s\S]*?<\/analysis>/gi, '')
                .trim();

            if (!translatedHtml) {
                this.messages.warn('Traduction IA: réponse vide');
                return;
            }

            const translatedRaw = htmlToRawText(translatedHtml);
            await this.geocacheDetailsService.updateDescription(this.geocacheId, {
                description_override_html: translatedHtml,
                description_override_raw: translatedRaw,
            });

            this.descriptionVariant = 'modified';
            await this.load();
            this.messages.info('Traduction enregistrée dans la description modifiée');
        } catch (e) {
            console.error('[GeocacheDetailsWidget] translateDescriptionToFrench error', e);
            this.messages.error(`Traduction IA: erreur (${String(e)})`);
        } finally {
            this.isTranslatingDescription = false;
            this.update();
        }
    }

    protected async autoSyncGcPersonalNoteFromDetailsIfEnabled(): Promise<void> {
        if (!this.geocacheId) {
            return;
        }
        const mode = this.getGcPersonalNoteAutoSyncMode();
        if (mode !== 'onDetailsOpen') {
            return;
        }
        try {
            await this.geocacheDetailsService.syncNotesFromGeocaching(this.geocacheId);
        } catch (err) {
            console.error('[GeocacheDetailsWidget] Auto-sync note Geocaching.com échouée:', err);
        }
    }

    protected async loadNotesCount(): Promise<void> {
        if (!this.geocacheId) {
            this.notesCount = undefined;
            return;
        }
        try {
            const data = await this.geocacheDetailsService.getNotes(this.geocacheId);
            this.notesCount = Array.isArray(data.notes) ? data.notes.length : 0;
        } catch (e) {
            console.error('[GeocacheDetailsWidget] Failed to load notes count', e);
            this.notesCount = undefined;
        }
    }

    /**
     * Réactive la carte correspondante à cette géocache
     */
    private reactivateMap(): void {
        // Si on a une géocache chargée, réactiver sa carte
        if (this.geocacheId && this.data?.gc_code) {
            const mapId = `geoapp-map-geocache-${this.geocacheId}`;
            const existingMap = this.shell.getWidgets('bottom').find(w => w.id === mapId);
            
            if (existingMap) {
                console.log('[GeocacheDetailsWidget] Réactivation de la carte géocache:', this.geocacheId);
                this.shell.activateWidget(mapId);
            }
        }
    }

    storeState(): object | undefined {
        if (!this.geocacheId) {
            return undefined;
        }
        this.lastAccessTimestamp = Date.now();
        const state: SerializedGeocacheDetailsState = {
            geocacheId: this.geocacheId,
            lastAccessTimestamp: this.lastAccessTimestamp
        };
        return state;
    }

    restoreState(oldState: object): void {
        const state = oldState as Partial<SerializedGeocacheDetailsState> | undefined;
        if (!state || typeof state.geocacheId !== 'number') {
            return;
        }
        if (state.lastAccessTimestamp && typeof state.lastAccessTimestamp === 'number') {
            this.lastAccessTimestamp = state.lastAccessTimestamp;
        }
        this.setGeocache({ geocacheId: state.geocacheId });
    }

    protected async load(): Promise<void> {
        if (!this.geocacheId) { return; }
        this.isLoading = true;
        this.update();
        try {
            this.data = await this.geocachesService.get<GeocacheDto>(this.geocacheId);
            if (this.data && this.descriptionVariantGeocacheId !== this.geocacheId) {
                this.descriptionVariant = this.getDefaultDescriptionVariant(this.data);
                this.descriptionVariantGeocacheId = this.geocacheId;
            }
            this.title.label = `Géocache - ${this.data?.name ?? this.data?.gc_code ?? this.geocacheId}`;
            await this.loadNotesCount();
            void this.autoSyncGcPersonalNoteFromDetailsIfEnabled();
            void this.loadArchiveStatus();
            void this.refreshChatRoutingPreview();
        } catch (e) {
            // eslint-disable-next-line no-console
            console.error('GeocacheDetailsWidget: load error', e);
            this.messages.error(getErrorMessage(e, 'Impossible de charger la géocache'));
        } finally {
            this.isLoading = false;
            this.update();
        }
    }

    protected async loadArchiveStatus(): Promise<void> {
        const gcCode = this.data?.gc_code;
        if (!gcCode) { return; }
        this.archiveStatus = 'loading';
        this.update();
        try {
            const json = await this.geocacheDetailsService.getArchiveStatus(gcCode);
            if (!json) {
                this.archiveStatus = 'none';
                this.archiveUpdatedAt = undefined;
                this.update();
                return;
            }
            if (json.exists) {
                this.archiveStatus = 'synced';
                this.archiveUpdatedAt = json.updated_at;
            } else if (json.needs_sync) {
                this.archiveStatus = 'needs_sync';
                this.archiveUpdatedAt = undefined;
            } else {
                this.archiveStatus = 'none';
                this.archiveUpdatedAt = undefined;
            }
        } catch {
            this.archiveStatus = 'none';
        }
        this.update();
    }

    protected forceSyncArchive = async (): Promise<void> => {
        const gcCode = this.data?.gc_code;
        if (!gcCode || this.isSyncingArchive) { return; }
        this.isSyncingArchive = true;
        this.archiveStatus = 'loading';
        this.update();
        try {
            const json = await this.geocacheDetailsService.syncArchive(gcCode);
            if (json?.synced && json.archive) {
                this.archiveStatus = 'synced';
                this.archiveUpdatedAt = json.archive.updated_at;
                this.messages.info(`Archive ${gcCode} synchronisée`);
            } else {
                this.archiveStatus = 'needs_sync';
            }
        } catch (e) {
            this.archiveStatus = 'needs_sync';
            this.messages.error(getErrorMessage(e, 'Erreur synchronisation archive'));
        } finally {
            this.isSyncingArchive = false;
            this.update();
        }
    };

    /**
     * Supprime un waypoint après confirmation
     */
    protected deleteWaypoint = async (waypointId: number, waypointName: string): Promise<void> => {
        if (!this.geocacheId || !this.data) { return; }
        
        const dialog = new ConfirmDialog({
            title: 'Supprimer le waypoint',
            msg: `Voulez-vous vraiment supprimer le waypoint "${waypointName}" ?`,
            ok: 'Supprimer',
            cancel: 'Annuler'
        });
        
        const confirmed = await dialog.open();
        if (!confirmed) { return; }
        
        try {
            await this.geocachesService.deleteWaypoint(this.geocacheId, waypointId);
            
            if (this.data.waypoints) {
                this.data.waypoints = this.data.waypoints.filter(w => w.id !== waypointId);
            }
            this.notifyGeocacheChanged('waypoint-deleted');
            this.update();
            
            this.messages.info(`Waypoint "${waypointName}" supprimé`);
        } catch (e) {
            console.error('Delete waypoint error', e);
            this.messages.error(getErrorMessage(e, 'Erreur lors de la suppression du waypoint'));
        }
    };

    /**
     * Envoie les coordonnées d'un waypoint vers Geocaching.com (comme coordonnées corrigées)
     */
    protected pushWaypointToGeocaching = async (waypointId: number, waypointName: string): Promise<void> => {
        if (!this.geocacheId || !this.data) { return; }

        const dialog = new ConfirmDialog({
            title: 'Envoyer vers Geocaching.com',
            msg: `Envoyer les coordonnées de "${waypointName}" comme coordonnées corrigées vers Geocaching.com (${this.data.gc_code || ''}) ?`,
            ok: 'Envoyer',
            cancel: 'Annuler'
        });

        const confirmed = await dialog.open();
        if (!confirmed) { return; }

        try {
            await this.geocacheDetailsService.pushWaypointCoordinates(this.geocacheId, waypointId);
            this.messages.info(`✅ Coordonnées de "${waypointName}" envoyées vers Geocaching.com`);
        } catch (e) {
            console.error('pushWaypointToGeocaching error', e);
            this.messages.error(getErrorMessage(e, 'Erreur réseau lors de l\'envoi vers Geocaching.com'));
        }
    };

    /**
     * Définit les coordonnées d'un waypoint comme coordonnées corrigées de la géocache
     */
    protected setAsCorrectedCoords = async (waypointId: number, waypointName: string): Promise<void> => {
        if (!this.geocacheId || !this.data) { return; }
        
        const dialog = new ConfirmDialog({
            title: 'Définir comme coordonnées corrigées',
            msg: `Voulez-vous définir les coordonnées du waypoint "${waypointName}" comme coordonnées corrigées de la géocache ?`,
            ok: 'Confirmer',
            cancel: 'Annuler'
        });
        
        const confirmed = await dialog.open();
        if (!confirmed) { return; }
        
        try {
            await this.geocachesService.setWaypointAsCorrectedCoords(this.geocacheId, waypointId);
            await this.load();
            this.notifyGeocacheChanged('corrected-coordinates-updated');
            this.messages.info(`Coordonnées corrigées mises à jour depuis "${waypointName}"`);
        } catch (e) {
            console.error('Set corrected coords error', e);
            this.messages.error(getErrorMessage(e, 'Erreur lors de la mise à jour des coordonnées corrigées'));
        }
    };

    protected renderRow(label: string, value?: React.ReactNode): React.ReactNode {
        if (value === undefined || value === null || value === '') { return undefined; }
        return (
            <tr>
                <td style={{ opacity: 0.7, paddingRight: 8 }}>{label}</td>
                <td>{value}</td>
            </tr>
        );
    }

    protected getAttributeIconUrlFromAttribute(attribute: GeocacheAttribute): string | undefined {
        // base_filename contient déjà le suffixe -yes ou -no
        const iconFilename = attribute.base_filename || `${attribute.name.toLowerCase().replace(/\s+/g, '')}-${attribute.is_negative ? 'no' : 'yes'}`;
        const iconUrl = getAttributeIconUrl(iconFilename);
        
        if (!iconUrl) {
            console.warn(`Attribute icon not found: ${iconFilename}.png`);
        }
        
        return iconUrl;
    }

    /**
     * Affiche les étoiles de notation (difficulté ou terrain)
     */
    protected renderStars(rating?: number, color: string = 'gold'): React.ReactNode {
        if (!rating) { return undefined; }
        const fullStars = Math.floor(rating);
        const hasHalfStar = rating % 1 >= 0.5;
        const emptyStars = 5 - fullStars - (hasHalfStar ? 1 : 0);
        
        return (
            <span style={{ color, fontSize: 16 }}>
                {'★'.repeat(fullStars)}
                {hasHalfStar && '◐'}
                {emptyStars > 0 && <span style={{ opacity: 0.3 }}>{'☆'.repeat(emptyStars)}</span>}
            </span>
        );
    }

    protected renderAttributes(attrs?: GeocacheAttribute[]): React.ReactNode {
        if (!attrs || attrs.length === 0) { return undefined; }
        return (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {attrs.map((a, idx) => {
                    const iconUrl = this.getAttributeIconUrlFromAttribute(a);
                    const tooltipText = `${a.is_negative ? 'No ' : ''}${a.name}`;
                    
                    if (!iconUrl) {
                        // Fallback si l'image n'est pas trouvée
                        return (
                            <span key={idx} style={{
                                border: '1px solid var(--theia-foreground)',
                                borderRadius: 4,
                                padding: '2px 6px',
                                fontSize: 12,
                                opacity: a.is_negative ? 0.7 : 1
                            }} title={tooltipText}>
                                {a.is_negative ? 'No ' : ''}{a.name}
                            </span>
                        );
                    }
                    
                    return (
                        <img 
                            key={idx}
                            src={iconUrl}
                            alt={tooltipText}
                            title={tooltipText}
                            style={{
                                width: 24,
                                height: 24,
                                opacity: a.is_negative ? 0.7 : 1,
                                cursor: 'help'
                            }}
                        />
                    );
                })}
            </div>
        );
    }

    private openGeocacheAIChat = async (): Promise<void> => {
        if (!this.geocacheId || !this.data) {
            this.messages.warn('Aucune geocache selectionnee pour ouvrir le chat IA.');
            return;
        }
        try {
            this.isChatProfileMenuOpen = false;
            dispatchGeoAppOpenChatRequest(
                window,
                CustomEvent,
                buildGeocacheGeoAppOpenChatDetail(
                    this.data,
                    this.chatWorkflowPreview,
                    this.chatProfileOverride === 'default' ? undefined : this.chatProfileOverride,
                )
            );
            this.messages.info('Chat IA lance pour cette geocache.');
        } catch (error) {
            console.error('[GeocacheDetailsWidget] openGeocacheAIChat error', error);
            this.messages.error('Impossible d\'ouvrir le chat IA pour cette geocache.');
        }
    };

    /**
     * Ouvre le widget des logs pour cette géocache dans le panneau droit
     */
    private openLogs = (): void => {
        if (!this.geocacheId || !this.data) {
            this.messages.warn('Aucune géocache sélectionnée pour voir les logs.');
            return;
        }

        // Émettre un événement pour ouvrir le widget des logs
        const event = new CustomEvent('open-geocache-logs', {
            detail: {
                geocacheId: this.geocacheId,
                gcCode: this.data.gc_code,
                name: this.data.name
            }
        });
        window.dispatchEvent(event);
    };

    private openLogEditor = (): void => {
        if (!this.geocacheId || !this.data) {
            this.messages.warn('Aucune géocache sélectionnée pour loguer.');
            return;
        }

        const event = new CustomEvent('open-geocache-log-editor', {
            detail: {
                geocacheIds: [this.geocacheId],
                title: this.data.gc_code ? `Log - ${this.data.gc_code}` : 'Log - 1 géocache',
            }
        });
        window.dispatchEvent(event);
    };

    /**
     * Ouvre le widget des notes pour cette géocache dans le panneau droit
     */
    private openNotes = (): void => {
        if (!this.geocacheId || !this.data) {
            this.messages.warn('Aucune géocache sélectionnée pour voir les notes.');
            return;
        }

        const event = new CustomEvent('open-geocache-notes', {
            detail: {
                geocacheId: this.geocacheId,
                gcCode: this.data.gc_code,
                name: this.data.name
            }
        });
        window.dispatchEvent(event);
    };

    private getDecodedHints(data: GeocacheDto): string | undefined {
        if (data.hints_decoded_override) {
            return data.hints_decoded_override;
        }
        if (data.hints_decoded) {
            return data.hints_decoded;
        }
        if (!data.hints) {
            return undefined;
        }
        return rot13(data.hints);
    }

    protected async translateAllToFrench(): Promise<void> {
        if (!this.data || !this.geocacheId) {
            this.messages.warn('Aucune géocache chargée');
            return;
        }

        if (this.isTranslatingAllContent) {
            return;
        }

        const hasAnyOverride =
            Boolean(this.data.description_override_html) ||
            Boolean(this.data.description_override_raw) ||
            Boolean(this.data.hints_decoded_override) ||
            Boolean((this.data.waypoints || []).some(w => Boolean(w.note_override)));

        if (hasAnyOverride) {
            const dialog = new ConfirmDialog({
                title: 'Traduire tout le contenu',
                msg: 'Des valeurs modifiées existent déjà (description, indices, ou notes de waypoints). Voulez-vous les remplacer par la traduction ?'
            });
            const ok = await dialog.open();
            if (!ok) {
                return;
            }
        }

        const sourceHtml = this.getEffectiveDescriptionHtml(this.data, 'original');
        const sourceHints = this.data.hints_decoded || (this.data.hints ? rot13(this.data.hints) : '');
        const sourceWaypoints = (this.data.waypoints || []).map(w => ({
            id: w.id,
            note: (w.note || '').toString(),
        })).filter(w => typeof w.id === 'number');

        this.isTranslatingAllContent = true;
        this.update();

        try {
            const languageModel = await this.languageModelRegistry.selectLanguageModel({
                agent: GeoAppTranslateDescriptionAgentId,
                purpose: 'chat',
                identifier: 'default/universal'
            });
            if (!languageModel) {
                this.messages.error('Aucun modèle IA n\'est configuré pour la traduction (vérifie la configuration IA de Theia)');
                return;
            }

            const input = {
                description_html: sourceHtml,
                hints_decoded: sourceHints,
                waypoints: sourceWaypoints,
            };

            const prompt =
                'Traduis en français le contenu suivant et renvoie UNIQUEMENT un JSON valide.\n'
                + 'Contraintes :\n'
                + '- description_html : conserve strictement le HTML (balises/attributs/liens/images), ne traduis que le texte.\n'
                + '- Ne traduis pas les coordonnées, codes GC, URLs, ni les identifiants techniques.\n'
                + '- waypoints : conserve les ids, traduis uniquement la note.\n'
                + 'Schéma JSON de sortie : {"description_html": string, "hints_decoded": string, "waypoints": [{"id": number, "note": string}] }\n';

            const request: UserRequest = {
                messages: [
                    { actor: 'user', type: 'text', text: `${prompt}\nINPUT_JSON:\n${JSON.stringify(input)}` },
                ],
                agentId: GeoAppTranslateDescriptionAgentId,
                requestId: `geoapp-translate-all-${Date.now()}`,
                sessionId: `geoapp-translate-all-session-${Date.now()}`,
            };

            const response = await this.languageModelService.sendRequest(languageModel, request);
            let parsed: any;
            try {
                parsed = await getJsonOfResponse(response) as any;
            } catch {
                const text = await getTextOfResponse(response);
                parsed = JSON.parse(text);
            }

            const translatedHtml = (parsed?.description_html || '').toString();
            const translatedHints = (parsed?.hints_decoded || '').toString();
            const translatedWaypoints = Array.isArray(parsed?.waypoints) ? parsed.waypoints : [];

            const payload = {
                description_override_html: translatedHtml,
                description_override_raw: htmlToRawText(translatedHtml),
                hints_decoded_override: translatedHints,
                waypoints: translatedWaypoints
                    .filter((w: any) => w && typeof w.id === 'number' && w.note !== undefined && w.note !== null)
                    .map((w: any) => ({ id: w.id, note_override: String(w.note) })),
            };

            await this.geocacheDetailsService.updateTranslatedContent(
                this.geocacheId,
                payload as UpdateTranslatedContentInput
            );

            this.descriptionVariant = 'modified';
            await this.load();
            this.messages.info('Traduction enregistrée (description + indices + waypoints)');
        } catch (e) {
            console.error('[GeocacheDetailsWidget] translateAllToFrench error', e);
            this.messages.error(`Traduction IA: erreur (${String(e)})`);
        } finally {
            this.isTranslatingAllContent = false;
            this.update();
        }
    }

    private toggleHintsDisplayMode = async (): Promise<void> => {
        const current = this.preferenceService.get(this.displayDecodedHintsPreferenceKey, false) as boolean;
        await this.preferenceService.set(this.displayDecodedHintsPreferenceKey, !current, PreferenceScope.User);
        this.update();
    };

    private async confirmStoreAllImages(options: { geocacheId: number; pendingCount: number }): Promise<boolean> {
        const dialog = new ConfirmDialog({
            title: 'Stockage local des images',
            msg: `Stocker localement ${options.pendingCount} image(s) pour cette géocache ?`,
        });
        const confirmed = await dialog.open();
        return Boolean(confirmed);
    }

    private getImagesStorageDefaultMode(): 'never' | 'prompt' | 'always' {
        const raw = this.preferenceService.get(this.imagesStorageDefaultModePreferenceKey, 'prompt') as string;
        if (raw === 'never' || raw === 'prompt' || raw === 'always') {
            return raw;
        }
        return 'prompt';
    }

    private getImagesGalleryThumbnailSize(): 'small' | 'medium' | 'large' {
        const raw = this.preferenceService.get(this.imagesGalleryThumbnailSizePreferenceKey, 'small') as string;
        if (raw === 'small' || raw === 'medium' || raw === 'large') {
            return raw;
        }
        return 'small';
    }

    private async setImagesGalleryThumbnailSize(size: 'small' | 'medium' | 'large'): Promise<void> {
        await this.preferenceService.set(this.imagesGalleryThumbnailSizePreferenceKey, size, PreferenceScope.User);
        this.update();
    }

    private getImagesGalleryHiddenDomainsText(): string {
        const raw = this.preferenceService.get(this.imagesGalleryHiddenDomainsPreferenceKey, '') as unknown;
        if (typeof raw === 'string') {
            return raw;
        }
        if (Array.isArray(raw)) {
            return raw.filter((v): v is string => typeof v === 'string').join('\n');
        }
        return '';
    }

    private async setImagesGalleryHiddenDomainsText(value: string): Promise<void> {
        await this.preferenceService.set(this.imagesGalleryHiddenDomainsPreferenceKey, value ?? '', PreferenceScope.User);
        this.update();
    }

    private getOcrDefaultEngine(): 'easyocr_ocr' | 'vision_ocr' {
        const raw = this.preferenceService.get(this.ocrDefaultEnginePreferenceKey, 'easyocr_ocr') as string;
        if (raw === 'vision_ocr' || raw === 'easyocr_ocr') {
            return raw;
        }
        return 'easyocr_ocr';
    }

    private getOcrDefaultLanguage(): string {
        const raw = this.preferenceService.get(this.ocrDefaultLanguagePreferenceKey, 'auto') as string;
        return (raw || 'auto').toString();
    }

    private getOcrLmstudioBaseUrl(): string {
        const raw = this.preferenceService.get(this.ocrLmstudioBaseUrlPreferenceKey, 'http://localhost:1234') as string;
        return (raw || 'http://localhost:1234').toString();
    }

    private getOcrLmstudioModel(): string {
        const raw = this.preferenceService.get(this.ocrLmstudioModelPreferenceKey, '') as string;
        return (raw || '').toString();
    }

    private getImagesGalleryHiddenDomains(): string[] {
        const raw = this.preferenceService.get(this.imagesGalleryHiddenDomainsPreferenceKey, '') as unknown;
        if (Array.isArray(raw)) {
            return raw
                .filter((v): v is string => typeof v === 'string')
                .map(v => v.trim().toLowerCase())
                .filter(v => Boolean(v));
        }

        if (typeof raw !== 'string') {
            return [];
        }

        return raw
            .split(/[\n\r,;]+/g)
            .map(v => v.trim().toLowerCase())
            .filter(v => Boolean(v));
    }

    private getExternalLinksOpenMode(): 'new-tab' | 'new-window' {
        const raw = this.preferenceService.get(this.externalLinksOpenModePreferenceKey, 'new-tab') as string;
        if (raw === 'new-window') {
            return 'new-window';
        }
        return 'new-tab';
    }

    private resolveChatProfileForWorkflow(workflowKind: GeoAppChatWorkflowKind): GeoAppChatProfile {
        return resolveGeoAppChatProfileForWorkflow(workflowKind, undefined, {
            'geoApp.chat.defaultProfile': this.preferenceService.get('geoApp.chat.defaultProfile', 'fast'),
            'geoApp.chat.workflowProfile.secretCode': this.preferenceService.get('geoApp.chat.workflowProfile.secretCode', 'default'),
            'geoApp.chat.workflowProfile.formula': this.preferenceService.get('geoApp.chat.workflowProfile.formula', 'default'),
            'geoApp.chat.workflowProfile.checker': this.preferenceService.get('geoApp.chat.workflowProfile.checker', 'default'),
            'geoApp.chat.workflowProfile.hiddenContent': this.preferenceService.get('geoApp.chat.workflowProfile.hiddenContent', 'default'),
            'geoApp.chat.workflowProfile.imagePuzzle': this.preferenceService.get('geoApp.chat.workflowProfile.imagePuzzle', 'default'),
        });
    }

    private resolveWorkflowKindFromOrchestrator(preview?: GeoAppWorkflowResolutionPreview): GeoAppChatWorkflowKind {
        return resolveGeoAppChatWorkflowKindFromOrchestrator(preview);
    }

    private getEffectiveChatProfile(): GeoAppChatProfile {
        return this.chatProfileOverride === 'default' ? this.chatProfilePreview : this.chatProfileOverride;
    }

    private getChatProfileOverrideLabel(): string {
        if (this.chatProfileOverride === 'default') {
            return `Auto (${this.chatProfilePreview})`;
        }
        return this.chatProfileOverride;
    }

    private toggleChatProfileMenu = (event: React.MouseEvent<HTMLButtonElement>): void => {
        event.preventDefault();
        event.stopPropagation();
        this.isChatProfileMenuOpen = !this.isChatProfileMenuOpen;
        this.update();
    };

    private selectChatProfileOverride = (profile: GeoAppChatWorkflowProfile): void => {
        this.chatProfileOverride = profile;
        this.isChatProfileMenuOpen = false;
        this.update();
    };

    private async refreshChatRoutingPreview(): Promise<void> {
        if (!this.geocacheId || !this.data) {
            this.chatWorkflowPreview = 'general';
            this.chatProfilePreview = this.resolveChatProfileForWorkflow('general');
            this.isChatRoutingPreviewLoading = false;
            this.update();
            return;
        }

        this.isChatRoutingPreviewLoading = true;
        this.update();
        try {
            const preview = await this.geocacheDetailsService.resolveWorkflow<GeoAppWorkflowResolutionPreview>(this.geocacheId);
            this.chatWorkflowPreview = this.resolveWorkflowKindFromOrchestrator(preview);
            this.chatProfilePreview = this.resolveChatProfileForWorkflow(this.chatWorkflowPreview);
        } catch (error) {
            console.warn('[GeocacheDetailsWidget] refreshChatRoutingPreview error', error);
            this.chatWorkflowPreview = 'general';
            this.chatProfilePreview = this.resolveChatProfileForWorkflow('general');
        } finally {
            this.isChatRoutingPreviewLoading = false;
            this.update();
        }
    }

    protected renderCheckers(checkers?: GeocacheChecker[]): React.ReactNode {
        if (!checkers || checkers.length === 0) { return undefined; }
        return (
            <ul style={{ margin: 0, paddingLeft: 18 }}>
                {checkers.map((c, i) => (
                    <li key={c.id ?? i}>
                        {c.url ? <a href={c.url} target='_blank' rel='noreferrer'>{c.name || c.url}</a> : (c.name || '')}
                    </li>
                ))}
            </ul>
        );
    }

    protected render(): React.ReactNode {
        const d = this.data;
        const displayDecodedHints = this.preferenceService.get(this.displayDecodedHintsPreferenceKey, false) as boolean;
        const decodedHints = d ? this.getDecodedHints(d) : undefined;
        const rawHints = d?.hints;
        const hasHints = Boolean(rawHints) || Boolean(d?.hints_decoded) || Boolean(d?.hints_decoded_override);
        const displayedHints = hasHints
            ? (displayDecodedHints ? (decodedHints || rawHints) : (rawHints || decodedHints))
            : undefined;
        return (
            <div className='p-2'>
                {this.isLoading && <div>Chargement"¦</div>}
                {!this.isLoading && !d && <div style={{ opacity: 0.7 }}>Aucune donnée</div>}
                {!this.isLoading && d && (
                    <div style={{ display: 'grid', gap: 12 }}>
                        {/* En-tête */}
                        <div style={{ marginBottom: 8 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                                <h3 style={{ margin: 0 }}>{d.name}</h3>
                                <div style={{ display: 'flex', gap: 8 }}>
                                    <button
                                        className='theia-button secondary'
                                        onClick={this.solveFormula}
                                        style={{ fontSize: 12, padding: '4px 12px' }}
                                        title='Ouvrir le Formula Solver'
                                    >
                                        🧮 Résoudre formule
                                    </button>
                                    <button
                                        className='theia-button secondary'
                                        onClick={this.analyzePage}
                                        style={{ fontSize: 12, padding: '4px 12px' }}
                                        title='Lancer l&#39;analyse complète de la page'
                                    >
                                        &#x1F50D; Analyse Page
                                    </button>
                                    <button
                                        className='theia-button secondary'
                                        onClick={this.analyzeCode}
                                        style={{ fontSize: 12, padding: '4px 12px' }}
                                        title='Analyser le texte avec Metasolver'
                                    >
                                        &#x1F9D0; Analyse de Code
                                    </button>
                                    <button
                                        className='theia-button secondary'
                                        onClick={this.analyzeWithPlugins}
                                        style={{ fontSize: 12, padding: '4px 12px' }}
                                        title='Analyser cette géocache avec les plugins'
                                    >
                                        &#x1F4BE; Analyser avec plugins
                                    </button>
                                    <div style={{ position: 'relative', display: 'flex', alignItems: 'stretch' }}>
                                        <button
                                            className='theia-button'
                                            onClick={this.openGeocacheAIChat}
                                            style={{ fontSize: 12, padding: '4px 12px', borderTopRightRadius: 0, borderBottomRightRadius: 0 }}
                                            title={`Ouvrir un chat IA dedie a cette geocache${this.isChatRoutingPreviewLoading ? ' (analyse du profil en cours)' : ` - profil effectif ${this.getEffectiveChatProfile()}, workflow ${this.chatWorkflowPreview}, selection ${this.getChatProfileOverrideLabel()}`}`}
                                        >
                                            {`Chat IA [${this.isChatRoutingPreviewLoading ? '...' : this.getEffectiveChatProfile()}]`}
                                        </button>
                                        <button
                                            className='theia-button secondary'
                                            onClick={this.toggleChatProfileMenu}
                                            style={{ fontSize: 12, padding: '4px 8px', borderTopLeftRadius: 0, borderBottomLeftRadius: 0 }}
                                            title={`Choisir le profil de chat IA (actuel: ${this.getChatProfileOverrideLabel()})`}
                                        >
                                            ▼
                                        </button>
                                        {this.isChatProfileMenuOpen && (
                                            <div
                                                style={{
                                                    position: 'absolute',
                                                    top: '100%',
                                                    right: 0,
                                                    marginTop: 4,
                                                    minWidth: 150,
                                                    display: 'flex',
                                                    flexDirection: 'column',
                                                    background: 'var(--theia-editorWidget-background)',
                                                    border: '1px solid var(--theia-panel-border)',
                                                    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.25)',
                                                    zIndex: 20,
                                                }}
                                            >
                                                {GEOAPP_CHAT_PROFILE_MENU_OPTIONS.map(option => {
                                                    const isSelected = this.chatProfileOverride === option.value;
                                                    const autoSuffix = option.value === 'default' ? ` -> ${this.chatProfilePreview}` : '';
                                                    return (
                                                        <button
                                                            key={option.value}
                                                            className='theia-button secondary'
                                                            onClick={() => this.selectChatProfileOverride(option.value)}
                                                            style={{
                                                                fontSize: 12,
                                                                padding: '6px 10px',
                                                                textAlign: 'left',
                                                                border: 0,
                                                                borderRadius: 0,
                                                                background: isSelected ? 'var(--theia-list-activeSelectionBackground)' : 'transparent',
                                                                color: isSelected ? 'var(--theia-list-activeSelectionForeground)' : 'inherit',
                                                            }}
                                                            title={option.value === 'default'
                                                                ? `Utiliser le profil determine automatiquement par le workflow (${this.chatProfilePreview})`
                                                                : `Forcer le profil ${option.label}`}
                                                        >
                                                            {`${isSelected ? '• ' : ''}${option.label}${autoSuffix}`}
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </div>
                                    <div style={{ display: 'flex', gap: 8 }}>
                                        <button
                                            className='theia-button secondary'
                                            onClick={this.openLogs}
                                            style={{ fontSize: 12, padding: '4px 12px' }}
                                            title='Voir les logs de cette géocache'
                                        >
                                            💬 Logs
                                        </button>
                                        <button
                                            className='theia-button secondary'
                                            onClick={this.openLogEditor}
                                            style={{ fontSize: 12, padding: '4px 12px' }}
                                            title='Loguer cette géocache (éditeur)'
                                        >
                                            âœ️ Loguer
                                        </button>
                                        <button
                                            className='theia-button secondary'
                                            onClick={this.openNotes}
                                            style={{ fontSize: 12, padding: '4px 12px' }}
                                            title='Voir les notes de cette géocache'
                                        >
                                            📝 Notes{this.notesCount && this.notesCount > 0 ? ` (${this.notesCount})` : ''}
                                        </button>
                                    </div>
                                </div>
                            </div>
                            <div style={{ display: 'flex', gap: 16, alignItems: 'center', fontSize: 14 }}>
                                <span style={{ opacity: 0.7 }}>{d.gc_code}</span>
                                <span style={{ opacity: 0.7 }}>"¢</span>
                                <span style={{ opacity: 0.7 }}>{d.type}</span>
                                <span style={{ opacity: 0.7 }}>"¢</span>
                                <span style={{ opacity: 0.7 }}>Par {d.owner || 'Inconnu'}</span>
                                {this.archiveStatus !== 'none' && (
                                    <button
                                        onClick={this.forceSyncArchive}
                                        disabled={this.archiveStatus === 'loading' || this.isSyncingArchive}
                                        title={
                                            this.archiveStatus === 'synced'
                                                ? `Archive à jour${this.archiveUpdatedAt ? ` (${new Date(this.archiveUpdatedAt).toLocaleString()})` : ''} "” Cliquer pour re-synchroniser`
                                                : this.archiveStatus === 'loading'
                                                ? 'Synchronisation en cours"¦'
                                                : 'Archive non synchronisée "” Cliquer pour synchroniser'
                                        }
                                        style={{
                                            background: 'none',
                                            border: '1px solid',
                                            borderRadius: 12,
                                            cursor: this.archiveStatus === 'loading' ? 'wait' : 'pointer',
                                            padding: '2px 8px',
                                            fontSize: 11,
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: 4,
                                            borderColor: this.archiveStatus === 'synced' ? '#10b981' : this.archiveStatus === 'loading' ? '#60a5fa' : '#f59e0b',
                                            color: this.archiveStatus === 'synced' ? '#10b981' : this.archiveStatus === 'loading' ? '#60a5fa' : '#f59e0b',
                                            opacity: this.isSyncingArchive ? 0.6 : 1,
                                        }}
                                    >
                                        <span>{this.archiveStatus === 'synced' ? '💾' : this.archiveStatus === 'loading' ? '⏳' : '⚠️'}</span>
                                        <span>{this.archiveStatus === 'synced' ? 'Archive' : this.archiveStatus === 'loading' ? 'Sync"¦' : 'Non archivée'}</span>
                                    </button>
                                )}
                            </div>
                        </div>

                        {/* Informations principales : 2 colonnes */}
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                            {/* Colonne gauche : Statistiques */}
                            <div style={{ 
                                background: 'var(--theia-editor-background)', 
                                border: '1px solid var(--theia-panel-border)',
                                borderRadius: 6, 
                                padding: 16 
                            }}>
                                <h4 style={{ margin: '0 0 16px 0', fontSize: 16 }}>Statistiques</h4>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                                    <div>
                                        <div style={{ opacity: 0.7, fontSize: 12, marginBottom: 4 }}>Difficulté</div>
                                        <div>{this.renderStars(d.difficulty, '#fbbf24')}</div>
                                    </div>
                                    <div>
                                        <div style={{ opacity: 0.7, fontSize: 12, marginBottom: 4 }}>Terrain</div>
                                        <div>{this.renderStars(d.terrain, '#10b981')}</div>
                                    </div>
                                    <div>
                                        <div style={{ opacity: 0.7, fontSize: 12, marginBottom: 4 }}>Taille</div>
                                        <div style={{ color: '#60a5fa' }}>{d.size || 'N/A'}</div>
                                    </div>
                                    <div>
                                        <div style={{ opacity: 0.7, fontSize: 12, marginBottom: 4 }}>Favoris</div>
                                        <div style={{ color: '#a78bfa' }}>{d.favorites_count || 0}</div>
                                    </div>
                                </div>
                                
                                {/* Attributs */}
                                {d.attributes && d.attributes.length > 0 && (
                                    <div style={{ marginTop: 16 }}>
                                        <div style={{ opacity: 0.7, fontSize: 12, marginBottom: 8 }}>Attributs</div>
                                        {this.renderAttributes(d.attributes)}
                                    </div>
                                )}
                            </div>

                            {/* Colonne droite : Coordonnées */}
                            <div style={{ 
                                background: 'var(--theia-editor-background)', 
                                border: '1px solid var(--theia-panel-border)',
                                borderRadius: 6, 
                                padding: 16 
                            }}>
                                <h4 style={{ margin: '0 0 16px 0', fontSize: 16 }}>Coordonnées</h4>
                                <CoordinatesEditor
                                    geocacheData={d}
                                    gcCode={d.gc_code}
                                    onSaveCoordinates={(coordinatesRaw) => this.saveCoordinates(coordinatesRaw)}
                                    onResetCoordinates={() => this.resetCoordinates()}
                                    onPushCorrectedCoordinates={() => this.pushCorrectedCoordinatesToGeocaching()}
                                    onUpdateSolvedStatus={(newStatus) => this.updateSolvedStatus(newStatus)}
                                />
                            </div>
                        </div>

                        {/* Informations supplémentaires (table) */}
                        <details style={{ 
                            background: 'var(--theia-editor-background)', 
                            border: '1px solid var(--theia-panel-border)',
                            borderRadius: 6, 
                            padding: 16 
                        }}>
                            <summary style={{ cursor: 'pointer', fontWeight: 'bold', marginBottom: 8 }}>Informations détaillées</summary>
                            <table className='theia-table' style={{ width: '100%', marginTop: 8 }}>
                                <tbody>
                                    {this.renderRow('Code', d.gc_code)}
                                    {this.renderRow('Propriétaire', d.owner)}
                                    {this.renderRow('Type', d.type)}
                                    {this.renderRow('Taille', d.size)}
                                    {this.renderRow('Difficulté', d.difficulty?.toString())}
                                    {this.renderRow('Terrain', d.terrain?.toString())}
                                    {this.renderRow('Favoris', d.favorites_count?.toString())}
                                    {this.renderRow('Logs', d.logs_count?.toString())}
                                    {this.renderRow('Placée le', d.placed_at)}
                                    {this.renderRow('Statut', d.status)}
                                    {this.renderRow('Lien', d.url ? <a href={d.url} target='_blank' rel='noreferrer'>{d.url}</a> : undefined)}
                                </tbody>
                            </table>
                        </details>

                        <DescriptionEditor
                            geocacheData={d}
                            geocacheId={this.geocacheId!}
                            defaultVariant={this.descriptionVariant}
                            onVariantChange={(variant) => {
                                this.descriptionVariant = variant;
                                this.update();
                            }}
                            getEffectiveDescriptionHtml={(data, variant) => this.getEffectiveDescriptionHtml(data, variant)}
                            onSaveDescription={(payload) => this.saveDescriptionOverrides(payload)}
                            onResetDescription={() => this.resetDescriptionOverrides()}
                            onTranslateToFrench={() => this.translateDescriptionToFrench()}
                            isTranslating={this.isTranslatingDescription}
                            onTranslateAllToFrench={() => this.translateAllToFrench()}
                            isTranslatingAll={this.isTranslatingAllContent}
                            externalLinksOpenMode={this.getExternalLinksOpenMode()}
                        />

                        {displayedHints ? (
                            <div>
                                <div style={{ display: 'flex', justifyContent: 'flex-start', alignItems: 'center', gap: 12 }}>
                                    <h4 style={{ margin: '8px 0' }}>Indices</h4>
                                    <button
                                        className='theia-button'
                                        onClick={() => { void this.toggleHintsDisplayMode(); }}
                                        title={displayDecodedHints ? 'Coder (ROT13)' : 'Décoder (ROT13)'}
                                    >
                                        {displayDecodedHints ? 'Coder' : 'Décoder'}
                                    </button>
                                </div>
                                <div style={{ whiteSpace: 'pre-wrap', opacity: 0.9 }}>{displayedHints}</div>
                            </div>
                        ) : undefined}

                        {this.geocacheId ? (
                            <GeocacheImagesPanel
                                backendBaseUrl={this.apiClient.getBaseUrl()}
                                geocacheId={this.geocacheId}
                                storageDefaultMode={this.getImagesStorageDefaultMode()}
                                onConfirmStoreAll={async (opts) => this.confirmStoreAllImages(opts)}
                                thumbnailSize={this.getImagesGalleryThumbnailSize()}
                                onThumbnailSizeChange={async (size) => this.setImagesGalleryThumbnailSize(size)}
                                hiddenDomains={this.getImagesGalleryHiddenDomains()}
                                hiddenDomainsText={this.getImagesGalleryHiddenDomainsText()}
                                onHiddenDomainsTextChange={async (value: string) => this.setImagesGalleryHiddenDomainsText(value)}
                                ocrDefaultEngine={this.getOcrDefaultEngine()}
                                ocrDefaultLanguage={this.getOcrDefaultLanguage()}
                                ocrLmstudioBaseUrl={this.getOcrLmstudioBaseUrl()}
                                ocrLmstudioModel={this.getOcrLmstudioModel()}
                                messages={this.messages}
                                languageModelRegistry={this.languageModelRegistry}
                                languageModelService={this.languageModelService}
                            />
                        ) : undefined}

                        <div>
                            <WaypointsEditorWrapper
                                waypoints={d.waypoints}
                                geocacheData={d}
                                onSaveWaypoint={(waypointId, payload) => this.saveWaypointFromEditor(waypointId, payload)}
                                messages={this.messages}
                                onDeleteWaypoint={this.deleteWaypoint}
                                onSetAsCorrectedCoords={this.setAsCorrectedCoords}
                                onPushWaypointToGeocaching={this.pushWaypointToGeocaching}
                                onRegisterCallback={(callback) => { this.waypointEditorCallback = callback; }}
                            />
                        </div>

                        {d.checkers && d.checkers.length > 0 ? (
                            <div>
                                <h4 style={{ margin: '8px 0' }}>Checkers</h4>
                                {this.renderCheckers(d.checkers)}
                            </div>
                        ) : undefined}
                    </div>
                )}
            </div>
        );
    }
}



