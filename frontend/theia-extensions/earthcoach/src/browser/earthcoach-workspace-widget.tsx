import * as React from 'react';
import { ApplicationShell, Message } from '@theia/core/lib/browser';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { CommandService, MessageService } from '@theia/core/lib/common';
import { PreferenceScope, PreferenceService } from '@theia/core/lib/common/preferences';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { GeocacheNotesService } from 'theia-ide-zones-ext/lib/browser/geocache-notes-service';
import {
    buildGeoAppOpenChatRequestDetail,
    dispatchGeoAppOpenChatRequest,
} from 'theia-ide-zones-ext/lib/browser/geoapp-chat-shared';
import { EarthCoachContext, EarthCoachContextService } from './earthcoach-context-service';
import { selectEarthCoachDescription } from './earthcoach-description-selector';
import { EarthCoachObservationService } from './earthcoach-observation-service';
import {
    EARTHCOACH_LISTING_LANGUAGE_PREF,
    EARTHCOACH_MAX_IMAGES_PREF,
    EARTHCOACH_RESPONSE_LANGUAGE_PREF,
    EARTHCOACH_RESPONSE_VERBOSITY_PREF,
} from './earthcoach-preferences';
import { buildEarthCoachFinalAnswerPrompt, buildEarthCoachPrompt, toImageContext } from './earthcoach-prompt-builder';
import {
    EarthCoachAgentId,
    EarthCoachOpenCommandId,
    EarthCoachVerbosity,
    GeoImage,
} from './earthcoach-types';
import {
    EarthCoachDescriptionSelection,
    EarthCoachGroupRole,
    EarthCoachPreparedImage,
    EarthCoachPreparedRequest,
    EarthCoachResult,
    EarthCoachResultProposal,
    EarthCoachSaveState,
    EarthCoachSendAction,
    EarthCoachWorkspace,
    EarthCoachWorkspaceGroup,
    EarthCoachWorkspaceImageContext,
    EarthCoachWorkspaceOpenOptions,
} from './earthcoach-workspace-types';
import {
    EarthCoachWorkspaceConflictError,
    EarthCoachWorkspaceService,
} from './earthcoach-workspace-service';
import { EarthCoachResultCaptureService, stripEarthCoachResultBlocks } from './earthcoach-result-capture';
import { prepareEarthCoachImagesForTransmission, validateEarthCoachSelection } from './earthcoach-workspace-logic';

type ImageFilter = 'all' | 'personal' | 'listing' | 'waypoint' | 'unclassified' | 'selected';

const GROUP_ROLES: Array<{ value: EarthCoachGroupRole; label: string }> = [
    { value: 'overview', label: 'Vue générale' },
    { value: 'detail', label: 'Détail' },
    { value: 'masked', label: 'Masquée' },
    { value: 'original', label: 'Originale' },
    { value: 'before', label: 'Avant' },
    { value: 'after', label: 'Après' },
    { value: 'other', label: 'Autre' },
];

const RESPONSE_LANGUAGES: Array<{ value: string; label: string }> = [
    { value: 'fr', label: 'Français' },
    { value: 'en', label: 'English' },
    { value: 'de', label: 'Deutsch' },
    { value: 'es', label: 'Español' },
    { value: 'it', label: 'Italiano' },
    { value: 'nl', label: 'Nederlands' },
    { value: 'pt', label: 'Português' },
];

