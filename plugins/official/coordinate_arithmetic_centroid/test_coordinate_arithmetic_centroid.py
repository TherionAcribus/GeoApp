"""Tests for coordinate_arithmetic_centroid plugin."""

import sys
import pathlib

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[3] / "backend"))

import pytest

from plugins.official.coordinate_arithmetic_centroid.main import CoordinateArithmeticCentroidPlugin


@pytest.fixture
def plugin():
    return CoordinateArithmeticCentroidPlugin()


def test_basic_arithmetic_centroid_3_points(plugin):
    result = plugin.execute({
        "coordinates": "48.20, 6.20\n48.24, 6.20\n48.28, 6.20",
        "source_format": "dd",
    })

    assert result["status"] == "ok"
    assert len(result["results"]) == 1
    centroid = result["results"][0]
    assert centroid["metadata"]["is_centroid"] is True
    assert centroid["metadata"]["input_point_count"] == 3
    lat = centroid["decimal_latitude"]
    lon = centroid["decimal_longitude"]
    assert abs(lat - 48.24) < 1e-6
    assert abs(lon - 6.20) < 1e-6


def test_arithmetic_mean_is_simple_average(plugin):
    result = plugin.execute({
        "coordinates": "10.0, 20.0\n20.0, 30.0\n30.0, 40.0",
        "source_format": "dd",
    })

    assert result["status"] == "ok"
    centroid = result["results"][0]
    assert abs(centroid["decimal_latitude"] - 20.0) < 1e-6
    assert abs(centroid["decimal_longitude"] - 30.0) < 1e-6


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
    assert len(result["map_points"]) == 6
    assert result["results"][0]["metadata"]["input_point_count"] == 5


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
    text = result["results"][0]["text_output"]
    assert "DD:" in text
    assert "DDM:" in text
    assert "DMS:" in text


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


def test_antimeridian_wrapping(plugin):
    result = plugin.execute({
        "coordinates": "N 01° 00.000 E 179° 30.000\nN 01° 00.000 W 179° 30.000",
        "source_format": "auto",
    })

    assert result["status"] == "ok"
    centroid = result["results"][0]
    lon = centroid["decimal_longitude"]
    assert abs(lon - 180.0) < 1e-6 or abs(lon + 180.0) < 1e-6


def test_spherical_centroid_in_metadata(plugin):
    result = plugin.execute({
        "coordinates": "48.20, 6.20\n48.24, 6.20\n48.28, 6.20",
        "source_format": "dd",
    })

    assert result["status"] == "ok"
    metadata = result["results"][0]["metadata"]
    assert "spherical_centroid" in metadata
    assert "lat" in metadata["spherical_centroid"]
    assert "lon" in metadata["spherical_centroid"]


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
