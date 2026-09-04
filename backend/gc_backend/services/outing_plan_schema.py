"""Validation du plan de sortie renvoyé par l'IA.

Tout le reste du chantier « analyse de sortie » est déterministe : le bundle est calculé,
les durées sont calculées, la géographie est calculée. Le plan, lui, est la seule donnée
qui vienne d'un modèle. Il arrive par un tool call ou par un bloc JSON en fin de réponse,
et rien ne garantit qu'il respecte le contrat : une énumération inventée, un `minutes`
rendu en chaîne, un code GC mal recopié sont des accidents ordinaires.

Ce module ramène ce qui arrive à une forme fixe, et **jamais à une erreur** tant qu'il
reste quelque chose d'exploitable : un rapport dont on ne garderait que la checklist vaut
mieux qu'un rapport rejeté, puisque le texte, lui, est déjà sous les yeux de l'utilisateur
dans le chat. Chaque coupe est nommée dans `warnings`, que l'UI affiche.

Il fait aussi une chose que le modèle n'a pas à faire : **dériver les drapeaux par cache
depuis les alertes**. Une alerte bloquante sur GCXXXX vaut drapeau `blocking` sur GCXXXX,
que le modèle ait pensé ou non à le répéter dans `per_cache`. Les badges des tables lisent
ces drapeaux : les faire dépendre de la discipline du modèle les rendrait intermittents.
"""

from __future__ import annotations

import re
import unicodedata

#: Version du schéma. Stockée avec le plan : un plan écrit par une version antérieure
#: doit rester lisible, ou dire clairement qu'il ne l'est plus.
PLAN_VERSION = 1

#: Niveaux de certitude de la checklist, du plus sûr au plus spéculatif. L'ordre compte :
#: c'est lui qui arbitre la fusion de deux entrées identiques.
CERTAINTIES = ('confirmed', 'probable', 'precaution')

SEVERITIES = ('blocking', 'warning', 'info')

ALERT_KINDS = (
    'unsolved_mystery',
    'already_found',
    'health',
    'gear',
    'access',
    'schedule',
    'risk',
    'data',
    'other',
)

#: Vocabulaire fermé des drapeaux par cache : c'est le contrat des badges de table.
#: Un drapeau inconnu est jeté plutôt que rendu, faute de savoir comment le dessiner.
CACHE_FLAGS = (
    'blocking',
    'gear_required',
    'unresolved_gear',
    'risky_health',
    'time_sink',
    'time_window',
    'access',
    'stale_data',
)

#: Alerte -> drapeau. Une alerte bloquante donne toujours `blocking`, quel que soit son
#: genre ; le genre ajoute son propre drapeau quand il en a un.
_KIND_TO_FLAG = {
    'health': 'risky_health',
    'gear': 'gear_required',
    'access': 'access',
    'schedule': 'time_window',
    'data': 'stale_data',
    'unsolved_mystery': 'blocking',
    'already_found': 'blocking',
}

MAX_CHECKLIST_ITEMS = 60
MAX_ALERTS = 120
MAX_PER_CACHE = 60
MAX_ORDER = 60
MAX_TO_VERIFY = 40
MAX_ITEM_CHARS = 160
MAX_MESSAGE_CHARS = 400
MAX_SUMMARY_CHARS = 800
MAX_MINUTES = 24 * 60

_GC_CODE_RE = re.compile(r'^GC[A-Z0-9]{1,12}$')


class OutingPlanError(ValueError):
    """Le contenu reçu n'est pas un plan : rien d'exploitable n'a pu en être tiré."""


def normalize_key(text: str) -> str:
    """Clé stable d'une ligne de checklist : minuscules, sans accents, sans ponctuation.

    C'est elle qui porte l'état « coché » d'une sortie à l'autre. Une reformulation du
    modèle (« lampe frontale » vers « frontale ») perd donc la coche : c'est le prix d'une
    clé lisible, et la perte est visible plutôt que silencieuse.
    """
    decomposed = unicodedata.normalize('NFD', (text or '').lower())
    stripped = ''.join(char for char in decomposed if not unicodedata.combining(char))
    slug = re.sub(r'[^a-z0-9]+', '-', stripped).strip('-')
    return slug[:80]


def _clean_text(value, limit: int) -> str:
    if not isinstance(value, str):
        return ''
    collapsed = ' '.join(value.split())
    return collapsed[:limit]


def _clean_gc_code(value) -> str:
    if not isinstance(value, str):
        return ''
    code = value.strip().upper()
    return code if _GC_CODE_RE.match(code) else ''


def _clean_gc_codes(value, warnings: list[str], context: str) -> list[str]:
    if not isinstance(value, list):
        return []
    codes: list[str] = []
    dropped = 0
    for raw in value:
        code = _clean_gc_code(raw)
        if not code:
            dropped += 1
            continue
        if code not in codes:
            codes.append(code)
    if dropped:
        warnings.append(f'{dropped} code(s) GC illisible(s) ignoré(s) dans {context}.')
    return codes


