"""Synchronization helpers to keep legacy Geocache.images JSON and GeocacheImage rows aligned."""

from __future__ import annotations

import logging
from typing import Iterable

from ..database import db
from .models import Geocache, GeocacheImage


logger = logging.getLogger(__name__)


def extract_image_urls(images_json: object) -> list[str]:
    """Extract a list of URLs from the Geocache.images JSON payload."""
    entries = extract_image_entries(images_json)
    return [e['url'] for e in entries]


def extract_image_entries(images_json: object) -> list[dict]:
    """Extract image entries (url, title, image_type) from the Geocache.images JSON payload."""
    if not images_json:
        return []

    if not isinstance(images_json, list):
        return []

    entries: list[dict] = []
    for entry in images_json:
        if not isinstance(entry, dict):
            continue
        url = (entry.get('url') or '').strip()
        if not url:
            continue
        title = (entry.get('title') or '').strip() or None
        image_type = entry.get('type') or 'listing'
        entries.append({'url': url, 'title': title, 'image_type': image_type})
    return entries


def ensure_images_v2_for_geocache(geocache: Geocache) -> int:
    """Ensure GeocacheImage rows exist for the geocache images.

    Returns:
        Number of images created.
    """
    entries = extract_image_entries(geocache.images)
    if not entries:
        return 0

    logger.info('[image_sync] geocache_id=%s: %d entrée(s) image à synchroniser', geocache.id, len(entries))
    created = 0
    for entry in entries:
        url = entry['url']
        existing = GeocacheImage.query.filter_by(
            geocache_id=geocache.id,
            source_url=url,
            parent_image_id=None,
            derivation_type='original',
        ).first()
        if existing:
            logger.debug('[image_sync] image déjà existante (id=%s, type=%s): %s', existing.id, existing.image_type, url)
            continue

        image_type = entry.get('image_type', 'listing')
        title = entry.get('title')
        logger.info('[image_sync] nouvelle image type=%s title=%r url=%s', image_type, title, url)
        db.session.add(
            GeocacheImage(
                geocache_id=geocache.id,
                source_url=url,
                derivation_type='original',
                title=title,
                image_type=image_type,
            )
        )
        created += 1

    logger.info('[image_sync] geocache_id=%s: %d image(s) créée(s)', geocache.id, created)
    return created


def ensure_images_v2_for_all_geocaches(geocaches: Iterable[Geocache] | None = None) -> int:
    """Backfill GeocacheImage rows from all geocaches legacy images."""
    query = geocaches if geocaches is not None else Geocache.query.all()
    created_total = 0
    for geocache in query:
        created_total += ensure_images_v2_for_geocache(geocache)

    if created_total:
        db.session.commit()
        logger.info('Backfilled %s geocache images (v2)', created_total)

    return created_total
