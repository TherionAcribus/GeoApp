"""Tests for shared coordinate conversion helpers."""

import math

import pytest

from gc_backend.utils.coordinate_converters import (
    convert_to_code,
    convert_to_format,
    convert_to_grid,
    convert_to_special,
    find_coordinate_candidates,
    parse_coordinate,
)


EIFFEL_DD = "48.85837, 2.294481"


def assert_close(value, expected, tolerance=0.0002):
    assert abs(value - expected) < tolerance


def test_parse_and_format_dd_ddm_dms():
    dd_result = convert_to_format(EIFFEL_DD, source_format="dd", target_format="all")
    assert_close(dd_result["decimal_latitude"], 48.85837)
    assert_close(dd_result["decimal_longitude"], 2.294481)
    assert "ddm" in dd_result["formats"]
    assert "dms" in dd_result["formats"]

    ddm = dd_result["formats"]["ddm"]
    parsed_ddm = parse_coordinate(ddm, "ddm")
    assert_close(parsed_ddm.latitude, 48.85837, 0.00002)
    assert_close(parsed_ddm.longitude, 2.294481, 0.00002)

    dms = dd_result["formats"]["dms"]
    parsed_dms = parse_coordinate(dms, "dms")
    assert_close(parsed_dms.latitude, 48.85837, 0.00002)
    assert_close(parsed_dms.longitude, 2.294481, 0.00002)


def test_parse_ddm_with_replacement_question_mark_degree_symbol():
    parsed = parse_coordinate("N 48? 51.502 E 002? 17.669", "ddm")
    assert_close(parsed.latitude, 48.85837, 0.00002)
    assert_close(parsed.longitude, 2.294481, 0.00002)


def test_grid_utm_mgrs_webmercator_roundtrips():
    grid = convert_to_grid(EIFFEL_DD, source_format="dd", target_format="all")
    assert "utm" in grid["formats"]
    assert "mgrs" in grid["formats"]
    assert "web_mercator" in grid["formats"]

    utm_result = parse_coordinate(grid["formats"]["utm"], "utm")
    assert_close(utm_result.latitude, 48.85837, 0.0001)
    assert_close(utm_result.longitude, 2.294481, 0.0001)

    mgrs_result = parse_coordinate(grid["formats"]["mgrs"], "mgrs")
    assert_close(mgrs_result.latitude, 48.85837, 0.0002)
    assert_close(mgrs_result.longitude, 2.294481, 0.0002)

    wm_result = parse_coordinate(grid["formats"]["web_mercator"], "web_mercator")
    assert_close(wm_result.latitude, 48.85837, 0.0001)
    assert_close(wm_result.longitude, 2.294481, 0.0001)


def test_long_compact_mgrs_is_detected_before_webmercator():
    parsed = parse_coordinate("31UDQ48251846741193823573", "auto")
    assert parsed.source_format == "mgrs"
    assert_close(parsed.latitude, 48.85837, 0.01)
    assert_close(parsed.longitude, 2.294481, 0.01)


def test_osgb_known_london_point():
    grid = convert_to_grid("51.5074, -0.1278", source_format="dd", target_format="osgb")
    assert grid["formats"]["osgb"]

    parsed = parse_coordinate(grid["formats"]["osgb"], "osgb")
    assert_close(parsed.latitude, 51.5074, 0.0002)
    assert_close(parsed.longitude, -0.1278, 0.0002)


def test_geohash_and_plus_code_area_decode():
    codes = convert_to_code(EIFFEL_DD, source_format="dd", target_format="all")
    assert codes["formats"]["geohash"].startswith("u09tun")
    assert "+" in codes["formats"]["plus_code"]
    assert codes["formats"]["mapcode"]

    geohash_result = parse_coordinate(codes["formats"]["geohash"], "geohash")
    assert geohash_result.bbox
    assert_close(geohash_result.latitude, 48.85837, 0.0001)
    assert_close(geohash_result.longitude, 2.294481, 0.0001)

    plus_result = parse_coordinate(codes["formats"]["plus_code"], "plus_code")
    assert plus_result.bbox
    assert_close(plus_result.latitude, 48.85837, 0.0002)
    assert_close(plus_result.longitude, 2.294481, 0.0002)


def test_geohash_auto_is_not_parsed_as_decimal_degrees():
    codes = convert_to_code("u09tunqu5", source_format="auto", target_format="all")
    assert codes["source_format"] == "geohash"
    assert_close(codes["decimal_latitude"], 48.85829, 0.0002)
    assert "geocaching" in codes["formats"]
    assert codes["coordinates"]["formatted"].startswith("N 48")


def test_code_converter_can_output_geocaching_format():
    result = convert_to_code("FRA 4J.Q3", source_format="auto", target_format="geocaching")
    assert result["target_format"] == "ddm"
    assert result["text_output"].startswith("N 48")
    assert result["coordinates"]["formatted"].startswith("N 48")
    assert result["coordinates"]["source_formatted"] == "FRA 4J.Q3"


def test_find_coordinate_candidates_extracts_multiple_formats():
    text = (
        "Start N 48° 51.502 E 002° 17.669. "
        "Backup geohash u09tunqu5 and mapcode FRA 4J.Q3."
    )
    candidates = find_coordinate_candidates(text)
    formats = [candidate.source_format for candidate in candidates]
    assert "ddm" in formats
    assert "geohash" in formats
    assert "mapcode" in formats
    assert len(candidates) >= 3


