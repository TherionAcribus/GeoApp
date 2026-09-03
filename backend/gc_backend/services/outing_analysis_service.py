"""
Construction du bundle d'analyse de sortie.

Rassemble, pour un lot de géocaches, tout ce dont une IA a besoin pour produire un
rapport de préparation : identité, attributs traduits en signaux, hint décodé, extrait de
listing, waypoints, santé calculée et — surtout — les logs qui parlent de matériel.

Deux sélections de logs cohabitent, parce qu'elles répondent à des questions différentes :

- `recent_logs` : les N derniers, pour l'état actuel de la cache ;
- `gear_logs` : ceux qui mentionnent du matériel, **quelle que soit leur date**. Un log
  de 2019 disant « il faut une canne à pêche » ne sortirait jamais des N derniers, et
  c'est pourtant l'information la plus utile de toute la fiche.

Un même log peut apparaître dans les deux listes : c'est voulu, l'extrait est alors
identique pour qu'on reconnaisse qu'il s'agit du même.
"""

from __future__ import annotations

import logging
import re
from datetime import datetime, timezone

from sqlalchemy.orm import selectinload

from ..geocaches.models import Geocache, GeocacheLog
from .outing_gear_signals import build_gear_signals, count_unresolved
from .outing_health import compute_health
from .outing_lexicons import find_gear_mentions, find_search_effort_mentions, normalize

logger = logging.getLogger(__name__)

#: Longueur d'un extrait de log, centré sur la première mention repérée.
LOG_EXCERPT_CHARS = 300

#: Plafond des logs « effort de recherche » : trois suffisent à donner le ton.
MAX_SEARCH_EFFORT_LOGS = 3

#: Types de géocaches dont les coordonnées publiées ne sont pas les bonnes tant que
#: l'énigme n'est pas résolue.
_MYSTERY_TYPES = ('mystery', 'unknown', 'puzzle')

_TAG_RE = re.compile(r'<[^>]+>')
_WHITESPACE_RE = re.compile(r'\s+')


# ─────────────────────────────────────────────────────────────────────────────
# Helpers de texte
# ─────────────────────────────────────────────────────────────────────────────

def _strip_html(html_text: str | None) -> str:
    """Texte brut d'un fragment HTML. BeautifulSoup si disponible, regex sinon."""
    if not html_text:
        return ''
    try:
        from bs4 import BeautifulSoup
        text = BeautifulSoup(html_text, 'html.parser').get_text(' ')
    except Exception:  # pragma: no cover - dépend de l'environnement
        text = _TAG_RE.sub(' ', html_text)
    return _clean_whitespace(text)


def _clean_whitespace(text: str | None) -> str:
    if not text:
        return ''
    return _WHITESPACE_RE.sub(' ', str(text)).strip()


def _truncate_on_word(text: str, limit: int) -> tuple[str, bool]:
    """Tronque sur une frontière de mot. Renvoie (texte, a_ete_tronque)."""
    if limit <= 0 or len(text) <= limit:
        return text, False
    cut = text[:limit]
    space = cut.rfind(' ')
    if space > limit * 0.6:
        cut = cut[:space]
    return cut.rstrip() + '…', True


