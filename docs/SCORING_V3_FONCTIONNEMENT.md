# Scoring V3 — Fonctionnement (Backend)

## Objectifs

- Fournir une **confidence centralisée** (source de vérité backend) pour comparer/ordonner les résultats des plugins (notamment en **force brute**).
- Être **robuste** face aux sorties “bizarres” (bruit, chiffrement, répétitions, texte trop court).
- Être **rapide** (fail-fast + cache) et **reproductible** (ressources versionnées dans le repo).
- Être **adapté au géocaching**, où les sorties pertinentes contiennent souvent des **coordonnées**, parfois **écrites en toutes lettres**.

## Où se trouve le code

- Moteur scoring:
  - `gc-backend/gc_backend/plugins/scoring/scorer.py`
- LangID trigrammes:
  - `gc-backend/gc_backend/plugins/scoring/langid.py`
- Chargement ressources versionnées:
  - `gc-backend/gc_backend/plugins/scoring/resources_loader.py`
- API + intégration dans exécution plugins:
  - `gc-backend/gc_backend/blueprints/plugins.py`

## Contrat de sortie (format des résultats)

### Endpoint scoring (direct)

`POST /api/plugins/score`

- Requête:
  - `{"text": "...", "context": { ... }}`
  - ou `{"texts": ["...", "..."], "context": { ... }}`
- Réponse (cas `text`):
  - `{"score": <float 0..1>, "metadata": {"scoring": {...}}}`
- Réponse (cas `texts`):
  - `{"results": [{"score":...,"metadata":...}, ...]}`

### Intégration dans `POST /api/plugins/<name>/execute`

Quand le scoring est activé:

- La confidence finale (score centralisé) est écrite dans:
  - `results[*].confidence`
- La confidence native du plugin est conservée pour audit dans:
  - `results[*].metadata.plugin_confidence`
- Les détails du scoring sont stockés dans:
  - `results[*].metadata.scoring`

Cas particulier:

- En mode `detect`, la confidence est neutralisée:
  - `results[*].confidence = 0.0` (pour ne pas polluer le tri global)

## Activation du scoring

Le scoring dans `/execute` s’active si:

- Le plugin le supporte (dans `plugin.json`):
  - `"enable_scoring": true`
- Ou si l’appel `/execute` inclut:
  - `inputs.enable_scoring = true`

## Pipeline (couches A/B/C)

Le moteur implémente un pipeline simple “fail-fast” (early exit) + une fusion pondérée.

### Étape 0 — Normalisation / tokenisation

Utilisée par différents sous-modules:

- **Normalisation “stats”** (`_normalize_for_stats`):
  - NFKD, suppression des diacritiques
  - uppercase
  - conservation uniquement de `A-Z`
  - Sert à: IC, quadgrams, répétitions

- **Tokenisation mots** (`_tokenize_words`):
  - NFKC, lowercase
  - regex: `r"[\w']+"`
  - filtre tokens `len >= 2`
  - Sert à: lexical coverage, coord_words

### Couche A — Garde-fous rapides

#### A1) Indice de coïncidence (IC)

- Calcul: `_compute_ic(text)` sur lettres `A-Z`.
- Intuition:
  - Texte naturel / substitué → IC plus élevé
  - Bruit / aléatoire → IC plus bas

Feature dérivée:

- `ic_quality = clamp((ic - 0.045) / 0.03, 0..1)`

Early-exit “veto”:

- Si `ic < 0.045` **et** `gps_confidence < 0.7` → score final `0.0` et:
  - `metadata.scoring.early_exit = "ic_veto"`

#### A2) Entropie de Shannon

- Calcul: `_shannon_entropy` (sur texte brut normalisé NFKC).
- Feature `entropy_quality` (valeurs par paliers):
  - `entropy < 1.5` → 0.0
  - `1.5..4.6` → 1.0
  - `4.6..5.2` → 0.4
  - `> 5.2` → 0.1

#### A3) GPS gatekeeper + extraction coordonnées

Objectif: détecter rapidement si du texte ressemble à des coordonnées.

