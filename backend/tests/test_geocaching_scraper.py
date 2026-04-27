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
