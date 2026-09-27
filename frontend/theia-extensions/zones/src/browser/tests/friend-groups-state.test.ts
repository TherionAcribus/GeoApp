/**
 * Tests du modèle « groupes d'amis réutilisables ».
 *
 * Ce qui est vérifié : normalisation de données de stockage incertaines,
 * remplacement insensible à la casse, dédoublonnage des membres et limite de
 * groupes. Ces groupes pilotent les amis emmenés d'une sortie : un bug ici
 * changerait silencieusement qui est emmené.
 */

import * as assert from 'assert/strict';
import {
    FRIEND_GROUPS_MAX,
    findFriendGroup,
    FriendGroup,
    normalizeFriendGroups,
    removeFriendGroup,
    upsertFriendGroup,
} from '../friend-groups-state';

const group = (name: string, friends: string[] = []): FriendGroup => ({
    name,
    friends,
    updatedAt: '2026-09-05T08:00:00+00:00',
});

// -------------------------------------------------- Normalisation du stockage

{
    assert.deepEqual(normalizeFriendGroups(undefined), [], 'pas de donnée = aucun groupe');
    assert.deepEqual(normalizeFriendGroups('junk'), [], 'un non-tableau est ignoré');
}

{
    const out = normalizeFriendGroups([
        { name: 'Samedi', friends: ['Bob', 'Alan', 'Alan'] },
        { name: '  ', friends: ['X'] },            // nom vide : ignoré
        { name: 'samedi', friends: ['Zoé'] },      // doublon insensible à la casse : ignoré
        'junk',                                     // non-objet : ignoré
        { name: 'Famille', friends: 'oops' },      // friends invalide : liste vide
    ]);
    assert.deepEqual(out.map(g => g.name), ['Famille', 'Samedi'], 'tri par nom');
    const samedi = out.find(g => g.name === 'Samedi')!;
    assert.deepEqual(samedi.friends, ['Alan', 'Bob'], 'membres dédoublonnés et triés');
    const famille = out.find(g => g.name === 'Famille')!;
    assert.deepEqual(famille.friends, []);
}

// -------------------------------------------------- upsert

{
    const groups = [group('Samedi', ['Alan'])];
    const next = upsertFriendGroup(groups, 'Dimanche', ['Zoé', 'Bob']);
    assert.ok(next);
    assert.deepEqual(next!.map(g => g.name), ['Dimanche', 'Samedi']);
    assert.deepEqual(next![0].friends, ['Bob', 'Zoé'], 'membres triés');

    // Même nom (casse différente) : remplacement, pas doublon.
    const replaced = upsertFriendGroup(groups, 'SAMEDI', ['Zoé']);
    assert.ok(replaced);
    assert.equal(replaced!.length, 1);
    assert.equal(replaced![0].name, 'SAMEDI', 'le nom saisi devient la référence');
    assert.deepEqual(replaced![0].friends, ['Zoé']);

    assert.equal(upsertFriendGroup(groups, '   ', ['Alan']), null, 'nom vide refusé');

    const full = Array.from({ length: FRIEND_GROUPS_MAX }, (_, i) => group(`G${i}`));
    assert.equal(
        upsertFriendGroup(full, 'encore-un', ['Alan']),
        null,
        'la limite bloque une création'
    );
    assert.ok(
        upsertFriendGroup(full, 'G0', ['Alan']),
        'la limite ne bloque pas le remplacement'
    );
}

// -------------------------------------------------- Suppression et recherche

{
    const groups = [group('Samedi'), group('Dimanche')];
    assert.deepEqual(removeFriendGroup(groups, 'SAMEDI').map(g => g.name), ['Dimanche']);
    assert.equal(removeFriendGroup(groups, 'inconnu').length, 2);

    assert.equal(findFriendGroup(groups, 'dimanche')?.name, 'Dimanche');
    assert.equal(findFriendGroup(groups, 'inconnu'), undefined);
}

console.log('friend-groups-state: OK');
