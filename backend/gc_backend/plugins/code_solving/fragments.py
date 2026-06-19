"""Utilitaires de fragmentation pour les codes secrets "embedded".

Un *fragment* est un dict `{"value": str, "start": int, "end": int}` reperant
une portion du texte original (positions sur le texte ORIGINAL, pas normalise).

Ces helpers remplacent les idiomes recopies dans une dizaine de plugins :
- decoupage du texte sur les caracteres autorises (`re.finditer("[^...]+")`) ;
- re-injection des fragments decodes a leur position ;
- score de couverture (`longueur_codee / longueur_totale`).

Tous travaillent avec des dicts simples pour rester compatibles avec le
contrat existant des plugins (`fragment["start"]`, etc.).
"""

from __future__ import annotations

import re
from typing import Any, Callable, Dict, Iterator, List, Optional

Fragment = Dict[str, Any]


def make_fragment(value: str, start: int, end: int, **extra: Any) -> Fragment:
    """Construit un fragment standard, avec metadonnees optionnelles."""
    fragment: Fragment = {"value": value, "start": start, "end": end}
    fragment.update(extra)
    return fragment


def iter_word_spans(text: str, allowed_chars: str) -> Iterator[re.Match]:
    """Itere sur les "mots" (suites de caracteres NON autorises) du texte.

    Si `allowed_chars` est vide, le texte entier est considere comme un seul mot.
    """
    if not text:
        return
    if not allowed_chars:
        yield from re.finditer(r".+", text, re.DOTALL)
        return
    esc = re.escape(allowed_chars)
    yield from re.finditer(f"[^{esc}]+", text)


def split_into_words(
    text: str,
    allowed_chars: str,
    *,
    case: str = "keep",
) -> List[Fragment]:
    """Decoupe `text` en fragments-mots separes par `allowed_chars`.

    `value` est extrait du texte ORIGINAL ; `case` ("upper"/"lower"/"keep")
    sert uniquement a normaliser le texte pour le calcul des positions (les
    operations de casse ASCII preservent les indices).
    """
    normalized = apply_case(text, case)
    return [
        make_fragment(normalized[m.start():m.end()], m.start(), m.end())
        for m in iter_word_spans(normalized, allowed_chars)
    ]


def apply_case(text: str, case: str) -> str:
    if case == "upper":
        return text.upper()
    if case == "lower":
        return text.lower()
    return text


def decode_fragments(
    text: str,
    fragments: List[Fragment],
    decode_value: Callable[[str], str],
) -> str:
    """Re-injecte chaque fragment decode a sa position dans `text`.

    Les fragments sont traites de droite a gauche pour que les decalages de
    longueur (un code plus court/long que sa valeur source) n'invalident pas
    les positions des fragments suivants.
    """
    result = text
    for fragment in sorted(fragments, key=lambda f: int(f["start"]), reverse=True):
        start = int(fragment["start"])
        end = int(fragment["end"])
        decoded = decode_value(str(fragment["value"]))
        result = result[:start] + decoded + result[end:]
    return result


def coverage_score(
    text: str,
    fragments: List[Fragment],
    *,
    base: float = 0.0,
    scale: float = 1.0,
    cap: float = 1.0,
) -> float:
    """Score = `base + scale * (caracteres couverts / longueur totale)`, plafonne.

    Renvoie 0.0 s'il n'y a aucun fragment.
    """
    if not fragments:
        return 0.0
    covered = sum(int(f["end"]) - int(f["start"]) for f in fragments)
    total = len(text) or 1
    return min(cap, base + scale * (covered / total))


def merge_overlapping(fragments: List[Fragment]) -> List[Fragment]:
    """Fusionne/deduplique les fragments qui se chevauchent (tri par position)."""
    if not fragments:
        return []
    ordered = sorted(fragments, key=lambda f: (int(f["start"]), int(f["end"])))
    merged: List[Fragment] = [ordered[0]]
    for fragment in ordered[1:]:
        last = merged[-1]
        if int(fragment["start"]) < int(last["end"]):
            if int(fragment["end"]) > int(last["end"]):
                last["end"] = int(fragment["end"])
                last["value"] = str(last["value"]) + str(fragment["value"])[int(last["end"]) - int(fragment["start"]):]
            continue
        merged.append(fragment)
    return merged
