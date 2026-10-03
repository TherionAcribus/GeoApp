"""
Ma date de trouvaille d'une cache sur Geocaching.com.

La fiche JSON d'une cache (``/api/proxy/web/v1/geocache/{code}``, ~0,2 s) porte
``callerSpecific.found`` : la date de MA trouvaille. Elle sert à :

- « Vérifier sur Geocaching.com » (widget Visites GPS) : une cache trouvée le jour de
  la visite est déjà loguée, la visite est réglée ;
- avant l'envoi d'un « Found it » (``logs/submit``) : ne pas en poster un second quand
  la base locale ignore la trouvaille (log posté depuis le téléphone, par exemple).

Un DNF ou une note n'y figurent pas : seule une trouvaille est détectable.
"""
from __future__ import annotations

import logging
import time as time_module
from datetime import date
from typing import Callable, Iterable, Optional

logger = logging.getLogger(__name__)

GEOCACHE_SHEET_URL = 'https://www.geocaching.com/api/proxy/web/v1/geocache/{code}'
# Avant un envoi, la vérification ne retient pas le log plus de quelques secondes.
PRE_SUBMIT_TIMEOUT_SECONDS = 5
CHECK_INTERVAL_SECONDS = 0.15
# Une vérification lit au plus tant de fiches (~1 min) ; le reste est signalé.
MAX_CHECKS = 150

LookupFn = Callable[[str], Optional[dict]]


def sheet_lookup(session, timeout: float = 20) -> LookupFn:
    """Fiche JSON d'une cache, ou None si absente ou illisible. Session expirée : ``NotAuthenticatedError``."""
    def lookup(code: str) -> Optional[dict]:
        try:
            response = session.get(GEOCACHE_SHEET_URL.format(code=code), timeout=timeout,
                                   headers={'Accept': 'application/json'})
        except Exception as exc:  # noqa: BLE001 - une fiche manquante n'arrête pas le reste
            logger.warning('Fiche de %s illisible : %s', code, exc)
            return None
        if response.status_code in (401, 403):
            from .geocaching_friends import NotAuthenticatedError
            raise NotAuthenticatedError('Session Geocaching.com expirée')
        if not response.ok:
            return None
        try:
            return response.json()
        except ValueError:
            return None
    return lookup


def found_on_from_sheet(sheet: Optional[dict]) -> Optional[date]:
    from .gps_visit_resolution import parse_geocache_sheet

    found_on = parse_geocache_sheet(sheet)[3]
    try:
        return date.fromisoformat(found_on) if found_on else None
    except ValueError:
        return None


def check_codes(codes: Iterable[str], lookup: LookupFn, *, max_checks: int = MAX_CHECKS,
                sleep: Callable[[float], None] = time_module.sleep
                ) -> tuple[dict[str, Optional[date]], list[str], list[str]]:
    """
    Ma date de trouvaille de chaque code (None : pas trouvée), lue sur une fiche fraîche.

    Renvoie ``(dates, illisibles, non vérifiés)`` : une fiche illisible ne dit rien, et
    au-delà de ``max_checks`` les codes restants ne sont pas lus.
    """
    from .gps_visit_resolution import remember_sheet

    codes = list(dict.fromkeys(codes))
    found: dict[str, Optional[date]] = {}
    unknown: list[str] = []
    for index, code in enumerate(codes[:max_checks]):
        if index:
            sleep(CHECK_INTERVAL_SECONDS)
        sheet = lookup(code)
        remember_sheet(code, sheet)
        if sheet is None:
            unknown.append(code)
        else:
            found[code] = found_on_from_sheet(sheet)
    return found, unknown, codes[max_checks:]


def remote_found_date(gc_code: str) -> Optional[date]:
    """
    Avant un envoi : ma date de trouvaille sur Geocaching.com, ou None (pas trouvée, pas
    connecté, réseau). Ne lève jamais : la vérification ne doit pas empêcher un envoi.
    """
    try:
        from .geocaching_auth import get_auth_service

        auth = get_auth_service()
        state = auth.get_auth_state()
        if not state or not getattr(state, 'user_info', None):
            return None
        sheet = sheet_lookup(auth.get_session(), timeout=PRE_SUBMIT_TIMEOUT_SECONDS)(gc_code)
    except Exception as exc:  # noqa: BLE001
        logger.info('Vérification de %s sur Geocaching.com impossible : %s', gc_code, exc)
        return None
    return found_on_from_sheet(sheet)
