# Plugins — Documentation technique

> Système de plugins de chiffrement / déchiffrement / résolution de MysterAI (GeoApp).
> Couvre le moteur backend (Flask), le format des plugins, l'API REST et l'extension Theia.
> Dernière mise à jour : juin 2026

---

## 1. Vue d'ensemble

Le sous-système **Plugins** est le cœur fonctionnel de GeoApp pour le décodage des géocaches *Mystery*. Chaque plugin est une unité autonome capable d'**encoder**, **décoder** ou **analyser/détecter** un type de codage (César, Affine, Morse, Bacon, Base64, alphabets symboliques, transformations de coordonnées, etc.).

Principes de conception :

1. **Découverte dynamique** : les plugins sont décrits par un fichier `plugin.json` et découverts au démarrage (scan récursif de `plugins/official/` et `plugins/custom/`).
2. **Métadonnées en base** : chaque plugin est enregistré dans la table `plugins` (SQLAlchemy), ce qui permet le filtrage, l'activation/désactivation et la génération d'interfaces.
3. **Chargement paresseux (lazy loading)** : le code Python d'un plugin n'est importé/instancié qu'au premier appel, puis mis en cache.
4. **Sortie standardisée** : tous les plugins retournent le même format JSON (`status` / `results` / `plugin_info`), ce qui permet un scoring, un classement et un affichage uniformes.
5. **Orchestration** : par-dessus les plugins individuels, le **Metasolver** recommande et exécute automatiquement des chaînes de plugins, et un moteur de **workflow** classe un listing et planifie sa résolution.

À ce jour le dépôt contient **84 plugins officiels** (`plugins/official/`) et un répertoire `plugins/custom/` pour les plugins utilisateur.

---

## 2. Architecture

### 2.1 Structure des fichiers

```
GeoApp/
├── plugins/
│   ├── README.md                       # Doc d'auteur de plugins
│   ├── official/                       # 84 plugins fournis (lecture seule)
│   │   └── affine_code/
│   │       ├── plugin.json             # Métadonnées + schéma d'entrée
│   │       ├── main.py                 # Implémentation (classe ...Plugin)
│   │       ├── test_affine_code.py     # Tests unitaires
│   │       └── README.md               # (optionnel)
│   └── custom/                         # Plugins ajoutés par l'utilisateur
│
├── backend/gc_backend/
│   ├── plugins/
│   │   ├── plugin_manager.py           # PluginManager (découverte, cache, exécution)
│   │   ├── models.py                   # Modèle SQLAlchemy `Plugin`
│   │   ├── wrappers.py                 # Wrappers d'exécution (Python / Binary) + factory
│   │   ├── schemas/plugin.schema.json  # JSON Schema (draft-07) de plugin.json
│   │   ├── code_solving/               # Boîte à outils partagée (codes secrets)
│   │   │   ├── charset.py              # WordCodec, tokenizers
│   │   │   ├── digits.py               # Fragments de chiffres, confiance
│   │   │   ├── fragments.py            # Découpe en mots, fusion, scoring de couverture
│   │   │   └── params.py               # parse_mode_params, normalisation, accents
│   │   └── scoring/                    # Scoring linguistique
│   │       ├── scorer.py               # score_text, score_and_rank_results
│   │       ├── langid.py               # Détection de langue (trigrammes)
│   │       └── resources/              # n-grammes, stopwords, geo_terms (8 langues)
│   └── blueprints/
│       └── plugins.py                  # Blueprint Flask `/api/plugins` (~7500 lignes)
│
└── frontend/theia-extensions/plugins/  # Extension Theia (UI Plugin Executor)
    └── src/
        ├── common/plugin-protocol.ts   # Types & interface de service partagés
        └── browser/
            ├── plugin-executor-widget.tsx     # Widget principal d'exécution
            ├── plugins-browser-widget.tsx     # Catalogue des plugins
            ├── batch-plugin-executor-widget.tsx # Exécution par lot (multi-géocaches)
            ├── metasolver-streaming-panel.tsx # Panneau metasolver (SSE)
            ├── metasolver-preset-panel.tsx    # Sélection de presets
            └── services/plugins-service.ts    # Client HTTP vers /api/plugins
```

