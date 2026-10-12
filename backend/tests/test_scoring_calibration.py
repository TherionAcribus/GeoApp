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

from gc_backend.plugins.scoring.langid import DEFAULT_LANGS_EUROPE, detect_language
from gc_backend.plugins.scoring.resources_loader import available_quadgram_langs, load_quadgrams
from gc_backend.plugins.scoring.scorer import (
    _all_known_words,
    _encoded_pattern_penalty,
    _norm_lex_token,
    _origin_from_context,
    _normalize_for_stats,
    _numeric_signal_feature,
    _quadgram_fitness_for_lang,
    score_and_rank_results,
    score_text,
    score_text_fast,
)


def _ngram_fitness(text: str) -> float:
    return float(score_text(text)["metadata"]["scoring"]["features"]["ngram_fitness"])

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
        # Resolu par T6 : la combinaison noisy-OR de-sature. Une coordonnee
        # pure (canal coord ~0.95) prime sur la prose valide (canal langue
        # plafonne a 0.9 * 0.9 = 0.81, en pratique ~0.68).
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


# ── Reponses courtes : pas de veto IC, en tete d'un bruteforce Cesar ─


class TestShortAnswers:
    """Une reponse d'un a trois mots doit garder un vrai score et ressortir
    premiere parmi ses 25 decalages Cesar, avec les seuils de production."""

    @pytest.mark.parametrize("text", CASES["short_answers"])
    def test_short_answer_is_not_vetoed(self, text):
        scoring = score_text(text)["metadata"]["scoring"]
        assert scoring.get("early_exit") is None, scoring.get("early_exit")
        assert scoring["score"] >= 0.3

    @pytest.mark.parametrize("text", CASES["short_answers"])
    def test_short_answer_wins_caesar_bruteforce(self, text):
        results = [{"text_output": _caesar(text, k)} for k in range(26)]
        ranked = score_and_rank_results(
            results,
            top_k=25,
            min_score=TestValidCasesSurviveRanking.PROD_MIN_SCORE,
            fast_reject_threshold=TestValidCasesSurviveRanking.PROD_FAST_REJECT,
        )
        assert ranked, "Tous les candidats ont ete filtres"
        assert ranked[0]["text_output"] == text
        if len(ranked) > 1:
            gap = ranked[0]["confidence"] - ranked[1]["confidence"]
            assert gap >= 0.15, f"Ecart trop faible avec le 2e candidat: {gap:.3f}"

    def test_short_gibberish_stays_low(self):
        for text in ("XQZJW", "QPOU", "KLMNP VBGHT", "QJFE EV HSBOE"):
            assert _full(text) < 0.15, text


# ── Mots colles : pas de fausse penalite base64 ─────────────────────


class TestGluedWords:
    """Un texte clair sans espaces n'est pas du base64 : pas de penalite
    'encode', et il ressort premier parmi ses 25 decalages Cesar."""

    @pytest.mark.parametrize("text", CASES["glued_words"])
    def test_glued_text_is_not_flagged_as_encoded(self, text):
        assert _encoded_pattern_penalty(text) == 1.0
        scoring = score_text(text)["metadata"]["scoring"]
        assert scoring.get("early_exit") != "encoded_pattern"

    @pytest.mark.parametrize("text", CASES["glued_words"])
    def test_glued_text_wins_caesar_bruteforce(self, text):
        results = [{"text_output": _caesar(text, k)} for k in range(26)]
        ranked = score_and_rank_results(
            results,
            top_k=25,
            min_score=TestValidCasesSurviveRanking.PROD_MIN_SCORE,
            fast_reject_threshold=TestValidCasesSurviveRanking.PROD_FAST_REJECT,
        )
        assert ranked, "Tous les candidats ont ete filtres"
        assert ranked[0]["text_output"] == text

    @pytest.mark.parametrize("text", CASES["base64_blocks"])
    def test_real_base64_stays_penalised(self, text):
        assert _encoded_pattern_penalty(text) <= 0.1
        assert _full(text) < 0.15
        assert _fast(text) < 0.15


# ── Segmentation des mots colles ────────────────────────────────────


