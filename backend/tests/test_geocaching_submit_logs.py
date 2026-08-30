"""Tests de la soumission de logs vers Geocaching.com (endpoint tRPC depuis juin 2026)."""

import json
from datetime import date

import pytest

from gc_backend.services import geocaching_submit_logs
from gc_backend.services.geocaching_submit_logs import (
    LEGACY_CREATE_GEOCACHE_LOG_URL,
    LOG_DRAFT_IMAGES_URL,
    LOG_IMAGE_FORM_FIELD,
    TRPC_CREATE_GEOCACHE_LOG_URL,
    GeocachingSubmitLogsClient,
)


class FakeResponse:
    def __init__(self, status_code, payload, text=None):
        self.status_code = status_code
        self._payload = payload
        # `text` explicite : sert à simuler un corps non-JSON (page d'erreur HTML).
        self.text = text if text is not None else (json.dumps(payload) if payload is not None else '')
        self.content = self.text.encode('utf-8')

    def json(self):
        if self._payload is None:
            raise ValueError('no json')
        return self._payload


class FakeSession:
    """Session requests minimale : sert le CSRF puis les réponses programmées."""

    def __init__(self, responses, tokens=None):
        self.headers = {}
        self._responses = list(responses)
        # Jetons CSRF servis successivement ; le dernier vaut pour tous les appels suivants.
        self._tokens = list(tokens) if tokens else ['token-42']
        self.calls = []
        self.csrf_calls = 0

    def get(self, url, **kwargs):
        assert url.endswith('/api/auth/csrf')
        self.csrf_calls += 1
        token = self._tokens[min(self.csrf_calls - 1, len(self._tokens) - 1)]
        return FakeResponse(200, {'csrfToken': token})

    def post(self, url, **kwargs):
        self.calls.append({'url': url, 'params': kwargs.get('params'), 'json': kwargs.get('json'),
                           'headers': kwargs.get('headers'), 'files': kwargs.get('files')})
        return self._responses.pop(0)


def make_client(responses, tokens=None):
    session = FakeSession(responses, tokens=tokens)
    return GeocachingSubmitLogsClient(session=session), session


def upload(client):
    return client.upload_log_draft_image(filename='photo.jpg', content=b'binaire', content_type='image/jpeg')


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


# ---------------------------------------------------------------------------
# Jeton CSRF : mémorisé par session, renouvelé sur rejet
# ---------------------------------------------------------------------------


def test_csrf_token_is_fetched_once_for_several_submits():
    client, session = make_client([
        FakeResponse(200, [{'result': {'data': {'logReferenceCode': 'GL1'}}}]),
        FakeResponse(200, [{'result': {'data': {'logReferenceCode': 'GL2'}}}]),
    ])

    submit(client)
    submit(client)

    assert session.csrf_calls == 1
    assert [call['headers']['CSRF-Token'] for call in session.calls] == ['token-42', 'token-42']


def test_csrf_token_is_shared_between_image_upload_and_submit():
    client, session = make_client([
        FakeResponse(200, {'imageGuid': 'guid-1'}),
        FakeResponse(200, [{'result': {'data': {'logReferenceCode': 'GL1'}}}]),
    ])

    upload(client)
    submit(client)

    assert session.csrf_calls == 1


def test_csrf_token_is_refetched_once_expired(monkeypatch):
    monkeypatch.setattr(geocaching_submit_logs, 'CSRF_TOKEN_TTL_SECONDS', 0)
    client, session = make_client([
        FakeResponse(200, [{'result': {'data': {'logReferenceCode': 'GL1'}}}]),
        FakeResponse(200, [{'result': {'data': {'logReferenceCode': 'GL2'}}}]),
    ])

    submit(client)
    submit(client)

    assert session.csrf_calls == 2


def test_invalidate_csrf_token_forces_a_new_fetch():
    client, session = make_client([])

    assert client.get_csrf_token() == 'token-42'
    assert client.get_csrf_token() == 'token-42'
    assert session.csrf_calls == 1

    client.invalidate_csrf_token()

    assert client.get_csrf_token() == 'token-42'
    assert session.csrf_calls == 2


def test_submit_retries_once_with_a_fresh_token_when_rejected():
    client, session = make_client(
        [
            FakeResponse(403, {'statusCode': 403}),
            FakeResponse(200, [{'result': {'data': {'logReferenceCode': 'GL456'}}}]),
        ],
        tokens=['stale-token', 'fresh-token'],
    )

    result = submit(client)

    assert result['logReferenceCode'] == 'GL456'
    assert [call['headers']['CSRF-Token'] for call in session.calls] == ['stale-token', 'fresh-token']
    assert session.csrf_calls == 2


def test_submit_does_not_retry_when_the_same_token_is_reissued():
    """Un 403 métier (« déjà loguée ») ne doit pas coûter un second envoi."""
    client, session = make_client([
        FakeResponse(403, [{'error': {'message': 'You have already logged this cache'}}]),
    ])

    result = submit(client)

    assert result['ok'] is False
    assert len(session.calls) == 1


def test_image_upload_retries_once_with_a_fresh_token_when_rejected():
    client, session = make_client(
        [
            FakeResponse(403, {'statusCode': 403}),
            FakeResponse(200, {'imageGuid': 'guid-1'}),
        ],
        tokens=['stale-token', 'fresh-token'],
    )

    result = upload(client)

    assert GeocachingSubmitLogsClient.extract_image_guid(result) == 'guid-1'
    # Un refus d'authentification arrête l'essai des variantes de champ : deux POST en tout,
    # pas les trois variantes suivies d'une deuxième série.
    assert len(session.calls) == 2
    assert [call['url'] for call in session.calls] == [LOG_DRAFT_IMAGES_URL] * 2
    assert [call['headers']['CSRF-Token'] for call in session.calls] == ['stale-token', 'fresh-token']


def test_image_upload_posts_a_single_multipart_field():
    """Un seul champ, celui que c:geo utilise : plus de noms essayés à l'aveugle."""
    client, session = make_client([FakeResponse(200, {'guid': 'guid-1', 'url': 'https://img'})])

    result = upload(client)

    assert GeocachingSubmitLogsClient.extract_image_guid(result) == 'guid-1'
    assert result['ok'] is True

    call = session.calls[0]
    assert call['url'] == LOG_DRAFT_IMAGES_URL
    assert list(call['files'].keys()) == [LOG_IMAGE_FORM_FIELD] == ['image']
    assert call['files']['image'] == ('photo.jpg', b'binaire', 'image/jpeg')
    assert call['headers']['CSRF-Token'] == 'token-42'


def test_image_upload_does_not_resend_the_file_when_rejected():
    """Un fichier refusé remontait jusqu'à trois envois du même contenu."""
    client, session = make_client([
        FakeResponse(400, {'statusCode': 400, 'message': 'Invalid image'}),
    ])

    result = upload(client)

    assert result['ok'] is False
    assert result['status'] == 400
    assert 'Invalid image' in result['body']
    assert len(session.calls) == 1


def test_image_upload_reports_invalid_json_without_resending():
    client, session = make_client([FakeResponse(200, None, text='<html>oops</html>')])

    result = upload(client)

    assert result['ok'] is False
    assert result['status'] == 200
    assert result['body'] == '<html>oops</html>'
    assert len(session.calls) == 1
