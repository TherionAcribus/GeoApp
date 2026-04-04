import * as assert from 'assert/strict';
import {
    buildGeocacheChatPrompt,
    buildGeocacheGeoAppOpenChatDetail,
} from '../geocache-chat-prompt-shared';

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

    assert.ok(prompt.includes("Tu es un assistant IA specialise dans la resolution d'enigmes de geocaching."));
    assert.ok(prompt.includes('Certitude (checker) :'));
    assert.ok(prompt.includes('https://www.certitudes.org/certitude?wp=GC424242'));
    assert.ok(prompt.includes('wp="GC424242"'));
    assert.ok(prompt.includes('Tools disponibles (GeoApp) :'));
    assert.ok(prompt.includes('~geoapp.plugins.workflow.resolve'));
    assert.ok(prompt.includes('~formula-solver.calculate-coordinates'));
    assert.ok(prompt.includes('Images / OCR :'));
    assert.ok(prompt.includes('Codes secrets / metasolver :'));
    assert.ok(prompt.includes('Verification (checkers) :'));
    assert.ok(prompt.includes('Si resolve_geocache_workflow remonte un direct_plugin_candidate avec should_run_directly=true'));
    assert.ok(prompt.includes('Si execute-direct-plugin renvoie une sortie exploitable, utilise d abord ce resultat'));
    assert.ok(prompt.includes('Si un direct plugin, un calcul de formule ou une etape backend produit une coordonnee plausible'));
    assert.ok(prompt.includes('Ne decris jamais un resultat de plugin, de checker ou de calcul comme un fait acquis'));
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
    assert.ok(prompt.includes('priorise toujours l\'execution des tools GeoApp fiables'));
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

function run(): void {
    testBuildGeocacheChatPrompt();
    testBuildGeocacheGeoAppOpenChatDetail();
    // eslint-disable-next-line no-console
    console.log('geocache-chat-prompt-shared tests passed');
}

run();
