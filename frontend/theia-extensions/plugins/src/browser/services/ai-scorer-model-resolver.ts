import { inject, injectable, optional } from '@theia/core/shared/inversify';
import { PreferenceService } from '@theia/core/lib/common/preferences/preference-service';
import { AISettingsService, LanguageModelRegistry } from '@theia/ai-core';

export const GEOAPP_AI_SCORER_AGENT_ID = 'geoapp-ai-scorer';

export interface AiScorerRuntimeRequest {
    provider?: string;
    base_url?: string;
    model?: string;
    api_key?: string;
}

export interface AiScorerModelResolution {
    provider: string;
    base_url: string;
    model: string;
    api_key?: string;
    source: 'agent' | 'request' | 'preferences';
    sourceLabel: string;
    theiaModelId?: string;
    assignedIdentifier?: string;
}

type AiScorerBackendModelConfig = Omit<AiScorerModelResolution, 'source' | 'sourceLabel' | 'theiaModelId' | 'assignedIdentifier'>;

interface OpenAiCompatibleModelPreference {
    id?: string;
    model?: string;
    url?: string;
    apiKey?: string | boolean;
    provider?: string;
    deployment?: string;
    apiVersion?: string | boolean;
    useResponseApi?: boolean;
}

const OPENROUTER_SLOT_PREFS: Record<string, string> = {
    'openrouter/fast': 'geoApp.ai.openRouter.model.fast',
    'openrouter/strong': 'geoApp.ai.openRouter.model.strong',
    'openrouter/web': 'geoApp.ai.openRouter.model.web',
    'openrouter/vision': 'geoApp.ocr.openRouter.model',
};

const OPENAI_API_KEY_PREF = 'ai-features.openAiOfficial.openAiApiKey';
const GEOAPP_OPENAI_API_KEY_PREF = 'geoApp.ai.codex.apiKey';
const OPENAI_CUSTOM_ENDPOINTS_PREF = 'ai-features.openAiCustom.customOpenAiModels';
const VERCEL_OPENAI_API_KEY_PREF = 'ai-features.vercelAi.openaiApiKey';
const VERCEL_CUSTOM_ENDPOINTS_PREF = 'ai-features.vercelAi.customModels';
const OLLAMA_HOST_PREF = 'ai-features.ollama.ollamaHost';
const DEFAULT_OLLAMA_HOST = 'http://localhost:11434';
const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com';

/**
 * Traduit l'affectation Theia de `geoapp-ai-scorer` en configuration backend.
 *
 * L'agent Theia est la source de vérité lorsqu'un modèle lui a explicitement été
 * affecté. Sans affectation, les préférences historiques `geoApp.aiScorer.*`
 * restent utilisées. Le backend `/api/plugins/ai-score` n'exécute aujourd'hui
 * que des endpoints OpenAI-compatibles : les modèles qui exigent une API dédiée
 * sont refusés explicitement plutôt que remplacés par un autre modèle.
 */
@injectable()
export class GeoAppAiScorerModelResolver {

    @inject(PreferenceService)
    protected readonly preferenceService!: PreferenceService;

    @inject(AISettingsService) @optional()
    protected readonly aiSettingsService: AISettingsService | undefined;

    @inject(LanguageModelRegistry) @optional()
    protected readonly languageModelRegistry: LanguageModelRegistry | undefined;

    async resolveForRequest(request: AiScorerRuntimeRequest): Promise<AiScorerModelResolution> {
        const preferenceConfig = this.resolvePreferenceConfig(request.provider);
        const explicitRequest = Boolean(request.provider || request.base_url || request.model || request.api_key);
        if (explicitRequest) {
            return {
                provider: request.provider || preferenceConfig.provider,
                base_url: request.base_url || preferenceConfig.base_url,
                model: request.model || preferenceConfig.model,
                api_key: request.api_key || preferenceConfig.api_key,
                source: 'request',
                sourceLabel: 'paramètres explicites de la requête',
            };
        }

        const assignedIdentifier = await this.getAssignedIdentifier();
        if (assignedIdentifier) {
            return this.resolveAssignedModel(assignedIdentifier);
        }

        return preferenceConfig;
    }

