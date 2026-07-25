"""Plugin clavier Dvorak pour MysterAI.

Le « code Dvorak » repose sur la **position physique des touches**. Un même
emplacement du clavier ne produit pas la même lettre selon la disposition
choisie (QWERTY, AZERTY ou Dvorak). Une phrase saisie sur un clavier configuré
en Dvorak, mais lue comme si elle avait été tapée en QWERTY (ou AZERTY),
apparaît donc brouillée.

Ce plugin convertit un texte d'une disposition vers une autre en conservant la
position des touches : le caractère de la disposition source est remplacé par
celui qui occupe le **même emplacement** dans la disposition cible.

```
Emplacements (grille QWERTY US de référence) :
    q w e r t y u i o p        a s d f g h j k l ;        z x c v b n m , . /
Dvorak :
    ' , . p y f g c r l        a o e u i d h t n s        ; q j k x b m w v z
AZERTY :
    a z e r t y u i o p        q s d f g h j k l m        w x c v b n , ; : !
```

Référence : https://www.cachesleuth.com/tools/dvorak/
"""

from __future__ import annotations

import time
from typing import Any, Dict, Tuple

#: Grille des emplacements de touches (3 rangées de 10), une chaîne par
#: disposition. Les caractères occupant le même index sont sur le même
#: emplacement physique du clavier.
LAYOUTS: Dict[str, str] = {
    "qwerty": "qwertyuiop" "asdfghjkl;" "zxcvbnm,./",
    "dvorak": "',.pyfgcrl" "aoeuidhtns" ";qjkxbmwvz",
    "azerty": "azertyuiop" "qsdfghjklm" "wxcvbn,;:!",
}

#: Libellés lisibles pour les résumés.
LAYOUT_LABELS: Dict[str, str] = {
    "qwerty": "QWERTY",
    "dvorak": "Dvorak",
    "azerty": "AZERTY",
}


def _build_table(from_layout: str, to_layout: str) -> Dict[int, str]:
    """Construit une table de translation ``str.translate`` position par position.

    Les lettres sont mappées en minuscule **et** en majuscule pour préserver la
    casse ; la ponctuation d'un emplacement est mappée telle quelle.
    """
    src = LAYOUTS[from_layout]
    dst = LAYOUTS[to_layout]
    mapping: Dict[int, str] = {}
    for s_char, d_char in zip(src, dst):
        mapping[ord(s_char)] = d_char
        s_upper, d_upper = s_char.upper(), d_char.upper()
        if s_upper != s_char:  # emplacement portant une lettre
            mapping[ord(s_upper)] = d_upper
    return mapping


#: Cache des tables de translation (couple de dispositions -> table).
_TABLE_CACHE: Dict[Tuple[str, str], Dict[int, str]] = {}


def _get_table(from_layout: str, to_layout: str) -> Dict[int, str]:
    key = (from_layout, to_layout)
    table = _TABLE_CACHE.get(key)
    if table is None:
        table = _build_table(from_layout, to_layout)
        _TABLE_CACHE[key] = table
    return table


class DvorakCodePlugin:
    """Plugin de conversion entre dispositions clavier (position physique).

    Args:
        inputs (dict):
            - text (str): Texte à convertir.
            - from_layout (str, optionnel): Disposition source
              (``dvorak`` / ``qwerty`` / ``azerty``, défaut ``dvorak``).
            - to_layout (str, optionnel): Disposition cible
              (``dvorak`` / ``qwerty`` / ``azerty``, défaut ``qwerty``).

    Returns:
        dict: Résultat au format standardisé attendu par le PluginManager.
    """

    def __init__(self) -> None:
        self.name = "dvorak_code"
        self.version = "1.0.0"

    def execute(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        """Point d'entrée principal du plugin."""
        start_time = time.time()

        text = inputs.get("text", "")
        if not isinstance(text, str) or not text:
            return self._error_response("Aucun texte fourni", start_time)

        from_layout = self._resolve_layout(inputs.get("from_layout"), "dvorak")
        to_layout = self._resolve_layout(inputs.get("to_layout"), "qwerty")

        if from_layout is None or to_layout is None:
            return self._error_response(
                "Disposition inconnue (attendu : dvorak, qwerty ou azerty)",
                start_time,
            )

        if from_layout == to_layout:
            return self._error_response(
                "Les dispositions source et cible sont identiques", start_time
            )

        table = _get_table(from_layout, to_layout)
        output = text.translate(table)

        converted = sum(1 for ch in text if ord(ch) in table)

        if converted == 0:
            return self._error_response(
                "Aucune touche mappée entre ces deux dispositions", start_time
            )

        return {
            "status": "ok",
            "summary": (
                f"Conversion {LAYOUT_LABELS[from_layout]} → "
                f"{LAYOUT_LABELS[to_layout]} ({converted} caractère(s))"
            ),
            "results": [
                {
                    "id": "result_1",
                    "text_output": output,
                    "confidence": 0.5,
                    "parameters": {
                        "from_layout": from_layout,
                        "to_layout": to_layout,
                    },
                    "metadata": {
                        "converted_chars": converted,
                        "unchanged_chars": len(text) - converted,
                    },
                }
            ],
            "plugin_info": self._get_plugin_info(start_time),
        }

    @staticmethod
    def _resolve_layout(raw: Any, default: str):
        """Normalise une disposition ; ``None`` si valeur non reconnue."""
        if raw is None or raw == "":
            return default
        value = str(raw).strip().lower()
        return value if value in LAYOUTS else None

    def _get_plugin_info(self, start_time: float) -> Dict[str, Any]:
        execution_time = (time.time() - start_time) * 1000
        return {
            "name": self.name,
            "version": self.version,
            "execution_time_ms": round(execution_time, 2),
        }

    def _error_response(self, message: str, start_time: float) -> Dict[str, Any]:
        return {
            "status": "error",
            "summary": message,
            "results": [],
            "plugin_info": self._get_plugin_info(start_time),
        }


def execute(inputs: Dict[str, Any]) -> Dict[str, Any]:
    return DvorakCodePlugin().execute(inputs)
