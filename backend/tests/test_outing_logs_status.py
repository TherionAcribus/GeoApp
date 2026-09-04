"""
Tests du pré-vol « fraîcheur des logs » (`outing_logs_status`).

Ce module existe pour qu'une question posée *avant* l'analyse — faut-il rafraîchir ? —
reçoive la même réponse que celle que le bundle donnerait *après*. Les tests portent donc
autant sur les verdicts eux-mêmes que sur leur accord avec `outing_health`.
"""

import sys
import types
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

try:  # pragma: no cover - dépendance optionnelle en test
    import pyproj  # type: ignore  # noqa: F401
except ModuleNotFoundError:  # pragma: no cover
    class _FakeGeod:
        def __init__(self, **_kwargs):
            pass

        def inv(self, *_args, **_kwargs):
            return 0.0, 0.0, 0.0

    sys.modules['pyproj'] = types.SimpleNamespace(Geod=_FakeGeod)

from gc_backend import create_app  # noqa: E402
from gc_backend.database import db  # noqa: E402
from gc_backend.geocaches.models import Geocache, GeocacheLog  # noqa: E402
from gc_backend.models import Zone  # noqa: E402
from gc_backend.services.outing_health import LOGS_STALE_DAYS  # noqa: E402
from gc_backend.services.outing_logs_status import build_logs_status  # noqa: E402

NOW = datetime(2026, 9, 4, tzinfo=timezone.utc)


@pytest.fixture
def app():
    app = create_app()
    app.config['TESTING'] = True
    app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///:memory:'

    with app.app_context():
        db.create_all()
        yield app
        db.session.remove()
        db.drop_all()


def _geocache(gc_code: str) -> Geocache:
    zone = Zone.query.filter_by(name='Zone de test').first()
    if zone is None:
        zone = Zone(name='Zone de test')
        db.session.add(zone)
        db.session.flush()

    geocache = Geocache(gc_code=gc_code, name=f'Cache {gc_code}', zone_id=zone.id)
    db.session.add(geocache)
    db.session.flush()
    return geocache


def _log(geocache: Geocache, fetched_days_ago: int) -> GeocacheLog:
    """
    Log dont seule la date de collecte compte.

    `updated_at` est ce que lit `outing_health._fetched_at` : c'est lui qui date le
    rafraîchissement, pas `date`, qui date la visite de son auteur.
    """
    fetched_at = NOW - timedelta(days=fetched_days_ago)
    log = GeocacheLog(
        geocache_id=geocache.id,
        external_id=f'log-{geocache.id}-{fetched_days_ago}',
        author='Toto',
        text='RAS',
        date=NOW - timedelta(days=fetched_days_ago),
        log_type='Found it',
        created_at=fetched_at,
        updated_at=fetched_at,
    )
    db.session.add(log)
    db.session.flush()
    return log


def test_geocache_without_logs_is_reported_as_none(app):
    geocache = _geocache('GCNONE')

    status = build_logs_status([geocache.id], now=NOW)

    assert [entry['gc_code'] for entry in status['without_local_logs']] == ['GCNONE']
    assert status['stale_logs'] == []
    assert status['geocaches'][0]['status'] == 'none'
    assert status['geocaches'][0]['local_logs_count'] == 0
    assert status['geocaches'][0]['logs_fetched_at'] is None


def test_recent_logs_are_fresh(app):
    geocache = _geocache('GCFRESH')
    _log(geocache, fetched_days_ago=3)

    status = build_logs_status([geocache.id], now=NOW)

    assert status['without_local_logs'] == []
    assert status['stale_logs'] == []
    assert status['geocaches'][0]['status'] == 'fresh'
    assert status['geocaches'][0]['days_since_logs_fetched'] == 3


def test_old_logs_are_stale_on_the_same_threshold_as_health(app):
    geocache = _geocache('GCSTALE')
    _log(geocache, fetched_days_ago=LOGS_STALE_DAYS + 10)

    status = build_logs_status([geocache.id], now=NOW)

    assert [entry['gc_code'] for entry in status['stale_logs']] == ['GCSTALE']
    assert status['without_local_logs'] == []
    assert status['stale_after_days'] == LOGS_STALE_DAYS


def test_threshold_is_strict_so_a_log_exactly_at_the_limit_stays_fresh(app):
    geocache = _geocache('GCLIMIT')
    _log(geocache, fetched_days_ago=LOGS_STALE_DAYS)

    status = build_logs_status([geocache.id], now=NOW)

    assert status['geocaches'][0]['status'] == 'fresh'


def test_the_most_recent_collection_wins(app):
    # Un rafraîchissement ne réécrit que les logs qui ont changé : la fraîcheur du lot est
    # celle de sa ligne la plus récente, pas celle de la plus ancienne.
    geocache = _geocache('GCMIX')
    _log(geocache, fetched_days_ago=LOGS_STALE_DAYS + 200)
    _log(geocache, fetched_days_ago=2)

    status = build_logs_status([geocache.id], now=NOW)

    assert status['geocaches'][0]['status'] == 'fresh'
    assert status['geocaches'][0]['local_logs_count'] == 2
    assert status['geocaches'][0]['days_since_logs_fetched'] == 2


def test_order_is_preserved_and_unknown_ids_are_reported_not_fatal(app):
    first = _geocache('GCA')
    second = _geocache('GCB')

    status = build_logs_status([second.id, 999999, first.id], now=NOW)

    assert [entry['gc_code'] for entry in status['geocaches']] == ['GCB', 'GCA']
    assert status['missing'] == [999999]


def test_duplicate_ids_are_collapsed(app):
    geocache = _geocache('GCDUP')

    status = build_logs_status([geocache.id, geocache.id], now=NOW)

    assert len(status['geocaches']) == 1
    assert status['requested_count'] == 1


def test_empty_selection_returns_an_empty_status(app):
    status = build_logs_status([], now=NOW)

    assert status['geocaches'] == []
    assert status['missing'] == []
    assert status['stale_after_days'] == LOGS_STALE_DAYS


def test_endpoint_rejects_a_payload_without_ids(app):
    client = app.test_client()

    assert client.post('/api/geocaches/analysis-logs-status', json={}).status_code == 400
    assert client.post(
        '/api/geocaches/analysis-logs-status', json={'ids': []}
    ).status_code == 400
    assert client.post(
        '/api/geocaches/analysis-logs-status', json={'ids': [1, 'abc']}
    ).status_code == 400


def test_endpoint_shares_the_bundle_cap(app):
    from gc_backend.blueprints.geocaches import MAX_ANALYSIS_GEOCACHE_IDS

    client = app.test_client()
    response = client.post(
        '/api/geocaches/analysis-logs-status',
        json={'ids': list(range(MAX_ANALYSIS_GEOCACHE_IDS + 1))},
    )

    assert response.status_code == 400
    assert 'Too many ids' in response.get_json()['error']


def test_endpoint_returns_the_gaps(app):
    without = _geocache('GCEMPTY')
    fresh = _geocache('GCOK')
    _log(fresh, fetched_days_ago=1)
    db.session.commit()

    response = app.test_client().post(
        '/api/geocaches/analysis-logs-status',
        json={'ids': [without.id, fresh.id]},
    )

    assert response.status_code == 200
    payload = response.get_json()
    assert [entry['gc_code'] for entry in payload['without_local_logs']] == ['GCEMPTY']
    assert len(payload['geocaches']) == 2
