import * as React from '@theia/core/shared/react';
import { injectable, inject } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { MessageService } from '@theia/core';
import { Message, StorageService } from '@theia/core/lib/browser';
import { PreferenceService } from '@theia/core/lib/common/preferences/preference-service';
import { LanguageModelRegistry, LanguageModelService } from '@theia/ai-core';
import { GeoAppLogWriterAgentId } from './geoapp-log-writer-agent';
import { AiGenerationPanel } from './log-editor/ai-generation-panel';
import { DraftBanner } from './log-editor/draft-banner';
import { GeocacheLogEditorGeocachesTable } from './log-editor/geocaches-table';
import { OutingAnalysisController } from './outing-analysis-controller';
import { OUTING_LOG_EDITOR_ZONE_NAME } from './outing-analysis-types';
import { OutingPlanService } from './outing-plan-service';
import { OutingPlanCacheFlags } from './outing-plan-types';
import {
    buildFieldNotes as buildFieldNotesPure,
    buildSubmissionSummaryNode as buildSubmissionSummaryNodePure,
    confirmSubmission as confirmSubmissionPure,
    escapeFieldNotesText,
    formatVisitedIso,
    submitOneLog,
    uploadOneLogImage as uploadOneLogImagePure,
} from './log-editor/log-submit-service';
import { MemoizedFragment } from './log-editor/memoized-fragment';
import {
    buildPatternsIndex,
    getBuiltinPatterns,
    getCacheCountForIndex,
    getLogTypeForGeocache as getLogTypeForGeocachePure,
    resolveAllPatterns as resolveAllPatternsPure,
    resolvePatternValue,
    type PatternResolutionContext,
} from './log-editor/pattern-resolver';
import {
    computeFinalLengthStats as computeFinalLengthStatsPure,
    resolveAllPatternsCached,
    resolvePatternValueCached,
} from './log-editor/pattern-resolution-cache';
import {
    addImagesToList,
    computeImagesUploadResult,
    createSelectedImagesFromFiles,
    generateImageId,
    getOrCreatePreviewUrl,
    markImageUploading,
    releaseUnusedPreviewUrls as releaseUnusedPreviewUrlsPure,
    removeImageFromList,
    resetImageForUpload,
} from './log-editor/image-manager';
import {
    buildLogSubmissionPayload,
    buildMissingTextWarning,
    buildStopMessage,
    buildSubmitSummaryMessage,
    buildTooLongTextWarning,
    validateSubmissionTexts,
} from './log-editor/submission-orchestrator';
import { SubmitProgress } from './log-editor/submit-progress';
import {
    IMAGE_FAILURE_SEND,
    IMAGE_FAILURE_SEND_ALL,
    IMAGE_FAILURE_SKIP,
    PATTERN_AUTOCOMPLETE_DELAY_MS,
} from './log-editor/constants';
import {
    getLogTypeLabel as getLogTypeLabelPure,
    isPendingDnf as isPendingDnfPure,
    sanitizeLogTypeForGeocache,
    todayIsoDate,
} from './log-editor/helpers';
import {
    GeocacheListItem,
    ImageUploadStatus,
    ImagesUploadResult,
    LogDraft,
    LogHistoryEntry,
    LogTextPattern,
    LogTypeValue,
    PatternSuggestion,
    SelectedLogImage,
    SubmissionStatus,
} from './log-editor/types';
import {
    buildDraftFromState,
    buildHistoryEntry,
    computeDraftApplication,
    computeHistoryApplication,
    computeNextHistoryCursor,
    deleteDraftFromStorage,
    getDraftKey as getDraftKeyPure,
    getLogHistoryMaxItems as getLogHistoryMaxItemsPure,
    hasDraftWorthSaving as hasDraftWorthSavingPure,
    loadLogHistory,
    persistDraftToStorage,
    pickKnownGeocacheValues as pickKnownGeocacheValuesPure,
    pruneDrafts as pruneDraftsPure,
    readDrafts as readDraftsPure,
} from './log-editor/log-history-store';
import {
    fetchGeocachesBatch,
    fetchUserStats,
    formatFavoritePercent as formatFavoritePercentPure,
    refreshUserStats,
    toGeocacheListItem as toGeocacheListItemPure,
} from './log-editor/geocache-loader';
import { generateLogWithAi as generateLogWithAiPure, NoLanguageModelError } from './log-editor/ai-log-generator';
import { PerCacheBlock } from './log-editor/per-cache-block';
import { LogEditorHeader } from './log-editor/log-editor-header';
import { PatternsSection } from './log-editor/patterns-section';
import { GlobalLogEditor } from './log-editor/global-log-editor';
import {
    addPatternToList,
    createPattern,
    deletePatternFromList,
    loadCustomPatterns,
    saveCustomPatterns,
    updatePatternInList,
} from './log-editor/pattern-store';
import {
    applySuggestionToText,
    buildPatternSuggestions,
    findPatternTokenAtCaret as findPatternTokenAtCaretPure,
    getAutocompletePosition,
} from './log-editor/pattern-autocomplete';
import {
    clampSelection,
    computeMarkdownFormatEdit,
    computeMarkdownPrefixEdit,
    computePrefixSelection,
    detectCaretFormat,
    escapeHtml as escapeHtmlPure,
} from './log-editor/markdown-editor-helpers';
import {
    MarkdownFormatKind,
    sanitizeLogUrl,
} from './log-markdown';
import '../../src/browser/style/log-editor-textarea.css';

@injectable()
export class GeocacheLogEditorWidget extends ReactWidget {
    static readonly ID = 'geocache.logEditor.widget';

    protected readonly legacyLogHistoryLocalStorageKey = 'geoApp.logs.history.v1';
    protected readonly logHistoryStorageKey = 'geoApp.logs.history.v2';
    protected readonly logHistoryMaxItemsPreferenceKey = 'geoApp.logs.history.maxItems';

    protected readonly draftsStorageKey = 'geoApp.logs.drafts.v1';
    /** Délai d'inactivité avant écriture du brouillon : assez court pour ne rien perdre, assez long pour ne pas écrire à chaque frappe. */
    protected readonly draftAutosaveDelayMs = 1000;
    protected readonly draftsMaxItems = 30;
    protected readonly draftsMaxAgeMs = 90 * 24 * 60 * 60 * 1000;
    protected draftSaveTimer: number | undefined;
    /** Dernier brouillon écrit (hors horodatage), pour ne pas réécrire le stockage à chaque rendu. */
    protected lastPersistedDraftJson: string | undefined;
    /** Coupe l'autosave pendant le chargement/la restauration : un état vide ne doit jamais écraser un brouillon. */
    protected draftAutosaveSuspended = true;
    /** Horodatage du brouillon restauré à l'ouverture, affiché tant que l'utilisateur n'a pas fermé le bandeau. */
    protected restoredDraftAt: string | undefined;

    protected backendBaseUrl = 'http://localhost:8000';

    protected geocacheIds: number[] = [];
    protected geocaches: GeocacheListItem[] = [];
    /** Signaux de la dernière analyse IA de sortie, par code GC : badges du tableau. */
    protected outingFlags: Record<string, OutingPlanCacheFlags> = {};
    protected outingPlanSubscribed = false;
    protected isLoading = false;

    protected logDate = todayIsoDate();
    protected logType: LogTypeValue = 'found';

    protected readonly pinnedLogDateStorageKey = 'geoApp.logs.pinnedDate.v1';
    /** Quand la date est épinglée, elle est mémorisée et réappliquée à l'ouverture des logs suivants. */
    protected isLogDatePinned = false;

    protected useSameTextForAll = true;
    protected globalText = '';
    protected perCacheText: Record<number, string> = {};
    /**
     * Texte commun tel que recopié dans les zones par cache lors du dernier décochage de
     * « Texte identique ». Sert à distinguer une zone non retouchée (à resynchroniser) d'une
     * zone personnalisée (à conserver). `undefined` = aucune distribution connue.
     */
    protected lastDistributedGlobalText: string | undefined;
    protected perCacheLogType: Record<number, LogTypeValue> = {};
    protected perCacheFavorite: Record<number, boolean> = {};

    protected globalImages: SelectedLogImage[] = [];
    protected perCacheImages: Record<number, SelectedLogImage[]> = {};

    /** Clé de la zone de dépôt actuellement survolée ('global' ou 'cache-<id>'), pour le retour visuel du drag & drop. */
    protected dragOverDropZone: string | undefined;

    /** Object URLs des miniatures, mutualisées par fichier (le même File peut être référencé par plusieurs entrées). */
    protected previewUrlByFile = new Map<File, string>();

    protected isSubmitting = false;
    /** Vrai pendant la préparation de l'analyse IA de la sortie. */
    protected analyzingWithAi = false;
    /** Empêche un second envoi tant que le récapitulatif de confirmation est ouvert. */
    protected isConfirmingSubmit = false;
    protected lastSubmitSummary: { ok: number; failed: number } | undefined;
    /**
     * Progression de l'envoi en cours. `current` est l'index 1-based de la géocache
     * traitée ; `imagesDone`/`imagesTotal` détaillent l'upload des photos, qui domine
     * le temps d'un lot et sans lequel la barre semblerait bloquée.
     */
    protected submitProgress: {
        current: number;
        total: number;
        gcCode: string;
        imagesDone: number;
        imagesTotal: number;
    } | undefined;
    /** Arrêt demandé par l'utilisateur : la boucle s'interrompt *après* la géocache en cours. */
    protected stopRequested = false;
    protected perCacheSubmitStatus: Record<number, SubmissionStatus> = {};
    protected perCacheSubmitReference: Record<number, string | undefined> = {};
    /** Détail du dernier échec par géocache (photo non envoyée, erreur backend…). */
    protected perCacheSubmitError: Record<number, string | undefined> = {};

    protected globalTextArea: HTMLTextAreaElement | null = null;
    protected perCacheTextAreas: Record<number, HTMLTextAreaElement | null> = {};
    /** Couches de surlignage des @patterns, indexées par `overlayKey` (cf. syncOverlayScroll). */
    protected overlayElements: Record<string, HTMLDivElement | null> = {};
    protected overlayTextareas: Record<string, HTMLTextAreaElement | null> = {};
    protected activeEditor: { type: 'global' } | { type: 'per-cache'; geocacheId: number } | undefined;
    /** Format Markdown sous le curseur, pour allumer le bouton correspondant. */
    protected activeCaretFormat: MarkdownFormatKind | undefined;

    protected pendingSelection:
        | { editor: { type: 'global' } | { type: 'per-cache'; geocacheId: number }; start: number; end: number }
        | undefined;

    protected logHistory: LogHistoryEntry[] = [];
    protected logHistoryCursor: number = -1;
    protected isLoadingHistory = false;

    protected totalFavoritePoints: number = 0;
    protected isFetchingFavoritePoints = false;
    /** Faux tant que le stock de PF n'a pas été confirmé par Geocaching.com. */
    protected favoritePointsKnown = false;
    /** Resynchronisation du stock de PF en tâche de fond en cours. */
    protected isSyncingFavoritePoints = false;
    protected userFindsCount: number = 0;
    protected isRefreshingFindsCount = false;

    protected readonly logPatternsStorageKey = 'geoApp.logs.patterns.v1';
    protected customPatterns: LogTextPattern[] = [];
    /** Liste + index des patterns, reconstruits seulement quand `customPatterns` change. */
    private patternsIndexCache: { source: LogTextPattern[]; all: LogTextPattern[]; names: Set<string> } | undefined;
    /**
     * Résultats de `resolveAllPatterns`, avec la signature des données dont ils dépendent.
     * Tant que la signature ne bouge pas, un même (texte, géocache) donne le même résultat :
     * inutile de refaire la substitution à chaque rendu, ni d'invalider ce cache depuis les
     * vingt endroits qui modifient l'état.
     */
    private patternResolutionCache = new Map<string, string>();
    private patternResolutionSignature: readonly unknown[] = [];
    protected isLoadingPatterns = false;
    protected showPatternManager = false;
    protected editingPattern: LogTextPattern | null = null;
    protected patternNameInput = '';
    protected patternContentInput = '';

    protected patternAutocompleteOpen = false;
    protected patternAutocompleteSuggestions: PatternSuggestion[] = [];
    protected patternAutocompleteActiveIndex = 0;
    protected patternAutocompleteReplaceRange: { start: number; end: number } | null = null;
    protected patternAutocompleteTargetGeocacheId: number | null = null;
    protected patternAutocompletePosition: { top: number; left: number } | null = null;
    /** Timer d'ouverture différée du menu (cf. refreshPatternAutocomplete). */
    private patternAutocompleteTimer: number | undefined;

