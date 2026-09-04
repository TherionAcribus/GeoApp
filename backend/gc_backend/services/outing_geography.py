"""
Géographie d'une sortie : étendue, ordre de visite, groupes de marche.

Les coordonnées sont en base depuis toujours et n'arrivaient pourtant jamais jusqu'à
l'IA autrement que sous forme de texte par cache. Le prompt système lui interdisait donc
— à raison — d'énoncer la moindre distance : elle n'aurait pu que l'inventer. Ce module
lève cette interdiction en calculant ce qui est calculable, pour que le rapport puisse
enfin parler de proximité, d'ordre et de temps de trajet.

Trois produits, du plus général au plus opérationnel :

- **l'étendue** (centroïde, boîte englobante, écart maximal) : dit en une ligne si la
  sortie tient dans un village ou traverse un département ;
- **l'ordre de visite** : plus proche voisin lancé depuis *chaque* départ possible, puis
  amélioré par 2-opt. Ce n'est pas l'itinéraire optimal — c'en est un bon, obtenu sans
  bibliothèque ni service externe, et il vaut infiniment mieux que l'ordre de sélection ;
- **les groupes de marche** : les caches assez proches pour s'enchaîner à pied depuis un
  même stationnement. C'est ce qui structure vraiment une journée.

**Toutes les distances sont à vol d'oiseau.** Aucun réseau routier n'est consulté, aucun
dénivelé n'est connu : le chiffre est un plancher, jamais une durée. Le prompt système le
répète au modèle, parce que c'est la confusion qui coûterait le plus cher.

**Une mystery non résolue est écartée du calcul**, comme une cache sans coordonnées : ses
coordonnées publiées sont un leurre placé jusqu'à trois kilomètres du vrai final. La faire
entrer dans un centroïde ou dans un ordre de visite reviendrait à calculer soigneusement
sur une donnée fausse — le seul cas où un chiffre est pire que pas de chiffre.
"""

from __future__ import annotations

import math
from datetime import date

from .outing_sun import compute_sun_times

#: Rayon volumétrique moyen de la Terre. La même valeur que le reste du dépôt
#: (`utils/coordinate_calculator.py`), pour que deux distances affichées côte à côte
#: coïncident.
EARTH_RADIUS_KM = 6371.0

#: En deçà, deux caches s'enchaînent à pied sans reprendre la voiture. 400 m est la
#: distance de séparation minimale imposée par geocaching.com entre deux caches : deux
#: voisines directes tombent donc presque toujours dans le même groupe.
WALKING_CLUSTER_KM = 0.4

