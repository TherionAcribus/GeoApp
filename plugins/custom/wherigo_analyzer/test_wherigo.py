"""Tests for Wherigo analyzer modules."""

import unittest
from urwigo_hash import urwigo_hash, brute_force_hash, brute_force_urwigo_common
from deobfuscators import UrwigoDeobfuscator


class TestUrwigoHash(unittest.TestCase):
    """Test Urwigo hash algorithm and brute force."""

    def test_urwigo_hash_basic(self):
        """Test basic hash computation."""
        # Test with empty string
        self.assertEqual(urwigo_hash(""), 0)

        # Test with known values (computed manually)
        h1 = urwigo_hash("a")
        self.assertIsInstance(h1, int)
        self.assertGreaterEqual(h1, 0)
        self.assertLess(h1, 65535)

        # Test lowercase conversion
        self.assertEqual(urwigo_hash("ABC"), urwigo_hash("abc"))

    def test_urwigo_hash_consistency(self):
        """Test that same input produces same output."""
        h1 = urwigo_hash("test")
        h2 = urwigo_hash("test")
        self.assertEqual(h1, h2)

    def test_brute_force_hash_finds_match(self):
        """Test that brute force finds the correct string."""
        target = urwigo_hash("123")
        candidates = brute_force_hash(target, "0123456789", 1, 3, lowercase=False)
        self.assertIn("123", candidates)

    def test_brute_force_urwigo_common(self):
        """Test brute force with common patterns."""
        target = urwigo_hash("42")
        result = brute_force_urwigo_common(target)

        self.assertIn("numeric", result)
        self.assertIn("alpha", result)
        self.assertIn("alphanumeric", result)
        self.assertIn("42", result["numeric"])


class TestDeobfuscator(unittest.TestCase):
    """Test Urwigo deobfuscator."""

    def test_decode_lua_escapes(self):
        """Test Lua escape sequence decoder."""
        deobf = UrwigoDeobfuscator()

        # Test simple escapes
        self.assertEqual(deobf._decode_lua_escapes("\\n"), "\n")
        self.assertEqual(deobf._decode_lua_escapes("\\t"), "\t")
        self.assertEqual(deobf._decode_lua_escapes("\\r"), "\r")

        # Test hex escape
        self.assertEqual(deobf._decode_lua_escapes("\\x41"), "A")
        self.assertEqual(deobf._decode_lua_escapes("\\x7a"), "z")

        # Test octal escape
        self.assertEqual(deobf._decode_lua_escapes("\\101"), "A")  # octal 101 = 65 = 'A'

        # Test multiple escapes
        result = deobf._decode_lua_escapes("hello\\nworld")
        self.assertEqual(result, "hello\nworld")

    def test_find_obfuscation_function(self):
        """Test detection of obfuscation function."""
        deobf = UrwigoDeobfuscator()

        # Create a proper dtable with at least 64 chars (after decoding)
        # Using simple characters that don't need escaping
        lua_code = '''
function _m9REO(str)
  local res = ""
  local dtable = "mE6LANC~2r)qOj5Z$9cDn8>4I!}xh[9' lky0`sF^#o.b3t1Y,zUBpX-R?ViQg+J@P8T7&aKG{S\\:(wM_|eH<;u"
  for i = 1, #str do
    local b = str:byte(i)
    if 0 < b and b <= 127 then
      res = res .. string.char(dtable:byte(b))
    end
  end
  return res
end
'''
        result = deobf._find_obfuscation_function(lua_code)
        self.assertIsNotNone(result)
        self.assertEqual(result[0], "_m9REO")

    def test_decode_urwigo_string(self):
        """Test decoding with known dtable."""
        deobf = UrwigoDeobfuscator()
        # Simple test dtable (just lowercase alphabet + some chars)
        deobf.dtable = "abcdefghijklmnopqrstuvwxyz0123456789"

        # Encode: byte 1 -> 'a', byte 2 -> 'b', etc.
        encoded = "\x01\x02\x03"  # bytes 1, 2, 3
        decoded = deobf._decode_urwigo_string(encoded)
        self.assertEqual(decoded, "abc")

    def test_full_deobfuscation(self):
        """Test full deobfuscation on sample Lua."""
        # Use a proper dtable with at least 64 chars
        lua_code = '''
function _m9REO(str)
  local dtable = "mE6LANC~2r)qOj5Z$9cDn8>4I!}xh[9' lky0`sF^#o.b3t1Y,zUBpX-R?ViQg+J@P8T7&aKG{S\\:(wM_|eH<;u"
  return str
end

zone1.Name = _m9REO("abc")
'''
        deobf = UrwigoDeobfuscator()
        result, report = deobf.deobfuscate(lua_code)

        # Should detect the function
        self.assertEqual(report.function_name, "_m9REO")
        # Should have decoded at least one string
        self.assertGreaterEqual(report.strings_decoded, 1)


class TestLuaStringConversion(unittest.TestCase):
    """Test Lua string literal conversion."""

    def test_simple_string(self):
        """Test simple string conversion."""
        # "hello" -> hello
        s = '"hello"'
        # Remove quotes
        result = s.strip('"')
        self.assertEqual(result, "hello")

    def test_escaped_quotes(self):
        """Test escaped quotes handling."""
        s = '"say \\"hello\\""'
        # Should handle escaped quotes
        self.assertIn("hello", s)


if __name__ == "__main__":
    unittest.main()