### 2.2 Vue en couches

```
┌──────────────────────────────────────────────────────────────┐
│  Extension Theia (frontend)                                    │
│  Plugin Executor · Batch · Metasolver · Catalogue              │
│  PluginsServiceImpl ──HTTP──▶ /api/plugins                     │
└──────────────────────────────────────────────────────────────┘
                              │
┌──────────────────────────────────────────────────────────────┐
│  Blueprint Flask  (blueprints/plugins.py, prefix /api/plugins) │
│  Validation · Scoring · Metasolver · Workflow · Batch          │
└──────────────────────────────────────────────────────────────┘
                              │
┌──────────────────────────────────────────────────────────────┐
│  PluginManager (plugins/plugin_manager.py)                     │
│  Découverte · Validation schéma · DB upsert · Cache · Exécution│
└──────────────────────────────────────────────────────────────┘
        │                      │                      │
┌───────────────┐   ┌────────────────────┐   ┌──────────────────┐
│ Modèle Plugin │   │ Wrappers           │   │ code_solving /   │
│ (SQLAlchemy)  │   │ Python / Binary    │   │ scoring (partagé)│
└───────────────┘   └────────────────────┘   └──────────────────┘
                              │
                  ┌──────────────────────┐
                  │ plugin.json + main.py │  (sur disque)
                  └──────────────────────┘
```

---

## 3. Le PluginManager

Fichier : `backend/gc_backend/plugins/plugin_manager.py`.

Le `PluginManager` est instancié une fois au démarrage de l'app (dans `gc_backend/__init__.py`) et exposé au blueprint via `init_plugin_manager(...)`. Il gère tout le cycle de vie d'un plugin.

### 3.1 État interne

| Attribut | Rôle |
|----------|------|
| `plugins_dir` | Racine des plugins (`Path`) |
| `app` | Instance Flask (pour `app_context()` lors des accès DB) |
| `loaded_plugins` | Cache `{nom: wrapper}` des plugins instanciés |
| `_schema` | JSON Schema de validation chargé en mémoire |
| `_plugin_cache` | Cache des métadonnées |
| `_loading_errors` | `{chemin: message}` des erreurs de découverte/chargement |
| `lazy_mode` | Si `True`, chargement à la demande (défaut) |
| `default_timeout` | Timeout d'exécution par défaut (60 s) |
| `allow_long_running` | Si `False`, plafonne les timeouts à `default_timeout` |

`default_timeout`, `lazy_mode` et `allow_long_running` sont lus depuis les préférences runtime (`_load_runtime_preferences`).

### 3.2 Découverte (`discover_plugins`)

La découverte est déléguée à `_discover_plugins_batched()` (version optimisée qui charge tous les plugins existants en une requête puis fait un upsert groupé avec un seul `commit`) :

1. (Re)chargement du JSON Schema.
2. Scan récursif de `plugins/official/` et `plugins/custom/` à la recherche de `plugin.json` (`rglob('plugin.json')`).
3. Pour chaque fichier : lecture JSON → **validation contre le schéma** (`jsonschema.validate`) → calcul d'un **hash MD5** du fichier.
4. **Upsert** en base : création si nouveau, mise à jour seulement si le hash a changé (`_upsert_plugin_record`).
5. **Nettoyage** : suppression en base des plugins dont le dossier n'existe plus (`_cleanup_deleted_plugins_batched`).
6. Les erreurs sont collectées dans `_loading_errors` (récupérables via `get_discovery_errors()`).

Le hash est stocké dans `metadata_json` pour éviter les écritures inutiles à chaque redémarrage.

