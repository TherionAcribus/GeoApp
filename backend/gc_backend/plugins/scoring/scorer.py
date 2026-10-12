from __future__ import annotations

import copy
import math
import re
import unicodedata
from dataclasses import dataclass
from functools import lru_cache
from typing import Any, Dict, List, Optional, Tuple

from loguru import logger

from .langid import DEFAULT_LANGS_EUROPE, detect_language
from .resources_loader import (
    available_quadgram_langs,
    load_common_word_ranks,
    load_common_words,
    load_geo_terms,
    load_quadgrams,
    load_stopwords,
)


# Precompiled regex patterns for hot paths
_RE_NON_ALPHA = re.compile(r'[^A-Z]')
_RE_WORD_TOKENS = re.compile(r"[\w']+", re.UNICODE)
_RE_GPS_CARDINAL = re.compile(r'\b[NS]\b', re.IGNORECASE)
_RE_GPS_EW = re.compile(r'\b[EW]\b', re.IGNORECASE)
# Cardinal letter glued to (or followed by) its degrees: "N48 51.234 E002 21.456".
# \b[NS]\b misses it — there is no word boundary between a letter and a digit.
_RE_GPS_CARDINAL_NUM = re.compile(r'(?<![A-Za-z])[NS]\s*\d', re.IGNORECASE)
_RE_GPS_EW_NUM = re.compile(r'(?<![A-Za-z])[EWO]\s*\d', re.IGNORECASE)
_RE_GPS_WORDS_NS =re.compile(r'\b(nord|north|sud|south)\b', re.IGNORECASE)
_RE_GPS_WORDS_EW = re.compile(r'\b(est|east|ouest|west)\b', re.IGNORECASE)
_RE_GPS_DEGREE = re.compile(r'\d{1,3}\s*[°º]')
_RE_GPS_DMS = re.compile(r'\d+\s*[°º]\s*\d+\s*[\'\u2032\u2019]\s*\d')
_RE_GPS_DECIMAL = re.compile(r'-?\d{1,3}\.\d{3,}[\s,]+-?\d{1,3}\.\d{3,}')
_RE_GPS_COMPACT = re.compile(r'\b[3-5]\d{6}\s+[0-3]\d{5,7}\b')

# Patterns for detecting still-encoded output (hex pairs, numeric codes)
_RE_HEX_PAIRS = re.compile(r'(?:[0-9A-Fa-f]{2}\s){4,}')
_RE_NUMERIC_CODED = re.compile(r'(?:\d{1,3}\s){5,}')
_RE_BASE64_LIKE = re.compile(r'^[A-Za-z0-9+/=]{20,}$')

# Separators that indicate numeric structure (point, virgule, etc.) for numeric_signal
_NR_SEPARATORS = frozenset({
    'point', 'dot', 'comma', 'virgule', 'komma', 'punto', 'ponto', 'przecinek',
    'et', 'and', 'und',
})


# Short-text thresholds. Geocaching answers are often a word or two ("PONT",
# "SOUS LE BANC"): the IC is statistically meaningless on so few letters, so
# the IC veto only applies from _IC_VETO_MIN_LETTERS (same bound as the fast
# scorer), while quadgrams are usable as soon as one window exists.
_IC_VETO_MIN_LETTERS = 20
_QUADGRAM_MIN_LETTERS = 4

# Fast-scorer floor for coordinate-shaped text (see _gps_structured_hint).
_FAST_GPS_HINT_FLOOR = 0.3

# Share of a lot that survives the fast pre-filter into full scoring (never
# fewer than max(3 x top_k, 75)). Measured on lots of 5000 Vigenere decodings:
# a 4-6 letter answer ranks as low as the top 3% by fast score.
_PREFILTER_KEEP_SHARE = 0.10


def _normalize_basic(text: str) -> str:
    text = unicodedata.normalize('NFKC', text or '')
    text = text.replace('\u00a0', ' ')
    return text


# Letters that NFKD does not decompose and that would otherwise be dropped
# ("Straße" -> "STRAE", "głęboki" -> "GEBOKI"). Must stay in sync with
# _TRANSLITERATION in scripts/generate_quadgrams.py.
_STATS_TRANSLITERATION = str.maketrans({
    'ß': 'ss', 'ẞ': 'SS', 'œ': 'oe', 'Œ': 'OE', 'æ': 'ae', 'Æ': 'AE',
    'ł': 'l', 'Ł': 'L', 'ø': 'o', 'Ø': 'O', 'đ': 'd', 'Đ': 'D',
})


def _normalize_for_stats(text: str) -> str:
    text = _normalize_basic(text).translate(_STATS_TRANSLITERATION)
    text = unicodedata.normalize('NFKD', text)
    text = ''.join(ch for ch in text if not unicodedata.combining(ch))
    text = text.upper()
    text = _RE_NON_ALPHA.sub('', text)
    return text


def _compute_ic(text: str) -> float:
    letters = _normalize_for_stats(text)
    n = len(letters)
    if n < 2:
        return 0.0
    counts: Dict[str, int] = {}
    for ch in letters:
        counts[ch] = counts.get(ch, 0) + 1
    numerator = sum(v * (v - 1) for v in counts.values())
    denominator = n * (n - 1)
    return float(numerator / denominator) if denominator else 0.0


def _shannon_entropy(text: str) -> float:
    s = _normalize_basic(text)
    if not s:
        return 0.0
    counts: Dict[str, int] = {}
    for ch in s:
        counts[ch] = counts.get(ch, 0) + 1
    n = len(s)
    entropy = 0.0
    for c in counts.values():
        p = c / n
        entropy -= p * math.log2(p)
    return float(entropy)


def _tokenize_words(text: str) -> List[str]:
    text = unicodedata.normalize('NFKC', text or '')
    text = text.lower()
    tokens = _RE_WORD_TOKENS.findall(text)
    return [t for t in tokens if len(t) >= 2]


def _gps_gatekeeper_fast(text: str) -> bool:
    if not text:
        return False
    # Cardinal letters N/S + E/W
    if _RE_GPS_CARDINAL.search(text) and _RE_GPS_EW.search(text):
        return True
    # Cardinal letters glued to their number: N48 ... E002 ...
    if _RE_GPS_CARDINAL_NUM.search(text) and _RE_GPS_EW_NUM.search(text):
        return True
    # Written cardinal words (FR + EN)
    if _RE_GPS_WORDS_NS.search(text) and _RE_GPS_WORDS_EW.search(text):
        return True
    # Degree symbol (DDM or DMS)
    if _RE_GPS_DEGREE.search(text):
        return True
    # DMS with prime/double-prime markers: 48° 51' 24"
    if _RE_GPS_DMS.search(text):
        return True
    # Decimal degree pair: 48.1234, 2.3456 or 48.1234 2.3456
    if _RE_GPS_DECIMAL.search(text):
        return True
    # Compact numeric pair (geocaching): 7-digit + 6-8 digit
    if _RE_GPS_COMPACT.search(text):
        return True
    return False


