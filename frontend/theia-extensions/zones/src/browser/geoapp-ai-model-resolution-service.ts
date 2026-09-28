import { inject, injectable, optional, postConstruct } from '@theia/core/shared/inversify';
import { PreferenceService } from '@theia/core/lib/common/preferences/preference-service';
import { Emitter, Event as TheiaEvent } from '@theia/core/lib/common/event';
import {
    AgentService,
    AISettingsService,
    LanguageModel,
    LanguageModelRegistry,
} from '@theia/ai-core';
import {
    GeoAppAiExecutionPath,
    GeoAppAiModelResolution,
    GeoAppAiModelSource,
    GeoAppAiTaskDescriptor,
} from '@mysterai/theia-plugins/lib/common/ai-model-contract';
import {
    GeoAppAiScorerModelResolver,
    GEOAPP_AI_SCORER_AGENT_ID,
} from '@mysterai/theia-plugins/lib/browser/services/ai-scorer-model-resolver';
import {
    checkGeoAppLocalEndpoint,
    checkGeoAppLocalModel,
    GeoAppLocalModelPreferences,
    GEOAPP_LOCAL_MODEL_IDS_PREF,
} from './geoapp-local-model-guard';

export const GEOAPP_AI_TASKS: GeoAppAiTaskDescriptor[] = [
    { id: 'chat-main', label: 'GeoApp (principal)', agentId: 'GeoApp', purpose: 'chat', kind: 'chat', executionPath: 'theia-language-model' },
    { id: 'chat-local', label: 'GeoApp Chat (Local)', agentId: 'geoapp-chat-local', purpose: 'chat', kind: 'chat', executionPath: 'theia-language-model', requiresLocalModel: true },
    { id: 'chat-fast', label: 'GeoApp Chat (Fast)', agentId: 'geoapp-chat-fast', purpose: 'chat', kind: 'chat', executionPath: 'theia-language-model' },
    { id: 'chat-strong', label: 'GeoApp Chat (Strong)', agentId: 'geoapp-chat-strong', purpose: 'chat', kind: 'chat', executionPath: 'theia-language-model' },
    { id: 'chat-web', label: 'GeoApp Chat (Web)', agentId: 'geoapp-chat-web', purpose: 'chat', kind: 'chat', executionPath: 'theia-language-model' },
    { id: 'earthcoach', label: 'EarthCoach', agentId: 'earthcoach', purpose: 'chat', kind: 'chat', executionPath: 'theia-language-model' },
    { id: 'aide', label: '@Aide', agentId: 'geoapp-doc-aide', purpose: 'chat', kind: 'chat', executionPath: 'theia-language-model' },
    { id: 'formula-local', label: 'Formula Solver (Local)', agentId: 'geoapp-formula-solver-local', purpose: 'formula-solving', kind: 'internal', executionPath: 'theia-language-model', requiresLocalModel: true },
    { id: 'formula-fast', label: 'Formula Solver (Fast)', agentId: 'geoapp-formula-solver-fast', purpose: 'formula-solving', kind: 'internal', executionPath: 'theia-language-model' },
    { id: 'formula-strong', label: 'Formula Solver (Strong)', agentId: 'geoapp-formula-solver-strong', purpose: 'formula-solving', kind: 'internal', executionPath: 'theia-language-model' },
    { id: 'formula-web', label: 'Formula Solver (Web)', agentId: 'geoapp-formula-solver-web', purpose: 'formula-solving', kind: 'internal', executionPath: 'theia-language-model' },
    { id: 'outing-analysis', label: 'Analyse de sortie', agentId: 'geoapp-outing-analyzer', purpose: 'chat', kind: 'chat', executionPath: 'theia-language-model' },
    { id: 'ocr-theia', label: 'OCR galerie via Theia', agentId: 'geoapp-ocr', purpose: 'vision-ocr', kind: 'internal', executionPath: 'theia-language-model' },
    { id: 'ocr-backend-plugin', label: 'OCR plugin vision_ocr', kind: 'backend', executionPath: 'backend-plugin' },
    { id: 'translate-description', label: 'Traduction descriptions', agentId: 'geoapp-translate-description', purpose: 'chat', kind: 'internal', executionPath: 'theia-language-model' },
    { id: 'logs-analysis', label: 'Analyse des logs', agentId: 'geoapp-logs-analyzer', purpose: 'chat', kind: 'internal', executionPath: 'theia-language-model' },
    { id: 'log-improve', label: 'Correction de logs', agentId: 'geoapp-log-improver', purpose: 'chat', kind: 'internal', executionPath: 'theia-language-model' },
    { id: 'log-translate', label: 'Traduction de logs', agentId: 'geoapp-log-translator', purpose: 'chat', kind: 'internal', executionPath: 'theia-language-model' },
    { id: 'ai-scorer', label: 'AI Scorer (plugins)', agentId: GEOAPP_AI_SCORER_AGENT_ID, purpose: 'chat', kind: 'internal', executionPath: 'backend-plugin' },
];

