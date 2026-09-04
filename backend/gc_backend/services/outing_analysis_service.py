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

Le lexique matériel ne sert pas qu'à trier les logs : il balaie aussi le **listing
complet** et le **hint**. Ce balayage est fait une fois côté Python et transmis sous forme
de clés (`gear_mentions_in_listing`, `gear_mentions_in_hint`), donc pour un coût nul en
tokens de listing. C'est ce qui rend le mode léger honnête : le listing n'y est pas
transmis, mais on sait quand même qu'il parle d'une canne à pêche — et un drapeau « outil
spécial requis » peut être refermé avant même d'atteindre l'IA.

Un dernier bloc n'est attaché à aucune cache en particulier : la **géographie** de la
sortie (étendue, ordre de visite, groupes de marche, heure du coucher du soleil à la date
retenue). Les coordonnées étaient en base depuis toujours ; faute de les exploiter, le
prompt système devait interdire au modèle de parler de distances. Voir
`outing_geography.py`.

Du même esprit, et pour la même raison : chaque cache porte une **estimation de temps**
calculée par heuristique (`time_estimate`), et la sortie un **budget** (`time_budget`).
Une durée produite au fil du texte par un modèle est incohérente d'une cache à l'autre ;
une durée calculée l'est par construction, et l'IA n'a plus qu'à la corriger en disant
pourquoi. Voir `outing_time_estimate.py`.

S'y ajoutent trois sources qui ne viennent pas de geocaching.com mais du travail déjà
fait par l'utilisateur, et qui valent souvent mieux que le listing : la **note
personnelle** (« parking rue X », « prévoir deux personnes »), les **notes GeoApp**
(solutions partielles, repérages) et les **questions d'EarthCache**, qui sont la
checklist terrain de ce type de cache.
"""

from __future__ import annotations

import logging
import re
from datetime import date, datetime, timezone

from sqlalchemy.orm import selectinload

from ..geocaches.models import Geocache, GeocacheLog
from .outing_geography import build_geography
from .outing_gear_signals import (
    build_gear_signals,
    build_waypoint_signals,
    count_resolved_from_text,
    count_unresolved,
    resolve_signals_from_text,
)
from .outing_health import compute_health
from .outing_lexicons import find_gear_mentions, find_search_effort_mentions, normalize
from .outing_time_estimate import build_time_budget, estimate_geocache_time

logger = logging.getLogger(__name__)

#: Longueur d'un extrait de log, centré sur la première mention repérée.
LOG_EXCERPT_CHARS = 300

#: Plafond des logs « effort de recherche » : trois suffisent à donner le ton.
MAX_SEARCH_EFFORT_LOGS = 3

#: Note personnelle geocaching.com : plus généreux qu'un extrait de log, parce que c'est
#: du texte écrit pour soi, dense et sans remplissage.
PERSONAL_NOTE_CHARS = 700

#: Notes GeoApp : plafond par note et nombre de notes retenues, les plus récentes d'abord.
NOTE_EXCERPT_CHARS = 400
MAX_NOTES = 5

#: Questions d'EarthCache : question et consigne d'observation, tronquées.
LOGGING_TASK_QUESTION_CHARS = 300
LOGGING_TASK_GUIDANCE_CHARS = 200
MAX_LOGGING_TASKS = 12

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


def _listing_plain_text(geocache: Geocache) -> str:
    """
    Listing complet en texte brut, sans troncature.

    Toujours calculé, y compris en mode léger où rien n'en sera transmis : c'est le
    support du balayage lexical, qui doit voir *tout* le listing. La mention d'une canne à
    pêche se trouve souvent après l'histoire du lieu, donc au-delà de l'extrait.

    La version corrigée par l'utilisateur prime, et le texte brut prime sur le HTML —
    même ordre que l'affichage.
    """
    for candidate in (
        geocache.description_override_raw,
        geocache.description_raw,
    ):
        cleaned = _clean_whitespace(candidate)
        if cleaned:
            return cleaned

    for candidate in (
        geocache.description_override_html,
        geocache.description_html,
    ):
        cleaned = _strip_html(candidate)
        if cleaned:
            return cleaned

    return ''


def _resolve_listing(listing_text: str, listing_chars: int) -> tuple[str, bool]:
    """
    Extrait de listing transmis à l'IA, tronqué sur une frontière de mot.

    `listing_chars = 0` signifie « pas de listing du tout » : c'est le mode léger, qui
    s'appuie sur les attributs, le hint, les logs et les mentions déjà repérées. Autant ne
    rien transférer.
    """
    if listing_chars <= 0 or not listing_text:
        return '', False
    return _truncate_on_word(listing_text, listing_chars)


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


def _waypoint_coordinates(waypoint) -> str | None:
    """
    Coordonnées d'un waypoint, format joueur de préférence.

    Sans coordonnées, un waypoint « Parking » ne sert à rien : c'est le point qu'on va
    chercher avant de partir, pas son intitulé. Geocaching.com affiche « ??? » pour un
    waypoint dont les coordonnées ne sont pas publiées (final d'une multi, étape
    virtuelle) et c'est ce texte qui est stocké : c'est une absence, pas une valeur.
    """
    cleaned = _clean_whitespace(waypoint.gc_coords)
    if cleaned and set(cleaned) <= set('?'):
        cleaned = ''
    if cleaned:
        return cleaned
    if waypoint.latitude is not None and waypoint.longitude is not None:
        return f'{waypoint.latitude}, {waypoint.longitude}'
    return None


def _waypoint_type(waypoint) -> str | None:
    """
    Type de waypoint, débarrassé des scories du scraping.

    Le libellé arrive parfois avec un retour à la ligne et une parenthèse fermante
    orpheline (« Parking Area)\n    ») : le prompt est un format ligne à ligne, et
    « Parking Area » se lit mieux que « Parking Area) ».
    """
    cleaned = _clean_whitespace(waypoint.type)
    if cleaned.endswith(')') and '(' not in cleaned:
        cleaned = cleaned[:-1].strip()
    return cleaned or None


def _serialize_waypoints(geocache: Geocache) -> list[dict]:
    waypoints = []
    for waypoint in geocache.waypoints or []:
        note = _clean_whitespace(waypoint.note_override or waypoint.note)
        note_excerpt, _ = _truncate_on_word(note, 200)
        waypoints.append({
            'prefix': waypoint.prefix,
            'name': _clean_whitespace(waypoint.name),
            'type': _waypoint_type(waypoint),
            'coordinates': _waypoint_coordinates(waypoint),
            'note_excerpt': note_excerpt or None,
        })
    return waypoints


def _serialize_personal_note(geocache: Geocache) -> tuple[str | None, bool]:
    """
    Note personnelle geocaching.com, en texte brut.

    C'est là que l'utilisateur a écrit « parking rue des Lilas », « prévoir deux
    personnes » ou une solution partielle. Aucune autre source ne porte cette
    information : elle prime sur le listing pour préparer la sortie.
    """
    cleaned = _strip_html(geocache.gc_personal_note)
    if not cleaned:
        return None, False
    excerpt, truncated = _truncate_on_word(cleaned, PERSONAL_NOTE_CHARS)
    return excerpt, truncated


def _note_sort_key(note) -> datetime:
    """Les notes les plus fraîches d'abord ; une note sans date passe en dernier."""
    for attribute in ('updated_at', 'created_at'):
        value = getattr(note, attribute, None)
        if value is not None:
            return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    return datetime.min.replace(tzinfo=timezone.utc)


