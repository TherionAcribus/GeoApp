import * as React from '@theia/core/shared/react';
import { CommandService } from '@theia/core';
import {
    PluginsService,
    ListingClassificationResponse,
    MetasolverEligiblePlugin,
    MetasolverRecommendationResponse,
    MetasolverSignature,
    GeographicPlausibilityAssessment,
    ResolutionPlanStep,
    ResolutionWorkflowKind,
    ResolutionWorkflowResponse
} from '../common/plugin-protocol';
import { PreferenceService } from '@theia/core/lib/common/preferences/preference-service';
import {
    dispatchPluginExecutorGeoAppOpenChatRequest,
    buildPluginExecutorGeoAppOpenChatDetail,
    resolvePluginExecutorGeoAppWorkflowKind,
} from './plugin-executor-geoapp-shared';
import { buildPluginExecutorGeoAppDiagnosticPrompt as buildGeoAppDiagnosticPrompt } from './plugin-executor-diagnostic-shared';
import type { GeocacheContext } from './plugin-executor-widget';

const FORMULA_SOLVER_SOLVE_FROM_GEOCACHE_COMMAND = 'formula-solver:solve-from-geocache';
const GEOAPP_CHAT_DEFAULT_PROFILE_PREF = 'geoApp.chat.defaultProfile';
const GEOAPP_CHAT_SECRET_CODE_PROFILE_PREF = 'geoApp.chat.workflowProfile.secretCode';
const GEOAPP_CHAT_FORMULA_PROFILE_PREF = 'geoApp.chat.workflowProfile.formula';
const GEOAPP_CHAT_CHECKER_PROFILE_PREF = 'geoApp.chat.workflowProfile.checker';
const GEOAPP_CHAT_HIDDEN_CONTENT_PROFILE_PREF = 'geoApp.chat.workflowProfile.hiddenContent';
const GEOAPP_CHAT_IMAGE_PUZZLE_PROFILE_PREF = 'geoApp.chat.workflowProfile.imagePuzzle';
type MetasolverSelectionMode = 'recommended' | 'preset' | 'manual';

const METASOLVER_CHARSET_ICONS: Record<string, string> = {
    letters: 'ABC',
    digits: '123',
    symbols: '#!@',
    words: 'Mot',
    mixed: 'Mix',
};

const parsePluginListValue = (value: string): string[] =>
    value
        .split(',')
        .map(item => item.trim())
        .filter(Boolean);

const buildSignatureBadges = (signature: MetasolverSignature): string[] => {
    const badges: string[] = [
        `Type ${signature.dominant_input_kind}`,
        `${signature.non_space_length} chars`,
        `${signature.group_count} groupe(s)`
    ];

    if (signature.looks_like_morse) {
        badges.push('Morse probable');
    }
    if (signature.looks_like_binary) {
        badges.push('Binaire probable');
    }
    if (signature.looks_like_hex) {
        badges.push('Hex probable');
    }
    if (signature.looks_like_phone_keypad) {
        badges.push('T9 probable');
    }
    if (signature.looks_like_multitap) {
        badges.push('Multitap probable');
    }
    if (signature.looks_like_chemical_symbols) {
        badges.push('Elements chimiques probables');
    }
    if (signature.looks_like_houdini_words) {
        badges.push('Houdini probable');
    }
    if (signature.looks_like_nak_nak) {
        badges.push('Nak Nak probable');
    }
    if (signature.looks_like_shadok) {
        badges.push('Shadok probable');
    }
    if (signature.looks_like_tom_tom) {
        badges.push('Tom Tom probable');
    }
    if (signature.looks_like_gold_bug) {
        badges.push('Gold-Bug probable');
    }
    if (signature.looks_like_postnet) {
        badges.push('POSTNET probable');
    }
    if (signature.looks_like_prime_sequence) {
        badges.push('Nombres premiers probables');
    }
    if (signature.looks_like_roman_numerals) {
        badges.push('Romain probable');
    }
    if (signature.looks_like_polybius) {
        badges.push('Polybe probable');
    }
    if (signature.looks_like_tap_code) {
        badges.push('Tap code probable');
    }
    if (signature.looks_like_bacon) {
        badges.push('Bacon probable');
    }
    if (signature.looks_like_coordinate_fragment) {
        badges.push('Coordonnées possibles');
    }

    return badges;
};

const LISTING_LABEL_TITLES: Record<string, string> = {
    secret_code: 'Code secret',
    hidden_content: 'Contenu cache',
    formula: 'Formule',
    word_game: 'Jeu',
    image_puzzle: 'Image',
    coord_transform: 'Coordonnees',
    checker_available: 'Checker',
};

const WORKFLOW_TITLES: Record<ResolutionWorkflowKind | 'general', string> = {
    general: 'General',
    secret_code: 'Code secret',
    formula: 'Formule',
    checker: 'Checker',
    hidden_content: 'Contenu cache',
    image_puzzle: 'Image',
    coord_transform: 'Coordonnees',
};

const PLAN_STATUS_LABELS: Record<ResolutionPlanStep['status'], string> = {
    planned: 'Planifie',
    completed: 'Pret',
    blocked: 'Bloque',
    skipped: 'Ignore',
};

const WORKFLOW_CONTROL_STATUS_LABELS: Record<ResolutionWorkflowResponse['control']['status'], string> = {
    ready: 'Pret',
    awaiting_input: 'Attente saisie',
    budget_exhausted: 'Budget epuise',
    stopped: 'Arrete',
    completed: 'Termine',
};

const GEO_PLAUSIBILITY_LABELS: Record<GeographicPlausibilityAssessment['status'], string> = {
    very_plausible: 'Tres plausible',
    plausible: 'Plausible',
    uncertain: 'A verifier',
    unlikely: 'Peu plausible',
    unknown: 'Indetermine',
};

const getPlanStatusBackground = (status: ResolutionPlanStep['status']): string => {
    if (status === 'completed') {
        return 'var(--theia-successBackground, var(--theia-list-activeSelectionBackground))';
    }
    if (status === 'blocked') {
        return 'var(--theia-errorBackground, var(--theia-inputValidation-errorBackground))';
    }
    if (status === 'skipped') {
        return 'var(--theia-editor-background)';
    }
    return 'var(--theia-input-background)';
};

const getGeoPlausibilityAccent = (status: GeographicPlausibilityAssessment['status']): string => {
    if (status === 'very_plausible' || status === 'plausible') {
        return 'var(--theia-successBackground, var(--theia-list-activeSelectionBackground))';
    }
    if (status === 'unlikely') {
        return 'var(--theia-errorBackground, var(--theia-inputValidation-errorBackground))';
    }
    return 'var(--theia-input-background)';
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

type MetasolverWorkflowLogEntry = {
    id: string;
    category: 'archive' | 'chat' | 'classify' | 'formula' | 'secret' | 'recommend' | 'execute';
    message: string;
    detail?: string;
    timestamp: string;
};

export interface PluginExecutorResumeSnapshot {
    updatedAt?: string;
    currentText: string;
    recommendationSourceText: string;
    classification: ListingClassificationResponse | null;
    recommendation: MetasolverRecommendationResponse | null;
    workflowResolution: ResolutionWorkflowResponse | null;
    workflowEntries: MetasolverWorkflowLogEntry[];
}

type ArchivedMetasolverResumeState = PluginExecutorResumeSnapshot;

const MAX_ARCHIVED_WORKFLOW_ENTRIES = 12;

const truncateDiagnosticText = (value?: string | null, maxLength: number = 240): string => {
    const normalized = (value || '').replace(/\s+/g, ' ').trim();
    if (!normalized) {
        return '';
    }
    if (normalized.length <= maxLength) {
        return normalized;
    }
    return `${normalized.slice(0, Math.max(0, maxLength - 3))}...`;
};

const formatDistanceKm = (value?: number | null): string => {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return '';
    }
    return `${value.toFixed(value < 10 ? 2 : 1)} km`;
};

const createWorkflowEntry = (
    category: MetasolverWorkflowLogEntry['category'],
    message: string,
    detail?: string,
): MetasolverWorkflowLogEntry => ({
    id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    category,
    message,
    detail,
    timestamp: new Date().toLocaleTimeString('fr-FR', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    }),
});

const prependWorkflowEntries = (
    entries: MetasolverWorkflowLogEntry[],
    category: MetasolverWorkflowLogEntry['category'],
    message: string,
    detail?: string,
): MetasolverWorkflowLogEntry[] => [
    createWorkflowEntry(category, message, detail),
    ...entries,
].slice(0, MAX_ARCHIVED_WORKFLOW_ENTRIES);

const cloneListingClassification = (classification: ListingClassificationResponse | null): ListingClassificationResponse | null => {
    if (!classification) {
        return null;
    }

    return {
        source: classification.source,
        geocache: classification.geocache ? { ...classification.geocache } : null,
        title: classification.title ?? null,
        max_secret_fragments: classification.max_secret_fragments,
        labels: classification.labels.slice(0, 8).map(label => ({
            ...label,
            evidence: (label.evidence || []).slice(0, 3),
        })),
        recommended_actions: classification.recommended_actions.slice(0, 6),
        candidate_secret_fragments: classification.candidate_secret_fragments.slice(0, 5).map(fragment => ({
            ...fragment,
            text: truncateDiagnosticText(fragment.text, 320),
            evidence: (fragment.evidence || []).slice(0, 3),
        })),
        hidden_signals: classification.hidden_signals.slice(0, 6),
        formula_signals: classification.formula_signals.slice(0, 6),
        signal_summary: {
            has_title: Boolean(classification.signal_summary?.has_title),
            has_hint: Boolean(classification.signal_summary?.has_hint),
            has_description_html: Boolean(classification.signal_summary?.has_description_html),
            image_count: Number(classification.signal_summary?.image_count || 0),
            image_hint_count: Number(classification.signal_summary?.image_hint_count || 0),
            image_hint_sources: Array.isArray(classification.signal_summary?.image_hint_sources) ? classification.signal_summary.image_hint_sources.slice(0, 6) : [],
            checker_count: Number(classification.signal_summary?.checker_count || 0),
            waypoint_count: Number(classification.signal_summary?.waypoint_count || 0),
            formula_signal_count: Number(classification.signal_summary?.formula_signal_count || 0),
            variable_assignment_count: Number(classification.signal_summary?.variable_assignment_count || 0),
            has_formula_coordinate_placeholders: Boolean(classification.signal_summary?.has_formula_coordinate_placeholders),
            projection_keyword_count: Number(classification.signal_summary?.projection_keyword_count || 0),
            visual_image_signal_count: Number(classification.signal_summary?.visual_image_signal_count || 0),
            direct_structured_fragment_count: Number(classification.signal_summary?.direct_structured_fragment_count || 0),
            hidden_structured_fragment_count: Number(classification.signal_summary?.hidden_structured_fragment_count || 0),
            image_structured_fragment_count: Number(classification.signal_summary?.image_structured_fragment_count || 0),
            direct_domain_score: Number(classification.signal_summary?.direct_domain_score || 0),
            hidden_domain_score: Number(classification.signal_summary?.hidden_domain_score || 0),
            image_domain_score: Number(classification.signal_summary?.image_domain_score || 0),
            dominant_evidence_domain: classification.signal_summary?.dominant_evidence_domain ?? null,
            evidence_domain_gap: Number(classification.signal_summary?.evidence_domain_gap || 0),
            hybrid_domain_count: Number(classification.signal_summary?.hybrid_domain_count || 0),
            is_hybrid_listing: Boolean(classification.signal_summary?.is_hybrid_listing),
            ambiguous_domains: Array.isArray(classification.signal_summary?.ambiguous_domains) ? classification.signal_summary.ambiguous_domains.slice(0, 3) : [],
            is_ambiguous_hybrid: Boolean(classification.signal_summary?.is_ambiguous_hybrid),
            has_visual_only_image_clue: Boolean(classification.signal_summary?.has_visual_only_image_clue),
            hidden_signal_count: Number(classification.signal_summary?.hidden_signal_count || 0),
            hidden_comment_count: Number(classification.signal_summary?.hidden_comment_count || 0),
            hidden_text_count: Number(classification.signal_summary?.hidden_text_count || 0),
            secret_fragment_count: Number(classification.signal_summary?.secret_fragment_count || 0),
            best_secret_fragment_source: classification.signal_summary?.best_secret_fragment_source ?? null,
            best_secret_fragment_confidence: Number(classification.signal_summary?.best_secret_fragment_confidence || 0),
        },
    };
};

const cloneMetasolverRecommendation = (recommendation: MetasolverRecommendationResponse | null): MetasolverRecommendationResponse | null => {
    if (!recommendation) {
        return null;
    }

    return {
        ...recommendation,
        recommendations: recommendation.recommendations.slice(0, 8).map(item => ({
            ...item,
            reasons: (item.reasons || []).slice(0, 4),
        })),
        selected_plugins: recommendation.selected_plugins.slice(0, 8),
        explanation: recommendation.explanation?.slice(0, 6) || [],
    };
};

