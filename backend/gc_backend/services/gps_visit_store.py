"""
Mémoire des visites lues dans le ``geocache_visits.txt`` des GPS Garmin.

`garmin_visits.py` lit et réduit (testable sans base), ce module fait la base
(testable sans fichier réel).

Règles :
- un réimport du même fichier n'ajoute rien (clé ``raw_code, visited_at,
  status_raw, occurrence``) ;
- tant qu'aucun point de départ n'a été choisi, l'import le signale
  (``needs_cutoff``) : sans lui, des années de visites seraient proposées à loguer ;
- une visite antérieure au point de départ arrive directement en ``history`` ;
- l'état ``history`` n'est jamais posé à la main, seulement par le point de départ.
"""
from __future__ import annotations

import json
import logging
from collections import Counter
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone, tzinfo
from typing import Iterable, Optional

from ..database import db
from ..models import AppConfig, GpsVisit, Zone
from .garmin_visits import (
    ParseResult,
    ReducedVisit,
    VisitRecord,
    local_day,
    local_midnight_utc,
    occurrence_keys,
    reduce_by_cache_day,
)

logger = logging.getLogger(__name__)

LAST_IMPORT_KEY = 'gps_visits.last_import'
CUTOFF_KEY = 'gps_visits.cutoff'
LAST_ZONE_KEY = 'gps_visits.last_zone_id'

STATES = ('pending', 'logged', 'ignored', 'history')
# `history` ne se pose qu'à travers le point de départ.
USER_SETTABLE_STATES = ('pending', 'logged', 'ignored')

# Au-delà, la liste est tronquée aux jours les plus récents.
DEFAULT_MAX_DAYS = 90


TIMEZONE_PREF = 'geoApp.gpsVisits.timezone'


def get_local_tz() -> Optional[tzinfo]:
    """
    Fuseau des dates de log : la préférence ``geoApp.gpsVisits.timezone`` (nom IANA,
    ex. « Europe/Paris ») si elle est renseignée, sinon ``None`` = celui de l'OS, sur
    lequel tourne le backend. Utile pour loguer au retour d'un voyage.
    """
    from ..utils.preferences import get_value_or_default

    name = str(get_value_or_default(TIMEZONE_PREF, '') or '').strip()
    if not name:
        return None
    try:
        from zoneinfo import ZoneInfo

        return ZoneInfo(name)
    except Exception as exc:  # noqa: BLE001 - un nom invalide ne doit pas bloquer les visites
        logger.warning("Fuseau « %s » inconnu, fuseau de l'OS utilisé : %s", name, exc)
        return None


@dataclass
class ImportReport:
    total: int
    new: int
    known: int
    without_code: int
    unreadable: list[tuple[int, str]]
    first_visit_day: Optional[date]
    last_visit_day: Optional[date]
    needs_cutoff: bool
    source: str

    def to_dict(self) -> dict:
        landmarks = None
        if self.last_visit_day:
            landmarks = {
                'last_visit_day': self.last_visit_day.isoformat(),
                'week_before': (self.last_visit_day - timedelta(days=7)).isoformat(),
                'month_before': (self.last_visit_day - timedelta(days=30)).isoformat(),
                'first_visit_day': self.first_visit_day.isoformat() if self.first_visit_day else None,
            }
        return {
            'total': self.total,
            'new': self.new,
            'known': self.known,
            'without_code': self.without_code,
            'unreadable_count': len(self.unreadable),
            # Échantillon seulement : un fichier corrompu ne doit pas produire une réponse énorme.
            'unreadable': [{'line': line, 'content': content} for line, content in self.unreadable[:10]],
            'needs_cutoff': self.needs_cutoff,
            'landmarks': landmarks,
            'source': self.source,
        }


def get_cutoff() -> Optional[date]:
    raw = AppConfig.get_value(CUTOFF_KEY)
    if not raw:
        return None
    try:
        return date.fromisoformat(raw)
    except ValueError:
        return None


def get_last_import() -> Optional[dict]:
    raw = AppConfig.get_value(LAST_IMPORT_KEY)
    if not raw:
        return None
    try:
        return json.loads(raw)
    except ValueError:
        return None


