---
title: "Gérer les zones"
description: "Le panneau Zones : créer, trier, déplier, déplacer, fusionner et supprimer zones et géocaches."
order: 10
tags: [zone, gestion, organisation, tri, déplacer, glisser-déposer, supprimer, clavier, tableau, sélection]
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

### Sélectionner des géocaches dans le tableau

La première colonne contient des **cases à cocher**, mais toute la ligne réagit :

| Geste | Action |
|---|---|
| **Clic** sur une ligne (ou sa case) | Coche / décoche la géocache |
| **Ctrl+clic** | Coche / décoche une géocache sans toucher aux autres |
| **Shift+clic** | Coche toute la **plage** entre la dernière géocache cliquée et celle-ci (dans l'ordre affiché à l'écran) |
| **Double-clic** sur une ligne | Ouvre la fiche de la géocache (et la carte) |
| **Clic** sur le code GC (lien souligné) | Ouvre la fiche de la géocache (et la carte) |

La case du **tout premier en-tête** coche ou décoche toutes les lignes visibles.

Le tableau est aussi navigable au clavier : `Tab` place le focus sur la ligne courante, puis :

| Touche | Action |
|---|---|
| ↓ / ↑ | Ligne suivante / précédente |
| `Maj`+↓ / `Maj`+↑ | Déplace le focus **en cochant** la plage parcourue |
| `Début` / `Fin` | Première / dernière ligne |
| `Espace` | Coche / décoche la ligne focalisée |
| `Entrée` | Ouvre la fiche de la géocache |
| `Ctrl`+`A` | Coche (ou décoche) toutes les lignes |
| `Entrée` / `Espace` sur un en-tête | Trie par cette colonne |

Les géocaches cochées s'affichent en surbrillance et la **barre d'actions** apparaît au-dessus du tableau : **Loguer**, **Analyser IA**, **Exporter GPX**, **Rafraîchir**, **Copier**, **Déplacer**, **Supprimer**… La sélection est aussi reflétée sur la carte de la zone.

> 💡 **Shift+clic** ajoute la plage à la sélection en cours : il ne décoche jamais. Si la ligne de départ a été filtrée entre-temps, le Shift+clic se comporte comme un clic simple.

### Filtrer et rechercher

La barre au-dessus du tableau combine trois niveaux de filtrage :

- **Recherche libre** : insensible à la casse et aux accents, joker `*` (ex. `gr*tte`). Elle porte sur le code GC, le nom, le type, le propriétaire, la taille, le statut et les coordonnées.
- **Tokens ciblés** `@champ:valeur` directement dans la recherche : `@found:false`, `@type:mystery`, `@diff:>=3`, `@posée:>=2020`, `@notes:oui`, `@status:archived`, `@pf:>=50`… Tapez `@` dans le champ pour voir les champs proposés en autocomplétion.
- **Filtres supplémentaires** : l'éditeur de clauses (champ, opérateur, valeur) pour les combinaisons plus complexes.

Les **pastilles de presets** (« Non trouvées », « Mysteries à résoudre », « Actives », « Corrigées », « Avec notes », « Trouvées cette année ») appliquent une requête prédéfinie en un clic : le texte reste visible dans le champ et peut être ajusté.

Le **tri** choisi dans le tableau est mémorisé **par zone** : chaque zone retrouve son propre tri à la réouverture, même après un redémarrage.

### Colonne « Distance »

Une colonne **Distance** (masquée par défaut — activez-la via le menu **Colonnes**) affiche la distance à vol d'oiseau depuis une **origine** que vous définissez par **clic droit sur une ligne → « Définir comme origine des distances »** : la géocache devient le point « zéro ». L'origine est mémorisée **par zone** ; la puce « depuis GCxxxxx » au-dessus du tableau la rappelle et s'efface d'un clic (ou via **« Effacer l'origine des distances »** dans le menu contextuel). Le filtre `@distance:` (ex. `@distance:<=5`) utilise la même origine.

### Rafraîchissement du tableau

Quand une action recharge la liste (import, suppression, rafraîchissement…), le tableau **reste affiché** : votre tri, vos filtres, votre sélection et votre position de défilement sont conservés. Un badge **« Mise à jour… »** en haut à droite indique que les données se rafraîchissent en arrière-plan.

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

L'import (GPX, Pocket Query, liste de favoris, autour d'un point) est décrit dans [Créer votre première zone](../getting-started/first-zone.md). Il se lance depuis le menu **GeoApp → Importer**, en choisissant la zone de destination. Dans l'onglet d'une zone, le menu **Importer ▾** de l'en-tête regroupe les mêmes sources, et le champ **Code GC** à sa gauche importe une seule géocache par son code.

## Astuces d'organisation

- Une zone par secteur ou par projet (ex. « Forêt de Rambouillet », « Mystères à résoudre »).
- Utilisez le **tri par date d'ajout** pour retrouver rapidement vos derniers imports.
- Le **glisser-déposer** est le plus rapide pour réorganiser quelques caches ; la **fusion** pour regrouper deux zones entières.
