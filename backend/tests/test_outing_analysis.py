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
    build_waypoint_signals,
    count_resolved_from_text,
    count_unresolved,
    covered_attribute_slugs,
    resolve_attribute_slug,
    resolve_signals_from_text,
)
from gc_backend.services.outing_health import compute_health  # noqa: E402
from gc_backend.services.outing_lexicons import (  # noqa: E402
    GEAR_LEXICON,
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
# Attributs absorbés par un signal : ne pas payer deux fois la même information
# ─────────────────────────────────────────────────────────────────────────────

def test_a_signal_covers_the_attribute_that_produced_it():
    signals = build_gear_signals([
        {'name': 'Lampe torche requise', 'is_negative': False, 'base_filename': 'flashlight-yes'},
    ])
    assert signals[0]['covers'] == ['flashlight']
    assert covered_attribute_slugs(signals) == {'flashlight'}


def test_a_deduplicated_attribute_is_covered_too():
    """`rappelling` disparait des signaux, mais pas de la liste de ce qui est deja dit."""
    signals = build_gear_signals([
        {'name': 'Escalade', 'is_negative': False, 'base_filename': 'climbing-yes'},
        {'name': 'Rappel', 'is_negative': False, 'base_filename': 'rappelling-yes'},
    ])
    assert [signal['signal'] for signal in signals] == ['climbing']
    assert covered_attribute_slugs(signals) == {'climbing', 'rappelling'}


def test_an_attribute_without_signal_is_not_covered():
    """Un attribut decoratif n'a personne pour le dire : il doit rester dans le prompt."""
    signals = build_gear_signals([
        {'name': 'Point de vue', 'is_negative': False, 'base_filename': 'scenic-yes'},
        {'name': 'Lampe torche requise', 'is_negative': False, 'base_filename': 'flashlight-yes'},
    ])
    assert covered_attribute_slugs(signals) == {'flashlight'}


def test_a_negative_attribute_without_context_stays_visible():
    """`flashlight-no` ne produit aucun signal : il ne doit donc pas etre marque couvert."""
    signals = build_gear_signals([
        {'name': 'Lampe torche', 'is_negative': True, 'base_filename': 'flashlight-no'},
    ])
    assert covered_attribute_slugs(signals) == set()


def test_waypoint_signals_cover_no_attribute():
    signals = build_waypoint_signals([SimpleNamespace(type='Parking Area')])
    assert covered_attribute_slugs(signals) == set()


def test_serialized_attributes_carry_their_slug_and_coverage():
    from gc_backend.services.outing_analysis_service import _serialize_attributes

    attributes = [
        {'name': 'Lampe torche requise', 'is_negative': False, 'base_filename': 'flashlight-yes'},
        {'name': 'Point de vue', 'is_negative': False, 'base_filename': 'scenic-yes'},
    ]
    geocache = SimpleNamespace(attributes=attributes)
    signals = build_gear_signals(attributes)

    serialized = _serialize_attributes(geocache, covered_attribute_slugs(signals))
    assert [entry['covered_by_signal'] for entry in serialized] == [True, False]
    assert [entry['slug'] for entry in serialized] == ['flashlight', 'scenic']


# ─────────────────────────────────────────────────────────────────────────────
# Table des identifiants GPX
# ─────────────────────────────────────────────────────────────────────────────

#: Intitules anglais officiels des attributs Geocaching.com, pour les identifiants que la
#: table couvre. Ils servent de **contre-epreuve** : la table part des noms d'icone, cette
#: liste des libelles, et les deux doivent tomber sur le meme signal. Faute d'un GPX reel
#: dans le depot, c'est ce croisement qui tient la dette ouverte depuis le lot 1.
_OFFICIAL_ATTRIBUTE_LABELS = {
    '1': 'Dogs',
    '2': 'Access or parking fee',
    '3': 'Climbing gear',
    '4': 'Boat',
    '5': 'Scuba gear',
    '6': 'Recommended for kids',
    '7': 'Takes less than an hour',
    '9': 'Significant hike',
    '10': 'Difficult climbing',
    '11': 'May require wading',
    '12': 'May require swimming',
    '13': 'Available at all times',
    '14': 'Recommended at night',
    '15': 'Available during winter',
    '17': 'Poison plants',
    '18': 'Dangerous animals',
    '19': 'Ticks',
    '20': 'Abandoned mines',
    '21': 'Cliff / falling rocks',
    '22': 'Hunting',
    '23': 'Dangerous area',
    '24': 'Wheelchair accessible',
    '25': 'Parking available',
    '26': 'Public transportation',
    '32': 'Bicycles',
    '39': 'Thorns',
    '40': 'Stealth required',
    '41': 'Stroller accessible',
    '44': 'Flashlight required',
    '47': 'Field puzzle',
    '48': 'UV light required',
    '49': 'Snowshoes',
    '50': 'Cross country skis',
    '51': 'Special tool required',
    '52': 'Night cache',
    '53': 'Park and grab',
    '54': 'Abandoned structure',
    '55': 'Short hike (less than 1km)',
    '56': 'Medium hike (1km-10km)',
    '57': 'Long hike (+10km)',
    '60': 'Wireless beacon',
    '61': 'Partnership cache',
    '62': 'Seasonal access',
    '64': 'Tree climbing',
    '66': 'Teamwork required',
    '69': 'Bonus cache',
    '70': 'Power trail',
    '71': 'Challenge cache',
}


def _signal_of_slug(slug):
    """Signal produit par un slug, au positif comme au negatif."""
    from gc_backend.services.outing_gear_signals import _NEGATIVE_CONTEXT, _SLUG_SIGNALS

    spec = _SLUG_SIGNALS.get(slug) or _NEGATIVE_CONTEXT.get(slug)
    return spec[0] if spec else None


def test_every_gpx_attribute_id_maps_to_a_known_slug():
    """Un identifiant qui pointe vers un slug inconnu ne leverait jamais de signal."""
    from gc_backend.services.outing_gear_signals import _ATTRIBUTE_ID_TO_SLUG

    unknown = {
        attribute_id: slug
        for attribute_id, slug in _ATTRIBUTE_ID_TO_SLUG.items()
        if _signal_of_slug(slug) is None
    }
    assert unknown == {}


def test_gpx_attribute_ids_agree_with_labels():
    """
    Contre-epreuve de la table des identifiants, sans GPX.

    Chaque intitule anglais officiel repasse par la resolution **par libelle**, qui est
    une table independante. Quand elle reconnait l'intitule, le signal obtenu doit etre
    celui de l'identifiant. La comparaison porte sur le signal et non sur le slug :
    `Climbing gear` (id 3, icone `rappelling`) et `Difficult climbing` (id 10) sont deux
    slugs distincts pour un meme signal `climbing`, et c'est le signal qui compte.
    """
    from gc_backend.services.outing_gear_signals import _ATTRIBUTE_ID_TO_SLUG, _slug_from_name

    checked = 0
    for attribute_id, label in _OFFICIAL_ATTRIBUTE_LABELS.items():
        assert attribute_id in _ATTRIBUTE_ID_TO_SLUG, f'identifiant {attribute_id} absent'
        from_name = _slug_from_name(label)
        if from_name is None:
            continue  # Aucun mot-cle pour cet intitule : rien a confronter.
        checked += 1
        assert _signal_of_slug(from_name) == _signal_of_slug(_ATTRIBUTE_ID_TO_SLUG[attribute_id]), (
            f'identifiant {attribute_id} ({label}) : '
            f'{_ATTRIBUTE_ID_TO_SLUG[attribute_id]} vs {from_name}'
        )

    # Garde-fou : si la table des mots-cles se vide, le test ne doit pas passer a vide.
    assert checked >= 20


def test_dogs_and_bicycles_survive_a_gpx_import():
    """
    Les deux attributs qui ne parlent qu'au negatif, et que le GPX portait sans slug.

    Sans leur identifiant dans la table, « chiens interdits » et « velos interdits » ne
    ressortaient d'un GPX ni par slug (absent) ni par libelle (aucun mot-cle) : la
    contrainte disparaissait sans bruit, alors que le scraping, lui, la voyait.
    """
    signals = build_gear_signals([
        {'name': 'Dogs', 'is_negative': True, 'gc_attribute_id': '1'},
        {'name': 'Bicycles', 'is_negative': True, 'gc_attribute_id': '32'},
    ])
    assert {signal['signal'] for signal in signals} == {'dogs_forbidden', 'no_bicycles'}



# ─────────────────────────────────────────────────────────────────────────────
# Coordonnées finales : deux problèmes distincts, deux drapeaux
# ─────────────────────────────────────────────────────────────────────────────

def _final_waypoint(wp_type, gc_coords=None, latitude=None, longitude=None):
    return SimpleNamespace(
        type=wp_type, gc_coords=gc_coords, latitude=latitude, longitude=longitude,
        prefix='FN', name='Final', note=None, note_override=None,
    )


def _cache(cache_type, *, solved='not_solved', is_corrected=False, waypoints=()):
    return SimpleNamespace(
        type=cache_type, solved=solved, is_corrected=is_corrected, waypoints=list(waypoints),
    )


def test_multi_without_final_waypoint_has_an_unknown_final():
    from gc_backend.services.outing_analysis_service import _is_final_unknown, _is_unsolved_mystery

    multi = _cache('Multi-cache', waypoints=[_final_waypoint('Parking Area', 'N 48° 00.000')])
    assert _is_final_unknown(multi) is True
    # Et surtout pas l'autre drapeau : ses coordonnees publiees, elles, sont bonnes.
    assert _is_unsolved_mystery(multi) is False


def test_letterbox_and_wherigo_are_treated_like_a_multi():
    from gc_backend.services.outing_analysis_service import _is_final_unknown

    assert _is_final_unknown(_cache('Letterbox Hybrid')) is True
    assert _is_final_unknown(_cache('Wherigo Cache')) is True


def test_a_coted_final_waypoint_closes_the_question():
    from gc_backend.services.outing_analysis_service import _is_final_unknown

    known = _cache('Multi-cache', waypoints=[_final_waypoint('Final Location', 'N 48° 12.345 E 007° 00.000')])
    assert _is_final_unknown(known) is False


def test_a_final_waypoint_without_coordinates_closes_nothing():
    """Geocaching.com ecrit « ??? » quand le final n'est pas publie : c'est une absence."""
    from gc_backend.services.outing_analysis_service import _is_final_unknown

    masked = _cache('Multi-cache', waypoints=[_final_waypoint('Final Location', '???')])
    assert _is_final_unknown(masked) is True


def test_corrected_or_solved_coordinates_close_the_question():
    from gc_backend.services.outing_analysis_service import _is_final_unknown

    assert _is_final_unknown(_cache('Multi-cache', is_corrected=True)) is False
    assert _is_final_unknown(_cache('Multi-cache', solved='solved')) is False


def test_a_traditional_never_has_an_unknown_final():
    from gc_backend.services.outing_analysis_service import _is_final_unknown

    assert _is_final_unknown(_cache('Traditional Cache')) is False


def test_a_mystery_keeps_its_own_flag_and_only_it():
    """
    Les deux drapeaux sont disjoints par construction.

    Une mystery non resolue est deja dite par `unsolved_mystery`, qui porte une
    consequence plus grave : ses coordonnees publiees mentent. La redire en « final
    inconnu » couterait des tokens pour affaiblir l'alerte.
    """
    from gc_backend.services.outing_analysis_service import _is_final_unknown, _is_unsolved_mystery

    mystery = _cache('Unknown Cache')
    assert _is_unsolved_mystery(mystery) is True
    assert _is_final_unknown(mystery) is False


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


def test_search_effort_mentions_name_the_expressions():
    """
    Le seul appelant qui a besoin du détail, et le seul motif resté terme par terme.

    Le drapeau et la liste doivent rester d'accord : c'est ce que ce test tient.
    """
    from gc_backend.services.outing_lexicons import find_search_effort_mentions

    mentions = find_search_effort_mentions("bien cachée, j'ai cherché longtemps")
    assert 'bien cachée' in mentions
    assert "j'ai cherché" in mentions
    assert find_search_effort_mentions('TFTC') == []
    assert bool(mentions) is has_search_effort_hint("bien cachée, j'ai cherché longtemps")


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


# Le balayage groupe les termes d'une clé en un seul motif, au lieu d'un motif par terme.
# Les deux tests ci-dessous tiennent les deux bouts de ce regroupement : chaque terme doit
# toujours être vu, et deux clés ne doivent pas se voler la vedette.

@pytest.mark.parametrize('key,term', [
    (key, term)
    for key, terms in GEAR_LEXICON.items()
    for term in terms
])
def test_every_lexicon_term_is_still_detected_and_located(key, term):
    from gc_backend.services.outing_lexicons import first_gear_position

    sentence = f'debut du log, {term} au milieu, puis la suite'
    assert key in find_gear_mentions(sentence)
    assert first_gear_position(normalize(sentence), [key]) == normalize(sentence).index(
        normalize(term)
    )


def test_two_keys_can_match_the_same_words():
    """Un motif par clé, pas un pour tout le lexique : « lampe uv » vaut les deux."""
    matches = find_gear_mentions('prévoir une lampe uv')
    assert 'flashlight' in matches
    assert 'uv_light' in matches


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
        prepare_logs,
    )

    log = _log('Found it', 5, text="il faut une canne à pêche, j'ai cherché longtemps")
    log.is_friend_log = True
    log.is_favorite = True
    prepared = prepare_logs([log])

    for serialized in (
        _serialize_recent_logs(prepared, 5),
        _serialize_gear_logs(prepared, 5),
        _serialize_search_effort_logs(prepared),
    ):
        assert serialized[0]['is_friend_log'] is True
        assert serialized[0]['is_favorite'] is True


