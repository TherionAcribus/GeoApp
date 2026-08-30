from __future__ import annotations

import logging
import unicodedata
from datetime import datetime, timezone

from flask import Blueprint, jsonify, request

from ..database import db
from ..geocaches.models import Geocache, GeocacheImage, GeocacheWaypoint, UserObservation

bp = Blueprint('observations', __name__)
logger = logging.getLogger(__name__)

_OBSERVATION_TYPES = {
    'observation': 'observation',
    'observed': 'observation',
    'note': 'observation',
    'hypothesis': 'hypothesis',
    'hypothese': 'hypothesis',
    'interpretation': 'interpretation',
}


def _normalize_ascii(value: str) -> str:
    return (
        unicodedata.normalize('NFKD', value)
        .encode('ascii', 'ignore')
        .decode('ascii')
        .strip()
        .lower()
    )


def _normalize_observation_type(value: object) -> str | None:
    raw = str(value or 'observation').strip()
    if not raw:
        raw = 'observation'
    return _OBSERVATION_TYPES.get(_normalize_ascii(raw))


def _parse_datetime(value: object, fallback: datetime | None = None) -> datetime | None:
    if value is None or value == '':
        return fallback
    if not isinstance(value, str):
        raise ValueError('observed_at must be an ISO date string')
    normalized = value.strip().replace('Z', '+00:00')
    return datetime.fromisoformat(normalized)


def _optional_float(value: object, field_name: str) -> float | None:
    if value is None or value == '':
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        raise ValueError(f'{field_name} must be a number') from None


def _validate_coordinates(data: dict) -> tuple[float | None, float | None, str | None]:
    latitude = _optional_float(data.get('latitude'), 'latitude')
    longitude = _optional_float(data.get('longitude'), 'longitude')
    if (latitude is None) != (longitude is None):
        raise ValueError('latitude and longitude must be provided together')
    if latitude is not None and not -90 <= latitude <= 90:
        raise ValueError('latitude must be between -90 and 90')
    if longitude is not None and not -180 <= longitude <= 180:
        raise ValueError('longitude must be between -180 and 180')
    coordinates_raw = data.get('coordinates_raw')
    if coordinates_raw is not None:
        coordinates_raw = str(coordinates_raw).strip() or None
    return latitude, longitude, coordinates_raw


def _load_waypoint(geocache_id: int, waypoint_id: object) -> GeocacheWaypoint | None:
    if waypoint_id is None or waypoint_id == '':
        return None
    try:
        parsed_id = int(waypoint_id)
    except (TypeError, ValueError):
        raise ValueError('waypoint_id must be an integer') from None
    waypoint = GeocacheWaypoint.query.filter_by(id=parsed_id, geocache_id=geocache_id).first()
    if not waypoint:
        raise ValueError('waypoint_id does not belong to this geocache')
    return waypoint


def _load_images(geocache_id: int, image_ids: object) -> list[GeocacheImage]:
    if image_ids is None:
        return []
    if not isinstance(image_ids, list):
        raise ValueError('image_ids must be a list')
    parsed_ids: set[int] = set()
    for value in image_ids:
        try:
            parsed_ids.add(int(value))
        except (TypeError, ValueError):
            raise ValueError('image_ids must contain integers') from None
    if not parsed_ids:
        return []
    images = GeocacheImage.query.filter(GeocacheImage.id.in_(parsed_ids)).all()
    found_ids = {image.id for image in images}
    missing = parsed_ids - found_ids
    if missing:
        raise ValueError(f'image_ids not found: {", ".join(str(item) for item in sorted(missing))}')
    wrong_geocache = [image.id for image in images if image.geocache_id != geocache_id]
    if wrong_geocache:
        raise ValueError('image_ids must belong to this geocache')
    return images


def _serialize_list(geocache: Geocache, observations: list[UserObservation]):
    return jsonify({
        'geocache_id': geocache.id,
        'gc_code': geocache.gc_code,
        'name': geocache.name,
        'observations': [observation.to_dict() for observation in observations],
    })


