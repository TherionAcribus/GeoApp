from gc_backend.services.geocaching_personal_notes import GeocachingPersonalNotesClient


class _FakeResponse:
    status_code = 200

    def __init__(self, text: str) -> None:
        self.text = text

    def raise_for_status(self) -> None:
        return None


class _FakeSession:
    def __init__(self, html: str) -> None:
        self.html = html

    def get(self, url: str, headers=None, timeout=None) -> _FakeResponse:
        return _FakeResponse(self.html)


def _extract_note(html: str):
    client = GeocachingPersonalNotesClient(session=_FakeSession(html))
    return client.get_personal_note('GCXXX')


def test_personal_note_preserves_br_line_breaks():
    html = (
        '<html><body>'
        '<div id="srOnlyCacheNote">Ligne 1<br>Ligne 2<br/>Ligne 3</div>'
        '</body></html>'
    )
    assert _extract_note(html) == 'Ligne 1\nLigne 2\nLigne 3'


def test_personal_note_preserves_paragraph_breaks():
    html = (
        '<html><body>'
        '<div id="srOnlyCacheNote"><p>Para 1</p><p>Para 2</p></div>'
        '</body></html>'
    )
    assert _extract_note(html) == 'Para 1\n\nPara 2'


def test_personal_note_collapses_inline_whitespace_but_keeps_newlines():
    html = (
        '<html><body>'
        '<div id="srOnlyCacheNote">Mot   1\tMot   2<br>  Ligne   suivante  </div>'
        '</body></html>'
    )
    assert _extract_note(html) == 'Mot 1 Mot 2\nLigne suivante'


def test_personal_note_decodes_html_entities():
    html = (
        '<html><body>'
        '<div id="srOnlyCacheNote">A &amp; B &lt;tag&gt; &quot;q&quot; &#39;s&#39;</div>'
        '</body></html>'
    )
    assert _extract_note(html) == 'A & B <tag> "q" \'s\''


def test_personal_note_collapses_excess_blank_lines():
    html = (
        '<html><body>'
        '<div id="srOnlyCacheNote">A<br><br><br><br>B</div>'
        '</body></html>'
    )
    assert _extract_note(html) == 'A\n\nB'


def test_personal_note_returns_none_when_absent():
    html = '<html><body><div>rien ici</div></body></html>'
    assert _extract_note(html) is None