def _gps_structured_hint(text: str) -> bool:
    """Stricter subset of the gatekeeper: only patterns anchored on digits.

    Used by the fast scorer, which skips GPS detection, to let coordinate-shaped
    candidates through to the full scorer. The bare cardinal-letter and
    cardinal-word patterns are left out: they match too much ordinary text to
    justify a pass-through.
    """
    if not text:
        return False
    if _RE_GPS_CARDINAL_NUM.search(text) and _RE_GPS_EW_NUM.search(text):
        return True
    return bool(
        _RE_GPS_DEGREE.search(text)
        or _RE_GPS_DECIMAL.search(text)
        or _RE_GPS_COMPACT.search(text)
    )


def _detect_gps_confidence(
    text: str,
    include_numeric_only: bool = False,
    origin_coords: Optional[Dict[str, str]] = None,
) -> Tuple[float, Dict[str, Any]]:
    if not _gps_gatekeeper_fast(text):
        return 0.0, {"exist": False}

    try:
        from gc_backend.blueprints.coordinates import detect_gps_coordinates

        coords = detect_gps_coordinates(
            text, include_numeric_only=include_numeric_only, origin_coords=origin_coords
        )
        if coords.get('exist'):
            return float(coords.get('confidence') or 0.0), coords
        return 0.0, coords
    except Exception as e:
        logger.debug(f"GPS detect error: {e}")
        return 0.0, {"exist": False, "error": str(e)}


def _entropy_feature(entropy: float) -> float:
    if entropy <= 0.0:
        return 0.0
    if entropy < 1.5:
        return 0.0
    if 1.5 <= entropy <= 4.6:
        return 1.0
    if entropy <= 5.2:
        return 0.4
    return 0.1


def _ic_feature(ic: float) -> float:
    return max(0.0, min(1.0, (ic - 0.045) / 0.03))


# Lowercase counterpart of _STATS_TRANSLITERATION, for dictionary lookups.
# Must stay in sync with _TRANSLITERATION in scripts/generate_common_words.py.
_LEX_TRANSLITERATION = str.maketrans({
    'ß': 'ss', 'ẞ': 'ss', 'œ': 'oe', 'Œ': 'oe', 'æ': 'ae', 'Æ': 'ae',
    'ł': 'l', 'Ł': 'l', 'ø': 'o', 'Ø': 'o', 'đ': 'd', 'Đ': 'd',
})


def _norm_lex_token(t: str) -> str:
    """Transliterate + NFKD accent-strip + lowercase.

    Matches the normalisation used by scripts/generate_common_words.py so that
    ASCII-only decoded text (very common in geocaching, e.g. "TROUVE") still
    matches accented dictionary forms ("trouvé"), and "strasse" matches "Straße".
    """
    s = unicodedata.normalize('NFKD', t.translate(_LEX_TRANSLITERATION))
    s = ''.join(ch for ch in s if not unicodedata.combining(ch))
    return s.lower()


@lru_cache(maxsize=1)
def _all_known_words() -> frozenset:
    """Accent-normalised vocabulary across ALL supported languages, built once.

    Union of stopwords, common words, geo terms and number words for every
    language in DEFAULT_LANGS_EUROPE. Language-agnostic on purpose: lexical
    recognition must not depend on langid, which is unreliable on short or
    ASCII-uppercase decoded text (fr/en trigram confusion is common). A real
    word is a real word regardless of which language was guessed.
    """
    words = set(_CW_NUMBER_WORDS)  # already ASCII/accent-free
    for lang in DEFAULT_LANGS_EUROPE:
        words |= set(load_common_words(lang))  # pre-normalised by the generator
        for w in load_stopwords(lang):
            words.add(_norm_lex_token(w))
        for w in load_geo_terms(lang):
            words.add(_norm_lex_token(w))
    return frozenset(words)


@lru_cache(maxsize=1)
def _all_geo_words() -> frozenset:
    """Accent-normalised geo terms across all languages (words_found + bonus)."""
    out = set()
    for lang in DEFAULT_LANGS_EUROPE:
        for w in load_geo_terms(lang):
            out.add(_norm_lex_token(w))
    return frozenset(out)


# ── Segmentation of glued words ──────────────────────────────────────────
# Many ciphers output plaintext without spaces ("LACACHESETROUVEAUPIED").
# Tokenised as one unknown word, it gets no lexical credit at all. A long
# alphabetic run that is not itself a word is therefore split against one
# language's vocabulary at a time, and the split is kept only if real words
# cover most of the run.
_SEGMENT_MIN_LETTERS = 8
_SEGMENT_MAX_LETTERS = 400
_SEGMENT_MIN_COVERAGE = 0.7
_SEGMENT_SHORT_RUN = 16            # below this many letters...
_SEGMENT_MIN_COVERAGE_SHORT = 0.85  # ...a stricter coverage is required
_RE_ALPHA_RUN = re.compile(r"[^\W\d_]{%d,}" % _SEGMENT_MIN_LETTERS)


# Segmentation costs. A word costs the log of its frequency rank (a common word
# is cheap, Zipf-style); words that have no rank — stopwords, geo terms, number
# words — get a mid-frequency default. A letter no word explains costs more
# than the rarest word, so it is always better to explain letters than not.
_SEGMENT_DEFAULT_RANK = 500
_SEGMENT_SKIP_COST = 12.0


@lru_cache(maxsize=16)
def _lang_vocabulary(lang: str) -> Tuple[Dict[str, float], int]:
    """One language's accent-normalised words (2+ letters) -> cost, and the longest length.

    Kept per language on purpose: pooled across 8 languages, the short words
    alone would be enough to carve up almost any letter soup.
    """
    ranks: Dict[str, int] = dict(load_common_word_ranks(lang))
    extra = {_norm_lex_token(w) for w in load_stopwords(lang)}
    extra |= {_norm_lex_token(w) for w in load_geo_terms(lang)}
    extra |= _CW_NUMBER_WORDS
    for w in extra:
        ranks[w] = min(ranks.get(w, _SEGMENT_DEFAULT_RANK), _SEGMENT_DEFAULT_RANK)
    costs = {
        w: math.log(rank + 10.0)
        for w, rank in ranks.items()
        if len(w) >= 2 and w.isalpha()
    }
    return costs, max((len(w) for w in costs), default=0)


