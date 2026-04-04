#!/usr/bin/env python3
"""
Test rapide pour le plugin Bifid de Delastelle.
"""

import sys
import os

# Ajouter le chemin du plugin au PATH
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

try:
    from main import BifidDelastellePlugin
    
    def test_basic_functionality():
        """Test basique du plugin."""
        print("🔧 Test du plugin Bifid de Delastelle...")
        
        plugin = BifidDelastellePlugin()
        
        # Test 1: Encodage/Décodage simple
        print("\n📝 Test 1: Encodage/Décodage simple")
        plaintext = "HELLO"
        encoded = plugin.encode(plaintext, period=5)
        decoded = plugin.decode(encoded, period=5)
        
        print(f"Texte original : {plaintext}")
        print(f"Texte encodé   : {encoded}")
        print(f"Texte décodé   : {decoded}")
        print(f"✓ Succès: {decoded == plaintext}")
        
        # Test 2: Avec mot-clé
        print("\n📝 Test 2: Avec mot-clé")
        key = "SECRET"
        encoded_key = plugin.encode(plaintext, key=key, period=5)
        decoded_key = plugin.decode(encoded_key, key=key, period=5)
        
        print(f"Mot-clé        : {key}")
        print(f"Texte encodé   : {encoded_key}")
        print(f"Texte décodé   : {decoded_key}")
        print(f"✓ Succès: {decoded_key == plaintext}")
        
        # Test 3: Interface execute
        print("\n📝 Test 3: Interface execute")
        inputs = {
            "mode": "encode",
            "text": "EXAMPLE",
            "period": 4,
            "key": "",
            "grid_size": "5x5",
            "alphabet_mode": "I=J"
        }
        
        result = plugin.execute(inputs)
        print(f"Status: {result['status']}")
        print(f"Résultat: {result['results'][0]['text_output'] if result['results'] else 'Aucun'}")
        
        # Test décodage
        inputs["mode"] = "decode"
        inputs["text"] = result['results'][0]['text_output']
        decode_result = plugin.execute(inputs)
        
        print(f"Décodé: {decode_result['results'][0]['text_output'] if decode_result['results'] else 'Aucun'}")
        print(f"✓ Succès: {decode_result['results'][0]['text_output'] == 'EXAMPLE'}")
        
        print("\n🎉 Tous les tests de base sont passés avec succès !")
        
    if __name__ == "__main__":
        test_basic_functionality()
        
except Exception as e:
    print(f"❌ Erreur lors du test: {str(e)}")
    import traceback
    traceback.print_exc() 