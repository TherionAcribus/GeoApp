# Système de Plugins — Fonctionnement (Backend + Theia)

Ce document est la **source de vérité** pour comprendre, créer et maintenir les plugins MysterAI/GeoApp.

---

## Objectifs

- **Découvrir** des plugins (officiels et custom) via des fichiers `plugin.json`.
- **Valider** la configuration des plugins via un JSON Schema.
- **Enregistrer** les métadonnées en base (SQLite/SQLAlchemy).
- **Charger** et **exécuter** des plugins à la demande (lazy loading) via des wrappers.
- **Exposer** une API REST (`/api/plugins`) consommée par le frontend (Theia).
- **Supporter** l’exécution batch sur plusieurs géocaches.

---

## 1) Structure des dossiers

### Répertoires (discovery)

Racine plugins (dans ce repo) :

- `gc-backend/plugins/official/` : plugins fournis avec l’application.
- `gc-backend/plugins/custom/` : plugins ajoutés par l’utilisateur.

La **découverte** scanne récursivement ces deux répertoires à la recherche de `plugin.json`.

### Structure minimale d’un plugin

Chaque plugin est un dossier contenant au minimum :

- `plugin.json`
- le fichier d’entrée déclaré par `entry_point` (ex: `main.py`, `plugin.exe`, etc.)

Exemple :

```
plugins/
  official/
    caesar/
      plugin.json
      main.py
    qr_code_detector/
      plugin.json
      main.py
  custom/
    solved_jigidi/
      plugin.json
      main.py
      (fichiers de cache optionnels)
```

---

## 2) Modèle de données (DB)

### Table SQLAlchemy `Plugin`

Fichier : `gc-backend/gc_backend/plugins/models.py`

Champs clés :

- `name` (unique)
- `version`
- `plugin_api_version`
- `description`, `author`
- `plugin_type` (ex: `python`, `binary`, `node`, `wasm`, `rust`)
- `source` (`official` | `custom`)
- `path`, `entry_point`
- `categories` (JSON)
- `input_types` (JSON)
- `heavy_cpu`, `needs_network`, `needs_filesystem`
- `enabled`
- `metadata_json` (le `plugin.json` complet sérialisé)

### Détails importants

- La DB est considérée comme la **source runtime** pour l’API :
  - `GET /api/plugins` et `GET /api/plugins/<name>` lisent depuis la DB.
- Le champ `metadata_json` stocke aussi un `_hash` (MD5 du `plugin.json`) pour éviter des updates inutiles.

---

## 3) JSON Schema du `plugin.json`

Fichier : `gc-backend/gc_backend/plugins/schemas/plugin.schema.json`

### Champs obligatoires

- `name`
- `version`
- `plugin_api_version`
- `plugin_type`
- `entry_point`

### Conventions

- `name` : `snake_case`, `[a-z0-9_]`, 2..64.
- `version` : SemVer (`1.2.3`, `1.2.3-beta`).
- `plugin_api_version` : ex `2.0`.

### Champs utiles (extraits)

- `categories`: liste de catégories (ex: `Substitution`, `Coordinates`, `Meta`, ...)
- `kinds`: liste de natures fonctionnelles :
  - `code`, `calculator`, `image`, `geo`, `text`, `solver`, `analyze`, `meta`
- `brute_force` (bool)
- `enable_scoring` (bool)
- `heavy_cpu`, `needs_network`, `needs_filesystem`
- `timeout_seconds` (1..300)
- `capabilities` (`analyze`/`decode`/`encode`)
- `pipeline` (pour les méta-plugins)

### `input_types` (format UI)

Le système accepte un format `input_types` “UI-oriented” (propre au projet) qui est ensuite converti en **JSON Schema standard** côté API (voir `Plugin.to_dict(include_metadata=True)`).

Types supportés (schema) :

- `string`
- `textarea`
- `select`
- `checkbox` / `boolean`
- `number`
- `float`

Champs courants dans un input :

- `label` (obligatoire)
- `placeholder`
- `default`
- `description`
- `options` (pour `select`, string ou `{value,label}`)
- `min`/`max`/`step` (numériques)

Champs additionnels utilisés par le projet (acceptés en pratique) :

- `required` (bool)
- `hidden` (bool)
- `default_value_source` (string) : utilisé pour pré-remplir automatiquement certains inputs en contexte géocache (voir section batch).

---

## 4) PluginManager (découverte / chargement / exécution)

