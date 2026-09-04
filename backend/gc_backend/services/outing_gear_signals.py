"""
Traduction des attributs Geocaching.com en signaux exploitables pour une sortie.

Principe : **l'attribut n'est pas la réponse, c'est la question.** « Outil spécial
requis » ne dit pas s'il faut une canne à pêche, un aimant ou de quoi crocheter ;
« Matériel d'escalade » ne distingue pas l'échelle du matériel arboricole ou spéléo.

Ce module produit donc deux natures de signaux :

- les signaux **résolus** (`resolved=True`), auto-suffisants : lampe UV, plongée,
  raquettes… l'attribut dit tout ce qu'il y a à savoir ;
- les signaux **non résolus** (`resolved=False`), qui posent une question à l'IA :
  quel outil ? quel type de grimpe ? La réponse est à chercher dans le listing, le hint
  et les logs, pas ici.

S'y ajoutent des signaux **contextuels** (`kind='context'`) : frais d'entrée, discrétion,
accès non 24 h, risques, longueur de marche. Ils ne relèvent pas du matériel mais pèsent
sur l'organisation de la sortie.

Un drapeau non résolu peut ensuite l'être **sans l'IA** : si le listing ou le hint nomme
un objet du lexique capable d'expliquer le drapeau, `resolve_signals_from_text()` le
referme et note d'où vient la réponse (`resolved_from`). C'est ce qui rend le mode léger
utilisable : le listing n'y est pas transmis, mais son balayage lexical, lui, l'est.

## Résolution du slug d'attribut

`Geocache.attributes` contient des entrées hétérogènes selon la source :

- scraping (`geocaches/scraper.py`) : `{name, is_negative, base_filename}` où
  `base_filename` vaut par exemple `flashlight-yes` — **suffixe `-yes`/`-no` inclus**,
  puisqu'il est dérivé du nom de fichier de l'icône ;
- GPX (`geocaches/gpx_parser.py`) : `{name, is_negative, gc_attribute_id}`, sans slug.

`name` est un **libellé localisé** : il vaut « Flashlight required » ou « Lampe torche
requise » selon la langue du compte Geocaching.com au moment de la récupération. Il ne
peut donc jamais servir de clé primaire. L'ordre de résolution est :

1. `base_filename` (slug stable, suffixe retiré) ;
2. `gc_attribute_id` (source GPX) ;
3. `name`, en dernier recours, par **mots-clés distinctifs** FR + EN plutôt que par
   égalité stricte — les libellés varient trop d'une langue et d'une version à l'autre
   pour qu'une table de noms exacts tienne.
"""

from __future__ import annotations

from .outing_lexicons import normalize

# ─────────────────────────────────────────────────────────────────────────────
# Table des signaux, indexée par slug canonique
# ─────────────────────────────────────────────────────────────────────────────

# (signal, kind, resolved, label)
_SignalSpec = tuple[str, str, bool, str]

# Signaux matériel auto-suffisants : l'attribut désigne sans ambiguïté ce qu'il faut.
_RESOLVED_GEAR: dict[str, _SignalSpec] = {
    'flashlight': ('flashlight', 'gear', True, 'lampe / frontale'),
    'uv': ('uv_light', 'gear', True, 'lampe UV'),
    'nightcache': ('night', 'gear', True, 'cache de nuit : lampe indispensable'),
    'night': ('night', 'gear', True, 'recommandée de nuit : lampe'),
    'scuba': ('scuba', 'gear', True, 'matériel de plongée'),
    'wading': ('wading', 'gear', True, 'cuissardes / bottes (passage dans l\'eau)'),
    'swimming': ('swimming', 'gear', True, 'de quoi nager'),
    'boat': ('boat', 'gear', True, 'embarcation'),
    'snowshoes': ('snow_gear', 'gear', True, 'raquettes'),
    'skiis': ('snow_gear', 'gear', True, 'skis'),
    'winter': ('seasonal', 'gear', True, 'cache d\'hiver : équipement de saison'),
    'seasonal': ('seasonal', 'gear', True, 'accès saisonnier'),
    'thorn': ('protection', 'gear', True, 'ronces : gants et manches longues'),
    'poisonoak': ('protection', 'gear', True, 'plantes urticantes : gants, manches longues'),
    'ticks': ('protection', 'gear', True, 'tiques : jambes couvertes, répulsif'),
    'wirelessbeacon': ('beacon', 'gear', True, 'balise sans fil (chirp) : récepteur ou téléphone'),
}

