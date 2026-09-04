"""
Mémo du bundle d'analyse de sortie, et l'ETag qui va avec.

Deux analyses successives de la même sélection reconstruisaient tout : les listings, le
balayage lexical de chaque texte, la santé de chaque cache, la géographie, le budget
temps. C'est supportable — le lot est plafonné à soixante caches — mais gratuit, tant que
rien n'a bougé en base.

## L'empreinte, et pourquoi elle n'est pas qu'une liste d'identifiants

Un cache qui se trompe est pire que pas de cache du tout : le rapport d'une sortie décrit
un terrain, et le décrire avec des données d'il y a dix minutes revient exactement à ce
que tout le reste du dispositif cherche à éviter. L'empreinte couvre donc, en plus des
identifiants et des options de collecte, **la fraîcheur de chaque table que le bundle
lit** :

| Table | Ce qui la date |
|---|---|
| `geocache` | nombre de lignes + `max(updated_at)` |
| `geocache_log` | nombre de lignes + `max(updated_at)` |
| `geocache_waypoint` | nombre de lignes + `max(id)` + `max(note_override_updated_at)` |
| `geocache_logging_task` | nombre de lignes + `max(updated_at)` |
| `note` (via `geocache_note`) | nombre de lignes + `max(updated_at)` |

`geocache.updated_at` a été ajoutée pour ce calcul : c'est la seule table du lot qui n'en
avait pas, et c'est celle qui porte le listing, les attributs et les coordonnées
corrigées. Sans elle, une correction de coordonnées — le geste qui donne précisément envie
de relancer l'analyse — passait inaperçue.

Les waypoints n'ont pas d'`updated_at` : le nombre de lignes et le plus grand identifiant
attrapent les ajouts, les suppressions et le réécrasement par le scraping, qui recrée les
lignes plutôt que de les modifier.

## Le TTL n'est pas un doublon de l'empreinte

L'empreinte date les **données** ; le TTL date le **calcul**. La santé se lit en jours
écoulés depuis le dernier log, et `generated_at` figure dans le bundle : cinq minutes
d'écart n'y changent rien, une nuit oui. Le TTL borne cet écart-là, pas les écritures.

Le cache est **en mémoire du processus** et minuscule (trois bundles) : c'est un mémo
d'enchaînement, pas un magasin. Un redémarrage le vide, et c'est très bien.
"""

from __future__ import annotations

import hashlib
import json
import logging
import threading
import time
from collections import OrderedDict
from datetime import date, datetime

from sqlalchemy import func

from ..database import db
from ..geocaches.models import (
    Geocache,
    GeocacheLog,
    GeocacheLoggingTask,
    GeocacheNote,
    GeocacheWaypoint,
    Note,
)
from .outing_analysis_service import build_analysis_bundle

logger = logging.getLogger(__name__)

#: Âge maximal d'un bundle servi depuis le mémo. Voir « Le TTL n'est pas un doublon ».
CACHE_TTL_SECONDS = 300

#: Nombre de bundles gardés, le plus ancien évincé d'abord. Trois couvrent le va-et-vient
#: réel — une sélection, sa relance après rafraîchissement, une seconde sélection — sans
#: garder en mémoire des dizaines de mégaoctets de listings.
MAX_CACHED_BUNDLES = 3

_lock = threading.Lock()
_cache: 'OrderedDict[str, tuple[float, dict]]' = OrderedDict()


