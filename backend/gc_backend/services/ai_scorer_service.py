"""Service d'analyse IA pour le scoring des résultats de plugins.

Ce module permet d'utiliser un LLM OpenAI-compatible pour analyser et scorer
des textes issus du déchiffrement de plugins (résultats de Metasolver, etc.).

Contrairement au scoring algorithmique, l'IA peut détecter :
- des mots collés (ex: "bonjourcesontdescoordonnees")
- du langage dans n'importe quelle langue sans quadgrammes pré-entraînés
- des formes atypiques non couvertes par les regex classiques
- des coordonnées décrites en toutes lettres

La sortie est intentionnellement compatible avec le format de scoring algo
(champ `confidence` 0..1, champ `metadata.scoring`, coordonnées incluses)
pour que l'interface gère les deux de la même façon.
"""

from __future__ import annotations

import json
import re
import time
import logging
from typing import Any, Dict, List, Optional

import requests

from ..services.ocr.lmstudio_vision_service import (
    normalize_openai_compatible_base_url,
    extract_text_from_openai_response,
    strip_thinking_blocks,
)

logger = logging.getLogger(__name__)

# ──────────────────────────────────────────────────────────────────────────────
# Prompt système spécialisé
# ──────────────────────────────────────────────────────────────────────────────

AI_SCORER_SYSTEM_PROMPT = """\
Tu es un expert en cryptographie, en langues et en géocaching. \
Tu reçois une liste de textes candidats issus du déchiffrement de codes secrets. \
Ton rôle est d'analyser chaque texte et de déterminer s'il forme un texte lisible, \
quelle que soit la langue (français, anglais, allemand, espagnol, etc.) \
et quelle que soit la forme (mots collés, abréviations, coordonnées GPS en toutes lettres, etc.).

Pour chaque texte, tu dois :
1. Évaluer s'il contient du langage naturel plausible (même partiel).
2. Attribuer un score de confiance entre 0.0 et 1.0 :
   - 0.0 : bruit pur, séquence aléatoire, suite de chiffres sans sens.
   - 0.3-0.5 : quelques mots reconnaissables mais beaucoup de bruit.
   - 0.6-0.79 : majoritairement lisible mais incertain.
   - 0.8-1.0 : clairement du texte naturel, phrase ou coordonnées explicites.
3. Extraire les coordonnées GPS si présentes (en chiffres OU en toutes lettres).
   Exemples de coordonnées en toutes lettres :
   - "nord quarante huit virgule trois" → N 48.3
   - "N quarante-huit degrés trente-neuf virgule deux cent quatre-vingt-six" → N 48° 39.286'
   - "nord 48 trente neuf point 786 est 6 onze virgule 685"
4. Fournir une brève explication (max 20 mots) justifiant le score.

Réponds UNIQUEMENT en JSON valide, sans markdown, sans commentaire, avec ce format exact :
{
  "results": [
    {
      "index": 0,
      "confidence": 0.85,
      "language": "fr",
      "readable": true,
      "explanation": "Phrase française lisible avec une direction géographique.",
      "coordinates": {
        "exist": true,
        "ddm_lat": "N 48° 39.286'",
        "ddm_lon": "E 006° 11.685'",
        "ddm": "N 48° 39.286' E 006° 11.685'",
        "decimal_latitude": 48.654767,
        "decimal_longitude": 6.194750,
        "confidence": 0.92,
        "source": "ai_written"
      }
    }
  ]
}
Si aucune coordonnée n'est trouvée, omets le champ "coordinates" ou mets "coordinates": {"exist": false}.
"""

AI_SCORER_USER_TEMPLATE = """\
Analyse les {count} texte(s) candidat(s) suivants. Contexte : plugin "{plugin_name}".

{texts_block}
"""

# ──────────────────────────────────────────────────────────────────────────────
# Appel LLM
# ──────────────────────────────────────────────────────────────────────────────

