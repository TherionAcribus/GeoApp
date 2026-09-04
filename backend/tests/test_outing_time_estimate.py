"""
Tests de l'estimation de temps déterministe (lot 9 de `documentation/analyse-ia-sortie-spec.md`).

Le module travaille sur des entrées de bundle et rien d'autre : aucun accès base, aucun
Flask. Les tests portent donc sur des dictionnaires écrits à la main.

Deux natures d'assertions cohabitent, et il faut les distinguer :

- les **ordres** (« une multi coûte plus qu'une traditionnelle », « une T5 plus qu'une
  T1 ») : c'est la promesse du module — être cohérent d'une cache à l'autre — et ils
  doivent tenir quelles que soient les constantes ;
- les **valeurs** exactes, vérifiées sur quelques cas seulement, pour qu'un changement de
  barème se voie sans figer toute la grille.
"""

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from gc_backend.services.outing_time_estimate import (  # noqa: E402
    ASSUMED_STAGES,
    MINUTES_PER_STAGE,
    QUICK_CAP_MINUTES,
    build_time_budget,
    build_travel_estimate,
    estimate_geocache_time,
    resolve_type_key,
)


def _entry(**overrides):
    """Traditionnelle sans particularité : D/T moyens bas, aucun signal, des logs."""
    entry = {
        'gc_code': 'GC1',
        'name': 'Cache',
        'type': 'Traditional',
        'difficulty': 1.5,
        'terrain': 1.5,
        'gear_signals': [],
        'waypoints': [],
        'search_effort_logs': [],
        'logging_tasks': [],
        'logging_tasks_photo_required': False,
        'health': {'logs_available': True},
        'found': False,
        'unsolved_mystery': False,
    }
    entry.update(overrides)
    return entry


def _signal(name, *, kind='gear', resolved=True, label=None, is_negative=False):
    return {
        'signal': name,
        'kind': kind,
        'resolved': resolved,
        'label': label or name,
        'slug': name,
        'source': 'attribute',
        'is_negative': is_negative,
    }


def _minutes(**overrides):
    return estimate_geocache_time(_entry(**overrides))['minutes']


# ─────────────────────────────────────────────────────────────────────────────
# Résolution du type
# ─────────────────────────────────────────────────────────────────────────────

def test_type_is_resolved_from_both_vocabularies():
    # « Traditional » côté scraper, « Traditional Cache » côté import GPX.
    assert resolve_type_key('Traditional') == 'traditional'
    assert resolve_type_key('Traditional Cache') == 'traditional'
    assert resolve_type_key('Multi-cache') == 'multi'
    assert resolve_type_key('Unknown Cache') == 'mystery'
    assert resolve_type_key('Earthcache') == 'earthcache'


def test_mega_event_is_not_read_as_a_plain_event():
    # « Mega-Event » contient « event » : l'ordre des mots-clés est ce qui les sépare.
    assert resolve_type_key('Mega-Event') == 'mega_event'
    assert resolve_type_key('Giga-Event') == 'giga_event'
    assert resolve_type_key('Event') == 'event'


def test_unknown_type_falls_back_without_failing():
    assert resolve_type_key(None) == 'traditional'
    assert resolve_type_key('Cache exotique') == 'traditional'


# ─────────────────────────────────────────────────────────────────────────────
# Cohérence des ordres
# ─────────────────────────────────────────────────────────────────────────────

def test_a_multi_costs_more_than_a_traditional():
    assert _minutes(type='Multi') > _minutes(type='Traditional')


def test_time_grows_with_difficulty():
    assert _minutes(difficulty=5) > _minutes(difficulty=3) > _minutes(difficulty=1)


def test_time_grows_with_terrain():
    assert _minutes(terrain=5) > _minutes(terrain=3) > _minutes(terrain=1)


def test_longer_hikes_cost_more_than_shorter_ones():
    short = _minutes(gear_signals=[_signal('hike_short', kind='context')])
    medium = _minutes(gear_signals=[_signal('hike_med', kind='context')])
    long_hike = _minutes(gear_signals=[_signal('hike_long', kind='context')])

    assert short < medium < long_hike