def test_missing_flags_default_to_false_not_none():
    """`None` en base signifie « vérification impossible » : le prompt n'y voit qu'un non."""
    from gc_backend.services.outing_analysis_service import (
        _serialize_recent_logs, prepare_logs,
    )

    log = _log('Found it', 5, text='TFTC')
    log.is_friend_log = None
    log.is_favorite = None

    serialized = _serialize_recent_logs(prepare_logs([log]), 5)[0]
    assert serialized['is_friend_log'] is False
    assert serialized['is_favorite'] is False


# ─────────────────────────────────────────────────────────────────────────────
# Préparation du texte des logs
# ─────────────────────────────────────────────────────────────────────────────

def test_recent_logs_skip_the_ones_without_text():
    """
    Un « Found it » sans commentaire ne prend pas une des N places.

    La santé porte déjà sa date et son type ; l'extrait vide, lui, ne coûterait que des
    tokens.
    """
    from gc_backend.services.outing_analysis_service import (
        _serialize_recent_logs, prepare_logs,
    )

    logs = [
        _log('Found it', 1, text=''),
        _log('Found it', 2, text='   '),
        _log("Didn't find it", 3, text='rien vu, revenir avec une lampe'),
    ]
    serialized = _serialize_recent_logs(prepare_logs(logs), 2)

    assert len(serialized) == 1
    assert serialized[0]['text_excerpt'].startswith('rien vu')


