"""Tests du bundle d'analyse de sortie (lot 1 de `documentation/analyse-ia-sortie-spec.md`).

Couvre les trois briques déterministes — santé, signaux matériel, extraction lexicale —
puis la validation de l'endpoint. Les briques n'ont besoin ni de Flask ni de base : elles
sont testées sur des objets simples.
"""

import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest
from flask import Flask

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from gc_backend.services.outing_gear_signals import (  # noqa: E402
    build_gear_signals,
    count_unresolved,
    resolve_attribute_slug,
)
from gc_backend.services.outing_health import compute_health  # noqa: E402
from gc_backend.services.outing_lexicons import (  # noqa: E402
    find_gear_mentions,
    has_search_effort_hint,
    normalize,
)

NOW = datetime(2026, 9, 3, tzinfo=timezone.utc)


def _log(log_type, days_ago=0, text='', author='Toto', dated=True):
    """Log minimal : `compute_health` ne lit que `log_type`, `date` et `text`."""
    return SimpleNamespace(
        log_type=log_type,
        date=(NOW - timedelta(days=days_ago)) if dated else None,
        text=text,
        author=author,
    )


# ─────────────────────────────────────────────────────────────────────────────
# Santé
# ─────────────────────────────────────────────────────────────────────────────

def test_no_local_logs_is_unknown_not_ok():
    health = compute_health([], now=NOW)
    assert health['level'] == 'unknown'
    assert health['logs_available'] is False
    assert 'jamais été rafraîchie' in health['reasons'][0]


def test_three_consecutive_dnf_is_very_risky():
    logs = [
        _log("Didn't find it", 5),
        _log("Didn't find it", 20),
        _log("Didn't find it", 40),
        _log('Found it', 60),
    ]
    health = compute_health(logs, now=NOW)
    assert health['consecutive_dnf'] == 3
    assert health['level'] == 'very_risky'


def test_found_after_dnf_closes_the_streak():
    # Assez de trouvailles pour que le ratio DNF récent reste sous le seuil : le test
    # porte sur la série, pas sur le ratio, qui a son propre test.
    logs = [
        _log('Found it', 3),
        _log('Found it', 5),
        _log('Found it', 8),
        _log('Found it', 9),
        _log("Didn't find it", 10),
        _log("Didn't find it", 20),
    ]
    health = compute_health(logs, now=NOW)
    assert health['consecutive_dnf'] == 0
    assert health['level'] == 'ok'


def test_owner_maintenance_closes_the_streak():
    """Une maintenance du propriétaire est censée corriger le problème : la série s'arrête."""
    logs = [
        _log('Owner Maintenance', 2),
        _log("Didn't find it", 10),
        _log("Didn't find it", 20),
        _log('Found it', 30),
    ]
    health = compute_health(logs, now=NOW)
    assert health['consecutive_dnf'] == 0


def test_needs_maintenance_after_owner_maintenance_is_pending():
    logs = [
        _log('Needs Maintenance', 10),
        _log('Owner Maintenance', 100),
        _log('Found it', 120),
    ]
    health = compute_health(logs, now=NOW)
    assert health['needs_maintenance_pending'] is True


def test_owner_maintenance_after_needs_maintenance_is_not_pending():
    logs = [
        _log('Owner Maintenance', 10),
        _log('Needs Maintenance', 100),
        _log('Found it', 120),
    ]
    health = compute_health(logs, now=NOW)
    assert health['needs_maintenance_pending'] is False


def test_stale_cache_is_risky():
    health = compute_health([_log('Found it', 400)], now=NOW)
    assert health['days_since_last_found'] == 400
    assert health['level'] == 'risky'


def test_archived_cache_is_very_risky():
    health = compute_health([_log('Found it', 5)], listing_status='archived', now=NOW)
    assert health['level'] == 'very_risky'
    assert any('archivée' in reason for reason in health['reasons'])


def test_disabled_cache_is_very_risky():
    health = compute_health([_log('Found it', 5)], listing_status='disabled', now=NOW)
    assert health['level'] == 'very_risky'


def test_log_without_date_does_not_crash():
    logs = [_log('Found it', dated=False), _log("Didn't find it", 5)]
    health = compute_health(logs, now=NOW)
    assert health['local_logs_count'] == 2
    assert health['consecutive_dnf'] == 1


def test_never_found_is_at_least_watch():
    logs = [_log('Write note', 10), _log('Publish Listing', 300)]
    health = compute_health(logs, placed_at=NOW - timedelta(days=300), now=NOW)
    assert health['last_found_date'] is None
    assert health['level'] == 'watch'
    assert any('Jamais trouvée' in reason for reason in health['reasons'])


def test_dnf_ratio_uses_finds_and_dnf_only():
    logs = [_log('Write note', 1)] + [_log("Didn't find it", 2)] * 2 + [_log('Found it', 3)] * 2
    health = compute_health(logs, now=NOW)
    assert health['dnf_ratio_recent'] == 0.5


