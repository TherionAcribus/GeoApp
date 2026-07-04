"""Tests de l'endpoint batch de détection de coordonnées (Lot 3.1).

POST /api/detect_coordinates_batch : détecte des coordonnées dans un lot de textes
en une seule requête, avec déduplication et alignement d'index.
"""

import sys
from pathlib import Path

import pytest
from flask import Flask

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from gc_backend.blueprints.coordinates import coordinates_bp  # noqa: E402


@pytest.fixture
def client():
    app = Flask(__name__)
    app.register_blueprint(coordinates_bp)
    app.config["TESTING"] = True
    return app.test_client()


def _post(client, payload):
    return client.post("/api/detect_coordinates_batch", json=payload)


# ─────────────────────────────────────────────────────────────────────────────
# Validation
# ─────────────────────────────────────────────────────────────────────────────

def test_missing_texts_returns_400(client):
    resp = _post(client, {"include_numeric_only": False})
    assert resp.status_code == 400


def test_texts_not_a_list_returns_400(client):
    resp = _post(client, {"texts": "pas une liste"})
    assert resp.status_code == 400


def test_too_many_texts_returns_400(client):
    resp = _post(client, {"texts": ["x"] * 1001})
    assert resp.status_code == 400


# ─────────────────────────────────────────────────────────────────────────────
# Détection et alignement
# ─────────────────────────────────────────────────────────────────────────────

def test_results_aligned_with_input_order(client):
    texts = [
        "rien ici",
        "N 48° 33.787' E 006° 38.803'",
        "toujours rien",
    ]
    resp = _post(client, {"texts": texts})
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["count"] == 3
    assert len(data["results"]) == 3
    assert data["results"][0]["exist"] is False
    assert data["results"][1]["exist"] is True
    assert data["results"][2]["exist"] is False
    assert data["results"][1]["ddm_lat"].startswith("N")


def test_empty_list_returns_empty_results(client):
    resp = _post(client, {"texts": []})
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["results"] == []
    assert data["count"] == 0


def test_deduplicates_identical_texts(client):
    coord = "N 48° 33.787' E 006° 38.803'"
    texts = [coord, coord, coord]
    resp = _post(client, {"texts": texts})
    data = resp.get_json()
    assert data["count"] == 3          # une entrée par texte d'entrée
    assert data["unique_count"] == 1   # mais une seule détection réelle
    assert all(r["exist"] for r in data["results"])


def test_origin_string_inherits_south_west(client):
    # Numérique pur + origine S/W en chaîne combinée -> héritage des directions
    resp = _post(client, {
        "texts": ["4912123 00612123"],
        "include_numeric_only": True,
        "origin_coords": "S 33° 51.123 W 151° 12.456",
    })
    data = resp.get_json()
    r = data["results"][0]
    assert r["exist"] is True
    assert r["ddm_lat"].startswith("S")
    assert r["ddm_lon"].startswith("W")


def test_written_truncated_flag_present(client):
    # Sans include_written, le drapeau doit être False et aucune tentative écrite
    resp = _post(client, {"texts": ["abc", "def"]})
    data = resp.get_json()
    assert data["written_truncated"] is False
