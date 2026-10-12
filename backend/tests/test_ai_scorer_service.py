"""Unit tests for AI Scorer provider/runtime metadata."""

from gc_backend.services import ai_scorer_service


class _FakeResponse:
    status_code = 200
    text = ''

    def __init__(self, payload):
        self._payload = payload

    def json(self):
        return self._payload


def test_call_openai_compatible_returns_reported_model_and_usage(monkeypatch):
    captured = {}

    def fake_post(endpoint, json, headers, timeout):
        captured['endpoint'] = endpoint
        captured['json'] = json
        captured['headers'] = headers
        captured['timeout'] = timeout
        return _FakeResponse({
            'model': 'provider-model',
            'usage': {
                'prompt_tokens': 21,
                'completion_tokens': 7,
                'total_tokens': 28,
            },
            'choices': [{'message': {'content': 'réponse'}}],
        })

    monkeypatch.setattr(ai_scorer_service.requests, 'post', fake_post)

    result = ai_scorer_service._call_openai_compatible(
        user_message='message',
        base_url='http://localhost:1234',
        model='requested-model',
        provider='lmstudio',
        timeout_sec=12,
        max_tokens=123,
    )

    assert captured['endpoint'] == 'http://localhost:1234/v1/chat/completions'
    assert captured['json']['model'] == 'requested-model'
    assert captured['json']['max_tokens'] == 123
    assert captured['timeout'] == 12
    assert result.text == 'réponse'
    assert result.reported_model == 'provider-model'
    assert result.usage == {
        'input_tokens': 21,
        'output_tokens': 7,
        'total_tokens': 28,
    }


def test_ai_score_results_propagates_runtime_metadata(monkeypatch):
    def fake_call(**kwargs):
        return ai_scorer_service.OpenAiCompatibleCallResult(
            text='{"results":[{"index":0,"confidence":0.91,"language":"fr","readable":true,"explanation":"ok","coordinates":{"exist":false}}]}',
            reported_model='provider-model',
            usage={'input_tokens': 30, 'output_tokens': 9, 'total_tokens': 39},
        )

    monkeypatch.setattr(ai_scorer_service, '_call_openai_compatible', fake_call)

    scored = ai_scorer_service.ai_score_results(
        [{'text_output': 'texte', 'confidence': 0.2}],
        base_url='http://localhost:1234',
        model='requested-model',
        provider='lmstudio',
        plugin_name='test-plugin',
    )

    ai_metadata = scored[0]['metadata']['ai_scoring']
    assert scored[0]['confidence'] == 0.91
    assert scored[0]['metadata']['algo_confidence'] == 0.2
    assert ai_metadata['provider'] == 'lmstudio'
    assert ai_metadata['model'] == 'requested-model'
    assert ai_metadata['reported_model'] == 'provider-model'
    assert ai_metadata['usage'] == {'input_tokens': 30, 'output_tokens': 9, 'total_tokens': 39}
    assert ai_metadata['batch_index'] == 0
    assert ai_metadata['source'] == 'ai_scorer'


def _score(items, monkeypatch, *, text=None, error=None, batch_size=20):
    def fake_call(**kwargs):
        if error is not None:
            raise RuntimeError(error)
        return ai_scorer_service.OpenAiCompatibleCallResult(text=text, reported_model=None, usage=None)

    monkeypatch.setattr(ai_scorer_service, '_call_openai_compatible', fake_call)
    return ai_scorer_service.ai_score_results(
        items,
        base_url='http://localhost:1234',
        model='requested-model',
        provider='lmstudio',
        batch_size=batch_size,
    )


def test_llm_failure_keeps_algo_confidence(monkeypatch):
    """Un echec du LLM n'est pas un avis negatif : la confiance algo reste."""
    coords = {'exist': True, 'ddm': "N 48° 51.234' E 002° 21.456'"}
    items = [
        {'text_output': 'LA CACHE EST SOUS LE PONT', 'confidence': 0.66,
         'coordinates': coords, 'metadata': {'scoring': {'score': 0.66}}},
        {'text_output': 'PONT', 'confidence': 0.49},
    ]

    scored = _score(items, monkeypatch, error='timeout')

    assert [it['confidence'] for it in scored] == [0.66, 0.49]
    assert scored[0]['coordinates'] == coords
    assert scored[0]['metadata']['scoring']['score'] == 0.66
    for it in scored:
        ai_metadata = it['metadata']['ai_scoring']
        assert ai_metadata['failed'] is True
        assert 'timeout' in ai_metadata['explanation']
        assert 'score' not in ai_metadata
    # Les items d'entree ne sont pas modifies.
    assert 'ai_scoring' not in items[0]['metadata']
    assert 'metadata' not in items[1]


def test_unparseable_response_keeps_algo_confidence(monkeypatch):
    scored = _score([{'text_output': 'PONT', 'confidence': 0.49}], monkeypatch, text='désolé, pas de JSON')

    assert scored[0]['confidence'] == 0.49
    assert scored[0]['metadata']['ai_scoring']['failed'] is True


def test_item_missing_from_response_is_failed_not_zero(monkeypatch):
    """Reponse tronquee : l'item absent garde son score, l'item present est note."""
    text = '{"results":[{"index":0,"confidence":0.9,"language":"fr","readable":true,"explanation":"ok"}]}'
    items = [
        {'text_output': 'LA CACHE EST SOUS LE PONT', 'confidence': 0.66},
        {'text_output': 'PONT', 'confidence': 0.49},
    ]

    scored = _score(items, monkeypatch, text=text)

    assert scored[0]['confidence'] == 0.9
    assert scored[0]['metadata']['algo_confidence'] == 0.66
    assert scored[1]['confidence'] == 0.49
    assert scored[1]['metadata']['ai_scoring']['failed'] is True


def test_explicit_zero_from_model_is_still_applied(monkeypatch):
    """Un vrai 0.0 rendu par le modele reste un avis, pas un echec."""
    text = '{"results":[{"index":0,"confidence":0.0,"language":"unknown","readable":false,"explanation":"bruit"}]}'

    scored = _score([{'text_output': 'XQZJW', 'confidence': 0.2}], monkeypatch, text=text)

    assert scored[0]['confidence'] == 0.0
    assert 'failed' not in scored[0]['metadata']['ai_scoring']
