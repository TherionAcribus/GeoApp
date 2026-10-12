"""
Tests unitaires pour la couche centrale d'execution des plugins
(gc_backend/plugins/executor.py) :

- apply_text_handling : portage de normalizeInputsForPlugin (frontend)
- normalize_plugin_result : contrat de resultat documente
- score_plugin_results : scoring post-execution opt-in
"""

import pytest

from gc_backend.plugins.executor import (
    TextHandlingError,
    apply_text_handling,
    normalize_plugin_result,
    score_plugin_results,
)


# =============================================================================
# apply_text_handling
# =============================================================================

class TestApplyTextHandling:
    """Tests de la normalisation des inputs via text_handling."""

    def test_no_text_handling_returns_inputs_unchanged(self):
        inputs = {'text': 'héllo!', 'mode': 'encode'}

        normalized, warnings = apply_text_handling(inputs, None)

        assert normalized['text'] == 'héllo!'
        assert warnings == []
        # L'original n'est pas mute
        assert inputs['text'] == 'héllo!'

    def test_no_text_handling_empty_dict(self):
        inputs = {'text': 'éàü'}

        normalized, warnings = apply_text_handling(inputs, {})

        assert normalized == inputs
        assert warnings == []

    def test_map_characters(self):
        text_handling = {
            'normalize': {'map_characters': {'0': 'O', '1': 'I'}}
        }
        inputs = {'text': 'H3LL0 W0RLD 101'}

        normalized, warnings = apply_text_handling(inputs, text_handling)

        assert normalized['text'] == 'H3LLO WORLD IOI'
        assert warnings == []

    def test_remove_diacritics_produces_warning(self):
        text_handling = {'normalize': {'remove_diacritics': True}}
        inputs = {'text': 'Café crème'}

        normalized, warnings = apply_text_handling(inputs, text_handling)

        assert normalized['text'] == 'Cafe creme'
        assert len(warnings) == 1
        assert warnings[0].startswith('[text] ')
        assert 'accentués ont été normalisés' in warnings[0]

    def test_no_diacritics_no_warning(self):
        text_handling = {'normalize': {'remove_diacritics': True}}
        inputs = {'text': 'HELLO'}

        normalized, warnings = apply_text_handling(inputs, text_handling)

        assert normalized['text'] == 'HELLO'
        assert warnings == []

    def test_case_upper(self):
        text_handling = {'normalize': {'case': 'upper'}}
        inputs = {'text': 'Hello World'}

        normalized, _ = apply_text_handling(inputs, text_handling)

        assert normalized['text'] == 'HELLO WORLD'

    def test_case_lower(self):
        text_handling = {'normalize': {'case': 'lower'}}
        inputs = {'text': 'Hello World'}

        normalized, _ = apply_text_handling(inputs, text_handling)

        assert normalized['text'] == 'hello world'

    def test_allowed_ranges_strip_digits(self):
        """Les chiffres hors de la plage A-Z sont rejetes en 'strip'."""
        text_handling = {
            'allowed_ranges': ['0041-005A'],
            'allowed_characters': ' ',
            'unknown_char_policy': 'strip',
            'normalize': {'case': 'upper'},
        }
        inputs = {'text': 'he110 w0rld!'}

        normalized, warnings = apply_text_handling(inputs, text_handling)

        assert normalized['text'] == 'HE WRLD'
        assert len(warnings) == 1
        assert 'Caractères non supportés' in warnings[0]
        # Caracteres listes : '!' et '0' tries
        assert '0' in warnings[0] and '!' in warnings[0]

    def test_allowed_characters_membership(self):
        """Un caractere dans allowed_characters passe meme hors des plages."""
        text_handling = {
            'allowed_ranges': ['0041-005A'],
            'allowed_characters': 'é',
            'unknown_char_policy': 'warn_keep',
        }
        inputs = {'text': 'ABéC'}

        normalized, warnings = apply_text_handling(inputs, text_handling)

        assert normalized['text'] == 'ABéC'
        assert warnings == []

    def test_no_ranges_everything_allowed(self):
        """Sans allowed_ranges, tous les caracteres sont autorises."""
        text_handling = {
            'allowed_characters': 'AB',
            'unknown_char_policy': 'strip',
        }
        inputs = {'text': 'XYZ'}

        normalized, warnings = apply_text_handling(inputs, text_handling)

        assert normalized['text'] == 'XYZ'
        assert warnings == []

    def test_warn_keep_keeps_and_warns(self):
        text_handling = {
            'allowed_ranges': ['0041-005A'],
            'unknown_char_policy': 'warn_keep',
        }
        inputs = {'text': 'AB9C'}

        normalized, warnings = apply_text_handling(inputs, text_handling)

        assert normalized['text'] == 'AB9C'
        assert len(warnings) == 1
        assert warnings[0] == '[text] Caractères non supportés par le plugin: 9'

    def test_strip_policy_drops_and_warns(self):
        text_handling = {
            'allowed_ranges': ['0041-005A'],
            'unknown_char_policy': 'strip',
        }
        inputs = {'text': 'AB9C8'}

        normalized, warnings = apply_text_handling(inputs, text_handling)

        assert normalized['text'] == 'ABC'
        assert len(warnings) == 1
        assert warnings[0] == '[text] Caractères non supportés par le plugin: 89'

    def test_keep_policy_silent(self):
        text_handling = {
            'allowed_ranges': ['0041-005A'],
            'unknown_char_policy': 'keep',
        }
        inputs = {'text': 'AB9C'}

        normalized, warnings = apply_text_handling(inputs, text_handling)

        assert normalized['text'] == 'AB9C'
        assert warnings == []

    def test_error_policy_raises(self):
        text_handling = {
            'allowed_ranges': ['0041-005A'],
            'unknown_char_policy': 'error',
        }
        inputs = {'text': 'AB9C8'}

        with pytest.raises(TextHandlingError) as exc_info:
            apply_text_handling(inputs, text_handling)

        assert 'Caractères non supportés par le plugin: 89' in str(exc_info.value)

    def test_decode_mode_skips_text_field(self):
        """En mode decode, le champ 'text' n'est PAS normalise."""
        text_handling = {
            'fields': ['text'],
            'normalize': {'case': 'upper', 'remove_diacritics': True},
        }
        inputs = {'text': 'héllo', 'mode': 'decode'}

        normalized, warnings = apply_text_handling(inputs, text_handling)

        assert normalized['text'] == 'héllo'
        assert warnings == []

    def test_decode_mode_still_normalizes_other_fields(self):
        """En mode decode, les autres champs de `fields` restent normalises."""
        text_handling = {
            'fields': ['text', 'key'],
            'normalize': {'case': 'upper'},
        }
        inputs = {'text': 'abc', 'key': 'clé', 'mode': 'decode'}

        normalized, _ = apply_text_handling(inputs, text_handling)

        assert normalized['text'] == 'abc'      # non normalise en decode
        assert normalized['key'] == 'CLÉ'       # normalise quand meme

    def test_key_field_auto_added(self):
        """'key' est normalise meme hors de `fields` si declare string."""
        text_handling = {
            'fields': ['text'],
            'normalize': {'case': 'upper'},
        }
        input_types = {'key': {'type': 'string'}}
        inputs = {'text': 'abc', 'key': 'clé'}

        normalized, _ = apply_text_handling(inputs, text_handling, input_types)

        assert normalized['key'] == 'CLÉ'

    def test_key_field_not_added_if_not_declared_string(self):
        text_handling = {
            'fields': ['text'],
            'normalize': {'case': 'upper'},
        }
        input_types = {'key': {'type': 'select'}}
        inputs = {'text': 'abc', 'key': 'clé'}

        normalized, _ = apply_text_handling(inputs, text_handling, input_types)

        assert normalized['key'] == 'clé'

    def test_non_string_values_untouched(self):
        text_handling = {
            'fields': ['text', 'count'],
            'normalize': {'case': 'upper'},
        }
        inputs = {'text': 'abc', 'count': 42, 'other': 'xyz'}

        normalized, _ = apply_text_handling(inputs, text_handling)

        assert normalized['text'] == 'ABC'
        assert normalized['count'] == 42
        # 'other' n'est pas dans fields : inchange
        assert normalized['other'] == 'xyz'

    def test_fields_list_respected(self):
        """Seuls les champs listes dans text_handling.fields sont normalises."""
        text_handling = {
            'fields': ['message'],
            'normalize': {'case': 'upper'},
        }
        inputs = {'text': 'abc', 'message': 'xyz'}

        normalized, _ = apply_text_handling(inputs, text_handling)

        assert normalized['text'] == 'abc'
        assert normalized['message'] == 'XYZ'

    def test_mode_encode_normalizes_text(self):
        text_handling = {
            'fields': ['text'],
            'normalize': {'case': 'upper'},
        }
        inputs = {'text': 'abc', 'mode': 'encode'}

        normalized, _ = apply_text_handling(inputs, text_handling)

        assert normalized['text'] == 'ABC'

    def test_full_pipeline_order(self):
        """map_characters -> diacritics -> case -> allowed, dans cet ordre."""
        text_handling = {
            'allowed_ranges': ['0041-005A', '0020-0020'],
            'unknown_char_policy': 'strip',
            'normalize': {
                'map_characters': {'3': 'E'},
                'remove_diacritics': True,
                'case': 'upper',
            },
        }
        inputs = {'text': 'h3llo wörld'}

        normalized, warnings = apply_text_handling(inputs, text_handling)

        assert normalized['text'] == 'HELLO WORLD'
        # Diacritique retiree (ö -> o) : warning emis
        assert any('accentués' in w for w in warnings)


