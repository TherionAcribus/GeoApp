"""API des plans de sortie : le rapport d'analyse IA, sorti du chat.

Un plan est identifié par ``(zone_name, outing_date)`` — la clé du titre de session du
chat. L'écriture est donc un **upsert** : relancer l'analyse d'une sortie remplace son
plan au lieu d'en empiler un second, comme elle reprend la même conversation.

Le seul endpoint qui n'est pas une simple lecture est ``/flags`` : il répond à la question
que posent les tables de géocaches, « qu'est-ce que la dernière analyse a dit de ces
codes-là ? », en un appel plutôt qu'en un par ligne affichée.
"""

from __future__ import annotations

import json
import logging
import re
from datetime import date

from flask import Blueprint, jsonify, request

from ..database import db
from ..models import OutingPlan
from ..services.outing_plan_schema import (
    OutingPlanError,
    plan_flags_by_code,
    validate_plan,
)

bp = Blueprint('outing_plans', __name__)
logger = logging.getLogger(__name__)

#: Au-delà, ce n'est plus un rapport de sortie mais un fichier joint.
MAX_MARKDOWN_CHARS = 200_000

#: Plafond de la recherche par codes : les badges regardent les sorties récentes, pas
#: l'historique complet. Un plan plus vieux que ça ne décrit plus l'état du terrain.
MAX_PLANS_SCANNED_FOR_FLAGS = 50

MAX_GC_CODES_PER_QUERY = 200

_DATE_RE = re.compile(r'^\d{4}-\d{2}-\d{2}$')
_GC_CODE_RE = re.compile(r'^GC[A-Z0-9]{1,12}$')


def _parse_outing_date(raw) -> str | None:
    """Date au format ``AAAA-MM-JJ``, contrôlée pour de vrai (le 31 février est refusé)."""
    if not isinstance(raw, str) or not _DATE_RE.match(raw.strip()):
        return None
    value = raw.strip()
    try:
        date.fromisoformat(value)
    except ValueError:
        return None
    return value


def _clean_codes(raw) -> list[str]:
    if not isinstance(raw, list):
        return []
    codes: list[str] = []
    for item in raw:
        if not isinstance(item, str):
            continue
        code = item.strip().upper()
        if _GC_CODE_RE.match(code) and code not in codes:
            codes.append(code)
    return codes


@bp.post('/api/outing-plans')
def save_outing_plan():
    """
    Enregistre (ou remplace) le plan d'une sortie.

    Body : ``{zone_name?, outing_date, gc_codes?, plan, markdown?, source?, model_name?}``.
    ``plan`` est le JSON produit par l'IA ; il est normalisé avant stockage, et les coupes
    appliquées ressortent dans ``warnings`` plutôt que de faire échouer l'appel.

    L'identité de la sortie — zone et date — vient de l'appelant, jamais du modèle : elle
    est connue de façon certaine côté front, et la faire dépendre d'un champ recopié par
    une IA serait le seul endroit du dispositif où une erreur de recopie casserait
    l'appariement.
    """
    data = request.get_json(silent=True) or {}

    outing_date = _parse_outing_date(data.get('outing_date'))
    if not outing_date:
        return jsonify({'error': 'outing_date manquante ou invalide (attendu AAAA-MM-JJ)'}), 400

    try:
        validated = validate_plan(data.get('plan'))
    except OutingPlanError as error:
        return jsonify({'error': str(error)}), 400

    zone_name = (data.get('zone_name') or '').strip()[:150]
    gc_codes = _clean_codes(data.get('gc_codes'))
    markdown = data.get('markdown')
    markdown = markdown[:MAX_MARKDOWN_CHARS] if isinstance(markdown, str) else None
    source = data.get('source') if data.get('source') in ('tool', 'parsed', 'manual') else 'tool'
    model_name = (data.get('model_name') or '')[:120] or None

    plan = validated['plan']

    existing = OutingPlan.query.filter_by(zone_name=zone_name, outing_date=outing_date).first()
    if existing is None:
        existing = OutingPlan(zone_name=zone_name, outing_date=outing_date)
        db.session.add(existing)
        kept_checked: list[str] = []
    else:
        # Une relance d'analyse ne doit pas vider un sac à moitié fait : on garde les
        # coches dont la ligne existe encore dans le nouveau plan, et seulement celles-là.
        keys = {item['key'] for item in plan['checklist']}
        try:
            previous = json.loads(existing.checked or '[]')
        except (TypeError, ValueError):
            previous = []
        kept_checked = [key for key in previous if key in keys]

    existing.payload = json.dumps(plan, ensure_ascii=False)
    existing.gc_codes = json.dumps(gc_codes, ensure_ascii=False)
    existing.checked = json.dumps(kept_checked, ensure_ascii=False)
    existing.source = source
    existing.model_name = model_name
    if markdown is not None:
        existing.markdown = markdown

    db.session.commit()

    logger.info(
        'Plan de sortie enregistré : %s / %s (%s caches, source=%s)',
        zone_name or 'sélection', outing_date, len(gc_codes), source,
    )

    return jsonify({'plan': existing.to_dict(), 'warnings': validated['warnings']})


