"""
Service d'analyse de listing pour les images et fragments secrets.

Ce module gère :
- Extraction des éléments d'image (alt, title, EXIF, GPS, noms de fichiers)
- Analyse et scoring des fragments secrets (texte caché, commentaires, etc.)
- Estimation des coûts OCR/vision par image
"""

import re
from pathlib import Path
from typing import Dict, Any, List, Optional
from urllib.parse import urlparse, unquote

from .hidden_content_service import (
    clean_listing_text,
    extract_html_tag_attribute,
    normalize_remote_resource_url,
)
from .metasolver_analysis import analyze_metasolver_signature


# ─────────────────────────────────────────────────────────────────────────────
# Constantes
# ─────────────────────────────────────────────────────────────────────────────

GENERIC_IMAGE_FILENAME_TOKENS = frozenset({
    'image', 'img', 'photo', 'picture', 'pict', 'pic', 'scan', 'file',
    'attachment', 'download', 'thumb', 'thumbnail', 'small', 'medium', 'large',
    'original', 'cache', 'geocache', 'waypoint', 'wp', 'gc', 'final', 'listing',
})


# ─────────────────────────────────────────────────────────────────────────────
# URL d'images
# ─────────────────────────────────────────────────────────────────────────────

def normalize_remote_image_url(url: str) -> str:
    """Normalise une URL d'image distante."""
    return normalize_remote_resource_url(url)


# ─────────────────────────────────────────────────────────────────────────────
# Extraction d'indices depuis les noms de fichiers d'images
# ─────────────────────────────────────────────────────────────────────────────

def extract_image_url_hint_candidates(image_url: str) -> List[Dict[str, Any]]:
    """Extrait des indices potentiels depuis l'URL d'une image (nom de fichier)."""
    normalized_url = normalize_remote_image_url(image_url)
    if not normalized_url:
        return []

    parsed = urlparse(normalized_url)
    image_host = (parsed.netloc or '').strip().lower()
    raw_stem = unquote(Path(parsed.path).stem or '').strip()
    if not raw_stem:
        return []

    def is_generic_filename(value: str) -> bool:
        compact = value.strip().lower()
        if not compact:
            return True
        compact_hex = re.sub(r'[^0-9a-f]+', '', compact)
        if re.fullmatch(r'[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}', compact):
            return True
        if (
            ('geocaching.com' in image_host or 'gcimg.net' in image_host)
            and re.fullmatch(r'[0-9a-f]{24,64}', compact_hex)
        ):
            return True
        if re.fullmatch(r'(?:img|image|photo|picture|pic|scan|file|dsc|wp|gc)[\s._-]*\d{1,8}', compact):
            return True
        tokens = [token for token in re.split(r'[^a-z0-9]+', compact) if token]
        if not tokens:
            return True
        if all(token in GENERIC_IMAGE_FILENAME_TOKENS or token.isdigit() for token in tokens):
            grouped_digits = re.fullmatch(r'\d{1,3}(?:[\s._-]\d{1,3}){2,}', compact)
            morse_like = re.fullmatch(r'[\-._]{4,}', compact)
            return not bool(grouped_digits or morse_like)
        return False

    candidates: List[Dict[str, Any]] = []
    seen_texts: set = set()

    def register_candidate(text: str, reason: str, confidence: float) -> None:
        cleaned = clean_listing_text(text, preserve_lines=False)
        if len(cleaned) < 3:
            return
        dedupe_key = cleaned.lower()
        if dedupe_key in seen_texts:
            return
        candidates.append({
            'source': 'image_filename_text',
            'reason': reason,
            'text': cleaned[:160],
            'image_url': normalized_url,
            'confidence': confidence,
        })
        seen_texts.add(dedupe_key)

    if not is_generic_filename(raw_stem):
        register_candidate(raw_stem, 'Nom de fichier d image extrait', 0.62)

    normalized_stem = re.sub(r'[_+=]+', ' ', raw_stem)
    normalized_stem = re.sub(r'(?<=\d)[.-](?=\d)', ' ', normalized_stem)
    normalized_stem = re.sub(r'(?<=[A-Za-z])[.-](?=[A-Za-z])', ' ', normalized_stem)
    normalized_stem = re.sub(r'\s+', ' ', normalized_stem).strip()
    if normalized_stem and normalized_stem != raw_stem and not is_generic_filename(normalized_stem):
        register_candidate(normalized_stem, 'Nom de fichier d image normalise', 0.68)

    return candidates[:2]


