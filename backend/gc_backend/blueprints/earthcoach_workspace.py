from __future__ import annotations

import logging
from datetime import datetime, timezone

from flask import Blueprint, jsonify, request

from ..database import db
from ..geocaches.image_sync import ensure_images_v2_for_geocache
from ..geocaches.models import (
    EarthCoachImageContext,
    EarthCoachImageGroup,
    EarthCoachImageGroupMember,
    EarthCoachResult,
    EarthCoachWorkspace,
    Geocache,
    GeocacheImage,
    GeocacheLoggingTask,
    GeocacheWaypoint,
    UserObservation,
    UserObservationImage,
)

bp = Blueprint('earthcoach_workspace', __name__)
logger = logging.getLogger(__name__)

_GROUP_ROLES = {'overview', 'detail', 'masked', 'original', 'before', 'after', 'other'}
_ACTIONS = {'analyze', 'resolve'}
_PROPOSAL_STATES = {'ready', 'partial', 'missing'}


def _optional_text(value: object) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _required_int(value: object, field_name: str) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        raise ValueError(f'{field_name} must be an integer') from None


def _optional_int(value: object, field_name: str) -> int | None:
    if value is None or value == '':
        return None
    return _required_int(value, field_name)


def _load_geocache(geocache_id: int) -> Geocache | None:
    return Geocache.query.get(geocache_id)


def _is_personal_image(image: GeocacheImage) -> bool:
    return (image.source_url or '').startswith('geoapp-upload://')


def _default_contexts(geocache_id: int, images: list[GeocacheImage]) -> list[dict]:
    observation_ids = {
        observation.id
        for observation in UserObservation.query.filter_by(geocache_id=geocache_id).all()
    }
    linked_rows = (
        UserObservationImage.query
        .filter(UserObservationImage.observation_id.in_(observation_ids))
        .all()
        if observation_ids else []
    )
    linked_by_image: dict[int, int] = {}
    for link in linked_rows:
        if link.image_id not in linked_by_image:
            linked_by_image[link.image_id] = link.observation_id

    return [
        {
            'id': None,
            'image_id': image.id,
            'included': bool(_is_personal_image(image) and image.id in linked_by_image),
            'comment': None,
            'waypoint_id': None,
            'observation_id': linked_by_image.get(image.id),
            'position': index,
        }
        for index, image in enumerate(images)
    ]


def serialize_workspace(geocache: Geocache) -> dict:
    images = (
        GeocacheImage.query
        .filter_by(geocache_id=geocache.id)
        .order_by(GeocacheImage.id.asc())
        .all()
    )
    workspace = EarthCoachWorkspace.query.get(geocache.id)
    if workspace is None:
        return {
            'geocache_id': geocache.id,
            'version': 0,
            'exists': False,
            'general_comment': None,
            'selected_language': None,
            'description_fingerprint': None,
            'image_contexts': _default_contexts(geocache.id, images),
            'groups': [],
            'created_at': None,
            'updated_at': None,
        }

    contexts = (
        EarthCoachImageContext.query
        .filter_by(geocache_id=geocache.id)
        .order_by(EarthCoachImageContext.position.asc(), EarthCoachImageContext.id.asc())
        .all()
    )
    existing_image_ids = {context.image_id for context in contexts}
    serialized_contexts = [
        {
            'id': context.id,
            'image_id': context.image_id,
            'included': bool(context.included),
            'comment': context.comment,
            'waypoint_id': context.waypoint_id,
            'observation_id': context.observation_id,
            'position': context.position,
        }
        for context in contexts
    ]
    next_position = max((item['position'] for item in serialized_contexts), default=-1) + 1
    for image in images:
        if image.id not in existing_image_ids:
            serialized_contexts.append({
                'id': None,
                'image_id': image.id,
                'included': False,
                'comment': None,
                'waypoint_id': None,
                'observation_id': None,
                'position': next_position,
            })
            next_position += 1

    groups = (
        EarthCoachImageGroup.query
        .filter_by(geocache_id=geocache.id)
        .order_by(EarthCoachImageGroup.position.asc(), EarthCoachImageGroup.id.asc())
        .all()
    )
    return {
        'geocache_id': geocache.id,
        'version': workspace.version,
        'exists': True,
        'general_comment': workspace.general_comment,
        'selected_language': workspace.selected_language,
        'description_fingerprint': workspace.description_fingerprint,
        'image_contexts': serialized_contexts,
        'groups': [
            {
                'id': group.id,
                'title': group.title,
                'instruction': group.instruction,
                'waypoint_id': group.waypoint_id,
                'position': group.position,
                'members': [
                    {
                        'image_id': member.image_id,
                        'role': member.role,
                        'position': member.position,
                    }
                    for member in group.members
                ],
            }
            for group in groups
        ],
        'created_at': workspace.created_at.isoformat() if workspace.created_at else None,
        'updated_at': workspace.updated_at.isoformat() if workspace.updated_at else None,
    }


