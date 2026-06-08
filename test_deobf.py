#!/usr/bin/env python3
"""Test deobfuscation on actual cartridge."""
import sys
sys.path.insert(0, 'plugins/custom/wherigo_analyzer')
from gwc_extractor import GWCExtractor
from deobfuscators import UrwigoDeobfuscator
import re

# Extract Lua from cartridge
extractor = GWCExtractor('plugins/custom/wherigo_analyzer/cartridge_test/caillou_couteau_ch.gwc')
extraction = extractor.extract_all()

lua_content = extraction.get('lua', '')
print(f"Lua content size: {len(lua_content)} bytes")

# Test deobfuscation
deobf = UrwigoDeobfuscator()
deobfuscated_content, report = deobf.deobfuscate(lua_content)

print(f"\nFunction found: {report.function_name}")
print(f"Strings decoded: {report.strings_decoded}")
print(f"Warnings: {report.warnings}")

# Check for remaining _m9REO calls
remaining = re.findall(r'_m9REO\s*\(', deobfuscated_content)
print(f"Remaining _m9REO calls: {len(remaining)}")

# Look for Text = "D..." in deobfuscated content
texts = re.findall(r'Text\s*=\s*"([^"]{1,30})"', deobfuscated_content)
print(f"\nFirst 10 Text values (from deobfuscated):")
for t in texts[:10]:
    print(f"  - {t}")
