"""
Index de recherche plein-texte (SQLite FTS5) pour GeoApp.

Fournit un index FTS5 unique (`search_fts`) utilisé comme *filtre de candidats*
rapide par le blueprint de recherche, en remplacement des `Model.query.all()`
qui scannaient toute la base à chaque frappe.

Architecture (mode hybride) :
- Recherche texte simple, insensible à la casse, sans zone_id -> FTS5.
  FTS renvoie les ids candidats, puis le blueprint applique la logique Python
  existante (comptage + snippets + matches_in) sur ce petit ensemble.
- Recherche regex / wildcard / sensible à la casse / filtrée par zone -> scan
  Python complet inchangé (FTS ne sait pas faire ces modes).

L'index est tenu à jour automatiquement via des événements ORM SQLAlchemy
(after_insert / after_update / after_delete) sur Geocache, GeocacheLog, Note et
Plugin. Une fonction `rebuild_search_index()` reconstruit tout depuis zéro (bootstrap
initial et réparation).

Le tokenizer `unicode61 remove_diacritics 2` rend la recherche insensible aux
accents, ce qui aligne le comportement backend sur celui du front (onglets ouverts).
"""

from __future__ import annotations

import logging
import re
from html import unescape

from sqlalchemy import event, text

logger = logging.getLogger(__name__)

FTS_TABLE = 'search_fts'

# Types d'entités indexées. Sert de discriminant dans la colonne `kind`.
KIND_GEOCACHE = 'geocache'
KIND_LOG = 'log'
KIND_NOTE = 'note'
KIND_PLUGIN = 'plugin'

_TOKEN_RE = re.compile(r'\w+', re.UNICODE)

# Garde-fou contre l'enregistrement multiple des listeners ORM.
_events_registered = False


# --------------------------------------------------------------------------- #
# Extraction du texte cherchable
# --------------------------------------------------------------------------- #

def strip_html(html: str | None) -> str:
    """Convertit du HTML en texte brut (partagé avec le blueprint de recherche)."""
    if not html:
        return ''
    txt = re.sub(r'<[^>]+>', ' ', html)
    txt = unescape(txt)
    txt = re.sub(r'\s+', ' ', txt).strip()
    return txt


def _join(*parts: str | None) -> str:
    """Concatène les fragments texte non vides en un seul corps cherchable."""
    return ' '.join(p for p in (s.strip() if isinstance(s, str) else s for s in parts) if p)


def geocache_body(gc) -> str:
    """Corps cherchable d'une géocache (mêmes champs que le blueprint search)."""
    return _join(
        gc.name,
        gc.gc_code,
        gc.owner,
        strip_html(gc.description_html or gc.description_raw),
        strip_html(gc.description_override_html or gc.description_override_raw),
        gc.hints_decoded or gc.hints,
        gc.hints_decoded_override,
        gc.gc_personal_note,
        gc.coordinates_raw,
        gc.original_coordinates_raw,
    )


def log_body(log) -> str:
    return _join(log.author, log.text)


def note_body(note) -> str:
    return _join(note.content)


def plugin_body(plugin) -> str:
    categories = ' '.join(plugin.categories) if plugin.categories else ''
    return _join(plugin.name, plugin.description, plugin.author, categories)


_BODY_BUILDERS = {
    KIND_GEOCACHE: geocache_body,
    KIND_LOG: log_body,
    KIND_NOTE: note_body,
    KIND_PLUGIN: plugin_body,
}


# --------------------------------------------------------------------------- #
# Construction de la requête FTS
# --------------------------------------------------------------------------- #

def build_fts_match(query: str) -> str | None:
    """
    Transforme une query utilisateur en expression FTS5 à préfixe.

    Chaque mot devient un terme préfixe entre guillemets, combinés en AND :
        "grande evaluation"  ->  "grande"* "evaluation"*

    Les guillemets neutralisent les mots-clés FTS (AND/OR/NOT/NEAR) et les
    caractères spéciaux. Retourne None si la query ne contient aucun token
    (dans ce cas, aucun candidat FTS possible).
    """
    tokens = _TOKEN_RE.findall(query or '')
    if not tokens:
        return None
    return ' '.join(f'"{tok}"*' for tok in tokens)


def fts_candidate_ids(connection_or_session, kind: str, match: str, limit: int) -> list[int]:
    """
    Retourne les ids (int) des entités d'un `kind` donné qui matchent l'expression
    FTS `match`, ordonnés par pertinence bm25 (meilleurs d'abord), limités à `limit`.
    """
    if not match:
        return []
    rows = connection_or_session.execute(
        text(
            f'SELECT ref_id FROM {FTS_TABLE} '
            f'WHERE kind = :kind AND {FTS_TABLE} MATCH :m '
            f'ORDER BY bm25({FTS_TABLE}) LIMIT :lim'
        ),
        {'kind': kind, 'm': match, 'lim': limit},
    ).fetchall()
    out: list[int] = []
    for row in rows:
        try:
            out.append(int(row[0]))
        except (TypeError, ValueError):
            continue
    return out