class TestGluedWordSegmentation:
    """Un texte clair colle est decoupe en mots et retrouve un score de texte
    clair ; un mauvais dechiffrement ne se laisse pas decouper."""

    @pytest.mark.parametrize("text", CASES["glued_words_segmentable"])
    def test_segmentable_text_scores_like_plain_text(self, text):
        scoring = score_text(text)["metadata"]["scoring"]
        assert scoring["segmented_text"], "aucun decoupage trouve"
        assert scoring["segmented_text"].replace(" ", "") == text
        assert scoring["features"]["lexical_coverage"] >= 0.75
        assert scoring["score"] >= 0.55

    @pytest.mark.parametrize("text", CASES["glued_words_segmentable"])
    def test_wrong_caesar_shifts_are_not_segmented(self, text):
        best_wrong = 0.0
        for shift in range(1, 26):
            scoring = score_text(_caesar(text, shift))["metadata"]["scoring"]
            assert not scoring.get("segmented_text"), scoring.get("segmented_text")
            best_wrong = max(best_wrong, scoring["score"])
        assert _full(text) - best_wrong >= 0.30

    def test_glued_written_coordinates_reach_the_coordinate_channel(self):
        for text in CASES["glued_words_segmentable"][-2:]:
            features = score_text(text)["metadata"]["scoring"]["features"]
            assert features["numeric_signal"] >= 0.8, text
            assert _full(text) >= 0.85, text

    def test_language_of_the_split_is_reported(self):
        scoring = score_text("DERSCHATZISTUNTERDEMGROSSENBAUM")["metadata"]["scoring"]
        assert scoring["segmentation_language"] == "de"
        assert scoring["segmented_text"] == "DER SCHATZ IST UNTER DEM GROSSEN BAUM"

    @pytest.mark.parametrize("text, expected", [
        # Un mot frequent l'emporte sur un mot rare : "trouve au", pas "trou veau".
        ("LACACHESETROUVEAUPIEDDUGRANDARBREPRESDELARIVIERE",
         "LA CACHE SE TROUVE AU PIED DU GRAND ARBRE PRES DE LA RIVIERE"),
        # Aucune lettre laissee de cote : "cache se", pas "caches e".
        ("lacachesetrouvesouslepontdebois", "la cache se trouve sous le pont de bois"),
        ("THETREASUREISHIDDENNEARTHEOLDOAKTREE", "THE TREASURE IS HIDDEN NEAR THE OLD OAK TREE"),
        ("ELTESOROESTAESCONDIDOCERCADELGRANARBOL", "EL TESORO ESTA ESCONDIDO CERCA DEL GRAN ARBOL"),
        ("Felicitationsvousaveztrouve", "Felicitations vous avez trouve"),
        ("DERRIERELEPANNEAUVERT", "DERRIERE LE PANNEAU VERT"),
        ("SOUSLEBANC", "SOUS LE BANC"),
    ])
    def test_split_is_the_natural_reading(self, text, expected):
        assert score_text(text)["metadata"]["scoring"]["segmented_text"] == expected

    def test_mixed_case_glued_text_is_not_taken_for_base64(self):
        """Casse mixte : ressemble a du base64, mais se decoupe en vrais mots."""
        text = "LaCacheSeTrouveSousLePontDeBois"
        scoring = score_text(text)["metadata"]["scoring"]
        assert scoring["segmented_text"] == "La Cache Se Trouve Sous Le Pont De Bois"
        assert scoring["features"]["encoded_penalty"] == 1.0
        assert scoring["score"] >= 0.55
        # Un vrai bloc base64 ne se decoupe pas et reste penalise.
        for block in CASES["base64_blocks"]:
            assert score_text(block)["metadata"]["scoring"]["features"]["encoded_penalty"] <= 0.1

    def test_split_keeps_case_and_accents(self):
        scoring = score_text("lacachesetrouveprèsdelarivière")["metadata"]["scoring"]
        assert scoring["segmented_text"].replace(" ", "") == "lacachesetrouveprèsdelarivière"
        assert "près" in scoring["segmented_text"].split()

    @pytest.mark.parametrize("text", [
        "LA CACHE SE TROUVE AU PIED DU GRAND ARBRE",   # deja espace
        "LAMPADAIRE",                                    # mot reel hors vocabulaire
        "XQZJWKLMNPVBGHTRDWSAQPLMZ",                     # charabia
        "N 48° 51.234 E 002° 21.456",                    # coordonnees
    ])
    def test_other_texts_are_left_alone(self, text):
        assert not score_text(text)["metadata"]["scoring"].get("segmented_text")

    def test_letter_soup_is_rarely_segmented(self):
        """Lettres aux frequences naturelles mais en desordre : le decoupage ne
        doit presque jamais prendre (sinon le charabia gagnerait du lexical)."""
        import random

        from gc_backend.plugins.scoring.scorer import _segment_glued_run

        rng = random.Random(5)
        source = "lacachesetrouveaupieddugrandarbrepresdelarivierederrierelevieuxmoulin"
        accepted = sum(
            _segment_glued_run("".join(rng.choice(source) for _ in range(length))) is not None
            for length in (8, 10, 12, 16, 24)
            for _ in range(300)
        )
        assert accepted <= 15, f"{accepted}/1500 soupes de lettres decoupees"


