from __future__ import annotations

import math
import re
import time
import unicodedata
from typing import Any, Dict, List, Optional, Tuple

try:
    from gc_backend.plugins.code_solving import parse_bool
except ImportError:
    import sys as _sys, pathlib as _pathlib
    _sys.path.insert(0, str(_pathlib.Path(__file__).resolve().parents[3] / "backend"))
    from gc_backend.plugins.code_solving import parse_bool


class VicCipherPlugin:
    """Practical VIC cipher helper.

    This implements the reproducible parts of the public VIC description:
    key schedule, straddling checkerboard, standard columnar transposition,
    and a reversible double-columnar mode. The historic disrupted diagonal
    transposition is intentionally not emulated here.
    """

    def __init__(self) -> None:
        self.name = "vic_cipher"
        self.version = "1.0.0"

    def execute(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        start_time = time.time()

        text = inputs.get("text", "")
        mode = str(inputs.get("mode", "decode")).lower()
        cipher_variant = str(inputs.get("cipher_variant", "simple")).lower()

        if not isinstance(text, str) or not text.strip():
            return self._error_response("Aucun texte fourni", start_time)

        if mode == "detect":
            return self._detect_response(text, start_time)

        if cipher_variant in {"simple", "dcode", "cachesleuth"}:
            return self._execute_simple(inputs, start_time)

        if cipher_variant not in {"historic_schedule", "historical", "full"}:
            return self._error_response("Variante VIC inconnue", start_time)

        phrase = str(inputs.get("phrase", "") or "")
        date = str(inputs.get("date", "") or "")
        keygroup = str(inputs.get("keygroup", "") or "")
        personal_number_raw = inputs.get("personal_number", 0)
        checkerboard_mnemonic = str(inputs.get("checkerboard_mnemonic", "AT ONE SIR") or "AT ONE SIR")
        transposition_mode = str(inputs.get("transposition_mode", "double")).lower()
        insert_keygroup = parse_bool(inputs.get("insert_keygroup", True), default=True)
        group_output = parse_bool(inputs.get("group_output", True), default=True)

        try:
            personal_number = int(personal_number_raw)
        except (TypeError, ValueError):
            return self._error_response("Le numero personnel doit etre numerique", start_time)

        try:
            key_material = self.derive_key_material(phrase, date, keygroup, personal_number)
            checkerboard = self.build_checkerboard(key_material["line_s"], checkerboard_mnemonic)
        except ValueError as exc:
            return self._error_response(str(exc), start_time)

        try:
            if mode == "encode":
                output, metadata = self.encode(
                    text=text,
                    key_material=key_material,
                    checkerboard=checkerboard,
                    transposition_mode=transposition_mode,
                    insert_keygroup=insert_keygroup,
                    group_output=group_output,
                )
                return self._success_response(
                    summary="Encodage VIC reussi",
                    text_output=output,
                    confidence=1.0,
                    parameters=self._parameters(
                        mode, phrase, date, keygroup, personal_number, checkerboard_mnemonic, transposition_mode, insert_keygroup
                    ),
                    metadata=metadata,
                    start_time=start_time,
                )

            if mode == "decode":
                output, metadata = self.decode(
                    text=text,
                    key_material=key_material,
                    checkerboard=checkerboard,
                    transposition_mode=transposition_mode,
                    insert_keygroup=insert_keygroup,
                )
                return self._success_response(
                    summary="Decodage VIC reussi",
                    text_output=output,
                    confidence=0.55,
                    parameters=self._parameters(
                        mode, phrase, date, keygroup, personal_number, checkerboard_mnemonic, transposition_mode, insert_keygroup
                    ),
                    metadata=metadata,
                    start_time=start_time,
                )

            return self._error_response(f"Mode inconnu: {mode}", start_time)
        except ValueError as exc:
            return self._error_response(str(exc), start_time)

    # ------------------------------------------------------------------
    # Simple dCode / CacheSleuth-style VIC
    # ------------------------------------------------------------------
    def _execute_simple(self, inputs: Dict[str, Any], start_time: float) -> Dict[str, Any]:
        text = str(inputs.get("text", "") or "")
        mode = str(inputs.get("mode", "decode")).lower()
        alphabet_key = str(inputs.get("alphabet_key", "") or "")
        alphabet_order = str(inputs.get("alphabet_order", "") or "")
        spare_positions = str(inputs.get("spare_positions", "26") or "26")
        numeric_key = str(inputs.get("numeric_key", "") or "")
        output_format = str(inputs.get("output_format", "digits") or "digits").lower()
        group_output = parse_bool(inputs.get("group_output", True), default=True)

        try:
            checkerboard = self.build_simple_checkerboard(
                alphabet_key=alphabet_key,
                alphabet_order=alphabet_order,
                spare_positions=spare_positions,
            )

            if mode == "encode":
                digits, encode_meta = self.simple_encode_checkerboard(text, checkerboard)
                if not digits:
                    return self._error_response("Aucun caractere encodable avec la grille VIC", start_time)
                keyed_digits = self._apply_repeating_numeric_key(digits, numeric_key, subtract=False)

                if output_format == "letters":
                    output, output_meta = self.simple_digits_to_letters(keyed_digits, checkerboard)
                elif output_format == "digits":
                    output = self._group_digits(keyed_digits, 5) if group_output else keyed_digits
                    output_meta = {}
                else:
                    return self._error_response("Format de sortie inconnu: utilisez digits ou letters", start_time)

                metadata = self._simple_metadata(checkerboard)
                metadata.update(encode_meta)
                metadata.update(output_meta)
                metadata.update(
                    {
                        "variant": "simple",
                        "digits_before_numeric_key": digits,
                        "digits_after_numeric_key": keyed_digits,
                        "numeric_key": self._clean_digits(numeric_key),
                        "output_format": output_format,
                    }
                )
                return self._success_response(
                    summary="Encodage VIC simple reussi",
                    text_output=output,
                    confidence=1.0,
                    parameters=self._simple_parameters(mode, alphabet_key, alphabet_order, spare_positions, numeric_key, output_format),
                    metadata=metadata,
                    start_time=start_time,
                )

            if mode == "decode":
                cipher_digits, input_meta = self.simple_input_to_digits(text, checkerboard)
                if not cipher_digits:
                    return self._error_response("Aucun chiffre VIC exploitable", start_time)

                unkeyed_digits = self._apply_repeating_numeric_key(cipher_digits, numeric_key, subtract=True)
                plaintext, decode_meta = self.simple_decode_checkerboard(unkeyed_digits, checkerboard)

                metadata = self._simple_metadata(checkerboard)
                metadata.update(input_meta)
                metadata.update(decode_meta)
                metadata.update(
                    {
                        "variant": "simple",
                        "digits_before_numeric_key": cipher_digits,
                        "digits_after_numeric_key": unkeyed_digits,
                        "numeric_key": self._clean_digits(numeric_key),
                    }
                )
                return self._success_response(
                    summary="Decodage VIC simple reussi",
                    text_output=plaintext,
                    confidence=0.65,
                    parameters=self._simple_parameters(mode, alphabet_key, alphabet_order, spare_positions, numeric_key, output_format),
                    metadata=metadata,
                    start_time=start_time,
                )

            return self._error_response(f"Mode inconnu: {mode}", start_time)
        except ValueError as exc:
            return self._error_response(str(exc), start_time)

    def build_simple_checkerboard(
        self,
        alphabet_key: str = "",
        alphabet_order: str = "",
        spare_positions: str = "26",
    ) -> Dict[str, Any]:
        spare_digits = self._clean_digits(spare_positions)
        if len(spare_digits) != 2 or spare_digits[0] == spare_digits[1]:
            raise ValueError("Les positions libres doivent contenir deux chiffres distincts")

        headers = "0123456789"
        alphabet = self._simple_alphabet(alphabet_key=alphabet_key, alphabet_order=alphabet_order)

        encode_map: Dict[str, str] = {}
        decode_map: Dict[str, str] = {}
        pos = 0

        for header in headers:
            if header in spare_digits:
                continue
            ch = alphabet[pos]
            pos += 1
            encode_map[ch] = header
            decode_map[header] = ch

        for row_digit in spare_digits:
            for header in headers:
                ch = alphabet[pos]
                pos += 1
                code = row_digit + header
                encode_map[ch] = code
                decode_map[code] = ch

        return {
            "headers": headers,
            "row_labels": list(spare_digits),
            "alphabet": alphabet,
            "encode_map": encode_map,
            "decode_map": decode_map,
        }

    def simple_encode_checkerboard(self, text: str, checkerboard: Dict[str, Any]) -> Tuple[str, Dict[str, Any]]:
        encode_map: Dict[str, str] = checkerboard["encode_map"]
        normalized = self._normalize_text(text)
        digits: List[str] = []
        unsupported_chars: List[str] = []
        processed_chars = 0

        for ch in normalized:
            if ch.isspace():
                continue
            code = encode_map.get(ch)
            if code is None:
                unsupported_chars.append(ch)
                continue
            digits.append(code)
            processed_chars += 1

        return "".join(digits), {
            "processed_chars": processed_chars,
            "unsupported_chars": sorted(set(unsupported_chars)),
            "unsupported_count": len(unsupported_chars),
        }

    def simple_decode_checkerboard(self, digits: str, checkerboard: Dict[str, Any]) -> Tuple[str, Dict[str, Any]]:
        decode_map: Dict[str, str] = checkerboard["decode_map"]
        row_labels = set(checkerboard["row_labels"])
        output: List[str] = []
        unknown_codes: List[str] = []
        i = 0

        while i < len(digits):
            code = digits[i]
            i += 1
            if code in row_labels:
                if i >= len(digits):
                    unknown_codes.append(code)
                    break
                code += digits[i]
                i += 1

            ch = decode_map.get(code)
            if ch is None:
                unknown_codes.append(code)
                output.append("?")
            else:
                output.append(ch)

        return "".join(output), {"unknown_codes": unknown_codes, "unknown_count": len(unknown_codes)}

    def simple_input_to_digits(self, text: str, checkerboard: Dict[str, Any]) -> Tuple[str, Dict[str, Any]]:
        digits = self._clean_digits(text)
        letters = self._clean_simple_symbols(text)
        if digits and len(digits) >= len(letters):
            return digits, {"input_format": "digits"}

        encoded, metadata = self.simple_encode_checkerboard(text, checkerboard)
        metadata["input_format"] = "letters"
        return encoded, metadata

    def simple_digits_to_letters(self, digits: str, checkerboard: Dict[str, Any]) -> Tuple[str, Dict[str, Any]]:
        row_labels = set(checkerboard["row_labels"])
        padded = digits
        padding_digit: Optional[str] = None
        if padded and padded[-1] in row_labels:
            padding_digit = "0"
            padded += padding_digit
        letters, decode_meta = self.simple_decode_checkerboard(padded, checkerboard)
        return letters, {"letter_output_padding_digit": padding_digit, "letter_output_decode": decode_meta}

    def _simple_alphabet(self, alphabet_key: str, alphabet_order: str) -> str:
        raw = alphabet_order or alphabet_key
        if raw:
            chars = self._clean_simple_symbols(raw)
            unique: List[str] = []
            for ch in chars:
                if ch not in unique:
                    unique.append(ch)
            for ch in "ABCDEFGHIJKLMNOPQRSTUVWXYZ./":
                if ch not in unique:
                    unique.append(ch)
            alphabet = "".join(unique[:28])
        else:
            alphabet = "./ZYXWVUTSRQPONMLKJIHGFEDCBA"

        if len(alphabet) != 28 or len(set(alphabet)) != 28:
            raise ValueError("L'alphabet VIC doit contenir 28 caracteres uniques")
        return alphabet

    def _apply_repeating_numeric_key(self, digits: str, numeric_key: str, subtract: bool) -> str:
        key = self._clean_digits(numeric_key)
        if not key:
            return digits

        output: List[str] = []
        for index, digit in enumerate(digits):
            key_digit = int(key[index % len(key)])
            value = int(digit)
            if subtract:
                output.append(str((value - key_digit) % 10))
            else:
                output.append(str((value + key_digit) % 10))
        return "".join(output)

    def _simple_metadata(self, checkerboard: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "checkerboard_headers": checkerboard["headers"],
            "checkerboard_row_labels": checkerboard["row_labels"],
            "checkerboard_alphabet": checkerboard["alphabet"],
            "implementation_note": "Mode VIC simple type dCode/CacheSleuth: straddling checkerboard + cle numerique modulo 10 optionnelle.",
        }

    def _simple_parameters(
        self,
        mode: str,
        alphabet_key: str,
        alphabet_order: str,
        spare_positions: str,
        numeric_key: str,
        output_format: str,
    ) -> Dict[str, Any]:
        return {
            "mode": mode,
            "cipher_variant": "simple",
            "alphabet_key": alphabet_key,
            "alphabet_order": alphabet_order,
            "spare_positions": self._clean_digits(spare_positions),
            "numeric_key": self._clean_digits(numeric_key),
            "output_format": output_format,
        }

    # ------------------------------------------------------------------
    # Public core methods, useful in tests and for future plugins.
    # ------------------------------------------------------------------
    def derive_key_material(self, phrase: str, date: str, keygroup: str, personal_number: int) -> Dict[str, Any]:
        phrase_letters = self._clean_letters(phrase)
        if len(phrase_letters) < 20:
            raise ValueError("La phrase secrete doit contenir au moins 20 lettres")

        date_digits = self._clean_digits(date)
        if len(date_digits) < 6:
            raise ValueError("La date doit contenir au moins 6 chiffres")

        keygroup_digits = self._clean_digits(keygroup)
        if len(keygroup_digits) != 5:
            raise ValueError("Le keygroup VIC doit contenir exactement 5 chiffres")

        if personal_number < 0 or personal_number > 99:
            raise ValueError("Le numero personnel doit etre compris entre 0 et 99")

        line_a = keygroup_digits
        line_b = date_digits[:5]
        line_c = self._mod_subtract(line_a, line_b)
        line_d = phrase_letters[:20]
        line_e1 = self.sequence(line_d[:10])
        line_e2 = self.sequence(line_d[10:20])
        line_f1 = self.chain_add(line_c, 10)
        line_f2 = "1234567890"
        line_g = self._mod_add(line_e1, line_f1)
        line_h = self._digit_encode(line_g, line_e2)
        line_j = self.sequence(line_h)

        chain = self.chain_add(line_h, 60)
        block = chain[10:60]
        lines = [block[i : i + 10] for i in range(0, 50, 10)]
        line_k, line_l, line_m, line_n, line_p = lines

        first_last, second_last = self._last_two_non_equal_digits(line_p)
        q_len = first_last + personal_number
        r_len = second_last + personal_number
        if q_len < 1 or r_len < 1:
            raise ValueError("Les longueurs de transposition derivees doivent etre positives")

        extracted = self._read_block_by_line_j(lines, line_j, q_len + r_len)
        line_q = extracted[:q_len]
        line_r = extracted[q_len : q_len + r_len]
        line_s = self.sequence(line_p)

        return {
            "line_a": line_a,
            "line_b": line_b,
            "line_c": line_c,
            "line_d": line_d,
            "line_e1": line_e1,
            "line_e2": line_e2,
            "line_f1": line_f1,
            "line_f2": line_f2,
            "line_g": line_g,
            "line_h": line_h,
            "line_j": line_j,
            "line_k": line_k,
            "line_l": line_l,
            "line_m": line_m,
            "line_n": line_n,
            "line_p": line_p,
            "line_q": line_q,
            "line_r": line_r,
            "line_s": line_s,
            "q_length": q_len,
            "r_length": r_len,
            "keygroup_insert_from_end": int(date_digits[5]),
        }

    def build_checkerboard(self, line_s: str, mnemonic: str = "AT ONE SIR") -> Dict[str, Any]:
        headers = list(line_s)
        if len(headers) != 10 or set(headers) != set("0123456789"):
            raise ValueError("Line-S doit etre une permutation de 10 chiffres")

        row_template = self._normalize_mnemonic(mnemonic)
        if len(row_template) != 10 or row_template.count(" ") != 2:
            raise ValueError("Le mnemonic checkerboard doit faire 10 caracteres avec exactement 2 espaces")

        row_labels = [headers[index] for index, ch in enumerate(row_template) if ch == " "]
        top_letters = [ch for ch in row_template if ch != " "]
        used = set(top_letters)
        remaining = [ch for ch in "ABCDEFGHIJKLMNOPQRSTUVWXYZ" if ch not in used]
        symbols = remaining + [".", "/"]

        encode_map: Dict[str, str] = {}
        decode_map: Dict[str, str] = {}

        for index, ch in enumerate(row_template):
            if ch != " ":
                code = headers[index]
                encode_map[ch] = code
                decode_map[code] = ch

        pos = 0
        for row_label in row_labels:
            for header in headers:
                ch = symbols[pos]
                pos += 1
                code = row_label + header
                encode_map[ch] = code
                decode_map[code] = ch

        return {
            "headers": "".join(headers),
            "row_labels": row_labels,
            "mnemonic": row_template,
            "encode_map": encode_map,
            "decode_map": decode_map,
            "number_shift": encode_map["/"],
        }

    def encode(
        self,
        text: str,
        key_material: Dict[str, Any],
        checkerboard: Dict[str, Any],
        transposition_mode: str = "double",
        insert_keygroup: bool = True,
        group_output: bool = True,
    ) -> Tuple[str, Dict[str, Any]]:
        digits, encode_meta = self.encode_checkerboard(text, checkerboard)
        transposed = self._apply_transpositions(digits, key_material, transposition_mode)
        with_keygroup = (
            self._insert_keygroup(transposed, key_material["line_a"], key_material["keygroup_insert_from_end"])
            if insert_keygroup
            else transposed
        )
        output = self._group_digits(with_keygroup, 5) if group_output else with_keygroup

        metadata = self._metadata_key_material(key_material)
        metadata.update(encode_meta)
        metadata.update(
            {
                "digits_before_transposition": digits,
                "digits_after_transposition": transposed,
                "inserted_keygroup": insert_keygroup,
                "transposition_mode": transposition_mode,
                "group_output": group_output,
            }
        )
        return output, metadata

    def decode(
        self,
        text: str,
        key_material: Dict[str, Any],
        checkerboard: Dict[str, Any],
        transposition_mode: str = "double",
        insert_keygroup: bool = True,
    ) -> Tuple[str, Dict[str, Any]]:
        digits = self._clean_digits(text)
        if not digits:
            raise ValueError("Aucun chiffre trouve dans le texte chiffre")

        stripped = (
            self._remove_keygroup(digits, key_material["line_a"], key_material["keygroup_insert_from_end"])
            if insert_keygroup
            else digits
        )
        untransposed = self._reverse_transpositions(stripped, key_material, transposition_mode)
        plaintext, decode_meta = self.decode_checkerboard(untransposed, checkerboard)

        metadata = self._metadata_key_material(key_material)
        metadata.update(decode_meta)
        metadata.update(
            {
                "cipher_digits": digits,
                "digits_after_keygroup_removal": stripped,
                "digits_before_checkerboard": untransposed,
                "removed_keygroup": insert_keygroup,
                "transposition_mode": transposition_mode,
            }
        )
        return plaintext, metadata

    def encode_checkerboard(self, text: str, checkerboard: Dict[str, Any]) -> Tuple[str, Dict[str, Any]]:
        encode_map: Dict[str, str] = checkerboard["encode_map"]
        number_shift = checkerboard["number_shift"]
        normalized = self._normalize_text(text)

        digits: List[str] = []
        unsupported_chars: List[str] = []
        processed_chars = 0
        in_number_mode = False

        def close_number_mode() -> None:
            nonlocal in_number_mode
            if in_number_mode:
                digits.append(number_shift)
                in_number_mode = False

        for ch in normalized:
            if ch.isspace():
                continue

            if ch.isdigit():
                if not in_number_mode:
                    digits.append(number_shift)
                    in_number_mode = True
                digits.append(ch * 3)
                processed_chars += 1
                continue

            close_number_mode()
            if ch in encode_map and ch != "/":
                digits.append(encode_map[ch])
                processed_chars += 1
            elif ch == "/":
                digits.append(number_shift)
                processed_chars += 1
            else:
                unsupported_chars.append(ch)

        close_number_mode()
        return "".join(digits), {
            "processed_chars": processed_chars,
            "unsupported_chars": sorted(set(unsupported_chars)),
            "unsupported_count": len(unsupported_chars),
        }

    def decode_checkerboard(self, digits: str, checkerboard: Dict[str, Any]) -> Tuple[str, Dict[str, Any]]:
        decode_map: Dict[str, str] = checkerboard["decode_map"]
        row_labels = set(checkerboard["row_labels"])
        number_shift = checkerboard["number_shift"]

        output: List[str] = []
        unknown_codes: List[str] = []
        in_number_mode = False
        i = 0
        while i < len(digits):
            if in_number_mode and digits.startswith(number_shift, i):
                in_number_mode = False
                i += len(number_shift)
                continue

            if in_number_mode:
                triplet = digits[i : i + 3]
                if len(triplet) == 3 and len(set(triplet)) == 1:
                    output.append(triplet[0])
                    i += 3
                    continue
                unknown_codes.append(triplet)
                output.append("?")
                i += max(1, len(triplet))
                continue

            code = digits[i]
            i += 1
            if code in row_labels:
                if i >= len(digits):
                    unknown_codes.append(code)
                    output.append("?")
                    break
                code += digits[i]
                i += 1

            ch = decode_map.get(code)
            if ch is None:
                unknown_codes.append(code)
                output.append("?")
                continue
            if ch == "/":
                in_number_mode = True
                continue
            output.append(ch)

        return "".join(output), {"unknown_codes": unknown_codes, "unknown_count": len(unknown_codes)}

    # ------------------------------------------------------------------
    # VIC math helpers
    # ------------------------------------------------------------------
    def sequence(self, value: str) -> str:
        chars = list(value)
        if not chars:
            return ""

        def sort_key(item: Tuple[int, str]) -> Tuple[Any, int]:
            index, ch = item
            if ch.isdigit():
                numeric = 10 if ch == "0" else int(ch)
                return numeric, index
            return ch, index

        ranks = [0] * len(chars)
        for rank, (index, _ch) in enumerate(sorted(enumerate(chars), key=sort_key), start=1):
            ranks[index] = rank
        return "".join("0" if rank == 10 else str(rank) for rank in ranks)

    def chain_add(self, seed: str, target_length: int) -> str:
        digits = self._clean_digits(seed)
        if not digits:
            raise ValueError("Chain addition requiert une graine numerique")
        values = [int(ch) for ch in digits]
        index = 0
        while len(values) < target_length:
            values.append((values[index] + values[index + 1]) % 10)
            index += 1
        return "".join(str(value) for value in values[:target_length])

    def _mod_add(self, left: str, right: str) -> str:
        if len(left) != len(right):
            raise ValueError("Addition modulaire: longueurs incompatibles")
        return "".join(str((int(a) + int(b)) % 10) for a, b in zip(left, right))

    def _mod_subtract(self, left: str, right: str) -> str:
        if len(left) != len(right):
            raise ValueError("Soustraction modulaire: longueurs incompatibles")
        return "".join(str((int(a) - int(b)) % 10) for a, b in zip(left, right))

    def _digit_encode(self, digits: str, key_sequence: str) -> str:
        aide = "1234567890"
        mapping = {plain: coded for plain, coded in zip(aide, key_sequence)}
        return "".join(mapping[ch] for ch in digits)

    def _last_two_non_equal_digits(self, line_p: str) -> Tuple[int, int]:
        if len(line_p) < 2:
            raise ValueError("Line-P invalide")
        second = int(line_p[-1])
        for ch in reversed(line_p[:-1]):
            first = int(ch)
            if first != second:
                return first, second
        raise ValueError("Impossible de trouver deux derniers chiffres non egaux dans Line-P")

    def _read_block_by_line_j(self, lines: List[str], line_j: str, count: int) -> str:
        columns = self._column_order_from_key(line_j)
        values: List[str] = []
        for col in columns:
            for row in lines:
                values.append(row[col])
                if len(values) == count:
                    return "".join(values)
        raise ValueError("Bloc pseudo-aleatoire insuffisant pour les transpositions derivees")

    # ------------------------------------------------------------------
    # Transposition helpers
    # ------------------------------------------------------------------
    def _apply_transpositions(self, digits: str, key_material: Dict[str, Any], mode: str) -> str:
        if mode == "checkerboard_only":
            return digits
        if mode != "double":
            raise ValueError("Mode de transposition inconnu: utilisez double ou checkerboard_only")
        first = self._columnar_transpose(digits, key_material["line_q"])
        return self._columnar_transpose(first, key_material["line_r"])

    def _reverse_transpositions(self, digits: str, key_material: Dict[str, Any], mode: str) -> str:
        if mode == "checkerboard_only":
            return digits
        if mode != "double":
            raise ValueError("Mode de transposition inconnu: utilisez double ou checkerboard_only")
        first = self._columnar_inverse(digits, key_material["line_r"])
        return self._columnar_inverse(first, key_material["line_q"])

    def _columnar_transpose(self, text: str, key: str) -> str:
        if not key:
            raise ValueError("Cle de transposition vide")
        width = len(key)
        order = self._column_order_from_key(key)
        rows = math.ceil(len(text) / width)
        return "".join(
            text[row * width + col]
            for col in order
            for row in range(rows)
            if row * width + col < len(text)
        )

    def _columnar_inverse(self, cipher: str, key: str) -> str:
        if not key:
            raise ValueError("Cle de transposition vide")
        width = len(key)
        order = self._column_order_from_key(key)
        rows = math.ceil(len(cipher) / width)
        remainder = len(cipher) % width
        col_lengths = [rows if remainder == 0 or col < remainder else rows - 1 for col in range(width)]

        columns: Dict[int, str] = {}
        pos = 0
        for col in order:
            length = col_lengths[col]
            columns[col] = cipher[pos : pos + length]
            pos += length

        output: List[str] = []
        for row in range(rows):
            for col in range(width):
                if row < len(columns[col]):
                    output.append(columns[col][row])
        return "".join(output)

    def _column_order_from_key(self, key: str) -> List[int]:
        def key_value(ch: str) -> Any:
            if ch.isdigit():
                return 10 if ch == "0" else int(ch)
            return ch

        return sorted(range(len(key)), key=lambda index: (key_value(key[index]), index))

    # ------------------------------------------------------------------
    # Keygroup placement and formatting
    # ------------------------------------------------------------------
    def _insert_keygroup(self, digits: str, keygroup: str, groups_from_end: int) -> str:
        groups = self._split_groups(digits, 5)
        index = max(0, len(groups) - groups_from_end)
        groups.insert(index, keygroup)
        return "".join(groups)

    def _remove_keygroup(self, digits: str, expected_keygroup: str, groups_from_end: int) -> str:
        groups = self._split_groups(digits, 5)
        index = max(0, len(groups) - groups_from_end - 1)
        if index >= len(groups):
            raise ValueError("Position du keygroup hors limites")
        removed = groups.pop(index)
        if removed != expected_keygroup:
            raise ValueError("Le keygroup extrait ne correspond pas au keygroup fourni")
        return "".join(groups)

    def _split_groups(self, digits: str, size: int) -> List[str]:
        return [digits[i : i + size] for i in range(0, len(digits), size)]

    def _group_digits(self, digits: str, group_size: int) -> str:
        return " ".join(self._split_groups(digits, group_size))

    # ------------------------------------------------------------------
    # Response and utility helpers
    # ------------------------------------------------------------------
    def _detect_response(self, text: str, start_time: float) -> Dict[str, Any]:
        digits = self._clean_digits(text)
        total = len(text.strip()) or 1
        score = 0.0 if not digits else min(1.0, len(digits) / total)
        is_match = len(digits) >= 10 and score >= 0.6
        summary = "Texte compatible avec un chiffre VIC" if is_match else "Texte peu compatible avec un chiffre VIC"
        return {
            "status": "ok",
            "summary": summary,
            "results": [
                {
                    "id": "result_1",
                    "text_output": f"{summary} (score: {score:.2f})",
                    "confidence": float(score),
                    "parameters": {"mode": "detect"},
                    "metadata": {"is_match": is_match, "digits_count": len(digits), "detection_score": float(score)},
                }
            ],
            "plugin_info": self._get_plugin_info(start_time),
        }

    def _parameters(
        self,
        mode: str,
        phrase: str,
        date: str,
        keygroup: str,
        personal_number: int,
        checkerboard_mnemonic: str,
        transposition_mode: str,
        insert_keygroup: bool,
    ) -> Dict[str, Any]:
        return {
            "mode": mode,
            "date": self._clean_digits(date),
            "keygroup": self._clean_digits(keygroup),
            "personal_number": personal_number,
            "phrase_length": len(self._clean_letters(phrase)),
            "checkerboard_mnemonic": checkerboard_mnemonic,
            "transposition_mode": transposition_mode,
            "insert_keygroup": insert_keygroup,
        }

    def _metadata_key_material(self, key_material: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "line_c": key_material["line_c"],
            "line_e1": key_material["line_e1"],
            "line_e2": key_material["line_e2"],
            "line_g": key_material["line_g"],
            "line_h": key_material["line_h"],
            "line_j": key_material["line_j"],
            "line_k": key_material["line_k"],
            "line_l": key_material["line_l"],
            "line_m": key_material["line_m"],
            "line_n": key_material["line_n"],
            "line_p": key_material["line_p"],
            "line_q": key_material["line_q"],
            "line_r": key_material["line_r"],
            "line_s": key_material["line_s"],
            "q_length": key_material["q_length"],
            "r_length": key_material["r_length"],
            "keygroup_insert_from_end": key_material["keygroup_insert_from_end"],
            "implementation_note": "Double transposition colonnaire standard; la transposition diagonale perturbee historique n'est pas emulee.",
        }

    def _normalize_text(self, text: str) -> str:
        normalized = unicodedata.normalize("NFKD", text)
        without_marks = "".join(ch for ch in normalized if not unicodedata.combining(ch))
        return without_marks.upper()

    def _clean_letters(self, text: str) -> str:
        return re.sub(r"[^A-Z]", "", self._normalize_text(text))

    def _clean_digits(self, text: str) -> str:
        return re.sub(r"\D", "", text or "")

    def _normalize_mnemonic(self, mnemonic: str) -> str:
        normalized = self._normalize_text(mnemonic)
        return "".join(ch for ch in normalized if ch == " " or ("A" <= ch <= "Z"))

    def _clean_simple_symbols(self, text: str) -> str:
        normalized = self._normalize_text(text)
        return "".join(ch for ch in normalized if ("A" <= ch <= "Z") or ch in "./")

    def _success_response(
        self,
        summary: str,
        text_output: str,
        confidence: float,
        parameters: Dict[str, Any],
        metadata: Dict[str, Any],
        start_time: float,
    ) -> Dict[str, Any]:
        return {
            "status": "ok",
            "summary": summary,
            "results": [
                {
                    "id": "result_1",
                    "text_output": text_output,
                    "confidence": confidence,
                    "parameters": parameters,
                    "metadata": metadata,
                }
            ],
            "plugin_info": self._get_plugin_info(start_time),
        }

    def _get_plugin_info(self, start_time: float) -> Dict[str, Any]:
        execution_time = (time.time() - start_time) * 1000
        return {"name": self.name, "version": self.version, "execution_time_ms": round(execution_time, 2)}

    def _error_response(self, message: str, start_time: float) -> Dict[str, Any]:
        return {"status": "error", "summary": message, "results": [], "plugin_info": self._get_plugin_info(start_time)}


def execute(inputs: Dict[str, Any]) -> Dict[str, Any]:
    return VicCipherPlugin().execute(inputs)
