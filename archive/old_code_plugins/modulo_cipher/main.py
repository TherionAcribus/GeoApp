import time
import re
import json
import os
import random
from typing import List, Dict, Union

# Import du service de scoring
try:
    from app.services.scoring_service import ScoringService
    scoring_service_available = True
    print("Module de scoring disponible")
except ImportError:
    scoring_service_available = False
    print("Module de scoring non disponible, utilisation du scoring legacy uniquement")

class ModuloCipherPlugin:
    """
    Plugin pour encoder/décoder du texte avec le chiffrement par modulo.
    
    Le chiffrement par modulo utilise l'arithmétique modulaire sur des nombres
    pour chiffrer un texte. Les caractères sont convertis en nombres, puis pour
    chaque nombre à encoder, on prend un nombre aléatoire dont la valeur modulo N
    est égale au nombre à encoder.
    
    Modes : 
      - encode : Convertit le texte en nombres puis applique le chiffrement modulo
      - decode : Décode les nombres chiffrés en appliquant l'opération modulo
      - bruteforce : Teste différentes valeurs de modulo
    """

    def __init__(self):
        self.name = "modulo_cipher"
        self.description = "Plugin de chiffrement/déchiffrement utilisant le chiffrement par modulo"
        self.alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
        self.alphabet_len = 26
        
        # Valeurs de modulo couramment utilisées
        self.common_modulos = [26, 27, 36, 37, 128, 256]
        
        # Récupérer la configuration depuis plugin.json
        plugin_config_path = os.path.join(os.path.dirname(__file__), 'plugin.json')
        try:
            with open(plugin_config_path, 'r') as f:
                config = json.load(f)
                self.enable_scoring = config.get('enable_scoring', False)
                print(f"Paramètre enable_scoring configuré: {self.enable_scoring}")
        except (FileNotFoundError, json.JSONDecodeError) as e:
            self.enable_scoring = False
            print(f"Erreur lors du chargement de la configuration: {str(e)}")
        
        # Initialiser le service de scoring local si disponible
        self.scoring_service = None
        if scoring_service_available:
            try:
                self.scoring_service = ScoringService()
                print("Service de scoring initialisé avec succès")
            except Exception as e:
                print(f"Erreur lors de l'initialisation du service de scoring: {str(e)}")

    def _char_to_num_a1z26(self, char: str) -> int:
        """Convertit un caractère en nombre selon A=1, B=2, ..., Z=26"""
        if char.upper() in self.alphabet:
            return ord(char.upper()) - ord('A') + 1
        return 0

    def _char_to_num_a0z25(self, char: str) -> int:
        """Convertit un caractère en nombre selon A=0, B=1, ..., Z=25"""
        if char.upper() in self.alphabet:
            return ord(char.upper()) - ord('A')
        return 0

    def _num_to_char_a1z26(self, num: int) -> str:
        """Convertit un nombre en caractère selon A=1, B=2, ..., Z=26"""
        if 1 <= num <= 26:
            return chr(ord('A') + num - 1)
        return '?'

    def _num_to_char_a0z25(self, num: int) -> str:
        """Convertit un nombre en caractère selon A=0, B=1, ..., Z=25"""
        if 0 <= num <= 25:
            return chr(ord('A') + num)
        return '?'

    def _text_to_numbers(self, text: str, alphabet_mapping: str = "A1Z26") -> List[int]:
        """
        Convertit un texte en liste de nombres selon le mapping choisi.
        
        Args:
            text: Texte à convertir
            alphabet_mapping: "A1Z26" ou "A0Z25"
            
        Returns:
            Liste des nombres correspondants
        """
        numbers = []
        conversion_func = self._char_to_num_a1z26 if alphabet_mapping == "A1Z26" else self._char_to_num_a0z25
        
        for char in text.upper():
            if char in self.alphabet:
                numbers.append(conversion_func(char))
        
        return numbers

    def _numbers_to_text(self, numbers: List[int], alphabet_mapping: str = "A1Z26") -> str:
        """
        Convertit une liste de nombres en texte selon le mapping choisi.
        
        Args:
            numbers: Liste des nombres à convertir
            alphabet_mapping: "A1Z26" ou "A0Z25"
            
        Returns:
            Texte reconstitué
        """
        chars = []
        conversion_func = self._num_to_char_a1z26 if alphabet_mapping == "A1Z26" else self._num_to_char_a0z25
        
        for num in numbers:
            chars.append(conversion_func(num))
        
        return ''.join(chars)

    def _parse_numbers_from_text(self, text: str) -> List[int]:
        """
        Parse les nombres depuis un texte. Support des formats :
        - "123,456,789"
        - "123 456 789"
        - "123-456-789"
        - "123456789" (si plus de 2 chiffres par nombre, on divise par groupes)
        """
        # Nettoyer le texte
        text = text.strip()
        
        # Essayer les séparateurs classiques
        if ',' in text:
            numbers = [int(x.strip()) for x in text.split(',') if x.strip().isdigit()]
        elif ' ' in text and not text.isdigit():
            numbers = [int(x.strip()) for x in text.split() if x.strip().isdigit()]
        elif '-' in text:
            numbers = [int(x.strip()) for x in text.split('-') if x.strip().isdigit()]
        else:
            # Si c'est un long nombre sans séparateur, on essaie de deviner
            if len(text) > 2 and text.isdigit():
                # Essayer de diviser en groupes de 2 ou 3 chiffres
                numbers = []
                # Essayer groupes de 3 d'abord
                if len(text) % 3 == 0:
                    for i in range(0, len(text), 3):
                        numbers.append(int(text[i:i+3]))
                # Sinon groupes de 2
                elif len(text) % 2 == 0:
                    for i in range(0, len(text), 2):
                        numbers.append(int(text[i:i+2]))
                else:
                    # Impossible de diviser proprement
                    return [int(text)]
            else:
                numbers = [int(text)] if text.isdigit() else []
        
        return numbers

    def encode(self, text: str, modulo: int, alphabet_mapping: str = "A1Z26") -> str:
        """
        Chiffrement par modulo : pour chaque caractère, on génère un nombre
        aléatoire dont le reste modulo N égale la valeur du caractère.
        
        Args:
            text: Texte à chiffrer
            modulo: Valeur du modulo
            alphabet_mapping: Type de conversion alphabet-nombre
            
        Returns:
            Chaîne de nombres séparés par des virgules
        """
        # Convertir le texte en nombres
        numbers = self._text_to_numbers(text, alphabet_mapping)
        
        # Pour chaque nombre, générer un nombre aléatoire avec le bon modulo
        encoded_numbers = []
        for num in numbers:
            # Générer un nombre aléatoire dont le modulo égale num
            # On prend un multiplicateur aléatoire entre 1 et 50 pour varier
            multiplier = random.randint(1, 50)
            encoded_num = multiplier * modulo + num
            encoded_numbers.append(encoded_num)
        
        return ','.join(map(str, encoded_numbers))

    def decode(self, text: str, modulo: int, alphabet_mapping: str = "A1Z26") -> str:
        """
        Déchiffrement par modulo : applique l'opération modulo sur chaque nombre
        pour récupérer la valeur originale.
        
        Args:
            text: Texte contenant les nombres chiffrés
            modulo: Valeur du modulo
            alphabet_mapping: Type de conversion nombre-alphabet
            
        Returns:
            Texte déchiffré
        """
        try:
            # Parser les nombres depuis le texte
            numbers = self._parse_numbers_from_text(text)
            
            if not numbers:
                return "Erreur: Aucun nombre trouvé dans le texte"
            
            # Appliquer l'opération modulo pour récupérer les valeurs originales
            decoded_numbers = [num % modulo for num in numbers]
            
            # Convertir les nombres en texte
            decoded_text = self._numbers_to_text(decoded_numbers, alphabet_mapping)
            
            return decoded_text
            
        except Exception as e:
            return f"Erreur lors du décodage: {str(e)}"

    def bruteforce(self, text: str, alphabet_mapping: str = "A1Z26") -> List[Dict]:
        """
        Tente différentes valeurs de modulo pour décoder le texte.
        
        Args:
            text: Texte à décoder
            alphabet_mapping: Type de conversion nombre-alphabet
            
        Returns:
            Liste des solutions possibles
        """
        solutions = []
        
        for modulo in self.common_modulos:
            try:
                decoded_text = self.decode(text, modulo, alphabet_mapping)
                
                # Vérifier si le résultat contient uniquement des lettres valides
                if decoded_text and not decoded_text.startswith("Erreur:"):
                    # Calculer un score de base
                    confidence = self._calculate_confidence(modulo, decoded_text)
                    
                    solutions.append({
                        "modulo": modulo,
                        "alphabet_mapping": alphabet_mapping,
                        "decoded_text": decoded_text,
                        "confidence": confidence
                    })
                    
            except Exception as e:
                continue
        
        # Trier par confiance décroissante
        solutions.sort(key=lambda x: x['confidence'], reverse=True)
        return solutions

    def _calculate_confidence(self, modulo: int, text: str) -> float:
        """
        Calcule un indice de confiance pour un résultat de bruteforce.
        
        Args:
            modulo: Valeur du modulo utilisée
            text: Texte décodé
            
        Returns:
            Score de confiance entre 0 et 1
        """
        # Modulos les plus courants ont une meilleure confiance de base
        if modulo == 26:
            base_confidence = 0.9  # Modulo standard pour l'alphabet
        elif modulo == 27:
            base_confidence = 0.8
        elif modulo in [36, 37]:
            base_confidence = 0.7
        else:
            base_confidence = 0.6
        
        # Vérifier la qualité du texte décodé
        if not text or '?' in text:
            return 0.1
        
        # Calculer le ratio de lettres valides
        valid_chars = sum(1 for c in text if c in self.alphabet)
        total_chars = len(text)
        
        if total_chars == 0:
            return 0.1
        
        validity_ratio = valid_chars / total_chars
        
        # Combiner les scores
        final_confidence = base_confidence * validity_ratio
        
        return max(0.1, min(1.0, final_confidence))

    def _clean_text_for_scoring(self, text: str) -> str:
        """
        Nettoie le texte décodé pour le scoring.
        """
        # Supprimer les caractères non-alphabétiques
        text = re.sub(r'[^A-Za-z\s]', '', text)
        text = re.sub(r'\s+', ' ', text).strip()
        return text

    def _get_text_score(self, text: str, context=None):
        """
        Obtient le score de confiance d'un texte en utilisant le service de scoring.
        """
        cleaned_text = self._clean_text_for_scoring(text)
        
        if not cleaned_text:
            return None
        
        print(f"Évaluation du texte: {cleaned_text[:30]}...")
        
        # Utiliser le service local si disponible
        if self.scoring_service:
            try:
                result = self.scoring_service.score_text(cleaned_text, context)
                print(f"Résultat du scoring local: {result}")
                return result
            except Exception as e:
                print(f"Erreur lors de l'évaluation locale: {str(e)}")
                return None
        
        return None

    def execute(self, inputs: Dict) -> Dict:
        """
        Méthode principale appelée par le PluginManager.
        
        Args:
            inputs: Dictionnaire contenant les paramètres d'entrée
            
        Returns:
            Résultat au format standardisé
        """
        start_time = time.time()
        
        # Extraire les paramètres
        text = inputs.get("text", "").strip()
        mode = inputs.get("mode", "decode").lower()
        modulo = int(inputs.get("modulo", 26))
        alphabet_mapping = inputs.get("alphabet_mapping", "A1Z26")
        enable_scoring = inputs.get("enable_scoring", "") == "on"
        
        # Structure de base pour la réponse
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
        
        if not text:
            standardized_response["status"] = "error"
            standardized_response["summary"]["message"] = "Aucun texte fourni"
            return standardized_response
        
        try:
            if mode == "encode":
                # Mode encodage
                result_text = self.encode(text, modulo, alphabet_mapping)
                
                response_result = {
                    "id": "result_1",
                    "text_output": result_text,
                    "confidence": 1.0,
                    "parameters": {
                        "mode": mode,
                        "modulo": modulo,
                        "alphabet_mapping": alphabet_mapping
                    },
                    "metadata": {
                        "original_length": len(text),
                        "encoded_numbers": len(result_text.split(',')) if ',' in result_text else 1
                    }
                }
                
                standardized_response["results"].append(response_result)
                standardized_response["summary"]["best_result_id"] = "result_1"
                standardized_response["summary"]["total_results"] = 1
                standardized_response["summary"]["message"] = "Encodage réussi"
                
            elif mode == "decode":
                # Mode décodage
                decoded_text = self.decode(text, modulo, alphabet_mapping)
                
                # Calculer la confiance de base
                confidence = self._calculate_confidence(modulo, decoded_text)
                
                # Améliorer la confiance avec le scoring si activé
                scoring_result = None
                if enable_scoring and not decoded_text.startswith("Erreur:"):
                    context = inputs.get("context", {})
                    scoring_result = self._get_text_score(decoded_text, context)
                    
                    if scoring_result and scoring_result.get("score"):
                        # Utiliser le score comme niveau de confiance
                        confidence = scoring_result.get("score", confidence)
                
                response_result = {
                    "id": "result_1",
                    "text_output": decoded_text,
                    "confidence": confidence,
                    "parameters": {
                        "mode": mode,
                        "modulo": modulo,
                        "alphabet_mapping": alphabet_mapping
                    },
                    "metadata": {
                        "input_numbers": len(self._parse_numbers_from_text(text)),
                        "decoded_length": len(decoded_text) if not decoded_text.startswith("Erreur:") else 0
                    }
                }
                
                # Ajouter les informations de scoring si disponibles
                if scoring_result:
                    response_result["scoring"] = scoring_result
                
                standardized_response["results"].append(response_result)
                standardized_response["summary"]["best_result_id"] = "result_1"
                standardized_response["summary"]["total_results"] = 1
                
                if decoded_text.startswith("Erreur:"):
                    standardized_response["status"] = "partial_success"
                    standardized_response["summary"]["message"] = "Décodage avec erreur"
                else:
                    standardized_response["summary"]["message"] = "Décodage réussi"
            
            elif mode == "bruteforce":
                # Mode bruteforce
                solutions = self.bruteforce(text, alphabet_mapping)
                
                result_id = 1
                for solution in solutions[:10]:  # Limiter à 10 résultats
                    confidence = solution["confidence"]
                    
                    # Améliorer la confiance avec le scoring si activé
                    scoring_result = None
                    if enable_scoring:
                        context = inputs.get("context", {})
                        scoring_result = self._get_text_score(solution["decoded_text"], context)
                        
                        if scoring_result and scoring_result.get("score"):
                            # Combiner le score de bruteforce avec le score lexical
                            lexical_score = scoring_result.get("score", 0)
                            confidence = (confidence * 0.3) + (lexical_score * 0.7)
                    
                    response_result = {
                        "id": f"result_{result_id}",
                        "text_output": solution["decoded_text"],
                        "confidence": confidence,
                        "parameters": {
                            "mode": "bruteforce",
                            "modulo": solution["modulo"],
                            "alphabet_mapping": solution["alphabet_mapping"]
                        },
                        "metadata": {
                            "bruteforce_rank": result_id,
                            "original_confidence": solution["confidence"]
                        }
                    }
                    
                    # Ajouter les informations de scoring si disponibles
                    if scoring_result:
                        response_result["scoring"] = scoring_result
                    
                    standardized_response["results"].append(response_result)
                    result_id += 1
                
                if standardized_response["results"]:
                    # Trier par confiance et définir le meilleur résultat
                    standardized_response["results"].sort(key=lambda x: x["confidence"], reverse=True)
                    standardized_response["summary"]["best_result_id"] = standardized_response["results"][0]["id"]
                    standardized_response["summary"]["total_results"] = len(standardized_response["results"])
                    standardized_response["summary"]["message"] = f"Bruteforce réussi, {len(standardized_response['results'])} solutions trouvées"
                else:
                    standardized_response["status"] = "partial_success"
                    standardized_response["summary"]["message"] = "Aucune solution trouvée en bruteforce"
            
        except Exception as e:
            standardized_response["status"] = "error"
            standardized_response["summary"]["message"] = f"Erreur lors de l'exécution: {str(e)}"
        
        # Calculer le temps d'exécution
        execution_time = int((time.time() - start_time) * 1000)
        standardized_response["plugin_info"]["execution_time"] = execution_time
        
        return standardized_response


def init():
    """
    Point d'entrée pour initialiser le plugin.
    Retourne une instance de la classe du plugin.
    """
    return ModuloCipherPlugin()