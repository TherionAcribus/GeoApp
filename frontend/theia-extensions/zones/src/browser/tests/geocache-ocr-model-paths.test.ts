import * as assert from 'assert/strict';
import {
    formatGeocacheVisionPluginModel,
    GeocacheDetailsPreferencesController,
} from '../geocache-details-preferences-controller';
import {
    GeoAppOcrAgentId,
    GeoAppOcrLanguageModelRequirements,
    geoAppOcrAgent,
} from '../geoapp-ocr-agent';

class FakePreferenceService {
    constructor(readonly values: Record<string, unknown> = {}) {}

    get<T>(key: string, defaultValue?: T): T {
        return (this.values[key] as T | undefined) ?? (defaultValue as T);
    }
}

function testPluginModelLabels(): void {
    assert.equal(
        formatGeocacheVisionPluginModel('openrouter', 'local-model', 'qwen/qwen3-vl'),
        'OpenRouter/qwen/qwen3-vl'
    );
    assert.equal(
        formatGeocacheVisionPluginModel('openrouter', '', ''),
        'OpenRouter/openai/gpt-4o-mini'
    );
    assert.equal(
        formatGeocacheVisionPluginModel('lmstudio', 'qwen3-vl', 'ignored'),
        'LM Studio/qwen3-vl'
    );
    assert.equal(
        formatGeocacheVisionPluginModel('lmstudio', '', 'ignored'),
        'LM Studio/modèle manquant'
    );
}

function testControllerReadsPluginPreferences(): void {
    const controller = new GeocacheDetailsPreferencesController(new FakePreferenceService({
        'geoApp.ocr.visionProvider': 'openrouter',
        'geoApp.ocr.openRouter.model': 'provider/vision-model',
    }) as any);

    assert.equal(controller.getOcrVisionPluginModelLabel(), 'OpenRouter/provider/vision-model');
}

function testTheiaOcrAgentKeepsItsOwnModelAssignment(): void {
    assert.equal(GeoAppOcrAgentId, 'geoapp-ocr');
    assert.equal(geoAppOcrAgent.id, GeoAppOcrAgentId);
    assert.deepEqual(GeoAppOcrLanguageModelRequirements, [{
        purpose: 'vision-ocr',
        identifier: 'default/universal',
    }]);
    assert.ok(geoAppOcrAgent.description.includes('LanguageModelService'));
    assert.ok(geoAppOcrAgent.description.includes('geoApp.ocr.*'));
}

function run(): void {
    testPluginModelLabels();
    testControllerReadsPluginPreferences();
    testTheiaOcrAgentKeepsItsOwnModelAssignment();
    // eslint-disable-next-line no-console
    console.log('geocache-ocr-model-paths tests passed');
}

run();
