from __future__ import annotations

import json

import pytest

from gc_backend import create_app
from gc_backend.database import db
from gc_backend.models import GeocacheTrackable, Trackable
from gc_backend.services import trackable_store
from gc_backend.services.geocaching_friends import NotAuthenticatedError
from gc_backend.services.geocaching_trackables import (
    PAGE_SIZE,
    GeocachingTrackablesClient,
    TrackableError,
    TrackableNotFoundError,
    TrackableSummary,
    is_public_code,
)


# ------------------------------------------------------------------ Fixtures

def _inventory_item(code: str = 'TB6Q3ER', *, tracking: str = 'AF12CD', name: str = 'AngeEtDemonMobile') -> dict:
    """Élément de `/api/proxy/trackables` (forme relevée le 2026-09-29)."""
    return {
        'referenceCode': code,
        'iconUrl': 'https://www.geocaching.com/images/wpttypes/21.gif',
        'name': name,
        'distanceTraveledInKilometers': 3288.0424338157372,
        'currentGoal': '<p>Voyager</p>',
        'dateReleased': '2015-10-09T12:00:00',
        'locationReleased': {'state': 'Grand-Est', 'country': 'France'},
        'allowedToBeCollected': False,
        'owner': {'code': 'PR453DM', 'userName': 'AngeEtDemon'},
        'holder': {'code': 'PR453DM', 'userName': 'AngeEtDemon'},
        'isMissing': False,
        'isActive': True,
        'isLocked': False,
        'trackingNumber': tracking,
        'trackableType': {'id': 21, 'name': 'Travel Bug Dog Tag', 'imageName': '21.gif'},
    }


def _cache_item(code: str = 'TBBAQ0Z') -> dict:
    """Élément de `/api/proxy/web/v1/trackables/geocache/{GC}` : ni propriétaire ni code de suivi."""
    return {
        'referenceCode': code,
        'iconUrl': 'https://www.geocaching.com/images/wpttypes/23.gif',
        'name': '30 LIRE michelangiolesca',
        'dateReleased': '0001-01-01T00:00:00',
        'allowedToBeCollected': False,
        'isMissing': False,
        'isActive': True,
        'isLocked': False,
    }


TRACKABLE_JSON = {
    'referenceCode': 'TBBAQ0Z',
    'iconUrl': 'https://www.geocaching.com/images/wpttypes/23.gif',
    'name': '30 LIRE michelangiolesca',
    'dateReleased': '2025-12-25T12:00:00',
    'distanceTraveledInKilometers': 2556.2701689825208,
    'currentGeocache': {'id': 7761, 'referenceCode': 'GC1E51', 'name': 'Prague Panorama'},
    'trackableType': 11818,
    'owner': {'code': 'PRA80DD', 'userName': 'albi.fc'},
    'isMissing': False,
    'isActive': True,
    'isLocked': False,
}


def _log_page(log_types: list[int], current: dict | None) -> str:
    props = {
        'loggable': {
            'referenceCode': 'TBBAQ0Z',
            'name': '30 LIRE michelangiolesca',
            'currentGeocache': current,
            'owner': {'userName': 'albi.fc'},
        },
        'logTypes': [{'value': v} for v in log_types],
        'tbCode': 'TBBAQ0Z',
    }
    data = json.dumps({'props': {'pageProps': props}})
    return f'<html><script id="__NEXT_DATA__" type="application/json">{data}</script></html>'


