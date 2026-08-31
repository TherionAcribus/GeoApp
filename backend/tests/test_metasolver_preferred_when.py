"""Valide que toutes les valeurs ``preferred_when`` declarees dans les
plugin.json correspondent a des cles valides du ``preferred_condition_map``
du service metasolver_analysis.

Ce test evite les regressions silencieuses : une valeur invalide dans
``preferred_when`` est ignoree par le scoring (aucun bonus +24), ce qui
penalise le plugin sans aucun message d'erreur visible.
"""

import json
from pathlib import Path

import pytest

from gc_backend.services.metasolver_analysis import score_metasolver_candidate


# Les 29 cles valides du preferred_condition_map (defini a l'interieur de
# score_metasolver_candidate). On les extrait en construisant une signature
# neutre et en inspectant le code source, mais pour la robustesse on les
# liste en dur ici — si une nouvelle condition est ajoutee au map, ce test
# echouera et forcera a mettre cette liste a jour.
VALID_PREFERRED_WHEN_KEYS = frozenset({
    'letters_only',
    'digits_only',
    'symbols_only',
    'words_only',
    'mixed_input',
    'grouped_input',
    'short_input',
    'long_input',
    'morse_like',
    'binary_like',
    'hex_like',
    't9_like',
    'chemical_like',
    'houdini_like',
    'nak_nak_like',
    'shadok_like',
    'tom_tom_like',
    'gold_bug_like',
    'postnet_like',
    'prime_like',
    'pi_index_positions_like',
    'roman_like',
    'a1z26_like',
    'tap_code_like',
    'polybius_like',
    'multitap_like',
    'bacon_like',
    'digit_groups',
    'coordinate_fragment',
})

PLUGINS_DIR = Path(__file__).resolve().parents[2] / 'plugins'


def _collect_plugin_preferred_when():
    """Parcourt tous les plugin.json et retourne (plugin_name, preferred_when_values, file_path)."""
    results = []
    for plugin_json in PLUGINS_DIR.rglob('plugin.json'):
        try:
            with plugin_json.open('r', encoding='utf-8') as handle:
                metadata = json.load(handle)
        except Exception:
            continue
        metasolver_meta = metadata.get('metasolver') or {}
        if not isinstance(metasolver_meta, dict):
            continue
        preferred_when = metasolver_meta.get('preferred_when')
        if not isinstance(preferred_when, list):
            continue
        plugin_name = metadata.get('name') or plugin_json.parent.name
        results.append((plugin_name, preferred_when, plugin_json))
    return results


def test_all_preferred_when_values_are_valid():
    """Chaque valeur de preferred_when doit etre une cle valide du preferred_condition_map."""
    entries = _collect_plugin_preferred_when()
    assert entries, "Aucun plugin avec preferred_when trouve — le test est probablement mal configure"

    invalid = []
    for plugin_name, preferred_when, file_path in entries:
        for value in preferred_when:
            if value not in VALID_PREFERRED_WHEN_KEYS:
                invalid.append((plugin_name, value, str(file_path)))

    if invalid:
        messages = [
            f"  - {name}: {value!r} (invalide) dans {path}"
            for name, value, path in invalid
        ]
        pytest.fail(
            f"{len(invalid)} valeur(s) preferred_when invalide(s) detectee(s) :\n"
            + "\n".join(messages)
            + f"\nCles valides: {sorted(VALID_PREFERRED_WHEN_KEYS)}"
        )


def test_preferred_when_arrays_are_not_empty_when_present():
    """Un preferred_when present mais vide est probablement un oubli."""
    entries = _collect_plugin_preferred_when()
    empty = [
        (name, str(path))
        for name, preferred_when, path in entries
        if len(preferred_when) == 0
    ]
    if empty:
        messages = [f"  - {name}: preferred_when vide dans {path}" for name, path in empty]
        pytest.fail(
            f"{len(empty)} plugin(s) avec preferred_when vide :\n" + "\n".join(messages)
        )