# Signaux non résolus : l'attribut lève un drapeau, l'IA doit trouver quoi.
_UNRESOLVED_GEAR: dict[str, _SignalSpec] = {
    's-tool': ('special_tool', 'gear', False, 'outil spécial requis — nature à déterminer'),
    'climbing': ('climbing', 'gear', False, 'matériel de grimpe — type à déterminer'),
    'rappelling': ('climbing', 'gear', False, 'descente en rappel — matériel à préciser'),
    'treeclimbing': ('tree_climbing', 'gear', False, 'grimpe d\'arbre — matériel à préciser'),
    'field_puzzle': ('field_puzzle', 'gear', False, 'énigme à résoudre sur place — nature à déterminer'),
    'teamwork': ('teamwork', 'gear', False, 'travail d\'équipe requis — à préciser'),
}

# Signaux contextuels : ni matériel, ni question, mais utiles à l'organisation.
_CONTEXT: dict[str, _SignalSpec] = {
    'fee': ('fee', 'context', True, 'frais d\'entrée'),
    'available': ('available_24h', 'context', True, 'accessible 24 h/24'),
    'stealth': ('stealth', 'context', True, 'discrétion nécessaire (muggles)'),
    'onehour': ('quick', 'context', True, 'moins d\'une heure'),
    'parkngrab': ('quick', 'context', True, 'park & grab'),
    'hike_short': ('hike_short', 'context', True, 'marche courte (< 1 km)'),
    'hike_med': ('hike_med', 'context', True, 'marche moyenne (1 à 10 km)'),
    'hike_long': ('hike_long', 'context', True, 'longue marche (> 10 km)'),
    'hiking': ('hiking', 'context', True, 'randonnée'),
    'dangerousanimals': ('risk', 'context', True, 'animaux dangereux'),
    'cliff': ('risk', 'context', True, 'falaise / à-pic'),
    'mine': ('risk', 'context', True, 'mine / carrière'),
    'danger': ('risk', 'context', True, 'zone dangereuse'),
    'hunting': ('risk', 'context', True, 'zone de chasse'),
    'abandonedbuilding': ('risk', 'context', True, 'bâtiment abandonné'),
    'parking': ('parking', 'context', True, 'parking à proximité'),
    'kids': ('kids', 'context', True, 'adapté aux enfants'),
    'stroller': ('stroller', 'context', True, 'accessible en poussette'),
    'wheelchair': ('wheelchair', 'context', True, 'accessible en fauteuil'),
    'dogs': ('dogs', 'context', True, 'chiens'),
    'bonuscache': ('bonus', 'context', True, 'cache bonus'),
    'challengecache': ('challenge', 'context', True, 'challenge cache : conditions à remplir'),
    'powertrail': ('powertrail', 'context', True, 'power trail'),
    'partnership': ('partnership', 'context', True, 'partenariat / autorisation'),
    'public': ('public_transit', 'context', True, 'transports en commun'),
}

_SLUG_SIGNALS: dict[str, _SignalSpec] = {**_RESOLVED_GEAR, **_UNRESOLVED_GEAR, **_CONTEXT}

# Attributs dont la forme négative porte l'information utile.
# `available-no` (« pas accessible 24 h/24 ») est le cas majeur : c'est une contrainte
# horaire, exactement ce qu'une préparation de sortie doit anticiper.
_NEGATIVE_CONTEXT: dict[str, _SignalSpec] = {
    'available': ('not_available_24h', 'context', True, 'PAS accessible 24 h/24 : contrainte horaire'),
    'dogs': ('dogs_forbidden', 'context', True, 'chiens interdits'),
    'kids': ('not_for_kids', 'context', True, 'déconseillé aux enfants'),
    'stroller': ('no_stroller', 'context', True, 'poussette impossible'),
    'wheelchair': ('no_wheelchair', 'context', True, 'non accessible en fauteuil'),
    'parking': ('no_parking', 'context', True, 'pas de parking à proximité'),
    'bicycles': ('no_bicycles', 'context', True, 'vélos interdits'),
}

# ─────────────────────────────────────────────────────────────────────────────
# Correspondance par identifiant GPX
# ─────────────────────────────────────────────────────────────────────────────

