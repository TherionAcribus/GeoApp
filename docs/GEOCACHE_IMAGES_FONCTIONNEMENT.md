# Gestion des images de géocaches (GeoApp)

Ce document décrit l’architecture, les flux d’exécution et les endpoints liés à la gestion des images de géocaches dans GeoApp.

## Objectif

- **Lister** les images associées à une géocache.
- **Enrichir** chaque image avec des métadonnées (titre, note, OCR, QR, tags, etc.).
- **Stocker localement** (optionnel) une image distante afin d’avoir une copie persistante côté GeoApp.
- Préparer les futures fonctionnalités de **duplication** et **crop** (dérivés d’images).

## Concepts

### Image legacy vs image v2

GeoApp a historiquement stocké les images dans un champ JSON legacy sur `Geocache` :

- `Geocache.images` : liste JSON d’objets `{ "url": "..." }`

Le système v2 introduit une table relationnelle :

- `GeocacheImage` (table `geocache_image`) : une ligne par image + métadonnées + gestion stockage local.

La v2 est utilisée par l’API dédiée et par l’UI Theia (`GeocacheImagesPanel`).

## Architecture (vue d’ensemble)

- **Backend Flask**
  - Modèle SQLAlchemy : `gc_backend/geocaches/models.py` (`GeocacheImage`)
  - Synchronisation / backfill : `gc_backend/geocaches/image_sync.py`
  - Stockage local (download/cleanup) : `gc_backend/geocaches/image_storage.py`
  - API REST : `gc_backend/blueprints/geocache_images.py`
  - Hooks :
    - suppression géocache → cleanup fichiers locaux
    - refresh/import → sync legacy JSON → images v2

- **Frontend Theia**
  - UI : `theia-extensions/zones/src/browser/geocache-images-panel.tsx`
  - Intégration dans le widget de détails : `theia-extensions/zones/src/browser/geocache-details-widget.tsx`

## Modèle de données : `GeocacheImage`

Table : `geocache_image`

Champs principaux :

- `id` (int)
- `geocache_id` (FK vers `geocache.id`)
- `source_url` (string) : URL d’origine (distante)

Stockage local :

- `stored` (bool)
- `stored_path` (string)
- `mime_type` (string)
- `byte_size` (int)
- `sha256` (string)

Dérivation / édition (préparation) :

- `parent_image_id` (FK vers `geocache_image.id`)
- `derivation_type` (string, ex: `original`, `duplicate`, `crop`)
- `crop_rect` (JSON)

Métadonnées :

- `title` (string)
- `note` (text)
- `tags` (JSON)
- `detected_features` (JSON)
- `qr_payload` (text)
- `ocr_text` (text)
- `ocr_language` (string)

Audit :

- `created_at` / `updated_at`

### URL “d’affichage”

Le backend expose une URL calculée :

- Si l’image est stockée localement : `url = /api/geocache-images/<id>/content`
- Sinon : `url = source_url`

Côté Theia, si `url` commence par `/`, elle doit être résolue avec `backendBaseUrl`.

## Stockage local sur disque

### Emplacement

Les images stockées localement sont sauvegardées sous :

- `gc-backend/data/geocache_images/<geocache_id>/<image_id>.<ext>`

Ce dossier doit être ignoré par Git.

### Routines

- Téléchargement d’une image (HTTP) + calcul de hash + écriture sur disque.
- Cleanup du dossier lors de la suppression d’une géocache.

Les utilitaires sont dans :

- `gc_backend/geocaches/image_storage.py`

## Endpoints REST

Blueprint : `gc_backend/blueprints/geocache_images.py`

### `GET /api/geocaches/<geocache_id>/images`

- **But** : lister les images v2 d’une géocache.
- **Réponse** : liste de `GeocacheImage.to_dict()`.

### `PATCH /api/geocache-images/<image_id>`

- **But** : mise à jour des métadonnées (titre, note, OCR, QR…)
- **Body JSON** (exemples) :
  - `{ "title": "...", "note": "..." }`
  - `{ "qr_payload": "..." }`
  - `{ "ocr_text": "...", "ocr_language": "fr" }`