def _validated_related_ids(geocache_id: int, rows: list[dict], groups: list[dict]):
    image_ids = {
        _required_int(item.get('image_id'), 'image_id')
        for item in rows
        if isinstance(item, dict)
    }
    for group in groups:
        for member in group.get('members') or []:
            if not isinstance(member, dict):
                raise ValueError('group members must be objects')
            image_ids.add(_required_int(member.get('image_id'), 'image_id'))

    images = GeocacheImage.query.filter(GeocacheImage.id.in_(image_ids)).all() if image_ids else []
    if {image.id for image in images} != image_ids or any(image.geocache_id != geocache_id for image in images):
        raise ValueError('all images must belong to this geocache')

    waypoint_ids = set()
    observation_ids = set()
    for item in rows:
        waypoint_id = _optional_int(item.get('waypoint_id'), 'waypoint_id')
        observation_id = _optional_int(item.get('observation_id'), 'observation_id')
        if waypoint_id is not None:
            waypoint_ids.add(waypoint_id)
        if observation_id is not None:
            observation_ids.add(observation_id)
    for group in groups:
        waypoint_id = _optional_int(group.get('waypoint_id'), 'waypoint_id')
        if waypoint_id is not None:
            waypoint_ids.add(waypoint_id)

    waypoints = GeocacheWaypoint.query.filter(GeocacheWaypoint.id.in_(waypoint_ids)).all() if waypoint_ids else []
    if {item.id for item in waypoints} != waypoint_ids or any(item.geocache_id != geocache_id for item in waypoints):
        raise ValueError('all waypoints must belong to this geocache')

    observations = UserObservation.query.filter(UserObservation.id.in_(observation_ids)).all() if observation_ids else []
    if {item.id for item in observations} != observation_ids or any(item.geocache_id != geocache_id for item in observations):
        raise ValueError('all observations must belong to this geocache')


@bp.get('/api/geocaches/<int:geocache_id>/earthcoach-workspace')
def get_workspace(geocache_id: int):
    geocache = _load_geocache(geocache_id)
    if not geocache:
        return jsonify({'error': 'Geocache not found'}), 404
    ensure_images_v2_for_geocache(geocache)
    db.session.commit()
    return jsonify({'workspace': serialize_workspace(geocache)})


