"""
Assainissement des fragments HTML récupérés sur Geocaching.com.

Les fiches et les logs de trackables contiennent du HTML saisi par des
utilisateurs tiers : ce n'est pas du contenu de confiance. Le contrat est
« HTML assaini » — pas de texte aplati, pour garder paragraphes, listes et
liens — avec une liste blanche restrictive :

- balises de mise en forme courantes uniquement ;
- attributs réduits au strict nécessaire (`href`/`title` sur les liens,
  `src`/`alt`/`title`/dimensions sur les images) — jamais `style` ni `on*` ;
- URLs limitées à `http`/`https` ; les relatives sont résolues vers
  `https://www.geocaching.com`, tout autre schéma (`javascript:`, `data:`…)
  fait perdre l'attribut ;
- les conteneurs actifs (`script`, `iframe`, `object`, `form`, `svg`…)
  disparaissent avec leur contenu ; les balises inconnues sont déballées
  (leur texte survit) ;
- commentaires, doctypes et instructions de traitement supprimés.

Le résultat est propre à un affichage direct (lot 5 des trackables), sans
`dangerouslySetInnerHTML` sur la valeur brute côté frontend.
"""

from urllib.parse import urljoin, urlsplit

from bs4 import BeautifulSoup, Comment, Declaration, ProcessingInstruction

BASE_URL = 'https://www.geocaching.com'

# Balises conservées telles quelles. Rien qui porte du script, un formulaire,
# un cadre embarqué ou du contenu étranger (svg/math) — l'historique des
# contournements d'assainisseurs passe souvent par là.
ALLOWED_TAGS = frozenset({
    'p', 'br', 'hr',
    'ul', 'ol', 'li',
    'a', 'strong', 'b', 'em', 'i', 'u', 's', 'strike',
    'blockquote', 'code', 'pre',
    'h1', 'h2', 'h3', 'h4',
    'img', 'figure', 'figcaption',
    'table', 'thead', 'tbody', 'tr', 'th', 'td',
})

# Balises dont le contenu est supprimé avec la balise. Tout le reste non
# listé ci-dessus est déballé : le texte qu'elles portaient reste lisible.
DROP_WITH_CONTENT = frozenset({
    'script', 'style', 'iframe', 'object', 'embed', 'applet',
    'form', 'input', 'button', 'textarea', 'select', 'option',
    'svg', 'math', 'link', 'meta', 'base', 'title', 'template',
})

ALLOWED_ATTRS = {
    'a': frozenset({'href', 'title'}),
    'img': frozenset({'src', 'alt', 'title', 'width', 'height'}),
    'td': frozenset({'colspan', 'rowspan'}),
    'th': frozenset({'colspan', 'rowspan'}),
}

URL_ATTRS = {'a': 'href', 'img': 'src'}

SAFE_SCHEMES = frozenset({'http', 'https'})


def clean_remote_url(raw: str | None) -> str | None:
    """
    URL distante exploitable ou ``None``. Espaces et caractères de contrôle
    retirés avant l'analyse (les navigateurs les ignorent dans ``javascript:``) ;
    les relatives sont résolues sur Geocaching.com.
    """
    if raw is None:
        return None
    raw = str(raw)
    compact = ''.join(raw.split())
    if not compact:
        return None
    resolved = urljoin(BASE_URL, compact)
    try:
        scheme = urlsplit(resolved).scheme.lower()
    except ValueError:
        return None
    return resolved if scheme in SAFE_SCHEMES else None


def _clean_dimension(raw: str) -> str | None:
    """`width`/`height` : chiffres (px) ou pourcentage simple, sinon rejet."""
    text = raw.strip()
    if text.isdigit() or (text.endswith('%') and text[:-1].isdigit()):
        return text
    return None


def sanitize_html_fragment(value: str | None) -> str | None:
    """
    Fragment HTML tiers → HTML sûr à rendre, ou ``None`` s'il n'en reste rien.
    """
    if not value or not value.strip():
        return None

    soup = BeautifulSoup(value, 'html.parser')

    for node in soup.find_all(string=lambda s: isinstance(s, (Comment, Declaration, ProcessingInstruction))):
        node.extract()

    for tag in list(soup.find_all(True)):
        # Un ancêtre peut avoir été supprimé avec son contenu : ce tag est alors
        # déjà hors de l'arbre (decomposed), ne pas y toucher.
        if tag.decomposed:
            continue
        name = (tag.name or '').lower()
        if name in DROP_WITH_CONTENT:
            tag.decompose()
            continue
        if name not in ALLOWED_TAGS:
            tag.unwrap()
            continue

        allowed = ALLOWED_ATTRS.get(name, frozenset())
        for attr in list(tag.attrs):
            if attr not in allowed:
                del tag[attr]
                continue
            raw = tag[attr]
            raw = raw[0] if isinstance(raw, list) else str(raw)
            url_attr = URL_ATTRS.get(name)
            if attr == url_attr:
                cleaned = clean_remote_url(raw)
                if cleaned is None:
                    del tag[attr]
                else:
                    tag[attr] = cleaned
            elif attr in ('width', 'height', 'colspan', 'rowspan'):
                cleaned = _clean_dimension(raw)
                if cleaned is None:
                    del tag[attr]
                else:
                    tag[attr] = cleaned
            else:
                tag[attr] = raw

        if tag.name == 'a':
            # Les liens sortent de l'application : pas d'accès à l'onglet ouvrant.
            tag['rel'] = 'nofollow noopener noreferrer'

    result = soup.decode().strip()
    return result or None