    /** Aperçus Markdown dépliés, par `keyPrefix` (cf. renderMarkdownPreview). */
    protected openMarkdownPreviews = new Set<string>();

    protected historyDropdownOpen = false;

    protected aiKeywords = '';
    protected aiCustomInstructions = '';
    protected aiExampleLogs = '';
    protected isGeneratingAi = false;
    protected showAiPanel = false;

    constructor(
        @inject(MessageService) protected readonly messages: MessageService,
        @inject(LanguageModelRegistry) protected readonly languageModelRegistry: LanguageModelRegistry,
        @inject(LanguageModelService) protected readonly languageModelService: LanguageModelService,
        @inject(StorageService) protected readonly storageService: StorageService,
        @inject(PreferenceService) protected readonly preferenceService: PreferenceService,
        @inject(OutingAnalysisController) protected readonly outingAnalysisController: OutingAnalysisController,
        @inject(OutingPlanService) protected readonly outingPlanService: OutingPlanService,
    ) {
        super();
        this.title.label = 'Logs';
        this.title.caption = 'Édition de logs';
        this.title.closable = true;
        this.title.iconClass = 'fa fa-pen';
        this.addClass('theia-geocache-log-editor-widget');
    }

    protected getLogHistoryMaxItems(): number {
        return getLogHistoryMaxItemsPure(this.preferenceService, this.logHistoryMaxItemsPreferenceKey);
    }

    protected async refreshLogHistory(): Promise<void> {
        this.isLoadingHistory = true;
        this.logHistoryCursor = -1;
        this.update();

        this.logHistory = await loadLogHistory(
            this.storageService,
            this.logHistoryStorageKey,
            this.legacyLogHistoryLocalStorageKey,
            () => this.generateId()
        );

        this.isLoadingHistory = false;
        this.update();
    }

    protected getDraftKey(): string | undefined {
        return getDraftKeyPure(this.geocacheIds);
    }

    protected async readDrafts(): Promise<Record<string, LogDraft>> {
        return readDraftsPure(this.storageService, this.draftsStorageKey);
    }

    /** Le stockage local est partagé avec tout Theia : on ne garde que les brouillons récents. */
    protected pruneDrafts(drafts: Record<string, LogDraft>): Record<string, LogDraft> {
        return pruneDraftsPure(drafts, this.draftsMaxAgeMs, this.draftsMaxItems);
    }

    /**
     * Y a-t-il quelque chose à perdre ? Un onglet ouvert et laissé tel quel ne mérite pas
     * de brouillon : ça ferait réapparaître un bandeau de restauration pour rien.
     */
    protected hasDraftWorthSaving(): boolean {
        return hasDraftWorthSavingPure(
            this.globalText,
            this.perCacheText,
            this.perCacheFavorite,
            this.perCacheSubmitStatus,
            this.geocaches,
            this.logType,
            id => this.getLogTypeForGeocacheId(id)
        );
    }

    protected buildDraft(): LogDraft {
        return buildDraftFromState(
            this.geocaches,
            this.logDate,
            this.logType,
            this.useSameTextForAll,
            this.globalText,
            this.perCacheText,
            this.perCacheLogType,
            this.perCacheFavorite,
            this.perCacheSubmitStatus,
            this.perCacheSubmitReference
        );
    }

    /** Programme l'écriture du brouillon ; appelé à chaque rendu, donc volontairement bon marché. */
    protected scheduleDraftSave(): void {
        if (this.draftAutosaveSuspended || this.geocaches.length === 0 || !this.getDraftKey()) {
            return;
        }
        if (this.draftSaveTimer !== undefined) {
            window.clearTimeout(this.draftSaveTimer);
        }
        this.draftSaveTimer = window.setTimeout(() => {
            this.draftSaveTimer = undefined;
            void this.persistDraft();
        }, this.draftAutosaveDelayMs);
    }

    /** Écrit tout de suite un enregistrement en attente (fermeture d'onglet, fin d'envoi). */
    protected flushPendingDraftSave(): void {
        if (this.draftSaveTimer === undefined) {
            return;
        }
        window.clearTimeout(this.draftSaveTimer);
        this.draftSaveTimer = undefined;
        void this.persistDraft();
    }

    protected async persistDraft(): Promise<void> {
        const key = this.getDraftKey();
        if (!key || this.geocaches.length === 0) {
            return;
        }

        try {
            const draft = this.hasDraftWorthSaving() ? this.buildDraft() : undefined;
            const signature = draft ? JSON.stringify({ ...draft, savedAt: '' }) : 'empty';
            if (signature === this.lastPersistedDraftJson) {
                return;
            }

            await persistDraftToStorage(
                this.storageService,
                this.draftsStorageKey,
                key,
                draft,
                this.draftsMaxAgeMs,
                this.draftsMaxItems
            );
            this.lastPersistedDraftJson = signature;
        } catch (e) {
            console.error('[GeocacheLogEditorWidget] persistDraft error', e);
        }
    }

    protected async deleteDraft(): Promise<void> {
        const key = this.getDraftKey();
        if (!key) {
            return;
        }
        if (this.draftSaveTimer !== undefined) {
            window.clearTimeout(this.draftSaveTimer);
            this.draftSaveTimer = undefined;
        }
        try {
            await deleteDraftFromStorage(this.storageService, this.draftsStorageKey, key);
            this.lastPersistedDraftJson = 'empty';
        } catch (e) {
            console.error('[GeocacheLogEditorWidget] deleteDraft error', e);
        }
    }

    /** Ne conserve d'un enregistrement que les clés correspondant aux géocaches réellement chargées. */
    protected pickKnownGeocacheValues<T>(source: Record<number, T> | undefined, isValid: (value: unknown) => value is T): Record<number, T> {
        return pickKnownGeocacheValuesPure(this.geocaches, source, isValid);
    }

    protected applyDraft(draft: LogDraft): void {
        const result = computeDraftApplication(
            draft,
            this.geocaches,
            this.logDate,
            this.logType,
            this.perCacheLogType,
            this.perCacheFavorite,
            this.isLogDatePinned,
            (v): v is string => this.isValidIsoDate(v)
        );

        this.logDate = result.logDate;
        this.logType = result.logType;
        this.useSameTextForAll = result.useSameTextForAll;
        this.globalText = result.globalText;
        this.perCacheText = result.perCacheText;
        // Comme pour l'historique : on ignore quels textes ont été personnalisés, donc aucun marqueur de distribution.
        this.lastDistributedGlobalText = undefined;
        this.perCacheLogType = result.perCacheLogType;
        this.perCacheFavorite = result.perCacheFavorite;
        this.perCacheSubmitStatus = result.perCacheSubmitStatus;
        this.perCacheSubmitReference = result.perCacheSubmitReference;

        if (result.reorderedGeocacheIds) {
            this.reorderGeocaches(result.reorderedGeocacheIds);
        }
    }

    protected async restoreDraftIfAny(): Promise<void> {
        const key = this.getDraftKey();
        // Sans géocaches chargées (backend injoignable), on ne touche pas au brouillon : il serait
        // restauré vidé de ses textes, puis réécrit vide par l'autosave.
        if (!key || this.geocaches.length === 0) {
            return;
        }

        let draft: LogDraft | undefined;
        try {
            draft = (await this.readDrafts())[key];
        } catch (e) {
            console.error('[GeocacheLogEditorWidget] restoreDraftIfAny error', e);
            return;
        }
        if (!draft || typeof draft !== 'object') {
            return;
        }

        this.applyDraft(draft);
        this.restoredDraftAt = typeof draft.savedAt === 'string' ? draft.savedAt : undefined;
        this.lastPersistedDraftJson = JSON.stringify({ ...this.buildDraft(), savedAt: '' });
        this.update();
    }

    /** « Repartir de zéro » : on efface la rédaction, jamais les envois déjà effectués. */
    protected discardRestoredDraft(): void {
        this.globalText = '';
        this.perCacheText = {};
        this.lastDistributedGlobalText = undefined;

        const nextTypes: Record<number, LogTypeValue> = {};
        const nextFavorites: Record<number, boolean> = {};
        for (const gc of this.geocaches) {
            nextTypes[gc.id] = sanitizeLogTypeForGeocache(this.logType, gc);
            nextFavorites[gc.id] = false;
        }
        this.perCacheLogType = nextTypes;
        this.perCacheFavorite = nextFavorites;

        this.restoredDraftAt = undefined;
        void this.deleteDraft();
        this.update();
    }

    protected onUpdateRequest(msg: Message): void {
        super.onUpdateRequest(msg);
        this.scheduleDraftSave();
    }

    protected onCloseRequest(msg: Message): void {
        // Dernière chance d'écrire : le widget n'est pas restauré au redémarrage, seul le brouillon l'est.
        this.flushPendingDraftSave();
        this.cancelPatternAutocomplete();
        super.onCloseRequest(msg);
    }

    protected async saveCurrentStateToHistory(): Promise<void> {
        const entry = buildHistoryEntry(
            () => this.generateId(),
            this.logDate,
            this.useSameTextForAll,
            this.globalText,
            this.perCacheText,
            this.logType,
            this.perCacheLogType,
            this.perCacheFavorite
        );

        const maxItems = this.getLogHistoryMaxItems();
        this.logHistory = [entry, ...this.logHistory].slice(0, maxItems);
        await this.storageService.setData(this.logHistoryStorageKey, this.logHistory);
        this.logHistoryCursor = -1;
        this.update();
    }

    protected applyHistoryEntry(entry: LogHistoryEntry): void {
        const result = computeHistoryApplication(entry, this.logType, this.isLogDatePinned);

        if (result.logDate !== undefined) {
            this.logDate = result.logDate;
        }
        this.useSameTextForAll = result.useSameTextForAll;
        this.globalText = result.globalText;
        this.perCacheText = result.perCacheText;
        // Les textes viennent de l'historique : on ne sait pas lesquels ont été personnalisés,
        // donc on repart sans marqueur de distribution (ils seront tous conservés).
        this.lastDistributedGlobalText = undefined;
        this.logType = result.logType;
        this.perCacheLogType = result.perCacheLogType;
        this.perCacheFavorite = result.perCacheFavorite;

        this.update();
    }

    protected applyHistoryTextOnly(entry: LogHistoryEntry): void {
        if (this.useSameTextForAll) {
            this.globalText = entry.globalText ?? '';
        } else {
            const perCacheValues = entry.perCacheText && typeof entry.perCacheText === 'object'
                ? entry.perCacheText as Record<number, string>
                : {};
            this.perCacheText = perCacheValues;
            this.lastDistributedGlobalText = undefined;
        }
        this.historyDropdownOpen = false;
        this.update();
    }

    protected navigateHistory(delta: number): void {
        const nextCursor = computeNextHistoryCursor(this.logHistoryCursor, delta, this.logHistory.length);
        if (nextCursor === undefined) {
            return;
        }
        this.logHistoryCursor = nextCursor;
        this.applyHistoryEntry(this.logHistory[nextCursor]);
    }

    protected getTodayIsoDate(): string {
        return todayIsoDate();
    }

    protected isValidIsoDate(value: unknown): value is string {
        return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
    }

    /**
     * Restaure la date épinglée si elle existe, sinon repart sur la date du jour.
     * La présence d'une entrée en stockage vaut « épinglé ».
     */
    protected async loadPinnedLogDate(): Promise<void> {
        let pinnedDate: string | undefined;
        try {
            const stored = await this.storageService.getData<{ date?: string } | undefined>(this.pinnedLogDateStorageKey, undefined);
            if (stored && typeof stored === 'object' && this.isValidIsoDate(stored.date)) {
                pinnedDate = stored.date;
            }
        } catch (e) {
            console.error('[GeocacheLogEditorWidget] loadPinnedLogDate error', e);
        }

        this.isLogDatePinned = pinnedDate !== undefined;
        this.logDate = pinnedDate ?? this.getTodayIsoDate();
        this.update();
    }

    protected async persistPinnedLogDate(): Promise<void> {
        try {
            if (this.isLogDatePinned && this.isValidIsoDate(this.logDate)) {
                await this.storageService.setData(this.pinnedLogDateStorageKey, { date: this.logDate });
            } else {
                await this.storageService.setData(this.pinnedLogDateStorageKey, undefined);
            }
        } catch (e) {
            console.error('[GeocacheLogEditorWidget] persistPinnedLogDate error', e);
        }
    }

    protected setLogDate(value: string): void {
        this.logDate = value;
        this.update();
        if (this.isLogDatePinned) {
            void this.persistPinnedLogDate();
        }
    }

    protected toggleLogDatePin(): void {
        this.isLogDatePinned = !this.isLogDatePinned;
        if (!this.isLogDatePinned) {
            this.logDate = this.getTodayIsoDate();
        }
        this.update();
        void this.persistPinnedLogDate();
    }