# ─────────────────────────────────────────────────────────────────────────────
# Extraction des éléments d'image depuis le listing
# ─────────────────────────────────────────────────────────────────────────────

def extract_image_listing_items(description_html: str, images: Any) -> Dict[str, Any]:
    """Extrait les éléments textuels (alt, title, filename) des images du listing."""
    raw_html = description_html or ''
    items: List[Dict[str, Any]] = []
    image_urls: List[str] = []
    seen_items: set = set()
    seen_urls: set = set()

    def register_image_url(raw_value: Any) -> str:
        normalized = str(raw_value or '').strip()
        if normalized and normalized not in seen_urls:
            seen_urls.add(normalized)
            image_urls.append(normalized)
            for hint_candidate in extract_image_url_hint_candidates(normalized):
                register_item(
                    source=str(hint_candidate.get('source') or 'image_filename_text'),
                    reason=str(hint_candidate.get('reason') or 'Nom de fichier d image'),
                    text=str(hint_candidate.get('text') or ''),
                    image_url=str(hint_candidate.get('image_url') or normalized),
                    confidence=hint_candidate.get('confidence') if isinstance(hint_candidate.get('confidence'), (int, float)) else None,
                )
        return normalized

    def register_item(
        *,
        source: str,
        reason: str,
        text: str,
        image_url: str = '',
        confidence: Optional[float] = None,
    ) -> None:
        normalized = clean_listing_text(text, preserve_lines=False)
        if len(normalized) < 2:
            return
        dedupe_key = f"{source}:{image_url}:{normalized.lower()}"
        if dedupe_key in seen_items:
            return
        item: Dict[str, Any] = {
            'source': source,
            'reason': reason,
            'text': normalized[:160],
        }
        if image_url:
            item['image_url'] = image_url
        if confidence is not None:
            item['confidence'] = round(float(confidence), 3)
        items.append(item)
        seen_items.add(dedupe_key)

    for match in re.finditer(r'<img\b[^>]*>', raw_html, flags=re.IGNORECASE):
        tag_html = match.group(0) or ''
        image_url = register_image_url(extract_html_tag_attribute(tag_html, 'src'))
        alt_text = extract_html_tag_attribute(tag_html, 'alt')
        title_text = extract_html_tag_attribute(tag_html, 'title')
        if alt_text:
            register_item(
                source='image_alt_text',
                reason='Texte alt d image extrait',
                text=alt_text,
                image_url=image_url,
                confidence=1.0,
            )
        if title_text:
            register_item(
                source='image_title_text',
                reason='Titre d image extrait',
                text=title_text,
                image_url=image_url,
                confidence=1.0,
            )

    if isinstance(images, list):
        for entry in images:
            if isinstance(entry, dict):
                image_url = register_image_url(
                    entry.get('url') or entry.get('src') or entry.get('href') or entry.get('image_url')
                )
                alt_text = clean_listing_text(entry.get('alt') or entry.get('alt_text') or '', preserve_lines=False)
                title_text = clean_listing_text(entry.get('title') or entry.get('title_text') or '', preserve_lines=False)
                if alt_text:
                    register_item(
                        source='image_alt_text',
                        reason='Texte alt d image fourni',
                        text=alt_text,
                        image_url=image_url,
                        confidence=1.0,
                    )
                if title_text:
                    register_item(
                        source='image_title_text',
                        reason='Titre d image fourni',
                        text=title_text,
                        image_url=image_url,
                        confidence=1.0,
                    )
            else:
                register_image_url(entry)

    return {
        'image_count': max(len(image_urls), len(re.findall(r'<img\b[^>]*>', raw_html, flags=re.IGNORECASE))),
        'image_urls': image_urls[:12],
        'items': items[:12],
    }


