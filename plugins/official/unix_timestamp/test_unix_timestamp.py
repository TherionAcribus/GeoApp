"""Tests du plugin unix_timestamp."""

import os
import sys

sys.path.insert(0, os.path.dirname(__file__))

from main import UnixTimestampPlugin  # noqa: E402


def _run(**inputs):
    return UnixTimestampPlugin().execute(inputs)


def _first(**inputs):
    res = _run(**inputs)
    assert res["status"] == "ok", res
    return res["results"][0]["text_output"]


# --- Cas de reference geocaching : 27/02/1970 04:03:34 UTC -> 4939414 ---------

def test_reference_case():
    assert _first(text="27/02/1970 04:03:34", mode="to_timestamp") == "4939414"


def test_reference_reverse():
    out = _first(text="4939414", mode="to_date")
    assert out == "1970-02-27 04:03:34 UTC"


# --- Formats de date varies (tous = 27/02/1970 00:00 UTC = 4924800) -----------

def test_various_date_formats():
    expected = "4924800"
    for text in [
        "27/02/1970",
        "27-02-1970",
        "27.02.1970",
        "1970-02-27",
        "1970/02/27",
        "27 fevrier 1970",
        "27 february 1970",
        "February 27 1970",
        "27 fev 70",
    ]:
        assert _first(text=text, mode="to_timestamp") == expected, text


def test_iso_with_time():
    assert _first(text="1970-02-27T04:03:34", mode="to_timestamp") == "4939414"


def test_hour_h_separator():
    assert _first(text="27/02/1970 04h03m34", mode="to_timestamp") == "4939414"


# --- Jour/mois ambigus --------------------------------------------------------

def test_day_first_true():
    # 03/04/1970 lu comme 3 avril -> 7948800
    assert _first(text="03/04/1970", mode="to_timestamp", day_first=True) == "7948800"


def test_day_first_false():
    # 03/04/1970 lu comme 4 mars -> 5356800
    assert _first(text="03/04/1970", mode="to_timestamp", day_first=False) == "5356800"


def test_day_gt_12_overrides_day_first():
    # 27/02 : le 27 ne peut etre qu'un jour, meme si day_first=False
    assert _first(text="27/02/1970", mode="to_timestamp", day_first=False) == "4924800"


# --- Unites -------------------------------------------------------------------

def test_milliseconds_output():
    assert _first(text="27/02/1970 04:03:34", mode="to_timestamp", unit="milliseconds") == "4939414000"


def test_to_date_milliseconds():
    out = _first(text="4939414000", mode="to_date", unit="milliseconds")
    assert out == "1970-02-27 04:03:34 UTC"


# --- Erreurs ------------------------------------------------------------------

def test_empty_input():
    assert _run(text="", mode="to_timestamp")["status"] == "error"


def test_garbage_input():
    assert _run(text="pas une date", mode="to_timestamp")["status"] == "error"


def test_invalid_day():
    assert _run(text="45/02/1970", mode="to_timestamp")["status"] == "error"


if __name__ == "__main__":
    import traceback

    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    failed = 0
    for fn in fns:
        try:
            fn()
            print(f"PASS {fn.__name__}")
        except Exception:  # noqa: BLE001
            failed += 1
            print(f"FAIL {fn.__name__}")
            traceback.print_exc()
    print(f"\n{len(fns) - failed}/{len(fns)} tests passes")
    sys.exit(1 if failed else 0)