    async describeEffectiveSelection(): Promise<string> {
        const assignedIdentifier = await this.getAssignedIdentifier();
        if (assignedIdentifier) {
            try {
                const assigned = await this.resolveAssignedModel(assignedIdentifier);
                const resolved = `${assigned.provider}/${assigned.model}`;
                return assigned.theiaModelId === resolved
                    ? assigned.theiaModelId
                    : `${assigned.theiaModelId} → ${resolved}`;
            } catch (error) {
                return error instanceof Error ? error.message : String(error);
            }
        }

        const preferenceConfig = this.resolvePreferenceConfig();
        return `${preferenceConfig.provider}/${preferenceConfig.model || 'auto-détection'}`;
    }

    protected async getAssignedIdentifier(): Promise<string | undefined> {
        if (!this.aiSettingsService || !this.languageModelRegistry) {
            return undefined;
        }
        try {
            const settings = await this.aiSettingsService.getAgentSettings(GEOAPP_AI_SCORER_AGENT_ID);
            return settings?.languageModelRequirements
                ?.find(requirement => requirement.purpose === 'chat')
                ?.identifier;
        } catch (error) {
            const detail = error instanceof Error ? error.message : String(error);
            throw new Error(`AI Scorer : impossible de lire l'affectation Theia (${detail}).`);
        }
    }

    protected async resolveAssignedModel(identifier: string): Promise<AiScorerModelResolution> {
        if (!this.languageModelRegistry) {
            throw new Error(`AI Scorer : le modèle Theia « ${identifier} » ne peut pas être résolu.`);
        }
        const languageModel = await this.languageModelRegistry.selectLanguageModel({
            agent: GEOAPP_AI_SCORER_AGENT_ID,
            purpose: 'chat',
            identifier,
        });
        if (!languageModel) {
            throw new Error(`AI Scorer : aucun modèle prêt pour l'affectation « ${identifier} ».`);
        }

        const resolved = this.mapTheiaModelToBackendConfig(languageModel.id);
        if (!resolved) {
            throw new Error(
                `AI Scorer : le modèle « ${languageModel.id} » n'est pas exécutable par le backend. `
                + 'Choisissez un modèle OpenAI, OpenRouter, Ollama ou un endpoint OpenAI-compatible.'
            );
        }
        return {
            ...resolved,
            source: 'agent',
            sourceLabel: 'affectation Theia de geoapp-ai-scorer',
            theiaModelId: languageModel.id,
            assignedIdentifier: identifier,
        };
    }

    protected resolvePreferenceConfig(providerOverride?: string): AiScorerModelResolution {
        let provider = (providerOverride || '').trim();
        if (!provider) {
            const scorerProvider = this.readStringPreference('geoApp.aiScorer.provider', 'auto');
            if (scorerProvider !== 'auto') {
                provider = scorerProvider;
            } else {
                const openRouterKey = this.readStringPreference('geoApp.ai.openRouter.apiKey', '');
                provider = openRouterKey ? 'openrouter' : 'lmstudio';
            }
        }

        if (provider === 'openrouter') {
            return {
                provider,
                base_url: this.readStringPreference('geoApp.ai.openRouter.baseUrl', 'https://openrouter.ai/api/v1'),
                model: this.readStringPreference('geoApp.aiScorer.openRouter.model', '')
                    || this.readStringPreference('geoApp.ai.openRouter.model.strong', 'openai/gpt-4o'),
                api_key: this.readStringPreference('geoApp.ai.openRouter.apiKey', ''),
                source: 'preferences',
                sourceLabel: 'préférences GeoApp AI Scorer',
            };
        }

        if (provider === 'openai') {
            return {
                provider,
                base_url: DEFAULT_OPENAI_BASE_URL,
                model: '',
                api_key: this.readOpenAiApiKey(),
                source: 'preferences',
                sourceLabel: 'préférences GeoApp AI Scorer',
            };
        }

        if (provider === 'ollama') {
            return {
                provider,
                base_url: this.readStringPreference(OLLAMA_HOST_PREF, DEFAULT_OLLAMA_HOST),
                model: '',
                source: 'preferences',
                sourceLabel: 'préférences GeoApp AI Scorer',
            };
        }

        return {
            provider: provider || 'lmstudio',
            base_url: this.readStringPreference('geoApp.ocr.lmstudio.baseUrl', 'http://localhost:1234'),
            model: this.readStringPreference('geoApp.aiScorer.lmstudio.model', '')
                || this.readStringPreference('geoApp.ocr.lmstudio.model', ''),
            source: 'preferences',
            sourceLabel: 'préférences GeoApp AI Scorer',
        };
    }

