"""Tests du plan de sortie (lot 11 de `documentation/analyse-ia-sortie-spec.md`).

Deux niveaux, comme pour le bundle : la normalisation du plan ne demande ni Flask ni
base, l'API demande les deux. Le fil conducteur des tests de normalisation est qu'un plan
imparfait doit **arriver quand même**, amputé et expliqué, plutôt que d'être rejeté : le
rapport est déjà sous les yeux de l'utilisateur dans le chat, le refuser ici ne lui rend
aucun service.
"""

import sys
import types
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

from gc_backend.services.outing_plan_schema import (  # noqa: E402
    CACHE_FLAGS,
    OutingPlanError,
    normalize_key,
    plan_flags_by_code,
    validate_plan,
)


def _minimal_plan(**overrides):
    plan = {
        'summary': 'Sortie de trois caches',
        'checklist': [{'item': 'Lampe frontale', 'certainty': 'confirmed', 'gc_codes': ['GCAAA']}],
        'alerts': [],
        'per_cache': [],
    }
    plan.update(overrides)
    return plan


# ─────────────────────────────────────────────────────────────────────────────
# Normalisation : checklist
# ─────────────────────────────────────────────────────────────────────────────

def test_checklist_entry_gets_a_stable_key():
    plan = validate_plan(_minimal_plan())['plan']
    assert plan['checklist'][0]['key'] == 'lampe-frontale'


def test_key_ignores_accents_and_punctuation():
    assert normalize_key('Canne à pêche (télescopique)') == 'canne-a-peche-telescopique'
    assert normalize_key('CANNE A PECHE') == 'canne-a-peche'


def test_duplicate_items_merge_and_keep_the_strongest_certainty():
    raw = _minimal_plan(checklist=[
        {'item': 'Lampe frontale', 'certainty': 'precaution', 'gc_codes': ['GCAAA']},
        {'item': 'lampe frontale', 'certainty': 'confirmed', 'gc_codes': ['GCBBB'],
         'reason': 'log de Toto'},
    ])
    checklist = validate_plan(raw)['plan']['checklist']

    assert len(checklist) == 1
    assert checklist[0]['certainty'] == 'confirmed'
    assert checklist[0]['gc_codes'] == ['GCAAA', 'GCBBB']
    assert checklist[0]['reason'] == 'log de Toto'


def test_unknown_certainty_falls_back_to_precaution():
    raw = _minimal_plan(checklist=[{'item': 'Corde', 'certainty': 'peut-etre'}])
    assert validate_plan(raw)['plan']['checklist'][0]['certainty'] == 'precaution'


def test_checklist_accepts_bare_strings():
    raw = _minimal_plan(checklist=['Gants', 'Loupe'])
    items = [entry['item'] for entry in validate_plan(raw)['plan']['checklist']]
    assert items == ['Gants', 'Loupe']


def test_checklist_is_sorted_by_certainty_then_label():
    raw = _minimal_plan(checklist=[
        {'item': 'Zebre', 'certainty': 'confirmed'},
        {'item': 'Anorak', 'certainty': 'precaution'},
        {'item': 'Aimant', 'certainty': 'confirmed'},
    ])
    items = [entry['item'] for entry in validate_plan(raw)['plan']['checklist']]
    assert items == ['Aimant', 'Zebre', 'Anorak']


# ─────────────────────────────────────────────────────────────────────────────
# Normalisation : codes GC, alertes, durées
# ─────────────────────────────────────────────────────────────────────────────

def test_invalid_gc_codes_are_dropped_with_a_warning():
    raw = _minimal_plan(checklist=[
        {'item': 'Aimant', 'certainty': 'confirmed', 'gc_codes': ['gcabc', 'pas un code', 42]},
    ])
    result = validate_plan(raw)

    assert result['plan']['checklist'][0]['gc_codes'] == ['GCABC']
    assert any('illisible' in warning for warning in result['warnings'])


def test_unknown_alert_kind_and_severity_fall_back():
    raw = _minimal_plan(alerts=[
        {'gc_code': 'GCAAA', 'severity': 'catastrophe', 'kind': 'meteorite', 'message': 'Bof'},
    ])
    alert = validate_plan(raw)['plan']['alerts'][0]

    assert alert['severity'] == 'warning'
    assert alert['kind'] == 'other'


