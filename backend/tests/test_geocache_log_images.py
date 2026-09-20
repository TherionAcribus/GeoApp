"""
Photos jointes aux logs : lecture du logbook, persistance, stockage, service.

Le sujet de ces tests est la séparation entre **connaître** une photo et la
**stocker** : le rafraîchissement n'écrit que des métadonnées, et les octets ne
descendent sur disque que sur demande. C'est ce découpage qui permet à la
préférence de couper réellement le trafic vers Geocaching.com, et non seulement
l'écriture disque.

La fixture `Images` reproduit une réponse réelle du logbook : `ImageUrl` y est
nul (c'est le cas sur toutes les photos observées), donc l'URL se reconstruit à
partir de `FileName` seul.
"""
from __future__ import annotations

import json

import pytest

from gc_backend import create_app
from gc_backend.database import db
from gc_backend.geocaches import image_storage
from gc_backend.geocaches.models import Geocache, GeocacheLog, GeocacheLogImage
from gc_backend.models import Zone
from gc_backend.services.geocaching_logs import (
    GeocachingLogsClient,
    build_log_image_url,
)


CACHE_PAGE = "<html><script>var userToken = 'TOKEN123';</script></html>"

# Un JPEG minimal : `detect_image_mime_type` reconnaît le format par ses octets
# de tête, pas par le Content-Type annoncé.
JPEG_BYTES = b'\xff\xd8\xff\xe0' + b'0' * 64


def _image_entry(image_id: int, log_id: int, *, name: str = '', file_name: str | None = None) -> dict:
    guid = f'{image_id:08d}-0000-4000-8000-000000000000'
    return {
        'ImageID': image_id,
        'ImageGuid': guid,
        'Name': name,
        'Descr': '',
        'FileName': file_name if file_name is not None else f'{guid}.jpg',
        'Created': '09/07/2026',
        'LogID': log_id,
        'CacheID': 4158,
        'ImageUrl': None,
    }


def _log_entry(log_id: int, images: list[dict] | None = None) -> dict:
    return {
        'LogID': log_id,
        'LogGuid': f'guid-{log_id}',
        'LogType': 'Found it',
        'LogText': f'<p>Log {log_id}</p>',
        'Created': '07/26/2026',
        'Visited': '07/26/2026',
        'UserName': f'joueur{log_id}',
        'AccountGuid': f'acc-{log_id}',
        'FavoritePointUsed': False,
        'Images': images if images is not None else [],
    }


class _FakeResponse:
    def __init__(self, *, text: str = '', payload: dict | None = None):
        self.text = text if payload is None else json.dumps(payload)
        self._payload = payload
        self.status_code = 200

    def raise_for_status(self) -> None:
        return None

    def json(self):
        return self._payload


class _LogbookSession:
    """Rejoue un logbook dont on choisit les logs, photos comprises."""

    def __init__(self, logs: list[dict]):
        self.logs = logs

    def get(self, url: str, params=None, headers=None, timeout=None):
        if 'geocache/' in url:
            return _FakeResponse(text=CACHE_PAGE)

        params = params or {}
        if params.get('sf') == 'true' or params.get('sp') == 'true':
            return _FakeResponse(payload={'status': 'success', 'data': []})

        return _FakeResponse(payload={
            'status': 'success',
            'data': self.logs,
            'pageInfo': {'idx': 1, 'size': len(self.logs), 'rows': len(self.logs),
                         'totalRows': len(self.logs)},
        })