def test_find_coordinate_candidates_extracts_special_formats():
    text = "Use GARS 365MP24, locator JN18DU, and tile 15/16592/11272."
    candidates = find_coordinate_candidates(text)
    formats = [candidate.source_format for candidate in candidates]
    assert "gars" in formats
    assert "qth" in formats
    assert "slippy" in formats


def test_special_formats_gars_qth_nac_roundtrip():
    special = convert_to_special(EIFFEL_DD, source_format="dd", target_format="all", precision=10, zoom=15)
    assert special["formats"]["gars"]
    assert special["formats"]["qth"]
    assert special["formats"]["nac"]

    for fmt in ["gars", "qth", "nac"]:
        parsed = parse_coordinate(special["formats"][fmt], fmt)
        assert_close(parsed.latitude, 48.85837, 0.1)
        assert_close(parsed.longitude, 2.294481, 0.1)


def test_special_formats_slippy_and_quadkey_roundtrip():
    special = convert_to_special(EIFFEL_DD, source_format="dd", target_format="all", zoom=15)
    slippy = parse_coordinate(special["formats"]["slippy"], "slippy")
    quadkey = parse_coordinate(special["formats"]["quadkey"], "quadkey")
    assert_close(slippy.latitude, 48.85837, 0.01)
    assert_close(slippy.longitude, 2.294481, 0.01)
    assert_close(quadkey.latitude, slippy.latitude, 0.000001)
    assert_close(quadkey.longitude, slippy.longitude, 0.000001)


def test_special_formats_rd_and_lambert_roundtrip():
    amsterdam = "52.37308, 4.89245"
    rd = convert_to_special(amsterdam, source_format="dd", target_format="rd")
    parsed_rd = parse_coordinate(rd["text_output"], "rd")
    assert_close(parsed_rd.latitude, 52.37308, 0.0001)
    assert_close(parsed_rd.longitude, 4.89245, 0.0001)

    lambert_93 = convert_to_special("48.8566, 2.3522", source_format="dd", target_format="lambert_93")
    parsed_l93 = parse_coordinate(lambert_93["text_output"], "lambert_93")
    assert_close(parsed_l93.latitude, 48.8566, 0.0001)
    assert_close(parsed_l93.longitude, 2.3522, 0.0001)

    lambert_72 = convert_to_special("50.8466, 4.3528", source_format="dd", target_format="lambert_72")
    parsed_l72 = parse_coordinate(lambert_72["text_output"], "lambert_72")
    assert_close(parsed_l72.latitude, 50.8466, 0.0001)
    assert_close(parsed_l72.longitude, 4.3528, 0.0001)


def test_special_formats_projected_and_grid_roundtrip():
    special = convert_to_special(EIFFEL_DD, source_format="dd", target_format="all", precision=10, zoom=15)
    for fmt in ["xyz", "swissgrid", "swissgrid_plus", "gauss_kruger"]:
        parsed = parse_coordinate(special["formats"][fmt], fmt)
        assert_close(parsed.latitude, 48.85837, 0.0002)
        assert_close(parsed.longitude, 2.294481, 0.0002)

    parsed_dfci = parse_coordinate(special["formats"]["dfci_grid"], "dfci_grid")
    assert_close(parsed_dfci.latitude, 48.85837, 0.002)
    assert_close(parsed_dfci.longitude, 2.294481, 0.002)


def test_special_formats_exotic_code_roundtrip():
    special = convert_to_special(EIFFEL_DD, source_format="dd", target_format="all", precision=12, zoom=15)
    tolerances = {
        "geo3x3": 0.0015,
        "makaney": 0.0002,
        "bosch": 0.00001,
        "geohex": 0.0005,
        "s2cell": 0.00001,
        "reverse_wherigo": 0.00002,
        "reverse_wherigo_10y": 0.00002,
        "reverse_wherigo_day1976": 0.0002,
    }
    for fmt, tolerance in tolerances.items():
        parsed = parse_coordinate(special["formats"][fmt], fmt)
        assert_close(parsed.latitude, 48.85837, tolerance)
        assert_close(parsed.longitude, 2.294481, tolerance)


def test_parse_gcwizard_examples_for_new_formats():
    qth = parse_coordinate("CN85TG09JU", "qth")
    assert_close(qth.latitude, 45.29100, 0.0001)
    assert_close(qth.longitude, -122.41333, 0.0001)

    for raw, fmt in [
        ("M97F-BBOOI", "makaney"),
        ("RU568425483853568", "geohex"),
        ("W7392967941169", "geo3x3"),
        ("5KFFA65ISFHTI85X", "bosch"),
        ("47a8f7ef6060b111", "s2cell"),
        ("GL02C3.1", "dfci_grid"),
        ("3f8f1, z4ee4", "reverse_wherigo_day1976"),
    ]:
        parsed = parse_coordinate(raw, fmt)
        assert math.isfinite(parsed.latitude)
        assert math.isfinite(parsed.longitude)


def test_plus_code_short_requires_reference_and_mapcode_roundtrip():
    with pytest.raises(Exception):
        parse_coordinate("V75V+8Q", "plus_code")

    plus_result = parse_coordinate(
        "V75V+8Q",
        "plus_code",
        reference_latitude=48.85837,
        reference_longitude=2.294481,
    )
    assert_close(plus_result.latitude, 48.85837, 0.0003)
    assert_close(plus_result.longitude, 2.294481, 0.0003)

    codes = convert_to_code(EIFFEL_DD, source_format="dd", target_format="mapcode", mapcode_territory="FRA")
    first = codes["formats"]["mapcode"][0]["formatted"]
    mapcode_result = parse_coordinate(first, "mapcode")
    assert math.isfinite(mapcode_result.latitude)
    assert math.isfinite(mapcode_result.longitude)