def test_alerts_are_sorted_blocking_first():
    raw = _minimal_plan(alerts=[
        {'severity': 'info', 'message': 'Pour info'},
        {'severity': 'blocking', 'message': 'Mystery non résolue'},
        {'severity': 'warning', 'message': 'Attention'},
    ])
    severities = [alert['severity'] for alert in validate_plan(raw)['plan']['alerts']]
    assert severities == ['blocking', 'warning', 'info']


def test_minutes_accept_a_string_and_are_capped():
    raw = _minimal_plan(per_cache=[
        {'gc_code': 'GCAAA', 'minutes': '45 min'},
        {'gc_code': 'GCBBB', 'minutes': 99999},
        {'gc_code': 'GCCCC', 'minutes': 'inconnu'},
    ])
    by_code = {entry['gc_code']: entry for entry in validate_plan(raw)['plan']['per_cache']}

    assert by_code['GCAAA']['minutes'] == 45
    assert by_code['GCBBB']['minutes'] == 24 * 60
    assert by_code['GCCCC']['minutes'] is None


def test_time_budget_total_is_computed_when_missing():
    raw = _minimal_plan(time_budget={'on_site_minutes': 300, 'travel_minutes': 60})
    assert validate_plan(raw)['plan']['time_budget']['total_minutes'] == 360


def test_time_budget_is_none_when_nothing_usable():
    raw = _minimal_plan(time_budget={'commentaire': 'une bonne journée'})
    assert validate_plan(raw)['plan']['time_budget'] is None


# ─────────────────────────────────────────────────────────────────────────────
# Drapeaux dérivés : c'est ce que lisent les badges
# ─────────────────────────────────────────────────────────────────────────────

def test_blocking_alert_creates_the_cache_entry_and_its_flag():
    raw = _minimal_plan(alerts=[
        {'gc_code': 'GCAAA', 'severity': 'blocking', 'kind': 'unsolved_mystery',
         'message': 'Énigme non résolue'},
    ])
    per_cache = validate_plan(raw)['plan']['per_cache']

    assert len(per_cache) == 1
    assert per_cache[0]['gc_code'] == 'GCAAA'
    assert 'blocking' in per_cache[0]['flags']


def test_alert_kind_maps_to_its_own_flag():
    raw = _minimal_plan(alerts=[
        {'gc_code': 'GCAAA', 'severity': 'warning', 'kind': 'health', 'message': '3 DNF'},
        {'gc_code': 'GCBBB', 'severity': 'warning', 'kind': 'schedule', 'message': 'Ferme à 18h'},
    ])
    by_code = {entry['gc_code']: entry for entry in validate_plan(raw)['plan']['per_cache']}

    assert 'risky_health' in by_code['GCAAA']['flags']
    assert 'time_window' in by_code['GCBBB']['flags']


def test_listed_gear_implies_the_gear_required_flag():
    raw = _minimal_plan(per_cache=[{'gc_code': 'GCAAA', 'gear': ['Canne à pêche']}])
    assert 'gear_required' in validate_plan(raw)['plan']['per_cache'][0]['flags']


def test_unknown_flags_are_dropped():
    raw = _minimal_plan(per_cache=[{'gc_code': 'GCAAA', 'flags': ['risky_health', 'licorne']}])
    flags = validate_plan(raw)['plan']['per_cache'][0]['flags']

    assert flags == ['risky_health']
    assert all(flag in CACHE_FLAGS for flag in flags)


def test_alerts_without_a_gc_code_flag_nothing():
    raw = _minimal_plan(alerts=[{'severity': 'blocking', 'message': 'Sortie trop longue'}])
    assert validate_plan(raw)['plan']['per_cache'] == []


def test_plan_flags_by_code_exposes_gear_and_minutes():
    plan = validate_plan(_minimal_plan(per_cache=[
        {'gc_code': 'GCAAA', 'gear': ['Aimant'], 'minutes': 30},
    ]))['plan']

    view = plan_flags_by_code(plan)
    assert view['GCAAA']['gear'] == ['Aimant']
    assert view['GCAAA']['minutes'] == 30
    assert 'gear_required' in view['GCAAA']['flags']


