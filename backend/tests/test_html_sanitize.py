"""
Contrat de rendu sûr pour le HTML tiers des trackables (P1-07) :
`sanitize_html_fragment` neutralise le markup actif et garde le contenu lisible.
"""

from gc_backend.services.html_sanitize import clean_remote_url, sanitize_html_fragment


def test_script_iframe_and_embedded_content_are_dropped():
    dirty = (
        '<p>Avant</p>'
        '<script>alert("xss")</script>'
        '<iframe src="https://evil.example/x"></iframe>'
        '<object data="x.swf"></object>'
        '<svg onload="alert(1)"><circle/></svg>'
        '<p>Après</p>'
    )
    clean = sanitize_html_fragment(dirty)
    assert 'script' not in clean
    assert 'iframe' not in clean
    assert 'object' not in clean
    assert 'svg' not in clean
    assert 'alert' not in clean
    assert '<p>Avant</p>' in clean and '<p>Après</p>' in clean


def test_event_handlers_and_styles_are_stripped():
    dirty = (
        '<p onclick="evil()" style="background:url(javascript:x)">Texte</p>'
        '<img src="https://img.example/tb.png" onerror="evil()" style="width:100%">'
    )
    clean = sanitize_html_fragment(dirty)
    assert 'onclick' not in clean
    assert 'onerror' not in clean
    assert 'style' not in clean
    assert 'javascript:' not in clean
    assert '<img src="https://img.example/tb.png"/>' in clean or 'src="https://img.example/tb.png"' in clean


def test_dangerous_link_schemes_are_dropped():
    dirty = (
        '<a href="javascript:alert(1)">piège</a>'
        '<a href="JaVaScRiPt:alert(2)">piège2</a>'
        # Entités/espaces que les navigateurs normalisent en javascript:
        '<a href="jav&#x09;ascript:alert(3)">piège3</a>'
        '<a href="data:text/html;base64,PHNjcmlwdD4=">piège4</a>'
        '<a href="vbscript:msgbox(1)">piège5</a>'
    )
    clean = sanitize_html_fragment(dirty)
    assert 'javascript' not in clean.lower()
    assert 'vbscript' not in clean.lower()
    assert 'data:text' not in clean.lower()
    # Le texte des liens reste lisible, sans href exploitable.
    assert clean.count('href=') == 0
    for label in ('piège', 'piège2', 'piège3', 'piège4', 'piège5'):
        assert label in clean


def test_legit_markup_survives():
    dirty = (
        '<p>Ce TB veut <strong>voyager</strong> :</p>'
        '<ul><li>montagnes</li><li>plages</li></ul>'
        '<blockquote><em>Merci !</em></blockquote>'
        '<a href="https://www.geocaching.com/geocache/GC12345" title="cache">la cache</a>'
        '<a href="/track/details.aspx?tracker=TB12345">lien relatif</a>'
    )
    clean = sanitize_html_fragment(dirty)
    assert '<p>Ce TB veut <strong>voyager</strong> :</p>' in clean
    assert '<ul><li>montagnes</li><li>plages</li></ul>' in clean
    assert '<blockquote><em>Merci !</em></blockquote>' in clean
    assert 'href="https://www.geocaching.com/geocache/GC12345"' in clean
    assert 'rel="nofollow noopener noreferrer"' in clean
    # L'URL relative est résolue vers Geocaching.com, schéma sûr.
    assert 'href="https://www.geocaching.com/track/details.aspx?tracker=TB12345"' in clean


def test_unknown_tags_are_unwrapped_but_text_kept():
    clean = sanitize_html_fragment('<div class="x"><marquee>hop</marquee> <span>texte</span></div>')
    assert 'marquee' not in clean
    assert 'hop' in clean and 'texte' in clean


def test_form_and_input_disappear_entirely():
    clean = sanitize_html_fragment('<form action="https://evil.example"><input name="t"></form><p>ok</p>')
    assert 'form' not in clean and 'input' not in clean
    assert '<p>ok</p>' in clean


def test_comments_and_doctype_removed():
    clean = sanitize_html_fragment('<!-- commentaire --><p>texte</p>')
    assert 'commentaire' not in clean
    assert '<p>texte</p>' in clean


def test_empty_and_blank_values():
    assert sanitize_html_fragment(None) is None
    assert sanitize_html_fragment('') is None
    assert sanitize_html_fragment('   ') is None
    assert sanitize_html_fragment('<script>evil()</script>') is None


def test_clean_remote_url():
    assert clean_remote_url('/images/tb.png') == 'https://www.geocaching.com/images/tb.png'
    assert clean_remote_url('https://img.example/x.png') == 'https://img.example/x.png'
    assert clean_remote_url('javascript:alert(1)') is None
    assert clean_remote_url('data:image/png;base64,xx') is None
    assert clean_remote_url('') is None
    assert clean_remote_url(None) is None