def _serialize_notes(geocache: Geocache) -> tuple[list[dict], int]:
    """Notes GeoApp attachées à la géocache. Renvoie (extraits retenus, total)."""
    notes = list(geocache.notes or [])
    if not notes:
        return [], 0

    notes.sort(key=_note_sort_key, reverse=True)

    serialized = []
    for note in notes[:MAX_NOTES]:
        content = _strip_html(note.content)
        if not content:
            continue
        excerpt, _ = _truncate_on_word(content, NOTE_EXCERPT_CHARS)
        serialized.append({
            'note_type': note.note_type,
            'source': note.source,
            'source_plugin': note.source_plugin,
            'updated_at': _note_sort_key(note).isoformat(),
            'content_excerpt': excerpt,
        })
    return serialized, len(notes)


def _serialize_logging_tasks(geocache: Geocache) -> list[dict]:
    """
    Questions à répondre sur place (EarthCache).

    C'est la checklist terrain de ce type de cache : oublier une observation oblige à y
    retourner. `requires_photo` vaut « prendre l'appareil », et le statut dit ce qui
    reste à faire — une question déjà répondue n'a pas à occuper la sortie.
    """
    tasks = []
    for task in (geocache.logging_tasks or [])[:MAX_LOGGING_TASKS]:
        question, _ = _truncate_on_word(
            _clean_whitespace(task.question), LOGGING_TASK_QUESTION_CHARS
        )
        if not question:
            continue
        guidance, _ = _truncate_on_word(
            _clean_whitespace(task.guidance), LOGGING_TASK_GUIDANCE_CHARS
        )
        tasks.append({
            'position': task.position,
            'question': question,
            'guidance': guidance or None,
            'status': task.status,
            'requires_photo': bool(task.requires_photo),
            'answered': bool(_clean_whitespace(task.answer)),
        })
    return tasks