    protected escapeHtml(value: string): string {
        return escapeHtmlPure(value);
    }

    protected sanitizeUrl(url: string): string | undefined {
        return sanitizeLogUrl(url);
    }

    protected scheduleRestoreSelection(
        editor: { type: 'global' } | { type: 'per-cache'; geocacheId: number },
        start: number,
        end: number,
    ): void {
        this.pendingSelection = { editor, start, end };
        setTimeout(() => {
            const pending = this.pendingSelection;
            if (!pending) {
                return;
            }
            const ta = this.getEditorTextArea(pending.editor);
            if (!ta) {
                return;
            }
            try {
                const clamped = clampSelection(pending.start, pending.end, ta.value.length);
                ta.setSelectionRange(clamped.start, clamped.end);
            } catch {
                // ignore
            }
        }, 0);
    }

    protected applyEditorValue(editor: { type: 'global' } | { type: 'per-cache'; geocacheId: number }, nextValue: string): void {
        if (editor.type === 'global') {
            this.globalText = nextValue;
        } else {
            this.perCacheText = { ...this.perCacheText, [editor.geocacheId]: nextValue };
        }
    }

    protected getEditorValue(editor: { type: 'global' } | { type: 'per-cache'; geocacheId: number }): string {
        return editor.type === 'global' ? this.globalText : (this.perCacheText[editor.geocacheId] ?? '');
    }

    protected getEditorTextArea(editor: { type: 'global' } | { type: 'per-cache'; geocacheId: number }): HTMLTextAreaElement | null {
        return editor.type === 'global' ? this.globalTextArea : (this.perCacheTextAreas[editor.geocacheId] ?? null);
    }

    protected applyMarkdownFormat(kind: MarkdownFormatKind, placeholder: string): void {
        const editor = this.activeEditor;
        if (!editor) {
            this.messages.warn('Clique dans une zone de texte pour appliquer le Markdown.');
            return;
        }

        const ta = this.getEditorTextArea(editor);
        const value = this.getEditorValue(editor);
        const start = ta ? ta.selectionStart : value.length;
        const end = ta ? ta.selectionEnd : value.length;

        const edit = computeMarkdownFormatEdit(value, start, end, kind, placeholder);

        this.applyEditorValue(editor, edit.value);
        this.activeCaretFormat = detectCaretFormat(edit.value, edit.selectionStart);
        this.update();
        this.scheduleSelection(editor, edit.selectionStart, edit.selectionEnd);
    }

    /**
     * Recalcule le format sous le curseur pour allumer le bouton correspondant.
     * Ne redessine que si l'état change, pour ne pas re-rendre à chaque frappe.
     */
    protected refreshCaretFormat(textArea: HTMLTextAreaElement): void {
        const next = detectCaretFormat(textArea.value, textArea.selectionStart ?? 0);
        if (next !== this.activeCaretFormat) {
            this.activeCaretFormat = next;
            this.update();
        }
    }

    protected isEditorActive(section: { type: 'global' } | { type: 'per-cache'; geocacheId: number }): boolean {
        const editor = this.activeEditor;
        if (!editor || editor.type !== section.type) {
            return false;
        }
        return editor.type === 'global' || editor.geocacheId === (section as { geocacheId: number }).geocacheId;
    }

    protected scheduleSelection(
        editor: { type: 'global' } | { type: 'per-cache'; geocacheId: number },
        selectionStart: number,
        selectionEnd: number
    ): void {
        setTimeout(() => {
            const nextTa = this.getEditorTextArea(editor);
            if (!nextTa) {
                return;
            }
            nextTa.focus();
            nextTa.setSelectionRange(selectionStart, selectionEnd);
        }, 0);
    }

    protected applyMarkdownPrefix(prefix: string, placeholder: string): void {
        const editor = this.activeEditor;
        if (!editor) {
            this.messages.warn('Clique dans une zone de texte pour appliquer le Markdown.');
            return;
        }

        const ta = this.getEditorTextArea(editor);
        const value = this.getEditorValue(editor);
        const start = ta ? ta.selectionStart : value.length;
        const end = ta ? ta.selectionEnd : value.length;

        const result = computeMarkdownPrefixEdit(value, start, end, prefix, placeholder);
        this.applyEditorValue(editor, result.value);
        this.update();

        setTimeout(() => {
            const nextTa = this.getEditorTextArea(editor);
            if (!nextTa) {
                return;
            }
            nextTa.focus();
            const sel = computePrefixSelection(result, prefix, placeholder);
            nextTa.setSelectionRange(sel.start, sel.end);
        }, 0);
    }

    setContext(params: { geocacheIds: number[]; title?: string }): void {
        const ids = (params.geocacheIds || []).filter((v): v is number => typeof v === 'number');
        this.geocacheIds = Array.from(new Set(ids));
        this.geocaches = [];
        this.perCacheText = {};
        this.lastDistributedGlobalText = undefined;
        this.perCacheLogType = {};
        this.perCacheFavorite = {};
        this.perCacheSubmitStatus = {};
        this.perCacheSubmitReference = {};
        this.perCacheSubmitError = {};
        this.globalImages = [];
        this.perCacheImages = {};
        this.releaseUnusedPreviewUrls();

        if (params.title) {
            this.title.label = params.title;
        } else if (this.geocacheIds.length === 1) {
            this.title.label = 'Log - 1 géocache';
        } else {
            this.title.label = `Log - ${this.geocacheIds.length} géocaches`;
        }

        this.draftAutosaveSuspended = true;
        this.lastPersistedDraftJson = undefined;
        this.restoredDraftAt = undefined;

        void this.refreshLogHistory();
        void this.fetchFavoritePoints();
        void this.loadPatterns();
        void this.initializeSession();
        this.update();
    }

    /**
     * Date épinglée, géocaches, puis brouillon : l'ordre compte, chaque étape écrase
     * des champs que la suivante doit pouvoir corriger. L'autosave n'est armé qu'à la fin.
     */
    protected async initializeSession(): Promise<void> {
        try {
            await this.loadPinnedLogDate();
            await this.loadGeocaches();
            await this.restoreDraftIfAny();
        } finally {
            this.draftAutosaveSuspended = false;
            this.update();
        }
    }

    protected toggleUseSameTextForAll(checked: boolean): void {
        if (this.useSameTextForAll && !checked) {
            const nextPerCacheText: Record<number, string> = { ...this.perCacheText };
            const nextPerCacheImages: Record<number, SelectedLogImage[]> = { ...this.perCacheImages };

            const globalText = this.globalText;
            const globalImages = this.globalImages;
            const previouslyDistributed = this.lastDistributedGlobalText;
            let customizedKept = 0;

            for (const gc of this.geocaches) {
                const existingText = nextPerCacheText[gc.id] ?? '';
                // Une zone vide, ou restée telle que distribuée au décochage précédent, reçoit le texte commun
                // à jour. Une zone retouchée à la main est conservée : la correction du texte commun ne l'écrase pas.
                const isUntouched = !existingText
                    || (previouslyDistributed !== undefined && existingText === previouslyDistributed);
                if (isUntouched) {
                    nextPerCacheText[gc.id] = globalText;
                } else if (existingText !== globalText) {
                    customizedKept += 1;
                }

                const existingImages = nextPerCacheImages[gc.id] ?? [];
                const existingKeys = new Set(existingImages.map(i => `${i.file.name}:${i.file.size}:${i.file.lastModified}`));
                const additions = globalImages
                    .filter(i => !existingKeys.has(`${i.file.name}:${i.file.size}:${i.file.lastModified}`))
                    .map(i => ({
                        id: this.generateId(),
                        file: i.file,
                        status: 'pending' as ImageUploadStatus,
                    }));

                if (additions.length > 0) {
                    nextPerCacheImages[gc.id] = [...existingImages, ...additions];
                } else {
                    nextPerCacheImages[gc.id] = existingImages;
                }
            }

            this.perCacheText = nextPerCacheText;
            this.perCacheImages = nextPerCacheImages;
            this.lastDistributedGlobalText = globalText;

            if (customizedKept > 0) {
                this.messages.info(customizedKept === 1
                    ? '1 texte personnalisé a été conservé (non remplacé par le texte commun).'
                    : `${customizedKept} textes personnalisés ont été conservés (non remplacés par le texte commun).`);
            }
        }

        this.useSameTextForAll = checked;
        this.update();
    }

    /** Aperçu du texte commun sur une ligne, pour les infobulles des boutons de réapplication. */
    protected getGlobalTextExcerpt(maxLength = 200): string {
        const text = this.globalText.replace(/\s+/g, ' ').trim();
        return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
    }

    /** Réapplique le texte commun à une seule géocache, en écrasant sa version personnalisée. */
    protected applyGlobalTextToGeocache(geocacheId: number): void {
        this.perCacheText = { ...this.perCacheText, [geocacheId]: this.globalText };
        this.update();
    }

    /**
     * Réapplique le texte commun à toutes les géocaches pas encore loguées.
     * Demande confirmation quand des textes personnalisés seraient perdus.
     */
    protected async applyGlobalTextToAllGeocaches(): Promise<void> {
        const targets = this.geocaches.filter(gc => !this.isGeocacheSubmittedOk(gc.id));
        if (targets.length === 0) {
            this.messages.info('Aucune géocache à mettre à jour : tous les logs ont été envoyés.');
            return;
        }

        const overwritten = targets.filter(gc => {
            const current = this.perCacheText[gc.id] ?? '';
            return current !== '' && current !== this.globalText;
        }).length;

        if (overwritten > 0) {
            const answer = await this.messages.warn(
                overwritten === 1
                    ? '1 texte personnalisé sera remplacé par le texte commun. Continuer ?'
                    : `${overwritten} textes personnalisés seront remplacés par le texte commun. Continuer ?`,
                'Annuler',
                'Remplacer',
            );
            if (answer !== 'Remplacer') {
                return;
            }
        }

        const next: Record<number, string> = { ...this.perCacheText };
        for (const gc of targets) {
            next[gc.id] = this.globalText;
        }
        this.perCacheText = next;
        // Les zones repartent du texte commun : elles redeviennent « non retouchées ».
        this.lastDistributedGlobalText = this.globalText;
        this.update();
    }

    /** Renvoie (en la créant au besoin) l'object URL de prévisualisation d'un fichier image. */
    protected getPreviewUrl(file: File): string | undefined {
        return getOrCreatePreviewUrl(file, this.previewUrlByFile);
    }

    /** Libère les object URLs des fichiers qui ne sont plus référencés par aucune sélection. */
    protected releaseUnusedPreviewUrls(): void {
        releaseUnusedPreviewUrlsPure(this.previewUrlByFile, this.globalImages, this.perCacheImages);
    }

    protected generateId(): string {
        return generateImageId();
    }

    protected addSelectedImages(files: FileList | File[], target: 'global' | { geocacheId: number }): void {
        const mapped = createSelectedImagesFromFiles(files);
        if (mapped.length === 0) {
            return;
        }

        if (target === 'global') {
            this.globalImages = addImagesToList(this.globalImages, mapped);
        } else {
            const current = this.perCacheImages[target.geocacheId] ?? [];
            this.perCacheImages = { ...this.perCacheImages, [target.geocacheId]: addImagesToList(current, mapped) };
        }
        this.update();
    }

    protected removeSelectedImage(target: 'global' | { geocacheId: number }, imageId: string): void {
        if (target === 'global') {
            this.globalImages = removeImageFromList(this.globalImages, imageId);
        } else {
            const current = this.perCacheImages[target.geocacheId] ?? [];
            this.perCacheImages = { ...this.perCacheImages, [target.geocacheId]: removeImageFromList(current, imageId) };
        }
        this.releaseUnusedPreviewUrls();
        this.update();
    }

    protected getImagesForGeocacheId(geocacheId: number): SelectedLogImage[] {
        return this.useSameTextForAll ? this.globalImages : (this.perCacheImages[geocacheId] ?? []);
    }

    protected setImagesForGeocacheId(geocacheId: number, images: SelectedLogImage[]): void {
        if (this.useSameTextForAll) {
            this.globalImages = images;
        } else {
            this.perCacheImages = { ...this.perCacheImages, [geocacheId]: images };
        }
        this.update();
    }

    protected async uploadOneLogImage(geocacheId: number, img: SelectedLogImage): Promise<SelectedLogImage> {
        return uploadOneLogImagePure(this.backendBaseUrl, geocacheId, img);
    }

