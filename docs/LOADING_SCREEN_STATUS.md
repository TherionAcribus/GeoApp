# Suivi visuel du chargement Theia

Cette doc décrit comment l'écran de chargement affiche les étapes pour l'app GeoApp (Electron et Browser) **sans modifier le cœur de Theia**.

## Principe
- Theia insère le contenu de `resources/preload.html` avant que l'application ne soit prête.
- Une contribution frontend (`LoadingStatusContribution`) écoute les changements d'état du cycle de démarrage via `FrontendApplicationStateService` et envoie un événement `theia-loading-state` au preload.
- Le preload met à jour :
  - un texte de statut,
  - une barre de progression,
  - une liste d'étapes (avec ✓ pour les étapes terminées).

## Fichiers concernés
- Electron : `applications/electron/resources/preload.html`
- Browser  : `applications/browser/resources/preload.html`
- Contribution : `theia-extensions/zones/src/browser/loading-status-contribution.ts`
- Enregistrement de la contribution : `theia-extensions/zones/src/browser/zones-frontend-module.ts`

## États affichés
Mapping des états Theia → UI (texte + progression %) :
- `init` → "Chargement des modules..." (10%)
- `starting_contributions` → "Démarrage des extensions..." (25%)
- `started_contributions` → "Extensions chargées" (40%)
- `attaching_shell` → "Initialisation de l'interface..." (50%)
- `attached_shell` → "Interface initialisée" (60%)
- `initializing_layout` → "Restauration de la disposition..." (75%)
- `initialized_layout` → "Disposition restaurée" (85%)
- `ready` → "Prêt !" (100%)

Les étapes UI visibles : Modules → Extensions → Interface → Disposition → Finalisation.

## Comment ça marche côté code
- **Emission** : `LoadingStatusContribution` écoute `stateService.onStateChanged` et dispatch un `CustomEvent('theia-loading-state', { detail: { state } })`. Elle appelle aussi `window.updateLoadingStatus` si présent pour compatibilité.
- **Affichage** : dans `preload.html`, un script écoute `theia-loading-state` et met à jour le texte, la barre et les classes CSS (`active` / `completed`).

## Personnaliser les messages ou paliers
- Modifier le dictionnaire `stateMessages` dans les deux `preload.html` (Electron + Browser) pour changer texte/progression.
- Ajouter/supprimer des étapes visuelles en éditant la liste `.loading-step` dans `preload.html` et l'ordre `stepOrder` dans le script.
- Si vous ajoutez un nouvel état dans le cycle Theia, mappez-le dans `stateMessages` et `stateToStep`.

## Build / test
- Rebuild les extensions (si la contribution a changé) :
  ```bash
  cd theia-blueprint/theia-extensions/zones
  yarn build
  ```
- Rebuild l'app :
  ```bash
  cd theia-blueprint/applications/browser
  yarn build && yarn start
  # ou pour Electron selon votre script de build
  ```

## Notes
- Aucun ajout de dépendance ni modification du cœur Theia.
- Le fallback `window.updateLoadingStatus` permet d'afficher des messages personnalisés si d'autres scripts veulent pousser un statut.
- Le style utilise uniquement du CSS inline dans le preload, pas de Tailwind/PostCSS requis.