# ─────────────────────────────────────────────────────────────────────────────
# Sélection des logs
# ─────────────────────────────────────────────────────────────────────────────

def _log_meta(log: GeocacheLog) -> dict:
    """
    Ce qui qualifie la **source** d'un log plutôt que son contenu.

    Un log d'ami est une source plus fiable qu'un log anonyme : on sait qui écrit, et le
    conseil matériel qu'il donne se lit autrement. Un log marqué favori signale, lui, une
    cache dont l'expérience vaut le détour — utile à la priorisation.
    """
    return {
        'is_friend_log': bool(getattr(log, 'is_friend_log', False)),
        'is_favorite': bool(getattr(log, 'is_favorite', False)),
    }


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
            **_log_meta(log),
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
            **_log_meta(log),
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
                **_log_meta(log),
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
    listing_text = _listing_plain_text(geocache)
    listing_excerpt, listing_truncated = _resolve_listing(listing_text, listing_chars)
    hint = _resolve_hint(geocache)

    # Le balayage porte sur le listing entier et sur le hint, pas sur ce qui sera transmis :
    # c'est justement quand le listing n'est pas transmis qu'il vaut le plus cher.
    gear_mentions_in_listing = find_gear_mentions(listing_text)
    gear_mentions_in_hint = find_gear_mentions(hint)

    gear_signals = build_gear_signals(
        geocache.attributes if isinstance(geocache.attributes, list) else []
    )
    gear_signals += build_waypoint_signals(geocache.waypoints, gear_signals)
    gear_signals = resolve_signals_from_text(gear_signals, [
        ('listing', gear_mentions_in_listing),
        ('hint', gear_mentions_in_hint),
    ])
    personal_note, personal_note_truncated = _serialize_personal_note(geocache)
    notes, notes_count = _serialize_notes(geocache)
    logging_tasks = _serialize_logging_tasks(geocache)
    health = compute_health(
        logs,
        listing_status=geocache.status,
        placed_at=geocache.placed_at,
        now=now,
    )

    entry = {
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
        # Coordonnées décimales, doublon assumé du champ affichable : c'est sur elles que
        # travaille le bloc géographique, et les reprendre ici évite de refaire un
        # aller-retour vers la base pour calculer une distance.
        'latitude': geocache.latitude,
        'longitude': geocache.longitude,
        'is_corrected': bool(geocache.is_corrected),
        'solved': geocache.solved,
        'unsolved_mystery': _is_unsolved_mystery(geocache),
        'favorites_count': geocache.favorites_count,
        'logs_count': geocache.logs_count,
        'placed_at': geocache.placed_at.isoformat() if geocache.placed_at else None,
        # Une cache déjà trouvée dans une sélection de sortie est presque toujours une
        # erreur de saisie : on la remonte telle quelle plutôt que de l'écarter, parce
        # qu'elle peut aussi être volontaire (accompagner quelqu'un, refaire une multi).
        'found': bool(geocache.found),
        'found_date': geocache.found_date.isoformat() if geocache.found_date else None,
        'hint': hint,
        'personal_note': personal_note,
        'personal_note_truncated': personal_note_truncated,
        'notes': notes,
        'notes_count': notes_count,
        'listing_excerpt': listing_excerpt,
        'listing_truncated': listing_truncated,
        # Repérées sur le texte complet : elles survivent à la troncature comme à la
        # suppression pure et simple du listing.
        'gear_mentions_in_listing': gear_mentions_in_listing,
        'gear_mentions_in_hint': gear_mentions_in_hint,
        'attributes': _serialize_attributes(geocache),
        'gear_signals': gear_signals,
        'waypoints': _serialize_waypoints(geocache),
        'waypoints_count': len(geocache.waypoints or []),
        'logging_tasks': logging_tasks,
        'logging_tasks_count': len(geocache.logging_tasks or []),
        'logging_tasks_photo_required': any(task['requires_photo'] for task in logging_tasks),
        'health': health,
        'recent_logs': _serialize_recent_logs(logs, recent_logs_count),
        'gear_logs': _serialize_gear_logs(logs, gear_logs_count),
        'search_effort_logs': _serialize_search_effort_logs(logs),
    }

    # Calculée en dernier, et sur l'entrée elle-même : l'estimation lit le type, les D/T,
    # les signaux, les waypoints, les logs de recherche longue et les questions
    # d'EarthCache — tout ce que les lignes ci-dessus viennent d'assembler. Ne rien lui
    # passer d'autre garantit qu'elle ne chiffre que ce que l'IA lira.
    entry['time_estimate'] = estimate_geocache_time(entry)
    return entry


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
        'presolved_gear_signals': sum(
            count_resolved_from_text(entry.get('gear_signals')) for entry in entries
        ),
        'already_found': sum(1 for entry in entries if entry.get('found')),
        'stale_logs': sum(1 for entry in entries if entry.get('health', {}).get('logs_stale')),
        'logging_tasks': sum(entry.get('logging_tasks_count') or 0 for entry in entries),
        # Temps sur place uniquement : le trajet vit dans `time_budget`, qui est le seul à
        # connaître l'ordre de visite. Reprendre ici le total complet ferait deux chiffres
        # concurrents pour la même question.
        'on_site_minutes': sum(
            (entry.get('time_estimate') or {}).get('minutes') or 0 for entry in entries
        ),
    }


