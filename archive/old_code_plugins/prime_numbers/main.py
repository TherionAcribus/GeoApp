from substitution_base import SubstitutionPluginBase

class PrimeNumbersPlugin(SubstitutionPluginBase):
    def __init__(self):
        super().__init__("prime_numbers")
        prime_table = {
            'A': '2', 'B': '3', 'C': '5', 'D': '7', 'E': '11', 'F': '13', 'G': '17',
            'H': '19', 'I': '23', 'J': '29', 'K': '31', 'L': '37', 'M': '41', 'N': '43',
            'O': '47', 'P': '53', 'Q': '59', 'R': '61', 'S': '67', 'T': '71', 'U': '73',
            'V': '79', 'W': '83', 'X': '89', 'Y': '97', 'Z': '101'
        }
        self.set_substitution_tables(prime_table)
        self.default_separators = " ,;\t\r\n"  # Séparateurs pour les nombres

def execute(inputs: dict) -> dict:
    plugin = PrimeNumbersPlugin()
    return plugin.execute(inputs) 