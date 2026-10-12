"""
Couche centrale de normalisation et d'execution des plugins.

Ce module regroupe la logique qui etait auparavant dispersee entre le
frontend et la route ``/execute`` :

- ``apply_text_handling`` : normalisation des inputs selon le bloc
  ``text_handling`` du plugin.json. Portage fidele de
  ``normalizeInputsForPlugin`` (plugin-executor-widget.tsx) pour que TOUS
  les chemins d'execution (route /execute, metasolver, batch) appliquent la
  meme normalisation, pas seulement le widget frontend.
- ``normalize_plugin_result`` : applique le contrat de resultat documente
  ``{status: "ok"|"error", summary, results[], plugin_info{name, version,
  execution_time_ms}}`` — notamment le mapping legacy
  ``status: "success"`` -> ``"ok"``.
- ``scoring_context_from_inputs`` / ``score_plugin_results`` : scoring
  post-execution sorti de la route /execute pour etre reutilisable de
  maniere opt-in par les autres chemins d'execution.
"""

import unicodedata
from typing import Any, Dict, List, Optional, Tuple

from ..geocaches.models import Geocache


class TextHandlingError(ValueError):
    """Levee quand ``unknown_char_policy`` vaut 'error' et que le texte
    contient des caracteres non supportes par le plugin."""


# =============================================================================
# Normalisation des inputs (portage de normalizeInputsForPlugin)
# =============================================================================

