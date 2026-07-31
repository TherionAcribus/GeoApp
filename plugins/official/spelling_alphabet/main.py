"""Plugin Spelling Alphabet pour MysterAI.

Un « alphabet d'épellation » remplace chaque lettre par un mot-code non ambigu,
prononçable sur un canal bruité (radio, téléphone). Le plus connu est
l'alphabet **NATO / ICAO** (``Alfa Bravo Charlie``), mais de nombreuses
variantes historiques ou régionales existent et servent régulièrement de
codage dans les géocaches Mystery.

Le plugin reprend les 11 alphabets de l'outil de référence CacheSleuth
(https://www.cachesleuth.com/tools/spellingalphabet/) :

===================  =========================================================
``nato``             NATO / ICAO (Alfa, Bravo, Charlie) — standard depuis 1956
``itu1932``          ITU 1932 (Amsterdam, Baltimore) — noms de lieux
``western-union``    Western Union (Adams, Boston)
``us-jan``           US Joint Army/Navy « Able Baker » (1941-1956)
``raf1924``          RAF 1924 (Ace, Beer, Charlie)
``apco``             APCO / police américaine (Adam, Boy, Charles)
``dutch``            Néerlandais (Anton, Bernhard)
``german``           Allemand (Anton, Berta, Cäsar)
``swedish``          Suédois (Adam, Bertil, Caesar)
``russian``          Russe officiel (Анна, Борис) — cyrillique
``russian-unofficial`` Russe usuel (Антон, Борис)
===================  =========================================================

Conventions reprises telles quelles de l'outil de référence :

- à l'encodage, l'espace devient ``(space)`` et les retours à la ligne /
  tabulations sont conservés ; les caractères sans mot-code sont recopiés ;
- au décodage, les mots-codes sont séparés par des espaces, la casse est
  ignorée, et les séparateurs internes ``- ( ) .`` sont facultatifs
  (``X-ray``, ``Xray`` et ``xray`` donnent tous ``x``) ;
- les mots-codes en deux parties (``New York``, ``Иван краткий``,
  ``Scharfes S``) sont reconnus par correspondance la plus longue d'abord ;
- les variantes usuelles sont acceptées au décodage (``Alpha`` pour ``Alfa``,
  ``Juliet`` pour ``Juliett``…) sans être produites à l'encodage ;
- un mot non reconnu est recopié tel quel, entouré d'espaces.

En décodage, le mode ``auto`` (par défaut) essaie les 11 alphabets et renvoie
un résultat par alphabet ayant reconnu une part suffisante des mots, classé
par taux de reconnaissance puis par le scoring linguistique du backend.
"""

from __future__ import annotations

import re
import time
from typing import Any, Dict, List, Optional, Tuple