@bp.put('/api/geocaches/<int:geocache_id>/earthcoach-workspace')
def put_workspace(geocache_id: int):
    try:
        geocache = _load_geocache(geocache_id)
        if not geocache:
            return jsonify({'error': 'Geocache not found'}), 404
        data = request.get_json(silent=True) or {}
        expected_version = _required_int(data.get('version'), 'version')
        image_contexts = data.get('image_contexts') or []
        groups = data.get('groups') or []
        if not isinstance(image_contexts, list) or not all(isinstance(item, dict) for item in image_contexts):
            raise ValueError('image_contexts must be a list of objects')
        if not isinstance(groups, list) or not all(isinstance(item, dict) for item in groups):
            raise ValueError('groups must be a list of objects')
        _validated_related_ids(geocache_id, image_contexts, groups)

        workspace = EarthCoachWorkspace.query.get(geocache_id)
        current_version = workspace.version if workspace else 0
        if expected_version != current_version:
            return jsonify({
                'error': 'EarthCoach workspace has changed',
                'workspace': serialize_workspace(geocache),
            }), 409

        if workspace is None:
            workspace = EarthCoachWorkspace(geocache_id=geocache_id, version=1)
            db.session.add(workspace)
        else:
            workspace.version += 1
        workspace.general_comment = _optional_text(data.get('general_comment'))
        workspace.selected_language = _optional_text(data.get('selected_language'))
        workspace.description_fingerprint = _optional_text(data.get('description_fingerprint'))
        workspace.updated_at = datetime.now(timezone.utc)

        existing_contexts = {
            context.image_id: context
            for context in EarthCoachImageContext.query.filter_by(geocache_id=geocache_id).all()
        }
        submitted_ids = set()
        for index, item in enumerate(image_contexts):
            image_id = _required_int(item.get('image_id'), 'image_id')
            if image_id in submitted_ids:
                raise ValueError('each image may appear only once in image_contexts')
            submitted_ids.add(image_id)
            context = existing_contexts.get(image_id)
            if context is None:
                context = EarthCoachImageContext(geocache_id=geocache_id, image_id=image_id)
                db.session.add(context)
            context.included = bool(item.get('included'))
            context.comment = _optional_text(item.get('comment'))
            context.waypoint_id = _optional_int(item.get('waypoint_id'), 'waypoint_id')
            context.observation_id = _optional_int(item.get('observation_id'), 'observation_id')
            position = _optional_int(item.get('position'), 'position')
            context.position = position if position is not None else index

        for image_id, context in existing_contexts.items():
            if image_id not in submitted_ids:
                db.session.delete(context)

        previous_group_ids = [
            group_id
            for (group_id,) in db.session.query(EarthCoachImageGroup.id).filter_by(geocache_id=geocache_id).all()
        ]
        if previous_group_ids:
            EarthCoachImageGroupMember.query.filter(
                EarthCoachImageGroupMember.group_id.in_(previous_group_ids)
            ).delete(synchronize_session=False)
        EarthCoachImageGroup.query.filter_by(geocache_id=geocache_id).delete(synchronize_session=False)
        db.session.flush()
        for group_index, item in enumerate(groups):
            title = str(item.get('title') or '').strip()
            if not title:
                raise ValueError('group title is required')
            group = EarthCoachImageGroup(
                geocache_id=geocache_id,
                title=title,
                instruction=_optional_text(item.get('instruction')),
                waypoint_id=_optional_int(item.get('waypoint_id'), 'waypoint_id'),
                position=(
                    _optional_int(item.get('position'), 'position')
                    if item.get('position') not in (None, '')
                    else group_index
                ),
            )
            db.session.add(group)
            db.session.flush()
            seen_members = set()
            for member_index, member in enumerate(item.get('members') or []):
                image_id = _required_int(member.get('image_id'), 'image_id')
                if image_id in seen_members:
                    raise ValueError('an image may appear only once in a group')
                seen_members.add(image_id)
                role = str(member.get('role') or 'other').strip().lower()
                if role not in _GROUP_ROLES:
                    raise ValueError(f'role must be one of: {", ".join(sorted(_GROUP_ROLES))}')
                db.session.add(EarthCoachImageGroupMember(
                    group_id=group.id,
                    image_id=image_id,
                    role=role,
                    position=(
                        _optional_int(member.get('position'), 'position')
                        if member.get('position') not in (None, '')
                        else member_index
                    ),
                ))

        db.session.commit()
        return jsonify({'workspace': serialize_workspace(geocache)})
    except ValueError as error:
        db.session.rollback()
        return jsonify({'error': str(error)}), 400
    except Exception as error:  # pragma: no cover
        logger.error('Error saving EarthCoach workspace %s: %s', geocache_id, error)
        db.session.rollback()
        raise


@bp.get('/api/geocaches/<int:geocache_id>/earthcoach-results')
def list_results(geocache_id: int):
    if not _load_geocache(geocache_id):
        return jsonify({'error': 'Geocache not found'}), 404
    results = (
        EarthCoachResult.query
        .filter_by(geocache_id=geocache_id)
        .order_by(EarthCoachResult.created_at.desc(), EarthCoachResult.id.desc())
        .all()
    )
    return jsonify({'results': [result.to_dict() for result in results]})


