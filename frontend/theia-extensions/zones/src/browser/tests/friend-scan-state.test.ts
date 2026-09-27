/**
 * Tests du modèle « couverture d'analyse » d'un ami sur une zone.
 *
 * Ce qui est vérifié : une absence de trouvaille n'est une information
 * exploitable (« pas trouvée ») que si l'analyse de l'ami est complète et à
 * jour. Jamais analysé, scan tronqué ou obsolète — la matrice doit répondre
 * « inconnu », pas affirmer un faux négatif.
 */

import * as assert from 'assert/strict';
import {
    coverageLabel,
    coverageReliable,
    friendFindCell,
    scanCoverage,
} from '../friend-scan-state';
import type { FriendZoneScanEntry } from '../friends-types';

const scanned = (over: Partial<FriendZoneScanEntry> = {}): FriendZoneScanEntry => ({
    friend: 'Alan',
    scanned: true,
    is_stale: false,
    truncated: false,
    found_count: 2,
    zone_matches: 2,
    scanned_at: '2026-09-05T08:00:00+00:00',
    ...over,
});

// -------------------------------------------------- Couverture

{
    assert.equal(scanCoverage(undefined), 'unscanned', 'aucune entrée = jamais analysé');
    assert.equal(scanCoverage(scanned({ scanned: false })), 'unscanned');
    assert.equal(scanCoverage(scanned()), 'fresh');
    assert.equal(
        scanCoverage(scanned({ truncated: true })),
        'partial',
        'un scan tronqué reste partiel même récent'
    );
    assert.equal(
        scanCoverage(scanned({ truncated: true, is_stale: true })),
        'partial',
        'le backend marque aussi is_stale : la cause première reste « partielle »'
    );
    assert.equal(scanCoverage(scanned({ is_stale: true })), 'stale');
}

// -------------------------------------------------- Fiabilité d'une absence

{
    assert.equal(coverageReliable('fresh'), true);
    assert.equal(coverageReliable('partial'), false);
    assert.equal(coverageReliable('stale'), false);
    assert.equal(coverageReliable('unscanned'), false);

    // Cellules de la matrice ami × cache.
    assert.equal(friendFindCell(true, 'fresh'), 'found', 'une trouvaille connue est trouvée');
    assert.equal(
        friendFindCell(true, 'unscanned'),
        'found',
        'une trouvaille connue reste trouvée même sans analyse (preuve du log)'
    );
    assert.equal(
        friendFindCell(false, 'fresh'),
        'not_found',
        'analyse complète + aucune trouvaille = vrai négatif'
    );
    assert.equal(
        friendFindCell(false, 'unscanned'),
        'unknown',
        'jamais analysé : l’absence n’est pas une information'
    );
    assert.equal(friendFindCell(false, 'partial'), 'unknown', 'scan tronqué : à vérifier');
    assert.equal(friendFindCell(false, 'stale'), 'unknown', 'scan obsolète : à vérifier');
}

// -------------------------------------------------- Libellés

{
    assert.equal(coverageLabel('fresh'), 'à jour');
    assert.equal(coverageLabel('partial'), 'partielle');
    assert.equal(coverageLabel('stale'), 'obsolète');
    assert.equal(coverageLabel('unscanned'), 'non analysé');
}

console.log('friend-scan-state: OK');