# ── Vocabulaire ─────────────────────────────────────────────────────


class TestVocabulary:
    """Le dictionnaire couvre le vocabulaire courant d'une geocache sans
    s'ouvrir aux mots courts de hasard."""

    @pytest.mark.parametrize("word", [
        "felicitations", "lampadaire", "souche", "panneau", "banc", "poteau",
        "grillage", "fontaine", "cimetiere", "barriere", "ruisseau", "sentier",
        "rocher", "aimant", "chapelle", "magnetique",
        "treasure", "fence", "stump", "bridge", "bench",
        "versteckt", "friedhof", "brunnen", "kirche",
        "escondido", "puente", "iglesia", "skarb",
    ])
    def test_everyday_geocaching_word_is_known(self, word):
        assert word in _all_known_words()

    def test_untransliterable_letters_match_their_ascii_spelling(self):
        """ß, ł, œ ne sont pas decomposes par NFKD : translitteres a la main."""
        known = _all_known_words()
        for written, ascii_form in (("Straße", "strasse"), ("głęboki", "gleboki"), ("cœur", "coeur")):
            assert _norm_lex_token(written) == ascii_form
            assert ascii_form in known, ascii_form

    def test_short_words_stay_scarce(self):
        """Les mots de 2 et 3 lettres sont ce qu'un charabia reconnait par
        hasard : leur nombre ne doit pas enfler avec le vocabulaire."""
        known = _all_known_words()
        by_length = {n: sum(1 for w in known if len(w) == n) for n in (2, 3)}
        assert by_length[2] <= 300, by_length
        assert by_length[3] <= 1200, by_length

    def test_wrong_caesar_shifts_gain_no_lexical_credit(self):
        prose = CASES["correct_decrypt"] + CASES["multilingual_valid"]
        values = [
            score_text(_caesar(t, k))["metadata"]["scoring"]["features"]["lexical_coverage"]
            for t in prose for k in range(1, 26)
        ]
        # ~0.08 : les mots de 2-3 lettres que le hasard produit ("la", "de", "is").
        assert sum(values) / len(values) <= 0.12


# ── Assertion 1 : ecart correct vs near-miss (XFAIL — cible T6) ─────


