import os
import json
import time
import re
import requests

# Import du service de scoring s'il est disponible dans l'application
try:
    from app.services.scoring_service import ScoringService
    scoring_service_available = True
except ImportError:
    scoring_service_available = False


class RailFenceCipherPlugin:
    """
    Plugin MysteryAI pour le chiffre Rail Fence (zigzag).
    Trois modes supportés :
      - encode       : chiffrer un texte avec un nombre de rails donné
      - decode       : déchiffrer un texte avec un nombre de rails donné
      - bruteforce   : essayer plusieurs clés possibles (2..max_key)
    """

    def __init__(self):
        self.name = "rail_fence_cipher"
        self.description = "Plugin de chiffrement/déchiffrement Rail Fence (zigzag)"

        # Charger la configuration du plugin.json afin de récupérer les options globales
        plugin_config_path = os.path.join(os.path.dirname(__file__), "plugin.json")
        try:
            with open(plugin_config_path, "r", encoding="utf-8") as fp:
                config = json.load(fp)
                self.enable_scoring = config.get("enable_scoring", False)
        except Exception:
            self.enable_scoring = False  # Valeur par défaut si le fichier est absent

        # Initialiser le service de scoring local si possible
        self.scoring_service = None
        if scoring_service_available and self.enable_scoring:
            try:
                self.scoring_service = ScoringService()
            except Exception:
                self.scoring_service = None

        # URL API distante (fallback) pour le scoring
        self.scoring_api_url = "http://localhost:5000/api/plugins/score"

    # ------------------------------------------------------------------
    #  Algorithmes Rail Fence avec paramètre de direction
    # ------------------------------------------------------------------
    @staticmethod
    def _rail_pattern(length: int, key: int, from_top: bool = True):
        """Renvoie la liste des index de rail pour chaque caractère."""
        pattern = []
        if key <= 1:
            return [0] * length
        row = 0 if from_top else key - 1
        direction = 1 if from_top else -1  # 1 = vers le bas, -1 = vers le haut
        for _ in range(length):
            pattern.append(row)
            # changer de direction aux extrémités
            if row == 0:
                direction = 1
            elif row == key - 1:
                direction = -1
            row += direction
        return pattern

    @classmethod
    def _encode_rail_fence(cls, text: str, key: int, from_top: bool = True) -> str:
        if key <= 1:
            return text
        pattern = cls._rail_pattern(len(text), key, from_top)
        rails = ["" for _ in range(key)]
        for ch, row in zip(text, pattern):
            rails[row] += ch
        return "".join(rails)

    @classmethod
    def _decode_rail_fence(cls, cipher: str, key: int, from_top: bool = True) -> str:
        if key <= 1:
            return cipher
        length = len(cipher)
        pattern = cls._rail_pattern(length, key, from_top)
        # Déterminer combien de caractères dans chaque rail
        rail_counts = [pattern.count(r) for r in range(key)]
        # Extraire les segments du cipher pour chaque rail
        rails = []
        idx = 0
        for count in rail_counts:
            rails.append(cipher[idx:idx + count])
            idx += count
        # Reconstruire le texte original
        rail_positions = [0] * key
        plaintext_chars = []
        for row in pattern:
            plaintext_chars.append(rails[row][rail_positions[row]])
            rail_positions[row] += 1
        return "".join(plaintext_chars)

    # ------------------------------------------------------------------
    #  Méthodes utilitaires pour le scoring
    # ------------------------------------------------------------------
    @staticmethod
    def _clean_text_for_scoring(text: str) -> str:
        text = re.sub(r"[^\w\s]", "", text)
        text = re.sub(r"\s+", " ", text).strip()
        return text

    def _get_text_score(self, text: str, context=None):
        cleaned_text = self._clean_text_for_scoring(text)
        data = {"text": cleaned_text}
        if context:
            data["context"] = context

        # Service local prioritaire
        if self.scoring_service is not None:
            try:
                return self.scoring_service.score_text(cleaned_text, context)
            except Exception:
                return None
        # Fallback API
        try:
            response = requests.post(self.scoring_api_url, json=data, timeout=3)
            if response.status_code == 200:
                payload = response.json()
                if payload.get("success"):
                    return payload.get("result", {})
        except Exception:
            pass
        return None

    # ------------------------------------------------------------------
    #  Méthodes principales encode / decode / bruteforce
    # ------------------------------------------------------------------
    def encode(self, text: str, key: int, from_top: bool = True) -> str:
        return self._encode_rail_fence(text, key, from_top)

    def decode(self, text: str, key: int, from_top: bool = True) -> str:
        return self._decode_rail_fence(text, key, from_top)

    def bruteforce(self, text: str, max_key: int = None):
        if max_key is None:
            max_key = min(20, max(2, len(text) // 2))
        solutions = []
        for k in range(2, max_key + 1):
            decoded = self.decode(text, k)
            solutions.append({"key": k, "decoded_text": decoded})
        return solutions

    # ------------------------------------------------------------------
    #  Calcul de la confiance (heuristique simple)
    # ------------------------------------------------------------------
    def _confidence_for_key(self, key: int) -> float:
        # On suppose que des petites clés (2-5) sont plus probables
        if key <= 3:
            return 0.8
        if key <= 6:
            return 0.6
        return 0.4

    # ------------------------------------------------------------------
    #  Méthode execute (interface MysteryAI)
    # ------------------------------------------------------------------
    def execute(self, inputs: dict):
        start_time = time.time()
        text = inputs.get("text", "")
        if not text:
            return {
                "status": "error",
                "plugin_info": {"name": self.name, "version": "1.0.0", "execution_time": 0},
                "summary": {"message": "Aucun texte fourni", "total_results": 0}
            }

        mode = inputs.get("mode", "decode").lower()
        key = int(inputs.get("key", 3))
        start_direction = inputs.get("start_direction", "top").lower()
        from_top = start_direction != "bottom"
        # Checkbox enable_scoring (valeur "on")
        checkbox_val = inputs.get("enable_scoring", "")
        enable_scoring = checkbox_val == "on" and self.enable_scoring

        # Détection d'un éventuel bruteforce demandé par les flags alternatifs
        brute_force_flag = False
        for flag in ("bruteforce", "brute_force", "enable_bruteforce"):
            val = inputs.get(flag, False)
            if isinstance(val, bool):
                brute_force_flag = brute_force_flag or val
            else:
                brute_force_flag = brute_force_flag or str(val).lower() in ("true", "on", "1")

        standardized_response = {
            "status": "success",
            "plugin_info": {"name": self.name, "version": "1.0.0", "execution_time": 0},
            "inputs": inputs.copy(),
            "results": [],
            "summary": {"best_result_id": None, "total_results": 0, "message": ""}
        }

        # ---------------------- ENCODE ----------------------------
        if mode == "encode":
            cipher_text = self.encode(text, key, from_top)
            result_obj = {
                "id": "result_1",
                "text_output": cipher_text,
                "confidence": 1.0,
                "parameters": {"mode": mode, "key": key, "start_direction": start_direction},
                "metadata": {"processed_chars": len(text)}
            }
            standardized_response["results"].append(result_obj)
            standardized_response["summary"].update({
                "best_result_id": "result_1",
                "total_results": 1,
                "message": "Encodage réussi"
            })

        # ---------------------- DECODE ----------------------------
        elif mode == "decode":
            if brute_force_flag:
                # Utiliser le même comportement que le mode bruteforce
                max_key = int(inputs.get("max_key", 10))
                solutions = self.bruteforce(text, max_key)
                results = []
                for idx, sol in enumerate(solutions, start=1):
                    conf = self._confidence_for_key(sol["key"])
                    scoring_info = None
                    if enable_scoring:
                        scoring_info = self._get_text_score(sol["decoded_text"])
                        if scoring_info:
                            conf = scoring_info.get("score", conf)
                    res = {
                        "id": f"result_{idx}",
                        "text_output": sol["decoded_text"],
                        "confidence": conf,
                        "parameters": {"mode": "decode", "key": sol["key"], "start_direction": start_direction, "bruteforce": True}
                    }
                    if scoring_info:
                        res["scoring"] = scoring_info
                    results.append(res)
                results.sort(key=lambda r: r.get("confidence", 0), reverse=True)
                standardized_response["results"] = results
                standardized_response["summary"].update({
                    "best_result_id": results[0]["id"] if results else None,
                    "total_results": len(results),
                    "message": f"{len(results)} clés testées (decode bruteforce)"
                })
                standardized_response["bruteforce_solutions"] = solutions
            else:
                decoded_text = self.decode(text, key, from_top)
                confidence = self._confidence_for_key(key)
                scoring_info = None
                if enable_scoring:
                    scoring_info = self._get_text_score(decoded_text)
                    if scoring_info:
                        confidence = scoring_info.get("score", confidence)
                result_obj = {
                    "id": "result_1",
                    "text_output": decoded_text,
                    "confidence": confidence,
                    "parameters": {"mode": mode, "key": key, "start_direction": start_direction},
                    "metadata": {"processed_chars": len(text)}
                }
                if scoring_info:
                    result_obj["scoring"] = scoring_info

                standardized_response["results"].append(result_obj)
                standardized_response["summary"].update({
                    "best_result_id": "result_1",
                    "total_results": 1,
                    "message": "Décodage réussi"
                })

        # ---------------------- BRUTEFORCE ------------------------
        elif mode == "bruteforce":
            max_key = int(inputs.get("max_key", 10))
            solutions = self.bruteforce(text, max_key)
            # calculer confidence & scoring
            results = []
            for idx, sol in enumerate(solutions, start=1):
                conf = self._confidence_for_key(sol["key"])
                scoring_info = None
                if enable_scoring:
                    scoring_info = self._get_text_score(sol["decoded_text"])
                    if scoring_info:
                        conf = scoring_info.get("score", conf)
                res = {
                    "id": f"result_{idx}",
                    "text_output": sol["decoded_text"],
                    "confidence": conf,
                    "parameters": {"mode": mode, "key": sol["key"], "start_direction": start_direction}
                }
                if scoring_info:
                    res["scoring"] = scoring_info
                results.append(res)
            # Trier par confiance
            results.sort(key=lambda r: r.get("confidence", 0), reverse=True)
            standardized_response["results"] = results
            best_id = results[0]["id"] if results else None
            standardized_response["summary"].update({
                "best_result_id": best_id,
                "total_results": len(results),
                "message": f"{len(results)} clés testées"
            })
            # Pour compatibilité UI : liste brute des solutions
            standardized_response["bruteforce_solutions"] = solutions
        else:
            standardized_response["status"] = "error"
            standardized_response["summary"].update({
                "message": f"Mode non reconnu : {mode}",
                "total_results": 0
            })

        exec_time_ms = int((time.time() - start_time) * 1000)
        standardized_response["plugin_info"]["execution_time"] = exec_time_ms
        return standardized_response

# Alias attendu par le PluginManager
class RailFenceCipher(RailFenceCipherPlugin):
    pass 