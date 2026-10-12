"""Socle commun du blueprint plugins : Blueprint, PluginManager et utilitaires partages.

Ce module centralise les objets references par plusieurs sous-modules du
package ``gc_backend.blueprints.plugins`` (instance du plugin manager,
helpers de normalisation) afin d'eviter les imports circulaires.
"""

from flask import Blueprint
from loguru import logger
from typing import Dict, Any, Optional

from ...plugins import PluginManager
from ...plugins.executor import scoring_context_from_inputs

# Creer le blueprint
bp = Blueprint('plugins', __name__, url_prefix='/api/plugins')


# Instance globale du PluginManager (sera initialisee dans create_app)
_plugin_manager: PluginManager = None


def init_plugin_manager(manager: PluginManager):
    """
    Initialise le PluginManager global pour ce blueprint.
    
    Cette fonction doit être appelée depuis create_app() après
    la création du PluginManager.
    
    Args:
        manager (PluginManager): Instance du gestionnaire de plugins
    """
    global _plugin_manager
    _plugin_manager = manager
    logger.info("PluginManager initialisé dans le blueprint plugins")


def _normalize_positive_int(value: Any, default: int, *, minimum: int = 0, maximum: Optional[int] = None) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return default
    if parsed < minimum:
        return default
    if maximum is not None and parsed > maximum:
        return maximum
    return parsed


def _normalize_bool(value: Any, default: bool) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {'true', '1', 'yes', 'oui', 'on'}:
            return True
        if normalized in {'false', '0', 'no', 'non', 'off'}:
            return False
    return default


def get_plugin_manager() -> PluginManager:
    """
    Récupère l'instance du PluginManager.
    
    Returns:
        PluginManager: Instance du gestionnaire
        
    Raises:
        RuntimeError: Si le manager n'est pas initialisé
    """
    if _plugin_manager is None:
        raise RuntimeError(
            "PluginManager non initialisé. "
            "Appelez init_plugin_manager() depuis create_app()"
        )
    return _plugin_manager


def _scoring_context_from_inputs(inputs: Any) -> Dict[str, Any]:
    """Alias vers ``gc_backend.plugins.executor.scoring_context_from_inputs``.

    L'implementation canonique a ete deplacee dans la couche centrale
    d'execution des plugins ; cet alias preserve les call sites existants
    du blueprint (endpoint /score notamment).
    """
    return scoring_context_from_inputs(inputs)
