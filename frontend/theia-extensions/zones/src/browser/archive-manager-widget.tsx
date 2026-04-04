import * as React from 'react';
import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { MessageService } from '@theia/core';
import { ConfirmDialog } from '@theia/core/lib/browser';
import { PluginExecutorContribution } from '@mysterai/theia-plugins/lib/browser/plugins-contribution';
import { GeocacheContext, PluginExecutorResumeSnapshot } from '@mysterai/theia-plugins/lib/browser/plugin-executor-widget';
import { ResolutionWorkflowStepRunResponse } from '@mysterai/theia-plugins/lib/common/plugin-protocol';

interface ArchiveStats {
    total_archived: number;
    solved: number;
    in_progress: number;
    found: number;
    by_cache_type: Record<string, number>;
    by_resolution_method: Record<string, number>;
}

interface ArchiveSettings {
    auto_sync_enabled: boolean;
}

interface ArchiveHistoryEntry {
    entry_id?: string;
    recorded_at?: string;
    source?: string;
    workflow_kind?: string;
    workflow_confidence?: number;
    control_status?: string;
    final_confidence?: number;
    current_text?: string;
    recommendation_source_text?: string;
    latest_event?: {
        category?: string;
        message?: string;
        detail?: string;
        timestamp?: string;
    } | null;
    resume_state?: PluginExecutorResumeSnapshot | null;
}

interface ArchiveDiagnostics {
    source?: string;
    updated_at?: string;
    current_text?: string;
    workflow_resolution?: {
        primary?: {
            kind?: string;
            confidence?: number;
            score?: number;
            reason?: string;
            forced?: boolean;
        } | null;
        explanation?: string[];
        next_actions?: string[];
        execution?: Record<string, any> | null;
    } | null;
    resume_state?: PluginExecutorResumeSnapshot | null;
    history_state?: ArchiveHistoryEntry[];
}

interface ArchiveEntry {
    id?: number;
    gc_code: string;
    name?: string;
    cache_type?: string;
    difficulty?: number;
    terrain?: number;
    solved_status?: string;
    resolution_method?: string;
    solved_coordinates_raw?: string;
    solved_latitude?: number;
    solved_longitude?: number;
    original_coordinates_raw?: string;
    waypoints_snapshot?: any[] | null;
    found?: boolean;
    updated_at?: string;
    resolution_diagnostics?: ArchiveDiagnostics | null;
}

interface GeocacheApiResponse {
    id?: number;
    gc_code?: string;
    name?: string;
    difficulty?: number;
    terrain?: number;
    latitude?: number;
    longitude?: number;
    coordinates_raw?: string;
    original_coordinates_raw?: string;
    description_html?: string;
    description_override_html?: string;
    description_raw?: string;
    description_override_raw?: string;
    hints?: string;
    hints_decoded?: string;
    hints_decoded_override?: string;
    waypoints?: any[];
    images?: Array<{ url?: string }>;
    checkers?: Array<{ id?: number; name?: string; url?: string }>;
}

interface ArchiveListResponse {
    total: number;
    page: number;
    per_page: number;
    pages: number;
    archives: ArchiveEntry[];
}

type BulkFilter = 'all' | 'by_status' | 'orphaned' | 'before_date';

const BULK_FILTER_LABELS: Record<BulkFilter, string> = {
    all: 'Toutes les archives',
    by_status: 'Par statut de résolution',
    orphaned: 'Orphelines (géocache supprimée)',
    before_date: 'Antérieures à une date',
};

const STATUS_OPTIONS = [
    { value: 'not_solved', label: 'Non résolues' },
    { value: 'in_progress', label: 'En cours' },
    { value: 'solved', label: 'Résolues' },
];

const ARCHIVE_STATUS_FILTER_OPTIONS = [
    { value: '', label: 'Tous les statuts' },
    ...STATUS_OPTIONS,
];

const WORKFLOW_KIND_LABELS: Record<string, string> = {
    general: 'Général',
    secret_code: 'Code secret',
    formula: 'Formule',
    checker: 'Checker',
    hidden_content: 'Contenu caché',
    image_puzzle: 'Image',
    coord_transform: 'Coordonnées',
};

const CONTROL_STATUS_LABELS: Record<string, string> = {
    ready: 'Prêt',
    awaiting_input: 'Attente saisie',
    budget_exhausted: 'Budget épuisé',
    stopped: 'Arrêté',
    completed: 'Terminé',
};

const REPLAYABLE_WORKFLOW_STEP_IDS = new Set([
    'execute-metasolver',
    'search-answers',
    'calculate-final-coordinates',
    'validate-with-checker',
]);

type ArchiveWorkflowLogEntry = PluginExecutorResumeSnapshot['workflowEntries'][number];

const truncateArchiveText = (value: string | undefined | null, maxLength: number = 180): string => {
    const normalized = String(value || '').replace(/\s+/g, ' ').trim();
    if (!normalized) {
        return '';
    }
    if (normalized.length <= maxLength) {
        return normalized;
    }
    return `${normalized.slice(0, Math.max(0, maxLength - 3))}...`;
};

const formatArchiveDate = (value?: string | null): string => {
    if (!value) {
        return '';
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return value;
    }
    return date.toLocaleString('fr-FR');
};

const formatCheckerCandidateFromCoordinates = (coordinates: any): string => {
    if (!coordinates || typeof coordinates !== 'object') {
        return '';
    }
    if (typeof coordinates.ddm === 'string' && coordinates.ddm.trim()) {
        return coordinates.ddm.trim();
    }
    if (typeof coordinates.formatted === 'string' && coordinates.formatted.trim()) {
        return coordinates.formatted.trim();
    }
    if (typeof coordinates.decimal === 'string' && coordinates.decimal.trim()) {
        return coordinates.decimal.trim();
    }
    if (coordinates.latitude !== undefined && coordinates.longitude !== undefined) {
        return `${coordinates.latitude}, ${coordinates.longitude}`;
    }
    return '';
};

const prependArchiveWorkflowEntry = (
    entries: ArchiveWorkflowLogEntry[] | undefined,
    category: ArchiveWorkflowLogEntry['category'],
    message: string,
    detail?: string,
): ArchiveWorkflowLogEntry[] => [
    {
        id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
        category,
        message,
        detail,
        timestamp: new Date().toLocaleTimeString('fr-FR', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
        }),
    },
    ...(entries || []),
].slice(0, 12);

@injectable()
export class ArchiveManagerWidget extends ReactWidget {
    static readonly ID = 'geoapp.archive.manager';

    protected backendBaseUrl = 'http://localhost:8000';
    protected stats: ArchiveStats | null = null;
    protected settings: ArchiveSettings | null = null;
    protected isLoading = false;
    protected isSaving = false;
    protected isDeleting = false;
    protected bulkFilter: BulkFilter = 'orphaned';
    protected bulkStatus = 'not_solved';
    protected bulkBeforeDate = '';
    protected lastActionResult: string | null = null;
    protected lastActionError: string | null = null;
    protected pendingDisable = false;
    protected archives: ArchiveEntry[] = [];
    protected archivesPage = 1;
    protected archivePages = 1;
    protected archiveTotal = 0;
    protected archiveSearch = '';
    protected archiveStatusFilter = '';
    protected isLoadingArchives = false;
    protected isLoadingArchiveDetails = false;
    protected selectedArchiveGcCode: string | null = null;
    protected selectedArchive: ArchiveEntry | null = null;
    protected restoringHistoryEntryKey: string | null = null;
    protected replayingHistoryEntryKey: string | null = null;
    protected replayStepSelections: Record<string, string> = {};

