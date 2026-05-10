"""
Service d'orchestration de workflow pour la resolution de geocaches.

Ce module gere :
- Construction des classifications de listing
- Construction des candidats de workflow
- Selection du workflow primaire
- Resolution et execution des etapes de workflow
- Gestion du budget (metasolver, checker, formules, vision OCR)
"""

import json
import re
import math
from typing import Dict, Any, List, Optional, Tuple

from loguru import logger

from ..plugins import PluginManager
from ..database import db
from ..geocaches.models import Geocache
from .metasolver_analysis import (
    analyze_metasolver_signature as _analyze_metasolver_signature,
    load_metasolver_presets as _load_metasolver_presets,
    collect_metasolver_candidates as _collect_metasolver_candidates,
    normalize_max_plugins as _normalize_max_plugins,
    recommend_metasolver_plugins,
)
from .hidden_content_service import (
    clean_listing_text as _clean_listing_text,
    extract_hidden_content_signals as _extract_hidden_content_signals,
)
from .listing_analysis_service import (
    extract_image_listing_items as _extract_image_listing_items,
    extract_image_metadata_items as _extract_image_metadata_items,
    extract_secret_fragments as _extract_secret_fragments,
    normalize_remote_image_url as _normalize_remote_image_url,
    register_secret_fragment as _register_secret_fragment,
    estimate_vision_ocr_cost_units as _estimate_vision_ocr_cost_units,
)


# ─────────────────────────────────────────────────────────────────────────────
# Plugin manager accessor (injected from blueprint)
# ─────────────────────────────────────────────────────────────────────────────

_plugin_manager: Optional[PluginManager] = None


def init_workflow_plugin_manager(manager: PluginManager) -> None:
    """Initialize the workflow service with the PluginManager instance."""
    global _plugin_manager
    _plugin_manager = manager


def get_plugin_manager() -> PluginManager:
    """Retrieve the PluginManager instance."""
    if _plugin_manager is None:
        raise RuntimeError("PluginManager non initialisé dans le service workflow")
    return _plugin_manager


# ─────────────────────────────────────────────────────────────────────────────
# Constantes
# ─────────────────────────────────────────────────────────────────────────────

DECIMAL_COORDINATE_PAIR_PATTERN = re.compile(
    r'(-?\d{1,2}(?:[.,]\d+)?)\s*[,;/]\s*(-?\d{1,3}(?:[.,]\d+)?)'
)
DDM_COORDINATE_PAIR_PATTERN = re.compile(r'([NS][^EW]+?)\s+([EW].+)$', re.IGNORECASE)
PI_THEME_PATTERN = re.compile(r'(?<![A-Z0-9])(?:PI(?:\s*-\s*DAY|\s+DAY)?|Π)(?![A-Z0-9])', re.IGNORECASE)

SUPPORTED_AUTOMATED_WORKFLOW_STEPS = frozenset({
    'inspect-hidden-html',
    'inspect-images',
    'describe-images',
    'execute-direct-plugin',
    'execute-metasolver',
    'search-answers',
    'calculate-final-coordinates',
    'validate-with-checker',
})

LISTING_CLASSIFICATION_ACTIONS: Dict[str, str] = {
    'secret_code': "Extract the most structured fragment, run a direct plugin if the family is obvious, otherwise call recommend_metasolver_plugins before metasolver.",
    'hidden_content': "Inspect HTML comments, hidden styles, CSS-hidden selectors and page source before trying decoders.",
    'formula': "List variables and coordinate placeholders, then use the formula solver workflow.",
    'word_game': "Identify the exact game type first (sudoku, crossword, anagram, etc.) before decoding.",
    'image_puzzle': "Inspect listing images and run OCR / QR / barcode tools if relevant.",
    'coord_transform': "Compare posted coordinates, waypoint notes and projection clues before estimating finals.",
    'checker_available': "Validate textual answers or final coordinates with run_checker before concluding.",
}

WORKFLOW_BUDGET_DEFAULTS: Dict[str, Dict[str, Any]] = {
    'general': {
        'max_automated_steps': 1,
        'max_metasolver_runs': 0,
        'max_search_questions': 0,
        'max_checker_runs': 1,
        'max_coordinate_calculations': 0,
        'max_vision_ocr_runs': 0,
        'stop_on_checker_success': True,
    },
    'secret_code': {
        'max_automated_steps': 2,
        'max_metasolver_runs': 1,
        'max_search_questions': 0,
        'max_checker_runs': 1,
        'max_coordinate_calculations': 0,
        'max_vision_ocr_runs': 0,
        'stop_on_checker_success': True,
    },
    'formula': {
        'max_automated_steps': 3,
        'max_metasolver_runs': 0,
        'max_search_questions': 12,
        'max_checker_runs': 1,
        'max_coordinate_calculations': 1,
        'max_vision_ocr_runs': 0,
        'stop_on_checker_success': True,
    },
    'checker': {
        'max_automated_steps': 1,
        'max_metasolver_runs': 0,
        'max_search_questions': 0,
        'max_checker_runs': 1,
        'max_coordinate_calculations': 0,
        'max_vision_ocr_runs': 0,
        'stop_on_checker_success': True,
    },
    'hidden_content': {
        'max_automated_steps': 1,
        'max_metasolver_runs': 0,
        'max_search_questions': 0,
        'max_checker_runs': 1,
        'max_coordinate_calculations': 0,
        'max_vision_ocr_runs': 0,
        'stop_on_checker_success': True,
    },
    'image_puzzle': {
        'max_automated_steps': 1,
        'max_metasolver_runs': 0,
        'max_search_questions': 0,
        'max_checker_runs': 1,
        'max_coordinate_calculations': 0,
        'max_vision_ocr_runs': 3,
        'stop_on_checker_success': True,
    },
    'coord_transform': {
        'max_automated_steps': 1,
        'max_metasolver_runs': 0,
        'max_search_questions': 0,
        'max_checker_runs': 1,
        'max_coordinate_calculations': 0,
        'max_vision_ocr_runs': 0,
        'stop_on_checker_success': True,
    },
}


# ─────────────────────────────────────────────────────────────────────────────
# Utilitaires partagés (déplacés depuis le blueprint)
# ─────────────────────────────────────────────────────────────────────────────

def _normalize_positive_int(value: Any, default: int, *, minimum: int = 0, maximum: Optional[int] = None) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return default
    if parsed < minimum:
        return default
    if maximum is not None and parsed > maximum:
        return maximum
    return parsed


def _normalize_bool(value: Any, default: bool) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {'true', '1', 'yes', 'oui', 'on'}:
            return True
        if normalized in {'false', '0', 'no', 'non', 'off'}:
            return False
    return default


def _collect_waypoint_listing_text(waypoints: Any) -> str:
    if not isinstance(waypoints, list):
        return ''
    parts: List[str] = []
    for waypoint in waypoints:
        if not isinstance(waypoint, dict):
            continue
        for key in ('prefix', 'lookup', 'name', 'type', 'gc_coords', 'note', 'note_override'):
            value = waypoint.get(key)
            if isinstance(value, str) and value.strip():
                parts.append(value.strip())
    return '\n'.join(parts)


def _contains_pi_theme(*values: Any) -> bool:
    combined = '\n'.join(str(value or '') for value in values if value)
    return bool(combined and PI_THEME_PATTERN.search(combined))


def _extract_pi_coordinate_position_sequences(*values: Any) -> Optional[Dict[str, Any]]:
    ordered_axes = ('N', 'S', 'E', 'W')
    axis_lines: Dict[str, str] = {}
    axis_positions: Dict[str, List[int]] = {}
    for value in values:
        if not value:
            continue
        text = str(value)
        for raw_line in text.splitlines():
            line = raw_line.strip()
            if len(line) < 3 or line[0].upper() not in ordered_axes:
                continue
            if any(marker in line for marker in ('°', 'º')):
                continue
            axis = line[0].upper()
            body = line[1:].strip()
            if not body or re.search(r'[A-DF-Z]{2,}', body, flags=re.IGNORECASE):
                continue
            positions = [int(token) for token in re.findall(r'\d{1,4}', body)]
            if len(positions) < 6 or any(position <= 0 for position in positions):
                continue
            axis_positions[axis] = positions
            axis_lines[axis] = f"{axis} " + ','.join(str(position) for position in positions)
    if not axis_positions:
        return None
    source_lines = [axis_lines[axis] for axis in ordered_axes if axis in axis_lines]
    return {
        'axes': [axis for axis in ordered_axes if axis in axis_positions],
        'axis_positions': axis_positions,
        'source_text': '\n'.join(source_lines),
        'total_positions': sum(len(values) for values in axis_positions.values()),
    }



def _build_hidden_content_execution(
    *,
    listing_inputs: Dict[str, Any],
    data: Dict[str, Any],
    max_secret_fragments: int,
    max_plugins: int,
) -> Dict[str, Any]:
    hidden_info = _extract_hidden_content_signals(listing_inputs.get('description_html') or '')
    candidate_secret_fragments = _extract_secret_fragments(
        title='',
        description='',
        hint='',
        waypoint_text='',
        hidden_comments=hidden_info.get('comments') or [],
        hidden_texts=hidden_info.get('hidden_texts') or [],
        hidden_text_items=hidden_info.get('hidden_text_items') or [],
        max_fragments=max_secret_fragments,
    )
    selected_fragment = candidate_secret_fragments[0] if candidate_secret_fragments else None
    recommendation = None
    if selected_fragment and isinstance(selected_fragment, dict):
        fragment_text = str(selected_fragment.get('text') or '').strip()
        if fragment_text:
            recommendation = _recommend_metasolver_plugins_response(
                text=fragment_text,
                requested_preset=(str(data.get('metasolver_preset') or '')).strip().lower(),
                mode=(str(data.get('metasolver_mode') or 'decode')).strip().lower(),
                max_plugins=max_plugins,
            )

    summary_parts: List[str] = []
    signal_count = len(hidden_info.get('signals') or [])
    item_count = len(hidden_info.get('items') or [])
    if signal_count:
        summary_parts.append(f"{signal_count} signal(s) HTML cache detecte(s)")
    if item_count:
        summary_parts.append(f"{item_count} extrait(s) cache(s)")
    if selected_fragment:
        summary_parts.append(f"Fragment principal: {str(selected_fragment.get('text') or '')[:60]}")
    summary = ' | '.join(summary_parts) or 'Aucun contenu cache exploitable extrait.'

    return {
        'inspected': True,
        'hidden_signals': hidden_info.get('signals') or [],
        'comments': hidden_info.get('comments') or [],
        'hidden_texts': hidden_info.get('hidden_texts') or [],
        'items': hidden_info.get('items') or [],
        'candidate_secret_fragments': candidate_secret_fragments,
        'selected_fragment': selected_fragment,
        'recommendation': recommendation,
        'summary': summary,
    }


def _build_image_puzzle_execution(
    *,
    listing_inputs: Dict[str, Any],
    data: Dict[str, Any],
    max_secret_fragments: int,
    max_plugins: int,
    include_plugin_runs: bool = True,
    inspected: bool = True,
    max_vision_ocr_cost_units: int = 0,
) -> Dict[str, Any]:
    image_info = _extract_image_listing_items(
        listing_inputs.get('description_html') or '',
        listing_inputs.get('images') or [],
    )
    image_items: List[Dict[str, Any]] = [dict(item) for item in (image_info.get('items') or [])]
    plugin_summaries: List[str] = []
    coordinate_candidates: List[Dict[str, Any]] = []
    vision_ocr_images_analyzed = 0
    vision_ocr_budget_cost = 0
    seen_item_keys = {
        f"{str(item.get('source') or '')}:{str(item.get('image_url') or '')}:{str(item.get('text') or '').lower()}"
        for item in image_items
    }
    seen_coordinate_keys: set = set()

    def register_image_item(
        *,
        source: str,
        reason: str,
        text: str,
        image_url: str = '',
        confidence: Optional[float] = None,
    ) -> None:
        normalized = _clean_listing_text(text, preserve_lines=False)
        if len(normalized) < 2:
            return
        dedupe_key = f"{source}:{image_url}:{normalized.lower()}"
        if dedupe_key in seen_item_keys:
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
        image_items.append(item)
        seen_item_keys.add(dedupe_key)

    def register_coordinate_candidate(
        candidate: Any,
        *,
        source: str,
        image_url: str = '',
        confidence: Optional[float] = None,
    ) -> None:
        parsed = _extract_decimal_coordinates(candidate)
        if not parsed:
            return
        dedupe_key = f"{round(parsed['latitude'], 6)}:{round(parsed['longitude'], 6)}"
        if dedupe_key in seen_coordinate_keys:
            return
        coordinate_candidates.append({
            'source': source,
            'image_url': image_url or None,
            'confidence': round(float(confidence), 3) if confidence is not None else None,
            'coordinates': candidate if isinstance(candidate, (dict, str)) else {
                'latitude': parsed['latitude'],
                'longitude': parsed['longitude'],
                'decimal': f"{parsed['latitude']}, {parsed['longitude']}",
            },
        })
        seen_coordinate_keys.add(dedupe_key)

    exif_info = _extract_image_metadata_items(image_info.get('image_urls') or [])
    image_details_by_url = {
        str(detail.get('image_url') or ''): detail
        for detail in (exif_info.get('image_details') or [])
        if isinstance(detail, dict) and str(detail.get('image_url') or '')
    }
    for item in exif_info.get('items') or []:
        if not isinstance(item, dict):
            continue
        register_image_item(
            source=str(item.get('source') or 'image_exif_text'),
            reason=str(item.get('reason') or 'EXIF'),
            text=str(item.get('text') or ''),
            image_url=str(item.get('image_url') or ''),
            confidence=item.get('confidence') if isinstance(item.get('confidence'), (int, float)) else None,
        )
    for coordinate in exif_info.get('coordinate_candidates') or []:
        if not isinstance(coordinate, dict):
            continue
        register_coordinate_candidate(
            coordinate.get('coordinates'),
            source=str(coordinate.get('source') or 'image_exif_gps'),
            image_url=str(coordinate.get('image_url') or ''),
            confidence=coordinate.get('confidence') if isinstance(coordinate.get('confidence'), (int, float)) else None,
        )
    plugin_summaries.extend(
        str(summary).strip()
        for summary in (exif_info.get('summaries') or [])
        if str(summary).strip()
    )

    geocache_id = listing_inputs.get('geocache_id')
    explicit_images = listing_inputs.get('images') or []
    if include_plugin_runs and (geocache_id is not None or explicit_images):
        manager = get_plugin_manager()
        base_inputs = {
            'geocache_id': geocache_id,
            'images': explicit_images,
        }

        qr_result = manager.execute_plugin('qr_code_detector', base_inputs)
        qr_summary = str((qr_result or {}).get('summary') or '').strip()
        if qr_summary:
            plugin_summaries.append(f"qr_code_detector: {qr_summary}")
        for item in (qr_result or {}).get('results') or []:
            if not isinstance(item, dict):
                continue
            text_output = str(item.get('text_output') or '').strip()
            image_url = str(item.get('image_url') or '').strip()
            confidence = item.get('confidence')
            barcode_type = str(item.get('barcode_type') or '').strip().upper()
            is_barcode = bool(barcode_type and barcode_type not in {'QRCODE', 'QR'})
            if text_output:
                register_image_item(
                    source='image_barcode_text' if is_barcode else 'image_qr_text',
                    reason=f'Texte decode depuis un code-barres {barcode_type}' if is_barcode else 'Texte decode depuis un QR code',
                    text=text_output,
                    image_url=image_url,
                    confidence=confidence if isinstance(confidence, (int, float)) else None,
                )
                register_coordinate_candidate(
                    text_output,
                    source='image_barcode_text' if is_barcode else 'image_qr_text',
                    image_url=image_url,
                    confidence=confidence if isinstance(confidence, (int, float)) else None,
                )
            register_coordinate_candidate(
                item.get('coordinates'),
                source='image_barcode_text' if is_barcode else 'image_qr_text',
                image_url=image_url,
                confidence=confidence if isinstance(confidence, (int, float)) else None,
            )
        register_coordinate_candidate(
            (qr_result or {}).get('coordinates') or (qr_result or {}).get('primary_coordinates'),
            source='image_qr_text',
        )

        ocr_result = manager.execute_plugin('easyocr_ocr', base_inputs)
        ocr_summary = str((ocr_result or {}).get('summary') or '').strip()
        if ocr_summary:
            plugin_summaries.append(f"easyocr_ocr: {ocr_summary}")
        for item in (ocr_result or {}).get('results') or []:
            if not isinstance(item, dict):
                continue
            text_output = str(item.get('text_output') or '').strip()
            if not text_output:
                continue
            image_url = str(item.get('image_url') or '').strip()
            confidence = item.get('confidence')
            register_image_item(
                source='image_ocr_text',
                reason='Texte OCR extrait d une image',
                text=text_output,
                image_url=image_url,
                confidence=confidence if isinstance(confidence, (int, float)) else None,
            )
            register_coordinate_candidate(
                text_output,
                source='image_ocr_text',
                image_url=image_url,
                confidence=confidence if isinstance(confidence, (int, float)) else None,
            )

        has_machine_readable_hits = any(
            str(item.get('source') or '') in {'image_qr_text', 'image_barcode_text', 'image_ocr_text'}
            for item in image_items
        )
        if not has_machine_readable_hits:
            if max_vision_ocr_cost_units > 0:
                limited_image_urls: List[str] = []
                total_image_urls = image_info.get('image_urls') or []
                for raw_url in total_image_urls:
                    normalized_url = _normalize_remote_image_url(raw_url)
                    detail = image_details_by_url.get(normalized_url) or image_details_by_url.get(raw_url) or {}
                    cost_units = _estimate_vision_ocr_cost_units(detail)
                    if vision_ocr_budget_cost + cost_units > max_vision_ocr_cost_units:
                        continue
                    limited_image_urls.append(raw_url)
                    vision_ocr_budget_cost += cost_units
                if not limited_image_urls and total_image_urls:
                    plugin_summaries.append('vision_ocr skipped: aucune image ne rentre dans le budget OCR vision restant.')
                if limited_image_urls:
                    vision_inputs = {
                        'images': [{'url': url} for url in limited_image_urls],
                    }
                    if geocache_id is not None:
                        vision_inputs['geocache_id'] = geocache_id
                    if len(limited_image_urls) < len(total_image_urls):
                        plugin_summaries.append(
                            f"vision_ocr limited: {len(limited_image_urls)} image(s) analysee(s) sur {len(total_image_urls)} a cause du budget ({vision_ocr_budget_cost}/{max_vision_ocr_cost_units})."
                        )
                    vision_result = manager.execute_plugin('vision_ocr', vision_inputs)
                    vision_summary = str((vision_result or {}).get('summary') or '').strip()
                    if vision_summary:
                        plugin_summaries.append(f"vision_ocr: {vision_summary}")
                    try:
                        vision_ocr_images_analyzed = max(
                            vision_ocr_images_analyzed,
                            int((vision_result or {}).get('images_analyzed') or 0),
                        )
                    except (TypeError, ValueError):
                        vision_ocr_images_analyzed = max(vision_ocr_images_analyzed, 0)
                    for item in (vision_result or {}).get('results') or []:
                        if not isinstance(item, dict):
                            continue
                        text_output = str(item.get('text_output') or '').strip()
                        if not text_output:
                            continue
                        image_url = str(item.get('image_url') or '').strip()
                        confidence = item.get('confidence')
                        register_image_item(
                            source='image_vision_text',
                            reason='Texte OCR vision extrait d une image',
                            text=text_output,
                            image_url=image_url,
                            confidence=confidence if isinstance(confidence, (int, float)) else None,
                        )
                        register_coordinate_candidate(
                            text_output,
                            source='image_vision_text',
                            image_url=image_url,
                            confidence=confidence if isinstance(confidence, (int, float)) else None,
                        )
                    has_vision_ocr_hits = any(
                        str(item.get('source') or '') == 'image_vision_text'
                        for item in image_items
                    )
                    if not has_vision_ocr_hits:
                        describe_result = manager.execute_plugin('vision_describe', vision_inputs)
                        describe_summary = str((describe_result or {}).get('summary') or '').strip()
                        if describe_summary:
                            plugin_summaries.append(f"vision_describe: {describe_summary}")
                        for item in (describe_result or {}).get('results') or []:
                            if not isinstance(item, dict):
                                continue
                            text_output = str(item.get('text_output') or '').strip()
                            if not text_output:
                                continue
                            image_url = str(item.get('image_url') or '').strip()
                            confidence = item.get('confidence')
                            register_image_item(
                                source='image_vision_description',
                                reason='Description visuelle IA (conte, scene, personnage identifie)',
                                text=text_output,
                                image_url=image_url,
                                confidence=confidence if isinstance(confidence, (int, float)) else None,
                            )
            else:
                plugin_summaries.append('vision_ocr skipped: budget OCR vision epuise.')

    candidate_secret_fragments = _extract_secret_fragments(
        title='',
        description='',
        hint='',
        waypoint_text='',
        hidden_comments=[],
        hidden_texts=[],
        supplemental_text_sources=[
            {
                'text': str(item.get('text') or ''),
                'source_name': str(item.get('source') or 'image_text'),
                'source_kind': 'image_analysis',
            }
            for item in image_items
            if str(item.get('text') or '').strip()
        ],
        max_fragments=max_secret_fragments,
    )
    selected_fragment = candidate_secret_fragments[0] if candidate_secret_fragments else None

    recommendation = None
    if selected_fragment and isinstance(selected_fragment, dict):
        fragment_text = str(selected_fragment.get('text') or '').strip()
        if fragment_text:
            recommendation = _recommend_metasolver_plugins_response(
                text=fragment_text,
                requested_preset=(str(data.get('metasolver_preset') or '')).strip().lower(),
                mode=(str(data.get('metasolver_mode') or 'decode')).strip().lower(),
                max_plugins=max_plugins,
            )

    best_coordinate_candidate: Optional[Dict[str, Any]] = None
    best_plausibility: Optional[Dict[str, Any]] = None
    best_coordinate_score = -1.0
    for candidate in coordinate_candidates:
        plausibility = _build_geographic_plausibility(candidate.get('coordinates'), listing_inputs)
        score = float((plausibility or {}).get('score') or 0.0)
        if score > best_coordinate_score:
            best_coordinate_score = score
            best_coordinate_candidate = candidate
            best_plausibility = plausibility

    summary_parts: List[str] = []
    image_count = int(image_info.get('image_count') or 0)
    if image_count:
        summary_parts.append(f"{image_count} image(s) reperee(s)")
    if image_items:
        summary_parts.append(f"{len(image_items)} indice(s) image extrait(s)")
    if selected_fragment:
        summary_parts.append(f"Fragment principal: {str(selected_fragment.get('text') or '')[:60]}")
    if best_plausibility:
        summary_parts.append(
            f"Plausibilite geo: {str(best_plausibility.get('status') or 'unknown')} {(float(best_plausibility.get('score') or 0.0) * 100):.0f}%"
        )
    if plugin_summaries and not selected_fragment:
        summary_parts.append(plugin_summaries[0])
    summary = ' | '.join(summary_parts) or 'Aucun indice image exploitable extrait.'

    return {
        'inspected': bool(inspected),
        'image_count': image_count,
        'image_urls': image_info.get('image_urls') or [],
        'items': image_items[:12],
        'candidate_secret_fragments': candidate_secret_fragments,
        'selected_fragment': selected_fragment,
        'recommendation': recommendation,
        'plugin_summaries': plugin_summaries[:6],
        'vision_ocr_images_analyzed': vision_ocr_images_analyzed,
        'vision_ocr_budget_cost': vision_ocr_budget_cost,
        'coordinates_candidate': (best_coordinate_candidate or {}).get('coordinates') if best_coordinate_candidate else None,
        'geographic_plausibility': best_plausibility,
        'summary': summary,
    }


