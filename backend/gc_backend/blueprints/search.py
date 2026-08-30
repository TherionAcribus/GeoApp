"""
Blueprint pour la recherche globale dans la base de données GeoApp.
Permet de chercher dans les géocaches (nom, description, hints, notes personnelles),
les logs et les notes utilisateur.
"""

from flask import Blueprint, jsonify, request, current_app
import logging
import re
import time
import os
import json

from ..database import db
from ..geocaches.models import Geocache, GeocacheLog, Note, GeocacheNote
from ..plugins.models import Plugin
from ..search_index import (
    KIND_GEOCACHE,
    KIND_LOG,
    KIND_NOTE,
    KIND_PLUGIN,
    build_fts_match,
    fts_candidate_ids,
    strip_html as _strip_html,
)

bp = Blueprint('search', __name__)
logger = logging.getLogger(__name__)

CONTEXT_CHARS = 80  # Nombre de caractères de contexte autour du match

# Marge de candidats récupérés depuis l'index FTS avant raffinage/tri Python.
FTS_CANDIDATE_FACTOR = 5
FTS_CANDIDATE_CAP = 500

# --- Garde-fous ReDoS (le module `re` ne peut pas être interrompu en cours
# d'exécution ; on borne donc de façon préventive). Contexte : app locale
# mono-utilisateur, le mode regex/wildcard fait un scan complet. ---
# Longueur max de la query (au-delà -> 400).
MAX_QUERY_LENGTH = 2000
# Taille max de texte soumise au moteur regex par champ (borne le coût unitaire).
MAX_REGEX_FIELD_CHARS = 200_000
# Budget temps global d'un scan regex/wildcard ; au-delà, arrêt propre (partial).
SEARCH_TIME_BUDGET_S = 5.0


# Groupes de lettres accent-insensibles (variantes minuscules ; le flag
# re.IGNORECASE couvre les majuscules). Aligne le backend sur le tokenizer FTS
# (remove_diacritics) et sur la normalisation du front, y compris pour l'étape
# de raffinage Python qui suit la sélection des candidats FTS.
_ACCENT_GROUPS = ('aàâäáãå', 'cç', 'eéèêë', 'iïîíì', 'nñ', 'oôöóòõ', 'uùûüú', 'yÿý')
_ACCENT_CLASS: dict[str, str] = {}
for _grp in _ACCENT_GROUPS:
    _cls = '[' + _grp + ']'
    for _ch in _grp:
        _ACCENT_CLASS[_ch] = _cls


def _accent_insensitive_pattern(query: str, use_wildcard: bool) -> str:
    """Construit un pattern où chaque lettre accentuable matche ses variantes.

    Les métacaractères wildcard (* et ?) sont préservés ; tout le reste est
    échappé. Opère sur le texte original (pas de normalisation), donc les
    snippets conservent leurs accents.
    """
    parts = []
    for ch in query:
        if use_wildcard and ch == '*':
            parts.append('.*')
        elif use_wildcard and ch == '?':
            parts.append('.')
        else:
            cls = _ACCENT_CLASS.get(ch.lower())
            parts.append(cls if cls else re.escape(ch))
    return ''.join(parts)


def _build_regex(query: str, case_sensitive: bool = False, use_regex: bool = False, use_wildcard: bool = False):
    """Construit un pattern regex à partir de la query utilisateur."""
    flags = 0 if case_sensitive else re.IGNORECASE

    if use_regex:
        try:
            return re.compile(query, flags)
        except re.error:
            return None

    # Texte simple et wildcard, hors sensibilité à la casse : accent-insensible
    # (cohérent avec les candidats FTS). En mode sensible à la casse, on reste
    # accent-sensible (comme le front).
    if not case_sensitive:
        return re.compile(_accent_insensitive_pattern(query, use_wildcard), flags)

    if use_wildcard:
        escaped = re.escape(query)
        pattern = escaped.replace(r'\*', '.*').replace(r'\?', '.')
        return re.compile(pattern, flags)

    return re.compile(re.escape(query), flags)


