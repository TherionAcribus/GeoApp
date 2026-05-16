---
title: "Actions avec @Aide"
description: "Comment utiliser @Aide pour naviguer dans GeoApp, ouvrir des plugins et alphabets, et agir sur les zones, géocaches, waypoints et notes."
order: 30
tags: [IA, aide, actions, zones, geocaches, waypoints, notes, navigation, plugins, alphabets]
---

# Actions avec @Aide

En plus de répondre aux questions documentaires, `@Aide` peut effectuer des actions directement dans GeoApp : ouvrir des panneaux, rechercher et ouvrir des plugins ou des alphabets, créer ou supprimer des zones, ajouter des géocaches, créer des waypoints et des notes. **28 actions** sont disponibles.

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
| « Ouvre le plugin Morse » | Cherche le plugin dans la liste, ouvre l'onglet |
| « Ouvre l'alphabet Aurebesh » | Cherche l'alphabet, ouvre l'onglet décodeur |
| « Quel plugin pour décoder du Morse ? » | Répond depuis la documentation ou la liste des plugins |
| « Liste mes zones » | Retourne la liste de toutes les zones |
| « Supprime cette zone » | Demande confirmation Theia, puis supprime |

## Contexte UI

`@Aide` connaît automatiquement :
- Le **widget actif** (géocache ouverte, zone ouverte, documentation...)
- La **zone active** sélectionnée dans la liste
- Les **onglets ouverts** dans la zone principale

Vous pouvez utiliser des références implicites : « cette cache », « la zone active », « l'onglet ouvert ».

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
| « Affiche la liste des alphabets » | Ouvre le panneau latéral alphabets |
| « Ouvre la carte » | Affiche la carte |
| « Ouvre le gestionnaire d'archive » | Ouvre l'archive GPX |
| « Ouvre la liste des zones » | Ouvre le panneau latéral zones |
| « Ouvre la zone 3 » | Ouvre l'onglet tableau de la zone 3 |
| « Ouvre la géocache 42 » | Ouvre la fiche détails de la géocache 42 |

### Plugins de déchiffrement

`@Aide` peut lister tous les plugins disponibles, donner des informations sur un plugin, et ouvrir directement l'onglet d'exécution avec le plugin pré-sélectionné.

| Demande (exemples) | Action |
|---|---|
| « Quels plugins sont disponibles ? » | Liste tous les plugins avec leurs catégories et tags |
| « Quels plugins pour du Morse ? » | Liste, puis identifie les plugins liés au Morse |
| « Ouvre le plugin multitap » | Cherche dans la liste, ouvre l'onglet exécution |
| « Ouvre un décodeur pour le code Houdini » | Identifie `houdini_cipher` dans la liste, ouvre l'onglet |
| « Ouvre un plugin pour les téléphones » | Identifie `multitap_code` (ABC des mobiles), ouvre l'onglet |
| « Que fait le plugin bacon_cipher ? » | Retourne la description, les catégories et les paramètres |
| « C'est quoi le code César ? » | Répond depuis la documentation ou détaille le plugin `caesar_cipher` |

> **Recherche sémantique :** vous n'avez pas besoin de connaître le nom exact du plugin. `@Aide` récupère la liste complète (avec les tags) et utilise ses propres connaissances pour identifier le plugin correspondant à votre description. Exemples : « magie » → `houdini_cipher`, « téléphone mobile » → `multitap_code`, « pigpen » → `pig_pen_cipher`.

### Alphabets de symboles

`@Aide` peut lister, rechercher et ouvrir directement un alphabet dans l'onglet de décodage de symboles.

| Demande (exemples) | Action |
|---|---|
| « Liste les alphabets disponibles » | Retourne tous les alphabets avec leurs tags |
| « Je cherche un alphabet Star Wars » | Cherche et identifie `aurebesh` |
| « Ouvre l'alphabet Arcadia » | Cherche `arcadia` dans la liste, ouvre l'onglet décodeur |
| « Ouvre l'alphabet Aurebesh » | Cherche `aurebesh`, ouvre l'onglet décodeur |
| « Quels alphabets ont des runes ? » | Recherche par tag/description, liste les résultats |
| « Que contient l'alphabet Alteran ? » | Retourne la description, les tags et les caractères supportés |

> **Conseil :** pour ouvrir un alphabet, vous pouvez donner son nom approximatif ou une description (ex: « l'alphabet de la série Stargate »). `@Aide` fera la correspondance automatiquement.

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

- **Plugins et alphabets :** donnez une description en langage naturel, `@Aide` trouvera le bon outil. Inutile de connaître le nom exact.
- **Zones et caches :** démarrez par « Liste mes zones » si vous ne connaissez pas les IDs. Pour les identifiants manquants, `@Aide` les cherchera automatiquement.
- **Notes :** précisez `note_type: system` uniquement pour des notes système ; laissez vide pour une note utilisateur.
- **Coordonnées :** les waypoints doivent être au format **DDM** (ex: `N 48° 51.500 E 002° 17.600`).
