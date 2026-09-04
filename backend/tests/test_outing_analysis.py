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
    count_resolved_from_text,
    count_unresolved,
    resolve_attribute_slug,
    resolve_signals_from_text,
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
# Fraîcheur de la collecte
# ─────────────────────────────────────────────────────────────────────────────

def _fetched_log(log_type, days_ago=0, fetched_days_ago=0, text=''):
    """Log daté à la fois côté geocaching.com (`date`) et côté base (`updated_at`)."""
    log = _log(log_type, days_ago, text=text)
    log.updated_at = NOW - timedelta(days=fetched_days_ago)
    log.created_at = NOW - timedelta(days=fetched_days_ago)
    return log


def test_fresh_collection_is_not_stale():
    health = compute_health([_fetched_log('Found it', 10, fetched_days_ago=2)], now=NOW)

    assert health['logs_stale'] is False
    assert health['days_since_logs_fetched'] == 2
    assert health['level'] == 'ok'


def test_old_collection_is_flagged_stale():
    """Une cache saine sur des logs collectés il y a 14 mois doit le dire."""
    health = compute_health([_fetched_log('Found it', 400, fetched_days_ago=420)], now=NOW)

    assert health['logs_stale'] is True
    assert health['days_since_logs_fetched'] == 420
    assert any('récupérés il y a 420 jours' in reason for reason in health['reasons'])


def test_staleness_does_not_change_the_level():
    """
    La collecte périmée qualifie la **complétude**, pas la santé : les DNF comptés restent
    des DNF, et un niveau calculé ne doit pas se dégrader tout seul. C'est au rapport de
    pondérer, avec l'information sous les yeux.
    """
    fresh = compute_health([_fetched_log('Found it', 10, fetched_days_ago=2)], now=NOW)
    stale = compute_health([_fetched_log('Found it', 10, fetched_days_ago=400)], now=NOW)

    assert stale['level'] == fresh['level']


def test_most_recent_fetch_wins():
    """Un seul log rafraîchi récemment suffit à dater la collecte."""
    logs = [
        _fetched_log('Found it', 500, fetched_days_ago=500),
        _fetched_log("Didn't find it", 3, fetched_days_ago=1),
    ]
    health = compute_health(logs, now=NOW)

    assert health['days_since_logs_fetched'] == 1
    assert health['logs_stale'] is False


def test_last_log_date_is_independent_of_the_last_find():
    """Un DNF après une trouvaille : la cache a été visitée depuis, sans succès."""
    logs = [_log("Didn't find it", 5), _log('Found it', 300)]
    health = compute_health(logs, now=NOW)

    assert health['days_since_last_log'] == 5
    assert health['days_since_last_found'] == 300


def test_logs_without_timestamps_leave_freshness_unknown():
    """Les objets sans horodatage de base ne doivent pas faire croire à une collecte."""
    health = compute_health([_log('Found it', 10)], now=NOW)

    assert health['logs_fetched_at'] is None
    assert health['logs_stale'] is False


# ─────────────────────────────────────────────────────────────────────────────
# Waypoints, notes et questions d'EarthCache
# ─────────────────────────────────────────────────────────────────────────────

def _waypoint(prefix='PK', name='Parking', wp_type='Parking Area',
              gc_coords=None, latitude=None, longitude=None, note=None):
    return SimpleNamespace(
        prefix=prefix, name=name, type=wp_type, gc_coords=gc_coords,
        latitude=latitude, longitude=longitude, note=note, note_override=None,
    )


def test_waypoint_keeps_its_player_coordinates():
    from gc_backend.services.outing_analysis_service import _serialize_waypoints

    geocache = SimpleNamespace(waypoints=[_waypoint(gc_coords='N 48° 51.400 E 002° 21.100')])
    serialized = _serialize_waypoints(geocache)

    assert serialized[0]['coordinates'] == 'N 48° 51.400 E 002° 21.100'
    assert serialized[0]['type'] == 'Parking Area'


def test_waypoint_falls_back_to_decimal_coordinates():
    from gc_backend.services.outing_analysis_service import _serialize_waypoints

    geocache = SimpleNamespace(waypoints=[_waypoint(latitude=48.85, longitude=2.35)])

    assert _serialize_waypoints(geocache)[0]['coordinates'] == '48.85, 2.35'


def test_waypoint_without_coordinates_says_so():
    """Un « Parking » sans coordonnées ne mène nulle part : le champ reste vide."""
    from gc_backend.services.outing_analysis_service import _serialize_waypoints

    geocache = SimpleNamespace(waypoints=[_waypoint()])

    assert _serialize_waypoints(geocache)[0]['coordinates'] is None


