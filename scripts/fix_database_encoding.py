#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Fix double/triple UTF-8 encoding in the SQLite database.
Applies the same algorithmic fix as fix_all_encoding.py to all text columns.
"""
import os
import sqlite3

# Re-use the same logic as fix_all_encoding.py
CORRECT_CHARS = [chr(c) for c in range(0x00A0, 0x0100)] + [
    "\u0153", "\u0152",  # oe OE
    "\u2019", "\u2018", "\u201c", "\u201d",
    "\u2026", "\u2022", "\u2013", "\u2014",
    "\u2605", "\u2606",
    "\U0001f50d", "\U0001f50c", "\U0001f9ee", "\U0001f9e9",
    "\U0001f4be", "\u2705", "\u274c", "\U0001f3af",
    "\U0001f4e1", "\U0001f4cb", "\U0001f5d1", "\ufe0f",
    "\u23f3", "\U0001f4ac", "\U0001f4dd", "\u26a0",
    "\u270f", "\U0001f4cc", "\u2b50", "\u2714",
    "\u231b", "\u2764", "\U0001f4a1", "\U0001f527",
    "\U0001f680", "\U0001f310", "\U0001f504",
    "\U0001f4f7", "\U0001f4f0", "\U0001f4ca",
]


def _decode_mixed(raw_bytes):
    result = []
    for byte in raw_bytes:
        b = bytes([byte])
        try:
            result.append(b.decode("cp1252"))
        except (UnicodeDecodeError, ValueError):
            result.append(b.decode("latin-1"))
    return "".join(result)


def build_replacement_map():
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
    return dict(sorted(replacements.items(), key=lambda x: -len(x[0])))


def fix_content(content, replacements):
    if not isinstance(content, str):
        return content
    for _ in range(5):
        new_content = content
        for bad, good in replacements.items():
            new_content = new_content.replace(bad, good)
        if new_content == content:
            break
        content = new_content
    return content


def fix_table(conn, table, columns, replacements):
    cursor = conn.cursor()
    cursor.execute(f"SELECT id, {', '.join(columns)} FROM {table}")
    rows = cursor.fetchall()

    fixed_count = 0
    for row in rows:
        row_id = row[0]
        values = row[1:]
        new_values = [fix_content(v, replacements) for v in values]

        if any(n != o for n, o in zip(new_values, values) if o is not None):
            set_clause = ", ".join(f"{col} = ?" for col in columns)
            cursor.execute(
                f"UPDATE {table} SET {set_clause} WHERE id = ?",
                new_values + [row_id]
            )
            fixed_count += 1

    conn.commit()
    return fixed_count, len(rows)


def main():
    base_dir = os.path.dirname(os.path.abspath(__file__))
    db_path = os.path.join(base_dir, "gc-backend", "data", "geoapp.db")

    if not os.path.exists(db_path):
        print(f"Database not found: {db_path}")
        return

    print(f"Database: {db_path}")
    replacements = build_replacement_map()
    print(f"Built {len(replacements)} replacement rules.\n")

    conn = sqlite3.connect(db_path)

    cursor = conn.cursor()

    # geocache - all text columns
    fixed, total = fix_table(conn, "geocache", [
        "name", "type", "size", "owner",
        "description_html", "description_raw",
        "description_override_html", "description_override_raw",
        "hints", "hints_decoded", "hints_decoded_override",
        "gc_personal_note", "coordinates_raw", "original_coordinates_raw",
    ], replacements)
    print(f"geocache: fixed {fixed}/{total} rows")

    # geocache_waypoint
    fixed, total = fix_table(conn, "geocache_waypoint", [
        "name", "type", "gc_coords", "note", "note_override",
    ], replacements)
    print(f"geocache_waypoint: fixed {fixed}/{total} rows")

    # geocache_log
    fixed, total = fix_table(conn, "geocache_log", [
        "author", "text",
    ], replacements)
    print(f"geocache_log: fixed {fixed}/{total} rows")

    # geocache_image
    fixed, total = fix_table(conn, "geocache_image", [
        "title", "note", "ocr_text",
    ], replacements)
    print(f"geocache_image: fixed {fixed}/{total} rows")

    # note
    fixed, total = fix_table(conn, "note", ["content"], replacements)
    print(f"note: fixed {fixed}/{total} rows")

    # solved_geocache_archive
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='solved_geocache_archive'")
    if cursor.fetchone():
        fixed, total = fix_table(conn, "solved_geocache_archive", [
            "gc_code", "name", "personal_note",
            "solved_coordinates_raw", "original_coordinates_raw",
            "notes_snapshot",
        ], replacements)
        print(f"solved_geocache_archive: fixed {fixed}/{total} rows")

    # plugins table
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='plugins'")
    if cursor.fetchone():
        fixed, total = fix_table(conn, "plugins", [
            "name", "description", "author",
        ], replacements)
        print(f"plugins: fixed {fixed}/{total} rows")

    conn.close()
    print("\nDone.")


if __name__ == "__main__":
    main()
