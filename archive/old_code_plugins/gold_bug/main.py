from substitution_base import SubstitutionPluginBase

class GoldBugPlugin(SubstitutionPluginBase):
    def __init__(self):
        super().__init__("gold_bug")
        # Table de substitution standard du chiffre du Scarabée d'or (Gold-Bug)
        gold_bug_table = {
            'A': '5', 'B': '2', 'C': '-', 'D': '†', 'E': '8', 'F': '1', 'G': '3', 'H': '4',
            'I': '6', 'J': ',', 'K': '7', 'L': '0', 'M': '9', 'N': '*', 'O': '‡', 'P': '.',
            'Q': '$', 'R': '(', 'S': ')', 'T': ';', 'U': '?', 'V': '¶', 'W': ']', 'X': '¢',
            'Y': ':', 'Z': '['
        }
        self.set_substitution_tables(gold_bug_table)
        self.default_separators = " \t\r\n"  # Séparateurs pour les symboles

def execute(inputs: dict) -> dict:
    plugin = GoldBugPlugin()
    return plugin.execute(inputs) 