"""Endpoints de scoring du blueprint plugins (/score et /ai-score)."""

from flask import jsonify, request
from loguru import logger
from typing import Dict, Any, List


from ._common import (
    _scoring_context_from_inputs,
    bp,
)

@bp.route('/score', methods=['POST'])
def score_text_endpoint():
    try:
        try:
            data = request.get_json(force=True)
        except Exception as json_error:
            return jsonify({
                "error": "JSON invalide",
                "message": f"Le body de la requête doit être un JSON valide: {str(json_error)}"
            }), 400

        if not data or not isinstance(data, dict):
            return jsonify({
                "error": "Requête invalide",
                "message": "Le body doit être un objet JSON"
            }), 400

        context = data.get('context')
        if context is not None and not isinstance(context, dict):
            return jsonify({
                "error": "Requête invalide",
                "message": "Le champ 'context' doit être un objet"
            }), 400

        from gc_backend.plugins.scoring import score_text

        # Contexte geographique : `context.origin_coords` fourni tel quel, ou
        # deduit de `geocache_id` / `origin_coords` places a la racine du body.
        if not (context or {}).get('origin_coords') and (context or {}).get('origin_latitude') is None:
            context = {**(context or {}), **_scoring_context_from_inputs(data)}

        if 'texts' in data:
            texts = data.get('texts')
            if not isinstance(texts, list) or not all(isinstance(t, str) for t in texts):
                return jsonify({
                    "error": "Requête invalide",
                    "message": "Le champ 'texts' doit être une liste de strings"
                }), 400

            results: List[Dict[str, Any]] = []
            for t in texts:
                results.append(score_text(t, context=context or {}))
            return jsonify({"results": results}), 200

        text = data.get('text')
        if not isinstance(text, str):
            return jsonify({
                "error": "Requête invalide",
                "message": "Le champ 'text' (string) est requis"
            }), 400

        return jsonify(score_text(text, context=context or {})), 200

    except Exception as e:
        logger.error(f"Erreur scoring: {e}", exc_info=True)
        return jsonify({
            "error": "Erreur scoring",
            "message": str(e)
        }), 500


# =============================================================================
# Route AI Scorer
# =============================================================================

