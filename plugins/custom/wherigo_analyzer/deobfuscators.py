"""Deobfuscation for Wherigo Lua scripts.

Detects and reverses obfuscation patterns from Urwigo and Earwigo tools.
Pure text parsing - never executes Lua code.
"""

from __future__ import annotations

import re
from typing import List, Dict, Any, Optional, Tuple
from dataclasses import dataclass, field

try:
    from .deobfuscation_utils import decode_lua_escapes, decode_lua_escapes_to_bytes
except ImportError:
    from deobfuscation_utils import decode_lua_escapes, decode_lua_escapes_to_bytes


@dataclass
class DeobfuscationResult:
    """Result of obfuscation detection."""
    detected: List[str] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)
    obfuscated_strings: List[Dict[str, Any]] = field(default_factory=list)


@dataclass
class DeobfuscationReport:
    """Report for deobfuscation operations."""
    function_name: Optional[str] = None
    dtable_size: int = 0
    methods_detected: List[str] = field(default_factory=list)
    strings_decoded_by_function: int = 0
    strings_decoded_by_best_effort: int = 0
    samples: List[Dict[str, Any]] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "function_name": self.function_name,
            "dtable_size": self.dtable_size,
            "methods_detected": self.methods_detected,
            "strings_decoded_by_function": self.strings_decoded_by_function,
            "strings_decoded_by_best_effort": self.strings_decoded_by_best_effort,
            "samples": self.samples[:10],
            "warnings": self.warnings
        }


