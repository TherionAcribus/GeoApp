"""Test du rescoring complet (Lot 2.1) dans le metasolver.

Vérifie que le pipeline de scoring complet est appliqué en fin de traitement
(et pas seulement le fast score), et qu'il discrimine mieux les résultats.
"""

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from plugins.official.metasolver.main import MetaSolverPlugin  # noqa: E402


class _TwoTextsManager:
    """Un plugin produisant deux textes : un français valide et du charabia."""

    def __init__(self, valid_text, gibberish_text):
        self._valid = valid_text
        self._gibberish = gibberish_text
        self.plugins_dir = "/nonexistent"

    def list_plugins(self, enabled_only=True):
        return [{"name": "p1"}]

    def get_plugin_info(self, name):
        return {
            "metadata": {
                "metasolver": {"eligible": True, "priority": 50},
                "capabilities": {"decode": True, "analyze": True},
                "input_types": {},
            }
        }

    def execute_plugin(self, name, inputs):
        return {
            "status": "ok",
            "summary": "ok",
            "results": [
                # Le charabia reçoit volontairement une confiance native élevée :
                # seul le rescoring complet doit le faire passer derrière le texte valide.
                {"text_output": self._gibberish, "confidence": 0.95},
                {"text_output": self._valid, "confidence": 0.10},
            ],
        }


def _run():
    plugin = MetaSolverPlugin()
    plugin.set_plugin_manager(_TwoTextsManager(
        valid_text="LA CACHE SE TROUVE AU PIED DU GRAND ARBRE PRES DE LA RIVIERE",
        gibberish_text="XKCDQ ZZZ PLMNBV WXQJ KZZT",
    ))
    return plugin.execute({"text": "ABCDEFGH", "mode": "decode", "preset": "all"})


def test_full_rescoring_is_applied():
    resp = _run()
    assert resp["diagnostics"]["full_rescoring"] is True
    assert resp["diagnostics"]["rescored_results"] >= 1


def test_full_rescoring_populates_scoring_metadata():
    resp = _run()
    for item in resp["results"]:
        if isinstance(item.get("text_output"), str) and item["text_output"].strip():
            assert "scoring" in (item.get("metadata") or {}), item.get("text_output")


def test_valid_text_outranks_gibberish_after_rescoring():
    resp = _run()
    results = resp["results"]
    assert len(results) == 2
    # Malgré une confiance native inférieure, le texte français valide passe devant.
    top = results[0]["text_output"]
    assert "CACHE" in top, f"attendu le texte valide en tête, obtenu: {top!r}"
    # Les confiances sont bien triées de façon décroissante
    confidences = [float(r.get("confidence", 0)) for r in results]
    assert confidences == sorted(confidences, reverse=True)


def test_native_confidence_preserved_as_plugin_confidence():
    resp = _run()
    gibberish = next(r for r in resp["results"] if "XKCDQ" in r["text_output"])
    # La confiance native du plugin est conservée pour l'audit
    assert gibberish["plugin_confidence"] == 0.95
    # mais la confiance finale (rescorée) est bien plus basse
    assert float(gibberish["confidence"]) < 0.5
