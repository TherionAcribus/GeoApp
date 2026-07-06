---
title: "Créer votre première zone"
description: "Comment créer une zone, importer des géocaches et les visualiser sur la carte."
order: 30
tags: [zone, import, gpx, pocket query, carte]
---

# Créer votre première zone

Les **zones** sont la brique de base pour organiser votre travail dans GeoApp. Une zone regroupe un ensemble de géocaches liées par un contexte commun : un secteur géographique, un événement, un projet de résolution...

## Créer une zone

1. Dans le panneau gauche **Zones**, saisissez un nom dans le champ **Nouvelle zone**
2. Appuyez sur `Entrée` (ou cliquez sur le bouton **＋**). Pour ajouter une description, cliquez d'abord sur le bouton **▾**.

La zone apparaît dans l'arborescence, vide pour l'instant.

> **Astuce :** dans l'arbre, un **simple-clic** sur une zone la déplie/replie (pour voir ses géocaches) ; un **double-clic** ouvre son tableau. Vous pouvez aussi faire **glisser-déposer** une géocache d'une zone vers une autre pour la déplacer.

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
2. [Connectez-vous à Geocaching.com](./connexion-geocaching.md) si ce n'est pas déjà fait (icône en bas de la barre d'activité)
3. Sélectionnez votre pocket query dans la liste
4. Choisissez la zone de destination

### Depuis une liste de favoris

Nécessite aussi d'être [connecté à Geocaching.com](./connexion-geocaching.md).

1. Menu `GeoApp > Importer > Importer une liste de favoris`
2. Saisissez l'URL de la liste ou son identifiant
3. Choisissez la zone de destination

### Autour d'un point (importation par zone géographique)

Nécessite aussi d'être [connecté à Geocaching.com](./connexion-geocaching.md).

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
| Ouvrir | Ouvre le tableau de la zone |
| Renommer | Modifie le nom de la zone |
| Dupliquer | Copie la zone et toutes ses géocaches |
| Fusionner vers… | Déplace les géocaches vers une autre zone, puis supprime la zone source |
| Trier les caches par… | Change l'ordre des géocaches (code GC, titre, type, date d'ajout) |
| Supprimer | Supprime la zone **et toutes ses géocaches** |

Pour plus de détails, voir [Gérer les zones](../zones/overview.md).

## Astuces d'organisation

- **Plusieurs zones par projet** : créez une zone par secteur géographique (ex: "Forêt de Rambouillet", "Vallée de la Loire")
- **Zone "À résoudre"** : regroupez les caches mystères en attente
- **Zone "Résolues"** : archivez les caches dont vous avez trouvé les coordonnées finales
- **Nommage cohérent** : utilisez un préfixe pour faciliter le tri (ex: "📍 Secteur Nord", "🔐 Mystères difficiles")

---

→ Passez à l'étape suivante : [Analyser votre première géocache](./first-geocache.md)
