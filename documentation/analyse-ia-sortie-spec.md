# Analyse IA d'une sortie — Spécification

> Document de travail destiné à l'implémentation de la fonctionnalité « Analyser avec
> l'IA » sur un lot de géocaches (préparation d'une sortie). Organisé en 5 lots
> indépendants, implémentables et commitables séparément.
>
> **État : les 5 lots sont livrés (2026-09-03), plus un lot 6 d'enrichissement du bundle,
> un lot 7 de balayage lexical du listing, un lot 8 de géographie, un lot 9 d'estimation de
> temps et un lot 10 de budget de tokens adaptatif (2026-09-04).**
> Les blocs « Écart constaté à l'implémentation » signalent les endroits où le code
> s'écarte de la spec initiale, et pourquoi.
> La documentation de référence est désormais le § 31 de
> `documentation/chat-ia-geoapp-technique.md` ; ce document reste le journal de conception.
>
> Conventions du dépôt : messages de commit en français au format
> `Domaine > description` (voir `git log`).
> Tests backend : `cd backend && python -m pytest tests/ -x -q`.
> Tests front : `cd frontend/theia-extensions/zones && npm run test:geoapp`
> (chaque nouveau fichier de test doit être ajouté à la chaîne du script `test:geoapp`).

---

## Objectif fonctionnel

Depuis une sélection de géocaches (table de zone) ou depuis la liste complète du
log-editor, l'utilisateur déclenche une analyse IA qui produit, dans le Chat Theia, un
**rapport de préparation de sortie** :

1. une **checklist matériel consolidée** en tête (l'union dédupliquée de tout ce qu'il
   faut emporter) ;
2. le **détail par cache** : matériel, temps à prévoir, contraintes ;
3. les **alertes** : caches en mauvaise santé, mysteries non résolues, contraintes
   horaires ou saisonnières, autorisations ;
4. une **priorisation** si le temps manque.

### Principe directeur : déterministe d'abord, IA ensuite

Tout ce qui est **calculable** est calculé côté Python et fourni à l'IA comme un fait.
Tout ce qui demande de **lire du texte libre** est laissé à l'IA. La frontière :

| Calculé (backend) | Déduit (IA) |
|---|---|
| Santé de la cache (DNF consécutifs, ancienneté de la dernière trouvaille, maintenance) | Nature précise de l'outil requis |
| Drapeaux matériel issus des attributs | Type de matériel de grimpe (échelle / corde / arbo / spéléo) |
| Sélection des logs pertinents (lexique matériel) | Durée réaliste, priorisation |
| Distances, ordre de visite géométrique, coucher du soleil | Le réordonnancement selon les contraintes horaires |
| Mystery non résolue, waypoints, statut | Contraintes implicites du listing (horaires, marée, autorisation) |

**L'attribut n'est pas la réponse, c'est la question.** « Outil spécial requis » (`s-tool`)
ne dit pas *quel* outil : canne à pêche, aimant, crochet, pince, bouteille d'eau, matériel
de crochetage… De même `climbing` ne distingue pas l'échelle du matériel arboricole ou
spéléo. Le backend lève un **drapeau non résolu** ; l'IA le résout depuis le listing, le
hint et surtout **les logs**, où l'information se trouve le plus souvent.

---

## Vue d'ensemble des lots

| Lot | Priorité | Contenu | Risque de régression |
|---|---|---|---|
| 1 | P0 | Backend : service d'analyse, endpoint bundle, santé, drapeaux matériel, extraction lexicale | Nul (code neuf) |
| 2 | P0 | Front : client de service + construction du prompt | Nul (code neuf) |
| 3 | P1 | UI : bouton dans les deux tables + dialogue d'options | Faible |
| 4 | P1 | Agent `geoapp-outing-analyzer`, prompt système, préférences, configuration du modèle | Faible |
| 5 | P2 | Documentation | Nul |
| 6 | P1 | Données manquantes dans le bundle : trouvaille, notes, EarthCache, waypoints, qualité et fraîcheur des logs | Faible |
| 7 | P1 | Lexique matériel appliqué au listing complet et au hint, pré-résolution des drapeaux | Faible |
| 8 | P1 | Géographie : étendue, ordre de visite, groupes de marche, coucher du soleil, date de sortie | Faible |
| 9 | P1 | Estimation de temps déterministe : temps sur place par cache, trajet, budget de la sortie | Faible |
| 10 | P1 | Budget de tokens adaptatif : palier de détail par cache, plafond dur avec rétrogradation, prompt système compté | Moyen (le niveau de détail change de sens) |

Tous livrés. Récapitulatif des fichiers produits :

| Lot | Fichiers |
|---|---|
| 1 | `outing_lexicons.py`, `outing_gear_signals.py`, `outing_health.py`, `outing_analysis_service.py`, endpoint dans `blueprints/geocaches.py`, `tests/test_outing_analysis.py` (46 tests) |
| 2 | `outing-analysis-types.ts`, `outing-analysis-prompt.ts`, `fetchAnalysisBundle()`, `tests/outing-analysis-prompt.test.ts` (18 tests) |
| 3 | `outing-analysis-controller.ts`, boutons dans `geocaches-table.tsx` et `log-editor/log-editor-header.tsx`, câblage des deux widgets, binding Inversify, `tests/outing-analysis-controller.test.ts` (15 tests) |
| 4 | `geoapp-outing-analyzer-agent.ts`, prompt système, 4 préférences, ligne du panneau Policy, `tests/geoapp-outing-analyzer-agent.test.ts` (7 tests) + 1 test de bridge |
| 5 | § 31 de `chat-ia-geoapp-technique.md`, `docs/ia/analyse-sortie.md` |
| 6 | `outing_analysis_service.py`, `outing_health.py`, `outing_gear_signals.py`, `outing-analysis-types.ts`, `outing-analysis-prompt.ts`, `outing-analysis-controller.ts`, `geoapp-chat-system-prompts.ts` (voir § LOT 6 en fin de document) |
| 7 | `outing_lexicons.py`, `outing_gear_signals.py`, `outing_analysis_service.py`, `outing-analysis-prompt.ts`, `geoapp-chat-system-prompts.ts` (voir § LOT 7 en fin de document) |
| 8 | `outing_geography.py`, `outing_sun.py`, `tests/test_outing_geography.py`, endpoint, `outing_analysis_service.py`, les trois fichiers `outing-analysis-*.ts`, `geocaches-service.ts`, `geoapp-chat-system-prompts.ts` |
| 9 | `outing_time_estimate.py`, `tests/test_outing_time_estimate.py`, `outing_analysis_service.py`, `outing-analysis-types.ts`, `outing-analysis-prompt.ts`, `geoapp-chat-system-prompts.ts` (voir § LOT 9 en fin de document) |
| 10 | `outing-analysis-budget.ts`, `tests/outing-analysis-budget.test.ts` (27 tests), `outing-analysis-types.ts`, `outing-analysis-prompt.ts`, `outing-analysis-controller.ts`, `geoapp-preference-contribution.ts`, `geoapp-chat-system-prompts.ts` (voir § LOT 10 en fin de document) |

Ordre imposé : 1 → 2 → 3 → 4 → 5. Le lot 3 n'est testable de bout en bout qu'après le
lot 4 (sans agent dédié, la session s'ouvre sur l'agent GeoApp par défaut, ce qui reste
fonctionnel).

**Hors périmètre (décidé)** : aucun rafraîchissement forcé des logs. Quand les logs
locaux manquent, on le **signale** (bandeau UI + mention explicite dans le prompt) et on
analyse avec ce que l'on a. Un système de rafraîchissement global sera traité à part.

**Levé après coup (lot 17)** — le rafraîchissement n'est toujours pas *forcé*, mais il
est désormais **proposé avant l'analyse**, sur la foi d'un pré-vol purement local
(`POST /api/geocaches/analysis-logs-status`). L'argument qui l'avait écarté était que les
caches sans logs ne sont connues qu'après la collecte du bundle : c'est vrai du bundle,
pas du fait lui-même, qui tient en une requête agrégée. Cf. § 31 de
`chat-ia-geoapp-technique.md`.

---

## LOT 1 — Backend : bundle d'analyse (P0)

### 1.1 Module de lexiques

**Fichier (nouveau)** : `backend/gc_backend/services/outing_lexicons.py`

**Rôle** : centraliser les listes de mots-clés, éditables sans toucher à la logique.

**Contenu** :

```python
# Vocabulaire matériel, FR + EN : les listings et les logs sont souvent en anglais.
GEAR_LEXICON: dict[str, tuple[str, ...]] = {
    'fishing_rod': ('canne à pêche', 'fishing rod', 'fishing pole', 'telescopic pole', 'perche'),
    'magnet':      ('aimant', 'magnet', 'néodyme'),
    'hook':        ('crochet', 'hook', 'grappin', 'grappling'),
    'pliers':      ('pince', 'pliers', 'tweezers', 'pince à épiler'),
    'screwdriver': ('tournevis', 'screwdriver', 'clé allen', 'allen key', 'hex key'),
    'ladder':      ('échelle', 'ladder', 'escabeau', 'step stool'),
    'rope':        ('corde', 'rope', 'cordelette', 'sangle', 'webbing'),
    'harness':     ('baudrier', 'harness', 'mousqueton', 'carabiner', 'descendeur', 'rappel'),
    'caving':      ('spéléo', 'caving', 'casque', 'helmet'),
    'tree_gear':   ('arboricole', 'arbo', 'tree climbing', "grimpe d'arbre", 'éperons'),
    'flashlight':  ('lampe', 'torche', 'flashlight', 'frontale', 'headlamp'),
    'uv_light':    ('uv', 'ultraviolet', 'blacklight', 'black light', 'lampe uv'),
    'battery':     ('pile', 'piles', 'battery', 'batteries', 'powerbank', 'power bank'),
    'water':       ("bouteille d'eau", "verser de l'eau", 'pour water', 'add water', "remplir d'eau"),
    'straw_tube':  ('paille', 'straw', 'tube', 'seringue', 'syringe', 'pipette'),
    'gloves':      ('gants', 'gloves'),
    'cutter':      ('cutter', 'couteau', 'knife'),
    'waders':      ('cuissardes', 'waders', 'bottes', 'boots', 'wellies'),
    'wetsuit':     ('combinaison', 'wetsuit', 'palmes', 'fins', 'tuba', 'snorkel', 'masque'),
    'boat':        ('bateau', 'boat', 'kayak', 'canoë', 'canoe', 'paddle', 'barque', 'packraft'),
    'snow_gear':   ('raquettes', 'snowshoes', 'crampons', 'piolet', 'ice axe'),
    'lockpick':    ('crochetage', 'lockpick', 'lock pick', 'crochète', 'trombone', 'paperclip'),
    'mirror':      ('miroir', 'mirror', 'endoscope', 'caméra endoscopique', 'inspection camera'),
    'magnifier':   ('loupe', 'magnifier', 'magnifying'),
}

# Indices de « recherche longue sur place » : sert à estimer le temps.
SEARCH_EFFORT_LEXICON: tuple[str, ...] = (
    'bien cachée', 'sournoise', 'vicieuse', 'camouflage', 'camouflée',
    "j'ai cherché", 'longtemps', 'plusieurs passages', 'revenu', 'deuxième visite',
    'well hidden', 'sneaky', 'evil', 'took me ages', 'took a while', 'second visit',
    'came back', 'searched for', 'needle in a haystack',
)
```