def test_recent_logs_still_fill_their_quota_past_the_empty_ones():
    from gc_backend.services.outing_analysis_service import (
        _serialize_recent_logs, prepare_logs,
    )

    logs = [_log('Found it', 1, text='')] + [
        _log('Found it', day, text=f'log numero {day}') for day in range(2, 6)
    ]
    serialized = _serialize_recent_logs(prepare_logs(logs), 3)

    assert [entry['text_excerpt'] for entry in serialized] == [
        'log numero 2', 'log numero 3', 'log numero 4',
    ]


def test_excerpt_opens_on_the_mention_that_was_detected():
    """
    Le positionnement suit les mêmes motifs que la détection.

    « tube » n'est pas retenu à l'intérieur de « tuberculose » : l'extrait doit s'ouvrir
    sur le vrai tube, plus loin, et non sur le mot qui l'englobe.
    """
    from gc_backend.services.outing_analysis_service import (
        _excerpt_around, prepare_logs,
    )

    text = 'tuberculose ' + ('blabla ' * 60) + 'il faut un tube ' + ('suite ' * 60)
    excerpt = _excerpt_around(prepare_logs([_log('Found it', 1, text=text)])[0], ['straw_tube'])

    assert 'il faut un tube' in excerpt
    assert not excerpt.startswith('tuberculose')