def _label_confidence(raw_score: float, *, max_score: float = 100.0) -> float:
    bounded = min(max(raw_score, 0.0), max_score)
    return round(min(0.99, max(0.05, bounded / max_score)), 3)


def _build_listing_classification(
    *,
    title: str,
    description: str,
    description_html: str,
    hint: str,
    waypoint_text: str,
    images: Any,
    checker_count: int,
    waypoint_count: int,
    max_secret_fragments: int,
) -> Dict[str, Any]:
    hidden_info = _extract_hidden_content_signals(description_html)
    hidden_signals = hidden_info.get('signals') or []
    hidden_comments = hidden_info.get('comments') or []
    hidden_texts = hidden_info.get('hidden_texts') or []
    image_info = _extract_image_listing_items(description_html, images)
    image_count = int(image_info.get('image_count') or 0)
    image_items = image_info.get('items') or []
    image_hint_count = len(image_items)
    image_hint_sources = list(dict.fromkeys(
        str(item.get('source') or '')
        for item in image_items
        if str(item.get('source') or '')
    ))[:6]

    combined_text = '\n'.join(part for part in (title, description, hint, waypoint_text) if part).strip()
    combined_lower = combined_text.lower()
    has_pi_theme = _contains_pi_theme(title, description, hint, waypoint_text)
    pi_coordinate_sequences = _extract_pi_coordinate_position_sequences(description, hint, waypoint_text, title)
    pi_position_token_count = int((pi_coordinate_sequences or {}).get('total_positions') or 0)
    pi_coordinate_axes = list((pi_coordinate_sequences or {}).get('axes') or [])

    secret_fragments = _extract_secret_fragments(
        title=title,
        description=description,
        hint=hint,
        waypoint_text=waypoint_text,
        hidden_comments=hidden_comments,
        hidden_texts=hidden_texts,
        hidden_text_items=hidden_info.get('hidden_text_items') or [],
        supplemental_text_sources=[
            {
                'text': str(item.get('text') or ''),
                'source_name': str(item.get('source') or 'image_text'),
                'source_kind': 'image_listing',
            }
            for item in image_items
            if str(item.get('text') or '').strip()
        ],
        max_fragments=max_secret_fragments,
    )

    labels: List[Dict[str, Any]] = []
    formula_signals: List[str] = []

    formula_keywords = (
        r'\b(formula|formule|equation|projection|project|coord(?:onnee|onnee|onn|inate)s?|variable|variables|solve|solver|calcul|calcule|calculate)\b'
    )
    word_game_keywords = (
        r'\b(sudoku|crossword|mot croise|mots croises|anagram|word search|cryptogram|hangman|mastermind|nonogram|wordle|scrabble)\b'
    )
    image_keywords = (
        r'\b(image|photo|picture|visual|visuel|qr|barcode|ocr|stegano|steganography|jigsaw|puzzle)\b'
    )
    visual_image_action_keywords = (
        r'\b(inspect|observe|spot|compare|count|zoom|rotate|mirror|flip|colour|color|shape|symbol|pattern|pixel)\b'
    )
    code_keywords = (
        r'\b(code|cipher|decode|decrypt|crypt|enigme|secret|morse|alphabet|substitution|transposition)\b'
    )
    coord_keywords = (
        r'\b(coord(?:onnee|onnee|onn|inate)s?|projection|bearing|distance|waypoint|final|offset|azimuth)\b'
    )
    projection_keywords = (
        r'\b(projection|bearing|distance|waypoint|final|offset|azimuth)\b'
    )

    variable_assignments = re.findall(r'\b[A-Z]{1,3}\s*=\s*[-+*/()0-9A-Z ]{1,40}', combined_text)
    projection_keyword_matches = re.findall(projection_keywords, combined_lower, flags=re.IGNORECASE)
    visual_image_action_matches = re.findall(visual_image_action_keywords, combined_lower, flags=re.IGNORECASE)
    strongest_fragment = secret_fragments[0] if secret_fragments else {}
    strongest_fragment_confidence = float((strongest_fragment or {}).get('confidence') or 0.0)
    strongest_fragment_source = str((strongest_fragment or {}).get('source') or '').strip()
    direct_fragments = [
        fragment for fragment in secret_fragments
        if str((fragment or {}).get('source') or '').strip() in DIRECT_SECRET_FRAGMENT_SOURCES
    ]
    hidden_fragments = [
        fragment for fragment in secret_fragments
        if str((fragment or {}).get('source') or '').strip() in HIDDEN_SECRET_FRAGMENT_SOURCES
    ]
    image_fragments = [
        fragment for fragment in secret_fragments
        if str((fragment or {}).get('source') or '').strip() in IMAGE_SECRET_FRAGMENT_SOURCES
    ]
    best_direct_fragment = direct_fragments[0] if direct_fragments else {}
    best_hidden_fragment = hidden_fragments[0] if hidden_fragments else {}
    best_image_fragment = image_fragments[0] if image_fragments else {}
    image_structured_fragment_count = sum(
        1
        for fragment in secret_fragments
        if str((fragment or {}).get('source') or '').strip() in IMAGE_SECRET_FRAGMENT_SOURCES
    )
    hidden_structured_fragment_count = len(hidden_fragments)
    direct_structured_fragment_count = len(direct_fragments)
    has_visual_only_image_clue = bool(
        image_count > 0
        and visual_image_action_matches
        and image_structured_fragment_count == 0
        and strongest_fragment_confidence < 0.72
    )
    if variable_assignments:
        formula_signals.append(f"{len(variable_assignments)} variable assignment(s) detected")
    if re.search(formula_keywords, combined_lower, flags=re.IGNORECASE):
        formula_signals.append("Formula or coordinate keywords detected")
    if re.search(r'\b[NS]\s*\d', combined_text, flags=re.IGNORECASE) and re.search(r'[A-Z]\s*[+\-*/=]', combined_text):
        formula_signals.append("Coordinate pattern mixed with variables detected")
    has_formula_coordinate_placeholders = (
        bool(re.search(r'\b[NS]\s*\d{1,2}[^.\n]{0,24}\.[A-Z0-9()]{2,}', combined_text, flags=re.IGNORECASE))
        and bool(re.search(r'\b[EW]\s*\d{1,3}[^.\n]{0,24}\.[A-Z0-9()]{2,}', combined_text, flags=re.IGNORECASE))
    )
    if has_formula_coordinate_placeholders:
        formula_signals.append("Coordinate formula placeholders detected")

    formula_score = 0.0
    formula_score += 30.0 if variable_assignments else 0.0
    formula_score += 24.0 if re.search(formula_keywords, combined_lower, flags=re.IGNORECASE) else 0.0
    formula_score += 30.0 if re.search(r'\b[NS]\s*\d', combined_text, flags=re.IGNORECASE) and re.search(r'[A-Z]\s*[+\-*/=]', combined_text) else 0.0
    formula_score += 24.0 if has_formula_coordinate_placeholders else 0.0
    if formula_score >= 28.0:
        labels.append({
            'name': 'formula',
            'confidence': _label_confidence(formula_score),
            'evidence': formula_signals[:4],
            'suggested_next_step': LISTING_CLASSIFICATION_ACTIONS['formula'],
        })

    hidden_score = 24.0 * len(hidden_signals) + (12.0 if hidden_comments else 0.0)
    if hidden_score >= 24.0:
        labels.append({
            'name': 'hidden_content',
            'confidence': _label_confidence(hidden_score),
            'evidence': hidden_signals[:4] or ["Suspicious hidden HTML markers detected"],
            'suggested_next_step': LISTING_CLASSIFICATION_ACTIONS['hidden_content'],
        })

    secret_score = 0.0
    secret_evidence: List[str] = []
    if secret_fragments:
        secret_score += strongest_fragment.get('score', 0.0)
        secret_evidence.append(
            f"Structured fragment detected in {strongest_fragment.get('source')}: {strongest_fragment.get('text')[:60]}"
        )
    if has_pi_theme and pi_position_token_count:
        secret_score += 30.0
        secret_evidence.append(
            f"Theme Pi detecte avec {pi_position_token_count} positions indexees sur les axes {'/'.join(pi_coordinate_axes or ['listing'])}"
        )
    if re.search(code_keywords, combined_lower, flags=re.IGNORECASE):
        secret_score += 18.0
        secret_evidence.append("Code / cipher vocabulary detected")
    if hint and len(hint.strip()) <= 96 and secret_fragments:
        secret_score += 8.0
        secret_evidence.append("The hint contains a compact candidate fragment")
    if (
        has_visual_only_image_clue
        and strongest_fragment_source in DIRECT_SECRET_FRAGMENT_SOURCES
        and strongest_fragment_confidence < 0.72
    ):
        secret_score -= 14.0
        secret_evidence.append("Visual image inspection cues dominate over the weak visible fragment")
    if secret_score >= 32.0:
        labels.append({
            'name': 'secret_code',
            'confidence': _label_confidence(secret_score),
            'evidence': secret_evidence[:4],
            'suggested_next_step': LISTING_CLASSIFICATION_ACTIONS['secret_code'],
        })

    word_game_score = 35.0 if re.search(word_game_keywords, combined_lower, flags=re.IGNORECASE) else 0.0
    if word_game_score:
        labels.append({
            'name': 'word_game',
            'confidence': _label_confidence(word_game_score),
            'evidence': ["Word-game keywords detected in the listing"],
            'suggested_next_step': LISTING_CLASSIFICATION_ACTIONS['word_game'],
        })

    image_score = 0.0
    image_evidence: List[str] = []
    if image_count > 0:
        image_score += min(40.0, 12.0 + 6.0 * image_count)
        image_evidence.append(f"{image_count} image(s) attached to the listing")
    if image_hint_count > 0:
        image_score += min(24.0, 8.0 + 4.0 * image_hint_count)
        image_evidence.append(f"{image_hint_count} indice(s) image textuel(s) extrait(s)")
    if '<img' in (description_html or '').lower():
        image_score += 12.0
        image_evidence.append("Inline image tags detected in listing HTML")
    if re.search(image_keywords, combined_lower, flags=re.IGNORECASE):
        image_score += 18.0
        image_evidence.append("Image / OCR / QR vocabulary detected")
    if has_visual_only_image_clue:
        image_score += 18.0
        image_evidence.append("Visual inspection cues detected even without extracted image text")
    if image_score >= 24.0:
        labels.append({
            'name': 'image_puzzle',
            'confidence': _label_confidence(image_score),
            'evidence': image_evidence[:4],
            'suggested_next_step': LISTING_CLASSIFICATION_ACTIONS['image_puzzle'],
        })

    coord_score = 0.0
    coord_evidence: List[str] = []
    if re.search(coord_keywords, combined_lower, flags=re.IGNORECASE):
        coord_score += 26.0
        coord_evidence.append("Coordinate / projection vocabulary detected")
    if waypoint_count > 0:
        coord_score += min(18.0, 6.0 + waypoint_count * 3.0)
        coord_evidence.append(f"{waypoint_count} waypoint(s) available")
    if re.search(r'\b[NS]\s*\d', combined_text, flags=re.IGNORECASE):
        coord_score += 16.0
        coord_evidence.append("Coordinate-like fragments detected")
    if formula_score >= 28.0:
        coord_score += 12.0
        coord_evidence.append("Formula clues are tied to coordinates")
    if coord_score >= 28.0:
        labels.append({
            'name': 'coord_transform',
            'confidence': _label_confidence(coord_score),
            'evidence': coord_evidence[:4],
            'suggested_next_step': LISTING_CLASSIFICATION_ACTIONS['coord_transform'],
        })

    if checker_count > 0:
        labels.append({
            'name': 'checker_available',
            'confidence': _label_confidence(min(100.0, 36.0 + checker_count * 10.0)),
            'evidence': [f"{checker_count} checker(s) linked to the geocache"],
            'suggested_next_step': LISTING_CLASSIFICATION_ACTIONS['checker_available'],
        })

    direct_domain_score = 0.0
    if best_direct_fragment:
        direct_domain_score += float(best_direct_fragment.get('score') or 0.0)
    if has_pi_theme and pi_position_token_count:
        direct_domain_score += 30.0
    if re.search(code_keywords, combined_lower, flags=re.IGNORECASE):
        direct_domain_score += 18.0
    if hint and len(hint.strip()) <= 96 and best_direct_fragment:
        direct_domain_score += 8.0
    if (
        has_visual_only_image_clue
        and str((best_direct_fragment or {}).get('source') or '').strip() in DIRECT_SECRET_FRAGMENT_SOURCES
        and float((best_direct_fragment or {}).get('confidence') or 0.0) < 0.72
    ):
        direct_domain_score -= 14.0

    hidden_domain_score = float(hidden_score)
    if best_hidden_fragment:
        hidden_domain_score += float(best_hidden_fragment.get('score') or 0.0) * 0.75

    image_domain_score = float(image_score)
    if best_image_fragment:
        image_domain_score += float(best_image_fragment.get('score') or 0.0) * 0.75

    domain_scores = {
        'direct': round(max(0.0, direct_domain_score), 2),
        'hidden': round(max(0.0, hidden_domain_score), 2),
        'image': round(max(0.0, image_domain_score), 2),
    }
    sorted_domain_scores = sorted(domain_scores.items(), key=lambda item: (-item[1], item[0]))
    dominant_evidence_domain = sorted_domain_scores[0][0] if sorted_domain_scores and sorted_domain_scores[0][1] > 0 else None
    second_domain_score = sorted_domain_scores[1][1] if len(sorted_domain_scores) > 1 else 0.0
    evidence_domain_gap = round(max(0.0, float(sorted_domain_scores[0][1] if sorted_domain_scores else 0.0) - float(second_domain_score)), 2)
    hybrid_domain_count = sum(1 for score in domain_scores.values() if float(score) >= 24.0)
    is_hybrid_listing = hybrid_domain_count >= 2
    ambiguous_domains = [
        domain
        for domain, score in sorted_domain_scores
        if float(score) >= 24.0 and dominant_evidence_domain and (float(domain_scores.get(dominant_evidence_domain) or 0.0) - float(score)) < 10.0
    ]
    is_ambiguous_hybrid = is_hybrid_listing and len(ambiguous_domains) >= 2 and evidence_domain_gap < 10.0

    labels.sort(key=lambda item: (-item['confidence'], item['name']))

    recommended_actions: List[str] = []
    for item in labels:
        action = item.get('suggested_next_step')
        if action and action not in recommended_actions:
            recommended_actions.append(action)

    return {
        'labels': labels,
        'recommended_actions': recommended_actions[:5],
        'candidate_secret_fragments': secret_fragments,
        'hidden_signals': hidden_signals[:6],
        'formula_signals': formula_signals[:6],
        'signal_summary': {
            'has_title': bool(title),
            'has_hint': bool(hint),
            'has_description_html': bool(description_html),
            'has_pi_theme': has_pi_theme,
            'pi_position_token_count': pi_position_token_count,
            'pi_coordinate_axes': pi_coordinate_axes,
            'image_count': image_count,
            'image_hint_count': image_hint_count,
            'image_hint_sources': image_hint_sources,
            'checker_count': checker_count,
            'waypoint_count': waypoint_count,
            'formula_signal_count': len(formula_signals),
            'variable_assignment_count': len(variable_assignments),
            'has_formula_coordinate_placeholders': has_formula_coordinate_placeholders,
            'projection_keyword_count': len(projection_keyword_matches),
            'visual_image_signal_count': len(visual_image_action_matches),
            'direct_structured_fragment_count': direct_structured_fragment_count,
            'hidden_structured_fragment_count': hidden_structured_fragment_count,
            'image_structured_fragment_count': image_structured_fragment_count,
            'direct_domain_score': domain_scores['direct'],
            'hidden_domain_score': domain_scores['hidden'],
            'image_domain_score': domain_scores['image'],
            'dominant_evidence_domain': dominant_evidence_domain,
            'evidence_domain_gap': evidence_domain_gap,
            'hybrid_domain_count': hybrid_domain_count,
            'is_hybrid_listing': is_hybrid_listing,
            'ambiguous_domains': ambiguous_domains,
            'is_ambiguous_hybrid': is_ambiguous_hybrid,
            'has_visual_only_image_clue': has_visual_only_image_clue,
            'hidden_signal_count': len(hidden_signals),
            'hidden_comment_count': len(hidden_comments),
            'hidden_text_count': len(hidden_texts),
            'secret_fragment_count': len(secret_fragments),
            'best_secret_fragment_source': (secret_fragments[0] or {}).get('source') if secret_fragments else None,
            'best_secret_fragment_confidence': float((secret_fragments[0] or {}).get('confidence') or 0.0) if secret_fragments else 0.0,
        },
    }


