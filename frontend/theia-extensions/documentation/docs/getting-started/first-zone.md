---
title: "Créer votre première zone"
description: "Comment créer une zone, importer des géocaches et les visualiser sur la carte."
order: 30
tags: [zone, import, gpx, pocket query, carte]
---

# Créer votre première zone

Les **zones** sont la brique de base pour organiser votre travail dans GeoApp. Une zone regroupe un ensemble de géocaches liées par un contexte commun : un secteur géographique, un événement, un projet de résolution...

## Créer une zone

1. Dans le panneau gauche, repérez le titre **Zones** avec le bouton `+`
2. Cliquez sur `+` (ou faites un clic droit dans le panneau → **Nouvelle zone**)
3. Saisissez un nom pour votre zone et appuyez sur `Entrée`

La zone apparaît dans l'arborescence, vide pour l'instant.

## Importer des géocaches

Plusieurs méthodes d'importation sont disponibles depuis le menu `GeoApp > Importer` ou par clic droit sur une zone.

### Depuis un fichier GPX

Le format le plus universel. Geocaching.com vous permet de télécharger des fichiers GPX depuis votre liste de caches ou via les pocket queries.

1. Menu `GeoApp > Importer > Importer un fichier GPX`
2. Sélectionnez votre fichier `.gpx`
3. Choisissez la zone de destination
4. Validez

> **Note :** GeoApp supporte les fichiers GPX standard et les formats Geocaching.com enrichis (avec description complète, logs, waypoints additionnels).

### Depuis une Pocket Query

Si vous avez un compte Premium Geocaching.com :

1. Menu `GeoApp > Importer > Importer une Pocket Query`
2. Authentifiez-vous si ce n'est pas déjà fait (icône en bas de la barre d'activité)
3. Sélectionnez votre pocket query dans la liste
4. Choisissez la zone de destination

### Depuis une liste de favoris

1. Menu `GeoApp > Importer > Importer une liste de favoris`
2. Saisissez l'URL de la liste ou son identifiant
3. Choisissez la zone de destination

### Autour d'un point (importation par zone géographique)

1. Menu `GeoApp > Importer > Importer autour d'un point`
2. Saisissez les coordonnées du centre (format DD° MM.MMM')
3. Définissez le rayon en kilomètres
4. Choisissez la zone de destination

## Visualiser vos géocaches sur la carte

Une fois les géocaches importées :

1. Double-cliquez sur une zone → la table des géocaches s'ouvre
2. Cliquez sur l'icône **Carte** dans la barre d'activité gauche → ouvre le gestionnaire de cartes
3. Cliquez sur **Nouvelle carte** → une carte OpenLayers s'ouvre dans la zone principale
4. Les géocaches apparaissent sur la carte avec leurs icônes (par type de cache)

### Navigation sur la carte

- **Déplacer** : clic + glisser
- **Zoom** : molette de la souris ou boutons +/-
- **Cliquer sur une géocache** : affiche un popup avec le titre et le code GC
- **Double-cliquer sur une géocache** : ouvre directement son onglet de détail

## Gérer une zone existante

**Clic droit sur une zone** → menu contextuel :

| Action | Description |
|---|---|
| Renommer | Modifie le nom de la zone |
| Importer dans cette zone | Raccourci vers les options d'import |
| Supprimer | Supprime la zone et toutes ses géocaches |
| Exporter en GPX | Exporte toutes les géocaches de la zone |

## Astuces d'organisation

- **Plusieurs zones par projet** : créez une zone par secteur géographique (ex: "Forêt de Rambouillet", "Vallée de la Loire")
- **Zone "À résoudre"** : regroupez les caches mystères en attente
- **Zone "Résolues"** : archivez les caches dont vous avez trouvé les coordonnées finales
- **Nommage cohérent** : utilisez un préfixe pour faciliter le tri (ex: "📍 Secteur Nord", "🔐 Mystères difficiles")

---

→ Passez à l'étape suivante : [Analyser votre première géocache](./first-geocache.md)
