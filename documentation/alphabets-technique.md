# Alphabets - Documentation technique

Ce document decrit l'architecture technique du module Alphabets de GeoApp.
Il est destine aux developpeurs et aux agents IA qui doivent maintenir,
corriger ou etendre le systeme.

Derniere mise a jour : juin 2026

---

## 1. Objectif

Le module Alphabets permet de consulter et utiliser des alphabets de
geocaching, de codes secrets et de symboles graphiques.

Il couvre deux familles d'alphabets :

- les alphabets rendus par police (`type: "font"`) ;
- les alphabets rendus par images (`type: "images"`).

L'utilisateur peut :

- rechercher un alphabet par nom, description, tags ou README ;
- ouvrir un viewer pour un alphabet ;
- cliquer des symboles pour construire un texte decode ;
- reordonner, supprimer, dupliquer ou inserer des symboles ;
- saisir directement le texte decode ;
- associer une geocache par code GC ;
- detecter des coordonnees dans le texte decode ;
- ouvrir l'outil dedie des chiffres cisterciens.

Le systeme est volontairement tolerant en lecture cote backend, mais strict en
validation de depot via `scripts/validate-alphabets.js`.

---

## 2. Emplacements principaux

| Zone | Fichiers |
|---|---|
| Donnees alphabets | `alphabets/<alphabet_id>/alphabet.json`, `fonts/`, `images/`, `README.md` |
| Backend Flask | `backend/gc_backend/blueprints/alphabets.py` |
| Types partages | `frontend/theia-extensions/alphabets/src/common/alphabet-protocol.ts` |
| Service frontend | `frontend/theia-extensions/alphabets/src/browser/services/alphabets-service.ts` |
| Liste des alphabets | `frontend/theia-extensions/alphabets/src/browser/alphabets-list-widget.tsx` |
| Viewer alphabet | `frontend/theia-extensions/alphabets/src/browser/alphabet-viewer-widget.tsx` |
| Gestion onglets | `frontend/theia-extensions/alphabets/src/browser/alphabet-tabs-manager.ts` |
| Contribution Theia | `frontend/theia-extensions/alphabets/src/browser/alphabets-contribution.ts` |
| Module Inversify | `frontend/theia-extensions/alphabets/src/browser/alphabets-frontend-module.ts` |
| Resolveur symboles | `frontend/theia-extensions/alphabets/src/browser/alphabet-symbol-resolver.ts` |
| Composant symbole | `frontend/theia-extensions/alphabets/src/browser/components/symbol-item.tsx` |
| Symbole resolu image/font | `frontend/theia-extensions/alphabets/src/browser/components/resolved-symbol-item.tsx` |
| Association geocache | `frontend/theia-extensions/alphabets/src/browser/components/geocache-association.tsx` |
| Detection coordonnees | `frontend/theia-extensions/alphabets/src/browser/components/coordinates-detector.tsx` |
| Chiffres cisterciens | `frontend/theia-extensions/alphabets/src/browser/cistercian-numerals-widget.tsx` |
| Validateur depot | `scripts/validate-alphabets.js` |

---

## 3. Architecture generale

Flux principal :

```text
Utilisateur / Theia
        |
        v
AlphabetsListWidget
        |
        v
AlphabetsService
        |
        v
Backend Flask /api/alphabets
        |
        v
alphabets/<id>/alphabet.json + assets
```

Ouverture d'un alphabet :

```text
AlphabetsListWidget
        |
        v
AlphabetsListContribution.openAlphabetViewer()
        |
        v
AlphabetTabsManager.openAlphabet()
        |
        v
AlphabetViewerWidget
        |
        +--> AlphabetsService.getAlphabet()
        +--> AlphabetsService.getFontUrl()
        +--> resolveAlphabetImageSource()
```

Detection de coordonnees :

```text
AlphabetViewerWidget
        |
        v
CoordinatesDetector
        |
        +--> AlphabetsService.detectCoordinates()
        +--> AlphabetsService.calculateDistance()
```

Association geocache :

```text
AlphabetViewerWidget
        |
        v
GeocacheAssociation
        |
        v
AlphabetsService.getGeocacheByCode()
```

---

## 4. Backend Flask

Blueprint :

```text
backend/gc_backend/blueprints/alphabets.py
```

### 4.1 Dossier des alphabets

Le backend lit les alphabets depuis :

```python
current_app.config['ALPHABETS_DIR']
```

