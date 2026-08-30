from __future__ import annotations

import logging
import threading
from datetime import date as date_type
from datetime import datetime, time
from time import monotonic
from typing import Any, Optional
from weakref import WeakKeyDictionary

import requests

from .geocaching_auth import GEOAPP_USER_AGENT, get_auth_service

logger = logging.getLogger(__name__)

WEBSITE_URL = 'https://www.geocaching.com'

# Depuis juin 2026, Geocaching.com a retiré l'ancien endpoint REST
# POST /api/live/v1/logs/{GC_CODE}/geocacheLog au profit d'un endpoint tRPC "batch".
# Cf. c:geo 2026.06.19 (commit a7e42d3 "rel to #18249: fix changed GC Log API").
TRPC_CREATE_GEOCACHE_LOG_URL = f'{WEBSITE_URL}/api/live/v1/trpc/web.logs.createGeocacheLog'
LEGACY_CREATE_GEOCACHE_LOG_URL = f'{WEBSITE_URL}/api/live/v1/logs/{{gc_code}}/geocacheLog'

# Le jeton CSRF est lié à la session (à ses cookies), pas à un appel : le redemander avant
# chaque log et chaque image doublait le nombre de requêtes vers Geocaching.com sur un lot
# (20 caches + photos = 20+ allers-retours pour rien). Il est donc mémorisé par session.
#
# Trois façons de le perdre, et c'est voulu :
#  - l'expiration ci-dessous, qui borne la fenêtre pendant laquelle on peut être périmé ;
#  - un envoi rejeté en 401/403, qui le jette et rejoue l'appel avec un jeton frais ;
#  - le remplacement de la session par le service d'authentification (login), qui fait
#    disparaître l'entrée toute seule puisque la clé est faible.
CSRF_TOKEN_TTL_SECONDS = 15 * 60

#: Codes HTTP qui trahissent un jeton périmé ou refusé.
CSRF_REJECTION_STATUSES = (401, 403)

# Nom du champ multipart attendu par Geocaching.com pour le fichier image.
#
# Trois noms étaient essayés à la suite (`file`, `image`, `imageFile`) : sur un refus, le
# même fichier — jusqu'à 10 Mo — repartait donc trois fois avant de rendre l'erreur.
# c:geo poste ses images sur l'API live de Groundspeak avec le champ `image` et l'en-tête
# `CSRF-Token` (GCLogAPI.addLogImage : `bodyForm(null, "image", "image/jpeg", ...)`).
# C'est ce nom qui est figé ici, et un échec est rendu tel quel, sans nouvel envoi.
LOG_IMAGE_FORM_FIELD = 'image'

LOG_DRAFT_IMAGES_URL = f'{WEBSITE_URL}/api/live/v1/logdrafts/images'

_csrf_tokens: 'WeakKeyDictionary[Any, tuple[str, float]]' = WeakKeyDictionary()
_csrf_tokens_lock = threading.Lock()