    protected mapTheiaModelToBackendConfig(modelId: string): AiScorerBackendModelConfig | undefined {
        const openRouterPreference = OPENROUTER_SLOT_PREFS[modelId];
        if (openRouterPreference) {
            return {
                provider: 'openrouter',
                base_url: this.readStringPreference('geoApp.ai.openRouter.baseUrl', 'https://openrouter.ai/api/v1'),
                model: this.readStringPreference(openRouterPreference, ''),
                api_key: this.readStringPreference('geoApp.ai.openRouter.apiKey', ''),
            };
        }

        if (modelId.startsWith('openai/')) {
            return {
                provider: 'openai',
                base_url: DEFAULT_OPENAI_BASE_URL,
                model: modelId.slice('openai/'.length),
                api_key: this.readOpenAiApiKey(),
            };
        }

        if (modelId.startsWith('vercel/openai/')) {
            return {
                provider: 'openai',
                base_url: DEFAULT_OPENAI_BASE_URL,
                model: modelId.slice('vercel/openai/'.length),
                api_key: this.readStringPreference(VERCEL_OPENAI_API_KEY_PREF, ''),
            };
        }

        if (modelId.startsWith('ollama/')) {
            return {
                provider: 'ollama',
                base_url: this.readStringPreference(OLLAMA_HOST_PREF, DEFAULT_OLLAMA_HOST),
                model: modelId.slice('ollama/'.length),
            };
        }

        return this.resolveCustomOpenAiEndpoint(modelId);
    }

    protected resolveCustomOpenAiEndpoint(modelId: string): AiScorerBackendModelConfig | undefined {
        const openAiCustom = this.resolveCustomEndpoint(
            modelId,
            this.preferenceService.get<OpenAiCompatibleModelPreference[]>(OPENAI_CUSTOM_ENDPOINTS_PREF, []),
            () => this.readOpenAiApiKey()
        );
        if (openAiCustom) {
            return openAiCustom;
        }

        return this.resolveCustomEndpoint(
            modelId,
            this.preferenceService.get<OpenAiCompatibleModelPreference[]>(VERCEL_CUSTOM_ENDPOINTS_PREF, []),
            () => this.readStringPreference(VERCEL_OPENAI_API_KEY_PREF, ''),
            'vercel/'
        );
    }

    protected resolveCustomEndpoint(
        modelId: string,
        entries: OpenAiCompatibleModelPreference[] | undefined,
        globalApiKey: () => string,
        idPrefix?: string
    ): AiScorerBackendModelConfig | undefined {
        for (const entry of entries || []) {
            const entryId = entry.id || entry.model || '';
            const prefixedId = idPrefix && !entryId.startsWith(idPrefix) ? `${idPrefix}${entryId}` : entryId;
            if (!entry.model || !entry.url || (entryId !== modelId && prefixedId !== modelId)) {
                continue;
            }
            if (entry.provider && entry.provider !== 'openai') {
                return undefined;
            }
            if (entry.deployment || entry.apiVersion || entry.useResponseApi) {
                return undefined;
            }
            return {
                provider: 'openai-compatible',
                base_url: entry.url,
                model: entry.model,
                api_key: entry.apiKey === true ? globalApiKey() : typeof entry.apiKey === 'string' ? entry.apiKey : undefined,
            };
        }
        return undefined;
    }

    protected readOpenAiApiKey(): string {
        return this.readStringPreference(OPENAI_API_KEY_PREF, '')
            || this.readStringPreference(GEOAPP_OPENAI_API_KEY_PREF, '');
    }

    protected readStringPreference(key: string, fallback: string): string {
        const value = this.preferenceService.get<string>(key, fallback);
        return (value || fallback || '').toString().trim();
    }
}
