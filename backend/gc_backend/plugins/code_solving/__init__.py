"""Boite a outils partagee pour les plugins de codes secrets.

Centralise la logique des modes `strict` / `embedded` et du jeu de caracteres
autorises (`allowed_chars`), historiquement recopiee dans une vingtaine de
plugins avec des comportements et des valeurs par defaut divergents.

Import depuis un plugin (avec repli pour l'execution standalone / tests) :

    try:
        from gc_backend.plugins.code_solving import WordCodec, parse_mode_params
    except ImportError:  # execution hors backend
        import sys, pathlib
        sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[3] / "backend"))
        from gc_backend.plugins.code_solving import WordCodec, parse_mode_params
"""

from __future__ import annotations

from .charset import (
    WordCodec,
    fixed_width_tokenizer,
    whole_word_tokenizer,
)
from .digits import (
    confidence_from_fragments,
    extract_digit_fragments,
    is_strict_digits,
)
from .fragments import (
    Fragment,
    apply_case,
    coverage_score,
    decode_fragments,
    iter_word_spans,
    make_fragment,
    merge_overlapping,
    split_into_words,
)
from .params import (
    DEFAULT_ALLOWED_CHARS,
    NON_BREAKING_WHITESPACES,
    ModeParams,
    normalize_allowed_chars,
    parse_bool,
    parse_mode_params,
)

__all__ = [
    # params
    "DEFAULT_ALLOWED_CHARS",
    "NON_BREAKING_WHITESPACES",
    "ModeParams",
    "normalize_allowed_chars",
    "parse_bool",
    "parse_mode_params",
    # fragments
    "Fragment",
    "apply_case",
    "coverage_score",
    "decode_fragments",
    "iter_word_spans",
    "make_fragment",
    "merge_overlapping",
    "split_into_words",
    # charset
    "WordCodec",
    "fixed_width_tokenizer",
    "whole_word_tokenizer",
    # digits
    "confidence_from_fragments",
    "extract_digit_fragments",
    "is_strict_digits",
]