def _extract_snippets(text: str, pattern, max_snippets: int = 3) -> list[dict]:
    """Extrait des snippets de contexte autour des matches."""
    if not text or not pattern:
        return []

    text = text[:MAX_REGEX_FIELD_CHARS]
    snippets = []
    for match in pattern.finditer(text):
        if len(snippets) >= max_snippets:
            break
        start = max(0, match.start() - CONTEXT_CHARS)
        end = min(len(text), match.end() + CONTEXT_CHARS)

        prefix = ('…' if start > 0 else '') + text[start:match.start()]
        matched = match.group()
        suffix = text[match.end():end] + ('…' if end < len(text) else '')

        snippets.append({
            'prefix': prefix,
            'match': matched,
            'suffix': suffix,
            'offset': match.start()
        })

    return snippets


def _count_matches(text: str, pattern) -> int:
    """Compte le nombre total de matches dans un texte."""
    if not text or not pattern:
        return 0
    return len(pattern.findall(text[:MAX_REGEX_FIELD_CHARS]))


# Cache mémoire des métadonnées d'alphabets (données de référence quasi-statiques).
# Évite de relire et parser tous les alphabet.json à chaque requête. Invalidé
# quand le mtime du répertoire change (ajout / suppression d'un alphabet).
_ALPHABETS_CACHE: dict = {'dir': None, 'mtime': None, 'items': []}


def _load_alphabets(alphabets_dir: str) -> list[dict]:
    """
    Retourne les métadonnées des alphabets [{id, name, description, aliases}].

    Lit le disque une seule fois par état du répertoire (cache invalidé sur le
    mtime du dossier). Le matching lui-même reste effectué par requête sur ces
    données en mémoire.
    """
    try:
        mtime = os.path.getmtime(alphabets_dir)
    except OSError:
        return []

    cache = _ALPHABETS_CACHE
    if cache['dir'] == alphabets_dir and cache['mtime'] == mtime:
        return cache['items']

    items: list[dict] = []
    for alphabet_name in os.listdir(alphabets_dir):
        alphabet_path = os.path.join(alphabets_dir, alphabet_name)
        if not os.path.isdir(alphabet_path):
            continue
        alphabet_json_path = os.path.join(alphabet_path, 'alphabet.json')
        if not os.path.exists(alphabet_json_path):
            continue
        try:
            with open(alphabet_json_path, 'r', encoding='utf-8') as f:
                metadata = json.load(f)
        except (json.JSONDecodeError, IOError) as e:
            logger.warning(f"Error reading alphabet {alphabet_name}: {e}")
            continue
        items.append({
            'id': alphabet_name,
            'name': metadata.get('name', alphabet_name),
            'description': metadata.get('description', ''),
            'aliases': metadata.get('aliases', []),
        })

    cache['dir'] = alphabets_dir
    cache['mtime'] = mtime
    cache['items'] = items
    return items


