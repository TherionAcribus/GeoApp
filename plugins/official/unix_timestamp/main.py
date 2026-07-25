"""Plugin Unix Timestamp pour MysterAI.

Convertit une date en timestamp Unix (secondes/millisecondes depuis le 1er
janvier 1970 UTC) et inversement.

Cas d'usage geocaching : certaines enigmes cachent une coordonnee derriere une
date. On convertit la date en timestamp, et les chiffres du timestamp donnent
les minutes de la coordonnee.

    Exemple : 27/02/1970 04:03:34 UTC  ->  4939414  ->  N 49 39.414

Le mode `to_timestamp` accepte de nombreux formats de date (JJ/MM/AAAA,
AAAA-MM-JJ, ISO 8601, mois en toutes lettres FR/EN, avec ou sans heure).
Tous les calculs sont faits en UTC (convention des enigmes epoch), ce qui
garantit un resultat identique quelle que soit la machine.
"""

from __future__ import annotations

import re
import time
import unicodedata
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple

_EPOCH = datetime(1970, 1, 1)

# Mois en toutes lettres / abreges (francais + anglais, sans accents).
_MONTHS = {
    "janvier": 1, "jan": 1, "january": 1,
    "fevrier": 2, "fev": 2, "feb": 2, "february": 2,
    "mars": 3, "mar": 3, "march": 3,
    "avril": 4, "avr": 4, "apr": 4, "april": 4,
    "mai": 5, "may": 5,
    "juin": 6, "jun": 6, "june": 6,
    "juillet": 7, "juil": 7, "jul": 7, "july": 7,
    "aout": 8, "aug": 8, "august": 8,
    "septembre": 9, "sept": 9, "sep": 9, "september": 9,
    "octobre": 10, "oct": 10, "october": 10,
    "novembre": 11, "nov": 11, "november": 11,
    "decembre": 12, "dec": 12, "december": 12,
}


