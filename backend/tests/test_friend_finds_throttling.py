"""Tests du throttling 429 adaptatif (backoff exponentiel, Retry-After, interval adaptatif)."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from email.utils import format_datetime

import pytest

from gc_backend.services.geocaching_friend_finds import (
    GeocachingFriendFindsClient,
    RateLimitedError,
    ZoneBox,
)

BOX = ZoneBox(48.5, 4.5, 48.4, 4.6)


class _FakeResponse:
    """Fausse réponse requests.Response avec status_code et headers."""

    def __init__(self, status_code: int, json_data: dict | None = None, headers: dict | None = None):
        self.status_code = status_code
        self._json_data = json_data or {}
        self.headers = headers or {}

    def json(self):
        return self._json_data


class _FakeSession:
    """Session qui renvoie une séquence de réponses prédéfinies."""

    def __init__(self, responses: list[_FakeResponse]):
        self._responses = list(responses)
        self.calls = 0

    def get(self, url, params=None, headers=None, timeout=None):
        idx = min(self.calls, len(self._responses) - 1)
        self.calls += 1
        return self._responses[idx]


def _ok_response():
    return _FakeResponse(200, {'results': [], 'total': 0})


def _throttled_response(retry_after: str | None = None):
    headers = {'Retry-After': retry_after} if retry_after else {}
    return _FakeResponse(429, headers=headers)


def _client(responses: list[_FakeResponse], **kwargs):
    session = _FakeSession(responses)
    kwargs.setdefault('min_interval', 0)
    # Pas de retry_delays injecté : on teste le backoff exponentiel par défaut
    kwargs.setdefault('sleep', lambda _s: None)
    return GeocachingFriendFindsClient(session=session, **kwargs), session


# ----------------------------------------------------------- Backoff exponentiel

def test_backoff_retries_on_429_then_succeeds():
    """Un 429 puis un 200 : le client retente et réussit."""
    delays: list[float] = []
    client, session = _client(
        [_throttled_response(), _ok_response()],
        sleep=delays.append,
    )
    codes, _ = client.search_codes(BOX)
    assert codes == []
    assert len(delays) == 1
    # Le délai est ~10s (BACKOFF_BASE) + jitter [0, 5s]
    assert 10.0 <= delays[0] <= 15.0


def test_backoff_multiple_retries_then_succeeds():
    """Plusieurs 429 puis un 200 : le backoff augmente exponentiellement."""
    delays: list[float] = []
    client, session = _client(
        [_throttled_response(), _throttled_response(), _throttled_response(), _ok_response()],
        sleep=delays.append,
    )
    codes, _ = client.search_codes(BOX)
    assert codes == []
    assert len(delays) == 3
    # attempt 0: ~10 + jitter, attempt 1: ~20 + jitter, attempt 2: ~40 + jitter
    assert delays[0] >= 10.0
    assert delays[1] >= 20.0
    assert delays[2] >= 40.0
    # Plafond BACKOFF_MAX
    assert delays[2] <= 50.0  # 40 + 10 max jitter


def test_backoff_max_attempts_exhausted():
    """Après MAX_RETRY_ATTEMPTS 429, RateLimitedError est levée."""
    delays: list[float] = []
    responses = [_throttled_response() for _ in range(10)]
    client, session = _client(responses, sleep=delays.append)
    with pytest.raises(RateLimitedError):
        client.search_codes(BOX)
    # MAX_RETRY_ATTEMPTS = 5, donc 5 retries
    assert len(delays) == 5


def test_backoff_capped_at_max():
    """Le délai de backoff est plafonné à BACKOFF_MAX."""
    delays: list[float] = []
    # 10 réponses 429 pour atteindre les grandes tentatives
    responses = [_throttled_response() for _ in range(10)]
    client, session = _client(responses, sleep=delays.append)
    with pytest.raises(RateLimitedError):
        client.search_codes(BOX)
    # Aucun délai ne doit dépasser BACKOFF_MAX (300)
    for d in delays:
        assert d <= 300.0


# ----------------------------------------------------------- Retry-After header

def test_retry_after_seconds_used_when_present():
    """L'en-tête Retry-After en secondes est respecté."""
    delays: list[float] = []
    client, session = _client(
        [_throttled_response(retry_after='45'), _ok_response()],
        sleep=delays.append,
    )
    codes, _ = client.search_codes(BOX)
    assert codes == []
    assert len(delays) == 1
    assert delays[0] == 45.0