    constructor(
        @inject(MessageService) protected readonly messages: MessageService,
        @inject(PluginExecutorContribution) protected readonly pluginExecutorContribution: PluginExecutorContribution,
    ) {
        super();
        this.id = ArchiveManagerWidget.ID;
        this.title.label = '🗄️ Gestionnaire Archive';
        this.title.caption = 'Gérer l\'archive de résolution des géocaches';
        this.title.closable = true;
        this.title.iconClass = 'fa fa-database';
        this.addClass('theia-archive-manager-widget');
    }

    @postConstruct()
    initialize(): void {
        this.loadData();
    }

    protected async loadData(): Promise<void> {
        this.isLoading = true;
        this.update();
        try {
            const [statsRes, settingsRes] = await Promise.all([
                fetch(`${this.backendBaseUrl}/api/archive/stats`, { credentials: 'include' }),
                fetch(`${this.backendBaseUrl}/api/archive/settings`, { credentials: 'include' }),
            ]);
            if (statsRes.ok) { this.stats = await statsRes.json(); }
            if (settingsRes.ok) { this.settings = await settingsRes.json(); }
            await this.loadArchives(false);
        } catch (e) {
            console.error('[ArchiveManagerWidget] loadData error', e);
        } finally {
            this.isLoading = false;
            this.update();
        }
    }

    protected async loadArchives(preserveSelection: boolean = true): Promise<void> {
        this.isLoadingArchives = true;
        this.update();
        try {
            const params = new URLSearchParams({
                page: String(this.archivesPage),
                per_page: '12',
            });
            if (this.archiveStatusFilter) {
                params.set('solved_status', this.archiveStatusFilter);
            }
            if (this.archiveSearch.trim()) {
                params.set('gc_code', this.archiveSearch.trim().toUpperCase());
            }

            const res = await fetch(`${this.backendBaseUrl}/api/archive?${params.toString()}`, {
                credentials: 'include',
            });
            if (!res.ok) {
                throw new Error(`HTTP ${res.status}`);
            }

            const payload = await res.json() as ArchiveListResponse;
            this.archives = Array.isArray(payload.archives) ? payload.archives : [];
            this.archiveTotal = Number(payload.total || 0);
            this.archivePages = Math.max(1, Number(payload.pages || 1));
            this.archivesPage = Math.min(this.archivesPage, this.archivePages);

            const nextSelectedGcCode = preserveSelection
                ? (this.selectedArchiveGcCode && this.archives.some(entry => entry.gc_code === this.selectedArchiveGcCode)
                    ? this.selectedArchiveGcCode
                    : this.archives[0]?.gc_code || null)
                : this.archives[0]?.gc_code || null;

            this.selectedArchiveGcCode = nextSelectedGcCode;
            this.selectedArchive = nextSelectedGcCode
                ? (this.archives.find(entry => entry.gc_code === nextSelectedGcCode) || null)
                : null;

            if (nextSelectedGcCode) {
                await this.loadArchiveDetails(nextSelectedGcCode);
            }
        } catch (e) {
            this.lastActionError = `Erreur chargement archives : ${String(e)}`;
            console.error('[ArchiveManagerWidget] loadArchives error', e);
        } finally {
            this.isLoadingArchives = false;
            this.update();
        }
    }

    protected async loadArchiveDetails(gcCode: string): Promise<void> {
        if (!gcCode) {
            this.selectedArchive = null;
            this.selectedArchiveGcCode = null;
            this.update();
            return;
        }
        this.isLoadingArchiveDetails = true;
        this.selectedArchiveGcCode = gcCode;
        this.update();
        try {
            const res = await fetch(`${this.backendBaseUrl}/api/archive/${encodeURIComponent(gcCode)}`, {
                credentials: 'include',
            });
            if (!res.ok) {
                throw new Error(`HTTP ${res.status}`);
            }
            this.selectedArchive = await res.json() as ArchiveEntry;
        } catch (e) {
            this.selectedArchive = this.archives.find(entry => entry.gc_code === gcCode) || null;
            this.lastActionError = `Erreur chargement détail archive : ${String(e)}`;
            console.error('[ArchiveManagerWidget] loadArchiveDetails error', e);
        } finally {
            this.isLoadingArchiveDetails = false;
            this.update();
        }
    }

    protected getHistoryEntries(entry: ArchiveEntry | null): ArchiveHistoryEntry[] {
        const diagnostics = entry?.resolution_diagnostics;
        if (diagnostics?.history_state?.length) {
            return diagnostics.history_state;
        }
        if (diagnostics?.resume_state) {
            return [{
                recorded_at: diagnostics.updated_at,
                source: diagnostics.source,
                workflow_kind: diagnostics.workflow_resolution?.primary?.kind,
                workflow_confidence: diagnostics.workflow_resolution?.primary?.confidence,
                final_confidence: diagnostics.resume_state?.workflowResolution?.control?.final_confidence,
                control_status: diagnostics.resume_state?.workflowResolution?.control?.status,
                current_text: diagnostics.resume_state?.currentText || diagnostics.current_text,
                latest_event: Array.isArray(diagnostics.resume_state?.workflowEntries) && diagnostics.resume_state?.workflowEntries[0]
                    ? diagnostics.resume_state.workflowEntries[0]
                    : null,
                resume_state: diagnostics.resume_state,
            }];
        }
        return [];
    }

    protected getHistoryEntryKey(entry: ArchiveHistoryEntry, index: number): string {
        return entry.entry_id || `${entry.recorded_at || 'entry'}-${index}`;
    }

    protected getArchiveListSummary(entry: ArchiveEntry): {
        meta: string;
        eventLabel: string;
        eventText: string;
    } | null {
        const latestEntry = this.getHistoryEntries(entry)[0];
        if (!latestEntry) {
            return null;
        }

        const metaParts: string[] = [];
        const workflowLabel = WORKFLOW_KIND_LABELS[latestEntry.workflow_kind || ''] || latestEntry.workflow_kind || '';
        if (workflowLabel) {
            metaParts.push(workflowLabel);
        }
        if (latestEntry.control_status) {
            metaParts.push(CONTROL_STATUS_LABELS[latestEntry.control_status] || latestEntry.control_status);
        }
        if (typeof latestEntry.final_confidence === 'number') {
            metaParts.push(`confiance ${(latestEntry.final_confidence * 100).toFixed(0)}%`);
        }

        const latestEvent = latestEntry.latest_event;
        const eventLabel = latestEvent?.category === 'execute'
            ? 'Dernier rejeu'
            : 'Derniere activite';
        const eventParts = [
            typeof latestEvent?.message === 'string' ? latestEvent.message.trim() : '',
            typeof latestEvent?.detail === 'string' ? latestEvent.detail.trim() : '',
        ].filter(Boolean);
        const eventText = truncateArchiveText(
            eventParts.join(' | ') || latestEntry.current_text || '',
            120,
        );

        if (!metaParts.length && !eventText) {
            return null;
        }

        return {
            meta: metaParts.join(' | '),
            eventLabel,
            eventText,
        };
    }

    protected async fetchLiveGeocache(gcCode: string): Promise<GeocacheApiResponse | null> {
        const response = await fetch(`${this.backendBaseUrl}/api/geocaches/by-code/${encodeURIComponent(gcCode)}`, {
            credentials: 'include',
        });
        if (response.status === 404 || response.status === 409) {
            return null;
        }
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        return await response.json() as GeocacheApiResponse;
    }

