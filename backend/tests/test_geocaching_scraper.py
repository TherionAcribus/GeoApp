from gc_backend.geocaches.scraper import GeocachingScraper


class _FakeResponse:
    status_code = 200

    def __init__(self, text: str) -> None:
        self.text = text

    def raise_for_status(self) -> None:
        return None


class _FakeSession:
    def __init__(self, html: str) -> None:
        self.html = html

    def get(self, url: str, timeout: int) -> _FakeResponse:
        return _FakeResponse(self.html)


def _scrape_html(html: str):
    scraper = GeocachingScraper(session=_FakeSession(html))
    return scraper.scrape('GCB0ABT')


def test_scraper_extracts_cache_type_from_current_cache_details_layout():
    scraped = _scrape_html(
        """
        <html>
            <body>
                <h1>7-POLYGLOTTE</h1>
                <ul class="ul__cache-details unstyled">
                    <li class="li__cache-icon">
                        <svg class="icon cache-icon" role="presentation">
                            <use xlink:href="/app/ui-icons/sprites/cache-types.svg#icon-8" />
                        </svg>
                    </li>
                    <li class="li__cache-type">
                        Mystery
                    </li>
                    <li class="li__gccode">GCB0ABT</li>
                </ul>
            </body>
        </html>
        """
    )

    assert scraped.type == 'Mystery'


def test_scraper_extracts_cache_type_from_geocaching_type_icon_when_text_is_missing():
    scraped = _scrape_html(
        """
        <html>
            <head>
                <meta property="og:image" content="https://www.geocaching.com/images/facebook/wpttypes/8.png" />
            </head>
            <body>
                <h1>7-POLYGLOTTE</h1>
            </body>
        </html>
        """
    )

    assert scraped.type == 'Mystery'


def _found_status_html(img_src: str, log_text: str, log_date: str = '08/24/2026') -> str:
    """Bandeau « FoundStatus » tel que rendu dans la colonne de droite du listing."""
    return f"""
    <html>
        <body>
            <h1>7-POLYGLOTTE</h1>
            <div class="CacheDetailNavigation NoPrint">
                <div id="ctl00_ContentBody_GeoNav_foundStatus" class="FoundStatus">
                    <img src="{img_src}" id="ctl00_ContentBody_GeoNav_logTypeImage" alt="" />
                    <p>
                        <strong id="ctl00_ContentBody_GeoNav_logText">{log_text}</strong>
                        <small id="ctl00_ContentBody_GeoNav_logDate">
                            <a href="/seek/log.aspx?LUID=x">Logged on: {log_date}</a>
                        </small>
                    </p>
                </div>
            </div>
        </body>
    </html>
    """


def test_scraper_detects_found_from_log_type_icon_whatever_the_interface_language():
    """Le libellé est traduit selon la langue du compte, l'id du type de log non."""
    for label in ('Found It!', 'Trouvée !', 'Gefunden!'):
        scraped = _scrape_html(_found_status_html('/images/logtypes/48/2.png', label))
        assert scraped.found is True, label
        assert scraped.found_date is not None, label


def test_scraper_counts_attended_and_webcam_logs_as_found():
    for type_id in (10, 11):
        scraped = _scrape_html(
            _found_status_html(f'/images/logtypes/48/{type_id}.png', 'Attended')
        )
        assert scraped.found is True, type_id


def test_scraper_does_not_report_found_for_a_did_not_find_log():
    scraped = _scrape_html(_found_status_html('/images/logtypes/48/3.png', "Didn't find it"))
    assert scraped.found is False
    assert scraped.found_date is None


def test_scraper_leaves_found_unknown_when_the_banner_is_absent():
    """Bandeau absent : cache non trouvée, ou page servie sans session connectée."""
    scraped = _scrape_html('<html><body><h1>7-POLYGLOTTE</h1></body></html>')
    assert scraped.found is None


def _owner_block_html(owner_block: str) -> str:
    return f"""
    <html>
        <body>
            <h1>7-POLYGLOTTE</h1>
            {owner_block}
        </body>
    </html>
    """


OWNER_GUID = 'e4c9aa12-6aa4-48f8-9e2a-8b69040ae285'


def test_scraper_extracts_owner_guid_from_the_message_owner_link():
    scraped = _scrape_html(_owner_block_html(
        f"""
        <div id="ctl00_ContentBody_mcd1">
            A cache by <a href="https://www.geocaching.com/p/?guid={OWNER_GUID}&amp;wid=8e82a0c4-2784-4d87-88b4-3cffbc2a0225&amp;ds=2">reikja</a>
            <span class="message__owner">
                <a id="lnkMessageOwner" href="/account/messagecenter?recipientId={OWNER_GUID}&amp;gcCode=GC890F8">Message this owner</a>
            </span>
        </div>
        """
    ))

    assert scraped.owner == 'reikja'
    assert scraped.owner_guid == OWNER_GUID


def test_scraper_falls_back_on_the_profile_link_when_messaging_is_unavailable():
    """Certains listings n'affichent pas « Message this owner » : reste le lien de profil."""
    scraped = _scrape_html(_owner_block_html(
        f"""
        <div id="ctl00_ContentBody_mcd1">
            A cache by <a href="/p/?guid={OWNER_GUID}">reikja</a>
        </div>
        """
    ))

    assert scraped.owner_guid == OWNER_GUID


def test_scraper_ignores_profile_links_outside_the_owner_block():
    """Les auteurs de logs ont aussi des liens /p/?guid= : ils ne sont pas le proprietaire."""
    scraped = _scrape_html(_owner_block_html(
        f"""
        <div id="ctl00_ContentBody_mcd1">A cache by <span>reikja</span></div>
        <a href="/p/?guid={OWNER_GUID}">un autre joueur</a>
        """
    ))

    assert scraped.owner_guid is None


def test_scraper_rejects_a_malformed_guid():
    scraped = _scrape_html(_owner_block_html(
        """
        <div id="ctl00_ContentBody_mcd1">
            A cache by <a href="/p/?guid=not-a-guid">reikja</a>
        </div>
        """
    ))

    assert scraped.owner_guid is None