avec fallback vers :

```text
<repo>/alphabets
```

La liste complète des configs normalisées est mise en cache mémoire par
`get_all_alphabets()`. Le cache est invalidé automatiquement via une signature
`(nom, mtime)` de chaque `alphabet.json` (une édition est donc détectée sans
redémarrage) et explicitement par `POST /api/alphabets/discover`
(`invalidate_alphabets_cache()`). Comme la recherche ajoute `search_score` /
`search_matches` sur les dicts, l'endpoint `GET /api/alphabets` opère sur une
copie défensive pour ne pas polluer les objets partagés du cache.

### 4.2 Normalisation backend

La fonction centrale est :

```python
normalize_alphabet_config(config)
```

Elle garantit que les payloads API sont compatibles avec le frontend moderne :

- `alphabetConfig.characters` existe ;
- `characters.letters` vaut toujours `"all"` ou `string[]` ;
- `characters.numbers` vaut toujours `"all"` ou `string[]` ;
- `None`, `false`, `""`, `"false"` deviennent `[]` ;
- l'ancien champ `alphabetConfig.special` est migre vers
  `alphabetConfig.characters.special` ;
- `special` est supprime s'il est vide.

Cette normalisation est volontairement non destructive : elle ne modifie pas les
fichiers JSON sur disque, elle corrige uniquement la reponse API.

### 4.3 Endpoints

| Methode | URL | Role |
|---|---|---|
| `GET` | `/api/alphabets` | Liste tous les alphabets, avec recherche optionnelle. |
| `GET` | `/api/alphabets/<alphabet_id>` | Retourne la configuration complete normalisee. |
| `GET` | `/api/alphabets/<alphabet_id>/resource/<path>` | Sert une image ou ressource d'alphabet. |
| `GET` | `/api/alphabets/<alphabet_id>/font` | Sert la police TTF d'un alphabet font. |
| `GET` | `/api/alphabets/<alphabet_id>/sources` | Retourne sources et credits. |
| `GET` | `/api/alphabets/<alphabet_id>/readme` | Retourne le README si present. |
| `POST` | `/api/alphabets/discover` | Rescan simple du dossier et retour de la liste. |

Les ressources binaires (images, polices) sont servies par `send_alphabet_file`
avec un `Cache-Control: max-age` (defaut 1 jour, surchargeable via la config
`ALPHABET_ASSET_MAX_AGE`). La validation conditionnelle `send_file` reste active :
un rechargement apres expiration renvoie un `304` leger si le fichier n'a pas
change. Cela evite de re-telecharger chaque image a chaque reouverture d'un viewer.

`alphabet_id` et le chemin relatif (`resource_path` ou `fontFile`) viennent de
l'URL / du JSON et ne doivent jamais etre concatenes directement dans un
`os.path.join` passe a `send_file`. Le flux securise est :

1. `resolve_alphabet_directory(alphabet_id)` verifie que le dossier resolu reste
   sous `ALPHABETS_DIR` (protection contre un `alphabet_id` contenant des
   segments `..`) et retourne `None` sinon ;
2. `send_alphabet_file(directory, relative_path, **kwargs)` delegue a
   `flask.send_from_directory`, qui fait le safe-join du chemin relatif et leve
   `NotFound` (capte dans les vues, transforme en 404 JSON) en cas d'evasion.

Ne jamais reintroduire `os.path.join(_get_alphabets_dir(), alphabet_id, ...)`
suivi de `send_file()` sur le resultat : c'est le pattern qui permettait une
traversee de chemin (`curl --path-as-is` ne normalise pas les `..`, contrairement
aux navigateurs).

### 4.4 Recherche

`GET /api/alphabets` accepte :

| Parametre | Defaut | Role |
|---|---|---|
| `search` | vide | Requete texte. |
| `search_in_name` | `true` | Recherche dans nom et description. |
| `search_in_tags` | `true` | Recherche dans les tags. |
| `search_in_readme` | `false` | Recherche dans le README. |

Quand une recherche est active, le backend ajoute :

- `search_score` ;
- `search_matches`.

Les resultats sont tries par `search_score` decroissant. Le frontend doit
preserver cet ordre.