function numericId(value?: string): number | undefined {
    if (!value) {
        return undefined;
    }
    const match = value.match(/(\d+)$/);
    const parsed = match ? Number(match[1]) : Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function newRequestId(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return `earthcoach-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function cloneWorkspace(workspace: EarthCoachWorkspace): EarthCoachWorkspace {
    return {
        ...workspace,
        image_contexts: workspace.image_contexts.map(item => ({ ...item })),
        groups: workspace.groups.map(group => ({
            ...group,
            members: group.members.map(member => ({ ...member })),
        })),
    };
}

function imageId(image: GeoImage): number | undefined {
    const parsed = Number(image.id);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function isImageFile(file: File): boolean {
    if (file.type.startsWith('image/')) {
        return true;
    }
    return /\.(avif|bmp|gif|hei[cf]|jpe?g|png|svg|tiff?|webp)$/i.test(file.name);
}

function statusLabel(state: EarthCoachSaveState): string {
    switch (state) {
        case 'dirty': return 'Modifications…';
        case 'saving': return 'Enregistrement…';
        case 'saved': return 'Enregistré';
        case 'error': return 'Erreur';
        default: return '';
    }
}

@injectable()
export class EarthCoachWorkspaceWidget extends ReactWidget {
    static readonly ID = 'earthcoach.workspace.widget';

    protected context?: EarthCoachContext;
    protected workspace?: EarthCoachWorkspace;
    protected description?: EarthCoachDescriptionSelection;
    protected results: EarthCoachResult[] = [];
    protected pendingAction?: EarthCoachSendAction;
    protected selectedImageId?: number;
    protected filter: ImageFilter = 'all';
    protected saveState: EarthCoachSaveState = 'idle';
    protected saveError?: string;
    protected loading = false;
    protected uploading = false;
    protected dropActive = false;
    protected dragDepth = 0;
    protected sending = false;
    protected generatingFinalResultId?: number;
    protected responseLanguage = 'fr';
    protected confirmWithoutPhoto = false;
    protected unavailable: Array<{ id: string; label?: string; reason: string }> = [];
    protected saveTimer?: number;
    protected savePromise?: Promise<void>;
    protected changeSequence = 0;

    @inject(EarthCoachWorkspaceService)
    protected readonly workspaceService!: EarthCoachWorkspaceService;

    @inject(EarthCoachContextService)
    protected readonly contextService!: EarthCoachContextService;

    @inject(EarthCoachObservationService)
    protected readonly observationService!: EarthCoachObservationService;

    @inject(GeocacheNotesService)
    protected readonly notesService!: GeocacheNotesService;

    @inject(PreferenceService)
    protected readonly preferences!: PreferenceService;

    @inject(MessageService)
    protected readonly messages!: MessageService;

    @inject(CommandService)
    protected readonly commands!: CommandService;

    @inject(ApplicationShell)
    protected readonly shell!: ApplicationShell;

    @inject(EarthCoachResultCaptureService)
    protected readonly resultCapture!: EarthCoachResultCaptureService;

    @postConstruct()
    protected init(): void {
        this.id = EarthCoachWorkspaceWidget.ID;
        this.title.label = 'Dossier terrain EarthCoach';
        this.title.caption = 'Préparer les observations et images envoyées à EarthCoach';
        this.title.closable = true;
        this.addClass('earthcoach-workspace-widget');
        this.toDispose.push(this.resultCapture.onDidCapture(result => {
            if (result.geocache_id === this.context?.geocacheData.id) {
                this.results = [result, ...this.results.filter(item => item.id !== result.id)];
                this.update();
            }
        }));
    }

    protected readonly preventFileDropNavigation = (event: DragEvent): void => {
        if (Array.from(event.dataTransfer?.types || []).includes('Files')) {
            event.preventDefault();
        }
    };

    protected override onAfterAttach(msg: Message): void {
        super.onAfterAttach(msg);
        this.node.addEventListener('dragover', this.preventFileDropNavigation);
        this.node.addEventListener('drop', this.preventFileDropNavigation);
    }

    protected override onBeforeDetach(msg: Message): void {
        this.node.removeEventListener('dragover', this.preventFileDropNavigation);
        this.node.removeEventListener('drop', this.preventFileDropNavigation);
        super.onBeforeDetach(msg);
    }

    setContext(context: EarthCoachContext, options: EarthCoachWorkspaceOpenOptions = {}): void {
        const changed = this.context?.geocacheData.id !== context.geocacheData.id;
        this.context = context;
        this.pendingAction = options.pendingAction;
        this.confirmWithoutPhoto = false;
        this.title.label = `Dossier terrain — ${context.geocacheData.gc_code || context.geocacheData.name}`;
        if (changed || !this.workspace) {
            void this.load();
        } else {
            this.rebuildDescription();
            this.update();
        }
    }

    protected async load(): Promise<void> {
        if (!this.context) {
            return;
        }
        this.loading = true;
        this.update();
        try {
            this.responseLanguage = this.preferences.get<string>(EARTHCOACH_RESPONSE_LANGUAGE_PREF, 'fr');
            this.workspace = cloneWorkspace(
                this.context.workspace || await this.workspaceService.getWorkspace(this.context.geocacheData.id)
            );
            this.results = await this.workspaceService.listResults(this.context.geocacheData.id);
            this.selectedImageId = this.workspace.image_contexts[0]?.image_id;
            this.rebuildDescription();
            this.saveState = 'idle';
            this.saveError = undefined;
        } catch (error) {
            this.saveError = error instanceof Error ? error.message : String(error);
            this.saveState = 'error';
        } finally {
            this.loading = false;
            this.update();
        }
    }

    protected rebuildDescription(manualLanguage?: string): void {
        if (!this.context || !this.workspace) {
            return;
        }
        const preferred = this.preferences.get<string>(EARTHCOACH_LISTING_LANGUAGE_PREF, 'fr');
        this.description = selectEarthCoachDescription(
            this.context.geocacheData,
            preferred,
            manualLanguage ?? this.workspace.selected_language,
            this.workspace.description_fingerprint
        );
        if (
            this.workspace.selected_language !== this.description.selectedLanguage ||
            this.workspace.description_fingerprint !== this.description.fingerprint
        ) {
            this.workspace.selected_language = this.description.selectedLanguage;
            this.workspace.description_fingerprint = this.description.fingerprint;
            this.scheduleSave();
        }
    }

    protected mutate(mutator: (workspace: EarthCoachWorkspace) => void): void {
        if (!this.workspace) {
            return;
        }
        const next = cloneWorkspace(this.workspace);
        mutator(next);
        this.workspace = next;
        this.scheduleSave();
        this.update();
    }

    protected scheduleSave(): void {
        this.changeSequence += 1;
        this.saveState = 'dirty';
        this.saveError = undefined;
        if (this.saveTimer !== undefined) {
            window.clearTimeout(this.saveTimer);
        }
        this.saveTimer = window.setTimeout(() => {
            this.saveTimer = undefined;
            void this.save();
        }, 650);
    }

    protected async save(): Promise<void> {
        if (!this.context || !this.workspace || this.savePromise) {
            return this.savePromise;
        }
        const submitted = cloneWorkspace(this.workspace);
        const submittedSequence = this.changeSequence;
        this.saveState = 'saving';
        this.update();
        this.savePromise = this.workspaceService.saveWorkspace(this.context.geocacheData.id, {
            version: submitted.version,
            general_comment: submitted.general_comment,
            selected_language: submitted.selected_language,
            description_fingerprint: submitted.description_fingerprint,
            image_contexts: submitted.image_contexts,
            groups: submitted.groups,
        }).then(saved => {
            if (this.changeSequence === submittedSequence) {
                this.workspace = cloneWorkspace(saved);
                this.saveState = 'saved';
            } else if (this.workspace) {
                this.workspace = { ...this.workspace, version: saved.version, exists: true };
                this.saveState = 'dirty';
                if (this.saveTimer !== undefined) {
                    window.clearTimeout(this.saveTimer);
                }
                this.saveTimer = window.setTimeout(() => {
                    this.saveTimer = undefined;
                    void this.save();
                }, 250);
            }
            this.contextService.invalidate(saved.geocache_id);
        }).catch(error => {
            if (error instanceof EarthCoachWorkspaceConflictError) {
                this.workspace = cloneWorkspace(error.workspace);
            }
            this.saveState = 'error';
            this.saveError = error instanceof Error ? error.message : String(error);
        }).finally(() => {
            this.savePromise = undefined;
            this.update();
        });
        return this.savePromise;
    }

    protected async flushSave(): Promise<boolean> {
        if (this.saveTimer !== undefined) {
            window.clearTimeout(this.saveTimer);
            this.saveTimer = undefined;
        }
        for (let attempt = 0; attempt < 3; attempt += 1) {
            if (this.savePromise) {
                await this.savePromise;
            }
            if (this.saveState !== 'dirty') {
                break;
            }
            if (this.saveTimer !== undefined) {
                window.clearTimeout(this.saveTimer);
                this.saveTimer = undefined;
            }
            await this.save();
        }
        return this.saveState === 'saved' || this.saveState === 'idle';
    }

    protected contextFor(imageIdValue: number): EarthCoachWorkspaceImageContext | undefined {
        return this.workspace?.image_contexts.find(item => item.image_id === imageIdValue);
    }

    protected imageFor(imageIdValue?: number): GeoImage | undefined {
        return this.context?.images.find(image => imageId(image) === imageIdValue);
    }

    protected filteredImages(): GeoImage[] {
        if (!this.context) {
            return [];
        }
        return this.context.images.filter(image => {
            const id = imageId(image);
            const item = id ? this.contextFor(id) : undefined;
            switch (this.filter) {
                case 'personal': return image.origin === 'user_observation';
                case 'listing': return image.origin === 'cache_listing';
                case 'waypoint': return item?.waypoint_id != null;
                case 'unclassified': return item?.waypoint_id == null && item?.observation_id == null;
                case 'selected': return Boolean(item?.included);
                default: return true;
            }
        });
    }

    protected selectedImages(): GeoImage[] {
        return (this.context?.images || []).filter(image => {
            const id = imageId(image);
            return id !== undefined && Boolean(this.contextFor(id)?.included);
        });
    }

    protected async upload(files: File[]): Promise<void> {
        const images = files.filter(isImageFile);
        if (files.length && !images.length) {
            this.messages.warn('Seuls des fichiers image peuvent être ajoutés au dossier.');
            return;
        }
        if (!this.context || !images.length) {
            return;
        }
        if (this.uploading) {
            this.messages.info('Un ajout d’images est déjà en cours.');
            return;
        }
        if (images.length < files.length) {
            this.messages.warn(`${files.length - images.length} fichier(s) ignoré(s) : ce ne sont pas des images.`);
        }
        this.uploading = true;
        this.update();
        try {
            if (!(await this.flushSave())) {
                throw new Error('Le dossier doit être enregistré avant d ajouter des images.');
            }
            await this.workspaceService.uploadImages(this.context.geocacheData.id, images);
            this.contextService.invalidate(this.context.geocacheData.id);
            const refreshed = await this.contextService.collectContext({
                geocacheData: this.context.geocacheData,
                forceRefresh: true,
            });
            if (refreshed) {
                this.context = refreshed;
                this.workspace = cloneWorkspace(
                    refreshed.workspace || await this.workspaceService.getWorkspace(refreshed.geocacheData.id)
                );
                const latestPersonal = [...refreshed.images].reverse().find(image => image.origin === 'user_observation');
                this.selectedImageId = imageId(latestPersonal);
                this.filter = 'personal';
            }
        } catch (error) {
            this.messages.error(error instanceof Error ? error.message : String(error));
        } finally {
            this.uploading = false;
            this.update();
        }
    }

    protected dragHasFiles(event: React.DragEvent): boolean {
        return Array.from(event.dataTransfer.types || []).includes('Files');
    }

    protected onFileDragEnter(event: React.DragEvent): void {
        if (!this.dragHasFiles(event)) {
            return;
        }
        event.preventDefault();
        this.dragDepth += 1;
        if (!this.dropActive) {
            this.dropActive = true;
            this.update();
        }
    }

    protected onFileDragOver(event: React.DragEvent): void {
        if (!this.dragHasFiles(event)) {
            return;
        }
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
    }

    protected onFileDragLeave(event: React.DragEvent): void {
        if (!this.dragHasFiles(event)) {
            return;
        }
        this.dragDepth = Math.max(0, this.dragDepth - 1);
        if (this.dragDepth === 0 && this.dropActive) {
            this.dropActive = false;
            this.update();
        }
    }

    protected onFileDrop(event: React.DragEvent): void {
        if (!this.dragHasFiles(event)) {
            return;
        }
        event.preventDefault();
        this.dragDepth = 0;
        this.dropActive = false;
        void this.upload(Array.from(event.dataTransfer.files || []));
        this.update();
    }

    protected addGroup(imageIdValue?: number): void {
        this.mutate(workspace => {
            workspace.groups.push({
                title: `Groupe ${workspace.groups.length + 1}`,
                position: workspace.groups.length,
                members: imageIdValue ? [{ image_id: imageIdValue, role: 'other', position: 0 }] : [],
            });
        });
    }

    protected suggestDerivedGroups(): void {
        if (!this.context) {
            return;
        }
        const pairs = this.context.images.filter(image => image.parentImageId).map(image => ({
            parent: this.imageFor(image.parentImageId),
            child: image,
        })).filter(pair => pair.parent);
        if (!pairs.length) {
            this.messages.info('Aucune paire originale/dérivée détectée.');
            return;
        }
        this.mutate(workspace => {
            for (const pair of pairs) {
                const parentId = imageId(pair.parent);
                const childId = imageId(pair.child);
                if (!parentId || !childId) {
                    continue;
                }
                const alreadyGrouped = workspace.groups.some(group =>
                    group.members.some(member => member.image_id === parentId) &&
                    group.members.some(member => member.image_id === childId)
                );
                if (!alreadyGrouped) {
                    workspace.groups.push({
                        title: `Originale et dérivée — ${pair.parent?.label || parentId}`,
                        instruction: 'Traiter ces deux images ensemble.',
                        position: workspace.groups.length,
                        members: [
                            { image_id: parentId, role: 'original', position: 0 },
                            { image_id: childId, role: 'detail', position: 1 },
                        ],
                    });
                }
            }
        });
    }

    protected addImageToGroup(groupIndex: number, imageIdValue: number): void {
        this.mutate(workspace => {
            const group = workspace.groups[groupIndex];
            if (!group || group.members.some(member => member.image_id === imageIdValue)) {
                return;
            }
            group.members.push({ image_id: imageIdValue, role: 'other', position: group.members.length });
        });
    }

    protected readVerbosity(): EarthCoachVerbosity {
        const value = this.preferences.get<EarthCoachVerbosity>(EARTHCOACH_RESPONSE_VERBOSITY_PREF, 'compact');
        return value === 'normal' || value === 'detailed' ? value : 'compact';
    }

    protected setResponseLanguage(language: string): void {
        this.responseLanguage = RESPONSE_LANGUAGES.some(candidate => candidate.value === language) ? language : 'fr';
        void this.preferences.set(EARTHCOACH_RESPONSE_LANGUAGE_PREF, this.responseLanguage, PreferenceScope.User);
        this.update();
    }

    protected responseLanguageLabel(): string {
        return RESPONSE_LANGUAGES.find(candidate => candidate.value === this.responseLanguage)?.label || this.responseLanguage;
    }

    protected imageLimit(): number {
        const configured = Number(this.preferences.get<number>(EARTHCOACH_MAX_IMAGES_PREF, 8));
        return Math.max(1, Math.min(20, Number.isFinite(configured) ? Math.round(configured) : 8));
    }

    protected async prepareAvailableImages(images: GeoImage[]): Promise<{ available: GeoImage[]; failures: Array<{ id: string; label?: string; reason: string }> }> {
        return prepareEarthCoachImagesForTransmission(
            images,
            url => fetch(url, { credentials: url.startsWith(window.location.origin) ? 'include' : 'omit' }),
            imageIdValue => this.workspaceService.storeImageForChat(imageIdValue)
        );
    }

    protected removeIncompleteGroupsAfterFailures(available: GeoImage[], failures: Array<{ id: string; label?: string; reason: string }>): GeoImage[] {
        const availableIds = new Set(available.map(image => imageId(image)).filter((id): id is number => id !== undefined));
        const failedIds = new Set(failures.map(item => Number(item.id)).filter(Number.isFinite));
        for (const group of this.workspace?.groups || []) {
            if (!group.members.some(member => failedIds.has(member.image_id))) {
                continue;
            }
            for (const member of group.members) {
                if (availableIds.delete(member.image_id)) {
                    const image = this.imageFor(member.image_id);
                    failures.push({
                        id: String(member.image_id),
                        label: image?.label,
                        reason: `retirée avec le groupe incomplet « ${group.title} »`,
                    });
                }
            }
        }
        return available.filter(image => {
            const id = imageId(image);
            return id !== undefined && availableIds.has(id);
        });
    }

    protected async send(action: EarthCoachSendAction): Promise<void> {
        if (!this.context || !this.workspace || !this.description || this.sending) {
            return;
        }
        if (!(await this.flushSave())) {
            this.messages.error('Le dossier doit être enregistré avant l’envoi.');
            return;
        }
        const selected = this.selectedImages();
        const limit = this.imageLimit();
        const validation = validateEarthCoachSelection(
            selected,
            this.workspace.groups,
            limit,
            this.confirmWithoutPhoto
        );
        if (!validation.valid) {
            this.pendingAction = action;
            this.messages.warn(validation.error || 'Le dossier ne peut pas être envoyé.');
            this.update();
            return;
        }

        this.sending = true;
        this.unavailable = [];
        this.update();
        try {
            const checked = await this.prepareAvailableImages(selected);
            const available = this.removeIncompleteGroupsAfterFailures(checked.available, checked.failures);
            this.unavailable = checked.failures;
            if (!available.some(image => image.origin === 'user_observation') && !this.confirmWithoutPhoto) {
                this.pendingAction = action;
                this.messages.warn('Aucune photo personnelle ne peut finalement être transmise. Confirmez « Continuer sans photo » puis relancez l’envoi.');
                return;
            }
            const availableIds = new Set(available.map(image => imageId(image)).filter((id): id is number => id !== undefined));
            const preparedImages: EarthCoachPreparedImage[] = available.map(image => {
                const id = imageId(image)!;
                const item = this.contextFor(id);
                return {
                    id: image.id,
                    origin: image.origin,
                    label: image.label,
                    fileUri: image.fileUri,
                    comment: item?.comment || undefined,
                    waypointId: item?.waypoint_id || undefined,
                    observationId: item?.observation_id || undefined,
                };
            });
            const snapshot: EarthCoachPreparedRequest = {
                requestId: newRequestId(),
                geocacheId: this.context.geocacheData.id,
                action,
                preparedAt: new Date().toISOString(),
                responseLanguage: this.responseLanguage,
                listing: {
                    language: this.description.selectedLanguage,
                    fingerprint: this.description.fingerprint,
                    reliableSeparation: this.description.reliable,
                    html: this.description.selected.html,
                    text: this.description.selected.text,
                },
                generalComment: this.workspace.general_comment || undefined,
                observations: this.context.observations,
                loggingTasks: this.context.loggingTasks,
                images: preparedImages,
                groups: this.workspace.groups
                    .map(group => ({
                        ...group,
                        members: group.members.filter(member => availableIds.has(member.image_id)),
                    }))
                    .filter(group => group.members.length > 0),
                unavailableImages: checked.failures,
            };
            this.resultCapture.register(snapshot);
            const promptImages = available.map(image => ({
                ...image,
                description: this.contextFor(imageId(image)!)?.comment || image.description,
            }));
            const geocache = {
                ...this.context.geocacheData,
                description_html: this.description.selected.html,
                description_raw: this.description.selected.text,
                description_override_html: undefined,
                description_override_raw: undefined,
            };
            const mode = action === 'resolve' ? 'resolver' : 'coach';
            const verbosity = this.readVerbosity();
            const prompt = buildEarthCoachPrompt({
                geocache,
                mode,
                action,
                verbosity,
                observations: this.context.observations,
                loggingTasks: this.context.loggingTasks,
                gcPersonalNote: this.context.gcPersonalNote,
                images: promptImages,
                preparedRequest: snapshot,
            });
            const label = geocache.gc_code || geocache.name;
            dispatchGeoAppOpenChatRequest(window, CustomEvent, buildGeoAppOpenChatRequestDetail({
                geocacheId: geocache.id,
                gcCode: geocache.gc_code,
                geocacheName: geocache.name,
                sessionTitle: action === 'resolve' ? `EARTHCOACH RÉSOLUTION - ${label}` : `EARTHCOACH ANALYSE - ${label}`,
                prompt,
                focus: true,
                workflowKind: 'general',
                preferredProfile: action === 'resolve' ? 'strong' : undefined,
                preferredAgentId: EarthCoachAgentId,
                earthcoachMode: mode,
                earthcoachVerbosity: verbosity,
                sessionKind: 'earthcoach',
                imageContexts: promptImages.map(toImageContext),
            }));
            this.confirmWithoutPhoto = false;
            this.pendingAction = undefined;
            if (checked.failures.length) {
                this.messages.warn(`${checked.failures.length} image(s) indisponible(s) ont été explicitement retirées de l’envoi.`);
            }
        } finally {
            this.sending = false;
            this.update();
        }
    }

    protected updateProposal(resultIndex: number, proposalIndex: number, patch: Partial<EarthCoachResultProposal>): void {
        this.results = this.results.map((result, currentResultIndex) => currentResultIndex === resultIndex ? {
            ...result,
            proposals: result.proposals.map((proposal, currentProposalIndex) =>
                currentProposalIndex === proposalIndex ? { ...proposal, ...patch } : proposal
            ),
        } : result);
        this.update();
    }

    protected async saveResult(resultIndex: number): Promise<EarthCoachResult | undefined> {
        const result = this.results[resultIndex];
        if (!result) {
            return undefined;
        }
        try {
            const saved = await this.workspaceService.updateResult(result.id, result.proposals);
            this.results = this.results.map((item, index) => index === resultIndex ? saved : item);
            this.update();
            return saved;
        } catch (error) {
            this.messages.error(error instanceof Error ? error.message : String(error));
            return undefined;
        }
    }

    protected moveAnswerToMissing(resultIndex: number, proposalIndex: number): void {
        const proposal = this.results[resultIndex]?.proposals[proposalIndex];
        const answer = proposal?.answer?.trim();
        if (!proposal || !answer) {
            return;
        }
        const previousMissing = proposal.missing?.trim();
        this.updateProposal(resultIndex, proposalIndex, {
            answer: '',
            missing: previousMissing ? `${previousMissing}\n${answer}` : answer,
            status: 'partial',
        });
    }

    protected async generateFinalAnswer(resultIndex: number): Promise<void> {
        const current = this.results[resultIndex];
        if (!this.context || !current || current.action !== 'resolve' || this.generatingFinalResultId !== undefined) {
            return;
        }
        this.generatingFinalResultId = current.id;
        this.update();
        try {
            const saved = await this.saveResult(resultIndex);
            if (!saved) {
                return;
            }
            if (!saved.proposals.length) {
                this.messages.warn('Aucune réponse corrigée n’est disponible pour générer le message final.');
                return;
            }
            const geocache = this.context.geocacheData;
            const label = geocache.gc_code || geocache.name;
            const verbosity = this.readVerbosity();
            dispatchGeoAppOpenChatRequest(window, CustomEvent, buildGeoAppOpenChatRequestDetail({
                geocacheId: geocache.id,
                gcCode: geocache.gc_code,
                geocacheName: geocache.name,
                sessionTitle: `EARTHCOACH FINAL - ${label}`,
                prompt: buildEarthCoachFinalAnswerPrompt(saved.proposals, this.responseLanguageLabel()),
                focus: true,
                workflowKind: 'general',
                preferredProfile: 'strong',
                preferredAgentId: EarthCoachAgentId,
                earthcoachMode: 'resolver',
                earthcoachVerbosity: verbosity,
                sessionKind: 'earthcoach',
            }));
            if (saved.proposals.some(proposal => proposal.status !== 'ready' || Boolean(proposal.missing?.trim()))) {
                this.messages.warn('La réponse finale sera générée comme brouillon avec les éléments restant à compléter.');
            }
        } finally {
            this.generatingFinalResultId = undefined;
            this.update();
        }
    }

    protected async applyProposal(resultIndex: number, proposalIndex: number): Promise<void> {
        const saved = await this.saveResult(resultIndex);
        if (!saved) {
            return;
        }
        try {
            await this.workspaceService.applyResultProposal(saved.id, proposalIndex);
            this.messages.info('Réponse reportée dans la question existante.');
            if (this.context) {
                this.contextService.invalidate(this.context.geocacheData.id);
            }
        } catch (error) {
            this.messages.error(error instanceof Error ? error.message : String(error));
        }
    }

    protected async saveResultAsNote(result: EarthCoachResult): Promise<void> {
        if (!this.context) {
            return;
        }
        const content = (result.markdown || result.proposals.map(proposal =>
            `### ${proposal.question}\n${proposal.answer || 'À compléter'}\nÉtat : ${proposal.status}`
        ).join('\n\n')).trim();
        if (!content) {
            this.messages.warn('Ce résultat ne contient aucune synthèse à enregistrer.');
            return;
        }
        try {
            await this.notesService.createNote(this.context.geocacheData.id, {
                content: `## Synthèse EarthCoach\n\n${content}`,
                note_type: 'system',
                source: 'earthcoach',
            });
            this.contextService.invalidate(this.context.geocacheData.id);
            this.messages.info('Synthèse enregistrée dans les notes.');
        } catch (error) {
            this.messages.error(error instanceof Error ? error.message : String(error));
        }
    }

    protected renderGallery(): React.ReactNode {
        const images = this.filteredImages();
        const filters: Array<{ id: ImageFilter; label: string }> = [
            { id: 'all', label: 'Toutes' },
            { id: 'personal', label: 'Personnelles' },
            { id: 'listing', label: 'Listing' },
            { id: 'waypoint', label: 'Waypoint' },
            { id: 'unclassified', label: 'Non classées' },
            { id: 'selected', label: 'Sélectionnées' },
        ];
        return <section className={`ecw-panel ecw-gallery${this.dropActive ? ' ecw-drop-active' : ''}`}>
            <h3>Images</h3>
            <div className='ecw-filters'>{filters.map(filter =>
                <button key={filter.id} className={this.filter === filter.id ? 'theia-button secondary active' : 'theia-button secondary'} onClick={() => {
                    this.filter = filter.id;
                    this.update();
                }}>{filter.label}</button>
            )}</div>
            <label className='theia-button ecw-upload'>
                {this.uploading ? 'Ajout…' : 'Ajouter des photos'}
                <input type='file' accept='image/*' multiple style={{ display: 'none' }} disabled={this.uploading}
                    onChange={event => {
                        const files = Array.from(event.currentTarget.files || []);
                        event.currentTarget.value = '';
                        void this.upload(files);
                    }} />
            </label>
            <label className='theia-button secondary ecw-upload'>
                Prendre une photo
                <input type='file' accept='image/*' capture='environment' style={{ display: 'none' }} disabled={this.uploading}
                    onChange={event => {
                        const files = Array.from(event.currentTarget.files || []);
                        event.currentTarget.value = '';
                        void this.upload(files);
                    }} />
            </label>
            <p className='ecw-muted'>Vous pouvez aussi glisser-déposer des images n’importe où dans ce dossier.</p>
            <div className='ecw-thumbs'>
                {images.map(image => {
                    const id = imageId(image);
                    if (!id) { return undefined; }
                    const item = this.contextFor(id);
                    return <button key={image.id} className={`ecw-thumb ${this.selectedImageId === id ? 'selected' : ''}`}
                        draggable onDragStart={event => event.dataTransfer.setData('application/x-earthcoach-image', String(id))}
                        onClick={() => { this.selectedImageId = id; this.update(); }}>
                        <img src={image.fileUri} alt={image.label || `Image ${id}`} />
                        <span>{image.label || `Image ${id}`}</span>
                        <input type='checkbox' checked={Boolean(item?.included)} aria-label='Sélectionner pour l IA'
                            onClick={event => event.stopPropagation()} onChange={event => this.mutate(workspace => {
                                const target = workspace.image_contexts.find(context => context.image_id === id);
                                if (target) { target.included = event.currentTarget.checked; }
                            })} />
                    </button>;
                })}
                {!images.length && <p className='ecw-muted'>Aucune image pour ce filtre.</p>}
            </div>
            {this.dropActive && <div className='ecw-drop-overlay'><span>Déposez les images pour les ajouter au dossier</span></div>}
        </section>;
    }

    protected renderPreview(): React.ReactNode {
        const image = this.imageFor(this.selectedImageId);
        return <section className='ecw-panel ecw-preview'>
            <h3>Aperçu</h3>
            {image ? <>
                <img src={image.fileUri} alt={image.label || 'Aperçu'} />
                <strong>{image.label || `Image ${image.id}`}</strong>
                <span className='ecw-muted'>{image.origin === 'user_observation' ? 'Photo personnelle' : 'Image du listing'}</span>
            </> : <p className='ecw-muted'>Sélectionnez une image.</p>}
        </section>;
    }

    protected renderInspector(): React.ReactNode {
        const id = this.selectedImageId;
        const item = id ? this.contextFor(id) : undefined;
        const image = id ? this.imageFor(id) : undefined;
        const waypoints = this.context?.geocacheData.waypoints || [];
        if (!id || !item || !image) {
            return <section className='ecw-panel'><h3>Contexte image</h3><p className='ecw-muted'>Aucune image sélectionnée.</p></section>;
        }
        return <section className='ecw-panel ecw-inspector'>
            <h3>Contexte image</h3>
            <label className='ecw-check'><input type='checkbox' checked={item.included} onChange={event => this.mutate(workspace => {
                const target = workspace.image_contexts.find(context => context.image_id === id);
                if (target) { target.included = event.currentTarget.checked; }
            })} /> Envoyer à l’IA</label>
            <label>Commentaire EarthCoach<textarea className='theia-input' rows={5} value={item.comment || ''} onChange={event => this.mutate(workspace => {
                const target = workspace.image_contexts.find(context => context.image_id === id);
                if (target) { target.comment = event.currentTarget.value; }
            })} placeholder='Ce que montre l’image, mesure, zone à comparer…' /></label>
            <label>Waypoint<select className='theia-select' value={item.waypoint_id || ''} onChange={event => this.mutate(workspace => {
                const target = workspace.image_contexts.find(context => context.image_id === id);
                if (target) { target.waypoint_id = event.currentTarget.value ? Number(event.currentTarget.value) : null; }
            })}><option value=''>Non associé</option>{waypoints.map(waypoint => waypoint.id &&
                <option key={waypoint.id} value={waypoint.id}>{waypoint.prefix || waypoint.lookup || waypoint.name || `WP ${waypoint.id}`}</option>
            )}</select></label>
            <label>Observation<select className='theia-select' value={item.observation_id || ''} onChange={event => this.mutate(workspace => {
                const target = workspace.image_contexts.find(context => context.image_id === id);
                if (target) { target.observation_id = event.currentTarget.value ? Number(event.currentTarget.value) : null; }
            })}><option value=''>Non associée</option>{(this.context?.observations || []).map(observation => {
                const observationId = numericId(observation.id);
                return observationId && <option key={observation.id} value={observationId}>{observation.note.slice(0, 80)}</option>;
            })}</select></label>
            <p className='ecw-muted'>Les notes et tags généraux de la galerie restent inchangés.</p>
        </section>;
    }

    protected renderGroups(): React.ReactNode {
        const waypoints = this.context?.geocacheData.waypoints || [];
        return <section className='ecw-panel ecw-groups'>
            <div className='ecw-row'><h3>Groupes d’images</h3><span className='ecw-grow' />
                <button className='theia-button secondary' onClick={() => this.suggestDerivedGroups()}>Suggérer originale/dérivée</button>
                <button className='theia-button' onClick={() => this.addGroup(this.selectedImageId)}>Nouveau groupe</button>
            </div>
            {(this.workspace?.groups || []).map((group, groupIndex) =>
                <div key={group.id || `new-${groupIndex}`} className='ecw-group' onDragOver={event => event.preventDefault()} onDrop={event => {
                    event.preventDefault();
                    const raw = event.dataTransfer.getData('application/x-earthcoach-image');
                    const dropped = Number(raw);
                    if (raw && Number.isInteger(dropped)) { this.addImageToGroup(groupIndex, dropped); }
                }}>
                    <div className='ecw-row'>
                        <input className='theia-input ecw-grow' value={group.title} onChange={event => this.mutate(workspace => {
                            workspace.groups[groupIndex].title = event.currentTarget.value;
                        })} />
                        <button className='theia-button secondary' onClick={() => this.mutate(workspace => workspace.groups.splice(groupIndex, 1))}>Supprimer</button>
                    </div>
                    <textarea className='theia-input' rows={2} value={group.instruction || ''} placeholder='Consigne : comparer, dévoiler la zone masquée…' onChange={event => this.mutate(workspace => {
                        workspace.groups[groupIndex].instruction = event.currentTarget.value;
                    })} />
                    <label>Waypoint commun <select className='theia-select' value={group.waypoint_id || ''} onChange={event => this.mutate(workspace => {
                        workspace.groups[groupIndex].waypoint_id = event.currentTarget.value ? Number(event.currentTarget.value) : null;
                    })}><option value=''>Aucun</option>{waypoints.map(waypoint => waypoint.id &&
                        <option key={waypoint.id} value={waypoint.id}>{waypoint.prefix || waypoint.lookup || waypoint.name || `WP ${waypoint.id}`}</option>
                    )}</select></label>
                    <div className='ecw-group-members'>{group.members.map((member, memberIndex) => {
                        const image = this.imageFor(member.image_id);
                        return <div key={member.image_id} className='ecw-member'>
                            {image && <img src={image.fileUri} alt={image.label || String(member.image_id)} />}
                            <span>{image?.label || `Image ${member.image_id}`}</span>
                            <select className='theia-select' value={member.role} onChange={event => this.mutate(workspace => {
                                workspace.groups[groupIndex].members[memberIndex].role = event.currentTarget.value as EarthCoachGroupRole;
                            })}>{GROUP_ROLES.map(role => <option key={role.value} value={role.value}>{role.label}</option>)}</select>
                            <button className='theia-button secondary' onClick={() => this.mutate(workspace => {
                                workspace.groups[groupIndex].members.splice(memberIndex, 1);
                            })}>×</button>
                        </div>;
                    })}</div>
                    {!group.members.length && <p className='ecw-muted'>Glissez des images ici.</p>}
                </div>
            )}
            {!this.workspace?.groups.length && <p className='ecw-muted'>Les groupes indiquent au modèle quelles images doivent être traitées ensemble.</p>}
        </section>;
    }

    protected renderSummary(): React.ReactNode {
        const unavailableIds = new Set(this.unavailable.map(item => item.id));
        const selected = this.selectedImages().filter(image => !unavailableIds.has(image.id));
        const personal = selected.filter(image => image.origin === 'user_observation').length;
        const listing = selected.length - personal;
        const waypointCount = new Set((this.workspace?.image_contexts || []).filter(item => item.included && item.waypoint_id).map(item => item.waypoint_id)).size;
        const action = this.pendingAction;
        return <section className='ecw-panel ecw-summary'>
            <h3>Vérification avant envoi</h3>
            {(this.context?.loadErrors || []).length ? <div className='ecw-warning'>Chargement incomplet : {(this.context?.loadErrors || []).join(', ')}. L’envoi est déconseillé tant que ces données ne sont pas disponibles.</div> : undefined}
            {this.description?.notice && <div className='ecw-warning'>{this.description.notice}</div>}
            <div className='ecw-summary-grid'>
                <span>Listing : <strong>{this.description?.selected.label}</strong></span>
                <span>Questions : <strong>{this.context?.loggingTasks.length || 0}</strong></span>
                <span>Observations : <strong>{this.context?.observations.length || 0}</strong></span>
                <span>Photos personnelles : <strong>{personal}</strong></span>
                <span>Images listing : <strong>{listing}</strong></span>
                <span>Groupes : <strong>{this.workspace?.groups.length || 0}</strong></span>
                <span>Waypoints représentés : <strong>{waypointCount}</strong></span>
                <span>Limite : <strong>{selected.length}/{this.imageLimit()}</strong></span>
            </div>
            {personal === 0 && <label className='ecw-confirm'><input type='checkbox' checked={this.confirmWithoutPhoto} onChange={event => {
                this.confirmWithoutPhoto = event.currentTarget.checked;
                this.update();
            }} /> Continuer sans photo personnelle pour cet envoi</label>}
            {this.unavailable.length > 0 && <div className='ecw-error'>Images retirées : {this.unavailable.map(item => `${item.label || item.id} (${item.reason})`).join(', ')}</div>}
            {action && <div className='ecw-review'>Action demandée : <strong>{action === 'resolve' ? 'Résoudre avec mon dossier' : 'Analyser mes observations'}</strong></div>}
            <div className='ecw-actions'>
                <button className='theia-button secondary' disabled={this.sending} onClick={() => void this.send('analyze_observations')}>Analyser mes observations</button>
                <button className='theia-button' disabled={this.sending} onClick={() => void this.send('resolve')}>{this.sending ? 'Préparation…' : 'Résoudre avec mon dossier'}</button>
            </div>
        </section>;
    }

    protected renderResults(): React.ReactNode {
        if (!this.results.length) {
            return <section className='ecw-panel'><h3>Propositions EarthCoach</h3><p className='ecw-muted'>Les résultats capturés apparaîtront ici et resteront révisables.</p></section>;
        }
        return <section className='ecw-panel ecw-results'><h3>Propositions EarthCoach</h3>{this.results.map((result, resultIndex) =>
            <details key={result.id} open={resultIndex === 0}><summary>{result.action === 'resolve' ? 'Résolution' : 'Analyse'} — {result.created_at ? new Date(result.created_at).toLocaleString() : result.request_id}</summary>
                {result.markdown && <pre>{stripEarthCoachResultBlocks(result.markdown)}</pre>}
                {result.proposals.map((proposal, proposalIndex) => <div key={`${result.id}-${proposalIndex}`} className='ecw-proposal'>
                    <div className='ecw-question'><strong>{proposal.question}</strong>
                        {proposal.question_translation && proposal.question_translation.trim() !== proposal.question.trim() &&
                            <div className='ecw-translation'><span>Traduction :</span> {proposal.question_translation}</div>}
                    </div>
                    <label>État<select className='theia-select' value={proposal.status} onChange={event => this.updateProposal(resultIndex, proposalIndex, { status: event.currentTarget.value as EarthCoachResultProposal['status'] })}>
                        <option value='ready'>Prête</option><option value='partial'>Partielle</option><option value='missing'>Manquante</option>
                    </select></label>
                    <label>Réponse candidate — uniquement ce qui répond à la question<textarea className='theia-input' rows={4} value={proposal.answer || ''} onChange={event => this.updateProposal(resultIndex, proposalIndex, { answer: event.currentTarget.value })} /></label>
                    <label>Éléments à compléter — actions, mesures ou informations manquantes<textarea className='theia-input' rows={2} value={proposal.missing || ''} placeholder='Ex. mesurer l’épaisseur sur place' onChange={event => this.updateProposal(resultIndex, proposalIndex, { missing: event.currentTarget.value || null })} /></label>
                    <div className='ecw-row'><button className='theia-button secondary' onClick={() => void this.saveResult(resultIndex)}>Enregistrer</button>
                        <button className='theia-button secondary' disabled={!proposal.answer?.trim()} onClick={() => this.moveAnswerToMissing(resultIndex, proposalIndex)}>Déplacer la réponse vers « À compléter »</button>
                        <button className='theia-button' disabled={proposal.status !== 'ready' || !proposal.answer || Boolean(proposal.missing)} onClick={() => void this.applyProposal(resultIndex, proposalIndex)}>Reporter dans la question</button></div>
                </div>)}
                <div className='ecw-final-answer'>
                    <label>Langue de la réponse finale<select className='theia-select' value={this.responseLanguage} onChange={event => this.setResponseLanguage(event.currentTarget.value)}>
                        {RESPONSE_LANGUAGES.map(language => <option key={language.value} value={language.value}>{language.label}</option>)}
                    </select></label>
                    {result.action === 'resolve' && <button className='theia-button' disabled={this.generatingFinalResultId !== undefined} onClick={() => void this.generateFinalAnswer(resultIndex)}>
                        {this.generatingFinalResultId === result.id ? 'Préparation…' : 'Générer la réponse finale avec mes corrections'}
                    </button>}
                    <button className='theia-button secondary' onClick={() => void this.saveResultAsNote(result)}>Enregistrer la synthèse dans les notes</button>
                </div>
            </details>
        )}</section>;
    }

    protected render(): React.ReactNode {
        if (this.loading) {
            return <div className='ecw-loading'>Chargement du dossier terrain…</div>;
        }
        if (!this.context || !this.workspace) {
            return <div className='ecw-loading ecw-error'>{this.saveError || 'Aucun dossier terrain disponible.'}</div>;
        }
        return <div className='ecw-root'
            onDragEnter={event => this.onFileDragEnter(event)}
            onDragOver={event => this.onFileDragOver(event)}
            onDragLeave={event => this.onFileDragLeave(event)}
            onDrop={event => this.onFileDrop(event)}>
            <style>{`
                .ecw-root{height:100%;overflow:auto;padding:12px;box-sizing:border-box;background:var(--theia-editor-background);display:grid;grid-auto-rows:max-content;align-content:start;gap:12px}
                .ecw-root *{box-sizing:border-box}.ecw-root img{display:block;max-width:100%}
                .ecw-head,.ecw-row,.ecw-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.ecw-grow{flex:1}.ecw-head h2,.ecw-panel h3{margin:0}
                .ecw-main{display:grid;grid-template-columns:minmax(250px,1fr) minmax(300px,1.4fr) minmax(260px,1fr);gap:12px;min-height:430px}
                .ecw-main>*{min-width:0}.ecw-panel{min-width:0;max-width:100%;border:1px solid var(--theia-panel-border);border-radius:8px;padding:12px;background:var(--theia-sideBar-background);display:grid;grid-auto-rows:max-content;gap:10px;align-content:start}
                .ecw-filters{display:flex;gap:5px;flex-wrap:wrap}.ecw-filters button{padding:3px 7px}.ecw-filters .active{outline:2px solid var(--theia-focusBorder)}
                .ecw-upload{text-align:center}.ecw-gallery{position:relative}.ecw-gallery.ecw-drop-active{border-color:var(--theia-focusBorder)}
                .ecw-drop-overlay{position:absolute;inset:0;z-index:5;display:flex;align-items:center;justify-content:center;padding:16px;border:2px dashed var(--theia-focusBorder);border-radius:8px;background:color-mix(in srgb,var(--theia-editor-background) 85%,transparent);font-weight:600;text-align:center;pointer-events:none}
                .ecw-thumbs{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(105px,100%),1fr));grid-auto-rows:max-content;gap:8px;align-content:start;min-width:0;min-height:120px}
                .ecw-thumb{position:relative;display:grid;grid-template-rows:82px minmax(18px,auto);min-width:0;max-width:100%;min-height:110px;gap:4px;padding:5px;color:inherit;background:var(--theia-editor-background);border:1px solid var(--theia-panel-border);border-radius:6px;text-align:left;overflow:hidden}.ecw-thumb.selected{border-color:var(--theia-focusBorder)}
                .ecw-thumb img{width:100%;height:82px;object-fit:cover;border-radius:4px}.ecw-thumb span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.ecw-thumb input{position:absolute;top:8px;right:8px;width:18px;height:18px}
                .ecw-preview{overflow:hidden}.ecw-preview img{width:100%;height:auto;max-height:55vh;object-fit:contain;background:#111;border-radius:6px}.ecw-inspector label{display:grid;min-width:0;gap:5px}.ecw-inspector .theia-input,.ecw-inspector .theia-select{min-width:0;width:100%;max-width:100%}.ecw-check{display:flex!important;grid-template-columns:auto 1fr;align-items:center}
                .ecw-groups,.ecw-results{grid-column:1/-1}.ecw-group{border:1px dashed var(--theia-panel-border);border-radius:6px;padding:9px;display:grid;gap:8px}.ecw-group-members{display:flex;gap:8px;flex-wrap:wrap}
                .ecw-member{display:grid;grid-template-columns:48px minmax(0,1fr) auto auto;gap:6px;align-items:center;min-width:0;max-width:100%}.ecw-member img{width:48px;height:42px;object-fit:cover;border-radius:4px}.ecw-member span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
                .ecw-summary-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:7px}.ecw-muted{color:var(--theia-descriptionForeground);font-size:12px}.ecw-warning,.ecw-error,.ecw-review{padding:9px;border-radius:5px}.ecw-warning{background:var(--theia-inputValidation-warningBackground);border:1px solid var(--theia-inputValidation-warningBorder)}.ecw-error{background:var(--theia-inputValidation-errorBackground);border:1px solid var(--theia-inputValidation-errorBorder)}.ecw-review{background:var(--theia-list-activeSelectionBackground)}
                .ecw-confirm{font-weight:600;display:flex;align-items:center;gap:8px}.ecw-actions{position:sticky;bottom:0;padding:8px;background:var(--theia-sideBar-background);justify-content:flex-end;border-top:1px solid var(--theia-panel-border)}
                .ecw-results details{border-top:1px solid var(--theia-panel-border);padding-top:8px}.ecw-results pre{white-space:pre-wrap}.ecw-proposal{display:grid;gap:9px;padding:12px;margin:10px 0;border:1px solid var(--theia-panel-border);border-radius:6px}.ecw-proposal label,.ecw-final-answer label{display:grid;gap:5px}.ecw-question{display:grid;gap:5px}.ecw-translation{padding:7px 9px;border-left:3px solid var(--theia-focusBorder);background:var(--theia-editor-background)}.ecw-translation span{font-weight:600}.ecw-final-answer{display:flex;align-items:end;gap:8px;flex-wrap:wrap;padding-top:10px;border-top:1px solid var(--theia-panel-border)}.ecw-loading{padding:24px}
                @media(max-width:900px){.ecw-main{grid-template-columns:1fr}.ecw-groups,.ecw-results{grid-column:auto}.ecw-preview img{max-height:45vh}}
            `}</style>
            <header className='ecw-head'><h2>Dossier terrain</h2><span className='ecw-muted'>{this.context.geocacheData.name}</span><span className='ecw-grow' />
                <span title={this.saveError}>{statusLabel(this.saveState)}</span>
                <button className='theia-button secondary' onClick={() => void this.commands.executeCommand(EarthCoachOpenCommandId, { geocacheData: this.context?.geocacheData, action: 'observations' })}>Gérer les observations</button>
                <button className='theia-button secondary' onClick={() => void this.commands.executeCommand(EarthCoachOpenCommandId, { geocacheData: this.context?.geocacheData, action: 'logging_tasks' })}>Gérer les questions</button>
            </header>
            <section className='ecw-panel'><div className='ecw-row'><label>Version du listing <select className='theia-select' value={this.description?.selectedLanguage || ''} onChange={event => {
                this.rebuildDescription(event.currentTarget.value); this.update();
            }}>{(this.description?.versions || []).map(candidate => <option key={candidate.language} value={candidate.language}>{candidate.label}</option>)}</select></label>
                <label>Langue des questions et réponses <select className='theia-select' value={this.responseLanguage} onChange={event => this.setResponseLanguage(event.currentTarget.value)}>
                    {RESPONSE_LANGUAGES.map(language => <option key={language.value} value={language.value}>{language.label}</option>)}
                </select></label>
                <span className='ecw-muted'>{this.description?.reliable ? 'Une seule version sera analysée.' : 'Description complète utilisée.'}</span></div></section>
            <div className='ecw-main'>{this.renderGallery()}{this.renderPreview()}{this.renderInspector()}</div>
            {this.renderGroups()}
            <section className='ecw-panel'><h3>Commentaire général</h3><textarea className='theia-input' rows={4} value={this.workspace.general_comment || ''} onChange={event => this.mutate(workspace => { workspace.general_comment = event.currentTarget.value; })} placeholder='Contexte global utile au modèle, conditions terrain, objectif de comparaison…' /></section>
            <section className='ecw-panel'><div className='ecw-row'><h3>Observations et couverture</h3><span className='ecw-grow' /><strong>{this.context.observations.length} observation(s) · {this.context.loggingTasks.filter(task => task.observationId).length}/{this.context.loggingTasks.length} question(s) liée(s)</strong></div>
                {this.context.observations.slice(0, 8).map(observation => <div key={observation.id}>{observation.note}</div>)}
                {!this.context.observations.length && <p className='ecw-muted'>Aucune observation structurée. Ce n’est pas une erreur si vous n’en avez pas encore saisi.</p>}
            </section>
            {this.renderSummary()}
            {this.renderResults()}
        </div>;
    }
}