# ─────────────────────────────────────────────────────────────────────────────
# EXIF et métadonnées d'images
# ─────────────────────────────────────────────────────────────────────────────

def normalize_exif_value(value: Any) -> str:
    """Normalise une valeur EXIF en chaîne lisible."""
    if value is None:
        return ''
    if isinstance(value, bytes):
        for encoding in ('utf-8', 'utf-16-le', 'latin-1'):
            try:
                decoded = value.decode(encoding, errors='ignore').replace('\x00', ' ').strip()
                if decoded:
                    return clean_listing_text(decoded, preserve_lines=False)
            except Exception:
                continue
        return ''
    if isinstance(value, (list, tuple)):
        return clean_listing_text(' '.join(str(item) for item in value if item is not None), preserve_lines=False)
    return clean_listing_text(str(value), preserve_lines=False)


def gps_ratio_to_float(value: Any) -> Optional[float]:
    """Convertit une valeur GPS EXIF (ratio) en float."""
    try:
        if hasattr(value, 'numerator') and hasattr(value, 'denominator'):
            denominator = float(value.denominator or 0)
            if denominator == 0:
                return None
            return float(value.numerator) / denominator
        if isinstance(value, (tuple, list)) and len(value) == 2:
            denominator = float(value[1] or 0)
            if denominator == 0:
                return None
            return float(value[0]) / denominator
        return float(value)
    except Exception:
        return None


def extract_exif_gps_coordinates(gps_info: Any) -> Optional[Dict[str, Any]]:
    """Extrait les coordonnées GPS depuis les données EXIF."""
    if not isinstance(gps_info, dict):
        return None
    try:
        from PIL.ExifTags import GPSTAGS  # type: ignore
    except Exception:
        return None

    named_gps: Dict[str, Any] = {}
    for key, value in gps_info.items():
        named_gps[GPSTAGS.get(key, key)] = value

    latitude_values = named_gps.get('GPSLatitude')
    latitude_ref = str(named_gps.get('GPSLatitudeRef') or '').strip().upper()
    longitude_values = named_gps.get('GPSLongitude')
    longitude_ref = str(named_gps.get('GPSLongitudeRef') or '').strip().upper()
    if not latitude_values or not longitude_values or not latitude_ref or not longitude_ref:
        return None

    def convert_triplet(values: Any, ref: str) -> Optional[float]:
        if not isinstance(values, (list, tuple)) or len(values) != 3:
            return None
        degrees = gps_ratio_to_float(values[0])
        minutes = gps_ratio_to_float(values[1])
        seconds = gps_ratio_to_float(values[2])
        if degrees is None or minutes is None or seconds is None:
            return None
        decimal = degrees + (minutes / 60.0) + (seconds / 3600.0)
        if ref in {'S', 'W'}:
            decimal *= -1
        return round(decimal, 6)

    latitude = convert_triplet(latitude_values, latitude_ref)
    longitude = convert_triplet(longitude_values, longitude_ref)
    if latitude is None or longitude is None:
        return None

    return {
        'latitude': latitude,
        'longitude': longitude,
        'decimal': f'{latitude}, {longitude}',
    }


def estimate_vision_ocr_cost_units(image_detail: Optional[Dict[str, Any]], normalize_int_fn=None) -> int:
    """Estime le coût en unités pour l'OCR/vision d'une image."""
    if not isinstance(image_detail, dict):
        return 1

    if normalize_int_fn is None:
        def normalize_int_fn(v, d, *, minimum=0, maximum=None):
            try:
                parsed = int(v)
            except (TypeError, ValueError):
                return d
            if parsed < minimum:
                return d
            if maximum is not None and parsed > maximum:
                return maximum
            return parsed

    width = normalize_int_fn(image_detail.get('width'), 0, minimum=0, maximum=50000)
    height = normalize_int_fn(image_detail.get('height'), 0, minimum=0, maximum=50000)
    byte_size = normalize_int_fn(image_detail.get('byte_size'), 0, minimum=0, maximum=200_000_000)
    megapixels = (width * height) / 1_000_000 if width and height else 0.0

    if megapixels >= 8.0 or byte_size >= 4_000_000:
        return 3
    if megapixels >= 2.5 or byte_size >= 1_500_000:
        return 2
    return 1


