import { inject, injectable, optional, postConstruct } from '@theia/core/shared/inversify';
import { PreferenceService } from '@theia/core/lib/common/preferences/preference-service';
import { PreferenceScope } from '@theia/core/lib/common/preferences/preference-scope';
import { Emitter, Event as TheiaEvent } from '@theia/core/lib/common/event';
import { Deferred } from '@theia/core/lib/common/promise-util';
import {
    LanguageModelAliasRegistry,
    LanguageModelRegistry,
    LanguageModelService,
    isLanguageModelStreamResponse,
} from '@theia/ai-core';
import { GeoAppAiModelResolution } from '@mysterai/theia-plugins/lib/common/ai-model-contract';
import { GeoAppAiModelResolutionService } from './geoapp-ai-model-resolution-service';

export type GeoAppAiSetupProviderId = 'openrouter' | 'anthropic' | 'openai' | 'google' | 'ollama' | 'lmstudio';

export interface GeoAppAiSetupProvider {
    id: GeoAppAiSetupProviderId;
    label: string;
    kind: 'cloud' | 'local';
    tagline: string;
    recommended?: boolean;
    /** Page où créer une clé (fournisseurs en ligne). */
    keyUrl?: string;
    /** Préférence qui porte la clé (fournisseurs en ligne). */
    keyPreference?: string;
    /** Préférence qui porte l'adresse du serveur (fournisseurs locaux). */
    endpointPreference?: string;
    defaultEndpoint?: string;
    /** Préfixe de l'identifiant Theia des modèles du fournisseur. */
    modelIdPrefix: string;
}

export const GEOAPP_AI_SETUP_PROVIDERS: readonly GeoAppAiSetupProvider[] = [
    {
        id: 'openrouter',
        label: 'OpenRouter',
        kind: 'cloud',
        tagline: 'Une seule clé donne accès aux modèles de tous les éditeurs. Paiement à l\'usage.',
        recommended: true,
        keyUrl: 'https://openrouter.ai/keys',
        keyPreference: 'geoApp.ai.openRouter.apiKey',
        modelIdPrefix: 'openrouter/',
    },
    {
        id: 'anthropic',
        label: 'Anthropic',
        kind: 'cloud',
        tagline: 'Les modèles Claude, avec votre clé Anthropic.',
        keyUrl: 'https://console.anthropic.com/settings/keys',
        keyPreference: 'ai-features.anthropic.AnthropicApiKey',
        modelIdPrefix: 'anthropic/',
    },
    {
        id: 'openai',
        label: 'OpenAI',
        kind: 'cloud',
        tagline: 'Les modèles GPT, avec votre clé OpenAI.',
        keyUrl: 'https://platform.openai.com/api-keys',
        keyPreference: 'ai-features.openAiOfficial.openAiApiKey',
        modelIdPrefix: 'openai/',
    },
    {
        id: 'google',
        label: 'Google',
        kind: 'cloud',
        tagline: 'Les modèles Gemini, avec votre clé Google AI.',
        keyUrl: 'https://aistudio.google.com/apikey',
        keyPreference: 'ai-features.google.apiKey',
        modelIdPrefix: 'google/',
    },
    {
        id: 'ollama',
        label: 'Ollama',
        kind: 'local',
        tagline: 'Modèles installés sur cet ordinateur. Gratuit, fonctionne hors ligne.',
        endpointPreference: 'ai-features.ollama.ollamaHost',
        defaultEndpoint: 'http://localhost:11434',
        modelIdPrefix: 'ollama/',
    },
    {
        id: 'lmstudio',
        label: 'LM Studio',
        kind: 'local',
        tagline: 'Modèles chargés dans LM Studio sur cet ordinateur. Gratuit, fonctionne hors ligne.',
        endpointPreference: 'geoApp.ocr.lmstudio.baseUrl',
        defaultEndpoint: 'http://localhost:1234',
        modelIdPrefix: 'lmstudio/',
    },
];

/**
 * Modèles mis en avant dans l'assistant. Volontairement vide pour OpenRouter, Ollama et
 * LM Studio : l'utilisateur de ces systèmes choisit ou saisit lui-même son modèle.
 */
export const GEOAPP_AI_SETUP_SUGGESTED_MODELS: Record<GeoAppAiSetupProviderId, readonly string[]> = {
    openrouter: [],
    anthropic: ['claude-opus-5'],
    openai: ['gpt-5.6-sol'],
    google: ['gemini-3.1-pro-preview'],
    ollama: [],
    lmstudio: [],
};