Fichier : `gc-backend/gc_backend/plugins/plugin_manager.py`

### 4.1 Découverte

Méthode : `PluginManager.discover_plugins()`

- Scanne :
  - `plugins/official/**/plugin.json`
  - `plugins/custom/**/plugin.json`
- Valide chaque `plugin.json` avec `plugin.schema.json`.
- Calcule un hash MD5 et le stocke dans `_hash`.
- Upsert DB (création ou mise à jour).
- Supprime en DB les plugins dont le dossier n’existe plus.

Erreurs : `PluginManager.get_discovery_errors()` retourne `{path: message}`.

### 4.2 Chargement (lazy)

Méthode : `PluginManager.get_plugin(name, force_reload=False)`

- Lit le plugin en DB.
- Vérifie `enabled`.
- Construit `PluginMetadata` (incluant un timeout effectif).
- Instancie un wrapper via `create_plugin_wrapper()`.
- `wrapper.initialize()` puis cache en mémoire (`loaded_plugins[name]`).

Préférences runtime (chargées via l’app Flask) :

- `geoApp.plugins.lazyMode` (bool) : par défaut `True`.
- `geoApp.plugins.executor.timeoutSec` (int) : par défaut `60`.
- `geoApp.plugins.executor.allowLongRunning` (bool) : par défaut `False`.

Note : le timeout réel est `min(timeout_seconds du plugin, timeoutSec)` si `allowLongRunning` est faux.

### 4.3 Exécution

Méthode : `PluginManager.execute_plugin(name, inputs)`

- Charge le plugin si nécessaire.
- Appelle `wrapper.execute(inputs)`.
- Si le plugin est indisponible, retourne un résultat standardisé `status=error`.

---

## 5) Wrappers (types de plugins)

Fichier : `gc-backend/gc_backend/plugins/wrappers.py`

### 5.1 Plugin Python

Wrapper : `PythonPluginWrapper`

- Charge le fichier `entry_point` dynamiquement.
- Cherche la classe plugin selon une convention :
  - priorité : `{PluginNameSansUnderscore}.title() + "Plugin"` (ex: `caesar` -> `CaesarPlugin`)
  - sinon : première classe dont le nom finit par `Plugin`.
- Instancie la classe trouvée.
- Si l’instance expose `set_plugin_manager(plugin_manager)`, injection possible.
- Exécute `instance.execute(inputs)`.

### 5.2 Plugin binaire (exe)

Wrapper : `BinaryPluginWrapper`

- Lance le binaire via `subprocess`.
- Envoie `inputs` en JSON sur `stdin`.
- Attend un JSON sur `stdout`.
- Timeout via `subprocess.communicate(timeout=...)`.

### 5.3 Types rust/wasm/node

Actuellement : non implémentés nativement, fallback vers `BinaryPluginWrapper`.

---

## 6) API REST (Blueprint plugins)

Fichier : `gc-backend/gc_backend/blueprints/plugins.py`

Base URL : `/api/plugins`

### 6.1 Listage

- `GET /api/plugins`
  - Query params :
    - `source` (`official|custom`)
    - `category` (filtre sur `categories`)
    - `enabled` (`true|false|1|0|yes|no`) ; par défaut, l’API renvoie **enabled_only=True**.

### 6.2 Infos d’un plugin

- `GET /api/plugins/<plugin_name>`

Retour inclut (via DB) :

- `metadata` (contenu du `plugin.json`)
- `input_schema` (JSON Schema dérivé de `input_types`)
- `output_types` (si présent)

### 6.3 Interface HTML (debug)

- `GET /api/plugins/<plugin_name>/interface`

Génère un formulaire HTML à partir de `metadata.input_types`.

Limites connues :

- Supporte surtout : `string`, `textarea`, `number/float`, `select`, `checkbox/boolean`.
- Les types plus complexes (ex: `array`) ne sont pas gérés dans ce rendu.

### 6.4 Exécution synchrone

- `POST /api/plugins/<plugin_name>/execute`

Body JSON attendu :

```json
{
  "inputs": {
    "text": "HELLO",
    "mode": "decode",
    "shift": 3
  }
}
```

Réponse : un objet résultat tel que renvoyé par le plugin.

### 6.5 Découverte

- `POST /api/plugins/discover`

Relance la découverte, renvoie :

- `plugins` (découverts)
- `errors` (erreurs par chemin)

### 6.6 Statut

- `GET /api/plugins/status`

Retourne (pour chaque plugin) :