# --------------------------------------------------------------------------- #
# Écriture dans l'index
# --------------------------------------------------------------------------- #

def _delete_rows(connection, kind: str, ref_id) -> None:
    connection.execute(
        text(f'DELETE FROM {FTS_TABLE} WHERE kind = :kind AND ref_id = :ref'),
        {'kind': kind, 'ref': str(ref_id)},
    )


def _insert_row(connection, kind: str, ref_id, body: str) -> None:
    if not body:
        return
    connection.execute(
        text(f'INSERT INTO {FTS_TABLE} (body, kind, ref_id) VALUES (:body, :kind, :ref)'),
        {'body': body, 'kind': kind, 'ref': str(ref_id)},
    )


def _reindex_entity(connection, kind: str, target) -> None:
    """Remplace les lignes FTS d'une entité (delete + insert) sur la connexion donnée."""
    ref_id = getattr(target, 'id', None)
    if ref_id is None:
        return
    _delete_rows(connection, kind, ref_id)
    body = _BODY_BUILDERS[kind](target)
    _insert_row(connection, kind, ref_id, body)


# --------------------------------------------------------------------------- #
# Événements ORM (synchronisation automatique)
# --------------------------------------------------------------------------- #

def _make_write_listener(kind: str):
    def _listener(mapper, connection, target):  # noqa: ANN001
        try:
            _reindex_entity(connection, kind, target)
        except Exception:  # pragma: no cover - la recherche ne doit jamais casser une écriture
            logger.exception('FTS reindex failed for %s id=%s', kind, getattr(target, 'id', None))
    return _listener


def _make_delete_listener(kind: str):
    def _listener(mapper, connection, target):  # noqa: ANN001
        try:
            _delete_rows(connection, kind, getattr(target, 'id', None))
        except Exception:  # pragma: no cover
            logger.exception('FTS delete failed for %s id=%s', kind, getattr(target, 'id', None))
    return _listener


def register_search_events() -> None:
    """Enregistre les listeners ORM sur les modèles indexés (idempotent)."""
    global _events_registered
    if _events_registered:
        return

    from .geocaches.models import Geocache, GeocacheLog, Note
    from .plugins.models import Plugin

    model_kinds = {
        Geocache: KIND_GEOCACHE,
        GeocacheLog: KIND_LOG,
        Note: KIND_NOTE,
        Plugin: KIND_PLUGIN,
    }

    for model, kind in model_kinds.items():
        write_listener = _make_write_listener(kind)
        event.listen(model, 'after_insert', write_listener)
        event.listen(model, 'after_update', write_listener)
        event.listen(model, 'after_delete', _make_delete_listener(kind))

    _events_registered = True
    logger.info('FTS search index ORM events registered')


# --------------------------------------------------------------------------- #
# Création / reconstruction de l'index
# --------------------------------------------------------------------------- #

def _create_table(db) -> None:
    db.session.execute(
        text(
            f'CREATE VIRTUAL TABLE IF NOT EXISTS {FTS_TABLE} USING fts5('
            'body, '
            'kind UNINDEXED, '
            'ref_id UNINDEXED, '
            'tokenize = "unicode61 remove_diacritics 2"'
            ')'
        )
    )
    db.session.commit()


def rebuild_search_index(db) -> int:
    """
    Reconstruit intégralement l'index FTS depuis les tables sources.
    Retourne le nombre d'entités indexées. À appeler dans un app context.
    """
    from .geocaches.models import Geocache, GeocacheLog, Note
    from .plugins.models import Plugin

    db.session.execute(text(f'DELETE FROM {FTS_TABLE}'))

    count = 0
    sources = [
        (KIND_GEOCACHE, Geocache, geocache_body),
        (KIND_LOG, GeocacheLog, log_body),
        (KIND_NOTE, Note, note_body),
        (KIND_PLUGIN, Plugin, plugin_body),
    ]
    for kind, model, builder in sources:
        for obj in model.query.all():
            body = builder(obj)
            if not body:
                continue
            db.session.execute(
                text(f'INSERT INTO {FTS_TABLE} (body, kind, ref_id) VALUES (:body, :kind, :ref)'),
                {'body': body, 'kind': kind, 'ref': str(obj.id)},
            )
            count += 1

    db.session.commit()
    logger.info('FTS search index rebuilt: %s entities indexed', count)
    return count


def ensure_search_index(db) -> None:
    """
    Crée la table FTS si nécessaire et l'amorce si elle est vide.
    Enregistre aussi les événements ORM. À appeler depuis init_db (app context).
    """
    try:
        _create_table(db)
        register_search_events()

        row = db.session.execute(text(f'SELECT count(*) FROM {FTS_TABLE}')).fetchone()
        if row is not None and row[0] == 0:
            logger.info('FTS search index empty -> bootstrap rebuild')
            rebuild_search_index(db)
    except Exception:
        logger.exception('Failed to initialize FTS search index')
        db.session.rollback()
