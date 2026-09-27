/**
 * Tests de l'export CSV de la matrice « qui a trouvé quoi » d'une sortie.
 *
 * Ce qui est vérifié : la même sémantique que la matrice visible — `oui`
 * (trouvaille connue), `non` (absence confirmée par une analyse à jour),
 * `?` (à vérifier). Le CSV ne doit jamais transformer un trou de données en
 * « non » : `nouvelle_pour` ne compte que les absences confirmées, le reste
 * part dans `a_verifier`.
 */

import * as assert from 'assert/strict';
import { outingMatrixCsv, OUTING_CELL_LABELS } from '../friend-outing-export';
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

/** Enlève le BOM et découpe en lignes. */
const lines = (csv: string): string[] => csv.replace(/^﻿/, '').trim().split('\r\n');

// -------------------------------------------------- En-tête et cellules

{
    const csv = outingMatrixCsv(
        [gc('GC1AAA'), gc('GC2BBB')],
        ['Alan', 'Bérénice'],
        { 'GC1AAA': ['Alan'], 'GC2BBB': [] },
        [scanned('Alan'), scanned('Bérénice')]
    );

    assert.equal(csv.charCodeAt(0), 0xFEFF, 'BOM UTF-8 pour Excel');
    const [header, row1, row2] = lines(csv);
    assert.equal(
        header,
        'gc_code;nom;type;difficulte;terrain;Alan;Bérénice;nouvelle_pour;a_verifier'
    );
    assert.equal(
        row1,
        'GC1AAA;Cache GC1AAA;traditional;2;1.5;oui;non;1;0',
        'trouvée par Alan, confirmée non trouvée par Bérénice'
    );
    assert.equal(
        row2,
        'GC2BBB;Cache GC2BBB;traditional;2;1.5;non;non;2;0',
        'nouvelle pour les deux amis analysés'
    );
}

// -------------------------------------------------- Inconnues vs faux négatifs

{
    const csv = outingMatrixCsv(
        [gc('GC9ZZZ')],
        ['Frais', 'Partiel', 'Vieux', 'Jamais'],
        {},
        [
            scanned('Frais'),
            scanned('Partiel', { truncated: true }),
            scanned('Vieux', { is_stale: true }),
            // 'Jamais' : aucune entrée de scan
        ]
    );
    const row = lines(csv)[1];
    assert.equal(
        row,
        'GC9ZZZ;Cache GC9ZZZ;traditional;2;1.5;non;?;?;?;1;3',
        'une seule absence confirmée, trois à vérifier'
    );
}

// -------------------------------------------------- Échappement

{
    const csv = outingMatrixCsv(
        [gc('GC3CCC', 'La "belle"; forêt\nverte')],
        ['Ami;PointVirgule'],
        {},
        []
    );
    const row = lines(csv)[1];
    assert.equal(
        row,
        'GC3CCC;"La ""belle""; forêt\nverte";traditional;2;1.5;?;0;1',
        'guillemets doublés, cellule encadrée si ; ou saut de ligne'
    );
    const header = lines(csv)[0];
    assert.ok(header.includes('"Ami;PointVirgule"'), 'pseudo avec ; encadré');
}

// -------------------------------------------------- Cas limites

{
    // Aucun ami : en-tête réduite aux colonnes fixes.
    const csv = outingMatrixCsv([gc('GC4DDD')], [], {}, []);
    const [header, row] = lines(csv);
    assert.equal(header, 'gc_code;nom;type;difficulte;terrain;nouvelle_pour;a_verifier');
    assert.equal(row, 'GC4DDD;Cache GC4DDD;traditional;2;1.5;0;0');

    // Aucune cache : seule l'en-tête.
    const empty = outingMatrixCsv([], ['Alan'], {}, []);
    assert.equal(lines(empty).length, 1);

    // Libellés stables.
    assert.deepEqual(OUTING_CELL_LABELS, { found: 'oui', not_found: 'non', unknown: '?' });
}

console.log('friend-outing-export: OK');