class TestCorrectVsNearMiss:
    """Un dechiffrement correct doit se detacher NETTEMENT d'un near-miss
    (une lettre / un decalage d'ecart), sinon le bon resultat ne remonte pas
    en tete d'un bruteforce. Ecart cible: >= 0.30.

    Etat actuel: ecart plein ~0.5, ecart fast ~0.6.
    """

    MIN_GAP = 0.30

    def test_gap_full(self):
        # Resolu par T3 : le lexical honnete retire au near-miss son credit
        # lexical bidon (lex~0) alors que le texte correct le conserve (lex~1),
        # ce qui creuse l'ecart bien au-dela de 0.30 (~0.51).
        correct_floor = min(_full(t) for t in CASES["correct_decrypt"])
        near_ceiling = max(_full(t) for t in _near_miss_cases())
        assert correct_floor - near_ceiling >= self.MIN_GAP, (
            f"ecart full = {correct_floor - near_ceiling:.3f} "
            f"(correct min {correct_floor:.3f} - near max {near_ceiling:.3f})"
        )

    def test_gap_fast(self):
        # Resolu par les tables de quadgrammes issues de wordfreq : les tables
        # en/fr/de synthetisees depuis des bigrammes ne separaient presque pas
        # un texte reel d'un near-miss (ecart ~0.24) ; il depasse desormais 0.6.
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

    T4 (fusion en numeric_signal) a corrige la FEATURE : une enumeration pure
    plafonne a 0.45, un fragment de coordonnees structure monte bien plus haut
    (cf. test_feature_separates_enum_from_word_coords, qui passe).

    Mais l'ordre au niveau du SCORE FINAL reste bloque par la saturation de la
    combinaison additive (lexical + coherence eleves car les mots-nombres sont
    du vrai vocabulaire) : les deux atteignent encore 1.0. A lever apres la
    de-saturation de T6.
    """

    def test_feature_separates_enum_from_word_coords(self):
        # Livrable direct de T4 : au niveau de la feature, l'enumeration pure
        # est plafonnee a 0.45 tandis que les fragments de coords la depassent.
        enum_max = max(_numeric_signal_feature(t) for t in CASES["number_enum"])
        word_min = min(_numeric_signal_feature(t) for t in CASES["word_coords"])
        assert enum_max <= 0.45, f"numeric_signal enum devrait plafonner a 0.45, got {enum_max:.3f}"
        assert word_min > enum_max, (
            f"numeric_signal word_coords min ({word_min:.3f}) doit depasser "
            f"enum max ({enum_max:.3f})"
        )

    def test_enum_below_word_coords(self):
        # Resolu par T6 : apres de-saturation, une enumeration pure (numeric_signal
        # plafonne a 0.45) reste sous un vrai fragment de coordonnees structure.
        enum_max = max(_full(t) for t in CASES["number_enum"])
        word_min = min(_full(t) for t in CASES["word_coords"])
        assert enum_max < word_min, (
            f"number_enum max ({enum_max:.3f}) doit rester sous "
            f"word_coords min ({word_min:.3f})"
        )


# ── Faux signal numerique : articles, conjonctions, homographes ─────


class TestNumericLookalikes:
    """Une phrase banale ne doit pas ouvrir le canal coordonnees parce qu'elle
    contient 'un', 'et' ou 'est' ; de vraies coordonnees ecrites le doivent."""

    @pytest.mark.parametrize("text", CASES["prose_with_number_lookalikes"])
    def test_prose_has_no_numeric_signal(self, text):
        assert _numeric_signal_feature(text) <= 0.15, text

    @pytest.mark.parametrize("text", CASES["word_coords_tens"])
    def test_written_tens_keep_numeric_signal(self, text):
        assert _numeric_signal_feature(text) >= 0.6, text

    def test_ambiguous_word_counts_next_to_a_number(self):
        # "un" seul n'est pas un nombre, "vingt et un" en fait deux.
        assert _numeric_signal_feature("un arbre et une pierre") == 0.0
        assert _numeric_signal_feature("vingt et un") > 0.0

    def test_word_coords_still_beat_lookalike_prose(self):
        prose_max = max(_full(t) for t in CASES["prose_with_number_lookalikes"])
        coords_min = min(_full(t) for t in CASES["word_coords"] + CASES["word_coords_tens"])
        assert coords_min > prose_max, f"{coords_min:.3f} <= {prose_max:.3f}"


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

    def test_dms_suffix_direction_now_reaches_target(self):
        # Format DMS a direction suffixe : detecte depuis le Lot 4.2, doit scorer haut.
        text = "48°51'24\" N 2°21'27\" E"
        assert _full(text) >= self.TARGET, (
            f"DMS suffixe sous-note : full={_full(text):.3f} < cible {self.TARGET}"
        )


# ── T5 : n-gram fitness multilingue + decouplage trigram/langid ─────────


class TestMultilingualNgram:
    """Le n-gram fitness doit fonctionner pour les 8 langues, pas seulement
    en/fr/de. Depend des tables quadgram es/it/nl/pt/pl (T5) et du best-of sur
    toutes les tables disponibles."""

    def test_all_eight_quadgram_tables_present(self):
        langs = set(available_quadgram_langs())
        expected = {"en", "fr", "de", "es", "it", "nl", "pt", "pl"}
        missing = expected - langs
        assert not missing, f"Tables quadgram manquantes : {missing}"

    @pytest.mark.parametrize("text", CASES["multilingual_valid"])
    def test_valid_text_has_ngram_signal(self, text):
        # Metrique aval reellement utilisee par le scorer (trigram*0.5 +
        # quadgram*0.7). Les profils langid ne font que ~30 trigrammes, donc
        # c'est le quadgram multilingue qui porte le signal.
        ng = _ngram_fitness(text)
        assert ng > 0.3, f"ngram_fitness={ng:.3f} trop faible | {text}"

    # Ordre des cas de multilingual_valid dans la fixture.
    LANG_ORDER = ["en", "fr", "de", "es", "it", "nl", "pt", "pl"]

    @pytest.mark.parametrize("index", range(8))
    def test_own_table_scores_its_language_best(self, index):
        """Chaque table reconnait sa langue mieux que les 7 autres : c'est ce qui
        distingue de vraies tables de quadgrammes d'un modele de bigrammes."""
        lang = self.LANG_ORDER[index]
        letters = _normalize_for_stats(CASES["multilingual_valid"][index])
        scores = {lg: _quadgram_fitness_for_lang(letters, lg) for lg in self.LANG_ORDER}
        assert max(scores, key=scores.get) == lang, scores
        assert scores[lang] >= 0.5, scores

    @pytest.mark.parametrize("index", range(8))
    def test_tables_tell_real_text_from_shuffled_letters(self, index):
        """Memes lettres dans le desordre : la meilleure table doit decrocher
        nettement (les tables synthetisees depuis des bigrammes ne le faisaient pas)."""
        import random

        letters = _normalize_for_stats(CASES["multilingual_valid"][index])
        shuffled = list(letters)
        random.Random(index).shuffle(shuffled)
        shuffled = "".join(shuffled)

        def best(text):
            return max(_quadgram_fitness_for_lang(text, lg) for lg in self.LANG_ORDER)

        assert best(letters) - best(shuffled) >= 0.2, (best(letters), best(shuffled))

    def test_no_entry_below_the_unknown_floor(self):
        """Une entree sous -6.0 noterait un quadgramme connu plus bas qu'un inconnu."""
        for lang in self.LANG_ORDER:
            assert min(load_quadgrams(lang).values()) >= -6.0, lang

    def test_multilingual_valid_survive_ranking(self):
        valid = CASES["multilingual_valid"]
        results = [{"text_output": t} for t in valid]
        ranked = score_and_rank_results(
            results, top_k=len(valid) + 5, min_score=0.03, fast_reject_threshold=0.01
        )
        survivors = {r["text_output"] for r in ranked}
        missing = [t for t in valid if t not in survivors]
        assert not missing, f"Textes multilingues valides rejetes : {missing}"


