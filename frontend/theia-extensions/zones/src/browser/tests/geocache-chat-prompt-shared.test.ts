import * as assert from 'assert/strict';
import {
    buildGeocacheChatPrompt,
    buildGeocacheFreeChatContext,
    buildGeocacheFreeChatFinalPrompt,
    buildGeocacheGeoAppOpenChatDetail,
} from '../geocache-chat-prompt-shared';
import { GeoAppChatSystemPromptVariants } from '../geoapp-chat-system-prompts';

function createGeocacheFixture() {
    return {
        id: 42,
        gc_code: 'GC424242',
        name: 'Mystery hybride',
        type: 'Mystery Cache',
        size: 'Regular',
        owner: 'GeoOwner',
        difficulty: 4,
        terrain: 2.5,
        coordinates_raw: 'N 48° 51.396 E 002° 21.132',
        original_coordinates_raw: 'N 48° 50.000 E 002° 20.000',
        placed_at: '2025-03-14',
        status: 'Available',
        description_html: '<div>Formule <strong>A=2</strong> puis lire l image.</div>',
        hints: 'Uryyb jbeyq',
        favorites_count: 17,
        logs_count: 88,
        checkers: [
            { name: 'Certitude', url: 'https://www.certitudes.org/certitude?wp=GC424242' },
            { name: 'Geocaching', url: 'https://www.geocaching.com/play/geocache/GC424242#solution-checker' },
        ],
        waypoints: [
            {
                prefix: 'P1',
                lookup: 'STAGE',
                name: 'Etape 1',
                type: 'Stage',
                gc_coords: 'N 48° 51.500 E 002° 21.200',
                note: 'Compter les marches autour du panneau.',
            },
            {
                name: 'Final',
                latitude: 48.8566,
                longitude: 2.3522,
            },
        ],
    };
}

function testBuildGeocacheChatPrompt(): void {
    const prompt = buildGeocacheChatPrompt(createGeocacheFixture());

    assert.ok(prompt.includes('Certitude (checker) :'));
    assert.ok(prompt.includes('https://www.certitudes.org/certitude?wp=GC424242'));
    assert.ok(prompt.includes('wp="GC424242"'));
    assert.ok(!prompt.includes('Tools disponibles (GeoApp) :'));
    assert.ok(!prompt.includes('Orchestration initiale du listing :'));
    assert.ok(!prompt.includes('~resolve_geocache_workflow'));
    assert.ok(prompt.includes('Note: le checker Geocaching peut etre stocke comme ancre'));
    assert.ok(prompt.includes('--- CONTEXTE GEOCACHE ---'));
    assert.ok(prompt.includes('Nom : Mystery hybride'));
    assert.ok(prompt.includes('Code : GC424242'));
    assert.ok(prompt.includes('Type : Mystery Cache'));
    assert.ok(prompt.includes('Taille : Regular'));
    assert.ok(prompt.includes('Coordonnees originales : N 48° 50.000 E 002° 20.000'));
    assert.ok(prompt.includes('Description (extrait) :'));
    assert.ok(prompt.includes('Formule A=2 puis lire l image.'));
    assert.ok(prompt.includes('Indices (extrait) :'));
    assert.ok(prompt.includes('Hello world'));
    assert.ok(prompt.includes('Waypoints (2) :'));
    assert.ok(prompt.includes('Etape 1 (N 48° 51.500 E 002° 21.200)'));
    assert.ok(prompt.includes('Waypoints (details) :'));
    assert.ok(prompt.includes('- P1 / STAGE • Etape 1 (Stage)'));
    assert.ok(prompt.includes('Note : Compter les marches autour du panneau.'));
    assert.ok(prompt.includes('tools GeoApp exposes par la politique active'));
}

