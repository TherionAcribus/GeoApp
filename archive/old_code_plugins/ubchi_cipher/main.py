import os
import json
import math
import time
import re
import itertools
import random
import requests

try:
    from app.services.scoring_service import ScoringService
    scoring_service_available = True
except ImportError:
    scoring_service_available = False


class UbchiCipherPlugin:
    """Plugin MysteryAI – chiffre Ubchi (double transposition avec lettres nulles)"""

    def __init__(self):
        self.name = "ubchi_cipher"
        self.description = "Plugin de chiffrement/déchiffrement Ubchi (double transposition)"

        # Charger la configuration pour savoir si le scoring est activé
        cfg_path = os.path.join(os.path.dirname(__file__), "plugin.json")
        try:
            with open(cfg_path, "r", encoding="utf-8") as fp:
                cfg = json.load(fp)
                self.enable_scoring = cfg.get("enable_scoring", False)
        except Exception:
            self.enable_scoring = False

        # Service de scoring local
        self.scoring_service = None
        if scoring_service_available and self.enable_scoring:
            try:
                self.scoring_service = ScoringService()
            except Exception:
                self.scoring_service = None

        self.scoring_api_url = "http://localhost:5000/api/plugins/score"

    # ------------------------------------------------------------------
    #  Outils internes – colonne simple
    # ------------------------------------------------------------------
    @staticmethod
    def _col_order(keyword: str):
        """Renvoie l'ordre des colonnes en fonction du mot-clé (tri alphabétique, stable)."""
        keyword = keyword.upper()
        enumerated = list(enumerate(keyword))
        # Tri stable par lettre puis index initial
        sorted_cols = sorted(enumerated, key=lambda x: (x[1], x[0]))
        order = [idx for idx, _ in sorted_cols]
        return order

    def _columnar_transpose(self, text: str, keyword: str) -> str:
        """Une colonne transposition (écriture ligne, lecture colonne selon ordre)."""
        kw_len = len(keyword)
        order = self._col_order(keyword)
        rows = math.ceil(len(text) / kw_len)
        # Compléter par X si besoin (pour première transposition, Ubchi ajoute des nulles plus tard)
        padded_text = text.ljust(rows * kw_len)
        grid = [padded_text[i:i + kw_len] for i in range(0, len(padded_text), kw_len)]
        # Lecture par colonnes dans l'ordre défini
        cipher = "".join("".join(row[col] for row in grid) for col in order)
        return cipher.rstrip()

    def _columnar_transpose_inverse(self, cipher: str, keyword: str) -> str:
        kw_len = len(keyword)
        order = self._col_order(keyword)
        rows = math.ceil(len(cipher) / kw_len)
        # Taille de chaque colonne (certaines plus courtes)
        full_columns = len(cipher) % kw_len
        if full_columns == 0:
            full_columns = kw_len
        col_lengths = [rows if i < full_columns else rows - 1 for i in range(kw_len)]
        # Créer dict col -> segment
        segments = {}
        idx = 0
        for pos, col in enumerate(order):
            length = col_lengths[col]
            segments[col] = cipher[idx: idx + length]
            idx += length
        # Reconstruire la grille
        plaintext_chars = []
        for r in range(rows):
            for c in range(kw_len):
                segment = segments.get(c, "")
                if r < len(segment):
                    plaintext_chars.append(segment[r])
        return "".join(plaintext_chars).rstrip()

    # ------------------------------------------------------------------
    #  Algorithmes Ubchi
    # ------------------------------------------------------------------
    def encode(self, text: str, keyword: str, null_letters: int = 1) -> str:
        text = text.replace(" ", "").upper()
        inter = self._columnar_transpose(text, keyword)
        # ajouter lettres nulles aléatoires (X)
        nulls = ''.join(random.choice('ABCDEFGHIJKLMNOPQRSTUVWXYZ') for _ in range(null_letters))
        inter2 = inter + nulls
        final = self._columnar_transpose(inter2, keyword)
        return final

    def decode(self, cipher: str, keyword: str, null_letters: int = 1) -> str:
        step1 = self._columnar_transpose_inverse(cipher, keyword)
        # retirer null_letters à la fin
        if null_letters:
            step1 = step1[:-null_letters] if len(step1) >= null_letters else ""
        plaintext = self._columnar_transpose_inverse(step1, keyword)
        return plaintext

    # ------------------------------------------------------------------
    #  Bruteforce (clé de longueur <= 6, lettres distinctes) – expérimental
    # ------------------------------------------------------------------
    def bruteforce(self, cipher: str, max_key_length: int = 6, null_letters: int = 1):
        results = []
        alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
        for key_len in range(3, max_key_length + 1):
            # Essayer quelques permutations aléatoires d'alphabet de cette taille (limitation pour performance)
            sampled_keywords = random.sample(list(itertools.permutations(alphabet, key_len)), k=min(500, math.factorial(key_len)))
            for tup in sampled_keywords:
                keyword = ''.join(tup)
                decoded = self.decode(cipher, keyword, null_letters)
                results.append({"keyword": keyword, "decoded_text": decoded})
        return results

    # ------------------------------------------------------------------
    #  Scoring utilitaires
    # ------------------------------------------------------------------
    @staticmethod
    def _clean_text(text):
        text = re.sub(r"[^A-Z]", "", text.upper())
        return text

    def _get_score(self, text):
        if not self.scoring_service:
            return None
        try:
            return self.scoring_service.score_text(text)
        except Exception:
            return None

    # ------------------------------------------------------------------
    #  Execute
    # ------------------------------------------------------------------
    def execute(self, inputs: dict):
        start = time.time()
        text = inputs.get("text", "")
        if not text:
            return {
                "status": "error",
                "plugin_info": {"name": self.name, "version": "1.0.0", "execution_time": 0},
                "summary": {"message": "Aucun texte fourni", "total_results": 0}
            }

        mode = inputs.get("mode", "decode").lower()
        keyword = inputs.get("keyword", "UBER")
        null_letters = int(inputs.get("null_letters", 1))
        enable_scoring_flag = inputs.get("enable_scoring", "") == "on" and self.enable_scoring

        response = {
            "status": "success",
            "plugin_info": {"name": self.name, "version": "1.0.0", "execution_time": 0},
            "inputs": inputs.copy(),
            "results": [],
            "summary": {"best_result_id": None, "total_results": 0, "message": ""}
        }

        if mode == "encode":
            cipher = self.encode(text, keyword, null_letters)
            res = {
                "id": "result_1",
                "text_output": cipher,
                "confidence": 1.0,
                "parameters": {"mode": mode, "keyword": keyword, "null_letters": null_letters},
                "metadata": {"processed_chars": len(text)}
            }
            response["results"].append(res)
            response["summary"].update({"best_result_id": "result_1", "total_results": 1, "message": "Encodage réussi"})

        elif mode == "decode":
            plaintext = self.decode(text, keyword, null_letters)
            confidence = 0.5
            score_info = None
            if enable_scoring_flag:
                score_info = self._get_score(plaintext)
                if score_info:
                    confidence = score_info.get("score", confidence)
            res = {
                "id": "result_1",
                "text_output": plaintext,
                "confidence": confidence,
                "parameters": {"mode": mode, "keyword": keyword, "null_letters": null_letters},
                "metadata": {"processed_chars": len(text)}
            }
            if score_info:
                res["scoring"] = score_info
            response["results"].append(res)
            response["summary"].update({"best_result_id": "result_1", "total_results": 1, "message": "Décodage réussi"})

        elif mode == "bruteforce":
            results = []
            solutions = self.bruteforce(text, max_key_length=5, null_letters=null_letters)
            for idx, sol in enumerate(solutions, 1):
                conf = 0.3
                if enable_scoring_flag:
                    s = self._get_score(sol["decoded_text"])
                    if s:
                        conf = s.get("score", conf)
                results.append({
                    "id": f"result_{idx}",
                    "text_output": sol["decoded_text"],
                    "confidence": conf,
                    "parameters": {"mode": mode, "keyword": sol["keyword"], "null_letters": null_letters}
                })
            results.sort(key=lambda r: r.get("confidence", 0), reverse=True)
            response["results"] = results
            response["bruteforce_solutions"] = solutions
            response["summary"].update({"best_result_id": results[0]["id"] if results else None, "total_results": len(results), "message": f"{len(results)} solutions générées"})
        else:
            response["status"] = "error"
            response["summary"].update({"message": f"Mode inconnu: {mode}", "total_results": 0})

        response["plugin_info"]["execution_time"] = int((time.time() - start) * 1000)
        return response


class UbchiCipher(UbchiCipherPlugin):
    """Alias pour le PluginManager"""
    pass 