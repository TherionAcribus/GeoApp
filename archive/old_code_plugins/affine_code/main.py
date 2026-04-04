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

class AffineCodePlugin:
    """
    Plugin pour encoder/décoder du texte avec le chiffre affine.
    Modes : 
      - encode
      - decode
      - bruteforce
    """

    def __init__(self):
        self.name = "affine_code"
        self.description = "Plugin de chiffrement/déchiffrement utilisant le chiffre affine"
        self.alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
        self.alphabet_len = 26
        # Valeurs de 'a' possibles (premiers avec 26)
        self.possible_a = [1, 3, 5, 7, 9, 11, 15, 17, 19, 21, 23, 25]
        
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

    def _char_to_num(self, char: str) -> int:
        return self.alphabet.index(char.upper())
    
    def _num_to_char(self, num: int) -> str:
        return self.alphabet[num % self.alphabet_len]

    def _mod_inverse(self, a: int, m: int = 26) -> int:
        """
        Calcule l'inverse modulaire de a modulo m (si gcd(a, m) = 1).
        Trouve a_inv tel que (a * a_inv) mod m = 1.
        """
        # Méthode simple (brute force) : on teste toutes les valeurs
        # de 1 à m-1 pour voir celle qui vérifie la condition.
        a = a % m
        for x in range(1, m):
            if (a * x) % m == 1:
                return x
        raise ValueError(f"Aucun inverse modulaire n'existe pour a={a} mod m={m}")

    def encode(self, text: str, a: int, b: int) -> str:
        """
        Chiffrement affine : E(x) = (a*x + b) mod 26
        """
        result = []
        for char in text.upper():
            if char in self.alphabet:
                x = self._char_to_num(char)
                # Application de l'expression (a*x + b) mod 26
                encoded_num = (a * x + b) % self.alphabet_len
                result.append(self._num_to_char(encoded_num))
            else:
                # On conserve tel quel les caractères hors alphabet
                result.append(char)
        return ''.join(result)

    def decode(self, text: str, a: int, b: int) -> str:
        """
        Déchiffrement affine : D(y) = a^-1 * (y - b) mod 26
        """
        result = []
        # Calcul de l'inverse modulaire de a
        a_inv = self._mod_inverse(a, self.alphabet_len)

        for char in text.upper():
            if char in self.alphabet:
                y = self._char_to_num(char)
                decoded_num = (a_inv * (y - b)) % self.alphabet_len
                result.append(self._num_to_char(decoded_num))
            else:
                result.append(char)
        return ''.join(result)

    def bruteforce(self, text: str):
        """
        Tente toutes les clés (a, b) possibles, 
        où a est premier avec 26 et b dans [0..25].
        Retourne une liste de dicts :
          { "a": int, "b": int, "decoded_text": str }
        """
        solutions = []
        for a_candidate in self.possible_a:
            for b_candidate in range(self.alphabet_len):
                try:
                    decoded_text = self.decode(text, a_candidate, b_candidate)
                    solutions.append({
                        "a": a_candidate,
                        "b": b_candidate,
                        "decoded_text": decoded_text
                    })
                except ValueError:
                    # Ignorer les clés invalides (quand a n'a pas d'inverse modulo 26)
                    continue
        return solutions
    
    def _calculate_confidence(self, a, b, text):
        """
        Calcule un indice de confiance pour un résultat de bruteforce.
        Les valeurs communes (a=1) ont une confiance plus élevée.
        """
        # Les paramètres les plus courants
        if a == 1:
            # César est un cas particulier du chiffre affine avec a=1
            if b in [1, 3, 13]:
                return 0.9
            else:
                return 0.8
        # Autres valeurs communes
        if a == 3 and b == 1:
            return 0.7
        if a == 5 and b == 2:
            return 0.65
        
        # Pour les autres combinaisons, calculer une valeur de base
        base_confidence = 0.6
        
        # Réduire légèrement la confiance pour les valeurs de a et b plus élevées
        confidence_modifier = -0.01 * (a + b)
        
        return max(0.3, base_confidence + confidence_modifier)
    
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

    def execute(self, inputs):
        """
        Méthode principale appelée par le PluginManager.
        Les champs d'entrée (inputs) devraient contenir :
          - "text" (str)
          - "a" (int) -> facultatif si on est en bruteforce
          - "b" (int) -> facultatif si on est en bruteforce
          - "mode" ("encode", "decode", "bruteforce")
          - "enable_scoring" (bool) -> activation du scoring automatique

        Les retours sont sous forme de dict JSON au format standardisé.
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
        
        text = inputs.get('text', '')
        mode = inputs.get('mode', 'encode')
        
        # Vérifier si le scoring automatique est activé
        enable_scoring = inputs.get('enable_scoring', True)
        print(f"État du scoring: param={enable_scoring}, type={type(enable_scoring)}")
        
        # Extraire le contexte pour le scoring (si présent)
        context = inputs.get('context', {})
        
        # Vérifier si le texte est vide
        if not text:
            standardized_response["status"] = "error"
            standardized_response["summary"]["message"] = "Aucun texte fourni à traiter."
            return standardized_response
        
        # Vérifier si le mode bruteforce est activé (avec les deux styles de paramètre possibles)
        bruteforce_param1 = inputs.get('bruteforce', False)
        bruteforce_param2 = inputs.get('brute_force', False)
        do_bruteforce = bruteforce_param1 or bruteforce_param2 or mode == 'bruteforce'
        
        try:
            # Paramètres a et b (typiquement 1, 0 par défaut)
            a = int(inputs.get('a', 1))
            b = int(inputs.get('b', 0))
            
            # Mode bruteforce
            if do_bruteforce:
                solutions = self.bruteforce(text)
                
                # Ajouter chaque solution comme un résultat distinct
                for idx, solution in enumerate(solutions, 1):
                    a_value = solution["a"]
                    b_value = solution["b"]
                    decoded_text = solution["decoded_text"]
                    
                    # Utiliser le scoring pour évaluer la qualité du résultat si activé
                    if enable_scoring:
                        scoring_result = self._get_text_score(decoded_text, context)
                        if scoring_result and 'score' in scoring_result:
                            confidence = scoring_result['score']
                            print(f"Score pour a={a_value}, b={b_value}: {confidence}")
                        else:
                            # Fallback sur le calcul de confiance legacy
                            confidence = self._calculate_confidence(a_value, b_value, decoded_text)
                            print(f"Échec du scoring, utilisation du score legacy: {confidence}")
                            scoring_result = None
                    else:
                        # Utiliser le calcul de confiance legacy
                        confidence = self._calculate_confidence(a_value, b_value, decoded_text)
                        scoring_result = None
                    
                    # Créer l'entrée de résultat
                    result_entry = {
                        "id": f"result_{idx}",
                        "text_output": decoded_text,
                        "confidence": confidence,
                        "parameters": {
                            "mode": "decode",
                            "a": a_value,
                            "b": b_value
                        },
                        "metadata": {
                            "bruteforce_position": idx,
                            "processed_chars": sum(1 for c in text.upper() if c in self.alphabet)
                        }
                    }
                    
                    # Ajouter les résultats du scoring s'ils sont disponibles
                    if scoring_result:
                        result_entry["scoring"] = scoring_result
                    
                    standardized_response["results"].append(result_entry)
                
                # Trier les résultats par confiance décroissante
                standardized_response["results"].sort(key=lambda x: x["confidence"], reverse=True)
                
                # Mettre à jour le résumé
                if standardized_response["results"]:
                    standardized_response["summary"]["best_result_id"] = standardized_response["results"][0]["id"]
                    standardized_response["summary"]["total_results"] = len(standardized_response["results"])
                    standardized_response["summary"]["message"] = f"Bruteforce Affine: {len(standardized_response['results'])} combinaisons testées"
                else:
                    standardized_response["status"] = "error"
                    standardized_response["summary"]["message"] = "Aucune solution de bruteforce trouvée"
            
            # Mode encode
            elif mode == 'encode':
                result = self.encode(text, a, b)
                
                standardized_response["results"].append({
                    "id": "result_1",
                    "text_output": result,
                    "confidence": 1.0,
                    "parameters": {
                        "mode": "encode",
                        "a": a,
                        "b": b
                    },
                    "metadata": {
                        "processed_chars": sum(1 for c in text.upper() if c in self.alphabet)
                    }
                })
                
                standardized_response["summary"]["best_result_id"] = "result_1"
                standardized_response["summary"]["total_results"] = 1
                standardized_response["summary"]["message"] = f"Encodage Affine avec a={a}, b={b} réussi"
            
            # Mode decode
            elif mode == 'decode':
                try:
                    result = self.decode(text, a, b)
                    
                    # Utiliser le scoring pour évaluer la qualité du résultat si activé
                    if enable_scoring:
                        scoring_result = self._get_text_score(result, context)
                        if scoring_result and 'score' in scoring_result:
                            confidence = scoring_result['score']
                            print(f"Score utilisé: {confidence}")
                        else:
                            # Fallback sur le score de détection si le scoring échoue
                            confidence = 0.9  # Confiance par défaut
                            print(f"Échec du scoring, utilisation du score par défaut: {confidence}")
                            scoring_result = None
                    else:
                        confidence = 0.9  # Confiance par défaut
                        scoring_result = None
                    
                    # Créer l'entrée de résultat
                    result_entry = {
                        "id": "result_1",
                        "text_output": result,
                        "confidence": confidence,
                        "parameters": {
                            "mode": "decode",
                            "a": a,
                            "b": b
                        },
                        "metadata": {
                            "processed_chars": sum(1 for c in text.upper() if c in self.alphabet)
                        }
                    }
                    
                    # Ajouter les résultats du scoring s'ils sont disponibles
                    if scoring_result:
                        result_entry["scoring"] = scoring_result
                    
                    standardized_response["results"].append(result_entry)
                    
                    standardized_response["summary"]["best_result_id"] = "result_1"
                    standardized_response["summary"]["total_results"] = 1
                    standardized_response["summary"]["message"] = f"Décodage Affine avec a={a}, b={b} réussi"
                except ValueError as e:
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
    return AffineCodePlugin()
