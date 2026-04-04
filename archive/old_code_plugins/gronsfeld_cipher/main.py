import time
import string

# Import du service de scoring s'il est disponible
try:
    from app.services.scoring_service import ScoringService
    scoring_service_available = True
except ImportError:
    scoring_service_available = False
    print("Module de scoring non disponible, le plugin Gronsfeld fonctionnera sans scoring avancé")


class GronsfeldCipherPlugin:
    """Plugin pour encoder/décoder avec le chiffre de Gronsfeld (clé numérique)."""

    def __init__(self):
        self.name = "gronsfeld_cipher"
        self.scoring_service = None
        if scoring_service_available:
            try:
                self.scoring_service = ScoringService()
                print("Service de scoring initialisé pour Gronsfeld")
            except Exception as e:
                print(f"Erreur lors de l'initialisation du service de scoring : {str(e)}")

    # ------------------------------------------------------------------
    # Utilitaires clés
    # ------------------------------------------------------------------
    @staticmethod
    def _clean_key(key: str) -> str:
        """Conserve uniquement les chiffres 0-9."""
        return "".join([c for c in key if c.isdigit()])

    def _full_key(self, key: str, length: int) -> str:
        cleaned = self._clean_key(key)
        if not cleaned:
            raise ValueError("La clé doit contenir au moins un chiffre (0-9)")
        return (cleaned * (length // len(cleaned) + 1))[:length]

    # ------------------------------------------------------------------
    # Algorithme Gronsfeld
    # ------------------------------------------------------------------
    def encode(self, text: str, key: str) -> str:
        full_key = self._full_key(key, len(text))
        result = []
        key_index = 0
        for ch in text:
            if ch.upper() in string.ascii_uppercase:
                shift = int(full_key[key_index])
                encoded_char = chr((ord(ch.upper()) - ord('A') + shift) % 26 + ord('A'))
                if ch.islower():
                    encoded_char = encoded_char.lower()
                result.append(encoded_char)
                key_index += 1
            else:
                result.append(ch)
        return "".join(result)

    def decode(self, text: str, key: str) -> str:
        full_key = self._full_key(key, len(text))
        result = []
        key_index = 0
        for ch in text:
            if ch.upper() in string.ascii_uppercase:
                shift = int(full_key[key_index])
                decoded_char = chr((ord(ch.upper()) - ord('A') - shift) % 26 + ord('A'))
                if ch.islower():
                    decoded_char = decoded_char.lower()
                result.append(decoded_char)
                key_index += 1
            else:
                result.append(ch)
        return "".join(result)

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
    # Point d'entrée du plugin
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
                result = {
                    "id": "result_1",
                    "text_output": output_text,
                    "confidence": 1.0,
                    "parameters": {"mode": mode, "key": key},
                    "metadata": {"processed_chars": len(text)}
                }
                response["results"].append(result)
                response["summary"].update({
                    "best_result_id": "result_1",
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
                result = {
                    "id": "result_1",
                    "text_output": output_text,
                    "confidence": confidence,
                    "parameters": {"mode": mode, "key": key},
                    "metadata": {"processed_chars": len(text)}
                }
                if scoring_result:
                    result["scoring"] = scoring_result
                response["results"].append(result)
                response["summary"].update({
                    "best_result_id": "result_1",
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


if __name__ == "__main__":
    plugin = GronsfeldCipherPlugin()
    print(plugin.execute({
        "mode": "encode",
        "text": "BONJOUR LE MONDE",
        "key": "1234"
    })) 