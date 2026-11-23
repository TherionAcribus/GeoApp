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
    TRACKABLE_LOG_TYPE_FALLBACK_LABELS,
    TRACKABLE_LOG_TYPE_IDS,
    applyQueueLogType,
    buildTrackableQueueCsv,
    buildTrackableQueueReport,
    defaultRetrieveGeocacheCode,
    defaultTrackableLogType,
    isLikelyPublicCode,
    parseTrackableCodeTokens,
    queueItemDisplayCode,
    queueItemOriginLabel,
    queueLogDateError,
    queueLogDateHint,
    restoreQueueFromStorage,
    restoredQueueLogDate,
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

function testDefaultRetrieveGeocacheCode(): void {
    // Rien de saisi : la cache où le site situe le TB, normalisée.
    assert.equal(defaultRetrieveGeocacheCode(undefined, 'gc1e51'), 'GC1E51');
    assert.equal(defaultRetrieveGeocacheCode('  ', 'GC1E51'), 'GC1E51');
    // Saisie ou fiche cache : prioritaire, même en désaccord (le backend signale le conflit).
    assert.equal(defaultRetrieveGeocacheCode('GC2F62', 'GC1E51'), 'GC2F62');
    // TB en main ou chez quelqu'un : rien à proposer.
    assert.equal(defaultRetrieveGeocacheCode(undefined, null), undefined);
    assert.equal(defaultRetrieveGeocacheCode(undefined, 'PR-UTILISATEUR'), undefined);
}

