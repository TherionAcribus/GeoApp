"""
Tests unitaires du moteur de recherche des alphabets.
"""

from gc_backend.blueprints.alphabets import expand_search_terms, search_alphabets


def test_expand_search_terms_normalizes_accents_and_adds_synonyms():
    terms = expand_search_terms('Télégraphe')

    assert terms[0] == 'telegraphe'
    assert 'morse' in terms
    assert 'communication' in terms


def test_search_alphabets_matches_geocaching_synonyms():
    alphabets = [
        {
            'id': 'drapeaux_maritimes',
            'name': 'Drapeaux Maritimes',
            'description': 'Alphabet de signaux navals',
            'tags': ['maritime', 'drapeaux']
        },
        {
            'id': 'pigpen',
            'name': 'Pig Pen',
            'description': 'Alphabet maconnique',
            'tags': ['symboles']
        },
        {
            'id': 'fremen',
            'name': 'Fremen',
            'description': 'Alphabet de fiction',
            'tags': ['fiction']
        }
    ]

    marine_results = search_alphabets('marin', [dict(item) for item in alphabets], True, True, False)
    assert marine_results[0]['id'] == 'drapeaux_maritimes'
    assert 'search_score' in marine_results[0]
    assert any('synonyme:' in match for match in marine_results[0]['search_matches'])

    pigpen_results = search_alphabets('cochon', [dict(item) for item in alphabets], True, True, False)
    assert pigpen_results[0]['id'] == 'pigpen'

    alien_results = search_alphabets('alien', [dict(item) for item in alphabets], True, True, False)
    assert alien_results[0]['id'] == 'fremen'


def test_search_alphabets_keeps_relevance_order():
    alphabets = [
        {
            'id': 'semaphore',
            'name': 'Semaphore',
            'description': 'Signaux avec drapeaux',
            'tags': ['signalisation']
        },
        {
            'id': 'drapeaux_maritimes',
            'name': 'Drapeaux Maritimes',
            'description': 'Drapeaux Maritimes',
            'tags': ['maritime', 'drapeaux']
        }
    ]

    results = search_alphabets('drapeau', [dict(item) for item in alphabets], True, True, False)

    assert [item['id'] for item in results] == ['drapeaux_maritimes', 'semaphore']
    assert results[0]['search_score'] > results[1]['search_score']