@bp.post('/api/geocaches/<int:geocache_id>/earthcoach-results')
def capture_result(geocache_id: int):
    try:
        if not _load_geocache(geocache_id):
            return jsonify({'error': 'Geocache not found'}), 404
        data = request.get_json(silent=True) or {}
        request_id = str(data.get('request_id') or '').strip()
        action = str(data.get('action') or '').strip().lower()
        if not request_id:
            return jsonify({'error': 'request_id is required'}), 400
        if action not in _ACTIONS:
            return jsonify({'error': 'action must be analyze or resolve'}), 400
        proposals = data.get('proposals') or []
        context_snapshot = data.get('context_snapshot') or {}
        if not isinstance(proposals, list) or not isinstance(context_snapshot, dict):
            return jsonify({'error': 'proposals must be a list and context_snapshot an object'}), 400

        result = EarthCoachResult.query.filter_by(request_id=request_id).first()
        if result is None:
            result = EarthCoachResult(
                geocache_id=geocache_id,
                request_id=request_id,
                action=action,
                session_id=_optional_text(data.get('session_id')),
                context_snapshot=context_snapshot,
                proposals=proposals,
                markdown=_optional_text(data.get('markdown')),
            )
            db.session.add(result)
        else:
            if result.geocache_id != geocache_id or result.action != action:
                return jsonify({'error': 'request_id already belongs to another EarthCoach request'}), 409
            if proposals:
                result.proposals = proposals
            if data.get('markdown') is not None:
                result.markdown = _optional_text(data.get('markdown'))
            if data.get('session_id') is not None:
                result.session_id = _optional_text(data.get('session_id'))
        db.session.commit()
        return jsonify({'result': result.to_dict()}), 201
    except Exception as error:  # pragma: no cover
        logger.error('Error capturing EarthCoach result for %s: %s', geocache_id, error)
        db.session.rollback()
        raise


@bp.patch('/api/earthcoach-results/<int:result_id>')
def update_result(result_id: int):
    result = EarthCoachResult.query.get(result_id)
    if not result:
        return jsonify({'error': 'EarthCoach result not found'}), 404
    data = request.get_json(silent=True) or {}
    proposals = data.get('proposals')
    if proposals is not None:
        if not isinstance(proposals, list):
            return jsonify({'error': 'proposals must be a list'}), 400
        result.proposals = proposals
    if 'markdown' in data:
        result.markdown = _optional_text(data.get('markdown'))
    db.session.commit()
    return jsonify({'result': result.to_dict()})


@bp.post('/api/earthcoach-results/<int:result_id>/apply')
def apply_result(result_id: int):
    try:
        result = EarthCoachResult.query.get(result_id)
        if not result:
            return jsonify({'error': 'EarthCoach result not found'}), 404
        if result.action != 'resolve':
            return jsonify({'error': 'Only resolve results can be applied'}), 400
        data = request.get_json(silent=True) or {}
        selected = data.get('proposal_indexes')
        if selected is None:
            selected = list(range(len(result.proposals or [])))
        if not isinstance(selected, list):
            return jsonify({'error': 'proposal_indexes must be a list'}), 400

        applied = []
        for raw_index in selected:
            index = _required_int(raw_index, 'proposal index')
            proposals = result.proposals or []
            if index < 0 or index >= len(proposals):
                raise ValueError('proposal index is out of range')
            proposal = proposals[index]
            state = str(proposal.get('status') or '').strip().lower()
            answer = str(proposal.get('answer') or '').strip()
            missing = proposal.get('missing')
            if state not in _PROPOSAL_STATES:
                raise ValueError('proposal status must be ready, partial or missing')
            if state != 'ready' or not answer or (isinstance(missing, str) and missing.strip()):
                raise ValueError('only complete ready proposals can be applied')
            task_id = _required_int(proposal.get('task_id'), 'task_id')
            task = GeocacheLoggingTask.query.filter_by(id=task_id, geocache_id=result.geocache_id).first()
            if not task:
                raise ValueError('task_id does not belong to this geocache')
            task.answer = answer
            task.status = 'answered'
            applied.append(task.to_dict())

        db.session.commit()
        return jsonify({'applied': applied})
    except ValueError as error:
        db.session.rollback()
        return jsonify({'error': str(error)}), 400
    except Exception as error:  # pragma: no cover
        logger.error('Error applying EarthCoach result %s: %s', result_id, error)
        db.session.rollback()
        raise
