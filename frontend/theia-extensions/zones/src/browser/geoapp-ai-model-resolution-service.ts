import { inject, injectable, optional, postConstruct } from '@theia/core/shared/inversify';
import { PreferenceService } from '@theia/core/lib/common/preferences/preference-service';
import { PreferenceScope } from '@theia/core/lib/common/preferences/preference-scope';
import { Emitter, Event as TheiaEvent } from '@theia/core/lib/common/event';
import {
    AgentService,
    AISettingsService,
    LanguageModel,
    LanguageModelAliasRegistry,
    LanguageModelRegistry,
    LanguageModelRequirement,
} from '@theia/ai-core';
import {
    GeoAppAiCapabilityCheck,
    GeoAppAiCapabilityStatus,
    GeoAppAiExecutionPath,
    GeoAppAiModelCapability,
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
    { id: 'chat-web', label: 'GeoApp Chat (Web)', agentId: 'geoapp-chat-web', purpose: 'chat', kind: 'chat', executionPath: 'theia-language-model', optionalCapabilities: ['web'] },
    { id: 'earthcoach', label: 'EarthCoach', agentId: 'earthcoach', purpose: 'chat', kind: 'chat', executionPath: 'theia-language-model' },
    { id: 'aide', label: '@Aide', agentId: 'geoapp-doc-aide', purpose: 'chat', kind: 'chat', executionPath: 'theia-language-model' },
    { id: 'formula-local', label: 'Formula Solver (Local)', agentId: 'geoapp-formula-solver-local', purpose: 'formula-solving', kind: 'internal', executionPath: 'theia-language-model', requiresLocalModel: true, optionalCapabilities: ['structured-output'] },
    { id: 'formula-fast', label: 'Formula Solver (Fast)', agentId: 'geoapp-formula-solver-fast', purpose: 'formula-solving', kind: 'internal', executionPath: 'theia-language-model', optionalCapabilities: ['structured-output'] },
    { id: 'formula-strong', label: 'Formula Solver (Strong)', agentId: 'geoapp-formula-solver-strong', purpose: 'formula-solving', kind: 'internal', executionPath: 'theia-language-model', optionalCapabilities: ['structured-output'] },
    { id: 'formula-web', label: 'Formula Solver (Web)', agentId: 'geoapp-formula-solver-web', purpose: 'formula-solving', kind: 'internal', executionPath: 'theia-language-model', optionalCapabilities: ['structured-output', 'web'] },
    { id: 'outing-analysis', label: 'Analyse de sortie', agentId: 'geoapp-outing-analyzer', purpose: 'chat', kind: 'chat', executionPath: 'theia-language-model' },
    { id: 'ocr-theia', label: 'OCR galerie via Theia', agentId: 'geoapp-ocr', purpose: 'vision-ocr', kind: 'internal', executionPath: 'theia-language-model', requiredCapabilities: ['vision'] },
    { id: 'ocr-backend-plugin', label: 'OCR plugin vision_ocr', kind: 'backend', executionPath: 'backend-plugin', requiredCapabilities: ['vision'] },
    { id: 'translate-description', label: 'Traduction descriptions', agentId: 'geoapp-translate-description', purpose: 'chat', kind: 'internal', executionPath: 'theia-language-model' },
    { id: 'logs-analysis', label: 'Analyse des logs', agentId: 'geoapp-logs-analyzer', purpose: 'chat', kind: 'internal', executionPath: 'theia-language-model' },
    { id: 'log-improve', label: 'Correction de logs', agentId: 'geoapp-log-improver', purpose: 'chat', kind: 'internal', executionPath: 'theia-language-model' },
    { id: 'log-translate', label: 'Traduction de logs', agentId: 'geoapp-log-translator', purpose: 'chat', kind: 'internal', executionPath: 'theia-language-model' },
    { id: 'ai-scorer', label: 'AI Scorer (plugins)', agentId: GEOAPP_AI_SCORER_AGENT_ID, purpose: 'chat', kind: 'internal', executionPath: 'backend-plugin', optionalCapabilities: ['structured-output'] },
];

const GEOAPP_MODEL_CAPABILITIES_PREF = 'geoApp.ai.modelCapabilities';

type GeoAppModelCapabilityOverrides = Record<string, Partial<Record<GeoAppAiModelCapability, boolean>>>;

type GeoAppCapabilityMap = Partial<Record<GeoAppAiModelCapability, boolean>>;

interface GeoAppModelCapabilityCandidate {
    identifiers: Array<string | undefined>;
    provider?: string;
    baseUrl?: string;
    rawModel?: unknown;
}

