"""
Tests d'intégration pour les routes Formula Solver
"""

import pytest
import json
from gc_backend import create_app
from gc_backend.database import db
from gc_backend.geocaches.models import Geocache
from gc_backend.models import Zone


@pytest.fixture
def app():
    """Crée une instance de l'application pour les tests"""
    app = create_app()
    app.config['TESTING'] = True
    app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///:memory:'
    
    with app.app_context():
        db.create_all()
        yield app
        db.session.remove()
        db.drop_all()


@pytest.fixture
def client(app):
    """Client de test Flask"""
    return app.test_client()


@pytest.fixture
def sample_geocache(app):
    """Crée une géocache de test dans la DB"""
    with app.app_context():
        zone = Zone(name='test', description='Test zone')
        db.session.add(zone)
        db.session.flush()

        geocache = Geocache(
            gc_code='GC12345',
            name='Test Mystery',
            type='Mystery',
            description_html="""
                <h1>Énigme Test</h1>
                <p>Pour trouver les coordonnées finales:</p>
                <ul>
                    <li>A. Nombre de fenêtres sur la façade</li>
                    <li>B. Année de construction - 1900</li>
                </ul>
                <p>Les coordonnées sont: N 47° 5E.AB E 006° 5C.DE</p>
            """,
            description_raw="""
                Énigme Test
                Pour trouver les coordonnées finales:
                A. Nombre de fenêtres sur la façade
                B. Année de construction - 1900
                Les coordonnées sont: N 47° 5E.AB E 006° 5C.DE
            """,
            latitude=47.123,
            longitude=6.456,
            difficulty=3.0,
            terrain=2.5,
            owner='TestOwner',
            size='Regular',
            zone_id=zone.id
        )
        db.session.add(geocache)
        db.session.commit()
        
        geocache_id = geocache.id
        
    return geocache_id


class TestDetectFormulasRoute:
    """Tests de la route /api/formula-solver/detect-formulas"""
    
    def test_detect_with_text(self, client):
        """Test : Détection de formules depuis texte brut"""
        response = client.post(
            '/api/formula-solver/detect-formulas',
            json={'text': 'Les coordonnées sont N 47° 5E.FTN E 006° 5A.JVF'}
        )
        
        assert response.status_code == 200
        data = json.loads(response.data)
        
        assert data['status'] == 'success'
        assert len(data['formulas']) >= 1
        assert 'N 47° 5E.FTN' in data['formulas'][0]['north']
        assert 'E 006° 5A.JVF' in data['formulas'][0]['east']
    
    def test_detect_with_geocache_id(self, client, sample_geocache):
        """Test : Détection de formules depuis geocache_id"""
        response = client.post(
            '/api/formula-solver/detect-formulas',
            json={'geocache_id': sample_geocache}
        )
        
        assert response.status_code == 200
        data = json.loads(response.data)
        
        assert data['status'] == 'success'
        # Devrait détecter N 47° 5E.AB E 006° 5C.DE
        assert len(data['formulas']) >= 1
    
    def test_detect_missing_params(self, client):
        """Test : Erreur 400 si aucun paramètre"""
        response = client.post(
            '/api/formula-solver/detect-formulas',
            json={}
        )
        
        assert response.status_code == 400
        data = json.loads(response.data)
        assert data['status'] == 'error'
    
    def test_detect_geocache_not_found(self, client):
        """Test : Erreur 404 si geocache inexistante"""
        response = client.post(
            '/api/formula-solver/detect-formulas',
            json={'geocache_id': 99999}
        )
        
        assert response.status_code == 404
        data = json.loads(response.data)
        assert data['status'] == 'error'