def _serialize_geocache_listing(geocache: Geocache) -> Dict[str, Any]:
    decoded_hint = geocache.hints_decoded_override or geocache.hints_decoded
    if decoded_hint is None and geocache.hints:
        decoded_hint = Geocache.decode_hint_rot13(geocache.hints)

    description_raw = geocache.description_override_raw or geocache.description_raw or ''
    description_html = geocache.description_override_html or geocache.description_html or ''
    images = geocache.images or []
    waypoints = [waypoint.to_dict() for waypoint in (geocache.waypoints or [])]
    checkers = [checker.to_dict() for checker in (geocache.checkers or [])]

    return {
        'title': geocache.name or '',
        'description': description_raw or _clean_listing_text(description_html, preserve_lines=True),
        'description_html': description_html,
        'hint': decoded_hint or '',
        'waypoints': waypoints,
        'checkers': checkers,
        'images': images,
        'metadata': {
            'id': geocache.id,
            'gc_code': geocache.gc_code,
            'name': geocache.name,
        },
    }


def _load_listing_analysis_inputs(data: Dict[str, Any]) -> Dict[str, Any]:
    geocache_id = data.get('geocache_id')
    source = 'direct_input'
    metadata: Dict[str, Any] | None = None
    geocache_record: Optional[Geocache] = None

    if geocache_id is not None:
        try:
            geocache_id = int(geocache_id)
        except (TypeError, ValueError):
            raise ValueError("Le champ 'geocache_id' doit etre un entier")

        geocache_record = Geocache.query.get(geocache_id)
        if not geocache_record:
            raise LookupError(f"Aucune geocache avec l'id {geocache_id}")

        payload = _serialize_geocache_listing(geocache_record)
        source = 'geocache'
        metadata = payload.pop('metadata', None)

        for field in ('title', 'description', 'description_html', 'hint'):
            override_value = data.get(field)
            if isinstance(override_value, str) and override_value.strip():
                payload[field] = override_value
    else:
        payload = {
            'title': data.get('title') or '',
            'description': data.get('description') or '',
            'description_html': data.get('description_html') or '',
            'hint': data.get('hint') or '',
            'waypoints': data.get('waypoints') if isinstance(data.get('waypoints'), list) else [],
            'checkers': data.get('checkers') if isinstance(data.get('checkers'), list) else [],
            'images': data.get('images') if isinstance(data.get('images'), list) else [],
        }

    title = _clean_listing_text(payload.get('title'), preserve_lines=False)
    description = _clean_listing_text(payload.get('description'), preserve_lines=True)
    description_html = str(payload.get('description_html') or '')
    if not description and description_html:
        description = _clean_listing_text(description_html, preserve_lines=True)
    hint = _clean_listing_text(payload.get('hint'), preserve_lines=False)
    waypoints = payload.get('waypoints') or []
    checkers = payload.get('checkers') or []
    images = payload.get('images') or []
    waypoint_text = _clean_listing_text(_collect_waypoint_listing_text(waypoints), preserve_lines=True)

    if not any((title, description, description_html, hint, waypoint_text)) and not images:
        raise ValueError("Fournissez au moins un contenu de listing, des images ou un geocache_id")

    return {
        'source': source,
        'metadata': metadata,
        'geocache_id': geocache_id if isinstance(geocache_id, int) else None,
        'geocache_record': geocache_record,
        'title': title,
        'description': description,
        'description_html': description_html,
        'hint': hint,
        'waypoints': waypoints,
        'checkers': checkers,
        'images': images,
        'waypoint_text': waypoint_text,
    }


def _build_listing_classification_response(listing_inputs: Dict[str, Any], max_secret_fragments: int) -> Dict[str, Any]:
    classification = _build_listing_classification(
        title=listing_inputs.get('title') or '',
        description=listing_inputs.get('description') or '',
        description_html=listing_inputs.get('description_html') or '',
        hint=listing_inputs.get('hint') or '',
        waypoint_text=listing_inputs.get('waypoint_text') or '',
        images=listing_inputs.get('images') or [],
        checker_count=len(listing_inputs.get('checkers') or []),
        waypoint_count=len(listing_inputs.get('waypoints') or []),
        max_secret_fragments=max_secret_fragments,
    )

    return {
        'source': listing_inputs.get('source') or 'direct_input',
        'geocache': listing_inputs.get('metadata'),
        'title': listing_inputs.get('title') or None,
        'max_secret_fragments': max_secret_fragments,
        **classification,
    }


def _recommend_metasolver_plugins_response(
    *,
    text: str,
    requested_preset: str = '',
    mode: str = 'decode',
    max_plugins: int = 8,
) -> Dict[str, Any]:
    return recommend_metasolver_plugins(
        manager=get_plugin_manager(),
        text=text,
        requested_preset=requested_preset,
        mode=mode,
        max_plugins=max_plugins,
    )


def _extract_plugin_summary_text(summary: Any) -> str:
    if isinstance(summary, dict):
        for key in ('message', 'summary', 'status'):
            value = str(summary.get(key) or '').strip()
            if value:
                return value
        return ''
    return str(summary or '').strip()


def _summarize_direct_plugin_result(
    plugin_name: str,
    result: Dict[str, Any],
    *,
    limit: int = 5,
) -> Dict[str, Any]:
    raw_results = result.get('results') or []
    top_results: List[Dict[str, Any]] = []
    for item in raw_results[:limit]:
        if not isinstance(item, dict):
            continue
        top_results.append({
            'text_output': item.get('text_output'),
            'coordinates': item.get('coordinates'),
            'confidence': item.get('confidence'),
            'method': item.get('method'),
            'plugin': item.get('plugin') or item.get('source_plugin') or plugin_name,
        })

    coordinates = result.get('coordinates') or result.get('primary_coordinates')
    if not coordinates:
        for item in top_results:
            if item.get('coordinates'):
                coordinates = item.get('coordinates')
                break

    summary_text = _extract_plugin_summary_text(result.get('summary'))
    if not summary_text and top_results:
        summary_text = f"{len(top_results)} resultat(s)"
    if not summary_text:
        summary_text = str(result.get('status') or 'plugin executed')

    return {
        'plugin_name': plugin_name,
        'status': result.get('status'),
        'summary': summary_text,
        'results_count': len(raw_results),
        'top_results': top_results,
        'coordinates': coordinates,
    }


def _direct_plugin_result_succeeded(result: Any) -> bool:
    if not isinstance(result, dict):
        return False
    status = str(result.get('status') or '').strip().lower()
    return status in {'success', 'ok', 'valid'} and int(result.get('results_count') or 0) > 0


def _build_secret_code_direct_plugin_candidate(
    listing_inputs: Dict[str, Any],
    classification: Dict[str, Any],
    recommendation: Optional[Dict[str, Any]] = None,
) -> Optional[Dict[str, Any]]:
    signal_summary = classification.get('signal_summary') if isinstance(classification.get('signal_summary'), dict) else {}
    if not bool(signal_summary.get('has_pi_theme')):
        return None

    sequences = _extract_pi_coordinate_position_sequences(
        listing_inputs.get('description') or '',
        listing_inputs.get('hint') or '',
        listing_inputs.get('waypoint_text') or '',
        listing_inputs.get('title') or '',
    )
    if not sequences:
        return None

    manager = get_plugin_manager()
    plugin_info = manager.get_plugin_info('pi_digits') or {}
    if not plugin_info or not bool(plugin_info.get('enabled', True)):
        return None

    axes = [str(item or '').strip() for item in (sequences.get('axes') or []) if str(item or '').strip()]
    confidence = 0.84
    if axes and {'N', 'E'}.issubset(set(axes)):
        confidence += 0.09
    if PI_THEME_PATTERN.search(str(listing_inputs.get('title') or '')):
        confidence += 0.04
    confidence = round(min(0.99, confidence), 3)

    fallback_plugin_list = list((recommendation or {}).get('selected_plugins') or [])
    if 'pi_digits' not in fallback_plugin_list:
        fallback_plugin_list.insert(0, 'pi_digits')

    return {
        'plugin_name': 'pi_digits',
        'confidence': confidence,
        'reason': (
            "Theme Pi detecte avec une sequence de positions indexees "
            + ('/'.join(axes) if axes else 'dans le listing')
            + "."
        ),
        'source_kind': 'pi_index_positions',
        'source_text': str(sequences.get('source_text') or ''),
        'should_run_directly': confidence >= 0.9,
        'plugin_inputs': {
            'text': str(sequences.get('source_text') or ''),
            'mode': 'decode',
            'format': 'digits_only',
        },
        'axes': axes,
        'position_count': int(sequences.get('total_positions') or 0),
        'fallback_plugin_list': fallback_plugin_list,
    }


def _execute_direct_plugin_candidate(candidate: Dict[str, Any]) -> Dict[str, Any]:
    plugin_name = str(candidate.get('plugin_name') or '').strip()
    plugin_inputs = candidate.get('plugin_inputs') if isinstance(candidate.get('plugin_inputs'), dict) else {}
    raw_result = get_plugin_manager().execute_plugin(plugin_name, plugin_inputs)
    return _summarize_direct_plugin_result(plugin_name, raw_result or {})


def _normalize_workflow_kind(value: Any) -> Optional[str]:
    normalized = str(value or '').strip().lower()
    if normalized in {'general', 'secret_code', 'formula', 'checker', 'hidden_content', 'image_puzzle', 'coord_transform'}:
        return normalized
    return None


IMAGE_SECRET_FRAGMENT_SOURCES = frozenset({
    'image_alt_text',
    'image_title_text',
    'image_filename_text',
    'image_ocr_text',
    'image_vision_text',
    'image_barcode_text',
    'image_exif_text',
    'image_qr_text',
})

HIDDEN_SECRET_FRAGMENT_SOURCES = frozenset({
    'html_comment',
    'hidden_html_text',
    'hidden_css_text',
})

DIRECT_SECRET_FRAGMENT_SOURCES = frozenset({
    'title',
    'hint',
    'description',
    'waypoints',
})