class UnixTimestampPlugin:
    """Conversion date <-> timestamp Unix (UTC)."""

    def __init__(self) -> None:
        self.name = "unix_timestamp"
        self.version = "1.0.0"

    # ------------------------------------------------------------------ #
    # Point d'entree
    # ------------------------------------------------------------------ #
    def execute(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        start_time = time.time()

        text = str(inputs.get("text", "")).strip()
        mode = str(inputs.get("mode", "to_timestamp")).lower()
        unit = str(inputs.get("unit", "seconds")).lower()
        day_first = self._parse_bool(inputs.get("day_first", True))

        if not text:
            return self._error_response("Aucune date/timestamp fourni", start_time)

        try:
            if mode == "to_date":
                results = self._timestamp_to_date(text, unit)
            else:  # to_timestamp (defaut)
                results = self._date_to_timestamp(text, unit, day_first)
        except ValueError as exc:
            return self._error_response(str(exc), start_time)

        if not results:
            return self._error_response("Conversion impossible", start_time)

        return {
            "status": "ok",
            "summary": results[0].get("metadata", {}).get("summary", "Conversion reussie"),
            "results": results,
            "plugin_info": self._get_plugin_info(start_time),
        }

    # ------------------------------------------------------------------ #
    # Date -> Timestamp
    # ------------------------------------------------------------------ #
    def _date_to_timestamp(self, text: str, unit: str, day_first: bool) -> List[Dict[str, Any]]:
        dt, had_time = self._parse_datetime(text, day_first)
        seconds = int((dt - _EPOCH).total_seconds())
        milliseconds = seconds * 1000

        iso = dt.strftime("%Y-%m-%d %H:%M:%S") + " UTC"
        primary_is_ms = unit == "milliseconds"

        sec_result = {
            "id": "result_seconds",
            "text_output": str(seconds),
            "confidence": 1.0,
            "parameters": {"mode": "to_timestamp", "unit": "seconds", "day_first": day_first},
            "metadata": {
                "interpreted_date": iso,
                "time_present": had_time,
                "unit": "seconds",
                "summary": f"{iso} -> {seconds} (secondes)",
            },
        }
        ms_result = {
            "id": "result_milliseconds",
            "text_output": str(milliseconds),
            "confidence": 1.0,
            "parameters": {"mode": "to_timestamp", "unit": "milliseconds", "day_first": day_first},
            "metadata": {
                "interpreted_date": iso,
                "time_present": had_time,
                "unit": "milliseconds",
                "summary": f"{iso} -> {milliseconds} (millisecondes)",
            },
        }

        # Le resultat correspondant a l'unite demandee est place en premier.
        return [ms_result, sec_result] if primary_is_ms else [sec_result, ms_result]

    # ------------------------------------------------------------------ #
    # Timestamp -> Date
    # ------------------------------------------------------------------ #
    def _timestamp_to_date(self, text: str, unit: str) -> List[Dict[str, Any]]:
        match = re.search(r"-?\d+", text.replace(" ", ""))
        if not match:
            raise ValueError("Aucun nombre trouve dans le timestamp")
        value = int(match.group(0))

        primary_is_ms = unit == "milliseconds"
        sec_result = self._build_date_result(value, "seconds")
        ms_result = self._build_date_result(value, "milliseconds")

        return [ms_result, sec_result] if primary_is_ms else [sec_result, ms_result]

    def _build_date_result(self, value: int, unit: str) -> Dict[str, Any]:
        seconds = value / 1000.0 if unit == "milliseconds" else float(value)
        dt = _EPOCH + timedelta(seconds=seconds)
        iso = dt.strftime("%Y-%m-%d %H:%M:%S") + " UTC"
        fr = dt.strftime("%d/%m/%Y %H:%M:%S")
        return {
            "id": f"result_{unit}",
            "text_output": iso,
            "confidence": 1.0,
            "parameters": {"mode": "to_date", "unit": unit},
            "metadata": {
                "date_fr": fr,
                "unit": unit,
                "summary": f"{value} ({unit}) -> {iso}",
            },
        }

    # ------------------------------------------------------------------ #
    # Parsing de date multi-formats
    # ------------------------------------------------------------------ #
    def _parse_datetime(self, raw: str, day_first: bool) -> Tuple[datetime, bool]:
        s = self._strip_accents(raw.strip().lower())
        if not s:
            raise ValueError("Date vide")

        # 1) Extraction de la partie horaire (HH:MM[:SS] ou HHhMM[mSS]).
        hour = minute = second = 0
        had_time = False
        tmatch = re.search(r"(\d{1,2})\s*[:h]\s*(\d{1,2})(?:\s*[:m]\s*(\d{1,2}))?\s*s?", s)
        if tmatch:
            hour = int(tmatch.group(1))
            minute = int(tmatch.group(2))
            second = int(tmatch.group(3)) if tmatch.group(3) else 0
            had_time = True
            s = (s[: tmatch.start()] + " " + s[tmatch.end():]).strip()

        # 2) Mois en toutes lettres.
        month_from_name: Optional[int] = None
        for word in re.findall(r"[a-z]+", s):
            if word in _MONTHS:
                month_from_name = _MONTHS[word]
                break

        tokens = re.findall(r"\d+", s)
        if not tokens:
            raise ValueError(f"Format de date non reconnu : {raw!r}")

        day, month, year = self._resolve_dmy(tokens, month_from_name, day_first, raw)

        if not (1 <= month <= 12):
            raise ValueError(f"Mois invalide ({month}) dans : {raw!r}")
        if not (1 <= day <= 31):
            raise ValueError(f"Jour invalide ({day}) dans : {raw!r}")
        if not (0 <= hour <= 23 and 0 <= minute <= 59 and 0 <= second <= 59):
            raise ValueError(f"Heure invalide dans : {raw!r}")

        try:
            dt = datetime(year, month, day, hour, minute, second)
        except ValueError as exc:
            raise ValueError(f"Date invalide : {raw!r} ({exc})")
        return dt, had_time

    def _resolve_dmy(
        self, tokens: List[str], month_from_name: Optional[int], day_first: bool, raw: str
    ) -> Tuple[int, int, int]:
        ints = [int(t) for t in tokens]

        if month_from_name is not None:
            # "27 fevrier 1970" -> reste 2 nombres : jour + annee.
            if len(ints) < 2:
                raise ValueError(f"Date incomplete : {raw!r}")
            year = self._pick_year(tokens, ints)
            others = [v for v, t in zip(ints, tokens) if not self._is_year_token(v, t, year)]
            if not others:
                raise ValueError(f"Jour manquant : {raw!r}")
            return others[0], month_from_name, year

        if len(ints) < 3:
            raise ValueError(f"Date incomplete : {raw!r}")

        # Format ISO : AAAA-MM-JJ (annee sur 4 chiffres en premier).
        if len(tokens[0]) == 4:
            return ints[2], ints[1], self._normalize_year(ints[0])

        # Sinon : (a, b, annee) avec a/b = jour/mois.
        year = self._pick_year(tokens, ints)
        first, secnd = ints[0], ints[1]
        if first > 12 and secnd <= 12:
            day, month = first, secnd
        elif secnd > 12 and first <= 12:
            day, month = secnd, first
        else:
            day, month = (first, secnd) if day_first else (secnd, first)
        return day, month, year

    def _pick_year(self, tokens: List[str], ints: List[int]) -> int:
        # Priorite au token 4 chiffres, sinon a une valeur > 31, sinon le dernier.
        for t, v in zip(tokens, ints):
            if len(t) == 4:
                return v
        for v in ints:
            if v > 31:
                return self._normalize_year(v)
        return self._normalize_year(ints[-1])

    def _is_year_token(self, value: int, token: str, year: int) -> bool:
        return self._normalize_year(value) == year and (len(token) == 4 or value > 31 or value == year)

    @staticmethod
    def _normalize_year(year: int) -> int:
        if year < 100:
            return year + 1900 if year >= 69 else year + 2000
        return year

    # ------------------------------------------------------------------ #
    # Utilitaires
    # ------------------------------------------------------------------ #
    @staticmethod
    def _strip_accents(text: str) -> str:
        nfkd = unicodedata.normalize("NFKD", text)
        return "".join(c for c in nfkd if not unicodedata.combining(c))

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
