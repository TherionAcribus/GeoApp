from __future__ import annotations

import logging
import unicodedata

from flask import Blueprint, jsonify, request

from ..database import db
from ..geocaches.models import Geocache, GeocacheLoggingTask, UserObservation

bp = Blueprint('logging_tasks', __name__)
logger = logging.getLogger(__name__)

_STATUSES = {
    'todo': 'todo',
    'a faire': 'todo',
    'field': 'field',
    'terrain': 'field',
    'answered': 'answered',
    'repondu': 'answered',
    'done': 'answered',
}


def _normalize_ascii(value: str) -> str:
    return (
        unicodedata.normalize('NFKD', value)
        .encode('ascii', 'ignore')
        .decode('ascii')
        .strip()
        .lower()
    )


def _normalize_status(value: object) -> str | None:
    raw = str(value or 'todo').strip()
    if not raw:
        raw = 'todo'
    return _STATUSES.get(_normalize_ascii(raw))


def _optional_int(value: object, field_name: str) -> int | None:
    if value is None or value == '':
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        raise ValueError(f'{field_name} must be an integer') from None


def _optional_text(value: object) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _coerce_bool(value: object, default: bool = False) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    return _normalize_ascii(str(value)) in {'1', 'true', 'yes', 'oui', 'on'}


def _load_observation(geocache_id: int, observation_id: object) -> UserObservation | None:
    if observation_id is None or observation_id == '':
        return None
    try:
        parsed_id = int(observation_id)
    except (TypeError, ValueError):
        raise ValueError('observation_id must be an integer') from None
    observation = UserObservation.query.filter_by(id=parsed_id, geocache_id=geocache_id).first()
    if not observation:
        raise ValueError('observation_id does not belong to this geocache')
    return observation


def _next_position(geocache_id: int) -> int:
    highest = (
        db.session.query(db.func.max(GeocacheLoggingTask.position))
        .filter(GeocacheLoggingTask.geocache_id == geocache_id)
        .scalar()
    )
    return (highest or 0) + 1


def _serialize_list(geocache: Geocache, tasks: list[GeocacheLoggingTask]):
    return jsonify({
        'geocache_id': geocache.id,
        'gc_code': geocache.gc_code,
        'name': geocache.name,
        'logging_tasks': [task.to_dict() for task in tasks],
    })


@bp.get('/api/geocaches/<int:geocache_id>/logging-tasks')
def list_logging_tasks(geocache_id: int):
    geocache = Geocache.query.get(geocache_id)
    if not geocache:
        return jsonify({'error': 'Geocache not found'}), 404

    tasks = (
        GeocacheLoggingTask.query
        .filter_by(geocache_id=geocache_id)
        .order_by(GeocacheLoggingTask.position.asc(), GeocacheLoggingTask.id.asc())
        .all()
    )
    return _serialize_list(geocache, tasks)


@bp.post('/api/geocaches/<int:geocache_id>/logging-tasks')
def create_logging_task(geocache_id: int):
    try:
        geocache = Geocache.query.get(geocache_id)
        if not geocache:
            return jsonify({'error': 'Geocache not found'}), 404

        data = request.get_json(silent=True) or {}
        question = str(data.get('question') or '').strip()
        if not question:
            return jsonify({'error': 'question is required'}), 400

        status = _normalize_status(data.get('status'))
        if status is None:
            return jsonify({'error': 'status must be one of: todo, field, answered'}), 400

        observation = _load_observation(geocache_id, data.get('observation_id'))
        position = _optional_int(data.get('position'), 'position')

        task = GeocacheLoggingTask(
            geocache_id=geocache.id,
            position=position if position is not None else _next_position(geocache.id),
            question=question,
            guidance=_optional_text(data.get('guidance')),
            answer=_optional_text(data.get('answer')),
            status=status,
            requires_photo=_coerce_bool(data.get('requires_photo')),
            observation_id=observation.id if observation else None,
            source=(_optional_text(data.get('source')) or 'manual'),
        )
        db.session.add(task)
        db.session.commit()

        return jsonify({'logging_task': task.to_dict(), 'geocache_id': geocache.id}), 201
    except ValueError as error:
        db.session.rollback()
        return jsonify({'error': str(error)}), 400
    except Exception as error:  # pragma: no cover
        logger.error('Error creating logging task for geocache %s: %s', geocache_id, error)
        db.session.rollback()
        return jsonify({'error': str(error)}), 500


