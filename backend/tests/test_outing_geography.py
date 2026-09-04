"""
Tests de la géographie de sortie (lot 8 de `documentation/analyse-ia-sortie-spec.md`).

Deux briques indépendantes de Flask et de la base : le calcul géométrique
(`outing_geography`) et les éphémérides solaires (`outing_sun`).

Les valeurs solaires de référence viennent des almanachs publics pour Paris ; la tolérance
retenue est de deux minutes, qui est l'ordre de grandeur de l'algorithme NOAA sans
correction d'altitude ni d'horizon local.
"""

import sys
from datetime import date
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from gc_backend.services.outing_geography import (  # noqa: E402
    WALKING_CLUSTER_KM,
    build_geography,
    haversine_km,
    split_usable_points,
)
from gc_backend.services.outing_sun import compute_sun_times  # noqa: E402

OUTING_DAY = date(2026, 9, 20)


def _entry(gc_code, latitude, longitude, **overrides):
    entry = {
        'gc_code': gc_code,
        'name': f'Cache {gc_code}',
        'latitude': latitude,
        'longitude': longitude,
        'unsolved_mystery': False,
    }
    entry.update(overrides)
    return entry


# ─────────────────────────────────────────────────────────────────────────────
# Distance
# ─────────────────────────────────────────────────────────────────────────────

def test_haversine_matches_known_distance():
    # Paris — Lyon : 392 km à vol d'oiseau selon les tables usuelles.
    distance = haversine_km(48.8566, 2.3522, 45.7640, 4.8357)
    assert 390 < distance < 394


def test_haversine_is_zero_on_the_same_point():
    assert haversine_km(48.0, 7.0, 48.0, 7.0) == 0.0


def test_haversine_is_symmetric():
    assert haversine_km(48.0, 7.0, 48.1, 7.1) == pytest.approx(haversine_km(48.1, 7.1, 48.0, 7.0))


# ─────────────────────────────────────────────────────────────────────────────
# Points exploitables
# ─────────────────────────────────────────────────────────────────────────────

def test_cache_without_coordinates_is_excluded_with_its_reason():
    points, excluded = split_usable_points([
        _entry('GC1', 48.0, 7.0),
        _entry('GC2', None, None),
    ])

    assert [point['gc_code'] for point in points] == ['GC1']
    assert excluded == [{'gc_code': 'GC2', 'reason': 'no_coordinates'}]


def test_unsolved_mystery_is_excluded_because_its_coordinates_lie():
    # Le point publié d'une mystery non résolue est un leurre : le faire entrer dans un
    # centroïde ou un ordre de visite reviendrait à calculer juste sur une donnée fausse.
    points, excluded = split_usable_points([
        _entry('GC1', 48.0, 7.0),
        _entry('GC2', 48.9, 7.9, unsolved_mystery=True),
    ])

    assert [point['gc_code'] for point in points] == ['GC1']
    assert excluded == [{'gc_code': 'GC2', 'reason': 'unsolved_mystery'}]


def test_non_numeric_coordinates_are_treated_as_absent():
    points, excluded = split_usable_points([_entry('GC1', 'nord', 'est')])

    assert points == []
    assert excluded[0]['reason'] == 'no_coordinates'


# ─────────────────────────────────────────────────────────────────────────────
# Étendue
# ─────────────────────────────────────────────────────────────────────────────

def test_bounding_box_and_spread_describe_the_area():
    geography = build_geography([
        _entry('GC1', 48.00, 7.00),
        _entry('GC2', 48.05, 7.10),
    ], outing_date=OUTING_DAY)

    box = geography['bounding_box']
    assert box['north'] == 48.05 and box['south'] == 48.0
    assert box['east'] == 7.10 and box['west'] == 7.0
    # ~0.05° de latitude ≈ 5,6 km ; ~0,1° de longitude à 48° ≈ 7,4 km.
    assert 5.0 < box['height_km'] < 6.0
    assert 7.0 < box['width_km'] < 8.0
    assert geography['max_pair_distance_km'] == pytest.approx(box['diagonal_km'], abs=0.05)


def test_single_point_has_a_centroid_and_a_sun_but_no_route():
    geography = build_geography([_entry('GC1', 48.0, 7.0)], outing_date=OUTING_DAY)

    assert geography['points_count'] == 1
    assert geography['centroid'] == {'latitude': 48.0, 'longitude': 7.0}
    assert geography['route'] is None
    assert geography['bounding_box'] is None
    # Une cache seule mérite quand même son heure de coucher du soleil.
    assert geography['sun']['sunset_local'] is not None


