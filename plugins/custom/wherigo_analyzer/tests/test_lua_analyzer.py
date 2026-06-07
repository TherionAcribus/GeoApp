"""Tests for the Lua analyzer module."""

from __future__ import annotations

import sys
from pathlib import Path

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from lua_analyzer import LuaAnalyzer


class TestLuaAnalyzer:
    """Test cases for LuaAnalyzer."""

    @classmethod
    def setup_class(cls):
        """Set up test fixtures."""
        cls.fixture_path = Path(__file__).resolve().parent / "fixtures" / "test_script.lua"
        cls.analyzer = LuaAnalyzer()

    def test_analyze_file_returns_result(self):
        """Test that analyze_file returns a valid result."""
        result = self.analyzer.analyze_file(self.fixture_path)
        assert result is not None
        assert result.source is not None

    def test_extracts_zones(self):
        """Test that zones are extracted from Lua."""
        result = self.analyzer.analyze_file(self.fixture_path)

        assert len(result.zones) > 0, "No zones found"

        zone = result.zones[0]
        assert zone.internal_name == "testZone"
        assert zone.id == "z_test"
        assert zone.name == "Test Zone"
        assert zone.visible is True
        assert zone.active is True

    def test_extracts_zone_coordinates(self):
        """Test that zone coordinates are extracted."""
        result = self.analyzer.analyze_file(self.fixture_path)

        zone = result.zones[0]
        assert zone.original_point.lat is not None
        assert zone.original_point.lon is not None
        assert abs(zone.original_point.lat - 48.8566) < 0.0001
        assert abs(zone.original_point.lon - 2.3522) < 0.0001

    def test_extracts_media(self):
        """Test that media objects are extracted."""
        result = self.analyzer.analyze_file(self.fixture_path)

        assert len(result.media) > 0, "No media found"

        media = result.media[0]
        assert media.internal_name == "testMedia"
        assert media.id == "m_test"
        assert media.name == "Test Image"

    def test_extracts_characters(self):
        """Test that characters are extracted."""
        result = self.analyzer.analyze_file(self.fixture_path)

        assert len(result.characters) > 0, "No characters found"

        char = result.characters[0]
        assert char.internal_name == "testCharacter"
        assert char.name == "Test Character"
        assert char.visible is True

    def test_extracts_items(self):
        """Test that items are extracted."""
        result = self.analyzer.analyze_file(self.fixture_path)

        assert len(result.items) > 0, "No items found"

        item = result.items[0]
        assert item.internal_name == "testItem"
        assert item.name == "Test Item"
        assert item.visible is False

    def test_extracts_tasks(self):
        """Test that tasks are extracted."""
        result = self.analyzer.analyze_file(self.fixture_path)

        assert len(result.tasks) > 0, "No tasks found"

        task = result.tasks[0]
        assert task.internal_name == "testTask"
        assert task.name == "Complete the test"

    def test_extracts_timers(self):
        """Test that timers are extracted."""
        result = self.analyzer.analyze_file(self.fixture_path)

        assert len(result.timers) > 0, "No timers found"

        timer = result.timers[0]
        assert timer.internal_name == "testTimer"
        assert timer.duration == 300

    def test_extracts_inputs(self):
        """Test that inputs are extracted."""
        result = self.analyzer.analyze_file(self.fixture_path)

        assert len(result.inputs) >= 2, "Expected at least 2 inputs"

        input_obj = result.inputs[0]
        assert input_obj.internal_name == "testInput"
        assert input_obj.name == "Enter the secret code"
        assert len(input_obj.choices) == 3
        assert "1234" in input_obj.choices

    def test_extracts_input_answers(self):
        """Test that probable answers are extracted from inputs."""
        result = self.analyzer.analyze_file(self.fixture_path)

        # Find the input with answers
        input_with_answers = None
        for inp in result.inputs:
            if inp.internal_name == "testInput":
                input_with_answers = inp
                break

        assert input_with_answers is not None
        assert len(input_with_answers.answers) > 0, "No answers found for input"

        # Check for the plain text answer
        plain_answer = None
        for ans in input_with_answers.answers:
            if ans.value == "1234":
                plain_answer = ans
                break

        assert plain_answer is not None
        assert plain_answer.method == "plain_text"
        assert plain_answer.confidence == "high"

    def test_extracts_nocase_answers(self):
        """Test that NoCaseEquals answers are detected."""
        result = self.analyzer.analyze_file(self.fixture_path)

        input_with_answers = None
        for inp in result.inputs:
            if inp.internal_name == "testInput":
                input_with_answers = inp
                break

        assert input_with_answers is not None

        nocase_answer = None
        for ans in input_with_answers.answers:
            if ans.value == "CODE":
                nocase_answer = ans
                break

        assert nocase_answer is not None
        assert nocase_answer.method == "nocase"

    def test_extracts_numeric_answers(self):
        """Test that numeric comparisons are detected."""
        result = self.analyzer.analyze_file(self.fixture_path)

        numeric_input = None
        for inp in result.inputs:
            if inp.internal_name == "testInputNumeric":
                numeric_input = inp
                break

        assert numeric_input is not None

        # Should have answer "4" from "input == 4"
        answer_4 = None
        for ans in numeric_input.answers:
            if ans.value == "4":
                answer_4 = ans
                break

        assert answer_4 is not None
        assert answer_4.method == "numeric"

    def test_extracts_messages(self):
        """Test that messages are extracted."""
        result = self.analyzer.analyze_file(self.fixture_path)

        assert len(result.messages) > 0, "No messages found"

        # Check for MessageBox
        messagebox_found = False
        for msg in result.messages:
            if msg.type == "messagebox":
                messagebox_found = True
                break

        assert messagebox_found, "No MessageBox found"

    def test_extracts_cartridge_metadata(self):
        """Test that cartridge metadata is extracted."""
        result = self.analyzer.analyze_file(self.fixture_path)

        assert result.cartridge is not None
        assert result.cartridge.name == "Test Wherigo Cartridge"
        assert result.cartridge.author == "Test Author"
        assert result.cartridge.version == "1.0.0"
        assert result.cartridge.completion_code == "TEST123COMPLETION"

    def test_geojson_generation(self):
        """Test that GeoJSON is generated correctly."""
        result = self.analyzer.analyze_file(self.fixture_path)
        geojson = result.to_geojson()

        assert geojson["type"] == "FeatureCollection"
        assert len(geojson["features"]) > 0

        feature = geojson["features"][0]
        assert feature["type"] == "Feature"
        assert feature["geometry"]["type"] == "Point"
        assert "coordinates" in feature["geometry"]
        assert "properties" in feature


if __name__ == "__main__":
    import pytest
    pytest.main([__file__, "-v"])