def apply_text_handling(
    inputs: Dict[str, Any],
    text_handling: Optional[Dict[str, Any]],
    input_types: Optional[Dict[str, Any]] = None,
) -> Tuple[Dict[str, Any], List[str]]:
    """
    Normalise les inputs selon le bloc ``text_handling`` du plugin.json.

    Portage fidele de ``normalizeInputsForPlugin`` (frontend) : meme ordre
    d'operations (map_characters -> remove_diacritics -> case -> controle des
    caracteres autorises) et memes politiques pour les caracteres inconnus
    ('keep', 'warn_keep', 'strip', 'error').

    Regles conservees :
    - le champ 'text' n'est normalise que si ``mode`` est absent ou 'encode' ;
    - le champ 'key' est ajoute aux champs normalises quand ``inputs['key']``
      est une string, qu'il n'est pas deja dans ``fields`` et que
      ``input_types['key'].type == 'string'`` ;
    - un caractere est autorise s'il est dans ``allowed_characters`` OU (s'il
      n'y a pas de ``allowed_ranges`` -> tout est autorise) si son codepoint
      est dans une plage hexadecimale 'XXXX-YYYY'.

    Args:
        inputs: Parametres d'entree du plugin (non modifies).
        text_handling: Bloc ``text_handling`` du plugin.json (falsy => no-op).
        input_types: Bloc ``input_types`` du plugin.json (optionnel, sert a
            detecter un champ 'key' de type string).

    Returns:
        Tuple (inputs_normalises, warnings). Les warnings sont prefixes par
        ``[{champ}] ``.

    Raises:
        TextHandlingError: si ``unknown_char_policy`` vaut 'error' et que des
            caracteres non supportes sont presents.
    """
    if not isinstance(inputs, dict):
        return inputs, []
    if not text_handling or not isinstance(text_handling, dict):
        return dict(inputs), []

    mode_value = inputs.get('mode')
    mode_value = mode_value.lower() if isinstance(mode_value, str) else None
    should_normalize_text_field = mode_value is None or mode_value == 'encode'

    fields = text_handling.get('fields')
    if not (isinstance(fields, list) and fields):
        fields = ['text']

    fields_to_normalize = (
        list(fields)
        if should_normalize_text_field
        else [f for f in fields if f != 'text']
    )

    # Champ 'key' ajoute automatiquement s'il est une string declaree comme
    # telle dans input_types et pas deja couvert par `fields`.
    key_field = input_types.get('key') if isinstance(input_types, dict) else None
    if (
        isinstance(inputs.get('key'), str)
        and 'key' not in fields_to_normalize
        and isinstance(key_field, dict)
        and key_field.get('type') == 'string'
    ):
        fields_to_normalize.append('key')

    if not fields_to_normalize:
        return dict(inputs), []

    allowed_characters = text_handling.get('allowed_characters')
    allowed_characters_set = (
        set(allowed_characters) if isinstance(allowed_characters, str) else set()
    )

    allowed_ranges: List[Tuple[int, int]] = []
    raw_ranges = text_handling.get('allowed_ranges')
    if isinstance(raw_ranges, list):
        for range_str in raw_ranges:
            if not isinstance(range_str, str):
                continue
            parts = range_str.split('-')
            if len(parts) != 2:
                continue
            try:
                start = int(parts[0], 16)
                end = int(parts[1], 16)
            except ValueError:
                continue
            allowed_ranges.append((start, end))

    unknown_policy = text_handling.get('unknown_char_policy')
    if not isinstance(unknown_policy, str):
        unknown_policy = 'warn_keep'

    normalize_config = text_handling.get('normalize')
    if not isinstance(normalize_config, dict):
        normalize_config = {}
    remove_diacritics = bool(normalize_config.get('remove_diacritics'))
    case_mode = normalize_config.get('case')
    if not isinstance(case_mode, str):
        case_mode = 'preserve'
    map_characters = normalize_config.get('map_characters')
    if not isinstance(map_characters, dict):
        map_characters = {}

    def is_char_allowed(ch: str) -> bool:
        if ch in allowed_characters_set:
            return True
        if not allowed_ranges:
            return True
        code = ord(ch)
        return any(start <= code <= end for start, end in allowed_ranges)

    def normalize_text(value: str) -> Tuple[str, List[str]]:
        local_warnings: List[str] = []

        # 1. map_characters : remplacement caractere par caractere
        mapped_chars: List[str] = []
        for ch in value:
            replacement = map_characters.get(ch)
            mapped_chars.append(replacement if isinstance(replacement, str) else ch)
        normalized = ''.join(mapped_chars)

        # 2. remove_diacritics : NFD puis suppression U+0300-U+036F
        if remove_diacritics:
            before = normalized
            # Equivalent de la regex JS qui supprime les combinants
            # de la plage U+0300 - U+036F apres decomposition NFD.
            normalized = ''.join(
                c for c in unicodedata.normalize('NFD', normalized)
                if not (0x0300 <= ord(c) <= 0x036F)
            )
            if before != normalized:
                local_warnings.append(
                    'Certains caractères accentués ont été normalisés (ex: é → e).'
                )

        # 3. case : upper / lower / preserve
        if case_mode == 'upper':
            normalized = normalized.upper()
        elif case_mode == 'lower':
            normalized = normalized.lower()

        # 4. controle des caracteres autorises
        unsupported = set()
        output_chars: List[str] = []
        for ch in normalized:
            if is_char_allowed(ch):
                output_chars.append(ch)
                continue
            unsupported.add(ch)
            if unknown_policy == 'strip':
                continue
            output_chars.append(ch)
        output = ''.join(output_chars)

        unsupported_list = sorted(unsupported)
        if unsupported_list:
            chars = ''.join(unsupported_list)
            if unknown_policy == 'error':
                raise TextHandlingError(
                    f'Caractères non supportés par le plugin: {chars}'
                )
            if unknown_policy in ('warn_keep', 'strip'):
                local_warnings.append(
                    f'Caractères non supportés par le plugin: {chars}'
                )

        return output, local_warnings

    warnings: List[str] = []
    normalized_inputs = dict(inputs)

    for field in fields_to_normalize:
        value = normalized_inputs.get(field)
        if not isinstance(value, str):
            continue
        text, field_warnings = normalize_text(value)
        normalized_inputs[field] = text
        warnings.extend(f'[{field}] {w}' for w in field_warnings)

    return normalized_inputs, warnings