class TestExtractQuestionsRoute:
    """Tests de la route /api/formula-solver/extract-questions"""
    
    def test_extract_with_text(self, client):
        """Test : Extraction de questions depuis texte"""
        text = """
        Pour résoudre:
        A. Combien de fenêtres?
        B. Année de construction?
        C. Numéro de la rue?
        """
        
        response = client.post(
            '/api/formula-solver/extract-questions',
            json={
                'text': text,
                'letters': ['A', 'B', 'C'],
                'method': 'regex'
            }
        )
        
        assert response.status_code == 200
        data = json.loads(response.data)
        
        assert data['status'] == 'success'
        assert 'fenêtres' in data['questions']['A'].lower()
        assert 'année' in data['questions']['B'].lower()
        assert data['found_count'] >= 2
    
    def test_extract_with_geocache_id(self, client, sample_geocache):
        """Test : Extraction depuis geocache_id"""
        response = client.post(
            '/api/formula-solver/extract-questions',
            json={
                'geocache_id': sample_geocache,
                'letters': ['A', 'B'],
                'method': 'regex'
            }
        )
        
        assert response.status_code == 200
        data = json.loads(response.data)
        
        assert data['status'] == 'success'
        assert data['method'] == 'regex'
        # Devrait trouver au moins A et B depuis la description
        assert data['found_count'] >= 1
    
    def test_extract_missing_letters(self, client):
        """Test : Erreur 400 si letters manquant"""
        response = client.post(
            '/api/formula-solver/extract-questions',
            json={
                'text': 'Test',
                'method': 'regex'
            }
        )
        
        assert response.status_code == 400
        data = json.loads(response.data)
        assert data['status'] == 'error'
    
    def test_extract_invalid_method(self, client):
        """Test : Erreur 400 si method invalide"""
        response = client.post(
            '/api/formula-solver/extract-questions',
            json={
                'text': 'Test',
                'letters': ['A'],
                'method': 'invalid'
            }
        )
        
        assert response.status_code == 400
        data = json.loads(response.data)
        assert data['status'] == 'error'
    
    def test_extract_ai_not_implemented(self, client):
        """Test : Erreur 400 si method=ai (non implémenté)"""
        response = client.post(
            '/api/formula-solver/extract-questions',
            json={
                'text': 'Test',
                'letters': ['A'],
                'method': 'ai'
            }
        )
        
        assert response.status_code == 400
        data = json.loads(response.data)
        assert data['status'] == 'error'
        assert 'AI' in data['error'] or 'ai' in data['error']


class TestCalculateRoute:
    """Tests de la route /api/formula-solver/calculate"""
    
    def test_calculate_simple(self, client):
        """Test : Calcul simple sans opérations"""
        response = client.post(
            '/api/formula-solver/calculate',
            json={
                'north_formula': 'N 47° 5E.AB',
                'east_formula': 'E 006° 5C.DE',
                'values': {
                    'A': 3,
                    'B': 5,
                    'C': 1,
                    'D': 2,
                    'E': 8
                }
            }
        )
        
        assert response.status_code == 200
        data = json.loads(response.data)
        
        assert data['status'] == 'success'
        assert 'coordinates' in data
        assert 'latitude' in data['coordinates']
        assert 'longitude' in data['coordinates']
        assert 'ddm' in data['coordinates']
        assert 'dms' in data['coordinates']
        assert 'calculation_steps' in data
    
    def test_calculate_with_operations(self, client):
        """Test : Calcul avec opérations arithmétiques"""
        response = client.post(
            '/api/formula-solver/calculate',
            json={
                'north_formula': 'N 47° (5+3).00',
                'east_formula': 'E 006° (10-2).50',
                'values': {}
            }
        )
        
        assert response.status_code == 200
        data = json.loads(response.data)
        
        assert data['status'] == 'success'
        # 5+3 = 8, donc N 47° 08.00
        # 10-2 = 8, donc E 006° 08.50

    def test_calculate_without_values_field(self, client):
        """Test : Calcul sans variables et sans champ values"""
        response = client.post(
            '/api/formula-solver/calculate',
            json={
                'north_formula': 'N 47° 50.000',
                'east_formula': 'E 006° 10.000'
            }
        )

        assert response.status_code == 200
        data = json.loads(response.data)
        assert data['status'] == 'success'
    
    def test_calculate_with_distance(self, client):
        """Test : Calcul avec distance depuis origine"""
        response = client.post(
            '/api/formula-solver/calculate',
            json={
                'north_formula': 'N 47° 50.000',
                'east_formula': 'E 006° 10.000',
                'values': {},
                'origin_lat': 47.0,
                'origin_lon': 6.0
            }
        )
        
        assert response.status_code == 200
        data = json.loads(response.data)
        
        assert data['status'] == 'success'
        assert 'distance' in data
        assert 'km' in data['distance']
        assert 'miles' in data['distance']
        assert data['distance']['km'] > 0
    
    def test_calculate_missing_formula(self, client):
        """Test : Erreur 400 si formule manquante"""
        response = client.post(
            '/api/formula-solver/calculate',
            json={
                'north_formula': 'N 47° 50.000',
                'values': {}
            }
        )
        
        assert response.status_code == 400
        data = json.loads(response.data)
        assert data['status'] == 'error'
    
    def test_calculate_missing_values(self, client):
        """Test : Erreur 400 si valeurs manquantes pour variables"""
        response = client.post(
            '/api/formula-solver/calculate',
            json={
                'north_formula': 'N 47° 5A.BC',
                'east_formula': 'E 006° 5D.EF',
                'values': {
                    'A': 1
                    # B, C, D, E, F manquants !
                }
            }
        )
        
        assert response.status_code == 400
        data = json.loads(response.data)
        assert data['status'] == 'error'
        assert 'manquantes' in data['error'].lower() or 'missing' in data['error'].lower()