# Identifiants d'attributs Geocaching.com présents dans les GPX (`<groundspeak:attribute
# id="...">`). Volontairement **partielle** : seuls les identifiants utiles à la
# préparation d'une sortie y figurent. Un identifiant absent n'est pas une erreur, il
# retombe simplement sur la résolution par libellé.
#
# À valider sur un GPX réel : voir `documentation/analyse-ia-sortie-spec.md`.
_ATTRIBUTE_ID_TO_SLUG: dict[str, str] = {
    '2': 'fee',
    '3': 'rappelling',
    '4': 'boat',
    '5': 'scuba',
    '6': 'kids',
    '7': 'onehour',
    '9': 'hiking',
    '10': 'climbing',
    '11': 'wading',
    '12': 'swimming',
    '13': 'available',
    '14': 'night',
    '15': 'winter',
    '17': 'poisonoak',
    '18': 'dangerousanimals',
    '19': 'ticks',
    '20': 'mine',
    '21': 'cliff',
    '22': 'hunting',
    '23': 'danger',
    '24': 'wheelchair',
    '25': 'parking',
    '26': 'public',
    '39': 'thorn',
    '40': 'stealth',
    '41': 'stroller',
    '44': 'flashlight',
    '47': 'field_puzzle',
    '48': 'uv',
    '49': 'snowshoes',
    '50': 'skiis',
    '51': 's-tool',
    '52': 'nightcache',
    '53': 'parkngrab',
    '54': 'abandonedbuilding',
    '55': 'hike_short',
    '56': 'hike_med',
    '57': 'hike_long',
    '60': 'wirelessbeacon',
    '61': 'partnership',
    '62': 'seasonal',
    '64': 'treeclimbing',
    '66': 'teamwork',
    '69': 'bonuscache',
    '70': 'powertrail',
    '71': 'challengecache',
}

# ─────────────────────────────────────────────────────────────────────────────
# Correspondance par libellé (dernier recours)
# ─────────────────────────────────────────────────────────────────────────────

# Mots-clés distinctifs, FR + EN, testés sur le libellé normalisé. L'ordre compte : le
# premier motif trouvé gagne, donc les cas spécifiques passent avant les génériques
# (« lampe uv » avant « lampe »).
_NAME_KEYWORDS: tuple[tuple[tuple[str, ...], str], ...] = (
    (('lampe uv', 'uv light', 'ultraviolet', 'blacklight', 'black light'), 'uv'),
    (('outil special', 'outil necessaire', 'special tool'), 's-tool'),
    (('grimper aux arbres', 'tree climbing'), 'treeclimbing'),
    (('rappel', 'abseil'), 'rappelling'),
    (('escalade', 'grimpe', 'climbing'), 'climbing'),
    (('plongee', 'scuba'), 'scuba'),
    (('nager', 'swimming'), 'swimming'),
    (("marcher dans l'eau", 'gue', 'wading'), 'wading'),
    (('bateau', 'boat'), 'boat'),
    (('raquette', 'snowshoe'), 'snowshoes'),
    (('cache de nuit', 'night cache'), 'nightcache'),
    (('de nuit', 'at night'), 'night'),
    (('lampe', 'torche', 'flashlight'), 'flashlight'),
    (('enigme sur le terrain', 'field puzzle'), 'field_puzzle'),
    (("travail d'equipe", 'teamwork'), 'teamwork'),
    (('ronce', 'thorn'), 'thorn'),
    (('tique', 'tick'), 'ticks'),
    (('animaux dangereux', 'dangerous animals'), 'dangerousanimals'),
    (('falaise', 'cliff'), 'cliff'),
    (('discretion', 'stealth'), 'stealth'),
    (('frais', 'fee'), 'fee'),
    (('24 h', '24h', '24/7', 'available at all times'), 'available'),
    (('longue randonnee', 'long hike'), 'hike_long'),
    (('chirp', 'wireless beacon'), 'wirelessbeacon'),
    (('saison', 'seasonal'), 'seasonal'),
    (('hiver', 'winter'), 'winter'),
)


def _slug_from_base_filename(raw: str | None) -> str | None:
    """
    Slug canonique depuis `base_filename`, dont le suffixe `-yes` / `-no` est retiré.

    Le scraper construit cette valeur depuis le nom de fichier de l'icône
    (`flashlight-yes.png` → `flashlight-yes`) : le suffixe fait donc partie de la chaîne
    stockée et doit être enlevé avant toute correspondance.
    """
    if not raw:
        return None
    slug = normalize(raw).strip()
    for suffix in ('-yes', '-no'):
        if slug.endswith(suffix):
            slug = slug[: -len(suffix)]
            break
    return slug or None


