"""Orchestration des workflows pour le blueprint plugins.

Regroupe la planification, la selection des candidats, les checkers de
coordonnees et les routes ``/workflow/*``.
"""

import re
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse
from flask import jsonify, request
from loguru import logger
from typing import Dict, Any, List, Optional, Tuple


from ._common import (
    _normalize_bool,
    _normalize_positive_int,
    bp,
    get_plugin_manager,
)
from .listing import (
    DIRECT_SECRET_FRAGMENT_SOURCES,
    HIDDEN_SECRET_FRAGMENT_SOURCES,
    IMAGE_SECRET_FRAGMENT_SOURCES,
    PI_THEME_PATTERN,
    _build_geographic_plausibility,
    _build_hidden_content_execution,
    _build_image_puzzle_execution,
    _build_listing_classification_response,
    _extract_decimal_coordinates,
    _extract_hidden_content_signals,
    _extract_pi_coordinate_position_sequences,
    _load_listing_analysis_inputs,
    _recommend_metasolver_plugins_response,
)
from .metasolver import (
    _normalize_max_plugins,
)

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
        if exact_hint and (
            exact_hint is fragments[0]
            or float(exact_hint.get('confidence') or 0.0) >= 0.5
            or float(exact_hint.get('score') or 0.0) >= 50.0
        ):
            return exact_hint

    title = str(listing_inputs.get('title') or '').strip()
    if title:
        exact_title = next((item for item in fragments if str(item.get('text') or '').strip() == title), None)
        if exact_title and (
            exact_title is fragments[0]
            or float(exact_title.get('confidence') or 0.0) >= 0.5
            or float(exact_title.get('score') or 0.0) >= 50.0
        ):
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


def _select_primary_workflow(
    data: Dict[str, Any],
    classification_response: Dict[str, Any],
) -> Tuple[Dict[str, Any], List[Dict[str, Any]]]:
    """Choisit le workflow principal a partir d'une classification deja calculee.

    Retourne le couple (workflow choisi, liste des candidats). Partage par
    l'orchestrateur complet (_resolve_workflow_orchestrator) et par l'apercu leger
    (/workflow/preview) pour garantir une decision identique.
    """
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
        return {**forced_candidate, 'forced': True}, workflow_candidates
    if workflow_candidates:
        return {**_select_primary_workflow_candidate(workflow_candidates, classification_response), 'forced': False}, workflow_candidates
    return {
        'kind': 'general',
        'confidence': 0.2,
        'score': 0.2,
        'reason': "Aucun workflow specialise ne ressort nettement du listing.",
        'supporting_labels': [],
        'forced': False,
    }, workflow_candidates


def _resolve_workflow_orchestrator(
    data: Dict[str, Any],
    *,
    max_secret_fragments: int,
    max_plugins: int,
    auto_execute: bool,
) -> Dict[str, Any]:
    listing_inputs = _load_listing_analysis_inputs(data)
    classification_response = _build_listing_classification_response(listing_inputs, max_secret_fragments)
    workflow, workflow_candidates = _select_primary_workflow(data, classification_response)

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


@bp.route('/workflow/preview', methods=['POST'])
def preview_workflow():
    """Apercu leger du workflow principal d'un listing.

    Execute la meme decision que /workflow/resolve (classification -> candidats ->
    candidat primaire) mais s'arrete avant la construction des payloads et toute
    execution de plugin. Concu pour l'apercu de routage du Chat IA a l'ouverture
    d'une geocache, ou seul `workflow.kind` est necessaire.

    Request body:
        { "geocache_id": 123, "preferred_workflow": "secret_code" }
    """
    try:
        data = request.get_json(force=True)
    except Exception as json_error:
        return jsonify({
            "error": "JSON invalide",
            "message": f"Le body doit etre un JSON valide: {str(json_error)}"
        }), 400

    if not data or not isinstance(data, dict):
        return jsonify({
            "error": "Requete invalide",
            "message": "Le body doit etre un objet JSON"
        }), 400

    max_secret_fragments = _normalize_max_plugins(data.get('max_secret_fragments'), default=6)

    try:
        listing_inputs = _load_listing_analysis_inputs(data)
        classification_response = _build_listing_classification_response(listing_inputs, max_secret_fragments)
        workflow, _workflow_candidates = _select_primary_workflow(data, classification_response)
        labels = [
            {'name': item.get('name'), 'confidence': item.get('confidence')}
            for item in (classification_response.get('labels') or [])
            if isinstance(item, dict)
        ]
        return jsonify({
            'workflow': {
                'kind': workflow.get('kind'),
                'confidence': workflow.get('confidence'),
                'reason': workflow.get('reason'),
                'forced': workflow.get('forced', False),
            },
            'classification': {'labels': labels},
        }), 200
    except ValueError as value_error:
        return jsonify({"error": "Requete invalide", "message": str(value_error)}), 400
    except LookupError as lookup_error:
        return jsonify({"error": "Geocache introuvable", "message": str(lookup_error)}), 404
    except Exception as e:
        logger.error(f"Erreur apercu workflow: {e}", exc_info=True)
        raise