class TestLangidFitnessDecoupling:
    """La fitness trigram (langid.fitness) doit etre DECOUPLEE de la confiance
    de detection (langid.confidence). confidence s'effondre a ~0 quand deux
    langues sont quasi a egalite ; fitness conserve le ratio brut de trigrammes.
    """

    def test_fitness_never_below_confidence(self):
        # Invariant : fitness = meilleur ratio brut, confidence = ratio penalise
        # par l'ambiguite -> fitness >= confidence toujours.
        for text in CASES["multilingual_valid"] + CASES["correct_decrypt"]:
            r = detect_language(text, DEFAULT_LANGS_EUROPE)
            assert r.fitness >= r.confidence - 1e-9, (
                f"fitness ({r.fitness:.3f}) < confidence ({r.confidence:.3f}) | {text}"
            )

    def test_ambiguity_collapse_is_recovered(self):
        # Au moins un texte valide subit l'effondrement de confidence (langues
        # proches) tout en gardant une fitness strictement superieure : c'est
        # le signal que le decouplage recupere.
        recovered = []
        for text in CASES["multilingual_valid"] + CASES["correct_decrypt"]:
            r = detect_language(text, DEFAULT_LANGS_EUROPE)
            if r.fitness > r.confidence + 0.02:
                recovered.append((text, r.confidence, r.fitness))
        assert recovered, (
            "Aucun cas d'effondrement de confidence recupere par fitness ; "
            "le decouplage n'est pas demontre par ce jeu de textes."
        )


# ── Contexte geographique : distance a la cache ─────────────────────