@bp.get('/api/search')
def global_search():
    """
    Recherche globale dans la base de données.

    Query params:
        q (str): Terme de recherche (obligatoire)
        case_sensitive (bool): Sensible à la casse (défaut: false)
        use_regex (bool): Mode regex (défaut: false)
        use_wildcard (bool): Mode wildcard (défaut: false)
        scope (str): Périmètre - 'all', 'geocaches', 'logs', 'notes', 'plugins', 'alphabets' (défaut: 'all')
        zone_id (int): Filtrer par zone (optionnel)
        limit (int): Nombre max de résultats par catégorie (défaut: 50)
    """
    query = request.args.get('q', '').strip()
    if not query:
        return jsonify({'error': 'Missing query parameter "q"'}), 400

    # Garde-fou ReDoS : rejeter les patterns démesurés avant compilation/scan.
    if len(query) > MAX_QUERY_LENGTH:
        return jsonify({'error': f'Query too long (max {MAX_QUERY_LENGTH} characters)'}), 400

    case_sensitive = request.args.get('case_sensitive', 'false').lower() == 'true'
    use_regex = request.args.get('use_regex', 'false').lower() == 'true'
    use_wildcard = request.args.get('use_wildcard', 'false').lower() == 'true'
    scope = request.args.get('scope', 'all')
    zone_id = request.args.get('zone_id', type=int)
    limit = request.args.get('limit', 50, type=int)
    limit = min(limit, 200)

    pattern = _build_regex(query, case_sensitive, use_regex, use_wildcard)
    if pattern is None:
        return jsonify({'error': 'Invalid regex pattern'}), 400

    # Mode hybride : l'index FTS5 ne gère que la recherche texte simple,
    # insensible à la casse et non filtrée par zone. Les autres modes (regex,
    # wildcard, sensible à la casse, zone_id) conservent le scan Python complet.
    use_fts = not (use_regex or use_wildcard or case_sensitive) and zone_id is None
    fts_match = build_fts_match(query) if use_fts else None
    fts_limit = min(limit * FTS_CANDIDATE_FACTOR, FTS_CANDIDATE_CAP)

    def _fts_filter(orm_query, model, kind):
        """Restreint une requête ORM aux candidats FTS, ou None si aucun candidat."""
        ids = fts_candidate_ids(db.session, kind, fts_match, fts_limit)
        if not ids:
            return None
        return orm_query.filter(model.id.in_(ids))

    # Budget temps : borne les scans regex/wildcard sur toute la base. Le module
    # `re` n'étant pas interruptible, on vérifie l'échéance entre les lignes ;
    # au dépassement, on arrête et on signale un résultat partiel.
    deadline = time.monotonic() + SEARCH_TIME_BUDGET_S

    def _budget_exceeded() -> bool:
        return time.monotonic() > deadline

    results = {
        'query': query,
        'options': {
            'case_sensitive': case_sensitive,
            'use_regex': use_regex,
            'use_wildcard': use_wildcard,
            'scope': scope
        },
        'geocaches': [],
        'logs': [],
        'notes': [],
        'plugins': [],
        'alphabets': [],
        # Totaux réels par catégorie AVANT troncature `limit` (permet au front
        # d'afficher « 50+ » quand les résultats sont tronqués).
        'counts': {'geocaches': 0, 'logs': 0, 'notes': 0, 'plugins': 0, 'alphabets': 0},
        'total_count': 0,
        'partial': False
    }

    try:
        # --- Recherche dans les géocaches ---
        if scope in ('all', 'database', 'geocaches'):
            gc_query = Geocache.query
            if zone_id is not None:
                gc_query = gc_query.filter(Geocache.zone_id == zone_id)

            if use_fts:
                filtered = _fts_filter(gc_query, Geocache, KIND_GEOCACHE)
                geocaches = filtered.all() if filtered is not None else []
            else:
                geocaches = gc_query.all()
            gc_results = []

            for gc in geocaches:
                if _budget_exceeded():
                    results['partial'] = True
                    break
                matches_in = {}

                # Chercher dans les champs texte
                fields = {
                    'name': gc.name,
                    'gc_code': gc.gc_code,
                    'owner': gc.owner,
                    'description': _strip_html(gc.description_html or gc.description_raw),
                    'description_override': _strip_html(gc.description_override_html or gc.description_override_raw),
                    'hints': gc.hints_decoded or gc.hints,
                    'hints_override': gc.hints_decoded_override,
                    'personal_note': gc.gc_personal_note,
                    'coordinates': gc.coordinates_raw,
                    'original_coordinates': gc.original_coordinates_raw,
                }

                total_gc_matches = 0
                for field_name, field_value in fields.items():
                    if not field_value:
                        continue
                    count = _count_matches(str(field_value), pattern)
                    if count > 0:
                        snippets = _extract_snippets(str(field_value), pattern)
                        matches_in[field_name] = {
                            'count': count,
                            'snippets': snippets
                        }
                        total_gc_matches += count

                if total_gc_matches > 0:
                    gc_results.append({
                        'id': gc.id,
                        'gc_code': gc.gc_code,
                        'name': gc.name,
                        'type': gc.type,
                        'zone_id': gc.zone_id,
                        'total_matches': total_gc_matches,
                        'matches_in': matches_in
                    })

            # Trier par nombre de matches décroissant
            gc_results.sort(key=lambda x: x['total_matches'], reverse=True)
            results['counts']['geocaches'] = len(gc_results)
            results['geocaches'] = gc_results[:limit]

        # --- Recherche dans les logs ---
        if scope in ('all', 'database', 'logs'):
            log_query = GeocacheLog.query.join(Geocache)
            if zone_id is not None:
                log_query = log_query.filter(Geocache.zone_id == zone_id)

            if use_fts:
                filtered = _fts_filter(log_query, GeocacheLog, KIND_LOG)
                logs = filtered.all() if filtered is not None else []
            else:
                logs = log_query.all()
            log_results = []

            for log in logs:
                if _budget_exceeded():
                    results['partial'] = True
                    break
                text = log.text or ''
                author = log.author or ''
                combined = f"{author} {text}"
                count = _count_matches(combined, pattern)

                if count > 0:
                    # Snippets extraits du texte combiné (auteur + contenu) pour
                    # rester cohérent avec le comptage : un match uniquement dans
                    # l'auteur produit désormais un snippet au lieu d'une liste vide.
                    snippets = _extract_snippets(combined, pattern)
                    log_results.append({
                        'id': log.id,
                        'geocache_id': log.geocache_id,
                        'geocache_gc_code': log.geocache.gc_code if log.geocache else None,
                        'geocache_name': log.geocache.name if log.geocache else None,
                        'author': log.author,
                        'log_type': log.log_type,
                        'date': log.date.isoformat() if log.date else None,
                        'total_matches': count,
                        'snippets': snippets
                    })

            log_results.sort(key=lambda x: x['total_matches'], reverse=True)
            results['counts']['logs'] = len(log_results)
            results['logs'] = log_results[:limit]

        # --- Recherche dans les notes ---
        if scope in ('all', 'database', 'notes'):
            note_query = Note.query
            if use_fts:
                filtered = _fts_filter(note_query, Note, KIND_NOTE)
                notes = filtered.all() if filtered is not None else []
            else:
                notes = note_query.all()
            note_results = []

            for note in notes:
                if _budget_exceeded():
                    results['partial'] = True
                    break
                text = note.content or ''
                count = _count_matches(text, pattern)

                if count > 0:
                    snippets = _extract_snippets(text, pattern)
                    # Récupérer les géocaches liées
                    linked_geocaches = [
                        {'id': gc.id, 'gc_code': gc.gc_code, 'name': gc.name}
                        for gc in note.geocaches
                    ]
                    note_results.append({
                        'id': note.id,
                        'note_type': note.note_type,
                        'source': note.source,
                        'total_matches': count,
                        'snippets': snippets,
                        'linked_geocaches': linked_geocaches,
                        'updated_at': note.updated_at.isoformat() if note.updated_at else None,
                    })

            note_results.sort(key=lambda x: x['total_matches'], reverse=True)
            results['counts']['notes'] = len(note_results)
            results['notes'] = note_results[:limit]

        # --- Recherche dans les plugins ---
        if scope in ('all', 'database', 'plugins'):
            plugin_results = []
            if use_fts:
                filtered = _fts_filter(Plugin.query, Plugin, KIND_PLUGIN)
                plugins = filtered.all() if filtered is not None else []
            else:
                plugins = Plugin.query.all()

            for plugin in plugins:
                if _budget_exceeded():
                    results['partial'] = True
                    break
                count = 0
                matched_fields = {}

                # Chercher dans le nom
                name_count = _count_matches(plugin.name, pattern)
                if name_count > 0:
                    matched_fields['name'] = {
                        'count': name_count,
                        'snippets': _extract_snippets(plugin.name, pattern)
                    }
                    count += name_count

                # Chercher dans la description
                if plugin.description:
                    desc_count = _count_matches(plugin.description, pattern)
                    if desc_count > 0:
                        matched_fields['description'] = {
                            'count': desc_count,
                            'snippets': _extract_snippets(plugin.description, pattern)
                        }
                        count += desc_count

                # Chercher dans l'auteur
                if plugin.author:
                    author_count = _count_matches(plugin.author, pattern)
                    if author_count > 0:
                        matched_fields['author'] = {
                            'count': author_count,
                            'snippets': _extract_snippets(plugin.author, pattern)
                        }
                        count += author_count

                # Chercher dans les catégories
                if plugin.categories:
                    categories_text = ' '.join(plugin.categories)
                    cat_count = _count_matches(categories_text, pattern)
                    if cat_count > 0:
                        matched_fields['categories'] = {
                            'count': cat_count,
                            'snippets': _extract_snippets(categories_text, pattern)
                        }
                        count += cat_count

                if count > 0:
                    plugin_results.append({
                        'id': plugin.id,
                        'name': plugin.name,
                        'version': plugin.version,
                        'description': plugin.description,
                        'author': plugin.author,
                        'categories': plugin.categories or [],
                        'source': plugin.source,
                        'enabled': plugin.enabled,
                        'total_matches': count,
                        'matches_in': matched_fields
                    })

            plugin_results.sort(key=lambda x: x['total_matches'], reverse=True)
            results['counts']['plugins'] = len(plugin_results)
            results['plugins'] = plugin_results[:limit]

        # --- Recherche dans les alphabets ---
        if scope in ('all', 'alphabets'):
            alphabets_dir = current_app.config.get('ALPHABETS_DIR') or os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(__file__)))), 'alphabets')
            alphabet_results = []

            for meta in _load_alphabets(alphabets_dir):
                if _budget_exceeded():
                    results['partial'] = True
                    break

                count = 0
                matched_fields = {}

                # Chercher dans le nom
                name = meta['name']
                name_count = _count_matches(name, pattern)
                if name_count > 0:
                    matched_fields['name'] = {
                        'count': name_count,
                        'snippets': _extract_snippets(name, pattern)
                    }
                    count += name_count

                # Chercher dans la description
                description = meta['description']
                if description:
                    desc_count = _count_matches(description, pattern)
                    if desc_count > 0:
                        matched_fields['description'] = {
                            'count': desc_count,
                            'snippets': _extract_snippets(description, pattern)
                        }
                        count += desc_count

                # Chercher dans les alias
                aliases = meta['aliases']
                if aliases:
                    aliases_text = ' '.join(aliases)
                    alias_count = _count_matches(aliases_text, pattern)
                    if alias_count > 0:
                        matched_fields['aliases'] = {
                            'count': alias_count,
                            'snippets': _extract_snippets(aliases_text, pattern)
                        }
                        count += alias_count

                if count > 0:
                    alphabet_results.append({
                        'id': meta['id'],
                        'name': name,
                        'description': description,
                        'aliases': aliases,
                        'total_matches': count,
                        'matches_in': matched_fields
                    })

            alphabet_results.sort(key=lambda x: x['total_matches'], reverse=True)
            results['counts']['alphabets'] = len(alphabet_results)
            results['alphabets'] = alphabet_results[:limit]

        # Total réel (avant troncature), pas seulement les résultats renvoyés.
        results['total_count'] = sum(results['counts'].values())

        return jsonify(results)

    except Exception as e:
        logger.error(f"Global search error: {e}", exc_info=True)
        raise
