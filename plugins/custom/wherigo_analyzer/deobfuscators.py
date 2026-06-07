"""Deobfuscation detection for Wherigo Lua scripts.

Detects obfuscation patterns from Urwigo and Earwigo tools.
Does not perform full deobfuscation in MVP - only detection.
"""

from __future__ import annotations

import re
from typing import List, Dict, Any
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