# =============================================================================
# normalize_plugin_result
# =============================================================================

class TestNormalizePluginResult:
    """Tests du contrat de resultat normalise."""

    def test_success_mapped_to_ok(self):
        raw = {'status': 'success', 'summary': 'ok', 'results': [{'id': 'r1'}]}

        result = normalize_plugin_result(raw, name='p', version='1.0')

        assert result['status'] == 'ok'

    def test_non_dict_input_returns_error_dict(self):
        for raw in (None, 'string', 42, ['a']):
            result = normalize_plugin_result(raw, name='p', version='1.0')

            assert result['status'] == 'error'
            assert result['results'] == []
            assert result['plugin_info']['name'] == 'p'
            assert result['plugin_info']['version'] == '1.0'
            assert result['plugin_info']['execution_time_ms'] == 0
            assert result['error']['type'] == 'InvalidResult'
            assert isinstance(result['summary'], str)

    def test_missing_fields_filled(self):
        result = normalize_plugin_result({}, name='p', version='2.0')

        # Pas de status ni results -> 'error'
        assert result['status'] == 'error'
        assert result['summary'] == 'Erreur inconnue'
        assert result['results'] == []
        assert result['plugin_info'] == {
            'name': 'p',
            'version': '2.0',
            'execution_time_ms': 0,
        }
        assert result['error']['type'] == 'UnknownError'

    def test_existing_confidence_preserved(self):
        raw = {
            'status': 'ok',
            'results': [
                {'id': 'a', 'confidence': 0.7, 'text_output': 'X'},
                {'id': 'b', 'confidence': None},
            ],
        }

        result = normalize_plugin_result(raw, name='p', version='1.0')

        assert result['results'][0]['confidence'] == 0.7
        # Une valeur existante (meme None) n'est pas ecrasee
        assert result['results'][1]['confidence'] is None

    def test_missing_confidence_gets_default(self):
        raw = {'status': 'ok', 'results': [{'id': 'a'}]}

        result = normalize_plugin_result(raw, name='p', version='1.0')

        assert result['results'][0]['confidence'] == 0.0

    def test_missing_id_gets_result_i(self):
        raw = {'status': 'ok', 'results': [{'confidence': 0.5}, {'id': 'custom'}]}

        result = normalize_plugin_result(raw, name='p', version='1.0')

        assert result['results'][0]['id'] == 'result_1'
        assert result['results'][1]['id'] == 'custom'

    def test_non_dict_items_dropped(self):
        raw = {'status': 'ok', 'results': [{'id': 'a'}, 'nope', 5, {'id': 'b'}]}

        result = normalize_plugin_result(raw, name='p', version='1.0')

        assert [item['id'] for item in result['results']] == ['a', 'b']

    def test_unknown_status_with_results_becomes_ok(self):
        raw = {'status': 'weird', 'results': [{'id': 'a'}]}

        result = normalize_plugin_result(raw, name='p', version='1.0')

        assert result['status'] == 'ok'

    def test_unknown_status_without_results_becomes_error(self):
        raw = {'status': 'weird'}

        result = normalize_plugin_result(raw, name='p', version='1.0')

        assert result['status'] == 'error'
        assert result['error']['type'] == 'UnknownError'

    def test_error_status_without_error_block_gets_one(self):
        raw = {'status': 'error', 'summary': 'boom', 'results': []}

        result = normalize_plugin_result(raw, name='p', version='1.0')

        assert result['error'] == {'type': 'UnknownError', 'message': 'boom'}

    def test_error_status_derives_summary_from_error_message(self):
        raw = {
            'status': 'error',
            'results': [],
            'error': {'type': 'SomeError', 'message': 'ça a planté'},
        }

        result = normalize_plugin_result(raw, name='p', version='1.0')

        assert result['summary'] == 'ça a planté'
        assert result['error']['type'] == 'SomeError'

    def test_other_keys_preserved(self):
        raw = {
            'status': 'ok',
            'summary': 'done',
            'results': [],
            'coordinates': {'lat': 1.0},
            'plugin_info': {'name': 'real_name', 'extra': 'keep'},
            'warnings': ['w1'],
        }

        result = normalize_plugin_result(raw, name='p', version='1.0')

        assert result['coordinates'] == {'lat': 1.0}
        assert result['warnings'] == ['w1']
        assert result['plugin_info']['name'] == 'real_name'
        assert result['plugin_info']['extra'] == 'keep'
        assert result['plugin_info']['version'] == '1.0'


