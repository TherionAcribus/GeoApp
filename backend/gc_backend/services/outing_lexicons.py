"""
Lexiques de l'analyse de sortie (« Analyser avec l'IA »).

Ces listes servent à repérer, dans le texte libre des logs et des listings, ce qu'aucun
attribut Geocaching.com ne dit : *quel* outil il faut, et si la recherche sur place risque
d'être longue.

L'attribut « Outil spécial requis » ne précise jamais s'il s'agit d'une canne à pêche,
d'un aimant ou de quoi crocheter une serrure. Cette information se trouve presque
toujours dans les logs — et souvent dans un vieux log, hors de portée d'une troncature
aux N plus récents. D'où un filtrage par vocabulaire, indépendant de la date.

Les listings et les logs sont fréquemment en anglais : chaque entrée couvre les deux
langues. La comparaison se fait sur du texte normalisé (minuscules, sans accents), pour
que « canne a peche » matche « canne à pêche ».

Ce module est volontairement sans dépendance : il est importable et testable seul.
"""

from __future__ import annotations

import re
import unicodedata
from collections.abc import Sequence

# ─────────────────────────────────────────────────────────────────────────────
# Vocabulaire matériel
# ─────────────────────────────────────────────────────────────────────────────

# Certains mots ont été écartés volontairement parce qu'ils déclenchent trop de faux
# positifs dans de vrais logs (constaté sur la base réelle) :
#   « perche » se confond avec « perché » une fois les accents retirés ;
#   « pile » avec « à midi pile » ;
#   « combinaison » avec la combinaison d'un cadenas ou d'une énigme ;
#   « casque », « masque » et « rappel » avec leurs sens courants.
# Ils sont remplacés par des formes non ambiguës. Mieux vaut manquer une mention que
# noyer l'IA sous des extraits hors sujet.
GEAR_LEXICON: dict[str, tuple[str, ...]] = {
    'fishing_rod': (
        'canne à pêche', 'canne telescopique', 'perche télescopique',
        'fishing rod', 'fishing pole', 'telescopic pole',
    ),
    'magnet': ('aimant', 'magnet', 'néodyme'),
    'hook': ('crochet', 'hook', 'grappin', 'grappling'),
    'pliers': ('pince', 'pliers', 'tweezers', 'pince à épiler'),
    'screwdriver': ('tournevis', 'screwdriver', 'clé allen', 'allen key', 'hex key'),
    'ladder': ('échelle', 'ladder', 'escabeau', 'step stool'),
    'rope': ('corde', 'rope', 'cordelette', 'sangle', 'webbing'),
    'harness': (
        'baudrier', 'harness', 'mousqueton', 'carabiner', 'descendeur',
        'descente en rappel', 'abseil',
    ),
    'caving': ('spéléo', 'caving', 'casque de spéléo'),
    'tree_gear': ('arboricole', 'arbo', 'tree climbing', "grimpe d'arbre", 'éperons'),
    'flashlight': ('lampe', 'torche', 'flashlight', 'frontale', 'headlamp'),
    'uv_light': ('uv', 'ultraviolet', 'blacklight', 'black light', 'lampe uv'),
    'battery': ('piles', 'pile de rechange', 'pile neuve', 'battery', 'powerbank', 'power bank'),
    'water': ("bouteille d'eau", "verser de l'eau", 'pour water', 'add water', "remplir d'eau"),
    'straw_tube': ('paille', 'straw', 'tube', 'seringue', 'syringe', 'pipette'),
    'gloves': ('gant', 'glove'),
    'cutter': ('cutter', 'couteau', 'knife'),
    'waders': ('cuissarde', 'waders', 'bottes', 'wellies'),
    'wetsuit': (
        'combinaison de plongée', 'combinaison néoprène', 'wetsuit',
        'palme', 'tuba', 'snorkel',
    ),
    'boat': ('bateau', 'boat', 'kayak', 'canoë', 'canoe', 'paddle', 'barque', 'packraft'),
    'snow_gear': ('raquette', 'snowshoe', 'crampon', 'piolet', 'ice axe'),
    'lockpick': ('crochetage', 'lockpick', 'lock pick', 'crochète', 'trombone', 'paperclip'),
    'mirror': ('miroir', 'mirror', 'endoscope', 'inspection camera'),
    'magnifier': ('loupe', 'magnifier', 'magnifying'),
}