def extract_image_metadata_items(image_urls: List[str]) -> Dict[str, Any]:
    """Télécharge les images et extrait les métadonnées EXIF (texte, GPS)."""
    if not image_urls:
        return {'items': [], 'coordinate_candidates': [], 'summaries': [], 'image_details': []}

    try:
        import requests  # type: ignore
        from io import BytesIO
        from PIL import Image  # type: ignore
        from PIL.ExifTags import TAGS  # type: ignore
    except Exception as exc:
        return {
            'items': [],
            'coordinate_candidates': [],
            'summaries': [f'EXIF indisponible: {exc}'],
            'image_details': [],
        }

    items: List[Dict[str, Any]] = []
    coordinate_candidates: List[Dict[str, Any]] = []
    summaries: List[str] = []
    image_details: List[Dict[str, Any]] = []
    interesting_tags = (
        'ImageDescription',
        'XPTitle',
        'XPComment',
        'Artist',
        'Copyright',
        'UserComment',
        'Make',
        'Model',
        'Software',
        'DateTimeOriginal',
    )

    for raw_url in image_urls[:6]:
        image_url = normalize_remote_image_url(raw_url)
        if not image_url:
            continue
        try:
            response = requests.get(image_url, timeout=10)
            if response.status_code != 200:
                continue
            image_bytes = response.content or b''
            with Image.open(BytesIO(image_bytes)) as image:
                width, height = image.size
                exif = image.getexif()
        except Exception:
            continue

        image_detail = {
            'image_url': image_url,
            'width': int(width) if isinstance(width, int) else 0,
            'height': int(height) if isinstance(height, int) else 0,
            'byte_size': len(image_bytes),
        }
        image_detail['vision_ocr_cost_units'] = estimate_vision_ocr_cost_units(image_detail)
        image_details.append(image_detail)

        if not exif:
            continue

        named_exif: Dict[str, Any] = {
            str(TAGS.get(tag_id, tag_id)): value
            for tag_id, value in exif.items()
        }
        found_for_image = 0
        for tag_name in interesting_tags:
            normalized_value = normalize_exif_value(named_exif.get(tag_name))
            if not normalized_value:
                continue
            items.append({
                'source': 'image_exif_text',
                'reason': f'EXIF {tag_name}',
                'text': normalized_value[:160],
                'image_url': image_url,
                'confidence': 0.9,
            })
            found_for_image += 1

        gps_coordinates = extract_exif_gps_coordinates(named_exif.get('GPSInfo'))
        if gps_coordinates:
            coordinate_candidates.append({
                'source': 'image_exif_gps',
                'image_url': image_url,
                'confidence': 0.93,
                'coordinates': gps_coordinates,
            })
            found_for_image += 1

        if found_for_image:
            summaries.append(f'EXIF: {found_for_image} indice(s) extrait(s) sur {image_url}')

    return {
        'items': items[:12],
        'coordinate_candidates': coordinate_candidates[:6],
        'summaries': summaries[:6],
        'image_details': image_details[:12],
    }


# ─────────────────────────────────────────────────────────────────────────────
# Fragments secrets
# ─────────────────────────────────────────────────────────────────────────────