### 3.3 Chargement paresseux (`get_plugin`)

```python
def get_plugin(self, plugin_name, force_reload=False) -> Optional[PluginInterface]
```

1. Si déjà en cache et pas de `force_reload` → renvoyé immédiatement.
2. Sinon : lecture du `Plugin` en DB (doit exister et être `enabled`).
3. Construction d'un `PluginMetadata` (avec timeout calculé via `_get_timeout_from_metadata`).
4. Création du wrapper adapté (`create_plugin_wrapper`) selon `plugin_type`.
5. `wrapper.initialize()` (import dynamique du module Python / vérification du binaire).
6. Mise en cache dans `loaded_plugins`.

### 3.4 Exécution (`execute_plugin`)

```python
def execute_plugin(self, plugin_name, inputs) -> Dict
```

- Récupère le plugin (lazy), appelle `wrapper.execute(inputs)`.
- En cas d'échec (plugin indisponible ou exception), renvoie un dictionnaire d'erreur **au format standardisé** (jamais d'exception non gérée vers l'appelant) :

```json
{
  "status": "error",
  "summary": "Erreur d'exécution: ...",
  "results": [],
  "plugin_info": {"name": "...", "version": "unknown", "execution_time_ms": 0},
  "error": {"type": "ExceptionClass", "message": "..."}
}
```

### 3.5 Cycle de vie complémentaire

