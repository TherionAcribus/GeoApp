"""
Test de contrat : chaque plugin officiel (plugins/official/*/) doit repondre
au contrat de resultat une fois passe par ``normalize_plugin_result``.

Pour chaque plugin :
- on construit des inputs minimaux depuis ``input_types`` du plugin.json
  (defauts, premiere option des selects, 'text' = 'HELLO WORLD'),
- on charge main.py en isolation (importlib) et on instancie la classe
  ``*Plugin``,
- ``execute(inputs)`` est appele ; un plugin qui leve est traite comme un
  resultat d'erreur brut (on teste le contrat, pas la correction),
- ``normalize_plugin_result`` doit produire le format documente.
"""

import importlib.util
import json
import sys
import threading
from pathlib import Path
from typing import Any, Dict

import pytest

# Rendre gc_backend importable quand pytest tourne depuis backend/
BACKEND_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = BACKEND_DIR.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from gc_backend.plugins.executor import normalize_plugin_result  # noqa: E402


OFFICIAL_DIR = REPO_ROOT / 'plugins' / 'official'

# Plugins exclus : orchestrateurs, reseau, OCR/vision lourds ou dependances
# externes. Ils sont soit trop lents pour un smoke test, soit incapables de
# repondre sans leurs entrees image/URL (et certains telechargent des modeles).
SLOW_OR_EXTERNAL = {
    'metasolver',            # orchestrateur : execute les autres plugins
    'analysis_web_page',     # fetch reseau (needs_network)
    'easyocr_ocr',           # OCR lourd, telecharge des modeles
    'vision_ocr',            # idem
    'vision_describe',       # idem + modele vision
    'qr_code_detector',      # entree image, needs_network
    'exif_reader',           # entree image, needs_network
    'grid_puzzle_solver',    # resolution de grille potentiellement longue
    'spirit_dvd',            # plugin image/fun sans entree texte pertinente
    'wherigo_reverse_decoder',  # attend un fichier binaire, pas du texte
    'planet_barcode',        # entree image barcode
    'postnet_barcode',       # idem
}

PLUGIN_DIRS = (
    sorted(
        d for d in OFFICIAL_DIR.iterdir()
        if d.is_dir()
        and (d / 'plugin.json').exists()
        and (d / 'main.py').exists()
        and d.name not in SLOW_OR_EXTERNAL
    )
    if OFFICIAL_DIR.exists()
    else []
)

# Delai max par plugin : un plugin qui pend ne doit pas bloquer la suite.
PLUGIN_TIMEOUT_S = 30


def _build_inputs(plugin_json: Dict[str, Any]) -> Dict[str, Any]:
    """Construit des inputs minimaux depuis le bloc input_types."""
    input_types = plugin_json.get('input_types') or {}

    mode_field = input_types.get('mode') or {}
    mode_default = mode_field.get('default') or 'decode'

    inputs: Dict[str, Any] = {'text': 'HELLO WORLD', 'mode': mode_default}

    for field_name, field_def in input_types.items():
        if not isinstance(field_def, dict) or field_name in inputs:
            continue
        if 'default' in field_def:
            inputs[field_name] = field_def['default']
        elif field_def.get('type') == 'select':
            options = field_def.get('options') or []
            if options:
                first = options[0]
                inputs[field_name] = (
                    first.get('value') if isinstance(first, dict) else first
                )

    return inputs


def _load_plugin_class(plugin_dir: Path, plugin_name: str):
    """Charge main.py en isolation et retourne la classe *Plugin, ou None."""
    module_name = f'contract_test_{plugin_name}'
    spec = importlib.util.spec_from_file_location(
        module_name, plugin_dir / 'main.py'
    )
    if spec is None or spec.loader is None:
        return None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)

    for attr_name in dir(module):
        if not attr_name.endswith('Plugin'):
            continue
        cls = getattr(module, attr_name)
        if isinstance(cls, type):
            return cls
    return None


def _execute_with_timeout(instance: Any, inputs: Dict[str, Any]) -> Any:
    """Execute le plugin dans un thread daemon borne par PLUGIN_TIMEOUT_S.

    Retourne le resultat brut, ou leve TimeoutError / l'exception du plugin.
    """
    holder: Dict[str, Any] = {}

    def _run():
        try:
            holder['result'] = instance.execute(inputs)
        except Exception as exc:  # noqa: BLE001
            holder['error'] = exc

    thread = threading.Thread(target=_run, daemon=True)
    thread.start()
    thread.join(PLUGIN_TIMEOUT_S)
    if thread.is_alive():
        raise TimeoutError(
            f'Le plugin n a pas repondu en {PLUGIN_TIMEOUT_S}s'
        )
    if 'error' in holder:
        raise holder['error']
    return holder.get('result')


@pytest.mark.parametrize(
    'plugin_dir',
    PLUGIN_DIRS,
    ids=[d.name for d in PLUGIN_DIRS],
)
def test_plugin_result_contract(plugin_dir: Path):
    """Le resultat normalise de chaque plugin respecte le contrat."""
    plugin_json = json.loads(
        (plugin_dir / 'plugin.json').read_text(encoding='utf-8')
    )
    plugin_name = plugin_json.get('name', plugin_dir.name)
    plugin_version = plugin_json.get('version', '1.0.0')
    inputs = _build_inputs(plugin_json)

    try:
        plugin_cls = _load_plugin_class(plugin_dir, plugin_name)
    except Exception as exc:
        pytest.skip(f'import de main.py impossible: {exc}')
    if plugin_cls is None:
        pytest.skip('aucune classe *Plugin trouvee dans main.py')

    try:
        instance = plugin_cls()
        raw = _execute_with_timeout(instance, inputs)
    except TimeoutError as exc:
        pytest.skip(f'execute() trop lent: {exc}')
    except Exception as exc:
        # Un plugin qui leve est traite comme un resultat d'erreur brut :
        # on teste la normalisation, pas la correction du plugin.
        raw = {'status': 'error', 'summary': str(exc), 'results': []}

    # Le statut brut doit etre une valeur connue du contrat (legacy inclus)
    if isinstance(raw, dict):
        raw_status = raw.get('status')
        assert raw_status in ('ok', 'error', 'success', None), (
            f'{plugin_name}: statut inconnu {raw_status!r}'
        )

    result = normalize_plugin_result(
        raw, name=plugin_name, version=plugin_version
    )

    # Contrat documente
    assert result['status'] in ('ok', 'error')
    assert isinstance(result['summary'], str)
    assert isinstance(result['results'], list)
    for item in result['results']:
        assert isinstance(item, dict)
        assert 'id' in item
        assert 'confidence' in item
    plugin_info = result.get('plugin_info')
    assert isinstance(plugin_info, dict)
    assert plugin_info.get('name')
    assert plugin_info.get('version')
    if result['status'] == 'error':
        assert isinstance(result.get('error'), dict)
