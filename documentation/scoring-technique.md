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
    ├── common_words/       # common_words.<lang>.json — top-4000 mots (wordfreq)
    └── quadgrams/          # <lang>.json — log10-prob de quadgrammes (8 langues)

backend/scripts/
├── generate_common_words.py   # Outil de génération (wordfreq, build-time)
└── generate_quadgrams.py      # Outil de génération (bigrammes ou wordfreq)

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
| `load_common_words(lang)` | LRU 256 | Lexical features (top-4000 mots) |
| `load_lang_trigrams(lang)` | LRU 256 | LangID |
| `load_quadgrams(lang)` | LRU 64 | Quadgram fitness |
| `available_quadgram_langs()` | LRU 1 | Liste des tables disponibles |

### 3.3 Génération des ressources (build-time)

Les ressources sont **versionnées dans le dépôt** et ne nécessitent pas `wordfreq` à l'exécution.

```bash
# Mots communs (8 langues)
python backend/scripts/generate_common_words.py

# Quadgrams en/fr/de (depuis matrices de bigrammes intégrées, ~120 k entrées)
python backend/scripts/generate_quadgrams.py --langs en fr de

# Quadgrams es/it/nl/pt/pl (depuis wordfreq, ~15–22 k entrées attestées)
python backend/scripts/generate_quadgrams.py --from-wordfreq --langs es it nl pt pl
```

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
    │
    ├─ [Couche B] Qualité n-grammes
    │       B1 LangID trigrammes  →  language, confidence, fitness
    │       B2 Quadgram fitness   →  best-of sur 8 tables
    │       B3 Répétition quality
    │
    ├─ [Couche C] Sémantique légère
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
    │       score       = 1 − (1 − coord_score)(1 − lang_score*0.90)
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
si IC < 0.038 ET gps_conf < 0.7 ET numeric_signal < 0.3 → score = 0.0
early_exit = "ic_veto"
```

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
- Mots directionnels écrits (`nord/north` + `est/east/ouest/west`)
- Symbole degré : `\d{1,3}[°º]`
- DMS avec apostrophes : `\d+°\d+'`
- Paire décimale : `48.1234, 2.3456`
- Paire compacte : `7 chiffres + 6-8 chiffres`

Si le gatekeeper passe → appel à `detect_gps_coordinates()` (blueprint coordinates).

`gps_conf` = `coords['confidence']` si `coords['exist']`, sinon `0.0`.

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
hit_ratio = hits / windows
fitness   = clamp((mean_logp + 6.0) / 4.0, 0..1)
quadgram_fitness = min(1.0, fitness*0.7 + hit_ratio*0.3)
```

**Best-of multilingue** : le scorer essaie la langue détectée en premier, puis toutes les tables disponibles (`available_quadgram_langs()`). Le meilleur score est retenu. Textes espagnols ou italiens peuvent scorer via la table `fr` (quadgrammes romans partagés) — c'est linguistiquement normal.

**N-gram fitness combinée** :
```
ngram_fitness = min(1.0, trigram_fitness*0.5 + quadgram_fitness*0.7)
ngram_fitness *= repetition_quality
```

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

#### C1 — Lexical coverage (v3.2 — vocabulaire réel)

**Vocabulaire** : union de stopwords + common_words (top-4000) + geo_terms + _CW_NUMBER_WORDS pour les 8 langues, normalisé NFKD. Construit une seule fois (`@lru_cache(maxsize=1)`), **indépendant de la langue détectée** (LangID est peu fiable sur texte ASCII majuscules court).

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

**Formule** :
```
density = min(1.0, num_count / 8.0)
base    = 0.45 × density          ← plafonné à 0.45 pour les énumérations pures

bonus :
  + 0.20  si séparateur (point/virgule/komma/...)
  + 0.25  si direction (N/S/E/W/nord/north/...) ou lat/lon
  + 0.10  si unité réelle (degré/minute/seconde/...)
  + 0.15  si groupes de chiffres plausibles DDM (_ddm_plausible)

numeric_signal = min(1.0, base + bonus)
```

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
| Base64 (bloc unique ≥ 20 chars) | — | 0.10 |
| Paires hex `XX ` × ≥ 4 | > 60 % | 0.05 |
| Paires hex | 30–60 % | 0.20 |
| Codes numériques courts `\d{1,3} ` × ≥ 5 | > 60 % | 0.15 |
| Codes numériques | 30–60 % | 0.35 |
| Sinon | — | 1.0 |

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
score = 1.0 − (1.0 − coord_score) × (1.0 − lang_score × 0.90)
```

Le facteur `0.90` sur le canal langue garantit que les coordonnées pures (`coord_score ≈ 0.95`) l'emportent légèrement sur un texte en clair sans coordonnées (`lang_score × 0.9 ≈ 0.68`).

**Early-exit ngram_low** (aucun signal du tout) :
```
si coord_score ≤ 0 ET ngram_fitness < 0.1 ET numeric_signal < 0.2 → score = 0.05
early_exit = "ngram_low"
```

**Plages observées** après recalibrage :

| Catégorie | Score typique |
|---|---|
| Coordonnées GPS pures (DDM standard) | 0.90 – 0.95 |
| Fragments de coordonnées écrits | 0.79 – 0.95 |
| Texte en clair valide (fr/en/de/…) | 0.64 – 0.70 |
| Énumération de nombres pure | 0.75 – 0.78 |
| Near-miss (César +1 sur texte valide) | 0.15 – 0.20 |
| Charabia / encodé résiduel | 0.00 – 0.05 |