DETAILS_PAGE = """
<title>(TBBAQ0Z) 30 LIRE michelangiolesca</title>
<span id="ctl00_ContentBody_lbHeading">30 LIRE michelangiolesca</span>
<img id="ctl00_ContentBody_BugTypeImage" class="TravelBugHeaderIcon" src="/images/WptTypes/23.gif" alt="albi.fc&#32;tag" />
<span class="CoordInfoCode">TBBAQ0Z</span>
<a id="ctl00_ContentBody_BugDetails_BugOwner" title="Afficher&#32;le&#32;profil" href="https://www.geocaching.com/p/?guid=a2823db2-2a81">albi.fc</a>
<span id="ctl00_ContentBody_BugDetails_BugReleaseDate">Thursday, 25 December 2025</span>
</dd>
<span id="ctl00_ContentBody_BugDetails_BugOrigin">Lombardia, Italy</span>
<a id="ctl00_ContentBody_BugDetails_BugLocation" title="Voir&#32;la&#32;description" data-name="Prague&#32;Panorama" data-status="Cache" href="https://www.geocaching.com/geocache/GC1E51">Prague Panorama</a>
(2556.3km&nbsp;) <a href="map_gm.aspx?ID=1">Voir la carte</a>
<div id="TrackableGoal">
<p>

    <p>I&#39;m in a trackable race.</p>
<p>Let me travel a lot!</p>
</p>
</div>
<div id="TrackableDetails">
    <p>
    </p>
    <p>
        Aucun détail supplémentaire n'est disponible.
    </p>
</div>
<table>
        <tr class="Data BorderTop ">
            <th class="travel-log-table-header" width="105">
                <img src="/images/logtypes/14.png" width="16" height="16" alt="Dropped Off" title="Dropped Off" />&nbsp;07/13/2026
            </th>
            <td>
                <a href="https://www.geocaching.com/p/?guid=739c0ac2">Scharfzähne</a> placed it in <a href="https://www.geocaching.com/geocache/GC1E51">Prague Panorama</a>
            </td>
            <td>Hlavní město Praha, Czechia</td>
            <td width="70"><a href="https://www.geocaching.com/live/log/TL26TRA65">Afficher le log</a></td>
        </tr>
        <tr class="Data BorderBottom ">
            <td colspan="4"><div class="TrackLogText markdown-output"></div></td>
        </tr>
        <tr class="Data BorderTop AlternatingRow">
            <th class="travel-log-table-header" width="105">
                <img src="/images/logtypes/13.png" width="16" height="16" alt="Retrieve It from a Cache" title="Retrieve It from a Cache" />&nbsp;07/12/2026
            </th>
            <td>
                <a href="https://www.geocaching.com/p/?guid=739c0ac2">Scharfzähne</a> retrieved it from <a href="https://www.geocaching.com/geocache/GCBRDZX"><span class="Strike OldWarning">&quot;LaDaDi&quot; coming home</span></a>
            </td>
            <td>Hessen, Germany</td>
            <td width="70"><a href="https://www.geocaching.com/live/log/TL26T9XPK">Afficher le log</a></td>
        </tr>
        <tr class="Data BorderBottom AlternatingRow">
            <td colspan="4"><div class="TrackLogText markdown-output"><p>Die Reise geht weiter.</p>
</div></td>
        </tr>
</table>
"""

# Page renvoyée pour un code inconnu : même gabarit, bloc CoordInfoCode vide.
NOT_FOUND_PAGE = '<title>Geocaching &gt; Trackable Item Details</title><span class="CoordInfoCode"></span>'


class FakeResponse:
    def __init__(self, status_code: int = 200, payload=None, text: str | None = None):
        self.status_code = status_code
        self._payload = payload
        self.text = text if text is not None else json.dumps(payload)

    def json(self):
        if self._payload is None:
            raise ValueError('not json')
        return self._payload


class FakeSession:
    """Répond selon l'URL ; `routes` associe un préfixe d'URL à une réponse ou à une fonction."""

    def __init__(self, routes: dict):
        self.routes = routes
        self.calls: list[tuple[str, dict | None]] = []

    def get(self, url, params=None, headers=None, timeout=None):
        self.calls.append((url, params))
        for prefix, handler in self.routes.items():
            if url.startswith(prefix):
                return handler(url, params) if callable(handler) else handler
        raise AssertionError(f'URL inattendue : {url}')