# Libellés lisibles, réutilisés par le prompt et par le rapport.
GEAR_LABELS: dict[str, str] = {
    'fishing_rod': 'canne à pêche / perche télescopique',
    'magnet': 'aimant',
    'hook': 'crochet / grappin',
    'pliers': 'pince',
    'screwdriver': 'tournevis / clé',
    'ladder': 'échelle',
    'rope': 'corde',
    'harness': 'baudrier / matériel de rappel',
    'caving': 'matériel de spéléo',
    'tree_gear': 'matériel de grimpe arboricole',
    'flashlight': 'lampe / frontale',
    'uv_light': 'lampe UV',
    'battery': 'piles / batterie externe',
    'water': "eau (à verser dans la cache)",
    'straw_tube': 'paille / tube / seringue',
    'gloves': 'gants',
    'cutter': 'couteau / cutter',
    'waders': 'cuissardes / bottes',
    'wetsuit': 'combinaison / palmes / tuba',
    'boat': 'embarcation',
    'snow_gear': 'raquettes / crampons',
    'lockpick': 'matériel de crochetage',
    'mirror': 'miroir / endoscope',
    'magnifier': 'loupe',
}

# ─────────────────────────────────────────────────────────────────────────────
# Vocabulaire « recherche longue sur place »
# ─────────────────────────────────────────────────────────────────────────────

SEARCH_EFFORT_LEXICON: tuple[str, ...] = (
    'bien cachée',
    'très bien cachée',
    'sournoise',
    'vicieuse',
    'camouflage',
    'camouflée',
    "j'ai cherché",
    'cherché longtemps',
    'plusieurs passages',
    'deuxième visite',
    'troisième tentative',
    'well hidden',
    'very well hidden',
    'sneaky',
    'evil hide',
    'took me ages',
    'took a while',
    'second visit',
    'came back',
    'searched for',
    'needle in a haystack',
)


# ─────────────────────────────────────────────────────────────────────────────
# Normalisation et compilation
# ─────────────────────────────────────────────────────────────────────────────

def normalize(text: str | None) -> str:
    """Minuscules sans accents : « Canne à Pêche » et « canne a peche » deviennent égaux."""
    if not text:
        return ''
    decomposed = unicodedata.normalize('NFD', str(text))
    without_accents = ''.join(ch for ch in decomposed if not unicodedata.combining(ch))
    return without_accents.lower()


def _compile_term(term: str) -> re.Pattern[str]:
    """
    Motif encadré par des frontières de mot, avec pluriel optionnel.

    Les frontières évitent les faux positifs des termes courts : « uv » ne doit pas
    matcher « uvea », ni « tube » matcher « tuber ». Le suffixe optionnel rattrape les
    pluriels des deux langues sans dupliquer chaque entrée du lexique.
    """
    return re.compile(r'(?<!\w)' + re.escape(normalize(term)) + r'(?:s|es|x)?(?!\w)')


def _compile_terms(terms: tuple[str, ...]) -> re.Pattern[str]:
    """
    Les mêmes frontières, mais un seul motif pour tout un groupe de termes.

    Balayer un log terme par terme, c'était une centaine de parcours de la même chaîne
    pour les vingt-trois clés matériel ; en alternance, c'en est un seul par clé. Le
    résultat est identique, et pas seulement en pratique :

    - « ce groupe matche » vaut « au moins un de ses termes matche », par définition de
      l'alternance ;
    - la position renvoyée est celle du match le plus à gauche, donc du terme le plus à
      gauche — exactement ce que cherchait le minimum sur les positions terme à terme.

    Deux termes d'un même groupe qui se recouvrent (« pince » et « pince à épiler »)
    peuvent se voler la vedette, mais ils partagent la clé *et* le point de départ : rien
    de ce qu'on lit ensuite n'en dépend. Regrouper les clés **entre elles**, en revanche,
    changerait le résultat — « lampe uv » masquerait « lampe » — et c'est pourquoi il
    reste un motif par clé.
    """
    alternatives = '|'.join(re.escape(normalize(term)) for term in terms)
    return re.compile(r'(?<!\w)(?:' + alternatives + r')(?:s|es|x)?(?!\w)')


_GEAR_PATTERNS: dict[str, re.Pattern[str]] = {
    key: _compile_terms(terms) for key, terms in GEAR_LEXICON.items()
}

