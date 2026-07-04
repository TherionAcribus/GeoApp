# Détection de coordonnées — Spécification des corrections

> Document de travail destiné à l'implémentation des corrections identifiées lors de
> l'audit de la détection de coordonnées (back + front + MetaSolver) de juillet 2026.
> Organisé en lots indépendants, par priorité décroissante. Chaque lot peut être
> implémenté et commité séparément.
>
> Conventions du dépôt : messages de commit en français au format
> `Domaine > description` (voir `git log`). Tests backend : `cd backend && python -m pytest tests/ -x -q`.

---

## Vue d'ensemble des lots

| Lot | Priorité | Contenu | Risque de régression |
|---|---|---|---|
| 1 | P0 | 4 bugs : `eval()`, `origin_coords`, toggle MetaSolver, `primary_coordinates` | Faible |
| 2 | P1 | MetaSolver : rescoring complet, factorisation execute/streaming | Moyen (bien testé) |
| 3 | P1 | Endpoint batch de détection + réécriture de la Phase 2 front | Moyen |
| 4 | P2 | Refonte table-driven des détecteurs, formats manquants, logging | Élevé (suite de tests à créer d'abord) |
| 5 | P3 | Ergonomie front (composant partagé, thème, préférences) | Faible |

Ordre recommandé : 1 → 2 → 3 → 4 → 5. Les lots 1–3 ne dépendent pas de la refonte du lot 4.

---

## LOT 1 — Bugs (P0)

### 1.1 Remplacer `eval()` par un évaluateur AST sûr

**Fichier** : `backend/gc_backend/blueprints/coordinates.py`, fonction `_evaluate_math_expression` (~ligne 540).

**Constat** : `result = eval(expression)` évalue une chaîne dérivée du champ `formula` reçu
par `POST /api/calculate_coordinates`. Exécution de code arbitraire possible.

**Cible** : un évaluateur basé sur `ast` qui n'accepte que l'arithmétique.

**Implémentation** :
1. Écrire une fonction `_safe_eval_arithmetic(expression: str) -> float` :
   - `tree = ast.parse(expression, mode='eval')` dans un `try/except SyntaxError`.
   - Parcours récursif du nœud : autoriser uniquement `ast.Expression`, `ast.BinOp`
     (opérateurs `Add`, `Sub`, `Mult`, `Div`), `ast.UnaryOp` (`UAdd`, `USub`),
     `ast.Constant` (int/float uniquement). Tout autre nœud (`Name`, `Call`,
     `Attribute`, `Pow`, etc.) → lever `ValueError`.
   - Note : la regex amont du parsing de formule (`[A-Z0-9()x*/+-]+`) ne permet que
     `+ - * / ( )` après remplacement de `x` par `*`. Interdire `Pow` est donc sans
     perte fonctionnelle et évite les bombes type `9**9**9`.
2. Dans `_evaluate_math_expression`, remplacer `eval(expression)` par
   `_safe_eval_arithmetic(expression)`. Conserver **exactement** le contrat de retour
   actuel : entier arrondi si proche d'un entier (tolérance 1e-10),
   `"ERR:NONINTEGER:{expression}"` si décimal, `"ERR:SYNTAX:{expression}"` si
   inévaluable (le `ValueError` de l'évaluateur tombe dans ce cas).

**Tests** (nouveau fichier ou ajout à un test existant sur `/api/calculate_coordinates`) :
- `(8/4)` → 2 ; `(3x2)` via `_process_formula_part` → 6 ; `8/3` → `ERR:NONINTEGER`.
- `__import__('os').system('echo pwned')` → `ERR:SYNTAX` (et rien d'exécuté).
- `9**9` → `ERR:SYNTAX` (Pow refusé).
- Test d'intégration : la formule d'exemple de la docstring
  `N48° 39.(8/4)(27/9)(2x2x2) E06°11.(3x2)(16x2/4)(25/5)` retourne
  `N48° 39.286 E006° 11.685` avec status `complete` (vérifier la valeur exacte
  attendue en exécutant avant/après — le comportement ne doit pas changer).

---

### 1.2 `origin_coords` : format invalide envoyé par le front

**Fichiers** :
- `frontend/theia-extensions/plugins/src/browser/plugin-executor-widget.tsx` (~ligne 793)
- `frontend/theia-extensions/plugins/src/browser/plugin-result-display.tsx` (~ligne 192)
- `backend/gc_backend/blueprints/coordinates.py` (endpoint `detect_coordinates_in_text`)

**Constat** : le front construit
```ts
{ ddm_lat: `N ${coordinates.latitude}`, ddm_lon: `E ${coordinates.longitude}` }
```
avec `latitude`/`longitude` **décimaux** (ex. `N 48.8566`). La regex backend
`DDM_COMPONENT_REGEX` attend degrés + minutes → le parse échoue silencieusement :
le calcul de distance et l'héritage des directions cardinales ne fonctionnent jamais
par ce chemin. De plus N/E sont codés en dur (hémisphère sud/ouest faux). Ailleurs
(`plugin-executor-widget.tsx` ~ligne 1177), `origin_coords` est passé comme **chaîne
brute** (`coordinatesRaw`) alors que `_detect_numeric_only_coordinates` attend un
dict `{ddm_lat, ddm_lon}` — le test `'ddm_lat' in origin_coords` sur une chaîne fait
une recherche de sous-chaîne et retourne False : là aussi no-op silencieux.

**Cible** : le backend accepte indifféremment un dict `{ddm_lat, ddm_lon}` **ou** une
chaîne DDM combinée (`"N 48° 39.286 E 006° 11.685"`), et le front envoie
`coordinatesRaw` tel quel.

**Implémentation** :
1. **Backend** — dans `coordinates.py`, ajouter une fonction de normalisation :
   ```python
   def _normalize_origin_coords(origin) -> Optional[Dict[str, str]]:
       """Accepte un dict {ddm_lat, ddm_lon} ou une chaîne DDM combinée."""
   ```
   - Si dict avec les deux clés non vides → retour tel quel.
   - Si chaîne → réutiliser la regex de découpage déjà présente dans
     `detect_gps_coordinates` (~ligne 1469) : `^([NS][^NSWE]+)[\s,]+([EW].+)$`
     (l'étendre pour accepter aussi une direction en fin si le lot 4 est fait).
   - Sinon → `None`.
2. Appliquer `_normalize_origin_coords` au tout début de
   `detect_coordinates_in_text` **et** de `detect_gps_coordinates` (paramètre
   `origin_coords`), pour couvrir aussi les appels internes (batch, scorer).
3. **Front** — dans `detectCoordinatesInResults`
   (`plugin-executor-widget.tsx` ~ligne 793) : remplacer la construction
   `N ${latitude}` par l'envoi direct de
   `config.geocacheContext?.coordinates?.coordinatesRaw` (chaîne). Adapter le type de
   `originCoords` dans `plugins-service.ts` : `originCoords?: string | { ddm_lat: string; ddm_lon: string }`.
4. Même correction dans `plugin-result-display.tsx` (~ligne 192) qui construit le
   même objet fautif.

**Tests** :
- Backend : `_normalize_origin_coords("N 48° 39.286 E 006° 11.685")` →
  `{ddm_lat: "N 48° 39.286", ddm_lon: "E 006° 11.685"}` ; dict passthrough ; `"S 33° 51.123 W 151° 12.456"` conserve S/W ;
  chaîne invalide → None sans exception.
- Intégration : `POST /api/detect_coordinates` avec `text` numérique pur,
  `include_numeric_only: true` et `origin_coords` en chaîne S/W → le résultat hérite
  de S et W.

---

### 1.3 MetaSolver : le toggle `detect_coordinates` est ignoré

**Fichier** : `plugins/official/metasolver/main.py`, `_build_additional_inputs` (~ligne 866).

**Constat** :
```python
if "detect_coordinates" in input_types:
    extras["detect_coordinates"] = True
```
force `True` quel que soit le choix utilisateur, et `plugin_inputs.update(extras)`
écrase la valeur correcte déjà présente dans `request_payload`.

**Cible** : propager la valeur utilisateur.

**Implémentation** :
1. Ajouter un paramètre `detect_coordinates: bool = True` à
   `_build_additional_inputs` et l'utiliser :
   ```python
   if "detect_coordinates" in input_types:
       extras["detect_coordinates"] = detect_coordinates
   elif "enable_gps_detection" in input_types:
       extras["enable_gps_detection"] = detect_coordinates
   ```
2. Mettre à jour les **deux** appelants : `_run_one` dans `execute()` (~ligne 185) et
   `_run_streaming` dans `execute_streaming()` (~ligne 444). (Si le lot 2.2 est fait
   d'abord, il n'y a plus qu'un appelant.)

**Tests** : dans `backend/tests/` (à côté de `test_metasolver_keys.py`), un test qui
mocke `plugin_manager.execute_plugin`, appelle le metasolver avec
`detect_coordinates=False` et vérifie que chaque sous-plugin reçoit
`detect_coordinates=False` / `enable_gps_detection=False`.

---

### 1.4 `primary_coordinates` non déterministe en streaming

**Fichier** : `plugins/official/metasolver/main.py`, `execute_streaming` (~ligne 523).

**Constat** : en streaming, `primary_coordinates` est fixé au **premier plugin qui
termine** (ordre d'achèvement des threads → non déterministe). En mode `execute()`,
les résultats sont réordonnés par priorité avant la sélection. Deux exécutions
identiques peuvent donc retourner des coordonnées primaires différentes selon le mode
ou le hasard d'ordonnancement.

**Cible** : règle unique et déterministe dans les deux modes : parcours des plugins
réussis **dans l'ordre de priorité des candidats**, première coordonnée trouvée.

**Implémentation** :
1. Dans `execute_streaming`, supprimer l'affectation de `primary_coordinates` dans la
   boucle de drainage. Après la boucle (avant la construction de `response`),
   recalculer :
   ```python
   primary_coordinates = None
   for candidate in candidates:  # déjà triés par priorité
       entry = combined_results.get(candidate["name"])
       if entry and entry.get("coordinates"):
           primary_coordinates = entry["coordinates"]
           break
   ```
   Attention : conserver aussi la source `result.get("primary_coordinates")` des
   sous-plugins — stocker cette valeur dans `combined_results[plugin_name]` au moment
   du traitement (clé `_sub_primary` ou fusion dans `coordinates`) pour pouvoir la
   retrouver ici, comme le fait `execute()`.
2. Aligner `execute()` sur la même fonction utilitaire (extraire
   `_pick_primary_coordinates(candidates, combined_results)`).

**Tests** : `backend/tests/test_metasolver_streaming.py` — ajouter un cas avec deux
sous-plugins mockés produisant chacun des coordonnées, avec des durées inversées
(le moins prioritaire termine en premier) → `primary_coordinates` doit venir du plus
prioritaire, en streaming comme en non-streaming.

---

## LOT 2 — MetaSolver : qualité et dette (P1)

### 2.1 Utiliser le scorer complet pour le classement final

**Fichier** : `plugins/official/metasolver/main.py`.

**Constat** : `score_and_rank_results` est importé (`_score_and_rank`, ligne 45) mais
jamais appelé. Le tri final repose uniquement sur `score_text_fast`, documenté comme
pré-filtre (pas de lexical, quadgrams en/fr/de seulement, écart correct/near-miss
~0.24 vs ~0.45 pour le scorer complet — voir `documentation/scoring-technique.md` §5).

**Cible** : le fast score sert au tri intermédiaire (inchangé, y compris dans les
événements streaming `plugin_done`) ; après déduplication, le **top-K** est rescoré
avec le pipeline complet avant le tri final.

**Implémentation** :
1. Vérifier la signature exacte de `score_and_rank_results` dans
   `backend/gc_backend/plugins/scoring/` (paramètres `top_k`, `min_score`,
   `fast_reject_threshold`) avant de coder.
2. Après `aggregated_results = self._deduplicate_results(aggregated_results)` :
   ```python
   if _score_and_rank is not None and aggregated_results:
       rescored = _score_and_rank(aggregated_results, top_k=50, min_score=0.0, ...)
   ```
   ⚠️ Deux points de vigilance :
   - **Ne pas perdre de résultats** : si `score_and_rank_results` filtre sous
     `min_score`, passer `min_score=0.0` (le metasolver veut tout garder, trié) ou
     réinjecter les résultats filtrés en queue de liste avec leur fast score.
   - **`plugin_confidence`** : le champ est déjà sauvegardé lors de l'agrégation ;
     `score_and_rank_results` écrit `result['confidence']` et
     `result['metadata']['scoring']` — vérifier qu'il n'écrase pas
     `metadata` existant (merger si besoin).
3. Appliquer dans `execute()` **et** `execute_streaming()` (ou une fois si 2.2 fait).
4. Ajouter dans `diagnostics` : `"full_rescoring": true/false` et le nombre de
   résultats rescorés, pour l'observabilité.

**Tests** : cas où un near-miss César a un fast score supérieur à un déchiffré correct
(l'écart fast est faible) → après rescoring complet, le correct passe devant.
S'appuyer sur les fixtures de `backend/tests/fixtures/scoring_calibration_cases.json`.

### 2.2 Factoriser `execute()` / `execute_streaming()`

**Constat** : ~300 lignes dupliquées à 90 % (parsing des inputs, agrégation,
enrichissement des items, dédup, réponse finale). Chaque correction doit être faite
deux fois (cf. 1.3, 1.4, 2.1).

**Cible** : `execute()` devient un consommateur de `execute_streaming()` :
```python
def execute(self, inputs):
    final = None
    for event in self.execute_streaming(inputs):
        if event.get("event") == "result":
            final = event.get("data")
    return final or self._error_response("Aucun résultat", time.time())
```

**Points de vigilance** :
- Comparer champ à champ les réponses des deux modes **avant** la factorisation
  (écrire un test qui exécute les deux sur les mêmes mocks et diff les clés). Écarts
  connus à résorber d'abord : l'ordre de traitement (streaming = ordre d'achèvement,
  execute = réordonné par priorité) influe sur l'ordre de `execution_log`,
  `failed_plugins` et `combined_results`. Soit trier ces structures en fin de
  streaming par ordre de candidats, soit accepter l'écart et l'assumer dans le test.
- L'enrichissement des items (bloc `enriched = dict(item)` ... `confidence`) doit
  être extrait en méthode `_enrich_result_item(item, idx, plugin_name, mode)` — c'est
  le cœur de la duplication.

**Tests** : `test_metasolver_streaming.py` et `test_metasolver_dedup.py` doivent
passer inchangés ; ajouter le test de parité execute/streaming décrit ci-dessus.

### 2.3 (Optionnel) Déduplication insensible à la casse

`_dedup_key` (~ligne 1097) : ajouter `.casefold()` après la normalisation des
espaces si l'on considère que `HELLO WORLD` et `hello world` sont le même décodage.
Décision produit — si retenu, adapter `test_metasolver_dedup.py`.

---

## LOT 3 — Détection en lot + réécriture de la Phase 2 front (P1)

C'est le gain UX le plus visible : aujourd'hui la « Phase 2 » du plugin executor fait
**une requête HTTP séquentielle par résultat** (des centaines après un run MetaSolver),
chacune rejouant ~15 regex, alors que les sous-plugins ont déjà fait la détection.

### 3.1 Endpoint batch backend

**Fichier** : `backend/gc_backend/blueprints/coordinates.py`.

**Route** : `POST /api/detect_coordinates_batch`
```json
{
  "texts": ["...", "..."],
  "include_numeric_only": false,
  "include_written": false,
  "written_languages": ["fr"],
  "origin_coords": "N 48° 39.286 E 006° 11.685"
}
```
**Réponse** : `{"results": [<même schéma que /api/detect_coordinates>, ...]}` alignée
sur l'index de `texts`.

**Implémentation** :
1. Validation : `texts` liste de chaînes, longueur max 1000, taille cumulée max ~2 Mo
   → 400 sinon.
2. Dédupliquer les textes identiques côté serveur (dict `text -> résultat`) : le
   MetaSolver produit souvent des sorties répétées.
3. `include_written` : la détection écrite exécute un plugin (coûteuse). La
   n'appliquer **que** sur les textes sans détection regex, et plafonner (par exemple
   les 30 premiers textes sans match) — documenter ce plafond dans la réponse
   (`"written_truncated": true`).
4. Réutiliser `_normalize_origin_coords` (lot 1.2).

### 3.2 Réécriture de `detectCoordinatesInResults` (front)

**Fichiers** :
- `frontend/theia-extensions/plugins/src/browser/services/plugins-service.ts` :
  nouvelle méthode `detectCoordinatesBatch(texts: string[], options): Promise<DetectionResult[]>`
  (mêmes options que `detectCoordinates`, plus `signal?: AbortSignal` transmis à axios ;
  timeout élargi, p.ex. 120 s).
- `frontend/theia-extensions/plugins/src/browser/plugin-executor-widget.tsx`,
  `detectCoordinatesInResults` (~ligne 771).

**Nouvel algorithme** :
1. Séparer les items : ceux qui ont **déjà** `item.coordinates` renseigné par le
   backend (sous-plugins avec `detect_coordinates`, mode batch) → comptés comme
   trouvés sans requête.
2. Pour les autres : collecter les `text_output` uniques, **un seul** appel
   `detectCoordinatesBatch`, puis redistribuer les résultats sur les items
   (plusieurs items peuvent partager le même texte).
3. Conserver : la mise à jour de `coordsDetectionProgress` (une étape « envoi » puis
   « terminé » suffit — la barre de progression par item n'a plus de sens, la garder
   comme total trouvé/total analysé), le dispatch
   `geoapp-map-highlight-coordinate` par coordonnée trouvée, le support
   d'annulation (`signal`).
4. Supprimer la boucle pause/reprise item par item (elle n'a plus d'objet) **ou** la
   conserver uniquement si `include_written` est actif et que l'appel est découpé en
   chunks. Choix le plus simple : chunks de 100 textes, vérification
   `signal.aborted` + pause entre chunks.

### 3.3 Ne plus avaler les erreurs de détection

**Fichier** : `plugins-service.ts`, `detectCoordinates` (~ligne 398) et la nouvelle
`detectCoordinatesBatch`.

**Constat** : en cas d'erreur réseau, retour `{exist: false}` → l'utilisateur voit
« Aucune coordonnée détectée » alors que le backend est injoignable.

**Cible** : distinguer les deux cas. Retourner `{exist: false, error: string}` (champ
optionnel ajouté au type de retour) plutôt que throw, pour ne pas casser les
appelants existants. Dans `detectCoordinatesInResults`, si `error` est présent,
passer `coordsDetectionProgress.phase` à `'done'` avec
`currentText: '⚠ Détection indisponible : <message>'` et logguer. Vérifier si
`alphabets-service.ts` (extension alphabets) a le même pattern d'erreur avalée et
appliquer la même correction.

**Tests front** : si l'infra de test front existe (vérifier `package.json` des
extensions), tester le mapping batch → items ; sinon, test manuel documenté dans la
PR (backend coupé → message d'indisponibilité).

---

## LOT 4 — Refonte des détecteurs backend (P2)

⚠️ **Pré-requis impératif** : écrire d'abord une suite de tests de caractérisation
(`backend/tests/test_coordinates_detection.py`) qui fige le comportement actuel sur
un corpus de cas, puis refactorer à tests constants. Sans cela, le risque de
régression est élevé (13 détecteurs, ordre de priorité subtil).

### 4.0 Suite de tests de caractérisation (à faire en premier)

Pour **chaque** détecteur existant, au moins un cas positif (extrait de sa docstring)
et un cas négatif. Cas transverses :
- `"N 48° 33.787' E 006° 38.803'"` → DMM, confiance 0.95.
- `"N48 33.787 E006 38.803"` → geocaching standard, 0.96.
- `"N29 02.879 W98 01.304"` → W conservé.
- `"NORD 4833787 EST 638803"` → variant.
- `"la reponse est N 48° 33.787' E 006° 38.803' bravo"` → détection au milieu de prose.
- `"N 99° 88.999' E 200° 99.999'"` → rejet (bornes).
- Binaire pur `"0110100 0110101"` avec `include_numeric_only` → rejet.
- Texte sans coordonnées → `exist: false`.
Vérifier à chaque fois : `exist`, `ddm_lat`, `ddm_lon`, `source`, `confidence`,
`decimal_latitude/longitude`.

### 4.1 Architecture table-driven

**Cible** : remplacer les 13 fonctions `_detect_*` par :

```python
@dataclass(frozen=True)
class DetectorSpec:
    name: str            # ex. "dmm_standard" (sert de champ `source`)
    confidence: float
    pattern: re.Pattern
    extract: Callable[[re.Match], Optional[RawComponents]]  # composantes brutes

@dataclass
class RawComponents:
    lat_dir: str; lat_deg: int; lat_min: float   # minutes décimales
    lon_dir: str; lon_deg: int; lon_min: float
```

Pipeline commun `_run_detectors(text, specs)` :
1. Pour chaque spec, `pattern.finditer(text)` ; pour chaque match, `extract()` →
   composantes ou None.
2. Validation **systématique** via `_is_valid_degrees_minutes` (corrige les 6
   détecteurs actuels qui ne valident pas : specific_tabpoint, simplified, flexible,
   nord_est_format, nord_est_variations, roman_numerals).
3. Formatage DDM par **une seule** fonction (`_format_ddm(components)` — zfill 2/3,
   3 décimales) et conversion décimale via `convert_ddm_to_decimal`.
4. Produire un candidat : `{exist, ddm_lat, ddm_lon, ddm, source, confidence,
   decimal_latitude, decimal_longitude, span: [start, end], matched_text: <span du match>}`.
5. Sélection : meilleur candidat par `(-confidence, span[0])` (meilleure confiance,
   puis le plus tôt dans le texte). Un paramètre `find_all: bool = False` retourne
   la liste complète des candidats non chevauchants (tri par span, suppression des
   chevauchements au profit de la meilleure confiance).

**Compatibilité ascendante** — points à vérifier avant de changer les champs :
- `grep -rn "matched_text"` dans le dépôt : aujourd'hui `matched_text` = texte
  entier. Si des consommateurs (front, plugins, tests) en dépendent, conserver
  `matched_text = text` et ajouter `matched_span_text` + `span`. Sinon, basculer
  `matched_text` sur le span et le noter dans la doc.
- Le champ `extract: {"plugin": ..., "version": ...}` doit être conservé tel quel
  (consommé quelque part ? grep avant).
- La signature publique `detect_gps_coordinates(text, include_numeric_only=False,
  origin_coords=None, include_written=False)` ne change pas ; ajouter uniquement
  `find_all=False`.
- Le scorer (`backend/gc_backend/plugins/scoring/scorer.py`) appelle
  `detect_gps_coordinates` : vérifier qu'il ne lit que `exist` et `confidence`.

**Ordre/confiances** : reprendre la `confidence_map` actuelle comme valeurs de
départ. La sélection par « meilleure confiance » (au lieu de « premier détecteur qui
matche ») peut changer le résultat sur des textes ambigus : les tests de
caractérisation diront où ; ajuster les confiances si un cas légitime régresse.

### 4.2 Formats manquants à ajouter (après 4.1)

| Détecteur | Exemple | Confiance proposée | Notes |
|---|---|---|---|
| `decimal_pair` | `48.8566, 2.3522` / `-33.8688 151.2093` | 0.80 | Bornes : \|lat\| ≤ 90, \|lon\| ≤ 180, **3 à 8 décimales** exigées (éviter les faux positifs sur « 3.14, 2.71 ») ; signe → S/W. Convertir en DDM pour `ddm_lat/lon`. |
| `dmm_suffix_dir` | `48° 51.234' N, 2° 17.567' E` | 0.93 | Direction **après** la valeur — aucun détecteur actuel ne gère ce cas (fréquent sur listings internationaux). |
| `dms_suffix_dir` | `48°51'24.1" N 2°17'26" E` | 0.90 | Idem pour le DMS ; conversion secondes → minutes décimales comme `_detect_dms_coordinates`. |
| Sud/Ouest écrits | `SUD 4833787 OUEST 638803` | (= variantes N/E) | Ajouter `SOUTH_VARIANTS`, `WEST_VARIANTS`, compléter `DIRECTION_MAP` (S/W et SUD/SOUTH/OUEST/WEST). Signe négatif dans la conversion décimale déjà géré par `_ddm_component_to_decimal`. |

Après ajout : retirer les marqueurs `xfail` correspondants dans
`backend/tests/test_scoring_calibration.py` (`TestKnownWeakCoords`) et mettre à jour
`documentation/scoring-technique.md` §10 (« Coordonnées faibles »).

### 4.3 Logging et nettoyage

1. Supprimer `logger.setLevel(logging.DEBUG)` (ligne 12) — le niveau doit venir de la
   config applicative.
2. Remplacer les `logger.debug(f"...")` par le format lazy `logger.debug("...", args)`
   et réduire drastiquement : un debug à l'entrée de `detect_gps_coordinates` et un
   au succès suffisent. Motif : la fonction est appelée par le scorer sur chaque
   candidat bruteforce passant le gatekeeper ; les f-strings sont formatées même
   quand le handler filtre.
3. Supprimer la route morte `save_geocache_coordinates`
   (`/api/geocaches/save/<id>/coordinates`, marquée « A supprimer » ligne 76) —
   vérifier d'abord par grep qu'aucun appelant front n'utilise ce chemin (le front
   utilise `/api/geocaches/<id>/coordinates`, route différente).

### 4.4 Coordonnées écrites : un seul chemin d'exécution

**Constat** : avec `include_written=True`, `detect_gps_coordinates` appelle
`_detect_word_coordinates` (langues **hardcodées** `["fr"]`, max 20), puis l'endpoint
relance `WrittenCoordinatesService.find()` avec les langues demandées → le plugin
`written_coords_converter` peut tourner deux fois avec des configs différentes.

**Cible** :
1. `grep -rn "include_written"` pour lister les appelants de
   `detect_gps_coordinates(include_written=True)` hors endpoint.
2. Retirer le paramètre `include_written` et `_detect_word_coordinates` de
   `detect_gps_coordinates` ; la détection écrite devient la responsabilité exclusive
   de l'endpoint (via `WrittenCoordinatesService`, déjà paramétré par langues /
   max_candidates / deconcat). Si un appelant interne en dépend, le faire passer par
   le service.
3. Au passage, harmoniser la confiance : la détection écrite est aujourd'hui à 0.98,
   au-dessus des formats standard (0.95–0.96). La ramener à 0.90 (elle passe par un
   plugin de conversion, plus de maillons faillibles) — à valider avec les tests de
   calibration scoring.
4. Vérifier la gestion de `written_languages: ['auto']` envoyé par le front : soit
   `WrittenCoordinatesService` le gère, soit le normaliser côté endpoint
   (`'auto'` → liste complète des langues supportées).

---

## LOT 5 — Ergonomie front (P3)

### 5.1 Composant partagé « coordonnées détectées »

Unifier `coordinates-detector.tsx` (alphabets) et l'affichage du plugin executor :
un composant commun avec actions **Copier** (DDM complet), **Voir sur la carte**
(dispatch `geoapp-map-highlight-coordinate`, déjà implémenté côté executor),
**Créer waypoint**. Emplacement suggéré : package partagé ou duplication contrôlée si
les extensions ne peuvent pas partager de code (vérifier les dépendances entre
extensions Theia du projet).

### 5.2 Thème et styles

Dans `coordinates-detector.tsx` : remplacer les couleurs en dur (`#00ff00`,
`#ffff00`, `#ff0000`, `rgba(0,255,0,...)`) par les variables Theia
(`--theia-successBackground`, `--theia-editorWarning-foreground`,
`--theia-errorForeground`...) — le thème clair est illisible actuellement. Sortir les
styles inline répétés vers le CSS de l'extension.

### 5.3 Divers

- `metasolver-streaming-panel.tsx` : afficher `duplicates_merged` dans le résumé
  final (« X résultats, Y doublons fusionnés ») pour expliquer la baisse du compteur
  entre le streaming et l'affichage final.
- Seuil de distance : les bornes 2.0/2.5 miles sont en dur dans
  `calculate_distance_between_coords` (backend). Si utile, exposer une préférence
  `geoApp.coordinates.distanceWarningMiles` et la passer en paramètre de l'API.
- `max_workers=6` du MetaSolver : passer en constante nommée en tête de fichier
  (voire en input optionnel `max_workers` borné à [1, 12]).

---

## Récapitulatif des vérifications avant de commencer chaque lot

- **Lot 1** : exécuter la suite backend complète pour établir la base
  (`cd backend && python -m pytest tests/ -q`).
- **Lot 2** : lire la signature réelle de `score_and_rank_results` ; écrire le test de
  parité execute/streaming AVANT de factoriser.
- **Lot 3** : vérifier le schéma exact retourné par `/api/detect_coordinates`
  (champ `written` inclus) pour que le batch retourne le même.
- **Lot 4** : écrire les tests de caractérisation AVANT tout refactor ; grep
  `matched_text`, `extract`, `include_written` pour la compatibilité.
- **Lot 5** : vérifier si un mécanisme de partage de composants existe déjà entre
  extensions Theia du projet.