**Notes d'implémentation** :
- La recherche se fait sur du texte **normalisé** : minuscules + suppression des accents
  (`unicodedata.normalize('NFD', …)` puis filtrage des combinantes). Les entrées du
  lexique sont normalisées de la même façon **au chargement du module**, pas à chaque
  appel. Un log écrit « canne a peche » sans accent doit matcher comme « canne à pêche ».
- Prévoir `find_gear_mentions(text: str) -> list[str]` renvoyant les clés du lexique
  trouvées, et `has_search_effort_hint(text: str) -> bool`.
- Éviter les faux positifs sur les mots courts : appliquer une frontière de mot (`\b`)
  pour les entrées de moins de 5 caractères (`uv`, `tube`, `pince`) — « uv » doit matcher,
  « uvea » non.

**Écart constaté à l'implémentation** — la frontière de mot ne suffit pas : passé sur les
logs réels, le lexique initial produisait des faux positifs systématiques que seule la
suppression de termes ambigus corrige. Termes retirés et leurs remplaçants :

| Terme retiré | Se confond avec | Remplacé par |
|---|---|---|
| `perche` | « perché » (accents retirés avant comparaison) | `perche télescopique`, `canne télescopique` |
| `pile` | « à midi pile » | `piles`, `pile de rechange`, `pile neuve` |
| `combinaison` | la combinaison d'un cadenas ou d'une énigme | `combinaison de plongée`, `combinaison néoprène` |
| `casque`, `masque` | casque de vélo, masque quelconque | `casque de spéléo` |
| `rappel` | « pour rappel », « rappel : … » | `descente en rappel`, `abseil` |
| `botte` | « botte de foin » | `bottes` |

Règle générale : **mieux vaut manquer une mention que noyer l'IA sous des extraits hors
sujet.** Un peu de bruit reste acceptable — l'IA voit l'extrait et peut l'écarter — mais
il doit rester l'exception. Après correction, sur un échantillon réel de logs, les
mentions retenues étaient toutes pertinentes sauf une (l'idiome « j'en pince pour »).

---

### 1.2 Mapping attributs → drapeaux matériel

**Fichier (nouveau)** : `backend/gc_backend/services/outing_gear_signals.py`

**Constat** : `Geocache.attributes` est une liste de `{name, is_negative, base_filename?}`
(scraper, `backend/gc_backend/geocaches/scraper.py` ~ligne 528) ou
`{name, is_negative, gc_attribute_id?}` (GPX, `backend/gc_backend/geocaches/gpx_parser.py`
~ligne 142).

**Piège à ne pas rater** : `name` est un **libellé localisé** repris du `title`/`alt` de
la page Geocaching.com — il vaut « Lampe torche requise » ou « Flashlight required »
selon la langue du compte au moment du scraping. **Ne jamais faire de mapping sur `name`
en premier.** Ordre de résolution imposé :

1. `base_filename` (slug stable : `flashlight`, `UV`, `s-tool`, `climbing`, …) ;
2. `gc_attribute_id` (source GPX) ;
3. `name` normalisé, **en dernier recours** et pour les seuls libellés FR/EN connus.

**Slugs `base_filename` réellement présents** (extraits de
`frontend/theia-extensions/zones/src/browser/geocache-attributes-icons-data.ts`) :

```
AbandonedBuilding UV available bicycles boat bonuscache campfires camping challengecache
cliff climbing cow danger dangerousanimals dogs fee field_puzzle firstaid flashlight food
frontyard fuel geotour hike_long hike_med hike_short hiking horses hqsolutionchecker
hunting jeeps kids landf mine motorcycles night nightcache onehour parking parkngrab
partnership phone picnic poisonoak powertrail public quads rappelling restrooms rv s-tool
scenic scuba seasonal skiis snowmobiles snowshoes stealth stroller swimming teamwork
thorn ticks touristOK treeclimbing wading water wheelchair winter wirelessbeacon
```

**Table de mapping** — trois catégories distinctes :

