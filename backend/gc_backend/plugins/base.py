"""Base facultative pour les plugins de codage/decodage.

Historiquement, chaque plugin recopiait les memes helpers prives
(``_error_response``, ``_get_plugin_info``, parsing des booleens, repli de
scoring, ...). ``CipherPluginBase`` centralise ces implementations pour les
nouveaux plugins et sert de cible de migration pour les existants.

La classe est volontairement facultative : le chargeur de plugins n'exige
aucun heritage, il suffit de definir ``name``, ``version`` et
``execute(inputs)``. Elle se nome ``CipherPluginBase`` (et non
``*Plugin``) pour ne pas etre confondue avec une classe de plugin par le
detecteur ``_find_plugin_class`` du wrapper.

Import depuis un plugin (avec repli pour l'execution standalone / tests) :

    try:
        from gc_backend.plugins.base import CipherPluginBase
    except ImportError:  # execution hors backend
        import sys as _sys, pathlib as _pathlib
        _sys.path.insert(0, str(_pathlib.Path(__file__).resolve().parents[3] / "backend"))
        from gc_backend.plugins.base import CipherPluginBase
"""

from __future__ import annotations

import time
from typing import Any, Dict, List, Optional

# Re-exports pratiques : un plugin peut tout importer depuis
# `gc_backend.plugins.base` sans connaitre la repartition interne.
from .code_solving import (
    DEFAULT_ALLOWED_CHARS,
    ModeParams,
    is_alpha_strict,
    normalize_allowed_chars,
    parse_bool,
    parse_mode_params,
    remove_diacritics,
)

try:  # pragma: no cover - dependance optionnelle (scoring lourd)
    from .scoring import score_text_fast as _score_text_fast

    _SCORING_AVAILABLE = True
except Exception:  # pragma: no cover - dependance optionnelle
    _score_text_fast = None
    _SCORING_AVAILABLE = False


class CipherPluginBase:
    """Base facultative pour les plugins de codage/decodage.

    Fournit les implementations standard des helpers historiquement
    recopies dans chaque plugin :

    - ``_get_plugin_info`` / ``_error_response`` / ``_ok_response`` :
      construction des reponses au format standardise.
    - ``_make_result`` : construction d'une entree de ``results``.
    - ``_mode_params`` / ``_text`` : lecture normalisee des inputs.
    - ``_score_fast`` : repli securise autour de ``score_text_fast``.
    - ``set_plugin_manager`` : injection du PluginManager par le wrapper.

    Un plugin concret surcharge ``name`` et ``version`` (attributs de
    classe ou dans ``__init__``) et implemente ``execute(inputs)``.
    """

    name: str = "plugin"  # surcharge dans __init__ ou attribut de classe
    version: str = "1.0.0"

    def __init__(self) -> None:
        self.plugin_manager = None

    def set_plugin_manager(self, plugin_manager) -> None:
        """Stocke le PluginManager injecte par le wrapper apres instanciation."""
        self.plugin_manager = plugin_manager

    # ------------------------------------------------------------------
    # Informations d'execution
    # ------------------------------------------------------------------
    @staticmethod
    def _elapsed_ms(start_time: Optional[float]) -> float:
        """Retourne le temps ecoule depuis ``start_time`` en ms (arrondi 2).

        Renvoie ``0.0`` si ``start_time`` est absent (``None``) ou nul.
        """
        if not start_time:
            return 0.0
        return round((time.time() - start_time) * 1000, 2)

    def _get_plugin_info(self, start_time: Optional[float] = None) -> Dict[str, Any]:
        """Construit le bloc ``plugin_info`` standard de la reponse."""
        return {
            "name": self.name,
            "version": self.version,
            "execution_time_ms": self._elapsed_ms(start_time),
        }

    # ------------------------------------------------------------------
    # Reponses standardisees
    # ------------------------------------------------------------------
    def _ok_response(
        self,
        results: List[Dict[str, Any]],
        summary: Optional[str] = None,
        start_time: Optional[float] = None,
    ) -> Dict[str, Any]:
        """Construit une reponse de succes au format standardise."""
        return {
            "status": "ok",
            "summary": summary or f"{len(results)} résultat(s) généré(s)",
            "results": results,
            "plugin_info": self._get_plugin_info(start_time),
        }

    def _error_response(
        self,
        message: str,
        start_time: Optional[float] = None,
    ) -> Dict[str, Any]:
        """Construit une reponse d'erreur au format standardise."""
        return {
            "status": "error",
            "summary": message,
            "results": [],
            "plugin_info": self._get_plugin_info(start_time),
        }

    def _make_result(
        self,
        text_output: Optional[str] = None,
        confidence: float = 0.0,
        parameters: Optional[Dict[str, Any]] = None,
        metadata: Optional[Dict[str, Any]] = None,
        result_id: Optional[str] = None,
        **extra: Any,
    ) -> Dict[str, Any]:
        """Construit une entree de ``results`` au format standardise.

        Les cles ``text_output``, ``parameters`` et ``metadata`` ne sont
        incluses que si elles sont fournies ; tout argument supplementaire
        (``**extra``) est fusionne tel quel dans le resultat.
        """
        result: Dict[str, Any] = {
            "id": result_id or "result_1",
            "confidence": confidence,
        }
        if text_output is not None:
            result["text_output"] = text_output
        if parameters is not None:
            result["parameters"] = parameters
        if metadata is not None:
            result["metadata"] = metadata
        result.update(extra)
        return result

    # ------------------------------------------------------------------
    # Lecture des inputs
    # ------------------------------------------------------------------
    def _mode_params(self, inputs: Dict[str, Any], **kwargs: Any) -> ModeParams:
        """Lit ``mode``/``strict``/``embedded``/``allowed_chars`` via code_solving."""
        return parse_mode_params(inputs, **kwargs)

    @staticmethod
    def _text(
        inputs: Dict[str, Any],
        field: str = "text",
        default: str = "",
    ) -> str:
        """Retourne ``inputs[field]`` si c'est une chaine, sinon ``default``."""
        value = inputs.get(field)
        return value if isinstance(value, str) else default

    # ------------------------------------------------------------------
    # Scoring
    # ------------------------------------------------------------------
    def _score_fast(self, text: str, default: float = 0.5) -> float:
        """Score rapide d'un texte via ``score_text_fast`` (0..1).

        Renvoie ``default`` si le module de scoring est indisponible ou
        leve une exception (execution standalone, ressources absentes...).
        """
        if not _SCORING_AVAILABLE or _score_text_fast is None:
            return default
        try:
            return float(_score_text_fast(text))
        except Exception:
            return default


__all__ = [
    "CipherPluginBase",
    # Re-exports code_solving
    "DEFAULT_ALLOWED_CHARS",
    "ModeParams",
    "is_alpha_strict",
    "normalize_allowed_chars",
    "parse_bool",
    "parse_mode_params",
    "remove_diacritics",
]
