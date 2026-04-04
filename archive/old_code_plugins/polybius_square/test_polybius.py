#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Test du plugin Polybius Square avec les nouvelles fonctionnalités:
- Support des grilles 5x5 et 6x6
- Différents modes d'alphabet (I=J, C=K, W=VV)
- Formats de sortie (numbers, coordinates)
"""

import sys
import os
import unittest
import re

# Ajouter le répertoire parent au path pour pouvoir importer le plugin
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))))

# Importer directement depuis le fichier main.py
from plugins.official.polybius_square.main import PolybiusSquarePlugin

class TestPolybiusSquare(unittest.TestCase):
    """Tests pour le plugin Polybius Square avec ses nouvelles fonctionnalités."""
    
    def setUp(self):
        """Initialisation des tests."""
        self.plugin = PolybiusSquarePlugin()
    
    def test_create_grid_5x5_i_equals_j(self):
        """Test de création d'une grille 5x5 avec I=J."""
        grid_data = self.plugin.create_polybius_grid(grid_size="5x5", alphabet_mode="I=J")
        grid = grid_data["grid"]
        
        # Vérifier la dimension de la grille
        self.assertEqual(len(grid), 5)
        for row in grid:
            self.assertEqual(len(row), 5)
        
        # Vérifier que I et J sont fusionnés
        coords_to_char = grid_data["coords_to_char"]
        i_coord = None
        for coord, char in coords_to_char.items():
            if char == "I":
                i_coord = coord
                break
        
        # Vérifier que J n'est pas dans la grille
        j_present = False
        for char in coords_to_char.values():
            if char == "J":
                j_present = True
                break
        
        self.assertIsNotNone(i_coord, "I devrait être présent dans la grille")
        self.assertFalse(j_present, "J ne devrait pas être présent dans la grille")
    
    def test_create_grid_5x5_c_equals_k(self):
        """Test de création d'une grille 5x5 avec C=K."""
        grid_data = self.plugin.create_polybius_grid(grid_size="5x5", alphabet_mode="C=K")
        grid = grid_data["grid"]
        
        # Vérifier la dimension de la grille
        self.assertEqual(len(grid), 5)
        for row in grid:
            self.assertEqual(len(row), 5)
        
        # Vérifier que C et K sont fusionnés
        coords_to_char = grid_data["coords_to_char"]
        c_coord = None
        for coord, char in coords_to_char.items():
            if char == "C":
                c_coord = coord
                break
        
        # Vérifier que K n'est pas dans la grille
        k_present = False
        for char in coords_to_char.values():
            if char == "K":
                k_present = True
                break
        
        self.assertIsNotNone(c_coord, "C devrait être présent dans la grille")
        self.assertFalse(k_present, "K ne devrait pas être présent dans la grille")
    
    def test_create_grid_5x5_w_equals_vv(self):
        """Test de création d'une grille 5x5 avec W=VV."""
        grid_data = self.plugin.create_polybius_grid(grid_size="5x5", alphabet_mode="W=VV")
        grid = grid_data["grid"]
        
        # Vérifier la dimension de la grille
        self.assertEqual(len(grid), 5)
        for row in grid:
            self.assertEqual(len(row), 5)
        
        # Vérifier que W n'est pas dans la grille
        w_present = False
        for char in grid_data["coords_to_char"].values():
            if char == "W":
                w_present = True
                break
        
        # Vérifier que V est présent
        v_present = False
        for char in grid_data["coords_to_char"].values():
            if char == "V":
                v_present = True
                break
        
        self.assertFalse(w_present, "W ne devrait pas être présent dans la grille")
        self.assertTrue(v_present, "V devrait être présent dans la grille")
    
    def test_create_grid_6x6(self):
        """Test de création d'une grille 6x6 avec chiffres."""
        grid_data = self.plugin.create_polybius_grid(grid_size="6x6")
        grid = grid_data["grid"]
        
        # Vérifier la dimension de la grille
        self.assertEqual(len(grid), 6)
        for row in grid:
            self.assertEqual(len(row), 6)
        
        # Vérifier que les 26 lettres et 10 chiffres sont présents
        chars = set(grid_data["coords_to_char"].values())
        
        # Vérifier les lettres
        for letter in "ABCDEFGHIJKLMNOPQRSTUVWXYZ":
            self.assertIn(letter, chars, f"La lettre {letter} devrait être présente dans la grille 6x6")
        
        # Vérifier les chiffres
        for digit in "0123456789":
            self.assertIn(digit, chars, f"Le chiffre {digit} devrait être présent dans la grille 6x6")
        
        # Vérifier qu'il y a exactement 36 caractères
        self.assertEqual(len(chars), 36, "La grille 6x6 devrait contenir 36 caractères uniques")
    
    def test_encode_decode_5x5_i_equals_j(self):
        """Test d'encodage et décodage avec grille 5x5 et I=J."""
        text = "HELLO WORLD"
        key = "SECRET"
        
        # Encoder
        encoded = self.plugin.encode(text, key, "numbers", "5x5", "I=J")
        
        # Décoder
        decoded = self.plugin.decode(encoded, key, "5x5", "I=J")
        
        # Normaliser le résultat (I et J sont équivalents)
        normalized_decoded = decoded.replace("J", "I")
        normalized_original = text.replace("J", "I")
        
        self.assertEqual(normalized_decoded, normalized_original)
    
    def test_encode_decode_5x5_c_equals_k(self):
        """Test d'encodage et décodage avec grille 5x5 et C=K."""
        text = "PACK YOUR BAGS"
        key = "CIPHER"
        
        # Encoder
        encoded = self.plugin.encode(text, key, "numbers", "5x5", "C=K")
        
        # Décoder
        decoded = self.plugin.decode(encoded, key, "5x5", "C=K")
        
        # Normaliser le résultat (C et K sont équivalents)
        normalized_decoded = decoded.replace("K", "C")
        normalized_original = text.replace("K", "C")
        
        self.assertEqual(normalized_decoded, normalized_original)
    
    def test_encode_decode_5x5_w_equals_vv(self):
        """Test d'encodage et décodage avec grille 5x5 et W=VV."""
        text = "WELCOME TO THE WORLD"
        key = "KEYWORD"
        
        # Encoder
        encoded = self.plugin.encode(text, key, "numbers", "5x5", "W=VV")
        
        # Décoder
        decoded = self.plugin.decode(encoded, key, "5x5", "W=VV")
        
        # Dans ce cas, W est encodé comme VV, donc le décodage devrait restaurer W
        self.assertEqual(decoded, text)
    
    def test_encode_decode_6x6(self):
        """Test d'encodage et décodage avec grille 6x6."""
        text = "HELLO WORLD 123"
        key = "SECRET123"
        
        # Encoder
        encoded = self.plugin.encode(text, key, "numbers", "6x6")
        
        # Décoder
        decoded = self.plugin.decode(encoded, key, "6x6")
        
        self.assertEqual(decoded, text)
    
    def test_format_coordinates(self):
        """Test du formatage des coordonnées."""
        # Format numbers
        self.assertEqual(self.plugin.format_coordinates(1, 1, "numbers"), "11")
        self.assertEqual(self.plugin.format_coordinates(5, 5, "numbers"), "55")
        self.assertEqual(self.plugin.format_coordinates(6, 6, "numbers"), "66")
        
        # Format coordinates
        self.assertEqual(self.plugin.format_coordinates(1, 1, "coordinates"), "(1,1)")
        self.assertEqual(self.plugin.format_coordinates(5, 5, "coordinates"), "(5,5)")
        self.assertEqual(self.plugin.format_coordinates(6, 6, "coordinates"), "(6,6)")
    
    def test_decode_coordinates(self):
        """Test du décodage des coordonnées."""
        # Format numbers
        self.assertEqual(self.plugin.decode_coordinates("11", 5), [(1, 1)])
        self.assertEqual(self.plugin.decode_coordinates("1122", 5), [(1, 1), (2, 2)])
        self.assertEqual(self.plugin.decode_coordinates("66", 6), [(6, 6)])
        
        # Format coordinates
        self.assertEqual(self.plugin.decode_coordinates("(1,1)", 5), [(1, 1)])
        self.assertEqual(self.plugin.decode_coordinates("(1,1)(2,2)", 5), [(1, 1), (2, 2)])
        self.assertEqual(self.plugin.decode_coordinates("(6,6)", 6), [(6, 6)])
        
        # Coordonnées invalides pour la taille de grille
        self.assertEqual(self.plugin.decode_coordinates("66", 5), [])
        self.assertEqual(self.plugin.decode_coordinates("(6,6)", 5), [])
    
    def test_check_code(self):
        """Test de la détection de code Polybe."""
        # Format numbers
        result = self.plugin.check_code("11 22 33 44", True, grid_size="5x5")
        self.assertTrue(result["is_match"])
        
        # Format coordinates
        result = self.plugin.check_code("(1,1)(2,2)(3,3)", True, grid_size="5x5")
        self.assertTrue(result["is_match"])
        
        # Grille 6x6
        result = self.plugin.check_code("11 22 33 44 55 66", True, grid_size="6x6")
        self.assertTrue(result["is_match"])
        
        # Coordonnées invalides pour la taille de grille
        result = self.plugin.check_code("66", True, grid_size="5x5")
        self.assertFalse(result["is_match"])
    
    def test_decode_fragments(self):
        """Test du décodage de fragments."""
        # Créer une grille pour tester
        grid_data = self.plugin.create_polybius_grid("KEY", "5x5", "I=J")
        
        # Créer des fragments simulés
        fragments = [
            {"coords": [(1, 1), (2, 2)], "start": 0, "end": 4, "value": "1122", "type": "numbers"},
            {"coords": [(3, 3), (4, 4)], "start": 6, "end": 10, "value": "3344", "type": "numbers"}
        ]
        
        # Texte original avec fragments
        text = "1122 - 3344"
        
        # Décoder les fragments
        decoded = self.plugin.decode_fragments(text, fragments, "KEY", "5x5", "I=J")
        
        # Vérifier que seuls les fragments ont été décodés
        self.assertNotEqual(decoded, text)
        self.assertEqual(len(decoded), len(text))
        
        # Vérifier que le séparateur est préservé (peut contenir des espaces autour)
        self.assertTrue(" - " in decoded or "-" in decoded)
        
        # Vérifier que les fragments ont été remplacés par des caractères
        self.assertNotEqual(decoded[0:4], "1122")
        self.assertNotEqual(decoded[6:10], "3344")
    
    def test_execute_encode(self):
        """Test de la méthode execute en mode encode."""
        inputs = {
            "mode": "encode",
            "text": "HELLO WORLD",
            "key": "SECRET",
            "grid_size": "5x5",
            "alphabet_mode": "I=J",
            "output_format": "numbers"
        }
        
        result = self.plugin.execute(inputs)
        
        self.assertEqual(result["status"], "success")
        self.assertEqual(result["summary"]["total_results"], 1)
        self.assertIsNotNone(result["results"][0]["text_output"])
        
    def test_execute_decode(self):
        """Test de la méthode execute en mode decode."""
        # Préparer les entrées
        inputs = {
            "mode": "decode",
            "text": "11223344",
            "key": "",
            "grid_size": "5x5",
            "alphabet_mode": "I=J",
            "strict": "strict"
        }
        
        # Exécuter le plugin
        result = self.plugin.execute(inputs)
        
        # Vérifier le résultat
        self.assertEqual(result["status"], "success")
        self.assertEqual(len(result["results"]), 1)
        self.assertIsNotNone(result["results"][0]["text_output"])
    

    
    def test_execute_decode_with_encoded_text(self):
        """Test de la méthode execute en mode decode avec un texte encodé."""
        # D'abord encoder un texte
        encoded = self.plugin.encode("HELLO", "KEY", "numbers", "5x5", "I=J")
        
        inputs = {
            "mode": "decode",
            "text": encoded,
            "key": "KEY",
            "grid_size": "5x5",
            "alphabet_mode": "I=J",
            "strict": "strict"
        }
        
        result = self.plugin.execute(inputs)
        
        self.assertEqual(result["status"], "success")
        self.assertEqual(result["summary"]["total_results"], 1)
        self.assertEqual(result["results"][0]["text_output"], "HELLO")

if __name__ == "__main__":
    unittest.main()
