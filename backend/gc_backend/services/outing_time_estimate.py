"""
Estimation de temps déterministe pour une sortie.

Le rapport devait jusqu'ici parler de « caches chronophages » sans jamais avancer un
chiffre : l'IA n'avait aucune base pour en produire un, et un modèle qui estime des durées
au fil du texte se contredit d'une cache à l'autre — trente minutes pour une T4 ici, dix
pour une T4 là, sans que rien ne les distingue. Ce module calcule donc les durées **avant**
l'IA, à partir de ce que la base sait déjà : type, D/T, attributs de marche, waypoints
d'étape, logs de recherche longue, questions d'EarthCache, drapeaux matériel.

Trois partis pris.

**Additif, jamais multiplicatif.** Chaque contribution est nommée et chiffrée dans
`components` : le rapport peut dire *pourquoi* une cache coûte quarante-cinq minutes, et
l'utilisateur qui trouve le résultat faux voit immédiatement quel terme corriger. Un
produit de coefficients donnerait le même chiffre sans rien expliquer.

**Le temps sur place et le trajet sont deux choses.** `estimate_geocache_time()` ne compte
que le temps passé à la cache, voiture garée. Le trajet est calculé une seule fois pour la
sortie entière, dans `build_time_budget()`, à partir de l'ordre de visite de
`outing_geography` — et il est **le seul endroit** où une distance à vol d'oiseau devient
une durée, avec son facteur de détour annoncé.

**Une fourchette, pas un chiffre.** Une recherche sur place est intrinsèquement variable :
`low_minutes` et `high_minutes` encadrent l'estimation, et l'amplitude s'élargit quand la
confiance baisse (drapeau matériel non résolu, énigme sur place, aucun log local). Donner
« 45 min » tout court serait une précision que le calcul n'a pas.

Ce que le module ne sait pas, et qu'il ne prétend pas savoir : le dénivelé, l'état du
sentier, la circulation, les pauses, le fait qu'on soit deux ou six. L'IA a le droit de
réviser ces chiffres — c'est même ce qu'on lui demande — à condition de dire pourquoi.

Le module travaille sur les **entrées de bundle** déjà construites, comme
`outing_geography` : aucun accès base, donc testable seul.
"""

from __future__ import annotations

from .outing_geography import WALKING_CLUSTER_KM
from .outing_lexicons import normalize

#: Version de l'heuristique, transmise dans le budget. Un rapport archivé doit pouvoir
#: dire selon quelle grille il a été chiffré, sinon deux analyses du même lot à six mois
#: d'écart se contredisent sans explication.
METHOD = 'geoapp_heuristic_v1'

# ─────────────────────────────────────────────────────────────────────────────
# Temps de base par type
# ─────────────────────────────────────────────────────────────────────────────

#: Minutes sur place pour une cache « sans histoire » du type, D/T moyens exclus : le
#: temps d'aller au point, de chercher un peu, de signer et de remettre en place.
#:
#: Les types à étapes (multi, letterbox, wherigo) ont volontairement une base **basse** :
#: elle ne couvre que l'approche et le final, les étapes étant comptées séparément, à
#: partir des waypoints quand ils sont connus.
BASE_MINUTES_BY_TYPE: dict[str, int] = {
    'traditional': 10,
    'multi': 15,
    'letterbox': 15,
    'wherigo': 20,
    'mystery': 15,
    'earthcache': 15,
    'virtual': 15,
    'webcam': 15,
    'locationless': 15,
    'hq': 15,
    'event': 60,
    'mega_event': 90,
    'giga_event': 120,
    'cito': 90,
}

#: Type inconnu : la médiane des types physiques. Se tromper de cinq minutes sur une cache
#: exotique est sans conséquence ; refuser de l'estimer casserait le total.
DEFAULT_BASE_MINUTES = 15

