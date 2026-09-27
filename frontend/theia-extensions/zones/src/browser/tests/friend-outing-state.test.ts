/**
 * Tests du modèle d'état « sortie entre amis ».
 *
 * Ce qui est vérifié n'est pas la forme des objets mais ce qui ferait perdre du travail
 * à l'utilisateur : une sortie doit se retrouver telle quelle après fermeture de
 * l'onglet, une entrée abîmée ou appartenant à une autre zone ne doit jamais réactiver
 * le mode par surprise, et une sortie « toute la zone » ne doit pas se transformer en
 * analyse ciblée — ce qui priverait le backend de son skip des amis récemment scannés.
 *
 * Depuis les sorties nommées : plusieurs préparations coexistent par zone, une
 * seule est active, et l'ancien format « une seule sortie à plat » migre à la
 * lecture plutôt que d'être perdu.
 */

import * as assert from 'assert/strict';
import {
    ZoneOutings,
    createFriendOuting,
    deactivateZoneOutings,
    findZoneOuting,
    friendOfFilter,
    friendOutingStorageKey,
    missingForFriendFilter,
    nextOutingName,
    normalizeFriendOuting,
    normalizeZoneOutings,
    outingScopeGcCodes,
    removeZoneOuting,
    updateFriendOuting,
    upsertZoneOuting,
} from '../friend-outing-state';
import { clearZoneOutings, loadZoneOutings, saveZoneOutings } from '../friend-outing-store';

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
    const outing = createFriendOuting(7, 'Samedi', ['zoé', 'Alan', 'Alan'], ['GCBBB', 'GCAAA', 'GCAAA'], NOW);
    assert.equal(outing.zoneId, 7);
    assert.equal(outing.name, 'Samedi');
    assert.deepEqual(outing.friends, ['Alan', 'zoé'], 'amis dédoublonnés et triés comme la liste d’amis du widget');
    assert.deepEqual(outing.gcCodes, ['GCAAA', 'GCBBB'], 'codes GC dédoublonnés et triés');
    assert.equal(outing.updatedAt, NOW());

    assert.equal(createFriendOuting(7, '  ', [], [], NOW).name, 'Sortie', 'nom vide → nom par défaut');
}

{
    const initial = createFriendOuting(7, 'Samedi', ['Alan'], ['GCAAA'], () => '2026-09-05T08:00:00.000Z');
    const next = updateFriendOuting(initial, { friends: ['Alan', 'Zoé'] }, () => '2026-09-05T09:00:00.000Z');
    assert.deepEqual(next.friends, ['Alan', 'Zoé']);
    assert.equal(next.name, 'Samedi', 'le nom est conservé quand seuls les amis changent');
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
        { zoneId: 7, name: 'Samedi', friends: ['Alan', 42, '', null], gcCodes: 'GCAAA', updatedAt: 12 },
        7
    );
    assert.ok(salvaged);
    assert.equal(salvaged!.name, 'Samedi');
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
        outingScopeGcCodes(createFriendOuting(7, 'S', [], [], NOW), zone),
        undefined,
        'périmètre vide = toute la zone : ne pas cibler'
    );
    assert.equal(
        outingScopeGcCodes(createFriendOuting(7, 'S', [], zone, NOW), zone),
        undefined,
        'périmètre = toute la zone : ne pas cibler non plus, sinon le backend perd son skip incrémental'
    );
    assert.deepEqual(
        outingScopeGcCodes(createFriendOuting(7, 'S', [], ['GCBBB', 'GCZZZ'], NOW), zone),
        ['GCBBB'],
        'les caches disparues de la zone depuis la dernière ouverture sont ignorées'
    );
    assert.equal(
        outingScopeGcCodes(createFriendOuting(7, 'S', [], ['GCZZZ'], NOW), zone),
        undefined,
        'plus aucune cache du périmètre dans la zone : retomber sur la zone entière plutôt qu’analyser le vide'
    );
}

// -------------------------------------------------- Ensemble de sorties nommées

