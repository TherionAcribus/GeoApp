import pytest

from gc_backend.services.geocaching_friends import (
    GeocachingFriendsClient,
    GeocachingFriendsError,
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
