# Scoring — Documentation technique

> Moteur d'évaluation des sorties de plugins (décodage, brute-force, metasolver).
> Classe les candidats décryptés par vraisemblance linguistique et présence de coordonnées GPS.
> Dernière mise à jour : juillet 2026 (v3.2 — après recalibrage T1–T6)

---

## 1. Vue d'ensemble

Le scoring est une **source de vérité centralisée** qui attribue un score `[0, 1]` à chaque sortie texte d'un plugin. Il sert à :

- **Trier** les résultats d'un plugin (notamment en bruteforce, où des milliers de candidats sont produits).
- **Filtrer** les sorties manifestement incorrectes (charabia, encodage résiduel).
- **Comparer** les résultats de plugins différents (metasolver, résolution de workflow).

Priorités par ordre de conception :

1. **Coordonnées GPS** — objectif final d'une géocache ; doivent primer sur tout texte en clair.
2. **Texte en langage naturel** — déchiffrement valide dans une des 8 langues supportées.
3. **Fragments de coordonnées écrits en chiffres ou en lettres** — fréquents dans les énigmes géocaching.
4. **Rejet du charabia** — encodage résiduel, bruit aléatoire, texte répétitif.

---

## 2. Localisation du code

```
backend/gc_backend/plugins/scoring/
├── scorer.py           # Moteur principal (score_text, score_and_rank_results)
├── langid.py           # Détection de langue par trigrammes
├── resources_loader.py # Chargement des ressources (LRU cache)
└── resources/
    ├── stopwords/          # stopwords.<lang>.json (8 langues)
    ├── geo_terms/          # geo_terms.<lang>.json (8 langues)
    ├── langid_trigrams/    # <lang>.json — ~28 trigrammes fréquents par langue
    ├── common_words/       # common_words.<lang>.json — ~26 000 mots classés par fréquence (wordfreq)
    └── quadgrams/          # <lang>.json — log10-prob de quadgrammes (8 langues)

backend/scripts/
├── generate_common_words.py   # Outil de génération (wordfreq, build-time)
└── generate_quadgrams.py      # Outil de génération (wordfreq ; bigrammes en repli)

backend/tests/
├── test_scoring_calibration.py              # Suite de calibration (contraintes d'ordre)
├── test_scoring_api.py                      # Tests unitaires (valeurs absolues)
└── fixtures/scoring_calibration_cases.json  # Jeu de cas par catégorie
```

Le blueprint Flask (`blueprints/plugins.py`) appelle `score_and_rank_results()` ; le moteur n'a aucune dépendance Flask.

---

## 3. Ressources

### 3.1 Langues supportées

`DEFAULT_LANGS_EUROPE = ['fr', 'en', 'de', 'es', 'it', 'nl', 'pt', 'pl']`

Toutes les ressources existent pour ces 8 langues.

### 3.2 Chargement

`resources_loader.py` charge chaque fichier **une seule fois** grâce à `@lru_cache` et le garde en mémoire process. Aucune lecture disque en cours de traitement.

| Fonction | Cache | Usage |
|---|---|---|
| `load_stopwords(lang)` | LRU 256 | Lexical features |
| `load_geo_terms(lang)` | LRU 256 | Lexical features + bonus geo |
| `load_common_words(lang)` | LRU 256 | Lexical features (~26 000 mots) |
| `load_common_word_ranks(lang)` | LRU 256 | Segmentation (mot → rang de fréquence) |
| `load_lang_trigrams(lang)` | LRU 256 | LangID |
| `load_quadgrams(lang)` | LRU 64 | Quadgram fitness |
| `available_quadgram_langs()` | LRU 1 | Liste des tables disponibles |

### 3.3 Génération des ressources (build-time)

Les ressources sont **versionnées dans le dépôt** et ne nécessitent pas `wordfreq` à l'exécution.

```bash
# Mots communs (8 langues)
python backend/scripts/generate_common_words.py

# Quadgrams, 8 langues (depuis wordfreq, 32–54 k entrées par langue)
python backend/scripts/generate_quadgrams.py --from-wordfreq --langs en fr de es it nl pt pl
```

Les tables de quadgrammes sont comptées sur un texte synthétique : 3 millions de mots tirés selon leur fréquence, collés sans espaces. Elles contiennent donc aussi les quadgrammes à cheval sur deux ou trois mots, que le scorer rencontre partout puisqu'il retire les espaces. Détail et historique dans `resources/quadgrams/README.md`. `wordfreq` s'installe dans un environnement à part, pas dans celui du backend.

---

## 4. Pipeline de scoring (score_text)

### 4.1 Vue d'ensemble

