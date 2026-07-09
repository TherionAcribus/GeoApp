"""
Tests du cache HTTP des ressources d'alphabets (images, polices).

Les assets étant quasi immuables, `send_alphabet_file` doit émettre un
`Cache-Control: max-age=…` tout en conservant la validation conditionnelle
(ETag → 304).
"""

import os

import pytest
from flask import Flask

from gc_backend.blueprints.alphabets import (
    alphabets_bp,
    load_alphabet_config,
    _DEFAULT_ALPHABETS_DIR,
)


@pytest.fixture
def client():
    app = Flask(__name__)
    app.config['TESTING'] = True
    app.config['ALPHABETS_DIR'] = _DEFAULT_ALPHABETS_DIR
    app.register_blueprint(alphabets_bp)
    with app.test_client() as test_client:
        yield test_client


def _first_image_resource_path():
    config = load_alphabet_config('drapeaux_maritimes')
    image_dir = config['alphabetConfig']['imageDir']
    image_file = config['alphabetConfig']['imageFiles'][0]
    return 'drapeaux_maritimes', f'{image_dir}/{image_file}'


def test_image_resource_has_long_cache(client):
    alphabet_id, resource_path = _first_image_resource_path()

    response = client.get(f'/api/alphabets/{alphabet_id}/resource/{resource_path}')

    assert response.status_code == 200
    assert response.cache_control.max_age == 60 * 60 * 24
    assert response.headers['Access-Control-Allow-Origin'] == '*'


def test_image_resource_supports_conditional_304(client):
    alphabet_id, resource_path = _first_image_resource_path()

    first = client.get(f'/api/alphabets/{alphabet_id}/resource/{resource_path}')
    etag = first.headers.get('ETag')
    assert etag

    second = client.get(
        f'/api/alphabets/{alphabet_id}/resource/{resource_path}',
        headers={'If-None-Match': etag}
    )
    assert second.status_code == 304


def test_font_resource_has_long_cache(client):
    response = client.get('/api/alphabets/pigpen/font')

    assert response.status_code == 200
    assert response.cache_control.max_age == 60 * 60 * 24
    assert response.mimetype == 'font/ttf'


def test_asset_max_age_is_configurable():
    app = Flask(__name__)
    app.config['TESTING'] = True
    app.config['ALPHABETS_DIR'] = _DEFAULT_ALPHABETS_DIR
    app.config['ALPHABET_ASSET_MAX_AGE'] = 42
    app.register_blueprint(alphabets_bp)

    with app.test_client() as test_client:
        response = test_client.get('/api/alphabets/pigpen/font')

    assert response.cache_control.max_age == 42