*(a) Drapeaux **auto-suffisants*** (l'attribut dit tout, `resolved: true`) :

| Slug | Signal | Matériel déduit |
|---|---|---|
| `flashlight` | `flashlight` | lampe / frontale |
| `UV` | `uv_light` | lampe UV |
| `nightcache`, `night` | `night` | lampe + cache de nuit |
| `scuba` | `scuba` | matériel de plongée |
| `wading` | `wading` | cuissardes / bottes |
| `swimming` | `swimming` | de quoi nager |
| `boat` | `boat` | embarcation |
| `snowshoes` | `snow_gear` | raquettes |
| `winter`, `seasonal` | `seasonal` | contrainte saisonnière |
| `thorn`, `poisonoak`, `ticks` | `protection` | gants / manches longues |
| `wirelessbeacon` | `beacon` | récepteur / téléphone (chirp) |

*(b) Drapeaux **non résolus*** (`resolved: false` — l'IA doit trouver quoi) :

| Slug | Signal | Question posée à l'IA |
|---|---|---|
| `s-tool` | `special_tool` | **quel** outil ? |
| `climbing`, `rappelling` | `climbing` | échelle, corde+baudrier, arbo ou spéléo ? |
| `treeclimbing` | `tree_climbing` | quel matériel d'arbre ? |
| `field_puzzle` | `field_puzzle` | quelle recherche/résolution sur place ? |
| `teamwork` | `teamwork` | combien de personnes, pour quoi ? |

*(c) Signaux **contextuels*** (ni matériel ni non résolus, mais utiles au rapport) :
`fee` (frais d'entrée), `available` négatif (pas accessible 24 h), `stealth` (discrétion),
`onehour`/`parkngrab` (rapide), `hike_long`/`hike_med`/`hike_short` (marche),
`dangerousanimals`/`cliff`/`mine`/`danger` (risque), `kids`/`stroller`/`wheelchair`
(accessibilité), `parking` (waypoint de parking).

**Attention `is_negative`** : un attribut négatif inverse le sens (`dogs` négatif = chiens
interdits). Un signal matériel n'est levé **que** si `is_negative` est faux. Les attributs
négatifs pertinents (`available-no`, `dogs-no`, `kids-no`) sont reversés dans les signaux
contextuels avec une mention explicite « interdit / non ».

**Signature** :

```python
def build_gear_signals(attributes: list[dict] | None) -> list[dict]:
    """Renvoie [{signal, source: 'attribute', slug, resolved: bool, label}]."""
```

---

### 1.3 Calcul de santé

**Fichier (nouveau)** : `backend/gc_backend/services/outing_health.py`

**Entrée** : la géocache et ses logs locaux (`GeocacheLog`, déjà triés `date desc` par la
relation, `backend/gc_backend/geocaches/models.py` ligne 66).

**Types de logs normalisés** présents en base : `Found it`, `Didn't find it`,
`Write note`, `Owner Maintenance`, `Needs Maintenance`, `Temporarily Disable Listing`,
`Enable Listing`, `Publish Listing`, `Archive` (cf. `_LOG_TYPE_LABELS`,
`backend/gc_backend/blueprints/logs.py` ligne 171, et la table de normalisation
`backend/gc_backend/blueprints/geocaches.py` ~ligne 179). **Comparer en insensible à la
casse et en tolérant les variantes** (`did not find`, `didn't find it`).

**Sortie** :

```python
{
  'level': 'ok' | 'watch' | 'risky' | 'very_risky' | 'unknown',
  'reasons': ['3 DNF consécutifs depuis la dernière trouvaille', ...],
  'logs_available': bool,              # False si aucun log local
  'local_logs_count': int,
  'last_found_date': str | None,       # ISO
  'days_since_last_found': int | None,
  'consecutive_dnf': int,              # DNF depuis la dernière trouvaille
  'dnf_ratio_recent': float | None,    # DNF / (DNF + Found) sur les 10 derniers
  'needs_maintenance_pending': bool,   # NM postérieur au dernier OM
  'listing_status': str | None,        # Geocache.status
}
```

**Règles de niveau** (dans cet ordre, la première qui matche gagne) :

1. `logs_available is False` → `unknown`, raison « aucun log local : cache jamais
   rafraîchie, santé non évaluable ».
2. `listing_status` archivé/désactivé → `very_risky`, raison explicite.
3. `consecutive_dnf >= 3` **ou** (`consecutive_dnf >= 2` **et**
   `needs_maintenance_pending`) → `very_risky`.
4. `consecutive_dnf == 2` **ou** `days_since_last_found > 365` **ou**
   (`needs_maintenance_pending` **et** `days_since_last_found > 180`) → `risky`.
5. `consecutive_dnf == 1` **ou** `days_since_last_found > 180` **ou**
   `needs_maintenance_pending` **ou** `dnf_ratio_recent >= 0.4` → `watch`.
6. Sinon → `ok`.

**Seuils** : constantes de module (`DNF_VERY_RISKY = 3`, `STALE_DAYS_RISKY = 365`,
`STALE_DAYS_WATCH = 180`, `DNF_RATIO_WATCH = 0.4`) pour que le lot 4 puisse les exposer
en préférences si le besoin s'en fait sentir.

**Pièges** :
- `GeocacheLog.date` peut être `None` : ces logs sont ignorés du calcul temporel mais
  comptent dans les types.
- Comparer avec `datetime.now(timezone.utc)` et gérer les dates naïves stockées en base
  (les traiter comme UTC plutôt que de lever).
- Une cache jamais trouvée (aucun `Found it`) mais avec des logs : `last_found_date` à
  `None`, `days_since_last_found` à `None` ; utiliser `placed_at` dans la raison
  (« jamais trouvée depuis sa publication le … »).

---

### 1.4 Service de bundle

**Fichier (nouveau)** : `backend/gc_backend/services/outing_analysis_service.py`

**Signature** :

```python
def build_analysis_bundle(
    geocache_ids: list[int],
    *,
    listing_chars: int = 1800,
    recent_logs_count: int = 5,
    gear_logs_count: int = 8,
) -> dict:
```

**Pour chaque géocache** (dans l'ordre demandé, sans doublon — même contrat que
`GET /api/geocaches/batch`, `backend/gc_backend/blueprints/geocaches.py` ligne 1114) :

```python
{
  'id', 'gc_code', 'name', 'type', 'size', 'owner',
  'difficulty', 'terrain', 'status',
  'coordinates': str | None,          # coordinates_raw, ou original si non corrigées
  'is_corrected': bool,
  'solved': str,                      # not_solved | in_progress | solved
  'unsolved_mystery': bool,           # type Mystery/Unknown ET solved != 'solved' ET pas de coords corrigées
  'favorites_count', 'logs_count',
  'placed_at': str | None,
  'hint': str | None,                 # hints_decoded_override > hints_decoded > rot13(hints)
  'listing_excerpt': str,             # texte brut tronqué
  'listing_truncated': bool,
  'attributes': [{'label', 'is_negative'}],
  'gear_signals': [...],              # cf. 1.2
  'waypoints': [{'name', 'type', 'prefix', 'note_excerpt'}],
  'waypoints_count': int,
  'health': {...},                    # cf. 1.3
  'recent_logs': [{'type', 'date', 'author', 'text_excerpt'}],
  'gear_logs': [{'date', 'author', 'matched': [...], 'text_excerpt'}],
  'search_effort_logs': [{'date', 'author', 'text_excerpt'}],
}
```

**Règles de construction** :

- **Hint** : priorité `hints_decoded_override` → `hints_decoded` →
  `Geocache.decode_hint_rot13(hints)`.

  **Écart constaté à l'implémentation** — sur une partie du parc réel, `hints` et
  `hints_decoded` sont **inversés en base** : `hints` contient le texte en clair et
  `hints_decoded` son ROT13 (vérifié sur `GCB7C9X` et `GCB7C3Y`). Suivre l'ordre nominal
  y renverrait du ROT13, que l'IA tenterait d'interpréter — pire qu'un hint absent.
  `_resolve_hint` choisit donc, parmi les candidats, celui qui ressemble le plus à de la
  langue naturelle : nombre de mots courants FR/EN reconnus d'abord, proportion de
  voyelles en départage. En cas d'égalité, l'ordre nominal est conservé.

  Cette inversion affecte aussi `to_dict()` et donc la page de détails : **bug de données
  à traiter séparément**, hors périmètre de ce chantier.
- **Listing** : partir de `description_override_raw` s'il existe, sinon `description_raw`,
  sinon strip HTML de `description_html`. Normaliser les blancs, tronquer à
  `listing_chars` sur une frontière de mot, positionner `listing_truncated`.
- **`gear_logs`** : parcourir **tous** les logs de la cache (pas seulement les récents) et
  retenir ceux dont le texte matche `GEAR_LEXICON`. C'est le cœur de la fonctionnalité :
  un log de 2019 disant « prévoir une canne à pêche » ne sortirait jamais des N derniers
  logs. Trier par pertinence (nombre de clés matchées) puis par date décroissante,
  plafonner à `gear_logs_count`. Extrait centré sur la première occurrence, ~300 c.
- **`search_effort_logs`** : même mécanique avec `SEARCH_EFFORT_LEXICON`, plafonné à 3.
- **Déduplication** : un log peut apparaître à la fois dans `recent_logs` et `gear_logs`.
  C'est **voulu** — les deux blocs répondent à des questions différentes — mais l'extrait
  doit être identique pour ne pas donner l'illusion de deux logs distincts.
- **Performance** : une seule requête pour les caches
  (`Geocache.query.filter(Geocache.id.in_(ids))`) et **une seule** pour les logs
  (`GeocacheLog.query.filter(GeocacheLog.geocache_id.in_(ids)).order_by(date.desc())`),
  puis regroupement en mémoire. Ne pas déclencher le lazy-loading cache par cache.

**Bloc global renvoyé** :

```python
{
  'generated_at': str,                   # ISO, UTC
  'requested_count': int,
  'geocaches': [...],
  'missing': [ids introuvables],
  'without_local_logs': [gc_code, ...],  # alimente le bandeau UI et la mention du prompt
  'stats': {
     'by_type': {...}, 'by_health_level': {...},
     'unsolved_mysteries': int,
     'unresolved_gear_signals': int,
  },
}
```

---

### 1.5 Endpoint

**Fichier** : `backend/gc_backend/blueprints/geocaches.py` (blueprint déjà enregistré,
`backend/gc_backend/__init__.py` ligne 111 — rien à ajouter côté wiring).

```
POST /api/geocaches/analysis-bundle
Body: {"ids": [1,2,3], "listing_chars": 1800, "recent_logs_count": 5, "gear_logs_count": 8}
```

- Réutiliser la validation d'ids de `get_geocaches_batch` (entiers, dédoublonnage, ordre
  conservé). **Plafond distinct et plus bas** : `MAX_ANALYSIS_GEOCACHE_IDS = 60` (le
  bundle est bien plus lourd que `to_summary()`), erreur 400 au-delà.
- Borner les paramètres : `listing_chars` dans **[0, 6000]**, `recent_logs_count` dans
  [0, 20], `gear_logs_count` dans [0, 20].

  **Écart constaté au lot 2** : la borne basse est 0, pas 200. Le niveau de détail
  « léger » ne demande aucun listing ; le plancher initial aurait fait transférer 200
  caractères par cache pour les jeter ensuite côté prompt. `_resolve_listing` traite
  donc `listing_chars = 0` comme « pas de listing du tout ».
- Un id introuvable ne fait pas échouer l'appel (il part dans `missing`).

### 1.6 Tests (lot 1)

**Fichier (nouveau)** : `backend/tests/test_outing_analysis.py`

- **Santé** : aucun log → `unknown` ; 3 DNF consécutifs → `very_risky` ; 1 DNF puis un
  Found plus récent → `consecutive_dnf == 0` ; NM postérieur au dernier OM →
  `needs_maintenance_pending` ; dernière trouvaille il y a 400 jours → `risky` ; cache
  archivée → `very_risky` ; log sans date → pas de crash.
- **Drapeaux** : `base_filename='s-tool'` → signal `special_tool` **non résolu** ;
  `base_filename='flashlight'` → signal résolu ; `is_negative=True` → aucun signal
  matériel ; attribut sans `base_filename` mais `name='Flashlight required'` → résolu par
  le fallback ; `name` en français → résolu par le fallback FR.
- **Lexique** : un log contenant « il faut une canne à pêche » remonte dans `gear_logs`
  avec `matched=['fishing_rod']` ; un log de 2019 matché sort bien alors qu'il n'est pas
  dans les 5 récents ; « UV » isolé matche, « uvea » non (frontière de mot) ;
  « canne a peche » sans accent matche aussi (normalisation).
- **Endpoint** : 200 avec ordre conservé et `missing` peuplé ; 400 au-delà du plafond ;
  400 sur ids invalides ; `without_local_logs` correctement rempli.

---

## LOT 2 — Front : client et construction du prompt (P0)

### 2.1 Types et client de service

**Fichier (nouveau)** : `frontend/theia-extensions/zones/src/browser/outing-analysis-types.ts`

`OutingAnalysisBundle`, `OutingAnalysisGeocache`, `OutingHealth`, `OutingGearSignal`,
`OutingDetailLevel`. Fichier séparé pour être importable par la table, les widgets et le
constructeur de prompt sans dépendance circulaire.

**Fichier** : `frontend/theia-extensions/zones/src/browser/geocaches-service.ts`

Ajouter, dans le style des méthodes existantes (`exportGpx` ligne 32, `get` ligne 83) :

```ts
async fetchAnalysisBundle(
    geocacheIds: number[],
    options?: { listingChars?: number; recentLogsCount?: number; gearLogsCount?: number },
    signal?: AbortSignal
): Promise<OutingAnalysisBundle>
```

### 2.2 Construction du prompt

**Fichier (nouveau)** : `frontend/theia-extensions/zones/src/browser/outing-analysis-prompt.ts`

S'aligner sur le style de `geocache-chat-prompt-shared.ts` : fonctions pures, testables,
sans dépendance Theia.

```ts
export function buildOutingAnalysisPrompt(
    bundle: OutingAnalysisBundle,
    context: { zoneName?: string; outingDate?: string; detailLevel: OutingDetailLevel }
): string
```

**Structure du prompt produit** (Markdown, ordre imposé) :

```
# Analyse de sortie — <zone> — <n> géocaches
Date de la sortie : <date>
Données générées le : <generated_at>

## Fiabilité des données
- <n> cache(s) sans logs locaux : GC..., GC... — leur santé n'est PAS évaluable et
  aucune information de log n'est disponible pour elles. Ne conclus rien à leur sujet.
- <n> mystery(s) non résolue(s) : GC...

## Géocaches

### 1. GC1234 — Nom de la cache
- Type : Mystery | Taille : Micro | D 3.5 / T 4.0 | Favoris : 42 | Logs : 118
- Statut : active | Résolue : non | Coordonnées : N.. E.. (non corrigées)
- Santé : risky — 2 DNF consécutifs ; dernière trouvaille il y a 214 jours
- Attributs : Outil spécial requis, Grimpe, Nécessite une lampe
- Signaux matériel : special_tool (NON RÉSOLU), climbing (NON RÉSOLU), flashlight (lampe)
- Waypoints : 3 (Parking, Stage 1, Stage 2)
- Hint : <hint décodé>
- Listing (extrait, tronqué) :
  > ...
- Logs mentionnant du matériel :
  > [2019-06-12, Toto] « ... il faut une canne à pêche ... » (matched: fishing_rod)
- Logs suggérant une recherche longue :
  > [2023-04-01, Titi] « ... bien cachée, j'ai cherché 40 minutes ... »
- Logs récents :
  > [2024-03-02] Didn't find it — Titi : « ... »
```

**Règles** :
- **Sections vides omises**, jamais rendues comme « aucun ». Un bloc absent est plus
  lisible qu'un bloc vide, et coûte moins de tokens.
- Les drapeaux non résolus sont écrits en toutes lettres **`(NON RÉSOLU)`** : c'est le
  marqueur que le prompt système exploite.
- `detailLevel` pilote la troncature : `light` (pas de listing, 3 logs récents),
  `standard` (listing 1800 c., 5 logs), `full` (listing 4000 c., 10 logs).
- **Estimation de taille** : exporter
  `estimateOutingPromptSize(prompt): { chars: number; approxTokens: number }`
  avec `approxTokens ≈ chars / 3.6` (ratio français, marge conservatrice). Consommé par
  l'UI du lot 3 pour avertir avant l'envoi.
- L'**instruction de tâche** n'est *pas* dans ce prompt : elle vit dans le prompt système
  de l'agent (lot 4). Ce fichier ne produit que des **données mises en forme**. Une seule
  exception, la dernière ligne, qui rappelle la commande :
  `« Produis le rapport de préparation de sortie selon ton format. »`

### 2.3 Tests (lot 2)

**Fichier (nouveau)** : `frontend/theia-extensions/zones/src/browser/tests/outing-analysis-prompt.test.ts`
**À ajouter à la chaîne `test:geoapp` de `package.json`.**

- Bundle vide → prompt cohérent, pas de crash.
- Une cache sans hint / sans listing / sans logs → sections correspondantes absentes.
- Un signal `resolved: false` → mention `(NON RÉSOLU)` présente.
- `without_local_logs` non vide → section « Fiabilité des données » présente avec les
  codes GC listés.
- `detailLevel: 'light'` → aucun extrait de listing dans la sortie.
- `estimateOutingPromptSize` croît avec le nombre de caches.

---

## LOT 3 — UI : déclenchement depuis les deux tables (P1)

### 3.1 Table de zone (sélection multiple)

**Fichier** : `frontend/theia-extensions/zones/src/browser/geocaches-table.tsx`

1. Ajouter les props, dans le bloc des props d'action (~ligne 73) :
   ```ts
   onAnalyzeWithAiSelected?: (ids: number[]) => void;
   /** Vrai pendant la collecte du bundle : désactive le bouton. */
   analyzingWithAi?: boolean;
   ```
2. Ajouter le bouton dans la barre d'actions (~ligne 1232, **après `Plugin`, avant
   `Exporter GPX`**), en copiant le motif à spinner de `Exporter GPX` (lignes 1250-1268)
   pour l'état occupé :
   ```tsx
   {onAnalyzeWithAiSelected && (
       <button
           onClick={() => onAnalyzeWithAiSelected(selectedIds)}
           className="geoapp-gc-action-btn geoapp-gc-action-btn--primary"
           disabled={analyzingWithAi}
           aria-busy={analyzingWithAi}
           title="Analyser la sélection avec l'IA (préparation de sortie)"
       >
           <span className="geoapp-gc-action-btn__icon" aria-hidden="true">🧠</span>
           {analyzingWithAi ? 'Analyse en cours…' : 'Analyser IA'}
       </button>
   )}
   ```

**Fichier** : `frontend/theia-extensions/zones/src/browser/zone-geocaches-widget.tsx`

3. Câbler `onAnalyzeWithAiSelected={ids => this.handleAnalyzeWithAiSelected(ids)}` dans
   le bloc de props existant (~ligne 1812).
4. Implémenter `handleAnalyzeWithAiSelected(ids)` en suivant le motif de
   `handleExportGpxSelected` (ligne 519) : garde sur sélection vide, garde de réentrance,
   `messages.showProgress` annulable via `AbortController`, drapeau `analyzingWithAi` +
   `this.update()`.

**Fichier** : `frontend/theia-extensions/zones/src/browser/zone-geocaches-view.tsx`

5. Faire transiter les deux nouvelles props (ce fichier ne fait que relayer).

### 3.2 Log-editor (liste complète, pas de sélection)

**Constat** : `log-editor/geocaches-table.tsx` n'a **aucune sélection de lignes** — la
table affiche la totalité des caches à loguer. C'est en réalité le cas d'usage cible
(« les géocaches du jour ») : le bouton porte donc sur **toute la liste**, pas sur une
sélection. Ne pas ajouter de cases à cocher à cette table.

**Fichier** : `frontend/theia-extensions/zones/src/browser/log-editor/log-editor-header.tsx`

6. Ajouter deux props (`onAnalyzeWithAi: () => void`, `analyzingWithAi: boolean`) et un
   bouton à côté de « Copier les field notes » / « Télécharger » (~lignes 95-104), avec
   le même `disabled={isLoading || loadedCount === 0}` que ses voisins, plus
   `|| analyzingWithAi`. Libellé : `🧠 Analyser la sortie`.

**Fichier** : `frontend/theia-extensions/zones/src/browser/geocache-log-editor-widget.tsx`

7. Passer les props au `<LogEditorHeader>` (~ligne 2093) et implémenter
   `analyzeOutingWithAi()`, qui appelle le **même** contrôleur que la table de zone avec
   `this.geocaches.map(gc => gc.id)`.

### 3.3 Contrôleur partagé

**Fichier (nouveau)** : `frontend/theia-extensions/zones/src/browser/outing-analysis-controller.ts`

Pour ne pas dupliquer la logique entre les deux widgets :

```ts
@injectable()
export class OutingAnalysisController {
    async analyze(
        geocacheIds: number[],
        context: { zoneName?: string; detailLevel?: OutingDetailLevel },
        signal?: AbortSignal
    ): Promise<{ warnings: string[] }>
}
```

Enchaîne : garde sur liste vide → garde de plafond (au-delà de 60, message d'erreur
explicite) → `fetchAnalysisBundle` → `buildOutingAnalysisPrompt` →
`estimateOutingPromptSize` → `dispatchGeoAppOpenChatRequest`.

**Écart constaté à l'implémentation** — le contrôleur expose finalement **deux** niveaux
au lieu d'un :

- `analyze()` ne touche à aucune UI et renvoie ses avertissements ;
- `runInteractive()` ajoute le choix du niveau de détail, la progression annulable et
  l'affichage des messages.

La séparation initiale (« le contrôleur ne connaît pas `MessageService`, chaque widget
affiche ») aurait fait dupliquer une quarantaine de lignes de glue dans les deux widgets
— d'autant que `geocache-log-editor-widget.tsx` n'a **pas** de `QuickInputService`
injecté et aurait fallu en ajouter un. `analyze()` reste sans UI, donc testable seul ;
c'est lui que couvrent les tests.

`openChatSession()` isole l'appel à `dispatchGeoAppOpenChatRequest` : les tests
l'interceptent sans avoir à simuler `window` ni `CustomEvent`.

**Binding** : `zones-frontend-module.ts`, en `inSingletonScope()`, comme les autres
services du dossier.

### 3.4 Ouverture de la session Chat

Dans le contrôleur :

```ts
dispatchGeoAppOpenChatRequest(window, CustomEvent, {
    sessionTitle: `SORTIE — ${zoneName ?? 'sélection'} — ${dateIso} (${count} caches)`,
    prompt,
    focus: true,
    workflowKind: 'general',
    sessionKind: 'libre',
    preferredAgentId: GeoAppOutingAnalyzerAgentId,   // lot 4
});
```

**Points d'attention vérifiés dans le code** :
- Ne **pas** passer `geocacheId` ni `gcCode` : la session ne porte pas sur une cache.
  `findExistingSession` (`geoapp-chat-bridge.ts` ligne 139) retombe alors sur le
  `baseSessionTitle`, ce qui est exactement le comportement voulu.
- Le titre contient la **date du jour** : deux analyses le même jour sur la même zone
  réutilisent la session (utile) ; le lendemain, une session neuve s'ouvre.
- `sessionKind: 'libre'` évite toute collision avec les sessions par cache (`'auto'`),
  le tri se faisant d'abord sur ce champ.
- `preferredAgentId` est bien honoré **en premier** par `resolveDefaultChatAgent`
  (`geoapp-chat-bridge.ts` ligne 408) ; si l'agent n'est pas prêt, Theia retombe
  proprement sur la chaîne de candidats existante.

### 3.5 Dialogue d'options

Petit dialogue avant le lancement (motif de `move-geocache-dialog.tsx` /
`import-dialog-shell.tsx`) :
- niveau de détail : Léger / **Standard** (défaut) / Complet ;
- nombre de logs récents par cache (défaut : préférence du lot 4) ;
- avertissement au-delà du seuil de caches (préférence `warnAboveCount`), **sans
  blocage**.

Les caches sans logs locaux ne sont connues **qu'après** la récupération du bundle. Deux
ordres possibles ; **retenir celui-ci** : dialogue d'options d'abord, puis récupération,
puis avertissements via `MessageService` (« X cache(s) sans logs locaux : l'analyse sera
partielle pour celles-ci. »). Il évite un aller-retour réseau si l'utilisateur annule.
**Aucun bouton de rafraîchissement** dans ce bandeau — décision explicite, cf. périmètre.

**Révisé au lot 17** — la prémisse était fausse : le *bundle* ne le sait qu'après, mais la
question « cette cache a-t-elle des logs, et de quand datent-ils ? » se répond en une
requête agrégée. Un pré-vol s'intercale donc entre le niveau de détail et la collecte, et
propose le rafraîchissement pendant qu'il sert encore à quelque chose. Le bandeau final
porte quant à lui l'action « Rafraîchir et relancer », mais seulement quand aucun
rafraîchissement n'a été tenté en amont : le reproposer sur une cache qu'on vient de
rafraîchir ouvrirait une boucle.

**Écart constaté à l'implémentation** — le dialogue est un `QuickInputService.pick`, pas
un composant React. Trois entrées (Standard / Léger / Complet, le défaut des préférences
en tête et marqué comme tel), ce qui suffit à couvrir le besoin sans introduire un
composant de dialogue partagé entre deux widgets. Le nombre de logs reste piloté par les
préférences ; l'exposer dans le picker aurait demandé un vrai formulaire pour un réglage
qu'on change rarement.

---

## LOT 4 — Agent dédié et configuration du modèle (P1)

### 4.1 Agent chat

**Fichier (nouveau)** : `frontend/theia-extensions/zones/src/browser/geoapp-outing-analyzer-agent.ts`

Contrairement aux agents *internes* (`geoapp-logs-analyzer` et consorts, qui sont de
simples `Agent` appelés via `LanguageModelService`), celui-ci doit être un **`ChatAgent`**
puisque la restitution passe par le Chat Theia. Le dériver de `BaseGeoAppChatAgent`
(`geoapp-chat-agent.ts` ligne 117), comme `GeoAppChatStrongAgent` (ligne 213) :

```ts
export const GeoAppOutingAnalyzerAgentId = 'geoapp-outing-analyzer';
```

- `id`, `name: 'GeoApp Analyse de sortie'`, description explicite.
- `systemPromptId = GEOAPP_OUTING_SYSTEM_PROMPT_ID` (cf. 4.2) — c'est le seul écart
  notable avec les agents de profil, qui partagent `GEOAPP_CHAT_SYSTEM_PROMPT_ID`.

  **Écart constaté à l'implémentation** — poser `systemPromptId` **ne suffit pas**.
  `BaseGeoAppChatAgent` surcharge `getSystemMessageDescription()` et y choisit sa variante
  via `GeoAppChatPromptVariantByPack[policy.promptPack]`, sans jamais lire
  `systemPromptId`. L'agent de sortie doit donc surcharger cette méthode à son tour pour
  résoudre `GEOAPP_OUTING_SYSTEM_PROMPT_VARIANT_ID`. Il conserve l'ajout de
  `describePolicyForPrompt(policy)` : sans elle, le modèle ignorerait quels tools il peut
  appeler pour les questions de suivi. Si le prompt de sortie est introuvable, on retombe
  sur `super` plutôt que de partir sans consigne (cas couvert par un test).

  **Second écart** — l'agent est enregistré par sa **propre**
  `GeoAppOutingAnalyzerAgentContribution`, pas par `GeoAppChatAgentContribution` : cette
  dernière vit dans `geoapp-chat-agent.ts`, que le fichier de l'agent de sortie importe
  déjà pour `BaseGeoAppChatAgent` — l'inverse créerait un cycle. C'est aussi le motif des
  autres agents GeoApp. `BaseGeoAppChatAgent` a dû être exporté.
- `languageModelRequirements` : `[{ purpose: 'chat', identifier: 'default/universal' }]`,
  identique aux autres — c'est Theia qui résout le modèle concret.
- Enregistrement : ajouter l'agent à `GeoAppChatAgentContribution.onStart()`
  (`geoapp-chat-agent.ts` ligne 231), qui désenregistre puis réenregistre chaque agent.
- Binding Inversify dans `zones-frontend-module.ts`, aligné sur les autres agents chat :
  le bind doit couvrir `ChatAgent` **et** `Agent` pour que Theia l'expose dans ses
  réglages IA.

### 4.2 Prompt système

**Fichier** : `frontend/theia-extensions/zones/src/browser/geoapp-chat-system-prompts.ts`

Ajouter `GEOAPP_OUTING_SYSTEM_PROMPT_ID = 'geoapp-outing-system'` et un `PromptVariantSet`
dédié (une seule variante au départ ; la structure du fichier en supporte plusieurs — cf.
`GeoAppChatSystemPromptVariants` ligne 53).

**Contenu du prompt — les règles non négociables** :

1. **Ne jamais inventer un outil.** Pour chaque signal marqué `(NON RÉSOLU)`, produire
   l'un des trois niveaux :

   | Niveau | Condition | Rendu attendu |
   |---|---|---|
   | **Confirmé** | l'outil est nommé dans le listing, le hint ou un log | « canne à pêche — log de *Toto*, 12/04/2023 » |
   | **Probable** | déduction d'un faisceau (T5 + « en hauteur » + attribut grimpe) | « échelle ou perche — le listing mentionne 3 m » |
   | **Non identifié** | drapeau levé, textes muets | « outil requis, nature inconnue → prévoir la trousse polyvalente » |

   « Non identifié » est une **réponse valide et utile**, pas un échec.

2. **Toujours citer la source** d'un matériel confirmé (listing / hint / log daté).

3. **Préciser la grimpe** quand l'information existe : échelle, corde + baudrier,
   matériel arboricole, spéléo — ce sont des sorties différentes ; un « matériel de
   grimpe » générique n'aide pas.

4. **Ne rien conclure sur les caches sans logs locaux**, listées en tête du prompt.

5. **Signaler les mystery non résolues comme bloquantes** : sans coordonnées corrigées,
   le déplacement est inutile.

**Plan de rapport imposé** :

```
## 1. Checklist matériel          (union dédupliquée, groupée par niveau de certitude)
## 2. Alertes                     (santé, mysteries non résolues, horaires, autorisations, risques)
## 3. Détail par cache            (matériel, temps estimé, points d'attention)
## 4. Temps et priorisation       (caches chronophages, ce qu'on garde si le temps manque)
## 5. Points à vérifier avant de partir
```

**Grille d'analyse à couvrir** (liste explicite dans le prompt, pour ne rien oublier) :
matériel et outils ; recherche/résolution sur place (`field_puzzle`) ; caches
chronophages (multi à étapes, D élevée, longue marche) ; contraintes horaires (cache de
nuit, lieu fermé, commerce, accès non 24 h) ; saison et météo (marée, crue, végétation,
neige) ; accès et autorisation (parking, frais, propriété privée, zone réglementée) ;
risques (ronces, tiques, animaux, falaise, mine, terrain instable) ; discrétion
(`stealth`, muggles) ; travail d'équipe (`teamwork`) ; santé des caches ; mysteries non
résolues ; priorisation par favoris et D/T.

### 4.3 Configuration du modèle

**Fichier** : `frontend/theia-extensions/zones/src/browser/geoapp-chat-policy-widget.tsx`

Ajouter la ligne dans `AGENT_MODEL_ROWS` (ligne 104), après les agents de profil :

```ts
{ id: 'geoapp-outing-analyzer', label: 'Analyse de sortie', kind: 'chat', purpose: 'chat' },
```

L'agent devient dès lors assignable à un modèle précis dans les réglages IA de Theia, et
son modèle effectif s'affiche dans le panneau de diagnostic.

### 4.4 Préférences

**Fichier** : `frontend/theia-extensions/zones/src/browser/geoapp-preference-contribution.ts`
(constantes dans `geoapp-chat-shared.ts`, comme les préférences existantes)

Les constantes vivent dans `outing-analysis-types.ts` (le module de contrat de la
fonctionnalité) et non dans le contrôleur : le schéma de préférences peut ainsi les
importer sans dépendre d'un contrôleur. Même raison pour
`GEOAPP_OUTING_ANALYZER_AGENT_ID` et `MAX_OUTING_ANALYSIS_GEOCACHES`.

| Préférence | Type | Défaut | Description |
|---|---|---|---|
| `geoApp.outing.analysis.detailLevel` | enum `light`/`standard`/`full` | `standard` | Niveau de détail par défaut |
| `geoApp.outing.analysis.recentLogsCount` | number [0,20] | `5` | Logs récents par cache |
| `geoApp.outing.analysis.gearLogsCount` | number [0,20] | `8` | Logs « matériel » par cache |
| `geoApp.outing.analysis.warnAboveCount` | number | `25` | Seuil d'avertissement sur le volume |

### 4.5 Tests (lot 4)

- `tests/geoapp-chat-agent.test.ts` : l'agent `geoapp-outing-analyzer` est bien
  enregistré par la contribution et porte le bon `systemPromptId`.
- `tests/geoapp-chat-bridge.test.ts` : un détail portant
  `preferredAgentId: 'geoapp-outing-analyzer'` et **sans** `geocacheId` ouvre une session
  `libre` épinglée sur cet agent ; une seconde requête au même titre **réutilise** la
  session au lieu d'en créer une nouvelle.

---

## LOT 5 — Documentation (P2)

**Fichier** : `documentation/chat-ia-geoapp-technique.md`

1. Ajouter `geoapp-outing-analyzer` au tableau des agents (§ 4) — dans la table des
   agents **chat**, pas dans celle des agents internes, avec une note expliquant
   pourquoi il a son propre `systemPromptId`.
2. Ajouter les fichiers neufs au tableau du § 2.
3. Nouvelle section « Analyse de sortie » : le flux
   `table → OutingAnalysisController → POST /api/geocaches/analysis-bundle →
   outing_analysis_service → prompt → GeoAppChatBridge → session Chat`, la frontière
   déterministe / IA, et le contrat des `gear_signals`.
4. Documenter les **choix de conception** : pourquoi des drapeaux non résolus plutôt
   qu'une liste de matériel, et pourquoi les logs sont filtrés par lexique plutôt que
   tronqués à la date.

**Fichier** : `frontend/theia-extensions/documentation/src/browser/docs/ia/` — note
utilisateur courte : à quoi sert le bouton, ce que l'IA sait et ne sait pas, pourquoi
certaines caches sont marquées « données incomplètes ».

---

## Récapitulatif des vérifications avant de commencer chaque lot

- **Lot 1** : `cd backend && python -m pytest tests/ -x -q` au vert avant et après.
  Vérifier sur une vraie base que `base_filename` est bien renseigné pour les caches
  scrapées — les caches importées par GPX n'en ont pas, c'est précisément le cas d'usage
  du fallback `gc_attribute_id` puis `name`.
- **Lot 2** : `cd frontend/theia-extensions/zones && npm run test:geoapp`. Ne pas oublier
  d'ajouter le nouveau fichier de test à la chaîne du script.
- **Lot 3** : `npm run build` sur l'extension `zones` ; vérifier à la main que la barre
  d'actions ne change pas de hauteur (le commentaire ligne 1222 de `geocaches-table.tsx`
  signale que la hauteur est réservée exprès pour éviter un décalage du tableau).
