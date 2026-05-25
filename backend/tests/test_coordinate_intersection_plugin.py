"""Tests for the official plugin: coordinate_intersection."""

from pathlib import Path

from gc_backend.plugins.wrappers import PluginMetadata, PluginType, PythonPluginWrapper


def _wrapper() -> PythonPluginWrapper:
    plugin_dir = (
        Path(__file__).parent.parent.parent
        / "plugins"
        / "official"
        / "coordinate_intersection"
    )

    metadata = PluginMetadata(
        name="coordinate_intersection",
        version="1.0.0",
        plugin_type=PluginType.PYTHON,
        entry_point="main.py",
        path=str(plugin_dir),
        timeout_seconds=30,
    )

    wrapper = PythonPluginWrapper(metadata)
    assert wrapper.initialize() is True
    return wrapper


def test_coordinate_intersection_strict_mode_accepts_shared_converter_formats():
    """Strict mode should accept non-DDM formats via the shared converter."""

    result = _wrapper().execute(
        {
            "strict": "strict",
            "coord1": "u09tunqu5",
            "coord2": "48.85837, 2.304481",
            "dist1": 500,
            "dist1_unit": "m",
            "dist2": 500,
            "dist2_unit": "m",
            "enable_gps_detection": False,
        }
    )

    assert result["status"] == "ok"
    assert len(result["results"]) == 2
    assert result["results"][0]["decimal_latitude"] is not None
    assert result["results"][0]["decimal_longitude"] is not None


def test_coordinate_intersection_smooth_mode_accepts_shared_converter_formats():
    """Smooth mode should parse converter-supported coordinates in parentheses."""

    result = _wrapper().execute(
        {
            "strict": "smooth",
            "text": (
                "500 m from GC12 (u09tunqu5) and "
                "500 m from GC13 (48.85837, 2.304481)"
            ),
            "enable_gps_detection": False,
        }
    )

    assert result["status"] == "ok"
    assert len(result["results"]) == 2
