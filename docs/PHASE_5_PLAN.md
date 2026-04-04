# Phase 5 : Fonctionnalités Avancées - Plan d'Implémentation

**Date de début** : 10 novembre 2025  
**Statut** : 🟡 En cours  
**Temps estimé** : 8-12 heures

---

## 📋 Ce qui est déjà fait (Phases 1-4)

✅ **Calculs de valeurs** (Phase 2-3) :
- `calculateChecksum()` - Somme des chiffres
- `calculateReducedChecksum()` - Checksum → 1 chiffre
- `calculateLength()` - Longueur sans espaces

✅ **Évaluation de formules** (Phase 3) :
- Parser d'expressions mathématiques
- Sandbox sécurisé avec `ast.literal_eval` et whitelist
- Support opérations : `+`, `-`, `*`, `/`, `%`
- Gestion erreurs (division par zéro, syntaxe)

✅ **Widget standalone** (Phase 4) :
- Détection formules depuis texte
- Extraction questions
- Saisie valeurs avec types
- Calcul coordonnées
- Affichage 3 formats + distance

---

## 🎯 Ce qui reste à implémenter

### 5.1 Intégration Geocaches (3-4h) 🔥 PRIORITAIRE

**Objectif** : Utiliser le Formula Solver directement depuis les géocaches

#### Backend
- [ ] Endpoint GET `/api/geocaches/:id/description`
- [ ] Endpoint POST `/api/geocaches/:id/solve-formula`
- [ ] Sauvegarde résultat dans géocache

#### Frontend
- [ ] Menu contextuel "Résoudre formule" sur GeocacheDetailsWidget
- [ ] Commande `formula-solver:solve-from-geocache`
- [ ] Chargement automatique de la description
- [ ] Pré-remplissage coordonnées origine
- [ ] Lien bidirectionnel widget ↔ geocache
- [ ] Bouton "Retour à la géocache"

---

### 5.2 Création Waypoints (2-3h)

**Objectif** : Créer des waypoints depuis les résultats

#### Backend
- [ ] Endpoint POST `/api/geocaches/:id/waypoints`
- [ ] Génération auto nom ("Solution formule", "WP calcul", etc.)
- [ ] Génération auto prefix (WP01, WP02, etc.)
- [ ] Validation coordonnées

#### Frontend (ResultDisplayComponent)
- [ ] Bouton "Créer waypoint" fonctionnel
- [ ] Dialogue avec formulaire :
  - Nom (pré-rempli)
  - Prefix (auto-généré)
  - Note (formule + valeurs)
  - Type de waypoint
- [ ] Feedback succès/erreur
- [ ] Actualisation automatique de la géocache

---

### 5.3 Projection sur Carte (2-3h)

**Objectif** : Afficher le résultat sur la carte OpenLayers

#### Frontend
- [ ] Service d'intégration avec zones-ext
- [ ] Bouton "Voir sur la carte" fonctionnel
- [ ] Marqueur spécial pour résultat formula
- [ ] Popup avec détails :
  - Coordonnées 3 formats
  - Formule utilisée
  - Valeurs des variables
  - Distance depuis origine
- [ ] Zoom automatique sur le point
- [ ] Option "Projeter toutes les possibilités" (Phase future)

---

### 5.4 Vérificateurs Externes (1-2h)

**Objectif** : Vérifier les coordonnées avec outils externes

#### Backend
- [ ] Endpoint POST `/api/geocaches/:id/checkers/detect`
- [ ] Détection GeoCheck dans description
- [ ] Détection Certitude dans description
- [ ] Construction URLs avec coordonnées

#### Frontend (ResultDisplayComponent)
- [ ] Bouton "Vérifier avec GeoCheck" (si dispo)
- [ ] Bouton "Vérifier sur Geocaching.com"
- [ ] Bouton "Vérifier avec Certitude" (si dispo)
- [ ] Ouverture dans nouvel onglet navigateur
- [ ] Feedback si checker non disponible

---

### 5.5 Améliorations UX (optionnel, 2h)

**Objectif** : Améliorer l'expérience utilisateur

- [ ] Sauvegarde état dans localStorage (formule + valeurs)
- [ ] Restauration automatique au rechargement
- [ ] Historique des calculs (sidebar)
- [ ] Export résultats (JSON)
- [ ] Bouton "Réinitialiser"
- [ ] Raccourcis clavier
- [ ] Tooltip informatifs

---

## 📊 Ordre d'implémentation recommandé

### Étape 1 : Intégration Geocaches (3-4h) 🔥
**C'est la fonctionnalité la plus importante !**
- Permet d'utiliser le solver de manière native
- Base pour les autres fonctionnalités
- Impact UX maximal

### Étape 2 : Création Waypoints (2-3h)
- Complète naturellement l'intégration geocaches
- Fonctionnalité très demandée
- Assez simple à implémenter

### Étape 3 : Projection Carte (2-3h)
- Visualisation des résultats
- Réutilise l'infrastructure OpenLayers existante
- Bonne UX

### Étape 4 : Vérificateurs Externes (1-2h)
- Fonctionnalité bonus
- Relativement simple (URLs + ouverture)
- Apporte de la valeur

### Étape 5 : Améliorations UX (optionnel)
- Si temps disponible
- Améliore l'expérience globale

---

## 🎯 MVP Phase 5 (Minimum Viable Product)

Pour avoir un Formula Solver complètement fonctionnel, le minimum est :

1. ✅ **Intégration Geocaches** (MUST HAVE)
2. ✅ **Création Waypoints** (MUST HAVE)
3. 🔄 **Projection Carte** (SHOULD HAVE)
4. 🔄 **Vérificateurs** (NICE TO HAVE)

**Temps MVP** : 5-7 heures

---

## 📝 Notes techniques

### Intégration avec extensions existantes

Le Formula Solver doit s'intégrer avec :
- **theia-ide-product-ext** : GeocacheDetailsWidget
- **theia-ide-zones-ext** : MapWidget et OpenLayers

### Communication inter-widgets

```typescript
// Depuis GeocacheDetailsWidget
const formulaSolverWidget = await this.widgetManager.getOrCreateWidget(
    FormulaSolverWidget.ID
);
formulaSolverWidget.loadFromGeocache(geocacheId);

// Depuis FormulaSolverWidget
const mapWidget = await this.widgetManager.getWidget(MapWidget.ID);
mapWidget.addMarker(coordinates, 'formula-result');
```

### Architecture de données

```typescript
// État partagé entre widgets
interface FormulaSolverContext {
    geocacheId?: number;
    gcCode?: string;
    originCoordinates?: { lat: number; lon: number };
    formula?: Formula;
    result?: CalculationResult;
}
```

---

## 🚀 Proposition de démarrage

**Je propose de commencer par l'Étape 1 : Intégration Geocaches**

C'est la fonctionnalité la plus importante et la plus impactante. Elle transformera le Formula Solver d'un outil standalone en une fonctionnalité native de l'application.

**Sous-tâches** :
1. Créer route backend pour récupérer description geocache
2. Créer commande Theia `formula-solver:solve-from-geocache`
3. Ajouter menu contextuel dans GeocacheDetailsWidget
4. Modifier FormulaSolverWidget pour accepter geocacheId
5. Charger automatiquement description + origine
6. Tester le workflow complet

**Temps estimé** : 3-4 heures

---

**Voulez-vous que nous commencions par l'intégration avec les géocaches ?** 🚀