def test_unknown_coordinates_placeholder_counts_as_absent():
    """Geocaching.com stocke « ??? » pour un final non publié : c'est une absence."""
    from gc_backend.services.outing_analysis_service import _serialize_waypoints

    geocache = SimpleNamespace(waypoints=[_waypoint(prefix='FN', wp_type='Final Location',
                                                   gc_coords='???')])

    assert _serialize_waypoints(geocache)[0]['coordinates'] is None


def test_waypoint_type_is_cleaned_of_scraping_artefacts():
    """Le scraping laisse un retour à la ligne et une parenthèse orpheline dans le type."""
    from gc_backend.services.outing_analysis_service import _serialize_waypoints

    geocache = SimpleNamespace(waypoints=[_waypoint(wp_type='Parking Area)\n            ')])

    assert _serialize_waypoints(geocache)[0]['type'] == 'Parking Area'


def test_parking_waypoint_raises_a_context_signal():
    from gc_backend.services.outing_gear_signals import build_waypoint_signals

    signals = build_waypoint_signals([_waypoint(gc_coords='N 48 E 002')])

    assert len(signals) == 1
    assert signals[0]['signal'] == 'parking'
    assert signals[0]['source'] == 'waypoint'


def test_parking_waypoint_does_not_duplicate_the_attribute():
    from gc_backend.services.outing_gear_signals import build_gear_signals, build_waypoint_signals

    existing = build_gear_signals([{'name': 'Parking', 'base_filename': 'parking-yes'}])

    assert build_waypoint_signals([_waypoint()], existing) == []


def test_parking_waypoint_does_not_contradict_a_negative_attribute():
    """« Pas de parking à proximité » est une information du propriétaire : on la garde."""
    from gc_backend.services.outing_gear_signals import build_gear_signals, build_waypoint_signals

    existing = build_gear_signals(
        [{'name': 'Parking', 'base_filename': 'parking-no', 'is_negative': True}]
    )

    assert build_waypoint_signals([_waypoint()], existing) == []


def test_stage_waypoint_raises_nothing():
    from gc_backend.services.outing_gear_signals import build_waypoint_signals

    assert build_waypoint_signals([_waypoint(prefix='S1', name='Etape', wp_type='Stage')]) == []


def test_personal_note_is_kept_as_plain_text():
    from gc_backend.services.outing_analysis_service import _serialize_personal_note

    geocache = SimpleNamespace(gc_personal_note='<p>Parking rue des Lilas</p>')
    note, truncated = _serialize_personal_note(geocache)

    assert note == 'Parking rue des Lilas'
    assert truncated is False


def test_personal_note_is_truncated_and_says_so():
    from gc_backend.services.outing_analysis_service import (
        PERSONAL_NOTE_CHARS, _serialize_personal_note,
    )

    geocache = SimpleNamespace(gc_personal_note='mot ' * 400)
    note, truncated = _serialize_personal_note(geocache)

    assert truncated is True
    assert len(note) <= PERSONAL_NOTE_CHARS + 1  # le caractère d'ellipse


def test_absent_personal_note_returns_none():
    from gc_backend.services.outing_analysis_service import _serialize_personal_note

    assert _serialize_personal_note(SimpleNamespace(gc_personal_note=None)) == (None, False)


def _note(content, note_type='user', days_ago=0, source='user', plugin=None):
    return SimpleNamespace(
        content=content, note_type=note_type, source=source, source_plugin=plugin,
        updated_at=NOW - timedelta(days=days_ago), created_at=NOW - timedelta(days=days_ago),
    )


def test_notes_come_back_most_recent_first():
    from gc_backend.services.outing_analysis_service import _serialize_notes

    geocache = SimpleNamespace(notes=[_note('vieille', days_ago=90), _note('fraîche', days_ago=1)])
    serialized, total = _serialize_notes(geocache)

    assert [item['content_excerpt'] for item in serialized] == ['fraîche', 'vieille']
    assert total == 2


def test_notes_are_capped_but_the_total_is_reported():
    """Le total sert au prompt à dire qu'il n'a pas tout : mieux vaut ça qu'un silence."""
    from gc_backend.services.outing_analysis_service import MAX_NOTES, _serialize_notes

    geocache = SimpleNamespace(notes=[_note(f'note {index}', days_ago=index) for index in range(9)])
    serialized, total = _serialize_notes(geocache)

    assert len(serialized) == MAX_NOTES
    assert total == 9


