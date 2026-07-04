"""Garde-fou de calibration pour le systeme de scoring des plugins.

Contrairement a test_scoring_fast.py (qui verifie des valeurs absolues et des
comportements unitaires), ce module teste des CONTRAINTES D'ORDRE entre
categories de textes. Objectif: survivre aux recalibrages successifs des poids
du scorer (taches T3-T6) sans devoir reecrire les seuils a chaque ajustement.

Les cas sont charges depuis fixtures/scoring_calibration_cases.json. Les
categories 'near_miss' sont derivees programmatiquement des 'correct_decrypt'
(chiffrement de Cesar +1) pour rester couplees a leurs phrases sources.

Etat au moment de la creation (avant recalibrage):
  - Assertions 2, 4, 5 : PASSENT sur le code actuel (garde-fous de non-regression).
  - Assertions 1, 3 et known_weak_coords : ECHOUENT (marquees xfail). Ce sont
    les cibles a atteindre. Retirer les xfail au fur et a mesure des taches
    T4 (fusion coord/number) et T6 (recalibrage de la combinaison finale).
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Dict, List

import pytest

from gc_backend.plugins.scoring.scorer import (
    score_and_rank_results,
    score_text,
    score_text_fast,
)

# ── Chargement de la fixture ─────────────────────────────────────────

_FIXTURE_PATH = Path(__file__).parent / "fixtures" / "scoring_calibration_cases.json"


def _load_cases() -> Dict[str, List[str]]:
    """Retourne {categorie: [textes...]} en ignorant les cles meta (_...)."""
    data = json.loads(_FIXTURE_PATH.read_text(encoding="utf-8"))
    out: Dict[str, List[str]] = {}
    for key, value in data.items():
        if key.startswith("_"):
            continue
        if isinstance(value, dict) and isinstance(value.get("cases"), list):
            out[key] = list(value["cases"])
    return out


CASES = _load_cases()


def _caesar(text: str, shift: int = 1) -> str:
    """Decale chaque lettre de `shift` (Cesar). Produit un near-miss credible."""
    out = []
    for ch in text:
        if "A" <= ch <= "Z":
            out.append(chr((ord(ch) - 65 + shift) % 26 + 65))
        elif "a" <= ch <= "z":
            out.append(chr((ord(ch) - 97 + shift) % 26 + 97))
        else:
            out.append(ch)
    return "".join(out)


def _near_miss_cases() -> List[str]:
    """near_miss = correct_decrypt passe dans un Cesar +1 (mauvais dechiffrement)."""
    return [_caesar(t, 1) for t in CASES["correct_decrypt"]]


def _full(text: str) -> float:
    return float(score_text(text)["score"])


def _fast(text: str) -> float:
    return float(score_text_fast(text))


# ── Sanity ───────────────────────────────────────────────────────────


class TestSanity:
    def test_fixture_loaded(self):
        for cat in (
            "correct_decrypt",
            "half_decrypt",
            "pure_coords",
            "known_weak_coords",
            "word_coords",
            "number_enum",
            "encoded",
            "gibberish",
        ):
            assert cat in CASES and CASES[cat], f"Categorie manquante ou vide: {cat}"

    @pytest.mark.parametrize(
        "text",
        [t for cat in CASES.values() for t in cat] + _near_miss_cases(),
    )
    def test_scores_bounded(self, text):
        assert 0.0 <= _full(text) <= 1.0
        assert 0.0 <= _fast(text) <= 1.0


# ── Assertion 2 : les coordonnees battent le texte en clair (PASSE) ──


class TestCoordsBeatProse:
    """Le but d'une geocache est une coordonnee : elle doit primer sur la prose."""

    def test_every_pure_coord_beats_every_correct_decrypt(self):
        coord_min = min(_full(t) for t in CASES["pure_coords"])
        prose_max = max(_full(t) for t in CASES["correct_decrypt"])
        assert coord_min > prose_max, (
            f"pure_coords min ({coord_min:.3f}) doit depasser "
            f"correct_decrypt max ({prose_max:.3f})"
        )


# ── Assertion 4 : encoded + gibberish scorent tres bas (PASSE) ──────


class TestGarbageScoresLow:
    CEILING = 0.15

    @pytest.mark.parametrize("text", CASES["encoded"])
    def test_encoded_below_ceiling(self, text):
        assert _full(text) < self.CEILING, f"encoded full={_full(text):.3f} | {text}"
        assert _fast(text) < self.CEILING, f"encoded fast={_fast(text):.3f} | {text}"

    @pytest.mark.parametrize("text", CASES["gibberish"])
    def test_gibberish_below_ceiling(self, text):
        assert _full(text) < self.CEILING, f"gibberish full={_full(text):.3f} | {text}"
        assert _fast(text) < self.CEILING, f"gibberish fast={_fast(text):.3f} | {text}"


# ── half_decrypt : entre le charabia et le texte clair (PASSE) ──────


class TestHalfDecryptMiddle:
    def test_half_decrypt_between_garbage_and_correct(self):
        garbage_ceiling = max(
            _full(t) for t in (CASES["encoded"] + CASES["gibberish"])
        )
        correct_floor = min(_full(t) for t in CASES["correct_decrypt"])
        for t in CASES["half_decrypt"]:
            s = _full(t)
            assert s > garbage_ceiling, (
                f"half_decrypt ({s:.3f}) doit depasser le charabia "
                f"({garbage_ceiling:.3f}) | {t}"
            )
            assert s < correct_floor, (
                f"half_decrypt ({s:.3f}) doit rester sous le texte clair "
                f"({correct_floor:.3f}) | {t}"
            )


