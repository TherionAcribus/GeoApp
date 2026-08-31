"""Endpoint agrege du contexte EarthCoach.

Ouvrir EarthCoach demandait quatre allers-retours HTTP (images, observations,
questions du proprietaire, notes) declenches en parallele depuis le frontend.
La latence resultante etait celle de la requete la plus lente, plus quatre fois
le cout fixe d'une connexion. Cette route rassemble les quatre lectures en une
seule reponse, avec exactement les memes serialisations que les routes
unitaires: le frontend peut donc retomber sur celles-ci si le backend est plus
ancien que le client.
"""
from __future__ import annotations

import logging

from flask import Blueprint, jsonify

from ..database import db
from ..geocaches.image_sync import ensure_images_v2_for_geocache
from ..geocaches.models import (
    Geocache,
    GeocacheImage,
    GeocacheLoggingTask,
    GeocacheNote,
    Note,
    UserObservation,
)

bp = Blueprint('earthcoach_context', __name__)
logger = logging.getLogger(__name__)


@bp.get('/api/geocaches/<int:geocache_id>/earthcoach-context')
def get_earthcoach_context(geocache_id: int):
    geocache = Geocache.query.get(geocache_id)
    if not geocache:
        return jsonify({'error': 'Geocache not found'}), 404

    # Meme synchronisation que GET /images: sans elle, une cache importee avant
    # la table GeocacheImage renverrait une galerie vide.
    ensure_images_v2_for_geocache(geocache)
    db.session.commit()

    images = (
        GeocacheImage.query
        .filter_by(geocache_id=geocache_id)
        .order_by(GeocacheImage.id.asc())
        .all()
    )
    observations = (
        UserObservation.query
        .filter_by(geocache_id=geocache_id)
        .order_by(UserObservation.observed_at.desc(), UserObservation.created_at.desc())
        .all()
    )
    logging_tasks = (
        GeocacheLoggingTask.query
        .filter_by(geocache_id=geocache_id)
        .order_by(GeocacheLoggingTask.position.asc(), GeocacheLoggingTask.id.asc())
        .all()
    )
    notes = (
        Note.query
        .join(GeocacheNote)
        .filter(GeocacheNote.geocache_id == geocache_id)
        .order_by(Note.created_at.desc())
        .all()
    )

    return jsonify({
        'geocache_id': geocache.id,
        'gc_code': geocache.gc_code,
        'name': geocache.name,
        'gc_personal_note': geocache.gc_personal_note,
        'images': [image.to_dict() for image in images],
        'observations': [observation.to_dict() for observation in observations],
        'logging_tasks': [task.to_dict() for task in logging_tasks],
        'notes': [note.to_dict() for note in notes],
    })