# =============================================================================
# Normalisation des sorties (contrat de resultat)
# =============================================================================

def normalize_plugin_result(result: Any, *, name: str, version: str) -> Dict[str, Any]:
    """
    Normalise le resultat brut d'un plugin vers le contrat documente :

    ``{status: "ok"|"error", summary: str, results: list[dict],
    plugin_info: {name, version, execution_time_ms}}`` plus un bloc ``error``
    quand ``status == 'error'``.

    - ``status: "success"`` (legacy) est mappe vers ``"ok"`` ; un statut
      inconnu devient 'ok' si des resultats existent, 'error' sinon ;
    - chaque item de ``results`` recoit un ``id`` (``result_{i}``) et une
      ``confidence`` (0.0) s'ils manquent — une confidence existante n'est
      jamais ecrasee ;
    - ``plugin_info`` est complete avec ``name``/``version`` fournis ;
    - un resultat qui n'est pas un dict produit un bloc erreur
      ``InvalidResult`` ;
    - toutes les autres cles (metadata, coordinates, warnings...) sont
      preservees telles quelles.

    Args:
        result: Resultat brut retourne par le plugin.
        name: Nom du plugin (repli pour plugin_info.name).
        version: Version du plugin (repli pour plugin_info.version).

    Returns:
        Dict: Resultat conforme au contrat.
    """
    if not isinstance(result, dict):
        return {
            'status': 'error',
            'summary': 'Le plugin a retourné un résultat non conforme',
            'results': [],
            'plugin_info': {
                'name': name,
                'version': version,
                'execution_time_ms': 0,
            },
            'error': {
                'type': 'InvalidResult',
                'message': (
                    f'Resultat de type {type(result).__name__}, '
                    'un dict est attendu'
                ),
            },
        }

    # --- status : mapping legacy puis derivation ---
    status = result.get('status')
    if status == 'success':
        status = 'ok'

    raw_results = result.get('results')
    items = (
        [item for item in raw_results if isinstance(item, dict)]
        if isinstance(raw_results, list)
        else []
    )

    if status not in ('ok', 'error'):
        status = 'ok' if items else 'error'
    result['status'] = status

    # --- summary : toujours une string ---
    summary = result.get('summary')
    if not isinstance(summary, str):
        summary = '' if summary is None else str(summary)
        result['summary'] = summary

    # --- results : items dict uniquement, id + confidence garantis ---
    for index, item in enumerate(items):
        item.setdefault('id', f'result_{index + 1}')
        if 'confidence' not in item:
            item['confidence'] = 0.0
    result['results'] = items

    # --- plugin_info : name/version/execution_time_ms garantis ---
    plugin_info = result.get('plugin_info')
    if not isinstance(plugin_info, dict):
        plugin_info = {}
        result['plugin_info'] = plugin_info
    if not plugin_info.get('name'):
        plugin_info['name'] = name
    if not plugin_info.get('version'):
        plugin_info['version'] = version
    plugin_info.setdefault('execution_time_ms', 0)

    # --- bloc error obligatoire en status 'error' ---
    if status == 'error':
        error_block = result.get('error')
        if not isinstance(error_block, dict):
            error_block = {
                'type': 'UnknownError',
                'message': result['summary'] or 'Erreur inconnue',
            }
            result['error'] = error_block
        # Deriver un summary parlant depuis le message d'erreur si absent
        if not result['summary'] and isinstance(error_block.get('message'), str):
            result['summary'] = error_block['message']

    return result


# =============================================================================
# Scoring post-execution (sorti de la route /execute)
# =============================================================================

