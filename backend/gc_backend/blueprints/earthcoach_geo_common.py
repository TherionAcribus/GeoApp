"""Helpers partages par les proxies geo d'EarthCoach (geologie, altitude).

Les trois routes EarthCoach qui interrogent un service externe par coordonnees
(Macrostrat, BRGM, altimetrie) ont les memes besoins : valider une coordonnee et
mettre en cache les appels repetes pendant une session. On centralise ici pour
eviter de dupliquer la meme logique dans chaque blueprint.
"""

from __future__ import annotations

import time


def parse_coord(value: object, name: str, low: float, high: float) -> float:
    """Valide une coordonnee de query string et leve ValueError avec un message clair."""
    if value is None or value == '':
        raise ValueError(f'{name} is required')
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        raise ValueError(f'{name} must be a number') from None
    if not low <= parsed <= high:
        raise ValueError(f'{name} must be between {low} and {high}')
    return parsed


class TTLCache:
    """Cache memoire simple avec TTL et plafond d'entrees.

    Chaque coordonnee arrondie unique ajoute une entree a vie du process : on
    borne comme WebSearchService (purge grossiere au-dela de la limite) pour
    eviter une croissance illimitee sur un serveur longue duree.
    """

    def __init__(self, ttl_seconds: float, max_entries: int) -> None:
        self.ttl_seconds = ttl_seconds
        self.max_entries = max_entries
        self._entries: dict[str, tuple[float, dict]] = {}

    def get(self, key: str) -> dict | None:
        entry = self._entries.get(key)
        if not entry:
            return None
        if (time.time() - entry[0]) >= self.ttl_seconds:
            self._entries.pop(key, None)
            return None
        return entry[1]

    def set(self, key: str, value: dict) -> None:
        if len(self._entries) >= self.max_entries:
            self._entries.clear()
        self._entries[key] = (time.time(), value)

    def clear(self) -> None:
        self._entries.clear()

    def __len__(self) -> int:
        return len(self._entries)