def _build_chat_payload(model: str, user_message: str, max_tokens: int = 2048) -> Dict[str, Any]:
    return {
        "model": model,
        "messages": [
            {"role": "system", "content": AI_SCORER_SYSTEM_PROMPT},
            {"role": "user", "content": user_message},
        ],
        "temperature": 0.1,
        "max_tokens": max_tokens,
    }


def _call_openai_compatible(
    *,
    user_message: str,
    base_url: str,
    model: str,
    api_key: Optional[str] = None,
    provider: str = "openai-compatible",
    timeout_sec: int = 60,
) -> str:
    """Appelle un endpoint OpenAI-compatible et retourne la réponse textuelle brute."""
    v1 = normalize_openai_compatible_base_url(
        base_url,
        "https://openrouter.ai/api/v1" if provider == "openrouter" else "http://localhost:1234",
    )
    endpoint = f"{v1}/chat/completions"
    payload = _build_chat_payload(model, user_message)

    headers: Dict[str, str] = {"Content-Type": "application/json"}
    clean_key = (api_key or "").strip()
    if clean_key:
        headers["Authorization"] = f"Bearer {clean_key}"
    if provider == "openrouter":
        headers.setdefault("X-OpenRouter-Title", "GeoApp")

    logger.info("[ai_scorer] POST %s (provider=%s, model=%s)", endpoint, provider, model)
    try:
        res = requests.post(endpoint, json=payload, headers=headers, timeout=timeout_sec)
    except Exception as exc:
        raise RuntimeError(f"[ai_scorer] Requête échouée ({provider}): {exc}") from exc

    if res.status_code >= 400:
        raise RuntimeError(f"[ai_scorer] HTTP {res.status_code}: {res.text[:400]}")

    try:
        data = res.json()
    except Exception as exc:
        raise RuntimeError(f"[ai_scorer] JSON invalide: {exc} ({res.text[:400]})") from exc

    text = extract_text_from_openai_response(data).strip()
    text = strip_thinking_blocks(text)
    if not text:
        raise RuntimeError("[ai_scorer] Réponse vide du LLM")
    return text


# ──────────────────────────────────────────────────────────────────────────────
# Parsing de la réponse IA
# ──────────────────────────────────────────────────────────────────────────────

def _extract_json_from_response(raw: str) -> Optional[Dict[str, Any]]:
    """Extrait et parse le JSON de la réponse IA (robuste aux markdown fences)."""
    # Essai direct
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        pass

    # Tentative d'extraction depuis un bloc ```json ... ```
    fence = re.search(r'```(?:json)?\s*([\s\S]+?)```', raw, re.IGNORECASE)
    if fence:
        try:
            return json.loads(fence.group(1).strip())
        except json.JSONDecodeError:
            pass

    # Tentative d'extraction du premier objet JSON { ... }
    obj = re.search(r'\{[\s\S]+\}', raw)
    if obj:
        try:
            return json.loads(obj.group(0))
        except json.JSONDecodeError:
            pass

    return None


def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        v = float(value)
        return max(0.0, min(1.0, v))
    except (TypeError, ValueError):
        return default


def _build_fallback_item(index: int, text: str, error: str) -> Dict[str, Any]:
    """Résultat de secours si le parsing IA échoue pour un item."""
    return {
        "index": index,
        "confidence": 0.0,
        "language": "unknown",
        "readable": False,
        "explanation": f"Erreur parsing IA: {error[:80]}",
        "coordinates": {"exist": False},
    }