class TestCalculateBatchRoute:
    """Tests de la route /api/formula-solver/calculate-batch"""

    def test_batch_simple(self, client):
        """Test : Calcul batch de plusieurs combinaisons"""
        response = client.post(
            '/api/formula-solver/calculate-batch',
            json={
                'north_formula': 'N 47° 5E.AB',
                'east_formula': 'E 006° 5C.DE',
                'combinations': [
                    {'A': 3, 'B': 5, 'C': 1, 'D': 2, 'E': 8},
                    {'A': 3, 'B': 5, 'C': 1, 'D': 2, 'E': 9}
                ]
            }
        )

        assert response.status_code == 200
        data = json.loads(response.data)

        assert data['status'] == 'success'
        assert data['success_count'] == 2
        assert data['error_count'] == 0
        assert len(data['results']) == 2
        # Chaque résultat renvoie les valeurs d'origine + les coordonnées
        assert data['results'][0]['values'] == {'A': 3, 'B': 5, 'C': 1, 'D': 2, 'E': 8}
        assert 'coordinates' in data['results'][0]
        assert 'ddm' in data['results'][0]['coordinates']

    def test_batch_with_distance(self, client):
        """Test : Distance calculée si origine fournie"""
        response = client.post(
            '/api/formula-solver/calculate-batch',
            json={
                'north_formula': 'N 47° 5E.AB',
                'east_formula': 'E 006° 5C.DE',
                'combinations': [
                    {'A': 3, 'B': 5, 'C': 1, 'D': 2, 'E': 8}
                ],
                'origin_lat': 47.0,
                'origin_lon': 6.0
            }
        )

        assert response.status_code == 200
        data = json.loads(response.data)
        assert data['results'][0]['distance'] is not None
        assert data['results'][0]['distance']['km'] > 0

    def test_batch_partial_errors(self, client):
        """Test : Une combinaison invalide n'empêche pas les autres"""
        response = client.post(
            '/api/formula-solver/calculate-batch',
            json={
                'north_formula': 'N 47° 5E.AB',
                'east_formula': 'E 006° 5C.DE',
                'combinations': [
                    {'A': 3, 'B': 5, 'C': 1, 'D': 2, 'E': 8},
                    {'A': 3}  # valeurs manquantes → erreur pour cette combinaison
                ]
            }
        )

        assert response.status_code == 200
        data = json.loads(response.data)
        assert data['success_count'] == 1
        assert data['error_count'] == 1
        # Le résultat en erreur conserve ses valeurs et un message
        error_result = next(r for r in data['results'] if r['status'] == 'error')
        assert 'error' in error_result

    def test_batch_missing_formula(self, client):
        """Test : Erreur 400 si formule manquante"""
        response = client.post(
            '/api/formula-solver/calculate-batch',
            json={
                'north_formula': 'N 47° 5E.AB',
                'combinations': [{'A': 1}]
            }
        )

        assert response.status_code == 400
        data = json.loads(response.data)
        assert data['status'] == 'error'

    def test_batch_empty_combinations(self, client):
        """Test : Erreur 400 si combinations vide ou absent"""
        response = client.post(
            '/api/formula-solver/calculate-batch',
            json={
                'north_formula': 'N 47° 5E.AB',
                'east_formula': 'E 006° 5C.DE',
                'combinations': []
            }
        )

        assert response.status_code == 400
        data = json.loads(response.data)
        assert data['status'] == 'error'

    def test_batch_too_many_combinations(self, client):
        """Test : Erreur 400 au-delà de la limite de sécurité"""
        response = client.post(
            '/api/formula-solver/calculate-batch',
            json={
                'north_formula': 'N 47° 5E.AB',
                'east_formula': 'E 006° 5C.DE',
                'combinations': [{'A': 1, 'B': 2, 'C': 3, 'D': 4, 'E': 5}] * 2001
            }
        )

        assert response.status_code == 400
        data = json.loads(response.data)
        assert data['status'] == 'error'