```
texte brut
    │
    ├─ Normalisation (NFKD / NFKC)
    │
    ├─ [Couche A] Garde-fous rapides
    │       A1 Indice de coïncidence (IC)
    │       A2 Entropie de Shannon
    │       A3 GPS gatekeeper + detect_gps_coordinates
    │       A4 Contexte géographique  →  gps_conf pondéré par la distance à la cache
    │
    ├─ [Couche B] Qualité n-grammes
    │       B1 LangID trigrammes  →  language, confidence, fitness
    │       B2 Quadgram fitness   →  best-of sur 8 tables
    │       B3 Répétition quality
    │
    ├─ [Couche C] Sémantique légère
    │       C0 Segmentation       →  espaces réinsérés dans les mots collés
    │       C1 Lexical coverage   →  vocabulaire réel (union 8 langues)
    │       C2 Coherence          →  plus longue séquence de mots reconnus
    │       C3 Numeric signal     →  structure coordonnées (densité + bonus)
    │       C4 Encoded penalty    →  paires hex / base64 / codes numériques
    │
    ├─ [Early-exit IC veto]       →  score 0.0 si IC trop faible et pas de GPS
    │
    ├─ [Combinaison noisy-OR]
    │       lang_score  = ngram*0.45 + lexical*0.35 + coherence*0.10
    │                   + ic_quality*0.07 + entropy_quality*0.03
    │       coord_score = max(gps_conf, numeric_signal * 0.85)
    │       score       = 1 − (1 − coord_score)(1 − lang_score*0.85)
    │
    ├─ Multiplicateur encoded_penalty
    ├─ [Early-exit ngram_low]     →  score 0.05 si aucun signal
    └─ clamp [0, 1]
```

### 4.2 Normalisation

Deux normalisations distinctes, appliquées selon le contexte :

**`_normalize_for_stats(text)`** — pour IC, quadgrams, répétitions :
- NFKD + suppression diacritiques → majuscules → garde uniquement `A-Z`

**`_tokenize_words(text)`** — pour lexical, numeric_signal :
- NFKC → minuscules → regex `[\w']+` → filtre `len >= 2`

**`_norm_lex_token(t)`** — pour comparer tokens au vocabulaire :
- NFKD + suppression diacritiques → minuscules
- Identique à la normalisation de `generate_common_words.py`, ce qui permet de matcher "TROUVE" avec "trouvé".

---

### 4.3 Couche A — Garde-fous rapides

#### A1 — Indice de coïncidence (IC)

Mesure la concentration des fréquences de lettres.

```
IC = Σ nᵢ(nᵢ−1) / n(n−1)
```

Valeurs de référence :
- Texte naturel anglais ≈ 0.065, français ≈ 0.074
- Substitution monoalphabétique : IC préservé (~0.065)
- Texte aléatoire : IC ≈ 0.038

Feature : `ic_quality = clamp((IC − 0.045) / 0.03, 0..1)`

**Early-exit IC veto** :
```
si nb_lettres ≥ 20 ET IC < 0.038 ET gps_conf < 0.7 ET numeric_signal < 0.3 → score = 0.0
early_exit = "ic_veto"
```

Le veto ne s'applique qu'à partir de 20 lettres (`_IC_VETO_MIN_LETTERS`, même borne que le scorer rapide) : sur une réponse courte (`PONT`, `SOUS LE BANC`), l'IC n'a pas de sens statistique — un mot aux lettres toutes différentes a un IC de 0.

#### A2 — Entropie de Shannon

Mesure la diversité des caractères (incluant ponctuation/espaces).

Feature `entropy_quality` par paliers :
| Entropie | Valeur |
|---|---|
| < 1.5 | 0.0 — texte trop uniforme |
| 1.5 – 4.6 | 1.0 — plage naturelle |
| 4.6 – 5.2 | 0.4 — légèrement trop élevée |
| > 5.2 | 0.1 — entropie maximale (bruit) |

#### A3 — Détection GPS

**Gatekeeper rapide** (`_gps_gatekeeper_fast`) — regex légères :
- Lettres cardinales `N/S` + `E/W`
- Lettres cardinales collées à leur nombre : `N48 … E002 …` (`\b[NS]\b` ne les voit pas, faute de frontière de mot entre lettre et chiffre)
- Mots directionnels écrits (`nord/north` + `est/east/ouest/west`)
- Symbole degré : `\d{1,3}[°º]`
- DMS avec apostrophes : `\d+°\d+'`
- Paire décimale : `48.1234, 2.3456`
- Paire compacte : `7 chiffres + 6-8 chiffres`

Si le gatekeeper passe → appel à `detect_gps_coordinates()` (blueprint coordinates).

`gps_conf` = `coords['confidence']` si `coords['exist']`, sinon `0.0`.

---

#### A4 — Contexte géographique (distance à la cache)

Le final d'une mystery se trouve à moins de 2 miles (3,2 km) de ses coordonnées publiées, et les autres types s'en éloignent rarement beaucoup. Quand l'appelant fournit les coordonnées de la cache, `gps_conf` est pondéré par la distance entre la cache et les coordonnées détectées (`_apply_geo_context`) :

