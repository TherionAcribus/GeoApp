"""
Lecture du fichier ``geocache_visits.txt`` des GPS Garmin.

Le GPS ajoute une ligne à chaque visite de cache et ne vide jamais le fichier :
celui d'un joueur actif contient des milliers de visites, sur des années.
Ce module ne fait que lire et réduire (aucune base, aucun réseau) ;
``gps_visit_store`` s'occupe de la mémoire de ce qui a déjà été traité.

Format constaté (voir documentation/garmin-visites-spec.md) :

    GC3E6GR,2012-11-30T18:23Z,Found it,""
    GC62VNM,2019-12-29T12:05Z,Didn't find it,"



    MMM
    A"

- UTF-16 LE **sans BOM** sur les Oregon/GPSMAP, avec repli UTF-8 pour les autres ;
- le ``Z`` est vrai : les heures sont en UTC, la date du log se calcule en heure locale ;
- le commentaire, tapé au clavier du GPS, peut s'étendre sur plusieurs lignes ;
- le code peut être vide ou abîmé (``8``, ``#``, octet de contrôle) : la visite
  est gardée, sans code, pour être rattachée plus tard.
"""
from __future__ import annotations

import csv
import io
import re
from collections import Counter
from dataclasses import dataclass, field
from datetime import date, datetime, time, timezone, tzinfo
from typing import Iterable, Optional

GC_CODE_RE = re.compile(r'^GC[0-9A-Z]{1,8}$')

# Blancs, caractères de contrôle et caractères invisibles (BOM, espaces de largeur nulle).
_INVISIBLE_RE = re.compile(r'[\s\x00-\x1f\x7f​-‏⁠﻿]')

_TIMESTAMP_RE = re.compile(r'^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?Z?$')

STATUS_FOUND = 'found'
STATUS_DNF = 'dnf'
STATUS_UNATTEMPTED = 'unattempted'
STATUS_NEEDS_MAINTENANCE = 'needs_maintenance'
STATUS_OTHER = 'other'

_STATUS_BY_LABEL = {
    'found it': STATUS_FOUND,
    'webcam photo taken': STATUS_FOUND,
    "didn't find it": STATUS_DNF,
    'didn’t find it': STATUS_DNF,
    'didnt find it': STATUS_DNF,
    'unattempted': STATUS_UNATTEMPTED,
    'needs maintenance': STATUS_NEEDS_MAINTENANCE,
}

# Résultat retenu quand une cache a plusieurs lignes le même jour : la trouvaille
# l'emporte sur tout, une ligne « pas tentée » ne l'emporte sur rien.
STATUS_PRIORITY = {
    STATUS_FOUND: 0,
    STATUS_NEEDS_MAINTENANCE: 1,
    STATUS_DNF: 2,
    STATUS_OTHER: 3,
    STATUS_UNATTEMPTED: 4,
}

# Type de log proposé dans l'éditeur pour chaque résultat gagnant.
PROPOSED_LOG_TYPE = {
    STATUS_FOUND: 'found',
    STATUS_DNF: 'dnf',
    STATUS_UNATTEMPTED: 'skip',
    # Sur le Garmin, choisir NM remplace le résultat de la visite : on propose
    # « trouvée », à confirmer par l'utilisateur (`needs_confirmation`).
    STATUS_NEEDS_MAINTENANCE: 'found',
    STATUS_OTHER: 'note',
}

COMMENT_SEPARATOR = ' / '


@dataclass(frozen=True)
class RawVisit:
    """Une ligne du fichier, telle que le GPS l'a écrite."""
    line_no: int
    raw_code: str
    gc_code: Optional[str]
    visited_at: datetime  # UTC, avec fuseau
    status_raw: str
    status: str
    comment: str


@dataclass
class ParseResult:
    visits: list[RawVisit] = field(default_factory=list)
    # (numéro de ligne, contenu brut) des lignes illisibles : on les rapporte,
    # on ne les fait jamais disparaître sans rien dire.
    unreadable: list[tuple[int, str]] = field(default_factory=list)


