"""Tests unitaires de la base facultative `CipherPluginBase`."""

from __future__ import annotations

import time

import pytest

import gc_backend.plugins.base as base_module
from gc_backend.plugins.base import (
    CipherPluginBase,
    ModeParams,
    is_alpha_strict,
    normalize_allowed_chars,
    parse_bool,
    remove_diacritics,
)


class _MiniPlugin(CipherPluginBase):
    """Plugin minimal pour les tests de bout en bout."""

    def __init__(self) -> None:
        super().__init__()
        self.name = "mini"
        self.version = "9.9.9"

    def execute(self, inputs):
        start_time = time.time()
        text = self._text(inputs)
        if not text:
            return self._error_response("Aucun texte fourni", start_time)
        mode = self._mode_params(inputs).mode
        if mode == "encode":
            output = text.upper()
        elif mode == "decode":
            output = text.lower()
        else:
            return self._error_response(f"Mode inconnu: {mode}", start_time)
        result = self._make_result(
            text_output=output,
            confidence=1.0,
            parameters={"mode": mode},
        )
        return self._ok_response([result], summary="OK", start_time=start_time)


@pytest.fixture
def plugin() -> CipherPluginBase:
    return CipherPluginBase()


# --- _get_plugin_info ----------------------------------------------------


def test_get_plugin_info_without_start_time(plugin):
    info = plugin._get_plugin_info()
    assert info == {"name": "plugin", "version": "1.0.0", "execution_time_ms": 0.0}


def test_get_plugin_info_with_start_time(plugin):
    info = plugin._get_plugin_info(time.time() - 0.01)
    assert info["name"] == "plugin"
    assert info["version"] == "1.0.0"
    assert info["execution_time_ms"] >= 0.0


# --- _ok_response ---------------------------------------------------------


def test_ok_response_default_summary(plugin):
    results = [{"id": "result_1", "confidence": 1.0}]
    response = plugin._ok_response(results)
    assert response["status"] == "ok"
    assert response["summary"] == "1 résultat(s) généré(s)"
    assert response["results"] is results
    assert response["plugin_info"]["execution_time_ms"] == 0.0


def test_ok_response_explicit_summary(plugin):
    response = plugin._ok_response([], summary="Custom", start_time=time.time())
    assert response["summary"] == "Custom"
    assert response["results"] == []


# --- _error_response ------------------------------------------------------


def test_error_response_shape(plugin):
    response = plugin._error_response("Oups")
    assert response["status"] == "error"
    assert response["summary"] == "Oups"
    assert response["results"] == []
    assert response["plugin_info"]["name"] == "plugin"
    assert response["plugin_info"]["execution_time_ms"] == 0.0


def test_error_response_with_start_time(plugin):
    response = plugin._error_response("Oups", start_time=time.time())
    assert response["plugin_info"]["execution_time_ms"] >= 0.0


# --- _make_result ---------------------------------------------------------


def test_make_result_minimal(plugin):
    result = plugin._make_result()
    assert result == {"id": "result_1", "confidence": 0.0}
    assert "text_output" not in result
    assert "parameters" not in result
    assert "metadata" not in result


def test_make_result_full_and_extra(plugin):
    result = plugin._make_result(
        text_output="ABC",
        confidence=0.7,
        parameters={"mode": "decode"},
        metadata={"processed_chars": 3},
        result_id="result_42",
        scoring={"score": 0.7},
    )
    assert result["id"] == "result_42"
    assert result["text_output"] == "ABC"
    assert result["confidence"] == 0.7
    assert result["parameters"] == {"mode": "decode"}
    assert result["metadata"] == {"processed_chars": 3}
    assert result["scoring"] == {"score": 0.7}


# --- _text / _mode_params ---------------------------------------------------


def test_text_returns_str_or_default(plugin):
    assert plugin._text({"text": "HELLO"}) == "HELLO"
    assert plugin._text({"text": 123}) == ""
    assert plugin._text({"text": None}) == ""
    assert plugin._text({}) == ""
    assert plugin._text({"text": 123}, default="fallback") == "fallback"
    assert plugin._text({"other": "X"}, field="other") == "X"


def test_mode_params_real_inputs(plugin):
    params = plugin._mode_params(
        {"mode": "Encode", "strict": "strict", "embedded": "1"}
    )
    assert isinstance(params, ModeParams)
    assert params.mode == "encode"
    assert params.strict is True
    assert params.embedded is True
    assert params.allowed_chars


# --- _score_fast ------------------------------------------------------------


def test_score_fast_returns_default_when_unavailable(plugin, monkeypatch):
    monkeypatch.setattr(base_module, "_SCORING_AVAILABLE", False)
    assert plugin._score_fast("HELLO WORLD") == 0.5
    assert plugin._score_fast("HELLO WORLD", default=0.3) == 0.3


def test_score_fast_returns_default_on_exception(plugin, monkeypatch):
    monkeypatch.setattr(base_module, "_SCORING_AVAILABLE", True)
    monkeypatch.setattr(
        base_module,
        "_score_text_fast",
        lambda _text: (_ for _ in ()).throw(RuntimeError("boom")),
    )
    assert plugin._score_fast("HELLO WORLD", default=0.42) == 0.42


def test_score_fast_delegates_when_available(plugin, monkeypatch):
    monkeypatch.setattr(base_module, "_SCORING_AVAILABLE", True)
    monkeypatch.setattr(base_module, "_score_text_fast", lambda _text: 0.77)
    assert plugin._score_fast("HELLO WORLD") == 0.77


# --- Re-exports -------------------------------------------------------------


def test_code_solving_reexports():
    assert parse_bool("strict") is True
    assert remove_diacritics("éèê") == "eee"
    assert is_alpha_strict("ABC", "") == (True, "")
    assert normalize_allowed_chars(" ")


# --- Plugin manager + end-to-end -------------------------------------------


def test_set_plugin_manager(plugin):
    assert plugin.plugin_manager is None
    sentinel = object()
    plugin.set_plugin_manager(sentinel)
    assert plugin.plugin_manager is sentinel


def test_mini_plugin_end_to_end():
    plugin = _MiniPlugin()

    encoded = plugin.execute({"text": "hello", "mode": "encode"})
    assert encoded["status"] == "ok"
    assert encoded["results"][0]["text_output"] == "HELLO"
    assert encoded["plugin_info"]["name"] == "mini"
    assert encoded["plugin_info"]["version"] == "9.9.9"

    decoded = plugin.execute({"text": "HELLO", "mode": "decode"})
    assert decoded["results"][0]["text_output"] == "hello"

    error = plugin.execute({"text": "", "mode": "encode"})
    assert error["status"] == "error"
    assert error["results"] == []