    protected async uploadImagesForGeocache(
        geocacheId: number,
        onProgress?: (done: number, total: number) => void
    ): Promise<ImagesUploadResult> {
        const current = this.getImagesForGeocacheId(geocacheId);
        if (current.length === 0) {
            onProgress?.(0, 0);
            return { guids: [], total: 0, failed: 0 };
        }

        let working = [...current];
        if (this.useSameTextForAll) {
            working = working.map(resetImageForUpload);
            this.setImagesForGeocacheId(geocacheId, working);
        }
        for (let i = 0; i < working.length; i += 1) {
            const img = working[i];
            if (img.status === 'ok' && img.imageGuid) {
                continue;
            }
            working[i] = markImageUploading(img);
            this.setImagesForGeocacheId(geocacheId, working);
            onProgress?.(i, working.length);
            const uploaded = await this.uploadOneLogImage(geocacheId, working[i]);
            working[i] = uploaded;
            this.setImagesForGeocacheId(geocacheId, working);
        }
        onProgress?.(working.length, working.length);

        return computeImagesUploadResult(working);
    }

    /**
     * Un log envoyé ne peut pratiquement plus être complété depuis l'app : plutôt que de
     * soumettre silencieusement un log amputé de ses photos, on laisse l'utilisateur trancher.
     * Fermer la notification vaut "ne pas loguer" : la cache reste renvoyable, alors qu'un
     * log incomplet, non.
     */
    protected async askImageFailureDecision(gc: GeocacheListItem, upload: ImagesUploadResult): Promise<'send' | 'send-all' | 'skip'> {
        const count = upload.failed === upload.total
            ? `${upload.failed} photo(s)`
            : `${upload.failed} photo(s) sur ${upload.total}`;
        const answer = await this.messages.warn(
            `${gc.gc_code} : échec de l'envoi de ${count}. Envoyer quand même le log sans ces photos ?`,
            IMAGE_FAILURE_SEND,
            IMAGE_FAILURE_SEND_ALL,
            IMAGE_FAILURE_SKIP
        );
        if (answer === IMAGE_FAILURE_SEND) {
            return 'send';
        }
        if (answer === IMAGE_FAILURE_SEND_ALL) {
            return 'send-all';
        }
        return 'skip';
    }

    protected getRemainingFavoritePoints(): number {
        const usedCount = Object.values(this.perCacheFavorite).filter(v => v === true).length;
        return Math.max(0, this.totalFavoritePoints - usedCount);
    }

    /**
     * Vrai tant que le stock de PF n'est pas exploitable : soit il n'a jamais été
     * synchronisé, soit la synchronisation de fond est encore en vol. Les cases
     * « Donner PF » sont alors grisées faute de stock connu, et non parce qu'il
     * serait épuisé — l'infobulle le dit.
     */
    protected isFavoritePointsStockPending(): boolean {
        return this.isSyncingFavoritePoints || this.isFetchingFavoritePoints || !this.favoritePointsKnown;
    }

    protected async fetchFavoritePoints(): Promise<void> {
        if (this.isFetchingFavoritePoints) {
            return;
        }

        this.isFetchingFavoritePoints = true;
        this.update();

        try {
            const stats = await fetchUserStats(this.backendBaseUrl);
            this.favoritePointsKnown = stats.awardedFavoritePoints !== undefined;
            this.totalFavoritePoints = stats.awardedFavoritePoints ?? 0;
            this.userFindsCount = stats.findsCount;
        } catch (e) {
            console.error('[GeocacheLogEditorWidget] fetchFavoritePoints error', e);
            this.favoritePointsKnown = false;
            this.totalFavoritePoints = 0;
        } finally {
            this.isFetchingFavoritePoints = false;
            this.update();
        }

        // Le stock mémorisé à la connexion vaut souvent 0 ou rien du tout : sans
        // resynchronisation, toutes les cases « Donner PF » resteraient grisées alors
        // que des points sont disponibles. On va donc les chercher en tâche de fond,
        // sans bloquer l'ouverture de l'éditeur.
        if (!this.favoritePointsKnown || this.totalFavoritePoints <= 0) {
            void this.syncFavoritePoints();
        }
    }

    /**
     * Resynchronise le stock de PF depuis Geocaching.com, en tâche de fond.
     *
     * Ne touche pas au nombre de trouvailles : celui-ci a ses propres règles
     * (cf. `refreshUserFindsCount`, qui doit s'abstenir dès qu'un log de l'onglet
     * est parti). Un échec est silencieux : on reste sur le stock connu.
     */
    protected async syncFavoritePoints(options: { force?: boolean } = {}): Promise<void> {
        if (this.isSyncingFavoritePoints || this.isRefreshingFindsCount) {
            return;
        }

        this.isSyncingFavoritePoints = true;
        this.update();

        try {
            const stats = await refreshUserStats(this.backendBaseUrl, { force: options.force ?? false });
            if (stats.awardedFavoritePoints !== undefined) {
                this.totalFavoritePoints = stats.awardedFavoritePoints;
                this.favoritePointsKnown = true;
            }
        } catch (e) {
            console.error('[GeocacheLogEditorWidget] syncFavoritePoints error', e);
        } finally {
            this.isSyncingFavoritePoints = false;
            this.update();
        }
    }

    /** Vrai si un des textes à envoyer utilise `@cache_count`. */
    protected usesCacheCountPattern(): boolean {
        const regex = /@cache_count(?![a-zA-Z0-9_])/;
        if (this.useSameTextForAll) {
            return regex.test(this.globalText);
        }
        return this.geocaches.some(gc => regex.test(this.perCacheText[gc.id] ?? ''));
    }

    /**
     * Resynchronise le nombre de trouvailles depuis Geocaching.com (scraping du
     * profil), pour que `@cache_count` reparte de la vraie valeur et pas de celle
     * mémorisée au login.
     *
     * Ne fait rien si une cache de cet onglet a déjà été envoyée : le compteur
     * distant inclurait alors ce log, que `getCacheCountForIndex` recompte déjà
     * via la position dans le lot — on numéroterait une trouvaille en trop.
     */
    protected async refreshUserFindsCount(): Promise<void> {
        if (this.isRefreshingFindsCount) {
            return;
        }
        if (Object.values(this.perCacheSubmitStatus).some(status => status === 'ok')) {
            return;
        }

        this.isRefreshingFindsCount = true;
        this.update();

        try {
            const stats = await refreshUserStats(this.backendBaseUrl);
            if (stats.findsCount !== undefined) {
                this.userFindsCount = stats.findsCount;
            }
            if (stats.awardedFavoritePoints !== undefined) {
                this.totalFavoritePoints = stats.awardedFavoritePoints;
                this.favoritePointsKnown = true;
            }
        } catch (e) {
            console.error('[GeocacheLogEditorWidget] refreshUserFindsCount error', e);
        } finally {
            this.isRefreshingFindsCount = false;
            this.update();
        }
    }

    /** Convertit une géocache renvoyée par le backend en entrée de liste, ou `undefined`. */
    protected toGeocacheListItem(data: unknown): GeocacheListItem | undefined {
        return toGeocacheListItemPure(data);
    }

    /**
     * Charge les géocaches du contexte en une seule requête (`/api/geocaches/batch`).
     */
    protected async loadGeocaches(): Promise<void> {
        if (!this.geocacheIds.length || this.isLoading) {
            return;
        }

        this.isLoading = true;
        this.update();

        try {
            const result = await fetchGeocachesBatch(
                this.backendBaseUrl,
                this.geocacheIds,
                this.perCacheLogType,
                this.logType
            );

            // Une géocache introuvable ne doit pas empêcher de loguer les autres : elle est
            // signalée et retirée de la liste, là où N requêtes unitaires faisaient tout échouer.
            if (result.missingIds.length > 0) {
                console.warn('[GeocacheLogEditorWidget] géocaches introuvables', result.missingIds);
                this.messages.warn(result.missingIds.length === 1
                    ? `La géocache ${result.missingIds[0]} est introuvable : elle est retirée de la liste.`
                    : `${result.missingIds.length} géocaches sont introuvables (${result.missingIds.join(', ')}) : elles sont retirées de la liste.`);
            }
            if (result.geocaches.length === 0) {
                this.messages.error('Impossible de charger la liste des géocaches.');
            }

            this.geocaches = result.geocaches;
            this.perCacheLogType = result.perCacheLogType;

            if (result.alreadyFound.length > 0 && this.logType === 'found') {
                const codes = result.alreadyFound.map(gc => gc.gc_code).join(', ');
                this.messages.warn(
                    result.alreadyFound.length === 1
                        ? `${codes} est déjà loguée "Found it" : elle est passée sur "Ne pas loguer".`
                        : `${result.alreadyFound.length} géocaches sont déjà loguées "Found it" (${codes}) : elles sont passées sur "Ne pas loguer".`
                );
            }

            const nextFav: Record<number, boolean> = { ...this.perCacheFavorite };
            for (const gc of result.geocaches) {
                if (typeof nextFav[gc.id] !== 'boolean') {
                    nextFav[gc.id] = false;
                }
            }
            this.perCacheFavorite = nextFav;

            // Après le chargement : les drapeaux se demandent par code GC. La liste du
            // log-editor est celle de la sortie du jour, donc celle que l'analyse a vue.
            void this.loadOutingFlags();
        } catch (e) {
            console.error('[GeocacheLogEditorWidget] loadGeocaches error', e);
            this.messages.error('Impossible de charger la liste des géocaches.');
        } finally {
            this.isLoading = false;
            this.update();
        }
    }

    /**
     * Signaux de la dernière analyse de sortie pour les caches de la liste.
     *
     * Silencieux en cas d'échec : les badges sont un confort, et le log-editor a une tâche
     * autrement plus importante à mener à bien.
     */
    /**
     * Abonnement aux changements de plan.
     *
     * Posé à la première demande de drapeaux plutôt que dans le constructeur : ce widget
     * s'instancie pour chaque session de log, et un abonnement par instance non utilisée
     * ne servirait à rien.
     */
    protected ensureOutingPlanSubscription(): void {
        if (this.outingPlanSubscribed) {
            return;
        }
        this.outingPlanSubscribed = true;
        this.toDispose.push(
            this.outingPlanService.onDidChangePlans(() => { void this.loadOutingFlags(); })
        );
    }

    protected async loadOutingFlags(): Promise<void> {
        this.ensureOutingPlanSubscription();
        const codes = this.geocaches.map(gc => gc.gc_code).filter(Boolean);
        if (codes.length === 0) {
            this.outingFlags = {};
            return;
        }
        try {
            const flags = await this.outingPlanService.fetchFlags(codes);
            this.outingFlags = Object.fromEntries(flags);
            this.update();
        } catch (error) {
            console.debug('[GeocacheLogEditorWidget] drapeaux de sortie indisponibles', error);
        }
    }

    /**
     * Réordonne la liste des géocaches selon l'ordre transmis par le tableau.
     * Cet ordre est l'ordre d'envoi des logs, et celui de la numérotation `@cache_count`.
     */
    protected reorderGeocaches(orderedIds: number[]): void {
        const remaining = new Map(this.geocaches.map(gc => [gc.id, gc]));
        const next: GeocacheListItem[] = [];
        for (const id of orderedIds) {
            const gc = remaining.get(id);
            if (gc) {
                next.push(gc);
                remaining.delete(id);
            }
        }
        // Filet de sécurité : une géocache absente de l'ordre transmis garde sa place relative.
        for (const gc of this.geocaches) {
            if (remaining.has(gc.id)) {
                next.push(gc);
            }
        }

        this.geocaches = next;
        this.geocacheIds = next.map(gc => gc.id);
        this.update();
    }

    protected formatFavoritePercent(favoritesCount: number | undefined, logsCount: number | undefined): string {
        return formatFavoritePercentPure(favoritesCount, logsCount);
    }

    protected toggleFavoriteForGeocacheId(geocacheId: number, nextValue: boolean): void {
        const currentValue = this.perCacheFavorite[geocacheId] === true;
        
        if (nextValue && !currentValue) {
            const remaining = this.getRemainingFavoritePoints();
            if (remaining <= 0) {
                this.messages.warn('Plus de PF disponibles');
                return;
            }
        }
        
        this.perCacheFavorite = { ...this.perCacheFavorite, [geocacheId]: nextValue };
        this.update();
    }

    protected getBuiltinPatterns(): LogTextPattern[] {
        return getBuiltinPatterns();
    }

    /**
     * Patterns connus et index de leurs noms.
     *
     * Appelé plusieurs fois par zone de saisie et par frappe (surlignage, compteur,
     * aperçu) : sans mémoïsation il réallouait les patterns intégrés à chaque appel,
     * et le test d'appartenance se faisait par `Array.includes` dans une boucle.
     */
    protected getPatternsIndex(): { all: LogTextPattern[]; names: Set<string> } {
        if (!this.patternsIndexCache || this.patternsIndexCache.source !== this.customPatterns) {
            this.patternsIndexCache = { source: this.customPatterns, ...buildPatternsIndex(this.customPatterns) };
        }
        return this.patternsIndexCache;
    }

