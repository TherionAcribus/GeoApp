"""Tests for coordinate_intersect_circles plugin."""

import sys
import pathlib
import math

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[3] / "backend"))

import pytest

from plugins.official.coordinate_intersect_circles.main import CoordinateIntersectCirclesPlugin


@pytest.fixture
def plugin():
    return CoordinateIntersectCirclesPlugin()


def test_two_circles_two_intersections(plugin):
    """Two circles of equal radius, centers 200m apart, radius 150m each."""
    result = plugin.execute({
        "center1": "48.85837, 2.294481",
        "radius1": 150,
        "center2": "48.85837, 2.297663",
        "radius2": 150,
        "source_format": "dd",
    })

    assert result["status"] == "ok"
    assert len(result["results"]) == 2
    assert result["results"][0]["metadata"]["is_intersection"] is True
    assert result["primary_coordinates"]["exist"] is True


def test_two_circles_near_tangent(plugin):
    """Two circles nearly tangent: distance ~= r1 + r2, should produce 1 or 2 very close points."""
    result = plugin.execute({
        "center1": "48.85837, 2.294481",
        "radius1": 100,
        "center2": "48.85837, 2.295571",
        "radius2": 100,
        "source_format": "dd",
    })

    assert result["status"] == "ok"
    assert len(result["results"]) >= 1
    if len(result["results"]) == 2:
        lat1 = result["results"][0]["decimal_latitude"]
        lat2 = result["results"][1]["decimal_latitude"]
        assert abs(lat1 - lat2) < 0.002


def test_two_circles_no_intersection_too_far(plugin):
    """Two circles too far apart: distance > r1 + r2."""
    result = plugin.execute({
        "center1": "48.85837, 2.294481",
        "radius1": 50,
        "center2": "48.85837, 2.310000",
        "radius2": 50,
        "source_format": "dd",
    })

    assert result["status"] == "error"
    assert "Aucune intersection" in result["summary"]


def test_two_circles_no_intersection_one_inside(plugin):
    """One circle entirely inside the other."""
    result = plugin.execute({
        "center1": "48.85837, 2.294481",
        "radius1": 1000,
        "center2": "48.85837, 2.294500",
        "radius2": 10,
        "source_format": "dd",
    })

    assert result["status"] == "error"
    assert "Aucune intersection" in result["summary"]


def test_three_circles_returns_sorted_by_accuracy(plugin):
    """Three circles with a common intersection area."""
    result = plugin.execute({
        "center1": "48.85837, 2.294481",
        "radius1": 200,
        "center2": "48.85900, 2.296000",
        "radius2": 200,
        "center3": "48.85800, 2.296000",
        "radius3": 200,
        "source_format": "dd",
    })

    assert result["status"] == "ok"
    assert len(result["results"]) >= 1
    accuracies = [r["metadata"]["accuracy_m"] for r in result["results"]]
    assert accuracies == sorted(accuracies)


def test_three_circles_map_points_include_centers(plugin):
    result = plugin.execute({
        "center1": "48.85837, 2.294481",
        "radius1": 200,
        "center2": "48.85900, 2.296000",
        "radius2": 200,
        "center3": "48.85800, 2.296000",
        "radius3": 200,
        "source_format": "dd",
    })

    assert result["status"] == "ok"
    map_points = result["map_points"]
    center_points = [p for p in map_points if not p.get("is_intersection", True)]
    assert len(center_points) == 3
    for cp in center_points:
        assert cp["circle_radius_m"] is not None


def test_two_circles_map_points_include_centers(plugin):
    result = plugin.execute({
        "center1": "48.85837, 2.294481",
        "radius1": 150,
        "center2": "48.85837, 2.297663",
        "radius2": 150,
        "source_format": "dd",
    })

    assert result["status"] == "ok"
    map_points = result["map_points"]
    center_points = [p for p in map_points if not p.get("is_intersection", True)]
    assert len(center_points) == 2


