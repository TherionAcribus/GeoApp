import re
import time
import base64

# Détection GPS avancée (partagée avec MysteryAI)
try:
    # Import dynamique pour éviter l'échec si le module n'est pas disponible hors API
    from app.routes.coordinates import detect_gps_coordinates  # type: ignore
except Exception:
    detect_gps_coordinates = None  # Fallback si indisponible

class BaseConverterPlugin:
    """
    Plugin pour convertir des nombres entre différentes bases numériques et ASCII.
    Fonctionnalités prises en charge :
    - Conversion entre les bases numériques (2, 8, 10, 16, 36, 64)
    - Conversion depuis/vers ASCII
    - Mode strict ou smooth pour la détection des fragments
    - Détection des fragments dans un texte
    - Mode bruteforce pour tester toutes les conversions possibles
    """

    def __init__(self):
        self.name = "base_converter"
        self.description = "Plugin pour convertir des nombres entre différentes bases et ASCII"
        self.base_chars = {
            "2": "01",
            "8": "01234567",
            "10": "0123456789",
            "16": "0123456789ABCDEFabcdef",
            "36": "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
            "64": "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
        }
        # Liste des bases supportées
        self.supported_bases = ["2", "8", "10", "16", "36", "64", "ascii"]

    # -------------------------------------------------------------------------
    # 1) Vérification / détection : check_code
    # -------------------------------------------------------------------------
    def check_code(self, text: str, base: str, strict: bool = False, allowed_chars=None, embedded: bool = False) -> dict:
        """
        Vérifie si le texte contient du code valide dans la base spécifiée.
        
        Args:
            text: Texte à analyser
            base: Base à vérifier ("2", "8", "10", "16", "36", "64", "ascii")
            strict: Mode strict (True) ou smooth (False)
            allowed_chars: Liste de caractères autorisés en plus des caractères de la base
            embedded: True si le texte peut contenir du code intégré, False si tout le texte doit être du code
            
        Returns:
            Un dictionnaire contenant:
            - is_match: True si du code valide a été trouvé
            - fragments: Liste des fragments de code trouvés
            - score: Score de confiance (0.0 à 1.0)
        """
        # Si ASCII, on considère toujours que c'est valide
        if base == "ascii":
            return {
                "is_match": True,
                "fragments": [{"value": text, "start": 0, "end": len(text)}],
                "score": 1.0
            }
            
        # Si allowed_chars est fourni comme liste, on la convertit en chaîne
        if allowed_chars is not None and isinstance(allowed_chars, list):
            allowed_chars = ''.join(allowed_chars)
            
        # Caractères autorisés par défaut
        if allowed_chars is None:
            allowed_chars = " \t\r\n.:;,_-°"
            
        # Caractères valides pour la base spécifiée
        valid_chars = self.base_chars.get(base, "")
        
        # En mode strict, le comportement dépend du paramètre embedded
        if strict:
            if embedded:
                # En mode strict+embedded, on recherche des fragments de code valide dans le texte
                return self._extract_base_fragments(text, valid_chars, allowed_chars)
            else:
                # En mode strict sans embedded, on vérifie que tout le texte est du code valide
                
                # Échapper les caractères spéciaux pour l'expression régulière
                esc_punct = re.escape(allowed_chars)
                pattern_str = f"^[{valid_chars}{esc_punct}]*$"
                
                # Vérifier que tous les caractères sont autorisés
                if not re.match(pattern_str, text):
                    return {"is_match": False, "fragments": [], "score": 0.0}
                
                # Vérifier qu'il y a au moins un caractère valide
                valid_chars_found = re.sub(f"[{esc_punct}]", "", text)
                if not valid_chars_found:
                    return {"is_match": False, "fragments": [], "score": 0.0}
                
                # Vérification supplémentaire pour Base64
                if base == "64" and len(valid_chars_found) % 4 != 0:
                    # En Base64, la longueur doit être un multiple de 4
                    return {"is_match": False, "fragments": [], "score": 0.0}
                
                # Tout est OK, on renvoie le texte "strippé" comme fragment
                stripped_text = text.strip(allowed_chars)
                return {
                    "is_match": True,
                    "fragments": [{"value": stripped_text, "start": text.find(stripped_text), "end": text.find(stripped_text) + len(stripped_text)}],
                    "score": 1.0
                }
        else:
            # En mode smooth, on recherche des fragments de code valide dans le texte
            return self._extract_base_fragments(text, valid_chars, allowed_chars)
            
    def _extract_base_fragments(self, text: str, valid_chars: str, allowed_chars: str) -> dict:
        """
        Extrait les fragments de code valide dans le texte pour une base donnée.
        
        Args:
            text: Texte à analyser
            valid_chars: Caractères valides pour la base
            allowed_chars: Caractères autorisés en plus des caractères de la base
            
        Returns:
            Un dictionnaire contenant:
            - is_match: True si des fragments ont été trouvés
            - fragments: Liste des fragments contenant du code valide
            - score: Score de confiance (0.0 à 1.0)
        """
        # Échapper les caractères spéciaux pour l'expression régulière
        esc_punct = re.escape(allowed_chars)
        
        # Rechercher des blocs de texte séparés par des caractères autorisés
        pattern = f"([^{esc_punct}]+)|([{esc_punct}]+)"
        fragments = []
        
        for m in re.finditer(pattern, text):
            block = m.group(0)
            start, end = m.span()
            
            # Ignorer les blocs de ponctuation
            if re.match(f"^[{esc_punct}]+$", block):
                continue
            
            # Vérifier si le bloc contient uniquement des caractères valides pour la base
            if all(c in valid_chars for c in block):
                fragments.append({"value": text[start:end], "start": start, "end": end})
        
        # Calculer un score basé sur le nombre de fragments trouvés
        score = 1.0 if fragments else 0.0
        
        return {
            "is_match": bool(fragments),
            "fragments": fragments,
            "score": score
        }

    # -------------------------------------------------------------------------
    # 2) Conversion entre bases numériques
    # -------------------------------------------------------------------------
    
    def convert_base(self, value: str, source_base: str, target_base: str) -> str:
        """
        Convertit une valeur d'une base source vers une base cible.
        
        Args:
            value: Valeur à convertir
            source_base: Base source ("2", "8", "10", "16", "36", "64", "ascii")
            target_base: Base cible ("2", "8", "10", "16", "36", "64", "ascii")
            
        Returns:
            Valeur convertie dans la base cible
        """
        try:
            # Si la base source est ASCII, on convertit vers un entier (décimal)
            if source_base == "ascii":
                # Convertir chaque caractère en sa valeur ASCII et les joindre
                decimal_value = [ord(c) for c in value]
                
                # Si la cible est une base numérique, on convertit chaque valeur
                if target_base in ["2", "8", "10", "16", "36"]:
                    result = []
                    for dec in decimal_value:
                        # Convertir selon la base cible
                        if target_base == "2":
                            result.append(bin(dec)[2:])  # [2:] pour supprimer le '0b'
                        elif target_base == "8":
                            result.append(oct(dec)[2:])  # [2:] pour supprimer le '0o'
                        elif target_base == "10":
                            result.append(str(dec))
                        elif target_base == "16":
                            result.append(hex(dec)[2:])  # [2:] pour supprimer le '0x'
                        elif target_base == "36":
                            # Base 36 utilise 0-9 puis A-Z
                            result.append(self._to_base36(dec))
                    
                    # Joindre les résultats
                    return " ".join(result)
                elif target_base == "64":
                    # Convertir d'ASCII à Base64
                    return base64.b64encode(value.encode()).decode()
                
            # Si la cible est ASCII, on convertit depuis une base numérique
            elif target_base == "ascii":
                if source_base == "2":
                    chunks = value.split()
                    return "".join([chr(int(chunk, 2)) for chunk in chunks if chunk.strip()])
                elif source_base == "8":
                    chunks = value.split()
                    return "".join([chr(int(chunk, 8)) for chunk in chunks if chunk.strip()])
                elif source_base == "10":
                    chunks = value.split()
                    return "".join([chr(int(chunk)) for chunk in chunks if chunk.strip()])
                elif source_base == "16":
                    # Supprimer les espaces et les caractères non hexadécimaux
                    value = re.sub(r'[^0-9A-Fa-f]', '', value)
                    # S'assurer que la longueur est paire
                    if len(value) % 2 != 0:
                        value = value + "0"
                    # Convertir chaque paire en caractère
                    return bytes.fromhex(value).decode('utf-8', errors='replace')
                elif source_base == "36":
                    chunks = value.split()
                    return "".join([chr(int(chunk, 36)) for chunk in chunks if chunk.strip()])
                elif source_base == "64":
                    # Convertir de Base64 à ASCII
                    return base64.b64decode(value).decode('utf-8', errors='replace')
            
            # Conversion entre bases numériques
            else:
                # Convertir d'abord en décimal (sauf si déjà en décimal)
                if source_base == "10":
                    decimal_value = int(value)
                elif source_base == "2":
                    decimal_value = int(value, 2)
                elif source_base == "8":
                    decimal_value = int(value, 8)
                elif source_base == "16":
                    # Supprimer les préfixes 0x éventuels
                    clean_value = value.replace("0x", "").replace("0X", "")
                    decimal_value = int(clean_value, 16)
                elif source_base == "36":
                    decimal_value = int(value, 36)
                elif source_base == "64":
                    # D'abord décoder de Base64 vers bytes, puis convertir en entier
                    bytes_value = base64.b64decode(value)
                    decimal_value = int.from_bytes(bytes_value, byteorder='big')
                
                # Puis convertir du décimal vers la base cible
                if target_base == "2":
                    return bin(decimal_value)[2:]  # Enlever le '0b'
                elif target_base == "8":
                    return oct(decimal_value)[2:]  # Enlever le '0o'
                elif target_base == "10":
                    return str(decimal_value)
                elif target_base == "16":
                    return hex(decimal_value)[2:]  # Enlever le '0x'
                elif target_base == "36":
                    return self._to_base36(decimal_value)
                elif target_base == "64":
                    # Convertir l'entier en bytes, puis encoder en Base64
                    byte_length = (decimal_value.bit_length() + 7) // 8
                    bytes_value = decimal_value.to_bytes(byte_length, byteorder='big')
                    return base64.b64encode(bytes_value).decode()
                
            return "Erreur: Conversion non prise en charge"
            
        except Exception as e:
            return f"Erreur: {str(e)}"
    
    def _to_base36(self, value):
        """Convertit un entier en base 36."""
        chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"
        result = ""
        
        if value == 0:
            return "0"
            
        while value > 0:
            result = chars[value % 36] + result
            value //= 36
            
        return result
            
    def decode_fragments(self, text: str, fragments: list, source_base: str, target_base: str) -> str:
        """
        Décode uniquement les fragments valides dans leur contexte original.
        
        Args:
            text: Texte original contenant les fragments
            fragments: Liste des fragments à décoder
            source_base: Base source des fragments
            target_base: Base cible pour la conversion
            
        Returns:
            Texte avec les fragments décodés
        """
        # Trier les fragments par position de début (décroissant pour éviter de modifier les indices)
        sorted_fragments = sorted(fragments, key=lambda x: x["start"], reverse=True)
        
        # Copie du texte original pour modification
        result_text = text
        
        # Remplacer chaque fragment par sa version décodée
        for fragment in sorted_fragments:
            original = fragment["value"]
            converted = self.convert_base(original, source_base, target_base)
            
            # Remplacer le fragment dans le texte
            start, end = fragment["start"], fragment["end"]
            result_text = result_text[:start] + converted + result_text[end:]
            
        return result_text
        
    # -------------------------------------------------------------------------
    # 3) Mode bruteforce
    # -------------------------------------------------------------------------
    
    def evaluate_result_quality(self, converted_value: str) -> float:
        """
        Évalue la qualité d'un résultat pour classer les résultats du bruteforce.
        
        Args:
            converted_value: Valeur convertie à évaluer
            
        Returns:
            Score de confiance (0.0 à 1.0)
        """
        # Vérifier si la conversion a généré une erreur
        if converted_value.startswith("Erreur:"):
            return 0.0
            
        # Vérifier la présence de caractères ASCII imprimables
        printable_chars = 0
        total_chars = len(converted_value)
        
        if total_chars == 0:
            return 0.0
            
        for c in converted_value:
            # Caractères ASCII imprimables ont des codes 32 à 126
            if 32 <= ord(c) <= 126:
                printable_chars += 1
                
        printable_ratio = printable_chars / total_chars
        
        # Examiner si le texte contient des mots (indicateur de texte sensé)
        word_like_patterns = 0
        
        # Rechercher des séquences de lettres (mots potentiels)
        word_matches = re.findall(r'[a-zA-Z]{3,}', converted_value)
        word_like_patterns = len(word_matches)
        
        # Détection GPS améliorée
        gps_confidence = 0.0
        if detect_gps_coordinates is not None:
            try:
                gps_result = detect_gps_coordinates(converted_value, include_numeric_only=True)
                if gps_result.get("exist", False):
                    gps_confidence = float(gps_result.get("confidence", 0.9))
            except Exception:
                # Si la détection échoue, on ignore simplement
                gps_confidence = 0.0
        else:
            # Fallback simple : anciens patterns basiques
            simple_gps_patterns = [
                r'[NS]\s*\d{1,2}[° ]\s*\d{1,2}\.\d+',
                r'[EW]\s*\d{1,3}[° ]\s*\d{1,2}\.\d+'
            ]
            for pattern in simple_gps_patterns:
                if re.search(pattern, converted_value):
                    gps_confidence = 0.6  # confiance modérée
                    break

        # Si nous avons détecté une coordonnée GPS fiable, prioriser ce score
        if gps_confidence > 0:
            # Assurer une valeur minimale raisonnable (évite 0.5 vs 0.9 incohérences)
            return max(0.8, gps_confidence)

        # Sinon, on retombe sur l'approche classique
        # Base: proportion de caractères imprimables
        score = printable_ratio * 0.6  # légerement plus de poids au caractère lisible
        
        # Bonus pour les mots détectés
        score += min(0.4, word_like_patterns * 0.05)

        # Plafond si aucun mot détecté (évite 0.8+ sur du bruit imprimable)
        if word_like_patterns == 0:
            score = min(score, 0.2)
        
        return min(1.0, score)
        
    def bruteforce_convert(self, input_value: str, strict_mode: bool, embedded: bool) -> list:
        """
        Essaie toutes les combinaisons possibles de conversion entre bases.
        
        Args:
            input_value: Valeur à convertir
            strict_mode: Mode strict pour la vérification
            embedded: True si le texte peut contenir du code intégré
            
        Returns:
            Liste des résultats de conversion
        """
        results = []
        result_id = 1
        
        # Pour chaque base source possible
        for source_base in self.supported_bases:
            # Vérifier si l'entrée est valide dans cette base
            check_result = self.check_code(input_value, source_base, strict_mode, None, embedded)
            
            # Si l'entrée est valide dans cette base source
            if check_result["is_match"]:
                # Pour chaque base cible possible
                for target_base in self.supported_bases:
                    # Éviter de convertir une base vers elle-même
                    if source_base == target_base:
                        continue
                        
                    try:
                        # Effectuer la conversion
                        if embedded:
                            # En mode embedded, convertir uniquement les fragments valides
                            converted_text = self.decode_fragments(
                                input_value, 
                                check_result["fragments"], 
                                source_base, 
                                target_base
                            )
                        else:
                            # En mode normal, convertir toute l'entrée
                            converted_text = self.convert_base(input_value, source_base, target_base)
                            
                        # Ignorer les résultats d'erreur
                        if converted_text.startswith("Erreur:"):
                            continue
                            
                        # Évaluer la qualité du résultat
                        quality_score = self.evaluate_result_quality(converted_text)
                        
                        # Ne conserver que les résultats avec un score minimum
                        if quality_score >= 0.1:
                            results.append({
                                "id": f"result_{result_id}",
                                "text_output": converted_text,
                                "confidence": quality_score,
                                "parameters": {
                                    "source_base": source_base,
                                    "target_base": target_base,
                                    "fragments_count": len(check_result["fragments"]) if embedded else 1
                                },
                                "metadata": {
                                    "fragments": [f["value"] for f in check_result["fragments"]] if embedded else [input_value]
                                }
                            })
                            result_id += 1
                            
                    except Exception:
                        # Ignorer les erreurs de conversion
                        continue
                        
        # Trier les résultats par score de confiance (décroissant)
        results.sort(key=lambda x: x["confidence"], reverse=True)
        
        return results

    # -------------------------------------------------------------------------
    # 4) Méthode principale d'exécution
    # -------------------------------------------------------------------------

    def execute(self, inputs: dict) -> dict:
        """
        Point d'entrée principal du plugin.
        
        Args:
            inputs: Dictionnaire contenant les paramètres d'entrée
                - input_value, text ou input_text: Valeur à convertir
                - source_base: Base source ("2", "8", "10", "16", "36", "64", "ascii", "auto")
                - target_base: Base cible ("2", "8", "10", "16", "36", "64", "ascii", "auto")
                - strict: "strict" ou "smooth" pour le mode de décodage
                - embedded: True si le texte peut contenir du code intégré
                - bruteforce: True pour essayer toutes les combinaisons possibles
                
        Returns:
            Dictionnaire au format standardisé contenant le résultat de l'opération
        """
        # Mesurer le temps d'exécution
        start_time = time.time()
        
        # Structure de base pour la réponse au format standardisé
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
        
        # Adaptation pour la compatibilité avec l'interface standard
        # Si on reçoit 'text' ou 'input_text' au lieu de 'input_value', on l'adapte
        if "text" in inputs and inputs["text"] and "input_value" not in inputs:
            inputs["input_value"] = inputs["text"]
        elif "input_text" in inputs and inputs["input_text"] and "input_value" not in inputs:
            inputs["input_value"] = inputs["input_text"]
            
        # Mode encode/decode -> définir les bases source/cible en fonction du mode
        if "mode" in inputs and inputs.get("mode") == "encode":
            # Pour encoder, on va d'ASCII vers hexadécimal par défaut
            if "source_base" not in inputs:
                inputs["source_base"] = "ascii"
            if "target_base" not in inputs:
                inputs["target_base"] = "16"
        elif "mode" in inputs and inputs.get("mode") == "decode":
            # Pour décoder, on va d'hexadécimal vers ASCII par défaut
            if "source_base" not in inputs:
                inputs["source_base"] = "16" 
            if "target_base" not in inputs:
                inputs["target_base"] = "ascii"
                
        print('inputs base converter (adaptés)', inputs)
        
        # Récupérer les paramètres
        input_value = inputs.get("input_value", "")
        source_base = inputs.get("source_base", "auto")
        target_base = inputs.get("target_base", "auto")
        strict_mode = inputs.get("strict", "").lower() == "strict"
        embedded = inputs.get("embedded", False)
        # Détection du mode bruteforce (plusieurs conventions possibles selon l'UI)
        bruteforce_param1 = inputs.get("bruteforce", False)  # nouvelle clé sans underscore
        bruteforce_param2 = inputs.get("brute_force", False) # clé historique avec underscore
        mode_param = inputs.get("mode", "").lower()

        # Le bruteforce est déclenché si l'un des paramètres est vrai ou si le mode explicite est "bruteforce"
        do_bruteforce = bruteforce_param1 or bruteforce_param2 or (mode_param == "bruteforce")

        # ------------------------------------------------------------------
        #  Début du traitement principal
        # ------------------------------------------------------------------

        # Vérifier si la valeur d'entrée est vide
        if not input_value:
            standardized_response["status"] = "error"
            standardized_response["summary"]["message"] = "Aucune valeur fournie à convertir."
            return standardized_response

        # Mode bruteforce ou base auto => on essaye toutes les combinaisons
        if do_bruteforce or source_base == "auto" or target_base == "auto":
            # Lancer le bruteforce
            results = self.bruteforce_convert(input_value, strict_mode, embedded)
            
            if results:
                standardized_response["results"] = results
                standardized_response["summary"]["best_result_id"] = results[0]["id"]
                standardized_response["summary"]["total_results"] = len(results)
                standardized_response["summary"]["message"] = f"{len(results)} conversion(s) possible(s) trouvée(s)."
            else:
                standardized_response["status"] = "error"
                standardized_response["summary"]["message"] = "Aucune conversion valide trouvée."
                
        else:
            # Mode normal avec bases spécifiées
            
            # Vérifier si les bases source et cible sont identiques
            if source_base == target_base:
                standardized_response["results"] = [{
                    "id": "result_1",
                    "text_output": input_value,
                    "confidence": 1.0,
                    "parameters": {
                        "source_base": source_base,
                        "target_base": target_base
                    }
                }]
                standardized_response["summary"]["best_result_id"] = "result_1"
                standardized_response["summary"]["total_results"] = 1
                standardized_response["summary"]["message"] = "Les bases source et cible sont identiques, aucune conversion nécessaire."
                
                # Ajouter le temps d'exécution
                standardized_response["plugin_info"]["execution_time"] = int((time.time() - start_time) * 1000)
                
                return standardized_response
                
            try:
                # Vérifier si l'entrée contient du code valide dans la base source
                check_result = self.check_code(input_value, source_base, strict_mode, None, embedded)
                
                if check_result["is_match"]:
                    if embedded:
                        # En mode embedded, convertir uniquement les fragments valides
                        converted_text = self.decode_fragments(
                            input_value, 
                            check_result["fragments"], 
                            source_base, 
                            target_base
                        )
                        
                        standardized_response["results"] = [{
                            "id": "result_1",
                            "text_output": converted_text,
                            "confidence": check_result["score"],
                            "parameters": {
                                "source_base": source_base,
                                "target_base": target_base,
                                "fragments_count": len(check_result["fragments"])
                            },
                            "metadata": {
                                "fragments": [f["value"] for f in check_result["fragments"]]
                            }
                        }]
                        
                        standardized_response["summary"]["best_result_id"] = "result_1"
                        standardized_response["summary"]["total_results"] = 1
                        standardized_response["summary"]["message"] = f"{len(check_result['fragments'])} fragment(s) converti(s) de base {source_base} vers base {target_base}."
                    
                    else:
                        # En mode normal, convertir toute l'entrée
                        converted_value = self.convert_base(input_value, source_base, target_base)
                        
                        standardized_response["results"] = [{
                            "id": "result_1",
                            "text_output": converted_value,
                            "confidence": 1.0,
                            "parameters": {
                                "source_base": source_base,
                                "target_base": target_base
                            }
                        }]
                        
                        standardized_response["summary"]["best_result_id"] = "result_1"
                        standardized_response["summary"]["total_results"] = 1
                        standardized_response["summary"]["message"] = f"Conversion réussie de base {source_base} vers base {target_base}."
                else:
                    standardized_response["status"] = "error"
                    standardized_response["summary"]["message"] = f"La valeur fournie n'est pas valide dans la base {source_base}."
                    
            except Exception as e:
                standardized_response["status"] = "error"
                standardized_response["summary"]["message"] = f"Erreur lors de la conversion : {str(e)}"
                
        # Ajouter le temps d'exécution
        standardized_response["plugin_info"]["execution_time"] = int((time.time() - start_time) * 1000)
        
        return standardized_response

# Instanciation du plugin pour compatibilité avec le système de plugins
plugin = BaseConverterPlugin()