# ─────────────────────────────────────────────────────────────────────────────
# Refus : seulement quand il ne reste rien
# ─────────────────────────────────────────────────────────────────────────────

def test_non_object_is_rejected():
    with pytest.raises(OutingPlanError):
        validate_plan(['une', 'liste'])


def test_empty_plan_is_rejected():
    with pytest.raises(OutingPlanError):
        validate_plan({'summary': 'Rien à signaler'})


def test_a_plan_with_only_alerts_is_accepted():
    plan = validate_plan({'alerts': [{'severity': 'blocking', 'message': 'Mystery à résoudre'}]})
    assert plan['plan']['checklist'] == []
    assert len(plan['plan']['alerts']) == 1


# ─────────────────────────────────────────────────────────────────────────────
# API
# ─────────────────────────────────────────────────────────────────────────────

@pytest.fixture
def app():
    from gc_backend import create_app
    from gc_backend.database import db

    app = create_app()
    app.config['TESTING'] = True
    app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///:memory:'

    with app.app_context():
        db.create_all()
        yield app
        db.session.remove()
        db.drop_all()


@pytest.fixture
def client(app):
    return app.test_client()


def _save(client, **overrides):
    payload = {
        'zone_name': 'Forêt',
        'outing_date': '2026-09-12',
        'gc_codes': ['GCAAA', 'GCBBB'],
        'plan': _minimal_plan(),
    }
    payload.update(overrides)
    return client.post('/api/outing-plans', json=payload)


def test_save_returns_the_normalized_plan(client):
    response = _save(client)
    assert response.status_code == 200

    body = response.get_json()
    assert body['plan']['zone_name'] == 'Forêt'
    assert body['plan']['outing_date'] == '2026-09-12'
    assert body['plan']['plan']['checklist'][0]['key'] == 'lampe-frontale'
    assert body['plan']['gc_codes'] == ['GCAAA', 'GCBBB']


def test_save_rejects_a_missing_or_invalid_date(client):
    assert _save(client, outing_date=None).status_code == 400
    assert _save(client, outing_date='12/09/2026').status_code == 400
    # Le 31 février passe le format mais pas le calendrier.
    assert _save(client, outing_date='2026-02-31').status_code == 400


def test_save_rejects_an_empty_plan(client):
    assert _save(client, plan={'summary': 'rien'}).status_code == 400


def test_saving_twice_replaces_instead_of_duplicating(client):
    first = _save(client).get_json()['plan']['id']
    second = _save(client, plan=_minimal_plan(summary='Deuxième passe')).get_json()['plan']['id']

    assert first == second
    assert len(client.get('/api/outing-plans').get_json()['plans']) == 1


def test_a_different_date_creates_a_second_plan(client):
    _save(client)
    _save(client, outing_date='2026-09-13')
    assert len(client.get('/api/outing-plans').get_json()['plans']) == 2


def test_checked_items_survive_a_re_analysis(client):
    plan_id = _save(client).get_json()['plan']['id']
    client.patch(f'/api/outing-plans/{plan_id}', json={'checked': ['lampe-frontale']})

    # Relance : la ligne « Lampe frontale » existe toujours, « Corde » est nouvelle.
    _save(client, plan=_minimal_plan(checklist=[
        {'item': 'Lampe frontale', 'certainty': 'confirmed'},
        {'item': 'Corde', 'certainty': 'probable'},
    ]))

    plan = client.get(f'/api/outing-plans/{plan_id}').get_json()['plan']
    assert plan['checked'] == ['lampe-frontale']


def test_checked_items_that_disappeared_are_dropped(client):
    plan_id = _save(client).get_json()['plan']['id']
    client.patch(f'/api/outing-plans/{plan_id}', json={'checked': ['lampe-frontale']})

    _save(client, plan=_minimal_plan(checklist=[{'item': 'Corde', 'certainty': 'probable'}]))

    plan = client.get(f'/api/outing-plans/{plan_id}').get_json()['plan']
    assert plan['checked'] == []


