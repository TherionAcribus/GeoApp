"""
Tests de l'injection du manifeste d'images (`alphabetConfig.imageFiles`).

Ce manifeste permet au frontend de résoudre le fichier d'un caractère sans
tester chaque URL candidate via des requêtes réseau.
"""

from gc_backend.blueprints.alphabets import (
    attach_image_files,
    list_alphabet_image_files,
    load_alphabet_config,
)


def test_images_alphabet_config_exposes_image_files():
    config = load_alphabet_config('drapeaux_maritimes')

    assert config is not None
    image_files = config['alphabetConfig'].get('imageFiles')
    assert isinstance(image_files, list)
    assert len(image_files) > 0
    # Le manifeste ne doit contenir que des noms de fichiers (pas de chemins).
    assert all('/' not in name for name in image_files)


def test_font_alphabet_has_no_image_files():
    config = load_alphabet_config('pigpen')  # type: font

    assert config is not None
    assert 'imageFiles' not in config['alphabetConfig']


def test_attach_image_files_is_noop_without_image_dir():
    config = {
        'id': 'whatever',
        'alphabetConfig': {'type': 'images', 'characters': {'letters': 'all', 'numbers': []}}
    }
    result = attach_image_files(config)
    assert 'imageFiles' not in result['alphabetConfig']


def test_list_alphabet_image_files_returns_empty_tuple_for_missing_dir():
    assert list_alphabet_image_files('__does_not_exist__', 'images') == ()