{
    const set: ZoneOutings = { zoneId: 7, outings: [], activeName: null };
    const a = createFriendOuting(7, 'Samedi', ['Alan'], [], NOW);
    const b = createFriendOuting(7, 'Dimanche', ['Zoé'], [], NOW);

    const withA = upsertZoneOuting(set, a)!;
    assert.equal(withA.activeName, 'Samedi', 'ajouter une sortie la rend active');
    const withBoth = upsertZoneOuting(withA, b)!;
    assert.equal(withBoth.outings.length, 2);
    assert.equal(withBoth.activeName, 'Dimanche');

    // Remplacement insensible à la casse.
    const aBis = createFriendOuting(7, 'SAMEDI', ['Alan', 'Chloé'], [], NOW);
    const replaced = upsertZoneOuting(withBoth, aBis)!;
    assert.equal(replaced.outings.length, 2, 'même nom → remplacement, pas de doublon');
    assert.deepEqual(findZoneOuting(replaced, 'samedi')!.friends, ['Alan', 'Chloé']);

    assert.equal(findZoneOuting(withBoth, 'dimanche')!.name, 'Dimanche');
    assert.equal(findZoneOuting(withBoth, 'inconnue'), undefined);

    // Désactivation : les sorties restent, le mode est quitté.
    const off = deactivateZoneOutings(withBoth);
    assert.equal(off.activeName, null);
    assert.equal(off.outings.length, 2);

    // Suppression de l'active : le mode ne bascule pas sur une autre sortie.
    const removed = removeZoneOuting(withBoth, 'Dimanche');
    assert.equal(removed.outings.length, 1);
    assert.equal(removed.activeName, null, 'supprimer l’active quitte le mode');
    const removedOther = removeZoneOuting(withBoth, 'Samedi');
    assert.equal(removedOther.activeName, 'Dimanche', 'supprimer une inactive conserve l’active');

    // Nommage automatique sans collision.
    assert.equal(nextOutingName(withBoth.outings), 'Sortie');
    assert.equal(nextOutingName([createFriendOuting(7, 'Sortie', [], [], NOW)]), 'Sortie 2');
    assert.equal(
        nextOutingName([
            createFriendOuting(7, 'Sortie', [], [], NOW),
            createFriendOuting(7, 'sortie 2', [], [], NOW),
        ]),
        'Sortie 3',
        'la casse stockée ne libère pas le nom'
    );
}

// -------------------------------------------------- Lecture d'ensemble + migration

{
    assert.equal(normalizeZoneOutings(null, 7), null);
    assert.equal(normalizeZoneOutings({ zoneId: 8, outings: [] }, 7), null, 'autre zone : inexploitable');

    const a = createFriendOuting(7, 'Samedi', ['Alan'], [], NOW);
    const set = normalizeZoneOutings(
        { zoneId: 7, outings: [a, 'pourri', { zoneId: 7, name: '', friends: 'x' }], activeName: 'samedi' },
        7
    )!;
    assert.equal(set.outings.length, 1, 'entrées invalides et sorties sans nom écartées');
    assert.equal(set.activeName, 'samedi', 'activeName résolu sans casse');

    const dangling = normalizeZoneOutings(
        { zoneId: 7, outings: [a], activeName: 'fantôme' },
        7
    )!;
    assert.equal(dangling.activeName, null, 'une active absente de la liste retombe à null');

    // Migration : l'ancien format stockait la sortie elle-même à la clé.
    const legacy = normalizeZoneOutings(
        { zoneId: 7, friends: ['Alan'], gcCodes: ['GCAAA'], updatedAt: NOW() },
        7
    )!;
    assert.equal(legacy.outings.length, 1);
    assert.equal(legacy.outings[0].name, 'Sortie', 'une sortie anonyme hérite du nom par défaut');
    assert.equal(legacy.activeName, 'Sortie', 'elle était active : elle le reste');
    assert.deepEqual(legacy.outings[0].friends, ['Alan']);
}

// -------------------------------------------------- Persistance

void (async () => {
    const store = storage();
    assert.equal(await loadZoneOutings(store, 7), null, 'aucune sortie enregistrée');

    const outing = createFriendOuting(7, 'Samedi', ['Alan', 'Zoé'], ['GCAAA'], NOW);
    const set: ZoneOutings = { zoneId: 7, outings: [outing], activeName: 'Samedi' };
    await saveZoneOutings(store, set);
    assert.deepEqual(store.data.get(friendOutingStorageKey(7)), set, 'une clé par zone');

    const restored = await loadZoneOutings(store, 7);
    assert.deepEqual(restored, set, 'l’ensemble revient identique après un aller-retour par le stockage');
    assert.equal(await loadZoneOutings(store, 8), null, 'les sorties de la zone 7 ne fuient pas sur la zone 8');

    // L'ancien format écrit au même endroit migre à la lecture.
    await store.setData(friendOutingStorageKey(9), {
        zoneId: 9, friends: ['Alan'], gcCodes: [], updatedAt: NOW(),
    });
    const migrated = await loadZoneOutings(store, 9);
    assert.equal(migrated!.outings[0].name, 'Sortie', 'sortie d’avant les noms : migrée, pas perdue');

    await clearZoneOutings(store, 7);
    assert.equal(store.data.has(friendOutingStorageKey(7)), false, 'plus de sorties = plus d’entrée');
    assert.equal(await loadZoneOutings(store, 7), null);

    // Un stockage en panne dégrade en « pas de sortie » : la sortie est un confort.
    const broken = {
        getData: async () => { throw new Error('quota'); },
        setData: async () => { throw new Error('quota'); },
    } as any;
    assert.equal(await loadZoneOutings(broken, 7), null);
    await saveZoneOutings(broken, set);
    await clearZoneOutings(broken, 7);

    console.log('friend-outing-state: OK');
})();
