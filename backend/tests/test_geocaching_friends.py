import pytest

from gc_backend.services.geocaching_friends import (
    GeocachingFriendsClient,
    GeocachingFriendsError,
    FriendsResult,
)


def _friend_widget(
    index: str,
    name: str,
    guid: str,
    *,
    premium: bool = True,
    member_since: str = '02/18/2015',
    last_online: str = '07/27/2026',
    location: str = 'not listed',
    found: str = '2,734',
    hidden: str = '12',
) -> str:
    prefix = f'ctl00_ContentBody_rptFriendsList_{index}'
    status_img = (
        f'<img id="{prefix}_imgMemberStatus" title="Premium&#32;Member" '
        f'src="/images/icons/prem_user.gif" alt="Member&#32;Level" />'
        if premium else ''
    )
    return f"""
    <div class="FriendWidget">
        <div class="FriendAvatar">
            <p><img id="{prefix}_imgAvatar" onerror="ief(this);"
                    src="https://img.geocaching.com/avatar/{guid}.png" alt="Profile&#32;Photo" /></p>
        </div>
        <div class="FriendText">
            <h4>
                {status_img}
                <a id="{prefix}_lnkName" href="https://www.geocaching.com/p/?guid={guid}"
                   target="_blank">{name}</a></h4>
            <dl class="FriendList">
                <dt>Member Since:</dt>
                <dd><span id="{prefix}_lblMemberSince">{member_since}</span>&nbsp;</dd>
                <dt>Last Online:</dt>
                <dd><span id="{prefix}_lblLastOnline">{last_online}</span>&nbsp;</dd>
                <dt>Location:</dt>
                <dd><span id="{prefix}_lblLocation">{location}</span>&nbsp;</dd>
                <dt>Found:</dt>
                <dd>{found}&nbsp;</dd>
                <dt>Hidden:</dt>
                <dd>{hidden}&nbsp;</dd>
            </dl>
            <p><a id="{prefix}_lnkRemoveFriend" href="javascript:__doPostBack(&#39;x&#39;,&#39;&#39;)">Remove Friend</a></p>
        </div>
    </div>
    """


def _page(widgets: str, friends_count: int = 2, pending: int = 0) -> str:
    return f"""
    <html><body>
        <a id="ctl00_ContentBody_lnkMyFriends" class="Active">Your Friends ({friends_count})</a>
        <a id="ctl00_ContentBody_lnkPendingRequests" class="Inactive">Pending Friend Requests ({pending})</a>
        <div id="ctl00_ContentBody_pnlMyFriends">
            {widgets}
            <div class="FriendPager">&nbsp;</div>
        </div>
    </body></html>
    """


def test_parses_friends_with_all_fields():
    html = _page(
        _friend_widget('ctl00', 'PULPÀPAR Team 93', 'b9a1e39c-52f7-40ac-ac53-cda0e3c2073c')
        + _friend_widget(
            'ctl01', 'necrolink', 'c0d7aa69-2919-48ec-b49e-e3c78b6516f6',
            premium=False, member_since='09/01/2013', last_online='07/26/2026',
            location='Grand-Est, France', found='53,860', hidden='840',
        )
    )

    result = GeocachingFriendsClient.parse_friends_page(html)

    assert result.reported_count == 2
    assert result.pending_requests == 0
    assert result.truncated is False
    assert len(result.friends) == 2

    first, second = result.friends

    assert first.username == 'PULPÀPAR Team 93'
    assert first.profile_guid == 'b9a1e39c-52f7-40ac-ac53-cda0e3c2073c'
    assert first.is_premium is True
    assert first.member_since == '2015-02-18'   # date US convertie en ISO
    assert first.last_online == '2026-07-27'
    assert first.location is None               # "not listed" -> None
    assert first.finds_count == 2734
    assert first.hides_count == 12
    assert first.avatar_url.endswith('.png')

    assert second.username == 'necrolink'
    assert second.is_premium is False
    assert second.location == 'Grand-Est, France'
    assert second.finds_count == 53860
    assert second.hides_count == 840