const OPENROUTER_SLOT_PREFS: Record<string, string> = {
    'openrouter/fast': 'geoApp.ai.openRouter.model.fast',
    'openrouter/strong': 'geoApp.ai.openRouter.model.strong',
    'openrouter/web': 'geoApp.ai.openRouter.model.web',
    'openrouter/vision': 'geoApp.ocr.openRouter.model',
};

@injectable()
export class GeoAppAiModelResolutionService {

    protected readonly onDidChangeEmitter = new Emitter<void>();
    readonly onDidChange: TheiaEvent<void> = this.onDidChangeEmitter.event;

    @inject(PreferenceService)
    protected readonly preferenceService!: PreferenceService;

    @inject(LanguageModelRegistry) @optional()
    protected readonly languageModelRegistry: LanguageModelRegistry | undefined;

    @inject(AISettingsService) @optional()
    protected readonly aiSettingsService: AISettingsService | undefined;

    @inject(AgentService) @optional()
    protected readonly agentService: AgentService | undefined;

    @inject(GeoAppAiScorerModelResolver) @optional()
    protected readonly aiScorerModelResolver: GeoAppAiScorerModelResolver | undefined;

    @postConstruct()
    protected init(): void {
        this.languageModelRegistry?.onChange(() => this.onDidChangeEmitter.fire());
        this.preferenceService.onPreferenceChanged(event => {
            const preference = event.preferenceName || '';
            if (preference.startsWith('geoApp.ai.')
                || preference.startsWith('geoApp.aiScorer.')
                || preference.startsWith('geoApp.ocr.')
                || preference.startsWith('ai-features.')) {
                this.onDidChangeEmitter.fire();
            }
        });
    }

    getTasks(): GeoAppAiTaskDescriptor[] {
        return GEOAPP_AI_TASKS;
    }

    async resolveAll(): Promise<GeoAppAiModelResolution[]> {
        return Promise.all(GEOAPP_AI_TASKS.map(task => this.resolveTask(task)));
    }

    async resolveForAgent(agentId: string): Promise<GeoAppAiModelResolution[]> {
        return Promise.all(
            GEOAPP_AI_TASKS
                .filter(task => task.agentId === agentId)
                .map(task => this.resolveTask(task))
        );
    }

    async resolveTask(task: GeoAppAiTaskDescriptor): Promise<GeoAppAiModelResolution> {
        if (task.id === 'ai-scorer') {
            return this.resolveAiScorer(task);
        }
        if (task.executionPath === 'backend-plugin') {
            return this.resolveVisionBackendTask(task);
        }
        return this.resolveTheiaTask(task);
    }

