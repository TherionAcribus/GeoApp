/**
 * Tests de la détection de joignabilité du backend dans BackendApiClient.
 *
 * Ce qui est vérifié : un `fetch` qui jette (backend arrêté, réseau coupé)
 * bascule l'état à « injoignable » et notifie les widgets ; une réponse HTTP
 * — même en erreur — compte comme joignable, et l'état ne se répète pas.
 */

import * as assert from 'assert/strict';
import { BackendApiClient } from '../backend-api-client';

const fakePreferences = {
    get: () => 'http://backend.test',
    onPreferenceChanged: () => ({ dispose: () => undefined }),
} as any;

const realFetch = globalThis.fetch;

async function main(): Promise<void> {
    const client = new BackendApiClient(fakePreferences);
    const events: boolean[] = [];
    client.onDidChangeConnectivity(v => events.push(v));

    // Optimiste : joignable tant qu'aucun échec n'a été constaté.
    assert.equal(client.isBackendReachable(), true);

    // Un fetch qui jette → injoignable + notification.
    globalThis.fetch = (() => Promise.reject(new TypeError('fetch failed'))) as any;
    await assert.rejects(() => client.request('/api/x'), /fetch failed/);
    assert.equal(client.isBackendReachable(), false);
    assert.deepEqual(events, [false]);

    // L'état ne se répète pas : deuxième échec sans nouvel événement.
    await assert.rejects(() => client.request('/api/x'));
    assert.deepEqual(events, [false]);

    // Une réponse HTTP, même 500, compte comme joignable.
    globalThis.fetch = (() => Promise.resolve(new Response('ko', { status: 500 }))) as any;
    await client.request('/api/x');
    assert.equal(client.isBackendReachable(), true);
    assert.deepEqual(events, [false, true], 'le retour réseau est notifié');

    // La sonde rebascule l'état sans autre appel.
    globalThis.fetch = (() => Promise.reject(new TypeError('fetch failed'))) as any;
    assert.equal(await client.probeBackend(), false);
    assert.equal(client.isBackendReachable(), false);
    globalThis.fetch = (() => Promise.resolve(new Response('{}', { status: 200 }))) as any;
    assert.equal(await client.probeBackend(), true);
    assert.equal(client.isBackendReachable(), true);

    console.log('backend-connectivity: OK');
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
}).finally(() => {
    globalThis.fetch = realFetch;
});
