"""
Fraîcheur des logs locaux, connue **avant** l'analyse.

Le bundle d'analyse sait déjà dire quelles géocaches n'ont pas de logs locaux et
lesquelles en ont de périmés — mais il ne le sait qu'après avoir tout collecté, alors que
la question se pose avant : faut-il rafraîchir d'abord ? La spec avait tranché en plaçant
l'avertissement après, précisément pour ne pas payer un aller-retour réseau que
l'utilisateur risquait d'annuler. Ce module lève l'objection : répondre à cette
question-là ne demande ni listing, ni logs, ni calcul solaire, seulement deux requêtes
SQL et aucun appel à geocaching.com.

Les seuils et la façon de dater une collecte sont **volontairement** ceux d'`outing_health` :
les deux verdicts doivent coïncider, sinon le pré-vol proposerait un rafraîchissement dont
le rapport ne dirait rien, ou l'inverse.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from sqlalchemy import func

from ..database import db
from ..geocaches.models import Geocache, GeocacheLog
# Import délibéré de deux privés : c'est le prix à payer pour que la fraîcheur annoncée
# ici et celle calculée dans la santé soient la même chose, pas deux approximations qui
# divergent au premier ajustement de seuil.
from .outing_health import LOGS_STALE_DAYS, _as_utc, _days_since

logger = logging.getLogger(__name__)

#: Verdict par géocache.
#: - `none`  : aucun log local, la santé n'est pas évaluable du tout ;
#: - `stale` : des logs, mais collectés il y a plus de `LOGS_STALE_DAYS` jours ;
#: - `fresh` : rien à faire.
STATUS_NONE = 'none'
STATUS_STALE = 'stale'
STATUS_FRESH = 'fresh'


def _coerce_datetime(value) -> datetime | None:
    """
    Date issue d'un `max()` SQL.

    SQLite rend parfois l'agrégat sous forme de chaîne plutôt que de `datetime`, selon la
    façon dont l'expression a traversé le typage SQLAlchemy. Le format stocké est ISO à
    l'espace près, donc lexicographiquement ordonné — le `max()` reste correct — mais il
    faut le relire ici.
    """
    if value is None or isinstance(value, datetime):
        return value
    try:
        return datetime.fromisoformat(str(value).replace(' ', 'T'))
    except (TypeError, ValueError):
        return None


def build_logs_status(geocache_ids: list[int], *, now: datetime | None = None) -> dict:
    """
    Ce que valent les logs locaux d'un lot, sans rien récupérer.

    Les géocaches sont renvoyées dans l'ordre demandé. Un identifiant introuvable ne fait
    pas échouer l'appel : il ressort dans `missing`, comme dans le bundle.
    """
    now = now or datetime.now(timezone.utc)
    requested = list(dict.fromkeys(geocache_ids or []))

    empty = {
        'generated_at': now.isoformat(),
        'stale_after_days': LOGS_STALE_DAYS,
        'requested_count': len(requested),
        'geocaches': [],
        'missing': list(requested),
        'without_local_logs': [],
        'stale_logs': [],
    }
    if not requested:
        empty['missing'] = []
        return empty

    found = {
        geocache.id: geocache
        for geocache in Geocache.query
        .with_entities(Geocache.id, Geocache.gc_code, Geocache.name)
        .filter(Geocache.id.in_(requested))
        .all()
    }
    if not found:
        return empty

    # Un agrégat plutôt que le chargement des logs : sur soixante caches et des milliers
    # de lignes, la différence est celle entre une requête et un transfert complet.
    aggregates = {
        row[0]: (row[1], _coerce_datetime(row[2]))
        for row in db.session.query(
            GeocacheLog.geocache_id,
            func.count(GeocacheLog.id),
            func.max(func.coalesce(GeocacheLog.updated_at, GeocacheLog.created_at)),
        )
        .filter(GeocacheLog.geocache_id.in_(list(found.keys())))
        .group_by(GeocacheLog.geocache_id)
        .all()
    }

    entries: list[dict] = []
    for geocache_id in requested:
        geocache = found.get(geocache_id)
        if geocache is None:
            continue

        count, fetched_at = aggregates.get(geocache_id, (0, None))
        days = _days_since(fetched_at, now)

        if not count:
            status = STATUS_NONE
        elif days is not None and days > LOGS_STALE_DAYS:
            status = STATUS_STALE
        else:
            # Un lot de logs sans horodatage de collecte est rare (colonnes antérieures à
            # leur ajout) : on le tient pour frais plutôt que d'imposer un rafraîchissement
            # sur une absence de preuve.
            status = STATUS_FRESH

        aware = _as_utc(fetched_at)
        entries.append({
            'id': geocache_id,
            'gc_code': geocache.gc_code,
            'name': geocache.name,
            'local_logs_count': int(count or 0),
            'logs_fetched_at': aware.isoformat() if aware else None,
            'days_since_logs_fetched': days,
            'status': status,
        })

    missing = [geocache_id for geocache_id in requested if geocache_id not in found]

    return {
        'generated_at': now.isoformat(),
        'stale_after_days': LOGS_STALE_DAYS,
        'requested_count': len(requested),
        'geocaches': entries,
        'missing': missing,
        'without_local_logs': [entry for entry in entries if entry['status'] == STATUS_NONE],
        'stale_logs': [entry for entry in entries if entry['status'] == STATUS_STALE],
    }
