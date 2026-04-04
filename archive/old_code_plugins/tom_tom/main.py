import re
import time

class TomTomPlugin:
    """
    Plugin pour encoder/décoder le code Tom Tom (A-Tom-Tom).
    Le code Tom Tom utilise des combinaisons de barres obliques (/ et \) 
    pour représenter les lettres de l'alphabet.
    
    Cette version est spécialisée pour le Tom Tom et n'utilise pas la classe de base
    car les codes multi-caractères nécessitent un traitement spécial.
    """

    def __init__(self):
        self.name = "tom_tom"
        self.description = "Plugin pour encoder/décoder le code Tom Tom (A-Tom-Tom) utilisant des barres obliques / et \\"
        
        # Initialisation du service de scoring
        try:
            from app.services.scoring_service import ScoringService
            self.scoring_service = ScoringService()
            self.scoring_service_available = True
        except ImportError:
            self.scoring_service_available = False
            print("Module de scoring non disponible, utilisation du scoring legacy uniquement")
        
        # Table de correspondance Tom Tom basée sur les sources web vérifiées
        # Source: https://blog.gcwizard.net/manual/en/tomtom-code-cipher/01-what-is-the-tomtom-code/
        # Source: https://www.dcode.fr/tom-tom-code
        self.encode_table = {
            'A': '/',          # /
            'B': '//',         # //
            'C': '///',        # ///
            'D': '////',       # ////
            'E': '/\\',        # /\
            'F': '//\\',       # //\
            'G': '///\\',      # ///\
            'H': '/\\\\',      # /\\
            'I': '/\\\\\\',    # /\\\
            'J': '\\/',        # \/
            'K': '\\\\/',      # \\/
            'L': '\\\\\\/',    # \\\/
            'M': '\\//',       # \//
            'N': '\\///',      # \///
            'O': '/\\/',       # /\/
            'P': '//\\/',      # //\/
            'Q': '/\\\\/',     # /\\/
            'R': '/\\//',      # /\//
            'S': '\\/\\',      # \/\
            'T': '\\\\\\/\\',  # \\\/\
            'U': '\\//\\',     # \//\
            'V': '\\/\\\\',    # \/\\
            'W': '//\\\\',     # //\\
            'X': '\\\\\//',    # \\//
            'Y': '\\/\\/',     # \/\/
            'Z': '/\\\/\\'     # /\/\
        }
        
        # Table de décodage (inverse)
        self.decode_table = {v: k for k, v in self.encode_table.items()}
        
        # Configuration
        self.default_separators = " \t\r\n.:;,_-"
        
    def check_code(self, text: str, strict: bool = False, allowed_chars: str = None, embedded: bool = False) -> dict:
        """
        Vérifie si le texte contient du code Tom Tom valide.
        
        Args:
            text: Texte à analyser
            strict: Mode strict (True) ou smooth (False)
            allowed_chars: Caractères autorisés comme séparateurs
            embedded: True si le code peut être intégré dans du texte
            
        Returns:
            Dictionnaire avec is_match, fragments, score
        """
        if allowed_chars is None:
            allowed_chars = self.default_separators
            
        # Extraire les fragments valides
        fragments = self._extract_tom_tom_fragments(text, allowed_chars)
        
        if strict and not embedded:
            # En mode strict non-embedded, vérifier que tout le texte est du code valide
            if not self._is_all_valid_code(text, allowed_chars):
                return {"is_match": False, "fragments": [], "score": 0.0}
                
        score = 1.0 if fragments else 0.0
        return {
            "is_match": bool(fragments),
            "fragments": fragments,
            "score": score
        }
        
    def _is_all_valid_code(self, text: str, allowed_chars: str) -> bool:
        """Vérifie que tout le texte est composé de code Tom Tom valide et de séparateurs."""
        # Créer un pattern des caractères autorisés
        code_chars = set()
        for code in self.decode_table.keys():
            code_chars.update(code)
        code_chars.update(allowed_chars)
        
        # Vérifier que tous les caractères sont autorisés
        for char in text:
            if char not in code_chars:
                return False
                
        # Vérifier que les fragments non-séparateurs sont des codes valides
        fragments = self._split_by_separators(text, allowed_chars)
        for fragment in fragments:
            if fragment.strip(allowed_chars) and not self._decode_fragment(fragment.strip(allowed_chars)):
                return False
                
        return True
        
    def _extract_tom_tom_fragments(self, text: str, allowed_chars: str) -> list:
        """Extrait les fragments de code Tom Tom valides du texte."""
        fragments = []
        
        # Diviser le texte par séparateurs
        raw_fragments = self._split_by_separators(text, allowed_chars)
        
        for fragment in raw_fragments:
            cleaned = fragment.strip(allowed_chars)
            if cleaned:
                # Essayer de décomposer le fragment en codes Tom Tom valides
                tom_tom_codes = self._decompose_tom_tom(cleaned, fragment.find(cleaned))
                fragments.extend(tom_tom_codes)
                
        return fragments
        
    def _split_by_separators(self, text: str, separators: str) -> list:
        """Divise le texte en gardant la position des fragments."""
        esc_sep = re.escape(separators)
        pattern = f"[^{esc_sep}]+"
        
        fragments = []
        for match in re.finditer(pattern, text):
            fragments.append(match.group(0))
            
        return fragments
        
    def _decompose_tom_tom(self, fragment: str, base_pos: int) -> list:
        """Décompose un fragment en codes Tom Tom valides."""
        # Trier les codes par longueur décroissante (approche gloutonne)
        sorted_codes = sorted(self.decode_table.keys(), key=len, reverse=True)
        
        result = []
        pos = 0
        
        while pos < len(fragment):
            found_match = False
            
            # Essayer de trouver le code le plus long qui correspond
            for code in sorted_codes:
                if fragment[pos:pos+len(code)] == code:
                    result.append({
                        "value": code,
                        "start": base_pos + pos,
                        "end": base_pos + pos + len(code)
                    })
                    pos += len(code)
                    found_match = True
                    break
                    
            if not found_match:
                # Caractère non reconnu, ignorer
                pos += 1
                
        return result
        
    def _decode_fragment(self, fragment: str) -> str:
        """Décode un fragment simple en utilisant l'approche gloutonne."""
        sorted_codes = sorted(self.decode_table.keys(), key=len, reverse=True)
        
        result = []
        pos = 0
        
        while pos < len(fragment):
            found_match = False
            
            for code in sorted_codes:
                if fragment[pos:pos+len(code)] == code:
                    result.append(self.decode_table[code])
                    pos += len(code)
                    found_match = True
                    break
                    
            if not found_match:
                pos += 1
                
        return ''.join(result)
        
    def decode_fragments(self, text: str, fragments: list) -> str:
        """Décode les fragments Tom Tom dans le texte original."""
        # Trier par position décroissante pour éviter les problèmes d'indices
        sorted_fragments = sorted(fragments, key=lambda f: f["start"], reverse=True)
        
        result = list(text)
        for fragment in sorted_fragments:
            start, end = fragment["start"], fragment["end"]
            code = fragment["value"]
            
            if code in self.decode_table:
                decoded = self.decode_table[code]
                result[start:end] = decoded
                
        return ''.join(result)
        
    def encode(self, text: str) -> str:
        """Encode le texte en code Tom Tom."""
        text = text.upper()
        result = []
        
        for char in text:
            if char in self.encode_table:
                result.append(self.encode_table[char])
            elif char in self.default_separators:
                result.append(char)  # Conserver les séparateurs
            else:
                result.append(char)  # Caractère non géré, conservé tel quel
                
        return ' '.join(result) if result else ""
        
    def decode(self, text: str) -> str:
        """Décode le texte Tom Tom."""
        # Méthode simple : diviser par espaces et décoder chaque partie
        tokens = text.split()
        decoded_tokens = []
        
        for token in tokens:
            if token in self.decode_table:
                decoded_tokens.append(self.decode_table[token])
            else:
                # Essayer de décomposer le token
                decoded = self._decode_fragment(token)
                if decoded:
                    decoded_tokens.append(decoded)
                else:
                    decoded_tokens.append(token)  # Garder tel quel
                    
        return ''.join(decoded_tokens)
        
    def get_text_score(self, text: str, context: dict = None):
        """Obtient le score de confiance d'un texte décodé."""
        if not self.scoring_service_available:
            return None
            
        try:
            # Nettoyer le texte avant scoring
            cleaned_text = re.sub(r'\s+', ' ', text.strip())
            result = self.scoring_service.score_text(cleaned_text, context)
            return result
        except Exception as e:
            print(f"Erreur lors de l'évaluation avec le service de scoring: {str(e)}")
            return None
            
    def execute(self, inputs: dict) -> dict:
        """Point d'entrée principal du plugin."""
        start_time = time.time()
        
        mode = inputs.get("mode", "decode").lower()
        text = inputs.get("text", "")
        strict_mode = inputs.get("strict", "").lower() == "strict"
        allowed_chars = inputs.get("allowed_chars", self.default_separators)
        embedded = inputs.get("embedded", False)
        checkbox_value = inputs.get("enable_scoring", "")
        enable_scoring = checkbox_value == "on"
        
        # Structure de réponse standardisée
        response = {
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
                result = self.encode(text)
                response_result = {
                    "id": "result_1",
                    "text_output": result,
                    "confidence": 1.0,
                    "parameters": {"mode": mode},
                    "metadata": {"processed_chars": len(text)}
                }
                
                response["results"].append(response_result)
                response["summary"]["best_result_id"] = "result_1"
                response["summary"]["total_results"] = 1
                response["summary"]["message"] = "Encodage Tom Tom réussi"
                
            elif mode == "decode":
                result = self.decode(text)
                
                # Scoring si activé
                confidence = 0.5
                scoring_result = None
                
                if enable_scoring and self.scoring_service_available:
                    context = inputs.get("context", {})
                    scoring_result = self.get_text_score(result, context)
                    if scoring_result:
                        confidence = scoring_result.get("score", 0.5)
                
                response_result = {
                    "id": "result_1",
                    "text_output": result,
                    "confidence": confidence,
                    "parameters": {
                        "mode": mode,
                        "strict": strict_mode,
                        "embedded": embedded
                    },
                    "metadata": {"processed_chars": len(text)}
                }
                
                if scoring_result:
                    response_result["scoring"] = scoring_result
                
                response["results"].append(response_result)
                response["summary"]["best_result_id"] = "result_1"
                response["summary"]["total_results"] = 1
                response["summary"]["message"] = "Décodage Tom Tom réussi"
                
            elif mode == "detect":
                detection = self.check_code(text, strict_mode, allowed_chars, embedded)
                
                response_result = {
                    "id": "result_1",
                    "text_output": f"Code Tom Tom détecté: {detection['is_match']}",
                    "confidence": detection.get("score", 0.0),
                    "parameters": {
                        "mode": mode,
                        "strict": strict_mode,
                        "embedded": embedded
                    },
                    "metadata": {
                        "fragments_found": len(detection.get("fragments", [])),
                        "is_match": detection["is_match"]
                    }
                }
                
                response["results"].append(response_result)
                response["summary"]["best_result_id"] = "result_1"
                response["summary"]["total_results"] = 1
                response["summary"]["message"] = "Détection Tom Tom effectuée"
                
        except Exception as e:
            response["status"] = "error"
            response["summary"]["message"] = f"Erreur: {str(e)}"
            
        # Temps d'exécution
        execution_time = int((time.time() - start_time) * 1000)
        response["plugin_info"]["execution_time"] = execution_time
        
        return response

# Point d'entrée pour le système de plugins
def execute(inputs: dict) -> dict:
    """Point d'entrée principal pour le plugin Tom Tom."""
    plugin = TomTomPlugin()
    return plugin.execute(inputs)
