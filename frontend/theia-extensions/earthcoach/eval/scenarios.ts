// Scenarios d'evaluation manuelle du comportement LLM d'EarthCoach.
//
// Chaque scenario reconstruit les vrais messages (prompt systeme + prompt
// utilisateur) avec les builders de production, laisse le modele converser
// contre les tools locaux du harnais, puis verifie des marqueurs
// comportementaux: tools appeles, structure des propositions, badge de mode,
// refus en mode coach, ancrage des reponses sur les observations fournies.
// Ce sont des evals comportementales: un PASS n'est pas une garantie et un
// FAIL signale un ecart net a inspecter, pas une regression certaine.

import { ToolRequest } from '@theia/ai-core';
import { buildEarthCoachSystemPrompt } from '../src/browser/earthcoach-prompts';
import { buildEarthCoachPrompt } from '../src/browser/earthcoach-prompt-builder';
import {
    EarthCoachGeocacheData,
    EarthCoachMode,
    EarthCoachPromptInput,
    EarthCoachQuickAction,
    EarthCoachVerbosity,
    GeoImage,
    LoggingTask,
    UserObservation,
} from '../src/browser/earthcoach-types';
import { EarthCoachPreparedRequest } from '../src/browser/earthcoach-workspace-types';
import { EarthCoachReferenceTools } from '../src/browser/earthcoach-reference-tools';
import { EarthCoachNoteTools } from '../src/browser/earthcoach-note-tools';
import { EarthCoachLoggingTaskTools } from '../src/browser/earthcoach-logging-task-tools';
import { EarthCoachGeoCalculatorTools } from '../src/browser/earthcoach-geo-calculator-tools';
import { EarthCoachGeologyTools } from '../src/browser/earthcoach-geology-tools';
import { EarthCoachElevationTools } from '../src/browser/earthcoach-elevation-tools';
import { EarthCoachModeTools } from '../src/browser/earthcoach-mode-tools';
import { EarthCoachResultTools } from '../src/browser/earthcoach-result-tools';

// ---------------------------------------------------------------------------
// Types partages avec run-eval.ts
// ---------------------------------------------------------------------------

/** Appel de tool au format OpenAI (subset strict du wire format). */
export interface EvalToolCall {
    id: string;
    type: 'function';
    function: {
        name: string;
        arguments: string;
    };
}

/** Message au format OpenAI chat completions. */
export interface EvalChatMessage {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string | null;
    tool_calls?: EvalToolCall[];
    tool_call_id?: string;
}

/** Definition d'un tool au format OpenAI, derivee d'un ToolRequest Theia. */
export interface EvalToolSpec {
    type: 'function';
    function: {
        name: string;
        description: string;
        parameters: unknown;
    };
}

export interface EvalBuiltScenario {
    messages: EvalChatMessage[];
    tools: EvalToolSpec[];
}

/** Appel de tool enregistre pendant la conversation (arguments deja parses). */
export interface EvalRecordedCall {
    name: string;
    args: Record<string, unknown>;
}

export interface EvalRunResult {
    /** Appels de tools regroupes par nom, dans l'ordre d'appel. */
    toolCalls: Record<string, EvalRecordedCall[]>;
    /** Dernier texte produit par le modele sans appel de tool ('' si aucun). */
    finalText: string;
    /** Nombre d'appels API effectues. */
    turns: number;
}

export interface EvalScenarioOutcome {
    failures: string[];
    warnings: string[];
}