- Gatekeeper rapide (`_gps_gatekeeper_fast`):
  - présence de N/S et E/W
  - ou `north/nord` + `east/est/west/ouest`
  - ou motif degré `\d{1,3}\s*[°º]`

Si gatekeeper OK:

- Appel à `gc_backend.blueprints.coordinates.detect_gps_coordinates`.
- `gps_confidence` = `coords.confidence` si `coords.exist`.
- Les détails sont renvoyés dans `metadata.scoring.gps_*`:
  - `gps_patterns`: ex `[ddm]` si existant
  - `gps_source`: source du détecteur

### Couche B — Qualité “langue / structure” (n-grams + répétitions)

#### B1) LangID trigrammes (léger)

Fichier: `langid.py`

- Normalisation: NFKC, lowercase, ponctuation → espaces, espaces compactés.
- Extraction trigrams:
  - glissement sur la chaîne compactée
  - ignore trigrams contenant un espace
- Score par langue:
  - intersection `trigrams_du_texte` ∩ `profil_trigrams_langue`
  - `hits / min(total, 100)`
- Si `len(trigrams) < 8` → `unknown`
- Seuil “unknown”:
  - si best `< 0.08` → `unknown`
- Ajustement en cas d’ambiguïté:
  - si `best - second < 0.02` → confidence = `best - second`

Valeurs exposées:

- `language_detected`
- `language_confidence` (utilisée comme `trigram_fitness`)

#### B2) Quadgram fitness

- Calcul sur lettres A-Z.
- Table `quadgrams/<lang>.json` chargée via `load_quadgrams(lang)`.
- Fallback:
  - si table absente et `lang != 'en'`, tente `en`.

Algorithme:

- Pour chaque fenêtre de 4 lettres:
  - si quadgram connu: ajoute sa log-prob
  - sinon: pénalité fixe `-6.0`
- `mean_logp = total / windows`
- `hit_ratio = hits / windows`
- `fitness = clamp((mean_logp + 6.0) / 4.0, 0..1)`
- score final quadgrams:
  - `quadgram_fitness = min(1.0, fitness*0.7 + hit_ratio*0.3)`

#### B3) Pénalité de répétition

Objectif: éviter de sur-scoring des sorties type `AAAAAAAAAAAA`.

- Analyse du plus long run de lettre identique.
- Heuristiques:
  - run >= 5 → 0.0
  - run == 4 → 0.2
  - run == 3 → 0.6
- Sinon, check ratio de lettres uniques:
  - `< 0.12` → 0.2
  - `< 0.18` → 0.6
  - sinon → 1.0

Sortie:

- `repetition_quality` ∈ [0..1]

### Couche C — “sémantique légère” (lexical + cohérence + geocaching)

#### C1) Lexical coverage (stopwords + geo_terms)

- Charge:
  - `stopwords.<lang>.json`
  - `geo_terms.<lang>.json`
- Filtre tokens:
  - enlève directions basiques (`_STOPLIST_GEO`)
  - enlève stopwords
- Si tokens filtrés vides → 0

Calcul:

- `coverage = min(1.0, len(filtered)/12.0)`
- `geo_bonus = min(1.0, len(recognized)/len(filtered))`
- `lexical_coverage = min(1.0, coverage*0.8 + geo_bonus*0.6)`

Sorties:

- `lexical_coverage`
- `words_found` (geo_terms reconnus, max 50)

#### C2) Coherence factor

Heuristique “phrase plausible”:

- calcule la plus longue séquence de tokens de longueur >= 3
- `coherence = min(1.0, longest_run/5.0)`

#### C3) Feature géocaching: `coord_words`

But: détecter des coordonnées “en mots” (sans chiffres), très fréquentes en énigmes.

Détection:

- Normalisation tokens (suppression diacritiques) pour matcher `zéro/zero`, `degrés/degres`, etc.
- Présence d’un signal direction / lat-lon:
  - directions (`north/nord/...`) OU mots `latitude/longitude/...`