export const GEOAPP_AI_SETUP_DISMISSED_PREF = 'geoApp.ai.setup.dismissed';
export const GEOAPP_AI_SETUP_DEFAULT_ALIAS = 'default/universal';
export const GEOAPP_AI_SETUP_AIDE_TASK_ID = 'aide';

const AI_ENABLED_PREF = 'geoApp.ai.enabled';
const OPENROUTER_ENABLED_PREF = 'geoApp.ai.openRouter.enabled';
const OPENROUTER_BASE_URL_PREF = 'geoApp.ai.openRouter.baseUrl';
const OPENROUTER_STRONG_MODEL_PREF = 'geoApp.ai.openRouter.model.strong';
const OPENROUTER_STRONG_MODEL_ID = 'openrouter/strong';
const OLLAMA_MODELS_PREF = 'ai-features.ollama.ollamaModels';
const OPENAI_CUSTOM_MODELS_PREF = 'ai-features.openAiCustom.customOpenAiModels';
/** LM Studio n'exige pas de clé, mais le client OpenAI de Theia en veut une non vide. */
const LMSTUDIO_PLACEHOLDER_KEY = 'lm-studio';

export interface GeoAppAiSetupStatus {
    /** La tâche @Aide dispose d'un modèle prêt. */
    ready: boolean;
    aiEnabled: boolean;
    dismissed: boolean;
    defaultModelId?: string;
    /** Pour un slot OpenRouter : le modèle réel derrière le slot. */
    defaultModelLabel?: string;
    providerId?: GeoAppAiSetupProviderId;
    tasks: GeoAppAiModelResolution[];
}

export interface GeoAppAiSetupModel {
    /** Nom du modèle chez le fournisseur, sans le préfixe Theia. */
    id: string;
    label: string;
    recommended?: boolean;
    supportsTools?: boolean;
    supportsVision?: boolean;
}

export interface GeoAppAiSetupLocalDetection {
    id: 'ollama' | 'lmstudio';
    endpoint: string;
    models: string[];
}

export type GeoAppAiSetupFailure =
    | 'invalid-key'
    | 'no-credit'
    | 'model-not-found'
    | 'unreachable'
    | 'not-registered'
    | 'unknown';

export const GEOAPP_AI_SETUP_FAILURE_MESSAGES: Record<GeoAppAiSetupFailure, string> = {
    'invalid-key': 'La clé est refusée par le fournisseur. Vérifiez qu\'elle est complète et active.',
    'no-credit': 'Le compte n\'a plus de crédit ou a atteint sa limite.',
    'model-not-found': 'Ce modèle n\'est pas disponible avec cette clé.',
    'unreachable': 'Impossible de joindre le fournisseur. Pour un modèle local, vérifiez que le logiciel est lancé.',
    'not-registered': 'Le modèle n\'est pas encore enregistré. Réessayez dans quelques secondes.',
    'unknown': 'Le modèle n\'a pas répondu.',
};

export type GeoAppAiSetupTestResult =
    | { ok: true }
    | { ok: false; reason: GeoAppAiSetupFailure; detail?: string };

export type GeoAppAiSetupPhase = 'connection' | 'model' | 'test' | 'activation';

export type GeoAppAiSetupApplyResult =
    | { ok: true; status: GeoAppAiSetupStatus }
    | { ok: false; phase: GeoAppAiSetupPhase; reason: GeoAppAiSetupFailure; detail?: string };

interface SelectableAliasRegistry {
    selectModelForAlias?(aliasId: string, modelId: string): void;
}

@injectable()
export class GeoAppAiSetupService {

    protected readonly onDidChangeStatusEmitter = new Emitter<GeoAppAiSetupStatus>();
    readonly onDidChangeStatus: TheiaEvent<GeoAppAiSetupStatus> = this.onDidChangeStatusEmitter.event;

    @inject(PreferenceService)
    protected readonly preferenceService!: PreferenceService;

    @inject(GeoAppAiModelResolutionService)
    protected readonly modelResolutionService!: GeoAppAiModelResolutionService;

    @inject(LanguageModelRegistry) @optional()
    protected readonly languageModelRegistry: LanguageModelRegistry | undefined;

