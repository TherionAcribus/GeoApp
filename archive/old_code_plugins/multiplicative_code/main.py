import time
import re
import json
import os
import requests

# Import du service de scoring si disponible
try:
    from app.services.scoring_service import ScoringService
    scoring_service_available = True
    print("Module de scoring disponible")
except ImportError:
    scoring_service_available = False
    print("Module de scoring non disponible, utilisation du scoring legacy uniquement")

class MultiplicativeCodePlugin:
    """
    Plugin pour encoder/décoder du texte avec le chiffre multiplicatif.
    Formule : E(x) = (a * x) mod 26
    Modes :
      - encode
      - decode
      - bruteforce
    """

    def __init__(self):
        self.name = "multiplicative_code"
        self.description = "Plugin de chiffrement/déchiffrement utilisant le chiffre multiplicatif"
        self.alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
        self.alphabet_len = 26
        # Valeurs de 'a' possibles (premiers avec 26)
        self.possible_a = [1, 3, 5, 7, 9, 11, 15, 17, 19, 21, 23, 25]

        # Charger la configuration pour savoir si le scoring est activé par défaut
        plugin_config_path = os.path.join(os.path.dirname(__file__), 'plugin.json')
        try:
            with open(plugin_config_path, 'r', encoding='utf-8') as f:
                config = json.load(f)
                self.enable_scoring_default = config.get('enable_scoring', False)
        except (FileNotFoundError, json.JSONDecodeError):
            self.enable_scoring_default = False

        # Initialisation du service de scoring local si disponible
        self.scoring_service = None
        if scoring_service_available:
            try:
                self.scoring_service = ScoringService()
            except Exception as e:
                print(f"Erreur d'initialisation du service de scoring : {str(e)}")

        # URL du fallback de scoring
        self.scoring_api_url = "http://localhost:5000/api/plugins/score"

    # ---------------------------------------------------------------------
    # Fonctions utilitaires internes
    # ---------------------------------------------------------------------
    def _char_to_num(self, char: str) -> int:
        return self.alphabet.index(char.upper())

    def _num_to_char(self, num: int) -> str:
        return self.alphabet[num % self.alphabet_len]

    def _mod_inverse(self, a: int, m: int = 26) -> int:
        """Inverse modulaire de a (si gcd(a, m) == 1)"""
        a = a % m
        for x in range(1, m):
            if (a * x) % m == 1:
                return x
        raise ValueError(f"Aucun inverse modulaire pour a={a} mod {m}")

    # ---------------------------------------------------------------------
    # Méthodes de chiffrement / déchiffrement
    # ---------------------------------------------------------------------
    def encode(self, text: str, a: int) -> str:
        result = []
        for char in text.upper():
            if char in self.alphabet:
                x = self._char_to_num(char)
                encoded_num = (a * x) % self.alphabet_len
                result.append(self._num_to_char(encoded_num))
            else:
                result.append(char)
        return ''.join(result)

    def decode(self, text: str, a: int) -> str:
        a_inv = self._mod_inverse(a, self.alphabet_len)
        result = []
        for char in text.upper():
            if char in self.alphabet:
                y = self._char_to_num(char)
                decoded_num = (a_inv * y) % self.alphabet_len
                result.append(self._num_to_char(decoded_num))
            else:
                result.append(char)
        return ''.join(result)

    def bruteforce(self, text: str):
        solutions = []
        for a_candidate in self.possible_a:
            decoded_text = self.decode(text, a_candidate)
            solutions.append({
                "a": a_candidate,
                "decoded_text": decoded_text
            })
        return solutions

    # ---------------------------------------------------------------------
    # Outils de scoring et confiance
    # ---------------------------------------------------------------------
    def _calculate_confidence(self, a: int, text: str) -> float:
        """Confiance legacy si le service de scoring n'est pas disponible"""
        # Plus a est petit, plus on met une confiance légère
        base = 0.7 if a in (1, 3, 5) else 0.6
        penalty = 0.01 * (a % 26)
        return max(0.3, base - penalty)

    def _clean_text_for_scoring(self, text: str) -> str:
        text = re.sub(r'[^\w\s]', '', text)
        text = re.sub(r'\s+', ' ', text).strip()
        return text

    def _get_text_score(self, text: str, context=None):
        cleaned_text = self._clean_text_for_scoring(text)
        data = {"text": cleaned_text}
        if context:
            data["context"] = context

        if self.scoring_service:
            try:
                return self.scoring_service.score_text(cleaned_text, context)
            except Exception as e:
                print(f"Erreur du scoring local : {str(e)}")
                return None
        else:
            try:
                response = requests.post(self.scoring_api_url, json=data)
                if response.status_code == 200:
                    result = response.json()
                    if result.get("success"):
                        return result.get("result", {})
                return None
            except Exception as e:
                print(f"Erreur API scoring : {str(e)}")
                return None

    # ---------------------------------------------------------------------
    # Exécution principale du plugin
    # ---------------------------------------------------------------------
    def execute(self, inputs):
        start_time = time.time()

        standardized_response = {
            "status": "success",
            "plugin_info": {
                "name": self.name,
                "version": "1.0.0",
                "execution_time": 0
            },
            "inputs": inputs.copy(),
            "results": [],
            "summary": {
                "best_result_id": None,
                "total_results": 0,
                "message": ""
            }
        }

        text = inputs.get('text', '')
        mode = inputs.get('mode', 'encode')
        bruteforce_flag = inputs.get('bruteforce', False) or inputs.get('brute_force', False) or mode == 'bruteforce'

        # Activation scoring : utilise soit la valeur transmise soit la valeur par défaut
        enable_scoring = inputs.get('enable_scoring', self.enable_scoring_default)
        context = inputs.get('context', {})

        if not text:
            standardized_response["status"] = "error"
            standardized_response["summary"]["message"] = "Aucun texte fourni."
            return standardized_response

        try:
            a = int(inputs.get('a', 1))
            if a not in self.possible_a:
                raise ValueError("Le coefficient a doit être premier avec 26 (1,3,5,7,9,11,15,17,19,21,23,25)")

            # ------------------------------------------------------------
            # Mode bruteforce
            # ------------------------------------------------------------
            if bruteforce_flag:
                solutions = self.bruteforce(text)
                for idx, sol in enumerate(solutions, 1):
                    a_val = sol['a']
                    decoded_text = sol['decoded_text']

                    if enable_scoring:
                        score_result = self._get_text_score(decoded_text, context)
                        confidence = score_result.get('score', 0.5) if score_result else self._calculate_confidence(a_val, decoded_text)
                    else:
                        confidence = self._calculate_confidence(a_val, decoded_text)
                        score_result = None

                    result_entry = {
                        "id": f"result_{idx}",
                        "text_output": decoded_text,
                        "confidence": confidence,
                        "parameters": {
                            "mode": "decode",
                            "a": a_val
                        },
                        "metadata": {
                            "bruteforce_position": idx,
                            "processed_chars": sum(1 for c in text.upper() if c in self.alphabet)
                        }
                    }
                    if score_result:
                        result_entry["scoring"] = score_result

                    standardized_response["results"].append(result_entry)

                standardized_response["results"].sort(key=lambda x: x["confidence"], reverse=True)
                if standardized_response["results"]:
                    standardized_response["summary"]["best_result_id"] = standardized_response["results"][0]["id"]
                    standardized_response["summary"]["total_results"] = len(standardized_response["results"])
                    standardized_response["summary"]["message"] = f"Bruteforce multiplicatif : {len(self.possible_a)} clés testées"
                else:
                    standardized_response["status"] = "error"
                    standardized_response["summary"]["message"] = "Aucune solution trouvée."

            # ------------------------------------------------------------
            # Mode encode
            # ------------------------------------------------------------
            elif mode == 'encode':
                encoded = self.encode(text, a)
                standardized_response["results"].append({
                    "id": "result_1",
                    "text_output": encoded,
                    "confidence": 1.0,
                    "parameters": {
                        "mode": "encode",
                        "a": a
                    },
                    "metadata": {
                        "processed_chars": sum(1 for c in text.upper() if c in self.alphabet)
                    }
                })
                standardized_response["summary"]["best_result_id"] = "result_1"
                standardized_response["summary"]["total_results"] = 1
                standardized_response["summary"]["message"] = f"Encodage multiplicatif avec a={a} réussi"

            # ------------------------------------------------------------
            # Mode decode
            # ------------------------------------------------------------
            elif mode == 'decode':
                decoded = self.decode(text, a)
                if enable_scoring:
                    score_result = self._get_text_score(decoded, context)
                    confidence = score_result.get('score', 0.9) if score_result else 0.9
                else:
                    confidence = 0.9
                    score_result = None

                result_entry = {
                    "id": "result_1",
                    "text_output": decoded,
                    "confidence": confidence,
                    "parameters": {
                        "mode": "decode",
                        "a": a
                    },
                    "metadata": {
                        "processed_chars": sum(1 for c in text.upper() if c in self.alphabet)
                    }
                }
                if score_result:
                    result_entry["scoring"] = score_result

                standardized_response["results"].append(result_entry)
                standardized_response["summary"]["best_result_id"] = "result_1"
                standardized_response["summary"]["total_results"] = 1
                standardized_response["summary"]["message"] = f"Décodage multiplicatif avec a={a} réussi"

            # ------------------------------------------------------------
            else:
                standardized_response["status"] = "error"
                standardized_response["summary"]["message"] = f"Mode invalide : {mode}"

        except Exception as e:
            standardized_response["status"] = "error"
            standardized_response["summary"]["message"] = f"Erreur pendant le traitement : {str(e)}"
            import traceback
            print(traceback.format_exc())

        standardized_response["plugin_info"]["execution_time"] = int((time.time() - start_time) * 1000)
        return standardized_response

# Point d'entrée pour le PluginManager

def init():
    return MultiplicativeCodePlugin() 