# WWB/gsub_wig translation table
WWB_TABLE = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789@.-~"


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
    function_name: Optional[str] = None
    dtable: Optional[str] = None  # The actual dtable content
    dtable_size: int = 0
    methods_detected: List[str] = field(default_factory=list)
    strings_decoded_by_function: int = 0  # Renamed from strings_decoded
    strings_decoded_by_best_effort: int = 0
    samples: List[Dict[str, Any]] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)
    errors: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for JSON serialization."""
        return {
            "function_name": self.function_name,
            "dtable_size": self.dtable_size,
            "methods_detected": self.methods_detected,
            "strings_decoded_by_function": self.strings_decoded_by_function,
            "strings_decoded_by_best_effort": self.strings_decoded_by_best_effort,
            "samples": self.samples[:10],
            "warnings": self.warnings,
            "errors": self.errors
        }


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
        """Decode Lua escape sequences. Delegates to unified function."""
        return decode_lua_escapes(s)

    def _decode_lua_escapes_to_bytes(self, s: str) -> bytes:
        """Decode Lua escape sequences to raw bytes. Delegates to unified function."""
        return decode_lua_escapes_to_bytes(s)

    def _find_obfuscation_function(self, lua_content: str) -> Optional[Tuple[str, str]]:
        """
        Find the Urwigo deobfuscation function and its dtable.

        Returns:
            Tuple of (function_name, decoded_dtable) or None if not found
        """
        # Pattern 1: Find function followed by dtable (Lua functions don't use braces)
        # Match function declaration, then any content until dtable=, then until 'end'
        # More flexible: allows any whitespace after function declaration
        # dtable string can contain actual newlines (from decompiler)
        # Note: \\[\s\S]|[^"\\] order is critical - escape must be tried first,
        # and alternatives must be non-overlapping to avoid catastrophic backtracking
        func_pattern = re.compile(
            r'function\s+([A-Za-z_][A-Za-z0-9_]*)\s*\([^)]*\)\s*'  # function name(params) + whitespace
            r'(?:local\s+\w+\s*=\s*"(?:\\[\s\S]|[^"\\])*"\s*)*'  # optional local declarations with strings
            r'local\s+dtable\s*=\s*"((?:\\[\s\S]|[^"\\])*)"'  # local dtable = "..." (can have newlines)
            r'[\s\S]*?\bend\b',  # rest until 'end'
            re.IGNORECASE
        )

        for match in func_pattern.finditer(lua_content):
            func_name = match.group(1)
            raw_dtable = match.group(2)

            # Decode the dtable escapes
            decoded_dtable = self._decode_lua_escapes(raw_dtable)

            # Validate: dtable should be around 128 characters for Urwigo
            if len(decoded_dtable) >= 64:  # Reasonable minimum
                return (func_name, decoded_dtable)

        # Pattern 2: Simpler fallback - just find function name and dtable
        simple_pattern = re.compile(
            r'function\s+([A-Za-z_][A-Za-z0-9_]*)\s*\([^)]*\)'
            r'[\s\S]*?local\s+dtable\s*=\s*"((?:\\[\s\S]|[^"\\])*)"',
            re.DOTALL | re.IGNORECASE
        )

        for match in simple_pattern.finditer(lua_content):
            func_name = match.group(1)
            raw_dtable = match.group(2)
            decoded_dtable = self._decode_lua_escapes(raw_dtable)

            if len(decoded_dtable) >= 64:
                return (func_name, decoded_dtable)

        # Pattern 3: Find dtable by string pattern alone (fallback)
        dtable_only_pattern = re.compile(
            r'local\s+dtable\s*=\s*"((?:\\[\s\S]|[^"\\]){64,200})"',
            re.IGNORECASE
        )
        for match in dtable_only_pattern.finditer(lua_content):
            raw_dtable = match.group(1)
            decoded_dtable = self._decode_lua_escapes(raw_dtable)
            if len(decoded_dtable) >= 64:
                # Try to find function name nearby (up to 10 lines before)
                start_pos = max(0, match.start() - 500)
                context = lua_content[start_pos:match.start()]
                func_match = re.search(r'function\s+([A-Za-z_][A-Za-z0-9_]*)\s*\([^)]*\)', context)
                if func_match:
                    return (func_match.group(1), decoded_dtable)
                return ("_decode", decoded_dtable)  # generic name

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

    def _decode_wwb_gsub_string(self, encoded: str, table: str = WWB_TABLE) -> str:
        """
        Decode WWB_deobf or gsub_wig obfuscated string.
        Uses the fixed table: ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789@.-~
        """
        try:
            result = []
            for c in encoded:
                try:
                    idx = table.index(c)
                    result.append(chr(idx + 1))
                except ValueError:
                    result.append(c)
            return ''.join(result)
        except:
            return encoded

    def _process_wwb_gsub_patterns(self, lua_content: str) -> Tuple[str, int]:
        """
        Find and decode WWB_deobf("...") and gsub_wig("...") patterns.
        Returns (modified_content, count_replaced).
        """
        result = lua_content
        count = 0

        # Pattern for WWB_deobf("...") or WWB_deobf('...')
        wwb_pattern = re.compile(
            r'WWB_deobf\s*\(\s*(["\'])((?:\\[\s\S]|(?!\1).)*)\1\s*\)',
            re.IGNORECASE
        )

        # Pattern for gsub_wig("...") or gsub_wig('...')
        gsub_pattern = re.compile(
            r'gsub_wig\s*\(\s*(["\'])((?:\\[\s\S]|(?!\1).)*)\1\s*\)',
            re.IGNORECASE
        )

        # Process WWB_deobf
        for match in wwb_pattern.finditer(lua_content):
            encoded_escaped = match.group(2)
            encoded = self._decode_lua_escapes(encoded_escaped)
            decoded = self._decode_wwb_gsub_string(encoded)
            if decoded != encoded:
                result = result[:match.start()] + f'"{decoded}"' + result[match.end():]
                count += 1
                self.report.methods_detected.append("WWB_deobf")

        # Process gsub_wig
        for match in gsub_pattern.finditer(result):
            encoded_escaped = match.group(2)
            encoded = self._decode_lua_escapes(encoded_escaped)
            decoded = self._decode_wwb_gsub_string(encoded)
            if decoded != encoded:
                result = result[:match.start()] + f'"{decoded}"' + result[match.end():]
                count += 1
                self.report.methods_detected.append("gsub_wig")

        return result, count

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
        # Pattern: function_name("encoded_string") or function_name('encoded_string')
        # Handles both single and double quotes, with escaped quotes inside
        # Note: \\[\s\S]|(?!\1) order is critical - escape must be tried first
        call_pattern = re.compile(
            rf'{re.escape(self.function_name)}\s*\(\s*(["\'])((?:\\[\s\S]|(?!\1).)*)\1\s*\)'
        )

        result = lua_content
        offset = 0

        for match in call_pattern.finditer(lua_content):
            # Get the encoded string with escapes
            encoded_escaped = match.group(2)  # group 2 is the content, group 1 is the quote char

            # Decode Lua escapes in the encoded string
            encoded = self._decode_lua_escapes(encoded_escaped)

            # Decode using the dtable
            decoded = self._decode_urwigo_string(encoded)

            # Replace in result - always use double quotes for consistency
            match_start = match.start() + offset
            match_end = match.end() + offset
            replacement = f'"{decoded}"'
            result = result[:match_start] + replacement + result[match_end:]

            # Update offset for subsequent replacements
            offset += len(replacement) - (match_end - match_start)

            self.report.strings_decoded_by_function += 1

            # Keep samples (first 5)
            if len(self.report.samples) < 5:
                self.report.samples.append({
                    'encoded': encoded[:50] + '...' if len(encoded) > 50 else encoded,
                    'decoded': decoded[:50] + '...' if len(decoded) > 50 else decoded
                })

        # Step 3: Process WWB/gsub patterns
        result, wwb_count = self._process_wwb_gsub_patterns(result)
        self.report.strings_decoded_by_function += wwb_count

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
