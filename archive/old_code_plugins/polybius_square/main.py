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

class PolybiusSquarePlugin:
    """
    Plugin pour encoder/décoder du texte avec le carré de Polybe.
    """
    
    def __init__(self):
        """
        Initialise le plugin Polybius Square.
        """
        self.name = "polybius_square"
        
        # Initialiser le service de scoring si disponible
        self.scoring_service = None
        if scoring_service_available:
            try:
                self.scoring_service = ScoringService()
                print("Service de scoring local initialisé avec succès")
            except Exception as e:
                print(f"Erreur lors de l'initialisation du service de scoring: {str(e)}")
        
        print("Initialisation du plugin Polybius Square...")
                
    def create_polybius_grid(self, key="", grid_size="5x5", alphabet_mode="I=J"):
        """
        Crée une grille Polybe avec les options spécifiées.
        
        Args:
            key: Mot-clé optionnel pour mélanger l'alphabet
            grid_size: Taille de la grille ("5x5" ou "6x6")
            alphabet_mode: Mode de fusion des lettres pour la grille 5x5 ("I=J", "C=K", "W=VV")
            
        Returns:
            Dictionnaire contenant la grille et les mappings
        """
        # Déterminer la dimension de la grille
        grid_dim = 6 if grid_size == "6x6" else 5
        
        # Créer l'alphabet de base selon la taille de la grille
        if grid_size == "6x6":
            # Grille 6x6: alphabet complet + chiffres
            alphabet = list(string.ascii_uppercase) + list(string.digits)
        else:
            # Grille 5x5: alphabet avec fusion de lettres selon le mode
            alphabet = list(string.ascii_uppercase)
            
            # Appliquer le mode d'alphabet pour la grille 5x5
            if alphabet_mode == "I=J":
                # Fusionner I et J (retirer J)
                if "J" in alphabet:
                    alphabet.remove("J")
            elif alphabet_mode == "C=K":
                # Fusionner C et K (retirer K)
                if "K" in alphabet:
                    alphabet.remove("K")
            elif alphabet_mode == "W=VV":
                # Remplacer W par VV (retirer W)
                if "W" in alphabet:
                    alphabet.remove("W")
        
        # Appliquer le mot-clé si fourni
        if key:
            # Convertir la clé en majuscules et retirer les doublons
            key = key.upper()
            unique_key_chars = []
            
            # Ajouter uniquement les caractères uniques de la clé
            for char in key:
                if char in alphabet and char not in unique_key_chars:
                    unique_key_chars.append(char)
            
            # Retirer les caractères de la clé de l'alphabet
            for char in unique_key_chars:
                if char in alphabet:  # Vérifier que le caractère est toujours dans l'alphabet
                    alphabet.remove(char)
            
            # Combiner la clé et l'alphabet restant
            alphabet = unique_key_chars + alphabet
        
        # Créer la grille
        grid = []
        char_to_coords = {}
        coords_to_char = {}
        
        # Remplir la grille ligne par ligne
        for i in range(grid_dim):
            row = []
            for j in range(grid_dim):
                # Calculer l'index dans l'alphabet
                idx = i * grid_dim + j
                
                # Vérifier si l'index est valide
                if idx < len(alphabet):
                    char = alphabet[idx]
                    row.append(char)
                    
                    # Enregistrer les mappings
                    char_to_coords[char] = (i + 1, j + 1)  # Coordonnées 1-indexées
                    coords_to_char[(i + 1, j + 1)] = char
                else:
                    # Remplir avec un espace si nécessaire
                    row.append(" ")
                    coords_to_char[(i + 1, j + 1)] = " "
            
            grid.append(row)
        
        # Gérer les cas spéciaux pour le décodage
        if grid_size == "5x5":
            if alphabet_mode == "I=J":
                # J est décodé comme I
                for coord, char in coords_to_char.items():
                    if char == "I":
                        char_to_coords["J"] = coord
            elif alphabet_mode == "C=K":
                # K est décodé comme C
                for coord, char in coords_to_char.items():
                    if char == "C":
                        char_to_coords["K"] = coord
        
        # Créer un mapping inverse pour le décodage
        reverse_grid = {}
        for coord, char in coords_to_char.items():
            reverse_grid[coord] = char
        
        return {
            "grid": grid,
            "grid_dim": grid_dim,
            "char_to_coords": char_to_coords,
            "coords_to_char": coords_to_char,
            "reverse_grid": reverse_grid
        }

    def format_coordinates(self, row, col, output_format="numbers"):
        """
        Convertit les coordonnées (ligne, colonne) dans le format spécifié.
        
        Args:
            row: Numéro de ligne (1-6)
            col: Numéro de colonne (1-6)
            output_format: Format souhaité - "numbers" ou "coordinates"
            
        Returns:
            Les coordonnées formatées selon le format souhaité
        """
        if output_format == "coordinates":
            return f"({row},{col})"
        else:  # Par défaut: "numbers"
            return f"{row}{col}"
    
    def decode_coordinates(self, text, grid_dim=5):
        """
        Tente de décoder les coordonnées dans différents formats possibles.
        
        Args:
            text: Texte encodé à analyser
            grid_dim: Dimension de la grille (5 pour 5x5, 6 pour 6x6)
            
        Returns:
            Liste de tuples de coordonnées (ligne, colonne)
        """
        coords = []
        
        # Essayer format "numbers" (11, 12, 21, etc.)
        number_pattern = r'(\d{2})'
        number_matches = re.findall(number_pattern, text)
        if number_matches:
            for match in number_matches:
                if len(match) == 2:
                    row = int(match[0])
                    col = int(match[1])
                    if 1 <= row <= grid_dim and 1 <= col <= grid_dim:
                        coords.append((row, col))
        
        # Si aucune coordonnée n'a été trouvée, essayer format "coordinates" ((1,1), (1,2), etc.)
        if not coords:
            coord_pattern = r'\(\s*(\d)\s*,\s*(\d)\s*\)'
            coord_matches = re.findall(coord_pattern, text)
            if coord_matches:
                for match in coord_matches:
                    row = int(match[0])
                    col = int(match[1])
                    if 1 <= row <= grid_dim and 1 <= col <= grid_dim:
                        coords.append((row, col))
        
        return coords
        
    def encode(self, text, key="", output_format="numbers", grid_size="5x5", alphabet_mode="I=J"):
        """
        Encode un texte en utilisant le carré de Polybe.
        
        Args:
            text: Texte à encoder
            key: Mot-clé optionnel pour la grille Polybe
            output_format: Format de sortie ("numbers" ou "coordinates")
            grid_size: Taille de la grille ("5x5" ou "6x6")
            alphabet_mode: Mode de fusion des lettres pour la grille 5x5 ("I=J", "C=K", "W=VV")
            
        Returns:
            Texte encodé selon le format spécifié
        """
        # Créer la grille Polybe
        grid_data = self.create_polybius_grid(key, grid_size, alphabet_mode)
        
        # Convertir le texte en majuscules
        text = text.upper()
        
        # Encoder chaque caractère
        result = []
        for char in text:
            if char == ' ':
                # Préserver les espaces
                result.append(' ')
                continue
                
            # Gérer le cas spécial W=VV
            if alphabet_mode == "W=VV" and grid_size == "5x5" and char == 'W':
                # W est encodé comme deux V consécutifs
                if 'V' in grid_data["char_to_coords"]:
                    v_coords = grid_data["char_to_coords"]['V']
                    result.append(self.format_coordinates(v_coords[0], v_coords[1], output_format))
                    result.append(self.format_coordinates(v_coords[0], v_coords[1], output_format))
                continue
                
            # Vérifier si le caractère est dans la grille
            if char in grid_data["char_to_coords"]:
                coords = grid_data["char_to_coords"][char]
                result.append(self.format_coordinates(coords[0], coords[1], output_format))
        
        # Joindre les coordonnées formatées
        return ''.join(result)
        
    def decode(self, text, key="", grid_size="5x5", alphabet_mode="I=J"):
        """
        Décode un texte encodé avec le carré de Polybe.
        
        Args:
            text: Texte encodé à décoder
            key: Mot-clé optionnel utilisé pour l'encodage
            grid_size: Taille de la grille ("5x5" ou "6x6")
            alphabet_mode: Mode de fusion des lettres pour la grille 5x5 ("I=J", "C=K", "W=VV")
            
        Returns:
            Texte décodé
        """
        # Créer la grille Polybe
        grid_data = self.create_polybius_grid(key, grid_size, alphabet_mode)
        reverse_grid = grid_data["reverse_grid"]
        
        # Déterminer la dimension de la grille
        grid_dim = 6 if grid_size == "6x6" else 5
        
        # Préserver les espaces
        result = []
        parts = text.split(' ')
        
        for idx, part in enumerate(parts):
            if not part:  # Si c'est une chaîne vide (plusieurs espaces consécutifs)
                if idx > 0:  # Ne pas ajouter d'espace au début
                    result.append(' ')
                continue
                
            # Extraire les coordonnées du texte encodé
            coordinates = self.decode_coordinates(part, grid_dim)
            
            if not coordinates:
                continue  # Aucune coordonnée valide trouvée dans cette partie
            
            # Décoder les coordonnées en caractères
            decoded_chars = []
            i = 0
            while i < len(coordinates):
                coord = coordinates[i]
                
                # Gérer le cas spécial W=VV
                if alphabet_mode == "W=VV" and grid_size == "5x5" and i < len(coordinates) - 1:
                    next_coord = coordinates[i + 1]
                    if coord in reverse_grid and next_coord in reverse_grid:
                        if reverse_grid[coord] == "V" and reverse_grid[next_coord] == "V":
                            decoded_chars.append("W")
                            i += 2  # Sauter le prochain V
                            continue
                
                # Décoder la coordonnée normale
                if coord in reverse_grid:
                    decoded_chars.append(reverse_grid[coord])
                else:
                    decoded_chars.append("?")  # Caractère inconnu
                    
                i += 1
            
            result.append(''.join(decoded_chars))
            
            # Ajouter un espace après chaque partie sauf la dernière
            if idx < len(parts) - 1:
                result.append(' ')
        
        return ''.join(result)
        
    def check_code(self, text: str, strict: bool = False, allowed_chars=None, embedded: bool = False, grid_size="5x5", alphabet_mode="I=J") -> dict:
        """
        Vérifie si le texte contient du code Polybe valide.
        
        Args:
            text: Texte à analyser
            strict: Si True, tout le texte doit être du code Polybe valide
            allowed_chars: Caractères autorisés en plus du code Polybe en mode non strict
            embedded: Si True, le code peut être intégré dans un texte plus large
            grid_size: Taille de la grille ("5x5" ou "6x6")
            alphabet_mode: Mode de fusion des lettres pour la grille 5x5 ("I=J", "C=K", "W=VV")
            
        Returns:
            Dictionnaire avec les résultats de l'analyse
        """
        if not text:
            return {"is_match": False, "score": 0, "fragments": []}
            
        # Définir les caractères autorisés en mode non strict
        if allowed_chars is None:
            allowed_chars = " ,.;:!?-_"
        
        # Déterminer la dimension de la grille
        grid_dim = 6 if grid_size == "6x6" else 5
            
        # Extraire les fragments de code Polybe potentiels
        fragments = self._extract_polybius_fragments(text, grid_dim)
        
        # Vérifier si des fragments ont été trouvés
        if not fragments:
            return {"is_match": False, "score": 0, "fragments": []}
            
        # En mode strict, tout le texte doit être du code Polybe valide
        if strict and not embedded:
            # Vérifier que tout le texte est couvert par les fragments
            # et qu'il n'y a qu'un seul fragment
            if len(fragments) == 1 and fragments[0]["start"] == 0 and fragments[0]["end"] == len(text):
                return {"is_match": True, "score": 0.9, "fragments": fragments}
            else:
                return {"is_match": False, "score": 0, "fragments": []}
        else:
            # En mode non strict ou embedded, au moins un fragment valide suffit
            # Calculer un score basé sur la proportion de texte qui est du code Polybe
            total_length = len(text)
            polybius_length = sum(len(f["value"]) for f in fragments)
            
            # Éviter la division par zéro
            if total_length == 0:
                score = 0
            else:
                score = min(0.8, polybius_length / total_length)
                
            return {"is_match": True, "score": score, "fragments": fragments}
    
    def _extract_polybius_fragments(self, text, grid_dim=5):
        """
        Extrait les fragments de code Polybe du texte.
        
        Args:
            text: Texte à analyser
            grid_dim: Dimension de la grille (5 ou 6)
            
        Returns:
            Liste des fragments de code Polybe trouvés
        """
        fragments = []
        
        # Définir les patterns selon la dimension de la grille
        if grid_dim == 5:
            # Pour une grille 5x5, les coordonnées vont de 1 à 5
            number_pattern = r'[1-5]{2}'
            coord_pattern = r'\([1-5],[1-5]\)'
        else:  # grid_dim == 6
            # Pour une grille 6x6, les coordonnées vont de 1 à 6
            number_pattern = r'[1-6]{2}'
            coord_pattern = r'\([1-6],[1-6]\)'
        
        # Combiner les patterns pour trouver tous les formats
        combined_pattern = f"({number_pattern}|{coord_pattern})"
        
        # Trouver toutes les occurrences de coordonnées Polybe
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
            "type": "numbers" if re.match(number_pattern, matches[0].group()) else "coordinates"
        }
        
        # Décoder les coordonnées du premier fragment
        coords = self.decode_coordinates(matches[0].group(), grid_dim)
        if coords:
            current_fragment["coords"] = coords
        
        for i in range(1, len(matches)):
            match = matches[i]
            prev_match = matches[i-1]
            
            # Vérifier si les coordonnées sont valides pour la dimension de la grille
            coords = self.decode_coordinates(match.group(), grid_dim)
            if not coords:
                continue
            
            # Vérifier si le fragment est contigu
            if match.start() - prev_match.end() <= 2:  # Autoriser un ou deux caractères entre les coordonnées
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
                    "type": "numbers" if re.match(number_pattern, match.group()) else "coordinates"
                }
        
        # Ajouter le dernier fragment s'il est valide
        if current_fragment["coords"]:
            fragments.append(current_fragment)
        
        return fragments
    
    def decode_fragments(self, text, fragments, key="", grid_size="5x5", alphabet_mode="I=J"):
        """
        Décode uniquement les fragments de code Polybe détectés dans le texte.
        
        Args:
            text: Texte contenant les fragments à décoder
            fragments: Liste des fragments de code Polybe détectés
            key: Mot-clé optionnel pour la grille
            grid_size: Taille de la grille ("5x5" ou "6x6")
            alphabet_mode: Mode de fusion des lettres pour la grille 5x5 ("I=J", "C=K", "W=VV")
            
        Returns:
            Texte avec les fragments décodés
        """
        # Si aucun fragment, retourner le texte original
        if not fragments:
            return text
        
        # Créer la grille Polybe
        grid_data = self.create_polybius_grid(key, grid_size, alphabet_mode)
        
        # Trier les fragments par position de début (pour éviter les chevauchements)
        sorted_fragments = sorted(fragments, key=lambda f: f["start"])
        
        # Créer une liste de caractères à partir du texte original pour pouvoir le modifier
        result_chars = list(text)
        
        last_end = 0
        
        for fragment in sorted_fragments:
            # Décoder les coordonnées du fragment
            decoded_chars = []
            i = 0
            coords = fragment["coords"]
            
            while i < len(coords):
                coord = coords[i]
                
                # Gérer le cas spécial W=VV
                if alphabet_mode == "W=VV" and grid_size == "5x5" and i < len(coords) - 1:
                    next_coord = coords[i + 1]
                    if coord in grid_data["reverse_grid"] and next_coord in grid_data["reverse_grid"]:
                        if grid_data["reverse_grid"][coord] == "V" and grid_data["reverse_grid"][next_coord] == "V":
                            decoded_chars.append("W")
                            i += 2  # Sauter le prochain V
                            continue
                
                # Décoder la coordonnée normale
                if coord in grid_data["reverse_grid"]:
                    decoded_chars.append(grid_data["reverse_grid"][coord])
                else:
                    decoded_chars.append("?")
                
                i += 1
            
            # Remplacer le fragment par sa version décodée
            # Nous devons préserver la longueur exacte du texte original
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
            
            last_end = fragment["end"]
        
        # Ajouter le reste du texte après le dernier fragment
        if last_end < len(text):
            result_chars[last_end:] = list(text[last_end:])
        
        return ''.join(result_chars)
    
    def _clean_text_for_scoring(self, text: str) -> str:
        """
{{ ... }}
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
                - key: Mot-clé optionnel pour la grille Polybe
                - grid_size: Taille de la grille ("5x5" ou "6x6")
                - alphabet_mode: Mode de fusion des lettres ("I=J", "C=K", "W=VV")
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
        key = inputs.get("key", "")
        grid_size = inputs.get("grid_size", "5x5")
        alphabet_mode = inputs.get("alphabet_mode", "I=J")
        output_format = inputs.get("output_format", "numbers").lower()
        
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
        print(f"État du scoring: {enable_scoring}")
        
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
                encoded = self.encode(text, key, output_format, grid_size, alphabet_mode)
                
                # Ajouter le résultat au format standardisé
                result_item = {
                    "id": "result_1",
                    "text_output": encoded,
                    "confidence": 1.0,  # Confiance maximale pour l'encodage
                    "parameters": {
                        "mode": mode,
                        "key": key if key else "(aucune)",
                        "grid_size": grid_size,
                        "alphabet_mode": alphabet_mode,
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
                # Vérifier d'abord si le texte contient du code Polybe
                check_result = self.check_code(text, strict_mode, allowed_chars, embedded, grid_size, alphabet_mode)
                
                if check_result["is_match"]:
                    # En fonction du mode strict/embedded, décoder tout le texte ou juste les fragments
                    if strict_mode and not embedded:
                        # Décoder tout le texte en mode strict
                        decoded = self.decode(text, key, grid_size, alphabet_mode)
                        confidence = 0.9  # Confiance élevée en mode strict
                    else:
                        # Décoder seulement les fragments de code identifiés
                        decoded = self.decode_fragments(text, check_result["fragments"], key, grid_size, alphabet_mode)
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
                            "key": key if key else "(aucune)",
                            "grid_size": grid_size,
                            "alphabet_mode": alphabet_mode,
                            "strict": "strict" if strict_mode else "smooth"
                        },
                        "metadata": {
                            "processed_chars": len(text),
                            "decoded_chars": len(''.join(f["value"] for f in check_result["fragments"]))
                        }
                    }
                    
                    # Ajouter les informations de scoring si disponibles
                    if scoring_result:
                        result_item["scoring"] = scoring_result
                    
                    result["results"].append(result_item)
                    result["summary"]["total_results"] = 1
                    result["summary"]["best_result_id"] = "result_1"
                    result["summary"]["message"] = "Texte décodé avec succès"
                else:
                    # Aucun code Polybe valide trouvé
                    result["status"] = "error"
                    result["summary"]["message"] = "Aucun code Polybe valide n'a été trouvé dans le texte fourni."
            else:
                # Mode non reconnu
                result["status"] = "error"
                result["summary"]["message"] = f"Mode non reconnu: {mode}. Utilisez 'encode' ou 'decode'."
                
        except Exception as e:
            # Gestion d'erreur
            result["status"] = "error"
            result["summary"]["message"] = f"Erreur lors du traitement: {str(e)}"
            import traceback
            print(traceback.format_exc())
            
        # Calculer et ajouter le temps d'exécution
        execution_time = time.time() - start_time
        result["plugin_info"]["execution_time"] = execution_time
        
        return result

# Créer une instance du plugin
plugin = PolybiusSquarePlugin()
