import time
import re
import json
import os
import requests
from itertools import product

# Import du service de scoring
try:
    from app.services.scoring_service import ScoringService
    scoring_service_available = True
    print("Module de scoring disponible")
except ImportError:
    scoring_service_available = False
    print("Module de scoring non disponible, utilisation du scoring legacy uniquement")

class T9CodePluginSafe:
    """
    Plugin T9 SÉCURISÉ avec garde-fous contre les explosions combinatoires.
    
    Limites strictes :
    - Séquences max 12 caractères
    - Max 1000 combinaisons par segment  
    - Max 50 candidats finaux
    - Timeout de 5 secondes
    """

    def __init__(self):
        self.name = "t9_code"
        self.description = "Plugin T9 sécurisé avec protection contre les explosions combinatoires"
        
        # Limites de sécurité STRICTES
        self.MAX_SEQUENCE_LENGTH = 12  # Au lieu de 15
        self.MAX_COMBINATIONS_PER_SEGMENT = 1000  # Au lieu de 10000
        self.MAX_FINAL_CANDIDATES = 50
        self.MAX_SEGMENTS = 5  # Max 5 mots séparés par 0
        self.MAX_EXECUTION_TIME = 5  # 5 secondes max
        
        # Table T9 standard
        self.t9_mapping = {
            '2': 'ABC', '3': 'DEF', '4': 'GHI', '5': 'JKL',
            '6': 'MNO', '7': 'PQRS', '8': 'TUV', '9': 'WXYZ'
        }
        
        # Table inverse pour encodage
        self.letter_to_t9 = {}
        for digit, letters in self.t9_mapping.items():
            for letter in letters:
                self.letter_to_t9[letter] = digit
        
        # Initialiser les services
        self._init_services()

    def _init_services(self):
        """Initialise les services de manière sécurisée"""
        # Configuration
        plugin_config_path = os.path.join(os.path.dirname(__file__), 'plugin.json')
        try:
            with open(plugin_config_path, 'r') as f:
                config = json.load(f)
                self.enable_scoring = config.get('enable_scoring', False)
        except Exception:
            self.enable_scoring = False
        
        # Service de scoring
        self.scoring_service = None
        self.scoring_service_available = scoring_service_available
        if scoring_service_available:
            try:
                self.scoring_service = ScoringService()
            except Exception:
                self.scoring_service_available = False
        
        # Service de dictionnaire
        try:
            from app.services.dictionary_service import get_dictionary_service
            self.dict_service = get_dictionary_service()
            self.dict_service_available = True
        except ImportError:
            self.dict_service_available = False

    def encode(self, text: str) -> str:
        """Encode le texte en T9 de manière sécurisée"""
        if len(text) > 50:  # Limite arbitraire pour éviter les très longs textes
            text = text[:50]
        
        result = []
        for char in text.upper():
            if char in self.letter_to_t9:
                result.append(self.letter_to_t9[char])
            elif char == ' ':
                result.append('0')
        
        return ''.join(result)

    def decode_safe(self, text: str, language: str = 'auto', max_results: int = 10) -> list:
        """Décode le texte T9 avec protection contre les explosions"""
        start_time = time.time()
        
        # Nettoyage et validation
        text = re.sub(r'[^0-9]', '', text)
        if not text or len(text) > 20:  # Limite stricte
            return []
        
        # Gérer les espaces (0)
        normalized_text = re.sub(r'0+', '0', text)
        segments = normalized_text.split('0')
        segments = [seg for seg in segments if seg]
        
        if not segments or len(segments) > self.MAX_SEGMENTS:
            return []
        
        print(f"Debug SAFE: {len(segments)} segments à traiter")
        
        # Générer les combinaisons pour chaque segment avec limites strictes
        all_combinations = []
        total_combinations = 1
        
        for segment in segments:
            if time.time() - start_time > self.MAX_EXECUTION_TIME:
                print("⚠️ Timeout atteint - arrêt du traitement")
                return []
            
            if len(segment) > 8:  # Limite très stricte par segment
                print(f"⚠️ Segment trop long: {len(segment)} caractères")
                continue
                
            segment_combinations = self._generate_combinations_safe(segment)
            if not segment_combinations:
                continue
                
            all_combinations.append(segment_combinations)
            total_combinations *= len(segment_combinations)
            
            # Vérification de sécurité
            if total_combinations > 10000:  # Limite stricte sur le produit final
                print(f"⚠️ Trop de combinaisons potentielles: {total_combinations}")
                # Réduire drastiquement les combinaisons
                all_combinations = [combo[:10] for combo in all_combinations]
                break
        
        if not all_combinations:
            return []
        
        # Générer les candidats finaux avec limite stricte
        try:
            word_candidates = self._generate_final_candidates_safe(all_combinations)
        except MemoryError:
            print("⚠️ Erreur mémoire détectée")
            return []
        
        if time.time() - start_time > self.MAX_EXECUTION_TIME:
            print("⚠️ Timeout final atteint")
            return []
        
        # Filtrage sécurisé
        valid_words = self._filter_safe(word_candidates, language, max_results)
        
        print(f"Debug SAFE: {len(valid_words)} mots valides trouvés")
        return valid_words

    def _generate_combinations_safe(self, sequence: str) -> list:
        """Génère les combinaisons avec protection stricte"""
        if not sequence or len(sequence) > self.MAX_SEQUENCE_LENGTH:
            return []
        
        combinations = [""]
        
        for digit in sequence:
            if digit in self.t9_mapping:
                letters = self.t9_mapping[digit]
                new_combinations = []
                
                for combo in combinations:
                    for letter in letters:
                        new_combinations.append(combo + letter)
                        
                        # Protection contre l'explosion
                        if len(new_combinations) > self.MAX_COMBINATIONS_PER_SEGMENT:
                            print(f"⚠️ Limite de combinaisons atteinte: {len(new_combinations)}")
                            return new_combinations[:self.MAX_COMBINATIONS_PER_SEGMENT]
                
                combinations = new_combinations
        
        return combinations[:self.MAX_COMBINATIONS_PER_SEGMENT]

    def _generate_final_candidates_safe(self, all_combinations: list) -> list:
        """Génère les candidats finaux avec protection mémoire"""
        if len(all_combinations) == 1:
            return all_combinations[0][:self.MAX_FINAL_CANDIDATES]
        
        # Limiter drastiquement pour éviter l'explosion du produit cartésien
        limited_combinations = []
        for combinations in all_combinations:
            limited_combinations.append(combinations[:min(10, len(combinations))])
        
        word_candidates = []
        count = 0
        
        try:
            for combination in product(*limited_combinations):
                word_candidates.append(' '.join(combination))
                count += 1
                
                # Limite stricte pour éviter les blocages
                if count >= self.MAX_FINAL_CANDIDATES:
                    break
                    
        except Exception as e:
            print(f"⚠️ Erreur dans la génération: {str(e)}")
            return []
        
        return word_candidates

    def _filter_safe(self, candidates: list, language: str, max_results: int) -> list:
        """Filtre les candidats de manière sécurisée"""
        if not candidates:
            return []
        
        # Mots prioritaires pour le géocaching
        priority_words = {
            'DCODE': 0.95, 'CODE': 0.90, 'CACHE': 0.85, 'MONDE': 0.90,
            'HELLO': 0.80, 'THE': 0.75, 'AREA': 0.80, 'BONJOUR': 0.85
        }
        
        valid_words = []
        test_limit = min(len(candidates), 100)  # Limite très stricte
        
        for i, candidate in enumerate(candidates[:test_limit]):
            if len(candidate) < 2:
                continue
            
            # Vérifier les mots prioritaires d'abord
            if candidate.upper() in priority_words:
                valid_words.append({
                    'word': candidate,
                    'score': priority_words[candidate.upper()],
                    'language': 'priority',
                    'length': len(candidate)
                })
                continue
            
            # Test avec dictionnaire si disponible
            if self.dict_service_available:
                try:
                    languages_to_try = ['fr', 'en'] if language == 'auto' else [language]
                    best_score = 0
                    best_language = None
                    
                    for lang in languages_to_try:
                        if self.dict_service.is_valid_word(candidate, language=lang):
                            score = self.dict_service.get_word_score(candidate, language=lang)
                            score = max(score, 0.3)  # Score minimum
                            if score > best_score:
                                best_score = score
                                best_language = lang
                    
                    if best_score > 0:
                        valid_words.append({
                            'word': candidate,
                            'score': best_score,
                            'language': best_language,
                            'length': len(candidate)
                        })
                        
                except Exception:
                    continue
        
        # Trier et limiter
        valid_words.sort(key=lambda x: (x['score'], x['length']), reverse=True)
        return valid_words[:max_results]

    def execute(self, inputs: dict) -> dict:
        """Point d'entrée sécurisé du plugin"""
        start_time = time.time()
        
        # Extraire les paramètres avec validation
        mode = inputs.get("mode", "decode").lower()
        text = inputs.get("text", "").strip()
        language = inputs.get("language", "auto")
        max_results = min(int(inputs.get("max_results", 10)), 20)  # Limite stricte
        
        # Validation d'entrée
        if len(text) > 30:  # Limite très stricte
            return {
                "status": "error",
                "plugin_info": {"name": self.name, "version": "1.0.0-safe", "execution_time": 0},
                "results": [],
                "summary": {"message": "⚠️ Texte trop long (>30 caractères) - Protection anti-crash activée"}
            }
        
        # Structure de réponse
        response = {
            "status": "success",
            "plugin_info": {"name": self.name, "version": "1.0.0-safe", "execution_time": 0},
            "inputs": inputs.copy(),
            "results": [],
            "summary": {"best_result_id": None, "total_results": 0, "message": ""}
        }
        
        try:
            if mode == "encode":
                encoded = self.encode(text)
                response["results"] = [{
                    "id": "result_1",
                    "text_output": encoded,
                    "confidence": 1.0,
                    "parameters": {"mode": mode},
                    "metadata": {"original_text": text, "safe_mode": True}
                }]
                response["summary"]["best_result_id"] = "result_1"
                response["summary"]["total_results"] = 1
                response["summary"]["message"] = "Encodage T9 sécurisé réussi"
                
            elif mode == "decode":
                decoded_results = self.decode_safe(text, language, max_results)
                
                for i, result in enumerate(decoded_results):
                    confidence = min(result['score'], 1.0)
                    response["results"].append({
                        "id": f"result_{i+1}",
                        "text_output": result['word'],
                        "confidence": confidence,
                        "parameters": {"mode": mode, "language": language},
                        "metadata": {
                            "detected_language": result['language'],
                            "safe_mode": True,
                            "original_score": result['score']
                        }
                    })
                
                if response["results"]:
                    response["summary"]["best_result_id"] = "result_1"
                    response["summary"]["total_results"] = len(response["results"])
                    response["summary"]["message"] = f"{len(response['results'])} solution(s) T9 sécurisée(s)"
                else:
                    response["summary"]["message"] = "Aucune solution trouvée (mode sécurisé)"
            
        except Exception as e:
            response["status"] = "error"
            response["summary"]["message"] = f"⚠️ Erreur sécurisée: {str(e)}"
        
        # Calculer le temps d'exécution
        execution_time = int((time.time() - start_time) * 1000)
        response["plugin_info"]["execution_time"] = execution_time
        
        return response


# Point d'entrée pour le système de plugins
def execute(inputs):
    plugin = T9CodePluginSafe()
    return plugin.execute(inputs)


if __name__ == "__main__":
    # Tests de sécurité
    plugin = T9CodePluginSafe()
    
    print("=== Tests de Sécurité T9 ===")
    
    # Test normal
    result = plugin.execute({"text": "32633", "mode": "decode", "language": "fr"})
    print(f"Test normal: {result['summary']['message']}")
    
    # Test avec texte long (devrait être rejeté)
    long_text = "1234567890" * 5  # 50 caractères
    result = plugin.execute({"text": long_text, "mode": "decode"})
    print(f"Test texte long: {result['summary']['message']}")
    
    # Test encodage
    result = plugin.execute({"text": "HELLO", "mode": "encode"})
    print(f"Test encodage: {result['summary']['message']}")
    
    print("=== Tests terminés ===") 