function testLogTypeLabelsMirrorBackend(): void {
    // Miroir de TRACKABLE_LOG_TYPE_LABELS (backend) : 15 et 16 étaient décalés, 74 n'est pas un type TB.
    assert.equal(TRACKABLE_LOG_TYPE_FALLBACK_LABELS[15], 'Transféré');
    assert.equal(TRACKABLE_LOG_TYPE_FALLBACK_LABELS[16], 'Marqué manquant');
    assert.equal(TRACKABLE_LOG_TYPE_FALLBACK_LABELS[74], undefined);
    assert.deepEqual(
        Object.keys(TRACKABLE_LOG_TYPE_FALLBACK_LABELS).map(Number),
        [4, 5, 13, 14, 15, 16, 19, 48, 69, 70, 75],
    );
    // L'export CSV nomme le type envoyé avec ces libellés (« Transféré » sortait pour un 16).
    const csv = buildTrackableQueueCsv([
        item({ key: 'a', inputCode: 'TB5XYZ', reference_code: 'TB5XYZ', status: 'confirmed', logTypeId: 16 }),
    ]);
    assert.ok(csv.split('\n')[1].includes(';Marqué manquant;'), csv);
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

function testPreferredActionStaysOnItsItem(): void {
    // L'action d'une fiche cache et sa cache (publiques) survivent à la reprise…
    const [stored] = sanitizeQueueForStorage([item({
        inputCode: 'TB5XYZ', reference_code: 'TB5XYZ', status: 'ready',
        preferredAction: 'retrieve', geocacheCode: 'GC1E51',
    })]);
    assert.equal(stored.preferredAction, 'retrieve');
    assert.equal(stored.geocacheCode, 'GC1E51');
    const [restored] = restoreQueueFromStorage({ version: 1, items: [stored] });
    assert.equal(restored.preferredAction, 'retrieve');
    assert.equal(restored.geocacheCode, 'GC1E51');
    // …et l'origine se lit sur la ligne de l'élément, pas dans un bandeau global.
    assert.equal(queueItemOriginLabel(restored), 'retirer (fiche GC1E51)');
    assert.equal(queueItemOriginLabel(item({ preferredAction: 'discover' })), 'découvrir (fiche cache)');
    assert.equal(queueItemOriginLabel(item({ preferredAction: 'log' })), undefined);
    assert.equal(queueItemOriginLabel(item({})), undefined);
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

/* --------------------------- date du log ------------------------------ */

function testRestoredQueueLogDate(): void {
    const today = '2026-11-23';
    const unsent = [item({ status: 'confirmed' }), item({ status: 'ready' })];
    // File en cours : la date d'une sortie passée est reprise.
    assert.equal(restoredQueueLogDate('2026-11-16', unsent, today), '2026-11-16');
    for (const status of ['pending', 'rejected', 'error'] as const) {
        assert.equal(restoredQueueLogDate('2026-11-16', [item({ status })], today), '2026-11-16');
    }
    // File terminée (confirmés, à vérifier) ou vide : retour à aujourd'hui.
    const done = [item({ status: 'confirmed' }), item({ status: 'unknown' })];
    assert.equal(restoredQueueLogDate('2026-11-16', done, today), today);
    assert.equal(restoredQueueLogDate('2026-11-16', [], today), today);
    // Date future, illisible, hors calendrier ou absente : jamais reprise.
    assert.equal(restoredQueueLogDate('2026-11-24', unsent, today), today);
    assert.equal(restoredQueueLogDate('23/11/2026', unsent, today), today);
    assert.equal(restoredQueueLogDate('2026-02-31', unsent, today), today);
    assert.equal(restoredQueueLogDate('', unsent, today), today);
    assert.equal(restoredQueueLogDate(undefined, unsent, today), today);
}

function testQueueLogDateHintAndError(): void {
    const today = '2026-11-23';
    assert.deepEqual(queueLogDateHint(today, today), { label: "aujourd'hui", tone: 'info' });
    assert.deepEqual(queueLogDateHint('2026-11-22', today), { label: 'hier', tone: 'info' });
    assert.deepEqual(queueLogDateHint('2026-11-17', today), { label: 'il y a 6 jours', tone: 'warn' });
    assert.deepEqual(queueLogDateHint('2026-11-24', today), { label: 'demain !', tone: 'error' });
    assert.deepEqual(queueLogDateHint('2026-12-03', today), { label: 'dans 10 jours !', tone: 'error' });
    // Changement d'heure (29 mars) : l'écart reste un nombre entier de jours.
    assert.deepEqual(queueLogDateHint('2026-03-28', '2026-03-30'), { label: 'il y a 2 jours', tone: 'warn' });
    assert.equal(queueLogDateHint('', today), undefined);
    assert.deepEqual(queueLogDateHint('2026-02-31', today), { label: 'date invalide', tone: 'error' });

    assert.equal(queueLogDateError(today, today), undefined);
    assert.equal(queueLogDateError('2026-11-01', today), undefined);
    assert.ok(queueLogDateError('2026-11-24', today)?.includes('futur'));
    assert.ok(queueLogDateError('', today));
    assert.ok(queueLogDateError('2026-02-31', today));
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

function testBuildTrackableQueueCsv(): void {
    const csv = buildTrackableQueueCsv([
        item({
            key: 'a', inputCode: 'SECRET9', reference_code: 'TB5XYZ',
            name: 'Un "nom", avec; virgule', status: 'confirmed',
            logTypeId: TRACKABLE_LOG_TYPE_IDS.DISCOVERED, geocacheCode: 'GC123',
        }),
        item({ key: 'b', inputCode: 'TOPKEY1', status: 'rejected', statusDetail: 'Refusé\nlà' }),
    ]);
    const lines = csv.split('\n');
    assert.equal(lines[0], 'reference_code;name;status;status_detail;log_type;geocache;trackable_url');
    assert.equal(lines[1], 'TB5XYZ;"Un ""nom"", avec; virgule";confirmed;;Découvert;GC123;');
    // Le détail multi-lignes est protégé par les guillemets (il coupe le split
    // naïf mais reste un seul champ CSV) ; le code de suivi n'apparaît jamais.
    assert.equal(lines[2], ';;rejected;"Refusé');
    assert.ok(csv.includes('"Refusé\nlà"'));
    assert.equal(csv.includes('SECRET9'), false);
    assert.equal(csv.includes('TOPKEY1'), false);
}

function testApplyQueueLogType(): void {
    const result = applyQueueLogType([
        item({ key: 'a', status: 'ready', allowed_log_types: [{ id: 4, label: '' }, { id: 48, label: '' }] }),
        item({ key: 'b', status: 'ready', allowed_log_types: [{ id: 4, label: '' }] }),
        item({ key: 'c', status: 'confirmed' }),
        item({ key: 'd', status: 'ready' }), // allowed_log_types inconnu : ignoré
    ], TRACKABLE_LOG_TYPE_IDS.DISCOVERED);
    assert.equal(result.updated, 1);
    assert.equal(result.skipped, 1);
    assert.equal(result.items[0].logTypeId, TRACKABLE_LOG_TYPE_IDS.DISCOVERED);
    assert.equal(result.items[1].logTypeId, undefined);
    assert.equal(result.items[2].status, 'confirmed');
    // Les objets non modifiés restent identiques (copie superficielle du tableau).
    assert.equal(result.items[3].key, 'd');
}

/* -------------------------------- run ----------------------------------- */

function run(): void {
    testParseTrackableCodeTokens();
    testDisplayCodeNeverLeaksSecret();
    testLogTypeHelpers();
    testDefaultTrackableLogType();
    testDefaultRetrieveGeocacheCode();
    testLogTypeLabelsMirrorBackend();
    testTrackableQueueCounts();
    testSanitizeQueueForStorage();
    testPreferredActionStaysOnItsItem();
    testRestoreQueueFromStorage();
    testRestoredQueueLogDate();
    testQueueLogDateHintAndError();
    testBuildTrackableQueueReportNoSecrets();
    testBuildTrackableQueueCsv();
    testApplyQueueLogType();
    console.log('trackables-log-queue tests passed');
}

run();
