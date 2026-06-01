"""
Service de recherche web pour le Formula Solver
Permet de rechercher des réponses sur Internet via DuckDuckGo (duckduckgo-search)
Fallback sur requests + DuckDuckGo Instant Answer API + HTML scraping si duckduckgo-search absent.
"""

import re
import requests as http_requests
from typing import List, Dict, Optional
from loguru import logger

try:
    from duckduckgo_search import DDGS
    HAS_DDG_SEARCH = True
except ImportError:
    HAS_DDG_SEARCH = False
    logger.warning("duckduckgo-search non installé, fallback sur API Instant Answer + HTML lite")

# ── Nettoyage des questions de géocaching pour la recherche web ──

# Segments complets à retirer (instructions de calcul, etc.)
_STRIP_SEGMENTS = [
    # Instructions de calcul
    r',?\s*cherche\s+(son|sa|ses|le|la|les|un|une)\s+(?:checksum\s*r[eé]duit|checksum|nombre\s+de\s+lettres?|longueur)\b[^,.]*',
    r',?\s*trouve\s+(son|sa|ses|le|la|les|un|une)\s+(?:checksum\s*r[eé]duit|checksum|nombre\s+de\s+lettres?|longueur)\b[^,.]*',
    r',?\s*en\s+checksum\s*r[eé]duit\b',
    r',?\s*en\s+checksum\b',
    r',?\s*cherche\s+(son|sa|ses|le|la|les|un|une)\b[^,.]*',
    r',?\s*trouve\s+(son|sa|ses|le|la|les|un|une)\b[^,.]*',
    # Parenthèses avec instructions (ex: "(pas le prénom!)")
    r'\([^)]*(?:pas\s+le|pas\s+la|pas\s+les|pas\s+son|pas\s+sa)[^)]*\)',
    # "combien de lettres dans..."  → garder ce qui suit "dans"
    r'\bcombien\s+de\s+lettres?\s+(?:dans|du|de la|de l\'|des)\s+',
    r'\bcombien\s+de\s+lettres?\b',
    # "nombre de lettres" isolé
    r'\bnombre\s+de\s+lettres?\b',
    r'\bchecksum\s*r[eé]duit\b',
    r'\bchecksum\b',
    # Instructions de format de réponse ("le jour", "le mois", "l'année", "en jours", etc.)
    # Ces segments indiquent quel MORCEAU de la réponse on veut, pas le sujet de la recherche.
    r',?\s+le\s+jour\b',
    r',?\s+le\s+mois\b',
    r',?\s+l\'?ann[eé]e\b',
    r',?\s+en\s+jours?\b',
    r',?\s+en\s+mois\b',
    r',?\s+en\s+ann[eé]es?\b',
    r',?\s+en\s+mètres?\b',
    r',?\s+en\s+km\b',
    r',?\s+en\s+kilom[eè]tres?\b',
    # Instructions indiquant QUEL MORCEAU de la réponse retourner (prénom, nom, etc.)
    # Ces instructions viennent typiquement après le sujet de la question.
    # "son prénom", "son nom" : seulement quand c'est une instruction de format
    # (après virgule ou ?) pour ne pas supprimer le contexte ("a donné son nom à...")
    r',\s*son\s+pr[eé]nom\s+et\s+(?:son\s+)?nom\b[^,.?!]*',
    r'(?<=\?)\s+son\s+pr[eé]nom\s+et\s+(?:son\s+)?nom\b[^,.?!]*',
    r',\s*son\s+(?:pr[eé]nom|nom(?:\s+de\s+famille)?)\b[^,.?!]*',
    r'(?<=\?)\s+son\s+(?:pr[eé]nom|nom(?:\s+de\s+famille)?)\b[^,.?!]*',
    r',?\s*ses\s+initiales?\b[^,.?!]*',
    r',?\s*son\s+initiale\b[^,.?!]*',
    r',?\s*sa\s+date\s+de\s+naissance\b[^,.?!]*',
    r',?\s*sa\s+date\s+de\s+mort\b[^,.?!]*',
    # "de ce nom", "de ce groupe", etc.
    r'\bde\s+c(?:e|et)\s+(?:nom|pr[eé]nom|mot|chiffre|code|r[eé]sultat|groupe|auteur|inventeur|personnage)\b[^,.?!]*',
    r'\bde\s+son\s+(?:nom|pr[eé]nom|surnom|sigle|code)\b[^,.?!]*',
    # "valeur de la 3ème lettre", "valeur du 1er chiffre", etc.
    r',?\s*valeur\s+d[eu]\s+(?:la\s+|l\'|son\s+)?(?:\d+[eè]me?|premi[eè]re?|derni[eè]re?|\d+e?r?)\s+(?:lettre?|chiffre?|caract[eè]re?)\b[^,.?!]*',
    r',?\s*valeur\s+de\s+(?:la\s+)?lettre?\b[^,.?!]*',
]

