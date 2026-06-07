"""Lua static analyzer for Wherigo cartridges.

Analyzes decompiled Lua files to extract Wherigo objects, zones, media,
inputs, messages, and probable answers.
"""

from __future__ import annotations

import re
from typing import Dict, List, Optional, Tuple, Any
from pathlib import Path
import logging

logger = logging.getLogger(__name__)

try:
    from .models import (
        WherigoAnalysisResult,
        WherigoZone,
        WherigoMedia,
        WherigoCharacter,
        WherigoItem,
        WherigoTask,
        WherigoTimer,
        WherigoInput,
        WherigoMessage,
        WherigoCartridge,
        WherigoPoint,
        DetectedAnswer,
        SourceInfo,
        LuaInfo,
    )
except ImportError:
    from models import (
        WherigoAnalysisResult,
        WherigoZone,
        WherigoMedia,
        WherigoCharacter,
        WherigoItem,
        WherigoTask,
        WherigoTimer,
        WherigoInput,
        WherigoMessage,
        WherigoCartridge,
        WherigoPoint,
        DetectedAnswer,
        SourceInfo,
        LuaInfo,
    )


class UrwigoDecoder:
    """Decoder for Urwigo obfuscated strings."""

    @staticmethod
    def _decode_lua_escapes(s: str) -> str:
        """Convert Lua escape sequences in a string to actual characters."""
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

                # \a, \b, \f, \n, \r, \t, \v, \\, \", \' - single char escapes
                elif next_char in 'abfnrtv\\"\'':
                    escape_map = {
                        'a': '\x07', 'b': '\x08', 'f': '\x0c',
                        'n': '\x0a', 'r': '\x0d', 't': '\t', 'v': '\x0b',
                        '\\': '\\', '"': '"', "'": "'",
                    }
                    result.append(escape_map[next_char])
                    i += 2
                    continue

                # \0-\7 - octal escape (up to 3 octal digits, value <= 255)
                elif next_char in '01234567':
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

    @classmethod
    def extract_table(cls, lua_content: str) -> str:
        """Extract and decode the deobfuscation table from Lua content."""
        # Find the dtable definition
        table_match = re.search(r'dtable\s*=\s*"([^"]+)"', lua_content)
        if table_match:
            raw_table = table_match.group(1)
            return cls._decode_lua_escapes(raw_table)
        return ""

    @classmethod
    def decode(cls, obfuscated: str, table: str = None, lua_content: str = None) -> str:
        """Decode an obfuscated Urwigo string."""
        if not table:
            if lua_content:
                table = cls.extract_table(lua_content)
            else:
                return obfuscated  # Cannot decode without table

        if not table or len(table) < 127:
            return obfuscated  # Invalid table

        result = ""
        for char in obfuscated:
            b = ord(char)
            if 0 < b <= 127 and b <= len(table):
                result += table[b - 1]  # 1-based index
            else:
                result += char
        return result

    @classmethod
    def extract_and_decode(cls, lua_content: str) -> dict:
        """Extract all _m9REO("...") calls and decode them."""
        # Extract the table first
        table = cls.extract_table(lua_content)
        if not table:
            return {}

        # Find all obfuscated strings
        pattern = re.compile(r'_m9REO\s*\(\s*"([^"]+)"\s*\)')
        matches = pattern.findall(lua_content)

        decoded = {}
        for match in matches:
            try:
                decoded[match] = cls.decode(match, table)
            except:
                decoded[match] = match

        return decoded


