"""
Plugin Formula Parser
Détecte et parse les formules de coordonnées GPS avec variables.

Supporte plusieurs formats :
- Standard : N 47° 5E.FTN E 006° 5A.JVF
- Avec espaces : N 48° 41.E D B E 006° 09. F C (A / 2)
- Avec opérations : N49°18.(B-A)(B-C-F)(D+E) E006°16.(C+F)(D+F)(C+D)
"""

import re
from typing import Dict, Any, List, Optional


class FormulaParserPlugin:
    """Plugin pour parser des formules de coordonnées GPS dans un texte."""
    
    def __init__(self):
        self.name = "formula_parser"
        self.version = "1.0.0"
        self.description = "Détecte et parse les coordonnées/formules GPS dans un texte"
    
    def execute(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        """
        Exécute le plugin pour détecter les formules de coordonnées.
        
        Args:
            inputs: Dictionnaire contenant 'text' (le texte à analyser)
        
        Returns:
            Dictionnaire avec status, results, et summary
            Format de retour :
            {
                "status": "success",
                "results": [
                    {
                        "id": "result_1",
                        "north": "N49°18.(B-A)(B-C-F)(D+E)",
                        "east": "E006°16.(C+F)(D+F)(C+D)",
                        "source": "text",
                        "text_output": "N49°18.(B-A)(B-C-F)(D+E) E006°16.(C+F)(D+F)(C+D)",
                        "confidence": 0.9
                    }
                ],
                "summary": "1 formule(s) détectée(s)"
            }
        """
        text = inputs.get('text', '')
        
        if not text:
            return {
                "status": "error",
                "error": {"message": "Aucun texte fourni"},
                "results": [],
                "summary": "Erreur : texte vide"
            }
        
        coordinates = self._detect_coordinates(text)
        
        # Formater les résultats
        results = []
        for idx, coord in enumerate(coordinates, start=1):
            result = {
                "id": f"result_{idx}",
                "north": coord["north"],
                "east": coord["east"],
                "source": coord.get("source", "text"),
                "text_output": f"{coord['north']} {coord['east']}",
                "confidence": 0.9 if coord["north"] and coord["east"] else 0.5
            }
            results.append(result)
        
        # Construire le résumé
        count = len(results)
        if count == 0:
            summary = "Aucune formule détectée"
            status = "success"
        elif count == 1:
            summary = "1 formule détectée"
            status = "success"
        else:
            summary = f"{count} formules détectées"
            status = "success"
        
        return {
            "status": status,
            "results": results,
            "summary": summary
        }
    
    def _basic_clean(self, coord_str: str) -> str:
        """
        Nettoyage de base pour les formats standards.
        
        Args:
            coord_str: Chaîne de coordonnées à nettoyer
        
        Returns:
            Chaîne nettoyée
        """
        if not coord_str or '.' not in coord_str:
            return coord_str
        
        # Pour le format N 48° 41.X Y Z, transformer en N 48° 41.XYZ
        result = re.sub(
            r'(\d{1,2}°\s+\d{1,2}\.)\s*([A-Z])\s+([A-Z])\s+([A-Z])',
            r'\1\2\3\4',
            coord_str
        )
        
        # Pour le format E 006° 09.X Y (Z/W), transformer en E 006° 09.XY(Z/W)
        result = re.sub(
            r'(\d{1,3}°\s+\d{1,2}\.)\s*([A-Z])\s+([A-Z])\s+\(([A-Z])\s*/\s*(\d+)\)',
            r'\1\2\3(\4/\5)',
            result
        )
        
        return result

    def _detect_coordinates(self, text: str) -> List[Dict[str, str]]:
        """Détecte les paires latitude/longitude en conservant leur ordre."""
        north_matches = self._find_all_north(text)
        east_matches = self._find_all_east(text)

        coordinates: List[Dict[str, str]] = []
        used_east_indexes = set()

        for index, north_match in enumerate(north_matches):
            next_north_start = (
                north_matches[index + 1].start()
                if index + 1 < len(north_matches)
                else len(text) + 1
            )
            east_candidate = None
            east_candidate_index = None

            for east_index, east_match in enumerate(east_matches):
                if east_index in used_east_indexes:
                    continue
                if east_match.start() < north_match.end():
                    continue
                if east_match.start() >= next_north_start:
                    continue
                east_candidate = east_match
                east_candidate_index = east_index
                break

            if east_candidate_index is not None:
                used_east_indexes.add(east_candidate_index)

            coordinates.append({
                "north": self._basic_clean(north_match.group(0).strip()),
                "east": self._basic_clean(east_candidate.group(0).strip()) if east_candidate else "",
                "source": "standard_format"
            })

        if not coordinates and east_matches:
            coordinates.append({
                "north": "",
                "east": self._basic_clean(east_matches[0].group(0).strip()),
                "source": "standard_format"
            })

        return coordinates

    def _find_all_north(self, description: str) -> List[re.Match]:
        return self._find_all(description, self._north_patterns())

    def _find_all_east(self, description: str) -> List[re.Match]:
        return self._find_all(description, self._east_patterns())

    def _find_all(self, description: str, patterns: List[str]) -> List[re.Match]:
        matches = []
        for priority, pattern in enumerate(patterns):
            for match in re.finditer(pattern, description, re.IGNORECASE):
                matches.append((match.start(), match.end(), priority, match))

        matches.sort(key=lambda item: (item[0], -(item[1] - item[0]), item[2]))

        accepted: List[re.Match] = []
        for start, end, _priority, match in matches:
            overlaps = any(start < existing.end() and end > existing.start() for existing in accepted)
            if overlaps:
                continue
            accepted.append(match)

        return accepted

    def _north_patterns(self) -> List[str]:
        degree = r'[\u00b0\u00ba]'
        paren_expr = r'\([A-Z0-9()+*/\-\s]+\)'
        return [
            rf"[NS]\s*\d{{1,2}}\s*{degree}\s*\d{{1,2}}\.\s*({paren_expr}\s*)+",
            rf"[NS]\s*\d{{1,2}}\s*{degree}\s*\d{{1,2}}\.\s*(?:[A-Z0-9]+|{paren_expr})+",
            rf"[NS]\s*\d{{1,2}}\s*{degree}\s*\d{{1,2}}\.\s*\d{{1,3}}",
            rf"[NS]\s*\d{{1,2}}\s*{degree}\s*\d{{1,2}}\.\s*[A-Z]{{1,5}}(?!\s*\()",
            rf"[NS]\s*\d{{1,2}}\s*{degree}\s*[A-Z0-9()+*/\-]{{1,20}}\.\s*[A-Z0-9()+*/\-]{{1,20}}",
            rf"[NS]\s+\d{{1,2}}\s*{degree}\s+\d{{1,2}}\.\s*[A-Z][ \t\n]*[A-Z][ \t\n]*[A-Z]"
        ]

    def _east_patterns(self) -> List[str]:
        degree = r'[\u00b0\u00ba]'
        paren_expr = r'\([A-Z0-9()+*/\-\s]+\)'
        east_cardinal = r'[EWO]'
        return [
            rf"{east_cardinal}\s*\d{{1,3}}\s*{degree}\s*\d{{1,2}}\.\s*({paren_expr}\s*)+",
            rf"{east_cardinal}\s*\d{{1,3}}\s*{degree}\s*\d{{1,2}}\.\s*(?:[A-Z0-9]+|{paren_expr})+",
            rf"{east_cardinal}\s*\d{{1,3}}\s*{degree}\s*\d{{1,2}}\.\s*\d{{1,3}}",
            rf"{east_cardinal}\s*\d{{1,3}}\s*{degree}\s*\d{{1,2}}\.\s*[A-Z]{{1,5}}(?!\s*\()",
            rf"{east_cardinal}\s*\d{{1,3}}\s*{degree}\s*[A-Z0-9()+*/\-]{{1,20}}\.\s*[A-Z0-9()+*/\-]{{1,20}}",
            rf"{east_cardinal}\s+\d{{1,3}}\s*{degree}\s+\d{{1,2}}\.\s+[A-Z]\s+[A-Z]\s+\([A-Z]\s*/\s*\d+\)"
        ]
    
    def _find_north(self, description: str) -> Optional[re.Match]:
        """
        Essaie de trouver une coordonnée Nord (ou Sud) dans le texte.
        
        Args:
            description: Texte dans lequel chercher
        
        Returns:
            Match object ou None
        """
        matches = self._find_all_north(description)
        return matches[0] if matches else None
    
    def _find_east(self, description: str) -> Optional[re.Match]:
        """
        Essaie de trouver une coordonnée Est (ou Ouest) dans le texte.
        
        Args:
            description: Texte dans lequel chercher
        
        Returns:
            Match object ou None
        """
        matches = self._find_all_east(description)
        return matches[0] if matches else None


# Instance du plugin pour l'exécution
plugin = FormulaParserPlugin()


def execute(inputs: Dict[str, Any]) -> Dict[str, Any]:
    """Point d'entrée principal pour le PluginManager."""
    return plugin.execute(inputs)
