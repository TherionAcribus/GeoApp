import re
import time
import requests
import json
import os
from loguru import logger

# Import du service de scoring (exactement comme dans caesar_code)
try:
    from app.services.scoring_service import ScoringService
    scoring_service_available = True
    print("Module de scoring disponible")
except ImportError:
    scoring_service_available = False
    print("Module de scoring non disponible, utilisation du scoring legacy uniquement")

class MorseCodePlugin:
    """
    Plugin pour chiffrer et déchiffrer du texte en code Morse.
    - Gère les modes strict/smooth selon le nouveau système
    - Mode strict : vérifie que tout le texte est valide
    - Mode smooth : détecte les fragments valides
    """

    def __init__(self):
        self.name = "morse_code"
        self.description = "Plugin pour chiffrer et déchiffrer le code Morse (A-Z, 0-9)."

        # Tables de conversion
        self.letter_to_morse = {
            'A': '.-', 'B': '-...', 'C': '-.-.', 'D': '-..', 'E': '.', 
            'F': '..-.', 'G': '--.', 'H': '....', 'I': '..', 'J': '.---',
            'K': '-.-', 'L': '.-..', 'M': '--', 'N': '-.', 'O': '---',
            'P': '.--.', 'Q': '--.-', 'R': '.-.', 'S': '...', 'T': '-',
            'U': '..-', 'V': '...-', 'W': '.--', 'X': '-..-', 'Y': '-.--',
            'Z': '--..', '0': '-----', '1': '.----', '2': '..---', 
            '3': '...--', '4': '....-', '5': '.....', '6': '-....', 
            '7': '--...', '8': '---..', '9': '----.'
        }
        self.morse_to_letter = {v: k for k, v in self.letter_to_morse.items()}
        
        # Récupérer la configuration depuis plugin.json
        plugin_config_path = os.path.join(os.path.dirname(__file__), 'plugin.json')
        try:
            with open(plugin_config_path, 'r') as f:
                config = json.load(f)
                # Récupérer le paramètre enable_scoring
                self.enable_scoring = config.get('enable_scoring', False)
                print(f"Paramètre enable_scoring configuré: {self.enable_scoring}")
        except (FileNotFoundError, json.JSONDecodeError) as e:
            self.enable_scoring = False  # Valeur par défaut
            print(f"Erreur lors du chargement de la configuration: {str(e)}")
        
        # Initialiser le service de scoring local si disponible
        self.scoring_service = None
        if scoring_service_available:
            try:
                self.scoring_service = ScoringService()
                print("Service de scoring initialisé avec succès")
            except Exception as e:
                print(f"Erreur lors de l'initialisation du service de scoring: {str(e)}")
        
        # Conserver l'URL API pour la rétrocompatibilité
        self.scoring_api_url = "http://localhost:5000/api/plugins/score"

    def check_code(self, text: str, strict: bool = False, allowed_punct=None) -> dict:
        """
        Analyse le texte selon le mode spécifié :
        - Strict : Tous les tokens doivent être valides
        - Smooth : Recherche des tokens valides
        """
        if allowed_punct is None:
            allowed_punct = " "  # Séparateur par défaut
            
        esc_punct = re.escape(allowed_punct)
        tokens = self._split_into_tokens(text, allowed_punct)

        if strict:
            # Vérification des caractères autorisés
            if not re.fullmatch(f"^[{esc_punct}.\\-]*$", text):
                return {"is_match": False, "fragments": []}

            # Validation de tous les tokens
            valid_fragments = []
            for token in tokens:
                if token["block"] not in self.morse_to_letter:
                    return {"is_match": False, "fragments": []}
                valid_fragments.append({
                    "value": token["block"],
                    "start": token["start"],
                    "end": token["end"]
                })
                
            return {"is_match": True, "fragments": valid_fragments}
            
        else:
            # Détection des tokens valides
            valid_fragments = []
            for token in tokens:
                if token["block"] in self.morse_to_letter:
                    valid_fragments.append({
                        "value": token["block"],
                        "start": token["start"],
                        "end": token["end"]
                    })
                    
            return {"is_match": len(valid_fragments) > 0, "fragments": valid_fragments}

    def _split_into_tokens(self, text: str, allowed_punct: str) -> list:
        """
        Découpe le texte en tokens Morse séparés par la ponctuation autorisée
        """
        esc_punct = re.escape(allowed_punct)
        pattern = f"([^{esc_punct}]+)|([{esc_punct}]+)"
        tokens = []
        
        for match in re.finditer(pattern, text):
            if match.group(1):  # Bloc Morse
                tokens.append({
                    "block": match.group(1),
                    "start": match.start(),
                    "end": match.end()
                })
                
        return tokens

    def decode_fragments(self, text: str, fragments: list) -> str:
        """
        Décode uniquement les fragments valides dans leur contexte original
        """
        sorted_frags = sorted(fragments, key=lambda x: x["start"])
        result = []
        last_pos = 0
        
        for frag in sorted_frags:
            result.append(text[last_pos:frag["start"]])  # Texte avant
            result.append(self.morse_to_letter[frag["value"]])  # Texte décodé
            last_pos = frag["end"]
            
        result.append(text[last_pos:])  # Reste du texte
        return "".join(result)

    def encrypt(self, text: str) -> str:
        """Encode le texte en Morse (inchangé)"""
        return " ".join(
            self.letter_to_morse.get(c.upper(), "") 
            for c in text 
            if c.upper() in self.letter_to_morse
        )

    def decrypt(self, morse_text: str) -> str:
        """Décode le Morse en texte (inchangé)"""
        return "".join(
            self.morse_to_letter.get(token, "?") 
            for token in morse_text.split()
        )
        
    def _clean_text_for_scoring(self, text: str) -> str:
        """
        Nettoie le texte décodé pour le scoring.
        Supprime les espaces entre les lettres et compresse le texte.
        
        Args:
            text: Le texte décodé à nettoyer
            
        Returns:
            Le texte nettoyé prêt pour le scoring
        """
        # Supprimer les espaces simples entre les lettres
        # Par exemple "C E C I" devient "CECI"
        pattern1 = r'(\w) (\w)'
        while re.search(pattern1, text):
            text = re.sub(pattern1, r'\1\2', text)
            
        # Supprimer les espaces entre séquences de lettres
        # Par exemple "CECI EST" devient "CECIEST"
        pattern2 = r'(\w+) (\w+)'
        while re.search(pattern2, text):
            text = re.sub(pattern2, r'\1\2', text)
        
        print(f"Texte nettoyé pour scoring: {text}")
        return text
        
    def _get_text_score(self, text, context=None):
        """
        Obtient le score de confiance d'un texte en utilisant le service de scoring.
        
        Args:
            text: Le texte à évaluer
            context: Contexte optionnel (coordonnées de géocache, etc.)
        
        Returns:
            Dictionnaire contenant le résultat du scoring, ou None en cas d'erreur
        """
        # Nettoyer le texte avant le scoring pour résoudre le problème des espaces
        cleaned_text = self._clean_text_for_scoring(text)
        
        # Préparer les données
        data = {
            "text": cleaned_text
        }
        
        # Ajouter le contexte s'il est fourni
        if context:
            data["context"] = context
        
        print(f"Évaluation du texte: {cleaned_text[:30]}...")
        
        # Utiliser le service local si disponible
        if self.scoring_service:
            try:
                print("Appel direct au service de scoring local")
                result = self.scoring_service.score_text(cleaned_text, context)
                print(f"Résultat du scoring local: {result}")
                return result
            except Exception as e:
                print(f"Erreur lors de l'évaluation locale: {str(e)}")
                # On pourrait tomber en fallback sur l'API, mais pour simplifier,
                # on va juste retourner None en cas d'erreur
                return None
        else:
            # Fallback: utiliser l'API distante si le service local n'est pas disponible
            try:
                print(f"Appel à l'API de scoring: {self.scoring_api_url}")
                response = requests.post(self.scoring_api_url, json=data)
                
                if response.status_code == 200:
                    result = response.json()
                    if result.get("success"):
                        api_result = result.get("result", {})
                        print(f"Résultat de l'API: {api_result}")
                        return api_result
                    else:
                        print(f"Erreur API: {result.get('error')}")
                else:
                    print(f"Erreur HTTP: {response.status_code}")
                    
                return None
            except Exception as e:
                print(f"Erreur lors de l'appel à l'API de scoring: {str(e)}")
                return None

    def execute(self, inputs: dict) -> dict:
        """
        Méthode d'exécution avec gestion des modes strict/smooth
        
        Args:
            inputs: Dictionnaire contenant les paramètres d'entrée
                - mode: "encode" ou "decode"
                - text: Texte à traiter
                - strict: Mode strict ou smooth
                - allowed_punct: Caractères séparateurs autorisés
                - enable_scoring: Activation du scoring automatique
                
        Returns:
            Dictionnaire au format standardisé contenant le résultat
        """
        # Mesurer le temps d'exécution
        start_time = time.time()
        
        mode = inputs.get("mode", "encode").lower()
        text = inputs.get("text", "")
        strict_mode = inputs.get("strict", "").lower() == "strict"
        allowed_punct = inputs.get("allowed_punct", None)
        
        # Vérifier si le scoring automatique est activé
        # IMPORTANT: traiter le paramètre comme un booléen comme dans caesar_code
        enable_scoring = inputs.get('enable_scoring', True)
        print(f"État du scoring: param={enable_scoring}, type={type(enable_scoring)}")

        # Structure de base pour la réponse au format standardisé
        standardized_response = {
            "status": "success",
            "plugin_info": {
                "name": self.name,
                "version": "1.0.0",
                "execution_time": 0
            },
            "inputs": {
                "mode": mode,
                "text": text,
                "strict": "strict" if strict_mode else "smooth",
                "enable_scoring": enable_scoring
            },
            "results": [],
            "summary": {
                "best_result_id": None,
                "total_results": 0,
                "message": ""
            }
        }

        if not text:
            standardized_response["status"] = "error"
            standardized_response["summary"]["message"] = "Aucun texte fourni à traiter."
            return standardized_response

        try:
            if mode == "encode":
                encoded = self.encrypt(text)
                
                # Ajouter le résultat au format standardisé
                standardized_response["results"].append({
                    "id": "result_1",
                    "text_output": encoded,
                    "confidence": 1.0,
                    "parameters": {
                        "mode": "encode"
                    },
                    "metadata": {
                        "input_chars": len([c for c in text.upper() if c in self.letter_to_morse])
                    }
                })
                
                standardized_response["summary"]["best_result_id"] = "result_1"
                standardized_response["summary"]["total_results"] = 1
                standardized_response["summary"]["message"] = "Encodage en Morse réussi"
                
            elif mode == "decode":
                if strict_mode:
                    check = self.check_code(text, strict=True, allowed_punct=allowed_punct)
                    if not check["is_match"]:
                        standardized_response["status"] = "error"
                        standardized_response["summary"]["message"] = "Code Morse invalide en mode strict"
                        return standardized_response
                    
                    decoded = self.decrypt(text)
                else:
                    check = self.check_code(text, strict=False, allowed_punct=allowed_punct)
                    if not check["is_match"]:
                        standardized_response["status"] = "error"
                        standardized_response["summary"]["message"] = "Aucun code Morse valide détecté"
                        return standardized_response
                    
                    decoded = self.decode_fragments(text, check["fragments"])
                    
                    # Vérifier si le décodage a effectivement modifié le texte
                    if decoded == text:
                        standardized_response["status"] = "error"
                        standardized_response["summary"]["message"] = "Aucun code Morse n'a pu être décodé"
                        return standardized_response

                # Utiliser le service de scoring si activé
                print(f"Texte décodé original: {decoded}")
                print(f"Scoring activé? {enable_scoring}")
                scoring_result = None
                
                if enable_scoring:
                    print("Appel du système de scoring")
                    scoring_result = self._get_text_score(decoded, context=inputs.get('context', {}))
                    print(f"Résultat du scoring: {scoring_result}")
                    
                    if scoring_result and 'score' in scoring_result:
                        confidence = scoring_result['score']
                        print(f"Score utilisé: {confidence}")
                    else:
                        # Valeur par défaut si le scoring a échoué
                        confidence = 0.6
                        print(f"Échec du scoring, utilisation de la confiance par défaut: {confidence}")
                else:
                    # Valeur par défaut si le scoring est désactivé
                    confidence = 0.6
                    print(f"Scoring désactivé, utilisation de la confiance par défaut: {confidence}")

                # Ajouter le résultat au format standardisé
                result = {
                    "id": "result_1",
                    "text_output": decoded,
                    "confidence": confidence,
                    "parameters": {
                        "mode": "decode",
                        "strict": "strict" if strict_mode else "smooth"
                    },
                    "metadata": {
                        "fragments_count": len(check["fragments"]),
                        "fragments": [f["value"] for f in check["fragments"]]
                    }
                }
                
                # Ajouter les résultats du scoring s'ils sont disponibles
                if scoring_result:
                    result["scoring"] = scoring_result
                
                standardized_response["results"].append(result)
                
                standardized_response["summary"]["best_result_id"] = "result_1"
                standardized_response["summary"]["total_results"] = 1
                standardized_response["summary"]["message"] = "Décodage Morse réussi"
                
            else:
                standardized_response["status"] = "error"
                standardized_response["summary"]["message"] = f"Mode inconnu : {mode}"
                return standardized_response
                
        except Exception as e:
            standardized_response["status"] = "error"
            standardized_response["summary"]["message"] = f"Erreur pendant le traitement : {str(e)}"
            print(f"Exception lors de l'exécution: {str(e)}")
            import traceback
            print(traceback.format_exc())
            return standardized_response
        
        # Calculer le temps d'exécution
        standardized_response["plugin_info"]["execution_time"] = int((time.time() - start_time) * 1000)
        
        return standardized_response