INVENTORY = 'https://www.geocaching.com/api/proxy/trackables'
CACHE_INVENTORY = 'https://www.geocaching.com/api/proxy/web/v1/trackables/geocache/'
TRACKABLE = 'https://www.geocaching.com/api/proxy/web/v1/trackables/TB'
LOG_PAGE = 'https://www.geocaching.com/live/trackable/'
DETAILS = 'https://www.geocaching.com/track/details.aspx'


# ------------------------------------------------------------------- Parsing

def test_parse_inventory_item_keeps_tracking_code_but_hides_it_by_default():
    summary = GeocachingTrackablesClient.parse_summary(_inventory_item())

    assert summary.reference_code == 'TB6Q3ER'
    assert summary.tracking_code == 'AF12CD'
    assert summary.type_id == 21 and summary.type_name == 'Travel Bug Dog Tag'
    assert summary.owner_username == 'AngeEtDemon'
    assert summary.origin == 'Grand-Est, France'
    assert summary.distance_km == 3288.0
    assert 'tracking_code' not in summary.to_dict()
    assert summary.to_dict(include_tracking_code=True)['tracking_code'] == 'AF12CD'


def test_parse_trackable_json_with_numeric_type_and_current_cache():
    summary = GeocachingTrackablesClient.parse_summary(TRACKABLE_JSON)

    assert summary.type_id == 11818 and summary.type_name is None
    assert summary.current_geocache_code == 'GC1E51'
    assert summary.current_geocache_name == 'Prague Panorama'
    assert summary.owner_username == 'albi.fc'


def test_placeholder_release_date_is_dropped():
    assert GeocachingTrackablesClient.parse_summary(_cache_item()).released_at is None


def test_parse_summary_rejects_items_without_code():
    assert GeocachingTrackablesClient.parse_summary({'name': 'x'}) is None
    assert GeocachingTrackablesClient.parse_summary('TB123') is None


def test_parse_log_page_from_next_data():
    info = GeocachingTrackablesClient.parse_log_page(
        'tbbaq0z', _log_page([4, 48, 13, 19], {'id': 7761, 'referenceCode': 'GC1E51', 'name': 'Prague Panorama'})
    )

    assert info.reference_code == 'TBBAQ0Z'
    assert info.allowed_log_type_ids == [4, 48, 13, 19]
    assert info.current_geocache_code == 'GC1E51'
    assert info.owner_username == 'albi.fc'
    assert info.to_dict()['allowed_log_types'][2] == {'id': 13, 'label': 'Retiré de la cache'}


def test_parse_log_page_for_trackable_in_hand():
    info = GeocachingTrackablesClient.parse_log_page('TB6Q3ER', _log_page([4], None))

    assert info.allowed_log_type_ids == [4]
    assert info.current_geocache_code is None


def test_parse_log_page_falls_back_on_raw_patterns():
    page = 'x "logTypes":[{"value":4},{"value":13}], "currentGeocache":{"id":1,"referenceCode":"GC1E51","name":"P"} y'
    info = GeocachingTrackablesClient.parse_log_page('TBBAQ0Z', page)

    assert info.allowed_log_type_ids == [4, 13]
    assert info.current_geocache_code == 'GC1E51'


def test_parse_details_page():
    details = GeocachingTrackablesClient.parse_details_page(DETAILS_PAGE)

    assert details.reference_code == 'TBBAQ0Z'
    assert details.name == '30 LIRE michelangiolesca'
    assert details.owner_username == 'albi.fc'
    assert details.origin == 'Lombardia, Italy'
    assert details.location_kind == 'cache'
    assert details.location_name == 'Prague Panorama'
    assert details.location_geocache_code == 'GC1E51'
    assert details.distance_km == 2556.3
    assert details.icon_url == 'https://www.geocaching.com/images/WptTypes/23.gif'
    assert details.type_name == 'albi.fc tag'
    # Le <p> qui enveloppait tout l'objectif a disparu, le contenu reste.
    assert details.goal_html.startswith('<p>I&#39;m in a trackable race.</p>')
    assert 'Let me travel a lot!' in details.goal_html