- `enabled`
- `loaded` (cache mémoire)
- `error` (si erreur de chargement)
- `version`, `source`, `plugin_type`

### 6.7 Reload

- `POST /api/plugins/<plugin_name>/reload`

Décharge puis recharge le plugin.

---

## 7) Exécution Batch (multi-géocaches)

Toujours dans `blueprints/plugins.py`.

### 7.1 Lancer un batch

- `POST /api/plugins/batch-execute`

Body :

```json
{
  "plugin_name": "caesar",
  "geocache_ids": [123, 456],
  "inputs": {"mode": "decode", "shift": 3},
  "options": {
    "execution_mode": "sequential",
    "max_concurrency": 3,
    "detect_coordinates": true,
    "include_images": false
  }
}
```

### 7.2 Pré-remplissage automatique (batch)

Pour chaque géocache, le batch peut injecter automatiquement certains inputs selon `input_types[*].default_value_source` :

- `geocache_id` -> injecte le **gc_code** dans l’input
- `geocache_description` -> injecte `description_raw`
- `geocache_coordinates` -> injecte `coordinates_raw` (sinon `"lat, lon"`)

De plus :

- si `include_images=true` et que le plugin déclare un input `images`, injecte `geocache.images`.
- si le plugin déclare un input `waypoints`, injecte `geocache.waypoints`.

### 7.3 Détection de coordonnées (batch)

Le batch tente de produire une sortie `coordinates` par géocache, dans cet ordre :

1. `plugin_result.primary_coordinates` (si dict `{latitude,longitude}`)
2. `plugin_result.results[*].decimal_latitude` / `decimal_longitude`
3. si `detect_coordinates=true` : tente une détection dans `results[*].text_output` via `detect_gps_coordinates()` (backend).

### 7.4 Suivre / annuler

- `GET /api/plugins/batch-status/<task_id>`
- `POST /api/plugins/batch-cancel/<task_id>`
- `GET /api/plugins/batch-list`

---

## 8) Format de résultat (contrat recommandé)

Le système ne normalise pas totalement toutes les variantes historiques (certains plugins renvoient `status: ok`, d’autres `status: success`).

Contrat recommandé :

```json
{
  "status": "ok" ,
  "summary": "...",
  "results": [
    {
      "id": "result_1",
      "text_output": "...",
      "confidence": 0.85,
      "parameters": {"...": "..."},
      "metadata": {"...": "..."},
      "coordinates": {
        "latitude": "N ...",
        "longitude": "E ...",
        "formatted": "N ... E ...",
        "decimalLatitude": 48.123,
        "decimalLongitude": 2.456,
        "decimal_latitude": 48.123,
        "decimal_longitude": 2.456
      },
      "decimal_latitude": 48.123,
      "decimal_longitude": 2.456
    }
  ],
  "primary_coordinates": {"latitude": 48.123, "longitude": 2.456},
  "plugin_info": {"name": "...", "version": "...", "execution_time_ms": 12}
}
```

Notes :

- `primary_coordinates` est **la forme la plus simple** pour que le batch/agrégateurs puissent récupérer rapidement la “meilleure coordonnée”.
- Pour compatibilité, plusieurs plugins exposent `decimal_latitude`/`decimal_longitude` au niveau de l’item.

### 8.1 Contrat standard — Plugins de chiffrement / déchiffrement (texte)

Cette section décrit le **comportement recommandé** pour tous les plugins de type “cipher” (Atbash, Caesar, Abaddon, etc.) afin d’avoir une UX homogène côté Plugin Executor.

#### Inputs recommandés (communs)

- `text` (`string` | `textarea`)
  - **Doit préserver** les espaces et les sauts de ligne.
- `mode` (`select`)
  - valeurs recommandées :
    - `decode`
    - `encode`
    - `detect`
- `strict` (`select`)
  - valeurs recommandées :
    - `strict`
    - `smooth`
- `embedded` (`boolean`)
  - `false` (par défaut) : l’utilisateur/IA a déjà extrait la portion intéressante.
  - `true` : (moins recommandé) recherche/traitement au milieu d’un texte plus long.
- `allowed_chars` (`string`, optionnel)
  - Liste de caractères **tolérés** en plus du code.
  - Recommandation : inclure espace / tab / retours ligne si on souhaite les conserver.
  - Si vide (`""`) : aucun caractère supplémentaire n’est toléré.

#### Sémantique recommandée des modes

