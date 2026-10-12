"""Analyse de listing pour le blueprint plugins.

Regroupe les helpers d'analyse de description de geocache (contenu cache,
CSS masquant, EXIF, fragments secrets, classification) ainsi que la route
``/listing/classify``.
"""

import html
import math
import re
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlparse, unquote
from flask import jsonify, request
from loguru import logger
from typing import Dict, Any, List, Optional, Tuple

from ...geocaches.models import Geocache
from ...services.metasolver_analysis import (
    analyze_metasolver_signature as _analyze_metasolver_signature,
    normalize_max_plugins as _normalize_max_plugins,
    recommend_metasolver_plugins,
)

from ._common import (
    _normalize_positive_int,
    bp,
    get_plugin_manager,
)

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


GENERIC_IMAGE_FILENAME_TOKENS = frozenset({
    'image', 'img', 'photo', 'picture', 'pict', 'pic', 'scan', 'file',
    'attachment', 'download', 'thumb', 'thumbnail', 'small', 'medium', 'large',
    'original', 'cache', 'geocache', 'waypoint', 'wp', 'gc', 'final', 'listing',
})


NAK_NAK_WORDS = frozenset({
    'NAK', 'NANAK', 'NANANAK', 'NANANANAK',
    'NAK?', 'NAKNAK', 'NAKNAKNAK', 'NAK.',
    'NAKNAK.', 'NAKNAKNAKNAK', 'NAK!',
})


SHADOK_SYLLABLE_PATTERN = re.compile(r'^(?:GA|BU|ZO|MEU|ME)+$', re.IGNORECASE)


TOM_TOM_TOKEN_PATTERN = re.compile(r'^[\\/]{1,5}$')


GOLD_BUG_SYMBOLS = frozenset('0123456789-*,.$();?:[]')


DECIMAL_COORDINATE_PAIR_PATTERN = re.compile(
    r'(-?\d{1,2}(?:[.,]\d+)?)\s*[,;/]\s*(-?\d{1,3}(?:[.,]\d+)?)'
)


DDM_COORDINATE_PAIR_PATTERN = re.compile(r'([NS][^EW]+?)\s+([EW].+)$', re.IGNORECASE)


PI_THEME_PATTERN = re.compile(r'(?<![A-Z0-9])(?:PI(?:\s*-\s*DAY|\s+DAY)?|Π)(?![A-Z0-9])', re.IGNORECASE)


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


LISTING_CLASSIFICATION_ACTIONS: Dict[str, str] = {
    'secret_code': "Extract the most structured fragment, run a direct plugin if the family is obvious, otherwise call recommend_metasolver_plugins before metasolver.",
    'hidden_content': "Inspect HTML comments, hidden styles, CSS-hidden selectors and page source before trying decoders.",
    'formula': "List variables and coordinate placeholders, then use the formula solver workflow.",
    'word_game': "Identify the exact game type first (sudoku, crossword, anagram, etc.) before decoding.",
    'image_puzzle': "Inspect listing images and run OCR / QR / barcode tools if relevant.",
    'coord_transform': "Compare posted coordinates, waypoint notes and projection clues before estimating finals.",
    'checker_available': "Validate textual answers or final coordinates with run_checker before concluding.",
}


def _clean_listing_text(value: Any, *, preserve_lines: bool = False) -> str:
    if value is None:
        return ''

    text = html.unescape(str(value))
    text = re.sub(r'<script\b[^>]*>.*?</script>', ' ', text, flags=re.IGNORECASE | re.DOTALL)
    text = re.sub(r'<style\b[^>]*>.*?</style>', ' ', text, flags=re.IGNORECASE | re.DOTALL)
    if preserve_lines:
        text = re.sub(r'</?(?:p|div|li|ul|ol|br|tr|td|table|section|article|h[1-6])[^>]*>', '\n', text, flags=re.IGNORECASE)
    text = re.sub(r'<!--.*?-->', ' ', text, flags=re.DOTALL)
    text = re.sub(r'<[^>]+>', ' ', text)
    text = text.replace('\xa0', ' ')

    if preserve_lines:
        lines = []
        for line in text.splitlines():
            normalized = re.sub(r'\s+', ' ', line).strip()
            if normalized:
                lines.append(normalized)
        return '\n'.join(lines)

    return re.sub(r'\s+', ' ', text).strip()


def _collect_waypoint_listing_text(waypoints: Any) -> str:
    if not isinstance(waypoints, list):
        return ''

    parts: List[str] = []
    for waypoint in waypoints:
        if not isinstance(waypoint, dict):
            continue
        for key in ('prefix', 'lookup', 'name', 'type', 'gc_coords', 'note', 'note_override'):
            value = waypoint.get(key)
            if isinstance(value, str) and value.strip():
                parts.append(value.strip())
    return '\n'.join(parts)


def _contains_pi_theme(*values: Any) -> bool:
    combined = '\n'.join(str(value or '') for value in values if value)
    return bool(combined and PI_THEME_PATTERN.search(combined))


def _extract_pi_coordinate_position_sequences(*values: Any) -> Optional[Dict[str, Any]]:
    ordered_axes = ('N', 'S', 'E', 'W')
    axis_lines: Dict[str, str] = {}
    axis_positions: Dict[str, List[int]] = {}

    for value in values:
        if not value:
            continue
        text = str(value)
        for raw_line in text.splitlines():
            line = raw_line.strip()
            if len(line) < 3 or line[0].upper() not in ordered_axes:
                continue
            if any(marker in line for marker in ('°', 'º')):
                continue
            axis = line[0].upper()
            body = line[1:].strip()
            if not body or re.search(r'[A-DF-Z]{2,}', body, flags=re.IGNORECASE):
                continue
            positions = [int(token) for token in re.findall(r'\d{1,4}', body)]
            if len(positions) < 6 or any(position <= 0 for position in positions):
                continue
            axis_positions[axis] = positions
            axis_lines[axis] = f"{axis} " + ','.join(str(position) for position in positions)

    if not axis_positions:
        return None

    source_lines = [axis_lines[axis] for axis in ordered_axes if axis in axis_lines]
    return {
        'axes': [axis for axis in ordered_axes if axis in axis_positions],
        'axis_positions': axis_positions,
        'source_text': '\n'.join(source_lines),
        'total_positions': sum(len(values) for values in axis_positions.values()),
    }


HIDDEN_STYLE_MARKER_PATTERNS: Tuple[Tuple[re.Pattern[str], str], ...] = (
    (re.compile(r'display\s*:\s*none', flags=re.IGNORECASE), 'display:none'),
    (re.compile(r'visibility\s*:\s*hidden', flags=re.IGNORECASE), 'visibility:hidden'),
    (re.compile(r'opacity\s*:\s*0(?:[^\d]|$)', flags=re.IGNORECASE), 'opacity:0'),
    (re.compile(r'font-size\s*:\s*0(?:px|em|rem|pt|%)?', flags=re.IGNORECASE), 'font-size:0'),
    (re.compile(r'color\s*:\s*transparent', flags=re.IGNORECASE), 'color:transparent'),
)


def _extract_hidden_style_markers(style_text: str) -> List[str]:
    normalized = str(style_text or '')
    markers = [
        marker
        for pattern, marker in HIDDEN_STYLE_MARKER_PATTERNS
        if pattern.search(normalized)
    ]
    if (
        re.search(r'position\s*:\s*(?:absolute|fixed)', normalized, flags=re.IGNORECASE)
        and re.search(
            r'(?:left|right|top|bottom|text-indent)\s*:\s*-\d{2,}(?:px|em|rem|pt|%)?',
            normalized,
            flags=re.IGNORECASE,
        )
    ):
        markers.append('offscreen positioning')
    return list(dict.fromkeys(markers))


def _format_hidden_style_signal(marker: str) -> str:
    return f"{marker} detected"


def _normalize_remote_resource_url(url: str) -> str:
    normalized = str(url or '').strip()
    if normalized.startswith('//'):
        return f'https:{normalized}'
    if normalized.startswith('/'):
        return f'https://www.geocaching.com{normalized}'
    return normalized


def _fetch_remote_text(
    url: str,
    *,
    timeout_sec: int = 5,
    max_bytes: int = 200_000,
) -> str:
    normalized_url = _normalize_remote_resource_url(url)
    if not normalized_url:
        return ''

    try:
        import requests  # type: ignore
    except Exception:
        return ''

    try:
        response = requests.get(normalized_url, timeout=timeout_sec)
    except Exception:
        return ''
    if response.status_code != 200:
        return ''

    raw_bytes = response.content or b''
    if max_bytes > 0 and len(raw_bytes) > max_bytes:
        raw_bytes = raw_bytes[:max_bytes]

    encoding = getattr(response, 'encoding', None) or getattr(response, 'apparent_encoding', None) or 'utf-8'
    try:
        return raw_bytes.decode(encoding, errors='ignore')
    except Exception:
        try:
            return raw_bytes.decode('utf-8', errors='ignore')
        except Exception:
            return ''


def _extract_external_stylesheet_blocks(description_html: str) -> List[Dict[str, str]]:
    raw_html = description_html or ''
    stylesheet_blocks: List[Dict[str, str]] = []
    seen_urls: set = set()

    for link_html in re.findall(r'<link\b[^>]*>', raw_html, flags=re.IGNORECASE):
        rel_value = _extract_html_tag_attribute(link_html, 'rel').lower()
        href_value = _extract_html_tag_attribute(link_html, 'href')
        if 'stylesheet' not in rel_value or not href_value:
            continue
        normalized_url = _normalize_remote_resource_url(href_value)
        if not normalized_url or normalized_url in seen_urls:
            continue
        css_text = _fetch_remote_text(normalized_url)
        if not css_text.strip():
            continue
        stylesheet_blocks.append({
            'source': 'external_stylesheet',
            'url': normalized_url,
            'css_text': css_text,
        })
        seen_urls.add(normalized_url)
        if len(stylesheet_blocks) >= 3:
            break

    return stylesheet_blocks


def _parse_hidden_css_selector_component(selector: str) -> Optional[Dict[str, Any]]:
    normalized = str(selector or '').strip()
    if not normalized or normalized == '*':
        return None
    match = re.fullmatch(
        r'(?:(?P<tag>[a-z][a-z0-9_-]*))?(?P<parts>(?:[#.][A-Za-z_][\w-]*)*)',
        normalized,
        flags=re.IGNORECASE,
    )
    if not match:
        return None

    tag_name = str(match.group('tag') or '').strip().lower()
    parts = re.findall(r'([#.])([A-Za-z_][\w-]*)', normalized)
    class_names = sorted({
        name.strip().lower()
        for prefix, name in parts
        if prefix == '.'
    })
    ids = sorted({
        name.strip().lower()
        for prefix, name in parts
        if prefix == '#'
    })
    if len(ids) > 1:
        return None
    if not tag_name and not class_names and not ids:
        return None

    return {
        'selector': normalized,
        'tag': tag_name,
        'classes': class_names,
        'element_id': ids[0] if ids else '',
    }


def _parse_hidden_css_selector(selector: str) -> Optional[Dict[str, Any]]:
    normalized = re.sub(r'\s*>\s*', ' > ', str(selector or '').strip())
    normalized = re.sub(r'\s+', ' ', normalized).strip()
    if not normalized:
        return None
    if any(token in normalized for token in ('+', '~', ':', '[')):
        return None

    tokens = normalized.split(' ')
    steps: List[Dict[str, Any]] = []
    combinators: List[str] = []
    expect_selector = True
    pending_combinator = 'descendant'

    for token in tokens:
        if token == '>':
            if expect_selector:
                return None
            pending_combinator = 'child'
            expect_selector = True
            continue

        component = _parse_hidden_css_selector_component(token)
        if not component:
            return None
        if steps:
            combinators.append(pending_combinator if expect_selector else 'descendant')
        steps.append(component)
        pending_combinator = 'descendant'
        expect_selector = False

    if not steps or expect_selector:
        return None

    last_step = steps[-1]
    return {
        'selector': normalized,
        'steps': steps,
        'combinators': combinators,
        'tag': last_step.get('tag') or '',
        'classes': list(last_step.get('classes') or []),
        'element_id': last_step.get('element_id') or '',
    }