@dataclass(frozen=True)
class VisitRecord:
    """Visite à réduire : une ligne du fichier ou de la base, avec son code effectif."""
    id: int
    gc_code: Optional[str]
    visited_at: datetime
    status: str
    status_raw: str
    comment: str = ''
    state: str = 'pending'


@dataclass
class ReducedVisit:
    """Résultat d'une cache pour un jour (ou une visite sans code, toujours seule)."""
    key: str
    gc_code: Optional[str]
    day: date
    visited_at: datetime   # heure de la ligne gagnante, UTC
    local_time: str        # HH:MM, heure locale
    status: str
    status_raw: str
    has_nm: bool
    needs_confirmation: bool
    comment: str
    raw_count: int
    visit_ids: list[int]
    passes: list[dict]
    states: set[str]

    @property
    def proposed_log_type(self) -> str:
        return PROPOSED_LOG_TYPE.get(self.status, 'note')

    @property
    def state(self) -> str:
        """État du groupe : à loguer tant qu'une de ses lignes l'est."""
        for candidate in ('pending', 'logged', 'ignored', 'history'):
            if candidate in self.states:
                return candidate
        return 'pending'


def decode_visits_file(data: bytes) -> str:
    """Décode le fichier quel que soit l'encodage choisi par le modèle de GPS."""
    if data.startswith(b'\xff\xfe') or data.startswith(b'\xfe\xff'):
        text = data.decode('utf-16', errors='replace')
    elif data.startswith(b'\xef\xbb\xbf'):
        text = data[3:].decode('utf-8', errors='replace')
    elif len(data) >= 4 and data[1] == 0 and data[3] == 0 and data[0] != 0:
        text = data.decode('utf-16-le', errors='replace')
    elif len(data) >= 4 and data[0] == 0 and data[2] == 0 and data[1] != 0:
        text = data.decode('utf-16-be', errors='replace')
    else:
        try:
            text = data.decode('utf-8')
        except UnicodeDecodeError:
            text = data.decode('cp1252', errors='replace')
    return text.lstrip('﻿')


def normalize_code(raw: str) -> Optional[str]:
    """Code GC propre, ou ``None`` si la valeur n'en est pas un (vide, ``8``, ``#``…)."""
    code = _INVISIBLE_RE.sub('', raw or '').upper()
    return code if GC_CODE_RE.match(code) else None


def clean_raw_code(raw: str) -> str:
    """Valeur brute stockable : sans caractères de contrôle, bornée."""
    return _INVISIBLE_RE.sub('', raw or '')[:40]


def map_status(raw: str) -> str:
    return _STATUS_BY_LABEL.get((raw or '').strip().lower(), STATUS_OTHER)


def parse_timestamp(raw: str) -> Optional[datetime]:
    match = _TIMESTAMP_RE.match((raw or '').strip())
    if not match:
        return None
    year, month, day, hour, minute, second = match.groups()
    try:
        return datetime(int(year), int(month), int(day), int(hour), int(minute),
                        int(second or 0), tzinfo=timezone.utc)
    except ValueError:
        return None


def parse_visits(data: bytes) -> ParseResult:
    """Lit toutes les visites du fichier, dans l'ordre chronologique."""
    text = decode_visits_file(data).replace('\r\n', '\n').replace('\r', '\n')
    result = ParseResult()
    reader = csv.reader(io.StringIO(text))
    while True:
        start_line = reader.line_num + 1
        try:
            row = next(reader)
        except StopIteration:
            break
        except csv.Error as exc:
            result.unreadable.append((start_line, f'CSV illisible : {exc}'))
            continue
        if not row or all(not cell.strip() for cell in row):
            continue
        visited_at = parse_timestamp(row[1]) if len(row) >= 3 else None
        if visited_at is None:
            result.unreadable.append((start_line, ','.join(row)[:200]))
            continue
        # Une virgule hors guillemets dans le commentaire ajoute des colonnes : on les recolle.
        comment = ','.join(row[3:]).strip() if len(row) > 3 else ''
        status_raw = row[2].strip()
        result.visits.append(RawVisit(
            line_no=start_line,
            raw_code=clean_raw_code(row[0]),
            gc_code=normalize_code(row[0]),
            visited_at=visited_at,
            status_raw=status_raw[:60],
            status=map_status(status_raw),
            comment=comment,
        ))
    result.visits.sort(key=lambda v: (v.visited_at, v.line_no))
    return result