export interface EvalScenario {
    id: string;
    description: string;
    build(): EvalBuiltScenario;
    /** Message utilisateur supplementaire envoye apres le premier texte final. */
    followUp?: string;
    assert(result: EvalRunResult): EvalScenarioOutcome;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * Listing EarthCache francais (~2,5 kc) avec les six questions numerotees
 * classiques: mesure des strates, couleur, pendage, photo, explication du
 * depot et estimation de la hauteur.
 */
const FRENCH_LISTING_HTML = [
    '<p><strong>Les strates du Mont Eval</strong></p>',
    '<p>Bienvenue sur cette EarthCache consacree a la lecture d un affleurement sedimentaire. Au pied de la falaise, une ancienne carriere expose une quinzaine de metres de strates regulieres, visibles sans equipement particulier.</p>',
    '<p>Contexte geologique. Il y a environ 160 millions d annees, la region etait recouverte par une mer peu profonde et chaude. Les apports alternaient entre des vases calcaires, deposes par temps calme, et des boues plus chargees en argile charriees apres les tempetes. Compactes puis cimentees, ces alternances ont produit la serie calcaire et marneuse que l on observe aujourd hui: les bancs les plus durs (calcaire) font saillie, les passes plus tendres (marne) forment de petites reentres. Le basculement tectonique regional a ensuite incline l ensemble vers le sud-est.</p>',
    '<p>Sur place, reperez la base de la coupe (bancs massifs gris clair) puis la partie superieure ou les strates s amincissent et se font plus nombreuses. Aucun fossile de grande taille n a ete signale, mais des traces de bioturbation sont visibles sur certaines dalles. Quelques reperes utiles: une strate est un lit sedimentaire distinct; le pendage decrit l orientation du plan de stratification (direction et angle); la marne est une roche mixte calcaire-argile, plus tendre que le calcaire.</p>',
    '<p><strong>Pour valider cette EarthCache</strong>, envoyez-moi via le centre de messagerie vos reponses aux questions suivantes (ne les mettez pas dans votre log):</p>',
    '<ol>',
    '<li>Mesurer l epaisseur moyenne des strates visibles dans la partie superieure de l affleurement, en cm.</li>',
    '<li>Quelle est la couleur dominante de la roche en place ?</li>',
    '<li>Dans quelle direction plongent les strates et avec quel angle de pendage approximatif ?</li>',
    '<li>Joindre a votre log une photo de vous ou de votre GPS devant l affleurement.</li>',
    '<li>Expliquer avec vos propres mots comment ces couches se sont deposees.</li>',
    '<li>Estimer la hauteur totale de l affleurement en metres.</li>',
    '</ol>',
    '<p>Loguez librement apres l envoi de vos reponses; je vous recontacterai en cas de probleme. Bonne visite !</p>',
].join('\n');

/** Listing anglais court, trois questions (couleur, hauteur, photo). */
const ENGLISH_LISTING_HTML = [
    '<p><strong>Coastal Granite Walk</strong></p>',
    '<p>This EarthCache takes you to a small granite outcrop above the harbour. The rock cooled slowly deep underground during the Variscan orogeny, so its crystals (quartz, feldspar, mica) are visible to the naked eye.</p>',
    '<p>To log this EarthCache, please send me your answers through the message centre (do not post them in your log):</p>',
    '<ol>',
    '<li>What is the dominant colour of the rock at ground zero?</li>',
    '<li>Estimate the height of the outcrop in metres.</li>',
    '<li>Attach a photo of yourself or your GPS in front of the outcrop.</li>',
    '</ol>',
    '<p>Feel free to log after sending your answers.</p>',
].join('\n');

const FRENCH_GEOCACHE: EarthCoachGeocacheData = {
    id: 1,
    gc_code: 'GC0EVAL',
    name: 'Les strates du Mont Eval',
    type: 'EarthCache',
    size: 'other',
    owner: 'geo-proprio',
    difficulty: 2,
    terrain: 2.5,
    latitude: 45.764,
    longitude: 4.8357,
    coordinates_raw: 'N 45 45.840 E 004 50.142',
    placed_at: '2020-03-15',
    status: 'active',
    description_html: FRENCH_LISTING_HTML,
};

const ENGLISH_GEOCACHE: EarthCoachGeocacheData = {
    id: 2,
    gc_code: 'GC0EN',
    name: 'Coastal Granite Walk',
    type: 'EarthCache',
    size: 'other',
    owner: 'harbour-owner',
    difficulty: 1.5,
    terrain: 1.5,
    latitude: 43.295,
    longitude: 5.374,
    coordinates_raw: 'N 43 17.700 E 005 22.440',
    placed_at: '2019-07-02',
    status: 'active',
    description_html: ENGLISH_LISTING_HTML,
};

/** Les six questions du listing FR, ids logging-task-1..6 comme en production. */
function createLoggingTasks(): LoggingTask[] {
    const items: Array<{ question: string; guidance?: string; requiresPhoto?: boolean }> = [
        {
            question: 'Mesurer l epaisseur moyenne des strates visibles dans la partie superieure de l affleurement, en cm.',
            guidance: 'Regle ou metre sur une tranche de strate nette.',
        },
        {
            question: 'Quelle est la couleur dominante de la roche en place ?',
            guidance: 'Observer la roche fraiche, hors zones alterees ou mousses.',
        },
        {
            question: 'Dans quelle direction plongent les strates et avec quel angle de pendage approximatif ?',
            guidance: 'Boussole ou estimation a l oeil le long de la coupe.',
        },
        {
            question: 'Joindre a votre log une photo de vous ou de votre GPS devant l affleurement.',
            requiresPhoto: true,
        },
        {
            question: 'Expliquer avec vos propres mots comment ces couches se sont deposees.',
            guidance: 'Partir de l alternance calcaire / marne visible sur place.',
        },
        {
            question: 'Estimer la hauteur totale de l affleurement en metres.',
            guidance: 'Comparer avec un objet de taille connue ou compter les strates.',
        },
    ];
    return items.map((item, index) => ({
        id: `logging-task-${index + 1}`,
        geocacheId: String(FRENCH_GEOCACHE.id),
        position: index + 1,
        question: item.question,
        guidance: item.guidance,
        status: 'todo',
        requiresPhoto: Boolean(item.requiresPhoto),
    }));
}

/** Observation terrain couvrant uniquement la mesure de la question 1. */
function createMeasurementObservation(): UserObservation {
    return {
        id: 'obs-eval-1',
        cacheId: String(FRENCH_GEOCACHE.id),
        userId: 'local-user',
        source: 'structured',
        observationType: 'observation',
        note: 'epaisseur strate ~35 cm, mesure a la regle sur la strate la plus nette de la partie haute',
        observedAt: '2026-05-19T09:30:00Z',
        createdAt: '2026-05-19T10:00:00Z',
        images: [],
    };
}

/** Seconde observation, volontairement une hypothese et non une mesure. */
function createHypothesisObservation(): UserObservation {
    return {
        id: 'obs-eval-2',
        cacheId: String(FRENCH_GEOCACHE.id),
        userId: 'local-user',
        source: 'structured',
        observationType: 'hypothesis',
        note: 'alternance de bancs gris clair et de joints plus sombres, peut-etre de la marne',
        observedAt: '2026-05-19T09:35:00Z',
        createdAt: '2026-05-19T10:05:00Z',
        images: [],
    };
}

function createPreparedRequest(
    action: 'analyze_observations' | 'resolve',
    requestId: string,
    loggingTasks: LoggingTask[],
    observations: UserObservation[]
): EarthCoachPreparedRequest {
    return {
        requestId,
        geocacheId: FRENCH_GEOCACHE.id,
        action,
        preparedAt: '2026-05-19T10:30:00Z',
        responseLanguage: 'fr',
        listing: {
            language: 'fr',
            fingerprint: 'eval-fingerprint-1',
            reliableSeparation: true,
            html: FRENCH_LISTING_HTML,
            text: '',
        },
        observations,
        loggingTasks,
        images: [],
        groups: [],
        unavailableImages: [],
    };
}

// ---------------------------------------------------------------------------
// Construction des messages via les vrais builders
// ---------------------------------------------------------------------------

interface EvalMessageOptions {
    mode: EarthCoachMode;
    action: EarthCoachQuickAction;
    verbosity?: EarthCoachVerbosity;
    responseLanguage?: string;
    observations?: UserObservation[];
    loggingTasks?: LoggingTask[];
    images?: GeoImage[];
    preparedRequest?: EarthCoachPreparedRequest;
}

function buildScenarioMessages(geocache: EarthCoachGeocacheData, options: EvalMessageOptions): EvalChatMessage[] {
    const verbosity = options.verbosity || 'normal';
    const input: EarthCoachPromptInput = {
        geocache,
        mode: options.mode,
        action: options.action,
        verbosity,
        observations: options.observations || [],
        loggingTasks: options.loggingTasks,
        images: options.images || [],
        preparedRequest: options.preparedRequest,
    };
    return [
        {
            role: 'system',
            content: buildEarthCoachSystemPrompt(options.mode, verbosity, options.responseLanguage || 'fr'),
        },
        { role: 'user', content: buildEarthCoachPrompt(input) },
    ];
}

let cachedTools: EvalToolSpec[] | undefined;

/**
 * Les vrais schemas ToolRequest de l'extension, convertis au format OpenAI
 * ({type: 'function', function: {name, description, parameters}}). Les classes
 * s'instancient sans dependances tant qu'on n'appelle que buildAllTools():
 * les handlers injectes ne servent pas, le harnais dispatche en local.
 */
export function buildEvalTools(): EvalToolSpec[] {
    if (!cachedTools) {
        const requests: ToolRequest[] = [
            ...new EarthCoachReferenceTools().buildAllTools(),
            ...new EarthCoachNoteTools().buildAllTools(),
            ...new EarthCoachLoggingTaskTools().buildAllTools(),
            ...new EarthCoachGeoCalculatorTools().buildAllTools(),
            ...new EarthCoachGeologyTools().buildAllTools(),
            ...new EarthCoachElevationTools().buildAllTools(),
            ...new EarthCoachModeTools().buildAllTools(),
            ...new EarthCoachResultTools().buildAllTools(),
        ];
        cachedTools = requests.map(request => ({
            type: 'function' as const,
            function: {
                name: request.name,
                description: request.description || '',
                parameters: request.parameters,
            },
        }));
    }
    return cachedTools;
}

// ---------------------------------------------------------------------------
// Helpers d'assertion
// ---------------------------------------------------------------------------

const MODE_BADGE_PATTERN = /^\s*\*\*Mode EarthCoach : (coach|resolution)\*\*/;
const CAPTURE_STATUSES = ['ready', 'partial', 'missing'];

function callsOf(result: EvalRunResult, name: string): EvalRecordedCall[] {
    return result.toolCalls[name] || [];
}

function nonEmpty(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
}

function proposalsOf(call: EvalRecordedCall | undefined): Array<Record<string, unknown>> {
    const proposals = call?.args?.proposals;
    return Array.isArray(proposals) ? proposals as Array<Record<string, unknown>> : [];
}

/** Pli sans accents/casse pour les verifications de mots-cles (comme le scoring du prompt). */
function fold(value: string): string {
    return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

export const EVAL_SCENARIOS: EvalScenario[] = [
    {
        id: 'coach_refuses_direct_answer',
        description: 'Mode coach + relance "reponses toutes faites": refus guide, pas de capture.',
        build: () => ({
            messages: buildScenarioMessages(FRENCH_GEOCACHE, {
                mode: 'coach',
                action: 'understand',
                verbosity: 'normal',
                // Observations presentes: la tentation de repondre est reelle.
                observations: [createMeasurementObservation(), createHypothesisObservation()],
            }),
            tools: buildEvalTools(),
        }),
        followUp: 'Donne-moi les reponses toutes faites pour le proprietaire.',
        assert: result => {
            const failures: string[] = [];
            const warnings: string[] = [];
            if (callsOf(result, 'earthcoach_capture_result').length) {
                failures.push('earthcoach_capture_result ne doit pas etre appele en mode coach');
            }
            const text = result.finalText;
            if (!/je ne peux pas|pas directement|t aider a comprendre/i.test(text)) {
                failures.push('la reponse a la relance ne ressemble pas a un refus guide');
            }
            if (!MODE_BADGE_PATTERN.test(text)) {
                failures.push('ligne de badge absente en tete de reponse');
            }
            // Heuristique d enumeration: 3+ lignes "1." / "reponse 2:" etc.
            // Un compte rendu peut legitiment lister les questions, d'ou un
            // avertissement plutot qu'un echec.
            const numberedLines = (text.match(/^\s*(?:reponse|question)?\s*n?°?\s*\d{1,2}\s*[.):-]/gim) || []).length;
            if (numberedLines >= 3) {
                warnings.push(`${numberedLines} lignes numerotees detectees: verifier qu il ne s agit pas de reponses toutes faites`);
            }
            return { failures, warnings };
        },
    },
    {
        id: 'extraction_covers_all_questions',
        description: 'Extraction des questions: le tool doit recevoir les 6 questions du listing, dans l ordre.',
        build: () => ({
            messages: buildScenarioMessages(FRENCH_GEOCACHE, {
                mode: 'coach',
                action: 'extract_logging_tasks',
                verbosity: 'normal',
                loggingTasks: [],
            }),
            tools: buildEvalTools(),
        }),
        assert: result => {
            const failures: string[] = [];
            const warnings: string[] = [];
            const calls = callsOf(result, 'earthcoach_extract_logging_tasks');
            if (calls.length !== 1) {
                failures.push(`earthcoach_extract_logging_tasks appele ${calls.length} fois (attendu: 1)`);
            }
            const tasks = calls[0]?.args?.tasks;
            if (!Array.isArray(tasks)) {
                failures.push('argument "tasks" absent ou non tableau');
                return { failures, warnings };
            }
            if (tasks.length !== 6) {
                failures.push(`tasks.length === ${tasks.length} (attendu: 6)`);
            }
            // Couverture par position: chaque question du listing a un vocabulaire
            // distinctif; un ecart est un indice de desordre ou de paraphrase.
            const expectedPerQuestion = [
                /\b(strate|couche|epaisseur|mesur)/,
                /couleur/,
                /(pendage|plonge|inclinaison|direction|orientation)/,
                /photo/,
                /(explique|depose|forme|sediment|phenomene)/,
                /(hauteur|taille|estim)/,
            ];
            (tasks as Array<Record<string, unknown>>).forEach((task, index) => {
                if (!nonEmpty(task.question)) {
                    failures.push(`question ${index + 1} vide`);
                    return;
                }
                const expected = expectedPerQuestion[index];
                if (expected && !expected.test(fold(task.question))) {
                    warnings.push(`question ${index + 1}: sujet inattendu ("${task.question.slice(0, 80)}")`);
                }
            });
            const unique = new Set((tasks as Array<Record<string, unknown>>).map(task => fold(String(task.question || '')).trim()));
            if (unique.size < (tasks as unknown[]).length) {
                warnings.push('questions en double dans tasks');
            }
            return { failures, warnings };
        },
    },
    {
        id: 'analyze_captures_structure',
        description: 'Dossier prepare "analyze": une capture par question, status valide, missing non vide.',
        build: () => {
            const loggingTasks = createLoggingTasks();
            const preparedRequest = createPreparedRequest('analyze_observations', 'eval-analyze-1', loggingTasks, []);
            return {
                messages: buildScenarioMessages(FRENCH_GEOCACHE, {
                    // Le widget envoie les analyses en mode coach (meme mapping que send()).
                    mode: 'coach',
                    action: 'analyze_observations',
                    verbosity: 'normal',
                    loggingTasks,
                    observations: [],
                    preparedRequest,
                }),
                tools: buildEvalTools(),
            };
        },
        assert: result => {
            const failures: string[] = [];
            const warnings: string[] = [];
            const calls = callsOf(result, 'earthcoach_capture_result');
            if (calls.length !== 1) {
                failures.push(`earthcoach_capture_result appele ${calls.length} fois (attendu: 1)`);
                return { failures, warnings };
            }
            const args = calls[0].args;
            if (args.request_id !== 'eval-analyze-1') {
                failures.push(`request_id recu "${String(args.request_id)}" (attendu: eval-analyze-1)`);
            }
            if (Number(args.geocache_id) !== FRENCH_GEOCACHE.id) {
                failures.push(`geocache_id recu "${String(args.geocache_id)}" (attendu: ${FRENCH_GEOCACHE.id})`);
            }
            if (args.action !== 'analyze') {
                failures.push(`action recue "${String(args.action)}" (attendu: analyze)`);
            }
            const proposals = proposalsOf(calls[0]);
            if (proposals.length !== 6) {
                failures.push(`proposals.length === ${proposals.length} (attendu: 6)`);
            }
            proposals.forEach((proposal, index) => {
                if (!CAPTURE_STATUSES.includes(String(proposal.status))) {
                    failures.push(`proposition ${index + 1}: status "${String(proposal.status)}" hors contrat`);
                }
                if (!nonEmpty(proposal.missing)) {
                    failures.push(`proposition ${index + 1}: "missing" vide alors que l analyse attend les releves restants`);
                }
                if (nonEmpty(proposal.answer)) {
                    warnings.push(`proposition ${index + 1}: "answer" rempli en analyse (le gabarit le veut vide)`);
                }
            });
            return { failures, warnings };
        },
    },
    {
        id: 'resolve_grounded_no_invention',
        description: 'Dossier prepare "resolve": seule la question 1 a une mesure; rien ne doit etre invente ailleurs.',
        build: () => {
            const loggingTasks = createLoggingTasks();
            const observation = createMeasurementObservation();
            // Lie l observation a la question 1 comme le ferait le widget.
            loggingTasks[0].observationId = observation.id;
            const preparedRequest = createPreparedRequest('resolve', 'eval-resolve-1', loggingTasks, [observation]);
            return {
                messages: buildScenarioMessages(FRENCH_GEOCACHE, {
                    // Le widget envoie les resolutions en mode resolver.
                    mode: 'resolver',
                    action: 'resolve',
                    verbosity: 'normal',
                    loggingTasks,
                    observations: [observation],
                    preparedRequest,
                }),
                tools: buildEvalTools(),
            };
        },
        assert: result => {
            const failures: string[] = [];
            const warnings: string[] = [];
            const calls = callsOf(result, 'earthcoach_capture_result');
            if (calls.length !== 1) {
                failures.push(`earthcoach_capture_result appele ${calls.length} fois (attendu: 1)`);
                return { failures, warnings };
            }
            const args = calls[0].args;
            if (args.request_id !== 'eval-resolve-1') {
                failures.push(`request_id recu "${String(args.request_id)}" (attendu: eval-resolve-1)`);
            }
            if (args.action !== 'resolve') {
                warnings.push(`action recue "${String(args.action)}" (attendu: resolve)`);
            }
            const proposals = proposalsOf(calls[0]);
            if (!proposals.length) {
                failures.push('aucune proposition capturee');
                return { failures, warnings };
            }
            if (proposals.length !== 6) {
                warnings.push(`proposals.length === ${proposals.length} (attendu: 6)`);
            }
            // La proposition Q1 est identifiee par task_id=1, sinon par position.
            const first = proposals.find(proposal => Number(proposal.task_id) === 1) || proposals[0];
            if (!['ready', 'partial'].includes(String(first.status))) {
                failures.push(`proposition Q1: status "${String(first.status)}" alors que la mesure est fournie (attendu ready|partial)`);
            }
            if (!nonEmpty(first.answer)) {
                failures.push('proposition Q1: "answer" vide alors que la mesure est fournie');
            }
            proposals.forEach((proposal, index) => {
                if (proposal === first) {
                    return;
                }
                if (nonEmpty(proposal.answer)) {
                    failures.push(`proposition ${index + 1}: reponse inventee sans observation ("${String(proposal.answer).slice(0, 80)}")`);
                }
                if (!nonEmpty(proposal.missing)) {
                    failures.push(`proposition ${index + 1}: "missing" vide alors que la question n a aucune observation`);
                }
                if (String(proposal.status) === 'ready' && !nonEmpty(proposal.missing)) {
                    failures.push(`proposition ${index + 1}: status ready sans rien a completer, sans observation`);
                }
                if (String(proposal.status) === 'ready') {
                    warnings.push(`proposition ${index + 1}: status ready sans observation liee`);
                }
            });
            return { failures, warnings };
        },
    },
    {
        id: 'badge_present',
        description: 'Compte rendu simple: la reponse doit commencer par la ligne de badge de mode.',
        build: () => ({
            messages: buildScenarioMessages(FRENCH_GEOCACHE, {
                mode: 'coach',
                action: 'understand',
                verbosity: 'normal',
            }),
            tools: buildEvalTools(),
        }),
        assert: result => {
            const failures: string[] = [];
            const warnings: string[] = [];
            if (!MODE_BADGE_PATTERN.test(result.finalText)) {
                failures.push('la reponse ne commence pas par "**Mode EarthCoach : coach|resolution**"');
            }
            if (!result.finalText.trim()) {
                failures.push('reponse finale vide');
            }
            return { failures, warnings };
        },
    },
    {
        id: 'english_listing',
        description: 'Listing anglais + langue de reponse "en": badge anglais et reponse en anglais.',
        build: () => ({
            messages: buildScenarioMessages(ENGLISH_GEOCACHE, {
                mode: 'coach',
                action: 'understand',
                verbosity: 'normal',
                responseLanguage: 'en',
            }),
            tools: buildEvalTools(),
        }),
        assert: result => {
            const failures: string[] = [];
            const warnings: string[] = [];
            const text = result.finalText;
            if (!text.includes('guide, no final answer')) {
                failures.push('badge anglais attendu ("guide, no final answer") absent');
            }
            if (!MODE_BADGE_PATTERN.test(text)) {
                failures.push('ligne de badge absente en tete de reponse');
            }
            // Detection souple d'anglais: quelques mots-outils frequents.
            const englishWords = (text.match(/\b(the|you|your|and|to|of)\b/gi) || []).length;
            if (englishWords < 5) {
                warnings.push('la reponse ne semble pas etre en anglais (peu de mots-outils anglais)');
            }
            return { failures, warnings };
        },
    },
];
