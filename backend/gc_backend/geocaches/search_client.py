"""Geocaching.com search client.

This module provides a small wrapper around Geocaching.com's internal web search API
to retrieve nearby geocache GC codes around a given center point.

It is designed to be used by backend endpoints that then import/cache full geocache
details using the existing scraping/import pipeline.
"""

from __future__ import annotations

import logging
import math
import time
from dataclasses import dataclass
from typing import Any, Optional

import requests

from .scraper import GC_CODE_RE
from ..services.geocaching_auth import get_auth_service


logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class GeocacheSearchResult:
    """A lightweight search result returned by the search API."""

    gc_code: str
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    name: Optional[str] = None
    cache_type: Optional[str] = None
    difficulty: Optional[float] = None
    terrain: Optional[float] = None
    size: Optional[str] = None
    favorites_count: Optional[int] = None
    owner: Optional[str] = None
    found: Optional[bool] = None


class GeocachingSearchClient:
    """Client for Geocaching.com internal search endpoint.

    The API and response format are not publicly documented and may change.
    """

    API_URL = "https://www.geocaching.com/api/proxy/web/search/v2"

    def __init__(self, session: Optional[requests.Session] = None) -> None:
        if session is not None:
            self.session = session
        else:
            auth_service = get_auth_service()
            self.session = auth_service.get_session()
            
            if not auth_service.is_logged_in():
                logger.warning("Not logged in to Geocaching.com - search may fail!")
                logger.warning("Please configure authentication in GeoApp preferences.")

    def search(
        self,
        *,
        center_lat: float,
        center_lon: float,
        limit: int = 50,
        radius_km: Optional[float] = None,
        min_km: Optional[float] = None,
        per_query: int = 50,
    ) -> list[GeocacheSearchResult]:
        """Search geocaches around a center point.

        Args:
            center_lat: Latitude of center point.
            center_lon: Longitude of center point.
            limit: Max number of geocaches to return.
            radius_km: Optional max radius in km. When provided, a bounding box is sent to the API
                and results are filtered by haversine distance when coordinates are available.
            min_km: Optional minimum distance in km. Results closer than this are excluded.
            per_query: Page size.

        Returns:
            List of lightweight search results containing GC codes.
        """

        if limit <= 0:
            return []

        take_amount = max(1, min(int(per_query), 200))
        headers = {
            "Accept": "application/json",
            "X-Requested-With": "XMLHttpRequest",
        }

        params_base: dict[str, Any] = {
            "origin": f"{center_lat},{center_lon}",
            "sort": "distance",
            "asc": "true",
        }

        if radius_km is not None:
            box = self._bounding_box(center_lat, center_lon, float(radius_km))
            params_base["box"] = box

        results: list[GeocacheSearchResult] = []
        offset = 0

        while len(results) < limit:
            take = min(take_amount, limit - len(results))
            params = dict(params_base)
            params.update({"take": take, "skip": offset})

            # Rate-limit: add a small delay between pages (except the first)
            if offset > 0:
                time.sleep(0.35)

            # Retry on 429 (rate limited)
            resp = None
            for attempt in range(3):
                resp = self.session.get(self.API_URL, params=params, headers=headers, timeout=30)
                if resp.status_code == 429:
                    wait = 2 ** attempt  # 1s, 2s, 4s
                    logger.warning("[search] 429 rate limited at skip=%d, retrying in %ds…", offset, wait)
                    time.sleep(wait)
                    continue
                break
            resp.raise_for_status()
            payload = resp.json() if resp.content else {}

            raw_results = payload.get("results") or []
            if not isinstance(raw_results, list) or not raw_results:
                break

            if offset == 0 and raw_results:
                first_rec = raw_results[0] if isinstance(raw_results[0], dict) else {}
                logger.info(
                    "[search] first raw record keys: %s",
                    sorted(first_rec.keys()) if first_rec else "(empty)",
                )
                logger.debug("[search] first raw record: %r", first_rec)

            page_results: list[GeocacheSearchResult] = []
            for record in raw_results:
                if not isinstance(record, dict):
                    continue

                code = self._extract_gc_code(record)
                if not code:
                    continue

                lat, lon = self._extract_lat_lon(record)
                extra = self._extract_extra_fields(record)
                page_results.append(GeocacheSearchResult(gc_code=code, latitude=lat, longitude=lon, **extra))

            if radius_km is not None:
                page_results = [
                    r for r in page_results if self._within_radius(center_lat, center_lon, r, float(radius_km))
                ]
            if min_km is not None:
                page_results = [
                    r for r in page_results
                    if not self._within_radius(center_lat, center_lon, r, float(min_km))
                ]

            # Dédupliquer tout en gardant l'ordre
            for r in page_results:
                if all(existing.gc_code != r.gc_code for existing in results):
                    results.append(r)
                    if len(results) >= limit:
                        break

            offset += take

            total = payload.get("total")
            if isinstance(total, int) and offset >= total:
                break

        return results

    @staticmethod
    def _bounding_box(center_lat: float, center_lon: float, radius_km: float) -> str:
        # Approximation: 1° lat ≈ 111 km, 1° lon ≈ 111*cos(lat)
        lat_delta = radius_km / 111.0
        lon_delta = radius_km / (111.0 * math.cos(math.radians(center_lat)) or 1e-9)

        north = center_lat + lat_delta
        south = center_lat - lat_delta
        west = center_lon - lon_delta
        east = center_lon + lon_delta

        return f"{north},{west},{south},{east}"

    @staticmethod
    def _extract_gc_code(record: dict[str, Any]) -> Optional[str]:
        candidates = [
            record.get("code"),
            record.get("gcCode"),
            record.get("gc_code"),
            record.get("geocacheCode"),
            record.get("referenceCode"),
            record.get("waypoint"),
            record.get("wp"),
        ]

        # Some payloads may nest identifiers
        geocache = record.get("geocache")
        if isinstance(geocache, dict):
            candidates.extend(
                [
                    geocache.get("code"),
                    geocache.get("gcCode"),
                    geocache.get("referenceCode"),
                    geocache.get("geocacheCode"),
                ]
            )

        for raw in candidates:
            if not raw:
                continue
            code = str(raw).strip().upper()
            if GC_CODE_RE.match(code):
                return code

        return None

    @staticmethod
    def _extract_lat_lon(record: dict[str, Any]) -> tuple[Optional[float], Optional[float]]:
        # Common shapes:
        # - postedCoordinates: { latitude, longitude }
        # - coordinates: { latitude, longitude }
        # - lat/lon fields
        for key in ("postedCoordinates", "coordinates", "location"):
            obj = record.get(key)
            if isinstance(obj, dict):
                lat = obj.get("latitude") or obj.get("lat")
                lon = obj.get("longitude") or obj.get("lon") or obj.get("lng")
                try:
                    return (float(lat), float(lon)) if lat is not None and lon is not None else (None, None)
                except Exception:
                    return (None, None)

        lat = record.get("latitude") or record.get("lat")
        lon = record.get("longitude") or record.get("lon") or record.get("lng")
        try:
            return (float(lat), float(lon)) if lat is not None and lon is not None else (None, None)
        except Exception:
            return (None, None)

    # Geocaching.com search API returns numeric IDs for geocacheType and containerType.
    # Map them to human-readable names used by the frontend filters.
    GEOCACHE_TYPE_MAP: dict[int, str] = {
        2: "Traditional",
        3: "Multi",
        4: "Virtual",
        5: "Letterbox",
        6: "Event",
        8: "Mystery",
        9: "APE",
        11: "Webcam",
        12: "Locationless",
        13: "CITO",
        137: "EarthCache",
        453: "MegaEvent",
        1304: "GPS Adventures",
        1858: "Wherigo",
        3653: "Community Celebration",
        3773: "Geocaching HQ",
        3774: "Geocaching HQ Celebration",
        4738: "Geocaching HQ Block Party",
        7005: "GigaEvent",
    }

    CONTAINER_TYPE_MAP: dict[int, str] = {
        1: "Not chosen",
        2: "Micro",
        3: "Regular",
        4: "Large",
        5: "Virtual",
        6: "Other",
        8: "Small",
    }

    @staticmethod
    def _extract_extra_fields(record: dict[str, Any]) -> dict[str, Any]:
        """Extract optional metadata fields from a search result record."""
        extra: dict[str, Any] = {}

        # Name
        name = record.get("name")
        if name:
            extra["name"] = str(name)

        # Difficulty / Terrain
        for field in ("difficulty", "terrain"):
            val = record.get(field)
            if val is not None:
                try:
                    extra[field] = float(val)
                except (ValueError, TypeError):
                    pass

        # Cache type – can be a dict {id, name}, an int ID, or a plain string
        gc_type = record.get("geocacheType") or record.get("type")
        if isinstance(gc_type, dict):
            type_name = gc_type.get("name") or gc_type.get("type")
            type_id = gc_type.get("id")
            if not type_name and isinstance(type_id, int):
                type_name = GeocachingSearchClient.GEOCACHE_TYPE_MAP.get(type_id)
            extra["cache_type"] = type_name or str(type_id or gc_type)
        elif isinstance(gc_type, int):
            extra["cache_type"] = GeocachingSearchClient.GEOCACHE_TYPE_MAP.get(gc_type, str(gc_type))
        elif gc_type is not None:
            extra["cache_type"] = str(gc_type)

        # Container size – can be a dict {id, name}, an int ID, or a plain string
        container = record.get("containerType") or record.get("container") or record.get("size")
        if isinstance(container, dict):
            size_name = container.get("name") or container.get("text")
            size_id = container.get("id")
            if not size_name and isinstance(size_id, int):
                size_name = GeocachingSearchClient.CONTAINER_TYPE_MAP.get(size_id)
            extra["size"] = size_name or str(size_id or container)
        elif isinstance(container, int):
            extra["size"] = GeocachingSearchClient.CONTAINER_TYPE_MAP.get(container, str(container))
        elif container is not None:
            extra["size"] = str(container)

        # Favorite points
        fav = record.get("favoritePoints") or record.get("favorites_count")
        if fav is not None:
            try:
                extra["favorites_count"] = int(fav)
            except (ValueError, TypeError):
                pass

        # Owner
        owner_obj = record.get("owner")
        if isinstance(owner_obj, dict):
            extra["owner"] = owner_obj.get("username") or owner_obj.get("code")
        elif owner_obj is not None:
            extra["owner"] = str(owner_obj)

        # Found status
        user_found = record.get("userFound") or record.get("found")
        if user_found is not None:
            extra["found"] = bool(user_found)

        return extra

    @staticmethod
    def _within_radius(
        center_lat: float,
        center_lon: float,
        result: GeocacheSearchResult,
        radius_km: float,
    ) -> bool:
        if result.latitude is None or result.longitude is None:
            return True

        return GeocachingSearchClient._haversine_km(
            center_lat,
            center_lon,
            result.latitude,
            result.longitude,
        ) <= radius_km

    @staticmethod
    def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
        r_km = 6371.0

        dlat = math.radians(lat2 - lat1)
        dlon = math.radians(lon2 - lon1)

        a = (
            math.sin(dlat / 2) ** 2
            + math.cos(math.radians(lat1))
            * math.cos(math.radians(lat2))
            * math.sin(dlon / 2) ** 2
        )
        c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
        return r_km * c
