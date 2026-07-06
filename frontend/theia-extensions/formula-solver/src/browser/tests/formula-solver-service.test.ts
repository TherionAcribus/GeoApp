import * as assert from 'assert/strict';

import { FormulaSolverServiceImpl } from '../formula-solver-service';

function makeService(): any {
    const fakePreferenceService = {
        get: () => 'http://localhost:8000',
        onPreferenceChanged: () => { /* noop */ }
    };
    return new FormulaSolverServiceImpl(fakePreferenceService as any);
}

/**
 * Le fallback de searchAnswersWebBatch() (quand l'endpoint batch backend échoue)
 * exécute une recherche par question via searchAnswerWeb(). Avant le correctif,
 * l'échec d'une seule question interrompait la boucle et empêchait les questions
 * suivantes d'être tentées. Ce test verrouille l'isolation par lettre.
 */
async function testBatchFallbackIsolatesPerLetterErrors(): Promise<void> {
    const service = makeService();

    // Force le chemin de fallback : l'appel batch (POST /ai/search-answers) échoue.
    service.api = {
        post: async (url: string) => {
            if (url === '/ai/search-answers') {
                throw new Error('batch endpoint unavailable');
            }
            throw new Error(`unexpected call: ${url}`);
        }
    };

    let callCount = 0;
    service.searchAnswerWeb = async (params: { question: string }) => {
        callCount++;
        if (params.question === 'boom') {
            throw new Error('single search failed');
        }
        return { bestAnswer: `answer for ${params.question}`, results: [] };
    };

    const result = await service.searchAnswersWebBatch({
        questions: { A: 'good-a', B: 'boom', C: 'good-c' }
    });

    // Les 3 questions doivent avoir été tentées malgré l'échec de B.
    assert.equal(callCount, 3, `attendu 3 appels searchAnswerWeb, obtenu ${callCount}`);
    assert.equal(result.get('A')?.bestAnswer, 'answer for good-a');
    assert.equal(result.get('C')?.bestAnswer, 'answer for good-c');
    assert.equal(result.get('B')?.bestAnswer, '');
    assert.match(result.get('B')?.error ?? '', /single search failed/);
    assert.equal(result.get('A')?.error, undefined);
}

async function run(): Promise<void> {
    await testBatchFallbackIsolatesPerLetterErrors();
    // eslint-disable-next-line no-console
    console.log('formula-solver-service tests passed');
}

void run();
