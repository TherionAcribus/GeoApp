import time
import re
import json
import os
from itertools import product

# Import du service de scoring
try:
    from app.services.scoring_service import ScoringService
    scoring_service_available = True
    print("Module de scoring disponible")
except ImportError:
    scoring_service_available = False
    print("Module de scoring non disponible, utilisation du scoring legacy uniquement")

class PostnetBarcodePlugin:
    """
    Plugin pour encoder/décoder les codes barres POSTNET (Postal Numeric Encoding Technique).
    
    POSTNET utilise un système de barres hautes et basses pour encoder des codes ZIP:
    - Chaque chiffre est représenté par 5 barres (2 hautes, 3 basses)
    - Codes supportés: ZIP5 (32 barres), ZIP+4 (52 barres), ZIP+4+2 (62 barres)
    - Comprend des barres de début/fin et un digit de contrôle
    - Support de formats visuels multiples: | . ou | ╷ ou 1 0
    """

    def __init__(self):
        self.name = "postnet_barcode"
        self.description = "Plugin pour encoder/décoder les codes barres POSTNET avec auto-détection et mode bruteforce"
        
        # Table de correspondance POSTNET : chiffre -> pattern de 5 barres
        # 1 = barre haute, 0 = barre basse
        # Chaque chiffre a exactement 2 barres hautes et 3 barres basses
        self.postnet_encoding = {
            '0': '11000',  # 7+4 = 11 (représente 0 en pseudo-binaire)
            '1': '00011',  # 1+0 = 1
            '2': '00101',  # 2+0 = 2
            '3': '00110',  # 2+1 = 3
            '4': '01001',  # 4+0 = 4
            '5': '01010',  # 4+1 = 5
            '6': '01100',  # 4+2 = 6
            '7': '10001',  # 7+0 = 7
            '8': '10010',  # 7+1 = 8
            '9': '10100'   # 7+2 = 9
        }
        
        # Table de décodage (inverse de l'encodage)
        self.postnet_decoding = {v: k for k, v in self.postnet_encoding.items()}
        
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

    def validate_input(self, text: str, mode: str) -> tuple:
        """
        Valide l'entrée selon le mode.
        
        Returns:
            tuple (is_valid: bool, error_message: str, cleaned_text: str)
        """
        if not text or not text.strip():
            return False, "Entrée vide", ""
        
        text = text.strip()
        
        if mode == "encode":
            # Pour l'encodage, on doit avoir des chiffres
            digits = re.sub(r'[^0-9]', '', text)
            if not digits:
                return False, "Aucun chiffre trouvé dans l'entrée. L'encodage POSTNET nécessite des chiffres.", ""
            return True, "", digits
        
        elif mode == "decode":
            # Pour le décodage, on doit avoir des barres ou du binaire
            if re.search(r'[01|.\-_I╷]', text):
                return True, "", text
            else:
                return False, "Format non reconnu. Le décodage POSTNET nécessite des barres (|, ., ╷) ou du binaire (0, 1).", ""
        
        return True, "", text

    def detect_visual_format(self, text: str) -> str:
        """
        Détecte automatiquement le format visuel du texte.
        
        Returns:
            Format détecté: 'binary', 'pipe_dot', 'pipe_down', 'mixed' ou 'unknown'
        """
        # Compter les différents types de caractères
        has_binary = bool(re.search(r'[01]', text))
        has_pipe = bool(re.search(r'[|I]', text))
        has_dot = bool(re.search(r'[.\-_]', text))
        has_down = bool(re.search(r'╷', text))
        
        # Détermine le format principal
        if has_binary and not (has_pipe or has_dot or has_down):
            return 'binary'
        elif has_pipe and has_dot and not has_down and not has_binary:
            return 'pipe_dot'
        elif has_pipe and has_down and not has_dot and not has_binary:
            return 'pipe_down'
        elif has_pipe or has_dot or has_down:
            return 'mixed'
        else:
            return 'unknown'

    def calculate_checksum(self, digits: str) -> str:
        """
        Calcule le digit de contrôle POSTNET.
        Le checksum est calculé pour que la somme de tous les digits soit un multiple de 10.
        """
        total = sum(int(digit) for digit in digits)
        checksum = (10 - (total % 10)) % 10
        return str(checksum)

    def encode_to_postnet(self, digits: str, target_format: str = "auto", 
                         checksum_mode: str = "auto", frame_bars: str = "auto",
                         visual_format: str = "auto") -> dict:
        """
        Encode une séquence de chiffres en code barre POSTNET.
        
        Returns:
            Dictionnaire avec les codes dans tous les formats supportés
        """
        # Nettoyer l'entrée (garder seulement les chiffres)
        clean_digits = re.sub(r'[^0-9]', '', digits)
        
        if not clean_digits:
            raise ValueError("Aucun chiffre à encoder")
        
        # Déterminer le format en fonction de la longueur ou du paramètre
        if target_format == "auto":
            if len(clean_digits) == 5:
                target_format = "zip5"
            elif len(clean_digits) == 9:
                target_format = "zip9"
            elif len(clean_digits) == 11:
                target_format = "zip11"
            else:
                target_format = "free"
        
        # Ajuster la longueur selon le format (sauf pour free)
        if target_format == "zip5":
            clean_digits = clean_digits[:5].ljust(5, '0')
        elif target_format == "zip9":
            clean_digits = clean_digits[:9].ljust(9, '0')
        elif target_format == "zip11":
            clean_digits = clean_digits[:11].ljust(11, '0')
        # Pour "free", on garde la longueur originale
        
        # Déterminer si on doit ajouter un checksum
        add_checksum = False
        if checksum_mode == "auto":
            # Auto: checksum pour les formats postaux standards
            add_checksum = target_format in ["zip5", "zip9", "zip11"]
        elif checksum_mode == "required":
            add_checksum = True
        elif checksum_mode == "optional":
            # En mode optionnel, on l'ajoute par défaut
            add_checksum = True
        # Pour "none", add_checksum reste False
        
        # Calculer et ajouter le checksum si nécessaire
        if add_checksum:
            checksum = self.calculate_checksum(clean_digits)
            full_code = clean_digits + checksum
        else:
            full_code = clean_digits
        
        # Déterminer si on doit ajouter des barres de début/fin
        add_frame_bars = False
        if frame_bars == "auto":
            # Auto: barres pour les formats postaux standards
            add_frame_bars = target_format in ["zip5", "zip9", "zip11"]
        elif frame_bars == "always":
            add_frame_bars = True
        # Pour "never", add_frame_bars reste False
        
        # Encoder en POSTNET
        postnet_code = ""
        
        # Ajouter la barre de début si nécessaire
        if add_frame_bars:
            postnet_code += "1"
        
        # Encoder chaque chiffre
        for digit in full_code:
            if digit in self.postnet_encoding:
                postnet_code += self.postnet_encoding[digit]
            else:
                raise ValueError(f"Caractère non supporté: {digit}")
        
        # Ajouter la barre de fin si nécessaire
        if add_frame_bars:
            postnet_code += "1"
        
        # Générer tous les formats visuels
        binary_format = postnet_code
        pipe_dot_format = self.format_to_visual(postnet_code, "pipe_dot")
        pipe_down_format = self.format_to_visual(postnet_code, "pipe_down")
        
        # Choisir le format de sortie selon la préférence
        if visual_format == "binary":
            display_format = binary_format
        elif visual_format == "pipe_dot":
            display_format = pipe_dot_format
        elif visual_format == "pipe_down":
            display_format = pipe_down_format
        else:  # auto
            display_format = pipe_dot_format  # Format par défaut
        
        return {
            "binary": binary_format,
            "pipe_dot": pipe_dot_format,
            "pipe_down": pipe_down_format,
            "display": display_format,
            "digits": clean_digits,
            "full_code": full_code,
            "checksum": checksum if add_checksum else None,
            "has_checksum": add_checksum,
            "has_frame_bars": add_frame_bars,
            "format": target_format
        }

    def format_to_visual(self, binary_code: str, visual_format: str) -> str:
        """
        Convertit un code binaire vers un format visuel spécifique.
        """
        if visual_format == "binary":
            return binary_code
        elif visual_format == "pipe_dot":
            return binary_code.replace('1', '|').replace('0', '.')
        elif visual_format == "pipe_down":
            return binary_code.replace('1', '|').replace('0', '╷')
        else:
            return binary_code

    def normalize_barcode(self, barcode: str) -> str:
        """
        Normalise un code barre en convertissant différents formats en 1 et 0.
        Support amélioré pour le format ╷.
        """
        # Nettoyer les espaces
        clean = barcode.strip()
        
        # Si c'est déjà en format binaire, le garder
        if re.match(r'^[01]+$', clean):
            return clean
        
        # Convertir différents formats de représentation
        # | ou I = barre haute = 1
        # . ou - ou _ ou ╷ = barre basse = 0
        normalized = ""
        for char in clean:
            if char in '|I1':
                normalized += '1'
            elif char in '.-_0╷':  # Ajout du support pour ╷
                normalized += '0'
            # Ignorer les autres caractères
        
        return normalized

    def decode_from_postnet(self, barcode: str, flexible: bool = False) -> dict:
        """
        Décode un code barre POSTNET en séquence de chiffres.
        Auto-détection des formats améliorée.
        """
        # Détecter le format visuel original
        original_format = self.detect_visual_format(barcode)
        
        # Nettoyer et normaliser l'entrée
        clean_barcode = self.normalize_barcode(barcode)
        
        if not clean_barcode:
            return {
                "success": False,
                "error": "Code barre vide ou invalide",
                "zip_code": None,
                "checksum_valid": None,
                "has_frame_bars": False,
                "has_checksum": False,
                "original_format": original_format
            }
        
        # Auto-détection des barres de début/fin
        has_frame_bars = clean_barcode.startswith('1') and clean_barcode.endswith('1')
        data_portion = clean_barcode
        
        if has_frame_bars:
            # Retirer les barres de début et fin
            data_portion = clean_barcode[1:-1]
        elif not flexible:
            # En mode strict, tenter avec et sans barres de début/fin
            pass  # On continue pour permettre la détection automatique
        
        # Vérifier que la longueur est un multiple de 5
        if len(data_portion) % 5 != 0:
            if not flexible:
                return {
                    "success": False,
                    "error": f"Longueur de données invalide: {len(data_portion)} (doit être multiple de 5)",
                    "zip_code": None,
                    "checksum_valid": None,
                    "has_frame_bars": has_frame_bars,
                    "has_checksum": False,
                    "original_format": original_format
                }
            else:
                # En mode flexible, tronquer pour avoir un multiple de 5
                data_portion = data_portion[:len(data_portion) - (len(data_portion) % 5)]
        
        # Décoder chaque groupe de 5 barres
        digits = ""
        invalid_patterns = []
        
        for i in range(0, len(data_portion), 5):
            pattern = data_portion[i:i+5]
            
            # Vérifier que le pattern a exactement 2 barres hautes
            if pattern.count('1') != 2:
                if not flexible:
                    return {
                        "success": False,
                        "error": f"Pattern invalide: {pattern} (doit avoir exactement 2 barres hautes)",
                        "zip_code": None,
                        "checksum_valid": None,
                        "has_frame_bars": has_frame_bars,
                        "has_checksum": False,
                        "original_format": original_format
                    }
                else:
                    # En mode flexible, ignorer les patterns invalides
                    invalid_patterns.append(pattern)
                    continue
            
            if pattern in self.postnet_decoding:
                digits += self.postnet_decoding[pattern]
            else:
                if not flexible:
                    return {
                        "success": False,
                        "error": f"Pattern non reconnu: {pattern}",
                        "zip_code": None,
                        "checksum_valid": None,
                        "has_frame_bars": has_frame_bars,
                        "has_checksum": False,
                        "original_format": original_format
                    }
                else:
                    # En mode flexible, ignorer les patterns non reconnus
                    invalid_patterns.append(pattern)
                    continue
        
        if not digits:
            return {
                "success": False,
                "error": "Aucun chiffre décodé",
                "zip_code": None,
                "checksum_valid": None,
                "has_frame_bars": has_frame_bars,
                "has_checksum": False,
                "original_format": original_format
            }
        
        # Auto-détection du checksum 
        checksum_valid = None
        has_checksum = False
        zip_digits = digits
        received_checksum = None
        calculated_checksum = None
        
        if len(digits) >= 2:
            # Essayer avec checksum
            test_zip_digits = digits[:-1]
            test_checksum = digits[-1]
            test_calculated = self.calculate_checksum(test_zip_digits)
            
            if test_checksum == test_calculated:
                # Le checksum est valide
                zip_digits = test_zip_digits
                received_checksum = test_checksum
                calculated_checksum = test_calculated
                checksum_valid = True
                has_checksum = True
            elif not flexible and len(digits) in [6, 10, 12]:  # Formats standards + checksum
                # En mode strict pour les formats standards, le checksum est obligatoire
                zip_digits = test_zip_digits
                received_checksum = test_checksum
                calculated_checksum = test_calculated
                checksum_valid = False
                has_checksum = True
            else:
                # Pas de checksum ou checksum invalide en mode flexible
                zip_digits = digits
                has_checksum = False
        
        # Auto-détection du format
        format_type = "unknown"
        if len(zip_digits) == 5:
            format_type = "ZIP-5"
        elif len(zip_digits) == 9:
            format_type = "ZIP+4"
        elif len(zip_digits) == 11:
            format_type = "ZIP+4+2"
        else:
            format_type = f"libre ({len(zip_digits)} chiffres)"
        
        result = {
            "success": True,
            "zip_code": zip_digits,
            "format": format_type,
            "checksum_received": received_checksum,
            "checksum_calculated": calculated_checksum,
            "checksum_valid": checksum_valid,
            "has_checksum": has_checksum,
            "has_frame_bars": has_frame_bars,
            "total_bars": len(clean_barcode),
            "flexible_mode": flexible,
            "original_format": original_format
        }
        
        if invalid_patterns:
            result["invalid_patterns"] = invalid_patterns
            result["warning"] = f"{len(invalid_patterns)} pattern(s) invalide(s) ignoré(s)"
        
        return result

    def detect_postnet_pattern(self, text: str) -> list:
        """
        Détecte les patterns POSTNET potentiels dans un texte.
        Auto-détection améliorée avec support de ╷.
        """
        patterns = []
        
        # Rechercher des séquences de différentes longueurs (pas seulement standards)
        # Format binaire
        binary_matches = re.finditer(r'[01]{10,}', text)  # Au moins 10 caractères
        for match in binary_matches:
            if len(match.group()) % 5 == 0:  # Doit être multiple de 5
                patterns.append({
                    "type": "binary",
                    "text": match.group(),
                    "start": match.start(),
                    "end": match.end(),
                    "format": "binary"
                })
        
        # Format avec barres classiques | et .
        bar_dot_matches = re.finditer(r'[|.\-_I]{10,}', text)
        for match in bar_dot_matches:
            if len(match.group()) % 5 == 0:
                patterns.append({
                    "type": "bars_dot", 
                    "text": match.group(),
                    "start": match.start(),
                    "end": match.end(),
                    "format": "pipe_dot"
                })
        
        # Format avec barres modernes | et ╷
        bar_down_matches = re.finditer(r'[|╷I]{10,}', text)
        for match in bar_down_matches:
            if len(match.group()) % 5 == 0:
                patterns.append({
                    "type": "bars_down", 
                    "text": match.group(),
                    "start": match.start(),
                    "end": match.end(),
                    "format": "pipe_down"
                })
        
        # Format mixte (peut contenir plusieurs types de caractères)
        mixed_matches = re.finditer(r'[|.\-_I╷01]{10,}', text)
        for match in mixed_matches:
            if len(match.group()) % 5 == 0:
                patterns.append({
                    "type": "mixed", 
                    "text": match.group(),
                    "start": match.start(),
                    "end": match.end(),
                    "format": "mixed"
                })
        
        # Éliminer les doublons et trier par position
        unique_patterns = []
        seen_positions = set()
        
        for pattern in patterns:
            pos_key = (pattern["start"], pattern["end"])
            if pos_key not in seen_positions:
                seen_positions.add(pos_key)
                unique_patterns.append(pattern)
        
        return sorted(unique_patterns, key=lambda x: x["start"])

    def generate_bruteforce_variations(self, text: str) -> list:
        """
        Génère toutes les variations possibles pour le mode bruteforce.
        """
        variations = []
        
        # Essayer différentes options de décodage
        flexible_options = [True, False]
        frame_bar_assumptions = [True, False]  # Avec ou sans barres de début/fin
        
        for flexible in flexible_options:
            for assume_frame_bars in frame_bar_assumptions:
                try:
                    # Préparer le texte selon l'assumption des barres
                    test_text = text
                    
                    if assume_frame_bars and not (text.startswith('1') or text.startswith('|')):
                        # Ajouter des barres de début/fin si assumées manquantes
                        normalized = self.normalize_barcode(text)
                        if normalized and not normalized.startswith('1'):
                            test_text = '1' + normalized + '1'
                            # Convertir back to original format
                            original_format = self.detect_visual_format(text)
                            if original_format == 'pipe_dot':
                                test_text = self.format_to_visual(test_text, 'pipe_dot')
                            elif original_format == 'pipe_down':
                                test_text = self.format_to_visual(test_text, 'pipe_down')
                    
                    result = self.decode_from_postnet(test_text, flexible)
                    
                    if result["success"]:
                        # Calculer la confiance selon les paramètres utilisés
                        confidence = self.calculate_confidence(result, flexible, assume_frame_bars)
                        
                        variation = {
                            "text_output": result["zip_code"],
                            "confidence": confidence,
                            "parameters": {
                                "flexible_mode": flexible,
                                "assumed_frame_bars": assume_frame_bars,
                                "original_has_frame_bars": result["has_frame_bars"]
                            },
                            "metadata": result
                        }
                        variations.append(variation)
                        
                except Exception:
                    # Ignorer les variations qui échouent
                    continue
        
        # Éliminer les doublons (même résultat)
        unique_variations = []
        seen_outputs = set()
        
        for var in variations:
            output_key = var["text_output"]
            if output_key not in seen_outputs:
                seen_outputs.add(output_key)
                unique_variations.append(var)
        
        # Trier par confiance
        unique_variations.sort(key=lambda x: x["confidence"], reverse=True)
        
        return unique_variations

    def calculate_confidence(self, decode_result: dict, flexible: bool, assumed_frame_bars: bool) -> float:
        """
        Calcule la confiance basée sur les paramètres de décodage et le résultat.
        """
        base_confidence = 0.5
        
        # Bonus pour checksum valide
        if decode_result.get("checksum_valid") is True:
            base_confidence += 0.3
        elif decode_result.get("checksum_valid") is False:
            base_confidence -= 0.1
        
        # Bonus pour format standard
        if decode_result.get("format") in ["ZIP-5", "ZIP+4", "ZIP+4+2"]:
            base_confidence += 0.2
        
        # Bonus pour barres de début/fin correctes
        if decode_result.get("has_frame_bars"):
            base_confidence += 0.1
        
        # Pénalité pour mode flexible
        if flexible:
            base_confidence -= 0.1
        
        # Pénalité pour assumptions incorrectes
        if assumed_frame_bars != decode_result.get("has_frame_bars"):
            base_confidence -= 0.05
        
        # Pénalité pour patterns invalides
        if decode_result.get("invalid_patterns"):
            base_confidence -= 0.1 * len(decode_result["invalid_patterns"])
        
        return max(0.0, min(1.0, base_confidence))

    def get_text_score(self, text, context=None):
        """
        Obtient le score de confiance d'un texte décodé en utilisant le service de scoring.
        """
        if not self.scoring_service:
            return None
            
        try:
            result = self.scoring_service.score_text(text, context)
            return result
        except Exception as e:
            print(f"Erreur lors de l'évaluation avec le service de scoring: {str(e)}")
            return None

    def execute(self, inputs: dict) -> dict:
        """
        Point d'entrée principal du plugin avec support du bruteforce.
        """
        start_time = time.time()
        
        mode = inputs.get("mode", "decode").lower()
        text = inputs.get("text", "").strip()
        format_type = inputs.get("format", "auto")
        visual_format = inputs.get("visual_format", "auto")
        checksum_mode = inputs.get("checksum_mode", "auto")
        frame_bars = inputs.get("frame_bars", "auto")
        checkbox_value = inputs.get("enable_scoring", "")
        enable_scoring = checkbox_value == "on"
        is_bruteforce = inputs.get("bruteforce", False)
        
        # Structure de base pour la réponse
        standardized_response = {
            "status": "success",
            "plugin_info": {
                "name": self.name,
                "version": "1.2.0",
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
        
        # Validation d'entrée
        is_valid, error_message, cleaned_text = self.validate_input(text, mode)
        if not is_valid:
            standardized_response["status"] = "error"
            standardized_response["summary"]["message"] = error_message
            return standardized_response
        
        try:
            if mode == "encode":
                # Mode encodage
                try:
                    encode_result = self.encode_to_postnet(
                        cleaned_text, format_type, checksum_mode, frame_bars, visual_format
                    )
                    
                    # Déterminer le format de nom
                    if encode_result["format"] == "free":
                        format_name = f"libre ({len(encode_result['digits'])} chiffres, {len(encode_result['binary'])} barres)"
                    elif len(encode_result["binary"]) == 32:
                        format_name = "ZIP-5 (32 barres)"
                    elif len(encode_result["binary"]) == 52:
                        format_name = "ZIP+4 (52 barres)"
                    elif len(encode_result["binary"]) == 62:
                        format_name = "ZIP+4+2 (62 barres)"
                    else:
                        format_name = f"personnalisé ({len(encode_result['binary'])} barres)"
                    
                    result = {
                        "id": "encode_result_1",
                        "text_output": encode_result["display"],
                        "confidence": 1.0,
                        "parameters": {
                            "mode": mode,
                            "format": format_type,
                            "visual_format": visual_format,
                            "checksum_mode": checksum_mode,
                            "frame_bars": frame_bars,
                            "input_digits": encode_result["digits"]
                        },
                        "metadata": {
                            "format_name": format_name,
                            "binary_representation": encode_result["binary"],
                            "pipe_dot_format": encode_result["pipe_dot"],
                            "pipe_down_format": encode_result["pipe_down"],
                            "total_bars": len(encode_result["binary"]),
                            "has_checksum": encode_result["has_checksum"],
                            "has_frame_bars": encode_result["has_frame_bars"],
                            "checksum": encode_result["checksum"],
                            "full_code": encode_result["full_code"]
                        }
                    }
                    
                    standardized_response["results"].append(result)
                    standardized_response["summary"]["best_result_id"] = "encode_result_1"
                    standardized_response["summary"]["total_results"] = 1
                    standardized_response["summary"]["message"] = f"Encodage réussi en {format_name}"
                    
                except Exception as e:
                    standardized_response["status"] = "error"
                    standardized_response["summary"]["message"] = f"Erreur d'encodage: {str(e)}"
                    
            elif mode == "decode":
                # Mode décodage
                results = []
                
                if is_bruteforce:
                    # Mode bruteforce : tester toutes les variations
                    variations = self.generate_bruteforce_variations(text)
                    
                    for i, variation in enumerate(variations):
                        result = {
                            "id": f"bruteforce_result_{i+1}",
                            "text_output": variation["text_output"],
                            "confidence": variation["confidence"],
                            "parameters": {
                                "mode": mode,
                                "bruteforce": True,
                                **variation["parameters"]
                            },
                            "metadata": {
                                **variation["metadata"],
                                "bruteforce_variation": i+1
                            }
                        }
                        
                        # Formater le ZIP code pour l'affichage
                        zip_code = variation["text_output"]
                        if len(zip_code) == 9:
                            result["text_output"] = f"{zip_code[:5]}-{zip_code[5:]}"
                        elif len(zip_code) == 11:
                            result["text_output"] = f"{zip_code[:5]}-{zip_code[5:9]}-{zip_code[9:]}"
                        
                        # Évaluation avec le service de scoring si activé
                        if enable_scoring and self.scoring_service:
                            context = inputs.get("context", {})
                            scoring_result = self.get_text_score(result["text_output"], context)
                            
                            if scoring_result:
                                result["confidence"] = scoring_result.get("score", result["confidence"])
                                result["scoring"] = scoring_result
                        
                        results.append(result)
                
                else:
                    # Mode normal : rechercher des patterns et décoder
                    patterns = self.detect_postnet_pattern(text)
                    
                    if not patterns:
                        # Essayer de décoder le texte tel quel
                        patterns = [{"type": "direct", "text": text, "start": 0, "end": len(text), "format": "auto"}]
                    
                    # Déterminer le mode flexible
                    flexible_mode = format_type == "free" or checksum_mode in ["optional", "none"] or frame_bars == "never"
                    
                    for i, pattern in enumerate(patterns):
                        try:
                            decode_result = self.decode_from_postnet(pattern["text"], flexible_mode)
                            
                            if decode_result["success"]:
                                # Calculer la confiance
                                confidence = self.calculate_confidence(decode_result, flexible_mode, False)
                                
                                # Formater le code ZIP
                                zip_code = decode_result["zip_code"]
                                formatted_zip = zip_code
                                if len(zip_code) == 9:
                                    formatted_zip = f"{zip_code[:5]}-{zip_code[5:]}"
                                elif len(zip_code) == 11:
                                    formatted_zip = f"{zip_code[:5]}-{zip_code[5:9]}-{zip_code[9:]}"
                                
                                result = {
                                    "id": f"decode_result_{i+1}",
                                    "text_output": formatted_zip,
                                    "confidence": confidence,
                                    "parameters": {
                                        "mode": mode,
                                        "pattern_type": pattern["type"],
                                        "flexible_mode": flexible_mode,
                                        "original_format": pattern.get("format", "auto")
                                    },
                                    "metadata": {
                                        **decode_result,
                                        "pattern_found": pattern["text"],
                                        "zip_code_raw": zip_code
                                    }
                                }
                                
                                # Évaluation avec le service de scoring si activé
                                if enable_scoring and self.scoring_service:
                                    context = inputs.get("context", {})
                                    scoring_result = self.get_text_score(formatted_zip, context)
                                    
                                    if scoring_result:
                                        result["confidence"] = scoring_result.get("score", confidence)
                                        result["scoring"] = scoring_result
                                
                                results.append(result)
                        
                        except Exception:
                            # Ignorer les erreurs de décodage individuelles
                            continue
                
                if results:
                    # Trier par confiance
                    results.sort(key=lambda x: x["confidence"], reverse=True)
                    
                    standardized_response["results"] = results
                    standardized_response["summary"]["best_result_id"] = results[0]["id"]
                    standardized_response["summary"]["total_results"] = len(results)
                    
                    best_result = results[0]
                    
                    # Construire le message
                    if is_bruteforce:
                        message = f"Bruteforce: {len(results)} variation(s) testée(s)"
                    else:
                        format_info = best_result['metadata'].get('format', 'format inconnu')
                        
                        if best_result["metadata"].get("checksum_valid") is True:
                            message = f"Décodage réussi: {format_info}"
                        elif best_result["metadata"].get("checksum_valid") is False:
                            message = f"Décodage avec checksum invalide: {format_info}"
                        else:
                            message = f"Décodage: {format_info}"
                        
                        # Ajouter info sur le format visuel détecté
                        original_format = best_result["metadata"].get("original_format")
                        if original_format and original_format != "unknown":
                            message += f" (format {original_format})"
                    
                    standardized_response["summary"]["message"] = message
                else:
                    standardized_response["status"] = "error"
                    standardized_response["summary"]["message"] = "Aucun code POSTNET valide détecté"
            
            else:
                standardized_response["status"] = "error"
                standardized_response["summary"]["message"] = f"Mode non supporté: {mode}"
        
        except Exception as e:
            standardized_response["status"] = "error"
            standardized_response["summary"]["message"] = f"Erreur inattendue: {str(e)}"
        
        # Calculer le temps d'exécution
        execution_time = int((time.time() - start_time) * 1000)
        standardized_response["plugin_info"]["execution_time"] = execution_time
        
        return standardized_response

# Point d'entrée pour l'exécution du plugin
def execute(inputs):
    plugin = PostnetBarcodePlugin()
    return plugin.execute(inputs) 