class TestSearchAnswersBatchParallel:
    """Tests de la route /api/formula-solver/ai/search-answers (parallélisation)"""

    def test_batch_runs_in_parallel(self, client, monkeypatch):
        """Test : les recherches s'exécutent en parallèle (temps << séquentiel)"""
        import time
        from gc_backend.blueprints import formula_solver

        def slow_search(question, context=None, max_results=5, raw=False):
            time.sleep(0.3)
            return [{'text': f'answer for {question}', 'source': 'x', 'score': 0.9, 'type': 'snippet'}]

        monkeypatch.setattr(formula_solver.web_search_service, 'search', slow_search)
        monkeypatch.setattr(formula_solver.web_search_service, 'extract_answer', lambda results: results[0]['text'])

        start = time.perf_counter()
        response = client.post(
            '/api/formula-solver/ai/search-answers',
            json={'questions': {'A': 'q1', 'B': 'q2', 'C': 'q3', 'D': 'q4'}}
        )
        elapsed = time.perf_counter() - start

        assert response.status_code == 200
        data = json.loads(response.data)
        assert data['status'] == 'success'
        assert set(data['answers'].keys()) == {'A', 'B', 'C', 'D'}
        # Séquentiel prendrait ~1.2s (4 x 0.3) ; en parallèle (4 workers) ~0.3s.
        assert elapsed < 0.8, f"Recherche batch trop lente ({elapsed:.2f}s), parallélisation inopérante ?"

    def test_batch_error_isolation(self, client, monkeypatch):
        """Test : une recherche en échec n'interrompt pas les autres"""
        from gc_backend.blueprints import formula_solver

        def flaky_search(question, context=None, max_results=5, raw=False):
            if question == 'boom':
                raise RuntimeError('search failed')
            return [{'text': 'ok', 'source': 'x', 'score': 0.9, 'type': 'snippet'}]

        monkeypatch.setattr(formula_solver.web_search_service, 'search', flaky_search)
        monkeypatch.setattr(formula_solver.web_search_service, 'extract_answer', lambda results: results[0]['text'])

        response = client.post(
            '/api/formula-solver/ai/search-answers',
            json={'questions': {'A': 'good', 'B': 'boom'}}
        )

        assert response.status_code == 200
        data = json.loads(response.data)
        assert data['answers']['A']['best_answer'] == 'ok'
        # La question en échec renvoie une réponse vide sans planter le lot.
        assert data['answers']['B']['best_answer'] == ''

    def test_batch_empty_question_skips_search(self, client, monkeypatch):
        """Test : une question vide ne déclenche pas de recherche"""
        from gc_backend.blueprints import formula_solver

        called = {'count': 0}

        def counting_search(question, context=None, max_results=5, raw=False):
            called['count'] += 1
            return [{'text': 'ok', 'source': 'x', 'score': 0.9, 'type': 'snippet'}]

        monkeypatch.setattr(formula_solver.web_search_service, 'search', counting_search)
        monkeypatch.setattr(formula_solver.web_search_service, 'extract_answer', lambda results: results[0]['text'])

        response = client.post(
            '/api/formula-solver/ai/search-answers',
            json={'questions': {'A': 'good', 'B': ''}}
        )

        assert response.status_code == 200
        data = json.loads(response.data)
        assert called['count'] == 1
        assert data['answers']['B'] == {'best_answer': '', 'results': []}


