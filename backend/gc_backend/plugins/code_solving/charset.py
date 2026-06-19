"""`WordCodec` : logique commune strict/embedded pour les codes "a charset".

Couvre les plugins qui :
1. decoupent le texte en mots sur `allowed_chars` ;
2. valident chaque mot (ou chaque token de largeur fixe a l'interieur du mot)
   contre un alphabet/table du code ;
3. renvoient des fragments `{value, start, end}` sur le texte original.

Deux familles de comportement strict sont supportees :
- ``strict_mode="strip_all"`` (roman_code, abaddon_code, kenny_code) :
  on retire tous les `allowed_chars`, on valide la concatenation restante,
  et on renvoie un unique fragment couvrant la portion utile ;
- ``strict_mode="per_word"`` (chemical_elements, ...) :
  chaque mot doit etre un code valide (``strict_require="all"``) ou au moins
  un mot doit l'etre (``strict_require="any"``).

Le decoupage en tokens internes est gere par `tokenizer` (par defaut : le mot
entier ; voir `fixed_width_tokenizer` pour les codes a triplets).
"""

from __future__ import annotations

import re
from typing import Any, Callable, Dict, List, Optional, Tuple

from .fragments import Fragment, apply_case, coverage_score, make_fragment

# Un tokenizer prend un mot (deja normalise en casse) et renvoie une liste de
# (token, offset_dans_le_mot). Il ne doit emettre que des tokens "candidats"
# (longueur correcte) ; la validation finale est faite par `validate_word`.
Tokenizer = Callable[[str], List[Tuple[str, int]]]


def whole_word_tokenizer(word: str) -> List[Tuple[str, int]]:
    return [(word, 0)] if word else []


def fixed_width_tokenizer(width: int) -> Tokenizer:
    """Decoupe un mot en tokens de `width` caracteres (ignore le reste partiel)."""

    def _tok(word: str) -> List[Tuple[str, int]]:
        return [
            (word[i:i + width], i)
            for i in range(0, len(word) - width + 1, width)
        ]

    return _tok


def _empty_result() -> Dict[str, Any]:
    return {"is_match": False, "fragments": [], "score": 0.0}


class WordCodec:
    def __init__(
        self,
        *,
        validate_word: Callable[[str], bool],
        case: str = "keep",
        charset: Optional[str] = None,
        tokenizer: Optional[Tokenizer] = None,
        strict_mode: str = "strip_all",
        strict_require: str = "all",
        score_mode: str = "binary",
    ) -> None:
        self.validate_word = validate_word
        self.case = case
        self.charset = charset
        self.tokenizer: Tokenizer = tokenizer or whole_word_tokenizer
        self.strict_mode = strict_mode
        self.strict_require = strict_require
        self.score_mode = score_mode

    # -- API publique ----------------------------------------------------

    def check(
        self,
        text: str,
        *,
        strict: bool,
        embedded: bool,
        allowed_chars: str,
    ) -> Dict[str, Any]:
        """Renvoie `{is_match, fragments, score}` (contrat des plugins)."""
        if not text:
            return _empty_result()
        if strict and not embedded:
            if self.strict_mode == "per_word":
                return self._strict_per_word(text, allowed_chars)
            return self._strict_strip_all(text, allowed_chars)
        return self._extract(text, allowed_chars)

    # -- Extraction "embedded" / "smooth" --------------------------------

    def _extract(self, text: str, allowed_chars: str) -> Dict[str, Any]:
        normalized = apply_case(text, self.case)
        fragments: List[Fragment] = []
        for span in self._iter_words(normalized, allowed_chars):
            word, word_start = span
            for token, offset in self.tokenizer(word):
                if not self.validate_word(token):
                    continue
                start = word_start + offset
                end = start + len(token)
                fragments.append(make_fragment(text[start:end], start, end))
        return self._result(text, fragments)

    # -- Strict : "strip_all" --------------------------------------------

    def _strict_strip_all(self, text: str, allowed_chars: str) -> Dict[str, Any]:
        normalized = apply_case(text, self.case)
        esc_allowed = re.escape(allowed_chars) if allowed_chars else ""

        if self.charset is not None:
            esc_charset = re.escape(self.charset)
            if not re.fullmatch(f"[{esc_charset}{esc_allowed}]*", normalized):
                return _empty_result()

        cleaned = re.sub(f"[{esc_allowed}]", "", normalized) if esc_allowed else normalized
        if not cleaned or not self._tokens_fully_valid(cleaned):
            return _empty_result()

        stripped = text.strip(allowed_chars) if allowed_chars else text
        if not stripped:
            return _empty_result()
        start = text.find(stripped)
        fragment = make_fragment(stripped, start, start + len(stripped))
        full_match = start == 0 and len(stripped) == len(text)
        return {"is_match": True, "fragments": [fragment], "score": 1.0, "full_match": full_match}

    def _tokens_fully_valid(self, cleaned: str) -> bool:
        tokens = self.tokenizer(cleaned)
        if not tokens:
            return False
        if sum(len(tok) for tok, _ in tokens) != len(cleaned):
            return False  # reste partiel (ex. longueur non multiple de la largeur)
        return all(self.validate_word(tok) for tok, _ in tokens)

    # -- Strict : "per_word" ---------------------------------------------

    def _strict_per_word(self, text: str, allowed_chars: str) -> Dict[str, Any]:
        normalized = apply_case(text, self.case)
        fragments: List[Fragment] = []
        for word, word_start in self._iter_words(normalized, allowed_chars):
            if self.validate_word(word):
                fragments.append(make_fragment(text[word_start:word_start + len(word)], word_start, word_start + len(word)))
            elif self.strict_require == "all":
                return _empty_result()
        if not fragments:
            return _empty_result()
        return self._result(text, fragments)

    # -- Helpers ---------------------------------------------------------

    def _iter_words(self, normalized: str, allowed_chars: str) -> List[Tuple[str, int]]:
        if not allowed_chars:
            return [(normalized, 0)] if normalized else []
        esc = re.escape(allowed_chars)
        return [(m.group(0), m.start()) for m in re.finditer(f"[^{esc}]+", normalized)]

    def _result(self, text: str, fragments: List[Fragment]) -> Dict[str, Any]:
        if not fragments:
            return _empty_result()
        if self.score_mode == "coverage":
            score = coverage_score(text, fragments)
        else:
            score = 1.0
        return {"is_match": True, "fragments": fragments, "score": score}
