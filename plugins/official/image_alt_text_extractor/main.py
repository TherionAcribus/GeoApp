from typing import Dict, Any, List, Optional
from loguru import logger
from bs4 import BeautifulSoup

try:
    from gc_backend.blueprints.coordinates import detect_gps_coordinates
except ImportError:
    logger.warning("Import de detect_gps_coordinates a échoué")
    detect_gps_coordinates = None

class ImageAltTextExtractorPlugin:
    def __init__(self):
        self.name = "image_alt_text_extractor"
        self.description = "Extrait attributs alt et title des images"

    def _detect_coordinates(self, text: str) -> Optional[Dict[str, Any]]:
        """Détecte les coordonnées GPS dans un texte."""
        if not text or not detect_gps_coordinates:
            return None
        try:
            detection = detect_gps_coordinates(text)
            if detection and detection.get('exist'):
                return detection
        except Exception as e:
            logger.debug(f"Erreur détection coordonnées: {e}")
        return None

    def execute(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        html_content = inputs.get('text', '')
        
        if not html_content:
            return {"status": "success", "results": [], "summary": "Aucun texte"}

        try:
            soup = BeautifulSoup(html_content, 'html.parser')
        except Exception as e:
            return {"status": "error", "summary": f"Erreur parsing HTML: {e}", "results": []}

        results = []
        coordinates_found = []
        
        for idx, img in enumerate(soup.find_all('img')):
            alt = img.get('alt', '').strip()
            title = img.get('title', '').strip()
            src = img.get('src', '')
            
            if alt or title:
                info_text = ""
                if alt:
                    info_text += f"Alt: '{alt}' "
                if title:
                    info_text += f"Title: '{title}'"
                
                result_item = {
                    "id": f"img_text_{idx}",
                    "text_output": f"Image {idx+1}: {info_text}",
                    "alt_text": alt,
                    "title_text": title,
                    "src": src,
                    "confidence": 1.0
                }
                
                coords = self._detect_coordinates(alt) or self._detect_coordinates(title)
                if coords:
                    result_item["coordinates"] = coords
                    result_item["decimal_latitude"] = coords.get('decimal_latitude')
                    result_item["decimal_longitude"] = coords.get('decimal_longitude')
                    result_item["text_output"] += f" 📍 Coordonnées: {coords.get('ddm', '')}"
                    coordinates_found.append(coords)
                
                results.append(result_item)

        summary = f"{len(results)} textes d'images trouvés"
        if coordinates_found:
            summary += f", {len(coordinates_found)} coordonnée(s) GPS détectée(s)"

        return {
            "status": "success",
            "summary": summary,
            "results": results,
            "primary_coordinates": coordinates_found[0] if coordinates_found else None
        }

plugin = ImageAltTextExtractorPlugin()

def execute(inputs):
    return plugin.execute(inputs)


