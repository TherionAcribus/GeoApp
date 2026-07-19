"""
Importer for Geocaching.com Pocket Queries.

This module handles importing geocaches from pocket queries, which are
premium member features that allow downloading GPX files with geocache data.
"""

from __future__ import annotations

import logging
import re
from typing import Optional
import requests

from ..services.geocaching_auth import GEOAPP_USER_AGENT

logger = logging.getLogger(__name__)


class PocketQueryImporter:
    """Import geocaches from Geocaching.com pocket queries."""
    
    POCKET_QUERY_DOWNLOAD_URL = 'https://www.geocaching.com/pocket/downloadpq.aspx'
    POCKET_QUERIES_LIST_URL = 'https://www.geocaching.com/pocket/'
    
    def __init__(self, session: Optional[requests.Session] = None) -> None:
        self.session = session or requests.Session()
        self.session.headers.setdefault('User-Agent', GEOAPP_USER_AGENT)
    
    @staticmethod
    def validate_pocket_query_code(code: str) -> str:
        """Validate and normalize a pocket query code (e.g., PQ1234 or a GUID)."""
        normalized = (code or '').strip().upper()
        
        # Check if it's a PQ code format
        if re.match(r'^PQ[0-9A-Z]+$', normalized):
            return normalized
        
        # Check if it's a GUID format (used in some PQ URLs)
        if re.match(r'^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$', normalized):
            return normalized
        
        raise ValueError('invalid_pocket_query_code')
    
    def _find_download_link_from_main_page(self, guid: str) -> str | None:
        """Find the download link for a PQ from the main pocket queries page."""
        try:
            resp = self.session.get(self.POCKET_QUERIES_LIST_URL, timeout=30)
            resp.raise_for_status()
            
            from bs4 import BeautifulSoup
            soup = BeautifulSoup(resp.text, 'html.parser')
            
            # Look for the row containing this GUID
            for row in soup.find_all('tr'):
                row_html = str(row)
                if guid.lower() in row_html.lower():
                    # Found the row, now look for download link
                    for link in row.find_all('a', href=True):
                        href = link['href']
                        if 'download' in href.lower():
                            if href.startswith('http'):
                                return href
                            elif href.startswith('/'):
                                return f'https://www.geocaching.com{href}'
                            else:
                                return f'https://www.geocaching.com/pocket/{href}'
            
            # Alternative: look for download buttons/links with the GUID
            for elem in soup.find_all(['a', 'button'], href=True):
                href = elem.get('href', '')
                if guid.lower() in href.lower() and 'download' in href.lower():
                    if href.startswith('http'):
                        return href
                    elif href.startswith('/'):
                        return f'https://www.geocaching.com{href}'
                    else:
                        return f'https://www.geocaching.com/pocket/{href}'
            
        except Exception as e:
            logger.debug(f"Failed to find download link from main page: {e}")
        
        return None
    
    # Timeout d'inactivité (secondes) : requests lève si aucun octet n'est reçu
    # pendant cette durée. Ne limite PAS un gros téléchargement tant que les
    # données arrivent — borne seulement les serveurs qui « pendouillent ».
    _DOWNLOAD_TIMEOUT = 30

    @staticmethod
    def _looks_like_gpx_or_zip(content: bytes) -> bool:
        return bool(content) and (content[:2] == b'PK' or content[:5] == b'<?xml')

    def iter_download_pocket_query_gpx(self, pq_code: str):
        """Télécharge une Pocket Query en streamant des messages de progression.

        Générateur : yield des messages de statut (``str``) au fil des tentatives,
        puis, en dernier, le contenu téléchargé (``bytes``). Émettre un message
        avant chaque tentative évite que l'UI reste figée à 0 % pendant les
        éventuels timeouts.

        Élague l'ancienne cascade heuristique (scraping de la page + « Method
        1-5 ») au profit d'une courte liste d'URLs de téléchargement direct, avec
        un unique repli : chercher le lien de téléchargement sur la page des PQ.

        Raises:
            ValueError: code de PQ invalide.
            LookupError: ``pocket_query_requires_premium`` (403 rencontré) ou
                ``pocket_query_not_found`` (aucune tentative concluante).
        """
        code = self.validate_pocket_query_code(pq_code)
        logger.info(f"Downloading pocket query {code}")

        saw_forbidden = False

        # URLs de téléchargement direct, par ordre de probabilité décroissante.
        candidates = [
            f'https://www.geocaching.com/pocket/downloadpq.aspx?g={code}',
            f'https://www.geocaching.com/api/proxy/web/v1/pocketquery/{code}/download',
            f'https://www.geocaching.com/pocket/downloadpq.aspx?guid={code}',
        ]
        for i, url in enumerate(candidates, 1):
            yield f'Téléchargement (tentative {i}/{len(candidates)})…'
            try:
                resp = self.session.get(url, timeout=self._DOWNLOAD_TIMEOUT, allow_redirects=True)
            except requests.RequestException as e:
                logger.debug(f"PQ download attempt failed for {url}: {e}")
                continue
            if resp.status_code == 403:
                saw_forbidden = True
                continue
            if resp.status_code == 200 and self._looks_like_gpx_or_zip(resp.content):
                logger.info(f"Downloaded pocket query {code} from {url} ({len(resp.content)} bytes)")
                yield resp.content
                return

        # Dernier recours : trouver le lien de téléchargement sur la page des PQ.
        yield 'Recherche du lien de téléchargement…'
        link = self._find_download_link_from_main_page(code)
        if link:
            try:
                resp = self.session.get(link, timeout=self._DOWNLOAD_TIMEOUT, allow_redirects=True)
                if resp.status_code == 403:
                    saw_forbidden = True
                elif resp.status_code == 200 and self._looks_like_gpx_or_zip(resp.content):
                    logger.info(f"Downloaded pocket query {code} via page link ({len(resp.content)} bytes)")
                    yield resp.content
                    return
            except requests.RequestException as e:
                logger.debug(f"PQ page-link download failed: {e}")

        logger.error(f"Failed to download pocket query {code} from all attempted methods")
        if saw_forbidden:
            raise LookupError('pocket_query_requires_premium')
        raise LookupError('pocket_query_not_found')

    def download_pocket_query_gpx(self, pq_code: str) -> bytes:
        """Télécharge une Pocket Query et retourne les octets (GPX ou ZIP).

        Enveloppe non-streamée de ``iter_download_pocket_query_gpx`` (mêmes
        exceptions). À privilégier hors contexte de streaming ; l'endpoint
        d'import utilise directement le générateur pour afficher la progression.
        """
        result: bytes | None = None
        for item in self.iter_download_pocket_query_gpx(pq_code):
            if isinstance(item, (bytes, bytearray)):
                result = bytes(item)
        if result is None:
            raise LookupError('pocket_query_not_found')
        return result
    
    def get_pocket_query_info(self, pq_code: str) -> dict:
        """
        Get information about a pocket query.
        
        Args:
            pq_code: The pocket query code
            
        Returns:
            Dictionary with pocket query information
        """
        code = self.validate_pocket_query_code(pq_code)
        
        return {
            'code': code,
            'name': code,
            'type': 'pocket_query'
        }
    
    def get_user_pocket_queries(self) -> list[dict]:
        """
        Get all pocket queries for the authenticated user.
        
        Returns:
            List of dictionaries with pocket query information (guid, name, count, etc.)
        """
        logger.info("Fetching user's pocket queries")
        
        try:
            resp = self.session.get(self.POCKET_QUERIES_LIST_URL, timeout=30)
            resp.raise_for_status()
        except requests.RequestException as e:
            logger.error(f"Failed to fetch user's pocket queries: {e}")
            return []
        
        from bs4 import BeautifulSoup
        soup = BeautifulSoup(resp.text, 'html.parser')
        queries = []
        
        # Method 1: Look for PQ table rows (modern layout)
        for row in soup.find_all('tr', class_=re.compile(r'pq-row|pocket-query-row', re.IGNORECASE)):
            guid = None
            name = None
            count = 0
            
            # Extract GUID from links or data attributes
            for link in row.find_all('a', href=True):
                href = link['href']
                match = re.search(r'[?&]guid=([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})', href, re.IGNORECASE)
                if match:
                    guid = match.group(1).upper()
                    # Try to get name from link text
                    link_text = link.get_text(strip=True)
                    if link_text and 'download' not in link_text.lower():
                        name = link_text
                    break
            
            # Try data attributes
            if not guid:
                guid_attr = row.get('data-guid') or row.get('data-pq-guid')
                if guid_attr:
                    guid = guid_attr.upper()
            
            # Extract name from specific columns
            if not name:
                name_cell = row.find('td', class_=re.compile(r'name|title', re.IGNORECASE))
                if name_cell:
                    name = name_cell.get_text(strip=True)
            
            # Extract count
            count_cell = row.find('td', class_=re.compile(r'count|caches|results', re.IGNORECASE))
            if count_cell:
                count_text = count_cell.get_text(strip=True)
                count_match = re.search(r'(\d+)', count_text)
                if count_match:
                    count = int(count_match.group(1))
            
            if guid:
                if not name:
                    name = f"PQ {guid[:8]}"
                
                if not any(q['guid'] == guid for q in queries):
                    queries.append({
                        'guid': guid,
                        'name': name,
                        'count': count
                    })
        
        # Method 2: Look for any links with GUIDs (fallback)
        if not queries:
            for link in soup.find_all('a', href=True):
                href = link['href']
                match = re.search(r'[?&]guid=([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})', href, re.IGNORECASE)
                if match:
                    guid = match.group(1).upper()
                    
                    # Try to find the PQ name
                    name = link.get_text(strip=True)
                    if not name or 'download' in name.lower():
                        # Look for name in parent row
                        parent_row = link.find_parent('tr')
                        if parent_row:
                            # Look for the name in the row
                            for cell in parent_row.find_all('td'):
                                cell_text = cell.get_text(strip=True)
                                if cell_text and 'download' not in cell_text.lower() and len(cell_text) > 3:
                                    name = cell_text
                                    break
                    
                    if not name:
                        name = f"PQ {guid[:8]}"
                    
                    # Try to find the count in the same row
                    count = 0
                    parent_row = link.find_parent('tr')
                    if parent_row:
                        row_text = parent_row.get_text()
                        count_match = re.search(r'(\d+)\s*(?:cache|géocache)', row_text, re.IGNORECASE)
                        if count_match:
                            count = int(count_match.group(1))
                    
                    # Avoid duplicates
                    if not any(q['guid'] == guid for q in queries):
                        queries.append({
                            'guid': guid,
                            'name': name,
                            'count': count
                        })
        
        # Method 2: Look for data attributes
        for elem in soup.find_all(attrs={'data-pq-guid': True}):
            guid = elem.get('data-pq-guid', '').strip().upper()
            if guid and re.match(r'^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$', guid):
                name = elem.get('data-pq-name', f"PQ {guid[:8]}")
                count = int(elem.get('data-pq-count', 0))
                
                if not any(q['guid'] == guid for q in queries):
                    queries.append({
                        'guid': guid,
                        'name': name,
                        'count': count
                    })
        
        logger.info(f"Found {len(queries)} pocket queries for user")
        return queries
