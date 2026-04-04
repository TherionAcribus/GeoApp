"""
Tests pour le plugin Bifid de Delastelle.
"""

import unittest
import sys
import os

# Ajouter le chemin du plugin au PATH
plugin_dir = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, plugin_dir)

from main import BifidDelastellePlugin


class TestBifidDelastelle(unittest.TestCase):
    """Tests pour le chiffre bifide de Delastelle."""
    
    def setUp(self):
        """Initialisation avant chaque test."""
        self.plugin = BifidDelastellePlugin()
    
    def test_encode_decode_simple(self):
        """Test d'encodage et décodage simple."""
        plaintext = "HELLO"
        
        # Encodage
        encoded = self.plugin.encode(plaintext, period=5)
        self.assertIsInstance(encoded, str)
        self.assertNotEqual(encoded, plaintext)
        
        # Décodage
        decoded = self.plugin.decode(encoded, period=5)
        self.assertEqual(decoded, plaintext)
    
    def test_encode_decode_with_key(self):
        """Test avec mot-clé."""
        plaintext = "ATTACKATDAWN"
        key = "SECRET"
        
        encoded = self.plugin.encode(plaintext, key=key, period=6)
        decoded = self.plugin.decode(encoded, key=key, period=6)
        
        self.assertEqual(decoded, plaintext)
    
    def test_different_periods(self):
        """Test avec différentes périodes."""
        plaintext = "THEMESSAGEISLONG"
        
        for period in [3, 4, 5, 8]:
            with self.subTest(period=period):
                encoded = self.plugin.encode(plaintext, period=period)
                decoded = self.plugin.decode(encoded, period=period)
                self.assertEqual(decoded, plaintext)
    
    def test_grid_6x6(self):
        """Test avec grille 6x6."""
        plaintext = "HELLO123"
        
        encoded = self.plugin.encode(plaintext, grid_size="6x6", period=4)
        decoded = self.plugin.decode(encoded, grid_size="6x6", period=4)
        
        self.assertEqual(decoded, plaintext)
    
    def test_alphabet_modes(self):
        """Test des différents modes d'alphabet."""
        plaintext = "HIJKLMNOP"
        
        for mode in ["I=J", "C=K", "W=VV"]:
            with self.subTest(alphabet_mode=mode):
                encoded = self.plugin.encode(plaintext, alphabet_mode=mode, period=5)
                decoded = self.plugin.decode(encoded, alphabet_mode=mode, period=5)
                
                # Pour I=J, le J devient I
                if mode == "I=J":
                    expected = plaintext.replace("J", "I")
                # Pour C=K, le K devient C
                elif mode == "C=K":
                    expected = plaintext.replace("K", "C")
                else:
                    expected = plaintext
                
                self.assertEqual(decoded, expected)
    
    def test_coordinate_order(self):
        """Test de l'ordre des coordonnées."""
        plaintext = "EXAMPLE"
        
        # Ordre ligne-colonne (par défaut)
        encoded_lc = self.plugin.encode(plaintext, coordinate_order="ligne-colonne", period=4)
        decoded_lc = self.plugin.decode(encoded_lc, coordinate_order="ligne-colonne", period=4)
        
        # Ordre colonne-ligne
        encoded_cl = self.plugin.encode(plaintext, coordinate_order="colonne-ligne", period=4)
        decoded_cl = self.plugin.decode(encoded_cl, coordinate_order="colonne-ligne", period=4)
        
        self.assertEqual(decoded_lc, plaintext)
        self.assertEqual(decoded_cl, plaintext)
        self.assertNotEqual(encoded_lc, encoded_cl)  # Les résultats doivent être différents
    
    def test_empty_text(self):
        """Test avec texte vide."""
        result = self.plugin.encode("")
        self.assertEqual(result, "")
        
        result = self.plugin.decode("")
        self.assertEqual(result, "")
    
    def test_special_characters(self):
        """Test avec caractères spéciaux (doivent être ignorés)."""
        plaintext = "HELLO WORLD!"
        
        encoded = self.plugin.encode(plaintext, period=5)
        decoded = self.plugin.decode(encoded, period=5)
        
        # Les espaces et caractères spéciaux doivent être supprimés
        self.assertEqual(decoded, "HELLOWORLD")
    
    def test_check_code(self):
        """Test de la fonction de détection de code."""
        # Texte valide (lettres uniquement)
        result = self.plugin.check_code("ABCDEFGH")
        self.assertTrue(result["is_match"])
        self.assertGreater(result["score"], 0.5)
        
        # Texte invalide (beaucoup de chiffres)
        result = self.plugin.check_code("12345678")
        self.assertFalse(result["is_match"])
        
        # Texte mixte
        result = self.plugin.check_code("ABC123DEF")
        self.assertIsInstance(result["score"], float)
    
    def test_execute_interface(self):
        """Test de l'interface execute standardisée."""
        inputs = {
            "mode": "encode",
            "text": "HELLO",
            "period": 5,
            "key": "",
            "grid_size": "5x5",
            "alphabet_mode": "I=J",
            "coordinate_order": "ligne-colonne"
        }
        
        result = self.plugin.execute(inputs)
        
        # Vérifier la structure de la réponse
        self.assertEqual(result["status"], "success")
        self.assertIn("plugin_info", result)
        self.assertIn("results", result)
        self.assertIn("summary", result)
        
        # Vérifier qu'il y a un résultat
        self.assertEqual(len(result["results"]), 1)
        self.assertIn("text_output", result["results"][0])
        
        # Test décodage
        inputs["mode"] = "decode"
        inputs["text"] = result["results"][0]["text_output"]
        
        decode_result = self.plugin.execute(inputs)
        self.assertEqual(decode_result["status"], "success")
        self.assertEqual(decode_result["results"][0]["text_output"], "HELLO")
    
    def test_known_example(self):
        """Test avec un exemple connu du chiffre bifide."""
        # Exemple simplifié pour validation
        plaintext = "ABC"
        key = ""
        period = 3
        
        # Test que l'encodage/décodage est cohérent
        encoded = self.plugin.encode(plaintext, key=key, period=period)
        decoded = self.plugin.decode(encoded, key=key, period=period)
        
        self.assertEqual(decoded, plaintext)


def run_tests():
    """Lance tous les tests."""
    unittest.main(verbosity=2)


if __name__ == "__main__":
    run_tests() 