@bp.route('/ai-score', methods=['POST'])
def ai_score_endpoint():
    """Analyse et score des resultats de plugin via un LLM OpenAI-compatible.

    Body JSON: {items: [{text_output: str, ...}, ...], plugin_name, provider,
    base_url, model, api_key, timeout_sec}
    """
    try:
        data = request.get_json(force=True)
    except Exception as exc:
        return jsonify({'error': 'JSON invalide', 'message': str(exc)}), 400

    if not data or not isinstance(data, dict):
        return jsonify({'error': 'Requete invalide', 'message': 'Body JSON attendu'}), 400

    items = data.get('items')
    if not isinstance(items, list) or not items:
        return jsonify({'error': 'Requete invalide', 'message': "Le champ 'items' (liste) est requis"}), 400

    for i, item in enumerate(items):
        if not isinstance(item, dict):
            return jsonify({'error': 'Requete invalide', 'message': f'items[{i}] doit etre un objet'}), 400
        if not isinstance(item.get('text_output'), str):
            return jsonify({'error': 'Requete invalide', 'message': f'items[{i}].text_output (string) requis'}), 400

    plugin_name = str(data.get('plugin_name') or 'unknown')
    timeout_sec = int(data.get('timeout_sec') or 90)

    try:
        from ...utils.preferences import get_value_or_default
        # Fournisseur dedie AI Scorer (priorite sur le fournisseur OCR)
        scorer_provider_pref = get_value_or_default('geoApp.aiScorer.provider', 'auto')
        if scorer_provider_pref == 'auto':
            # Si une cle OpenRouter est configuree, on l'utilise pour le scorer
            # (le scorer est un LLM texte, pas une vision - OpenRouter est preferable si disponible)
            or_api_key = get_value_or_default('geoApp.ai.openRouter.apiKey', '')
            if or_api_key and or_api_key.strip():
                pref_provider = 'openrouter'
            else:
                pref_provider = get_value_or_default('geoApp.ocr.visionProvider', 'lmstudio')
        else:
            pref_provider = scorer_provider_pref
        if pref_provider == 'openrouter':
            pref_base_url = get_value_or_default('geoApp.ai.openRouter.baseUrl', 'https://openrouter.ai/api/v1')
            pref_model = (
                get_value_or_default('geoApp.aiScorer.openRouter.model', '')
                or get_value_or_default('geoApp.ai.openRouter.model.strong', 'openai/gpt-4o')
            )
            pref_api_key = get_value_or_default('geoApp.ai.openRouter.apiKey', '')
        else:
            pref_base_url = get_value_or_default('geoApp.ocr.lmstudio.baseUrl', 'http://localhost:1234')
            pref_model = (
                get_value_or_default('geoApp.aiScorer.lmstudio.model', '')
                or get_value_or_default('geoApp.ocr.lmstudio.model', '')
            )
            pref_api_key = ''
    except Exception:
        pref_provider = 'lmstudio'
        pref_base_url = 'http://localhost:1234'
        pref_model = ''
        pref_api_key = ''

    provider = str(data.get('provider') or pref_provider)
    base_url = str(data.get('base_url') or pref_base_url)
    model = str(data.get('model') or pref_model or '').strip()
    api_key = str(data.get('api_key') or pref_api_key or '')

    # En mode LMStudio, si le modele n'est pas configure, interroger /v1/models
    # pour recuperer le premier modele charge (comportement par defaut de LMStudio)
    if not model and provider != 'openrouter':
        try:
            import requests as _req
            from ...services.ocr.lmstudio_vision_service import normalize_openai_compatible_base_url
            v1 = normalize_openai_compatible_base_url(base_url, 'http://localhost:1234')
            r = _req.get(f"{v1}/models", timeout=3)
            if r.ok:
                models_data = r.json().get('data') or []
                if models_data:
                    model = models_data[0].get('id', '')
                    logger.info("[ai_scorer] Modele LMStudio auto-detecte: %s", model)
        except Exception as _me:
            logger.warning("[ai_scorer] Impossible d'auto-detecter le modele LMStudio: %s", _me)

    if not model:
        return jsonify({
            'error': 'Modele manquant',
            'message': (
                "Aucun modele configure. "
                "Pour LMStudio : chargez un modele dans LMStudio ou configurez geoApp.ocr.lmstudio.model. "
                "Pour OpenRouter : configurez geoApp.ocr.visionProvider = openrouter."
            ),
        }), 400

    try:
        from ...services.ai_scorer_service import ai_score_results
        enriched = ai_score_results(
            items,
            base_url=base_url,
            model=model,
            api_key=api_key if api_key else None,
            provider=provider,
            plugin_name=plugin_name,
            timeout_sec=timeout_sec,
        )
        reported_models = set()
        usage_by_batch: dict = {}
        failed_count = 0
        first_failure = None
        for item in enriched:
            metadata = item.get('metadata') if isinstance(item, dict) else None
            scoring = metadata.get('ai_scoring') if isinstance(metadata, dict) else None
            if not isinstance(scoring, dict):
                continue
            if scoring.get('failed'):
                failed_count += 1
                if first_failure is None:
                    first_failure = scoring.get('explanation') or None
            reported_model = scoring.get('reported_model')
            if isinstance(reported_model, str) and reported_model.strip():
                reported_models.add(reported_model.strip())
            usage = scoring.get('usage')
            batch_index = scoring.get('batch_index')
            if isinstance(usage, dict):
                usage_by_batch[str(batch_index or 0)] = usage
        usage = {}
        for key in ('input_tokens', 'output_tokens', 'total_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens'):
            if usage_by_batch and all(isinstance(part.get(key), int) for part in usage_by_batch.values()):
                usage[key] = sum(part[key] for part in usage_by_batch.values())
        # Les items en echec gardent leur confiance d'origine (voir ai_score_results) ;
        # le statut dit a l'appelant combien n'ont pas ete analyses.
        if failed_count == 0:
            status = 'ok'
        elif failed_count < len(enriched):
            status = 'partial'
        else:
            status = 'failed'
        return jsonify({
            'status': status,
            'items': enriched,
            'count': len(enriched),
            'failed_count': failed_count,
            'failure_message': first_failure,
            'provider': provider,
            'model': model,
            'reported_model': next(iter(reported_models)) if len(reported_models) == 1 else None,
            'reported_models': sorted(reported_models),
            'usage': usage or None,
        }), 200
    except Exception as exc:
        logger.error('Erreur ai-score: %s', exc, exc_info=True)
        raise