La recherche backend normalise la casse et les accents, puis enrichit la
requete avec des synonymes metier (`SEARCH_SYNONYMS`). Cela permet a des termes
utilisateur comme `marin`, `runique`, `alien`, `cochon`, `telegraphe` ou
`couleur` de retrouver des alphabets pertinents meme si le mot exact n'est pas
present dans le nom. Le README est lu via un cache `lru_cache` pour eviter de
relire les fichiers lors de recherches repetees.

---

## 5. Contrat `alphabet.json`

Chaque alphabet vit dans :

```text
alphabets/<alphabet_id>/
```

Fichier minimal :

```json
{
  "name": "Nom lisible",
  "description": "Description courte",
  "type": "cipher",
  "category": "alphabet",
  "version": "1.0",
  "tags": ["geocaching", "symbols"],
  "alphabetConfig": {
    "type": "images",
    "imageDir": "images",
    "imageFormat": "png",
    "hasUpperCase": false,
    "upperCaseOnly": false,
    "characters": {
      "letters": "all",
      "numbers": [],
      "special": {
        ".": "dot"
      }
    }
  }
}
```

### 5.1 Champs racine

| Champ | Type | Obligatoire | Role |
|---|---|---|---|
| `name` | string | oui | Nom affiche dans la liste. |
| `description` | string | recommande | Description courte. |
| `type` | string | recommande | Type fonctionnel global. |
| `category` | string | optionnel | Categorie UI/metier. |
| `version` | string | optionnel | Version de la definition. |
| `tags` | string[] | optionnel | Recherche et filtrage. |
| `sources` | object[] | optionnel | Credits, references, auteurs. |
| `alphabetConfig` | object | oui | Configuration de rendu. |

`id` n'est pas stocke dans le JSON. Il est injecte par le backend depuis le nom
du dossier.

### 5.2 `alphabetConfig`

| Champ | Type | Pour | Role |
|---|---|---|---|
| `type` | `"font"` ou `"images"` | tous | Strategie de rendu. |
| `fontFile` | string | font | Chemin relatif vers la police. |
| `imageDir` | string | images | Dossier des images. |
| `imageFormat` | string | images | Extension sans point, ex. `png`. |
| `lowercaseSuffix` | string | images | Suffixe optionnel des minuscules. |
| `uppercaseSuffix` | string | images | Suffixe optionnel des majuscules. |
| `hasUpperCase` | boolean | tous | Indique si l'alphabet distingue les majuscules. |
| `upperCaseOnly` | boolean | tous | Indique que seules les majuscules doivent etre proposees. |
| `characters` | object | tous | Lettres, chiffres, symboles speciaux. |
| `imageFiles` | string[] | images | Injecte par le backend : fichiers presents dans `imageDir`. Absent des fichiers JSON sur disque. |

### 5.3 `characters`

| Champ | Type valide | Role |
|---|---|---|
| `letters` | `"all"` ou `string[]` | Lettres supportees. `"all"` signifie `a-z`. |
| `numbers` | `"all"` ou `string[]` | Chiffres supportes. `"all"` signifie `0-9`. |
| `special` | `Record<string,string>` | Mapping caractere insere -> nom de ressource. |

Valeurs interdites dans le depot :

- `letters: false`
- `numbers: false`
- `numbers: ""`
- `alphabetConfig.special`

Ces anciens formats sont toleres par le backend, mais refuses par le validateur.

---

## 6. Conventions de rendu

### 6.1 Alphabets par police

Exemple :

```json
{
  "alphabetConfig": {
    "type": "font",
    "fontFile": "fonts/dagger.ttf",
    "hasUpperCase": false,
    "characters": {
      "letters": "all",
      "numbers": []
    }
  }
}
```

Le frontend charge la police avec :

```ts
AlphabetsService.getFontUrl(alphabetId)
```

La famille CSS est generee par :

```ts
getFontFamily(alphabetId)
```

Convention :

- la valeur inseree dans le texte reste le caractere clique (`a`, `B`, `1`,
  espace, ponctuation, etc.) ;
- le nom du fichier de police ne doit jamais apparaitre dans le texte decode.

### 6.2 Alphabets par images

Le frontend utilise le resolveur commun :

```ts
resolveAlphabetImageSource(alphabetId, alphabetConfig, char, alphabetsService)
```

Les candidats d'image sont calcules par :

```ts
getImageResourcePathCandidates(alphabetConfig, char)
```