@bp.route('/workflow/resolve', methods=['POST'])
def resolve_workflow():
    """
    Orchestre la resolution initiale d'un listing:
    - classification
    - choix du workflow principal
    - pre-analyse deterministe du workflow
    - execution optionnelle du metasolver sur le premier fragment secret

    Request body:
        {
            "geocache_id": 123,
            "preferred_workflow": "secret_code",
            "auto_execute": false,
            "max_secret_fragments": 6,
            "max_plugins": 8
        }
    """
    try:
        data = request.get_json(force=True)
    except Exception as json_error:
        return jsonify({
            "error": "JSON invalide",
            "message": f"Le body doit etre un JSON valide: {str(json_error)}"
        }), 400

    if not data or not isinstance(data, dict):
        return jsonify({
            "error": "Requete invalide",
            "message": "Le body doit etre un objet JSON"
        }), 400

    max_secret_fragments = _normalize_max_plugins(data.get('max_secret_fragments'), default=6)
    max_plugins = _normalize_max_plugins(data.get('max_plugins'), default=8)
    auto_execute = bool(data.get('auto_execute', False))

    try:
        payload = _resolve_workflow_orchestrator(
            data,
            max_secret_fragments=max_secret_fragments,
            max_plugins=max_plugins,
            auto_execute=auto_execute,
        )
        return jsonify(payload), 200
    except ValueError as value_error:
        return jsonify({
            "error": "Requete invalide",
            "message": str(value_error)
        }), 400
    except LookupError as lookup_error:
        return jsonify({
            "error": "Geocache introuvable",
            "message": str(lookup_error)
        }), 404
    except Exception as e:
        logger.error(f"Erreur orchestrateur workflow: {e}", exc_info=True)
        return jsonify({
            "error": "Erreur orchestrateur workflow",
            "message": str(e)
        }), 500


@bp.route('/workflow/run-next-step', methods=['POST'])
def run_workflow_next_step():
    """
    Execute la prochaine etape automatisable de l orchestrateur, ou une etape ciblee.

    Request body:
        {
            "geocache_id": 123,
            "target_step_id": "search-answers",
            "formula_answers": {"A": "42"},
            "formula_value_types": {"A": "value"},
            "formula_values": {"B": 5}
        }
    """
    try:
        data = request.get_json(force=True)
    except Exception as json_error:
        return jsonify({
            "error": "JSON invalide",
            "message": f"Le body doit etre un JSON valide: {str(json_error)}"
        }), 400

    if not data or not isinstance(data, dict):
        return jsonify({
            "error": "Requete invalide",
            "message": "Le body doit etre un objet JSON"
        }), 400

    max_secret_fragments = _normalize_max_plugins(data.get('max_secret_fragments'), default=6)
    max_plugins = _normalize_max_plugins(data.get('max_plugins'), default=8)

    try:
        payload = _run_workflow_step_orchestrator(
            data,
            max_secret_fragments=max_secret_fragments,
            max_plugins=max_plugins,
        )
        return jsonify(payload), 200
    except ValueError as value_error:
        return jsonify({
            "error": "Requete invalide",
            "message": str(value_error)
        }), 400
    except LookupError as lookup_error:
        return jsonify({
            "error": "Geocache introuvable",
            "message": str(lookup_error)
        }), 404
    except Exception as e:
        logger.error(f"Erreur execution workflow step: {e}", exc_info=True)
        return jsonify({
            "error": "Erreur execution workflow step",
            "message": str(e)
        }), 500
