"""Tests de parité après l'unification de la logique Meta Solver.

Vérifie que le blueprint plugins.py ne contient plus de copies privées
des fonctions du service metasolver_analysis, et que les alias underscore
pointent bien vers les mêmes implémentations.
"""

import inspect

from gc_backend.blueprints import plugins as bp
from gc_backend.services import metasolver_analysis as svc


# ─────────────────────────────────────────────────────────────────────────────
# 1. Les alias underscore du blueprint pointent vers le service
# ─────────────────────────────────────────────────────────────────────────────

def test_blueprint_load_presets_is_service_function():
    assert bp._load_metasolver_presets is svc.load_metasolver_presets

def test_blueprint_matches_filter_is_service_function():
    assert bp._matches_metasolver_filter is svc.matches_metasolver_filter

def test_blueprint_analyze_signature_is_service_function():
    assert bp._analyze_metasolver_signature is svc.analyze_metasolver_signature

def test_blueprint_score_candidate_is_service_function():
    assert bp._score_metasolver_candidate is svc.score_metasolver_candidate

def test_blueprint_collect_candidates_is_service_function():
    assert bp._collect_metasolver_candidates is svc.collect_metasolver_candidates

def test_blueprint_normalize_max_plugins_is_service_function():
    assert bp._normalize_max_plugins is svc.normalize_max_plugins

def test_blueprint_extract_key_fields_is_service_function():
    assert bp._extract_metasolver_key_fields is svc.extract_metasolver_key_fields


# ─────────────────────────────────────────────────────────────────────────────
# 2. Le blueprint ne redéfinit pas ces fonctions (pas de def local)
# ─────────────────────────────────────────────────────────────────────────────

def _get_module_defined_names(module) -> set:
    """Retourne les noms définis directement dans le module (pas importés)."""
    return {
        name for name, obj in vars(module).items()
        if getattr(obj, '__module__', None) == module.__name__
    }

def test_blueprint_does_not_redefine_metasolver_functions():
    """Le blueprint ne doit pas contenir de def locaux pour ces fonctions."""
    bp_defined = _get_module_defined_names(bp)
    # Les fonctions ci-dessous doivent être des alias (importés du service),
    # pas des définitions locales du blueprint.
    for name in (
        '_load_metasolver_presets',
        '_matches_metasolver_filter',
        '_analyze_metasolver_signature',
        '_score_metasolver_candidate',
        '_collect_metasolver_candidates',
        '_normalize_max_plugins',
        '_extract_metasolver_key_fields',
    ):
        assert name not in bp_defined, (
            f"Le blueprint redéfinit toujours {name} localement — "
            f"l'unification n'est pas complète."
        )


# ─────────────────────────────────────────────────────────────────────────────
# 3. Le service expose bien extract_metasolver_key_fields
# ─────────────────────────────────────────────────────────────────────────────

def test_service_exposes_extract_key_fields():
    assert hasattr(svc, 'extract_metasolver_key_fields')
    assert callable(svc.extract_metasolver_key_fields)


def test_service_candidates_include_key_fields():
    """Les candidats du service doivent inclure key_fields et requires_key dérivé."""
    # On teste la logique de extract_metasolver_key_fields directement
    # (collect_metasolver_candidates nécessite un contexte DB).
    metadata = {
        'input_types': {
            'text': {'type': 'string'},
            'key': {'type': 'string', 'required': True, 'label': 'Clé de décodage'},
            'candidate_keys': {'type': 'string', 'label': 'Candidate keys'},
            'offset': {'type': 'integer'},
        }
    }
    key_fields = svc.extract_metasolver_key_fields(metadata)
    assert 'key' in key_fields
    assert 'candidate_keys' in key_fields
    assert 'offset' not in key_fields
    assert 'text' not in key_fields
