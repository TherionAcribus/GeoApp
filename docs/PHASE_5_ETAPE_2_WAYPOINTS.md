# Phase 5 - Étape 2 : Création de Waypoints

**Objectif** : Créer des waypoints depuis les résultats du Formula Solver  
**Temps estimé** : 2-3 heures  
**Statut** : 🟡 En cours

---

## Fonctionnalités à implémenter

### 1. Backend - Route création waypoint
- `POST /api/geocaches/<id>/waypoints`
- Génération auto du prefix (WP01, WP02, etc.)
- Validation coordonnées
- Sauvegarde en base

### 2. Frontend - Bouton dans ResultDisplay
- Bouton "Créer waypoint" fonctionnel
- Dialogue avec formulaire :
  - Nom (pré-rempli "Solution formule")
  - Prefix (auto-généré)
  - Note (formule + valeurs)
  - Type de waypoint
- Feedback succès/erreur

### 3. Communication Widget → Geocache
- Actualisation automatique de GeocacheDetailsWidget
- Event bus ou service partagé

---

## Plan d'implémentation

### Étape 2.1 : Route backend waypoints
1. Créer route POST dans `formula_solver.py`
2. Générer prefix automatiquement
3. Valider et sauvegarder
4. Retourner le waypoint créé

### Étape 2.2 : Bouton dans ResultDisplayComponent
1. Rendre le bouton "Créer waypoint" fonctionnel
2. Callback vers le widget parent
3. Passer geocacheId et coordonnées

### Étape 2.3 : Dialogue de création
1. Créer un composant DialogueWaypoint
2. Formulaire avec champs pré-remplis
3. Validation côté client
4. Appel API

### Étape 2.4 : Actualisation geocache
1. Event après création
2. Refresh du GeocacheDetailsWidget
3. Toast de confirmation

---

**Commençons par la route backend !** 🚀