def test_parse_details_logs():
    logs = GeocachingTrackablesClient.parse_details_page(DETAILS_PAGE).logs

    assert [log.log_reference_code for log in logs] == ['TL26TRA65', 'TL26T9XPK']
    dropped, retrieved = logs
    assert dropped.log_type_id == 14 and dropped.log_type_label == 'Déposé'
    assert dropped.log_date == '2026-07-13' and dropped.log_date_raw == '07/13/2026'
    assert dropped.author_username == 'Scharfzähne'
    assert dropped.geocache_code == 'GC1E51'
    assert dropped.text_html is None
    assert retrieved.geocache_code == 'GCBRDZX'
    assert retrieved.geocache_name == '"LaDaDi" coming home'
    assert retrieved.text_html == '<p>Die Reise geht weiter.</p>'


@pytest.mark.parametrize('raw_dates, expected', [
    (['13/07/2026', '01/02/2026'], ['2026-07-13', '2026-02-01']),   # jour > 12 : jour en premier
    (['07/13/2026', '01/02/2026'], ['2026-07-13', '2026-01-02']),   # mois en premier
    (['01.02.2026'], ['2026-02-01']),                               # format allemand
    (['2026-07-13'], ['2026-07-13']),
])
def test_log_dates_follow_the_account_format(raw_dates, expected):
    rows = ''.join(
        f'<tr class="Data BorderTop "><th><img src="/images/logtypes/4.png" title="Note" />&nbsp;{d}</th>'
        f'<td><a href="/live/log/TL{i}">x</a></td></tr>'
        f'<tr class="Data BorderBottom "><td><div class="TrackLogText"></div></td></tr>'
        for i, d in enumerate(raw_dates)
    )
    logs = GeocachingTrackablesClient.parse_details_logs(rows)
    assert [log.log_date for log in logs] == expected


def test_parse_details_page_returns_none_for_unknown_code():
    assert GeocachingTrackablesClient.parse_details_page(NOT_FOUND_PAGE) is None


@pytest.mark.parametrize('code, expected', [
    ('TB6Q3ER', True), ('tbbaq0z', True), ('TB1', True),
    ('AF12CD', False),      # code de suivi
    ('TBIL00', False),      # I et L n'existent pas dans un code public
    ('', False),
])
def test_is_public_code(code, expected):
    assert is_public_code(code) is expected


# -------------------------------------------------------------------- Réseau

def test_fetch_my_inventory_paginates():
    first = [_inventory_item(f'TB{i:05d}'.replace('0', 'A'), tracking=f'X{i}') for i in range(PAGE_SIZE)]

    def inventory(url, params):
        return FakeResponse(payload=first if params['skip'] == 0 else [_inventory_item('TBLAST')])

    session = FakeSession({INVENTORY: inventory})
    items = GeocachingTrackablesClient(session).fetch_my_inventory()

    assert len(items) == PAGE_SIZE + 1
    assert [c[1]['skip'] for c in session.calls] == [0, PAGE_SIZE]
    assert session.calls[0][1]['inInventory'] == 'true' and session.calls[0][1]['inCollection'] == 'false'


def test_fetch_my_inventory_single_page():
    session = FakeSession({INVENTORY: FakeResponse(payload=[_inventory_item()])})
    items = GeocachingTrackablesClient(session).fetch_my_inventory()

    assert [i.reference_code for i in items] == ['TB6Q3ER']
    assert len(session.calls) == 1


def test_fetch_cache_inventory():
    session = FakeSession({CACHE_INVENTORY: FakeResponse(payload={'total': 1, 'data': [_cache_item()]})})
    items = GeocachingTrackablesClient(session).fetch_cache_inventory('gc1e51')

    assert [i.reference_code for i in items] == ['TBBAQ0Z']
    assert session.calls[0][0].endswith('/geocache/GC1E51')
    assert items[0].tracking_code is None