def build_secret_fragment_evidence(signature: Dict[str, Any], source_name: str) -> List[str]:
    """Construit la liste des indices justifiant un fragment secret."""
    evidence: List[str] = []
    if source_name == 'html_comment':
        evidence.append("Fragment extracted from an HTML comment")
    if source_name == 'hidden_html_text':
        evidence.append("Fragment extracted from hidden HTML text")
    if source_name == 'hidden_css_text':
        evidence.append("Fragment extracted from CSS-hidden HTML text")
    if source_name == 'image_alt_text':
        evidence.append("Fragment extracted from image alt text")
    if source_name == 'image_title_text':
        evidence.append("Fragment extracted from an image title")
    if source_name == 'image_filename_text':
        evidence.append("Fragment extracted from an image filename")
    if source_name == 'image_ocr_text':
        evidence.append("Fragment extracted from OCR on an image")
    if source_name == 'image_vision_text':
        evidence.append("Fragment extracted from vision OCR on an image")
    if source_name == 'image_barcode_text':
        evidence.append("Fragment extracted from a barcode")
    if source_name == 'image_exif_text':
        evidence.append("Fragment extracted from EXIF metadata")
    if source_name == 'image_qr_text':
        evidence.append("Fragment extracted from a QR code")
    if signature.get('looks_like_morse'):
        evidence.append("Morse-like pattern detected")
    if signature.get('looks_like_binary'):
        evidence.append("Binary-like pattern detected")
    if signature.get('looks_like_hex'):
        evidence.append("Hex-like pattern detected")
    if signature.get('looks_like_phone_keypad'):
        evidence.append("T9-like pattern detected")
    if signature.get('looks_like_roman_numerals'):
        evidence.append("Roman numeral pattern detected")
    if signature.get('looks_like_a1z26'):
        evidence.append("Grouped values in the 1-26 range detected")
    if signature.get('looks_like_pi_index_positions'):
        evidence.append("Indexed numeric positions suitable for Pi digits detected")
    if signature.get('looks_like_tap_code'):
        evidence.append("Tap code groups detected")
    if signature.get('looks_like_bacon'):
        evidence.append("Bacon pattern detected")
    if signature.get('dominant_input_kind') in ('digits', 'symbols', 'mixed'):
        evidence.append(f"Dominant input kind: {signature.get('dominant_input_kind')}")
    if int(signature.get('group_count', 0)) > 1:
        evidence.append("The fragment is split into multiple groups")
    return list(dict.fromkeys(evidence))


def score_secret_fragment(signature: Dict[str, Any], source_name: str) -> float:
    """Calcule le score d'un fragment secret en fonction de sa signature."""
    score = 0.0
    if signature.get('looks_like_morse'):
        score += 60
    if signature.get('looks_like_binary'):
        score += 48
    if signature.get('looks_like_hex'):
        score += 42
    if signature.get('looks_like_phone_keypad'):
        score += 45
    if signature.get('looks_like_roman_numerals'):
        score += 32
    if signature.get('looks_like_a1z26'):
        score += 50
    if signature.get('looks_like_pi_index_positions'):
        score += 54
    if signature.get('looks_like_tap_code'):
        score += 50
    if signature.get('looks_like_bacon'):
        score += 50

    dominant_kind = signature.get('dominant_input_kind')
    if dominant_kind in ('digits', 'symbols', 'mixed'):
        score += 16
    if int(signature.get('group_count', 0)) > 1:
        score += 10

    fragment_length = int(signature.get('non_space_length', 0))
    if 4 <= fragment_length <= 64:
        score += 8
    if source_name == 'html_comment':
        score += 10
    if source_name == 'hidden_html_text':
        score += 12
    if source_name == 'hidden_css_text':
        score += 13
    if source_name in {'image_alt_text', 'image_title_text'}:
        score += 11
    if source_name == 'image_filename_text':
        score += 8
    if source_name == 'image_ocr_text':
        score += 14
    if source_name == 'image_vision_text':
        score += 13
    if source_name == 'image_barcode_text':
        score += 16
    if source_name == 'image_exif_text':
        score += 9
    if source_name == 'image_qr_text':
        score += 18
    if signature.get('looks_like_coordinate_fragment'):
        score -= 12
    if dominant_kind == 'words' and int(signature.get('word_count', 0)) >= 3:
        score -= 20

    return score


def register_secret_fragment(
    *,
    fragments: List[Dict[str, Any]],
    seen: set,
    text: str,
    source_name: str,
    source_kind: str,
) -> None:
    """Enregistre un fragment secret s'il passe le seuil de score minimum."""
    normalized_text = re.sub(r'\s+', ' ', (text or '')).strip()
    if len(normalized_text) < 4:
        return

    dedupe_key = normalized_text.lower()
    if dedupe_key in seen:
        return

    signature = analyze_metasolver_signature(normalized_text)
    score = score_secret_fragment(signature, source_name)
    if score < 25:
        return

    fragments.append({
        'source': source_name,
        'source_kind': source_kind,
        'text': normalized_text[:160],
        'score': round(score, 2),
        'confidence': round(min(0.99, max(0.05, score / 100.0)), 3),
        'signature': signature,
        'evidence': build_secret_fragment_evidence(signature, source_name),
    })
    seen.add(dedupe_key)