def _segment_with_vocabulary(s: str, vocab: Dict[str, float], max_len: int) -> Tuple[float, List[str]]:
    """Cheapest split of ``s`` into vocabulary words; returns (coverage, pieces).

    Dynamic programming over word costs (log frequency rank): frequent words
    are preferred, so "TROUVE AU" beats "TROU VEAU", and since an unexplained
    letter costs more than any word, "CACHE SE TROUVE" beats "CACHES E TROUVE".
    Letters no word accounts for are left in unknown pieces.

    ``coverage`` is the share of letters inside real words, with 2- and
    3-letter words discounted (1/3 and 2/3): they turn up by chance in any
    letter soup.
    """
    n = len(s)
    cost = [i * _SEGMENT_SKIP_COST for i in range(n + 1)]
    back: List[Optional[int]] = [None] * (n + 1)  # start of the word ending here
    for i in range(n):
        base = cost[i]
        if base + _SEGMENT_SKIP_COST < cost[i + 1]:
            cost[i + 1] = base + _SEGMENT_SKIP_COST
            back[i + 1] = None
        for j in range(i + 2, min(n, i + max_len) + 1):
            word_cost = vocab.get(s[i:j])
            if word_cost is not None and base + word_cost < cost[j]:
                cost[j] = base + word_cost
                back[j] = i

    pieces: List[str] = []
    covered = 0.0
    end = n
    gap_end = n
    while end > 0:
        start = back[end]
        if start is None:
            end -= 1
            continue
        if gap_end > end:
            pieces.append(s[end:gap_end])
        pieces.append(s[start:end])
        length = end - start
        covered += length * min(1.0, (length - 1) / 3.0)
        end = start
        gap_end = start
    if gap_end > 0:
        pieces.append(s[0:gap_end])
    pieces.reverse()
    return covered / n, pieces


@lru_cache(maxsize=4096)
def _segment_glued_run(run: str) -> Optional[Tuple[str, Tuple[str, ...]]]:
    """Split an accent-normalised lowercase run, or None if no language fits.

    Returns (language, pieces) for the language whose words cover the run best,
    provided that coverage reaches _SEGMENT_MIN_COVERAGE.
    """
    best_cov = 0.0
    best: Optional[Tuple[str, Tuple[str, ...]]] = None
    for lang in DEFAULT_LANGS_EUROPE:
        vocab, max_len = _lang_vocabulary(lang)
        coverage, pieces = _segment_with_vocabulary(run, vocab, max_len)
        if coverage > best_cov:
            best_cov = coverage
            best = (lang, tuple(pieces))
    # A short run is covered by chance more easily: ask more of it.
    required = _SEGMENT_MIN_COVERAGE if len(run) >= _SEGMENT_SHORT_RUN else _SEGMENT_MIN_COVERAGE_SHORT
    if best is None or best_cov < required:
        return None
    return best


def _segment_glued_words(text: str) -> Tuple[str, Optional[str]]:
    """Insert spaces into glued alphabetic runs; returns (text, language or None).

    Runs that are already words, too short or too long are left alone, as is
    any run no language covers well enough — so gibberish comes back unchanged.
    """
    known = _all_known_words()
    language: Optional[str] = None

    def _split(match: 're.Match') -> str:
        nonlocal language
        raw = match.group(0)
        run = _norm_lex_token(raw)
        if len(run) != len(raw) or len(run) > _SEGMENT_MAX_LETTERS or run in known:
            return raw
        found = _segment_glued_run(run)
        if found is None:
            return raw
        language = language or found[0]
        # Cut the original run at the same offsets, to keep its case and accents.
        out, pos = [], 0
        for piece in found[1]:
            out.append(raw[pos:pos + len(piece)])
            pos += len(piece)
        return ' '.join(out)

    return _RE_ALPHA_RUN.sub(_split, text), language


def _lexical_features(tokens: List[str]) -> Tuple[float, float, List[str]]:
    """Measure how much of the text is *recognised* real language.

    Unlike the previous version — which used raw token count and so scored any
    long enough text high, gibberish included — coverage is now driven by
    membership in a real vocabulary (stopwords ∪ common_words ∪ geo_terms ∪
    number_words), pooled across all supported languages. ``coherence`` counts
    the longest run of consecutive *recognised* tokens.
    """
    if not tokens:
        return 0.0, 0.0, []

    known = _all_known_words()
    geo_set = _all_geo_words()

    norm_tokens = [_norm_lex_token(t) for t in tokens]
    n_total = len(norm_tokens)

    known_flags = [t in known for t in norm_tokens]
    n_known = sum(known_flags)

    if n_known == 0:
        return 0.0, 0.0, []

    ratio = n_known / n_total
    lexical_base = ratio * 0.7 + min(1.0, n_known / 8.0) * 0.3

    # Geo terms kept as a separate, modest bonus (as before).
    geo_found = [t for t in norm_tokens if t in geo_set]
    geo_bonus = min(1.0, len(geo_found) / max(1, n_total))
    lexical = min(1.0, lexical_base + geo_bonus * 0.15)

    longest_run = 0
    current = 0
    for flag in known_flags:
        if flag:
            current += 1
            if current > longest_run:
                longest_run = current
        else:
            current = 0
    coherence = min(1.0, longest_run / 5.0)

    # Deduplicate while preserving order (geo terms recognised, max 50).
    words_found = list(dict.fromkeys(geo_found))[:50]

    return float(lexical), float(coherence), words_found


# Quadgram fitness calibration: the mean log10-probability per window, mapped
# linearly from _QUADGRAM_LOGP_NOISE (-> 0) to _QUADGRAM_LOGP_TEXT (-> 1).
# Measured on 57 real sentences in the 8 languages and their corruptions
# (best table each time, unknown quadgram = _QUADGRAM_UNKNOWN_LOGP):
#   real text ............ -4.54 .. -3.71  (median -4.10)
#   same letters shuffled  -5.64 .. -4.84  (median -5.33)
#   reversed ............. -5.47 .. -4.46  (median -5.17)
#   wrong Caesar shift ... -6.00 .. -5.53  (median -5.88)
# The previous mapping, (mean + 6) / 4 plus a hit-ratio term, spread this
# narrow band over a quarter of the scale: real text read 0.6, shuffled 0.3.
_QUADGRAM_UNKNOWN_LOGP = -6.0
_QUADGRAM_LOGP_NOISE = -5.4
_QUADGRAM_LOGP_TEXT = -4.2


def _quadgram_fitness_for_lang(letters: str, lang: str) -> float:
    """Quadgram fitness of a letters-only string against one language's table."""
    table = load_quadgrams(lang)
    if not table:
        return 0.0
    windows = len(letters) - 3
    if windows <= 0:
        return 0.0
    total = 0.0
    for i in range(windows):
        total += table.get(letters[i:i + 4], _QUADGRAM_UNKNOWN_LOGP)
    mean_logp = total / windows
    fitness = (mean_logp - _QUADGRAM_LOGP_NOISE) / (_QUADGRAM_LOGP_TEXT - _QUADGRAM_LOGP_NOISE)
    return float(max(0.0, min(1.0, fitness)))


