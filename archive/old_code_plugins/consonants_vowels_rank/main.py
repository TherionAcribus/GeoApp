import time
import re
import os
import json

# Import du service de scoring si disponible
try:
    from app.services.scoring_service import ScoringService
    scoring_service_available = True
except ImportError:
    scoring_service_available = False


class ConsonantsVowelsRankPlugin:
    """
    Plugin pour encoder/décoder un texte selon le chiffre par rang Consonnes/Voyelles.

    Trois variantes sont supportées :
      1. both        : Consonnes et voyelles préfixées par C/V (ex: C3V1)
      2. consonants  : Seules les consonnes sont chiffrées (B=1 .. Z=20)
      3. vowels      : Seules les voyelles sont chiffrées (A=1 .. Y=6)
    """

    VOWELS = "AEIOUY"
    CONSONANTS = "BCDFGHJKLMNPQRSTVWXZ"

    def __init__(self):
        self.name = "consonants_vowels_rank"
        self.description = "Chiffrement/déchiffrement par rang consonnes/voyelles"

        # Préparer les mappings
        self.vowel_to_rank = {ch: idx + 1 for idx, ch in enumerate(self.VOWELS)}
        self.rank_to_vowel = {idx + 1: ch for idx, ch in enumerate(self.VOWELS)}

        self.consonant_to_rank = {ch: idx + 1 for idx, ch in enumerate(self.CONSONANTS)}
        self.rank_to_consonant = {idx + 1: ch for idx, ch in enumerate(self.CONSONANTS)}

        # Lecture du param enable_scoring via plugin.json
        self.enable_scoring_default = False
        config_path = os.path.join(os.path.dirname(__file__), "plugin.json")
        if os.path.exists(config_path):
            try:
                with open(config_path, "r", encoding="utf-8") as f:
                    cfg = json.load(f)
                    self.enable_scoring_default = cfg.get("enable_scoring", False)
            except Exception:
                pass

        # Instancier le scoring service si disponible
        if scoring_service_available:
            try:
                self.scoring_service = ScoringService()
            except Exception:
                self.scoring_service = None
        else:
            self.scoring_service = None

    # ------------------------------------------------------------------
    #  Encodage / Décodage de base
    # ------------------------------------------------------------------
    def encode(self, text: str, variant: str = "both") -> str:
        tokens = []
        for ch in text.upper():
            if ch in self.VOWELS:
                rank = self.vowel_to_rank[ch]
                if variant == "both":
                    tokens.append(f"V{rank}")
                elif variant == "vowels":
                    tokens.append(str(rank))
                else:  # consonants variant
                    tokens.append(ch)
            elif ch in self.CONSONANTS:
                rank = self.consonant_to_rank[ch]
                if variant == "both":
                    tokens.append(f"C{rank}")
                elif variant == "consonants":
                    tokens.append(str(rank))
                else:
                    tokens.append(ch)
            else:
                tokens.append(ch)

        # Pour les variantes numériques, séparer les tokens par espace afin de faciliter le décodage
        if variant in {"consonants", "vowels"}:
            return " ".join(tokens)
        else:
            return "".join(tokens)

    def _decode_both(self, text: str) -> str:
        # Remplacer C\d+ / V\d+ par la lettre correspondante
        def repl(match):
            prefix = match.group(1)
            num = int(match.group(2))
            if prefix.upper() == "C":
                return self.rank_to_consonant.get(num, "?")
            else:
                return self.rank_to_vowel.get(num, "?")

        # Utilise une expression régulière pour gérer les cas sans séparateur
        pattern = re.compile(r"([CVcv])(\d{1,2})")
        temp = pattern.sub(repl, text)
        return temp

    def _decode_single_group(self, text: str, mapping: dict) -> str:
        """Décodage pour les variantes consonants ou vowels.
        mapping: dict de num->letter"""
        tokens = re.findall(r"\d{1,2}|\D", text)
        decoded = []
        buffer_num = ""
        for token in tokens:
            if token.isdigit():
                buffer_num += token
            else:
                # Si on a accumulé un nombre, on le traite avant d'ajouter le token non numérique
                if buffer_num:
                    num = int(buffer_num)
                    decoded.append(mapping.get(num, "?"))
                    buffer_num = ""
                decoded.append(token)
        # Traiter un éventuel nombre final
        if buffer_num:
            num = int(buffer_num)
            decoded.append(mapping.get(num, "?"))
        return "".join(decoded)

    def decode(self, text: str, variant: str = "both") -> str:
        if variant == "both":
            return self._decode_both(text)
        elif variant == "consonants":
            return self._decode_single_group(text, self.rank_to_consonant)
        elif variant == "vowels":
            return self._decode_single_group(text, self.rank_to_vowel)
        else:
            raise ValueError(f"Variante inconnue: {variant}")

    # ------------------------------------------------------------------
    #  Exécution générique (format de réponse standardisé)
    # ------------------------------------------------------------------
    def _standard_response(self):
        return {
            "status": "success",
            "plugin_info": {
                "name": self.name,
                "version": "1.0.0",
                "execution_time": 0
            },
            "inputs": {},
            "results": [],
            "summary": {
                "best_result_id": None,
                "total_results": 0,
                "message": ""
            }
        }

    def _compute_basic_confidence(self, text: str) -> float:
        """Estime une confiance simple : proportion de lettres/fréquence d'espace acceptable."""
        if not text:
            return 0.0
        letters = sum(1 for c in text if c.isalpha())
        ratio = letters / len(text)
        # plus le ratio est proche de 1, meilleure la confiance (min 0.3, max 0.9)
        return max(0.3, min(0.3 + ratio * 0.6, 0.9))

    def _get_text_score(self, text: str, context=None):
        """Tente d'obtenir un score via le service de scoring, sinon None."""
        if self.scoring_service:
            try:
                return self.scoring_service.score_text(text, context)
            except Exception:
                return None
        return None

    def execute(self, inputs: dict):
        start = time.time()
        response = self._standard_response()
        response["inputs"] = inputs.copy()

        text = inputs.get("text", "")
        variant = inputs.get("variant", "both")
        mode = inputs.get("mode", "decode")
        bruteforce_flag = inputs.get("bruteforce", False) or inputs.get("brute_force", False) or mode == "bruteforce"

        if not text:
            response["status"] = "error"
            response["summary"]["message"] = "Aucun texte fourni"
            return response

        try:
            if bruteforce_flag:
                variants = ["both", "consonants", "vowels"]
                for idx, var in enumerate(variants, 1):
                    decoded = self.decode(text, var)

                    # scoring
                    scoring_result = None
                    confidence = 0.0
                    scoring_result = self._get_text_score(decoded)
                    if scoring_result and "score" in scoring_result:
                        confidence = scoring_result["score"]
                    else:
                        confidence = self._compute_basic_confidence(decoded)

                    result_entry = {
                        "id": f"result_{idx}",
                        "text_output": decoded,
                        "confidence": confidence,
                        "parameters": {
                            "mode": "decode",
                            "variant": var
                        },
                        "metadata": {
                            "processed_chars": len(text)
                        }
                    }
                    if scoring_result:
                        result_entry["scoring"] = scoring_result
                    response["results"].append(result_entry)

                # trier par confiance
                response["results"].sort(key=lambda x: x["confidence"], reverse=True)
                if response["results"]:
                    response["summary"]["best_result_id"] = response["results"][0]["id"]
                    response["summary"]["total_results"] = len(response["results"])
                    response["summary"]["message"] = "Bruteforce terminé sur les trois variantes"

            elif mode == "encode":
                result_text = self.encode(text, variant)
                confidence = 1.0
                summary_msg = "Encodage réussi"
            elif mode == "decode":
                result_text = self.decode(text, variant)
                # Confiance de base pour un décodage simple
                confidence = 0.9
                summary_msg = "Décodage réussi"
            else:
                raise ValueError("Mode invalide. Utilisez 'encode' ou 'decode'.")

            result_entry = {
                "id": "result_1",
                "text_output": result_text,
                "confidence": confidence,
                "parameters": {
                    "mode": mode,
                    "variant": variant
                },
                "metadata": {
                    "processed_chars": len(text)
                }
            }

            response["results"].append(result_entry)
            response["summary"]["best_result_id"] = "result_1"
            response["summary"]["total_results"] = 1
            response["summary"]["message"] = summary_msg

        except Exception as e:
            response["status"] = "error"
            response["summary"]["message"] = str(e)

        response["plugin_info"]["execution_time"] = int((time.time() - start) * 1000)
        return response


# Point d'entrée

def init():
    return ConsonantsVowelsRankPlugin() 