function testSystemPromptVariantsCarryGeoAppRules(): void {
    const guidedTemplate = GeoAppChatSystemPromptVariants.defaultVariant.template;
    assert.ok(guidedTemplate.includes("Tu es un assistant IA specialise dans la resolution d'enigmes de geocaching dans GeoApp."));
    assert.ok(guidedTemplate.includes('Orchestration initiale du listing :'));
    assert.ok(guidedTemplate.includes('Formules / coordonnees :'));
    assert.ok(guidedTemplate.includes('Images / OCR :'));
    assert.ok(guidedTemplate.includes('Codes secrets / metasolver :'));
    assert.ok(guidedTemplate.includes('Verification (checkers) :'));
    assert.ok(guidedTemplate.includes('resolve_geocache_workflow'));
    assert.ok(guidedTemplate.includes('coordinate_projection'));
    assert.ok(guidedTemplate.includes('run_checker'));
}

function testBuildGeocacheGeoAppOpenChatDetail(): void {
    const detail = buildGeocacheGeoAppOpenChatDetail(
        createGeocacheFixture(),
        'formula',
        'strong'
    );

    assert.equal(detail.geocacheId, 42);
    assert.equal(detail.gcCode, 'GC424242');
    assert.equal(detail.geocacheName, 'Mystery hybride');
    assert.equal(detail.sessionTitle, 'CHAT IA - GC424242');
    assert.equal(detail.focus, true);
    assert.equal(detail.workflowKind, 'formula');
    assert.equal(detail.preferredProfile, 'strong');
    assert.ok(typeof detail.prompt === 'string' && detail.prompt.length > 1000);
    assert.ok(detail.prompt?.includes('--- CONTEXTE GEOCACHE ---'));
    assert.ok(detail.prompt?.includes('Waypoints (details) :'));
}

function testBuildGeocacheFreeChatContext(): void {
    const ctx = buildGeocacheFreeChatContext(createGeocacheFixture());

    assert.ok(ctx.includes('--- CONTEXTE GEOCACHE ---'));
    assert.ok(ctx.includes('--- FIN DU CONTEXTE ---'));
    assert.ok(ctx.includes('Nom : Mystery hybride'));
    assert.ok(ctx.includes('Code : GC424242'));
    assert.ok(ctx.includes('Type : Mystery Cache'));
    assert.ok(ctx.includes('Taille : Regular'));
    assert.ok(ctx.includes('Coordonnees originales : N 48° 50.000 E 002° 20.000'));
    assert.ok(ctx.includes('Description :'));
    assert.ok(ctx.includes('Formule A=2 puis lire l image.'));
    assert.ok(ctx.includes('Indices :'));
    assert.ok(ctx.includes('Hello world'));
    assert.ok(ctx.includes('Waypoints (2) :'));
    assert.ok(ctx.includes('Waypoints (details) :'));
    assert.ok(!ctx.includes('Tu es un assistant IA'));
    assert.ok(!ctx.includes('Tools disponibles (GeoApp) :'));
    assert.ok(!ctx.includes('Orchestration initiale'));
}

function testBuildGeocacheFreeChatFinalPrompt(): void {
    const draft = 'Le contexte de la cache\n--- FIN DU CONTEXTE ---';

    const noImages = buildGeocacheFreeChatFinalPrompt(draft, []);
    assert.equal(noImages, draft.trim());

    const withImages = buildGeocacheFreeChatFinalPrompt(draft, [
        'https://example.com/a.jpg',
        'https://example.com/b.jpg',
    ]);
    assert.ok(withImages.includes(draft.trim()));
    assert.ok(withImages.includes('[2 images associees a cette geocache.]'));
    assert.ok(withImages.includes('run_geocache_workflow_step(geocache_id, target_step_id="describe-images")'));
    assert.ok(withImages.includes('NE PAS demander a l utilisateur de decrire l image.'));
    assert.ok(!withImages.includes('https://example.com/a.jpg'));
    assert.ok(!withImages.includes('https://example.com/b.jpg'));
}

function run(): void {
    testBuildGeocacheChatPrompt();
    testSystemPromptVariantsCarryGeoAppRules();
    testBuildGeocacheGeoAppOpenChatDetail();
    testBuildGeocacheFreeChatContext();
    testBuildGeocacheFreeChatFinalPrompt();
    // eslint-disable-next-line no-console
    console.log('geocache-chat-prompt-shared tests passed');
}

run();
