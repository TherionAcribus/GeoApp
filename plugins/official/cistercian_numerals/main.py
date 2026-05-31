import re
import time
from urllib.parse import quote


BASE_PATHS = {
    1: [(1, 0), (2, 0)],
    2: [(1, 1), (2, 1)],
    3: [(1, 0), (2, 1)],
    4: [(1, 1), (2, 0)],
    5: [(1, 1), (2, 0), (1, 0)],
    6: [(2, 0), (2, 1)],
    7: [(1, 0), (2, 0), (2, 1)],
    8: [(1, 1), (2, 1), (2, 0)],
    9: [(1, 1), (2, 1), (2, 0), (1, 0)],
}


class CistercianNumeralsPlugin:
    def __init__(self):
        self.name = "cistercian_numerals"
        self.version = "1.0.0"

    def execute(self, inputs):
        start = time.time()
        mode = str(inputs.get("mode") or "encode").lower()

        try:
            if mode == "decode":
                result = self._decode_from_digits(inputs)
            elif mode == "detect":
                result = self._encode_from_text(inputs, detect_only=True)
            else:
                result = self._encode_from_text(inputs, detect_only=False)
        except ValueError as error:
            return {
                "status": "error",
                "summary": str(error),
                "results": [],
                "plugin_info": self._plugin_info(start),
            }

        result["plugin_info"] = self._plugin_info(start)
        return result

    def _encode_from_text(self, inputs, detect_only=False):
        text = str(inputs.get("text") or "").strip()
        values = self._extract_values(text)
        if not values:
            raise ValueError("Aucun nombre de 0 a 9999 trouve dans l'entree.")

        results = []
        for index, value in enumerate(values, start=1):
            results.append(self._build_result(value, f"result_{index}"))

        action = "detecte" if detect_only else "encode"
        return {
            "status": "ok",
            "summary": f"{len(results)} nombre(s) {action}(s) en chiffres cisterciens.",
            "results": results,
        }

    def _decode_from_digits(self, inputs):
        digits = {
            "thousands": self._parse_digit(inputs.get("thousands"), "milliers"),
            "hundreds": self._parse_digit(inputs.get("hundreds"), "centaines"),
            "tens": self._parse_digit(inputs.get("tens"), "dizaines"),
            "units": self._parse_digit(inputs.get("units"), "unites"),
        }
        value = (
            digits["thousands"] * 1000
            + digits["hundreds"] * 100
            + digits["tens"] * 10
            + digits["units"]
        )

        return {
            "status": "ok",
            "summary": f"Symbole cistercien decode: {value}.",
            "results": [self._build_result(value, "result_1")],
        }

    def _extract_values(self, text):
        matches = re.findall(r"(?<!\d)\d{1,4}(?!\d)", text)
        values = []
        for match in matches:
            value = int(match)
            if value < 0 or value > 9999:
                raise ValueError(f"Nombre hors plage cistercienne: {value}.")
            values.append(value)
        return values

    def _parse_digit(self, raw, label):
        if raw is None or raw == "":
            return 0
        try:
            value = int(str(raw))
        except ValueError as error:
            raise ValueError(f"Le chiffre des {label} doit etre compris entre 0 et 9.") from error
        if value < 0 or value > 9:
            raise ValueError(f"Le chiffre des {label} doit etre compris entre 0 et 9.")
        return value

    def _build_result(self, value, result_id):
        digits = self._digits_from_value(value)
        svg = render_cistercian_svg(value)
        return {
            "id": result_id,
            "text_output": str(value),
            "confidence": 1.0,
            "parameters": {
                "value": value,
                "digits": digits,
            },
            "metadata": {
                "value": value,
                "digits": digits,
                "notation": self._format_digit_notation(digits),
                "svg": svg,
                "svg_data_url": "data:image/svg+xml;utf8," + quote(svg),
            },
        }

    def _digits_from_value(self, value):
        return {
            "thousands": (value // 1000) % 10,
            "hundreds": (value // 100) % 10,
            "tens": (value // 10) % 10,
            "units": value % 10,
        }

    def _format_digit_notation(self, digits):
        return (
            f"milliers={digits['thousands']}, "
            f"centaines={digits['hundreds']}, "
            f"dizaines={digits['tens']}, "
            f"unites={digits['units']}"
        )

    def _plugin_info(self, start):
        return {
            "name": self.name,
            "version": self.version,
            "execution_time_ms": int((time.time() - start) * 1000),
        }


def render_cistercian_svg(value):
    digits = {
        "units": value % 10,
        "tens": (value // 10) % 10,
        "hundreds": (value // 100) % 10,
        "thousands": (value // 1000) % 10,
    }

    polylines = []
    for place, digit in digits.items():
        points = _points_for_place(digit, place)
        if not points:
            continue
        polylines.append(
            '<polyline points="{}" />'.format(
                " ".join(f"{_x(x)},{_y(y)}" for x, y in points)
            )
        )

    body = "\n  ".join([
        '<line x1="48" y1="12" x2="48" y2="132" />',
        *polylines,
    ])

    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 144" '
        'width="96" height="144" role="img" aria-label="Cistercian numeral {}">'
        '<g fill="none" stroke="currentColor" stroke-width="8" '
        'stroke-linecap="round" stroke-linejoin="round">\n  {}\n</g></svg>'
    ).format(value, body)


def _points_for_place(digit, place):
    base = BASE_PATHS.get(digit)
    if not base:
        return []

    if place == "units":
        return base
    if place == "tens":
        return [(2 - x, y) for x, y in base]
    if place == "hundreds":
        return [(x, 3 - y) for x, y in base]
    if place == "thousands":
        return [(2 - x, 3 - y) for x, y in base]
    return []


def _x(value):
    return 16 + value * 32


def _y(value):
    return 12 + value * 40
