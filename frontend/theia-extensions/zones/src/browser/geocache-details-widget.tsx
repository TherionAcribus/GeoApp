import * as React from 'react';
import { injectable, inject } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { MessageService } from '@theia/core';
import { ApplicationShell, ConfirmDialog, StatefulWidget } from '@theia/core/lib/browser';
import { CommandService } from '@theia/core';
import { LanguageModelRegistry, LanguageModelService } from '@theia/ai-core';
import { PluginExecutorContribution } from '@mysterai/theia-plugins/lib/browser/plugins-contribution';
import { GeocacheContext } from '@mysterai/theia-plugins/lib/browser/plugin-executor-widget';
import { FormulaSolverSolveFromGeocacheCommand } from '@mysterai/theia-formula-solver/lib/browser/formula-solver-contribution';
import { PreferenceService } from '@theia/core/lib/common/preferences/preference-service';
import { BackendApiClient, getErrorMessage } from './backend-api-client';
import {
    GeocacheArchiveStatus,
    GeocacheDetailsArchiveController
} from './geocache-details-archive-controller';
import { GeocacheDetailsChatController } from './geocache-details-chat-controller';
import {
    GeocacheDetailsContentController
} from './geocache-details-content-controller';
import { GeocacheDetailsNavigationController } from './geocache-details-navigation-controller';
import { GeocacheDetailsNotesController } from './geocache-details-notes-controller';
import { GeocacheDetailsPreferencesController } from './geocache-details-preferences-controller';
import { GeocacheDetailsView } from './geocache-details-view';
import { GeocachesService } from './geocaches-service';
import {
    GeocacheDetailsService,
    SaveWaypointInput,
    UpdateDescriptionInput,
} from './geocache-details-service';
import { GeocacheDetailsTranslationController } from './geocache-details-translation-controller';
import {
    DescriptionVariant,
    GeocacheDto,
    WaypointPrefillPayload
} from './geocache-details-types';
import {
    calculateAntipode,
    calculateProjection,
    parseGCCoords,
    toGCFormat
} from './geocache-details-utils';
import { GeoAppWidgetEventsService } from './geoapp-widget-events-service';
import {
    GeoAppChatProfile,
    GeoAppChatWorkflowProfile,
    GeoAppChatWorkflowKind
} from './geoapp-chat-agent';

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
    protected archiveStatus: GeocacheArchiveStatus = 'none';
    protected archiveUpdatedAt: string | undefined = undefined;
    protected isSyncingArchive = false;
    protected chatWorkflowPreview: GeoAppChatWorkflowKind = 'general';
    protected chatProfilePreview: GeoAppChatProfile = 'fast';
    protected chatProfileOverride: GeoAppChatWorkflowProfile = 'default';
    protected isChatRoutingPreviewLoading = false;
    protected isChatProfileMenuOpen = false;
    private readonly geocacheChangeDisposable: { dispose: () => void };

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
        @inject(GeocacheDetailsArchiveController) protected readonly archiveController: GeocacheDetailsArchiveController,
        @inject(GeocacheDetailsChatController) protected readonly chatController: GeocacheDetailsChatController,
        @inject(GeocacheDetailsContentController) protected readonly contentController: GeocacheDetailsContentController,
        @inject(GeocacheDetailsNavigationController) protected readonly navigationController: GeocacheDetailsNavigationController,
        @inject(GeocacheDetailsNotesController) protected readonly notesController: GeocacheDetailsNotesController,
        @inject(GeocacheDetailsPreferencesController) protected readonly preferencesController: GeocacheDetailsPreferencesController,
        @inject(GeocacheDetailsTranslationController) protected readonly translationController: GeocacheDetailsTranslationController,
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

        const descriptionHtml = this.contentController.getEffectiveDescriptionHtml(this.data, this.descriptionVariant);

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
            hint: this.contentController.getDecodedHints(this.data),
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
        this.navigationController.reactivateAssociatedMap(this.geocacheId);
    }

    /**
     * Fournit le contenu structuré pour la recherche in-page (SearchableWidget duck-typing).
     * Retourne les blocs de texte cherchables extraits des données de la géocache.
     */
    getSearchableContent(): { id: string; text: string; element?: HTMLElement }[] {
        return this.contentController.buildSearchableContent(this.data, this.descriptionVariant);
    }

    /**
     * Appelé quand le widget va être fermé
     * Ferme automatiquement la carte correspondante
     */
    protected onCloseRequest(msg: any): void {
        this.navigationController.closeAssociatedMap(this.geocacheId);
        super.onCloseRequest(msg);
        this.removeEventListeners();
        this.removeInteractionListeners();
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

        const sourceHtml = this.contentController.getEffectiveDescriptionHtml(this.data, 'original');
        if (!sourceHtml.trim()) {
            this.messages.warn('Description originale vide');
            return;
        }

        this.isTranslatingDescription = true;
        this.update();

        try {
            await this.translationController.translateDescription(this.geocacheId, sourceHtml);
            this.descriptionVariant = 'modified';
            await this.load();
            this.messages.info('Traduction enregistrée dans la description modifiée');
        } catch (e) {
            console.error('[GeocacheDetailsWidget] translateDescriptionToFrench error', e);
            this.messages.error(getErrorMessage(e, 'Traduction IA: erreur'));
        } finally {
            this.isTranslatingDescription = false;
            this.update();
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
                this.descriptionVariant = this.preferencesController.getDefaultDescriptionVariant(this.data);
                this.descriptionVariantGeocacheId = this.geocacheId;
            }
            this.title.label = `Géocache - ${this.data?.name ?? this.data?.gc_code ?? this.geocacheId}`;
            this.notesCount = await this.notesController.loadNotesCount(this.geocacheId);
            void this.notesController.autoSyncFromDetailsIfEnabled(this.geocacheId).catch(err => {
                console.error('[GeocacheDetailsWidget] Auto-sync note Geocaching.com échouée:', err);
            });
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
        if (!this.data?.gc_code) {
            this.applyArchiveState({ status: 'none' });
            return;
        }
        this.archiveStatus = 'loading';
        this.update();
        try {
            this.applyArchiveState(await this.archiveController.loadArchiveState(this.data.gc_code));
        } catch {
            this.applyArchiveState({ status: 'none' });
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
            const archiveState = await this.archiveController.syncArchive(gcCode);
            this.applyArchiveState(archiveState);
            if (archiveState.status === 'synced') {
                this.messages.info(`Archive ${gcCode} synchronisee`);
            }
        } catch (e) {
            this.applyArchiveState({ status: 'needs_sync' });
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

    private openGeocacheAIChat = async (): Promise<void> => {
        if (!this.geocacheId || !this.data) {
            this.messages.warn('Aucune geocache selectionnee pour ouvrir le chat IA.');
            return;
        }
        try {
            this.isChatProfileMenuOpen = false;
            this.chatController.openGeocacheChat(this.data, this.chatWorkflowPreview, this.chatProfileOverride);
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
        this.navigationController.openLogs({
            geocacheId: this.geocacheId,
            gcCode: this.data.gc_code,
            name: this.data.name
        });
    };

    private openLogEditor = (): void => {
        if (!this.geocacheId || !this.data) {
            this.messages.warn('Aucune géocache sélectionnée pour loguer.');
            return;
        }
        this.navigationController.openLogEditor({
            geocacheId: this.geocacheId,
            gcCode: this.data.gc_code
        });
    };

    /**
     * Ouvre le widget des notes pour cette géocache dans le panneau droit
     */
    private openNotes = (): void => {
        if (!this.geocacheId || !this.data) {
            this.messages.warn('Aucune géocache sélectionnée pour voir les notes.');
            return;
        }
        this.navigationController.openNotes({
            geocacheId: this.geocacheId,
            gcCode: this.data.gc_code,
            name: this.data.name
        });
    };

    private applyArchiveState(state: { status: GeocacheArchiveStatus; updatedAt?: string }): void {
        this.archiveStatus = state.status;
        this.archiveUpdatedAt = state.updatedAt;
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

        const sourceHtml = this.contentController.getEffectiveDescriptionHtml(this.data, 'original');
        const sourceHints = this.contentController.getSourceHintsForTranslation(this.data);
        const sourceWaypoints = (this.data.waypoints || []).map(w => ({
            id: w.id,
            note: (w.note || '').toString(),
        })).filter(w => typeof w.id === 'number');

        this.isTranslatingAllContent = true;
        this.update();

        try {
            await this.translationController.translateAllContent({
                geocacheId: this.geocacheId,
                descriptionHtml: sourceHtml,
                hintsDecoded: sourceHints,
                waypoints: sourceWaypoints,
            });
            this.descriptionVariant = 'modified';
            await this.load();
            this.messages.info('Traduction enregistrée (description + indices + waypoints)');
        } catch (e) {
            console.error('[GeocacheDetailsWidget] translateAllToFrench error', e);
            this.messages.error(getErrorMessage(e, 'Traduction IA: erreur'));
        } finally {
            this.isTranslatingAllContent = false;
            this.update();
        }
    }

    private toggleHintsDisplayMode = async (): Promise<void> => {
        await this.preferencesController.toggleHintsDisplayMode();
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

    private getEffectiveChatProfile(): GeoAppChatProfile {
        return this.chatController.getEffectiveChatProfile(this.chatProfilePreview, this.chatProfileOverride);
    }

    private getChatProfileOverrideLabel(): string {
        return this.chatController.getChatProfileOverrideLabel(this.chatProfilePreview, this.chatProfileOverride);
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
        this.isChatRoutingPreviewLoading = true;
        this.update();
        try {
            const routingState = await this.chatController.resolveRoutingPreview(
                this.geocacheId && this.data ? this.geocacheId : undefined
            );
            this.chatWorkflowPreview = routingState.workflowPreview;
            this.chatProfilePreview = routingState.profilePreview;
        } catch (error) {
            console.warn('[GeocacheDetailsWidget] refreshChatRoutingPreview error', error);
            const routingState = await this.chatController.resolveRoutingPreview(undefined);
            this.chatWorkflowPreview = routingState.workflowPreview;
            this.chatProfilePreview = routingState.profilePreview;
        } finally {
            this.isChatRoutingPreviewLoading = false;
            this.update();
        }
    }

    protected render(): React.ReactNode {
        const d = this.data;
        const displayDecodedHints = this.preferencesController.getDisplayDecodedHints();
        const displayedHints = this.contentController.getDisplayedHints(d, displayDecodedHints);
        return (
            <GeocacheDetailsView
                isLoading={this.isLoading}
                geocacheData={d}
                headerProps={{
                    geocacheData: d!,
                    notesCount: this.notesCount,
                    chatWorkflowPreview: this.chatWorkflowPreview,
                    chatProfilePreview: this.chatProfilePreview,
                    chatProfileOverride: this.chatProfileOverride,
                    effectiveChatProfile: this.getEffectiveChatProfile(),
                    chatProfileOverrideLabel: this.getChatProfileOverrideLabel(),
                    isChatRoutingPreviewLoading: this.isChatRoutingPreviewLoading,
                    isChatProfileMenuOpen: this.isChatProfileMenuOpen,
                    chatProfileOptions: GEOAPP_CHAT_PROFILE_MENU_OPTIONS,
                    archiveStatus: this.archiveStatus,
                    archiveUpdatedAt: this.archiveUpdatedAt,
                    isSyncingArchive: this.isSyncingArchive,
                    onSolveFormula: this.solveFormula,
                    onAnalyzePage: this.analyzePage,
                    onAnalyzeCode: this.analyzeCode,
                    onAnalyzeWithPlugins: this.analyzeWithPlugins,
                    onOpenAiChat: this.openGeocacheAIChat,
                    onToggleChatProfileMenu: this.toggleChatProfileMenu,
                    onSelectChatProfileOverride: this.selectChatProfileOverride,
                    onOpenLogs: this.openLogs,
                    onOpenLogEditor: this.openLogEditor,
                    onOpenNotes: this.openNotes,
                    onForceSyncArchive: this.forceSyncArchive,
                }}
                coordinatesEditorProps={{
                    geocacheData: d!,
                    gcCode: d?.gc_code,
                    onSaveCoordinates: (coordinatesRaw) => this.saveCoordinates(coordinatesRaw),
                    onResetCoordinates: () => this.resetCoordinates(),
                    onPushCorrectedCoordinates: () => this.pushCorrectedCoordinatesToGeocaching(),
                    onUpdateSolvedStatus: (newStatus) => this.updateSolvedStatus(newStatus),
                }}
                descriptionEditorProps={{
                    geocacheData: d!,
                    geocacheId: this.geocacheId!,
                    defaultVariant: this.descriptionVariant,
                    onVariantChange: (variant) => {
                        this.descriptionVariant = variant;
                        this.update();
                    },
                    getEffectiveDescriptionHtml: (data, variant) => this.contentController.getEffectiveDescriptionHtml(data, variant),
                    onSaveDescription: (payload) => this.saveDescriptionOverrides(payload),
                    onResetDescription: () => this.resetDescriptionOverrides(),
                    onTranslateToFrench: () => this.translateDescriptionToFrench(),
                    isTranslating: this.isTranslatingDescription,
                    onTranslateAllToFrench: () => this.translateAllToFrench(),
                    isTranslatingAll: this.isTranslatingAllContent,
                    externalLinksOpenMode: this.preferencesController.getExternalLinksOpenMode(),
                }}
                displayedHints={displayedHints}
                displayDecodedHints={displayDecodedHints}
                onToggleHintsDisplayMode={this.toggleHintsDisplayMode}
                imagesPanelProps={this.geocacheId ? {
                    backendBaseUrl: this.apiClient.getBaseUrl(),
                    geocacheId: this.geocacheId,
                    storageDefaultMode: this.preferencesController.getImagesStorageDefaultMode(),
                    onConfirmStoreAll: async (opts) => this.confirmStoreAllImages(opts),
                    thumbnailSize: this.preferencesController.getImagesGalleryThumbnailSize(),
                    onThumbnailSizeChange: async (size) => {
                        await this.preferencesController.setImagesGalleryThumbnailSize(size);
                        this.update();
                    },
                    hiddenDomains: this.preferencesController.getImagesGalleryHiddenDomains(),
                    hiddenDomainsText: this.preferencesController.getImagesGalleryHiddenDomainsText(),
                    onHiddenDomainsTextChange: async (value: string) => {
                        await this.preferencesController.setImagesGalleryHiddenDomainsText(value);
                        this.update();
                    },
                    ocrDefaultEngine: this.preferencesController.getOcrDefaultEngine(),
                    ocrDefaultLanguage: this.preferencesController.getOcrDefaultLanguage(),
                    ocrLmstudioBaseUrl: this.preferencesController.getOcrLmstudioBaseUrl(),
                    ocrLmstudioModel: this.preferencesController.getOcrLmstudioModel(),
                    messages: this.messages,
                    languageModelRegistry: this.languageModelRegistry,
                    languageModelService: this.languageModelService,
                } : undefined}
                waypointsEditorProps={{
                    waypoints: d?.waypoints,
                    geocacheData: d!,
                    onSaveWaypoint: (waypointId, payload) => this.saveWaypointFromEditor(waypointId, payload),
                    messages: this.messages,
                    onDeleteWaypoint: this.deleteWaypoint,
                    onSetAsCorrectedCoords: this.setAsCorrectedCoords,
                    onPushWaypointToGeocaching: this.pushWaypointToGeocaching,
                    onRegisterCallback: (callback) => { this.waypointEditorCallback = callback; },
                }}
            />
        );
    }
}