#: Mots-clés de type, du plus spécifique au plus générique. L'ordre compte : « Mega-Event »
#: contient « event », et « Earthcache » ne doit pas tomber sur autre chose.
#:
#: Deux vocabulaires cohabitent en base selon la source (« Traditional » côté scraper,
#: « Traditional Cache » côté import) : la correspondance est donc par sous-chaîne.
_TYPE_KEYWORDS: tuple[tuple[tuple[str, ...], str], ...] = (
    (('giga',), 'giga_event'),
    (('mega',), 'mega_event'),
    (('cito', 'trash out'), 'cito'),
    (('event',), 'event'),
    (('multi',), 'multi'),
    (('letterbox',), 'letterbox'),
    (('wherigo',), 'wherigo'),
    (('earth',), 'earthcache'),
    (('mystery', 'unknown', 'puzzle'), 'mystery'),
    (('webcam',), 'webcam'),
    (('virtual',), 'virtual'),
    (('locationless',), 'locationless'),
    (('hq',), 'hq'),
    (('tradi',), 'traditional'),
)

#: Types dont l'essentiel du temps est fait d'étapes intermédiaires.
_STAGED_TYPES = ('multi', 'letterbox', 'wherigo')

#: Types sans recherche de conteneur : le temps est celui de l'observation, pas de la
#: fouille. Le supplément de difficulté ne s'y applique donc pas.
_NO_CONTAINER_TYPES = ('earthcache', 'virtual', 'webcam', 'locationless', 'event',
                       'mega_event', 'giga_event', 'cito')


def resolve_type_key(raw_type: str | None) -> str:
    """Clé de type canonique pour l'estimation, `traditional` par défaut si rien ne matche."""
    haystack = normalize(raw_type)
    if not haystack:
        return 'traditional'
    for keywords, key in _TYPE_KEYWORDS:
        if any(keyword in haystack for keyword in keywords):
            return key
    return 'traditional'


# ─────────────────────────────────────────────────────────────────────────────
# Difficulté et terrain
# ─────────────────────────────────────────────────────────────────────────────

#: Minutes ajoutées par la note, indexées par demi-point depuis 1 (1, 1.5, 2… 5).
#:
#: La progression est volontairement plus que linéaire : entre une D2 et une D3 il y a un
#: quart d'heure, entre une D4 et une D5 il y en a un autre — mais l'écart de vécu est sans
#: commune mesure. Une D5 est une cache où l'on repart parfois bredouille.
_RATING_MINUTES: tuple[int, ...] = (0, 2, 5, 8, 12, 18, 25, 33, 45)

#: Sur une mystery, la difficulté note l'**énigme**, résolue à la maison, pas la fouille
#: sur place. La compter en entier ferait d'une D5 déjà résolue une cache d'une heure.
MYSTERY_DIFFICULTY_FACTOR = 0.4


def _rating_minutes(rating) -> int:
    """Minutes correspondant à une note D ou T. Une note absente ou illisible vaut zéro."""
    try:
        value = float(rating)
    except (TypeError, ValueError):
        return 0
    index = round((max(1.0, min(5.0, value)) - 1.0) * 2)
    return _RATING_MINUTES[index]


# ─────────────────────────────────────────────────────────────────────────────
# Étapes, marche et signaux
# ─────────────────────────────────────────────────────────────────────────────

#: Types de waypoint valant une étape à rejoindre et à fouiller. Un parking, une tête de
#: sentier ou un point de référence n'en sont pas : on n'y cherche rien.
_STAGE_WAYPOINT_TERMS = ('stage', 'etape', 'final', 'question')

#: Minutes par étape intermédiaire : rejoindre le point, y trouver l'indice, repartir.
MINUTES_PER_STAGE = 10

#: Étapes présumées d'une multi dont aucun waypoint n'est publié — le cas le plus courant,
#: puisque les étapes se découvrent en chemin. Deux est le minimum crédible ; sous-estimer
#: une multi est l'erreur la plus fréquente d'une préparation de sortie.
ASSUMED_STAGES = 2

#: Marche annoncée par attribut, aller-retour compris. Un seul de ces signaux compte, le
#: plus long : ils sont exclusifs dans l'esprit de geocaching.com.
HIKE_MINUTES: dict[str, int] = {
    'hike_long': 90,
    'hike_med': 35,
    'hiking': 15,
    'hike_short': 10,
}