- **Lot 4** : vérifier dans les réglages IA de Theia que l'agent apparaît et qu'un modèle
  peut lui être assigné ; vérifier dans le panneau Policy que la ligne « Analyse de
  sortie » affiche le modèle effectif.
- **Lot 5** : relire le § 2 de `chat-ia-geoapp-technique.md` pour que la liste des
  fichiers reste exhaustive.

---

## LOT 6 — Données manquantes dans le bundle (livré le 2026-09-04)

Audit d'après-coup : six informations existaient en base et n'arrivaient pas jusqu'à
l'IA. Fort impact, faible effort — aucune nouvelle mécanique, seulement des champs
transportés jusqu'au prompt.

| Manque | Correction | Fichiers |
|---|---|---|
| `found` / `found_date` | Alerte « déjà trouvée » dans le bloc de la cache, liste `already_found` en tête du bundle, avertissement dans le dialogue avant envoi | `_build_geocache_entry`, `formatFoundLine`, `collectWarnings` |
| Note personnelle (`gc_personal_note`) et notes GeoApp (`Note`) | Rendues **avant** le listing ; le prompt système en fait la source prioritaire | `_serialize_personal_note`, `_serialize_notes`, `formatPersonalNote`, `formatNotes` |
| `GeocacheLoggingTask` (EarthCache) | Section « Questions à répondre sur place », `requires_photo` remonté jusqu'à la checklist matériel | `_serialize_logging_tasks`, `formatLoggingTasks` |
| Coordonnées et type des waypoints | Une ligne par waypoint : identité, type, coordonnées, note. Un waypoint `Parking Area` lève un signal contextuel `parking` (`source: 'waypoint'`) | `_serialize_waypoints`, `build_waypoint_signals`, `formatWaypointLine` |
| `is_friend_log` / `is_favorite` | Accolés à l'en-tête de chaque extrait de log, dans les trois sélections | `_log_meta`, `formatLogOrigin` |
| Fraîcheur des logs | `logs_fetched_at`, `days_since_logs_fetched`, `logs_stale` (seuil 180 j), liste `stale_logs` | `compute_health` |