class LuaAnalyzer:
    """Analyzes Lua files to extract Wherigo objects."""

    # Patterns for Wherigo object creation
    # Match both: obj = Wherigo.Zone(...) and obj = Wherigo.Zone({...})
    OBJECT_PATTERNS = {
        'zone': re.compile(
            r'(\w+)\s*=\s*(?:Wherigo|ZCharacter|ZItem|ZMedia|ZTask|ZTimer|ZInput)?\.?Zone\s*[\(\{]',
            re.IGNORECASE
        ),
        'media': re.compile(
            r'(\w+)\s*=\s*(?:Wherigo|ZCharacter|ZItem|ZMedia|ZTask|ZTimer|ZInput)?\.?ZMedia\s*[\(\{]',
            re.IGNORECASE
        ),
        'character': re.compile(
            r'(\w+)\s*=\s*(?:Wherigo|ZCharacter|ZItem|ZMedia|ZTask|ZTimer|ZInput)?\.?ZCharacter\s*[\(\{]',
            re.IGNORECASE
        ),
        'item': re.compile(
            r'(\w+)\s*=\s*(?:Wherigo|ZCharacter|ZItem|ZMedia|ZTask|ZTimer|ZInput)?\.?ZItem\s*[\(\{]',
            re.IGNORECASE
        ),
        'task': re.compile(
            r'(\w+)\s*=\s*(?:Wherigo|ZCharacter|ZItem|ZMedia|ZTask|ZTimer|ZInput)?\.?ZTask\s*[\(\{]',
            re.IGNORECASE
        ),
        'timer': re.compile(
            r'(\w+)\s*=\s*(?:Wherigo|ZCharacter|ZItem|ZMedia|ZTask|ZTimer|ZInput)?\.?ZTimer\s*[\(\{]',
            re.IGNORECASE
        ),
        'input': re.compile(
            r'(\w+)\s*=\s*(?:Wherigo|ZCharacter|ZItem|ZMedia|ZTask|ZTimer|ZInput)?\.?ZInput\s*[\(\{]',
            re.IGNORECASE
        ),
    }

    # Property extraction patterns (handles both plain and _m9REO obfuscated values)
    PROPERTY_PATTERNS = {
        'id': re.compile(r'\bId\s*=\s*["\']([^"\']+)["\']', re.IGNORECASE),
        # Name can be plain text or _m9REO obfuscated
        'name': re.compile(r'\bName\s*=\s*(?:_m9REO\s*\(\s*["\']([^"\']+)["\']\s*\)|["\']([^"\']+)["\'])', re.IGNORECASE),
        # Description can be plain text or _m9REO obfuscated
        'description': re.compile(r'\bDescription\s*=\s*(?:_m9REO\s*\(\s*["\']([^"\']*?)["\']\s*\)|["\']([^"\']*?)["\'])(?:\s*[,;]|\s*$)', re.IGNORECASE | re.DOTALL),
        'visible': re.compile(r'\bVisible\s*=\s*(true|false)', re.IGNORECASE),
        'active': re.compile(r'\bActive\s*=\s*(true|false)', re.IGNORECASE),
        'media': re.compile(r'\bMedia\s*=\s*(\w+)', re.IGNORECASE),
        'icon': re.compile(r'\bIcon\s*=\s*(\w+)', re.IGNORECASE),
        'distance_range': re.compile(r'\bDistanceRange\s*=\s*([\d.]+)', re.IGNORECASE),
        'proximity_range': re.compile(r'\bProximityRange\s*=\s*([\d.]+)', re.IGNORECASE),
        'duration': re.compile(r'\bDuration\s*=\s*([\d.]+)', re.IGNORECASE),
        'input_type': re.compile(r'\bType\s*=\s*["\']([^"\']+)["\']', re.IGNORECASE),
        'choices': re.compile(r'\bChoices\s*=\s*\{([^}]+)\}', re.IGNORECASE),
        'text': re.compile(r'\bText\s*=\s*["\']([^"\']*?)["\'](?:\s*[,;]|\s*$)', re.IGNORECASE | re.DOTALL),
        'button_text': re.compile(r'\bButtonText\s*=\s*["\']([^"\']+)["\']', re.IGNORECASE),
        'completion_code': re.compile(r'\bCompletionCode\s*=\s*["\']([^"\']+)["\']', re.IGNORECASE),
    }

    # Coordinate patterns
    COORD_PATTERNS = {
        'zonepoint': re.compile(
            r'Wherigo\.ZonePoint\s*\(\s*(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)\s*(?:,\s*(-?\d+\.?\d*))?\s*\)',
            re.IGNORECASE
        ),
        'point': re.compile(
            r'Wherigo\.Point\s*\(\s*(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)\s*(?:,\s*(-?\d+\.?\d*))?\s*\)',
            re.IGNORECASE
        ),
        'original_point': re.compile(
            r'(?:\w+\.)?OriginalPoint\s*=\s*(?:Wherigo\.)?ZonePoint\s*\(\s*(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)\s*(?:,\s*(-?\d+\.?\d*))?\s*\)',
            re.IGNORECASE
        ),
        'point_assignment': re.compile(
            r'(?:\w+\.)?Point\s*=\s*(?:Wherigo\.)?ZonePoint\s*\(\s*(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)\s*(?:,\s*(-?\d+\.?\d*))?\s*\)',
            re.IGNORECASE
        ),
        'zonepoint_inline': re.compile(
            r'(?:Wherigo\.)?ZonePoint\s*\(\s*(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)\s*(?:,\s*(-?\d+\.?\d*))?\s*\)',
            re.IGNORECASE
        ),
    }

    # Message patterns - simplified, just to find the start of calls
    MESSAGE_PATTERNS = {
        'messagebox': re.compile(
            r'Wherigo\.MessageBox\s*\(\s*\{',
            re.IGNORECASE
        ),
        'dialog': re.compile(
            r'Wherigo\.Dialog\s*\(\s*\{',
            re.IGNORECASE
        ),
    }

    # Additional patterns for extracting message properties
    MESSAGE_PROPERTY_PATTERNS = {
        'text': re.compile(
            r'(?:^|,|\{)\s*Text\s*=\s*"([^"]*)"',
            re.IGNORECASE
        ),
        'text_obfuscated': re.compile(
            r'(?:^|,|\{)\s*Text\s*=\s*_m9REO\s*\(\s*"([^"]+)"\s*\)',
            re.IGNORECASE
        ),
        'title': re.compile(
            r'(?:^|,|\{)\s*Title\s*=\s*"([^"]*)"',
            re.IGNORECASE
        ),
        'title_obfuscated': re.compile(
            r'(?:^|,|\{)\s*Title\s*=\s*_m9REO\s*\(\s*"([^"]+)"\s*\)',
            re.IGNORECASE
        ),
        'media': re.compile(
            r'(?:^|,|\{)\s*Media\s*=\s*([A-Za-z_][A-Za-z0-9_]*)',
            re.IGNORECASE
        ),
        'buttons': re.compile(
            r'(?:^|,|\{)\s*Buttons\s*=\s*\{([^}]+)\}',
            re.IGNORECASE
        ),
    }

    # Answer detection patterns
    ANSWER_PATTERNS = {
        'plain_equality': re.compile(
            r'(?:if|elseif)\s+\(?\s*input\s*==\s*["\']([^"\']+)["\']\s*\)?',
            re.IGNORECASE
        ),
        'nocase_equals': re.compile(
            r'Wherigo\.NoCaseEquals\s*\(\s*input\s*,\s*["\']([^"\']+)["\']\s*\)',
            re.IGNORECASE
        ),
        'numeric_comparison': re.compile(
            r'(?:if|elseif)\s+\(?\s*input\s*(==|~=)\s*(\d+)\s*\)?',
            re.IGNORECASE
        ),
        'urwigo_hash': re.compile(
            r'_Urwigo\.Hash\s*\(\s*string\.lower\s*\(\s*input\s*\)\s*\)\s*==\s*(\d+)',
            re.IGNORECASE
        ),
    }

    def __init__(self):
        self.warnings: List[str] = []
        self.errors: List[str] = []

    def analyze_file(self, file_path: str | Path) -> WherigoAnalysisResult:
        """Analyze a Lua file."""
        path = Path(file_path)
        if not path.exists():
            return self._error_result(f"File not found: {file_path}")

        try:
            content = path.read_text(encoding='utf-8', errors='ignore')
            return self.analyze_content(content, filename=path.name)
        except Exception as e:
            return self._error_result(f"Error reading file: {e}")

    def analyze_content(self, content: str, filename: str = "script.lua") -> WherigoAnalysisResult:
        """Analyze Lua content directly."""
        result = WherigoAnalysisResult()
        result.source = SourceInfo(
            filename=filename,
            type="lua",
            status="ok"
        )
        result.lua = LuaInfo(available=True, decompiled=True, decompiler="manual")

        # Debug: log content preview
        content_preview = content[:200].replace('\n', ' ')
        logger.info(f"Analyzing Lua content: {len(content)} chars, preview: {content_preview}...")

        lines = content.split('\n')

        # Detect and parse objects
        objects = self._detect_objects(content)
        logger.info(f"Detected {len(objects)} objects: {[o[0]+':'+o[1] for o in objects[:5]]}")

        for obj_type, obj_name, start_line, end_line in objects:
            block_content = '\n'.join(lines[start_line:end_line])

            if obj_type == 'zone':
                zone = self._parse_zone(obj_name, block_content, content)
                if zone:
                    result.zones.append(zone)
            elif obj_type == 'media':
                media = self._parse_media(obj_name, block_content)
                if media:
                    result.media.append(media)
            elif obj_type == 'character':
                char = self._parse_character(obj_name, block_content)
                if char:
                    result.characters.append(char)
            elif obj_type == 'item':
                item = self._parse_item(obj_name, block_content)
                if item:
                    result.items.append(item)
            elif obj_type == 'task':
                task = self._parse_task(obj_name, block_content)
                if task:
                    result.tasks.append(task)
            elif obj_type == 'timer':
                timer = self._parse_timer(obj_name, block_content)
                if timer:
                    result.timers.append(timer)
            elif obj_type == 'input':
                input_obj = self._parse_input(obj_name, block_content, content)
                if input_obj:
                    result.inputs.append(input_obj)

        # Extract messages
        result.messages = self._extract_messages(content)

        # Extract cartridge metadata
        result.cartridge = self._extract_cartridge_metadata(content)

        # Set status
        if not any([result.zones, result.media, result.inputs, result.messages]):
            result.source.status = "partial"
            self.warnings.append("No Wherigo objects detected in the Lua file")

        result.source.warnings = self.warnings
        result.source.errors = self.errors

        return result

    def _detect_objects(self, content: str) -> List[Tuple[str, str, int, int]]:
        """Detect Wherigo objects in the content."""
        objects = []
        lines = content.split('\n')

        for i, line in enumerate(lines):
            for obj_type, pattern in self.OBJECT_PATTERNS.items():
                match = pattern.search(line)
                if match:
                    obj_name = match.group(1)
                    # Find the end of this object block
                    end_line = self._find_object_end(lines, i)
                    objects.append((obj_type, obj_name, i, end_line))

        return objects

    def _find_object_end(self, lines: List[str], start_idx: int) -> int:
        """Find the end of an object definition block."""
        brace_count = 0
        in_braces = False
        has_braces = False

        for i in range(start_idx, len(lines)):
            line = lines[i]
            for char in line:
                if char == '{':
                    brace_count += 1
                    has_braces = True
                    in_braces = True
                elif char == '}':
                    brace_count -= 1
                    if brace_count == 0 and in_braces:
                        in_braces = False

        # For Urwigo-style objects: find where properties for THIS object end
        # Get the object name from the start line
        start_line = lines[start_idx]
        obj_name_match = re.match(r'^(\w+)\s*=', start_line.strip())
        if not obj_name_match:
            return len(lines)

        obj_name = obj_name_match.group(1)

        # For Urwigo-style: properties are obj_name.Property = ...
        # Continue until we find a new object definition that doesn't start with obj_name.
        last_prop_line = start_idx

        for i in range(start_idx + 1, len(lines)):
            line = lines[i]
            stripped = line.strip()

            # Check for property assignment (obj_name.xxx = ...)
            if re.match(rf'^{re.escape(obj_name)}\.', stripped):
                last_prop_line = i
                continue

            # Check for empty line - might be end of object
            if stripped == '':
                continue

            # Check for new object definition (different name = Wherigo.xxx)
            new_obj_match = re.match(r'^(\w+)\s*=\s*Wherigo\.\w+', stripped)
            if new_obj_match:
                new_name = new_obj_match.group(1)
                if not new_name.startswith(obj_name):
                    return last_prop_line + 1 if last_prop_line > start_idx else i

            # Check for function definition
            if re.match(r'^function\s+\w+', stripped):
                return last_prop_line + 1 if last_prop_line > start_idx else i

            # Check for closing braces at start of line
            # BUT only return if next non-empty line is NOT a property of this object
            if stripped == '}' and has_braces:
                # Look ahead to see if there's a property for this object after the closing brace
                for j in range(i + 1, min(i + 5, len(lines))):
                    next_line = lines[j].strip()
                    if next_line == '':
                        continue
                    if re.match(rf'^{re.escape(obj_name)}\.', next_line):
                        # It's a property of this object, continue
                        last_prop_line = j
                        break
                    if re.match(r'^(\w+)\s*=\s*Wherigo\.\w+', next_line):
                        new_name_match = re.match(r'^(\w+)\s*=\s*Wherigo\.\w+', next_line)
                        if new_name_match and not new_name_match.group(1).startswith(obj_name):
                            # It's a new object, we're done
                            return last_prop_line + 1 if last_prop_line > start_idx else i
                        break
                    if re.match(r'^function\s+\w+', next_line):
                        return last_prop_line + 1 if last_prop_line > start_idx else i
                    break
                continue

        return len(lines)

    def _decode_obfuscated(self, content: str, encoded: str) -> str:
        """Decode an obfuscated string using the _m9REO table from content."""
        # First, decode any Lua escape sequences in the encoded string
        # (e.g., \a -> bell, \xNN -> hex byte, etc.)
        decoded_escapes = UrwigoDecoder._decode_lua_escapes(encoded)
        return UrwigoDecoder.decode(decoded_escapes, lua_content=content)

    def _parse_zone(self, name: str, content: str, full_lua_content: str = None) -> Optional[WherigoZone]:
        """Parse a Zone object from its content."""
        zone = WherigoZone(internal_name=name, raw=content[:500])

        # Extract properties (handle both plain and obfuscated)
        for prop_name, pattern in self.PROPERTY_PATTERNS.items():
            match = pattern.search(content)
            if match:
                # For name/description, group(1) is obfuscated, group(2) is plain
                if prop_name in ('name', 'description'):
                    value = match.group(1) if match.group(1) else match.group(2)
                else:
                    value = match.group(1)

                # Decode if obfuscated
                if prop_name in ('name', 'description') and match.group(1):
                    # Use full Lua content to access the deobfuscation table
                    decode_source = full_lua_content if full_lua_content else content
                    value = self._decode_obfuscated(decode_source, match.group(1))

                if prop_name == 'id':
                    zone.id = value
                elif prop_name == 'name':
                    zone.name = value
                elif prop_name == 'description':
                    zone.description = value.replace('\\n', '\n')
                elif prop_name == 'visible':
                    zone.visible = value.lower() == 'true'
                elif prop_name == 'active':
                    zone.active = value.lower() == 'true'
                elif prop_name == 'media':
                    zone.media = value
                elif prop_name == 'icon':
                    zone.icon = value
                elif prop_name == 'distance_range':
                    try:
                        zone.distance_range = float(value)
                    except ValueError:
                        pass
                elif prop_name == 'proximity_range':
                    try:
                        zone.proximity_range = float(value)
                    except ValueError:
                        pass

        # Extract OriginalPoint
        orig_match = self.COORD_PATTERNS['original_point'].search(content)
        if orig_match:
            zone.original_point = WherigoPoint(
                lat=float(orig_match.group(1)),
                lon=float(orig_match.group(2)),
                alt=float(orig_match.group(3)) if orig_match.group(3) else None
            )

        # Extract Points array (polygon vertices)
        points_match = re.search(
            r'\bPoints\s*=\s*\{([^}]+)\}',
            content,
            re.IGNORECASE | re.DOTALL
        )
        if points_match:
            points_content = points_match.group(1)
            zonepoint_matches = self.COORD_PATTERNS['zonepoint_inline'].findall(points_content)
            for match in zonepoint_matches:
                zone.points.append(WherigoPoint(
                    lat=float(match[0]),
                    lon=float(match[1]),
                    alt=float(match[2]) if match[2] else None
                ))

        # Also extract any standalone ZonePoint calls in the content
        if not zone.points:
            point_matches = self.COORD_PATTERNS['zonepoint_inline'].findall(content)
            for match in point_matches:
                # Skip if already added as original_point
                lat, lon = float(match[0]), float(match[1])
                if zone.original_point and zone.original_point.lat == lat and zone.original_point.lon == lon:
                    continue
                zone.points.append(WherigoPoint(
                    lat=lat,
                    lon=lon,
                    alt=float(match[2]) if match[2] else None
                ))

        return zone

    def _parse_media(self, name: str, content: str) -> Optional[WherigoMedia]:
        """Parse a Media object from its content."""
        media = WherigoMedia(internal_name=name, raw=content[:500])

        for prop_name, pattern in self.PROPERTY_PATTERNS.items():
            match = pattern.search(content)
            if match:
                value = match.group(1)
                if prop_name == 'id':
                    media.id = value
                elif prop_name == 'name':
                    media.name = value
                elif prop_name == 'description':
                    media.description = value
                elif prop_name == 'alt_text':
                    media.alt_text = value

        return media

    def _parse_character(self, name: str, content: str) -> Optional[WherigoCharacter]:
        """Parse a Character object from its content."""
        char = WherigoCharacter(internal_name=name, raw=content[:500])

        for prop_name, pattern in self.PROPERTY_PATTERNS.items():
            match = pattern.search(content)
            if match:
                value = match.group(1)
                if prop_name == 'id':
                    char.id = value
                elif prop_name == 'name':
                    char.name = value
                elif prop_name == 'description':
                    char.description = value
                elif prop_name == 'visible':
                    char.visible = value.lower() == 'true'
                elif prop_name == 'media':
                    char.media = value
                elif prop_name == 'icon':
                    char.icon = value

        return char

    def _parse_item(self, name: str, content: str) -> Optional[WherigoItem]:
        """Parse an Item object from its content."""
        item = WherigoItem(internal_name=name, raw=content[:500])

        for prop_name, pattern in self.PROPERTY_PATTERNS.items():
            match = pattern.search(content)
            if match:
                value = match.group(1)
                if prop_name == 'id':
                    item.id = value
                elif prop_name == 'name':
                    item.name = value
                elif prop_name == 'description':
                    item.description = value
                elif prop_name == 'visible':
                    item.visible = value.lower() == 'true'
                elif prop_name == 'media':
                    item.media = value
                elif prop_name == 'icon':
                    item.icon = value

        return item

    def _parse_task(self, name: str, content: str) -> Optional[WherigoTask]:
        """Parse a Task object from its content."""
        task = WherigoTask(internal_name=name, raw=content[:500])

        for prop_name, pattern in self.PROPERTY_PATTERNS.items():
            match = pattern.search(content)
            if match:
                value = match.group(1)
                if prop_name == 'id':
                    task.id = value
                elif prop_name == 'name':
                    task.name = value
                elif prop_name == 'description':
                    task.description = value
                elif prop_name == 'visible':
                    task.visible = value.lower() == 'true'
                elif prop_name == 'active':
                    task.active = value.lower() == 'true'

        return task

    def _parse_timer(self, name: str, content: str) -> Optional[WherigoTimer]:
        """Parse a Timer object from its content."""
        timer = WherigoTimer(internal_name=name, raw=content[:500])

        for prop_name, pattern in self.PROPERTY_PATTERNS.items():
            match = pattern.search(content)
            if match:
                value = match.group(1)
                if prop_name == 'id':
                    timer.id = value
                elif prop_name == 'name':
                    timer.name = value
                elif prop_name == 'duration':
                    try:
                        timer.duration = int(float(value))
                    except ValueError:
                        pass

        return timer

    def _parse_input(self, name: str, content: str, full_content: str) -> Optional[WherigoInput]:
        """Parse an Input object from its content."""
        inp = WherigoInput(internal_name=name, raw=content[:500])

        for prop_name, pattern in self.PROPERTY_PATTERNS.items():
            match = pattern.search(content)
            if match:
                # For name/description, group(1) is obfuscated, group(2) is plain
                if prop_name in ('name', 'description'):
                    value = match.group(1) if match.group(1) else match.group(2)
                else:
                    value = match.group(1)

                # Decode if obfuscated
                if prop_name in ('name', 'description') and match.group(1):
                    value = self._decode_obfuscated(full_content, match.group(1))

                if prop_name == 'id':
                    inp.id = value
                elif prop_name == 'name':
                    inp.name = value
                elif prop_name == 'description':
                    inp.description = value
                elif prop_name == 'input_type':
                    inp.input_type = value
                elif prop_name == 'choices':
                    # Parse choices list
                    choices_str = value
                    inp.choices = self._parse_choices(choices_str)

        # Find the OnGetInput handler for this input (format: "name:OnGetInput" or "name_OnGetInput")
        inp.handler = f"{name}:OnGetInput"

        # Extract answers from the handler
        inp.answers = self._extract_answers_from_handler(full_content, name)

        return inp

    def _parse_choices(self, choices_str: str) -> List[str]:
        """Parse a Lua choices string into a list."""
        choices = []
        # Match quoted strings in the choices list
        for match in re.finditer(r'["\']([^"\']+)["\']', choices_str):
            choices.append(match.group(1))
        return choices

    def _extract_answers_from_handler(self, content: str, input_name: str) -> List[DetectedAnswer]:
        """Extract probable answers from an OnGetInput handler."""
        answers = []

        # Find the handler function (format: function input_name:OnGetInput(input) ... end)
        handler_pattern = re.compile(
            rf'function\s+{re.escape(input_name)}:OnGetInput\s*\(\s*input\s*\)(.+?)(?=function\s+\w+[:\.]\w+\s*\(|function\s+\w+\s*\(|$)',
            re.IGNORECASE | re.DOTALL
        )
        handler_match = handler_pattern.search(content)

        if not handler_match:
            return answers

        handler_content = handler_match.group(1)

        # Extract plain text answers
        for match in self.ANSWER_PATTERNS['plain_equality'].finditer(handler_content):
            answers.append(DetectedAnswer(
                value=match.group(1),
                method="plain_text",
                confidence="high",
                source=f"{input_name}:OnGetInput: input == comparison"
            ))

        # Extract NoCaseEquals answers
        for match in self.ANSWER_PATTERNS['nocase_equals'].finditer(handler_content):
            answers.append(DetectedAnswer(
                value=match.group(1),
                method="nocase",
                confidence="high",
                source=f"{input_name}:OnGetInput: Wherigo.NoCaseEquals"
            ))

        # Extract numeric comparisons
        for match in self.ANSWER_PATTERNS['numeric_comparison'].finditer(handler_content):
            answers.append(DetectedAnswer(
                value=match.group(2),
                method="numeric",
                confidence="high",
                source=f"{input_name}:OnGetInput: numeric comparison"
            ))

        # Extract Urwigo hash comparisons (hash protected)
        for match in self.ANSWER_PATTERNS['urwigo_hash'].finditer(handler_content):
            hash_value = match.group(1)
            answers.append(DetectedAnswer(
                value=f"[HASH:{hash_value}]",
                method="urwigo_hash",
                confidence="low",  # Hash cannot be reversed easily
                source=f"{input_name}:OnGetInput: Urwigo.Hash protected"
            ))

        return answers

    def _find_wherigo_calls(self, content: str, call_type: str = "MessageBox") -> List[Tuple[int, int, str]]:
        """Find Wherigo calls with balanced brace counting.

        Args:
            content: Lua source code
            call_type: "MessageBox" or "Dialog"

        Returns:
            List of (start_pos, end_pos, call_content) tuples
        """
        results = []
        pattern = self.MESSAGE_PATTERNS.get(call_type.lower(), self.MESSAGE_PATTERNS['messagebox'])

        for match in pattern.finditer(content):
            start_pos = match.start()
            # Find the opening brace position (after "Wherigo.Call("
            open_brace_pos = content.find('{', match.end() - 1)
            if open_brace_pos == -1:
                continue

            # Count braces to find the matching closing brace
            brace_count = 1
            pos = open_brace_pos + 1

            while pos < len(content) and brace_count > 0:
                char = content[pos]
                if char == '{':
                    brace_count += 1
                elif char == '}':
                    brace_count -= 1
                elif char == '"':
                    # Skip string literals
                    pos += 1
                    while pos < len(content) and content[pos] != '"':
                        if content[pos] == '\\' and pos + 1 < len(content):
                            pos += 2
                        else:
                            pos += 1
                    # Skip past the closing quote
                    if pos < len(content) and content[pos] == '"':
                        pos += 1
                    continue
                pos += 1

            if brace_count == 0:
                # Found the matching closing brace
                # Include the closing parenthesis of the function call
                end_pos = pos
                while end_pos < len(content) and content[end_pos] in ' \t\n)':
                    if content[end_pos] == ')':
                        end_pos += 1
                        break
                    end_pos += 1

                call_content = content[open_brace_pos:pos-1]  # Content inside the braces
                results.append((start_pos, end_pos, call_content))

        return results

    def _extract_buttons(self, buttons_content: str) -> List[str]:
        """Extract button labels from Buttons table content."""
        buttons = []
        # Match quoted strings in the buttons table
        for match in re.finditer(r'"([^"]*)"', buttons_content):
            buttons.append(match.group(1))
        # Also match _m9REO calls for obfuscated buttons
        for match in re.finditer(r'_m9REO\s*\(\s*"([^"]+)"\s*\)', buttons_content):
            obfuscated = match.group(1)
            # Try to decode if we can
            buttons.append(f"[obfuscated:{obfuscated[:20]}...]")
        return buttons

    def _extract_messages(self, content: str) -> List[WherigoMessage]:
        """Extract MessageBox and Dialog calls using balanced brace parsing."""
        messages = []

        # Extract MessageBox calls
        for start_pos, end_pos, msg_content in self._find_wherigo_calls(content, "MessageBox"):
            msg = WherigoMessage(type="messagebox", raw=content[start_pos:end_pos][:200])

            # Extract Text (plain or obfuscated)
            text_match = self.MESSAGE_PROPERTY_PATTERNS['text'].search(msg_content)
            if text_match:
                msg.text = text_match.group(1).replace('\\n', '\n')
            else:
                text_obf_match = self.MESSAGE_PROPERTY_PATTERNS['text_obfuscated'].search(msg_content)
                if text_obf_match:
                    encoded = text_obf_match.group(1)
                    decoded = self._decode_obfuscated(content, encoded)
                    msg.text = decoded

            # Extract Title (plain or obfuscated)
            title_match = self.MESSAGE_PROPERTY_PATTERNS['title'].search(msg_content)
            if title_match:
                msg.title = title_match.group(1).replace('\\n', '\n')
            else:
                title_obf_match = self.MESSAGE_PROPERTY_PATTERNS['title_obfuscated'].search(msg_content)
                if title_obf_match:
                    encoded = title_obf_match.group(1)
                    decoded = self._decode_obfuscated(content, encoded)
                    msg.title = decoded

            # Extract Media
            media_match = self.MESSAGE_PROPERTY_PATTERNS['media'].search(msg_content)
            if media_match:
                msg.media = media_match.group(1)

            # Extract Buttons
            buttons_match = self.MESSAGE_PROPERTY_PATTERNS['buttons'].search(msg_content)
            if buttons_match:
                msg.buttons = self._extract_buttons(buttons_match.group(1))

            messages.append(msg)

        # Extract Dialog calls
        for start_pos, end_pos, msg_content in self._find_wherigo_calls(content, "Dialog"):
            msg = WherigoMessage(type="dialog", raw=content[start_pos:end_pos][:200])

            # Extract Text (plain or obfuscated)
            text_match = self.MESSAGE_PROPERTY_PATTERNS['text'].search(msg_content)
            if text_match:
                msg.text = text_match.group(1).replace('\\n', '\n')
            else:
                text_obf_match = self.MESSAGE_PROPERTY_PATTERNS['text_obfuscated'].search(msg_content)
                if text_obf_match:
                    encoded = text_obf_match.group(1)
                    decoded = self._decode_obfuscated(content, encoded)
                    msg.text = decoded

            # Extract Title (plain or obfuscated)
            title_match = self.MESSAGE_PROPERTY_PATTERNS['title'].search(msg_content)
            if title_match:
                msg.title = title_match.group(1).replace('\\n', '\n')
            else:
                title_obf_match = self.MESSAGE_PROPERTY_PATTERNS['title_obfuscated'].search(msg_content)
                if title_obf_match:
                    encoded = title_obf_match.group(1)
                    decoded = self._decode_obfuscated(content, encoded)
                    msg.title = decoded

            # Extract Media
            media_match = self.MESSAGE_PROPERTY_PATTERNS['media'].search(msg_content)
            if media_match:
                msg.media = media_match.group(1)

            # Extract Buttons
            buttons_match = self.MESSAGE_PROPERTY_PATTERNS['buttons'].search(msg_content)
            if buttons_match:
                msg.buttons = self._extract_buttons(buttons_match.group(1))

            messages.append(msg)

        return messages

    def _extract_cartridge_metadata(self, content: str) -> WherigoCartridge:
        """Extract cartridge metadata from Lua content."""
        cartridge = WherigoCartridge()

        # Try to find the Cartridge table definition first
        # Pattern: Cartridge = { ... } or local Cartridge = { ... }
        cartridge_table_pattern = re.compile(
            r'(?:local\s+)?Cartridge\s*=\s*\{([^}]+)\}',
            re.IGNORECASE | re.DOTALL
        )

        cartridge_match = cartridge_table_pattern.search(content)
        if cartridge_match:
            cartridge_content = cartridge_match.group(1)

            # Extract from cartridge table
            name_match = re.search(r'\bName\s*=\s*["\']([^"\']+)["\']', cartridge_content, re.IGNORECASE)
            if name_match:
                cartridge.name = name_match.group(1)

            desc_match = re.search(r'\bDescription\s*=\s*["\']([^"\']*?)["\']', cartridge_content, re.IGNORECASE | re.DOTALL)
            if desc_match:
                cartridge.description = desc_match.group(1).replace('\\n', '\n')

            author_match = re.search(r'\bAuthor\s*=\s*["\']([^"\']+)["\']', cartridge_content, re.IGNORECASE)
            if author_match:
                cartridge.author = author_match.group(1)

            version_match = re.search(r'\bVersion\s*=\s*["\']([^"\']+)["\']', cartridge_content, re.IGNORECASE)
            if version_match:
                cartridge.version = version_match.group(1)

            completion_match = re.search(r'\bCompletionCode\s*=\s*["\']([^"\']+)["\']', cartridge_content, re.IGNORECASE)
            if completion_match:
                cartridge.completion_code = completion_match.group(1)

        # Fallback to global patterns if not found in Cartridge table
        if not cartridge.name:
            name_match = re.search(r'\bName\s*=\s*["\']([^"\']+)["\']', content, re.IGNORECASE)
            if name_match:
                cartridge.name = name_match.group(1)

        if not cartridge.description:
            desc_match = re.search(r'\bDescription\s*=\s*["\']([^"\']*?)["\']', content, re.IGNORECASE | re.DOTALL)
            if desc_match:
                cartridge.description = desc_match.group(1).replace('\\n', '\n')

        if not cartridge.author:
            author_match = re.search(r'\bAuthor\s*=\s*["\']([^"\']+)["\']', content, re.IGNORECASE)
            if author_match:
                cartridge.author = author_match.group(1)

        if not cartridge.version:
            version_match = re.search(r'\bVersion\s*=\s*["\']([^"\']+)["\']', content, re.IGNORECASE)
            if version_match:
                cartridge.version = version_match.group(1)

        if not cartridge.completion_code:
            completion_match = self.PROPERTY_PATTERNS['completion_code'].search(content)
            if completion_match:
                cartridge.completion_code = completion_match.group(1)

        return cartridge

    def _error_result(self, error_message: str) -> WherigoAnalysisResult:
        """Create an error result."""
        result = WherigoAnalysisResult()
        result.source = SourceInfo(
            status="error",
            errors=[error_message]
        )
        return result
