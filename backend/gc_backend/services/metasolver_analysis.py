"""
Service d'analyse pour le metasolver.

Ce module contient la logique de :
- Analyse de signature d'un texte (détection de patterns : Morse, binaire, hex, etc.)
- Scoring des plugins candidats en fonction de la signature
- Collection des plugins éligibles selon les presets et modes
- Recommandation de plugins pour le metasolver
"""

import json
import re
from pathlib import Path
from typing import Dict, Any, List, Optional

from ..plugins import PluginManager


# ─────────────────────────────────────────────────────────────────────────────
# Constantes
# ─────────────────────────────────────────────────────────────────────────────

CHEMICAL_SYMBOLS = frozenset({
    'H', 'HE', 'LI', 'BE', 'B', 'C', 'N', 'O', 'F', 'NE',
    'NA', 'MG', 'AL', 'SI', 'P', 'S', 'CL', 'AR', 'K', 'CA',
    'SC', 'TI', 'V', 'CR', 'MN', 'FE', 'CO', 'NI', 'CU', 'ZN',
    'GA', 'GE', 'AS', 'SE', 'BR', 'KR', 'RB', 'SR', 'Y', 'ZR',
    'NB', 'MO', 'TC', 'RU', 'RH', 'PD', 'AG', 'CD', 'IN', 'SN',
    'SB', 'TE', 'I', 'XE', 'CS', 'BA', 'LA', 'CE', 'PR', 'ND',
    'PM', 'SM', 'EU', 'GD', 'TB', 'DY', 'HO', 'ER', 'TM', 'YB',
    'LU', 'HF', 'TA', 'W', 'RE', 'OS', 'IR', 'PT', 'AU', 'HG',
    'TL', 'PB', 'BI', 'PO', 'AT', 'RN', 'FR', 'RA', 'AC', 'TH',
    'PA', 'U', 'NP', 'PU', 'AM', 'CM', 'BK', 'CF', 'ES', 'FM',
    'MD', 'NO', 'LR', 'RF', 'DB', 'SG', 'BH', 'HS', 'MT', 'DS',
    'RG', 'CN', 'NH', 'FL', 'MC', 'LV', 'TS', 'OG',
})

HOUDINI_WORDS = frozenset({
    'PRAY', 'ANSWER', 'SAY', 'NOW', 'TELL',
    'PLEASE', 'SPEAK', 'QUICKLY', 'LOOK', 'BE QUICK',
})

NAK_NAK_WORDS = frozenset({
    'NAK', 'NANAK', 'NANANAK', 'NANANANAK',
    'NAK?', 'NAKNAK', 'NAKNAKNAK', 'NAK.',
    'NAKNAK.', 'NAKNAKNAKNAK', 'NAK!',
})

SHADOK_SYLLABLE_PATTERN = re.compile(r'^(?:GA|BU|ZO|MEU|ME)+$', re.IGNORECASE)
TOM_TOM_TOKEN_PATTERN = re.compile(r'^[\\/]{1,5}$')
GOLD_BUG_SYMBOLS = frozenset('0123456789-*,.$();?:[]')


# ─────────────────────────────────────────────────────────────────────────────
# Fonctions utilitaires internes
# ─────────────────────────────────────────────────────────────────────────────

def _detect_dominant_input_kind(letter_count: int, digit_count: int, symbol_count: int, word_count: int) -> str:
    present = [name for name, value in (
        ('letters', letter_count),
        ('digits', digit_count),
        ('symbols', symbol_count),
    ) if value > 0]

    if not present:
        return 'empty'
    if len(present) == 1 and present[0] == 'letters' and word_count >= 2:
        return 'words'
    if len(present) == 1:
        return present[0]
    return 'mixed'


def _is_prime(value: int) -> bool:
    if value < 2:
        return False
    if value == 2:
        return True
    if value % 2 == 0:
        return False

    divisor = 3
    while divisor * divisor <= value:
        if value % divisor == 0:
            return False
        divisor += 2

    return True


def _normalize_postnet_candidate(text: str) -> Optional[str]:
    compact = ''.join(char for char in (text or '') if not char.isspace())
    if not compact:
        return None

    if set(compact) <= set('01'):
        return compact

    normalized: List[str] = []
    for char in compact:
        if char in '|I':
            normalized.append('1')
            continue
        if char in '.-_':
            normalized.append('0')
            continue
        return None

    return ''.join(normalized)


