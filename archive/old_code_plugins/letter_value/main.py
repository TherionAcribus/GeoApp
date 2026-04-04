import re
import string
import time

class LetterValuePlugin:
    def __init__(self):
        self.name = "letter_value"
        self.description = "Convertit les lettres en valeurs numériques selon leur position dans l'alphabet"
        self.alphabet = string.ascii_uppercase  # A-Z
        
    def letter_to_value(self, letter):
        """Convertit une lettre en sa valeur numérique (A=1, B=2, etc.)"""
        letter = letter.upper()
        if letter in self.alphabet:
            return self.alphabet.index(letter) + 1
        return None
        
    def value_to_letter(self, value):
        """Convertit une valeur numérique en lettre (1=A, 2=B, etc.)"""
        try:
            value = int(value)
            if 1 <= value <= 26:
                return self.alphabet[value - 1]
            return None
        except:
            return None
    
    def calculate_checksum(self, value):
        """
        Calcule le checksum d'une valeur numérique (somme des chiffres jusqu'à obtenir un seul chiffre).
        Ex: 22 -> 2+2 = 4, 19 -> 1+9 = 10 -> 1+0 = 1
        """
        if value is None:
            return None
            
        # Convertir en chaîne pour traiter chaque chiffre
        str_value = str(value)
        
        # Si déjà un seul chiffre, retourner directement
        if len(str_value) == 1:
            return value
            
        # Calculer la somme des chiffres
        sum_digits = sum(int(digit) for digit in str_value)
        
        # Appliquer récursivement jusqu'à obtenir un seul chiffre
        if sum_digits > 9:
            return self.calculate_checksum(sum_digits)
        
        return sum_digits
    
    def check_code(self, text, strict=False, allowed_chars=None, embedded=False):
        """
        Vérifie si le texte contient un code letter value.
        
        Args:
            text: Texte à analyser
            strict: Mode strict (True) ou smooth (False)
            allowed_chars: Liste de caractères autorisés en plus des lettres
            embedded: True si le texte peut contenir du code intégré
            
        Returns:
            Un dictionnaire avec is_match, fragments, score
        """
        if not text:
            return {"is_match": False, "fragments": [], "score": 0.0}
            
        if allowed_chars is None:
            allowed_chars = " ,.°"
            
        # Préparation des caractères autorisés pour regex
        allowed_chars_escaped = re.escape(allowed_chars)
        
        # On considère toutes les séquences de lettres comme potentiellement convertibles
        pattern = r'[A-Za-z]+'
        
        # Recherche différente selon si on cherche du code intégré ou non
        if embedded:
            matches = re.finditer(pattern, text.upper())
            fragments = [text[m.start():m.end()] for m in matches]
        else:
            # En mode non-embedded, on vérifie si tout le texte est fait uniquement de lettres
            # et des caractères autorisés
            valid_chars = self.alphabet + allowed_chars.upper()
            if all(c in valid_chars for c in text.upper()):
                # On extrait uniquement les séquences de lettres
                matches = re.finditer(pattern, text.upper())
                fragments = [text[m.start():m.end()] for m in matches]
            else:
                fragments = []
        
        # Calcul du score basé sur le ratio de caractères de l'alphabet
        alphabet_chars = sum(1 for c in text.upper() if c in self.alphabet)
        total_chars = len(text) if text else 1
        score = alphabet_chars / total_chars if total_chars > 0 else 0
        
        # En mode strict, on ne retourne des fragments que si le score est élevé
        if strict and score < 0.5:
            fragments = []
        
        return {
            "is_match": len(fragments) > 0,
            "fragments": fragments,
            "score": score
        }
    
    def decode_fragments(self, text, fragments):
        """
        Décode uniquement les fragments identifiés comme du code letter value.
        
        Args:
            text: Texte original
            fragments: Liste des fragments à décoder
            
        Returns:
            Texte avec les fragments décodés
        """
        if not fragments:
            return text
            
        result = text
        
        # Trier les fragments par longueur décroissante pour éviter les remplacements partiels
        sorted_fragments = sorted(fragments, key=len, reverse=True)
        
        for fragment in sorted_fragments:
            # Convertir chaque lettre en sa valeur numérique
            decoded = self.encode(fragment)
            
            # Créer un pattern sensible uniquement aux caractères, pas à la casse
            import re
            pattern = ''.join(f'[{c.upper()}{c.lower()}]' for c in fragment)
            
            # Remplacer toutes les occurrences du fragment dans le texte
            result = re.sub(pattern, decoded, result)
            
        return result
    
    def encode(self, text, format="standard", use_checksum=False, brute_force=False):
        """
        Encode un texte en convertissant chaque lettre en sa valeur numérique.
        
        Args:
            text: Texte à encoder
            format: Format de sortie ("standard", "decimal", "combined")
            use_checksum: Utiliser le checksum au lieu de la valeur de position
            brute_force: Afficher les deux possibilités (standard et checksum)
            
        Returns:
            Texte encodé
        """
        result = []
        current_word = ""
        
        for char in text:
            # Si c'est une lettre, l'ajouter au mot courant
            if char.upper() in self.alphabet:
                current_word += char
            else:
                # Si nous avons un mot en cours, le convertir
                if current_word:
                    # Convertir chaque lettre du mot
                    word_result = ""
                    for letter in current_word:
                        value = self.letter_to_value(letter)
                        
                        if value is not None:
                            if brute_force:
                                # Mode force brute: afficher les deux possibilités
                                checksum = self.calculate_checksum(value)
                                word_result += f"{value}/{checksum}"
                            elif use_checksum:
                                # Mode checksum: n'afficher que le checksum
                                word_result += str(self.calculate_checksum(value))
                            else:
                                # Mode standard: valeur normale
                                word_result += str(value)
                        else:
                            # Dans le cas peu probable où une lettre n'est pas reconnue
                            word_result += letter
                    
                    result.append(word_result)
                    current_word = ""
                
                # Ajouter le caractère non-alphabétique tel quel
                result.append(char)
        
        # Ne pas oublier le dernier mot s'il existe
        if current_word:
            word_result = ""
            for letter in current_word:
                value = self.letter_to_value(letter)
                
                if value is not None:
                    if brute_force:
                        # Mode force brute: afficher les deux possibilités
                        checksum = self.calculate_checksum(value)
                        word_result += f"{value}/{checksum}"
                    elif use_checksum:
                        # Mode checksum: n'afficher que le checksum
                        word_result += str(self.calculate_checksum(value))
                    else:
                        # Mode standard: valeur normale
                        word_result += str(value)
                else:
                    word_result += letter
            
            result.append(word_result)
        
        return "".join(result)
    
    def decode(self, text, format="standard"):
        """
        Décode un texte contenant des valeurs numériques en lettres.
        
        Args:
            text: Texte à décoder
            format: Format d'entrée ("standard", "decimal", "combined")
            
        Returns:
            Texte décodé
        """
        # Nettoyage des caractères non essentiels pour l'analyse
        cleaned_text = text.upper()
        
        # Extraire et traiter les chiffres dans le texte
        result = ""
        current_number = ""
        
        # Traitement caractère par caractère
        for char in cleaned_text:
            if char.isdigit():
                current_number += char
            else:
                # Traiter le nombre accumulé s'il existe
                if current_number:
                    letter = self.value_to_letter(int(current_number))
                    result += letter if letter else current_number
                    current_number = ""
                
                # Ajouter les caractères non-numériques tels quels
                if not char.isalpha():  # Ne pas ajouter les lettres originales
                    result += char
        
        # Traiter le dernier nombre s'il existe
        if current_number:
            letter = self.value_to_letter(int(current_number))
            result += letter if letter else current_number
        
        return result.strip()
    
    def detect(self, text, strict=False, allowed_chars=None, embedded=False):
        """
        Détecte la présence de code letter value dans le texte.
        
        Args:
            text: Texte à analyser
            strict: Mode strict (True) ou smooth (False)
            allowed_chars: Liste de caractères autorisés
            embedded: True si le texte peut contenir du code intégré
            
        Returns:
            Résultat de la détection
        """
        check_result = self.check_code(text, strict, allowed_chars, embedded)
        
        # Si on a détecté quelque chose, on tente de décoder
        if check_result["is_match"]:
            fragments = check_result["fragments"]
            decoded_fragments = []
            
            for fragment in fragments:
                decoded = self.decode(fragment)
                if decoded != fragment:  # S'il y a eu un changement lors du décodage
                    decoded_fragments.append({
                        "original": fragment,
                        "decoded": decoded
                    })
            
            return {
                "is_match": True,
                "fragments": decoded_fragments,
                "score": check_result["score"]
            }
        
        return check_result

    def format_coordinates(self, text):
        """
        Tente de formater le résultat comme des coordonnées GPS.
        
        Args:
            text: Texte à formater
            
        Returns:
            Texte formaté si possible, sinon le texte original
        """
        # Recherche un pattern de coordonnées typique: NN° NN.NNN
        pattern = r'(\d+)°\s*(\d+)\.(\d+)'
        match = re.search(pattern, text)
        
        if match:
            degrees = match.group(1)
            minutes = match.group(2)
            seconds = match.group(3)
            
            # Format standard des coordonnées GPS
            return f"{degrees}° {minutes}.{seconds}"
        
        return text
    
    def get_bruteforce_results(self, text, output_format, allowed_chars, embedded, strict_mode):
        """
        Génère plusieurs résultats avec différentes combinaisons de paramètres.
        
        Args:
            text: Texte à traiter
            output_format: Format de sortie
            allowed_chars: Caractères autorisés
            embedded: Si le texte peut contenir du code intégré
            strict_mode: Mode de décodage strict ou non
            
        Returns:
            Liste de dictionnaires contenant les différents résultats
        """
        results = []
        
        # Définir les paramètres à tester
        test_params = [
            {"use_checksum": False, "confidence": 0.9, "description": "Valeurs standard (A=1, B=2...)"},
            {"use_checksum": True, "confidence": 0.7, "description": "Valeurs avec checksum"}
        ]
        
        # Générer un résultat pour chaque combinaison de paramètres
        for idx, params in enumerate(test_params):
            use_checksum = params["use_checksum"]
            confidence = params["confidence"]
            description = params["description"]
            
            # Vérifier si le texte contient du code letter value
            check_result = self.check_code(text, strict_mode, allowed_chars, embedded)
            
            if check_result["is_match"]:
                # Dans le mode décodage, on encode les fragments avec les options données
                result_text = text
                sorted_fragments = sorted(check_result["fragments"], key=len, reverse=True)
                
                for fragment in sorted_fragments:
                    encoded_fragment = self.encode(fragment, output_format, use_checksum, False)
                    
                    # Créer un pattern insensible à la casse pour ce fragment
                    pattern = ''.join(f'[{c.upper()}{c.lower()}]' for c in fragment)
                    
                    # Remplacer dans le texte
                    result_text = re.sub(pattern, encoded_fragment, result_text)
                
                # Tenter de formater comme des coordonnées GPS
                formatted = self.format_coordinates(result_text)
                
                # Ajuster la confiance en fonction du score de détection
                adjusted_confidence = confidence * check_result["score"]
                
                results.append({
                    "id": f"result_{idx + 1}",
                    "text_output": formatted,
                    "confidence": adjusted_confidence,
                    "parameters": {
                        "use_checksum": use_checksum,
                        "output_format": output_format
                    },
                    "metadata": {
                        "fragments": check_result["fragments"],
                        "description": description,
                        "detection_score": check_result["score"]
                    }
                })
            
        return results
    
    def execute(self, inputs):
        """
        Point d'entrée principal du plugin.
        
        Args:
            inputs: Dictionnaire contenant les paramètres d'entrée
                
        Returns:
            Dictionnaire contenant le résultat de l'opération au format standardisé
        """
        start_time = time.time()
        
        print('inputs LetterValue', inputs)
        
        mode = inputs.get("mode", "decode").lower()
        text = inputs.get("text", "")
        strict_mode = inputs.get("strict", "smooth").lower() == "strict"
        allowed_chars = inputs.get("allowed_chars", " ,.°")
        #embedded = inputs.get("embedded", "true") == True or inputs.get("embedded", "true").lower() == "true"
        embedded = inputs.get("embedded")
        output_format = inputs.get("format", "combined").lower()
        use_checksum = inputs.get("checksum", "false").lower() == "true"
        
        # Correction pour éviter l'erreur avec la valeur booléenne
        brute_force_value = inputs.get("brute_force", "false")
        if isinstance(brute_force_value, bool):
            brute_force = brute_force_value
        else:
            brute_force = brute_force_value.lower() == "true"
        
        # Initialiser la structure de résultat standardisée
        normalized_result = {
            "status": "success",
            "plugin_info": {
                "name": self.name,
                "execution_time": int((time.time() - start_time) * 1000)
            },
            "inputs": inputs,
            "results": [],
            "summary": {
                "total_results": 0
            }
        }
        
        if not text:
            normalized_result["status"] = "error"
            normalized_result["summary"]["message"] = "Le texte d'entrée est vide"
            return normalized_result
        
        # Mode bruteforce - générer plusieurs résultats
        if brute_force and mode == "decode":
            results = self.get_bruteforce_results(text, output_format, allowed_chars, embedded, strict_mode)
            if results:
                normalized_result["results"] = results
                normalized_result["summary"]["total_results"] = len(results)
                normalized_result["summary"]["best_result_id"] = results[0]["id"]
                normalized_result["summary"]["message"] = f"{len(results)} résultats générés en mode bruteforce"
            else:
                normalized_result["status"] = "error"
                normalized_result["summary"]["message"] = "Aucun code letter value détecté"
            
            return normalized_result
        
        # Mode standard - un seul résultat
        if mode == "encode":
            encoded = self.encode(text, output_format, use_checksum, False)
            
            normalized_result["results"].append({
                "id": "result_1",
                "text_output": encoded,
                "confidence": 1.0,
                "parameters": {
                    "use_checksum": use_checksum,
                    "output_format": output_format
                },
                "metadata": {}
            })
            
            normalized_result["summary"]["total_results"] = 1
            normalized_result["summary"]["best_result_id"] = "result_1"
            normalized_result["summary"]["message"] = "Encodage réussi"
            
        elif mode == "decode":
            check_result = self.check_code(text, strict_mode, allowed_chars, embedded)
            
            if check_result["is_match"]:
                result_text = text
                sorted_fragments = sorted(check_result["fragments"], key=len, reverse=True)
                
                for fragment in sorted_fragments:
                    encoded_fragment = self.encode(fragment, output_format, use_checksum, False)
                    
                    # Créer un pattern insensible à la casse pour ce fragment
                    pattern = ''.join(f'[{c.upper()}{c.lower()}]' for c in fragment)
                    
                    # Remplacer dans le texte
                    result_text = re.sub(pattern, encoded_fragment, result_text)
                
                # Tenter de formater comme des coordonnées GPS
                formatted = self.format_coordinates(result_text)
                
                normalized_result["results"].append({
                    "id": "result_1",
                    "text_output": formatted,
                    "confidence": check_result["score"],
                    "parameters": {
                        "use_checksum": use_checksum,
                        "output_format": output_format
                    },
                    "metadata": {
                        "fragments": check_result["fragments"]
                    }
                })
                
                normalized_result["summary"]["total_results"] = 1
                normalized_result["summary"]["best_result_id"] = "result_1"
                normalized_result["summary"]["message"] = "Décodage réussi"
            else:
                normalized_result["status"] = "error"
                normalized_result["summary"]["message"] = "Aucun code letter value détecté"
                
        elif mode == "detect":
            detect_result = self.detect(text, strict_mode, allowed_chars, embedded)
            
            if detect_result["is_match"]:
                fragments_info = []
                for fragment in detect_result.get("fragments", []):
                    if isinstance(fragment, dict):
                        fragments_info.append({
                            "original": fragment['original'],
                            "decoded": fragment['decoded']
                        })
                
                details = f"Code letter value détecté avec un score de {detect_result['score']:.2f}"
                
                normalized_result["results"].append({
                    "id": "result_1",
                    "text_output": details,
                    "confidence": detect_result["score"],
                    "parameters": {
                        "strict_mode": strict_mode,
                        "embedded": embedded
                    },
                    "metadata": {
                        "fragments": fragments_info
                    }
                })
                
                normalized_result["summary"]["total_results"] = 1
                normalized_result["summary"]["best_result_id"] = "result_1"
                normalized_result["summary"]["message"] = "Code letter value détecté"
            else:
                normalized_result["status"] = "error"
                normalized_result["summary"]["message"] = f"Aucun code letter value détecté (score: {detect_result['score']:.2f})"
        else:
            normalized_result["status"] = "error"
            normalized_result["summary"]["message"] = f"Mode inconnu : {mode}"
        
        # Mettre à jour le temps d'exécution final
        normalized_result["plugin_info"]["execution_time"] = int((time.time() - start_time) * 1000)
        
        return normalized_result


# Point d'entrée pour le plugin    
def init():
    return LetterValuePlugin()