def _clean_enum(value, allowed: tuple[str, ...], fallback: str) -> str:
    if isinstance(value, str) and value.strip().lower() in allowed:
        return value.strip().lower()
    return fallback


def _clean_minutes(value) -> int | None:
    """Durée en minutes, tolérante sur le type : un modèle rend volontiers « 45 min »."""
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        minutes = int(round(value))
    elif isinstance(value, str):
        match = re.search(r'\d+', value)
        if not match:
            return None
        minutes = int(match.group())
    else:
        return None
    if minutes < 0:
        return None
    return min(minutes, MAX_MINUTES)


def _clean_checklist(raw, warnings: list[str]) -> list[dict]:
    if not isinstance(raw, list):
        return []

    merged: dict[str, dict] = {}
    for entry in raw:
        if isinstance(entry, str):
            entry = {'item': entry}
        if not isinstance(entry, dict):
            continue

        item = _clean_text(entry.get('item') or entry.get('label'), MAX_ITEM_CHARS)
        if not item:
            continue

        key = normalize_key(item)
        if not key:
            continue

        certainty = _clean_enum(entry.get('certainty'), CERTAINTIES, 'precaution')
        codes = _clean_gc_codes(entry.get('gc_codes'), warnings, 'la checklist')
        reason = _clean_text(entry.get('reason'), MAX_MESSAGE_CHARS)

        existing = merged.get(key)
        if existing is None:
            merged[key] = {
                'key': key,
                'item': item,
                'certainty': certainty,
                'gc_codes': codes,
                'reason': reason,
            }
            continue

        # Doublon : on garde la certitude la plus forte et l'union des codes. Deux lignes
        # « lampe frontale » portant des caches différentes sont un seul objet dans le sac.
        if CERTAINTIES.index(certainty) < CERTAINTIES.index(existing['certainty']):
            existing['certainty'] = certainty
            if reason:
                existing['reason'] = reason
        for code in codes:
            if code not in existing['gc_codes']:
                existing['gc_codes'].append(code)
        if not existing['reason'] and reason:
            existing['reason'] = reason

    items = list(merged.values())
    if len(items) > MAX_CHECKLIST_ITEMS:
        warnings.append(
            f'Checklist tronquée à {MAX_CHECKLIST_ITEMS} lignes ({len(items)} reçues).'
        )
        items = items[:MAX_CHECKLIST_ITEMS]

    order = {certainty: index for index, certainty in enumerate(CERTAINTIES)}
    items.sort(key=lambda entry: (order[entry['certainty']], entry['item'].lower()))
    return items


def _clean_alerts(raw, warnings: list[str]) -> list[dict]:
    if not isinstance(raw, list):
        return []

    alerts: list[dict] = []
    for entry in raw:
        if isinstance(entry, str):
            entry = {'message': entry}
        if not isinstance(entry, dict):
            continue

        message = _clean_text(entry.get('message') or entry.get('text'), MAX_MESSAGE_CHARS)
        if not message:
            continue

        alerts.append({
            'gc_code': _clean_gc_code(entry.get('gc_code')) or None,
            'severity': _clean_enum(entry.get('severity'), SEVERITIES, 'warning'),
            'kind': _clean_enum(entry.get('kind'), ALERT_KINDS, 'other'),
            'message': message,
        })

    if len(alerts) > MAX_ALERTS:
        warnings.append(f'Alertes tronquées à {MAX_ALERTS} lignes ({len(alerts)} reçues).')
        alerts = alerts[:MAX_ALERTS]

    severity_order = {severity: index for index, severity in enumerate(SEVERITIES)}
    alerts.sort(key=lambda entry: severity_order[entry['severity']])
    return alerts


def _clean_flags(raw) -> list[str]:
    if not isinstance(raw, list):
        return []
    flags: list[str] = []
    for value in raw:
        if isinstance(value, str):
            flag = value.strip().lower()
            if flag in CACHE_FLAGS and flag not in flags:
                flags.append(flag)
    return flags


def _new_cache_record(code: str) -> dict:
    return {'gc_code': code, 'gear': [], 'flags': [], 'minutes': None, 'note': ''}