const cloneWorkflowResolution = (
    workflowResolution: ResolutionWorkflowResponse | null,
    classificationSnapshot?: ListingClassificationResponse | null,
): ResolutionWorkflowResponse | null => {
    if (!workflowResolution) {
        return null;
    }

    const secretExecution = workflowResolution.execution.secret_code;
    const formulaExecution = workflowResolution.execution.formula;
    const hiddenExecution = workflowResolution.execution.hidden_content;
    const imageExecution = workflowResolution.execution.image_puzzle;
    const checkerExecution = workflowResolution.execution.checker;

    return {
        source: workflowResolution.source,
        geocache: workflowResolution.geocache ? { ...workflowResolution.geocache } : null,
        title: workflowResolution.title ?? null,
        workflow: {
            ...workflowResolution.workflow,
            supporting_labels: (workflowResolution.workflow.supporting_labels || []).slice(0, 6),
        },
        workflow_candidates: workflowResolution.workflow_candidates.slice(0, 6).map(candidate => ({
            ...candidate,
            supporting_labels: (candidate.supporting_labels || []).slice(0, 6),
        })),
        classification: classificationSnapshot || cloneListingClassification(workflowResolution.classification) || {
            source: workflowResolution.source,
            geocache: workflowResolution.geocache ? { ...workflowResolution.geocache } : null,
            title: workflowResolution.title ?? null,
            max_secret_fragments: 0,
            labels: [],
            recommended_actions: [],
            candidate_secret_fragments: [],
            hidden_signals: [],
            formula_signals: [],
            signal_summary: {
                has_title: false,
                has_hint: false,
                has_description_html: false,
                image_count: 0,
                image_hint_count: 0,
                image_hint_sources: [],
                checker_count: 0,
                waypoint_count: 0,
                formula_signal_count: 0,
                variable_assignment_count: 0,
                has_formula_coordinate_placeholders: false,
                projection_keyword_count: 0,
                visual_image_signal_count: 0,
                direct_structured_fragment_count: 0,
                hidden_structured_fragment_count: 0,
                image_structured_fragment_count: 0,
                direct_domain_score: 0,
                hidden_domain_score: 0,
                image_domain_score: 0,
                dominant_evidence_domain: null,
                evidence_domain_gap: 0,
                hybrid_domain_count: 0,
                is_hybrid_listing: false,
                ambiguous_domains: [],
                is_ambiguous_hybrid: false,
                has_visual_only_image_clue: false,
                hidden_signal_count: 0,
                hidden_comment_count: 0,
                hidden_text_count: 0,
                secret_fragment_count: 0,
                best_secret_fragment_source: null,
                best_secret_fragment_confidence: 0,
            },
        },
        plan: workflowResolution.plan.slice(0, 10).map(step => ({ ...step })),
        execution: {
            secret_code: secretExecution ? {
                selected_fragment: secretExecution.selected_fragment ? {
                    ...secretExecution.selected_fragment,
                    text: truncateDiagnosticText(secretExecution.selected_fragment.text, 320),
                    evidence: (secretExecution.selected_fragment.evidence || []).slice(0, 3),
                } : null,
                direct_plugin_candidate: secretExecution.direct_plugin_candidate ? {
                    ...secretExecution.direct_plugin_candidate,
                    source_text: truncateDiagnosticText(secretExecution.direct_plugin_candidate.source_text || '', 320) || null,
                    axes: (secretExecution.direct_plugin_candidate.axes || []).slice(0, 4),
                    fallback_plugin_list: (secretExecution.direct_plugin_candidate.fallback_plugin_list || []).slice(0, 8),
                    plugin_inputs: secretExecution.direct_plugin_candidate.plugin_inputs ? { ...secretExecution.direct_plugin_candidate.plugin_inputs } : null,
                } : null,
                direct_plugin_result: secretExecution.direct_plugin_result ? {
                    ...secretExecution.direct_plugin_result,
                    top_results: (secretExecution.direct_plugin_result.top_results || []).slice(0, 5).map(result => ({ ...result })),
                } : null,
                recommendation: cloneMetasolverRecommendation(secretExecution.recommendation || null),
                metasolver_result: secretExecution.metasolver_result ? {
                    ...secretExecution.metasolver_result,
                    top_results: (secretExecution.metasolver_result.top_results || []).slice(0, 5).map(result => ({ ...result })),
                    failed_plugins: (secretExecution.metasolver_result.failed_plugins || []).slice(0, 6).map(plugin => ({ ...plugin })),
                } : null,
            } : null,
            formula: formulaExecution ? {
                formula_count: formulaExecution.formula_count,
                formulas: (formulaExecution.formulas || []).slice(0, 6).map(formula => ({ ...formula })),
                variables: (formulaExecution.variables || []).slice(0, 20),
                questions: { ...(formulaExecution.questions || {}) },
                found_question_count: formulaExecution.found_question_count,
                answer_search: formulaExecution.answer_search ? {
                    answers: Object.fromEntries(
                        Object.entries(formulaExecution.answer_search.answers || {}).slice(0, 20).map(([key, value]) => [
                            key,
                            {
                                question: value.question,
                                best_answer: value.best_answer,
                                recommended_value_type: value.recommended_value_type,
                                results: (value.results || []).slice(0, 6).map(result => ({ ...result })),
                                suggested_values: (value.suggested_values || []).slice(0, 8).map(item => ({ ...item })),
                            }
                        ])
                    ),
                    found_count: formulaExecution.answer_search.found_count,
                    missing: (formulaExecution.answer_search.missing || []).slice(0, 12),
                    search_context: formulaExecution.answer_search.search_context,
                } : null,
                calculated_coordinates: formulaExecution.calculated_coordinates
                    ? { ...formulaExecution.calculated_coordinates }
                    : null,
            } : null,
            hidden_content: hiddenExecution ? {
                inspected: Boolean(hiddenExecution.inspected),
                hidden_signals: (hiddenExecution.hidden_signals || []).slice(0, 8),
                comments: (hiddenExecution.comments || []).slice(0, 6),
                hidden_texts: (hiddenExecution.hidden_texts || []).slice(0, 6),
                items: (hiddenExecution.items || []).slice(0, 8).map(item => ({ ...item })),
                candidate_secret_fragments: (hiddenExecution.candidate_secret_fragments || []).slice(0, 6).map(fragment => ({
                    ...fragment,
                    text: truncateDiagnosticText(fragment.text, 320),
                    evidence: (fragment.evidence || []).slice(0, 3),
                })),
                selected_fragment: hiddenExecution.selected_fragment ? {
                    ...hiddenExecution.selected_fragment,
                    text: truncateDiagnosticText(hiddenExecution.selected_fragment.text, 320),
                    evidence: (hiddenExecution.selected_fragment.evidence || []).slice(0, 3),
                } : null,
                recommendation: cloneMetasolverRecommendation(hiddenExecution.recommendation || null),
                summary: hiddenExecution.summary,
            } : null,
            image_puzzle: imageExecution ? {
                inspected: Boolean(imageExecution.inspected),
                image_count: Number(imageExecution.image_count || 0),
                image_urls: (imageExecution.image_urls || []).slice(0, 8),
                items: (imageExecution.items || []).slice(0, 10).map(item => ({ ...item })),
                candidate_secret_fragments: (imageExecution.candidate_secret_fragments || []).slice(0, 6).map(fragment => ({
                    ...fragment,
                    text: truncateDiagnosticText(fragment.text, 320),
                    evidence: (fragment.evidence || []).slice(0, 3),
                })),
                selected_fragment: imageExecution.selected_fragment ? {
                    ...imageExecution.selected_fragment,
                    text: truncateDiagnosticText(imageExecution.selected_fragment.text, 320),
                    evidence: (imageExecution.selected_fragment.evidence || []).slice(0, 3),
                } : null,
                recommendation: cloneMetasolverRecommendation(imageExecution.recommendation || null),
                plugin_summaries: (imageExecution.plugin_summaries || []).slice(0, 6),
                coordinates_candidate: imageExecution.coordinates_candidate
                    ? (typeof imageExecution.coordinates_candidate === 'string'
                        ? imageExecution.coordinates_candidate
                        : { ...imageExecution.coordinates_candidate })
                    : null,
                geographic_plausibility: imageExecution.geographic_plausibility
                    ? { ...imageExecution.geographic_plausibility }
                    : null,
                summary: imageExecution.summary,
            } : null,
            checker: checkerExecution ? {
                ...checkerExecution,
                result: checkerExecution.result ? { ...checkerExecution.result } : null,
            } : null,
        },
        control: workflowResolution.control ? {
            ...workflowResolution.control,
            budget: { ...workflowResolution.control.budget },
            usage: { ...workflowResolution.control.usage },
            remaining: { ...workflowResolution.control.remaining },
            stop_reasons: (workflowResolution.control.stop_reasons || []).slice(0, 6),
        } : {
            status: 'completed',
            budget: {
                max_automated_steps: 0,
                max_metasolver_runs: 0,
                max_search_questions: 0,
                max_checker_runs: 0,
                max_coordinate_calculations: 0,
                max_vision_ocr_runs: 0,
                stop_on_checker_success: true,
            },
            usage: {
                automated_steps: 0,
                metasolver_runs: 0,
                search_questions: 0,
                checker_runs: 0,
                coordinate_calculations: 0,
                vision_ocr_runs: 0,
            },
            remaining: {
                automated_steps: 0,
                metasolver_runs: 0,
                search_questions: 0,
                checker_runs: 0,
                coordinate_calculations: 0,
                vision_ocr_runs: 0,
            },
            stop_reasons: [],
            can_run_next_step: false,
            requires_user_input: false,
            final_confidence: 0,
            summary: 'Aucun controle disponible.',
        },
        next_actions: workflowResolution.next_actions.slice(0, 8),
        explanation: workflowResolution.explanation.slice(0, 8),
    };
};

const buildArchiveResumeState = (
    text: string,
    workflowResolution: ResolutionWorkflowResponse | null,
    classification: ListingClassificationResponse | null,
    recommendation: MetasolverRecommendationResponse | null,
    recommendationSourceText: string,
    workflowEntries: MetasolverWorkflowLogEntry[],
): ArchivedMetasolverResumeState => {
    const classificationSnapshot = cloneListingClassification(classification);

    return {
        updatedAt: new Date().toISOString(),
        currentText: truncateDiagnosticText(text, 4000),
        recommendationSourceText: truncateDiagnosticText(recommendationSourceText, 1200),
        classification: classificationSnapshot,
        recommendation: cloneMetasolverRecommendation(recommendation),
        workflowResolution: cloneWorkflowResolution(workflowResolution, classificationSnapshot),
        workflowEntries: workflowEntries.slice(0, MAX_ARCHIVED_WORKFLOW_ENTRIES).map(entry => ({
            id: entry.id,
            category: entry.category,
            message: entry.message,
            detail: entry.detail,
            timestamp: entry.timestamp,
        })),
    };
};

