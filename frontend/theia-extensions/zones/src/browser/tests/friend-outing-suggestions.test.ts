/**
 * Tests des suggestions de caches pour une sortie : les caches nouvelles pour
 * le plus d'amis emmenés remontent en tête, et une absence ne compte que si
 * la couverture de l'ami est à jour — jamais sur un scan tronqué ou absent.
 */

import * as assert from 'assert/strict';
import { outingSuggestions } from '../friend-outing-suggestions';
import type { Geocache } from '../geocaches-table';
import type { FriendZoneScanEntry } from '../friends-types';

const gc = (code: string, name = `Cache ${code}`): Geocache => ({
    id: 1,
    gc_code: code,
    name,
    owner: null,
    cache_type: 'traditional',
    difficulty: 2,
    terrain: 1.5,
    size: 'small',
    solved: '',
    found: false,
    favorites_count: 0,
    hidden_date: null,
});

const scanned = (friend: string, over: Partial<FriendZoneScanEntry> = {}): FriendZoneScanEntry => ({
    friend,
    scanned: true,
    is_stale: false,
    truncated: false,
    found_count: 1,
    zone_matches: 1,
    scanned_at: '2026-09-05T08:00:00+00:00',
    ...over,
});

// -------------------------------------------------- Tri et contenu

{
    const rows = [gc('GC1AAA'), gc('GC2BBB'), gc('GC3CCC'), gc('GC4DDD')];
    const friends = ['Alan', 'Bérénice', 'Chloé'];
    const finds = {
        // Alan et Bérénice ont trouvé GC1 ; Chloé a trouvé GC2 ;
        // GC3 trouvée par tous ; GC4 par personne.
        'GC1AAA': ['Alan', 'Bérénice'],
        'GC2BBB': ['Chloé'],
        'GC3CCC': ['Alan', 'Bérénice', 'Chloé'],
    };
    const scans = friends.map(f => scanned(f));

    const result = outingSuggestions(rows, friends, finds, scans);
    assert.equal(result.length, 3, 'GC3 (trouvée par tous) exclue');
    assert.equal(result[0].geocache.gc_code, 'GC4DDD', 'nouvelle pour les 3 en tête');
    assert.deepEqual(result[0].newFor, friends);
    assert.equal(result[1].geocache.gc_code, 'GC2BBB', 'nouvelle pour 2');
    assert.equal(result[2].geocache.gc_code, 'GC1AAA', 'nouvelle pour 1');
    assert.deepEqual(result[1].foundBy, ['Chloé']);
    assert.deepEqual(result[2].foundBy, ['Alan', 'Bérénice']);
}

// -------------------------------------------------- Le doute ne gonfle pas le score

{
    // 'Douteux' n'est jamais scanné : il doit tomber dans toCheck, pas newFor.
    const result = outingSuggestions(
        [gc('GC5EEE')],
        ['Frais', 'Douteux'],
        {},
        [scanned('Frais')]
    );
    assert.equal(result.length, 1);
    assert.deepEqual(result[0].newFor, ['Frais']);
    assert.deepEqual(result[0].toCheck, ['Douteux'], 'absence non vérifiable, pas « nouvelle »');
}

{
    // À nombre de « nouvelle pour » égal, la cache sans doute passe devant —
    // même si l'ordre alphabétique la placerait après.
    const result = outingSuggestions(
        [gc('GC6FFF', 'AAA incertaine'), gc('GC7GGG', 'ZZZ fiable')],
        ['Alan', 'Douteux'],
        { 'GC7GGG': ['Douteux'] },
        [scanned('Alan'), scanned('Douteux', { truncated: true })]
    );
    // GC7 : « nouvelle pour Alan », Douteux l'a déjà trouvée (preuve du log,
    // fiable même sur scan tronqué) → toCheck vide.
    // GC6 : « nouvelle pour Alan », Douteux invérifiable → toCheck = 1.
    assert.equal(result.length, 2);
    assert.equal(result[0].geocache.gc_code, 'GC7GGG', 'sans doute d\'abord');
    assert.deepEqual(result[0].toCheck, []);
    assert.equal(result[1].geocache.gc_code, 'GC6FFF');
    assert.deepEqual(result[1].toCheck, ['Douteux']);
}

// -------------------------------------------------- Cas limites

{
    assert.deepEqual(outingSuggestions([], ['Alan'], {}, []), [], 'pas de cache');
    assert.deepEqual(outingSuggestions([gc('GC8HHH')], [], {}, []), [], 'pas d\'ami');
    assert.deepEqual(
        outingSuggestions([gc('GC9III')], ['Alan'], {}, []),
        [],
        'ami jamais analysé : aucune absence confirmée, pas de suggestion'
    );
}

console.log('friend-outing-suggestions: OK');
