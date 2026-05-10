"""
Service d'extraction de contenu caché dans les listings HTML.

Ce module gère :
- Détection de marqueurs CSS de masquage (display:none, visibility:hidden, etc.)
- Parsing des feuilles de style internes et externes
- Extraction du texte caché via HTML parser avec matching de sélecteurs CSS
- Extraction des commentaires HTML et des éléments avec attribut hidden/aria-hidden
"""

import html
import re
from html.parser import HTMLParser
from typing import Dict, Any, List, Optional, Tuple


# ─────────────────────────────────────────────────────────────────────────────
# Constantes
# ─────────────────────────────────────────────────────────────────────────────

HIDDEN_STYLE_MARKER_PATTERNS: Tuple[Tuple[re.Pattern[str], str], ...] = (
    (re.compile(r'display\s*:\s*none', flags=re.IGNORECASE), 'display:none'),
    (re.compile(r'visibility\s*:\s*hidden', flags=re.IGNORECASE), 'visibility:hidden'),
    (re.compile(r'opacity\s*:\s*0(?:[^\d]|$)', flags=re.IGNORECASE), 'opacity:0'),
    (re.compile(r'font-size\s*:\s*0(?:px|em|rem|pt|%)?', flags=re.IGNORECASE), 'font-size:0'),
    (re.compile(r'color\s*:\s*transparent', flags=re.IGNORECASE), 'color:transparent'),
)


# ─────────────────────────────────────────────────────────────────────────────
# Utilitaires de nettoyage de texte listing (partagé avec d'autres services)
# ─────────────────────────────────────────────────────────────────────────────

def clean_listing_text(value: Any, *, preserve_lines: bool = False) -> str:
    """Nettoie un texte HTML de listing en texte brut."""
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


# ─────────────────────────────────────────────────────────────────────────────
# Extraction de marqueurs de style caché
# ─────────────────────────────────────────────────────────────────────────────

def extract_hidden_style_markers(style_text: str) -> List[str]:
    """Détecte les marqueurs de masquage CSS dans un attribut style."""
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


def format_hidden_style_signal(marker: str) -> str:
    return f"{marker} detected"


# ─────────────────────────────────────────────────────────────────────────────
# Utilitaires réseau pour feuilles de style externes
# ─────────────────────────────────────────────────────────────────────────────

def normalize_remote_resource_url(url: str) -> str:
    """Normalise une URL de ressource distante."""
    normalized = str(url or '').strip()
    if normalized.startswith('//'):
        return f'https:{normalized}'
    if normalized.startswith('/'):
        return f'https://www.geocaching.com{normalized}'
    return normalized


def fetch_remote_text(
    url: str,
    *,
    timeout_sec: int = 5,
    max_bytes: int = 200_000,
) -> str:
    """Récupère le contenu texte d'une URL distante."""
    normalized_url = normalize_remote_resource_url(url)
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


# ─────────────────────────────────────────────────────────────────────────────
# Extraction d'attributs HTML
# ─────────────────────────────────────────────────────────────────────────────

def extract_html_tag_attribute(tag_html: str, attribute_name: str) -> str:
    """Extrait la valeur d'un attribut HTML depuis un fragment de balise."""
    match = re.search(
        rf'\b{re.escape(attribute_name)}\s*=\s*(?:"([^"]*)"|\'([^\']*)\'|([^\s>]+))',
        tag_html or '',
        flags=re.IGNORECASE,
    )
    if not match:
        return ''
    return html.unescape(next((group for group in match.groups() if group is not None), '') or '').strip()


# ─────────────────────────────────────────────────────────────────────────────
# Extraction des feuilles de style externes
# ─────────────────────────────────────────────────────────────────────────────

def extract_external_stylesheet_blocks(description_html: str) -> List[Dict[str, str]]:
    """Extrait les blocs CSS depuis les feuilles de style externes liées."""
    raw_html = description_html or ''
    stylesheet_blocks: List[Dict[str, str]] = []
    seen_urls: set = set()

    for link_html in re.findall(r'<link\b[^>]*>', raw_html, flags=re.IGNORECASE):
        rel_value = extract_html_tag_attribute(link_html, 'rel').lower()
        href_value = extract_html_tag_attribute(link_html, 'href')
        if 'stylesheet' not in rel_value or not href_value:
            continue
        normalized_url = normalize_remote_resource_url(href_value)
        if not normalized_url or normalized_url in seen_urls:
            continue
        css_text = fetch_remote_text(normalized_url)
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


# ─────────────────────────────────────────────────────────────────────────────
# Parsing de sélecteurs CSS
# ─────────────────────────────────────────────────────────────────────────────

def parse_hidden_css_selector_component(selector: str) -> Optional[Dict[str, Any]]:
    """Parse un composant individuel d'un sélecteur CSS."""
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


