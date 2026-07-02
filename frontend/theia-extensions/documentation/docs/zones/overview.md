---
title: "Gérer les zones"
description: "Le panneau Zones : créer, trier, déplier, déplacer, fusionner et supprimer zones et géocaches."
order: 10
tags: [zone, gestion, organisation, tri, déplacer, glisser-déposer, supprimer, clavier]
---

# Gérer les zones

Le panneau **Zones**, dans la barre latérale gauche, est l'arbre de navigation de GeoApp. Il liste vos **zones** ; en dépliant une zone, vous voyez les **géocaches** qu'elle contient. Tout se fait à la souris comme au clavier.

## Créer une zone

En haut du panneau, sur une seule ligne :

1. Saisissez un nom dans le champ **Nouvelle zone**.
2. Appuyez sur `Entrée` (ou cliquez sur le bouton **＋**).

Pour ajouter une **description** (optionnelle), cliquez sur le bouton **▾** à droite du champ : un second champ apparaît. Les noms de zones doivent être uniques.

## Trier les zones

Sous le formulaire, un menu déroulant et un bouton **Asc/Desc** contrôlent l'ordre des zones :

- **Nom**, **Création**, **Nombre de caches**, **Dernière cache ajoutée**, **Dernière résolution**.

Le choix est mémorisé d'une session à l'autre.

## Déplier une zone et voir ses géocaches

- **Simple-clic** sur une ligne de zone → **déplie / replie** la zone (comme un dossier). Le chevron ▶/▼ indique l'état.
- Chaque géocache s'affiche avec son **icône de type**, son **code GC**, son **nom** et une coche **✓** si elle est trouvée.
- **Clic** sur une géocache → ouvre sa **fiche de détail**.

Le nombre de géocaches de chaque zone est affiché entre parenthèses.

## Ouvrir le tableau d'une zone

**Double-clic** sur une zone → ouvre son **tableau de géocaches** (vue complète avec colonnes, tri, filtres, export). Vous pouvez aussi utiliser **Ouvrir** dans le menu contextuel.

## Trier les géocaches d'une zone

**Clic droit sur une zone → Trier les caches par ▸** :

- **Code GC**, **Titre de la cache**, **Type de cache**, **Date d'ajout**
- puis **Croissant** ou **Décroissant**.

Ce tri s'applique à toutes les zones et se règle aussi dans **Préférences → section « Zones »** (`geoApp.zones.geocacheSortKey` / `geoApp.zones.geocacheSortDirection`).

## Déplacer ou copier une géocache

Deux méthodes :

- **Glisser-déposer** : faites glisser une géocache et déposez-la sur une **autre zone** → la géocache y est **déplacée**. La zone cible se met en surbrillance pendant le survol.
- **Clic droit sur une géocache** :
  - **Déplacer vers…** : ouvre une boîte de sélection de la zone de destination (déplace la géocache).
  - **Copier vers…** : crée une copie dans la zone choisie (l'originale reste en place).

Dans la boîte de sélection, choisissez la zone puis validez ; elle est navigable au clavier (flèches, `Entrée`, `Échap` pour annuler).

## Renommer, dupliquer, fusionner, supprimer une zone

**Clic droit sur une zone** :

| Action | Description |
|---|---|
| **Ouvrir** | Ouvre le tableau de la zone |
| **Renommer** | Change le nom (doit rester unique) |
| **Dupliquer** | Crée une copie de la zone avec toutes ses géocaches (waypoints et checkers inclus) |
| **Fusionner vers…** | Déplace les géocaches uniques vers une zone cible, conserve les doublons déjà présents dans la cible, puis **supprime la zone source** |
| **Trier les caches par…** | Voir la section tri ci-dessus |
| **Supprimer** | Supprime la zone **et toutes ses géocaches** |

> ⚠️ **La suppression d'une zone supprime aussi toutes les géocaches qu'elle contient** (avec leurs waypoints, checkers, logs et images). Si la zone n'est pas vide, la confirmation le rappelle. Les résolutions/coordonnées trouvées sont conservées dans l'archive.

## Navigation au clavier

Le panneau est entièrement accessible au clavier. Cliquez dans l'arbre (ou tabulez jusqu'à lui) puis :

| Touche | Action |
|---|---|
| ↓ / ↑ | Élément suivant / précédent |
| → | Déplier la zone, ou aller à la première géocache |
| ← | Replier la zone, ou remonter à la zone parente |
| `Entrée` / `Espace` | Ouvrir la zone (tableau) ou la fiche de la géocache |
| `Début` / `Fin` | Premier / dernier élément |

## Importer des géocaches

L'import (GPX, Pocket Query, liste de favoris, autour d'un point) est décrit dans [Créer votre première zone](../getting-started/first-zone.md). Il se lance depuis le menu **GeoApp → Importer**, en choisissant la zone de destination.

## Astuces d'organisation

- Une zone par secteur ou par projet (ex. « Forêt de Rambouillet », « Mystères à résoudre »).
- Utilisez le **tri par date d'ajout** pour retrouver rapidement vos derniers imports.
- Le **glisser-déposer** est le plus rapide pour réorganiser quelques caches ; la **fusion** pour regrouper deux zones entières.
