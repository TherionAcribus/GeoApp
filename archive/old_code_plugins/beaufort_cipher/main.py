import time
import string

# Import du service de scoring si disponible
try:
    from app.services.scoring_service import ScoringService
    scoring_service_available = True
except ImportError:
    scoring_service_available = False
    print("Module de scoring non disponible, le plugin Beaufort fonctionnera sans scoring avancé")


class BeaufortCipherPlugin:
    """Plugin pour le chiffre de Beaufort (symétrique)."""

    def __init__(self):
        self.name = "beaufort_cipher"
        self.scoring_service = None
        if scoring_service_available:
            try:
                self.scoring_service = ScoringService()
                print("Service de scoring initialisé pour Beaufort")
            except Exception as e:
                print(f"Erreur lors de l'initialisation du service de scoring : {str(e)}")

    # ------------------------------------------------------------------
    # Algorithme Beaufort
    # ------------------------------------------------------------------
    @staticmethod
    def _clean_key(key: str) -> str:
        """Nettoie la clé pour ne conserver que les lettres A-Z en majuscules."""
        return "".join([c for c in key.upper() if c in string.ascii_uppercase])

    def _full_key(self, key: str, length: int) -> str:
        cleaned = self._clean_key(key)
        if not cleaned:
            raise ValueError("La clé doit contenir au moins une lettre parmi A-Z")
        return (cleaned * (length // len(cleaned) + 1))[:length]

    def _beaufort_transform(self, text: str, key: str) -> str:
        """Applique la transformation Beaufort (identique pour encode/decode)."""
        full_key = self._full_key(key, len(text))
        result = []
        key_index = 0

        for ch in text:
            if ch.upper() in string.ascii_uppercase:
                k_val = ord(full_key[key_index]) - ord('A')
                t_val = ord(ch.upper()) - ord('A')
                c_val = (k_val - t_val) % 26
                transformed_char = chr(c_val + ord('A'))
                if ch.islower():
                    transformed_char = transformed_char.lower()
                result.append(transformed_char)
                key_index += 1
            else:
                # Non-letter characters are left unchanged
                result.append(ch)
        return "".join(result)

    # Encodage = même fonction
    def encode(self, text: str, key: str) -> str:
        return self._beaufort_transform(text, key)

    # Décodage = même fonction (chiffre auto-réciproque)
    def decode(self, text: str, key: str) -> str:
        return self._beaufort_transform(text, key)

    # ------------------------------------------------------------------
    # Scoring optionnel
    # ------------------------------------------------------------------
    def get_text_score(self, text: str, context=None):
        if not self.scoring_service:
            return None
        try:
            return self.scoring_service.score_text(text, context)
        except Exception as e:
            print(f"Erreur lors du scoring : {str(e)}")
            return None

    # ------------------------------------------------------------------
    # Point d'entrée standardisé
    # ------------------------------------------------------------------
    def execute(self, inputs: dict) -> dict:
        start_time = time.time()

        mode = inputs.get("mode", "decode").lower()
        text = inputs.get("text", "")
        key = inputs.get("key", "")
        enable_scoring = inputs.get("enable_scoring", "") == "on"

        response = {
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

        try:
            if mode == "encode":
                output_text = self.encode(text, key)
                confidence = 1.0
                result_id = "result_1"
                response["results"].append({
                    "id": result_id,
                    "text_output": output_text,
                    "confidence": confidence,
                    "parameters": {"mode": mode, "key": key},
                    "metadata": {"processed_chars": len(text)}
                })
                response["summary"].update({
                    "best_result_id": result_id,
                    "total_results": 1,
                    "message": "Encodage réussi"
                })

            elif mode == "decode":
                output_text = self.decode(text, key)
                confidence = 0.5
                scoring_result = None
                if enable_scoring and self.scoring_service:
                    scoring_result = self.get_text_score(output_text, inputs.get("context", {}))
                    if scoring_result:
                        confidence = scoring_result.get("score", 0.5)

                result_id = "result_1"
                result_dict = {
                    "id": result_id,
                    "text_output": output_text,
                    "confidence": confidence,
                    "parameters": {"mode": mode, "key": key},
                    "metadata": {"processed_chars": len(text)}
                }
                if scoring_result:
                    result_dict["scoring"] = scoring_result

                response["results"].append(result_dict)
                response["summary"].update({
                    "best_result_id": result_id,
                    "total_results": 1,
                    "message": "Décodage réussi"
                })
            else:
                response["status"] = "error"
                response["summary"]["message"] = f"Mode '{mode}' non pris en charge."
        except Exception as e:
            response["status"] = "error"
            response["summary"]["message"] = str(e)

        response["plugin_info"]["execution_time"] = int((time.time() - start_time) * 1000)
        return response


# ------------------------------------------------------------------
# Test rapide en exécution directe
# ------------------------------------------------------------------
if __name__ == "__main__":
    plugin = BeaufortCipherPlugin()
    print(plugin.execute({
        "mode": "encode",
        "text": "BONJOUR LE MONDE",
        "key": "CLEF"
    })) 