### Deux décisions à retenir

**La péremption ne dégrade pas le niveau de santé.** Les DNF comptés restent des DNF et
les dates de logs restent exactes : c'est la *complétude* de la collecte qui est en cause,
pas le calcul. Dégrader `ok` en `watch` reviendrait à confondre « rien à signaler jusqu'à
la date de collecte » et « signal faible ». La péremption est donc rendue comme un fait —
raison de santé, liste de tête, avertissement UI, règle du prompt système — et c'est le
rapport qui pondère.

**`logs_fetched_at` est une approximation par le bas.** Elle vaut
`max(updated_at, created_at)` sur les logs : un rafraîchissement qui ne ramène rien de
nouveau ne touche aucune ligne, donc l'ancienneté calculée est majorée, jamais minorée.
On se trompe du côté prudent, ce qui est le bon sens de l'erreur pour un indicateur de
fiabilité.

### Nettoyages de données constatés sur la vraie base

- Le type de waypoint arrive du scraping avec un retour à la ligne et une parenthèse
  orpheline (`Parking Area)\n            `). Nettoyé à la sérialisation : le prompt est un
  format ligne à ligne.
- `gc_coords` vaut `???` pour un waypoint dont les coordonnées ne sont pas publiées
  (final de multi, étape virtuelle). Traité comme une absence, pas comme une valeur.