@bp.get('/api/outing-plans')
def list_outing_plans():
    """Liste les plans, du plus récent au plus ancien. Le Markdown est omis ici."""
    query = OutingPlan.query

    outing_date = request.args.get('outing_date')
    if outing_date:
        parsed = _parse_outing_date(outing_date)
        if not parsed:
            return jsonify({'error': 'outing_date invalide (attendu AAAA-MM-JJ)'}), 400
        query = query.filter(OutingPlan.outing_date == parsed)

    zone_name = request.args.get('zone_name')
    if zone_name is not None:
        query = query.filter(OutingPlan.zone_name == zone_name.strip())

    try:
        limit = max(1, min(int(request.args.get('limit', 20)), 100))
    except (TypeError, ValueError):
        limit = 20

    plans = (
        query.order_by(OutingPlan.outing_date.desc(), OutingPlan.updated_at.desc())
        .limit(limit)
        .all()
    )
    return jsonify({'plans': [plan.to_dict(include_markdown=False) for plan in plans]})


@bp.get('/api/outing-plans/<int:plan_id>')
def get_outing_plan(plan_id: int):
    plan = OutingPlan.query.get(plan_id)
    if not plan:
        return jsonify({'error': 'Plan not found'}), 404
    return jsonify({'plan': plan.to_dict()})


@bp.patch('/api/outing-plans/<int:plan_id>')
def update_outing_plan(plan_id: int):
    """
    Met à jour l'état coché de la checklist, et/ou le texte du rapport.

    Body : ``{checked?: ["cle-1", ...], markdown?: "..."}``.

    Les clés inconnues du plan sont écartées silencieusement : elles viennent d'un plan
    remplacé entre deux clics, et refuser l'appel entier pour ça ferait perdre les coches
    valides du même envoi.

    ``markdown`` existe parce que les deux voies de capture ne portent pas la même chose :
    le tool transmet la structure sans le texte rédigé, que seule la lecture de la réponse
    fournit. C'est ce texte qui part à l'export.
    """
    plan = OutingPlan.query.get(plan_id)
    if not plan:
        return jsonify({'error': 'Plan not found'}), 404

    data = request.get_json(silent=True) or {}
    raw_checked = data.get('checked')
    raw_markdown = data.get('markdown')

    if raw_checked is None and raw_markdown is None:
        return jsonify({'error': 'Rien à mettre à jour (checked ou markdown attendu)'}), 400

    if raw_checked is not None:
        if not isinstance(raw_checked, list):
            return jsonify({'error': 'checked doit être une liste de clés'}), 400

        try:
            payload = json.loads(plan.payload or '{}')
        except (TypeError, ValueError):
            payload = {}
        keys = {item.get('key') for item in payload.get('checklist') or []}

        checked = []
        for key in raw_checked:
            if isinstance(key, str) and key in keys and key not in checked:
                checked.append(key)

        plan.checked = json.dumps(checked, ensure_ascii=False)

    if raw_markdown is not None:
        if not isinstance(raw_markdown, str):
            return jsonify({'error': 'markdown doit être une chaîne'}), 400
        plan.markdown = raw_markdown[:MAX_MARKDOWN_CHARS]

    db.session.commit()

    return jsonify({'plan': plan.to_dict(include_markdown=False)})


@bp.delete('/api/outing-plans/<int:plan_id>')
def delete_outing_plan(plan_id: int):
    plan = OutingPlan.query.get(plan_id)
    if not plan:
        return jsonify({'error': 'Plan not found'}), 404
    db.session.delete(plan)
    db.session.commit()
    return jsonify({'status': 'deleted', 'id': plan_id})


@bp.post('/api/outing-plans/flags')
def outing_plan_flags():
    """
    Drapeaux d'analyse pour un lot de codes GC, pour les badges des tables.

    Body : ``{gc_codes: [...]}``. Réponse : ``{flags: {GCXXXX: {...}}}``, où chaque entrée
    porte les drapeaux, le matériel et la durée retenus par le plan **le plus récent** qui
    parle de ce code, plus l'identité de ce plan — un badge doit pouvoir dire de quelle
    analyse il vient, et de quand.

    Le filtrage se fait en Python sur les plans récents : ``gc_codes`` est du JSON en
    colonne texte, que SQLite ne sait pas indexer, et le volume est de l'ordre de la
    dizaine de plans.
    """
    data = request.get_json(silent=True) or {}
    codes = _clean_codes(data.get('gc_codes'))[:MAX_GC_CODES_PER_QUERY]
    if not codes:
        return jsonify({'flags': {}})

    wanted = set(codes)
    plans = (
        OutingPlan.query.order_by(
            OutingPlan.outing_date.desc(), OutingPlan.updated_at.desc()
        )
        .limit(MAX_PLANS_SCANNED_FOR_FLAGS)
        .all()
    )

    flags: dict[str, dict] = {}
    for plan in plans:
        if not wanted:
            break
        try:
            payload = json.loads(plan.payload or '{}')
        except (TypeError, ValueError):
            continue
        by_code = plan_flags_by_code(payload)
        for code in list(wanted):
            entry = by_code.get(code)
            if not entry:
                continue
            flags[code] = {
                **entry,
                'plan_id': plan.id,
                'outing_date': plan.outing_date,
                'zone_name': plan.zone_name or '',
            }
            wanted.discard(code)

    return jsonify({'flags': flags})
