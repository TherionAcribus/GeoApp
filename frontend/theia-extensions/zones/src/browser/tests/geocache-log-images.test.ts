/**
 * Logique de sélection des photos à télécharger.
 *
 * Ce qui se teste ici est la question « que reste-t-il à faire pour ce log ? »,
 * pure et sans réseau. Le reste du service (file d'attente, mémoire des
 * tentatives) dépend de Theia et se vérifie à l'usage.
 */
import * as assert from 'assert/strict';
import { hasPendingImages, pendingImages } from '../geocache-log-images-service';
import { GeocacheLogDto, GeocacheLogImageDto } from '../geocache-logs-types';

function createImage(overrides: Partial<GeocacheLogImageDto> = {}): GeocacheLogImageDto {
    return {
        id: 1,
        geocache_log_id: 1,
        external_id: '103296230',
        display_url: null,
        source_url: 'https://img.geocaching.com/cache/log/large/abc.jpg',
        title: '',
        description: '',
        taken_at: '2026-09-07T00:00:00+00:00',
        stored: false,
        ...overrides,
    };
}

function createLog(overrides: Partial<GeocacheLogDto> = {}): GeocacheLogDto {
    return {
        id: 1,
        external_id: '1000001',
        author: 'GeoJoueur',
        text: 'Trouvée après dix minutes.',
        date: '2026-08-14T00:00:00+00:00',
        log_type: 'Found',
        is_favorite: false,
        created_at: '2026-08-14T00:00:00+00:00',
        ...overrides,
    };
}

function testALogWithoutImagesHasNothingPending(): void {
    assert.equal(hasPendingImages(createLog()), false);
    assert.equal(hasPendingImages(createLog({ images: [] })), false);
}

function testKnownButUnstoredImagesArePending(): void {
    const log = createLog({ images: [createImage(), createImage({ id: 2 })] });

    assert.equal(hasPendingImages(log), true);
    assert.equal(pendingImages(log).length, 2);
}

function testStoredImagesAreNotPending(): void {
    const log = createLog({
        images: [createImage({ stored: true, display_url: '/api/geocache-log-images/1/content' })],
    });

    assert.equal(hasPendingImages(log), false);
    assert.deepEqual(pendingImages(log), []);
}

function testAPartiallyStoredLogStaysPending(): void {
    // Une photo retirée de Geocaching.com échoue là où les autres passent :
    // le log doit continuer à proposer de réessayer.
    const log = createLog({
        images: [
            createImage({ id: 1, stored: true, display_url: '/api/geocache-log-images/1/content' }),
            createImage({ id: 2 }),
        ],
    });

    assert.equal(hasPendingImages(log), true);
    assert.deepEqual(pendingImages(log).map(image => image.id), [2]);
}

testALogWithoutImagesHasNothingPending();
testKnownButUnstoredImagesArePending();
testStoredImagesAreNotPending();
testAPartiallyStoredLogStaysPending();

console.log('geocache-log-images tests passed');