def _quadgram_fitness(text: str, lang: str) -> float:
    """Best-of quadgram fitness across the detected language + every available table.

    Using all available tables (not a hardcoded en/fr/de) means es/it/nl/pt/pl
    text is scored against its own table when that scores best, instead of only
    the three original languages.
    """
    letters = _normalize_for_stats(text)
    if len(letters) < _QUADGRAM_MIN_LETTERS:
        return 0.0
    # Detected language first, then every language that ships a quadgram table.
    langs_to_try = [lang] if lang and lang != 'unknown' else []
    for fallback in available_quadgram_langs():
        if fallback not in langs_to_try:
            langs_to_try.append(fallback)
    best = 0.0
    for lg in langs_to_try:
        f = _quadgram_fitness_for_lang(letters, lg)
        if f > best:
            best = f
    return best


def _repetition_quality(text: str) -> float:
    letters = _normalize_for_stats(text)
    if len(letters) < 12:
        return 1.0

    max_run = 1
    run = 1
    for i in range(1, len(letters)):
        if letters[i] == letters[i - 1]:
            run += 1
            max_run = max(max_run, run)
        else:
            run = 1

    if max_run >= 5:
        return 0.0
    if max_run == 4:
        return 0.2
    if max_run == 3:
        return 0.6

    unique_ratio = len(set(letters)) / max(1, len(letters))
    if unique_ratio < 0.12:
        return 0.2
    if unique_ratio < 0.18:
        return 0.6
    return 1.0


# ── Module-level constants for _numeric_signal_feature (built once) ───────

_CW_DIRECTIONS = frozenset({
    'n', 's', 'e', 'w', 'o',
    'nord', 'sud', 'est', 'ouest',
    'north', 'south', 'east', 'west',
    'norte', 'sur', 'este', 'oeste',
    'noord', 'zuid', 'oost',
    'sul', 'leste',
    'polnoc', 'poludnie', 'wschod', 'zachod',
    'sued', 'ost',
})

# Direction words that are also everyday words: "est" (French "is"), "sur"
# (French "on"), "este" (Spanish "this"). They never earn the direction bonus
# on their own; a real coordinate also carries nord/sud/ouest or lat/lon.
_CW_AMBIGUOUS_DIRECTIONS = frozenset({'est', 'sur', 'este'})

_CW_LATLON = frozenset({
    'lat', 'lon', 'latitude', 'longitude',
    'breite', 'laenge', 'lange',
    'latitud', 'longitud',
    'latitudine', 'longitudine',
    'breedte', 'lengte',
})

_CW_UNITS = frozenset({
    'deg', 'degre', 'degres', 'degree', 'degrees', 'grad', 'grado', 'grados', 'grau', 'graus',
    'min', 'minute', 'minutes', 'minut', 'minuten', 'minutos', 'minuto', 'minuti',
    'sec', 'seconde', 'secondes', 'sekunde', 'sekunden', 'segundo', 'segundos', 'second', 'seconds',
    'point', 'dot', 'comma', 'virgule', 'komma', 'punto', 'ponto', 'przecinek',
})

_CW_NUMBER_WORDS: frozenset = frozenset({
    # English
    'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
    'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen',
    'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'hundred', 'thousand',
    # French
    'un', 'une', 'deux', 'trois', 'quatre', 'cinq', 'sept', 'huit', 'neuf',
    'dix', 'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize', 'dixsept', 'dixhuit', 'dixneuf',
    'vingt', 'trente', 'quarante', 'cinquante', 'soixante', 'cent', 'mille',
    # Spanish / Portuguese
    'cero', 'uno', 'una', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve',
    'diez', 'once', 'doce', 'trece', 'catorce', 'dieciseis', 'diecisiete', 'dieciocho', 'diecinueve',
    'veinte', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'cien', 'ciento', 'mil',
    'um', 'uma', 'dois', 'duas', 'sete', 'oito', 'nove',
    'dez', 'dezesseis', 'dezessete', 'dezoito', 'dezenove',
    'vinte', 'trinta', 'cinquenta', 'sessenta', 'cem', 'cento',
    # Italian / Dutch / Polish
    'due', 'tre', 'quattro', 'cinque', 'sei', 'sette', 'otto',
    'dieci', 'undici', 'dodici', 'tredici', 'quattordici', 'quindici', 'sedici', 'diciassette', 'diciotto', 'diciannove',
    'venti', 'quaranta', 'cinquanta', 'sessanta', 'mille',
    'nul', 'een', 'twee', 'drie', 'vier', 'vijf', 'zes', 'zeven', 'acht', 'negen',
    'tien', 'elf', 'twaalf', 'dertien', 'veertien', 'vijftien', 'zestien', 'zeventien', 'achttien', 'negentien',
    'twintig', 'dertig', 'veertig', 'vijftig', 'zestig', 'honderd', 'duizend',
    'jeden', 'jedna', 'dwa', 'trzy', 'cztery', 'piec', 'szesc', 'siedem', 'osiem', 'dziewiec',
    'dziesiec', 'jedenascie', 'dwanascie', 'trzynascie', 'czternascie', 'pietnascie', 'szesnascie',
    'siedemnascie', 'osiemnascie', 'dziewietnascie', 'dwadziescia', 'trzydziesci', 'czterdziesci', 'piecdziesiat',
    'szescdziesiat', 'sto', 'tysiac',
    # German
    'null', 'eins', 'ein', 'eine', 'zwei', 'drei', 'funf', 'fuenf', 'sechs', 'sieben',
    'zehn', 'zwolf', 'zwoelf', 'dreizehn', 'vierzehn', 'funfzehn', 'fuenfzehn', 'sechzehn', 'siebzehn',
    'achtzehn', 'neunzehn', 'zwanzig', 'dreissig', 'vierzig', 'funfzig', 'fuenfzig', 'sechzig',
    'hundert', 'tausend', 'und',
    # Tens 70/80/90 (all languages) and a few missing basics
    'seventy', 'eighty', 'ninety',
    'septante', 'huitante', 'octante', 'nonante',
    'siebzig', 'achtzig', 'neunzig',
    'setenta', 'ochenta', 'noventa', 'oitenta', 'quarenta', 'quince',
    'quatro', 'doze', 'treze', 'catorze',
    'trenta', 'settanta', 'ottanta', 'novanta',
    'zeventig', 'tachtig', 'negentig',
    'siedemdziesiat', 'osiemdziesiat', 'dziewiecdziesiat',
})

_CW_DE_TENS = (
    'zwanzig', 'dreissig', 'vierzig', 'funfzig', 'fuenfzig', 'sechzig',
    'siebzig', 'achtzig', 'neunzig',
)

# Number words that are also everyday words (articles "un/une/ein/one", or
# homographs once accent-stripped: "tres" = très, "neuf" = new, "dos" = back).
# They only count as numbers next to an unambiguous number ("vingt et un"),
# otherwise ordinary prose ("un arbre et une pierre") reads as coordinates.
_CW_AMBIGUOUS_NUMBER_WORDS = frozenset({
    'un', 'une', 'uno', 'una', 'um', 'uma', 'ein', 'eine', 'een', 'one',
    'once', 'sei', 'nul', 'due', 'tien', 'dos', 'tres', 'neuf', 'elf', 'sto',
})

