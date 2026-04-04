"""
Service OCR pour MysteryAI

Fournit l'extraction de texte à partir d'images via EasyOCR (hors-ligne) et,
si nécessaire, via le modèle multimodal configuré dans AIService (GPT-4o, Claude, …).

Principales caractéristiques :
1. Pré-traitement OpenCV pour améliorer la qualité du texte.
2. Cache d'un lecteur EasyOCR initialisé une seule fois (améliore les performances).
3. Fallback IA optionnel pour les cas où la confiance EasyOCR est faible.
4. API simple : extract_text(image_bytes, use_ai_fallback=False) → {text, confidence}.
"""

import base64
import logging
from typing import Dict, Tuple

import easyocr  # type: ignore
import numpy as np

try:
    import cv2  # type: ignore
except ImportError:  # Sécurité si OpenCV n'est pas installé dans l'environnement
    cv2 = None  # Le pré-traitement avancé sera désactivé

from app.services.ai_service import ai_service

logger = logging.getLogger(__name__)


class OCRService:
    """Service OCR principal : encapsule EasyOCR + fallback IA."""

    SUPPORTED_LANGS = [
        "fr",
        "en",
        "de",
        "es",
        "it",
        "nl",
        "pt",
    ]

    def __init__(self) -> None:
        # Initialisation du lecteur EasyOCR (peut prendre quelques secondes)
        self.reader = easyocr.Reader(self.SUPPORTED_LANGS, gpu=False)
        logger.info("OCRService : EasyOCR initialisé avec langues %s", self.SUPPORTED_LANGS)

    # ---------------------------------------------------------------------
    # API publique
    # ---------------------------------------------------------------------
    def extract_text(self, image_bytes: bytes, use_ai_fallback: bool = False) -> Dict[str, str | float]:
        """Extrait le texte d'une image.

        Args:
            image_bytes: Contenu binaire de l'image.
            use_ai_fallback: Si *True*, un second passage via IA sera effectué
                si EasyOCR retourne une confiance faible.

        Returns:
            Dictionnaire : {text: str, confidence: float}
        """
        # 1) Pré-traitement (si OpenCV dispo)
        processed = self._preprocess(image_bytes) if cv2 else image_bytes

        # 2) EasyOCR
        try:
            ocr_lines = self.reader.readtext(processed, detail=0, paragraph=True)
        except Exception as exc:  # fallback complet si EasyOCR échoue
            logger.warning("EasyOCR a échoué : %s", exc)
            ocr_lines = []

        text = "\n".join(ocr_lines).strip()
        confidence = 0.0 if not ocr_lines else 0.85  # EasyOCR ne fournit pas de score global.

        # 3) Fallback IA si demandé / confiance faible
        if use_ai_fallback and (confidence < 0.75 or not text):
            logger.info("OCR : passage au fallback IA (confiance %.2f)", confidence)
            text_ai = self._ai_ocr(image_bytes)
            if text_ai:
                text = text_ai.strip()
                confidence = max(confidence, 0.95)  # valeur arbitraire, à affiner le cas échéant

        return {"text": text, "confidence": confidence}

    # ------------------------------------------------------------------
    # Méthodes internes
    # ------------------------------------------------------------------
    @staticmethod
    def _preprocess(image_bytes: bytes) -> bytes:
        """Améliore l'image avant OCR (grayscale, binarisation)."""
        if cv2 is None:
            return image_bytes

        # Conversion bytes → ndarray
        np_img = np.frombuffer(image_bytes, np.uint8)
        img = cv2.imdecode(np_img, cv2.IMREAD_COLOR)
        if img is None:
            return image_bytes  # décodeur raté → on retourne l'original

        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        gray = cv2.bilateralFilter(gray, 9, 75, 75)
        _, thresh = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY | cv2.THRESH_OTSU)

        success, encoded = cv2.imencode(".png", thresh)
        return encoded.tobytes() if success else image_bytes

    @staticmethod
    def _ai_ocr(image_bytes: bytes) -> str:
        """Interroge le service IA multimodal pour transcrire le texte."""
        try:
            b64 = base64.b64encode(image_bytes).decode()
            messages = [
                {
                    "role": "user",
                    "content": [
                        {"type": "image_url", "url": f"data:image/png;base64,{b64}"},
                        {
                            "type": "text",
                            "text": "Transcris précisément le texte visible sur cette image sans interprétation ni correction orthographique.",
                        },
                    ],
                }
            ]
            response = ai_service.chat(messages)
            # Le service IA renvoie soit une chaîne, soit un dict {success: bool, response: str}
            if isinstance(response, dict):
                return response.get("response", "")
            return response or ""
        except Exception as exc:
            logger.error("OCR IA failed: %s", exc)
            return ""


# -------------------------------------------------------------------------
# Singleton helper
# -------------------------------------------------------------------------
_ocr_service_instance: OCRService | None = None


def get_ocr_service() -> OCRService:
    """Retourne l'instance singleton du service OCR."""
    global _ocr_service_instance
    if _ocr_service_instance is None:
        _ocr_service_instance = OCRService()
    return _ocr_service_instance 