"""Configuration pytest pour les tests des plugins.

Ce conftest est charge automatiquement des que pytest collecte le
repertoire ``plugins/``. Il prepare ``sys.path`` AVANT l'import des
modules de test afin que deux racines soient importables :

- ``<depot>/backend`` : pour les imports ``gc_backend.*`` utilises par
  de nombreux ``main.py`` de plugins ;
- ``<depot>`` (racine) : pour les imports ``plugins.*`` (notamment
  ``plugins.testing``, le chargeur partage des tests).

Les insertions sont idempotentes : ce conftest peut etre recharge ou
combine avec d'autres configurations sans effet de bord.
"""

import sys
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parent.parent
_BACKEND_DIR = _REPO_ROOT / "backend"

for _path in (_BACKEND_DIR, _REPO_ROOT):
    if str(_path) not in sys.path:
        sys.path.insert(0, str(_path))