def test_detects_pagination_when_fewer_widgets_than_reported():
    html = _page(_friend_widget('ctl00', 'solo', 'b9a1e39c-52f7-40ac-ac53-cda0e3c2073c'), friends_count=42)

    result = GeocachingFriendsClient.parse_friends_page(html)

    assert len(result.friends) == 1
    assert result.reported_count == 42
    assert result.truncated is True


def test_empty_friends_list_is_valid():
    result = GeocachingFriendsClient.parse_friends_page(_page('', friends_count=0))

    assert result.friends == []
    assert result.reported_count == 0
    assert result.truncated is False


def test_unknown_page_raises():
    with pytest.raises(GeocachingFriendsError):
        GeocachingFriendsClient.parse_friends_page('<html><body>Sign in</body></html>')


def test_missing_optional_fields_do_not_break_parsing():
    html = """
    <html><body>
    <div class="FriendWidget">
        <div class="FriendText">
            <h4><a id="ctl00_lnkName" href="/p/?guid=nope">MinimalUser</a></h4>
            <dl class="FriendList"></dl>
        </div>
    </div>
    <script>window.friendsCount = 1;</script>
    </body></html>
    """

    result = GeocachingFriendsClient.parse_friends_page(html)

    assert len(result.friends) == 1
    friend = result.friends[0]
    assert friend.username == 'MinimalUser'
    assert friend.profile_guid is None          # guid non conforme -> None
    assert friend.avatar_url is None
    assert friend.is_premium is False
    assert friend.member_since is None
    assert friend.finds_count is None


# ============================================================
#  Tests de pagination ASP.NET (postback __doPostBack)
# ============================================================


def _paginated_page(
    widgets: str,
    friends_count: int,
    *,
    current_page: int = 1,
    total_pages: int = 1,
    viewstate: str = 'VIEWSATE_FAKE',
) -> str:
    """Génère une page amis avec formulaire ASP.NET et pager cliquable."""
    # Liens du pager : la page courante est un <span>, les autres des <a>
    pager_links = []
    for p in range(1, total_pages + 1):
        if p == current_page:
            pager_links.append(f'<span>{p}</span>')
        else:
            pager_links.append(
                f'<a href="javascript:__doPostBack(&#39;ctl00$ContentBody$FriendPager&#39;,&#39;{p}&#39;)">{p}</a>'
            )
    if current_page < total_pages:
        pager_links.append(
            '<a href="javascript:__doPostBack(&#39;ctl00$ContentBody$FriendPager&#39;,&#39;Next&#39;)">Next</a>'
        )
    pager_html = ' '.join(pager_links) if pager_links else '&nbsp;'

    return f"""
    <html><body>
        <form name="aspnetForm" method="post" action="/my/myfriends.aspx">
            <input type="hidden" name="__VIEWSTATE" value="{viewstate}" />
            <input type="hidden" name="__VIEWSTATEGENERATOR" value="ABC123" />
            <input type="hidden" name="__EVENTVALIDATION" value="VALID123" />
            <input type="hidden" name="__EVENTTARGET" value="" />
            <input type="hidden" name="__EVENTARGUMENT" value="" />
            <a id="ctl00_ContentBody_lnkMyFriends" class="Active">Your Friends ({friends_count})</a>
            <a id="ctl00_ContentBody_lnkPendingRequests" class="Inactive">Pending Friend Requests (0)</a>
            <div id="ctl00_ContentBody_pnlMyFriends">
                {widgets}
                <div class="FriendPager">{pager_html}</div>
            </div>
        </form>
    </body></html>
    """


class _MockResponse:
    def __init__(self, text: str, url: str = 'https://www.geocaching.com/my/myfriends.aspx'):
        self.text = text
        self.url = url
        self.status_code = 200


class _MockSession:
    """
    Session simulée qui retourne des pages paginées.

    - Le 1er GET retourne la page 1.
    - Chaque POST avec __EVENTARGUMENT='2', '3', ... ou 'Next' retourne la
      page correspondante. Les POST suivent une logique simple :
      'Next' avance d'une page depuis la dernière visitée.
    """
    def __init__(self, pages: dict[int, str]):
        self._pages = pages
        self._current_page = 1
        self.posts: list[dict] = []  # trace des POST pour inspection

    def get(self, url, **kwargs):
        self._current_page = 1
        return _MockResponse(self._pages[1])

    def post(self, url, data=None, **kwargs):
        self.posts.append(dict(data or {}))
        arg = (data or {}).get('__EVENTARGUMENT', '')
        if arg.lower() == 'next':
            self._current_page += 1
        elif arg.isdigit():
            self._current_page = int(arg)
        page = self._pages.get(self._current_page)
        if page is None:
            # Page suivante inconnue : retourner la dernière connue
            return _MockResponse(self._pages[max(self._pages)])
        return _MockResponse(page)


