import time
import re
import json
import os
import requests
from typing import List, Dict, Tuple

# Import du service de scoring
try:
    from app.services.scoring_service import ScoringService
    scoring_service_available = True
    print("Module de scoring disponible")
except ImportError:
    scoring_service_available = False
    print("Module de scoring non disponible, utilisation du scoring legacy uniquement")

class WolseleyPlugin:
    """
    Plugin pour encoder/décoder du texte avec le chiffre de Wolseley.
    
    Le chiffre de Wolseley est un chiffre de substitution réversible basé sur une clé.
    - On génère un alphabet dérangé à partir de la clé
    - On supprime une lettre pour avoir 25 lettres (J par défaut)
    - Chaque lettre en position n est substituée par la lettre en position 25-n
    """

    def __init__(self):
        self.name = "wolseley_cipher"
        self.description = "Plugin de chiffrement/déchiffrement utilisant le chiffre de Wolseley"
        self.base_alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
        
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
        
        # URL API pour la rétrocompatibilité
        self.scoring_api_url = "http://localhost:5000/api/plugins/score"

    def _generate_alphabet(self, key: str, removed_letter: str = 'J') -> str:
        """
        Génère l'alphabet dérangé à partir de la clé.
        
        Args:
            key: Mot clé pour générer l'alphabet
            removed_letter: Lettre à supprimer ('J', 'V', 'W', ou 'none')
            
        Returns:
            Alphabet dérangé de 25 ou 26 lettres
        """
        # Nettoyer la clé (majuscules, caractères uniques)
        clean_key = ''.join(dict.fromkeys(key.upper().replace(' ', '')))
        
        # Créer l'alphabet de base
        alphabet = self.base_alphabet
        
        # Supprimer la lettre spécifiée si nécessaire
        if removed_letter != 'none' and removed_letter in alphabet:
            alphabet = alphabet.replace(removed_letter, '')
        
        # Générer l'alphabet dérangé
        deranged_alphabet = ''
        
        # Ajouter les lettres de la clé
        for char in clean_key:
            if char in alphabet and char not in deranged_alphabet:
                deranged_alphabet += char
        
        # Compléter avec les lettres restantes
        for char in alphabet:
            if char not in deranged_alphabet:
                deranged_alphabet += char
        
        return deranged_alphabet

    def _create_substitution_table(self, alphabet: str) -> Dict[str, str]:
        """
        Crée la table de substitution de Wolseley.
        Chaque lettre en position n est substituée par la lettre en position len-1-n.
        
        Args:
            alphabet: Alphabet à utiliser pour la substitution
            
        Returns:
            Dictionnaire de substitution
        """
        length = len(alphabet)
        substitution = {}
        
        for i, char in enumerate(alphabet):
            # Position opposée: len-1-i
            opposite_pos = length - 1 - i
            substitution[char] = alphabet[opposite_pos]
        
        return substitution

    def encode(self, text: str, key: str = '', removed_letter: str = 'J') -> str:
        """
        Chiffrement Wolseley.
        
        Args:
            text: Texte à chiffrer
            key: Clé pour générer l'alphabet
            removed_letter: Lettre supprimée de l'alphabet
            
        Returns:
            Texte chiffré
        """
        if not key:
            # Si pas de clé, utiliser Atbash (alphabet normal inversé)
            alphabet = self.base_alphabet
            if removed_letter != 'none' and removed_letter in alphabet:
                alphabet = alphabet.replace(removed_letter, '')
        else:
            alphabet = self._generate_alphabet(key, removed_letter)
        
        substitution_table = self._create_substitution_table(alphabet)
        
        result = []
        for char in text.upper():
            if char in substitution_table:
                result.append(substitution_table[char])
            else:
                # Conserver les caractères non alphabétiques
                result.append(char)
        
        return ''.join(result)

    def decode(self, text: str, key: str = '', removed_letter: str = 'J') -> str:
        """
        Déchiffrement Wolseley.
        Le déchiffrement est identique au chiffrement car la table est réversible.
        
        Args:
            text: Texte à déchiffrer
            key: Clé pour générer l'alphabet
            removed_letter: Lettre supprimée de l'alphabet
            
        Returns:
            Texte déchiffré
        """
        # Le chiffre de Wolseley est réversible
        return self.encode(text, key, removed_letter)

    def check_code(self, text: str, strict: bool = False, allowed_chars=None, embedded: bool = False) -> dict:
        """
        Vérifie si le texte contient du code Wolseley valide.
        
        Args:
            text: Texte à analyser
            strict: Mode strict
            allowed_chars: Caractères autorisés
            embedded: Texte intégré
            
        Returns:
            Dictionnaire avec les résultats de l'analyse
        """
        # Nettoyer le texte pour l'analyse
        clean_text = re.sub(r'[^A-Z]', '', text.upper())
        
        if not clean_text:
            return {
                "is_match": False,
                "fragments": [],
                "score": 0.0
            }
        
        # Pour Wolseley, difficile de détecter automatiquement
        # On considère que tout texte alphabétique peut être du Wolseley
        fragments = [clean_text] if clean_text else []
        
        return {
            "is_match": len(clean_text) >= 3,  # Au moins 3 caractères
            "fragments": fragments,
            "score": 0.6 if len(clean_text) >= 3 else 0.0
        }

    def decode_fragments(self, text: str, fragments: list) -> str:
        """
        Décode les fragments détectés dans leur contexte.
        
        Args:
            text: Texte original
            fragments: Fragments à décoder
            
        Returns:
            Texte avec fragments décodés
        """
        result = text
        for fragment in fragments:
            # Décoder avec une clé par défaut
            decoded = self.decode(fragment)
            result = result.replace(fragment, decoded)
        
        return result

    def get_text_score(self, text: str, context=None):
        """
        Obtient le score de confiance d'un texte décodé.
        
        Args:
            text: Texte à évaluer
            context: Contexte optionnel
            
        Returns:
            Résultat du scoring ou None
        """
        if not self.scoring_service:
            return None
            
        try:
            result = self.scoring_service.score_text(text, context)
            return result
        except Exception as e:
            print(f"Erreur lors de l'évaluation: {str(e)}")
            return None

    def bruteforce_decode(self, text: str, removed_letter: str = 'J', enable_scoring: bool = False) -> List[Dict]:
        """
        Mode bruteforce: teste différentes clés communes.
        
        Args:
            text: Texte à décoder
            removed_letter: Lettre supprimée
            enable_scoring: Activer le scoring
            
        Returns:
            Liste des résultats triés par confiance
        """
        results = []
        
        # Liste de clés communes à tester
        common_keys = [
            '', 'SECRET', 'CIPHER', 'CODE', 'KEY', 'WOLSELEY',
            'ALPHABET', 'ENIGMA', 'CRYPTO', 'DECODE', 'MYSTERE',
            'TRESOR', 'CACHE', 'GEOCACHING', 'MYSTERY'
        ]
        
        for i, key in enumerate(common_keys):
            try:
                decoded_text = self.decode(text, key, removed_letter)
                
                # Éviter les doublons
                if any(r['text_output'] == decoded_text for r in results):
                    continue
                
                confidence = 0.5  # Confiance par défaut
                scoring_result = None
                
                if enable_scoring and self.scoring_service:
                    scoring_result = self.get_text_score(decoded_text)
                    if scoring_result:
                        confidence = scoring_result.get('score', 0.5)
                
                result = {
                    "id": f"bruteforce_{i + 1}",
                    "text_output": decoded_text,
                    "confidence": confidence,
                    "parameters": {
                        "key": key if key else "(aucune clé - Atbash)",
                        "removed_letter": removed_letter
                    },
                    "metadata": {
                        "alphabet_used": self._generate_alphabet(key, removed_letter),
                        "method": "bruteforce"
                    }
                }
                
                if scoring_result:
                    result["scoring"] = scoring_result
                
                results.append(result)
                
            except Exception as e:
                print(f"Erreur avec la clé '{key}': {str(e)}")
                continue
        
        # Trier par confiance décroissante
        results.sort(key=lambda x: x['confidence'], reverse=True)
        
        return results

    def execute(self, inputs: dict) -> dict:
        """
        Point d'entrée principal du plugin.
        
        Args:
            inputs: Paramètres d'entrée
            
        Returns:
            Résultat au format standardisé
        """
        start_time = time.time()
        
        # Extraire les paramètres
        mode = inputs.get("mode", "decode").lower()
        text = inputs.get("text", "")
        key = inputs.get("key", "")
        removed_letter = inputs.get("removed_letter", "J")
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
        
        try:
            if mode == "encode":
                # Mode encodage
                encoded_text = self.encode(text, key, removed_letter)
                
                result = {
                    "id": "encode_result",
                    "text_output": encoded_text,
                    "confidence": 1.0,
                    "parameters": {
                        "key": key if key else "(aucune clé - Atbash)",
                        "removed_letter": removed_letter
                    },
                    "metadata": {
                        "alphabet_used": self._generate_alphabet(key, removed_letter),
                        "method": "encode"
                    }
                }
                
                standardized_response["results"].append(result)
                standardized_response["summary"]["best_result_id"] = "encode_result"
                standardized_response["summary"]["total_results"] = 1
                standardized_response["summary"]["message"] = "Encodage Wolseley réussi"
                
            elif mode == "decode":
                if not key:
                    # Mode bruteforce si pas de clé
                    results = self.bruteforce_decode(text, removed_letter, enable_scoring)
                    
                    standardized_response["results"] = results
                    if results:
                        standardized_response["summary"]["best_result_id"] = results[0]["id"]
                        standardized_response["summary"]["total_results"] = len(results)
                        standardized_response["summary"]["message"] = f"Bruteforce terminé - {len(results)} résultats trouvés"
                    else:
                        standardized_response["summary"]["message"] = "Aucun résultat probant trouvé"
                        standardized_response["status"] = "partial_success"
                else:
                    # Décodage avec clé spécifique
                    decoded_text = self.decode(text, key, removed_letter)
                    
                    confidence = 0.7  # Confiance par défaut avec clé
                    scoring_result = None
                    
                    if enable_scoring and self.scoring_service:
                        scoring_result = self.get_text_score(decoded_text)
                        if scoring_result:
                            confidence = scoring_result.get('score', 0.7)
                    
                    result = {
                        "id": "decode_result",
                        "text_output": decoded_text,
                        "confidence": confidence,
                        "parameters": {
                            "key": key,
                            "removed_letter": removed_letter
                        },
                        "metadata": {
                            "alphabet_used": self._generate_alphabet(key, removed_letter),
                            "method": "decode_with_key"
                        }
                    }
                    
                    if scoring_result:
                        result["scoring"] = scoring_result
                    
                    standardized_response["results"].append(result)
                    standardized_response["summary"]["best_result_id"] = "decode_result"
                    standardized_response["summary"]["total_results"] = 1
                    standardized_response["summary"]["message"] = "Décodage Wolseley avec clé réussi"
            
            else:
                standardized_response["status"] = "error"
                standardized_response["summary"]["message"] = f"Mode '{mode}' non supporté"
                
        except Exception as e:
            standardized_response["status"] = "error"
            standardized_response["summary"]["message"] = f"Erreur: {str(e)}"
            print(f"Erreur dans WolseleyPlugin.execute: {str(e)}")
        
        # Calculer le temps d'exécution
        end_time = time.time()
        execution_time = int((end_time - start_time) * 1000)  # en millisecondes
        standardized_response["plugin_info"]["execution_time"] = execution_time
        
        return standardized_response

# Point d'entrée pour le système de plugins
def execute(inputs):
    plugin = WolseleyPlugin()
    return plugin.execute(inputs) 