@pytest.mark.parametrize('status', [401, 403])
def test_rejected_session_raises_not_authenticated(status):
    session = FakeSession({INVENTORY: FakeResponse(status_code=status, text='')})
    with pytest.raises(NotAuthenticatedError):
        GeocachingTrackablesClient(session).fetch_my_inventory()


def test_rate_limit_and_unexpected_payload_raise_trackable_error():
    session = FakeSession({INVENTORY: FakeResponse(status_code=429, text='')})
    with pytest.raises(TrackableError, match='429'):
        GeocachingTrackablesClient(session).fetch_my_inventory()

    session = FakeSession({INVENTORY: FakeResponse(payload={'unexpected': True})})
    with pytest.raises(TrackableError):
        GeocachingTrackablesClient(session).fetch_my_inventory()


def test_fetch_trackable_not_found():
    session = FakeSession({TRACKABLE: FakeResponse(status_code=404, text='')})
    with pytest.raises(TrackableNotFoundError):
        GeocachingTrackablesClient(session).fetch_trackable('TBNOPE')


def test_lookup_by_tracking_code_keeps_the_code():
    session = FakeSession({
        DETAILS: FakeResponse(text=DETAILS_PAGE),
        TRACKABLE: FakeResponse(payload=TRACKABLE_JSON),
    })
    summary = GeocachingTrackablesClient(session).lookup(' ab12cd ')

    assert summary.reference_code == 'TBBAQ0Z'
    assert summary.tracking_code == 'AB12CD'
    assert session.calls[0][1] == {'tracker': 'AB12CD'}


def test_lookup_by_public_code_has_no_tracking_code():
    session = FakeSession({
        DETAILS: FakeResponse(text=DETAILS_PAGE),
        TRACKABLE: FakeResponse(payload=TRACKABLE_JSON),
    })
    summary = GeocachingTrackablesClient(session).lookup('TBBAQ0Z')

    assert summary.tracking_code is None


def test_lookup_unknown_code():
    session = FakeSession({DETAILS: FakeResponse(text=NOT_FOUND_PAGE)})
    with pytest.raises(TrackableNotFoundError):
        GeocachingTrackablesClient(session).lookup('ZZZZZZ')


def test_fetch_log_page_info_and_details():
    session = FakeSession({
        LOG_PAGE: FakeResponse(text=_log_page([4, 13], {'referenceCode': 'GC1E51', 'name': 'P'})),
        DETAILS: FakeResponse(text=DETAILS_PAGE),
    })
    client = GeocachingTrackablesClient(session)

    assert client.fetch_log_page_info('TBBAQ0Z').allowed_log_type_ids == [4, 13]
    assert session.calls[0][0] == 'https://www.geocaching.com/live/trackable/TBBAQ0Z/log'
    assert len(client.fetch_details('TBBAQ0Z').logs) == 2


# ------------------------------------------------------------------ Stockage

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


def _summary(raw: dict) -> TrackableSummary:
    return GeocachingTrackablesClient.parse_summary(raw)


def test_save_my_inventory_adds_updates_and_removes(app):
    report = trackable_store.save_my_inventory([_summary(_inventory_item('TBAAA1')), _summary(_inventory_item('TBAAA2'))])
    assert (report.created, report.updated, report.removed) == (2, 0, 0)

    report = trackable_store.save_my_inventory([_summary(_inventory_item('TBAAA2', name='Renommé'))])
    assert (report.created, report.updated, report.removed) == (0, 1, 1)

    inventory = trackable_store.list_my_inventory()
    assert [t.reference_code for t in inventory] == ['TBAAA2']
    assert inventory[0].name == 'Renommé'
    assert Trackable.query.filter_by(reference_code='TBAAA1').one().in_my_inventory is False
    assert trackable_store.inventory_last_sync_at() is not None


