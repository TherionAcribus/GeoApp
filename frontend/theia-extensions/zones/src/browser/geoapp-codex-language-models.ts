import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { PreferenceChange, PreferenceService } from '@theia/core/lib/common/preferences/preference-service';
import { inject, injectable } from '@theia/core/shared/inversify';
import { PREFERENCE_NAME_MAX_RETRIES } from '@theia/ai-core/lib/common/ai-core-preferences';
import { API_KEY_PREF as OPENAI_API_KEY_PREF } from '@theia/ai-openai/lib/common/openai-preferences';
import { OpenAiLanguageModelsManager, OpenAiModelDescription } from '@theia/ai-openai/lib/common';

const CODEX_ENABLED_PREF = 'geoApp.ai.codex.enabled';
const CODEX_API_KEY_PREF = 'geoApp.ai.codex.apiKey';
const CODEX_MODEL_PREF = 'geoApp.ai.codex.model';
const CODEX_STREAMING_PREF = 'geoApp.ai.codex.enableStreaming';
const CODEX_USE_RESPONSE_API_PREF = 'geoApp.ai.codex.useResponseApi';
const CODEX_MODEL_ID = 'codex/default';
const CODEX_DEFAULT_MODEL = 'gpt-5.3-codex';
const HTTP_PROXY_PREF = 'http.proxy';

@injectable()
export class GeoAppCodexLanguageModelsContribution implements FrontendApplicationContribution {

    @inject(PreferenceService)
    protected readonly preferenceService!: PreferenceService;

    @inject(OpenAiLanguageModelsManager)
    protected readonly openAiLanguageModelsManager!: OpenAiLanguageModelsManager;

    protected readonly watchedPreferences = new Set<string>([
        CODEX_ENABLED_PREF,
        CODEX_API_KEY_PREF,
        CODEX_MODEL_PREF,
        CODEX_STREAMING_PREF,
        CODEX_USE_RESPONSE_API_PREF,
        OPENAI_API_KEY_PREF,
        HTTP_PROXY_PREF,
        PREFERENCE_NAME_MAX_RETRIES,
    ]);

    onStart(): void {
        this.preferenceService.ready.then(() => {
            this.refreshModel();
            this.preferenceService.onPreferenceChanged((event: PreferenceChange) => {
                if (event.preferenceName && this.watchedPreferences.has(event.preferenceName)) {
                    this.refreshModel();
                }
            });
        });
    }

    protected refreshModel(): void {
        const model = this.buildModelDescription();

        if (!model) {
            this.openAiLanguageModelsManager.removeLanguageModels(CODEX_MODEL_ID);
            return;
        }

        this.openAiLanguageModelsManager.setProxyUrl(this.preferenceService.get<string>(HTTP_PROXY_PREF, undefined));
        this.openAiLanguageModelsManager.createOrUpdateLanguageModels(model).catch(error => {
            console.error('[GeoAppCodex] Failed to register Codex language model', error);
        });
    }

    protected buildModelDescription(): OpenAiModelDescription | undefined {
        const enabled = this.preferenceService.get<boolean>(CODEX_ENABLED_PREF, true);
        if (!enabled) {
            return undefined;
        }

        const model = this.readStringPreference(CODEX_MODEL_PREF, CODEX_DEFAULT_MODEL).trim();
        if (!model) {
            return undefined;
        }

        const codexApiKey = this.readStringPreference(CODEX_API_KEY_PREF, '').trim();
        const sharedOpenAiApiKey = this.readStringPreference(OPENAI_API_KEY_PREF, '').trim();
        const apiKey: OpenAiModelDescription['apiKey'] = codexApiKey || sharedOpenAiApiKey || true;
        const enableStreaming = this.preferenceService.get<boolean>(CODEX_STREAMING_PREF, true);
        const useResponseApi = this.preferenceService.get<boolean>(CODEX_USE_RESPONSE_API_PREF, true);
        const maxRetries = this.preferenceService.get<number>(PREFERENCE_NAME_MAX_RETRIES, 3);

        return {
            id: CODEX_MODEL_ID,
            model,
            apiKey,
            apiVersion: true,
            deployment: undefined,
            developerMessageSettings: 'developer',
            supportsStructuredOutput: true,
            enableStreaming,
            maxRetries,
            useResponseApi,
        };
    }

    protected readStringPreference(key: string, fallback: string): string {
        const value = this.preferenceService.get<string>(key, fallback);
        return (value || fallback || '').toString();
    }
}
