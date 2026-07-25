# Détection de coordonnées — Documentation technique

> Détection, normalisation et calcul de coordonnées GPS dans les sorties de plugins
> (décodage, bruteforce, MetaSolver) et les textes de géocaches.
> Couvre le backend (détection multi-format), les endpoints, le calcul de distance,
> et le flux frontend (Phase 2 du Plugin Executor).
> Dernière mise à jour : juillet 2026 (après refonte Lots 1–5).

---

## 1. Vue d'ensemble

Le système répond à trois besoins :

1. **Détecter une coordonnée** dans un texte libre, quel que soit son format
   (`detect_gps_coordinates`), et la normaliser en **DDM** (degrés + minutes
   décimales, format standard du géocaching) + décimal.
2. **Détecter en lot** les coordonnées de nombreux résultats (sorties MetaSolver /
   bruteforce) en une seule requête.
3. **Calculer** des coordonnées à partir d'une formule à variables et mesurer la
   distance à un point d'origine (règle des « 2 miles »).

Toutes les détections convergent vers un dictionnaire uniforme :

```python
{
  "exist": True,
  "ddm_lat": "N 48° 33.787'",
  "ddm_lon": "E 006° 38.803'",
  "ddm": "N 48° 33.787' E 006° 38.803'",
  "source": "_detect_dmm_coordinates",   # détecteur retenu
  "confidence": 0.95,                     # fiabilité du format [0..1]
  "decimal_latitude": 48.56311667,
  "decimal_longitude": 6.64671667,
  "matched_text": "N 48° 33.787' E 006° 38.803'",  # fragment matché, PAS le texte entier
  "span": [15, 43],                                # [start, end] du fragment dans le texte
  "extract": {"plugin": "_detect_dmm_coordinates", "version": "1.0"}
}
```

`matched_text` contient le **fragment réellement matché** (utile p.ex. pour surligner
la coordonnée dans une description), et `span` ses bornes `[start, end]` dans le texte
d'entrée (`text[start:end] == matched_text`). Pour les rares détecteurs multi-lignes
sans objet `re.Match` unique (`_detect_simplified_coordinates`), `span` vaut `None` et
`matched_text` retombe sur le texte entier. En l'absence de détection, les deux valent
`None`.

Le champ `confidence` alimente aussi le **scorer** (`gps_conf`, voir
[scoring-technique.md](scoring-technique.md)) : une coordonnée détectée prime sur
le texte en clair.

---

## 2. Localisation du code

```
backend/gc_backend/blueprints/
└── coordinates.py            # Détecteurs, endpoints, calcul distance/formule

backend/gc_backend/services/
└── written_coordinates_service.py   # Coordonnées en toutes lettres (plugin)

plugins/official/metasolver/
└── main.py                   # Propagation de la détection aux sous-plugins

frontend/theia-extensions/plugins/src/browser/
├── plugin-executor-widget.tsx        # Phase 2 : détection sur les résultats
├── metasolver-streaming-panel.tsx    # Progression Phase 1/2
└── services/plugins-service.ts       # detectCoordinates / detectCoordinatesBatch

frontend/theia-extensions/plugins/src/browser/plugin-executor-coords-utils.ts
                                      # extractDecimalCoordinates (DDM/décimal → décimal)

frontend/theia-extensions/alphabets/src/browser/components/
└── coordinates-detector.tsx          # Affichage coordonnées + distance (alphabets)

backend/tests/
├── test_coordinates_detection.py     # Caractérisation des formats + cibles
├── test_coordinates_batch.py         # Endpoint batch
├── test_coordinates_lot1.py          # eval AST + normalisation origine
└── test_coordinate_calculator.py     # Calcul de formule (utilitaire séparé)
```

---

## 3. Détection unitaire — `detect_gps_coordinates`

Signature :

```python
detect_gps_coordinates(
    text: str,
    include_numeric_only: bool = False,   # coordonnées « chiffres purs » (7+6..8)
    origin_coords: Optional[dict|str] = None,
    include_written: bool = False,        # DÉPRÉCIÉ / ignoré (voir §6)
) -> dict
```

### 3.1 Pipeline

```
texte
  │
  ├─ Normalisation de origin_coords  (_normalize_origin_coords)
  │
  ├─ Détecteurs triés une fois par (confiance décroissante, ordre de déclaration) :
  │     - _detect_numeric_only_coordinates (si include_numeric_only)
  │     - chaque détecteur de confidence_map
  │     (chaque détecteur valide lui-même les bornes deg/min, et expose son span)
  │
  ├─ Sélection : ARRÊT au premier détecteur qui matche (= meilleure confiance)
  │
  └─ _finalize_detection : conversion décimale, matched_text/span, extract
```