def test_missing_center1_error(plugin):
    result = plugin.execute({
        "center2": "48.85837, 2.294481",
        "radius2": 100,
    })

    assert result["status"] == "error"
    assert "Centre 1" in result["summary"]


def test_missing_center2_error(plugin):
    result = plugin.execute({
        "center1": "48.85837, 2.294481",
        "radius1": 100,
    })

    assert result["status"] == "error"
    assert "Centre 2" in result["summary"]


def test_invalid_center_coordinate(plugin):
    result = plugin.execute({
        "center1": "not a coordinate",
        "radius1": 100,
        "center2": "48.85837, 2.294481",
        "radius2": 100,
        "source_format": "auto",
    })

    assert result["status"] == "error"
    assert "Centre 1" in result["summary"]


def test_negative_radius_error(plugin):
    result = plugin.execute({
        "center1": "48.85837, 2.294481",
        "radius1": -100,
        "center2": "48.85837, 2.295000",
        "radius2": 100,
        "source_format": "dd",
    })

    assert result["status"] == "error"


def test_output_format_all(plugin):
    result = plugin.execute({
        "center1": "48.85837, 2.294481",
        "radius1": 150,
        "center2": "48.85837, 2.297663",
        "radius2": 150,
        "source_format": "dd",
        "output_format": "all",
    })

    assert result["status"] == "ok"
    text = result["results"][0]["text_output"]
    assert "DD:" in text
    assert "DDM:" in text
    assert "DMS:" in text


def test_ddm_format_centers(plugin):
    result = plugin.execute({
        "center1": "N 48° 51.502 E 002° 17.669",
        "radius1": 200,
        "center2": "N 48° 51.400 E 002° 17.500",
        "radius2": 200,
        "source_format": "auto",
    })

    assert result["status"] == "ok"
    assert len(result["results"]) >= 1


def test_three_circles_accuracy_in_results(plugin):
    result = plugin.execute({
        "center1": "48.85837, 2.294481",
        "radius1": 200,
        "center2": "48.85900, 2.296000",
        "radius2": 200,
        "center3": "48.85800, 2.296000",
        "radius3": 200,
        "source_format": "dd",
    })

    assert result["status"] == "ok"
    for r in result["results"]:
        assert r["metadata"]["accuracy_m"] is not None
        assert r["metadata"]["accuracy_m"] >= 0


def test_two_circles_no_accuracy(plugin):
    """Two-circle intersections should have accuracy=None."""
    result = plugin.execute({
        "center1": "48.85837, 2.294481",
        "radius1": 150,
        "center2": "48.85837, 2.297663",
        "radius2": 150,
        "source_format": "dd",
    })

    assert result["status"] == "ok"
    for r in result["results"]:
        assert r["metadata"]["accuracy_m"] is None


def test_third_circle_optional(plugin):
    """If center3 is empty, only 2-circle intersection is computed."""
    result = plugin.execute({
        "center1": "48.85837, 2.294481",
        "radius1": 150,
        "center2": "48.85837, 2.297663",
        "radius2": 150,
        "center3": "",
        "radius3": 100,
        "source_format": "dd",
    })

    assert result["status"] == "ok"
    assert "2 cercles" in result["summary"]


def test_symmetric_intersections_equidistant(plugin):
    """Two circles with same radius centered on same latitude should produce
    intersections symmetric about that latitude."""
    result = plugin.execute({
        "center1": "48.85837, 2.294481",
        "radius1": 200,
        "center2": "48.85837, 2.298000",
        "radius2": 200,
        "source_format": "dd",
    })

    assert result["status"] == "ok"
    assert len(result["results"]) == 2
    lat1 = result["results"][0]["decimal_latitude"]
    lat2 = result["results"][1]["decimal_latitude"]
    assert abs(lat1 - 48.85837) < 0.002
    assert abs(lat2 - 48.85837) < 0.002
    assert abs(lat1 - lat2) < 1e-6 or abs(lat1 + lat2 - 2 * 48.85837) < 1e-6


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