def test_excerpt_without_mention_falls_back_to_the_beginning():
    from gc_backend.services.outing_analysis_service import (
        _excerpt_around, prepare_logs,
    )

    text = 'debut du log ' + ('blabla ' * 100)
    excerpt = _excerpt_around(prepare_logs([_log('Found it', 1, text=text)])[0])

    assert excerpt.startswith('debut du log')
    assert excerpt.endswith('…')


def test_prepared_log_flags_a_normalisation_that_shifts_positions():
    """
    Accent déjà décomposé en base : le texte normalisé est plus court que l'original.

    Reporter une position de l'un sur l'autre couperait l'extrait au mauvais endroit ;
    `aligned` est le drapeau qui fait renoncer au centrage.
    """
    from gc_backend.services.outing_analysis_service import prepare_logs

    aligned, shifted = prepare_logs([
        _log('Found it', 1, text='canne à pêche'),
        _log('Found it', 1, text='canne à pêche'),
    ])

    assert aligned.aligned is True
    assert shifted.aligned is False
    # La détection, elle, reste bonne dans les deux cas : elle n'a pas besoin des positions.
    assert find_gear_mentions(shifted.text) == ['fishing_rod']


def test_health_trusts_a_presorted_list():
    """`presorted` ne change rien quand la promesse est tenue."""
    logs = [
        _log("Didn't find it", 3),
        _log("Didn't find it", 10),
        _log('Found it', 40),
        _log('Write note', 0, dated=False),
    ]

    assert compute_health(logs, now=NOW, presorted=True) == compute_health(logs, now=NOW)


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


