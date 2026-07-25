"""Plugin Solitaire (Pontifex) pour MysterAI.

Implemente le chiffre Solitaire concu par Bruce Schneier (roman "Cryptonomicon"
de Neal Stephenson). Voir https://en.wikipedia.org/wiki/Solitaire_(cipher).

Le chiffre s'appuie sur un jeu de 54 cartes (52 cartes + 2 jokers) utilise
comme generateur de flux de cles :

    - Cartes 1..52  : valeur ordinaire (trefle 1-13, carreau 14-26,
      coeur 27-39, pique 40-52).
    - Carte 53      : Joker A.
    - Carte 54      : Joker B.

L'ordre initial du jeu peut etre :
    - non clef (jeu ordonne 1..54), ou
    - clef par une phrase secrete (methode de "keying" de Schneier).

Pour chaque lettre du message :
    - encode : lettre_chiffree = (lettre_claire + cle) mod 26
    - decode : lettre_claire  = (lettre_chiffree - cle) mod 26

ou `cle` est la lettre suivante du flux produit par le jeu de cartes.
Seules les lettres A-Z sont traitees (les autres caracteres sont ignores).
"""

from __future__ import annotations

import string
import time
from typing import Any, Dict, List, Optional

JOKER_A = 53
JOKER_B = 54
DECK_SIZE = 54


