"""Vision OCR service using an OpenAI-compatible endpoint.

This module sends an image as a data URL in the messages payload.
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass
from typing import Any, Dict, Optional

import requests

from .image_utils import to_data_url

logger = logging.getLogger(__name__)


DEFAULT_STRICT_PROMPT = (
    "Transcris précisément le texte visible sur cette image sans interprétation "
    "ni correction orthographique. Respecte les retours à la ligne."
)

DEFAULT_DESCRIBE_PROMPT = (
    "Tu analyses une image extraite d'un listing de geocache enigme. "
    "Decris precisement ce que represente cette image : personnages, scenes, objets, animaux identifiables. "
    "Si l'image illustre un conte, une fable, une legende, un film ou une histoire connue (pour enfants ou adultes), "
    "identifie clairement son titre. "
    "Si l'image contient du texte visible, transcris-le aussi. "
    "Reponds de facon concise et factuelle, sans interpretation speculative."
)


@dataclass(frozen=True)
class VisionOcrResult:
    """Result of a vision OCR call."""

    text: str
    provider: str
    model: str


def strip_thinking_blocks(text: str) -> str:
    """Remove model 'thinking' blocks from a response.

    Some local models emit reasoning using markers like [THINK]...[/THINK] or <think>...</think>.
    We strip them so only the final OCR transcription is kept.
    """
    if not text:
        return ""

    cleaned = text
    cleaned = re.sub(r"\[THINK\].*?\[/THINK\]", "", cleaned, flags=re.IGNORECASE | re.DOTALL)
    cleaned = re.sub(r"<think>.*?</think>", "", cleaned, flags=re.IGNORECASE | re.DOTALL)
    cleaned = re.sub(r"\[ANALYSIS\].*?\[/ANALYSIS\]", "", cleaned, flags=re.IGNORECASE | re.DOTALL)
    cleaned = re.sub(r"<analysis>.*?</analysis>", "", cleaned, flags=re.IGNORECASE | re.DOTALL)
    return cleaned.strip()


def normalize_openai_compatible_base_url(base_url: str, default_base_url: str = "http://localhost:1234") -> str:
    """Normalize a base URL so it points to the OpenAI-compatible /v1 root."""
    raw = (base_url or "").strip()
    if not raw:
        raw = default_base_url

    raw = raw.rstrip("/")
    raw = re.sub(r"/chat/completions/?$", "", raw, flags=re.IGNORECASE)
    if "openrouter.ai" in raw.lower():
        if raw.lower().endswith("/api/v1"):
            return raw
        if raw.lower().endswith("/api"):
            return f"{raw}/v1"
        if raw.lower().endswith("/v1"):
            return re.sub(r"/v1$", "/api/v1", raw, flags=re.IGNORECASE)
        return f"{raw}/api/v1"
    if raw.endswith("/v1"):
        return raw
    return f"{raw}/v1"


def normalize_lmstudio_base_url(base_url: str) -> str:
    """Normalize a LMStudio base URL so it points to the OpenAI-compatible /v1 root."""
    return normalize_openai_compatible_base_url(base_url, "http://localhost:1234")


def build_openai_vision_payload(*, model: str, prompt: str, image_bytes: bytes, max_tokens: int = 1024) -> Dict[str, Any]:
    """Build an OpenAI-compatible payload for vision."""
    data_url, _mime = to_data_url(image_bytes)

    return {
        "model": model,
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "image_url", "image_url": {"url": data_url}},
                    {"type": "text", "text": prompt},
                ],
            }
        ],
        "temperature": 0,
        "max_tokens": max_tokens,
    }


def extract_text_from_openai_response(data: Dict[str, Any]) -> str:
    """Extract assistant text from an OpenAI-compatible response."""
    choices = data.get("choices")
    if isinstance(choices, list) and choices:
        message = choices[0].get("message") if isinstance(choices[0], dict) else None
        if isinstance(message, dict):
            content = message.get("content")
            if isinstance(content, str):
                return content
            if isinstance(content, list):
                # Some providers return structured content parts
                parts = []
                for part in content:
                    if isinstance(part, dict) and isinstance(part.get("text"), str):
                        parts.append(part["text"])
                return "\n".join(parts).strip()
    return ""


def vision_ocr_via_lmstudio(
    *,
    image_bytes: bytes,
    base_url: str,
    model: str,
    prompt: Optional[str] = None,
    timeout_sec: int = 60,
) -> VisionOcrResult:
    """Run OCR using LMStudio vision model.

    Args:
        image_bytes: Raw image bytes.
        base_url: LMStudio base URL (ex: http://localhost:1234).
        model: Model identifier.
        prompt: Strict transcription prompt.
        timeout_sec: HTTP timeout in seconds.

    Returns:
        VisionOcrResult

    Raises:
        RuntimeError: if the endpoint returns an error or invalid payload.
    """
    return vision_ocr_via_openai_compatible(
        image_bytes=image_bytes,
        base_url=base_url,
        model=model,
        prompt=prompt,
        timeout_sec=timeout_sec,
        provider="lmstudio",
    )


def vision_ocr_via_openai_compatible(
    *,
    image_bytes: bytes,
    base_url: str,
    model: str,
    prompt: Optional[str] = None,
    timeout_sec: int = 60,
    provider: str = "openai-compatible",
    api_key: Optional[str] = None,
    extra_headers: Optional[Dict[str, str]] = None,
) -> VisionOcrResult:
    """Run OCR using a vision model exposed through an OpenAI-compatible API."""
    provider_label = (provider or "openai-compatible").strip().lower() or "openai-compatible"

    if not model or not str(model).strip():
        raise RuntimeError(f"Missing model for {provider_label} vision OCR")

    v1 = normalize_openai_compatible_base_url(
        base_url,
        "https://openrouter.ai/api/v1" if provider_label == "openrouter" else "http://localhost:1234",
    )
    endpoint = f"{v1}/chat/completions"

    payload = build_openai_vision_payload(
        model=str(model).strip(),
        prompt=(prompt or DEFAULT_STRICT_PROMPT),
        image_bytes=image_bytes,
    )

    headers: Dict[str, str] = {"Content-Type": "application/json"}
    clean_api_key = (api_key or "").strip()
    if clean_api_key:
        headers["Authorization"] = f"Bearer {clean_api_key}"
    if provider_label == "openrouter":
        headers.setdefault("X-OpenRouter-Title", "GeoApp")
    if extra_headers:
        headers.update({key: value for key, value in extra_headers.items() if value})

    logger.info("[vision_ocr] Sending request to %s (provider=%s, model=%s)", endpoint, provider_label, model)

    try:
        res = requests.post(endpoint, json=payload, headers=headers, timeout=timeout_sec)
    except Exception as exc:  # pragma: no cover
        raise RuntimeError(f"{provider_label} request failed: {exc}") from exc

    if res.status_code >= 400:
        raise RuntimeError(f"{provider_label} HTTP {res.status_code}: {res.text[:500]}")

    try:
        data = res.json()
    except Exception as exc:
        raise RuntimeError(f"{provider_label} returned invalid JSON: {exc} ({res.text[:500]})") from exc

    text = extract_text_from_openai_response(data).strip()
    text = strip_thinking_blocks(text)
    if not text:
        raise RuntimeError(f"{provider_label} returned an empty response")

    return VisionOcrResult(text=text, provider=provider_label, model=str(model).strip())
