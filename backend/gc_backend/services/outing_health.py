"""
Santé d'une géocache, calculée depuis ses logs locaux.

Le but n'est pas de deviner si la cache est en place — personne ne le peut — mais de
donner à l'IA des faits chiffrés plutôt que de la laisser interpréter une liste de logs :
combien de DNF consécutifs, depuis combien de temps personne n'a trouvé, une demande de
maintenance est-elle restée sans réponse.

Point important : les logs ne sont en base que si la géocache a été rafraîchie au moins
une fois. Sans log local, la santé n'est pas « bonne », elle est **inconnue** — et c'est
cette valeur qui doit remonter jusqu'au prompt, pour que l'IA ne conclue pas sur du vide.
"""

from __future__ import annotations

from datetime import datetime, timezone

# ─────────────────────────────────────────────────────────────────────────────
# Seuils
# ─────────────────────────────────────────────────────────────────────────────

DNF_VERY_RISKY = 3
DNF_RISKY = 2
STALE_DAYS_RISKY = 365
STALE_DAYS_WATCH = 180
DNF_RATIO_WATCH = 0.4
RECENT_WINDOW = 10

# ─────────────────────────────────────────────────────────────────────────────
# Normalisation des types de logs
# ─────────────────────────────────────────────────────────────────────────────

# Les types stockés viennent de sources différentes (scraping, GPX, logs soumis par
# GeoApp) et leur casse comme leur ponctuation varient : « Didn't find it », « did not
# find », « DNF ». La comparaison se fait donc sur une forme réduite.
_FOUND = 'found'
_DNF = 'dnf'
_NOTE = 'note'
_NEEDS_MAINTENANCE = 'needs_maintenance'
_OWNER_MAINTENANCE = 'owner_maintenance'
_DISABLED = 'disabled'
_ENABLED = 'enabled'
_ARCHIVED = 'archived'
_PUBLISHED = 'published'


def _reduce(raw: str | None) -> str:
    """Forme comparable d'un type de log : minuscules, sans apostrophes ni ponctuation."""
    if not raw:
        return ''
    return ''.join(ch for ch in str(raw).lower() if ch.isalnum() or ch == ' ').strip()


def classify_log_type(raw: str | None) -> str | None:
    """Catégorie normalisée d'un type de log, ou None s'il n'entre dans aucune."""
    reduced = _reduce(raw)
    if not reduced:
        return None

    # « Attended » et « Webcam Photo Taken » valent trouvaille : ils marquent une visite
    # réussie et cassent donc une série de DNF au même titre qu'un « Found it ».
    if reduced in ('found it', 'found', 'attended', 'webcam photo taken'):
        return _FOUND
    if reduced in ('didnt find it', 'did not find', 'did not find it', 'dnf', 'didnt find'):
        return _DNF
    if reduced in ('write note', 'note'):
        return _NOTE
    if reduced in ('needs maintenance', 'needs archived'):
        return _NEEDS_MAINTENANCE
    if reduced == 'owner maintenance':
        return _OWNER_MAINTENANCE
    if reduced in ('temporarily disable listing', 'disable listing', 'disabled'):
        return _DISABLED
    if reduced in ('enable listing', 'enabled'):
        return _ENABLED
    if reduced == 'archive':
        return _ARCHIVED
    if reduced in ('publish listing', 'published'):
        return _PUBLISHED
    return None


def _as_utc(value: datetime | None) -> datetime | None:
    """Date comparable : les dates naïves stockées en base sont traitées comme UTC."""
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _days_since(value: datetime | None, now: datetime) -> int | None:
    aware = _as_utc(value)
    if aware is None:
        return None
    return max(0, (now - aware).days)


def _iso(value: datetime | None) -> str | None:
    aware = _as_utc(value)
    return aware.isoformat() if aware else None


# ─────────────────────────────────────────────────────────────────────────────
# Calcul
# ─────────────────────────────────────────────────────────────────────────────

