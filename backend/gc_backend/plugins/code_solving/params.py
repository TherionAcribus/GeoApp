"""Parsing normalise des parametres communs aux plugins de codes secrets.

Centralise la lecture des modes `strict` / `embedded`, du jeu de caracteres
autorises (`allowed_chars`) et la conversion de booleens "souples" (str/int/bool).

Avant ce module, chaque plugin re-implementait ces conversions avec des valeurs
par defaut legerement differentes, ce qui rendait le comportement incoherent
d'un plugin a l'autre.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Iterable, Optional

# Jeu de caracteres "perturbateurs" tolere par defaut dans les codes secrets
# (espaces, ponctuation usuelle, degre). C'est le defaut le plus repandu dans
# les plugins existants (roman_code, abaddon_code, kenny_code, ...).
DEFAULT_ALLOWED_CHARS = " \t\r\n.:;,_-°"

# Espaces insecables / fines : souvent presents dans des textes copies-colles
# et a tolerer systematiquement comme separateurs.
NON_BREAKING_WHITESPACES = "\u00a0\u202f\u2007\ufeff"

_TRUE_STRINGS = frozenset({"true", "1", "yes", "on", "oui", "y", "strict"})


def parse_bool(value: Any, default: bool = False) -> bool:
    """Convertit une valeur "souple" en booleen.

    Accepte les bool, int/float, et chaines ("true", "1", "yes", "on", "oui",
    "strict"). Toute autre valeur (dont "smooth", "false", "0") renvoie False.
    `None` renvoie `default`.
    """
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    if isinstance(value, str):
        return value.strip().lower() in _TRUE_STRINGS
    return default


def normalize_allowed_chars(
    allowed_chars: Any,
    *,
    default: str = DEFAULT_ALLOWED_CHARS,
    extra: str = NON_BREAKING_WHITESPACES,
) -> str:
    """Normalise le parametre `allowed_chars`.

    - `None` ou chaine vide -> `default` (evite un jeu vide, donc un regex `[]`
      invalide, et correspond au comportement majoritaire des plugins)
    - liste/tuple de caracteres -> concatenation
    - autre -> `str(...)`

    Les caracteres `extra` (espaces insecables) sont toujours ajoutes s'ils
    sont absents, pour eviter qu'un espace invisible casse une detection stricte.
    """
    if allowed_chars is None:
        allowed_chars = default
    elif isinstance(allowed_chars, (list, tuple)):
        allowed_chars = "".join(str(part) for part in allowed_chars)
    else:
        allowed_chars = str(allowed_chars)

    if not allowed_chars:
        allowed_chars = default

    if extra:
        missing = "".join(ch for ch in extra if ch not in allowed_chars)
        allowed_chars += missing

    return allowed_chars


@dataclass(frozen=True)
class ModeParams:
    """Parametres de mode normalises pour un plugin de code secret."""

    mode: str
    strict: bool
    embedded: bool
    allowed_chars: str


def parse_mode_params(
    inputs: dict,
    *,
    default_mode: str = "decode",
    default_allowed_chars: str = DEFAULT_ALLOWED_CHARS,
    extra_allowed_chars: str = NON_BREAKING_WHITESPACES,
) -> ModeParams:
    """Lit `mode`, `strict`, `embedded` et `allowed_chars` depuis `inputs`.

    `strict` accepte indifferemment "strict"/"smooth" (forme historique) ou un
    booleen. `embedded` accepte un booleen "souple".
    """
    mode = str(inputs.get("mode", default_mode) or default_mode).lower()
    strict = parse_bool(inputs.get("strict"), default=False)
    embedded = parse_bool(inputs.get("embedded"), default=False)
    allowed_chars = normalize_allowed_chars(
        inputs.get("allowed_chars"),
        default=default_allowed_chars,
        extra=extra_allowed_chars,
    )
    return ModeParams(mode=mode, strict=strict, embedded=embedded, allowed_chars=allowed_chars)