def _excerpt_around(text: str, needle_keys: list[str], size: int = LOG_EXCERPT_CHARS) -> str:
    """
    Extrait centré sur la première mention de matériel.

    Sans mention repérable, on retombe sur le début du texte : c'est le cas des logs
    récents, retenus pour leur date et non pour leur contenu.
    """
    cleaned = _clean_whitespace(text)
    if len(cleaned) <= size:
        return cleaned

    position = -1
    if needle_keys:
        from .outing_lexicons import GEAR_LEXICON, normalize
        haystack = normalize(cleaned)
        for key in needle_keys:
            for term in GEAR_LEXICON.get(key, ()):  # premier terme trouvé
                found = haystack.find(normalize(term))
                if found != -1 and (position == -1 or found < position):
                    position = found
            if position != -1:
                break

    if position == -1:
        excerpt, _ = _truncate_on_word(cleaned, size)
        return excerpt

    start = max(0, position - size // 3)
    end = min(len(cleaned), start + size)
    excerpt = cleaned[start:end].strip()
    return ('…' if start > 0 else '') + excerpt + ('…' if end < len(cleaned) else '')


# ─────────────────────────────────────────────────────────────────────────────
# Champs dérivés d'une géocache
# ─────────────────────────────────────────────────────────────────────────────

# Mots très courants, FR et EN, servant à reconnaître du texte en clair. Un hint ROT13
# n'en contient aucun ; un hint lisible en contient presque toujours au moins un.
_PLAINTEXT_MARKERS = (
    'le', 'la', 'les', 'de', 'du', 'des', 'un', 'une', 'dans', 'sur', 'sous', 'au', 'aux',
    'et', 'est', 'pied', 'pres', 'derriere', 'gauche', 'droite', 'arbre',
    'the', 'of', 'in', 'on', 'at', 'and', 'is', 'to', 'for', 'under', 'behind', 'near',
)

_VOWELS = set('aeiouy')


def _plaintext_score(text: str) -> tuple[int, float]:
    """
    À quel point ce texte ressemble-t-il à de la langue naturelle ?

    Deux mesures, de la plus fiable à la moins fiable : le nombre de mots courants
    reconnus, puis la proportion de voyelles. Le ROT13 d'un texte français fait chuter
    les deux (« de » devient « qr », « dans » devient « qnaf »).
    """
    normalized = normalize(text)
    words = set(re.findall(r"[a-z]+", normalized))
    marker_hits = sum(1 for marker in _PLAINTEXT_MARKERS if marker in words)

    letters = [ch for ch in normalized if ch.isalpha()]
    vowel_ratio = (sum(1 for ch in letters if ch in _VOWELS) / len(letters)) if letters else 0.0

    return marker_hits, vowel_ratio


def _resolve_hint(geocache: Geocache) -> str | None:
    """
    Hint lisible, corrigé du cas où les colonnes sont inversées en base.

    L'ordre nominal est celui de `Geocache.to_dict()` : correction manuelle, puis hint
    décodé, puis ROT13 de `hints`. Mais sur une partie du parc, `hints` contient le texte
    en clair et `hints_decoded` son ROT13 — les deux colonnes ont été renseignées à
    l'envers à l'import. Envoyer du ROT13 à l'IA est pire qu'inutile : elle tenterait de
    l'interpréter. On choisit donc, entre les deux candidats, celui qui ressemble le plus
    à de la langue naturelle.
    """
    override = (geocache.hints_decoded_override or '').strip()
    if override:
        return override

    candidates: list[str] = []

    decoded = (geocache.hints_decoded or '').strip()
    if decoded:
        candidates.append(decoded)

    raw = (geocache.hints or '').strip()
    if raw:
        candidates.append(raw)
        try:
            rotated = Geocache.decode_hint_rot13(raw).strip()
            if rotated:
                candidates.append(rotated)
        except Exception:
            pass

    if not candidates:
        return None

    # `max` conserve le premier en cas d'égalité : l'ordre des candidats reste donc la
    # priorité nominale, et l'heuristique ne tranche que lorsqu'elle voit une différence.
    return max(candidates, key=_plaintext_score)


def _resolve_listing(geocache: Geocache, listing_chars: int) -> tuple[str, bool]:
    """Extrait de listing en texte brut, tronqué sur une frontière de mot."""
    for candidate in (
        geocache.description_override_raw,
        geocache.description_raw,
    ):
        cleaned = _clean_whitespace(candidate)
        if cleaned:
            return _truncate_on_word(cleaned, listing_chars)

    for candidate in (
        geocache.description_override_html,
        geocache.description_html,
    ):
        cleaned = _strip_html(candidate)
        if cleaned:
            return _truncate_on_word(cleaned, listing_chars)

    return '', False


def _resolve_coordinates(geocache: Geocache) -> str | None:
    """Coordonnées affichables : les corrigées si elles existent, sinon les publiées."""
    for candidate in (geocache.coordinates_raw, geocache.original_coordinates_raw):
        cleaned = _clean_whitespace(candidate)
        if cleaned:
            return cleaned
    if geocache.latitude is not None and geocache.longitude is not None:
        return f'{geocache.latitude}, {geocache.longitude}'
    return None


def _is_unsolved_mystery(geocache: Geocache) -> bool:
    """
    Mystery dont les coordonnées finales sont encore inconnues.

    Cas bloquant pour une sortie : sans coordonnées corrigées, se déplacer ne sert à rien.
    """
    cache_type = (geocache.type or '').lower()
    if not any(token in cache_type for token in _MYSTERY_TYPES):
        return False
    if geocache.solved == 'solved':
        return False
    return not bool(geocache.is_corrected)


def _serialize_attributes(geocache: Geocache) -> list[dict]:
    attributes = geocache.attributes if isinstance(geocache.attributes, list) else []
    serialized = []
    for attribute in attributes:
        if not isinstance(attribute, dict):
            continue
        label = _clean_whitespace(attribute.get('name'))
        if not label:
            continue
        serialized.append({'label': label, 'is_negative': bool(attribute.get('is_negative'))})
    return serialized


def _serialize_waypoints(geocache: Geocache) -> list[dict]:
    waypoints = []
    for waypoint in geocache.waypoints or []:
        note = _clean_whitespace(waypoint.note_override or waypoint.note)
        note_excerpt, _ = _truncate_on_word(note, 200)
        waypoints.append({
            'prefix': waypoint.prefix,
            'name': _clean_whitespace(waypoint.name),
            'type': waypoint.type,
            'note_excerpt': note_excerpt or None,
        })
    return waypoints


# ─────────────────────────────────────────────────────────────────────────────
# Sélection des logs
# ─────────────────────────────────────────────────────────────────────────────

def _log_date_key(log: GeocacheLog) -> datetime:
    date = log.date
    if date is None:
        return datetime.min.replace(tzinfo=timezone.utc)
    return date if date.tzinfo else date.replace(tzinfo=timezone.utc)


def _serialize_recent_logs(logs: list[GeocacheLog], count: int) -> list[dict]:
    if count <= 0:
        return []
    return [
        {
            'type': log.log_type,
            'date': log.date.isoformat() if log.date else None,
            'author': log.author,
            'text_excerpt': _excerpt_around(log.text or '', []),
        }
        for log in logs[:count]
    ]


def _serialize_gear_logs(logs: list[GeocacheLog], count: int) -> list[dict]:
    """
    Logs mentionnant du matériel, sur **tout** l'historique local.

    Classement par nombre de mentions décroissant puis par date : un log qui cite trois
    outils vaut mieux qu'un log récent qui en cite un seul.
    """
    if count <= 0:
        return []

    matched_logs = []
    for log in logs:
        matches = find_gear_mentions(log.text)
        if matches:
            matched_logs.append((log, matches))

    matched_logs.sort(key=lambda item: (len(item[1]), _log_date_key(item[0])), reverse=True)

    return [
        {
            'date': log.date.isoformat() if log.date else None,
            'author': log.author,
            'matched': matches,
            'text_excerpt': _excerpt_around(log.text or '', matches),
        }
        for log, matches in matched_logs[:count]
    ]


def _serialize_search_effort_logs(logs: list[GeocacheLog]) -> list[dict]:
    """Logs suggérant que la recherche sur place a été longue."""
    selected = []
    for log in logs:
        matches = find_search_effort_mentions(log.text)
        if matches:
            selected.append({
                'date': log.date.isoformat() if log.date else None,
                'author': log.author,
                'text_excerpt': _excerpt_around(log.text or '', []),
            })
        if len(selected) >= MAX_SEARCH_EFFORT_LOGS:
            break
    return selected


# ─────────────────────────────────────────────────────────────────────────────
# Bundle
# ─────────────────────────────────────────────────────────────────────────────

def _build_geocache_entry(
    geocache: Geocache,
    logs: list[GeocacheLog],
    *,
    listing_chars: int,
    recent_logs_count: int,
    gear_logs_count: int,
    now: datetime,
) -> dict:
    listing_excerpt, listing_truncated = _resolve_listing(geocache, listing_chars)
    gear_signals = build_gear_signals(
        geocache.attributes if isinstance(geocache.attributes, list) else []
    )
    health = compute_health(
        logs,
        listing_status=geocache.status,
        placed_at=geocache.placed_at,
        now=now,
    )

    return {
        'id': geocache.id,
        'gc_code': geocache.gc_code,
        'name': geocache.name,
        'type': geocache.type,
        'size': geocache.size,
        'owner': geocache.owner,
        'difficulty': geocache.difficulty,
        'terrain': geocache.terrain,
        'status': geocache.status,
        'coordinates': _resolve_coordinates(geocache),
        'is_corrected': bool(geocache.is_corrected),
        'solved': geocache.solved,
        'unsolved_mystery': _is_unsolved_mystery(geocache),
        'favorites_count': geocache.favorites_count,
        'logs_count': geocache.logs_count,
        'placed_at': geocache.placed_at.isoformat() if geocache.placed_at else None,
        'hint': _resolve_hint(geocache),
        'listing_excerpt': listing_excerpt,
        'listing_truncated': listing_truncated,
        'attributes': _serialize_attributes(geocache),
        'gear_signals': gear_signals,
        'waypoints': _serialize_waypoints(geocache),
        'waypoints_count': len(geocache.waypoints or []),
        'health': health,
        'recent_logs': _serialize_recent_logs(logs, recent_logs_count),
        'gear_logs': _serialize_gear_logs(logs, gear_logs_count),
        'search_effort_logs': _serialize_search_effort_logs(logs),
    }


def _build_stats(entries: list[dict]) -> dict:
    by_type: dict[str, int] = {}
    by_health: dict[str, int] = {}
    for entry in entries:
        cache_type = entry.get('type') or 'inconnu'
        by_type[cache_type] = by_type.get(cache_type, 0) + 1
        level = entry.get('health', {}).get('level', 'unknown')
        by_health[level] = by_health.get(level, 0) + 1

    return {
        'by_type': by_type,
        'by_health_level': by_health,
        'unsolved_mysteries': sum(1 for entry in entries if entry.get('unsolved_mystery')),
        'unresolved_gear_signals': sum(
            count_unresolved(entry.get('gear_signals')) for entry in entries
        ),
    }


def build_analysis_bundle(
    geocache_ids: list[int],
    *,
    listing_chars: int = 1800,
    recent_logs_count: int = 5,
    gear_logs_count: int = 8,
    now: datetime | None = None,
) -> dict:
    """
    Bundle complet pour l'analyse IA d'une sortie.

    Les géocaches sont renvoyées dans l'ordre demandé. Un identifiant introuvable ne fait
    pas échouer la construction : il ressort dans `missing`.
    """
    now = now or datetime.now(timezone.utc)
    requested = list(dict.fromkeys(geocache_ids or []))

    if not requested:
        return {
            'generated_at': now.isoformat(),
            'requested_count': 0,
            'geocaches': [],
            'missing': [],
            'without_local_logs': [],
            'stats': _build_stats([]),
        }

    # Deux requêtes seulement : les caches (waypoints préchargés) puis tous leurs logs.
    # Passer par la relation `geocache.logs` déclencherait un lazy-load par cache.
    found = {
        geocache.id: geocache
        for geocache in Geocache.query
        .options(selectinload(Geocache.waypoints))
        .filter(Geocache.id.in_(requested))
        .all()
    }

    logs_by_geocache: dict[int, list[GeocacheLog]] = {}
    if found:
        all_logs = (
            GeocacheLog.query
            .filter(GeocacheLog.geocache_id.in_(list(found.keys())))
            .order_by(GeocacheLog.date.desc())
            .all()
        )
        for log in all_logs:
            logs_by_geocache.setdefault(log.geocache_id, []).append(log)

    entries = [
        _build_geocache_entry(
            found[geocache_id],
            logs_by_geocache.get(geocache_id, []),
            listing_chars=listing_chars,
            recent_logs_count=recent_logs_count,
            gear_logs_count=gear_logs_count,
            now=now,
        )
        for geocache_id in requested
        if geocache_id in found
    ]

    missing = [geocache_id for geocache_id in requested if geocache_id not in found]
    without_local_logs = [
        entry['gc_code'] for entry in entries if not entry['health']['logs_available']
    ]

    if missing:
        logger.warning(
            "Bundle d'analyse : %s géocache(s) introuvable(s) sur %s",
            len(missing), len(requested),
        )

    return {
        'generated_at': now.isoformat(),
        'requested_count': len(requested),
        'geocaches': entries,
        'missing': missing,
        'without_local_logs': without_local_logs,
        'stats': _build_stats(entries),
    }
