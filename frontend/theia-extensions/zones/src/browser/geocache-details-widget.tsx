import * as React from 'react';
import { injectable, inject } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { MessageService } from '@theia/core';
import { ApplicationShell, ConfirmDialog, StatefulWidget } from '@theia/core/lib/browser';
import { CommandService, CancellationTokenSource } from '@theia/core';
import { LanguageModelRegistry, LanguageModelService } from '@theia/ai-core';
import { PluginExecutorContribution } from '@mysterai/theia-plugins/lib/browser/plugins-contribution';
import { GridPuzzleWorkbenchContribution } from '@mysterai/theia-plugins/lib/browser/grid-puzzle-workbench-contribution';
import { GeocacheContext } from '@mysterai/theia-plugins/lib/browser/plugin-executor-widget';
import { FormulaSolverSolveFromGeocacheCommand } from '@mysterai/theia-formula-solver/lib/browser/formula-solver-contribution';
import { PreferenceService } from '@theia/core/lib/common/preferences/preference-service';
import URI from '@theia/core/lib/common/uri';
import { MiniBrowserOpenHandler } from '@theia/mini-browser/lib/browser/mini-browser-open-handler';
import { GeoAppChatImageContext } from './geoapp-chat-shared';
import { GeocacheImageChatSelection } from './geocache-images-panel';
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
import {
    GEOCACHE_DETAILS_TAB_CHANGED_EVENT,
    GeocacheDetailsTabChangedDetail
} from './geocache-details-tracker';
import { GeocacheTabRef } from './geocache-logs-scope';
import { GeocacheDetailsNotesController } from './geocache-details-notes-controller';
import {
    CheckerLinkOpenMode,
    GeocacheDetailsPreferencesController,
    GeocacheImagesGalleryThumbnailSize
} from './geocache-details-preferences-controller';
import { GeocacheDetailsView } from './geocache-details-view';
import { GeocachesService } from './geocaches-service';
import { GeocacheLogsFetchService } from './geocache-logs-fetch-service';
import {
    GeocacheDetailsService,
    SaveWaypointInput,
    UpdateDescriptionInput,
} from './geocache-details-service';
import { GeocacheDetailsTranslationController, TranslationProgress } from './geocache-details-translation-controller';
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
import { FreeChatDialog, FreeChatDialogResult } from './geocache-free-chat-dialog';
import { GeocacheDetailsHeaderAction, GeocacheDetailsHeaderActionRegistry } from './geocache-details-header-actions';

/**
 * Domaines qui refusent l'affichage dans une iframe (X-Frame-Options /
 * CSP frame-ancestors). Le mini-browser Theia est une iframe : ces sites y
 * affichent « a refusé de se connecter », on les ouvre donc directement
 * dans le navigateur externe.
 */
// Domaines qui refusent l'iframe du mini-navigateur (X-Frame-Options / CSP
// frame-ancestors) : ils basculent automatiquement en fenêtre externe.
const NON_FRAMABLE_DOMAINS = ['geocaching.com', 'coord.info', 'google.com', 'openstreetmap.org', 'waze.com'];

function isFramableUrl(url: string): boolean {
    try {
        const host = new URL(url).hostname.toLowerCase();
        return !NON_FRAMABLE_DOMAINS.some(domain => host === domain || host.endsWith(`.${domain}`));
    } catch {
        return true;
    }
}

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

const GEOAPP_CHAT_PROFILE_MENU_OPTIONS: Array<{ value: GeoAppChatWorkflowProfile; label: string; description: string }> = [
    { value: 'default', label: 'Auto', description: 'Profil choisi automatiquement selon le workflow détecté' },
    { value: 'fast', label: 'Fast', description: 'Modèle rapide et économique — questions simples, réponses courtes' },
    { value: 'strong', label: 'Strong', description: 'Modèle le plus puissant — raisonnement complexe, résolution multi-étapes' },
    { value: 'web', label: 'Web', description: 'Modèle avec accès web — utile pour rechercher des infos externes' },
    { value: 'local', label: 'Local', description: 'Modèle local — aucune donnée envoyée vers un service externe' },
];

interface SerializedGeocacheDetailsState {
    geocacheId?: number;
    lastAccessTimestamp?: number;
}

@injectable()
export class GeocacheDetailsWidget extends ReactWidget implements StatefulWidget {
    static readonly ID = 'geocache.details.widget';

    protected geocacheId?: number;
    /** Nom connu à l'ouverture, en attendant que la fiche soit chargée. */
    protected pendingName?: string;
    protected data?: GeocacheDto;
    protected isLoading = false;
    protected notesCount: number | undefined;
    protected waypointEditorCallback?: (prefill?: WaypointPrefillPayload) => void;
    protected isSavingWaypoint = false;
    protected interactionTimerId: number | undefined;
    /**
     * Vrai dès que l'onglet a été consulté (activé ou visible) depuis le
     * dernier `setGeocache`. Le délai « temps d'ouverture minimum » ne doit
     * épingler que les onglets réellement regardés : un onglet ouvert en
     * arrière-plan (import avec `geoApp.zones.import.openDetailsMode` à
     * `open-in-background`) et jamais consulté resterait sinon épinglé,
     * bloquant le remplacement intelligent.
     */
    protected consultedSinceSetGeocache = false;
    protected descriptionVariant: DescriptionVariant = 'original';
    protected descriptionVariantGeocacheId: number | undefined;
    protected isTranslatingDescription = false;
    protected isTranslatingAllContent = false;
    /** Source d'annulation de la traduction en cours (description seule ou tout le contenu). */
    protected translationCts: CancellationTokenSource | undefined;
    /** Progression detaillee de la traduction en cours, affichee dans la banniere. */
    protected translationProgress: TranslationProgress | undefined;
    protected lastAccessTimestamp: number = Date.now();
    protected archiveStatus: GeocacheArchiveStatus = 'none';
    protected archiveUpdatedAt: string | undefined = undefined;
    protected isSyncingArchive = false;
    /** Rafraichissement de la geocache en cours : anime l'icone du bouton de l'en-tete. */
    protected isRefreshing = false;
    protected chatWorkflowPreview: GeoAppChatWorkflowKind = 'general';
    protected chatProfilePreview: GeoAppChatProfile = 'fast';
    protected chatProfileOverride: GeoAppChatWorkflowProfile = 'default';
    protected isChatRoutingPreviewLoading = false;
    protected isChatProfileMenuOpen = false;
    protected isFreeChatDialogOpen = false;
    protected freeChatDialogDraft: string = '';
    protected freeChatDialogImageUrls: string[] = [];
    protected checkerContextMenu: { x: number; y: number; url: string } | null = null;
    protected logsSummaryEntries: import('./geocache-logs-summary').LogSummaryEntry[] = [];
    protected logsSummaryTotalCount = 0;
    protected isLogsSummaryLoading = false;
    private readonly geocacheChangeDisposable: { dispose: () => void };
    private readonly preferenceChangeDisposable: { dispose: () => void };