def test_only_the_longest_hike_signal_counts():
    # Les attributs de marche sont exclusifs dans l'esprit de geocaching.com : les
    # additionner ferait payer deux fois la même marche.
    both = _minutes(gear_signals=[
        _signal('hike_long', kind='context'),
        _signal('hike_short', kind='context'),
    ])
    only_long = _minutes(gear_signals=[_signal('hike_long', kind='context')])

    assert both == only_long


def test_search_effort_logs_add_time_with_diminishing_returns():
    one = _minutes(search_effort_logs=[{}])
    three = _minutes(search_effort_logs=[{}, {}, {}])
    none = _minutes()

    assert none < one < three
    assert three - none < 3 * (one - none)


# ─────────────────────────────────────────────────────────────────────────────
# Étapes
# ─────────────────────────────────────────────────────────────────────────────

def test_a_multi_without_published_waypoints_assumes_stages():
    estimate = estimate_geocache_time(_entry(type='Multi'))

    labels = ' '.join(component['label'] for component in estimate['components'])
    assert f'{ASSUMED_STAGES} étape(s) présumée(s)' in labels


def test_published_stages_replace_the_assumption_when_there_are_more():
    stages = [{'type': 'Stages of a Multicache'} for _ in range(4)]
    estimate = estimate_geocache_time(_entry(type='Multi', waypoints=stages))

    labels = ' '.join(component['label'] for component in estimate['components'])
    assert '4 étape(s)' in labels
    assert 'présumée' not in labels


def test_knowing_only_the_final_does_not_shrink_a_multi():
    # Avoir trouvé le final ne supprime pas les étapes qui y mènent : le plancher tient.
    known_final = _minutes(type='Multi', waypoints=[{'type': 'Final Location'}])
    assert known_final == _minutes(type='Multi')


def test_parking_and_reference_waypoints_are_not_stages():
    waypoints = [{'type': 'Parking Area'}, {'type': 'Reference Point'}, {'type': 'Trailhead'}]
    assert _minutes(waypoints=waypoints) == _minutes()


def test_a_stage_waypoint_on_a_mystery_is_counted_without_any_floor():
    one_stage = _minutes(type='Mystery', waypoints=[{'type': 'Stage'}])
    assert one_stage == _minutes(type='Mystery') + MINUTES_PER_STAGE


# ─────────────────────────────────────────────────────────────────────────────
# Cas particuliers de type
# ─────────────────────────────────────────────────────────────────────────────

def test_mystery_difficulty_weighs_less_than_traditional_difficulty():
    # Sur une mystery, la D note l'énigme — résolue à la maison — pas la fouille.
    mystery_gap = _minutes(type='Mystery', difficulty=5) - _minutes(type='Mystery', difficulty=1)
    traditional_gap = _minutes(difficulty=5) - _minutes(difficulty=1)

    assert 0 < mystery_gap < traditional_gap


def test_earthcache_ignores_difficulty_but_counts_its_questions():
    # Rien à fouiller : la difficulté ne coûte pas de temps de recherche.
    assert _minutes(type='Earthcache', difficulty=5) == _minutes(type='Earthcache', difficulty=1)

    with_questions = _minutes(
        type='Earthcache',
        logging_tasks=[{'answered': False}, {'answered': False}],
    )
    assert with_questions > _minutes(type='Earthcache')


def test_an_answered_question_costs_nothing_on_the_field():
    answered = _minutes(type='Earthcache', logging_tasks=[{'answered': True}])
    assert answered == _minutes(type='Earthcache')


def test_a_required_photo_adds_time():
    assert _minutes(logging_tasks_photo_required=True) > _minutes()


# ─────────────────────────────────────────────────────────────────────────────
# Signaux matériel
# ─────────────────────────────────────────────────────────────────────────────

def test_setup_heavy_signals_add_time():
    assert _minutes(gear_signals=[_signal('scuba')]) > _minutes(gear_signals=[_signal('wading')])
    assert _minutes(gear_signals=[_signal('climbing')]) > _minutes()