def _candidate_name_matches(candidate: Dict[str, Any], *fragments: str) -> bool:
    name = (candidate.get('name') or '').lower()
    description = (candidate.get('description') or '').lower()
    return any(fragment in name or fragment in description for fragment in fragments)


# ─────────────────────────────────────────────────────────────────────────────
# Analyse de signature
# ─────────────────────────────────────────────────────────────────────────────

def analyze_metasolver_signature(text: str) -> Dict[str, Any]:
    """
    Analyse un texte et produit une signature décrivant ses caractéristiques
    (type d'entrée dominant, patterns détectés comme Morse, binaire, hex, etc.).
    """
    raw_text = text or ''
    trimmed = raw_text.strip()
    non_space = [char for char in trimmed if not char.isspace()]
    compact = ''.join(non_space)
    compact_upper = compact.upper()
    tokens = [token for token in re.split(r'\s+', trimmed) if token]

    letter_count = sum(1 for char in non_space if char.isalpha())
    digit_count = sum(1 for char in non_space if char.isdigit())
    symbol_count = sum(1 for char in non_space if not char.isalnum())
    whitespace_count = sum(1 for char in trimmed if char.isspace())
    total_non_space = len(non_space)

    charsets_present = [name for name, value in (
        ('letters', letter_count),
        ('digits', digit_count),
        ('symbols', symbol_count),
    ) if value > 0]

    word_count = len([token for token in tokens if any(char.isalpha() for char in token)])
    average_token_length = (
        round(sum(len(token) for token in tokens) / len(tokens), 2)
        if tokens else 0.0
    )
    separators = sorted({char for char in trimmed if not char.isalnum() and not char.isspace()})

    binary_candidate = re.sub(r'[\s|,;:_/-]+', '', trimmed)
    hex_candidate = re.sub(r'[\s|,;:_/-]+', '', compact_upper)
    digit_candidate = re.sub(r'\D', '', trimmed)
    bacon_candidate = re.sub(r'[\s|,;:_/-]+', '', compact_upper)
    numeric_tokens = [int(token) for token in tokens if re.fullmatch(r'\d+', token)]
    grouped_numeric_tokens = [int(token) for token in re.findall(r'\d+', trimmed)]
    alpha_tokens_upper = [token.upper() for token in tokens if token.isalpha()]
    stripped_tokens = [re.sub(r'^[^\w?!.]+|[^\w?!.]+$', '', token) for token in tokens]
    normalized_word_tokens = [token.upper() for token in stripped_tokens if any(char.isalpha() for char in token)]
    tom_tom_tokens = [token for token in re.split(r'[\s.:;,_-]+', trimmed) if token]
    postnet_candidate = _normalize_postnet_candidate(trimmed)

    merged_houdini_tokens: List[str] = []
    index = 0
    while index < len(normalized_word_tokens):
        token = normalized_word_tokens[index]
        if token == 'BE' and index + 1 < len(normalized_word_tokens) and normalized_word_tokens[index + 1] == 'QUICK':
            merged_houdini_tokens.append('BE QUICK')
            index += 2
            continue
        merged_houdini_tokens.append(token)
        index += 1

    looks_like_morse = bool(compact) and set(compact) <= set('.-/|') and any(char in compact for char in '.-')
    looks_like_binary = bool(binary_candidate) and len(binary_candidate) >= 6 and set(binary_candidate) <= set('01')
    looks_like_hex = (
        bool(hex_candidate)
        and len(hex_candidate) >= 4
        and set(hex_candidate) <= set('0123456789ABCDEF')
        and any(char in 'ABCDEF' for char in hex_candidate)
    )
    looks_like_phone_keypad = bool(digit_candidate) and len(digit_candidate) >= 4 and set(digit_candidate) <= set('23456789')
    looks_like_roman = (
        bool(compact_upper)
        and letter_count > 0
        and digit_count == 0
        and symbol_count == 0
        and set(compact_upper) <= set('IVXLCDM')
        and len(compact_upper) >= 2
    )
    looks_like_decimal_sequence = digit_count > 0 and letter_count == 0 and len(tokens) >= 2
    looks_like_a1z26 = (
        len(numeric_tokens) >= 2
        and len(numeric_tokens) == len(tokens)
        and all(1 <= token <= 26 for token in numeric_tokens)
    )
    looks_like_tap_code = (
        len(tokens) >= 4
        and len(tokens) % 2 == 0
        and all(re.fullmatch(r'[1-5]', token) for token in tokens)
    ) or bool(re.search(r'(?:X+|\.+)\s+(?:X+|\.+)', trimmed))
    looks_like_polybius = len(tokens) >= 2 and all(re.fullmatch(r'[1-6]{2}', token) for token in tokens)
    looks_like_multitap = (
        len(tokens) >= 2
        and all(re.fullmatch(r'([2-9])\1{0,3}', token) for token in tokens)
        and any(len(token) > 1 for token in tokens)
    )
    looks_like_chemical_symbols = (
        len(alpha_tokens_upper) >= 2
        and len(alpha_tokens_upper) == len(tokens)
        and all(token in CHEMICAL_SYMBOLS for token in alpha_tokens_upper)
    )
    looks_like_houdini_words = (
        len(merged_houdini_tokens) >= 2
        and len(merged_houdini_tokens) == len(normalized_word_tokens)
        and all(token in HOUDINI_WORDS for token in merged_houdini_tokens)
    )
    looks_like_nak_nak = (
        len(normalized_word_tokens) >= 2
        and len(normalized_word_tokens) == len(tokens)
        and all(token in NAK_NAK_WORDS for token in normalized_word_tokens)
    )
    looks_like_shadok = (
        len(normalized_word_tokens) >= 2
        and len(normalized_word_tokens) == len(tokens)
        and all(SHADOK_SYLLABLE_PATTERN.fullmatch(token) for token in normalized_word_tokens)
    )
    looks_like_tom_tom = (
        len(tom_tom_tokens) >= 2
        and all(TOM_TOM_TOKEN_PATTERN.fullmatch(token) for token in tom_tom_tokens)
        and any('\\' in token for token in tom_tom_tokens)
    )
    looks_like_gold_bug = (
        len(non_space) >= 5
        and letter_count == 0
        and all(char in GOLD_BUG_SYMBOLS for char in non_space)
        and len({char for char in non_space if not char.isdigit()}) >= 2
    )
    looks_like_postnet = False
    if postnet_candidate and len(postnet_candidate) >= 12:
        data_portion = (
            postnet_candidate[1:-1]
            if len(postnet_candidate) >= 2 and postnet_candidate.startswith('1') and postnet_candidate.endswith('1')
            else postnet_candidate
        )
        if len(data_portion) >= 10 and len(data_portion) % 5 == 0:
            chunks = [data_portion[index:index + 5] for index in range(0, len(data_portion), 5)]
            looks_like_postnet = all(chunk.count('1') == 2 for chunk in chunks)
    looks_like_prime_sequence = (
        len(numeric_tokens) >= 3
        and len(numeric_tokens) == len(tokens)
        and all(_is_prime(token) for token in numeric_tokens)
    )
    looks_like_pi_index_positions = (
        len(grouped_numeric_tokens) >= 6
        and max(grouped_numeric_tokens or [0]) > 26
        and max(grouped_numeric_tokens or [0]) <= 10_000
        and len({token for token in grouped_numeric_tokens}) >= 4
        and bool(re.search(r'[,;:/_-]', trimmed))
    )
    looks_like_bacon = (
        bool(bacon_candidate)
        and len(bacon_candidate) >= 10
        and len(bacon_candidate) % 5 == 0
        and set(bacon_candidate) <= set('AB')
    )
    looks_like_coordinate_fragment = bool(re.search(r'[NSEW]\s*\d|[0-9]+\s*[°º]|[0-9]+[.,][0-9]+', trimmed, re.IGNORECASE))

    dominant_input_kind = _detect_dominant_input_kind(letter_count, digit_count, symbol_count, word_count)

    if looks_like_postnet or looks_like_gold_bug:
        suggested_preset = 'all'
    elif looks_like_morse:
        suggested_preset = 'symbols_only'
    elif looks_like_tom_tom:
        suggested_preset = 'symbols_only'
    elif looks_like_houdini_words or looks_like_nak_nak or looks_like_shadok or looks_like_chemical_symbols:
        suggested_preset = 'words_only'
    elif looks_like_pi_index_positions:
        suggested_preset = 'numeral'
    elif dominant_input_kind == 'digits':
        suggested_preset = 'digits_only'
    elif dominant_input_kind == 'symbols':
        suggested_preset = 'symbols_only'
    elif dominant_input_kind == 'words':
        suggested_preset = 'words_only'
    elif dominant_input_kind == 'letters':
        suggested_preset = 'letters_only'
    else:
        suggested_preset = 'frequent'

    return {
        'raw_length': len(raw_text),
        'trimmed_length': len(trimmed),
        'non_space_length': total_non_space,
        'letter_count': letter_count,
        'digit_count': digit_count,
        'symbol_count': symbol_count,
        'whitespace_count': whitespace_count,
        'word_count': word_count,
        'group_count': len(tokens),
        'average_group_length': average_token_length,
        'charsets_present': charsets_present,
        'dominant_input_kind': dominant_input_kind,
        'separators': separators,
        'looks_like_morse': looks_like_morse,
        'looks_like_binary': looks_like_binary,
        'looks_like_hex': looks_like_hex,
        'looks_like_phone_keypad': looks_like_phone_keypad,
        'looks_like_roman_numerals': looks_like_roman,
        'looks_like_decimal_sequence': looks_like_decimal_sequence,
        'looks_like_a1z26': looks_like_a1z26,
        'looks_like_tap_code': looks_like_tap_code,
        'looks_like_polybius': looks_like_polybius,
        'looks_like_multitap': looks_like_multitap,
        'looks_like_chemical_symbols': looks_like_chemical_symbols,
        'looks_like_houdini_words': looks_like_houdini_words,
        'looks_like_nak_nak': looks_like_nak_nak,
        'looks_like_shadok': looks_like_shadok,
        'looks_like_tom_tom': looks_like_tom_tom,
        'looks_like_gold_bug': looks_like_gold_bug,
        'looks_like_postnet': looks_like_postnet,
        'looks_like_prime_sequence': looks_like_prime_sequence,
        'looks_like_pi_index_positions': looks_like_pi_index_positions,
        'looks_like_bacon': looks_like_bacon,
        'looks_like_coordinate_fragment': looks_like_coordinate_fragment,
        'suggested_preset': suggested_preset,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Scoring des candidats
# ─────────────────────────────────────────────────────────────────────────────

def score_metasolver_candidate(candidate: Dict[str, Any], signature: Dict[str, Any]) -> Dict[str, Any]:
    """
    Calcule le score d'un plugin candidat en fonction de la signature du texte.
    """
    score = float(candidate.get('priority', 50))
    reasons: List[str] = []

    candidate_charset = candidate.get('input_charset') or ''
    dominant_kind = signature.get('dominant_input_kind')
    charsets_present = set(signature.get('charsets_present') or [])
    tags = set(candidate.get('tags') or [])
    preferred_when = list(candidate.get('preferred_when') or [])
    requires_key = bool(candidate.get('requires_key', False))
    supports_grouped_input = bool(candidate.get('supports_grouped_input', False))

    if candidate_charset == dominant_kind:
        score += 40
        reasons.append(f"Correspondance directe avec l'entrée {dominant_kind}")
    elif dominant_kind == 'mixed' and candidate_charset in charsets_present:
        score += 18
        reasons.append(f"Compatible avec une entrée mixte contenant {candidate_charset}")
    elif dominant_kind == 'words' and candidate_charset == 'letters':
        score += 15
        reasons.append("Compatible avec un texte composé de mots")
    elif candidate_charset and dominant_kind not in ('mixed', 'empty'):
        score -= 10

    if dominant_kind in ('letters', 'words') and 'substitution' in tags:
        score += 12
        reasons.append("Tag substitution cohérent avec une entrée textuelle")

    if dominant_kind == 'digits' and 'numeral' in tags:
        score += 20
        reasons.append("Tag numeral cohérent avec une entrée numérique")

    if signature.get('looks_like_morse'):
        if _candidate_name_matches(candidate, 'morse'):
            score += 150
            reasons.append("Le texte ressemble fortement à du Morse")
        elif candidate_charset == 'symbols':
            score += 12

    if signature.get('looks_like_binary'):
        if _candidate_name_matches(candidate, 'base', 'binary'):
            score += 100
            reasons.append("Le texte ressemble à une séquence binaire")
        elif 'numeral' in tags:
            score += 20

    if signature.get('looks_like_hex'):
        if _candidate_name_matches(candidate, 'base', 'hex'):
            score += 90
            reasons.append("Le texte ressemble à une séquence hexadécimale")
        elif 'numeral' in tags:
            score += 20

    if signature.get('looks_like_phone_keypad') and _candidate_name_matches(candidate, 't9', 'phone', 'keypad'):
        score += 120
        reasons.append("Le texte ressemble à une saisie type T9")

    if signature.get('looks_like_multitap') and _candidate_name_matches(candidate, 'multitap', 'multi tap'):
        score += 140
        reasons.append("Le texte ressemble à un code Multitap")

    if signature.get('looks_like_chemical_symbols') and _candidate_name_matches(candidate, 'chemical', 'element'):
        score += 140
        reasons.append("Le texte ressemble à des symboles chimiques")

    if signature.get('looks_like_houdini_words') and _candidate_name_matches(candidate, 'houdini'):
        score += 150
        reasons.append("Le texte ressemble à du code Houdini")

    if signature.get('looks_like_nak_nak') and _candidate_name_matches(candidate, 'nak'):
        score += 160
        reasons.append("Le texte ressemble à du code Nak Nak")

    if signature.get('looks_like_shadok') and _candidate_name_matches(candidate, 'shadok'):
        score += 150
        reasons.append("Le texte ressemble à de la numération Shadok")

    if signature.get('looks_like_tom_tom') and _candidate_name_matches(candidate, 'tom'):
        score += 180
        reasons.append("Le texte ressemble à du code Tom Tom")

    if signature.get('looks_like_gold_bug') and _candidate_name_matches(candidate, 'gold', 'scarab'):
        score += 180
        reasons.append("Le texte ressemble à du Gold-Bug")

    if signature.get('looks_like_postnet') and _candidate_name_matches(candidate, 'postnet', 'barcode'):
        score += 260
        reasons.append("Le texte ressemble à un code POSTNET")

    if signature.get('looks_like_prime_sequence') and _candidate_name_matches(candidate, 'prime'):
        score += 130
        reasons.append("Le texte ressemble à une séquence de nombres premiers")

    if signature.get('looks_like_pi_index_positions') and _candidate_name_matches(candidate, 'pi'):
        score += 180
        reasons.append("Le texte ressemble a des positions indexees dans les decimales de Pi")
    elif signature.get('looks_like_pi_index_positions') and 'numeral' in tags:
        score += 18

    if signature.get('looks_like_roman_numerals') and _candidate_name_matches(candidate, 'roman'):
        score += 120
        reasons.append("Le texte ressemble à des chiffres romains")

    if signature.get('looks_like_polybius') and _candidate_name_matches(candidate, 'polybius', 'polybe'):
        score += 140
        reasons.append("Le texte ressemble à des coordonnées Polybe / Polybius")

    if signature.get('looks_like_tap_code') and _candidate_name_matches(candidate, 'tap'):
        score += 120
        reasons.append("Le texte ressemble à du Tap Code")

    if signature.get('looks_like_decimal_sequence') and candidate_charset == 'digits':
        score += 15
        reasons.append("Entrée découpée en groupes numériques")

    if signature.get('looks_like_coordinate_fragment') and _candidate_name_matches(candidate, 'coord', 'gps'):
        score += 60
        reasons.append("Le texte ressemble à un fragment de coordonnées")

    preferred_condition_map = {
        'letters_only': (dominant_kind == 'letters', "Optimisé pour une entrée uniquement en lettres"),
        'digits_only': (dominant_kind == 'digits', "Optimisé pour une entrée uniquement en chiffres"),
        'symbols_only': (dominant_kind == 'symbols', "Optimisé pour une entrée symbolique"),
        'words_only': (dominant_kind == 'words', "Optimisé pour une entrée composée de mots"),
        'mixed_input': (dominant_kind == 'mixed', "Compatible avec une entrée mixte"),
        'grouped_input': (int(signature.get('group_count', 0)) > 1, "Compatible avec une entrée découpée en groupes"),
        'short_input': (int(signature.get('non_space_length', 0)) <= 12, "Pertinent sur des entrées courtes"),
        'long_input': (int(signature.get('non_space_length', 0)) >= 24, "Pertinent sur des entrées longues"),
        'morse_like': (bool(signature.get('looks_like_morse')), "Le motif détecté correspond au Morse"),
        'binary_like': (bool(signature.get('looks_like_binary')), "Le motif détecté correspond à du binaire"),
        'hex_like': (bool(signature.get('looks_like_hex')), "Le motif détecté correspond à de l'hexadécimal"),
        't9_like': (bool(signature.get('looks_like_phone_keypad')), "Le motif détecté correspond à une saisie T9"),
        'chemical_like': (bool(signature.get('looks_like_chemical_symbols')), "Le motif détecté correspond à des symboles chimiques"),
        'houdini_like': (bool(signature.get('looks_like_houdini_words')), "Le motif détecté correspond à du code Houdini"),
        'nak_nak_like': (bool(signature.get('looks_like_nak_nak')), "Le motif détecté correspond à du code Nak Nak"),
        'shadok_like': (bool(signature.get('looks_like_shadok')), "Le motif détecté correspond à de la numération Shadok"),
        'tom_tom_like': (bool(signature.get('looks_like_tom_tom')), "Le motif détecté correspond à du code Tom Tom"),
        'gold_bug_like': (bool(signature.get('looks_like_gold_bug')), "Le motif détecté correspond à du Gold-Bug"),
        'postnet_like': (bool(signature.get('looks_like_postnet')), "Le motif détecté correspond à du POSTNET"),
        'prime_like': (bool(signature.get('looks_like_prime_sequence')), "Le motif détecté correspond à une séquence de nombres premiers"),
        'pi_index_positions_like': (bool(signature.get('looks_like_pi_index_positions')), "Le motif detecte correspond a des positions indexees pour Pi"),
        'roman_like': (bool(signature.get('looks_like_roman_numerals')), "Le motif détecté correspond à des chiffres romains"),
        'a1z26_like': (bool(signature.get('looks_like_a1z26')), "Le motif détecté correspond à un code A1Z26"),
        'tap_code_like': (bool(signature.get('looks_like_tap_code')), "Le motif détecté correspond à du Tap Code"),
        'polybius_like': (bool(signature.get('looks_like_polybius')), "Le motif détecté correspond à du Polybius"),
        'multitap_like': (bool(signature.get('looks_like_multitap')), "Le motif détecté correspond à du Multitap"),
        'bacon_like': (bool(signature.get('looks_like_bacon')), "Le motif détecté correspond à du Bacon"),
        'digit_groups': (bool(signature.get('looks_like_decimal_sequence')), "L'entrée est segmentée en groupes numériques"),
        'coordinate_fragment': (bool(signature.get('looks_like_coordinate_fragment')), "L'entrée ressemble à un fragment de coordonnées"),
    }

    matched_preferences = [
        preferred_condition_map[condition][1]
        for condition in preferred_when
        if condition in preferred_condition_map and preferred_condition_map[condition][0]
    ]
    if matched_preferences:
        score += 24 * len(matched_preferences)
        reasons.extend(matched_preferences)

    if supports_grouped_input and int(signature.get('group_count', 0)) > 1:
        score += 6
        reasons.append("Supporte explicitement les entrées groupées")

    if requires_key:
        score -= 18
        reasons.append("Nécessite souvent une clé ou un indice supplémentaire")

    if 'frequent' in tags:
        score += 8
        reasons.append("Code fréquent en géocaching")

    if 'no_key' in tags:
        score += 5
        reasons.append("Ne nécessite pas de clé explicite")

    return {
        **candidate,
        'score': round(score, 2),
        'reasons': list(dict.fromkeys(reasons)),
    }


# ─────────────────────────────────────────────────────────────────────────────
# Collection des candidats et presets
# ─────────────────────────────────────────────────────────────────────────────

def load_metasolver_presets(manager: PluginManager) -> Dict[str, Any]:
    """Charge les presets depuis le fichier presets.json du plugin metasolver."""
    presets_path = Path(manager.plugins_dir) / 'official' / 'metasolver' / 'presets.json'
    try:
        with presets_path.open('r', encoding='utf-8') as handle:
            return json.load(handle).get('presets') or {}
    except Exception:
        return {}


def matches_metasolver_filter(metasolver_meta: Dict[str, Any], preset_filter: Optional[Dict[str, Any]]) -> bool:
    """Vérifie si un plugin correspond au filtre d'un preset."""
    if not preset_filter:
        return True

    filter_tags = preset_filter.get('tags')
    if filter_tags:
        plugin_tags = set(metasolver_meta.get('tags') or [])
        if not plugin_tags.intersection(filter_tags):
            return False

    filter_charsets = preset_filter.get('input_charset')
    if filter_charsets:
        plugin_charset = metasolver_meta.get('input_charset', '')
        if plugin_charset not in filter_charsets:
            return False

    return True


def collect_metasolver_candidates(
    *,
    preset_filter: Optional[Dict[str, Any]] = None,
    mode: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """
    Collecte tous les plugins éligibles au metasolver depuis la base de données,
    filtrés par preset et mode.
    """
    from ..plugins.models import Plugin as PluginModel

    all_plugins = PluginModel.query.filter_by(enabled=True).all()
    candidates: List[Dict[str, Any]] = []

    for plugin in all_plugins:
        try:
            metadata = json.loads(plugin.metadata_json) if plugin.metadata_json else {}
        except Exception:
            continue

        metasolver_meta = metadata.get('metasolver') or {}
        if not metasolver_meta.get('eligible'):
            continue

        capabilities = metadata.get('capabilities') or {}
        if mode == 'detect' and not capabilities.get('analyze'):
            continue
        if mode == 'decode' and not capabilities.get('decode'):
            continue

        if not matches_metasolver_filter(metasolver_meta, preset_filter):
            continue

        priority = metasolver_meta.get('priority', 50)
        try:
            priority = int(priority)
        except Exception:
            priority = 50

        candidates.append({
            'name': plugin.name,
            'description': plugin.description or '',
            'input_charset': metasolver_meta.get('input_charset') or '',
            'tags': list(metasolver_meta.get('tags') or []),
            'priority': priority,
            'capabilities': capabilities,
            'family': metasolver_meta.get('family'),
            'preferred_when': list(metasolver_meta.get('preferred_when') or []),
            'requires_key': bool(metasolver_meta.get('requires_key', False)),
            'supports_grouped_input': bool(metasolver_meta.get('supports_grouped_input', False)),
        })

    candidates.sort(key=lambda item: (-item['priority'], item['name']))
    return candidates


# ─────────────────────────────────────────────────────────────────────────────
# Recommandation de plugins
# ─────────────────────────────────────────────────────────────────────────────

def normalize_max_plugins(value: Any, default: int = 8) -> int:
    """Normalise la valeur max_plugins en entier positif."""
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return default
    if parsed <= 0:
        return default
    return parsed


def recommend_metasolver_plugins(
    *,
    manager: PluginManager,
    text: str,
    requested_preset: str = '',
    mode: str = 'decode',
    max_plugins: int = 8,
) -> Dict[str, Any]:
    """
    Analyse un texte et recommande une liste de plugins metasolver à exécuter,
    triés par pertinence.
    """
    presets = load_metasolver_presets(manager)
    signature = analyze_metasolver_signature(text)

    normalized_mode = mode if mode in {'decode', 'detect'} else 'decode'
    effective_preset = requested_preset or signature.get('suggested_preset') or 'frequent'
    if effective_preset not in presets:
        effective_preset = 'all'

    preset_info = presets.get(effective_preset, {})
    preset_filter = preset_info.get('filter') or {}
    candidates = collect_metasolver_candidates(preset_filter=preset_filter, mode=normalized_mode)
    scored = [score_metasolver_candidate(candidate, signature) for candidate in candidates]
    scored.sort(key=lambda item: (-item['score'], -item['priority'], item['name']))

    selected = scored[:max_plugins]
    top_score = selected[0]['score'] if selected and selected[0]['score'] else 1.0

    recommendations = []
    for item in selected:
        confidence = round(min(1.0, max(0.0, item['score'] / top_score)), 3)
        recommendations.append({
            **item,
            'confidence': confidence,
        })

    selected_plugins = [item['name'] for item in recommendations]
    explanation = [
        f"Signature dominante: {signature.get('dominant_input_kind')}",
        f"Preset effectif: {effective_preset}",
        f"Plugins recommandes: {len(selected_plugins)} / {len(scored)} eligibles",
    ]

    return {
        'requested_preset': requested_preset or None,
        'effective_preset': effective_preset,
        'effective_preset_label': preset_info.get('label', effective_preset),
        'preset_filter': preset_filter or None,
        'mode': normalized_mode,
        'max_plugins': max_plugins,
        'signature': signature,
        'recommendations': recommendations,
        'selected_plugins': selected_plugins,
        'plugin_list': ', '.join(selected_plugins),
        'eligible_total': len(scored),
        'available_presets': {
            name: {'label': value.get('label', name), 'description': value.get('description', '')}
            for name, value in presets.items()
        },
        'explanation': explanation,
    }