def _slug_from_name(raw: str | None) -> str | None:
    """Slug déduit du libellé localisé, par mots-clés distinctifs."""
    if not raw:
        return None
    haystack = normalize(raw)
    for keywords, slug in _NAME_KEYWORDS:
        if any(keyword in haystack for keyword in keywords):
            return slug
    return None


def resolve_attribute_slug(attribute: dict) -> str | None:
    """Slug canonique d'un attribut, selon l'ordre de résolution documenté en tête."""
    if not isinstance(attribute, dict):
        return None

    slug = _slug_from_base_filename(attribute.get('base_filename'))
    if slug and slug in _SLUG_SIGNALS:
        return slug

    attribute_id = attribute.get('gc_attribute_id')
    if attribute_id is not None:
        mapped = _ATTRIBUTE_ID_TO_SLUG.get(str(attribute_id).strip())
        if mapped:
            return mapped

    from_name = _slug_from_name(attribute.get('name'))
    if from_name:
        return from_name

    # Slug reconnu comme identifiant mais sans signal associé (ex. `scenic`) : on le
    # renvoie quand même, l'appelant saura qu'il n'y a rien à en tirer.
    return slug


def build_gear_signals(attributes: list[dict] | None) -> list[dict]:
    """
    Signaux matériel et contextuels déduits des attributs d'une géocache.

    Chaque entrée : `{signal, kind, resolved, resolved_from, label, slug, source,
    is_negative}`. `resolved_from` vaut `'attribute'` quand l'attribut se suffit et `None`
    tant que le drapeau reste ouvert — `resolve_signals_from_text()` peut le refermer
    ensuite depuis le listing ou le hint.

    Les doublons de signal sont écartés — deux attributs peuvent porter le même
    (`climbing` et `rappelling` mènent tous deux à `climbing`).
    """
    if not attributes:
        return []

    signals: list[dict] = []
    seen: set[str] = set()

    for attribute in attributes:
        if not isinstance(attribute, dict):
            continue

        slug = resolve_attribute_slug(attribute)
        if not slug:
            continue

        is_negative = bool(attribute.get('is_negative'))
        spec = _NEGATIVE_CONTEXT.get(slug) if is_negative else _SLUG_SIGNALS.get(slug)

        # Un attribut négatif n'appelle aucun matériel : « pas de chiens » ne se prépare
        # pas dans un sac à dos. Seuls les négatifs listés dans `_NEGATIVE_CONTEXT`
        # portent une information exploitable.
        if not spec:
            continue

        signal, kind, resolved, label = spec
        if signal in seen:
            continue
        seen.add(signal)

        signals.append({
            'signal': signal,
            'kind': kind,
            'resolved': resolved,
            'resolved_from': 'attribute' if resolved else None,
            'label': label,
            'slug': slug,
            'source': 'attribute',
            'is_negative': is_negative,
        })

    return signals


#: Types de waypoint (libellé Geocaching.com) valant « il y a un parking renseigné ».
_PARKING_WAYPOINT_TERMS = ('parking', 'stationnement')

#: Signaux parking déjà portés par les attributs : le waypoint n'a alors rien à ajouter,
#: et le négatif (« pas de parking à proximité ») ne doit surtout pas être contredit.
_PARKING_SIGNALS = ('parking', 'no_parking')


def build_waypoint_signals(waypoints: list | None, existing: list[dict] | None = None) -> list[dict]:
    """
    Signaux contextuels déduits des waypoints, en complément des attributs.

    Un seul cas aujourd'hui : un waypoint de type « Parking Area » dit qu'un point de
    stationnement est renseigné, information que l'attribut `parking` ne porte pas
    toujours. Rien n'est ajouté si les attributs ont déjà tranché la question, dans un
    sens ou dans l'autre.
    """
    if not waypoints:
        return []

    already = {signal.get('signal') for signal in (existing or [])}
    if any(name in already for name in _PARKING_SIGNALS):
        return []

    for waypoint in waypoints:
        raw_type = normalize(getattr(waypoint, 'type', None) or '')
        if any(term in raw_type for term in _PARKING_WAYPOINT_TERMS):
            return [{
                'signal': 'parking',
                'kind': 'context',
                'resolved': True,
                'resolved_from': 'waypoint',
                'label': 'parking renseigné en waypoint',
                'slug': 'parking',
                'source': 'waypoint',
                'is_negative': False,
            }]

    return []