def build_analysis_bundle(
    geocache_ids: list[int],
    *,
    listing_chars: int = 1800,
    recent_logs_count: int = 5,
    gear_logs_count: int = 8,
    outing_date: date | None = None,
    now: datetime | None = None,
) -> dict:
    """
    Bundle complet pour l'analyse IA d'une sortie.

    Les géocaches sont renvoyées dans l'ordre demandé. Un identifiant introuvable ne fait
    pas échouer la construction : il ressort dans `missing`.

    `outing_date` est la date de la sortie, qui n'est pas forcément celle de la
    préparation : elle ne sert qu'au calcul solaire, mais elle en change complètement le
    résultat — deux mois d'écart valent deux heures de jour.
    """
    now = now or datetime.now(timezone.utc)
    # La date du jour au sens de l'utilisateur, pas au sens d'UTC : à 23 h en France, la
    # sortie « d'aujourd'hui » n'est pas celle de demain.
    outing_date = outing_date or now.astimezone().date()
    requested = list(dict.fromkeys(geocache_ids or []))

    if not requested:
        return {
            'generated_at': now.isoformat(),
            'outing_date': outing_date.isoformat(),
            'requested_count': 0,
            'geocaches': [],
            'missing': [],
            'without_local_logs': [],
            'stale_logs': [],
            'already_found': [],
            'geography': build_geography([], outing_date=outing_date),
            'time_budget': build_time_budget([], None),
            'stats': _build_stats([]),
        }

    # Les caches et leurs collections en un aller-retour, puis tous leurs logs. Chaque
    # `selectinload` coûte une requête supplémentaire, mais bornée par le lot : passer par
    # les relations telles quelles déclencherait un lazy-load *par cache et par relation*.
    found = {
        geocache.id: geocache
        for geocache in Geocache.query
        .options(
            selectinload(Geocache.waypoints),
            selectinload(Geocache.notes),
            selectinload(Geocache.logging_tasks),
        )
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
    # Deux listes de tête de plus, sur le même principe : ce que le lecteur doit savoir
    # avant de lire les fiches. Les logs périmés relativisent une santé rassurante, une
    # cache déjà trouvée n'a probablement rien à faire dans la sélection.
    stale_logs = [entry['gc_code'] for entry in entries if entry['health']['logs_stale']]
    already_found = [entry['gc_code'] for entry in entries if entry['found']]

    if missing:
        logger.warning(
            "Bundle d'analyse : %s géocache(s) introuvable(s) sur %s",
            len(missing), len(requested),
        )

    # Le budget temps s'appuie sur la géographie : c'est elle qui porte l'ordre de visite,
    # donc les étapes dont on peut déduire un temps de trajet. D'où le calcul en deux
    # temps plutôt qu'un appel imbriqué dans le dictionnaire de retour.
    geography = build_geography(entries, outing_date=outing_date)

    return {
        'generated_at': now.isoformat(),
        'outing_date': outing_date.isoformat(),
        'requested_count': len(requested),
        'geocaches': entries,
        'missing': missing,
        'without_local_logs': without_local_logs,
        'stale_logs': stale_logs,
        'already_found': already_found,
        'geography': geography,
        'time_budget': build_time_budget(entries, geography),
        'stats': _build_stats(entries),
    }