def test_a_signal_that_changes_the_bag_but_not_the_schedule_costs_nothing():
    # Une lampe ou des gants se prennent dans le sac : ils ne rallongent pas la visite.
    assert _minutes(gear_signals=[_signal('flashlight')]) == _minutes()
    assert _minutes(gear_signals=[_signal('protection')]) == _minutes()


def test_a_negative_signal_is_ignored():
    forbidden = _signal('dogs_forbidden', kind='context', is_negative=True)
    assert _minutes(gear_signals=[forbidden]) == _minutes()


def test_park_and_grab_caps_a_traditional():
    quick = _entry(
        difficulty=4,
        terrain=4,
        gear_signals=[_signal('quick', kind='context')],
    )
    estimate = estimate_geocache_time(quick)

    assert estimate['minutes'] == QUICK_CAP_MINUTES
    assert estimate['capped_park_and_grab'] is True


def test_park_and_grab_does_not_cap_a_multi():
    # `quick` fusionne « park & grab » et « moins d'une heure » : la seconde lecture ne
    # justifie aucun plafond, et sur une multi c'est la seule plausible.
    multi = _entry(type='Multi', gear_signals=[_signal('quick', kind='context')])
    assert estimate_geocache_time(multi)['capped_park_and_grab'] is False


# ─────────────────────────────────────────────────────────────────────────────
# Fourchette et confiance
# ─────────────────────────────────────────────────────────────────────────────

def test_the_range_brackets_the_estimate():
    estimate = estimate_geocache_time(_entry(difficulty=3, terrain=3))

    assert estimate['low_minutes'] <= estimate['minutes'] <= estimate['high_minutes']


def test_an_unresolved_flag_widens_the_range_without_moving_the_estimate():
    plain = estimate_geocache_time(_entry())
    flagged = estimate_geocache_time(_entry(gear_signals=[
        _signal('special_tool', resolved=False, label='outil spécial requis'),
    ]))

    assert flagged['confidence'] == 'low'
    assert flagged['confidence_reasons']
    spread_plain = plain['high_minutes'] - plain['low_minutes']
    spread_flagged = flagged['high_minutes'] - flagged['low_minutes']
    assert spread_flagged / flagged['minutes'] > spread_plain / plain['minutes']


def test_a_cache_without_local_logs_is_low_confidence():
    estimate = estimate_geocache_time(_entry(health={'logs_available': False}))

    assert estimate['confidence'] == 'low'
    assert any('log local' in reason for reason in estimate['confidence_reasons'])


def test_a_plain_easy_traditional_is_high_confidence():
    assert estimate_geocache_time(_entry())['confidence'] == 'high'


def test_components_explain_the_total():
    estimate = estimate_geocache_time(_entry(type='Multi', difficulty=3, terrain=4))

    assert estimate['components'][0]['label'] == 'base multi'
    # Le détail doit rendre compte du total, à l'arrondi au multiple de cinq près.
    assert abs(sum(c['minutes'] for c in estimate['components']) - estimate['minutes']) <= 3


def test_missing_ratings_do_not_break_the_estimate():
    estimate = estimate_geocache_time(_entry(difficulty=None, terrain=None, type=None))

    assert estimate['minutes'] > 0


# ─────────────────────────────────────────────────────────────────────────────
# Trajet
# ─────────────────────────────────────────────────────────────────────────────

def _route(*leg_km):
    legs = [{'position': 1, 'gc_code': 'GC0', 'name': 'Départ', 'leg_km': 0, 'cumulative_km': 0}]
    cumulative = 0.0
    for position, distance in enumerate(leg_km, start=2):
        cumulative += distance
        legs.append({
            'position': position,
            'gc_code': f'GC{position}',
            'name': f'Cache {position}',
            'leg_km': distance,
            'cumulative_km': round(cumulative, 2),
        })
    return {'route': {'strategy': 'nearest_neighbour_2opt', 'total_km': cumulative,
                      'longest_leg_km': max(leg_km), 'legs': legs}}


