"""Tests for coordinate_intersect_bearings plugin."""

import sys
import pathlib
import math

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[3] / "backend"))

import pytest

from plugins.official.coordinate_intersect_bearings.main import CoordinateIntersectBearingsPlugin


@pytest.fixture
def plugin():
    return CoordinateIntersectBearingsPlugin()


def test_perpendicular_bearings(plugin):
    """Point 1 bearing East (90), Point 2 bearing North (0).
    Point 2 is directly east of Point 1, so intersection should be at Point 2's longitude
    and Point 1's latitude."""
    result = plugin.execute({
        "coord1": "48.85837, 2.294481",
        "bearing1": 90,
        "coord2": "48.85837, 2.300000",
        "bearing2": 0,
        "source_format": "dd",
    })

    assert result["status"] == "ok"
    assert len(result["results"]) == 1
    lat = result["results"][0]["decimal_latitude"]
    lon = result["results"][0]["decimal_longitude"]
    assert abs(lat - 48.85837) < 0.001
    assert abs(lon - 2.300000) < 0.001


def test_bearing_north_and_east(plugin):
    """Point 1 bearing North (0), Point 2 bearing West (270).
    Point 2 is directly north of Point 1, so intersection should be at Point 2's latitude
    and Point 1's longitude."""
    result = plugin.execute({
        "coord1": "48.85837, 2.294481",
        "bearing1": 0,
        "coord2": "48.860000, 2.294481",
        "bearing2": 270,
        "source_format": "dd",
    })

    assert result["status"] == "ok"
    lat = result["results"][0]["decimal_latitude"]
    lon = result["results"][0]["decimal_longitude"]
    assert abs(lat - 48.860000) < 0.001
    assert abs(lon - 2.294481) < 0.001


def test_parallel_bearings_no_intersection(plugin):
    """Same bearing from both points = parallel lines."""
    result = plugin.execute({
        "coord1": "48.85837, 2.294481",
        "bearing1": 45,
        "coord2": "48.85900, 2.295000",
        "bearing2": 45,
        "source_format": "dd",
    })

    assert result["status"] == "error"
    assert "paralleles" in result["summary"]


def test_opposite_bearings_no_intersection(plugin):
    """Bearing 45 and 225 are the same line direction = parallel."""
    result = plugin.execute({
        "coord1": "48.85837, 2.294481",
        "bearing1": 45,
        "coord2": "48.85900, 2.295000",
        "bearing2": 225,
        "source_format": "dd",
    })

    assert result["status"] == "error"
    assert "paralleles" in result["summary"]


def test_missing_coord1_error(plugin):
    result = plugin.execute({
        "bearing1": 90,
        "coord2": "48.85837, 2.300000",
        "bearing2": 0,
    })

    assert result["status"] == "error"
    assert "Point de depart 1" in result["summary"]


def test_missing_coord2_error(plugin):
    result = plugin.execute({
        "coord1": "48.85837, 2.294481",
        "bearing1": 90,
        "bearing2": 0,
    })

    assert result["status"] == "error"
    assert "Point de depart 2" in result["summary"]


def test_invalid_bearing_error(plugin):
    result = plugin.execute({
        "coord1": "48.85837, 2.294481",
        "bearing1": 400,
        "coord2": "48.85837, 2.300000",
        "bearing2": 0,
        "source_format": "dd",
    })

    assert result["status"] == "error"
    assert "Azimut 1" in result["summary"]


def test_invalid_coordinate_error(plugin):
    result = plugin.execute({
        "coord1": "not a coordinate",
        "bearing1": 90,
        "coord2": "48.85837, 2.300000",
        "bearing2": 0,
        "source_format": "auto",
    })

    assert result["status"] == "error"
    assert "Point 1" in result["summary"]


def test_output_format_all(plugin):
    result = plugin.execute({
        "coord1": "48.85837, 2.294481",
        "bearing1": 90,
        "coord2": "48.85837, 2.300000",
        "bearing2": 0,
        "source_format": "dd",
        "output_format": "all",
    })

    assert result["status"] == "ok"
    text = result["results"][0]["text_output"]
    assert "DD:" in text
    assert "DDM:" in text
    assert "DMS:" in text


def test_ddm_format_inputs(plugin):
    result = plugin.execute({
        "coord1": "N 48° 51.502 E 002° 17.669",
        "bearing1": 90,
        "coord2": "N 48° 51.502 E 002° 18.000",
        "bearing2": 0,
        "source_format": "auto",
    })

    assert result["status"] == "ok"
    assert len(result["results"]) == 1


def test_map_points_include_starts_and_intersection(plugin):
    result = plugin.execute({
        "coord1": "48.85837, 2.294481",
        "bearing1": 90,
        "coord2": "48.85837, 2.300000",
        "bearing2": 0,
        "source_format": "dd",
    })

    assert result["status"] == "ok"
    map_points = result["map_points"]
    assert len(map_points) == 3
    starts = [p for p in map_points if not p.get("is_intersection", False)]
    assert len(starts) == 2
    for s in starts:
        assert s["bearing_deg"] is not None
    intersection = [p for p in map_points if p.get("is_intersection", False)]
    assert len(intersection) == 1


def test_summary_contains_distances(plugin):
    result = plugin.execute({
        "coord1": "48.85837, 2.294481",
        "bearing1": 90,
        "coord2": "48.85837, 2.300000",
        "bearing2": 0,
        "source_format": "dd",
    })

    assert result["status"] == "ok"
    assert "dist1=" in result["summary"]
    assert "dist2=" in result["summary"]


def test_metadata_contains_bearings(plugin):
    result = plugin.execute({
        "coord1": "48.85837, 2.294481",
        "bearing1": 45,
        "coord2": "48.860000, 2.296000",
        "bearing2": 270,
        "source_format": "dd",
    })

    assert result["status"] == "ok"
    metadata = result["results"][0]["metadata"]
    assert metadata["bearing1"] == 45
    assert metadata["bearing2"] == 270


def test_bearing_180_south(plugin):
    """Point 1 bearing South (180), Point 2 bearing East (90).
    Point 2 is directly south of Point 1, so intersection at Point 2's latitude
    and Point 1's longitude."""
    result = plugin.execute({
        "coord1": "48.860000, 2.294481",
        "bearing1": 180,
        "coord2": "48.85837, 2.294481",
        "bearing2": 90,
        "source_format": "dd",
    })

    assert result["status"] == "ok"
    lat = result["results"][0]["decimal_latitude"]
    lon = result["results"][0]["decimal_longitude"]
    assert abs(lat - 48.85837) < 0.001
    assert abs(lon - 2.294481) < 0.001


def test_same_starting_point(plugin):
    """Both bearings from the same point - should return that point."""
    result = plugin.execute({
        "coord1": "48.85837, 2.294481",
        "bearing1": 45,
        "coord2": "48.85837, 2.294481",
        "bearing2": 135,
        "source_format": "dd",
    })

    assert result["status"] == "ok"
    lat = result["results"][0]["decimal_latitude"]
    lon = result["results"][0]["decimal_longitude"]
    assert abs(lat - 48.85837) < 0.001
    assert abs(lon - 2.294481) < 0.001


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
