"""
Signalement d'un problème sur une cache (« Needs Maintenance » / « Needs Archived »).

Repris de c:geo (``ReportProblemType``, ``LogUtils.createLogTaskLogic``) : le
signalement est un **second log**, distinct du log principal, de type 45 (Needs
Maintenance) ou 7 (Needs Archived), daté comme le log principal et envoyé après
lui, seulement s'il a réussi. L'ordre est tenu par l'éditeur de logs, qui appelle
``POST /api/geocaches/<id>/logs/report-problem`` après l'envoi principal.

Voir documentation/garmin-visites-technique.md.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

NEEDS_MAINTENANCE_LOG_TYPE_ID = 45
NEEDS_ARCHIVED_LOG_TYPE_ID = 7

# Types de cache sans contenant : « carnet plein » ou « boîte abîmée » n'y ont pas de sens.
_VIRTUAL_CACHE_TYPE_MARKERS = ('virtual', 'webcam', 'earthcache', 'earth cache')


@dataclass(frozen=True)
class ProblemCategory:
    code: str
    log_type_id: int
    # Types de log principal (valeurs de l'éditeur : found, dnf, note, skip) incompatibles.
    excluded_main_log_types: frozenset[str]
    allowed_on_virtual: bool


PROBLEM_CATEGORIES: dict[str, ProblemCategory] = {
    category.code: category
    for category in (
        ProblemCategory('needsMaintenance', NEEDS_MAINTENANCE_LOG_TYPE_ID, frozenset(), True),
        ProblemCategory('logFull', NEEDS_MAINTENANCE_LOG_TYPE_ID, frozenset({'dnf'}), False),
        ProblemCategory('logWet', NEEDS_MAINTENANCE_LOG_TYPE_ID, frozenset({'dnf'}), False),
        ProblemCategory('damaged', NEEDS_MAINTENANCE_LOG_TYPE_ID, frozenset({'dnf'}), False),
        # On ne peut pas avoir trouvé une cache qu'on dit disparue.
        ProblemCategory('missing', NEEDS_MAINTENANCE_LOG_TYPE_ID, frozenset({'found'}), True),
        ProblemCategory('other', NEEDS_MAINTENANCE_LOG_TYPE_ID, frozenset(), True),
        ProblemCategory('archive', NEEDS_ARCHIVED_LOG_TYPE_ID, frozenset(), True),
    )
}

PROBLEM_LOG_TYPE_LABELS = {
    NEEDS_MAINTENANCE_LOG_TYPE_ID: 'Needs Maintenance',
    NEEDS_ARCHIVED_LOG_TYPE_ID: 'Needs Archived',
}


def is_virtual_cache_type(cache_type: Optional[str]) -> bool:
    lowered = (cache_type or '').lower()
    return any(marker in lowered for marker in _VIRTUAL_CACHE_TYPE_MARKERS)


def validate_problem(category_code: str, main_log_type: Optional[str], cache_type: Optional[str]) -> Optional[str]:
    """Message d'erreur si le signalement est incohérent, sinon ``None``."""
    category = PROBLEM_CATEGORIES.get(category_code)
    if category is None:
        return f'Catégorie de problème inconnue : {category_code}'
    if main_log_type and main_log_type in category.excluded_main_log_types:
        return f'La catégorie « {category_code} » est incompatible avec un log « {main_log_type} ».'
    if not category.allowed_on_virtual and is_virtual_cache_type(cache_type):
        return f'La catégorie « {category_code} » n\'a pas de sens pour une cache sans contenant.'
    return None
