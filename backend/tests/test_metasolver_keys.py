import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from plugins.official.metasolver.main import MetaSolverPlugin


def test_metasolver_forwards_generic_key_to_key_and_candidate_keys():
    plugin = MetaSolverPlugin()
    key_entries = plugin._parse_key_entries({
        "metasolver_keys": [
            {"field": "key", "value": "SECRET"},
            {"field": "candidate_keys", "value": "CACHE, CODE"},
        ]
    })

    extras = plugin._build_key_inputs_for_plugin(
        input_types={
            "key": {"type": "string"},
            "candidate_keys": {"type": "string"},
        },
        key_entries=key_entries,
        plugin_name="vigenere_cipher",
    )

    assert extras["key"] == "SECRET"
    assert extras["candidate_keys"] == "CACHE, CODE, SECRET"
    assert extras["bruteforce"] is True


def test_metasolver_preserves_explicit_keyword_over_generic_key():
    plugin = MetaSolverPlugin()
    key_entries = plugin._parse_key_entries({
        "metasolver_keys": [
            {"field": "key", "value": "SECRET"},
            {"field": "keyword", "value": "UBER"},
        ]
    })

    extras = plugin._build_key_inputs_for_plugin(
        input_types={"keyword": {"type": "string"}},
        key_entries=key_entries,
        plugin_name="ubchi_cipher",
    )

    assert extras["keyword"] == "UBER"


def test_metasolver_key_entries_can_target_one_plugin():
    plugin = MetaSolverPlugin()
    key_entries = plugin._parse_key_entries({
        "metasolver_keys": [
            {"field": "key", "value": "SECRET", "plugin": "vigenere_cipher"},
        ]
    })

    vigenere_extras = plugin._build_key_inputs_for_plugin(
        input_types={"key": {"type": "string"}},
        key_entries=key_entries,
        plugin_name="vigenere_cipher",
    )
    beaufort_extras = plugin._build_key_inputs_for_plugin(
        input_types={"key": {"type": "string"}},
        key_entries=key_entries,
        plugin_name="beaufort_cipher",
    )

    assert vigenere_extras["key"] == "SECRET"
    assert beaufort_extras == {}