@pytest.fixture
def app(tmp_path, monkeypatch):
    # Les photos sont écrites dans un dossier jetable : un test ne doit jamais
    # toucher `backend/data/log_images`, où vivent les vraies photos.
    #
    # Les **deux** modules sont à patcher, et ce n'est pas une redondance : le
    # blueprint fait `from ...image_storage import get_log_images_root_dir`, donc
    # il garde sa propre référence vers la fonction d'origine. Ne patcher que
    # `image_storage` ferait écrire les fichiers dans le vrai dossier tout en
    # les cherchant dans le dossier jetable.
    import gc_backend.blueprints.logs as logs_blueprint
    fake_root = lambda: tmp_path / 'log_images'  # noqa: E731
    monkeypatch.setattr(image_storage, 'get_log_images_root_dir', fake_root)
    monkeypatch.setattr(logs_blueprint, 'get_log_images_root_dir', fake_root)

    app = create_app()
    app.config['TESTING'] = True
    app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///:memory:'

    with app.app_context():
        db.create_all()
        zone = Zone(name='Z1')
        db.session.add(zone)
        db.session.flush()
        geocache = Geocache(gc_code='GC12345', name='Test', type='Traditional', zone_id=zone.id)
        db.session.add(geocache)
        db.session.flush()
        app.geocache_id = geocache.id
        yield app
        db.session.remove()
        db.drop_all()


def _patch_client(monkeypatch, session):
    import gc_backend.blueprints.logs as logs_blueprint
    monkeypatch.setattr(
        logs_blueprint, 'GeocachingLogsClient',
        lambda: GeocachingLogsClient(session=session)
    )


def _patch_download(monkeypatch, *, content=JPEG_BYTES, status=200, fail_on=None):
    """Remplace le téléchargement réel ; `fail_on` fait échouer une URL précise."""
    import gc_backend.blueprints.logs as logs_blueprint
    calls: list[str] = []

    def fake_download(source_url, *args, **kwargs):
        calls.append(source_url)
        if fail_on and fail_on in source_url:
            raise ValueError('Image is too large')
        return content, 'image/jpeg', status

    monkeypatch.setattr(logs_blueprint, 'download_image', fake_download)
    return calls


# --------------------------------------------------------------- Le parseur


def test_log_image_url_is_built_from_the_file_name():
    """`ImageUrl` étant toujours nul, `FileName` est la seule source."""
    assert build_log_image_url('abc.jpg') == 'https://img.geocaching.com/cache/log/large/abc.jpg'


@pytest.mark.parametrize('file_name', ['', None, '../secret.jpg', 'a/b.jpg', 'a\\b.jpg'])
def test_log_image_url_rejects_unusable_file_names(file_name):
    """Le nom finit dans une URL téléchargée par le serveur : pas de traversée."""
    assert build_log_image_url(file_name) is None


def test_parser_reads_images_attached_to_a_log():
    session = _LogbookSession([_log_entry(1, [_image_entry(11, 1, name='Le site')])])

    result = GeocachingLogsClient(session=session).fetch_logbook('GC12345', count=10)

    images = result.logs[0].images
    assert len(images) == 1
    assert images[0].external_id == '11'
    assert images[0].title == 'Le site'
    assert images[0].source_url.endswith('.jpg')
    assert images[0].source_url.startswith('https://img.geocaching.com/cache/log/large/')
    assert images[0].taken_at is not None


def test_parser_skips_an_unusable_image_without_losing_the_log():
    """Le texte reste la donnée principale : une photo illisible ne l'emporte pas."""
    session = _LogbookSession([
        _log_entry(1, [_image_entry(11, 1, file_name=''), _image_entry(12, 1)])
    ])

    result = GeocachingLogsClient(session=session).fetch_logbook('GC12345', count=10)

    assert len(result.logs) == 1
    assert [image.external_id for image in result.logs[0].images] == ['12']


def test_parser_tolerates_logs_without_images():
    """Le cas de loin le plus fréquent, et celui des fixtures existantes."""
    session = _LogbookSession([_log_entry(1), _log_entry(2, [])])

    result = GeocachingLogsClient(session=session).fetch_logbook('GC12345', count=10)

    assert all(log.images == [] for log in result.logs)


# ----------------------------------------------------------- La persistance


def test_refresh_records_image_metadata_without_downloading(app, monkeypatch):
    """Le rafraîchissement doit rester gratuit : aucune image ne part au réseau."""
    session = _LogbookSession([_log_entry(1, [_image_entry(11, 1), _image_entry(12, 1)])])
    _patch_client(monkeypatch, session)
    downloads = _patch_download(monkeypatch)

    response = app.test_client().post(f'/api/geocaches/{app.geocache_id}/logs/refresh')

    assert response.status_code == 200
    assert response.json['images_added'] == 2
    assert downloads == []

    images = GeocacheLogImage.query.filter_by(geocache_id=app.geocache_id).all()
    assert len(images) == 2
    assert all(image.stored is False for image in images)