Pour un alphabet `type: "images"`, le backend renseigne
`alphabetConfig.imageFiles` : la liste des fichiers reellement presents dans
`imageDir` (noms de fichiers, sans chemin). Quand ce manifeste est disponible,
le resolveur choisit le premier candidat dont le nom de fichier appartient a la
liste et n'effectue **aucune** requete reseau. Le probing d'images
(`probeImageUrl`, chargement d'un `Image()` par URL candidate) n'est conserve
que comme repli pour les anciens payloads sans `imageFiles`.

Le manifeste est mis en cache cote backend (`list_alphabet_image_files`) et vide
par `POST /api/alphabets/discover`, en meme temps que le cache README.

Pour une lettre, le resolveur teste plusieurs conventions :

- `images/a.png`
- `images/A.png`
- `images/a_lowercase.png`
- `images/A_lowercase.png`
- `images/A_uppercase.png`
- `images/a_uppercase.png`

L'ordre exact depend de :

- `hasUpperCase` ;
- `upperCaseOnly` ;
- la casse du caractere demande.

Pour un chiffre, le chemin attendu est :

```text
<imageDir>/<digit>.<imageFormat>
```

Pour un caractere special, le mapping est obligatoire :

```json
"special": {
  ".": "dot",
  ",": "comma",
  "ä": "AE_umlaut"
}
```

Le caractere de gauche est celui qui est insere dans le texte decode. La valeur
de droite est uniquement le nom de ressource image, sans extension.

---

## 7. Frontend Theia

### 7.1 Module et injection

Le module principal est :

```text
frontend/theia-extensions/alphabets/src/browser/alphabets-frontend-module.ts
```

Il bind :

- `AlphabetsService` en singleton ;
- `AlphabetsListWidget` ;
- `AlphabetViewerWidget` ;
- `CistercianNumeralsWidget` ;
- `AlphabetTabsManager` en singleton ;
- `AlphabetsListContribution`.

### 7.2 Commandes Theia

Les commandes sont declarees dans `alphabet-protocol.ts` :

| Commande | Role |
|---|---|
| `alphabets.openList` | Ouvre la vue liste. |
| `alphabets.refresh` | Recharge la liste courante. |
| `alphabets.openViewer` | Ouvre un viewer pour un alphabet donne. |
| `alphabets.openCistercian` | Ouvre l'outil des chiffres cisterciens. |
| `alphabets.discover` | Force la redecouverte backend. |
| `alphabets.deleteLastSymbol` | Supprime le dernier symbole dans le viewer. |
| `alphabets.addSpace` | Ajoute un espace. |
| `alphabets.undo` | Annule. |
| `alphabets.redo` | Retablit. |
| `alphabets.exportState` | Exporte l'etat du viewer. |
| `alphabets.importState` | Importe un etat. |

### 7.3 Service frontend

`AlphabetsService` centralise tous les appels HTTP du module.

Il utilise :

```text
geoApp.backend.apiBaseUrl
```

avec fallback :

```text
http://localhost:8000
```

Le service expose :

| Methode | Role |
|---|---|
| `listAlphabets(searchOptions?)` | Liste et recherche. |
| `getAlphabet(alphabetId)` | Charge une configuration complete. |
| `getFontUrl(alphabetId)` | Construit l'URL de police. |
| `getResourceUrl(alphabetId, resourcePath)` | Construit l'URL d'une ressource. |
| `discoverAlphabets()` | Appelle `/api/alphabets/discover`. |
| `detectCoordinates(text, originCoords?)` | Appelle `/api/detect_coordinates`. |
| `calculateDistance(originLat, originLon, destLat, destLon)` | Appelle `/api/calculate_coordinates`. |
| `getGeocacheByCode(code)` | Charge une geocache par code GC. |
| `invalidateCache(alphabetId?)` | Vide tout ou partie du cache. |

Regles importantes :

- ne pas ajouter de `fetch` direct dans les composants ;
- passer par `AlphabetsService` pour garder base URL, timeout et cache coherents ;
- lors d'un changement de preference backend, le client Axios est reconstruit, le
  cache du service est invalide **et** les caches du resolveur d'images/polices
  sont vides (`clearAlphabetResolverCaches`) car ils memorisent des URLs absolues ;
- les preferences persistantes de la liste sont chargees en un seul appel
  (`getAllPreferences`), pas une requete par cle.

### 7.4 Liste des alphabets

`AlphabetsListWidget` :

- charge la liste via `AlphabetsService.listAlphabets()` ;
- gere la recherche backend ;
- preserve l'ordre `search_score` quand une recherche est active ;
- ajoute localement le faux item `Chiffres cisterciens` uniquement s'il matche ;
- affiche les previews avec la meme logique image/font que le viewer ;
- persiste favoris, recents et preferences d'affichage via les preferences
  backend GeoApp, avec `localStorage` comme cache/fallback ;
- ignore les reponses obsoletes via un compteur de requete.

Chaque ligne est rendue par le composant isole `AlphabetListItem`, qui gere son
propre etat de survol local. Survoler un item (surbrillance, apparition de la
preview au survol) ne re-rend que cet item : le widget parent n'appelle plus
`update()` sur les evenements souris. Ne pas reintroduire de `this.update()` dans
les handlers de survol.

### 7.5 Viewer alphabet

`AlphabetViewerWidget` :

- charge l'alphabet via `AlphabetsService.getAlphabet()` ;
- charge les polices si necessaire ;
- affiche les symboles disponibles ;
- affiche les symboles entres ;
- gere drag and drop, menu contextuel, suppression, duplication et insertion ;
- synchronise le textarea avec `enteredChars` ;
- gere undo/redo via un historique centralise ;
- exporte/import l'etat ;
- integre association geocache et detection de coordonnees.

La fonction cle d'ecriture d'etat est :

```ts
commitEnteredChars(nextChars, saveHistory = true)
```

Toute modification de `enteredChars` par une action discrète (clic, suppression,
duplication, insertion, drag, import) doit passer par cette fonction pour eviter
les doublons d'historique et les divergences textarea/symboles.

La saisie clavier dans le textarea passe par `commitTypedChars`, qui met a jour
l'etat immediatement mais **diffère et regroupe** le snapshot d'historique
(`HISTORY_SNAPSHOT_DEBOUNCE_MS`). Une rafale de frappe produit ainsi une seule
entree d'undo au lieu d'une par caractere, et n'evince plus l'historique de clics
(taille `maxHistorySize`). Toute action discrete fige d'abord le snapshot de
frappe en attente (`flushPendingHistorySnapshot`) ; `undo`/`redo` le figent aussi
avant de naviguer dans l'historique.

### 7.6 Reponses obsoletes

Les operations asynchrones lentes sont protegees par des compteurs de sequence :

- `loadAlphabets` dans la liste ;
- `loadAlphabet` dans le viewer ;
- analyse dans `CoordinatesDetector`.

Objectif : une reponse lente ne doit pas remplacer un etat plus recent.

---

## 8. Gestion des coordonnees

`CoordinatesDetector` surveille le texte decode.

Il appelle :

- `AlphabetsService.detectCoordinates()` pour detecter une coordonnee ;
- `AlphabetsService.calculateDistance()` si une geocache associee fournit une
  origine.

Les erreurs backend doivent etre affichees sans casser le viewer. Si le texte
devient vide, la sequence d'analyse est incrementee et l'etat de detection est
nettoye.

---

## 9. Association geocache

`GeocacheAssociation` permet de lier le travail courant a une geocache.

Flux :

```text
code GC saisi
        |
        v
AlphabetsService.getGeocacheByCode()
        |
        v
AssociatedGeocache
        |
        v
AlphabetViewerWidget state
```

Le composant ne doit pas connaitre l'URL backend. Toute evolution d'API doit
passer par `AlphabetsService`.

---

## 10. Chiffres cisterciens

L'outil `CistercianNumeralsWidget` est un outil special, affiche dans la liste
comme une entree virtuelle.

Il n'est pas stocke dans `alphabets/` et ne suit pas le schema
`alphabet.json`.

Regles UI :

- sans recherche, il est trie avec les alphabets affiches ;
- avec recherche active, il est ajoute localement seulement s'il matche la
  requete ;
- il ne doit pas perturber l'ordre `search_score` renvoye par le backend.

---

## 11. Validation

Le script de validation est :

```text
scripts/validate-alphabets.js
```

Commande :

```bash
node scripts/validate-alphabets.js
```

Le validateur echoue si :

- un `alphabet.json` est invalide ;
- `alphabetConfig` est absent ;
- `alphabetConfig.special` est encore utilise ;
- `characters.letters` ou `characters.numbers` n'est ni `"all"` ni `string[]` ;
- `characters.special` n'est pas un objet ;
- une police referencee est absente ;
- une police referencee a une extension non supportee ;
- une police referencee a une signature binaire incompatible avec son extension ;
- une police TTF/OTF n'expose pas un repertoire SFNT valide ou les tables
  minimales attendues ;
- une police WOFF/WOFF2 a un header incoherent ;
- un dossier ou format image est absent ;
- une image attendue pour une lettre, un chiffre ou un special est absente ;
- un special pointe vers une ressource vide.

Le validateur est plus strict que le backend. C'est intentionnel :

- le backend reste compatible avec les anciens fichiers ;
- le depot doit rester propre pour ne pas recreer les anciens bugs.

---

## 12. Ajouter un alphabet

### 12.1 Alphabet par police

1. Creer :

```text
alphabets/<id>/alphabet.json
alphabets/<id>/fonts/<font>.ttf
```

2. Declarer :

```json
{
  "name": "Exemple Font",
  "description": "Alphabet rendu par police.",
  "tags": ["font", "geocaching"],
  "alphabetConfig": {
    "type": "font",
    "fontFile": "fonts/example.ttf",
    "hasUpperCase": false,
    "characters": {
      "letters": "all",
      "numbers": []
    }
  }
}
```

3. Lancer :

```bash
node scripts/validate-alphabets.js
```

### 12.2 Alphabet par images

1. Creer :

```text
alphabets/<id>/alphabet.json
alphabets/<id>/images/
```

2. Ajouter les images selon les conventions du resolveur.

3. Declarer :

```json
{
  "name": "Exemple Images",
  "description": "Alphabet rendu par images.",
  "tags": ["images", "geocaching"],
  "alphabetConfig": {
    "type": "images",
    "imageDir": "images",
    "imageFormat": "png",
    "hasUpperCase": false,
    "characters": {
      "letters": "all",
      "numbers": ["1", "2", "3"],
      "special": {
        ".": "dot"
      }
    }
  }
}
```

4. Lancer :

```bash
node scripts/validate-alphabets.js
```

---

## 13. Tests et verifications

### 13.1 Validation donnees

Depuis la racine du depot :

```bash
node scripts/validate-alphabets.js
```

### 13.2 Build extension

Depuis l'extension :

```bash
cd frontend/theia-extensions/alphabets
yarn build
```

### 13.3 Scenarios manuels recommandes

Verifier au minimum :

- recherche par nom ;
- recherche par tag ;
- recherche dans README ;
- ouverture d'un viewer depuis la liste ;
- preview d'un alphabet image ;
- preview d'un alphabet font ;
- ajout de symboles ;
- suppression de symboles ;
- drag and drop de symboles ;
- menu contextuel symbole ;
- undo/redo depuis l'etat vide ;
- saisie dans le textarea ;
- association d'une geocache ;
- detection de coordonnees ;
- backend indisponible : message d'erreur clair, widget non casse.

Alphabets de regression utiles :

- `betamaze`
- `birds_on_a_wire`
- `drapeaux_maritimes`
- `prussia_telegraph`
- `puzzle`
- `space_invaders`
- `dagger_code`

---

## 14. Points d'attention pour les IA

Avant de modifier le module :

1. Lire `alphabet-protocol.ts` pour connaitre le contrat TypeScript.
2. Lire `alphabets.py` pour connaitre la normalisation backend.
3. Lire `alphabet-symbol-resolver.ts` avant de changer le rendu image.
4. Ne pas ajouter de nouvel appel HTTP direct dans les composants React.
5. Ne pas modifier `enteredChars` hors de `commitEnteredChars()` dans le viewer.
6. Lancer le validateur apres toute modification de `alphabets/`.
7. Lancer `yarn build` apres toute modification TypeScript.

Invariant important :

```text
caractere clique/insere != nom de fichier image
```

Exemple :

```json
"special": {
  ".": "dot"
}
```

Le texte decode doit contenir `"."`, jamais `"dot"`.

---

## 15. Evolutions possibles

Pistes futures sans changer le contrat actuel :

- ajouter un endpoint de validation backend pour un alphabet donne ;
- afficher les erreurs de ressources manquantes dans l'UI de liste ;
- ajouter des tests unitaires frontend pour `alphabet-symbol-resolver.ts` ;
- ajouter des tests backend pour `normalize_alphabet_config()` ;
- enrichir les metadonnees avec langue, famille de code, difficulte ou usage ;
- precharger les premieres images visibles dans la liste pour reduire le
  scintillement ;
- ajouter un mode edition d'alphabet avec validation immediate.