- **`detect`**
  - Objectif : répondre “est-ce compatible / où se trouvent les fragments ?”
  - En première implémentation, privilégier une **détection stricte** :
    - si `embedded=false` : match uniquement si l’ensemble du texte est compatible (en tolérant `allowed_chars`).
    - si `embedded=true` : renvoyer une liste de fragments candidats.

- **`decode`**
  - `strict` :
    - tolère `allowed_chars` (ponctuation, espaces, sauts de ligne) mais exige que le reste soit 100% compatible.
    - si `embedded=false` : décoder l’intégralité du code en **préservant** les caractères `allowed_chars` (espaces/retours ligne inclus) dans la sortie.
  - `smooth` :
    - “best effort” : cherche des fragments décodables dans le texte (risque de faux positifs).
    - recommandé uniquement si `strict` échoue.

- **`encode`**
  - Doit **préserver** les espaces et sauts de ligne.
  - Si le texte contient des caractères non encodables :
    - ils doivent être **conservés tels quels** dans la sortie.
    - le plugin doit remonter une alerte via `metadata` (voir ci-dessous).

#### Conventions de sortie (résultats)

- `results[*].text_output`
  - `encode` : texte encodé, en conservant les whitespace (` `, `\n`, `\r`, `\t`).
  - `decode` : texte décodé (avec conservation des caractères tolérés si applicable).
  - `detect` :
    - `embedded=false` : peut renvoyer le code “nettoyé” (sans `allowed_chars`) ou le texte original selon besoin.
    - `embedded=true` : chaque résultat correspond à un fragment détecté.

- `results[*].metadata` (recommandé)
  - `unsupported_chars` (liste) : caractères non encodables rencontrés (hors whitespace).
  - `unsupported_count` (int)
  - `warning` (string) : message utilisateur si certains caractères ont été conservés.
  - `start` / `end` : positions des fragments en cas de `detect` ou `decode` en mode `embedded`.

#### Accents / normalisation (recommandation)

Certains codages nécessitent une normalisation (ex: `μ` → `µ`, accents). Le projet dispose déjà de `accept_accents` en metadata, mais le comportement précis peut varier.

Recommandation :

- le plugin doit documenter sa stratégie (ex: suppression des accents, substitution, conservation),
- et préserver la traçabilité via `metadata` si une normalisation est appliquée.

#### Contrat `text_handling` (plugin.json)

Pour les plugins de chiffrement/déchiffrement, le comportement recommandé est de **déclarer** la politique de traitement texte dans `plugin.json` afin que le Plugin Executor puisse appliquer une normalisation commune avant l'exécution.

Clé optionnelle : `text_handling`

```json
"text_handling": {
  "fields": ["text"],
  "allowed_ranges": ["0041-005A"],
  "allowed_characters": " \\t\\r\\n",
  "unknown_char_policy": "warn_keep",
  "normalize": {
    "remove_diacritics": true,
    "case": "upper",
    "map_characters": {"μ": "µ"}
  }
}
```

- `fields` : liste des champs d'inputs à normaliser (par défaut `text`).
- `allowed_ranges` : plages Unicode autorisées (`HEX-HEX`).
- `allowed_characters` : caractères autorisés additionnels (souvent whitespace ` \t\r\n`).
- `unknown_char_policy` :
  - `keep` : ne change rien.
  - `warn_keep` : conserve mais avertit.
  - `strip` : supprime les caractères non supportés.
  - `error` : bloque l'exécution si caractères non supportés.
- `normalize.remove_diacritics` : supprime les accents via décomposition Unicode (ex: `é` → `e`).
- `normalize.case` : `preserve|upper|lower`.
- `normalize.map_characters` : substitutions directes (ex: `μ` → `µ`).

Note : cette normalisation est réalisée **côté Plugin Executor** avant l'appel `/api/plugins/<name>/execute`.

---

## 9) Méta-plugins (pipeline)

Exemple : `analysis_web_page`.

### Principe

Un méta-plugin déclare `pipeline` dans `plugin.json` :

```json
"pipeline": [
  {"plugin_name": "coordinates_finder"},
  {"plugin_name": "qr_code_detector"}
]
```

Le plugin exécute ensuite chaque sous-plugin via `PluginManager.execute_plugin()` et agrège les résultats.

### Convention d’agrégation des coordonnées

`analysis_web_page` applique une priorité (configurée dans le code) :

`coordinates_finder` > `formula_parser` > `coordinate_projection` > `qr_code_detector` > ...

Il retourne :

