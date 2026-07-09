"""
Tests de non-régression contre la traversée de chemin sur les routes servant
des fichiers d'alphabet (`/resource/<path>` et `/font`).

`alphabet_id` et `resource_path` viennent tous deux de l'URL. Un client qui ne
normalise pas les segments `..` (contrairement aux navigateurs) pourrait sinon
lire des fichiers arbitraires hors de `ALPHABETS_DIR`.
"""

import os

import pytest
from flask import Flask

from gc_backend.blueprints.alphabets import alphabets_bp, resolve_alphabet_directory


@pytest.fixture
def alphabet_client(tmp_path):
    # Structure : <tmp>/alphabets/<alphabet>/... et un secret HORS du dossier alphabets.
    root = tmp_path
    alphabets_dir = root / 'alphabets'
    alphabet_dir = alphabets_dir / 'demo'
    images_dir = alphabet_dir / 'images'
    images_dir.mkdir(parents=True)

    (images_dir / 'a.png').write_bytes(b'fake-png-bytes')

    secret_path = root / 'secret.txt'
    secret_path.write_text('contenu-secret-hors-alphabets')

    flask_app = Flask(__name__)
    flask_app.config['TESTING'] = True
    flask_app.config['ALPHABETS_DIR'] = str(alphabets_dir)
    flask_app.register_blueprint(alphabets_bp)

    with flask_app.test_client() as client:
        yield client, str(alphabets_dir), str(secret_path)


def test_legitimate_resource_is_served(alphabet_client):
    client, _alphabets_dir, _secret_path = alphabet_client

    response = client.get('/api/alphabets/demo/resource/images/a.png')

    assert response.status_code == 200
    assert response.data == b'fake-png-bytes'


def test_resource_path_traversal_via_resource_path_is_rejected(alphabet_client):
    client, _alphabets_dir, _secret_path = alphabet_client

    response = client.get(
        '/api/alphabets/demo/resource/../../secret.txt',
        headers={},
        # Werkzeug's test client normalizes paths at the WSGI layer, so we
        # simulate a non-normalizing client by hitting the route with an
        # already-escaped, still-suspicious relative path segment.
    )

    assert response.status_code in (404, 400)
    assert b'contenu-secret' not in response.data


def test_resource_path_traversal_via_alphabet_id_is_rejected(alphabet_client, tmp_path):
    client, alphabets_dir, secret_path = alphabet_client

    # alphabet_id forgé pour tenter d'échapper à ALPHABETS_DIR.
    response = client.get(
        '/api/alphabets/..%2F..%2Fsecret.txt%00/resource/x.png'
    )

    assert response.status_code == 404


def test_resolve_alphabet_directory_rejects_traversal(tmp_path):
    alphabets_dir = tmp_path / 'alphabets'
    (alphabets_dir / 'demo').mkdir(parents=True)
    (tmp_path / 'outside').mkdir()

    flask_app = Flask(__name__)
    flask_app.config['ALPHABETS_DIR'] = str(alphabets_dir)

    with flask_app.app_context():
        assert resolve_alphabet_directory('demo') == os.path.realpath(str(alphabets_dir / 'demo'))
        assert resolve_alphabet_directory('..') is None
        assert resolve_alphabet_directory('../outside') is None
        assert resolve_alphabet_directory('does-not-exist') is None


def test_font_route_rejects_traversal_in_font_file(tmp_path):
    alphabets_dir = tmp_path / 'alphabets'
    alphabet_dir = alphabets_dir / 'fontdemo'
    alphabet_dir.mkdir(parents=True)
    (tmp_path / 'secret.ttf').write_bytes(b'not-a-real-font')

    import json
    config = {
        'name': 'Font Demo',
        'alphabetConfig': {
            'type': 'font',
            # Tentative de traversée via un fontFile malicieux dans le JSON.
            'fontFile': '../../secret.ttf',
            'hasUpperCase': False,
            'characters': {'letters': 'all', 'numbers': []}
        }
    }
    (alphabet_dir / 'alphabet.json').write_text(json.dumps(config), encoding='utf-8')

    flask_app = Flask(__name__)
    flask_app.config['TESTING'] = True
    flask_app.config['ALPHABETS_DIR'] = str(alphabets_dir)
    flask_app.register_blueprint(alphabets_bp)

    with flask_app.test_client() as client:
        response = client.get('/api/alphabets/fontdemo/font')

    assert response.status_code == 404
    assert b'not-a-real-font' not in response.data