def test_no_route_means_no_invented_travel_time():
    assert build_travel_estimate(None) is None
    assert build_travel_estimate({'route': None}) is None
    assert build_travel_estimate({'route': {'legs': [{'position': 1, 'leg_km': 0}]}}) is None


def test_short_legs_are_walked_and_long_ones_driven():
    travel = build_travel_estimate(_route(0.2, 12.0))

    assert travel['driving_stops'] == 1
    assert travel['walking_minutes'] > 0
    assert travel['driving_minutes'] > 0
    assert travel['crow_flies_km'] == 12.2


def test_road_distance_is_longer_than_the_crow_flies_one():
    travel = build_travel_estimate(_route(20.0))

    assert travel['road_km_estimated'] > 20.0
    assert travel['assumptions']['road_detour_factor'] > 1


def test_travel_time_grows_with_distance():
    near = build_travel_estimate(_route(5.0))['minutes']
    far = build_travel_estimate(_route(50.0))['minutes']

    assert far > near


# ─────────────────────────────────────────────────────────────────────────────
# Budget de la sortie
# ─────────────────────────────────────────────────────────────────────────────

def test_budget_sums_the_caches_and_adds_the_travel():
    entries = [_entry(gc_code='GC1'), _entry(gc_code='GC2', type='Multi')]
    budget = build_time_budget(entries, _route(8.0))

    expected = sum(estimate_geocache_time(entry)['minutes'] for entry in entries)
    assert budget['on_site_minutes'] == expected
    assert budget['includes_travel'] is True
    assert budget['total_minutes'] == expected + budget['travel']['minutes']


def test_budget_reuses_the_estimate_already_attached_to_the_entry():
    # Le service pose `time_estimate` sur chaque entrée : le budget ne doit pas recalculer
    # une valeur différente de celle que l'IA va lire.
    entry = _entry()
    entry['time_estimate'] = {'minutes': 999, 'low_minutes': 900, 'high_minutes': 1100}

    assert build_time_budget([entry], None)['on_site_minutes'] == 999


def test_budget_without_travel_is_still_a_valid_total():
    budget = build_time_budget([_entry()], None)

    assert budget['travel'] is None
    assert budget['includes_travel'] is False
    assert budget['total_minutes'] == budget['on_site_minutes']


def test_range_only_widens_the_on_site_part():
    budget = build_time_budget([_entry(difficulty=4)], _route(10.0))
    travel = budget['travel']['minutes']

    assert budget['total_low_minutes'] == budget['on_site_low_minutes'] + travel
    assert budget['total_high_minutes'] == budget['on_site_high_minutes'] + travel


def test_already_found_and_unsolved_minutes_are_offered_not_deducted():
    entries = [
        _entry(gc_code='GC1'),
        _entry(gc_code='GC2', found=True),
        _entry(gc_code='GC3', type='Mystery', unsolved_mystery=True),
    ]
    budget = build_time_budget(entries, None)

    assert budget['already_found_minutes'] == estimate_geocache_time(entries[1])['minutes']
    assert budget['unsolved_mystery_minutes'] == estimate_geocache_time(entries[2])['minutes']
    # Rien n'est retranché : c'est au lecteur de décider ce qu'il retire.
    assert budget['on_site_minutes'] == sum(
        estimate_geocache_time(entry)['minutes'] for entry in entries
    )


def test_heaviest_caches_are_ranked_first():
    entries = [
        _entry(gc_code='GC1'),
        _entry(gc_code='GC2', type='Multi', terrain=5,
               gear_signals=[_signal('hike_long', kind='context')]),
        _entry(gc_code='GC3', terrain=3),
    ]
    budget = build_time_budget(entries, None)

    assert budget['heaviest'][0]['gc_code'] == 'GC2'
    assert len(budget['heaviest']) <= 3


def test_empty_selection_gives_a_zeroed_budget_rather_than_none():
    budget = build_time_budget([], None)

    assert budget['geocaches_count'] == 0
    assert budget['total_minutes'] == 0
    assert budget['heaviest'] == []
    assert budget['method']
