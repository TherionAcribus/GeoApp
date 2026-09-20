"""
Configuration globale pytest pour les tests gc-backend.

Ce fichier configure l'environnement de test :
- Désactive la découverte automatique des plugins pendant les tests
- Configure les fixtures globales
"""
import os
import pytest


@pytest.fixture(scope='session', autouse=True)
def disable_plugin_discovery():
    """
    Désactive la découverte automatique des plugins pendant les tests.
    
    Les tests créent leurs propres fixtures de plugins et ne doivent pas
    être pollués par les plugins réels du système.
    """
    os.environ['TESTING'] = '1'
    yield
    del os.environ['TESTING']


@pytest.fixture(autouse=True)
def clear_user_token_cache():
    """
    Le cache des userToken est partagé au niveau module (le client est recréé
    à chaque requête) : on le vide entre les tests pour qu'un token « caché »
    par un test ne soit pas servi au suivant, dont la session est un faux
    objet différent.
    """
    from gc_backend.services.geocaching_logs import _USER_TOKEN_CACHE

    _USER_TOKEN_CACHE.clear()
    yield
    _USER_TOKEN_CACHE.clear()
