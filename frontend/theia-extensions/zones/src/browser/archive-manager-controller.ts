import { inject, injectable } from '@theia/core/shared/inversify';
import { GeocacheContext, PluginExecutorResumeSnapshot } from '@mysterai/theia-plugins/lib/browser/plugin-executor-widget';
import { ResolutionWorkflowStepRunResponse } from '@mysterai/theia-plugins/lib/common/plugin-protocol';
import { ArchiveManagerService } from './archive-manager-service';
import {
    ArchiveEntry,
    ArchiveHistoryEntry,
    ArchiveListSummary,
    ArchiveWorkflowLogEntry,
    BulkFilter,
    CONTROL_STATUS_LABELS,
    GeocacheApiResponse,
    PrepareArchiveHistoryContextResult,
    ReplayArchiveHistoryResult,
    ReplayableWorkflowStep,
    REPLAYABLE_WORKFLOW_STEP_IDS,
    WORKFLOW_KIND_LABELS,
} from './archive-manager-types';
import {
    formatCheckerCandidateFromCoordinates,
    prependArchiveWorkflowEntry,
    truncateArchiveText
} from './archive-manager-utils';

@injectable()
export class ArchiveManagerController {
    constructor(
        @inject(ArchiveManagerService) protected readonly archiveManagerService: ArchiveManagerService
    ) {}

    getHistoryEntries(entry: ArchiveEntry | null): ArchiveHistoryEntry[] {
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
                final_confidence: diagnostics.resume_state.workflowResolution?.control?.final_confidence,
                control_status: diagnostics.resume_state.workflowResolution?.control?.status,
                current_text: diagnostics.resume_state.currentText || diagnostics.current_text,
                latest_event: Array.isArray(diagnostics.resume_state.workflowEntries) && diagnostics.resume_state.workflowEntries[0]
                    ? diagnostics.resume_state.workflowEntries[0]
                    : null,
                resume_state: diagnostics.resume_state,
            }];
        }
        return [];
    }

    getHistoryEntryKey(entry: ArchiveHistoryEntry, index: number): string {
        return entry.entry_id || `${entry.recorded_at || 'entry'}-${index}`;
    }

    getArchiveListSummary(entry: ArchiveEntry): ArchiveListSummary | null {
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

    getReplayableSteps(resumeSnapshot: PluginExecutorResumeSnapshot): ReplayableWorkflowStep[] {
        const plan = resumeSnapshot.workflowResolution?.plan || [];
        const steps: ReplayableWorkflowStep[] = [];
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

    getNextReplayableStep(resumeSnapshot: PluginExecutorResumeSnapshot): ReplayableWorkflowStep | null {
        const replayableSteps = this.getReplayableSteps(resumeSnapshot);
        return replayableSteps.find(step => step.status === 'planned')
            || replayableSteps[0]
            || null;
    }

    getBulkPreviewLabel(filter: BulkFilter, bulkStatus: string, bulkBeforeDate: string): string {
        switch (filter) {
            case 'all':
                return 'TOUTES les archives (irreversible)';
            case 'by_status':
                return `Archives avec statut "${bulkStatus}"`;
            case 'orphaned':
                return 'Archives dont la geocache n\'existe plus en base';
            case 'before_date':
                return bulkBeforeDate
                    ? `Archives anterieures au ${bulkBeforeDate}`
                    : 'Archives (date non definie)';
        }
    }

    async prepareHistoryRestoreContext(
        archive: ArchiveEntry,
        historyEntry: ArchiveHistoryEntry
    ): Promise<PrepareArchiveHistoryContextResult> {
        const resumeSnapshot = historyEntry.resume_state || null;
        if (!resumeSnapshot) {
            throw new Error('Aucun snapshot exploitable pour cette tentative.');
        }

        const { geocache, usedArchiveFallback } = await this.loadLiveGeocacheWithFallback(archive.gc_code);
        return {
            context: this.buildPluginExecutorContext(archive, historyEntry, resumeSnapshot, geocache),
            usedArchiveFallback,
        };
    }

    async replayHistoryEntry(
        archive: ArchiveEntry,
        historyEntry: ArchiveHistoryEntry,
        targetStepId?: string
    ): Promise<ReplayArchiveHistoryResult> {
        const resumeSnapshot = historyEntry.resume_state || null;
        if (!resumeSnapshot) {
            throw new Error('Aucun snapshot exploitable pour cette tentative.');
        }

        const replayableSteps = this.getReplayableSteps(resumeSnapshot);
        const nextStep = targetStepId
            ? replayableSteps.find(step => step.id === targetStepId) || null
            : this.getNextReplayableStep(resumeSnapshot);
        if (!nextStep) {
            throw new Error('Aucune etape backend rejouable pour cette tentative.');
        }

        const { geocache, usedArchiveFallback } = await this.loadLiveGeocacheWithFallback(archive.gc_code);
        const context = this.buildPluginExecutorContext(archive, historyEntry, resumeSnapshot, geocache);
        const requestBody = this.buildReplayRequest(context, resumeSnapshot, nextStep.id, geocache);
        const response = await this.archiveManagerService.runWorkflowNextStep(requestBody);
        const updatedSnapshot = this.buildUpdatedSnapshot(context, resumeSnapshot, response, nextStep.title);

        await this.archiveManagerService.updateResolutionDiagnostics(
            context.gcCode,
            this.buildArchiveResolutionDiagnostics(context, updatedSnapshot),
        );

        return {
            context,
            nextStep,
            response,
            updatedSnapshot,
            usedArchiveFallback,
        };
    }

    protected async loadLiveGeocacheWithFallback(gcCode: string): Promise<{
        geocache: GeocacheApiResponse | null;
        usedArchiveFallback: boolean;
    }> {
        try {
            const geocache = await this.archiveManagerService.getLiveGeocacheByCode(gcCode);
            return {
                geocache,
                usedArchiveFallback: !geocache,
            };
        } catch (error) {
            console.warn('[ArchiveManagerController] live geocache fetch failed', error);
            return {
                geocache: null,
                usedArchiveFallback: true,
            };
        }
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

    protected buildUpdatedSnapshot(
        context: GeocacheContext,
        resumeSnapshot: PluginExecutorResumeSnapshot,
        stepResponse: ResolutionWorkflowStepRunResponse,
        fallbackStepTitle?: string
    ): PluginExecutorResumeSnapshot {
        const updatedRecommendation = stepResponse.workflow_resolution.execution.secret_code?.recommendation
            || resumeSnapshot.recommendation
            || null;
        const updatedSourceText = String(
            stepResponse.workflow_resolution.execution.secret_code?.selected_fragment?.text
            || resumeSnapshot.recommendationSourceText
            || ''
        ).trim();

        return {
            updatedAt: new Date().toISOString(),
            currentText: resumeSnapshot.currentText || context.description || '',
            recommendationSourceText: updatedSourceText,
            classification: stepResponse.workflow_resolution.classification || resumeSnapshot.classification,
            recommendation: updatedRecommendation,
            workflowResolution: stepResponse.workflow_resolution,
            workflowEntries: this.buildReplayWorkflowLog(resumeSnapshot, stepResponse, fallbackStepTitle),
        };
    }
}
