"""
Utilities for deobfuscating Wherigo cartridge text.
Handles Urwigo, WWB, and gsub_wig obfuscation methods.
"""

import re
from typing import Optional, Dict, List, Any, Tuple
from dataclasses import dataclass, field


# French common words for scoring
FRENCH_COMMON_WORDS = {
    'le', 'la', 'les', 'des', 'une', 'un', 'vous', 'avez', 'est', 'dans',
    'pour', 'pas', 'oui', 'non', 'bravo', 'indice', 'cache', 'zone', 'et',
    'du', 'au', 'aux', 'ce', 'cet', 'cette', 'ces', 'sur', 'par', 'avec',
    'que', 'qui', 'quoi', 'dont', 'où', 'comment', 'quand', 'pourquoi',
    'trouvé', 'trouver', 'chercher', 'recherche', 'cachette', 'trésor',
    'géocache', 'étape', 'final', 'finale', 'coord', 'coordonnées',
    'latitude', 'longitude', 'nord', 'sud', 'est', 'ouest', 'bonjour',
    'merci', 'bienvenue', 'commencer', 'démarrer', 'continuer', 'terminé',
    'code', 'réponse', 'question', 'énigme', 'devinette', 'charade'
}

# WWB/gsub_wig translation table
WWB_TABLE = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789@.-~"


# Single-character Lua escape sequences
_LUA_SIMPLE_ESCAPES = {
    'a': '\x07', 'b': '\x08', 'f': '\x0c', 'n': '\x0a',
    'r': '\x0d', 't': '\x09', 'v': '\x0b', '\\': '\\',
    '"': '"', "'": "'",
}


def decode_lua_escapes(s: str) -> str:
    """Decode Lua escape sequences in a string literal.

    Supports:
    - Single-char escapes: \\a \\b \\f \\n \\r \\t \\v \\\\ \\" \\'
    - Hex escapes: \\xNN (exactly 2 hex digits)
    - Decimal escapes: \\ddd (up to 3 DECIMAL digits, value 0-255)
      Note: Lua uses DECIMAL, not octal like C.
    - UTF-8 multi-byte sequences are preserved.

    Args:
        s: String content (without surrounding quotes)

    Returns:
        Decoded string
    """
    if not s:
        return s

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

            # Single character escapes
            if next_char in _LUA_SIMPLE_ESCAPES:
                result.append(_LUA_SIMPLE_ESCAPES[next_char])
                i += 2
                continue

            # \ddd - decimal escape (up to 3 decimal digits, value <= 255)
            # Note: Lua uses DECIMAL escapes, not octal like C
            if next_char in '0123456789':
                dec_digits = [next_char]
                j = i + 2
                while j < len(s) and s[j] in '0123456789' and len(dec_digits) < 3:
                    dec_digits.append(s[j])
                    j += 1
                try:
                    val = int(''.join(dec_digits))
                    if val <= 255:
                        result.append(chr(val))
                        i = j
                        continue
                except:
                    pass

            # Unknown escape - keep backslash and char as-is
            result.append(s[i])
            i += 1
            continue

        result.append(s[i])
        i += 1

    return ''.join(result)


def decode_lua_escapes_to_bytes(s: str) -> bytes:
    """Decode Lua escape sequences and return as raw bytes.

    Same as decode_lua_escapes but returns bytes, preserving byte values
    exactly (useful for dtable extraction where byte-level accuracy matters).

    Args:
        s: String content (without surrounding quotes)

    Returns:
        Decoded bytes
    """
    if not s:
        return b''

    result = []
    i = 0
    while i < len(s):
        if s[i] == '\\' and i + 1 < len(s):
            next_char = s[i + 1]

            # \xNN - hex escape
            if next_char == 'x' and i + 3 < len(s):
                hex_val = s[i+2:i+4]
                if all(c in '0123456789abcdefABCDEF' for c in hex_val):
                    result.append(int(hex_val, 16))
                    i += 4
                    continue

            # Single character escapes
            if next_char in _LUA_SIMPLE_ESCAPES:
                result.append(ord(_LUA_SIMPLE_ESCAPES[next_char]))
                i += 2
                continue

            # \ddd - decimal escape (Lua uses DECIMAL, not octal)
            if next_char in '0123456789':
                dec_digits = [next_char]
                j = i + 2
                while j < len(s) and s[j] in '0123456789' and len(dec_digits) < 3:
                    dec_digits.append(s[j])
                    j += 1
                try:
                    val = int(''.join(dec_digits))
                    if val <= 255:
                        result.append(val)
                        i = j
                        continue
                except:
                    pass

            # Unknown escape - keep backslash byte
            result.append(ord(s[i]))
            i += 1
            continue

        # Regular character - encode as UTF-8 bytes
        char = s[i]
        if ord(char) < 128:
            result.append(ord(char))
        else:
            for b in char.encode('utf-8'):
                result.append(b)
        i += 1

    return bytes(result)