def test_refresh_twice_does_not_duplicate_images(app, monkeypatch):
    session = _LogbookSession([_log_entry(1, [_image_entry(11, 1)])])
    _patch_client(monkeypatch, session)
    client = app.test_client()

    client.post(f'/api/geocaches/{app.geocache_id}/logs/refresh')
    second = client.post(f'/api/geocaches/{app.geocache_id}/logs/refresh')

    assert second.json['images_added'] == 0
    assert GeocacheLogImage.query.filter_by(geocache_id=app.geocache_id).count() == 1


def test_stored_image_survives_its_disappearance_from_geocaching(app, monkeypatch):
    """
    Une photo retirée de Geocaching.com reste consultable en local : c'est
    précisément l'intérêt d'un stockage hors ligne.
    """
    _patch_client(monkeypatch, _LogbookSession([_log_entry(1, [_image_entry(11, 1)])]))
    client = app.test_client()
    client.post(f'/api/geocaches/{app.geocache_id}/logs/refresh')

    _patch_client(monkeypatch, _LogbookSession([_log_entry(1, [])]))
    client.post(f'/api/geocaches/{app.geocache_id}/logs/refresh')

    assert GeocacheLogImage.query.filter_by(geocache_id=app.geocache_id).count() == 1


def test_log_dto_exposes_its_images(app, monkeypatch):
    _patch_client(monkeypatch, _LogbookSession([_log_entry(1, [_image_entry(11, 1)])]))
    client = app.test_client()
    client.post(f'/api/geocaches/{app.geocache_id}/logs/refresh')

    response = client.get(f'/api/geocaches/{app.geocache_id}/logs')

    image = response.json['logs'][0]['images'][0]
    assert image['stored'] is False
    # Tant que la photo n'est pas sur disque, rien ne doit pouvoir l'afficher :
    # c'est ce qui donne son sens à la préférence de téléchargement.
    assert image['display_url'] is None
    assert image['source_url'].startswith('https://img.geocaching.com/')


# --------------------------------------------------------------- Le stockage


def _refresh_with_one_image(app, monkeypatch, images=None):
    _patch_client(monkeypatch, _LogbookSession([
        _log_entry(1, images if images is not None else [_image_entry(11, 1)])
    ]))
    app.test_client().post(f'/api/geocaches/{app.geocache_id}/logs/refresh')
    return GeocacheLog.query.filter_by(geocache_id=app.geocache_id).first()


def test_store_downloads_writes_and_serves_the_file(app, monkeypatch):
    log = _refresh_with_one_image(app, monkeypatch)
    _patch_download(monkeypatch)
    client = app.test_client()

    stored = client.post(f'/api/geocaches/{app.geocache_id}/logs/{log.id}/images/store')

    assert stored.status_code == 200
    assert stored.json['stored'] == 1
    dto = stored.json['images'][0]
    assert dto['stored'] is True
    assert dto['display_url'] == f"/api/geocache-log-images/{dto['id']}/content"
    assert dto['mime_type'] == 'image/jpeg'

    content = client.get(dto['display_url'])
    assert content.status_code == 200
    assert content.data == JPEG_BYTES


def test_store_is_replayable_and_skips_what_is_already_stored(app, monkeypatch):
    log = _refresh_with_one_image(app, monkeypatch)
    downloads = _patch_download(monkeypatch)
    client = app.test_client()

    client.post(f'/api/geocaches/{app.geocache_id}/logs/{log.id}/images/store')
    second = client.post(f'/api/geocaches/{app.geocache_id}/logs/{log.id}/images/store')

    assert second.json['stored'] == 0
    assert len(downloads) == 1


