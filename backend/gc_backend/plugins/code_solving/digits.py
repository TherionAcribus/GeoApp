"""Helpers pour les codes "flux de chiffres" (famille B : morbit, ...).

Ces codes s'expriment comme une suite de chiffres pouvant etre interrompue par
des `allowed_chars` (espaces, ponctuation). Contrairement aux codes "a mots",
les separateurs *internes* sont toleres au sein d'un meme fragment.
"""

from __future__ import annotations

import re
from typing import Any, Dict, List, Tuple

from .fragments import Fragment, make_fragment


def extract_digit_fragments(
    text: str,
    *,
    digit_chars: str,
    allowed_chars: str = "",
    min_digits: int = 2,
    fragment_type: str = "digits",
) -> List[Fragment]:
    """Extrait les fragments de chiffres `digit_chars`, separateurs internes tolere.

    Chaque fragment porte en plus `digits` (chiffres concatenes) et
    `digits_count`. Les fragments de moins de `min_digits` chiffres sont ignores.
    """
    esc_digits = re.escape(digit_chars)
    sep = re.escape(allowed_chars) if allowed_chars else ""
    if sep:
        pattern = rf"[{esc_digits}](?:[{sep}]*[{esc_digits}])+"
    else:
        pattern = rf"[{esc_digits}]{{{max(min_digits, 1)},}}"

    fragments: List[Fragment] = []
    strip_re = re.compile(rf"[^{esc_digits}]")
    for match in re.finditer(pattern, text):
        value = match.group(0)
        digits = strip_re.sub("", value)
        if len(digits) < min_digits:
            continue
        fragments.append(
            make_fragment(
                value,
                match.start(),
                match.end(),
                digits=digits,
                digits_count=len(digits),
                type=fragment_type,
            )
        )
    return fragments


def is_strict_digits(
    text: str,
    *,
    digit_chars: str,
    allowed_chars: str = "",
) -> Tuple[bool, str]:
    """Verifie que `text` ne contient que `digit_chars` et `allowed_chars`.

    Renvoie `(ok, raison)`. `raison` est non vide en cas d'echec.
    """
    digit_set = set(digit_chars)
    allowed = set(allowed_chars or "")
    has_digit = False
    for ch in text:
        if ch in digit_set:
            has_digit = True
        elif ch in allowed:
            continue
        else:
            return False, f"caractere non autorise: {ch!r}"
    if not has_digit:
        return False, "aucun chiffre detecte"
    return True, ""


def confidence_from_fragments(
    text: str,
    fragments: List[Fragment],
    *,
    base: float = 0.35,
    scale: float = 0.65,
    cap: float = 1.0,
) -> float:
    """Confiance basee sur la couverture des fragments (0.0 si aucun)."""
    if not fragments:
        return 0.0
    covered = sum(int(f["end"]) - int(f["start"]) for f in fragments)
    return min(cap, base + scale * (covered / (len(text) or 1)))
