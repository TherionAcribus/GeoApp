# Galerie d'images — Documentation technique (`GeocacheImagesPanel`)

## Vue d'ensemble

`GeocacheImagesPanel` est le composant React gérant la **galerie d'images** en bas de la page de détails d'une géocache. C'est le composant le plus lourd de la page (`geocache-images-panel.tsx`, ~2500 lignes).

Il regroupe :
- Affichage en grille des vignettes avec tailles configurables (S/M/L)
- Stockage local des images distantes
- Analyse : OCR (EasyOCR / Vision IA), décodage QR, lecture EXIF
- Sélection d'images pour envoi au chat IA
- Édition des métadonnées (titre, note, QR, OCR)
- Duplication et édition d'images (lien vers éditeur externe)
- Filtrage par domaine masqué
- Visualiseur frame-par-frame des GIFs animés
- Upload d'images utilisateur

---

## Architecture du composant

### Découpage en deux niveaux

```
GeocacheImagesPanel           ← composant racine (état, logique, HTTP)
  └── ThumbnailItem           ← composant feuille mémoïsé (React.memo)
```

`ThumbnailItem` est défini **à l'extérieur** de `GeocacheImagesPanel` pour être stable entre les renders. Il reçoit uniquement des props primitives et des callbacks stables, ce qui garantit l'efficacité de `React.memo`.

### Interface de `ThumbnailItem`

```ts
interface ThumbnailItemProps {
    img: GeocacheImageV2Dto;
    isSelected: boolean;           // img.id === selectedId
    isOcrBusy: boolean;            // Boolean(ocrInProgressById[img.id])
    isHiddenDomain: boolean;       // isHiddenByDomain(img.source_url)
    isMissing: boolean;            // isMissingLocalImage(img)
    isChatSelected: boolean;       // chatImageIdsSet.has(img.id)
    isSaving: boolean;
    thumbnailImageClassName: string;
    thumbnailDimensions: { width: number; height: number };
    resolvedUrl: string;
    showChatToggle: boolean;       // Boolean(onAnalyzeImages)
    hasUsefulExifFeature: (img) => boolean;  // callback stable (useCallback)
    onCancelOcr: (imageId) => void;
    onClick: (imageId) => void;
    onContextMenu: (e, imageId) => void;
    onToggleChat: (imageId) => void;
}
```

Règle clé : **passer des booléens dérivés** (`isSelected`, `isChatSelected`...) plutôt que les états bruts (`selectedId`, `chatImageIds[]`). Quand la sélection change, seul 1 thumbnail change de prop `isSelected` → seul 1 thumbnail re-rend.

### DTO image

```ts
type GeocacheImageV2Dto = {
    id: number;
    geocache_id: number;
    url: string;               // URL servie (locale /api/... ou distante)
    source_url: string;        // URL d'origine (geoapp-upload:// pour les uploads)
    stored: boolean;
    parent_image_id?: number;  // défini si image dérivée
    derivation_type?: string;  // 'edited', 'snippet', 'copy'...
    image_type?: 'listing' | 'owner' | 'spoiler';
    title?: string;
    note?: string;
    mime_type?: string;
    byte_size?: number;
    qr_payload?: string;
    ocr_text?: string;
    detected_features?: Record<string, unknown>;  // inclut exif_reader
}
```

---

## Performance

### 1. `ThumbnailItem` mémoïsé

**Problème** : sans mémoïsation, chaque changement de `selectedId` ou `chatImageIds` re-rend toute la grille (potentiellement des dizaines de thumbnails).

**Solution** : `ThumbnailItem` est un `React.memo`. Il ne re-rend que quand **ses propres props** changent. Pour que ça fonctionne, les callbacks passés en props doivent être stables :

| Callback | Stabilité |
|---|---|
| `handleThumbnailClick` | `useCallback([], [])` — ne dépend que de setters d'état (stables) |
| `openThumbnailContextMenu` | `useCallback([], [])` — idem |
| `cancelOcrForImage` | `useCallback` déjà existant |
| `toggleChatImage` | `useCallback([maxChatImages, persistChatImageIds, selectableChatImageIds, warnIfChatSelectionIsHeavy])` |
| `hasUsefulExifFeature` | `useCallback([getExifFeature])` ; `getExifFeature` est `useCallback([])` |

### 2. `chatImageIdsSet`

```ts
const chatImageIdsSet = React.useMemo(() => new Set(chatImageIds), [chatImageIds]);
```

Remplace tous les `.includes(id)` O(n) par `.has(id)` O(1). Utilisé dans :
- `ThumbnailItem` (prop `isChatSelected`)
- La barre d'actions de la preview (bouton Chat)

### 3. `loading="lazy"` sur les `<img>`

Les vignettes hors de la zone visible (`max-height: 560px; overflow: auto`) ne se chargent pas au démarrage. Impact maximal sur les caches avec beaucoup d'images.