def test_dnf_variants_are_recognized():
    """Les sources ne s'accordent pas sur l'orthographe du DNF."""
    for variant in ("Didn't find it", 'did not find', 'DNF', 'Didnt find'):
        health = compute_health([_log(variant, 1), _log('Found it', 30)], now=NOW)
        assert health['consecutive_dnf'] == 1, variant


# ─────────────────────────────────────────────────────────────────────────────
# Signaux matériel
# ─────────────────────────────────────────────────────────────────────────────

def test_base_filename_keeps_its_yes_suffix():
    """Le scraper stocke `flashlight-yes` : le suffixe fait partie de la valeur en base."""
    assert resolve_attribute_slug({'name': 'x', 'base_filename': 'flashlight-yes'}) == 'flashlight'
    assert resolve_attribute_slug({'name': 'x', 'base_filename': 'UV-no'}) == 'uv'
    assert resolve_attribute_slug({'name': 'x', 'base_filename': 's-tool-yes'}) == 's-tool'


def test_special_tool_is_flagged_unresolved():
    signals = build_gear_signals([
        {'name': 'Outil spécial requis', 'is_negative': False, 'base_filename': 's-tool-yes'},
    ])
    assert len(signals) == 1
    assert signals[0]['signal'] == 'special_tool'
    assert signals[0]['resolved'] is False
    assert count_unresolved(signals) == 1


def test_flashlight_is_resolved():
    signals = build_gear_signals([
        {'name': 'Lampe torche requise', 'is_negative': False, 'base_filename': 'flashlight-yes'},
    ])
    assert signals[0]['signal'] == 'flashlight'
    assert signals[0]['resolved'] is True
    assert count_unresolved(signals) == 0


def test_negative_attribute_raises_no_gear_signal():
    """« Pas de chiens » ne se prépare pas dans un sac à dos."""
    signals = build_gear_signals([
        {'name': 'Lampe torche', 'is_negative': True, 'base_filename': 'flashlight-no'},
    ])
    assert signals == []


def test_negative_availability_becomes_a_time_constraint():
    signals = build_gear_signals([
        {'name': 'Accessible 24h/24', 'is_negative': True, 'base_filename': 'available-no'},
    ])
    assert signals[0]['signal'] == 'not_available_24h'
    assert signals[0]['kind'] == 'context'


def test_english_name_fallback_without_slug():
    """Import GPX : pas de `base_filename`, un libellé anglais."""
    signals = build_gear_signals([{'name': 'Special Tool Required', 'is_negative': False}])
    assert signals[0]['signal'] == 'special_tool'


def test_french_name_fallback_without_slug():
    signals = build_gear_signals([{'name': 'Outil spécial requis', 'is_negative': False}])
    assert signals[0]['signal'] == 'special_tool'


def test_gpx_attribute_id_fallback():
    signals = build_gear_signals([
        {'name': 'Libellé inconnu', 'is_negative': False, 'gc_attribute_id': '51'},
    ])
    assert signals[0]['signal'] == 'special_tool'


def test_uv_label_wins_over_generic_lamp():
    """« Lampe UV » ne doit pas être ramené au signal générique `flashlight`."""
    signals = build_gear_signals([{'name': 'Lampe UV nécessaire', 'is_negative': False}])
    assert signals[0]['signal'] == 'uv_light'


def test_climbing_and_rappelling_deduplicate():
    signals = build_gear_signals([
        {'name': 'Escalade', 'is_negative': False, 'base_filename': 'climbing-yes'},
        {'name': 'Rappel', 'is_negative': False, 'base_filename': 'rappelling-yes'},
    ])
    assert [signal['signal'] for signal in signals] == ['climbing']


def test_empty_attributes_are_safe():
    assert build_gear_signals(None) == []
    assert build_gear_signals([]) == []
    assert build_gear_signals(['pas un dict']) == []


# ─────────────────────────────────────────────────────────────────────────────
# Lexique
# ─────────────────────────────────────────────────────────────────────────────

def test_fishing_rod_is_detected_in_french():
    assert 'fishing_rod' in find_gear_mentions('Il faut une canne à pêche pour la sortir')


def test_accent_insensitive_matching():
    assert 'fishing_rod' in find_gear_mentions('prevoir une canne a peche')


def test_english_log_is_detected():
    assert 'fishing_rod' in find_gear_mentions('you will need a fishing rod')


def test_plural_is_detected():
    assert 'magnet' in find_gear_mentions('deux aimants sont nécessaires')


def test_word_boundary_avoids_false_positives():
    """« uv » isolé compte ; « uvea » non."""
    assert 'uv_light' in find_gear_mentions('lampe uv obligatoire')
    assert 'uv_light' not in find_gear_mentions('inflammation de uvea')


def test_several_gear_keys_in_one_log():
    matches = find_gear_mentions('avec une échelle et un aimant')
    assert 'ladder' in matches
    assert 'magnet' in matches


def test_search_effort_hint():
    assert has_search_effort_hint("très bien cachée, j'ai cherché longtemps")
    assert has_search_effort_hint('well hidden, took me ages')
    assert not has_search_effort_hint('TFTC, trouvée du premier coup')