def test_patch_ignores_keys_absent_from_the_plan(client):
    plan_id = _save(client).get_json()['plan']['id']
    response = client.patch(
        f'/api/outing-plans/{plan_id}',
        json={'checked': ['lampe-frontale', 'clé-fantôme']},
    )

    assert response.status_code == 200
    assert response.get_json()['plan']['checked'] == ['lampe-frontale']


def test_patch_requires_a_list(client):
    plan_id = _save(client).get_json()['plan']['id']
    assert client.patch(f'/api/outing-plans/{plan_id}', json={'checked': 'tout'}).status_code == 400


def test_patch_rejects_an_empty_body(client):
    plan_id = _save(client).get_json()['plan']['id']
    assert client.patch(f'/api/outing-plans/{plan_id}', json={}).status_code == 400


def test_patch_attaches_the_markdown_report(client):
    """Le tool ne transmet que la structure : le texte rédigé arrive par cette voie."""
    plan_id = _save(client).get_json()['plan']['id']

    response = client.patch(f'/api/outing-plans/{plan_id}', json={'markdown': '# Rapport'})
    assert response.status_code == 200

    detail = client.get(f'/api/outing-plans/{plan_id}').get_json()['plan']
    assert detail['markdown'] == '# Rapport'


def test_patch_markdown_leaves_the_checked_state_alone(client):
    plan_id = _save(client).get_json()['plan']['id']
    client.patch(f'/api/outing-plans/{plan_id}', json={'checked': ['lampe-frontale']})
    client.patch(f'/api/outing-plans/{plan_id}', json={'markdown': '# Rapport'})

    detail = client.get(f'/api/outing-plans/{plan_id}').get_json()['plan']
    assert detail['checked'] == ['lampe-frontale']


def test_list_filters_by_date(client):
    _save(client)
    _save(client, outing_date='2026-09-13')

    plans = client.get('/api/outing-plans?outing_date=2026-09-13').get_json()['plans']
    assert [plan['outing_date'] for plan in plans] == ['2026-09-13']


def test_list_omits_the_markdown(client):
    _save(client, markdown='# Rapport\n\nDu texte.')
    plans = client.get('/api/outing-plans').get_json()['plans']

    assert 'markdown' not in plans[0]
    detail = client.get(f"/api/outing-plans/{plans[0]['id']}").get_json()['plan']
    assert detail['markdown'].startswith('# Rapport')


def test_delete_removes_the_plan(client):
    plan_id = _save(client).get_json()['plan']['id']

    assert client.delete(f'/api/outing-plans/{plan_id}').status_code == 200
    assert client.get(f'/api/outing-plans/{plan_id}').status_code == 404


def test_flags_endpoint_answers_per_code(client):
    _save(client, plan=_minimal_plan(
        per_cache=[{'gc_code': 'GCAAA', 'gear': ['Aimant'], 'minutes': 20}],
        alerts=[{'gc_code': 'GCBBB', 'severity': 'blocking', 'kind': 'unsolved_mystery',
                 'message': 'Énigme non résolue'}],
    ))

    flags = client.post(
        '/api/outing-plans/flags', json={'gc_codes': ['GCAAA', 'GCBBB', 'GCZZZ']}
    ).get_json()['flags']

    assert 'gear_required' in flags['GCAAA']['flags']
    assert flags['GCAAA']['outing_date'] == '2026-09-12'
    assert 'blocking' in flags['GCBBB']['flags']
    assert 'GCZZZ' not in flags


def test_flags_endpoint_prefers_the_most_recent_outing(client):
    _save(client, outing_date='2026-09-12', plan=_minimal_plan(
        per_cache=[{'gc_code': 'GCAAA', 'gear': ['Vieux matériel']}],
    ))
    _save(client, outing_date='2026-09-20', plan=_minimal_plan(
        per_cache=[{'gc_code': 'GCAAA', 'gear': ['Matériel à jour']}],
    ))

    flags = client.post('/api/outing-plans/flags', json={'gc_codes': ['GCAAA']}).get_json()['flags']
    assert flags['GCAAA']['gear'] == ['Matériel à jour']
    assert flags['GCAAA']['outing_date'] == '2026-09-20'


def test_flags_endpoint_tolerates_an_empty_request(client):
    assert client.post('/api/outing-plans/flags', json={}).get_json()['flags'] == {}