def _extract_hidden_css_rules(description_html: str) -> List[Dict[str, Any]]:
    raw_html = description_html or ''
    rules: List[Dict[str, Any]] = []
    seen_rules: set = set()
    stylesheet_blocks = [
        {
            'source': 'inline_style',
            'url': '',
            'css_text': style_block,
        }
        for style_block in re.findall(r'<style\b[^>]*>(.*?)</style>', raw_html, flags=re.IGNORECASE | re.DOTALL)
    ]
    stylesheet_blocks.extend(_extract_external_stylesheet_blocks(raw_html))

    for stylesheet_block in stylesheet_blocks:
        css_text = re.sub(r'/\*.*?\*/', ' ', str(stylesheet_block.get('css_text') or ''), flags=re.DOTALL)
        stylesheet_source = str(stylesheet_block.get('source') or 'inline_style')
        stylesheet_url = str(stylesheet_block.get('url') or '').strip()
        for selector_block, declarations in re.findall(r'([^{}]+)\{([^{}]+)\}', css_text):
            markers = _extract_hidden_style_markers(declarations)
            if not markers:
                continue
            for raw_selector in selector_block.split(','):
                parsed_selector = _parse_hidden_css_selector(raw_selector)
                if not parsed_selector:
                    continue
                dedupe_key = (
                    parsed_selector['selector'],
                    tuple(
                        (
                            str(step.get('tag') or ''),
                            tuple(step.get('classes') or []),
                            str(step.get('element_id') or ''),
                        )
                        for step in (parsed_selector.get('steps') or [])
                    ),
                    tuple(parsed_selector.get('combinators') or []),
                    stylesheet_source,
                    stylesheet_url,
                    tuple(markers),
                )
                if dedupe_key in seen_rules:
                    continue
                rules.append({
                    **parsed_selector,
                    'stylesheet_source': stylesheet_source,
                    'stylesheet_url': stylesheet_url,
                    'markers': markers,
                })
                seen_rules.add(dedupe_key)
    return rules


def _descriptor_matches_hidden_selector_step(
    descriptor: Dict[str, Any],
    step: Dict[str, Any],
) -> bool:
    descriptor_tag = str(descriptor.get('tag') or '').strip().lower()
    step_tag = str(step.get('tag') or '').strip().lower()
    if step_tag and descriptor_tag != step_tag:
        return False

    descriptor_id = str(descriptor.get('element_id') or '').strip().lower()
    step_id = str(step.get('element_id') or '').strip().lower()
    if step_id and descriptor_id != step_id:
        return False

    descriptor_classes = {
        str(token or '').strip().lower()
        for token in (descriptor.get('classes') or [])
        if str(token or '').strip()
    }
    step_classes = {
        str(token or '').strip().lower()
        for token in (step.get('classes') or [])
        if str(token or '').strip()
    }
    return not step_classes or step_classes.issubset(descriptor_classes)


