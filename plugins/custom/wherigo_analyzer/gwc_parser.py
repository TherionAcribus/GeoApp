"""GWC (Wherigo Cartridge) file parser.

Extracts metadata, Lua bytecode, and media from .gwc files.
"""

from __future__ import annotations

import struct
import re
from pathlib import Path
from typing import Dict, List, Optional, Tuple, BinaryIO, Any
from dataclasses import dataclass

try:
    from .models import (
        WherigoCartridge,
        WherigoPoint,
        WherigoMedia,
        SourceInfo,
        LuaInfo,
    )
except ImportError:
    from models import (
        WherigoCartridge,
        WherigoPoint,
        WherigoMedia,
        SourceInfo,
        LuaInfo,
    )


@dataclass
class GWCMediaFile:
    """Represents a media file extracted from GWC."""
    id: int
    filename: str
    mime_type: str
    data: bytes


class GWCParser:
    """Parser for Wherigo GWC files."""

    # GWC file signature - "\x02\nCART" (6 bytes)
    # Based on real GWC files: 020a43415254
    GWC_SIGNATURE = b'\x02\x0a\x43\x41\x52\x54'  # \x02\nCART

    def __init__(self):
        self.warnings: List[str] = []
        self.errors: List[str] = []
        self.media_files: List[GWCMediaFile] = []

    def parse_file(self, file_path: str | Path) -> Tuple[Optional[WherigoCartridge], Optional[bytes], SourceInfo]:
        """
        Parse a GWC file.

        Returns:
            Tuple of (cartridge_metadata, lua_bytecode, source_info)
        """
        import logging
        logger = logging.getLogger(__name__)

        path = Path(file_path)
        logger.info(f"GWC Parser: Opening file {path}")
        source = SourceInfo(filename=path.name, type="gwc")

        if not path.exists():
            source.status = "error"
            source.errors.append(f"File not found: {file_path}")
            return None, None, source

        try:
            data = path.read_bytes()
            return self.parse_bytes(data, path.name)
        except Exception as e:
            source.status = "error"
            source.errors.append(f"Error reading file: {e}")
            return None, None, source

    def parse_bytes(self, data: bytes, filename: str = "cartridge.gwc") -> Tuple[Optional[WherigoCartridge], Optional[bytes], SourceInfo]:
        """Parse GWC data from bytes."""
        import logging
        logger = logging.getLogger(__name__)

        source = SourceInfo(filename=filename, type="gwc")

        logger.info(f"GWC parse_bytes: {len(data)} bytes, filename: {filename}")

        # Check signature (6 bytes: \x02\nCART)
        sig_len = len(self.GWC_SIGNATURE)
        if len(data) < sig_len:
            logger.error(f"File too short: {len(data)} bytes, need at least {sig_len}")
            source.status = "error"
            source.errors.append(f"File too short ({len(data)} bytes)")
            return None, None, source

        actual_sig = data[:sig_len]
        logger.info(f"Signature check: expected {self.GWC_SIGNATURE.hex()}, got {actual_sig.hex()}")

        if actual_sig != self.GWC_SIGNATURE:
            source.status = "error"
            source.errors.append(f"Invalid GWC file signature (expected {self.GWC_SIGNATURE.hex()}, got {actual_sig.hex()})")
            return None, None, source

        logger.info("GWC signature validated successfully")

        try:
            cartridge, lua_bytecode = self._parse_gwc_data(data, source)
            return cartridge, lua_bytecode, source
        except Exception as e:
            source.status = "error"
            source.errors.append(f"Parse error: {e}")
            return None, None, source

    def _parse_gwc_data(self, data: bytes, source: SourceInfo) -> Tuple[Optional[WherigoCartridge], Optional[bytes]]:
        """Internal GWC parsing logic."""
        cartridge = WherigoCartridge()
        lua_bytecode: Optional[bytes] = None

        try:
            # GWC format is based on Pocket PC/Windows Mobile file format
            # Offset 0: signature (6 bytes: \x02\nCART) - already checked
            # Offset 6: number of objects (4 bytes, little-endian)
            offset = 6

            if len(data) < offset + 4:
                source.warnings.append("File too short to read object count")
                return cartridge, None

            num_objects = struct.unpack('<I', data[offset:offset+4])[0]
            offset += 4

            # Object table follows
            objects = []
            for i in range(num_objects):
                if offset + 8 > len(data):
                    source.warnings.append(f"Truncated object table at object {i}")
                    break

                obj_type = struct.unpack('<I', data[offset:offset+4])[0]
                obj_offset = struct.unpack('<I', data[offset+4:offset+8])[0]
                objects.append((obj_type, obj_offset))
                offset += 8

            # Parse each object
            for obj_type, obj_offset in objects:
                if obj_offset >= len(data):
                    source.warnings.append(f"Invalid object offset: {obj_offset}")
                    continue

                try:
                    self._parse_object(data, obj_offset, obj_type, cartridge, source)
                except Exception as e:
                    source.warnings.append(f"Error parsing object type {obj_type}: {e}")

            # Extract Lua bytecode from the LUA object if found
            lua_bytecode = self._extract_lua_bytecode(data, objects)

            if lua_bytecode:
                # Try to extract completion code from bytecode
                completion_code = self._extract_completion_code_from_bytecode(lua_bytecode)
                if completion_code:
                    cartridge.completion_code = completion_code

            source.status = "ok"
            return cartridge, lua_bytecode

        except Exception as e:
            source.warnings.append(f"Error during parsing: {e}")
            source.status = "partial"
            return cartridge, lua_bytecode

    def _parse_object(self, data: bytes, offset: int, obj_type: int, cartridge: WherigoCartridge, source: SourceInfo) -> None:
        """Parse a single GWC object."""
        if offset >= len(data):
            return

        # Object type 0 = Header/Cartridge info
        # Object type 1 = Lua bytecode
        # Object types 2+ = Media files

        if obj_type == 0:
            self._parse_header_object(data, offset, cartridge, source)
        elif obj_type == 1:
            # Lua bytecode object - handled separately
            pass
        elif obj_type >= 2:
            media = self._parse_media_object(data, offset, obj_type, source)
            if media:
                self.media_files.append(media)

    def _parse_header_object(self, data: bytes, offset: int, cartridge: WherigoCartridge, source: SourceInfo) -> None:
        """Parse the header object containing cartridge metadata."""
        try:
            # Header format varies by platform (PocketPC/Garmin/etc.)
            # This is a simplified parser

            # Try to extract strings from the header
            # Cartridge name, description, author are typically stored as length-prefixed strings

            # Read first chunk of header for string extraction
            header_chunk = data[offset:offset+4096] if offset + 4096 <= len(data) else data[offset:]

            # Extract potential strings (simple heuristic)
            strings = self._extract_strings_from_bytes(header_chunk)

            # Assign likely strings based on position and content
            if strings:
                # First non-empty string is often the cartridge name
                for s in strings[:5]:
                    if not cartridge.name and len(s) > 2 and not s.startswith('http'):
                        cartridge.name = s
                        break

                # Look for description (often longer)
                for s in strings:
                    if not cartridge.description and len(s) > 20:
                        cartridge.description = s
                        break

                # Look for author (may contain email or URL)
                for s in strings:
                    if not cartridge.author and ('@' in s or 'http' in s or 'by ' in s.lower()):
                        cartridge.author = s
                        break

                # Look for GUID (UUID format)
                for s in strings:
                    guid_match = re.match(
                        r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
                        s,
                        re.IGNORECASE
                    )
                    if guid_match and not cartridge.guid:
                        cartridge.guid = s
                        break

            # Try to extract coordinates
            coords = self._extract_coordinates_from_bytes(header_chunk)
            if coords:
                cartridge.start = coords

            # Extract version info
            version_match = re.search(r'(\d+\.\d+(?:\.\d+)?)', str(header_chunk, 'utf-8', errors='ignore'))
            if version_match:
                cartridge.version = version_match.group(1)

        except Exception as e:
            source.warnings.append(f"Error parsing header: {e}")

    def _parse_media_object(self, data: bytes, offset: int, media_id: int, source: SourceInfo) -> Optional[GWCMediaFile]:
        """Parse a media object."""
        try:
            # Media format: type (4 bytes), size (4 bytes), data...
            if offset + 8 > len(data):
                return None

            media_type = struct.unpack('<I', data[offset:offset+4])[0]
            media_size = struct.unpack('<I', data[offset+4:offset+8])[0]

            offset += 8

            if offset + media_size > len(data):
                source.warnings.append(f"Media {media_id}: truncated data")
                return None

            media_data = data[offset:offset+media_size]

            # Determine MIME type from media type or data
            mime_type = self._get_mime_type(media_type, media_data)
            filename = f"media_{media_id}{self._get_extension(mime_type)}"

            return GWCMediaFile(
                id=media_id,
                filename=filename,
                mime_type=mime_type,
                data=media_data
            )

        except Exception as e:
            source.warnings.append(f"Error parsing media {media_id}: {e}")
            return None

    def _extract_lua_bytecode(self, data: bytes, objects: List[Tuple[int, int]]) -> Optional[bytes]:
        """Extract Lua bytecode from the GWC file."""
        import logging
        logger = logging.getLogger(__name__)

        # Search for Lua bytecode signature in the entire file
        # Lua 5.1 signature: \x1bLua (0x1b 0x4c 0x75 0x61)
        lua_signature = b'\x1bLua'

        pos = 0
        while True:
            sig_pos = data.find(lua_signature, pos)
            if sig_pos == -1:
                break

            # Verify this looks like valid Lua bytecode
            # Byte 4 should be version (0x51 for Lua 5.1)
            if sig_pos + 5 < len(data):
                version = data[sig_pos + 4]
                if version == 0x51:  # Lua 5.1
                    # Found valid Lua bytecode - extract from here to end or next object
                    logger.info(f"Found Lua 5.1 bytecode at offset {sig_pos}")

                    # Read size if available (some GWC files have size prefix)
                    # Otherwise return from signature to a reasonable end
                    # Look for end of bytecode (often followed by media or other data)
                    # Heuristic: bytecode is typically 100KB-500KB
                    end_pos = min(sig_pos + 500000, len(data))

                    # Try to find a better end point
                    # Look for common patterns that indicate end of bytecode
                    for test_pos in range(sig_pos + 10000, min(sig_pos + 500000, len(data) - 4), 1000):
                        # Check if we hit another object header or media signature
                        chunk = data[test_pos:test_pos+4]
                        if chunk in [b'\x00\x00\x00\x00', b'\xff\xff\xff\xff']:
                            end_pos = test_pos
                            break

                    return data[sig_pos:end_pos]

            pos = sig_pos + 1

        logger.warning("No Lua bytecode signature found in GWC file")
        return None

    def _extract_completion_code_from_bytecode(self, bytecode: bytes) -> Optional[str]:
        """Try to extract completion code from Lua bytecode."""
        # Completion codes are often visible as strings in the bytecode
        # Look for common patterns

        # Try to decode as latin-1 to get strings
        try:
            text = bytecode.decode('latin-1')
        except:
            return None

        # Common completion code patterns
        patterns = [
            r'completion\s*[:=]\s*["\']([^"\']{4,})["\']',
            r'code\s*[:=]\s*["\']([A-Z0-9]{4,})["\']',
            r'finish\s*[:=]\s*["\']([^"\']{4,})["\']',
        ]

        for pattern in patterns:
            match = re.search(pattern, text, re.IGNORECASE)
            if match:
                return match.group(1)

        # Look for 15-character alphanumeric strings (common completion code format)
        candidates = re.findall(r'\b([A-Z0-9]{10,20})\b', text)
        if candidates:
            # Return the longest one that looks like a completion code
            for candidate in sorted(candidates, key=len, reverse=True):
                if any(c.isalpha() for c in candidate) and any(c.isdigit() for c in candidate):
                    return candidate

        return None

    def _extract_strings_from_bytes(self, data: bytes) -> List[str]:
        """Extract readable strings from binary data."""
        strings = []
        current = bytearray()

        for byte in data:
            if 32 <= byte < 127:  # Printable ASCII
                current.append(byte)
            else:
                if len(current) >= 2:
                    try:
                        strings.append(current.decode('ascii'))
                    except:
                        pass
                current = bytearray()

        if len(current) >= 2:
            try:
                strings.append(current.decode('ascii'))
            except:
                pass

        return strings

    def _extract_coordinates_from_bytes(self, data: bytes) -> Optional[WherigoPoint]:
        """Try to extract starting coordinates from binary data."""
        text = data.decode('latin-1', errors='ignore')

        # Look for coordinate patterns
        # Decimal degrees
        dd_match = re.search(r'(-?\d{1,3}\.\d+)[,;\s]+(-?\d{1,3}\.\d+)', text)
        if dd_match:
            try:
                lat = float(dd_match.group(1))
                lon = float(dd_match.group(2))
                if -90 <= lat <= 90 and -180 <= lon <= 180:
                    return WherigoPoint(lat=lat, lon=lon)
            except:
                pass

        return None

    def _get_mime_type(self, media_type: int, data: bytes) -> str:
        """Determine MIME type from media type code or data."""
        # Media type codes in GWC files
        type_map = {
            0: 'application/octet-stream',
            1: 'image/bmp',
            2: 'image/png',
            3: 'image/jpeg',
            4: 'audio/wav',
            5: 'audio/mp3',
        }

        if media_type in type_map:
            return type_map[media_type]

        # Try to detect from magic bytes
        if data.startswith(b'\x89PNG'):
            return 'image/png'
        elif data.startswith(b'\xff\xd8\xff'):
            return 'image/jpeg'
        elif data.startswith(b'BM'):
            return 'image/bmp'
        elif data.startswith(b'RIFF') and b'WAVE' in data[:12]:
            return 'audio/wav'
        elif data.startswith(b'ID3') or (data.startswith(b'\xff') and (data[1] & 0xe0)):
            return 'audio/mp3'

        return 'application/octet-stream'

    def _get_extension(self, mime_type: str) -> str:
        """Get file extension for MIME type."""
        ext_map = {
            'image/png': '.png',
            'image/jpeg': '.jpg',
            'image/bmp': '.bmp',
            'audio/wav': '.wav',
            'audio/mp3': '.mp3',
        }
        return ext_map.get(mime_type, '.bin')

    def get_media_files(self) -> List[GWCMediaFile]:
        """Get extracted media files."""
        return self.media_files