# Mots interrogatifs de début à retirer
_LEADING_QUESTION_RE = re.compile(
    r'^(?:'
    # "Quel est", "Quelle était", "Quels sont"...
    r'quel(?:le)?(?:s)?\s+(?:est|[eé]tait|sont|[eé]taient)'
    # "Quelle matière fabriquait-on", "Quel animal appelait-on"... (inversion verbale)
    r'|quel(?:le)?(?:s)?\s+\w+\s+\S+-(?:t-)?on'
    # "Qui a dit", "Qui est", "Qui a écrit"...
    r'|qui\s+(?:a\s+dit|est|[eé]tait|a\s+[eé]t[eé]|a|sont|ont|fut|[eé]crit)'
    # "Où est", "Où se trouve"...
    r'|o[u\u00f9]\s+(?:est|se\s+trouve|[eé]tait|se\s+trouvait|a\s+[eé]t[eé])'
    # "Quand est", "Quand a eu lieu"...
    r'|quand\s+(?:est|a|[eé]tait|ont|fut|a\s+eu\s+lieu)'
    # "Comment s'appelle"...
    r'|comment\s+s\'appelle'
    r')\s+',
    re.IGNORECASE
)

# Prépositions/articles en tête après nettoyage de la question
# Supprimer pour isoler le sujet recherché (ex: "avec du phénol" → "phénol")
_LEADING_PREP_RE = re.compile(
    r'^(?:'
    r'avec\s+(?:du\s+|de\s+la\s+|des\s+|de\s+l\'|le\s+|la\s+|l\')'
    r'|dans\s+(?:le\s+|la\s+|les\s+|l\')'
    r'|sur\s+(?:le\s+|la\s+|les\s+|l\')'
    r'|par\s+(?:le\s+|la\s+|les\s+|l\')'
    r'|(?:le|la|les|l\')\s+'
    r')',
    re.IGNORECASE
)

# "Date de X" en début de question → reformuler en "X date" pour que le sujet domine la recherche
_DATE_DE_RE = re.compile(
    r'^date\s+(?:de\s+|d\'|du\s+|de la\s+|des\s+)',
    re.IGNORECASE
)

# Ponctuation et parenthèses parasites
_CLEANUP_RE = re.compile(r'[()!?;]+')
_MULTI_SPACE_RE = re.compile(r'\s+')


