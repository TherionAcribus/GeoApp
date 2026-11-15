"""Installation, création et suppression de plugins custom.

Routes :
- ``POST /api/plugins/install``  : installe un plugin depuis une archive .zip
- ``POST /api/plugins/scaffold`` : crée un squelette de plugin (assistant "nouveau plugin")
- ``DELETE /api/plugins/<name>`` : supprime un plugin custom (dossier + ligne en base)
"""

import io
import json
import re
import shutil
import zipfile
from pathlib import Path
from typing import Optional, Tuple

from flask import jsonify, request, current_app
from loguru import logger

from ...database import db
from ...plugins.models import Plugin
from ...services.metasolver_analysis import invalidate_metasolver_caches

from ._common import bp, get_plugin_manager

# Limites de sécurité pour l'upload d'archive
MAX_ZIP_SIZE_BYTES = 20 * 1024 * 1024        # 20 Mo compressés
MAX_UNCOMPRESSED_BYTES = 100 * 1024 * 1024   # 100 Mo décompressés (anti zip-bomb)
MAX_ZIP_FILES = 500

# Extensions bloquées dans une archive (le code Python est autorisé, c'est le
# principe du plugin ; on bloque seulement les exécutables autonomes).
BLOCKED_EXTENSIONS = {'.exe', '.dll', '.so', '.dylib', '.bat', '.cmd', '.ps1', '.vbs', '.scr', '.msi'}

PLUGIN_NAME_RE = re.compile(r'^[a-z0-9_]{2,64}$')


def _custom_plugins_dir() -> Path:
    return get_plugin_manager().plugins_dir / 'custom'


def _validate_member_name(member: str) -> Optional[str]:
    """Retourne un message d'erreur si le nom de membre zip est dangereux."""
    normalized = member.replace('\\', '/')
    if normalized.startswith('/') or re.match(r'^[a-zA-Z]:/', normalized):
        return f"Chemin absolu interdit dans l'archive: {member}"
    if '..' in normalized.split('/'):
        return f"Traversal interdit dans l'archive: {member}"
    return None


def _find_plugin_root(zf: zipfile.ZipFile) -> Tuple[Optional[str], Optional[str]]:
    """Localise le plugin.json dans l'archive.

    Retourne (prefix, erreur). ``prefix=''`` si le plugin est à la racine du zip,
    sinon ``prefix='dossier/'``. Accepte la racine ou un sous-dossier unique.
    """
    candidates = [
        n for n in zf.namelist()
        if n.replace('\\', '/').rstrip('/').endswith('plugin.json')
        and not n.endswith('/')
        and n.replace('\\', '/').count('/') <= 1
    ]
    root_level = [n for n in candidates if '/' not in n.replace('\\', '/')]
    if root_level:
        return '', None
    if len(candidates) == 1:
        return candidates[0].replace('\\', '/').rsplit('/', 1)[0] + '/', None
    if not candidates:
        return None, "Aucun plugin.json trouvé dans l'archive (racine ou sous-dossier unique attendu)"
    return None, f"Plusieurs plugin.json dans l'archive: {candidates}"


def _check_members(zf: zipfile.ZipFile, prefix: str) -> Tuple[Optional[list], Optional[str]]:
    """Vérifie les membres de l'archive appartenant au plugin.

    Retourne (membres_valides, erreur).
    """
    members = []
    total_size = 0
    for info in zf.infolist():
        name = info.filename.replace('\\', '/')
        if not name.startswith(prefix):
            continue
        if info.is_dir():
            continue
        err = _validate_member_name(name)
        if err:
            return None, err
        ext = Path(name).suffix.lower()
        if ext in BLOCKED_EXTENSIONS:
            return None, f"Fichier exécutable interdit dans l'archive: {name}"
        total_size += info.file_size
        if total_size > MAX_UNCOMPRESSED_BYTES:
            return None, f"Archive trop volumineuse décompressée (>{MAX_UNCOMPRESSED_BYTES // 1024 // 1024} Mo)"
        members.append(info)
    if len(members) > MAX_ZIP_FILES:
        return None, f"Trop de fichiers dans l'archive (>{MAX_ZIP_FILES})"
    return members, None


def _extract_plugin(zf: zipfile.ZipFile, members: list, prefix: str, target: Path) -> None:
    """Extrait les membres (en retirant ``prefix``) dans ``target``."""
    for info in members:
        rel = info.filename.replace('\\', '/')[len(prefix):]
        dest = target / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        with zf.open(info) as src, open(dest, 'wb') as dst:
            shutil.copyfileobj(src, dst)