def test_pagination_collects_all_pages():
    """Deux pages : la 1ère a 2 amis, la 2ème en a 1 autre. Total : 3."""
    page1 = _paginated_page(
        _friend_widget('ctl00', 'Alice', '11111111-1111-1111-1111-111111111111'),
        friends_count=3, current_page=1, total_pages=2,
    )
    page2 = _paginated_page(
        _friend_widget('ctl00', 'Bob', '22222222-2222-2222-2222-222222222222')
        + _friend_widget('ctl01', 'Carol', '33333333-3333-3333-3333-333333333333'),
        friends_count=3, current_page=2, total_pages=2,
    )

    session = _MockSession({1: page1, 2: page2})
    client = GeocachingFriendsClient(session=session)
    result = client.get_friends(force_refresh=True)

    assert result.pages_fetched == 2
    assert len(result.friends) == 3
    assert {f.username for f in result.friends} == {'Alice', 'Bob', 'Carol'}
    assert result.truncated is False
    # Un seul POST a été fait (page 1 -> page 2)
    assert len(session.posts) == 1
    assert session.posts[0]['__EVENTTARGET'] == 'ctl00$ContentBody$FriendPager'


def test_pagination_stops_when_no_next_page():
    """Une seule page, sans pager cliquable : pas de POST."""
    page1 = _paginated_page(
        _friend_widget('ctl00', 'Solo', '11111111-1111-1111-1111-111111111111'),
        friends_count=1, current_page=1, total_pages=1,
    )

    session = _MockSession({1: page1})
    client = GeocachingFriendsClient(session=session)
    result = client.get_friends(force_refresh=True)

    assert result.pages_fetched == 1
    assert len(result.friends) == 1
    assert session.posts == []


def test_pagination_deduplicates_friends():
    """Un ami présent sur deux pages ne doit apparaître qu'une fois."""
    page1 = _paginated_page(
        _friend_widget('ctl00', 'Alice', '11111111-1111-1111-1111-111111111111'),
        friends_count=2, current_page=1, total_pages=2,
    )
    # Alice réapparaît sur la page 2 (anomalie du pager)
    page2 = _paginated_page(
        _friend_widget('ctl00', 'Alice', '11111111-1111-1111-1111-111111111111')
        + _friend_widget('ctl01', 'Bob', '22222222-2222-2222-2222-222222222222'),
        friends_count=2, current_page=2, total_pages=2,
    )

    session = _MockSession({1: page1, 2: page2})
    client = GeocachingFriendsClient(session=session)
    result = client.get_friends(force_refresh=True)

    assert len(result.friends) == 2
    assert {f.username for f in result.friends} == {'Alice', 'Bob'}


def test_pagination_uses_next_link():
    """Le lien « Next » doit être préféré quand il existe."""
    page1 = _paginated_page(
        _friend_widget('ctl00', 'Alice', '11111111-1111-1111-1111-111111111111'),
        friends_count=2, current_page=1, total_pages=2,
    )
    page2 = _paginated_page(
        _friend_widget('ctl00', 'Bob', '22222222-2222-2222-2222-222222222222'),
        friends_count=2, current_page=2, total_pages=2,
    )

    session = _MockSession({1: page1, 2: page2})
    client = GeocachingFriendsClient(session=session)
    client.get_friends(force_refresh=True)

    # Le POST doit utiliser l'argument 'Next'
    assert session.posts[0]['__EVENTARGUMENT'] == 'Next'


