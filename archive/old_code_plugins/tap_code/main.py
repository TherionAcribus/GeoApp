"""
Plugin Tap Code pour MysterAI.
Ce plugin implémente le chiffrement et déchiffrement utilisant le Tap Code,
basé sur une grille de Polybe fixe 5x5 sans la lettre K.
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


class TapCodePlugin:
    """
    Plugin pour encoder/décoder du texte avec le Tap Code.
    """
    
    def __init__(self):
        """
        Initialise le plugin Tap Code.
        """
        self.name = "tap_code"
        
        # Initialiser une instance de PolybiusSquarePlugin si disponible
        self.polybius_plugin = PolybiusSquarePlugin() if polybius_available else None
        
        # Initialiser le service de scoring si disponible
        self.scoring_service = None
        if scoring_service_available:
            try:
                self.scoring_service = ScoringService()
                print("Service de scoring local initialisé avec succès")
            except Exception as e:
                print(f"Erreur lors de l'initialisation du service de scoring: {str(e)}")
        
        print("Initialisation du plugin Tap Code...")
        
        # Création de la grille de Tap Code fixe (5x5, sans K)
        self.create_tap_code_grid()
        
    def create_tap_code_grid(self):
        """
        Crée la grille Tap Code standard (5x5 sans K).
        K est fusionné avec C dans le Tap Code.
        """
        # Créer l'alphabet standard (A-Z sans K)
        alphabet = list(string.ascii_uppercase)
        if "K" in alphabet:
            alphabet.remove("K")
        
        # Créer la grille 5x5
        self.grid = []
        self.char_to_coords = {}
        self.coords_to_char = {}
        
        # Remplir la grille ligne par ligne
        for i in range(5):
            row = []
            for j in range(5):
                # Calculer l'index dans l'alphabet
                idx = i * 5 + j
                
                # Vérifier si l'index est valide
                if idx < len(alphabet):
                    char = alphabet[idx]
                    row.append(char)
                    
                    # Enregistrer les mappings
                    self.char_to_coords[char] = (i + 1, j + 1)  # Coordonnées 1-indexées
                    self.coords_to_char[(i + 1, j + 1)] = char
                else:
                    # Remplir avec un espace si nécessaire (ne devrait pas se produire avec l'alphabet standard)
                    row.append(" ")
                    self.coords_to_char[(i + 1, j + 1)] = " "
            
            self.grid.append(row)
        
        # Ajouter le mapping spécial pour K -> C
        self.char_to_coords["K"] = self.char_to_coords["C"]
        
        # Créer le mapping inverse pour le décodage
        self.reverse_grid = {}
        for coord, char in self.coords_to_char.items():
            self.reverse_grid[coord] = char
            
    def format_tap_coordinates(self, row, col, output_format="taps"):
        """
        Convertit les coordonnées (ligne, colonne) dans le format Tap Code spécifié.
        
        Args:
            row: Numéro de ligne (1-5)
            col: Numéro de colonne (1-5)
            output_format: Format souhaité - "taps", "dots" ou "numbers"
            
        Returns:
            Les coordonnées formatées selon le format souhaité
        """
        if output_format == "dots":
            # Format avec points (ex: ". ..") pour la lettre B
            row_taps = "." * row
            col_taps = "." * col
            return f"{row_taps} {col_taps}"
        elif output_format == "numbers":
            # Format avec nombres (ex: "1 2" pour la lettre B)
            return f"{row} {col}"
        else:  # Format par défaut "taps"
            # Format avec X pour représenter les taps (ex: "X XX" pour la lettre B)
            row_taps = "X" * row
            col_taps = "X" * col
            return f"{row_taps} {col_taps}"
    
    def decode_tap_coordinates(self, text):
        """
        Tente de décoder les coordonnées Tap Code dans différents formats possibles.
        
        Args:
            text: Texte encodé à analyser
            
        Returns:
            Liste de tuples de coordonnées (ligne, colonne)
        """
        coords = []
        
        # Définir les patterns pour les différents formats
        patterns = [
            # Format "taps" avec X (ex: X XX)
            (r'(X+)\s+(X+)', lambda m: (len(m.group(1)), len(m.group(2)))),
            
            # Format "dots" avec points (ex: . ..)
            (r'(\.+)\s+(\.+)', lambda m: (len(m.group(1)), len(m.group(2)))),
            
            # Format "numbers" avec chiffres (ex: 1 2)
            (r'([1-5])\s+([1-5])', lambda m: (int(m.group(1)), int(m.group(2))))
        ]
        
        # Essayer chaque pattern
        for pattern, extract_func in patterns:
            matches = re.finditer(pattern, text)
            for match in matches:
                row, col = extract_func(match)
                if 1 <= row <= 5 and 1 <= col <= 5:  # Valider les coordonnées
                    coords.append((row, col))
        
        return coords
        
    def encode(self, text, output_format="taps"):
        """
        Encode un texte en utilisant le Tap Code.
        
        Args:
            text: Texte à encoder
            output_format: Format de sortie ("taps", "dots" ou "numbers")
            
        Returns:
            Texte encodé selon le format spécifié
        """
        # Convertir le texte en majuscules
        text = text.upper()
        
        # Encoder chaque caractère
        result = []
        for char in text:
            if char == ' ':
                # Préserver les espaces
                result.append(' ')
                continue
                
            # Vérifier si le caractère est dans la grille
            if char in self.char_to_coords:
                coords = self.char_to_coords[char]
                result.append(self.format_tap_coordinates(coords[0], coords[1], output_format))
        
        # Joindre les coordonnées formatées avec un espace
        return ' '.join(result)
        
    def decode(self, text):
        """
        Décode un texte encodé avec le Tap Code.
        
        Args:
            text: Texte encodé à décoder
            
        Returns:
            Texte décodé
        """
        # Extraire les coordonnées du texte encodé
        coordinates = self.decode_tap_coordinates(text)
        
        if not coordinates:
            return ""  # Aucune coordonnée valide trouvée
        
        # Décoder les coordonnées en caractères
        result = []
        for coord in coordinates:
            if coord in self.reverse_grid:
                result.append(self.reverse_grid[coord])
            else:
                result.append("?")  # Caractère inconnu
        
        return ''.join(result)
    
    def check_code(self, text: str, strict: bool = False, allowed_chars=None, embedded: bool = False) -> dict:
        """
        Vérifie si le texte contient du code Tap valide.
        
        Args:
            text: Texte à analyser
            strict: Si True, tout le texte doit être du code Tap valide
            allowed_chars: Caractères autorisés en plus du code Tap en mode non strict
            embedded: Si True, le code peut être intégré dans un texte plus large
            
        Returns:
            Dictionnaire avec les résultats de l'analyse
        """
        if not text:
            return {"is_match": False, "score": 0, "fragments": []}
            
        # Définir les caractères autorisés en mode non strict
        if allowed_chars is None:
            allowed_chars = " ,.;:!?-_"
            
        # Extraire les fragments de code Tap potentiels
        fragments = self._extract_tap_fragments(text)
        
        # Vérifier si des fragments ont été trouvés
        if not fragments:
            return {"is_match": False, "score": 0, "fragments": []}
            
        # En mode strict, tout le texte doit être du code Tap valide
        if strict and not embedded:
            # Vérifier que tout le texte est couvert par les fragments
            # et qu'il n'y a qu'un seul fragment
            if len(fragments) == 1 and fragments[0]["start"] == 0 and fragments[0]["end"] == len(text):
                return {"is_match": True, "score": 0.9, "fragments": fragments}
            else:
                return {"is_match": False, "score": 0, "fragments": []}
        else:
            # En mode non strict ou embedded, au moins un fragment valide suffit
            # Calculer un score basé sur la proportion de texte qui est du code Tap
            total_length = len(text)
            tap_length = sum(len(f["value"]) for f in fragments)
            
            # Éviter la division par zéro
            if total_length == 0:
                score = 0
            else:
                score = min(0.8, tap_length / total_length)
                
            return {"is_match": True, "score": score, "fragments": fragments}
    
    def _extract_tap_fragments(self, text):
        """
        Extrait les fragments de code Tap du texte.
        
        Args:
            text: Texte à analyser
            
        Returns:
            Liste des fragments de code Tap trouvés
        """
        fragments = []
        
        # Définir les patterns pour les différents formats de Tap Code
        patterns = [
            # Format "taps" avec X (ex: X XX)
            r'(X+)\s+(X+)',
            
            # Format "dots" avec points (ex: . ..)
            r'(\.+)\s+(\.+)',
            
            # Format "numbers" avec chiffres (ex: 1 2)
            r'([1-5])\s+([1-5])'
        ]
        
        # Combiner les patterns avec des OR logiques
        combined_pattern = "|".join(f"({p})" for p in patterns)
        
        # Trouver toutes les occurrences de coordonnées Tap Code
        matches = list(re.finditer(combined_pattern, text))
        
        # Si aucune coordonnée trouvée, retourner une liste vide
        if not matches:
            return []
        
        # Regrouper les coordonnées consécutives en fragments
        current_fragment = {
            "start": matches[0].start(),
            "end": matches[0].end(),
            "value": matches[0].group(),
            "coords": [],
            "type": "tap_code"
        }
        
        # Décoder les coordonnées du premier fragment
        coords = self.decode_tap_coordinates(matches[0].group())
        if coords:
            current_fragment["coords"] = coords
        
        for i in range(1, len(matches)):
            match = matches[i]
            prev_match = matches[i-1]
            
            # Vérifier si les coordonnées sont valides
            coords = self.decode_tap_coordinates(match.group())
            if not coords:
                continue
            
            # Vérifier si le fragment est contigu
            if match.start() - prev_match.end() <= 3:  # Autoriser jusqu'à 3 caractères entre les coordonnées
                # Ajouter au fragment existant
                current_fragment["end"] = match.end()
                current_fragment["value"] += text[prev_match.end():match.end()]
                current_fragment["coords"].extend(coords)
            else:
                # Ajouter le fragment précédent à la liste si valide
                if current_fragment["coords"]:
                    fragments.append(current_fragment)
                
                # Commencer un nouveau fragment
                current_fragment = {
                    "start": match.start(),
                    "end": match.end(),
                    "value": match.group(),
                    "coords": coords,
                    "type": "tap_code"
                }
        
        # Ajouter le dernier fragment s'il est valide
        if current_fragment["coords"]:
            fragments.append(current_fragment)
        
        return fragments
        
    def decode_fragments(self, text, fragments):
        """
        Décode uniquement les fragments de code Tap détectés dans le texte.
        
        Args:
            text: Texte contenant les fragments à décoder
            fragments: Liste des fragments de code Tap détectés
            
        Returns:
            Texte avec les fragments décodés
        """
        # Si aucun fragment, retourner le texte original
        if not fragments:
            return text
        
        # Trier les fragments par position de début (pour éviter les chevauchements)
        sorted_fragments = sorted(fragments, key=lambda f: f["start"])
        
        # Créer une liste de caractères à partir du texte original pour pouvoir le modifier
        result_chars = list(text)
        
        # Traiter chaque fragment
        for fragment in sorted_fragments:
            # Décoder les coordonnées du fragment
            decoded_chars = []
            for coord in fragment["coords"]:
                if coord in self.reverse_grid:
                    decoded_chars.append(self.reverse_grid[coord])
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
    
    def _clean_text_for_scoring(self, text: str) -> str:
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
            
    def execute(self, inputs: dict) -> dict:
        """
        Point d'entrée principal du plugin.
        
        Args:
            inputs: Dictionnaire contenant les paramètres d'entrée
                - mode: "encode" ou "decode"
                - text: Texte à encoder ou décoder
                - output_format: Format de sortie pour l'encodage
                - strict: "strict" ou "smooth" pour le mode de décodage
                - allowed_chars: Liste de caractères autorisés pour le mode smooth
                - embedded: True si le texte peut contenir du code intégré
                - enable_scoring: Activation du scoring automatique
                
        Returns:
            Dictionnaire au format standardisé contenant le résultat de l'opération
        """
        # Mesurer le temps d'exécution
        start_time = time.time()
        
        # Récupérer et valider les paramètres d'entrée
        mode = inputs.get("mode", "decode").lower()
        text = inputs.get("text", "")
        output_format = inputs.get("output_format", "taps").lower()
        
        # Considère le mode strict si la valeur du paramètre "strict" est exactement "strict"
        strict_mode = inputs.get("strict", "").lower() == "strict"
        
        # Récupération de la liste des caractères autorisés
        allowed_chars = inputs.get("allowed_chars", " ,.;:!?-_")
        
        # Récupération du mode embedded
        embedded = inputs.get("embedded", False)
        
        # Vérifier si le scoring automatique est activé
        enable_scoring = inputs.get('enable_scoring', False)
        if isinstance(enable_scoring, str):
            enable_scoring = enable_scoring.lower() == "on"
        print(f"Scoring activé: {enable_scoring}")
        
        # Extraire le contexte pour le scoring (si présent)
        context = inputs.get('context', {})
        
        # Initialiser la structure standardisée de réponse
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
                "total_results": 0,
                "best_result_id": None
            }
        }

        if not text:
            result["status"] = "error"
            result["summary"]["message"] = "Aucun texte fourni à traiter."
            return result

        try:
            if mode == "encode":
                # Réaliser l'encodage en fonction du format de sortie spécifié
                encoded = self.encode(text, output_format)
                
                # Ajouter le résultat au format standardisé
                result_item = {
                    "id": "result_1",
                    "text_output": encoded,
                    "confidence": 1.0,  # Confiance maximale pour l'encodage
                    "parameters": {
                        "mode": mode,
                        "output_format": output_format
                    },
                    "metadata": {
                        "processed_chars": len(text)
                    }
                }
                
                result["results"].append(result_item)
                result["summary"]["total_results"] = 1
                result["summary"]["best_result_id"] = "result_1"
                result["summary"]["message"] = "Texte encodé avec succès"
                
            elif mode == "decode":
                # Vérifier d'abord si le texte contient du code Tap
                check_result = self.check_code(text, strict_mode, allowed_chars, embedded)
                
                if check_result["is_match"]:
                    # En fonction du mode strict/embedded, décoder tout le texte ou juste les fragments
                    if strict_mode and not embedded:
                        # Décoder tout le texte en mode strict
                        decoded = self.decode(text)
                        confidence = 0.9  # Confiance élevée en mode strict
                    else:
                        # Décoder seulement les fragments de code identifiés
                        decoded = self.decode_fragments(text, check_result["fragments"])
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
                            "strict": strict_mode
                        },
                        "metadata": {
                            "processed_chars": len(text),
                            "fragments_found": len(check_result["fragments"])
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
                    result["summary"]["message"] = "Aucun code Tap valide trouvé dans le texte"
            
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


# Créer une instance du plugin
plugin = TapCodePlugin()
