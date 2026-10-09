import * as assert from 'assert/strict';

import { GeoAppAiOutputError } from 'theia-ide-zones-ext/lib/browser/geoapp-ai-execution-service';
import { FormulaSolverLLMService, SingleAnswer } from '../formula-solver-llm-service';

/** Service dont l'appel LLM renvoie une réponse fixée, pour tester la lecture du JSON. */
class StubbedLLMService extends FormulaSolverLLMService {
    lastPrompt = '';

    constructor(private readonly response: unknown) {
        super();
    }

    protected async callLLM(prompt: string): Promise<string> {
        this.lastPrompt = prompt;
        return typeof this.response === 'string' ? this.response : JSON.stringify(this.response);
    }
}

async function ask(response: unknown): Promise<SingleAnswer> {
    return new StubbedLLMService(response).answerSingleQuestionWithContext({
        letter: 'A',
        question: 'Nombre de marches de l\'escalier ?',
        context: { geocache_summary: '', global_rules: [], per_letter_rules: {} }
    });
}

async function testAnsweredWithConfidence(): Promise<void> {
    const result = await ask({ A: ' Paris ', valueType: 'checksum', status: 'answered', confidence: 'HIGH', explanation: 'capitale' });
    assert.deepEqual(result, { answer: 'Paris', explanation: 'capitale', valueType: 'checksum', status: 'answered', confidence: 'high' });
}

async function testFieldQuestionHasNoAnswer(): Promise<void> {
    const result = await ask({ A: '', valueType: 'value', status: 'field', explanation: 'compter les marches' });
    assert.equal(result.status, 'field');
    assert.equal(result.answer, '');
    assert.equal(result.explanation, 'compter les marches');
}

async function testGuessWithNoAnswerStatusIsDiscarded(): Promise<void> {
    // Le modèle dit ne pas savoir mais glisse quand même une valeur : on ne la garde pas
    const guessed = await ask({ A: '12', valueType: 'value', status: 'unknown', confidence: 'low' });
    assert.equal(guessed.status, 'unknown');
    assert.equal(guessed.answer, '');

    // Sans clé pour la lettre ni valueType valide, "field" reste accepté
    const bare = await ask({ status: 'field', valueType: 'n/a' });
    assert.equal(bare.status, 'field');
    assert.equal(bare.answer, '');
}

async function testMissingStatusIsInferred(): Promise<void> {
    // Ancien format (sans status ni confidence)
    const answered = await ask({ A: '1867', valueType: 'value', explanation: '' });
    assert.equal(answered.status, 'answered');
    assert.equal(answered.confidence, undefined);

    const empty = await ask({ A: '', valueType: 'value' });
    assert.equal(empty.status, 'unknown');

    // Confiance non reconnue : ignorée, pas d'erreur
    const odd = await ask({ A: '1867', valueType: 'value', status: 'answered', confidence: 'certain' });
    assert.equal(odd.confidence, undefined);
}

async function testSchemaErrorsStillRejected(): Promise<void> {
    await assert.rejects(() => ask({ B: 'x', valueType: 'value' }), GeoAppAiOutputError);
    await assert.rejects(() => ask({ A: 'x', valueType: 'inconnu', status: 'answered' }), GeoAppAiOutputError);
}

async function testPromptAllowsNotAnswering(): Promise<void> {
    const service = new StubbedLLMService({ A: '', status: 'field' });
    await service.answerSingleQuestionWithContext({
        letter: 'A',
        question: 'Q',
        context: { geocache_summary: '', global_rules: [], per_letter_rules: {} }
    });
    assert.match(service.lastPrompt, /N'INVENTE JAMAIS/);
    assert.match(service.lastPrompt, /"field"/);
    assert.match(service.lastPrompt, /"unknown"/);
}

async function run(): Promise<void> {
    await testAnsweredWithConfidence();
    await testFieldQuestionHasNoAnswer();
    await testGuessWithNoAnswerStatusIsDiscarded();
    await testMissingStatusIsInferred();
    await testSchemaErrorsStillRejected();
    await testPromptAllowsNotAnswering();
    // eslint-disable-next-line no-console
    console.log('answer-status tests passed');
}

void run();