> **Changement clé (Lot 4)** : on ne renvoie plus « le premier détecteur *dans
> l'ordre du code* qui matche » mais **le candidat de meilleure confiance**. Un
> format laxiste ne peut plus masquer un format fiable présent dans le texte, et la
> validation systématique des bornes (désormais dans **tous** les détecteurs)
> élimine les faux positifs en amont.
>
> **Optimisation** : plutôt que d'exécuter les 18 détecteurs puis prendre le max,
> on les trie une fois par confiance décroissante et on **s'arrête au premier
> match** — résultat identique (le premier match dans l'ordre trié *est* le max),
> mais on évite d'exécuter tous les détecteurs à chaque appel (chemin chaud : le
> scorer appelle cette fonction pour chaque candidat bruteforce).

### 3.2 Formats supportés

| Détecteur | Confiance | Exemple |
|---|---|---|
| `_detect_geocaching_standard_format` | 0.96 | `N48 33.787 E006 38.803` |
| `_detect_dmm_dot_separator` | 0.95 | `N50.02.117 E004.52.677` |
| `_detect_compact_coordinates` | 0.95 | `N4812123E00612123` |
| `_detect_dmm_coordinates` | 0.95 | `N 48° 33.787' E 006° 38.803'` |
| `_detect_dmm_suffix_direction` | 0.93 | `48° 51.234' N 2° 17.567' E` *(Lot 4.2)* |
| `_detect_dms_coordinates` | 0.92 | `N 48° 51' 24.12" E 002° 17' 26.1"` |
| `_detect_dms_suffix_direction` | 0.90 | `48°51'24" N 2°21'27" E` *(Lot 4.2)* |
| `_detect_roman_numerals_coordinates` | 0.90 | `N XLVIII° XXXII.CCXCVI' ...` |
| `_detect_tabspace_coordinates` | 0.90 | `N 48 ° 32 . 296 E 6 ° 40 . 636` |
| `_detect_dmm_no_degree_symbol` | 0.90 | `N 38 32.460 W 075 43.659` |
| `_detect_nord_est_variations` | 0.88 | `NORD48.32.296 EST6.40.636` |
| `_detect_nord_est_format` | 0.85 | `NORD 48 32 296 EST 6 40 636` |
| `_detect_dmm_no_symbol_no_dot` | 0.85 | `N 38 32 460 W 075 43 659` |
| `_detect_specific_tabpoint_coordinates` | 0.82 | `N\t48 ° 32 . 296 …` |
| `_detect_decimal_pair` | 0.80 | `48.8566, 2.3522` *(Lot 4.2)* |
| `_detect_simplified_coordinates` | 0.80 | lignes `N …` / `E …` |
| `_detect_flexible_coordinates` | 0.75 | `N 48 deg 33 787 …` |
| `_detect_variant_coordinates` | 0.70 | `NORD 4833787 EST 638803` |
| `_detect_numeric_only_coordinates` | 0.90 | `4912123 00612123` (opt-in) |

### 3.3 Validation des bornes

Tous les détecteurs valident via `_is_valid_degrees_minutes` (latitude 0–90,
longitude 0–180, minutes 0–<60). Le helper `_valid_dms_parts(lat_deg, lat_min,
lat_sec, ...)` reconstitue les minutes décimales (`min.sec`) pour les détecteurs qui
manipulent les composantes séparément.

> Avant le Lot 4, 6 détecteurs ne validaient pas : `N 99° 88.999' E 200° 99.999'`
> était accepté à tort, et `NORD 4833787 EST 638803` produisait un `E 638° 80.3'`
> invalide qui l'emportait par priorité. Corrigé.

### 3.4 Conversion décimale (`_finalize_detection`)

