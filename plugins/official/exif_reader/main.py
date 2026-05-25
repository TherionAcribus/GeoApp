"""GeoApp plugin: read Exif metadata from geocache images."""

from __future__ import annotations

from io import BytesIO
import time
from typing import Any, Dict, List, Optional

from loguru import logger

try:  # pragma: no cover - depends on runtime environment
    import requests
    from PIL import Image
    from PIL.ExifTags import GPSTAGS, TAGS
except Exception as import_error:  # noqa: F401
    IMPORT_ERROR = import_error
    requests = None  # type: ignore
    Image = None  # type: ignore
    GPSTAGS = {}  # type: ignore
    TAGS = {}  # type: ignore
else:
    IMPORT_ERROR = None


INTERESTING_TAGS = {
    "ImageDescription",
    "XPTitle",
    "XPComment",
    "Artist",
    "Copyright",
    "UserComment",
    "Make",
    "Model",
    "Software",
    "DateTime",
    "DateTimeOriginal",
    "DateTimeDigitized",
    "GPSInfo",
}


class ExifReaderPlugin:
    """Read Exif metadata and GPS coordinates from images."""

    def __init__(self) -> None:
        self.name = "exif_reader"
        self.version = "1.0.0"

    def execute(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        start = time.time()

        if IMPORT_ERROR is not None or requests is None or Image is None:
            return {
                "status": "error",
                "summary": f"Dependances manquantes pour la lecture Exif: {IMPORT_ERROR}",
                "results": [],
                "exif": [],
                "gps_coordinates": [],
                "images_analyzed": 0,
                "plugin_info": self._build_plugin_info(start),
            }

        explicit_images = self._collect_explicit_images(inputs)
        geocache = None
        geocache_id_raw = inputs.get("geocache_id")
        if geocache_id_raw is not None and not explicit_images:
            geocache = self._load_geocache(str(geocache_id_raw).strip())
            if geocache is None:
                return {
                    "status": "error",
                    "summary": f"Geocache introuvable pour identifiant {geocache_id_raw!r}",
                    "results": [],
                    "exif": [],
                    "gps_coordinates": [],
                    "images_analyzed": 0,
                    "plugin_info": self._build_plugin_info(start),
                }

        image_urls = explicit_images or (self._collect_image_urls(geocache) if geocache else [])
        if not image_urls:
            return {
                "status": "success",
                "summary": "Aucune image a analyser",
                "results": [],
                "exif": [],
                "gps_coordinates": [],
                "images_analyzed": 0,
                "plugin_info": self._build_plugin_info(start),
            }

        findings: List[Dict[str, Any]] = []
        exif_items: List[Dict[str, Any]] = []
        gps_coordinates: List[Dict[str, Any]] = []
        image_details: List[Dict[str, Any]] = []
        images_analyzed = 0

        for raw_url in image_urls:
            image_url = self._normalize_image_url(raw_url)
            image_bytes = self._fetch_image_bytes(image_url)
            if not image_bytes:
                continue

            try:
                with Image.open(BytesIO(image_bytes)) as image:
                    width, height = image.size
                    image_format = image.format
                    exif = image.getexif()
            except Exception as exc:
                logger.warning("[exif_reader] Failed reading image {}: {}", image_url, exc)
                continue

            images_analyzed += 1
            detail = {
                "image_url": image_url,
                "width": int(width) if isinstance(width, int) else 0,
                "height": int(height) if isinstance(height, int) else 0,
                "format": image_format,
                "byte_size": len(image_bytes),
            }
            image_details.append(detail)

            if not exif:
                findings.append({
                    "id": f"exif_{len(findings) + 1}",
                    "text_output": f"Aucune metadonnee Exif trouvee dans {image_url}",
                    "image_url": image_url,
                    "confidence": 1.0,
                    "metadata": {"has_exif": False, "image": detail},
                })
                continue

            named_exif = self._named_exif(exif)
            serializable_exif = {
                key: self._normalize_exif_value(value)
                for key, value in named_exif.items()
            }
            serializable_exif = {
                key: value
                for key, value in serializable_exif.items()
                if value not in (None, "", [], {})
            }

            image_exif_item = {
                "image_url": image_url,
                "tags": serializable_exif,
                "interesting_tags": {
                    key: serializable_exif[key]
                    for key in sorted(INTERESTING_TAGS)
                    if key in serializable_exif
                },
            }
            exif_items.append(image_exif_item)

            gps = self._extract_gps_coordinates(named_exif.get("GPSInfo"))
            if gps:
                gps_item = {
                    "image_url": image_url,
                    **gps,
                }
                gps_coordinates.append(gps_item)

            interesting_text = self._build_interesting_text(image_exif_item, gps)
            findings.append({
                "id": f"exif_{len(findings) + 1}",
                "text_output": interesting_text,
                "image_url": image_url,
                "confidence": 0.95,
                "metadata": {
                    "has_exif": True,
                    "tag_count": len(serializable_exif),
                    "interesting_tags": image_exif_item["interesting_tags"],
                    "gps_coordinates": gps,
                    "image": detail,
                },
                "coordinates": gps,
                "decimal_latitude": gps.get("decimal_latitude") if gps else None,
                "decimal_longitude": gps.get("decimal_longitude") if gps else None,
            })

        if not images_analyzed:
            summary = "Aucune image n'a pu etre analysee"
        elif gps_coordinates:
            summary = (
                f"Exif: {len(exif_items)} image(s) avec metadonnees, "
                f"{len(gps_coordinates)} coordonnee(s) GPS sur {images_analyzed} image(s)"
            )
        elif exif_items:
            summary = f"Exif: donnees trouvees sur {len(exif_items)} image(s), sans coordonnees GPS"
        else:
            summary = f"Aucune donnee Exif trouvee sur {images_analyzed} image(s)"

        return {
            "status": "success",
            "summary": summary,
            "results": findings,
            "exif": exif_items,
            "gps_coordinates": gps_coordinates,
            "image_details": image_details,
            "images_analyzed": images_analyzed,
            "primary_coordinates": gps_coordinates[0] if gps_coordinates else None,
            "plugin_info": self._build_plugin_info(start),
        }

    @staticmethod
    def _build_plugin_info(start_time: float) -> Dict[str, Any]:
        return {
            "name": "exif_reader",
            "version": "1.0.0",
            "execution_time_ms": int((time.time() - start_time) * 1000),
        }

    @staticmethod
    def _collect_explicit_images(inputs: Dict[str, Any]) -> List[str]:
        image_urls: List[str] = []
        explicit_images = inputs.get("images")
        if isinstance(explicit_images, list):
            for entry in explicit_images:
                url = entry.get("url") if isinstance(entry, dict) else entry
                if isinstance(url, str) and url.strip():
                    image_urls.append(url.strip())
        return image_urls

    @staticmethod
    def _load_geocache(geocache_id_str: str) -> Optional[Any]:
        try:
            from gc_backend.database import db
            from gc_backend.geocaches.models import Geocache
        except Exception as exc:  # pragma: no cover
            logger.error("[exif_reader] Cannot import Geocache: {}", exc)
            return None

        geocache = None
        try:
            geocache_id_int = int(geocache_id_str)
        except (TypeError, ValueError):
            geocache_id_int = None

        if geocache_id_int is not None:
            geocache = db.session.query(Geocache).get(geocache_id_int)
        if geocache is None:
            geocache = db.session.query(Geocache).filter(Geocache.gc_code == geocache_id_str).first()
        return geocache

    @staticmethod
    def _collect_image_urls(geocache: Any) -> List[str]:
        urls: List[str] = []
        images_field = getattr(geocache, "images", None) or []
        if isinstance(images_field, list):
            for entry in images_field:
                url = entry.get("url") if isinstance(entry, dict) else None
                if isinstance(url, str) and url.strip():
                    urls.append(url.strip())

        description_html = getattr(geocache, "description_html", None)
        if description_html:
            try:
                from bs4 import BeautifulSoup

                soup = BeautifulSoup(description_html, "html.parser")
                for img in soup.find_all("img"):
                    src = img.get("src")
                    if isinstance(src, str) and src.strip():
                        urls.append(src.strip())
            except Exception as exc:
                logger.warning("[exif_reader] Failed parsing description_html: {}", exc)

        seen = set()
        unique: List[str] = []
        for url in urls:
            if url not in seen:
                seen.add(url)
                unique.append(url)
        return unique

    @staticmethod
    def _normalize_image_url(url: str) -> str:
        url = (url or "").strip()
        if url.startswith("//"):
            return "https:" + url
        if url.startswith("http://") or url.startswith("https://"):
            return url
        if url.startswith("/"):
            return "https://www.geocaching.com" + url
        return url

    @staticmethod
    def _fetch_image_bytes(url: str) -> Optional[bytes]:
        try:
            if "/api/geocache-images/" in url and url.rstrip("/").endswith("/content"):
                image_id = ExifReaderPlugin._extract_local_image_id(url)
                if image_id is not None:
                    content = ExifReaderPlugin._read_stored_image_bytes(image_id)
                    if content:
                        return content

            res = requests.get(url, timeout=30)
            if res.status_code != 200:
                logger.warning("[exif_reader] HTTP {} for {}", res.status_code, url)
                return None
            return res.content
        except Exception as exc:  # pragma: no cover
            logger.warning("[exif_reader] Failed fetching {}: {}", url, exc)
            return None

    @staticmethod
    def _extract_local_image_id(url: str) -> Optional[int]:
        try:
            raw = url.split("/api/geocache-images/", 1)[1].split("/", 1)[0]
            return int(raw)
        except Exception:
            return None

    @staticmethod
    def _read_stored_image_bytes(image_id: int) -> Optional[bytes]:
        try:
            from gc_backend.blueprints.geocache_images import _safe_resolve_stored_file
            from gc_backend.geocaches.models import GeocacheImage

            image = GeocacheImage.query.get(image_id)
            if not image or not image.stored or not image.stored_path:
                return None
            file_path = _safe_resolve_stored_file(image.stored_path)
            return file_path.read_bytes()
        except Exception as exc:
            logger.debug("[exif_reader] Cannot read local image {}: {}", image_id, exc)
            return None

    @staticmethod
    def _named_exif(exif: Any) -> Dict[str, Any]:
        named: Dict[str, Any] = {}
        for tag_id, value in exif.items():
            tag_name = str(TAGS.get(tag_id, tag_id))
            if tag_name == "GPSInfo" and hasattr(exif, "get_ifd"):
                try:
                    value = exif.get_ifd(tag_id)
                except Exception:
                    pass
            named[tag_name] = value
        return named

    @staticmethod
    def _normalize_exif_value(value: Any) -> Any:
        if value is None:
            return None
        if isinstance(value, bytes):
            for encoding in ("utf-16le", "utf-8", "latin-1"):
                try:
                    text = value.decode(encoding, errors="ignore").replace("\x00", "").strip()
                    if text:
                        return text
                except Exception:
                    continue
            return value.hex()
        if isinstance(value, dict):
            return {
                str(GPSTAGS.get(key, key)): ExifReaderPlugin._normalize_exif_value(val)
                for key, val in value.items()
            }
        if isinstance(value, (list, tuple)):
            return [ExifReaderPlugin._normalize_exif_value(item) for item in value]
        if hasattr(value, "numerator") and hasattr(value, "denominator"):
            denominator = getattr(value, "denominator", 0) or 0
            if denominator:
                return float(value.numerator) / float(denominator)
            return None
        if isinstance(value, (str, int, float, bool)):
            return value
        return str(value)

    @staticmethod
    def _ratio_to_float(value: Any) -> Optional[float]:
        try:
            if hasattr(value, "numerator") and hasattr(value, "denominator"):
                denominator = float(value.denominator or 0)
                if denominator == 0:
                    return None
                return float(value.numerator) / denominator
            if isinstance(value, (tuple, list)) and len(value) == 2:
                denominator = float(value[1] or 0)
                if denominator == 0:
                    return None
                return float(value[0]) / denominator
            return float(value)
        except Exception:
            return None

    @staticmethod
    def _extract_gps_coordinates(gps_info: Any) -> Optional[Dict[str, Any]]:
        if not isinstance(gps_info, dict):
            return None

        named_gps: Dict[str, Any] = {
            str(GPSTAGS.get(key, key)): value
            for key, value in gps_info.items()
        }

        latitude_values = named_gps.get("GPSLatitude")
        latitude_ref = str(named_gps.get("GPSLatitudeRef") or "").strip().upper()
        longitude_values = named_gps.get("GPSLongitude")
        longitude_ref = str(named_gps.get("GPSLongitudeRef") or "").strip().upper()
        if not latitude_values or not longitude_values or not latitude_ref or not longitude_ref:
            return None

        def convert_triplet(values: Any, ref: str) -> Optional[float]:
            if not isinstance(values, (list, tuple)) or len(values) != 3:
                return None
            degrees = ExifReaderPlugin._ratio_to_float(values[0])
            minutes = ExifReaderPlugin._ratio_to_float(values[1])
            seconds = ExifReaderPlugin._ratio_to_float(values[2])
            if degrees is None or minutes is None or seconds is None:
                return None
            decimal = degrees + (minutes / 60.0) + (seconds / 3600.0)
            if ref in {"S", "W"}:
                decimal *= -1
            return round(decimal, 6)

        latitude = convert_triplet(latitude_values, latitude_ref)
        longitude = convert_triplet(longitude_values, longitude_ref)
        if latitude is None or longitude is None:
            return None

        return {
            "formatted": f"{latitude}, {longitude}",
            "decimal": f"{latitude}, {longitude}",
            "decimal_latitude": latitude,
            "decimal_longitude": longitude,
            "latitude": latitude,
            "longitude": longitude,
            "gps_ref": {"latitude": latitude_ref, "longitude": longitude_ref},
        }

    @staticmethod
    def _build_interesting_text(image_exif_item: Dict[str, Any], gps: Optional[Dict[str, Any]]) -> str:
        image_url = image_exif_item.get("image_url")
        tags = image_exif_item.get("interesting_tags") or {}
        parts: List[str] = [f"Exif detecte dans {image_url}"]
        for key, value in tags.items():
            if key == "GPSInfo":
                continue
            parts.append(f"{key}: {value}")
        if gps:
            parts.append(f"GPS: {gps.get('formatted')}")
        return "\n".join(parts)


plugin = ExifReaderPlugin()


def execute(inputs: Dict[str, Any]) -> Dict[str, Any]:
    return plugin.execute(inputs)