    protected getAllPatterns(): LogTextPattern[] {
        return this.getPatternsIndex().all;
    }

    protected async loadPatterns(): Promise<void> {
        this.isLoadingPatterns = true;
        this.update();

        this.customPatterns = await loadCustomPatterns(this.storageService, this.logPatternsStorageKey);

        this.isLoadingPatterns = false;
        this.update();
    }

    protected async savePatterns(): Promise<void> {
        await saveCustomPatterns(this.storageService, this.logPatternsStorageKey, this.customPatterns);
    }

    protected addPattern(name: string, content: string): void {
        const result = createPattern(name, content, () => this.generateId(), this.getAllPatterns());
        if ('error' in result) {
            this.messages.warn(result.error === 'invalid-name'
                ? 'Le nom du pattern est invalide'
                : `Le pattern "@${name.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_')}" existe déjà`);
            return;
        }
        this.customPatterns = addPatternToList(this.customPatterns, result);
        void this.savePatterns();
        this.patternNameInput = '';
        this.patternContentInput = '';
        this.update();
    }

    protected updatePattern(patternId: string, name: string, content: string): void {
        const result = updatePatternInList(this.customPatterns, patternId, name, content, this.getAllPatterns());
        if ('error' in result) {
            this.messages.warn(result.error === 'invalid-name'
                ? 'Le nom du pattern est invalide'
                : `Le pattern "@${name.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_')}" existe déjà`);
            return;
        }
        this.customPatterns = result;
        void this.savePatterns();
        this.editingPattern = null;
        this.patternNameInput = '';
        this.patternContentInput = '';
        this.update();
    }

    protected deletePattern(patternId: string): void {
        this.customPatterns = deletePatternFromList(this.customPatterns, patternId);
        void this.savePatterns();
        this.update();
    }

    protected getCacheCountForIndex(geocacheIndex: number): number {
        return getCacheCountForIndex(geocacheIndex, this.getPatternResolutionContext());
    }

    protected resolvePatternValue(patternName: string, geocacheId: number | null): string {
        return resolvePatternValueCached(patternName, geocacheId, this.getPatternResolutionContext());
    }

    /** Contexte de résolution des @patterns, reconstruit à chaque appel depuis l'état du widget. */
    protected getPatternResolutionContext(): PatternResolutionContext {
        return {
            geocaches: this.geocaches,
            perCacheLogType: this.perCacheLogType,
            logType: this.logType,
            userFindsCount: this.userFindsCount,
            logDate: this.logDate,
            customPatterns: this.customPatterns,
        };
    }

    protected resolveAllPatterns(text: string, geocacheId: number | null): string {
        return resolveAllPatternsCached(text, geocacheId, this.getPatternResolutionContext(), {
            cache: this.patternResolutionCache,
            signature: this.patternResolutionSignature,
        });
    }

    protected getResolvedTextForGeocacheId(geocacheId: number): string {
        const rawText = this.getTextForGeocacheId(geocacheId);
        return this.resolveAllPatterns(rawText, geocacheId);
    }

    /**
     * Longueurs du texte **final** (patterns résolus) pour une zone de saisie.
     *
     * En mode « texte identique » un même texte source donne un texte différent par
     * géocache (`@cache_name`, `@cache_count`…) : on renvoie donc la fourchette
     * observée sur les géocaches qui partiront, et la pire d'entre elles.
     */
    protected getFinalLengthStats(target: 'global' | { geocacheId: number }): {
        raw: number;
        min: number;
        max: number;
        worst?: GeocacheListItem;
    } {
        return computeFinalLengthStatsPure(
            target,
            this.globalText,
            this.perCacheText,
            this.getGeocachesToSubmit(),
            this.geocaches,
            (text, id) => this.resolveAllPatterns(text, id)
        );
    }

    /** Aligne la couche de surlignage sur le défilement du <textarea>. */
    protected syncOverlayScroll(overlayKey: string, textArea: HTMLTextAreaElement): void {
        const overlay = this.overlayElements[overlayKey];
        if (!overlay) {
            return;
        }
        overlay.scrollTop = textArea.scrollTop;
        overlay.scrollLeft = textArea.scrollLeft;
    }

    /** Annule une ouverture d'autocomplétion encore en attente. */
    protected cancelPatternAutocomplete(): void {
        if (this.patternAutocompleteTimer !== undefined) {
            window.clearTimeout(this.patternAutocompleteTimer);
            this.patternAutocompleteTimer = undefined;
        }
    }

    /**
     * Ferme le menu. Ne redessine que s'il était ouvert : sans cette garde, chaque frappe
     * hors d'un @pattern (donc la quasi-totalité) déclenchait un rendu complet inutile.
     */
    protected closePatternAutocomplete(): void {
        this.cancelPatternAutocomplete();
        if (!this.patternAutocompleteOpen) {
            return;
        }
        this.patternAutocompleteOpen = false;
        this.update();
    }

    /** Jeton `@xxx` en cours de saisie devant le curseur, s'il y en a un. */
    protected findPatternTokenAtCaret(value: string, caret: number): { start: number; fragment: string } | undefined {
        return findPatternTokenAtCaretPure(value, caret);
    }

    /**
     * Autocomplétion des @patterns, appelée à chaque frappe.
     *
     * Le positionnement du menu passe par `getCaretCoordinates`, qui crée puis détruit un
     * div-miroir dans le document et force un reflow : bien trop cher pour chaque caractère
     * saisi. On ne garde donc ici que l'analyse du jeton (immédiate, sans DOM) et on diffère
     * l'ouverture proprement dite.
     */
    protected refreshPatternAutocomplete(value: string, textArea: HTMLTextAreaElement, geocacheId: number | null): void {
        const caret = textArea.selectionStart ?? value.length;
        if (!this.findPatternTokenAtCaret(value, caret)) {
            this.closePatternAutocomplete();
            return;
        }

        this.cancelPatternAutocomplete();
        this.patternAutocompleteTimer = window.setTimeout(() => {
            this.patternAutocompleteTimer = undefined;
            if (this.isDisposed) {
                return;
            }
            this.openPatternAutocomplete(textArea, geocacheId);
        }, PATTERN_AUTOCOMPLETE_DELAY_MS);
    }

    /**
     * Ouverture différée du menu. Le texte et le curseur ont pu bouger depuis la frappe qui
     * a armé le timer : on repart de l'état réel du champ de saisie.
     */
    protected openPatternAutocomplete(textArea: HTMLTextAreaElement, geocacheId: number | null): void {
        if (!textArea.isConnected) {
            this.closePatternAutocomplete();
            return;
        }

        const value = textArea.value;
        const caret = textArea.selectionStart ?? value.length;
        const token = this.findPatternTokenAtCaret(value, caret);
        if (!token) {
            this.closePatternAutocomplete();
            return;
        }

        const prefix = token.fragment.toLowerCase();
        const suggestions = buildPatternSuggestions(
            this.getAllPatterns(),
            prefix,
            (name, id) => this.resolvePatternValue(name, id),
            geocacheId
        );

        if (suggestions.length === 0) {
            this.closePatternAutocomplete();
            return;
        }

        this.patternAutocompletePosition = getAutocompletePosition(textArea, token.start);
        this.patternAutocompleteReplaceRange = { start: token.start, end: caret };
        this.patternAutocompleteSuggestions = suggestions;
        this.patternAutocompleteActiveIndex = 0;
        this.patternAutocompleteTargetGeocacheId = geocacheId;
        this.patternAutocompleteOpen = true;
        this.update();
    }

    protected applyPatternSuggestion(suggestion: PatternSuggestion): void {
        const range = this.patternAutocompleteReplaceRange;
        if (!range) {
            return;
        }

        const geocacheId = this.patternAutocompleteTargetGeocacheId;
        this.cancelPatternAutocomplete();

        // Dès l'insertion de @cache_count : on va chercher le vrai nombre de
        // trouvailles pour que l'aperçu affiche le numéro qui sera réellement envoyé.
        if (suggestion.insertText === '@cache_count') {
            void this.refreshUserFindsCount();
        }

        if (geocacheId === null) {
            const result = applySuggestionToText(this.globalText, range, suggestion.insertText);
            this.globalText = result.text;
            this.patternAutocompleteOpen = false;
            this.update();
            requestAnimationFrame(() => {
                if (this.globalTextArea) {
                    this.globalTextArea.focus();
                    this.globalTextArea.setSelectionRange(result.cursorPos, result.cursorPos);
                }
            });
        } else {
            const current = this.perCacheText[geocacheId] ?? '';
            const result = applySuggestionToText(current, range, suggestion.insertText);
            this.perCacheText = { ...this.perCacheText, [geocacheId]: result.text };
            this.patternAutocompleteOpen = false;
            this.update();
            requestAnimationFrame(() => {
                const textArea = this.perCacheTextAreas[geocacheId];
                if (textArea) {
                    textArea.focus();
                    textArea.setSelectionRange(result.cursorPos, result.cursorPos);
                }
            });
        }
    }

