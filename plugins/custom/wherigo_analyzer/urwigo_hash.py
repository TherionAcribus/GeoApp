"""Urwigo hash module.

Provides interface for Urwigo hash functions with bruteforce support.
Implements RSHash algorithm used by Urwigo.
"""

from __future__ import annotations

import re
from typing import Optional, Tuple, List, Iterator


# Constants for Urwigo RSHash algorithm
URWIGO_A_INIT = 63689
URWIGO_B = 378551
URWIGO_MOD = 65535


def urwigo_hash(s: str, lowercase: bool = True) -> int:
    """
    Compute Urwigo RSHash modulo 65535.

    Algorithm:
    a = 63689
    b = 378551
    hash = 0
    for each character:
        hash = hash * a + ord(char)
        hash %= 65535
        a *= b
        a %= 65535

    Args:
        s: String to hash
        lowercase: Convert to lowercase before hashing (default True)

    Returns:
        Hash value (0-65535)
    """
    if lowercase:
        s = s.lower()

    a = URWIGO_A_INIT
    h = 0

    for char in s:
        h = (h * a + ord(char)) % URWIGO_MOD
        a = (a * URWIGO_B) % URWIGO_MOD

    return h


def brute_force_hash(
    target_hash: int,
    alphabet: str,
    min_len: int,
    max_len: int,
    lowercase: bool = True,
    limit: int = 20
) -> List[str]:
    """
    Brute force search for strings that produce a given hash.

    Args:
        target_hash: Target hash value to find
        alphabet: Characters to use in search
        min_len: Minimum string length
        max_len: Maximum string length
        lowercase: Convert to lowercase before hashing
        limit: Maximum number of candidates to return

    Returns:
        List of candidate strings (may include collisions)
    """
    candidates = []

    def generate_strings(length: int, prefix: str = "") -> Iterator[str]:
        """Generate all strings of given length from alphabet."""
        if length == 0:
            yield prefix
            return
        for char in alphabet:
            yield from generate_strings(length - 1, prefix + char)

    # Search by increasing length
    for length in range(min_len, max_len + 1):
        for s in generate_strings(length):
            if urwigo_hash(s, lowercase) == target_hash:
                candidates.append(s)
                if len(candidates) >= limit:
                    return candidates

    return candidates


def brute_force_numeric(target_hash: int, min_digits: int = 1, max_digits: int = 6, limit: int = 20) -> List[str]:
    """Brute force numeric candidates (0-9)."""
    return brute_force_hash(target_hash, "0123456789", min_digits, max_digits, lowercase=False, limit=limit)


def brute_force_alpha(target_hash: int, min_len: int = 1, max_len: int = 5, limit: int = 20) -> List[str]:
    """Brute force alphabetic candidates (a-z)."""
    return brute_force_hash(target_hash, "abcdefghijklmnopqrstuvwxyz", min_len, max_len, lowercase=True, limit=limit)


def brute_force_alphanumeric(target_hash: int, min_len: int = 1, max_len: int = 4, limit: int = 20) -> List[str]:
    """Brute force alphanumeric candidates (a-z, 0-9)."""
    return brute_force_hash(
        target_hash,
        "abcdefghijklmnopqrstuvwxyz0123456789",
        min_len, max_len,
        lowercase=True,
        limit=limit
    )


def brute_force_urwigo_common(target_hash: int) -> dict:
    """
    Brute force common patterns for Urwigo hashes.

    Args:
        target_hash: Target hash value

    Returns:
        Dict with categories and candidate lists:
        - numeric: 0-9 length 1-6
        - alpha: a-z length 1-5
        - alphanumeric: a-z0-9 length 1-4
    """
    return {
        "numeric": brute_force_numeric(target_hash, 1, 6, 10),
        "alpha": brute_force_alpha(target_hash, 1, 5, 10),
        "alphanumeric": brute_force_alphanumeric(target_hash, 1, 4, 10),
        "note": "collisions possibles, réponse non garantie"
    }