def import_visits(parsed: ParseResult, *, source: str, tz: Optional[tzinfo] = None) -> ImportReport:
    """Ajoute les visites inconnues. Idempotent : réimporter le même fichier n'ajoute rien."""
    keys = occurrence_keys(parsed.visits)
    existing = {
        tuple(row) for row in db.session.query(
            GpsVisit.raw_code, GpsVisit.visited_at, GpsVisit.status_raw, GpsVisit.occurrence
        ).all()
    }
    cutoff = get_cutoff()
    boundary = local_midnight_utc(cutoff, tz) if cutoff else None

    new_rows = []
    for visit, key in zip(parsed.visits, keys):
        if key in existing:
            continue
        raw_code, visited_at, status_raw, occurrence = key
        new_rows.append(GpsVisit(
            raw_code=raw_code,
            gc_code=visit.gc_code,
            visited_at=visited_at,
            status_raw=status_raw,
            occurrence=occurrence,
            status=visit.status,
            comment=visit.comment or None,
            state='history' if boundary is not None and visited_at < boundary else 'pending',
        ))
    if new_rows:
        db.session.add_all(new_rows)

    first_day = local_day(parsed.visits[0].visited_at, tz) if parsed.visits else None
    last_day = local_day(parsed.visits[-1].visited_at, tz) if parsed.visits else None
    report = ImportReport(
        total=len(parsed.visits),
        new=len(new_rows),
        known=len(parsed.visits) - len(new_rows),
        without_code=sum(1 for v in parsed.visits if not v.gc_code),
        unreadable=parsed.unreadable,
        first_visit_day=first_day,
        last_visit_day=last_day,
        needs_cutoff=cutoff is None and bool(parsed.visits),
        source=source,
    )
    AppConfig.set_value(LAST_IMPORT_KEY, json.dumps({
        'at': datetime.now(timezone.utc).isoformat(),
        'source': source,
        'total': report.total,
        'new': report.new,
        'last_visit_day': last_day.isoformat() if last_day else None,
    }))
    db.session.commit()
    logger.info('Visites GPS importées depuis %s : %d nouvelles sur %d', source, report.new, report.total)
    return report


def apply_cutoff(since: date, *, tz: Optional[tzinfo] = None) -> dict:
    """
    Point de départ : ce qui précède passe en historique, ce qui suit redevient à loguer.

    Rappelable pour avancer ou reculer le point de départ. Les visites loguées
    ou ignorées gardent leur état.
    """
    boundary = local_midnight_utc(since, tz)
    to_history = GpsVisit.query.filter(
        GpsVisit.state == 'pending', GpsVisit.visited_at < boundary
    ).update({'state': 'history'}, synchronize_session=False)
    to_pending = GpsVisit.query.filter(
        GpsVisit.state == 'history', GpsVisit.visited_at >= boundary
    ).update({'state': 'pending'}, synchronize_session=False)
    AppConfig.set_value(CUTOFF_KEY, since.isoformat())
    db.session.commit()
    return {'cutoff': since.isoformat(), 'to_history': to_history, 'to_pending': to_pending}


def set_state(visit_ids: Iterable[int], state: str) -> int:
    if state not in USER_SETTABLE_STATES:
        raise ValueError(f'invalid_state:{state}')
    ids = [int(i) for i in visit_ids]
    if not ids:
        return 0
    updated = GpsVisit.query.filter(
        GpsVisit.id.in_(ids), GpsVisit.state != 'history'
    ).update({'state': state}, synchronize_session=False)
    db.session.commit()
    return updated


def _records(rows: Iterable[GpsVisit]) -> list[VisitRecord]:
    return [
        VisitRecord(
            id=row.id,
            gc_code=row.effective_gc_code,
            visited_at=row.visited_at,
            status=row.status,
            status_raw=row.status_raw,
            comment=row.comment or '',
            state=row.state,
        )
        for row in rows
    ]