#: Tables complètes des 11 alphabets, extraites de l'outil CacheSleuth.
#: ``words`` associe la clé (lettre minuscule, chiffre, ponctuation) à son
#: mot-code ; ``alts`` liste les variantes acceptées au décodage seulement.
ALPHABETS: Tuple[Dict[str, Any], ...] = (
    {
        "id": "nato",
        "label": "NATO / ICAO (Alfa, Bravo, Charlie)",
        "note": "The international radiotelephony spelling alphabet (1956 to present).",
        "words": {
            "a": "Alfa", "b": "Bravo", "c": "Charlie", "d": "Delta",
            "e": "Echo", "f": "Foxtrot", "g": "Golf", "h": "Hotel",
            "i": "India", "j": "Juliett", "k": "Kilo", "l": "Lima",
            "m": "Mike", "n": "November", "o": "Oscar", "p": "Papa",
            "q": "Quebec", "r": "Romeo", "s": "Sierra", "t": "Tango",
            "u": "Uniform", "v": "Victor", "w": "Whiskey", "x": "X-ray",
            "y": "Yankee", "z": "Zulu", "0": "Zero", "1": "One",
            "2": "Two", "3": "Three", "4": "Four", "5": "Five",
            "6": "Six", "7": "Seven", "8": "Eight", "9": "Nine",
            ".": "Stop",
        },
        "alts": (("a", "Alpha"), ("j", "Juliet"), ("x", "Xray")),
    },
    {
        "id": "itu1932",
        "label": "ITU 1932 (Amsterdam, Baltimore)",
        "note": "The 1932 international (ITU / ICAN) phonetic alphabet of place names.",
        "words": {
            "a": "Amsterdam", "b": "Baltimore", "c": "Casablanca", "d": "Denmark",
            "e": "Edison", "f": "Florida", "g": "Gallipoli", "h": "Havana",
            "i": "Italia", "j": "Jerusalem", "k": "Kilogramme", "l": "Liverpool",
            "m": "Madagascar", "n": "New York", "o": "Oslo", "p": "Paris",
            "q": "Quebec", "r": "Roma", "s": "Santiago", "t": "Tripoli",
            "u": "Upsala", "v": "Valencia", "w": "Washington", "x": "Xanthippe",
            "y": "Yokohama", "z": "Zurich",
        },
    },
    {
        "id": "western-union",
        "label": "Western Union (Adams, Boston)",
        "note": "The Western Union telegraph company spelling alphabet.",
        "words": {
            "a": "Adams", "b": "Boston", "c": "Chicago", "d": "Denver",
            "e": "Easy", "f": "Frank", "g": "George", "h": "Henry",
            "i": "Ida", "j": "John", "k": "King", "l": "Lincoln",
            "m": "Mary", "n": "New York", "o": "Ocean", "p": "Peter",
            "q": "Queen", "r": "Roger", "s": "Sugar", "t": "Thomas",
            "u": "Union", "v": "Victor", "w": "William", "x": "X-ray",
            "y": "Young", "z": "Zero",
        },
    },
    {
        "id": "us-jan",
        "label": "US Joint Army/Navy (Able, Baker)",
        "note": "The US \"Able Baker\" military alphabet (1941 to 1956).",
        "words": {
            "a": "Able", "b": "Baker", "c": "Charlie", "d": "Dog",
            "e": "Easy", "f": "Fox", "g": "George", "h": "How",
            "i": "Item", "j": "Jig", "k": "King", "l": "Love",
            "m": "Mike", "n": "Nan", "o": "Oboe", "p": "Peter",
            "q": "Queen", "r": "Roger", "s": "Sugar", "t": "Tare",
            "u": "Uncle", "v": "Victor", "w": "William", "x": "X-ray",
            "y": "Yoke", "z": "Zebra",
        },
    },
    {
        "id": "raf1924",
        "label": "RAF 1924 (Ace, Beer, Charlie)",
        "note": "The British RAF phonetic alphabet (1924 to 1942).",
        "words": {
            "a": "Ace", "b": "Beer", "c": "Charlie", "d": "Don",
            "e": "Edward", "f": "Freddie", "g": "George", "h": "Harry",
            "i": "Ink", "j": "Johnnie", "k": "King", "l": "London",
            "m": "Monkey", "n": "Nuts", "o": "Orange", "p": "Pip",
            "q": "Queen", "r": "Robert", "s": "Sugar", "t": "Toc",
            "u": "Uncle", "v": "Vic", "w": "William", "x": "X-ray",
            "y": "Yorker", "z": "Zebra",
        },
    },
    {
        "id": "apco",
        "label": "APCO / Police (Adam, Boy, Charles)",
        "note": "The APCO / US police radio alphabet.",
        "words": {
            "a": "Adam", "b": "Boy", "c": "Charles", "d": "David",
            "e": "Edward", "f": "Frank", "g": "George", "h": "Henry",
            "i": "Ida", "j": "John", "k": "King", "l": "Lincoln",
            "m": "Mary", "n": "Nora", "o": "Ocean", "p": "Paul",
            "q": "Queen", "r": "Robert", "s": "Sam", "t": "Tom",
            "u": "Union", "v": "Victor", "w": "William", "x": "X-ray",
            "y": "Young", "z": "Zebra",
        },
    },
    {
        "id": "dutch",
        "label": "Dutch (Anton, Bernhard)",
        "note": "The Dutch spelling alphabet.",
        "words": {
            "a": "Anton", "b": "Bernhard", "c": "Cornelis", "d": "Dirk",
            "e": "Eduard", "f": "Ferdinand", "g": "Gerard", "h": "Hendrik",
            "i": "Izaak", "j": "Johan", "k": "Karel", "l": "Lodewijk",
            "m": "Maria", "n": "Nico", "o": "Otto", "p": "Pieter",
            "q": "Quirinius", "r": "Richard", "s": "Simon", "t": "Theodoor",
            "u": "Utrecht", "v": "Victor", "w": "Willem", "x": "Xantippe",
            "y": "Ypsilon", "z": "Zacharias", "0": "Nul", "1": "Een",
            "2": "Twee", "3": "Drie", "4": "Vier", "5": "Vijf",
            "6": "Zes", "7": "Zeven", "8": "Acht", "9": "Negen",
        },
        "alts": (("j", "Jacob"), ("l", "Leo"), ("q", "Quinten"), ("r", "Rudolf")),
    },
    {
        "id": "german",
        "label": "German (Anton, Berta, Cäsar)",
        "note": "The German spelling alphabet.",
        "words": {
            "a": "Anton", "b": "Berta", "c": "Cäsar", "d": "Dora",
            "e": "Emil", "f": "Friedrich", "g": "Gustav", "h": "Heinrich",
            "i": "Ida", "j": "Julius", "k": "Kaufmann", "l": "Ludwig",
            "m": "Martha", "n": "Nordpol", "o": "Otto", "p": "Paula",
            "q": "Quelle", "r": "Richard", "s": "Samuel", "t": "Theodor",
            "u": "Ulrich", "v": "Viktor", "w": "Wilhelm", "x": "Xanthippe",
            "y": "Ypsilon", "z": "Zacharias", "0": "Null", "1": "Eins",
            "2": "Zwei", "3": "Drei", "4": "Vier", "5": "Fünf",
            "6": "Sechs", "7": "Sieben", "8": "Acht", "9": "Neun",
            "ä": "Ärger", "ö": "Ökonom", "ü": "Übermut", "ß": "Eszett",
        },
        "alts": (("k", "Konrad"), ("s", "Siegfried"), ("x", "Xaver"), ("z", "Zürich"), ("ö", "Österreich"), ("ü", "Übel"), ("ß", "Scharfes S")),
    },
    {
        "id": "swedish",
        "label": "Swedish (Adam, Bertil, Caesar)",
        "note": "The Swedish Armed Forces' radio alphabet.",
        "words": {
            "a": "Adam", "b": "Bertil", "c": "Caesar", "d": "David",
            "e": "Erik", "f": "Filip", "g": "Gustav", "h": "Helge",
            "i": "Ivar", "j": "Johan", "k": "Kalle", "l": "Ludvig",
            "m": "Martin", "n": "Niklas", "o": "Olof", "p": "Petter",
            "q": "Qvintus", "r": "Rudolf", "s": "Sigurd", "t": "Tore",
            "u": "Urban", "v": "Viktor", "w": "Wilhelm", "x": "Xerxes",
            "y": "Yngve", "z": "Zäta", "0": "Nolla", "1": "Ett",
            "2": "Tvåa", "3": "Trea", "4": "Fyra", "5": "Femma",
            "6": "Sexa", "7": "Sju", "8": "Åtta", "9": "Nia",
            "å": "Åke", "ä": "Ärlig", "ö": "Östen",
        },
    },
    {
        "id": "russian",
        "label": "Russian official (Анна, Борис)",
        "note": "The official Russian spelling alphabet (Cyrillic).",
        "words": {
            "а": "Анна", "б": "Борис", "в": "Василий", "г": "Григорий",
            "д": "Дмитрий", "е": "Елена", "ж": "Женя", "з": "Зинаида",
            "и": "Иван", "й": "Иван краткий", "к": "Константин", "л": "Леонид",
            "м": "Михаил", "н": "Николай", "о": "Ольга", "п": "Павел",
            "р": "Роман", "с": "Семён", "т": "Татьяна", "у": "Ульяна",
            "ф": "Фёдор", "х": "Харитон", "ц": "Цапля", "ч": "Человек",
            "ш": "Шура", "щ": "Щука", "ъ": "Твёрдый знак", "ы": "Еры",
            "ь": "Мягкий знак", "э": "Эхо", "ю": "Юрий", "я": "Яков",
            "0": "Ноль", "1": "Один", "2": "Два", "3": "Три",
            "4": "Четыре", "5": "Пять", "6": "Шесть", "7": "Семь",
            "8": "Восемь", "9": "Девять", ".": "Точка",
        },
    },
    {
        "id": "russian-unofficial",
        "label": "Russian unofficial (Антон, Борис)",
        "note": "A common unofficial Russian spelling alphabet (includes Ё).",
        "words": {
            "а": "Антон", "б": "Борис", "в": "Василий", "г": "Галина",
            "д": "Дмитрий", "е": "Елена", "ё": "Ёлка", "ж": "Жук",
            "з": "Зоя", "и": "Иван", "й": "Йот", "к": "Киловатт",
            "л": "Леонид", "м": "Мария", "н": "Николай", "о": "Ольга",
            "п": "Павел", "р": "Радио", "с": "Сергей", "т": "Тамара",
            "у": "Ульяна", "ф": "Фёдор", "х": "Харитон", "ц": "Центр",
            "ч": "Человек", "ш": "Шура", "щ": "Щука", "ъ": "Твёрдый знак",
            "ы": "Игрек", "ь": "Мягкий знак", "э": "Эмма", "ю": "Юрий",
            "я": "Яков", "0": "Ноль", "1": "Один", "2": "Два",
            "3": "Три", "4": "Четыре", "5": "Пять", "6": "Шесть",
            "7": "Семь", "8": "Восемь", "9": "Девять", ".": "Точка",
        },
    },
)

