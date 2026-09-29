/**
 * Tests de la réconciliation de la synchronisation backend : file d'attente des
 * écritures faites backend arrêté, `storedKeys`, clés sensibles ignorées au pull
 * et réinitialisation propagée en `DELETE`.
 *
 * Exécution : yarn test:geoapp (ts-node).
 */

import * as assert from 'assert/strict';
import { PreferenceSyncService } from '../services/preference-sync-service';
import { GeoPreferenceDefinition } from '../geo-preferences-schema';

// ── Fenêtre minimale : localStorage (file d'attente) + timers (withTimeout) ──

class FakeStorage implements Storage {
    private readonly data = new Map<string, string>();
    get length(): number { return this.data.size; }
    clear(): void { this.data.clear(); }
    getItem(key: string): string | null { return this.data.has(key) ? this.data.get(key)! : null; }
    key(index: number): string | null { return Array.from(this.data.keys())[index] ?? null; }
    removeItem(key: string): void { this.data.delete(key); }
    setItem(key: string, value: string): void { this.data.set(key, String(value)); }
}

const storage = new FakeStorage();
(globalThis as unknown as { window: unknown }).window = {
    localStorage: storage,
    setTimeout,
    clearTimeout,
    requestAnimationFrame: (cb: () => void) => setTimeout(cb, 0),
    cancelAnimationFrame: clearTimeout,
};

const PENDING_KEY = 'geoApp.preferences.pendingSync.v1';
const BACKEND_A = 'geoApp.fake.backendA';
const BACKEND_B = 'geoApp.fake.backendB';
const SENSITIVE = 'geoApp.fake.sensitive';
const FRONTEND_ONLY = 'geoApp.fake.frontOnly';

const definitions = [
    { key: BACKEND_A, definition: { type: 'string', default: 'defA', 'x-targets': ['frontend', 'backend'], 'x-ui': { label: 'A', section: 'S' } } },
    { key: BACKEND_B, definition: { type: 'string', default: 'defB', 'x-targets': ['frontend', 'backend'], 'x-ui': { label: 'B', section: 'S' } } },
    { key: SENSITIVE, definition: { type: 'string', default: '', 'x-targets': ['frontend', 'backend'], 'x-sensitive': true, 'x-ui': { label: 'Secret', section: 'S' } } },
    { key: FRONTEND_ONLY, definition: { type: 'string', default: 'front', 'x-targets': ['frontend'], 'x-ui': { label: 'F', section: 'S' } } },
] as Array<{ key: string; definition: GeoPreferenceDefinition }>;

const axiosUnreachable = (): { isAxiosError: boolean; response: undefined } => ({ isAxiosError: true, response: undefined });

function makeService(): {
    service: PreferenceSyncService;
    api: {
        calls: string[];
        lastBulk: Record<string, unknown> | undefined;
        unreachable: boolean;
        fetchResponse: { preferences: Record<string, unknown>; storedKeys?: string[]; sensitiveKeys?: string[] };
        setBaseUrl(): void;
        fetchAll(): Promise<{ preferences: Record<string, unknown>; storedKeys?: string[] }>;
        update(key: string, value: unknown): Promise<void>;
        updateBulk(values: Record<string, unknown>): Promise<void>;
        reset(key: string): Promise<void>;
    };
    values: Map<string, unknown>;
    inspected: Map<string, unknown>;
    applied: Array<[string, unknown]>;
    messages: string[];
    fire(preferenceName: string): Promise<void>;
} {
    const values = new Map<string, unknown>();
    const inspected = new Map<string, unknown>();
    const applied: Array<[string, unknown]> = [];
    const messages: string[] = [];
    let listener: ((event: { preferenceName: string }) => void) | undefined;

    const preferenceService = {
        get: (key: string, defaultValue: unknown) => values.has(key) ? values.get(key) : defaultValue,
        set: (key: string, value: unknown) => {
            values.set(key, value);
            applied.push([key, value]);
            return Promise.resolve();
        },
        inspect: (key: string) => ({ globalValue: inspected.get(key) }),
        onPreferenceChanged: (callback: (event: { preferenceName: string }) => void) => {
            listener = callback;
            return { dispose(): void { /* noop */ } };
        },
    };

    const store = {
        definitions,
        getDefinition: (key: string) => definitions.find(entry => entry.key === key)?.definition,
    };

    const api = {
        calls: [] as string[],
        lastBulk: undefined as Record<string, unknown> | undefined,
        unreachable: false,
        fetchResponse: { preferences: {} as Record<string, unknown>, storedKeys: [] as string[] },
        setBaseUrl(): void { /* noop */ },
        async fetchAll() {
            if (this.unreachable) {
                throw axiosUnreachable();
            }
            return this.fetchResponse;
        },
        async update(key: string) {
            this.calls.push(`put:${key}`);
            if (this.unreachable) {
                throw axiosUnreachable();
            }
        },
        async updateBulk(bulk: Record<string, unknown>) {
            this.calls.push(`patch:${Object.keys(bulk).join(',')}`);
            this.lastBulk = bulk;
            if (this.unreachable) {
                throw axiosUnreachable();
            }
        },
        async reset(key: string) {
            this.calls.push(`delete:${key}`);
            if (this.unreachable) {
                throw axiosUnreachable();
            }
        },
    };

    const messageService = { error: (message: string) => { messages.push(message); } };

    const service = new PreferenceSyncService(
        preferenceService as never,
        store as never,
        api as never,
        messageService as never
    );

    return {
        service,
        api,
        values,
        inspected,
        applied,
        messages,
        fire: preferenceName => Promise.resolve(listener!({ preferenceName }) as unknown as void)
    };
}