def _clean_per_cache(raw, warnings: list[str]) -> dict[str, dict]:
    if not isinstance(raw, list):
        return {}

    per_cache: dict[str, dict] = {}
    for entry in raw:
        if not isinstance(entry, dict):
            continue
        code = _clean_gc_code(entry.get('gc_code'))
        if not code:
            continue

        record = per_cache.setdefault(code, _new_cache_record(code))

        raw_gear = entry.get('gear')
        if isinstance(raw_gear, list):
            for value in raw_gear:
                cleaned = _clean_text(value, MAX_ITEM_CHARS)
                if cleaned and cleaned not in record['gear']:
                    record['gear'].append(cleaned)

        for flag in _clean_flags(entry.get('flags')):
            if flag not in record['flags']:
                record['flags'].append(flag)

        minutes = _clean_minutes(entry.get('minutes'))
        if minutes is not None:
            record['minutes'] = minutes

        note = _clean_text(entry.get('note'), MAX_MESSAGE_CHARS)
        if note and not record['note']:
            record['note'] = note

    if len(per_cache) > MAX_PER_CACHE:
        warnings.append(
            f'Détail par cache tronqué à {MAX_PER_CACHE} entrées ({len(per_cache)} reçues).'
        )
        per_cache = dict(list(per_cache.items())[:MAX_PER_CACHE])

    return per_cache


def _derive_flags(per_cache: dict[str, dict], alerts: list[dict]) -> None:
    """Complète `per_cache[].flags` depuis les alertes et le matériel listé.

    Le modèle n'a pas à tenir deux fois la même information. Les badges des tables lisent
    les drapeaux : les dériver ici les rend indépendants de la discipline du modèle.
    """
    for alert in alerts:
        code = alert.get('gc_code')
        if not code:
            continue
        record = per_cache.setdefault(code, _new_cache_record(code))
        derived = []
        if alert['severity'] == 'blocking':
            derived.append('blocking')
        mapped = _KIND_TO_FLAG.get(alert['kind'])
        if mapped:
            derived.append(mapped)
        for flag in derived:
            if flag not in record['flags']:
                record['flags'].append(flag)

    for record in per_cache.values():
        if record['gear'] and 'gear_required' not in record['flags']:
            record['flags'].append('gear_required')
        record['flags'].sort(key=CACHE_FLAGS.index)


def _clean_time_budget(raw) -> dict | None:
    if not isinstance(raw, dict):
        return None
    on_site = _clean_minutes(raw.get('on_site_minutes'))
    travel = _clean_minutes(raw.get('travel_minutes'))
    total = _clean_minutes(raw.get('total_minutes'))
    if on_site is None and travel is None and total is None:
        return None
    if total is None and on_site is not None:
        total = on_site + (travel or 0)
    return {'on_site_minutes': on_site, 'travel_minutes': travel, 'total_minutes': total}


def _clean_string_list(raw, limit: int, item_limit: int) -> list[str]:
    if not isinstance(raw, list):
        return []
    values: list[str] = []
    for entry in raw:
        cleaned = _clean_text(entry, item_limit)
        if cleaned and cleaned not in values:
            values.append(cleaned)
        if len(values) >= limit:
            break
    return values


def validate_plan(raw) -> dict:
    """Normalise un plan brut. Renvoie `{'plan': ..., 'warnings': [...]}`.

    Lève `OutingPlanError` seulement quand il ne reste rien : ni checklist, ni alerte, ni
    détail par cache. Un plan vide n'est pas un plan, et le stocker ferait croire à
    l'utilisateur qu'une analyse a abouti.
    """
    if not isinstance(raw, dict):
        raise OutingPlanError('Le plan doit être un objet JSON.')

    warnings: list[str] = []

    checklist = _clean_checklist(raw.get('checklist'), warnings)
    alerts = _clean_alerts(raw.get('alerts'), warnings)
    per_cache = _clean_per_cache(raw.get('per_cache'), warnings)
    _derive_flags(per_cache, alerts)

    if not checklist and not alerts and not per_cache:
        raise OutingPlanError(
            'Plan vide : ni checklist, ni alertes, ni détail par cache exploitables.'
        )

    order = _clean_gc_codes(raw.get('order'), warnings, "l'ordre de visite")[:MAX_ORDER]

    plan = {
        'version': PLAN_VERSION,
        'summary': _clean_text(raw.get('summary'), MAX_SUMMARY_CHARS),
        'checklist': checklist,
        'alerts': alerts,
        'per_cache': sorted(per_cache.values(), key=lambda entry: entry['gc_code']),
        'order': order,
        'time_budget': _clean_time_budget(raw.get('time_budget')),
        'to_verify': _clean_string_list(raw.get('to_verify'), MAX_TO_VERIFY, MAX_MESSAGE_CHARS),
    }

    return {'plan': plan, 'warnings': warnings}


def plan_flags_by_code(plan: dict) -> dict[str, dict]:
    """Vue par code GC, telle que la consomment les badges des tables."""
    if not isinstance(plan, dict):
        return {}
    result: dict[str, dict] = {}
    for entry in plan.get('per_cache') or []:
        code = entry.get('gc_code')
        if not code:
            continue
        result[code] = {
            'flags': list(entry.get('flags') or []),
            'gear': list(entry.get('gear') or []),
            'minutes': entry.get('minutes'),
        }
    return result