def _build_workflow_candidates(classification: Dict[str, Any]) -> List[Dict[str, Any]]:
    label_map = {
        item.get('name'): item
        for item in (classification.get('labels') or [])
        if isinstance(item, dict) and item.get('name')
    }
    signal_summary = classification.get('signal_summary') if isinstance(classification.get('signal_summary'), dict) else {}
    best_secret_fragment = (classification.get('candidate_secret_fragments') or [None])[0] or {}
    best_fragment_confidence = float(signal_summary.get('best_secret_fragment_confidence') or best_secret_fragment.get('confidence') or 0.0)
    best_fragment_source = str(signal_summary.get('best_secret_fragment_source') or best_secret_fragment.get('source') or '').strip()
    hidden_signal_count = int(signal_summary.get('hidden_signal_count') or len(classification.get('hidden_signals') or []))
    hidden_fragment_count = sum(
        1
        for fragment in (classification.get('candidate_secret_fragments') or [])
        if str((fragment or {}).get('source') or '') in {'html_comment', 'hidden_html_text', 'hidden_css_text'}
    )
    image_hint_count = int(signal_summary.get('image_hint_count') or 0)
    image_hint_sources = {
        str(source or '').strip()
        for source in (signal_summary.get('image_hint_sources') or [])
        if str(source or '').strip()
    }
    formula_signal_count = int(signal_summary.get('formula_signal_count') or len(classification.get('formula_signals') or []))
    variable_assignment_count = int(signal_summary.get('variable_assignment_count') or 0)
    has_formula_coordinate_placeholders = bool(signal_summary.get('has_formula_coordinate_placeholders'))
    projection_keyword_count = int(signal_summary.get('projection_keyword_count') or 0)
    visual_image_signal_count = int(signal_summary.get('visual_image_signal_count') or 0)
    has_pi_theme = bool(signal_summary.get('has_pi_theme'))
    pi_position_token_count = int(signal_summary.get('pi_position_token_count') or 0)
    pi_coordinate_axes = [
        str(item or '').strip()
        for item in (signal_summary.get('pi_coordinate_axes') or [])
        if str(item or '').strip()
    ]
    dominant_evidence_domain = str(signal_summary.get('dominant_evidence_domain') or '').strip()
    evidence_domain_gap = float(signal_summary.get('evidence_domain_gap') or 0.0)
    is_hybrid_listing = bool(signal_summary.get('is_hybrid_listing'))
    is_ambiguous_hybrid = bool(signal_summary.get('is_ambiguous_hybrid'))
    ambiguous_domains = [
        str(item or '').strip()
        for item in (signal_summary.get('ambiguous_domains') or [])
        if str(item or '').strip()
    ]
    has_visual_only_image_clue = bool(signal_summary.get('has_visual_only_image_clue'))
    candidates: List[Dict[str, Any]] = []

    def add_candidate(kind: str, label_name: str, base_bonus: float, reason: str) -> None:
        label = label_map.get(label_name)
        if not label:
            return
        confidence = float(label.get('confidence') or 0.0)
        score = confidence + base_bonus
        supporting_labels = [label_name]
        reason_parts = [reason]

        if kind == 'secret_code' and best_fragment_confidence:
            score += 0.08 if best_fragment_confidence >= 0.8 else 0.03
            reason_parts.append(f"Fragment structure fort: {(best_fragment_confidence * 100):.0f}%.")
            if has_pi_theme and pi_position_token_count:
                score += 0.1
                reason_parts.append(
                    "Le theme Pi avec des positions indexees "
                    + ('/'.join(pi_coordinate_axes) if pi_coordinate_axes else 'du listing')
                    + " renforce un decodeur direct de type pi_digits."
                )
            if best_fragment_source in HIDDEN_SECRET_FRAGMENT_SOURCES and label_map.get('hidden_content'):
                score -= 0.08
                if 'hidden_content' not in supporting_labels:
                    supporting_labels.append('hidden_content')
                reason_parts.append("Le meilleur fragment secret provient du HTML cache.")
            if best_fragment_source in IMAGE_SECRET_FRAGMENT_SOURCES and label_map.get('image_puzzle'):
                score -= 0.08
                if 'image_puzzle' not in supporting_labels:
                    supporting_labels.append('image_puzzle')
                reason_parts.append("Le meilleur fragment secret provient d un indice image.")
            if hidden_signal_count >= 2 and label_map.get('hidden_content'):
                score -= 0.03
                reason_parts.append("Des signaux HTML caches concurrencent la piste purement textuelle.")
            if image_hint_count >= 2 and label_map.get('image_puzzle'):
                score -= 0.02
                reason_parts.append("Plusieurs indices image sont presents dans le listing.")
            if (
                has_visual_only_image_clue
                and best_fragment_source in DIRECT_SECRET_FRAGMENT_SOURCES
                and best_fragment_confidence < 0.72
                and label_map.get('image_puzzle')
            ):
                score -= 0.1
                if 'image_puzzle' not in supporting_labels:
                    supporting_labels.append('image_puzzle')
                reason_parts.append("Le listing semble surtout demander une inspection visuelle de l image.")
            if is_hybrid_listing and dominant_evidence_domain == 'direct' and evidence_domain_gap >= 10.0:
                score += 0.06
                reason_parts.append("La piste visible domine dans un listing hybride.")
            elif is_hybrid_listing and dominant_evidence_domain in {'hidden', 'image'} and evidence_domain_gap >= 10.0:
                score -= 0.05
                reason_parts.append("Un autre domaine d indices domine dans ce listing hybride.")
        elif kind == 'formula':
            if variable_assignment_count:
                score += 0.04 if variable_assignment_count == 1 else 0.08
                reason_parts.append(f"{variable_assignment_count} affectation(s) de variable renforcent la piste formule.")
            if has_formula_coordinate_placeholders:
                score += 0.08
                reason_parts.append("Les coordonnees comportent des placeholders de formule.")
            if formula_signal_count >= 2:
                score += 0.04
                reason_parts.append("Plusieurs signaux de formule convergent.")
            if projection_keyword_count >= 2 and not variable_assignment_count and not has_formula_coordinate_placeholders and label_map.get('coord_transform'):
                score -= 0.03
                if 'coord_transform' not in supporting_labels:
                    supporting_labels.append('coord_transform')
                reason_parts.append("La piste peut aussi relever d une projection pure.")
        elif kind == 'hidden_content':
            if classification.get('hidden_signals'):
                score += 0.04
                reason_parts.append("Des signaux HTML caches ont ete trouves.")
            if hidden_fragment_count:
                score += 0.04
                reason_parts.append(f"{hidden_fragment_count} fragment(s) secret(s) proviennent du HTML cache.")
            if best_fragment_source in HIDDEN_SECRET_FRAGMENT_SOURCES and best_fragment_confidence:
                score += 0.08 if best_fragment_confidence >= 0.7 else 0.04
                if label_map.get('secret_code') and 'secret_code' not in supporting_labels:
                    supporting_labels.append('secret_code')
                reason_parts.append("La meilleure piste se situe dans le contenu cache.")
            if is_hybrid_listing and dominant_evidence_domain == 'hidden' and evidence_domain_gap >= 10.0:
                score += 0.06
                reason_parts.append("Le domaine HTML cache domine dans ce listing hybride.")
            elif is_hybrid_listing and dominant_evidence_domain in {'direct', 'image'} and evidence_domain_gap >= 10.0:
                score -= 0.03
                reason_parts.append("Un autre domaine d indices domine dans ce listing hybride.")
        elif kind == 'image_puzzle':
            if signal_summary.get('image_count'):
                score += 0.04
                reason_parts.append("Des images sont presentes dans le listing.")
            if image_hint_count:
                score += 0.03 if image_hint_count == 1 else 0.07
                reason_parts.append(f"{image_hint_count} indice(s) image textuel(s) ont ete extraits.")
            if visual_image_signal_count:
                score += 0.03 if visual_image_signal_count == 1 else 0.06
                reason_parts.append(f"{visual_image_signal_count} indice(s) de lecture visuelle d image ont ete detectes.")
            if image_hint_sources & {'image_alt_text', 'image_title_text', 'image_filename_text'}:
                score += 0.03
                reason_parts.append("Les metadonnees ou noms de fichiers image donnent deja des pistes.")
            if has_visual_only_image_clue:
                score += 0.09
                reason_parts.append("La consigne implique une inspection visuelle de l image meme sans texte extrait.")
            if best_fragment_source in IMAGE_SECRET_FRAGMENT_SOURCES and best_fragment_confidence:
                score += 0.08 if best_fragment_confidence >= 0.7 else 0.04
                if label_map.get('secret_code') and 'secret_code' not in supporting_labels:
                    supporting_labels.append('secret_code')
                reason_parts.append("La meilleure piste se situe dans une image.")
            if is_hybrid_listing and dominant_evidence_domain == 'image' and evidence_domain_gap >= 10.0:
                score += 0.06
                reason_parts.append("Le domaine image domine dans ce listing hybride.")
            elif is_hybrid_listing and dominant_evidence_domain in {'direct', 'hidden'} and evidence_domain_gap >= 10.0:
                score -= 0.03
                reason_parts.append("Un autre domaine d indices domine dans ce listing hybride.")
        elif kind == 'coord_transform':
            if signal_summary.get('waypoint_count'):
                score += 0.05
                reason_parts.append("Des waypoints ou projections sont disponibles.")
            if projection_keyword_count:
                score += 0.03 if projection_keyword_count == 1 else 0.06
                reason_parts.append(f"{projection_keyword_count} indice(s) de projection ou de waypoint ont ete trouves.")
            if variable_assignment_count and label_map.get('formula'):
                score -= 0.07
                if 'formula' not in supporting_labels:
                    supporting_labels.append('formula')
                reason_parts.append("Les affectations de variables orientent plutot vers une formule.")
            if has_formula_coordinate_placeholders and label_map.get('formula'):
                score -= 0.08
                if 'formula' not in supporting_labels:
                    supporting_labels.append('formula')
                reason_parts.append("Les placeholders de coordonnees ressemblent a une formule a resoudre.")
            elif formula_signal_count >= 2 and label_map.get('formula'):
                score -= 0.04
                if 'formula' not in supporting_labels:
                    supporting_labels.append('formula')
                reason_parts.append("Plusieurs signaux formels concurrencent la simple transformation.")

        candidates.append({
            'kind': kind,
            'confidence': round(confidence, 3),
            'score': round(score, 3),
            'reason': ' '.join(dict.fromkeys(part.strip() for part in reason_parts if part.strip())),
            'supporting_labels': supporting_labels,
        })

    add_candidate('formula', 'formula', 0.24, "Le listing contient des signaux de formule ou de coordonnees a variables.")
    add_candidate('secret_code', 'secret_code', 0.08, "Le listing contient un code secret structure ou un fragment compact exploitable.")
    add_candidate('hidden_content', 'hidden_content', 0.05, "Le HTML contient probablement des indices caches.")
    add_candidate('image_puzzle', 'image_puzzle', 0.05, "Le listing semble s appuyer sur des images ou de l OCR.")
    add_candidate('coord_transform', 'coord_transform', 0.02, "Le listing demande probablement une projection ou une transformation de coordonnees.")

    checker_label = label_map.get('checker_available')
    if checker_label:
        candidates.append({
            'kind': 'checker',
            'confidence': round(float(checker_label.get('confidence') or 0.0), 3),
            'score': round(float(checker_label.get('confidence') or 0.0) + 0.01, 3),
            'reason': "Un checker est disponible pour valider une hypothese, pas pour demarrer la resolution.",
            'supporting_labels': ['checker_available'],
        })

    candidates.sort(key=lambda item: (-item['score'], item['kind']))
    return candidates


def _append_candidate_reason(candidate: Dict[str, Any], extra_reason: str) -> Dict[str, Any]:
    if not extra_reason:
        return candidate

    reason_parts: List[str] = []
    for part in (str(candidate.get('reason') or '').strip(), str(extra_reason or '').strip()):
        if part and part not in reason_parts:
            reason_parts.append(part)
    return {**candidate, 'reason': ' '.join(reason_parts).strip()}


def _select_primary_workflow_candidate(
    workflow_candidates: List[Dict[str, Any]],
    classification: Dict[str, Any],
) -> Dict[str, Any]:
    if not workflow_candidates:
        return {
            'kind': 'general',
            'confidence': 0.2,
            'score': 0.2,
            'reason': "Aucun workflow specialise ne ressort nettement du listing.",
            'supporting_labels': [],
        }

    top_candidate = workflow_candidates[0]
    formula_candidate = next((item for item in workflow_candidates if item['kind'] == 'formula'), None)
    image_candidate = next((item for item in workflow_candidates if item['kind'] == 'image_puzzle'), None)
    hidden_candidate = next((item for item in workflow_candidates if item['kind'] == 'hidden_content'), None)
    secret_candidate = next((item for item in workflow_candidates if item['kind'] == 'secret_code'), None)
    signal_summary = classification.get('signal_summary') if isinstance(classification.get('signal_summary'), dict) else {}
    best_secret_fragment_source = str(signal_summary.get('best_secret_fragment_source') or '').strip()
    best_secret_fragment_confidence = float(signal_summary.get('best_secret_fragment_confidence') or 0.0)
    dominant_evidence_domain = str(signal_summary.get('dominant_evidence_domain') or '').strip()
    evidence_domain_gap = float(signal_summary.get('evidence_domain_gap') or 0.0)
    is_hybrid_listing = bool(signal_summary.get('is_hybrid_listing'))
    is_ambiguous_hybrid = bool(signal_summary.get('is_ambiguous_hybrid'))
    ambiguous_domains = [
        str(item or '').strip()
        for item in (signal_summary.get('ambiguous_domains') or [])
        if str(item or '').strip()
    ]
    has_visual_only_image_clue = bool(signal_summary.get('has_visual_only_image_clue'))

    if formula_candidate and top_candidate['kind'] in {'coord_transform', 'checker'}:
        return _append_candidate_reason(
            formula_candidate,
            "La piste formule est prioritaire sur une simple transformation ou validation.",
        )

    if (
        top_candidate['kind'] == 'secret_code'
        and image_candidate
        and has_visual_only_image_clue
        and best_secret_fragment_source in DIRECT_SECRET_FRAGMENT_SOURCES
        and best_secret_fragment_confidence < 0.72
    ):
        return _append_candidate_reason(
            image_candidate,
            "La consigne impose surtout une lecture visuelle de l image; le fragment visible seul reste trop faible.",
        )

    hybrid_domain_candidate = None
    hybrid_domain_reason = ''
    if is_hybrid_listing and evidence_domain_gap >= 10.0:
        if dominant_evidence_domain == 'direct':
            hybrid_domain_candidate = secret_candidate
            hybrid_domain_reason = "Le domaine visible domine dans ce listing hybride."
        elif dominant_evidence_domain == 'hidden':
            hybrid_domain_candidate = hidden_candidate
            hybrid_domain_reason = "Le domaine HTML cache domine dans ce listing hybride."
        elif dominant_evidence_domain == 'image':
            hybrid_domain_candidate = image_candidate
            hybrid_domain_reason = "Le domaine image domine dans ce listing hybride."

    if hybrid_domain_candidate and hybrid_domain_candidate['kind'] != top_candidate['kind']:
        return _append_candidate_reason(hybrid_domain_candidate, hybrid_domain_reason)

    if (
        is_ambiguous_hybrid
        and top_candidate['kind'] in {'secret_code', 'hidden_content', 'image_puzzle'}
        and ambiguous_domains
    ):
        return _append_candidate_reason(
            top_candidate,
            "Aucun domaine "
            + ' / '.join(ambiguous_domains)
            + " ne domine nettement; verifier plusieurs sources avant de figer le workflow.",
        )

    if top_candidate['kind'] not in {'secret_code', 'hidden_content', 'image_puzzle'}:
        return top_candidate

    source_workflow_kind: Optional[str] = None
    source_reason = ''
    if best_secret_fragment_source in HIDDEN_SECRET_FRAGMENT_SOURCES:
        source_workflow_kind = 'hidden_content'
        source_reason = "Le meilleur fragment secret provient du HTML cache."
    elif best_secret_fragment_source in IMAGE_SECRET_FRAGMENT_SOURCES:
        source_workflow_kind = 'image_puzzle'
        source_reason = "Le meilleur fragment secret provient d un indice image."
    elif best_secret_fragment_source in DIRECT_SECRET_FRAGMENT_SOURCES:
        if has_visual_only_image_clue and image_candidate and best_secret_fragment_confidence < 0.72:
            return _append_candidate_reason(
                image_candidate,
                "La consigne impose surtout une lecture visuelle de l image; le fragment visible seul reste trop faible.",
            )
        source_workflow_kind = 'secret_code'
        source_reason = "Le meilleur fragment secret provient du texte visible ou du hint."

    if not source_workflow_kind or source_workflow_kind == top_candidate['kind']:
        return top_candidate

    source_candidate = next((item for item in workflow_candidates if item['kind'] == source_workflow_kind), None)
    if not source_candidate:
        return top_candidate

    return _append_candidate_reason(source_candidate, source_reason)


def _extract_formula_variables(formulas: List[Dict[str, Any]]) -> List[str]:
    variables: set[str] = set()
    for formula in formulas:
        if not isinstance(formula, dict):
            continue
        formula_text = ' '.join(
            str(formula.get(field) or '')
            for field in ('north', 'east', 'text_output')
        )
        for letter in re.findall(r'[A-Z]', formula_text.upper()):
            if letter not in {'N', 'S', 'E', 'W'}:
                variables.add(letter)
    return sorted(variables)