    protected async resolveTheiaTask(task: GeoAppAiTaskDescriptor): Promise<GeoAppAiModelResolution> {
        const diagnostics: string[] = [];
        const base = this.baseResolution(task, 'theia-language-model');
        if (!task.agentId || !task.purpose) {
            return {
                ...base,
                status: 'unconfigured',
                diagnostics: ['La tâche ne déclare ni agent ni usage de modèle.'],
            };
        }
        if (!this.languageModelRegistry) {
            return {
                ...base,
                agentId: task.agentId,
                purpose: task.purpose,
                status: 'unavailable',
                diagnostics: ['Registre de modèles Theia indisponible.'],
            };
        }

        let requestedIdentifier = 'default/universal';
        let source: GeoAppAiModelSource = 'default';
        let sourceLabel = 'modèle par défaut de l’agent';
        try {
            const agentRequirement = this.getAgentRequirement(task.agentId, task.purpose);
            requestedIdentifier = agentRequirement?.identifier || requestedIdentifier;
            const override = await this.getAssignedIdentifier(task.agentId, task.purpose);
            if (override) {
                requestedIdentifier = override;
                source = 'agent';
                sourceLabel = 'affectation Theia de l’agent';
            }
        } catch (error) {
            return {
                ...base,
                agentId: task.agentId,
                purpose: task.purpose,
                requestedIdentifier,
                source: 'unresolved',
                sourceLabel: 'affectation illisible',
                status: 'unavailable',
                diagnostics: [`Impossible de lire l’affectation Theia : ${this.errorMessage(error)}`],
            };
        }

        let model: LanguageModel | undefined;
        try {
            model = await this.languageModelRegistry.selectLanguageModel({
                agent: task.agentId,
                purpose: task.purpose,
                identifier: requestedIdentifier,
            });
        } catch (error) {
            diagnostics.push(`Résolution du modèle impossible : ${this.errorMessage(error)}`);
        }

        if (!model) {
            return {
                ...base,
                agentId: task.agentId,
                purpose: task.purpose,
                requestedIdentifier,
                source,
                sourceLabel,
                status: 'unavailable',
                diagnostics: diagnostics.length ? diagnostics : ['Aucun modèle prêt pour cette affectation.'],
            };
        }

        const localCheck = checkGeoAppLocalModel(model, this.getLocalModelPreferences());
        if (task.requiresLocalModel && localCheck.status !== 'local') {
            diagnostics.push(`Non compatible local/offline : ${localCheck.reason}.`);
        }
        const backingPreference = OPENROUTER_SLOT_PREFS[model.id];
        const backingModel = backingPreference
            ? this.preferenceService.get<string>(backingPreference, '')
            : undefined;

        return {
            ...base,
            agentId: task.agentId,
            purpose: task.purpose,
            requestedIdentifier,
            resolvedModelId: model.id,
            displayModel: model.name && model.name !== model.id ? `${model.name} · ${model.id}` : model.id,
            vendor: model.vendor,
            provider: this.inferProvider(model.id, model.vendor),
            transport: 'theia-managed',
            backingModel: backingModel || undefined,
            backingPreference,
            source,
            sourceLabel,
            locality: localCheck.status,
            status: diagnostics.length ? 'incompatible' : 'ready',
            diagnostics,
        };
    }

    protected async resolveAiScorer(task: GeoAppAiTaskDescriptor): Promise<GeoAppAiModelResolution> {
        const base = this.baseResolution(task, 'backend-plugin');
        if (!this.aiScorerModelResolver) {
            return {
                ...base,
                agentId: task.agentId,
                purpose: task.purpose,
                status: 'unavailable',
                diagnostics: ['Le résolveur AI Scorer n’est pas disponible.'],
            };
        }
        try {
            const runtime = await this.aiScorerModelResolver.resolveForRequest({});
            const locality = runtime.provider === 'openrouter' || runtime.provider === 'openai'
                ? 'remote'
                : checkGeoAppLocalEndpoint(runtime.base_url).status;
            const resolved = runtime.theiaModelId || runtime.model;
            return {
                ...base,
                agentId: task.agentId,
                purpose: task.purpose,
                requestedIdentifier: runtime.assignedIdentifier,
                resolvedModelId: resolved || undefined,
                displayModel: runtime.theiaModelId && runtime.model
                    ? `${runtime.theiaModelId} → ${runtime.provider}/${runtime.model}`
                    : `${runtime.provider}/${runtime.model || 'auto-détection'}`,
                provider: runtime.provider,
                transport: 'chat-completions',
                backingModel: runtime.model || undefined,
                source: this.mapScorerSource(runtime.source),
                sourceLabel: runtime.sourceLabel,
                locality,
                status: runtime.model ? 'ready' : 'unconfigured',
                diagnostics: runtime.model ? [] : ['Aucun modèle backend configuré pour le scoring.'],
            };
        } catch (error) {
            return {
                ...base,
                agentId: task.agentId,
                purpose: task.purpose,
                source: 'unresolved',
                sourceLabel: 'affectation non exécutable',
                locality: 'unknown',
                status: 'unsupported',
                diagnostics: [this.errorMessage(error)],
            };
        }
    }

