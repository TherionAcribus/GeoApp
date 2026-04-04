import time
import re
from typing import List, Dict


class HoudiniCodePlugin:
    """
    Plugin pour encoder/décoder le code Houdini.

    Table de correspondance :
        Pray      → 1 ou A
        Answer    → 2 ou B
        Say       → 3 ou C
        Now       → 4 ou D
        Tell      → 5 ou E
        Please    → 6 ou F
        Speak     → 7 ou G
        Quickly   → 8 ou H
        Look      → 9 ou I
        Be Quick  → 0 ou 10 ou J

    - mode="encode" : convertit un texte (chiffres 0-9 ou lettres A-J) en mots Houdini.
    - mode="decode" : convertit des mots Houdini en chiffres/lettres.

    Spécificités :
        * Le champ "output_format" (numbers|letters) détermine la représentation désirée lors du décodage.
          - numbers  → 1,2,3...
          - letters  → A,B,C...
        * Lorsque le paramètre "brute_force" est activé (true), le plugin renvoie les deux variantes
          dans le tableau "results".
    """

    ############################################################
    # Tables d'encodage / décodage
    ############################################################

    _number_to_word = {
        1: "Pray",
        2: "Answer",
        3: "Say",
        4: "Now",
        5: "Tell",
        6: "Please",
        7: "Speak",
        8: "Quickly",
        9: "Look",
        0: "Be Quick",  # 0 ou 10
    }

    # Créer mappages complémentaires
    _letter_to_word = {chr(ord('A') + (n - 1)): w for n, w in _number_to_word.items() if n != 0}
    _letter_to_word['J'] = "Be Quick"

    _word_to_number: Dict[str, int] = {w.lower(): n for n, w in _number_to_word.items()}
    # Ajouter "10" comme alias pour "Be Quick"
    _word_to_number["be quick"] = 0

    # Pour décodage en lettres
    _word_to_letter: Dict[str, str] = {w.lower(): l for l, w in _letter_to_word.items()}
    _word_to_letter["be quick"] = 'J'

    ############################################################

    def __init__(self):
        self.name = "houdini_code"
        self.version = "1.0.0"

    # ---------------------------------------------------------------------
    # Encodage
    # ---------------------------------------------------------------------
    def encode(self, text: str) -> str:
        """Encode chiffres/lettres en mots Houdini."""
        tokens: List[str] = []
        i = 0
        text = text.strip()
        while i < len(text):
            c = text[i]
            # Gérer nombres à deux chiffres (10)
            if c.isdigit():
                # Vérifier 10
                if c == '1' and i + 1 < len(text) and text[i + 1] == '0':
                    tokens.append(self._number_to_word[0])  # Be Quick
                    i += 2
                    continue
                num = int(c)
                if num in self._number_to_word:
                    tokens.append(self._number_to_word[num])
                else:
                    tokens.append(c)
            else:
                uc = c.upper()
                if uc in self._letter_to_word:
                    tokens.append(self._letter_to_word[uc])
                else:
                    tokens.append(c)
            i += 1
        return ' '.join(tokens)

    # ---------------------------------------------------------------------
    # Décodage
    # ---------------------------------------------------------------------
    def _decode(self, text: str, as_letters: bool = False) -> str:
        """Décodage interne en chiffres (par défaut) ou lettres."""
        words = self._tokenize_words(text)
        out = []
        for w in words:
            key = w.lower()
            if key in self._word_to_number:
                if as_letters:
                    out.append(self._word_to_letter.get(key, '?'))
                else:
                    out.append(str(self._word_to_number[key]))
            else:
                # Conserver les mots inconnus tels quels
                out.append(w)
        return ''.join(out)

    @staticmethod
    def _tokenize_words(text: str) -> List[str]:
        """Sépare le texte en mots Houdini en tenant compte de "Be Quick"."""
        # Normaliser espaces multiples
        text = re.sub(r"\s+", " ", text.strip())
        if not text:
            return []
        tokens = text.split(' ')
        merged = []
        skip_next = False
        for idx, tok in enumerate(tokens):
            if skip_next:
                skip_next = False
                continue
            if tok.lower() == 'be' and idx + 1 < len(tokens) and tokens[idx + 1].lower() == 'quick':
                merged.append('Be Quick')
                skip_next = True
            else:
                merged.append(tok)
        return merged

    # ---------------------------------------------------------------------
    # Interface standardisée execute
    # ---------------------------------------------------------------------
    def execute(self, inputs: Dict) -> Dict:
        start = time.time()

        mode = inputs.get('mode', 'encode').lower()
        text = inputs.get('text', '')

        # Paramètres optionnels
        output_format = inputs.get('output_format', 'numbers').lower()
        bruteforce = inputs.get('bruteforce', False) or inputs.get('brute_force', False)

        result: Dict = {
            "status": "success",
            "plugin_info": {
                "name": self.name,
                "version": self.version,
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

        if not text:
            result["status"] = "error"
            result["summary"]["message"] = "Aucun texte fourni."
            return result

        try:
            if mode == 'encode':
                encoded = self.encode(text)
                result_id = "result_1"
                result["results"].append({
                    "id": result_id,
                    "text_output": encoded,
                    "confidence": 1.0,
                    "parameters": {"mode": mode},
                    "metadata": {}
                })
                result["summary"]["best_result_id"] = result_id
                result["summary"]["total_results"] = 1
                result["summary"]["message"] = "Encodage réussi."

            elif mode == 'decode':
                # Gestion bruteforce → deux variantes
                if bruteforce:
                    numbers_out = self._decode(text, as_letters=False)
                    letters_out = self._decode(text, as_letters=True)

                    # Résultats – chiffres d'abord (par défaut)
                    result["results"].append({
                        "id": "result_1",
                        "text_output": numbers_out,
                        "confidence": 0.6,
                        "parameters": {"output_format": "numbers"},
                        "metadata": {}
                    })
                    result["results"].append({
                        "id": "result_2",
                        "text_output": letters_out,
                        "confidence": 0.4,
                        "parameters": {"output_format": "letters"},
                        "metadata": {}
                    })
                    result["summary"]["total_results"] = 2
                    result["summary"]["best_result_id"] = "result_1"
                    result["summary"]["message"] = "Décodage bruteforce (chiffres + lettres) réussi."
                else:
                    as_letters = output_format == 'letters'
                    decoded = self._decode(text, as_letters=as_letters)
                    result_id = "result_1"
                    result["results"].append({
                        "id": result_id,
                        "text_output": decoded,
                        "confidence": 0.8,
                        "parameters": {"output_format": output_format},
                        "metadata": {}
                    })
                    result["summary"]["best_result_id"] = result_id
                    result["summary"]["total_results"] = 1
                    result["summary"]["message"] = "Décodage réussi."
            else:
                result["status"] = "error"
                result["summary"]["message"] = f"Mode inconnu : {mode}"
        except Exception as e:
            result["status"] = "error"
            result["summary"]["message"] = f"Erreur d'exécution : {str(e)}"

        finally:
            result["plugin_info"]["execution_time"] = int((time.time() - start) * 1000)

        return result


# Point d'entrée requis par le PluginManager

def init():
    return HoudiniCodePlugin() 