# Real coordinate units only (degrees/minutes/seconds), excluding the
# separators (point/virgule/...) that _CW_UNITS also contains — those are
# credited through the separator bonus instead, to avoid double-counting.
_CW_TRUE_UNITS = _CW_UNITS - _NR_SEPARATORS


# ── Encoded-pattern penalty ──────────────────────────────────────────────
def _is_single_case_letters(block: str) -> bool:
    """True for a letters-only block in one case (a leading capital is allowed).

    Such a block is glued plaintext ("LACACHESETROUVEAUPIED"), which many
    ciphers output without spaces — not base64, whose alphabet mixes cases,
    digits and ``+/=`` (a 20-char base64 block has no digit only ~3% of the time).
    """
    if not block.isalpha():
        return False
    return block.isupper() or block.islower() or block[1:].islower()


def _encoded_pattern_penalty(text: str) -> float:
    """Detect still-encoded output (hex pairs, numeric codes, base64).

    Returns a penalty factor in [0..1]:
      - 1.0 = text looks clean (no encoded patterns)
      - 0.0 = text looks entirely encoded (hex/numeric/base64)

    This catches outputs where a cipher plugin barely transformed the input,
    leaving hex pairs like ``76 69 6E 67 74`` or numeric codes like ``12 34 56``.
    """
    if not text or len(text) < 8:
        return 1.0

    stripped = text.strip()
    total_len = len(stripped)

    # Base64-like: single long block of base64 chars
    if _RE_BASE64_LIKE.match(stripped) and not _is_single_case_letters(stripped):
        return 0.1

    # Hex pairs: "6E 67 74 20 64 65"
    hex_matches = _RE_HEX_PAIRS.findall(stripped)
    hex_coverage = sum(len(m) for m in hex_matches) / max(1, total_len) if hex_matches else 0.0
    if hex_coverage > 0.6:
        return 0.05
    if hex_coverage > 0.3:
        return 0.2

    # Numeric coded: "76 69 6 67 74" (sequences of short numbers separated by spaces)
    num_matches = _RE_NUMERIC_CODED.findall(stripped)
    num_coverage = sum(len(m) for m in num_matches) / max(1, total_len) if num_matches else 0.0
    if num_coverage > 0.6:
        return 0.15
    if num_coverage > 0.3:
        return 0.35

    return 1.0


# ── Numeric signal feature (coord_words + number_richness, merged) ───────
def _is_number_token(t: str) -> Tuple[bool, bool]:
    """Classify a normalised token as a number.

    Returns (is_number, is_plain_digit_group). ``is_plain_digit_group`` is True
    only for pure-digit tokens of 1-5 digits that are not long binary-like runs
    (e.g. "0101010101"). Mixed alphanumerics ("XJ12", "6E") are NOT numbers —
    this is the fix for the old _looks_like_number_word which accepted any token
    merely containing a digit.
    """
    if not t:
        return False, False
    if t.isdigit():
        if len(t) <= 5 and not (len(t) > 4 and set(t) <= {'0', '1'}):
            return True, True
        return False, False
    if t in _CW_NUMBER_WORDS:
        return True, False
    # German compound number, e.g. "einundzwanzig" (<unit>und<tens>).
    if 'und' in t and any(t.endswith(ten) for ten in _CW_DE_TENS):
        return True, False
    return False, False


def _ddm_plausible(digit_groups: List[str]) -> bool:
    """True if the pure-digit groups look like coordinate components.

    Needs at least a degrees-range value (0-90) and either a minutes-range
    value (0-59) or a 3-digit group (typical of DDM thousandths / longitude).
    """
    if len(digit_groups) < 2:
        return False
    vals = [int(g) for g in digit_groups]
    has_deg = any(0 <= v <= 90 for v in vals)
    has_min_or_triplet = (
        any(0 <= v <= 59 for v in vals)
        or any(len(g) == 3 for g in digit_groups)
    )
    return has_deg and has_min_or_triplet


def _numeric_signal_feature(text: str) -> float:
    """Unified signal for coordinate/number content (was coord_words + number_richness).

    A density base capped at 0.45 (so a bare enumeration of numbers can never
    exceed 0.45) plus cumulative *structure* bonuses that lift genuine
    coordinate fragments toward 1.0:

      - separator (point/virgule/...) ......... +0.20
      - direction or lat/lon word ............. +0.25
      - real unit (degre/minute/seconde/...) .. +0.10
      - DDM-plausible digit groups ............ +0.15

    This removes the old triple-counting of number tokens across gps_confidence,
    coord_words and number_richness that let plain enumerations saturate.
    """
    raw_tokens = _tokenize_words(text)
    if not raw_tokens or len(raw_tokens) < 2:
        return 0.0

    tokens = [_norm_lex_token(t) for t in raw_tokens]
    n = len(tokens)

    # Pass 1: unambiguous numbers. Separators ("und" is also a number word in
    # German compounds) and ambiguous words are held back.
    is_num = [False] * n
    ambiguous: List[int] = []
    digit_groups: List[str] = []
    for i, t in enumerate(tokens):
        if t in _NR_SEPARATORS:
            continue
        if t in _CW_AMBIGUOUS_NUMBER_WORDS:
            ambiguous.append(i)
            continue
        num, is_digit = _is_number_token(t)
        if num:
            is_num[i] = True
            if is_digit:
                digit_groups.append(t)

    # Pass 2: an ambiguous word counts only next to a number, directly or
    # across one separator ("vingt et un", "one hundred"). Repeated until
    # stable so a run of ambiguous words anchored on a real number is kept
    # whole ("uno punto dos tres").
    def _number_neighbour(i: int) -> bool:
        for step in (-1, 1):
            j = i + step
            if 0 <= j < n and tokens[j] in _NR_SEPARATORS:
                j += step
            if 0 <= j < n and is_num[j]:
                return True
        return False

    changed = True
    while changed:
        changed = False
        for i in ambiguous:
            if not is_num[i] and _number_neighbour(i):
                is_num[i] = True
                changed = True

    num_count = sum(is_num)
    if num_count < 2:
        return 0.0

    def _number_within(i: int, reach: int) -> bool:
        return any(is_num[j] for j in range(max(0, i - reach), min(n, i + reach + 1)) if j != i)

    density = min(1.0, num_count / 8.0)
    base = 0.45 * density

    # Structure bonuses are only credited when the marker sits next to a
    # number — "et", "nord" or "minutes" elsewhere in a sentence prove nothing.
    # A separator must join two numbers ("cinquante et un", "51 point 234").
    # "est"/"sur"/"este" are everyday words ("la cache est a deux metres"):
    # alone they are not a direction, they need a nord/sud/lat companion.
    bonus = 0.0
    if any(
        t in _NR_SEPARATORS and 0 < i < n - 1 and is_num[i - 1] and is_num[i + 1]
        for i, t in enumerate(tokens)
    ):
        bonus += 0.20
    if any(
        ((t in _CW_DIRECTIONS) or (t in _CW_LATLON))
        and t not in _CW_AMBIGUOUS_DIRECTIONS
        and _number_within(i, 2)
        for i, t in enumerate(tokens)
    ):
        bonus += 0.25
    if any(t in _CW_TRUE_UNITS and _number_within(i, 1) for i, t in enumerate(tokens)):
        bonus += 0.10
    if _ddm_plausible(digit_groups):
        bonus += 0.15

    return float(min(1.0, base + bonus))