class GeocachingSubmitLogsClient:
    def __init__(self, session: Optional[requests.Session] = None) -> None:
        # Utiliser la session du service d'authentification centralisé
        if session is not None:
            self.session = session
        else:
            auth_service = get_auth_service()
            self.session = auth_service.get_session()
        
        self.session.headers.setdefault('User-Agent', GEOAPP_USER_AGENT)

    def get_csrf_token(self, *, force_refresh: bool = False) -> str | None:
        """
        Jeton CSRF de la session, mémorisé d'un appel à l'autre (cf. `_csrf_tokens`).

        `force_refresh` court-circuite le cache : à n'utiliser qu'après un rejet, sinon on
        retombe sur une requête supplémentaire par envoi.
        """
        if not force_refresh:
            cached = self._read_cached_csrf_token()
            if cached is not None:
                return cached

        token = self._fetch_csrf_token()
        if token:
            with _csrf_tokens_lock:
                _csrf_tokens[self.session] = (token, monotonic() + CSRF_TOKEN_TTL_SECONDS)
        else:
            self.invalidate_csrf_token()
        return token

    def _read_cached_csrf_token(self) -> str | None:
        with _csrf_tokens_lock:
            entry = _csrf_tokens.get(self.session)
        if entry is None:
            return None
        token, expires_at = entry
        if monotonic() >= expires_at:
            self.invalidate_csrf_token()
            return None
        return token

    def invalidate_csrf_token(self) -> None:
        """Oublie le jeton mémorisé : le prochain appel en redemandera un."""
        with _csrf_tokens_lock:
            _csrf_tokens.pop(self.session, None)

    @staticmethod
    def _is_csrf_rejection(result: Any) -> bool:
        """L'envoi a-t-il échoué d'une façon qui s'explique par un jeton périmé ?"""
        return (
            isinstance(result, dict)
            and not result.get('ok')
            and result.get('status') in CSRF_REJECTION_STATUSES
        )

    def _fetch_csrf_token(self) -> str | None:
        url = 'https://www.geocaching.com/api/auth/csrf'
        headers = {
            'Accept': 'application/json',
        }

        try:
            resp = self.session.get(url, headers=headers, timeout=30)
            if resp.status_code != 200:
                logger.error('CSRF token request failed: status=%s', resp.status_code)
                return None
            data = resp.json() if resp.content else None
            token = data.get('csrfToken') if isinstance(data, dict) else None
            return token if isinstance(token, str) and token.strip() else None
        except requests.RequestException as e:  # pragma: no cover
            logger.error('Failed to get CSRF token: %s', e)
            return None

    def upload_log_draft_image(
        self,
        *,
        filename: str,
        content: bytes,
        content_type: str,
    ) -> dict[str, Any] | None:
        csrf_token = self.get_csrf_token()
        if not csrf_token:
            logger.error('Could not get CSRF token')
            return None

        result = self._upload_log_draft_image_with_token(filename, content, content_type, csrf_token)

        # Le jeton mémorisé a pu expirer au milieu d'un lot : on le renouvelle et on rejoue
        # une fois, plutôt que de rendre un échec que l'utilisateur devrait relancer.
        if self._is_csrf_rejection(result):
            self.invalidate_csrf_token()
            fresh_token = self.get_csrf_token(force_refresh=True)
            if fresh_token and fresh_token != csrf_token:
                logger.warning('Log image upload rejected (status=%s), retrying with a fresh CSRF token',
                               result.get('status'))
                result = self._upload_log_draft_image_with_token(filename, content, content_type, fresh_token)

        return result

    def _upload_log_draft_image_with_token(
        self,
        filename: str,
        content: bytes,
        content_type: str,
        csrf_token: str,
    ) -> dict[str, Any] | None:
        headers = {
            'Accept': 'application/json',
            'CSRF-Token': csrf_token,
        }
        files = {LOG_IMAGE_FORM_FIELD: (filename, content, content_type)}

        try:
            resp = self.session.post(LOG_DRAFT_IMAGES_URL, headers=headers, files=files, timeout=60)
        except requests.RequestException as e:  # pragma: no cover
            logger.error('Failed to upload log image %r: %s', filename, e)
            return {'ok': False, 'status': 0, 'error': str(e)}

        body_preview = (resp.text or '')[:2000]

        if resp.status_code not in (200, 201):
            logger.error('Log image upload failed for %r: status=%s body=%r',
                         filename, resp.status_code, body_preview)
            return {'ok': False, 'status': resp.status_code, 'body': body_preview}

        try:
            data = resp.json() if resp.content else None
        except ValueError as e:
            logger.error('Log image upload invalid JSON for %r: %s body=%r', filename, e, body_preview)
            return {'ok': False, 'status': resp.status_code, 'body': body_preview}

        if isinstance(data, dict):
            data.setdefault('ok', True)
            return data
        return {'ok': True, 'data': data}

    @staticmethod
    def extract_image_guid(payload: Any) -> str | None:
        if isinstance(payload, dict):
            for key in ('imageGuid', 'ImageGuid', 'guid', 'Guid', 'image_guid', 'imageGUID'):
                value = payload.get(key)
                if isinstance(value, str) and value.strip():
                    return value.strip()
            for value in payload.values():
                guid = GeocachingSubmitLogsClient.extract_image_guid(value)
                if guid:
                    return guid
        if isinstance(payload, list):
            for value in payload:
                guid = GeocachingSubmitLogsClient.extract_image_guid(value)
                if guid:
                    return guid
        return None

    @staticmethod
    def unwrap_trpc_payload(payload: Any) -> dict[str, Any] | None:
        """Extrait le contenu utile d'une réponse tRPC "batch".

        Forme attendue : ``[{"result": {"data": {...}}}]`` (parfois enveloppé
        dans un niveau ``json`` supplémentaire selon le transformer utilisé).
        Retourne None si la réponse n'a pas cette forme (ex: enveloppe d'erreur).
        """
        node = payload
        if isinstance(node, list):
            node = node[0] if node else None
        if not isinstance(node, dict):
            return None

        result = node.get('result')
        if not isinstance(result, dict):
            return None

        data = result.get('data')
        if isinstance(data, dict) and 'logReferenceCode' not in data and isinstance(data.get('json'), dict):
            data = data['json']
        return data if isinstance(data, dict) else None

    @staticmethod
    def extract_trpc_error(payload: Any) -> str | None:
        """Récupère le message d'erreur d'une enveloppe tRPC, si présent."""
        node = payload
        if isinstance(node, list):
            node = node[0] if node else None
        if not isinstance(node, dict):
            return None

        error = node.get('error')
        if not isinstance(error, dict):
            return None

        candidates = [error]
        inner = error.get('json')
        if isinstance(inner, dict):
            candidates.insert(0, inner)

        for candidate in candidates:
            message = candidate.get('message')
            if isinstance(message, str) and message.strip():
                return message.strip()
        return None

    def submit_geocache_log(
        self,
        gc_code: str,
        *,
        log_type_id: int,
        log_text: str,
        visited_date: date_type,
        images: list[str] | None = None,
        used_favorite_point: bool | None = None,
    ) -> dict[str, Any] | None:
        gc_code = gc_code.strip().upper()
        if not gc_code:
            return None

        csrf_token = self.get_csrf_token()
        if not csrf_token:
            logger.error('Could not get CSRF token')
            return None

        safe_images: list[str] = []
        if isinstance(images, list):
            for value in images:
                if isinstance(value, str) and value.strip():
                    safe_images.append(value.strip())

        # Corps du log, identique à celui construit par c:geo (buildLogBodyNode).
        # logDate : timestamp local sans fuseau, ex "2026-07-26T12:00:00".
        log_body: dict[str, Any] = {
            'images': safe_images,
            'logDate': datetime.combine(visited_date, time(12, 0, 0)).isoformat(timespec='seconds'),
            'logText': log_text,
            'logType': log_type_id,
            'trackables': [],
            'geocacheReferenceCode': '',
        }
        if used_favorite_point is not None:
            log_body['usedFavoritePoint'] = bool(used_favorite_point)

        result = self._submit_log_with_token(gc_code, log_body, csrf_token)

        # Le jeton mémorisé a pu expirer au milieu d'un lot : on le renouvelle et on rejoue
        # une fois, plutôt que de rendre un échec que l'utilisateur devrait relancer.
        if self._is_csrf_rejection(result):
            self.invalidate_csrf_token()
            fresh_token = self.get_csrf_token(force_refresh=True)
            if fresh_token and fresh_token != csrf_token:
                logger.warning('Log submit rejected for %s (status=%s), retrying with a fresh CSRF token',
                               gc_code, result.get('status'))
                result = self._submit_log_with_token(gc_code, log_body, fresh_token)

        return result

    def _submit_log_with_token(
        self,
        gc_code: str,
        log_body: dict[str, Any],
        csrf_token: str,
    ) -> dict[str, Any] | None:
        headers = {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'CSRF-Token': csrf_token,
        }

        result = self._post_log_trpc(gc_code, log_body, headers)

        # Si l'endpoint tRPC est absent (site revenu en arrière / déploiement partiel),
        # on retente l'ancien endpoint REST plutôt que d'échouer sèchement.
        if isinstance(result, dict) and not result.get('ok') and result.get('status') in (404, 405):
            logger.warning('tRPC log endpoint unavailable for %s (status=%s), falling back to legacy endpoint',
                           gc_code, result.get('status'))
            legacy = self._post_log_legacy(gc_code, log_body, headers)
            if legacy is not None and (not isinstance(legacy, dict) or legacy.get('logReferenceCode')):
                return legacy

        return result

    def _post_log_trpc(
        self,
        gc_code: str,
        log_body: dict[str, Any],
        headers: dict[str, str],
    ) -> dict[str, Any] | None:
        payload = {'0': {'referenceCode': gc_code, 'body': log_body}}

        response = self._post_json(
            TRPC_CREATE_GEOCACHE_LOG_URL,
            params={'batch': '1'},
            payload=payload,
            headers=headers,
            gc_code=gc_code,
        )
        if response is None:
            return None

        status, data, body_preview = response

        error_message = self.extract_trpc_error(data)
        if error_message:
            logger.error('Log submit rejected for %s: status=%s message=%r', gc_code, status, error_message)
            return {
                'ok': False,
                'status': status,
                'error_message': error_message,
                'body': body_preview,
            }

        unwrapped = self.unwrap_trpc_payload(data)
        if unwrapped is None or not unwrapped.get('logReferenceCode'):
            logger.error('Log submit returned no logReferenceCode for %s: status=%s body=%r',
                         gc_code, status, body_preview)
            return {
                'ok': status == 200,
                'status': status,
                'body': body_preview,
            }

        unwrapped.setdefault('ok', True)
        return unwrapped

    def _post_log_legacy(
        self,
        gc_code: str,
        log_body: dict[str, Any],
        headers: dict[str, str],
    ) -> dict[str, Any] | None:
        payload = {key: value for key, value in log_body.items() if key != 'geocacheReferenceCode'}

        response = self._post_json(
            LEGACY_CREATE_GEOCACHE_LOG_URL.format(gc_code=gc_code),
            params=None,
            payload=payload,
            headers=headers,
            gc_code=gc_code,
        )
        if response is None:
            return None

        status, data, body_preview = response
        if not isinstance(data, dict):
            return {'ok': False, 'status': status, 'body': body_preview}

        data.setdefault('ok', status == 200)
        return data

    def _post_json(
        self,
        url: str,
        *,
        params: dict[str, str] | None,
        payload: dict[str, Any],
        headers: dict[str, str],
        gc_code: str,
    ) -> tuple[int, Any, str] | None:
        """POST JSON et retourne (status, json_décodé_ou_None, extrait_du_corps)."""
        try:
            resp = self.session.post(url, params=params, json=payload, headers=headers, timeout=60)
        except requests.RequestException as e:  # pragma: no cover
            logger.error('Failed to submit log for %s: %s', gc_code, e)
            return None

        body_preview = (resp.text or '')[:2000]
        if resp.status_code != 200:
            logger.error('Log submit failed for %s: status=%s body=%r', gc_code, resp.status_code, body_preview)

        try:
            data = resp.json() if resp.content else None
        except ValueError as e:
            logger.error('Log submit invalid JSON for %s: %s body=%r', gc_code, e, body_preview)
            data = None

        return resp.status_code, data, body_preview