    protected buildPluginExecutorContext(
        archive: ArchiveEntry,
        historyEntry: ArchiveHistoryEntry,
        resumeSnapshot: PluginExecutorResumeSnapshot,
        geocache: GeocacheApiResponse | null,
    ): GeocacheContext {
        const coordinatesRaw = geocache?.coordinates_raw
            || geocache?.original_coordinates_raw
            || archive.solved_coordinates_raw
            || archive.original_coordinates_raw;
        const latitude = typeof geocache?.latitude === 'number'
            ? geocache.latitude
            : (typeof archive.solved_latitude === 'number' ? archive.solved_latitude : undefined);
        const longitude = typeof geocache?.longitude === 'number'
            ? geocache.longitude
            : (typeof archive.solved_longitude === 'number' ? archive.solved_longitude : undefined);
        const coordinates = typeof latitude === 'number' && typeof longitude === 'number'
            ? { latitude, longitude, coordinatesRaw }
            : undefined;
        const description = geocache?.description_override_html
            || geocache?.description_html
            || geocache?.description_override_raw
            || geocache?.description_raw
            || historyEntry.current_text
            || archive.resolution_diagnostics?.current_text
            || resumeSnapshot.currentText
            || '';
        const hint = geocache?.hints_decoded_override
            || geocache?.hints_decoded
            || geocache?.hints
            || '';

        return {
            geocacheId: geocache?.id,
            gcCode: geocache?.gc_code || archive.gc_code,
            name: geocache?.name || archive.name || archive.gc_code,
            coordinates,
            description,
            hint,
            difficulty: geocache?.difficulty ?? archive.difficulty,
            terrain: geocache?.terrain ?? archive.terrain,
            waypoints: geocache?.waypoints || archive.waypoints_snapshot || [],
            images: (geocache?.images || [])
                .filter((image): image is { url?: string } => Boolean(image && image.url))
                .map(image => ({ url: image.url || '' })),
            checkers: geocache?.checkers || [],
            resumeSnapshot,
        };
    }

    protected async restoreHistoryEntry(entry: ArchiveHistoryEntry, index: number): Promise<void> {
        const archive = this.selectedArchive;
        const resumeSnapshot = entry.resume_state || null;
        if (!archive || !resumeSnapshot) {
            this.messages.warn('Aucun snapshot exploitable pour cette tentative.');
            return;
        }

        const historyEntryKey = this.getHistoryEntryKey(entry, index);
        this.restoringHistoryEntryKey = historyEntryKey;
        this.update();

        let liveGeocache: GeocacheApiResponse | null = null;
        let usedArchiveFallback = false;

        try {
            try {
                liveGeocache = await this.fetchLiveGeocache(archive.gc_code);
                usedArchiveFallback = !liveGeocache;
            } catch (fetchError) {
                usedArchiveFallback = true;
                console.warn('[ArchiveManagerWidget] restoreHistoryEntry live geocache fetch failed', fetchError);
            }

            const context = this.buildPluginExecutorContext(archive, entry, resumeSnapshot, liveGeocache);
            await this.pluginExecutorContribution.openWithContext(context, 'metasolver', false);

            if (usedArchiveFallback) {
                this.messages.warn(`Tentative restaurée depuis l'archive pour ${archive.gc_code} (contexte live indisponible).`);
            } else {
                this.messages.info(`Tentative restaurée dans le Plugin Executor pour ${archive.gc_code}.`);
            }
        } catch (error) {
            console.error('[ArchiveManagerWidget] restoreHistoryEntry error', error);
            this.messages.error(`Erreur restauration tentative : ${String(error)}`);
        } finally {
            this.restoringHistoryEntryKey = null;
            this.update();
        }
    }

    protected getReplayableSteps(
        resumeSnapshot: PluginExecutorResumeSnapshot,
    ): Array<{ id: string; title?: string; status?: string }> {
        const plan = resumeSnapshot.workflowResolution?.plan || [];
        const steps: Array<{ id: string; title?: string; status?: string }> = [];
        for (const step of plan) {
            const stepId = String(step?.id || '').trim();
            if (!REPLAYABLE_WORKFLOW_STEP_IDS.has(stepId)) {
                continue;
            }
            steps.push({
                id: stepId,
                title: typeof step?.title === 'string' ? step.title : undefined,
                status: typeof step?.status === 'string' ? step.status : undefined,
            });
        }
        return steps;
    }

    protected getNextReplayableStep(
        resumeSnapshot: PluginExecutorResumeSnapshot,
    ): { id: string; title?: string; status?: string } | null {
        const replayableSteps = this.getReplayableSteps(resumeSnapshot);
        return replayableSteps.find(step => step.status === 'planned')
            || replayableSteps[0]
            || null;
    }

    protected buildReplayRequest(
        context: GeocacheContext,
        resumeSnapshot: PluginExecutorResumeSnapshot,
        targetStepId: string,
        liveGeocache: GeocacheApiResponse | null,
    ): Record<string, unknown> {
        const workflowResolution = resumeSnapshot.workflowResolution;
        const answerSearch = workflowResolution?.execution?.formula?.answer_search;
        const formulaAnswers = answerSearch
            ? Object.fromEntries(
                Object.entries(answerSearch.answers || {})
                    .filter(([, value]) => typeof value?.best_answer === 'string' && value.best_answer.trim().length > 0)
                    .map(([key, value]) => [key, value.best_answer!.trim()])
            )
            : undefined;
        const formulaValueTypes = answerSearch
            ? Object.fromEntries(
                Object.entries(answerSearch.answers || {})
                    .filter(([, value]) => typeof value?.recommended_value_type === 'string' && value.recommended_value_type.trim().length > 0)
                    .map(([key, value]) => [key, value.recommended_value_type!.trim()])
            )
            : undefined;
        const checkerCandidate = workflowResolution?.execution?.checker?.candidate
            || formatCheckerCandidateFromCoordinates(workflowResolution?.execution?.formula?.calculated_coordinates)
            || formatCheckerCandidateFromCoordinates(workflowResolution?.execution?.secret_code?.metasolver_result?.coordinates)
            || undefined;

        return {
            geocache_id: liveGeocache?.id,
            title: context.name,
            description: resumeSnapshot.currentText || context.description || undefined,
            description_html: liveGeocache?.description_override_html || liveGeocache?.description_html || undefined,
            hint: context.hint || undefined,
            waypoints: context.waypoints,
            checkers: context.checkers,
            images: context.images,
            preferred_workflow: workflowResolution?.workflow?.kind,
            target_step_id: targetStepId,
            formula_answers: formulaAnswers && Object.keys(formulaAnswers).length ? formulaAnswers : undefined,
            formula_value_types: formulaValueTypes && Object.keys(formulaValueTypes).length ? formulaValueTypes : undefined,
            checker_candidate: checkerCandidate,
            max_secret_fragments: 5,
            metasolver_preset: resumeSnapshot.recommendation?.effective_preset || undefined,
            metasolver_mode: resumeSnapshot.recommendation?.mode === 'detect' ? 'detect' : 'decode',
            max_plugins: resumeSnapshot.recommendation?.max_plugins || undefined,
            workflow_control: workflowResolution?.control || undefined,
        };
    }