@bp.get('/api/geocaches/<int:geocache_id>/observations')
def list_geocache_observations(geocache_id: int):
    geocache = Geocache.query.get(geocache_id)
    if not geocache:
        return jsonify({'error': 'Geocache not found'}), 404

    observations = (
        UserObservation.query
        .filter_by(geocache_id=geocache_id)
        .order_by(UserObservation.observed_at.desc(), UserObservation.created_at.desc())
        .all()
    )
    return _serialize_list(geocache, observations)


@bp.post('/api/geocaches/<int:geocache_id>/observations')
def create_geocache_observation(geocache_id: int):
    try:
        geocache = Geocache.query.get(geocache_id)
        if not geocache:
            return jsonify({'error': 'Geocache not found'}), 404

        data = request.get_json(silent=True) or {}
        content = str(data.get('content') or data.get('note') or '').strip()
        if not content:
            return jsonify({'error': 'content is required'}), 400

        observation_type = _normalize_observation_type(data.get('observation_type') or data.get('type'))
        if observation_type is None:
            return jsonify({'error': 'observation_type must be one of: observation, hypothesis, interpretation'}), 400

        waypoint = _load_waypoint(geocache_id, data.get('waypoint_id'))
        latitude, longitude, coordinates_raw = _validate_coordinates(data)
        images = _load_images(geocache_id, data.get('image_ids'))

        observation = UserObservation(
            geocache_id=geocache.id,
            user_id=str(data.get('user_id') or 'local-user'),
            observation_type=observation_type,
            content=content,
            observed_at=_parse_datetime(data.get('observed_at'), datetime.now(timezone.utc)),
            waypoint_id=waypoint.id if waypoint else None,
            latitude=latitude,
            longitude=longitude,
            coordinates_raw=coordinates_raw,
        )
        observation.images = images
        db.session.add(observation)
        db.session.commit()

        return jsonify({'observation': observation.to_dict(), 'geocache_id': geocache.id}), 201
    except ValueError as error:
        db.session.rollback()
        return jsonify({'error': str(error)}), 400
    except Exception as error:  # pragma: no cover
        logger.error('Error creating observation for geocache %s: %s', geocache_id, error)
        db.session.rollback()
        raise


@bp.put('/api/observations/<int:observation_id>')
def update_observation(observation_id: int):
    try:
        observation = UserObservation.query.get(observation_id)
        if not observation:
            return jsonify({'error': 'Observation not found'}), 404

        data = request.get_json(silent=True) or {}
        if 'content' in data or 'note' in data:
            content = str(data.get('content') or data.get('note') or '').strip()
            if not content:
                return jsonify({'error': 'content cannot be empty'}), 400
            observation.content = content

        if 'observation_type' in data or 'type' in data:
            observation_type = _normalize_observation_type(data.get('observation_type') or data.get('type'))
            if observation_type is None:
                return jsonify({'error': 'observation_type must be one of: observation, hypothesis, interpretation'}), 400
            observation.observation_type = observation_type

        if 'observed_at' in data:
            observation.observed_at = _parse_datetime(data.get('observed_at'))

        if 'waypoint_id' in data:
            waypoint = _load_waypoint(observation.geocache_id, data.get('waypoint_id'))
            observation.waypoint_id = waypoint.id if waypoint else None

        if any(key in data for key in ('latitude', 'longitude', 'coordinates_raw')):
            latitude, longitude, coordinates_raw = _validate_coordinates(data)
            observation.latitude = latitude
            observation.longitude = longitude
            observation.coordinates_raw = coordinates_raw

        if 'image_ids' in data:
            observation.images = _load_images(observation.geocache_id, data.get('image_ids'))

        db.session.commit()
        return jsonify({'observation': observation.to_dict()})
    except ValueError as error:
        db.session.rollback()
        return jsonify({'error': str(error)}), 400
    except Exception as error:  # pragma: no cover
        logger.error('Error updating observation %s: %s', observation_id, error)
        db.session.rollback()
        raise


@bp.delete('/api/observations/<int:observation_id>')
def delete_observation(observation_id: int):
    try:
        observation = UserObservation.query.get(observation_id)
        if not observation:
            return jsonify({'error': 'Observation not found'}), 404
        db.session.delete(observation)
        db.session.commit()
        return jsonify({'deleted': True})
    except Exception as error:  # pragma: no cover
        logger.error('Error deleting observation %s: %s', observation_id, error)
        db.session.rollback()
        raise