### 4. Calcul des badges dans `ThumbnailItem`

Les badges (SPOILER, LOCAL, MANQUANT, NOTE, QR, OCR, EXIF, DÉRIVÉE) sont calculés **à l'intérieur** de `ThumbnailItem`. Grâce à `React.memo`, ce calcul est court-circuité pour les thumbnails non impactés.

---

## Navigation et scroll

### Scroll automatique

Quand `selectedId` change (clic, upload, navigation clavier), le composant scrolle automatiquement la grille pour rendre le thumbnail visible :

```ts
// Dans GeocacheImagesPanel
const gridRef = React.useRef<HTMLDivElement | null>(null);

React.useEffect(() => {
    if (selectedId === null || !gridRef.current) return;
    const el = gridRef.current.querySelector<HTMLElement>(`[data-image-id="${selectedId}"]`);
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}, [selectedId]);
```

`block: 'nearest'` garantit que la grille ne scrolle pas si le thumbnail est déjà entièrement visible.

Chaque bouton thumbnail porte `data-image-id={img.id}` pour être ciblé par la query DOM.

### Navigation clavier

Un handler `onKeyDown` sur la div `.geoapp-images-grid` intercepte les touches flèches :

| Touche | Comportement |
|---|---|
| `←` | Image précédente dans la liste |
| `→` | Image suivante |
| `↑` | Ligne du dessus (colonne calculée dynamiquement) |
| `↓` | Ligne du dessous |

Le nombre de colonnes est lu depuis le CSS grid réel à l'instant du keydown :

```ts
const colCount = gridRef.current
    ? window.getComputedStyle(gridRef.current).gridTemplateColumns.split(' ').length
    : 1;
```

Cette approche s'adapte automatiquement aux changements de taille de vignettes (S/M/L) et aux redimensionnements de fenêtre.

Après navigation : `handleThumbnailClick(targetId)` (sélection) + `.focus()` (focus clavier) + l'`useEffect` scrolle automatiquement.

Si aucune image n'est sélectionnée lors du premier appui sur une flèche, la première image est sélectionnée.

---

## Barre d'actions de la preview

### Organisation

La barre d'actions (sous la preview de l'image sélectionnée) est divisée en deux niveaux pour éviter le débordement sur les écrans étroits :

**Actions principales** (toujours visibles) :
- `Éditer` — ouvre l'éditeur d'image externe
- `OCR` — lance l'OCR par défaut (EasyOCR ou Vision IA selon préférence)
- `QR` — décode les QR codes dans l'image
- `Exif` — lit les métadonnées EXIF
- `Lens` — recherche l'image sur Google Lens
- `Chat` *(conditionnel)* — ajoute/retire de la sélection chat

**Menu `...`** (actions secondaires, via `ContextMenu`) :
- `Dupliquer` — crée une copie dérivée
- `Télécharger` — télécharge le fichier local
- *(si GIF animé)* `Découper GIF` — extrait chaque frame en image dérivée
- *(si GIF animé)* `Frames GIF` — ouvre le visualiseur frame-par-frame

### État du menu overflow

```ts
const [previewMenuAnchor, setPreviewMenuAnchor] = React.useState<{ x: number; y: number } | null>(null);
```

Positionné sous le bouton `...` via `getBoundingClientRect()`. Utilise le même composant `ContextMenu` que le clic-droit sur les thumbnails.

---

## Badge CHAT

Le toggle chat est représenté par **un seul badge** dans la zone badges de chaque thumbnail — toujours visible quand le chat est disponible (`onAnalyzeImages` défini), avec deux états visuels :

| État | Classe CSS | Apparence |
|---|---|---|
| Non sélectionné | `geoapp-images-badge--neutral` | Gris, discret |
| Sélectionné | `geoapp-images-badge--accent` | Violet, mis en valeur |

Le badge est cliquable directement (avec `e.stopPropagation()` pour ne pas déclencher la sélection de l'image parente). Il porte `role='checkbox'` et `aria-checked` pour l'accessibilité.

Avant cette refonte, chaque thumbnail avait deux signaux redondants : un texte verbeux "Ajouter chat / Selectionnee chat" dans le meta **ET** un badge "CHAT" dans la liste des badges.

---

## Gestion des domaines masqués

Les images dont l'URL source appartient à un domaine masqué (configurable en préférences) sont filtrées de `visibleImages`. L'utilisateur peut les réafficher via un bandeau d'avertissement.

```ts
const visibleImages = React.useMemo(() => {
    if (showHiddenImages || !normalizedHiddenDomains.length) return images;
    return images.filter(img => !isHiddenByDomain(img.source_url));
}, [images, isHiddenByDomain, normalizedHiddenDomains.length, showHiddenImages]);
```

La normalisation des domaines (`normalizeDomainEntry`) gère aussi bien les hostnames bruts (`geocheck.org`) que les URLs complètes. La comparaison est insensible aux sous-domaines `www.`.

---

## Sélection pour le chat

### Sélection persistée

La sélection d'images pour le chat est persistée dans `localStorage` (clé `geoapp.earthcoach.chatImageSelection.<geocacheId>`). À l'ouverture d'une cache, la sélection précédente est restaurée (en filtrant les IDs qui n'existent plus).

