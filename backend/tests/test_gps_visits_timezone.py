"""Préférence de fuseau des visites GPS : vide = OS, nom IANA sinon, nom invalide = OS."""
from __future__ import annotations

from datetime import datetime, timezone

import pytest

from gc_backend import create_app
from gc_backend.database import db
from gc_backend.services import gps_visit_store
from gc_backend.services.garmin_visits import local_day
from gc_backend.utils.preferences import set_preference_value


@pytest.fixture
def app():
    app = create_app()
    app.config['TESTING'] = True
    with app.app_context():
        db.create_all()
        yield app
        db.session.remove()
        db.drop_all()


def test_empty_preference_means_the_os_timezone(app):
    assert gps_visit_store.get_local_tz() is None


def test_iana_name_is_used(app):
    set_preference_value(gps_visit_store.TIMEZONE_PREF, 'America/Montreal')
    tz = gps_visit_store.get_local_tz()
    assert tz is not None
    # 02h30 UTC le 15/07 = 22h30 la veille à Montréal.
    assert local_day(datetime(2026, 7, 15, 2, 30, tzinfo=timezone.utc), tz).isoformat() == '2026-07-14'


def test_invalid_name_falls_back_to_the_os(app):
    set_preference_value(gps_visit_store.TIMEZONE_PREF, 'Pas/UnFuseau')
    assert gps_visit_store.get_local_tz() is None
