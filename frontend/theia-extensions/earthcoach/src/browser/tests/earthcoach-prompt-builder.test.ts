import * as assert from 'assert/strict';
import { buildEarthCoachPrompt, toImageContext } from '../earthcoach-prompt-builder';
import { buildEarthCoachSystemPrompt } from '../earthcoach-prompts';
import { GeoImage, UserObservation } from '../earthcoach-types';
import { EarthCoachReferenceTools } from '../earthcoach-reference-tools';
import {
    EARTHCOACH_REFERENCES_ALLOWED_SOURCES_PREF,
    EARTHCOACH_REFERENCES_LANGUAGE_PREF,
    EARTHCOACH_REFERENCES_MAX_ARTICLES_PREF,
    EARTHCOACH_REFERENCES_MAX_IMAGES_PREF,
    EARTHCOACH_REFERENCES_WEB_ENABLED_PREF,
} from '../earthcoach-preferences';

function createImages(): GeoImage[] {
    return [
        {
            id: 'listing-1',
            origin: 'cache_listing',
            cacheId: '1',
            label: 'Schema du listing',
            fileUri: 'https://example.test/listing.jpg',
        },
        {
            id: 'obs-1',
            origin: 'user_observation',
            cacheId: '1',
            label: 'Photo terrain',
            fileUri: 'https://example.test/user.jpg',
        },
        {
            id: 'ref-1',
            origin: 'educational_reference',
            label: 'Quartz',
            fileUri: 'https://example.test/quartz.jpg',
        },
    ];
}

function createObservation(): UserObservation {
    return {
        id: 'note-7',
        cacheId: '1',
        userId: 'local-user',
        note: 'Roche claire avec plusieurs couches visibles, mesure a confirmer.',
        createdAt: '2026-05-19T10:00:00Z',
        sourceNoteId: 7,
        images: [],
    };
}

function testSystemPromptModes(): void {
    const coachPrompt = buildEarthCoachSystemPrompt('coach');
    assert.match(coachPrompt, /Mode courant: coach/);
    assert.match(coachPrompt, /Ne donne jamais directement les reponses finales/);
    assert.match(coachPrompt, /earthcoach_search_reference/);
    assert.match(coachPrompt, /educational_reference/);

    const resolverPrompt = buildEarthCoachSystemPrompt('resolver');
    assert.match(resolverPrompt, /Mode courant: resolver/);
    assert.match(resolverPrompt, /Ne remplis jamais un detail terrain absent/);
}

function testReferenceToolShape(): void {
    const tools = new EarthCoachReferenceTools().buildAllTools();
    assert.equal(tools.length, 1);
    assert.equal(tools[0].id, EarthCoachReferenceTools.SEARCH_REFERENCE_TOOL_ID);
    assert.equal(tools[0].name, 'earthcoach_search_reference');
    assert.match(tools[0].description, /references pedagogiques externes/);
}

class TestReferenceTools extends EarthCoachReferenceTools {

    wikipediaCalls = 0;
    commonsCalls = 0;

    constructor(private readonly preferences: Record<string, unknown> = {}) {
        super();
        (this as any).preferenceService = {
            get: (key: string, fallback: unknown) => key in this.preferences ? this.preferences[key] : fallback,
        };
    }

    protected override async searchWikipedia(query: string, language: 'fr' | 'en', limit: number) {
        this.wikipediaCalls++;
        return [{
            title: `${query} ${language}`,
            summary: `limit ${limit}`,
            url: 'https://example.test/article',
            origin: 'educational_reference' as const,
            source: `Wikipedia ${language}`,
        }];
    }

    protected override async searchCommonsImages(query: string, limit: number) {
        this.commonsCalls++;
        return [{
            id: 'img-1',
            title: `${query} image`,
            imageUrl: 'https://example.test/image.jpg',
            thumbnailUrl: 'https://example.test/thumb.jpg',
            origin: 'educational_reference' as const,
            source: 'Wikimedia Commons' as const,
            description: `limit ${limit}`,
        }];
    }
}