# =============================================================================
# score_plugin_results
# =============================================================================

class TestScorePluginResults:
    """Tests du scoring post-execution."""

    def test_non_dict_result_returned_unchanged(self):
        assert score_plugin_results('nope', {}) == 'nope'
        assert score_plugin_results({'status': 'ok'}, {}) == {'status': 'ok'}

    def test_detect_mode_zeroes_confidences(self):
        result = {
            'status': 'ok',
            'results': [
                {'id': 'a', 'confidence': 0.9},
                {'id': 'b', 'confidence': 0.3},
            ],
        }

        out = score_plugin_results(result, {'mode': 'detect'})

        assert [i['confidence'] for i in out['results']] == [0.0, 0.0]
        # La confidence d'origine est preservee dans les metadata
        assert out['results'][0]['metadata']['plugin_confidence'] == 0.9
        assert out['results'][1]['metadata']['plugin_confidence'] == 0.3

    def test_encode_mode_untouched(self):
        result = {
            'status': 'ok',
            'results': [{'id': 'a', 'confidence': 0.9, 'text_output': 'XYZ'}],
        }

        out = score_plugin_results(result, {'mode': 'encode'})

        assert out['results'][0]['confidence'] == 0.9
        assert out['results'][0]['metadata']['plugin_confidence'] == 0.9

    def test_decode_mode_scores_results(self):
        """Le decode passe par le scorer : confidence recalculee."""
        result = {
            'status': 'ok',
            'results': [
                {'id': 'a', 'confidence': 0.5, 'text_output': 'HELLO WORLD THIS IS A TEST'},
            ],
        }

        out = score_plugin_results(result, {'mode': 'decode'})

        assert len(out['results']) == 1
        assert isinstance(out['results'][0]['confidence'], (int, float))

    def test_empty_ranked_marks_scoring_filtered(self):
        """Quand le scorer elimine tout, les items sont conserves et marques."""
        result = {
            'status': 'ok',
            'results': [
                # Pas de text_output -> le scorer ne peut rien noter
                {'id': 'a', 'confidence': 0.8},
                {'id': 'b', 'confidence': 0.4, 'metadata': {'plugin_confidence': 0.4}},
            ],
        }

        out = score_plugin_results(result, {'mode': 'decode'})

        assert len(out['results']) == 2
        for item in out['results']:
            assert item['metadata']['scoring_filtered'] is True
            assert 'peu plausible' in item['metadata']['scoring_warning']
        # plugin_confidence deja present n'est pas ecrase
        assert out['results'][1]['metadata']['plugin_confidence'] == 0.4
        assert out['results'][0]['metadata']['plugin_confidence'] == 0.8
