---
title: "Présentation de l'interface"
description: "Tour complet de l'interface GeoApp : panneaux, onglets, barre latérale et navigation."
order: 20
tags: [interface, navigation, panneaux, onglets, theia]
---

# Présentation de l'interface

GeoApp utilise Eclipse Theia comme base, ce qui vous donne une interface modulaire avec des panneaux redimensionnables, des onglets, et une barre d'activité sur le côté gauche.

## La barre d'activité (côté gauche)

La colonne d'icônes sur le bord gauche de l'écran permet de basculer entre les différents panneaux principaux :

| Icône | Panneau | Rôle |
|---|---|---|
| Dossier | **Zones** | Arborescence de vos zones et géocaches |
| Carte | **Carte** | Gestionnaire des cartes ouvertes |
| Puzzle | **Plugins** | Lanceur de plugins de déchiffrement |
| Loupe | **Recherche** | Recherche globale dans vos géocaches |

En bas de la barre d'activité se trouvent également des raccourcis vers les **préférences GeoApp** et la **gestion de la connexion Geocaching.com**.

## Le panneau gauche — Zones

Le panneau Zones affiche votre arborescence de zones sous forme d'arbre. Chaque zone peut contenir des géocaches importées.

- **Clic droit sur une zone** → menu contextuel (renommer, supprimer, importer des géocaches dans cette zone)
- **Double-clic sur une géocache** → ouvre l'onglet de détail dans la zone principale
- **Clic sur la flèche** → déplier/replier la zone

## La zone principale — Onglets

La partie centrale de l'écran accueille les onglets de travail. Plusieurs types d'onglets coexistent :

### Onglet Géocache (détails)

S'ouvre automatiquement quand vous double-cliquez sur une géocache. Il contient :

- **En-tête** : code GC, titre, type, difficulté/terrain, propriétaire
- **Coordonnées** : coordonnées officielles avec éditeur intégré pour noter vos coordonnées résolues
- **Description** : description complète de la géocache avec rendu HTML
- **Waypoints** : liste des waypoints additionnels
- **Attributs** : icônes des attributs de la cache
- **Logs** : accès rapide aux derniers logs
- **Notes** : vos notes personnelles

En haut de l'onglet, une barre d'outils propose : traduction, analyse IA, ouverture des plugins, export GPX.

### Onglet Table de géocaches (zone)

S'ouvre en double-cliquant sur une zone. Affiche toutes les géocaches de la zone sous forme de tableau triable/filtrable.

### Onglet Carte

Affiche une carte OpenLayers interactive. Vous pouvez :
- Afficher plusieurs couches (OSM, IGN, satellite...)
- Voir les géocaches importées sur la carte
- Cliquer sur une géocache pour accéder à ses détails
- Ajouter/déplacer des waypoints manuellement

### Onglet Plugins

Le lanceur de plugins. Sélectionnez un plugin dans la liste à gauche, configurez ses paramètres, lancez l'analyse. Les résultats s'affichent à droite avec possibilité d'ajouter les coordonnées trouvées comme waypoints.

### Onglet Archive de résolution

Un journal chronologique de toutes vos tentatives de résolution pour une géocache donnée : plugins utilisés, résultats, notes, coordonnées testées.

## Le panneau droit

Le panneau droit accueille en général le **chat IA** (Theia AI Chat) et les **logs de géocaches**. Vous pouvez le redimensionner ou le masquer selon vos besoins.

## Le panneau bas

Utilisé pour les messages de sortie et d'autres informations de diagnostic. Généralement masqué en utilisation normale.

## Personnaliser l'interface

### Déplacer les panneaux

Faites glisser un onglet pour le déplacer vers un autre panneau. GeoApp mémorise automatiquement la disposition au bout de 3 secondes d'inactivité.

### Raccourcis clavier utiles

| Raccourci | Action |
|---|---|
| `Ctrl+Shift+P` | Palette de commandes (toutes les commandes GeoApp) |
| `Ctrl+F` | Recherche dans la page active |
| `Ctrl+Shift+F` | Recherche globale |
| `F1` | Aide |
| `Ctrl+,` | Ouvrir les préférences |

### Réinitialiser la disposition

Si vous avez fermé des panneaux par accident, utilisez la commande `GeoApp: Réinitialiser la disposition par défaut` depuis la palette de commandes (`Ctrl+Shift+P`).

---

→ Passez à l'étape suivante : [Créer votre première zone](./first-zone.md)