class WebSearchService:
    """
    Service pour rechercher des informations sur Internet.
    Utilise la librairie duckduckgo-search pour de vrais résultats de recherche.
    """
    
    def __init__(self):
        self.timeout = 15
        self.max_results = 5
    
    def _clean_query_for_search(self, raw_question: str) -> str:
        """
        Nettoie une question de géocaching pour en faire une requête de recherche web efficace.
        Retire les instructions de calcul (checksum, nombre de lettres, etc.) et la ponctuation parasite,
        mais conserve le sujet et le contexte de la question.
        
        Exemples:
            "Quel était l'animal le plus connu lors des jeux de Moscou, cherche son nombre de lettres.(pas le prénom!)"
            → "animal le plus connu lors des jeux de Moscou"
            
            "Quelle est la capitale de la 15ème RSS en checksum ?"
            → "capitale de la 15ème RSS"
            
            "Combien de lettres dans le prénom d'une jeune fille qui s'envoya très jeune en l'air ??"
            → "prénom d'une jeune fille qui s'envoya très jeune en l'air"
        """
        q = raw_question
        
        # 1. Retirer les instructions de calcul/format qui parasitent la recherche.
        for pattern in _STRIP_SEGMENTS:
            q = re.sub(pattern, ' ', q, flags=re.IGNORECASE)
        
        # 2. Retirer les mots interrogatifs de début.
        #    NÉCESSAIRE : Bing (backend DDGS 8.x) interprète "Qui"/"Quel" comme des requêtes
        #    de définition grammaticale et "Date de" comme une requête calendrier.
        q = _LEADING_QUESTION_RE.sub('', q)
        
        # 3. "Date de X" → "X date" pour que le sujet domine sur Bing
        m = _DATE_DE_RE.match(q)
        if m:
            q = q[m.end():].strip() + ' date'
        
        # 4. Retirer les prépositions/articles en tête qui n'apportent rien
        m = _LEADING_PREP_RE.match(q)
        if m:
            q = q[m.end():].strip()
        
        # 5. Retirer les parenthèses vides et la ponctuation parasite
        q = _CLEANUP_RE.sub(' ', q)
        
        # 6. Retirer les points/virgules isolés en fin de texte
        q = q.strip(' .,;:-–—')
        
        # 7. Normaliser les espaces
        q = _MULTI_SPACE_RE.sub(' ', q).strip()
        
        # Si après nettoyage il ne reste presque rien, garder la question nettoyée minimalement
        if len(q) < 5:
            q = _CLEANUP_RE.sub(' ', raw_question)
            q = _MULTI_SPACE_RE.sub(' ', q).strip(' .,;:-–—')
        
        logger.debug(f"Query cleanup: '{raw_question}' -> '{q}'")
        return q

    def search(
        self, 
        query: str, 
        context: Optional[str] = None,
        max_results: Optional[int] = None
    ) -> List[Dict[str, any]]:
        """
        Recherche une réponse sur Internet.
        
        Args:
            query: La question à rechercher
            context: Contexte additionnel pour affiner la recherche
            max_results: Nombre maximum de résultats (défaut: 5)
            
        Returns:
            Liste de résultats avec leur contenu et score de pertinence:
            [
                {
                    "text": "Réponse trouvée",
                    "source": "URL ou source",
                    "score": 0.85,
                    "type": "instant_answer" | "snippet"
                }
            ]
        """
        if max_results is None:
            max_results = self.max_results
        
        # Nettoyer la question pour construire une requête de recherche web efficace
        clean_query = self._clean_query_for_search(query)
        
        # Ne pas ajouter le contexte s'il est trop long ou pollue la recherche
        if context and len(context.strip()) < 80:
            search_query = f"{clean_query} {context.strip()}"
        else:
            search_query = clean_query
        
        logger.info(f"Web search: original='{query}' -> cleaned='{search_query}'")
        
        results = []
        
        if HAS_DDG_SEARCH:
            try:
                results = self._search_ddgs(search_query, max_results)
            except Exception as e:
                logger.warning(f"Erreur recherche duckduckgo-search: {e}")
        
        # Fallback sur API Instant Answer + HTML lite si pas de résultats
        if not results:
            try:
                results = self._search_duckduckgo_fallback(search_query, max_results)
            except Exception as e:
                logger.warning(f"Erreur recherche DuckDuckGo fallback: {e}")
        
        # Si pas de résultats, retourner un message informatif
        if not results:
            logger.warning(f"Aucun résultat trouvé pour: {search_query}")
            results.append({
                "text": "Aucun résultat trouvé sur Internet",
                "source": "web_search",
                "score": 0.0,
                "type": "no_result"
            })
        
        logger.info(f"Web search completed: {len(results)} résultats")
        
        return results
    
    def _search_ddgs(self, query: str, max_results: int = 5) -> List[Dict[str, any]]:
        """
        Recherche via duckduckgo-search (vrais résultats web).
        
        Args:
            query: Requête de recherche
            max_results: Nombre maximum de résultats
            
        Returns:
            Liste de résultats
        """
        results = []
        
        with DDGS() as ddgs:
            # Recherche textuelle classique (answers() supprimé dans DDGS v8)
            try:
                text_results = list(ddgs.text(query, max_results=max_results, region='fr-fr'))
                for i, r in enumerate(text_results):
                    body = r.get('body', '')
                    title = r.get('title', '')
                    href = r.get('href', '')
                    snippet = f"{title}. {body}" if title and body else (body or title)
                    if snippet:
                        # Score décroissant basé sur la position
                        score = max(0.3, 0.85 - (i * 0.1))
                        results.append({
                            "text": snippet,
                            "source": href,
                            "score": score,
                            "type": "snippet"
                        })
            except Exception as e:
                logger.warning(f"Erreur recherche texte DDG: {e}")
        
        return results
    
    def _search_duckduckgo_fallback(self, query: str, max_results: int = 5) -> List[Dict[str, any]]:
        """
        Fallback : DuckDuckGo Instant Answer API + DuckDuckGo HTML lite.
        Fonctionne sans dépendance externe (juste requests + bs4).
        """
        results = []
        
        # 1. API Instant Answer (JSON)
        try:
            resp = http_requests.get(
                "https://api.duckduckgo.com/",
                params={'q': query, 'format': 'json', 'no_html': 1, 'skip_disambig': 1},
                timeout=10,
                headers={'User-Agent': 'GeoApp/1.0'}
            )
            if resp.status_code == 200:
                data = resp.json()
                if data.get('Abstract'):
                    results.append({
                        "text": data['Abstract'],
                        "source": data.get('AbstractURL', 'DuckDuckGo'),
                        "score": 0.9,
                        "type": "instant_answer"
                    })
                if data.get('Answer'):
                    results.append({
                        "text": data['Answer'],
                        "source": 'DuckDuckGo Answer',
                        "score": 0.95,
                        "type": "instant_answer"
                    })
                for i, topic in enumerate(data.get('RelatedTopics', [])[:3]):
                    if isinstance(topic, dict) and topic.get('Text'):
                        results.append({
                            "text": topic['Text'],
                            "source": topic.get('FirstURL', 'DuckDuckGo'),
                            "score": 0.7 - (i * 0.05),
                            "type": "snippet"
                        })
        except Exception as e:
            logger.debug(f"DDG Instant Answer fallback error: {e}")
        
        # 2. DuckDuckGo HTML lite (scraping léger)
        if len(results) < max_results:
            try:
                from bs4 import BeautifulSoup
                resp = http_requests.get(
                    "https://html.duckduckgo.com/html/",
                    params={'q': query},
                    timeout=10,
                    headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'}
                )
                if resp.status_code == 200:
                    soup = BeautifulSoup(resp.text, 'html.parser')
                    for i, result_div in enumerate(soup.select('.result__body')[:max_results]):
                        title_el = result_div.select_one('.result__a')
                        snippet_el = result_div.select_one('.result__snippet')
                        url_el = result_div.select_one('.result__url')
                        
                        title = title_el.get_text(strip=True) if title_el else ''
                        snippet = snippet_el.get_text(strip=True) if snippet_el else ''
                        url = url_el.get_text(strip=True) if url_el else ''
                        
                        text = f"{title}. {snippet}" if title and snippet else (snippet or title)
                        if text:
                            score = max(0.3, 0.85 - (i * 0.1))
                            results.append({
                                "text": text,
                                "source": url or 'DuckDuckGo',
                                "score": score,
                                "type": "snippet"
                            })
            except Exception as e:
                logger.debug(f"DDG HTML lite fallback error: {e}")
        
        return results[:max_results]

    def extract_answer(self, results: List[Dict[str, any]]) -> Optional[str]:
        """
        Extrait la meilleure réponse depuis les résultats de recherche (sans IA).
        Tente d'extraire un nombre, un mot-clé, ou retourne le snippet le plus pertinent.
        
        Args:
            results: Liste de résultats de recherche
            
        Returns:
            La meilleure réponse trouvée, ou None
        """
        if not results:
            return None
        
        # Trier par score décroissant
        sorted_results = sorted(results, key=lambda x: x.get('score', 0), reverse=True)
        
        # Retourner le texte du meilleur résultat
        best_result = sorted_results[0]
        
        if best_result.get('type') == 'no_result':
            return None
        
        text = best_result.get('text', '')
        
        # Si c'est une réponse instantanée, la retourner directement
        if best_result.get('type') == 'instant_answer':
            return text
        
        # Pour les snippets, essayer d'extraire une valeur numérique pertinente
        # (année, nombre, etc.)
        numbers = re.findall(r'\b\d{1,6}\b', text)
        if numbers:
            # Retourner le premier nombre trouvé dans le snippet le plus pertinent
            return numbers[0]
        
        # Sinon retourner le snippet entier (le frontend pourra l'afficher)
        return text


# Instance singleton
web_search_service = WebSearchService()