def test_empty_notes_are_dropped():
    from gc_backend.services.outing_analysis_service import _serialize_notes

    serialized, total = _serialize_notes(SimpleNamespace(notes=[_note('   ')]))

    assert serialized == []
    assert total == 1


def _task(question='Couleur de la roche ?', guidance=None, answer=None,
          status='todo', requires_photo=False, position=0):
    return SimpleNamespace(
        question=question, guidance=guidance, answer=answer,
        status=status, requires_photo=requires_photo, position=position,
    )


def test_logging_tasks_carry_photo_and_answer_state():
    from gc_backend.services.outing_analysis_service import _serialize_logging_tasks

    geocache = SimpleNamespace(logging_tasks=[
        _task(guidance='Observer la paroi'),
        _task(question='Photo devant le panneau', answer='faite', status='answered',
              requires_photo=True, position=1),
    ])
    serialized = _serialize_logging_tasks(geocache)

    assert serialized[0]['guidance'] == 'Observer la paroi'
    assert serialized[0]['answered'] is False
    assert serialized[1]['requires_photo'] is True
    assert serialized[1]['answered'] is True


def test_logging_tasks_are_capped():
    from gc_backend.services.outing_analysis_service import (
        MAX_LOGGING_TASKS, _serialize_logging_tasks,
    )

    geocache = SimpleNamespace(logging_tasks=[_task(position=index) for index in range(20)])

    assert len(_serialize_logging_tasks(geocache)) == MAX_LOGGING_TASKS


def test_task_without_question_is_dropped():
    from gc_backend.services.outing_analysis_service import _serialize_logging_tasks

    assert _serialize_logging_tasks(SimpleNamespace(logging_tasks=[_task(question='  ')])) == []


# ─────────────────────────────────────────────────────────────────────────────
# Qualité de la source des logs
# ─────────────────────────────────────────────────────────────────────────────

def test_friend_and_favorite_flags_reach_every_log_selection():
    from gc_backend.services.outing_analysis_service import (
        _serialize_gear_logs, _serialize_recent_logs, _serialize_search_effort_logs,
    )

    log = _log('Found it', 5, text="il faut une canne à pêche, j'ai cherché longtemps")
    log.is_friend_log = True
    log.is_favorite = True

    for serialized in (
        _serialize_recent_logs([log], 5),
        _serialize_gear_logs([log], 5),
        _serialize_search_effort_logs([log]),
    ):
        assert serialized[0]['is_friend_log'] is True
        assert serialized[0]['is_favorite'] is True


def test_missing_flags_default_to_false_not_none():
    """`None` en base signifie « vérification impossible » : le prompt n'y voit qu'un non."""
    from gc_backend.services.outing_analysis_service import _serialize_recent_logs

    log = _log('Found it', 5)
    log.is_friend_log = None
    log.is_favorite = None

    serialized = _serialize_recent_logs([log], 5)[0]
    assert serialized['is_friend_log'] is False
    assert serialized['is_favorite'] is False


# ─────────────────────────────────────────────────────────────────────────────
# Balayage du listing et du hint
# ─────────────────────────────────────────────────────────────────────────────

def _geocache_with_listing(raw=None, html=None, override_raw=None, override_html=None):
    return SimpleNamespace(
        description_override_raw=override_raw,
        description_raw=raw,
        description_override_html=override_html,
        description_html=html,
    )


def test_listing_is_scanned_beyond_the_transmitted_excerpt():
    """La mention arrive souvent après l'histoire du lieu, donc hors de l'extrait."""
    from gc_backend.services.outing_analysis_service import (
        _listing_plain_text, _resolve_listing,
    )

    listing = 'blabla ' * 80 + 'et surtout, prévoyez une canne à pêche.'
    text = _listing_plain_text(_geocache_with_listing(raw=listing))
    excerpt, truncated = _resolve_listing(text, 100)

    assert truncated is True
    assert 'canne' not in excerpt
    assert 'fishing_rod' in find_gear_mentions(text)


def test_light_mode_drops_the_listing_but_not_its_mentions():
    """Le mode léger ne transmet aucun listing : le balayage reste la seule trace."""
    from gc_backend.services.outing_analysis_service import (
        _listing_plain_text, _resolve_listing,
    )

    text = _listing_plain_text(_geocache_with_listing(raw='Il faut un aimant puissant.'))

    assert _resolve_listing(text, 0) == ('', False)
    assert 'magnet' in find_gear_mentions(text)