def _freshness_rows(ids: list[int]) -> list:
    """
    Ce qui date les données lues par le bundle, en cinq agrégats.

    Cinq requêtes qui ne ramènent que des compteurs et des dates, là où le bundle ramène
    tous les logs et tous les listings du lot : le rapport de coût est celui qui rend le
    mémo intéressant.
    """
    return [
        db.session.query(
            func.count(Geocache.id), func.max(Geocache.updated_at)
        ).filter(Geocache.id.in_(ids)).one(),
        db.session.query(
            func.count(GeocacheLog.id), func.max(GeocacheLog.updated_at)
        ).filter(GeocacheLog.geocache_id.in_(ids)).one(),
        db.session.query(
            func.count(GeocacheWaypoint.id),
            func.max(GeocacheWaypoint.id),
            func.max(GeocacheWaypoint.note_override_updated_at),
        ).filter(GeocacheWaypoint.geocache_id.in_(ids)).one(),
        db.session.query(
            func.count(GeocacheLoggingTask.id), func.max(GeocacheLoggingTask.updated_at)
        ).filter(GeocacheLoggingTask.geocache_id.in_(ids)).one(),
        db.session.query(func.count(Note.id), func.max(Note.updated_at))
        .join(GeocacheNote, GeocacheNote.note_id == Note.id)
        .filter(GeocacheNote.geocache_id.in_(ids)).one(),
    ]


def bundle_fingerprint(
    geocache_ids: list[int],
    *,
    listing_chars: int,
    recent_logs_count: int,
    gear_logs_count: int,
    outing_date: date | None,
) -> str:
    """
    Empreinte stable du couple (sélection, état de la base). Sert d'ETag.

    L'ordre des identifiants en fait partie : il décide de l'ordre des fiches dans le
    prompt, donc du rapport. Deux sélections des mêmes caches dans un autre ordre ne sont
    pas le même bundle.
    """
    payload = {
        'ids': list(geocache_ids),
        'listing_chars': listing_chars,
        'recent_logs_count': recent_logs_count,
        'gear_logs_count': gear_logs_count,
        'outing_date': outing_date.isoformat() if outing_date else None,
        'freshness': [
            [value.isoformat() if isinstance(value, datetime) else value for value in row]
            for row in _freshness_rows(list(geocache_ids))
        ],
    }
    raw = json.dumps(payload, sort_keys=True, default=str)
    return hashlib.sha256(raw.encode('utf-8')).hexdigest()[:32]


def build_analysis_bundle_cached(
    geocache_ids: list[int],
    *,
    listing_chars: int,
    recent_logs_count: int,
    gear_logs_count: int,
    outing_date: date | None = None,
) -> tuple[dict, str, bool]:
    """
    Bundle d'analyse, servi depuis le mémo quand rien n'a bougé.

    Renvoie `(bundle, empreinte, servi_depuis_le_mémo)`. Un échec du calcul d'empreinte —
    une colonne absente sur une base pas encore migrée, par exemple — ne fait pas échouer
    l'analyse : on retombe sur la construction complète, qui est le comportement d'avant.

    Le bundle renvoyé est l'objet mémorisé lui-même, pas une copie : les appelants le
    sérialisent, ils ne le modifient pas.
    """
    ids = list(dict.fromkeys(geocache_ids or []))
    options = {
        'listing_chars': listing_chars,
        'recent_logs_count': recent_logs_count,
        'gear_logs_count': gear_logs_count,
        'outing_date': outing_date,
    }

    try:
        fingerprint = bundle_fingerprint(ids, **options)
    except Exception as error:  # pragma: no cover - dépend du schéma en place
        logger.warning("Empreinte de bundle indisponible, cache ignoré : %s", error)
        return build_analysis_bundle(ids, **options), '', False

    now = time.monotonic()
    with _lock:
        entry = _cache.get(fingerprint)
        if entry is not None and now - entry[0] <= CACHE_TTL_SECONDS:
            _cache.move_to_end(fingerprint)
            return entry[1], fingerprint, True
        if entry is not None:
            del _cache[fingerprint]

    bundle = build_analysis_bundle(ids, **options)

    with _lock:
        _cache[fingerprint] = (time.monotonic(), bundle)
        _cache.move_to_end(fingerprint)
        while len(_cache) > MAX_CACHED_BUNDLES:
            _cache.popitem(last=False)

    return bundle, fingerprint, False


def clear_bundle_cache() -> None:
    """Vide le mémo. Pour les tests, et pour un éventuel geste manuel de diagnostic."""
    with _lock:
        _cache.clear()
