import {
    ListingClassificationResponse,
    MetasolverRecommendationResponse,
    ResolutionWorkflowResponse,
} from '../common/plugin-protocol';
import { GeocacheContext } from './plugin-executor-widget';

interface WorkflowEntry {
    type?: string;
    title?: string;
    detail?: string;
    status?: string;
}

export function buildPluginExecutorGeoAppDiagnosticPrompt(
    geocacheContext: GeocacheContext | undefined,
    currentText: string,
    workflowResolution: ResolutionWorkflowResponse | null,
    classification: ListingClassificationResponse | null,
    recommendation: MetasolverRecommendationResponse | null,
    workflowEntries: WorkflowEntry[]
): string {
    return [
        'Tu reprends un diagnostic du Plugin Executor GeoApp.',
        '',
        `Geocache: ${geocacheContext?.gcCode || 'inconnue'} - ${geocacheContext?.name || ''}`.trim(),
        `Workflow detecte: ${workflowResolution?.workflow?.kind || 'general'}`,
        '',
        'Texte courant:',
        currentText || geocacheContext?.description || '',
        '',
        'Classification:',
        JSON.stringify(classification, null, 2),
        '',
        'Recommendation metasolver:',
        JSON.stringify(recommendation, null, 2),
        '',
        'Journal du workflow:',
        JSON.stringify(workflowEntries, null, 2),
        '',
        'Continue l analyse et propose les prochaines actions concretes.',
    ].join('\n');
}