def _rediscover_and_report(plugin_name: str):
    """Relance la découverte et renvoie la réponse pour le plugin installé."""
    plugin_manager = get_plugin_manager()
    plugin_manager.discover_plugins()
    invalidate_metasolver_caches()

    # Les erreurs de découverte sont indexées par chemin de dossier : ne
    # retenir que celles du dossier custom installé (un éventuel doublon
    # officiel masqué produit aussi une erreur, non bloquante ici).
    custom_dir = _custom_plugins_dir() / plugin_name
    plugin_errors = {
        path: msg for path, msg in plugin_manager.get_discovery_errors().items()
        if Path(str(path)).resolve() == custom_dir.resolve()
    }
    if plugin_errors:
        return jsonify({
            "error": f"Plugin installé mais non reconnu: {next(iter(plugin_errors.values()))}",
            "plugin_name": plugin_name,
        }), 422
    record = Plugin.query.filter_by(name=plugin_name).first()
    return jsonify({
        "message": f"Plugin '{plugin_name}' installé avec succès",
        "plugin_name": plugin_name,
        "version": record.version if record else None,
        "source": "custom",
    }), 201


@bp.route('/install', methods=['POST'])
def install_plugin():
    """
    Installe un plugin custom depuis une archive .zip (champ ``file``).

    L'archive doit contenir un plugin.json (à la racine ou dans un sous-dossier
    unique). Le plugin est extrait dans ``plugins/custom/<name>/`` puis la
    découverte est relancée.
    """
    plugin_manager = get_plugin_manager()
    if plugin_manager is None:
        return jsonify({"error": "Plugin manager non initialisé"}), 500

    uploaded = request.files.get('file')
    if uploaded is None or not uploaded.filename:
        return jsonify({"error": "Aucun fichier fourni (champ 'file' attendu)"}), 400
    if not uploaded.filename.lower().endswith('.zip'):
        return jsonify({"error": "Seules les archives .zip sont acceptées"}), 400

    data = uploaded.read(MAX_ZIP_SIZE_BYTES + 1)
    if len(data) > MAX_ZIP_SIZE_BYTES:
        return jsonify({"error": f"Archive trop volumineuse (>{MAX_ZIP_SIZE_BYTES // 1024 // 1024} Mo)"}), 413

    try:
        zf = zipfile.ZipFile(io.BytesIO(data))
        if zf.testzip() is not None:
            return jsonify({"error": "Archive corrompue"}), 400
    except zipfile.BadZipFile:
        return jsonify({"error": "Fichier .zip invalide"}), 400

    prefix, err = _find_plugin_root(zf)
    if err:
        return jsonify({"error": err}), 400

    members, err = _check_members(zf, prefix)
    if err:
        return jsonify({"error": err}), 400

    try:
        plugin_data = json.loads(zf.read(prefix + 'plugin.json').decode('utf-8'))
    except Exception as e:
        return jsonify({"error": f"plugin.json illisible: {e}"}), 400

    validation_error = plugin_manager._schema_validation_error(plugin_data)
    if validation_error:
        return jsonify({"error": f"plugin.json invalide: {validation_error}"}), 422

    plugin_name = plugin_data['name']
    target_dir = _custom_plugins_dir() / plugin_name
    if target_dir.exists():
        return jsonify({
            "error": f"Un plugin custom '{plugin_name}' existe déjà — supprimez-le d'abord",
        }), 409

    shadowed = Plugin.query.filter_by(name=plugin_name).first() is not None

    try:
        _extract_plugin(zf, members, prefix, target_dir)
    except Exception as e:
        logger.opt(exception=e).error(f"Échec extraction plugin {plugin_name}: {e}")
        shutil.rmtree(target_dir, ignore_errors=True)
        return jsonify({"error": f"Échec de l'extraction: {e}"}), 500

    logger.info(f"Plugin custom '{plugin_name}' installé dans {target_dir}")

    response, status = _rediscover_and_report(plugin_name)
    if status == 201 and shadowed:
        payload = response.get_json()
        payload['warning'] = f"Un plugin officiel '{plugin_name}' existe : la version custom le masquera"
        return jsonify(payload), 201
    return response, status


