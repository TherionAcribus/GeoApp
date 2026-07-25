"""Tests de caractérisation + cible pour la détection de coordonnées (Lot 4).

Objectif : figer les SORTIES correctes (ddm_lat/ddm_lon/décimales/exist) des
formats supportés, indépendamment de quelle fonction interne les produit. Ces tests
doivent rester verts à travers la refonte table-driven (4.1).

La classe TestTargetBehaviour décrit les corrections attendues de la refonte
(validation systématique des bornes + sélection par meilleure confiance) : elle
échoue sur le code pré-refonte (marquée xfail avec strict=False le temps du chantier).
"""

import logging
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

logging.disable(logging.CRITICAL)

from gc_backend.blueprints.coordinates import detect_gps_coordinates as d  # noqa: E402


def _check(text, *, ddm_lat, ddm_lon, dec_lat=None, dec_lon=None, min_conf=0.7, **kw):
    r = d(text, **kw)
    assert r["exist"] is True, f"non détecté: {text!r}"
    assert r["ddm_lat"] == ddm_lat, f"lat: {r['ddm_lat']!r} != {ddm_lat!r}"
    assert r["ddm_lon"] == ddm_lon, f"lon: {r['ddm_lon']!r} != {ddm_lon!r}"
    assert float(r["confidence"]) >= min_conf, f"confiance trop basse: {r['confidence']}"
    if dec_lat is not None:
        assert r["decimal_latitude"] == pytest.approx(dec_lat, abs=1e-4)
    if dec_lon is not None:
        assert r["decimal_longitude"] == pytest.approx(dec_lon, abs=1e-4)
    return r


class TestCharacterizationValidFormats:
    """Sorties correctes qui DOIVENT être préservées par la refonte."""

    def test_dmm_standard(self):
        _check("N 48° 33.787' E 006° 38.803'",
               ddm_lat="N 48° 33.787'", ddm_lon="E 006° 38.803'",
               dec_lat=48.56311667, dec_lon=6.64671667)

    def test_dmm_dot_separator(self):
        _check("N50.02.117 e004.52.677",
               ddm_lat="N 50° 02.117'", ddm_lon="E 004° 52.677'",
               dec_lat=50.03528333, dec_lon=4.87795)

    def test_geocaching_standard(self):
        _check("N48 33.787 E006 38.803",
               ddm_lat="N 48° 33.787'", ddm_lon="E 006° 38.803'",
               dec_lat=48.56311667, dec_lon=6.64671667)

    def test_geocaching_standard_west(self):
        _check("N29 02.879 W98 01.304",
               ddm_lat="N 29° 02.879'", ddm_lon="W 098° 01.304'",
               dec_lat=29.04798333, dec_lon=-98.02173333)

    def test_compact(self):
        _check("N4812123E00612123",
               ddm_lat="N 48° 12.123'", ddm_lon="E 006° 12.123'",
               dec_lat=48.20205, dec_lon=6.20205)

    def test_compact_south_west(self):
        _check("S4812123W00612123",
               ddm_lat="S 48° 12.123'", ddm_lon="W 006° 12.123'",
               dec_lat=-48.20205, dec_lon=-6.20205)

    def test_dms(self):
        _check("N 48° 51' 24.12\" E 002° 17' 26.1\"",
               ddm_lat="N 48° 51.402'", ddm_lon="E 002° 17.435'",
               dec_lat=48.8567, dec_lon=2.29058333, min_conf=0.85)

    def test_dmm_no_degree_symbol(self):
        _check("N 38 32.460 W 075 43.659",
               ddm_lat="N 38° 32.460'", ddm_lon="W 075° 43.659'",
               dec_lat=38.541, dec_lon=-75.72765, min_conf=0.85)

    def test_dmm_no_symbol_no_dot(self):
        _check("N 38 32 460 W 075 43 659",
               ddm_lat="N 38° 32.460'", ddm_lon="W 075° 43.659'",
               dec_lat=38.541, dec_lon=-75.72765, min_conf=0.8)

    def test_nord_est_spaces(self):
        _check("NORD 48 32 296 EST 6 40 636",
               ddm_lat="N 48° 32.296'", ddm_lon="E 6° 40.636'",
               dec_lat=48.53826667, dec_lon=6.67726667)

    def test_tabspace(self):
        _check("N 48 ° 32 . 296 E 6 ° 40 . 636",
               ddm_lat="N 48° 32.296'", ddm_lon="E 6° 40.636'",
               dec_lat=48.53826667, dec_lon=6.67726667)

    def test_numeric_only(self):
        _check("4912123 00612123",
               ddm_lat="N 49° 12.123'", ddm_lon="E 006° 12.123'",
               min_conf=0.85, include_numeric_only=True)

    def test_numeric_only_origin_south_west(self):
        _check("4912123 00612123",
               ddm_lat="S 49° 12.123'", ddm_lon="W 006° 12.123'",
               min_conf=0.85, include_numeric_only=True,
               origin_coords="S 33° 51.123 W 151° 12.456")

    def test_detected_mid_prose(self):
        _check("la reponse est N 48° 33.787' E 006° 38.803' bravo",
               ddm_lat="N 48° 33.787'", ddm_lon="E 006° 38.803'")