function pendingSync(): Record<string, string> {
    const raw = storage.getItem(PENDING_KEY);
    return raw ? JSON.parse(raw) as Record<string, string> : {};
}

async function main(): Promise<void> {
    const { service, api, values, inspected, applied, messages, fire } = makeService();
    const internals = service as unknown as {
        flushPendingSync(): Promise<string>;
        pullFromBackend(excludedKeys: Set<string>): Promise<string>;
    };

    // ── 1. Changement ciblé backend, joignable → PUT immédiat ─────────────
    inspected.set(BACKEND_A, 'v1');
    values.set(BACKEND_A, 'v1');
    await fire(BACKEND_A);
    assert.deepEqual(api.calls, [`put:${BACKEND_A}`], 'un PUT est émis pour une clé backend');

    // ── 2. Backend arrêté → l'écriture part en file, erreur notifiée ──────
    api.unreachable = true;
    inspected.set(BACKEND_A, 'v2');
    values.set(BACKEND_A, 'v2');
    await fire(BACKEND_A);
    assert.equal(pendingSync()[BACKEND_A], 'set', 'la clé est mise en file');
    assert.equal(messages.length, 1, 'un toast d\'erreur est affiché');
    assert.ok(messages[0].includes('reste appliquée localement'), 'le message annonce la reprise');

    // ── 3. Reset (clé absente du scope) backend arrêté → file 'reset' ─────
    inspected.delete(BACKEND_B);
    await fire(BACKEND_B);
    assert.equal(pendingSync()[BACKEND_B], 'reset', 'le reset part en file comme intention reset');

    // ── 4. Backend de retour : un seul PATCH pour les set + DELETE par reset ──
    api.unreachable = false;
    api.calls.length = 0;
    const flush = await internals.flushPendingSync();
    assert.equal(flush, 'ok');
    assert.deepEqual(api.calls, [`patch:${BACKEND_A}`, `delete:${BACKEND_B}`],
        'un seul PATCH pour les sets puis un DELETE par reset');
    assert.deepEqual(api.lastBulk, { [BACKEND_A]: 'v2' }, 'le PATCH repousse la valeur relue au moment de l\'envoi');
    assert.deepEqual(pendingSync(), {}, 'la file est vidée après un flush réussi');

    // ── 5. Reset backend joignable → DELETE immédiat, pas de PUT ──────────
    api.calls.length = 0;
    inspected.delete(BACKEND_B);
    await fire(BACKEND_B);
    assert.deepEqual(api.calls, [`delete:${BACKEND_B}`], 'un reset se traduit en DELETE');

    // ── 6. Clé frontend seule : jamais envoyée, même modifiée ─────────────
    api.calls.length = 0;
    inspected.set(FRONTEND_ONLY, 'x');
    await fire(FRONTEND_ONLY);
    assert.deepEqual(api.calls, [], 'une clé sans cible backend ne part jamais');

    // ── 7. Pull : storedKeys seulement, sensibles et non-backend ignorées ─
    applied.length = 0;
    api.fetchResponse = {
        preferences: {
            [BACKEND_A]: 'depuisBackend',
            [BACKEND_B]: 'b2',
            [SENSITIVE]: null,           // masquée côté backend
            [FRONTEND_ONLY]: 'pirate',   // ne devrait jamais être appliquée
            'autre.clef': 'y'
        },
        storedKeys: [BACKEND_A, BACKEND_B, SENSITIVE, FRONTEND_ONLY]
    };
    const pull = await internals.pullFromBackend(new Set());
    assert.equal(pull, 'ok');
    assert.deepEqual(applied, [[BACKEND_A, 'depuisBackend'], [BACKEND_B, 'b2']],
        'seules les clés backend non sensibles réellement stockées sont appliquées');

    // ── 8. Clé jamais stockée par Flask : le défaut renvoyé n'écrase pas ──
    applied.length = 0;
    values.set(BACKEND_A, 'locale');
    api.fetchResponse = { preferences: { [BACKEND_A]: 'defA' }, storedKeys: [] };
    await internals.pullFromBackend(new Set());
    assert.deepEqual(applied, [], 'une clé absente de storedKeys n\'écrase pas la valeur locale');

    // ── 9. Clé qui vient d'être rejouée : exclue du pull ──────────────────
    applied.length = 0;
    api.fetchResponse = { preferences: { [BACKEND_A]: 'depuisBackend' }, storedKeys: [BACKEND_A] };
    await internals.pullFromBackend(new Set([BACKEND_A]));
    assert.deepEqual(applied, [], 'la clé rejouée vers Flask n\'est pas ré-appliquée');

    // ── 10. Valeur identique : pas de réécriture ──────────────────────────
    applied.length = 0;
    values.set(BACKEND_A, 'identique');
    api.fetchResponse = { preferences: { [BACKEND_A]: 'identique' }, storedKeys: [BACKEND_A] };
    await internals.pullFromBackend(new Set());
    assert.deepEqual(applied, [], 'une valeur déjà identique n\'est pas réécrite');

    // ── 11. Backend injoignable au pull → outcome 'unreachable' ───────────
    api.unreachable = true;
    const outcome = await internals.pullFromBackend(new Set());
    assert.equal(outcome, 'unreachable');

    console.log('preference-sync-service: OK');
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