def test_normalize_strips_accents_and_case():
    assert normalize('Canne à Pêche') == 'canne a peche'


# Faux positifs relevés sur de vrais logs de la base : ces termes ont été retirés du
# lexique au profit de formes non ambiguës. Voir le tableau du § 1.1 de la spec.

def test_perched_is_not_a_fishing_rod():
    """« perché » devient « perche » une fois les accents retirés."""
    assert 'fishing_rod' not in find_gear_mentions('le container est perché dans un arbre')
    assert 'fishing_rod' in find_gear_mentions('avec une perche télescopique')


def test_midi_pile_is_not_a_battery():
    assert 'battery' not in find_gear_mentions('nous sommes arrivés à midi pile')
    assert 'battery' in find_gear_mentions('prévoir des piles de rechange')


def test_puzzle_combination_is_not_a_wetsuit():
    assert 'wetsuit' not in find_gear_mentions('on a un peu cherché pour la combinaison')
    assert 'wetsuit' in find_gear_mentions('prévoir une combinaison de plongée')


def test_reminder_is_not_climbing_gear():
    assert 'harness' not in find_gear_mentions('pour rappel, le parking est plus bas')
    assert 'harness' in find_gear_mentions('descente en rappel obligatoire')


def test_real_world_hit_is_still_caught():
    """Le cas qui justifie tout le mécanisme, relevé tel quel dans un log de la base."""
    matches = find_gear_mentions('canne à pêche improvisée avec une grande branche')
    assert 'fishing_rod' in matches


# ─────────────────────────────────────────────────────────────────────────────
# Hint : colonnes inversées en base
# ─────────────────────────────────────────────────────────────────────────────

def _geocache_with_hints(decoded, raw, override=None):
    return SimpleNamespace(
        hints_decoded_override=override,
        hints_decoded=decoded,
        hints=raw,
    )


@pytest.mark.parametrize('plain,rot13', [
    ("[au pied d'un gros arbre]", "[nh cvrq q'ha tebf neoer]"),
    ('dans son nid', 'qnaf fba avq'),
    ('sous la pierre plate', 'fbhf yn cvreer cyngr'),
])
def test_hint_is_readable_whichever_column_holds_it(plain, rot13):
    """
    Sur une partie du parc, `hints` et `hints_decoded` sont renseignés à l'envers.
    Le hint renvoyé doit être lisible dans les deux cas.
    """
    from gc_backend.services.outing_analysis_service import _resolve_hint

    assert _resolve_hint(_geocache_with_hints(plain, rot13)) == plain
    assert _resolve_hint(_geocache_with_hints(rot13, plain)) == plain


def test_hint_override_always_wins():
    from gc_backend.services.outing_analysis_service import _resolve_hint

    geocache = _geocache_with_hints('dans son nid', 'qnaf fba avq', override='corrigé à la main')
    assert _resolve_hint(geocache) == 'corrigé à la main'


def test_hint_absent_returns_none():
    from gc_backend.services.outing_analysis_service import _resolve_hint

    assert _resolve_hint(_geocache_with_hints(None, None)) is None


# ─────────────────────────────────────────────────────────────────────────────
# Endpoint : validation du payload
# ─────────────────────────────────────────────────────────────────────────────

@pytest.fixture
def client():
    """
    Client minimal, sans base : seules les validations en amont de la requête SQL sont
    exercées ici. Le chemin nominal est couvert par les tests des briques ci-dessus.
    """
    from gc_backend.blueprints.geocaches import bp as geocaches_bp

    app = Flask(__name__)
    app.register_blueprint(geocaches_bp)
    app.config['TESTING'] = True
    return app.test_client()


def _post(client, payload):
    return client.post('/api/geocaches/analysis-bundle', json=payload)


def test_missing_ids_returns_400(client):
    assert _post(client, {}).status_code == 400
    assert _post(client, {'ids': []}).status_code == 400
    assert _post(client, {'ids': 'pas une liste'}).status_code == 400


def test_invalid_id_returns_400(client):
    assert _post(client, {'ids': [1, 'abc']}).status_code == 400


def test_too_many_ids_returns_400(client):
    from gc_backend.blueprints.geocaches import MAX_ANALYSIS_GEOCACHE_IDS

    resp = _post(client, {'ids': list(range(MAX_ANALYSIS_GEOCACHE_IDS + 1))})
    assert resp.status_code == 400
    assert 'Too many ids' in resp.get_json()['error']


def test_bounded_int_clamps_out_of_range_values():
    from gc_backend.blueprints.geocaches import _parse_bounded_int

    assert _parse_bounded_int({'listing_chars': 99999}, 'listing_chars', 1800, 200, 6000) == 6000
    assert _parse_bounded_int({'listing_chars': -5}, 'listing_chars', 1800, 200, 6000) == 200
    assert _parse_bounded_int({'listing_chars': 'x'}, 'listing_chars', 1800, 200, 6000) == 1800
    assert _parse_bounded_int({}, 'listing_chars', 1800, 200, 6000) == 1800