    protected resolveVisionBackendTask(task: GeoAppAiTaskDescriptor): GeoAppAiModelResolution {
        const provider = this.preferenceService.get<string>('geoApp.ocr.visionProvider', 'lmstudio') === 'openrouter'
            ? 'openrouter'
            : 'lmstudio';
        const model = provider === 'openrouter'
            ? this.preferenceService.get<string>('geoApp.ocr.openRouter.model', 'openai/gpt-4o-mini')
            : this.preferenceService.get<string>('geoApp.ocr.lmstudio.model', '');
        const baseUrl = provider === 'openrouter'
            ? this.preferenceService.get<string>('geoApp.ai.openRouter.baseUrl', 'https://openrouter.ai/api/v1')
            : this.preferenceService.get<string>('geoApp.ocr.lmstudio.baseUrl', 'http://localhost:1234');
        const locality = provider === 'openrouter' ? 'remote' : checkGeoAppLocalEndpoint(baseUrl).status;
        return {
            ...this.baseResolution(task, 'backend-plugin'),
            resolvedModelId: model || undefined,
            displayModel: `${provider}/${model || 'modèle manquant'}`,
            provider,
            transport: 'chat-completions',
            backingModel: model || undefined,
            backingPreference: provider === 'openrouter' ? 'geoApp.ocr.openRouter.model' : 'geoApp.ocr.lmstudio.model',
            source: 'task-preference',
            sourceLabel: 'préférences geoApp.ocr.*',
            locality,
            status: model ? 'ready' : 'unconfigured',
            diagnostics: model ? [] : ['Aucun modèle configuré pour le plugin vision_ocr.'],
        };
    }

    protected baseResolution(
        task: GeoAppAiTaskDescriptor,
        executionPath: GeoAppAiExecutionPath
    ): Pick<GeoAppAiModelResolution,
        'taskId' | 'taskLabel' | 'kind' | 'executionPath' | 'source' | 'sourceLabel' | 'locality' | 'status' | 'diagnostics' | 'requiresLocalModel'> {
        return {
            taskId: task.id,
            taskLabel: task.label,
            kind: task.kind,
            executionPath,
            source: 'unresolved',
            sourceLabel: 'non résolu',
            locality: 'unknown',
            status: 'unavailable',
            diagnostics: [],
            requiresLocalModel: task.requiresLocalModel,
        };
    }

    protected getAgentRequirement(agentId: string, purpose: string): { identifier?: string } | undefined {
        const agent = this.agentService?.getAllAgents().find(candidate => candidate.id === agentId);
        return agent?.languageModelRequirements.find(requirement => requirement.purpose === purpose);
    }

    protected async getAssignedIdentifier(agentId: string, purpose: string): Promise<string | undefined> {
        if (!this.aiSettingsService) {
            return undefined;
        }
        const settings = await this.aiSettingsService.getAgentSettings(agentId);
        return settings?.languageModelRequirements
            ?.find(requirement => requirement.purpose === purpose)
            ?.identifier;
    }

    protected getLocalModelPreferences(): GeoAppLocalModelPreferences {
        return {
            ollamaHost: this.preferenceService.get<string>('ai-features.ollama.ollamaHost', 'http://localhost:11434'),
            lmstudioBaseUrl: this.preferenceService.get<string>('geoApp.ocr.lmstudio.baseUrl', 'http://localhost:1234'),
            openAiCustomModels: this.preferenceService.get('ai-features.openAiCustom.customOpenAiModels', []),
            vercelCustomModels: this.preferenceService.get('ai-features.vercelAi.customModels', []),
            localModelIds: this.preferenceService.get(GEOAPP_LOCAL_MODEL_IDS_PREF, []),
        };
    }

    protected inferProvider(modelId: string, vendor?: string): string | undefined {
        const normalizedId = modelId.toLowerCase();
        if (normalizedId.startsWith('openrouter/')) {
            return 'openrouter';
        }
        if (normalizedId.startsWith('vercel/openai/')) {
            return 'openai';
        }
        const prefix = normalizedId.split('/', 1)[0];
        if (prefix && prefix !== normalizedId) {
            return prefix === 'lmstudio' ? 'lmstudio' : prefix;
        }
        return vendor?.toLowerCase();
    }

    protected mapScorerSource(source: 'agent' | 'request' | 'preferences'): GeoAppAiModelSource {
        if (source === 'request') {
            return 'operation';
        }
        return source === 'agent' ? 'agent' : 'task-preference';
    }

    protected errorMessage(error: unknown): string {
        return error instanceof Error ? error.message : String(error);
    }
}
