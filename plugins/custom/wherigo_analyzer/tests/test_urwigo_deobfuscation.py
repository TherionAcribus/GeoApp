"""Tests for Urwigo deobfuscation and decoding."""

from __future__ import annotations

import sys
from pathlib import Path

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from lua_analyzer import LuaAnalyzer, UrwigoDecoder
from deobfuscation_utils import decode_lua_escapes, decode_lua_escapes_to_bytes
from deobfuscators import UrwigoDeobfuscator
from urwigo_hash import urwigo_hash


class TestLuaEscapeDecoding:
    """Test Lua escape sequence decoding (decimal, not octal)."""

    def test_decimal_escape_single_digit(self):
        """Lua \\ddd uses DECIMAL digits, not octal."""
        # \065 should be 'A' (decimal 65), not octal 065 (=53, '5')
        assert decode_lua_escapes("\\065") == "A"

    def test_decimal_escape_two_digits(self):
        """\\66 should be 'B' (decimal 66)."""
        assert decode_lua_escapes("\\66") == "B"

    def test_decimal_escape_three_digits(self):
        """\\097 should be 'a' (decimal 97)."""
        assert decode_lua_escapes("\\097") == "a"

    def test_decimal_escape_with_9(self):
        """\\019 is valid in Lua (decimal 19), invalid in octal (9 not octal digit)."""
        result = decode_lua_escapes("\\019")
        assert ord(result[0]) == 19

    def test_hex_escape(self):
        """\\x41 should be 'A'."""
        assert decode_lua_escapes("\\x41") == "A"

    def test_simple_escapes(self):
        """Test simple escape sequences."""
        assert decode_lua_escapes("\\n") == "\n"
        assert decode_lua_escapes("\\t") == "\t"
        assert decode_lua_escapes("\\r") == "\r"
        assert decode_lua_escapes("\\a") == "\x07"
        assert decode_lua_escapes("\\\\") == "\\"
        assert decode_lua_escapes('\\"') == '"'

    def test_mixed_escapes(self):
        """Test mixed escape sequences in a string."""
        result = decode_lua_escapes("Hello\\nWorld\\x21")
        assert result == "Hello\nWorld!"

    def test_bytes_preserves_high_bytes(self):
        """decode_lua_escapes_to_bytes should preserve bytes > 127."""
        result = decode_lua_escapes_to_bytes("\\200")
        assert result == bytes([200])

    def test_bytes_decimal_vs_octal(self):
        """\\022 in Lua is decimal 22 (0x16), not octal 022 (0x12)."""
        result = decode_lua_escapes_to_bytes("\\022")
        assert result == bytes([22])  # decimal 22, NOT 18 (octal)


class TestUrwigoDeobfuscator:
    """Test Urwigo deobfuscation with real cartridge patterns."""

    @classmethod
    def setup_class(cls):
        """Load the mozarts_salzburg fixture if available."""
        cls.fixture_path = Path(__file__).resolve().parent / "fixtures" / "mozarts_salzburg.lua"
        if cls.fixture_path.exists():
            cls.lua_content = cls.fixture_path.read_text(encoding='utf-8')
        else:
            cls.lua_content = None

    def test_finds_obfuscation_function(self):
        """Test that the obfuscation function is detected."""
        if not self.lua_content:
            return  # Skip if fixture not available
        deobf = UrwigoDeobfuscator()
        func_info = deobf._find_obfuscation_function(self.lua_content)
        assert func_info is not None
        func_name, dtable = func_info
        assert func_name == "_NsWY"
        assert len(dtable) == 127  # Standard Urwigo dtable size

    def test_decodes_strings_correctly(self):
        """Test that known strings are decoded correctly."""
        if not self.lua_content:
            return
        deobf = UrwigoDeobfuscator()
        deobf.deobfuscate(self.lua_content)
        # The dtable should be 127 bytes
        assert len(deobf.dtable) == 127

        # Decode a known string - "Salzburg Skyline" is the first media name
        # We need to find the encoded form in the original content
        import re
        call_pattern = re.compile(r'_NsWY\s*\(\s*"((?:\\[\s\S]|[^"\\])*)"\s*\)')
        matches = call_pattern.findall(self.lua_content)
        assert len(matches) > 0

        # Decode the first call
        encoded = matches[0]
        decoded_escapes = decode_lua_escapes(encoded)
        decoded = deobf._decode_urwigo_string(decoded_escapes)
        # The first _NsWY call in mozarts_salzburg decodes to "Salzburg Skyline"
        assert decoded == "Salzburg Skyline", f"Expected 'Salzburg Skyline', got '{decoded}'"

    def test_deobfuscate_replaces_calls(self):
        """Test that deobfuscate replaces encoded calls with decoded strings."""
        if not self.lua_content:
            return
        deobf = UrwigoDeobfuscator()
        result, report = deobf.deobfuscate(self.lua_content)
        assert report.function_name == "_NsWY"
        assert report.dtable_size == 127
        assert report.strings_decoded_by_function > 100  # Should decode many strings
        # The result should contain decoded text, not _NsWY calls
        assert "Salzburg Skyline" in result
        assert "Mozarts Geburtshaus" in result