def test_outing_date_is_parsed_from_the_payload():
    from datetime import date

    from gc_backend.blueprints.geocaches import _parse_outing_date

    assert _parse_outing_date({'outing_date': '2026-12-24'}) == date(2026, 12, 24)
    # Datetime ISO complet : seule la partie calendaire nous intéresse.
    assert _parse_outing_date({'outing_date': '2026-12-24T08:00:00'}) == date(2026, 12, 24)


def test_unreadable_outing_date_falls_back_instead_of_failing():
    from gc_backend.blueprints.geocaches import _parse_outing_date

    # Elle ne pilote que le calcul solaire : refuser l'analyse entière serait
    # disproportionné. Le service retombe alors sur le jour même.
    assert _parse_outing_date({}) is None
    assert _parse_outing_date({'outing_date': ''}) is None
    assert _parse_outing_date({'outing_date': '24/12/2026'}) is None
    assert _parse_outing_date({'outing_date': 42}) is None


def test_empty_bundle_still_carries_its_date_and_geography():
    from datetime import date

    from gc_backend.services.outing_analysis_service import build_analysis_bundle

    bundle = build_analysis_bundle([], outing_date=date(2026, 12, 24))

    assert bundle['outing_date'] == '2026-12-24'
    # Le bloc est toujours là, même vide : son absence se lirait comme un oubli.
    assert bundle['geography']['points_count'] == 0
    assert bundle['geography']['sun'] is None
    # Le budget temps aussi : un total nul est une réponse, pas une absence de réponse.
    assert bundle['time_budget']['geocaches_count'] == 0
    assert bundle['time_budget']['total_minutes'] == 0


