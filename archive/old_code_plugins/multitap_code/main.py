import time
import re
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

class MultitapCodePlugin:
    """
    Plugin pour encoder/décoder du texte avec le code Multitap (ABC) des anciens téléphones mobiles.
    
    Modes : 
      - encode
      - decode
      - bruteforce (teste différents séparateurs)
    """

    def __init__(self):
        self.name = "multitap_code"
        self.description = "Plugin de chiffrement/déchiffrement utilisant le code Multitap (ABC) des téléphones mobiles"
        
        # Table de correspondance Multitap
        # Clé 2: ABC, Clé 3: DEF, etc.
        self.multitap_encode = {
            'A': '2', 'B': '22', 'C': '222',
            'D': '3', 'E': '33', 'F': '333',
            'G': '4', 'H': '44', 'I': '444',
            'J': '5', 'K': '55', 'L': '555',
            'M': '6', 'N': '66', 'O': '666',
            'P': '7', 'Q': '77', 'R': '777', 'S': '7777',
            'T': '8', 'U': '88', 'V': '888',
            'W': '9', 'X': '99', 'Y': '999', 'Z': '9999',
            ' ': '0'  # Espace représenté par 0
        }
        
        # Table de correspondance inverse pour le décodage
        self.multitap_decode = {v: k for k, v in self.multitap_encode.items()}
        
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
        self.scoring_service_available = scoring_service_available
        if scoring_service_available:
            try:
                self.scoring_service = ScoringService()
                print("Service de scoring initialisé avec succès")
            except Exception as e:
                print(f"Erreur lors de l'initialisation du service de scoring: {str(e)}")
                self.scoring_service_available = False
        
        # Initialiser le service de dictionnaire centralisé
        try:
            from app.services.dictionary_service import get_dictionary_service
            self.dict_service = get_dictionary_service()
            self.dict_service_available = True
            print("DictionaryService disponible")
        except ImportError:
            self.dict_service_available = False
            print("DictionaryService non disponible, utilisation des méthodes legacy")
        
        self.scoring_api_url = "http://localhost:5000/api/plugins/score"

    def encode(self, text: str, separator: str = 'space') -> str:
        """
        Encode le texte en utilisant le code Multitap.
        
        Args:
            text: Texte à encoder
            separator: Type de séparateur ('space', 'dash', 'none')
            
        Returns:
            Texte encodé en Multitap
        """
        result = []
        text = text.upper()
        
        for char in text:
            if char in self.multitap_encode:
                result.append(self.multitap_encode[char])
            else:
                # Ignorer les caractères non supportés
                continue
        
        # Appliquer le séparateur choisi
        if separator == 'space':
            return ' '.join(result)
        elif separator == 'dash':
            return '-'.join(result)
        else:  # none
            return ''.join(result)

    def decode(self, text: str, separator: str = 'auto') -> str:
        """
        Décode le texte Multitap.
        
        Args:
            text: Texte codé en Multitap
            separator: Type de séparateur ('auto', 'space', 'dash', 'none')
            
        Returns:
            Texte décodé
        """
        # Détecter automatiquement le séparateur si nécessaire
        if separator == 'auto':
            separator = self._detect_separator(text)
        
        # Séparer le texte selon le séparateur détecté
        if separator == 'space':
            codes = text.split(' ')
        elif separator == 'dash':
            codes = text.split('-')
        else:  # none
            codes = self._split_no_separator(text)
        
        # Décoder chaque groupe
        result = []
        for code in codes:
            if code.strip() in self.multitap_decode:
                result.append(self.multitap_decode[code.strip()])
            elif code.strip() == '':
                continue  # Ignorer les groupes vides
            else:
                result.append('?')  # Caractère inconnu
        
        return ''.join(result)

    def _detect_separator(self, text: str) -> str:
        """
        Détecte automatiquement le type de séparateur utilisé.
        
        Args:
            text: Texte à analyser
            
        Returns:
            Type de séparateur détecté ('space', 'dash', 'none')
        """
        if ' ' in text and len(text.split(' ')) > 1:
            return 'space'
        elif '-' in text and len(text.split('-')) > 1:
            return 'dash'
        else:
            return 'none'

    def _split_no_separator(self, text: str) -> list:
        """
        Divise un texte sans séparateur en groupes de codes Multitap valides.
        Retourne la meilleure segmentation selon le dictionnaire.
        
        Args:
            text: Texte à diviser
            
        Returns:
            Liste des codes trouvés (meilleure segmentation)
        """
        text = text.strip()
        if not text:
            return []
        
        # Générer toutes les segmentations possibles
        all_segmentations = self._generate_all_segmentations(text)
        
        if not all_segmentations:
            return []
        
        # Si une seule segmentation, la retourner
        if len(all_segmentations) == 1:
            return all_segmentations[0]
        
        # Évaluer chaque segmentation avec le dictionnaire
        best_segmentation = self._find_best_segmentation_with_dictionary(all_segmentations)
        
        return best_segmentation
    
    def _generate_all_segmentations(self, text: str, max_results: int = 50) -> list:
        """
        Génère toutes les segmentations possibles du texte en testant tous les codes Multitap valides.
        Privilégie maintenant les segmentations qui forment des mots reconnaissables.
        
        Args:
            text: Texte à segmenter
            max_results: Limite du nombre de segmentations à générer
            
        Returns:
            Liste de toutes les segmentations possibles triées par qualité
        """
        def backtrack(pos: int, current_segmentation: list) -> None:
            if len(results) >= max_results:
                return
                
            if pos == len(text):
                results.append(current_segmentation[:])
                return
            
            # Essayer toutes les longueurs possibles de codes Multitap (4 à 1 caractères)
            # Privilégier les codes plus longs pour avoir des mots plus cohérents
            for length in range(min(4, len(text) - pos), 0, -1):
                candidate = text[pos:pos+length]
                if candidate in self.multitap_decode:
                    current_segmentation.append(candidate)
                    backtrack(pos + length, current_segmentation)
                    current_segmentation.pop()
        
        results = []
        backtrack(0, [])
        
        # Nouveau système de tri : privilégier les segmentations qui produisent des mots valides
        def segmentation_quality_score(segmentation):
            # Décoder la segmentation
            decoded_text = ''.join([self.multitap_decode[code] for code in segmentation])
            
            # Score basé sur plusieurs critères
            score = 0.0
            
            # 1. Privilégier les mots reconnus dans le dictionnaire
            if self.dict_service_available:
                try:
                    if self.dict_service.is_valid_word(decoded_text, language='fr'):
                        score += 10.0  # Bonus très important pour un mot valide
                except Exception:
                    pass
            
            # 2. Vérifier avec le fallback des termes géocaching
            if self._looks_like_french_text(decoded_text):
                score += 5.0
            
            # 3. Privilégier les segmentations avec moins d'éléments (codes plus longs)
            score += (20 - len(segmentation)) * 0.1
            
            # 4. Pénaliser les répétitions excessives de la même lettre
            char_counts = {}
            for char in decoded_text:
                char_counts[char] = char_counts.get(char, 0) + 1
            
            # Pénaliser si plus de 2 répétitions consécutives de la même lettre
            repetition_penalty = 0
            for i in range(len(decoded_text) - 2):
                if decoded_text[i] == decoded_text[i+1] == decoded_text[i+2]:
                    repetition_penalty += 1
            score -= repetition_penalty * 2.0
            
            # 5. Privilégier les mots de longueur raisonnable
            if 3 <= len(decoded_text) <= 15:
                score += 1.0
            elif len(decoded_text) > 20:
                score -= 1.0
            
            return score
        
        # Trier par score de qualité décroissant
        results.sort(key=segmentation_quality_score, reverse=True)
        
        return results[:max_results]
    
    def _find_best_segmentation_with_dictionary(self, segmentations: list) -> list:
        """
        Trouve la meilleure segmentation en utilisant le service de dictionnaire centralisé
        ou un fallback vers le scoring service.
        
        Args:
            segmentations: Liste des segmentations possibles
            
        Returns:
            Meilleure segmentation selon le dictionnaire
        """
        if not segmentations:
            return []
        
        # Utiliser le service de dictionnaire centralisé si disponible
        if self.dict_service_available:
            try:
                # Évaluer chaque segmentation
                best_segmentation = segmentations[0]
                best_score = -1
                
                for segmentation in segmentations:
                    decoded_text = ''.join([self.multitap_decode[code] for code in segmentation])
                    
                    # Calculer un score composite
                    score = 0.0
                    
                    # 1. Score principal : mot valide dans le dictionnaire
                    if self.dict_service.is_valid_word(decoded_text, language='fr'):
                        score += 100.0  # Bonus très élevé pour un mot valide
                        
                        # Bonus supplémentaire selon la longueur et la qualité du mot
                        word_score = self.dict_service.get_word_score(decoded_text, language='fr')
                        score += word_score * 20.0
                    
                    # 2. Score fallback : vérification heuristique
                    elif self._looks_like_french_text(decoded_text):
                        score += 50.0
                    
                    # 3. Privilégier les segmentations avec moins d'éléments (codes plus longs)
                    score += (30 - len(segmentation)) * 2.0
                    
                    # 4. Pénaliser les répétitions excessives de lettres
                    repetition_penalty = 0
                    for i in range(len(decoded_text) - 2):
                        if decoded_text[i] == decoded_text[i+1] == decoded_text[i+2]:
                            repetition_penalty += 10.0
                    score -= repetition_penalty
                    
                    # 5. Bonus pour les longueurs de mots raisonnables
                    if 4 <= len(decoded_text) <= 12:
                        score += 10.0
                    elif len(decoded_text) <= 3:
                        score -= 5.0
                    elif len(decoded_text) > 15:
                        score -= 10.0
                    
                    # 6. Vérifier la distribution des lettres (éviter trop de répétitions)
                    char_counts = {}
                    for char in decoded_text:
                        char_counts[char] = char_counts.get(char, 0) + 1
                    
                    # Pénaliser si plus de 40% de lettres identiques
                    for char, count in char_counts.items():
                        if count / len(decoded_text) > 0.4:
                            score -= 15.0
                    
                    print(f"Segmentation {segmentation} -> '{decoded_text}' : score = {score}")
                    
                    if score > best_score:
                        best_score = score
                        best_segmentation = segmentation
                
                print(f"Meilleure segmentation choisie: {best_segmentation} -> '{' '.join([self.multitap_decode[code] for code in best_segmentation])}'")
                return best_segmentation
                
            except Exception as e:
                print(f"Erreur lors de l'utilisation du DictionaryService: {str(e)}")
                # Continuer avec le fallback
        
        # Fallback : utiliser l'ancienne méthode avec scoring service
        best_segmentation = segmentations[0]
        best_score = -1
        scoring_available = False
        
        for segmentation in segmentations:
            # Décoder cette segmentation
            decoded_text = ''.join([self.multitap_decode[code] for code in segmentation])
            
            # Évaluer avec le service de scoring si disponible
            if self.scoring_service_available and self.scoring_service:
                try:
                    # Utiliser le service de scoring pour évaluer cette segmentation
                    scoring_result = self.scoring_service.score_text(decoded_text.lower())
                    if scoring_result and 'score' in scoring_result:
                        score = scoring_result['score']
                        scoring_available = True
                        
                        # Ajouter des bonus pour privilégier les bonnes segmentations
                        if self._looks_like_french_text(decoded_text):
                            score += 0.3
                        
                        # Bonus pour moins d'éléments (codes plus longs)
                        score += (20 - len(segmentation)) * 0.02
                        
                        # Mettre à jour la meilleure segmentation si le score est meilleur
                        if score > best_score:
                            best_score = score
                            best_segmentation = segmentation
                            
                except Exception as e:
                    # En cas d'erreur, continuer sans le scoring
                    print(f"Erreur lors de l'évaluation de '{decoded_text}': {str(e)}")
                    continue
        
        # Si le scoring n'est pas disponible ou échoue, utiliser des heuristiques améliorées
        if not scoring_available:
            best_score = -1
            for segmentation in segmentations:
                decoded_text = ''.join([self.multitap_decode[code] for code in segmentation])
                
                # Heuristiques améliorées pour identifier de bons mots
                score = 0
                
                # Privilégier les mots reconnaissables
                if self._looks_like_french_text(decoded_text):
                    score += 50
                
                # Privilégier les segmentations avec moins de répétitions de lettres
                unique_chars = len(set(decoded_text))
                if unique_chars > len(decoded_text) * 0.5:
                    score += 20
                
                # Privilégier les segmentations avec moins d'éléments (codes plus longs)
                score += (20 - len(segmentation)) * 2
                
                # Pénaliser les mots trop courts ou trop longs
                if 4 <= len(decoded_text) <= 12:
                    score += 10
                elif len(decoded_text) <= 2:
                    score -= 20
                
                if score > best_score:
                    best_score = score
                    best_segmentation = segmentation
        
        return best_segmentation
    
    def _split_greedy_fallback(self, text: str) -> list:
        """
        Méthode de fallback en cas d'échec de la programmation dynamique.
        """
        codes = []
        i = 0
        
        while i < len(text):
            found = False
            current_char = text[i]
            
            # Compter combien de fois le caractère se répète
            repeat_count = 1
            while i + repeat_count < len(text) and text[i + repeat_count] == current_char:
                repeat_count += 1
            
            # Essayer de former un code valide avec cette répétition (en commençant par les plus courts)
            for length in range(1, min(repeat_count + 1, 5)):
                candidate = current_char * length
                if candidate in self.multitap_decode:
                    codes.append(candidate)
                    i += length
                    found = True
                    break
            
            if not found:
                # Aucun code valide trouvé, passer au caractère suivant
                i += 1
        
        return codes

    def bruteforce(self, text: str) -> list:
        """
        Teste toutes les variantes de séparateurs possibles et, pour le mode sans séparateur,
        teste également différentes segmentations avec évaluation par dictionnaire.
        
        Args:
            text: Texte à décoder
            
        Returns:
            Liste des solutions trouvées
        """
        solutions = []
        separators = ['space', 'dash', 'none']
        
        for sep in separators:
            try:
                if sep == 'none':
                    # Pour le mode sans séparateur, générer plusieurs segmentations
                    all_segmentations = self._generate_all_segmentations(text, max_results=10)
                    
                    for i, segmentation in enumerate(all_segmentations):
                        decoded = ''.join([self.multitap_decode[code] for code in segmentation])
                        unknown_count = decoded.count('?')
                        
                        if unknown_count / len(decoded) < 0.3:  # Moins de 30% de caractères inconnus
                            solutions.append({
                                'separator': f'none_variant_{i+1}',
                                'decoded_text': decoded,
                                'unknown_chars': unknown_count,
                                'segmentation': segmentation
                            })
                else:
                    # Pour les séparateurs classiques
                    decoded = self.decode(text, sep)
                    unknown_count = decoded.count('?')
                    
                    if unknown_count / len(decoded) < 0.3:  # Moins de 30% de caractères inconnus
                        solutions.append({
                            'separator': sep,
                            'decoded_text': decoded,
                            'unknown_chars': unknown_count
                        })
                        
            except Exception as e:
                print(f"Erreur lors du décodage avec séparateur {sep}: {str(e)}")
                continue
        
        return solutions

    def _calculate_confidence(self, solution: dict, enable_scoring: bool = False, context: dict = None) -> float:
        """
        Calcule la confiance d'une solution basée sur plusieurs critères.
        Utilise le service de scoring si disponible et activé.
        
        Args:
            solution: Dictionnaire contenant les détails de la solution
            enable_scoring: Si True, utilise le service de scoring
            context: Contexte optionnel pour le scoring
            
        Returns:
            Score de confiance entre 0 et 1
        """
        decoded_text = solution['decoded_text']
        separator = solution['separator']
        unknown_chars = solution.get('unknown_chars', 0)
        
        # Si le scoring est activé et disponible, l'utiliser en priorité
        if enable_scoring and self.scoring_service_available and self.scoring_service:
            try:
                scoring_result = self.scoring_service.score_text(decoded_text.lower(), context)
                if scoring_result and 'score' in scoring_result:
                    # Utiliser le score du service de scoring comme base
                    base_confidence = scoring_result['score']
                    
                    # Appliquer des ajustements légers selon le type de séparateur
                    if 'none_variant' in separator:
                        # Légère pénalité pour les variantes sans séparateur (plus ambiguës)
                        base_confidence *= 0.95
                    elif separator == 'space':
                        # Léger bonus pour les espaces (format le plus clair)
                        base_confidence *= 1.02
                    
                    return max(0.1, min(1.0, base_confidence))
            except Exception as e:
                print(f"Erreur lors du scoring pour '{decoded_text}': {str(e)}")
                # Continuer avec le calcul legacy en cas d'erreur
        
        # Calcul legacy si le scoring n'est pas disponible
        base_confidence = {
            'space': 0.9,  # Plus courant et plus fiable
            'dash': 0.8,   # Moins courant mais fiable
            'none': 0.6    # Plus difficile à interpréter sans séparateur
        }.get(separator.split('_')[0], 0.5)  # Utiliser la partie avant '_' pour les variantes
        
        # Pénaliser les caractères inconnus
        if len(decoded_text) > 0:
            unknown_ratio = unknown_chars / len(decoded_text)
            confidence_penalty = unknown_ratio * 0.5
            base_confidence -= confidence_penalty
        
        # Bonus pour les textes qui ressemblent à des mots français
        if self._looks_like_french_text(decoded_text):
            base_confidence += 0.1
        
        return max(0.1, min(1.0, base_confidence))

    def _looks_like_french_text(self, text: str) -> bool:
        """
        Vérifie si le texte ressemble à du français en utilisant le service de dictionnaire centralisé.
        
        Args:
            text: Texte à analyser
            
        Returns:
            True si le texte ressemble à du français
        """
        if not text or len(text) < 2:
            return False
        
        # Utiliser le service de dictionnaire centralisé si disponible
        if self.dict_service_available:
            try:
                return self.dict_service.is_valid_word(text, language='fr')
            except Exception as e:
                print(f"Erreur lors de l'utilisation du DictionaryService: {str(e)}")
                # Continuer avec le fallback
                pass
        
        # Fallback : dictionnaire étendu avec plus de mots courants
        common_words = [
            # Mots géocaching
            'NORD', 'SUD', 'EST', 'OUEST', 'CACHE', 'TRESOR', 'COORDONNEES',
            'LATITUDE', 'LONGITUDE', 'DEGRES', 'MINUTES', 'SECONDES',
            'POINT', 'LIEU', 'ENDROIT', 'ICI', 'LA', 'CHERCHER', 'TROUVER',
            # Mots courants français
            'BONJOUR', 'SALUT', 'MERCI', 'BRAVO', 'FELICITATIONS', 'ENIGME',
            'MESSAGE', 'TEXTE', 'PHRASE', 'MOT', 'LETTRE', 'CODE', 'CHIFFRE',
            'TELEPHONE', 'MOBILE', 'APPEL', 'NUMERO', 'CLAVIER', 'TOUCHE',
            # Mots techniques
            'MULTITAP', 'DECODE', 'ENCODE', 'CHIFFREMENT', 'DECHIFFREMENT',
            # Mots courants anglais (souvent utilisés en géocaching)
            'HELLO', 'WORLD', 'MESSAGE', 'TEXT', 'WORD', 'LETTER', 'NUMBER',
            'PHONE', 'TELEPHONE', 'MOBILE', 'CALL', 'HELLO', 'GOODBYE',
            # Autres mots fréquents
            'MYSTERE', 'SECRET', 'SOLUTION', 'REPONSE', 'INDICE', 'PISTE',
            'FINAL', 'ETAPE', 'NEXT', 'SUIVANT', 'FIN', 'START', 'DEBUT',
            'DCODE', 'GCCODE', 'CACHE'
        ]
        
        text_upper = text.upper()
        
        # Vérifier si le texte contient un mot complet reconnu
        for word in common_words:
            if word == text_upper:  # Mot exact
                return True
            if word in text_upper and len(word) >= 4:  # Mot contenu et suffisamment long
                return True
        
        # Vérifications supplémentaires pour les patterns français
        # Vérifier les patterns de lettres courantes en français
        french_patterns = [
            'QU', 'CH', 'PH', 'TH', 'OU', 'ON', 'AN', 'EN', 'IN', 'UN',
            'ION', 'TION', 'MENT', 'IQUE', 'ABLE', 'IBLE'
        ]
        
        for pattern in french_patterns:
            if pattern in text_upper and len(text_upper) >= 4:
                return True
        
        # Vérifier la proportion de voyelles (français a environ 40% de voyelles)
        voyelles = 'AEIOUY'
        nb_voyelles = sum(1 for c in text_upper if c in voyelles)
        if len(text_upper) >= 4:
            ratio_voyelles = nb_voyelles / len(text_upper)
            if 0.25 <= ratio_voyelles <= 0.6:  # Ratio raisonnable pour le français
                return True
        
        return False

    def _clean_text_for_scoring(self, text: str) -> str:
        """
        Nettoie le texte décodé pour le scoring.
        """
        text = re.sub(r'[^\w\s]', '', text)
        text = re.sub(r'\s+', ' ', text).strip()
        print(f"Texte nettoyé pour scoring: {text}")
        return text
        
    def _get_text_score(self, text, context=None):
        """
        Obtient le score de confiance d'un texte en utilisant le service de scoring.
        """
        cleaned_text = self._clean_text_for_scoring(text)
        
        data = {
            "text": cleaned_text
        }
        
        if context:
            data["context"] = context
        
        print(f"Évaluation du texte: {cleaned_text[:30]}...")
        
        if self.scoring_service:
            try:
                print("Appel direct au service de scoring local")
                result = self.scoring_service.score_text(cleaned_text, context)
                print(f"Résultat du scoring local: {result}")
                return result
            except Exception as e:
                print(f"Erreur lors de l'évaluation locale: {str(e)}")
                return None
        else:
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

    def execute(self, inputs):
        """
        Méthode principale appelée par le PluginManager.
        """
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
        
        text = inputs.get('text', '')
        mode = inputs.get('mode', 'encode')
        separator = inputs.get('separator', 'auto')
        
        # Vérifier si le scoring automatique est activé
        enable_scoring = inputs.get('enable_scoring', True)
        print(f"État du scoring: param={enable_scoring}, type={type(enable_scoring)}")
        
        context = inputs.get('context', {})
        
        # Vérifier si le texte est vide
        if not text:
            standardized_response["status"] = "error"
            standardized_response["summary"]["message"] = "Aucun texte fourni à traiter."
            return standardized_response
        
        # Vérifier si le mode bruteforce est activé
        bruteforce_param1 = inputs.get('bruteforce', False)
        bruteforce_param2 = inputs.get('brute_force', False)
        do_bruteforce = bruteforce_param1 or bruteforce_param2 or mode == 'bruteforce'
        
        try:
            # Mode bruteforce
            if do_bruteforce:
                solutions = self.bruteforce(text)
                
                for idx, solution in enumerate(solutions, 1):
                    separator_type = solution["separator"]
                    decoded_text = solution["decoded_text"]
                    unknown_chars = solution.get("unknown_chars", 0)
                    
                    # Utiliser le scoring pour évaluer la qualité du résultat si activé
                    confidence = self._calculate_confidence(solution, enable_scoring, context)
                    
                    # Si le scoring est activé, essayer d'obtenir des détails supplémentaires
                    scoring_result = None
                    if enable_scoring:
                        scoring_result = self._get_text_score(decoded_text, context)
                        print(f"Score pour séparateur {separator_type}: {confidence}")
                    
                    result_entry = {
                        "id": f"result_{idx}",
                        "text_output": decoded_text,
                        "confidence": confidence,
                        "parameters": {
                            "mode": "decode",
                            "separator": separator_type
                        },
                        "metadata": {
                            "bruteforce_position": idx,
                            "unknown_chars": unknown_chars,
                            "total_chars": len(decoded_text)
                        }
                    }
                    
                    if scoring_result:
                        result_entry["scoring"] = scoring_result
                    
                    standardized_response["results"].append(result_entry)
                
                # Trier les résultats par confiance décroissante
                standardized_response["results"].sort(key=lambda x: x["confidence"], reverse=True)
                
                if standardized_response["results"]:
                    standardized_response["summary"]["best_result_id"] = standardized_response["results"][0]["id"]
                    standardized_response["summary"]["total_results"] = len(standardized_response["results"])
                    standardized_response["summary"]["message"] = f"Bruteforce Multitap: {len(standardized_response['results'])} variantes testées"
                else:
                    standardized_response["status"] = "error"
                    standardized_response["summary"]["message"] = "Aucune solution de bruteforce trouvée"
            
            # Mode encode
            elif mode == 'encode':
                result = self.encode(text, separator)
                
                standardized_response["results"].append({
                    "id": "result_1",
                    "text_output": result,
                    "confidence": 1.0,
                    "parameters": {
                        "mode": "encode",
                        "separator": separator
                    },
                    "metadata": {
                        "processed_chars": len([c for c in text.upper() if c in self.multitap_encode])
                    }
                })
                
                standardized_response["summary"]["best_result_id"] = "result_1"
                standardized_response["summary"]["total_results"] = 1
                standardized_response["summary"]["message"] = f"Encodage Multitap avec séparateur '{separator}' réussi"
            
            # Mode decode
            elif mode == 'decode':
                try:
                    result = self.decode(text, separator)
                    
                    # Utiliser le scoring pour évaluer la qualité du résultat si activé
                    if enable_scoring:
                        scoring_result = self._get_text_score(result, context)
                        if scoring_result and 'score' in scoring_result:
                            confidence = scoring_result['score']
                            print(f"Score utilisé: {confidence}")
                        else:
                            confidence = 0.9
                            print(f"Échec du scoring, utilisation du score par défaut: {confidence}")
                            scoring_result = None
                    else:
                        confidence = 0.9
                        scoring_result = None
                    
                    result_entry = {
                        "id": "result_1",
                        "text_output": result,
                        "confidence": confidence,
                        "parameters": {
                            "mode": "decode",
                            "separator": separator
                        },
                        "metadata": {
                            "processed_chars": len(text),
                            "unknown_chars": result.count('?')
                        }
                    }
                    
                    if scoring_result:
                        result_entry["scoring"] = scoring_result
                    
                    standardized_response["results"].append(result_entry)
                    
                    standardized_response["summary"]["best_result_id"] = "result_1"
                    standardized_response["summary"]["total_results"] = 1
                    standardized_response["summary"]["message"] = f"Décodage Multitap avec séparateur '{separator}' réussi"
                except Exception as e:
                    standardized_response["status"] = "error"
                    standardized_response["summary"]["message"] = f"Erreur de décodage: {str(e)}"
            
            else:
                standardized_response["status"] = "error"
                standardized_response["summary"]["message"] = f"Mode invalide: {mode}"
        
        except Exception as e:
            standardized_response["status"] = "error"
            standardized_response["summary"]["message"] = f"Erreur pendant le traitement: {str(e)}"
            import traceback
            print(traceback.format_exc())
        
        # Calculer le temps d'exécution
        standardized_response["plugin_info"]["execution_time"] = int((time.time() - start_time) * 1000)
        
        return standardized_response

# Point d'entrée pour le plugin
def init():
    return MultitapCodePlugin() 