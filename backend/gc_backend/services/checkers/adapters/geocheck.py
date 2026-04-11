"""Adapter for GeoCheck.org coordinate verification service."""

from __future__ import annotations

import logging
import re
import time
from typing import Any
from urllib.parse import urlparse, parse_qs

import requests
from bs4 import BeautifulSoup

from .base import CheckerRunResult

logger = logging.getLogger(__name__)


_SUCCESS_RE = re.compile(
    r"\b(correct|bonne\s+r[ée]ponse|bravo|right|success|coordinates?\s*(are\s*)?correct)\b",
    re.IGNORECASE,
)
_FAILURE_RE = re.compile(
    r"\b(incorrect|mauvaise\s+r[ée]ponse|try\s+again|wrong|fail|error)\b",
    re.IGNORECASE,
)

_GEOCHECK_COORDS_RE = re.compile(
    r"\b[NS]\s*\d{1,2}\s*(?:°\s*)?\d{1,2}\.\d{1,3}\s*[EW]\s*\d{1,3}\s*(?:°\s*)?\d{1,2}\.\d{1,3}\b"
)

# Parse coordinates like "N 48° 29.458 E 003° 29.870" or "N48 29.458 E003 29.870"
_COORDS_PARSE_RE = re.compile(
    r'([NS])\s*(\d{1,2})\s*[°\s]\s*(\d{1,2}\.\d{1,3})\s*([EW])\s*(\d{1,3})\s*[°\s]\s*(\d{1,2}\.\d{1,3})',
    re.IGNORECASE
)


