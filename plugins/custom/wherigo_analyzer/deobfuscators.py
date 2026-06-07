"""Deobfuscation for Wherigo Lua scripts.

Detects and reverses obfuscation patterns from Urwigo and Earwigo tools.
Pure text parsing - never executes Lua code.
"""

from __future__ import annotations

import re
from typing import List, Dict, Any, Optional, Tuple
from dataclasses import dataclass, field


@dataclass
class DeobfuscationResult:
    """Result of deobfuscation detection."""
    detected: List[str] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)
    obfuscated_strings: List[Dict[str, Any]] = field(default_factory=list)


def detect_obfuscation(lua_content: str) -> DeobfuscationResult:
    """
    Detect obfuscation patterns in Lua content.

    Returns:
        DeobfuscationResult with detection info and warnings
    """
    result = DeobfuscationResult()

    # Check for Urwigo patterns
    if _detect_urwigo(lua_content):
        result.detected.append("urwigo")
        result.warnings.append("Urwigo obfuscation detected. Full deobfuscation not yet implemented.")

    # Check for Earwigo patterns
    if _detect_earwigo(lua_content):
        result.detected.append("earwigo")
        result.warnings.append("Earwigo patterns detected.")

    # Check for string table obfuscation
    obfuscated = _detect_string_table_obfuscation(lua_content)
    if obfuscated:
        result.obfuscated_strings = obfuscated
        result.warnings.append(f"Detected {len(obfuscated)} potentially obfuscated string references.")

    # Check for encoded function names
    if _detect_encoded_functions(lua_content):
        result.detected.append("encoded_functions")
        result.warnings.append("Encoded function names detected - may indicate obfuscation.")

    return result


def _detect_urwigo(lua_content: str) -> bool:
    """Detect Urwigo obfuscation patterns."""
    # Urwigo-specific patterns
    urwigo_patterns = [
        r'\b_urwigo_\w+\b',
        r'\burwigo\s*=\s*\{',
        r'\bUrwigo\b',
        r'function\s+\w+_decode\s*\(',
        r'function\s+\w+_deobfuscate\s*\(',
    ]

    for pattern in urwigo_patterns:
        if re.search(pattern, lua_content, re.IGNORECASE):
            return True

    return False


def _detect_earwigo(lua_content: str) -> bool:
    """Detect Earwigo-specific patterns."""
    earwigo_patterns = [
        r'\bEarwigo\b',
        r'\b_earwigo_\w+\b',
    ]

    for pattern in earwigo_patterns:
        if re.search(pattern, lua_content, re.IGNORECASE):
            return True

    return False


def _detect_string_table_obfuscation(lua_content: str) -> List[Dict[str, Any]]:
    """Detect string table obfuscation patterns."""
    obfuscated = []

    # Pattern: table lookups for strings like _G["\x41\x42\x43"]
    hex_string_pattern = re.compile(r'\[(?:["\'])((?:\\x[0-9a-fA-F]{2})+)(?:["\'])\]')

    for match in hex_string_pattern.finditer(lua_content):
        hex_str = match.group(1)
        try:
            # Try to decode hex string
            decoded = bytes.fromhex(hex_str.replace('\\x', '')).decode('latin-1')
            obfuscated.append({
                "type": "hex_encoded",
                "encoded": hex_str,
                "decoded": decoded,
                "position": match.start()
            })
        except:
            pass

    # Pattern: table with encoded strings
    table_pattern = re.compile(
        r'local\s+(\w+)\s*=\s*\{[^}]*(?:["\'])((?:\\x[0-9a-fA-F]{2})+)(?:["\'])',
        re.DOTALL
    )

    for match in table_pattern.finditer(lua_content):
        hex_str = match.group(2)
        try:
            decoded = bytes.fromhex(hex_str.replace('\\x', '')).decode('latin-1')
            obfuscated.append({
                "type": "table_hex",
                "table_name": match.group(1),
                "encoded": hex_str,
                "decoded": decoded,
                "position": match.start()
            })
        except:
            pass

    return obfuscated


def _detect_encoded_functions(lua_content: str) -> bool:
    """Detect encoded function names."""
    # Look for function names that are just hex or random characters
    patterns = [
        r'function\s+([a-f0-9]{8,})\s*\(',
        r'function\s+(_[a-zA-Z0-9_]{20,})\s*\(',
    ]

    for pattern in patterns:
        if re.search(pattern, lua_content):
            return True

    return False


