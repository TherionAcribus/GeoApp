"""
Tests du cache mémoire de la liste des alphabets (`get_all_alphabets`).

Le cache évite de relire/re-parser tous les alphabet.json à chaque requête tout
en restant correct : une édition d'un fichier (mtime) l'invalide, et la recherche
ne doit jamais polluer les objets partagés du cache.
"""

import json
import os

import pytest
from flask import Flask

from gc_backend.blueprints import alphabets as alphabets_module
from gc_backend.blueprints.alphabets import (
    alphabets_bp,
    get_all_alphabets,
    invalidate_alphabets_cache,
)


def _write_alphabet(base_dir, alphabet_id, name):
    directory = os.path.join(base_dir, alphabet_id)
    os.makedirs(directory, exist_ok=True)
    config = {
        'name': name,
        'description': f'Description {name}',
        'type': 'alphabet',
        'tags': [alphabet_id],
        'alphabetConfig': {
            'type': 'font',
            'fontFile': 'fonts/x.ttf',
            'hasUpperCase': False,
            'characters': {'letters': 'all', 'numbers': []}
        }
    }
    with open(os.path.join(directory, 'alphabet.json'), 'w', encoding='utf-8') as handle:
        json.dump(config, handle)
    return os.path.join(directory, 'alphabet.json')


@pytest.fixture
def app(tmp_path):
    base_dir = tmp_path / 'alphabets'
    base_dir.mkdir()
    _write_alphabet(str(base_dir), 'foo', 'Foo')
    _write_alphabet(str(base_dir), 'bar', 'Bar')

    flask_app = Flask(__name__)
    flask_app.config['TESTING'] = True
    flask_app.config['ALPHABETS_DIR'] = str(base_dir)
    flask_app.register_blueprint(alphabets_bp)

    invalidate_alphabets_cache()
    yield flask_app
    invalidate_alphabets_cache()


def test_second_call_returns_cached_object(app):
    with app.app_context():
        first = get_all_alphabets()
        second = get_all_alphabets()

    # Même objet liste : aucune relecture disque n'a eu lieu.
    assert first is second
    assert {a['id'] for a in first} == {'foo', 'bar'}


def test_cache_invalidated_when_file_changes(app):
    base_dir = app.config['ALPHABETS_DIR']
    with app.app_context():
        first = get_all_alphabets()

        # Modifier le mtime d'un alphabet.json => signature différente.
        config_path = os.path.join(base_dir, 'foo', 'alphabet.json')
        stat = os.stat(config_path)
        os.utime(config_path, (stat.st_atime + 10, stat.st_mtime + 10))

        second = get_all_alphabets()

    assert second is not first


def test_cache_invalidated_when_alphabet_added(app):
    base_dir = app.config['ALPHABETS_DIR']
    with app.app_context():
        first = get_all_alphabets()
        assert len(first) == 2

        _write_alphabet(base_dir, 'baz', 'Baz')
        second = get_all_alphabets()

    assert second is not first
    assert len(second) == 3


def test_explicit_invalidation_forces_rebuild(app):
    with app.app_context():
        first = get_all_alphabets()
        invalidate_alphabets_cache()
        second = get_all_alphabets()

    assert second is not first
    assert {a['id'] for a in second} == {'foo', 'bar'}


def test_search_does_not_pollute_cache(app):
    client = app.test_client()

    # Une recherche ajoute search_score/search_matches sur des copies.
    search_response = client.get('/api/alphabets?search=foo')
    assert search_response.status_code == 200
    assert any('search_score' in item for item in search_response.get_json())

    # La requête liste suivante ne doit pas exposer ces champs.
    list_response = client.get('/api/alphabets')
    assert all('search_score' not in item for item in list_response.get_json())

    # Les objets du cache eux-mêmes restent propres.
    with app.app_context():
        assert all('search_score' not in item for item in get_all_alphabets())