def _geocaches_by_code(codes: set[str]) -> dict[str, list]:
    """Géocaches connues de GeoApp pour ces codes (une même cache peut exister dans plusieurs zones)."""
    from ..geocaches.models import Geocache

    if not codes:
        return {}
    by_code: dict[str, list] = {}
    rows = db.session.query(Geocache, Zone.name).join(Zone, Geocache.zone_id == Zone.id).filter(
        Geocache.gc_code.in_(sorted(codes))
    ).all()
    for geocache, zone_name in rows:
        by_code.setdefault(geocache.gc_code, []).append((geocache, zone_name))
    for entries in by_code.values():
        # La plus récemment mise à jour d'abord : c'est elle qu'on réutilise par défaut.
        entries.sort(key=lambda e: e[0].updated_at or datetime.min, reverse=True)
    return by_code


def entry_dict(reduced: ReducedVisit, rows_by_id: dict[int, GpsVisit], geocaches_by_code: dict[str, list]) -> dict:
    first_row = rows_by_id[reduced.visit_ids[0]]
    known = geocaches_by_code.get(reduced.gc_code or '', [])
    found_dates = [g.found_date for g, _ in known if g.found_date]
    return {
        'key': reduced.key,
        'visit_ids': reduced.visit_ids,
        'gc_code': reduced.gc_code,
        'raw_code': first_row.raw_code,
        'resolved': bool(first_row.resolved_gc_code and not first_row.gc_code),
        'resolution_source': first_row.resolution_source,
        'day': reduced.day.isoformat(),
        'time': reduced.local_time,
        'visited_at': reduced.visited_at.replace(tzinfo=None).isoformat() + 'Z',
        'status': reduced.status,
        'status_raw': reduced.status_raw,
        'proposed_log_type': reduced.proposed_log_type,
        'has_nm': reduced.has_nm,
        'needs_confirmation': reduced.needs_confirmation,
        'comment': reduced.comment,
        'raw_count': reduced.raw_count,
        'passes': reduced.passes,
        'state': reduced.state,
        'name': known[0][0].name if known else None,
        'cache_type': known[0][0].type if known else None,
        'geocaches': [
            {'id': g.id, 'zone_id': g.zone_id, 'zone_name': zone_name, 'name': g.name}
            for g, zone_name in known
        ],
        'found': any(bool(g.found) for g, _ in known),
        'found_date': found_dates[0].isoformat() if found_dates else None,
    }


def list_grouped(
    *,
    states: Iterable[str] = ('pending',),
    from_day: Optional[date] = None,
    to_day: Optional[date] = None,
    max_days: int = DEFAULT_MAX_DAYS,
    tz: Optional[tzinfo] = None,
) -> dict:
    """Visites réduites, groupées par jour local (le plus récent d'abord)."""
    wanted = {s for s in states if s in STATES}
    query = GpsVisit.query.filter(GpsVisit.state != 'history')
    if 'history' in wanted:
        query = GpsVisit.query
    if from_day:
        query = query.filter(GpsVisit.visited_at >= local_midnight_utc(from_day, tz))
    if to_day:
        query = query.filter(GpsVisit.visited_at < local_midnight_utc(to_day + timedelta(days=1), tz))
    rows = query.order_by(GpsVisit.visited_at, GpsVisit.id).all()
    rows_by_id = {row.id: row for row in rows}

    reduced = reduce_by_cache_day(_records(rows), tz)
    counts = Counter(r.state for r in reduced)
    selected = [r for r in reduced if r.state in wanted]

    days: dict[date, list[ReducedVisit]] = {}
    for entry in selected:
        days.setdefault(entry.day, []).append(entry)
    ordered_days = sorted(days, reverse=True)
    truncated = len(ordered_days) > max_days
    ordered_days = ordered_days[:max_days]

    codes = {e.gc_code for d in ordered_days for e in days[d] if e.gc_code}
    geocaches_by_code = _geocaches_by_code(codes)

    return {
        'days': [
            {'day': d.isoformat(), 'entries': [entry_dict(e, rows_by_id, geocaches_by_code) for e in days[d]]}
            for d in ordered_days
        ],
        'truncated': truncated,
        'counts': {state: counts.get(state, 0) for state in STATES if state != 'history'},
        'cutoff': (get_cutoff().isoformat() if get_cutoff() else None),
        'last_import': get_last_import(),
    }


