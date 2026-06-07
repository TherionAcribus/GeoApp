"""Integration tests for the Wherigo Analyzer plugin."""

from __future__ import annotations

import sys
from pathlib import Path

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from main import WherigoAnalyzerPlugin


class TestWherigoAnalyzerPlugin:
    """Test cases for the main plugin."""

    @classmethod
    def setup_class(cls):
        """Set up test fixtures."""
        cls.fixture_path = Path(__file__).resolve().parent / "fixtures"
        cls.lua_path = cls.fixture_path / "test_script.lua"
        cls.plugin = WherigoAnalyzerPlugin()

    def test_plugin_initialization(self):
        """Test that plugin initializes correctly."""
        assert self.plugin.name == "wherigo_analyzer"
        assert self.plugin.version == "1.0.0"

    def test_execute_with_lua_file(self):
        """Test execution with a Lua file."""
        inputs = {
            "file_path": str(self.lua_path),
            "analyze_mode": "lua"
        }

        result = self.plugin.execute(inputs)

        assert result["status"] in ["ok", "partial"]
        assert "wherigo_data" in result
        assert "results" in result

    def test_execute_returns_zones(self):
        """Test that execution returns zones data."""
        inputs = {
            "file_path": str(self.lua_path),
        }

        result = self.plugin.execute(inputs)
        wherigo_data = result["wherigo_data"]

        assert "zones" in wherigo_data
        assert len(wherigo_data["zones"]) > 0

    def test_execute_returns_inputs(self):
        """Test that execution returns inputs data."""
        inputs = {
            "file_path": str(self.lua_path),
        }

        result = self.plugin.execute(inputs)
        wherigo_data = result["wherigo_data"]

        assert "inputs" in wherigo_data
        assert len(wherigo_data["inputs"]) >= 2

    def test_execute_returns_geojson(self):
        """Test that execution returns GeoJSON."""
        inputs = {
            "file_path": str(self.lua_path),
        }

        result = self.plugin.execute(inputs)
        wherigo_data = result["wherigo_data"]

        assert "geojson" in wherigo_data
        assert wherigo_data["geojson"]["type"] == "FeatureCollection"

    def test_execute_returns_cartridge_info(self):
        """Test that execution returns cartridge metadata."""
        inputs = {
            "file_path": str(self.lua_path),
        }

        result = self.plugin.execute(inputs)
        wherigo_data = result["wherigo_data"]

        assert "cartridge" in wherigo_data
        assert wherigo_data["cartridge"]["name"] == "Test Wherigo Cartridge"

    def test_execute_with_missing_file(self):
        """Test error handling for missing file."""
        inputs = {
            "file_path": "/nonexistent/file.lua",
        }

        result = self.plugin.execute(inputs)

        assert result["status"] == "error"
        assert "wherigo_data" in result

    def test_execute_without_inputs(self):
        """Test error handling when no inputs provided."""
        inputs = {}

        result = self.plugin.execute(inputs)

        assert result["status"] == "error"

    def test_plugin_info_in_result(self):
        """Test that plugin info is included in result."""
        inputs = {
            "file_path": str(self.lua_path),
        }

        result = self.plugin.execute(inputs)

        assert "plugin_info" in result
        assert result["plugin_info"]["name"] == "wherigo_analyzer"
        assert "execution_time_ms" in result["plugin_info"]

    def test_summary_generation(self):
        """Test that summary is generated correctly."""
        inputs = {
            "file_path": str(self.lua_path),
        }

        result = self.plugin.execute(inputs)

        assert "summary" in result
        summary = result["summary"]
        assert "zone" in summary.lower()
        assert "input" in summary.lower()


if __name__ == "__main__":
    import pytest
    pytest.main([__file__, "-v"])
