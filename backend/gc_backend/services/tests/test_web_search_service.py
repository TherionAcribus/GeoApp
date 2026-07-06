"""
Tests unitaires pour WebSearchService : garde SSRF de fetch_page() et cache de search()
"""

import pytest

from gc_backend.services.web_search_service import (
    WebSearchService,
    _is_forbidden_host,
    _is_allowed_url,
)


class TestIsForbiddenHost:
    """Tests de _is_forbidden_host() : résolution + filtrage IP privée/loopback/link-local"""

    def test_loopback_literal_ip_is_forbidden(self):
        assert _is_forbidden_host('127.0.0.1') is True

    def test_localhost_hostname_is_forbidden(self):
        assert _is_forbidden_host('localhost') is True

    def test_private_network_ip_is_forbidden(self):
        assert _is_forbidden_host('192.168.1.1') is True
        assert _is_forbidden_host('10.0.0.5') is True
        assert _is_forbidden_host('172.16.0.1') is True

    def test_link_local_ip_is_forbidden(self):
        assert _is_forbidden_host('169.254.1.1') is True

    def test_empty_hostname_is_forbidden(self):
        assert _is_forbidden_host('') is True

    def test_public_ip_is_allowed(self):
        # 8.8.8.8 (DNS public Google) : adresse publique, ne doit pas être bloquée.
        assert _is_forbidden_host('8.8.8.8') is False

    def test_unresolvable_hostname_is_not_forbidden_here(self):
        # La résolution DNS échoue : on laisse la requête HTTP échouer naturellement
        # plus loin (ce n'est pas le rôle de ce filtre de valider l'existence du domaine).
        assert _is_forbidden_host('this-domain-does-not-exist-geoapp-test.invalid') is False


class TestIsAllowedUrl:
    """Tests de _is_allowed_url() : schéma + hôte"""

    def test_rejects_non_http_scheme(self):
        assert _is_allowed_url('ftp://8.8.8.8/file') is False
        assert _is_allowed_url('file:///etc/passwd') is False

    def test_rejects_private_host(self):
        assert _is_allowed_url('http://127.0.0.1/admin') is False
        assert _is_allowed_url('http://192.168.1.1/') is False
        assert _is_allowed_url('http://localhost:8000/api') is False

    def test_allows_public_https_url(self):
        assert _is_allowed_url('https://8.8.8.8/') is True


class TestFetchPageSSRFGuard:
    """Tests d'intégration légers de fetch_page() : le blocage intervient avant toute requête HTTP"""

    def test_fetch_page_blocks_loopback(self):
        service = WebSearchService()
        result = service.fetch_page('http://127.0.0.1/admin')
        assert result['status'] == 'error'
        assert 'interdit' in result['error'].lower() or 'refusée' in result['error'].lower()

    def test_fetch_page_blocks_private_network(self):
        service = WebSearchService()
        result = service.fetch_page('http://192.168.1.1/')
        assert result['status'] == 'error'

    def test_fetch_page_rejects_invalid_scheme(self):
        service = WebSearchService()
        result = service.fetch_page('ftp://example.com/file')
        assert result['status'] == 'error'
        assert 'http' in result['error'].lower()


class TestSearchCache:
    """Tests du cache TTL de search() : évite de re-solliciter DuckDuckGo pour une requête identique"""

    def test_identical_query_hits_cache(self, monkeypatch):
        """Deux appels identiques ne doivent déclencher qu'une seule recherche DDG réelle."""
        service = WebSearchService()

        call_count = {'n': 0}

        def fake_search_ddgs(query, max_results=5):
            call_count['n'] += 1
            return [{'text': f'answer for {query}', 'source': 'x', 'score': 0.9, 'type': 'snippet'}]

        monkeypatch.setattr(service, '_search_ddgs', fake_search_ddgs)
        monkeypatch.setattr('gc_backend.services.web_search_service.HAS_DDG_SEARCH', True)

        first = service.search('quelle est la capitale de la France', context=None, max_results=5)
        second = service.search('quelle est la capitale de la France', context=None, max_results=5)

        assert call_count['n'] == 1, "le second appel identique aurait dû être servi depuis le cache"
        assert first == second

    def test_different_query_misses_cache(self, monkeypatch):
        service = WebSearchService()

        call_count = {'n': 0}

        def fake_search_ddgs(query, max_results=5):
            call_count['n'] += 1
            return [{'text': f'answer for {query}', 'source': 'x', 'score': 0.9, 'type': 'snippet'}]

        monkeypatch.setattr(service, '_search_ddgs', fake_search_ddgs)
        monkeypatch.setattr('gc_backend.services.web_search_service.HAS_DDG_SEARCH', True)

        service.search('question A', context=None, max_results=5)
        service.search('question B', context=None, max_results=5)

        assert call_count['n'] == 2

    def test_expired_cache_entry_triggers_new_search(self, monkeypatch):
        """Une entrée expirée (TTL dépassé) ne doit plus être servie depuis le cache."""
        service = WebSearchService()
        service._CACHE_TTL_SECONDS = 0  # expire immédiatement

        call_count = {'n': 0}

        def fake_search_ddgs(query, max_results=5):
            call_count['n'] += 1
            return [{'text': 'ok', 'source': 'x', 'score': 0.9, 'type': 'snippet'}]

        monkeypatch.setattr(service, '_search_ddgs', fake_search_ddgs)
        monkeypatch.setattr('gc_backend.services.web_search_service.HAS_DDG_SEARCH', True)

        service.search('question', context=None, max_results=5)
        service.search('question', context=None, max_results=5)

        assert call_count['n'] == 2, "le TTL expiré aurait dû invalider le cache"

    def test_cache_returns_a_copy_not_shared_reference(self, monkeypatch):
        """Muter le résultat retourné ne doit pas corrompre l'entrée en cache."""
        service = WebSearchService()

        def fake_search_ddgs(query, max_results=5):
            return [{'text': 'ok', 'source': 'x', 'score': 0.9, 'type': 'snippet'}]

        monkeypatch.setattr(service, '_search_ddgs', fake_search_ddgs)
        monkeypatch.setattr('gc_backend.services.web_search_service.HAS_DDG_SEARCH', True)

        first = service.search('question', context=None, max_results=5)
        first.append({'text': 'injected', 'source': 'x', 'score': 0.1, 'type': 'snippet'})

        second = service.search('question', context=None, max_results=5)
        assert len(second) == 1, "la mutation de la première liste ne doit pas affecter le cache"


if __name__ == '__main__':
    pytest.main([__file__, '-v'])
