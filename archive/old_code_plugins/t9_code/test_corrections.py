#!/usr/bin/env python3
"""
Script de test pour vérifier les corrections du plugin T9
"""

import sys
import os

# Ajouter le répertoire parent au path pour les imports
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', '..'))

from plugins.official.t9_code.main import T9CodePlugin

def test_t9_corrections():
    """Teste les corrections apportées au plugin T9"""
    plugin = T9CodePlugin()
    
    print("=== Tests des Corrections du Plugin T9 ===\n")
    
    # Test 1: Mot simple "ami" = 264 (doit être en premier avec haute confiance)
    print("Test 1: Mot simple 'ami' (264)")
    result = plugin.execute({"text": "264", "mode": "decode", "language": "fr"})
    print(f"  Status: {result['status']}")
    print(f"  Message: {result['summary']['message']}")
    if result['results']:
        first_result = result['results'][0]
        print(f"  Premier résultat: '{first_result['text_output']}'")
        print(f"  Confiance: {first_result['confidence']:.2f}")
        print(f"  Langue détectée: {first_result['metadata']['detected_language']}")
        
        # Vérifier que "AMI" est bien en premier
        if first_result['text_output'].upper() == 'AMI':
            print("  ✅ SUCCÈS: 'AMI' est bien en premier")
        else:
            print("  ❌ ÉCHEC: 'AMI' n'est pas en premier")
    else:
        print("  ❌ ÉCHEC: Aucun résultat trouvé")
    print()
    
    # Test 2: Deux mots "cher ami" = 24370264 (doit être traité mot par mot)
    print("Test 2: Deux mots 'cher ami' (24370264)")
    result = plugin.execute({"text": "24370264", "mode": "decode", "language": "fr"})
    print(f"  Status: {result['status']}")
    print(f"  Message: {result['summary']['message']}")
    if result['results']:
        first_result = result['results'][0]
        print(f"  Premier résultat: '{first_result['text_output']}'")
        print(f"  Confiance: {first_result['confidence']:.2f}")
        print(f"  Nombre de mots: {first_result['metadata']['word_count']}")
        
        # Vérifier que "CHER AMI" est bien trouvé
        if 'CHER' in first_result['text_output'].upper() and 'AMI' in first_result['text_output'].upper():
            print("  ✅ SUCCÈS: 'CHER AMI' est bien trouvé")
        else:
            print("  ❌ ÉCHEC: 'CHER AMI' n'est pas trouvé")
    else:
        print("  ❌ ÉCHEC: Aucun résultat trouvé")
    print()
    
    # Test 3: Vérifier que les scores ne sont pas tous à 30%
    print("Test 3: Vérification des scores différenciés")
    result = plugin.execute({"text": "264", "mode": "decode", "language": "fr", "max_results": 5})
    print(f"  Status: {result['status']}")
    if result['results']:
        print("  Scores des 5 premiers résultats:")
        for i, res in enumerate(result['results'][:5]):
            print(f"    {i+1}. '{res['text_output']}': {res['confidence']:.2f}")
        
        # Vérifier qu'il y a des scores différents
        scores = [res['confidence'] for res in result['results'][:5]]
        if len(set(scores)) > 1:
            print("  ✅ SUCCÈS: Les scores sont différenciés")
        else:
            print("  ❌ ÉCHEC: Tous les scores sont identiques")
    else:
        print("  ❌ ÉCHEC: Aucun résultat trouvé")
    print()
    
    # Test 4: Test avec espaces multiples
    print("Test 4: Espaces multiples 'bon jour' (266 5687)")
    result = plugin.execute({"text": "26605687", "mode": "decode", "language": "fr"})
    print(f"  Status: {result['status']}")
    print(f"  Message: {result['summary']['message']}")
    if result['results']:
        first_result = result['results'][0]
        print(f"  Premier résultat: '{first_result['text_output']}'")
        print(f"  Confiance: {first_result['confidence']:.2f}")
        
        if 'BON' in first_result['text_output'].upper() and 'JOUR' in first_result['text_output'].upper():
            print("  ✅ SUCCÈS: 'BON JOUR' est bien traité")
        else:
            print("  ❌ ÉCHEC: 'BON JOUR' n'est pas traité correctement")
    else:
        print("  ❌ ÉCHEC: Aucun résultat trouvé")
    print()
    
    # Test 5: Encodage
    print("Test 5: Encodage")
    test_words = ["AMI", "CHER", "BONJOUR", "HELLO"]
    for word in test_words:
        result = plugin.execute({"text": word, "mode": "encode"})
        if result['results']:
            encoded = result['results'][0]['text_output']
            print(f"  '{word}' -> '{encoded}'")
        else:
            print(f"  ❌ ÉCHEC: Impossible d'encoder '{word}'")
    print()
    
    # Test 6: Mots prioritaires
    print("Test 6: Vérification des mots prioritaires")
    priority_tests = [
        ("264", "AMI"),  # ami
        ("2437", "CHER"),  # cher
        ("266", "BON"),  # bon
        ("684", "OUI"),  # oui
        ("666", "NON"),  # non
    ]
    
    for code, expected_word in priority_tests:
        result = plugin.execute({"text": code, "mode": "decode", "language": "fr"})
        if result['results']:
            first_word = result['results'][0]['text_output'].upper()
            confidence = result['results'][0]['confidence']
            if first_word == expected_word and confidence > 0.8:
                print(f"  ✅ '{code}' -> '{first_word}' (confiance: {confidence:.2f})")
            else:
                print(f"  ⚠️  '{code}' -> '{first_word}' (attendu: '{expected_word}', confiance: {confidence:.2f})")
        else:
            print(f"  ❌ '{code}' -> Aucun résultat")
    print()
    
    print("=== Tests terminés ===")

if __name__ == "__main__":
    test_t9_corrections() 