async function testReferenceSearchUsesPreferencesAndCache(): Promise<void> {
    const tools = new TestReferenceTools({
        [EARTHCOACH_REFERENCES_WEB_ENABLED_PREF]: true,
        [EARTHCOACH_REFERENCES_LANGUAGE_PREF]: 'en',
        [EARTHCOACH_REFERENCES_MAX_ARTICLES_PREF]: 2,
        [EARTHCOACH_REFERENCES_MAX_IMAGES_PREF]: 4,
        [EARTHCOACH_REFERENCES_ALLOWED_SOURCES_PREF]: 'wikipedia,wikimedia',
    });

    const first = await tools.searchReference({ query: 'Basalte' });
    assert.equal(first.language, 'en');
    assert.deepEqual(first.allowed_sources, ['wikimedia', 'wikipedia']);
    assert.equal(first.from_cache, false);
    assert.equal(first.articles.length, 1);
    assert.equal(first.images.length, 1);

    const second = await tools.searchReference({ query: ' basalte ' });
    assert.equal(second.from_cache, true);
    assert.equal(tools.wikipediaCalls, 1);
    assert.equal(tools.commonsCalls, 1);
}

async function testReferenceSearchHonorsAllowedSources(): Promise<void> {
    const tools = new TestReferenceTools({
        [EARTHCOACH_REFERENCES_WEB_ENABLED_PREF]: true,
        [EARTHCOACH_REFERENCES_ALLOWED_SOURCES_PREF]: 'wikipedia',
    });

    const result = await tools.searchReference({ query: 'calcaire coquillier', includeImages: true });
    assert.deepEqual(result.allowed_sources, ['wikipedia']);
    assert.equal(result.articles.length, 1);
    assert.equal(result.images.length, 0);
    assert.equal(tools.wikipediaCalls, 1);
    assert.equal(tools.commonsCalls, 0);
}

function testPromptIncludesImageOriginsAndObservations(): void {
    const prompt = buildEarthCoachPrompt({
        geocache: {
            id: 1,
            gc_code: 'GC123',
            name: 'Earth test',
            type: 'EarthCache',
            description_html: '<p>Observer les strates et expliquer leur formation.</p>',
        },
        mode: 'coach',
        action: 'understand',
        observations: [createObservation()],
        gcPersonalNote: 'Penser a mesurer la hauteur approximative.',
        images: createImages(),
    });

    assert.match(prompt, /Description du listing/);
    assert.match(prompt, /\[cache_listing\] listing-1/);
    assert.match(prompt, /\[user_observation\] obs-1/);
    assert.match(prompt, /\[educational_reference\] ref-1/);
    assert.match(prompt, /note #7/);
    assert.match(prompt, /Mode: coach/);
}

function testResolverInstructionDoesNotPretendTerrain(): void {
    const prompt = buildEarthCoachPrompt({
        geocache: {
            id: 1,
            name: 'Earth test',
            type: 'EarthCache',
        },
        mode: 'resolver',
        action: 'resolve',
        observations: [],
        images: [],
    });

    assert.match(prompt, /Mode: resolver/);
    assert.match(prompt, /sans inventer le terrain/);
    assert.match(prompt, /Aucune observation personnelle/);
}

function testImageContextMapping(): void {
    const context = toImageContext(createImages()[1]);
    assert.deepEqual(context, {
        url: 'https://example.test/user.jpg',
        origin: 'user_observation',
        id: 'obs-1',
        label: 'Photo terrain',
        description: undefined,
    });
}

async function run(): Promise<void> {
    testSystemPromptModes();
    testReferenceToolShape();
    testPromptIncludesImageOriginsAndObservations();
    testResolverInstructionDoesNotPretendTerrain();
    testImageContextMapping();
    await testReferenceSearchUsesPreferencesAndCache();
    await testReferenceSearchHonorsAllowedSources();
    // eslint-disable-next-line no-console
    console.log('earthcoach-prompt-builder tests passed');
}

void run();