def test_empty_selection_yields_an_empty_but_complete_block():
    geography = build_geography([], outing_date=OUTING_DAY)

    assert geography['points_count'] == 0
    assert geography['centroid'] is None
    assert geography['sun'] is None
    assert geography['walking_clusters'] == []


# ─────────────────────────────────────────────────────────────────────────────
# Ordre de visite
# ─────────────────────────────────────────────────────────────────────────────

def test_route_visits_every_point_once():
    entries = [_entry(f'GC{i}', 48.0 + i * 0.01, 7.0 + i * 0.01) for i in range(6)]
    route = build_geography(entries, outing_date=OUTING_DAY)['route']

    visited = [leg['gc_code'] for leg in route['legs']]
    assert sorted(visited) == sorted(entry['gc_code'] for entry in entries)
    assert len(visited) == len(set(visited))


def test_route_follows_an_aligned_series_end_to_end():
    # Six points alignés et régulièrement espacés : l'ordre optimal est l'ordre naturel,
    # dans un sens ou dans l'autre. Les points sont fournis mélangés.
    entries = [_entry(f'GC{i}', 48.0 + i * 0.01, 7.0) for i in (3, 0, 5, 1, 4, 2)]
    route = build_geography(entries, outing_date=OUTING_DAY)['route']

    visited = [leg['gc_code'] for leg in route['legs']]
    assert visited in (
        ['GC0', 'GC1', 'GC2', 'GC3', 'GC4', 'GC5'],
        ['GC5', 'GC4', 'GC3', 'GC2', 'GC1', 'GC0'],
    )


def test_route_legs_accumulate_and_start_at_zero():
    entries = [_entry(f'GC{i}', 48.0 + i * 0.02, 7.0) for i in range(4)]
    route = build_geography(entries, outing_date=OUTING_DAY)['route']

    assert route['legs'][0]['leg_km'] == 0.0
    assert route['legs'][0]['cumulative_km'] == 0.0
    assert route['legs'][-1]['cumulative_km'] == pytest.approx(route['total_km'])
    assert route['longest_leg_km'] == max(leg['leg_km'] for leg in route['legs'])
    # Le cumul est croissant, sinon la ligne « cumul » ne veut rien dire.
    cumulated = [leg['cumulative_km'] for leg in route['legs']]
    assert cumulated == sorted(cumulated)


def test_two_opt_beats_the_naive_selection_order_on_a_trap():
    # Configuration où le glouton depuis le premier point traverse deux fois la zone.
    entries = [
        _entry('GC1', 48.000, 7.000),
        _entry('GC2', 48.000, 7.030),
        _entry('GC3', 48.001, 7.001),
        _entry('GC4', 48.001, 7.031),
    ]
    geography = build_geography(entries, outing_date=OUTING_DAY)

    naive = sum(
        haversine_km(
            entries[i]['latitude'], entries[i]['longitude'],
            entries[i + 1]['latitude'], entries[i + 1]['longitude'],
        )
        for i in range(len(entries) - 1)
    )
    assert geography['route']['total_km'] < naive


def test_route_ignores_the_excluded_caches():
    entries = [
        _entry('GC1', 48.0, 7.0),
        _entry('GC2', 48.01, 7.01),
        _entry('GC3', None, None),
        _entry('GC4', 49.0, 8.0, unsolved_mystery=True),
    ]
    geography = build_geography(entries, outing_date=OUTING_DAY)

    assert [leg['gc_code'] for leg in geography['route']['legs']] == ['GC1', 'GC2']
    assert {item['gc_code'] for item in geography['excluded']} == {'GC3', 'GC4'}


# ─────────────────────────────────────────────────────────────────────────────
# Groupes de marche
# ─────────────────────────────────────────────────────────────────────────────

def test_close_caches_form_a_walking_cluster():
    entries = [
        _entry('GC1', 48.0000, 7.0000),
        _entry('GC2', 48.0015, 7.0000),   # ~170 m
        _entry('GC3', 48.0500, 7.0500),   # loin
    ]
    clusters = build_geography(entries, outing_date=OUTING_DAY)['walking_clusters']

    assert len(clusters) == 1
    assert set(clusters[0]['gc_codes']) == {'GC1', 'GC2'}
    assert clusters[0]['count'] == 2
    assert clusters[0]['span_km'] < WALKING_CLUSTER_KM


def test_a_trail_of_caches_forms_one_cluster_by_single_linkage():
    # Chaque cache est à ~170 m de la suivante, les extrémités à ~500 m : c'est bien une
    # seule marche, et le lien simple est ce qui le reconnaît.
    entries = [_entry(f'GC{i}', 48.0 + i * 0.0015, 7.0) for i in range(4)]
    clusters = build_geography(entries, outing_date=OUTING_DAY)['walking_clusters']

    assert len(clusters) == 1
    assert clusters[0]['count'] == 4
    assert clusters[0]['span_km'] > WALKING_CLUSTER_KM


