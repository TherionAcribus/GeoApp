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
