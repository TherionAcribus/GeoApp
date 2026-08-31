import * as assert from 'assert/strict';
import {
    buildEarthCoachFieldChecklist,
    buildEarthCoachFieldChecklistFileName,
    fieldChecklistItemKey,
    formatEarthCoachFieldChecklistMarkdown,
} from '../earthcoach-field-checklist';
import { buildEarthCoachImageGallery } from '../earthcoach-image-gallery';
import {
    applyObservationCoordinatesFill,
    buildEarthCoachObservationInput,
    buildObservationCoordinatesFill,
    createEarthCoachObservationDraft,
    createEarthCoachObservationDraftFromDto,
    findObservationDraftWaypoint,
    formatObservationWaypointLabel,
    toggleObservationImageId,
} from '../earthcoach-observations';
import {
    buildEarthCoachDescriptionExcerpt,
    buildEarthCoachPrompt,
    DESCRIPTION_GAP_MARKER,
    selectEarthCoachImagesForChat,
    toImageContext,
} from '../earthcoach-prompt-builder';
import { buildEarthCoachSystemPrompt } from '../earthcoach-prompts';
import { GeoImage, LoggingTask, UserObservation } from '../earthcoach-types';
import { EarthCoachNoteTools } from '../earthcoach-note-tools';
import { EarthCoachReferenceTools } from '../earthcoach-reference-tools';
import { EarthCoachLoggingTaskTools } from '../earthcoach-logging-task-tools';
import { EarthCoachGeoCalculatorTools } from '../earthcoach-geo-calculator-tools';
import { runEarthCoachCalculation } from '../earthcoach-geo-calculator';
import { EarthCoachGeologyTools } from '../earthcoach-geology-tools';
import { formatFrenchGeologySummary, formatGeologySummary } from '../earthcoach-geology';
import { EarthCoachElevationTools, readElevationPoints } from '../earthcoach-elevation-tools';
import { formatElevationSummary } from '../earthcoach-elevation';
import { EarthCoachModeTools } from '../earthcoach-mode-tools';
import {
    applyEarthCoachModeToSettings,
    normalizeEarthCoachMode,
    readEarthCoachModeFromSettings,
} from '../earthcoach-mode';
import {
    buildLoggingTaskInput,
    buildLoggingTaskSeed,
    createLoggingTaskDraft,
    createLoggingTaskDraftFromDto,
    formatLoggingTaskSeedLabel,
    normalizeExtractionTasks,
} from '../earthcoach-logging-tasks';
import {
    EARTHCOACH_RESPONSE_VERBOSITY_PREF,
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

function createLoggingTasks(): LoggingTask[] {
    return [
        {
            id: 'logging-task-1',
            geocacheId: '1',
            position: 1,
            question: 'Quelle est la couleur dominante de la roche ?',
            guidance: 'Observer la roche en place, hors zones alterees.',
            status: 'todo',
            requiresPhoto: false,
        },
        {
            id: 'logging-task-2',
            geocacheId: '1',
            position: 2,
            question: 'Estimer la hauteur de l affleurement.',
            answer: 'Environ 4 metres.',
            status: 'answered',
            requiresPhoto: true,
            observationId: 'observation-3',
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
    assert.match(coachPrompt, /tres brievement/);

    assert.match(coachPrompt, /\*\*Mode EarthCoach : coach\*\*/);
    assert.match(coachPrompt, /earthcoach_set_mode/);

    const resolverPrompt = buildEarthCoachSystemPrompt('resolver');
    assert.match(resolverPrompt, /Mode courant: resolver/);
    assert.match(resolverPrompt, /Ne remplis jamais un detail terrain absent/);
    assert.match(resolverPrompt, /\*\*Mode EarthCoach : resolution\*\*/);

    const detailedPrompt = buildEarthCoachSystemPrompt('coach', 'detailed');
    assert.match(detailedPrompt, /niveau de detail utile/);
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

function testPromptHonorsCompactVerbosity(): void {
    assert.equal(EARTHCOACH_RESPONSE_VERBOSITY_PREF, 'geoApp.earthCoach.response.verbosity');

    const longDescription = `<p>${'Observer les strates et expliquer leur formation. '.repeat(80)}</p>`;
    const prompt = buildEarthCoachPrompt({
        geocache: {
            id: 1,
            gc_code: 'GC123',
            name: 'Earth test',
            type: 'EarthCache',
            description_html: longDescription,
        },
        mode: 'coach',
        action: 'understand',
        verbosity: 'compact',
        observations: [],
        images: [],
    });

    assert.match(prompt, /Verbosite: compact/);
    assert.match(prompt, /compte rendu rapide du listing/);
    assert.match(prompt, /5 puces maximum/);
    assert.ok(prompt.length < longDescription.length);
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

function testObservationCoordinatesPrefill(): void {
    // Cache: texte + couple numerique, les trois champs sont repris ensemble.
    const cacheFill = buildObservationCoordinatesFill({
        latitude: 48.8584,
        longitude: 2.2945,
        coordinates_raw: 'N 48 51.504 E 002 17.670',
    });
    assert.ok(cacheFill);
    assert.deepEqual(cacheFill, {
        latitude: '48.8584',
        longitude: '2.2945',
        coordinatesRaw: 'N 48 51.504 E 002 17.670',
    });

    // Waypoint sans lat/lon: le texte DDM suffit, les champs numeriques sont
    // vides pour ne pas conserver ceux d une autre source.
    const waypointFill = buildObservationCoordinatesFill({ gc_coords: '  N 48 52.000 E 002 18.000  ' });
    assert.deepEqual(waypointFill, {
        latitude: '',
        longitude: '',
        coordinatesRaw: 'N 48 52.000 E 002 18.000',
    });

    // Rien d exploitable: le bouton correspondant reste desactive.
    assert.equal(buildObservationCoordinatesFill(undefined), undefined);
    assert.equal(buildObservationCoordinatesFill({}), undefined);
    assert.equal(buildObservationCoordinatesFill({ latitude: 48.1, coordinates_raw: '   ' }), undefined);

    const draft = {
        ...createEarthCoachObservationDraft(new Date('2026-05-22T10:15:00Z')),
        content: 'Strates visibles.',
        latitude: '1.5',
        longitude: '2.5',
        coordinatesRaw: 'ancien texte',
        selectedImageIds: [7],
    };
    const filled = applyObservationCoordinatesFill(draft, waypointFill!);
    assert.equal(filled.latitude, '');
    assert.equal(filled.longitude, '');
    assert.equal(filled.coordinatesRaw, 'N 48 52.000 E 002 18.000');
    // Le reste du brouillon est preserve.
    assert.equal(filled.content, 'Strates visibles.');
    assert.deepEqual(filled.selectedImageIds, [7]);
    assert.equal(draft.coordinatesRaw, 'ancien texte');

    const waypoints = [
        { id: 4, prefix: 'P1', name: 'Affleurement', gc_coords: 'N 48 52.000 E 002 18.000' },
        { id: 5, name: 'Parking' },
    ];
    assert.equal(findObservationDraftWaypoint(waypoints, '4')?.name, 'Affleurement');
    assert.equal(findObservationDraftWaypoint(waypoints, ''), undefined);
    assert.equal(findObservationDraftWaypoint(waypoints, '99'), undefined);
    assert.equal(formatObservationWaypointLabel(waypoints[0]), 'P1 / Affleurement');
    assert.equal(formatObservationWaypointLabel({ id: 12 }), 'Waypoint 12');
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
        loggingTasks: [],
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

function testFieldChecklistMarkdownExport(): void {
    const checklist = buildEarthCoachFieldChecklist({
        geocacheData: {
            id: 42,
            gc_code: 'GC123',
            name: 'Earth test',
            type: 'EarthCache',
            description_html: '<p>Quelle couleur ?</p>',
        },
        observations: [],
        loggingTasks: [],
        gcPersonalNote: null,
        images: [],
    });

    assert.equal(checklist.reference, 'GC123');
    assert.equal(
        buildEarthCoachFieldChecklistFileName(checklist, new Date(2026, 7, 31)),
        'earthcoach-terrain-gc123-2026-08-31.md'
    );

    // Le fichier exporte doit refleter les cases cochees dans le widget.
    const section = checklist.sections[0];
    const checked = new Set([fieldChecklistItemKey(section.title, section.items[0])]);
    const markdown = formatEarthCoachFieldChecklistMarkdown(checklist, checked);
    assert.ok(markdown.includes(`- [x] ${section.items[0]}`));
    assert.ok(markdown.includes(`- [ ] ${section.items[1]}`));
}

function testFieldChecklistFileNameFallbacks(): void {
    const noGcCode = buildEarthCoachFieldChecklist({
        geocacheData: {
            id: 77,
            name: 'Grotte de l Eboulis',
            type: 'EarthCache',
        },
        observations: [],
        loggingTasks: [],
        gcPersonalNote: null,
        images: [],
    });

    // Sans code GC, la reference reste l'id GeoApp (meme cle que le stockage local),
    // mais le nom de fichier reste lisible hors application.
    assert.equal(noGcCode.reference, '77');
    assert.equal(
        buildEarthCoachFieldChecklistFileName(noGcCode, new Date(2026, 0, 5)),
        'earthcoach-terrain-geoapp-77-2026-01-05.md'
    );

    const accented = {
        title: 'Falaise \u00c9boulis !',
        subtitle: 'sans code',
        reference: '',
        meta: [],
        sections: [],
    };
    assert.equal(
        buildEarthCoachFieldChecklistFileName(accented, new Date(2026, 11, 1)),
        'earthcoach-terrain-falaise-eboulis-2026-12-01.md'
    );

    const untitled = { title: '', subtitle: '', reference: '', meta: [], sections: [] };
    assert.equal(
        buildEarthCoachFieldChecklistFileName(untitled, new Date(2026, 11, 1)),
        'earthcoach-terrain-earthcache-2026-12-01.md'
    );
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

function testPromptIncludesLoggingTasks(): void {
    const prompt = buildEarthCoachPrompt({
        geocache: {
            id: 1,
            gc_code: 'GC123',
            name: 'Earth test',
            type: 'EarthCache',
        },
        mode: 'coach',
        action: 'understand',
        observations: [],
        loggingTasks: createLoggingTasks(),
        images: [],
    });

    assert.match(prompt, /Questions du proprietaire \(logging tasks\)/);
    assert.match(prompt, /Q1 \[a traiter\]: Quelle est la couleur dominante/);
    assert.match(prompt, /A observer: Observer la roche en place/);
    assert.match(prompt, /Q2 \[repondu; photo requise; observation liee=observation-3\]/);
    assert.match(prompt, /Reponse brouillon: Environ 4 metres./);
}

function testResolverTemplateConsumesLoggingTasks(): void {
    const prompt = buildEarthCoachPrompt({
        geocache: {
            id: 1,
            gc_code: 'GC123',
            name: 'Earth test',
            type: 'EarthCache',
        },
        mode: 'resolver',
        action: 'resolve',
        observations: [],
        loggingTasks: createLoggingTasks(),
        images: [],
    });

    assert.match(prompt, /GABARIT DE RESOLUTION/);
    assert.match(prompt, /Reponse proposee/);
    assert.match(prompt, /Fondee sur/);
    assert.match(prompt, /Confiance: elevee \/ moyenne \/ faible/);
    assert.match(prompt, /Traite les 2 question\(s\) listees/);
}

function testResolverTemplateWithoutLoggingTasks(): void {
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

    assert.match(prompt, /GABARIT DE RESOLUTION/);
    assert.match(prompt, /Aucune logging task structuree/);
}

function testCoachModeHasNoResolverTemplate(): void {
    const prompt = buildEarthCoachPrompt({
        geocache: {
            id: 1,
            name: 'Earth test',
            type: 'EarthCache',
        },
        mode: 'coach',
        action: 'understand',
        observations: [],
        loggingTasks: createLoggingTasks(),
        images: [],
    });

    assert.doesNotMatch(prompt, /GABARIT DE RESOLUTION/);
}

function testFieldChecklistPrefersLoggingTasks(): void {
    const checklist = buildEarthCoachFieldChecklist({
        geocacheData: {
            id: 1,
            gc_code: 'GC123',
            name: 'Earth test',
            type: 'EarthCache',
            description_html: '<p>Quelle couleur observe-t-on sur les strates ?</p>',
        },
        observations: [],
        loggingTasks: createLoggingTasks(),
        gcPersonalNote: null,
        images: [],
    });

    const questions = checklist.sections.find(section => section.title === 'Questions du listing');
    assert.ok(questions);
    assert.ok(questions!.items.some(item => item.startsWith('Q1: Quelle est la couleur dominante')));
    assert.ok(questions!.items.some(item => item.includes('photo requise')));
}

function testLoggingTaskToolShape(): void {
    const tools = new EarthCoachLoggingTaskTools().buildAllTools();
    assert.equal(tools.length, 1);
    assert.equal(tools[0].id, EarthCoachLoggingTaskTools.EXTRACT_TOOL_ID);
    assert.equal(tools[0].name, 'earthcoach_extract_logging_tasks');
    assert.match(tools[0].description, /REMPLACE/);
}

function testLoggingTaskInputBuilder(): void {
    const draft = createLoggingTaskDraft();
    const input = buildLoggingTaskInput({
        ...draft,
        question: '  Couleur de la roche ?  ',
        guidance: '  Observer en place  ',
        answer: '   ',
        status: 'field',
        requiresPhoto: true,
        observationId: '12',
    });
    assert.equal(input.question, 'Couleur de la roche ?');
    assert.equal(input.guidance, 'Observer en place');
    assert.equal(input.answer, null);
    assert.equal(input.status, 'field');
    assert.equal(input.requires_photo, true);
    assert.equal(input.observation_id, 12);

    const emptyObs = buildLoggingTaskInput({ ...draft, question: 'Q', observationId: 'not-a-number' });
    assert.equal(emptyObs.observation_id, null);
}

function testLoggingTaskDraftFromDto(): void {
    const draft = createLoggingTaskDraftFromDto({
        id: 5,
        position: 2,
        question: 'Hauteur ?',
        guidance: null,
        answer: '4 m',
        status: 'answered',
        requires_photo: true,
        observation_id: 7,
    });
    assert.equal(draft.question, 'Hauteur ?');
    assert.equal(draft.guidance, '');
    assert.equal(draft.answer, '4 m');
    assert.equal(draft.status, 'answered');
    assert.equal(draft.requiresPhoto, true);
    assert.equal(draft.observationId, '7');
}

function testNormalizeExtractionTasks(): void {
    const tasks = normalizeExtractionTasks([
        { question: 'Couleur ?', requires_photo: 'oui' },
        { question: '   ' },
        'garbage',
        { question: 'Hauteur ?', guidance: '  mesurer  ', position: 9 },
    ]);
    assert.equal(tasks.length, 2);
    assert.deepEqual(tasks.map(task => task.question), ['Couleur ?', 'Hauteur ?']);
    assert.equal(tasks[0].requires_photo, true);
    assert.equal(tasks[0].position, 1);
    assert.equal(tasks[1].guidance, 'mesurer');
    assert.equal(tasks[1].position, 9);
    assert.equal(tasks[1].status, 'todo');

    assert.deepEqual(normalizeExtractionTasks('nope'), []);
}

function testExtractActionInstruction(): void {
    const prompt = buildEarthCoachPrompt({
        geocache: { id: 1, name: 'Earth test', type: 'EarthCache' },
        mode: 'coach',
        action: 'extract_logging_tasks',
        observations: [],
        images: [],
    });
    assert.match(prompt, /earthcoach_extract_logging_tasks/);
    assert.match(prompt, /sans en inventer/);
}

function testLoggingTaskSeed(): void {
    const seed = buildLoggingTaskSeed({
        id: 8,
        position: 3,
        question: '  Couleur de la roche ?  ',
        guidance: '  observer en place  ',
    });
    assert.deepEqual(seed, {
        taskId: 8,
        position: 3,
        question: 'Couleur de la roche ?',
        guidance: 'observer en place',
    });
    assert.equal(formatLoggingTaskSeedLabel(seed), 'Observation liee a la question Q3: Couleur de la roche ?');

    const emptyGuidance = buildLoggingTaskSeed({ id: 1, position: 1, question: 'Q', guidance: '   ' });
    assert.equal(emptyGuidance.guidance, undefined);
}

function testGeoCalculatorToolShape(): void {
    const tools = new EarthCoachGeoCalculatorTools().buildAllTools();
    assert.equal(tools.length, 1);
    assert.equal(tools[0].id, EarthCoachGeoCalculatorTools.CALCULATE_TOOL_ID);
    assert.equal(tools[0].name, 'earthcoach_calculate');
    assert.match(tools[0].description, /deterministe/);
}

function testGeoCalculations(): void {
    const shadow = runEarthCoachCalculation('height_from_shadow', {
        reference_height: 2,
        reference_shadow: 1.5,
        object_shadow: 9,
    });
    assert.equal(shadow.value, 12);
    assert.equal(shadow.unit, 'm');

    const scale = runEarthCoachCalculation('scale_from_reference', {
        reference_real: 0.3,
        reference_measured: 60,
        target_measured: 240,
    });
    assert.equal(scale.value, 1.2);

    const slope = runEarthCoachCalculation('slope_angle', { rise: 10, run: 10 });
    assert.equal(slope.value, 45);
    assert.equal(slope.extra?.slope_percent, 100);

    const distance = runEarthCoachCalculation('distance_between_coordinates', {
        lat1: 48.0, lon1: 2.0, lat2: 48.0, lon2: 2.0,
    });
    assert.equal(distance.value, 0);

    const distance2 = runEarthCoachCalculation('distance_between_coordinates', {
        lat1: 48.0, lon1: 2.0, lat2: 48.01, lon2: 2.0,
    });
    assert.ok(distance2.value > 1100 && distance2.value < 1120);

    const age = runEarthCoachCalculation('age_from_rate', { amount: 50, rate: 0.5 });
    assert.equal(age.value, 100);
    assert.equal(age.unit, 'an');

    const flow = runEarthCoachCalculation('flow_rate', { volume: 30, time: 6 });
    assert.equal(flow.value, 5);
    assert.equal(flow.unit, 'L/s');

    const diameter = runEarthCoachCalculation('circumference_to_diameter', { circumference: Math.PI });
    assert.equal(diameter.value, 1);

    const avg = runEarthCoachCalculation('average', { values: [2, 4, 6] });
    assert.equal(avg.value, 4);
    assert.equal(avg.extra?.min, 2);
    assert.equal(avg.extra?.max, 6);
}

function testGeoCalculationErrors(): void {
    assert.throws(() => runEarthCoachCalculation('height_from_shadow', { reference_height: 2, object_shadow: 9 }), /reference_shadow/);
    assert.throws(() => runEarthCoachCalculation('slope_angle', { rise: 10, run: 0 }), /run/);
    assert.throws(() => runEarthCoachCalculation('average', { values: [] }), /liste de nombres/);
    assert.throws(() => runEarthCoachCalculation('unknown_op', {}), /Operation inconnue/);
    assert.throws(() => runEarthCoachCalculation('distance_between_coordinates', {
        lat1: 200, lon1: 2, lat2: 48, lon2: 2,
    }), /lat1/);
}

function testGeologyToolShape(): void {
    const tools = new EarthCoachGeologyTools().buildAllTools();
    assert.equal(tools.length, 2);
    assert.equal(tools[0].id, EarthCoachGeologyTools.GEOLOGY_TOOL_ID);
    assert.equal(tools[0].name, 'earthcoach_geology_at_point');
    assert.match(tools[0].description, /Macrostrat/);
    assert.equal(tools[1].id, EarthCoachGeologyTools.FRENCH_GEOLOGY_TOOL_ID);
    assert.equal(tools[1].name, 'earthcoach_geology_france');
    assert.match(tools[1].description, /BRGM/);
    assert.match(tools[1].description, /1\/50 000/);
}

function testFrenchGeologyToolSummary(): void {
    const summary = formatFrenchGeologySummary({
        lat: 45.7722,
        lon: 2.9644,
        source: 'brgm',
        attribution: 'BRGM',
        covered: true,
        lithology: { description: 'Basaltes et rhyolites', rock_type: 'Roches Magmatiques', scale: '1/1 000 000' },
        sheet: { number: '693', name: 'CLERMONT-FERRAND', scale: '1/50 000', notice_url: 'http://ficheinfoterre.brgm.fr/Notices/0693N.pdf' },
        boreholes: [{ bss_id: 'BSS001SVMG', label: 'BSS001SVMG (06935X4002/GT)', commune: 'ORCINES' }],
    });
    assert.match(summary, /Lithologie BRGM \(1\/1 000 000\): Basaltes et rhyolites - Roches Magmatiques/);
    assert.match(summary, /Carte geologique 1\/50 000 n 693 CLERMONT-FERRAND/);
    assert.match(summary, /Notices\/0693N\.pdf/);
    assert.match(summary, /Forage BSS proche: BSS001SVMG \(06935X4002\/GT\) \(ORCINES\)/);

    // Hors France: l'agent doit etre renvoye vers Macrostrat, pas vers un trou noir.
    const outside = formatFrenchGeologySummary({
        lat: 41.9, lon: 12.5, source: 'brgm', attribution: 'BRGM', covered: false, boreholes: [],
    });
    assert.match(outside, /Macrostrat/);
}

function testElevationToolShape(): void {
    const tools = new EarthCoachElevationTools().buildAllTools();
    assert.equal(tools.length, 1);
    assert.equal(tools[0].id, EarthCoachElevationTools.ELEVATION_TOOL_ID);
    assert.equal(tools[0].name, 'earthcoach_elevation_at_point');
    assert.match(tools[0].description, /denivele/);
}

function testReadElevationPoints(): void {
    assert.deepEqual(readElevationPoints({ lat: 45.78, lon: 4.87 }), [{ lat: 45.78, lon: 4.87 }]);
    // Le LLM passe souvent des nombres en chaine.
    assert.deepEqual(readElevationPoints({ lat: '45.78', lon: '4.87' }), [{ lat: 45.78, lon: 4.87 }]);
    assert.deepEqual(
        readElevationPoints({ points: [{ lat: 1, lon: 2 }, { lat: 3, lon: 4 }] }),
        [{ lat: 1, lon: 2 }, { lat: 3, lon: 4 }]
    );
    assert.equal(readElevationPoints({ lat: 45.78 }), undefined);
    assert.equal(readElevationPoints({ points: [] }), undefined);
    assert.equal(readElevationPoints({ points: Array.from({ length: 11 }, () => ({ lat: 1, lon: 2 })) }), undefined);
}

function testFormatElevationSummary(): void {
    const summary = formatElevationSummary({
        points: [
            { lat: 45.7722, lon: 2.9644, elevation_m: 1454.41, source: 'ign_rge_alti' },
            { lat: 41.9028, lon: 12.4964, elevation_m: 58, source: 'open-meteo' },
        ],
        attribution: 'IGN / Open-Meteo',
        difference_m: 1396.41,
    });
    assert.match(summary, /Point 1 \(45.7722, 2.9644\): 1454.41 m \[IGN RGE ALTI\]/);
    assert.match(summary, /Point 2 \(41.9028, 12.4964\): 58 m \[Copernicus DEM \(~90 m\)\]/);
    assert.match(summary, /Denivele entre les points: 1396.41 m/);

    const missing = formatElevationSummary({
        points: [{ lat: 0, lon: 0, elevation_m: null, source: null }],
        attribution: '',
    });
    assert.match(missing, /altitude indisponible/);
}

function testFormatGeologySummary(): void {
    const summary = formatGeologySummary({
        lat: 45.78,
        lon: 4.87,
        source: 'macrostrat',
        attribution: 'Macrostrat',
        units: [
            { name: 'Calcaires du Bajocien', lithology: 'limestone', age_text: 'Bajocian - Bathonian', description: 'Calcaires a entroques.' },
            { strat_name: 'Molasse', scale: 'small' },
        ],
    });
    assert.match(summary, /- Calcaires du Bajocien \(lithologie: limestone; age: Bajocian - Bathonian\)/);
    assert.match(summary, /Calcaires a entroques\./);
    assert.match(summary, /- Molasse \(echelle: small\)/);

    const empty = formatGeologySummary({ lat: 0, lon: 0, source: 'macrostrat', attribution: '', units: [] });
    assert.match(empty, /Aucune unite geologique/);
}

function testGeologyActionInstruction(): void {
    const prompt = buildEarthCoachPrompt({
        geocache: { id: 1, name: 'Earth test', type: 'EarthCache', latitude: 45.78, longitude: 4.87 },
        mode: 'coach',
        action: 'geology_context',
        observations: [],
        images: [],
    });
    assert.match(prompt, /earthcoach_geology_at_point/);
    assert.match(prompt, /earthcoach_geology_france/);
    assert.match(prompt, /earthcoach_elevation_at_point/);
    assert.match(prompt, /Coordonnees decimales: 45.78, 4.87/);
}

function testModeToolShape(): void {
    const tools = new EarthCoachModeTools().buildAllTools();
    assert.equal(tools.length, 1);
    assert.equal(tools[0].id, EarthCoachModeTools.SET_MODE_TOOL_ID);
    assert.equal(tools[0].name, 'earthcoach_set_mode');
}

function testNormalizeEarthCoachMode(): void {
    assert.equal(normalizeEarthCoachMode('resolver'), 'resolver');
    assert.equal(normalizeEarthCoachMode('resolution'), 'resolver');
    assert.equal(normalizeEarthCoachMode('coach'), 'coach');
    assert.equal(normalizeEarthCoachMode('nope'), undefined);
}

function testApplyEarthCoachModeToSettings(): void {
    const settings = {
        ui: { theme: 'dark' },
        commonSettings: { geoapp: { earthcoachMode: 'coach', earthcoachVerbosity: 'normal', gcCode: 'GC1' } },
    };
    const updated = applyEarthCoachModeToSettings(settings, 'resolver');
    assert.equal(readEarthCoachModeFromSettings(updated), 'resolver');
    // Preserve les autres champs
    assert.deepEqual((updated as any).ui, { theme: 'dark' });
    assert.equal((updated as any).commonSettings.geoapp.earthcoachVerbosity, 'normal');
    assert.equal((updated as any).commonSettings.geoapp.gcCode, 'GC1');
    // N'altere pas l'objet d'origine
    assert.equal((settings as any).commonSettings.geoapp.earthcoachMode, 'coach');

    // Robuste sur entree vide
    assert.equal(readEarthCoachModeFromSettings(applyEarthCoachModeToSettings(undefined, 'resolver')), 'resolver');
    assert.equal(readEarthCoachModeFromSettings({}), 'coach');
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

/** Listing type: contexte geologique long, puis les questions du proprietaire tout a la fin. */
function createListingWithTrailingQuestions(): string {
    const context = Array.from(
        { length: 12 },
        (_, index) => `<p>Contexte geologique ${index + 1}. Le calcaire urgonien affleure ici sur plusieurs dizaines de metres et montre une stratification nette liee au depot marin du Cretace inferieur.</p>`
    ).join('');
    return `<h2>Le canyon des Gorges</h2>
<p>Cette EarthCache vous invite a decouvrir un affleurement de calcaire urgonien, temoin d une mer chaude et peu profonde.</p>
${context}
<h3>Pour valider cette EarthCache</h3>
<p>Rendez-vous aux coordonnees indiquees et repondez aux questions suivantes, puis envoyez-moi vos reponses par message :</p>
<ol>
<li>1. Quelle est la couleur dominante de la roche a l affleurement principal ?</li>
<li>2. Mesurez ou estimez l epaisseur moyenne des strates visibles.</li>
<li>3. Observez-vous des fossiles ? Si oui, decrivez leur forme.</li>
</ol>
<p>Une photo devant l affleurement est obligatoire pour logger.</p>`;
}

function testDescriptionExcerptKeepsOwnerQuestions(): void {
    const excerpt = buildEarthCoachDescriptionExcerpt(createListingWithTrailingQuestions(), 900);

    assert.ok(excerpt.truncated);
    assert.ok(excerpt.text.length <= 900);
    // Le debut du listing reste present: c est la ou se pose le contexte geologique.
    assert.match(excerpt.text, /calcaire urgonien, temoin d une mer chaude/);
    // Et surtout la fin, que la troncature en tete perdait systematiquement.
    assert.match(excerpt.text, /Pour valider cette EarthCache/);
    assert.match(excerpt.text, /Quelle est la couleur dominante/);
    assert.match(excerpt.text, /Mesurez ou estimez l epaisseur/);
    assert.match(excerpt.text, /Observez-vous des fossiles/);
    assert.ok(excerpt.hasGaps);
    assert.ok(excerpt.text.includes(DESCRIPTION_GAP_MARKER));
    assert.ok(excerpt.questionSectionFound);
}

function testDescriptionExcerptSegmentsListingWithoutMarkup(): void {
    // Listing ecrit d un seul tenant: sans redecoupage en phrases, la fin serait perdue.
    const filler = 'Le basalte forme ici des orgues verticales bien visibles depuis le sentier. '.repeat(30);
    const excerpt = buildEarthCoachDescriptionExcerpt(
        `<p>Bienvenue sur cette EarthCache. ${filler}Pour logger cette cache, repondez aux questions suivantes : 1) Combien de faces comptent les colonnes ? 2) Quelle est leur hauteur approximative ?</p>`,
        900
    );

    assert.ok(excerpt.text.length <= 900);
    assert.match(excerpt.text, /Bienvenue sur cette EarthCache/);
    assert.match(excerpt.text, /Combien de faces comptent les colonnes/);
    assert.match(excerpt.text, /hauteur approximative/);
}

function testDescriptionExcerptKeepsShortListingIntact(): void {
    const excerpt = buildEarthCoachDescriptionExcerpt(
        '<p>Observer les strates et expliquer leur formation.</p>',
        900
    );

    assert.equal(excerpt.text, 'Observer les strates et expliquer leur formation.');
    assert.equal(excerpt.truncated, false);
    assert.equal(excerpt.hasGaps, false);
    assert.equal(excerpt.questionSectionFound, false);
    assert.equal(buildEarthCoachDescriptionExcerpt(undefined, 900).text, '');
}

function testPromptAsksForLoggingTaskExtractionWhenMissing(): void {
    const promptWithoutTasks = buildEarthCoachPrompt({
        geocache: {
            id: 1,
            gc_code: 'GC123',
            name: 'Earth test',
            type: 'EarthCache',
            description_html: createListingWithTrailingQuestions(),
        },
        mode: 'coach',
        action: 'understand',
        verbosity: 'compact',
        observations: [],
        images: [],
    });

    assert.match(promptWithoutTasks, /extrait cible/);
    assert.match(promptWithoutTasks, /Quelle est la couleur dominante/);
    assert.match(promptWithoutTasks, /Aucune question n est encore enregistree dans GeoApp/);
    assert.match(promptWithoutTasks, /earthcoach_extract_logging_tasks/);

    // Une fois les questions extraites, le rappel disparait au profit des vraies taches.
    const promptWithTasks = buildEarthCoachPrompt({
        geocache: {
            id: 1,
            gc_code: 'GC123',
            name: 'Earth test',
            type: 'EarthCache',
            description_html: createListingWithTrailingQuestions(),
        },
        mode: 'coach',
        action: 'understand',
        verbosity: 'compact',
        observations: [],
        loggingTasks: createLoggingTasks(),
        images: [],
    });

    assert.doesNotMatch(promptWithTasks, /Aucune question n est encore enregistree dans GeoApp/);
    assert.match(promptWithTasks, /Q1 \[a traiter\]: Quelle est la couleur dominante/);
}

function testPromptSkipsExtractionHintWithoutQuestions(): void {
    const prompt = buildEarthCoachPrompt({
        geocache: {
            id: 1,
            gc_code: 'GC123',
            name: 'Earth test',
            type: 'EarthCache',
            description_html: '<p>Cet affleurement montre une stratification nette du Cretace inferieur.</p>',
        },
        mode: 'coach',
        action: 'understand',
        observations: [],
        images: [],
    });

    assert.doesNotMatch(prompt, /Questions du proprietaire \(logging tasks\)/);
    assert.match(prompt, /Description du listing \(integrale\)/);
}

async function run(): Promise<void> {
    testSystemPromptModes();
    testReferenceToolShape();
    testNoteToolShape();
    testPromptIncludesImageOriginsAndObservations();
    testPromptHonorsCompactVerbosity();
    testDescriptionExcerptKeepsOwnerQuestions();
    testDescriptionExcerptSegmentsListingWithoutMarkup();
    testDescriptionExcerptKeepsShortListingIntact();
    testPromptAsksForLoggingTaskExtractionWhenMissing();
    testPromptSkipsExtractionHintWithoutQuestions();
    testPromptIncludesStructuredObservationMetadata();
    testObservationActionInstruction();
    testObservationInputBuilder();
    testObservationCoordinatesPrefill();
    testFieldChecklistBuilder();
    testFieldChecklistMarkdownExport();
    testFieldChecklistFileNameFallbacks();
    testImageGalleryGroupsByOrigin();
    testResolverInstructionDoesNotPretendTerrain();
    testPromptIncludesLoggingTasks();
    testResolverTemplateConsumesLoggingTasks();
    testResolverTemplateWithoutLoggingTasks();
    testCoachModeHasNoResolverTemplate();
    testFieldChecklistPrefersLoggingTasks();
    testLoggingTaskToolShape();
    testLoggingTaskInputBuilder();
    testLoggingTaskDraftFromDto();
    testNormalizeExtractionTasks();
    testLoggingTaskSeed();
    testExtractActionInstruction();
    testGeoCalculatorToolShape();
    testGeoCalculations();
    testGeoCalculationErrors();
    testGeologyToolShape();
    testFormatGeologySummary();
    testFrenchGeologyToolSummary();
    testElevationToolShape();
    testReadElevationPoints();
    testFormatElevationSummary();
    testGeologyActionInstruction();
    testModeToolShape();
    testNormalizeEarthCoachMode();
    testApplyEarthCoachModeToSettings();
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
