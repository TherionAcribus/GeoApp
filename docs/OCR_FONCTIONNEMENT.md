# Système OCR (GeoApp)

Ce document décrit l’architecture, les flux d’exécution, les composants et la configuration du système d’OCR (reconnaissance de texte) dans GeoApp.

## Objectifs

- Extraire du texte depuis une image de géocache.
- Supporter plusieurs moteurs :
  - **EasyOCR (offline)** : OCR local, sans IA externe.
  - **Vision OCR via LMStudio (local)** : modèle vision OpenAI-compatible (via plugin backend).
  - **Vision OCR Cloud via Theia AI** : modèle vision Cloud (OpenAI / compat) via l’infrastructure IA de Theia.
- Enregistrer le résultat directement sur l’image (`ocr_text`, `ocr_language`) via l’API images v2.
- Gérer correctement :
  - Les images distantes vs images stockées localement.
  - Les modèles “thinking” qui ajoutent des blocs de raisonnement (`[THINK]...`).
  - Le feedback utilisateur (animation de chargement sur la vignette).

## Vue d’ensemble (architecture)

### Backend (Flask)

- **API Images v2** (métadonnées + stockage local) :
  - `gc_backend/blueprints/geocache_images.py`
  - Stockage local : `gc_backend/geocaches/image_storage.py`
- **Services OCR** (bibliothèques / appels HTTP) :
  - EasyOCR : `gc_backend/services/ocr/easyocr_service.py`
  - Vision LMStudio : `gc_backend/services/ocr/lmstudio_vision_service.py`
  - Utilitaires image (base64, mime) : `gc_backend/services/ocr/image_utils.py`
- **Plugins OCR officiels** (exécutés via le PluginManager) :
  - `plugins/official/easyocr_ocr/` (EasyOCR)
  - `plugins/official/vision_ocr/` (LMStudio vision)

### Frontend (Theia)

- **UI galerie & métadonnées** :
  - `theia-extensions/zones/src/browser/geocache-images-panel.tsx`
- **Intégration dans la fiche géocache** :
  - `theia-extensions/zones/src/browser/geocache-details-widget.tsx`
- **IA Cloud (Theia AI)** :
  - `@theia/ai-core` : `LanguageModelRegistry`, `LanguageModelService`

## Modèle de données (images v2)

Voir aussi `docs/GEOCACHE_IMAGES_FONCTIONNEMENT.md`.

Champs OCR principaux sur `GeocacheImage` :

- `ocr_text` : texte OCR (string)
- `ocr_language` : langue (string, ex: `fr`, `en`, `auto`)

## Flux end-to-end (UI → OCR → sauvegarde)

### 1) L’utilisateur lance un OCR depuis la galerie

Dans `GeocacheImagesPanel`, l’utilisateur déclenche l’action via le menu contextuel de la vignette.

Actions OCR disponibles :

- `OCR (EasyOCR)` → plugin backend `easyocr_ocr`
- `OCR (IA - LMStudio)` → plugin backend `vision_ocr` (LMStudio)
- `OCR (IA - Cloud)` → appel direct via Theia AI (pas de plugin backend)

### 2) Pré-requis critique : image servie en binaire

Certaines images proviennent de `source_url` (distante) et ne sont pas stockées localement.

- Le backend expose une URL d’affichage `url` :
  - si `stored=true` : `url = /api/geocache-images/<id>/content`
  - sinon : `url = source_url`

Pour garantir un OCR fiable, `GeocacheImagesPanel` tente d’abord :

- `POST /api/geocache-images/<id>/store`

Cela évite les cas où un endpoint renverrait autre chose que des bytes d’image (HTML/JSON d’erreur), ce qui aboutirait à un OCR vide.

### 3) Exécution OCR

#### A) EasyOCR (offline)

- Exécution via plugin `easyocr_ocr`.
- Le plugin télécharge l’image (ou lit le fichier local si `stored`) puis appelle :
  - `gc_backend/services/ocr/easyocr_service.extract_text_from_image_bytes(...)`

Robustesse : le service EasyOCR applique des fallbacks si aucun texte n’est détecté :

- essai avec prétraitement
- puis sans prétraitement
- puis `paragraph=False`

#### B) Vision OCR via LMStudio (local)

- Exécution via plugin `vision_ocr`.
- Le plugin télécharge l’image puis appelle :
  - `gc_backend/services/ocr/lmstudio_vision_service.vision_ocr_via_lmstudio(...)`

L’image est envoyée comme **data URL (base64)** dans un payload OpenAI-compatible.

#### C) Vision OCR Cloud via Theia AI

- Exécution côté Theia (frontend), sans passer par Flask.
- Le panel :
  - télécharge l’image en `blob`
  - convertit en base64
  - crée une requête `UserRequest` avec :
    - message `type: 'image'` (base64 + mime)
    - message `type: 'text'` (prompt)
  - envoie via `languageModelService.sendRequest(...)`