def compute_health(
    logs: list,
    *,
    listing_status: str | None = None,
    placed_at: datetime | None = None,
    now: datetime | None = None,
) -> dict:
    """
    Bloc de santé d'une géocache.

    `logs` : ses `GeocacheLog`, dans n'importe quel ordre (la fonction les retrie).
    Les logs sans date participent au comptage par type mais pas aux calculs temporels.
    """
    now = now or datetime.now(timezone.utc)

    ordered = sorted(
        logs or [],
        key=lambda log: (_as_utc(getattr(log, 'date', None)) or datetime.min.replace(tzinfo=timezone.utc)),
        reverse=True,
    )

    health: dict = {
        'level': 'unknown',
        'reasons': [],
        'logs_available': bool(ordered),
        'local_logs_count': len(ordered),
        'last_found_date': None,
        'days_since_last_found': None,
        'consecutive_dnf': 0,
        'dnf_ratio_recent': None,
        'needs_maintenance_pending': False,
        'listing_status': listing_status,
    }

    if not ordered:
        health['reasons'].append(
            'Aucun log local : la géocache n\'a jamais été rafraîchie, sa santé n\'est pas évaluable.'
        )
        return health

    kinds = [(log, classify_log_type(getattr(log, 'log_type', None))) for log in ordered]

    # Dernière trouvaille
    last_found = next(
        (log for log, kind in kinds if kind == _FOUND and getattr(log, 'date', None)),
        None,
    )
    if last_found is not None:
        health['last_found_date'] = _iso(last_found.date)
        health['days_since_last_found'] = _days_since(last_found.date, now)

    # DNF consécutifs : on remonte depuis le plus récent. Une trouvaille ferme la série ;
    # une maintenance du propriétaire aussi, puisqu'elle est censée corriger le problème.
    consecutive_dnf = 0
    for _, kind in kinds:
        if kind == _DNF:
            consecutive_dnf += 1
        elif kind in (_FOUND, _OWNER_MAINTENANCE):
            break
    health['consecutive_dnf'] = consecutive_dnf

    # Demande de maintenance restée sans réponse du propriétaire
    last_nm = next((log for log, kind in kinds if kind == _NEEDS_MAINTENANCE), None)
    last_om = next((log for log, kind in kinds if kind == _OWNER_MAINTENANCE), None)
    if last_nm is not None:
        nm_date = _as_utc(getattr(last_nm, 'date', None))
        om_date = _as_utc(getattr(last_om, 'date', None)) if last_om is not None else None
        if om_date is None or (nm_date is not None and nm_date > om_date):
            health['needs_maintenance_pending'] = True

    # Ratio DNF sur la fenêtre récente, trouvailles et DNF seulement
    window = [kind for _, kind in kinds if kind in (_FOUND, _DNF)][:RECENT_WINDOW]
    if window:
        health['dnf_ratio_recent'] = round(window.count(_DNF) / len(window), 2)

    health['reasons'] = _build_reasons(health, last_found is None, placed_at, now)
    health['level'] = _build_level(health)
    return health


def _build_reasons(
    health: dict,
    never_found: bool,
    placed_at: datetime | None,
    now: datetime,
) -> list[str]:
    reasons: list[str] = []
    status = (health.get('listing_status') or '').lower()

    if status == 'archived':
        reasons.append('Géocache archivée.')
    elif status == 'disabled':
        reasons.append('Géocache désactivée par le propriétaire.')

    consecutive_dnf = health['consecutive_dnf']
    if consecutive_dnf == 1:
        reasons.append('1 DNF depuis la dernière trouvaille.')
    elif consecutive_dnf > 1:
        reasons.append(f'{consecutive_dnf} DNF consécutifs depuis la dernière trouvaille.')

    days = health['days_since_last_found']
    if never_found:
        if placed_at is not None:
            placed_days = _days_since(placed_at, now)
            reasons.append(
                f'Jamais trouvée dans les logs locaux (publiée il y a {placed_days} jours).'
            )
        else:
            reasons.append('Jamais trouvée dans les logs locaux.')
    elif days is not None and days > STALE_DAYS_WATCH:
        reasons.append(f'Dernière trouvaille il y a {days} jours.')

    if health['needs_maintenance_pending']:
        reasons.append('Demande de maintenance sans intervention du propriétaire depuis.')

    ratio = health['dnf_ratio_recent']
    if ratio is not None and ratio >= DNF_RATIO_WATCH:
        reasons.append(f'{int(ratio * 100)} % de DNF sur les dernières visites.')

    if not reasons:
        reasons.append('Rien à signaler dans les logs locaux.')

    return reasons


def _build_level(health: dict) -> str:
    """
    Niveau de santé. La première règle qui s'applique gagne : l'ordre encode la gravité.
    """
    status = (health.get('listing_status') or '').lower()
    if status in ('archived', 'disabled'):
        return 'very_risky'

    consecutive_dnf = health['consecutive_dnf']
    days = health['days_since_last_found']
    pending = health['needs_maintenance_pending']
    ratio = health['dnf_ratio_recent']

    if consecutive_dnf >= DNF_VERY_RISKY or (consecutive_dnf >= DNF_RISKY and pending):
        return 'very_risky'

    if (
        consecutive_dnf == DNF_RISKY
        or (days is not None and days > STALE_DAYS_RISKY)
        or (pending and days is not None and days > STALE_DAYS_WATCH)
    ):
        return 'risky'

    # Des logs existent mais aucune trouvaille : ce n'est pas « rien à signaler ».
    never_found = health['last_found_date'] is None

    if (
        consecutive_dnf == 1
        or (days is not None and days > STALE_DAYS_WATCH)
        or pending
        or never_found
        or (ratio is not None and ratio >= DNF_RATIO_WATCH)
    ):
        return 'watch'

    return 'ok'


HEALTH_LABELS: dict[str, str] = {
    'ok': 'saine',
    'watch': 'à surveiller',
    'risky': 'risquée',
    'very_risky': 'très risquée',
    'unknown': 'inconnue (pas de logs locaux)',
}


def health_label(level: str) -> str:
    return HEALTH_LABELS.get(level, level)