> **Avant v3.2** : combinaison additive avec poids ∑ = 2.85 plafonnés à 1.0. La majorité des catégories saturaient à 1.0, annulant toute discrimination.

---

## 5. Scorer rapide — score_text_fast

Pré-filtre léger pour les lots de bruteforce (coût ~0.05 ms vs ~1–5 ms pour le score complet).

**Fonctionnement** :
1. `encoded_penalty` — si < 0.1, retourne 0.0 immédiatement.
2. Normalisation → lettres A-Z.
3. Si < 4 lettres → tente `numeric_signal` (coordonnées pures) ; retourne 0 si < 0.3.
4. `_score_text_fast_cached(letters)` (LRU 4096) :
   - Répétition quality — retourne 0.0 si run ≥ 5.
   - IC — retourne 0.0 si IC < 0.035 et n ≥ 20.
   - Quadgram fitness best-of `{en, fr, de}` uniquement (les 3 tables denses).
   - Si fitness < 0.15 → score = fitness × 0.3.
   - Sinon : `score = fitness*0.75 + ic_norm*0.10 + rep*0.15`
5. Multiplicateur `encoded_penalty`.
6. Boost numérique léger : si score > 0.05 et `numeric_signal > 0.2` → `score += numeric_signal*0.15`.

**Limites** :
- N'utilise pas le lexical (pas de dictionnaire).
- Quadgrams seulement en/fr/de (pas es/it/nl/pt/pl).
- Écart correct/near-miss ≈ 0.24 (< 0.30 du scorer complet) — connu et documenté.

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
    "score": 0.68,
    "metadata": {
        "scoring": {
            "score": 0.68,
            "early_exit": null,
            "language_detected": "fr",
            "language_confidence": 0.31,
            "words_found": ["cache", "trouve", "grand", "arbre"],
            "gps_patterns": [],
            "features": {
                "ic": 0.071,
                "ngram_fitness": 0.62,
                "lexical_coverage": 0.94,
                "coherence": 1.0,
                "numeric_signal": 0.0,
                "coord_score": 0.0,
                "encoded_penalty": 1.0,
                ...
            },
            "weights": { ... },
            "explanation": "lang=fr (0.31) | lex=0.94 | coh=1.00"
        }
    }
}
```

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
| `_cached_score(text)` | LRU 1000 | texte brut |
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
| `TestCorrectVsNearMiss.test_gap_full` | Écart correct/near-miss ≥ 0.30 | ✅ (~0.45) |
| `TestCorrectVsNearMiss.test_gap_fast` | Idem sur fast scorer | ⚠️ xfail (~0.24) |
| `TestNumberEnumBelowWordCoords` | feature : enum ≤ 0.45, word_coords > enum | ✅ |
| `TestNumberEnumBelowWordCoords` | score final : enum < word_coords | ✅ |
| `TestKnownWeakCoords` | Formats faibles ≥ 0.85 | ⚠️ xfail (3 formats) |
| `TestMultilingualNgram` | 8 tables présentes, ngram > 0.3 par langue | ✅ |
| `TestLangidFitnessDecoupling` | fitness ≥ confidence toujours | ✅ |

**Xfails documentés (non bloquants)** :
- `test_gap_fast` : le fast scorer est un pré-filtre qui n'utilise pas le lexical. Cible aspirationnelle.
- `TestKnownWeakCoords` : formats DMS avec `"`, compact collé (`N48 51.234`), décimal (`48.8566, 2.3522`). Problème de **détection** dans `coordinates.py`, pas de scoring.

---

## 10. Limites connues

- **LangID léger** : sur texte court ou ASCII majuscules, les scores de langues proches (fr/en) sont quasi-identiques → `confidence ≈ 0`. Résolu en v3.2 par le champ `fitness` (ratio brut, avant pénalité d'ambiguïté).
- **Tables quadgrams wordfreq** : es/it/nl/pt/pl ont ~15–22 k entrées vs ~120 k pour en/fr/de (bigrammes). Un texte roman peut obtenir son meilleur score via la table `fr`. Le signal reste > 0.3 pour les 8 langues sur texte valide.
- **Coordonnées faibles** : DMS avec guillemets (`48°51'24" N`), compact collé (`N48 51.234`), décimal (`48.8566, 2.3522`) ne sont pas détectés par `detect_gps_coordinates`. Score partiel via `numeric_signal` seulement.
- **`wordfreq`** : outil de génération uniquement, pas dans `requirements.txt`. Les JSONs générés sont versionnés dans le dépôt.

---

## 11. Historique des versions

| Version | Changements |
|---|---|
| **v3.0** | Pipeline initial : IC, entropie, GPS, langid, quadgrams (en/fr/de), coord_words, lexical, coherence |
| **v3.1** | + `number_richness`, + `encoded_penalty`, relaxation `coord_words` sans direction |
| **v3.2** | **T1** Suite de calibration · **T2** print→logger, cache simplifié · **T3** Lexical sur vocabulaire réel (wordfreq, 8 langues) · **T4** Fusion `coord_words`+`number_richness` → `numeric_signal` structurée · **T5** `langid.fitness` découplé + quadgrams es/it/nl/pt/pl · **T6** Combinaison noisy-OR deux canaux (remplace somme additive saturante) |