@dataclass(frozen=True)
class ScoreResult:
    score: float
    metadata: Dict[str, Any]


# ── Geographic context ───────────────────────────────────────────────────
# The final of a mystery cache lies within 2 miles (3.2 km) of its posted
# coordinates, and other cache types rarely stray far. When the caller gives
# the cache's own coordinates, coordinates found in a candidate are weighed by
# their distance to it: a wrong decoding that still *looks* like coordinates
# usually lands hundreds of kilometres away.
_GEO_NEAR_KM = 3.3            # the 2-mile rule, with a small margin
_GEO_NEAR_BOOST = 0.6         # share of the remaining doubt removed when near
_GEO_BANDS = (                # (max distance km, status, factor on gps_confidence)
    (25.0, 'plausible', 1.0),
    (80.0, 'far', 0.85),
    (200.0, 'very_far', 0.6),
)
_GEO_BEYOND = ('implausible', 0.35)


def _origin_from_context(context: Optional[Dict[str, Any]]) -> Optional[Tuple[float, float]]:
    """Cache coordinates (decimal lat, lon) from a scoring context, or None.

    Accepts ``origin_latitude``/``origin_longitude`` (numbers) or
    ``origin_coords`` — a DDM string ("N 48° 51.234 E 002° 21.456") or a
    ``{ddm_lat, ddm_lon}`` dict, the form the frontend already sends to plugins.
    Anything missing or unreadable yields None: plugins pass arbitrary contexts.
    """
    if not isinstance(context, dict):
        return None
    try:
        lat, lon = context.get('origin_latitude'), context.get('origin_longitude')
        if lat is None or lon is None:
            raw = context.get('origin_coords')
            if not raw:
                return None
            from gc_backend.blueprints.coordinates import _normalize_origin_coords, convert_ddm_to_decimal

            ddm = _normalize_origin_coords(raw)
            if not ddm:
                return None
            decimal = convert_ddm_to_decimal(ddm['ddm_lat'], ddm['ddm_lon'])
            lat, lon = decimal.get('latitude'), decimal.get('longitude')
        lat, lon = float(lat), float(lon)
    except Exception as e:
        logger.debug(f"Scoring origin unreadable: {e}")
        return None
    if not (math.isfinite(lat) and math.isfinite(lon) and -90.0 <= lat <= 90.0 and -180.0 <= lon <= 180.0):
        return None
    # Rounded (~1 m) so the origin can key the score cache.
    return round(lat, 5), round(lon, 5)


def _origin_as_ddm(origin: Tuple[float, float]) -> Dict[str, str]:
    """{ddm_lat, ddm_lon} for the detector, which reads the hemisphere from it."""
    def _part(value: float, positive: str, negative: str, width: int) -> str:
        degrees = int(abs(value))
        minutes = (abs(value) - degrees) * 60.0
        return f"{positive if value >= 0 else negative} {degrees:0{width}d}° {minutes:06.3f}'"

    return {
        'ddm_lat': _part(origin[0], 'N', 'S', 2),
        'ddm_lon': _part(origin[1], 'E', 'W', 3),
    }


def _distance_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance (haversine) — ample precision for these bands."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 6371.0088 * 2 * math.asin(min(1.0, math.sqrt(a)))


def _apply_geo_context(
    gps_conf: float, gps_details: Dict[str, Any], origin: Optional[Tuple[float, float]]
) -> Tuple[float, Optional[Dict[str, Any]]]:
    """Weigh a GPS detection by its distance to the cache; returns (confidence, geo)."""
    if origin is None or gps_conf <= 0.0:
        return gps_conf, None
    lat, lon = gps_details.get('decimal_latitude'), gps_details.get('decimal_longitude')
    if lat is None or lon is None:
        return gps_conf, None

    distance = _distance_km(origin[0], origin[1], float(lat), float(lon))
    if distance <= _GEO_NEAR_KM:
        status, factor = 'near', None
        adjusted = gps_conf + (1.0 - gps_conf) * _GEO_NEAR_BOOST
    else:
        status, factor = _GEO_BEYOND
        for max_km, band_status, band_factor in _GEO_BANDS:
            if distance <= max_km:
                status, factor = band_status, band_factor
                break
        adjusted = gps_conf * factor
    return float(adjusted), {
        'distance_km': round(distance, 2),
        'status': status,
        'gps_confidence_raw': float(gps_conf),
    }


