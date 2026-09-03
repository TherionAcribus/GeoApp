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


_GEAR_PATTERNS: dict[str, tuple[re.Pattern[str], ...]] = {
    key: tuple(_compile_term(term) for term in terms)
    for key, terms in GEAR_LEXICON.items()
}

_SEARCH_EFFORT_PATTERNS: tuple[re.Pattern[str], ...] = tuple(
    _compile_term(term) for term in SEARCH_EFFORT_LEXICON
)


def find_gear_mentions(text: str | None) -> list[str]:
    """
    Clés de `GEAR_LEXICON` mentionnées dans le texte, dans l'ordre du lexique.

    L'ordre est stable et indépendant du texte : il rend les tests déterministes et
    l'affichage prévisible d'un log à l'autre.
    """
    if not text:
        return []
    haystack = normalize(text)
    return [
        key
        for key, patterns in _GEAR_PATTERNS.items()
        if any(pattern.search(haystack) for pattern in patterns)
    ]


def find_search_effort_mentions(text: str | None) -> list[str]:
    """Expressions de `SEARCH_EFFORT_LEXICON` trouvées dans le texte."""
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
    haystack = normalize(text)
    return any(pattern.search(haystack) for pattern in _SEARCH_EFFORT_PATTERNS)


def gear_label(key: str) -> str:
    """Libellé lisible d'une clé matériel ; la clé elle-même si elle est inconnue."""
    return GEAR_LABELS.get(key, key)