    @inject(LanguageModelAliasRegistry) @optional()
    protected readonly languageModelAliasRegistry: LanguageModelAliasRegistry | undefined;

    @inject(LanguageModelService) @optional()
    protected readonly languageModelService: LanguageModelService | undefined;

    protected readonly settled = new Deferred<void>();
    /** Résolue quand les fournisseurs ont fini d'enregistrer leurs modèles au démarrage. */
    readonly whenSettled: Promise<void> = this.settled.promise;

    /** Clés saisies pendant la session : à retirer de tout message affiché ou journalisé. */
    protected readonly knownSecrets = new Set<string>();

    protected statusTimer: ReturnType<typeof setTimeout> | undefined;
    protected requestCounter = 0;

    protected readonly settleQuietMs = 3000;
    protected readonly settleMaxMs = 10000;
    protected readonly statusDebounceMs = 500;
    protected readonly registrationTimeoutMs = 8000;
    protected readonly pollIntervalMs = 250;
    protected readonly cloudTestTimeoutMs = 30000;
    protected readonly localTestTimeoutMs = 60000;

    @postConstruct()
    protected init(): void {
        this.modelResolutionService.onDidChange(() => this.scheduleStatusChange());
        void this.trackSettling();
    }

    getProviders(): readonly GeoAppAiSetupProvider[] {
        return GEOAPP_AI_SETUP_PROVIDERS;
    }

    getProvider(id: GeoAppAiSetupProviderId): GeoAppAiSetupProvider {
        const provider = GEOAPP_AI_SETUP_PROVIDERS.find(candidate => candidate.id === id);
        if (!provider) {
            throw new Error(`Fournisseur IA inconnu : ${id}`);
        }
        return provider;
    }

    async getStatus(): Promise<GeoAppAiSetupStatus> {
        const tasks = await this.modelResolutionService.resolveAll();
        const aide = tasks.find(task => task.taskId === GEOAPP_AI_SETUP_AIDE_TASK_ID);
        const defaultModelId = await this.resolveDefaultModelId();
        const backingModel = defaultModelId === OPENROUTER_STRONG_MODEL_ID
            ? this.readString(OPENROUTER_STRONG_MODEL_PREF)
            : undefined;
        return {
            ready: aide?.status === 'ready',
            aiEnabled: this.preferenceService.get<boolean>(AI_ENABLED_PREF, true) !== false,
            dismissed: this.preferenceService.get<boolean>(GEOAPP_AI_SETUP_DISMISSED_PREF, false) === true,
            defaultModelId,
            defaultModelLabel: backingModel || defaultModelId,
            providerId: this.providerOfModel(defaultModelId),
            tasks,
        };
    }

    async setDismissed(dismissed: boolean): Promise<void> {
        await this.preferenceService.set(GEOAPP_AI_SETUP_DISMISSED_PREF, dismissed, PreferenceScope.User);
        this.scheduleStatusChange();
    }

    /** Ne renvoie jamais la clé : seulement si elle existe. */
    getProviderState(id: GeoAppAiSetupProviderId): { configured: boolean; endpoint?: string } {
        const provider = this.getProvider(id);
        if (provider.kind === 'cloud') {
            return { configured: Boolean(this.readString(provider.keyPreference!)) };
        }
        return { configured: false, endpoint: this.getLocalEndpoint(provider) };
    }

    async saveCredentials(
        id: GeoAppAiSetupProviderId,
        credentials: { apiKey?: string; endpoint?: string }
    ): Promise<void> {
        const provider = this.getProvider(id);
        if (provider.kind === 'cloud') {
            const apiKey = credentials.apiKey?.trim();
            if (apiKey) {
                this.knownSecrets.add(apiKey);
                await this.preferenceService.set(provider.keyPreference!, apiKey, PreferenceScope.User);
            }
            if (id === 'openrouter') {
                await this.preferenceService.set(OPENROUTER_ENABLED_PREF, true, PreferenceScope.User);
            }
            return;
        }
        const endpoint = credentials.endpoint?.trim().replace(/\/+$/, '');
        if (endpoint) {
            await this.preferenceService.set(provider.endpointPreference!, endpoint, PreferenceScope.User);
        }
    }