def _compute_score(text: str, origin: Optional[Tuple[float, float]] = None) -> ScoreResult:
    ic = _compute_ic(text)
    entropy = _shannon_entropy(text)

    gps_conf, gps_details = _detect_gps_confidence(
        text,
        include_numeric_only=False,
        origin_coords=_origin_as_ddm(origin) if origin else None,
    )
    gps_conf, geo = _apply_geo_context(gps_conf, gps_details, origin)

    langid = detect_language(text, DEFAULT_LANGS_EUROPE)
    # Word-level features read the text with glued words split apart; the
    # letter-level ones (IC, n-grams, GPS) keep the original.
    word_text, segmentation_lang = _segment_glued_words(text)
    tokens = _tokenize_words(word_text)

    lexical, coherence, words_found = _lexical_features(tokens)
    ic_v = _ic_feature(ic)
    entropy_v = _entropy_feature(entropy)

    trigram_fitness = float(langid.fitness)
    quadgram_fitness = _quadgram_fitness(text, langid.language)
    repetition_quality = _repetition_quality(text)
    encoded_penalty = _encoded_pattern_penalty(text)
    if segmentation_lang and _RE_BASE64_LIKE.match(text.strip()):
        # A block that splits into real words is glued text in mixed case
        # ("LaCacheSeTrouve"), not base64.
        encoded_penalty = 1.0
    numeric_signal = _numeric_signal_feature(word_text)

    # Unified coordinate channel: a formal GPS detection or a strong written
    # numeric signal. numeric_signal is scaled by 0.85 so a formal GPS hit is
    # always preferred at equal strength. (Consumed as-is by the T6 recombine.)
    coord_score = max(gps_conf, numeric_signal * 0.85)

    # The calibrated quadgram fitness spans 0..1 on its own. The trigram
    # fitness (at most ~0.3, and length-dependent) is no longer mixed in: it
    # only feeds language detection and stays in the metadata.
    ngram_fitness = float(quadgram_fitness * repetition_quality)

    n_letters = len(_normalize_for_stats(text))

    if (
        n_letters >= _IC_VETO_MIN_LETTERS
        and ic < 0.038
        and gps_conf < 0.7
        and numeric_signal < 0.3
    ):
        return ScoreResult(
            score=0.0,
            metadata={
                'scoring': {
                    'score': 0.0,
                    'early_exit': 'ic_veto',
                    'language_detected': langid.language,
                    'language_confidence': langid.confidence,
                    'features': {
                        'ic': ic,
                        'entropy': entropy,
                        'gps_confidence': gps_conf,
                        'ngram_fitness': ngram_fitness,
                        'trigram_fitness': trigram_fitness,
                        'quadgram_fitness': quadgram_fitness,
                        'repetition_quality': repetition_quality,
                        'numeric_signal': numeric_signal,
                        'coord_score': coord_score,
                        'encoded_penalty': encoded_penalty,
                        'lexical_coverage': lexical,
                        'coherence': coherence,
                    },
                    'explanation': 'IC trop faible et aucune coordonnée GPS forte détectée.'
                }
            }
        )

    # ── Two-channel noisy-OR combination ────────────────────────────────
    # lang_score : "is this natural language?" — a NORMALISED weighted mean
    #              (weights sum to 1) so it can never saturate on its own.
    # coord_score: "is this a coordinate?" — max(formal GPS, written numeric).
    # A strong signal in EITHER channel is enough; both strong -> ~1.0. The
    # 0.9 factor on the language channel keeps coordinates marginally ahead at
    # equal strength (a coordinate is the actual goal of a geocache).
    weights = {
        'ngram_fitness': 0.45,
        'lexical_coverage': 0.35,
        'coherence': 0.10,
        'ic_quality': 0.07,
        'entropy_quality': 0.03,
        # Noisy-OR weight on the language channel: flawless prose tops out at
        # 0.85, just under the weakest formal coordinate format kept in
        # pure_coords (0.90) — a coordinate is the actual goal of a geocache.
        'coord_channel': 0.85,
    }

    lang_score = (
        ngram_fitness * weights['ngram_fitness']
        + lexical * weights['lexical_coverage']
        + coherence * weights['coherence']
        + ic_v * weights['ic_quality']
        + entropy_v * weights['entropy_quality']
    )

    score = 1.0 - (1.0 - coord_score) * (1.0 - lang_score * weights['coord_channel'])
    early_exit = None

    # Apply encoded-pattern penalty as a multiplicative factor.
    # Heavily penalizes outputs that still look like hex/base64/numeric codes.
    if encoded_penalty < 1.0:
        score *= encoded_penalty
        if encoded_penalty < 0.2:
            early_exit = 'encoded_pattern'

    # No signal at all (no coordinate, no n-gram, no numbers, no recognised
    # word): force a floor. A recognised word keeps its lexical score.
    if coord_score <= 0.0 and ngram_fitness < 0.1 and numeric_signal < 0.2 and lexical <= 0.0:
        score = 0.05
        early_exit = 'ngram_low'

    score = min(1.0, max(0.0, float(score)))

    explanation = []
    if gps_conf > 0:
        explanation.append(f"GPS={gps_conf:.2f}")
    if geo:
        explanation.append(f"geo={geo['distance_km']:.1f}km ({geo['status']})")
    if langid.language != 'unknown':
        explanation.append(f"lang={langid.language} ({langid.confidence:.2f})")
    explanation.append(f"lex={lexical:.2f}")
    explanation.append(f"coh={coherence:.2f}")
    if numeric_signal > 0:
        explanation.append(f"num_sig={numeric_signal:.2f}")
    if encoded_penalty < 1.0:
        explanation.append(f"enc_pen={encoded_penalty:.2f}")

    return ScoreResult(
        score=float(score),
        metadata={
            'scoring': {
                'score': float(score),
                'early_exit': early_exit,
                'language_detected': langid.language,
                'language_confidence': float(langid.confidence),
                'words_found': words_found,
                # Text with glued words split apart, when a split was found.
                'segmented_text': word_text if segmentation_lang else None,
                'segmentation_language': segmentation_lang,
                'gps_patterns': [gps_details.get('ddm')] if gps_details.get('exist') else [],
                'gps_source': gps_details.get('source'),
                # Distance to the cache when its coordinates were given:
                # {distance_km, status, gps_confidence_raw}, else None.
                'geo': geo,
                'features': {
                    'ic': float(ic),
                    'entropy': float(entropy),
                    'gps_confidence': float(gps_conf),
                    'ngram_fitness': float(ngram_fitness),
                    'trigram_fitness': float(trigram_fitness),
                    'quadgram_fitness': float(quadgram_fitness),
                    'repetition_quality': float(repetition_quality),
                    'numeric_signal': float(numeric_signal),
                    'coord_score': float(coord_score),
                    'encoded_penalty': float(encoded_penalty),
                    'lexical_coverage': float(lexical),
                    'coherence': float(coherence),
                    'ic_quality': float(ic_v),
                    'entropy_quality': float(entropy_v),
                },
                'weights': weights,
                'explanation': ' | '.join(explanation),
            }
        }
    )


@lru_cache(maxsize=1000)
def _cached_score(text: str, origin: Optional[Tuple[float, float]] = None) -> ScoreResult:
    return _compute_score(text, origin)