def get_last_zone_id() -> Optional[int]:
    raw = AppConfig.get_value(LAST_ZONE_KEY)
    try:
        return int(raw) if raw else None
    except ValueError:
        return None


def set_last_zone_id(zone_id: int) -> None:
    AppConfig.set_value(LAST_ZONE_KEY, str(zone_id))
    db.session.commit()


def prepare_day(day: date, *, zone_id: Optional[int] = None, tz: Optional[tzinfo] = None) -> dict:
    """
    Ce qu'il faut pour ouvrir l'éditeur de logs sur un jour : les caches à loguer,
    dans l'ordre de visite, chacune avec la géocache GeoApp à utiliser.

    - Une cache présente en base est réutilisée là où elle est (celle de
      ``zone_id`` si elle y est, sinon la plus récemment mise à jour) : jamais
      déplacée. `GeocacheImporter.import_by_code` déplacerait une cache existante
      dans la zone cible, d'où l'import des seules caches absentes.
    - Une cache absente de la base part dans ``missing_codes``, sauf si la
      visite n'a pas été tentée : importer une cache qu'on ne loguera pas ne sert à rien.
    - Les visites sans code attendent leur rattachement (``without_code``).
    """
    listing = list_grouped(states=('pending',), from_day=day, to_day=day, max_days=1, tz=tz)
    entries = listing['days'][0]['entries'] if listing['days'] else []

    prepared: list[dict] = []
    missing_codes: list[str] = []
    without_code: list[dict] = []
    skipped_unattempted: list[str] = []
    for entry in entries:
        if not entry['gc_code']:
            without_code.append(entry)
            continue
        known = entry['geocaches']
        chosen = next((g for g in known if zone_id is not None and g['zone_id'] == zone_id), None)
        if chosen is None and known:
            chosen = known[0]
        if chosen is None:
            if entry['proposed_log_type'] == 'skip':
                skipped_unattempted.append(entry['gc_code'])
                continue
            missing_codes.append(entry['gc_code'])
        prepared.append({**entry, 'geocache_id': chosen['id'] if chosen else None})

    return {
        'day': day.isoformat(),
        'entries': prepared,
        'missing_codes': missing_codes,
        'without_code': without_code,
        'skipped_unattempted': skipped_unattempted,
        'last_zone_id': get_last_zone_id(),
    }


def mark_logged(gc_code: str, log_date: date, *, log_reference_code: Optional[str] = None,
                tz: Optional[tzinfo] = None) -> int:
    """
    Un log de cette cache vient de partir pour ce jour : ses visites à loguer de ce
    jour-là passent en ``logged``. Correspondance par code (lu sur le GPS ou rattaché)
    et par jour local — la date du log est celle de la visite.
    """
    code = (gc_code or '').strip().upper()
    if not code:
        return 0
    start = local_midnight_utc(log_date, tz)
    end = local_midnight_utc(log_date + timedelta(days=1), tz)
    rows = GpsVisit.query.filter(
        db.or_(GpsVisit.gc_code == code, GpsVisit.resolved_gc_code == code),
        GpsVisit.state == 'pending',
        GpsVisit.visited_at >= start,
        GpsVisit.visited_at < end,
    ).all()
    for row in rows:
        row.state = 'logged'
        if log_reference_code:
            row.log_reference_code = log_reference_code
    if rows:
        db.session.commit()
    return len(rows)


def mark_nm_logged(gc_code: str, log_date: date, log_reference_code: str, *, tz: Optional[tzinfo] = None) -> int:
    """Un signalement vient de partir : il est noté sur les visites NM de la cache ce jour-là."""
    code = (gc_code or '').strip().upper()
    if not code or not log_reference_code:
        return 0
    start = local_midnight_utc(log_date, tz)
    end = local_midnight_utc(log_date + timedelta(days=1), tz)
    rows = GpsVisit.query.filter(
        db.or_(GpsVisit.gc_code == code, GpsVisit.resolved_gc_code == code),
        GpsVisit.status == 'needs_maintenance',
        GpsVisit.visited_at >= start,
        GpsVisit.visited_at < end,
    ).all()
    for row in rows:
        row.nm_log_reference_code = log_reference_code
    if rows:
        db.session.commit()
    return len(rows)