def _match_hidden_css_rules(
    tag_name: str,
    attrs: Dict[str, str],
    ancestry: List[Dict[str, Any]],
    hidden_css_rules: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    current_descriptor = {
        'tag': str(tag_name or '').strip().lower(),
        'classes': sorted({
            token.strip().lower()
            for token in re.split(r'\s+', str(attrs.get('class') or '').strip())
            if token.strip()
        }),
        'element_id': str(attrs.get('id') or '').strip().lower(),
    }

    matched_rules: List[Dict[str, Any]] = []
    for rule in hidden_css_rules:
        steps = [
            step
            for step in (rule.get('steps') or [])
            if isinstance(step, dict)
        ]
        combinators = [
            str(item or '').strip().lower()
            for item in (rule.get('combinators') or [])
        ]
        if not steps:
            continue
        if not _descriptor_matches_hidden_selector_step(current_descriptor, steps[-1]):
            continue

        ancestor_index = len(ancestry) - 1
        matched = True
        for step_index in range(len(steps) - 2, -1, -1):
            combinator = combinators[step_index] if step_index < len(combinators) else 'descendant'
            if combinator == 'child':
                if ancestor_index < 0 or not _descriptor_matches_hidden_selector_step(ancestry[ancestor_index], steps[step_index]):
                    matched = False
                    break
                ancestor_index -= 1
                continue

            found_index = -1
            for candidate_index in range(ancestor_index, -1, -1):
                if _descriptor_matches_hidden_selector_step(ancestry[candidate_index], steps[step_index]):
                    found_index = candidate_index
                    break
            if found_index < 0:
                matched = False
                break
            ancestor_index = found_index - 1

        if matched:
            matched_rules.append(rule)

    return matched_rules


class _HiddenContentHtmlParser(HTMLParser):
    def __init__(self, *, hidden_css_rules: List[Dict[str, Any]], register_hidden_item):
        super().__init__(convert_charrefs=True)
        self.hidden_css_rules = hidden_css_rules
        self.register_hidden_item = register_hidden_item
        self.stack: List[Dict[str, Any]] = []

    def handle_starttag(self, tag: str, attrs: List[Tuple[str, Optional[str]]]) -> None:
        self._push_tag(tag, attrs)

    def handle_startendtag(self, tag: str, attrs: List[Tuple[str, Optional[str]]]) -> None:
        self._push_tag(tag, attrs, self_closing=True)

    def handle_endtag(self, tag: str) -> None:
        normalized_tag = str(tag or '').strip().lower()
        while self.stack:
            entry = self.stack.pop()
            self._flush_entry(entry)
            if str(entry.get('tag') or '').strip().lower() == normalized_tag:
                break

    def handle_data(self, data: str) -> None:
        if not data:
            return
        for entry in reversed(self.stack):
            if entry.get('capture'):
                entry.setdefault('parts', []).append(data)
                break

    def close(self) -> None:
        super().close()
        while self.stack:
            self._flush_entry(self.stack.pop())

    def _push_tag(
        self,
        tag: str,
        attrs: List[Tuple[str, Optional[str]]],
        *,
        self_closing: bool = False,
    ) -> None:
        normalized_tag = str(tag or '').strip().lower()
        parent_hidden = bool(self.stack[-1].get('context_hidden')) if self.stack else False
        attr_map = {
            str(name or '').strip().lower(): str(value or '').strip()
            for name, value in attrs
            if str(name or '').strip()
        }
        class_tokens = sorted({
            token.strip().lower()
            for token in re.split(r'\s+', str(attr_map.get('class') or '').strip())
            if token.strip()
        })
        current_descriptor = {
            'tag': normalized_tag,
            'classes': class_tokens,
            'element_id': str(attr_map.get('id') or '').strip().lower(),
        }

        own_source = ''
        own_reason = ''

        style_markers = _extract_hidden_style_markers(attr_map.get('style') or '')
        if style_markers:
            own_source = 'hidden_html_text'
            own_reason = 'Inline hidden style element text extracted'
        elif any(str(name or '').strip().lower() == 'hidden' for name, _ in attrs):
            own_source = 'hidden_html_text'
            own_reason = 'Hidden attribute element text extracted'
        elif str(attr_map.get('aria-hidden') or '').strip().lower() in {'true', '1', 'yes'}:
            own_source = 'hidden_html_text'
            own_reason = 'ARIA-hidden element text extracted'
        else:
            ancestry = [
                dict(entry.get('descriptor') or {})
                for entry in self.stack
                if isinstance(entry.get('descriptor'), dict)
            ]
            matched_css_rules = _match_hidden_css_rules(normalized_tag, attr_map, ancestry, self.hidden_css_rules)
            if matched_css_rules:
                own_source = 'hidden_css_text'
                selector_preview = ', '.join(
                    str(rule.get('selector') or '').strip()
                    for rule in matched_css_rules[:2]
                    if str(rule.get('selector') or '').strip()
                )
                markers = list(dict.fromkeys(
                    marker
                    for rule in matched_css_rules
                    for marker in (rule.get('markers') or [])
                    if str(marker or '').strip()
                ))
                marker_preview = ', '.join(markers[:2])
                uses_external_stylesheet = any(
                    str(rule.get('stylesheet_source') or '').strip() == 'external_stylesheet'
                    for rule in matched_css_rules
                )
                own_reason = "CSS-hidden element text extracted"
                if selector_preview:
                    own_reason += f" via {selector_preview}"
                if marker_preview:
                    own_reason += f" ({marker_preview})"
                if uses_external_stylesheet:
                    own_reason += " from external stylesheet"

        entry = {
            'tag': normalized_tag,
            'context_hidden': parent_hidden or bool(own_source),
            'capture': bool(own_source) and not parent_hidden and normalized_tag not in {'script', 'style'},
            'source': own_source,
            'reason': own_reason,
            'descriptor': current_descriptor,
            'parts': [],
        }
        self.stack.append(entry)

        if self_closing:
            self._flush_entry(self.stack.pop())

    def _flush_entry(self, entry: Dict[str, Any]) -> None:
        if not entry.get('capture'):
            return
        text = ''.join(entry.get('parts') or [])
        self.register_hidden_item(
            text,
            str(entry.get('source') or 'hidden_html_text'),
            str(entry.get('reason') or 'Hidden element text extracted'),
        )


def _extract_hidden_content_signals(description_html: str) -> Dict[str, Any]:
    raw_html = description_html or ''
    signals: List[str] = []
    hidden_items: List[Dict[str, str]] = []
    seen_hidden_items: set = set()

    def register_hidden_item(text: str, source: str, reason: str) -> None:
        normalized = _clean_listing_text(text, preserve_lines=False)
        if len(normalized) < 2:
            return
        dedupe_key = f"{source}:{normalized.lower()}"
        if dedupe_key in seen_hidden_items:
            return
        hidden_items.append({
            'source': source,
            'reason': reason,
            'text': normalized[:160],
        })
        seen_hidden_items.add(dedupe_key)

    comments = [
        _clean_listing_text(match, preserve_lines=False)
        for match in re.findall(r'<!--(.*?)-->', raw_html, flags=re.DOTALL)
    ]
    comments = [comment[:160] for comment in comments if comment]
    if comments:
        signals.append("HTML comments present")
        for comment in comments:
            register_hidden_item(comment, 'html_comment', 'HTML comment extracted')

    for marker in _extract_hidden_style_markers(raw_html):
        signals.append(_format_hidden_style_signal(marker))
    if re.search(r'<[^>]+\bhidden\b', raw_html, flags=re.IGNORECASE):
        signals.append("hidden attribute detected")
    if re.search(r'\baria-hidden\s*=\s*["\']?(?:true|1|yes)\b', raw_html, flags=re.IGNORECASE):
        signals.append("aria-hidden detected")

    hidden_css_rules = _extract_hidden_css_rules(raw_html)
    if hidden_css_rules:
        signals.append(f"{len(hidden_css_rules)} hidden CSS selector(s) detected")
        external_stylesheet_urls = list(dict.fromkeys(
            str(rule.get('stylesheet_url') or '').strip()
            for rule in hidden_css_rules
            if str(rule.get('stylesheet_source') or '').strip() == 'external_stylesheet'
            and str(rule.get('stylesheet_url') or '').strip()
        ))
        if external_stylesheet_urls:
            signals.append(f"{len(external_stylesheet_urls)} external stylesheet(s) inspected")
        css_markers = list(dict.fromkeys(
            marker
            for rule in hidden_css_rules
            for marker in (rule.get('markers') or [])
            if str(marker or '').strip()
        ))
        for marker in css_markers[:2]:
            signals.append(f"Hidden CSS selector uses {marker}")

    hidden_text_patterns = (
        (
            re.compile(
                r'<(?P<tag>[a-z0-9]+)\b[^>]*style\s*=\s*["\'][^"\']*(?:display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0(?:[^\d]|$)|font-size\s*:\s*0(?:px|em|rem|pt|%)?)[^"\']*["\'][^>]*>(?P<content>.*?)</(?P=tag)>',
                flags=re.IGNORECASE | re.DOTALL,
            ),
            'hidden_html_text',
            'Hidden styled element text extracted',
        ),
        (
            re.compile(
                r'<(?P<tag>[a-z0-9]+)\b[^>]*\bhidden\b[^>]*>(?P<content>.*?)</(?P=tag)>',
                flags=re.IGNORECASE | re.DOTALL,
            ),
            'hidden_html_text',
            'Hidden attribute element text extracted',
        ),
    )
    for pattern, source_name, reason in hidden_text_patterns:
        for match in pattern.finditer(raw_html):
            register_hidden_item(match.group('content') or '', source_name, reason)

    parser = _HiddenContentHtmlParser(
        hidden_css_rules=hidden_css_rules,
        register_hidden_item=register_hidden_item,
    )
    try:
        parser.feed(raw_html)
        parser.close()
    except Exception:
        pass

    hidden_texts = [
        item['text']
        for item in hidden_items
        if item.get('source') in {'hidden_html_text', 'hidden_css_text'}
    ]
    hidden_text_items = [
        {
            'source': str(item.get('source') or 'hidden_html_text'),
            'text': str(item.get('text') or ''),
        }
        for item in hidden_items
        if item.get('source') in {'hidden_html_text', 'hidden_css_text'}
    ]

    return {
        'signals': list(dict.fromkeys(signals))[:6],
        'comments': comments[:4],
        'hidden_texts': hidden_texts[:6],
        'hidden_text_items': hidden_text_items[:8],
        'items': hidden_items[:8],
    }


def _extract_html_tag_attribute(tag_html: str, attribute_name: str) -> str:
    match = re.search(
        rf'\b{re.escape(attribute_name)}\s*=\s*(?:"([^"]*)"|\'([^\']*)\'|([^\s>]+))',
        tag_html or '',
        flags=re.IGNORECASE,
    )
    if not match:
        return ''
    return html.unescape(next((group for group in match.groups() if group is not None), '') or '').strip()


def _extract_image_url_hint_candidates(image_url: str) -> List[Dict[str, Any]]:
    normalized_url = _normalize_remote_image_url(image_url)
    if not normalized_url:
        return []

    parsed = urlparse(normalized_url)
    image_host = (parsed.netloc or '').strip().lower()
    raw_stem = unquote(Path(parsed.path).stem or '').strip()
    if not raw_stem:
        return []

    def is_generic_filename(value: str) -> bool:
        compact = value.strip().lower()
        if not compact:
            return True
        compact_hex = re.sub(r'[^0-9a-f]+', '', compact)
        if re.fullmatch(r'[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}', compact):
            return True
        if (
            ('geocaching.com' in image_host or 'gcimg.net' in image_host)
            and re.fullmatch(r'[0-9a-f]{24,64}', compact_hex)
        ):
            return True
        if re.fullmatch(r'(?:img|image|photo|picture|pic|scan|file|dsc|wp|gc)[\s._-]*\d{1,8}', compact):
            return True
        tokens = [token for token in re.split(r'[^a-z0-9]+', compact) if token]
        if not tokens:
            return True
        if all(token in GENERIC_IMAGE_FILENAME_TOKENS or token.isdigit() for token in tokens):
            grouped_digits = re.fullmatch(r'\d{1,3}(?:[\s._-]\d{1,3}){2,}', compact)
            morse_like = re.fullmatch(r'[\-._]{4,}', compact)
            return not bool(grouped_digits or morse_like)
        return False

    candidates: List[Dict[str, Any]] = []
    seen_texts: set = set()

    def register_candidate(text: str, reason: str, confidence: float) -> None:
        cleaned = _clean_listing_text(text, preserve_lines=False)
        if len(cleaned) < 3:
            return
        dedupe_key = cleaned.lower()
        if dedupe_key in seen_texts:
            return
        candidates.append({
            'source': 'image_filename_text',
            'reason': reason,
            'text': cleaned[:160],
            'image_url': normalized_url,
            'confidence': confidence,
        })
        seen_texts.add(dedupe_key)

    if not is_generic_filename(raw_stem):
        register_candidate(raw_stem, 'Nom de fichier d image extrait', 0.62)

    normalized_stem = re.sub(r'[_+=]+', ' ', raw_stem)
    normalized_stem = re.sub(r'(?<=\d)[.-](?=\d)', ' ', normalized_stem)
    normalized_stem = re.sub(r'(?<=[A-Za-z])[.-](?=[A-Za-z])', ' ', normalized_stem)
    normalized_stem = re.sub(r'\s+', ' ', normalized_stem).strip()
    if normalized_stem and normalized_stem != raw_stem and not is_generic_filename(normalized_stem):
        register_candidate(normalized_stem, 'Nom de fichier d image normalise', 0.68)

    return candidates[:2]


def _extract_image_listing_items(description_html: str, images: Any) -> Dict[str, Any]:
    raw_html = description_html or ''
    items: List[Dict[str, Any]] = []
    image_urls: List[str] = []
    seen_items: set = set()
    seen_urls: set = set()

    def register_image_url(raw_value: Any) -> str:
        normalized = str(raw_value or '').strip()
        if normalized and normalized not in seen_urls:
            seen_urls.add(normalized)
            image_urls.append(normalized)
            for hint_candidate in _extract_image_url_hint_candidates(normalized):
                register_item(
                    source=str(hint_candidate.get('source') or 'image_filename_text'),
                    reason=str(hint_candidate.get('reason') or 'Nom de fichier d image'),
                    text=str(hint_candidate.get('text') or ''),
                    image_url=str(hint_candidate.get('image_url') or normalized),
                    confidence=hint_candidate.get('confidence') if isinstance(hint_candidate.get('confidence'), (int, float)) else None,
                )
        return normalized

    def register_item(
        *,
        source: str,
        reason: str,
        text: str,
        image_url: str = '',
        confidence: Optional[float] = None,
    ) -> None:
        normalized = _clean_listing_text(text, preserve_lines=False)
        if len(normalized) < 2:
            return
        dedupe_key = f"{source}:{image_url}:{normalized.lower()}"
        if dedupe_key in seen_items:
            return
        item: Dict[str, Any] = {
            'source': source,
            'reason': reason,
            'text': normalized[:160],
        }
        if image_url:
            item['image_url'] = image_url
        if confidence is not None:
            item['confidence'] = round(float(confidence), 3)
        items.append(item)
        seen_items.add(dedupe_key)

    for match in re.finditer(r'<img\b[^>]*>', raw_html, flags=re.IGNORECASE):
        tag_html = match.group(0) or ''
        image_url = register_image_url(_extract_html_tag_attribute(tag_html, 'src'))
        alt_text = _extract_html_tag_attribute(tag_html, 'alt')
        title_text = _extract_html_tag_attribute(tag_html, 'title')
        if alt_text:
            register_item(
                source='image_alt_text',
                reason='Texte alt d image extrait',
                text=alt_text,
                image_url=image_url,
                confidence=1.0,
            )
        if title_text:
            register_item(
                source='image_title_text',
                reason='Titre d image extrait',
                text=title_text,
                image_url=image_url,
                confidence=1.0,
            )

    if isinstance(images, list):
        for entry in images:
            if isinstance(entry, dict):
                image_url = register_image_url(
                    entry.get('url') or entry.get('src') or entry.get('href') or entry.get('image_url')
                )
                alt_text = _clean_listing_text(entry.get('alt') or entry.get('alt_text') or '', preserve_lines=False)
                title_text = _clean_listing_text(entry.get('title') or entry.get('title_text') or '', preserve_lines=False)
                if alt_text:
                    register_item(
                        source='image_alt_text',
                        reason='Texte alt d image fourni',
                        text=alt_text,
                        image_url=image_url,
                        confidence=1.0,
                    )
                if title_text:
                    register_item(
                        source='image_title_text',
                        reason='Titre d image fourni',
                        text=title_text,
                        image_url=image_url,
                        confidence=1.0,
                    )
            else:
                register_image_url(entry)

    return {
        'image_count': max(len(image_urls), len(re.findall(r'<img\b[^>]*>', raw_html, flags=re.IGNORECASE))),
        'image_urls': image_urls[:12],
        'items': items[:12],
    }


def _normalize_remote_image_url(url: str) -> str:
    return _normalize_remote_resource_url(url)


def _normalize_exif_value(value: Any) -> str:
    if value is None:
        return ''
    if isinstance(value, bytes):
        for encoding in ('utf-8', 'utf-16-le', 'latin-1'):
            try:
                decoded = value.decode(encoding, errors='ignore').replace('\x00', ' ').strip()
                if decoded:
                    return _clean_listing_text(decoded, preserve_lines=False)
            except Exception:
                continue
        return ''
    if isinstance(value, (list, tuple)):
        return _clean_listing_text(' '.join(str(item) for item in value if item is not None), preserve_lines=False)
    return _clean_listing_text(str(value), preserve_lines=False)


def _gps_ratio_to_float(value: Any) -> Optional[float]:
    try:
        if hasattr(value, 'numerator') and hasattr(value, 'denominator'):
            denominator = float(value.denominator or 0)
            if denominator == 0:
                return None
            return float(value.numerator) / denominator
        if isinstance(value, (tuple, list)) and len(value) == 2:
            denominator = float(value[1] or 0)
            if denominator == 0:
                return None
            return float(value[0]) / denominator
        return float(value)
    except Exception:
        return None


def _extract_exif_gps_coordinates(gps_info: Any) -> Optional[Dict[str, Any]]:
    if not isinstance(gps_info, dict):
        return None
    try:
        from PIL.ExifTags import GPSTAGS  # type: ignore
    except Exception:
        return None

    named_gps: Dict[str, Any] = {}
    for key, value in gps_info.items():
        named_gps[GPSTAGS.get(key, key)] = value

    latitude_values = named_gps.get('GPSLatitude')
    latitude_ref = str(named_gps.get('GPSLatitudeRef') or '').strip().upper()
    longitude_values = named_gps.get('GPSLongitude')
    longitude_ref = str(named_gps.get('GPSLongitudeRef') or '').strip().upper()
    if not latitude_values or not longitude_values or not latitude_ref or not longitude_ref:
        return None

    def convert_triplet(values: Any, ref: str) -> Optional[float]:
        if not isinstance(values, (list, tuple)) or len(values) != 3:
            return None
        degrees = _gps_ratio_to_float(values[0])
        minutes = _gps_ratio_to_float(values[1])
        seconds = _gps_ratio_to_float(values[2])
        if degrees is None or minutes is None or seconds is None:
            return None
        decimal = degrees + (minutes / 60.0) + (seconds / 3600.0)
        if ref in {'S', 'W'}:
            decimal *= -1
        return round(decimal, 6)

    latitude = convert_triplet(latitude_values, latitude_ref)
    longitude = convert_triplet(longitude_values, longitude_ref)
    if latitude is None or longitude is None:
        return None

    return {
        'latitude': latitude,
        'longitude': longitude,
        'decimal': f'{latitude}, {longitude}',
    }


def _estimate_vision_ocr_cost_units(image_detail: Optional[Dict[str, Any]]) -> int:
    if not isinstance(image_detail, dict):
        return 1

    width = _normalize_positive_int(image_detail.get('width'), 0, minimum=0, maximum=50000)
    height = _normalize_positive_int(image_detail.get('height'), 0, minimum=0, maximum=50000)
    byte_size = _normalize_positive_int(image_detail.get('byte_size'), 0, minimum=0, maximum=200_000_000)
    megapixels = (width * height) / 1_000_000 if width and height else 0.0

    if megapixels >= 8.0 or byte_size >= 4_000_000:
        return 3
    if megapixels >= 2.5 or byte_size >= 1_500_000:
        return 2
    return 1


def _extract_image_metadata_items(image_urls: List[str]) -> Dict[str, Any]:
    if not image_urls:
        return {'items': [], 'coordinate_candidates': [], 'summaries': [], 'image_details': []}

    try:
        import requests  # type: ignore
        from io import BytesIO
        from PIL import Image  # type: ignore
        from PIL.ExifTags import TAGS  # type: ignore
    except Exception as exc:
        return {
            'items': [],
            'coordinate_candidates': [],
            'summaries': [f'EXIF indisponible: {exc}'],
            'image_details': [],
        }

    items: List[Dict[str, Any]] = []
    coordinate_candidates: List[Dict[str, Any]] = []
    summaries: List[str] = []
    image_details: List[Dict[str, Any]] = []
    interesting_tags = (
        'ImageDescription',
        'XPTitle',
        'XPComment',
        'Artist',
        'Copyright',
        'UserComment',
        'Make',
        'Model',
        'Software',
        'DateTimeOriginal',
    )

    for raw_url in image_urls[:6]:
        image_url = _normalize_remote_image_url(raw_url)
        if not image_url:
            continue
        try:
            response = requests.get(image_url, timeout=10)
            if response.status_code != 200:
                continue
            image_bytes = response.content or b''
            with Image.open(BytesIO(image_bytes)) as image:
                width, height = image.size
                exif = image.getexif()
        except Exception:
            continue

        image_detail = {
            'image_url': image_url,
            'width': int(width) if isinstance(width, int) else 0,
            'height': int(height) if isinstance(height, int) else 0,
            'byte_size': len(image_bytes),
        }
        image_detail['vision_ocr_cost_units'] = _estimate_vision_ocr_cost_units(image_detail)
        image_details.append(image_detail)

        if not exif:
            continue

        named_exif: Dict[str, Any] = {
            str(TAGS.get(tag_id, tag_id)): value
            for tag_id, value in exif.items()
        }
        found_for_image = 0
        for tag_name in interesting_tags:
            normalized_value = _normalize_exif_value(named_exif.get(tag_name))
            if not normalized_value:
                continue
            items.append({
                'source': 'image_exif_text',
                'reason': f'EXIF {tag_name}',
                'text': normalized_value[:160],
                'image_url': image_url,
                'confidence': 0.9,
            })
            found_for_image += 1

        gps_coordinates = _extract_exif_gps_coordinates(named_exif.get('GPSInfo'))
        if gps_coordinates:
            coordinate_candidates.append({
                'source': 'image_exif_gps',
                'image_url': image_url,
                'confidence': 0.93,
                'coordinates': gps_coordinates,
            })
            found_for_image += 1

        if found_for_image:
            summaries.append(f'EXIF: {found_for_image} indice(s) extrait(s) sur {image_url}')

    return {
        'items': items[:12],
        'coordinate_candidates': coordinate_candidates[:6],
        'summaries': summaries[:6],
        'image_details': image_details[:12],
    }


def _build_secret_fragment_evidence(signature: Dict[str, Any], source_name: str) -> List[str]:
    evidence: List[str] = []
    if source_name == 'html_comment':
        evidence.append("Fragment extracted from an HTML comment")
    if source_name == 'hidden_html_text':
        evidence.append("Fragment extracted from hidden HTML text")
    if source_name == 'hidden_css_text':
        evidence.append("Fragment extracted from CSS-hidden HTML text")
    if source_name == 'image_alt_text':
        evidence.append("Fragment extracted from image alt text")
    if source_name == 'image_title_text':
        evidence.append("Fragment extracted from an image title")
    if source_name == 'image_filename_text':
        evidence.append("Fragment extracted from an image filename")
    if source_name == 'image_ocr_text':
        evidence.append("Fragment extracted from OCR on an image")
    if source_name == 'image_vision_text':
        evidence.append("Fragment extracted from vision OCR on an image")
    if source_name == 'image_barcode_text':
        evidence.append("Fragment extracted from a barcode")
    if source_name == 'image_exif_text':
        evidence.append("Fragment extracted from EXIF metadata")
    if source_name == 'image_qr_text':
        evidence.append("Fragment extracted from a QR code")
    if signature.get('looks_like_morse'):
        evidence.append("Morse-like pattern detected")
    if signature.get('looks_like_binary'):
        evidence.append("Binary-like pattern detected")
    if signature.get('looks_like_hex'):
        evidence.append("Hex-like pattern detected")
    if signature.get('looks_like_phone_keypad'):
        evidence.append("T9-like pattern detected")
    if signature.get('looks_like_roman_numerals'):
        evidence.append("Roman numeral pattern detected")
    if signature.get('looks_like_a1z26'):
        evidence.append("Grouped values in the 1-26 range detected")
    if signature.get('looks_like_pi_index_positions'):
        evidence.append("Indexed numeric positions suitable for Pi digits detected")
    if signature.get('looks_like_tap_code'):
        evidence.append("Tap code groups detected")
    if signature.get('looks_like_bacon'):
        evidence.append("Bacon pattern detected")
    if signature.get('dominant_input_kind') in ('digits', 'symbols', 'mixed'):
        evidence.append(f"Dominant input kind: {signature.get('dominant_input_kind')}")
    if int(signature.get('group_count', 0)) > 1:
        evidence.append("The fragment is split into multiple groups")
    return list(dict.fromkeys(evidence))


def _score_secret_fragment(signature: Dict[str, Any], source_name: str) -> float:
    score = 0.0
    if signature.get('looks_like_morse'):
        score += 60
    if signature.get('looks_like_binary'):
        score += 48
    if signature.get('looks_like_hex'):
        score += 42
    if signature.get('looks_like_phone_keypad'):
        score += 45
    if signature.get('looks_like_roman_numerals'):
        score += 32
    if signature.get('looks_like_a1z26'):
        score += 50
    if signature.get('looks_like_pi_index_positions'):
        score += 54
    if signature.get('looks_like_tap_code'):
        score += 50
    if signature.get('looks_like_bacon'):
        score += 50

    dominant_kind = signature.get('dominant_input_kind')
    if dominant_kind in ('digits', 'symbols', 'mixed'):
        score += 16
    if int(signature.get('group_count', 0)) > 1:
        score += 10

    fragment_length = int(signature.get('non_space_length', 0))
    if dominant_kind == 'digits' and fragment_length >= 12:
        score += 18
    if dominant_kind == 'digits' and fragment_length >= 24 and int(signature.get('group_count', 0)) <= 3:
        score += 8
    if 4 <= fragment_length <= 64:
        score += 8
    if source_name == 'html_comment':
        score += 10
    if source_name == 'hidden_html_text':
        score += 12
    if source_name == 'hidden_css_text':
        score += 13
    if source_name in {'image_alt_text', 'image_title_text'}:
        score += 11
    if source_name == 'image_filename_text':
        score += 8
    if source_name == 'image_ocr_text':
        score += 14
    if source_name == 'image_vision_text':
        score += 13
    if source_name == 'image_barcode_text':
        score += 16
    if source_name == 'image_exif_text':
        score += 9
    if source_name == 'image_qr_text':
        score += 18
    if signature.get('looks_like_coordinate_fragment'):
        score -= 12
    if dominant_kind == 'words' and int(signature.get('word_count', 0)) >= 3:
        score -= 20

    # Penalise les tres longs blocs de chiffres qui ne correspondent a aucun
    # pattern de chiffrement connu : il s'agit generalement d'une reference
    # de letter-tour ou de coordonnees encodees, pas d'un code decodable.
    # looks_like_decimal_sequence est exclu car trop generique (juste "des
    # chiffres en groupes") et ne reflete pas un schema de decodage precis.
    # Seuil de 80 pour ne pas penaliser les fragments compacts de ~50 chars
    # qui restent plausibles (paires ASCII, A1Z26 concatene, etc.).
    if dominant_kind == 'digits' and fragment_length >= 80:
        known_digit_pattern = any(
            bool(signature.get(key))
            for key in (
                'looks_like_a1z26',
                'looks_like_pi_index_positions',
                'looks_like_tap_code',
                'looks_like_polybius',
                'looks_like_phone_keypad',
                'looks_like_multitap',
                'looks_like_prime_sequence',
            )
        )
        if not known_digit_pattern:
            score -= 30

    return score


def _register_secret_fragment(
    *,
    fragments: List[Dict[str, Any]],
    seen: set,
    text: str,
    source_name: str,
    source_kind: str,
) -> None:
    normalized_text = re.sub(r'\s+', ' ', (text or '')).strip()
    if len(normalized_text) < 4:
        return

    dedupe_key = normalized_text.lower()
    if dedupe_key in seen:
        return

    signature = _analyze_metasolver_signature(normalized_text)
    score = _score_secret_fragment(signature, source_name)
    if score < 25:
        return

    fragments.append({
        'source': source_name,
        'source_kind': source_kind,
        'text': normalized_text[:160],
        'score': round(score, 2),
        'confidence': round(min(0.99, max(0.05, score / 100.0)), 3),
        'signature': signature,
        'evidence': _build_secret_fragment_evidence(signature, source_name),
    })
    seen.add(dedupe_key)


def _extract_secret_fragments(
    *,
    title: str,
    description: str,
    hint: str,
    waypoint_text: str,
    hidden_comments: List[str],
    hidden_texts: List[str],
    hidden_text_items: Optional[List[Dict[str, str]]] = None,
    supplemental_text_sources: Optional[List[Dict[str, str]]] = None,
    max_fragments: int,
) -> List[Dict[str, Any]]:
    fragments: List[Dict[str, Any]] = []
    seen: set = set()

    source_values = [
        ('title', title),
        ('hint', hint),
        ('description', description),
        ('waypoints', waypoint_text),
    ]

    patterns = (
        ('morse_like', re.compile(r'(?<!\S)(?=[.\-/| ]{5,}[.\-])[.\-/| ]{5,}(?!\S)')),
        ('long_digit_block', re.compile(r'(?<!\w)(?:\d{8,}(?:[\s,;:/_-]+\d{8,})*)(?!\w)')),
        ('digit_groups', re.compile(r'(?<!\w)(?:\d{1,3}(?:[\s,;:/_-]+\d{1,3}){2,})(?!\w)')),
        ('tap_code', re.compile(r'(?<!\w)(?:[1-5]{2}(?:\s+[1-5]{2}){1,})(?!\w)')),
        ('bacon_like', re.compile(r'(?<!\w)(?:[AB]{5}(?:[\s,;:/_-]*[AB]{5})+)(?!\w)', flags=re.IGNORECASE)),
        ('t9_like', re.compile(r'(?<!\w)[2-9]{4,}(?!\w)')),
        ('hex_like', re.compile(r'(?<!\w)(?:0x)?[A-F0-9]{6,32}(?!\w)', flags=re.IGNORECASE)),
        ('mixed_code', re.compile(r'(?<!\w)[A-Z0-9]{5,24}(?!\w)')),
    )

    for source_name, source_text in source_values:
        cleaned_source = (source_text or '').strip()
        if not cleaned_source:
            continue

        source_kind = 'listing_field'
        if source_name in ('title', 'hint') and len(cleaned_source) <= 96:
            _register_secret_fragment(
                fragments=fragments,
                seen=seen,
                text=cleaned_source,
                source_name=source_name,
                source_kind=source_kind,
            )

        for _, pattern in patterns:
            for match in pattern.findall(cleaned_source):
                _register_secret_fragment(
                    fragments=fragments,
                    seen=seen,
                    text=match,
                    source_name=source_name,
                    source_kind=source_kind,
                )

    for comment in hidden_comments:
        _register_secret_fragment(
            fragments=fragments,
            seen=seen,
            text=comment,
            source_name='html_comment',
            source_kind='hidden_html',
        )

    if hidden_text_items:
        for hidden_item in hidden_text_items:
            if not isinstance(hidden_item, dict):
                continue
            _register_secret_fragment(
                fragments=fragments,
                seen=seen,
                text=str(hidden_item.get('text') or ''),
                source_name=str(hidden_item.get('source') or 'hidden_html_text'),
                source_kind='hidden_html',
            )
    else:
        for hidden_text in hidden_texts:
            _register_secret_fragment(
                fragments=fragments,
                seen=seen,
                text=hidden_text,
                source_name='hidden_html_text',
                source_kind='hidden_html',
            )

    for supplemental in supplemental_text_sources or []:
        if not isinstance(supplemental, dict):
            continue
        _register_secret_fragment(
            fragments=fragments,
            seen=seen,
            text=str(supplemental.get('text') or ''),
            source_name=str(supplemental.get('source_name') or 'supplemental_text'),
            source_kind=str(supplemental.get('source_kind') or 'supplemental'),
        )

    fragments.sort(key=lambda item: (-item['score'], -item['confidence'], item['source'], item['text']))
    return fragments[:max_fragments]


def _build_hidden_content_execution(
    *,
    listing_inputs: Dict[str, Any],
    data: Dict[str, Any],
    max_secret_fragments: int,
    max_plugins: int,
) -> Dict[str, Any]:
    hidden_info = _extract_hidden_content_signals(listing_inputs.get('description_html') or '')
    candidate_secret_fragments = _extract_secret_fragments(
        title='',
        description='',
        hint='',
        waypoint_text='',
        hidden_comments=hidden_info.get('comments') or [],
        hidden_texts=hidden_info.get('hidden_texts') or [],
        hidden_text_items=hidden_info.get('hidden_text_items') or [],
        max_fragments=max_secret_fragments,
    )
    selected_fragment = candidate_secret_fragments[0] if candidate_secret_fragments else None
    recommendation = None
    if selected_fragment and isinstance(selected_fragment, dict):
        fragment_text = str(selected_fragment.get('text') or '').strip()
        if fragment_text:
            recommendation = _recommend_metasolver_plugins_response(
                text=fragment_text,
                requested_preset=(str(data.get('metasolver_preset') or '')).strip().lower(),
                mode=(str(data.get('metasolver_mode') or 'decode')).strip().lower(),
                max_plugins=max_plugins,
            )

    summary_parts: List[str] = []
    signal_count = len(hidden_info.get('signals') or [])
    item_count = len(hidden_info.get('items') or [])
    if signal_count:
        summary_parts.append(f"{signal_count} signal(s) HTML cache detecte(s)")
    if item_count:
        summary_parts.append(f"{item_count} extrait(s) cache(s)")
    if selected_fragment:
        summary_parts.append(f"Fragment principal: {str(selected_fragment.get('text') or '')[:60]}")
    summary = ' | '.join(summary_parts) or 'Aucun contenu cache exploitable extrait.'

    return {
        'inspected': True,
        'hidden_signals': hidden_info.get('signals') or [],
        'comments': hidden_info.get('comments') or [],
        'hidden_texts': hidden_info.get('hidden_texts') or [],
        'items': hidden_info.get('items') or [],
        'candidate_secret_fragments': candidate_secret_fragments,
        'selected_fragment': selected_fragment,
        'recommendation': recommendation,
        'summary': summary,
    }


def _build_image_puzzle_execution(
    *,
    listing_inputs: Dict[str, Any],
    data: Dict[str, Any],
    max_secret_fragments: int,
    max_plugins: int,
    include_plugin_runs: bool = True,
    inspected: bool = True,
    max_vision_ocr_cost_units: int = 0,
) -> Dict[str, Any]:
    image_info = _extract_image_listing_items(
        listing_inputs.get('description_html') or '',
        listing_inputs.get('images') or [],
    )
    image_items: List[Dict[str, Any]] = [dict(item) for item in (image_info.get('items') or [])]
    plugin_summaries: List[str] = []
    coordinate_candidates: List[Dict[str, Any]] = []
    vision_ocr_images_analyzed = 0
    vision_ocr_budget_cost = 0
    seen_item_keys = {
        f"{str(item.get('source') or '')}:{str(item.get('image_url') or '')}:{str(item.get('text') or '').lower()}"
        for item in image_items
    }
    seen_coordinate_keys: set = set()

    def register_image_item(
        *,
        source: str,
        reason: str,
        text: str,
        image_url: str = '',
        confidence: Optional[float] = None,
    ) -> None:
        normalized = _clean_listing_text(text, preserve_lines=False)
        if len(normalized) < 2:
            return
        dedupe_key = f"{source}:{image_url}:{normalized.lower()}"
        if dedupe_key in seen_item_keys:
            return
        item: Dict[str, Any] = {
            'source': source,
            'reason': reason,
            'text': normalized[:160],
        }
        if image_url:
            item['image_url'] = image_url
        if confidence is not None:
            item['confidence'] = round(float(confidence), 3)
        image_items.append(item)
        seen_item_keys.add(dedupe_key)

    def register_coordinate_candidate(
        candidate: Any,
        *,
        source: str,
        image_url: str = '',
        confidence: Optional[float] = None,
    ) -> None:
        parsed = _extract_decimal_coordinates(candidate)
        if not parsed:
            return
        dedupe_key = f"{round(parsed['latitude'], 6)}:{round(parsed['longitude'], 6)}"
        if dedupe_key in seen_coordinate_keys:
            return
        coordinate_candidates.append({
            'source': source,
            'image_url': image_url or None,
            'confidence': round(float(confidence), 3) if confidence is not None else None,
            'coordinates': candidate if isinstance(candidate, (dict, str)) else {
                'latitude': parsed['latitude'],
                'longitude': parsed['longitude'],
                'decimal': f"{parsed['latitude']}, {parsed['longitude']}",
            },
        })
        seen_coordinate_keys.add(dedupe_key)

    exif_info = _extract_image_metadata_items(image_info.get('image_urls') or [])
    image_details_by_url = {
        str(detail.get('image_url') or ''): detail
        for detail in (exif_info.get('image_details') or [])
        if isinstance(detail, dict) and str(detail.get('image_url') or '')
    }
    for item in exif_info.get('items') or []:
        if not isinstance(item, dict):
            continue
        register_image_item(
            source=str(item.get('source') or 'image_exif_text'),
            reason=str(item.get('reason') or 'EXIF'),
            text=str(item.get('text') or ''),
            image_url=str(item.get('image_url') or ''),
            confidence=item.get('confidence') if isinstance(item.get('confidence'), (int, float)) else None,
        )
    for coordinate in exif_info.get('coordinate_candidates') or []:
        if not isinstance(coordinate, dict):
            continue
        register_coordinate_candidate(
            coordinate.get('coordinates'),
            source=str(coordinate.get('source') or 'image_exif_gps'),
            image_url=str(coordinate.get('image_url') or ''),
            confidence=coordinate.get('confidence') if isinstance(coordinate.get('confidence'), (int, float)) else None,
        )
    plugin_summaries.extend(
        str(summary).strip()
        for summary in (exif_info.get('summaries') or [])
        if str(summary).strip()
    )

    geocache_id = listing_inputs.get('geocache_id')
    explicit_images = listing_inputs.get('images') or []
    if include_plugin_runs and (geocache_id is not None or explicit_images):
        manager = get_plugin_manager()
        base_inputs = {
            'geocache_id': geocache_id,
            'images': explicit_images,
        }

        qr_result = manager.execute_plugin('qr_code_detector', base_inputs)
        qr_summary = str((qr_result or {}).get('summary') or '').strip()
        if qr_summary:
            plugin_summaries.append(f"qr_code_detector: {qr_summary}")
        for item in (qr_result or {}).get('results') or []:
            if not isinstance(item, dict):
                continue
            text_output = str(item.get('text_output') or '').strip()
            image_url = str(item.get('image_url') or '').strip()
            confidence = item.get('confidence')
            barcode_type = str(item.get('barcode_type') or '').strip().upper()
            is_barcode = bool(barcode_type and barcode_type not in {'QRCODE', 'QR'})
            if text_output:
                register_image_item(
                    source='image_barcode_text' if is_barcode else 'image_qr_text',
                    reason=f'Texte decode depuis un code-barres {barcode_type}' if is_barcode else 'Texte decode depuis un QR code',
                    text=text_output,
                    image_url=image_url,
                    confidence=confidence if isinstance(confidence, (int, float)) else None,
                )
                register_coordinate_candidate(
                    text_output,
                    source='image_barcode_text' if is_barcode else 'image_qr_text',
                    image_url=image_url,
                    confidence=confidence if isinstance(confidence, (int, float)) else None,
                )
            register_coordinate_candidate(
                item.get('coordinates'),
                source='image_barcode_text' if is_barcode else 'image_qr_text',
                image_url=image_url,
                confidence=confidence if isinstance(confidence, (int, float)) else None,
            )
        register_coordinate_candidate(
            (qr_result or {}).get('coordinates') or (qr_result or {}).get('primary_coordinates'),
            source='image_qr_text',
        )

        ocr_result = manager.execute_plugin('easyocr_ocr', base_inputs)
        ocr_summary = str((ocr_result or {}).get('summary') or '').strip()
        if ocr_summary:
            plugin_summaries.append(f"easyocr_ocr: {ocr_summary}")
        for item in (ocr_result or {}).get('results') or []:
            if not isinstance(item, dict):
                continue
            text_output = str(item.get('text_output') or '').strip()
            if not text_output:
                continue
            image_url = str(item.get('image_url') or '').strip()
            confidence = item.get('confidence')
            register_image_item(
                source='image_ocr_text',
                reason='Texte OCR extrait d une image',
                text=text_output,
                image_url=image_url,
                confidence=confidence if isinstance(confidence, (int, float)) else None,
            )
            register_coordinate_candidate(
                text_output,
                source='image_ocr_text',
                image_url=image_url,
                confidence=confidence if isinstance(confidence, (int, float)) else None,
            )

        has_machine_readable_hits = any(
            str(item.get('source') or '') in {'image_qr_text', 'image_barcode_text', 'image_ocr_text'}
            for item in image_items
        )
        if not has_machine_readable_hits:
            if max_vision_ocr_cost_units > 0:
                limited_image_urls: List[str] = []
                total_image_urls = image_info.get('image_urls') or []
                for raw_url in total_image_urls:
                    normalized_url = _normalize_remote_image_url(raw_url)
                    detail = image_details_by_url.get(normalized_url) or image_details_by_url.get(raw_url) or {}
                    cost_units = _estimate_vision_ocr_cost_units(detail)
                    if vision_ocr_budget_cost + cost_units > max_vision_ocr_cost_units:
                        continue
                    limited_image_urls.append(raw_url)
                    vision_ocr_budget_cost += cost_units
                if not limited_image_urls and total_image_urls:
                    plugin_summaries.append('vision_ocr skipped: aucune image ne rentre dans le budget OCR vision restant.')
                if limited_image_urls:
                    vision_inputs = {
                        'images': [{'url': url} for url in limited_image_urls],
                    }
                    if geocache_id is not None:
                        vision_inputs['geocache_id'] = geocache_id
                    if len(limited_image_urls) < len(total_image_urls):
                        plugin_summaries.append(
                            f"vision_ocr limited: {len(limited_image_urls)} image(s) analysee(s) sur {len(total_image_urls)} a cause du budget ({vision_ocr_budget_cost}/{max_vision_ocr_cost_units})."
                        )
                    vision_result = manager.execute_plugin('vision_ocr', vision_inputs)
                    vision_summary = str((vision_result or {}).get('summary') or '').strip()
                    if vision_summary:
                        plugin_summaries.append(f"vision_ocr: {vision_summary}")
                    try:
                        vision_ocr_images_analyzed = max(
                            vision_ocr_images_analyzed,
                            int((vision_result or {}).get('images_analyzed') or 0),
                        )
                    except (TypeError, ValueError):
                        vision_ocr_images_analyzed = max(vision_ocr_images_analyzed, 0)
                    for item in (vision_result or {}).get('results') or []:
                        if not isinstance(item, dict):
                            continue
                        text_output = str(item.get('text_output') or '').strip()
                        if not text_output:
                            continue
                        image_url = str(item.get('image_url') or '').strip()
                        confidence = item.get('confidence')
                        register_image_item(
                            source='image_vision_text',
                            reason='Texte OCR vision extrait d une image',
                            text=text_output,
                            image_url=image_url,
                            confidence=confidence if isinstance(confidence, (int, float)) else None,
                        )
                        register_coordinate_candidate(
                            text_output,
                            source='image_vision_text',
                            image_url=image_url,
                            confidence=confidence if isinstance(confidence, (int, float)) else None,
                        )
                    has_vision_ocr_hits = any(
                        str(item.get('source') or '') == 'image_vision_text'
                        for item in image_items
                    )
                    if not has_vision_ocr_hits:
                        describe_result = manager.execute_plugin('vision_describe', vision_inputs)
                        describe_summary = str((describe_result or {}).get('summary') or '').strip()
                        if describe_summary:
                            plugin_summaries.append(f"vision_describe: {describe_summary}")
                        for item in (describe_result or {}).get('results') or []:
                            if not isinstance(item, dict):
                                continue
                            text_output = str(item.get('text_output') or '').strip()
                            if not text_output:
                                continue
                            image_url = str(item.get('image_url') or '').strip()
                            confidence = item.get('confidence')
                            register_image_item(
                                source='image_vision_description',
                                reason='Description visuelle IA (conte, scene, personnage identifie)',
                                text=text_output,
                                image_url=image_url,
                                confidence=confidence if isinstance(confidence, (int, float)) else None,
                            )
            else:
                plugin_summaries.append('vision_ocr skipped: budget OCR vision epuise.')

    candidate_secret_fragments = _extract_secret_fragments(
        title='',
        description='',
        hint='',
        waypoint_text='',
        hidden_comments=[],
        hidden_texts=[],
        supplemental_text_sources=[
            {
                'text': str(item.get('text') or ''),
                'source_name': str(item.get('source') or 'image_text'),
                'source_kind': 'image_analysis',
            }
            for item in image_items
            if str(item.get('text') or '').strip()
        ],
        max_fragments=max_secret_fragments,
    )
    selected_fragment = candidate_secret_fragments[0] if candidate_secret_fragments else None

    recommendation = None
    if selected_fragment and isinstance(selected_fragment, dict):
        fragment_text = str(selected_fragment.get('text') or '').strip()
        if fragment_text:
            recommendation = _recommend_metasolver_plugins_response(
                text=fragment_text,
                requested_preset=(str(data.get('metasolver_preset') or '')).strip().lower(),
                mode=(str(data.get('metasolver_mode') or 'decode')).strip().lower(),
                max_plugins=max_plugins,
            )

    best_coordinate_candidate: Optional[Dict[str, Any]] = None
    best_plausibility: Optional[Dict[str, Any]] = None
    best_coordinate_score = -1.0
    for candidate in coordinate_candidates:
        plausibility = _build_geographic_plausibility(candidate.get('coordinates'), listing_inputs)
        score = float((plausibility or {}).get('score') or 0.0)
        if score > best_coordinate_score:
            best_coordinate_score = score
            best_coordinate_candidate = candidate
            best_plausibility = plausibility

    summary_parts: List[str] = []
    image_count = int(image_info.get('image_count') or 0)
    if image_count:
        summary_parts.append(f"{image_count} image(s) reperee(s)")
    if image_items:
        summary_parts.append(f"{len(image_items)} indice(s) image extrait(s)")
    if selected_fragment:
        summary_parts.append(f"Fragment principal: {str(selected_fragment.get('text') or '')[:60]}")
    if best_plausibility:
        summary_parts.append(
            f"Plausibilite geo: {str(best_plausibility.get('status') or 'unknown')} {(float(best_plausibility.get('score') or 0.0) * 100):.0f}%"
        )
    if plugin_summaries and not selected_fragment:
        summary_parts.append(plugin_summaries[0])
    summary = ' | '.join(summary_parts) or 'Aucun indice image exploitable extrait.'

    return {
        'inspected': bool(inspected),
        'image_count': image_count,
        'image_urls': image_info.get('image_urls') or [],
        'items': image_items[:12],
        'candidate_secret_fragments': candidate_secret_fragments,
        'selected_fragment': selected_fragment,
        'recommendation': recommendation,
        'plugin_summaries': plugin_summaries[:6],
        'vision_ocr_images_analyzed': vision_ocr_images_analyzed,
        'vision_ocr_budget_cost': vision_ocr_budget_cost,
        'coordinates_candidate': (best_coordinate_candidate or {}).get('coordinates') if best_coordinate_candidate else None,
        'geographic_plausibility': best_plausibility,
        'summary': summary,
    }


def _label_confidence(raw_score: float, *, max_score: float = 100.0) -> float:
    bounded = min(max(raw_score, 0.0), max_score)
    return round(min(0.99, max(0.05, bounded / max_score)), 3)


def _build_listing_classification(
    *,
    title: str,
    description: str,
    description_html: str,
    hint: str,
    waypoint_text: str,
    images: Any,
    checker_count: int,
    waypoint_count: int,
    max_secret_fragments: int,
) -> Dict[str, Any]:
    hidden_info = _extract_hidden_content_signals(description_html)
    hidden_signals = hidden_info.get('signals') or []
    hidden_comments = hidden_info.get('comments') or []
    hidden_texts = hidden_info.get('hidden_texts') or []
    image_info = _extract_image_listing_items(description_html, images)
    image_count = int(image_info.get('image_count') or 0)
    image_items = image_info.get('items') or []
    image_hint_count = len(image_items)
    image_hint_sources = list(dict.fromkeys(
        str(item.get('source') or '')
        for item in image_items
        if str(item.get('source') or '')
    ))[:6]

    combined_text = '\n'.join(part for part in (title, description, hint, waypoint_text) if part).strip()
    combined_lower = combined_text.lower()
    has_pi_theme = _contains_pi_theme(title, description, hint, waypoint_text)
    pi_coordinate_sequences = _extract_pi_coordinate_position_sequences(description, hint, waypoint_text, title)
    pi_position_token_count = int((pi_coordinate_sequences or {}).get('total_positions') or 0)
    pi_coordinate_axes = list((pi_coordinate_sequences or {}).get('axes') or [])

    secret_fragments = _extract_secret_fragments(
        title=title,
        description=description,
        hint=hint,
        waypoint_text=waypoint_text,
        hidden_comments=hidden_comments,
        hidden_texts=hidden_texts,
        hidden_text_items=hidden_info.get('hidden_text_items') or [],
        supplemental_text_sources=[
            {
                'text': str(item.get('text') or ''),
                'source_name': str(item.get('source') or 'image_text'),
                'source_kind': 'image_listing',
            }
            for item in image_items
            if str(item.get('text') or '').strip()
        ],
        max_fragments=max_secret_fragments,
    )

    labels: List[Dict[str, Any]] = []
    formula_signals: List[str] = []

    formula_keywords = (
        r'\b(formula|formule|equation|projection|project|coord(?:onnee|onnee|onn|inate)s?|variable|variables|solve|solver|calcul|calcule|calculate)\b'
    )
    word_game_keywords = (
        r'\b(sudoku|crossword|mot croise|mots croises|anagram|word search|cryptogram|hangman|mastermind|nonogram|wordle|scrabble)\b'
    )
    image_keywords = (
        r'\b(image|photo|picture|visual|visuel|qr|barcode|ocr|stegano|steganography|jigsaw|puzzle)\b'
    )
    visual_image_action_keywords = (
        r'\b(inspect|observe|spot|compare|count|zoom|rotate|mirror|flip|colour|color|shape|symbol|pattern|pixel)\b'
    )
    code_keywords = (
        r'\b(code|cipher|decode|decrypt|crypt|enigme|secret|morse|alphabet|substitution|transposition)\b'
    )
    coord_keywords = (
        r'\b(coord(?:onnee|onnee|onn|inate)s?|projection|bearing|distance|waypoint|final|offset|azimuth)\b'
    )
    projection_keywords = (
        r'\b(projection|bearing|distance|waypoint|final|offset|azimuth)\b'
    )

    variable_assignments = re.findall(r'\b[A-Z]{1,3}\s*=\s*[-+*/()0-9A-Z ]{1,40}', combined_text)
    projection_keyword_matches = re.findall(projection_keywords, combined_lower, flags=re.IGNORECASE)
    visual_image_action_matches = re.findall(visual_image_action_keywords, combined_lower, flags=re.IGNORECASE)
    strongest_fragment = secret_fragments[0] if secret_fragments else {}
    strongest_fragment_confidence = float((strongest_fragment or {}).get('confidence') or 0.0)
    strongest_fragment_source = str((strongest_fragment or {}).get('source') or '').strip()
    direct_fragments = [
        fragment for fragment in secret_fragments
        if str((fragment or {}).get('source') or '').strip() in DIRECT_SECRET_FRAGMENT_SOURCES
    ]
    hidden_fragments = [
        fragment for fragment in secret_fragments
        if str((fragment or {}).get('source') or '').strip() in HIDDEN_SECRET_FRAGMENT_SOURCES
    ]
    image_fragments = [
        fragment for fragment in secret_fragments
        if str((fragment or {}).get('source') or '').strip() in IMAGE_SECRET_FRAGMENT_SOURCES
    ]
    best_direct_fragment = direct_fragments[0] if direct_fragments else {}
    best_hidden_fragment = hidden_fragments[0] if hidden_fragments else {}
    best_image_fragment = image_fragments[0] if image_fragments else {}
    image_structured_fragment_count = sum(
        1
        for fragment in secret_fragments
        if str((fragment or {}).get('source') or '').strip() in IMAGE_SECRET_FRAGMENT_SOURCES
    )
    hidden_structured_fragment_count = len(hidden_fragments)
    direct_structured_fragment_count = len(direct_fragments)
    has_visual_only_image_clue = bool(
        image_count > 0
        and visual_image_action_matches
        and image_structured_fragment_count == 0
        and strongest_fragment_confidence < 0.72
    )
    if variable_assignments:
        formula_signals.append(f"{len(variable_assignments)} variable assignment(s) detected")
    if re.search(formula_keywords, combined_lower, flags=re.IGNORECASE):
        formula_signals.append("Formula or coordinate keywords detected")
    if re.search(r'\b[NS]\s*\d', combined_text, flags=re.IGNORECASE) and re.search(r'[A-Z]\s*[+\-*/=]', combined_text):
        formula_signals.append("Coordinate pattern mixed with variables detected")
    has_formula_coordinate_placeholders = (
        bool(re.search(r'\b[NS]\s*\d{1,2}[^.\n]{0,24}\.[A-Z0-9()]{2,}', combined_text, flags=re.IGNORECASE))
        and bool(re.search(r'\b[EW]\s*\d{1,3}[^.\n]{0,24}\.[A-Z0-9()]{2,}', combined_text, flags=re.IGNORECASE))
    )
    if has_formula_coordinate_placeholders:
        formula_signals.append("Coordinate formula placeholders detected")

    formula_score = 0.0
    formula_score += 30.0 if variable_assignments else 0.0
    formula_score += 24.0 if re.search(formula_keywords, combined_lower, flags=re.IGNORECASE) else 0.0
    formula_score += 30.0 if re.search(r'\b[NS]\s*\d', combined_text, flags=re.IGNORECASE) and re.search(r'[A-Z]\s*[+\-*/=]', combined_text) else 0.0
    formula_score += 24.0 if has_formula_coordinate_placeholders else 0.0
    if formula_score >= 28.0:
        labels.append({
            'name': 'formula',
            'confidence': _label_confidence(formula_score),
            'evidence': formula_signals[:4],
            'suggested_next_step': LISTING_CLASSIFICATION_ACTIONS['formula'],
        })

    hidden_score = 24.0 * len(hidden_signals) + (12.0 if hidden_comments else 0.0)
    if hidden_score >= 24.0:
        labels.append({
            'name': 'hidden_content',
            'confidence': _label_confidence(hidden_score),
            'evidence': hidden_signals[:4] or ["Suspicious hidden HTML markers detected"],
            'suggested_next_step': LISTING_CLASSIFICATION_ACTIONS['hidden_content'],
        })

    secret_score = 0.0
    secret_evidence: List[str] = []
    if secret_fragments:
        secret_score += strongest_fragment.get('score', 0.0)
        secret_evidence.append(
            f"Structured fragment detected in {strongest_fragment.get('source')}: {strongest_fragment.get('text')[:60]}"
        )
    if has_pi_theme and pi_position_token_count:
        secret_score += 30.0
        secret_evidence.append(
            f"Theme Pi detecte avec {pi_position_token_count} positions indexees sur les axes {'/'.join(pi_coordinate_axes or ['listing'])}"
        )
    if re.search(code_keywords, combined_lower, flags=re.IGNORECASE):
        secret_score += 18.0
        secret_evidence.append("Code / cipher vocabulary detected")
    if hint and len(hint.strip()) <= 96 and secret_fragments:
        secret_score += 8.0
        secret_evidence.append("The hint contains a compact candidate fragment")
    if (
        has_visual_only_image_clue
        and strongest_fragment_source in DIRECT_SECRET_FRAGMENT_SOURCES
        and strongest_fragment_confidence < 0.72
    ):
        secret_score -= 14.0
        secret_evidence.append("Visual image inspection cues dominate over the weak visible fragment")
    if secret_score >= 32.0:
        labels.append({
            'name': 'secret_code',
            'confidence': _label_confidence(secret_score),
            'evidence': secret_evidence[:4],
            'suggested_next_step': LISTING_CLASSIFICATION_ACTIONS['secret_code'],
        })

    word_game_score = 35.0 if re.search(word_game_keywords, combined_lower, flags=re.IGNORECASE) else 0.0
    if word_game_score:
        labels.append({
            'name': 'word_game',
            'confidence': _label_confidence(word_game_score),
            'evidence': ["Word-game keywords detected in the listing"],
            'suggested_next_step': LISTING_CLASSIFICATION_ACTIONS['word_game'],
        })

    image_score = 0.0
    image_evidence: List[str] = []
    if image_count > 0:
        image_score += min(40.0, 12.0 + 6.0 * image_count)
        image_evidence.append(f"{image_count} image(s) attached to the listing")
    if image_hint_count > 0:
        image_score += min(24.0, 8.0 + 4.0 * image_hint_count)
        image_evidence.append(f"{image_hint_count} indice(s) image textuel(s) extrait(s)")
    if '<img' in (description_html or '').lower():
        image_score += 12.0
        image_evidence.append("Inline image tags detected in listing HTML")
    if re.search(image_keywords, combined_lower, flags=re.IGNORECASE):
        image_score += 18.0
        image_evidence.append("Image / OCR / QR vocabulary detected")
    if has_visual_only_image_clue:
        image_score += 18.0
        image_evidence.append("Visual inspection cues detected even without extracted image text")
    if image_score >= 24.0:
        labels.append({
            'name': 'image_puzzle',
            'confidence': _label_confidence(image_score),
            'evidence': image_evidence[:4],
            'suggested_next_step': LISTING_CLASSIFICATION_ACTIONS['image_puzzle'],
        })

    coord_score = 0.0
    coord_evidence: List[str] = []
    if re.search(coord_keywords, combined_lower, flags=re.IGNORECASE):
        coord_score += 26.0
        coord_evidence.append("Coordinate / projection vocabulary detected")
    if waypoint_count > 0:
        coord_score += min(18.0, 6.0 + waypoint_count * 3.0)
        coord_evidence.append(f"{waypoint_count} waypoint(s) available")
    if re.search(r'\b[NS]\s*\d', combined_text, flags=re.IGNORECASE):
        coord_score += 16.0
        coord_evidence.append("Coordinate-like fragments detected")
    if formula_score >= 28.0:
        coord_score += 12.0
        coord_evidence.append("Formula clues are tied to coordinates")
    if coord_score >= 28.0:
        labels.append({
            'name': 'coord_transform',
            'confidence': _label_confidence(coord_score),
            'evidence': coord_evidence[:4],
            'suggested_next_step': LISTING_CLASSIFICATION_ACTIONS['coord_transform'],
        })

    if checker_count > 0:
        labels.append({
            'name': 'checker_available',
            'confidence': _label_confidence(min(100.0, 36.0 + checker_count * 10.0)),
            'evidence': [f"{checker_count} checker(s) linked to the geocache"],
            'suggested_next_step': LISTING_CLASSIFICATION_ACTIONS['checker_available'],
        })

    direct_domain_score = 0.0
    if best_direct_fragment:
        direct_domain_score += float(best_direct_fragment.get('score') or 0.0)
    if has_pi_theme and pi_position_token_count:
        direct_domain_score += 30.0
    if re.search(code_keywords, combined_lower, flags=re.IGNORECASE):
        direct_domain_score += 18.0
    if hint and len(hint.strip()) <= 96 and best_direct_fragment:
        direct_domain_score += 8.0
    if (
        has_visual_only_image_clue
        and str((best_direct_fragment or {}).get('source') or '').strip() in DIRECT_SECRET_FRAGMENT_SOURCES
        and float((best_direct_fragment or {}).get('confidence') or 0.0) < 0.72
    ):
        direct_domain_score -= 14.0

    hidden_domain_score = float(hidden_score)
    if best_hidden_fragment:
        hidden_domain_score += float(best_hidden_fragment.get('score') or 0.0) * 0.75

    image_domain_score = float(image_score)
    if best_image_fragment:
        image_domain_score += float(best_image_fragment.get('score') or 0.0) * 0.75

    domain_scores = {
        'direct': round(max(0.0, direct_domain_score), 2),
        'hidden': round(max(0.0, hidden_domain_score), 2),
        'image': round(max(0.0, image_domain_score), 2),
    }
    sorted_domain_scores = sorted(domain_scores.items(), key=lambda item: (-item[1], item[0]))
    dominant_evidence_domain = sorted_domain_scores[0][0] if sorted_domain_scores and sorted_domain_scores[0][1] > 0 else None
    second_domain_score = sorted_domain_scores[1][1] if len(sorted_domain_scores) > 1 else 0.0
    evidence_domain_gap = round(max(0.0, float(sorted_domain_scores[0][1] if sorted_domain_scores else 0.0) - float(second_domain_score)), 2)
    hybrid_domain_count = sum(1 for score in domain_scores.values() if float(score) >= 24.0)
    is_hybrid_listing = hybrid_domain_count >= 2
    ambiguous_domains = [
        domain
        for domain, score in sorted_domain_scores
        if float(score) >= 24.0 and dominant_evidence_domain and (float(domain_scores.get(dominant_evidence_domain) or 0.0) - float(score)) < 10.0
    ]
    is_ambiguous_hybrid = is_hybrid_listing and len(ambiguous_domains) >= 2 and evidence_domain_gap < 10.0

    labels.sort(key=lambda item: (-item['confidence'], item['name']))

    recommended_actions: List[str] = []
    for item in labels:
        action = item.get('suggested_next_step')
        if action and action not in recommended_actions:
            recommended_actions.append(action)

    return {
        'labels': labels,
        'recommended_actions': recommended_actions[:5],
        'candidate_secret_fragments': secret_fragments,
        'hidden_signals': hidden_signals[:6],
        'formula_signals': formula_signals[:6],
        'signal_summary': {
            'has_title': bool(title),
            'has_hint': bool(hint),
            'has_description_html': bool(description_html),
            'has_pi_theme': has_pi_theme,
            'pi_position_token_count': pi_position_token_count,
            'pi_coordinate_axes': pi_coordinate_axes,
            'image_count': image_count,
            'image_hint_count': image_hint_count,
            'image_hint_sources': image_hint_sources,
            'checker_count': checker_count,
            'waypoint_count': waypoint_count,
            'formula_signal_count': len(formula_signals),
            'variable_assignment_count': len(variable_assignments),
            'has_formula_coordinate_placeholders': has_formula_coordinate_placeholders,
            'projection_keyword_count': len(projection_keyword_matches),
            'visual_image_signal_count': len(visual_image_action_matches),
            'direct_structured_fragment_count': direct_structured_fragment_count,
            'hidden_structured_fragment_count': hidden_structured_fragment_count,
            'image_structured_fragment_count': image_structured_fragment_count,
            'direct_domain_score': domain_scores['direct'],
            'hidden_domain_score': domain_scores['hidden'],
            'image_domain_score': domain_scores['image'],
            'dominant_evidence_domain': dominant_evidence_domain,
            'evidence_domain_gap': evidence_domain_gap,
            'hybrid_domain_count': hybrid_domain_count,
            'is_hybrid_listing': is_hybrid_listing,
            'ambiguous_domains': ambiguous_domains,
            'is_ambiguous_hybrid': is_ambiguous_hybrid,
            'has_visual_only_image_clue': has_visual_only_image_clue,
            'hidden_signal_count': len(hidden_signals),
            'hidden_comment_count': len(hidden_comments),
            'hidden_text_count': len(hidden_texts),
            'secret_fragment_count': len(secret_fragments),
            'best_secret_fragment_source': (secret_fragments[0] or {}).get('source') if secret_fragments else None,
            'best_secret_fragment_confidence': float((secret_fragments[0] or {}).get('confidence') or 0.0) if secret_fragments else 0.0,
        },
    }


def _serialize_geocache_listing(geocache: Geocache) -> Dict[str, Any]:
    decoded_hint = geocache.hints_decoded_override or geocache.hints_decoded
    if decoded_hint is None and geocache.hints:
        decoded_hint = Geocache.decode_hint_rot13(geocache.hints)

    description_raw = geocache.description_override_raw or geocache.description_raw or ''
    description_html = geocache.description_override_html or geocache.description_html or ''
    images = geocache.images or []
    waypoints = [waypoint.to_dict() for waypoint in (geocache.waypoints or [])]
    checkers = [checker.to_dict() for checker in (geocache.checkers or [])]

    return {
        'title': geocache.name or '',
        'description': description_raw or _clean_listing_text(description_html, preserve_lines=True),
        'description_html': description_html,
        'hint': decoded_hint or '',
        'waypoints': waypoints,
        'checkers': checkers,
        'images': images,
        'metadata': {
            'id': geocache.id,
            'gc_code': geocache.gc_code,
            'name': geocache.name,
        },
    }


def _load_listing_analysis_inputs(data: Dict[str, Any]) -> Dict[str, Any]:
    geocache_id = data.get('geocache_id')
    source = 'direct_input'
    metadata: Dict[str, Any] | None = None
    geocache_record: Optional[Geocache] = None

    if geocache_id is not None:
        try:
            geocache_id = int(geocache_id)
        except (TypeError, ValueError):
            raise ValueError("Le champ 'geocache_id' doit etre un entier")

        geocache_record = Geocache.query.get(geocache_id)
        if not geocache_record:
            raise LookupError(f"Aucune geocache avec l'id {geocache_id}")

        payload = _serialize_geocache_listing(geocache_record)
        source = 'geocache'
        metadata = payload.pop('metadata', None)

        for field in ('title', 'description', 'description_html', 'hint'):
            override_value = data.get(field)
            if isinstance(override_value, str) and override_value.strip():
                payload[field] = override_value
    else:
        payload = {
            'title': data.get('title') or '',
            'description': data.get('description') or '',
            'description_html': data.get('description_html') or '',
            'hint': data.get('hint') or '',
            'waypoints': data.get('waypoints') if isinstance(data.get('waypoints'), list) else [],
            'checkers': data.get('checkers') if isinstance(data.get('checkers'), list) else [],
            'images': data.get('images') if isinstance(data.get('images'), list) else [],
        }

    title = _clean_listing_text(payload.get('title'), preserve_lines=False)
    description = _clean_listing_text(payload.get('description'), preserve_lines=True)
    description_html = str(payload.get('description_html') or '')
    if not description and description_html:
        description = _clean_listing_text(description_html, preserve_lines=True)
    hint = _clean_listing_text(payload.get('hint'), preserve_lines=False)
    waypoints = payload.get('waypoints') or []
    checkers = payload.get('checkers') or []
    images = payload.get('images') or []
    waypoint_text = _clean_listing_text(_collect_waypoint_listing_text(waypoints), preserve_lines=True)

    if not any((title, description, description_html, hint, waypoint_text)) and not images:
        raise ValueError("Fournissez au moins un contenu de listing, des images ou un geocache_id")

    return {
        'source': source,
        'metadata': metadata,
        'geocache_id': geocache_id if isinstance(geocache_id, int) else None,
        'geocache_record': geocache_record,
        'title': title,
        'description': description,
        'description_html': description_html,
        'hint': hint,
        'waypoints': waypoints,
        'checkers': checkers,
        'images': images,
        'waypoint_text': waypoint_text,
    }


def _build_listing_classification_response(listing_inputs: Dict[str, Any], max_secret_fragments: int) -> Dict[str, Any]:
    classification = _build_listing_classification(
        title=listing_inputs.get('title') or '',
        description=listing_inputs.get('description') or '',
        description_html=listing_inputs.get('description_html') or '',
        hint=listing_inputs.get('hint') or '',
        waypoint_text=listing_inputs.get('waypoint_text') or '',
        images=listing_inputs.get('images') or [],
        checker_count=len(listing_inputs.get('checkers') or []),
        waypoint_count=len(listing_inputs.get('waypoints') or []),
        max_secret_fragments=max_secret_fragments,
    )

    return {
        'source': listing_inputs.get('source') or 'direct_input',
        'geocache': listing_inputs.get('metadata'),
        'title': listing_inputs.get('title') or None,
        'max_secret_fragments': max_secret_fragments,
        **classification,
    }


def _recommend_metasolver_plugins_response(
    *,
    text: str,
    requested_preset: str = '',
    mode: str = 'decode',
    max_plugins: int = 8,
    extract_fragments: bool = False,
    max_secret_fragments: int = 5,
) -> Dict[str, Any]:
    manager = get_plugin_manager()

    # ── Extraction des fragments secrets (optionnel) ──────────────────
    # Cette logique est spécifique au blueprint (le service ne connaît
    # pas le concept de fragments). On l'exécute d'abord pour déterminer
    # le texte à analyser, puis on délègue la recommandation au service.
    candidate_secret_fragments: List[Dict[str, Any]] = []
    selected_fragment: Optional[Dict[str, Any]] = None
    analysis_text = text
    if extract_fragments:
        candidate_secret_fragments = _extract_secret_fragments(
            title='',
            description=text,
            hint='',
            waypoint_text='',
            hidden_comments=[],
            hidden_texts=[],
            max_fragments=max_secret_fragments,
        )
        selected_fragment = candidate_secret_fragments[0] if candidate_secret_fragments else None
        selected_text = str((selected_fragment or {}).get('text') or '').strip()
        if selected_text:
            analysis_text = selected_text

    # ── Recommandation canonique déléguée au service ──────────────────
    # Le service metasolver_analysis est désormais l'unique source de vérité
    # pour la signature, le scoring, les presets et la sélection.
    base = recommend_metasolver_plugins(
        manager=manager,
        text=analysis_text,
        requested_preset=requested_preset,
        mode=mode,
        max_plugins=max_plugins,
    )

    # ── Enrichissement avec les champs spécifiques au blueprint ───────
    explanation = list(base.get('explanation') or [])
    if selected_fragment:
        explanation.insert(0, f"Fragment analyse: {str(selected_fragment.get('text') or '')[:80]}")

    return {
        **base,
        'analysis_text': analysis_text,
        'candidate_secret_fragments': candidate_secret_fragments,
        'selected_fragment': selected_fragment,
        'explanation': explanation,
    }


IMAGE_SECRET_FRAGMENT_SOURCES = frozenset({
    'image_alt_text',
    'image_title_text',
    'image_filename_text',
    'image_ocr_text',
    'image_vision_text',
    'image_barcode_text',
    'image_exif_text',
    'image_qr_text',
})


HIDDEN_SECRET_FRAGMENT_SOURCES = frozenset({
    'html_comment',
    'hidden_html_text',
    'hidden_css_text',
})


DIRECT_SECRET_FRAGMENT_SOURCES = frozenset({
    'title',
    'hint',
    'description',
    'waypoints',
})


def _coerce_decimal_coordinate(value: Any, *, is_latitude: bool) -> Optional[float]:
    try:
        numeric_value = float(str(value).strip().replace(',', '.'))
    except (TypeError, ValueError):
        return None
    if math.isnan(numeric_value) or math.isinf(numeric_value):
        return None
    limit = 90.0 if is_latitude else 180.0
    if abs(numeric_value) > limit:
        return None
    return round(numeric_value, 8)


def _extract_decimal_coordinates(candidate: Any) -> Optional[Dict[str, float]]:
    if isinstance(candidate, dict):
        latitude = _coerce_decimal_coordinate(candidate.get('latitude'), is_latitude=True)
        longitude = _coerce_decimal_coordinate(candidate.get('longitude'), is_latitude=False)
        if latitude is not None and longitude is not None:
            return {
                'latitude': latitude,
                'longitude': longitude,
            }
        for key in ('ddm', 'formatted', 'coordinates_raw', 'decimal', 'text_output', 'value'):
            nested_value = candidate.get(key)
            parsed = _extract_decimal_coordinates(nested_value)
            if parsed:
                return parsed
        return None

    if isinstance(candidate, (list, tuple)) and len(candidate) >= 2:
        latitude = _coerce_decimal_coordinate(candidate[0], is_latitude=True)
        longitude = _coerce_decimal_coordinate(candidate[1], is_latitude=False)
        if latitude is not None and longitude is not None:
            return {
                'latitude': latitude,
                'longitude': longitude,
            }
        return None

    text = str(candidate or '').strip()
    if not text:
        return None

    decimal_match = DECIMAL_COORDINATE_PAIR_PATTERN.search(text)
    if decimal_match:
        latitude = _coerce_decimal_coordinate(decimal_match.group(1), is_latitude=True)
        longitude = _coerce_decimal_coordinate(decimal_match.group(2), is_latitude=False)
        if latitude is not None and longitude is not None:
            return {
                'latitude': latitude,
                'longitude': longitude,
            }

    ddm_match = DDM_COORDINATE_PAIR_PATTERN.search(' '.join(text.split()))
    if ddm_match:
        try:
            from gc_backend.blueprints.coordinates import convert_ddm_to_decimal

            converted = convert_ddm_to_decimal(ddm_match.group(1), ddm_match.group(2))
        except Exception:
            converted = None
        if isinstance(converted, dict):
            latitude = _coerce_decimal_coordinate(converted.get('latitude'), is_latitude=True)
            longitude = _coerce_decimal_coordinate(converted.get('longitude'), is_latitude=False)
            if latitude is not None and longitude is not None:
                return {
                    'latitude': latitude,
                    'longitude': longitude,
                }

    return None


def _collect_geographic_reference_points(listing_inputs: Dict[str, Any]) -> List[Dict[str, Any]]:
    references: List[Dict[str, Any]] = []
    seen_keys: set[Tuple[str, float, float]] = set()

    def add_reference(reference_type: str, label: str, coordinates: Any) -> None:
        parsed = _extract_decimal_coordinates(coordinates)
        if not parsed:
            return
        latitude = parsed['latitude']
        longitude = parsed['longitude']
        dedupe_key = (reference_type, round(latitude, 5), round(longitude, 5))
        if dedupe_key in seen_keys:
            return
        seen_keys.add(dedupe_key)
        references.append({
            'type': reference_type,
            'label': label,
            'latitude': latitude,
            'longitude': longitude,
        })

    geocache_record = listing_inputs.get('geocache_record')
    if geocache_record is not None:
        add_reference(
            'published',
            'Coordonnees publiees',
            {
                'latitude': getattr(geocache_record, 'latitude', None),
                'longitude': getattr(geocache_record, 'longitude', None),
            },
        )
        add_reference(
            'original',
            'Coordonnees originales',
            {
                'latitude': getattr(geocache_record, 'original_latitude', None),
                'longitude': getattr(geocache_record, 'original_longitude', None),
            },
        )
        for waypoint in getattr(geocache_record, 'waypoints', []) or []:
            add_reference(
                'waypoint',
                f"Waypoint {getattr(waypoint, 'name', None) or getattr(waypoint, 'prefix', None) or 'sans nom'}",
                {
                    'latitude': getattr(waypoint, 'latitude', None),
                    'longitude': getattr(waypoint, 'longitude', None),
                    'coordinates_raw': getattr(waypoint, 'gc_coords', None),
                },
            )

    for waypoint in listing_inputs.get('waypoints') or []:
        if not isinstance(waypoint, dict):
            continue
        add_reference(
            'waypoint',
            f"Waypoint {str(waypoint.get('name') or waypoint.get('prefix') or waypoint.get('lookup') or 'sans nom').strip()}",
            waypoint,
        )

    return references


def _build_geographic_plausibility(candidate_coordinates: Any, listing_inputs: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    parsed_candidate = _extract_decimal_coordinates(candidate_coordinates)
    if not parsed_candidate:
        return None

    references = _collect_geographic_reference_points(listing_inputs)
    if not references:
        return {
            'status': 'unknown',
            'score': 0.0,
            'summary': 'Aucun point de reference geographique disponible.',
            'reasons': ['La geocache ne fournit pas de coordonnees d origine ou de waypoint exploitable.'],
            'reference_count': 0,
            'published_distance_km': None,
            'original_distance_km': None,
            'nearest_waypoint_distance_km': None,
            'nearest_reference': None,
            'reference_distances': [],
        }

    from gc_backend.utils.coordinate_calculator import CoordinateCalculator

    calculator = CoordinateCalculator()
    measured_distances: List[Dict[str, Any]] = []
    published_distance_km: Optional[float] = None
    original_distance_km: Optional[float] = None
    nearest_waypoint_distance_km: Optional[float] = None

    for reference in references:
        distance_km = calculator.calculate_distance(
            parsed_candidate['latitude'],
            parsed_candidate['longitude'],
            reference['latitude'],
            reference['longitude'],
        )
        distance_km = round(distance_km, 2)
        measured = {
            **reference,
            'distance_km': distance_km,
        }
        measured_distances.append(measured)
        if reference['type'] == 'published':
            published_distance_km = distance_km
        elif reference['type'] == 'original':
            original_distance_km = distance_km
        elif reference['type'] == 'waypoint':
            nearest_waypoint_distance_km = (
                distance_km
                if nearest_waypoint_distance_km is None
                else min(nearest_waypoint_distance_km, distance_km)
            )

    measured_distances.sort(key=lambda item: (item['distance_km'], item['type'], item['label']))
    nearest_reference = measured_distances[0]
    reference_anchor_distance = nearest_reference['distance_km']

    if reference_anchor_distance <= 0.35:
        status = 'very_plausible'
        score = 0.97
    elif reference_anchor_distance <= 3:
        status = 'plausible'
        score = 0.88
    elif reference_anchor_distance <= 25:
        status = 'plausible'
        score = 0.76
    elif reference_anchor_distance <= 80:
        status = 'uncertain'
        score = 0.52
    elif reference_anchor_distance <= 200:
        status = 'unlikely'
        score = 0.28
    else:
        status = 'unlikely'
        score = 0.12

    if nearest_reference['type'] == 'waypoint' and reference_anchor_distance <= 1:
        score = max(score, 0.93)
        status = 'very_plausible'

    reasons = [
        f"A {reference_anchor_distance:.2f} km de {nearest_reference['label'].lower()}."
    ]
    if published_distance_km is not None and nearest_reference['type'] != 'published':
        reasons.append(f"A {published_distance_km:.2f} km des coordonnees publiees.")
    if original_distance_km is not None and nearest_reference['type'] != 'original':
        reasons.append(f"A {original_distance_km:.2f} km des coordonnees originales.")
    if nearest_waypoint_distance_km is not None:
        reasons.append(f"Waypoint le plus proche a {nearest_waypoint_distance_km:.2f} km.")

    summary = {
        'very_plausible': 'Les coordonnees restent tres proches d un point de reference du listing.',
        'plausible': 'Les coordonnees restent dans une zone geographiquement plausible pour la geocache.',
        'uncertain': 'Les coordonnees sont assez eloignees; verification humaine recommandee.',
        'unlikely': 'Les coordonnees semblent trop eloignees des references connues.',
        'unknown': 'Plausibilite geographique non evaluable.',
    }[status]

    return {
        'status': status,
        'score': round(score, 3),
        'summary': summary,
        'reasons': reasons[:3],
        'reference_count': len(measured_distances),
        'published_distance_km': published_distance_km,
        'original_distance_km': original_distance_km,
        'nearest_waypoint_distance_km': nearest_waypoint_distance_km,
        'nearest_reference': {
            'type': nearest_reference['type'],
            'label': nearest_reference['label'],
            'distance_km': nearest_reference['distance_km'],
        },
        'reference_distances': [
            {
                'type': item['type'],
                'label': item['label'],
                'distance_km': item['distance_km'],
            }
            for item in measured_distances[:4]
        ],
    }


@bp.route('/listing/classify', methods=['POST'])
def classify_listing():
    """
    Classifie un listing de geocache en plusieurs familles d'enigmes.

    Request body:
        {
            "geocache_id": 123,
            "title": "Puzzle name",
            "description": "...",
            "description_html": "<!-- hidden -->",
            "hint": "...",
            "max_secret_fragments": 6
        }
    """
    try:
        data = request.get_json(force=True)
    except Exception as json_error:
        return jsonify({
            "error": "JSON invalide",
            "message": f"Le body doit etre un JSON valide: {str(json_error)}"
        }), 400

    if not data or not isinstance(data, dict):
        return jsonify({
            "error": "Requete invalide",
            "message": "Le body doit etre un objet JSON"
        }), 400

    max_secret_fragments = _normalize_max_plugins(data.get('max_secret_fragments'), default=6)

    try:
        try:
            listing_inputs = _load_listing_analysis_inputs(data)
        except ValueError as value_error:
            return jsonify({
                "error": "Requete invalide",
                "message": str(value_error)
            }), 400
        except LookupError as lookup_error:
            return jsonify({
                "error": "Geocache introuvable",
                "message": str(lookup_error)
            }), 404

        return jsonify(_build_listing_classification_response(listing_inputs, max_secret_fragments)), 200
    except Exception as e:
        logger.error(f"Erreur classification listing: {e}", exc_info=True)
        return jsonify({
            "error": "Erreur classification listing",
            "message": str(e)
        }), 500