- Puis présence:
  - d’unités / séparateurs (`degrees/degres/grad`, `minutes`, `point/dot/virgule/...`)
  - OU d’un signal numérique suffisant (>= 4 tokens “nombre”)
- Les “nombres” sont détectés via:
  - chiffres (`\d`)
  - nombres en mots (listes FR/EN/DE/ES/PT/IT/NL/PL)
  - et un fallback minimal pour l’allemand composé

**Relaxation sans direction** (ajouté v3.1):

- Si aucun signal direction/latlon mais >= 3 mots-nombres + séparateur (`point`, `virgule`, `et`...) → score partiel (max 0.7)
- Si >= 5 mots-nombres sans séparateur → score partiel (max 0.5)
- Ceci permet de scorer des textes comme "vingt deux point quatre cent dix sept" qui n'ont aucun N/S/E/W

Sortie:

- `coord_words` ∈ [0..1]

#### C4) Pénalité de pattern encodé: `encoded_penalty`

But: détecter quand une sortie ressemble encore à du contenu encodé (paires hexadécimales, codes numériques, base64) — typiquement quand un plugin de chiffrement a à peine transformé l'entrée.

Détection:

- Base64: bloc de >= 20 caractères `[A-Za-z0-9+/=]` → pénalité 0.1
- Paires hex: `[0-9A-Fa-f]{2} ` répétées >= 4 fois → pénalité 0.05 à 0.2
- Codes numériques: `\d{1,3} ` répétés >= 5 fois → pénalité 0.15 à 0.35

Sortie:

- `encoded_penalty` ∈ [0..1] (1.0 = propre, < 0.2 = probablement encodé)
- Appliqué comme facteur multiplicatif sur le score final
- Si `encoded_penalty < 0.2` → `early_exit = "encoded_pattern"`

#### C5) Richesse numérique: `number_richness`

But: détecter les textes riches en mots-nombres ou chiffres, **indépendamment** des signaux directionnels (N/S/E/W). Complète `coord_words`.

En géocaching, un texte décodé contenant des mots-nombres (ex: "vingt deux point quatre cent dix sept") ou des suites de chiffres est extrêmement précieux — il représente probablement des composantes de coordonnées, des réponses d'énigmes, etc.

Détection:

- Mots-nombres: dictionnaire multilingue (même que `coord_words`)
- Chiffres purs: tokens de 1-5 chiffres (hors binaire > 4 chars)
- Séparateurs: `point`, `virgule`, `et`, etc.
- Tokens mixtes alphanum (ex: "6E", "XJ12") sont ignorés

Formule:

- `density = min(1.0, num_count / 8.0)`
- `ratio = (num_count + sep_count) / total_tokens`
- `sep_bonus = min(0.15, sep_count * 0.08)`
- `number_richness = density*0.55 + ratio*0.35 + sep_bonus`

Sortie:

- `number_richness` ∈ [0..1]

## Construction du score (fusion pondérée)

### Features finales

- `gps_confidence`
- `lexical_coverage`
- `ngram_fitness`
- `repetition_quality`
- `coord_words`
- `number_richness`
- `encoded_penalty`
- `coherence`
- `ic_quality`
- `entropy_quality`

### N-gram fitness combinée

- `trigram_fitness = language_confidence`
- `quadgram_fitness` via table quadgrams
- `ngram_fitness = min(1.0, trigram_fitness*0.5 + quadgram_fitness*0.7)`
- puis:
  - `ngram_fitness *= repetition_quality`

### Poids (actuels)

Poids utilisés dans `scorer.py`:

- `gps_confidence`: 0.80
- `ngram_fitness`: 0.40
- `number_richness`: 0.45
- `coord_words`: 0.35
- `lexical_coverage`: 0.30
- `coherence`: 0.20
- `ic_quality`: 0.15
- `repetition_quality`: 0.10
- `entropy_quality`: 0.10

Note: `encoded_penalty` n'est **pas** un poids additif — il est appliqué comme **facteur multiplicatif** sur le score total.

### Bonus / early-exit

#### Early-exit GPS “très fort”