# ─────────────────────────────────────────────────────────────────────────────
# Ordre des logs : le contrat sur lequel `presorted` s'appuie
# ─────────────────────────────────────────────────────────────────────────────

@pytest.fixture
def db_app():
    """Application avec base en mémoire : le bundle complet, requête SQL comprise."""
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


def test_the_query_orders_logs_exactly_as_health_expects(db_app):
    """
    Les logs datés d'abord, du plus récent au plus ancien, puis les non datés.

    C'est le tri que `compute_health` faisait pour son compte et qu'elle ne fait plus
    quand on lui promet `presorted`. Le test pointe la promesse, pas la clause SQL qui la
    tient : une place de log qui bouge décale le calcul de santé sans rien lever.
    """
    from gc_backend.database import db
    from gc_backend.geocaches.models import Geocache, GeocacheLog
    from gc_backend.models import Zone
    from gc_backend.services.outing_analysis_service import build_analysis_bundle

    zone = Zone(name='Zone de test')
    db.session.add(zone)
    db.session.flush()

    geocache = Geocache(gc_code='GCTEST', name='Test', type='Traditional', zone_id=zone.id)
    db.session.add(geocache)
    db.session.flush()

    db.session.add_all([
        GeocacheLog(geocache_id=geocache.id, log_type='Write note',
                    date=None, text='sans date', author='Anon'),
        GeocacheLog(geocache_id=geocache.id, log_type='Found it',
                    date=NOW - timedelta(days=400), text='vieille trouvaille', author='Toto'),
        GeocacheLog(geocache_id=geocache.id, log_type="Didn't find it",
                    date=NOW - timedelta(days=3), text='rien vu', author='Titi'),
        GeocacheLog(geocache_id=geocache.id, log_type="Didn't find it",
                    date=NOW - timedelta(days=1), text='rien vu non plus', author='Tata'),
    ])
    db.session.commit()

    bundle = build_analysis_bundle([geocache.id], now=NOW)
    entry = bundle['geocaches'][0]

    assert [log['author'] for log in entry['recent_logs']] == ['Tata', 'Titi', 'Toto', 'Anon']
    # Deux DNF en tête, la trouvaille ferme la série : c'est ce que le tri garantit.
    assert entry['health']['consecutive_dnf'] == 2
    assert entry['health']['days_since_last_found'] == 400


# ─────────────────────────────────────────────────────────────────────────────
# Mémo du bundle et ETag
# ─────────────────────────────────────────────────────────────────────────────

def _seed_geocache(gc_code='GCMEMO'):
    """Une geocache et son log, commites. Renvoie l'identifiant."""
    from gc_backend.database import db
    from gc_backend.geocaches.models import Geocache, GeocacheLog
    from gc_backend.models import Zone

    zone = Zone(name=f'Zone {gc_code}')
    db.session.add(zone)
    db.session.flush()

    geocache = Geocache(gc_code=gc_code, name='Memo', type='Traditional', zone_id=zone.id)
    db.session.add(geocache)
    db.session.flush()
    db.session.add(GeocacheLog(
        geocache_id=geocache.id, log_type='Found it',
        date=NOW - timedelta(days=2), text='trouve', author='Toto',
    ))
    db.session.commit()
    return geocache.id


_CACHE_OPTIONS = {'listing_chars': 1800, 'recent_logs_count': 5, 'gear_logs_count': 8}