    async detectLocalProviders(): Promise<GeoAppAiSetupLocalDetection[]> {
        const detections = await Promise.all([
            this.detectLocalProvider('ollama'),
            this.detectLocalProvider('lmstudio'),
        ]);
        return detections.filter((detection): detection is GeoAppAiSetupLocalDetection => Boolean(detection));
    }

    async detectLocalProvider(
        id: 'ollama' | 'lmstudio',
        endpointInput?: string
    ): Promise<GeoAppAiSetupLocalDetection | undefined> {
        const endpoint = (endpointInput?.trim() || this.getLocalEndpoint(this.getProvider(id))).replace(/\/+$/, '');
        try {
            if (id === 'ollama') {
                const payload = this.asRecord(await this.modelResolutionService.fetchJson(`${endpoint}/api/tags`));
                if (!Array.isArray(payload?.models)) {
                    return undefined;
                }
                return { id, endpoint, models: this.readNames(payload.models, 'name') };
            }
            const base = this.modelResolutionService.normalizeModelsEndpoint(endpoint);
            const payload = this.asRecord(await this.modelResolutionService.fetchJson(`${base}/models`));
            if (!Array.isArray(payload?.data)) {
                return undefined;
            }
            return { id, endpoint, models: this.readNames(payload.data, 'id') };
        } catch {
            return undefined;
        }
    }

    async listModels(id: GeoAppAiSetupProviderId): Promise<GeoAppAiSetupModel[]> {
        const provider = this.getProvider(id);
        let models: GeoAppAiSetupModel[];
        if (id === 'openrouter') {
            models = await this.listOpenRouterModels();
        } else if (id === 'ollama' || id === 'lmstudio') {
            const detection = await this.detectLocalProvider(id);
            models = (detection?.models ?? []).map(name => ({ id: name, label: name }));
        } else {
            models = await this.listRegisteredModels(provider);
        }
        const suggested = GEOAPP_AI_SETUP_SUGGESTED_MODELS[id];
        return models
            .map(model => suggested.includes(model.id) ? { ...model, recommended: true } : model)
            .sort((left, right) =>
                Number(right.recommended ?? false) - Number(left.recommended ?? false)
                || left.label.localeCompare(right.label, 'fr')
            );
    }

    /** Modèle à présélectionner : celui déjà en place, sinon une suggestion disponible. */
    getPreselectedModel(id: GeoAppAiSetupProviderId, models: readonly GeoAppAiSetupModel[]): string | undefined {
        const provider = this.getProvider(id);
        const current = this.languageModelAliasRegistry?.resolveAlias(GEOAPP_AI_SETUP_DEFAULT_ALIAS)?.[0];
        if (id === 'openrouter') {
            return current === OPENROUTER_STRONG_MODEL_ID ? this.readString(OPENROUTER_STRONG_MODEL_PREF) || undefined : undefined;
        }
        if (current?.startsWith(provider.modelIdPrefix)) {
            const name = current.slice(provider.modelIdPrefix.length);
            if (provider.kind === 'local' || models.some(model => model.id === name)) {
                return name;
            }
        }
        if (provider.kind === 'local') {
            return undefined;
        }
        return models.find(model => model.recommended)?.id ?? models[0]?.id;
    }

