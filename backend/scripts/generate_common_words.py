#!/usr/bin/env python3
"""Generate common-word frequency lists for the scoring lexical features.

These lists feed ``_lexical_features`` in
``gc_backend/plugins/scoring/scorer.py`` so that ``lexical_coverage`` and
``coherence`` measure *actual word recognition* instead of raw token count.

Build-time tool only: it depends on the ``wordfreq`` package, which is NOT a
runtime dependency of the backend.  Install it just to regenerate the lists:

    pip install wordfreq
    python backend/scripts/generate_common_words.py            # ~4000 words/lang
    python backend/scripts/generate_common_words.py --top-n 5000

Output: JSON arrays in
``gc_backend/plugins/scoring/resources/common_words/common_words.<lang>.json``.

Words are normalised the same way tokens are matched at scoring time
(NFKD accent-stripping + lowercase) so that ASCII-only decoded text — very
common in geocaching — still matches accented dictionary forms
(e.g. "trouve" matches "trouvé", "etre" matches "être").
"""

from __future__ import annotations

import argparse
import json
import sys
import unicodedata
from pathlib import Path
from typing import List

# 8 langues de DEFAULT_LANGS_EUROPE (gc_backend/plugins/scoring/langid.py)
LANGS = ["fr", "en", "de", "es", "it", "nl", "pt", "pl"]

RESOURCES_DIR = (
    Path(__file__).resolve().parent.parent
    / "gc_backend"
    / "plugins"
    / "scoring"
    / "resources"
    / "common_words"
)


def normalize(word: str) -> str:
    """NFKD accent-strip + lowercase — matches _norm_lex_token in the scorer."""
    s = unicodedata.normalize("NFKD", word)
    s = "".join(ch for ch in s if not unicodedata.combining(ch))
    return s.lower()


def build_list(lang: str, top_n: int) -> List[str]:
    import wordfreq

    raw = wordfreq.top_n_list(lang, top_n)
    seen = set()
    out: List[str] = []
    for w in raw:
        n = normalize(w)
        if len(n) < 2:
            continue
        # Keep only alphabetic tokens (allow internal apostrophe like "l'" -> "l")
        if not all(ch.isalpha() or ch == "'" for ch in n):
            continue
        if n in seen:
            continue
        seen.add(n)
        out.append(n)
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--top-n",
        type=int,
        default=4000,
        help="Number of top-frequency words to request per language (default 4000).",
    )
    args = parser.parse_args()

    try:
        import wordfreq  # noqa: F401
    except ImportError:
        print(
            "ERROR: the 'wordfreq' package is required. Install it with "
            "`pip install wordfreq` (build-time only, not a runtime dependency).",
            file=sys.stderr,
        )
        return 1

    RESOURCES_DIR.mkdir(parents=True, exist_ok=True)

    for lang in LANGS:
        words = build_list(lang, args.top_n)
        path = RESOURCES_DIR / f"common_words.{lang}.json"
        path.write_text(
            json.dumps(words, ensure_ascii=False, indent=0),
            encoding="utf-8",
        )
        print(f"{lang}: wrote {len(words)} words -> {path.name}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