class TestUrwigoHash:
    """Test Urwigo hash function."""

    def test_hash_known_values(self):
        """Test hash against known values from mozarts_salzburg."""
        # From the cartridge: hash 19552 = "FACE"
        assert urwigo_hash("FACE") == 19552
        # hash 33554 = "CIRCLE"
        assert urwigo_hash("CIRCLE") == 33554
        # hash 62856 = "Yes - it's OPEN"
        assert urwigo_hash("Yes - it's OPEN") == 62856

    def test_hash_lowercase(self):
        """Hash should lowercase by default."""
        assert urwigo_hash("FACE") == urwigo_hash("face")

    def test_hash_no_lowercase(self):
        """Hash without lowercasing."""
        assert urwigo_hash("FACE", lowercase=False) != urwigo_hash("face", lowercase=False)


class TestUrwigoAnalyzerIntegration:
    """Integration tests with the full analyzer on Urwigo-style cartridges."""

    @classmethod
    def setup_class(cls):
        cls.analyzer = LuaAnalyzer()
        cls.mozart_path = Path(__file__).resolve().parent / "fixtures" / "mozarts_salzburg.lua"
        cls.ilove_path = Path(__file__).resolve().parent / "fixtures" / "i_love_salzburg.lua"

    def test_mozarts_salzburg_zones(self):
        """Test zone extraction from mozarts_salzburg."""
        if not self.mozart_path.exists():
            return
        result = self.analyzer.analyze_file(self.mozart_path)
        assert len(result.zones) == 11
        # Check that zone names are decoded (not garbled)
        zone_names = [z.name for z in result.zones if z.name]
        assert len(zone_names) == 11
        # All names should be readable (contain mostly ASCII letters)
        for name in zone_names:
            assert name and len(name) > 2
            # Should not contain control characters
            assert all(ord(c) >= 32 for c in name)

    def test_mozarts_salzburg_inputs(self):
        """Test input extraction from mozarts_salzburg."""
        if not self.mozart_path.exists():
            return
        result = self.analyzer.analyze_file(self.mozart_path)
        assert len(result.inputs) == 8
        # Check that input names are decoded
        inp = result.inputs[0]
        assert inp.name == "Brunnenfrage"
        assert "ELEFANT" in inp.choices
        assert "FACE" in inp.choices
        assert "COLLUMN" in inp.choices

    def test_mozarts_salzburg_hashed_answers_matched(self):
        """Test that hashed answers are matched against choices."""
        if not self.mozart_path.exists():
            return
        result = self.analyzer.analyze_file(self.mozart_path)
        # Find the input with FACE answer
        face_input = None
        for inp in result.inputs:
            for ans in inp.answers:
                if ans.value == "FACE":
                    face_input = inp
                    break
        assert face_input is not None
        # Verify the answer method
        face_answer = None
        for ans in face_input.answers:
            if ans.value == "FACE":
                face_answer = ans
                break
        assert face_answer is not None
        assert face_answer.method == "urwigo_hash_matched_choice"
        assert face_answer.confidence == "high"

    def test_mozarts_salzburg_choices_with_apostrophe(self):
        """Test that choices with apostrophes are parsed correctly."""
        if not self.mozart_path.exists():
            return
        result = self.analyzer.analyze_file(self.mozart_path)
        # Find the input with "Yes - it's OPEN" choice
        for inp in result.inputs:
            if "Yes - it's OPEN" in inp.choices:
                return
        assert False, "Could not find 'Yes - it's OPEN' in any input choices"

    def test_i_love_salzburg_zones(self):
        """Test zone extraction from i_love_salzburg."""
        if not self.ilove_path.exists():
            return
        result = self.analyzer.analyze_file(self.ilove_path)
        assert len(result.zones) == 41
        # Check that zone names are decoded
        zone_names = [z.name for z in result.zones if z.name]
        assert len(zone_names) == 41
        # Check for known decoded names
        all_names = " ".join(zone_names)
        assert "Final" in all_names or "Final Koordinaten" in all_names
        assert "Mozarteum" in all_names

    def test_i_love_salzburg_media(self):
        """Test media extraction from i_love_salzburg."""
        if not self.ilove_path.exists():
            return
        result = self.analyzer.analyze_file(self.ilove_path)
        assert len(result.media) == 43
        # Media names should be decoded
        for m in result.media[:5]:
            assert m.name and len(m.name) > 2

    def test_deobfuscation_report(self):
        """Test that the deobfuscation report is correct."""
        if not self.mozart_path.exists():
            return
        result = self.analyzer.analyze_file(self.mozart_path)
        report = result.deobfuscation_report
        assert report["function_name"] == "_NsWY"
        assert report["dtable_size"] == 127
        assert report["strings_decoded_by_function"] > 100


if __name__ == "__main__":
    import pytest
    pytest.main([__file__, "-v"])
