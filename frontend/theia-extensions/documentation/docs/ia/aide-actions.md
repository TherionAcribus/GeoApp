---
title: "Actions avec @Aide"
description: "Comment utiliser @Aide pour naviguer dans GeoApp et agir sur les zones, géocaches, waypoints et notes."
order: 30
tags: [IA, aide, actions, zones, geocaches, waypoints, notes, navigation]
---

# Actions avec @Aide

En plus de répondre aux questions documentaires, `@Aide` peut effectuer des actions directement dans GeoApp : ouvrir des panneaux, créer ou supprimer des zones, ajouter des géocaches, créer des waypoints et des notes.

## Fonctionnement en mode hybride

`@Aide` adapte automatiquement son comportement selon votre intention :

- **Question** (comment, qu'est-ce que, pourquoi...) → Réponse depuis la documentation
- **Action** (verbe impératif : crée, ouvre, supprime, ajoute...) → Appel du tool approprié
- **Ambiguïté** → `@Aide` demande une clarification avant d'agir

### Exemples

| Message | Comportement |
|---|---|
| « Comment créer une zone ? » | Répond depuis la documentation |
| « Crée une zone "Alpes 2025" » | Crée la zone via l'API |
| « Ouvre le panneau des plugins » | Ouvre le widget plugins |
| « Liste mes zones » | Retourne la liste de toutes les zones |
| « Supprime cette zone » | Demande confirmation Theia, puis supprime |

## Contexte UI

`@Aide` connaît automatiquement :
- Le **widget actif** (géocache ouverte, zone ouverte, documentation...)
- La **zone active** sélectionnée dans la liste
- Les **onglets ouverts** dans la zone principale

Vous pouvez utiliser des références implicites : « cette cache », « la zone active », « l'onglet ouvert ».

Si l'identifiant est inconnu (par exemple, vous dites « ajoute une note à la cache 42 » mais `@Aide` ne connaît pas la géocache), il utilisera `aide_list_geocaches_in_zone` pour trouver la bonne cache.

## Confirmation pour les actions sensibles ⚠

Les actions irréversibles (suppression de zone, géocache, waypoint, note) et les actions réseau (ajout via code GC) déclenchent automatiquement une **boîte de dialogue de confirmation Theia** avant exécution.

Vous n'avez pas besoin de confirmer verbalement : la boîte de dialogue apparaît dans l'interface.

## Actions disponibles

### Navigation

| Demande (exemples) | Action |
|---|---|
| « Ouvre la documentation » | Ouvre le widget documentation |
| « Ouvre les préférences » | Ouvre le panneau préférences |
| « Ouvre le panneau des plugins » | Ouvre le navigateur plugins |
| « Affiche les alphabets » | Ouvre la liste des alphabets |
| « Ouvre la carte » | Affiche la carte |
| « Ouvre le gestionnaire d'archive » | Ouvre l'archive GPX |
| « Ouvre la liste des zones » | Ouvre le panneau latéral zones |
| « Ouvre la zone 3 » | Ouvre l'onglet tableau de la zone 3 |
| « Ouvre la géocache 42 » | Ouvre la fiche détails de la géocache 42 |

### Zones

| Demande (exemples) | Action |
|---|---|
| « Liste mes zones » | Retourne toutes les zones avec leurs id et noms |
| « Crée une zone "Bretagne 2025" » | Crée la zone |
| « Définis la zone 2 comme active » | Sélectionne la zone 2 comme zone active |
| « Supprime la zone "Test" » ⚠ | Demande confirmation, puis supprime |

### Géocaches

| Demande (exemples) | Action |
|---|---|
| « Liste les caches de la zone 1 » | Retourne la liste des géocaches |
| « Ajoute GC12345 à la zone 1 » ⚠ | Ajoute via Geocaching.com |
| « Copie la cache 42 vers la zone 3 » ⚠ | Copie sans supprimer la source |
| « Supprime la cache 42 » ⚠ | Demande confirmation, puis supprime |

### Waypoints

| Demande (exemples) | Action |
|---|---|
| « Crée un waypoint "Final" sur la cache 42 aux coords N 48° 51.500 E 002° 17.600 » | Crée le waypoint |
| « Supprime le waypoint 7 de la cache 42 » ⚠ | Demande confirmation, puis supprime |

### Notes

| Demande (exemples) | Action |
|---|---|
| « Ajoute une note "Indice : chercher près du banc" sur la cache 42 » | Crée une note utilisateur |
| « Modifie la note 12 avec le texte "..." » | Met à jour la note |
| « Supprime la note 12 » ⚠ | Demande confirmation, puis supprime |

## Conseils d'utilisation

- Démarrez par **« Liste mes zones »** si vous ne connaissez pas les IDs.
- Pour les identifiants manquants, `@Aide` les cherchera automatiquement.
- Pour les notes, précisez `note_type: system` uniquement pour des notes système ; laissez vide pour une note utilisateur.
- Les coordonnées de waypoints doivent être au format **DDM** (ex: `N 48° 51.500 E 002° 17.600`).