export interface GeoAppAiModelChoice {
    id: string;
    label: string;
    kind: 'model' | 'alias';
    vendor?: string;
    ready?: boolean;
    targetModelIds?: string[];
    detail?: string;
}

export type GeoAppVisionBackendProvider = 'lmstudio' | 'openrouter';

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

    @inject(LanguageModelAliasRegistry) @optional()
    protected readonly languageModelAliasRegistry: LanguageModelAliasRegistry | undefined;

    @inject(AgentService) @optional()
    protected readonly agentService: AgentService | undefined;

    @inject(GeoAppAiScorerModelResolver) @optional()
    protected readonly aiScorerModelResolver: GeoAppAiScorerModelResolver | undefined;

    protected readonly capabilityProbeCache = new Map<string, Promise<GeoAppCapabilityMap | undefined>>();

    @postConstruct()
    protected init(): void {
        this.languageModelRegistry?.onChange(() => {
            this.capabilityProbeCache.clear();
            this.onDidChangeEmitter.fire();
        });
        this.aiSettingsService?.onDidChange(() => {
            this.capabilityProbeCache.clear();
            this.onDidChangeEmitter.fire();
        });
        this.languageModelAliasRegistry?.onDidChange(() => this.onDidChangeEmitter.fire());
        this.preferenceService.onPreferenceChanged(event => {
            const preference = event.preferenceName || '';
            if (preference.startsWith('geoApp.ai.')
                || preference.startsWith('geoApp.aiScorer.')
                || preference.startsWith('geoApp.ocr.')
                || preference.startsWith('ai-features.')) {
                this.capabilityProbeCache.clear();
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

    async getModelChoices(): Promise<GeoAppAiModelChoice[]> {
        const models = await this.languageModelRegistry?.getLanguageModels() ?? [];
        await this.languageModelAliasRegistry?.ready;
        const aliases = this.languageModelAliasRegistry?.getAliases() ?? [];
        const modelById = new Map(models.map(model => [model.id, model]));
        const choices: GeoAppAiModelChoice[] = [
            ...aliases.map(alias => {
                const targetModelIds = this.languageModelAliasRegistry?.resolveAlias(alias.id) ?? alias.defaultModelIds;
                const selected = targetModelIds.map(id => modelById.get(id)).find(model => model && model.status?.status !== 'unavailable');
                return {
                    id: alias.id,
                    label: alias.description || alias.id,
                    kind: 'alias' as const,
                    ready: Boolean(selected),
                    targetModelIds,
                };
            }),
            ...models.map(model => ({
                id: model.id,
                label: model.name && model.name !== model.id ? `${model.name} · ${model.id}` : model.id,
                kind: 'model' as const,
                vendor: model.vendor,
                ready: model.status?.status !== 'unavailable',
            })),
        ];
        return choices.sort((left, right) =>
            Number(right.ready ?? false) - Number(left.ready ?? false)
            || left.kind.localeCompare(right.kind)
            || left.id.localeCompare(right.id)
        );
    }

    async setTaskModel(taskId: string, identifier: string): Promise<GeoAppAiModelResolution> {
        const task = this.getTaskOrThrow(taskId);
        this.assertTaskAssignable(task);
        const normalizedIdentifier = identifier.trim();
        const selected = await this.resolveModelForIdentifier(normalizedIdentifier);
        if (!selected) {
            throw new Error(`Aucun modèle prêt ne correspond à « ${normalizedIdentifier} ».`);
        }
        await this.assertTaskModelCompatible(task, selected.model, normalizedIdentifier);
        await this.updateAgentModelRequirement(task, normalizedIdentifier);
        return this.resolveTask(task);
    }

    async resetTaskModel(taskId: string): Promise<GeoAppAiModelResolution> {
        const task = this.getTaskOrThrow(taskId);
        this.assertTaskAssignable(task);
        await this.updateAgentModelRequirement(task, undefined);
        return this.resolveTask(task);
    }

    getBackendTaskProviders(taskId: string): readonly GeoAppVisionBackendProvider[] {
        this.assertVisionBackendTask(this.getTaskOrThrow(taskId));
        return ['lmstudio', 'openrouter'];
    }

    async getBackendTaskModelChoices(
        taskId: string,
        providerInput?: GeoAppVisionBackendProvider
    ): Promise<GeoAppAiModelChoice[]> {
        const task = this.getTaskOrThrow(taskId);
        this.assertVisionBackendTask(task);
        const provider = providerInput || this.getVisionBackendProvider();
        const baseUrl = this.getVisionBackendBaseUrl(provider);
        const payload = await this.fetchJson(`${this.normalizeModelsEndpoint(baseUrl)}/models`).catch(() => undefined);
        const entries = this.asRecord(payload)?.data;
        if (!Array.isArray(entries)) {
            return [];
        }
        return entries
            .map(entry => this.asRecord(entry))
            .filter((entry): entry is Record<string, unknown> => Boolean(entry?.id))
            .map(entry => {
                const id = String(entry.id);
                const providerCapabilities = this.readOpenAiCompatibleCapabilities(payload, id);
                const preferenceCapabilities = this.getCapabilityOverrides([id]);
                const vision = preferenceCapabilities.vision ?? providerCapabilities?.vision;
                return {
                    id,
                    label: id,
                    kind: 'model' as const,
                    vendor: provider,
                    ready: vision === true,
                    detail: vision === true
                        ? 'vision vérifiée'
                        : vision === false
                            ? 'vision non supportée'
                            : 'vision non vérifiée',
                };
            })
            .sort((left, right) => Number(right.ready ?? false) - Number(left.ready ?? false) || left.id.localeCompare(right.id));
    }

    async setTaskBackendConfiguration(
        taskId: string,
        provider: GeoAppVisionBackendProvider,
        model: string
    ): Promise<GeoAppAiModelResolution> {
        const task = this.getTaskOrThrow(taskId);
        this.assertVisionBackendTask(task);
        this.assertVisionBackendProvider(provider);
        const normalizedModel = model.trim();
        if (!normalizedModel) {
            throw new Error('Indiquez le modèle backend à utiliser.');
        }
        const evaluation = await this.evaluateTaskCapabilities(task, {
            identifiers: [normalizedModel],
            provider,
            baseUrl: this.getVisionBackendBaseUrl(provider),
        });
        if (evaluation.status === 'unsupported') {
            throw new Error(evaluation.diagnostics.join(' ') || 'Le modèle ne satisfait pas les capacités requises.');
        }
        await Promise.all([
            this.preferenceService.set('geoApp.ocr.visionProvider', provider, PreferenceScope.User),
            this.preferenceService.set(this.getVisionBackendModelPreference(provider), normalizedModel, PreferenceScope.User),
        ]);
        this.capabilityProbeCache.clear();
        this.onDidChangeEmitter.fire();
        return this.resolveTask(task);
    }

    async resetTaskBackendModel(taskId: string, provider?: GeoAppVisionBackendProvider): Promise<GeoAppAiModelResolution> {
        const task = this.getTaskOrThrow(taskId);
        this.assertVisionBackendTask(task);
        const effectiveProvider = provider || this.getVisionBackendProvider();
        this.assertVisionBackendProvider(effectiveProvider);
        const defaultModel = effectiveProvider === 'openrouter' ? 'openai/gpt-4o-mini' : '';
        await Promise.all([
            this.preferenceService.set('geoApp.ocr.visionProvider', effectiveProvider, PreferenceScope.User),
            this.preferenceService.set(this.getVisionBackendModelPreference(effectiveProvider), defaultModel, PreferenceScope.User),
        ]);
        this.capabilityProbeCache.clear();
        this.onDidChangeEmitter.fire();
        return this.resolveTask(task);
    }

    protected assertVisionBackendTask(task: GeoAppAiTaskDescriptor): void {
        if (task.id !== 'ocr-backend-plugin') {
            throw new Error(`La tâche « ${task.label} » n’est pas une tâche backend configurable par préférences GeoApp.`);
        }
    }

    protected assertVisionBackendProvider(provider: string): asserts provider is GeoAppVisionBackendProvider {
        if (provider !== 'lmstudio' && provider !== 'openrouter') {
            throw new Error(`Fournisseur vision backend inconnu : ${provider}.`);
        }
    }

    protected getVisionBackendProvider(): GeoAppVisionBackendProvider {
        return this.preferenceService.get<string>('geoApp.ocr.visionProvider', 'lmstudio') === 'openrouter'
            ? 'openrouter'
            : 'lmstudio';
    }

    protected getVisionBackendModelPreference(provider: GeoAppVisionBackendProvider): string {
        return provider === 'openrouter' ? 'geoApp.ocr.openRouter.model' : 'geoApp.ocr.lmstudio.model';
    }

    protected getVisionBackendBaseUrl(provider: GeoAppVisionBackendProvider): string {
        return provider === 'openrouter'
            ? this.preferenceService.get<string>('geoApp.ai.openRouter.baseUrl', 'https://openrouter.ai/api/v1')
            : this.preferenceService.get<string>('geoApp.ocr.lmstudio.baseUrl', 'http://localhost:1234');
    }

    protected getTaskOrThrow(taskId: string): GeoAppAiTaskDescriptor {
        const task = GEOAPP_AI_TASKS.find(candidate => candidate.id === taskId);
        if (!task) {
            throw new Error(`Tâche IA inconnue : ${taskId}`);
        }
        return task;
    }

    protected assertTaskAssignable(task: GeoAppAiTaskDescriptor): void {
        if (!task.agentId || !task.purpose) {
            throw new Error(`La tâche « ${task.label} » n’est pas pilotée par une affectation d’agent Theia.`);
        }
        if (!this.aiSettingsService || !this.languageModelRegistry) {
            throw new Error('Le service Theia d’affectation des modèles est indisponible.');
        }
    }

    protected async updateAgentModelRequirement(task: GeoAppAiTaskDescriptor, identifier: string | undefined): Promise<void> {
        const current = await this.aiSettingsService!.getAgentSettings(task.agentId!)
            .then(settings => settings?.languageModelRequirements ?? []);
        const next: LanguageModelRequirement[] = current
            .filter(requirement => requirement.purpose !== task.purpose)
            .map(requirement => ({ ...requirement }));
        if (identifier) {
            next.push({ purpose: task.purpose!, identifier });
        }
        await this.aiSettingsService!.updateAgentSettings(task.agentId!, {
            languageModelRequirements: next.length ? next : undefined,
        });
        this.capabilityProbeCache.clear();
        this.onDidChangeEmitter.fire();
    }

    protected async resolveModelForIdentifier(identifier: string): Promise<{ model: LanguageModel; targetModelIds: string[] } | undefined> {
        if (!identifier || !this.languageModelRegistry) {
            return undefined;
        }
        await this.languageModelAliasRegistry?.ready;
        const aliasTargets = this.languageModelAliasRegistry?.resolveAlias(identifier);
        const targetModelIds = aliasTargets ?? [identifier];
        for (const targetId of targetModelIds) {
            const model = await this.languageModelRegistry.getLanguageModel(targetId);
            if (model && model.status?.status !== 'unavailable') {
                return { model, targetModelIds };
            }
        }
        return undefined;
    }

    protected async assertTaskModelCompatible(task: GeoAppAiTaskDescriptor, model: LanguageModel, identifier: string): Promise<void> {
        if (task.requiresLocalModel) {
            const localCheck = checkGeoAppLocalModel(model, this.getLocalModelPreferences());
            if (localCheck.status !== 'local') {
                throw new Error(`Non compatible local/offline : ${localCheck.reason}.`);
            }
        }
        const backingPreference = OPENROUTER_SLOT_PREFS[model.id];
        const backingModel = backingPreference
            ? this.preferenceService.get<string>(backingPreference, '')
            : undefined;
        const evaluation = await this.evaluateTaskCapabilities(task, {
            identifiers: [identifier, model.id, this.readModelProperty(model, 'model'), backingModel],
            provider: this.inferProvider(model.id, model.vendor),
            baseUrl: this.readModelProperty(model, 'url'),
            rawModel: model,
        });
        if (evaluation.status === 'unsupported') {
            throw new Error(evaluation.diagnostics.join(' ') || 'Le modèle ne satisfait pas les capacités requises.');
        }
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
        const blockingDiagnostics: string[] = [];
        if (task.requiresLocalModel && localCheck.status !== 'local') {
            blockingDiagnostics.push(`Non compatible local/offline : ${localCheck.reason}.`);
        }
        const backingPreference = OPENROUTER_SLOT_PREFS[model.id];
        const backingModel = backingPreference
            ? this.preferenceService.get<string>(backingPreference, '')
            : undefined;
        const provider = this.inferProvider(model.id, model.vendor);
        const capabilityChecks = await this.inspectModelCapabilities(task, {
            identifiers: [model.id, this.readModelProperty(model, 'model'), backingModel],
            provider,
            baseUrl: this.readModelProperty(model, 'url'),
            rawModel: model,
        });
        const advisoryDiagnostics: string[] = [];
        const capabilityStatus = this.applyCapabilityChecks(capabilityChecks, blockingDiagnostics, advisoryDiagnostics);

        return {
            ...base,
            agentId: task.agentId,
            purpose: task.purpose,
            requestedIdentifier,
            resolvedModelId: model.id,
            displayModel: model.name && model.name !== model.id ? `${model.name} · ${model.id}` : model.id,
            vendor: model.vendor,
            provider,
            transport: 'theia-managed',
            backingModel: backingModel || undefined,
            backingPreference,
            source,
            sourceLabel,
            locality: localCheck.status,
            status: capabilityStatus || (blockingDiagnostics.length ? 'incompatible' : 'ready'),
            diagnostics: [...diagnostics, ...blockingDiagnostics, ...advisoryDiagnostics],
            capabilityChecks,
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
            const theiaModel = runtime.theiaModelId && this.languageModelRegistry?.getLanguageModel
                ? await this.languageModelRegistry.getLanguageModel(runtime.theiaModelId).catch(() => undefined)
                : undefined;
            const capabilityChecks = await this.inspectModelCapabilities(task, {
                identifiers: [runtime.theiaModelId, runtime.model],
                provider: runtime.provider,
                baseUrl: runtime.base_url,
                rawModel: theiaModel,
            }, { probe: false });
            const advisoryDiagnostics: string[] = [];
            const blockingDiagnostics: string[] = [];
            this.applyCapabilityChecks(capabilityChecks, blockingDiagnostics, advisoryDiagnostics);
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
                diagnostics: runtime.model
                    ? advisoryDiagnostics
                    : ['Aucun modèle backend configuré pour le scoring.', ...advisoryDiagnostics],
                capabilityChecks,
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

    protected async resolveVisionBackendTask(task: GeoAppAiTaskDescriptor): Promise<GeoAppAiModelResolution> {
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
        const capabilityChecks = await this.inspectModelCapabilities(task, {
            identifiers: [model],
            provider,
            baseUrl,
        });
        const blockingDiagnostics: string[] = [];
        const advisoryDiagnostics: string[] = [];
        const capabilityStatus = this.applyCapabilityChecks(capabilityChecks, blockingDiagnostics, advisoryDiagnostics);
        const diagnostics = model
            ? [...blockingDiagnostics, ...advisoryDiagnostics]
            : ['Aucun modèle configuré pour le plugin vision_ocr.', ...blockingDiagnostics, ...advisoryDiagnostics];
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
            status: model ? capabilityStatus || 'ready' : 'unconfigured',
            diagnostics,
            capabilityChecks,
        };
    }

    protected baseResolution(
        task: GeoAppAiTaskDescriptor,
        executionPath: GeoAppAiExecutionPath
    ): Pick<GeoAppAiModelResolution,
        'taskId' | 'taskLabel' | 'kind' | 'executionPath' | 'source' | 'sourceLabel' | 'locality' | 'status' | 'diagnostics' | 'requiresLocalModel' | 'requiredCapabilities' | 'optionalCapabilities'> {
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
            requiredCapabilities: task.requiredCapabilities,
            optionalCapabilities: task.optionalCapabilities,
        };
    }

    async evaluateTaskCapabilities(
        task: GeoAppAiTaskDescriptor,
        candidate: {
            identifiers: Array<string | undefined>;
            provider?: string;
            baseUrl?: string;
            rawModel?: unknown;
        },
        options: { probe?: boolean } = {}
    ): Promise<{
        capabilityChecks: GeoAppAiCapabilityCheck[];
        diagnostics: string[];
        status?: 'unsupported';
    }> {
        const capabilityChecks = await this.inspectModelCapabilities(task, candidate, options);
        const blockingDiagnostics: string[] = [];
        const advisoryDiagnostics: string[] = [];
        const status = this.applyCapabilityChecks(capabilityChecks, blockingDiagnostics, advisoryDiagnostics);
        return {
            capabilityChecks,
            diagnostics: [...blockingDiagnostics, ...advisoryDiagnostics],
            status,
        };
    }

    protected async inspectModelCapabilities(
        task: GeoAppAiTaskDescriptor,
        candidate: GeoAppModelCapabilityCandidate,
        options: { probe?: boolean } = {}
    ): Promise<GeoAppAiCapabilityCheck[]> {
        const expected = [...(task.requiredCapabilities || []), ...(task.optionalCapabilities || [])]
            .filter((capability, index, all) => all.indexOf(capability) === index);
        if (!expected.length) {
            return [];
        }

        const declared = this.readDeclaredCapabilities(candidate.rawModel);
        const overrides = this.getCapabilityOverrides(candidate.identifiers);
        const missing = expected.filter(capability =>
            overrides[capability] === undefined && declared[capability] === undefined
        );
        const providerDeclared = options.probe === false || !missing.length
            ? undefined
            : await this.probeModelCapabilities(candidate);
        const checks = new Map<GeoAppAiModelCapability, GeoAppAiCapabilityCheck>();
        for (const capability of expected) {
            const required = Boolean(task.requiredCapabilities?.includes(capability));
            const override = overrides[capability];
            const modelValue = declared[capability];
            const providerValue = providerDeclared?.[capability];
            const value = override ?? modelValue ?? providerValue;
            checks.set(capability, {
                capability,
                required,
                status: value === undefined ? 'unknown' : value ? 'supported' : 'unsupported',
                source: override !== undefined
                    ? 'preference'
                    : modelValue !== undefined
                        ? 'model'
                        : providerValue !== undefined
                            ? 'provider'
                            : 'unverified',
                detail: override !== undefined
                    ? GEOAPP_MODEL_CAPABILITIES_PREF
                    : modelValue !== undefined
                        ? 'métadonnées du modèle'
                        : providerValue !== undefined
                            ? 'métadonnées du fournisseur'
                            : 'aucune métadonnée fiable',
            });
        }
        return [...checks.values()];
    }

    protected applyCapabilityChecks(
        checks: readonly GeoAppAiCapabilityCheck[],
        blockingDiagnostics: string[],
        advisoryDiagnostics: string[]
    ): 'unsupported' | undefined {
        let incompatible = false;
        for (const check of checks) {
            if (check.status === 'supported') {
                continue;
            }
            const label = this.capabilityLabel(check.capability);
            const state = check.status === 'unsupported' ? 'non supportée' : 'non vérifiée';
            const detail = check.detail ? ` (${check.detail})` : '';
            if (check.required) {
                incompatible = true;
                blockingDiagnostics.push(`Capacité requise ${label} ${state}${detail}.`);
            } else {
                advisoryDiagnostics.push(`Capacité ${label} ${state}${detail} ; diagnostic non bloquant.`);
            }
        }
        return incompatible ? 'unsupported' : undefined;
    }

    protected readDeclaredCapabilities(rawModel: unknown): GeoAppCapabilityMap {
        const model = this.asRecord(rawModel);
        if (!model) {
            return {};
        }
        const capabilities = model.capabilities;
        const capabilityRecord = this.asRecord(capabilities);
        const capabilityNames = new Set(
            Array.isArray(capabilities)
                ? capabilities.filter((value): value is string => typeof value === 'string').map(value => value.toLowerCase())
                : []
        );
        const declared: GeoAppCapabilityMap = {};
        const vision = this.booleanValue(
            capabilityRecord?.imageInput
            ?? capabilityRecord?.vision
            ?? model.supportsVision
            ?? model.supportsImageInput
            ?? model.supportsImages
            ?? model.vision
        );
        const modalities = [
            capabilityRecord?.input_modalities,
            capabilityRecord?.inputModalities,
            model.input_modalities,
            model.inputModalities,
            this.asRecord(model.architecture)?.input_modalities,
            this.asRecord(model.architecture)?.inputModalities,
            this.asRecord(model.architecture)?.modality,
        ];
        const tools = this.booleanValue(
            capabilityRecord?.toolCalling
            ?? capabilityRecord?.tools
            ?? model.supportsTools
            ?? model.supportsToolCalling
            ?? model.toolCalling
        );
        const structuredOutput = this.booleanValue(
            capabilityRecord?.structuredOutput
            ?? capabilityRecord?.json
            ?? model.supportsStructuredOutput
            ?? model.supportsJsonSchema
            ?? model.structuredOutput
        );
        const serverTools = Array.isArray(model.serverTools)
            ? model.serverTools.map(tool => this.asRecord(tool)?.id).filter((id): id is string => typeof id === 'string')
            : [];
        const web = this.booleanValue(
            capabilityRecord?.web
            ?? capabilityRecord?.webSearch
            ?? model.supportsWebSearch
            ?? model.supportsWeb
        );

        if (vision !== undefined || capabilityNames.has('vision') || capabilityNames.has('image')) {
            declared.vision = vision ?? true;
        }
        if (vision === undefined && modalities.some(value => this.stringListContains(value, 'image'))) {
            declared.vision = true;
        }
        if (tools !== undefined || capabilityNames.has('tools') || capabilityNames.has('tool-calling')) {
            declared.tools = tools ?? true;
        }
        if (structuredOutput !== undefined
            || capabilityNames.has('structured-output')
            || capabilityNames.has('json-schema')
            || capabilityNames.has('json')) {
            declared['structured-output'] = structuredOutput ?? true;
        }
        if (web !== undefined
            || capabilityNames.has('web')
            || capabilityNames.has('web-search')
            || serverTools.some(id => /web|search|fetch|browser/i.test(id))) {
            declared.web = web ?? true;
        }
        return declared;
    }

    protected getCapabilityOverrides(identifiers: readonly (string | undefined)[]): GeoAppCapabilityMap {
        const configured = this.asRecord(this.preferenceService.get(GEOAPP_MODEL_CAPABILITIES_PREF, {}));
        if (!configured) {
            return {};
        }
        const normalized = identifiers
            .filter((identifier): identifier is string => typeof identifier === 'string' && Boolean(identifier.trim()))
            .map(identifier => identifier.trim().toLowerCase());
        const merged: GeoAppCapabilityMap = {};
        for (const [pattern, entry] of Object.entries(configured).sort((a, b) => a[0].length - b[0].length)) {
            const normalizedPattern = pattern.trim().toLowerCase();
            const matches = normalizedPattern.endsWith('*')
                ? normalized.some(identifier => identifier.startsWith(normalizedPattern.slice(0, -1)))
                : normalized.includes(normalizedPattern);
            if (!matches) {
                continue;
            }
            const entryRecord = this.asRecord(entry);
            if (!entryRecord) {
                continue;
            }
            for (const capability of ['vision', 'structured-output', 'tools', 'web'] as GeoAppAiModelCapability[]) {
                const value = this.booleanValue(entryRecord[capability]);
                if (value !== undefined) {
                    merged[capability] = value;
                }
            }
        }
        return merged;
    }

    protected async probeModelCapabilities(candidate: GeoAppModelCapabilityCandidate): Promise<GeoAppCapabilityMap | undefined> {
        const identifiers = candidate.identifiers.filter((identifier): identifier is string => Boolean(identifier?.trim()));
        const ollamaIdentifier = identifiers.find(identifier => identifier.toLowerCase().startsWith('ollama/'));
        if (candidate.provider === 'ollama' || ollamaIdentifier) {
            const model = this.readModelProperty(candidate.rawModel, 'model')
                || ollamaIdentifier?.replace(/^ollama\//i, '')
                || identifiers[0];
            const host = this.preferenceService.get<string>('ai-features.ollama.ollamaHost', 'http://localhost:11434');
            return this.cachedCapabilityProbe(`ollama:${host}:${model}`, async () => {
                const payload = await this.fetchJson(`${host.replace(/\/+$/, '')}/api/show`, {
                    method: 'POST',
                    body: JSON.stringify({ model }),
                });
                return this.readOllamaCapabilities(payload);
            });
        }

        const baseUrl = candidate.baseUrl
            || this.readModelProperty(candidate.rawModel, 'url')
            || (candidate.provider === 'openrouter' ? 'https://openrouter.ai/api/v1' : undefined)
            || (candidate.provider === 'lmstudio' ? this.preferenceService.get<string>('geoApp.ocr.lmstudio.baseUrl', 'http://localhost:1234') : undefined);
        const model = this.readModelProperty(candidate.rawModel, 'model') || identifiers[identifiers.length - 1];
        if (!baseUrl || !model) {
            return undefined;
        }
        return this.cachedCapabilityProbe(`openai-compatible:${baseUrl}:${model}`, async () => {
            const endpoint = `${this.normalizeModelsEndpoint(baseUrl)}/models`;
            const payload = await this.fetchJson(endpoint);
            return this.readOpenAiCompatibleCapabilities(payload, model);
        });
    }

    protected cachedCapabilityProbe(key: string, probe: () => Promise<GeoAppCapabilityMap | undefined>): Promise<GeoAppCapabilityMap | undefined> {
        const cached = this.capabilityProbeCache.get(key);
        if (cached) {
            return cached;
        }
        const pending = probe().catch(() => undefined);
        this.capabilityProbeCache.set(key, pending);
        return pending;
    }

    protected readOllamaCapabilities(payload: unknown): GeoAppCapabilityMap | undefined {
        const capabilities = this.asRecord(payload)?.capabilities;
        if (!Array.isArray(capabilities)) {
            return undefined;
        }
        const names = new Set(capabilities.filter((value): value is string => typeof value === 'string').map(value => value.toLowerCase()));
        return {
            vision: names.has('vision'),
            tools: names.has('tools'),
        };
    }

    protected readOpenAiCompatibleCapabilities(payload: unknown, modelId: string): GeoAppCapabilityMap | undefined {
        const entries = this.asRecord(payload)?.data;
        if (!Array.isArray(entries)) {
            return undefined;
        }
        const normalizedId = modelId.toLowerCase();
        const entry = entries
            .map(value => this.asRecord(value))
            .find(candidate => this.stringValue(candidate?.id)?.toLowerCase() === normalizedId);
        if (!entry) {
            return undefined;
        }
        const declared: GeoAppCapabilityMap = {};
        const architecture = this.asRecord(entry.architecture);
        const modality = this.stringValue(architecture?.modality || entry.modality);
        const inputModalities = [
            architecture?.input_modalities,
            architecture?.inputModalities,
            entry.input_modalities,
            entry.inputModalities,
        ];
        const supportedParameters = this.stringSet(entry.supported_parameters ?? entry.supportedParameters);
        const capabilities = this.stringSet(entry.capabilities);
        const explicitVision = this.booleanValue(entry.supports_vision ?? entry.supportsVision ?? entry.vision);
        const modelKind = [entry.type, entry.model_type, entry.modelType, entry.compatibility_type, entry.compatibilityType]
            .map(value => this.stringValue(value)?.toLowerCase())
            .find(Boolean);
        if (explicitVision !== undefined) {
            declared.vision = explicitVision;
        } else if (modelKind === 'llm') {
            declared.vision = false;
        } else if (modelKind?.includes('vlm') || modelKind?.includes('vision') || modelKind?.includes('image')) {
            declared.vision = true;
        } else if (inputModalities.some(Array.isArray)) {
            declared.vision = inputModalities.some(value => this.stringListContains(value, 'image'));
        } else if (inputModalities.some(value => this.stringListContains(value, 'image'))) {
            declared.vision = true;
        } else if (modality && !modality.toLowerCase().includes('image')) {
            declared.vision = false;
        } else if (modality && modality.toLowerCase().includes('image')) {
            declared.vision = true;
        }
        if (capabilities.has('vision') || capabilities.has('image')) {
            declared.vision = true;
        }
        if (supportedParameters.has('tools') || supportedParameters.has('tool_choice') || capabilities.has('tools')) {
            declared.tools = true;
        }
        if (supportedParameters.has('response_format')
            || supportedParameters.has('structured_outputs')
            || supportedParameters.has('structured-output')
            || capabilities.has('structured-output')
            || capabilities.has('json-schema')) {
            declared['structured-output'] = true;
        }
        if (supportedParameters.has('web_search')
            || supportedParameters.has('web-search')
            || capabilities.has('web')
            || capabilities.has('web-search')) {
            declared.web = true;
        }
        return Object.keys(declared).length ? declared : undefined;
    }

    normalizeModelsEndpoint(baseUrl: string): string {
        const withoutCompletions = baseUrl.trim().replace(/\/chat\/completions\/?$/i, '').replace(/\/+$/, '');
        if (/\/models$/i.test(withoutCompletions)) {
            return withoutCompletions.replace(/\/models$/i, '');
        }
        return /\/v\d+$/i.test(withoutCompletions) ? withoutCompletions : `${withoutCompletions}/v1`;
    }

    async fetchJson(url: string, init: RequestInit = {}, timeoutMs = 1500): Promise<unknown> {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const headers = new Headers(init.headers);
            headers.set('Accept', 'application/json');
            if (init.body) {
                headers.set('Content-Type', 'application/json');
            }
            const response = await fetch(url, {
                ...init,
                signal: controller.signal,
                headers,
            });
            if (!response.ok) {
                return undefined;
            }
            return response.json();
        } finally {
            clearTimeout(timeout);
        }
    }

    protected readModelProperty(model: unknown, key: string): string | undefined {
        return this.stringValue(this.asRecord(model)?.[key]);
    }

    protected stringListContains(value: unknown, expected: string): boolean {
        const values = Array.isArray(value) ? value : [value];
        return values.some(item => this.stringValue(item)?.toLowerCase().includes(expected.toLowerCase()));
    }

    protected stringSet(value: unknown): Set<string> {
        if (!Array.isArray(value)) {
            return new Set();
        }
        return new Set(value.filter((item): item is string => typeof item === 'string').map(item => item.toLowerCase()));
    }

    protected asRecord(value: unknown): Record<string, unknown> | undefined {
        return value !== null && typeof value === 'object' && !Array.isArray(value)
            ? value as Record<string, unknown>
            : undefined;
    }

    protected stringValue(value: unknown): string | undefined {
        return typeof value === 'string' && value.trim() ? value.trim() : undefined;
    }

    protected booleanValue(value: unknown): boolean | undefined {
        if (typeof value === 'boolean') {
            return value;
        }
        return typeof value === 'number' ? value > 0 : undefined;
    }

    protected capabilityLabel(capability: GeoAppAiModelCapability): string {
        switch (capability) {
            case 'vision': return 'vision';
            case 'structured-output': return 'sortie structurée';
            case 'tools': return 'appels d’outils';
            case 'web': return 'accès Web';
        }
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
