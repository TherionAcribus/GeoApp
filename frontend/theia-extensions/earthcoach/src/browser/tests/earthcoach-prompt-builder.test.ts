import * as assert from 'assert/strict';
import { buildEarthCoachFieldChecklist, formatEarthCoachFieldChecklistMarkdown } from '../earthcoach-field-checklist';
import { buildEarthCoachImageGallery } from '../earthcoach-image-gallery';
import {
    buildEarthCoachObservationInput,
    createEarthCoachObservationDraftFromDto,
    toggleObservationImageId,
} from '../earthcoach-observations';
import { buildEarthCoachPrompt, selectEarthCoachImagesForChat, toImageContext } from '../earthcoach-prompt-builder';
import { buildEarthCoachSystemPrompt } from '../earthcoach-prompts';
import { GeoImage, UserObservation } from '../earthcoach-types';
import { EarthCoachNoteTools } from '../earthcoach-note-tools';
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
    assert.match(coachPrompt, /earthcoach_save_note/);
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

function testNoteToolShape(): void {
    const tools = new EarthCoachNoteTools().buildAllTools();
    assert.equal(tools.length, 1);
    assert.equal(tools[0].id, EarthCoachNoteTools.SAVE_NOTE_TOOL_ID);
    assert.equal(tools[0].name, 'earthcoach_save_note');
    assert.match(tools[0].description, /source=earthcoach/);
}

class TestNoteTools extends EarthCoachNoteTools {

    createdNotes: Array<{ geocacheId: number; payload: any }> = [];
    changedEvents: any[] = [];

    constructor() {
        super();
        (this as any).notesService = {
            createNote: async (geocacheId: number, payload: any) => {
                this.createdNotes.push({ geocacheId, payload });
            },
        };
        (this as any).widgetEventsService = {
            notifyGeocacheChanged: (event: any) => {
                this.changedEvents.push(event);
            },
        };
    }
}