class TestNewFormats:
    """Formats ajoutés par le Lot 4.2."""

    def test_decimal_pair_comma(self):
        _check("48.8566, 2.3522",
               ddm_lat="N 48° 51.396'", ddm_lon="E 002° 21.132'",
               dec_lat=48.8566, dec_lon=2.3522, min_conf=0.7)

    def test_decimal_pair_negative_space(self):
        # Sydney : latitude sud, longitude est
        _check("-33.8688 151.2093",
               ddm_lat="S 33° 52.128'", ddm_lon="E 151° 12.558'",
               dec_lat=-33.8688, dec_lon=151.2093, min_conf=0.7)

    def test_decimal_pair_rejects_low_precision(self):
        # Trop peu de décimales -> pas une coordonnée
        assert d("3.14, 2.71")["exist"] is False

    def test_decimal_pair_rejects_out_of_bounds(self):
        assert d("191.5, 200.9")["exist"] is False

    def test_dmm_suffix_direction(self):
        _check("48° 51.234' N 2° 17.567' E",
               ddm_lat="N 48° 51.234'", ddm_lon="E 002° 17.567'",
               dec_lat=48.8539, dec_lon=2.29278, min_conf=0.9)

    def test_dms_suffix_direction(self):
        r = _check("48°51'24.1\" N 2°17'26\" E",
                   ddm_lat="N 48° 51.402'", ddm_lon="E 002° 17.433'", min_conf=0.85)
        assert r["decimal_latitude"] == pytest.approx(48.8567, abs=1e-3)


class TestCharacterizationRejections:
    """Entrées qui NE doivent PAS produire de coordonnées."""

    def test_plain_text_rejected(self):
        assert d("bonjour le monde ceci est un test")["exist"] is False

    def test_binary_pure_rejected(self):
        assert d("0110100 0110101", include_numeric_only=True)["exist"] is False


class TestTargetBehaviour:
    """Corrections attendues de la refonte 4.1 (échouent sur le code pré-refonte)."""

    def test_out_of_bounds_rejected(self):
        # Actuellement accepté à tort par un détecteur non-validant (tabpoint).
        assert d("N 99° 88.999' E 200° 99.999'")["exist"] is False

    def test_variant_longitude_not_mangled(self):
        # "NORD 4833787 EST 638803" : nord_est_variations produit un E 638° invalide
        # et gagne par priorité. Après refonte (validation + best-conf), le format
        # variant valide doit l'emporter avec une longitude correcte < 180°.
        r = d("NORD 4833787 EST 638803")
        assert r["exist"] is True
        deg = int(r["ddm_lon"].split("°")[0].split()[-1])
        assert deg <= 180, f"longitude hors bornes: {r['ddm_lon']!r}"


class TestMatchedSpan:
    """matched_text = fragment réellement matché (span), pas le texte entier."""

    def test_span_slices_fragment_in_prose(self):
        text = "la reponse est N 48 33.787 E 006 38.803 bravo"
        r = d(text)
        assert r["exist"] is True
        span = r["span"]
        assert isinstance(span, list) and len(span) == 2
        # Le span pointe sur le fragment, pas sur tout le texte
        assert text[span[0]:span[1]] == r["matched_text"]
        assert r["matched_text"] == "N 48 33.787 E 006 38.803"
        assert r["matched_text"] != text

    def test_span_decimal_pair(self):
        text = "coords: 48.8566, 2.3522 fin"
        r = d(text)
        assert r["matched_text"] == "48.8566, 2.3522"
        assert text[r["span"][0]:r["span"][1]] == r["matched_text"]

    def test_span_bounds_within_text(self):
        text = "avant 4912123 00612123 apres"
        r = d(text, include_numeric_only=True)
        s, e = r["span"]
        assert 0 <= s <= e <= len(text)

    def test_not_found_span_is_none(self):
        r = d("rien du tout ici")
        assert r["exist"] is False
        assert r["span"] is None
        assert r["matched_text"] is None