def test_the_second_identical_call_comes_from_the_memo(db_app):
    from gc_backend.services.outing_bundle_cache import (
        build_analysis_bundle_cached,
        clear_bundle_cache,
    )

    clear_bundle_cache()
    geocache_id = _seed_geocache()

    first, first_etag, first_cached = build_analysis_bundle_cached([geocache_id], **_CACHE_OPTIONS)
    second, second_etag, second_cached = build_analysis_bundle_cached([geocache_id], **_CACHE_OPTIONS)

    assert first_cached is False
    assert second_cached is True
    assert first_etag == second_etag != ''
    assert second is first


def test_a_new_log_invalidates_the_memo(db_app):
    """Le cas reel : le pre-vol rafraichit les logs, la relance doit les voir."""
    from gc_backend.database import db
    from gc_backend.geocaches.models import GeocacheLog
    from gc_backend.services.outing_bundle_cache import (
        build_analysis_bundle_cached,
        clear_bundle_cache,
    )

    clear_bundle_cache()
    geocache_id = _seed_geocache()
    _, first_etag, _ = build_analysis_bundle_cached([geocache_id], **_CACHE_OPTIONS)

    db.session.add(GeocacheLog(
        geocache_id=geocache_id, log_type="Didn't find it",
        date=NOW, text='rien vu', author='Titi',
    ))
    db.session.commit()

    bundle, etag, from_cache = build_analysis_bundle_cached([geocache_id], **_CACHE_OPTIONS)
    assert from_cache is False
    assert etag != first_etag
    assert bundle['geocaches'][0]['health']['consecutive_dnf'] == 1


def test_editing_the_geocache_itself_invalidates_the_memo(db_app):
    """
    Le cas que `geocache.updated_at` a ete ajoutee pour couvrir.

    Corriger des coordonnees ne touche ni les logs, ni les waypoints, ni les notes : sans
    marqueur sur la ligne elle-meme, le memo aurait resservi l'ancienne analyse a celui
    qui venait justement de resoudre l'enigme.
    """
    from gc_backend.database import db
    from gc_backend.geocaches.models import Geocache
    from gc_backend.services.outing_bundle_cache import (
        build_analysis_bundle_cached,
        clear_bundle_cache,
    )

    clear_bundle_cache()
    geocache_id = _seed_geocache()
    _, first_etag, _ = build_analysis_bundle_cached([geocache_id], **_CACHE_OPTIONS)

    geocache = db.session.get(Geocache, geocache_id)
    geocache.is_corrected = True
    geocache.coordinates_raw = 'N 48° 12.345 E 007° 00.000'
    db.session.commit()

    bundle, etag, from_cache = build_analysis_bundle_cached([geocache_id], **_CACHE_OPTIONS)
    assert from_cache is False
    assert etag != first_etag
    assert bundle['geocaches'][0]['is_corrected'] is True


def test_different_options_are_different_bundles(db_app):
    from gc_backend.services.outing_bundle_cache import (
        build_analysis_bundle_cached,
        clear_bundle_cache,
    )

    clear_bundle_cache()
    geocache_id = _seed_geocache()

    _, standard, _ = build_analysis_bundle_cached([geocache_id], **_CACHE_OPTIONS)
    _, lean, from_cache = build_analysis_bundle_cached(
        [geocache_id], **{**_CACHE_OPTIONS, 'listing_chars': 0}
    )
    assert lean != standard
    assert from_cache is False


def test_the_endpoint_answers_304_to_a_known_etag(db_app):
    """L'ETag sert a quelque chose : le corps n'est pas renvoye deux fois pour rien."""
    from gc_backend.services.outing_bundle_cache import clear_bundle_cache

    clear_bundle_cache()
    geocache_id = _seed_geocache()
    client = db_app.test_client()

    first = client.post('/api/geocaches/analysis-bundle', json={'ids': [geocache_id]})
    assert first.status_code == 200
    etag = first.headers.get('ETag')
    assert etag

    again = client.post(
        '/api/geocaches/analysis-bundle',
        json={'ids': [geocache_id]},
        headers={'If-None-Match': etag},
    )
    assert again.status_code == 304
    assert again.get_data() == b''