def test_listing_html_is_scanned_as_plain_text():
    from gc_backend.services.outing_analysis_service import _listing_plain_text

    text = _listing_plain_text(_geocache_with_listing(html='<p>Prévoir une <b>échelle</b>.</p>'))

    assert 'ladder' in find_gear_mentions(text)


def test_corrected_listing_wins_over_the_original():
    from gc_backend.services.outing_analysis_service import _listing_plain_text

    geocache = _geocache_with_listing(raw='rien de spécial', override_raw='prévoir un aimant')

    assert 'magnet' in find_gear_mentions(_listing_plain_text(geocache))


def test_absent_listing_yields_no_mention():
    from gc_backend.services.outing_analysis_service import _listing_plain_text

    assert find_gear_mentions(_listing_plain_text(_geocache_with_listing())) == []


# ─────────────────────────────────────────────────────────────────────────────
# Pré-résolution des drapeaux
# ─────────────────────────────────────────────────────────────────────────────

def _special_tool_signals():
    return build_gear_signals([{'name': 'Outil spécial requis', 'base_filename': 's-tool-yes'}])


def test_listing_closes_the_special_tool_flag():
    signals = resolve_signals_from_text(_special_tool_signals(), [
        ('listing', find_gear_mentions("L'aimant est indispensable pour la sortir.")),
        ('hint', []),
    ])

    assert signals[0]['resolved'] is True
    assert signals[0]['resolved_from'] == 'listing'
    assert signals[0]['resolved_gear'] == ['magnet']
    assert count_unresolved(signals) == 0
    assert count_resolved_from_text(signals) == 1


def test_hint_closes_the_flag_when_the_listing_is_silent():
    signals = resolve_signals_from_text(_special_tool_signals(), [
        ('listing', find_gear_mentions('Une jolie balade en forêt.')),
        ('hint', find_gear_mentions('avec une canne à pêche')),
    ])

    assert signals[0]['resolved_from'] == 'hint'
    assert signals[0]['resolved_gear'] == ['fishing_rod']


def test_listing_wins_over_the_hint():
    """Sources ordonnées : le listing est le texte de référence du propriétaire."""
    signals = resolve_signals_from_text(_special_tool_signals(), [
        ('listing', find_gear_mentions('prévoir un aimant')),
        ('hint', find_gear_mentions('avec une canne à pêche')),
    ])

    assert signals[0]['resolved_from'] == 'listing'


def test_climbing_is_resolved_by_climbing_gear_only():
    """« Matériel de grimpe » ne se referme pas sur un aimant."""
    signals = build_gear_signals([{'name': 'Escalade', 'base_filename': 'climbing-yes'}])

    on_magnet = resolve_signals_from_text(signals, [('listing', ['magnet'])])
    on_rope = resolve_signals_from_text(signals, [('listing', ['rope'])])

    assert on_magnet[0]['resolved'] is False
    assert on_rope[0]['resolved_gear'] == ['rope']


def test_a_lamp_does_not_close_the_special_tool_flag():
    """« Lampe » a son propre attribut : la rattacher à l'outil spécial serait faux."""
    signals = resolve_signals_from_text(_special_tool_signals(), [
        ('listing', find_gear_mentions('prenez une lampe et des gants')),
    ])

    assert signals[0]['resolved'] is False
    assert signals[0]['resolved_from'] is None


def test_field_puzzle_stays_open_for_the_ai():
    """Aucun mot du lexique ne dit quelle énigme : le drapeau reste à l'IA."""
    signals = build_gear_signals([
        {'name': 'Énigme sur le terrain', 'base_filename': 'field_puzzle-yes'},
    ])
    resolved = resolve_signals_from_text(signals, [('listing', ['magnet', 'fishing_rod'])])

    assert resolved[0]['resolved'] is False


def test_resolved_attributes_are_left_untouched():
    signals = build_gear_signals([{'name': 'Lampe torche', 'base_filename': 'flashlight-yes'}])
    resolved = resolve_signals_from_text(signals, [('listing', ['flashlight'])])

    assert resolved[0]['resolved_from'] == 'attribute'
    assert count_resolved_from_text(resolved) == 0


def test_resolution_is_safe_without_signals_or_mentions():
    assert resolve_signals_from_text(None, [('listing', ['magnet'])]) == []
    assert resolve_signals_from_text(_special_tool_signals(), None)[0]['resolved'] is False


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