Les deux corrections sont locales au bundle ; la donnée elle-même n'est pas corrigée, au
même titre que l'inversion `hints` / `hints_decoded` du lot 1.

### Tests

- Backend : 72 tests dans `tests/test_outing_analysis.py` (26 ajoutés — fraîcheur,
  waypoints, notes, tâches, métadonnées de logs).
- Front : `outing-analysis-prompt.test.ts` (25 tests) et `outing-analysis-controller.test.ts`
  (16 tests).

---

## LOT 7 — Le lexique sur le listing et le hint (livré le 2026-09-04)

`find_gear_mentions()` ne tournait que sur les logs. En mode léger, où le listing est
purement supprimé (`listing_chars = 0`), un drapeau « outil spécial requis » était donc
insoluble dès lors que la réponse était dans le listing plutôt que dans un log.

| Apport | Correction | Fichiers |
|---|---|---|
| Balayage du listing **complet** et du hint | `gear_mentions_in_listing`, `gear_mentions_in_hint` dans chaque entrée ; rendus sur une ligne « Matériel nommé dans le texte (repérage GeoApp) » | `_listing_plain_text`, `_build_geocache_entry`, `formatGearMentions` |
| Pré-résolution des drapeaux | `resolve_signals_from_text()` referme `special_tool`, `climbing` et `tree_climbing` quand le texte nomme l'objet ; le signal gagne `resolved_from` et `resolved_gear` | `outing_gear_signals.py`, `formatGearSignals` |
| Comptage | `presolved_gear_signals` dans les stats, annoncé dans « Fiabilité des données » | `_build_stats`, `formatReliabilitySection` |
| Consigne au modèle | Un signal « résolu depuis le listing » est du **CONFIRMÉ** avec sa source, y compris en mode léger | `geoapp-chat-system-prompts.ts` |

### Trois décisions à retenir

**Le balayage porte sur le texte complet, pas sur l'extrait transmis.** C'est le même
principe que `gear_logs` : la mention utile est rarement au bon endroit. Elle arrive après
l'histoire du lieu, donc hors troncature — et en mode léger, hors de tout.

**La correspondance drapeau → objets est étroite.** Une lampe ou des gants ne referment pas
« outil spécial requis » : ces objets ont leur propre attribut, et une réponse fausse rendue
avec l'assurance d'un calcul est pire qu'une question laissée ouverte. `field_puzzle` et
`teamwork` ne se referment jamais.

**Les logs ne pré-résolvent rien.** Ils sont nombreux, parfois contradictoires, et leur
extrait part déjà avec ses `matched`, sa date et son auteur : l'IA peut les citer, ce qu'un
compteur agrégé ne permettrait pas. Seuls le listing et le hint, écrits par le
propriétaire, font autorité — le listing d'abord.

### Limite assumée

Le balayage est lexical, pas sémantique : il voit que le mot est écrit, pas qu'il est écrit
en positif (« aucun aimant nécessaire » referme le drapeau sur `magnet`). C'est le risque
que court l'IA en lisant le listing elle-même ; d'où le choix d'annoncer la source plutôt
qu'un fait sans provenance.

### Tests

- Backend : 85 tests dans `tests/test_outing_analysis.py` (13 ajoutés — balayage du
  listing et du hint, pré-résolution, non-régression des drapeaux qui doivent rester
  ouverts).
- Front : `outing-analysis-prompt.test.ts` (29 tests), `geoapp-outing-analyzer-agent.test.ts`
  verrouille le second marqueur de chaîne (`résolu depuis le listing`).

---

## LOT 8 — Géographie : distances, ordre de visite, coucher du soleil (livré le 2026-09-04)

Les coordonnées étaient en base depuis le début et n'atteignaient l'IA que sous forme de
texte, cache par cache. Le prompt système lui interdisait donc d'énoncer la moindre
distance — la seule règle du lot 1 qui interdisait quelque chose faute de l'avoir calculé.

| Apport | Correction | Fichiers |
|---|---|---|
| Étendue du lot | Centroïde, boîte englobante, écart maximal entre deux caches | `outing_geography.py` |
| Ordre de visite | Plus proche voisin lancé depuis chaque départ, puis 2-opt sur chemin ouvert ; `legs` avec distance d'étape et cumul | `outing_geography.py` |
| Groupes de marche | Lien simple sous 400 m : ce qui s'enchaîne à pied depuis un même stationnement | `outing_geography.py` |
| Coucher du soleil | NOAA transcrit, sans API ni dépendance ; lever, coucher, crépuscules civils, durée du jour, `polar_state` | `outing_sun.py` |
| Date de sortie | Vraie entrée utilisateur : picker (Aujourd'hui / Demain / Après-demain / saisie libre), `outing_date` dans le payload et le bundle | `outing-analysis-controller.ts`, endpoint, `build_analysis_bundle` |
| Rendu | Section « Géographie et lumière du jour », avant les fiches | `formatGeographySection` |
| Consignes au modèle | Règles 9 et 10 du prompt système, plan du rapport § 4 enrichi | `geoapp-chat-system-prompts.ts` |

### Quatre décisions à retenir

**Une mystery non résolue est écartée du calcul**, comme une cache sans coordonnées. Ses
coordonnées publiées sont un leurre placé jusqu'à trois kilomètres du vrai final : la faire
entrer dans un centroïde ou dans un ordre de visite reviendrait à calculer soigneusement
sur une donnée fausse. C'est le seul cas où un chiffre est pire que pas de chiffre. Elle
ressort dans `excluded` avec sa raison — le rapport doit pouvoir expliquer son absence de
l'ordre de visite, faute de quoi le lecteur y verra un oubli.

**Le multi-départ plutôt qu'un départ choisi.** Le glouton dépend beaucoup de son point de
départ, et aucun candidat n'était défendable (la première de la sélection ? la plus proche
du centre ?). À soixante points au maximum, le relancer depuis chacun coûte quelques
millisecondes et supprime la question. Le 2-opt qui suit défait les croisements que le
glouton s'inflige. Le résultat n'est pas optimal et le prompt ne le présente jamais comme
tel : `strategy` le nomme, et le prompt système invite à le réordonner selon les
contraintes horaires.

**Vol d'oiseau, dit trois fois.** Dans le champ (`crow_flies`), dans la section du prompt,
et dans une règle du prompt système. La confusion entre une distance à vol d'oiseau et une
distance de marche fausserait toute la planification, et c'est l'erreur qu'un modèle commet
spontanément.

**Le soleil se calcule, il ne se demande pas.** L'algorithme NOAA tient en cent lignes et
donne la minute aux latitudes tempérées : aucune raison d'appeler un service pour ça. Les
heures locales sont celles du poste — GeoApp tourne chez l'utilisateur, qui géocache dans
son fuseau — avec le décalage du jour de la sortie, donc heure d'été comprise, et les
heures UTC partent aussi pour le cas de l'étranger.

### Ce que la date de sortie changeait

`outingDate` existait dans le contrat du lot 2 et aucun appelant ne la passait : le titre
de session portait donc toujours la date du jour. Sans conséquence tant qu'elle n'était
qu'un libellé ; déterminante dès lors qu'elle décide de l'heure du coucher du soleil. Elle
est maintenant demandée avant le niveau de détail. Effet de bord assumé sur l'appariement
des sessions : deux analyses visant le même samedi partagent désormais la même
conversation, même préparées à deux jours d'intervalle — ce qui est le comportement voulu.

Une date illisible côté endpoint est **ignorée, pas rejetée** : elle ne pilote que le calcul
solaire, et refuser l'analyse entière pour une saisie fautive serait disproportionné.

### Tests