    async testModel(modelId: string): Promise<GeoAppAiSetupTestResult> {
        const model = await this.languageModelRegistry?.getLanguageModel(modelId).catch(() => undefined);
        if (!model || !this.languageModelService || model.status?.status === 'unavailable') {
            return { ok: false, reason: 'not-registered' };
        }
        const timeoutMs = this.providerOfModel(modelId) === 'ollama' || this.providerOfModel(modelId) === 'lmstudio'
            ? this.localTestTimeoutMs
            : this.cloudTestTimeoutMs;
        const requestId = `geoapp-ai-setup-${Date.now().toString(36)}-${++this.requestCounter}`;
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
            const exchange = (async () => {
                const response = await this.languageModelService!.sendRequest(model, {
                    messages: [{ actor: 'user', type: 'text', text: 'Réponds uniquement : OK' }],
                    sessionId: `${requestId}-session`,
                    requestId,
                    agentId: 'geoapp-ai-setup',
                });
                // Les erreurs d'un fournisseur en streaming n'apparaissent qu'à la lecture du flux.
                if (isLanguageModelStreamResponse(response)) {
                    for await (const part of response.stream) {
                        void part;
                    }
                }
            })();
            const timeout = new Promise<never>((_, reject) => {
                timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
            });
            await Promise.race([exchange, timeout]);
            return { ok: true };
        } catch (error) {
            return { ok: false, reason: this.classifyFailure(error), detail: this.redact(this.errorMessage(error)) };
        } finally {
            if (timer) {
                clearTimeout(timer);
            }
        }
    }

    /**
     * Enregistre le modèle, le teste, puis le branche sur default/universal.
     * L'alias n'est modifié que si le test réussit.
     */
    async apply(
        id: GeoAppAiSetupProviderId,
        modelChoice: string,
        onProgress?: (phase: GeoAppAiSetupPhase) => void
    ): Promise<GeoAppAiSetupApplyResult> {
        const provider = this.getProvider(id);
        const model = modelChoice.trim();
        if (!model) {
            return { ok: false, phase: 'model', reason: 'model-not-found', detail: 'Aucun modèle choisi.' };
        }

        onProgress?.('connection');
        if (provider.kind === 'cloud' && !this.readString(provider.keyPreference!)) {
            return { ok: false, phase: 'connection', reason: 'invalid-key', detail: 'Aucune clé API enregistrée.' };
        }

        onProgress?.('model');
        let targetId: string;
        try {
            targetId = await this.writeModelPreferences(provider, model);
        } catch (error) {
            return { ok: false, phase: 'model', reason: 'unknown', detail: this.redact(this.errorMessage(error)) };
        }
        const registered = await this.waitForModel(targetId, id === 'openrouter' ? model : undefined);
        if (!registered) {
            return {
                ok: false,
                phase: 'model',
                reason: provider.kind === 'local' ? 'unreachable' : 'not-registered',
            };
        }

        onProgress?.('test');
        const test = await this.testModel(targetId);
        if (test.ok === false) {
            return { ok: false, phase: 'test', reason: test.reason, detail: test.detail };
        }

        onProgress?.('activation');
        if (!this.selectDefaultModel(targetId)) {
            return {
                ok: false,
                phase: 'activation',
                reason: 'unknown',
                detail: 'Le registre d\'alias de Theia n\'accepte pas la sélection d\'un modèle.',
            };
        }
        return { ok: true, status: await this.getStatus() };
    }

    /** Retire le choix de l'assistant : default/universal revient à ses cibles par défaut. */
    async resetDefaultModel(): Promise<void> {
        this.selectDefaultModel('');
    }

    protected async writeModelPreferences(provider: GeoAppAiSetupProvider, model: string): Promise<string> {
        if (provider.id === 'openrouter') {
            await this.preferenceService.set(OPENROUTER_ENABLED_PREF, true, PreferenceScope.User);
            await this.preferenceService.set(OPENROUTER_STRONG_MODEL_PREF, model, PreferenceScope.User);
            return OPENROUTER_STRONG_MODEL_ID;
        }
        const targetId = `${provider.modelIdPrefix}${model}`;
        if (provider.id === 'ollama') {
            const models = this.readArray<string>(OLLAMA_MODELS_PREF);
            if (!models.includes(model)) {
                await this.preferenceService.set(OLLAMA_MODELS_PREF, [...models, model], PreferenceScope.User);
            }
        } else if (provider.id === 'lmstudio') {
            const entry = {
                id: targetId,
                model,
                url: this.modelResolutionService.normalizeModelsEndpoint(this.getLocalEndpoint(provider)),
                apiKey: LMSTUDIO_PLACEHOLDER_KEY,
            };
            const entries = this.readArray<Record<string, unknown>>(OPENAI_CUSTOM_MODELS_PREF);
            const index = entries.findIndex(candidate => (candidate?.id ?? candidate?.model) === targetId);
            const next = index === -1
                ? [...entries, entry]
                : entries.map((candidate, position) => position === index ? { ...candidate, ...entry } : candidate);
            await this.preferenceService.set(OPENAI_CUSTOM_MODELS_PREF, next, PreferenceScope.User);
        }
        return targetId;
    }

    protected selectDefaultModel(modelId: string): boolean {
        const registry = this.languageModelAliasRegistry as (LanguageModelAliasRegistry & SelectableAliasRegistry) | undefined;
        if (!registry || typeof registry.selectModelForAlias !== 'function') {
            return false;
        }
        registry.selectModelForAlias(GEOAPP_AI_SETUP_DEFAULT_ALIAS, modelId);
        this.scheduleStatusChange();
        return true;
    }

    /**
     * Attend que le modèle soit enregistré et utilisable. Pour un slot OpenRouter, attend aussi
     * que le slot pointe vers le modèle demandé : le slot existe déjà avec l'ancien modèle.
     */
    protected async waitForModel(modelId: string, expectedBackingModel?: string): Promise<boolean> {
        for (let elapsed = 0; elapsed <= this.registrationTimeoutMs; elapsed += this.pollIntervalMs) {
            const model = await this.languageModelRegistry?.getLanguageModel(modelId).catch(() => undefined);
            if (model && model.status?.status !== 'unavailable') {
                const backing = (model as unknown as { model?: unknown }).model;
                if (!expectedBackingModel || typeof backing !== 'string' || backing === expectedBackingModel) {
                    return true;
                }
            }
            await this.delay(this.pollIntervalMs);
        }
        return false;
    }

    protected async listOpenRouterModels(): Promise<GeoAppAiSetupModel[]> {
        const baseUrl = this.readString(OPENROUTER_BASE_URL_PREF) || 'https://openrouter.ai/api/v1';
        const endpoint = `${this.modelResolutionService.normalizeModelsEndpoint(baseUrl)}/models`;
        const payload = this.asRecord(await this.modelResolutionService.fetchJson(endpoint, {}, 8000).catch(() => undefined));
        if (!Array.isArray(payload?.data)) {
            return [];
        }
        const models: GeoAppAiSetupModel[] = [];
        for (const raw of payload.data) {
            const entry = this.asRecord(raw);
            const id = typeof entry?.id === 'string' ? entry.id : undefined;
            if (!entry || !id) {
                continue;
            }
            const parameters = Array.isArray(entry.supported_parameters) ? entry.supported_parameters : [];
            const architecture = this.asRecord(entry.architecture);
            const inputModalities = Array.isArray(architecture?.input_modalities) ? architecture.input_modalities : [];
            const supportsTools = parameters.includes('tools');
            if (!supportsTools) {
                continue;
            }
            const name = typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim() : undefined;
            models.push({
                id,
                label: name && name !== id ? `${name} · ${id}` : id,
                supportsTools,
                supportsVision: inputModalities.includes('image'),
            });
        }
        return models;
    }

    /** Anthropic, OpenAI, Google : la découverte suit la saisie de la clé, on lui laisse le temps. */
    protected async listRegisteredModels(provider: GeoAppAiSetupProvider): Promise<GeoAppAiSetupModel[]> {
        for (let elapsed = 0; elapsed <= this.registrationTimeoutMs; elapsed += this.pollIntervalMs) {
            const registered = await this.languageModelRegistry?.getLanguageModels().catch(() => []) ?? [];
            const models = registered
                .filter(model => model.id.startsWith(provider.modelIdPrefix) && model.status?.status !== 'unavailable')
                .map(model => {
                    const id = model.id.slice(provider.modelIdPrefix.length);
                    return { id, label: model.name && model.name !== model.id ? `${model.name} · ${id}` : id };
                });
            if (models.length) {
                return models;
            }
            await this.delay(this.pollIntervalMs);
        }
        return [];
    }

    protected async resolveDefaultModelId(): Promise<string | undefined> {
        await this.languageModelAliasRegistry?.ready;
        const targets = this.languageModelAliasRegistry?.resolveAlias(GEOAPP_AI_SETUP_DEFAULT_ALIAS) ?? [];
        for (const target of targets) {
            const model = await this.languageModelRegistry?.getLanguageModel(target).catch(() => undefined);
            if (model && model.status?.status !== 'unavailable') {
                return target;
            }
        }
        return undefined;
    }

    protected providerOfModel(modelId: string | undefined): GeoAppAiSetupProviderId | undefined {
        return modelId
            ? GEOAPP_AI_SETUP_PROVIDERS.find(provider => modelId.startsWith(provider.modelIdPrefix))?.id
            : undefined;
    }

    protected classifyFailure(error: unknown): GeoAppAiSetupFailure {
        const candidate = error as { status?: unknown; response?: { status?: unknown }; code?: unknown } | undefined;
        const message = this.errorMessage(error);
        const explicitStatus = Number(candidate?.response?.status ?? candidate?.status);
        const status = Number.isFinite(explicitStatus) && explicitStatus > 0
            ? explicitStatus
            : Number(/\b(401|402|403|404|429)\b/.exec(message)?.[1]);
        if (status === 401 || status === 403 || /invalid.{0,20}api.?key|incorrect api key|unauthori[sz]ed|authentication/i.test(message)) {
            return 'invalid-key';
        }
        if (status === 402 || status === 429 || /insufficient.{0,20}(credit|quota|fund)|quota exceeded|billing/i.test(message)) {
            return 'no-credit';
        }
        if (status === 404 || /model.{0,40}(not found|does not exist)|no such model/i.test(message)) {
            return 'model-not-found';
        }
        const code = typeof candidate?.code === 'string' ? candidate.code : '';
        if (/^(?:ECONNABORTED|ECONNREFUSED|ECONNRESET|ENOTFOUND|ERR_NETWORK|ETIMEDOUT)$/i.test(code)
            || /timeout|timed out|network|fetch failed|connection (?:refused|reset|error)|ECONNREFUSED|ENOTFOUND/i.test(message)) {
            return 'unreachable';
        }
        return 'unknown';
    }

    /** Retire les clés connues et les motifs de secrets d'un message avant affichage. */
    redact(text: string): string {
        let result = text;
        const secrets = new Set(this.knownSecrets);
        for (const provider of GEOAPP_AI_SETUP_PROVIDERS) {
            const stored = provider.keyPreference ? this.readString(provider.keyPreference) : '';
            if (stored) {
                secrets.add(stored);
            }
        }
        for (const secret of secrets) {
            if (secret.length >= 6) {
                result = result.split(secret).join('[clé masquée]');
            }
        }
        return result
            .replace(/Bearer\s+[^\s,;]+/gi, 'Bearer [clé masquée]')
            .replace(/\b(api[_-]?key|access[_-]?token|authorization)\s*[=:]\s*[^\s&;,]+/gi, '$1=[clé masquée]')
            .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, '[clé masquée]');
    }

    protected scheduleStatusChange(): void {
        if (this.statusTimer) {
            clearTimeout(this.statusTimer);
        }
        this.statusTimer = setTimeout(() => {
            this.statusTimer = undefined;
            this.getStatus()
                .then(status => this.onDidChangeStatusEmitter.fire(status))
                .catch(error => console.debug('[GeoAppAiSetup] état illisible', this.redact(this.errorMessage(error))));
        }, this.statusDebounceMs);
    }

    /**
     * Les fournisseurs enregistrent leurs modèles de façon asynchrone au démarrage : on attend
     * une période calme avant de considérer l'état comme fiable.
     */
    protected async trackSettling(): Promise<void> {
        const hardLimit = setTimeout(() => this.settled.resolve(), this.settleMaxMs);
        try {
            await this.preferenceService.ready;
            await this.languageModelAliasRegistry?.ready;
        } catch {
            // l'état sera simplement « non prêt »
        }
        let quietTimer = setTimeout(() => this.settled.resolve(), this.settleQuietMs);
        const subscription = this.languageModelRegistry?.onChange(() => {
            clearTimeout(quietTimer);
            quietTimer = setTimeout(() => this.settled.resolve(), this.settleQuietMs);
        });
        await this.settled.promise;
        clearTimeout(hardLimit);
        clearTimeout(quietTimer);
        subscription?.dispose();
    }

    protected getLocalEndpoint(provider: GeoAppAiSetupProvider): string {
        return this.readString(provider.endpointPreference!) || provider.defaultEndpoint!;
    }

    protected readString(key: string): string {
        const value = this.preferenceService.get<string>(key, '');
        return typeof value === 'string' ? value.trim() : '';
    }

    protected readArray<T>(key: string): T[] {
        const value = this.preferenceService.get<T[]>(key, []);
        return Array.isArray(value) ? value : [];
    }

    protected readNames(entries: unknown[], key: string): string[] {
        return entries
            .map(entry => this.asRecord(entry)?.[key])
            .filter((name): name is string => typeof name === 'string' && Boolean(name.trim()));
    }

    protected asRecord(value: unknown): Record<string, unknown> | undefined {
        return value !== null && typeof value === 'object' && !Array.isArray(value)
            ? value as Record<string, unknown>
            : undefined;
    }

    protected delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    protected errorMessage(error: unknown): string {
        return error instanceof Error ? error.message : String(error);
    }
}
