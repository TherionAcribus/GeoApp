"""Tests unitaires pour le plugin dvorak_code.

Ces tests valident :
- La correspondance positionnelle entre dispositions (Dvorak / QWERTY / AZERTY)
- Le caractère bijectif de la conversion (aller-retour)
- La préservation de la casse et des caractères non mappés
- La gestion des erreurs (texte vide, dispositions identiques/inconnues)
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from typing import Any, Dict


def _load_plugin_class():
    plugin_path = Path(__file__).resolve().parent / "main.py"
    spec = importlib.util.spec_from_file_location("dvorak_code_main", plugin_path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return getattr(module, "DvorakCodePlugin")


def test_dvorak_to_qwerty_reference() -> None:
    """Un texte tapé en Dvorak, relu en QWERTY (position des touches)."""
    DvorakCodePlugin = _load_plugin_class()
    plugin = DvorakCodePlugin()

    # "hello" tapé sur les touches physiques de QWERTY donne 'd.nnr' quand la
    # disposition active est Dvorak ; l'inverse doit donc restituer "hello".
    result: Dict[str, Any] = plugin.execute(
        {"text": "d.nnr", "from_layout": "dvorak", "to_layout": "qwerty"}
    )
    assert result["status"] == "ok"
    assert result["results"][0]["text_output"] == "hello"


def test_home_row_mapping() -> None:
    """La rangée de repos QWERTY vue depuis chaque disposition."""
    DvorakCodePlugin = _load_plugin_class()
    plugin = DvorakCodePlugin()

    # Emplacements de 'asdfghjkl' (QWERTY) -> Dvorak 'aoeuidhtn'.
    r = plugin.execute(
        {"text": "asdfghjkl", "from_layout": "qwerty", "to_layout": "dvorak"}
    )
    assert r["results"][0]["text_output"] == "aoeuidhtn"

    # Emplacements de 'asdfghjkl' (QWERTY) -> AZERTY 'qsdfghjkl'.
    r = plugin.execute(
        {"text": "asdfghjkl", "from_layout": "qwerty", "to_layout": "azerty"}
    )
    assert r["results"][0]["text_output"] == "qsdfghjkl"


def test_roundtrip_all_pairs() -> None:
    """Toute conversion A->B suivie de B->A restitue le texte d'origine.

    Les 26 lettres minuscules existent dans les trois dispositions : l'aller-
    retour est donc bijectif sur les lettres, les espaces et les chiffres. On
    reste en minuscule car une **majuscule** peut se mapper sur une ponctuation
    sans casse (ex. QWERTY 'Q' -> Dvorak "'") et perdre sa casse au retour, tout
    comme la ponctuation propre à une seule disposition — comportements attendus
    d'un remapping par position de touches, non testés ici.
    """
    DvorakCodePlugin = _load_plugin_class()
    plugin = DvorakCodePlugin()

    sample = "the quick brown fox jumps 42"
    layouts = ("dvorak", "qwerty", "azerty")
    for src in layouts:
        for dst in layouts:
            if src == dst:
                continue
            forward = plugin.execute(
                {"text": sample, "from_layout": src, "to_layout": dst}
            )
            assert forward["status"] == "ok", (src, dst)
            mid = forward["results"][0]["text_output"]
            back = plugin.execute(
                {"text": mid, "from_layout": dst, "to_layout": src}
            )
            assert back["results"][0]["text_output"] == sample, (src, dst)


def test_case_preserved() -> None:
    DvorakCodePlugin = _load_plugin_class()
    plugin = DvorakCodePlugin()

    r = plugin.execute(
        {"text": "Hello", "from_layout": "qwerty", "to_layout": "dvorak"}
    )
    out = r["results"][0]["text_output"]
    assert out[0].isupper() and out[1:].islower()


def test_unmapped_chars_kept() -> None:
    """Chiffres, espaces et caractères hors grille sont conservés tels quels."""
    DvorakCodePlugin = _load_plugin_class()
    plugin = DvorakCodePlugin()

    # 'a' est au même emplacement dans les deux dispositions -> converti ;
    # les chiffres et l'espace sont hors grille -> inchangés.
    r = plugin.execute(
        {"text": "a1 2b", "from_layout": "dvorak", "to_layout": "qwerty"}
    )
    assert r["status"] == "ok"
    out = r["results"][0]["text_output"]
    assert out[1:4] == "1 2"  # chiffres et espace intacts
    assert r["results"][0]["metadata"]["unchanged_chars"] == 3

    # Un texte entièrement hors grille ne convertit rien -> erreur explicite.
    r_err = plugin.execute(
        {"text": "12 34", "from_layout": "dvorak", "to_layout": "qwerty"}
    )
    assert r_err["status"] == "error"
    assert r_err["results"] == []


def test_default_layouts() -> None:
    """Sans paramètre, la conversion par défaut est Dvorak -> QWERTY."""
    DvorakCodePlugin = _load_plugin_class()
    plugin = DvorakCodePlugin()

    r = plugin.execute({"text": "d.nnr"})
    assert r["status"] == "ok"
    assert r["results"][0]["parameters"] == {
        "from_layout": "dvorak",
        "to_layout": "qwerty",
    }
    assert r["results"][0]["text_output"] == "hello"


def test_errors() -> None:
    DvorakCodePlugin = _load_plugin_class()
    plugin = DvorakCodePlugin()

    assert plugin.execute({"text": ""})["status"] == "error"
    assert (
        plugin.execute(
            {"text": "abc", "from_layout": "qwerty", "to_layout": "qwerty"}
        )["status"]
        == "error"
    )
    assert (
        plugin.execute(
            {"text": "abc", "from_layout": "qwerty", "to_layout": "colemak"}
        )["status"]
        == "error"
    )


if __name__ == "__main__":
    test_dvorak_to_qwerty_reference()
    test_home_row_mapping()
    test_roundtrip_all_pairs()
    test_case_preserved()
    test_unmapped_chars_kept()
    test_default_layouts()
    test_errors()
    print("Tous les tests dvorak_code passent.")