- `unload_plugin` / `unload_all_plugins` : appellent `cleanup()` et vident le cache.
- `reload_plugin` / `reload_all_plugins` : décharge puis recharge (utile après édition d'un plugin).
- `preload_enabled_plugins` : précharge tous les plugins actifs lorsque `lazy_mode` est désactivé.
- `get_plugin_status` : état `{enabled, loaded, error}` de chaque plugin.

---

## 4. Le modèle de données `Plugin`

Fichier : `backend/gc_backend/plugins/models.py` — table `plugins`.

| Colonne | Type | Description |
|---------|------|-------------|
| `id` | int (PK) | Identifiant |
| `name` | str (unique, indexé) | Nom snake_case |
| `version` | str | Version sémantique |
| `plugin_api_version` | str | Version de l'API plugin (défaut `2.0`) |
| `description`, `author` | str | Métadonnées descriptives |
| `plugin_type` | str | `python` / `rust` / `binary` / `wasm` / `node` |
| `source` | str (indexé) | `official` ou `custom` |
| `path`, `entry_point` | str | Localisation et fichier d'entrée |
| `categories` | JSON | Liste de catégories |
| `input_types` | JSON | Définition des champs du formulaire |
| `heavy_cpu`, `needs_network`, `needs_filesystem` | bool | Politiques d'exécution |
| `enabled` | bool (indexé) | Activation |
| `metadata_json` | text | `plugin.json` complet (+ `_hash`) |
| `created_at`, `updated_at` | datetime | Timestamps |

Méthodes clés :

- `to_dict(include_metadata=False)` : sérialisation pour l'API. Avec `include_metadata=True`, ajoute le `plugin.json` complet et **convertit** `input_types` en **JSON Schema** standard (`_convert_input_types_to_json_schema`).
- Conversion des types : `select` → `string` + `enum`, `checkbox` → `boolean`, `number`/`integer` avec `minimum`/`maximum`/`multipleOf`, etc.

---

## 5. Les wrappers d'exécution

Fichier : `backend/gc_backend/plugins/wrappers.py`.

Tous les wrappers implémentent l'interface abstraite `PluginInterface` :

```python
class PluginInterface(ABC):
    def initialize(self) -> bool: ...   # charge/valide les ressources (une fois)
    def execute(self, inputs) -> dict: ...  # exécution principale
    def cleanup(self) -> bool: ...      # libération des ressources
```

La factory `create_plugin_wrapper(plugin_type, metadata, plugin_manager)` choisit l'implémentation selon `PluginType` (`python`, `rust`, `binary`, `wasm`, `node`).

### 5.1 `PythonPluginWrapper`

- **`initialize()`** : import dynamique du module via `importlib.util.spec_from_file_location`. Le dossier du plugin est temporairement ajouté à `sys.path` (puis retiré) pour permettre les imports relatifs/partagés.
- **Découverte de la classe** (`_find_plugin_class`) :
  1. cherche d'abord une classe nommée par convention `{Nom}Plugin` (ex : `affine_code` → `AffineCodePlugin`) ;
  2. sinon, la première classe dont le nom se termine par `Plugin`.
- Si le plugin expose `set_plugin_manager(...)`, le manager lui est injecté.
- **`execute()`** : appelle `instance.execute(inputs)` ; toute exception est convertie en sortie d'erreur standardisée.
- **`cleanup()`** : appelle `instance.cleanup()` si présent, libère module/instance.

### 5.2 `BinaryPluginWrapper`

- **`initialize()`** : vérifie l'existence et le caractère exécutable du binaire (extensions `.exe/.bat/.cmd` sur Windows, bit `X_OK` sur Unix).
- **`execute()`** : lance le binaire via `subprocess.Popen`, écrit les `inputs` sérialisés en **JSON sur stdin**, lit le résultat **JSON sur stdout**, applique le `timeout`. Code de retour ≠ 0 ⇒ erreur.

---

## 6. Format d'un plugin (`plugin.json`)

Le schéma de référence est `backend/gc_backend/plugins/schemas/plugin.schema.json` (JSON Schema draft-07).

### 6.1 Champs obligatoires

`name`, `version`, `plugin_api_version`, `plugin_type`, `entry_point`.

- `name` : `^[a-z0-9_]+$` (2–64 caractères).
- `version` : semver `^\d+\.\d+\.\d+(-…)?$`.
- `plugin_type` : `python` | `rust` | `binary` | `wasm` | `node`.

### 6.2 Champs courants

| Champ | Type | Rôle |
|-------|------|------|
| `categories` | array | Au moins 1 catégorie (ex. `AlphabetsDecryption`) |
| `kinds` | array | `code`, `calculator`, `image`, `geo`, `text`, `solver`, `analyze`, `meta` |
| `capabilities` | object | `analyze` / `decode` / `encode` (bool) |
| `brute_force` | bool | Supporte le mode bruteforce |
| `enable_scoring` | bool | Active le scoring linguistique automatique |
| `accept_accents` | bool | Accepte les caractères accentués |
| `heavy_cpu`, `needs_network`, `needs_filesystem` | bool | Politiques de sécurité/ressources |
| `timeout_seconds` | number | 1–300, défaut 30 |
| `defaults` | object | `include_in_analysis`, `include_in_decode` |
| `input_types` | object | Champs du formulaire (voir 6.3) |
| `output_types` | object | Descriptif des sorties (legacy/optionnel) |
| `text_handling` | object | Normalisation texte côté UI (voir 6.4) |
| `metasolver` | object | Éligibilité & classement metasolver (voir 6.5) |
| `pipeline` | array | Étapes pour méta-plugins (`plugin_name` + `description`) |

### 6.3 `input_types` — définition des formulaires

Chaque clé (`^[a-z_]+$`) décrit un champ. Types supportés : `string`, `number`, `float`, `select`, `checkbox`, `boolean`, `textarea`.

Propriétés : `label` (requis), `required`, `hidden`, `placeholder`, `default`, `description`, `options` (pour `select`, valeurs simples ou `{value, label}`), `min`/`max`/`step` (numériques), et **`default_value_source`** (pré-remplissage automatique en contexte géocache, ex. `geocache_id`, `geocache_description`, `geocache_coordinates`).

### 6.4 `text_handling` — normalisation

Permet à l'UI de normaliser le texte avant envoi :

- `fields` : champs concernés (défaut `["text"]`).
- `allowed_ranges` : plages Unicode `HEX-HEX` (ex. `0041-005A` pour A–Z).
- `allowed_characters` : caractères supplémentaires autorisés.
- `unknown_char_policy` : `keep` | `warn_keep` | `strip` | `error`.
- `normalize` : `remove_diacritics`, `case` (`preserve`/`upper`/`lower`), `map_characters`.

### 6.5 `metasolver` — éligibilité au méta-solveur

```json
"metasolver": {
  "eligible": true,
  "input_charset": "letters",        // letters|digits|symbols|words|mixed
  "tags": ["classic", "substitution", "no_key"],
  "priority": 60,                      // 0-100, plus haut = exécuté en premier
  "family": "substitution",
  "preferred_when": ["letters_only", "short_input"],
  "requires_key": false,
  "supports_grouped_input": false
}
```

Ces champs pilotent la **recommandation** et le **filtrage par preset** du metasolver (section 8).

### 6.6 Exemple complet

Voir <ref_file file="C:\Users\fabie\Documents\Projets\GeoApp\plugins\official\affine_code\plugin.json" /> (chiffre affine, encode/decode/bruteforce, `metasolver.eligible`).

---

## 7. Écrire un plugin Python

### 7.1 Contrat minimal

Le module `main.py` (ou `entry_point`) doit exposer une classe `{Nom}Plugin` avec une méthode `execute(self, inputs: dict) -> dict`. Méthodes optionnelles : `set_plugin_manager(...)`, `cleanup()`, `check_code(...)`.

```python
class MonPlugin:
    def __init__(self):
        self.name = "mon_plugin"
        self.version = "1.0.0"

    def execute(self, inputs: dict) -> dict:
        text = inputs.get("text", "")
        mode = str(inputs.get("mode", "decode")).lower()
        # ... logique ...
        return {
            "status": "ok",
            "summary": "Traitement réussi",
            "results": [
                {
                    "id": "result_1",
                    "text_output": "...",
                    "confidence": 0.5,
                    "parameters": {"mode": mode},
                    "metadata": {}
                }
            ],
            "plugin_info": {"name": self.name, "version": self.version,
                            "execution_time_ms": 0}
        }
```

Un exemple complet et idiomatique (encode/decode + bruteforce + gestion d'erreurs) se trouve dans <ref_file file="C:\Users\fabie\Documents\Projets\GeoApp\plugins\official\affine_code\main.py" />.

### 7.2 Format de sortie standardisé

```jsonc
{
  "status": "ok|error",
  "summary": "Message résumé",
  "results": [
    {
      "id": "result_1",
      "text_output": "Texte décodé",
      "confidence": 0.85,             // confiance propre au plugin
      "parameters": { "mode": "decode", "shift": 13 },
      "metadata": { },
      "coordinates": {                 // optionnel
        "exist": true,
        "decimal": {"lat": 49.123, "lon": 2.456},
        "raw": ["N 49° 07.380 E 002° 27.360"]
      }
    }
  ],
  "plugin_info": { "name": "...", "version": "...", "execution_time_ms": 42 }
}
```

> Convention de confiance : `encode` est déterministe (confiance 1.0, non rescorée) ; `decode` part d'une confiance modeste (≈0.5) puis est **rescorée** linguistiquement par le backend (section 9) ; `detect` est mise à 0.0 et dépend du scoring.

### 7.3 Boîte à outils partagée `code_solving`

Le module `gc_backend.plugins.code_solving` centralise la logique historiquement dupliquée dans ~20 plugins de codes secrets (modes `strict`/`embedded`, `allowed_chars`, accents). Import recommandé avec repli pour l'exécution standalone/tests :

```python
try:
    from gc_backend.plugins.code_solving import WordCodec, parse_mode_params
except ImportError:  # exécution hors backend (tests directs)
    import sys, pathlib
    sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[3] / "backend"))
    from gc_backend.plugins.code_solving import WordCodec, parse_mode_params
```

API exposée :

- **params** : `parse_mode_params` (analyse `mode`/`strict`/`embedded`/`allowed_chars`), `ModeParams`, `normalize_allowed_chars`, `remove_diacritics`, `parse_bool`, `is_alpha_strict`, `DEFAULT_ALLOWED_CHARS`.
- **fragments** : `Fragment`, `make_fragment`, `decode_fragments`, `split_into_words`, `iter_word_spans`, `merge_overlapping`, `coverage_score`, `apply_case`.
- **charset** : `WordCodec`, `fixed_width_tokenizer`, `whole_word_tokenizer`.
- **digits** : `extract_digit_fragments`, `is_strict_digits`, `confidence_from_fragments`.

### 7.4 Tests

Chaque plugin officiel possède un `test_<nom>.py` exécutable directement (les imports gèrent le repli `sys.path`). Lancer la suite via `pytest` à la racine backend/projet.

---

## 8. API REST — Blueprint `/api/plugins`

Fichier : `backend/gc_backend/blueprints/plugins.py` (~7500 lignes). Enregistré dans `gc_backend/__init__.py` :

```python
bp = Blueprint('plugins', __name__, url_prefix='/api/plugins')
# ...
app.register_blueprint(plugins_bp)
init_plugin_manager(plugin_manager)   # injecte le PluginManager global
```

Le manager est récupéré dans chaque vue via `get_plugin_manager()` (lève `RuntimeError` si non initialisé).

### 8.1 Découverte & catalogue

| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/` | Liste les plugins (`?source=`, `?category=`, `?enabled=`) |
| GET | `/<plugin_name>` | Détail d'un plugin (avec `metadata` + `input_schema`) |
| GET | `/<plugin_name>/interface` | Génère un formulaire HTML pour le plugin |
| POST | `/discover` | Relance le scan de découverte |
| GET | `/status` | État global (`enabled`/`loaded`/`error`) |
| POST | `/<plugin_name>/reload` | Recharge un plugin (unload + load) |

### 8.2 Exécution

| Méthode | Route | Description |
|---------|-------|-------------|
| POST | `/<plugin_name>/execute` | Exécution synchrone, corps `{ "inputs": {...} }` |

Déroulé de `/<plugin_name>/execute` :

1. Parse JSON (`force=True`), `inputs` requis (sinon 400).
2. `manager.execute_plugin(plugin_name, inputs)`.
3. **Scoring** (section 9) selon `enable_scoring` (flag d'entrée ou métadonnée du plugin) et le `mode` : `encode` non scoré, `detect` confiance 0, autres → scoring linguistique par tiers.
4. **Scoring IA** optionnel (`enable_ai_scoring`).
5. **Suivi** : si `geocache_id` fourni et résultats présents, enregistre le plugin dans la résolution (`ArchiveService.add_resolution_plugin`, non bloquant).
6. Réponse 200 avec `results`, `primary_coordinates`, `summary`.

Codes d'erreur : `400` (JSON/champ manquant), `404` (plugin/tâche/géocache introuvable), `500` (erreur d'exécution). Les erreurs de scoring/IA/coordonnées/suivi sont non bloquantes (journalisées en warning).

### 8.3 Scoring

| Méthode | Route | Description |
|---------|-------|-------------|
| POST | `/score` | Score un texte / une liste de textes (modèle linguistique) |
| POST | `/ai-score` | Score via LLM compatible OpenAI (provider, model, api_key…) |

### 8.4 Metasolver

| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/metasolver/eligible` | Plugins éligibles filtrés par `?preset=` |
| POST | `/metasolver/recommend` | Analyse la signature d'entrée et recommande des plugins |
| POST | `/metasolver/execute-stream` | Exécution en **streaming SSE** d'une liste de plugins |

`/metasolver/recommend` calcule une **signature** du texte (longueur, comptes lettres/chiffres, `looks_like_morse`, `looks_like_binary`, `dominant_input_kind`, `suggested_preset`) puis renvoie une liste de recommandations triées (`priority`, `score`, `confidence`, `tags`, `reasons`).

Événements SSE de `/metasolver/execute-stream` : `init`, `plugin_start`, `plugin_done`, `plugin_error`, `progress`, `result`.

### 8.5 Workflow & classification de listing

| Méthode | Route | Description |
|---------|-------|-------------|
| POST | `/listing/classify` | Classe un listing en familles d'énigmes + extrait des fragments « secrets » |
| POST | `/workflow/resolve` | Orchestration initiale (classification → plan d'étapes) |
| POST | `/workflow/run-next-step` | Exécute la prochaine étape automatisable |

Familles de workflow reconnues : `secret_code`, `formula`, `hidden_content`, `image_puzzle`, `checker`, `coord_transform` (+ `general`). Étapes automatisables : inspection HTML caché, inspection/description d'images, exécution directe d'un plugin, exécution metasolver, recherche de réponses, calcul des coordonnées finales, validation via checker.

### 8.6 Exécution par lot (batch)

| Méthode | Route | Description |
|---------|-------|-------------|
| POST | `/batch-execute` | Exécute un plugin sur plusieurs géocaches |
| GET | `/batch-status/<task_id>` | Progression d'une tâche batch |
| POST | `/batch-cancel/<task_id>` | Annule une tâche |
| GET | `/batch-list` | Liste les tâches (actives + terminées) |

La classe `BatchPluginTask` gère deux modes : **séquentiel** (boucle, vérification d'annulation entre itérations) et **parallèle** (`ThreadPoolExecutor(max_workers=max_concurrency)` avec push/pop du contexte Flask par thread). Pour chaque géocache, les inputs sont pré-remplis via `default_value_source` (gc_code, description, coordonnées, images, waypoints), puis les coordonnées sont extraites (`primary_coordinates`, champs `decimal_latitude/longitude`, ou détection GPS dans le texte).

---

## 9. Scoring linguistique

Module : `backend/gc_backend/plugins/scoring/` — API publique `score_text`, `score_text_fast`, `score_and_rank_results`.

Le scoring sert à **classer automatiquement** les multiples sorties d'un plugin (notamment en bruteforce) selon leur vraisemblance comme texte d'une langue naturelle / présence de coordonnées :

- Ressources par langue (8 langues : de/en/es/fr/it/nl/pl/pt) : **trigrammes** (langid), **quadgrams**, **stopwords**, **geo_terms**.
- `score_and_rank_results(items, top_k, min_score, fast_reject_threshold, context)` applique un **scoring par tiers** : rejet rapide des candidats improbables (`fast_reject_threshold`), scoring fin des survivants, tri décroissant, conservation du `top_k`.

Lors de l'exécution via `/<plugin_name>/execute`, la confiance « brute » du plugin est préservée dans `metadata.plugin_confidence` avant d'être remplacée par le score linguistique. Si le scoring filtre tous les résultats, la sortie brute est conservée avec un drapeau `scoring_filtered`.

Le **scoring IA** (`/ai-score`, `AIScorer`) est optionnel et s'appuie sur un LLM compatible OpenAI (provider/model/clé configurables) pour réévaluer les meilleurs candidats.

---

## 10. Extension Theia (frontend)

Dossier : `frontend/theia-extensions/plugins/`.

- **`common/plugin-protocol.ts`** : types partagés (`Plugin`, `PluginDetails`, `PluginInputs`, `PluginResult`, `MetasolverRecommendation…`, `ResolutionWorkflow…`) et l'interface `PluginsService`.
- **`services/plugins-service.ts`** (`PluginsServiceImpl`) : client HTTP (axios) vers `/api/plugins`. L'URL de base provient de la préférence `geoApp.backend.apiBaseUrl` (défaut `http://localhost:8000`) et se met à jour dynamiquement.
- **Widgets** :
  - `plugins-browser-widget.tsx` : catalogue/recherche des plugins.
  - `plugin-executor-widget.tsx` (+ `plugin-executor-form.tsx`, `plugin-result-display.tsx`) : exécution interactive d'un plugin, formulaire généré depuis `input_types`, affichage des résultats et coordonnées.
  - `batch-plugin-executor-widget.tsx` (+ `batch-map-view.tsx`) : exécution multi-géocaches et visualisation cartographique.
  - `metasolver-streaming-panel.tsx` + `metasolver-preset-panel.tsx` : pilotage du metasolver et affichage du flux SSE.
- **`services/batch-plugin-service.ts`**, **`services/tasks-service.ts`** : suivi des tâches batch.

L'UI applique aussi le `text_handling` (normalisation accents/casse/caractères) avant envoi et exploite `default_value_source` pour pré-remplir les champs en contexte géocache.

---

## 11. Ajouter un plugin personnalisé — checklist

1. Créer `plugins/custom/<mon_plugin>/`.
2. Écrire `plugin.json` conforme au schéma (`name` en snake_case, `entry_point`, `input_types`, etc.).
3. Écrire `main.py` avec une classe `{Nom}Plugin` exposant `execute(inputs) -> dict` au format standardisé.
4. (Recommandé) Ajouter `test_<mon_plugin>.py`.
5. Relancer la découverte : `POST /api/plugins/discover` (ou redémarrage du backend).
6. Vérifier dans `GET /api/plugins/status` que le plugin est `enabled` et sans erreur.

---

## 12. Sécurité & ressources

- **Validation stricte** de chaque `plugin.json` contre le JSON Schema avant enregistrement.
- **Déclarations de besoins** dans `plugin.json` : `heavy_cpu` (CPU intensif), `needs_network`, `needs_filesystem` — utilisées pour appliquer les bonnes politiques d'exécution.
- **Timeouts** : `timeout_seconds` (1–300) plafonné à `default_timeout` sauf si `allow_long_running` est activé.
- **Plugins binaires** : isolés via `subprocess`, communication JSON stdin/stdout, vérification d'exécutabilité.
- Les plugins `official/` sont en **lecture seule** ; les contributions utilisateur vont dans `custom/`.

---

## 13. Points d'attention / dette technique

- `discover_plugins()` contient du code mort après le `return self._discover_plugins_batched()` (ancienne implémentation non batchée conservée mais non exécutée).
- Quelques chaînes de log dans `_discover_plugins_batched` présentent des caractères mal encodés (`RÃ©pertoire`…) sans impact fonctionnel.
- L'exécution synchrone (`/<plugin_name>/execute`) ne pose pas de timeout dur côté blueprint : elle dépend de l'implémentation du plugin et du wrapper.
- Le batch utilise des **threads** (`ThreadPoolExecutor`), pas de `ProcessPool` ; pour des plugins réellement `heavy_cpu`, le GIL peut limiter le parallélisme.

---

## 14. Fichiers de référence

| Élément | Chemin |
|---------|--------|
| Manager | `backend/gc_backend/plugins/plugin_manager.py` |
| Modèle DB | `backend/gc_backend/plugins/models.py` |
| Wrappers | `backend/gc_backend/plugins/wrappers.py` |
| JSON Schema | `backend/gc_backend/plugins/schemas/plugin.schema.json` |
| Boîte à outils codes | `backend/gc_backend/plugins/code_solving/` |
| Scoring | `backend/gc_backend/plugins/scoring/` |
| API REST | `backend/gc_backend/blueprints/plugins.py` |
| Extension Theia | `frontend/theia-extensions/plugins/` |
| Exemple de plugin | `plugins/official/affine_code/` |
| Doc d'auteur | `plugins/README.md` |