class TestAiDetectFormulaFallback:
    """Tests de la route /api/formula-solver/ai/detect-formula"""

    def test_uses_shared_helper_with_fallback(self, client, monkeypatch):
        """
        Avant le correctif, /ai/detect-formula appelait plugin_manager.execute_plugin()
        directement (sans filet de sécurité), contrairement à /detect-formulas qui
        utilise _execute_formula_parser() (fallback si le PluginManager est indisponible).
        Ce test verrouille le fait que /ai/detect-formula utilise désormais le même
        helper partagé.
        """
        from gc_backend.blueprints import formula_solver

        calls = []

        def fake_execute_formula_parser(text):
            calls.append(text)
            return {
                'status': 'success',
                'results': [{'id': 'r1', 'north': 'N 47° 5A.BC', 'east': 'E 006° 5D.EF', 'confidence': 0.9}],
                'summary': '1 formule détectée'
            }

        monkeypatch.setattr(formula_solver, '_execute_formula_parser', fake_execute_formula_parser)

        response = client.post(
            '/api/formula-solver/ai/detect-formula',
            json={'text': 'N 47° 5A.BC E 006° 5D.EF'}
        )

        assert response.status_code == 200
        data = json.loads(response.data)
        assert data['status'] == 'success'
        assert len(data['formulas']) == 1
        assert calls == ['N 47° 5A.BC E 006° 5D.EF']


class TestSuggestCalculationTypeChecksum:
    """Tests de la route /api/formula-solver/ai/suggest-calculation-type"""

    def test_checksum_includes_letters(self, client):
        """
        Avant le correctif, le checksum ne sommait que les chiffres ("Paris" -> 0).
        Il doit désormais aussi convertir les lettres en positions (A=1..Z=26),
        aligné sur FormulaSolverServiceImpl.calculateChecksum() (frontend widget)
        et FormulaSolverToolsManager (agent IA).
        """
        response = client.post(
            '/api/formula-solver/ai/suggest-calculation-type',
            json={'answer': 'Paris'}
        )

        assert response.status_code == 200
        data = json.loads(response.data)
        checksum_suggestion = next(s for s in data['suggestions'] if s['type'] == 'checksum')
        # P=16, A=1, R=18, I=9, S=19 => 63
        assert checksum_suggestion['result'] == 63

    def test_checksum_digits_only_unchanged(self):
        """Réponse purement numérique : comportement inchangé (somme des chiffres)."""
        from gc_backend.blueprints.formula_solver import _calculate_checksum
        assert _calculate_checksum('1867') == 1 + 8 + 6 + 7


class TestCoordinateCalculatorSecurity:
    """Tests de sécurité pour le calculateur de coordonnées"""
    
    def test_no_code_injection(self, client):
        """Test : Pas d'injection de code possible"""
        response = client.post(
            '/api/formula-solver/calculate',
            json={
                'north_formula': 'N 47° __import__("os").system("ls").00',
                'east_formula': 'E 006° 10.00',
                'values': {}
            }
        )
        
        # Ne doit pas planter mais retourner une erreur
        assert response.status_code in [400, 500]
        data = json.loads(response.data)
        assert data['status'] == 'error'
    
    def test_no_builtin_access(self, client):
        """Test : Pas d'accès aux builtins"""
        response = client.post(
            '/api/formula-solver/calculate',
            json={
                'north_formula': 'N 47° eval("1+1").00',
                'east_formula': 'E 006° 10.00',
                'values': {}
            }
        )
        
        # Ne doit pas exécuter eval
        assert response.status_code in [400, 500]
    
    def test_division_by_zero(self, client):
        """Test : Division par zéro gérée correctement"""
        response = client.post(
            '/api/formula-solver/calculate',
            json={
                'north_formula': 'N 47° (10/0).00',
                'east_formula': 'E 006° 10.00',
                'values': {}
            }
        )
        
        assert response.status_code == 400
        data = json.loads(response.data)
        assert data['status'] == 'error'
        assert 'division' in data['error'].lower() or 'zero' in data['error'].lower()


if __name__ == '__main__':
    pytest.main([__file__, '-v'])
