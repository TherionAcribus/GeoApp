import json
import os
import re
import time
from typing import List

# Import éventuel du service de scoring (non utilisé ici, mais géré pour compatibilité)
try:
    from app.services.scoring_service import ScoringService  # type: ignore
    scoring_service_available = True
except ImportError:
    scoring_service_available = False


class ShadokNumbersPlugin:
    """Plugin d'encodage / décodage pour la numération Shadok.

    Les 4 syllabes shadoks représentent les chiffres en base 4 :
      GA -> 0
      BU -> 1
      ZO -> 2
      ME(U) -> 3

    Le plugin gère deux modes :
      - encode : nombre(s) décimal(aux) -> code shadok
      - decode : code shadok -> nombre(s) décimal(aux)
    """

    # Mappages de base (en majuscules)
    DIGIT_TO_SYLLABLE = {"0": "GA", "1": "BU", "2": "ZO", "3": "MEU"}
    # Plusieurs formes acceptées pour le chiffre 3
    SYLLABLE_TO_DIGIT = {
        "GA": "0",
        "BU": "1",
        "ZO": "2",
        "MEU": "3",
        "ME": "3",  # tolérance d'écriture sans U
    }

    def __init__(self):
        self.name = "shadok_numbers"
        self.description = "Numération Shadok (GA BU ZO MEU)"

        # Lecture de la config pour récupérer certains paramètres (ex. enable_scoring)
        config_path = os.path.join(os.path.dirname(__file__), "plugin.json")
        try:
            with open(config_path, "r", encoding="utf-8") as fp:
                cfg = json.load(fp)
                self.enable_scoring = cfg.get("enable_scoring", False)
        except Exception:
            self.enable_scoring = False

        # Initialisation éventuelle du service de scoring (non utilisé ici)
        self.scoring_service = None
        if scoring_service_available and self.enable_scoring:
            try:
                self.scoring_service = ScoringService()
            except Exception:
                self.scoring_service = None

    # ---------------------------------------------------------------------
    #  Fonctions de conversion internes
    # ---------------------------------------------------------------------
    @staticmethod
    def _decimal_to_base4(n: int) -> str:
        """Convertit un entier décimal en chaîne de chiffres base 4."""
        if n == 0:
            return "0"
        digits: List[str] = []
        while n > 0:
            digits.append(str(n % 4))
            n //= 4
        return "".join(reversed(digits))

    def _encode_number(self, number_str: str) -> str:
        """Encode une chaîne représentant un entier décimal en code Shadok."""
        # Nettoyage
        number_str = number_str.strip()
        if number_str == "":
            return ""
        try:
            n = int(number_str)
        except ValueError:
            raise ValueError(f"Valeur décimale invalide : {number_str}")
        if n < 0:
            raise ValueError("Les nombres négatifs ne sont pas supportés par la numération Shadok")

        base4 = self._decimal_to_base4(n)
        return "".join(self.DIGIT_TO_SYLLABLE[d] for d in base4)

    def _decode_token(self, token: str) -> str:
        """Décode un token Shadok (ex : MEUZOBUGA) -> valeur décimale en chaîne."""
        token = token.upper()
        index = 0
        digits: List[str] = []
        # Regex de détection des syllabes shadoks
        pattern = re.compile(r"GA|BU|ZO|MEU|ME", re.IGNORECASE)
        while index < len(token):
            match = pattern.match(token, index)
            if not match:
                raise ValueError(f"Séquence Shadok invalide autour de '{token[index:index+4]}'")
            syll = match.group(0).upper()
            digits.append(self.SYLLABLE_TO_DIGIT[syll])
            index = match.end()
        # Conversion base 4 -> décimal
        decimal_value = 0
        for d in digits:
            decimal_value = decimal_value * 4 + int(d)
        return str(decimal_value)

    # ------------------------------------------------------------------
    #  API principale du plugin
    # ------------------------------------------------------------------
    def encode(self, text: str) -> str:
        """Encode un ou plusieurs nombres décimaux vers le code Shadok."""
        # On accepte plusieurs nombres séparés par espace/virgule/point-virgule
        tokens = re.split(r"[\s,;]+", text.strip())
        encoded_tokens = [self._encode_number(tok) for tok in tokens if tok]
        return " ".join(encoded_tokens)

    def decode(self, text: str) -> str:
        """Décode une ou plusieurs séquences Shadok vers des nombres décimaux."""
        # On sépare les séquences : si l'utilisateur a mis des espaces, c'est simple.
        # Sinon on prend le texte entier comme un seul token.
        tokens = text.strip().split()
        if not tokens:
            # Aucun espace : prendre la chaîne complète
            tokens = [text.strip()]
        decoded_numbers = [self._decode_token(tok) for tok in tokens if tok]
        return " ".join(decoded_numbers)

    # Format standardisé – cf. docs/plugin_system.md
    def execute(self, inputs: dict):
        start_time = time.time()
        mode = inputs.get("mode", "encode").lower()
        text = inputs.get("text", "")

        if mode not in {"encode", "decode"}:
            return {
                "status": "error",
                "message": f"Mode inconnu : {mode} (attendu: encode|decode)",
            }

        try:
            if mode == "encode":
                result_text = self.encode(text)
                confidence = 1.0
                summary_msg = "Encodage Shadok réussi"
            else:
                result_text = self.decode(text)
                confidence = 0.95
                summary_msg = "Décodage Shadok réussi"
        except Exception as exc:
            return {
                "status": "error",
                "message": str(exc),
            }

        execution_time_ms = int((time.time() - start_time) * 1000)

        standardized_response = {
            "status": "success",
            "plugin_info": {
                "name": self.name,
                "version": "1.0.0",
                "execution_time": execution_time_ms,
            },
            "inputs": inputs.copy(),
            "results": [
                {
                    "id": "result_1",
                    "text_output": result_text,
                    "confidence": confidence,
                    "parameters": {"mode": mode},
                    "metadata": {"processed_chars": len(text)},
                }
            ],
            "summary": {
                "best_result_id": "result_1",
                "total_results": 1,
                "message": summary_msg,
            },
        }
        return standardized_response


# Point d'entrée attendu par le PluginManager

def init():
    return ShadokNumbersPlugin() 