def test_pagination_follows_page_number_when_no_next():
    """Sans lien « Next », on suit le numéro de page suivant."""
    page1 = _paginated_page(
        _friend_widget('ctl00', 'Alice', '11111111-1111-1111-1111-111111111111'),
        friends_count=2, current_page=1, total_pages=2,
    )
    # Retirer le lien "Next" de la page 1
    page1_no_next = page1.replace(
        "<a href=\"javascript:__doPostBack(&#39;ctl00$ContentBody$FriendPager&#39;,&#39;Next&#39;)\">Next</a>",
        ""
    )
    page2 = _paginated_page(
        _friend_widget('ctl00', 'Bob', '22222222-2222-2222-2222-222222222222'),
        friends_count=2, current_page=2, total_pages=2,
    )

    session = _MockSession({1: page1_no_next, 2: page2})
    client = GeocachingFriendsClient(session=session)
    result = client.get_friends(force_refresh=True)

    assert result.pages_fetched == 2
    assert session.posts[0]['__EVENTARGUMENT'] == '2'


def test_pagination_stops_on_postback_error():
    """Si le POST échoue (HTTP 500), on garde ce qu'on a déjà collecté."""
    page1 = _paginated_page(
        _friend_widget('ctl00', 'Alice', '11111111-1111-1111-1111-111111111111'),
        friends_count=3, current_page=1, total_pages=2,
    )

    class _ErrorSession(_MockSession):
        def post(self, url, data=None, **kwargs):
            self.posts.append(dict(data or {}))
            resp = _MockResponse('<html>Server Error</html>')
            resp.status_code = 500
            return resp

    session = _ErrorSession({1: page1})
    client = GeocachingFriendsClient(session=session)
    result = client.get_friends(force_refresh=True)

    # On a au moins les amis de la page 1
    assert len(result.friends) == 1
    assert result.friends[0].username == 'Alice'
    # La pagination s'est arrêtée proprement
    assert result.pages_fetched == 1


def test_extract_aspnet_form_fields():
    html = _paginated_page('', friends_count=0)
    fields = GeocachingFriendsClient._extract_aspnet_form_fields(html)

    assert fields['__VIEWSTATE'] == 'VIEWSATE_FAKE'
    assert fields['__VIEWSTATEGENERATOR'] == 'ABC123'
    assert fields['__EVENTVALIDATION'] == 'VALID123'


def test_extract_next_page_postback_with_next_link():
    html = _paginated_page(
        _friend_widget('ctl00', 'Alice', '11111111-1111-1111-1111-111111111111'),
        friends_count=3, current_page=1, total_pages=3,
    )
    postback = GeocachingFriendsClient._extract_next_page_postback(html)

    assert postback is not None
    target, arg = postback
    assert target == 'ctl00$ContentBody$FriendPager'
    assert arg == 'Next'


def test_extract_next_page_postback_none_on_last_page():
    html = _paginated_page(
        _friend_widget('ctl00', 'Alice', '11111111-1111-1111-1111-111111111111'),
        friends_count=1, current_page=2, total_pages=2,
    )
    postback = GeocachingFriendsClient._extract_next_page_postback(html)

    assert postback is None


def test_extract_next_page_postback_none_without_pager():
    """Une page sans pager du tout ne doit pas planter."""
    html = _page(_friend_widget('ctl00', 'Solo', '11111111-1111-1111-1111-111111111111'))
    postback = GeocachingFriendsClient._extract_next_page_postback(html)

    assert postback is None


def test_detect_current_page_number():
    """Le numéro courant est le <span> dans le pager."""
    html = _paginated_page(
        _friend_widget('ctl00', 'Alice', '11111111-1111-1111-1111-111111111111'),
        friends_count=10, current_page=3, total_pages=5,
    )
    from bs4 import BeautifulSoup
    soup = BeautifulSoup(html, 'html.parser')
    pager = soup.find('div', class_='FriendPager')

    assert GeocachingFriendsClient._detect_current_page_number(pager) == 3


def test_pages_fetched_in_to_dict():
    """Le champ pages_fetched doit apparaître dans la sérialisation."""
    result = FriendsResult(
        friends=[],
        fetched_at=__import__('datetime').datetime.now(),
        reported_count=0,
        pending_requests=0,
        truncated=False,
        pages_fetched=3,
    )
    d = result.to_dict()
    assert d['pages_fetched'] == 3
