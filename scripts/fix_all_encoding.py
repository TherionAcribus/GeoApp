#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Fix double UTF-8 encoding across the entire project.

Root cause: UTF-8 bytes were interpreted as Latin-1, then re-saved as UTF-8.
This causes e.g. 'e' (U+00E9) to appear as 'Ae' (U+00C3 U+00A9).

This script builds the replacement map programmatically from known correct
characters - NO malformed characters are hardcoded in this source file.
"""
import os

# -- Correct characters to fix (using Python unicode escapes, no raw chars) --
CORRECT_CHARS = [
    # ALL printable Latin-1 supplement characters (U+00A0 - U+00FF)
    # This is CRITICAL to handle triple encoding: e.g. 'ÃƒÂ©' -> 'Ã©' -> 'é'
    # Without these, the intermediate 'Ã' (U+00C3) won't be recognized as fixable.
] + [chr(c) for c in range(0x00A0, 0x0100)] + [
    # French accented lowercase
    "\u00e0",  # a grave
    "\u00e2",  # a circumflex
    "\u00e4",  # a umlaut
    "\u00e6",  # ae
    "\u00e7",  # c cedilla
    "\u00e8",  # e grave
    "\u00e9",  # e acute
    "\u00ea",  # e circumflex
    "\u00eb",  # e umlaut
    "\u00ee",  # i circumflex
    "\u00ef",  # i umlaut
    "\u00f4",  # o circumflex
    "\u00f9",  # u grave
    "\u00fa",  # u acute
    "\u00fb",  # u circumflex
    "\u00fc",  # u umlaut
    "\u00ff",  # y umlaut
    "\u0153",  # oe
    # French accented uppercase
    "\u00c0",  # A grave
    "\u00c2",  # A circumflex
    "\u00c4",  # A umlaut
    "\u00c6",  # AE
    "\u00c7",  # C cedilla
    "\u00c8",  # E grave
    "\u00c9",  # E acute
    "\u00ca",  # E circumflex
    "\u00cb",  # E umlaut
    "\u00ce",  # I circumflex
    "\u00cf",  # I umlaut
    "\u00d4",  # O circumflex
    "\u00d9",  # U grave
    "\u00db",  # U circumflex
    "\u00dc",  # U umlaut
    "\u0152",  # OE
    # Common symbols
    "\u00b0",  # degree sign
    "\u2019",  # right single quotation mark
    "\u2018",  # left single quotation mark
    "\u201c",  # left double quotation mark
    "\u201d",  # right double quotation mark
    "\u2026",  # ellipsis
    "\u2022",  # bullet
    "\u2013",  # en dash
    "\u2014",  # em dash
    "\u00ab",  # left-pointing double angle quotation mark
    "\u00bb",  # right-pointing double angle quotation mark
    "\u2605",  # black star
    "\u2606",  # white star
    "\u00a0",  # non-breaking space
    # Emojis commonly used in the app
    "\U0001f50d",  # magnifying glass
    "\U0001f50c",  # electric plug
    "\U0001f9ee",  # abacus
    "\U0001f9e9",  # puzzle piece
    "\U0001f4be",  # floppy disk
    "\u2705",      # check mark
    "\u274c",      # cross mark
    "\U0001f3af",  # direct hit / bullseye
    "\U0001f4e1",  # satellite antenna
    "\U0001f4cb",  # clipboard
    "\U0001f5d1",  # wastebasket
    "\ufe0f",      # variation selector-16
    "\u23f3",      # hourglass flowing sand
    "\U0001f4ac",  # speech bubble
    "\U0001f4dd",  # memo / note
    "\u26a0",      # warning sign
    "\u270f",      # pencil
    "\U0001f4cc",  # pushpin
    "\u2b50",      # star
    "\u2714",      # check mark heavy
    "\u231b",      # hourglass done
    "\u2764",      # heart
    "\U0001f4a1",  # light bulb
    "\U0001f527",  # wrench
    "\U0001f4e5",  # inbox tray
    "\U0001f4e4",  # outbox tray
    "\U0001f5fa",  # world map
    "\U0001f4cd",  # round pushpin
    "\u25b6",      # right arrow
    "\u25c0",      # left arrow
    "\u2139",      # information
    "\U0001f6e0",  # hammer and wrench
    "\U0001f310",  # globe
    "\U0001f4f7",  # camera
    "\U0001f504",  # counterclockwise arrows
    "\U0001f512",  # locked
    "\U0001f513",  # unlocked
    "\U0001f50e",  # magnifying glass right
    "\U0001f4f0",  # newspaper
    "\U0001f4ca",  # bar chart
    "\U0001f4c8",  # chart increasing
    "\U0001f4c9",  # chart decreasing
    "\U0001f6a9",  # triangular flag
    "\U0001f4ce",  # paperclip
    "\U0001f50f",  # lock with ink pen
    "\U0001f4af",  # hundred points
    "\U0001f195",  # NEW button
    "\u2728",      # sparkles
    "\U0001f680",  # rocket
    "\U0001f4bb",  # laptop
    "\U0001f5a5",  # desktop computer
    "\U0001f4f1",  # mobile phone
    "\u25d0",      # circle with left half black (half-star)
    "\u25d1",      # circle with right half black
    "\u25cf",      # black circle
    "\u25cb",      # white circle
    "\u2b24",      # black large circle
    "\u2b1b",      # black large square
    "\u2b1c",      # white large square
    "\u25fc",      # black medium square
    "\u25fb",      # white medium square
    "\u25fd",      # white medium small square
    "\u25fe",      # black medium small square
    "\u2b50",      # white medium star (duplicate OK, already in list)
    "\u2b55",      # heavy large circle
]


def _decode_mixed(raw_bytes):
    """
    Decode bytes using cp1252 where defined, Latin-1 fallback for undefined bytes.
    cp1252 undefined bytes: 0x81, 0x8D, 0x8F, 0x90, 0x9D -> fall back to Latin-1.
    This matches the corruption pattern seen on Windows tools.
    """
    result = []
    for byte in raw_bytes:
        b = bytes([byte])
        try:
            result.append(b.decode("cp1252"))
        except (UnicodeDecodeError, ValueError):
            result.append(b.decode("latin-1"))
    return "".join(result)


def build_replacement_map():
    """
    For each correct character, compute what it looks like when double-encoded.
    Tries Latin-1, cp1252, and a mixed cp1252+Latin-1 fallback codec, since the
    actual corruption mode depends on which tool/OS processed the files.
    """
    replacements = {}
    for char in CORRECT_CHARS:
        utf8_bytes = char.encode("utf-8")
        for codec in ("latin-1", "cp1252", "mixed"):
            try:
                if codec == "mixed":
                    double_encoded = _decode_mixed(utf8_bytes)
                else:
                    double_encoded = utf8_bytes.decode(codec)
                if double_encoded != char:
                    replacements[double_encoded] = char
            except Exception:
                pass
    # Sort by key length descending so longer sequences match first
    return dict(sorted(replacements.items(), key=lambda x: -len(x[0])))


def fix_content(content, replacements):
    """Apply replacements repeatedly until stable (handles triple encoding)."""
    for _ in range(5):  # max 5 passes covers up to 5x encoding
        new_content = content
        for bad, good in replacements.items():
            new_content = new_content.replace(bad, good)
        if new_content == content:
            break
        content = new_content
    return content


def fix_file(filepath, replacements):
    try:
        with open(filepath, "r", encoding="utf-8", errors="replace") as f:
            content = f.read()
        original = content
        content = fix_content(content, replacements)
        if content != original:
            with open(filepath, "w", encoding="utf-8") as f:
                f.write(content)
            return True
        return False
    except Exception as e:
        print(f"  ERROR {filepath}: {e}")
        return False


def main():
    base_dir = os.path.dirname(os.path.abspath(__file__))

    replacements = build_replacement_map()
    print(f"Built {len(replacements)} replacement rules from {len(CORRECT_CHARS)} characters.\n")

    extensions = {".tsx", ".ts", ".py", ".json", ".html", ".md"}
    exclude_dirs = {
        ".git", "node_modules", "__pycache__", ".pytest_cache",
        "lib", "src-gen", "gen-src", ".yarn", "dist", "build",
    }

    dirs_to_scan = [
        os.path.join(base_dir, "theia-blueprint", "theia-extensions"),
        os.path.join(base_dir, "gc-backend"),
        os.path.join(base_dir, "old_code_plugins"),
        os.path.join(base_dir, "shared"),
        os.path.join(base_dir, "docs"),
    ]

    fixed_files = []
    total_count = 0

    for scan_dir in dirs_to_scan:
        if not os.path.isdir(scan_dir):
            continue
        for dirpath, dirnames, filenames in os.walk(scan_dir):
            dirnames[:] = [d for d in dirnames if d not in exclude_dirs]
            for filename in filenames:
                _, ext = os.path.splitext(filename)
                if ext in extensions:
                    filepath = os.path.join(dirpath, filename)
                    total_count += 1
                    if fix_file(filepath, replacements):
                        rel = os.path.relpath(filepath, base_dir)
                        fixed_files.append(rel)
                        print(f"  Fixed: {rel}")

    print(f"\n{'='*60}")
    print(f"Fixed {len(fixed_files)} / {total_count} files scanned.")
    print(f"{'='*60}")


if __name__ == "__main__":
    main()