class TestGeoContext:
    """Des coordonnees trouvees dans un resultat sont ponderees par leur
    distance a la cache, quand l'appelant fournit ses coordonnees."""

    ORIGIN = {"origin_coords": "N 48° 51.000 E 002° 21.000"}
    NEAR = "N 48° 51.234 E 002° 22.300"       # ~1,6 km
    REGIONAL = "N 48° 58.000 E 002° 32.000"   # ~19 km
    FAR = "N 49° 20.000 E 002° 40.000"        # ~58 km
    VERY_FAR = "N 49° 55.000 E 003° 40.000"   # ~150 km
    ELSEWHERE = "N 45° 45.000 E 004° 50.000"  # ~390 km

    def _score(self, text, context=None):
        return score_text(text, context)

    def test_without_origin_nothing_changes(self):
        for text in (self.NEAR, self.ELSEWHERE):
            scoring = self._score(text)["metadata"]["scoring"]
            assert scoring["geo"] is None
            assert self._score(text, {})["score"] == self._score(text)["score"]

    def test_near_coordinates_are_boosted(self):
        plain = self._score(self.NEAR)["score"]
        scored = self._score(self.NEAR, self.ORIGIN)
        geo = scored["metadata"]["scoring"]["geo"]
        assert geo["status"] == "near" and geo["distance_km"] < 3.3
        assert scored["score"] > plain

    def test_regional_coordinates_are_untouched(self):
        scored = self._score(self.REGIONAL, self.ORIGIN)
        assert scored["metadata"]["scoring"]["geo"]["status"] == "plausible"
        assert scored["score"] == self._score(self.REGIONAL)["score"]

    def test_score_decreases_with_distance(self):
        scores = [
            self._score(t, self.ORIGIN)["score"]
            for t in (self.NEAR, self.REGIONAL, self.FAR, self.VERY_FAR, self.ELSEWHERE)
        ]
        assert scores == sorted(scores, reverse=True), scores
        assert scores[0] - scores[-1] >= 0.4

    def test_far_coordinates_fall_below_plain_text(self):
        """Un mauvais dechiffrement qui ressemble a des coordonnees, a 390 km,
        ne doit plus passer devant un vrai texte clair."""
        prose = min(self._score(t, self.ORIGIN)["score"] for t in CASES["correct_decrypt"])
        assert self._score(self.ELSEWHERE, self.ORIGIN)["score"] < prose
        assert self._score(self.ELSEWHERE)["score"] > prose  # sans origine : comme avant

    def test_raw_confidence_is_kept_for_audit(self):
        scoring = self._score(self.ELSEWHERE, self.ORIGIN)["metadata"]["scoring"]
        assert scoring["geo"]["gps_confidence_raw"] > scoring["features"]["gps_confidence"]

    def test_text_without_coordinates_ignores_the_origin(self):
        # Prose, et coordonnees ecrites en toutes lettres (aucune position calculable).
        for text in CASES["correct_decrypt"] + CASES["word_coords"][:1]:
            assert self._score(text, self.ORIGIN)["score"] == self._score(text)["score"]
            assert self._score(text, self.ORIGIN)["metadata"]["scoring"]["geo"] is None

    def test_same_text_is_cached_per_origin(self):
        """L'origine entre dans la cle du cache : deux caches, deux scores."""
        here = self._score(self.NEAR, self.ORIGIN)["score"]
        there = self._score(self.NEAR, {"origin_coords": "N 45° 45.000 E 004° 50.000"})["score"]
        assert here > there
        assert self._score(self.NEAR, self.ORIGIN)["score"] == here

    def test_origin_settles_the_o_ambiguity(self):
        """« O » = Ost (Est) pres d'une cache allemande, Ouest sans origine."""
        text = "N48 51.234 O009 21.456"
        german = self._score(text, {"origin_coords": "N 48° 50.000 E 009° 20.000"})
        assert german["metadata"]["scoring"]["gps_patterns"] == ["N 48° 51.234' E 009° 21.456'"]
        assert self._score(text)["metadata"]["scoring"]["gps_patterns"] == ["N 48° 51.234' W 009° 21.456'"]

    @pytest.mark.parametrize("context, expected", [
        ({"origin_latitude": 48.85, "origin_longitude": 2.35}, (48.85, 2.35)),
        ({"origin_coords": {"ddm_lat": "N 48° 51.000'", "ddm_lon": "E 002° 21.000'"}}, (48.85, 2.35)),
        ({"origin_coords": "n'importe quoi"}, None),
        ({"origin_latitude": "abc", "origin_longitude": 2}, None),
        ({"origin_latitude": 480, "origin_longitude": 2}, None),
        ({"origin_coords": ["x"]}, None),
        ({"cle_de_plugin": [1, 2]}, None),
        ({}, None),
        (None, None),
        ("pas un dict", None),
    ])
    def test_origin_parsing_is_tolerant(self, context, expected):
        assert _origin_from_context(context) == expected

    def test_ranking_uses_the_origin(self):
        items = [
            {"text_output": self.ELSEWHERE, "id": "loin"},
            {"text_output": self.NEAR, "id": "pres"},
            {"text_output": "LA CACHE EST SOUS LE PONT", "id": "texte"},
        ]
        ranked = score_and_rank_results(items, top_k=10, min_score=0.03, context=self.ORIGIN)
        assert [r["id"] for r in ranked] == ["pres", "texte", "loin"]

