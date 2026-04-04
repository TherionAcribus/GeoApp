import re
import time
import json
import os
import requests

# Import du service de scoring
try:
    from app.services.scoring_service import ScoringService
    scoring_service_available = True
    print("Module de scoring disponible")
except ImportError:
    scoring_service_available = False
    print("Module de scoring non disponible, utilisation du scoring legacy uniquement")

class KennyCodePlugin:
    """
    Plugin pour encoder/décoder du texte avec le code Kenny.
    - mode="encode" : convertit un texte normal en code Kenny
    - mode="decode" : convertit du code Kenny en texte normal
    - Gère les modes strict/smooth selon le nouveau système de plugins
    """

    def __init__(self):
        self.name = "kenny_code"
        self.description = "Plugin pour encoder/décoder du texte avec le code Kenny"

        # Tables d'encodage/décodage pour le code Kenny
        # Le code Kenny utilise des triplets de lettres: mmm, mmp, mmf, etc.
        self.encode_table = {
            'a': 'mmm', 'b': 'mmp', 'c': 'mmf', 'd': 'mpm', 'e': 'mpp',
            'f': 'mpf', 'g': 'mfm', 'h': 'mfp', 'i': 'mff', 'j': 'pmm',
            'k': 'pmp', 'l': 'pmf', 'm': 'ppm', 'n': 'ppp', 'o': 'ppf',
            'p': 'pfm', 'q': 'pfp', 'r': 'pff', 's': 'fmm', 't': 'fmp',
            'u': 'fmf', 'v': 'fpm', 'w': 'fpp', 'x': 'fpf', 'y': 'ffm',
            'z': 'ffp', 
        }
        
        # Table de décodage (inverser la table d'encodage)
        self.decode_table = {v: k for k, v in self.encode_table.items()}
        
        # Récupérer la configuration depuis plugin.json
        plugin_config_path = os.path.join(os.path.dirname(__file__), 'plugin.json')
        try:
            with open(plugin_config_path, 'r') as f:
                config = json.load(f)
                # Récupérer le paramètre enable_scoring
                self.enable_scoring = config.get('enable_scoring', False)
                print(f"Paramètre enable_scoring configuré: {self.enable_scoring}")
        except (FileNotFoundError, json.JSONDecodeError) as e:
            self.enable_scoring = False  # Valeur par défaut
            print(f"Erreur lors du chargement de la configuration: {str(e)}")
        
        # Initialiser le service de scoring local si disponible
        self.scoring_service = None
        if scoring_service_available:
            try:
                self.scoring_service = ScoringService()
                print("Service de scoring initialisé avec succès")
            except Exception as e:
                print(f"Erreur lors de l'initialisation du service de scoring: {str(e)}")
        
        # Conserver l'URL API pour la rétrocompatibilité
        self.scoring_api_url = "http://localhost:5000/api/plugins/score"

    def check_code(self, text: str, strict: bool = False, allowed_chars=None, embedded: bool = False) -> dict:
        """
        Vérifie si le texte contient du code Kenny valide.
        
        Args:
            text: Texte à analyser
            strict: Mode strict (True) ou smooth (False)
            allowed_chars: Liste de caractères autorisés en plus des caractères Kenny
            embedded: True si le texte peut contenir du code intégré, False si tout le texte doit être du code
            
        Returns:
            Un dictionnaire contenant:
            - is_match: True si du code Kenny a été trouvé
            - fragments: Liste des fragments de code Kenny trouvés
            - score: Score de confiance (0.0 à 1.0)
        """
        # Si allowed_chars est fourni comme liste, on la convertit en chaîne
        if allowed_chars is not None and isinstance(allowed_chars, list):
            allowed_chars = ''.join(allowed_chars)
            
        # Caractères autorisés par défaut
        if allowed_chars is None:
            allowed_chars = " \t\r\n.:;,_-°"
            
        # Caractères Kenny valides (les triplets de m, p, f dans la table de conversion)
        kenny_chars = "mpf"
        
        # En mode strict, le comportement dépend du paramètre embedded
        if strict:
            if embedded:
                # En mode strict+embedded, on recherche des fragments de code Kenny valides dans le texte
                return self._extract_kenny_fragments(text, allowed_chars)
            else:
                # En mode strict sans embedded, on vérifie que tout le texte est du code Kenny valide
                import re
                
                # Échapper les caractères spéciaux pour l'expression régulière
                esc_punct = re.escape(allowed_chars)
                
                # Créer un pattern qui accepte uniquement les caractères Kenny et les caractères autorisés
                pattern_str = f"^[{kenny_chars}{esc_punct}]*$"
                
                # Vérifier que tous les caractères sont autorisés
                if not re.match(pattern_str, text.lower()):
                    return {"is_match": False, "fragments": [], "score": 0.0}
                
                # Vérifier qu'il y a au moins un caractère Kenny
                kenny_chars_found = re.sub(f"[{esc_punct}]", "", text.lower())
                if not kenny_chars_found:
                    return {"is_match": False, "fragments": [], "score": 0.0}
                
                # Vérifier que le texte contient des triplets Kenny valides
                # Supprimer les caractères autorisés
                clean_text = re.sub(f"[{esc_punct}]", "", text.lower())
                
                # Vérifier si le texte contient des triplets Kenny valides
                valid_triplets = []
                for i in range(0, len(clean_text), 3):
                    if i + 3 <= len(clean_text):
                        triplet = clean_text[i:i+3]
                        if triplet in self.decode_table:
                            valid_triplets.append(triplet)
                        
                if not valid_triplets:
                    return {"is_match": False, "fragments": [], "score": 0.0}
                
                # Tout est OK, on renvoie le texte "strippé" comme fragment
                stripped_text = text.strip(allowed_chars)
                return {
                    "is_match": True,
                    "fragments": [{"value": stripped_text, "start": text.find(stripped_text), "end": text.find(stripped_text) + len(stripped_text)}],
                    "score": 1.0
                }
        else:
            # En mode smooth, on recherche des fragments de code Kenny valides dans le texte
            return self._extract_kenny_fragments(text, allowed_chars)
            
    def _extract_kenny_fragments(self, text: str, allowed_chars: str) -> dict:
        """
        Extrait les fragments de code Kenny valides dans le texte.
        
        Args:
            text: Texte à analyser
            allowed_chars: Caractères autorisés en plus des caractères Kenny
            
        Returns:
            Un dictionnaire contenant:
            - is_match: True si des fragments ont été trouvés
            - fragments: Liste des fragments contenant du code Kenny
            - score: Score de confiance (0.0 à 1.0)
        """
        import re
        
        # Caractères Kenny valides
        kenny_chars = "mpf"
        
        # Échapper les caractères spéciaux pour l'expression régulière
        esc_punct = re.escape(allowed_chars)
        
        # Rechercher des blocs de texte séparés par des caractères autorisés
        pattern = f"([^{esc_punct}]+)|([{esc_punct}]+)"
        fragments = []
        
        for m in re.finditer(pattern, text.lower()):
            block = m.group(0)
            start, end = m.span()
            
            # Ignorer les blocs de ponctuation
            if re.match(f"^[{esc_punct}]+$", block):
                continue
            
            # Vérifier si le bloc contient des triplets Kenny valides
            valid_triplets = []
            for i in range(0, len(block), 3):
                if i + 3 <= len(block):
                    triplet = block[i:i+3]
                    if triplet in self.decode_table:
                        valid_triplets.append(triplet)
                    
            if valid_triplets:
                fragments.append({"value": text[start:end], "start": start, "end": end})
        
        # Calculer un score basé sur le nombre de fragments trouvés
        score = 1.0 if fragments else 0.0
        
        return {
            "is_match": bool(fragments),
            "fragments": fragments,
            "score": score
        }

    def decode_fragments(self, text: str, fragments: list) -> str:
        """
        Décode uniquement les fragments valides dans le texte.
        Remplace chaque fragment par son décodage, tout en préservant le reste du texte.
        """
        sorted_fragments = sorted(fragments, key=lambda x: x["start"])
        result = []
        last_pos = 0
        
        for frag in sorted_fragments:
            result.append(text[last_pos:frag["start"]])
            result.append(self.decode(frag["value"]))
            last_pos = frag["end"]
            
        result.append(text[last_pos:])
        return "".join(result)

    def encode(self, text: str) -> str:
        """
        Encode le texte en code Kenny.
        Les lettres sont converties selon la table d'encodage, les espaces sont conservés.
        """
        result = []
        for char in text.lower():
            if char in self.encode_table:
                result.append(self.encode_table[char])
            elif char.isspace():
                result.append(' ')
            else:
                result.append(char)
        return ''.join(result)

    def decode(self, text: str) -> str:
        """
        Décode le code Kenny en texte normal.
        Parcourt le texte en groupes de trois caractères, en conservant les espaces.
        """
        result = []
        i = 0
        current_group = []
        
        while i < len(text):
            if text[i].isspace():
                if current_group:
                    result.append(self._decode_group(''.join(current_group)))
                    current_group = []
                result.append(' ')
                i += 1
            else:
                current_group.append(text[i])
                if len(current_group) == 3:
                    result.append(self._decode_group(''.join(current_group)))
                    current_group = []
                i += 1
        
        if current_group:
            result.append(self._decode_group(''.join(current_group)))
        
        return ''.join(result)

    def _decode_group(self, group: str) -> str:
        return self.decode_table.get(group, '?')

    def _clean_text_for_scoring(self, text: str) -> str:
        """
        Nettoie le texte décodé pour le scoring.
        Supprime les espaces et caractères spéciaux pour une évaluation plus précise.
        
        Args:
            text: Le texte décodé à nettoyer
            
        Returns:
            Le texte nettoyé prêt pour le scoring
        """
        # Supprimer tout caractère non-alphanumérique (sauf espaces)
        text = re.sub(r'[^\w\s]', '', text)
        
        # Supprimer les espaces multiples
        text = re.sub(r'\s+', ' ', text).strip()
        
        print(f"Texte nettoyé pour scoring: {text}")
        return text
        
    def _get_text_score(self, text, context=None):
        """
        Obtient le score de confiance d'un texte en utilisant le service de scoring.
        
        Args:
            text: Le texte à évaluer
            context: Contexte optionnel (coordonnées de géocache, etc.)
        
        Returns:
            Dictionnaire contenant le résultat du scoring, ou None en cas d'erreur
        """
        # Nettoyer le texte avant le scoring
        cleaned_text = self._clean_text_for_scoring(text)
        
        # Préparer les données
        data = {
            "text": cleaned_text
        }
        
        # Ajouter le contexte s'il est fourni
        if context:
            data["context"] = context
        
        print(f"Évaluation du texte: {cleaned_text[:30]}...")
        
        # Utiliser le service local si disponible
        if self.scoring_service:
            try:
                print("Appel direct au service de scoring local")
                result = self.scoring_service.score_text(cleaned_text, context)
                print(f"Résultat du scoring local: {result}")
                return result
            except Exception as e:
                print(f"Erreur lors de l'évaluation locale: {str(e)}")
                # On pourrait tomber en fallback sur l'API, mais pour simplifier,
                # on va juste retourner None en cas d'erreur
                return None
        else:
            # Fallback: utiliser l'API distante si le service local n'est pas disponible
            try:
                print(f"Appel à l'API de scoring: {self.scoring_api_url}")
                response = requests.post(self.scoring_api_url, json=data)
                
                if response.status_code == 200:
                    result = response.json()
                    if result.get("success"):
                        api_result = result.get("result", {})
                        print(f"Résultat de l'API: {api_result}")
                        return api_result
                    else:
                        print(f"Erreur API: {result.get('error')}")
                else:
                    print(f"Erreur HTTP: {response.status_code}")
                    
                return None
            except Exception as e:
                print(f"Erreur lors de l'appel à l'API de scoring: {str(e)}")
                return None

    def execute(self, inputs: dict) -> dict:
        """
        Point d'entrée principal du plugin.
        
        Args:
            inputs: Dictionnaire contenant les paramètres d'entrée
                - mode: "encode" ou "decode"
                - text: Texte à encoder ou décoder
                - strict: "strict" ou "smooth" pour le mode de décodage
                - allowed_chars: Liste de caractères autorisés pour le mode smooth
                - embedded: True si le texte peut contenir du code intégré, False si tout le texte doit être du code
                - enable_scoring: Activation du scoring automatique
                
        Returns:
            Dictionnaire au format standardisé contenant le résultat de l'opération
        """
        # Mesurer le temps d'exécution
        start_time = time.time()
        
        mode = inputs.get("mode", "encode").lower()
        text = inputs.get("text", "")
        
        # Vérifier si le scoring automatique est activé
        enable_scoring = inputs.get('enable_scoring', True)
        print(f"État du scoring: param={enable_scoring}, type={type(enable_scoring)}")
        
        # Extraire le contexte pour le scoring (si présent)
        context = inputs.get('context', {})
        
        # Considère le mode strict si la valeur du paramètre "strict" est exactement "strict"
        strict_mode = inputs.get("strict", "").lower() == "strict"
        
        # Récupération de la liste des caractères autorisés sous la clé "allowed_chars"
        allowed_chars = inputs.get("allowed_chars", " ,.;:!?-_")
        
        # Récupération du mode embedded
        embedded = inputs.get("embedded", False)
        
        # Initialiser la structure standardisée
        result = {
            "status": "success",
            "plugin_info": {
                "name": self.name,
                "version": "1.2.0",
                "execution_time": 0  # Sera mis à jour à la fin
            },
            "inputs": inputs,
            "results": [],
            "summary": {
                "total_results": 0
            }
        }

        if not text:
            result["status"] = "error"
            result["summary"]["message"] = "Aucun texte fourni à traiter."
            return result

        try:
            if mode == "encode":
                encoded = self.encode(text)
                
                # Ajouter le résultat au format standardisé
                result["results"].append({
                    "id": "result_1",
                    "text_output": encoded,
                    "confidence": 1.0,  # Confiance maximale pour l'encodage
                    "parameters": {
                        "mode": mode
                    },
                    "metadata": {}
                })
                
                result["summary"]["total_results"] = 1
                result["summary"]["best_result_id"] = "result_1"
                result["summary"]["message"] = "Encodage en Kenny Code réussi"
                
            elif mode == "decode":
                if strict_mode:
                    check = self.check_code(text, strict=True, allowed_chars=allowed_chars, embedded=embedded)
                    if not check["is_match"]:
                        result["status"] = "error"
                        result["summary"]["message"] = "Code Kenny invalide en mode strict"
                        return result
                        
                    # Concatène les fragments valides et effectue le décodage
                    decoded = self.decode_fragments(text, check["fragments"])
                    
                    # Utiliser le service de scoring si activé, sinon conserver le score du check
                    if enable_scoring:
                        print(f"Texte décodé: {decoded}")
                        scoring_result = self._get_text_score(decoded, context)
                        if scoring_result and 'score' in scoring_result:
                            confidence = scoring_result['score']
                            print(f"Score utilisé: {confidence}")
                        else:
                            # Fallback sur le score de détection si le scoring échoue
                            confidence = 0.9  # Haute confiance en mode strict
                            print(f"Échec du scoring, utilisation du score de détection: {confidence}")
                            scoring_result = None
                    else:
                        confidence = 0.9  # Haute confiance en mode strict
                        scoring_result = None
                    
                    # Ajouter le résultat au format standardisé
                    result_entry = {
                        "id": "result_1",
                        "text_output": decoded,
                        "confidence": confidence,
                        "parameters": {
                            "mode": mode,
                            "strict": "strict",
                            "embedded": embedded
                        },
                        "metadata": {
                            "fragments_count": len(check["fragments"]),
                            "full_match": len(check["fragments"]) == 1 and check["fragments"][0]["start"] == 0 and check["fragments"][0]["end"] == len(text)
                        }
                    }
                    
                    # Ajouter les résultats du scoring s'ils sont disponibles
                    if scoring_result:
                        result_entry["scoring"] = scoring_result
                    
                    result["results"].append(result_entry)
                    
                    result["summary"]["total_results"] = 1
                    result["summary"]["best_result_id"] = "result_1"
                    result["summary"]["message"] = "Décodage réussi en mode strict"
                    
                else:
                    check = self.check_code(text, strict=False, allowed_chars=allowed_chars, embedded=embedded)
                    if not check["is_match"]:
                        # Si aucun fragment n'a été trouvé, on retourne une erreur
                        result["status"] = "error"
                        result["summary"]["message"] = "Aucun code Kenny détecté dans le texte"
                        return result
                    
                    # Décode les fragments trouvés
                    decoded = self.decode_fragments(text, check["fragments"])
                    
                    # Vérifier si le texte décodé est différent du texte d'origine
                    if decoded == text:
                        result["status"] = "error"
                        result["summary"]["message"] = "Aucun code Kenny n'a pu être décodé"
                        return result
                    
                    # Précalculer la longueur des fragments et le ratio de couverture pour éviter des erreurs
                    fragments_text_length = sum(len(frag["value"]) for frag in check["fragments"])
                    coverage_ratio = fragments_text_length / len(text) if text else 0
                    
                    # Utiliser le service de scoring si activé, sinon utiliser le calcul de confiance legacy
                    if enable_scoring:
                        print(f"Texte décodé: {decoded}")
                        scoring_result = self._get_text_score(decoded, context)
                        if scoring_result and 'score' in scoring_result:
                            confidence = scoring_result['score']
                            print(f"Score utilisé: {confidence}")
                        else:
                            # Fallback sur le calcul de confiance legacy si le scoring échoue
                            # Plus la couverture est grande, plus la confiance est élevée
                            confidence = 0.5 + (coverage_ratio * 0.4)
                            
                            # Pénaliser légèrement si trop de fragments (indique possiblement du bruit)
                            if len(check["fragments"]) > 3:
                                confidence -= 0.1
                                
                            # Limiter à [0.1, 0.9]
                            confidence = max(0.1, min(0.9, confidence))
                            
                            print(f"Échec du scoring, utilisation du calcul de confiance legacy: {confidence}")
                            scoring_result = None
                    else:
                        # Calcul de confiance legacy
                        # Plus la couverture est grande, plus la confiance est élevée
                        confidence = 0.5 + (coverage_ratio * 0.4)
                        
                        # Pénaliser légèrement si trop de fragments (indique possiblement du bruit)
                        if len(check["fragments"]) > 3:
                            confidence -= 0.1
                            
                        # Limiter à [0.1, 0.9]
                        confidence = max(0.1, min(0.9, confidence))
                        
                        scoring_result = None
                    
                    # Ajouter le résultat au format standardisé
                    result_entry = {
                        "id": "result_1",
                        "text_output": decoded,
                        "confidence": confidence,
                        "parameters": {
                            "mode": mode,
                            "strict": "smooth",
                            "embedded": embedded
                        },
                        "metadata": {
                            "fragments_count": len(check["fragments"]),
                            "coverage_ratio": coverage_ratio,
                            "fragments": [{"start": f["start"], "end": f["end"], "value": f["value"]} for f in check["fragments"]]
                        }
                    }
                    
                    # Ajouter les résultats du scoring s'ils sont disponibles
                    if scoring_result:
                        result_entry["scoring"] = scoring_result
                    
                    result["results"].append(result_entry)
                    
                    result["summary"]["total_results"] = 1
                    result["summary"]["best_result_id"] = "result_1"
                    result["summary"]["message"] = f"Décodage réussi en mode souple ({len(check['fragments'])} fragments trouvés)"
                
            else:
                result["status"] = "error"
                result["summary"]["message"] = f"Mode inconnu : {mode}"
                return result
                
        except Exception as e:
            result["status"] = "error"
            result["summary"]["message"] = f"Erreur pendant le traitement : {e}"
            import traceback
            print(traceback.format_exc())
            return result
            
        # Mettre à jour le temps d'exécution
        result["plugin_info"]["execution_time"] = int((time.time() - start_time) * 1000)
        return result

# Point d'entrée pour le plugin
def init():
    return KennyCodePlugin()