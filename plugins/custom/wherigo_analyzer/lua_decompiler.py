"""Lua bytecode decompiler interface.

Detects and uses unluac.jar for decompiling Lua bytecode.
"""

from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path
from typing import Optional, Tuple


class LuaDecompiler:
    """Manages Lua bytecode decompilation using unluac.jar."""

    def __init__(self, unluac_path: Optional[str] = None):
        """
        Initialize the decompiler.

        Args:
            unluac_path: Path to unluac.jar. If None, will try to detect
                        from WHERIGO_UNLUAC_PATH env var or common locations.
        """
        self.unluac_path: Optional[Path] = None
        self.java_path: Optional[str] = None
        self.java_available: bool = False
        self.warnings: list[str] = []

        # Try to find unluac.jar
        if unluac_path:
            self.unluac_path = Path(unluac_path)
        else:
            self.unluac_path = self._detect_unluac_path()

        # Check Java availability
        self.java_available = self._check_java()

    def _detect_unluac_path(self) -> Optional[Path]:
        """Try to detect unluac.jar location."""
        # Check environment variable
        env_path = os.environ.get('WHERIGO_UNLUAC_PATH')
        if env_path:
            path = Path(env_path)
            if path.exists():
                return path
            self.warnings.append(f"WHERIGO_UNLUAC_PATH set but file not found: {env_path}")

        # Get the plugin directory (where this file is located)
        plugin_dir = Path(__file__).parent

        # Check plugin's tools directory
        plugin_tools_paths = [
            plugin_dir / 'tools' / 'unluac.jar',
            plugin_dir / 'tools' / 'unluac_2025_12_23.jar',
        ]

        for path in plugin_tools_paths:
            if path.exists():
                return path

        # Check common locations
        common_paths = [
            Path.home() / 'bin' / 'unluac.jar',
            Path.home() / '.local' / 'bin' / 'unluac.jar',
            Path('/usr/local/bin/unluac.jar'),
            Path('/usr/bin/unluac.jar'),
            Path('./unluac.jar'),
            Path('./tools/unluac.jar'),
        ]

        for path in common_paths:
            if path.exists():
                return path

        return None

    def _check_java(self) -> bool:
        """Check if Java is available."""
        # First check PATH
        java_path = shutil.which('java')

        # If not in PATH, check common Windows locations
        if not java_path:
            common_java_paths = [
                Path(r'C:\Program Files\Eclipse Adoptium'),
                Path(r'C:\Program Files\Java'),
                Path(r'C:\Program Files (x86)\Java'),
            ]
            for base_path in common_java_paths:
                if base_path.exists():
                    # Look for jre/jdk subdirectories
                    for subdir in base_path.iterdir():
                        if subdir.is_dir():
                            java_exe = subdir / 'bin' / 'java.exe'
                            if java_exe.exists():
                                java_path = str(java_exe)
                                break
                if java_path:
                    break

        if not java_path:
            self.warnings.append("Java not found in PATH or common locations")
            return False

        # Store the found Java path
        self.java_path = java_path

        try:
            result = subprocess.run(
                [java_path, '-version'],
                capture_output=True,
                timeout=5
            )
            return result.returncode == 0
        except Exception as e:
            self.warnings.append(f"Error checking Java: {e}")
            return False

    def is_available(self) -> bool:
        """Check if decompilation is available (Java + unluac.jar)."""
        if not self.java_available:
            return False
        if not self.unluac_path or not self.unluac_path.exists():
            return False
        return True

    def get_status(self) -> dict:
        """Get the current status of the decompiler."""
        return {
            "available": self.is_available(),
            "java_available": self.java_available,
            "unluac_path": str(self.unluac_path) if self.unluac_path else None,
            "unluac_found": self.unluac_path.exists() if self.unluac_path else False,
            "warnings": self.warnings
        }

    def decompile(self, bytecode_path: str | Path, output_path: Optional[str | Path] = None) -> Tuple[bool, str]:
        """
        Decompile Lua bytecode.

        Args:
            bytecode_path: Path to the Lua bytecode file
            output_path: Optional output path for the decompiled Lua script.
                        If None, returns the decompiled content as string.

        Returns:
            Tuple of (success: bool, result: str) where result is either
            the output path, the decompiled content, or an error message.
        """
        if not self.is_available():
            if not self.java_available:
                return False, "Decompilation unavailable: Java not found. Please install Java."
            return False, "Decompilation unavailable: unluac.jar not found. Set WHERIGO_UNLUAC_PATH or place unluac.jar in a common location."

        bytecode_file = Path(bytecode_path)
        if not bytecode_file.exists():
            return False, f"Bytecode file not found: {bytecode_path}"

        try:
            # Build command using the detected Java path
            cmd = [
                self.java_path or 'java',
                '-jar',
                str(self.unluac_path),
                str(bytecode_file)
            ]

            # Run decompiler
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=60
            )

            if result.returncode != 0:
                error_msg = result.stderr if result.stderr else "Unknown decompilation error"
                return False, f"Decompilation failed: {error_msg}"

            decompiled_content = result.stdout

            # Save to file or return content
            if output_path:
                output_file = Path(output_path)
                output_file.write_text(decompiled_content, encoding='utf-8')
                return True, str(output_file)
            else:
                return True, decompiled_content

        except subprocess.TimeoutExpired:
            return False, "Decompilation timed out (60s limit)"
        except Exception as e:
            return False, f"Decompilation error: {e}"

    def decompile_bytes(self, bytecode: bytes, output_path: Optional[str | Path] = None) -> Tuple[bool, str]:
        """
        Decompile Lua bytecode from bytes.

        Args:
            bytecode: Raw Lua bytecode bytes
            output_path: Optional output path for the decompiled Lua script

        Returns:
            Tuple of (success: bool, result: str)
        """
        # Write bytes to temp file
        import tempfile
        with tempfile.NamedTemporaryFile(suffix='.luac', delete=False) as tmp:
            tmp.write(bytecode)
            tmp_path = tmp.name

        try:
            success, result = self.decompile(tmp_path, output_path)
            return success, result
        finally:
            # Cleanup temp file
            Path(tmp_path).unlink(missing_ok=True)


# Standalone function for convenience
def decompile_bytecode(bytecode: bytes) -> Optional[str]:
    """
    Decompile Lua bytecode to source code.

    Args:
        bytecode: Raw Lua bytecode bytes

    Returns:
        Decompiled source code, or None if decompilation failed
    """
    decompiler = LuaDecompiler()
    if not decompiler.is_available():
        return None

    success, result = decompiler.decompile_bytes(bytecode)
    if success:
        return result
    return None
