"""Tests for the official coordinate converter plugins."""

from pathlib import Path

from gc_backend.plugins.wrappers import PluginMetadata, PluginType, PythonPluginWrapper


PLUGIN_ROOT = Path(__file__).parent.parent.parent / "plugins" / "official"


def run_plugin(name: str, inputs: dict) -> dict:
    plugin_dir = PLUGIN_ROOT / name
    metadata = PluginMetadata(
        name=name,
        version="1.0.0",
        plugin_type=PluginType.PYTHON,
        entry_point="main.py",
        path=str(plugin_dir),
        timeout_seconds=30,
    )
    wrapper = PythonPluginWrapper(metadata)
    assert wrapper.initialize() is True
    return wrapper.execute(inputs)


def assert_plugin_coordinate_result(result):
    assert result["status"] == "ok"
    assert result["results"]
    first = result["results"][0]
    assert first["decimal_latitude"] is not None
    assert first["decimal_longitude"] is not None
    assert first["coordinates"]["exist"] is True


def test_coordinate_format_converter_plugin():
    result = run_plugin(
        "coordinate_format_converter",
        {
            "input_text": "48.85837, 2.294481",
            "source_format": "dd",
            "target_format": "all",
        },
    )
    assert_plugin_coordinate_result(result)
    assert "ddm" in result["results"][0]["formats"]


def test_coordinate_grid_converter_plugin():
    result = run_plugin(
        "coordinate_grid_converter",
        {
            "input_text": "48.85837, 2.294481",
            "source_format": "dd",
            "target_format": "mgrs",
        },
    )
    assert_plugin_coordinate_result(result)
    assert "mgrs" in result["results"][0]["formats"]


def test_coordinate_grid_converter_accepts_long_compact_mgrs():
    result = run_plugin(
        "coordinate_grid_converter",
        {
            "input_text": "31UDQ48251846741193823573",
            "source_format": "auto",
            "target_format": "all",
        },
    )
    assert_plugin_coordinate_result(result)
    assert result["results"][0]["parameters"]["source_format"] == "mgrs"


def test_coordinate_code_converter_plugin():
    result = run_plugin(
        "coordinate_code_converter",
        {
            "input_text": "48.85837, 2.294481",
            "source_format": "dd",
            "target_format": "geohash",
        },
    )
    assert_plugin_coordinate_result(result)
    assert result["results"][0]["formats"]["geohash"].startswith("u09tun")


def test_coordinate_code_converter_accepts_geohash_input_and_geocaching_output():
    result = run_plugin(
        "coordinate_code_converter",
        {
            "input_text": "u09tunqu5",
            "source_format": "auto",
            "target_format": "geocaching",
        },
    )
    assert_plugin_coordinate_result(result)
    first = result["results"][0]
    assert first["parameters"]["source_format"] == "geohash"
    assert first["text_output"].startswith("N 48")


def test_coordinate_converter_plugin_error_is_clean():
    result = run_plugin(
        "coordinate_format_converter",
        {
            "input_text": "not coordinates",
            "source_format": "auto",
            "target_format": "all",
        },
    )
    assert result["status"] == "error"
    assert result["summary"]


def test_coordinates_finder_returns_multiple_coordinate_results():
    result = run_plugin(
        "coordinates_finder",
        {
            "text": (
                "Coordonnees: N 48° 51.502 E 002° 17.669. "
                "Autres indices: geohash u09tunqu5 et mapcode FRA 4J.Q3."
            ),
            "max_results": 10,
        },
    )
    assert result["status"] == "success"
    assert result["primary_coordinates"]
    assert len(result["results"]) >= 3
    formats = {item["coordinates"].get("source_format") for item in result["results"]}
    assert "geohash" in formats
    assert "mapcode" in formats


def test_coordinate_special_converter_plugin():
    result = run_plugin(
        "coordinate_special_converter",
        {
            "input_text": "48.85837, 2.294481",
            "source_format": "dd",
            "target_format": "all",
            "precision": 10,
            "zoom": 15,
        },
    )
    assert_plugin_coordinate_result(result)
    formats = result["results"][0]["formats"]
    assert {"gars", "qth", "slippy", "quadkey", "nac", "rd", "lambert_93", "lambert_72"}.issubset(formats)


def test_coordinate_special_converter_decodes_qth_to_geocaching():
    result = run_plugin(
        "coordinate_special_converter",
        {
            "input_text": "JN18DU",
            "source_format": "qth",
            "target_format": "geocaching",
        },
    )
    assert_plugin_coordinate_result(result)
    assert result["results"][0]["text_output"].startswith("N ")