def score_text(text: str, context: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Score a text. ``context`` may carry the cache's coordinates (see
    _origin_from_context): coordinates found in the text are then weighed by
    their distance to the cache. Every other context key is ignored, and only
    the origin enters the cache key.
    """
    result = _cached_score(text, _origin_from_context(context))
    return {
        'score': result.score,
        'metadata': copy.deepcopy(result.metadata),
    }


# ── Fast scoring for bruteforce pre-filtering ────────────────────────

def _compute_ic_from_letters(letters: str) -> float:
    """IC from pre-normalised uppercase-only string."""
    n = len(letters)
    if n < 2:
        return 0.0
    counts: Dict[str, int] = {}
    for ch in letters:
        counts[ch] = counts.get(ch, 0) + 1
    numerator = sum(v * (v - 1) for v in counts.values())
    denominator = n * (n - 1)
    return float(numerator / denominator) if denominator else 0.0


def _repetition_quality_from_letters(letters: str) -> float:
    """Repetition quality from pre-normalised uppercase-only string."""
    if len(letters) < 12:
        return 1.0
    max_run = 1
    run = 1
    for i in range(1, len(letters)):
        if letters[i] == letters[i - 1]:
            run += 1
            if run > max_run:
                max_run = run
        else:
            run = 1
    if max_run >= 5:
        return 0.0
    if max_run == 4:
        return 0.2
    if max_run == 3:
        return 0.6
    unique_ratio = len(set(letters)) / max(1, len(letters))
    if unique_ratio < 0.12:
        return 0.2
    if unique_ratio < 0.18:
        return 0.6
    return 1.0


@lru_cache(maxsize=4096)
def _score_text_fast_cached(letters: str) -> float:
    """Inner cached implementation of score_text_fast."""
    n = len(letters)
    if n < 4:
        return 0.0

    # Tier 0: instant reject on repetition
    rep = _repetition_quality_from_letters(letters)
    if rep <= 0.0:
        return 0.0

    # Tier 0: IC check — reject if clearly random
    ic = _compute_ic_from_letters(letters)
    if ic < 0.035 and n >= 20:
        return 0.0

    # Tier 1: quadgram fitness, best of every shipped table
    best_fitness = 0.0
    for lang in available_quadgram_langs():
        fitness = _quadgram_fitness_for_lang(letters, lang)
        if fitness > best_fitness:
            best_fitness = fitness

    # Hard gate: if quadgram fitness is very low, this isn't natural language
    # (monoalphabetic substitutions preserve IC but destroy quadgrams)
    if best_fitness < 0.15:
        return float(best_fitness * 0.3)

    # Combine: quadgram-dominant formula
    ic_norm = max(0.0, min(1.0, (ic - 0.045) / 0.03))
    score = best_fitness * 0.75 + ic_norm * 0.10 + rep * 0.15
    return float(min(1.0, score))


def score_text_fast(text: str) -> float:
    """Cheap tier-0/tier-1 scoring for bruteforce pre-filtering.

    Returns a float 0..1.  Much faster than score_text() because it skips
    GPS detection, language detection, and lexical features.
    Uses only: IC, repetition quality, quadgram fitness (EN fallback),
    encoded-pattern penalty, and a lightweight numeric-signal boost.

    Typical cost: ~0.05 ms per call vs ~1-5 ms for full score_text().
    Results are LRU-cached (4096 entries) keyed by normalised letters.
    """
    # Early penalty for still-encoded output (hex pairs, base64, etc.)
    enc_pen = _encoded_pattern_penalty(text)
    if enc_pen < 0.1:
        return 0.0

    # Coordinate-shaped text gets a pass-through floor: this scorer runs no GPS
    # detection, so the full scorer must be the one to decide.
    gps_floor = _FAST_GPS_HINT_FLOOR * enc_pen if _gps_structured_hint(text) else 0.0

    letters = _normalize_for_stats(text)
    if len(letters) < 4:
        # Very few letters — likely a bare coordinate string. The quadgram
        # path can't help, but the numeric signal (digit groups / number
        # words) can rescue genuine coordinate fragments.
        nr = _numeric_signal_feature(text)
        if nr > 0.3:
            return float(max(gps_floor, min(0.5, nr * enc_pen)))
        return float(gps_floor)

    base_score = _score_text_fast_cached(letters)

    # Apply encoded-pattern penalty
    if enc_pen < 1.0:
        base_score *= enc_pen

    # Lightweight numeric boost: if quadgrams gave a decent score AND the text
    # carries a numeric signal, nudge the score up so the full scorer gets a
    # chance to evaluate it properly.
    if base_score > 0.05:
        nr = _numeric_signal_feature(text)
        if nr > 0.2:
            base_score = min(1.0, base_score + nr * 0.15)

    return float(max(base_score, gps_floor))


def score_and_rank_results(
    results: List[Dict[str, Any]],
    *,
    top_k: int = 25,
    min_score: float = 0.05,
    fast_reject_threshold: float = 0.02,
    context: Optional[Dict[str, Any]] = None,
) -> List[Dict[str, Any]]:
    """Score a batch of plugin results with tiered pruning and top-K selection.

    Pipeline:
      1. Tier 0 — fast reject via score_text_fast() (< 0.1ms each)
      2. Sort survivors by fast score, keep top max(top_k*3, 75, 10% of the
         lot) plus anything tied with the last one kept
      3. Tier 1 — full score_text() on survivors
      4. Filter by min_score, sort descending, return top_k

    Each result dict must have 'text_output'.  The function mutates results
    in place (adds/updates 'confidence' and 'metadata.scoring').

    Returns the ranked, pruned list.
    """
    if not results:
        return []

    # Collect valid items
    valid_items: List[Dict[str, Any]] = []
    for item in results:
        text_output = item.get('text_output')
        if isinstance(text_output, str) and text_output.strip():
            valid_items.append(item)

    if not valid_items:
        return []

    # For small result sets, skip fast-reject and score everything directly
    use_fast_filter = len(valid_items) > top_k

    if use_fast_filter:
        # Phase 1: fast scoring for bruteforce-sized result sets
        scored_fast: List[Tuple[float, int, Dict[str, Any]]] = []
        for idx, item in enumerate(valid_items):
            text_output = item['text_output']
            fast_score = score_text_fast(text_output)
            if fast_score < fast_reject_threshold:
                continue
            scored_fast.append((fast_score, idx, item))

        # Phase 2: keep the best candidates for full scoring. The cut grows
        # with the lot: on a one-word answer the fast score rests on a window
        # or two, so in a lot of thousands a few percent of the wrong
        # candidates outscore the right one by chance. Candidates tied with
        # the last one kept are kept too — the fast score saturates, and
        # cutting through a tie would drop candidates arbitrarily.
        scored_fast.sort(key=lambda x: x[0], reverse=True)
        tier2_limit = max(top_k * 3, 75, math.ceil(len(valid_items) * _PREFILTER_KEEP_SHARE))
        if tier2_limit < len(scored_fast):
            cutoff = scored_fast[tier2_limit - 1][0]
            while tier2_limit < len(scored_fast) and scored_fast[tier2_limit][0] >= cutoff:
                tier2_limit += 1
        candidates = [item for (_fs, _i, item) in scored_fast[:tier2_limit]]
    else:
        candidates = valid_items

    # Phase 3: full scoring on survivors
    ranked: List[Dict[str, Any]] = []
    for item in candidates:
        text_output = item['text_output']
        scored = score_text(text_output, context=context)
        full_score = float(scored.get('score') or 0.0)

        item['confidence'] = full_score
        item_metadata = item.get('metadata')
        if not isinstance(item_metadata, dict):
            item_metadata = {}
            item['metadata'] = item_metadata
        scoring_meta = scored.get('metadata')
        if isinstance(scoring_meta, dict) and isinstance(scoring_meta.get('scoring'), dict):
            item_metadata['scoring'] = scoring_meta['scoring']

        ranked.append(item)

    # Phase 4: filter by min_score, sort, and return top-K
    if min_score > 0:
        ranked = [r for r in ranked if r.get('confidence', 0.0) >= min_score]
    ranked.sort(key=lambda r: r.get('confidence', 0.0), reverse=True)
    return ranked[:top_k]
