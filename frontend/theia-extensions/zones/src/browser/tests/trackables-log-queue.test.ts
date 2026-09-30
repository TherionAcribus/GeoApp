/**
 * File « Loguer / Découvrir » du widget Trackables (lot 5.2) : parsing du collage
 * multi-codes, dédoublonnage, transitions persistées et règles de secret.
 *
 * Ce qui compte : un code de suivi n'apparaît jamais dans la persistance, le
 * rapport ou l'affichage ; un envoi interrompu revient « à vérifier », jamais
 * prêt à repartir.
 */
import * as assert from 'assert/strict';
import {
    TRACKABLE_LOG_TYPE_IDS,
    buildTrackableQueueReport,
    defaultTrackableLogType,
    isLikelyPublicCode,
    parseTrackableCodeTokens,
    queueItemDisplayCode,
    restoreQueueFromStorage,
    sanitizeQueueForStorage,
    trackableLogTypeNeedsGeocache,
    trackableLogTypeNeedsTrackingCode,
    trackableQueueCounts,
    TrackableQueueItem,
} from '../log-editor/trackables-log-queue';

function item(overrides: Partial<TrackableQueueItem>): TrackableQueueItem {
    return { key: 'k1', inputCode: 'X', status: 'pending', ...overrides };
}

/* ------------------------- parsing du collage ------------------------- */

function testParseTrackableCodeTokens(): void {
    // Codes publics sur plusieurs lignes, dédoublonnés.
    assert.deepEqual(
        parseTrackableCodeTokens('TB1A2B3\ntb1a2b3\nTB9ZYXW'),
        ['TB1A2B3', 'TB9ZYXW'],
    );
    // URLs coord.info et paramètre tracker= : le code porté est extrait.
    const pasted = [
        'https://www.geocaching.com/track/details.aspx?tracker=AB12CD',
        'https://coord.info/TB7XYZ',
        'https://www.geocaching.com/track/details.aspx?TB=TB4TEST',
    ].join('\n');
    assert.deepEqual(parseTrackableCodeTokens(pasted), ['AB12CD', 'TB7XYZ', 'TB4TEST']);
    // Jetons libres : 4–10 alphanumériques avec un chiffre ; les mots pleins non.
    assert.deepEqual(
        parseTrackableCodeTokens('voici les codes AF12CD et MOTO et T0'),
        ['AF12CD'],
    );
    // Ordre d'apparition conservé, pas de doublon même entre sources.
    assert.deepEqual(
        parseTrackableCodeTokens('TB5CODE https://coord.info/TB5CODE TB5CODE'),
        ['TB5CODE'],
    );
    assert.deepEqual(parseTrackableCodeTokens(''), []);
    assert.deepEqual(parseTrackableCodeTokens('aucun code ici…'), []);
}

function testDisplayCodeNeverLeaksSecret(): void {
    // Code public saisi : affiché en clair.
    assert.equal(queueItemDisplayCode(item({ inputCode: 'TB1A2B3' })), 'TB1A2B3');
    // Code de suivi saisi (sans TB) : jamais affiché en clair.
    assert.equal(queueItemDisplayCode(item({ inputCode: 'AB12CD' })), '(code saisi)');
    // Lookup résolu : le code public prend le relais.
    assert.equal(
        queueItemDisplayCode(item({ inputCode: 'AB12CD', reference_code: 'TB5XYZ' })),
        'TB5XYZ',
    );
    assert.equal(isLikelyPublicCode('TB1A2B3'), true);
    assert.equal(isLikelyPublicCode('AB12CD'), false);
    assert.equal(isLikelyPublicCode('tb8xyz'), true);
}

/* ----------------------------- types de log ---------------------------- */

function testLogTypeHelpers(): void {
    assert.equal(trackableLogTypeNeedsTrackingCode(TRACKABLE_LOG_TYPE_IDS.NOTE), false);
    assert.equal(trackableLogTypeNeedsTrackingCode(TRACKABLE_LOG_TYPE_IDS.DISCOVERED), true);
    assert.equal(trackableLogTypeNeedsTrackingCode(undefined), false);
    assert.equal(trackableLogTypeNeedsGeocache(TRACKABLE_LOG_TYPE_IDS.RETRIEVED), true);
    assert.equal(trackableLogTypeNeedsGeocache(TRACKABLE_LOG_TYPE_IDS.DISCOVERED), false);
}