# ─────────────────────────────────────────────────────────────────────────────
# Pré-résolution depuis le texte
# ─────────────────────────────────────────────────────────────────────────────

#: Ce qu'un mot du lexique matériel peut expliquer, drapeau par drapeau.
#:
#: Volontairement restreint. Un drapeau `special_tool` n'est pas refermé par « lampe » ni
#: par « gants » : ces objets ont leur propre attribut, et les rattacher à « outil spécial
#: requis » donnerait une réponse fausse avec l'assurance d'une réponse calculée. Ne sont
#: retenus que les objets qui *sont* l'outil que l'attribut annonce sans le nommer.
#:
#: `field_puzzle` et `teamwork` n'y figurent pas : aucun mot du lexique ne dit quelle
#: énigme ni combien de bras. Ces drapeaux restent ouverts, pour l'IA.
_SIGNAL_GEAR_CANDIDATES: dict[str, tuple[str, ...]] = {
    'special_tool': (
        'fishing_rod', 'magnet', 'hook', 'pliers', 'screwdriver', 'lockpick',
        'mirror', 'magnifier', 'straw_tube', 'water', 'cutter', 'ladder', 'rope',
    ),
    'climbing': ('rope', 'harness', 'ladder', 'caving', 'tree_gear'),
    'tree_climbing': ('tree_gear', 'rope', 'harness', 'ladder'),
}

#: Sources de pré-résolution, de la plus fiable à la moins fiable.
#:
#: Le listing et le hint sont écrits par le propriétaire : quand ils nomment l'outil, ils
#: font autorité. Les logs, eux, restent à l'IA — ils sont nombreux, contradictoires, et
#: leur extrait est déjà transmis avec ses `matched`, donc citable et datable.
RESOLUTION_SOURCES = ('listing', 'hint')


def resolve_signals_from_text(
    signals: list[dict] | None,
    mentions_by_source: list[tuple[str, list[str]]] | None,
) -> list[dict]:
    """
    Referme les drapeaux matériel que le texte suffit à expliquer.

    `mentions_by_source` est une liste ordonnée `(source, clés du lexique repérées)`, la
    source la plus fiable en premier. Un drapeau refermé ici garde son libellé mais gagne
    `resolved=True`, `resolved_from=<source>` et `resolved_gear=<clés retenues>` : le
    prompt peut alors citer la source, et l'IA n'a plus à chercher ce qui est déjà trouvé.

    Le balayage est lexical, pas sémantique : il repère que le mot est écrit, pas qu'il
    est écrit *en positif*. C'est le même risque que court l'IA en lisant le listing —
    d'où le choix d'annoncer la source plutôt qu'un fait sans provenance.
    """
    if not signals:
        return []

    resolved_signals: list[dict] = []
    for signal in signals:
        candidates = (
            () if signal.get('resolved') or signal.get('kind') != 'gear'
            else _SIGNAL_GEAR_CANDIDATES.get(signal.get('signal') or '', ())
        )

        matched_source, matched_gear = None, []
        for source, mentions in (mentions_by_source or []):
            # L'ordre des candidats prime sur celui des mentions : il est stable d'une
            # cache à l'autre, ce que l'ordre du texte n'est pas.
            matched_gear = [key for key in candidates if key in (mentions or ())]
            if matched_gear:
                matched_source = source
                break

        if not matched_source:
            resolved_signals.append(signal)
            continue

        resolved_signals.append({
            **signal,
            'resolved': True,
            'resolved_from': matched_source,
            'resolved_gear': matched_gear,
        })

    return resolved_signals


def count_unresolved(signals: list[dict] | None) -> int:
    """Nombre de drapeaux que l'IA doit résoudre depuis le texte."""
    if not signals:
        return 0
    return sum(1 for signal in signals if not signal.get('resolved'))


def count_resolved_from_text(signals: list[dict] | None) -> int:
    """Nombre de drapeaux refermés par le balayage du listing ou du hint."""
    if not signals:
        return 0
    return sum(1 for signal in signals if signal.get('resolved_from') in RESOLUTION_SOURCES)