const restoreArchiveResumeState = (rawValue: unknown): ArchivedMetasolverResumeState | null => {
    if (!rawValue || typeof rawValue !== 'object') {
        return null;
    }

    const summary = rawValue as {
        source?: string;
        updated_at?: string;
        current_text?: string;
        history_state?: Array<{
            recorded_at?: string;
            resume_state?: {
                updatedAt?: string;
                currentText?: string;
                recommendationSourceText?: string;
                classification?: ListingClassificationResponse | null;
                recommendation?: MetasolverRecommendationResponse | null;
                workflowResolution?: ResolutionWorkflowResponse | null;
                workflowEntries?: MetasolverWorkflowLogEntry[];
            } | null;
        }> | null;
        resume_state?: {
            updatedAt?: string;
            currentText?: string;
            recommendationSourceText?: string;
            classification?: ListingClassificationResponse | null;
            recommendation?: MetasolverRecommendationResponse | null;
            workflowResolution?: ResolutionWorkflowResponse | null;
            workflowEntries?: MetasolverWorkflowLogEntry[];
        } | null;
    };

    const selectedResumeState = summary.resume_state
        || (Array.isArray(summary.history_state)
            ? summary.history_state.find(entry => entry?.resume_state)?.resume_state
            : null);

    if (summary.source !== 'plugin_executor_metasolver' || !selectedResumeState) {
        return null;
    }

    const classification = cloneListingClassification(selectedResumeState.classification || null);
    const workflowResolution = cloneWorkflowResolution(selectedResumeState.workflowResolution || null, classification);
    const recommendation = cloneMetasolverRecommendation(selectedResumeState.recommendation || null);
    const workflowEntries = Array.isArray(selectedResumeState.workflowEntries)
        ? selectedResumeState.workflowEntries.slice(0, MAX_ARCHIVED_WORKFLOW_ENTRIES).map(entry => ({
            id: typeof entry.id === 'string' ? entry.id : `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
            category: entry.category,
            message: entry.message,
            detail: entry.detail,
            timestamp: entry.timestamp,
        }))
        : [];

    return {
        updatedAt: selectedResumeState.updatedAt || summary.updated_at,
        currentText: typeof selectedResumeState.currentText === 'string'
            ? selectedResumeState.currentText
            : (typeof summary.current_text === 'string' ? summary.current_text : ''),
        recommendationSourceText: typeof selectedResumeState.recommendationSourceText === 'string'
            ? selectedResumeState.recommendationSourceText
            : '',
        classification,
        recommendation,
        workflowResolution,
        workflowEntries,
    };
};

const buildArchiveDiagnosticSummary = (
    geocacheContext: GeocacheContext | undefined,
    text: string,
    workflowResolution: ResolutionWorkflowResponse | null,
    classification: ListingClassificationResponse | null,
    recommendation: MetasolverRecommendationResponse | null,
    recommendationSourceText: string,
    workflowEntries: MetasolverWorkflowLogEntry[],
): Record<string, unknown> => {
    const classificationSnapshot = cloneListingClassification(classification);
    const recommendationSnapshot = cloneMetasolverRecommendation(recommendation);
    const workflowResolutionSnapshot = cloneWorkflowResolution(workflowResolution, classificationSnapshot);
    const resumeState = buildArchiveResumeState(
        text || geocacheContext?.description || '',
        workflowResolution,
        classification,
        recommendation,
        recommendationSourceText,
        workflowEntries,
    );

    return {
        source: 'plugin_executor_metasolver',
        schema_version: 2,
        updated_at: new Date().toISOString(),
        geocache: geocacheContext ? {
            geocache_id: geocacheContext.geocacheId,
            gc_code: geocacheContext.gcCode,
            name: geocacheContext.name,
        } : null,
        current_text: truncateDiagnosticText(text || geocacheContext?.description || '', 1200),
        workflow_resolution: workflowResolutionSnapshot ? {
            primary: {
                kind: workflowResolutionSnapshot.workflow.kind,
                confidence: workflowResolutionSnapshot.workflow.confidence,
                score: workflowResolutionSnapshot.workflow.score,
                reason: workflowResolutionSnapshot.workflow.reason,
                forced: workflowResolutionSnapshot.workflow.forced || false,
            },
            candidates: workflowResolutionSnapshot.workflow_candidates.slice(0, 4).map(candidate => ({
                kind: candidate.kind,
                confidence: candidate.confidence,
                score: candidate.score,
                reason: candidate.reason,
                supporting_labels: candidate.supporting_labels,
            })),
            explanation: workflowResolutionSnapshot.explanation.slice(0, 4),
            next_actions: workflowResolutionSnapshot.next_actions.slice(0, 6),
            plan: workflowResolutionSnapshot.plan.slice(0, 6).map(step => ({
                id: step.id,
                title: step.title,
                status: step.status,
                automated: step.automated,
                tool: step.tool,
                detail: step.detail,
            })),
            execution: workflowResolutionSnapshot.execution,
        } : null,
        classification: classificationSnapshot,
        labels: classificationSnapshot?.labels.map(label => ({
            name: label.name,
            confidence: label.confidence,
            evidence: label.evidence.slice(0, 3),
        })) || [],
        recommended_actions: classificationSnapshot?.recommended_actions.slice(0, 4) || [],
        formula_signals: classificationSnapshot?.formula_signals.slice(0, 4) || [],
        hidden_signals: classificationSnapshot?.hidden_signals.slice(0, 4) || [],
        secret_fragments: classificationSnapshot?.candidate_secret_fragments.slice(0, 3).map(fragment => ({
            text: truncateDiagnosticText(fragment.text, 160),
            source: fragment.source,
            confidence: fragment.confidence,
            evidence: fragment.evidence.slice(0, 2),
        })) || [],
        metasolver: recommendationSnapshot ? {
            requested_preset: recommendationSnapshot.requested_preset || null,
            preset: recommendationSnapshot.effective_preset,
            preset_label: recommendationSnapshot.effective_preset_label,
            mode: recommendationSnapshot.mode,
            max_plugins: recommendationSnapshot.max_plugins,
            signature: recommendationSnapshot.signature,
            selected_plugins: recommendationSnapshot.selected_plugins.slice(0, 8),
            plugin_list: recommendationSnapshot.plugin_list,
            explanation: recommendationSnapshot.explanation?.slice(0, 4) || [],
            top_recommendations: recommendationSnapshot.recommendations.slice(0, 5).map(item => ({
                name: item.name,
                confidence: item.confidence,
                score: item.score,
                reasons: item.reasons.slice(0, 3),
            })),
            recommendation_source_text: truncateDiagnosticText(recommendationSourceText, 800),
        } : null,
        workflow: workflowEntries.slice(0, 8).map(entry => ({
            category: entry.category,
            message: entry.message,
            detail: entry.detail,
            timestamp: entry.timestamp,
        })),
        resume_state: {
            updatedAt: resumeState.updatedAt,
            currentText: resumeState.currentText,
            recommendationSourceText: resumeState.recommendationSourceText,
            classification: resumeState.classification,
            recommendation: resumeState.recommendation,
            workflowResolution: resumeState.workflowResolution,
            workflowEntries: resumeState.workflowEntries,
        },
    };
};

export const MetasolverPresetPanel: React.FC<{
    preset: string;
    pluginList: string;
    text: string;
    maxPlugins?: number;
    geocacheContext?: GeocacheContext;
    pluginsService: PluginsService;
    preferenceService: PreferenceService;
    commandService: CommandService;
    backendBaseUrl: string;
    onTextChange: (newText: string) => void;
    onPluginListChange: (newList: string) => void;
    onExecuteRequest: () => void;
    disabled: boolean;
}> = ({ preset, pluginList, text, maxPlugins, geocacheContext, pluginsService, preferenceService, commandService, backendBaseUrl, onTextChange, onPluginListChange, onExecuteRequest, disabled }) => {
    const [eligiblePlugins, setEligiblePlugins] = React.useState<MetasolverEligiblePlugin[]>([]);
    const [workflowResolution, setWorkflowResolution] = React.useState<ResolutionWorkflowResponse | null>(null);
    const [classification, setClassification] = React.useState<ListingClassificationResponse | null>(null);
    const [recommendation, setRecommendation] = React.useState<MetasolverRecommendationResponse | null>(null);
    const [recommendationSourceText, setRecommendationSourceText] = React.useState<string>('');
    const [loadingClassification, setLoadingClassification] = React.useState(false);
    const [loadingEligible, setLoadingEligible] = React.useState(false);
    const [loadingRecommendation, setLoadingRecommendation] = React.useState(false);
    const [runningWorkflowStepId, setRunningWorkflowStepId] = React.useState<string | null>(null);
    const [error, setError] = React.useState<string | null>(null);
    const [pendingAutoExecutionText, setPendingAutoExecutionText] = React.useState<string | null>(null);
    const [workflowEntries, setWorkflowEntries] = React.useState<MetasolverWorkflowLogEntry[]>([]);
    const [archivedResumeState, setArchivedResumeState] = React.useState<ArchivedMetasolverResumeState | null>(null);
    const [expanded, setExpanded] = React.useState(false);
    const [selectionMode, setSelectionMode] = React.useState<MetasolverSelectionMode>(
        pluginList.trim() ? 'manual' : 'recommended'
    );
    const [manualSelectedPlugins, setManualSelectedPlugins] = React.useState<Set<string>>(new Set(parsePluginListValue(pluginList)));
    const autoApplyKeyRef = React.useRef<string | null>(null);
    const lastWorkflowLogKeyRef = React.useRef<string>('');
    const lastRecommendationLogKeyRef = React.useRef<string>('');
    const autoRestoredArchiveGcCodeRef = React.useRef<string>('');
    const skipNextWorkflowRefreshRef = React.useRef(false);
    const skipNextRecommendationRefreshRef = React.useRef(false);
    const geoAppWorkflowKind = React.useMemo(() => {
        return resolvePluginExecutorGeoAppWorkflowKind(workflowResolution, classification);
    }, [workflowResolution, classification]);
    const geoAppChatProfile = React.useMemo(() => {
        const normalizeWorkflowProfile = (value: unknown): 'default' | 'local' | 'fast' | 'strong' | 'web' | undefined => {
            return value === 'default' || value === 'local' || value === 'fast' || value === 'strong' || value === 'web'
                ? value
                : undefined;
        };
        const normalizeProfile = (value: unknown): 'local' | 'fast' | 'strong' | 'web' => {
            return value === 'local' || value === 'fast' || value === 'strong' || value === 'web' ? value : 'fast';
        };

        const defaultProfile = normalizeProfile(preferenceService.get(GEOAPP_CHAT_DEFAULT_PROFILE_PREF, 'fast'));
        const workflowPreferenceKey = geoAppWorkflowKind === 'secret_code'
            ? GEOAPP_CHAT_SECRET_CODE_PROFILE_PREF
            : geoAppWorkflowKind === 'formula'
                ? GEOAPP_CHAT_FORMULA_PROFILE_PREF
                : geoAppWorkflowKind === 'checker'
                    ? GEOAPP_CHAT_CHECKER_PROFILE_PREF
                    : geoAppWorkflowKind === 'hidden_content'
                        ? GEOAPP_CHAT_HIDDEN_CONTENT_PROFILE_PREF
                        : geoAppWorkflowKind === 'image_puzzle'
                            ? GEOAPP_CHAT_IMAGE_PUZZLE_PROFILE_PREF
                            : undefined;

        if (!workflowPreferenceKey) {
            return defaultProfile;
        }

        const workflowProfile = normalizeWorkflowProfile(preferenceService.get(workflowPreferenceKey, 'default'));
        if (!workflowProfile || workflowProfile === 'default') {
            return defaultProfile;
        }
        return workflowProfile;
    }, [geoAppWorkflowKind, preferenceService]);

    React.useEffect(() => {
        setSelectionMode(prev => pluginList.trim() ? 'manual' : (prev === 'preset' ? 'preset' : 'recommended'));
        setManualSelectedPlugins(new Set(parsePluginListValue(pluginList)));
    }, [pluginList]);

    React.useEffect(() => {
        setSelectionMode(prev => pluginList.trim() ? 'manual' : (prev === 'preset' ? 'preset' : 'recommended'));
        setManualSelectedPlugins(new Set(parsePluginListValue(pluginList)));
        autoApplyKeyRef.current = null;
    }, [preset]);

    const appendWorkflowEntry = React.useCallback((
        category: MetasolverWorkflowLogEntry['category'],
        message: string,
        detail?: string,
    ) => {
        setWorkflowEntries(prev => prependWorkflowEntries(prev, category, message, detail));
    }, []);

    const applyArchivedResumeSnapshot = React.useCallback((
        snapshot: ArchivedMetasolverResumeState,
        mode: 'auto' | 'manual',
    ) => {
        const gcCode = (geocacheContext?.gcCode || '').trim();
        const archiveLabel = gcCode || snapshot.updatedAt || 'archive';
        const workflowLog = prependWorkflowEntries(
            snapshot.workflowEntries || [],
            'archive',
            mode === 'auto' ? 'Etat restaure automatiquement depuis l archive' : 'Etat restaure depuis l archive',
            archiveLabel
        );

        setWorkflowResolution(snapshot.workflowResolution);
        setClassification(snapshot.classification);
        setRecommendation(snapshot.recommendation);
        setRecommendationSourceText(snapshot.recommendationSourceText || '');
        setWorkflowEntries(workflowLog);
        setError(null);
        setExpanded(true);
        setPendingAutoExecutionText(null);
        skipNextWorkflowRefreshRef.current = true;
        skipNextRecommendationRefreshRef.current = true;

        if (snapshot.currentText && (mode === 'manual' || !(text || '').trim())) {
            onTextChange(snapshot.currentText);
        }

        if (snapshot.recommendation?.plugin_list && (mode === 'manual' || !pluginList.trim())) {
            onPluginListChange(snapshot.recommendation.plugin_list);
            setSelectionMode('recommended');
            setManualSelectedPlugins(new Set(snapshot.recommendation.selected_plugins || []));
        }
    }, [geocacheContext?.gcCode, onPluginListChange, onTextChange, pluginList, text]);

    React.useEffect(() => {
        const contextSnapshot = geocacheContext?.resumeSnapshot || null;
        if (contextSnapshot) {
            const gcCode = (geocacheContext?.gcCode || '').trim().toUpperCase();
            if (gcCode) {
                autoRestoredArchiveGcCodeRef.current = gcCode;
            }
            setArchivedResumeState(contextSnapshot);
            applyArchivedResumeSnapshot(contextSnapshot, 'manual');
            return;
        }

        let cancelled = false;
        const gcCode = (geocacheContext?.gcCode || '').trim().toUpperCase();
        autoRestoredArchiveGcCodeRef.current = gcCode === autoRestoredArchiveGcCodeRef.current
            ? autoRestoredArchiveGcCodeRef.current
            : '';

        if (!gcCode) {
            setArchivedResumeState(null);
            return () => { cancelled = true; };
        }

        const fetchArchivedResumeState = async () => {
            try {
                const response = await fetch(`${backendBaseUrl}/api/archive/${encodeURIComponent(gcCode)}`, {
                    credentials: 'include',
                });
                if (response.status === 404) {
                    if (!cancelled) {
                        setArchivedResumeState(null);
                    }
                    return;
                }
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }

                const archive = await response.json();
                const restored = restoreArchiveResumeState(archive?.resolution_diagnostics);
                if (!cancelled) {
                    setArchivedResumeState(restored);
                }
            } catch (archiveError) {
                if (!cancelled) {
                    console.warn('[MetasolverPresetPanel] Archive resume load failed', archiveError);
                    setArchivedResumeState(null);
                }
            }
        };

        void fetchArchivedResumeState();
        return () => { cancelled = true; };
    }, [applyArchivedResumeSnapshot, backendBaseUrl, geocacheContext?.gcCode, geocacheContext?.resumeSnapshot]);

    React.useEffect(() => {
        const gcCode = (geocacheContext?.gcCode || '').trim().toUpperCase();
        if (!gcCode || !archivedResumeState) {
            return;
        }
        if (autoRestoredArchiveGcCodeRef.current === gcCode) {
            return;
        }

        const shouldAutoRestore = !(text || '').trim()
            && !pluginList.trim()
            && !workflowResolution
            && !classification
            && !recommendation
            && workflowEntries.length === 0;
        if (!shouldAutoRestore) {
            return;
        }

        autoRestoredArchiveGcCodeRef.current = gcCode;
        applyArchivedResumeSnapshot(archivedResumeState, 'auto');
    }, [
        applyArchivedResumeSnapshot,
        archivedResumeState,
        classification,
        geocacheContext?.gcCode,
        pluginList,
        recommendation,
        text,
        workflowEntries.length,
        workflowResolution,
    ]);

    React.useEffect(() => {
        let cancelled = false;

        const fetchEligible = async () => {
            setLoadingEligible(true);
            setError(null);
            try {
                const data = await pluginsService.getMetasolverEligiblePlugins(preset);
                if (!cancelled) {
                    setEligiblePlugins(data.plugins || []);
                }
            } catch (err: any) {
                if (!cancelled) {
                    setError(err?.message || 'Erreur de chargement');
                    setEligiblePlugins([]);
                }
            } finally {
                if (!cancelled) {
                    setLoadingEligible(false);
                }
            }
        };

        void fetchEligible();
        return () => { cancelled = true; };
    }, [preset, pluginsService]);

    React.useEffect(() => {
        let cancelled = false;

        const timeoutId = window.setTimeout(() => {
            const fetchWorkflowResolution = async () => {
                if (skipNextWorkflowRefreshRef.current) {
                    skipNextWorkflowRefreshRef.current = false;
                    setLoadingClassification(false);
                    return;
                }

                const trimmedText = (text || '').trim();
                const geocacheId = typeof geocacheContext?.geocacheId === 'number' ? geocacheContext.geocacheId : undefined;
                const hasDirectInput = Boolean(trimmedText || geocacheContext?.hint || geocacheContext?.name);

                if (!geocacheId && !hasDirectInput) {
                    setWorkflowResolution(null);
                    setClassification(null);
                    setLoadingClassification(false);
                    return;
                }

                setLoadingClassification(true);
                setError(null);
                try {
                    const data = await pluginsService.resolveWorkflow({
                        geocache_id: geocacheId,
                        title: geocacheContext?.name || undefined,
                        description: trimmedText || geocacheContext?.description || undefined,
                        hint: geocacheContext?.hint || undefined,
                        waypoints: geocacheContext?.waypoints,
                        checkers: geocacheContext?.checkers,
                        images: geocacheContext?.images,
                        max_secret_fragments: 5,
                        metasolver_preset: preset,
                        metasolver_mode: 'decode',
                        max_plugins: maxPlugins,
                    });
                    if (!cancelled) {
                        setWorkflowResolution(data);
                        setClassification(data.classification || null);
                    }
                } catch (err: any) {
                    if (!cancelled) {
                        setError(err?.message || 'Erreur de resolution du workflow');
                        setWorkflowResolution(null);
                        setClassification(null);
                    }
                } finally {
                    if (!cancelled) {
                        setLoadingClassification(false);
                    }
                }
            };

            void fetchWorkflowResolution();
        }, 300);

        return () => {
            cancelled = true;
            window.clearTimeout(timeoutId);
        };
    }, [text, geocacheContext, maxPlugins, pluginsService, preset]);

    React.useEffect(() => {
        let cancelled = false;
        if (skipNextRecommendationRefreshRef.current) {
            skipNextRecommendationRefreshRef.current = false;
            return undefined;
        }

        const trimmedText = (text || '').trim();
        const orchestratorFragmentText = (workflowResolution?.execution.secret_code?.selected_fragment?.text || '').trim();
        const orchestratorRecommendation = workflowResolution?.execution.secret_code?.recommendation || null;

        if (!trimmedText && orchestratorRecommendation && orchestratorFragmentText) {
            setRecommendation(orchestratorRecommendation);
            setRecommendationSourceText(orchestratorFragmentText);
            setLoadingRecommendation(false);
            return undefined;
        }

        if (!trimmedText) {
            setRecommendation(null);
            setRecommendationSourceText('');
            setLoadingRecommendation(false);
            return undefined;
        }

        if (orchestratorRecommendation && orchestratorFragmentText === trimmedText) {
            setRecommendation(orchestratorRecommendation);
            setRecommendationSourceText(trimmedText);
            setLoadingRecommendation(false);
            return undefined;
        }

        const timeoutId = window.setTimeout(() => {
            const fetchRecommendation = async () => {
                setLoadingRecommendation(true);
                setError(null);
                try {
                    const data = await pluginsService.recommendMetasolverPlugins({
                        text: trimmedText,
                        preset,
                        mode: 'decode',
                        max_plugins: maxPlugins
                    });
                    if (!cancelled) {
                        setRecommendation(data);
                        setRecommendationSourceText(trimmedText);
                    }
                } catch (err: any) {
                    if (!cancelled) {
                        setError(err?.message || 'Erreur de recommandation');
                        setRecommendation(null);
                        setRecommendationSourceText('');
                    }
                } finally {
                    if (!cancelled) {
                        setLoadingRecommendation(false);
                    }
                }
            };

            void fetchRecommendation();
        }, 350);

        return () => {
            cancelled = true;
            window.clearTimeout(timeoutId);
        };
    }, [text, preset, maxPlugins, pluginsService, workflowResolution]);

    React.useEffect(() => {
        if (!recommendation || selectionMode !== 'recommended') {
            return;
        }
        if (pluginList.trim()) {
            return;
        }
        if (!recommendationSourceText || recommendationSourceText !== (text || '').trim()) {
            return;
        }

        const key = `${preset}::${text}::${maxPlugins ?? ''}`;
        if (autoApplyKeyRef.current === key) {
            return;
        }

        autoApplyKeyRef.current = key;
        const recommendedNames = recommendation.selected_plugins || [];
        setManualSelectedPlugins(new Set(recommendedNames));
        onPluginListChange(recommendation.plugin_list || '');
    }, [recommendation, selectionMode, pluginList, preset, text, maxPlugins, onPluginListChange]);

    React.useEffect(() => {
        if (!workflowResolution || !classification) {
            return;
        }

        const key = JSON.stringify({
            workflow: workflowResolution.workflow.kind,
            workflow_confidence: workflowResolution.workflow.confidence,
            labels: classification.labels.map(label => [label.name, label.confidence]),
            topFragment: classification.candidate_secret_fragments?.[0]?.text || '',
        });
        if (lastWorkflowLogKeyRef.current === key) {
            return;
        }
        lastWorkflowLogKeyRef.current = key;

        const workflowTitle = WORKFLOW_TITLES[workflowResolution.workflow.kind] || workflowResolution.workflow.kind;
        const detail = workflowResolution.explanation?.[1]
            || (classification.candidate_secret_fragments?.[0]?.text
                ? `Meilleur fragment: ${classification.candidate_secret_fragments[0].text.slice(0, 60)}`
                : classification.formula_signals?.[0]);
        appendWorkflowEntry(
            'classify',
            `Workflow principal: ${workflowTitle} ${(workflowResolution.workflow.confidence * 100).toFixed(0)}%`,
            detail
        );
    }, [workflowResolution, classification, appendWorkflowEntry]);

    React.useEffect(() => {
        if (!recommendation || !recommendationSourceText) {
            return;
        }

        const key = `${recommendationSourceText}::${recommendation.plugin_list}`;
        if (lastRecommendationLogKeyRef.current === key) {
            return;
        }
        lastRecommendationLogKeyRef.current = key;

        const selected = recommendation.selected_plugins.slice(0, 4).join(', ') || 'aucun plugin';
        appendWorkflowEntry(
            'recommend',
            `Recommendation metasolver: ${selected}`,
            `Texte source: ${recommendationSourceText.slice(0, 60)}`
        );
    }, [recommendation, recommendationSourceText, appendWorkflowEntry]);

    React.useEffect(() => {
        if (!pendingAutoExecutionText) {
            return;
        }

        const currentText = (text || '').trim();
        if (currentText !== pendingAutoExecutionText) {
            return;
        }
        if (loadingClassification || loadingRecommendation || disabled) {
            return;
        }
        if (!recommendation) {
            return;
        }
        if (recommendationSourceText !== pendingAutoExecutionText) {
            return;
        }

        const expectedPluginList = (recommendation.plugin_list || '').trim();
        const currentPluginList = (pluginList || '').trim();
        if (currentPluginList !== expectedPluginList) {
            return;
        }

        appendWorkflowEntry(
            'execute',
            'Execution automatique du metasolver',
            `Texte: ${pendingAutoExecutionText.slice(0, 60)}`
        );
        setPendingAutoExecutionText(null);
        onExecuteRequest();
    }, [
        pendingAutoExecutionText,
        text,
        recommendation,
        recommendationSourceText,
        pluginList,
        loadingClassification,
        loadingRecommendation,
        disabled,
        appendWorkflowEntry,
        onExecuteRequest,
    ]);

    const currentSelectedPlugins = React.useMemo(() => {
        if (selectionMode === 'preset' && !pluginList.trim()) {
            return new Set(eligiblePlugins.map(plugin => plugin.name));
        }
        if (manualSelectedPlugins.size > 0) {
            return manualSelectedPlugins;
        }
        if (recommendation?.selected_plugins?.length) {
            return new Set(recommendation.selected_plugins);
        }
        return new Set(eligiblePlugins.map(plugin => plugin.name));
    }, [eligiblePlugins, manualSelectedPlugins, pluginList, recommendation, selectionMode]);

    const applyRecommendation = React.useCallback(() => {
        if (!recommendation) {
            return;
        }
        const names = new Set(recommendation.selected_plugins || []);
        if (!(text || '').trim() && recommendationSourceText) {
            onTextChange(recommendationSourceText);
        }
        setSelectionMode('recommended');
        setManualSelectedPlugins(names);
        onPluginListChange(recommendation.plugin_list || '');
        appendWorkflowEntry('recommend', 'Recommendation appliquee', recommendation.selected_plugins.slice(0, 4).join(', '));
    }, [recommendation, text, recommendationSourceText, onTextChange, onPluginListChange, appendWorkflowEntry]);

    const useFullPreset = React.useCallback(() => {
        setSelectionMode('preset');
        setManualSelectedPlugins(new Set(eligiblePlugins.map(plugin => plugin.name)));
        onPluginListChange('');
        appendWorkflowEntry('recommend', `Preset complet applique (${eligiblePlugins.length} plugins)`);
    }, [eligiblePlugins, onPluginListChange, appendWorkflowEntry]);

    const handleTogglePlugin = React.useCallback((pluginName: string, checked: boolean) => {
        setManualSelectedPlugins(prev => {
            const next = new Set(prev.size > 0 ? prev : Array.from(currentSelectedPlugins));
            if (checked) {
                next.add(pluginName);
            } else {
                next.delete(pluginName);
            }

            if (next.size === 0) {
                setSelectionMode('preset');
                onPluginListChange('');
                return new Set(eligiblePlugins.map(plugin => plugin.name));
            }

            setSelectionMode('manual');
            onPluginListChange(Array.from(next).join(', '));
            return next;
        });
    }, [currentSelectedPlugins, eligiblePlugins, onPluginListChange]);

    const includedCount = currentSelectedPlugins.size;
    const signatureBadges = recommendation?.signature ? buildSignatureBadges(recommendation.signature) : [];
    const primaryWorkflow = workflowResolution?.workflow || null;
    const hasSecretCodeLabel = primaryWorkflow?.kind === 'secret_code' || Boolean(classification?.labels.some(label => label.name === 'secret_code'));
    const bestSecretFragment = workflowResolution?.execution.secret_code?.selected_fragment || classification?.candidate_secret_fragments?.[0] || null;
    const formulaAnswerSearch = workflowResolution?.execution.formula?.answer_search || null;
    const formulaCalculatedCoordinates = workflowResolution?.execution.formula?.calculated_coordinates || null;
    const hiddenExecution = workflowResolution?.execution.hidden_content || null;
    const hiddenSelectedFragment = hiddenExecution?.selected_fragment || hiddenExecution?.candidate_secret_fragments?.[0] || null;
    const imageExecution = workflowResolution?.execution.image_puzzle || null;
    const imageSelectedFragment = imageExecution?.selected_fragment || imageExecution?.candidate_secret_fragments?.[0] || null;
    const formulaGeoPlausibility = formulaCalculatedCoordinates?.geographic_plausibility || null;
    const secretGeoPlausibility = workflowResolution?.execution.secret_code?.metasolver_result?.geographic_plausibility || null;
    const imageGeoPlausibility = imageExecution?.geographic_plausibility || null;
    const checkerExecution = workflowResolution?.execution.checker || null;
    const derivedCheckerCandidate = React.useMemo(() => {
        const explicitCheckerCandidate = (checkerExecution?.candidate || '').trim();
        if (explicitCheckerCandidate) {
            return explicitCheckerCandidate;
        }
        const calculatedCandidate = formatCheckerCandidateFromCoordinates(formulaCalculatedCoordinates?.coordinates);
        if (calculatedCandidate) {
            return calculatedCandidate;
        }
        const metasolverCandidate = formatCheckerCandidateFromCoordinates(workflowResolution?.execution.secret_code?.metasolver_result?.coordinates);
        if (metasolverCandidate) {
            return metasolverCandidate;
        }
        const topResult = workflowResolution?.execution.secret_code?.metasolver_result?.top_results?.[0];
        const topResultCandidate = formatCheckerCandidateFromCoordinates(topResult?.coordinates);
        if (topResultCandidate) {
            return topResultCandidate;
        }
        if (typeof topResult?.text_output === 'string' && topResult.text_output.trim()) {
            return topResult.text_output.trim();
        }
        return '';
    }, [checkerExecution?.candidate, formulaCalculatedCoordinates?.coordinates, workflowResolution]);
    const formulaGeocacheId = typeof geocacheContext?.geocacheId === 'number' ? geocacheContext.geocacheId : undefined;
    const canSendToGeoAppChat = Boolean((text || '').trim() || workflowResolution || classification || recommendation);

    const applySecretFragment = React.useCallback((fragmentText: string) => {
        setPendingAutoExecutionText(null);
        onTextChange(fragmentText);
        onPluginListChange('');
        setSelectionMode('recommended');
        setManualSelectedPlugins(new Set());
        appendWorkflowEntry('secret', 'Fragment selectionne manuellement', fragmentText.slice(0, 60));
    }, [onTextChange, onPluginListChange, appendWorkflowEntry]);

    const executeSecretFragment = React.useCallback((fragmentText: string) => {
        const normalizedText = fragmentText.trim();
        if (!normalizedText) {
            return;
        }
        setPendingAutoExecutionText(normalizedText);
        onTextChange(normalizedText);
        onPluginListChange('');
        setSelectionMode('recommended');
        setManualSelectedPlugins(new Set());
        appendWorkflowEntry('secret', 'Preparation de l execution automatique', normalizedText.slice(0, 60));
    }, [onTextChange, onPluginListChange, appendWorkflowEntry]);

    const executeBestSecretFragment = React.useCallback(() => {
        if (!bestSecretFragment) {
            return;
        }
        executeSecretFragment(bestSecretFragment.text);
    }, [bestSecretFragment, executeSecretFragment]);

    const openFormulaSolver = React.useCallback(async () => {
        if (!formulaGeocacheId) {
            return;
        }

        try {
            await commandService.executeCommand(FORMULA_SOLVER_SOLVE_FROM_GEOCACHE_COMMAND, formulaGeocacheId);
            appendWorkflowEntry('formula', 'Formula Solver ouvert', `Geocache #${formulaGeocacheId}`);
        } catch (error: any) {
            setError(error?.message || "Impossible d'ouvrir le Formula Solver");
        }
    }, [commandService, formulaGeocacheId, appendWorkflowEntry]);

    const persistDiagnosticSummary = React.useCallback(async (summary: Record<string, unknown>) => {
        const gcCode = (geocacheContext?.gcCode || '').trim();
        if (!gcCode) {
            return;
        }

        try {
            const response = await fetch(`${backendBaseUrl}/api/archive/${encodeURIComponent(gcCode)}/resolution-diagnostics`, {
                method: 'PUT',
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(summary),
            });

            if (!response.ok) {
                const payload = await response.json().catch(() => undefined);
                throw new Error(payload?.error || `HTTP ${response.status}`);
            }

            appendWorkflowEntry('archive', 'Diagnostic archive mis a jour', gcCode);
        } catch (error: any) {
            console.warn('[MetasolverPresetPanel] Archive diagnostic update failed', error);
            appendWorkflowEntry('archive', 'Archive du diagnostic ignoree', error?.message || 'Erreur archive');
        }
    }, [appendWorkflowEntry, backendBaseUrl, geocacheContext?.gcCode]);

    const persistCurrentDiagnosticSummary = React.useCallback(async (overrides?: {
        text?: string;
        workflowResolution?: ResolutionWorkflowResponse | null;
        classification?: ListingClassificationResponse | null;
        recommendation?: MetasolverRecommendationResponse | null;
        recommendationSourceText?: string;
        workflowEntries?: MetasolverWorkflowLogEntry[];
    }) => {
        await persistDiagnosticSummary(
            buildArchiveDiagnosticSummary(
                geocacheContext,
                overrides?.text ?? text,
                overrides?.workflowResolution ?? workflowResolution,
                overrides?.classification ?? classification,
                overrides?.recommendation ?? recommendation,
                overrides?.recommendationSourceText ?? recommendationSourceText,
                overrides?.workflowEntries ?? workflowEntries,
            )
        );
    }, [
        classification,
        geocacheContext,
        persistDiagnosticSummary,
        recommendation,
        recommendationSourceText,
        text,
        workflowEntries,
        workflowResolution,
    ]);

    const sendDiagnosticToGeoAppChat = React.useCallback(() => {
        const prompt = buildGeoAppDiagnosticPrompt(geocacheContext, text, workflowResolution, classification, recommendation, workflowEntries);
        const archiveSummary = buildArchiveDiagnosticSummary(
            geocacheContext,
            text,
            workflowResolution,
            classification,
            recommendation,
            recommendationSourceText,
            workflowEntries,
        );
        const resumeState = (archiveSummary as { resume_state?: Record<string, unknown> }).resume_state;

        dispatchPluginExecutorGeoAppOpenChatRequest(
            window,
            CustomEvent,
            buildPluginExecutorGeoAppOpenChatDetail(
                prompt,
                geoAppWorkflowKind,
                geoAppChatProfile,
                resumeState,
                geocacheContext
            )
        );

        appendWorkflowEntry(
            'chat',
            'Diagnostic envoye au chat GeoApp',
            truncateDiagnosticText(text || bestSecretFragment?.text || geocacheContext?.gcCode || 'Plugin Executor', 90)
        );
        void persistDiagnosticSummary(archiveSummary);
    }, [
        appendWorkflowEntry,
        bestSecretFragment?.text,
        classification,
        geocacheContext,
        geoAppChatProfile,
        geoAppWorkflowKind,
        persistDiagnosticSummary,
        recommendation,
        recommendationSourceText,
        text,
        workflowResolution,
        workflowEntries,
    ]);

    const runWorkflowStep = React.useCallback(async (targetStepId?: string) => {
        const trimmedText = (text || '').trim();
        const geocacheId = typeof geocacheContext?.geocacheId === 'number' ? geocacheContext.geocacheId : undefined;
        const answerSearch = workflowResolution?.execution.formula?.answer_search;
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

        setRunningWorkflowStepId(targetStepId || 'next');
        setError(null);
        try {
            const response = await pluginsService.runWorkflowStep({
                geocache_id: geocacheId,
                title: geocacheContext?.name || undefined,
                description: trimmedText || geocacheContext?.description || undefined,
                hint: geocacheContext?.hint || undefined,
                waypoints: geocacheContext?.waypoints,
                checkers: geocacheContext?.checkers,
                images: geocacheContext?.images,
                preferred_workflow: primaryWorkflow?.kind,
                target_step_id: targetStepId,
                formula_answers: formulaAnswers && Object.keys(formulaAnswers).length ? formulaAnswers : undefined,
                formula_value_types: formulaValueTypes && Object.keys(formulaValueTypes).length ? formulaValueTypes : undefined,
                checker_candidate: derivedCheckerCandidate || undefined,
                max_secret_fragments: 5,
                metasolver_preset: preset,
                metasolver_mode: 'decode',
                max_plugins: maxPlugins,
                workflow_control: workflowResolution?.control || undefined,
            });

            setWorkflowResolution(response.workflow_resolution);
            setClassification(response.workflow_resolution.classification || null);

            const secretExecution = response.workflow_resolution.execution.secret_code;
            const hiddenExecution = response.workflow_resolution.execution.hidden_content;
            const imageExecution = response.workflow_resolution.execution.image_puzzle;
            if (secretExecution?.recommendation) {
                setRecommendation(secretExecution.recommendation);
                setRecommendationSourceText((secretExecution.selected_fragment?.text || '').trim());
            } else if (hiddenExecution?.recommendation) {
                setRecommendation(hiddenExecution.recommendation);
                setRecommendationSourceText((hiddenExecution.selected_fragment?.text || '').trim());
            } else if (imageExecution?.recommendation) {
                setRecommendation(imageExecution.recommendation);
                setRecommendationSourceText((imageExecution.selected_fragment?.text || '').trim());
            }

            let nextWorkflowEntries = workflowEntries;
            let nextLogCategory: MetasolverWorkflowLogEntry['category'] = 'execute';
            let nextLogMessage = '';
            let nextLogDetail: string | undefined;

            if (response.status !== 'success') {
                nextLogMessage = `Etape backend non executee: ${targetStepId || response.step?.id || 'workflow'}`;
                nextLogDetail = response.message;
                nextWorkflowEntries = prependWorkflowEntries(nextWorkflowEntries, nextLogCategory, nextLogMessage, nextLogDetail);
                setWorkflowEntries(nextWorkflowEntries);
                void persistCurrentDiagnosticSummary({
                    workflowResolution: response.workflow_resolution,
                    classification: response.workflow_resolution.classification || null,
                    recommendation: secretExecution?.recommendation || hiddenExecution?.recommendation || imageExecution?.recommendation || recommendation,
                    recommendationSourceText: (
                        secretExecution?.selected_fragment?.text
                        || hiddenExecution?.selected_fragment?.text
                        || imageExecution?.selected_fragment?.text
                        || recommendationSourceText
                    ).trim(),
                    workflowEntries: nextWorkflowEntries,
                });
                return;
            }

            if (response.executed_step === 'search-answers') {
                nextLogCategory = 'formula';
                nextLogMessage = 'Recherche web executee';
                nextLogDetail = response.message;
            } else if (response.executed_step === 'inspect-hidden-html') {
                nextLogCategory = hiddenExecution?.recommendation ? 'recommend' : 'classify';
                nextLogMessage = 'HTML cache inspecte';
                nextLogDetail = truncateDiagnosticText(
                    String(
                        hiddenExecution?.selected_fragment?.text
                        || hiddenExecution?.summary
                        || response.message
                    ),
                    140
                );
            } else if (response.executed_step === 'inspect-images') {
                nextLogCategory = imageExecution?.recommendation ? 'recommend' : 'classify';
                nextLogMessage = 'Images inspectees';
                nextLogDetail = truncateDiagnosticText(
                    String(
                        imageExecution?.selected_fragment?.text
                        || imageExecution?.summary
                        || response.message
                    ),
                    140
                );
            } else if (response.executed_step === 'calculate-final-coordinates') {
                nextLogCategory = 'formula';
                nextLogMessage = 'Coordonnees calculees';
                nextLogDetail = truncateDiagnosticText(
                    String(
                        response.result?.coordinates?.ddm
                        || response.result?.coordinates?.decimal
                        || response.message
                    ),
                    140
                );
            } else if (response.executed_step === 'validate-with-checker') {
                nextLogMessage = 'Validation checker executee';
                nextLogDetail = truncateDiagnosticText(
                    String(
                        response.result?.result?.message
                        || response.result?.message
                        || response.message
                    ),
                    140
                );
            } else {
                nextLogMessage = `Etape backend executee: ${response.executed_step || targetStepId || 'workflow'}`;
                nextLogDetail = response.message;
            }

            nextWorkflowEntries = prependWorkflowEntries(nextWorkflowEntries, nextLogCategory, nextLogMessage, nextLogDetail);
            setWorkflowEntries(nextWorkflowEntries);
            void persistCurrentDiagnosticSummary({
                workflowResolution: response.workflow_resolution,
                classification: response.workflow_resolution.classification || null,
                recommendation: secretExecution?.recommendation || hiddenExecution?.recommendation || imageExecution?.recommendation || recommendation,
                recommendationSourceText: (
                    secretExecution?.selected_fragment?.text
                    || hiddenExecution?.selected_fragment?.text
                    || imageExecution?.selected_fragment?.text
                    || recommendationSourceText
                ).trim(),
                workflowEntries: nextWorkflowEntries,
            });
        } catch (workflowError: any) {
            setError(workflowError?.message || "Impossible d'executer l'etape du workflow");
        } finally {
            setRunningWorkflowStepId(null);
        }
    }, [
        appendWorkflowEntry,
        geocacheContext,
        maxPlugins,
        pluginsService,
        preset,
        primaryWorkflow?.kind,
        text,
        derivedCheckerCandidate,
        persistCurrentDiagnosticSummary,
        recommendation,
        recommendationSourceText,
        workflowResolution,
        workflowEntries,
    ]);

    const suggestedShortcuts = React.useMemo(() => {
        const actions: Array<{
            id: string;
            label: string;
            onClick: () => void;
            disabled: boolean;
            title: string;
        }> = [];
        const plannedStepIds = new Set(
            (workflowResolution?.plan || [])
                .filter(step => step.status === 'planned' || step.status === 'completed')
                .map(step => step.id)
        );
        const addAction = (
            id: string,
            label: string,
            onClick: () => void,
            actionDisabled: boolean,
            title: string,
        ) => {
            if (actions.some(action => action.id === id)) {
                return;
            }
            actions.push({ id, label, onClick, disabled: actionDisabled, title });
        };

        if (plannedStepIds.has('extract-secret-fragment') && bestSecretFragment) {
            addAction(
                'use-best-fragment',
                'Utiliser le meilleur fragment',
                () => applySecretFragment(bestSecretFragment.text),
                disabled,
                'Injecter le fragment principal dans le texte courant'
            );
        }
        if (plannedStepIds.has('recommend-metasolver-plugins') && recommendation) {
            addAction(
                'apply-recommendation',
                'Appliquer la recommandation',
                () => void applyRecommendation(),
                disabled || loadingRecommendation || !recommendation,
                'Appliquer la sous-liste de plugins metasolver recommandee'
            );
        }
        if (plannedStepIds.has('execute-metasolver') && bestSecretFragment) {
            addAction(
                'execute-best-fragment',
                'Executer le meilleur fragment',
                () => executeBestSecretFragment(),
                disabled,
                'Utiliser le meilleur fragment puis executer metasolver'
            );
        }
        if (plannedStepIds.has('inspect-hidden-html')) {
            addAction(
                'inspect-hidden-html',
                'Inspecter le HTML cache',
                () => { void runWorkflowStep('inspect-hidden-html'); },
                disabled || runningWorkflowStepId !== null,
                'Extraire les commentaires HTML et les textes invisibles avant tout decodage'
            );
        }
        if (plannedStepIds.has('inspect-images')) {
            addAction(
                'inspect-images',
                'Inspecter les images',
                () => { void runWorkflowStep('inspect-images'); },
                disabled || runningWorkflowStepId !== null,
                'Extraire les textes alt/title et lancer OCR/QR sur les images si possible'
            );
        }
        if (plannedStepIds.has('search-answers')) {
            addAction(
                'search-formula-answers',
                'Rechercher les reponses web',
                () => { void runWorkflowStep('search-answers'); },
                disabled || runningWorkflowStepId !== null,
                'Lancer la recherche web backend pour les questions de formule'
            );
        }
        if (plannedStepIds.has('calculate-final-coordinates')) {
            addAction(
                'calculate-formula-coordinates',
                'Calculer les coordonnees',
                () => { void runWorkflowStep('calculate-final-coordinates'); },
                disabled || runningWorkflowStepId !== null,
                'Calculer les coordonnees finales avec les valeurs disponibles'
            );
        }
        if (plannedStepIds.has('validate-with-checker')) {
            addAction(
                'validate-with-checker',
                'Valider avec checker',
                () => { void runWorkflowStep('validate-with-checker'); },
                disabled || runningWorkflowStepId !== null || !derivedCheckerCandidate,
                derivedCheckerCandidate
                    ? 'Executer le checker avec le meilleur candidat courant'
                    : 'Aucun candidat exploitable pour le checker'
            );
        }
        if (
            (plannedStepIds.has('detect-formulas')
                || plannedStepIds.has('extract-questions')
                || plannedStepIds.has('search-answers')
                || plannedStepIds.has('calculate-final-coordinates'))
            && formulaGeocacheId
        ) {
            addAction(
                'open-formula-solver',
                'Ouvrir Formula Solver',
                () => { void openFormulaSolver(); },
                disabled || !formulaGeocacheId,
                'Basculer vers le workflow Formula Solver pour cette geocache'
            );
        }
        if (plannedStepIds.has('inspect-hidden-html') || plannedStepIds.has('inspect-images') || plannedStepIds.has('validate-with-checker')) {
            addAction(
                'send-chat-contextual',
                'Envoyer au chat GeoApp',
                () => sendDiagnosticToGeoAppChat(),
                disabled || loadingClassification || loadingRecommendation || !canSendToGeoAppChat,
                'Ouvrir ou reutiliser un chat GeoApp avec le diagnostic courant'
            );
        }
        if (actions.length === 0 && canSendToGeoAppChat) {
            addAction(
                'send-chat-fallback',
                'Envoyer au chat GeoApp',
                () => sendDiagnosticToGeoAppChat(),
                disabled || loadingClassification || loadingRecommendation || !canSendToGeoAppChat,
                'Continuer l analyse dans le chat GeoApp'
            );
        }

        return actions;
    }, [
        workflowResolution?.plan,
        bestSecretFragment,
        recommendation,
        formulaGeocacheId,
        derivedCheckerCandidate,
        canSendToGeoAppChat,
        disabled,
        loadingClassification,
        loadingRecommendation,
        runningWorkflowStepId,
        applySecretFragment,
        applyRecommendation,
        executeBestSecretFragment,
        openFormulaSolver,
        runWorkflowStep,
        sendDiagnosticToGeoAppChat,
    ]);

    return (
        <div className='plugin-form'>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
                <h4 style={{ margin: 0 }}>🔎 Sélection assistée metasolver</h4>
                <div style={{ fontSize: '11px', opacity: 0.7 }}>
                    {selectionMode === 'recommended' ? 'Mode recommandé' : selectionMode === 'preset' ? 'Mode preset complet' : 'Mode manuel'}
                </div>
            </div>

            {archivedResumeState && (
                <div style={{ marginTop: '8px', display: 'flex', justifyContent: 'flex-end' }}>
                    <button
                        className='theia-button secondary'
                        type='button'
                        onClick={() => applyArchivedResumeSnapshot(archivedResumeState, 'manual')}
                        disabled={disabled}
                        title={archivedResumeState.updatedAt
                            ? `Restaurer le snapshot archive du ${new Date(archivedResumeState.updatedAt).toLocaleString('fr-FR')}`
                            : "Restaurer le dernier snapshot archive"}
                        style={{ fontSize: '11px', padding: '2px 8px' }}
                    >
                        Restaurer l&apos;archive
                    </button>
                </div>
            )}

            {error && (
                <div style={{ color: 'var(--theia-errorForeground)', fontSize: '12px', marginTop: '6px' }}>
                    Erreur : {error}
                </div>
            )}

            {(loadingClassification || workflowResolution || classification) && (
                <div style={{
                    marginTop: '10px',
                    padding: '10px',
                    border: '1px solid var(--theia-panel-border)',
                    borderRadius: '4px',
                    background: 'var(--theia-editor-background)'
                }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' }}>
                        <div style={{ fontSize: '12px', fontWeight: 600 }}>
                            Diagnostic du listing
                        </div>
                        <div style={{ fontSize: '11px', opacity: 0.7 }}>
                            {loadingClassification ? 'Analyse...' : ((workflowResolution?.source || classification?.source) === 'geocache' ? 'Source geocache' : 'Source texte')}
                        </div>
                    </div>

                    {primaryWorkflow && (
                        <div style={{ marginTop: '8px' }}>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center' }}>
                                <span style={{
                                    fontSize: '11px',
                                    padding: '2px 8px',
                                    borderRadius: '999px',
                                    background: 'var(--theia-list-activeSelectionBackground)',
                                    border: '1px solid var(--theia-panel-border)',
                                    fontWeight: 600,
                                }}>
                                    Workflow principal: {WORKFLOW_TITLES[primaryWorkflow.kind] || primaryWorkflow.kind} {(primaryWorkflow.confidence * 100).toFixed(0)}%
                                </span>
                                {primaryWorkflow.forced ? (
                                    <span style={{
                                        fontSize: '10px',
                                        padding: '1px 6px',
                                        borderRadius: '999px',
                                        background: 'var(--theia-input-background)',
                                        border: '1px solid var(--theia-panel-border)',
                                    }}>
                                        force
                                    </span>
                                ) : null}
                            </div>
                            {workflowResolution?.explanation?.length ? (
                                <div style={{ marginTop: '6px', fontSize: '11px', opacity: 0.78 }}>
                                    {workflowResolution.explanation.slice(0, 3).join(' - ')}
                                </div>
                            ) : null}
                            {workflowResolution?.workflow_candidates?.length ? (
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '6px' }}>
                                    {workflowResolution.workflow_candidates.slice(0, 3).map(candidate => (
                                        <span
                                            key={`${candidate.kind}-${candidate.score}`}
                                            title={candidate.reason}
                                            style={{
                                                fontSize: '10px',
                                                padding: '1px 6px',
                                                borderRadius: '999px',
                                                background: 'var(--theia-input-background)',
                                                border: '1px solid var(--theia-panel-border)',
                                            }}
                                        >
                                            {WORKFLOW_TITLES[candidate.kind] || candidate.kind} {(candidate.confidence * 100).toFixed(0)}%
                                        </span>
                                    ))}
                                </div>
                            ) : null}
                        </div>
                    )}

                    {classification?.labels && classification.labels.length > 0 && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '8px' }}>
                            {classification.labels.map(label => (
                                <span
                                    key={label.name}
                                    title={label.evidence.join(' - ')}
                                    style={{
                                        fontSize: '11px',
                                        padding: '2px 8px',
                                        borderRadius: '999px',
                                        background: label.name === 'secret_code'
                                            ? 'var(--theia-list-activeSelectionBackground)'
                                            : 'var(--theia-input-background)',
                                        border: '1px solid var(--theia-panel-border)'
                                    }}
                                >
                                    {LISTING_LABEL_TITLES[label.name] || label.name} {(label.confidence * 100).toFixed(0)}%
                                </span>
                            ))}
                        </div>
                    )}

                    {classification?.recommended_actions?.length ? (
                        <div style={{ marginTop: '8px', fontSize: '11px', opacity: 0.8 }}>
                            {classification.recommended_actions.slice(0, 2).join(' ')}
                        </div>
                    ) : null}

                    {workflowResolution?.plan?.length ? (
                        <div style={{ marginTop: '10px' }}>
                            <div style={{ fontSize: '12px', fontWeight: 600, marginBottom: '6px' }}>
                                Plan d action
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                {workflowResolution.plan.slice(0, 5).map(step => (
                                    <div
                                        key={step.id}
                                        style={{
                                            padding: '6px 8px',
                                            border: '1px solid var(--theia-panel-border)',
                                            borderRadius: '4px',
                                            background: getPlanStatusBackground(step.status),
                                            fontSize: '11px',
                                        }}
                                    >
                                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'center' }}>
                                            <span style={{
                                                fontSize: '10px',
                                                padding: '1px 6px',
                                                borderRadius: '999px',
                                                background: 'var(--theia-editor-background)',
                                                border: '1px solid var(--theia-panel-border)',
                                            }}>
                                                {PLAN_STATUS_LABELS[step.status] || step.status}
                                            </span>
                                            <span style={{ opacity: 0.7 }}>
                                                {step.automated ? 'auto' : 'manuel'}{step.tool ? ` - ${step.tool}` : ''}
                                            </span>
                                        </div>
                                        <div style={{ marginTop: '4px' }}>{step.title}</div>
                                        {step.detail ? (
                                            <div style={{ marginTop: '2px', opacity: 0.75 }}>{step.detail}</div>
                                        ) : null}
                                    </div>
                                ))}
                            </div>
                        </div>
                    ) : null}

                    {workflowResolution?.next_actions?.length ? (
                        <div style={{ marginTop: '8px', fontSize: '11px', opacity: 0.78 }}>
                            Prochaines actions : {workflowResolution.next_actions.slice(0, 4).join(' - ')}
                        </div>
                    ) : null}

                    {workflowResolution?.control ? (
                        <div style={{ marginTop: '8px', fontSize: '11px', opacity: 0.82 }}>
                            <div>
                                Controle : <strong>{WORKFLOW_CONTROL_STATUS_LABELS[workflowResolution.control.status] || workflowResolution.control.status}</strong>
                                {' - '}
                                {workflowResolution.control.summary}
                            </div>
                            <div style={{ marginTop: '2px', opacity: 0.78 }}>
                                Budget auto {workflowResolution.control.usage.automated_steps}/{workflowResolution.control.budget.max_automated_steps}
                                {' - '}
                                metasolver {workflowResolution.control.usage.metasolver_runs}/{workflowResolution.control.budget.max_metasolver_runs}
                                {' - '}
                                vision OCR budget {workflowResolution.control.usage.vision_ocr_runs}/{workflowResolution.control.budget.max_vision_ocr_runs}
                                {' - '}
                                checker {workflowResolution.control.usage.checker_runs}/{workflowResolution.control.budget.max_checker_runs}
                                {' - '}
                                confiance finale {(workflowResolution.control.final_confidence * 100).toFixed(0)}%
                            </div>
                            {workflowResolution.control.stop_reasons.length ? (
                                <div style={{ marginTop: '2px', color: 'var(--theia-descriptionForeground)' }}>
                                    Arret : {workflowResolution.control.stop_reasons.slice(0, 2).join(' - ')}
                                </div>
                            ) : null}
                        </div>
                    ) : null}

                    {canSendToGeoAppChat && (
                        <div style={{ marginTop: '8px', fontSize: '11px', opacity: 0.75 }}>
                            Profil chat GeoApp prevu : <strong>{geoAppChatProfile}</strong>
                            {' - '}
                            workflow <strong>{geoAppWorkflowKind}</strong>
                        </div>
                    )}

                    {suggestedShortcuts.length > 0 && (
                        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '10px' }}>
                            {suggestedShortcuts.map(action => (
                                <button
                                    key={action.id}
                                    type='button'
                                    className='theia-button secondary'
                                    onClick={action.onClick}
                                    disabled={action.disabled}
                                    title={action.title}
                                >
                                    {action.label}
                                </button>
                            ))}
                        </div>
                    )}

                    {classification?.formula_signals?.length ? (
                        <div style={{ marginTop: '8px', fontSize: '11px', opacity: 0.75 }}>
                            Signaux formule : {classification.formula_signals.slice(0, 3).join(' - ')}
                        </div>
                    ) : null}

                    {hiddenExecution && (
                        <div style={{ marginTop: '10px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', alignItems: 'center', marginBottom: '6px' }}>
                                <div style={{ fontSize: '12px', fontWeight: 600 }}>
                                    Contenu cache
                                </div>
                                {hiddenSelectedFragment ? (
                                    <button
                                        type='button'
                                        className='theia-button secondary'
                                        onClick={() => applySecretFragment(hiddenSelectedFragment.text)}
                                        disabled={disabled}
                                        title='Injecter le fragment cache principal dans le texte courant'
                                    >
                                        Utiliser le fragment cache
                                    </button>
                                ) : null}
                            </div>
                            <div style={{
                                padding: '8px 10px',
                                border: '1px solid var(--theia-panel-border)',
                                borderRadius: '4px',
                                background: 'var(--theia-input-background)',
                                fontSize: '11px',
                                display: 'grid',
                                gap: '6px',
                            }}>
                                {hiddenExecution.summary ? (
                                    <div>{truncateDiagnosticText(hiddenExecution.summary, 180)}</div>
                                ) : null}
                                {hiddenExecution.hidden_signals?.length ? (
                                    <div style={{ opacity: 0.8 }}>
                                        Signaux : {hiddenExecution.hidden_signals.slice(0, 4).join(' - ')}
                                    </div>
                                ) : null}
                                {hiddenExecution.items?.length ? (
                                    <div style={{ display: 'grid', gap: '4px' }}>
                                        {hiddenExecution.items.slice(0, 4).map((item, index) => (
                                            <div key={`${item.source}-${index}`} style={{ opacity: 0.84 }}>
                                                <strong>{item.reason}:</strong> {truncateDiagnosticText(item.text, 180)}
                                            </div>
                                        ))}
                                    </div>
                                ) : null}
                                {hiddenExecution.recommendation?.selected_plugins?.length ? (
                                    <div style={{ opacity: 0.8 }}>
                                        Recommandation metasolver : {hiddenExecution.recommendation.selected_plugins.slice(0, 5).join(', ')}
                                    </div>
                                ) : null}
                            </div>
                        </div>
                    )}

                    {imageExecution && (
                        <div style={{ marginTop: '10px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', alignItems: 'center', marginBottom: '6px' }}>
                                <div style={{ fontSize: '12px', fontWeight: 600 }}>
                                    Images / OCR
                                </div>
                                {imageSelectedFragment ? (
                                    <button
                                        type='button'
                                        className='theia-button secondary'
                                        onClick={() => applySecretFragment(imageSelectedFragment.text)}
                                        disabled={disabled}
                                        title='Injecter le fragment principal extrait des images dans le texte courant'
                                    >
                                        Utiliser le fragment image
                                    </button>
                                ) : null}
                            </div>
                            <div style={{
                                padding: '8px 10px',
                                border: '1px solid var(--theia-panel-border)',
                                borderRadius: '4px',
                                background: 'var(--theia-input-background)',
                                fontSize: '11px',
                                display: 'grid',
                                gap: '6px',
                            }}>
                                {imageExecution.summary ? (
                                    <div>{truncateDiagnosticText(imageExecution.summary, 180)}</div>
                                ) : null}
                                <div style={{ opacity: 0.8 }}>
                                    {imageExecution.image_count || 0} image(s) detectee(s)
                                </div>
                                {imageExecution.items?.length ? (
                                    <div style={{ display: 'grid', gap: '4px' }}>
                                        {imageExecution.items.slice(0, 4).map((item, index) => (
                                            <div key={`${item.source}-${index}`} style={{ opacity: 0.84 }}>
                                                <strong>{item.reason}:</strong> {truncateDiagnosticText(item.text, 180)}
                                            </div>
                                        ))}
                                    </div>
                                ) : null}
                                {imageExecution.plugin_summaries?.length ? (
                                    <div style={{ opacity: 0.78 }}>
                                        Plugins image : {imageExecution.plugin_summaries.slice(0, 3).join(' - ')}
                                    </div>
                                ) : null}
                                {imageExecution.recommendation?.selected_plugins?.length ? (
                                    <div style={{ opacity: 0.8 }}>
                                        Recommandation metasolver : {imageExecution.recommendation.selected_plugins.slice(0, 5).join(', ')}
                                    </div>
                                ) : null}
                                {imageExecution.coordinates_candidate ? (
                                    <div style={{ opacity: 0.8 }}>
                                        Coordonnees candidates : {formatCheckerCandidateFromCoordinates(imageExecution.coordinates_candidate)}
                                    </div>
                                ) : null}
                                {imageGeoPlausibility ? (
                                    <div
                                        style={{
                                            marginTop: '4px',
                                            padding: '6px 8px',
                                            borderRadius: '4px',
                                            background: getGeoPlausibilityAccent(imageGeoPlausibility.status),
                                            border: '1px solid var(--theia-panel-border)',
                                        }}
                                    >
                                        <div>
                                            <strong>{GEO_PLAUSIBILITY_LABELS[imageGeoPlausibility.status] || imageGeoPlausibility.status}</strong>
                                            {' - '}
                                            confiance {(imageGeoPlausibility.score * 100).toFixed(0)}%
                                        </div>
                                        <div style={{ marginTop: '2px', opacity: 0.82 }}>
                                            {imageGeoPlausibility.summary}
                                        </div>
                                        {imageGeoPlausibility.nearest_reference ? (
                                            <div style={{ marginTop: '2px', opacity: 0.75 }}>
                                                Reference la plus proche : {imageGeoPlausibility.nearest_reference.label}
                                                {' - '}
                                                {formatDistanceKm(imageGeoPlausibility.nearest_reference.distance_km)}
                                            </div>
                                        ) : null}
                                    </div>
                                ) : null}
                            </div>
                        </div>
                    )}

                    {formulaAnswerSearch?.answers && Object.keys(formulaAnswerSearch.answers).length > 0 ? (
                        <div style={{ marginTop: '10px' }}>
                            <div style={{ fontSize: '12px', fontWeight: 600, marginBottom: '6px' }}>
                                Reponses formule
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                {Object.entries(formulaAnswerSearch.answers).slice(0, 4).map(([variable, answer]) => (
                                    <div
                                        key={variable}
                                        style={{
                                            padding: '6px 8px',
                                            border: '1px solid var(--theia-panel-border)',
                                            borderRadius: '4px',
                                            background: 'var(--theia-input-background)',
                                            fontSize: '11px',
                                        }}
                                    >
                                        <div style={{ fontWeight: 600 }}>{variable} - {answer.question}</div>
                                        <div style={{ marginTop: '4px' }}>
                                            {answer.best_answer ? truncateDiagnosticText(answer.best_answer, 160) : 'Aucune reponse trouvee'}
                                        </div>
                                        {answer.recommended_value_type ? (
                                            <div style={{ marginTop: '2px', opacity: 0.75 }}>
                                                Conversion suggeree : {answer.recommended_value_type}
                                            </div>
                                        ) : null}
                                    </div>
                                ))}
                            </div>
                        </div>
                    ) : null}

                    {formulaCalculatedCoordinates?.coordinates ? (
                        <div style={{ marginTop: '10px' }}>
                            <div style={{ fontSize: '12px', fontWeight: 600, marginBottom: '6px' }}>
                                Coordonnees calculees
                            </div>
                            <div style={{
                                padding: '8px 10px',
                                border: '1px solid var(--theia-panel-border)',
                                borderRadius: '4px',
                                background: 'var(--theia-input-background)',
                                fontSize: '11px',
                            }}>
                                <div style={{ fontFamily: 'monospace', fontSize: '12px' }}>
                                    {formulaCalculatedCoordinates.coordinates.ddm || formulaCalculatedCoordinates.coordinates.decimal}
                                </div>
                                {formulaCalculatedCoordinates.distance?.km ? (
                                    <div style={{ marginTop: '4px', opacity: 0.75 }}>
                                        Distance depuis l origine : {formulaCalculatedCoordinates.distance.km} km
                                    </div>
                                ) : null}
                                {formulaGeoPlausibility ? (
                                    <div
                                        style={{
                                            marginTop: '8px',
                                            padding: '6px 8px',
                                            borderRadius: '4px',
                                            background: getGeoPlausibilityAccent(formulaGeoPlausibility.status),
                                            border: '1px solid var(--theia-panel-border)',
                                        }}
                                    >
                                        <div>
                                            <strong>{GEO_PLAUSIBILITY_LABELS[formulaGeoPlausibility.status] || formulaGeoPlausibility.status}</strong>
                                            {' - '}
                                            confiance {(formulaGeoPlausibility.score * 100).toFixed(0)}%
                                        </div>
                                        <div style={{ marginTop: '2px', opacity: 0.82 }}>
                                            {formulaGeoPlausibility.summary}
                                        </div>
                                        {formulaGeoPlausibility.nearest_reference ? (
                                            <div style={{ marginTop: '2px', opacity: 0.75 }}>
                                                Reference la plus proche : {formulaGeoPlausibility.nearest_reference.label}
                                                {' - '}
                                                {formatDistanceKm(formulaGeoPlausibility.nearest_reference.distance_km)}
                                            </div>
                                        ) : null}
                                        {formulaGeoPlausibility.reasons?.length ? (
                                            <div style={{ marginTop: '2px', opacity: 0.75 }}>
                                                {formulaGeoPlausibility.reasons.slice(0, 3).join(' - ')}
                                            </div>
                                        ) : null}
                                    </div>
                                ) : null}
                            </div>
                        </div>
                    ) : null}

                    {!formulaCalculatedCoordinates?.coordinates && secretGeoPlausibility ? (
                        <div style={{ marginTop: '10px' }}>
                            <div style={{ fontSize: '12px', fontWeight: 600, marginBottom: '6px' }}>
                                Plausibilite metasolver
                            </div>
                            <div style={{
                                padding: '8px 10px',
                                border: '1px solid var(--theia-panel-border)',
                                borderRadius: '4px',
                                background: getGeoPlausibilityAccent(secretGeoPlausibility.status),
                                fontSize: '11px',
                            }}>
                                <div>
                                    <strong>{GEO_PLAUSIBILITY_LABELS[secretGeoPlausibility.status] || secretGeoPlausibility.status}</strong>
                                    {' - '}
                                    confiance {(secretGeoPlausibility.score * 100).toFixed(0)}%
                                </div>
                                <div style={{ marginTop: '4px', opacity: 0.82 }}>
                                    {secretGeoPlausibility.summary}
                                </div>
                                {secretGeoPlausibility.nearest_reference ? (
                                    <div style={{ marginTop: '4px', opacity: 0.75 }}>
                                        Reference la plus proche : {secretGeoPlausibility.nearest_reference.label}
                                        {' - '}
                                        {formatDistanceKm(secretGeoPlausibility.nearest_reference.distance_km)}
                                    </div>
                                ) : null}
                                {secretGeoPlausibility.reasons?.length ? (
                                    <div style={{ marginTop: '4px', opacity: 0.75 }}>
                                        {secretGeoPlausibility.reasons.slice(0, 3).join(' - ')}
                                    </div>
                                ) : null}
                            </div>
                        </div>
                    ) : null}

                    {checkerExecution?.result ? (
                        <div style={{ marginTop: '10px' }}>
                            <div style={{ fontSize: '12px', fontWeight: 600, marginBottom: '6px' }}>
                                Resultat checker
                            </div>
                            <div style={{
                                padding: '8px 10px',
                                border: '1px solid var(--theia-panel-border)',
                                borderRadius: '4px',
                                background: 'var(--theia-input-background)',
                                fontSize: '11px',
                            }}>
                                <div>
                                    <strong>{checkerExecution.checker_name || checkerExecution.provider || 'Checker'}</strong>
                                    {' - '}
                                    statut <strong>{checkerExecution.result.status || checkerExecution.status || 'unknown'}</strong>
                                </div>
                                {checkerExecution.candidate ? (
                                    <div style={{ marginTop: '4px', fontFamily: 'monospace' }}>
                                        Candidat : {truncateDiagnosticText(checkerExecution.candidate, 160)}
                                    </div>
                                ) : null}
                                {(checkerExecution.result.message || checkerExecution.message) ? (
                                    <div style={{ marginTop: '4px' }}>
                                        {truncateDiagnosticText(String(checkerExecution.result.message || checkerExecution.message), 220)}
                                    </div>
                                ) : null}
                                {checkerExecution.result.evidence ? (
                                    <div style={{ marginTop: '4px', opacity: 0.78 }}>
                                        {truncateDiagnosticText(String(checkerExecution.result.evidence), 220)}
                                    </div>
                                ) : null}
                            </div>
                        </div>
                    ) : null}

                    {classification?.candidate_secret_fragments?.length ? (
                        <div style={{ marginTop: '10px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', alignItems: 'center', marginBottom: '6px' }}>
                                <div style={{ fontSize: '12px', fontWeight: 600 }}>
                                    Fragments de code probables
                                </div>
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                {classification.candidate_secret_fragments.slice(0, 3).map(fragment => {
                                    const fragmentBadges = buildSignatureBadges(fragment.signature).slice(0, 4);
                                    const isCurrentText = (text || '').trim() === fragment.text.trim();
                                    return (
                                        <div
                                            key={`${fragment.source}-${fragment.text}`}
                                            style={{
                                                padding: '8px 10px',
                                                border: '1px solid var(--theia-panel-border)',
                                                borderRadius: '4px',
                                                background: isCurrentText
                                                    ? 'var(--theia-list-activeSelectionBackground)'
                                                    : 'var(--theia-editor-background)'
                                            }}
                                        >
                                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', alignItems: 'center' }}>
                                                <div style={{ fontSize: '11px', opacity: 0.7 }}>
                                                    {fragment.source_kind === 'hidden_html' ? 'HTML cache' : fragment.source}
                                                    {' - '}
                                                    conf {(fragment.confidence * 100).toFixed(0)}%
                                                </div>
                                                <button
                                                    type='button'
                                                    className='theia-button secondary'
                                                    onClick={() => applySecretFragment(fragment.text)}
                                                    disabled={disabled}
                                                >
                                                    {isCurrentText ? 'Fragment actif' : 'Utiliser ce fragment'}
                                                </button>
                                            </div>
                                            <div style={{
                                                marginTop: '6px',
                                                fontFamily: 'monospace',
                                                fontSize: '12px',
                                                overflowX: 'auto',
                                                whiteSpace: 'pre-wrap',
                                                wordBreak: 'break-word'
                                            }}>
                                                {fragment.text}
                                            </div>
                                            {fragmentBadges.length > 0 && (
                                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '6px' }}>
                                                    {fragmentBadges.map(badge => (
                                                        <span
                                                            key={`${fragment.text}-${badge}`}
                                                            style={{
                                                                fontSize: '10px',
                                                                padding: '1px 6px',
                                                                borderRadius: '999px',
                                                                background: 'var(--theia-input-background)',
                                                                border: '1px solid var(--theia-panel-border)'
                                                            }}
                                                        >
                                                            {badge}
                                                        </span>
                                                    ))}
                                                </div>
                                            )}
                                            {fragment.evidence.length > 0 && (
                                                <div style={{ marginTop: '6px', fontSize: '11px', opacity: 0.75 }}>
                                                    {fragment.evidence.slice(0, 2).join(' - ')}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    ) : classification && hasSecretCodeLabel ? (
                        <div style={{ marginTop: '8px', fontSize: '11px', opacity: 0.8 }}>
                            La classification detecte un code secret, mais aucun fragment compact n&apos;a ete extrait automatiquement.
                        </div>
                    ) : null}

                    {classification?.hidden_signals?.length ? (
                        <div style={{ marginTop: '8px', fontSize: '11px', opacity: 0.75 }}>
                            HTML suspect : {classification.hidden_signals.slice(0, 3).join(' - ')}
                        </div>
                    ) : null}

                    {workflowEntries.length > 0 && (
                        <div style={{ marginTop: '10px' }}>
                            <div style={{ fontSize: '12px', fontWeight: 600, marginBottom: '6px' }}>
                                Journal local
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                {workflowEntries.slice(0, 6).map(entry => (
                                    <div
                                        key={entry.id}
                                        style={{
                                            padding: '6px 8px',
                                            border: '1px solid var(--theia-panel-border)',
                                            borderRadius: '4px',
                                            background: 'var(--theia-input-background)',
                                            fontSize: '11px',
                                        }}
                                    >
                                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'center' }}>
                                            <span style={{
                                                fontSize: '10px',
                                                padding: '1px 6px',
                                                borderRadius: '999px',
                                                background: 'var(--theia-editor-background)',
                                                border: '1px solid var(--theia-panel-border)'
                                            }}>
                                                {entry.category}
                                            </span>
                                            <span style={{ opacity: 0.7 }}>{entry.timestamp}</span>
                                        </div>
                                        <div style={{ marginTop: '4px' }}>{entry.message}</div>
                                        {entry.detail ? (
                                            <div style={{ marginTop: '2px', opacity: 0.75 }}>{entry.detail}</div>
                                        ) : null}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {!text.trim() && !workflowResolution && (
                <div style={{ marginTop: '8px', fontSize: '12px', opacity: 0.7 }}>
                    Renseignez le texte à analyser pour obtenir une sélection dynamique.
                </div>
            )}

            {recommendation?.signature && (
                <div style={{
                    marginTop: '10px',
                    padding: '10px',
                    border: '1px solid var(--theia-panel-border)',
                    borderRadius: '4px',
                    background: 'var(--theia-editor-background)'
                }}>
                    <div style={{ fontSize: '12px', fontWeight: 600, marginBottom: '6px' }}>
                        Signature détectée
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                        {signatureBadges.map(badge => (
                            <span
                                key={badge}
                                style={{
                                    fontSize: '11px',
                                    padding: '2px 6px',
                                    borderRadius: '999px',
                                    background: 'var(--theia-input-background)',
                                    border: '1px solid var(--theia-panel-border)'
                                }}
                            >
                                {badge}
                            </span>
                        ))}
                    </div>
                    <div style={{ fontSize: '11px', opacity: 0.75, marginTop: '8px' }}>
                        Preset suggéré : <strong>{recommendation.effective_preset_label || recommendation.effective_preset}</strong>
                    </div>
                </div>
            )}

            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '10px' }}>
                <button
                    type='button'
                    className='theia-button secondary'
                    onClick={() => void applyRecommendation()}
                    disabled={disabled || !recommendation || loadingRecommendation}
                >
                    {loadingRecommendation ? 'Analyse…' : 'Appliquer la recommandation'}
                </button>
                <button
                    type='button'
                    className='theia-button secondary'
                    onClick={() => void useFullPreset()}
                    disabled={disabled || loadingEligible}
                >
                    Utiliser tout le preset
                </button>
                <div style={{ fontSize: '11px', opacity: 0.7, alignSelf: 'center' }}>
                    {includedCount}/{eligiblePlugins.length} plugin(s) sélectionné(s)
                </div>
            </div>

            {recommendation && recommendation.recommendations.length > 0 && (
                <div style={{ marginTop: '10px' }}>
                    <div style={{ fontSize: '12px', fontWeight: 600, marginBottom: '6px' }}>
                        Plugins recommandés
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        {recommendation.recommendations.slice(0, 6).map(plugin => (
                            <div
                                key={plugin.name}
                                style={{
                                    padding: '8px 10px',
                                    border: '1px solid var(--theia-panel-border)',
                                    borderRadius: '4px',
                                    background: currentSelectedPlugins.has(plugin.name)
                                        ? 'var(--theia-list-activeSelectionBackground)'
                                        : 'var(--theia-editor-background)'
                                }}
                            >
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <span style={{
                                        display: 'inline-block',
                                        width: '28px',
                                        textAlign: 'center',
                                        fontSize: '10px',
                                        background: 'var(--theia-input-background)',
                                        borderRadius: '3px',
                                        padding: '1px 2px',
                                        fontWeight: 'bold',
                                        flexShrink: 0,
                                    }}>
                                        {METASOLVER_CHARSET_ICONS[plugin.input_charset] || '?'}
                                    </span>
                                    <strong>{plugin.name}</strong>
                                    <span style={{ fontSize: '11px', opacity: 0.7 }}>
                                        score {plugin.score.toFixed(0)} • conf {(plugin.confidence * 100).toFixed(0)}%
                                    </span>
                                </div>
                                {plugin.reasons.length > 0 && (
                                    <div style={{ marginTop: '4px', fontSize: '11px', opacity: 0.75 }}>
                                        {plugin.reasons.slice(0, 2).join(' • ')}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            <div
                style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', userSelect: 'none', marginTop: '12px' }}
                onClick={() => setExpanded(!expanded)}
            >
                <h4 style={{ margin: 0, flex: 1 }}>
                    🔌 Liste complète ({loadingEligible ? '...' : `${includedCount}/${eligiblePlugins.length}`})
                </h4>
                <span style={{ fontSize: '12px', opacity: 0.7 }}>
                    {expanded ? '▲ Réduire' : '▼ Détails'}
                </span>
            </div>

            {!expanded && !loadingEligible && eligiblePlugins.length > 0 && (
                <div style={{ fontSize: '12px', opacity: 0.7, marginTop: '4px' }}>
                    {Array.from(currentSelectedPlugins).slice(0, 8).join(', ')}
                    {currentSelectedPlugins.size > 8 && ` +${currentSelectedPlugins.size - 8} autres`}
                </div>
            )}

            {expanded && !loadingEligible && (
                <div style={{ marginTop: '8px', maxHeight: '320px', overflowY: 'auto' }}>
                    {eligiblePlugins.length === 0 && (
                        <div style={{ fontSize: '13px', opacity: 0.7 }}>Aucun plugin éligible pour ce preset</div>
                    )}
                    {eligiblePlugins.map(plugin => {
                        const isSelected = currentSelectedPlugins.has(plugin.name);
                        return (
                            <div
                                key={plugin.name}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    padding: '4px 6px',
                                    borderBottom: '1px solid var(--theia-panel-border)',
                                    opacity: isSelected ? 1 : 0.55,
                                    fontSize: '12px',
                                    gap: '6px',
                                }}
                            >
                                <input
                                    type='checkbox'
                                    checked={isSelected}
                                    onChange={(e) => handleTogglePlugin(plugin.name, e.target.checked)}
                                    disabled={disabled}
                                    style={{ margin: 0 }}
                                />
                                <span style={{
                                    display: 'inline-block',
                                    width: '28px',
                                    textAlign: 'center',
                                    fontSize: '10px',
                                    background: 'var(--theia-editor-background)',
                                    borderRadius: '3px',
                                    padding: '1px 2px',
                                    fontWeight: 'bold',
                                    flexShrink: 0,
                                }}>
                                    {METASOLVER_CHARSET_ICONS[plugin.input_charset] || '?'}
                                </span>
                                <span style={{ fontWeight: 500, minWidth: '120px' }}>{plugin.name}</span>
                                <span style={{ opacity: 0.7, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {plugin.description}
                                </span>
                                <span style={{
                                    fontSize: '10px',
                                    background: 'var(--theia-editor-background)',
                                    borderRadius: '3px',
                                    padding: '1px 4px',
                                    flexShrink: 0,
                                }}>
                                    P{plugin.priority}
                                </span>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};