def test_retry_after_date_used_when_present():
    """L'en-tête Retry-After en date HTTP est respectée."""
    delays: list[float] = []
    future = datetime.now(timezone.utc) + timedelta(seconds=30)
    date_str = format_datetime(future, usegmt=True)
    client, session = _client(
        [_throttled_response(retry_after=date_str), _ok_response()],
        sleep=delays.append,
    )
    codes, _ = client.search_codes(BOX)
    assert codes == []
    assert len(delays) == 1
    # ~30s, avec une tolérance pour le temps d'exécution
    assert 20.0 <= delays[0] <= 35.0


def test_retry_after_overrides_backoff():
    """Retry-After est utilisé à la place du backoff exponentiel."""
    delays: list[float] = []
    client, session = _client(
        [_throttled_response(retry_after='5'), _ok_response()],
        sleep=delays.append,
    )
    client.search_codes(BOX)
    # 5s (Retry-After) et non ~10s (backoff)
    assert delays[0] == 5.0


def test_retry_after_capped_at_max():
    """Retry-After est plafonné à BACKOFF_MAX."""
    delays: list[float] = []
    client, session = _client(
        [_throttled_response(retry_after='999'), _ok_response()],
        sleep=delays.append,
    )
    client.search_codes(BOX)
    assert delays[0] == 300.0  # BACKOFF_MAX


def test_retry_after_absent_falls_back_to_backoff():
    """Sans Retry-After, le backoff exponentiel est utilisé."""
    delays: list[float] = []
    client, session = _client(
        [_throttled_response(retry_after=None), _ok_response()],
        sleep=delays.append,
    )
    client.search_codes(BOX)
    assert delays[0] >= 10.0  # backoff, pas 0


def test_retry_after_invalid_falls_back_to_backoff():
    """Un Retry-After illisible déclenche le backoff exponentiel."""
    delays: list[float] = []
    client, session = _client(
        [_throttled_response(retry_after='not-a-date'), _ok_response()],
        sleep=delays.append,
    )
    client.search_codes(BOX)
    assert delays[0] >= 10.0


# ----------------------------------------------------------- Interval adaptatif

def test_interval_increases_after_429():
    """Après un 429, l'interval de base est augmenté."""
    client, session = _client(
        [_throttled_response(), _ok_response()],
        min_interval=6.0,
    )
    client.search_codes(BOX)
    # L'interval a doublé
    assert client._min_interval == 12.0


def test_interval_capped_at_max():
    """L'interval adaptatif est plafonné à ADAPTIVE_INTERVAL_MAX."""
    client, session = _client(
        [_throttled_response(), _throttled_response(), _throttled_response(), _ok_response()],
        min_interval=30.0,
    )
    client.search_codes(BOX)
    # 30 → 60 (plafond) → 60 → 60
    assert client._min_interval == 60.0


def test_interval_decreases_after_successes():
    """Après des succès consécutifs, l'interval décroît vers sa valeur nominale."""
    client, session = _client(
        [_throttled_response(), _ok_response(), _ok_response(), _ok_response(), _ok_response()],
        min_interval=6.0,
    )
    # Premier appel : 429 puis 200 → interval = 12
    client.search_codes(BOX)
    assert client._min_interval == 12.0

    # 3 succès consécutifs pour déclencher la décroissance
    client.search_codes(BOX)  # succès 1
    client.search_codes(BOX)  # succès 2
    client.search_codes(BOX)  # succès 3 → décroissance
    # 12 * 0.9 = 10.8
    assert client._min_interval < 12.0
    assert client._min_interval >= 6.0  # pas en dessous du nominal


def test_interval_never_below_nominal():
    """L'interval ne descend jamais en dessous de sa valeur nominale."""
    client, session = _client(
        [_ok_response(), _ok_response(), _ok_response(), _ok_response()],
        min_interval=6.0,
    )
    for _ in range(10):
        client.search_codes(BOX)
    assert client._min_interval == 6.0


# ----------------------------------------------------------- Rétrocompatibilité

def test_legacy_retry_delays_still_work():
    """Les retry_delays injectés (tests existants) utilisent toujours les paliers fixes."""
    delays: list[float] = []
    session = _FakeSession([_throttled_response(), _ok_response()])
    client = GeocachingFriendFindsClient(
        session=session,
        min_interval=0,
        retry_delays=(1.0, 2.0),
        sleep=delays.append,
    )
    codes, _ = client.search_codes(BOX)
    assert codes == []
    assert delays == [1.0]  # palier fixe, pas backoff exponentiel


def test_legacy_empty_retry_delays_no_retry():
    """retry_delays=() : aucun retry, RateLimitedError immédiat."""
    session = _FakeSession([_throttled_response()])
    client = GeocachingFriendFindsClient(
        session=session,
        min_interval=0,
        retry_delays=(),
        sleep=lambda _s: None,
    )
    with pytest.raises(RateLimitedError):
        client.search_codes(BOX)
