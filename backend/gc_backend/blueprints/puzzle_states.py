from __future__ import annotations

import json
import logging
from datetime import datetime, timezone

from flask import Blueprint, jsonify, request

from ..database import db
from ..geocaches.models import Geocache, GeocachePuzzleState

bp = Blueprint('puzzle_states', __name__)
logger = logging.getLogger(__name__)


def _normalize_key(value: object, default: str, field_name: str, max_length: int) -> str:
    text = str(value or default).strip()
    if not text:
        text = default
    if len(text) > max_length:
        raise ValueError(f'{field_name} must be at most {max_length} characters')
    return text


def _request_puzzle_type() -> str:
    return _normalize_key(request.args.get('puzzle_type'), 'sudoku_classic', 'puzzle_type', 80)


def _request_state_key() -> str:
    return _normalize_key(request.args.get('state_key'), 'default', 'state_key', 120)


def _find_geocache(geocache_id: int) -> Geocache | None:
    return Geocache.query.get(geocache_id)


def _find_state(geocache_id: int, puzzle_type: str, state_key: str) -> GeocachePuzzleState | None:
    return GeocachePuzzleState.query.filter_by(
        geocache_id=geocache_id,
        puzzle_type=puzzle_type,
        state_key=state_key,
    ).first()


@bp.get('/api/geocaches/<int:geocache_id>/puzzle-states')
def list_puzzle_states(geocache_id: int):
    geocache = _find_geocache(geocache_id)
    if not geocache:
        return jsonify({'error': 'Geocache not found'}), 404

    states = (
        GeocachePuzzleState.query
        .filter_by(geocache_id=geocache_id)
        .order_by(GeocachePuzzleState.updated_at.desc())
        .all()
    )
    return jsonify({
        'geocache_id': geocache.id,
        'states': [state.to_dict() for state in states],
    })


@bp.get('/api/geocaches/<int:geocache_id>/puzzle-states/current')
def get_puzzle_state(geocache_id: int):
    try:
        geocache = _find_geocache(geocache_id)
        if not geocache:
            return jsonify({'error': 'Geocache not found'}), 404

        puzzle_type = _request_puzzle_type()
        state_key = _request_state_key()
        state = _find_state(geocache_id, puzzle_type, state_key)

        return jsonify({
            'geocache_id': geocache.id,
            'puzzle_type': puzzle_type,
            'state_key': state_key,
            'state': state.to_dict() if state else None,
        })
    except ValueError as error:
        return jsonify({'error': str(error)}), 400


@bp.put('/api/geocaches/<int:geocache_id>/puzzle-states/current')
def upsert_puzzle_state(geocache_id: int):
    try:
        geocache = _find_geocache(geocache_id)
        if not geocache:
            return jsonify({'error': 'Geocache not found'}), 404

        data = request.get_json(silent=True) or {}
        puzzle_type = _normalize_key(data.get('puzzle_type'), 'sudoku_classic', 'puzzle_type', 80)
        state_key = _normalize_key(data.get('state_key'), 'default', 'state_key', 120)
        title = data.get('title')
        if title is not None:
            title = str(title).strip()[:255] or None

        state_payload = data.get('state')
        if not isinstance(state_payload, dict):
            return jsonify({'error': 'state must be an object'}), 400

        now = datetime.now(timezone.utc)
        state = _find_state(geocache_id, puzzle_type, state_key)
        created = state is None
        if state is None:
            state = GeocachePuzzleState(
                geocache_id=geocache.id,
                puzzle_type=puzzle_type,
                state_key=state_key,
                created_at=now,
            )
            db.session.add(state)

        state.title = title
        state.state_json = json.dumps(state_payload, ensure_ascii=False, sort_keys=True)
        state.updated_at = now
        db.session.commit()

        return jsonify({
            'geocache_id': geocache.id,
            'created': created,
            'state': state.to_dict(),
        }), 201 if created else 200
    except ValueError as error:
        db.session.rollback()
        return jsonify({'error': str(error)}), 400
    except Exception as error:  # pragma: no cover
        logger.error('Error saving puzzle state for geocache %s: %s', geocache_id, error)
        db.session.rollback()
        return jsonify({'error': str(error)}), 500


@bp.delete('/api/geocaches/<int:geocache_id>/puzzle-states/current')
def delete_puzzle_state(geocache_id: int):
    try:
        geocache = _find_geocache(geocache_id)
        if not geocache:
            return jsonify({'error': 'Geocache not found'}), 404

        puzzle_type = _request_puzzle_type()
        state_key = _request_state_key()
        state = _find_state(geocache_id, puzzle_type, state_key)
        if state is not None:
            db.session.delete(state)
            db.session.commit()

        return jsonify({
            'geocache_id': geocache.id,
            'deleted': state is not None,
        })
    except ValueError as error:
        db.session.rollback()
        return jsonify({'error': str(error)}), 400
    except Exception as error:  # pragma: no cover
        logger.error('Error deleting puzzle state for geocache %s: %s', geocache_id, error)
        db.session.rollback()
        return jsonify({'error': str(error)}), 500