function testDefaultTrackableLogType(): void {
    const allowed = [
        { id: TRACKABLE_LOG_TYPE_IDS.NOTE },
        { id: TRACKABLE_LOG_TYPE_IDS.RETRIEVED },
        { id: TRACKABLE_LOG_TYPE_IDS.DISCOVERED },
    ];
    // Action préremplie honorée quand le site l'autorise.
    assert.equal(defaultTrackableLogType(allowed, 'retrieve'), TRACKABLE_LOG_TYPE_IDS.RETRIEVED);
    assert.equal(defaultTrackableLogType(allowed, 'discover'), TRACKABLE_LOG_TYPE_IDS.DISCOVERED);
    // Action non proposée par le site : repli sur « Découvert ».
    assert.equal(
        defaultTrackableLogType(allowed.filter(t => t.id !== TRACKABLE_LOG_TYPE_IDS.RETRIEVED), 'retrieve'),
        TRACKABLE_LOG_TYPE_IDS.DISCOVERED,
    );
    // Ni action ni « Découvert » : premier type permis.
    assert.equal(
        defaultTrackableLogType([{ id: TRACKABLE_LOG_TYPE_IDS.NOTE }], 'discover'),
        TRACKABLE_LOG_TYPE_IDS.NOTE,
    );
    assert.equal(defaultTrackableLogType([], 'retrieve'), undefined);
}

/* -------------------------- compteurs d'états --------------------------- */

function testTrackableQueueCounts(): void {
    const counts = trackableQueueCounts([
        item({ key: 'a', status: 'pending' }),
        item({ key: 'b', status: 'ready' }),
        item({ key: 'c', status: 'submitting' }),
        item({ key: 'd', status: 'confirmed' }),
        item({ key: 'e', status: 'rejected' }),
        item({ key: 'f', status: 'unknown' }),
        item({ key: 'g', status: 'error' }),
    ]);
    assert.deepEqual(counts, {
        total: 7, ready: 1, submitting: 1, confirmed: 1,
        rejected: 1, unknown: 1, errors: 1, settled: 2,
    });
}

/* ------------------ persistance : jamais de code de suivi ---------------- */

function testSanitizeQueueForStorage(): void {
    const stored = sanitizeQueueForStorage([
        item({
            key: 'a', inputCode: 'SECRET9', reference_code: 'TB5XYZ',
            status: 'confirmed',
        }),
        item({ key: 'b', inputCode: 'RAWCODE', status: 'submitting' }),
        item({ key: 'c', inputCode: 'tb1a2b3', status: 'preflight' }),
    ]);
    // Aucun inputCode dans le stockage — la saisie brute (éventuel code de suivi) disparaît.
    const serialized = JSON.stringify(stored);
    assert.equal(serialized.includes('SECRET9'), false);
    assert.equal(serialized.includes('RAWCODE'), false);
    assert.equal(stored.some(s => (s as { inputCode?: string }).inputCode !== undefined), false);
    // 'submitting' persisté devient 'unknown' (résultat distant incertain).
    assert.equal(stored[1].status, 'unknown');
    assert.ok(stored[1].statusDetail?.includes('vérifier'));
    // 'preflight' repart en 'pending' (le préflight se relance au rétablissement).
    assert.equal(stored[2].status, 'pending');
}

function testRestoreQueueFromStorage(): void {
    const restored = restoreQueueFromStorage({
        version: 1,
        items: [
            { reference_code: 'TB5XYZ', status: 'confirmed' },
            { reference_code: 'TB9ABC', status: 'submitting' },
            { status: 'pending' }, // jamais résolu : la saisie brute n'a pas été stockée
            'not-an-object',
            { reference_code: 'TB1QRT', status: 'ready', logTypeId: 48 },
        ],
    });
    assert.equal(restored.length, 4);
    assert.equal(restored[0].status, 'confirmed');
    // Envoi interrompu → « à vérifier », jamais renvoyé silencieusement.
    assert.equal(restored[1].status, 'unknown');
    assert.ok(restored[1].statusDetail?.includes('vérifier'));
    // Élément non résolu : erreur explicite « ressaisir le code ».
    assert.equal(restored[2].status, 'error');
    assert.equal(restored[3].status, 'ready');
    assert.deepEqual(restoreQueueFromStorage('junk'), []);
    assert.deepEqual(restoreQueueFromStorage({ items: 'nope' }), []);
}

function testBuildTrackableQueueReportNoSecrets(): void {
    const report = buildTrackableQueueReport([
        item({ key: 'a', inputCode: 'SECRET9', reference_code: 'TB5XYZ', status: 'confirmed' }),
        item({ key: 'b', inputCode: 'TOPKEY1', status: 'rejected', statusDetail: 'Refusé.' }),
    ]);
    assert.equal(report.includes('TB5XYZ'), true);
    assert.equal(report.includes('SECRET9'), false);
    assert.equal(report.includes('TOPKEY1'), false);
    assert.equal(report.includes('(code non résolu)'), true);
}

/* -------------------------------- run ----------------------------------- */

function run(): void {
    testParseTrackableCodeTokens();
    testDisplayCodeNeverLeaksSecret();
    testLogTypeHelpers();
    testDefaultTrackableLogType();
    testTrackableQueueCounts();
    testSanitizeQueueForStorage();
    testRestoreQueueFromStorage();
    testBuildTrackableQueueReportNoSecrets();
    console.log('trackables-log-queue tests passed');
}

run();