@bp.route('/scaffold', methods=['POST'])
def scaffold_plugin():
    """
    Crée un squelette de plugin custom (assistant "nouveau plugin").

    Body JSON: ``{"name": "...", "description"?: "...", "author"?: "...",
    "kinds"?: ["code"], "categories"?: ["..."]}``
    """
    plugin_manager = get_plugin_manager()
    if plugin_manager is None:
        return jsonify({"error": "Plugin manager non initialisé"}), 500

    data = request.get_json(silent=True) or {}
    name = str(data.get('name') or '').strip()
    if not PLUGIN_NAME_RE.match(name):
        return jsonify({
            "error": "Nom invalide: snake_case attendu (minuscules, chiffres, underscores, 2-64 caractères)"
        }), 400

    target_dir = _custom_plugins_dir() / name
    if target_dir.exists() or Plugin.query.filter_by(name=name).first() is not None:
        return jsonify({"error": f"Un plugin '{name}' existe déjà"}), 409

    description = str(data.get('description') or f"Plugin custom {name}").strip()
    author = str(data.get('author') or '').strip()
    kinds = data.get('kinds') or ['code']
    if not isinstance(kinds, list) or not all(isinstance(k, str) for k in kinds):
        return jsonify({"error": "'kinds' doit être une liste de chaînes"}), 400
    categories = data.get('categories')
    if categories is not None and not isinstance(categories, list):
        return jsonify({"error": "'categories' doit être une liste de chaînes"}), 400

    class_name = ''.join(part.capitalize() for part in name.split('_')) + 'Plugin'

    plugin_json = {
        "name": name,
        "version": "1.0.0",
        "plugin_api_version": "2.0",
        "description": description,
        "author": author,
        "plugin_type": "python",
        "entry_point": "main.py",
        "dependencies": [],
        "categories": categories or ["Custom"],
        "kinds": kinds,
        "brute_force": False,
        "enable_scoring": False,
        "heavy_cpu": False,
        "needs_network": False,
        "needs_filesystem": False,
        "timeout_seconds": 30,
        "capabilities": {"analyze": True, "decode": True, "encode": False},
        "defaults": {"include_in_analysis": True, "include_in_decode": True},
        "input_types": {
            "text": {
                "type": "string",
                "label": "Texte à traiter",
                "placeholder": "Entrez le texte...",
                "required": True,
            }
        },
        "output_types": {
            "result": {"type": "string", "label": "Résultat"}
        },
    }

    main_py = f'''"""
Plugin {name} — squelette généré automatiquement.

Éditez ce fichier pour implémenter la logique du plugin. La classe doit se
nommer {class_name} (convention: nom du plugin en CamelCase + "Plugin").
"""

import time
from typing import Dict, Any

try:
    from gc_backend.plugins.base import CipherPluginBase
except ImportError:
    import sys as _sys, pathlib as _pathlib
    _sys.path.insert(0, str(_pathlib.Path(__file__).resolve().parents[3] / "backend"))
    from gc_backend.plugins.base import CipherPluginBase


class {class_name}(CipherPluginBase):
    """Implémentation du plugin {name}."""

    def __init__(self):
        super().__init__()
        self.name = "{name}"
        self.version = "1.0.0"

    def execute(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        """Point d'entrée principal du plugin."""
        start_time = time.time()

        text = inputs.get('text', '')
        if not text:
            return self._error_response("Aucun texte fourni", start_time=start_time)

        # TODO: implémenter la logique du plugin
        result_text = text

        return self._ok_response(
            results=[self._make_result(text_output=result_text)],
            start_time=start_time,
        )
'''

    try:
        target_dir.mkdir(parents=True)
        (target_dir / 'plugin.json').write_text(
            json.dumps(plugin_json, indent=2, ensure_ascii=False), encoding='utf-8'
        )
        (target_dir / 'main.py').write_text(main_py, encoding='utf-8')
    except Exception as e:
        logger.opt(exception=e).error(f"Échec création squelette {name}: {e}")
        shutil.rmtree(target_dir, ignore_errors=True)
        return jsonify({"error": f"Échec de la création: {e}"}), 500

    logger.info(f"Squelette de plugin '{name}' créé dans {target_dir}")

    return _rediscover_and_report(name)


@bp.route('/<plugin_name>', methods=['DELETE'])
def uninstall_plugin(plugin_name: str):
    """
    Supprime un plugin custom : décharge, efface le dossier et la ligne en base.

    Seuls les plugins ``source == 'custom'`` peuvent être supprimés.
    """
    plugin_manager = get_plugin_manager()
    if plugin_manager is None:
        return jsonify({"error": "Plugin manager non initialisé"}), 500

    record = Plugin.query.filter_by(name=plugin_name).first()
    plugin_dir = _custom_plugins_dir() / plugin_name

    if record is None and not plugin_dir.exists():
        return jsonify({"error": f"Plugin '{plugin_name}' introuvable"}), 404
    if record is not None and record.source != 'custom':
        return jsonify({"error": "Seuls les plugins custom peuvent être supprimés"}), 403

    plugin_manager.unload_plugin(plugin_name)

    try:
        if plugin_dir.exists():
            shutil.rmtree(plugin_dir)
    except Exception as e:
        logger.opt(exception=e).error(f"Échec suppression dossier {plugin_dir}: {e}")
        return jsonify({"error": f"Échec de la suppression du dossier: {e}"}), 500

    if record is not None:
        db.session.delete(record)
        db.session.commit()

    # Resynchroniser (un éventuel officiel masqué réapparaît)
    plugin_manager.discover_plugins()
    invalidate_metasolver_caches()

    logger.info(f"Plugin custom '{plugin_name}' supprimé")

    return jsonify({"message": f"Plugin '{plugin_name}' supprimé", "plugin_name": plugin_name})