async function testSaveEarthCoachNote(): Promise<void> {
    const tools = new TestNoteTools();
    await tools.saveEarthCoachNote({
        geocacheId: 42,
        title: 'Checklist terrain',
        content: 'Observer les strates et noter leur orientation.',
    });

    assert.equal(tools.createdNotes.length, 1);
    assert.equal(tools.createdNotes[0].geocacheId, 42);
    assert.equal(tools.createdNotes[0].payload.note_type, 'system');
    assert.equal(tools.createdNotes[0].payload.source, 'earthcoach');
    assert.equal(tools.createdNotes[0].payload.source_plugin, 'earthcoach');
    assert.match(tools.createdNotes[0].payload.content, /\[EarthCoach\] Checklist terrain/);
    assert.match(tools.createdNotes[0].payload.content, /Observer les strates/);
    assert.deepEqual(tools.changedEvents[0], {
        geocacheId: 42,
        reason: 'note-created',
        source: 'chat',
    });
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
    assert.deepEqual(first.allowed_sources, ['wikipedia', 'wikimedia']);
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

async function testReferenceSearchAddsAdvancedGeologySources(): Promise<void> {
    const tools = new TestReferenceTools({
        [EARTHCOACH_REFERENCES_WEB_ENABLED_PREF]: true,
        [EARTHCOACH_REFERENCES_ALLOWED_SOURCES_PREF]: 'brgm,infoterre,geowiki,planet-terre',
    });

    const result = await tools.searchReference({ query: 'basalte' });
    assert.deepEqual(result.allowed_sources, ['brgm', 'infoterre', 'geowiki', 'planet-terre']);
    assert.equal(result.images.length, 0);
    assert.equal(result.articles.length, 4);
    assert.equal(result.articles.every(article => article.sourceKind === 'source_portal'), true);
    assert.ok(result.articles.some(article => article.source === 'BRGM' && article.url?.includes('search_api_fulltext=basalte')));
    assert.ok(result.articles.some(article => article.source === 'InfoTerre BRGM'));
    assert.ok(result.articles.some(article => article.source === 'GeoWiki' && article.url?.includes('search=basalte')));
    assert.ok(result.articles.some(article => article.source === 'Planet-Terre ENS Lyon' && article.url?.includes('SearchableText=basalte')));
    assert.equal(tools.wikipediaCalls, 0);
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

function testPromptIncludesStructuredObservationMetadata(): void {
    const prompt = buildEarthCoachPrompt({
        geocache: {
            id: 1,
            gc_code: 'GC123',
            name: 'Earth test',
            type: 'EarthCache',
        },
        mode: 'resolver',
        action: 'resolve',
        observations: [{
            id: 'observation-3',
            cacheId: '1',
            userId: 'local-user',
            waypointId: '9',
            observationType: 'interpretation',
            note: 'Les couches pourraient indiquer un depot sedimentaire.',
            observedAt: '2026-05-22T10:15:00+00:00',
            createdAt: '2026-05-22T10:20:00+00:00',
            coordinatesRaw: 'N 48 00.060 E 002 00.060',
            source: 'structured',
            images: [createImages()[1]],
        }],
        images: createImages(),
    });

    assert.match(prompt, /observation-3/);
    assert.match(prompt, /type=interpretation/);
    assert.match(prompt, /waypoint=9/);
    assert.match(prompt, /coords=N 48 00.060 E 002 00.060/);
    assert.match(prompt, /images=obs-1:user_observation/);
}

function testObservationActionInstruction(): void {
    const prompt = buildEarthCoachPrompt({
        geocache: {
            id: 1,
            gc_code: 'GC123',
            name: 'Earth test',
            type: 'EarthCache',
        },
        mode: 'coach',
        action: 'observations',
        observations: [],
        images: [],
    });

    assert.match(prompt, /gerer les observations terrain structurees/);
}

function testObservationInputBuilder(): void {
    const selectedImageIds = toggleObservationImageId([3], 5);
    assert.deepEqual(selectedImageIds, [3, 5]);
    assert.deepEqual(toggleObservationImageId(selectedImageIds, 3), [5]);

    const draft = createEarthCoachObservationDraftFromDto({
        id: 9,
        observation_type: 'hypothesis',
        content: '  Strates plus dures au sommet.  ',
        observed_at: '2026-05-22T10:15:00+00:00',
        waypoint_id: 4,
        coordinates_raw: 'N 48 00.000 E 002 00.000',
        latitude: 48.1,
        longitude: 2.2,
        images: [{ id: 3 }],
    });
    const input = buildEarthCoachObservationInput({
        ...draft,
        latitude: '48,25',
        longitude: '2.50',
        selectedImageIds,
    });

    assert.equal(input.content, 'Strates plus dures au sommet.');
    assert.equal(input.observation_type, 'hypothesis');
    assert.equal(input.waypoint_id, 4);
    assert.equal(input.latitude, 48.25);
    assert.equal(input.longitude, 2.5);
    assert.equal(input.coordinates_raw, 'N 48 00.000 E 002 00.000');
    assert.deepEqual(input.image_ids, [3, 5]);
    assert.equal(typeof input.observed_at, 'string');
}

function testFieldChecklistBuilder(): void {
    const checklist = buildEarthCoachFieldChecklist({
        geocacheData: {
            id: 1,
            gc_code: 'GC123',
            name: 'Earth test',
            type: 'EarthCache',
            difficulty: 2,
            terrain: 3,
            coordinates_raw: 'N 48 00.000 E 002 00.000',
            description_html: '<p>Quelle couleur observe-t-on sur les strates ? Mesurer l epaisseur ?</p>',
            waypoints: [{
                name: 'Point observation',
                type: 'Reference Point',
                gc_coords: 'N 48 00.100 E 002 00.100',
            }],
        },
        observations: [createObservation()],
        gcPersonalNote: null,
        images: createImages(),
    });

    assert.equal(checklist.title, 'Earth test');
    assert.match(checklist.subtitle, /GC123/);
    assert.ok(checklist.sections.some(section => section.title === 'A observer'));
    assert.ok(checklist.sections.some(section => section.title === 'Questions du listing' && section.items.some(item => item.includes('?'))));
    assert.ok(checklist.sections.some(section => section.title === 'Waypoints et reperes' && section.items.some(item => item.includes('Point observation'))));

    const markdown = formatEarthCoachFieldChecklistMarkdown(checklist);
    assert.match(markdown, /# Earth test/);
    assert.match(markdown, /## A photographier/);
    assert.match(markdown, /- \[ \] /);
}

function testImageGalleryGroupsByOrigin(): void {
    const gallery = buildEarthCoachImageGallery(createImages());
    const listing = gallery.sections.find(section => section.origin === 'cache_listing');
    const user = gallery.sections.find(section => section.origin === 'user_observation');
    const refs = gallery.sections.find(section => section.origin === 'educational_reference');

    assert.equal(listing?.images.length, 1);
    assert.equal(user?.images.length, 1);
    assert.equal(refs?.images.length, 1);
    assert.match(user?.warning || '', /observations/);
    assert.match(refs?.warning || '', /jamais etre presentees comme une observation/);
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

function testSelectImagesForChatPrioritizesUserObservations(): void {
    const selected = selectEarthCoachImagesForChat([
        { id: 'listing-1', origin: 'cache_listing', fileUri: 'https://example.test/listing-1.jpg' },
        { id: 'listing-2', origin: 'cache_listing', fileUri: 'https://example.test/listing-2.jpg' },
        { id: 'listing-3', origin: 'cache_listing', fileUri: 'https://example.test/listing-3.jpg' },
        { id: 'listing-4', origin: 'cache_listing', fileUri: 'https://example.test/listing-4.jpg' },
        { id: 'listing-5', origin: 'cache_listing', fileUri: 'https://example.test/listing-5.jpg' },
        { id: '1363', origin: 'user_observation', fileUri: 'https://example.test/user-1.jpg' },
        { id: '1364', origin: 'user_observation', fileUri: 'https://example.test/user-2.jpg' },
    ]);

    assert.deepEqual(selected.map(image => image.id), ['1363', '1364', 'listing-1', 'listing-2', 'listing-3']);
}

function testSelectImagesForChatHonorsPreferredIds(): void {
    const selected = selectEarthCoachImagesForChat([
        { id: '105', origin: 'cache_listing', fileUri: 'https://example.test/listing-1.jpg' },
        { id: '110', origin: 'cache_listing', fileUri: 'https://example.test/listing-6.jpg' },
        { id: '1398', origin: 'user_observation', fileUri: 'https://example.test/user-1.jpg' },
        { id: '1399', origin: 'user_observation', fileUri: 'https://example.test/user-2.jpg' },
    ], 5, ['1398', '1399', '110']);

    assert.deepEqual(selected.map(image => image.id), ['1398', '1399', '110']);
}

async function run(): Promise<void> {
    testSystemPromptModes();
    testReferenceToolShape();
    testNoteToolShape();
    testPromptIncludesImageOriginsAndObservations();
    testPromptIncludesStructuredObservationMetadata();
    testObservationActionInstruction();
    testObservationInputBuilder();
    testFieldChecklistBuilder();
    testImageGalleryGroupsByOrigin();
    testResolverInstructionDoesNotPretendTerrain();
    testImageContextMapping();
    testSelectImagesForChatPrioritizesUserObservations();
    testSelectImagesForChatHonorsPreferredIds();
    await testReferenceSearchUsesPreferencesAndCache();
    await testReferenceSearchHonorsAllowedSources();
    await testReferenceSearchAddsAdvancedGeologySources();
    await testSaveEarthCoachNote();
    // eslint-disable-next-line no-console
    console.log('earthcoach-prompt-builder tests passed');
}

void run();