Avantage : aucune manipulation directe de clé API dans GeoApp.

### 4) Nettoyage du texte (modèles “thinking”)

Certains modèles (souvent locaux) renvoient un raisonnement encadré, par ex :

- `[THINK]...[/THINK]` puis le texte final
- `<think>...</think>`

Pour éviter d’enregistrer la “pensée” dans `ocr_text`, GeoApp applique un nettoyage :

- Backend LMStudio : `strip_thinking_blocks()` dans `gc_backend/services/ocr/lmstudio_vision_service.py`
- Plugin `vision_ocr` : réapplique le nettoyage avant `text_output` (défense en profondeur)
- Frontend : applique un nettoyage avant de patcher `ocr_text` (pour OCR Cloud et aussi par sécurité sur les réponses plugins)

Blocs supprimés :

- `[THINK]...[/THINK]`, `<think>...</think>`
- `[ANALYSIS]...[/ANALYSIS]`, `<analysis>...</analysis>`

### 5) Sauvegarde des résultats OCR

Quel que soit le moteur, le résultat est persisté via :

- `PATCH /api/geocache-images/<image_id>`

Payload typique :

```json
{
  "ocr_text": "...",
  "ocr_language": "fr"
}
```

## Feedback utilisateur (loading / animation)

Le panel d’images affiche un indicateur de chargement **sur la vignette concernée** pendant l’OCR :

- overlay sombre
- spinner
- libellé `OCR…`

Cela est géré via un état par image : `ocrInProgressById`.

## Endpoints & API impliqués

### Images

- `GET /api/geocaches/<geocache_id>/images`
- `PATCH /api/geocache-images/<image_id>`
- `POST /api/geocache-images/<image_id>/store`
- `GET /api/geocache-images/<image_id>/content`

### Exécution plugins OCR

- `POST /api/plugins/easyocr_ocr/execute`
- `POST /api/plugins/vision_ocr/execute`

Format général (simplifié) :

```json
{
  "inputs": {
    "geocache_id": 42,
    "images": [{"url": "http://..."}],
    "language": "fr"
  }
}
```

Réponse plugin (simplifiée) :

```json
{
  "status": "success",
  "summary": "...",
  "results": [
    {
      "id": "ocr_1",
      "text_output": "...",
      "confidence": 0.9,
      "image_url": "...",
      "method": "easyocr|lmstudio|vision"
    }
  ],
  "images_analyzed": 1
}
```

## Préférences OCR

Les préférences sont décrites globalement dans `docs/PREFERENCES.md`.

Préférences utilisées par la galerie OCR :

- `geoApp.ocr.defaultEngine`
  - `easyocr_ocr` ou `vision_ocr`
- `geoApp.ocr.defaultLanguage`
  - ex: `auto`, `fr`, `en`
- `geoApp.ocr.lmstudio.baseUrl`
  - ex: `http://localhost:1234`
- `geoApp.ocr.lmstudio.model`
  - identifiant du modèle LMStudio vision

Côté Theia AI (Cloud), la sélection de modèle est faite via `LanguageModelRegistry.selectLanguageModel({ identifier: 'default/universal' })`.

## Dépannage (symptômes courants)

### 1) “Plugin success” mais OCR vide

Causes fréquentes :

- L’URL fetchée ne renvoie pas une image (HTML/JSON)
- l’image n’est pas stockée localement et `/content` ne renvoie pas de binaire image
- EasyOCR trop strict (prétraitement)

Correctifs :

- S’assurer que l’image est stockée via `/store` avant OCR
- Vérifier les logs plugin (content-type, status code)
- Pour EasyOCR : les fallbacks sont déjà en place

### 2) Le champ OCR contient du texte de raisonnement

Cause : modèle “thinking”.

Correctif :

- Le nettoyage `strip_thinking_blocks` est appliqué backend + frontend.

### 3) OCR Cloud ne trouve pas de modèle

Cause : aucun modèle configuré côté Theia AI pour `default/universal`.

Correctif :

- Configurer un modèle vision dans les paramètres IA Theia et le rendre disponible pour cet identifiant.

## Sécurité

- GeoApp évite de manipuler directement les clés Cloud dans le code OCR Cloud : l’appel passe par l’infrastructure IA de Theia.
- Pour LMStudio : la requête est locale mais reste un appel HTTP ; limiter l’exposition réseau si nécessaire.

## Fichiers clés (référence)

- Frontend :
  - `theia-extensions/zones/src/browser/geocache-images-panel.tsx`
  - `theia-extensions/zones/src/browser/geocache-details-widget.tsx`
- Backend :
  - `gc_backend/services/ocr/easyocr_service.py`
  - `gc_backend/services/ocr/lmstudio_vision_service.py`
  - `plugins/official/easyocr_ocr/main.py`
  - `plugins/official/vision_ocr/main.py`
