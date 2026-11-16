import * as assert from 'assert/strict';
import {
    buildEarthCoachFieldChecklist,
    buildEarthCoachFieldChecklistFileName,
    fieldChecklistItemKey,
    formatEarthCoachFieldChecklistMarkdown,
} from '../earthcoach-field-checklist';
import {
    EARTHCOACH_LOGGING_TASKS_REPLACED_EVENT,
    EARTHCOACH_LOGGING_TASKS_UPDATED_EVENT,
    EARTHCOACH_OBSERVATIONS_UPDATED_EVENT,
    EarthCoachRefreshScheduler,
    GEOAPP_GEOCACHE_IMAGES_UPDATED_EVENT,
    GEOAPP_GEOCACHE_NOTES_UPDATED_EVENT,
    isUpdateForGeocache,
    readUpdatedGeocacheId,
} from '../earthcoach-events';
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
    buildQuickActionPicks,
    buildQuickActionPlaceHolder,
    CHAT_ICON,
    PANEL_ICON,
} from '../earthcoach-quick-actions';
import {
    assembleEarthCoachContext,
    EarthCoachContextCache,
    EarthCoachContextPayload,
    parseEarthCoachContextResponse,
} from '../earthcoach-context-data';
import {
    buildEarthCoachDescriptionExcerpt,
    buildEarthCoachFinalAnswerPrompt,
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
    detectListingLanguage,
    listingAuthoredLanguages,
    resolveFinalAnswerLanguage,
    selectEarthCoachDescription,
} from '../earthcoach-description-selector';
import {
    EarthCoachResultCaptureService,
    normalizeCapturedProposal,
    stripEarthCoachModeBadge,
    withoutPhotoInstructionProposals,
    stripEarthCoachResultBlocks,
} from '../earthcoach-result-capture';
import {
    buildParams,
    err,
    ok,
    parseArgs,
    toPositiveInteger,
} from '../earthcoach-tool-utils';
import {
    applicableProposalIndexes,
    buildEarthCoachCoverage,
    buildPhotoReminders,
    computeEarthCoachCropRect,
    containedImageBox,
    findUncoveredSnapshotTasks,
    prepareEarthCoachImagesForTransmission,
    proposalDiffersFromAi,
    resolveProposalPosition,
    revertProposalPatch,
    validateEarthCoachSelection,
} from '../earthcoach-workspace-logic';
import { EarthCoachPreparedRequest, EarthCoachResultProposal } from '../earthcoach-workspace-types';
import { EarthCoachResultTools } from '../earthcoach-result-tools';
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
    diffLoggingTaskReplacement,
    loggingTaskRestoreInput,
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
    assert.match(coachPrompt, /N affiche jamais le JSON/);
    assert.doesNotMatch(coachPrompt, /Ecris aussi le meme objet JSON/);

    assert.match(coachPrompt, /\*\*Mode EarthCoach : coach\*\*/);
    assert.match(coachPrompt, /earthcoach_set_mode/);

    const resolverPrompt = buildEarthCoachSystemPrompt('resolver');
    assert.match(resolverPrompt, /Mode courant: resolver/);
    assert.match(resolverPrompt, /reponse candidate, meme incertaine/);
    assert.match(resolverPrompt, /\*\*Mode EarthCoach : resolution\*\*/);

    const detailedPrompt = buildEarthCoachSystemPrompt('coach', 'detailed');
    assert.match(detailedPrompt, /niveau de detail utile/);
}

function testSystemPromptResponseLanguage(): void {
    // La langue choisie dans l'UI doit gouverner la consigne systeme: sans
    // parametrage, le francais reste le repli.
    const defaultPrompt = buildEarthCoachSystemPrompt('coach');
    assert.match(defaultPrompt, /Reponds en francais/);

    const englishPrompt = buildEarthCoachSystemPrompt('resolver', 'normal', 'en');
    assert.match(englishPrompt, /Reponds en anglais/);
    assert.doesNotMatch(englishPrompt, /Reponds en francais/);

    const germanPrompt = buildEarthCoachSystemPrompt('coach', 'detailed', 'de');
    assert.match(germanPrompt, /Reponds en allemand/);
    assert.doesNotMatch(germanPrompt, /Reponds en francais/);

    // Les propositions a relire suivent la langue de l'utilisateur, pas celle du listing.
    assert.match(germanPrompt, /propositions de reponse\) est en allemand, meme si le listing est dans une autre langue/);
    assert.match(germanPrompt, /message final destine au proprietaire/);

    const unknownPrompt = buildEarthCoachSystemPrompt('coach', 'compact', 'xx');
    assert.match(unknownPrompt, /Reponds en francais/);
}

function testModeBadgeFollowsResponseLanguage(): void {
    // La ligne de badge est reprise telle quelle dans la conversation: elle
    // suit la langue choisie dans le dossier, avec l'anglais en repli.
    const frenchCoach = buildEarthCoachSystemPrompt('coach', 'compact', 'fr');
    assert.match(frenchCoach, /\*\*Mode EarthCoach : coach\*\* — guide, pas de reponse finale/);

    const englishCoach = buildEarthCoachSystemPrompt('coach', 'compact', 'en');
    assert.match(englishCoach, /\*\*Mode EarthCoach : coach\*\* — guide, no final answer/);
    assert.match(englishCoach, /switch to resolver/);
    assert.doesNotMatch(englishCoach, /pas de reponse finale/);
    // Le reste des regles de mode reste en francais (instructions modele).
    assert.match(englishCoach, /Mode courant: coach/);

    const englishResolver = buildEarthCoachSystemPrompt('resolver', 'compact', 'en');
    assert.match(englishResolver, /synthesis grounded in your data/);
    assert.match(englishResolver, /back to coach/);
    assert.doesNotMatch(englishResolver, /synthese fondee sur tes donnees/);
}

