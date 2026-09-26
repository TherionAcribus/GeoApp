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


def _find_counts_html(counters: str) -> str:
    return f"""
        <html>
            <body>
                <h1>7-POLYGLOTTE</h1>
                <ul class="ul__cache-details unstyled">
                    <li class="li__gccode">GCB0ABT</li>
                </ul>
                <span id="ctl00_ContentBody_lblFindCounts">
                    <p class="NoBottomSpacing">{counters}</p>
                </span>
            </body>
        </html>
    """


def test_scraper_reads_finds_count_from_log_type_counters():
    scraped = _scrape_html(_find_counts_html(
        '<img src="/images/logtypes/2.png" alt="Found it" title="Found it">165&nbsp;&nbsp;'
        '<img src="/images/logtypes/3.png" alt="Didn\'t find it" title="Didn\'t find it">4&nbsp;&nbsp;'
        '<img src="/images/logtypes/4.png" alt="Write note" title="Write note">2&nbsp;'
    ))

    assert scraped.finds_count == 165


def test_scraper_sums_find_like_log_types():
    """Un event compte ses « Attended », une webcam ses photos : même dénominateur."""
    scraped = _scrape_html(_find_counts_html(
        '<img src="/images/logtypes/10.png" alt="Attended" title="Attended">37&nbsp;&nbsp;'
        '<img src="/images/logtypes/11.png" alt="Webcam Photo Taken" title="Webcam Photo Taken">3&nbsp;&nbsp;'
        '<img src="/images/logtypes/9.png" alt="Will Attend" title="Will Attend">12&nbsp;'
    ))

    assert scraped.finds_count == 40


def test_scraper_handles_thousands_separator_in_counters():
    scraped = _scrape_html(_find_counts_html(
        '<img src="/images/logtypes/2.png" alt="Found it" title="Found it">1,234&nbsp;'
    ))

    assert scraped.finds_count == 1234


def test_scraper_leaves_finds_count_unknown_without_counters():
    """Pas de compteurs sur la page : `None`, pas 0, pour ne pas figer un 0 % faux."""
    scraped = _scrape_html(
        """
        <html><body>
            <h1>7-POLYGLOTTE</h1>
            <ul class="ul__cache-details unstyled"><li class="li__gccode">GCB0ABT</li></ul>
        </body></html>
        """
    )

    assert scraped.finds_count is None


def test_scraper_still_detects_archived_cache_while_counting_finds():
    scraped = _scrape_html(_find_counts_html(
        '<img src="/images/logtypes/2.png" alt="Found it" title="Found it">12&nbsp;&nbsp;'
        '<img src="/images/logtypes/5.png" alt="Archive" title="Archive">1&nbsp;'
    ))

    assert scraped.status == 'archived'
    assert scraped.finds_count == 12


def test_scraper_keeps_description_content_moved_after_legacy_span():
    """Les tableaux invalides d'un listing peuvent fermer le span avant les questions."""
    scraped = _scrape_html(
        """
        <html><body>
            <h1>Une longue EarthCache</h1>
            <div class="CacheDetailDescription">
                <span id="ctl00_ContentBody_LongDescription">
                    <p>Contexte géologique avant les tableaux.</p>
                    <table><tr><td>Brèche</td></tr></table>
                </span>
                <table><tr><td>Conglomérat et matrice calcaire.</td></tr></table>
                <p>Pour valider cette EarthCache, répondez aux questions suivantes :</p>
                <ol>
                    <li>Pourquoi trouve-t-on plusieurs types de galets ?</li>
                    <li>Décrivez la surface du conglomérat observé.</li>
                </ol>
            </div>
            <div id="div_hint">Aucun indice</div>
        </body></html>
        """
    )

    assert 'Contexte géologique' in scraped.description_raw
    assert 'Conglomérat et matrice calcaire' in scraped.description_raw
    assert 'Pourquoi trouve-t-on plusieurs types de galets' in scraped.description_raw
    assert 'Décrivez la surface du conglomérat observé' in scraped.description_raw
    assert 'Aucun indice' not in scraped.description_raw


def test_scraper_keeps_normal_long_description_without_hint_boundary():
    scraped = _scrape_html(
        """
        <html><body>
            <h1>EarthCache simple</h1>
            <span id="ctl00_ContentBody_LongDescription">
                <p>Description complète et question finale ?</p>
            </span>
        </body></html>
        """
    )

    assert 'Description complète et question finale ?' in scraped.description_raw