# ── Echelle des scores ──────────────────────────────────────────────


class TestScoreScale:
    """Un texte clair doit atteindre la zone « bon » de l'interface (>= 0.8),
    un mauvais dechiffrement rester dans le bas de l'echelle."""

    UI_GOOD = 0.8   # getScoreColor, plugin-result-display.tsx
    UI_MEDIUM = 0.5

    @pytest.mark.parametrize("text", CASES["correct_decrypt"])
    def test_clear_sentence_reaches_the_good_zone(self, text):
        assert _full(text) >= self.UI_GOOD

    @pytest.mark.parametrize("text", CASES["short_answers"] + CASES["multilingual_valid"])
    def test_valid_text_reaches_at_least_the_medium_zone(self, text):
        assert _full(text) >= self.UI_MEDIUM

    def test_plain_text_never_outranks_formal_coordinates(self):
        """Le canal langue plafonne a 0.85 : sous le plus faible format de pure_coords."""
        prose = CASES["correct_decrypt"] + CASES["multilingual_valid"] + CASES["short_answers"]
        assert max(_full(t) for t in prose) <= 0.86
        assert min(_full(t) for t in CASES["pure_coords"]) >= 0.90

    @pytest.mark.parametrize("text", CASES["correct_decrypt"] + CASES["multilingual_valid"])
    def test_wrong_caesar_shifts_stay_low(self, text):
        assert max(_full(_caesar(text, k)) for k in range(1, 26)) <= 0.40

    @pytest.mark.parametrize("index", range(8))
    def test_quadgram_fitness_spans_the_scale(self, index):
        """Fitness recalee : ~1 sur un vrai texte, ~0 sur un mauvais decalage."""
        text = CASES["multilingual_valid"][index]
        real = score_text(text)["metadata"]["scoring"]["features"]["quadgram_fitness"]
        assert real >= 0.7, real
        for shift in (1, 7, 13):
            wrong = score_text(_caesar(text, shift))["metadata"]["scoring"]["features"]["quadgram_fitness"]
            assert wrong <= 0.1, (shift, wrong)

# ── Pre-filtre rapide sur de gros lots ───────────────────────────────