function testSharedToolUtils(): void {
    assert.deepEqual(parseArgs('{"a": 1}'), { a: 1 });
    assert.deepEqual(parseArgs('pas du json'), {});
    const params = buildParams({
        question: { type: 'string', description: 'Q', required: true },
        tags: { type: 'array', description: 'T', items: { type: 'string' } },
        mode: { type: 'string', description: 'M', enum: ['a', 'b'] },
    }) as unknown as {
        properties: Record<string, { enum?: string[]; items?: unknown; required?: boolean }>;
        required: string[];
    };
    assert.deepEqual(params.required, ['question']);
    assert.deepEqual(params.properties.mode.enum, ['a', 'b']);
    assert.deepEqual(params.properties.tags.items, { type: 'string' });
    assert.equal(ok({ x: 1 }), '{"success":true,"data":{"x":1}}');
    assert.equal(err('boom'), '{"success":false,"error":"boom"}');
    assert.equal(toPositiveInteger('4'), 4);
    assert.equal(toPositiveInteger(0), undefined);
    assert.equal(toPositiveInteger('abc'), undefined);
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
    // Les tools GeoApp s'executent par defaut : pas de confirmation embarquee.
    assert.equal(tools[0].confirmAlwaysAllow, undefined);
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
    assert.match(prompt, /--- ACTION DEMANDEE ---/);
    // Le mode n'est plus fige dans le prompt utilisateur: earthcoach_set_mode
    // peut le changer ensuite pour les messages suivants.
    assert.doesNotMatch(prompt, /Mode: (coach|resolver)/);
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
    // La verbosite ne borne plus le contexte: le listing tient dans le budget
    // de contexte unique (extrait), seul le style de reponse est compact.
    assert.match(prompt, /Description du listing \(extrait/);
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

    assert.doesNotMatch(prompt, /Mode: (coach|resolver)/);
    assert.match(prompt, /reponse candidate/);
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
    assert.match(prompt, /Q1 \[task_id=1; a traiter\]: Quelle est la couleur dominante/);
    assert.match(prompt, /A observer: Observer la roche en place/);
    assert.match(prompt, /Q2 \[task_id=2; repondu; photo a joindre au log, ne bloque pas la reponse; observation liee=observation-3\]/);
    assert.doesNotMatch(prompt, /photo requise/);
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
    assert.match(prompt, /Traite toutes les 2 question\(s\) effectivement listees/);
}

function preparedRequestFixture(action: 'resolve' | 'analyze_observations', images: EarthCoachPreparedRequest['images'] = []): EarthCoachPreparedRequest {
    return {
        requestId: 'req-42',
        geocacheId: 1,
        action,
        preparedAt: '2026-09-28T10:00:00Z',
        responseLanguage: 'fr',
        listing: { language: 'fr', fingerprint: 'fp', reliableSeparation: true, html: '', text: '' },
        observations: [],
        loggingTasks: [],
        images,
        groups: [],
        unavailableImages: [],
    };
}

function testCapturedResolutionIsNotDuplicatedInChat(): void {
    // Avec un dossier prepare, le detail part dans le tool : le chat ne doit
    // plus reecrire chaque question (tokens de sortie doubles).
    const image: GeoImage = { id: '9', origin: 'user_observation', label: 'Falaise', fileUri: '/9.jpg' };
    const prompt = buildEarthCoachPrompt({
        geocache: { id: 1, gc_code: 'GC123', name: 'Earth test', type: 'EarthCache' },
        mode: 'resolver',
        action: 'resolve',
        observations: [],
        loggingTasks: createLoggingTasks(),
        images: [image],
        preparedRequest: preparedRequestFixture('resolve', [{ id: '9', origin: 'user_observation', label: 'Falaise', fileUri: '/9.jpg' }]),
    });
    assert.match(prompt, /passe uniquement par earthcoach_capture_result/);
    assert.match(prompt, /Langue de l utilisateur: francais\. Redige dans cette langue .*question_translation, answer, reasoning et missing/);
    assert.match(prompt, /ne recopie pas les reponses question par question/);
    assert.doesNotMatch(prompt, /Reponse proposee:/);
    assert.match(prompt, /Traite toutes les 2 question\(s\)/);
    assert.match(prompt, /photo a joindre au log, ne bloque pas la reponse/);
    // Le tour de precision optionnel est propose pour une resolution capturee.
    assert.match(prompt, /earthcoach_ask_user \(1 a 3 questions ciblees\)/);
    // Images decrites une seule fois, libelle compris.
    assert.doesNotMatch(prompt, /Images transmises:/);
    assert.match(prompt, /image=9; origine=user_observation; libelle=Falaise/);
}

function testSiteContextBlockIsInjected(): void {
    // Geologie / altitude collectees en code: le bloc est identifie comme
    // donnee cartographique, jamais comme observation terrain.
    const prompt = buildEarthCoachPrompt({
        geocache: { id: 1, gc_code: 'GC123', name: 'Earth test', type: 'EarthCache' },
        mode: 'resolver',
        action: 'resolve',
        observations: [],
        loggingTasks: createLoggingTasks(),
        images: [],
        siteContext: 'Geologie du site (BRGM, carte 1/50 000):\nCalcaire du Jurassique',
        preparedRequest: preparedRequestFixture('resolve'),
    });
    assert.match(prompt, /CONTEXTE GEOGRAPHIQUE PRE-COLLECTE/);
    assert.match(prompt, /Calcaire du Jurassique/);
    assert.match(prompt, /ne sont pas des observations terrain/);
}

function testRefineRequestPrompt(): void {
    // Reprise ciblee: une seule proposition attendue, consigne et proposition
    // precedente rappellees au modele.
    const refine: EarthCoachPreparedRequest = {
        ...preparedRequestFixture('resolve'),
        refine: {
            resultId: 7,
            focus: 'contest',
            previous: {
                task_id: 3,
                question: 'Quelle roche ?',
                status: 'partial',
                answer: 'Granite',
                missing: 'Confirmer le grain',
                confidence: 'medium',
                reasoning: 'Couleur claire',
            },
        },
    };
    const prompt = buildEarthCoachPrompt({
        geocache: { id: 1, gc_code: 'GC123', name: 'Earth test', type: 'EarthCache' },
        mode: 'resolver',
        action: 'resolve',
        observations: [],
        loggingTasks: createLoggingTasks().slice(0, 1),
        images: [],
        preparedRequest: refine,
    });
    assert.match(prompt, /REPRISE CIBLEE D UNE QUESTION/);
    assert.match(prompt, /capture exactement une proposition/);
    assert.match(prompt, /reexamine la question de facon critique/);
    assert.match(prompt, /answer=Granite; missing=Confirmer le grain; confidence=medium; raisonnement=Couleur claire/);
}

function testPreparedRequestWithoutImagesSaysSo(): void {
    const prompt = buildEarthCoachPrompt({
        geocache: { id: 1, gc_code: 'GC123', name: 'Earth test', type: 'EarthCache' },
        mode: 'coach',
        action: 'analyze_observations',
        observations: [],
        loggingTasks: createLoggingTasks(),
        images: [],
        preparedRequest: preparedRequestFixture('analyze_observations'),
    });
    assert.match(prompt, /Images: aucune image transmise\./);
    // L'analyse enregistre une liste de releves a faire.
    assert.match(prompt, /proposition par question avec status et missing/);
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
    assert.ok(questions!.items.some(item => item.includes('photo a joindre au log')));
}

function testLoggingTaskToolShape(): void {
    const tools = new EarthCoachLoggingTaskTools().buildAllTools();
    assert.equal(tools.length, 1);
    assert.equal(tools[0].id, EarthCoachLoggingTaskTools.EXTRACT_TOOL_ID);
    assert.equal(tools[0].name, 'earthcoach_extract_logging_tasks');
    assert.match(tools[0].description, /REMPLACE/);
    // Les tools GeoApp s'executent par defaut : pas de confirmation embarquee.
    assert.equal(tools[0].confirmAlwaysAllow, undefined);
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

function testLoggingTaskReplacementDiff(): void {
    // Meme correspondance normalisee que le backend : casse, accents et
    // espaces ne comptent pas. Une question retrouvee conserve son travail ;
    // les autres sont signalees, surtout si elles portent reponse ou
    // observation liee.
    const diff = diffLoggingTaskReplacement(
        [
            { id: 1, question: 'Couleur de la roche ?', answer: 'Gris clair.' },
            { id: 2, question: 'Hauteur  de la strate ?', observation_id: 4 },
            { id: 3, question: 'Question brouillon vide' },
        ],
        [
            { question: '  couleur de la ROCHE ?' },
            { question: 'Quelle est la hauteur de la strate ?' },
            { question: 'Nouvelle question' },
        ]
    );
    assert.equal(diff.unchanged, 1);
    assert.deepEqual(diff.added, ['Quelle est la hauteur de la strate ?', 'Nouvelle question']);
    assert.equal(diff.removed.length, 2);
    assert.deepEqual(diff.removed[0], { question: 'Hauteur  de la strate ?', hasAnswer: false, hasObservation: true });
    assert.deepEqual(diff.removed[1], { question: 'Question brouillon vide', hasAnswer: false, hasObservation: false });

    // Extraction qui conserve tout: aucun diff destructeur.
    const safe = diffLoggingTaskReplacement(
        [{ id: 1, question: 'Couleur ?', answer: 'Gris.' }],
        [{ question: 'Couleur ?' }, { question: 'Épaisseur ?' }]
    );
    assert.equal(safe.unchanged, 1);
    assert.deepEqual(safe.removed, []);
    assert.deepEqual(safe.added, ['Épaisseur ?']);

    // La restauration rejoue tous les champs de travail, provenance comprise.
    assert.deepEqual(
        loggingTaskRestoreInput({
            id: 5,
            position: 2,
            question: '  Hauteur ?  ',
            guidance: 'Mesurer',
            answer: '12 cm',
            status: 'answered',
            requires_photo: true,
            kind: 'photo',
            observation_id: 9,
            source: 'manual',
        }),
        {
            question: 'Hauteur ?',
            guidance: 'Mesurer',
            answer: '12 cm',
            status: 'answered',
            requires_photo: true,
            kind: 'photo',
            observation_id: 9,
            position: 2,
            source: 'manual',
        }
    );
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

async function testSetModeToolTargetsRequestSession(): Promise<void> {
    // Le handler ecrit dans la session portee par le contexte de l'appel, pas
    // dans getActiveSession() qui peut avoir change pendant la requete LLM.
    const tools = new EarthCoachModeTools();
    const tool = tools.buildAllTools()[0];
    let applied: Record<string, unknown> | undefined;
    const fakeModel = {
        settings: { commonSettings: { geoapp: { earthcoachMode: 'coach' } } },
        setSettings: (settings: Record<string, unknown>) => { applied = settings; },
    };
    const result = await tool.handler(
        JSON.stringify({ mode: 'resolver' }),
        { request: { session: fakeModel }, response: {} } as never
    );

    assert.equal((JSON.parse(result as string) as { success: boolean }).success, true);
    const geoapp = (applied?.commonSettings as { geoapp?: { earthcoachMode?: string } } | undefined)?.geoapp;
    assert.equal(geoapp?.earthcoachMode, 'resolver');
    // Le mode precedent et le reste des settings sont preserves.
    assert.equal(readEarthCoachModeFromSettings(applied), 'resolver');
}

function testQuickActionIconsAreConsistent(): void {
    const emojiPattern = /[\u{1F300}-\u{1FAFF}\u{2B00}-\u{2BFF}]/u;
    const picks = buildQuickActionPicks();
    const actions = picks.filter(pick => (pick as any).type !== 'separator') as Array<{ label: string }>;
    assert.ok(actions.length > 0);

    // Chaque action porte exactement un des deux codicons, et aucun emoji de substitution.
    for (const action of actions) {
        const hasChat = action.label.startsWith(CHAT_ICON + ' ');
        const hasPanel = action.label.startsWith(PANEL_ICON + ' ');
        assert.ok(hasChat !== hasPanel, 'label sans icone unique: ' + action.label);
        assert.ok(!emojiPattern.test(action.label), 'emoji residuel: ' + action.label);
    }

    // Le placeHolder est pose sur un attribut d'input DOM: ni codicon brut, ni emoji.
    const placeHolder = buildQuickActionPlaceHolder();
    assert.ok(!placeHolder.includes('$('), placeHolder);
    assert.ok(!emojiPattern.test(placeHolder), placeHolder);
    assert.ok(placeHolder.includes('chat'), placeHolder);
    assert.ok(placeHolder.includes('panneau'), placeHolder);
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

function testPromptRequiresExplicitLoggingTaskExtractionWhenMissing(): void {
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

    // Le budget de contexte ne depend plus de la verbosite: le listing arrive
    // complet meme en compact, les questions du proprietaire restent visibles.
    assert.match(promptWithoutTasks, /Description du listing \(integrale\)/);
    assert.match(promptWithoutTasks, /Quelle est la couleur dominante/);
    assert.match(promptWithoutTasks, /Aucune question n est encore enregistree dans GeoApp/);
    assert.match(promptWithoutTasks, /Ne les extrais pas automatiquement/);
    assert.doesNotMatch(promptWithoutTasks, /Appelle d abord le tool earthcoach_extract_logging_tasks/);

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
    assert.match(promptWithTasks, /Q1 \[task_id=1; a traiter\]: Quelle est la couleur dominante/);
}

function testPromptMarksTasksRequiringPhoto(): void {
    // requires_photo existait dans les donnees mais n'etait jamais transcrit
    // dans le prompt: le modele ne pouvait pas savoir qu'une photo est exigee.
    const tasks: LoggingTask[] = [{
        id: 'logging-task-1',
        geocacheId: '1',
        position: 1,
        question: 'Decrivez l affleurement.',
        status: 'todo',
        requiresPhoto: true,
    }];
    const prompt = buildEarthCoachPrompt({
        geocache: { id: 1, name: 'Earth test', type: 'EarthCache' },
        mode: 'resolver',
        action: 'resolve',
        loggingTasks: tasks,
        observations: [],
        images: [],
    });
    assert.match(prompt, /photo a joindre au log, ne bloque pas la reponse/);
    // La photo part avec le log: elle ne bloque plus l'etat « Prete ».
    assert.match(prompt, /peut etre prete des que sa reponse texte l est/);
    assert.doesNotMatch(prompt, /image utilisateur probante/);
}

function testPhotoInstructionsAreNotQuestions(): void {
    const tasks: LoggingTask[] = [
        { id: 'logging-task-1', geocacheId: '1', position: 1, question: 'Quelle roche affleure ?', status: 'todo', requiresPhoto: false },
        { id: 'logging-task-2', geocacheId: '1', position: 2, question: 'Photo de vous avec la carte du parc.', status: 'todo', requiresPhoto: true, kind: 'photo' },
    ];
    const prompt = buildEarthCoachPrompt({
        geocache: { id: 1, name: 'Earth test', type: 'EarthCache' },
        mode: 'resolver',
        action: 'resolve',
        loggingTasks: tasks,
        observations: [],
        images: [],
    });
    // Seule la vraie question est a traiter; la consigne est listee a part.
    assert.match(prompt, /Traite toutes les 1 question\(s\)/);
    assert.doesNotMatch(prompt, /Q2 \[/);
    assert.match(prompt, /Consignes photo a joindre au log \(pas des questions[^\n]*\n- Photo de vous avec la carte du parc\./);

    assert.deepEqual(buildPhotoReminders([...tasks, { id: 'logging-task-3', geocacheId: '1', position: 3, question: 'Mesurez la strate.', status: 'todo', requiresPhoto: true }]), [
        'Photo de vous avec la carte du parc.',
        'Photo demandée avec Q3 : Mesurez la strate.',
    ]);

    // Le message final annonce la photo jointe, sans la decrire.
    const final = buildEarthCoachFinalAnswerPrompt([{ question: 'q', status: 'ready', answer: 'a' }], { user: 'fr', final: 'en' }, ['Photo de vous avec la carte du parc.']);
    assert.match(final, /\(Photo de vous avec la carte du parc\.\): termine le message par une phrase courte indiquant que la photo demandee est jointe au log/);
    const withoutPhoto = buildEarthCoachFinalAnswerPrompt([{ question: 'q', status: 'ready', answer: 'a' }], { user: 'fr', final: 'en' });
    assert.doesNotMatch(withoutPhoto, /jointe au log/);

    // Le message final se redige a la place de l'utilisateur, sur place:
    // aucune reference aux photos ou donnees fournies au modele.
    assert.match(final, /a la place de l utilisateur, qui etait sur place/);
    assert.match(final, /Ne mentionne jamais les photos, images ou donnees qui t ont ete fournies/);

    // Extraction: le type est conserve, une valeur inconnue redevient une question.
    assert.deepEqual(normalizeExtractionTasks([
        { question: 'Photo avec le panneau', kind: 'photo' },
        { question: 'Quelle roche ?', kind: 'dessin' },
    ]).map(task => task.kind), ['photo', 'question']);

    // Une proposition qui vise une consigne photo est ecartee a la capture.
    const kept = withoutPhotoInstructionProposals([
        { task_id: 1, question: 'Quelle roche affleure ?', status: 'ready', answer: 'Calcaire' },
        { task_id: 2, question: 'Photo de vous avec la carte du parc.', status: 'missing' },
        { question: 'Sans id', status: 'partial' },
    ], tasks);
    assert.deepEqual(kept.map(proposal => proposal.question), ['Quelle roche affleure ?', 'Sans id']);
}

function testMultilingualDescriptionSelection(): void {
    const paragraph = (language: string) => `${language} ${'description geologique complete et question terrain. '.repeat(5)}`;
    const selection = selectEarthCoachDescription({
        id: 1,
        name: 'Multilingue',
        description_html: `<section lang='de'>${paragraph('Deutsch')}</section><section lang='en'>${paragraph('English')}</section><section lang='fr'>${paragraph('Français')}</section>`,
    }, 'fr');

    assert.equal(selection.reliable, true);
    assert.equal(selection.selectedLanguage, 'fr');
    assert.match(selection.selected.text, /Français/);
    assert.doesNotMatch(selection.selected.text, /English|Deutsch/);

    const manual = selectEarthCoachDescription({
        id: 1,
        name: 'Multilingue',
        description_html: `<section lang='de'>${paragraph('Deutsch')}</section><section lang='en'>${paragraph('English')}</section><section lang='fr'>${paragraph('Français')}</section>`,
    }, 'fr', 'en', selection.fingerprint);
    assert.equal(manual.selectedLanguage, 'en');
    assert.match(manual.selected.text, /English/);
}

function testMultilingualDescriptionHandlesNestedDivs(): void {
    // La segmentation par regex s'arretait au premier </div> imbrique: la
    // question placee apres l'encart disparaissait du segment francais alors
    // que la selection restait annoncee fiable.
    const frIntro = `Français. ${'Description geologique complete du site. '.repeat(5)}`;
    const frQuestion = 'Pour valider cette EarthCache, repondez : quelle est la couleur de la roche ?';
    const enPara = `English. ${'Full geological description of the site. '.repeat(6)}`;
    const selection = selectEarthCoachDescription({
        id: 3,
        name: 'Imbrique',
        description_html:
            `<div lang='en'>${enPara}</div>` +
            `<div lang='fr'><p>${frIntro}</p><div class='row'><div><p>Encart imbrique.</p></div></div><p>${frQuestion}</p></div>`,
    }, 'fr');

    assert.equal(selection.reliable, true);
    assert.equal(selection.selectedLanguage, 'fr');
    assert.match(selection.selected.text, /Encart imbrique/);
    assert.match(selection.selected.text, /quelle est la couleur de la roche/);
    assert.doesNotMatch(selection.selected.text, /English/);
}

function testExtractActionReadsFullListingInCompact(): void {
    // L'extraction doit voir TOUT le listing, meme en verbosite compacte:
    // borne a 900 caracteres, le prompt ne gardait que les 5 dernieres
    // questions d'un listing qui en compte 15.
    const questions = Array.from(
        { length: 15 },
        (_, index) => `<li>Question ${index + 1} : releve terrain numero ${index + 1} ?</li>`
    ).join('');
    const context = Array.from(
        { length: 12 },
        (_, index) => `<p>Contexte geologique ${index + 1}. Le calcaire urgonien affleure ici en strates decimetriques bien visibles.</p>`
    ).join('');
    const prompt = buildEarthCoachPrompt({
        geocache: {
            id: 1,
            name: 'Earth test',
            type: 'EarthCache',
            description_html: `<h2>Site</h2>${context}<h3>Pour valider cette EarthCache</h3><ol>${questions}</ol>`,
        },
        mode: 'coach',
        action: 'extract_logging_tasks',
        verbosity: 'compact',
        observations: [],
        images: [],
    });

    assert.match(prompt, /Description du listing \(integrale\)/);
    assert.match(prompt, /Question 1 : releve terrain numero 1/);
    assert.match(prompt, /Question 8 : releve terrain numero 8/);
    assert.match(prompt, /Question 15 : releve terrain numero 15/);
}

function testMultilingualDescriptionFallsBackToFullContent(): void {
    const selection = selectEarthCoachDescription({
        id: 2,
        name: 'Ambigue',
        description_html: '<p>FR / EN : roche claire / light rock, sans séparation fiable.</p>',
    }, 'fr');
    assert.equal(selection.reliable, false);
    assert.match(selection.notice || '', /description complète/);
    assert.match(selection.selected.text, /light rock/);
}

function testResolvePromptKeepsAllEvidenceRegardlessOfVerbosity(): void {
    const loggingTasks: LoggingTask[] = Array.from({ length: 12 }, (_, index) => ({
        id: `logging-task-${index + 1}`,
        geocacheId: '1',
        position: index + 1,
        question: `Question complète ${index + 1}`,
        status: 'todo',
        requiresPhoto: false,
    }));
    const observations: UserObservation[] = Array.from({ length: 8 }, (_, index) => ({
        id: `observation-${index + 1}`,
        cacheId: '1',
        userId: 'local-user',
        note: `Observation complète ${index + 1}`,
        createdAt: '2026-01-01T00:00:00Z',
        images: [],
    }));
    const prompt = buildEarthCoachPrompt({
        geocache: { id: 1, name: 'Preuves', type: 'EarthCache' },
        mode: 'resolver',
        action: 'resolve',
        verbosity: 'compact',
        observations,
        loggingTasks,
        images: [],
    });
    assert.match(prompt, /Question complète 12/);
    assert.match(prompt, /Observation complète 8/);
    assert.doesNotMatch(prompt, /supplementaire\(s\) non inclus/);
}

function testStripEarthCoachResultBlocks(): void {
    // Aucun prompt n'emet plus de bloc ```earthcoach-result; un bloc perdu
    // dans une reponse est simplement masque, jamais reinterprete.
    const response = 'Texte utile\n```earthcoach-result\n{"request_id":"req-1","geocache_id":7,"action":"resolve","proposals":[]}\n```';
    assert.equal(stripEarthCoachResultBlocks(response), 'Texte utile');
}

function testFinalAnswerPromptUsesEditedProposalsWithoutJson(): void {
    const prompt = buildEarthCoachFinalAnswerPrompt([{
        task_id: 17,
        question: 'Welche Steine kannst du finden?',
        question_translation: 'Quelles pierres pouvez-vous trouver ?',
        status: 'partial',
        answer: 'J’ai identifié du calcaire et du marbre.',
        missing: 'Comparer encore la surface du conglomérat.',
        confidence: 'medium',
    }], { user: 'fr', final: 'en' });

    assert.match(prompt, /Langue de l utilisateur: francais/);
    assert.match(prompt, /Langue du message au proprietaire: anglais\. Traduis fidelement/);
    assert.match(prompt, /Quelles pierres pouvez-vous trouver/);
    assert.match(prompt, /J’ai identifié du calcaire et du marbre/);
    assert.match(prompt, /Comparer encore la surface du conglomérat/);
    assert.match(prompt, /source prioritaire/);
    assert.doesNotMatch(prompt, /```|request_id|\{"/);
}

function testFinalAnswerLanguageFollowsOwner(): void {
    const proposal: EarthCoachResultProposal = { question: 'Welche Steine?', status: 'ready', answer: 'Du calcaire.' };
    // Meme langue que le poseur: pas de traduction demandee.
    const same = buildEarthCoachFinalAnswerPrompt([proposal], { user: 'fr', final: 'fr' });
    assert.match(same, /Langue du message au proprietaire: francais\./);
    assert.doesNotMatch(same, /Traduis/);
    // Langue du listing inconnue: le modele applique la regle sur les questions originales.
    const unknown = buildEarthCoachFinalAnswerPrompt([proposal], { user: 'fr' });
    assert.match(unknown, /si les questions originales sont en francais, redige-le en francais; sinon redige-le en anglais/);
}

function testResolveFinalAnswerLanguage(): void {
    const paragraph = (language: string) => `${language} ${'description geologique complete et question terrain. '.repeat(5)}`;
    const bilingual = selectEarthCoachDescription({
        id: 1,
        name: 'Bilingue',
        description_html: `<section lang='de'>${paragraph('Deutsch')}</section><section lang='en'>${paragraph('English')}</section>`,
    }, 'fr');
    assert.deepEqual(listingAuthoredLanguages(bilingual), ['de', 'en']);
    // Le poseur ne propose pas le francais: message en anglais.
    assert.equal(resolveFinalAnswerLanguage('fr', listingAuthoredLanguages(bilingual)), 'en');
    // Le poseur propose la langue de l'utilisateur: on la garde.
    assert.equal(resolveFinalAnswerLanguage('de', listingAuthoredLanguages(bilingual)), 'de');

    // Description complete: son libelle vient des preferences, la langue reste inconnue.
    const full = selectEarthCoachDescription({ id: 2, name: 'Simple', description_html: '<p>Une seule langue.</p>' }, 'fr');
    assert.equal(listingAuthoredLanguages(full), undefined);
    assert.equal(resolveFinalAnswerLanguage('fr', listingAuthoredLanguages(full)), undefined);
}

function testStripEarthCoachModeBadge(): void {
    const response = '**Mode EarthCoach : resolution** — synthese fondee sur tes donnees (dis "reviens en coach" pour changer).\n\nHello,\nhere are my answers.';
    assert.equal(stripEarthCoachModeBadge(response), 'Hello,\nhere are my answers.');
    assert.equal(stripEarthCoachModeBadge('Hello **Mode EarthCoach : x**'), 'Hello **Mode EarthCoach : x**');
}

const KRKA_LISTING = 'Krka National Park is located in central Dalmatia. The river flows through a canyon of limestone, and the waterfalls are formed by travertine barriers. To log this cache, answer the questions: the date of declaration of the national park, the name of the biggest waterfall, and what kind of material the underlay is mostly made of. Send your answers with a photo of you at the map.';

function testDetectListingLanguage(): void {
    assert.equal(detectListingLanguage(KRKA_LISTING), 'en');
    assert.equal(detectListingLanguage('Le site est une ancienne carrière de calcaire. Les strates sont bien visibles dans la falaise et nous vous demandons de relever leur épaisseur. Pour valider cette cache, envoyez vos réponses avec une photo de vous sur le site, mais pas des strates.'), 'fr');
    assert.equal(detectListingLanguage('Die Wasserfälle sind aus Kalktuff entstanden. Der Fluss hat sich in den Kalkstein eingeschnitten und es ist nicht einfach, die Schichten zu erkennen. Bitte sende die Antworten mit einem Foto von dir und der Karte, die auch im Park zu sehen ist.'), 'de');
    // Deux langues sans separation exploitable: les deux sont annoncees.
    assert.equal(detectListingLanguage(`${KRKA_LISTING} Le parc est situé en Dalmatie et les cascades sont formées par des barrières de travertin. Pour valider cette cache, envoyez vos réponses avec une photo, mais pas des cascades.`), 'en+fr');
    assert.equal(detectListingLanguage('Krka, 1985.'), undefined);
}

function testMonolingualListingIsLabelledByDetection(): void {
    // Un listing anglais sans versions separees etait annonce "Francais"
    // (preference) et "separation pas assez fiable".
    const selection = selectEarthCoachDescription({ id: 2058, name: 'Krka', description_html: `<p>${KRKA_LISTING}</p>` }, 'fr');
    assert.equal(selection.selectedLanguage, 'en');
    assert.equal(selection.selected.label, 'English');
    assert.equal(selection.reliable, true);
    assert.equal(selection.notice, undefined);
    assert.deepEqual(listingAuthoredLanguages(selection), ['en']);
    assert.equal(resolveFinalAnswerLanguage('fr', listingAuthoredLanguages(selection)), 'en');

    const override = selectEarthCoachDescription({ id: 2058, name: 'Krka', description_override_html: `<p>${KRKA_LISTING}</p>` }, 'fr');
    assert.equal(override.selectedLanguage, 'en');
    // Texte de l'utilisateur: il ne dit rien de la langue du poseur.
    assert.equal(listingAuthoredLanguages(override), undefined);
}

function testStripChatTraceFromResultMarkdown(): void {
    const stored = '<Thinking>Clarifying tasks\n\nI need the geology tool.</Thinking>\n\nTool call: earthcoach_geology_at_point({"lat":43.8,"lon":15.96})\n\nTool call: earthcoach_capture_result({"proposals":[]})\n\nSynthese utile.';
    assert.equal(stripEarthCoachResultBlocks(stored), 'Synthese utile.');
}

function testNormalizeCapturedProposalMissing(): void {
    const normalize = (missing: string) => normalizeCapturedProposal({ question: 'q', status: 'partial', missing }).missing;
    assert.equal(normalize('To complete: provide the declaration date.'), 'provide the declaration date.');
    assert.equal(normalize('À compléter : mesurer la hauteur.\nA completer: photographier.'), 'mesurer la hauteur.\nphotographier.');
    assert.equal(normalize('Mesurer la hauteur de chute.'), 'Mesurer la hauteur de chute.');
    assert.equal(normalize('To complete:'), null);
}

function testWorkspaceSelectionValidation(): void {
    const personal: GeoImage = { id: '1', origin: 'user_observation', fileUri: '/personal.jpg' };
    const listing: GeoImage = { id: '2', origin: 'cache_listing', fileUri: '/listing.jpg' };
    const group = [{
        title: 'Paire',
        position: 0,
        members: [
            { image_id: 1, role: 'original' as const, position: 0 },
            { image_id: 2, role: 'detail' as const, position: 1 },
        ],
    }];

    assert.match(validateEarthCoachSelection([personal], group, 8, true).error || '', /entièrement/);
    assert.match(validateEarthCoachSelection([listing], [], 8, false).error || '', /Continuer sans photo/);
    assert.equal(validateEarthCoachSelection([], [], 8, true).valid, true);
    assert.match(validateEarthCoachSelection(Array(9).fill(listing), [], 8, true).error || '', /8 images maximum/);
    assert.equal(validateEarthCoachSelection([personal, listing], group, 8, false).valid, true);
}

async function testOwnerImageFallsBackToBackendStorage(): Promise<void> {
    const remoteUrl = 'https://img.geocaching.com/cache/large/owner.jpg';
    const localUrl = 'http://localhost:8000/api/geocache-images/4935/content';
    const fetched: string[] = [];
    const stored: number[] = [];
    const result = await prepareEarthCoachImagesForTransmission([{
        id: '4935',
        origin: 'cache_listing',
        imageType: 'owner',
        label: 'Photo owner',
        fileUri: remoteUrl,
    }], async url => {
        fetched.push(url);
        if (url === remoteUrl) {
            throw new TypeError('Failed to fetch');
        }
        return {
            ok: true,
            status: 200,
            blob: async () => ({ type: 'image/jpeg' }),
        } as Response;
    }, async imageId => {
        stored.push(imageId);
        return localUrl;
    });

    assert.deepEqual(fetched, [remoteUrl, localUrl]);
    assert.deepEqual(stored, [4935]);
    assert.equal(result.failures.length, 0);
    assert.equal(result.available[0].fileUri, localUrl);
}

async function testPreparedImagesAreEncodedOnce(): Promise<void> {
    // La validation produit l'encodage final : une seule preparation par image,
    // rangee sous l'URL retenue pour que le bridge ne refasse rien.
    const remoteUrl = 'https://img.geocaching.com/cache/large/owner.jpg';
    const localUrl = 'http://localhost:8000/api/geocache-images/12/content';
    const directUrl = 'http://localhost:8000/api/geocache-images/13/content';
    let encodeCalls = 0;
    const result = await prepareEarthCoachImagesForTransmission(
        [
            { id: '12', origin: 'cache_listing', fileUri: remoteUrl },
            { id: '13', origin: 'user_observation', fileUri: directUrl },
        ],
        async url => {
            if (url === remoteUrl) {
                throw new TypeError('Failed to fetch');
            }
            return { ok: true, status: 200, blob: async () => ({ type: 'image/jpeg' }) } as Response;
        },
        async () => localUrl,
        async () => {
            encodeCalls++;
            return { data: `encoded-${encodeCalls}`, mimeType: 'image/jpeg' };
        }
    );
    assert.equal(encodeCalls, 2);
    assert.equal(result.available.length, 2);
    assert.deepEqual([...result.prepared.keys()].sort(), [directUrl, localUrl].sort());
    assert.equal(result.available[0].fileUri, localUrl);
}

function testSelectionValidationPointsAtFix(): void {
    const personal: GeoImage = { id: '1', origin: 'user_observation', fileUri: '/1.jpg' };
    const listing: GeoImage = { id: '2', origin: 'cache_listing', fileUri: '/2.jpg' };
    const groups = [
        { title: 'Seule', position: 0, members: [{ image_id: 3, role: 'other' as const, position: 0 }] },
        {
            title: 'Paire',
            position: 1,
            members: [
                { image_id: 1, role: 'overview' as const, position: 0 },
                { image_id: 2, role: 'detail' as const, position: 1 },
            ],
        },
    ];
    const partial = validateEarthCoachSelection([personal], groups, 8, true);
    assert.equal(partial.incompleteGroupIndex, 1);
    const tooMany = validateEarthCoachSelection([personal, listing], [], 1, true);
    assert.equal(tooMany.overLimit, true);
}

function testCoverageMatrix(): void {
    const tasks: LoggingTask[] = [
        { id: 'logging-task-3', geocacheId: '1', position: 3, question: 'Q photo', status: 'field', requiresPhoto: true, observationId: 'observation-20' },
        { id: 'logging-task-1', geocacheId: '1', position: 1, question: 'Q sans obs', status: 'todo', requiresPhoto: false },
        { id: 'logging-task-2', geocacheId: '1', position: 2, question: 'Q prete', status: 'todo', requiresPhoto: true, observationId: 'observation-10' },
        { id: 'logging-task-4', geocacheId: '1', position: 4, question: 'Q repondue', status: 'answered', requiresPhoto: false },
        { id: 'logging-task-5', geocacheId: '1', position: 5, question: 'Photo avec le panneau', status: 'todo', requiresPhoto: true, kind: 'photo' },
    ];
    const observations: UserObservation[] = [
        { id: 'observation-10', cacheId: '1', userId: 'u', note: 'Strates   inclinees vers le nord', createdAt: '', source: 'structured', images: [] },
        { id: 'observation-20', cacheId: '1', userId: 'u', note: 'Couleur ocre', createdAt: '', source: 'structured', images: [] },
    ];
    const images: GeoImage[] = [
        { id: '55', origin: 'user_observation', fileUri: '/55.jpg' },
        { id: '56', origin: 'cache_listing', fileUri: '/56.jpg' },
    ];
    // Photo personnelle rattachee a l'observation 10 par le dossier; l'observation 20
    // n'a qu'une image du listing, qui ne compte pas comme preuve.
    const contexts = [
        { image_id: 55, included: true, observation_id: 10, position: 0 },
        { image_id: 56, included: false, observation_id: 20, position: 1 },
    ];
    const rows = buildEarthCoachCoverage(tasks, observations, images, contexts);
    assert.deepEqual(rows.map(row => row.position), [1, 2, 3, 4]);
    // La consigne photo n'est pas une ligne de couverture, et une photo
    // absente ne rend plus une question « a completer ».
    assert.deepEqual(rows.map(row => row.state), ['needs_field', 'ready_to_resolve', 'ready_to_resolve', 'answered']);
    assert.equal(rows[1].taskId, 2);
    assert.equal(rows[1].observationExcerpt, 'Strates inclinees vers le nord');
    assert.equal(rows[1].hasPersonalPhoto, true);
    assert.equal(rows[2].hasPersonalPhoto, false);
}

function testProposalNumberingAndCoverage(): void {
    const snapshotTasks = [
        { id: 7, position: 1, question: 'A' },
        { id: 8, position: 2, question: 'B' },
        { id: 9, position: 3, question: 'C' },
    ];
    const current: LoggingTask[] = [
        { id: 'logging-task-12', geocacheId: '1', position: 5, question: 'Nouvelle', status: 'todo', requiresPhoto: false },
    ];
    assert.equal(resolveProposalPosition({ task_id: 8, question: 'B', status: 'ready' }, snapshotTasks, current), 2);
    // Repli sur les questions courantes quand l'instantane ne la connait pas.
    assert.equal(resolveProposalPosition({ task_id: 12, question: 'N', status: 'ready' }, snapshotTasks, current), 5);
    assert.equal(resolveProposalPosition({ question: 'libre', status: 'ready' }, snapshotTasks, current), undefined);
    const uncovered = findUncoveredSnapshotTasks([
        { task_id: 7, question: 'A', status: 'ready' },
        { task_id: 9, question: 'C', status: 'partial' },
    ], snapshotTasks);
    assert.deepEqual(uncovered.map(task => task.position), [2]);
    assert.deepEqual(findUncoveredSnapshotTasks([], undefined), []);
}

function testApplicableProposalIndexes(): void {
    assert.deepEqual(applicableProposalIndexes([
        { task_id: 1, question: 'ok', status: 'ready', answer: 'Calcaire' },
        { task_id: 2, question: 'partielle', status: 'partial', answer: 'x' },
        { task_id: 3, question: 'reste', status: 'ready', answer: 'x', missing: 'mesurer' },
        { question: 'sans tache', status: 'ready', answer: 'x' },
        { task_id: 5, question: 'vide', status: 'ready', answer: '  ' },
        { task_id: 6, question: 'ok2', status: 'ready', answer: 'Gres', missing: '  ' },
    ]), [0, 5]);
}

function testRevertToAiVersion(): void {
    const ai = { task_id: 1, question: 'Q', status: 'partial' as const, answer: 'IA', missing: 'mesurer' };
    const edited = { ...ai, status: 'ready' as const, answer: 'Corrigee', missing: null, confidence: 'high' as const };
    assert.equal(proposalDiffersFromAi(edited, ai), true);
    // Vide, null et absent sont equivalents : pas de faux « modifie ».
    assert.equal(proposalDiffersFromAi({ ...ai, question_translation: '' }, ai), false);
    assert.equal(proposalDiffersFromAi(edited, undefined), false);
    // Le patch efface aussi les champs ajoutes par l'utilisateur.
    const reverted = { ...edited, ...revertProposalPatch(ai) };
    assert.equal(proposalDiffersFromAi(reverted, ai), false);
    assert.equal(reverted.confidence, undefined);
}

function testContainedImageBox(): void {
    // Photo 4:3 dans un cadre 800x400 : bandes laterales de 133 px.
    const box = containedImageBox({ width: 800, height: 400 }, { width: 4000, height: 3000 });
    assert.ok(box);
    assert.equal(Math.round(box!.x), 133);
    assert.equal(box!.y, 0);
    assert.equal(Math.round(box!.width), 533);
    assert.equal(box!.height, 400);
    assert.equal(containedImageBox({ width: 0, height: 0 }, { width: 10, height: 10 }), undefined);
}

function testCropRectConversion(): void {
    // Apercu 400x300 d'une photo 4000x3000 : facteur 10.
    const rect = computeEarthCoachCropRect(
        { x: 100, y: 50, width: 80, height: 60 },
        { width: 400, height: 300 },
        { width: 4000, height: 3000 }
    );
    assert.deepEqual(rect, { x: 1000, y: 500, width: 800, height: 600 });
    // Selection tracee vers le haut-gauche et debordant de l'image : bornee.
    const reversed = computeEarthCoachCropRect(
        { x: 390, y: 290, width: -100, height: -100 },
        { width: 400, height: 300 },
        { width: 4000, height: 3000 }
    );
    assert.deepEqual(reversed, { x: 2900, y: 1900, width: 1000, height: 1000 });
    const clamped = computeEarthCoachCropRect(
        { x: 350, y: 250, width: 200, height: 200 },
        { width: 400, height: 300 },
        { width: 4000, height: 3000 }
    );
    assert.deepEqual(clamped, { x: 3500, y: 2500, width: 500, height: 500 });
    // Un simple clic ne cree pas de recadrage.
    assert.equal(computeEarthCoachCropRect({ x: 10, y: 10, width: 1, height: 1 }, { width: 400, height: 300 }, { width: 400, height: 300 }), undefined);
    assert.equal(computeEarthCoachCropRect({ x: 0, y: 0, width: 10, height: 10 }, { width: 0, height: 0 }, { width: 10, height: 10 }), undefined);
}

function testResultCaptureToolShape(): void {
    const tools = new EarthCoachResultTools().buildAllTools();
    assert.equal(tools.length, 2);
    assert.equal(tools[0].name, 'earthcoach_capture_result');
    assert.match(tools[0].description, /request_id/);
    assert.equal(tools[1].name, 'earthcoach_ask_user');
    assert.match(tools[1].description, /AVANT earthcoach_capture_result/);
}

async function testAskUserMarksAwaitingInput(): Promise<void> {
    // Le tour de precision marque la requete: l'observateur sait alors que
    // l'absence de capture en fin de reponse n'est pas un oubli.
    const service = new EarthCoachResultCaptureService();
    service.register({
        requestId: 'req-ask',
        geocacheId: 7,
        action: 'resolve',
        preparedAt: '',
        listing: { language: 'fr', fingerprint: 'x', reliableSeparation: true, html: '', text: '' },
        observations: [],
        loggingTasks: [],
        images: [],
        groups: [],
        unavailableImages: [],
    });
    assert.equal(service.isAwaitingInput('req-ask'), false);
    service.markAwaitingInput('req-ask', 7, ['Quelle epaisseur ?', 'Quelle couleur ?', '', '  ']);
    assert.equal(service.isAwaitingInput('req-ask'), true);
    assert.throws(() => service.markAwaitingInput('req-ask', 7, []), /Aucune question/);
    assert.throws(() => service.markAwaitingInput('req-ask', 8, ['Q?']), /ne correspond pas/);
    assert.throws(() => service.markAwaitingInput('req-inconnue', 7, ['Q?']), /introuvable/);
}

async function testResultCaptureAttachesMarkdownToItsOwnRequest(): Promise<void> {
    // Deux dossiers envoyes en parallele (caches A puis B) : la reponse de A ne
    // doit pas etre rattachee a B juste parce que B a ete prepare en dernier.
    const service = new EarthCoachResultCaptureService();
    const captured: Array<{ requestId: string; geocacheId: number }> = [];
    (service as unknown as { workspaceService: unknown }).workspaceService = {
        captureResult: async (input: { requestId: string; geocacheId: number }) => {
            captured.push(input);
            return { id: captured.length } as never;
        },
    };
    const request = (requestId: string, geocacheId: number) => ({
        requestId,
        geocacheId,
        action: 'resolve' as const,
        preparedAt: '',
        listing: { language: 'fr', fingerprint: 'x', reliableSeparation: true, html: '', text: '' },
        observations: [],
        loggingTasks: [],
        images: [],
        groups: [],
        unavailableImages: [],
    });
    service.register(request('req-A', 1));
    service.register(request('req-B', 2));

    await service.attachMarkdown('req-A', 'Réponse A', 'session-A');
    assert.equal(captured.length, 1);
    assert.equal(captured[0].requestId, 'req-A');
    assert.equal(captured[0].geocacheId, 1);

    await assert.rejects(() => service.attachMarkdown('req-inconnue', 'x'));
}

function testCaptureHasRequest(): void {
    // L'observateur ne rattache que les reponses dont le requestId a ete
    // enregistre par un dossier avant l'envoi: plus de filtrage par titre.
    const service = new EarthCoachResultCaptureService();
    service.register({ ...preparedRequestFixture('resolve'), requestId: 'req-77' });
    assert.equal(service.hasRequest('req-77'), true);
    assert.equal(service.hasRequest('req-autre'), false);
    assert.equal(service.hasRequest(undefined), false);
}

async function testCaptureMarksCapturedRequestIds(): Promise<void> {
    // wasCaptured distingue un dossier avec propositions (outil appele) d'un
    // dossier qui n'a recu que du Markdown: l'observateur s'en sert pour
    // prevenir l'utilisateur quand le modele reste muet sur la capture.
    const service = new EarthCoachResultCaptureService();
    (service as unknown as { workspaceService: unknown }).workspaceService = {
        captureResult: async () => ({ id: 1 } as never),
    };
    service.register({
        requestId: 'req-cap',
        geocacheId: 1,
        action: 'resolve',
        preparedAt: '',
        listing: { language: 'fr', fingerprint: 'x', reliableSeparation: true, html: '', text: '' },
        observations: [],
        loggingTasks: [],
        images: [],
        groups: [],
        unavailableImages: [],
    });

    assert.equal(service.wasCaptured('req-cap'), false);
    assert.equal(service.wasCaptured('req-inconnue'), false);
    assert.equal(service.wasCaptured(undefined), false);

    await service.capture({ request_id: 'req-cap', geocache_id: 1, action: 'resolve', proposals: [] });
    assert.equal(service.wasCaptured('req-cap'), true);
    assert.equal(service.wasCaptured('req-autre'), false);
}

async function testPreparedImagesDetectUndecodableBlob(): Promise<void> {
    const image: GeoImage = { id: '7', origin: 'user_observation', fileUri: 'https://example.test/heic.heic' };
    const result = await prepareEarthCoachImagesForTransmission(
        [image],
        async () => ({ ok: true, blob: async () => ({ type: 'image/heic' }) } as Response),
        async () => 'http://localhost:8000/stored.jpg',
        async () => { throw new Error('image illisible par le navigateur'); }
    );
    // Le repli backend retombe sur le meme decodeur: le blob stocke est lui
    // aussi indechiffrable -> echec explicite au lieu d'une fausse promesse.
    assert.equal(result.available.length, 0);
    assert.equal(result.failures.length, 1);
    assert.match(result.failures[0].reason, /illisible/);
}

async function testCaptureSnapshotCorrectedOnTransmissionFailure(): Promise<void> {
    // Le bridge peut encore perdre une image a l'envoi (canvas indisponible):
    // l'instantane persiste doit refleter ce que le modele a vraiment recu.
    const service = new EarthCoachResultCaptureService();
    let snapshot: EarthCoachPreparedRequest | undefined;
    (service as unknown as { workspaceService: unknown }).workspaceService = {
        captureResult: async (input: { contextSnapshot: EarthCoachPreparedRequest }) => {
            snapshot = input.contextSnapshot;
            return { id: 1 } as never;
        },
    };
    service.register({
        requestId: 'req-img',
        geocacheId: 1,
        action: 'resolve',
        preparedAt: '',
        listing: { language: 'fr', fingerprint: 'x', reliableSeparation: true, html: '', text: '' },
        observations: [],
        loggingTasks: [],
        images: [
            { id: '1', origin: 'user_observation', fileUri: '/a.jpg' },
            { id: '2', origin: 'user_observation', fileUri: '/b.jpg' },
        ],
        groups: [{
            title: 'Paire',
            position: 0,
            members: [
                { image_id: 1, role: 'original', position: 0 },
                { image_id: 2, role: 'detail', position: 1 },
            ],
        }],
        unavailableImages: [],
    });

    assert.equal(service.markImagesUntransmitted('req-img', ['2'], 'Échec de transmission au modèle.'), true);
    // id inconnu ou requete inconnue: aucune correction.
    assert.equal(service.markImagesUntransmitted('req-img', ['999'], 'x'), false);
    assert.equal(service.markImagesUntransmitted('req-autre', ['1'], 'x'), false);

    await service.attachMarkdown('req-img', 'Réponse', 's1');
    assert.ok(snapshot);
    assert.deepEqual(snapshot!.images.map(image => image.id), ['1']);
    assert.deepEqual(snapshot!.groups[0].members.map(member => member.image_id), [1]);
    assert.deepEqual(snapshot!.unavailableImages.map(item => item.id), ['2']);
    assert.match(snapshot!.unavailableImages[0].reason, /transmission/);
}

async function testFinalAnswerAttachesToSourceResult(): Promise<void> {
    // La generation de reponse finale est correlee au resultat source par
    // requestId : meme avec deux generations en parallele, chaque reponse
    // rejoint son propre resultat au lieu de la derniere requete connue.
    const service = new EarthCoachResultCaptureService();
    const saved: Array<{ resultId: number; finalAnswer: string }> = [];
    (service as unknown as { workspaceService: unknown }).workspaceService = {
        saveFinalAnswer: async (resultId: number, finalAnswer: string) => {
            saved.push({ resultId, finalAnswer });
            return { id: resultId, geocache_id: 1, final_answer: finalAnswer } as never;
        },
    };
    service.registerFinalRequest('final-1-100', 7, 1);
    service.registerFinalRequest('final-9-200', 9, 1);

    assert.equal(service.isFinalRequest('final-1-100'), true);
    assert.equal(service.isFinalRequest('req-autre'), false);
    assert.equal(service.isFinalRequest(undefined), false);

    await service.attachFinalAnswer('final-1-100', 'Réponse finale A');
    assert.equal(saved.length, 1);
    assert.equal(saved[0].resultId, 7);
    assert.equal(saved[0].finalAnswer, 'Réponse finale A');

    await assert.rejects(() => service.attachFinalAnswer('final-inconnu', 'x'));
    await assert.rejects(() => service.attachFinalAnswer('final-9-200', '   '));
    assert.equal(saved.length, 1);
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

function testDataUpdatedEventNames(): void {
    // Les noms d'evenements sont un contrat inter-widgets (et, pour les images,
    // avec l'extension zones): un renommage silencieux casserait la fraicheur.
    assert.equal(EARTHCOACH_LOGGING_TASKS_UPDATED_EVENT, 'earthcoach-logging-tasks-updated');
    assert.equal(EARTHCOACH_LOGGING_TASKS_REPLACED_EVENT, 'earthcoach-logging-tasks-replaced');
    assert.equal(EARTHCOACH_OBSERVATIONS_UPDATED_EVENT, 'earthcoach-observations-updated');
    assert.equal(GEOAPP_GEOCACHE_IMAGES_UPDATED_EVENT, 'geoapp-geocache-images-updated');
    // Emis par GeocacheNotesService (zones): le dossier se rafraichit quand
    // une note classique change, sans quoi le contexte IA resterait perime.
    assert.equal(GEOAPP_GEOCACHE_NOTES_UPDATED_EVENT, 'geoapp-geocache-notes-updated');
}

function testReadUpdatedGeocacheId(): void {
    assert.equal(readUpdatedGeocacheId({ geocacheId: 42 }), 42);
    assert.equal(readUpdatedGeocacheId({ geocacheId: '42' }), 42);
    assert.equal(readUpdatedGeocacheId({ geocacheId: 0 }), undefined);
    assert.equal(readUpdatedGeocacheId({ geocacheId: -3 }), undefined);
    assert.equal(readUpdatedGeocacheId({ geocacheId: 1.5 }), undefined);
    assert.equal(readUpdatedGeocacheId({}), undefined);
    assert.equal(readUpdatedGeocacheId(undefined), undefined);
    assert.equal(readUpdatedGeocacheId('42'), undefined);
}

function testIsUpdateForGeocache(): void {
    assert.equal(isUpdateForGeocache({ geocacheId: 7 }, 7), true);
    assert.equal(isUpdateForGeocache({ geocacheId: 7 }, 8), false);
    // Un evenement sans id ne doit pas declencher un rafraichissement aveugle.
    assert.equal(isUpdateForGeocache({}, 7), false);
    assert.equal(isUpdateForGeocache({ geocacheId: 7 }, undefined), false);
    // Un widget qui emet et ecoute le meme evenement ignore ses propres mutations.
    const options = { ignoreOrigin: 'earthcoach.loggingTasks' };
    assert.equal(isUpdateForGeocache({ geocacheId: 7, origin: 'earthcoach.loggingTasks' }, 7, options), false);
    assert.equal(isUpdateForGeocache({ geocacheId: 7, origin: 'earthcoach.observations' }, 7, options), true);
    assert.equal(isUpdateForGeocache({ geocacheId: 7 }, 7, options), true);
}

function testRefreshSchedulerDefersWhileHidden(): void {
    let visible = false;
    let refreshCount = 0;
    const scheduler = new EarthCoachRefreshScheduler(() => visible, () => { refreshCount += 1; });

    // Widget cache: on memorise la demande sans collecte reseau.
    scheduler.request();
    scheduler.request();
    assert.equal(refreshCount, 0);
    assert.equal(scheduler.hasPendingRefresh, true);

    // Retour a l'affichage: une seule collecte, puis plus rien a rejouer.
    visible = true;
    scheduler.flush();
    assert.equal(refreshCount, 1);
    assert.equal(scheduler.hasPendingRefresh, false);
    scheduler.flush();
    assert.equal(refreshCount, 1);

    // Widget visible: rafraichissement immediat, rien en attente.
    scheduler.request();
    assert.equal(refreshCount, 2);
    assert.equal(scheduler.hasPendingRefresh, false);
}

function buildAggregatedResponse(): any {
    return {
        geocache_id: 12,
        gc_code: 'GC_AGG',
        name: 'Falaise',
        gc_personal_note: 'Prevoir un marteau.',
        images: [
            { id: 5, url: '/api/geocache-images/5/file', source_url: 'https://img.test/5.jpg', title: 'Affleurement' },
            { id: 6, url: '/api/geocache-images/6/file', source_url: 'geoapp-upload://obs-6', title: 'Photo terrain' },
        ],
        observations: [
            {
                id: 3,
                geocache_id: 12,
                observation_type: 'hypothesis',
                content: 'Calcaire recifal.',
                observed_at: '2026-05-03T10:00:00+00:00',
                latitude: 45.5,
                longitude: 3.25,
                images: [{ id: 6, url: '/api/geocache-images/6/file', source_url: 'geoapp-upload://obs-6' }],
            },
            { id: 4, geocache_id: 12, content: '   ', images: [] },
        ],
        logging_tasks: [
            { id: 1, geocache_id: 12, position: 1, question: 'Quelle couleur ?', status: 'field', requires_photo: true },
            { id: 2, geocache_id: 12, position: 2, question: '   ' },
        ],
        notes: [
            { id: 9, content: 'Note de terrain.', source: 'user', created_at: '2026-05-02T08:00:00+00:00' },
            { id: 10, content: 'Synthese.', source: 'earthcoach', created_at: '2026-05-02T09:00:00+00:00' },
        ],
    };
}

function testParseAggregatedContextResponse(): void {
    const payload = parseEarthCoachContextResponse('http://localhost:5000', 12, buildAggregatedResponse());

    // Les URLs relatives sont prefixees par le backend, les absolues laissees telles quelles.
    assert.deepEqual(payload.images.map(image => image.fileUri), [
        'http://localhost:5000/api/geocache-images/5/file',
        'http://localhost:5000/api/geocache-images/6/file',
    ]);
    // L'origine se lit sur source_url: une image televersee est une photo utilisateur.
    assert.deepEqual(payload.images.map(image => image.origin), ['cache_listing', 'user_observation']);

    // Observations et questions vides sont ecartees, le statut est normalise.
    assert.deepEqual(payload.observations.map(observation => observation.id), ['observation-3']);
    assert.deepEqual(payload.observations[0].coordinates, { lat: 45.5, lon: 3.25 });
    assert.equal(payload.observations[0].observationType, 'hypothesis');
    assert.deepEqual(payload.loggingTasks.map(task => task.id), ['logging-task-1']);
    // Le backend sert des statuts deja normalises; tout autre valeur retombe sur 'todo'.
    assert.equal(payload.loggingTasks[0].status, 'field');
    assert.equal(payload.loggingTasks[0].requiresPhoto, true);

    assert.equal(payload.gcPersonalNote, 'Prevoir un marteau.');
    assert.equal(payload.notes.length, 2);

    // Une reponse vide ou absente ne casse rien: contexte vide, pas d'exception.
    const empty = parseEarthCoachContextResponse('http://localhost:5000', 12, undefined);
    assert.deepEqual(empty, {
        images: [],
        observations: [],
        loggingTasks: [],
        notes: [],
        gcPersonalNote: undefined,
        workspace: undefined,
        loadErrors: [],
    });
}

function testAssembleContextFallbacks(): void {
    const geocache: any = {
        id: 12,
        name: 'Falaise',
        gc_code: 'GC_AGG',
        images: [{ url: 'https://listing.test/legacy.jpg' }],
    };
    const payload = parseEarthCoachContextResponse('http://localhost:5000', 12, buildAggregatedResponse());
    const context = assembleEarthCoachContext(geocache, payload);

    // Le backend connait des images: pas de repli sur celles du listing brut,
    // et la photo attachee a l'observation n'est pas dupliquee.
    assert.deepEqual(context.images.map(image => image.id), ['5', '6']);
    // Observations structurees ET notes utilisateur: une mesure saisie en note
    // classique ne doit pas disparaitre du contexte des qu'une observation
    // structuree existe. La note EarthCoach (source != 'user') reste exclue.
    assert.deepEqual(context.observations.map(observation => observation.id), ['observation-3', 'note-9']);
    assert.equal(context.gcPersonalNote, 'Prevoir un marteau.');

    // Sans images ni observations backend: repli sur le listing et sur les notes
    // utilisateur (les notes EarthCoach ne sont pas des observations).
    const bare: EarthCoachContextPayload = {
        images: [],
        observations: [],
        loggingTasks: [],
        notes: payload.notes,
        gcPersonalNote: undefined,
    };
    const fallback = assembleEarthCoachContext(geocache, bare);
    assert.deepEqual(fallback.images.map(image => image.fileUri), ['https://listing.test/legacy.jpg']);
    assert.deepEqual(fallback.observations.map(observation => observation.id), ['note-9']);
    assert.equal(fallback.observations[0].source, 'note');

    // Dedoublonnage: une note recopiee a l'identique en observation structuree
    // n'est envoyee qu'une fois au modele.
    const duplicated: EarthCoachContextPayload = {
        images: [],
        observations: payload.observations,
        loggingTasks: [],
        notes: [{ id: 11, content: '  calcaire   recifal. ', source: 'user', created_at: '2026-05-03T11:00:00+00:00' } as never],
        gcPersonalNote: undefined,
    };
    assert.deepEqual(
        assembleEarthCoachContext(geocache, duplicated).observations.map(o => o.id),
        ['observation-3']
    );
}

function emptyPayload(marker: string): EarthCoachContextPayload {
    return { images: [], observations: [], loggingTasks: [], notes: [], gcPersonalNote: marker };
}

async function testContextCacheServesRepeatedActions(): Promise<void> {
    let now = 1_000;
    let loads = 0;
    const cache = new EarthCoachContextCache(45_000, () => now);
    const loader = async () => {
        loads += 1;
        return emptyPayload(`load-${loads}`);
    };

    // Actions enchainees sur la meme cache: un seul aller-retour.
    assert.equal((await cache.load(12, loader)).gcPersonalNote, 'load-1');
    assert.equal((await cache.load(12, loader)).gcPersonalNote, 'load-1');
    assert.equal(loads, 1);

    // Une autre geocache a sa propre entree.
    await cache.load(13, loader);
    assert.equal(loads, 2);

    // forceRefresh relit le reseau meme si l'entree est fraiche.
    assert.equal((await cache.load(12, loader, { forceRefresh: true })).gcPersonalNote, 'load-3');
    assert.equal(loads, 3);

    // Une mutation signalee peremptorise l'entree.
    cache.invalidate(12);
    await cache.load(12, loader);
    assert.equal(loads, 4);

    // Passe le TTL, l'entree expire d'elle-meme.
    now += 45_000;
    await cache.load(12, loader);
    assert.equal(loads, 5);

    // Deux ouvertures simultanees partagent la requete en vol.
    const cold = new EarthCoachContextCache(45_000, () => now);
    let concurrentLoads = 0;
    const slowLoader = () => {
        concurrentLoads += 1;
        return new Promise<EarthCoachContextPayload>(resolve => setTimeout(() => resolve(emptyPayload('slow')), 5));
    };
    const [first, second] = await Promise.all([cold.load(20, slowLoader), cold.load(20, slowLoader)]);
    assert.equal(concurrentLoads, 1);
    assert.equal(first, second);
}

async function testContextCacheDropsRequestsStartedBeforeAMutation(): Promise<void> {
    const cache = new EarthCoachContextCache(45_000, () => 0);
    let loads = 0;
    const loader = () => {
        loads += 1;
        const marker = `load-${loads}`;
        return new Promise<EarthCoachContextPayload>(resolve => setTimeout(() => resolve(emptyPayload(marker)), 5));
    };

    // Une lecture part, puis une mutation survient pendant qu'elle est en vol:
    // la rejoindre servirait l'etat d'avant la mutation.
    const stale = cache.load(12, loader);
    cache.invalidate(12);
    const fresh = cache.load(12, loader, { forceRefresh: true });
    assert.equal((await stale).gcPersonalNote, 'load-1');
    assert.equal((await fresh).gcPersonalNote, 'load-2');
    assert.equal(loads, 2);

    // Et c'est bien la lecture d'apres la mutation qui reste en cache.
    assert.equal((await cache.load(12, loader)).gcPersonalNote, 'load-2');
    assert.equal(loads, 2);
}

async function run(): Promise<void> {
    testSystemPromptModes();
    testSystemPromptResponseLanguage();
    testModeBadgeFollowsResponseLanguage();
    testSharedToolUtils();
    testReferenceToolShape();
    testNoteToolShape();
    testPromptIncludesImageOriginsAndObservations();
    testPromptHonorsCompactVerbosity();
    testDescriptionExcerptKeepsOwnerQuestions();
    testDescriptionExcerptSegmentsListingWithoutMarkup();
    testDescriptionExcerptKeepsShortListingIntact();
    testPromptRequiresExplicitLoggingTaskExtractionWhenMissing();
    testMultilingualDescriptionSelection();
    testMultilingualDescriptionHandlesNestedDivs();
    testMultilingualDescriptionFallsBackToFullContent();
    testExtractActionReadsFullListingInCompact();
    testPromptMarksTasksRequiringPhoto();
    testResolvePromptKeepsAllEvidenceRegardlessOfVerbosity();
    testStripEarthCoachResultBlocks();
    testFinalAnswerPromptUsesEditedProposalsWithoutJson();
    testFinalAnswerLanguageFollowsOwner();
    testPhotoInstructionsAreNotQuestions();
    testResolveFinalAnswerLanguage();
    testStripEarthCoachModeBadge();
    testDetectListingLanguage();
    testMonolingualListingIsLabelledByDetection();
    testStripChatTraceFromResultMarkdown();
    testNormalizeCapturedProposalMissing();
    testWorkspaceSelectionValidation();
    await testOwnerImageFallsBackToBackendStorage();
    testResultCaptureToolShape();
    await testAskUserMarksAwaitingInput();
    await testResultCaptureAttachesMarkdownToItsOwnRequest();
    testCaptureHasRequest();
    await testCaptureMarksCapturedRequestIds();
    await testPreparedImagesDetectUndecodableBlob();
    await testCaptureSnapshotCorrectedOnTransmissionFailure();
    await testFinalAnswerAttachesToSourceResult();
    testPromptSkipsExtractionHintWithoutQuestions();
    testPromptIncludesStructuredObservationMetadata();
    testObservationActionInstruction();
    testObservationInputBuilder();
    testObservationCoordinatesPrefill();
    testFieldChecklistBuilder();
    testFieldChecklistMarkdownExport();
    testFieldChecklistFileNameFallbacks();
    testImageGalleryGroupsByOrigin();
    testDataUpdatedEventNames();
    testReadUpdatedGeocacheId();
    testIsUpdateForGeocache();
    testRefreshSchedulerDefersWhileHidden();
    testParseAggregatedContextResponse();
    testAssembleContextFallbacks();
    await testContextCacheServesRepeatedActions();
    await testContextCacheDropsRequestsStartedBeforeAMutation();
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
    testLoggingTaskReplacementDiff();
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
    await testSetModeToolTargetsRequestSession();
    testQuickActionIconsAreConsistent();
    testImageContextMapping();
    testSelectImagesForChatPrioritizesUserObservations();
    testSelectImagesForChatHonorsPreferredIds();
    await testReferenceSearchUsesPreferencesAndCache();
    await testReferenceSearchHonorsAllowedSources();
    await testReferenceSearchAddsAdvancedGeologySources();
    await testSaveEarthCoachNote();
    testSelectionValidationPointsAtFix();
    testCoverageMatrix();
    testProposalNumberingAndCoverage();
    testApplicableProposalIndexes();
    testCropRectConversion();
    testContainedImageBox();
    testRevertToAiVersion();
    testCapturedResolutionIsNotDuplicatedInChat();
    testSiteContextBlockIsInjected();
    testRefineRequestPrompt();
    testPreparedRequestWithoutImagesSaysSo();
    await testPreparedImagesAreEncodedOnce();
    // eslint-disable-next-line no-console
    console.log('earthcoach-prompt-builder tests passed');
}

void run();