#: Un motif par terme : `find_search_effort_mentions` doit dire *lesquels* ont matché.
_SEARCH_EFFORT_PATTERNS: tuple[re.Pattern[str], ...] = tuple(
    _compile_term(term) for term in SEARCH_EFFORT_LEXICON
)

#: Et un motif unique pour la seule question qui intéresse les appelants chauds : y
#: a-t-il, oui ou non, une trace d'effort de recherche.
_SEARCH_EFFORT_COMBINED: re.Pattern[str] = _compile_terms(SEARCH_EFFORT_LEXICON)


def find_gear_mentions(text: str | None) -> list[str]:
    """
    Clés de `GEAR_LEXICON` mentionnées dans le texte, dans l'ordre du lexique.

    L'ordre est stable et indépendant du texte : il rend les tests déterministes et
    l'affichage prévisible d'un log à l'autre.
    """
    if not text:
        return []
    return find_gear_mentions_normalized(normalize(text))


def find_search_effort_mentions(text: str | None) -> list[str]:
    """
    Expressions de `SEARCH_EFFORT_LEXICON` trouvées dans le texte.

    Terme par terme, parce qu'il faut dire *lesquelles* : c'est la seule question du
    module à ne pas se contenter du motif groupé. Les appelants qui veulent juste savoir
    s'il y en a une passent par `has_search_effort_hint`, bien moins cher.
    """
    if not text:
        return []
    haystack = normalize(text)
    return [
        term
        for term, pattern in zip(SEARCH_EFFORT_LEXICON, _SEARCH_EFFORT_PATTERNS)
        if pattern.search(haystack)
    ]


def has_search_effort_hint(text: str | None) -> bool:
    """Vrai si le texte suggère une recherche longue sur place."""
    if not text:
        return False
    return has_search_effort_hint_normalized(normalize(text))


# ─────────────────────────────────────────────────────────────────────────────
# Variantes sur texte déjà normalisé
# ─────────────────────────────────────────────────────────────────────────────
#
# La normalisation est, de loin, la partie chère du balayage : elle décompose la chaîne
# en NFD, la parcourt caractère par caractère et la recompose. Les motifs, eux, sont
# compilés une fois pour toutes au chargement du module.
#
# Or le même texte de log est balayé deux à trois fois — matériel, effort de recherche,
# positionnement de l'extrait. Sur une sortie de soixante caches et leurs centaines de
# logs, cela fait des milliers de normalisations pour quelques centaines de textes. Les
# fonctions ci-dessous prennent donc le texte **déjà normalisé**, à charge pour
# l'appelant de le préparer une fois.

def find_gear_mentions_normalized(haystack: str) -> list[str]:
    """`find_gear_mentions` sur un texte déjà passé par `normalize()`."""
    if not haystack:
        return []
    return [key for key, pattern in _GEAR_PATTERNS.items() if pattern.search(haystack)]


def has_search_effort_hint_normalized(haystack: str) -> bool:
    """`has_search_effort_hint` sur un texte déjà passé par `normalize()`."""
    return bool(haystack) and _SEARCH_EFFORT_COMBINED.search(haystack) is not None


def first_gear_position(haystack: str, keys: Sequence[str]) -> int:
    """
    Position, dans le texte normalisé, de la première mention d'une des `keys`.

    Sert à centrer un extrait sur la mention qui a fait retenir le log. Le balayage
    utilise les **mêmes motifs que la détection**, frontières de mot comprises : chercher
    la sous-chaîne brute pouvait pointer un « uv » au milieu d'un mot que la détection,
    elle, n'avait pas retenu — l'extrait s'ouvrait alors ailleurs que sur la mention
    annoncée.

    Les clés sont examinées dans l'ordre reçu et la première qui matche gagne ; à
    l'intérieur d'une clé, c'est le terme le plus à gauche, que l'alternance donne
    d'elle-même. Renvoie -1 sans mention.
    """
    for key in keys:
        pattern = _GEAR_PATTERNS.get(key)
        match = pattern.search(haystack) if pattern is not None else None
        if match is not None:
            return match.start()
    return -1


def gear_label(key: str) -> str:
    """Libellé lisible d'une clé matériel ; la clé elle-même si elle est inconnue."""
    return GEAR_LABELS.get(key, key)
