/* eslint-disable no-console */
// Harnais d'evaluation manuelle du comportement LLM d'EarthCoach.
//
// Joue les scenarios de ./scenarios.ts contre un endpoint OpenAI-compatible
// (Ollama par defaut) en boucle outils -> reponse, sans aucun acces reseau
// pour les tools eux-memes: earthcoach_calculate execute le vrai calcul
// deterministe, les autres renvoient des fixtures realistes et les appels
// sont enregistres pour les assertions.
//
// Usage:
//   EARTHCOACH_EVAL_MODEL=llama3.1 npm run test:earthcoach:eval
// Voir eval/README.md pour les variables d'environnement.

import {
    EVAL_SCENARIOS,
    EvalChatMessage,
    EvalRecordedCall,
    EvalRunResult,
    EvalScenario,
    EvalToolCall,
    EvalToolSpec,
} from './scenarios';
import { runEarthCoachCalculation } from '../src/browser/earthcoach-geo-calculator';
import { err, ok } from '../src/browser/earthcoach-tool-utils';

// ---------------------------------------------------------------------------
// Configuration (variables d'environnement)
// ---------------------------------------------------------------------------

const BASE_URL = (process.env.EARTHCOACH_EVAL_BASE_URL || 'http://localhost:11434/v1').replace(/\/+$/, '');
const API_KEY = process.env.EARTHCOACH_EVAL_API_KEY || '';
const MODEL = process.env.EARTHCOACH_EVAL_MODEL || '';
const SCENARIOS_FILTER = (process.env.EARTHCOACH_EVAL_SCENARIOS || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
const MAX_TURNS = Math.max(1, Number(process.env.EARTHCOACH_EVAL_MAX_TURNS || '6') || 6);
const REQUEST_TIMEOUT_MS = 120_000;

class EvalApiError extends Error { }

/** Leve quand l'endpoint repond 400 en se plaignant des tools. */
class ToolsNotSupportedError extends Error { }

// ---------------------------------------------------------------------------
// Client OpenAI-compatible
// ---------------------------------------------------------------------------

interface ChatResponseMessage {
    content: string | null;
    tool_calls?: EvalToolCall[];
}

async function callChatCompletions(messages: EvalChatMessage[], tools: EvalToolSpec[]): Promise<ChatResponseMessage> {
    const body: Record<string, unknown> = {
        model: MODEL,
        messages,
        tool_choice: 'auto',
        temperature: 0.2,
    };
    if (tools.length) {
        body.tools = tools;
    }
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    // Pas d'Authorization quand aucune cle n'est fournie (Ollama n'en veut pas).
    if (API_KEY) {
        headers.Authorization = `Bearer ${API_KEY}`;
    }
    let response: Response;
    try {
        response = await fetch(`${BASE_URL}/chat/completions`, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
    } catch (error) {
        const name = error instanceof Error ? error.name : '';
        if (name === 'TimeoutError' || name === 'AbortError') {
            throw new EvalApiError(`delai de ${REQUEST_TIMEOUT_MS / 1000} s depasse sur ${BASE_URL}/chat/completions`);
        }
        throw new EvalApiError(`endpoint injoignable (${BASE_URL}): ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!response.ok) {
        const text = (await response.text().catch(() => '')).slice(0, 400);
        if (response.status === 400 && /tool/i.test(text)) {
            throw new ToolsNotSupportedError(text || `HTTP ${response.status}`);
        }
        throw new EvalApiError(`HTTP ${response.status}: ${text || '(corps vide)'}`);
    }
    const data = await response.json() as { choices?: Array<{ message?: ChatResponseMessage }> };
    const message = data?.choices?.[0]?.message;
    if (!message || typeof message !== 'object') {
        throw new EvalApiError('reponse sans choices[0].message');
    }
    return {
        content: typeof message.content === 'string' ? message.content : null,
        tool_calls: Array.isArray(message.tool_calls) ? message.tool_calls : undefined,
    };
}

// ---------------------------------------------------------------------------
// Dispatch local des tools (pas de reseau; les appels sont enregistres)
// ---------------------------------------------------------------------------

function parseToolArguments(call: EvalToolCall): Record<string, unknown> {
    const raw = call.function?.arguments;
    const text = typeof raw === 'string' ? raw : JSON.stringify(raw || {});
    try {
        const parsed = JSON.parse(text || '{}') as unknown;
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? parsed as Record<string, unknown>
            : {};
    } catch {
        return {};
    }
}

/** Resultats statiques realistes pour les tools qui feraient du reseau ou de la persistance. */
function staticToolResult(name: string, args: Record<string, unknown>): string {
    switch (name) {
        case 'earthcoach_search_reference':
            return ok({
                language: 'fr',
                origin: 'educational_reference',
                articles: [
                    { title: 'Calcaire', url: 'https://fr.wikipedia.org/wiki/Calcaire', snippet: 'Roche sedimentaire (fixture eval).' },
                ],
                images: [],
                allowed_sources: ['wikipedia', 'wikimedia_commons'],
                usage_rule: 'references pedagogiques generiques, jamais des observations de terrain.',
            });
        case 'earthcoach_geology_at_point':
            return ok({
                found: true,
                source: 'macrostrat',
                lithology: 'limestone and marl',
                age: 'Middle Jurassic',
                formation: 'Eval limestones',
                summary: 'Calcaire et marne du Jurassique moyen (fixture eval, carte generale).',
            });
        case 'earthcoach_geology_france':
            return ok({
                found: true,
                source: 'brgm',
                lithology: 'calcaire',
                age: 'jurassique',
                sheet: '0000 - Eval',
                notice_url: 'https://infoterre.brgm.fr/notice/eval',
                summary: 'Alternance de calcaires et de marnes (fixture eval, carte generale).',
            });
        case 'earthcoach_elevation_at_point':
            return ok({
                points: [
                    { lat: Number(args.lat) || 45.764, lon: Number(args.lon) || 4.8357, elevation: 312, source: 'IGN RGE ALTI' },
                ],
                precision: 'metrique (fixture eval)',
            });
        case 'earthcoach_save_note':
            return ok({
                geocache_id: Number(args.geocache_id) || 0,
                source: 'earthcoach',
                note_type: 'system',
                saved: true,
            });
        case 'earthcoach_set_mode':
            return ok({
                mode: String(args.mode || 'coach'),
                applies: 'next_message',
            });
        default:
            return err(`outil inconnu cote eval: ${name}`);
    }
}

function dispatchToolCall(call: EvalToolCall, recorded: EvalRecordedCall[]): string {
    const name = call.function?.name || '';
    const args = parseToolArguments(call);
    recorded.push({ name, args });
    if (name === 'earthcoach_capture_result') {
        // Reponse alignee sur le vrai handler d'earthcoach-result-tools.
        return 'Résultat EarthCoach enregistré dans le dossier terrain (résultat 1).';
    }
    if (name === 'earthcoach_extract_logging_tasks') {
        const tasks = Array.isArray(args.tasks) ? args.tasks as Array<Record<string, unknown>> : [];
        return ok({
            geocache_id: Number(args.geocache_id) || 0,
            saved: tasks.length,
            logging_tasks: tasks.map((task, index) => ({
                position: index + 1,
                question: String(task.question || ''),
                requires_photo: Boolean(task.requires_photo),
            })),
        });
    }
    if (name === 'earthcoach_calculate') {
        // Le calcul est deterministe et sans dependance: on execute le vrai.
        try {
            return ok(runEarthCoachCalculation(String(args.operation || ''), args));
        } catch (error) {
            return err(error instanceof Error ? error.message : String(error));
        }
    }
    return staticToolResult(name, args);
}

// ---------------------------------------------------------------------------
// Boucle de conversation
// ---------------------------------------------------------------------------

async function runScenario(scenario: EvalScenario): Promise<EvalRunResult> {
    const built = scenario.build();
    const messages: EvalChatMessage[] = [...built.messages];
    const toolCalls: Record<string, EvalRecordedCall[]> = {};
    let finalText = '';
    let followUpSent = false;
    let turns = 0;

    while (turns < MAX_TURNS) {
        turns++;
        const message = await callChatCompletions(messages, built.tools);
        const assistant: EvalChatMessage = { role: 'assistant', content: message.content };
        if (message.tool_calls?.length) {
            assistant.tool_calls = message.tool_calls;
        }
        messages.push(assistant);

        if (!message.tool_calls?.length) {
            finalText = message.content || '';
            if (scenario.followUp && !followUpSent) {
                // La conversation continue: le relanceur est envoye apres le
                // premier texte final, comme un vrai echange utilisateur.
                followUpSent = true;
                messages.push({ role: 'user', content: scenario.followUp });
                continue;
            }
            break;
        }

        for (const [index, call] of message.tool_calls.entries()) {
            const name = call.function?.name || 'unknown';
            const bucket = toolCalls[name] || (toolCalls[name] = []);
            const content = dispatchToolCall(call, bucket);
            messages.push({
                role: 'tool',
                tool_call_id: call.id || `call_${turns}_${index}`,
                content,
            });
        }
    }

    return { toolCalls, finalText, turns };
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

function totalToolCalls(result: EvalRunResult): number {
    return Object.values(result.toolCalls).reduce((total, calls) => total + calls.length, 0);
}

async function main(): Promise<void> {
    if (!MODEL) {
        console.error('EARTHCOACH_EVAL_MODEL n est pas defini: indique le nom du modele a evaluer.');
        console.error('Exemple (Ollama): EARTHCOACH_EVAL_MODEL=llama3.1 npm run test:earthcoach:eval');
        process.exit(1);
    }

    const selected = SCENARIOS_FILTER.length
        ? EVAL_SCENARIOS.filter(scenario => SCENARIOS_FILTER.includes(scenario.id))
        : EVAL_SCENARIOS;
    if (!selected.length) {
        console.error(`Aucun scenario ne correspond a EARTHCOACH_EVAL_SCENARIOS="${SCENARIOS_FILTER.join(',')}".`);
        console.error(`Ids disponibles: ${EVAL_SCENARIOS.map(scenario => scenario.id).join(', ')}`);
        process.exit(1);
    }

    console.log(`EarthCoach eval: model=${MODEL} base=${BASE_URL} scenarios=${selected.length} max_turns=${MAX_TURNS}`);

    let hardFailures = 0;
    let warningCount = 0;
    for (const scenario of selected) {
        const started = Date.now();
        try {
            const result = await runScenario(scenario);
            const outcome = scenario.assert(result);
            if (!result.finalText) {
                outcome.failures.unshift('no final text');
            }
            const elapsed = ((Date.now() - started) / 1000).toFixed(1);
            const calls = totalToolCalls(result);
            if (outcome.failures.length) {
                hardFailures++;
                console.log(`[FAIL] ${scenario.id} (${elapsed}s, ${calls} tool calls)`);
                for (const failure of outcome.failures) {
                    console.log(`  - ${failure}`);
                }
            } else {
                console.log(`[PASS] ${scenario.id} (${elapsed}s, ${calls} tool calls)`);
            }
            warningCount += outcome.warnings.length;
            for (const warning of outcome.warnings) {
                console.log(`  [warn] ${warning}`);
            }
        } catch (error) {
            if (error instanceof ToolsNotSupportedError) {
                console.error(`Le modele "${MODEL}" ne semble pas compatible tool calling (HTTP 400: ${error.message}).`);
                console.error('Choisis un modele qui supporte les tools OpenAI (ex: llama3.1, mistral-nemo, qwen3).');
                process.exit(2);
            }
            hardFailures++;
            console.log(`[FAIL] ${scenario.id} (erreur eval: ${error instanceof Error ? error.message : String(error)})`);
        }
    }

    const passed = selected.length - hardFailures;
    console.log(`Resultat: ${passed}/${selected.length} scenario(s) OK, ${hardFailures} echec(s), ${warningCount} avertissement(s).`);
    process.exit(hardFailures ? 1 : 0);
}

void main();