#: Suppléments liés aux signaux matériel et contextuels : mettre le baudrier, gonfler le
#: bateau, attendre que les passants s'éloignent. Les signaux qui ne changent pas la durée
#: (lampe, gants, tiques) n'y figurent pas — ils changent le sac, pas l'horaire.
SIGNAL_MINUTES: dict[str, int] = {
    'scuba': 30,
    'boat': 25,
    'field_puzzle': 15,
    'climbing': 15,
    'tree_climbing': 15,
    'swimming': 15,
    'wading': 10,
    'special_tool': 5,
    'teamwork': 5,
    'stealth': 5,
}

#: Libellés des suppléments, pour que le prompt lise « matériel de grimpe à installer »
#: plutôt que « climbing ».
SIGNAL_LABELS: dict[str, str] = {
    'scuba': 'plongée à équiper',
    'boat': 'embarcation à mettre à l\'eau',
    'field_puzzle': 'énigme à résoudre sur place',
    'climbing': 'matériel de grimpe à installer',
    'tree_climbing': 'grimpe d\'arbre à installer',
    'swimming': 'passage à la nage',
    'wading': 'passage dans l\'eau',
    'special_tool': 'outil spécial à déployer',
    'teamwork': 'coordination à plusieurs',
    'stealth': 'attente de discrétion',
}

#: Recherche longue signalée dans les logs, par nombre de logs concernés (0, 1, 2, 3+).
#: La progression s'aplatit vite : trois logs qui disent « bien cachée » ne valent pas
#: trois fois un seul, ils confirment le même fait.
SEARCH_EFFORT_MINUTES: tuple[int, ...] = (0, 10, 15, 20)

#: Question d'EarthCache restant à traiter : lire l'énoncé, observer, noter.
MINUTES_PER_LOGGING_TASK = 4
LOGGING_TASKS_CAP_MINUTES = 24

#: Photo exigée par une question : cadrer, se placer, vérifier.
PHOTO_MINUTES = 5

#: Plafond appliqué aux traditionnelles marquées « park & grab / moins d'une heure ». Le
#: signal `quick` fusionne les deux attributs, dont le second est beaucoup plus mou : le
#: plafond n'est donc appliqué que là où « park & grab » est la lecture plausible.
QUICK_CAP_MINUTES = 20

#: Plancher : même une cache posée sur le parking demande de s'arrêter et de signer.
MINIMUM_MINUTES = 5


# ─────────────────────────────────────────────────────────────────────────────
# Confiance
# ─────────────────────────────────────────────────────────────────────────────

#: Amplitude de la fourchette autour de l'estimation, par niveau de confiance. Une
#: confiance basse n'abaisse pas le chiffre, elle l'élargit : c'est l'incertitude qui
#: augmente, pas la durée.
CONFIDENCE_SPREAD: dict[str, float] = {
    'high': 0.20,
    'medium': 0.30,
    'low': 0.50,
}


def _confidence(entry: dict, type_key: str, signals: dict[str, dict]) -> tuple[str, list[str]]:
    """
    Niveau de confiance de l'estimation, et ce qui l'a déterminé.

    Les raisons sont renvoyées telles quelles : « 45 min (fourchette large : drapeau
    matériel non résolu) » est une phrase honnête, « 45 min » ne l'est pas.
    """
    reasons: list[str] = []

    if entry.get('unsolved_mystery'):
        reasons.append('mystery non résolue : le final est inconnu')
    if any(not signal.get('resolved') for signal in signals.values()):
        reasons.append('drapeau matériel non résolu')
    if 'field_puzzle' in signals:
        reasons.append('énigme sur place, de nature inconnue')
    if not (entry.get('health') or {}).get('logs_available'):
        reasons.append('aucun log local pour recouper')
    if type_key in _STAGED_TYPES and not _count_stage_waypoints(entry):
        reasons.append('étapes non publiées, nombre présumé')

    difficulty = entry.get('difficulty')
    try:
        if type_key != 'mystery' and difficulty is not None and float(difficulty) >= 4:
            reasons.append('difficulté élevée : issue incertaine')
    except (TypeError, ValueError):
        pass

    if reasons:
        return 'low', reasons

    terrain = entry.get('terrain')
    try:
        easy_terrain = terrain is None or float(terrain) <= 2
        easy_difficulty = difficulty is None or float(difficulty) <= 2
    except (TypeError, ValueError):
        easy_terrain = easy_difficulty = False

    # Seuls les signaux qui pèsent sur la durée entament la confiance : un « park & grab »
    # ou une lampe frontale ne rendent pas l'estimation plus incertaine.
    timed_signals = any(
        name in SIGNAL_MINUTES or name in HIKE_MINUTES for name in signals
    )
    if type_key == 'traditional' and easy_terrain and easy_difficulty and not timed_signals:
        return 'high', []

    return 'medium', []