_ALPHABETS_BY_ID: Dict[str, Dict[str, Any]] = {
    alphabet["id"]: alphabet for alphabet in ALPHABETS
}

#: Séparateurs internes d'un mot-code, optionnels au décodage.
_OPTIONAL_SEPARATORS = re.compile(r"[\s\-().]")

#: Espaces multiples laissés par les mots non reconnus.
_EXTRA_SPACES = re.compile(r" {2,}")


class SpellingAlphabetPlugin:
    """Plugin d'encodage/décodage des alphabets d'épellation.

    Args:
        inputs (dict):
            - text (str): Texte à traiter (texte clair en encode, mots-codes
              séparés par des espaces en decode).
            - mode (str): 'encode' ou 'decode'.
            - alphabet (str, optionnel): Identifiant d'alphabet (``nato``,
              ``german``…) ou ``auto`` (défaut) : en décodage les 11 alphabets
              sont essayés, en encodage ``auto`` retombe sur ``nato``.

    Returns:
        dict: Résultat au format standardisé attendu par le PluginManager.
    """

    #: Mot-code de l'espace, commun à tous les alphabets.
    SPACE_WORD = "(space)"

    #: Caractères recopiés tels quels à l'encodage (pas de mot-code).
    VERBATIM_CHARS = "\n\t\r"

    #: Valeur du champ ``alphabet`` déclenchant l'essai de tous les alphabets.
    AUTO = "auto"

    #: Alphabet utilisé quand ``auto`` n'a pas de sens (encodage).
    DEFAULT_ALPHABET = "nato"

    #: En mode ``auto``, taux minimal de mots reconnus pour retenir un
    #: alphabet — sauf s'il est le meilleur candidat (voir `_decode_auto`).
    AUTO_MIN_RATIO = 0.5

    def __init__(self) -> None:
        self.name = "spelling_alphabet"
        self.version = "1.0.0"
        self._reverse_cache: Dict[str, Tuple[Dict[str, str], int]] = {}

    # ------------------------------------------------------------------
    # Point d'entrée
    # ------------------------------------------------------------------

    def execute(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        """Point d'entrée principal du plugin."""
        start_time = time.time()

        text = inputs.get("text", "")
        mode = str(inputs.get("mode", "decode")).lower()

        if not isinstance(text, str) or not text.strip():
            return self._error_response("Aucun texte fourni", start_time)

        requested = self._resolve_alphabet(inputs.get("alphabet"))
        if requested is None:
            return self._error_response(
                f"Alphabet inconnu: {inputs.get('alphabet')}", start_time
            )

        if mode == "encode":
            alphabet_id = (
                self.DEFAULT_ALPHABET if requested == self.AUTO else requested
            )
            return self._run_encode(text, _ALPHABETS_BY_ID[alphabet_id], start_time)

        if mode == "decode":
            if requested == self.AUTO:
                return self._decode_auto(text, start_time)
            return self._run_decode(text, _ALPHABETS_BY_ID[requested], start_time)

        return self._error_response(f"Mode inconnu: {mode}", start_time)

    # ------------------------------------------------------------------
    # Encodage
    # ------------------------------------------------------------------

    def _run_encode(
        self, text: str, alphabet: Dict[str, Any], start_time: float
    ) -> Dict[str, Any]:
        output, encoded, unknown = self._encode(text, alphabet)

        if encoded == 0:
            return self._error_response(
                f"Aucun caractère encodable en « {alphabet['label']} »", start_time
            )

        return {
            "status": "ok",
            "summary": (
                f"Encodage {alphabet['label']} réussi ({encoded} caractère(s))"
            ),
            "results": [
                {
                    "id": "result_1",
                    "text_output": output,
                    "confidence": 1.0,
                    "parameters": {"mode": "encode", "alphabet": alphabet["id"]},
                    "metadata": {
                        "alphabet_label": alphabet["label"],
                        "chars_encoded": encoded,
                        "unknown_chars": unknown,
                    },
                }
            ],
            "plugin_info": self._get_plugin_info(start_time),
        }

    def _encode(self, text: str, alphabet: Dict[str, Any]) -> Tuple[str, int, int]:
        """Remplace chaque caractère par son mot-code, séparés par une espace.

        Retourne (texte encodé, caractères encodés, caractères sans mot-code).
        """
        words = alphabet["words"]
        pieces: List[str] = []
        encoded = 0
        unknown = 0

        for char in text:
            if char == " ":
                pieces.append(self.SPACE_WORD)
                continue
            if char in self.VERBATIM_CHARS:
                pieces.append(char)
                continue
            word = words.get(char.lower())
            if word is None:
                pieces.append(char)
                unknown += 1
            else:
                pieces.append(word)
                encoded += 1

        return " ".join(pieces), encoded, unknown

    # ------------------------------------------------------------------
    # Décodage
    # ------------------------------------------------------------------

    def _run_decode(
        self, text: str, alphabet: Dict[str, Any], start_time: float
    ) -> Dict[str, Any]:
        output, matched, total = self._decode(text, alphabet)

        if matched == 0:
            return self._error_response(
                f"Aucun mot-code « {alphabet['label']} » reconnu dans le texte",
                start_time,
            )

        ratio = matched / total
        return {
            "status": "ok",
            "summary": (
                f"Décodage {alphabet['label']} réussi "
                f"({matched}/{total} mot(s) reconnu(s))"
            ),
            "results": [
                self._build_result(
                    "result_1", output, alphabet, matched, total, ratio, auto=False
                )
            ],
            "plugin_info": self._get_plugin_info(start_time),
        }

    def _decode_auto(self, text: str, start_time: float) -> Dict[str, Any]:
        """Essaie les 11 alphabets et retient les plus vraisemblables."""
        candidates: List[Tuple[Dict[str, Any], str, int, int, float]] = []

        for alphabet in ALPHABETS:
            output, matched, total = self._decode(text, alphabet)
            if matched == 0:
                continue
            candidates.append((alphabet, output, matched, total, matched / total))

        if not candidates:
            return self._error_response(
                "Aucun mot-code d'alphabet d'épellation reconnu dans le texte",
                start_time,
            )

        # Un alphabet partiellement reconnu est du bruit (beaucoup de mots-codes
        # sont partagés entre variantes : George, Charlie, X-ray…), sauf s'il est
        # le meilleur candidat disponible.
        best_ratio = max(candidate[4] for candidate in candidates)
        threshold = min(self.AUTO_MIN_RATIO, best_ratio)
        kept = [c for c in candidates if c[4] >= threshold]
        # Tri stable : à taux égal, l'ordre de déclaration prime (NATO d'abord).
        kept.sort(key=lambda candidate: candidate[4], reverse=True)

        results: List[Dict[str, Any]] = []
        by_output: Dict[str, Dict[str, Any]] = {}

        for alphabet, output, matched, total, ratio in kept:
            # Plusieurs alphabets peuvent produire le même texte : on garde le
            # mieux classé et on note les autres dans ses métadonnées.
            duplicate = by_output.get(output)
            if duplicate is not None:
                duplicate["metadata"]["also_matched"].append(alphabet["id"])
                continue
            result = self._build_result(
                f"result_{len(results) + 1}",
                output,
                alphabet,
                matched,
                total,
                ratio,
                auto=True,
            )
            by_output[output] = result
            results.append(result)

        return {
            "status": "ok",
            "summary": (
                f"Décodage automatique : {len(results)} alphabet(s) retenu(s) "
                f"sur {len(candidates)} testé(s)"
            ),
            "results": results,
            "plugin_info": self._get_plugin_info(start_time),
        }

    def _decode(self, text: str, alphabet: Dict[str, Any]) -> Tuple[str, int, int]:
        """Traduit une suite de mots-codes séparés par des espaces.

        Les mots sont consommés par correspondance la plus longue d'abord, pour
        que ``Иван краткий`` (й) l'emporte sur ``Иван`` (и). Un mot non reconnu
        est recopié tel quel, entouré d'espaces.

        Retourne (texte clair, mots reconnus, mots total).
        """
        mapping, max_words = self._reverse_map(alphabet)
        tokens = text.split()

        pieces: List[str] = []
        index = 0
        matched = 0

        while index < len(tokens):
            for size in range(min(max_words, len(tokens) - index), 0, -1):
                candidate = " ".join(tokens[index : index + size]).lower()
                letter = mapping.get(candidate)
                if letter is None:
                    letter = mapping.get(_OPTIONAL_SEPARATORS.sub("", candidate))
                if letter is not None:
                    pieces.append(letter)
                    index += size
                    matched += size
                    break
            else:
                pieces.append(f" {tokens[index]} ")
                index += 1

        output = _EXTRA_SPACES.sub(" ", "".join(pieces)).strip()
        return output, matched, len(tokens)

    def _reverse_map(
        self, alphabet: Dict[str, Any]
    ) -> Tuple[Dict[str, str], int]:
        """Construit (et mémorise) la table mot-code → clé d'un alphabet.

        Chaque mot-code est indexé en minuscules et, en plus, débarrassé de ses
        séparateurs internes (``X-ray`` → ``xray``, ``New York`` → ``newyork``)
        pour accepter les graphies compactes.
        """
        cached = self._reverse_cache.get(alphabet["id"])
        if cached is not None:
            return cached

        mapping: Dict[str, str] = {}
        max_words = 1

        def add(word: str, key: str) -> None:
            nonlocal max_words
            lowered = word.lower()
            mapping[lowered] = key
            compact = _OPTIONAL_SEPARATORS.sub("", lowered)
            if compact and compact != lowered:
                mapping[compact] = key
            max_words = max(max_words, len(lowered.split()))

        for key, word in alphabet["words"].items():
            add(word, key)
        for key, word in alphabet.get("alts", ()):
            add(word, key)
        add(self.SPACE_WORD, " ")

        cached = (mapping, max_words)
        self._reverse_cache[alphabet["id"]] = cached
        return cached

    # ------------------------------------------------------------------
    # Utilitaires
    # ------------------------------------------------------------------

    def _resolve_alphabet(self, raw: Any) -> Optional[str]:
        """Normalise le champ ``alphabet``.

        Retourne l'identifiant, ``'auto'``, ou ``None`` si l'alphabet demandé
        n'existe pas. Les underscores sont acceptés à la place des tirets
        (``western_union`` == ``western-union``).
        """
        if raw is None:
            return self.AUTO
        value = str(raw).strip().lower().replace("_", "-")
        if not value or value == self.AUTO:
            return self.AUTO
        return value if value in _ALPHABETS_BY_ID else None

    def _build_result(
        self,
        result_id: str,
        output: str,
        alphabet: Dict[str, Any],
        matched: int,
        total: int,
        ratio: float,
        auto: bool,
    ) -> Dict[str, Any]:
        """Construit un résultat de décodage.

        La confiance suit la convention du projet (≈0.5 pour un décodage, puis
        rescoré linguistiquement par le backend), pondérée par la part de mots
        effectivement reconnus.
        """
        metadata: Dict[str, Any] = {
            "alphabet_label": alphabet["label"],
            "alphabet_note": alphabet["note"],
            "words_matched": matched,
            "words_total": total,
            "match_ratio": round(ratio, 3),
        }
        if auto:
            metadata["auto_detected"] = True
            metadata["also_matched"] = []

        return {
            "id": result_id,
            "text_output": output,
            "confidence": round(0.5 * ratio, 3),
            "parameters": {"mode": "decode", "alphabet": alphabet["id"]},
            "metadata": metadata,
        }

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
    return SpellingAlphabetPlugin().execute(inputs)
