/**
 * Tests du modèle d'état « sortie entre amis » (phase 1).
 *
 * Ce qui est vérifié n'est pas la forme des objets mais ce qui ferait perdre du travail
 * à l'utilisateur : une sortie doit se retrouver telle quelle après fermeture de
 * l'onglet, une entrée abîmée ou appartenant à une autre zone ne doit jamais réactiver
 * le mode par surprise, et une sortie « toute la zone » ne doit pas se transformer en
 * analyse ciblée — ce qui priverait le backend de son skip des amis récemment scannés.
 */

import * as assert from 'assert/strict';
import {
    createFriendOuting,
    friendOfFilter,
    friendOutingStorageKey,
    missingForFriendFilter,
    normalizeFriendOuting,
    outingScopeGcCodes,
    updateFriendOuting,
} from '../friend-outing-state';
import { clearFriendOuting, loadFriendOuting, saveFriendOuting } from '../friend-outing-store';

/** StorageService minimal en mémoire, avec la sémantique de suppression de Theia. */
class FakeStorage {
    readonly data = new Map<string, unknown>();

    async setData<T>(key: string, value?: T): Promise<void> {
        if (value === undefined) {
            this.data.delete(key);
        } else {
            // Comme le vrai stockage : sérialisé, donc pas de partage de référence.
            this.data.set(key, JSON.parse(JSON.stringify(value)));
        }
    }

    async getData<T>(key: string, defaultValue?: T): Promise<T | undefined> {
        return this.data.has(key) ? this.data.get(key) as T : defaultValue;
    }
}

function storage(): FakeStorage & any {
    return new FakeStorage() as any;
}

const NOW = () => '2026-09-05T08:00:00.000Z';

// -------------------------------------------------- Construction

{
    const outing = createFriendOuting(7, ['zoé', 'Alan', 'Alan'], ['GCBBB', 'GCAAA', 'GCAAA'], NOW);
    assert.equal(outing.zoneId, 7);
    assert.deepEqual(outing.friends, ['Alan', 'zoé'], 'amis dédoublonnés et triés comme la liste d’amis du widget');
    assert.deepEqual(outing.gcCodes, ['GCAAA', 'GCBBB'], 'codes GC dédoublonnés et triés');
    assert.equal(outing.updatedAt, NOW());
}

{
    const initial = createFriendOuting(7, ['Alan'], ['GCAAA'], () => '2026-09-05T08:00:00.000Z');
    const next = updateFriendOuting(initial, { friends: ['Alan', 'Zoé'] }, () => '2026-09-05T09:00:00.000Z');
    assert.deepEqual(next.friends, ['Alan', 'Zoé']);
    assert.deepEqual(next.gcCodes, ['GCAAA'], 'le périmètre est conservé quand seuls les amis changent');
    assert.equal(next.updatedAt, '2026-09-05T09:00:00.000Z', 'chaque modification réhorodate');
    assert.deepEqual(initial.friends, ['Alan'], 'la sortie d’origine n’est pas mutée');
}

// -------------------------------------------------- Lecture défensive

{
    assert.equal(normalizeFriendOuting(null, 7), null);
    assert.equal(normalizeFriendOuting('sortie', 7), null);
    assert.equal(normalizeFriendOuting([], 7), null);
    assert.equal(normalizeFriendOuting({ friends: ['Alan'] }, 7), null, 'sans zoneId : inexploitable');
    assert.equal(
        normalizeFriendOuting({ zoneId: 8, friends: [], gcCodes: [], updatedAt: NOW() }, 7),
        null,
        'une sortie d’une autre zone ne doit jamais réactiver le mode ici'
    );

    const salvaged = normalizeFriendOuting(
        { zoneId: 7, friends: ['Alan', 42, '', null], gcCodes: 'GCAAA', updatedAt: 12 },
        7
    );
    assert.ok(salvaged);
    assert.deepEqual(salvaged!.friends, ['Alan'], 'les entrées non exploitables sont écartées, pas la sortie entière');
    assert.deepEqual(salvaged!.gcCodes, []);
    assert.equal(typeof salvaged!.updatedAt, 'string');
}

// -------------------------------------------------- Filtres

{
    assert.equal(missingForFriendFilter('Alan'), 'missing-for:Alan');
    assert.equal(missingForFriendFilter(null), 'none');
    assert.equal(friendOfFilter('missing-for:Alan'), 'Alan');
    assert.equal(friendOfFilter('missing-for:'), null);
    assert.equal(friendOfFilter('none'), null);
    assert.equal(friendOfFilter('nobody'), null);
    assert.equal(friendOfFilter('everybody'), null);
}

// -------------------------------------------------- Périmètre d'analyse

{
    const zone = ['GCAAA', 'GCBBB', 'GCCCC'];
    assert.equal(outingScopeGcCodes(null, zone), undefined);
    assert.equal(
        outingScopeGcCodes(createFriendOuting(7, [], [], NOW), zone),
        undefined,
        'périmètre vide = toute la zone : ne pas cibler'
    );
    assert.equal(
        outingScopeGcCodes(createFriendOuting(7, [], zone, NOW), zone),
        undefined,
        'périmètre = toute la zone : ne pas cibler non plus, sinon le backend perd son skip incrémental'
    );
    assert.deepEqual(
        outingScopeGcCodes(createFriendOuting(7, [], ['GCBBB', 'GCZZZ'], NOW), zone),
        ['GCBBB'],
        'les caches disparues de la zone depuis la dernière ouverture sont ignorées'
    );
    assert.equal(
        outingScopeGcCodes(createFriendOuting(7, [], ['GCZZZ'], NOW), zone),
        undefined,
        'plus aucune cache du périmètre dans la zone : retomber sur la zone entière plutôt qu’analyser le vide'
    );
}

// -------------------------------------------------- Persistance

void (async () => {
    const store = storage();
    assert.equal(await loadFriendOuting(store, 7), null, 'aucune sortie enregistrée');

    const outing = createFriendOuting(7, ['Alan', 'Zoé'], ['GCAAA'], NOW);
    await saveFriendOuting(store, outing);
    assert.deepEqual(store.data.get(friendOutingStorageKey(7)), outing, 'une clé par zone');

    const restored = await loadFriendOuting(store, 7);
    assert.deepEqual(restored, outing, 'la sortie revient identique après un aller-retour par le stockage');
    assert.equal(await loadFriendOuting(store, 8), null, 'la sortie de la zone 7 ne fuit pas sur la zone 8');

    await clearFriendOuting(store, 7);
    assert.equal(store.data.has(friendOutingStorageKey(7)), false, 'sortir du mode supprime l’entrée');
    assert.equal(await loadFriendOuting(store, 7), null);

    // Un stockage en panne dégrade en « pas de sortie » : la sortie est un confort.
    const broken = {
        getData: async () => { throw new Error('quota'); },
        setData: async () => { throw new Error('quota'); },
    } as any;
    assert.equal(await loadFriendOuting(broken, 7), null);
    await saveFriendOuting(broken, outing);
    await clearFriendOuting(broken, 7);

    console.log('friend-outing-state: OK');
})();
