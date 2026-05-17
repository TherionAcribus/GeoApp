"""Low-level utilities for downloading and storing geocache images on disk."""

from __future__ import annotations

import hashlib
import ipaddress
import logging
import mimetypes
from pathlib import Path
from typing import Optional, Tuple
from urllib.parse import urlparse

import requests


logger = logging.getLogger(__name__)

MAX_IMAGE_DOWNLOAD_BYTES = 15 * 1024 * 1024
DOWNLOAD_CHUNK_SIZE = 64 * 1024

IMAGE_SIGNATURES: tuple[tuple[str, bytes], ...] = (
    ('image/png', b'\x89PNG\r\n\x1a\n'),
    ('image/jpeg', b'\xff\xd8'),
    ('image/gif', b'GIF87a'),
    ('image/gif', b'GIF89a'),
)


def get_images_root_dir() -> Path:
    """Return the root directory where geocache images are stored."""
    return Path(__file__).resolve().parents[2] / 'data' / 'geocache_images'


def ensure_geocache_dir(geocache_id: int) -> Path:
    """Ensure and return the directory used to store images for a geocache."""
    root = get_images_root_dir()
    root.mkdir(parents=True, exist_ok=True)
    geocache_dir = root / str(geocache_id)
    geocache_dir.mkdir(parents=True, exist_ok=True)
    return geocache_dir


def guess_extension(source_url: str, content_type: Optional[str]) -> str:
    """Guess a file extension based on content type and URL."""
    if content_type:
        content_type = content_type.split(';')[0].strip().lower()
        ext = mimetypes.guess_extension(content_type)
        if ext:
            return ext

    path = (source_url or '').split('?')[0]
    suffix = Path(path).suffix
    if suffix and len(suffix) <= 5:
        return suffix

    return '.jpg'


def validate_remote_image_url(source_url: str) -> None:
    """Reject non-HTTP and obvious local/private targets before downloading."""
    parsed = urlparse(source_url or '')
    if parsed.scheme not in {'http', 'https'} or not parsed.netloc:
        raise ValueError('Only HTTP(S) image URLs can be downloaded')

    host = (parsed.hostname or '').strip().lower()
    if host in {'localhost'}:
        raise ValueError('Local image URLs cannot be downloaded')

    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        return

    if ip.is_loopback or ip.is_private or ip.is_link_local or ip.is_reserved or ip.is_multicast:
        raise ValueError('Private image URLs cannot be downloaded')


def detect_image_mime_type(content: bytes, declared_content_type: Optional[str] = None) -> str:
    """Return a safe image MIME type based on bytes, falling back to trusted declarations."""
    if not content:
        raise ValueError('Image content is empty')

    for mime_type, signature in IMAGE_SIGNATURES:
        if content.startswith(signature):
            return mime_type

    if content.startswith(b'RIFF') and len(content) > 12 and content[8:12] == b'WEBP':
        return 'image/webp'

    raise ValueError('Downloaded file is not a supported image')


def download_image(source_url: str, timeout_sec: int = 20, max_bytes: int = MAX_IMAGE_DOWNLOAD_BYTES) -> Tuple[bytes, str, int]:
    """Download an image and return (content, content_type, status_code)."""
    validate_remote_image_url(source_url)

    with requests.get(source_url, stream=True, timeout=timeout_sec) as res:
        content_type = res.headers.get('content-type', '')
        chunks: list[bytes] = []
        total = 0
        for chunk in res.iter_content(chunk_size=DOWNLOAD_CHUNK_SIZE):
            if not chunk:
                continue
            total += len(chunk)
            if total > max_bytes:
                raise ValueError('Image is too large')
            chunks.append(chunk)
        return b''.join(chunks), content_type, res.status_code


def write_image_file(geocache_id: int, image_id: int, content: bytes, content_type: Optional[str], source_url: str) -> Tuple[str, str, int, str]:
    """Write the image file to disk and return metadata.

    Returns:
        stored_path: str (relative path within the geocache_images root)
        mime_type: str
        byte_size: int
        sha256: str
    """
    geocache_dir = ensure_geocache_dir(geocache_id)

    mime_type = detect_image_mime_type(content, content_type)
    ext = guess_extension(source_url, mime_type)
    filename = f"{image_id}{ext}"
    full_path = geocache_dir / filename

    full_path.write_bytes(content)

    sha = hashlib.sha256(content).hexdigest()
    byte_size = len(content)

    stored_path = f"{geocache_id}/{filename}"
    return stored_path, mime_type, byte_size, sha


def remove_geocache_dir(geocache_id: int) -> None:
    """Remove all stored files for a geocache."""
    geocache_dir = get_images_root_dir() / str(geocache_id)
    if not geocache_dir.exists():
        return

    for path in geocache_dir.rglob('*'):
        if path.is_file():
            try:
                path.unlink()
            except Exception as exc:  # pragma: no cover
                logger.warning('Failed to delete file %s: %s', path, exc)

    try:
        for path in sorted(geocache_dir.glob('**/*'), reverse=True):
            if path.is_dir():
                path.rmdir()
        geocache_dir.rmdir()
    except Exception as exc:  # pragma: no cover
        logger.warning('Failed to delete directory %s: %s', geocache_dir, exc)
