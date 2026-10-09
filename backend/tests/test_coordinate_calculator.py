"""
Tests unitaires pour CoordinateCalculator
"""

import pytest
from gc_backend.utils.coordinate_calculator import CoordinateCalculator


class TestCoordinateCalculator:
    """Tests du calculateur de coordonnées"""
    
    def setup_method(self):
        """Initialise le calculateur avant chaque test"""
        self.calc = CoordinateCalculator()
    
    def test_substitute_variables_simple(self):
        """Test : Substitution simple de variables"""
        formula = "N 47° 5E.AB"
        values = {'A': 3, 'B': 5, 'E': 8}
        
        result = self.calc.substitute_variables(formula, values)
        
        # Devrait donner "N 47° 58.35"
        assert '58.35' in result
    
    def test_substitute_missing_variable(self):
        """Test : Erreur si variable manquante"""
        formula = "N 47° 5A.BC"
        values = {'A': 1}  # B et C manquants
        
        with pytest.raises(ValueError, match="manquantes"):
            self.calc.substitute_variables(formula, values)
    
    def test_evaluate_simple_expression(self):
        """Test : Évaluation d'expression simple"""
        result = self.calc._safe_eval("3+5")
        assert result == 8
        
        result = self.calc._safe_eval("10-3")
        assert result == 7
        
        result = self.calc._safe_eval("4*2")
        assert result == 8
        
        result = self.calc._safe_eval("15/3")
        assert result == 5.0
    
    def test_evaluate_complex_expression(self):
        """Test : Évaluation d'expression complexe"""
        result = self.calc._safe_eval("(3+2)*4")
        assert result == 20
        
        result = self.calc._safe_eval("10 + 5 * 2")
        assert result == 20
    
    def test_evaluate_division_by_zero(self):
        """Test : Division par zéro gérée"""
        with pytest.raises(ValueError, match="Division par zéro"):
            self.calc._safe_eval("10/0")
    
    def test_evaluate_dangerous_expression(self):
        """Test : Expression dangereuse rejetée"""
        # Test injection __import__
        with pytest.raises(ValueError):
            self.calc._safe_eval("__import__('os').system('ls')")
        
        # Test eval
        with pytest.raises(ValueError):
            self.calc._safe_eval("eval('1+1')")
        
        # Test caractères invalides
        with pytest.raises(ValueError):
            self.calc._safe_eval("import os")
    
    def test_parse_coordinate_ddm(self):
        """Test : Parsing coordonnée DDM"""
        lat = self.calc._parse_coordinate("N 47° 53.900", 'N')
        assert abs(lat - 47.898333) < 0.00001
        
        lon = self.calc._parse_coordinate("E 006° 05.000", 'E')
        assert abs(lon - 6.083333) < 0.00001
    
    def test_parse_coordinate_negative(self):
        """Test : Coordonnées négatives (Sud/Ouest)"""
        lat = self.calc._parse_coordinate("S 47° 53.900", 'S')
        assert lat < 0
        
        lon = self.calc._parse_coordinate("W 006° 05.000", 'W')
        assert lon < 0

    def test_calculate_coordinates_south_west(self):
        """Test : Calcul complet en hémisphères Sud/Ouest"""
        result = self.calc.calculate_coordinates(
            north_formula="S 47° 53.900",
            east_formula="W 006° 05.000",
            values={}
        )

        assert result['status'] == 'success'
        assert result['coordinates']['latitude'] < 0
        assert result['coordinates']['longitude'] < 0
        assert result['coordinates']['ddm'].startswith('S 47° 53.900 W 006° 05.000')

    def test_parse_coordinate_french_west_cardinal(self):
        """Test : Cardinal O interprété comme Ouest"""
        lon = self.calc._parse_coordinate("O 006° 05.000", 'E')
        assert lon < 0

    def test_parse_coordinate_rejects_invalid_minutes(self):
        """Test : Les minutes DDM doivent rester entre 0 et 59.999"""
        with pytest.raises(ValueError, match="Minutes hors limites"):
            self.calc._parse_coordinate("N 47° 99.000", 'N')
    
    def test_parse_coordinate_invalid(self):
        """Test : Format invalide rejeté"""
        with pytest.raises(ValueError, match="invalide"):
            self.calc._parse_coordinate("Invalid", 'N')
    
    def test_format_ddm(self):
        """Test : Formatage en DDM"""
        result = self.calc._format_ddm(47.898333, 6.083333)
        
        assert 'N 47°' in result
        assert 'E 006°' in result
        assert '53.900' in result
        assert '05.000' in result
    
    def test_format_dms(self):
        """Test : Formatage en DMS"""
        result = self.calc._format_dms(47.898333, 6.083333)
        
        assert 'N 47°' in result
        assert 'E 006°' in result
        assert '"' in result  # Symbole des secondes
        assert '60.0"' not in result
    
    def test_calculate_distance(self):
        """Test : Calcul de distance Haversine"""
        # Distance Paris (48.8566, 2.3522) -> Lyon (45.7640, 4.8357)
        # Environ 392 km
        distance = self.calc.calculate_distance(48.8566, 2.3522, 45.7640, 4.8357)
        
        assert 390 < distance < 395  # Tolérance
    
    def test_calculate_coordinates_full(self):
        """Test : Calcul complet de coordonnées"""
        result = self.calc.calculate_coordinates(
            north_formula="N 47° 5E.AB",
            east_formula="E 006° 5C.DE",
            values={'A': 3, 'B': 5, 'C': 1, 'D': 2, 'E': 8}
        )
        
        assert result['status'] == 'success'
        assert 'coordinates' in result
        assert 'latitude' in result['coordinates']
        assert 'longitude' in result['coordinates']
        assert 'ddm' in result['coordinates']
        assert 'dms' in result['coordinates']
        assert 'decimal' in result['coordinates']
        assert 'calculation_steps' in result
    
    def test_calculate_with_parentheses(self):
        """Test : Calcul avec expressions entre parenthèses"""
        result = self.calc.calculate_coordinates(
            north_formula="N 47° (5+3).00",
            east_formula="E 006° (10-2).50",
            values={}
        )
        
        assert result['status'] == 'success'
        # (5+3) = 8, donc N 47° 08.00
        # (10-2) = 8, donc E 006° 08.50
        assert '47° 08.000' in result['coordinates']['ddm']
        assert '006° 08.500' in result['coordinates']['ddm']
    
    def test_calculate_error_missing_values(self):
        """Test : Erreur si valeurs manquantes"""
        result = self.calc.calculate_coordinates(
            north_formula="N 47° 5A.BC",
            east_formula="E 006° 5D.EF",
            values={'A': 1}  # B, C, D, E, F manquants
        )
        
        assert result['status'] == 'error'
        assert 'error' in result


    def _north(self, formula, values):
        """Calcule avec une longitude fixe et retourne le résultat complet"""
        return self.calc.calculate_coordinates(formula, "E 006° 09.123", values)

    def test_division_inside_formula_stays_integer(self):
        """Test : (A/2) s'insère comme "3", pas comme "3.0" """
        result = self._north("N 48° 41.(A/2)BC", {'A': 6, 'B': 1, 'C': 2})

        assert result['status'] == 'success'
        assert result['coordinates']['ddm'].startswith('N 48° 41.312')

    def test_non_integer_expression_rejected(self):
        """Test : une division non entière est une erreur, pas une troncature"""
        result = self._north("N 47° 53.A(B/2)C", {'A': 1, 'B': 5, 'C': 7})

        assert result['status'] == 'error'
        assert 'non entier' in result['error']

    def test_negative_expression_rejected(self):
        """Test : un résultat négatif est une erreur, pas des décimales ignorées"""
        result = self._north("N 47° 53.(A-B)CD", {'A': 2, 'B': 5, 'C': 4, 'D': 5})

        assert result['status'] == 'error'
        assert 'négatif' in result['error']

    def test_minutes_overflow_rejected(self):
        """Test : une valeur à 2 chiffres dans un emplacement de minutes est refusée"""
        result = self._north("N 47° 5A.BCD", {'A': 12, 'B': 3, 'C': 4, 'D': 5})

        assert result['status'] == 'error'
        assert 'Minutes invalides' in result['error']

    def test_decimals_overflow_rejected(self):
        """Test : plus de 3 décimales est refusé"""
        result = self._north("N 47° 53.ABC", {'A': 1, 'B': 2, 'C': 34})

        assert result['status'] == 'error'
        assert 'Décimales invalides' in result['error']

    def test_short_decimals_read_as_written(self):
        """Test : des décimales courtes gardent leur lecture décimale (.5 = .500)"""
        result = self._north("N 47° 53.(A+B)", {'A': 2, 'B': 3})

        assert result['status'] == 'success'
        assert result['coordinates']['ddm'].startswith('N 47° 53.500')

    def test_top_level_operation_evaluated(self):
        """Test : une opération hors parenthèses est évaluée par segment"""
        result = self._north("N 47° 53.A+B", {'A': 120, 'B': 3})

        assert result['status'] == 'success'
        assert result['coordinates']['ddm'].startswith('N 47° 53.123')

    def test_trailing_garbage_rejected(self):
        """Test : un reste non reconnu après la coordonnée est une erreur"""
        result = self._north("N 47° 53.123 x", {})

        assert result['status'] == 'error'

    def test_trailing_minute_mark_accepted(self):
        """Test : la marque de minutes finale est tolérée"""
        result = self._north("N 47° 53.ABC'", {'A': 1, 'B': 2, 'C': 3})

        assert result['status'] == 'success'
        assert result['coordinates']['ddm'].startswith('N 47° 53.123')

    def test_integral_float_value_accepted(self):
        """Test : une valeur 3.0 est traitée comme 3"""
        result = self._north("N 47° 53.ABC", {'A': 1.0, 'B': 2, 'C': 3})

        assert result['status'] == 'success'
        assert result['coordinates']['ddm'].startswith('N 47° 53.123')

if __name__ == '__main__':
    pytest.main([__file__, '-v'])