    protected buildArchiveResolutionDiagnostics(
        context: GeocacheContext,
        resumeSnapshot: PluginExecutorResumeSnapshot,
    ): Record<string, unknown> {
        const workflowResolution = resumeSnapshot.workflowResolution;
        const classification = resumeSnapshot.classification;
        const recommendation = resumeSnapshot.recommendation;

        return {
            source: 'plugin_executor_metasolver',
            schema_version: 2,
            updated_at: resumeSnapshot.updatedAt || new Date().toISOString(),
            geocache: {
                geocache_id: context.geocacheId,
                gc_code: context.gcCode,
                name: context.name,
            },
            current_text: truncateArchiveText(resumeSnapshot.currentText || context.description || '', 1200),
            workflow_resolution: workflowResolution ? {
                primary: {
                    kind: workflowResolution.workflow.kind,
                    confidence: workflowResolution.workflow.confidence,
                    score: workflowResolution.workflow.score,
                    reason: workflowResolution.workflow.reason,
                    forced: workflowResolution.workflow.forced || false,
                },
                candidates: workflowResolution.workflow_candidates.slice(0, 4).map(candidate => ({
                    kind: candidate.kind,
                    confidence: candidate.confidence,
                    score: candidate.score,
                    reason: candidate.reason,
                    supporting_labels: candidate.supporting_labels,
                })),
                explanation: workflowResolution.explanation.slice(0, 4),
                next_actions: workflowResolution.next_actions.slice(0, 6),
                plan: workflowResolution.plan.slice(0, 6).map(step => ({
                    id: step.id,
                    title: step.title,
                    status: step.status,
                    automated: step.automated,
                    tool: step.tool,
                    detail: step.detail,
                })),
                execution: workflowResolution.execution,
            } : null,
            classification,
            labels: classification?.labels.map(label => ({
                name: label.name,
                confidence: label.confidence,
                evidence: label.evidence.slice(0, 3),
            })) || [],
            recommended_actions: classification?.recommended_actions.slice(0, 4) || [],
            formula_signals: classification?.formula_signals.slice(0, 4) || [],
            hidden_signals: classification?.hidden_signals.slice(0, 4) || [],
            secret_fragments: classification?.candidate_secret_fragments.slice(0, 3).map(fragment => ({
                text: truncateArchiveText(fragment.text, 160),
                source: fragment.source,
                confidence: fragment.confidence,
                evidence: fragment.evidence.slice(0, 2),
            })) || [],
            metasolver: recommendation ? {
                requested_preset: recommendation.requested_preset || null,
                preset: recommendation.effective_preset,
                preset_label: recommendation.effective_preset_label,
                mode: recommendation.mode,
                max_plugins: recommendation.max_plugins,
                signature: recommendation.signature,
                selected_plugins: recommendation.selected_plugins.slice(0, 8),
                plugin_list: recommendation.plugin_list,
                explanation: recommendation.explanation?.slice(0, 4) || [],
                top_recommendations: recommendation.recommendations.slice(0, 5).map(item => ({
                    name: item.name,
                    confidence: item.confidence,
                    score: item.score,
                    reasons: item.reasons.slice(0, 3),
                })),
                recommendation_source_text: truncateArchiveText(resumeSnapshot.recommendationSourceText, 800),
            } : null,
            workflow: (resumeSnapshot.workflowEntries || []).slice(0, 8).map(entry => ({
                category: entry.category,
                message: entry.message,
                detail: entry.detail,
                timestamp: entry.timestamp,
            })),
            resume_state: {
                updatedAt: resumeSnapshot.updatedAt,
                currentText: resumeSnapshot.currentText,
                recommendationSourceText: resumeSnapshot.recommendationSourceText,
                classification: resumeSnapshot.classification,
                recommendation: resumeSnapshot.recommendation,
                workflowResolution: resumeSnapshot.workflowResolution,
                workflowEntries: resumeSnapshot.workflowEntries,
            },
        };
    }

    protected buildReplayWorkflowLog(
        resumeSnapshot: PluginExecutorResumeSnapshot,
        response: ResolutionWorkflowStepRunResponse,
        fallbackStepTitle?: string,
    ): ArchiveWorkflowLogEntry[] {
        let category: ArchiveWorkflowLogEntry['category'] = 'execute';
        let message = '';
        let detail = '';

        if (response.status !== 'success') {
            category = 'archive';
            message = `Etape non rejouee depuis l archive: ${fallbackStepTitle || response.step?.title || response.executed_step || 'workflow'}`;
            detail = response.message;
            return prependArchiveWorkflowEntry(resumeSnapshot.workflowEntries, category, message, detail);
        }

        if (response.executed_step === 'execute-metasolver') {
            category = 'secret';
            message = 'Metasolver rejoue depuis l archive';
            detail = String(response.result?.metasolver_result?.summary || response.message || '').trim();
        } else if (response.executed_step === 'search-answers') {
            category = 'formula';
            message = 'Recherche web rejouee depuis l archive';
            detail = response.message;
        } else if (response.executed_step === 'calculate-final-coordinates') {
            category = 'formula';
            message = 'Coordonnees recalculees depuis l archive';
            detail = String(
                response.result?.coordinates?.ddm
                || response.result?.coordinates?.decimal
                || response.message
                || ''
            ).trim();
        } else if (response.executed_step === 'validate-with-checker') {
            category = 'execute';
            message = 'Validation checker rejouee depuis l archive';
            detail = String(
                response.result?.result?.message
                || response.result?.message
                || response.message
                || ''
            ).trim();
        } else {
            message = `Etape rejouee depuis l archive: ${response.executed_step || fallbackStepTitle || 'workflow'}`;
            detail = response.message;
        }

        return prependArchiveWorkflowEntry(resumeSnapshot.workflowEntries, category, message, truncateArchiveText(detail, 160));
    }