# ── Assertion 5 : aucun cas valide rejete par le ranking (PASSE) ────


class TestValidCasesSurviveRanking:
    """Reproduit les seuils de production de plugins.py (score_and_rank_results)."""

    PROD_MIN_SCORE = 0.03
    PROD_FAST_REJECT = 0.01

    def _valid_texts(self) -> List[str]:
        return (
            CASES["correct_decrypt"]
            + CASES["pure_coords"]
            + CASES["word_coords"]
        )

    def test_valid_cases_survive_full_scoring(self):
        valid = self._valid_texts()
        results = [{"text_output": t} for t in valid]
        ranked = score_and_rank_results(
            results,
            top_k=len(valid) + 10,
            min_score=self.PROD_MIN_SCORE,
            fast_reject_threshold=self.PROD_FAST_REJECT,
        )
        survivors = {r["text_output"] for r in ranked}
        missing = [t for t in valid if t not in survivors]
        assert not missing, f"Cas valides rejetes par le ranking: {missing}"

    def test_valid_cases_survive_with_garbage_padding(self):
        """Force le chemin fast-reject (grand lot) et verifie que les cas
        valides ressortent malgre 100 leurres de charabia."""
        valid = self._valid_texts()
        garbage = [
            {"text_output": f"XQZJWK{i}PLMCVBNRTYGHSXQZJWK{i}KLMNPQRST"}
            for i in range(100)
        ]
        results = [{"text_output": t} for t in valid] + garbage
        ranked = score_and_rank_results(
            results,
            top_k=len(valid) + 20,
            min_score=self.PROD_MIN_SCORE,
            fast_reject_threshold=self.PROD_FAST_REJECT,
        )
        survivors = {r["text_output"] for r in ranked}
        missing = [t for t in valid if t not in survivors]
        assert not missing, f"Cas valides perdus dans le fast-filter: {missing}"


# ── Assertion 1 : ecart correct vs near-miss (XFAIL — cible T6) ─────


class TestCorrectVsNearMiss:
    """Un dechiffrement correct doit se detacher NETTEMENT d'un near-miss
    (une lettre / un decalage d'ecart), sinon le bon resultat ne remonte pas
    en tete d'un bruteforce. Ecart cible: >= 0.30.

    Etat actuel: ecart plein ~0.03, ecart fast ~0.24 -> xfail. A lever apres T6.
    """

    MIN_GAP = 0.30

    @pytest.mark.xfail(
        reason="Saturation du scorer complet : ecart correct/near-miss ~0.03 "
        "(< 0.30). A corriger par le recalibrage T6.",
        strict=True,
    )
    def test_gap_full(self):
        correct_floor = min(_full(t) for t in CASES["correct_decrypt"])
        near_ceiling = max(_full(t) for t in _near_miss_cases())
        assert correct_floor - near_ceiling >= self.MIN_GAP, (
            f"ecart full = {correct_floor - near_ceiling:.3f} "
            f"(correct min {correct_floor:.3f} - near max {near_ceiling:.3f})"
        )

    @pytest.mark.xfail(
        reason="Ecart correct/near-miss du fast scorer ~0.24 (< 0.30). "
        "A ameliorer avec les features de T3/T5.",
        strict=True,
    )
    def test_gap_fast(self):
        correct_floor = min(_fast(t) for t in CASES["correct_decrypt"])
        near_ceiling = max(_fast(t) for t in _near_miss_cases())
        assert correct_floor - near_ceiling >= self.MIN_GAP, (
            f"ecart fast = {correct_floor - near_ceiling:.3f} "
            f"(correct min {correct_floor:.3f} - near max {near_ceiling:.3f})"
        )


# ── Assertion 3 : enumeration < fragments de coords (XFAIL — cible T4) ──


class TestNumberEnumBelowWordCoords:
    """Une simple enumeration de nombres (sans separateur/direction/groupes
    plausibles) ne doit pas battre un vrai fragment de coordonnees.

    Etat actuel: les deux saturent a 1.0 (triple comptage gps/coord_words/
    number_richness) -> xfail. A lever apres la fusion en numeric_signal (T4).
    """

    @pytest.mark.xfail(
        reason="number_enum et word_coords saturent tous deux a 1.0. "
        "A corriger par la fusion coord_words/number_richness (T4).",
        strict=True,
    )
    def test_enum_below_word_coords(self):
        enum_max = max(_full(t) for t in CASES["number_enum"])
        word_min = min(_full(t) for t in CASES["word_coords"])
        assert enum_max < word_min, (
            f"number_enum max ({enum_max:.3f}) doit rester sous "
            f"word_coords min ({word_min:.3f})"
        )


# ── known_weak_coords : formats valides sous-notes (XFAIL — cible T4/T6) ──


class TestKnownWeakCoords:
    """Formats de coordonnees VALIDES actuellement mal notes (DMS avec ",
    compact colle, decimal). Cibles de regression : doivent a terme scorer haut.
    """

    TARGET = 0.85

    @pytest.mark.xfail(
        reason="Formats de coordonnees valides mais sous-notes (DMS avec guillemet, "
        "compact colle, decimal). A corriger par T4/T6. Le xfail strict deviendra "
        "XPASS des qu'un format repasse au-dessus de la cible.",
        strict=True,
    )
    @pytest.mark.parametrize("text", CASES["known_weak_coords"])
    def test_weak_coord_reaches_target(self, text):
        assert _full(text) >= self.TARGET, (
            f"Format de coordonnee sous-note : full={_full(text):.3f} "
            f"< cible {self.TARGET} | {text}"
        )