### Initialisation automatique

Si aucune sélection persistée n'existe, le composant auto-sélectionne les photos utilisateur (`source_url` préfixé par `geoapp-upload://`) jusqu'à `maxChatImages` (configurable, défaut 5).

### Avertissement de surcharge

Si la sélection dépasse `maxChatImages`, un toast d'information est affiché (une seule fois par session de galerie via `didWarnChatImageLimitRef`).

---

## OCR

### Annulation

Chaque OCR en cours est associé à un `AbortController` stocké dans `ocrAbortControllersRef` (ref, pas état). L'annulation est disponible via :
- Le bouton `×` sur le thumbnail en cours d'OCR
- Le même bouton dans la barre d'actions de la preview

L'état d'avancement est stocké dans `ocrInProgressById: Record<number, true>` (état React) pour déclencher les re-renders nécessaires.

### Moteurs

| Moteur | Préférence | Description |
|---|---|---|
| `easyocr_ocr` | défaut | OCR local via EasyOCR |
| `vision_ocr` | optionnel | Vision IA (LMStudio ou OpenRouter) |

---

## API backend consommée

| Méthode | Route | Usage |
|---|---|---|
| GET | `/api/geocaches/<id>/images` | Charge toutes les images |
| PATCH | `/api/geocache-images/<id>` | Met à jour titre, note, OCR, QR |
| POST | `/api/geocaches/<id>/images/upload` | Upload d'une image utilisateur |
| POST | `/api/geocache-images/<id>/store` | Télécharge et stocke l'image localement |
| POST | `/api/geocache-images/<id>/unstore` | Supprime le stockage local |
| POST | `/api/geocache-images/<id>/duplicate` | Crée une image dérivée |
| DELETE | `/api/geocache-images/<id>/delete` | Supprime l'image |
| POST | `/api/geocaches/<id>/images/store` | Stocke toutes les images visibles en lot |
| GET | `/api/geocache-images/<id>/content` | Sert le fichier image local |
| POST | `/api/geocache-images/<id>/split-gif` | Extrait les frames d'un GIF en images dérivées |
| POST | `/api/geocache-images/<id>/extract-frames` | Extrait les frames en base64 pour le visualiseur |

La liste est rechargée via l'événement DOM `geoapp-geocache-images-updated` (émis après un rafraîchissement global de la cache) ou directement après chaque opération mutante.

---

## Points d'attention

- **`ThumbnailItem` hors du composant** : le définir à l'intérieur de `GeocacheImagesPanel` recréerait le type de composant à chaque render et forcerait React à démonter/remonter tous les thumbnails. Il doit rester au niveau module.
- **Callbacks stables** : tout callback passé à `ThumbnailItem` doit être wrappé en `useCallback`. Un callback instable annule le bénéfice de `React.memo`.
- **`data-image-id`** : attribut sur chaque bouton thumbnail, utilisé à la fois par le scroll automatique (query DOM) et potentiellement par les tests automatisés. Ne pas supprimer.
- **`visibleImages` dans `handleGridKeyDown`** : la dep sur `visibleImages` (useMemo) fait que `handleGridKeyDown` est recrée quand les images changent, mais ce n'est pas un problème de performance car il est attaché à la div de la grille, pas passé comme prop à un composant mémoïsé.
- **Images manquantes** : une image dérivée ou uploadée dont le fichier local a été supprimé manuellement est marquée `isMissing` (`stored = false` + `parent_image_id` défini ou source `geoapp-upload://`). La plupart des actions sont désactivées sur ces images.
- **GIF animé** : détecté via `mime_type` (`image/gif`) ou extension de l'URL source. Les frames sont extraites côté backend par `extract-frames` (réponse JSON base64).

## Références code

- `frontend/theia-extensions/zones/src/browser/geocache-images-panel.tsx` — composant principal + `ThumbnailItem`
- `frontend/theia-extensions/zones/src/browser/style/geocache-images-panel.css` — styles
- `frontend/theia-extensions/zones/src/browser/context-menu.tsx` — menu contextuel réutilisé (clic-droit thumbnails + overflow barre d'actions)
- `backend/gc_backend/blueprints/geocache_images.py` — routes API images
- `backend/gc_backend/geocaches/image_storage.py` — gestion fichiers locaux
- `backend/gc_backend/geocaches/image_sync.py` — synchronisation images legacy → GeocacheImage
- `backend/gc_backend/geocaches/models.py` — modèle `GeocacheImage`
