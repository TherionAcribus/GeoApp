import * as assert from 'assert/strict';

import { FormulaSession, FormulaSessionManager } from '../formula-solver-session-manager';

/** localStorage minimal, avec une capacité maximale optionnelle (en caractères). */
class FakeStorage {
    private readonly data = new Map<string, string>();
    constructor(private readonly capacity: number = Infinity) { }

    getItem(key: string): string | null {
        return this.data.has(key) ? this.data.get(key)! : null;
    }

    setItem(key: string, value: string): void {
        let used = value.length;
        this.data.forEach((v, k) => {
            if (k !== key) {
                used += v.length;
            }
        });
        if (used > this.capacity) {
            throw new Error('QuotaExceededError');
        }
        this.data.set(key, value);
    }

    removeItem(key: string): void {
        this.data.delete(key);
    }

    get size(): number {
        return this.data.size;
    }
}

function useStorage(storage: FakeStorage): void {
    (globalThis as any).localStorage = storage;
}

function session(geocacheId: number, text: string = ''): FormulaSession {
    return {
        geocacheId,
        gcCode: `GC${geocacheId}`,
        savedAt: geocacheId,
        currentStep: 'values',
        text,
        formulas: [],
        questions: [],
        values: [],
        answerDetails: [],
        perLetterExtraInfo: [],
        questionsAiUserHint: '',
        bruteForceResults: []
    };
}

function testSaveAndReload(): void {
    useStorage(new FakeStorage());
    assert.equal(FormulaSessionManager.saveSession(session(1)), true);
    assert.equal(FormulaSessionManager.saveSession(session(2)), true);
    // Réenregistrer une session la remonte en tête sans la dupliquer
    assert.equal(FormulaSessionManager.saveSession(session(1)), true);

    assert.deepEqual(FormulaSessionManager.listSessions().map(s => s.geocacheId), [1, 2]);
    assert.equal(FormulaSessionManager.loadSession(2)?.gcCode, 'GC2');
}

function testOldestSessionsArePruned(): void {
    const storage = new FakeStorage();
    useStorage(storage);
    for (let id = 1; id <= 35; id++) {
        FormulaSessionManager.saveSession(session(id));
    }

    const ids = FormulaSessionManager.listSessions().map(s => s.geocacheId);
    assert.equal(ids.length, 30);
    assert.equal(ids[0], 35);
    assert.equal(ids[29], 6);
    assert.equal(FormulaSessionManager.hasSavedSession(5), false);
    // 30 sessions + l'index : rien d'orphelin
    assert.equal(storage.size, 31);
}

function testFullStorageFreesOldestSessions(): void {
    const big = 'x'.repeat(1000);
    // Assez de place pour deux grosses sessions et l'index, pas trois
    useStorage(new FakeStorage(3200));
    assert.equal(FormulaSessionManager.saveSession(session(1, big)), true);
    assert.equal(FormulaSessionManager.saveSession(session(2, big)), true);
    assert.equal(FormulaSessionManager.saveSession(session(3, big)), true);

    assert.deepEqual(FormulaSessionManager.listSessions().map(s => s.geocacheId), [3, 2]);
    assert.equal(FormulaSessionManager.hasSavedSession(1), false);
}

function testSessionTooBigIsReported(): void {
    useStorage(new FakeStorage(500));
    assert.equal(FormulaSessionManager.saveSession(session(1, 'x'.repeat(1000))), false);
    assert.equal(FormulaSessionManager.hasSavedSession(1), false);
}

function run(): void {
    testSaveAndReload();
    testOldestSessionsArePruned();
    testFullStorageFreesOldestSessions();
    testSessionTooBigIsReported();
    // eslint-disable-next-line no-console
    console.log('session-manager tests passed');
}

run();
