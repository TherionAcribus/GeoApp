import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { PreferenceChange, PreferenceService } from '@theia/core/lib/common/preferences/preference-service';
import { inject, injectable } from '@theia/core/shared/inversify';
import { PREFERENCE_NAME_MAX_RETRIES } from '@theia/ai-core/lib/common/ai-core-preferences';
import { OpenAiLanguageModelsManager, OpenAiModelDescription } from '@theia/ai-openai/lib/common';

type OpenRouterProfile = 'fast' | 'strong' | 'web' | 'vision';

const OPENROUTER_ENABLED_PREF = 'geoApp.ai.openRouter.enabled';
const OPENROUTER_API_KEY_PREF = 'geoApp.ai.openRouter.apiKey';
const OPENROUTER_BASE_URL_PREF = 'geoApp.ai.openRouter.baseUrl';
const OPENROUTER_STREAMING_PREF = 'geoApp.ai.openRouter.enableStreaming';
const OPENROUTER_FAST_MODEL_PREF = 'geoApp.ai.openRouter.model.fast';
const OPENROUTER_STRONG_MODEL_PREF = 'geoApp.ai.openRouter.model.strong';
const OPENROUTER_WEB_MODEL_PREF = 'geoApp.ai.openRouter.model.web';
const OPENROUTER_VISION_MODEL_PREF = 'geoApp.ocr.openRouter.model';

const OPENROUTER_MODEL_IDS: Record<OpenRouterProfile, string> = {
    fast: 'openrouter/fast',
    strong: 'openrouter/strong',
    web: 'openrouter/web',
    vision: 'openrouter/vision',
};

const OPENROUTER_MODEL_PREFS: Record<OpenRouterProfile, string> = {
    fast: OPENROUTER_FAST_MODEL_PREF,
    strong: OPENROUTER_STRONG_MODEL_PREF,
    web: OPENROUTER_WEB_MODEL_PREF,
    vision: OPENROUTER_VISION_MODEL_PREF,
};

const OPENROUTER_DEFAULT_MODELS: Record<OpenRouterProfile, string> = {
    fast: 'openai/gpt-4o-mini',
    strong: 'openai/gpt-4o',
    web: 'openai/gpt-4o',
    vision: 'openai/gpt-4o-mini',
};

@injectable()
export class GeoAppOpenRouterLanguageModelsContribution implements FrontendApplicationContribution {

    @inject(PreferenceService)
    protected readonly preferenceService!: PreferenceService;

    @inject(OpenAiLanguageModelsManager)
    protected readonly openAiLanguageModelsManager!: OpenAiLanguageModelsManager;

    protected readonly watchedPreferences = new Set<string>([
        OPENROUTER_ENABLED_PREF,
        OPENROUTER_API_KEY_PREF,
        OPENROUTER_BASE_URL_PREF,
        OPENROUTER_STREAMING_PREF,
        OPENROUTER_FAST_MODEL_PREF,
        OPENROUTER_STRONG_MODEL_PREF,
        OPENROUTER_WEB_MODEL_PREF,
        OPENROUTER_VISION_MODEL_PREF,
        PREFERENCE_NAME_MAX_RETRIES,
    ]);

    onStart(): void {
        this.preferenceService.ready.then(() => {
            this.refreshModels();
            this.preferenceService.onPreferenceChanged((event: PreferenceChange) => {
                if (event.preferenceName && this.watchedPreferences.has(event.preferenceName)) {
                    this.refreshModels();
                }
            });
        });
    }

    protected refreshModels(): void {
        const models = this.buildModelDescriptions();
        const activeIds = new Set(models.map(model => model.id));
        const modelIdsToRemove = Object.values(OPENROUTER_MODEL_IDS).filter(id => !activeIds.has(id));

        if (modelIdsToRemove.length > 0) {
            this.openAiLanguageModelsManager.removeLanguageModels(...modelIdsToRemove);
        }

        if (models.length > 0) {
            this.openAiLanguageModelsManager.createOrUpdateLanguageModels(...models).catch(error => {
                console.error('[GeoAppOpenRouter] Failed to register OpenRouter language models', error);
            });
        }
    }

    protected buildModelDescriptions(): OpenAiModelDescription[] {
        const enabled = this.preferenceService.get<boolean>(OPENROUTER_ENABLED_PREF, true);
        const apiKey = this.readStringPreference(OPENROUTER_API_KEY_PREF, '').trim();
        if (!enabled || !apiKey) {
            return [];
        }

        const baseUrl = this.normalizeBaseUrl(
            this.readStringPreference(OPENROUTER_BASE_URL_PREF, 'https://openrouter.ai/api/v1')
        );
        const enableStreaming = this.preferenceService.get<boolean>(OPENROUTER_STREAMING_PREF, true);
        const maxRetries = this.preferenceService.get<number>(PREFERENCE_NAME_MAX_RETRIES, 3);

        return (Object.keys(OPENROUTER_MODEL_IDS) as OpenRouterProfile[])
            .map(profile => this.createModelDescription(profile, baseUrl, apiKey, enableStreaming, maxRetries))
            .filter((model): model is OpenAiModelDescription => Boolean(model));
    }

    protected createModelDescription(
        profile: OpenRouterProfile,
        baseUrl: string,
        apiKey: string,
        enableStreaming: boolean,
        maxRetries: number
    ): OpenAiModelDescription | undefined {
        const model = this.readStringPreference(OPENROUTER_MODEL_PREFS[profile], OPENROUTER_DEFAULT_MODELS[profile]).trim();
        if (!model) {
            return undefined;
        }

        return {
            id: OPENROUTER_MODEL_IDS[profile],
            model,
            url: baseUrl,
            apiKey,
            apiVersion: undefined,
            deployment: undefined,
            developerMessageSettings: 'system',
            supportsStructuredOutput: false,
            enableStreaming,
            maxRetries,
            useResponseApi: false,
        };
    }

    protected readStringPreference(key: string, fallback: string): string {
        const value = this.preferenceService.get<string>(key, fallback);
        return (value || fallback || '').toString();
    }

    protected normalizeBaseUrl(rawValue: string): string {
        const raw = (rawValue || 'https://openrouter.ai/api/v1').trim();
        if (!raw) {
            return 'https://openrouter.ai/api/v1';
        }
        const withoutCompletionsPath = raw.replace(/\/chat\/completions\/?$/i, '');
        const withoutTrailingSlash = withoutCompletionsPath.replace(/\/+$/g, '');
        if (withoutTrailingSlash.toLowerCase().includes('openrouter.ai')) {
            if (withoutTrailingSlash.toLowerCase().endsWith('/api/v1')) {
                return withoutTrailingSlash;
            }
            if (withoutTrailingSlash.toLowerCase().endsWith('/api')) {
                return `${withoutTrailingSlash}/v1`;
            }
            if (withoutTrailingSlash.toLowerCase().endsWith('/v1')) {
                return withoutTrailingSlash.replace(/\/v1$/i, '/api/v1');
            }
            return `${withoutTrailingSlash}/api/v1`;
        }
        if (withoutTrailingSlash.endsWith('/api/v1') || withoutTrailingSlash.endsWith('/v1')) {
            return withoutTrailingSlash;
        }
        return `${withoutTrailingSlash}/api/v1`;
    }
}