- Si `gps_confidence > 0.9` ET `ic > 0.05`:
  - `score = 0.98`
  - `early_exit = "gps_strong"`

#### Early-exit IC veto

- Si `ic < 0.038` ET `gps_confidence < 0.7` ET `coord_words < 0.3` ET `number_richness < 0.2`:
  - `score = 0.0`
  - `early_exit = "ic_veto"`

#### Early-exit encoded pattern

- Si `encoded_penalty < 0.2` (après application multiplicative):
  - `early_exit = "encoded_pattern"`

Permet de rejeter immédiatement les sorties encore encodées (hex, base64, codes numériques).

#### Anti-aplatissement brute-force (ngram low)

Pour éviter de promouvoir du bruit quand rien n’est “linguistiquement plausible”:

- Si `gps_confidence <= 0.0` ET `ngram_fitness < 0.1` ET `coord_words < 0.2` ET `number_richness < 0.15`:
  - `score = 0.05`
  - `early_exit = "ngram_low"`

Note: les conditions incluent `coord_words` et `number_richness` pour **ne pas écraser** des sorties où les coordonnées/nombres sont écrites en toutes lettres.

#### Bonus GPS + lexical

- Si `gps_confidence > 0.7` ET `lexical_coverage > 0.3`:
  - `score += 0.2`

Puis:

- `score = min(1.0, score)`

## Métadonnées scoring (`metadata.scoring`)

Le moteur renvoie:

- `score`
- `early_exit` (`null`, `gps_strong`, `ic_veto`, `ngram_low`, `encoded_pattern`)
- `language_detected`
- `language_confidence`
- `words_found`
- `gps_patterns`, `gps_source`
- `features`: toutes les features numériques
- `weights`: poids utilisés
- `explanation`: chaîne compacte (ex: `GPS=0.92 | lang=fr (0.31) | lex=0.50 | coh=0.80`)

## Ressources versionnées (repo)

Dossier: `gc-backend/gc_backend/plugins/scoring/resources/`

- Stopwords:
  - `stopwords/stopwords.<lang>.json`
- Geo terms:
  - `geo_terms/geo_terms.<lang>.json`
- Profils LangID trigrams:
  - `langid_trigrams/<lang>.json`
- Quadgrams (log-probas):
  - `quadgrams/<lang>.json`

Chargement:

- `resources_loader.py` utilise `@lru_cache` pour éviter les relectures disque.

## Cache scoring (LRU)

Objectif: scorer vite quand un même texte apparaît souvent (ex: brute-force).

- `score_text()` calcule une clé:
  - `md5(normalized_text + '|' + sorted(context.items()))`
- Cache LRU en mémoire:
  - `_cached_score` avec `@lru_cache(maxsize=1000)`
- Important:
  - on renvoie `copy.deepcopy(metadata)` pour éviter que l’appelant ne mute un dict partagé par le cache.

## Notes / limites

- Le LangID trigrammes est volontairement **léger** (pas de fastText). Sur des textes courts, il peut renvoyer `unknown`.
- Les tables quadgrams peuvent être incomplètes: fallback `en` si absence.
- `coord_words` est une heuristique: elle vise à éviter les faux “5%” et à remonter les candidats plausibles en géocaching.
- `number_richness` est intentionnellement **indépendant** des signaux directionnels — il complète `coord_words` pour les cas sans N/S/E/W.
- `encoded_penalty` est volontairement agressif: une couverture hex > 60% donne un facteur 0.05 (≈ annulation du score).

## Debug & validation

- API:
  - `POST /api/plugins/score` et inspecter `metadata.scoring.features` + `early_exit`.
- Tests:
  - `gc-backend/tests/test_scoring_api.py` contient des cas GPS, bruit, répétitions, coordonnées en mots (FR/EN), mots-nombres sans direction, paires hex, base64, et codes numériques.

## Historique des versions

- **v3.0** — Pipeline initial (IC, entropy, GPS, langid, quadgrams, coord_words, lexical, coherence)
- **v3.1** — Ajout `number_richness`, `encoded_penalty`, relaxation `coord_words` sans direction