def _select_primary_secret_fragment(classification: Dict[str, Any], listing_inputs: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    fragments = [
        item for item in (classification.get('candidate_secret_fragments') or [])
        if isinstance(item, dict) and str(item.get('text') or '').strip()
    ]
    if not fragments:
        return None

    signal_summary = classification.get('signal_summary') if isinstance(classification.get('signal_summary'), dict) else {}
    if bool(signal_summary.get('has_pi_theme')) and int(signal_summary.get('pi_position_token_count') or 0) >= 6:
        pi_fragment = next(
            (
                item for item in fragments
                if bool(((item.get('signature') or {}).get('looks_like_pi_index_positions')))
            ),
            None,
        )
        if pi_fragment:
            return pi_fragment

    hint = str(listing_inputs.get('hint') or '').strip()
    if hint:
        exact_hint = next((item for item in fragments if str(item.get('text') or '').strip() == hint), None)
        if exact_hint:
            return exact_hint

    title = str(listing_inputs.get('title') or '').strip()
    if title:
        exact_title = next((item for item in fragments if str(item.get('text') or '').strip() == title), None)
        if exact_title:
            return exact_title

    return fragments[0]


def _summarize_plugin_results(result: Dict[str, Any], *, limit: int = 5) -> Dict[str, Any]:
    raw_results = result.get('results') or []
    top_results: List[Dict[str, Any]] = []
    for item in raw_results[:limit]:
        if not isinstance(item, dict):
            continue
        top_results.append({
            'text_output': item.get('text_output'),
            'coordinates': item.get('coordinates'),
            'confidence': item.get('confidence'),
            'method': item.get('method'),
            'plugin': item.get('plugin') or item.get('source_plugin'),
        })

    coordinates = result.get('coordinates') or result.get('primary_coordinates')

    return {
        'status': result.get('status'),
        'summary': result.get('summary'),
        'results_count': len(raw_results),
        'top_results': top_results,
        'coordinates': coordinates,
        'failed_plugins': (result.get('failed_plugins') or [])[:5],
    }


def _recompute_workflow_next_actions(plan: List[Dict[str, Any]], classification: Dict[str, Any]) -> List[str]:
    next_actions: List[str] = []
    signal_summary = classification.get('signal_summary') if isinstance(classification.get('signal_summary'), dict) else {}
    is_ambiguous_hybrid = bool(signal_summary.get('is_ambiguous_hybrid'))
    ambiguous_domains = [
        str(item or '').strip()
        for item in (signal_summary.get('ambiguous_domains') or [])
        if str(item or '').strip()
    ]

    if is_ambiguous_hybrid and ambiguous_domains:
        review_action = (
            "Comparer les indices "
            + ' / '.join(ambiguous_domains)
            + " avant de figer le workflow."
        )
        next_actions.append(review_action)

    for step in plan:
        if step.get('status') == 'planned':
            title = str(step.get('title') or '').strip()
            if title and title not in next_actions:
                next_actions.append(title)
    for action in classification.get('recommended_actions') or []:
        action_text = str(action or '').strip()
        if action_text and action_text not in next_actions:
            next_actions.append(action_text)
    return next_actions[:8]


def _mark_plan_step(
    plan: List[Dict[str, Any]],
    step_id: str,
    *,
    status: Optional[str] = None,
    detail: Optional[str] = None,
    automated: Optional[bool] = None,
) -> Optional[Dict[str, Any]]:
    for step in plan:
        if step.get('id') != step_id:
            continue
        if status is not None:
            step['status'] = status
        if detail is not None:
            step['detail'] = detail
        if automated is not None:
            step['automated'] = automated
        return step
    return None


def _inject_hybrid_review_steps(
    plan: List[Dict[str, Any]],
    classification: Dict[str, Any],
) -> List[Dict[str, Any]]:
    signal_summary = classification.get('signal_summary') if isinstance(classification.get('signal_summary'), dict) else {}
    if not bool(signal_summary.get('is_ambiguous_hybrid')):
        return plan

    label_names = {
        str(item.get('name') or '').strip()
        for item in (classification.get('labels') or [])
        if isinstance(item, dict) and str(item.get('name') or '').strip()
    }
    existing_ids = {str(step.get('id') or '').strip() for step in plan}
    review_steps: List[Dict[str, Any]] = []

    if 'hidden_content' in label_names and 'inspect-hidden-html' not in existing_ids:
        review_steps.append({
            'id': 'inspect-hidden-html',
            'title': 'Inspecter le HTML cache',
            'status': 'planned',
            'automated': True,
            'tool': 'geoapp.plugins.workflow.run-step',
            'detail': 'Le listing est hybride; verifier aussi les indices caches.',
        })
    if 'image_puzzle' in label_names and 'inspect-images' not in existing_ids:
        review_steps.append({
            'id': 'inspect-images',
            'title': 'Inspecter les images',
            'status': 'planned',
            'automated': True,
            'tool': 'geoapp.plugins.workflow.run-step',
            'detail': 'Le listing est hybride; verifier aussi les indices image.',
        })

    if not review_steps:
        return plan

    insertion_index = 2 if len(plan) >= 2 else len(plan)
    return plan[:insertion_index] + review_steps + plan[insertion_index:]


def _suggest_formula_value_candidates(answer: str, question: str = '') -> List[Dict[str, Any]]:
    normalized = str(answer or '').strip()
    if not normalized:
        return []

    suggestions: List[Dict[str, Any]] = []
    compact = normalized.replace(' ', '')
    digits = re.findall(r'\d', normalized)
    integer_match = re.search(r'-?\d+', normalized)
    question_hint = str(question or '').lower()

    length_confidence = 0.8 if compact and len(compact) < 100 else 0.3
    suggestions.append({
        'type': 'length',
        'confidence': length_confidence,
        'result': len(compact),
        'description': 'Longueur du texte sans espaces',
    })

    checksum = sum(int(digit) for digit in digits)
    checksum_confidence = 0.7 if digits else 0.1
    suggestions.append({
        'type': 'checksum',
        'confidence': checksum_confidence,
        'result': checksum,
        'description': f'Checksum de {len(digits)} chiffre(s)',
    })

    reduced_checksum = checksum
    while reduced_checksum >= 10:
        reduced_checksum = sum(int(digit) for digit in str(reduced_checksum))
    suggestions.append({
        'type': 'reduced_checksum',
        'confidence': checksum_confidence * 0.9,
        'result': reduced_checksum,
        'description': 'Checksum reduit a un chiffre',
    })

    if integer_match:
        direct_value = int(integer_match.group(0))
        value_confidence = 0.95 if normalized == integer_match.group(0) else 0.82
        if any(token in question_hint for token in ('annee', 'year', 'nombre', 'number', 'combien', 'how many')):
            value_confidence = min(0.99, value_confidence + 0.05)
        suggestions.append({
            'type': 'value',
            'confidence': value_confidence,
            'result': direct_value,
            'description': 'Valeur numerique detectee dans la reponse',
        })

    suggestions.sort(key=lambda item: (-float(item.get('confidence') or 0.0), item.get('type') or ''))
    return suggestions


def _calculate_formula_value(answer: Any, value_type: str) -> int:
    normalized = str(answer or '').strip()
    if not normalized:
        raise ValueError("Impossible de calculer une valeur vide")

    normalized_type = str(value_type or '').strip().lower()
    digits = re.findall(r'\d', normalized)

    if normalized_type == 'length':
        return len(normalized.replace(' ', ''))
    if normalized_type == 'checksum':
        return sum(int(digit) for digit in digits)
    if normalized_type == 'reduced_checksum':
        checksum = sum(int(digit) for digit in digits)
        while checksum >= 10:
            checksum = sum(int(digit) for digit in str(checksum))
        return checksum
    if normalized_type == 'value':
        match = re.search(r'-?\d+', normalized)
        if not match:
            raise ValueError(f"Aucune valeur numerique exploitable dans '{normalized[:40]}'")
        return int(match.group(0))
    raise ValueError(f"Type de calcul inconnu: {value_type}")


def _extract_formula_coordinates(formula_entry: Dict[str, Any]) -> tuple[str, str]:
    north = str(
        formula_entry.get('north')
        or formula_entry.get('north_formula')
        or formula_entry.get('northFormula')
        or ''
    ).strip()
    east = str(
        formula_entry.get('east')
        or formula_entry.get('east_formula')
        or formula_entry.get('eastFormula')
        or ''
    ).strip()
    if north and east:
        return north, east

    text_output = str(formula_entry.get('text_output') or '').strip()
    match = re.search(r'([NS][^EW]+)\s+([EW].+)$', text_output, re.IGNORECASE)
    if match:
        return match.group(1).strip(), match.group(2).strip()
    return '', ''


def _coerce_decimal_coordinate(value: Any, *, is_latitude: bool) -> Optional[float]:
    try:
        numeric_value = float(str(value).strip().replace(',', '.'))
    except (TypeError, ValueError):
        return None
    if math.isnan(numeric_value) or math.isinf(numeric_value):
        return None
    limit = 90.0 if is_latitude else 180.0
    if abs(numeric_value) > limit:
        return None
    return round(numeric_value, 8)


def _extract_decimal_coordinates(candidate: Any) -> Optional[Dict[str, float]]:
    if isinstance(candidate, dict):
        latitude = _coerce_decimal_coordinate(candidate.get('latitude'), is_latitude=True)
        longitude = _coerce_decimal_coordinate(candidate.get('longitude'), is_latitude=False)
        if latitude is not None and longitude is not None:
            return {
                'latitude': latitude,
                'longitude': longitude,
            }
        for key in ('ddm', 'formatted', 'coordinates_raw', 'decimal', 'text_output', 'value'):
            nested_value = candidate.get(key)
            parsed = _extract_decimal_coordinates(nested_value)
            if parsed:
                return parsed
        return None

    if isinstance(candidate, (list, tuple)) and len(candidate) >= 2:
        latitude = _coerce_decimal_coordinate(candidate[0], is_latitude=True)
        longitude = _coerce_decimal_coordinate(candidate[1], is_latitude=False)
        if latitude is not None and longitude is not None:
            return {
                'latitude': latitude,
                'longitude': longitude,
            }
        return None

    text = str(candidate or '').strip()
    if not text:
        return None

    decimal_match = DECIMAL_COORDINATE_PAIR_PATTERN.search(text)
    if decimal_match:
        latitude = _coerce_decimal_coordinate(decimal_match.group(1), is_latitude=True)
        longitude = _coerce_decimal_coordinate(decimal_match.group(2), is_latitude=False)
        if latitude is not None and longitude is not None:
            return {
                'latitude': latitude,
                'longitude': longitude,
            }

    ddm_match = DDM_COORDINATE_PAIR_PATTERN.search(' '.join(text.split()))
    if ddm_match:
        try:
            from gc_backend.blueprints.coordinates import convert_ddm_to_decimal

            converted = convert_ddm_to_decimal(ddm_match.group(1), ddm_match.group(2))
        except Exception:
            converted = None
        if isinstance(converted, dict):
            latitude = _coerce_decimal_coordinate(converted.get('latitude'), is_latitude=True)
            longitude = _coerce_decimal_coordinate(converted.get('longitude'), is_latitude=False)
            if latitude is not None and longitude is not None:
                return {
                    'latitude': latitude,
                    'longitude': longitude,
                }

    return None


def _collect_geographic_reference_points(listing_inputs: Dict[str, Any]) -> List[Dict[str, Any]]:
    references: List[Dict[str, Any]] = []
    seen_keys: set[Tuple[str, float, float]] = set()

    def add_reference(reference_type: str, label: str, coordinates: Any) -> None:
        parsed = _extract_decimal_coordinates(coordinates)
        if not parsed:
            return
        latitude = parsed['latitude']
        longitude = parsed['longitude']
        dedupe_key = (reference_type, round(latitude, 5), round(longitude, 5))
        if dedupe_key in seen_keys:
            return
        seen_keys.add(dedupe_key)
        references.append({
            'type': reference_type,
            'label': label,
            'latitude': latitude,
            'longitude': longitude,
        })

    geocache_record = listing_inputs.get('geocache_record')
    if geocache_record is not None:
        add_reference(
            'published',
            'Coordonnees publiees',
            {
                'latitude': getattr(geocache_record, 'latitude', None),
                'longitude': getattr(geocache_record, 'longitude', None),
            },
        )
        add_reference(
            'original',
            'Coordonnees originales',
            {
                'latitude': getattr(geocache_record, 'original_latitude', None),
                'longitude': getattr(geocache_record, 'original_longitude', None),
            },
        )
        for waypoint in getattr(geocache_record, 'waypoints', []) or []:
            add_reference(
                'waypoint',
                f"Waypoint {getattr(waypoint, 'name', None) or getattr(waypoint, 'prefix', None) or 'sans nom'}",
                {
                    'latitude': getattr(waypoint, 'latitude', None),
                    'longitude': getattr(waypoint, 'longitude', None),
                    'coordinates_raw': getattr(waypoint, 'gc_coords', None),
                },
            )

    for waypoint in listing_inputs.get('waypoints') or []:
        if not isinstance(waypoint, dict):
            continue
        add_reference(
            'waypoint',
            f"Waypoint {str(waypoint.get('name') or waypoint.get('prefix') or waypoint.get('lookup') or 'sans nom').strip()}",
            waypoint,
        )

    return references


def _build_geographic_plausibility(candidate_coordinates: Any, listing_inputs: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    parsed_candidate = _extract_decimal_coordinates(candidate_coordinates)
    if not parsed_candidate:
        return None

    references = _collect_geographic_reference_points(listing_inputs)
    if not references:
        return {
            'status': 'unknown',
            'score': 0.0,
            'summary': 'Aucun point de reference geographique disponible.',
            'reasons': ['La geocache ne fournit pas de coordonnees d origine ou de waypoint exploitable.'],
            'reference_count': 0,
            'published_distance_km': None,
            'original_distance_km': None,
            'nearest_waypoint_distance_km': None,
            'nearest_reference': None,
            'reference_distances': [],
        }

    from gc_backend.utils.coordinate_calculator import CoordinateCalculator

    calculator = CoordinateCalculator()
    measured_distances: List[Dict[str, Any]] = []
    published_distance_km: Optional[float] = None
    original_distance_km: Optional[float] = None
    nearest_waypoint_distance_km: Optional[float] = None

    for reference in references:
        distance_km = calculator.calculate_distance(
            parsed_candidate['latitude'],
            parsed_candidate['longitude'],
            reference['latitude'],
            reference['longitude'],
        )
        distance_km = round(distance_km, 2)
        measured = {
            **reference,
            'distance_km': distance_km,
        }
        measured_distances.append(measured)
        if reference['type'] == 'published':
            published_distance_km = distance_km
        elif reference['type'] == 'original':
            original_distance_km = distance_km
        elif reference['type'] == 'waypoint':
            nearest_waypoint_distance_km = (
                distance_km
                if nearest_waypoint_distance_km is None
                else min(nearest_waypoint_distance_km, distance_km)
            )

    measured_distances.sort(key=lambda item: (item['distance_km'], item['type'], item['label']))
    nearest_reference = measured_distances[0]
    reference_anchor_distance = nearest_reference['distance_km']

    if reference_anchor_distance <= 0.35:
        status = 'very_plausible'
        score = 0.97
    elif reference_anchor_distance <= 3:
        status = 'plausible'
        score = 0.88
    elif reference_anchor_distance <= 25:
        status = 'plausible'
        score = 0.76
    elif reference_anchor_distance <= 80:
        status = 'uncertain'
        score = 0.52
    elif reference_anchor_distance <= 200:
        status = 'unlikely'
        score = 0.28
    else:
        status = 'unlikely'
        score = 0.12

    if nearest_reference['type'] == 'waypoint' and reference_anchor_distance <= 1:
        score = max(score, 0.93)
        status = 'very_plausible'

    reasons = [
        f"A {reference_anchor_distance:.2f} km de {nearest_reference['label'].lower()}."
    ]
    if published_distance_km is not None and nearest_reference['type'] != 'published':
        reasons.append(f"A {published_distance_km:.2f} km des coordonnees publiees.")
    if original_distance_km is not None and nearest_reference['type'] != 'original':
        reasons.append(f"A {original_distance_km:.2f} km des coordonnees originales.")
    if nearest_waypoint_distance_km is not None:
        reasons.append(f"Waypoint le plus proche a {nearest_waypoint_distance_km:.2f} km.")

    summary = {
        'very_plausible': 'Les coordonnees restent tres proches d un point de reference du listing.',
        'plausible': 'Les coordonnees restent dans une zone geographiquement plausible pour la geocache.',
        'uncertain': 'Les coordonnees sont assez eloignees; verification humaine recommandee.',
        'unlikely': 'Les coordonnees semblent trop eloignees des references connues.',
        'unknown': 'Plausibilite geographique non evaluable.',
    }[status]

    return {
        'status': status,
        'score': round(score, 3),
        'summary': summary,
        'reasons': reasons[:3],
        'reference_count': len(measured_distances),
        'published_distance_km': published_distance_km,
        'original_distance_km': original_distance_km,
        'nearest_waypoint_distance_km': nearest_waypoint_distance_km,
        'nearest_reference': {
            'type': nearest_reference['type'],
            'label': nearest_reference['label'],
            'distance_km': nearest_reference['distance_km'],
        },
        'reference_distances': [
            {
                'type': item['type'],
                'label': item['label'],
                'distance_km': item['distance_km'],
            }
            for item in measured_distances[:4]
        ],
    }


def _extract_primary_metasolver_coordinates_candidate(metasolver_result: Dict[str, Any]) -> Any:
    candidate = metasolver_result.get('coordinates')
    if candidate:
        return candidate

    for item in metasolver_result.get('top_results') or []:
        if not isinstance(item, dict):
            continue
        if item.get('coordinates'):
            return item.get('coordinates')
        text_output = str(item.get('text_output') or '').strip()
        if _extract_decimal_coordinates(text_output):
            return text_output

    return None


def _attach_metasolver_geographic_plausibility(
    metasolver_result: Optional[Dict[str, Any]],
    listing_inputs: Dict[str, Any],
) -> Optional[Dict[str, Any]]:
    if not isinstance(metasolver_result, dict):
        return metasolver_result

    candidate_coordinates = _extract_primary_metasolver_coordinates_candidate(metasolver_result)
    plausibility = _build_geographic_plausibility(candidate_coordinates, listing_inputs)
    if plausibility:
        metasolver_result['geographic_plausibility'] = plausibility
    return metasolver_result


def _format_checker_candidate_from_coordinates(coordinates: Any) -> str:
    if isinstance(coordinates, dict):
        for key in ('ddm', 'formatted', 'decimal', 'coordinates_raw'):
            value = str(coordinates.get(key) or '').strip()
            if value:
                return value
        latitude = coordinates.get('latitude')
        longitude = coordinates.get('longitude')
        if latitude is not None and longitude is not None:
            return f"{latitude}, {longitude}"
    if isinstance(coordinates, str):
        return coordinates.strip()
    return ''


def _resolve_checker_candidate(data: Dict[str, Any], workflow_resolution: Dict[str, Any]) -> str:
    explicit = str(
        data.get('checker_candidate')
        or data.get('candidate')
        or ''
    ).strip()
    if explicit:
        return explicit

    execution = workflow_resolution.get('execution') or {}
    formula_payload = execution.get('formula') or {}
    calculated = (formula_payload.get('calculated_coordinates') or {}).get('coordinates')
    candidate = _format_checker_candidate_from_coordinates(calculated)
    if candidate:
        return candidate

    secret_payload = execution.get('secret_code') or {}
    direct_plugin_result = secret_payload.get('direct_plugin_result') or {}
    candidate = _format_checker_candidate_from_coordinates(direct_plugin_result.get('coordinates'))
    if candidate:
        return candidate

    for item in direct_plugin_result.get('top_results') or []:
        if not isinstance(item, dict):
            continue
        candidate = _format_checker_candidate_from_coordinates(item.get('coordinates'))
        if candidate:
            return candidate
        text_output = str(item.get('text_output') or '').strip()
        if text_output:
            return text_output

    metasolver_result = secret_payload.get('metasolver_result') or {}
    candidate = _format_checker_candidate_from_coordinates(metasolver_result.get('coordinates'))
    if candidate:
        return candidate

    for item in metasolver_result.get('top_results') or []:
        if not isinstance(item, dict):
            continue
        candidate = _format_checker_candidate_from_coordinates(item.get('coordinates'))
        if candidate:
            return candidate
        text_output = str(item.get('text_output') or '').strip()
        if text_output:
            return text_output

    selected_fragment = secret_payload.get('selected_fragment') or {}
    fragment_text = str(selected_fragment.get('text') or '').strip()
    if fragment_text:
        return fragment_text

    return ''


def _is_certitudes_url(url: str) -> bool:
    raw = (url or '').lower()
    return 'certitudes.org' in raw or 'www.certitudes.org' in raw


def _is_geocaching_url(url: str) -> bool:
    raw = (url or '').lower()
    if 'geocaching.com' not in raw:
        return False
    return '/geocache/' in raw or 'cache_details.aspx' in raw


def _normalize_certitudes_url(url: str, wp: Optional[str]) -> str:
    raw = str(url or '').strip()
    if not raw:
        raise ValueError('Missing checker url')

    if '://' not in raw:
        raw = f"https://{raw.lstrip('/')}"

    parsed = urlparse(raw)
    host = (parsed.hostname or '').lower()
    if not host.endswith('certitudes.org'):
        return raw

    query = dict(parse_qsl(parsed.query, keep_blank_values=True))
    if wp and not query.get('wp'):
        query['wp'] = wp

    path = parsed.path or ''
    if 'certitude' not in path.lower():
        path = '/certitude'

    normalized = parsed._replace(
        scheme='https',
        netloc='www.certitudes.org',
        path=path,
        query=urlencode(query),
    )
    return urlunparse(normalized)


def _normalize_geocaching_url(url: str, wp: Optional[str]) -> str:
    raw = str(url or '').strip()
    if not raw:
        raise ValueError('Missing checker url')

    lowered = raw.lower()
    if raw.startswith('#') or raw in {'solution-checker', '#solution-checker'}:
        if not wp:
            raise ValueError('Invalid Geocaching checker url (#solution-checker) without GC code')
        return f'https://www.geocaching.com/geocache/{wp}'

    if '/geocache/#solution-checker' in lowered or '/geocache/#' in lowered:
        if not wp:
            raise ValueError('Geocaching checker url is missing the GC code')
        return f'https://www.geocaching.com/geocache/{wp}'

    if raw.startswith('/'):
        return f'https://www.geocaching.com{raw}'

    if '://' not in raw and 'geocaching.com' in lowered:
        return f"https://{raw.replace('http://', '').replace('https://', '')}"

    return raw


def _resolve_checker_target(listing_inputs: Dict[str, Any], data: Dict[str, Any]) -> Dict[str, Any]:
    metadata = listing_inputs.get('metadata') or {}
    wp = str(data.get('wp') or metadata.get('gc_code') or '').strip() or None

    explicit_url = str(data.get('checker_url') or data.get('url') or '').strip()
    if explicit_url:
        target = {
            'url': explicit_url,
            'name': str(data.get('checker_name') or 'Checker').strip() or 'Checker',
            'wp': wp,
        }
    else:
        requested_checker_id = data.get('checker_id')
        checkers = listing_inputs.get('checkers') or []
        chosen = None
        if requested_checker_id is not None:
            chosen = next(
                (checker for checker in checkers if str(checker.get('id')) == str(requested_checker_id)),
                None,
            )
        if chosen is None:
            def _pick(*predicates):
                for predicate in predicates:
                    found = next((checker for checker in checkers if predicate(checker)), None)
                    if found is not None:
                        return found
                return None

            chosen = _pick(
                lambda checker: 'certitudes.org' in str(checker.get('url') or '').lower(),
                lambda checker: 'certitude' in str(checker.get('name') or '').lower(),
                lambda checker: 'geocaching' in str(checker.get('name') or '').lower(),
                lambda checker: 'geocaching.com' in str(checker.get('url') or '').lower(),
                lambda checker: True,
            )

        if not chosen:
            raise ValueError('No checkers available for this geocache or listing')

        target = {
            'url': str(chosen.get('url') or '').strip(),
            'name': str(chosen.get('name') or 'Checker').strip() or 'Checker',
            'wp': wp,
        }

    if not target['url']:
        raise ValueError('Checker URL is missing for this geocache or listing')

    if _is_geocaching_url(target['url']) or 'geocaching.com' in target['url'].lower() or target['url'].startswith('#'):
        target['url'] = _normalize_geocaching_url(target['url'], target['wp'])
    if _is_certitudes_url(target['url']) or 'certitudes.org' in target['url'].lower():
        target['url'] = _normalize_certitudes_url(target['url'], target['wp'])

    target['interactive'] = _is_certitudes_url(target['url']) or _is_geocaching_url(target['url'])
    target['provider'] = 'geocaching' if _is_geocaching_url(target['url']) else ('certitudes' if _is_certitudes_url(target['url']) else 'generic')
    return target


def _run_checker_with_target(
    *,
    url: str,
    candidate: str,
    wp: Optional[str],
    interactive: bool,
    provider: str,
    auto_login: bool,
    login_timeout_sec: int,
    timeout_sec: int,
) -> Dict[str, Any]:
    from gc_backend.blueprints.checkers import (
        _build_runner,
        _is_checkers_enabled,
        _run_playwright_blocking,
        _should_keep_checker_page_open,
    )

    if not _is_checkers_enabled():
        raise RuntimeError('checkers_disabled')

    runner = _build_runner()

    if provider == 'geocaching':
        from gc_backend.services.checkers.session import GeocachingSessionManager
        from gc_backend.services.checkers.storage import get_default_profile_dir
        from gc_backend.utils.preferences import get_value_or_default

        profile_dir_raw = get_value_or_default('geoApp.checkers.profileDir', '')
        profile_dir = Path(profile_dir_raw) if profile_dir_raw else get_default_profile_dir()
        timeout_ms = int(get_value_or_default('geoApp.checkers.timeoutMs', 20000))
        headless = bool(get_value_or_default('geoApp.checkers.playwright.headless', True))

        manager = GeocachingSessionManager(profile_dir=profile_dir, timeout_ms=timeout_ms)
        logged_in = bool(_run_playwright_blocking(lambda: manager.is_logged_in(headless=headless)))
        if not logged_in and auto_login:
            logged_in = bool(_run_playwright_blocking(lambda: manager.login_interactive(timeout_sec=login_timeout_sec)))
        if not logged_in:
            return {
                'status': 'requires_login',
                'message': 'Geocaching.com session is not logged in. Use login_checker_session or retry with manual login.',
                'provider': provider,
                'url': url,
                'wp': wp,
            }

    input_payload = {'candidate': candidate}
    if interactive:
        result = _run_playwright_blocking(
            lambda: runner.run_interactive(
                url=url,
                input_payload=input_payload,
                timeout_sec=timeout_sec,
                keep_open=_should_keep_checker_page_open(url),
            )
        )
    else:
        result = _run_playwright_blocking(lambda: runner.run(url=url, input_payload=input_payload))

    return {
        'status': 'success',
        'provider': provider,
        'url': url,
        'wp': wp,
        'interactive': interactive,
        'candidate': candidate,
        'result': result,
    }


def _derive_formula_values(data: Dict[str, Any]) -> Dict[str, int]:
    values: Dict[str, int] = {}

    raw_values = data.get('formula_values')
    if isinstance(raw_values, dict):
        for key, value in raw_values.items():
            variable = str(key or '').strip().upper()
            if not variable:
                continue
            try:
                values[variable] = int(value)
            except (TypeError, ValueError):
                continue

    raw_answers = data.get('formula_answers')
    raw_types = data.get('formula_value_types')
    if isinstance(raw_answers, dict):
        for key, answer in raw_answers.items():
            variable = str(key or '').strip().upper()
            if not variable or variable in values:
                continue
            value_type = ''
            if isinstance(raw_types, dict):
                value_type = str(raw_types.get(key) or raw_types.get(variable) or '').strip().lower()
            if not value_type:
                suggestions = _suggest_formula_value_candidates(str(answer or ''))
                value_type = str((suggestions[0] if suggestions else {}).get('type') or 'length')
            try:
                values[variable] = _calculate_formula_value(answer, value_type)
            except ValueError:
                continue

    return values


def _extract_previous_workflow_control(data: Dict[str, Any]) -> Dict[str, Any]:
    raw_control = data.get('workflow_control')
    return raw_control if isinstance(raw_control, dict) else {}


def _build_workflow_budget(data: Dict[str, Any], workflow_kind: str, previous_control: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    defaults = dict(WORKFLOW_BUDGET_DEFAULTS.get(workflow_kind) or WORKFLOW_BUDGET_DEFAULTS['general'])
    raw_budget = data.get('workflow_budget')
    if not isinstance(raw_budget, dict):
        raw_budget = (previous_control or {}).get('budget')
    if not isinstance(raw_budget, dict):
        raw_budget = {}

    return {
        'max_automated_steps': _normalize_positive_int(raw_budget.get('max_automated_steps'), defaults['max_automated_steps'], minimum=0, maximum=20),
        'max_metasolver_runs': _normalize_positive_int(raw_budget.get('max_metasolver_runs'), defaults['max_metasolver_runs'], minimum=0, maximum=10),
        'max_search_questions': _normalize_positive_int(raw_budget.get('max_search_questions'), defaults['max_search_questions'], minimum=0, maximum=50),
        'max_checker_runs': _normalize_positive_int(raw_budget.get('max_checker_runs'), defaults['max_checker_runs'], minimum=0, maximum=10),
        'max_coordinate_calculations': _normalize_positive_int(raw_budget.get('max_coordinate_calculations'), defaults['max_coordinate_calculations'], minimum=0, maximum=10),
        'max_vision_ocr_runs': _normalize_positive_int(raw_budget.get('max_vision_ocr_runs'), defaults['max_vision_ocr_runs'], minimum=0, maximum=10),
        'stop_on_checker_success': _normalize_bool(raw_budget.get('stop_on_checker_success'), bool(defaults['stop_on_checker_success'])),
    }


def _build_workflow_usage(
    execution: Dict[str, Any],
    previous_control: Optional[Dict[str, Any]] = None,
) -> Dict[str, int]:
    usage = {
        'automated_steps': 0,
        'metasolver_runs': 0,
        'search_questions': 0,
        'checker_runs': 0,
        'coordinate_calculations': 0,
        'vision_ocr_runs': 0,
    }
    raw_previous_usage = (previous_control or {}).get('usage')
    if isinstance(raw_previous_usage, dict):
        for key in usage:
            usage[key] = _normalize_positive_int(raw_previous_usage.get(key), usage[key], minimum=0, maximum=1000)

    secret_payload = execution.get('secret_code') or {}
    if (secret_payload.get('direct_plugin_result') or {}).get('status'):
        usage['automated_steps'] = max(usage['automated_steps'], 1)
    if (secret_payload.get('metasolver_result') or {}).get('status'):
        usage['metasolver_runs'] = max(usage['metasolver_runs'], 1)

    formula_payload = execution.get('formula') or {}
    answer_search = formula_payload.get('answer_search') or {}
    if isinstance(answer_search.get('answers'), dict):
        usage['search_questions'] = max(usage['search_questions'], len(answer_search.get('answers') or {}))
    if (formula_payload.get('calculated_coordinates') or {}).get('status'):
        usage['coordinate_calculations'] = max(usage['coordinate_calculations'], 1)

    checker_payload = execution.get('checker') or {}
    if checker_payload.get('status') or checker_payload.get('result'):
        usage['checker_runs'] = max(usage['checker_runs'], 1)

    hidden_payload = execution.get('hidden_content') or {}
    if hidden_payload.get('inspected'):
        usage['automated_steps'] = max(usage['automated_steps'], 1)
    image_payload = execution.get('image_puzzle') or {}
    if image_payload.get('inspected'):
        usage['automated_steps'] = max(usage['automated_steps'], 1)
    current_vision_usage = _normalize_positive_int(
        image_payload.get('vision_ocr_budget_cost'),
        0,
        minimum=0,
        maximum=1000,
    )
    if current_vision_usage <= 0:
        current_vision_usage = _normalize_positive_int(
            image_payload.get('vision_ocr_images_analyzed'),
            0,
            minimum=0,
            maximum=1000,
        )
    if current_vision_usage <= 0:
        current_vision_usage = sum(
            1
            for item in (image_payload.get('items') or [])
            if str(item.get('source') or '') == 'image_vision_text'
        )
    if current_vision_usage > 0:
        usage['vision_ocr_runs'] += current_vision_usage

    inferred_automated_steps = 0
    inferred_automated_steps += 1 if (secret_payload.get('direct_plugin_result') or {}).get('status') else 0
    inferred_automated_steps += usage['metasolver_runs']
    inferred_automated_steps += 1 if hidden_payload.get('inspected') else 0
    inferred_automated_steps += 1 if image_payload.get('inspected') else 0
    inferred_automated_steps += 1 if usage['search_questions'] > 0 else 0
    inferred_automated_steps += usage['coordinate_calculations']
    inferred_automated_steps += usage['checker_runs']
    usage['automated_steps'] = max(usage['automated_steps'], inferred_automated_steps)
    return usage


def _checker_execution_succeeded(checker_payload: Any) -> bool:
    if not isinstance(checker_payload, dict):
        return False
    result = checker_payload.get('result') or {}
    statuses = {
        str(checker_payload.get('status') or '').strip().lower(),
        str(result.get('status') or '').strip().lower(),
    }
    if {'success', 'ok', 'valid'} & statuses:
        return True
    message = ' '.join(
        str(value or '').strip().lower()
        for value in (checker_payload.get('message'), result.get('message'), result.get('evidence'))
        if value
    )
    return any(token in message for token in ('felicitation', 'congrat', 'correct', 'valid'))


def _get_step_budget_block_reason(step_id: str, remaining: Dict[str, Any]) -> Optional[str]:
    if step_id in SUPPORTED_AUTOMATED_WORKFLOW_STEPS and int(remaining.get('automated_steps') or 0) <= 0:
        return 'Le budget global d automatisation est epuise.'
    if step_id == 'execute-metasolver' and int(remaining.get('metasolver_runs') or 0) <= 0:
        return 'Le budget metasolver est epuise.'
    if step_id == 'search-answers' and int(remaining.get('search_questions') or 0) <= 0:
        return 'Le budget de recherche web est epuise.'
    if step_id == 'calculate-final-coordinates' and int(remaining.get('coordinate_calculations') or 0) <= 0:
        return 'Le budget de calcul de coordonnees est epuise.'
    if step_id == 'validate-with-checker' and int(remaining.get('checker_runs') or 0) <= 0:
        return 'Le budget checker est epuise.'
    return None


def _estimate_workflow_final_confidence(
    workflow_kind: str,
    execution: Dict[str, Any],
    classification: Dict[str, Any],
) -> float:
    checker_payload = execution.get('checker') or {}
    if _checker_execution_succeeded(checker_payload):
        return 0.99

    confidence = 0.15
    if workflow_kind == 'secret_code':
        secret_payload = execution.get('secret_code') or {}
        if secret_payload.get('selected_fragment'):
            confidence = max(confidence, 0.34)
        direct_plugin_candidate = secret_payload.get('direct_plugin_candidate') or {}
        if direct_plugin_candidate.get('plugin_name'):
            confidence = max(confidence, 0.56)
        direct_plugin_result = secret_payload.get('direct_plugin_result') or {}
        if direct_plugin_result.get('results_count'):
            confidence = max(confidence, 0.72)
        if direct_plugin_result.get('coordinates'):
            confidence = max(confidence, 0.8)
        if secret_payload.get('recommendation'):
            confidence = max(confidence, 0.48)
        metasolver_result = secret_payload.get('metasolver_result') or {}
        if metasolver_result.get('results_count'):
            confidence = max(confidence, 0.62)
        if metasolver_result.get('coordinates'):
            confidence = max(confidence, 0.78)
        plausibility_score = float(((metasolver_result.get('geographic_plausibility') or {}).get('score')) or 0.0)
        if plausibility_score >= 0.9:
            confidence = max(confidence, 0.88)
        elif plausibility_score >= 0.75:
            confidence = max(confidence, 0.82)
        elif plausibility_score >= 0.45:
            confidence = max(confidence, 0.7)
        elif plausibility_score > 0:
            confidence = min(confidence, 0.58)
    elif workflow_kind == 'formula':
        formula_payload = execution.get('formula') or {}
        formula_count = int(formula_payload.get('formula_count') or 0)
        if formula_count:
            confidence = max(confidence, 0.46)
        found_question_count = int(formula_payload.get('found_question_count') or 0)
        if found_question_count:
            confidence = max(confidence, min(0.66, 0.46 + found_question_count * 0.04))
        answer_search = formula_payload.get('answer_search') or {}
        found_answers = int(answer_search.get('found_count') or 0)
        if found_answers:
            confidence = max(confidence, min(0.74, 0.56 + found_answers * 0.03))
        calculated = formula_payload.get('calculated_coordinates') or {}
        if calculated.get('status') == 'success':
            confidence = max(confidence, 0.82)
            distance_km = ((calculated.get('distance') or {}).get('km'))
            try:
                if distance_km is not None:
                    distance_km = float(distance_km)
                    if distance_km <= 25:
                        confidence = min(0.9, confidence + 0.05)
                    elif distance_km >= 200:
                        confidence = max(0.55, confidence - 0.12)
            except (TypeError, ValueError):
                pass
            plausibility_score = float(((calculated.get('geographic_plausibility') or {}).get('score')) or 0.0)
            if plausibility_score >= 0.9:
                confidence = max(confidence, 0.93)
            elif plausibility_score >= 0.75:
                confidence = max(confidence, 0.88)
            elif plausibility_score >= 0.45:
                confidence = max(confidence, 0.76)
            elif plausibility_score > 0:
                confidence = min(confidence, 0.63)
    elif workflow_kind == 'hidden_content':
        hidden_payload = execution.get('hidden_content') or {}
        if hidden_payload.get('hidden_signals'):
            confidence = max(confidence, 0.36)
        if hidden_payload.get('items'):
            confidence = max(confidence, 0.48)
        if hidden_payload.get('selected_fragment'):
            confidence = max(confidence, 0.62)
        if hidden_payload.get('recommendation'):
            confidence = max(confidence, 0.71)
    elif workflow_kind == 'image_puzzle':
        image_payload = execution.get('image_puzzle') or {}
        if int(image_payload.get('image_count') or 0) > 0:
            confidence = max(confidence, 0.3)
        if image_payload.get('items'):
            confidence = max(confidence, 0.44)
        if image_payload.get('selected_fragment'):
            confidence = max(confidence, 0.6)
        if image_payload.get('recommendation'):
            confidence = max(confidence, 0.69)
        plausibility_score = float(((image_payload.get('geographic_plausibility') or {}).get('score')) or 0.0)
        if plausibility_score >= 0.9:
            confidence = max(confidence, 0.88)
        elif plausibility_score >= 0.75:
            confidence = max(confidence, 0.81)
        elif plausibility_score >= 0.45:
            confidence = max(confidence, 0.67)
        elif plausibility_score > 0:
            confidence = min(confidence, 0.54)
    else:
        labels = classification.get('labels') or []
        if labels:
            confidence = max(confidence, float((labels[0] or {}).get('confidence') or 0.2))

    signal_summary = classification.get('signal_summary') if isinstance(classification.get('signal_summary'), dict) else {}
    if bool(signal_summary.get('is_ambiguous_hybrid')) and workflow_kind in {'secret_code', 'hidden_content', 'image_puzzle'}:
        ambiguous_domains = [
            str(item or '').strip()
            for item in (signal_summary.get('ambiguous_domains') or [])
            if str(item or '').strip()
        ]
        if len(ambiguous_domains) >= 2:
            confidence = max(0.05, confidence - 0.1)

    return round(min(0.99, max(0.05, confidence)), 3)


def _get_step_control_block_reason(step_id: str, control: Optional[Dict[str, Any]]) -> Optional[str]:
    if not isinstance(control, dict):
        return None

    remaining = control.get('remaining') if isinstance(control.get('remaining'), dict) else {}
    status = str(control.get('status') or '').strip().lower()
    stop_reasons = [str(item or '').strip() for item in (control.get('stop_reasons') or []) if str(item or '').strip()]

    budget_reason = _get_step_budget_block_reason(step_id, remaining)
    if budget_reason:
        return budget_reason
    if status in {'stopped', 'budget_exhausted'} and stop_reasons:
        return stop_reasons[0]
    return None


def _apply_workflow_control_to_plan(plan: List[Dict[str, Any]], control: Dict[str, Any]) -> None:
    for step in plan:
        if step.get('status') != 'planned':
            continue
        step_id = str(step.get('id') or '')
        if step_id not in SUPPORTED_AUTOMATED_WORKFLOW_STEPS:
            continue
        reason = _get_step_control_block_reason(step_id, control)
        if reason:
            step['status'] = 'skipped'
            step['detail'] = reason


def _build_workflow_control(
    *,
    data: Dict[str, Any],
    workflow_kind: str,
    plan: List[Dict[str, Any]],
    classification: Dict[str, Any],
    execution: Dict[str, Any],
    previous_control: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    budget = _build_workflow_budget(data, workflow_kind, previous_control=previous_control)
    usage = _build_workflow_usage(execution, previous_control=previous_control)
    remaining = {
        'automated_steps': max(0, int(budget['max_automated_steps']) - int(usage['automated_steps'])),
        'metasolver_runs': max(0, int(budget['max_metasolver_runs']) - int(usage['metasolver_runs'])),
        'search_questions': max(0, int(budget['max_search_questions']) - int(usage['search_questions'])),
        'checker_runs': max(0, int(budget['max_checker_runs']) - int(usage['checker_runs'])),
        'coordinate_calculations': max(0, int(budget['max_coordinate_calculations']) - int(usage['coordinate_calculations'])),
        'vision_ocr_runs': max(0, int(budget['max_vision_ocr_runs']) - int(usage['vision_ocr_runs'])),
    }
    final_confidence = _estimate_workflow_final_confidence(workflow_kind, execution, classification)

    stop_reasons: List[str] = []
    if budget.get('stop_on_checker_success') and _checker_execution_succeeded(execution.get('checker')):
        stop_reasons.append('Le checker a valide l hypothese courante.')

    planned_supported_steps = [
        str(step.get('id') or '')
        for step in plan
        if step.get('status') == 'planned' and str(step.get('id') or '') in SUPPORTED_AUTOMATED_WORKFLOW_STEPS
    ]

    step_budget_reasons = {
        step_id: _get_step_budget_block_reason(step_id, remaining)
        for step_id in planned_supported_steps
    }

    requires_user_input = False
    if workflow_kind == 'formula':
        formula_payload = execution.get('formula') or {}
        formula_values = _derive_formula_values(data)
        if formula_payload.get('answer_search') and not formula_values and 'calculate-final-coordinates' in planned_supported_steps:
            requires_user_input = True
        elif 'search-answers' not in planned_supported_steps and 'calculate-final-coordinates' in planned_supported_steps and not formula_values:
            requires_user_input = True

    executable_steps = [
        step_id for step_id in planned_supported_steps
        if not step_budget_reasons.get(step_id)
    ]
    if not stop_reasons and planned_supported_steps and not executable_steps:
        unique_budget_reasons = [
            reason for reason in dict.fromkeys(step_budget_reasons.values()).keys()
            if reason
        ]
        stop_reasons.extend(unique_budget_reasons[:2] or ['Le budget d automatisation est epuise.'])

    can_run_next_step = bool(executable_steps) and not stop_reasons

    if stop_reasons and any('budget' in reason.lower() or 'epuise' in reason.lower() for reason in stop_reasons):
        status = 'budget_exhausted'
    elif stop_reasons:
        status = 'stopped'
    elif can_run_next_step:
        status = 'ready'
    elif requires_user_input:
        status = 'awaiting_input'
    else:
        status = 'completed'

    summary = {
        'ready': 'Des etapes automatisees restent executables.',
        'awaiting_input': 'L automatisation attend des valeurs ou une intervention utilisateur.',
        'budget_exhausted': 'Le budget d automatisation est epuise.',
        'stopped': 'Le workflow a atteint une condition d arret explicite.',
        'completed': 'Aucune etape automatisee restante.',
    }[status]

    return {
        'status': status,
        'budget': budget,
        'usage': usage,
        'remaining': remaining,
        'stop_reasons': list(dict.fromkeys(stop_reasons))[:6],
        'can_run_next_step': can_run_next_step,
        'requires_user_input': requires_user_input,
        'final_confidence': final_confidence,
        'summary': summary,
    }


def _build_resolution_plan(
    *,
    workflow_kind: str,
    classification: Dict[str, Any],
    secret_payload: Optional[Dict[str, Any]],
    formula_payload: Optional[Dict[str, Any]],
    auto_execute: bool,
) -> List[Dict[str, Any]]:
    plan: List[Dict[str, Any]] = [
        {
            'id': 'classify-listing',
            'title': 'Classifier le listing',
            'status': 'completed',
            'automated': True,
            'tool': 'geoapp.plugins.listing.classify',
            'detail': ', '.join(item.get('name') for item in (classification.get('labels') or []) if item.get('name')) or 'Aucun label fort',
        },
        {
            'id': 'choose-workflow',
            'title': f'Selectionner le workflow principal: {workflow_kind}',
            'status': 'completed',
            'automated': True,
            'tool': 'geoapp.plugins.workflow.resolve',
        },
    ]

    if workflow_kind == 'secret_code':
        selected_fragment = (secret_payload or {}).get('selected_fragment')
        direct_plugin_candidate = (secret_payload or {}).get('direct_plugin_candidate')
        direct_plugin_result = (secret_payload or {}).get('direct_plugin_result')
        recommendation = (secret_payload or {}).get('recommendation')
        metasolver_result = (secret_payload or {}).get('metasolver_result')
        plan.extend([
            {
                'id': 'extract-secret-fragment',
                'title': 'Extraire le meilleur fragment de code',
                'status': 'completed' if selected_fragment else 'blocked',
                'automated': True,
                'tool': 'geoapp.plugins.listing.classify',
                'detail': (selected_fragment or {}).get('text'),
            },
            {
                'id': 'execute-direct-plugin',
                'title': 'Executer directement le plugin le plus specifique',
                'status': 'completed' if direct_plugin_result else ('planned' if direct_plugin_candidate and direct_plugin_candidate.get('should_run_directly') else 'skipped'),
                'automated': bool(direct_plugin_candidate and direct_plugin_candidate.get('should_run_directly')),
                'tool': str((direct_plugin_candidate or {}).get('plugin_name') or ''),
                'detail': (direct_plugin_result or {}).get('summary') or (direct_plugin_candidate or {}).get('reason'),
            },
            {
                'id': 'recommend-metasolver-plugins',
                'title': 'Recommander une liste de plugins metasolver',
                'status': 'completed' if recommendation else 'blocked',
                'automated': True,
                'tool': 'geoapp.plugins.metasolver.recommend',
                'detail': ', '.join((recommendation or {}).get('selected_plugins') or []),
            },
            {
                'id': 'execute-metasolver',
                'title': 'Executer metasolver avec la sous-liste recommandee',
                'status': 'completed' if metasolver_result else ('planned' if auto_execute and recommendation else 'planned'),
                'automated': auto_execute,
                'tool': 'plugin.metasolver',
                'detail': (metasolver_result or {}).get('summary'),
            },
        ])
    elif workflow_kind == 'formula':
        plan.extend([
            {
                'id': 'detect-formulas',
                'title': 'Detecter les formules de coordonnees',
                'status': 'completed' if (formula_payload or {}).get('formula_count') else 'blocked',
                'automated': True,
                'tool': 'formula-solver.detect-formula',
                'detail': f"{(formula_payload or {}).get('formula_count', 0)} formule(s)",
            },
            {
                'id': 'extract-questions',
                'title': 'Associer les questions aux variables',
                'status': 'completed' if formula_payload is not None else 'planned',
                'automated': True,
                'tool': 'formula-solver.find-questions',
                'detail': f"{(formula_payload or {}).get('found_question_count', 0)} question(s) trouvee(s)",
            },
            {
                'id': 'search-answers',
                'title': 'Chercher les reponses factuelles manquantes',
                'status': 'planned',
                'automated': False,
                'tool': 'formula-solver.search-answer',
            },
            {
                'id': 'calculate-final-coordinates',
                'title': 'Calculer les coordonnees finales',
                'status': 'planned',
                'automated': False,
                'tool': 'formula-solver.calculate-coordinates',
            },
        ])
    elif workflow_kind == 'hidden_content':
        plan.append({
            'id': 'inspect-hidden-html',
            'title': 'Inspecter le HTML cache avant tout decodage',
            'status': 'planned',
            'automated': False,
            'tool': 'geoapp.plugins.listing.classify',
            'detail': 'Commentaires HTML, styles inline, classes/ids CSS caches, attributs hidden',
        })
    elif workflow_kind == 'image_puzzle':
        plan.extend([
            {
                'id': 'inspect-images',
                'title': 'Analyser les images et lancer OCR/QR si necessaire',
                'status': 'planned',
                'automated': False,
                'detail': f"{classification.get('signal_summary', {}).get('image_count', 0)} image(s) detectee(s)",
            },
            {
                'id': 'describe-images',
                'title': 'Identifier visuellement le contenu des images (contes, scenes, personnages)',
                'status': 'planned',
                'automated': False,
                'tool': 'geoapp.plugins.workflow.run-step',
                'detail': 'A executer si les images sont des illustrations sans texte lisible (OCR insuffisant)',
            },
        ])
    elif workflow_kind == 'coord_transform':
        plan.append({
            'id': 'compare-waypoints',
            'title': 'Comparer coordonnees publiees, waypoints et indices de projection',
            'status': 'planned',
            'automated': False,
            'detail': f"{classification.get('signal_summary', {}).get('waypoint_count', 0)} waypoint(s) disponible(s)",
        })

    if any(item.get('name') == 'checker_available' for item in (classification.get('labels') or [])):
        plan.append({
            'id': 'validate-with-checker',
            'title': 'Valider l hypothese finale avec le checker',
            'status': 'planned',
            'automated': False,
            'tool': 'geoapp.checkers.run',
        })

    return _inject_hybrid_review_steps(plan, classification)


def _resolve_workflow_orchestrator(
    data: Dict[str, Any],
    *,
    max_secret_fragments: int,
    max_plugins: int,
    auto_execute: bool,
) -> Dict[str, Any]:
    listing_inputs = _load_listing_analysis_inputs(data)
    classification_response = _build_listing_classification_response(listing_inputs, max_secret_fragments)
    workflow_candidates = _build_workflow_candidates(classification_response)

    preferred_workflow = _normalize_workflow_kind(data.get('preferred_workflow'))
    if preferred_workflow and preferred_workflow != 'general':
        forced_candidate = next((item for item in workflow_candidates if item['kind'] == preferred_workflow), None)
        if not forced_candidate:
            forced_candidate = {
                'kind': preferred_workflow,
                'confidence': 1.0,
                'score': 1.0,
                'reason': "Workflow force explicitement par la requete.",
                'supporting_labels': [],
            }
        workflow = {**forced_candidate, 'forced': True}
    elif workflow_candidates:
        workflow = {**_select_primary_workflow_candidate(workflow_candidates, classification_response), 'forced': False}
    else:
        workflow = {
            'kind': 'general',
            'confidence': 0.2,
            'score': 0.2,
            'reason': "Aucun workflow specialise ne ressort nettement du listing.",
            'supporting_labels': [],
            'forced': False,
        }

    secret_payload: Optional[Dict[str, Any]] = None
    formula_payload: Optional[Dict[str, Any]] = None
    hidden_payload: Optional[Dict[str, Any]] = None
    image_payload: Optional[Dict[str, Any]] = None
    explanation: List[str] = [
        f"Workflow principal: {workflow['kind']} ({workflow['confidence']:.2f})",
        workflow.get('reason') or '',
    ]
    signal_summary = classification_response.get('signal_summary') if isinstance(classification_response.get('signal_summary'), dict) else {}
    if bool(signal_summary.get('is_ambiguous_hybrid')):
        ambiguous_domains = [
            str(item or '').strip()
            for item in (signal_summary.get('ambiguous_domains') or [])
            if str(item or '').strip()
        ]
        if ambiguous_domains:
            explanation.append(
                "Listing hybride ambigu entre "
                + ' / '.join(ambiguous_domains)
                + ". Confirmer plusieurs domaines avant de figer la resolution."
            )

    if workflow['kind'] == 'secret_code':
        selected_fragment = _select_primary_secret_fragment(classification_response, listing_inputs)
        direct_plugin_candidate = None
        direct_plugin_result = None
        recommendation = None
        metasolver_result = None

        if selected_fragment and isinstance(selected_fragment, dict):
            fragment_text = str(selected_fragment.get('text') or '').strip()
            if fragment_text:
                recommendation = _recommend_metasolver_plugins_response(
                    text=fragment_text,
                    requested_preset=(str(data.get('metasolver_preset') or '')).strip().lower(),
                    mode=(str(data.get('metasolver_mode') or 'decode')).strip().lower(),
                    max_plugins=max_plugins,
                )
                direct_plugin_candidate = _build_secret_code_direct_plugin_candidate(
                    listing_inputs,
                    classification_response,
                    recommendation=recommendation,
                )
                if auto_execute:
                    if direct_plugin_candidate and direct_plugin_candidate.get('should_run_directly'):
                        direct_plugin_result = _execute_direct_plugin_candidate(direct_plugin_candidate)
                    if not _direct_plugin_result_succeeded(direct_plugin_result) and recommendation:
                        metasolver_inputs = {
                            'text': fragment_text,
                            'mode': recommendation.get('mode') or 'decode',
                            'preset': recommendation.get('effective_preset') or 'all',
                            'plugin_list': recommendation.get('plugin_list') or '',
                            'max_plugins': max_plugins,
                        }
                        metasolver_result = _summarize_plugin_results(
                            get_plugin_manager().execute_plugin('metasolver', metasolver_inputs)
                        )
                        metasolver_result = _attach_metasolver_geographic_plausibility(metasolver_result, listing_inputs)

        secret_payload = {
            'selected_fragment': selected_fragment,
            'direct_plugin_candidate': direct_plugin_candidate,
            'direct_plugin_result': direct_plugin_result,
            'recommendation': recommendation,
            'metasolver_result': metasolver_result,
        }
        if selected_fragment:
            explanation.append(
                f"Fragment principal: {str(selected_fragment.get('text') or '')[:80]}"
            )
        if direct_plugin_candidate:
            explanation.append(
                f"Plugin direct candidat: {direct_plugin_candidate.get('plugin_name')} ({float(direct_plugin_candidate.get('confidence') or 0.0):.2f})"
            )
        if direct_plugin_result:
            explanation.append(
                f"Plugin direct execute: {direct_plugin_result.get('plugin_name')} - {direct_plugin_result.get('summary')}"
            )
        if recommendation:
            explanation.append(
                f"Plugins metasolver recommandes: {', '.join(recommendation.get('selected_plugins') or [])}"
            )
    elif workflow['kind'] == 'formula':
        formula_text = '\n\n'.join(
            part for part in (
                listing_inputs.get('description') or '',
                listing_inputs.get('waypoint_text') or '',
                listing_inputs.get('hint') or '',
            )
            if part
        )
        formula_result = get_plugin_manager().execute_plugin('formula_parser', {'text': formula_text})
        formulas = [
            item for item in (formula_result.get('results') or [])
            if isinstance(item, dict)
        ]
        variables = _extract_formula_variables(formulas)

        from gc_backend.services.formula_questions_service import formula_questions_service

        content = listing_inputs.get('geocache_record') or formula_text
        questions = formula_questions_service.extract_questions_with_regex(content, variables) if variables else {}
        found_question_count = len([value for value in questions.values() if value])

        formula_payload = {
            'formula_count': len(formulas),
            'formulas': formulas[:3],
            'variables': variables,
            'questions': questions,
            'found_question_count': found_question_count,
        }
        explanation.append(f"Formules detectees: {len(formulas)}")
        if variables:
            explanation.append(f"Variables detectees: {', '.join(variables)}")
        if found_question_count:
            explanation.append(f"Questions trouvees: {found_question_count}/{len(variables)}")
    elif workflow['kind'] == 'hidden_content':
        hidden_info = _extract_hidden_content_signals(listing_inputs.get('description_html') or '')
        hidden_payload = {
            'inspected': False,
            'hidden_signals': hidden_info.get('signals') or [],
            'comments': hidden_info.get('comments') or [],
            'hidden_texts': hidden_info.get('hidden_texts') or [],
            'items': hidden_info.get('items') or [],
            'candidate_secret_fragments': [],
            'selected_fragment': None,
            'recommendation': None,
            'summary': (
                f"{len(hidden_info.get('signals') or [])} signal(s) HTML cache detecte(s)"
                if hidden_info.get('signals') else
                'Aucun contenu HTML cache detaille n a encore ete inspecte.'
            ),
        }
        if hidden_payload['hidden_signals']:
            explanation.append(
                f"Signaux HTML caches: {', '.join((hidden_payload.get('hidden_signals') or [])[:3])}"
            )
    elif workflow['kind'] == 'image_puzzle':
        image_payload = _build_image_puzzle_execution(
            listing_inputs=listing_inputs,
            data=data,
            max_secret_fragments=max_secret_fragments,
            max_plugins=max_plugins,
            include_plugin_runs=False,
            inspected=False,
            max_vision_ocr_cost_units=0,
        )
        if image_payload.get('image_count'):
            explanation.append(f"Images detectees: {int(image_payload.get('image_count') or 0)}")
        if image_payload.get('items'):
            explanation.append(
                f"Indices image: {', '.join(str(item.get('reason') or '') for item in (image_payload.get('items') or [])[:2])}"
            )

    plan = _build_resolution_plan(
        workflow_kind=workflow['kind'],
        classification=classification_response,
        secret_payload=secret_payload,
        formula_payload=formula_payload,
        auto_execute=auto_execute,
    )

    response: Dict[str, Any] = {
        'source': classification_response.get('source'),
        'geocache': classification_response.get('geocache'),
        'title': classification_response.get('title'),
        'workflow': workflow,
        'workflow_candidates': workflow_candidates,
        'classification': classification_response,
        'plan': plan,
        'execution': {
            'secret_code': secret_payload,
            'formula': formula_payload,
            'hidden_content': hidden_payload,
            'image_puzzle': image_payload,
            'checker': None,
        },
        'next_actions': _recompute_workflow_next_actions(plan, classification_response),
        'explanation': [item for item in explanation if item],
    }
    previous_control = _extract_previous_workflow_control(data)
    control = _build_workflow_control(
        data=data,
        workflow_kind=str(workflow['kind']),
        plan=plan,
        classification=classification_response,
        execution=response['execution'],
        previous_control=previous_control,
    )
    _apply_workflow_control_to_plan(plan, control)
    response['next_actions'] = _recompute_workflow_next_actions(plan, classification_response)
    response['control'] = control
    if control.get('stop_reasons'):
        response['explanation'].extend(
            reason for reason in control.get('stop_reasons')[:2]
            if reason not in response['explanation']
        )
    elif control.get('summary') and control['summary'] not in response['explanation']:
        response['explanation'].append(str(control['summary']))
    return response


def _run_workflow_step_orchestrator(
    data: Dict[str, Any],
    *,
    max_secret_fragments: int,
    max_plugins: int,
) -> Dict[str, Any]:
    workflow_resolution = _resolve_workflow_orchestrator(
        data,
        max_secret_fragments=max_secret_fragments,
        max_plugins=max_plugins,
        auto_execute=False,
    )
    plan = workflow_resolution.get('plan') or []
    classification = workflow_resolution.get('classification') or {}
    listing_inputs = _load_listing_analysis_inputs(data)
    control = workflow_resolution.get('control') or {}
    supported_step_ids = set(SUPPORTED_AUTOMATED_WORKFLOW_STEPS)

    target_step_id = str(data.get('target_step_id') or '').strip()
    selected_step: Optional[Dict[str, Any]] = None
    if target_step_id:
        selected_step = next((step for step in plan if str(step.get('id') or '') == target_step_id), None)
        if not selected_step:
            return {
                'status': 'blocked',
                'executed_step': None,
                'message': f"Etape inconnue ou indisponible: {target_step_id}",
                'step': None,
                'result': None,
                'workflow_resolution': workflow_resolution,
            }
        blocked_reason = _get_step_control_block_reason(target_step_id, control)
        if blocked_reason:
            return {
                'status': 'blocked',
                'executed_step': None,
                'message': blocked_reason,
                'step': selected_step,
                'result': None,
                'workflow_resolution': workflow_resolution,
            }
    else:
        selected_step = next(
            (
                step for step in plan
                if step.get('status') == 'planned'
                and str(step.get('id') or '') in supported_step_ids
                and _get_step_control_block_reason(str(step.get('id') or ''), control) is None
            ),
            None,
        )
        if not selected_step:
            return {
                'status': 'blocked',
                'executed_step': None,
                'message': str((control or {}).get('summary') or 'Aucune etape automatisable restante pour ce workflow.'),
                'step': None,
                'result': None,
                'workflow_resolution': workflow_resolution,
            }

    step_id = str(selected_step.get('id') or '')
    if step_id not in supported_step_ids:
        return {
            'status': 'blocked',
            'executed_step': None,
            'message': f"L etape '{step_id}' n est pas encore automatisable cote backend.",
            'step': selected_step,
            'result': None,
            'workflow_resolution': workflow_resolution,
        }

    execution = workflow_resolution.setdefault('execution', {})
    message = ''
    result_payload: Optional[Dict[str, Any]] = None

    if step_id == 'inspect-hidden-html':
        hidden_payload = _build_hidden_content_execution(
            listing_inputs=listing_inputs,
            data=data,
            max_secret_fragments=max_secret_fragments,
            max_plugins=max_plugins,
        )
        execution['hidden_content'] = hidden_payload
        detail = str(hidden_payload.get('summary') or 'Inspection HTML terminee.').strip()
        selected_step = _mark_plan_step(plan, step_id, status='completed', detail=detail, automated=True) or selected_step
        workflow_resolution['next_actions'] = _recompute_workflow_next_actions(plan, classification)
        if hidden_payload.get('selected_fragment'):
            workflow_resolution['next_actions'] = list(dict.fromkeys([
                'Appliquer la recommandation metasolver issue du fragment cache.',
                'Injecter le fragment cache principal dans metasolver ou le chat GeoApp.',
                *(workflow_resolution.get('next_actions') or []),
            ]))[:8]
        workflow_resolution.setdefault('explanation', []).append(f"Inspection HTML cache: {detail}")
        message = 'Inspection du HTML cache terminee.'
        result_payload = hidden_payload

    elif step_id == 'inspect-images':
        remaining_control = control.get('remaining') if isinstance(control.get('remaining'), dict) else {}
        image_payload = _build_image_puzzle_execution(
            listing_inputs=listing_inputs,
            data=data,
            max_secret_fragments=max_secret_fragments,
            max_plugins=max_plugins,
            max_vision_ocr_cost_units=max(0, int(remaining_control.get('vision_ocr_runs') or 0)),
        )
        execution['image_puzzle'] = image_payload
        detail = str(image_payload.get('summary') or 'Inspection images terminee.').strip()
        selected_step = _mark_plan_step(plan, step_id, status='completed', detail=detail, automated=True) or selected_step
        workflow_resolution['next_actions'] = _recompute_workflow_next_actions(plan, classification)
        if image_payload.get('selected_fragment'):
            workflow_resolution['next_actions'] = list(dict.fromkeys([
                'Appliquer la recommandation metasolver issue des indices image.',
                'Injecter le fragment image principal dans metasolver ou le chat GeoApp.',
                *(workflow_resolution.get('next_actions') or []),
            ]))[:8]
        workflow_resolution.setdefault('explanation', []).append(f"Inspection images: {detail}")
        message = 'Inspection des images terminee.'
        result_payload = image_payload

    elif step_id == 'describe-images':
        image_payload_existing = execution.get('image_puzzle') or {}
        image_urls_to_describe = image_payload_existing.get('image_urls') or []
        geocache_id = listing_inputs.get('geocache_id')
        explicit_images = listing_inputs.get('images') or []
        if not image_urls_to_describe and not explicit_images and geocache_id is None:
            return {
                'status': 'blocked',
                'executed_step': None,
                'message': 'Aucune image disponible pour la description visuelle. Lancez d abord inspect-images ou fournissez des images explicites.',
                'step': selected_step,
                'result': None,
                'workflow_resolution': workflow_resolution,
            }
        describe_inputs: Dict[str, Any] = {}
        if image_urls_to_describe:
            describe_inputs['images'] = [{'url': url} for url in image_urls_to_describe]
        elif explicit_images:
            describe_inputs['images'] = explicit_images
        if geocache_id is not None:
            describe_inputs['geocache_id'] = geocache_id
        context = str(data.get('describe_context') or '').strip()
        if context:
            describe_inputs['context'] = context
        describe_result = get_plugin_manager().execute_plugin('vision_describe', describe_inputs)
        describe_summary = str((describe_result or {}).get('summary') or '').strip()
        describe_items: List[Dict[str, Any]] = []
        for item in (describe_result or {}).get('results') or []:
            if not isinstance(item, dict):
                continue
            text_output = str(item.get('text_output') or '').strip()
            if not text_output:
                continue
            describe_items.append({
                'source': 'image_vision_description',
                'reason': 'Description visuelle IA (conte, scene, personnage identifie)',
                'text': text_output[:160],
                'image_url': str(item.get('image_url') or '').strip(),
                'confidence': item.get('confidence') if isinstance(item.get('confidence'), (int, float)) else None,
            })
        describe_payload: Dict[str, Any] = {
            'descriptions': describe_items,
            'images_analyzed': int((describe_result or {}).get('images_analyzed') or 0),
            'summary': describe_summary or 'Aucune description visuelle obtenue.',
        }
        image_payload_existing['describe_items'] = describe_items
        image_payload_existing['describe_summary'] = describe_summary
        existing_items: List[Dict[str, Any]] = image_payload_existing.get('items') or []
        seen_keys = {
            f"{str(it.get('source') or '')}:{str(it.get('image_url') or '')}:{str(it.get('text') or '').lower()}"
            for it in existing_items
        }
        for di in describe_items:
            key = f"image_vision_description:{str(di.get('image_url') or '')}:{str(di.get('text') or '').lower()}"
            if key not in seen_keys:
                existing_items.append(di)
                seen_keys.add(key)
        image_payload_existing['items'] = existing_items[:12]
        execution['image_puzzle'] = image_payload_existing
        detail = describe_summary or f"{len(describe_items)} description(s) visuelle(s)"
        selected_step = _mark_plan_step(plan, step_id, status='completed', detail=detail, automated=True) or selected_step
        workflow_resolution['next_actions'] = _recompute_workflow_next_actions(plan, classification)
        if describe_items:
            workflow_resolution['next_actions'] = list(dict.fromkeys([
                'Utiliser les descriptions visuelles pour identifier les contes, scenes ou personnages.',
                'Compter les mots des titres identifies et les associer aux variables de la formule.',
                *(workflow_resolution.get('next_actions') or []),
            ]))[:8]
        workflow_resolution.setdefault('explanation', []).append(f"Description visuelle: {detail}")
        message = 'Description visuelle des images terminee.'
        result_payload = describe_payload

    elif step_id == 'execute-direct-plugin':
        secret_payload = execution.get('secret_code') or {}
        direct_plugin_candidate = secret_payload.get('direct_plugin_candidate') or {}
        if not direct_plugin_candidate or not direct_plugin_candidate.get('plugin_name'):
            return {
                'status': 'blocked',
                'executed_step': None,
                'message': 'Aucun plugin direct suffisamment fiable n est disponible pour ce fragment.',
                'step': selected_step,
                'result': None,
                'workflow_resolution': workflow_resolution,
            }

        direct_plugin_result = _execute_direct_plugin_candidate(direct_plugin_candidate)
        secret_payload['direct_plugin_result'] = direct_plugin_result
        execution['secret_code'] = secret_payload
        detail = direct_plugin_result.get('summary') or f"{direct_plugin_result.get('results_count', 0)} resultat(s)"
        selected_step = _mark_plan_step(plan, step_id, status='completed', detail=detail, automated=True) or selected_step
        workflow_resolution['next_actions'] = _recompute_workflow_next_actions(plan, classification)
        workflow_resolution.setdefault('explanation', []).append(
            f"Plugin direct execute: {direct_plugin_result.get('plugin_name')} - {detail}"
        )
        message = f"Plugin direct execute: {direct_plugin_result.get('plugin_name')}"
        result_payload = {
            'selected_fragment': secret_payload.get('selected_fragment'),
            'direct_plugin_candidate': direct_plugin_candidate,
            'direct_plugin_result': direct_plugin_result,
            'recommendation': secret_payload.get('recommendation'),
            'metasolver_result': secret_payload.get('metasolver_result'),
        }

    elif step_id == 'execute-metasolver':
        secret_payload = execution.get('secret_code') or {}
        selected_fragment = secret_payload.get('selected_fragment') or {}
        recommendation = secret_payload.get('recommendation') or {}
        fragment_text = str(selected_fragment.get('text') or '').strip()
        if not fragment_text or not recommendation:
            return {
                'status': 'blocked',
                'executed_step': None,
                'message': 'Aucun fragment secret ou aucune recommandation metasolver disponible.',
                'step': selected_step,
                'result': None,
                'workflow_resolution': workflow_resolution,
            }

        metasolver_inputs = {
            'text': fragment_text,
            'mode': recommendation.get('mode') or 'decode',
            'preset': recommendation.get('effective_preset') or 'all',
            'plugin_list': recommendation.get('plugin_list') or '',
            'max_plugins': max_plugins,
        }
        metasolver_result = _summarize_plugin_results(
            get_plugin_manager().execute_plugin('metasolver', metasolver_inputs)
        )
        metasolver_result = _attach_metasolver_geographic_plausibility(metasolver_result, listing_inputs)
        secret_payload['metasolver_result'] = metasolver_result
        execution['secret_code'] = secret_payload
        detail = metasolver_result.get('summary') or f"{metasolver_result.get('results_count', 0)} resultat(s)"
        selected_step = _mark_plan_step(plan, step_id, status='completed', detail=detail, automated=True) or selected_step
        workflow_resolution['next_actions'] = _recompute_workflow_next_actions(plan, classification)
        workflow_resolution.setdefault('explanation', []).append(f"Metasolver execute: {detail}")
        message = 'Metasolver execute sur le fragment principal.'
        result_payload = {
            'selected_fragment': selected_fragment,
            'direct_plugin_candidate': secret_payload.get('direct_plugin_candidate'),
            'direct_plugin_result': secret_payload.get('direct_plugin_result'),
            'recommendation': recommendation,
            'metasolver_result': metasolver_result,
        }

    elif step_id == 'search-answers':
        formula_payload = execution.get('formula') or {}
        questions = formula_payload.get('questions') or {}
        searchable_questions = {
            str(variable).strip().upper(): str(question).strip()
            for variable, question in questions.items()
            if str(question or '').strip()
        }
        if not searchable_questions:
            return {
                'status': 'blocked',
                'executed_step': None,
                'message': 'Aucune question exploitable a rechercher pour ce workflow formule.',
                'step': selected_step,
                'result': None,
                'workflow_resolution': workflow_resolution,
            }

        from gc_backend.services.web_search_service import web_search_service

        remaining_search_budget = int(((control.get('remaining') or {}).get('search_questions') or 0))
        if remaining_search_budget > 0:
            ordered_questions = list(searchable_questions.items())
            searchable_questions = dict(ordered_questions[:remaining_search_budget])
        if not searchable_questions:
            return {
                'status': 'blocked',
                'executed_step': None,
                'message': 'Le budget de recherche web est epuise pour ce workflow.',
                'step': selected_step,
                'result': None,
                'workflow_resolution': workflow_resolution,
            }

        search_context_parts = [
            str(listing_inputs.get('title') or '').strip(),
            str(listing_inputs.get('hint') or '').strip(),
            str(data.get('search_context') or '').strip(),
        ]
        search_context = ' | '.join(part for part in search_context_parts if part)
        max_results = data.get('max_search_results', 5)
        try:
            max_results = max(1, min(10, int(max_results)))
        except (TypeError, ValueError):
            max_results = 5

        answers: Dict[str, Any] = {}
        found_count = 0
        missing: List[str] = []
        for variable, question in searchable_questions.items():
            results = web_search_service.search(question, search_context or None, max_results)
            best_answer = web_search_service.extract_answer(results)
            if best_answer:
                found_count += 1
            else:
                missing.append(variable)
            suggestions = _suggest_formula_value_candidates(best_answer, question) if best_answer else []
            answers[variable] = {
                'question': question,
                'best_answer': best_answer,
                'results': results[:3],
                'suggested_values': suggestions,
                'recommended_value_type': (suggestions[0] if suggestions else {}).get('type'),
            }

        answer_search = {
            'answers': answers,
            'found_count': found_count,
            'missing': missing,
            'search_context': search_context,
        }
        formula_payload['answer_search'] = answer_search
        execution['formula'] = formula_payload
        detail = f"{found_count}/{len(searchable_questions)} reponse(s) trouvee(s)"
        selected_step = _mark_plan_step(plan, step_id, status='completed', detail=detail, automated=True) or selected_step
        workflow_resolution['next_actions'] = _recompute_workflow_next_actions(plan, classification)
        workflow_resolution.setdefault('explanation', []).append(f"Recherche web des reponses: {detail}")
        message = 'Recherche web terminee pour les questions de formule.'
        result_payload = answer_search

    elif step_id == 'calculate-final-coordinates':
        formula_payload = execution.get('formula') or {}
        formulas = formula_payload.get('formulas') or []
        if not formulas:
            return {
                'status': 'blocked',
                'executed_step': None,
                'message': 'Aucune formule exploitable pour calculer les coordonnees.',
                'step': selected_step,
                'result': None,
                'workflow_resolution': workflow_resolution,
            }

        try:
            formula_index = int(data.get('formula_index', 0))
        except (TypeError, ValueError):
            formula_index = 0
        if formula_index < 0 or formula_index >= len(formulas):
            formula_index = 0

        selected_formula = formulas[formula_index]
        north_formula, east_formula = _extract_formula_coordinates(selected_formula)
        if not north_formula or not east_formula:
            return {
                'status': 'blocked',
                'executed_step': None,
                'message': 'La formule selectionnee ne contient pas de composantes nord/est exploitables.',
                'step': selected_step,
                'result': None,
                'workflow_resolution': workflow_resolution,
            }

        values = _derive_formula_values(data)
        if not values:
            return {
                'status': 'blocked',
                'executed_step': None,
                'message': 'Aucune valeur de variable fournie pour le calcul final.',
                'step': selected_step,
                'result': None,
                'workflow_resolution': workflow_resolution,
            }

        from gc_backend.utils.coordinate_calculator import CoordinateCalculator

        calculator = CoordinateCalculator()
        calculation = calculator.calculate_coordinates(north_formula, east_formula, values)
        if calculation.get('status') == 'error':
            return {
                'status': 'error',
                'executed_step': None,
                'message': str(calculation.get('error') or 'Erreur de calcul des coordonnees'),
                'step': selected_step,
                'result': calculation,
                'workflow_resolution': workflow_resolution,
            }

        geocache_record = listing_inputs.get('geocache_record')
        if geocache_record and geocache_record.latitude is not None and geocache_record.longitude is not None:
            distance_km = calculator.calculate_distance(
                geocache_record.latitude,
                geocache_record.longitude,
                calculation['coordinates']['latitude'],
                calculation['coordinates']['longitude'],
            )
            calculation['distance'] = {
                'km': round(distance_km, 2),
                'miles': round(distance_km * 0.621371, 2),
            }
        geographic_plausibility = _build_geographic_plausibility(calculation.get('coordinates'), listing_inputs)
        if geographic_plausibility:
            calculation['geographic_plausibility'] = geographic_plausibility

        calculated_coordinates = {
            'formula_index': formula_index,
            'north_formula': north_formula,
            'east_formula': east_formula,
            'values': values,
            **calculation,
        }
        formula_payload['calculated_coordinates'] = calculated_coordinates
        execution['formula'] = formula_payload
        coordinates_detail = (
            ((calculation.get('coordinates') or {}).get('ddm'))
            or ((calculation.get('coordinates') or {}).get('decimal'))
            or 'Coordonnees calculees'
        )
        selected_step = _mark_plan_step(plan, step_id, status='completed', detail=coordinates_detail, automated=True) or selected_step
        workflow_resolution['next_actions'] = _recompute_workflow_next_actions(plan, classification)
        workflow_resolution.setdefault('explanation', []).append(f"Coordonnees calculees: {coordinates_detail}")
        message = 'Coordonnees finales calculees.'
        result_payload = calculated_coordinates

    elif step_id == 'validate-with-checker':
        candidate = _resolve_checker_candidate(data, workflow_resolution)
        if not candidate:
            return {
                'status': 'blocked',
                'executed_step': None,
                'message': 'Aucun candidat exploitable pour le checker. Fournissez checker_candidate ou calculez d abord une hypothese.',
                'step': selected_step,
                'result': None,
                'workflow_resolution': workflow_resolution,
            }

        target = _resolve_checker_target(listing_inputs, data)
        try:
            checker_result = _run_checker_with_target(
                url=target['url'],
                candidate=candidate,
                wp=target.get('wp'),
                interactive=bool(target.get('interactive')),
                provider=str(target.get('provider') or 'generic'),
                auto_login=bool(data.get('checker_auto_login', True)),
                login_timeout_sec=int(data.get('checker_login_timeout_sec') or 180),
                timeout_sec=int(data.get('checker_timeout_sec') or 300),
            )
        except RuntimeError as checker_runtime_error:
            return {
                'status': 'blocked',
                'executed_step': None,
                'message': str(checker_runtime_error),
                'step': selected_step,
                'result': None,
                'workflow_resolution': workflow_resolution,
            }

        checker_payload = {
            'checker_name': target.get('name'),
            'checker_url': target.get('url'),
            'provider': target.get('provider'),
            'interactive': bool(target.get('interactive')),
            'candidate': candidate,
            'wp': target.get('wp'),
            'result': checker_result.get('result'),
            'status': checker_result.get('status'),
            'message': checker_result.get('message'),
        }
        execution['checker'] = checker_payload

        raw_result = checker_result.get('result') or {}
        result_status = str(raw_result.get('status') or checker_result.get('status') or '').strip().lower()
        result_message = str(raw_result.get('message') or checker_result.get('message') or '').strip()
        if checker_result.get('status') == 'requires_login':
            selected_step = _mark_plan_step(plan, step_id, status='blocked', detail=checker_result.get('message'), automated=False) or selected_step
            workflow_resolution['next_actions'] = _recompute_workflow_next_actions(plan, classification)
            workflow_resolution.setdefault('explanation', []).append(str(checker_result.get('message') or 'Checker requires login'))
            return {
                'status': 'blocked',
                'executed_step': None,
                'message': str(checker_result.get('message') or 'Checker requires login'),
                'step': selected_step,
                'result': checker_payload,
                'workflow_resolution': workflow_resolution,
            }

        detail = result_message or f"Checker status: {result_status or 'unknown'}"
        selected_step = _mark_plan_step(plan, step_id, status='completed', detail=detail, automated=True) or selected_step
        workflow_resolution['next_actions'] = _recompute_workflow_next_actions(plan, classification)
        workflow_resolution.setdefault('explanation', []).append(f"Checker execute: {detail}")
        message = 'Validation checker executee.'
        result_payload = checker_payload

    updated_control = _build_workflow_control(
        data=data,
        workflow_kind=str((workflow_resolution.get('workflow') or {}).get('kind') or 'general'),
        plan=plan,
        classification=classification,
        execution=execution,
        previous_control=_extract_previous_workflow_control(data),
    )
    _apply_workflow_control_to_plan(plan, updated_control)
    workflow_resolution['next_actions'] = _recompute_workflow_next_actions(plan, classification)
    workflow_resolution['control'] = updated_control
    if updated_control.get('stop_reasons'):
        for reason in updated_control.get('stop_reasons')[:2]:
            if reason not in workflow_resolution.setdefault('explanation', []):
                workflow_resolution['explanation'].append(reason)

    if step_id == 'describe-images' and isinstance(result_payload, dict) and (result_payload.get('descriptions') or []):
        workflow_resolution['next_actions'] = list(dict.fromkeys([
            'Utiliser les descriptions visuelles pour identifier les contes, scenes ou personnages.',
            'Compter les mots des titres identifies et les associer aux variables de la formule.',
            *(workflow_resolution.get('next_actions') or []),
        ]))[:8]

    return {
        'status': 'success',
        'executed_step': step_id,
        'message': message,
        'step': selected_step,
        'result': result_payload,
        'workflow_resolution': workflow_resolution,
    }

