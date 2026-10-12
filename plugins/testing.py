"""Helpers partages pour les tests des plugins.

Centralise le chargement des ``main.py`` (et modules freres) des plugins
dans des namespaces de module uniques. C'est indispensable : chaque
repertoire de plugin contient un ``main.py``, donc un simple
``sys.path.insert`` + ``from main import XPlugin`` ferait gagner le
premier test collecte dans ``sys.modules['main']`` et les tests
suivants importeraient le MAUVAIS plugin.

Usage typique dans un fichier de test :

    from plugins.testing import load_plugin_class

    CaesarPlugin = load_plugin_class(__file__)

ou, quand le test a besoin du module complet (constantes, helpers) :

    from plugins.testing import load_plugin_module

    MODULE = load_plugin_module(__file__)
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from types import ModuleType
from typing import Optional, Union

PathLike = Union[str, Path]


def _plugin_dir(ref: PathLike) -> Path:
    """Normalise ``ref`` en dossier de plugin.

    ``ref`` peut pointer vers le dossier du plugin ou vers un fichier
    voisin (typiquement ``__file__`` d'un test) : dans ce cas le dossier
    parent est utilise.
    """
    path = Path(ref).resolve()
    return path.parent if path.is_file() else path


def load_plugin_module(ref: PathLike, entry_point: str = "main.py") -> ModuleType:
    """Importe le module d'un plugin dans un namespace unique.

    ``ref`` : chemin vers le dossier du plugin OU vers le fichier de test
    voisin (``__file__``) — le dossier parent est alors utilise.

    Le module est enregistre dans ``sys.modules`` sous un nom unique
    ``geoapp_test_{dirname}`` (suffixe par le nom du fichier pour les
    modules freres, ex. ``geoapp_test_wherigo_analyzer_lua_analyzer``).
    Cet enregistrement est necessaire pour ``exec_module`` et pour les
    eventuels imports relatifs du plugin ; il sert aussi de cache : un
    meme module n'est execute qu'une fois par session de test.

    Le dossier du plugin est ajoute a la fin de ``sys.path`` (idempotent)
    pour permettre au plugin d'importer ses modules freres.

    Retourne le module charge.
    """
    plugin_dir = _plugin_dir(ref)
    entry_path = plugin_dir / entry_point
    if not entry_path.is_file():
        raise FileNotFoundError(f"Point d'entree introuvable : {entry_path}")

    stem = Path(entry_point).stem
    if stem == "main":
        module_name = f"geoapp_test_{plugin_dir.name}"
    else:
        module_name = f"geoapp_test_{plugin_dir.name}_{stem}"

    # Cache : un module deja charge pour ce point d'entree est reutilise.
    existing = sys.modules.get(module_name)
    if isinstance(existing, ModuleType):
        return existing

    # Permet au plugin d'importer ses modules freres (ex. wherigo_analyzer
    # fait ``from models import ...`` en repli de l'import relatif).
    # Ajoute en fin de sys.path pour minimiser tout ombrage de noms.
    dir_str = str(plugin_dir)
    if dir_str not in sys.path:
        sys.path.append(dir_str)

    spec = importlib.util.spec_from_file_location(module_name, entry_path)
    if spec is None or spec.loader is None:
        raise ImportError(f"Impossible de charger le module : {entry_path}")

    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def find_plugin_class(module: ModuleType) -> type:
    """Renvoie la premiere classe du module dont le nom finit par 'Plugin'.

    Prefere les classes DEFINIES dans le module (``cls.__module__`` egal
    au nom du module) pour ne pas attraper une classe de base importee
    (ex. ``from base import CipherPlugin``) ; replie sur une classe
    re-exportee si aucune n'est definie localement — meme logique que
    ``PythonPluginWrapper._find_plugin_class``.

    Leve ``LookupError`` si aucune classe '*Plugin' n'est trouvee.
    """
    module_name = getattr(module, "__name__", None)
    fallback: Optional[type] = None

    for attr_name in dir(module):
        if not attr_name.endswith("Plugin"):
            continue
        cls = getattr(module, attr_name)
        if not isinstance(cls, type):
            continue
        if getattr(cls, "__module__", None) == module_name:
            return cls
        if fallback is None:
            fallback = cls

    if fallback is not None:
        return fallback
    raise LookupError(
        f"Aucune classe '*Plugin' trouvee dans le module {module_name!r}"
    )


def load_plugin_class(ref: PathLike, entry_point: str = "main.py") -> type:
    """``load_plugin_module`` + ``find_plugin_class``.

    Usage type dans un test : ``CaesarPlugin = load_plugin_class(__file__)``.
    """
    return find_plugin_class(load_plugin_module(ref, entry_point))