    protected async persistArchiveResolutionDiagnostics(gcCode: string, diagnostics: Record<string, unknown>): Promise<void> {
        const response = await fetch(`${this.backendBaseUrl}/api/archive/${encodeURIComponent(gcCode)}/resolution-diagnostics`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(diagnostics),
        });
        if (!response.ok) {
            const payload = await response.json().catch(() => ({}));
            throw new Error(payload?.message || payload?.error || `HTTP ${response.status}`);
        }
    }

    protected async replayHistoryEntry(entry: ArchiveHistoryEntry, index: number, targetStepId?: string): Promise<void> {
        const archive = this.selectedArchive;
        const resumeSnapshot = entry.resume_state || null;
        if (!archive || !resumeSnapshot) {
            this.messages.warn('Aucun snapshot exploitable pour cette tentative.');
            return;
        }

        const replayableSteps = this.getReplayableSteps(resumeSnapshot);
        const nextStep = targetStepId
            ? replayableSteps.find(step => step.id === targetStepId) || null
            : this.getNextReplayableStep(resumeSnapshot);
        if (!nextStep) {
            this.messages.warn('Aucune etape backend rejouable pour cette tentative.');
            return;
        }

        const historyEntryKey = this.getHistoryEntryKey(entry, index);
        this.replayingHistoryEntryKey = historyEntryKey;
        this.update();

        let liveGeocache: GeocacheApiResponse | null = null;
        let usedArchiveFallback = false;

        try {
            try {
                liveGeocache = await this.fetchLiveGeocache(archive.gc_code);
                usedArchiveFallback = !liveGeocache;
            } catch (fetchError) {
                usedArchiveFallback = true;
                console.warn('[ArchiveManagerWidget] replayHistoryEntry live geocache fetch failed', fetchError);
            }

            const context = this.buildPluginExecutorContext(archive, entry, resumeSnapshot, liveGeocache);
            const requestBody = this.buildReplayRequest(context, resumeSnapshot, nextStep.id, liveGeocache);
            const response = await fetch(`${this.backendBaseUrl}/api/plugins/workflow/run-next-step`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify(requestBody),
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(payload?.message || payload?.error || `HTTP ${response.status}`);
            }

            const stepResponse = payload as ResolutionWorkflowStepRunResponse;
            const updatedRecommendation = stepResponse.workflow_resolution.execution.secret_code?.recommendation
                || resumeSnapshot.recommendation
                || null;
            const updatedSourceText = String(
                stepResponse.workflow_resolution.execution.secret_code?.selected_fragment?.text
                || resumeSnapshot.recommendationSourceText
                || ''
            ).trim();
            const updatedSnapshot: PluginExecutorResumeSnapshot = {
                updatedAt: new Date().toISOString(),
                currentText: resumeSnapshot.currentText || context.description || '',
                recommendationSourceText: updatedSourceText,
                classification: stepResponse.workflow_resolution.classification || resumeSnapshot.classification,
                recommendation: updatedRecommendation,
                workflowResolution: stepResponse.workflow_resolution,
                workflowEntries: this.buildReplayWorkflowLog(resumeSnapshot, stepResponse, nextStep.title),
            };

            await this.persistArchiveResolutionDiagnostics(
                context.gcCode,
                this.buildArchiveResolutionDiagnostics(context, updatedSnapshot),
            );
            await this.loadArchives(true);

            const fallbackMessageSuffix = usedArchiveFallback
                ? ' Contexte live indisponible, rejeu base sur le snapshot archive.'
                : '';
            if (stepResponse.status === 'success') {
                this.messages.info(`${stepResponse.message}${fallbackMessageSuffix}`);
            } else {
                this.messages.warn(`${stepResponse.message}${fallbackMessageSuffix}`);
            }
        } catch (error) {
            console.error('[ArchiveManagerWidget] replayHistoryEntry error', error);
            this.messages.error(`Erreur rejeu tentative : ${String(error)}`);
        } finally {
            this.replayingHistoryEntryKey = null;
            this.update();
        }
    }

    protected toggleAutoSync = async (): Promise<void> => {
        if (!this.settings) { return; }
        const current = this.settings.auto_sync_enabled;

        if (current) {
            // Activation → désactivation : demander double confirmation
            const dialog = new ConfirmDialog({
                title: '⚠️ Désactiver l\'archivage automatique',
                msg: [
                    '⚠️ ATTENTION : Action non recommandée.',
                    '',
                    'Désactiver l\'archivage automatique signifie que les données de résolution',
                    '(statut, coordonnées corrigées, notes, waypoints) ne seront PLUS sauvegardées',
                    'automatiquement. En cas de suppression d\'une géocache, ces données seront perdues.',
                    '',
                    'Le snapshot avant suppression restera actif comme filet de sécurité minimal.',
                    '',
                    'Êtes-vous sûr de vouloir désactiver cette protection ?',
                ].join('\n'),
                ok: 'Désactiver quand même',
                cancel: 'Annuler',
            });
            const confirmed = await dialog.open();
            if (!confirmed) { return; }
        }

        this.isSaving = true;
        this.update();
        try {
            const res = await fetch(`${this.backendBaseUrl}/api/archive/settings`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ auto_sync_enabled: !current }),
            });
            if (!res.ok) { throw new Error(`HTTP ${res.status}`); }
            const json = await res.json();
            this.settings = { auto_sync_enabled: json.auto_sync_enabled };
            if (json.warning) {
                this.messages.warn(json.warning);
            } else {
                this.messages.info('Archivage automatique activé.');
            }
        } catch (e) {
            this.messages.error(`Erreur: ${String(e)}`);
        } finally {
            this.isSaving = false;
            this.update();
        }
    };

    protected getBulkPreviewLabel(): string {
        switch (this.bulkFilter) {
            case 'all': return 'TOUTES les archives (irréversible)';
            case 'by_status': return `Archives avec statut "${this.bulkStatus}"`;
            case 'orphaned': return 'Archives dont la géocache n\'existe plus en base';
            case 'before_date': return this.bulkBeforeDate ? `Archives antérieures au ${this.bulkBeforeDate}` : 'Archives (date non définie)';
        }
    }

    protected executeBulkDelete = async (): Promise<void> => {
        if (this.bulkFilter === 'before_date' && !this.bulkBeforeDate) {
            this.messages.warn('Veuillez saisir une date avant de continuer.');
            return;
        }

        // Première confirmation
        const step1 = new ConfirmDialog({
            title: '⚠️ Suppression en masse — Étape 1/2',
            msg: [
                '⚠️ ATTENTION : Cette opération est IRRÉVERSIBLE.',
                '',
                `Vous allez supprimer : ${this.getBulkPreviewLabel()}`,
                '',
                'Les données supprimées NE PEUVENT PAS être récupérées.',
                'Souhaitez-vous continuer ?',
            ].join('\n'),
            ok: 'Continuer vers la confirmation finale',
            cancel: 'Annuler',
        });
        const ok1 = await step1.open();
        if (!ok1) { return; }

        // Deuxième confirmation
        const step2 = new ConfirmDialog({
            title: '🚨 Suppression en masse — Confirmation finale',
            msg: [
                '🚨 DERNIÈRE CHANCE : Confirmez-vous la suppression irréversible ?',
                '',
                `Cible : ${this.getBulkPreviewLabel()}`,
                '',
                'Cliquer sur "Supprimer définitivement" lancera immédiatement l\'opération.',
            ].join('\n'),
            ok: 'Supprimer définitivement',
            cancel: 'Annuler',
        });
        const ok2 = await step2.open();
        if (!ok2) { return; }

        this.isDeleting = true;
        this.lastActionResult = null;
        this.lastActionError = null;
        this.update();

        try {
            const body: Record<string, unknown> = {
                confirm: true,
                filter: this.bulkFilter,
            };
            if (this.bulkFilter === 'by_status') { body['status'] = this.bulkStatus; }
            if (this.bulkFilter === 'before_date') { body['before_date'] = this.bulkBeforeDate; }

            const res = await fetch(`${this.backendBaseUrl}/api/archive`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify(body),
            });

            const json = await res.json();

            if (!res.ok) {
                throw new Error(json.error || `HTTP ${res.status}`);
            }

            this.lastActionResult = `✅ ${json.deleted} entrée(s) supprimée(s).`;
            this.messages.info(`Archive : ${json.deleted} entrée(s) supprimée(s).`);
            await this.loadData();
        } catch (e) {
            this.lastActionError = `Erreur : ${String(e)}`;
            this.messages.error(`Erreur suppression archive : ${String(e)}`);
        } finally {
            this.isDeleting = false;
            this.update();
        }
    };

    protected render(): React.ReactNode {
        const autoSync = this.settings?.auto_sync_enabled ?? true;
        const selectedArchive = this.selectedArchive;
        const historyEntries = this.getHistoryEntries(selectedArchive);
        const primaryWorkflow = selectedArchive?.resolution_diagnostics?.workflow_resolution?.primary;

        return (
            <div style={{ padding: 16, display: 'grid', gap: 16, maxWidth: 1180 }}>
                <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                    🗄️ Gestionnaire d'Archive
                    <button
                        className='theia-button secondary'
                        onClick={() => this.loadData()}
                        disabled={this.isLoading}
                        style={{ fontSize: 12, padding: '3px 10px', marginLeft: 8 }}
                        title='Rafraîchir les statistiques'
                    >
                        {this.isLoading ? '⏳' : '🔄'} Rafraîchir
                    </button>
                </h2>

                {/* Section Statistiques */}
                <div style={{
                    background: 'var(--theia-editor-background)',
                    border: '1px solid var(--theia-panel-border)',
                    borderRadius: 6,
                    padding: 16,
                }}>
                    <h4 style={{ margin: '0 0 12px 0' }}>📊 Statistiques de l'archive</h4>
                    {this.isLoading ? (
                        <div style={{ opacity: 0.7 }}>Chargement…</div>
                    ) : this.stats ? (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
                            {[
                                { label: 'Total archivées', value: this.stats.total_archived, color: '#60a5fa' },
                                { label: 'Résolues', value: this.stats.solved, color: '#10b981' },
                                { label: 'En cours', value: this.stats.in_progress, color: '#f59e0b' },
                                { label: 'Trouvées', value: this.stats.found, color: '#a78bfa' },
                            ].map(({ label, value, color }) => (
                                <div key={label} style={{
                                    textAlign: 'center',
                                    background: 'var(--theia-sideBar-background)',
                                    borderRadius: 4,
                                    padding: 8,
                                }}>
                                    <div style={{ fontSize: 22, fontWeight: 'bold', color }}>{value}</div>
                                    <div style={{ fontSize: 11, opacity: 0.7 }}>{label}</div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div style={{ opacity: 0.7 }}>Aucune donnée disponible.</div>
                    )}
                </div>

                {/* Section Préférence auto-sync */}
                <div style={{
                    background: 'var(--theia-editor-background)',
                    border: `1px solid ${autoSync ? 'var(--theia-panel-border)' : '#f59e0b'}`,
                    borderRadius: 6,
                    padding: 16,
                }}>
                    <h4 style={{ margin: '0 0 8px 0' }}>⚙️ Archivage automatique</h4>

                    {!autoSync && (
                        <div style={{
                            background: '#92400e22',
                            border: '1px solid #f59e0b',
                            borderRadius: 4,
                            padding: '8px 12px',
                            marginBottom: 12,
                            fontSize: 12,
                            color: '#fbbf24',
                        }}>
                            ⚠️ <strong>Archivage automatique désactivé.</strong> Les données de résolution ne sont plus sauvegardées automatiquement. Le snapshot avant suppression reste actif.
                        </div>
                    )}

                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <div>
                            <div style={{ fontWeight: 'bold', fontSize: 13 }}>
                                {autoSync ? '✅ Activé (recommandé)' : '⛔ Désactivé (non recommandé)'}
                            </div>
                            <div style={{ fontSize: 11, opacity: 0.7, marginTop: 4, maxWidth: 480 }}>
                                Synchronise automatiquement l'archive lors des changements d'état (statut, coordonnées, notes, waypoints).
                                Le snapshot avant suppression reste toujours actif.
                            </div>
                        </div>
                        <button
                            className={`theia-button ${autoSync ? 'secondary' : ''}`}
                            onClick={this.toggleAutoSync}
                            disabled={this.isSaving}
                            style={{ fontSize: 12, padding: '6px 14px', whiteSpace: 'nowrap' }}
                        >
                            {this.isSaving ? '⏳ …' : autoSync ? '⚠️ Désactiver' : '✅ Activer'}
                        </button>
                    </div>
                </div>

                <div style={{
                    background: 'var(--theia-editor-background)',
                    border: '1px solid var(--theia-panel-border)',
                    borderRadius: 6,
                    padding: 16,
                }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                        <div>
                            <h4 style={{ margin: 0 }}>🧭 Tentatives archivées</h4>
                            <div style={{ fontSize: 11, opacity: 0.7, marginTop: 4 }}>
                                Visualise les snapshots de diagnostic et l'historique multi-tentatives.
                            </div>
                        </div>
                        <div style={{ fontSize: 11, opacity: 0.7 }}>
                            {this.archiveTotal} archive(s)
                        </div>
                    </div>

                    <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
                        <input
                            type='text'
                            value={this.archiveSearch}
                            onChange={e => { this.archiveSearch = e.target.value; this.update(); }}
                            placeholder='Filtrer par GC code'
                            style={{
                                background: 'var(--theia-input-background)',
                                color: 'var(--theia-input-foreground)',
                                border: '1px solid var(--theia-panel-border)',
                                borderRadius: 4,
                                padding: '6px 8px',
                                fontSize: 12,
                                minWidth: 180,
                            }}
                        />
                        <select
                            value={this.archiveStatusFilter}
                            onChange={e => { this.archiveStatusFilter = e.target.value; this.archivesPage = 1; this.update(); }}
                            style={{
                                background: 'var(--theia-input-background)',
                                color: 'var(--theia-input-foreground)',
                                border: '1px solid var(--theia-panel-border)',
                                borderRadius: 4,
                                padding: '6px 8px',
                                fontSize: 12,
                                minWidth: 180,
                            }}
                        >
                            {ARCHIVE_STATUS_FILTER_OPTIONS.map(option => (
                                <option key={option.value || 'all'} value={option.value}>{option.label}</option>
                            ))}
                        </select>
                        <button
                            className='theia-button secondary'
                            onClick={() => { void this.loadArchives(false); }}
                            disabled={this.isLoadingArchives}
                        >
                            {this.isLoadingArchives ? '⏳ Chargement…' : '🔎 Charger'}
                        </button>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '340px minmax(0, 1fr)', gap: 16 }}>
                        <div style={{
                            border: '1px solid var(--theia-panel-border)',
                            borderRadius: 6,
                            overflow: 'hidden',
                            minHeight: 280,
                        }}>
                            <div style={{
                                display: 'grid',
                                gap: 1,
                                background: 'var(--theia-panel-border)',
                            }}>
                                {this.archives.length === 0 ? (
                                    <div style={{
                                        background: 'var(--theia-editor-background)',
                                        padding: 12,
                                        fontSize: 12,
                                        opacity: 0.7,
                                    }}>
                                        {this.isLoadingArchives ? 'Chargement des archives…' : 'Aucune archive trouvée pour ce filtre.'}
                                    </div>
                                ) : this.archives.map(entry => {
                                    const isSelected = entry.gc_code === this.selectedArchiveGcCode;
                                    const historyCount = entry.resolution_diagnostics?.history_state?.length || (entry.resolution_diagnostics?.resume_state ? 1 : 0);
                                    const archiveSummary = this.getArchiveListSummary(entry);
                                    return (
                                        <button
                                            key={entry.gc_code}
                                            type='button'
                                            onClick={() => { void this.loadArchiveDetails(entry.gc_code); }}
                                            style={{
                                                textAlign: 'left',
                                                background: isSelected ? 'var(--theia-list-activeSelectionBackground)' : 'var(--theia-editor-background)',
                                                color: 'inherit',
                                                border: 'none',
                                                padding: '10px 12px',
                                                cursor: 'pointer',
                                                display: 'grid',
                                                gap: 4,
                                            }}
                                        >
                                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                                                <strong>{entry.gc_code}</strong>
                                                <span style={{ fontSize: 10, opacity: 0.7 }}>{entry.solved_status || 'unknown'}</span>
                                            </div>
                                            <div style={{ fontSize: 12 }}>
                                                {truncateArchiveText(entry.name || 'Sans nom', 56)}
                                            </div>
                                            <div style={{ fontSize: 11, opacity: 0.72 }}>
                                                {historyCount} tentative(s) · {formatArchiveDate(entry.updated_at)}
                                            </div>
                                            {archiveSummary?.meta ? (
                                                <div style={{ fontSize: 10, opacity: 0.76 }}>
                                                    {archiveSummary.meta}
                                                </div>
                                            ) : null}
                                            {archiveSummary?.eventText ? (
                                                <div style={{ fontSize: 11, opacity: 0.82 }}>
                                                    <strong>{archiveSummary.eventLabel}:</strong> {archiveSummary.eventText}
                                                </div>
                                            ) : null}
                                        </button>
                                    );
                                })}
                            </div>

                            <div style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                padding: '8px 10px',
                                borderTop: '1px solid var(--theia-panel-border)',
                                fontSize: 11,
                            }}>
                                <button
                                    className='theia-button secondary'
                                    disabled={this.archivesPage <= 1 || this.isLoadingArchives}
                                    onClick={() => {
                                        this.archivesPage = Math.max(1, this.archivesPage - 1);
                                        void this.loadArchives(true);
                                    }}
                                >
                                    ← Précédent
                                </button>
                                <span>Page {this.archivesPage}/{this.archivePages}</span>
                                <button
                                    className='theia-button secondary'
                                    disabled={this.archivesPage >= this.archivePages || this.isLoadingArchives}
                                    onClick={() => {
                                        this.archivesPage = Math.min(this.archivePages, this.archivesPage + 1);
                                        void this.loadArchives(true);
                                    }}
                                >
                                    Suivant →
                                </button>
                            </div>
                        </div>

                        <div style={{
                            border: '1px solid var(--theia-panel-border)',
                            borderRadius: 6,
                            padding: 14,
                            minHeight: 280,
                            background: 'var(--theia-editor-background)',
                        }}>
                            {!selectedArchive ? (
                                <div style={{ opacity: 0.7, fontSize: 12 }}>
                                    Sélectionnez une archive pour afficher son diagnostic et son historique.
                                </div>
                            ) : (
                                <div style={{ display: 'grid', gap: 12 }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
                                        <div>
                                            <div style={{ fontSize: 18, fontWeight: 700 }}>{selectedArchive.gc_code}</div>
                                            <div style={{ fontSize: 13, marginTop: 4 }}>
                                                {selectedArchive.name || 'Sans nom'}
                                            </div>
                                            <div style={{ fontSize: 11, opacity: 0.72, marginTop: 4 }}>
                                                Mis à jour le {formatArchiveDate(selectedArchive.updated_at)}
                                                {selectedArchive.cache_type ? ` · ${selectedArchive.cache_type}` : ''}
                                                {selectedArchive.resolution_method ? ` · méthode ${selectedArchive.resolution_method}` : ''}
                                            </div>
                                        </div>
                                        <button
                                            className='theia-button secondary'
                                            onClick={() => { void this.loadArchiveDetails(selectedArchive.gc_code); }}
                                            disabled={this.isLoadingArchiveDetails}
                                        >
                                            {this.isLoadingArchiveDetails ? '⏳ Détail…' : '🔄 Recharger le détail'}
                                        </button>
                                    </div>

                                    <div style={{
                                        display: 'grid',
                                        gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                                        gap: 10,
                                    }}>
                                        <div style={{ padding: '8px 10px', borderRadius: 4, background: 'var(--theia-sideBar-background)' }}>
                                            <div style={{ fontSize: 10, opacity: 0.7 }}>Workflow courant</div>
                                            <div style={{ marginTop: 3, fontWeight: 600 }}>
                                                {WORKFLOW_KIND_LABELS[primaryWorkflow?.kind || ''] || primaryWorkflow?.kind || 'Inconnu'}
                                            </div>
                                        </div>
                                        <div style={{ padding: '8px 10px', borderRadius: 4, background: 'var(--theia-sideBar-background)' }}>
                                            <div style={{ fontSize: 10, opacity: 0.7 }}>Confiance workflow</div>
                                            <div style={{ marginTop: 3, fontWeight: 600 }}>
                                                {typeof primaryWorkflow?.confidence === 'number' ? `${(primaryWorkflow.confidence * 100).toFixed(0)}%` : 'n/a'}
                                            </div>
                                        </div>
                                        <div style={{ padding: '8px 10px', borderRadius: 4, background: 'var(--theia-sideBar-background)' }}>
                                            <div style={{ fontSize: 10, opacity: 0.7 }}>Tentatives archivées</div>
                                            <div style={{ marginTop: 3, fontWeight: 600 }}>{historyEntries.length}</div>
                                        </div>
                                    </div>

                                    {selectedArchive.resolution_diagnostics?.current_text ? (
                                        <div style={{
                                            padding: '10px 12px',
                                            border: '1px solid var(--theia-panel-border)',
                                            borderRadius: 4,
                                            background: 'var(--theia-input-background)',
                                        }}>
                                            <div style={{ fontSize: 11, opacity: 0.7, marginBottom: 4 }}>Snapshot courant</div>
                                            <div style={{ fontSize: 12 }}>
                                                {truncateArchiveText(selectedArchive.resolution_diagnostics.current_text, 260)}
                                            </div>
                                        </div>
                                    ) : null}

                                    <div>
                                        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
                                            Historique des tentatives
                                        </div>
                                        {historyEntries.length === 0 ? (
                                            <div style={{ fontSize: 12, opacity: 0.7 }}>
                                                Aucun historique de tentative disponible pour cette archive.
                                            </div>
                                        ) : (
                                            <div style={{ display: 'grid', gap: 10 }}>
                                                {historyEntries.map((entry, index) => {
                                                    const historyEntryKey = this.getHistoryEntryKey(entry, index);
                                                    const isRestoring = this.restoringHistoryEntryKey === historyEntryKey;
                                                    const isReplaying = this.replayingHistoryEntryKey === historyEntryKey;
                                                    const replayableSteps = entry.resume_state
                                                        ? this.getReplayableSteps(entry.resume_state)
                                                        : [];
                                                    const defaultReplayableStep = entry.resume_state
                                                        ? this.getNextReplayableStep(entry.resume_state)
                                                        : null;
                                                    const selectedReplayStepId = this.replayStepSelections[historyEntryKey]
                                                        || defaultReplayableStep?.id
                                                        || replayableSteps[0]?.id
                                                        || '';
                                                    const replayableStep = replayableSteps.find(step => step.id === selectedReplayStepId)
                                                        || defaultReplayableStep
                                                        || null;
                                                    const canReplay = Boolean(
                                                        replayableStep
                                                        && entry.resume_state?.workflowResolution?.control?.status !== 'budget_exhausted'
                                                        && entry.resume_state?.workflowResolution?.control?.status !== 'stopped'
                                                    );
                                                    return (
                                                        <div
                                                            key={historyEntryKey}
                                                            style={{
                                                                border: '1px solid var(--theia-panel-border)',
                                                                borderRadius: 6,
                                                                padding: '10px 12px',
                                                                background: index === 0
                                                                    ? 'var(--theia-list-activeSelectionBackground)'
                                                                    : 'var(--theia-input-background)',
                                                            }}
                                                        >
                                                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}>
                                                                <div style={{ fontWeight: 600 }}>
                                                                    {WORKFLOW_KIND_LABELS[entry.workflow_kind || ''] || entry.workflow_kind || 'Workflow inconnu'}
                                                                    {index === 0 ? ' - courant' : ''}
                                                                </div>
                                                                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                                                                    <div style={{ fontSize: 11, opacity: 0.72 }}>
                                                                        {formatArchiveDate(entry.recorded_at)}
                                                                    </div>
                                                                    <button
                                                                        className='theia-button secondary'
                                                                        disabled={!entry.resume_state || isRestoring}
                                                                        onClick={() => { void this.restoreHistoryEntry(entry, index); }}
                                                                        style={{ fontSize: 11, padding: '3px 8px' }}
                                                                        title={entry.resume_state
                                                                            ? 'Ouvrir cette tentative dans le Plugin Executor'
                                                                            : 'Aucun resume_state disponible pour cette tentative'}
                                                                    >
                                                                        {isRestoring ? 'Restauration...' : 'Restaurer'}
                                                                    </button>
                                                                    <select
                                                                        value={selectedReplayStepId}
                                                                        disabled={replayableSteps.length === 0 || isReplaying}
                                                                        onChange={event => {
                                                                            this.replayStepSelections[historyEntryKey] = event.target.value;
                                                                            this.update();
                                                                        }}
                                                                        style={{
                                                                            background: 'var(--theia-input-background)',
                                                                            color: 'var(--theia-input-foreground)',
                                                                            border: '1px solid var(--theia-panel-border)',
                                                                            borderRadius: 4,
                                                                            padding: '3px 6px',
                                                                            fontSize: 11,
                                                                            maxWidth: 220,
                                                                        }}
                                                                        title='Etape backend a rejouer'
                                                                    >
                                                                        {replayableSteps.length === 0 ? (
                                                                            <option value=''>Aucune etape</option>
                                                                        ) : replayableSteps.map(step => (
                                                                            <option key={step.id} value={step.id}>
                                                                                {`${step.title || step.id}${step.status ? ` [${step.status}]` : ''}`}
                                                                            </option>
                                                                        ))}
                                                                    </select>
                                                                    <button
                                                                        className='theia-button secondary'
                                                                        disabled={!canReplay || isReplaying}
                                                                        onClick={() => { void this.replayHistoryEntry(entry, index, selectedReplayStepId || undefined); }}
                                                                        style={{ fontSize: 11, padding: '3px 8px' }}
                                                                        title={canReplay
                                                                            ? `Rejouer l'etape: ${replayableStep?.title || replayableStep?.id || 'workflow'}`
                                                                            : (entry.resume_state?.workflowResolution?.control?.summary || 'Aucune etape backend rejouable')}
                                                                    >
                                                                        {isReplaying ? 'Rejeu...' : 'Rejouer'}
                                                                    </button>
                                                                </div>
                                                            </div>
                                                            <div style={{ marginTop: 4, fontSize: 11, opacity: 0.76 }}>
                                                                {entry.control_status ? `${CONTROL_STATUS_LABELS[entry.control_status] || entry.control_status} | ` : ''}
                                                                {typeof entry.final_confidence === 'number' ? `confiance finale ${(entry.final_confidence * 100).toFixed(0)}%` : ''}
                                                                {typeof entry.workflow_confidence === 'number' ? ` | workflow ${(entry.workflow_confidence * 100).toFixed(0)}%` : ''}
                                                            </div>
                                                            {replayableStep ? (
                                                                <div style={{ marginTop: 6, fontSize: 11, opacity: 0.72 }}>
                                                                    Etape backend selectionnee : {replayableStep.title || replayableStep.id}
                                                                </div>
                                                            ) : null}
                                                            {entry.latest_event?.message ? (
                                                                <div style={{ marginTop: 6, fontSize: 12 }}>
                                                                    <strong>{entry.latest_event.message}</strong>
                                                                    {entry.latest_event.detail ? ` | ${truncateArchiveText(entry.latest_event.detail, 120)}` : ''}
                                                                </div>
                                                            ) : null}
                                                            {entry.current_text ? (
                                                                <div style={{ marginTop: 6, fontSize: 12, opacity: 0.84 }}>
                                                                    {truncateArchiveText(entry.current_text, 220)}
                                                                </div>
                                                            ) : null}
                                                            {entry.recommendation_source_text ? (
                                                                <div style={{ marginTop: 6, fontSize: 11, opacity: 0.72 }}>
                                                                    Source recommandation : {truncateArchiveText(entry.recommendation_source_text, 140)}
                                                                </div>
                                                            ) : null}
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* Section Suppression en masse */}
                <div style={{
                    background: 'var(--theia-editor-background)',
                    border: '1px solid #ef444466',
                    borderRadius: 6,
                    padding: 16,
                }}>
                    <h4 style={{ margin: '0 0 4px 0', color: '#f87171' }}>🗑️ Suppression en masse</h4>
                    <p style={{ fontSize: 11, opacity: 0.7, margin: '0 0 14px 0' }}>
                        ⚠️ Opération <strong>irréversible</strong>. Une double confirmation sera demandée. Les données supprimées ne pourront pas être récupérées.
                    </p>

                    <div style={{ display: 'grid', gap: 10 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <label style={{ fontSize: 12, minWidth: 80 }}>Cible :</label>
                            <select
                                value={this.bulkFilter}
                                onChange={e => { this.bulkFilter = e.target.value as BulkFilter; this.update(); }}
                                style={{
                                    background: 'var(--theia-input-background)',
                                    color: 'var(--theia-input-foreground)',
                                    border: '1px solid var(--theia-panel-border)',
                                    borderRadius: 4,
                                    padding: '4px 8px',
                                    fontSize: 12,
                                    flex: 1,
                                }}
                            >
                                {(Object.entries(BULK_FILTER_LABELS) as [BulkFilter, string][]).map(([key, label]) => (
                                    <option key={key} value={key}>{label}</option>
                                ))}
                            </select>
                        </div>

                        {this.bulkFilter === 'by_status' && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                <label style={{ fontSize: 12, minWidth: 80 }}>Statut :</label>
                                <select
                                    value={this.bulkStatus}
                                    onChange={e => { this.bulkStatus = e.target.value; this.update(); }}
                                    style={{
                                        background: 'var(--theia-input-background)',
                                        color: 'var(--theia-input-foreground)',
                                        border: '1px solid var(--theia-panel-border)',
                                        borderRadius: 4,
                                        padding: '4px 8px',
                                        fontSize: 12,
                                        flex: 1,
                                    }}
                                >
                                    {STATUS_OPTIONS.map(o => (
                                        <option key={o.value} value={o.value}>{o.label}</option>
                                    ))}
                                </select>
                            </div>
                        )}

                        {this.bulkFilter === 'before_date' && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                <label style={{ fontSize: 12, minWidth: 80 }}>Avant le :</label>
                                <input
                                    type='date'
                                    value={this.bulkBeforeDate}
                                    onChange={e => { this.bulkBeforeDate = e.target.value; this.update(); }}
                                    style={{
                                        background: 'var(--theia-input-background)',
                                        color: 'var(--theia-input-foreground)',
                                        border: '1px solid var(--theia-panel-border)',
                                        borderRadius: 4,
                                        padding: '4px 8px',
                                        fontSize: 12,
                                        flex: 1,
                                    }}
                                />
                            </div>
                        )}

                        <div style={{
                            background: '#ef444411',
                            border: '1px solid #ef444444',
                            borderRadius: 4,
                            padding: '6px 10px',
                            fontSize: 11,
                            color: '#fca5a5',
                        }}>
                            Cible sélectionnée : <strong>{this.getBulkPreviewLabel()}</strong>
                        </div>

                        {this.lastActionResult && (
                            <div style={{ fontSize: 12, color: '#10b981', padding: '4px 0' }}>
                                {this.lastActionResult}
                            </div>
                        )}
                        {this.lastActionError && (
                            <div style={{ fontSize: 12, color: '#f87171', padding: '4px 0' }}>
                                {this.lastActionError}
                            </div>
                        )}

                        <div>
                            <button
                                onClick={this.executeBulkDelete}
                                disabled={this.isDeleting || (this.bulkFilter === 'before_date' && !this.bulkBeforeDate)}
                                style={{
                                    background: '#ef4444',
                                    color: 'white',
                                    border: 'none',
                                    borderRadius: 4,
                                    padding: '7px 18px',
                                    fontSize: 12,
                                    cursor: this.isDeleting ? 'wait' : 'pointer',
                                    opacity: this.isDeleting ? 0.6 : 1,
                                }}
                            >
                                {this.isDeleting ? '⏳ Suppression…' : '🗑️ Supprimer (double confirmation)'}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        );
    }
}
