import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from plugins.official.metasolver.main import MetaSolverPlugin


def test_dedup_merges_identical_text_and_keeps_best_confidence():
    plugin = MetaSolverPlugin()
    results = [
        {"text_output": "BONJOUR LE MONDE", "confidence": 0.4, "plugin": "caesar"},
        {"text_output": "BONJOUR LE MONDE", "confidence": 0.9, "plugin": "rot_cipher"},
        {"text_output": "AUTRE CHOSE", "confidence": 0.5, "plugin": "atbash"},
    ]

    deduped = plugin._deduplicate_results(results)

    assert len(deduped) == 2
    merged = next(r for r in deduped if r["text_output"] == "BONJOUR LE MONDE")
    # Le meilleur candidat (confiance 0.9) est conservé comme représentant
    assert merged["confidence"] == 0.9
    assert merged["plugin"] == "rot_cipher"
    # Provenance agrégée (ordre de rencontre)
    assert merged["source_plugins"] == ["caesar", "rot_cipher"]
    assert merged["duplicate_count"] == 2

    # Le résultat unique n'est pas annoté de provenance multiple
    unique = next(r for r in deduped if r["text_output"] == "AUTRE CHOSE")
    assert "source_plugins" not in unique
    assert "duplicate_count" not in unique


def test_dedup_normalizes_whitespace_but_not_case():
    plugin = MetaSolverPlugin()
    results = [
        {"text_output": "N 48 12.345", "confidence": 0.6, "plugin": "a"},
        {"text_output": "N  48   12.345 ", "confidence": 0.7, "plugin": "b"},
        {"text_output": "n 48 12.345", "confidence": 0.8, "plugin": "c"},  # casse différente
    ]

    deduped = plugin._deduplicate_results(results)

    # a et b fusionnent (espaces), c reste distinct (casse préservée)
    assert len(deduped) == 2
    merged = next(r for r in deduped if r["plugin"] == "b")
    assert merged["source_plugins"] == ["a", "b"]


def test_dedup_preserves_order_and_untextual_results():
    plugin = MetaSolverPlugin()
    results = [
        {"text_output": "FIRST", "confidence": 0.5, "plugin": "p1"},
        {"text_output": "", "confidence": 0.0, "plugin": "p2"},        # pas de texte
        {"text_output": None, "confidence": 0.0, "plugin": "p3"},      # pas de texte
        {"text_output": "FIRST", "confidence": 0.3, "plugin": "p4"},   # doublon de p1
    ]

    deduped = plugin._deduplicate_results(results)

    # p1(+p4 fusionné), p2, p3 => 3 entrées, ordre de première apparition préservé
    assert [r.get("plugin") for r in deduped] == ["p1", "p2", "p3"]
    first = deduped[0]
    assert first["confidence"] == 0.5  # p1 gardé (meilleure confiance que p4)
    assert first["source_plugins"] == ["p1", "p4"]


def test_dedup_empty_list():
    plugin = MetaSolverPlugin()
    assert plugin._deduplicate_results([]) == []