    /**
     * Le scroll ne sert qu'à marquer l'onglet comme « consulté » (pin smart-replace) :
     * une seule émission par fiche suffit, inutile de dispatcher un événement à
     * chaque tick de scroll. Réarmé dans `setGeocache`.
     */
    private hasEmittedScrollInteraction = false;

    private readonly handleContentClick = (): void => {
        this.emitInteraction('click');
    };

    private readonly handleContentScroll = (): void => {
        if (this.hasEmittedScrollInteraction) {
            return;
        }
        this.hasEmittedScrollInteraction = true;
        this.emitInteraction('scroll');
    };

    // Map pour stocker les métadonnées GeoApp des sessions de chat
    constructor(
        @inject(MessageService) protected readonly messages: MessageService,
        @inject(ApplicationShell) protected readonly shell: ApplicationShell,
        @inject(PluginExecutorContribution) protected readonly pluginExecutorContribution: PluginExecutorContribution,
        @inject(GridPuzzleWorkbenchContribution) protected readonly gridPuzzleWorkbenchContribution: GridPuzzleWorkbenchContribution,
        @inject(CommandService) protected readonly commandService: CommandService,
        @inject(PreferenceService) protected readonly preferenceService: PreferenceService,
        @inject(LanguageModelRegistry) protected readonly languageModelRegistry: LanguageModelRegistry,
        @inject(LanguageModelService) protected readonly languageModelService: LanguageModelService,
        @inject(BackendApiClient) protected readonly apiClient: BackendApiClient,
        @inject(GeocachesService) protected readonly geocachesService: GeocachesService,
        @inject(GeocacheDetailsService) protected readonly geocacheDetailsService: GeocacheDetailsService,
        @inject(GeocacheLogsFetchService) protected readonly logsFetchService: GeocacheLogsFetchService,
        @inject(GeocacheDetailsArchiveController) protected readonly archiveController: GeocacheDetailsArchiveController,
        @inject(GeocacheDetailsChatController) protected readonly chatController: GeocacheDetailsChatController,
        @inject(GeocacheDetailsContentController) protected readonly contentController: GeocacheDetailsContentController,
        @inject(GeocacheDetailsNavigationController) protected readonly navigationController: GeocacheDetailsNavigationController,
        @inject(GeocacheDetailsNotesController) protected readonly notesController: GeocacheDetailsNotesController,
        @inject(GeocacheDetailsPreferencesController) protected readonly preferencesController: GeocacheDetailsPreferencesController,
        @inject(GeocacheDetailsTranslationController) protected readonly translationController: GeocacheDetailsTranslationController,
        @inject(GeocacheDetailsHeaderActionRegistry) protected readonly headerActionRegistry: GeocacheDetailsHeaderActionRegistry,
        @inject(GeoAppWidgetEventsService) protected readonly widgetEventsService: GeoAppWidgetEventsService,
        @inject(MiniBrowserOpenHandler) protected readonly miniBrowserOpenHandler: MiniBrowserOpenHandler
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
        // Synchronise le cache des sections repliées si la préférence change
        // ailleurs (autre fiche détail ouverte, édition via les settings).
        this.preferenceChangeDisposable = this.preferenceService.onPreferenceChanged(event => {
            if (event.preferenceName === 'geoApp.geocache.details.collapsedSections') {
                this.collapsedSections = undefined;
                this.update();
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
        this.preferenceChangeDisposable.dispose();
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
            this.interactionTimerId = undefined;
            if (this.consultedSinceSetGeocache) {
                this.emitInteraction('min-open-time');
            }
        }, timeoutSeconds * 1000);
    }

    private clearMinOpenTimeTimer(): void {
        if (this.interactionTimerId !== undefined) {
            window.clearTimeout(this.interactionTimerId);
            this.interactionTimerId = undefined;
        }
    }

    private notifyGeocacheChanged(reason: 'waypoint-created' | 'waypoint-deleted' | 'corrected-coordinates-updated' | 'solved-status-updated'): void {
        if (!this.geocacheId) {
            return;
        }
        // Le listing a change : l'apercu de routage du chat cache pour cette geocache
        // n'est plus fiable, on le laisse se recalculer au prochain refresh.
        this.chatController.invalidateRoutingPreview(this.geocacheId);
        this.widgetEventsService.notifyGeocacheChanged({
            geocacheId: this.geocacheId,
            reason,
            source: 'details'
        });
    }

    private async saveWaypointFromEditor(
        waypointId: number | 'new' | undefined,
        payload: SaveWaypointInput
    ): Promise<number | undefined> {
        if (!this.geocacheId) {
            throw new Error('Aucune géocache chargée');
        }

        try {
            const isNew = waypointId === 'new' || waypointId === undefined;
            const result = await this.geocacheDetailsService.saveWaypoint<{ id?: number }>(this.geocacheId, waypointId, payload);
            await this.load({ secondary: false });
            this.notifyGeocacheChanged(isNew ? 'waypoint-created' : 'corrected-coordinates-updated');
            this.messages.info('Waypoint sauvegardé');
            return isNew ? result?.id : undefined;
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
            await this.load({ secondary: false });
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
            await this.load({ secondary: false });
            this.messages.info('Description, indices et notes de waypoints réinitialisés');
        } catch (error) {
            console.error('[GeocacheDetailsWidget] resetDescriptionOverrides error', error);
            this.messages.error(getErrorMessage(error, 'Erreur lors de la réinitialisation'));
            throw error;
        }
    }

    private async saveCoordinates(coordinatesRaw: string): Promise<void> {
        if (!this.geocacheId) {
            throw new Error('Aucune géocache chargée');
        }

        try {
            await this.geocachesService.updateCoordinates(this.geocacheId, coordinatesRaw);
            await this.load({ secondary: false });
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
            await this.load({ secondary: false });
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
            this.notifyGeocacheChanged('solved-status-updated');
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
            await this.load({ secondary: false });
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


        // Ouvrir le Plugin Executor avec ce contexte
        this.pluginExecutorContribution.openWithContext(context);
    };

    protected analyzePage = (): void => {
        const context = this.buildPluginExecutorContext();
        if (!context) {
            return;
        }

        void this.pluginExecutorContribution.openWithContext(context, 'analysis_web_page', true, true);
    };

    protected analyzeCode = (): void => {
        const context = this.buildPluginExecutorContext();
        if (!context) {
            return;
        }

        void this.pluginExecutorContribution.openWithContext(context, 'metasolver', false);
    };

    protected openGridPuzzleWorkbench = (): void => {
        const context = this.buildPluginExecutorContext();
        if (!context) {
            return;
        }

        void this.gridPuzzleWorkbenchContribution.openWithContext(context);
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

    /**
     * Identité de la géocache de cet onglet, pour les panneaux qui la suivent
     * (panneau Logs). Le code et le nom ne sont connus qu'une fois la fiche
     * chargée : d'ici là, seul l'identifiant est sûr — et le nom passé à
     * l'ouverture, quand l'appelant le connaissait déjà.
     */
    getGeocacheRef(): GeocacheTabRef | undefined {
        if (!this.geocacheId) {
            return undefined;
        }
        const loaded = this.data?.id === this.geocacheId ? this.data : undefined;
        return {
            geocacheId: this.geocacheId,
            gcCode: loaded?.gc_code,
            name: loaded?.name ?? this.pendingName
        };
    }

    /**
     * Signale le changement de géocache de cet onglet.
     *
     * Le shell ne dit rien quand un onglet change de contenu sans changer de
     * place — ce que fait précisément le remplacement intelligent.
     */
    protected notifyTabChanged(): void {
        if (typeof window === 'undefined' || !this.id) {
            return;
        }
        window.dispatchEvent(new CustomEvent<GeocacheDetailsTabChangedDetail>(
            GEOCACHE_DETAILS_TAB_CHANGED_EVENT,
            { detail: { widgetId: this.id } }
        ));
    }

    setGeocache(context: { geocacheId: number; name?: string }): void {
        this.geocacheId = context.geocacheId;
        this.pendingName = context.name;
        // Un onglet déjà affiché est considéré comme consulté d'emblée ; un
        // onglet pas encore attaché le devient via `onActivateRequest`.
        this.consultedSinceSetGeocache = this.isVisible;
        this.lastAccessTimestamp = Date.now();
        this.notesCount = undefined;
        this.hasEmittedScrollInteraction = false;
        this.archiveStatus = 'none';
        this.archiveUpdatedAt = undefined;
        this.logsSummaryEntries = [];
        this.logsSummaryTotalCount = 0;
        if (context.name) {
            this.title.label = `Géocache - ${context.name}`;
        } else if (this.data?.name) {
            this.title.label = `Géocache - ${this.data.name}`;
        } else {
            this.title.label = `Géocache - ${this.geocacheId}`;
        }
        this.setupMinOpenTimeTimer();
        this.notifyTabChanged();
        this.update();
        this.load();
    }

    /**
     * Appelé quand le widget devient actif
     * Réactive automatiquement la carte correspondante
     */
    protected onActivateRequest(msg: any): void {
        super.onActivateRequest(msg);
        if (!this.consultedSinceSetGeocache) {
            this.consultedSinceSetGeocache = true;
            // Onglet ouvert en arrière-plan puis consulté après l'expiration du
            // délai : on le relance pour que le compte reparte de la 1re vue.
            if (this.interactionTimerId === undefined) {
                this.setupMinOpenTimeTimer();
            }
        }
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

        // On capture l'id dès le départ : l'appel LLM est long et l'utilisateur peut changer de
        // géocache pendant ce temps. Sans cette garde, on basculerait la variante et rechargerait
        // la *nouvelle* géocache au retour, corrompant son état.
        const geocacheId = this.geocacheId;

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
        this.translationCts = new CancellationTokenSource();
        this.translationProgress = undefined;
        this.update();

        try {
            await this.translationController.translateDescription(
                geocacheId,
                sourceHtml,
                this.translationCts.token,
                progress => {
                    this.translationProgress = progress;
                    this.update();
                }
            );
            // L'utilisateur a pu changer de géocache pendant l'appel LLM : on ne touche pas à
            // l'état de la géocache actuellement affichée.
            if (this.geocacheId !== geocacheId) {
                return;
            }
            this.descriptionVariant = 'modified';
            this.chatController.invalidateRoutingPreview(geocacheId);
            await this.load({ secondary: false });
            this.messages.info('Traduction enregistrée dans la description modifiée');
        } catch (e) {
            if (this.translationCts?.token.isCancellationRequested) {
                this.messages.info('Traduction annulée');
            } else {
                console.error('[GeocacheDetailsWidget] translateDescriptionToFrench error', e);
                this.messages.error(getErrorMessage(e, 'Traduction IA: erreur'));
            }
        } finally {
            this.isTranslatingDescription = false;
            this.translationCts = undefined;
            this.translationProgress = undefined;
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

    /**
     * Recharge la fiche. `secondary: false` saute les chargements qui ne dépendent
     * pas des mutations locales (synchro de la note perso vers GC.com, aperçu de
     * routage du chat) : réservé aux rechargements après une édition dans la fiche.
     * Le premier chargement et les modifications externes restent en `secondary: true`.
     */
    protected async load(options?: { secondary?: boolean }): Promise<void> {
        if (!this.geocacheId) { return; }
        const secondary = options?.secondary !== false;
        const geocacheId = this.geocacheId;
        this.isLoading = true;
        this.update();
        try {
            const recentLogsCount = this.preferenceService.get<number>('geoApp.logs.recentSummaryCount', 5);
            this.data = await this.geocachesService.get<GeocacheDto>(geocacheId, { recentLogsCount });
            if (this.data && this.descriptionVariantGeocacheId !== geocacheId) {
                this.descriptionVariant = this.preferencesController.getDefaultDescriptionVariant(this.data);
                this.descriptionVariantGeocacheId = geocacheId;
            }
            this.title.label = `Géocache - ${this.data?.name ?? this.data?.gc_code ?? geocacheId}`;
            // Le code GC et le nom n'étaient pas connus au `setGeocache` : les
            // panneaux qui suivent cet onglet peuvent enfin les afficher.
            this.notifyTabChanged();

            // Données principales prêtes : on masque l'overlay et on rend une seule fois.
            // Les chargements secondaires partent ensuite en parallèle ; leurs préfixes
            // synchrones (mise en état « chargement ») fusionnent en un seul render (conflation
            // Lumino), puis chacun rafraîchit l'UI dès qu'il aboutit (affichage progressif).
            this.isLoading = false;
            this.update();

            // Extras embarqués dans la réponse principale (`?details_extras=1`) : un seul
            // aller-retour au lieu de requêtes dédiées. Repli sur les endpoints séparés
            // si le backend ne les fournit pas.
            if (typeof this.data.notes_count === 'number') {
                this.notesCount = this.data.notes_count;
            } else {
                this.loadNotesCount(geocacheId);
            }
            if (this.data.recent_logs_summary) {
                this.logsSummaryEntries = this.data.recent_logs_summary.entries;
                this.logsSummaryTotalCount = this.data.recent_logs_summary.total_count;
                this.isLogsSummaryLoading = false;
                this.update();
            } else {
                void this.loadLogsSummary();
            }
            if (secondary) {
                void this.notesController.autoSyncFromDetailsIfEnabled(geocacheId).catch(err => {
                    console.error('[GeocacheDetailsWidget] Auto-sync note Geocaching.com échouée:', err);
                });
                void this.refreshChatRoutingPreview();
            }
            // Le statut d'archive reflète les mutations (coordonnées corrigées,
            // description modifiée rendent l'archive obsolète) : toujours rechargé.
            void this.loadArchiveStatus();
        } catch (e) {
            // eslint-disable-next-line no-console
            console.error('GeocacheDetailsWidget: load error', e);
            this.messages.error(getErrorMessage(e, 'Impossible de charger la géocache'));
            this.isLoading = false;
            this.update();
        }
    }

    private loadNotesCount(geocacheId: number): void {
        this.notesController.loadNotesCount(geocacheId)
            .then(count => {
                // Ignorer si l'utilisateur a changé de géocache entre-temps.
                if (this.geocacheId !== geocacheId) { return; }
                this.notesCount = count;
                this.update();
            })
            .catch(err => {
                console.error('[GeocacheDetailsWidget] loadNotesCount error', err);
            });
    }

    protected async loadLogsSummary(allowAutoFetch: boolean = true): Promise<void> {
        if (!this.geocacheId) { return; }
        const geocacheId = this.geocacheId;
        this.isLogsSummaryLoading = true;
        this.update();
        try {
            const count = this.preferenceService.get<number>('geoApp.logs.recentSummaryCount', 5);
            const data = await this.geocacheDetailsService.getRecentLogsSummary(geocacheId, count);
            // Ignorer si l'utilisateur a changé de géocache entre-temps.
            if (this.geocacheId !== geocacheId) { return; }
            if (data) {
                this.logsSummaryEntries = data.entries;
                this.logsSummaryTotalCount = data.total_count;
                if (allowAutoFetch) {
                    void this.autoFetchLogsInBackground(geocacheId, data.total_count);
                }
            }
        } catch (e) {
            console.error('[GeocacheDetailsWidget] loadLogsSummary error', e);
        } finally {
            this.isLogsSummaryLoading = false;
            this.update();
        }
    }

    /**
     * Premier chargement des logs en tâche de fond, quand le réglage
     * `geoApp.logs.autoFetchTrigger` le confie à l'ouverture de la géocache.
     *
     * Volontairement muet : l'utilisateur regarde la fiche, pas les logs. Le
     * résumé se remplit tout seul quand la récupération aboutit, et le service
     * garantit qu'on ne scrape ni deux fois la même cache, ni plusieurs caches
     * en parallèle quand on enchaîne les ouvertures.
     */
    protected async autoFetchLogsInBackground(geocacheId: number, storedCount: number): Promise<void> {
        const result = await this.logsFetchService.autoFetch('geocache-open', geocacheId, storedCount);
        if (!result || result.added === 0 || this.geocacheId !== geocacheId) {
            return;
        }
        await this.loadLogsSummary(false);
    }

    protected async loadArchiveStatus(): Promise<void> {
        // Capture dès le départ : l'utilisateur peut changer de géocache pendant l'appel.
        const geocacheId = this.geocacheId;
        const gcCode = this.data?.gc_code;
        if (!gcCode) {
            this.applyArchiveState({ status: 'none' });
            return;
        }
        this.archiveStatus = 'loading';
        this.update();
        try {
            const archiveState = await this.archiveController.loadArchiveState(gcCode);
            // Ignorer si l'utilisateur a changé de géocache entre-temps.
            if (this.geocacheId !== geocacheId) { return; }
            this.applyArchiveState(archiveState);
        } catch {
            if (this.geocacheId !== geocacheId) { return; }
            this.applyArchiveState({ status: 'none' });
        }
        this.update();
    }

    protected openCheckerUrl = async (url: string, mode: CheckerLinkOpenMode): Promise<void> => {
        this.checkerContextMenu = null;
        this.update();
        if (mode === 'external-window' || !isFramableUrl(url)) {
            window.open(url, '_blank', 'noopener,noreferrer');
            return;
        }
        try {
            const uri = new URI(url);
            if (mode === 'new-group') {
                await this.miniBrowserOpenHandler.open(uri, { widgetOptions: { mode: 'split-right' } });
            } else {
                await this.miniBrowserOpenHandler.open(uri);
            }
        } catch (e) {
            console.error('[GeocacheDetailsWidget] openCheckerUrl error', e);
            window.open(url, '_blank');
        }
    };

    /** Liens externes (description, fiche GC.com) : mini-browser ou externe selon la préférence `externalLinks.openMode`. */
    protected openExternalLink = (url: string): void => {
        void this.openCheckerUrl(url, this.preferencesController.getExternalLinksOpenMode());
    };

    protected showCheckerContextMenu = (x: number, y: number, url: string): void => {
        this.checkerContextMenu = { x, y, url };
        this.update();
    };

    protected closeCheckerContextMenu = (): void => {
        this.checkerContextMenu = null;
        this.update();
    };

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
            await this.load({ secondary: false });
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
            // Garantir un workflow a jour meme si l'apercu de routage initial n'est pas
            // encore resolu (clic rapide apres l'ouverture). L'appel est mis en cache.
            const routing = await this.chatController.resolveRoutingPreview(this.geocacheId);
            this.chatWorkflowPreview = routing.workflowPreview;
            this.chatProfilePreview = routing.profilePreview;
            this.chatController.openGeocacheChat(this.data, routing.workflowPreview, this.chatProfileOverride);
            this.messages.info('Chat IA lance pour cette geocache.');
        } catch (error) {
            console.error('[GeocacheDetailsWidget] openGeocacheAIChat error', error);
            this.messages.error('Impossible d\'ouvrir le chat IA pour cette geocache.');
        }
    };

    private openFreeChatDialog = async (): Promise<void> => {
        if (!this.geocacheId || !this.data) {
            this.messages.warn('Aucune geocache selectionnee pour ouvrir le Chat Libre.');
            return;
        }
        this.freeChatDialogDraft = this.chatController.buildFreeChatDraft(this.data);
        this.freeChatDialogImageUrls = await this.loadFreeChatImageUrls();
        this.isChatProfileMenuOpen = false;
        this.isFreeChatDialogOpen = true;
        this.update();
    };

    private async loadFreeChatImageUrls(): Promise<string[]> {
        const legacyUrls = (this.data?.images || []).map(img => img.url).filter(Boolean);
        if (!this.geocacheId) {
            return legacyUrls;
        }

        try {
            const backendBaseUrl = this.apiClient.getBaseUrl();
            const res = await fetch(`${backendBaseUrl}/api/geocaches/${this.geocacheId}/images`, { credentials: 'include' });
            if (!res.ok) {
                return legacyUrls;
            }

            const images = await res.json() as Array<{ url?: string; source_url?: string }>;
            const urls = images
                .map(img => (img.url || img.source_url || '').trim())
                .filter(Boolean)
                .map(url => url.startsWith('/') ? `${backendBaseUrl}${url}` : url);
            return urls.length ? urls : legacyUrls;
        } catch (error) {
            console.warn('[GeocacheDetailsWidget] loadFreeChatImageUrls error', error);
            return legacyUrls;
        }
    }

    private closeFreeChatDialog = (): void => {
        this.isFreeChatDialogOpen = false;
        this.update();
    };

    private confirmFreeChat = (result: FreeChatDialogResult): void => {
        if (!this.data) { return; }
        this.isFreeChatDialogOpen = false;
        this.chatController.openFreeChat(this.data, result.draft, result.imageUrls, result.profile);
        this.update();
    };

    private openSelectedImagesChat = async (images: GeocacheImageChatSelection[]): Promise<void> => {
        if (!this.data) {
            this.messages.warn('Aucune geocache selectionnee pour analyser les images.');
            return;
        }
        const imageContexts: GeoAppChatImageContext[] = images.map(image => ({
            url: image.url,
            origin: image.origin,
            id: String(image.id),
            label: `${image.originLabel} - ${image.title || `Image ${image.id}`}`,
            description: image.note || undefined,
        }));
        if (!imageContexts.length) {
            this.messages.warn('Aucune image selectionnee ne peut etre envoyee au chat.');
            return;
        }
        this.chatController.openImagesChat(this.data, imageContexts, this.chatProfileOverride);
        this.messages.info(`${imageContexts.length} image(s) envoyee(s) au chat.`);
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

        // Même garde que translateDescriptionToFrench : l'appel LLM est long, l'utilisateur peut
        // changer de géocache entre-temps.
        const geocacheId = this.geocacheId;

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
        this.translationCts = new CancellationTokenSource();
        this.translationProgress = undefined;
        this.update();

        try {
            const result = await this.translationController.translateAllContent({
                geocacheId,
                descriptionHtml: sourceHtml,
                hintsDecoded: sourceHints,
                waypoints: sourceWaypoints,
            }, this.translationCts.token, progress => {
                this.translationProgress = progress;
                this.update();
            });
            // L'utilisateur a pu changer de géocache pendant l'appel LLM : on ne touche pas à
            // l'état de la géocache actuellement affichée.
            if (this.geocacheId !== geocacheId) {
                return;
            }
            this.descriptionVariant = 'modified';
            this.chatController.invalidateRoutingPreview(geocacheId);
            await this.load({ secondary: false });
            if (result.failed.length > 0) {
                this.messages.warn(
                    `Traduction partielle : ${result.translated.join(', ')} enregistré(s), non traduit : ${result.failed.join(', ')}`
                );
            } else {
                this.messages.info(`Traduction enregistrée (${result.translated.join(', ')})`);
            }
        } catch (e) {
            if (this.translationCts?.token.isCancellationRequested) {
                this.messages.info('Traduction annulée');
            } else {
                console.error('[GeocacheDetailsWidget] translateAllToFrench error', e);
                this.messages.error(getErrorMessage(e, 'Traduction IA: erreur'));
            }
        } finally {
            this.isTranslatingAllContent = false;
            this.translationCts = undefined;
            this.translationProgress = undefined;
            this.update();
        }
    }

    /**
     * Annule la traduction IA en cours (description seule ou tout le contenu). Sans effet si
     * aucune traduction n'est active.
     */
    public cancelTranslation(): void {
        if (this.translationCts) {
            this.translationCts.cancel();
        }
    }

    private toggleHintsDisplayMode = async (): Promise<void> => {
        await this.preferencesController.toggleHintsDisplayMode();
        this.update();
    };

    private refreshGeocache = async (): Promise<void> => {
        if (!this.geocacheId || this.isRefreshing) {
            return;
        }
        // L'état « en cours » est porté par l'icône animée du bouton, pas par une notification.
        this.isRefreshing = true;
        this.update();
        try {
            await this.geocachesService.refresh(this.geocacheId);
            await this.load();
            window.dispatchEvent(new CustomEvent('geoapp-geocache-images-updated', { detail: { geocacheId: this.geocacheId } }));
            // Notifier les onglets de zone ouverts pour qu'ils reflètent les données rafraîchies
            this.widgetEventsService.requestZonesRefresh();
            this.messages.info('Géocache rafraîchie');
        } catch (error) {
            console.error('[GeocacheDetailsWidget] refreshGeocache error', error);
            this.messages.error(getErrorMessage(error, 'Erreur lors du rafraîchissement'));
        } finally {
            this.isRefreshing = false;
            this.update();
        }
    };

    /**
     * GUID Geocaching du proprietaire, pour le menu contextuel du nom.
     *
     * Les geocaches importees avant l'ajout de la colonne `owner_guid` n'en ont
     * pas : le backend relit alors le bloc proprietaire du listing et le
     * memorise, si bien que ce rattrapage ne coute qu'une fois par cache.
     */
    private resolveOwnerGuid = async (): Promise<string | undefined> => {
        const geocacheId = this.geocacheId;
        if (!geocacheId) {
            return undefined;
        }
        try {
            const identity = await this.geocacheDetailsService.getOwnerIdentity(geocacheId);
            const guid = identity?.owner_guid || undefined;
            // La cache affichee a pu changer pendant l'appel reseau.
            if (this.geocacheId === geocacheId && this.data) {
                if (guid) {
                    this.data.owner_guid = guid;
                }
                if (identity?.owner) {
                    this.data.owner = identity.owner;
                }
                this.update();
            }
            if (!guid) {
                this.messages.warn('Profil du proprietaire introuvable sur la page de la geocache');
            }
            return guid;
        } catch (error) {
            console.error('[GeocacheDetailsWidget] resolveOwnerGuid error', error);
            this.messages.error(getErrorMessage(error, 'Erreur lors de la recuperation du profil du proprietaire'));
            return undefined;
        }
    };

    private openOwnerUrl = (url: string): void => {
        window.open(url, '_blank', 'noopener,noreferrer');
    };

    private openGeocachePage = (): void => {
        const url = this.data?.url;
        if (url) {
            this.openExternalLink(url);
        }
    };

    /** Chargement lazy des notes pour l'aperçu dépliable sous le header. */
    private fetchNotesForPreview = (): Promise<import('./geocache-notes-types').GeocacheNotesApiResponse> =>
        this.notesController.loadNotes(this.geocacheId!);

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

    private closeChatProfileMenu = (): void => {
        if (!this.isChatProfileMenuOpen) {
            return;
        }
        this.isChatProfileMenuOpen = false;
        this.update();
    };

    private async refreshChatRoutingPreview(): Promise<void> {
        // Capture dès le départ : l'utilisateur peut changer de géocache pendant l'appel.
        const geocacheId = this.geocacheId;
        this.isChatRoutingPreviewLoading = true;
        this.update();
        try {
            const routingState = await this.chatController.resolveRoutingPreview(
                geocacheId && this.data ? geocacheId : undefined
            );
            // Ignorer si l'utilisateur a changé de géocache entre-temps.
            if (this.geocacheId !== geocacheId) { return; }
            this.chatWorkflowPreview = routingState.workflowPreview;
            this.chatProfilePreview = routingState.profilePreview;
        } catch (error) {
            console.warn('[GeocacheDetailsWidget] refreshChatRoutingPreview error', error);
            const routingState = await this.chatController.resolveRoutingPreview(undefined);
            if (this.geocacheId !== geocacheId) { return; }
            this.chatWorkflowPreview = routingState.workflowPreview;
            this.chatProfilePreview = routingState.profilePreview;
        } finally {
            this.isChatRoutingPreviewLoading = false;
            this.update();
        }
    }

    // --- Wrappers a reference stable ---------------------------------------------------------
    // Ces champs arrow sont crees une seule fois par instance, contrairement aux fermetures
    // inline dans render(). Ils permettent a React.memo (cf. geocache-details-view) d'eviter de
    // re-rendre les composants feuilles couteux a chaque update() (ouverture de menu, etc.).
    private readonly handleSaveCoordinates = (coordinatesRaw: string): Promise<void> => this.saveCoordinates(coordinatesRaw);
    private readonly handleResetCoordinates = (): Promise<void> => this.resetCoordinates();
    private readonly handlePushCorrectedCoordinates = (): Promise<void> => this.pushCorrectedCoordinatesToGeocaching();
    private readonly handleUpdateSolvedStatus = (newStatus: 'not_solved' | 'in_progress' | 'solved'): Promise<void> =>
        this.updateSolvedStatus(newStatus);

    private readonly handleDescriptionVariantChange = (variant: DescriptionVariant): void => {
        this.descriptionVariant = variant;
        this.update();
    };
    private readonly handleGetEffectiveDescriptionHtml = (data: GeocacheDto, variant: DescriptionVariant): string =>
        this.contentController.getEffectiveDescriptionHtml(data, variant);
    private readonly handleSaveDescription = (payload: UpdateDescriptionInput): Promise<void> => this.saveDescriptionOverrides(payload);
    private readonly handleResetDescription = (): Promise<void> => this.resetDescriptionOverrides();
    private readonly handleTranslateDescription = (): Promise<void> => this.translateDescriptionToFrench();
    private readonly handleTranslateAll = (): Promise<void> => this.translateAllToFrench();
    private readonly handleCancelTranslation = (): void => this.cancelTranslation();

    private readonly handleConfirmStoreAllImages = (opts: { geocacheId: number; pendingCount: number }): Promise<boolean> =>
        this.confirmStoreAllImages(opts);
    private readonly handleThumbnailSizeChange = async (size: GeocacheImagesGalleryThumbnailSize): Promise<void> => {
        await this.preferencesController.setImagesGalleryThumbnailSize(size);
        this.update();
    };
    private readonly handleHiddenDomainsTextChange = async (value: string): Promise<void> => {
        await this.preferencesController.setImagesGalleryHiddenDomainsText(value);
        this.update();
    };

    private readonly handleSaveWaypoint = (
        waypointId: number | 'new' | undefined,
        payload: SaveWaypointInput
    ): Promise<number | undefined> => this.saveWaypointFromEditor(waypointId, payload);
    private readonly handleRegisterWaypointCallback = (callback: (prefill?: WaypointPrefillPayload) => void): void => {
        this.waypointEditorCallback = callback;
    };

    // Cache du tableau hiddenDomains : le getter de preference recree un tableau a chaque appel,
    // ce qui casserait la comparaison shallow de React.memo. On ne recalcule que si le texte change.
    private cachedHiddenDomainsText = '\u0000';
    private cachedHiddenDomains: string[] = [];
    private getStableHiddenDomains(): string[] {
        const text = this.preferencesController.getImagesGalleryHiddenDomainsText();
        if (text !== this.cachedHiddenDomainsText) {
            this.cachedHiddenDomainsText = text;
            this.cachedHiddenDomains = this.preferencesController.getImagesGalleryHiddenDomains();
        }
        return this.cachedHiddenDomains;
    }

    /** Sections repliées de la fiche (persisté en préférence, chargé une fois). */
    private collapsedSections?: Set<string>;
    private getCollapsedSections(): Set<string> {
        if (!this.collapsedSections) {
            this.collapsedSections = new Set(this.preferencesController.getCollapsedSections());
        }
        return this.collapsedSections;
    }

    private handleSectionCollapsedChange = (sectionId: string, collapsed: boolean): void => {
        const sections = this.getCollapsedSections();
        if (collapsed) {
            sections.add(sectionId);
        } else {
            sections.delete(sectionId);
        }
        void this.preferencesController.setCollapsedSections(Array.from(sections));
        this.update();
    };

    // Cache des actions de header : getActions() retourne un nouveau tableau à
    // chaque appel, ce qui casserait React.memo sur le header. On ne recalcule
    // que lorsque l'objet geocacheData change (les contributions sont enregistrées
    // au démarrage et ne varient pas en cours de session).
    private cachedExtraActionsFor?: GeocacheDto;
    private cachedExtraActions: GeocacheDetailsHeaderAction[] = [];
    private getStableExtraActions(d: GeocacheDto): GeocacheDetailsHeaderAction[] {
        if (d !== this.cachedExtraActionsFor) {
            this.cachedExtraActionsFor = d;
            this.cachedExtraActions = this.headerActionRegistry.getActions({ geocacheData: d });
        }
        return this.cachedExtraActions;
    }

    protected render(): React.ReactNode {
        const d = this.data;
        const displayDecodedHints = this.preferencesController.getDisplayDecodedHints();
        const displayedHints = this.contentController.getDisplayedHints(d, displayDecodedHints);
        return (
            <>
            <GeocacheDetailsView
                isLoading={this.isLoading}
                geocacheData={d}
                apiBaseUrl={this.apiClient.getBaseUrl()}
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
                    onOpenGridPuzzle: this.openGridPuzzleWorkbench,
                    onOpenAiChat: this.openGeocacheAIChat,
                    onOpenFreeChat: this.openFreeChatDialog,
                    onToggleChatProfileMenu: this.toggleChatProfileMenu,
                    onSelectChatProfileOverride: this.selectChatProfileOverride,
                    onCloseChatProfileMenu: this.closeChatProfileMenu,
                    onOpenLogs: this.openLogs,
                    onOpenLogEditor: this.openLogEditor,
                    onOpenNotes: this.openNotes,
                    onForceSyncArchive: this.forceSyncArchive,
                    onResolveOwnerGuid: this.resolveOwnerGuid,
                    onOpenOwnerUrl: this.openOwnerUrl,
                    onOpenGeocachePage: this.openGeocachePage,
                    extraActions: this.getStableExtraActions(d!),
                }}
                coordinatesEditorProps={{
                    geocacheData: d!,
                    gcCode: d?.gc_code,
                    onSaveCoordinates: this.handleSaveCoordinates,
                    onResetCoordinates: this.handleResetCoordinates,
                    onPushCorrectedCoordinates: this.handlePushCorrectedCoordinates,
                    onUpdateSolvedStatus: this.handleUpdateSolvedStatus,
                    onOpenExternalUrl: this.openExternalLink,
                }}
                descriptionEditorProps={{
                    geocacheData: d!,
                    geocacheId: this.geocacheId!,
                    defaultVariant: this.descriptionVariant,
                    onVariantChange: this.handleDescriptionVariantChange,
                    getEffectiveDescriptionHtml: this.handleGetEffectiveDescriptionHtml,
                    onSaveDescription: this.handleSaveDescription,
                    onResetDescription: this.handleResetDescription,
                    onTranslateToFrench: this.handleTranslateDescription,
                    isTranslating: this.isTranslatingDescription,
                    onTranslateAllToFrench: this.handleTranslateAll,
                    isTranslatingAll: this.isTranslatingAllContent,
                    onCancelTranslation: this.handleCancelTranslation,
                    translationProgress: this.translationProgress,
                    targetLanguage: this.preferencesController.getTranslationTargetLanguage(),
                    onOpenExternalUrl: this.openExternalLink,
                }}
                displayedHints={displayedHints}
                displayDecodedHints={displayDecodedHints}
                onToggleHintsDisplayMode={this.toggleHintsDisplayMode}
                imagesPanelProps={this.geocacheId ? {
                    backendBaseUrl: this.apiClient.getBaseUrl(),
                    geocacheId: this.geocacheId,
                    storageDefaultMode: this.preferencesController.getImagesStorageDefaultMode(),
                    onConfirmStoreAll: this.handleConfirmStoreAllImages,
                    thumbnailSize: this.preferencesController.getImagesGalleryThumbnailSize(),
                    onThumbnailSizeChange: this.handleThumbnailSizeChange,
                    hiddenDomains: this.getStableHiddenDomains(),
                    hiddenDomainsText: this.preferencesController.getImagesGalleryHiddenDomainsText(),
                    onHiddenDomainsTextChange: this.handleHiddenDomainsTextChange,
                    ocrDefaultEngine: this.preferencesController.getOcrDefaultEngine(),
                    ocrDefaultLanguage: this.preferencesController.getOcrDefaultLanguage(),
                    ocrVisionProvider: this.preferencesController.getOcrVisionProvider(),
                    ocrLmstudioBaseUrl: this.preferencesController.getOcrLmstudioBaseUrl(),
                    ocrLmstudioModel: this.preferencesController.getOcrLmstudioModel(),
                    ocrOpenRouterModel: this.preferencesController.getOcrOpenRouterModel(),
                    maxChatImages: this.preferencesController.getChatImagesRecommendedLimit(),
                    onAnalyzeImages: this.openSelectedImagesChat,
                    messages: this.messages,
                    languageModelRegistry: this.languageModelRegistry,
                    languageModelService: this.languageModelService,
                } : undefined}
                waypointsEditorProps={{
                    waypoints: d?.waypoints,
                    geocacheData: d!,
                    onSaveWaypoint: this.handleSaveWaypoint,
                    messages: this.messages,
                    onDeleteWaypoint: this.deleteWaypoint,
                    onSetAsCorrectedCoords: this.setAsCorrectedCoords,
                    onPushWaypointToGeocaching: this.pushWaypointToGeocaching,
                    onRegisterCallback: this.handleRegisterWaypointCallback,
                }}
                onRefresh={this.refreshGeocache}
                isRefreshing={this.isRefreshing}
                logsSummaryEntries={this.logsSummaryEntries}
                logsSummaryTotalCount={this.logsSummaryTotalCount}
                isLogsSummaryLoading={this.isLogsSummaryLoading}
                onOpenLogs={this.openLogs}
                notesCount={this.notesCount}
                onFetchNotes={this.fetchNotesForPreview}
                onOpenNotes={this.openNotes}
                checkerLinkOpenMode={this.preferencesController.getCheckerLinkOpenMode()}
                onOpenCheckerUrl={this.openCheckerUrl}
                checkerContextMenu={this.checkerContextMenu}
                onShowCheckerContextMenu={this.showCheckerContextMenu}
                onCloseCheckerContextMenu={this.closeCheckerContextMenu}
                collapsedSections={this.getCollapsedSections()}
                onSectionCollapsedChange={this.handleSectionCollapsedChange}
            />
            {this.isFreeChatDialogOpen && this.data ? (
                <FreeChatDialog
                    options={{
                        initialDraft: this.freeChatDialogDraft,
                        initialImageUrls: this.freeChatDialogImageUrls,
                        initialProfile: this.chatProfileOverride,
                        geocacheName: this.data.name,
                        gcCode: this.data.gc_code,
                    }}
                    onConfirm={this.confirmFreeChat}
                    onCancel={this.closeFreeChatDialog}
                />
            ) : undefined}
            </>
        );
    }
}