#: Nombre de passes de 2-opt. La convergence est atteinte bien avant sur des lots de
#: quelques dizaines de points ; la borne n'est là que pour garantir la terminaison.
MAX_TWO_OPT_PASSES = 50


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Distance orthodromique entre deux points, en kilomètres."""
    lat1_rad, lat2_rad = math.radians(lat1), math.radians(lat2)
    delta_lat = lat2_rad - lat1_rad
    delta_lon = math.radians(lon2 - lon1)

    a = (
        math.sin(delta_lat / 2) ** 2
        + math.cos(lat1_rad) * math.cos(lat2_rad) * math.sin(delta_lon / 2) ** 2
    )
    return 2 * EARTH_RADIUS_KM * math.asin(min(1.0, math.sqrt(a)))


# ─────────────────────────────────────────────────────────────────────────────
# Points exploitables
# ─────────────────────────────────────────────────────────────────────────────

def _coerce_coordinate(value) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def split_usable_points(entries: list[dict]) -> tuple[list[dict], list[dict]]:
    """
    Sépare les entrées de bundle exploitables de celles qu'il faut écarter.

    Renvoie `(points, excluded)`. Une entrée écartée dit pourquoi : le rapport doit
    pouvoir expliquer l'absence d'une cache de l'ordre de visite, faute de quoi le
    lecteur croira à un oubli.
    """
    points: list[dict] = []
    excluded: list[dict] = []

    for entry in entries or []:
        latitude = _coerce_coordinate(entry.get('latitude'))
        longitude = _coerce_coordinate(entry.get('longitude'))
        gc_code = entry.get('gc_code')

        if latitude is None or longitude is None:
            excluded.append({'gc_code': gc_code, 'reason': 'no_coordinates'})
            continue
        if entry.get('unsolved_mystery'):
            excluded.append({'gc_code': gc_code, 'reason': 'unsolved_mystery'})
            continue

        points.append({
            'gc_code': gc_code,
            'name': entry.get('name'),
            'latitude': latitude,
            'longitude': longitude,
        })

    return points, excluded


# ─────────────────────────────────────────────────────────────────────────────
# Étendue
# ─────────────────────────────────────────────────────────────────────────────

def _centroid(points: list[dict]) -> dict:
    """
    Centroïde arithmétique.

    Suffisant : une sortie tient dans quelques dizaines de kilomètres, où la moyenne des
    latitudes et des longitudes ne s'écarte pas du barycentre sphérique de plus de
    quelques mètres. Il ne sert d'ailleurs qu'à deux usages tolérants — décrire le centre
    de la zone et choisir le point de référence du calcul solaire.
    """
    count = len(points)
    return {
        'latitude': round(sum(point['latitude'] for point in points) / count, 6),
        'longitude': round(sum(point['longitude'] for point in points) / count, 6),
    }


def _bounding_box(points: list[dict]) -> dict:
    """Boîte englobante et ses dimensions au sol, mesurées au milieu de la boîte."""
    north = max(point['latitude'] for point in points)
    south = min(point['latitude'] for point in points)
    east = max(point['longitude'] for point in points)
    west = min(point['longitude'] for point in points)
    middle_latitude = (north + south) / 2

    return {
        'north': round(north, 6),
        'south': round(south, 6),
        'east': round(east, 6),
        'west': round(west, 6),
        'width_km': round(haversine_km(middle_latitude, west, middle_latitude, east), 2),
        'height_km': round(haversine_km(south, west, north, west), 2),
        'diagonal_km': round(haversine_km(south, west, north, east), 2),
    }


def _distance_matrix(points: list[dict]) -> list[list[float]]:
    """Matrice complète des distances. O(n²) sur quelques dizaines de points : négligeable."""
    count = len(points)
    matrix = [[0.0] * count for _ in range(count)]
    for i in range(count):
        for j in range(i + 1, count):
            distance = haversine_km(
                points[i]['latitude'], points[i]['longitude'],
                points[j]['latitude'], points[j]['longitude'],
            )
            matrix[i][j] = matrix[j][i] = distance
    return matrix


# ─────────────────────────────────────────────────────────────────────────────
# Ordre de visite
# ─────────────────────────────────────────────────────────────────────────────

def _nearest_neighbour_tour(matrix: list[list[float]], start: int) -> list[int]:
    """Chemin glouton depuis `start` : à chaque étape, le plus proche non visité."""
    count = len(matrix)
    unvisited = set(range(count))
    unvisited.discard(start)
    tour = [start]

    current = start
    while unvisited:
        current = min(unvisited, key=lambda candidate: matrix[current][candidate])
        unvisited.discard(current)
        tour.append(current)

    return tour


def _tour_length(matrix: list[list[float]], tour: list[int]) -> float:
    return sum(matrix[tour[i]][tour[i + 1]] for i in range(len(tour) - 1))


def _two_opt(matrix: list[list[float]], tour: list[int]) -> list[int]:
    """
    Amélioration 2-opt : tant qu'inverser un segment raccourcit le chemin, on inverse.

    Le glouton se piège lui-même — il file vers le plus proche voisin et doit revenir
    chercher les points qu'il a semés en route. Le 2-opt défait exactement ces
    croisements, pour une trentaine de lignes et un coût négligeable à cette échelle.

    Le chemin est **ouvert** : on ne revient pas au départ. Une sortie s'arrête à la
    dernière cache, elle ne boucle que si la voiture est restée au début — ce que le
    bundle ne sait pas.
    """
    count = len(tour)
    if count < 4:
        return tour

    best = list(tour)
    for _ in range(MAX_TWO_OPT_PASSES):
        improved = False
        for i in range(count - 2):
            for j in range(i + 2, count - 1):
                # Gain d'échange : on remplace (i,i+1) et (j,j+1) par (i,j) et (i+1,j+1).
                before = matrix[best[i]][best[i + 1]] + matrix[best[j]][best[j + 1]]
                after = matrix[best[i]][best[j]] + matrix[best[i + 1]][best[j + 1]]
                if after < before - 1e-9:
                    best[i + 1:j + 1] = reversed(best[i + 1:j + 1])
                    improved = True
        if not improved:
            break

    return best


def _build_route(points: list[dict], matrix: list[list[float]]) -> dict | None:
    """
    Ordre de visite indicatif, avec ses étapes et son cumul.

    Le glouton est relancé depuis **chaque** départ possible : sur quelques dizaines de
    points le surcoût est invisible, et cela supprime le choix arbitraire d'un point de
    départ — qui pèse lourd sur la qualité d'un chemin glouton.
    """
    if len(points) < 2:
        return None

    best_tour = min(
        (_nearest_neighbour_tour(matrix, start) for start in range(len(points))),
        key=lambda tour: _tour_length(matrix, tour),
    )
    best_tour = _two_opt(matrix, best_tour)

    legs = []
    cumulative = 0.0
    for position, index in enumerate(best_tour):
        leg = matrix[best_tour[position - 1]][index] if position > 0 else 0.0
        cumulative += leg
        legs.append({
            'position': position + 1,
            'gc_code': points[index]['gc_code'],
            'name': points[index]['name'],
            'leg_km': round(leg, 2),
            'cumulative_km': round(cumulative, 2),
        })

    return {
        # Nommée pour que le rapport puisse dire d'où vient cet ordre plutôt que de le
        # présenter comme une vérité.
        'strategy': 'nearest_neighbour_2opt',
        'total_km': round(cumulative, 2),
        'longest_leg_km': round(max(leg['leg_km'] for leg in legs), 2),
        'legs': legs,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Groupes de marche
# ─────────────────────────────────────────────────────────────────────────────

def _walking_clusters(points: list[dict], matrix: list[list[float]]) -> list[dict]:
    """
    Groupes de caches enchaînables à pied, par lien simple sous `WALKING_CLUSTER_KM`.

    Le lien simple (un voisin proche suffit à rejoindre le groupe) est le bon modèle ici :
    une série de caches le long d'un sentier forme bien une seule marche, même si ses
    extrémités sont éloignées. Les caches isolées ne forment pas de groupe et ne sont pas
    listées — le rapport les traite une par une de toute façon.
    """
    count = len(points)
    parent = list(range(count))

    def find(index: int) -> int:
        while parent[index] != index:
            parent[index] = parent[parent[index]]
            index = parent[index]
        return index

    for i in range(count):
        for j in range(i + 1, count):
            if matrix[i][j] <= WALKING_CLUSTER_KM:
                root_i, root_j = find(i), find(j)
                if root_i != root_j:
                    parent[root_j] = root_i

    groups: dict[int, list[int]] = {}
    for index in range(count):
        groups.setdefault(find(index), []).append(index)

    clusters = []
    for members in groups.values():
        if len(members) < 2:
            continue
        span = max(matrix[i][j] for i in members for j in members)
        clusters.append({
            'gc_codes': [points[index]['gc_code'] for index in members],
            'count': len(members),
            'span_km': round(span, 2),
        })

    clusters.sort(key=lambda cluster: cluster['count'], reverse=True)
    return clusters


# ─────────────────────────────────────────────────────────────────────────────
# Assemblage
# ─────────────────────────────────────────────────────────────────────────────

def build_geography(entries: list[dict], *, outing_date: date) -> dict:
    """
    Bloc géographique du bundle : étendue, ordre de visite, groupes, lumière du jour.

    Les entrées attendues sont celles du bundle, qui portent `latitude`, `longitude`,
    `gc_code`, `name` et `unsolved_mystery`. Le bloc est toujours renvoyé, même vide de
    points exploitables : la liste des exclusions est en soi une information, et l'IA doit
    savoir que le silence sur les distances est un manque de données, pas un oubli.
    """
    points, excluded = split_usable_points(entries)

    geography: dict = {
        'points_count': len(points),
        'excluded': excluded,
        'crow_flies': True,
        'centroid': None,
        'bounding_box': None,
        'max_pair_distance_km': None,
        'route': None,
        'walking_clusters': [],
        'sun': None,
    }

    if not points:
        return geography

    centroid = _centroid(points)
    geography['centroid'] = centroid
    geography['sun'] = compute_sun_times(centroid['latitude'], centroid['longitude'], outing_date)

    if len(points) == 1:
        return geography

    matrix = _distance_matrix(points)
    geography['bounding_box'] = _bounding_box(points)
    geography['max_pair_distance_km'] = round(max(max(row) for row in matrix), 2)
    geography['route'] = _build_route(points, matrix)
    geography['walking_clusters'] = _walking_clusters(points, matrix)

    return geography