class GeocheckAdapter:
    """GeoCheck.org coordinate checker adapter.

    GeoCheck is a popular third-party coordinate verification service for geocaches.
    URL pattern: http://geocheck.org/geo_inputchkcoord.php?gid=...
    """

    def match(self, url: str) -> bool:
        """Returns True if this adapter can handle the given URL."""
        url_lower = (url or "").lower()
        return "geocheck.org" in url_lower or "geocheck.xyz" in url_lower

    def _parse_coordinates(self, candidate: str) -> dict[str, str] | None:
        """Parse coordinates into components for GeoCheck form."""
        # Normalize: remove extra spaces and degree symbols
        normalized = candidate.replace("'", "").replace('"', "").strip()
        m = _COORDS_PARSE_RE.search(normalized)
        if not m:
            return None
        ns, lat_deg, lat_min, ew, lon_deg, lon_min = m.groups()
        return {
            "ns": ns.upper(),
            "lat_deg": lat_deg,
            "lat_min": lat_min,
            "ew": ew.upper(),
            "lon_deg": lon_deg,
            "lon_min": lon_min,
        }

    def run_interactive(
        self,
        page: Any,
        url: str,
        input_payload: dict[str, Any],
        timeout_ms: int,
        timeout_sec: int = 300,
    ) -> CheckerRunResult:
        """Run GeoCheck with headed browser - user can see and intervene."""
        candidate = (
            input_payload.get("candidate") or input_payload.get("text") or ""
        ).strip()
        logger.info(f"[GeoCheck][interactive] URL: {url}, candidate: {candidate}")

        if not candidate:
            return CheckerRunResult(status="unknown", message="Missing candidate text")

        # Navigate - don't wait for networkidle as anti-bot may block
        try:
            page.goto(url, wait_until="domcontentloaded", timeout=timeout_ms)
        except Exception as e:
            logger.warning(f"[GeoCheck][interactive] Navigation error: {e}")

        # Wait for the actual GeoCheck form to appear (user may need to pass anti-bot challenge)
        logger.info(f"[GeoCheck][interactive] Waiting up to {timeout_sec}s for GeoCheck form to appear...")
        form_deadline = time.time() + timeout_sec
        form_ready = False

        while time.time() < form_deadline:
            try:
                page.wait_for_timeout(1000)
            except Exception:
                break
            try:
                has_form = (
                    page.locator('input[name="latdeg"]').count() > 0 or
                    page.locator('input[name="latmin"]').count() > 0 or
                    page.locator('input[name="coord"]').count() > 0
                )
                if has_form:
                    form_ready = True
                    logger.info("[GeoCheck][interactive] Form detected, pre-filling fields...")
                    break
            except Exception:
                continue

        if not form_ready:
            return CheckerRunResult(
                status="unknown",
                message="GeoCheck form not found (anti-bot challenge not passed?)",
                evidence=self._collect_text(page, timeout_ms).strip()[:2000],
            )

        # Close modals/banners
        self._close_modals_and_banners(page, timeout_ms)
        page.wait_for_timeout(500)

        # Try to pre-fill the form automatically
        coords = self._parse_coordinates(candidate)
        if coords:
            has_latdeg = page.locator('input[name="latdeg"]').count() > 0
            has_latmin = page.locator('input[name="latmin"]').count() > 0
            if has_latdeg or has_latmin:
                self._fill_separated_fields(page, coords, timeout_ms)
                logger.info("[GeoCheck][interactive] Fields pre-filled. User can now submit.")

        # Wait for a result - the user submits manually
        last_text = ""
        result_deadline = time.time() + (form_deadline - time.time())

        while time.time() < result_deadline:
            try:
                page.wait_for_timeout(1000)
            except Exception:
                break
            try:
                result = self._read_result(page, timeout_ms)
            except Exception:
                break
            if result["raw_text"]:
                last_text = result["raw_text"]
            if result["status"] == "success":
                return CheckerRunResult(
                    status="success",
                    message="GeoCheck accepted the coordinates",
                    evidence=result["evidence"],
                    extracted=result.get("extracted", {}),
                )
            if result["status"] == "failure":
                return CheckerRunResult(
                    status="failure",
                    message="GeoCheck rejected the coordinates",
                    evidence=result["evidence"],
                    extracted=result.get("extracted", {}),
                )

        return CheckerRunResult(
            status="unknown",
            message="Timed out waiting for GeoCheck result",
            evidence=(last_text or self._collect_text(page, timeout_ms)).strip()[:2000],
        )

    def run(
        self, page: Any, url: str, input_payload: dict[str, Any], timeout_ms: int
    ) -> CheckerRunResult:
        """Run the GeoCheck verification via HTTP (no browser needed)."""
        candidate = (
            input_payload.get("candidate") or input_payload.get("text") or ""
        ).strip()
        logger.info(f"[GeoCheck] Starting HTTP verification for URL: {url}")
        logger.info(f"[GeoCheck] Candidate coordinates: {candidate}")

        if not candidate:
            return CheckerRunResult(status="unknown", message="Missing candidate text")

        coords = self._parse_coordinates(candidate)
        if not coords:
            return CheckerRunResult(
                status="unknown",
                message=f"Unable to parse coordinates: {candidate}",
            )

        result = self._run_http(url, coords)
        logger.info(f"[GeoCheck] HTTP result: {result.status} - {result.message}")
        return result

    def _is_anubis_challenge(self, html: str) -> bool:
        """Detect if the response is an Anubis anti-bot challenge page."""
        lower = html.lower()
        return (
            'anubis' in lower or
            '_anubis' in lower or
            "n'\u00eates pas un robot" in lower or
            'proof of work' in lower.replace('-', ' ')
        )

    def _run_http(self, url: str, coords: dict[str, str]) -> CheckerRunResult:
        """Submit GeoCheck form via HTTP POST."""
        session = requests.Session()
        session.headers.update({
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8',
            'Accept-Encoding': 'gzip, deflate',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1',
        })

        # GET to detect anti-bot protection
        try:
            get_resp = session.get(url, timeout=30, allow_redirects=True)
            get_resp.raise_for_status()
            logger.info(f"[GeoCheck][http] GET {url} -> {get_resp.status_code}")
        except Exception as e:
            logger.error(f"[GeoCheck][http] GET failed: {e}")
            return CheckerRunResult(status="unknown", message=f"HTTP GET failed: {e}")

        # Detect Anubis anti-bot: return a manual link for the user
        if self._is_anubis_challenge(get_resp.text):
            logger.info("[GeoCheck][http] Anubis anti-bot detected - returning manual URL")
            https_url = get_resp.url
            return CheckerRunResult(
                status="unknown",
                message=(
                    f"GeoCheck est protégé par un système anti-bot (Anubis). "
                    f"Veuillez vérifier les coordonnées manuellement."
                ),
                extracted={'manual_url': https_url},
            )

        # Build form data matching GeoCheck's input fields
        form_data = {
            'lat': coords['ns'],
            'latdeg': coords['lat_deg'],
            'latmin': coords['lat_min'],
            'lon': coords['ew'],
            'londeg': coords['lon_deg'],
            'lonmin': coords['lon_min'],
        }
        logger.info(f"[GeoCheck][http] POSTing form: {form_data}")

        # POST the form
        try:
            post_resp = session.post(
                url,
                data=form_data,
                timeout=30,
                allow_redirects=True,
                headers={'Referer': url, 'Content-Type': 'application/x-www-form-urlencoded'},
            )
            post_resp.raise_for_status()
            logger.info(f"[GeoCheck][http] POST -> {post_resp.status_code}")
        except Exception as e:
            logger.error(f"[GeoCheck][http] POST failed: {e}")
            return CheckerRunResult(status="unknown", message=f"HTTP POST failed: {e}")

        # Check if POST response is also blocked by Anubis
        if self._is_anubis_challenge(post_resp.text):
            logger.warning("[GeoCheck][http] POST response blocked by Anubis")
            return CheckerRunResult(
                status="unknown",
                message="GeoCheck POST blocked by Anubis anti-bot",
            )

        # Parse result
        return self._parse_http_response(post_resp.text)

    def _parse_http_response(self, html: str) -> CheckerRunResult:
        """Parse GeoCheck HTML response for success/failure."""
        soup = BeautifulSoup(html, 'html.parser')
        # Remove scripts and styles
        for tag in soup(['script', 'style']):
            tag.decompose()

        text = soup.get_text(separator=' ', strip=True)
        logger.info(f"[GeoCheck][http] Response text (first 300): {text[:300]}")

        # Detect anti-bot / empty response
        if len(text.strip()) < 20:
            return CheckerRunResult(
                status="unknown",
                message="Empty or blocked response from GeoCheck",
                evidence=html[:500],
            )

        # Detect success
        if _SUCCESS_RE.search(text):
            coords = self._extract_coords(text)
            extracted: dict[str, Any] = {}
            if coords:
                extracted["coordinates_raw"] = coords
            return CheckerRunResult(
                status="success",
                message="GeoCheck accepted the coordinates",
                evidence=text[:2000],
                extracted=extracted,
            )

        # Detect failure
        if _FAILURE_RE.search(text):
            return CheckerRunResult(
                status="failure",
                message="GeoCheck rejected the coordinates",
                evidence=text[:2000],
            )

        # Additional keyword checks
        text_lower = text.lower()
        if any(w in text_lower for w in ['congratulations', 'bravo', 'correct', 'réussi', 'bonne']):
            return CheckerRunResult(
                status="success",
                message="GeoCheck accepted the coordinates",
                evidence=text[:2000],
            )
        if any(w in text_lower for w in ['wrong', 'incorrect', 'mauvais', 'erreur', 'faux']):
            return CheckerRunResult(
                status="failure",
                message="GeoCheck rejected the coordinates",
                evidence=text[:2000],
            )

        return CheckerRunResult(
            status="unknown",
            message="GeoCheck response not conclusive",
            evidence=text[:2000],
        )

    def _run_playwright(
        self, page: Any, url: str, input_payload: dict[str, Any], timeout_ms: int
    ) -> CheckerRunResult:
        """Legacy Playwright-based verification (kept as reference)."""
        candidate = (
            input_payload.get("candidate") or input_payload.get("text") or ""
        ).strip()
        logger.info(f"[GeoCheck] Starting verification for URL: {url}")
        logger.info(f"[GeoCheck] Candidate coordinates: {candidate}")
        if not candidate:
            return CheckerRunResult(status="unknown", message="Missing candidate text")

        if not candidate:
            return CheckerRunResult(status="unknown", message="Missing candidate text")

        # Extract gid from URL if present
        gid = self._extract_gid(url)
        logger.info(f"[GeoCheck] Extracted gid: {gid}")

        try:
            logger.info("[GeoCheck] Navigating to page...")
            page.goto(url, wait_until="networkidle", timeout=timeout_ms)
        except Exception as e:
            logger.warning(f"[GeoCheck] Networkidle timeout, trying domcontentloaded: {e}")
            page.goto(url, wait_until="domcontentloaded", timeout=timeout_ms)

        # Wait for page to be fully loaded and stable
        try:
            page.wait_for_load_state("networkidle", timeout=timeout_ms)
        except Exception as e:
            logger.warning(f"[GeoCheck] wait_for_load_state failed: {e}")
        page.wait_for_timeout(1000)  # Extra wait for any JS to init
        logger.info(f"[GeoCheck] Page loaded, URL: {page.url}")

        # Check if we're on the right page
        if not self._is_geocheck_page(page):
            page_title = page.title() if hasattr(page, 'title') else 'N/A'
            logger.error(f"[GeoCheck] Not a valid GeoCheck page. Title: {page_title}")
            return CheckerRunResult(
                status="unknown",
                message="Not a valid GeoCheck page",
                evidence=self._collect_text(page, timeout_ms).strip()[:2000],
            )
        logger.info("[GeoCheck] Valid GeoCheck page confirmed")

        # Parse coordinates
        coords = self._parse_coordinates(candidate)
        if not coords:
            logger.error(f"[GeoCheck] Failed to parse coordinates: {candidate}")
            return CheckerRunResult(
                status="unknown",
                message=f"Unable to parse coordinates: {candidate}",
                evidence=self._collect_text(page, timeout_ms).strip()[:2000],
            )
        logger.info(f"[GeoCheck] Parsed coordinates: {coords}")

        # Check if GeoCheck uses separated number fields (latdeg, latmin, londeg, lonmin)
        has_latdeg = page.locator('input[name="latdeg"]').count() > 0
        has_latmin = page.locator('input[name="latmin"]').count() > 0
        has_separated_fields = has_latdeg or has_latmin
        logger.info(f"[GeoCheck] Has separated fields: {has_separated_fields} (latdeg={has_latdeg}, latmin={has_latmin})")

        if has_separated_fields:
            # Fill separated fields
            logger.info("[GeoCheck] Filling separated fields...")
            filled = self._fill_separated_fields(page, coords, timeout_ms)
            if not filled:
                logger.error("[GeoCheck] Failed to fill separated fields")
                return CheckerRunResult(
                    status="unknown",
                    message="Failed to fill coordinate fields",
                    evidence=self._collect_text(page, timeout_ms).strip()[:2000],
                )
            logger.info("[GeoCheck] Separated fields filled, submitting form...")
            # Submit form via JavaScript for reliability
            submit_success = self._submit_form_js(page, timeout_ms)
            logger.info(f"[GeoCheck] Form submitted: {submit_success}")
            if submit_success:
                logger.info(f"[GeoCheck] After submit, URL: {page.url}")
        else:
            # Try to find a single text input for coordinates
            input_selectors = [
                'input[name="coord"][type="text"]',
                'input#coord[type="text"]',
                'input[type="text"][name*="coord"]',
                'input#coord',
                'input[name="coord"]',
                'input[type="text"]:visible',
                'form input[type="text"]:visible',
            ]

            input_loc = None
            for selector in input_selectors:
                try:
                    loc = page.locator(selector).first
                    if loc.count() > 0 and loc.is_visible():
                        input_loc = loc
                        break
                except Exception:
                    continue

            if not input_loc:
                return CheckerRunResult(
                    status="unknown",
                    message="Unable to find coordinate input field",
                    evidence=self._collect_text(page, timeout_ms).strip()[:2000],
                )

            try:
                input_loc.fill(candidate, timeout=timeout_ms)
            except Exception as exc:
                return CheckerRunResult(
                    status="unknown",
                    message=f"Unable to fill input: {exc}",
                    evidence=self._collect_text(page, timeout_ms).strip()[:2000],
                )
            # Click submit button for single input form
            submit_clicked = self._click_submit_button(page, timeout_ms, input_loc)

        # Wait for result
        wait_sec = max(1, timeout_ms // 1000)
        logger.info(f"[GeoCheck] Waiting up to {wait_sec}s for result...")
        deadline = time.time() + wait_sec
        last_text = ""
        iteration = 0

        while time.time() < deadline:
            iteration += 1
            logger.debug(f"[GeoCheck] Waiting iteration {iteration}...")
            try:
                page.wait_for_timeout(1000)
            except Exception as e:
                logger.error(f"[GeoCheck] wait_for_timeout failed: {e}")
                break

            try:
                result = self._read_result(page, timeout_ms)
            except Exception as e:
                logger.error(f"[GeoCheck] _read_result failed: {e}")
                break

            if result["raw_text"]:
                last_text = result["raw_text"]
                logger.debug(f"[GeoCheck] Got text: {last_text[:100]}...")

            # Log more details for debugging
            if iteration == 1 or iteration % 5 == 0:
                logger.info(f"[GeoCheck] Iteration {iteration}: status={result['status']}, text_preview={last_text[:80]}")

            if result["status"] == "success":
                logger.info("[GeoCheck] SUCCESS: coordinates accepted")
                return CheckerRunResult(
                    status="success",
                    message="GeoCheck accepted the coordinates",
                    evidence=result["evidence"],
                    extracted=result.get("extracted", {}),
                )

            if result["status"] == "failure":
                logger.info("[GeoCheck] FAILURE: coordinates rejected")
                return CheckerRunResult(
                    status="failure",
                    message="GeoCheck rejected the coordinates",
                    evidence=result["evidence"],
                    extracted=result.get("extracted", {}),
                )

        # Final attempt to capture page state
        final_text = self._collect_text(page, timeout_ms).strip()[:2000]
        logger.warning(f"[GeoCheck] TIMEOUT after {wait_sec}s. Final page text: {final_text[:200]}")
        return CheckerRunResult(
            status="unknown",
            message="Timed out waiting for GeoCheck result",
            evidence=(last_text or final_text),
        )

    def _extract_gid(self, url: str) -> str | None:
        """Extract the gid parameter from GeoCheck URL."""
        try:
            parsed = urlparse(url)
            params = parse_qs(parsed.query)
            gid = params.get("gid", [None])[0]
            return gid
        except Exception:
            return None

    def _is_geocheck_page(self, page: Any) -> bool:
        """Check if the current page is a valid GeoCheck page."""
        try:
            title = page.title()
            if title and "geocheck" in title.lower():
                return True
            url = page.url
            if url and "geocheck" in url.lower():
                return True
            # Check for typical GeoCheck elements
            if page.locator('input[name="coord"]').count() > 0:
                return True
            if page.locator('input[name="latdeg"]').count() > 0:
                return True
            if page.locator('input[name="gid"]').count() > 0:
                return True
            return False
        except Exception:
            return False

    def _close_modals_and_banners(self, page: Any, timeout_ms: int) -> bool:
        """Try to close cookie consent banner and language selector if present."""
        closed = False

        # First, try to close language selector modal
        lang_selectors = [
            'button:has-text("close")',
            'button[aria-label*="close" i]',
            '.close-button',
            '.modal-close',
            '[class*="language"] button',
        ]
        for selector in lang_selectors:
            try:
                loc = page.locator(selector).first
                if loc.count() > 0 and loc.is_visible():
                    logger.info(f"[GeoCheck] Closing language/modal with: {selector}")
                    loc.click(timeout=3000)
                    page.wait_for_timeout(500)
                    closed = True
                    break
            except Exception:
                continue

        # Try to click specific consent buttons
        consent_selectors = [
            '.fc-cta-consent',  # Primary consent button
            '.fc-cta-manage-options',  # Manage options button
            '.fc-footer-buttons button:first-child',
            '.fc-consent-root .fc-button',
            'button.fc-button[aria-label*="consent" i]',
        ]
        for selector in consent_selectors:
            try:
                loc = page.locator(selector).first
                if loc.count() > 0 and loc.is_visible():
                    logger.info(f"[GeoCheck] Clicking consent banner with: {selector}")
                    try:
                        loc.click(timeout=5000)
                    except Exception:
                        # Try force click via JavaScript
                        page.evaluate(f"document.querySelector('{selector.replace(chr(39), chr(34))}')?.click()")
                    page.wait_for_timeout(500)
                    closed = True
                    break
            except Exception as e:
                logger.debug(f"[GeoCheck] Consent selector '{selector}' failed: {e}")
                continue

        # Try to remove banners entirely via JavaScript
        try:
            page.evaluate("""
                const banners = document.querySelectorAll('.fc-consent-root, .fc-dialog-container, [class*="language"], [class*="modal"]');
                banners.forEach(b => b.remove());
            """)
            page.wait_for_timeout(300)
            logger.info("[GeoCheck] Removed banners via JavaScript")
            closed = True
        except Exception as e:
            logger.debug(f"[GeoCheck] JavaScript removal failed: {e}")

        return closed

    def _submit_form_js(self, page: Any, timeout_ms: int) -> bool:
        """Submit the form via JavaScript."""
        try:
            # Close any modals first
            self._close_modals_and_banners(page, timeout_ms)
            page.wait_for_timeout(500)

            # Submit form via JavaScript
            result = page.evaluate("""
                () => {
                    const form = document.querySelector('form');
                    if (form) {
                        form.submit();
                        return 'form-submitted';
                    }
                    const submitBtn = document.querySelector('input[type="submit"], button[type="submit"]');
                    if (submitBtn) {
                        submitBtn.click();
                        return 'button-clicked';
                    }
                    return 'no-form-found';
                }
            """)
            logger.info(f"[GeoCheck] JavaScript submission result: {result}")
            page.wait_for_timeout(2000)  # Wait for navigation
            return result in ('form-submitted', 'button-clicked')
        except Exception as e:
            logger.error(f"[GeoCheck] JavaScript form submission failed: {e}")
            return False

    def _click_submit_button(self, page: Any, timeout_ms: int, input_loc: Any = None) -> bool:
        """Click the submit button or press Enter."""
        # First, try to close any modals, language selectors, or consent banners
        self._close_modals_and_banners(page, timeout_ms)
        page.wait_for_timeout(500)  # Wait after closing modals

        # Let's see what buttons are on the page
        try:
            all_buttons = page.locator('input[type="submit"], button[type="submit"], button, input[type="button"]').all()
            logger.info(f"[GeoCheck] Found {len(all_buttons)} buttons/inputs on page:")
            for i, btn in enumerate(all_buttons[:10]):
                try:
                    btn_type = btn.get_attribute('type') or 'no-type'
                    btn_value = btn.get_attribute('value') or ''
                    btn_text = btn.inner_text() if hasattr(btn, 'inner_text') else ''
                    btn_name = btn.get_attribute('name') or ''
                    btn_visible = btn.is_visible() if hasattr(btn, 'is_visible') else 'unknown'
                    logger.info(f"  Button[{i}]: type={btn_type}, value={btn_value[:30]}, text={btn_text[:30]}, name={btn_name}, visible={btn_visible}")
                except Exception as e:
                    logger.info(f"  Button[{i}]: error reading: {e}")
        except Exception as e:
            logger.warning(f"[GeoCheck] Could not list buttons: {e}")

        button_selectors = [
            'input[type="submit"]:visible',
            'button[type="submit"]:visible',
            '#check:visible',
            '.check-button:visible',
            'input[value*="Check" i]:visible',
            'input[value*="Vérifier" i]:visible',
            'input[value*="Submit" i]:visible',
            'input[value*="Go" i]:visible',
            'input[value*="Valider" i]:visible',
            'input[value*="OK" i]:visible',
            'button:has-text("Check"):visible',
            'button:has-text("Vérifier"):visible',
            'button:has-text("Submit"):visible',
            'button:has-text("Go"):visible',
            'button:has-text("Valider"):visible',
            'button:has-text("OK"):visible',
            'form button:visible',
            'form input[type="submit"]:visible',
            'input[name="action"][type="submit"]:visible',
            'input[type="image"]:visible',  # Image submit buttons
        ]

        for selector in button_selectors:
            try:
                loc = page.locator(selector).first
                count = loc.count()
                if count > 0:
                    is_visible = loc.is_visible()
                    is_enabled = loc.is_enabled() if is_visible else False
                    logger.info(f"[GeoCheck] Selector '{selector}' matched {count} element(s), visible={is_visible}, enabled={is_enabled}")
                    if is_visible and is_enabled:
                        # Try multiple click methods
                        try:
                            # Standard click
                            loc.click(timeout=timeout_ms)
                            logger.info(f"[GeoCheck] Clicked button with selector: {selector}")
                            return True
                        except Exception as click_err:
                            # If blocked by overlay, try force click
                            if "intercepts pointer events" in str(click_err):
                                logger.info("[GeoCheck] Standard click blocked, trying JavaScript click...")
                                try:
                                    page.evaluate(f"""
                                        const btn = document.querySelector('{selector.replace(chr(39), chr(34))}');
                                        if (btn) {{ btn.click(); btn.form?.submit(); }}
                                    """)
                                    logger.info("[GeoCheck] JavaScript click succeeded")
                                    return True
                                except Exception as js_err:
                                    logger.warning(f"[GeoCheck] JavaScript click failed: {js_err}")
                            raise
            except Exception as e:
                logger.debug(f"[GeoCheck] Selector '{selector}' failed: {e}")
                continue

        logger.warning("[GeoCheck] No submit button found with standard selectors")

        # Fallback: press Enter on input field
        if input_loc:
            try:
                logger.info("[GeoCheck] Falling back to pressing Enter")
                input_loc.press("Enter")
                return True
            except Exception as e:
                logger.warning(f"[GeoCheck] Press Enter failed: {e}")

        return False

    def _fill_separated_fields(self, page: Any, coords: dict[str, str], timeout_ms: int) -> bool:
        """Fill separated coordinate fields (latdeg, latmin, londeg, lonmin)."""
        try:
            # Select N/S radio button
            ns_radio = f'input[name="lat"][value="{coords["ns"]}"]'
            if page.locator(ns_radio).count() > 0:
                page.locator(ns_radio).first.check()

            # Select E/W radio button
            ew_radio = f'input[name="lon"][value="{coords["ew"]}"]'
            if page.locator(ew_radio).count() > 0:
                page.locator(ew_radio).first.check()

            # Fill numeric fields
            fields = {
                "latdeg": coords["lat_deg"],
                "latmin": coords["lat_min"],
                "londeg": coords["lon_deg"],
                "lonmin": coords["lon_min"],
            }

            for name, value in fields.items():
                selector = f'input[name="{name}"]'
                loc = page.locator(selector).first
                if loc.count() > 0 and loc.is_visible():
                    loc.fill(value, timeout=timeout_ms)
                else:
                    return False

            return True
        except Exception as e:
            return False

    def _read_result(self, page: Any, timeout_ms: int) -> dict[str, Any]:
        """Read the verification result from the page."""
        raw_text = ""
        evidence = ""
        extracted: dict[str, Any] = {}

        # Try to find result message
        try:
            # Look for result divs or messages (GeoCheck specific + generic)
            result_selectors = [
                "#result",  # GeoCheck result div
                ".result",
                ".success-message",
                ".error-message",
                "[class*=success]",
                "[class*=error]",
                ".message",
                "#message",
                ".status",
                ".response",
                "h2",
                "h3",
                "h4",
                ".info",
                "#info",
                "[class*=info]",
                "td[colspan]",  # GeoCheck uses table cells for results
                "tr[class]",
            ]
            for selector in result_selectors:
                try:
                    loc = page.locator(selector).first
                    if loc.count() > 0 and loc.is_visible():
                        text = (loc.inner_text(timeout=2000) or "").strip()
                        if text and len(text) > 3:  # Ignore empty/short texts
                            raw_text = text
                            break
                except Exception:
                    continue
        except Exception:
            pass

        # If no specific result element found, collect page text
        if not raw_text:
            raw_text = self._collect_text(page, timeout_ms)

        evidence = (raw_text or "").strip()[:2000]

        # Try to extract coordinates from result
        coords = self._extract_coords(raw_text)
        if coords:
            extracted["coordinates_raw"] = coords

        # Determine status
        status = "unknown"
        text_lower = (raw_text or "").lower()

        if _SUCCESS_RE.search(raw_text or ""):
            status = "success"
        elif _FAILURE_RE.search(raw_text or ""):
            status = "failure"
        elif any(
            word in text_lower
            for word in ["congratulations", "success", "correct", "valid"]
        ):
            status = "success"
        elif any(
            word in text_lower for word in ["wrong", "error", "fail", "invalid"]
        ):
            status = "failure"

        return {
            "status": status,
            "evidence": evidence,
            "raw_text": (raw_text or "").strip()[:2000],
            "extracted": extracted,
        }

    def _extract_coords(self, text: str | None) -> str | None:
        """Extract coordinates from text."""
        if not text:
            return None
        m = _GEOCHECK_COORDS_RE.search(text)
        if m:
            return m.group(0)
        return None

    def _collect_text(self, page: Any, timeout_ms: int) -> str:
        """Collect all text from the page."""
        texts: list[str] = []
        try:
            texts.append(page.locator("body").inner_text(timeout=timeout_ms))
        except Exception:
            pass
        return "\n".join([t for t in texts if t])
