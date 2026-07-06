import * as assert from 'assert/strict';

import { AiPerQuestionAnswering, runWithConcurrency } from '../strategies/ai-per-question-answering';
import { AnsweringContext } from '../strategies/types';

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Faux LLM service qui mesure la concurrence réellement observée et peut
 * simuler un délai / un échec ciblé.
 */
class FakeLLMService {
    active = 0;
    maxActive = 0;
    calls: string[] = [];
    delayMs = 20;
    failOn?: string;

    async answerSingleQuestionWithContext(input: { letter: string }, _profile: string): Promise<any> {
        this.active++;
        this.maxActive = Math.max(this.maxActive, this.active);
        this.calls.push(input.letter);
        await sleep(this.delayMs);
        this.active--;
        if (this.failOn && input.letter === this.failOn) {
            throw new Error(`fail ${input.letter}`);
        }
        return { answer: `ans-${input.letter}`, explanation: '', valueType: 'value' };
    }
}

class FakeContextCache {
    async getOrBuild(): Promise<any> {
        return { geocache_summary: '', global_rules: [], per_letter_rules: {} };
    }
}

function makeStrategy(llm: FakeLLMService): AiPerQuestionAnswering {
    const strategy = new AiPerQuestionAnswering();
    (strategy as any).llmService = llm;
    (strategy as any).answeringContextCache = new FakeContextCache();
    (strategy as any).formulaSolverService = {};
    return strategy;
}

function questionsMap(letters: string[]): Map<string, string> {
    return new Map(letters.map(l => [l, `question-${l}`]));
}

async function testParallelRespectsDefaultLimit(): Promise<void> {
    const llm = new FakeLLMService();
    const strategy = makeStrategy(llm);

    const result = await strategy.answer({
        text: '',
        questionsByLetter: questionsMap(['A', 'B', 'C', 'D', 'E', 'F']),
        aiProfile: 'fast'
    } as AnsweringContext);

    assert.equal(result.answersByLetter.size, 6);
    assert.equal(result.answersByLetter.get('A'), 'ans-A');
    // Concurrence par défaut = 3
    assert.equal(llm.maxActive, 3, `maxActive attendu 3, obtenu ${llm.maxActive}`);
}

async function testAllLocalSerializes(): Promise<void> {
    const llm = new FakeLLMService();
    const strategy = makeStrategy(llm);

    await strategy.answer({
        text: '',
        questionsByLetter: questionsMap(['A', 'B', 'C']),
        aiProfile: 'local',
        perQuestionProfile: new Map([['A', 'local'], ['B', 'local'], ['C', 'local']])
    } as AnsweringContext);

    // Tout en local => une seule requête à la fois (LMStudio/Ollama)
    assert.equal(llm.maxActive, 1, `maxActive attendu 1 pour tout-local, obtenu ${llm.maxActive}`);
}

async function testMixedProfilesParallelize(): Promise<void> {
    const llm = new FakeLLMService();
    const strategy = makeStrategy(llm);

    await strategy.answer({
        text: '',
        questionsByLetter: questionsMap(['A', 'B', 'C']),
        aiProfile: 'fast',
        perQuestionProfile: new Map([['A', 'local'], ['B', 'fast'], ['C', 'strong']])
    } as AnsweringContext);

    // Dès qu'un profil non-local est présent, on parallélise (jusqu'à 3 ici).
    assert.equal(llm.maxActive, 3, `maxActive attendu 3 pour profils mixtes, obtenu ${llm.maxActive}`);
}

async function testEmptyQuestionSkipsLlm(): Promise<void> {
    const llm = new FakeLLMService();
    const strategy = makeStrategy(llm);

    const result = await strategy.answer({
        text: '',
        questionsByLetter: new Map([['A', 'question-A'], ['B', '']]),
        aiProfile: 'fast'
    } as AnsweringContext);

    assert.equal(result.answersByLetter.get('B'), '');
    // Aucune recherche LLM pour la question vide.
    assert.deepEqual(llm.calls.sort(), ['A']);
}

async function testFailedLetterDoesNotBlockOthers(): Promise<void> {
    const llm = new FakeLLMService();
    llm.failOn = 'B';
    const strategy = makeStrategy(llm);

    // La résolution ne doit JAMAIS rejeter : l'échec d'une lettre est isolé
    // (stocké dans AnswerDetail.error) et ne doit pas empêcher les autres
    // lettres du même lot d'être traitées.
    const result = await strategy.answer({
        text: '',
        questionsByLetter: questionsMap(['A', 'B', 'C']),
        aiProfile: 'fast'
    } as AnsweringContext);

    assert.equal(result.answersByLetter.get('A'), 'ans-A');
    assert.equal(result.answersByLetter.get('C'), 'ans-C');
    assert.equal(result.answersByLetter.get('B'), '');

    assert.equal(result.detailsByLetter?.get('A')?.error, undefined);
    assert.equal(result.detailsByLetter?.get('C')?.error, undefined);
    assert.match(result.detailsByLetter?.get('B')?.error ?? '', /fail B/);
}

async function testFailedWebLetterCapturesErrorOnDetail(): Promise<void> {
    const llm = new FakeLLMService();
    const strategy = makeStrategy(llm);
    // Le profil "web" appelle formulaSolverService.searchAnswerWeb avant le LLM ;
    // on simule un échec réseau à ce niveau.
    (strategy as any).formulaSolverService = {
        searchAnswerWeb: async () => { throw new Error('network down'); }
    };

    const result = await strategy.answer({
        text: '',
        questionsByLetter: questionsMap(['A', 'B']),
        aiProfile: 'fast',
        perQuestionProfile: new Map([['A', 'web'], ['B', 'fast']])
    } as AnsweringContext);

    assert.equal(result.answersByLetter.get('B'), 'ans-B');
    assert.equal(result.detailsByLetter?.get('B')?.error, undefined);

    assert.equal(result.answersByLetter.get('A'), '');
    assert.match(result.detailsByLetter?.get('A')?.error ?? '', /network down/);
    assert.equal(result.detailsByLetter?.get('A')?.source, 'web');
}

async function testRunWithConcurrencyLimit(): Promise<void> {
    let active = 0;
    let maxActive = 0;
    await runWithConcurrency([1, 2, 3, 4, 5, 6, 7, 8], 3, async () => {
        active++;
        maxActive = Math.max(maxActive, active);
        await sleep(10);
        active--;
    });
    assert.equal(maxActive, 3);
}

async function testRunWithConcurrencyStopsAfterError(): Promise<void> {
    const processed: number[] = [];
    await assert.rejects(
        () => runWithConcurrency([1, 2, 3, 4, 5, 6, 7, 8], 2, async (n) => {
            processed.push(n);
            await sleep(5);
            if (n === 1) {
                throw new Error('boom');
            }
        }),
        /boom/
    );
    // Après l'échec précoce, on ne lance pas les 8 items.
    assert.ok(processed.length < 8, `processed.length attendu < 8, obtenu ${processed.length}`);
}

async function run(): Promise<void> {
    await testParallelRespectsDefaultLimit();
    await testAllLocalSerializes();
    await testMixedProfilesParallelize();
    await testEmptyQuestionSkipsLlm();
    await testFailedLetterDoesNotBlockOthers();
    await testFailedWebLetterCapturesErrorOnDetail();
    await testRunWithConcurrencyLimit();
    await testRunWithConcurrencyStopsAfterError();
    // eslint-disable-next-line no-console
    console.log('ai-per-question-answering tests passed');
}

void run();
