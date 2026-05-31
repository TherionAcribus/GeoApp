import importlib.util
from pathlib import Path


def load_plugin_module():
    root = Path(__file__).resolve().parents[2]
    plugin_path = root / "plugins" / "official" / "cistercian_numerals" / "main.py"
    spec = importlib.util.spec_from_file_location("cistercian_numerals", plugin_path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_cistercian_encode_single_value():
    module = load_plugin_module()
    plugin = module.CistercianNumeralsPlugin()

    result = plugin.execute({"mode": "encode", "text": "1492"})

    assert result["status"] == "ok"
    assert result["results"][0]["text_output"] == "1492"
    assert result["results"][0]["metadata"]["digits"] == {
        "thousands": 1,
        "hundreds": 4,
        "tens": 9,
        "units": 2,
    }
    assert "<svg" in result["results"][0]["metadata"]["svg"]


def test_cistercian_decode_quadrants():
    module = load_plugin_module()
    plugin = module.CistercianNumeralsPlugin()

    result = plugin.execute({
        "mode": "decode",
        "thousands": "1",
        "hundreds": "4",
        "tens": "9",
        "units": "2",
    })

    assert result["status"] == "ok"
    assert result["results"][0]["text_output"] == "1492"


def test_cistercian_rejects_missing_encode_input():
    module = load_plugin_module()
    plugin = module.CistercianNumeralsPlugin()

    result = plugin.execute({"mode": "encode", "text": ""})

    assert result["status"] == "error"
    assert result["results"] == []
