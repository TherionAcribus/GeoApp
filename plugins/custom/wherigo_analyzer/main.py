"""Wherigo Analyzer Plugin - Main entry point.

Analyzes Wherigo cartridges (.gwc) and Lua scripts to extract:
- Metadata (name, GUID, description, author, completion code)
- Zones with coordinates
- Media files
- Inputs and probable answers
- Messages and dialogs
"""

from __future__ import annotations

import os
import time
import tempfile
from pathlib import Path
from typing import Any, Dict, List, Optional

from loguru import logger

try:
    from .models import WherigoAnalysisResult, LuaInfo, SourceInfo, WherigoMedia
    from .lua_analyzer import LuaAnalyzer
    from .gwc_parser import GWCParser
    from .lua_decompiler import LuaDecompiler
    from .exporters import result_with_geojson
except ImportError:
    # Allow standalone execution
    from models import WherigoAnalysisResult, LuaInfo, SourceInfo, WherigoMedia
    from lua_analyzer import LuaAnalyzer
    from gwc_parser import GWCParser
    from lua_decompiler import LuaDecompiler
    from exporters import result_with_geojson


class WherigoAnalyzerPlugin:
    """Main plugin class for Wherigo cartridge analysis."""

    def __init__(self):
        self.name = "wherigo_analyzer"
        self.version = "1.0.0"
        self.lua_analyzer = LuaAnalyzer()
        self.gwc_parser = GWCParser()
        self.lua_decompiler = LuaDecompiler()

    def execute(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        """
        Main entry point for plugin execution.

        Args:
            inputs: Dictionary containing:
                - file_path: Path to .gwc or .lua file (optional if file_content provided)
                - file_content: Base64-encoded file content (optional if file_path provided)
                - filename: Original filename (required with file_content)
                - analyze_mode: 'auto' (default), 'gwc', or 'lua'
                - extract_media: Whether to extract media files (default: True)

        Returns:
            Standardized plugin result dictionary
        """
        start_time = time.time()

        try:
            file_path = inputs.get("file_path")
            file_content = inputs.get("file_content")
            filename = inputs.get("filename")
            analyze_mode = inputs.get("analyze_mode", "auto")
            extract_media = inputs.get("extract_media", True)

            # Validate inputs
            if not file_path and not file_content:
                return self._error_response(
                    "No file provided. Please provide either file_path or file_content.",
                    start_time
                )

            # Handle file content - prioritize file_content if provided
            # This handles both upload methods: direct file_path or base64 file_content
            if file_content:
                # Save file_content to temp file (this is the uploaded file data)
                temp_path = self._save_content_to_temp(file_content, filename)
                if not temp_path:
                    return self._error_response(
                        "Failed to process file content.",
                        start_time
                    )
                file_path = temp_path
                logger.debug(f"Using file_content, saved to temp: {file_path}")
            elif file_path:
                # Use provided file path directly
                logger.debug(f"Using provided file_path: {file_path}")
            else:
                return self._error_response(
                    "No file provided. Please provide either file_path or file_content.",
                    start_time
                )

            path = Path(file_path)
            if not path.exists():
                return self._error_response(
                    f"File not found: {file_path}",
                    start_time
                )

            # Log file info for debugging
            file_size = path.stat().st_size
            logger.info(f"Analyzing file: {path} (size: {file_size} bytes)")
            if file_size == 0:
                return self._error_response(
                    f"File is empty: {file_path}",
                    start_time
                )

            # Determine file type and analyze
            # Check both the temp file extension and the original filename
            file_ext = path.suffix.lower()
            original_ext = Path(filename).suffix.lower() if filename else ''
            logger.info(f"File extension: '{file_ext}', original: '{original_ext}', analyze_mode: {analyze_mode}, filename: {filename}")

            # Use original filename extension if temp file has generic extension
            effective_ext = original_ext if original_ext and file_ext in ['.bin', ''] else file_ext

            if effective_ext == '.gwc' or analyze_mode == 'gwc':
                logger.info("Analyzing as GWC file")
                result = self._analyze_gwc(path, extract_media)
            elif effective_ext == '.lua' or analyze_mode == 'lua':
                logger.info("Analyzing as Lua file")
                result = self._analyze_lua(path)
            else:
                # Auto-detect based on content
                # GWC signature is 6 bytes: \x02\nCART (020a43415254)
                header = path.read_bytes()[:6]
                logger.info(f"Auto-detecting file type, header: {header.hex()}")
                if header == b'\x02\x0a\x43\x41\x52\x54':  # GWC signature: \x02\nCART
                    logger.info("Detected GWC signature")
                    result = self._analyze_gwc(path, extract_media)
                else:
                    logger.info("No GWC signature, analyzing as Lua")
                    result = self._analyze_lua(path)

            # Convert to plugin output format
            return self._format_result(result, start_time)

        except Exception as e:
            logger.exception("Error in Wherigo analyzer plugin")
            return self._error_response(
                f"Analysis error: {str(e)}",
                start_time
            )

    def _analyze_gwc(self, path: Path, extract_media: bool) -> WherigoAnalysisResult:
        """Analyze a GWC file."""
        logger.info(f"_analyze_gwc: Starting analysis of {path}")

        # Parse GWC
        cartridge, lua_bytecode, source = self.gwc_parser.parse_file(path)

        result = WherigoAnalysisResult()
        result.source = source
        result.cartridge = cartridge or result.cartridge

        logger.info(f"GWC parse result: status={source.status}, cartridge={cartridge is not None}, lua_bytecode={lua_bytecode is not None}")
        if source.errors:
            logger.error(f"GWC parse errors: {source.errors}")
        if source.warnings:
            logger.warning(f"GWC parse warnings: {source.warnings}")

        if source.status == "error":
            logger.error("GWC parsing failed, returning error result")
            return result

        # Set Lua info
        if lua_bytecode:
            logger.info(f"Lua bytecode extracted: {len(lua_bytecode)} bytes")
            result.lua = LuaInfo(
                available=True,
                bytecode_extracted=True,
                decompiled=False
            )

            # Try to decompile
            logger.info(f"Attempting to decompile {len(lua_bytecode)} bytes of Lua bytecode")
            logger.info(f"Decompiler available: {self.lua_decompiler.is_available()}")
            if self.lua_decompiler.is_available():
                logger.info(f"Using unluac at: {self.lua_decompiler.unluac_path}")
                logger.info(f"Java available: {self.lua_decompiler.java_available}")

            success, decompiled = self.lua_decompiler.decompile_bytes(lua_bytecode)
            logger.info(f"Decompilation result: success={success}, output_length={len(decompiled) if success else 0}")

            if not success:
                logger.warning(f"Decompilation failed: {decompiled[:200]}")

            if success:
                result.lua.decompiled = True
                result.lua.decompiler = "unluac"
                logger.info(f"Lua decompiled successfully, analyzing {len(decompiled)} characters")

                # Analyze decompiled Lua
                lua_result = self.lua_analyzer.analyze_content(decompiled, "decompiled.lua")
                logger.info(f"Lua analysis found: {len(lua_result.zones)} zones, {len(lua_result.inputs)} inputs, {len(lua_result.messages)} messages")

                # Merge Lua results
                result.zones = lua_result.zones
                result.media.extend(lua_result.media)  # Add media from Lua
                result.characters = lua_result.characters
                result.items = lua_result.items
                result.tasks = lua_result.tasks
                result.timers = lua_result.timers
                result.inputs = lua_result.inputs
                result.messages = lua_result.messages
                result.deobfuscation = lua_result.deobfuscation

                # Enhance cartridge info
                if lua_result.cartridge.name:
                    result.cartridge.name = lua_result.cartridge.name
                if lua_result.cartridge.description:
                    result.cartridge.description = lua_result.cartridge.description
                if lua_result.cartridge.completion_code:
                    result.cartridge.completion_code = lua_result.cartridge.completion_code
            else:
                # Decompiler not available or failed
                result.source.warnings.append(decompiled)
        else:
            result.source.warnings.append("No Lua bytecode found in GWC file")

        # Add media from GWC parser
        if extract_media:
            for gwc_media in self.gwc_parser.get_media_files():
                result.media.append(WherigoMedia(
                    id=str(gwc_media.id),
                    filename=gwc_media.filename,
                    mime_type=gwc_media.mime_type,
                    size=len(gwc_media.data)
                ))

        return result

    def _analyze_lua(self, path: Path) -> WherigoAnalysisResult:
        """Analyze a Lua file."""
        result = self.lua_analyzer.analyze_file(path)
        result.lua = LuaInfo(available=True, decompiled=True, decompiler="manual")
        return result

    def _save_content_to_temp(self, content: str, filename: Optional[str]) -> Optional[str]:
        """Save file content to a temporary file."""
        import base64

        try:
            # Try to detect if content is base64 encoded
            try:
                decoded = base64.b64decode(content)
                is_base64 = True
                logger.info(f"Content decoded as base64, size: {len(decoded)} bytes")
            except Exception:
                decoded = content.encode('utf-8')
                is_base64 = False
                logger.info(f"Content treated as plain text, size: {len(decoded)} bytes")

            # Determine file extension
            if filename:
                ext = Path(filename).suffix or '.bin'
            else:
                ext = '.bin'
            logger.info(f"Using extension '{ext}' from filename '{filename}'")

            # Create temp file
            with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
                tmp.write(decoded)
                logger.info(f"Saved content to temp file: {tmp.name}")
                return tmp.name

        except Exception as e:
            logger.error(f"Error saving file content: {e}")
            return None

    def _format_result(self, result: WherigoAnalysisResult, start_time: float) -> Dict[str, Any]:
        """Format the analysis result to plugin output format."""
        execution_time = int((time.time() - start_time) * 1000)

        # Build summary
        summary_parts = []
        if result.cartridge.name:
            summary_parts.append(f"Cartridge: {result.cartridge.name}")
        else:
            summary_parts.append("Wherigo cartridge analysis")

        summary_parts.append(f"{len(result.zones)} zone(s)")
        summary_parts.append(f"{len(result.inputs)} input(s)")
        summary_parts.append(f"{len(result.messages)} message(s)")

        if result.cartridge.completion_code:
            summary_parts.append("Completion code found")

        summary = ", ".join(summary_parts)

        # Convert result to dict with GeoJSON
        result_dict = result_with_geojson(result)

        # Build plugin result
        return {
            "status": "ok" if result.source.status == "ok" else "partial",
            "summary": summary,
            "results": [
                {
                    "id": "wherigo_analysis",
                    "text_output": self._build_text_output(result),
                    "confidence": 1.0,
                    "metadata": {
                        "cartridge_name": result.cartridge.name,
                        "completion_code": result.cartridge.completion_code,
                        "zone_count": len(result.zones),
                        "input_count": len(result.inputs),
                        "media_count": len(result.media),
                        "message_count": len(result.messages),
                        "warnings": result.source.warnings,
                        "errors": result.source.errors,
                    },
                    "coordinates": self._extract_coordinates(result),
                }
            ],
            "wherigo_data": result_dict,
            "plugin_info": {
                "name": self.name,
                "version": self.version,
                "execution_time_ms": execution_time,
            }
        }

    def _build_text_output(self, result: WherigoAnalysisResult) -> str:
        """Build a human-readable text summary."""
        lines = []

        if result.cartridge.name:
            lines.append(f"Cartridge: {result.cartridge.name}")
        if result.cartridge.guid:
            lines.append(f"GUID: {result.cartridge.guid}")
        if result.cartridge.author:
            lines.append(f"Author: {result.cartridge.author}")
        if result.cartridge.completion_code:
            lines.append(f"Completion Code: {result.cartridge.completion_code}")

        if result.cartridge.start.lat is not None:
            lines.append(f"Start: {result.cartridge.start.lat}, {result.cartridge.start.lon}")

        lines.append("")
        lines.append(f"Zones: {len(result.zones)}")
        for zone in result.zones:
            coord_str = ""
            if zone.original_point.lat is not None:
                coord_str = f" ({zone.original_point.lat:.6f}, {zone.original_point.lon:.6f})"
            media_str = f" [Media: {zone.media}]" if zone.media else ""
            lines.append(f"  - {zone.name or zone.internal_name}{coord_str}{media_str}")

        lines.append("")
        lines.append(f"Inputs: {len(result.inputs)}")
        for inp in result.inputs:
            lines.append(f"  - {inp.name or inp.internal_name}")
            if inp.answers:
                for answer in inp.answers:
                    lines.append(f"    Answer: {answer.value} ({answer.method})")
                    # Show brute force candidates for hashed answers
                    if answer.method == "urwigo_hash" and answer.candidates:
                        numeric = answer.candidates.get('numeric', [])
                        alpha = answer.candidates.get('alpha', [])
                        alphanumeric = answer.candidates.get('alphanumeric', [])
                        if numeric:
                            lines.append(f"      Numeric candidates: {', '.join(numeric[:5])}")
                        if alpha:
                            lines.append(f"      Alpha candidates: {', '.join(alpha[:5])}")
                        if alphanumeric:
                            lines.append(f"      Alphanumeric candidates: {', '.join(alphanumeric[:5])}")
                        lines.append("      Note: collisions possibles, réponse non garantie")

        lines.append("")
        lines.append(f"Messages: {len(result.messages)}")
        for msg in result.messages:
            msg_title = msg.title or "(no title)"
            lines.append(f"  - [{msg.type}] {msg_title}")
            if msg.text:
                text_preview = msg.text[:500].replace('\n', ' ')
                if len(msg.text) > 500:
                    text_preview += "..."
                lines.append(f"    Text: {text_preview}")
            if msg.buttons:
                lines.append(f"    Buttons: {', '.join(msg.buttons)}")
            if msg.media:
                lines.append(f"    Media: {msg.media}")

        return "\n".join(lines)

    def _extract_coordinates(self, result: WherigoAnalysisResult) -> Optional[Dict[str, Any]]:
        """Extract coordinates from zones for the result."""
        if not result.zones:
            return None

        zone = result.zones[0]
        if zone.original_point.lat is None:
            return None

        return {
            "exist": True,
            "decimal": {
                "lat": zone.original_point.lat,
                "lon": zone.original_point.lon,
            },
            "raw": [f"{zone.original_point.lat}, {zone.original_point.lon}"],
        }

    def _error_response(self, message: str, start_time: float) -> Dict[str, Any]:
        """Build an error response."""
        execution_time = int((time.time() - start_time) * 1000)

        return {
            "status": "error",
            "summary": f"Analysis failed: {message}",
            "results": [],
            "wherigo_data": {
                "source": {
                    "status": "error",
                    "errors": [message]
                },
                "cartridge": {},
                "zones": [],
                "inputs": [],
                "messages": [],
                "geojson": {"type": "FeatureCollection", "features": []}
            },
            "plugin_info": {
                "name": self.name,
                "version": self.version,
                "execution_time_ms": execution_time,
            }
        }


# Global plugin instance
plugin = WherigoAnalyzerPlugin()


def execute(inputs: Dict[str, Any]) -> Dict[str, Any]:
    """Plugin entry point."""
    return plugin.execute(inputs)


# For testing
if __name__ == "__main__":
    import sys

    if len(sys.argv) > 1:
        test_path = sys.argv[1]
        result = execute({"file_path": test_path})
        import json
        print(json.dumps(result, indent=2, ensure_ascii=False))
    else:
        print("Usage: python main.py <path_to_gwc_or_lua_file>")