### `POST /api/geocache-images/<image_id>/store`

- **But** : télécharger et stocker localement une image (si pas déjà stockée).
- **Réponse** : image mise à jour (incluant `stored=true` et `url=/api/geocache-images/<id>/content`).

### `POST /api/geocaches/<geocache_id>/images/store`

- **But** : stocker localement toutes les images v2 d’une géocache.
- **Réponse** : `{ stored_count, updated: [...] }` (format exact selon implémentation).

### `GET /api/geocache-images/<image_id>/content`

- **But** : servir le binaire de l’image stockée.
- **Réponse** : `image/*` (ou type détecté), depuis le fichier local.

### `POST /api/geocaches/<geocache_id>/images/cleanup` (optionnel)

- **But** : supprimer les fichiers locaux d’une géocache (sans supprimer les lignes DB).

## Synchronisation legacy → v2

### Backfill

Lors du démarrage (init DB) et lors des imports/refresh, GeoApp synchronise :

- `Geocache.images` (legacy JSON) → lignes `GeocacheImage` (v2)

Raison : rester compatible avec l’existant tout en permettant un enrichissement par image.

Modules :

- `gc_backend/geocaches/image_sync.py`

### Migration Alembic

Une migration Alembic crée la table `geocache_image` et effectue un backfill idempotent :

- `gc-backend/migrations/versions/add_geocache_image_table.py`

## Intégration UI Theia

## Préférences

### `geoApp.images.storage.defaultMode`

Cette préférence contrôle le comportement par défaut du panel d’images lorsqu’une géocache contient des images non encore stockées localement.

Valeurs :

- `never` : ne lance jamais de stockage automatique.
- `prompt` (défaut) : propose une confirmation (dialog) pour stocker toutes les images non stockées.
- `always` : stocke automatiquement toutes les images non stockées.

Notes :

- La demande de confirmation (mode `prompt`) est déclenchée depuis `GeocacheDetailsWidget` via un `ConfirmDialog`.
- Le comportement est appliqué **une seule fois par géocache** pour éviter de re-demander à chaque rafraîchissement.

### `geoApp.images.gallery.thumbnailSize`

Cette préférence contrôle la taille par défaut des vignettes dans la galerie.

Valeurs :

- `small` (défaut)
- `medium`
- `large`

Dans `GeocacheImagesPanel`, l’utilisateur peut aussi changer la taille via les boutons **S/M/L**.
Le choix est persisté dans les préférences utilisateur (scope `User`).

### Composant : `GeocacheImagesPanel`

- Affichage “filmstrip” (vignettes) + panneau inspecteur.
- Badges : stocké localement, note, QR, OCR, dérivé.
- Actions :
  - **Stocker** l’image sélectionnée
  - **Stocker toutes** les images
  - **Sauvegarder** les métadonnées (PATCH)

Fichier :

- `theia-extensions/zones/src/browser/geocache-images-panel.tsx`

### Intégration dans les détails

- `GeocacheDetailsWidget` utilise désormais le panel au lieu du rendu legacy.

Fichier :

- `theia-extensions/zones/src/browser/geocache-details-widget.tsx`

## Dépannage

### Les images stockées ne s’affichent pas dans Theia

Symptôme : les images avec une `url` de la forme `/api/geocache-images/<id>/content` ne se chargent pas.

Cause : URL relative résolue sur le host Theia.

Solution : préfixer avec `backendBaseUrl` dans le panel (déjà appliqué).

### `flask db upgrade` échoue avec `pyproj` ou `playwright`

Dans certains environnements, ces dépendances ne sont pas installées.

- `pyproj` est requis seulement pour le calcul de distance de certains endpoints coordonnées.
- `playwright` est requis seulement pour les endpoints checkers.

GeoApp rend ces imports optionnels au démarrage; les endpoints concernés renvoient une erreur explicite si la dépendance manque.