# ─────────────────────────────────────────────────────────────────────────────
# Estimation par géocache
# ─────────────────────────────────────────────────────────────────────────────

def _count_stage_waypoints(entry: dict) -> int:
    """Waypoints valant une étape à rejoindre : ni parking, ni tête de sentier, ni repère."""
    count = 0
    for waypoint in entry.get('waypoints') or []:
        haystack = normalize((waypoint or {}).get('type'))
        if haystack and any(term in haystack for term in _STAGE_WAYPOINT_TERMS):
            count += 1
    return count


def _signals_by_name(entry: dict) -> dict[str, dict]:
    """Signaux matériel et contextuels indexés par nom, hors formes négatives."""
    indexed: dict[str, dict] = {}
    for signal in entry.get('gear_signals') or []:
        name = (signal or {}).get('signal')
        if name and not signal.get('is_negative'):
            indexed.setdefault(name, signal)
    return indexed


def _round_to_five(minutes: float) -> int:
    """Arrondi au multiple de cinq : une estimation à la minute serait une fausse précision."""
    return int(round(minutes / 5.0) * 5)


def estimate_geocache_time(entry: dict) -> dict:
    """
    Temps sur place d'une géocache, en minutes, avec le détail de son calcul.

    L'entrée est un dictionnaire de bundle (voir `outing_analysis_service`) : type, D/T,
    `gear_signals`, `waypoints`, `search_effort_logs`, `logging_tasks`, `health`.

    **Le trajet n'y est pas** : le chiffre commence voiture garée et s'arrête au retour à
    la voiture. C'est `build_time_budget()` qui ajoute les déplacements, une seule fois
    pour la sortie.
    """
    type_key = resolve_type_key(entry.get('type'))
    signals = _signals_by_name(entry)
    components: list[dict] = []

    def add(label: str, minutes: float) -> None:
        """Contribution nommée. Non arrondie : c'est le total qui l'est, une seule fois."""
        if minutes > 0:
            components.append({'label': label, 'minutes': int(round(minutes))})

    base = BASE_MINUTES_BY_TYPE.get(type_key, DEFAULT_BASE_MINUTES)
    total = float(base)
    components.append({'label': f'base {type_key}', 'minutes': base})

    # Étapes intermédiaires. Les waypoints publiés font foi ; à défaut, une multi est
    # présumée en avoir deux, parce qu'une multi sans étape n'existe pas.
    published_stages = _count_stage_waypoints(entry)
    stages = max(published_stages, ASSUMED_STAGES) if type_key in _STAGED_TYPES else published_stages
    if stages:
        minutes = stages * MINUTES_PER_STAGE
        total += minutes
        presumed = ' présumée(s)' if stages > published_stages else ''
        add(f'{stages} étape(s){presumed}', minutes)

    # Difficulté : le temps de fouille. Sans conteneur à trouver, il n'y a rien à fouiller.
    if type_key not in _NO_CONTAINER_TYPES:
        difficulty_minutes = _rating_minutes(entry.get('difficulty'))
        if type_key == 'mystery':
            difficulty_minutes *= MYSTERY_DIFFICULTY_FACTOR
        if difficulty_minutes:
            total += difficulty_minutes
            add(f"difficulté {entry.get('difficulty')}", difficulty_minutes)

    # Terrain : le temps d'accès, quel que soit le type.
    terrain_minutes = _rating_minutes(entry.get('terrain'))
    if terrain_minutes:
        total += terrain_minutes
        add(f"terrain {entry.get('terrain')}", terrain_minutes)

    # Marche annoncée : un seul signal compte, le plus long.
    hike = next((name for name in HIKE_MINUTES if name in signals), None)
    if hike:
        total += HIKE_MINUTES[hike]
        add(signals[hike].get('label') or hike, HIKE_MINUTES[hike])

    for name, minutes in SIGNAL_MINUTES.items():
        if name in signals:
            total += minutes
            add(SIGNAL_LABELS.get(name, name), minutes)

    effort_logs = len(entry.get('search_effort_logs') or [])
    if effort_logs:
        minutes = SEARCH_EFFORT_MINUTES[min(effort_logs, len(SEARCH_EFFORT_MINUTES) - 1)]
        total += minutes
        add(f'recherche longue signalée dans {effort_logs} log(s)', minutes)

    # Questions d'EarthCache encore à traiter. Une question déjà répondue ne coûte plus
    # rien sur le terrain : elle est faite.
    pending_tasks = sum(1 for task in (entry.get('logging_tasks') or []) if not task.get('answered'))
    if pending_tasks:
        minutes = min(pending_tasks * MINUTES_PER_LOGGING_TASK, LOGGING_TASKS_CAP_MINUTES)
        total += minutes
        add(f'{pending_tasks} question(s) à répondre sur place', minutes)
    if entry.get('logging_tasks_photo_required'):
        total += PHOTO_MINUTES
        add('photo à prendre', PHOTO_MINUTES)

    capped = False
    if type_key == 'traditional' and 'quick' in signals and total > QUICK_CAP_MINUTES:
        total = float(QUICK_CAP_MINUTES)
        capped = True

    minutes = max(MINIMUM_MINUTES, _round_to_five(total))
    confidence, reasons = _confidence(entry, type_key, signals)
    spread = CONFIDENCE_SPREAD[confidence]

    return {
        'minutes': minutes,
        'low_minutes': max(MINIMUM_MINUTES, _round_to_five(minutes * (1 - spread))),
        'high_minutes': _round_to_five(minutes * (1 + spread)),
        'confidence': confidence,
        'confidence_reasons': reasons,
        'type_key': type_key,
        # Le détail vaut autant que le total : c'est lui qui rend le chiffre discutable
        # plutôt qu'à prendre ou à laisser.
        'components': components,
        'capped_park_and_grab': capped,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Trajet
# ─────────────────────────────────────────────────────────────────────────────

#: Vitesse moyenne portée à portée, arrêts et petites routes compris. Volontairement basse :
#: une sortie géocaching se fait sur des départementales et des chemins, pas sur autoroute.
DRIVING_SPEED_KMH = 45.0

#: Vitesse de marche sur sentier, sac au dos, en cherchant son chemin.
WALKING_SPEED_KMH = 3.5

#: Facteurs de détour appliqués aux distances à vol d'oiseau. C'est **le seul endroit** du
#: projet où une distance à vol d'oiseau devient une durée : le facteur est annoncé dans le
#: bloc `assumptions` pour que le rapport puisse le citer plutôt que de le subir.
ROAD_DETOUR_FACTOR = 1.3
WALK_DETOUR_FACTOR = 1.25

#: Se garer, sortir, verrouiller, repartir. Payé à chaque étape rejointe en voiture.
STOP_OVERHEAD_MINUTES = 3


def build_travel_estimate(geography: dict | None) -> dict | None:
    """
    Temps de déplacement entre les caches, déduit de l'ordre de visite.

    Une étape plus courte que `WALKING_CLUSTER_KM` est comptée à pied, sans arrêt voiture :
    c'est exactement la définition d'un groupe de marche dans `outing_geography`, et
    reprendre la voiture pour trois cents mètres n'arrive pas.

    Renvoie `None` s'il n'y a pas d'ordre de visite — une seule cache exploitable, ou
    aucune. Un total sans trajet est alors juste, ce qu'un trajet inventé ne serait pas.
    """
    route = (geography or {}).get('route')
    legs = (route or {}).get('legs') or []
    if not route or len(legs) < 2:
        return None

    driving_km = walking_km = 0.0
    stops = 0

    for leg in legs[1:]:
        try:
            distance = float(leg.get('leg_km') or 0.0)
        except (TypeError, ValueError):
            continue
        if distance <= WALKING_CLUSTER_KM:
            walking_km += distance
        else:
            driving_km += distance
            stops += 1

    road_km = driving_km * ROAD_DETOUR_FACTOR
    trail_km = walking_km * WALK_DETOUR_FACTOR
    driving_minutes = road_km / DRIVING_SPEED_KMH * 60 + stops * STOP_OVERHEAD_MINUTES
    walking_minutes = trail_km / WALKING_SPEED_KMH * 60

    return {
        'legs_count': len(legs) - 1,
        'crow_flies_km': round(driving_km + walking_km, 2),
        'road_km_estimated': round(road_km, 1),
        'walking_km_estimated': round(trail_km, 2),
        'driving_stops': stops,
        'driving_minutes': _round_to_five(driving_minutes),
        'walking_minutes': _round_to_five(walking_minutes),
        'minutes': _round_to_five(driving_minutes + walking_minutes),
        'assumptions': {
            'driving_speed_kmh': DRIVING_SPEED_KMH,
            'walking_speed_kmh': WALKING_SPEED_KMH,
            'road_detour_factor': ROAD_DETOUR_FACTOR,
            'walk_detour_factor': WALK_DETOUR_FACTOR,
            'stop_overhead_minutes': STOP_OVERHEAD_MINUTES,
            'walking_threshold_km': WALKING_CLUSTER_KM,
        },
    }


# ─────────────────────────────────────────────────────────────────────────────
# Budget de la sortie
# ─────────────────────────────────────────────────────────────────────────────

#: Caches les plus coûteuses remontées dans le budget : celles qui décident de ce qu'on
#: sacrifie quand la journée est trop courte.
HEAVIEST_COUNT = 3


def build_time_budget(entries: list[dict], geography: dict | None = None) -> dict:
    """
    Budget temps de la sortie : temps sur place, trajet, total.

    Deux retranchements sont fournis plutôt qu'appliqués — `already_found_minutes` et
    `unsolved_mystery_minutes`. Retirer d'office ces caches du total serait décider à la
    place de l'utilisateur : refaire une multi avec quelqu'un est légitime, et une mystery
    peut être résolue le soir même. Le rapport, lui, peut dire « 6 h 30, ou 5 h 15 si l'on
    retire les deux caches déjà trouvées ».

    La fourchette ne porte que sur le temps sur place : le trajet, lui, dépend de la route
    et non de la chance, et lui inventer une incertitude symétrique n'apporterait rien.
    """
    entries = entries or []
    estimates = [
        (entry, entry.get('time_estimate') or estimate_geocache_time(entry))
        for entry in entries
    ]

    on_site = sum(estimate['minutes'] for _, estimate in estimates)
    on_site_low = sum(estimate['low_minutes'] for _, estimate in estimates)
    on_site_high = sum(estimate['high_minutes'] for _, estimate in estimates)

    travel = build_travel_estimate(geography)
    travel_minutes = travel['minutes'] if travel else 0

    heaviest = sorted(estimates, key=lambda item: item[1]['minutes'], reverse=True)
    heaviest = [
        {
            'gc_code': entry.get('gc_code'),
            'name': entry.get('name'),
            'minutes': estimate['minutes'],
        }
        for entry, estimate in heaviest[:HEAVIEST_COUNT]
        if estimate['minutes'] > 0
    ]

    return {
        'method': METHOD,
        'geocaches_count': len(estimates),
        'on_site_minutes': on_site,
        'on_site_low_minutes': on_site_low,
        'on_site_high_minutes': on_site_high,
        'travel': travel,
        'includes_travel': travel is not None,
        'total_minutes': on_site + travel_minutes,
        'total_low_minutes': on_site_low + travel_minutes,
        'total_high_minutes': on_site_high + travel_minutes,
        'already_found_minutes': sum(
            estimate['minutes'] for entry, estimate in estimates if entry.get('found')
        ),
        'unsolved_mystery_minutes': sum(
            estimate['minutes'] for entry, estimate in estimates if entry.get('unsolved_mystery')
        ),
        'heaviest': heaviest,
    }
