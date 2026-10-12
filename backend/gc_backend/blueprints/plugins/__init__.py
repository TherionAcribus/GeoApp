"""
Blueprint pour les endpoints API des plugins.

Ce package expose les routes REST pour :
- Lister les plugins disponibles
- Recuperer les informations d'un plugin
- Generer l'interface HTML d'un plugin
- Executer un plugin (mode synchrone)
- Executer des plugins en mode batch
- Redeclencher la decouverte de plugins
"""

from ._common import (
    bp,
    init_plugin_manager,
    get_plugin_manager,
    _scoring_context_from_inputs,
)

# L'import des sous-modules enregistre les routes sur bp.
from . import listing, metasolver, workflow, scoring, manage, execute  # noqa: F401,E402

# Re-exports de compatibilite pour les anciens importeurs du module plat.
from .execute import BatchPluginTask  # noqa: E402
from .metasolver import (  # noqa: E402
    _load_metasolver_presets,
    _matches_metasolver_filter,
    _analyze_metasolver_signature,
    _score_metasolver_candidate,
    _collect_metasolver_candidates,
    _normalize_max_plugins,
    _extract_metasolver_key_fields,
)
from .workflow import _run_checker_with_target  # noqa: E402


def __getattr__(name):
    """Expose les globales mutables historiques du module plat."""
    if name == '_plugin_manager':
        from . import _common
        return _common._plugin_manager
    if name == 'batch_tasks':
        from . import execute
        return execute.batch_tasks
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
