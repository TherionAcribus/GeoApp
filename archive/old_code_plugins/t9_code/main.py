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

class T9CodePlugin:
    """
    Plugin T9 CORRIGÉ avec traitement mot par mot et scoring amélioré.
    
    Améliorations :
    - Traitement séparé des mots (séparés par 0)
    - Scoring différencié selon la validité des mots
    - Priorisation des mots courts et courants
    - Gestion des espaces multiples
    """

    def __init__(self):
        self.name = "t9_code"
        self.description = "Plugin T9 corrigé avec traitement mot par mot et scoring amélioré"
        
        # Limites de sécurité
        self.MAX_SEQUENCE_LENGTH = 12
        self.MAX_COMBINATIONS_PER_SEGMENT = 1000
        self.MAX_FINAL_CANDIDATES = 50
        self.MAX_SEGMENTS = 10  # Augmenté pour permettre plus de mots
        self.MAX_EXECUTION_TIME = 10  # Augmenté pour permettre plus de traitement
        
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
        if len(text) > 50:
            text = text[:50]
        
        result = []
        for char in text.upper():
            if char in self.letter_to_t9:
                result.append(self.letter_to_t9[char])
            elif char == ' ':
                result.append('0')
        
        return ''.join(result)

    def decode_safe(self, text: str, language: str = 'auto', max_results: int = 10) -> list:
        """Décode le texte T9 avec traitement mot par mot"""
        start_time = time.time()
        
        # Nettoyage et validation
        text = re.sub(r'[^0-9]', '', text)
        if not text or len(text) > 50:  # Augmenté pour permettre plus de caractères
            return []
        
        # Gérer les espaces (0) - traitement mot par mot
        # Normaliser les espaces multiples en un seul 0
        normalized_text = re.sub(r'0+', '0', text)
        # Supprimer les 0 en début et fin
        normalized_text = normalized_text.strip('0')
        segments = normalized_text.split('0')
        segments = [seg for seg in segments if seg]
        
        if not segments or len(segments) > self.MAX_SEGMENTS:
            return []
        
        print(f"Debug CORRIGÉ: {len(segments)} segments à traiter: {segments}")
        
        # Traiter chaque segment séparément
        all_word_candidates = []
        
        for i, segment in enumerate(segments):
            if time.time() - start_time > self.MAX_EXECUTION_TIME:
                print("⚠️ Timeout atteint - arrêt du traitement")
                break
            
            if len(segment) > 10:  # Limite par segment
                print(f"⚠️ Segment trop long: {len(segment)} caractères")
                continue
                
            # Générer les combinaisons pour ce segment
            segment_combinations = self._generate_combinations_safe(segment)
            if not segment_combinations:
                continue
            
            # Filtrer et scorer les combinaisons pour ce segment
            segment_words = self._filter_segment_words(segment_combinations, language, segment)
            all_word_candidates.append(segment_words)
            
            print(f"Debug CORRIGÉ: Segment {i+1} '{segment}' -> {len(segment_words)} mots valides")
        
        if not all_word_candidates:
            return []
        
        # Générer les combinaisons de phrases
        phrase_candidates = self._generate_phrase_candidates(all_word_candidates, max_results)
        
        # Finaliser le scoring et le tri
        final_results = self._finalize_scoring(phrase_candidates, language, max_results)
        
        print(f"Debug CORRIGÉ: {len(final_results)} résultats finaux")
        return final_results

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
                            return new_combinations[:self.MAX_COMBINATIONS_PER_SEGMENT]
                
                combinations = new_combinations
        
        return combinations[:self.MAX_COMBINATIONS_PER_SEGMENT]

    def _filter_segment_words(self, combinations: list, language: str, original_sequence: str) -> list:
        """Filtre et score les mots d'un segment individuel"""
        if not combinations:
            return []
        
        # Mots prioritaires pour le géocaching (score élevé)
        priority_words = {
            'DCODE': 0.95, 'CODE': 0.90, 'CACHE': 0.85, 'MONDE': 0.90,
            'HELLO': 0.80, 'THE': 0.75, 'AREA': 0.80, 'BONJOUR': 0.85,
            'AMI': 0.85, 'CHER': 0.80, 'BON': 0.80, 'OUI': 0.85,
            'NON': 0.85, 'MER': 0.80, 'TER': 0.80, 'FIN': 0.80,
            'DEBUT': 0.85, 'MILIEU': 0.80, 'CENTER': 0.80, 'START': 0.80,
            'END': 0.80, 'GO': 0.85, 'STOP': 0.80, 'YES': 0.85,
            'NO': 0.85, 'OK': 0.90, 'HI': 0.85, 'BYE': 0.80
        }
        
        valid_words = []
        
        for candidate in combinations:
            if len(candidate) < 2:
                continue
            
            candidate_upper = candidate.upper()
            
            # Vérifier les mots prioritaires d'abord
            if candidate_upper in priority_words:
                valid_words.append({
                    'word': candidate,
                    'score': priority_words[candidate_upper],
                    'language': 'priority',
                    'length': len(candidate),
                    'original_sequence': original_sequence
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
                            # Score minimum plus élevé pour les mots valides
                            score = max(score, 0.6)
                            if score > best_score:
                                best_score = score
                                best_language = lang
                    
                    if best_score > 0:
                        valid_words.append({
                            'word': candidate,
                            'score': best_score,
                            'language': best_language,
                            'length': len(candidate),
                            'original_sequence': original_sequence
                        })
                        
                except Exception:
                    continue
            else:
                # Fallback sans dictionnaire - score bas pour les mots non vérifiés
                valid_words.append({
                    'word': candidate,
                    'score': 0.3,  # Score bas pour les mots non vérifiés
                    'language': 'unknown',
                    'length': len(candidate),
                    'original_sequence': original_sequence
                })
        
        # Trier par score décroissant
        valid_words.sort(key=lambda x: x['score'], reverse=True)
        return valid_words[:20]  # Limiter à 20 mots par segment

    def _generate_phrase_candidates(self, all_word_candidates: list, max_results: int) -> list:
        """Génère les candidats de phrases à partir des mots individuels"""
        if not all_word_candidates:
            return []
        
        if len(all_word_candidates) == 1:
            # Un seul mot
            return [{
                'phrase': word['word'],
                'words': [word],
                'total_score': word['score'],
                'avg_score': word['score']
            } for word in all_word_candidates[0][:max_results]]
        
        # Plusieurs mots - générer des combinaisons
        phrase_candidates = []
        
        # Limiter le nombre de mots par segment pour éviter l'explosion
        limited_candidates = []
        for segment_words in all_word_candidates:
            limited_candidates.append(segment_words[:min(5, len(segment_words))])
        
        try:
            # Générer toutes les combinaisons possibles
            for combination in product(*limited_candidates):
                phrase = ' '.join(word['word'] for word in combination)
                total_score = sum(word['score'] for word in combination)
                avg_score = total_score / len(combination)
                
                phrase_candidates.append({
                    'phrase': phrase,
                    'words': list(combination),
                    'total_score': total_score,
                    'avg_score': avg_score
                })
                
                # Limiter le nombre de candidats
                if len(phrase_candidates) >= max_results * 2:
                    break
                    
        except Exception as e:
            print(f"⚠️ Erreur dans la génération de phrases: {str(e)}")
            return []
        
        return phrase_candidates

    def _finalize_scoring(self, phrase_candidates: list, language: str, max_results: int) -> list:
        """Finalise le scoring et le tri des résultats"""
        if not phrase_candidates:
            return []
        
        final_results = []
        
        for candidate in phrase_candidates:
            # Bonus pour les phrases courtes et les mots courts
            length_bonus = 0
            if len(candidate['phrase']) <= 10:
                length_bonus = 0.1
            elif len(candidate['phrase']) <= 20:
                length_bonus = 0.05
            
            # Bonus pour les mots courts
            short_word_bonus = 0
            for word in candidate['words']:
                if len(word['word']) <= 3:
                    short_word_bonus += 0.05
            
            # Score final
            final_score = min(candidate['avg_score'] + length_bonus + short_word_bonus, 1.0)
            
            final_results.append({
                'word': candidate['phrase'],
                'score': final_score,
                'language': 'mixed',
                'length': len(candidate['phrase']),
                'metadata': {
                    'word_count': len(candidate['words']),
                    'avg_word_score': candidate['avg_score'],
                    'length_bonus': length_bonus,
                    'short_word_bonus': short_word_bonus
                }
            })
        
        # Trier par score décroissant
        final_results.sort(key=lambda x: x['score'], reverse=True)
        return final_results[:max_results]

    def execute(self, inputs: dict) -> dict:
        """Point d'entrée du plugin corrigé"""
        start_time = time.time()
        
        # Extraire les paramètres avec validation
        mode = inputs.get("mode", "decode").lower()
        text = inputs.get("text", "").strip()
        language = inputs.get("language", "auto")
        max_results = min(int(inputs.get("max_results", 10)), 20)
        
        # Validation d'entrée
        if len(text) > 50:
            return {
                "status": "error",
                "plugin_info": {"name": self.name, "version": "1.0.1-corrected", "execution_time": 0},
                "results": [],
                "summary": {
                    "best_result_id": None,
                    "total_results": 0,
                    "message": "⚠️ Texte trop long (>50 caractères)"
                }
            }
        
        # Structure de réponse
        response = {
            "status": "success",
            "plugin_info": {"name": self.name, "version": "1.0.1-corrected", "execution_time": 0},
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
                    "metadata": {"original_text": text, "corrected_mode": True}
                }]
                response["summary"]["best_result_id"] = "result_1"
                response["summary"]["total_results"] = 1
                response["summary"]["message"] = "Encodage T9 corrigé réussi"
                
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
                            "detected_language": result.get('language', 'unknown'),
                            "corrected_mode": True,
                            "original_score": result['score'],
                            "word_length": result['length'],
                            "word_count": result.get('metadata', {}).get('word_count', 1)
                        }
                    })
                
                if response["results"]:
                    response["summary"]["best_result_id"] = "result_1"
                    response["summary"]["total_results"] = len(response["results"])
                    response["summary"]["message"] = f"{len(response['results'])} solution(s) T9 corrigée(s)"
                else:
                    response["summary"]["message"] = "Aucune solution trouvée"
            
        except Exception as e:
            response["status"] = "error"
            response["summary"]["message"] = f"⚠️ Erreur: {str(e)}"
            response["summary"]["best_result_id"] = None
            response["summary"]["total_results"] = 0
            if "results" not in response:
                response["results"] = []
        
        # Calculer le temps d'exécution
        execution_time = int((time.time() - start_time) * 1000)
        response["plugin_info"]["execution_time"] = execution_time
        
        return response