| Distance | Statut | Effet sur `gps_conf` |
|---|---|---|
| ≤ 3,3 km | `near` | relevé : 60 % du doute restant est retiré (0.95 → 0.98, 0.80 → 0.92) |
| ≤ 25 km | `plausible` | inchangé |
| ≤ 80 km | `far` | × 0.85 |
| ≤ 200 km | `very_far` | × 0.60 |
| au-delà | `implausible` | × 0.35 |

Un mauvais déchiffrement qui *ressemble* à des coordonnées tombe en général à des centaines de kilomètres : il passe ainsi sous un vrai texte clair au lieu de prendre la tête du classement. Il n'est pas éliminé (une bonus ou une challenge peut être loin) : avec le signal numérique, il reste vers 0.43.

**Origine** — lue dans le `context` par `_origin_from_context`, qui accepte :
- `origin_coords` : chaîne DDM (`"N 48° 51.234 E 002° 21.456"`) ou dict `{ddm_lat, ddm_lon}` ;
- `origin_latitude` / `origin_longitude` : décimaux.

Toute origine absente ou illisible est ignorée sans erreur (les plugins passent des contextes arbitraires). L'origine, arrondie à 5 décimales, entre dans la clé du cache LRU.

**D'où vient-elle** :
- `/api/plugins/<nom>/execute` : `inputs.origin_coords`, que le frontend injecte déjà en mode géocache ; à défaut, la géocache désignée par `inputs.geocache_id` (ses coordonnées d'origine si elles ont été corrigées).
- `/api/plugins/score` : `context.origin_coords`, ou `geocache_id` / `origin_coords` à la racine du body.
- Metasolver : `inputs.origin_coords`, transmis au rescoring final.

L'origine est aussi transmise au détecteur, ce qui lève l'ambiguïté du `O` (Ouest ou « Ost », voir [coordonnees-technique.md](coordonnees-technique.md)).

Le résultat est exposé dans `metadata.scoring.geo` : `{distance_km, status, gps_confidence_raw}`, ou `null` sans origine ou sans coordonnées détectées. Les coordonnées écrites en toutes lettres passent par le signal numérique et n'ont pas de position calculable ici : l'origine ne les affecte pas.

---

### 4.4 Couche B — Qualité n-grammes

#### B1 — LangID trigrammes (`langid.py`)

Profils légers : ~28 trigrammes les plus fréquents par langue.

Algorithme :
1. Normalisation NFKC, minuscules, ponctuation → espaces.
2. Extraction des trigrams (sans espace interne).
3. Pour chaque langue : `score = hits_uniques / min(total, 100)`.
4. Si meilleur score < 0.08 → `language = 'unknown'`.
5. Si `best − second < 0.02` → `confidence = best − second` (pénalité d'ambiguïté).

**Champ `fitness`** (ajouté v3.2) :
- `fitness = min(1.0, best)` — ratio brut **avant** pénalité d'ambiguïté.
- Utilisé par le scorer (au lieu de `confidence`) pour ne pas effondrer le signal n-grammes quand deux langues sont quasi à égalité (cas fréquent sur texte ASCII majuscules).

#### B2 — Quadgram fitness

Tables `{lang}.json` : `{ "ABCD": log10_prob, ... }`.

Algorithme (par langue) :
```
pour chaque fenêtre de 4 lettres :
    si quadgram connu → ajoute log10_prob
    sinon            → ajoute −6.0 (plancher)
mean_logp = total / windows
quadgram_fitness = clamp((mean_logp − (−5.4)) / ((−4.2) − (−5.4)), 0..1)
```

Les deux bornes (`_QUADGRAM_LOGP_NOISE`, `_QUADGRAM_LOGP_TEXT`) viennent d'une mesure sur 57 phrases réelles dans les 8 langues et leurs corruptions, meilleure table à chaque fois :

| Texte | `mean_logp` (5ᵉ – 95ᵉ centile) | Médiane |
|---|---|---|
| Texte réel | −4.54 … −3.71 | −4.10 |
| Mêmes lettres mélangées | −5.64 … −4.84 | −5.33 |
| Texte inversé | −5.47 … −4.46 | −5.17 |
| Mauvais décalage César | −6.00 … −5.53 | −5.88 |

Un texte réel obtient ainsi une fitness proche de 1, un mauvais déchiffrement proche de 0. L'ancienne formule, `(mean_logp + 6) / 4` plus 30 % de taux de quadgrammes connus, étalait cette bande étroite sur un quart de l'échelle : un texte réel lisait 0.6, des lettres mélangées 0.3.

Calculé dès 4 lettres (`_QUADGRAM_MIN_LETTERS`, une fenêtre suffit), pour que les réponses courtes gardent un signal n-grammes.

**Best-of multilingue** : le scorer essaie la langue détectée en premier, puis toutes les tables disponibles (`available_quadgram_langs()`). Le meilleur score est retenu. Textes espagnols ou italiens peuvent scorer via la table `fr` (quadgrammes romans partagés) — c'est linguistiquement normal.

**N-gram fitness** :
```
ngram_fitness = quadgram_fitness × repetition_quality
```

La fitness des trigrammes (au plus ~0.3, et dépendante de la longueur) n'entre plus dans le calcul : elle ne sert qu'à la détection de langue et reste dans les métadonnées (`trigram_fitness`).

#### B3 — Répétition quality

Pénalise les sorties artificiellement répétitives (ex : `AAAAAAAA BBBBBBBB`).

| Condition | Valeur |
|---|---|
| Plus long run ≥ 5 lettres identiques | 0.0 |
| Run = 4 | 0.2 |
| Run = 3 | 0.6 |
| Ratio lettres uniques < 0.12 | 0.2 |
| Ratio lettres uniques < 0.18 | 0.6 |
| Sinon | 1.0 |

---

### 4.5 Couche C — Sémantique légère

#### C0 — Segmentation des mots collés

Beaucoup de chiffrements rendent un texte sans espaces (`LACACHESETROUVEAUPIED`). Découpé comme un seul mot inconnu, il n'aurait aucun crédit lexical. Avant le calcul des features de mots, `_segment_glued_words` réinsère donc les espaces :

1. Chaque suite d'au moins 8 lettres qui n'est pas elle-même un mot connu est candidate (400 lettres au plus).
2. Elle est découpée contre le vocabulaire d'**une langue à la fois** (`_lang_vocabulary`, mots de 2 lettres et plus). Par programmation dynamique, on cherche le découpage de coût minimal : un mot coûte le logarithme de son rang de fréquence (un mot courant est bon marché), une lettre qu'aucun mot n'explique coûte plus cher que le mot le plus rare. On obtient ainsi « TROUVE AU » plutôt que « TROU VEAU », et « CACHE SE TROUVE » plutôt que « CACHES E TROUVE ». Les lettres inexpliquées restent en morceaux inconnus.
3. La **couverture** est la part de lettres dans de vrais mots, les mots de 2 et 3 lettres comptant pour 1/3 et 2/3 (ils apparaissent par hasard dans n'importe quelle soupe de lettres).
4. Le découpage de la meilleure langue n'est retenu que si la couverture atteint 0.70 (0.85 sous 16 lettres). Sinon le texte reste tel quel.

Le vocabulaire est pris langue par langue, et non mis en commun comme pour C1 : avec les mots courts de 8 langues réunis, presque n'importe quelle suite de lettres se laisserait découper.

Le texte découpé alimente `lexical_coverage`, `coherence` et `numeric_signal` — des coordonnées collées en toutes lettres (`NORDQUARANTEHUITDEGRES…`) atteignent ainsi le canal coordonnées. Les features de lettres (IC, n-grammes, GPS, pénalité « encodé ») lisent toujours le texte d'origine. Le résultat est exposé dans `metadata.scoring.segmented_text` et `segmentation_language` (casse et accents d'origine conservés).

Mesuré : un mauvais décalage César n'est jamais découpé (0 sur 450), une soupe de lettres aux fréquences naturelles l'est dans 0,1 à 0,3 % des cas. Coût : environ 0.7 ms pour un texte collé, contre 0.14 ms pour un texte espacé (résultats mis en cache par suite de lettres).

#### C1 — Lexical coverage (v3.2 — vocabulaire réel)

**Vocabulaire** : union de stopwords + common_words + geo_terms + _CW_NUMBER_WORDS pour les 8 langues (~170 000 formes), normalisé (accents retirés, `ß` → `ss`, `ł` → `l`…). Les `common_words` vont jusqu'au rang de fréquence 30 000 pour les mots de 5 lettres et plus, 12 000 pour 4 lettres et 4 000 pour 2 ou 3 lettres : les mots courts sont ceux qu'un charabia reconnaît par hasard (voir `resources/common_words/README.md`). Construit une seule fois (`@lru_cache(maxsize=1)`), **indépendant de la langue détectée** (LangID est peu fiable sur texte ASCII majuscules court).

```
ratio  = tokens_reconnus / tokens_total
lexical_base = ratio*0.7 + min(1, tokens_reconnus/8)*0.3
geo_bonus    = min(1, geo_terms_trouvés / tokens_total)
lexical      = min(1.0, lexical_base + geo_bonus*0.15)
```

**Coherence** : plus longue séquence de tokens *consécutifs* reconnus :
```
coherence = min(1.0, plus_long_run / 5.0)
```

> Avant v3.2 : `lexical` = densité brute de tokens (longueur), indépendant du vocabulaire. Gibberish César et texte valide obtenaient la même valeur (~0.8). Désormais le gibberish César obtient `lexical ≈ 0`, un texte valide `lexical ≈ 1`.

#### C2 — Numeric signal (v3.2 — fusion coord_words + number_richness)

Remplace les deux features précédentes (`coord_words` et `number_richness`) par une feature unifiée à **base plafonnée + bonus de structure**.

**Détection d'un token numérique** (`_is_number_token`) :
- Chiffres purs de 1–5 digits (hors binaire > 4 chars)
- Mots-nombres multilingues (`_CW_NUMBER_WORDS`)
- Composés allemands (`einundzwanzig` = `ein+und+zwanzig`)
- Les tokens mixtes alphanum (`6E`, `XJ12`) sont rejetés.
- Les séparateurs (`et`, `and`, `und`, `point`…) ne sont jamais comptés comme nombres.

**Mots-nombres ambigus** (`_CW_AMBIGUOUS_NUMBER_WORDS`) : `un`, `une`, `ein`, `eine`, `one`, `uno`, `una`… sont aussi des articles, et `tres`, `neuf`, `dos`, `once`, `elf`… des homographes une fois les accents retirés (« très », « pont neuf », « le dos »). Ils ne comptent comme nombres qu'à côté d'un nombre, directement ou à travers un séparateur (`vingt et un`, `one hundred`). La règle se propage : dans `uno punto dos tres`, `dos` et `tres` sont retenus de proche en proche. Sans cela, « un arbre et une pierre » passait pour un fragment de coordonnées.

**Formule** :
```
density = min(1.0, num_count / 8.0)
base    = 0.45 × density          ← plafonné à 0.45 pour les énumérations pures

bonus :
  + 0.20  si séparateur (point/virgule/komma/et/...) ENTRE deux nombres
  + 0.25  si direction (nord/north/...) ou lat/lon à 2 tokens au plus d'un nombre
  + 0.10  si unité réelle (degré/minute/seconde/...) adjacente à un nombre
  + 0.15  si groupes de chiffres plausibles DDM (_ddm_plausible)

numeric_signal = min(1.0, base + bonus)
```

Les bonus de structure exigent la proximité d'un nombre : un `et`, un `nord` ou un `minutes` ailleurs dans la phrase ne prouve rien. `est`, `sur` et `este` (`_CW_AMBIGUOUS_DIRECTIONS`) sont des mots courants (« la cache est à deux mètres ») et ne valent jamais direction à eux seuls ; de vraies coordonnées portent aussi `nord`/`sud`/`ouest` ou `lat`/`lon`.

Les dizaines 70/80/90 sont reconnues dans les 8 langues (`seventy`, `siebzig`, `settanta`, `setenta`, `zeventig`…), y compris `septante`/`huitante`/`octante`/`nonante` et les composés allemands (`einundneunzig`).

**`_ddm_plausible`** : au moins une valeur 0–90 (degrés) ET une valeur 0–59 ou un groupe de 3 digits (millièmes de DDM).

**Canal coordonnées unifié** :
```
coord_score = max(gps_conf, numeric_signal × 0.85)
```
La détection GPS formelle prime toujours (`×1.0` vs `×0.85`).

#### C3 — Encoded penalty

Détecte les sorties encore encodées (plugin qui n'a pas su décoder).

| Pattern | Couverture | Facteur |
|---|---|---|
| Base64 (bloc unique ≥ 20 chars, hors lettres d'une seule casse) | — | 0.10 |
| Paires hex `XX ` × ≥ 4 | > 60 % | 0.05 |
| Paires hex | 30–60 % | 0.20 |
| Codes numériques courts `\d{1,3} ` × ≥ 5 | > 60 % | 0.15 |
| Codes numériques | 30–60 % | 0.35 |
| Sinon | — | 1.0 |

Un bloc de lettres d'une seule casse (`LACACHESETROUVEAUPIED`, majuscule initiale admise) n'est pas du base64 mais du texte clair sans espaces, sortie courante des chiffrements : `_is_single_case_letters` l'exclut de la pénalité. Un vrai bloc base64 mélange casses, chiffres ou `+/=`.

Appliqué comme **facteur multiplicatif** sur le score final.
Si `encoded_penalty < 0.2` → `early_exit = "encoded_pattern"`.

---

### 4.6 Combinaison finale — Noisy-OR (v3.2)

Deux canaux **indépendants** combinés par noisy-OR :

```python
# Canal langue : moyenne pondérée normalisée (∑poids = 1.0 — ne peut pas saturer seule)
lang_score = (
    ngram_fitness * 0.45
    + lexical     * 0.35
    + coherence   * 0.10
    + ic_quality  * 0.07
    + entropy_quality * 0.03
)

# Canal coordonnées
coord_score = max(gps_conf, numeric_signal * 0.85)

# Noisy-OR : un signal fort dans un seul canal suffit
score = 1.0 − (1.0 − coord_score) × (1.0 − lang_score × 0.85)
```

Le facteur `0.85` plafonne un texte clair parfait à 0.85, juste sous le plus faible format de coordonnées formelles (0.90) : des coordonnées sont le but d'une géocache et doivent passer devant. Il laisse le texte clair dans la zone « bon » de l'interface, qui commence à 0.8 (`getScoreColor`).

**Early-exit ngram_low** (aucun signal du tout) :
```
si coord_score ≤ 0 ET ngram_fitness < 0.1 ET numeric_signal < 0.2 ET lexical = 0 → score = 0.05
early_exit = "ngram_low"
```

Un mot reconnu (`lexical > 0`) empêche le plancher : il garde son score lexical.

**Plages observées** après recalibrage :

| Catégorie | Score typique |
|---|---|
| Coordonnées GPS pures (DDM standard) | 0.90 – 0.96 |
| Fragments de coordonnées écrits | 0.93 – 0.97 |
| Phrase en clair (20 lettres et plus) | 0.65 – 0.85, médiane 0.83 |
| Réponse courte valide (1 à 3 mots) | 0.53 – 0.76, médiane 0.71 |
| Texte clair sans espaces, découpé par la segmentation | 0.78 – 0.98 |
| Texte clair sans espaces, non découpé (mot hors vocabulaire) | ≈ 0.42 |
| Énumération de nombres pure | 0.77 – 0.87 |
| Mi-déchiffré (moitié clair, moitié chiffré) | 0.29 – 0.37 |
| Texte inversé | 0.05 – 0.48, médiane 0.25 |
| Lettres mélangées | 0.05 – 0.44, médiane 0.14 |
| Mauvais décalage César | 0.05 – 0.35, médiane 0.05 |
| Charabia / encodé résiduel | 0.00 – 0.05 |

Mesuré sur 57 phrases réelles dans les 8 langues : le bon texte est toujours premier de ses 26 décalages César, avec un écart d'au moins 0.32 (médiane 0.61) sur le meilleur faux.

> **Avant v3.2** : combinaison additive avec poids ∑ = 2.85 plafonnés à 1.0. La majorité des catégories saturaient à 1.0, annulant toute discrimination.

---

## 5. Scorer rapide — score_text_fast

Pré-filtre léger pour les lots de bruteforce (coût ~0.03 ms vs ~0.2 ms pour le score complet, détection GPS comprise).

> Le « ~1–5 ms » historique du score complet venait des traces DEBUG du détecteur de coordonnées, désormais coupées par défaut (voir [coordonnees-technique.md](coordonnees-technique.md) §11, `GEOAPP_LOG_VERBOSE=coordinates` pour les réactiver).

**Fonctionnement** :
1. `encoded_penalty` — si < 0.1, retourne 0.0 immédiatement.
2. Normalisation → lettres A-Z.
3. Si < 4 lettres → tente `numeric_signal` (coordonnées pures) ; retourne 0 si < 0.3.
4. `_score_text_fast_cached(letters)` (LRU 4096) :
   - Répétition quality — retourne 0.0 si run ≥ 5.
   - IC — retourne 0.0 si IC < 0.035 et n ≥ 20.
   - Quadgram fitness best-of sur les 8 tables (`available_quadgram_langs()`).
   - Si fitness < 0.15 → score = fitness × 0.3.
   - Sinon : `score = fitness*0.75 + ic_norm*0.10 + rep*0.15`
5. Multiplicateur `encoded_penalty`.
6. Boost numérique léger : si score > 0.05 et `numeric_signal > 0.2` → `score += numeric_signal*0.15`.
7. Plancher coordonnées : si `_gps_structured_hint(text)` (lettre cardinale collée à un nombre, symbole degré, paire décimale ou paire compacte), le score ne descend pas sous `0.3 × encoded_penalty`. Le scorer rapide ne détecte pas les coordonnées ; ce plancher garantit que le scorer complet les verra (`N4851234 E00221456`, coordonnées entourées de bruit).

**Limites** :
- N'utilise pas le lexical (pas de dictionnaire).
- Sur une réponse d'un seul mot, la marge avec le meilleur mauvais candidat peut être mince (`BLANC` 0.65 contre 0.64) : c'est le scorer complet, avec son dictionnaire, qui tranche.

Écart correct/near-miss ≈ 0.6 depuis les tables de quadgrammes issues de wordfreq (≈ 0.24 avec les anciennes tables en/fr/de synthétisées depuis des bigrammes).

---

## 6. Orchestration — score_and_rank_results

Pipeline à 4 phases pour scorer un lot de résultats :

```
Phase 1 (si lot > top_k) — Fast reject
    score_text_fast() sur tous les items
    rejeter si fast_score < fast_reject_threshold (défaut 0.02)

Phase 2 — Tri par fast score
    garder les max(top_k × 3, 75) meilleurs candidats

Phase 3 — Scoring complet
    score_text() sur les survivants
    écrire result['confidence'] et result['metadata']['scoring']

Phase 4 — Filtre final + top-K
    rejeter si score < min_score (défaut 0.05)
    trier décroissant, retourner [:top_k]
```

Seuils de production (défauts dans `plugins.py`) :
- `min_score = 0.03`
- `fast_reject_threshold = 0.01`
- `top_k = 25`

---

## 7. API

### Score direct

```
POST /api/plugins/score
{"text": "LA CACHE SE TROUVE AU PIED DU GRAND ARBRE"}

→ {
    "score": 0.81,
    "metadata": {
        "scoring": {
            "score": 0.81,
            "early_exit": null,
            "language_detected": "unknown",
            "language_confidence": 0.07,
            "words_found": ["cache"],
            "segmented_text": null,
            "segmentation_language": null,
            "gps_patterns": [],
            "geo": null,
            "features": {
                "ic": 0.062,
                "ngram_fitness": 0.96,
                "lexical_coverage": 1.0,
                "coherence": 1.0,
                "numeric_signal": 0.0,
                "coord_score": 0.0,
                "encoded_penalty": 1.0,
                ...
            },
            "weights": { ... },
            "explanation": "lex=1.00 | coh=1.00"
        }
    }
}
```

`language_detected` vient du LangID par trigrammes, peu fiable sur une phrase courte en majuscules : il répond ici `unknown` pour une phrase française que les quadgrammes et le dictionnaire reconnaissent sans peine. `words_found` ne liste que les termes de géocaching (`geo_terms`).

### Intégration dans /execute

Quand `enable_scoring = true` (dans `plugin.json` ou dans `inputs`) :
- `result['confidence']` ← score centralisé
- `result['metadata']['plugin_confidence']` ← confidence native du plugin (audit)
- `result['metadata']['scoring']` ← détail complet

En mode `detect` : `confidence = 0.0` (ne doit pas polluer le tri).

---

## 8. Cache LRU

| Fonction | Cache | Clé |
|---|---|---|
| `_cached_score(text, origin)` | LRU 1000 | texte brut + origine (lat, lon) ou `None` |
| `_score_text_fast_cached(letters)` | LRU 4096 | lettres A-Z normalisées |
| `_all_known_words()` | LRU 1 | — (singleton) |
| `_all_geo_words()` | LRU 1 | — (singleton) |
| `available_quadgram_langs()` | LRU 1 | — (singleton) |
| `load_*(lang)` | LRU 64–256 | nom de langue |

`score_text()` retourne `copy.deepcopy(metadata)` pour éviter que l'appelant ne mute un dict partagé par le cache.

---

## 9. Tests de calibration

`backend/tests/test_scoring_calibration.py` — contraintes d'**ordre** (pas de valeurs absolues), résistant aux recalibrages.

| Classe | Assertion | État |
|---|---|---|
| `TestSanity` | Scores ∈ [0, 1] pour toutes catégories | ✅ |
| `TestCoordsBeatProse` | `pure_coords_min > correct_decrypt_max` | ✅ |
| `TestGarbageScoresLow` | encoded + gibberish < 0.15 | ✅ |
| `TestHalfDecryptMiddle` | half_decrypt entre charabia et texte clair | ✅ |
| `TestValidCasesSurviveRanking` | Aucun cas valide filtré par les seuils de prod | ✅ |
| `TestShortAnswers` | Réponse courte non vetoée, 1ʳᵉ d'un bruteforce César (écart ≥ 0.15) | ✅ |
| `TestGluedWords` | Mots collés non pénalisés « encodé », 1ᵉʳˢ d'un bruteforce César ; vrai base64 toujours < 0.15 | ✅ |
| `TestGluedWordSegmentation` | Texte collé découpé : lexical ≥ 0.75, score ≥ 0.55, écart ≥ 0.30 avec tout décalage César ; coordonnées collées ≥ 0.85 ; charabia et soupes de lettres non découpés | ✅ |
| `TestCorrectVsNearMiss.test_gap_full` | Écart correct/near-miss ≥ 0.30 | ✅ (~0.45) |
| `TestCorrectVsNearMiss.test_gap_fast` | Idem sur fast scorer | ✅ (~0.6) |
| `TestNumberEnumBelowWordCoords` | feature : enum ≤ 0.45, word_coords > enum | ✅ |
| `TestNumberEnumBelowWordCoords` | score final : enum < word_coords | ✅ |
| `TestNumericLookalikes` | Prose avec `un`/`et`/`est`/`très` : signal numérique ≤ 0.15 ; dizaines 70/80/90 : ≥ 0.6 | ✅ |
| `TestGeoContext` | Avec l'origine : coordonnées proches relevées, score décroissant avec la distance, coordonnées à 390 km sous un texte clair ; sans origine : rien ne change | ✅ |
| `TestScoreScale` | Phrase claire ≥ 0.8 (zone « bon » de l'interface), texte valide ≥ 0.5, prose ≤ 0.86 < coordonnées formelles, mauvais décalage César ≤ 0.40, fitness quadgrammes ≥ 0.7 / ≤ 0.1 | ✅ |
| `TestKnownWeakCoords` | Formats faibles ≥ 0.85 | ⚠️ xfail (1 format) |
| `TestMultilingualNgram` | 8 tables présentes, ngram > 0.3 par langue ; chaque table reconnaît sa langue mieux que les autres et décroche d'au moins 0.2 sur les mêmes lettres mélangées ; aucune entrée sous −6.0 | ✅ |
| `TestLangidFitnessDecoupling` | fitness ≥ confidence toujours | ✅ |

**Xfail documenté (non bloquant)** :
- `TestKnownWeakCoords` : paire décimale (`48.8566, 2.3522`), détectée mais notée 0.80, sous la cible de 0.85. Le format à lettre collée (`N48 51.234 E002 21.456`) est sorti de cette liste : il était bloqué par le gatekeeper, pas par le détecteur.

---

## 10. Limites connues

- **LangID léger** : sur texte court ou ASCII majuscules, les scores de langues proches (fr/en) sont quasi-identiques → `confidence ≈ 0`. Résolu en v3.2 par le champ `fitness` (ratio brut, avant pénalité d'ambiguïté).
- **Texte inversé ou mélangé court** : les 8 tables viennent de wordfreq et chacune reconnaît sa langue mieux que les autres, mais sur une réponse courte une ou deux fenêtres suffisent à faire la moyenne. Un texte court inversé ou aux lettres mélangées peut donc obtenir une fitness élevée par hasard (score rapide jusqu'à 0.9 dans les mesures) ; le score complet, avec son dictionnaire, le ramène sous 0.5.
- **Scorer rapide et casse mixte** : la levée de la pénalité base64 pour un texte collé en casse mixte dépend de la segmentation, que le scorer rapide ne fait pas. Dans un lot de plus de `top_k` candidats, un tel texte y reste pénalisé.
- **Translittération** : `ß`, `ł`, `œ`, `æ`, `ø`, `đ` sont translittérés partout — IC et quadgrammes (`_STATS_TRANSLITERATION`), dictionnaire (`_LEX_TRANSLITERATION`) — et dans les deux scripts de génération. Les quatre tables doivent rester identiques.
- **Vocabulaire** : quelques mots de terrain restent absents (`lierre`, `nichoir`, `gouttière`, `boulon`, `lavoir`), trop rares dans les corpus généraux. Une liste complémentaire propre au géocaching serait la suite naturelle (`geo_terms` ne compte qu'une quinzaine de mots par langue).
- **Coordonnées faibles** : depuis le Lot 4 de la refonte détection, `detect_gps_coordinates` reconnaît le **DMS à direction suffixe** (`48°51'24" N 2°21'27" E`, score ≥ 0.85) et la **paire décimale** (`48.8566, 2.3522`, détectée, score ≈ 0.80). Reste sous la cible : la paire décimale (0.80 < 0.85). Le format `N48 51.234 E002 21.456` atteint 0.96 depuis que le gatekeeper le laisse passer. Les minuscules (`n48 51.234 e002 21.456`) et le `O` de « Ouest » (`N48 51.234 O002 21.456`) sont reconnus depuis la normalisation des lettres cardinales du détecteur (voir [coordonnees-technique.md](coordonnees-technique.md)) et atteignent eux aussi 0.96.
- **Pré-filtre rapide et coordonnées** : le scorer rapide ne fait pas de détection GPS ; il se contente du plancher `_FAST_GPS_HINT_FLOOR` (0.3) pour les textes en forme de coordonnées. Des coordonnées écrites sans aucun chiffre structuré (lettres cardinales isolées, mots) n'en bénéficient pas.
- **Textes de 1 à 3 lettres** (`OUI`, `NON`) : le scorer rapide renvoie 0, donc ils sont écartés dès que le lot dépasse `top_k`. Ils sont de toute façon ambigus (`OUI` décalé de 10 donne `YES`).
- **Mots collés** : la segmentation (§ C0) dépend du vocabulaire. Un mot absent peut faire échouer le découpage ou laisser un morceau inconnu (`STAREGO DE BU` pour « dębu ») ; si la couverture passe sous le seuil, le texte retombe vers 0.20–0.34. Un texte collé en casse mixte (`LaCacheSeTrouve…`) n'est plus pris pour du base64 dès lors qu'il se découpe en vrais mots.
- **Tokens d'un seul caractère** : `_tokenize_words` les écarte, donc les lettres cardinales isolées (`N`, `E`) et les chiffres isolés ne contribuent pas au signal numérique. `N QUARANTE HUIT E DEUX` n'obtient que 0.17 de signal ; le `y` espagnol (`cuarenta y ocho`) est simplement ignoré.
- **`wordfreq`** : outil de génération uniquement, pas dans `requirements.txt`. Les JSONs générés sont versionnés dans le dépôt.

---

## 11. Historique des versions

| Version | Changements |
|---|---|
| **v3.0** | Pipeline initial : IC, entropie, GPS, langid, quadgrams (en/fr/de), coord_words, lexical, coherence |
| **v3.1** | + `number_richness`, + `encoded_penalty`, relaxation `coord_words` sans direction |
| **v3.2** | **T1** Suite de calibration · **T2** print→logger, cache simplifié · **T3** Lexical sur vocabulaire réel (wordfreq, 8 langues) · **T4** Fusion `coord_words`+`number_richness` → `numeric_signal` structurée · **T5** `langid.fitness` découplé + quadgrams es/it/nl/pt/pl · **T6** Combinaison noisy-OR deux canaux (remplace somme additive saturante) |
