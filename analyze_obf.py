#!/usr/bin/env python3
"""Analyze obfuscation patterns in caillou_couteau_ch.gwc."""
import sys
import subprocess
import tempfile
import os
import re

sys.path.insert(0, 'plugins/custom/wherigo_analyzer')
from gwc_parser import GWCParser

parser = GWCParser()
cartridge, lua, source = parser.parse_file('plugins/custom/wherigo_analyzer/cartridge_test/caillou_couteau_ch.gwc')

if not lua:
    print("No Lua bytecode!")
    sys.exit(1)

print(f"Lua bytecode size: {len(lua)} bytes")

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
            lua_source = result.stdout
            print(f"Decompilation successful! Got {len(lua_source)} chars")
            
            # Save to file for analysis
            with open('caillou_decompiled.lua', 'w', encoding='utf-8') as f:
                f.write(lua_source)
            print("Saved to caillou_decompiled.lua")
            
            # Look for obfuscation patterns
            print("\n--- Looking for obfuscation function ---")
            
            # Pattern 1: function with string translation table
            dtable_patterns = [
                r'local\s+dtable\s*=\s*["\']([^"\']+)["\']',
                r'local\s+_ENV\s*=\s*[^\n]+\n.*local\s+dtable',
                r'function\s*\([^)]*\)\s*local\s+dtable',
            ]
            
            for pattern in dtable_patterns:
                matches = re.findall(pattern, lua_source, re.DOTALL | re.IGNORECASE)
                if matches:
                    print(f"Found dtable pattern: {pattern}")
                    for m in matches[:3]:
                        print(f"  Match: {str(m)[:100]!r}")
            
            # Pattern 2: Look for string.char or byte operations
            print("\n--- Looking for string manipulation ---")
            char_patterns = [
                r'string\.char\(([^)]+)\)',
                r'string\.byte\(([^)]+)\)',
                r'for\s+[^=]+=\s*1,\s*#s\s+do',
                r'while\s+[^<]+<\s*#s\s+do',
            ]
            
            for pattern in char_patterns:
                matches = re.findall(pattern, lua_source)
                if matches:
                    print(f"Found: {pattern}")
                    print(f"  Matches: {len(matches)}")
                    for m in matches[:3]:
                        print(f"    {str(m)[:80]!r}")
            
            # Pattern 3: Look for functions that might decode strings
            print("\n--- Looking for decode functions ---")
            func_pattern = r'function\s+([A-Za-z_][A-Za-z0-9_]*)\s*\([^)]*\)[^\n]*\n(?:[^\n]*string[^\n]*\n){1,10}'
            funcs = re.findall(func_pattern, lua_source)
            print(f"Functions with string operations: {funcs[:10]}")
            
            # Show lines around string operations
            lines = lua_source.split('\n')
            for i, line in enumerate(lines):
                if 'string.char' in line or 'string.byte' in line:
                    print(f"\nLine {i}: {line.strip()[:100]}")
                    # Show context
                    for j in range(max(0, i-5), min(len(lines), i+5)):
                        marker = ">>> " if j == i else "    "
                        print(f"{marker}{j}: {lines[j][:80]}")
                    break  # Just show first one
                    
        else:
            print(f"Decompilation failed: {result.stderr[:500]}")
    except Exception as e:
        print(f"Error: {e}")
    finally:
        os.unlink(luac_path)
else:
    print(f"unluac.jar not found")