class SolitaireCipherPlugin:
    """Chiffrement / dechiffrement Solitaire (Pontifex)."""

    def __init__(self) -> None:
        self.name = "solitaire_cipher"
        self.version = "1.0.0"

    # ------------------------------------------------------------------ #
    # Point d'entree
    # ------------------------------------------------------------------ #
    def execute(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        start_time = time.time()

        text = str(inputs.get("text", ""))
        mode = str(inputs.get("mode", "decode")).lower()
        key = str(inputs.get("key", ""))
        group = self._parse_bool(inputs.get("group", False))

        letters = [c for c in text.upper() if c in string.ascii_uppercase]
        if not letters:
            return self._error_response("Aucune lettre A-Z a traiter", start_time)

        if mode not in ("encode", "decode"):
            return self._error_response(f"Mode inconnu: {mode}", start_time)

        try:
            deck = self._build_deck(key)
        except ValueError as exc:
            return self._error_response(str(exc), start_time)

        # Flux de cle : une lettre par lettre du message.
        keystream = self._keystream(deck, len(letters))

        out_chars: List[str] = []
        for plain_char, key_char in zip(letters, keystream):
            p = ord(plain_char) - ord("A") + 1  # 1..26
            k = ord(key_char) - ord("A") + 1     # 1..26
            if mode == "encode":
                v = (p + k) % 26
            else:
                v = (p - k) % 26
            if v == 0:
                v = 26
            out_chars.append(chr(ord("A") + v - 1))

        output = "".join(out_chars)
        if group:
            output = self._group5(output)

        keyed = bool(self._clean_key(key))
        confidence = 1.0 if mode == "encode" else 0.5
        summary = (
            f"Solitaire {mode} ({'clef par phrase secrete' if keyed else 'jeu non clef'}), "
            f"{len(letters)} lettre(s) traitee(s)"
        )

        return {
            "status": "ok",
            "summary": summary,
            "results": [
                {
                    "id": "result_1",
                    "text_output": output,
                    "confidence": confidence,
                    "parameters": {
                        "mode": mode,
                        "key": key,
                        "keyed": keyed,
                        "group": group,
                    },
                    "metadata": {
                        "processed_chars": len(letters),
                        "keystream": "".join(keystream),
                    },
                }
            ],
            "plugin_info": self._get_plugin_info(start_time),
        }

    # ------------------------------------------------------------------ #
    # Preparation du jeu
    # ------------------------------------------------------------------ #
    def _build_deck(self, key: str) -> List[int]:
        """Jeu ordonne, eventuellement clef par une phrase secrete."""
        deck = list(range(1, DECK_SIZE + 1))
        passphrase = self._clean_key(key)
        for ch in passphrase:
            self._advance_deck(deck)
            # Coupe de comptage additionnelle avec la valeur de la lettre (A=1..Z=26).
            self._count_cut(deck, ord(ch) - ord("A") + 1)
        return deck

    @staticmethod
    def _clean_key(key: str) -> str:
        return "".join(c for c in key.upper() if c in string.ascii_uppercase)

    # ------------------------------------------------------------------ #
    # Generateur de flux de cle
    # ------------------------------------------------------------------ #
    def _keystream(self, deck: List[int], length: int) -> List[str]:
        stream: List[str] = []
        while len(stream) < length:
            value = self._next_output(deck)
            if value is None:  # carte joker en sortie -> on recommence
                continue
            n = value % 26
            if n == 0:
                n = 26
            stream.append(chr(ord("A") + n - 1))
        return stream

    def _next_output(self, deck: List[int]) -> Optional[int]:
        """Applique un tour complet et renvoie la carte de sortie (ou None si joker)."""
        self._advance_deck(deck)
        top = deck[0]
        if top == JOKER_B:
            top = JOKER_A  # les deux jokers valent 53
        output = deck[top]  # on saute `top` cartes ; la suivante est la sortie
        if output in (JOKER_A, JOKER_B):
            return None
        return output

    def _advance_deck(self, deck: List[int]) -> None:
        """Etapes 1 a 4 : deplacements des jokers, triple coupe, coupe de comptage."""
        self._move_down(deck, JOKER_A, 1)
        self._move_down(deck, JOKER_B, 2)
        self._triple_cut(deck)
        self._count_cut(deck)

    @staticmethod
    def _move_down(deck: List[int], card: int, count: int) -> None:
        """Descend `card` de `count` position(s) ; enroulement en bas -> 2e position."""
        for _ in range(count):
            i = deck.index(card)
            if i < len(deck) - 1:
                deck[i], deck[i + 1] = deck[i + 1], deck[i]
            else:  # carte en bas : elle devient la 2e carte
                deck.pop(i)
                deck.insert(1, card)

    @staticmethod
    def _triple_cut(deck: List[int]) -> None:
        """Echange les cartes au-dessus du premier joker avec celles sous le second."""
        a = deck.index(JOKER_A)
        b = deck.index(JOKER_B)
        first, second = min(a, b), max(a, b)
        top = deck[:first]
        middle = deck[first:second + 1]
        bottom = deck[second + 1:]
        deck[:] = bottom + middle + top

    @staticmethod
    def _count_cut(deck: List[int], count: Optional[int] = None) -> None:
        """Coupe de comptage : `count` cartes du dessus glissees juste avant la derniere.

        Si `count` est None, il est lu sur la carte du bas (joker = 53).
        La derniere carte reste en place.
        """
        if count is None:
            count = deck[-1]
            if count == JOKER_B:
                count = JOKER_A
        bottom = deck[-1]
        top = deck[:count]
        middle = deck[count:-1]
        deck[:] = middle + top + [bottom]

    # ------------------------------------------------------------------ #
    # Utilitaires
    # ------------------------------------------------------------------ #
    @staticmethod
    def _group5(text: str) -> str:
        return " ".join(text[i:i + 5] for i in range(0, len(text), 5))

    @staticmethod
    def _parse_bool(value: Any) -> bool:
        if isinstance(value, bool):
            return value
        return str(value).strip().lower() in {"1", "true", "yes", "oui", "on"}

    def _get_plugin_info(self, start_time: float) -> Dict[str, Any]:
        return {
            "name": self.name,
            "version": self.version,
            "execution_time_ms": round((time.time() - start_time) * 1000, 2),
        }

    def _error_response(self, message: str, start_time: float) -> Dict[str, Any]:
        return {
            "status": "error",
            "summary": message,
            "results": [],
            "plugin_info": self._get_plugin_info(start_time),
        }


def execute(inputs: Dict[str, Any]) -> Dict[str, Any]:
    return SolitaireCipherPlugin().execute(inputs)