def extract_secret_fragments(
    *,
    title: str,
    description: str,
    hint: str,
    waypoint_text: str,
    hidden_comments: List[str],
    hidden_texts: List[str],
    hidden_text_items: Optional[List[Dict[str, str]]] = None,
    supplemental_text_sources: Optional[List[Dict[str, str]]] = None,
    max_fragments: int,
) -> List[Dict[str, Any]]:
    """Extrait et score les fragments secrets depuis les différentes sources du listing."""
    fragments: List[Dict[str, Any]] = []
    seen: set = set()

    source_values = [
        ('title', title),
        ('hint', hint),
        ('description', description),
        ('waypoints', waypoint_text),
    ]

    patterns = (
        ('morse_like', re.compile(r'(?<!\S)(?=[.\-/| ]{5,}[.\-])[.\-/| ]{5,}(?!\S)')),
        ('digit_groups', re.compile(r'(?<!\w)(?:\d{1,3}(?:[\s,;:/_-]+\d{1,3}){2,})(?!\w)')),
        ('tap_code', re.compile(r'(?<!\w)(?:[1-5]{2}(?:\s+[1-5]{2}){1,})(?!\w)')),
        ('bacon_like', re.compile(r'(?<!\w)(?:[AB]{5}(?:[\s,;:/_-]*[AB]{5})+)(?!\w)', flags=re.IGNORECASE)),
        ('t9_like', re.compile(r'(?<!\w)[2-9]{4,}(?!\w)')),
        ('hex_like', re.compile(r'(?<!\w)(?:0x)?[A-F0-9]{6,32}(?!\w)', flags=re.IGNORECASE)),
        ('mixed_code', re.compile(r'(?<!\w)[A-Z0-9]{5,24}(?!\w)')),
    )

    for source_name, source_text in source_values:
        cleaned_source = (source_text or '').strip()
        if not cleaned_source:
            continue

        source_kind = 'listing_field'
        if source_name in ('title', 'hint') and len(cleaned_source) <= 96:
            register_secret_fragment(
                fragments=fragments,
                seen=seen,
                text=cleaned_source,
                source_name=source_name,
                source_kind=source_kind,
            )

        for _, pattern in patterns:
            for match in pattern.findall(cleaned_source):
                register_secret_fragment(
                    fragments=fragments,
                    seen=seen,
                    text=match,
                    source_name=source_name,
                    source_kind=source_kind,
                )

    for comment in hidden_comments:
        register_secret_fragment(
            fragments=fragments,
            seen=seen,
            text=comment,
            source_name='html_comment',
            source_kind='hidden_html',
        )

    if hidden_text_items:
        for hidden_item in hidden_text_items:
            if not isinstance(hidden_item, dict):
                continue
            register_secret_fragment(
                fragments=fragments,
                seen=seen,
                text=str(hidden_item.get('text') or ''),
                source_name=str(hidden_item.get('source') or 'hidden_html_text'),
                source_kind='hidden_html',
            )
    else:
        for hidden_text in hidden_texts:
            register_secret_fragment(
                fragments=fragments,
                seen=seen,
                text=hidden_text,
                source_name='hidden_html_text',
                source_kind='hidden_html',
            )

    for supplemental in supplemental_text_sources or []:
        if not isinstance(supplemental, dict):
            continue
        register_secret_fragment(
            fragments=fragments,
            seen=seen,
            text=str(supplemental.get('text') or ''),
            source_name=str(supplemental.get('source_name') or 'supplemental_text'),
            source_kind=str(supplemental.get('source_kind') or 'supplemental'),
        )

    fragments.sort(key=lambda item: (-item['score'], -item['confidence'], item['source'], item['text']))
    return fragments[:max_fragments]