def parse_hidden_css_selector(selector: str) -> Optional[Dict[str, Any]]:
    """Parse un sélecteur CSS complet avec combinateurs."""
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

        component = parse_hidden_css_selector_component(token)
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


# ─────────────────────────────────────────────────────────────────────────────
# Extraction des règles CSS cachées
# ─────────────────────────────────────────────────────────────────────────────

def extract_hidden_css_rules(description_html: str) -> List[Dict[str, Any]]:
    """Extrait toutes les règles CSS qui masquent des éléments."""
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
    stylesheet_blocks.extend(extract_external_stylesheet_blocks(raw_html))

    for stylesheet_block in stylesheet_blocks:
        css_text = re.sub(r'/\*.*?\*/', ' ', str(stylesheet_block.get('css_text') or ''), flags=re.DOTALL)
        stylesheet_source = str(stylesheet_block.get('source') or 'inline_style')
        stylesheet_url = str(stylesheet_block.get('url') or '').strip()
        for selector_block, declarations in re.findall(r'([^{}]+)\{([^{}]+)\}', css_text):
            markers = extract_hidden_style_markers(declarations)
            if not markers:
                continue
            for raw_selector in selector_block.split(','):
                parsed_selector = parse_hidden_css_selector(raw_selector)
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


# ─────────────────────────────────────────────────────────────────────────────
# Matching de règles CSS cachées
# ─────────────────────────────────────────────────────────────────────────────

def descriptor_matches_hidden_selector_step(
    descriptor: Dict[str, Any],
    step: Dict[str, Any],
) -> bool:
    """Vérifie si un descripteur d'élément correspond à une étape d'un sélecteur CSS."""
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


def match_hidden_css_rules(
    tag_name: str,
    attrs: Dict[str, str],
    ancestry: List[Dict[str, Any]],
    hidden_css_rules: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """Retourne les règles CSS cachées qui s'appliquent à l'élément donné."""
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
        if not descriptor_matches_hidden_selector_step(current_descriptor, steps[-1]):
            continue

        ancestor_index = len(ancestry) - 1
        matched = True
        for step_index in range(len(steps) - 2, -1, -1):
            combinator = combinators[step_index] if step_index < len(combinators) else 'descendant'
            if combinator == 'child':
                if ancestor_index < 0 or not descriptor_matches_hidden_selector_step(ancestry[ancestor_index], steps[step_index]):
                    matched = False
                    break
                ancestor_index -= 1
                continue

            found_index = -1
            for candidate_index in range(ancestor_index, -1, -1):
                if descriptor_matches_hidden_selector_step(ancestry[candidate_index], steps[step_index]):
                    found_index = candidate_index
                    break
            if found_index < 0:
                matched = False
                break
            ancestor_index = found_index - 1

        if matched:
            matched_rules.append(rule)

    return matched_rules


# ─────────────────────────────────────────────────────────────────────────────
# Parser HTML pour contenu caché
# ─────────────────────────────────────────────────────────────────────────────

class HiddenContentHtmlParser(HTMLParser):
    """Parser HTML qui détecte et extrait le texte des éléments cachés."""

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

        style_markers = extract_hidden_style_markers(attr_map.get('style') or '')
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
            matched_css_rules = match_hidden_css_rules(normalized_tag, attr_map, ancestry, self.hidden_css_rules)
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


# ─────────────────────────────────────────────────────────────────────────────
# Fonction principale d'extraction
# ─────────────────────────────────────────────────────────────────────────────

def extract_hidden_content_signals(description_html: str) -> Dict[str, Any]:
    """
    Analyse un HTML de listing et extrait tous les signaux de contenu caché :
    commentaires, éléments masqués par CSS (inline ou feuille de style), attributs hidden.
    """
    raw_html = description_html or ''
    signals: List[str] = []
    hidden_items: List[Dict[str, str]] = []
    seen_hidden_items: set = set()

    def register_hidden_item(text: str, source: str, reason: str) -> None:
        normalized = clean_listing_text(text, preserve_lines=False)
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
        clean_listing_text(match, preserve_lines=False)
        for match in re.findall(r'<!--(.*?)-->', raw_html, flags=re.DOTALL)
    ]
    comments = [comment[:160] for comment in comments if comment]
    if comments:
        signals.append("HTML comments present")
        for comment in comments:
            register_hidden_item(comment, 'html_comment', 'HTML comment extracted')

    for marker in extract_hidden_style_markers(raw_html):
        signals.append(format_hidden_style_signal(marker))
    if re.search(r'<[^>]+\bhidden\b', raw_html, flags=re.IGNORECASE):
        signals.append("hidden attribute detected")
    if re.search(r'\baria-hidden\s*=\s*["\']?(?:true|1|yes)\b', raw_html, flags=re.IGNORECASE):
        signals.append("aria-hidden detected")

    hidden_css_rules = extract_hidden_css_rules(raw_html)
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

    parser = HiddenContentHtmlParser(
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
