"""
Plugin Chiffre des Nihilistes pour MysterAI.
Ce plugin implémente le chiffrement et déchiffrement utilisant le chiffre des Nihilistes,
un surchiffrement du carré de Polybe avec une clé additionnelle.
"""

import re
import time
import json
import os
import string
import itertools

# Import du service de scoring
try:
    from app.services.scoring_service import ScoringService
    print("Module de scoring disponible")
    scoring_service_available = True
except ImportError:
    print("Module de scoring non disponible")
    scoring_service_available = False

# Import du module polybius_square (réutilisation du code)
try:
    import sys
    import importlib.util
    
    # Chemin vers le module polybius_square
    polybius_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'polybius_square', 'main.py')
    
    if os.path.exists(polybius_path):
        # Charger dynamiquement le module
        spec = importlib.util.spec_from_file_location("polybius_square", polybius_path)
        polybius_module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(polybius_module)
        
        # Accéder à la classe PolybiusSquarePlugin
        PolybiusSquarePlugin = polybius_module.PolybiusSquarePlugin
        print("Module Polybius Square chargé avec succès")
        polybius_available = True
    else:
        print(f"Module Polybius Square non trouvé à {polybius_path}")
        polybius_available = False
except Exception as e:
    print(f"Erreur lors du chargement du module Polybius Square: {str(e)}")
    polybius_available = False


