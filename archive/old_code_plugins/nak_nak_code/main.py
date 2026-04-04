import re
import time
import json
import os
import requests

# Import du service de scoring
try:
    from app.services.scoring_service import ScoringService
    scoring_service_available = True
    print("Module de scoring disponible")
except ImportError:
    scoring_service_available = False
    print("Module de scoring non disponible, utilisation du scoring legacy uniquement")

class NakNakCodePlugin:
    """
    Plugin pour encoder/décoder du texte avec le code Nak Nak (Duckspeak).
    - mode="encode" : convertit un texte normal en code Nak Nak
    - mode="decode" : convertit du code Nak Nak en texte normal
    - Gère les modes strict/smooth selon le système de plugins
    """

    def __init__(self):
        self.name = "nak_nak_code"
        self.description = "Plugin pour encoder/décoder du texte avec le code Nak Nak (Duckspeak)"

        # Tables d'encodage/décodage pour le code Nak Nak
        # Le code Nak Nak utilise des combinaisons de "Na" et "Nak" pour représenter les chiffres hexadécimaux
        self.encode_table = {
            '0': 'Nak',    # 0
            '1': 'Nanak',       # 1
            '2': 'Nananak',  # 2
            '3': 'Nanananak',   # 3
            '4': 'Nak?',        # 4
            '5': 'nak?',        # 5
            '6': 'Naknak',      # 6
            '7': 'Naknaknak',   # 7
            '8': 'Nak.',   # 8
            '9': 'Naknak.', # 9 
            'A': 'Naknaknaknak',       # A
            'B': 'nanak',    # B
            'C': 'naknak',  # C
            'D': 'nak!',      # D
            'E': 'nak.',     # E
            'F': 'naknaknak',    # F
            'a': 'Naknaknaknak',       # A
            'b': 'nanak',    # B
            'c': 'naknak',  # C
            'd': 'nak!',      # D
            'e': 'nak.',     # E
            'f': 'naknaknak'    # F
        }
        
        # Table de décodage (inverse de la table d'encodage)
        self.decode_table = {}
        for key, value in self.encode_table.items():
            # Si la valeur est déjà une clé, on garde la version minuscule si c'est une lettre
            if value not in self.decode_table or (key.lower() == key and key.isalpha()):
                self.decode_table[value] = key
                
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
    
    def check_code(self, text: str, strict: bool = False, allowed_chars=None, embedded: bool = False) -> dict:
        """
        Vérifie si le texte contient du code Nak Nak valide.
        
        Args:
            text: Texte à analyser
            strict: Mode strict (True) ou smooth (False)
            allowed_chars: Liste de caractères autorisés en plus des caractères Nak Nak
            embedded: True si le texte peut contenir du code intégré, False si tout le texte doit être du code
            
        Returns:
            Un dictionnaire contenant:
            - is_match: True si du code Nak Nak a été trouvé
            - fragments: Liste des fragments de code Nak Nak trouvés
            - score: Score de confiance (0.0 à 1.0)
        """
        # Si allowed_chars est fourni comme liste, on la convertit en chaîne
        if allowed_chars is not None and isinstance(allowed_chars, list):
            allowed_chars = ''.join(allowed_chars)
            
        # Caractères autorisés par défaut
        if allowed_chars is None:
            allowed_chars = " \t\r\n.:;,_-°"
            
        # Motif de base pour le code Nak Nak
        nak_pattern = r'(?:Na(?:k|\?)\??)'
        
        # En mode strict, le comportement dépend du paramètre embedded
        if strict:
            if embedded:
                # En mode strict+embedded, on recherche des fragments de code Nak Nak valides dans le texte
                return self._extract_nak_nak_fragments(text, allowed_chars)
            else:
                # En mode strict sans embedded, on vérifie que tout le texte est du code Nak Nak valide
                # Échapper les caractères spéciaux pour l'expression régulière
                esc_punct = re.escape(allowed_chars)
                
                # Vérifier que tous les mots non-autorisés sont des fragments Nak Nak valides
                words = re.split(f'[{esc_punct}]+', text)
                valid_words = []
                
                for word in words:
                    if not word:  # Ignorer les chaînes vides
                        continue
                    
                    # Vérifier si ce mot est un code Nak Nak valide
                    if word in self.decode_table or re.match(f'^({nak_pattern})+$', word, re.IGNORECASE):
                        valid_words.append(word)
                
                if not valid_words:
                    return {"is_match": False, "fragments": [], "score": 0.0}
                
                # Extraire les fragments
                fragments = []
                for word in valid_words:
                    start = text.find(word)
                    if start != -1:
                        fragments.append({"value": word, "start": start, "end": start + len(word)})
                
                return {
                    "is_match": True,
                    "fragments": fragments,
                    "score": 1.0 if fragments else 0.0
                }
        else:
            # En mode smooth, on recherche des fragments de code Nak Nak valides dans le texte
            return self._extract_nak_nak_fragments(text, allowed_chars)
            
    def _extract_nak_nak_fragments(self, text: str, allowed_chars: str) -> dict:
        """
        Extrait les fragments de code Nak Nak valides dans le texte.
        
        Args:
            text: Texte à analyser
            allowed_chars: Caractères autorisés en plus des caractères Nak Nak
            
        Returns:
            Un dictionnaire contenant:
            - is_match: True si des fragments ont été trouvés
            - fragments: Liste des fragments contenant du code Nak Nak
            - score: Score de confiance (0.0 à 1.0)
        """
        # Échapper les caractères spéciaux pour l'expression régulière
        esc_punct = re.escape(allowed_chars)
        
        # Rechercher des mots qui pourraient être du code Nak Nak
        fragments = []
        
        # 1. Rechercher des mots exacts dans la table de décodage
        for nak_code in self.decode_table.keys():
            for match in re.finditer(re.escape(nak_code), text, re.IGNORECASE):
                start, end = match.span()
                fragments.append({"value": text[start:end], "start": start, "end": end})
        
        # 2. Rechercher des séquences de motifs Nak Nak
        words = re.split(f'[{esc_punct}]+', text)
        for word in words:
            if not word:  # Ignorer les chaînes vides
                continue
                
            # Vérifier si le mot peut contenir du code Nak Nak
            if re.search(r'Na[k?]', word, re.IGNORECASE):
                start = text.find(word)
                if start != -1 and not any(f["start"] <= start < f["end"] for f in fragments):
                    fragments.append({"value": word, "start": start, "end": start + len(word)})
        
        # Dédupliquer et trier les fragments
        if fragments:
            fragments = sorted(fragments, key=lambda x: x["start"])
            
            # Fusion des fragments qui se chevauchent
            i = 0
            while i < len(fragments) - 1:
                if fragments[i]["end"] >= fragments[i+1]["start"]:
                    # Fusionner les fragments
                    fragments[i]["end"] = max(fragments[i]["end"], fragments[i+1]["end"])
                    fragments[i]["value"] = text[fragments[i]["start"]:fragments[i]["end"]]
                    fragments.pop(i+1)
                else:
                    i += 1
        
        # Calculer un score basé sur le nombre de fragments trouvés
        score = 1.0 if fragments else 0.0
        
        return {
            "is_match": bool(fragments),
            "fragments": fragments,
            "score": score
        }

    def decode_fragments(self, text: str, fragments: list) -> str:
        """
        Décode uniquement les fragments valides dans le texte.
        Remplace chaque fragment par son décodage, tout en préservant le reste du texte.
        
        Args:
            text: Texte original contenant les fragments
            fragments: Liste des fragments à décoder
            
        Returns:
            Texte avec les fragments décodés
        """
        sorted_fragments = sorted(fragments, key=lambda x: x["start"])
        result = []
        last_pos = 0

        
        for frag in sorted_fragments:
            result.append(text[last_pos:frag["start"]])
            result.append(self.decode(frag["value"]))
            last_pos = frag["end"]            
            
        result.append(text[last_pos:])
        return "".join(result)

    def encode(self, text: str) -> str:
        """
        Encode le texte en code Nak Nak.
        Convertit chaque caractère en son code ASCII hexadécimal, puis transforme
        chaque chiffre hexadécimal en son équivalent Nak Nak.
        
        Args:
            text: Texte à encoder
            
        Returns:
            Texte encodé en Nak Nak
        """
        result = []
        for char in text:
            # Convertir le caractère en code ASCII hexadécimal
            hex_code = format(ord(char), 'x')  # 'x' pour hexadécimal
            
            # Encoder chaque chiffre hexadécimal en Nak Nak
            nak_codes = [self.encode_table.get(digit, digit) for digit in hex_code]
            
            # Ajouter un espace entre les caractères encodés pour plus de lisibilité
            result.append(' '.join(nak_codes))
        
        # Joindre tous les codes avec des espaces
        return ' '.join(result)

    def decode(self, text: str) -> str:
        """
        Décode le code Nak Nak en texte normal.
        
        Args:
            text: Texte encodé en Nak Nak à décoder
            
        Returns:
            Texte décodé
        """
        # Nettoyer l'entrée
        text = text.strip()
        
        # Si le texte est vide, retourner une chaîne vide
        if not text:
            return ""
        
        # Diviser le texte en segments (généralement séparés par des espaces)
        segments = re.split(r'\s+', text)
        hex_chars = []
        
        # Parcourir tous les segments et essayer de les décoder
        current_hex = ""
        for segment in segments:
            # Vérifier si le segment est dans notre table de décodage
            hex_digit = self.decode_table.get(segment)

            if hex_digit is not None:
                current_hex += hex_digit
                
                # Si nous avons accumulé 2 chiffres hexadécimaux, convertir en caractère
                if len(current_hex) == 2:
                    try:
                        hex_chars.append(chr(int(current_hex, 16)))  # Convertir hex en ASCII
                        current_hex = ""
                    except ValueError:
                        # Si la conversion échoue, conserver tel quel
                        current_hex = ""
            else:
                # Si ce n'est pas un code Nak Nak valide, laisser tel quel
                if current_hex:
                    # Gérer les restes éventuels
                    if len(current_hex) == 1:
                        try:
                            hex_chars.append(chr(int(current_hex, 16)))
                        except ValueError:
                            pass
                    current_hex = ""
                
                # Si le segment n'est pas décodable, le laisser comme un '?'
                hex_chars.append('?')
        
        # Gérer les restes éventuels à la fin
        if current_hex:
            try:
                hex_chars.append(chr(int(current_hex, 16)))
            except ValueError:
                pass
        
        # Joindre tous les caractères décodés
        return "".join(hex_chars)
    
    def _clean_text_for_scoring(self, text: str) -> str:
        """
        Nettoie le texte décodé pour le scoring.
        Supprime les espaces et caractères spéciaux pour une évaluation plus précise.
        
        Args:
            text: Le texte décodé à nettoyer
            
        Returns:
            Le texte nettoyé prêt pour le scoring
        """
        # Supprimer tout caractère non-alphanumérique (sauf espaces)
        text = re.sub(r'[^\w\s]', '', text)
        
        # Supprimer les espaces multiples
        text = re.sub(r'\s+', ' ', text).strip()
        
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
        # Nettoyer le texte avant le scoring
        cleaned_text = self._clean_text_for_scoring(text)
        
        # Préparer les données
        data = {
            "text": cleaned_text
        }
        
        # Ajouter le contexte s'il est fourni
        if context:
            data["context"] = context       
     
        # Utiliser le service local si disponible
        if self.scoring_service:
            try:
                print("Appel direct au service de scoring local")
                result = self.scoring_service.score_text(cleaned_text, context)
                print(f"Résultat du scoring local: {result}")
                return result
            except Exception as e:
                print(f"Erreur lors de l'évaluation locale: {str(e)}")
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
        Point d'entrée principal du plugin.
        
        Args:
            inputs: Dictionnaire contenant les paramètres d'entrée
                - mode: "encode" ou "decode"
                - text: Texte à encoder ou décoder
                - strict: "strict" ou "smooth" pour le mode de décodage
                - allowed_chars: Liste de caractères autorisés pour le mode smooth
                - embedded: True si le texte peut contenir du code intégré, False si tout le texte doit être du code
                - enable_scoring: Activation du scoring automatique
                
        Returns:
            Dictionnaire au format standardisé contenant le résultat de l'opération
        """
        # Mesurer le temps d'exécution
        start_time = time.time()
        
        mode = inputs.get("mode", "encode").lower()
        text = inputs.get("text", "")
        
        # Vérifier si le scoring automatique est activé
        enable_scoring = inputs.get('enable_scoring', True)
        print(f"État du scoring: param={enable_scoring}, type={type(enable_scoring)}")
        
        # Extraire le contexte pour le scoring (si présent)
        context = inputs.get('context', {})
        
        # Considère le mode strict si la valeur du paramètre "strict" est exactement "strict"
        strict_mode = inputs.get("strict", "").lower() == "strict"
        
        # Récupération de la liste des caractères autorisés sous la clé "allowed_chars"
        allowed_chars = inputs.get("allowed_chars", " ,.;:!?-_")
        
        # Récupération du mode embedded
        embedded = inputs.get("embedded", False)
        
        # Initialiser la structure standardisée
        result = {
            "status": "success",
            "plugin_info": {
                "name": self.name,
                "version": "1.0.0",
                "execution_time": 0  # Sera mis à jour à la fin
            },
            "inputs": inputs,
            "results": [],
            "summary": {
                "total_results": 0
            }
        }

        if not text:
            result["status"] = "error"
            result["summary"]["message"] = "Aucun texte fourni à traiter."
            return result

        try:
            if mode == "encode":
                encoded = self.encode(text)
                
                # Ajouter le résultat au format standardisé
                response_result = {
                    "id": "result_1",
                    "text_output": encoded,
                    "confidence": 1.0,  # Confiance maximale pour l'encodage
                    "parameters": {
                        "mode": mode
                    },
                    "metadata": {
                        "processed_chars": len(text)
                    }
                }
                
                result["results"].append(response_result)
                result["summary"]["best_result_id"] = "result_1"
                result["summary"]["total_results"] = 1
                result["summary"]["message"] = "Encodage réussi"
                
            elif mode == "decode":
                # Vérifier si le texte contient du code Nak Nak
                check_result = self.check_code(text, strict=strict_mode, allowed_chars=allowed_chars, embedded=embedded)

                if check_result["is_match"]:
                    # Si des fragments ont été trouvés, les décoder
                    if embedded:
                        decoded_text = self.decode_fragments(text, check_result["fragments"])
                    else:
                        # En mode non-embedded, décodage direct
                        decoded_text = self.decode(text)
                        
                    # Évaluer la pertinence du résultat avec le scoring si activé
                    if enable_scoring and self.scoring_service:
                        # Obtenir le score du texte décodé
                        scoring_result = self._get_text_score(decoded_text, context)
                        
                        # Utiliser le score obtenu comme niveau de confiance
                        confidence = scoring_result.get("score", 0.5) if scoring_result else 0.5
                    else:
                        # Utiliser une valeur par défaut si le scoring est désactivé
                        confidence = check_result["score"]
                        scoring_result = None
                    
                    # Construire le résultat
                    response_result = {
                        "id": "result_1",
                        "text_output": decoded_text,
                        "confidence": confidence,
                        "parameters": {
                            "mode": mode,
                            "strict": "strict" if strict_mode else "smooth",
                            "embedded": embedded
                        },
                        "metadata": {
                            "processed_chars": len(text),
                            "fragments_found": len(check_result["fragments"])
                        }
                    }
                    
                    # Ajouter les informations de scoring si disponibles
                    if scoring_result:
                        response_result["scoring"] = scoring_result
                    
                    result["results"].append(response_result)
                    result["summary"]["best_result_id"] = "result_1"
                    result["summary"]["total_results"] = 1
                    result["summary"]["message"] = "Décodage réussi"
                else:
                    # Aucun code Nak Nak trouvé
                    result["status"] = "error"
                    result["summary"]["message"] = "Aucun code Nak Nak valide trouvé dans le texte."
            else:
                result["status"] = "error"
                result["summary"]["message"] = f"Mode non reconnu: {mode}. Utilisez 'encode' ou 'decode'."
        except Exception as e:
            result["status"] = "error"
            result["summary"]["message"] = f"Erreur lors du traitement: {str(e)}"
            print(f"Exception: {str(e)}")
        
        # Mettre à jour le temps d'exécution
        result["plugin_info"]["execution_time"] = round(time.time() - start_time, 4)
        
        return result

# Point d'entrée pour le plugin
def init():
    """
    Fonction d'initialisation permettant au système de plugins de charger ce plugin.
    Returns:
        Une instance de la classe NakNakCodePlugin
    """
    return NakNakCodePlugin()