def _parse_ai_response(raw: str, count: int) -> List[Dict[str, Any]]:
    """Parse la réponse JSON de l'IA et retourne une liste de résultats normalisés."""
    parsed = _extract_json_from_response(raw)
    if not parsed or not isinstance(parsed.get("results"), list):
        logger.warning("[ai_scorer] Réponse IA non parseable : %s", raw[:200])
        return [_build_fallback_item(i, "", "réponse non parseable") for i in range(count)]

    ai_results = parsed["results"]
    normalized: List[Dict[str, Any]] = []

    for i in range(count):
        # Chercher l'item correspondant à cet index
        item = next((r for r in ai_results if isinstance(r, dict) and r.get("index") == i), None)
        if item is None:
            # Fallback : prendre dans l'ordre
            item = ai_results[i] if i < len(ai_results) else {}

        coords_raw = item.get("coordinates") or {}
        coords: Dict[str, Any] = {"exist": False}
        if isinstance(coords_raw, dict) and coords_raw.get("exist") is not False:
            ddm_lat = coords_raw.get("ddm_lat") or coords_raw.get("latitude")
            ddm_lon = coords_raw.get("ddm_lon") or coords_raw.get("longitude")
            ddm = coords_raw.get("ddm") or coords_raw.get("formatted")
            dec_lat = coords_raw.get("decimal_latitude")
            dec_lon = coords_raw.get("decimal_longitude")
            if ddm_lat or ddm_lon or dec_lat:
                coords = {
                    "exist": True,
                    "ddm_lat": str(ddm_lat) if ddm_lat else None,
                    "ddm_lon": str(ddm_lon) if ddm_lon else None,
                    "ddm": str(ddm) if ddm else (
                        f"{ddm_lat} {ddm_lon}" if (ddm_lat and ddm_lon) else None
                    ),
                    "decimal_latitude": float(dec_lat) if dec_lat is not None else None,
                    "decimal_longitude": float(dec_lon) if dec_lon is not None else None,
                    "confidence": _safe_float(coords_raw.get("confidence"), 0.85),
                    "source": "ai_written",
                }

        normalized.append({
            "index": i,
            "confidence": _safe_float(item.get("confidence"), 0.0),
            "language": str(item.get("language") or "unknown"),
            "readable": bool(item.get("readable", False)),
            "explanation": str(item.get("explanation") or "")[:200],
            "coordinates": coords,
        })

    return normalized


# ──────────────────────────────────────────────────────────────────────────────
# API publique
# ──────────────────────────────────────────────────────────────────────────────