class NihilistCipherPlugin:
    """
    Classe principale du plugin pour le chiffrement/déchiffrement avec le chiffre des Nihilistes.
    Il s'agit d'un surchiffrement du carré de Polybe avec une clé additionnelle.
    """

    def __init__(self):
        """
        Initialisation du plugin Nihilist Cipher.
        Configure le nom, la version, le scoring et les options par défaut.
        """
        self.name = "nihilist_cipher"
        self.version = "1.0.0"
        
        # Configuration du service de scoring
        self.scoring_service = None
        if scoring_service_available:
            try:
                self.scoring_service = ScoringService()
                print("Service de scoring initialisé")
            except Exception as e:
                print(f"Erreur lors de l'initialisation du service de scoring: {str(e)}")
        
        # Options par défaut
        self.default_alphabet_mode = "I=J"
        self.default_output_format = "separated"
        
        # Créer une instance de PolybiusSquarePlugin pour réutiliser ses fonctionnalités
        self.polybius_plugin = None
        if polybius_available:
            try:
                self.polybius_plugin = PolybiusSquarePlugin()
                print("Plugin Polybius Square initialisé")
            except Exception as e:
                print(f"Erreur lors de l'initialisation du plugin Polybius Square: {str(e)}")

    def create_grid(self, grid_key="", alphabet_mode="I=J"):
        """
        Crée une grille de Polybe 5x5 pour le chiffrement/déchiffrement.
        
        Args:
            grid_key: Mot-clé pour mélanger l'alphabet dans la grille
            alphabet_mode: Mode de fusion des lettres pour la grille 5x5 (I=J, C=K, W=VV)
            
        Returns:
            Dictionnaire contenant la grille et les mappings (char_to_coords, coords_to_char)
        """
        if not self.polybius_plugin:
            raise ValueError("Le plugin Polybius Square n'est pas disponible")
            
        # Toujours utiliser une grille 5x5 avec le mode d'alphabet spécifié
        grid_size = "5x5"  # Fixe à 5x5
            
        # Utiliser la méthode de création de grille du plugin Polybius Square
        result = self.polybius_plugin.create_polybius_grid(grid_key, grid_size, alphabet_mode)
        
        # Récupérer les mappings créés par le plugin Polybius Square
        self.grid = result['grid']
        self.char_to_coords = result['char_to_coords']
        self.coords_to_char = result['coords_to_char']
        
        # Dimensions fixes à 5x5
        self.rows = self.cols = 5
        
        return {
            "grid": self.grid,
            "char_to_coords": self.char_to_coords,
            "coords_to_char": self.coords_to_char,
            "rows": self.rows,
            "cols": self.cols
        }
    
    def encode_text_to_coordinates(self, text):
        """
        Convertit un texte en coordonnées selon la grille de Polybe.
        
        Args:
            text: Le texte à convertir en coordonnées
            
        Returns:
            Liste des coordonnées correspondant au texte
        """
        if not self.polybius_plugin:
            raise ValueError("Le plugin Polybius Square n'est pas disponible")
            
        coordinates = []
        
        # Nettoyer et normaliser le texte
        text = text.upper()
        
        # Convertir chaque caractère en coordonnées
        for char in text:
            if char in self.char_to_coords:
                row, col = self.char_to_coords[char]
                coordinates.append((row, col))
            else:
                # Ignorer les caractères non présents dans la grille
                pass
                
        return coordinates
        
    def encode_key_to_coordinates(self, key):
        """
        Convertit une clé en coordonnées selon la grille de Polybe.
        
        Args:
            key: La clé à convertir en coordonnées
            
        Returns:
            Liste des coordonnées correspondant à la clé
        """
        # Utiliser la même méthode que pour encoder le texte
        return self.encode_text_to_coordinates(key)
        
    def add_coordinates(self, text_coords, key_coords):
        """
        Additionne les coordonnées du texte avec celles de la clé.
        La clé est répétée autant de fois que nécessaire.
        
        Args:
            text_coords: Liste des coordonnées du texte à chiffrer
            key_coords: Liste des coordonnées de la clé
            
        Returns:
            Liste des coordonnées après addition
        """
        if not text_coords or not key_coords:
            return []
            
        result = []
        key_length = len(key_coords)
        
        for i, text_coord in enumerate(text_coords):
            # Récupérer les coordonnées de la clé (répétée si nécessaire)
            key_coord = key_coords[i % key_length]
            
            # Additionner les coordonnées
            row_sum = text_coord[0] + key_coord[0]
            col_sum = text_coord[1] + key_coord[1]
            
            # Ajouter le résultat de l'addition
            result.append((row_sum, col_sum))
            
        return result
        
    def subtract_coordinates(self, cipher_coords, key_coords):
        """
        Soustrait les coordonnées de la clé des coordonnées chiffrées.
        La clé est répétée autant de fois que nécessaire.
        
        Args:
            cipher_coords: Liste des coordonnées chiffrées
            key_coords: Liste des coordonnées de la clé
            
        Returns:
            Liste des coordonnées après soustraction
        """
        if not cipher_coords or not key_coords:
            return []
            
        result = []
        key_length = len(key_coords)
        
        for i, cipher_coord in enumerate(cipher_coords):
            # Récupérer les coordonnées de la clé (répétée si nécessaire)
            key_coord = key_coords[i % key_length]
            
            # Soustraire les coordonnées
            row_diff = cipher_coord[0] - key_coord[0]
            col_diff = cipher_coord[1] - key_coord[1]
            
            # Ajouter le résultat de la soustraction
            result.append((row_diff, col_diff))
            
        return result
        
    def format_coordinates(self, coords, output_format="separated"):
        """
        Formate les coordonnées en fonction du format de sortie spécifié.
        
        Args:
            coords: Liste des coordonnées à formater
            output_format: Format de sortie (separated ou concatenated)
            
        Returns:
            Texte formaté représentant les coordonnées
        """
        if not coords:
            return ""
            
        # Convertir les coordonnées en paires de chiffres
        number_pairs = [f"{row}{col}" for row, col in coords]
        
        # Formater selon le format de sortie
        if output_format == "separated":
            return " ".join(number_pairs)
        else:  # concatenated
            return "".join(number_pairs)
            
    def parse_coordinates(self, text):
        """
        Analyse un texte pour extraire les coordonnées qu'il contient.
        Supporte les formats séparés par des espaces ou concaténés.
        
        Args:
            text: Texte contenant les coordonnées
            
        Returns:
            Liste des coordonnées extraites
        """
        if not text:
            return []
            
        coordinates = []
        
        # Nettoyer le texte (supprimer les caractères non numériques)
        text = re.sub(r'[^0-9\s]', '', text.strip())
        
        # Détecter si le format est séparé ou concaténé
        if " " in text:
            # Format séparé par des espaces
            pairs = text.split()
            for pair in pairs:
                if len(pair) >= 2:
                    row = int(pair[0])
                    col = int(pair[1])
                    coordinates.append((row, col))
        else:
            # Format concaténé (diviser en paires de chiffres)
            for i in range(0, len(text), 2):
                if i + 1 < len(text):
                    row = int(text[i])
                    col = int(text[i+1])
                    coordinates.append((row, col))
                    
        return coordinates
        
    def encode(self, text, key, output_format="separated", grid_key="", 
               alphabet_mode="I=J"):
        """
        Encode un texte avec le chiffre des Nihilistes.
        
        Args:
            text: Texte à encoder
            key: Clé de surchiffrement
            output_format: Format de sortie (separated ou concatenated)
            grid_key: Mot-clé pour mélanger l'alphabet de la grille (optionnel)
            alphabet_mode: Mode de fusion des lettres (I=J, C=K, W=VV)
            
        Returns:
            Texte encodé selon le chiffre des Nihilistes
        """
        # Vérifier les paramètres
        if not text or not key:
            return ""
            
        # Créer la grille
        self.create_grid(grid_key, alphabet_mode)
        
        # Convertir le texte en coordonnées
        text_coords = self.encode_text_to_coordinates(text)
        if not text_coords:
            return ""
            
        # Convertir la clé en coordonnées
        key_coords = self.encode_key_to_coordinates(key)
        if not key_coords:
            return ""
            
        # Additionner les coordonnées
        result_coords = self.add_coordinates(text_coords, key_coords)
        
        # Formater le résultat
        return self.format_coordinates(result_coords, output_format)
        
    def decode(self, text, key, grid_key="", alphabet_mode="I=J"):
        """
        Décode un texte avec le chiffre des Nihilistes.
        
        Args:
            text: Texte à décoder (format séparé ou concaténé)
            key: Clé de surchiffrement
            grid_key: Mot-clé pour mélanger l'alphabet de la grille (optionnel)
            alphabet_mode: Mode de fusion des lettres (I=J, C=K, W=VV)
            
        Returns:
            Texte décodé
        """
        # Vérifier les paramètres
        if not text or not key:
            return ""
            
        # Créer la grille
        self.create_grid(grid_key, alphabet_mode)
        
        # Analyser le texte pour extraire les coordonnées
        cipher_coords = self.parse_coordinates(text)
        if not cipher_coords:
            return ""
            
        # Convertir la clé en coordonnées
        key_coords = self.encode_key_to_coordinates(key)
        if not key_coords:
            return ""
            
        # Soustraire les coordonnées de la clé
        result_coords = self.subtract_coordinates(cipher_coords, key_coords)
        
        # Convertir les coordonnées en texte
        result = []
        for row, col in result_coords:
            coord = (row, col)
            if coord in self.coords_to_char:
                result.append(self.coords_to_char[coord])
            else:
                # Coordonnée invalide
                result.append("?")
                
        return ''.join(result)
        
    def check_code(self, text, strict=False, allowed_chars=None, embedded=False):
        """
        Vérifie si le texte contient des coordonnées chiffrées au format Nihiliste.
        
        Args:
            text: Texte à analyser
            strict: Si True, tout le texte doit être du code Nihiliste
            allowed_chars: Caractères autorisés en plus du code en mode non strict
            embedded: Si True, le code peut être intégré dans un texte plus large
            
        Returns:
            Dictionnaire avec les résultats de l'analyse
        """
        if not text:
            return {"is_match": False, "score": 0, "fragments": []}
            
        # Définir les caractères autorisés en mode non strict
        if allowed_chars is None:
            allowed_chars = " ,.;:!?-_\n\r\t"
            
        # Extraire les fragments potentiels de code Nihiliste
        fragments = self._extract_nihilist_fragments(text)
        
        # Vérifier si des fragments ont été trouvés
        if not fragments:
            return {"is_match": False, "score": 0, "fragments": []}
            
        # En mode strict, tout le texte doit être du code Nihiliste
        if strict and not embedded:
            # Vérifier que tout le texte est couvert par les fragments
            # et qu'il n'y a qu'un seul fragment
            if len(fragments) == 1 and fragments[0]["start"] == 0 and fragments[0]["end"] == len(text):
                return {"is_match": True, "score": 0.9, "fragments": fragments}
            else:
                return {"is_match": False, "score": 0, "fragments": []}
        else:
            # En mode non strict ou embedded, au moins un fragment valide suffit
            # Calculer un score basé sur la proportion de texte qui est du code Nihiliste
            total_length = len(text)
            nihilist_length = sum(len(f["value"]) for f in fragments)
            
            # Éviter la division par zéro
            if total_length == 0:
                score = 0
            else:
                score = min(0.8, nihilist_length / total_length)
                
            return {"is_match": True, "score": score, "fragments": fragments}
    
    def _extract_nihilist_fragments(self, text):
        """
        Extrait les fragments de code Nihiliste du texte.
        Le code Nihiliste est composé de paires de chiffres, soit séparées par des espaces,
        soit concaténées.
        
        Args:
            text: Texte à analyser
            
        Returns:
            Liste des fragments de code Nihiliste trouvés
        """
        fragments = []
        
        # Pattern pour les paires de chiffres séparées par des espaces
        # (ex: "25 31 42 15")
        pattern_separated = r'\b([1-9][0-9](?:\s+[1-9][0-9])+)\b'
        
        # Pattern pour les paires de chiffres concaténées (ex: "25314215")
        # Doit avoir au moins 4 chiffres (2 paires) et être de longueur paire
        pattern_concatenated = r'\b([1-9][0-9]{3,}[0-9]*)\b'
        
        # Rechercher les fragments séparés
        for match in re.finditer(pattern_separated, text):
            fragment = {
                "start": match.start(),
                "end": match.end(),
                "value": match.group(),
                "format": "separated",
                "type": "nihilist_cipher"
            }
            
            # Vérifier que les nombres correspondent bien à des paires valides
            coords = self.parse_coordinates(fragment["value"])
            if coords:
                fragment["coords"] = coords
                fragments.append(fragment)
        
        # Rechercher les fragments concaténés
        for match in re.finditer(pattern_concatenated, text):
            value = match.group()
            
            # Vérifier que la longueur est paire (chaque paire fait 2 chiffres)
            if len(value) % 2 == 0:
                fragment = {
                    "start": match.start(),
                    "end": match.end(),
                    "value": value,
                    "format": "concatenated",
                    "type": "nihilist_cipher"
                }
                
                # Vérifier que les nombres correspondent bien à des paires valides
                coords = self.parse_coordinates(fragment["value"])
                if coords:
                    fragment["coords"] = coords
                    fragments.append(fragment)
        
        return fragments
        
    def decode_fragments(self, text, fragments, key):
        """
        Décode uniquement les fragments de code Nihiliste détectés dans le texte.
        
        Args:
            text: Texte contenant les fragments à décoder
            fragments: Liste des fragments de code Nihiliste détectés
            key: Clé de surchiffrement
            
        Returns:
            Texte avec les fragments décodés
        """
        # Si aucun fragment ou pas de clé, retourner le texte original
        if not fragments or not key:
            return text
            
        # Convertir la clé en coordonnées
        key_coords = self.encode_key_to_coordinates(key)
        if not key_coords:
            return text
            
        # Trier les fragments par position de début (pour éviter les chevauchements)
        sorted_fragments = sorted(fragments, key=lambda f: f["start"])
        
        # Créer une liste de caractères à partir du texte original pour pouvoir le modifier
        result_chars = list(text)
        
        # Traiter chaque fragment
        for fragment in sorted_fragments:
            # Extraire les coordonnées du fragment
            cipher_coords = self.parse_coordinates(fragment["value"])
            if not cipher_coords:
                continue
                
            # Soustraire les coordonnées de la clé
            result_coords = self.subtract_coordinates(cipher_coords, key_coords)
            
            # Convertir les coordonnées en texte
            decoded_chars = []
            for coord in result_coords:
                if coord in self.coords_to_char:
                    decoded_chars.append(self.coords_to_char[coord])
                else:
                    decoded_chars.append("?")
            
            # Remplacer le fragment par sa version décodée
            decoded_text = ''.join(decoded_chars)
            
            # Calculer la longueur du fragment original et du texte décodé
            fragment_length = fragment["end"] - fragment["start"]
            decoded_length = len(decoded_text)
            
            # Ajuster le texte décodé pour qu'il ait la même longueur que le fragment original
            if decoded_length < fragment_length:
                # Ajouter des espaces si le texte décodé est plus court
                decoded_text = decoded_text + ' ' * (fragment_length - decoded_length)
            elif decoded_length > fragment_length:
                # Tronquer si le texte décodé est plus long
                decoded_text = decoded_text[:fragment_length]
            
            # Remplacer le fragment dans le texte résultat
            for j in range(fragment_length):
                if j < len(decoded_text):
                    result_chars[fragment["start"] + j] = decoded_text[j]
        
        return ''.join(result_chars)
        
    def _clean_text_for_scoring(self, text):
        """
        Nettoie le texte décodé pour le scoring.
        Supprime les caractères spéciaux pour une évaluation plus précise.
        
        Args:
            text: Le texte décodé à nettoyer
            
        Returns:
            Le texte nettoyé prêt pour le scoring
        """
        # Supprimer tout caractère non-alphanumérique (sauf espaces)
        cleaned = re.sub(r'[^\w\s]', '', text)
        
        # Supprimer les espaces multiples
        cleaned = re.sub(r'\s+', ' ', cleaned).strip()
        
        return cleaned
        
    def get_text_score(self, text, context=None):
        """
        Obtient le score de confiance d'un texte décodé en utilisant le service de scoring.
        
        Args:
            text: Le texte à évaluer
            context: Contexte optionnel (coordonnées de géocache, région, etc.)
            
        Returns:
            Dictionnaire contenant le résultat du scoring, ou None en cas d'erreur
        """
        if not self.scoring_service:
            return None
            
        try:
            # Nettoyer le texte avant le scoring
            cleaned_text = self._clean_text_for_scoring(text)
            
            # Appel direct au service de scoring local
            result = self.scoring_service.score_text(cleaned_text, context)
            return result
        except Exception as e:
            print(f"Erreur lors de l'évaluation avec le service de scoring: {str(e)}")
            return None
            
    def execute(self, inputs):
        """
        Point d'entrée principal du plugin.
        
        Args:
            inputs: Dictionnaire contenant les paramètres d'entrée
                - mode: "encode" ou "decode"
                - text: Texte à encoder ou décoder
                - key: Clé de surchiffrement
                - grid_key: Mot-clé pour mélanger l'alphabet de la grille (optionnel)
                - alphabet_mode: Mode de fusion des lettres (I=J, C=K, W=VV) (optionnel)
                - output_format: Format de sortie (optionnel)
                - strict: Mode strict ou smooth (optionnel)
                
        Returns:
            Dictionnaire au format standardisé contenant le résultat de l'opération
        """
        # Mesurer le temps d'exécution
        start_time = time.time()
        
        # Récupérer et valider les paramètres d'entrée
        mode = inputs.get("mode", "decode").lower()
        text = inputs.get("text", "")
        key = inputs.get("key", "")
        grid_key = inputs.get("grid_key", "")
        alphabet_mode = inputs.get("alphabet_mode", "I=J")
        output_format = inputs.get("output_format", self.default_output_format).lower()
        
        # Grille toujours fixée à 5x5
        grid_size = "5x5"
        
        # Mode strict si la valeur est exactement "strict"
        strict_mode = inputs.get("strict", "").lower() == "strict"
        
        # Récupération des caractères autorisés
        allowed_chars = inputs.get("allowed_chars", " ,.;:!?-_\n\r\t")
        
        # Récupération du mode embedded
        embedded = inputs.get("embedded", False)
        
        # Le scoring est automatiquement activé selon la configuration du plugin.json
        enable_scoring = True
        
        # Extraire le contexte pour le scoring (si présent)
        context = inputs.get('context', {})
        
        # Initialiser la structure standardisée de réponse
        result = {
            "status": "success",
            "plugin_info": {
                "name": self.name,
                "version": self.version,
                "execution_time": 0  # Sera mis à jour à la fin
            },
            "inputs": inputs,
            "results": [],
            "summary": {
                "total_results": 0,
                "best_result_id": None
            }
        }

        if not text:
            result["status"] = "error"
            result["summary"]["message"] = "Aucun texte fourni à traiter."
            return result
            
        if not key and mode != "decode_fragments":
            result["status"] = "error"
            result["summary"]["message"] = "Clé de surchiffrement requise."
            return result

        # Créer la grille pour le chiffrement/déchiffrement
        try:
            self.create_grid(grid_key, alphabet_mode)
        except Exception as e:
            result["status"] = "error"
            result["summary"]["message"] = f"Erreur lors de la création de la grille: {str(e)}"
            return result

        try:
            if mode == "encode":
                # Réaliser l'encodage avec le chiffre des Nihilistes
                encoded = self.encode(text, key, output_format, grid_key, 
                                      alphabet_mode)
                
                # Ajouter le résultat au format standardisé
                result_item = {
                    "id": "result_1",
                    "text_output": encoded,
                    "confidence": 1.0,  # Confiance maximale pour l'encodage
                    "parameters": {
                        "mode": mode,
                        "key": key,
                        "output_format": output_format,
                        "alphabet_mode": alphabet_mode
                    },
                    "metadata": {
                        "processed_chars": len(text),
                        "key_length": len(key)
                    }
                }
                
                result["results"].append(result_item)
                result["summary"]["total_results"] = 1
                result["summary"]["best_result_id"] = "result_1"
                result["summary"]["message"] = "Texte encodé avec succès"
                
            elif mode == "decode":
                # Vérifier d'abord si le texte contient du code Nihiliste
                check_result = self.check_code(text, strict_mode, allowed_chars, embedded)
                
                if check_result["is_match"]:
                    # En fonction du mode strict/embedded, décoder tout le texte ou juste les fragments
                    if strict_mode and not embedded:
                        # Décoder tout le texte en mode strict
                        decoded = self.decode(text, key, grid_key, alphabet_mode)
                        confidence = 0.9  # Confiance élevée en mode strict
                    else:
                        # Décoder seulement les fragments de code identifiés
                        decoded = self.decode_fragments(text, check_result["fragments"], key)
                        confidence = check_result["score"]
                    
                    # Évaluer la pertinence du résultat avec le scoring si activé
                    scoring_result = None
                    if enable_scoring and self.scoring_service:
                        scoring_result = self.get_text_score(decoded, context)
                        if scoring_result:
                            # Utiliser le score obtenu comme niveau de confiance
                            confidence = scoring_result.get("score", confidence)
                    
                    # Construire le résultat
                    result_item = {
                        "id": "result_1",
                        "text_output": decoded,
                        "confidence": confidence,
                        "parameters": {
                            "mode": mode,
                            "key": key,
                            "strict": strict_mode,
                            "alphabet_mode": alphabet_mode
                        },
                        "metadata": {
                            "processed_chars": len(text),
                            "fragments_found": len(check_result["fragments"]),
                            "key_length": len(key)
                        }
                    }
                    
                    # Ajouter les informations de scoring si disponibles
                    if scoring_result:
                        result_item["scoring"] = scoring_result
                    
                    result["results"].append(result_item)
                    result["summary"]["best_result_id"] = "result_1"
                    result["summary"]["total_results"] = 1
                    result["summary"]["message"] = "Décodage réussi"
                else:
                    result["status"] = "error"
                    result["summary"]["message"] = "Aucun code Nihiliste valide trouvé dans le texte"
            
            else:
                result["status"] = "error"
                result["summary"]["message"] = f"Mode non supporté: {mode}"
                
        except Exception as e:
            result["status"] = "error"
            result["summary"]["message"] = f"Erreur lors du traitement: {str(e)}"
            import traceback
            traceback.print_exc()
        
        # Calculer le temps d'exécution
        end_time = time.time()
        result["plugin_info"]["execution_time"] = end_time - start_time
        
        return result


# Créer une instance du plugin pour l'utilisation directe
plugin = NihilistCipherPlugin()
