"""
Plugin Bifid de Delastelle pour MysterAI.
Le chiffre bifide a été inventé par Félix-Marie Delastelle en 1895.
"""

import re
import time
import os
import string
import importlib.util

# Import du service de scoring
try:
    from app.services.scoring_service import ScoringService
    scoring_service_available = True
except ImportError:
    scoring_service_available = False

# Import du module polybius_square pour réutiliser la logique de grille
try:
    polybius_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'polybius_square', 'main.py')
    if os.path.exists(polybius_path):
        spec = importlib.util.spec_from_file_location("polybius_square", polybius_path)
        polybius_module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(polybius_module)
        PolybiusSquarePlugin = polybius_module.PolybiusSquarePlugin
        polybius_available = True
    else:
        polybius_available = False
except Exception:
    polybius_available = False


class BifidDelastellePlugin:
    """Plugin pour encoder/décoder du texte avec le chiffre bifide de Delastelle."""
    
    def __init__(self):
        self.name = "bifid_delastelle"
        self.polybius_plugin = PolybiusSquarePlugin() if polybius_available else None
        self.scoring_service = None
        if scoring_service_available:
            try:
                self.scoring_service = ScoringService()
            except Exception:
                pass
        
    def create_polybius_grid(self, key="", grid_size="5x5", alphabet_mode="I=J"):
        """Crée une grille de Polybe."""
        if self.polybius_plugin:
            return self.polybius_plugin.create_polybius_grid(key, grid_size, alphabet_mode)
        else:
            return self._create_basic_grid(key, grid_size, alphabet_mode)
    
    def _create_basic_grid(self, key="", grid_size="5x5", alphabet_mode="I=J"):
        """Implémentation de base pour créer une grille de Polybe."""
        grid_dim = 6 if grid_size == "6x6" else 5
        
        if grid_size == "6x6":
            alphabet = list(string.ascii_uppercase) + list(string.digits)
        else:
            alphabet = list(string.ascii_uppercase)
            if alphabet_mode == "I=J" and "J" in alphabet:
                alphabet.remove("J")
            elif alphabet_mode == "C=K" and "K" in alphabet:
                alphabet.remove("K")
            elif alphabet_mode == "W=VV" and "W" in alphabet:
                alphabet.remove("W")
        
        if key:
            key = key.upper()
            unique_key_chars = []
            for char in key:
                if char in alphabet and char not in unique_key_chars:
                    unique_key_chars.append(char)
            for char in unique_key_chars:
                if char in alphabet:
                    alphabet.remove(char)
            alphabet = unique_key_chars + alphabet
        
        char_to_coords = {}
        coords_to_char = {}
        
        for i in range(grid_dim):
            for j in range(grid_dim):
                idx = i * grid_dim + j
                if idx < len(alphabet):
                    char = alphabet[idx]
                    char_to_coords[char] = (i + 1, j + 1)
                    coords_to_char[(i + 1, j + 1)] = char
        
        # Gérer les cas spéciaux pour le décodage
        if grid_size == "5x5":
            if alphabet_mode == "I=J":
                for coord, char in coords_to_char.items():
                    if char == "I":
                        char_to_coords["J"] = coord
            elif alphabet_mode == "C=K":
                for coord, char in coords_to_char.items():
                    if char == "C":
                        char_to_coords["K"] = coord
        
        return {
            "char_to_coords": char_to_coords,
            "coords_to_char": coords_to_char,
            "grid_dim": grid_dim
        }
    
    def encode(self, text, key="", grid_size="5x5", alphabet_mode="I=J", period=5, coordinate_order="ligne-colonne"):
        """Encode un texte en utilisant le chiffre bifide de Delastelle."""
        if not text:
            return ""
        
        grid_info = self.create_polybius_grid(key, grid_size, alphabet_mode)
        char_to_coords = grid_info["char_to_coords"]
        coords_to_char = grid_info["coords_to_char"]
        
        clean_text = text.upper().replace(" ", "")
        
        # Convertir les lettres en coordonnées
        coordinates = []
        for char in clean_text:
            if char in char_to_coords:
                row, col = char_to_coords[char]
                if coordinate_order == "colonne-ligne":
                    coordinates.append((col, row))
                else:
                    coordinates.append((row, col))
        
        # Regrouper par blocs de période et appliquer l'algorithme bifide
        result_coords = []
        for i in range(0, len(coordinates), period):
            block = coordinates[i:i + period]
            if len(block) == 0:
                continue
                
            # Séparer les coordonnées en deux listes
            first_coords = [coord[0] for coord in block]
            second_coords = [coord[1] for coord in block]
            
            # Concaténer horizontalement
            combined = first_coords + second_coords
            
            # Reformer les paires de coordonnées
            for j in range(0, len(combined) - 1, 2):
                if j + 1 < len(combined):
                    new_coord = (combined[j], combined[j + 1])
                    result_coords.append(new_coord)
        
        # Convertir en lettres
        result = ""
        for coord in result_coords:
            if coord in coords_to_char:
                result += coords_to_char[coord]
        
        return result
    
    def decode(self, text, key="", grid_size="5x5", alphabet_mode="I=J", period=5, coordinate_order="ligne-colonne"):
        """Décode un texte chiffré avec le chiffre bifide de Delastelle."""
        if not text:
            return ""
        
        grid_info = self.create_polybius_grid(key, grid_size, alphabet_mode)
        char_to_coords = grid_info["char_to_coords"]
        coords_to_char = grid_info["coords_to_char"]
        
        clean_text = text.upper().replace(" ", "")
        
        # Convertir les lettres en coordonnées
        coordinates = []
        for char in clean_text:
            if char in char_to_coords:
                row, col = char_to_coords[char]
                coordinates.append((row, col))
        
        # Regrouper par blocs et appliquer l'algorithme bifide inverse
        result_coords = []
        block_size = period * 2
        
        for i in range(0, len(coordinates), block_size):
            block = coordinates[i:i + block_size]
            if len(block) == 0:
                continue
            
            # Extraire les coordonnées du bloc chiffré
            coord_values = []
            for coord in block:
                coord_values.extend([coord[0], coord[1]])
            
            # Diviser en deux parties égales
            mid = len(coord_values) // 2
            first_half = coord_values[:mid]
            second_half = coord_values[mid:]
            
            # Reformer les coordonnées originales
            for j in range(min(len(first_half), len(second_half))):
                if coordinate_order == "colonne-ligne":
                    original_coord = (second_half[j], first_half[j])
                else:
                    original_coord = (first_half[j], second_half[j])
                result_coords.append(original_coord)
        
        # Convertir en lettres
        result = ""
        for coord in result_coords:
            if coord in coords_to_char:
                result += coords_to_char[coord]
        
        return result
    
    def check_code(self, text: str, strict: bool = False, allowed_chars=None, embedded: bool = False, 
                   key="", grid_size="5x5", alphabet_mode="I=J", period=5) -> dict:
        """Vérifie si le texte contient du code bifide valide."""
        if not text:
            return {"is_match": False, "fragments": [], "score": 0.0}
        
        grid_info = self.create_polybius_grid(key, grid_size, alphabet_mode)
        valid_chars = set(grid_info["char_to_coords"].keys())
        
        clean_text = text.upper().strip()
        fragments = []
        valid_char_count = 0
        total_chars = len(clean_text.replace(" ", ""))
        
        # Extraire les fragments alphabétiques
        alphabetic_fragments = re.findall(r'[A-Z]+', clean_text)
        
        for fragment in alphabetic_fragments:
            valid_chars_in_fragment = sum(1 for char in fragment if char in valid_chars)
            fragment_validity = valid_chars_in_fragment / len(fragment) if len(fragment) > 0 else 0
            
            if fragment_validity > 0.8:
                fragments.append(fragment)
                valid_char_count += valid_chars_in_fragment
        
        score = valid_char_count / total_chars if total_chars > 0 else 0.0
        if strict:
            score *= 0.8
        
        is_match = len(fragments) > 0 and score > 0.5
        
        return {
            "is_match": is_match,
            "fragments": fragments,
            "score": score
        }
    
    def get_text_score(self, text, context=None):
        """Obtient le score de confiance d'un texte décodé."""
        if not scoring_service_available or not self.scoring_service:
            return None
            
        try:
            cleaned_text = re.sub(r'\s+', ' ', text.strip())
            result = self.scoring_service.score_text(cleaned_text, context)
            return result
        except Exception:
            return None
    
    def execute(self, inputs: dict) -> dict:
        """Point d'entrée principal du plugin."""
        start_time = time.time()
        
        mode = inputs.get("mode", "decode").lower()
        text = inputs.get("text", "")
        strict_mode = inputs.get("strict", "").lower() == "strict"
        
        # Paramètres spécifiques au bifide
        key = inputs.get("key", "")
        grid_size = inputs.get("grid_size", "5x5")
        alphabet_mode = inputs.get("alphabet_mode", "I=J")
        period = int(inputs.get("period", 5))
        coordinate_order = inputs.get("coordinate_order", "ligne-colonne")
        
        # Scoring
        enable_scoring = inputs.get("enable_scoring", "") == "on"
        
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
                result = self.encode(text, key, grid_size, alphabet_mode, period, coordinate_order)
                response_result = {
                    "id": "result_1",
                    "text_output": result,
                    "confidence": 1.0,
                    "parameters": {
                        "mode": mode,
                        "key": key,
                        "grid_size": grid_size,
                        "alphabet_mode": alphabet_mode,
                        "period": period,
                        "coordinate_order": coordinate_order
                    },
                    "metadata": {
                        "processed_chars": len(text),
                        "output_chars": len(result)
                    }
                }
                
                standardized_response["results"].append(response_result)
                standardized_response["summary"]["best_result_id"] = "result_1"
                standardized_response["summary"]["total_results"] = 1
                standardized_response["summary"]["message"] = "Encodage réussi"
                
            elif mode == "decode":
                decoded_text = self.decode(text, key, grid_size, alphabet_mode, period, coordinate_order)
                
                confidence = 0.5
                scoring_result = None
                
                if enable_scoring:
                    context = inputs.get("context", {})
                    scoring_result = self.get_text_score(decoded_text, context)
                    if scoring_result:
                        confidence = scoring_result.get("score", 0.5)
                
                response_result = {
                    "id": "result_1",
                    "text_output": decoded_text,
                    "confidence": confidence,
                    "parameters": {
                        "mode": mode,
                        "key": key,
                        "grid_size": grid_size,
                        "alphabet_mode": alphabet_mode,
                        "period": period,
                        "coordinate_order": coordinate_order
                    },
                    "metadata": {
                        "processed_chars": len(text),
                        "output_chars": len(decoded_text)
                    }
                }
                
                if scoring_result:
                    response_result["scoring"] = scoring_result
                
                standardized_response["results"].append(response_result)
                standardized_response["summary"]["best_result_id"] = "result_1"
                standardized_response["summary"]["total_results"] = 1
                standardized_response["summary"]["message"] = "Décodage réussi"
                
        except Exception as e:
            standardized_response["status"] = "error"
            standardized_response["summary"]["message"] = f"Erreur: {str(e)}"
        
        execution_time = time.time() - start_time
        standardized_response["plugin_info"]["execution_time"] = execution_time
        
        return standardized_response


# Point d'entrée pour le système de plugins
def execute(inputs: dict) -> dict:
    """Point d'entrée principal pour le plugin Bifid de Delastelle."""
    plugin = BifidDelastellePlugin()
    return plugin.execute(inputs) 