import time
import string

# Import du service de scoring s'il est disponible
try:
    from app.services.scoring_service import ScoringService
    scoring_service_available = True
except ImportError:
    scoring_service_available = False
    print("Module de scoring non disponible, le plugin fonctionnera sans évaluation de confiance avancée")


class VigenereCipherPlugin:
    """Plugin pour encoder et décoder du texte avec le chiffre de Vigenère."""

    def __init__(self):
        self.name = "vigenere_cipher"
        self.scoring_service = None

        if scoring_service_available:
            try:
                self.scoring_service = ScoringService()
                print("Service de scoring initialisé")
            except Exception as e:
                print(f"Erreur lors de l'initialisation du service de scoring : {str(e)}")

    # ---------------------------------------------------------------------
    # Algorithme Vigenère de base
    # ---------------------------------------------------------------------
    @staticmethod
    def _clean_key(key: str) -> str:
        """Ne garde que les lettres A-Z et convertit la clé en majuscules."""
        return "".join([c for c in key.upper() if c in string.ascii_uppercase])

    def _full_key(self, key: str, length: int) -> str:
        """Répète la clé nettoyée afin qu'elle couvre toute la longueur du texte."""
        cleaned = self._clean_key(key)
        if not cleaned:
            raise ValueError("La clé doit contenir au moins une lettre A-Z")
        return (cleaned * (length // len(cleaned) + 1))[:length]

    def encode(self, text: str, key: str) -> str:
        """Encode le texte avec la clé donnée."""
        full_key = self._full_key(key, len(text))
        result = []
        key_index = 0

        for ch in text:
            if ch.upper() in string.ascii_uppercase:
                shift = ord(full_key[key_index]) - ord("A")
                encoded_char = chr((ord(ch.upper()) - ord("A") + shift) % 26 + ord("A"))
                # Préserver la casse d'origine
                if ch.islower():
                    encoded_char = encoded_char.lower()
                result.append(encoded_char)
                key_index += 1
            else:
                result.append(ch)
        return "".join(result)

    def decode(self, text: str, key: str) -> str:
        """Décode le texte avec la clé donnée."""
        full_key = self._full_key(key, len(text))
        result = []
        key_index = 0

        for ch in text:
            if ch.upper() in string.ascii_uppercase:
                shift = ord(full_key[key_index]) - ord("A")
                decoded_char = chr((ord(ch.upper()) - ord("A") - shift) % 26 + ord("A"))
                if ch.islower():
                    decoded_char = decoded_char.lower()
                result.append(decoded_char)
                key_index += 1
            else:
                result.append(ch)
        return "".join(result)

    # ---------------------------------------------------------------------
    # Scoring utilitaire (optionnel)
    # ---------------------------------------------------------------------
    def get_text_score(self, text: str, context=None):
        """Retourne le score lexical du texte via le service de scoring (si dispo)."""
        if not self.scoring_service:
            return None
        try:
            return self.scoring_service.score_text(text, context)
        except Exception as e:
            print(f"Erreur lors du scoring : {str(e)}")
            return None

    # ---------------------------------------------------------------------
    # Point d'entrée standardisé du plugin
    # ---------------------------------------------------------------------
    def execute(self, inputs: dict) -> dict:
        start_time = time.time()

        mode = inputs.get("mode", "decode").lower()
        text = inputs.get("text", "")
        key = inputs.get("key", "")
        # Gestion du scoring activé par l'IU (checkbox "enable_scoring")
        enable_scoring = inputs.get("enable_scoring", "") == "on"

        # Réponse standardisée selon la spécification MysteryAI
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
                encoded = self.encode(text, key)
                result = {
                    "id": "result_1",
                    "text_output": encoded,
                    "confidence": 1.0,  # Confiance maximale pour l'encodage
                    "parameters": {
                        "mode": mode,
                        "key": key
                    },
                    "metadata": {
                        "processed_chars": len(text)
                    }
                }
                response["results"].append(result)
                response["summary"].update({
                    "best_result_id": "result_1",
                    "total_results": 1,
                    "message": "Encodage réussi"
                })

            elif mode == "decode":
                decoded = self.decode(text, key)
                confidence = 0.5
                scoring_result = None

                if enable_scoring and self.scoring_service:
                    scoring_result = self.get_text_score(decoded, inputs.get("context", {}))
                    if scoring_result:
                        confidence = scoring_result.get("score", 0.5)

                result = {
                    "id": "result_1",
                    "text_output": decoded,
                    "confidence": confidence,
                    "parameters": {
                        "mode": mode,
                        "key": key
                    },
                    "metadata": {
                        "processed_chars": len(text)
                    }
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

        # Mettre à jour le temps d'exécution
        response["plugin_info"]["execution_time"] = int((time.time() - start_time) * 1000)
        return response


# -------------------------------------------------------------------------
# Exécution directe pour les tests rapides
# -------------------------------------------------------------------------
if __name__ == "__main__":
    plugin = VigenereCipherPlugin()
    sample_inputs = {
        "mode": "encode",
        "text": "Bonjour le monde",
        "key": "CLEF"
    }
    print(plugin.execute(sample_inputs)) 