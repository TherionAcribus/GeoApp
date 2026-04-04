import os
import sys

# Ajouter le dossier parent au path pour pouvoir importer la classe de base
current_dir = os.path.dirname(os.path.abspath(__file__))
parent_dir = os.path.dirname(current_dir)
if parent_dir not in sys.path:
    sys.path.insert(0, parent_dir)

from substitution_base import SubstitutionPluginBase

class AtbashPlugin(SubstitutionPluginBase):
    """
    Plugin pour encoder/décoder le chiffrement Atbash.
    
    L'Atbash est un chiffrement de substitution historique où chaque lettre
    est remplacée par sa correspondante "miroir" dans l'alphabet :
    A ↔ Z, B ↔ Y, C ↔ X, D ↔ W, E ↔ V, etc.
    
    Source: https://www.geeksforgeeks.org/implementing-atbash-cipher/
    
    Caractéristiques :
    - Symétrique : encoder = décoder
    - Très ancien (utilisé pour l'hébreu biblique)
    - Facile à mémoriser et appliquer
    - Peu sécurisé (facilement détectable)
    """

    def __init__(self):
        super().__init__("atbash")
        self.description = "Plugin pour encoder/décoder le chiffrement Atbash (A↔Z, B↔Y, etc.)"
        
        # Table Atbash : inversion complète de l'alphabet
        # A B C D E F G H I J K L M N O P Q R S T U V W X Y Z
        # Z Y X W V U T S R Q P O N M L K J I H G F E D C B A
        atbash_table = {
            'A': 'Z', 'B': 'Y', 'C': 'X', 'D': 'W', 'E': 'V',
            'F': 'U', 'G': 'T', 'H': 'S', 'I': 'R', 'J': 'Q',
            'K': 'P', 'L': 'O', 'M': 'N', 'N': 'M', 'O': 'L',
            'P': 'K', 'Q': 'J', 'R': 'I', 'S': 'H', 'T': 'G',
            'U': 'F', 'V': 'E', 'W': 'D', 'X': 'C', 'Y': 'B', 'Z': 'A'
        }
        
        # Pour l'Atbash symétrique : la table de décodage est identique à l'encodage
        # Créer la table inverse (identique pour Atbash car symétrique)
        decode_table = {v: k for k, v in atbash_table.items()}
        
        # Définir les tables de substitution - la classe de base fait le reste !
        self.set_substitution_tables(atbash_table, decode_table)
        
        # Configuration spécifique à l'Atbash
        self.default_separators = " \t\r\n.:;,_-'\"!?"
        self.case_sensitive = False
        
    def encode(self, text: str) -> str:
        """
        Encode le texte avec Atbash.
        Pour Atbash : A→Z, B→Y, C→X, etc.
        """
        if not text:
            return ""
            
        result = ""
        for char in text.upper():
            if char in self.encode_table:
                result += self.encode_table[char]
            else:
                result += char  # Garder les caractères non alphabétiques
        
        return result
    
    def decode(self, text: str) -> str:
        """
        Décode le texte Atbash.
        Pour Atbash symétrique : décoder = encoder !
        """
        # Pour l'Atbash, décoder est identique à encoder
        return self.encode(text)
    
    def check_code(self, text: str, strict: bool = False, allowed_chars: str = None, embedded: bool = False) -> dict:
        """
        Vérifie si le texte contient du code Atbash valide.
        Pour Atbash : on cherche des lettres alphabétiques.
        """
        if not text:
            return {"is_match": False, "fragments": [], "score": 0.0}
        
        # Nettoyer et normaliser le texte
        clean_text = text.upper().strip()
        
        # Pour Atbash, on considère valide tout texte avec des lettres
        alphabetic_chars = [c for c in clean_text if c.isalpha()]
        
        if not alphabetic_chars:
            return {"is_match": False, "fragments": [], "score": 0.0}
        
        # Si on a des lettres alphabétiques, c'est potentiellement de l'Atbash
        fragments = []
        current_fragment = ""
        
        for char in clean_text:
            if char.isalpha():
                current_fragment += char
            else:
                if current_fragment:
                    fragments.append(current_fragment)
                    current_fragment = ""
                if embedded and allowed_chars and char in allowed_chars:
                    # En mode embedded, on garde les séparateurs autorisés
                    if not current_fragment:
                        fragments.append(char)
        
        # Ajouter le dernier fragment
        if current_fragment:
            fragments.append(current_fragment)
        
        # Score basé sur le pourcentage de lettres alphabétiques
        total_chars = len(clean_text.replace(" ", ""))
        if total_chars > 0:
            score = len(alphabetic_chars) / total_chars
        else:
            score = 0.0
        
        is_match = len(alphabetic_chars) > 0
        
        return {
            "is_match": is_match,
            "fragments": fragments,
            "score": score
        }
        
    def _clean_text_for_scoring(self, text: str) -> str:
        """
        Nettoie le texte décodé pour le scoring.
        Pour l'Atbash, on normalise les espaces et la casse.
        
        Args:
            text: Le texte décodé à nettoyer
            
        Returns:
            Le texte nettoyé prêt pour le scoring
        """
        import re
        
        # Supprimer les espaces multiples et normaliser
        cleaned = re.sub(r'\s+', ' ', text.strip())
        
        # L'Atbash préserve généralement la structure des mots
        return cleaned

# Point d'entrée pour le système de plugins
def execute(inputs: dict) -> dict:
    """
    Point d'entrée principal pour le plugin Atbash.
    
    Args:
        inputs: Dictionnaire contenant les paramètres d'entrée
        
    Returns:
        Dictionnaire contenant le résultat au format standardisé
    """
    plugin = AtbashPlugin()
    return plugin.execute(inputs)