Centralisée côté backend (le frontend n'a plus à recalculer). Le DDM est converti
via `convert_ddm_to_decimal` (regex `DDM_COMPONENT_REGEX`) ; le signe est appliqué
pour S/W. `_detect_decimal_pair` fournit directement les décimales (pas de
re-conversion).

### 3.5 Normalisation des coordonnées d'origine (`_normalize_origin_coords`)

Accepte indifféremment :
- un dict `{"ddm_lat": "N 48° 39.286'", "ddm_lon": "E 006° 11.685'"}` ;
- une chaîne DDM combinée `"N 48° 39.286 E 006° 11.685"` (champ `coordinatesRaw`
  d'une géocache côté front).

Sert à hériter les directions cardinales (S/W) pour la détection « chiffres purs »
et à calculer la distance. Retourne `None` sans lever d'exception si l'entrée est
inexploitable.

> **Piège corrigé (Lot 1)** : le front envoyait auparavant `N ${latitude_décimale}`
> (ex. `N 48.8566`), une chaîne invalide rejetée silencieusement, et forçait N/E.
> Désormais le front envoie `coordinatesRaw` (vrai DDM) et le backend le normalise.

---

## 4. API

### 4.1 Détection unitaire

```
POST /api/detect_coordinates
{
  "text": "N 48° 33.787' E 006° 38.803'",
  "include_numeric_only": false,
  "include_written": false,
  "written_languages": ["fr"],
  "origin_coords": "N 48° 39.286 E 006° 11.685"   // dict ou chaîne
}
→ { "exist": true, "ddm_lat": ..., "decimal_latitude": ..., ... }
```

### 4.2 Détection en lot *(Lot 3)*

```
POST /api/detect_coordinates_batch
{ "texts": ["...", "..."], "include_numeric_only": false, ... }
→ {
    "results": [ <schéma /api/detect_coordinates>, ... ],  // aligné sur l'index
    "count": 42,
    "unique_count": 37,          // après déduplication serveur
    "written_truncated": false   // plafond de détection écrite atteint ?
  }
```

- **Déduplication serveur** : les textes identiques ne sont détectés qu'une fois.
- **Limites** : `_BATCH_MAX_TEXTS = 1000`, `_BATCH_MAX_TOTAL_CHARS = 2 000 000` → `400`.
- **Détection écrite plafonnée** : `_BATCH_WRITTEN_CAP = 30` textes sans match regex
  (le plugin `written_coords_converter` est coûteux).

### 4.3 Calcul de formule

```
POST /api/calculate_coordinates
{ "formula": "N48° 39.(8/4)(27/9)(2x2x2) E06°11.(3x2)(16x2/4)(25/5)",
  "variables": {"A": 5, ...}, "origin_lat": ..., "origin_lon": ... }
```

Substitue les variables, évalue les sous-expressions et vérifie le format
géocaching (3 décimales de minutes). Résolution **partielle** possible (variables
manquantes → statut `partial`).

> **Sécurité (Lot 1)** : l'évaluation arithmétique passe par `_safe_eval_arithmetic`
> (basé sur `ast`, seuls `+ − * /` et parenthèses autorisés). Remplace un ancien
> `eval()` exposé à l'exécution de code arbitraire. La puissance (`**`) est
> volontairement interdite (pas de bombe `9**9**9`).

---

## 5. Formats et conventions DDM

- **Latitude** : `N/S DD° MM.mmm'` (degrés 2 chiffres, minutes 2 + 3 décimales).
- **Longitude** : `E/W DDD° MM.mmm'` (degrés 3 chiffres).
- **Décimal** : signe négatif pour S et W.

---

## 6. Coordonnées en toutes lettres (« written »)

Détection déléguée au plugin `written_coords_converter` via
`WrittenCoordinatesService.find(text, languages, max_candidates, include_deconcat,
origin_coords)`.

> **Consolidation (Lot 4.4)** : `detect_gps_coordinates` ne fait **plus** la
> détection écrite en interne (l'ancien chemin `_detect_word_coordinates` était figé
> sur `fr` et pouvait relancer le plugin une 2ᵉ fois). Le paramètre `include_written`
> est déprécié/ignoré ; la détection écrite est pilotée **exclusivement** par les
> endpoints via le service, qui respecte les langues demandées.

---

## 7. Calcul de distance

`calculate_distance_between_coords` utilise `pyproj.Geod` (ellipsoïde WGS84) et
classe la distance selon la règle géocaching des « 2 miles » :

| Statut | Condition |
|---|---|
| `ok` | ≤ `DISTANCE_WARNING_MILES` (2.0) |
| `warning` | entre 2.0 et `DISTANCE_FAR_MILES` (2.5) |
| `far` | > 2.5 |

Les seuils sont des constantes de module (pourront devenir une préférence).

---

## 8. Détection côté frontend (Plugin Executor)

### 8.1 Phase 2 — `detectCoordinatesInResults`

Après exécution d'un plugin (ou du MetaSolver), les résultats sont analysés :

1. **Réutilisation** : les items déjà porteurs de `item.coordinates` (détectées
   côté backend) sont comptés sans nouvelle requête.
2. **Batch** : les `text_output` restants sont **dédupliqués** puis soumis par
   **chunks de 100** à `detectCoordinatesBatch` (une requête au lieu de N).
3. **Redistribution** sur les items + dispatch de l'événement carte
   `geoapp-map-highlight-coordinate` par coordonnée trouvée.
4. **Annulation / pause** respectées entre chunks (`signal.aborted`, `isPausedRef`).

> **Avant (Lot 3)** : une requête HTTP **séquentielle par résultat** — des dizaines
> de secondes d'aller-retours après un run MetaSolver. Désormais : une requête par
> chunk, détection en mémoire côté serveur.

### 8.2 Gestion d'erreur

`detectCoordinates` / `detectCoordinatesBatch` renvoient `{exist: false, error}`
en cas d'échec réseau (au lieu d'un `{exist: false}` muet). La Phase 2 affiche alors
« ⚠ Détection indisponible : … » plutôt qu'un trompeur « Aucune coordonnée ».

### 8.3 Conversion décimale front

`extractDecimalCoordinates(coords, fallbackFormatted)` gère nombres, champs
`decimal_*`, chaînes DDM et paires décimales, avec repli sur le parsing du texte
formaté. Utilisé pour alimenter la carte.

### 8.4 Affichage (extension alphabets)

`coordinates-detector.tsx` affiche DDM lat/lon, coordonnées complètes (avec action
**Copier**) et distance. Les couleurs de statut sont **theme-aware**
(`var(--theia-charts-green/yellow/red)`) — les anciennes valeurs `#00ff00` étaient
illisibles en thème clair.

---

## 9. Intégration MetaSolver

- La détection est propagée aux sous-plugins via le champ `detect_coordinates`
  (ou `enable_gps_detection`), **en respectant le toggle utilisateur** (auparavant
  forcé à `True`).
- `primary_coordinates` est choisi de façon **déterministe** :
  `_pick_primary_coordinates` retient le premier plugin **dans l'ordre de priorité
  des candidats** (et non d'achèvement des threads), identique en mode `execute` et
  `execute_streaming`.
- Le panneau de streaming affiche « X doublon(s) fusionné(s) » (`duplicates_merged`)
  pour expliquer l'écart entre le compteur streaming (avant dédup) et l'affichage
  final.

Détails de scoring/tri : voir [scoring-technique.md](scoring-technique.md).

---

## 10. Tests

| Fichier | Couverture |
|---|---|
| `test_coordinates_detection.py` | Caractérisation des formats (sorties figées), nouveaux formats (décimal, suffixe), rejets (hors bornes, binaire) |
| `test_coordinates_batch.py` | Validation, alignement d'index, déduplication, héritage S/W |
| `test_coordinates_lot1.py` | Évaluateur AST sûr, normalisation des coordonnées d'origine |
| `test_coordinate_calculator.py` | Calcul de formule (utilitaire `CoordinateCalculator` séparé) |
| `test_metasolver_*` | Toggle détection, `primary_coordinates` déterministe, parité execute/streaming |

Lancement : `cd backend && python -m pytest tests/test_coordinates_*.py -q`

---

## 11. Limites connues et pistes différées

- **Une seule coordonnée retournée** : `detect_gps_coordinates` renvoie le meilleur
  candidat. Un mode `find_all` (multi-coordonnées, avec spans) est **différé**.
- **Restructuration table-driven** (dataclasses) : différée (esthétique ; la
  validation et la sélection best-confidence sont déjà en place).
- **Directions écrites Sud/Ouest** (`SUD`/`OUEST`) : non prises en charge par les
  détecteurs `NORD/EST` (rare).
- **`written_languages: ['auto']`** : transmis tel quel au service (pas de mapping
  vers une liste de langues par défaut).
- **Formats faibles résiduels** : la paire décimale score ≈ 0.80 (< cible 0.85) et
  `N48 51.234 E002 21.456` score bas — problèmes de **scoring**, pas de détection
  (voir [scoring-technique.md](scoring-technique.md) §10).
- **Composant front partagé** : `coordinates-detector.tsx` (alphabets) et l'affichage
  du Plugin Executor restent séparés ; une unification avec actions
  Copier / Voir-carte / Créer-waypoint est différée.

---

## 12. Historique

| Étape | Changements |
|---|---|
| **Lot 1** | `eval()`→AST sûr · normalisation `origin_coords` (dict/chaîne) · toggle `detect_coordinates` propagé · `primary_coordinates` déterministe |
| **Lot 2** | Rescoring complet MetaSolver · `execute()` délègue à `execute_streaming()` |
| **Lot 3** | Endpoint `/api/detect_coordinates_batch` · Phase 2 front en lots · erreurs non avalées |
| **Lot 4** | Validation systématique des bornes · sélection best-confidence · formats décimal + suffixe DMS/DMM · chemin écrit unifié · nettoyage |
| **Lot 5** | Couleurs theme-aware · action Copier · doublons fusionnés · constantes nommées |
