class AlphaDecoderPlugin:
    """
    Plugin pour chiffrer/déchiffrer un texte en utilisant la position alphabétique.
    Mode déchiffrement : convertit les nombres en lettres (1=A, 2=B, etc)
    Mode chiffrement : convertit les lettres en nombres (A=1, B=2, etc)
    Le décalage (offset) permet de modifier la valeur de départ.
    """

    def __init__(self):
        self.name = "alpha_decoder"
        self.description = "Chiffreur/Déchiffreur alphabétique avec gestion du décalage"
        self.alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

    def decode_text(self, text: str, offset: int = 0) -> str:
        """
        Décode le texte en convertissant les nombres en lettres.
        Args:
            text (str): Texte contenant des nombres à décoder
            offset (int): Décalage à appliquer (0 = pas de décalage)
        Returns:
            str: Texte décodé
        """
        try:
            # Sépare les nombres dans le texte
            numbers = [int(num) for num in text.split() if num.isdigit()]
            
            # Applique le décalage et convertit en lettres
            decoded_chars = []
            for num in numbers:
                # Applique le décalage et gère le wrapping (26 lettres)
                adjusted_num = ((num - 1 + offset) % 26)
                decoded_chars.append(self.alphabet[adjusted_num])
            
            return ' '.join(decoded_chars)
        except Exception as e:
            return f"Erreur de décodage: {str(e)}"

    def encode_text(self, text: str, offset: int = 1) -> str:
        """
        Encode le texte en convertissant les lettres en nombres.
        Args:
            text (str): Texte à encoder
            offset (int): Décalage à appliquer (0 = pas de décalage)
        Returns:
            str: Texte encodé (nombres)
        """
        print("text", text, offset)
        try:
            encoded_nums = []
            for char in text.upper():
                if char in self.alphabet:
                    # Trouve la position (1-based) et applique le décalage
                    pos = self.alphabet.index(char)
                    adjusted_pos = ((pos + 1 - offset) % 26)
                    if adjusted_pos == 0:  # Gestion du cas Z
                        adjusted_pos = 26
                    encoded_nums.append(str(adjusted_pos))
                elif char.isspace():
                    encoded_nums.append('')
            
            return ' '.join(filter(None, encoded_nums))
        except Exception as e:
            return f"Erreur de chiffrement: {str(e)}"

    def execute(self, inputs: dict) -> dict:
        """
        Point d'entrée principal du plugin.
        Args:
            inputs (dict): Dictionnaire contenant:
                {
                    "text": "Texte à traiter",
                    "offset": 0,  # décalage (optionnel, défaut=0)
                    "mode": "encode" ou "decode"  # mode de fonctionnement
                }
        Returns:
            dict: {"encoded_text" ou "decoded_text": "résultat"}
        """
        text = inputs.get("text", "")
        offset = int(inputs.get("offset", 0))
        mode = inputs.get("mode", "decode")
        
        if mode == "encode":
            result = self.encode_text(text, offset)
            print("encode", result)
            return {"text_output": result, "mode": mode}
        else:  # mode == "decode"
            result = self.decode_text(text, offset)
            print("decode", result)
            return {"text_output": result, "mode": mode}