def ai_score_results(
    items: List[Dict[str, Any]],
    *,
    base_url: str,
    model: str,
    api_key: Optional[str] = None,
    provider: str = "openai-compatible",
    plugin_name: str = "unknown",
    timeout_sec: int = 90,
    batch_size: int = 20,
) -> List[Dict[str, Any]]:
    """Analyse et score une liste de résultats de plugin via un LLM.

    Chaque item de `items` doit avoir un champ `text_output` (str).
    La fonction retourne une copie enrichie de chaque item avec :
    - `confidence` mis à jour (0.0-1.0) depuis l'analyse IA
    - `metadata.scoring` enrichi avec les détails IA
    - `coordinates` mis à jour si l'IA a détecté des coordonnées

    Args:
        items: Liste de résultats (format plugin standard).
        base_url: URL de base du LLM OpenAI-compatible.
        model: Identifiant du modèle.
        api_key: Clé API (optionnelle).
        provider: Nom du provider ("lmstudio", "openrouter", etc.).
        plugin_name: Nom du plugin source (pour le contexte).
        timeout_sec: Timeout HTTP.
        batch_size: Nombre max d'items par appel LLM.

    Returns:
        Liste d'items enrichis.
    """
    if not items:
        return []

    enriched = [dict(item) for item in items]
    total = len(enriched)

    # Traitement par batch pour éviter les prompts trop longs
    for batch_start in range(0, total, batch_size):
        batch = enriched[batch_start:batch_start + batch_size]
        texts = [str(it.get("text_output") or "").strip() for it in batch]

        # Construire le bloc texte pour le prompt
        texts_block_lines = []
        for local_idx, text in enumerate(texts):
            global_idx = batch_start + local_idx
            display = (text[:500] + "…") if len(text) > 500 else text
            texts_block_lines.append(f"[{local_idx}] (global index {global_idx})\n{display}")
        texts_block = "\n\n".join(texts_block_lines)

        user_message = AI_SCORER_USER_TEMPLATE.format(
            count=len(batch),
            plugin_name=plugin_name,
            texts_block=texts_block,
        )

        t0 = time.time()
        try:
            raw_response = _call_openai_compatible(
                user_message=user_message,
                base_url=base_url,
                model=model,
                api_key=api_key,
                provider=provider,
                timeout_sec=timeout_sec,
            )
            elapsed_ms = round((time.time() - t0) * 1000, 1)
            ai_items = _parse_ai_response(raw_response, len(batch))
        except Exception as exc:
            elapsed_ms = round((time.time() - t0) * 1000, 1)
            logger.error("[ai_scorer] Erreur batch %d-%d : %s", batch_start, batch_start + len(batch), exc)
            ai_items = [_build_fallback_item(i, texts[i], str(exc)) for i in range(len(batch))]

        # Fusionner les résultats IA dans les items
        for local_idx, ai_item in enumerate(ai_items):
            global_idx = batch_start + local_idx
            if global_idx >= total:
                break

            item = enriched[global_idx]
            ai_confidence = ai_item["confidence"]
            ai_coords = ai_item.get("coordinates") or {"exist": False}

            # Mise à jour de la confiance (l'IA remplace l'algo)
            item["confidence"] = ai_confidence

            # Enrichissement metadata.scoring
            item_metadata = item.get("metadata")
            if not isinstance(item_metadata, dict):
                item_metadata = {}
                item["metadata"] = item_metadata

            # Conserver la confiance algo originale
            if "confidence" in item and "algo_confidence" not in item_metadata:
                item_metadata["algo_confidence"] = item.get("_original_confidence", ai_confidence)

            item_metadata["ai_scoring"] = {
                "score": ai_confidence,
                "language_detected": ai_item.get("language", "unknown"),
                "readable": ai_item.get("readable", False),
                "explanation": ai_item.get("explanation", ""),
                "provider": provider,
                "model": model,
                "elapsed_ms": elapsed_ms,
                "source": "ai_scorer",
            }
            # Compatibilité avec l'affichage du scoring algo
            item_metadata.setdefault("scoring", {})["score"] = ai_confidence

            # Mise à jour des coordonnées si l'IA en a trouvé
            if ai_coords.get("exist"):
                # On garde aussi le format compatible "coordinates" existant
                existing_coords = item.get("coordinates") or {}
                if isinstance(existing_coords, dict) and not existing_coords.get("exist"):
                    # L'algo n'avait pas trouvé de coords → on met celles de l'IA
                    item["coordinates"] = ai_coords
                elif not existing_coords:
                    item["coordinates"] = ai_coords
                # Sinon on enrichit avec ai_coordinates pour ne pas écraser les coords algo
                item_metadata["ai_coordinates"] = ai_coords

    return enriched


def ai_score_text(
    text: str,
    *,
    base_url: str,
    model: str,
    api_key: Optional[str] = None,
    provider: str = "openai-compatible",
    timeout_sec: int = 60,
) -> Dict[str, Any]:
    """Score un unique texte via le LLM.

    Returns:
        Dict avec `confidence`, `language`, `readable`, `explanation`, `coordinates`.
    """
    results = ai_score_results(
        [{"text_output": text}],
        base_url=base_url,
        model=model,
        api_key=api_key,
        provider=provider,
        timeout_sec=timeout_sec,
    )
    if results:
        item = results[0]
        return {
            "confidence": item.get("confidence", 0.0),
            "language": item.get("metadata", {}).get("ai_scoring", {}).get("language_detected", "unknown"),
            "readable": item.get("metadata", {}).get("ai_scoring", {}).get("readable", False),
            "explanation": item.get("metadata", {}).get("ai_scoring", {}).get("explanation", ""),
            "coordinates": item.get("coordinates") or {"exist": False},
            "metadata": item.get("metadata", {}),
        }
    return {"confidence": 0.0, "coordinates": {"exist": False}, "metadata": {}}