def try_simple_deobfuscation(lua_content: str) -> str:
    """
    Attempt simple deobfuscation (hex string decoding).

    This is a best-effort attempt for MVP - not guaranteed to work
    for all obfuscation methods.
    """
    result = lua_content

    # Replace hex-encoded strings in table lookups
    hex_pattern = re.compile(r'\[(?:["\'])((?:\\x[0-9a-fA-F]{2})+)(?:["\'])\]')

    def replace_hex(match):
        hex_str = match.group(1)
        try:
            decoded = bytes.fromhex(hex_str.replace('\\x', '')).decode('latin-1')
            return f'["{decoded}"]'
        except:
            return match.group(0)

    result = hex_pattern.sub(replace_hex, result)

    return result


@dataclass
class UrwigoDeobfuscationReport:
    """Report of Urwigo deobfuscation operations."""
    function_name: str = ""  # Name of the obfuscation function detected
    dtable_size: int = 0     # Size of the deobfuscation table
    strings_decoded: int = 0  # Number of strings decoded
    errors: List[str] = field(default_factory=list)
    samples: List[Dict[str, str]] = field(default_factory=list)  # Before/after samples


class UrwigoDeobfuscator:
    """
    Deobfuscator for Urwigo-encoded Lua strings.

    Detects the obfuscation function name and dtable automatically,
    then replaces all encoded string calls with their decoded values.
    """

    # Lua escape sequences mapping
    LUA_ESCAPES = {
        'a': '\x07',  # bell
        'b': '\x08',  # backspace
        'f': '\x0c',  # form feed
        'n': '\n',     # newline
        'r': '\r',     # carriage return
        't': '\t',     # tab
        'v': '\x0b',   # vertical tab
        '\\': '\\',    # backslash
        '"': '"',      # double quote
        "'": "'",      # single quote
    }

    def __init__(self):
        self.function_name: Optional[str] = None
        self.dtable: str = ""
        self.report = UrwigoDeobfuscationReport()

    def _decode_lua_escapes(self, s: str) -> str:
        """
        Decode Lua escape sequences in a string.
        Supports: newline, carriage return, tab, bell, backspace,
        form feed, vertical tab, backslash, quotes, hex (xNN), octal.
        """
        result = []
        i = 0
        while i < len(s):
            if s[i] == '\\' and i + 1 < len(s):
                next_char = s[i + 1]

                # \xNN - hex escape (exactly 2 hex digits)
                if next_char == 'x' and i + 3 < len(s):
                    hex_val = s[i+2:i+4]
                    if all(c in '0123456789abcdefABCDEF' for c in hex_val):
                        result.append(chr(int(hex_val, 16)))
                        i += 4
                        continue

                # Single character escapes (\n, \r, \t, etc.)
                if next_char in self.LUA_ESCAPES:
                    result.append(self.LUA_ESCAPES[next_char])
                    i += 2
                    continue

                # \0-\7 - octal escape (up to 3 octal digits, value <= 255)
                if next_char in '01234567':
                    oct_digits = [next_char]
                    j = i + 2
                    while j < len(s) and s[j] in '01234567' and len(oct_digits) < 3:
                        oct_digits.append(s[j])
                        j += 1
                    try:
                        val = int(''.join(oct_digits), 8)
                        if val <= 255:
                            result.append(chr(val))
                            i += len(oct_digits) + 1
                            continue
                    except:
                        pass

            result.append(s[i])
            i += 1

        return ''.join(result)

    def _find_obfuscation_function(self, lua_content: str) -> Optional[Tuple[str, str]]:
        """
        Find the Urwigo deobfuscation function and its dtable.

        Returns:
            Tuple of (function_name, decoded_dtable) or None if not found
        """
        # Pattern to find functions containing 'local dtable = "..."'
        # Matches: function _m9REO(str), function _UrwigoDecrypt(s), etc.
        func_pattern = re.compile(
            r'function\s+([A-Za-z_][A-Za-z0-9_]*)\s*\([^)]*\)\s*'  # function name(params)
            r'(?:[^}]*?)'  # any code before dtable (non-greedy, no closing brace)
            r'local\s+dtable\s*=\s*"([^"]+)"',  # local dtable = "..."
            re.DOTALL | re.IGNORECASE
        )

        for match in func_pattern.finditer(lua_content):
            func_name = match.group(1)
            raw_dtable = match.group(2)

            # Decode the dtable escapes
            decoded_dtable = self._decode_lua_escapes(raw_dtable)

            # Validate: dtable should be around 128 characters for Urwigo
            if len(decoded_dtable) >= 64:  # Reasonable minimum
                return (func_name, decoded_dtable)

        # Alternative: look for dtable at module level
        dtable_pattern = re.compile(
            r'(?:local\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*\{[^}]*\}\s*'  # function table
            r'.*?(?:local\s+)?dtable\s*=\s*"([^"]+)"',
            re.DOTALL | re.IGNORECASE
        )

        # Simpler fallback: just find any function followed by dtable in the same block
        simple_pattern = re.compile(
            r'function\s+([A-Za-z_][A-Za-z0-9_]*)\s*\([^)]*\)[^}]*?dtable\s*=\s*"([^"]+)"',
            re.DOTALL | re.IGNORECASE
        )

        for match in simple_pattern.finditer(lua_content):
            func_name = match.group(1)
            raw_dtable = match.group(2)
            decoded_dtable = self._decode_lua_escapes(raw_dtable)

            if len(decoded_dtable) >= 64:
                return (func_name, decoded_dtable)

        return None

    def _decode_urwigo_string(self, encoded: str) -> str:
        """
        Decode an Urwigo obfuscated string using the dtable.

        Args:
            encoded: The obfuscated string (after escape decoding)

        Returns:
            Decoded string
        """
        if not self.dtable:
            return encoded

        result = []
        for char in encoded:
            b = ord(char)
            # Urwigo uses 1-based indexing, bytes 1-127
            if 1 <= b <= 127 and b <= len(self.dtable):
                result.append(self.dtable[b - 1])
            else:
                result.append(char)

        return ''.join(result)

    def deobfuscate(self, lua_content: str) -> Tuple[str, UrwigoDeobfuscationReport]:
        """
        Deobfuscate Urwigo-encoded Lua content.

        Args:
            lua_content: The Lua source code to deobfuscate

        Returns:
            Tuple of (deobfuscated_content, report)
        """
        self.report = UrwigoDeobfuscationReport()

        # Step 1: Find the obfuscation function and dtable
        func_info = self._find_obfuscation_function(lua_content)
        if not func_info:
            self.report.errors.append("No Urwigo obfuscation function found (no dtable detected)")
            return (lua_content, self.report)

        self.function_name, self.dtable = func_info
        self.report.function_name = self.function_name
        self.report.dtable_size = len(self.dtable)

        # Step 2: Find and replace all obfuscated string calls
        # Pattern: function_name("encoded_string")
        call_pattern = re.compile(
            rf'{re.escape(self.function_name)}\s*\(\s*"([^"]+)"\s*\)'
        )

        result = lua_content
        offset = 0

        for match in call_pattern.finditer(lua_content):
            # Get the encoded string with escapes
            encoded_escaped = match.group(1)

            # Decode Lua escapes in the encoded string
            encoded = self._decode_lua_escapes(encoded_escaped)

            # Decode using the dtable
            decoded = self._decode_urwigo_string(encoded)

            # Replace in result
            match_start = match.start() + offset
            match_end = match.end() + offset
            replacement = f'"{decoded}"'
            result = result[:match_start] + replacement + result[match_end:]

            # Update offset for subsequent replacements
            offset += len(replacement) - (match_end - match_start)

            self.report.strings_decoded += 1

            # Keep samples (first 5)
            if len(self.report.samples) < 5:
                self.report.samples.append({
                    'encoded': encoded[:50] + '...' if len(encoded) > 50 else encoded,
                    'decoded': decoded[:50] + '...' if len(decoded) > 50 else decoded
                })

        # Step 3: Optionally comment out or mark the deobfuscation function as processed
        # (We leave it in place for reference)

        return (result, self.report)


def deobfuscate_urwigo(lua_content: str) -> Tuple[str, UrwigoDeobfuscationReport]:
    """
    Convenience function to deobfuscate Urwigo-encoded Lua content.

    Args:
        lua_content: The Lua source code to deobfuscate

    Returns:
        Tuple of (deobfuscated_content, report)
    """
    deobfuscator = UrwigoDeobfuscator()
    return deobfuscator.deobfuscate(lua_content)
