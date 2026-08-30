import * as React from '@theia/core/shared/react';
import { injectable, inject } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { MessageService } from '@theia/core';
import { Message, StorageService } from '@theia/core/lib/browser';
import { PreferenceService } from '@theia/core/lib/common/preferences/preference-service';
import { LanguageModelRegistry, LanguageModelService, UserRequest, getTextOfResponse, getJsonOfResponse, isLanguageModelParsedResponse } from '@theia/ai-core';
import { GeoAppLogWriterAgentId } from './geoapp-log-writer-agent';
import { LogTypeIcon } from './geocache-log-type-icons';
import { AiGenerationPanel } from './log-editor/ai-generation-panel';
import { CharCounter } from './log-editor/char-counter';
import { DnfBadge } from './log-editor/dnf-badge';
import { DraftBanner } from './log-editor/draft-banner';
import { GeocacheLogEditorGeocachesTable } from './log-editor/geocaches-table';
import { ImagesSection } from './log-editor/images-section';
import {
    buildFieldNotes as buildFieldNotesPure,
    buildSubmissionSummaryNode as buildSubmissionSummaryNodePure,
    confirmSubmission as confirmSubmissionPure,
    escapeFieldNotesText,
    formatVisitedIso,
    getLogTypeLabel,
    submitOneLog,
    uploadOneLogImage as uploadOneLogImagePure,
} from './log-editor/log-submit-service';
import { MarkdownPreview } from './log-editor/markdown-preview';
import { MarkdownToolbar } from './log-editor/markdown-toolbar';
import { MemoizedFragment } from './log-editor/memoized-fragment';
import {
    buildPatternsIndex,
    getBuiltinPatterns,
    getCacheCountForIndex,
    getLogTypeForGeocache as getLogTypeForGeocachePure,
    getPatternResolutionSignature,
    resolveAllPatterns as resolveAllPatternsPure,
    resolvePatternValue,
    type PatternResolutionContext,
} from './log-editor/pattern-resolver';
import { SubmitBadge } from './log-editor/submit-badge';
import { TextareaWithOverlay, TextWithHighlightedPatterns } from './log-editor/textarea-overlay';
import { SubmitProgress } from './log-editor/submit-progress';
import {
    ALREADY_FOUND_ACCENT,
    ALREADY_FOUND_ROW_BACKGROUND,
    DNF_ACCENT,
    DNF_ROW_BACKGROUND,
    GC_LOG_MAX_LENGTH,
    IMAGE_FAILURE_SEND,
    IMAGE_FAILURE_SEND_ALL,
    IMAGE_FAILURE_SKIP,
    JUST_LOGGED_ACCENT,
    JUST_LOGGED_ROW_BACKGROUND,
    PATTERN_AUTOCOMPLETE_DELAY_MS,
} from './log-editor/constants';
import {
    alreadyFoundTooltip,
    findPatternTokenStart,
    getCaretCoordinates,
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
    isLogTypeValue,
    isSubmissionStatus,
} from './log-editor/types';
import {
    findFormatAtCaret,
    MarkdownFormatKind,
    sanitizeLogUrl,
    toggleMarkdownFormat,
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
    ) {
        super();
        this.title.label = 'Logs';
        this.title.caption = 'Édition de logs';
        this.title.closable = true;
        this.title.iconClass = 'fa fa-pen';
        this.addClass('theia-geocache-log-editor-widget');
    }

    protected getLogHistoryMaxItems(): number {
        const raw = this.preferenceService.get<number>(this.logHistoryMaxItemsPreferenceKey, 10);
        const value = typeof raw === 'number' && isFinite(raw) ? Math.floor(raw) : 10;
        return Math.max(1, Math.min(50, value));
    }


    protected readLegacyLocalStorageHistory(): LogHistoryEntry[] {
        try {
            if (typeof window === 'undefined' || !window.localStorage) {
                return [];
            }
            const raw = window.localStorage.getItem(this.legacyLogHistoryLocalStorageKey);
            if (!raw) {
                return [];
            }
            const parsed = JSON.parse(raw);
            if (!Array.isArray(parsed)) {
                return [];
            }
            return (parsed as any[])
                .filter(x => x && typeof x === 'object')
                .map((x: any): LogHistoryEntry => ({
                    id: typeof x.id === 'string' ? x.id : this.generateId(),
                    createdAt: typeof x.createdAt === 'string' ? x.createdAt : new Date().toISOString(),
                    logDate: typeof x.logDate === 'string' ? x.logDate : todayIsoDate(),
                    useSameTextForAll: x.useSameTextForAll === true,
                    globalText: typeof x.globalText === 'string' ? x.globalText : '',
                    perCacheText: (x.perCacheText && typeof x.perCacheText === 'object') ? x.perCacheText as Record<number, string> : {},
                    logType: isLogTypeValue(x.logType) ? x.logType : 'found',
                    perCacheLogType: (x.perCacheLogType && typeof x.perCacheLogType === 'object') ? x.perCacheLogType as Record<number, LogTypeValue> : {},
                    perCacheFavorite: (x.perCacheFavorite && typeof x.perCacheFavorite === 'object') ? x.perCacheFavorite as Record<number, boolean> : {},
                }));
        } catch {
            return [];
        }
    }

    protected async refreshLogHistory(): Promise<void> {
        this.isLoadingHistory = true;
        this.logHistoryCursor = -1;
        this.update();

        let stored = await this.storageService.getData<LogHistoryEntry[]>(this.logHistoryStorageKey, []);
        if (!Array.isArray(stored)) {
            stored = [];
        }

        if (stored.length === 0) {
            const legacy = this.readLegacyLocalStorageHistory();
            if (legacy.length > 0) {
                stored = legacy;
                await this.storageService.setData(this.logHistoryStorageKey, stored);
            }
        }

        this.logHistory = stored;
        this.isLoadingHistory = false;
        this.update();
    }

    protected getDraftKey(): string | undefined {
        if (this.geocacheIds.length === 0) {
            return undefined;
        }
        // Clé triée : le même ensemble de géocaches retrouve son brouillon quel que soit l'ordre d'ouverture.
        return Array.from(new Set(this.geocacheIds)).sort((a, b) => a - b).join('-');
    }

    protected async readDrafts(): Promise<Record<string, LogDraft>> {
        const stored = await this.storageService.getData<Record<string, LogDraft>>(this.draftsStorageKey, {});
        if (!stored || typeof stored !== 'object' || Array.isArray(stored)) {
            return {};
        }
        return stored;
    }

    /** Le stockage local est partagé avec tout Theia : on ne garde que les brouillons récents. */
    protected pruneDrafts(drafts: Record<string, LogDraft>): Record<string, LogDraft> {
        const now = Date.now();
        const kept = Object.entries(drafts)
            .filter(([, draft]) => {
                if (!draft || typeof draft !== 'object' || typeof draft.savedAt !== 'string') {
                    return false;
                }
                const savedAt = Date.parse(draft.savedAt);
                return Number.isNaN(savedAt) || now - savedAt < this.draftsMaxAgeMs;
            })
            .sort((a, b) => Date.parse(b[1].savedAt) - Date.parse(a[1].savedAt))
            .slice(0, this.draftsMaxItems);
        return Object.fromEntries(kept);
    }

    /**
     * Y a-t-il quelque chose à perdre ? Un onglet ouvert et laissé tel quel ne mérite pas
     * de brouillon : ça ferait réapparaître un bandeau de restauration pour rien.
     */
    protected hasDraftWorthSaving(): boolean {
        if (this.globalText.trim() !== '' || Object.values(this.perCacheText).some(text => (text ?? '').trim() !== '')) {
            return true;
        }
        if (Object.values(this.perCacheFavorite).some(value => value === true)) {
            return true;
        }
        if (Object.keys(this.perCacheSubmitStatus).length > 0) {
            return true;
        }
        // Comparaison avec le type global *assaini* : une cache déjà trouvée bascule d'office sur
        // « Ne pas loguer », ce n'est pas un choix de l'utilisateur et ça ne justifie pas un brouillon.
        return this.geocaches.some(gc => this.getLogTypeForGeocacheId(gc.id) !== sanitizeLogTypeForGeocache(this.logType, gc));
    }

    protected buildDraft(): LogDraft {
        return {
            savedAt: new Date().toISOString(),
            geocacheIds: this.geocaches.map(gc => gc.id),
            logDate: this.logDate,
            logType: this.logType,
            useSameTextForAll: this.useSameTextForAll,
            globalText: this.globalText,
            perCacheText: { ...this.perCacheText },
            perCacheLogType: { ...this.perCacheLogType },
            perCacheFavorite: { ...this.perCacheFavorite },
            perCacheSubmitStatus: { ...this.perCacheSubmitStatus },
            perCacheSubmitReference: { ...this.perCacheSubmitReference },
        };
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

            const drafts = await this.readDrafts();
            if (draft) {
                drafts[key] = draft;
            } else if (!(key in drafts)) {
                this.lastPersistedDraftJson = signature;
                return;
            } else {
                delete drafts[key];
            }

            await this.storageService.setData(this.draftsStorageKey, this.pruneDrafts(drafts));
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
            const drafts = await this.readDrafts();
            if (key in drafts) {
                delete drafts[key];
                await this.storageService.setData(this.draftsStorageKey, drafts);
            }
            this.lastPersistedDraftJson = 'empty';
        } catch (e) {
            console.error('[GeocacheLogEditorWidget] deleteDraft error', e);
        }
    }

    /** Ne conserve d'un enregistrement que les clés correspondant aux géocaches réellement chargées. */
    protected pickKnownGeocacheValues<T>(source: Record<number, T> | undefined, isValid: (value: unknown) => value is T): Record<number, T> {
        const result: Record<number, T> = {};
        if (!source || typeof source !== 'object') {
            return result;
        }
        for (const gc of this.geocaches) {
            const value = (source as Record<number, unknown>)[gc.id];
            if (isValid(value)) {
                result[gc.id] = value;
            }
        }
        return result;
    }

    protected applyDraft(draft: LogDraft): void {
        // Une date épinglée reste prioritaire, comme pour l'historique.
        if (!this.isLogDatePinned && this.isValidIsoDate(draft.logDate)) {
            this.logDate = draft.logDate;
        }
        if (isLogTypeValue(draft.logType)) {
            this.logType = draft.logType;
        }
        this.useSameTextForAll = draft.useSameTextForAll === true;
        this.globalText = typeof draft.globalText === 'string' ? draft.globalText : '';
        this.perCacheText = this.pickKnownGeocacheValues(draft.perCacheText, (v): v is string => typeof v === 'string');
        // Comme pour l'historique : on ignore quels textes ont été personnalisés, donc aucun marqueur de distribution.
        this.lastDistributedGlobalText = undefined;

        const restoredTypes = this.pickKnownGeocacheValues(draft.perCacheLogType, isLogTypeValue);
        const nextTypes: Record<number, LogTypeValue> = { ...this.perCacheLogType };
        for (const gc of this.geocaches) {
            const stored = restoredTypes[gc.id];
            if (stored !== undefined) {
                nextTypes[gc.id] = sanitizeLogTypeForGeocache(stored, gc);
            }
        }
        this.perCacheLogType = nextTypes;

        this.perCacheFavorite = {
            ...this.perCacheFavorite,
            ...this.pickKnownGeocacheValues(draft.perCacheFavorite, (v): v is boolean => typeof v === 'boolean'),
        };
        this.perCacheSubmitStatus = this.pickKnownGeocacheValues(draft.perCacheSubmitStatus, isSubmissionStatus);
        this.perCacheSubmitReference = this.pickKnownGeocacheValues(draft.perCacheSubmitReference, (v): v is string => typeof v === 'string');

        // L'ordre est celui d'envoi et de la numérotation @cache_count : il fait partie du travail à restaurer.
        const restoredIds = Array.isArray(draft.geocacheIds) ? draft.geocacheIds.filter(id => typeof id === 'number') : [];
        if (restoredIds.length === this.geocaches.length && restoredIds.every(id => this.geocaches.some(gc => gc.id === id))) {
            this.reorderGeocaches(restoredIds);
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

    protected renderDraftBanner(): React.ReactNode {
        if (!this.restoredDraftAt) {
            return null;
        }
        return (
            <DraftBanner
                restoredDraftAt={this.restoredDraftAt}
                onDiscard={() => this.discardRestoredDraft()}
                onDismiss={() => { this.restoredDraftAt = undefined; this.update(); }}
            />
        );
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
        const entry: LogHistoryEntry = {
            id: this.generateId(),
            createdAt: new Date().toISOString(),
            logDate: this.logDate,
            useSameTextForAll: this.useSameTextForAll,
            globalText: this.globalText,
            perCacheText: { ...this.perCacheText },
            logType: this.logType,
            perCacheLogType: { ...this.perCacheLogType },
            perCacheFavorite: { ...this.perCacheFavorite },
        };

        const maxItems = this.getLogHistoryMaxItems();
        const next = [entry, ...this.logHistory].slice(0, maxItems);
        this.logHistory = next;
        await this.storageService.setData(this.logHistoryStorageKey, next);
        this.logHistoryCursor = -1;
        this.update();
    }

    protected applyHistoryEntry(entry: LogHistoryEntry): void {
        const safeLogType = isLogTypeValue(entry.logType) ? entry.logType : this.logType;

        const perCacheValues = entry.perCacheText && typeof entry.perCacheText === 'object'
            ? entry.perCacheText as Record<number, string>
            : {};

        const perCacheLogTypeValues = entry.perCacheLogType && typeof entry.perCacheLogType === 'object'
            ? entry.perCacheLogType as Record<number, LogTypeValue>
            : {};

        const perCacheFavoriteValues = entry.perCacheFavorite && typeof entry.perCacheFavorite === 'object'
            ? entry.perCacheFavorite as Record<number, boolean>
            : {};

        // Une date épinglée reste prioritaire sur celle de l'entrée d'historique restaurée.
        if (!this.isLogDatePinned) {
            this.logDate = entry.logDate;
        }
        this.useSameTextForAll = entry.useSameTextForAll ?? false;
        this.globalText = entry.globalText ?? '';
        this.perCacheText = perCacheValues;
        // Les textes viennent de l'historique : on ne sait pas lesquels ont été personnalisés,
        // donc on repart sans marqueur de distribution (ils seront tous conservés).
        this.lastDistributedGlobalText = undefined;
        this.logType = safeLogType;
        this.perCacheLogType = perCacheLogTypeValues;
        this.perCacheFavorite = perCacheFavoriteValues;

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
        if (this.logHistory.length === 0) {
            return;
        }

        let nextCursor: number;
        if (this.logHistoryCursor < 0) {
            if (delta <= 0) {
                return;
            }
            nextCursor = 0;
        } else {
            nextCursor = this.logHistoryCursor + delta;
        }

        nextCursor = Math.max(0, Math.min(this.logHistory.length - 1, nextCursor));
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
        return (value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
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
                const safeStart = Math.max(0, Math.min(pending.start, ta.value.length));
                const safeEnd = Math.max(0, Math.min(pending.end, ta.value.length));
                ta.setSelectionRange(safeStart, safeEnd);
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

        const edit = toggleMarkdownFormat(value, start, end, kind, placeholder);

        this.applyEditorValue(editor, edit.value);
        this.activeCaretFormat = findFormatAtCaret(edit.value, edit.selectionStart)?.kind;
        this.update();
        this.scheduleSelection(editor, edit.selectionStart, edit.selectionEnd);
    }

    /**
     * Recalcule le format sous le curseur pour allumer le bouton correspondant.
     * Ne redessine que si l'état change, pour ne pas re-rendre à chaque frappe.
     */
    protected refreshCaretFormat(textArea: HTMLTextAreaElement): void {
        const next = findFormatAtCaret(textArea.value, textArea.selectionStart ?? 0)?.kind;
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

        const lineStart = value.lastIndexOf('\n', start - 1) + 1;
        const lineEnd = value.indexOf('\n', end);
        const safeLineEnd = lineEnd === -1 ? value.length : lineEnd;

        const selectedBlock = value.slice(lineStart, safeLineEnd);
        const isEmpty = !selectedBlock.trim();
        const toProcess = isEmpty ? placeholder : selectedBlock;

        const processed = toProcess
            .split('\n')
            .map(l => (l.trim() ? `${prefix}${l}` : l))
            .join('\n');

        const nextValue = value.slice(0, lineStart) + processed + value.slice(safeLineEnd);
        this.applyEditorValue(editor, nextValue);
        this.update();

        setTimeout(() => {
            const nextTa = this.getEditorTextArea(editor);
            if (!nextTa) {
                return;
            }
            nextTa.focus();
            const selStart = lineStart + prefix.length;
            if (isEmpty) {
                nextTa.setSelectionRange(selStart, selStart + placeholder.length);
            } else {
                nextTa.setSelectionRange(lineStart, lineStart + processed.length);
            }
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
        const existing = this.previewUrlByFile.get(file);
        if (existing) {
            return existing;
        }
        try {
            const url = URL.createObjectURL(file);
            this.previewUrlByFile.set(file, url);
            return url;
        } catch (e) {
            console.warn('[GeocacheLogEditorWidget] createObjectURL failed', e);
            return undefined;
        }
    }

    /** Libère les object URLs des fichiers qui ne sont plus référencés par aucune sélection. */
    protected releaseUnusedPreviewUrls(): void {
        const inUse = new Set<File>();
        for (const img of this.globalImages) {
            inUse.add(img.file);
        }
        for (const list of Object.values(this.perCacheImages)) {
            for (const img of list) {
                inUse.add(img.file);
            }
        }
        for (const [file, url] of Array.from(this.previewUrlByFile.entries())) {
            if (!inUse.has(file)) {
                try {
                    URL.revokeObjectURL(url);
                } catch {
                }
                this.previewUrlByFile.delete(file);
            }
        }
    }

    protected generateId(): string {
        try {
            const w: any = window as any;
            if (w?.crypto?.randomUUID) {
                return w.crypto.randomUUID();
            }
        } catch {
        }
        return `img-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    }

    protected addSelectedImages(files: FileList | File[], target: 'global' | { geocacheId: number }): void {
        const list = Array.from(files as any as File[]).filter(f => f instanceof File);
        if (list.length === 0) {
            return;
        }

        const mapped: SelectedLogImage[] = list.map(file => ({
            id: this.generateId(),
            file,
            status: 'pending',
        }));

        if (target === 'global') {
            this.globalImages = [...this.globalImages, ...mapped];
        } else {
            const current = this.perCacheImages[target.geocacheId] ?? [];
            this.perCacheImages = { ...this.perCacheImages, [target.geocacheId]: [...current, ...mapped] };
        }
        this.update();
    }

    protected removeSelectedImage(target: 'global' | { geocacheId: number }, imageId: string): void {
        if (target === 'global') {
            this.globalImages = this.globalImages.filter(img => img.id !== imageId);
        } else {
            const current = this.perCacheImages[target.geocacheId] ?? [];
            this.perCacheImages = { ...this.perCacheImages, [target.geocacheId]: current.filter(img => img.id !== imageId) };
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
            working = working.map(img => ({
                ...img,
                status: 'pending',
                imageGuid: undefined,
                error: undefined,
            }));
            this.setImagesForGeocacheId(geocacheId, working);
        }
        for (let i = 0; i < working.length; i += 1) {
            const img = working[i];
            if (img.status === 'ok' && img.imageGuid) {
                continue;
            }
            working[i] = { ...img, status: 'uploading', error: undefined };
            this.setImagesForGeocacheId(geocacheId, working);
            onProgress?.(i, working.length);
            const uploaded = await this.uploadOneLogImage(geocacheId, working[i]);
            working[i] = uploaded;
            this.setImagesForGeocacheId(geocacheId, working);
        }
        onProgress?.(working.length, working.length);

        return {
            guids: working.filter(x => x.status === 'ok' && typeof x.imageGuid === 'string').map(x => x.imageGuid as string),
            total: working.length,
            failed: working.filter(x => x.status !== 'ok' || typeof x.imageGuid !== 'string').length,
        };
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

    protected renderImagesSection(target: 'global' | { geocacheId: number }, disabled: boolean): React.ReactNode {
        const images = target === 'global' ? this.globalImages : (this.perCacheImages[target.geocacheId] ?? []);
        const title = target === 'global' ? 'Photos (appliquées à toutes les géocaches)' : 'Photos';
        const dropZoneKey = target === 'global' ? 'global' : `cache-${target.geocacheId}`;

        return (
            <ImagesSection
                images={images}
                title={title}
                disabled={disabled}
                isDragOver={this.dragOverDropZone === dropZoneKey}
                onAddFiles={files => this.addSelectedImages(files, target)}
                onRemoveImage={imageId => this.removeSelectedImage(target, imageId)}
                onDragOverChange={active => {
                    const next = active ? dropZoneKey : undefined;
                    if (this.dragOverDropZone === next) {
                        return;
                    }
                    this.dragOverDropZone = next;
                    this.update();
                }}
                getPreviewUrl={file => this.getPreviewUrl(file)}
            />
        );
    }

    protected getRemainingFavoritePoints(): number {
        const usedCount = Object.values(this.perCacheFavorite).filter(v => v === true).length;
        return Math.max(0, this.totalFavoritePoints - usedCount);
    }

    protected async fetchFavoritePoints(): Promise<void> {
        if (this.isFetchingFavoritePoints) {
            return;
        }

        this.isFetchingFavoritePoints = true;
        this.update();

        try {
            const res = await fetch(`${this.backendBaseUrl}/api/auth/status`, { credentials: 'include' });
            if (!res.ok) {
                console.warn('[GeocacheLogEditorWidget] Failed to fetch auth status');
                return;
            }
            const authState = await res.json();
            const awardedPoints = authState?.user?.awarded_favorite_points;
            if (typeof awardedPoints === 'number') {
                this.totalFavoritePoints = awardedPoints;
            } else {
                this.totalFavoritePoints = 0;
            }
            const findsCount = authState?.user?.finds_count;
            if (typeof findsCount === 'number') {
                this.userFindsCount = findsCount;
            } else {
                this.userFindsCount = 0;
            }
        } catch (e) {
            console.error('[GeocacheLogEditorWidget] fetchFavoritePoints error', e);
            this.totalFavoritePoints = 0;
        } finally {
            this.isFetchingFavoritePoints = false;
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
            const res = await fetch(`${this.backendBaseUrl}/api/auth/profile/refresh`, {
                method: 'POST',
                credentials: 'include',
            });
            if (!res.ok) {
                console.warn('[GeocacheLogEditorWidget] Failed to refresh profile stats', res.status);
                return;
            }
            const body = await res.json();
            const finds = body?.stats?.finds_count;
            if (typeof finds === 'number') {
                this.userFindsCount = finds;
            }
            const awardedPoints = body?.stats?.awarded_favorite_points;
            if (typeof awardedPoints === 'number') {
                this.totalFavoritePoints = awardedPoints;
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
        const raw = data as Record<string, unknown> | null;
        if (!raw || typeof raw.id !== 'number') {
            return undefined;
        }
        return {
            id: raw.id,
            gc_code: (raw.gc_code ?? '').toString(),
            name: (raw.name ?? '').toString(),
            owner: (raw.owner ?? '').toString() || undefined,
            favorites_count: typeof raw.favorites_count === 'number' ? raw.favorites_count : undefined,
            logs_count: typeof raw.logs_count === 'number' ? raw.logs_count : undefined,
            placed_at: (raw.placed_at ?? null) as string | null,
            cache_type: (raw.type ?? '').toString(),
            already_found: raw.found === true,
            found_date: (raw.found_date ?? null) as string | null,
        };
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
            const query = this.geocacheIds.join(',');
            const res = await fetch(
                `${this.backendBaseUrl}/api/geocaches/batch?ids=${encodeURIComponent(query)}`,
                { credentials: 'include' }
            );
            if (!res.ok) {
                throw new Error(`HTTP ${res.status}`);
            }
            const body = await res.json();

            const loaded = new Map<number, GeocacheListItem>();
            for (const raw of (Array.isArray(body?.geocaches) ? body.geocaches : [])) {
                const item = this.toGeocacheListItem(raw);
                if (item) {
                    loaded.set(item.id, item);
                }
            }

            // L'ordre demandé est celui de l'envoi des logs et de la numérotation
            // `@cache_count` : on le réimpose plutôt que de faire confiance à la réponse.
            const results = this.geocacheIds
                .map(id => loaded.get(id))
                .filter((gc): gc is GeocacheListItem => gc !== undefined);

            // Une géocache introuvable ne doit pas empêcher de loguer les autres : elle est
            // signalée et retirée de la liste, là où N requêtes unitaires faisaient tout échouer.
            const missing = this.geocacheIds.filter(id => !loaded.has(id));
            if (missing.length > 0) {
                console.warn('[GeocacheLogEditorWidget] géocaches introuvables', missing);
                this.messages.warn(missing.length === 1
                    ? `La géocache ${missing[0]} est introuvable : elle est retirée de la liste.`
                    : `${missing.length} géocaches sont introuvables (${missing.join(', ')}) : elles sont retirées de la liste.`);
            }
            if (results.length === 0) {
                this.messages.error('Impossible de charger la liste des géocaches.');
            }

            this.geocaches = results;

            const nextTypes: Record<number, LogTypeValue> = { ...this.perCacheLogType };
            for (const gc of results) {
                const existing = nextTypes[gc.id];
                const candidate = isLogTypeValue(existing) ? existing : this.logType;
                nextTypes[gc.id] = sanitizeLogTypeForGeocache(candidate, gc);
            }
            this.perCacheLogType = nextTypes;

            const alreadyFound = results.filter(gc => gc.already_found === true);
            if (alreadyFound.length > 0 && this.logType === 'found') {
                const codes = alreadyFound.map(gc => gc.gc_code).join(', ');
                this.messages.warn(
                    alreadyFound.length === 1
                        ? `${codes} est déjà loguée "Found it" : elle est passée sur "Ne pas loguer".`
                        : `${alreadyFound.length} géocaches sont déjà loguées "Found it" (${codes}) : elles sont passées sur "Ne pas loguer".`
                );
            }

            const nextFav: Record<number, boolean> = { ...this.perCacheFavorite };
            for (const gc of results) {
                if (typeof nextFav[gc.id] !== 'boolean') {
                    nextFav[gc.id] = false;
                }
            }
            this.perCacheFavorite = nextFav;
        } catch (e) {
            console.error('[GeocacheLogEditorWidget] loadGeocaches error', e);
            this.messages.error('Impossible de charger la liste des géocaches.');
        } finally {
            this.isLoading = false;
            this.update();
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
        if (typeof favoritesCount !== 'number' || typeof logsCount !== 'number' || logsCount <= 0) {
            return '—';
        }
        const pct = (favoritesCount / logsCount) * 100;
        if (!isFinite(pct)) {
            return '—';
        }
        return `${pct.toFixed(1)}%`;
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

        try {
            let stored = await this.storageService.getData<LogTextPattern[]>(this.logPatternsStorageKey, []);
            if (!Array.isArray(stored)) {
                stored = [];
            }
            this.customPatterns = stored.filter(p => p && typeof p === 'object' && typeof p.id === 'string' && typeof p.name === 'string');
        } catch (e) {
            console.error('[GeocacheLogEditorWidget] loadPatterns error', e);
            this.customPatterns = [];
        } finally {
            this.isLoadingPatterns = false;
            this.update();
        }
    }

    protected async savePatterns(): Promise<void> {
        try {
            await this.storageService.setData(this.logPatternsStorageKey, this.customPatterns);
        } catch (e) {
            console.error('[GeocacheLogEditorWidget] savePatterns error', e);
        }
    }

    protected addPattern(name: string, content: string): void {
        const trimmedName = name.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
        if (!trimmedName) {
            this.messages.warn('Le nom du pattern est invalide');
            return;
        }
        const existing = this.getAllPatterns().find(p => p.name === trimmedName);
        if (existing) {
            this.messages.warn(`Le pattern "@${trimmedName}" existe déjà`);
            return;
        }
        const newPattern: LogTextPattern = {
            id: this.generateId(),
            name: trimmedName,
            content: content.trim(),
            isBuiltin: false,
        };
        this.customPatterns = [...this.customPatterns, newPattern];
        void this.savePatterns();
        this.patternNameInput = '';
        this.patternContentInput = '';
        this.update();
    }

    protected updatePattern(patternId: string, name: string, content: string): void {
        const trimmedName = name.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
        if (!trimmedName) {
            this.messages.warn('Le nom du pattern est invalide');
            return;
        }
        const existing = this.getAllPatterns().find(p => p.name === trimmedName && p.id !== patternId);
        if (existing) {
            this.messages.warn(`Le pattern "@${trimmedName}" existe déjà`);
            return;
        }
        this.customPatterns = this.customPatterns.map(p =>
            p.id === patternId ? { ...p, name: trimmedName, content: content.trim() } : p
        );
        void this.savePatterns();
        this.editingPattern = null;
        this.patternNameInput = '';
        this.patternContentInput = '';
        this.update();
    }

    protected deletePattern(patternId: string): void {
        this.customPatterns = this.customPatterns.filter(p => p.id !== patternId);
        void this.savePatterns();
        this.update();
    }

    protected getCacheCountForIndex(geocacheIndex: number): number {
        return getCacheCountForIndex(geocacheIndex, this.getPatternResolutionContext());
    }

    protected resolvePatternValue(patternName: string, geocacheId: number | null): string {
        return resolvePatternValue(patternName, geocacheId, this.getPatternResolutionContext());
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

    /**
     * Données dont dépend la valeur d'un @pattern : patterns personnalisés, liste et
     * types de log (pour `@cache_count`, qui compte les trouvailles précédentes), nombre
     * de trouvailles et date. Sert de clé de validité au cache de résolution.
     */
    protected getPatternResolutionSignature(): readonly unknown[] {
        return getPatternResolutionSignature(this.getPatternResolutionContext());
    }

    protected resolveAllPatterns(text: string, geocacheId: number | null): string {
        if (!text.includes('@')) {
            return text;
        }

        const signature = this.getPatternResolutionSignature();
        const stale = signature.some((value, index) => !Object.is(value, this.patternResolutionSignature[index]));
        if (stale) {
            this.patternResolutionSignature = signature;
            this.patternResolutionCache.clear();
        }

        return resolveAllPatternsPure(text, geocacheId, this.getPatternResolutionContext(), this.patternResolutionCache);
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
        if (target !== 'global') {
            const rawText = this.perCacheText[target.geocacheId] ?? '';
            const length = this.resolveAllPatterns(rawText, target.geocacheId).length;
            return { raw: rawText.length, min: length, max: length };
        }

        const rawText = this.globalText;
        const targets = this.getGeocachesToSubmit();
        const scope = targets.length > 0 ? targets : this.geocaches;
        if (scope.length === 0) {
            const length = this.resolveAllPatterns(rawText, null).length;
            return { raw: rawText.length, min: length, max: length };
        }

        let min = Number.POSITIVE_INFINITY;
        let max = -1;
        let worst: GeocacheListItem | undefined;
        for (const gc of scope) {
            const length = this.resolveAllPatterns(rawText, gc.id).length;
            min = Math.min(min, length);
            if (length > max) {
                max = length;
                worst = gc;
            }
        }
        return { raw: rawText.length, min, max, worst };
    }

    /**
     * Compteur « texte final » sous une zone de saisie : ce que geocaching.com mesure
     * n'est pas le texte tapé mais le texte patterns résolus, qui peut être bien plus long.
     */
    protected renderCharCounter(target: 'global' | { geocacheId: number }): React.ReactNode {
        const stats = this.getFinalLengthStats(target);
        if (stats.raw === 0 && stats.max === 0) {
            return undefined;
        }
        return <CharCounter {...stats} />;
    }

    protected renderTextWithHighlightedPatterns(text: string, geocacheId: number | null, key: string): React.ReactNode {
        return (
            <TextWithHighlightedPatterns
                text={text}
                geocacheId={geocacheId}
                nodeKey={key}
                patternNames={this.getPatternsIndex().names}
                resolvePatternValue={(name, id) => this.resolvePatternValue(name, id)}
            />
        );
    }

    protected renderTextareaWithOverlay(
        value: string,
        geocacheId: number | null,
        textareaProps: React.TextareaHTMLAttributes<HTMLTextAreaElement>,
        textareaRef: (el: HTMLTextAreaElement | null) => void,
        overlayKey: string
    ): React.ReactNode {
        return (
            <TextareaWithOverlay
                value={value}
                geocacheId={geocacheId}
                textareaProps={textareaProps}
                textareaRef={textareaRef}
                overlayKey={overlayKey}
                patternNames={this.getPatternsIndex().names}
                resolvePatternValue={(name, id) => this.resolvePatternValue(name, id)}
                onCaretChange={ta => this.refreshCaretFormat(ta)}
                onScrollSync={(key, ta) => this.syncOverlayScroll(key, ta)}
                registerTextarea={(key, el) => { this.overlayTextareas[key] = el; }}
                registerOverlay={(key, el) => { this.overlayElements[key] = el; }}
            />
        );
    }

    /**
     * Barre d'outils Markdown, commune à l'éditeur global et aux éditeurs par cache.
     *
     * Les boutons d'emphase s'allument quand le curseur se trouve dans une zone déjà
     * formatée, et un second clic retire alors le formatage (cf. toggleMarkdownFormat).
     */
    protected renderMarkdownToolbar(
        section: { type: 'global' } | { type: 'per-cache'; geocacheId: number },
        disabled: boolean
    ): React.ReactNode {
        return (
            <MarkdownToolbar
                activeCaretFormat={this.activeCaretFormat}
                isActive={this.isEditorActive(section)}
                disabled={disabled}
                onApplyFormat={(kind, placeholder) => this.applyMarkdownFormat(kind, placeholder)}
                onApplyPrefix={(prefix, placeholder) => this.applyMarkdownPrefix(prefix, placeholder)}
            />
        );
    }

    /**
     * Bloc « Aperçu Markdown » : rendu du texte final, précédé d'un avertissement
     * quand des astérisques ne seront pas interprétées par Geocaching.com.
     */
    protected renderMarkdownPreview(text: string, keyPrefix: string): React.ReactNode {
        return (
            <MarkdownPreview
                text={text}
                keyPrefix={keyPrefix}
                isOpen={this.openMarkdownPreviews.has(keyPrefix)}
                onToggle={open => {
                    if (open) {
                        this.openMarkdownPreviews.add(keyPrefix);
                    } else {
                        this.openMarkdownPreviews.delete(keyPrefix);
                    }
                    this.update();
                }}
            />
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
        const tokenStart = findPatternTokenStart(value.slice(0, caret));
        if (tokenStart === null) {
            return undefined;
        }
        const fragment = value.slice(tokenStart + 1, caret);
        if (fragment.includes(' ') || fragment.includes('\n')) {
            return undefined;
        }
        return { start: tokenStart, fragment };
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
        const suggestions: PatternSuggestion[] = [];

        for (const pattern of this.getAllPatterns()) {
            if (!prefix || pattern.name.startsWith(prefix) || pattern.name.includes(prefix)) {
                const resolvedValue = this.resolvePatternValue(pattern.name, geocacheId);
                suggestions.push({
                    id: pattern.id,
                    label: `@${pattern.name}`,
                    description: pattern.isBuiltin ? `→ ${resolvedValue}` : pattern.content.slice(0, 50),
                    insertText: `@${pattern.name}`,
                });
            }
        }

        if (suggestions.length === 0) {
            this.closePatternAutocomplete();
            return;
        }

        this.patternAutocompletePosition = getCaretCoordinates(textArea, token.start);
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
            const current = this.globalText;
            const next = current.slice(0, range.start) + suggestion.insertText + current.slice(range.end);
            this.globalText = next;
            const newPos = range.start + suggestion.insertText.length;
            this.patternAutocompleteOpen = false;
            this.update();
            requestAnimationFrame(() => {
                if (this.globalTextArea) {
                    this.globalTextArea.focus();
                    this.globalTextArea.setSelectionRange(newPos, newPos);
                }
            });
        } else {
            const current = this.perCacheText[geocacheId] ?? '';
            const next = current.slice(0, range.start) + suggestion.insertText + current.slice(range.end);
            this.perCacheText = { ...this.perCacheText, [geocacheId]: next };
            const newPos = range.start + suggestion.insertText.length;
            this.patternAutocompleteOpen = false;
            this.update();
            requestAnimationFrame(() => {
                const textArea = this.perCacheTextAreas[geocacheId];
                if (textArea) {
                    textArea.focus();
                    textArea.setSelectionRange(newPos, newPos);
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
        return this.getLogTypeForGeocacheId(geocacheId) === 'dnf' && !this.isGeocacheSubmittedOk(geocacheId);
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

    /**
     * Barre de progression de l'envoi : sans elle, un lot de 30 géocaches avec photos
     * n'affiche rien pendant plusieurs minutes.
     */
    protected renderSubmitProgress(): React.ReactNode {
        if (!this.submitProgress) {
            return undefined;
        }
        return (
            <SubmitProgress
                progress={this.submitProgress}
                stopRequested={this.stopRequested}
            />
        );
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

        const missingText = toSubmit
            .map(gc => ({ gc, text: (this.getTextForGeocacheId(gc.id) || '').trim() }))
            .filter(x => !x.text);

        if (missingText.length > 0) {
            if (this.useSameTextForAll) {
                this.messages.warn('Le texte du log est vide.');
            } else {
                this.messages.warn(`Texte manquant pour ${missingText.length} géocache(s).`);
            }
            return;
        }

        // Le texte final (patterns résolus) est ce que voit geocaching.com : au-delà de la
        // limite le site rejette le log, autant l'arrêter ici avec un message exploitable.
        const tooLong = toSubmit
            .map(gc => ({ gc, length: this.getResolvedTextForGeocacheId(gc.id).length }))
            .filter(x => x.length > GC_LOG_MAX_LENGTH);

        if (tooLong.length > 0) {
            const worst = tooLong.reduce((a, b) => (b.length > a.length ? b : a));
            if (this.useSameTextForAll) {
                this.messages.warn(
                    `Texte final trop long : ${worst.length} caractères pour ${worst.gc.gc_code} (limite ${GC_LOG_MAX_LENGTH}). `
                    + `Raccourcissez d'au moins ${worst.length - GC_LOG_MAX_LENGTH} caractères.`
                );
            } else {
                const codes = tooLong.slice(0, 6).map(x => x.gc.gc_code).join(', ');
                const more = tooLong.length > 6 ? `, +${tooLong.length - 6}` : '';
                this.messages.warn(
                    `Texte final trop long (limite ${GC_LOG_MAX_LENGTH} caractères) pour ${tooLong.length} géocache(s) : ${codes}${more}.`
                );
            }
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
                const payload = {
                    text: this.getResolvedTextForGeocacheId(gc.id),
                    date: this.logDate,
                    logType: logTypeForGc,
                    favorite: logTypeForGc === 'found' ? (this.perCacheFavorite[gc.id] === true) : false,
                };

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
                const payloadWithImages = upload.guids.length > 0 ? { ...payload, images: upload.guids } : payload;

                const result = await submitOneLog(this.backendBaseUrl, gc.id, payloadWithImages);
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
                    // Le backend confirme le "Found it" existant : on sort la ligne du lot d'envoi.
                    this.geocaches = this.geocaches.map(item => item.id === gc.id
                        ? { ...item, already_found: true, found_date: result.foundDate ?? item.found_date }
                        : item);
                    this.perCacheLogType = { ...this.perCacheLogType, [gc.id]: 'skip' };
                    this.messages.warn(`${gc.gc_code} - déjà loguée (ignorée)`);
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
            const notLoggedSuffix = notLogged > 0 ? `, ${notLogged} non loguée(s)` : '';
            if (failed === 0) {
                this.messages.info(`Logs envoyés sur Geocaching.com: ${ok}/${ok}${notLoggedSuffix}`);
            } else {
                this.messages.warn(`Logs envoyés sur Geocaching.com: ${ok} ok, ${failed} échec(s)${notLoggedSuffix}`);
            }

            const remaining = toSubmit.length - processed;
            if (this.stopRequested && remaining > 0) {
                this.messages.warn(
                    `Envoi interrompu : ${remaining} géocache(s) non envoyée(s), conservée(s) dans le brouillon.`
                );
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
        return getLogTypeLabel(value);
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
            const languageModel = await this.languageModelRegistry.selectLanguageModel({
                agent: GeoAppLogWriterAgentId,
                purpose: 'chat',
                identifier: 'default/universal'
            });

            if (!languageModel) {
                this.messages.error('Aucun modèle IA n\'est configuré (vérifie la configuration IA de Theia)');
                return;
            }

            const logTypeLabel = this.logType === 'found' ? 'trouvaille (Found it)'
                : this.logType === 'dnf' ? 'non trouvée (Did Not Find)'
                : 'note (Write note)';

            const geocacheContext = this.geocaches.length > 0
                ? `\n\nContexte des géocaches à loguer :\n${this.geocaches.slice(0, 5).map(gc => `- ${gc.gc_code}: "${gc.name}" (type: ${gc.cache_type || 'inconnu'}, owner: ${gc.owner || 'inconnu'})`).join('\n')}${this.geocaches.length > 5 ? `\n... et ${this.geocaches.length - 5} autre(s)` : ''}`
                : '';

            const customInstructions = (this.aiCustomInstructions || '').trim();
            const exampleLogs = (this.aiExampleLogs || '').trim();

            let prompt = `Tu es un rédacteur de logs de géocache. Génère un log de type "${logTypeLabel}" basé sur les mots-clés et idées suivants :

**Mots-clés / idées :** ${keywords}
${geocacheContext}`;

            if (customInstructions) {
                prompt += `\n\n**Instructions personnalisées de l'utilisateur :**\n${customInstructions}`;
            }

            if (exampleLogs) {
                prompt += `\n\n**Exemples de logs de l'utilisateur (style à reproduire) :**\n${exampleLogs}`;
            }

            prompt += `\n\n**Règles importantes :**
- Écris UNIQUEMENT le texte du log, sans introduction ni explication.
- Le log doit être naturel et personnel, comme s'il était écrit par un géocacheur.
- Adapte le ton au type de log (enthousiaste pour une trouvaille, déçu mais positif pour un DNF, informatif pour une note).
- Tu peux utiliser du Markdown simple (gras, italique) si approprié.
- Le log doit faire entre 2 et 6 phrases.
- NE PAS inclure de signature ou de "TFTC" sauf si demandé dans les instructions.`;

            const request: UserRequest = {
                messages: [
                    { actor: 'user', type: 'text', text: prompt },
                ],
                agentId: GeoAppLogWriterAgentId,
                requestId: `geoapp-log-writer-${Date.now()}`,
                sessionId: `geoapp-log-writer-session-${Date.now()}`,
            };

            const response = await this.languageModelService.sendRequest(languageModel, request);
            let generatedText = '';

            if (isLanguageModelParsedResponse(response)) {
                generatedText = JSON.stringify(response.parsed);
            } else {
                try {
                    generatedText = await getTextOfResponse(response);
                } catch {
                    const jsonResponse = await getJsonOfResponse(response) as any;
                    generatedText = typeof jsonResponse === 'string' ? jsonResponse : String(jsonResponse);
                }
            }

            generatedText = (generatedText || '').toString().trim();

            generatedText = generatedText
                .replace(/\[THINK\][\s\S]*?\[\/THINK\]/gi, '')
                .replace(/<think>[\s\S]*?<\/think>/gi, '')
                .replace(/\[ANALYSIS\][\s\S]*?\[\/ANALYSIS\]/gi, '')
                .replace(/<analysis>[\s\S]*?<\/analysis>/gi, '')
                .trim();

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
            console.error('[GeocacheLogEditorWidget] generateLogWithAi error', error);
            this.messages.error(`Erreur lors de la génération IA: ${error}`);
        } finally {
            this.isGeneratingAi = false;
            this.update();
        }
    }

    protected renderAiGenerationPanel(allSubmitted: boolean): React.ReactNode {
        return (
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
        );
    }

    /**
     * Bloc d'édition d'une géocache, en mode « texte différent par cache ».
     *
     * Rendu à travers `MemoizedFragment` (cf. render) : il n'est reconstruit que si
     * l'état dont il dépend a changé, et non à chaque frappe dans une autre cache.
     */
    protected renderPerCacheBlock(gc: GeocacheListItem): React.ReactNode {
        return (
            <div
                style={{
                    // Même cascade que dans le tableau : envoyé, puis DNF, puis déjà trouvée.
                    border: this.isGeocacheSubmittedOk(gc.id)
                        ? `1px solid ${JUST_LOGGED_ACCENT}`
                        : this.isPendingDnf(gc.id)
                            ? `1px solid ${DNF_ACCENT}`
                            : this.isPendingAlreadyFound(gc.id)
                                ? `1px solid ${ALREADY_FOUND_ACCENT}`
                                : '1px solid var(--theia-panel-border)',
                    borderRadius: 6,
                    padding: 10,
                    background: this.isGeocacheSubmittedOk(gc.id)
                        ? JUST_LOGGED_ROW_BACKGROUND
                        : this.isPendingDnf(gc.id)
                            ? DNF_ROW_BACKGROUND
                            : this.isPendingAlreadyFound(gc.id)
                                ? ALREADY_FOUND_ROW_BACKGROUND
                                : 'var(--theia-editor-background)'
                }}
            >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                    <div style={{ fontWeight: 700 }}>{gc.gc_code}</div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                        {this.isPendingDnf(gc.id) && <DnfBadge />}
                        {this.isPendingAlreadyFound(gc.id) && (
                            <span
                                style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: 4,
                                    padding: '2px 6px',
                                    borderRadius: 3,
                                    fontSize: 12,
                                    background: ALREADY_FOUND_ROW_BACKGROUND,
                                    color: ALREADY_FOUND_ACCENT,
                                    border: `1px solid ${ALREADY_FOUND_ACCENT}`,
                                    fontWeight: 700,
                                    whiteSpace: 'nowrap'
                                }}
                                title={alreadyFoundTooltip(gc)}
                            >
                                <LogTypeIcon kind='found' size={14} title={alreadyFoundTooltip(gc)} />
                                Déjà trouvée
                            </span>
                        )}
                        {(this.perCacheSubmitStatus[gc.id] === 'ok' || this.perCacheSubmitStatus[gc.id] === 'failed') && (
                            <SubmitBadge
                                status={this.perCacheSubmitStatus[gc.id]}
                                reference={this.perCacheSubmitReference[gc.id]}
                                error={this.perCacheSubmitError[gc.id]}
                            />
                        )}
                        <div style={{ opacity: 0.8, fontSize: 12, textAlign: 'right' }}>{gc.name}</div>
                    </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center', marginTop: 8 }}>
                    <div style={{ fontSize: 12, opacity: 0.85 }}>
                        PF: {typeof gc.favorites_count === 'number' ? gc.favorites_count : '—'}
                        {'  '}(
                        {this.formatFavoritePercent(gc.favorites_count, gc.logs_count)}
                        )
                    </div>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                        <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12 }}>
                            <span style={{ opacity: 0.85 }}>Type</span>
                            <select
                                className='theia-select'
                                value={this.getLogTypeForGeocacheId(gc.id)}
                                onChange={e => this.setLogTypeForGeocacheId(gc.id, e.target.value as LogTypeValue)}
                                disabled={this.isGeocacheSubmittedOk(gc.id)}
                                title={this.isGeocacheSubmittedOk(gc.id)
                                    ? 'Log déjà envoyé pour cette géocache'
                                    : this.isPendingAlreadyFound(gc.id) ? alreadyFoundTooltip(gc) : undefined}
                                style={this.isPendingDnf(gc.id)
                                    ? { fontSize: 12, color: DNF_ACCENT, borderColor: DNF_ACCENT, fontWeight: 600 }
                                    : { fontSize: 12 }}
                            >
                                <option value='found' disabled={this.isPendingAlreadyFound(gc.id)}>{this.getLogTypeLabel('found')}</option>
                                <option value='dnf'>{this.getLogTypeLabel('dnf')}</option>
                                <option value='note'>{this.getLogTypeLabel('note')}</option>
                                <option value='skip'>{this.getLogTypeLabel('skip')}</option>
                            </select>
                        </label>

                        <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, opacity: this.getLogTypeForGeocacheId(gc.id) === 'found' ? 0.9 : 0.5 }}>
                            <input
                                type='checkbox'
                                checked={this.perCacheFavorite[gc.id] === true}
                                onChange={e => this.toggleFavoriteForGeocacheId(gc.id, e.target.checked)}
                                disabled={this.getLogTypeForGeocacheId(gc.id) !== 'found' || (!this.perCacheFavorite[gc.id] && this.getRemainingFavoritePoints() <= 0)}
                                title={!this.perCacheFavorite[gc.id] && this.getRemainingFavoritePoints() <= 0 ? 'Plus de PF disponibles' : ''}
                            />
                            Donner un PF
                        </label>
                    </div>
                </div>

                <div style={{ marginTop: 10 }}>
                    {this.renderImagesSection({ geocacheId: gc.id }, this.isLoading || this.isSubmitting || this.isGeocacheSubmittedOk(gc.id))}
                </div>

                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginTop: 8, marginBottom: 6 }}>
                    {this.renderMarkdownToolbar({ type: 'per-cache', geocacheId: gc.id }, this.isLoading || this.isSubmitting)}
                    {this.globalText.trim() !== '' && (
                        <button
                            className='theia-button secondary'
                            onClick={() => this.applyGlobalTextToGeocache(gc.id)}
                            disabled={this.isLoading
                                || this.isSubmitting
                                || this.isGeocacheSubmittedOk(gc.id)
                                || (this.perCacheText[gc.id] ?? '') === this.globalText}
                            title={(this.perCacheText[gc.id] ?? '') === this.globalText
                                ? 'Ce texte est déjà identique au texte commun'
                                : `Remplacer ce texte par le texte commun :\n\n${this.getGlobalTextExcerpt()}`}
                            style={{ fontSize: 11, padding: '2px 6px', marginLeft: 'auto' }}
                        >
                            ↺ Texte commun
                        </button>
                    )}
                </div>
                <div style={{ position: 'relative', marginTop: 8 }}>
                    {this.renderTextareaWithOverlay(
                        this.perCacheText[gc.id] ?? '',
                        gc.id,
                        {
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
                        },
                        el => { this.perCacheTextAreas = { ...this.perCacheTextAreas, [gc.id]: el }; },
                        `per-cache-overlay-${gc.id}`
                    )}
                    {this.patternAutocompleteOpen && this.patternAutocompleteTargetGeocacheId === gc.id && this.patternAutocompleteSuggestions.length > 0 && this.patternAutocompletePosition && (
                        <div
                            style={{
                                position: 'fixed',
                                top: `${this.patternAutocompletePosition.top + 20}px`,
                                left: `${this.patternAutocompletePosition.left}px`,
                                width: 320,
                                maxHeight: 200,
                                overflowY: 'auto',
                                border: '1px solid var(--theia-panel-border)',
                                background: 'var(--theia-editor-background)',
                                borderRadius: 3,
                                zIndex: 1000,
                                boxShadow: '0 4px 12px rgba(0,0,0,0.35)'
                            }}
                            onMouseDown={e => e.preventDefault()}
                        >
                            {this.patternAutocompleteSuggestions.map((s, idx) => (
                                <div
                                    key={s.id}
                                    style={{
                                        padding: '6px 8px',
                                        cursor: 'pointer',
                                        background: idx === this.patternAutocompleteActiveIndex
                                            ? 'var(--theia-list-activeSelectionBackground)'
                                            : 'transparent'
                                    }}
                                    onMouseEnter={() => { this.patternAutocompleteActiveIndex = idx; this.update(); }}
                                    onClick={() => this.applyPatternSuggestion(s)}
                                >
                                    <div style={{ fontSize: '0.9em', fontWeight: 600 }}>{s.label}</div>
                                    <div style={{ fontSize: '0.8em', opacity: 0.7 }}>{s.description}</div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {this.renderCharCounter({ geocacheId: gc.id })}

                {this.renderMarkdownPreview(
                    this.resolveAllPatterns(this.perCacheText[gc.id] ?? '', gc.id),
                    `per-preview-${gc.id}`
                )}
            </div>
        );
    }

    protected render(): React.ReactNode {
        const allSubmitted = this.geocaches.length > 0 && this.geocaches.every(gc => this.isGeocacheSubmittedOk(gc.id));
        const remainingFavoritePoints = this.getRemainingFavoritePoints();
        const canPrev = !this.isLoadingHistory && this.logHistory.length > 0 && (this.logHistoryCursor < this.logHistory.length - 1);
        const canNext = !this.isLoadingHistory && this.logHistory.length > 0 && (this.logHistoryCursor > 0);
        return (
            <div style={{ padding: 12, height: '100%', overflow: 'auto', display: 'grid', gap: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                    <div style={{ display: 'grid', gap: 8 }}>
                        <div>
                            <h3 style={{ margin: 0 }}>Logs</h3>
                            <div style={{ opacity: 0.7, fontSize: 12, marginTop: 4 }}>
                                {/* Le compte demandé et le compte chargé diffèrent si une géocache est introuvable. */}
                                {this.geocaches.length > 0 && this.geocaches.length !== this.geocacheIds.length
                                    ? `${this.geocaches.length} géocache(s) sur ${this.geocacheIds.length} chargée(s)`
                                    : `${this.geocacheIds.length} géocache(s)`}
                            </div>
                        </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                        <button
                            className='theia-button secondary'
                            onClick={() => this.navigateHistory(+1)}
                            disabled={this.isLoading || this.isLoadingHistory || !canPrev}
                            title='Log précédent'
                            style={{ fontSize: 12, padding: '4px 10px' }}
                        >
                            ⬅️
                        </button>
                        <button
                            className='theia-button secondary'
                            onClick={() => this.navigateHistory(-1)}
                            disabled={this.isLoading || this.isLoadingHistory || !canNext}
                            title='Log suivant'
                            style={{ fontSize: 12, padding: '4px 10px' }}
                        >
                            ➡️
                        </button>
                        <button
                            className='theia-button primary'
                            onClick={() => { void this.submitLogsToGeocaching(); }}
                            disabled={
                                this.isLoading ||
                                this.isSubmitting ||
                                this.getGeocachesToSubmit().length === 0
                            }
                            title={this.geocaches.length > 0 && this.getGeocachesToSubmit().length === 0
                                ? 'Aucune géocache à envoyer (déjà envoyées ou en "Ne pas loguer")'
                                : 'Envoyer le(s) log(s) sur Geocaching.com via le backend'}
                            style={{ fontSize: 12, padding: '4px 12px' }}
                        >
                            {this.isSubmitting && this.submitProgress
                                ? `⏳ Envoi ${this.submitProgress.current}/${this.submitProgress.total}…`
                                : '✅ Envoyer sur GC'}
                        </button>
                        {this.isSubmitting && (
                            <button
                                className='theia-button secondary'
                                onClick={() => this.requestSubmitStop()}
                                disabled={this.stopRequested}
                                title="Termine la géocache en cours (photos + log) puis interrompt le lot. Les géocaches restantes sont conservées dans le brouillon."
                                style={{
                                    fontSize: 12,
                                    padding: '4px 12px',
                                    color: this.stopRequested ? undefined : 'var(--theia-editorWarning-foreground, #d29922)',
                                    fontWeight: 600,
                                }}
                            >
                                {this.stopRequested ? '⏹️ Arrêt demandé…' : '⏹️ Stop après la cache en cours'}
                            </button>
                        )}
                        <button
                            className='theia-button secondary'
                            onClick={() => { void this.copyFieldNotes(); }}
                            disabled={this.isLoading || this.geocaches.length === 0}
                            title='Copier le format geocache_visits.txt (field notes)'
                            style={{ fontSize: 12, padding: '4px 12px' }}
                        >
                            📋 Copier field notes
                        </button>
                        <button
                            className='theia-button secondary'
                            onClick={() => this.downloadFieldNotes()}
                            disabled={this.isLoading || this.geocaches.length === 0}
                            title='Télécharger un fichier geocache_visits.txt'
                            style={{ fontSize: 12, padding: '4px 12px' }}
                        >
                            ⬇️ Télécharger
                        </button>
                    </div>
                </div>

                {this.renderSubmitProgress()}

                {this.renderDraftBanner()}

                <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
                    {this.lastSubmitSummary && (
                        <div style={{ opacity: 0.85, fontSize: 12 }}>
                            Résultat: {this.lastSubmitSummary.ok} ok, {this.lastSubmitSummary.failed} échec(s)
                        </div>
                    )}
                    <div style={{ display: 'flex', gap: 12, alignItems: 'center', fontSize: 12 }}>
                        <div style={{ opacity: 0.85 }}>
                            <strong>PF disponibles:</strong> {this.totalFavoritePoints}
                        </div>
                        <div style={{ opacity: 0.85 }}>
                            <strong>PF restants:</strong> <span style={{ color: this.getRemainingFavoritePoints() === 0 ? 'var(--theia-errorForeground)' : 'inherit' }}>{this.getRemainingFavoritePoints()}</span>
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

                <details style={{ marginBottom: 8 }}>
                    <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: 12 }}>
                        📝 Patterns de texte ({this.getAllPatterns().length}) - Tapez @ dans le texte pour les utiliser
                    </summary>
                    <div style={{ marginTop: 8, padding: 10, background: 'var(--theia-editor-background)', border: '1px solid var(--theia-panel-border)', borderRadius: 6 }}>
                        <div style={{ marginBottom: 12 }}>
                            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Patterns intégrés</div>
                            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', fontSize: 11 }}>
                                {this.getBuiltinPatterns().map(p => (
                                    <span key={p.id} style={{ padding: '2px 6px', background: 'var(--theia-badge-background)', borderRadius: 3 }}>
                                        @{p.name} → {this.resolvePatternValue(p.name, this.geocaches[0]?.id ?? null)}
                                    </span>
                                ))}
                            </div>
                        </div>

                        <div style={{ marginBottom: 12 }}>
                            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Patterns personnalisés</div>
                            {this.customPatterns.length === 0 && (
                                <div style={{ fontSize: 11, opacity: 0.7 }}>Aucun pattern personnalisé</div>
                            )}
                            {this.customPatterns.length > 0 && (
                                <div style={{ display: 'grid', gap: 6 }}>
                                    {this.customPatterns.map(p => (
                                        <div key={p.id} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 11 }}>
                                            <span style={{ padding: '2px 6px', background: 'var(--theia-badge-background)', borderRadius: 3, fontWeight: 600 }}>
                                                @{p.name}
                                            </span>
                                            <span style={{ opacity: 0.8, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                {p.content}
                                            </span>
                                            <button
                                                className='theia-button secondary'
                                                style={{ fontSize: 10, padding: '2px 6px' }}
                                                onClick={() => {
                                                    this.editingPattern = p;
                                                    this.patternNameInput = p.name;
                                                    this.patternContentInput = p.content;
                                                    this.update();
                                                }}
                                            >
                                                ✏️
                                            </button>
                                            <button
                                                className='theia-button secondary'
                                                style={{ fontSize: 10, padding: '2px 6px' }}
                                                onClick={() => this.deletePattern(p.id)}
                                            >
                                                🗑️
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        <div style={{ borderTop: '1px solid var(--theia-panel-border)', paddingTop: 10 }}>
                            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
                                {this.editingPattern ? 'Modifier le pattern' : 'Ajouter un pattern'}
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr auto', gap: 8, alignItems: 'end' }}>
                                <div>
                                    <label style={{ display: 'block', fontSize: 10, opacity: 0.8, marginBottom: 2 }}>Nom (sans @)</label>
                                    <input
                                        className='theia-input'
                                        value={this.patternNameInput}
                                        onChange={e => { this.patternNameInput = e.target.value; this.update(); }}
                                        placeholder='mon_pattern'
                                        style={{ width: '100%', fontSize: 11 }}
                                    />
                                </div>
                                <div>
                                    <label style={{ display: 'block', fontSize: 10, opacity: 0.8, marginBottom: 2 }}>Contenu</label>
                                    <input
                                        className='theia-input'
                                        value={this.patternContentInput}
                                        onChange={e => { this.patternContentInput = e.target.value; this.update(); }}
                                        placeholder='Texte à insérer...'
                                        style={{ width: '100%', fontSize: 11 }}
                                    />
                                </div>
                                <div style={{ display: 'flex', gap: 4 }}>
                                    {this.editingPattern ? (
                                        <>
                                            <button
                                                className='theia-button primary'
                                                style={{ fontSize: 11, padding: '4px 8px' }}
                                                onClick={() => this.updatePattern(this.editingPattern!.id, this.patternNameInput, this.patternContentInput)}
                                                disabled={!this.patternNameInput.trim() || !this.patternContentInput.trim()}
                                            >
                                                Enregistrer
                                            </button>
                                            <button
                                                className='theia-button secondary'
                                                style={{ fontSize: 11, padding: '4px 8px' }}
                                                onClick={() => {
                                                    this.editingPattern = null;
                                                    this.patternNameInput = '';
                                                    this.patternContentInput = '';
                                                    this.update();
                                                }}
                                            >
                                                Annuler
                                            </button>
                                        </>
                                    ) : (
                                        <button
                                            className='theia-button primary'
                                            style={{ fontSize: 11, padding: '4px 8px' }}
                                            onClick={() => this.addPattern(this.patternNameInput, this.patternContentInput)}
                                            disabled={!this.patternNameInput.trim() || !this.patternContentInput.trim()}
                                        >
                                            Ajouter
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                </details>

                {this.renderAiGenerationPanel(allSubmitted)}

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
                <div style={{ display: 'grid', gridTemplateColumns: '190px 220px 1fr', gap: 12, alignItems: 'end' }}>
                    <div>
                        <label style={{ display: 'block', fontSize: 12, opacity: 0.8, marginBottom: 4 }}>Date</label>
                        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                            <input
                                type='date'
                                className='theia-input'
                                value={this.logDate}
                                onChange={e => { this.setLogDate(e.target.value); }}
                                style={{ flex: 1, minWidth: 0 }}
                            />
                            <button
                                className='theia-button secondary'
                                onClick={() => { this.toggleLogDatePin(); }}
                                title={this.isLogDatePinned
                                    ? 'Date épinglée : elle sera réutilisée pour les prochains logs. Cliquer pour revenir à la date du jour.'
                                    : 'Épingler la date pour la réutiliser lors des prochains logs'}
                                aria-pressed={this.isLogDatePinned}
                                style={{
                                    padding: '2px 6px',
                                    minWidth: 26,
                                    fontSize: 13,
                                    opacity: this.isLogDatePinned ? 1 : 0.6,
                                    color: this.isLogDatePinned ? 'var(--theia-focusBorder)' : undefined,
                                }}
                            >
                                <i className={this.isLogDatePinned ? 'fa fa-thumb-tack' : 'fa fa-thumb-tack fa-rotate-90'} />
                            </button>
                        </div>
                    </div>
                    <div>
                        <label style={{ display: 'block', fontSize: 12, opacity: 0.8, marginBottom: 4 }}>Type</label>
                        <select
                            className='theia-select'
                            value={this.logType}
                            onChange={e => { this.setGlobalLogType(e.target.value as LogTypeValue); }}
                            style={{ width: '100%' }}
                        >
                            <option value='found'>Found it</option>
                            <option value='dnf'>Didn't find it</option>
                            <option value='note'>Write note</option>
                            <option value='skip'>Ne pas loguer</option>
                        </select>
                        {this.logType === 'found' && this.getPendingAlreadyFoundGeocaches().length > 0 && (
                            <div
                                style={{ fontSize: 11, marginTop: 4, color: ALREADY_FOUND_ACCENT, display: 'flex', alignItems: 'center', gap: 4 }}
                                title={this.getPendingAlreadyFoundGeocaches().map(gc => gc.gc_code).join(', ')}
                            >
                                <LogTypeIcon kind='found' size={13} />
                                {this.getPendingAlreadyFoundGeocaches().length} déjà trouvée(s) → "Ne pas loguer"
                            </div>
                        )}
                    </div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                        <input
                            type='checkbox'
                            checked={this.useSameTextForAll}
                            onChange={e => { this.toggleUseSameTextForAll(e.target.checked); }}
                        />
                        <span style={{ fontSize: 12, opacity: 0.85 }}>Texte identique pour toutes les géocaches</span>
                        {!this.useSameTextForAll && this.globalText.trim() !== '' && (
                            <button
                                className='theia-button secondary'
                                onClick={() => { void this.applyGlobalTextToAllGeocaches(); }}
                                disabled={this.isLoading || this.isSubmitting}
                                title={`Remplacer le texte de chaque géocache par le texte commun :\n\n${this.getGlobalTextExcerpt()}`}
                                style={{ fontSize: 11, padding: '2px 6px' }}
                            >
                                ↺ Réappliquer le texte commun
                            </button>
                        )}
                    </div>
                </div>

                {this.useSameTextForAll && (
                    <div>
                        <label style={{ display: 'block', fontSize: 12, opacity: 0.8, marginBottom: 4 }}>Texte (Markdown)</label>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 6 }}>
                            <div style={{ position: 'relative' }}>
                                <button
                                    className='theia-button secondary'
                                    style={{ fontSize: 12, padding: '2px 10px' }}
                                    onClick={() => { this.historyDropdownOpen = !this.historyDropdownOpen; this.update(); }}
                                    disabled={this.isLoading || this.isSubmitting || allSubmitted || this.logHistory.length === 0}
                                    title='Réutiliser un log récent'
                                >
                                    📝 Logs récents ({this.logHistory.length})
                                </button>
                                {this.historyDropdownOpen && this.logHistory.length > 0 && (
                                    <div
                                        style={{
                                            position: 'absolute',
                                            top: '100%',
                                            left: 0,
                                            marginTop: 4,
                                            width: 400,
                                            maxHeight: 300,
                                            overflowY: 'auto',
                                            border: '1px solid var(--theia-panel-border)',
                                            background: 'var(--theia-editor-background)',
                                            borderRadius: 3,
                                            zIndex: 1000,
                                            boxShadow: '0 4px 12px rgba(0,0,0,0.35)'
                                        }}
                                    >
                                        <div style={{ padding: '6px 8px', borderBottom: '1px solid var(--theia-panel-border)', fontSize: 11, fontWeight: 600, opacity: 0.8 }}>
                                            Cliquez pour réutiliser le texte
                                        </div>
                                        {this.logHistory.map((entry, idx) => {
                                            const date = new Date(entry.createdAt);
                                            const dateStr = date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
                                            const timeStr = date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
                                            const preview = (entry.globalText ?? '').slice(0, 80);
                                            return (
                                                <div
                                                    key={entry.id}
                                                    style={{
                                                        padding: '8px',
                                                        cursor: 'pointer',
                                                        borderBottom: idx < this.logHistory.length - 1 ? '1px solid var(--theia-panel-border)' : 'none',
                                                        background: 'transparent'
                                                    }}
                                                    onMouseEnter={e => { e.currentTarget.style.background = 'var(--theia-list-hoverBackground)'; }}
                                                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                                                    onClick={() => this.applyHistoryTextOnly(entry)}
                                                >
                                                    <div style={{ fontSize: 11, opacity: 0.7, marginBottom: 2 }}>
                                                        {dateStr} à {timeStr}
                                                    </div>
                                                    <div style={{ fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                        {preview || '(vide)'}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                            {this.renderMarkdownToolbar({ type: 'global' }, this.isLoading || this.isSubmitting || allSubmitted)}
                        </div>
                        <div style={{ position: 'relative' }}>
                            {this.renderTextareaWithOverlay(
                                this.globalText,
                                this.geocaches[0]?.id ?? null,
                                {
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
                                    disabled: this.geocaches.length > 0 && this.geocaches.every(gc => this.isGeocacheSubmittedOk(gc.id)),
                                    rows: 10,
                                    style: { width: '100%', resize: 'vertical' }
                                },
                                el => { this.globalTextArea = el; },
                                'global-overlay'
                            )}
                            {this.patternAutocompleteOpen && this.patternAutocompleteTargetGeocacheId === null && this.patternAutocompleteSuggestions.length > 0 && this.patternAutocompletePosition && (
                                <div
                                    style={{
                                        position: 'fixed',
                                        top: `${this.patternAutocompletePosition.top + 20}px`,
                                        left: `${this.patternAutocompletePosition.left}px`,
                                        width: 320,
                                        maxHeight: 200,
                                        overflowY: 'auto',
                                        border: '1px solid var(--theia-panel-border)',
                                        background: 'var(--theia-editor-background)',
                                        borderRadius: 3,
                                        zIndex: 1000,
                                        boxShadow: '0 4px 12px rgba(0,0,0,0.35)'
                                    }}
                                    onMouseDown={e => e.preventDefault()}
                                >
                                    {this.patternAutocompleteSuggestions.map((s, idx) => (
                                        <div
                                            key={s.id}
                                            style={{
                                                padding: '6px 8px',
                                                cursor: 'pointer',
                                                background: idx === this.patternAutocompleteActiveIndex
                                                    ? 'var(--theia-list-activeSelectionBackground)'
                                                    : 'transparent'
                                            }}
                                            onMouseEnter={() => { this.patternAutocompleteActiveIndex = idx; this.update(); }}
                                            onClick={() => this.applyPatternSuggestion(s)}
                                        >
                                            <div style={{ fontSize: '0.9em', fontWeight: 600 }}>{s.label}</div>
                                            <div style={{ fontSize: '0.8em', opacity: 0.7 }}>{s.description}</div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        {this.renderCharCounter('global')}

                        <div style={{ marginTop: 10 }}>
                            {this.renderImagesSection('global', this.isLoading || this.isSubmitting || allSubmitted)}
                        </div>

                        {this.renderMarkdownPreview(
                            this.resolveAllPatterns(this.globalText, this.geocaches[0]?.id ?? null),
                            'global-preview'
                        )}
                    </div>
                )}

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