def scoring_context_from_inputs(inputs: Any) -> Dict[str, Any]:
    """Contexte geographique du scoring : les coordonnees de la geocache.

    Le scorer s'en sert pour ponderer des coordonnees trouvees dans un resultat
    par leur distance a la cache (voir scorer._apply_geo_context). Source, par
    ordre de preference : `origin_coords` deja fourni par l'appelant (le frontend
    l'injecte en mode geocache), sinon la geocache designee par `geocache_id` —
    ses coordonnees d'origine si elles ont ete corrigees, pour ne pas mesurer la
    distance a un final deja resolu. Dictionnaire vide si rien n'est disponible.
    """
    if not isinstance(inputs, dict):
        return {}

    origin_coords = inputs.get('origin_coords')
    if origin_coords:
        return {'origin_coords': origin_coords}

    geocache_id = inputs.get('geocache_id')
    if not geocache_id:
        return {}
    try:
        geocache = Geocache.query.get(int(geocache_id))
    except Exception:
        return {}
    if geocache is None:
        return {}

    latitude, longitude = geocache.original_latitude, geocache.original_longitude
    if latitude is None or longitude is None:
        latitude, longitude = geocache.latitude, geocache.longitude
    if latitude is None or longitude is None:
        return {}
    return {'origin_latitude': latitude, 'origin_longitude': longitude}


def score_plugin_results(
    result: Dict[str, Any],
    inputs: Dict[str, Any],
    *,
    context: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Applique le scoring post-execution sur les resultats d'un plugin.

    Portage du bloc de scoring de la route ``/execute`` : la confidence
    originale du plugin est preservee dans ``metadata.plugin_confidence``
    avant re-scoring, puis selon le mode :

    - 'detect' : confidences mises a 0.0 (le detect n'a pas de notion de
      plausibilite textuelle) ;
    - 'encode' : resultat inchange (confidence deterministe) ;
    - autre (decode...) : ``score_and_rank_results`` retrie et filtre ; si le
      scorer elimine tout, les resultats bruts sont conserves et marques
      ``metadata.scoring_filtered``.

    Args:
        result: Resultat du plugin (de preference deja normalise).
        inputs: Inputs d'origine (mode, max_results).
        context: Contexte de scoring (ex: coordonnees d'origine), ou None.

    Returns:
        Dict: Le resultat, potentiellement re-ordonne/annote.
    """
    if not isinstance(result, dict) or not isinstance(result.get('results'), list):
        return result

    items = [item for item in (result.get('results') or []) if isinstance(item, dict)]

    # Preserve original plugin confidence before overwriting
    for item in items:
        item_metadata = item.get('metadata')
        if not isinstance(item_metadata, dict):
            item_metadata = {}
            item['metadata'] = item_metadata
        plugin_confidence = item.get('confidence')
        if plugin_confidence is not None and 'plugin_confidence' not in item_metadata:
            item_metadata['plugin_confidence'] = plugin_confidence

    mode = inputs.get('mode') if isinstance(inputs, dict) else None
    mode_str = str(mode).lower() if isinstance(mode, str) else None

    if mode_str == 'detect':
        for item in items:
            item['confidence'] = 0.0
        return result

    if mode_str == 'encode':
        # Encode results have deterministic confidence, skip scoring
        return result

    # Use tiered scoring: fast pre-filter then full score on survivors
    from gc_backend.plugins.scoring import score_and_rank_results

    max_results = int(inputs.get('max_results', 25) or 25)
    ranked = score_and_rank_results(
        items,
        top_k=max(max_results, 25),
        min_score=0.03,
        fast_reject_threshold=0.01,
        context=context,
    )
    if ranked:
        result['results'] = ranked
    else:
        # Do not erase deterministic plugin output just because
        # the global language scorer considers it implausible.
        # Some ciphers need a missing/unknown key and still
        # must display the raw decoded candidate to the user.
        for item in items:
            item_metadata = item.get('metadata')
            if not isinstance(item_metadata, dict):
                item_metadata = {}
                item['metadata'] = item_metadata
            item_metadata['scoring_filtered'] = True
            item_metadata['scoring_warning'] = (
                "Le scoring global a juge ce resultat peu plausible; "
                "le resultat brut du plugin est conserve."
            )
        result['results'] = items

    return result