def occurrence_keys(visits: Iterable[RawVisit]) -> list[tuple[str, datetime, str, int]]:
    """
    Clé d'unicité de chaque visite : ``(code brut, heure, statut, rang)``.

    Le rang distingue deux lignes identiques du fichier — deux visites sans code
    à la même minute, par exemple. Le fichier n'étant jamais réécrit, seulement
    complété, le rang d'une ligne reste stable d'un import à l'autre.
    """
    seen: Counter = Counter()
    keys = []
    for visit in visits:
        base = (visit.raw_code, visit.visited_at.replace(tzinfo=None), visit.status_raw)
        keys.append((*base, seen[base]))
        seen[base] += 1
    return keys


def as_utc(value: datetime) -> datetime:
    """Les dates de la base sont naïves en UTC ; celles du lecteur portent leur fuseau."""
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def to_local(value: datetime, tz: Optional[tzinfo] = None) -> datetime:
    """Heure locale : fuseau fourni, sinon celui de l'OS (le backend tourne chez l'utilisateur)."""
    return as_utc(value).astimezone(tz) if tz is not None else as_utc(value).astimezone()


def local_day(value: datetime, tz: Optional[tzinfo] = None) -> date:
    return to_local(value, tz).date()


def local_midnight_utc(day: date, tz: Optional[tzinfo] = None) -> datetime:
    """Début du jour local ``day``, en UTC naïf (pour comparer aux dates de la base)."""
    if tz is not None:
        start = datetime.combine(day, time.min, tzinfo=tz)
    else:
        start = datetime.combine(day, time.min).astimezone()
    return start.astimezone(timezone.utc).replace(tzinfo=None)


def reduce_by_cache_day(records: Iterable[VisitRecord], tz: Optional[tzinfo] = None) -> list[ReducedVisit]:
    """
    Un résultat par cache et par jour local, dans l'ordre chronologique.

    Exemple réel : GC4NKAY le 2015-05-10 — Unattempted 11:38, Unattempted 11:39,
    DNF 11:42, Found 11:45 — donne une trouvaille à 11:45, « 4 passages ».
    Les visites sans code ne sont jamais fusionnées : rien ne dit qu'elles
    concernent la même cache.
    """
    groups: dict[tuple, list[VisitRecord]] = {}
    for record in sorted(records, key=lambda r: (as_utc(r.visited_at), r.id)):
        day = local_day(record.visited_at, tz)
        key = (record.gc_code, day) if record.gc_code else ('visit', record.id)
        groups.setdefault(key, []).append(record)

    reduced: list[ReducedVisit] = []
    for key, members in groups.items():
        winner = min(members, key=lambda r: (STATUS_PRIORITY.get(r.status, 99), as_utc(r.visited_at)))
        statuses = {m.status for m in members}
        comments = [m.comment.strip() for m in members if m.comment and m.comment.strip()]
        local_winner = to_local(winner.visited_at, tz)
        reduced.append(ReducedVisit(
            key=f'{winner.gc_code}:{local_winner.date().isoformat()}' if winner.gc_code else f'visit:{winner.id}',
            gc_code=winner.gc_code,
            day=local_winner.date(),
            visited_at=as_utc(winner.visited_at),
            local_time=local_winner.strftime('%H:%M'),
            status=winner.status,
            status_raw=winner.status_raw,
            has_nm=STATUS_NEEDS_MAINTENANCE in statuses,
            needs_confirmation=winner.status == STATUS_NEEDS_MAINTENANCE,
            comment=COMMENT_SEPARATOR.join(dict.fromkeys(comments)),
            raw_count=len(members),
            visit_ids=[m.id for m in members],
            passes=[
                {'time': to_local(m.visited_at, tz).strftime('%H:%M'), 'status_raw': m.status_raw}
                for m in members
            ],
            states={m.state for m in members},
        ))
    reduced.sort(key=lambda r: (r.visited_at, r.key))
    return reduced
