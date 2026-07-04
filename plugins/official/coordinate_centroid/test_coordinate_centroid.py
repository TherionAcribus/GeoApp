"""Tests for coordinate_centroid plugin."""

import sys
import pathlib

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[3] / "backend"))

import pytest

from plugins.official.coordinate_centroid.main import CoordinateCentroidPlugin


@pytest.fixture
def plugin():
    return CoordinateCentroidPlugin()


def test_basic_centroid_3_points_ddm(plugin):
    result = plugin.execute({
        "coordinates": "N 48° 51.502 E 002° 17.669\nN 48° 51.400 E 002° 17.500\nN 48° 51.600 E 002° 17.800",
        "source_format": "auto",
        "output_format": "geocaching",
    })

    assert result["status"] == "ok"
    assert len(result["results"]) == 1
    centroid = result["results"][0]
    assert centroid["metadata"]["is_centroid"] is True
    coords = centroid["coordinates"]
    assert coords["exist"] is True
    assert 48.85 < coords["decimal_latitude"] < 48.87
    assert 2.29 < coords["decimal_longitude"] < 2.30
    assert len(result["map_points"]) == 4
    assert result["map_points"][0]["is_centroid"] is False
    assert result["map_points"][3]["is_centroid"] is True


def test_mixed_formats_auto_detection(plugin):
    result = plugin.execute({
        "coordinates": (
            "N 48° 51.502 E 002° 17.669\n"
            "48.85837, 2.294481\n"
            "N 48° 51' 30.120\" E 002° 17' 40.080\""
        ),
        "source_format": "auto",
    })

    assert result["status"] == "ok"
    assert len(result["results"]) == 1
    assert result["primary_coordinates"]["exist"] is True
    assert len(result["map_points"]) == 4


def test_decimal_degree_inputs(plugin):
    result = plugin.execute({
        "coordinates": "48.85837, 2.294481\n48.8566, 2.3522\n48.8600, 2.3200",
        "source_format": "dd",
    })

    assert result["status"] == "ok"
    centroid = result["results"][0]
    lat = centroid["decimal_latitude"]
    lon = centroid["decimal_longitude"]
    assert 48.855 < lat < 48.862
    assert 2.30 < lon < 2.35


def test_5_points(plugin):
    result = plugin.execute({
        "coordinates": (
            "48.85837, 2.294481\n"
            "48.8566, 2.3522\n"
            "48.8600, 2.3200\n"
            "48.8620, 2.3400\n"
            "48.8540, 2.3100"
        ),
        "source_format": "dd",
    })

    assert result["status"] == "ok"
    assert len(result["results"]) == 1
    centroid = result["results"][0]
    assert centroid["metadata"]["is_centroid"] is True
    assert centroid["metadata"]["input_point_count"] == 5
    assert len(result["map_points"]) == 6


def test_2_points_minimum(plugin):
    result = plugin.execute({
        "coordinates": "48.85837, 2.294481\n48.8566, 2.3522",
        "source_format": "dd",
    })

    assert result["status"] == "ok"
    assert len(result["results"]) == 1
    assert len(result["map_points"]) == 3


def test_single_point_error(plugin):
    result = plugin.execute({
        "coordinates": "48.85837, 2.294481",
    })

    assert result["status"] == "error"
    assert "2 coordonnees" in result["summary"]


def test_empty_input(plugin):
    result = plugin.execute({
        "coordinates": "",
    })

    assert result["status"] == "error"
    assert "Aucune" in result["summary"]


def test_invalid_coordinate(plugin):
    result = plugin.execute({
        "coordinates": "N 48° 51.502 E 002° 17.669\nnot a coordinate\n48.85837, 2.294481",
    })

    assert result["status"] == "error"
    assert "Coordonnee 2" in result["summary"]


def test_output_format_all(plugin):
    result = plugin.execute({
        "coordinates": "48.85837, 2.294481\n48.8566, 2.3522\n48.8600, 2.3200",
        "source_format": "dd",
        "output_format": "all",
    })

    assert result["status"] == "ok"
    centroid_text = result["results"][0]["text_output"]
    assert "DD:" in centroid_text
    assert "DDM:" in centroid_text
    assert "DMS:" in centroid_text


def test_centroid_symmetry(plugin):
    coords = [
        "N 48° 51.502 E 002° 17.669",
        "N 48° 51.400 E 002° 17.500",
        "N 48° 51.600 E 002° 17.800",
    ]

    r1 = plugin.execute({"coordinates": "\n".join(coords)})
    r2 = plugin.execute({"coordinates": "\n".join(reversed(coords))})

    c1 = r1["results"][0]["coordinates"]["decimal"]
    c2 = r2["results"][0]["coordinates"]["decimal"]
    assert abs(c1["lat"] - c2["lat"]) < 1e-10
    assert abs(c1["lon"] - c2["lon"]) < 1e-10


def test_map_points_have_coordinates(plugin):
    result = plugin.execute({
        "coordinates": (
            "N 48° 51.502 E 002° 17.669\n"
            "48.85837, 2.294481\n"
            "N 48° 51' 30.120\" E 002° 17' 40.080\""
        ),
    })

    map_points = result["map_points"]
    assert len(map_points) == 4
    for i in range(3):
        point = map_points[i]
        assert point["is_centroid"] is False
        assert point["latitude"] is not None
        assert point["longitude"] is not None
        assert point["formatted"]
    assert map_points[3]["is_centroid"] is True


def test_semicolon_separator(plugin):
    result = plugin.execute({
        "coordinates": "48.85837, 2.294481;48.8566, 2.3522;48.8600, 2.3200",
        "source_format": "dd",
    })

    assert result["status"] == "ok"
    assert len(result["results"]) == 1
    assert len(result["map_points"]) == 4


def test_summary_contains_point_count(plugin):
    result = plugin.execute({
        "coordinates": "48.85837, 2.294481\n48.8566, 2.3522\n48.8600, 2.3200",
        "source_format": "dd",
    })

    assert result["status"] == "ok"
    assert "3 points" in result["summary"]


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