- `combined_results` (détails par sous-plugin)
- `results` (liste aplatie, avec `source_plugin` sur chaque item)
- `primary_coordinates` si trouvées

---

## 9bis) Metasolver — Orchestration dynamique de plugins de chiffrement

Le plugin `metasolver` (v2.0) est un méta-plugin spécialisé qui orchestre l'exécution
de **plugins de chiffrement/déchiffrement** de manière dynamique et configurable.

### 9bis.1 Éligibilité des plugins

Un plugin est utilisable par le metasolver s'il déclare la section `metasolver` dans
son `plugin.json` :

```json
"metasolver": {
  "eligible": true,
  "input_charset": "letters",
  "tags": ["frequent", "classic", "substitution", "no_key"],
  "priority": 90
}
```

Champs :

- **`eligible`** (`bool`, requis) — opt-in explicite. Seuls les plugins avec `eligible: true` sont considérés.
- **`input_charset`** (`enum`) — type principal de caractères en entrée : `letters`, `digits`, `symbols`, `words`, `mixed`.
- **`tags`** (`string[]`) — tags de classement pour le filtrage par presets. Tags courants :
  - `frequent` : codes les plus courants en géocaching
  - `classic` : codes classiques historiques
  - `substitution` : codes de substitution
  - `transposition` : codes de transposition
  - `numeral` : systèmes numériques
  - `no_key` : codes sans clé (idéal pour l'exécution automatique)
- **`priority`** (`int 0-100`) — priorité d'exécution (plus élevé = exécuté en premier).

### 9bis.2 Presets

Les presets sont définis dans `plugins/official/metasolver/presets.json` et permettent
de filtrer les plugins éligibles selon des critères prédéfinis.

Presets disponibles :

| Preset | Description | Filtre |
|---|---|---|
| `all` | Tous les plugins éligibles | *(aucun filtre)* |
| `frequent` | Codes fréquents en géocaching | `tags: ["frequent"]` |
| `letters_only` | Codes à entrée lettres | `input_charset: ["letters"]` |
| `digits_only` | Codes à entrée chiffres | `input_charset: ["digits"]` |
| `symbols_only` | Codes à entrée symboles | `input_charset: ["symbols"]` |
| `words_only` | Codes à entrée mots | `input_charset: ["words"]` |
| `substitution` | Codes de substitution | `tags: ["substitution"]` |
| `transposition` | Codes de transposition | `tags: ["transposition"]` |
| `numeral` | Systèmes numériques | `tags: ["numeral"]` |
| `no_key` | Codes sans clé | `tags: ["no_key"]` |

Pour ajouter un preset personnalisé, éditer `presets.json` :

```json
"mon_preset": {
  "label": "Mon preset",
  "description": "Description",
  "filter": {
    "tags": ["frequent", "substitution"],
    "input_charset": ["letters", "digits"]
  }
}
```

La logique de filtrage est :
- **tags** : OR (au moins un tag commun)
- **input_charset** : le charset du plugin doit être dans la liste
- Les deux critères sont combinés en AND

### 9bis.3 Inputs du metasolver

- `text` : texte à analyser
- `mode` : `decode` ou `detect`
- `preset` : nom du preset (défaut : `all`)
- `plugin_list` : liste explicite de noms de plugins (si renseigné, le preset est ignoré)
- `enable_bruteforce` : transmet le mode brute-force aux plugins compatibles
- `detect_coordinates` : demande la détection GPS
- `max_plugins` : limite le nombre de plugins exécutés

### 9bis.4 Logique de sélection des candidats

1. Lister les plugins activés
2. Ne retenir que `metasolver.eligible = true`
3. Filtrer par `capabilities` (analyze/decode) selon le mode
4. Appliquer le filtre du preset (tags / input_charset)
5. Si `plugin_list` explicite : ne garder que ces plugins (ignore preset et éligibilité)
6. Trier par `priority` décroissante puis par nom
7. Limiter au `max_plugins` si spécifié

### 9bis.5 Plugins NON éligibles

Les plugins suivants ne sont **pas** éligibles au metasolver car ils ne sont pas des
codes de chiffrement :

- Plugins image : `qr_code_detector`, `easyocr_ocr`, `vision_ocr`
- Plugins analyse web : `color_text_detector`, `html_comments_finder`, `image_alt_text_extractor`
- Plugins coordonnées : `coordinates_finder`, `coordinate_projection`, `formula_parser`, `written_coords_*`, `wherigo_reverse_decoder`
- Plugins meta : `analysis_web_page`, `additional_waypoints_analyzer`

---

## 10) Frontend Theia — Plugin Executor (référence fonctionnelle)

Les documents provisoires `PLUGIN_EXECUTOR_*.md` décrivent l’UX de l’executor Theia.

### 10.1 Deux modes d’exécution

- **PLUGIN MODE** : ouvert depuis la liste des plugins
  - plugin pré-sélectionné
  - encode/decode possible

- **GEOCACHE MODE** : ouvert depuis une géocache
  - géocache toujours associée
  - choix du plugin via dropdown
  - typiquement “decode” seulement
  - enchaînement de plugins possible

### 10.2 Brute-force

- Activé si `plugin.json` contient `brute_force: true`.
- Paramètre envoyé au backend : `inputs.brute_force=true`.
- `enable_scoring` peut être envoyé en option (si supporté) pour trier les résultats.

### 10.3 Détection de coordonnées dans les résultats (frontend)

Côté Theia, une option peut déclencher une détection de coordonnées dans `result.results[*].text_output`.

- Le backend possède une fonction de détection (`detect_gps_coordinates`) utilisée en batch.
- Le frontend appelle typiquement un endpoint dédié (`/api/detect_coordinates`) géré dans un autre blueprint (hors `/api/plugins`).

### 10.4 Intégration GeocacheDetails -> Executor

Le widget GeocacheDetails construit un `GeocacheContext` (gc_code, description, coords, images, waypoints) et ouvre l’executor en GEOCACHE MODE.

---

## 11) Développer un plugin Python (guide)

### 11.1 Étapes

1. Créer un dossier : `gc-backend/plugins/custom/<nom_plugin>/`
2. Ajouter `plugin.json`.
3. Ajouter `main.py` (ou autre fichier déclaré comme `entry_point`).
4. Relancer la découverte : `POST /api/plugins/discover`.
5. Tester : `POST /api/plugins/<nom_plugin>/execute`.

### 11.2 Conventions de code

- Créer une classe qui finit par `Plugin`.
  - idéalement `MonPluginNamePlugin` selon la convention du wrapper.
- Implémenter une méthode `execute(self, inputs: dict) -> dict`.
- Retourner un objet au format “résultat” (section 8).

### 11.3 Exemple minimal

`plugin.json` :

```json
{
  "name": "mon_plugin",
  "version": "1.0.0",
  "plugin_api_version": "2.0",
  "description": "Mon plugin",
  "author": "Moi",
  "plugin_type": "python",
  "entry_point": "main.py",
  "categories": ["Substitution"],
  "input_types": {
    "text": {"type": "string", "label": "Texte"}
  }
}
```

`main.py` :

```python
import time

class MonPluginPlugin:
    def __init__(self):
        self.name = "mon_plugin"
        self.version = "1.0.0"

    def execute(self, inputs):
        start = time.time()
        text = inputs.get("text", "")
        return {
            "status": "ok",
            "summary": "OK",
            "results": [{"id": "result_1", "text_output": text, "confidence": 1.0}],
            "plugin_info": {
                "name": self.name,
                "version": self.version,
                "execution_time_ms": int((time.time() - start) * 1000)
            }
        }
```

---

## 12) Points d’attention (cohérence / limites)

- **Statuts hétérogènes** : certains plugins renvoient `success` au lieu de `ok`. Recommandation : converger vers `ok|error`.
- **UI `/interface`** : c’est un rendu HTML “debug”, pas un contrat complet pour tous les types.
- **`heavy_cpu` / policies** : ces flags existent en metadata, mais l’exécution n’est pas encore isolée par ProcessPool (à considérer si nécessaire).
- **Timeout** : plafonné par préférences si `allowLongRunning=false`.

---

## 13) Checklist “plugin prêt”

- `plugin.json` valide (schema + champs nécessaires).
- `entry_point` existe.
- La classe plugin est détectable (`*Plugin`).
- `execute()` renvoie un résultat conforme.
- Les inputs “contexte géocache” (`geocache_id`, `text`, `images`, `waypoints`) sont gérés si le plugin le nécessite.
- Si le plugin produit des coordonnées : remplir `primary_coordinates` et/ou `decimal_latitude`/`decimal_longitude`.
- Si le plugin est un code de chiffrement/déchiffrement : ajouter la section `metasolver` avec `eligible: true`, `input_charset`, `tags` et `priority` (cf. section 9bis).

