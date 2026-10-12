"""Endpoints metasolver du blueprint plugins.

Expose les alias underscore vers ``gc_backend.services.metasolver_analysis``
ainsi que les routes ``/metasolver/*``.
"""

import json
import threading
from flask import jsonify, request
from loguru import logger

from ...services.metasolver_analysis import (
    load_metasolver_presets,
    matches_metasolver_filter,
    analyze_metasolver_signature,
    score_metasolver_candidate,
    collect_metasolver_candidates,
    normalize_max_plugins,
    extract_metasolver_key_fields,
)

from ._common import (
    bp,
    get_plugin_manager,
)
from .listing import (
    _recommend_metasolver_plugins_response,
)

# Alias avec prefixe underscore pour preserver les call sites existants du
# blueprint qui utilisent les anciennes copies privees. Ces alias pointent
# desormais vers l'implementation canonique du service metasolver_analysis.
_load_metasolver_presets = load_metasolver_presets


_matches_metasolver_filter = matches_metasolver_filter


_analyze_metasolver_signature = analyze_metasolver_signature


_score_metasolver_candidate = score_metasolver_candidate


_collect_metasolver_candidates = collect_metasolver_candidates


_normalize_max_plugins = normalize_max_plugins


_extract_metasolver_key_fields = extract_metasolver_key_fields


@bp.route('/metasolver/eligible', methods=['GET'])
def metasolver_eligible_plugins():
    """
    Liste les plugins éligibles au metasolver, optionnellement filtrés par preset.

    Query Parameters:
        preset (str, optional): Nom du preset à appliquer (défaut: 'all')

    Returns:
        JSON: {
            "preset": nom du preset,
            "preset_filter": filtre appliqué,
            "plugins": [ {name, description, input_charset, tags, priority} ],
            "total": nombre total
        }

    Example:
        GET /api/plugins/metasolver/eligible
        GET /api/plugins/metasolver/eligible?preset=frequent
    """
    try:
        manager = get_plugin_manager()
        preset_name = (request.args.get('preset') or 'all').lower()
        presets = _load_metasolver_presets(manager)
        preset_info = presets.get(preset_name, {})
        preset_filter = preset_info.get('filter', {})
        eligible = _collect_metasolver_candidates(preset_filter=preset_filter)

        # Détecter les presets inconnus pour aider le client à diagnostiquer
        # les fautes de frappe (ex: ?preset=frequet au lieu de frequent).
        unknown_preset = bool(preset_name) and preset_name != 'all' and preset_name not in presets

        return jsonify({
            'preset': preset_name,
            'preset_label': preset_info.get('label', preset_name),
            'preset_filter': preset_filter or None,
            'unknown_preset': unknown_preset,
            'plugins': eligible,
            'total': len(eligible),
            'available_presets': {
                name: {'label': p.get('label', name), 'description': p.get('description', '')}
                for name, p in presets.items()
            }
        }), 200

    except Exception as e:
        logger.error(f"Erreur listing metasolver eligible: {e}", exc_info=True)
        return jsonify({
            "error": "Erreur listing metasolver eligible",
            "message": str(e)
        }), 500


@bp.route('/metasolver/recommend', methods=['POST'])
def metasolver_recommend_plugins():
    """
    Analyse la signature d'entrée d'un texte et recommande une sous-liste de plugins metasolver.

    Request body:
        {
            "text": ".... . .-.. .-.. ---",
            "preset": "all",
            "mode": "decode",
            "max_plugins": 8
        }
    """
    try:
        data = request.get_json(force=True)
    except Exception as json_error:
        return jsonify({
            "error": "JSON invalide",
            "message": f"Le body doit être un JSON valide: {str(json_error)}"
        }), 400

    if not data or not isinstance(data, dict):
        return jsonify({
            "error": "Requête invalide",
            "message": "Le body doit être un objet JSON"
        }), 400

    text = data.get('text')
    if not isinstance(text, str) or not text.strip():
        return jsonify({
            "error": "Requête invalide",
            "message": "Le champ 'text' (string non vide) est requis"
        }), 400

    requested_preset = (data.get('preset') or '').strip().lower()
    mode = (data.get('mode') or 'decode').strip().lower()
    if mode not in {'decode', 'detect'}:
        return jsonify({
            "error": "Mode invalide",
            "message": f"Le mode doit être 'decode' ou 'detect', reçu: {mode!r}"
        }), 400
    max_plugins = _normalize_max_plugins(data.get('max_plugins'), default=8)
    extract_fragments = bool(data.get('extract_fragments', False))
    max_secret_fragments = _normalize_max_plugins(data.get('max_secret_fragments'), default=5)

    try:
        payload = _recommend_metasolver_plugins_response(
            text=text,
            requested_preset=requested_preset,
            mode=mode,
            max_plugins=max_plugins,
            extract_fragments=extract_fragments,
            max_secret_fragments=max_secret_fragments,
        )
        return jsonify(payload), 200
    except Exception as e:
        logger.error(f"Erreur recommandation metasolver: {e}", exc_info=True)
        return jsonify({
            "error": "Erreur recommandation metasolver",
            "message": str(e)
        }), 500