@bp.put('/api/geocaches/<int:geocache_id>/logging-tasks')
def replace_logging_tasks(geocache_id: int):
    """Remplace l'ensemble des logging tasks d'une cache.

    Utilise par l'extraction IA (earthcoach_extract_logging_tasks): supprime les
    taches existantes puis insere celles fournies. A n'appeler que sur demande
    explicite, car cette operation ecrase les reponses deja saisies.
    """
    try:
        geocache = Geocache.query.get(geocache_id)
        if not geocache:
            return jsonify({'error': 'Geocache not found'}), 404

        data = request.get_json(silent=True) or {}
        raw_tasks = data.get('tasks')
        if not isinstance(raw_tasks, list):
            return jsonify({'error': 'tasks must be a list'}), 400

        default_source = _optional_text(data.get('source')) or 'extracted'
        new_tasks: list[GeocacheLoggingTask] = []
        for index, item in enumerate(raw_tasks):
            if not isinstance(item, dict):
                return jsonify({'error': 'each task must be an object'}), 400
            question = str(item.get('question') or '').strip()
            if not question:
                continue
            status = _normalize_status(item.get('status'))
            if status is None:
                return jsonify({'error': 'status must be one of: todo, field, answered'}), 400
            observation = _load_observation(geocache_id, item.get('observation_id'))
            position = _optional_int(item.get('position'), 'position')
            new_tasks.append(GeocacheLoggingTask(
                geocache_id=geocache.id,
                position=position if position is not None else index + 1,
                question=question,
                guidance=_optional_text(item.get('guidance')),
                answer=_optional_text(item.get('answer')),
                status=status,
                requires_photo=_coerce_bool(item.get('requires_photo')),
                observation_id=observation.id if observation else None,
                source=(_optional_text(item.get('source')) or default_source),
            ))

        GeocacheLoggingTask.query.filter_by(geocache_id=geocache_id).delete()
        db.session.add_all(new_tasks)
        db.session.commit()

        tasks = (
            GeocacheLoggingTask.query
            .filter_by(geocache_id=geocache_id)
            .order_by(GeocacheLoggingTask.position.asc(), GeocacheLoggingTask.id.asc())
            .all()
        )
        return _serialize_list(geocache, tasks)
    except ValueError as error:
        db.session.rollback()
        return jsonify({'error': str(error)}), 400
    except Exception as error:  # pragma: no cover
        logger.error('Error replacing logging tasks for geocache %s: %s', geocache_id, error)
        db.session.rollback()
        return jsonify({'error': str(error)}), 500


@bp.put('/api/logging-tasks/<int:task_id>')
def update_logging_task(task_id: int):
    try:
        task = GeocacheLoggingTask.query.get(task_id)
        if not task:
            return jsonify({'error': 'Logging task not found'}), 404

        data = request.get_json(silent=True) or {}

        if 'question' in data:
            question = str(data.get('question') or '').strip()
            if not question:
                return jsonify({'error': 'question cannot be empty'}), 400
            task.question = question

        if 'guidance' in data:
            task.guidance = _optional_text(data.get('guidance'))

        if 'answer' in data:
            task.answer = _optional_text(data.get('answer'))

        if 'status' in data:
            status = _normalize_status(data.get('status'))
            if status is None:
                return jsonify({'error': 'status must be one of: todo, field, answered'}), 400
            task.status = status

        if 'requires_photo' in data:
            task.requires_photo = _coerce_bool(data.get('requires_photo'))

        if 'position' in data:
            position = _optional_int(data.get('position'), 'position')
            if position is not None:
                task.position = position

        if 'observation_id' in data:
            observation = _load_observation(task.geocache_id, data.get('observation_id'))
            task.observation_id = observation.id if observation else None

        if 'source' in data:
            task.source = _optional_text(data.get('source')) or 'manual'

        db.session.commit()
        return jsonify({'logging_task': task.to_dict()})
    except ValueError as error:
        db.session.rollback()
        return jsonify({'error': str(error)}), 400
    except Exception as error:  # pragma: no cover
        logger.error('Error updating logging task %s: %s', task_id, error)
        db.session.rollback()
        return jsonify({'error': str(error)}), 500


@bp.delete('/api/logging-tasks/<int:task_id>')
def delete_logging_task(task_id: int):
    try:
        task = GeocacheLoggingTask.query.get(task_id)
        if not task:
            return jsonify({'error': 'Logging task not found'}), 404
        db.session.delete(task)
        db.session.commit()
        return jsonify({'deleted': True})
    except Exception as error:  # pragma: no cover
        logger.error('Error deleting logging task %s: %s', task_id, error)
        db.session.rollback()
        return jsonify({'error': str(error)}), 500