class TestPrefilterOnLargeLots:
    """La coupe du pre-filtre grandit avec le lot : une reponse courte, dont le
    score rapide repose sur une ou deux fenetres, ne doit pas etre ecartee avant
    d'avoir ete evaluee par le scorer complet."""

    LOT_SIZE = 3000

    @staticmethod
    def _vigenere(text, key):
        out, j = [], 0
        for ch in text:
            if "A" <= ch <= "Z":
                out.append(chr((ord(ch) - 65 + key[j % len(key)]) % 26 + 65))
                j += 1
            else:
                out.append(ch)
        return "".join(out)

    def _lot(self, text, seed):
        import random

        rng = random.Random(seed)
        keys = [[rng.randrange(26) for _ in range(rng.randint(2, 6))] for _ in range(self.LOT_SIZE - 1)]
        # Une cle nulle redonne le texte lui-meme : ce n'est pas un mauvais candidat.
        wrong = [c for c in (self._vigenere(text, key) for key in keys) if c != text]
        # La bonne reponse est placee en dernier : a score rapide egal, elle
        # n'est pas avantagee par sa position dans le lot.
        return [{"text_output": c} for c in wrong] + [{"text_output": text, "truth": True}]

    def _rank(self, text, seed=4):
        ranked = score_and_rank_results(
            self._lot(text, seed),
            top_k=25,
            min_score=TestValidCasesSurviveRanking.PROD_MIN_SCORE,
            fast_reject_threshold=TestValidCasesSurviveRanking.PROD_FAST_REJECT,
        )
        return next((i + 1 for i, r in enumerate(ranked) if r.get("truth")), None)

    @pytest.mark.parametrize("text", ["PONT", "BLANC", "BRAVO", "ARBRE", "EGLISE", "LOOK UP"])
    def test_short_answer_survives_a_large_lot(self, text):
        assert self._rank(text) is not None, f"{text} ecarte par le pre-filtre"

    @pytest.mark.parametrize("text", [
        "SOUS LE BANC", "UNDER THE BRIDGE", "DERRIERE LE PANNEAU",
        "LACACHESETROUVEAUPIEDDUGRANDARBRE", "FELICITATIONS",
    ])
    def test_longer_answer_stays_first(self, text):
        assert self._rank(text) == 1

    def test_ties_at_the_cut_are_all_kept(self):
        """Score rapide sature : 200 candidats a egalite, aucun coupe arbitrairement."""
        tied = [{"text_output": f"LA CACHE EST SOUS LE PONT {i}", "n": i} for i in range(200)]
        ranked = score_and_rank_results(tied, top_k=200, min_score=0.0, fast_reject_threshold=0.0)
        assert len(ranked) == 200

# ── Detection de langue ──────────────────────────────────────────────


class TestLanguageIdentification:
    """La langue vient des tables de quadgrammes et du vocabulaire, plus des
    profils de 28 trigrammes (qui repondaient « unknown » a la plupart des
    phrases en majuscules)."""

    LANG_ORDER = ["en", "fr", "de", "es", "it", "nl", "pt", "pl"]

    @staticmethod
    def _language(text):
        scoring = score_text(text)["metadata"]["scoring"]
        return scoring["language_detected"], scoring["language_confidence"]

    @pytest.mark.parametrize("index", range(8))
    def test_sentence_language(self, index):
        language, confidence = self._language(CASES["multilingual_valid"][index])
        assert language == self.LANG_ORDER[index]
        assert confidence >= 0.5

    @pytest.mark.parametrize("index", range(8))
    def test_glued_sentence_language(self, index):
        glued = CASES["multilingual_valid"][index].replace(" ", "")
        assert self._language(glued)[0] == self.LANG_ORDER[index]

    @pytest.mark.parametrize("text, expected", [
        ("PONT", "fr"),
        ("SOUS LE BANC", "fr"),
        ("DERRIERE LE PANNEAU", "fr"),
        ("UNDER THE BRIDGE", "en"),
        ("HINTER DEM SCHILD", "de"),
        ("DEBAJO DEL PUENTE", "es"),
        ("SOTTO IL PONTE", "it"),
        ("ONDER DE BRUG", "nl"),
        ("DEBAIXO DA PONTE", "pt"),
        ("POD MOSTEM", "pl"),
        ("la cache se trouve sous le pont", "fr"),
        ("nord quarante huit degres cinquante et un", "fr"),
    ])
    def test_short_answer_language(self, text, expected):
        assert self._language(text)[0] == expected

    @pytest.mark.parametrize("text", CASES["gibberish"] + CASES["encoded"] + CASES["base64_blocks"] + [
        "N 48° 51.234 E 002° 21.456",
        "QJFE EV HSBOE BSCSF",
        "12 34 56",
        "",
    ])
    def test_no_language_for_non_text(self, text):
        assert self._language(text) == ("unknown", 0.0)

    def test_wrong_caesar_shifts_have_no_language(self):
        for text in CASES["correct_decrypt"]:
            for shift in (1, 5, 11, 17, 23):
                assert self._language(_caesar(text, shift))[0] == "unknown", (text, shift)

    def test_confidence_is_bounded(self):
        for cat in CASES.values():
            for text in cat:
                assert 0.0 <= self._language(text)[1] <= 1.0