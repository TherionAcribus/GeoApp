"""Lua static analyzer for Wherigo cartridges.

Analyzes decompiled Lua files to extract Wherigo objects, zones, media,
inputs, messages, and probable answers.
"""

from __future__ import annotations

import re
from typing import Dict, List, Optional, Tuple, Any, Union
from pathlib import Path
import logging

logger = logging.getLogger(__name__)

# Import deobfuscator
try:
    from .deobfuscators import UrwigoDeobfuscator
    from .urwigo_hash import brute_force_urwigo_common
    from .deobfuscation_utils import (
        DeobfuscationContext, TextDecoder, decode_all_text_properties,
        is_internal_identifier, decode_lua_escapes, decode_lua_escapes_to_bytes,
    )
except ImportError:
    from deobfuscators import UrwigoDeobfuscator
    from urwigo_hash import brute_force_urwigo_common
    from deobfuscation_utils import (
        DeobfuscationContext, TextDecoder, decode_all_text_properties,
        is_internal_identifier, decode_lua_escapes, decode_lua_escapes_to_bytes,
    )

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
        """Convert Lua escape sequences in a string to actual characters.

        Delegates to the unified decode_lua_escapes function.
        """
        return decode_lua_escapes(s)

    @classmethod
    def extract_table(cls, lua_content: str) -> str:
        """Extract and decode the deobfuscation table from Lua content."""
        # Find the dtable definition
        table_match = re.search(r'dtable\s*=\s*"((?:\\[\s\S]|[^"\\])*)"', lua_content)
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
    # Supports both Wherigo.MessageBox and _Urwigo.MessageBox (and Dialog variants)
    MESSAGE_PATTERNS = {
        'messagebox': re.compile(
            r'(?:Wherigo|_Urwigo)\.MessageBox\s*\(\s*\{',
            re.IGNORECASE
        ),
        'dialog': re.compile(
            r'(?:Wherigo|_Urwigo)\.Dialog\s*\(\s*(?:true\s*,\s*)?\{',
            re.IGNORECASE
        ),
    }

    # Additional patterns for extracting message properties
    # Patterns handle escaped quotes \" within strings
    MESSAGE_PROPERTY_PATTERNS = {
        'text': re.compile(
            r'(?:^|,|\{)\s*Text\s*=\s*"((?:\\[\s\S]|[^"\\])*)"',
            re.IGNORECASE
        ),
        # tostring("...") - after deobfuscation, tostring(_pJ4N("...")) becomes tostring("decoded")
        'text_tostring': re.compile(
            r'(?:^|,|\{)\s*Text\s*=\s*tostring\s*\(\s*"((?:\\[\s\S]|[^"\\])*)"\s*\)',
            re.IGNORECASE
        ),
        # Generic obfuscated: Text = <func>("...") or Text = tostring(<func>("..."))
        # Used to catch calls that weren't replaced by the deobfuscator
        'text_obfuscated': re.compile(
            r'(?:^|,|\{)\s*Text\s*=\s*(?:tostring\s*\(\s*)?([A-Za-z_]\w*)\s*\(\s*"((?:\\[\s\S]|[^"\\])*)"\s*\)\s*\)?',
            re.IGNORECASE
        ),
        'title': re.compile(
            r'(?:^|,|\{)\s*Title\s*=\s*"((?:\\[\s\S]|[^"\\])*)"',
            re.IGNORECASE
        ),
        'title_tostring': re.compile(
            r'(?:^|,|\{)\s*Title\s*=\s*tostring\s*\(\s*"((?:\\[\s\S]|[^"\\])*)"\s*\)',
            re.IGNORECASE
        ),
        'title_obfuscated': re.compile(
            r'(?:^|,|\{)\s*Title\s*=\s*(?:tostring\s*\(\s*)?([A-Za-z_]\w*)\s*\(\s*"((?:\\[\s\S]|[^"\\])*)"\s*\)\s*\)?',
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

    def analyze_content(self, content: Union[str, bytes], filename: str = "script.lua") -> WherigoAnalysisResult:
        """Analyze Lua content directly. Accepts either source code (str) or bytecode (bytes)."""
        result = WherigoAnalysisResult()
        result.source = SourceInfo(
            filename=filename,
            type="lua",
            status="ok"
        )
        result.lua = LuaInfo(available=True, decompiled=True, decompiler="manual")

        # Check if content is bytecode (Lua 5.1 bytecode starts with 0x1B "Lua")
        if isinstance(content, bytes):
            if content[:4] == b'\x1bLua':
                # It's Lua bytecode - try to decompile
                try:
                    from .lua_decompiler import decompile_bytecode
                except ImportError:
                    from lua_decompiler import decompile_bytecode
                decompiled = decompile_bytecode(content)
                if decompiled:
                    content = decompiled
                    result.lua.decompiler = "unluac"
                else:
                    result.source.warnings.append("Failed to decompile Lua bytecode")
                    content = content.decode('latin-1', errors='replace')
            else:
                # Not bytecode, decode as text
                content = content.decode('utf-8', errors='replace')

        # Store original content for debug
        original_content = content

        # Step 1: Apply Urwigo deobfuscation
        deobfuscator = UrwigoDeobfuscator()
        content, deobf_report = deobfuscator.deobfuscate(content)

        # Store deobfuscation report in result
        result.deobfuscation_report = deobf_report.to_dict() if hasattr(deobf_report, 'to_dict') else {
            'function_name': getattr(deobf_report, 'function_name', None),
            'strings_decoded': getattr(deobf_report, 'strings_decoded_by_function', 0),
        }

        if getattr(deobf_report, 'strings_decoded_by_function', 0) > 0:
            logger.info(f"Deobfuscated {deobf_report.strings_decoded_by_function} strings using {deobf_report.function_name}")
            self.warnings.append(
                f"Deobfuscated {deobf_report.strings_decoded_by_function} Urwigo strings (function: {deobf_report.function_name})"
            )

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

        # Merge warnings from deobfuscation
        if hasattr(deobf_report, 'warnings'):
            for warning in deobf_report.warnings:
                if warning not in self.warnings:
                    self.warnings.append(warning)

        result.source.warnings = self.warnings
        result.source.errors = self.errors

        # Step 2: Apply best-effort decoding to all text properties
        self._apply_best_effort_decoding(result, deobf_report)

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
        """Find the end of an object definition block.

        Handles two styles:
        1. Brace style: obj = Wherigo.Zone({...})  -- ends when braces balance
        2. Urwigo style: obj = Wherigo.Zone(cartridge) followed by obj.Prop = ...
           -- ends when a new object/function/non-property statement appears
        """
        start_line = lines[start_idx]
        obj_name_match = re.match(r'^(\w+)\s*=', start_line.strip())
        if not obj_name_match:
            return min(start_idx + 1, len(lines))
        obj_name = obj_name_match.group(1)

        # Detect brace style: the start line (or nearby) contains '{'
        has_open_brace = '{' in start_line

        if has_open_brace:
            # Brace style: count braces, skipping string literals
            brace_count = 0
            in_string = False
            string_quote = None
            for i in range(start_idx, len(lines)):
                line = lines[i]
                j = 0
                while j < len(line):
                    ch = line[j]
                    if in_string:
                        if ch == '\\' and j + 1 < len(line):
                            j += 2
                            continue
                        if ch == string_quote:
                            in_string = False
                            string_quote = None
                        j += 1
                        continue
                    if ch in ('"', "'"):
                        in_string = True
                        string_quote = ch
                        j += 1
                        continue
                    if ch == '{':
                        brace_count += 1
                    elif ch == '}':
                        brace_count -= 1
                        if brace_count == 0:
                            return i + 1
                    j += 1
            return len(lines)

        # Urwigo style: properties are obj_name.Property = ...
        # Continue until we find a new object definition, function, or non-property line
        last_prop_line = start_idx
        for i in range(start_idx + 1, len(lines)):
            stripped = lines[i].strip()
            if not stripped or stripped.startswith('--'):
                continue
            # Property assignment for this object
            if re.match(rf'^{re.escape(obj_name)}[.:]', stripped):
                last_prop_line = i
                continue
            # New object definition or function
            if re.match(r'^(\w+)\s*=\s*(?:Wherigo|_Urwigo)\.\w+', stripped):
                return last_prop_line + 1
            if re.match(r'^function\s+\w+', stripped):
                return last_prop_line + 1
            # Cartridge table or other top-level assignment
            if re.match(r'^(\w+)\s*=\s*\{', stripped):
                return last_prop_line + 1
            # If it's a property of a different object, we're done
            if re.match(r'^\w+\.', stripped):
                return last_prop_line + 1

        return last_prop_line + 1

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
                value = self._extract_property_value(match, prop_name)
                if value is None:
                    continue

                # Decode if obfuscated (group(1) was the obfuscated value)
                if prop_name in ('name', 'description') and match.group(1):
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

    def _extract_property_value(self, match, prop_name: str) -> str:
        """Extract a property value from a regex match.

        For name/description patterns, group(1) is obfuscated, group(2) is plain.
        For other patterns, group(1) is the value.
        """
        if prop_name in ('name', 'description'):
            # group(1) = obfuscated, group(2) = plain text
            return match.group(1) if match.group(1) else (match.group(2) if match.lastindex >= 2 else None)
        return match.group(1)

    def _parse_media(self, name: str, content: str) -> Optional[WherigoMedia]:
        """Parse a Media object from its content."""
        media = WherigoMedia(internal_name=name, raw=content[:500])

        for prop_name, pattern in self.PROPERTY_PATTERNS.items():
            match = pattern.search(content)
            if match:
                value = self._extract_property_value(match, prop_name)
                if value is None:
                    continue
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
                value = self._extract_property_value(match, prop_name)
                if value is None:
                    continue
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
                value = self._extract_property_value(match, prop_name)
                if value is None:
                    continue
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
                value = self._extract_property_value(match, prop_name)
                if value is None:
                    continue
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
                value = self._extract_property_value(match, prop_name)
                if value is None:
                    continue
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
                value = self._extract_property_value(match, prop_name)
                if value is None:
                    continue

                # Decode if obfuscated (group(1) was the obfuscated value)
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
        inp.answers = self._extract_answers_from_handler(full_content, name, inp.choices)

        return inp

    def _parse_choices(self, choices_str: str) -> List[str]:
        """Parse a Lua choices string into a list.

        Handles both single and double quoted strings, including strings
        that contain escaped quotes or the other quote type.
        """
        choices = []
        # Match quoted strings with proper quote handling
        # Pattern: "..." or '...' where the content can contain escaped quotes
        for match in re.finditer(r'"((?:\\[\s\S]|[^"\\])*)"|\'((?:\\[\s\S]|[^\'\\])*)\'', choices_str):
            # group(1) = double-quoted content, group(2) = single-quoted content
            raw = match.group(1) if match.group(1) is not None else match.group(2)
            choices.append(decode_lua_escapes(raw))
        return choices

    def _extract_answers_from_handler(self, content: str, input_name: str,
                                        choices: List[str] = None) -> List[DetectedAnswer]:
        """Extract probable answers from an OnGetInput handler.

        Supports both colon syntax (function name:OnGetInput) and underscore syntax
        (function name_OnGetInput).

        Args:
            content: Full Lua content
            input_name: Internal name of the input object
            choices: List of choices for this input (to match against hashes)
        """
        answers = []

        # Find the handler function - support both : and _ separators
        handler_pattern = re.compile(
            rf'function\s+{re.escape(input_name)}[:_]\s*OnGetInput\s*\(\s*input\s*\)(.+?)(?=function\s+\w+[:\.]\w+\s*\(|function\s+\w+\s*\(|$)',
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
        from urwigo_hash import urwigo_hash
        for match in self.ANSWER_PATTERNS['urwigo_hash'].finditer(handler_content):
            hash_value_str = match.group(1)
            try:
                hash_int = int(hash_value_str)
                # Run brute force to find candidates
                candidates = brute_force_urwigo_common(hash_int)
            except (ValueError, TypeError):
                candidates = {}

            # Check if any of the input's choices match the hash
            matched_choice = None
            if choices:
                for choice in choices:
                    if urwigo_hash(choice) == hash_int:
                        matched_choice = choice
                        break

            if matched_choice:
                answers.append(DetectedAnswer(
                    value=matched_choice,
                    method="urwigo_hash_matched_choice",
                    confidence="high",
                    source=f"{input_name}:OnGetInput: Urwigo.Hash matched choice",
                    candidates=candidates
                ))
            else:
                answers.append(DetectedAnswer(
                    value=f"[HASH:{hash_value_str}]",
                    method="urwigo_hash",
                    confidence="low",  # Hash cannot be reversed easily
                    source=f"{input_name}:OnGetInput: Urwigo.Hash protected",
                    candidates=candidates
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

    def _decode_lua_string(self, s: str) -> str:
        """Decode a Lua string literal, handling escape sequences.

        Delegates to the unified decode_lua_escapes function.
        """
        return decode_lua_escapes(s)

    def _extract_dialog_entries(self, content: str) -> List[WherigoMessage]:
        """Extract dialog entry tables that define Text, Media, Buttons."""
        entries = []

        # Find all Text = "..." occurrences and extract their containing table
        text_pattern = re.compile(
            r'Text\s*=\s*"((?:\\[\s\S]|[^"\\])*)"',
            re.DOTALL | re.IGNORECASE
        )

        for match in text_pattern.finditer(content):
            raw_text = match.group(1)
            text = self._decode_lua_string(raw_text)

            # Only process if text is substantial (not empty, not just whitespace)
            if len(text.strip()) < 3:
                continue

            # Find the containing table by looking backward for '{' and forward for matching '}'
            start_pos = match.start()
            brace_count = 0
            table_start = -1

            # Find opening brace
            for i in range(start_pos, -1, -1):
                if content[i] == '}':
                    brace_count += 1
                elif content[i] == '{':
                    if brace_count == 0:
                        table_start = i
                        break
                    brace_count -= 1

            if table_start == -1:
                continue

            # Find closing brace
            brace_count = 1
            table_end = -1
            for i in range(table_start + 1, len(content)):
                if content[i] == '{':
                    brace_count += 1
                elif content[i] == '}':
                    brace_count -= 1
                    if brace_count == 0:
                        table_end = i
                        break

            if table_end == -1:
                continue

            table_content = content[table_start:table_end+1]

            # Check if this table has a Media field
            entry = WherigoMessage(type="messagebox")
            entry.text = text

            media_match = re.search(r'Media\s*=\s*([A-Za-z_][A-Za-z0-9_]*)', table_content, re.IGNORECASE)
            if media_match:
                entry.media = media_match.group(1)

            buttons_match = re.search(r'Buttons\s*=\s*\{([^}]*)\}', table_content, re.IGNORECASE)
            if buttons_match:
                entry.buttons = self._extract_buttons(buttons_match.group(1))

            entries.append(entry)

        return entries

    def _extract_message_property(self, msg_content: str, full_content: str,
                                     prop: str) -> Optional[str]:
        """Extract a text property (Text/Title) from a message body.

        Handles plain strings, tostring("..."), obfuscated calls
        (<func>("...")), and tostring(<func>("...")).
        """
        # Try plain string first
        plain_match = self.MESSAGE_PROPERTY_PATTERNS[prop].search(msg_content)
        if plain_match:
            return self._decode_lua_string(plain_match.group(1))

        # Try tostring("...") - string already decoded, just extract it
        tostring_match = self.MESSAGE_PROPERTY_PATTERNS[f'{prop}_tostring'].search(msg_content)
        if tostring_match:
            return self._decode_lua_string(tostring_match.group(1))

        # Try obfuscated: group(1)=func_name, group(2)=encoded string
        # Only decode if the function name is NOT a standard Lua function
        obf_match = self.MESSAGE_PROPERTY_PATTERNS[f'{prop}_obfuscated'].search(msg_content)
        if obf_match:
            func_name = obf_match.group(1)
            # Skip standard Lua functions that aren't decoders
            if func_name not in ('tostring', 'tonumber', 'string', 'print', 'type'):
                encoded = obf_match.group(2)
                return self._decode_obfuscated(full_content, encoded)
        return None

    def _extract_messages(self, content: str) -> List[WherigoMessage]:
        """Extract MessageBox and Dialog calls using balanced brace parsing."""
        messages = []

        # First, extract dialog entry tables (for cartridges using entry.Text variables)
        dialog_entries = self._extract_dialog_entries(content)
        messages.extend(dialog_entries)

        # Extract MessageBox calls
        for start_pos, end_pos, msg_content in self._find_wherigo_calls(content, "MessageBox"):
            msg = WherigoMessage(type="messagebox", raw=content[start_pos:end_pos][:200])
            msg.text = self._extract_message_property(msg_content, content, 'text')
            msg.title = self._extract_message_property(msg_content, content, 'title')

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
            msg.text = self._extract_message_property(msg_content, content, 'text')
            msg.title = self._extract_message_property(msg_content, content, 'title')

            # Extract Media
            media_match = self.MESSAGE_PROPERTY_PATTERNS['media'].search(msg_content)
            if media_match:
                msg.media = media_match.group(1)

            # Extract Buttons
            buttons_match = self.MESSAGE_PROPERTY_PATTERNS['buttons'].search(msg_content)
            if buttons_match:
                msg.buttons = self._extract_buttons(buttons_match.group(1))

            messages.append(msg)

        # Deduplicate messages by (text, media) tuple
        seen = set()
        unique_messages = []
        for msg in messages:
            key = (msg.text or "", msg.media or "")
            if key not in seen:
                seen.add(key)
                unique_messages.append(msg)

        return unique_messages

    def _apply_best_effort_decoding(self, result: WherigoAnalysisResult, deobf_report) -> None:
        """
        Apply best-effort text decoding to all text properties in the result.
        This handles obfuscated strings that weren't caught by function replacement.
        """
        # Create context from deobfuscation report
        context = DeobfuscationContext(
            urwigo_function_name=getattr(deobf_report, 'function_name', None),
            urwigo_dtable=getattr(deobf_report, 'dtable', None),
            methods_detected=getattr(deobf_report, 'methods_detected', []),
            strings_decoded_by_function=getattr(deobf_report, 'strings_decoded_by_function', 0)
        )

        # Decode cartridge properties
        if result.cartridge:
            decode_all_text_properties(result.cartridge, context)

        # Decode zone properties
        for zone in result.zones:
            decode_all_text_properties(zone, context)

        # Decode media properties
        for media in result.media:
            decode_all_text_properties(media, context)

        # Decode input properties
        for input_obj in result.inputs:
            decode_all_text_properties(input_obj, context)

        # Decode message properties
        for message in result.messages:
            decode_all_text_properties(message, context)

        # Update report with best-effort stats
        if hasattr(result, 'deobfuscation_report') and result.deobfuscation_report:
            result.deobfuscation_report['strings_decoded_by_best_effort'] = context.strings_decoded_by_best_effort
            result.deobfuscation_report['samples'].extend(context.samples)
            result.deobfuscation_report['warnings'].extend(context.warnings)

        # Log progress
        if context.strings_decoded_by_best_effort > 0:
            logger.info(f"Best-effort decoding decoded {context.strings_decoded_by_best_effort} additional strings")
            self.warnings.append(
                f"Best-effort decoding decoded {context.strings_decoded_by_best_effort} additional strings"
            )

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
