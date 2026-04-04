# Written Coordinates Plugins — FR/EN v1 (Backend)

## Objectif

Ajouter une reconnaissance de coordonnées GPS **écrites en toutes lettres** (ex: "nord quarante huit degres ...") via un système de plugins modulable par langue.

Principes :

- **Opt-in** : activable explicitement via l'API `/api/detect_coordinates`.
- **Validation centralisée** : les candidats générés par les plugins sont validés par `detect_gps_coordinates()` (regex multi-formats) afin de garder une cohérence globale.
- **Modulaire** : un plugin parent orchestre des plugins enfants par langue.

---

## Architecture

### 1) Plugin parent (orchestrateur)

- **Nom** : `written_coords_converter`
- **Dossier** : `gc-backend/plugins/official/written_coords_converter/`
- **Rôle** :
  - appeler les plugins enfants (ex: `written_coords_fr`)
  - valider les candidats via `detect_gps_coordinates()`
  - renvoyer une structure riche (`results`, `combined_results`, `primary_coordinates`)

### 2) Plugin enfant par langue

- **Nom FR** : `written_coords_fr`
- **Dossier** : `gc-backend/plugins/official/written_coords_fr/`
- **Rôle** :
  - parser le texte (accents manquants + concat éventuel)
  - produire une liste de candidats `text_output` (DDM standard)

- **Nom EN** : `written_coords_en`
- **Dossier** : `gc-backend/plugins/official/written_coords_en/`
- **Rôle** :
  - parse du texte anglais (direction + degrés + minutes)
  - supporte les formes speech-to-text (ex: `point one two three`, `hundred twenty three`)

### 3) Service backend réutilisable

- **Fichier** : `gc-backend/gc_backend/services/written_coordinates_service.py`
- **Classe** : `WrittenCoordinatesService`
- **Rôle** :
  - API interne pour appeler le plugin parent depuis n'importe quel endroit du backend

---

## API — opt-in

Endpoint :

- `POST /api/detect_coordinates`

Body JSON (extraits) :

- `text` (string) : requis
- `include_numeric_only` (bool) : existant
- `include_written` (bool) : **opt-in** (défaut `false`)
- `written_languages` (list|string CSV) : défaut `['fr']` (ex: `['fr', 'en']`)
- `written_max_candidates` (int) : défaut `20`
- `written_include_deconcat` (bool) : défaut `true`

Réponse :

- Structure standard `detect_gps_coordinates`.
- Si `include_written=true`, un champ additionnel est ajouté :
  - `written.enabled`
  - `written.attempted`
  - `written.candidates`
  - `written.combined_results`

---

## Contrat plugins

### Plugin enfant (ex: `written_coords_fr`)

Entrée (`inputs`) :

- `text` (string)
- `max_candidates` (int)
- `include_deconcat` (bool)

Sortie (`result`) :

- `results[*].text_output` : une proposition de coordonnée (ex: `N 48° 51.400' E 002° 21.050'`)
- `results[*].confidence` : confiance interne (0..1)
- `results[*].metadata` : infos debug (optionnel)

### Plugin parent (`written_coords_converter`)

Sortie :

- `results[*]` : candidats validés (avec `coordinates` quand validé)
- `combined_results` : sorties brutes des enfants
- `primary_coordinates` : meilleure coordonnée validée (si existante)

---

## Ajouter une langue (ex: ES)

1. Créer un dossier :

- `gc-backend/plugins/official/written_coords_es/`

2. Ajouter :

- `plugin.json` (nom `written_coords_es`, `entry_point: main.py`)
- `main.py` avec une classe `WrittenCoordsEsPlugin` (ou `*Plugin`) exposant `execute(inputs)`.

3. Le plugin parent utilisera automatiquement :

- `written_coords_<lang>` (donc `written_coords_es`)

4. Activer côté API :

- `written_languages: ["fr", "es"]`

---

## Notes / limites (v1)

- Le parsing FR v1 vise les formes proches :
  - directions (nord/sud/est/ouest)
  - degrés + minutes (avec séparateur `virgule/point` ou `.`/`,`) 
  - tolérance accents manquants via normalisation unicode
  - tolérance concat via segmentation par vocabulaire (heuristique)

- La robustesse ultime (concat extrême) sera itérative :
  - enrichissement vocabulaire
  - ajout de règles lexicales
  - scoring/tri plus fin des candidats