- Backend : `tests/test_outing_geography.py` (28 tests — haversine, exclusions, étendue,
  ordre de visite, groupes, éphémérides vérifiées contre l'almanach de Paris aux deux
  solstices et à l'équinoxe, cas polaires), plus 3 tests dans `test_outing_analysis.py`
  (parsing de `outing_date`, bundle vide).
- Front : `outing-analysis-prompt.test.ts` (39 tests) et `outing-analysis-controller.test.ts`
  (20 tests).

---

## LOT 9 — Estimation de temps déterministe (livré le 2026-09-04)

Le plan du rapport demandait depuis le lot 1 une section « Temps et priorisation », et la
grille d'analyse un repérage des « caches chronophages ». Aucune donnée chiffrée n'arrivait
pourtant jusqu'à l'IA : elle produisait donc des durées au fil du texte, incohérentes d'une
cache à l'autre — trente minutes pour une T4 ici, dix pour une T4 là, sans que rien ne les
distingue. Le lot applique à ces durées exactement le traitement que le lot 8 avait appliqué
aux distances : les calculer avant, avec la même grille pour tout le monde.

| Apport | Contenu | Fichiers |
|---|---|---|
| Temps sur place par cache | Base par type, étapes, D/T, marche annoncée, signaux, logs de recherche longue, questions sur place ; `components` détaille chaque terme | `outing_time_estimate.py` |
| Fourchette et confiance | `low_minutes` / `high_minutes` à ±20 / 30 / 50 % selon `confidence`, avec `confidence_reasons` | `outing_time_estimate.py` |
| Trajet de la sortie | Déduit de `geography.route` : marche sous 400 m, route au-delà, facteurs de détour et vitesses annoncés dans `assumptions` | `outing_time_estimate.py` |
| Budget | `on_site_minutes`, `travel`, `total_minutes`, retranchements proposés, caches les plus lourdes | `outing_time_estimate.py` |
| Branchement | `time_estimate` sur chaque entrée, `time_budget` sur le bundle, `stats.on_site_minutes` | `outing_analysis_service.py` |
| Rendu | Ligne « Temps sur place estimé » par fiche, section « Temps estimé » avant les fiches | `outing-analysis-prompt.ts` |
| Consignes au modèle | Règle 11 (ajuster, pas inventer), règle 9 amendée, plan du rapport § 3 et § 4 | `geoapp-chat-system-prompts.ts` |

### Cinq décisions à retenir

**Additif, jamais multiplicatif.** Chaque contribution est nommée et chiffrée dans
`components`, et le prompt la rend en clair : « base multi 15 + 2 étape(s) présumée(s) 20 +
terrain 3 12 ». C'est ce détail qui autorise le modèle à **corriger** le chiffre plutôt qu'à
le recopier ou à l'ignorer — il sait quel terme discuter quand le listing annonce six
étapes. Un produit de coefficients aurait donné le même total sans rien expliquer.

**Le temps sur place et le trajet sont deux choses.** L'estimation par cache commence
voiture garée et s'arrête au retour à la voiture ; le trajet est calculé une seule fois pour
la sortie. Confondre les deux est l'erreur la plus coûteuse d'un budget de journée, et elle
passerait inaperçue : la ligne de chaque fiche porte donc « (trajet exclu) ».

**Sur une mystery, la difficulté note l'énigme, pas la fouille.** Elle est résolue à la
maison. Le supplément de D y est ramené à 40 %, sans quoi une D5 déjà résolue coûterait une
heure sur le terrain. Symétriquement, les types sans conteneur à trouver (EarthCache,
virtuelle, webcam, événements) ignorent la difficulté : leur temps est celui de
l'observation.

**Une multi sans waypoint publié en présume deux étapes.** Les étapes se découvrent en
chemin : leur absence des waypoints est la norme, pas une exception. Sous-estimer une multi
est l'erreur la plus fréquente d'une préparation de sortie, et connaître le final ne réduit
pas ce plancher — les étapes qui y mènent existent toujours. Le prompt écrit « présumée(s) »
pour que le modèle sache que c'est là qu'il peut faire mieux.

**Les retranchements sont proposés, pas appliqués.** `already_found_minutes` et
`unsolved_mystery_minutes` sortent à part du total. Retirer d'office ces caches serait
décider à la place de l'utilisateur : refaire une multi avec quelqu'un est légitime, et une
mystery peut être résolue le soir même. Le rapport peut dire « 6 h 30, ou 5 h 15 si l'on
retire les deux déjà trouvées ».

### Ce que le lot 8 interdisait et que celui-ci autorise

La règle 9 défendait de convertir une distance à vol d'oiseau en durée « sans le dire ».
Elle est amendée plutôt que levée : la conversion existe désormais, mais elle est faite **une
seule fois, par GeoApp**, avec ses hypothèses écrites dans le prompt (45 km/h, détour
routier ×1,3, 3 min d'arrêt, marche à 3,5 km/h sous 400 m). Le modèle la reprend et n'en
fabrique pas d'autre. Une durée sans hypothèse ne se discute pas : elle se croit ou se
jette ; celle-ci se discute.

Sans ordre de visite calculable — une seule cache exploitable, ou aucune — `travel` vaut
`null` et le total le dit en toutes lettres. Un trajet inventé serait pire qu'un total
franc.

### Tests

- Backend : `tests/test_outing_time_estimate.py` (40 tests). Deux natures d'assertions y
  cohabitent volontairement : les **ordres** (une multi coûte plus qu'une traditionnelle,
  une T5 plus qu'une T1, une longue marche plus qu'une courte), qui sont la promesse du
  module et doivent tenir quel que soit le barème ; et quelques **valeurs** exactes, pour
  qu'un changement de barème se voie sans figer toute la grille. Plus 2 assertions dans
  `test_outing_analysis.py` (bundle vide).
- Front : 10 tests de plus dans `outing-analysis-prompt.test.ts`, dont la tolérance à un
  backend antérieur au lot 9 (ni `time_estimate`, ni `time_budget`).

### Limites assumées

- **Aucun dénivelé.** Le terrain et la marche annoncée en tiennent lieu, ce qui sous-estime
  une montée sèche et surestime un faux plat.
- **Aucune pause, aucun repas.** Le budget est un temps d'activité, jamais une durée de
  journée. Le prompt le dit, et le prompt système demande de le rappeler.
- **Le trajet part de la première cache.** Le point de départ utilisateur reste le point
  ouvert du lot 8 : tant qu'il n'existe pas, le trajet domicile → première cache n'est pas
  compté.
- **Le barème n'est pas paramétrable.** Constantes de module, comme les seuils de santé du
  lot 1. À exposer en préférences seulement si l'usage montre que les défauts ne conviennent
  pas.

---

## LOT 10 — Budget de tokens adaptatif (P1, livré le 2026-09-04)

**Le constat.** Le niveau de détail s'appliquait uniformément à toute la sélection. C'est le
mauvais découpage : l'information n'est pas répartie uniformément dans un lot de géocaches.
Une traditionnelle D1/T1 saine, trouvée la semaine dernière, n'a rien à dire que ses
attributs ne disent déjà — son listing coûte huit cents tokens pour confirmer qu'il n'y a
rien à confirmer. La T5 voisine, avec un drapeau `special_tool` NON RÉSOLU, ne se prépare
pas sans son texte. Un budget uniforme choisit donc **toujours mal** : trop cher pour les
unes, trop pauvre pour les autres.

### Ce qui change

| Avant | Après |
|---|---|
| `light` = aucun listing, `standard` = 1800 car., `full` = 4000, pour toutes les caches | Le niveau fixe la générosité de **deux paliers** ; le palier est décidé cache par cache |
| Aucun plafond en tokens | Plafond dur (`maxPromptTokens`, défaut 30 000) avec rétrogradation automatique |
| `estimateOutingPromptSize()` ne comptait que les données | Le prompt système et la policy sont comptés dans l'estimation |

### 10.1 Le palier, cache par cache

**Fichier (nouveau)** : `frontend/theia-extensions/zones/src/browser/outing-analysis-budget.ts`

`decideTier()` applique une table de règles pondérées. Une seule règle qui se déclenche
suffit à passer au palier `rich` — listing et logs ; sinon la cache reste `lean` :
attributs, hint, santé, temps estimé et matériel repéré par balayage, sans listing. Le
tableau des règles et de leurs poids est reproduit au § 31 de
`chat-ia-geoapp-technique.md`.

Les poids ne sont pas des probabilités : ils ne servent qu'à **ordonner les
rétrogradations** quand le plafond force à sacrifier des listings.

Deux choix explicites :

- **la mystery non résolue n'est pas un motif** : on n'ira pas, et son listing est le plus
  long et le moins exploitable du lot. Le rapport doit dire « résous-la d'abord », ce qu'il
  sait sans lire l'énigme ;
- **un drapeau déjà refermé par le balayage du lot 7 n'est pas un motif** non plus :
  l'objet est nommé, la question est close.

Le palier `lean` n'est acceptable que grâce à ce même lot 7 : le matériel nommé dans le
listing **complet** remonte de toute façon dans `gear_mentions_in_listing`.

### 10.2 Le plafond dur

`buildBudgetedOutingPrompt()` rend le prompt, l'estime prompt système compris, puis applique
des étapes de rétrogradation tant que le plafond est dépassé :

1. listing retiré des caches sans particularité (mode complet uniquement) ;
2. listing des caches signalées raccourci à 900 caractères ;
3. rétrogradation `rich → lean`, par priorité croissante ;
4. logs récents ramenés à 2 par cache ;
5. logs matériel ramenés à 4 ;
6. plus aucun log récent ;
7. un seul log matériel par cache signalée.

L'ordre suit une règle unique : **on sacrifie d'abord le redondant, jamais l'unique.** Le
listing part avant les logs parce que son matériel a déjà été extrait par balayage.
Attributs, santé, géographie et temps estimés ne sont jamais touchés : ils coûtent peu et
portent l'essentiel.

**Le plafond ne bloque pas.** S'il reste dépassé après toutes les étapes, `overBudget` passe
à vrai, l'utilisateur est averti et l'analyse part quand même. Refuser d'analyser après que
l'utilisateur a attendu la collecte serait le pire des deux mondes ; le levier restant —
réduire la sélection — lui est dit en clair.

### 10.3 La collecte demande le maximum

Le serveur ne connaît pas les paliers. `collectionOptionsForPlan()` lui demande donc les
réglages du palier le plus généreux, et la coupe par cache se fait à la rédaction du prompt.
C'est ce qui rend la rétrogradation possible **sans second aller-retour** — l'autre
solution, redemander le listing d'une cache après coup, coûterait un appel par cache.

Conséquence visible : le mode léger demande désormais 1200 caractères de listing au serveur,
là où il en demandait zéro. Le surcoût est un transfert localhost.

### 10.4 La section « Couverture des données »

Contrepartie obligatoire de la stratégie mixte, et règle 12 du prompt système. Sans elle,
une cache sans listing se lirait comme une cache dont l'information manque, alors que c'est
l'inverse : GeoApp l'a lue et n'y a rien trouvé qui change la préparation. La section écrit
cette différence, dit combien de caches ont reçu leur listing, et nomme les rétrogradations
subies. Elle disparaît quand `adaptiveBudget` est désactivé : il n'y a alors rien d'inégal
à expliquer.

### 10.5 Le prompt système dans l'estimation

`estimateOutingPromptSize(prompt, { systemPromptChars })` compte le message système — prompt
de l'agent **et** description de policy, qui partent dans la même requête. Le contrôleur le
mesure via `GeoAppChatPolicyService`, injecté pour cela seul.

`OutingPromptSize` distingue désormais `chars` (données), `systemPromptChars` et
`totalChars` ; `approxTokens` porte sur le total. L'estimation d'origine, en ignorant le
message système, sous-évaluait l'envoi de plusieurs milliers de tokens.

### Préférences ajoutées

| Préférence | Défaut | Rôle |
|---|---|---|
| `geoApp.outing.analysis.adaptiveBudget` | `true` | Palier décidé cache par cache ; faux pour revenir au régime uniforme |
| `geoApp.outing.analysis.maxPromptTokens` | `30000` | Plafond dur, prompt système compris ; `0` le désactive |

### Écart constaté à l'implémentation

- `OUTING_DETAIL_PRESETS` est **supprimé** au profit de `OUTING_TIER_PRESETS` : le premier
  n'avait plus de consommateur une fois le palier introduit, et son `light.listingChars = 0`
  décrivait un comportement qui n'existe plus.
- Le plafond par défaut (30 000 tokens) n'est presque jamais atteint sur une sortie
  ordinaire. Il vaut pour les grandes sélections en mode complet, là où le prompt devient
  plus cher que ce qu'il apporte.
- Aucune modification backend : le budget est entièrement une décision de rédaction.

### Limites assumées

- **Le ratio caractères/token reste une approximation** (3,6), et le prompt système mesuré
  est celui de la variante par défaut, pas d'une variante personnalisée par l'utilisateur.
  L'écart se compte en dizaines de tokens, là où ignorer le message système en coûtait
  quelques milliers.
- **Les poids des règles ne sont pas paramétrables** : constantes de module, comme les
  seuils de santé du lot 1 et le barème du lot 9.
- **Aucune boucle de retour depuis le modèle** : si le rapport se plaint d'un listing
  manquant, rien ne le renvoie le chercher. La règle 12 du prompt système est le seul
  garde-fou, et il est textuel.

---

## Points laissés ouverts (hors périmètre, à traiter plus tard)

- ~~**Rafraîchissement global des logs** avant analyse~~ : traité par le lot 17. Le point
  d'accroche n'a finalement pas été `without_local_logs` — il arrive trop tard — mais un
  pré-vol dédié, interrogé entre le choix du niveau de détail et la collecte du bundle.
  L'avertissement issu de `without_local_logs` reste, en filet : il porte l'action
  « Rafraîchir et relancer » quand rien n'a été rafraîchi en amont.
- **Point de départ de l'itinéraire** : le chemin est ouvert et part de la cache que
  l'heuristique retient. Un point de départ utilisateur (domicile, parking, position
  actuelle) fermerait la boucle et donnerait un vrai kilométrage de journée.
- **Distances routières** : tout est à vol d'oiseau. Un calcul de trajet réel supposerait un
  service externe, ce que la fonctionnalité évite jusqu'ici.
- ~~**Persistance du rapport**~~ : traité par les lots 11 à 16 (table `outing_plan`,
  panneau cochable, badges, export Markdown). L'écriture en note GeoApp par cache reste
  écartée : ces notes repartiraient dans le bundle de la prochaine analyse.
- **Seuils de santé configurables** : constantes de module au lot 1 ; les exposer en
  préférences seulement si l'usage montre que les défauts ne conviennent pas.

---

## LOT 11 à 16 — Sortie exploitable hors chat (2026-09-04)

> **Livré.** Le rapport ne vit plus seulement dans la conversation : il est capturé,
> stocké, cochable, exporté, et il alimente des badges dans les deux tables de géocaches.
> Documentation de référence : § 33 de `chat-ia-geoapp-technique.md`.

### Le problème

Le rapport était un beau texte dans un chat. On ne le relit pas devant son sac, on ne coche
rien, il ne remonte nulle part, et il disparaît avec la conversation. Tout le travail
déterministe des lots 1 à 10 finissait donc dans un artefact volatil.

### Les décisions structurantes

**1. Deux voies de capture, volontairement redondantes.** Le prompt système (règle 14)
demande au modèle **et** d'appeler le tool `save_outing_plan`, **et** de terminer par un
bloc ```json. Ce n'est pas une ceinture-bretelles paresseuse : les deux voies ne portent pas
la même chose et n'échouent pas dans les mêmes cas.

| | Tool `save_outing_plan` | Bloc JSON en fin de réponse |
|---|---|---|
| Structure | oui, schéma typé | oui, format libre à valider |
| Texte rédigé | **non** | oui (toute la réponse est lue) |
| Échoue si | le modèle l'oublie, la policy le retire | la génération est coupée |
| Coût | une confirmation Theia (profil `guided`) | quelques centaines de tokens |

La seconde voie est donc aussi celle qui **attache le rapport rédigé**, que le tool ne peut
pas transmettre. Quand le plan est déjà là et que la réponse n'a pas de bloc, seul le texte
est attaché (`PATCH /api/outing-plans/<id>` avec `markdown`).

Les deux écritures visent la même clé `(zone_name, outing_date)` : la seconde remplace la
première au lieu de la doubler.

**2. L'identité de la sortie n'est jamais demandée au modèle.** Zone, date et liste de codes
GC sont connues de façon certaine côté front au moment où l'analyse est lancée. Le
contrôleur les enregistre dans `OutingPlanCaptureService` **avant** d'ouvrir la session ;
la capture les retrouve. `outing_date` reste un paramètre facultatif du tool, utilisé
uniquement pour départager deux analyses lancées coup sur coup.

Sans cette règle, une recopie approximative du modèle rangerait un plan sous la mauvaise
date — une erreur parfaitement silencieuse.

**3. Le serveur normalise, il ne rejette presque jamais.** `outing_plan_schema.py` ramène
tout à une forme fixe : énumération inconnue → défaut le plus prudent, `minutes` en chaîne →
entier borné, code GC illisible → écarté, lignes de checklist en double → fusionnées en
gardant la certitude la plus forte. Chaque coupe part dans `warnings`. Le seul refus est le
plan vide (ni checklist, ni alerte, ni détail par cache) : le stocker ferait croire à une
analyse aboutie.

Motif : le rapport est déjà sous les yeux de l'utilisateur dans le chat. Rejeter la capture
ne lui rend aucun service, alors qu'une checklist amputée en rend un.

**4. Les drapeaux par cache sont dérivés, pas seulement recopiés.** Une alerte `blocking` sur
GCXXXX vaut drapeau `blocking` sur GCXXXX, que le modèle ait pensé ou non à le répéter dans
`per_cache` ; du matériel listé vaut `gear_required`. Les badges des tables lisent ces
drapeaux : les faire dépendre de la discipline du modèle les rendrait intermittents, ce qui
est pire qu'absents.

**5. L'état coché survit à une relance d'analyse**, pour les lignes dont la clé n'a pas
bougé. La clé est le slug du libellé (`normalize_key()` côté Python, `normalizeChecklistKey()`
côté TypeScript, testés pour coïncider). Une reformulation du modèle perd la coche : c'est le
prix d'une clé lisible, et la perte est visible plutôt que silencieuse.

**6. Le tool est déclaré `local_write`, sans tricher.** Il écrit en base ; sous le profil
`guided` (le défaut) il passe donc par une confirmation Theia, avec l'option « toujours
autoriser » au premier appel. Le déclarer `read_only` pour éviter un clic viderait de son
sens la colonne « écrit en local » du panneau Policy.

**7. Les badges disent qu'ils viennent d'un modèle.** L'infobulle nomme la sortie d'origine
et sa date. Un badge « santé risquée » lu comme un calcul GeoApp serait plus trompeur que
pas de badge du tout — d'autant que le log-editor affiche ces badges longtemps après
l'analyse.

**8. Deux documents Markdown, pas un.** Le **rapport rédigé** (`plan.markdown`) est le texte
du modèle : il argumente, il cite ses sources, on le relit la veille. La **fiche de sortie**
est générée depuis la structure : elle porte les cases cochées, ce que le texte ne peut pas
faire, et c'est elle qu'on emporte. Son pied nomme l'analyse, sa date, son modèle, et
rappelle que les recommandations viennent d'un modèle.

### Écarté

- **Note GeoApp par cache** (le `per_cache` écrit en note système sur chaque géocache) :
  écarté à la demande. Ces notes repartiraient dans le bundle de la prochaine analyse, et
  l'IA relirait sa propre sortie comme une source utilisateur. Le faire supposerait de les
  filtrer à la collecte — un travail réel, pour un gain qui n'est pas celui du chantier.
- **Note de zone** : le modèle `Note` de GeoApp est attaché à une géocache, pas à une zone.
  La table `outing_plan` joue ce rôle, avec une clé métier qui lui est propre.

### Fichiers

| Lot | Fichiers |
|---|---|
| 11 | `outing_plan_schema.py`, `OutingPlan` dans `models.py`, `blueprints/outing_plans.py`, `migrations/versions/add_outing_plan_table.py`, `tests/test_outing_plans.py` (39 tests) |
| 12 | `outing-plan-types.ts`, `outing-plan-service.ts`, `outing-plan-capture.ts`, `outing-plan-tools-manager.ts`, `outing-plan-response-observer.ts`, contrat `GeoAppChatResponseObserver` dans `geoapp-chat-shared.ts` + câblage dans `geoapp-chat-bridge.ts`, règle 14 et bloc de sortie dans `geoapp-chat-system-prompts.ts`, entrée de catalogue, `tests/outing-plan-capture.test.ts` (25 tests) |
| 13 | `outing-plan-widget.tsx`, `style/outing-plan.css`, `outing-plan-notification-contribution.ts`, commande `geoapp.outing.plan.open` |
| 14 | Colonne `outing_flags` de `geocaches-table.tsx`, badges dans `log-editor/geocaches-table.tsx`, alimentation par `zone-geocaches-widget.tsx` et `geocache-log-editor-widget.tsx` |
| 15 | `outing-plan-markdown.ts`, boutons d'export du panneau, `tests/outing-plan-markdown.test.ts` (9 tests) |
| 16 | § 33 de `chat-ia-geoapp-technique.md`, ce bloc |

### Limites assumées

- **Le bloc JSON coûte des tokens de sortie** : quelques centaines, redondants avec le tool
  quand les deux fonctionnent. C'est le prix de la robustesse, et il est payé en sortie, où
  le budget du lot 10 ne s'applique pas.
- **Le panneau ne relit pas la conversation** : si ni le tool ni le bloc n'aboutissent, il
  n'y a pas de plan, et le rapport reste consultable dans le chat seulement. Aucun bouton
  « repêcher manuellement » n'a été fait.
- **Le cache des drapeaux est par session front** : il est vidé à chaque écriture de plan,
  mais un plan écrit depuis une autre fenêtre ne rafraîchit pas les badges de celle-ci.
- **La recherche par code GC balaie les 50 plans les plus récents** en Python : `gc_codes`
  est du JSON en colonne texte, que SQLite ne sait pas indexer. À l'échelle attendue (des
  dizaines de plans), c'est sans effet mesurable.