def test_isolated_caches_produce_no_cluster():
    entries = [_entry(f'GC{i}', 48.0 + i * 0.05, 7.0) for i in range(3)]

    assert build_geography(entries, outing_date=OUTING_DAY)['walking_clusters'] == []


# ─────────────────────────────────────────────────────────────────────────────
# Éphémérides solaires
# ─────────────────────────────────────────────────────────────────────────────

def _minutes_utc(iso: str) -> int:
    hour, minute = iso[11:13], iso[14:16]
    return int(hour) * 60 + int(minute)


@pytest.mark.parametrize('day, sunrise_utc, sunset_utc', [
    # Paris, valeurs d'almanach ramenées en UTC.
    (date(2026, 3, 20), 5 * 60 + 53, 18 * 60 + 2),    # équinoxe de printemps
    (date(2026, 6, 21), 3 * 60 + 47, 19 * 60 + 58),   # solstice d'été
    (date(2026, 12, 21), 7 * 60 + 42, 15 * 60 + 56),  # solstice d'hiver
])
def test_paris_sun_times_match_the_almanac(day, sunrise_utc, sunset_utc):
    sun = compute_sun_times(48.8566, 2.3522, day)

    assert abs(_minutes_utc(sun['sunrise_utc']) - sunrise_utc) <= 2
    assert abs(_minutes_utc(sun['sunset_utc']) - sunset_utc) <= 2


def test_civil_dusk_follows_sunset_and_dawn_precedes_sunrise():
    sun = compute_sun_times(48.8566, 2.3522, OUTING_DAY)

    assert _minutes_utc(sun['civil_dusk_utc']) > _minutes_utc(sun['sunset_utc'])
    assert _minutes_utc(sun['civil_dawn_utc']) < _minutes_utc(sun['sunrise_utc'])


def test_day_length_matches_sunrise_to_sunset():
    sun = compute_sun_times(48.8566, 2.3522, OUTING_DAY)
    measured = _minutes_utc(sun['sunset_utc']) - _minutes_utc(sun['sunrise_utc'])

    assert abs(sun['day_length_minutes'] - measured) <= 1


def test_summer_days_are_longer_than_winter_days():
    summer = compute_sun_times(48.8566, 2.3522, date(2026, 6, 21))['day_length_minutes']
    winter = compute_sun_times(48.8566, 2.3522, date(2026, 12, 21))['day_length_minutes']

    assert summer > winter + 400


def test_southern_hemisphere_reverses_the_seasons():
    december = compute_sun_times(-33.87, 151.21, date(2026, 12, 21))['day_length_minutes']
    june = compute_sun_times(-33.87, 151.21, date(2026, 6, 21))['day_length_minutes']

    assert december > june


@pytest.mark.parametrize('day, expected', [
    (date(2026, 6, 21), 'polar_day'),
    (date(2026, 12, 21), 'polar_night'),
])
def test_polar_latitudes_report_a_state_instead_of_a_missing_hour(day, expected):
    # Svalbard : l'absence d'heure de coucher est un fait, pas une donnée manquante.
    sun = compute_sun_times(78.22, 15.65, day)

    assert sun['polar_state'] == expected
    assert sun['sunset_utc'] is None
    assert sun['day_length_minutes'] is None
    # Le midi solaire, lui, existe toujours : c'est ce qui rend la journée interprétable.
    assert sun['solar_noon_utc'] is not None


def test_sun_is_computed_at_the_centroid_of_the_outing():
    geography = build_geography([
        _entry('GC1', 48.0, 7.0),
        _entry('GC2', 48.2, 7.4),
    ], outing_date=OUTING_DAY)

    assert geography['sun']['latitude'] == pytest.approx(48.1)
    assert geography['sun']['longitude'] == pytest.approx(7.2)
    assert geography['sun']['date'] == OUTING_DAY.isoformat()


def test_a_later_date_moves_the_sunset():
    # La date de sortie n'est pas décorative : deux mois d'écart valent plus d'une heure.
    september = build_geography([_entry('GC1', 48.0, 7.0)], outing_date=date(2026, 9, 20))
    november = build_geography([_entry('GC1', 48.0, 7.0)], outing_date=date(2026, 11, 20))

    assert _minutes_utc(september['sun']['sunset_utc']) > _minutes_utc(november['sun']['sunset_utc']) + 60
