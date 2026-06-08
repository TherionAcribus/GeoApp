#!/usr/bin/env python3
"""Debug caillou_couteau_ch.gwc cartridge."""
import sys
import subprocess
import tempfile
import os

sys.path.insert(0, 'plugins/custom/wherigo_analyzer')

from gwc_parser import GWCParser

# Parse the cartridge
parser = GWCParser()
cartridge, lua, source = parser.parse_file('plugins/custom/wherigo_analyzer/cartridge_test/caillou_couteau_ch.gwc')

print(f"Status: {source.status}")
print(f"Warnings: {source.warnings[:5]}")
print(f"\nCartridge name: {cartridge.name!r}")
print(f"Author: {cartridge.author!r}")
print(f"Lua bytecode size: {len(lua) if lua else 0} bytes")

if lua:
    print("\n--- Lua bytecode header (first 20 bytes) ---")
    print(f"Hex: {lua[:20].hex()}")
    print(f"Raw: {lua[:20]!r}")
    
    # Try decompiling with unluac.jar
    print("\n--- Attempting decompilation with unluac.jar ---")
    
    # Check if Java is available
    try:
        result = subprocess.run(['java', '-version'], capture_output=True, text=True, timeout=5)
        print(f"Java available: {result.stderr.split()[2] if result.stderr else 'unknown'}")
    except Exception as e:
        print(f"Java not available: {e}")
    
    # Try to decompile
    unluac_path = 'plugins/custom/wherigo_analyzer/tools/unluac_2025_12_23.jar'
    if os.path.exists(unluac_path):
        with tempfile.NamedTemporaryFile(suffix='.luac', delete=False) as f:
            f.write(lua)
            luac_path = f.name
        
        try:
            result = subprocess.run(
                ['java', '-jar', unluac_path, luac_path],
                capture_output=True,
                text=True,
                timeout=30
            )
            if result.returncode == 0:
                print(f"Decompilation successful! Got {len(result.stdout)} chars")
                # Show first 1000 chars
                print("\n--- Decompiled Lua (first 2000 chars) ---")
                print(result.stdout[:2000])
            else:
                print(f"Decompilation failed: {result.stderr[:500]}")
        except Exception as e:
            print(f"Error running unluac: {e}")
        finally:
            os.unlink(luac_path)
    else:
        print(f"unluac.jar not found at {unluac_path}")
