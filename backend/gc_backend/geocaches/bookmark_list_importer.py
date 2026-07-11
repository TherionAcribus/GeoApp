"""
Importer for Geocaching.com Bookmark Lists.

This module handles importing geocaches from bookmark lists using either:
1. Web scraping (for users without API access)
2. Geocaching.com API (if available)
"""

from __future__ import annotations

import logging
import re
from typing import Optional
import requests
from bs4 import BeautifulSoup

from ..services.geocaching_auth import GEOAPP_USER_AGENT

logger = logging.getLogger(__name__)


class BookmarkListImporter:
    """Import geocaches from Geocaching.com bookmark lists."""
    
    BOOKMARK_LIST_URL = 'https://www.geocaching.com/plan/lists/'
    USER_LISTS_URL = 'https://www.geocaching.com/my/lists.aspx'
    NEXTJS_LISTS_PAGE = 'https://www.geocaching.com/plan/lists'

    # Build ID Next.js par défaut si la détection échoue. Il change à chaque
    # déploiement de Geocaching.com : on tente d'abord de l'extraire de la page.
    DEFAULT_BUILD_ID = 'release-20260122.1.2725'

    def __init__(self, session: Optional[requests.Session] = None) -> None:
        self.session = session or requests.Session()
        self.session.headers.setdefault('User-Agent', GEOAPP_USER_AGENT)
        self._build_id: Optional[str] = None

    def _get_build_id(self) -> str:
        """Détecte le build ID Next.js courant depuis ``__NEXT_DATA__``.

        Le résultat est mis en cache pour la durée de vie de l'instance. En cas
        d'échec (page indisponible, structure changée), on retombe sur la valeur
        par défaut — l'appelant a de toute façon un repli HTML/scraping.
        """
        if self._build_id:
            return self._build_id
        try:
            resp = self.session.get(self.NEXTJS_LISTS_PAGE, timeout=30)
            if resp.status_code == 200:
                match = re.search(r'"buildId"\s*:\s*"([^"]+)"', resp.text)
                if match:
                    self._build_id = match.group(1)
                    logger.debug(f"Detected Next.js buildId: {self._build_id}")
                    return self._build_id
            logger.debug(
                f"Could not detect Next.js buildId (status {resp.status_code}), using default"
            )
        except Exception as e:
            logger.debug(f"Failed to detect Next.js buildId: {e}")
        self._build_id = self.DEFAULT_BUILD_ID
        return self._build_id

    @staticmethod
    def validate_bookmark_code(code: str) -> str:
        """Validate and normalize a bookmark list code (e.g., BM1234)."""
        normalized = (code or '').strip().upper()
        if not re.match(r'^BM[0-9A-Z]+$', normalized):
            raise ValueError('invalid_bookmark_code')
        return normalized
    
    def get_geocaches_from_list(self, bookmark_code: str) -> list[str]:
        """
        Get all geocache codes from a bookmark list.
        
        Args:
            bookmark_code: The bookmark list code (e.g., BM1234)
            
        Returns:
            List of GC codes found in the bookmark list
            
        Raises:
            ValueError: If bookmark code is invalid
            LookupError: If bookmark list not found or not accessible
            RuntimeError: If scraping fails
        """
        code = self.validate_bookmark_code(bookmark_code)
        logger.info(f"Fetching geocaches from bookmark list {code}")
        
        gc_codes = []
        
        # Try the Next.js data endpoint first
        logger.debug(f"Starting geocache extraction for {code}")
        try:
            build_id = self._get_build_id()
            nextjs_url = f'https://www.geocaching.com/_next/data/{build_id}/en/plan/lists/{code}.json?bmCode={code}'
            logger.debug(f"Trying Next.js data endpoint: {nextjs_url}")
            
            resp = self.session.get(nextjs_url, timeout=30)
            
            if resp.status_code == 200:
                try:
                    data = resp.json()
                    logger.debug(f"Next.js response received, parsing data...")
                    
                    # Extract geocaches from pageProps
                    if isinstance(data, dict):
                        page_props = data.get('pageProps', {})
                        logger.debug(f"pageProps keys: {list(page_props.keys()) if page_props else 'None'}")
                        
                        # Look for geocaches in various possible locations
                        geocaches = (
                            page_props.get('geocaches') or
                            page_props.get('items') or
                            page_props.get('caches') or
                            []
                        )
                        
                        if isinstance(geocaches, list):
                            for item in geocaches:
                                if isinstance(item, dict):
                                    gc_code = item.get('referenceCode') or item.get('code') or item.get('gcCode')
                                    if gc_code and gc_code.startswith('GC'):
                                        if gc_code not in gc_codes:
                                            gc_codes.append(gc_code)
                        
                        # Also check if there's a 'list' object with geocaches
                        list_obj = page_props.get('list', {})
                        if isinstance(list_obj, dict):
                            list_geocaches = list_obj.get('geocaches') or list_obj.get('items') or []
                            if isinstance(list_geocaches, list):
                                for item in list_geocaches:
                                    if isinstance(item, dict):
                                        gc_code = item.get('referenceCode') or item.get('code') or item.get('gcCode')
                                        if gc_code and gc_code.startswith('GC'):
                                            if gc_code not in gc_codes:
                                                gc_codes.append(gc_code)
                    
                    if gc_codes:
                        logger.info(f"Found {len(gc_codes)} geocaches from Next.js data")
                        return gc_codes
                    else:
                        logger.debug(f"No geocaches found in Next.js data structure")
                        
                except Exception as e:
                    logger.debug(f"Failed to parse Next.js data: {e}", exc_info=True)
            else:
                logger.debug(f"Next.js endpoint returned status {resp.status_code}")
        except Exception as e:
            logger.debug(f"Next.js endpoint failed: {e}", exc_info=True)
        
        # Fallback: Try the HTML page
        logger.debug(f"Falling back to HTML page scraping")
        url = f'{self.BOOKMARK_LIST_URL}{code}'
        
        try:
            resp = self.session.get(url, timeout=30)
            
            if resp.status_code == 404:
                logger.warning(f"Bookmark list {code} not found (404)")
                raise LookupError('bookmark_list_not_found')
            
            if resp.status_code == 403:
                logger.warning(f"Bookmark list {code} is private or requires authentication (403)")
                raise LookupError('bookmark_list_private')
            
            resp.raise_for_status()
            
        except requests.RequestException as e:
            logger.error(f"Failed to fetch bookmark list {code}: {e}")
            raise RuntimeError(f"Failed to fetch bookmark list: {e}") from e
        
        # Parse HTML to extract geocache codes
        soup = BeautifulSoup(resp.text, 'html.parser')
        
        # Look for JSON data embedded in script tags
        for script in soup.find_all('script'):
            script_text = script.string or ''
            if 'GC' in script_text and ('geocache' in script_text.lower() or 'referenceCode' in script_text):
                # Try to extract GC codes from JSON
                for match in re.finditer(r'"(?:referenceCode|code|gcCode)"\s*:\s*"(GC[0-9A-Z]+)"', script_text):
                    gc_code = match.group(1).upper()
                    if gc_code not in gc_codes:
                        gc_codes.append(gc_code)
        
        if gc_codes:
            logger.info(f"Found {len(gc_codes)} geocaches from embedded JSON")
            return gc_codes
        
        # Method 1: Look for GC codes in links
        for link in soup.find_all('a', href=True):
            href = link['href']
            # Match patterns like /geocache/GC12345 or /seek/cache_details.aspx?wp=GC12345
            match = re.search(r'/geocache/(GC[0-9A-Z]+)', href)
            if not match:
                match = re.search(r'[?&]wp=(GC[0-9A-Z]+)', href)
            if match:
                gc_code = match.group(1).upper()
                if gc_code not in gc_codes:
                    gc_codes.append(gc_code)
        
        # Method 2: Look for GC codes in data attributes or text
        for elem in soup.find_all(attrs={'data-geocache-code': True}):
            gc_code = elem['data-geocache-code'].upper()
            if gc_code not in gc_codes and re.match(r'^GC[0-9A-Z]+$', gc_code):
                gc_codes.append(gc_code)
        
        # Method 3: Search for GC codes in text content
        text_content = soup.get_text()
        for match in re.finditer(r'\b(GC[0-9A-Z]{3,})\b', text_content):
            gc_code = match.group(1).upper()
            if gc_code not in gc_codes:
                gc_codes.append(gc_code)
        
        logger.info(f"Found {len(gc_codes)} geocaches in bookmark list {code}")
        
        if not gc_codes:
            logger.warning(f"No geocaches found in bookmark list {code}")
            raise LookupError('no_geocaches_in_list')
        
        return gc_codes
    
    def download_list_gpx(self, bookmark_code: str) -> Optional[bytes]:
        """Télécharge une liste de favoris entière au format GPX/ZIP (Premium).

        Le téléchargement GPX contient déjà toutes les données Groundspeak :
        une seule requête remplace le scraping page par page (voir la même
        stratégie pour les Pocket Queries). Retourne les octets bruts (GPX ou
        ZIP), ou ``None`` si le téléchargement n'est pas disponible (liste non
        Premium, endpoint indisponible, structure du site modifiée) — l'appelant
        retombe alors sur l'extraction des codes GC + scraping page par page.

        Ne lève pas : tout échec réseau/format renvoie ``None``.
        """
        code = self.validate_bookmark_code(bookmark_code)

        def _looks_like_gpx(content: bytes) -> bool:
            return bool(content) and (content[:2] == b'PK' or content[:5] == b'<?xml')

        # 1) Endpoints de téléchargement direct connus.
        candidate_urls = [
            f'https://www.geocaching.com/api/proxy/web/v1/lists/{code}/geocaches/gpx',
            f'https://www.geocaching.com/plan/lists/{code}/download',
        ]
        for url in candidate_urls:
            try:
                resp = self.session.get(url, timeout=60, allow_redirects=True)
            except requests.RequestException as e:
                logger.debug(f"List GPX download failed for {url}: {e}")
                continue
            if resp.status_code == 200 and _looks_like_gpx(resp.content):
                logger.info(
                    f"Downloaded list {code} as GPX from {url} ({len(resp.content)} bytes)"
                )
                return resp.content
            logger.debug(f"List GPX candidate {url} -> status {resp.status_code}")

        # 2) Repli : chercher un lien de téléchargement (GPX) dans la page liste.
        try:
            page = self.session.get(f'{self.BOOKMARK_LIST_URL}{code}', timeout=30)
        except requests.RequestException as e:
            logger.debug(f"Failed to load list page to find GPX link: {e}")
            page = None

        if page is not None and page.status_code == 200:
            soup = BeautifulSoup(page.text, 'html.parser')
            for link in soup.find_all('a', href=True):
                href = link['href']
                if 'gpx' not in href.lower() and 'download' not in href.lower():
                    continue
                if href.startswith('http'):
                    dl = href
                elif href.startswith('/'):
                    dl = f'https://www.geocaching.com{href}'
                else:
                    dl = f'https://www.geocaching.com/plan/lists/{href}'
                try:
                    resp = self.session.get(dl, timeout=60, allow_redirects=True)
                except requests.RequestException:
                    continue
                if resp.status_code == 200 and _looks_like_gpx(resp.content):
                    logger.info(
                        f"Downloaded list {code} as GPX via page link {dl} "
                        f"({len(resp.content)} bytes)"
                    )
                    return resp.content

        logger.info(f"No GPX download available for list {code}; falling back to scraping")
        return None

    def get_list_info(self, bookmark_code: str) -> dict:
        """
        Get information about a bookmark list.
        
        Args:
            bookmark_code: The bookmark list code (e.g., BM1234)
            
        Returns:
            Dictionary with list information (name, description, count, etc.)
        """
        code = self.validate_bookmark_code(bookmark_code)
        url = f'{self.BOOKMARK_LIST_URL}{code}'
        
        try:
            resp = self.session.get(url, timeout=30)
            resp.raise_for_status()
        except requests.RequestException as e:
            logger.error(f"Failed to fetch bookmark list info for {code}: {e}")
            return {'code': code, 'name': code, 'count': 0}
        
        soup = BeautifulSoup(resp.text, 'html.parser')
        
        # Try to extract list name
        name = code
        title_elem = soup.find('h1')
        if title_elem:
            name = title_elem.get_text(strip=True)
        
        # Try to extract description
        description = None
        desc_elem = soup.find('div', class_='description')
        if desc_elem:
            description = desc_elem.get_text(strip=True)
        
        return {
            'code': code,
            'name': name,
            'description': description,
            'url': url
        }
    
    def get_user_bookmark_lists(self) -> list[dict]:
        """
        Get all bookmark lists for the authenticated user.
        
        Returns:
            List of dictionaries with list information (code, name, count, etc.)
        """
        logger.info("Fetching user's bookmark lists")
        
        # Try the Next.js data endpoint first (modern approach)
        try:
            # Détecter le build ID courant (avec cache + repli par défaut)
            build_id = self._get_build_id()

            # Try the Next.js data endpoint for the lists page
            nextjs_url = f'https://www.geocaching.com/_next/data/{build_id}/en/plan/lists.json'
            logger.debug(f"Trying Next.js data endpoint: {nextjs_url}")
            resp = self.session.get(nextjs_url, timeout=30)
            
            if resp.status_code == 200:
                try:
                    data = resp.json()
                    lists = []
                    
                    # The Next.js data structure has lists in pageProps.lists.data
                    if isinstance(data, dict):
                        page_props = data.get('pageProps', {})
                        lists_obj = page_props.get('lists', {})
                        
                        # The lists are in the 'data' array
                        if isinstance(lists_obj, dict):
                            lists_data = lists_obj.get('data', [])
                        else:
                            lists_data = lists_obj if isinstance(lists_obj, list) else []
                        
                        if isinstance(lists_data, list):
                            for item in lists_data:
                                if isinstance(item, dict):
                                    code = item.get('referenceCode')
                                    if code and code.startswith('BM'):
                                        lists.append({
                                            'code': code,
                                            'name': item.get('name', code),
                                            'count': item.get('count', 0),
                                            'url': f'{self.BOOKMARK_LIST_URL}{code}'
                                        })
                                        logger.debug(f"Found list from Next.js: {code} - {item.get('name')} ({item.get('count')} caches)")
                    
                    if lists:
                        logger.info(f"Found {len(lists)} bookmark lists from Next.js data")
                        return lists
                except Exception as e:
                    logger.debug(f"Failed to parse Next.js data response: {e}")
        except Exception as e:
            logger.debug(f"Next.js data endpoint failed: {e}")
        
        # Try the API endpoint
        try:
            api_url = 'https://www.geocaching.com/api/proxy/web/v1/users/me/lists'
            logger.debug(f"Trying API endpoint: {api_url}")
            resp = self.session.get(api_url, timeout=30)
            
            if resp.status_code == 200:
                try:
                    data = resp.json()
                    lists = []
                    
                    # Parse the API response
                    if isinstance(data, dict) and 'lists' in data:
                        for item in data['lists']:
                            code = item.get('referenceCode') or item.get('code')
                            if code and code.startswith('BM'):
                                lists.append({
                                    'code': code,
                                    'name': item.get('name', code),
                                    'count': item.get('geocacheCount', 0) or item.get('count', 0),
                                    'url': f'{self.BOOKMARK_LIST_URL}{code}'
                                })
                    elif isinstance(data, list):
                        for item in data:
                            code = item.get('referenceCode') or item.get('code')
                            if code and code.startswith('BM'):
                                lists.append({
                                    'code': code,
                                    'name': item.get('name', code),
                                    'count': item.get('geocacheCount', 0) or item.get('count', 0),
                                    'url': f'{self.BOOKMARK_LIST_URL}{code}'
                                })
                    
                    if lists:
                        logger.info(f"Found {len(lists)} bookmark lists from API")
                        return lists
                except Exception as e:
                    logger.debug(f"Failed to parse API response: {e}")
        except Exception as e:
            logger.debug(f"API endpoint failed: {e}")
        
        # Fallback: Try scraping the HTML page
        try:
            resp = self.session.get(self.USER_LISTS_URL, timeout=30)
            resp.raise_for_status()
        except requests.RequestException as e:
            logger.error(f"Failed to fetch user's bookmark lists: {e}")
            return []
        
        soup = BeautifulSoup(resp.text, 'html.parser')
        lists = []
        
        logger.debug(f"Page title: {soup.title.string if soup.title else 'No title'}")
        
        # Check if there's JSON data embedded in the page
        for script in soup.find_all('script'):
            script_text = script.string or ''
            # Look for JSON data containing lists
            if 'BM' in script_text and ('lists' in script_text.lower() or 'bookmark' in script_text.lower()):
                # Try to extract JSON
                json_match = re.search(r'(\{.*"lists".*\}|\[.*"referenceCode".*\])', script_text, re.DOTALL)
                if json_match:
                    try:
                        import json
                        json_data = json.loads(json_match.group(1))
                        
                        items = json_data.get('lists', []) if isinstance(json_data, dict) else json_data
                        for item in items:
                            if isinstance(item, dict):
                                code = item.get('referenceCode') or item.get('code')
                                if code and code.startswith('BM'):
                                    lists.append({
                                        'code': code,
                                        'name': item.get('name', code),
                                        'count': item.get('geocacheCount', 0) or item.get('count', 0),
                                        'url': f'{self.BOOKMARK_LIST_URL}{code}'
                                    })
                        
                        if lists:
                            logger.info(f"Found {len(lists)} bookmark lists from embedded JSON")
                            return lists
                    except Exception as e:
                        logger.debug(f"Failed to parse embedded JSON: {e}")
        
        # Method 1: Look for ALL links with /plan/lists/ pattern (most reliable)
        for link in soup.find_all('a', href=True):
            href = link['href']
            match = re.search(r'/plan/lists/(BM[0-9A-Z]+)', href)
            if match:
                code = match.group(1)
                
                # Skip if already found
                if any(l['code'] == code for l in lists):
                    continue
                
                # Get name from link text
                name = link.get_text(strip=True)
                if not name or len(name) < 2:
                    name = code
                
                # Try to find count in surrounding context
                count = 0
                
                # Look in parent elements for count
                for parent in [link.parent, link.find_parent('div'), link.find_parent('tr'), link.find_parent('li')]:
                    if parent:
                        parent_text = parent.get_text()
                        # Look for patterns like "123 caches", "123 items", "123"
                        count_match = re.search(r'(\d+)\s*(?:cache|géocache|item|result)', parent_text, re.IGNORECASE)
                        if count_match:
                            count = int(count_match.group(1))
                            break
                        # Also try just a number near the link
                        numbers = re.findall(r'\b(\d+)\b', parent_text)
                        if numbers:
                            # Take the first reasonable number (not too large)
                            for num in numbers:
                                num_int = int(num)
                                if 0 < num_int < 10000:
                                    count = num_int
                                    break
                        if count > 0:
                            break
                
                lists.append({
                    'code': code,
                    'name': name,
                    'count': count,
                    'url': f'{self.BOOKMARK_LIST_URL}{code}'
                })
                
                logger.debug(f"Found list: {code} - {name} ({count} caches)")
        
        # Method 2: Look for data attributes (if modern page structure)
        for elem in soup.find_all(attrs={'data-list-code': True}):
            code = elem.get('data-list-code', '').strip().upper()
            if code and re.match(r'^BM[0-9A-Z]+$', code):
                if any(l['code'] == code for l in lists):
                    continue
                    
                name = elem.get('data-list-name', code)
                count = int(elem.get('data-list-count', 0))
                
                lists.append({
                    'code': code,
                    'name': name,
                    'count': count,
                    'url': f'{self.BOOKMARK_LIST_URL}{code}'
                })
                
                logger.debug(f"Found list from data attr: {code} - {name} ({count} caches)")
        
        logger.info(f"Found {len(lists)} bookmark lists for user")
        return lists