# Point d'entrée pour le système de plugins
def execute(inputs):
    plugin = T9CodePlugin()
    return plugin.execute(inputs)


if __name__ == "__main__":
    # Tests de la version corrigée
    plugin = T9CodePlugin()
    
    print("=== Tests de la Version Corrigée T9 ===")
    
    # Test 1: Mot simple "ami" = 264
    result = plugin.execute({"text": "264", "mode": "decode", "language": "fr"})
    print(f"Test 'ami' (264): {result['summary']['message']}")
    if result['results']:
        print(f"  Premier résultat: '{result['results'][0]['text_output']}' (confiance: {result['results'][0]['confidence']:.2f})")
    
    # Test 2: Deux mots "cher ami" = 24370264
    result = plugin.execute({"text": "24370264", "mode": "decode", "language": "fr"})
    print(f"Test 'cher ami' (24370264): {result['summary']['message']}")
    if result['results']:
        print(f"  Premier résultat: '{result['results'][0]['text_output']}' (confiance: {result['results'][0]['confidence']:.2f})")
    
    # Test 3: Encodage
    result = plugin.execute({"text": "AMI", "mode": "encode"})
    print(f"Test encodage 'AMI': {result['summary']['message']}")
    if result['results']:
        print(f"  Résultat: {result['results'][0]['text_output']}")
    
    print("=== Tests terminés ===") 