@dataclass
class DeobfuscationContext:
    """Context for deobfuscation operations."""
    urwigo_function_name: Optional[str] = None
    urwigo_dtable: Optional[str] = None
    wwb_or_gsub_detected: bool = False
    tables_available: List[str] = field(default_factory=list)
    methods_detected: List[str] = field(default_factory=list)
    samples: List[Dict[str, Any]] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)
    strings_decoded_by_function: int = 0
    strings_decoded_by_best_effort: int = 0

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for JSON serialization."""
        return {
            "urwigo_function_name": self.urwigo_function_name,
            "urwigo_dtable_size": len(self.urwigo_dtable) if self.urwigo_dtable else 0,
            "wwb_or_gsub_detected": self.wwb_or_gsub_detected,
            "tables_available": self.tables_available,
            "methods_detected": self.methods_detected,
            "strings_decoded_by_function": self.strings_decoded_by_function,
            "strings_decoded_by_best_effort": self.strings_decoded_by_best_effort,
            "samples": self.samples[:10],  # Limit samples
            "warnings": self.warnings
        }


class TextDecoder:
    """Best-effort text decoder for obfuscated strings."""

    def __init__(self, context: DeobfuscationContext):
        self.context = context
        self.dtable = context.urwigo_dtable
        self.warnings: List[str] = []

    def _decode_lua_escapes(self, s: str) -> str:
        """Decode Lua escape sequences in a string. Delegates to module function."""
        return decode_lua_escapes(s)

    def _is_suspicious(self, text: str) -> Tuple[bool, str]:
        """
        Check if text is suspicious (possibly obfuscated).
        Returns (is_suspicious, reason).
        """
        if not text or len(text) < 2:
            return False, "too short"

        # Check for control characters (except \n, \r, \t)
        control_chars = [c for c in text if ord(c) < 32 and c not in '\n\r\t']
        if control_chars:
            return True, f"control chars: {repr(control_chars[:3])}"

        # Check for high ratio of non-printable/high-bit characters
        non_printable = sum(1 for c in text if ord(c) < 32 or ord(c) > 126)
        if len(text) > 5 and non_printable / len(text) > 0.3:
            return True, "high non-printable ratio"

        # Check for very few vowels (suspicious for French text)
        vowels = sum(1 for c in text.lower() if c in 'aeiouyàâäéèêëïîôöùûü')
        if len(text) > 10 and vowels / len(text) < 0.1:
            return True, "very few vowels"

        # Check for short text with weird characters
        weird_chars = sum(1 for c in text if ord(c) < 32 or (ord(c) > 126 and ord(c) < 160))
        if weird_chars > 0 and len(text) < 20:
            return True, "short text with weird chars"

        return False, "looks normal"

    def _score_text(self, text: str) -> float:
        """
        Score a text candidate. Higher is better.
        """
        if not text:
            return 0.0

        score = 0.0
        text_lower = text.lower()

        # 1. Penalize control characters (except common whitespace)
        for c in text:
            if ord(c) < 32 and c not in '\n\r\t':
                score -= 5.0
            elif ord(c) > 126:
                # High-bit chars - slightly penalize unless they're accents
                if ord(c) not in range(192, 256):  # Not extended ASCII
                    score -= 1.0

        # 2. Reward printable characters
        printable_ratio = sum(1 for c in text if 32 <= ord(c) <= 126) / len(text)
        score += printable_ratio * 10

        # 3. Reward normal spaces (not multiple spaces, not tabs)
        normal_spaces = text.count(' ')
        if normal_spaces > 0:
            score += min(normal_spaces, 10) * 0.5

        # 4. Reward French common words
        words = re.findall(r'\b[a-zA-ZÀ-ÖØ-öø-ÿ]+\b', text_lower)
        for word in words:
            if word in FRENCH_COMMON_WORDS:
                score += 3.0

        # 5. Reward French accents
        accents = sum(1 for c in text if c in 'àâäéèêëïîôöùûüç')
        score += accents * 0.5

        # 6. Reward reasonable vowel ratio
        vowels = sum(1 for c in text_lower if c in 'aeiouyàâäéèêëïîôöùûü')
        if len(text) > 5:
            vowel_ratio = vowels / len(text)
            if 0.2 <= vowel_ratio <= 0.6:  # Reasonable for French
                score += 5.0
            elif vowel_ratio < 0.1:
                score -= 5.0

        # 7. Reward sentence structure (starts with uppercase, ends with punctuation)
        if text[0].isupper():
            score += 1.0
        if text[-1] in '.!?':
            score += 1.0

        # 8. Reward length (but not too long)
        if 10 <= len(text) <= 500:
            score += 2.0

        return score

    def _try_urwigo_direct(self, text: str) -> Optional[str]:
        """Try Urwigo direct decoding: dtable[ord(char)-1]."""
        if not self.dtable:
            return None

        try:
            result = []
            for c in text:
                idx = ord(c) - 1
                if 0 <= idx < len(self.dtable):
                    result.append(self.dtable[idx])
                else:
                    result.append(c)
            return ''.join(result)
        except:
            return None

    def _try_urwigo_inverse(self, text: str) -> Optional[str]:
        """Try Urwigo inverse decoding: chr(dtable.index(char)+1)."""
        if not self.dtable:
            return None

        try:
            result = []
            for c in text:
                try:
                    idx = self.dtable.index(c)
                    result.append(chr(idx + 1))
                except ValueError:
                    result.append(c)
            return ''.join(result)
        except:
            return None

    def _try_wwb_gsub(self, text: str, inverse: bool = False) -> Optional[str]:
        """Try WWB/gsub_wig decoding with fixed table."""
        try:
            result = []
            for c in text:
                try:
                    idx = WWB_TABLE.index(c)
                    if inverse:
                        result.append(chr(idx + 1))
                    else:
                        if 0 <= idx < len(WWB_TABLE):
                            result.append(WWB_TABLE[idx])
                        else:
                            result.append(c)
                except ValueError:
                    result.append(c)
            return ''.join(result)
        except:
            return None

    def decode_text_best_effort(self, value: str) -> Tuple[str, Optional[Dict[str, Any]]]:
        """
        Decode a text value using best-effort approach.

        Returns:
            Tuple of (decoded_text, debug_info or None)
        """
        if not value or not isinstance(value, str):
            return value, None

        # First, decode Lua escapes
        decoded_value = self._decode_lua_escapes(value)

        # Check if suspicious
        is_suspicious, reason = self._is_suspicious(decoded_value)

        if not is_suspicious:
            return decoded_value, None

        # Try multiple decoding methods
        candidates = []

        # Raw (after Lua escape decoding)
        candidates.append(("raw", decoded_value, self._score_text(decoded_value)))

        # Urwigo direct
        if self.dtable:
            urwigo_direct = self._try_urwigo_direct(decoded_value)
            if urwigo_direct:
                candidates.append(("urwigo_direct", urwigo_direct, self._score_text(urwigo_direct)))

            # Urwigo inverse
            urwigo_inverse = self._try_urwigo_inverse(decoded_value)
            if urwigo_inverse:
                candidates.append(("urwigo_inverse", urwigo_inverse, self._score_text(urwigo_inverse)))

        # WWB/gsub direct
        wwb_direct = self._try_wwb_gsub(decoded_value, inverse=False)
        if wwb_direct:
            candidates.append(("wwb_direct", wwb_direct, self._score_text(wwb_direct)))

        # WWB/gsub inverse
        wwb_inverse = self._try_wwb_gsub(decoded_value, inverse=True)
        if wwb_inverse:
            candidates.append(("wwb_inverse", wwb_inverse, self._score_text(wwb_inverse)))

        # Find best candidate
        best = max(candidates, key=lambda x: x[2])
        raw_score = candidates[0][2]
        best_score = best[2]

        # If best is clearly better than raw, use it
        if best[0] != "raw" and best_score > raw_score + 5:
            debug_info = {
                "method": best[0],
                "raw": decoded_value[:50] + "..." if len(decoded_value) > 50 else decoded_value,
                "decoded": best[1][:50] + "..." if len(best[1]) > 50 else best[1],
                "raw_score": raw_score,
                "decoded_score": best_score,
                "reason": reason
            }
            self.context.strings_decoded_by_best_effort += 1
            self.context.samples.append(debug_info)
            return best[1], debug_info

        # Otherwise, keep raw but add warning
        if is_suspicious:
            warning = f"Suspicious text kept as-is (could not decode): {decoded_value[:30]!r} (reason: {reason})"
            if warning not in self.warnings:
                self.warnings.append(warning)

        return decoded_value, None


def is_internal_identifier(name: str) -> bool:
    """Check if a name is an internal Lua identifier that should not be decoded."""
    if not name or not isinstance(name, str):
        return False

    # Media variable names like _z2Mh, _i_eb, _BFG
    if re.match(r'^_[a-zA-Z0-9_]+$', name):
        return True

    # Common internal identifiers
    internal_patterns = [
        r'^entry$',
        r'^n[0-9]+$',
        r'^_[a-zA-Z_][a-zA-Z0-9_]*$',
        r'^media_[0-9]+$',
        r'^obj_[0-9]+$',
        r'^tmp[0-9]*$',
        r'^temp[0-9]*$',
    ]

    for pattern in internal_patterns:
        if re.match(pattern, name):
            return True

    return False


def decode_all_text_properties(obj: Any, context: DeobfuscationContext) -> None:
    """
    Decode all text properties of an object using best-effort decoding.
    Modifies the object in-place.
    """
    decoder = TextDecoder(context)

    # Define text properties to decode for each object type
    text_properties = {
        'cartridge': ['name', 'description', 'author', 'company', 'version'],
        'zone': ['name', 'description'],
        'media': ['name', 'description', 'filename'],
        'input': ['name', 'description'],
        'message': ['title', 'text'],
        'button': ['label'],
        'choice': ['name'],
    }

    obj_type = getattr(obj, '__class__', None)
    if obj_type:
        obj_type_name = obj_type.__name__.lower()
    else:
        # Try to infer from attributes
        if hasattr(obj, 'zones') and hasattr(obj, 'messages'):
            obj_type_name = 'cartridge'
        elif hasattr(obj, 'points') or hasattr(obj, 'visible'):
            obj_type_name = 'zone'
        elif hasattr(obj, 'mime_type') or hasattr(obj, 'filename'):
            obj_type_name = 'media'
        elif hasattr(obj, 'choices'):
            obj_type_name = 'input'
        elif hasattr(obj, 'buttons'):
            obj_type_name = 'message'
        else:
            obj_type_name = 'unknown'

    properties = text_properties.get(obj_type_name, [])

    for prop in properties:
        if hasattr(obj, prop):
            value = getattr(obj, prop)
            if value and isinstance(value, str):
                # Skip internal identifiers
                if is_internal_identifier(value):
                    continue

                decoded, debug = decoder.decode_text_best_effort(value)
                if decoded != value:
                    setattr(obj, prop, decoded)

    # Handle buttons (list of Button objects)
    if hasattr(obj, 'buttons') and obj.buttons:
        for button in obj.buttons:
            if hasattr(button, 'label') and button.label:
                if not is_internal_identifier(button.label):
                    decoded, _ = decoder.decode_text_best_effort(button.label)
                    button.label = decoded

    # Handle choices (list of strings or Choice objects)
    if hasattr(obj, 'choices') and obj.choices:
        decoded_choices = []
        for choice in obj.choices:
            if isinstance(choice, str):
                if not is_internal_identifier(choice):
                    decoded, _ = decoder.decode_text_best_effort(choice)
                    decoded_choices.append(decoded)
                else:
                    decoded_choices.append(choice)
            elif hasattr(choice, 'name') and choice.name:
                if not is_internal_identifier(choice.name):
                    decoded, _ = decoder.decode_text_best_effort(choice.name)
                    choice.name = decoded
                decoded_choices.append(choice)
        if decoded_choices and isinstance(obj.choices[0], str):
            obj.choices = decoded_choices

    # Add any warnings
    context.warnings.extend(decoder.warnings)