@bp.route('/metasolver/execute-stream', methods=['POST'])
def metasolver_execute_stream():
    """
    Exécute le metasolver en mode streaming SSE.

    Chaque sous-plugin exécuté émet des événements en temps réel :
    - init         : liste des candidats
    - plugin_start : un sous-plugin démarre
    - plugin_done  : un sous-plugin a terminé (avec résultats)
    - plugin_error : un sous-plugin a échoué
    - progress     : avancement global (pourcentage)
    - result       : résultat final complet

    Request Body (JSON):
        inputs (dict): Paramètres d'entrée identiques à /metasolver/execute

    Returns:
        text/event-stream (SSE)

    Example:
        POST /api/plugins/metasolver/execute-stream
        {"inputs": {"text": "URYYB", "mode": "decode", "preset": "all"}}
    """
    from flask import Response, stream_with_context

    try:
        data = request.get_json(force=True)
    except Exception as json_error:
        return jsonify({
            "error": "JSON invalide",
            "message": f"Le body doit être un JSON valide: {str(json_error)}"
        }), 400

    if not data or 'inputs' not in data:
        return jsonify({
            "error": "Requête invalide",
            "message": "Le champ 'inputs' est requis"
        }), 400

    inputs = data['inputs']
    if not isinstance(inputs, dict):
        return jsonify({
            "error": "Requête invalide",
            "message": "Le champ 'inputs' doit être un objet JSON"
        }), 400

    # ── Validation des champs optionnels ──────────────────────────────
    # On valide tôt pour renvoyer une 400 claire au lieu de laisser
    # execute_streaming émettre un événement SSE d'erreur (qui arrive
    # trop tard pour un client qui n'a pas encore ouvert le stream).
    raw_mode = inputs.get('mode')
    if raw_mode is not None:
        mode_str = str(raw_mode).lower()
        if mode_str not in {'decode', 'detect'}:
            return jsonify({
                "error": "Mode invalide",
                "message": f"Le mode doit être 'decode' ou 'detect', reçu: {raw_mode!r}"
            }), 400

    raw_max_plugins = inputs.get('max_plugins')
    if raw_max_plugins is not None and raw_max_plugins != '':
        try:
            mp_val = int(raw_max_plugins)
            if mp_val <= 0:
                raise ValueError("doit être positif")
        except (TypeError, ValueError):
            return jsonify({
                "error": "max_plugins invalide",
                "message": f"max_plugins doit être un entier positif, reçu: {raw_max_plugins!r}"
            }), 400

    # Validation du texte : doit être une string non-vide.
    raw_text = inputs.get('text')
    if raw_text is not None:
        text_str = str(raw_text).strip()
        if not text_str:
            return jsonify({
                "error": "Texte invalide",
                "message": "Le champ 'text' ne doit pas être vide"
            }), 400

    manager = get_plugin_manager()

    # Charger le plugin metasolver via le plugin manager
    wrapper = manager.get_plugin('metasolver')
    if not wrapper:
        return jsonify({
            "error": "Plugin metasolver non disponible",
            "message": "Impossible de charger le plugin metasolver"
        }), 500

    # Accéder à l'instance brute du plugin pour appeler execute_streaming
    raw_instance = wrapper.instance
    if not raw_instance or not hasattr(raw_instance, 'execute_streaming'):
        return jsonify({
            "error": "Streaming non supporté",
            "message": "Le plugin metasolver ne supporte pas le mode streaming"
        }), 500

    logger.info(f"Démarrage exécution streaming metasolver avec inputs: {list(inputs.keys())}")

    # Event d'annulation partagé avec execute_streaming : permet de signaler
    # une déconnexion client (le générateur Flask est fermé → finally ci-dessous)
    # pour que le metasolver arrête d'attendre les workers et renvoie une
    # réponse partielle au lieu de fuiter en arrière-plan.
    cancel_event = threading.Event()

    def generate():
        try:
            for event in raw_instance.execute_streaming(inputs, cancel_event=cancel_event):
                event_type = event.get('event', 'message')
                try:
                    event_data = json.dumps(event.get('data', {}), ensure_ascii=False)
                except Exception as serial_exc:
                    logger.error(f"[streaming] JSON serialization error on event '{event_type}': {serial_exc}", exc_info=True)
                    event_data = json.dumps({"error": f"Serialization error: {serial_exc}"}, ensure_ascii=False)
                logger.debug(f"[streaming] Yielding event: {event_type}")
                yield f"event: {event_type}\ndata: {event_data}\n\n"
            logger.info("[streaming] execute_streaming generator exhausted — all events sent")
        except GeneratorExit:
            # Le client a fermé la connexion : on signale l'annulation au
            # metasolver pour qu'il libère ses workers (shutdown non-bloquant).
            logger.info("[streaming] Client disconnected — signalling cancel to metasolver")
            cancel_event.set()
            raise
        except Exception as exc:
            logger.error(f"[streaming] Unhandled exception in generate(): {exc}", exc_info=True)
            error_data = json.dumps({
                "error": str(exc),
                "type": type(exc).__name__
            }, ensure_ascii=False)
            yield f"event: error\ndata: {error_data}\n\n"
        finally:
            # Ceinture et bretelles : garantir le signal d'annulation même si
            # le générateur est fermé sans GeneratorExit explicite.
            cancel_event.set()

    return Response(
        stream_with_context(generate()),
        mimetype='text/event-stream',
        headers={
            'Cache-Control': 'no-cache',
            'X-Accel-Buffering': 'no',
            'Connection': 'keep-alive',
        }
    )