    protected handleTextAreaKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>, geocacheId: number | null): void {
        if (!this.patternAutocompleteOpen) {
            return;
        }

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            this.patternAutocompleteActiveIndex = Math.min(
                this.patternAutocompleteActiveIndex + 1,
                this.patternAutocompleteSuggestions.length - 1
            );
            this.update();
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            this.patternAutocompleteActiveIndex = Math.max(this.patternAutocompleteActiveIndex - 1, 0);
            this.update();
        } else if (e.key === 'Enter' || e.key === 'Tab') {
            const suggestion = this.patternAutocompleteSuggestions[this.patternAutocompleteActiveIndex];
            if (suggestion) {
                e.preventDefault();
                this.applyPatternSuggestion(suggestion);
            }
        } else if (e.key === 'Escape') {
            e.preventDefault();
            this.closePatternAutocomplete();
        }
    }

    protected handleTextAreaBlur(): void {
        // Une ouverture différée ne doit pas ressusciter le menu après la perte du focus.
        this.cancelPatternAutocomplete();
        window.setTimeout(() => {
            if (!this.isDisposed) {
                this.closePatternAutocomplete();
            }
        }, 150);
    }

    protected getGeocacheById(geocacheId: number): GeocacheListItem | undefined {
        return this.geocaches.find(gc => gc.id === geocacheId);
    }

    protected isGeocacheAlreadyFound(geocacheId: number): boolean {
        return this.getGeocacheById(geocacheId)?.already_found === true;
    }

    /** Trouvée avant cette session (par opposition à "loguée à l'instant", qui a son propre affichage). */
    protected isPendingAlreadyFound(geocacheId: number): boolean {
        return this.isGeocacheAlreadyFound(geocacheId) && !this.isGeocacheSubmittedOk(geocacheId);
    }

    /** Sera loguée "Didn't find it" : c'est l'état signalé en bleu dans le tableau et dans les blocs. */
    protected isPendingDnf(geocacheId: number): boolean {
        return isPendingDnfPure(
            this.getGeocacheById(geocacheId),
            this.getLogTypeForGeocacheId(geocacheId),
            this.perCacheSubmitStatus
        );
    }

    /** Caches trouvées avant cette session et pas encore soumises : les seules à signaler comme "déjà trouvées". */
    protected getPendingAlreadyFoundGeocaches(): GeocacheListItem[] {
        return this.geocaches.filter(gc => gc.already_found === true && !this.isGeocacheSubmittedOk(gc.id));
    }

    protected setGlobalLogType(nextValue: LogTypeValue): void {
        this.logType = nextValue;
        const nextTypes: Record<number, LogTypeValue> = { ...this.perCacheLogType };
        for (const gc of this.geocaches) {
            nextTypes[gc.id] = sanitizeLogTypeForGeocache(nextValue, gc);
        }
        this.perCacheLogType = nextTypes;

        const skipped = this.getPendingAlreadyFoundGeocaches();
        if (nextValue === 'found' && skipped.length > 0) {
            this.messages.warn(
                `${skipped.length} géocache(s) déjà trouvée(s) restent en "Ne pas loguer" : ${skipped.map(gc => gc.gc_code).join(', ')}`
            );
        }
        this.update();
    }

    protected setLogTypeForGeocacheId(geocacheId: number, nextValue: LogTypeValue): void {
        if (nextValue === 'found' && this.isGeocacheAlreadyFound(geocacheId)) {
            const gc = this.getGeocacheById(geocacheId);
            this.messages.warn(`${gc?.gc_code ?? 'Cette géocache'} est déjà loguée "Found it" : impossible de la loguer une seconde fois.`);
            this.update();
            return;
        }

        const nextTypes: Record<number, LogTypeValue> = { ...this.perCacheLogType, [geocacheId]: nextValue };
        this.perCacheLogType = nextTypes;

        // Les caches déjà trouvées ne peuvent pas suivre un "Found it" global : on les exclut de l'alignement.
        const values = this.geocaches
            .filter(gc => gc.already_found !== true)
            .map(gc => nextTypes[gc.id] ?? this.logType);
        if (values.length > 0 && values.every(v => v === values[0])) {
            this.logType = values[0];
        }
        this.update();
    }

    /**
     * Rappels du tableau, liés une fois pour toutes : une fonction fléchée recréée à chaque
     * rendu casserait la comparaison superficielle de `React.memo` sur le tableau.
     */
    protected readonly handleTableToggleFavorite = (geocacheId: number, nextValue: boolean): void => {
        this.toggleFavoriteForGeocacheId(geocacheId, nextValue);
    };

    protected readonly handleTableToggleLogType = (geocacheId: number, nextValue: LogTypeValue): void => {
        this.setLogTypeForGeocacheId(geocacheId, nextValue);
    };

    protected readonly handleTableReorder = (orderedGeocacheIds: number[]): void => {
        this.reorderGeocaches(orderedGeocacheIds);
    };

    protected getLogTypeForGeocacheId(geocacheId: number): LogTypeValue {
        const value = this.perCacheLogType[geocacheId] ?? this.logType;
        return sanitizeLogTypeForGeocache(value, this.getGeocacheById(geocacheId));
    }

    protected isGeocacheSubmittedOk(geocacheId: number): boolean {
        return this.perCacheSubmitStatus[geocacheId] === 'ok';
    }

    /** Marquée "Ne pas loguer" : elle reste dans la liste et dans les textes, mais ne part pas à l'envoi. */
    protected isGeocacheSkipped(geocacheId: number): boolean {
        return this.getLogTypeForGeocacheId(geocacheId) === 'skip';
    }

    /** Les seules géocaches qui partiront : ni déjà envoyées, ni marquées "Ne pas loguer". */
    protected getGeocachesToSubmit(): GeocacheListItem[] {
        return this.geocaches.filter(gc => !this.isGeocacheSubmittedOk(gc.id) && !this.isGeocacheSkipped(gc.id));
    }

    protected getTextForGeocacheId(geocacheId: number): string {
        return this.useSameTextForAll ? this.globalText : (this.perCacheText[geocacheId] ?? '');
    }

    /**
     * Récapitulatif avant envoi. Les logs postés sur Geocaching.com ne sont plus
     * rattrapables depuis l'app, et la date comme le type de log sont globaux :
     * c'est le dernier point où l'on peut encore repérer qu'ils n'ont pas été vérifiés.
     */
    protected buildSubmissionSummaryNode(toSubmit: GeocacheListItem[]): HTMLElement {
        return buildSubmissionSummaryNodePure(toSubmit, {
            logDate: this.logDate,
            useSameTextForAll: this.useSameTextForAll,
            geocaches: this.geocaches,
            perCacheFavorite: this.perCacheFavorite,
            globalImagesCount: this.globalImages.length,
            getLogTypeForGeocacheId: id => this.getLogTypeForGeocacheId(id),
            getImagesForGeocacheId: id => this.getImagesForGeocacheId(id).length,
            isGeocacheSkipped: id => this.isGeocacheSkipped(id),
            isGeocacheSubmittedOk: id => this.isGeocacheSubmittedOk(id),
        });
    }

    protected async confirmSubmission(toSubmit: GeocacheListItem[]): Promise<boolean> {
        return confirmSubmissionPure(toSubmit, {
            logDate: this.logDate,
            useSameTextForAll: this.useSameTextForAll,
            geocaches: this.geocaches,
            perCacheFavorite: this.perCacheFavorite,
            globalImagesCount: this.globalImages.length,
            getLogTypeForGeocacheId: id => this.getLogTypeForGeocacheId(id),
            getImagesForGeocacheId: id => this.getImagesForGeocacheId(id).length,
            isGeocacheSkipped: id => this.isGeocacheSkipped(id),
            isGeocacheSubmittedOk: id => this.isGeocacheSubmittedOk(id),
        });
    }

    protected async submitLogsToGeocaching(): Promise<void> {
        if (this.isSubmitting || this.isConfirmingSubmit) {
            return;
        }
        if (this.isLoading || this.geocaches.length === 0) {
            this.messages.warn('Aucune géocache à loguer.');
            return;
        }

        const toSubmit = this.getGeocachesToSubmit();
        if (toSubmit.length === 0) {
            this.messages.warn('Aucune géocache à envoyer : les géocaches restantes sont en "Ne pas loguer".');
            return;
        }

        const validation = validateSubmissionTexts(
            toSubmit,
            id => this.getTextForGeocacheId(id),
            id => this.getResolvedTextForGeocacheId(id)
        );

        if (validation.missingText.length > 0) {
            this.messages.warn(buildMissingTextWarning(validation.missingText.length, this.useSameTextForAll));
            return;
        }

        if (validation.tooLong.length > 0) {
            this.messages.warn(buildTooLongTextWarning(validation.tooLong, this.useSameTextForAll));
            return;
        }

        this.isConfirmingSubmit = true;
        let confirmed = false;
        try {
            confirmed = await this.confirmSubmission(toSubmit);
        } finally {
            this.isConfirmingSubmit = false;
        }
        if (!confirmed) {
            return;
        }

        this.isSubmitting = true;
        this.lastSubmitSummary = undefined;
        this.stopRequested = false;
        this.submitProgress = undefined;
        this.update();

        // `@cache_count` numérote à partir du nombre de trouvailles du profil :
        // on le resynchronise juste avant l'envoi pour ne pas partir d'une valeur
        // périmée (logs faits ailleurs, onglet ouvert depuis longtemps…).
        if (this.usesCacheCountPattern()) {
            await this.refreshUserFindsCount();
        }

        let ok = 0;
        let failed = 0;
        let processed = 0;
        /** "Envoyer sans les photos" appliqué au reste du lot : on ne redemande plus. */
        let sendWithoutImagesForBatch = false;

        try {
            for (const gc of this.geocaches) {
                if (this.isGeocacheSubmittedOk(gc.id) || this.isGeocacheSkipped(gc.id)) {
                    continue;
                }
                // Arrêt demandé : on ne coupe jamais une géocache en plein vol (photos déjà
                // uploadées, log peut-être posté), on s'arrête entre deux itérations.
                if (this.stopRequested) {
                    break;
                }
                processed += 1;
                this.submitProgress = {
                    current: processed,
                    total: toSubmit.length,
                    gcCode: gc.gc_code,
                    imagesDone: 0,
                    imagesTotal: this.getImagesForGeocacheId(gc.id).length,
                };
                this.update();

                const logTypeForGc = this.getLogTypeForGeocacheId(gc.id);

                const upload = await this.uploadImagesForGeocache(gc.id, (done, total) => {
                    if (this.submitProgress) {
                        this.submitProgress = { ...this.submitProgress, imagesDone: done, imagesTotal: total };
                        this.update();
                    }
                });
                if (upload.failed > 0 && !sendWithoutImagesForBatch) {
                    const decision = await this.askImageFailureDecision(gc, upload);
                    if (decision === 'send-all') {
                        sendWithoutImagesForBatch = true;
                    } else if (decision === 'skip') {
                        failed += 1;
                        this.perCacheSubmitStatus = { ...this.perCacheSubmitStatus, [gc.id]: 'failed' };
                        this.perCacheSubmitError = {
                            ...this.perCacheSubmitError,
                            [gc.id]: `${upload.failed} photo(s) non envoyée(s) : log non soumis`,
                        };
                        this.messages.warn(`${gc.gc_code} - log non envoyé (${upload.failed} photo(s) en échec)`);
                        this.update();
                        continue;
                    }
                }
                const payload = buildLogSubmissionPayload(
                    this.getResolvedTextForGeocacheId(gc.id),
                    this.logDate,
                    logTypeForGc,
                    this.perCacheFavorite[gc.id] === true,
                    upload.guids
                );

                const result = await submitOneLog(this.backendBaseUrl, gc.id, payload);
                if (result.ok) {
                    ok += 1;
                    this.perCacheSubmitStatus = { ...this.perCacheSubmitStatus, [gc.id]: 'ok' };
                    this.perCacheSubmitReference = { ...this.perCacheSubmitReference, [gc.id]: result.logReferenceCode };
                    this.perCacheSubmitError = { ...this.perCacheSubmitError, [gc.id]: undefined };
                    // On ne marque pas `already_found` ici : le statut 'ok' verrouille déjà la ligne
                    // et affiche "loguée" plutôt que "déjà trouvée", qui serait trompeur juste après l'envoi.

                    if (typeof window !== 'undefined') {
                        window.dispatchEvent(new CustomEvent('geoapp-geocache-log-submitted', {
                            detail: {
                                geocacheId: gc.id,
                                gcCode: gc.gc_code,
                                logType: logTypeForGc,
                                logDate: this.logDate,
                                found: logTypeForGc === 'found',
                                logReferenceCode: result.logReferenceCode,
                            }
                        }));
                    }
                } else if (result.alreadyLogged) {
                    this.perCacheSubmitStatus = { ...this.perCacheSubmitStatus, [gc.id]: 'skipped' };
                    // Le backend confirme qu'un log du même type existe déjà sur GC.
                    // Pour "Found it" : on marque la cache comme trouvée (found_date fournie).
                    // Pour notes/DNF : on ne marque PAS already_found — la cache n'est pas
                    // "trouvée" pour autant, elle a juste un log existant (potentiellement
                    // créé par le retry après un timeout).
                    if (result.alreadyLoggedLogType === 'found' || result.foundDate) {
                        this.geocaches = this.geocaches.map(item => item.id === gc.id
                            ? { ...item, already_found: true, found_date: result.foundDate ?? item.found_date }
                            : item);
                    }
                    this.perCacheLogType = { ...this.perCacheLogType, [gc.id]: 'skip' };
                    const logTypeLabel = result.alreadyLoggedLogType === 'dnf'
                        ? 'DNF'
                        : result.alreadyLoggedLogType === 'note'
                        ? 'note'
                        : 'Found it';
                    this.messages.warn(`${gc.gc_code} - déjà loguée (${logTypeLabel}, ignorée)`);
                } else {
                    failed += 1;
                    this.perCacheSubmitStatus = { ...this.perCacheSubmitStatus, [gc.id]: 'failed' };
                    this.perCacheSubmitError = { ...this.perCacheSubmitError, [gc.id]: result.error ?? 'Erreur réseau/backend' };
                    this.messages.warn(`${gc.gc_code} - échec${result.error ? ` (${result.error})` : ''}`);
                }

                this.update();
            }

            this.lastSubmitSummary = { ok, failed };
            if (ok > 0) {
                await this.saveCurrentStateToHistory();
            }

            if (this.getGeocachesToSubmit().length === 0) {
                // Tout est parti : le travail vit désormais dans l'historique, le brouillon n'a plus d'objet.
                this.draftAutosaveSuspended = true;
                this.restoredDraftAt = undefined;
                await this.deleteDraft();
            } else {
                // Lot incomplet : on fige tout de suite l'état, y compris les logs déjà postés.
                this.flushPendingDraftSave();
                await this.persistDraft();
            }
            const notLogged = this.geocaches.filter(gc => this.isGeocacheSkipped(gc.id)).length;
            const summary = buildSubmitSummaryMessage(ok, failed, notLogged);
            if (summary.isError) {
                this.messages.warn(summary.text);
            } else {
                this.messages.info(summary.text);
            }

            const remaining = toSubmit.length - processed;
            if (this.stopRequested && remaining > 0) {
                this.messages.warn(buildStopMessage(remaining));
            }
        } finally {
            this.isSubmitting = false;
            this.stopRequested = false;
            this.submitProgress = undefined;
            this.update();
        }
    }

    /** Demande l'arrêt du lot : effectif dès que la géocache en cours est terminée. */
    protected requestSubmitStop(): void {
        if (!this.isSubmitting || this.stopRequested) {
            return;
        }
        this.stopRequested = true;
        this.update();
    }

    protected formatVisitedIso(dateOnly: string): string {
        return formatVisitedIso(dateOnly);
    }

    protected getLogTypeLabel(value: LogTypeValue): string {
        return getLogTypeLabelPure(value);
    }

    protected escapeFieldNotesText(value: string): string {
        return escapeFieldNotesText(value);
    }

    protected buildFieldNotes(): string {
        return buildFieldNotesPure(
            this.geocaches,
            this.logDate,
            this.useSameTextForAll,
            this.globalText,
            this.perCacheText,
            id => this.getLogTypeForGeocacheId(id),
            id => this.isGeocacheSkipped(id)
        );
    }

    /**
     * Analyse IA de la sortie entière.
     *
     * Contrairement à la table de zone, il n'y a pas de sélection ici : la liste des
     * géocaches à loguer *est* la sortie du jour, ce qui en fait le point d'entrée le
     * plus naturel de la fonctionnalité.
     */
    protected async analyzeOutingWithAi(): Promise<void> {
        if (this.analyzingWithAi) {
            return;
        }

        this.analyzingWithAi = true;
        this.update();

        try {
            await this.outingAnalysisController.runInteractive(
                this.geocaches.map(geocache => geocache.id),
                // Le libellé identifie la sortie autant qu'il la titre : il est aussi la
                // clé sur laquelle le plan sera rattaché. D'où la constante partagée.
                { zoneName: OUTING_LOG_EDITOR_ZONE_NAME }
            );
        } finally {
            this.analyzingWithAi = false;
            this.update();
        }
    }

    protected async copyFieldNotes(): Promise<void> {
        try {
            const content = this.buildFieldNotes();
            if (!content) {
                this.messages.warn('Aucune field note : toutes les géocaches sont en "Ne pas loguer".');
                return;
            }
            await navigator.clipboard.writeText(content);
            this.messages.info('Field notes copiées dans le presse-papiers.');
        } catch (e) {
            console.error('[GeocacheLogEditorWidget] copyFieldNotes error', e);
            this.messages.error('Impossible de copier dans le presse-papiers.');
        }
    }

    protected downloadFieldNotes(): void {
        try {
            const content = this.buildFieldNotes();
            const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'geocache_visits.txt';
            document.body.appendChild(a);
            a.click();
            a.remove();
            window.URL.revokeObjectURL(url);
        } catch (e) {
            console.error('[GeocacheLogEditorWidget] downloadFieldNotes error', e);
            this.messages.error('Impossible de télécharger le fichier.');
        }
    }

    protected async generateLogWithAi(): Promise<void> {
        if (this.isGeneratingAi) {
            return;
        }

        const keywords = (this.aiKeywords || '').trim();
        if (!keywords) {
            this.messages.warn('Veuillez entrer des mots-clés ou idées pour générer le log.');
            return;
        }

        this.isGeneratingAi = true;
        this.update();

        try {
            const generatedText = await generateLogWithAiPure(
                this.languageModelRegistry,
                this.languageModelService,
                GeoAppLogWriterAgentId,
                this.logType,
                keywords,
                this.geocaches,
                (this.aiCustomInstructions || '').trim(),
                (this.aiExampleLogs || '').trim()
            );

            if (!generatedText) {
                this.messages.warn('L\'IA n\'a pas généré de texte.');
                return;
            }

            if (this.useSameTextForAll) {
                this.globalText = generatedText;
            } else {
                const firstGeocacheId = this.geocaches[0]?.id;
                if (firstGeocacheId !== undefined) {
                    this.perCacheText = { ...this.perCacheText, [firstGeocacheId]: generatedText };
                }
            }

            this.messages.info('Log généré par IA !');

        } catch (error) {
            if (error instanceof NoLanguageModelError) {
                this.messages.error('Aucun modèle IA n\'est configuré (vérifie la configuration IA de Theia)');
                return;
            }
            console.error('[GeocacheLogEditorWidget] generateLogWithAi error', error);
            this.messages.error(`Erreur lors de la génération IA: ${error}`);
        } finally {
            this.isGeneratingAi = false;
            this.update();
        }
    }

    /**
     * Bloc d'édition d'une géocache, en mode « texte différent par cache ».
     *
     * Rendu à travers `MemoizedFragment` (cf. render) : il n'est reconstruit que si
     * l'état dont il dépend a changé, et non à chaque frappe dans une autre cache.
     */
    protected renderPerCacheBlock(gc: GeocacheListItem): React.ReactNode {
        const dropZoneKey = `cache-${gc.id}`;
        const previewKeyPrefix = `per-preview-${gc.id}`;
        const overlayKey = `per-cache-overlay-${gc.id}`;
        const charCounterStats = this.getFinalLengthStats({ geocacheId: gc.id });
        const isTextSameAsGlobal = (this.perCacheText[gc.id] ?? '') === this.globalText;

        return (
            <PerCacheBlock
                gc={gc}
                isSubmittedOk={this.isGeocacheSubmittedOk(gc.id)}
                isPendingDnf={this.isPendingDnf(gc.id)}
                isPendingAlreadyFound={this.isPendingAlreadyFound(gc.id)}
                submitStatus={this.perCacheSubmitStatus[gc.id]}
                submitReference={this.perCacheSubmitReference[gc.id]}
                submitError={this.perCacheSubmitError[gc.id]}
                logType={this.getLogTypeForGeocacheId(gc.id)}
                onLogTypeChange={value => this.setLogTypeForGeocacheId(gc.id, value)}
                isFavorite={this.perCacheFavorite[gc.id] === true}
                onFavoriteChange={value => this.toggleFavoriteForGeocacheId(gc.id, value)}
                remainingFavoritePoints={this.getRemainingFavoritePoints()}
                favoritePointsPending={this.isFavoritePointsStockPending()}
                formatFavoritePercent={(fav, logs) => this.formatFavoritePercent(fav, logs)}
                getLogTypeLabel={value => this.getLogTypeLabel(value)}
                images={this.getImagesForGeocacheId(gc.id)}
                isImagesDisabled={this.isLoading || this.isSubmitting || this.isGeocacheSubmittedOk(gc.id)}
                isDragOver={this.dragOverDropZone === dropZoneKey}
                onAddFiles={files => this.addSelectedImages(files, { geocacheId: gc.id })}
                onRemoveImage={imageId => this.removeSelectedImage({ geocacheId: gc.id }, imageId)}
                onDragOverChange={active => {
                    const next = active ? dropZoneKey : undefined;
                    if (this.dragOverDropZone === next) {
                        return;
                    }
                    this.dragOverDropZone = next;
                    this.update();
                }}
                getPreviewUrl={file => this.getPreviewUrl(file)}
                isToolbarDisabled={this.isLoading || this.isSubmitting}
                activeCaretFormat={this.activeCaretFormat}
                isEditorActive={this.isEditorActive({ type: 'per-cache', geocacheId: gc.id })}
                onApplyFormat={(kind, placeholder) => this.applyMarkdownFormat(kind, placeholder)}
                onApplyPrefix={(prefix, placeholder) => this.applyMarkdownPrefix(prefix, placeholder)}
                globalText={this.globalText}
                globalTextExcerpt={this.getGlobalTextExcerpt()}
                onApplyGlobalText={() => this.applyGlobalTextToGeocache(gc.id)}
                isApplyGlobalTextDisabled={this.isLoading || this.isSubmitting || this.isGeocacheSubmittedOk(gc.id) || isTextSameAsGlobal}
                applyGlobalTextTitle={isTextSameAsGlobal
                    ? 'Ce texte est déjà identique au texte commun'
                    : `Remplacer ce texte par le texte commun :\n\n${this.getGlobalTextExcerpt()}`}
                text={this.perCacheText[gc.id] ?? ''}
                textareaProps={{
                    className: 'theia-input',
                    value: this.perCacheText[gc.id] ?? '',
                    onChange: e => {
                        const start = e.currentTarget.selectionStart;
                        const end = e.currentTarget.selectionEnd;
                        const newValue = e.target.value;
                        this.perCacheText = { ...this.perCacheText, [gc.id]: newValue };
                        this.refreshPatternAutocomplete(newValue, e.currentTarget, gc.id);
                        this.update();
                        this.scheduleRestoreSelection({ type: 'per-cache', geocacheId: gc.id }, start, end);
                    },
                    onKeyDown: e => this.handleTextAreaKeyDown(e, gc.id),
                    onBlur: () => this.handleTextAreaBlur(),
                    onFocus: () => { this.activeEditor = { type: 'per-cache', geocacheId: gc.id }; },
                    disabled: this.isGeocacheSubmittedOk(gc.id),
                    rows: 6,
                    style: { width: '100%', resize: 'vertical' },
                    placeholder: 'Texte (Markdown) - Tapez @ pour insérer un pattern'
                }}
                textareaRef={el => { this.perCacheTextAreas = { ...this.perCacheTextAreas, [gc.id]: el }; }}
                overlayKey={overlayKey}
                patternNames={this.getPatternsIndex().names}
                resolvePatternValue={(name, id) => this.resolvePatternValue(name, id)}
                onCaretChange={ta => this.refreshCaretFormat(ta)}
                onScrollSync={(key, ta) => this.syncOverlayScroll(key, ta)}
                registerTextarea={(key, el) => { this.overlayTextareas[key] = el; }}
                registerOverlay={(key, el) => { this.overlayElements[key] = el; }}
                autocompleteOpen={this.patternAutocompleteOpen && this.patternAutocompleteTargetGeocacheId === gc.id}
                autocompleteSuggestions={this.patternAutocompleteSuggestions}
                autocompleteActiveIndex={this.patternAutocompleteActiveIndex}
                autocompletePosition={this.patternAutocompletePosition}
                onAutocompleteHover={idx => { this.patternAutocompleteActiveIndex = idx; this.update(); }}
                onAutocompleteClick={s => this.applyPatternSuggestion(s)}
                charCounterStats={charCounterStats}
                resolvedText={this.resolveAllPatterns(this.perCacheText[gc.id] ?? '', gc.id)}
                previewKeyPrefix={previewKeyPrefix}
                isPreviewOpen={this.openMarkdownPreviews.has(previewKeyPrefix)}
                onPreviewToggle={open => {
                    if (open) {
                        this.openMarkdownPreviews.add(previewKeyPrefix);
                    } else {
                        this.openMarkdownPreviews.delete(previewKeyPrefix);
                    }
                    this.update();
                }}
            />
        );
    }

    protected render(): React.ReactNode {
        const allSubmitted = this.geocaches.length > 0 && this.geocaches.every(gc => this.isGeocacheSubmittedOk(gc.id));
        const remainingFavoritePoints = this.getRemainingFavoritePoints();
        const favoritePointsPending = this.isFavoritePointsStockPending();
        // Une synchronisation ratée laisse le stock inconnu : le bouton doit rester
        // cliquable pour réessayer, seul un appel en vol le désactive.
        const favoritePointsSyncing = this.isSyncingFavoritePoints || this.isFetchingFavoritePoints;
        const canPrev = !this.isLoadingHistory && this.logHistory.length > 0 && (this.logHistoryCursor < this.logHistory.length - 1);
        const canNext = !this.isLoadingHistory && this.logHistory.length > 0 && (this.logHistoryCursor > 0);
        const canSubmit = this.getGeocachesToSubmit().length > 0;
        const pendingAlreadyFound = this.getPendingAlreadyFoundGeocaches();
        const globalPreviewKey = 'global-preview';
        const globalOverlayKey = 'global-overlay';
        const globalDropZoneKey = 'global';
        const charCounterStats = this.getFinalLengthStats('global');

        return (
            <div style={{ padding: 12, height: '100%', overflow: 'auto', display: 'grid', gap: 12 }}>
                <LogEditorHeader
                    geocacheCount={this.geocacheIds.length}
                    loadedCount={this.geocaches.length}
                    isLoading={this.isLoading}
                    isLoadingHistory={this.isLoadingHistory}
                    canPrev={canPrev}
                    canNext={canNext}
                    isSubmitting={this.isSubmitting}
                    submitProgress={this.submitProgress}
                    canSubmit={canSubmit}
                    submitTitle={this.geocaches.length > 0 && !canSubmit
                        ? 'Aucune géocache à envoyer (déjà envoyées ou en "Ne pas loguer")'
                        : 'Envoyer le(s) log(s) sur Geocaching.com via le backend'}
                    stopRequested={this.stopRequested}
                    onNavigateHistory={delta => this.navigateHistory(delta)}
                    onSubmit={() => { void this.submitLogsToGeocaching(); }}
                    onRequestStop={() => this.requestSubmitStop()}
                    onCopyFieldNotes={() => { void this.copyFieldNotes(); }}
                    onDownloadFieldNotes={() => this.downloadFieldNotes()}
                    onAnalyzeWithAi={() => { void this.analyzeOutingWithAi(); }}
                    analyzingWithAi={this.analyzingWithAi}
                />

                {this.submitProgress && (
                    <SubmitProgress
                        progress={this.submitProgress}
                        stopRequested={this.stopRequested}
                    />
                )}

                {this.restoredDraftAt && (
                    <DraftBanner
                        restoredDraftAt={this.restoredDraftAt}
                        onDiscard={() => this.discardRestoredDraft()}
                        onDismiss={() => { this.restoredDraftAt = undefined; this.update(); }}
                    />
                )}

                <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
                    {this.lastSubmitSummary && (
                        <div style={{ opacity: 0.85, fontSize: 12 }}>
                            Résultat: {this.lastSubmitSummary.ok} ok, {this.lastSubmitSummary.failed} échec(s)
                        </div>
                    )}
                    <div style={{ display: 'flex', gap: 12, alignItems: 'center', fontSize: 12 }}>
                        <div style={{ opacity: 0.85, display: 'flex', gap: 4, alignItems: 'center' }}>
                            <strong>PF disponibles:</strong>
                            {favoritePointsSyncing ? '⏳' : (this.favoritePointsKnown ? this.totalFavoritePoints : '—')}
                            <button
                                className='theia-button secondary'
                                style={{ fontSize: 11, padding: '0 6px', minWidth: 0 }}
                                onClick={() => { void this.syncFavoritePoints({ force: true }); }}
                                disabled={favoritePointsSyncing || this.isSubmitting}
                                title='Resynchroniser le stock de points favoris depuis Geocaching.com'
                            >
                                ⟳
                            </button>
                        </div>
                        <div style={{ opacity: 0.85 }}>
                            <strong>PF restants:</strong> <span style={{ color: remainingFavoritePoints === 0 ? 'var(--theia-errorForeground)' : 'inherit' }}>{remainingFavoritePoints}</span>
                        </div>
                        <div style={{ opacity: 0.85, display: 'flex', gap: 4, alignItems: 'center' }}>
                            <strong>Trouvailles:</strong> {this.userFindsCount}
                            <button
                                className='theia-button secondary'
                                style={{ fontSize: 11, padding: '0 6px', minWidth: 0 }}
                                onClick={() => { void this.refreshUserFindsCount(); }}
                                disabled={this.isRefreshingFindsCount || this.isSubmitting}
                                title='Resynchroniser le nombre de trouvailles depuis Geocaching.com (base de @cache_count)'
                            >
                                {this.isRefreshingFindsCount ? '⏳' : '⟳'}
                            </button>
                        </div>
                    </div>
                </div>

                <PatternsSection
                    allPatternsCount={this.getAllPatterns().length}
                    builtinPatterns={this.getBuiltinPatterns()}
                    customPatterns={this.customPatterns}
                    resolvePatternValue={(name, id) => this.resolvePatternValue(name, id)}
                    firstGeocacheId={this.geocaches[0]?.id ?? null}
                    editingPattern={this.editingPattern}
                    patternNameInput={this.patternNameInput}
                    patternContentInput={this.patternContentInput}
                    onPatternNameInputChange={value => { this.patternNameInput = value; this.update(); }}
                    onPatternContentInputChange={value => { this.patternContentInput = value; this.update(); }}
                    onEditPattern={p => {
                        this.editingPattern = p;
                        this.patternNameInput = p.name;
                        this.patternContentInput = p.content;
                        this.update();
                    }}
                    onDeletePattern={id => this.deletePattern(id)}
                    onAddPattern={() => this.addPattern(this.patternNameInput, this.patternContentInput)}
                    onUpdatePattern={() => this.updatePattern(this.editingPattern!.id, this.patternNameInput, this.patternContentInput)}
                    onCancelEditPattern={() => {
                        this.editingPattern = null;
                        this.patternNameInput = '';
                        this.patternContentInput = '';
                        this.update();
                    }}
                />

                <AiGenerationPanel
                    open={this.showAiPanel}
                    onToggleOpen={open => { this.showAiPanel = open; }}
                    keywords={this.aiKeywords}
                    onKeywordsChange={value => { this.aiKeywords = value; this.update(); }}
                    customInstructions={this.aiCustomInstructions}
                    onCustomInstructionsChange={value => { this.aiCustomInstructions = value; this.update(); }}
                    exampleLogs={this.aiExampleLogs}
                    onExampleLogsChange={value => { this.aiExampleLogs = value; this.update(); }}
                    isGenerating={this.isGeneratingAi}
                    allSubmitted={allSubmitted}
                    onGenerate={() => { void this.generateLogWithAi(); }}
                />

                {!this.isLoading && this.geocaches.length > 0 && (
                    <div style={{ background: 'var(--theia-editor-background)' }}>
                        <GeocacheLogEditorGeocachesTable
                            data={this.geocaches}
                            logType={this.logType}
                            perCacheLogType={this.perCacheLogType}
                            perCacheFavorite={this.perCacheFavorite}
                            perCacheSubmitStatus={this.perCacheSubmitStatus}
                            perCacheSubmitReference={this.perCacheSubmitReference}
                            perCacheSubmitError={this.perCacheSubmitError}
                            onToggleFavorite={this.handleTableToggleFavorite}
                            onToggleLogType={this.handleTableToggleLogType}
                            onReorder={this.handleTableReorder}
                            reorderDisabled={this.isSubmitting}
                            remainingFavoritePoints={remainingFavoritePoints}
                            favoritePointsPending={favoritePointsPending}
                            outingFlags={this.outingFlags}
                            maxHeight={220}
                        />
                    </div>
                )}

                {allSubmitted && (
                    <div
                        style={{
                            border: '1px solid var(--theia-panel-border)',
                            background: 'var(--theia-editor-background)',
                            borderRadius: 6,
                            padding: '8px 10px',
                            fontSize: 12,
                            fontWeight: 600,
                        }}
                    >
                        ✅ Tous les logs ont été envoyés.
                    </div>
                )}

                <GlobalLogEditor
                    logDate={this.logDate}
                    onLogDateChange={value => this.setLogDate(value)}
                    isLogDatePinned={this.isLogDatePinned}
                    onToggleLogDatePin={() => this.toggleLogDatePin()}
                    logType={this.logType}
                    onLogTypeChange={value => this.setGlobalLogType(value)}
                    pendingAlreadyFoundCount={pendingAlreadyFound.length}
                    pendingAlreadyFoundCodes={pendingAlreadyFound.map(gc => gc.gc_code).join(', ')}
                    useSameTextForAll={this.useSameTextForAll}
                    onToggleUseSameTextForAll={checked => this.toggleUseSameTextForAll(checked)}
                    globalText={this.globalText}
                    globalTextExcerpt={this.getGlobalTextExcerpt()}
                    onApplyGlobalTextToAll={() => { void this.applyGlobalTextToAllGeocaches(); }}
                    historyDropdownOpen={this.historyDropdownOpen}
                    onToggleHistoryDropdown={() => { this.historyDropdownOpen = !this.historyDropdownOpen; this.update(); }}
                    logHistory={this.logHistory}
                    onApplyHistoryTextOnly={entry => this.applyHistoryTextOnly(entry)}
                    canUseHistory={!this.isLoading && !this.isSubmitting && !allSubmitted}
                    isToolbarDisabled={this.isLoading || this.isSubmitting || allSubmitted}
                    activeCaretFormat={this.activeCaretFormat}
                    isEditorActive={this.isEditorActive({ type: 'global' })}
                    onApplyFormat={(kind, placeholder) => this.applyMarkdownFormat(kind, placeholder)}
                    onApplyPrefix={(prefix, placeholder) => this.applyMarkdownPrefix(prefix, placeholder)}
                    textareaProps={{
                        className: 'theia-input',
                        value: this.globalText,
                        onChange: e => {
                            const start = e.currentTarget.selectionStart;
                            const end = e.currentTarget.selectionEnd;
                            this.globalText = e.currentTarget.value;
                            this.refreshPatternAutocomplete(e.currentTarget.value, e.currentTarget, null);
                            this.update();
                            this.scheduleRestoreSelection({ type: 'global' }, start, end);
                        },
                        onKeyDown: e => this.handleTextAreaKeyDown(e, null),
                        onBlur: () => this.handleTextAreaBlur(),
                        onFocus: () => { this.activeEditor = { type: 'global' }; },
                        rows: 10,
                        style: { width: '100%', resize: 'vertical' },
                    }}
                    textareaRef={el => { this.globalTextArea = el; }}
                    overlayKey={globalOverlayKey}
                    patternNames={this.getPatternsIndex().names}
                    resolvePatternValue={(name, id) => this.resolvePatternValue(name, id)}
                    onCaretChange={ta => this.refreshCaretFormat(ta)}
                    onScrollSync={(key, ta) => this.syncOverlayScroll(key, ta)}
                    registerTextarea={(key, el) => { this.overlayTextareas[key] = el; }}
                    registerOverlay={(key, el) => { this.overlayElements[key] = el; }}
                    isTextareaDisabled={this.geocaches.length > 0 && this.geocaches.every(gc => this.isGeocacheSubmittedOk(gc.id))}
                    autocompleteOpen={this.patternAutocompleteOpen && this.patternAutocompleteTargetGeocacheId === null}
                    autocompleteSuggestions={this.patternAutocompleteSuggestions}
                    autocompleteActiveIndex={this.patternAutocompleteActiveIndex}
                    autocompletePosition={this.patternAutocompletePosition}
                    onAutocompleteHover={idx => { this.patternAutocompleteActiveIndex = idx; this.update(); }}
                    onAutocompleteClick={s => this.applyPatternSuggestion(s)}
                    charCounterStats={charCounterStats}
                    images={this.globalImages}
                    isImagesDisabled={this.isLoading || this.isSubmitting || allSubmitted}
                    isDragOver={this.dragOverDropZone === globalDropZoneKey}
                    onAddFiles={files => this.addSelectedImages(files, 'global')}
                    onRemoveImage={imageId => this.removeSelectedImage('global', imageId)}
                    onDragOverChange={active => {
                        const next = active ? globalDropZoneKey : undefined;
                        if (this.dragOverDropZone === next) {
                            return;
                        }
                        this.dragOverDropZone = next;
                        this.update();
                    }}
                    getPreviewUrl={file => this.getPreviewUrl(file)}
                    resolvedText={this.resolveAllPatterns(this.globalText, this.geocaches[0]?.id ?? null)}
                    previewKeyPrefix={globalPreviewKey}
                    isPreviewOpen={this.openMarkdownPreviews.has(globalPreviewKey)}
                    onPreviewToggle={open => {
                        if (open) {
                            this.openMarkdownPreviews.add(globalPreviewKey);
                        } else {
                            this.openMarkdownPreviews.delete(globalPreviewKey);
                        }
                        this.update();
                    }}
                />

                {this.isLoading && (
                    <div style={{ opacity: 0.7 }}>
                        Chargement…
                    </div>
                )}

                {!this.isLoading && this.geocaches.length === 0 && (
                    <div style={{ opacity: 0.7 }}>
                        Aucune géocache
                    </div>
                )}

                {!this.isLoading && this.geocaches.length > 0 && !this.useSameTextForAll && (
                    <div style={{ display: 'grid', gap: 10 }}>
                        {this.geocaches.map(gc => {
                            const previewKey = `per-preview-${gc.id}`;
                            const autocompleteHere = this.patternAutocompleteOpen
                                && this.patternAutocompleteTargetGeocacheId === gc.id;
                            return (
                                <MemoizedFragment
                                    key={gc.id}
                                    // Tout ce que le bloc lit dans l'état du widget. Une frappe ne
                                    // change que le texte de la cache éditée : les autres blocs sont
                                    // alors sautés au lieu d'être redessinés.
                                    deps={[
                                        gc,
                                        this.geocaches,
                                        this.perCacheText[gc.id],
                                        this.globalText,
                                        this.perCacheLogType,
                                        this.logType,
                                        this.perCacheFavorite[gc.id] === true,
                                        remainingFavoritePoints,
                                        favoritePointsPending,
                                        this.perCacheSubmitStatus[gc.id],
                                        this.perCacheSubmitReference[gc.id],
                                        this.perCacheSubmitError[gc.id],
                                        this.isLoading,
                                        this.isSubmitting,
                                        this.customPatterns,
                                        this.userFindsCount,
                                        this.logDate,
                                        this.perCacheImages[gc.id],
                                        this.dragOverDropZone === `cache-${gc.id}`,
                                        this.isEditorActive({ type: 'per-cache', geocacheId: gc.id })
                                            ? this.activeCaretFormat
                                            : undefined,
                                        autocompleteHere ? this.patternAutocompleteSuggestions : undefined,
                                        autocompleteHere ? this.patternAutocompletePosition : undefined,
                                        autocompleteHere ? this.patternAutocompleteActiveIndex : undefined,
                                        this.openMarkdownPreviews.has(previewKey),
                                    ]}
                                    render={() => this.renderPerCacheBlock(gc)}
                                />
                            );
                        })}
                    </div>
                )}
            </div>
        );
    }
}
