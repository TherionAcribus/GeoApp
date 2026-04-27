from gc_backend.services.geocaching_auth import GeocachingAuthService


def test_extract_dashboard_favorite_stats_current_dashboard_markup():
    html = """
    <li class="leading-5">
      <div>
        <a href="https://www.geocaching.com/my/favorites.aspx">
          <span>Favorite points</span>
        </a>
      </div>
      <ul>
        <li>Remaining points: <strong>36</strong></li>
        <li>Logs until next point: <strong>9</strong></li>
        <li>Total Favorite points: <strong>1875</strong></li>
      </ul>
    </li>
    """

    stats = GeocachingAuthService._extract_dashboard_favorite_stats(html)

    assert stats["remaining_points"] == 36
    assert stats["logs_until_next_point"] == 9
    assert stats["total_favorite_points"] == 1875


def test_extract_dashboard_favorite_stats_does_not_confuse_total_with_remaining():
    html = """
    <li>Favorite points</li>
    <li>Total Favorite points: <strong>1875</strong></li>
    """

    stats = GeocachingAuthService._extract_dashboard_favorite_stats(html)

    assert stats["remaining_points"] is None
    assert stats["total_favorite_points"] == 1875


def test_extract_dashboard_favorite_stats_from_nextjs_escaped_markup():
    html = r"""
    {"html":"\u003cli\u003eRemaining points: \u003cstrong\u003e36\u003c/strong\u003e\u003c/li\u003e\u003cli\u003eLogs until next point: \u003cstrong\u003e9\u003c/strong\u003e\u003c/li\u003e\u003cli\u003eTotal Favorite points: \u003cstrong\u003e1,875\u003c/strong\u003e\u003c/li\u003e"}
    """

    stats = GeocachingAuthService._extract_dashboard_favorite_stats(html)

    assert stats["remaining_points"] == 36
    assert stats["logs_until_next_point"] == 9
    assert stats["total_favorite_points"] == 1875


def test_extract_dashboard_favorite_stats_from_text_only_markup():
    html = """
    Favorite points
    Remaining points: 36
    Logs until next point: 9
    Total Favorite points: 1 875
    """

    stats = GeocachingAuthService._extract_dashboard_favorite_stats(html)

    assert stats["remaining_points"] == 36
    assert stats["logs_until_next_point"] == 9
    assert stats["total_favorite_points"] == 1875


def test_extract_dashboard_favorite_stats_from_sidebar_props_summary():
    html = """
    <script>
      window.sidebarProps = {
        draftsCount: 0,
        favoritePointSummary: {"Total":1875,"Available":36,"LogsNeededToNext":9},
        membershipTypeName: "Premium"
      }
    </script>
    """

    stats = GeocachingAuthService._extract_dashboard_favorite_stats(html)

    assert stats["remaining_points"] == 36
    assert stats["logs_until_next_point"] == 9
    assert stats["total_favorite_points"] == 1875
