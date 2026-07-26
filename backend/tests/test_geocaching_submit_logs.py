"""Tests de la soumission de logs vers Geocaching.com (endpoint tRPC depuis juin 2026)."""

import json
from datetime import date

import pytest

from gc_backend.services.geocaching_submit_logs import (
    LEGACY_CREATE_GEOCACHE_LOG_URL,
    TRPC_CREATE_GEOCACHE_LOG_URL,
    GeocachingSubmitLogsClient,
)


class FakeResponse:
    def __init__(self, status_code, payload):
        self.status_code = status_code
        self._payload = payload
        self.text = json.dumps(payload) if payload is not None else ''
        self.content = self.text.encode('utf-8')

    def json(self):
        if self._payload is None:
            raise ValueError('no json')
        return self._payload


class FakeSession:
    """Session requests minimale : sert le CSRF puis les réponses programmées."""

    def __init__(self, responses):
        self.headers = {}
        self._responses = list(responses)
        self.calls = []

    def get(self, url, **kwargs):
        assert url.endswith('/api/auth/csrf')
        return FakeResponse(200, {'csrfToken': 'token-42'})

    def post(self, url, **kwargs):
        self.calls.append({'url': url, 'params': kwargs.get('params'), 'json': kwargs.get('json'),
                           'headers': kwargs.get('headers')})
        return self._responses.pop(0)


def make_client(responses):
    session = FakeSession(responses)
    return GeocachingSubmitLogsClient(session=session), session


def submit(client, **overrides):
    kwargs = {
        'log_type_id': 2,
        'log_text': 'Merci pour la cache !',
        'visited_date': date(2026, 7, 26),
        'images': ['guid-1'],
        'used_favorite_point': True,
    }
    kwargs.update(overrides)
    return client.submit_geocache_log('gcb7c3y', **kwargs)


def test_submit_uses_trpc_batch_endpoint_and_returns_log_reference_code():
    client, session = make_client([
        FakeResponse(200, [{'result': {'data': {'logReferenceCode': 'GL123ABC', 'logType': 2}}}]),
    ])

    result = submit(client)

    assert result['logReferenceCode'] == 'GL123ABC'
    assert result['ok'] is True

    call = session.calls[0]
    assert call['url'] == TRPC_CREATE_GEOCACHE_LOG_URL
    assert call['params'] == {'batch': '1'}
    assert call['headers']['CSRF-Token'] == 'token-42'

    entry = call['json']['0']
    assert entry['referenceCode'] == 'GCB7C3Y'
    assert entry['body'] == {
        'images': ['guid-1'],
        'logDate': '2026-07-26T12:00:00',
        'logText': 'Merci pour la cache !',
        'logType': 2,
        'trackables': [],
        'geocacheReferenceCode': '',
        'usedFavoritePoint': True,
    }


def test_submit_omits_favorite_point_when_not_specified():
    client, session = make_client([
        FakeResponse(200, [{'result': {'data': {'logReferenceCode': 'GL999'}}}]),
    ])

    submit(client, log_type_id=4, used_favorite_point=None)

    assert 'usedFavoritePoint' not in session.calls[0]['json']['0']['body']


def test_submit_surfaces_trpc_error_message():
    client, _ = make_client([
        FakeResponse(400, [{'error': {'json': {'message': 'You have already logged this cache'}}}]),
    ])

    result = submit(client)

    assert result['ok'] is False
    assert result['status'] == 400
    assert 'already logged' in result['error_message']
    assert 'logReferenceCode' not in result


def test_submit_falls_back_to_legacy_endpoint_when_trpc_missing():
    client, session = make_client([
        FakeResponse(404, {'statusCode': 404}),
        FakeResponse(200, {'logReferenceCode': 'GL456DEF'}),
    ])

    result = submit(client)

    assert result['logReferenceCode'] == 'GL456DEF'
    assert session.calls[1]['url'] == LEGACY_CREATE_GEOCACHE_LOG_URL.format(gc_code='GCB7C3Y')
    # L'ancien endpoint n'attend pas geocacheReferenceCode
    assert 'geocacheReferenceCode' not in session.calls[1]['json']


def test_submit_does_not_fall_back_on_business_error():
    client, session = make_client([
        FakeResponse(403, [{'error': {'message': 'Not allowed'}}]),
    ])

    result = submit(client)

    assert result['ok'] is False
    assert len(session.calls) == 1


@pytest.mark.parametrize('payload,expected', [
    ([{'result': {'data': {'logReferenceCode': 'GL1'}}}], 'GL1'),
    ({'result': {'data': {'logReferenceCode': 'GL2'}}}, 'GL2'),
    ([{'result': {'data': {'json': {'logReferenceCode': 'GL3'}}}}], 'GL3'),
])
def test_unwrap_trpc_payload_accepts_known_shapes(payload, expected):
    assert GeocachingSubmitLogsClient.unwrap_trpc_payload(payload)['logReferenceCode'] == expected


@pytest.mark.parametrize('payload', [
    None,
    [],
    [{'error': {'json': {'message': 'boom'}}}],
    {'logReferenceCode': 'GL0'},  # ancienne forme non enveloppée
])
def test_unwrap_trpc_payload_rejects_other_shapes(payload):
    assert GeocachingSubmitLogsClient.unwrap_trpc_payload(payload) is None