def test_tracking_code_is_stored_but_never_serialized(app):
    trackable_store.save_my_inventory([_summary(_inventory_item('TBAAA1', tracking='SECRET'))])

    assert trackable_store.get_tracking_code('tbaaa1') == 'SECRET'
    data = Trackable.query.one().to_dict()
    assert 'tracking_code' not in data
    assert data['has_tracking_code'] is True
    assert 'SECRET' not in json.dumps(data)


def test_cache_inventory_does_not_erase_known_fields(app):
    trackable_store.save_my_inventory([_summary(_inventory_item('TBBAQ0Z', tracking='SECRET'))])

    rows = trackable_store.save_cache_inventory('gc1e51', [_summary(_cache_item('TBBAQ0Z'))])

    row = rows[0]
    assert row.tracking_code == 'SECRET'
    assert row.owner_username == 'AngeEtDemon'
    assert row.in_my_inventory is False
    assert row.current_geocache_code == 'GC1E51'
    assert [t.reference_code for t in trackable_store.list_cache_inventory('GC1E51')] == ['TBBAQ0Z']


def test_cache_inventory_is_replaced_on_each_scan(app):
    trackable_store.save_cache_inventory('GC1E51', [_summary(_cache_item('TBAAA1')), _summary(_cache_item('TBAAA2'))])
    trackable_store.save_cache_inventory('GC1E51', [_summary(_cache_item('TBAAA2'))])

    assert [t.reference_code for t in trackable_store.list_cache_inventory('GC1E51')] == ['TBAAA2']
    assert GeocacheTrackable.query.count() == 1


def test_cache_log_actions_are_remembered_and_drops_move_the_trackable(app):
    trackable_store.save_my_inventory([_summary(_inventory_item('TBAAA1')), _summary(_inventory_item('TBAAA2'))])
    trackable_store.save_cache_inventory('GCOLD', [_summary(_cache_item('TBAAA3'))])

    trackable_store.apply_cache_log_trackable_actions(
        'gcnew', {'TBAAA1': 'visit', 'TBAAA2': 'drop', 'TBAAA3': 'bogus'}
    )

    visited = Trackable.query.filter_by(reference_code='TBAAA1').one()
    dropped = Trackable.query.filter_by(reference_code='TBAAA2').one()
    assert visited.last_cache_log_action == 'visit' and visited.in_my_inventory is True
    assert dropped.last_cache_log_action == 'drop' and dropped.in_my_inventory is False
    assert dropped.current_geocache_code == 'GCNEW'
    assert [t.reference_code for t in trackable_store.list_cache_inventory('GCNEW')] == ['TBAAA2']
    assert Trackable.query.filter_by(reference_code='TBAAA3').one().last_cache_log_action is None


def test_retrieved_trackable_enters_my_inventory_and_leaves_its_cache(app):
    trackable_store.save_cache_inventory('GC1E51', [_summary(_cache_item('TBBAQ0Z'))])

    row = trackable_store.apply_trackable_log('TBBAQ0Z', 13, tracking_code='ab12cd')

    assert row.in_my_inventory is True
    assert row.current_geocache_code is None
    assert row.tracking_code == 'AB12CD'
    assert trackable_store.list_cache_inventory('GC1E51') == []
    assert trackable_store.cache_inventory_synced_at('gc1e51') is not None


def test_discovered_trackable_stays_where_it_is(app):
    trackable_store.save_cache_inventory('GC1E51', [_summary(_cache_item('TBBAQ0Z'))])

    row = trackable_store.apply_trackable_log('TBBAQ0Z', 48, tracking_code='AB12CD')

    assert row.in_my_inventory is False
    assert [t.reference_code for t in trackable_store.list_cache_inventory('GC1E51')] == ['TBBAQ0Z']