def test_one_failing_image_does_not_sink_the_others(app, monkeypatch):
    """Une photo retirée du site ne doit pas emporter les autres photos du log."""
    log = _refresh_with_one_image(app, monkeypatch, images=[
        _image_entry(11, 1), _image_entry(12, 1),
    ])
    failing = GeocacheLogImage.query.filter_by(external_id='11').first().source_url
    _patch_download(monkeypatch, fail_on=failing.rsplit('/', 1)[-1])

    response = app.test_client().post(
        f'/api/geocaches/{app.geocache_id}/logs/{log.id}/images/store'
    )

    assert response.status_code == 200
    assert response.json['stored'] == 1
    assert len(response.json['failed']) == 1


def test_store_rejects_a_log_from_another_geocache(app, monkeypatch):
    log = _refresh_with_one_image(app, monkeypatch)
    _patch_download(monkeypatch)

    response = app.test_client().post(f'/api/geocaches/999999/logs/{log.id}/images/store')

    assert response.status_code == 404


def test_content_refuses_a_stored_path_escaping_the_root(app, monkeypatch):
    """`stored_path` vient de la base : corrompu, il ne doit rien servir."""
    log = _refresh_with_one_image(app, monkeypatch)
    _patch_download(monkeypatch)
    client = app.test_client()
    stored = client.post(f'/api/geocaches/{app.geocache_id}/logs/{log.id}/images/store')

    image = GeocacheLogImage.query.get(stored.json['images'][0]['id'])
    image.stored_path = '../../../../etc/passwd'
    db.session.commit()

    assert client.get(f'/api/geocache-log-images/{image.id}/content').status_code == 400


def test_content_is_404_while_the_image_is_only_known(app, monkeypatch):
    _refresh_with_one_image(app, monkeypatch)
    image = GeocacheLogImage.query.filter_by(geocache_id=app.geocache_id).first()

    assert app.test_client().get(f'/api/geocache-log-images/{image.id}/content').status_code == 404


def test_private_urls_are_refused_by_the_downloader():
    """Le garde anti-SSRF d'`image_storage` couvre aussi les photos de logs."""
    with pytest.raises(ValueError):
        image_storage.download_image('http://127.0.0.1:8000/secret.jpg')


# ------------------------------------------------------- Purge et cascade


def test_clearing_images_frees_the_disk_but_keeps_them_listed(app, monkeypatch):
    log = _refresh_with_one_image(app, monkeypatch)
    _patch_download(monkeypatch)
    client = app.test_client()
    stored = client.post(f'/api/geocaches/{app.geocache_id}/logs/{log.id}/images/store')
    path = image_storage.get_log_images_root_dir() / GeocacheLogImage.query.get(
        stored.json['images'][0]['id']
    ).stored_path

    assert path.exists()

    response = client.delete(f'/api/geocaches/{app.geocache_id}/logs/images')

    assert response.json['cleared'] == 1
    assert not path.exists()
    # La ligne survit : la photo reste listée, avec son bouton de récupération.
    image = GeocacheLogImage.query.filter_by(geocache_id=app.geocache_id).first()
    assert image is not None
    assert image.stored is False
    assert image.stored_path is None


def test_deleting_one_log_cascades_on_its_images(app, monkeypatch):
    log = _refresh_with_one_image(app, monkeypatch)

    db.session.delete(log)
    db.session.commit()

    assert GeocacheLogImage.query.filter_by(geocache_id=app.geocache_id).count() == 0


def test_deleting_all_logs_leaves_neither_rows_nor_files(app, monkeypatch):
    """
    La suppression en masse des logs passe à côté de l'ORM, donc de la cascade :
    sans nettoyage explicite, les photos survivraient à leurs logs.
    """
    log = _refresh_with_one_image(app, monkeypatch)
    _patch_download(monkeypatch)
    client = app.test_client()
    client.post(f'/api/geocaches/{app.geocache_id}/logs/{log.id}/images/store')
    geocache_dir = image_storage.get_log_images_root_dir() / str(app.geocache_id)

    assert any(geocache_dir.iterdir())

    client.delete(f'/api/geocaches/{app.geocache_id}/logs')

    assert GeocacheLogImage.query.filter_by(geocache_id=app.geocache_id).count() == 0
    assert not geocache_dir.exists()