class UrwigoHash:
    """Interface for Urwigo hash operations."""

    def __init__(self):
        self.warnings: list[str] = []

    def detect_hash_function(self, lua_content: str) -> Optional[str]:
        """
        Detect if there's a hash function in the Lua code.

        Returns:
            Function name if detected, None otherwise
        """
        # Common Urwigo hash function patterns
        patterns = [
            r'function\s+(\w+hash\w*)\s*\(',
            r'function\s+(hash\w+)\s*\(',
            r'function\s+(_\w*hash\w*)\s*\(',
            r'\bfunction\s+(\w+_hash)\s*\(',
        ]

        for pattern in patterns:
            match = re.search(pattern, lua_content, re.IGNORECASE)
            if match:
                return match.group(1)

        return None

    def extract_hash_table(self, lua_content: str) -> Optional[str]:
        """
        Extract the hash table from Lua content.

        Returns:
            Table name if found, None otherwise
        """
        # Look for hash table definitions
        patterns = [
            r'local\s+(\w+)\s*=\s*\{\s*\[?["\']?\w+["\']?\]?\s*=\s*["\']\w+["\']',
            r'(\w+)\s*=\s*\{\s*\[?["\']?\w+["\']?\]?\s*=\s*["\']\w+["\']',
        ]

        for pattern in patterns:
            match = re.search(pattern, lua_content)
            if match:
                return match.group(1)

        return None

    def check_for_hashed_answers(self, lua_content: str) -> list[Tuple[str, str]]:
        """
        Check for hashed answer comparisons in the code.

        Returns:
            List of (hash_value, context) tuples
        """
        results = []

        # Pattern: hash(input) == "..."
        hash_compare_pattern = re.compile(
            r'(?:if|elseif)\s+\(?\s*(?:hash|(\w+hash\w*))\s*\(\s*input\s*\)\s*==\s*["\']([a-f0-9]+)["\']',
            re.IGNORECASE
        )

        for match in hash_compare_pattern.finditer(lua_content):
            hash_func = match.group(1) or "hash"
            hash_value = match.group(2)
            results.append((hash_value, f"{hash_func}(input) comparison"))

        # Pattern: table[hash(input)]
        table_hash_pattern = re.compile(
            r'(\w+)\s*\[\s*(?:hash|(\w+hash\w*))\s*\(\s*input\s*\)\s*\]',
            re.IGNORECASE
        )

        for match in table_hash_pattern.finditer(lua_content):
            table_name = match.group(1)
            hash_func = match.group(2) or "hash"
            results.append((table_name, f"Table lookup: {table_name}[{hash_func}(input)]"))

        return results

    def get_status(self) -> dict:
        """Get the current status of the hash module."""
        return {
            "hash_detection_available": True,
            "bruteforce_available": False,
            "warnings": [
                "Hash bruteforce not yet implemented in MVP.",
                "Hash detection is available."
            ] + self.warnings
        }


def detect_and_warn_about_hashes(lua_content: str) -> list[str]:
    """
    Detect hash usage and return warning messages.

    This is the main entry point for MVP - warns users about
    hashed answers that cannot be cracked yet.
    """
    warnings = []
    hasher = UrwigoHash()

    # Check for hash function
    hash_func = hasher.detect_hash_function(lua_content)
    if hash_func:
        warnings.append(f"Hash function detected: {hash_func}. Answer cracking not yet implemented.")

    # Check for hashed answers
    hashed_answers = hasher.check_for_hashed_answers(lua_content)
    if hashed_answers:
        warnings.append(f"Detected {len(hashed_answers)} hashed answer(s). Manual analysis required.")
        for hash_val, context in hashed_answers[:5]:  # Show first 5
            warnings.append(f"  - Hash: {hash_val[:20]}... ({context})")

    return warnings
