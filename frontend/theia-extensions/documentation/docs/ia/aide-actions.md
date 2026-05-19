---
title: "Actions avec @Aide"
description: "Comment utiliser @Aide pour naviguer dans GeoApp, ouvrir des plugins et alphabets, gérer les préférences, et agir sur les zones, géocaches, waypoints et notes."
order: 30
tags: [IA, aide, actions, zones, geocaches, waypoints, notes, navigation, plugins, alphabets, préférences]
---

# Actions avec @Aide

En plus de répondre aux questions documentaires, `@Aide` peut effectuer des actions directement dans GeoApp : ouvrir des panneaux, rechercher et ouvrir des plugins ou des alphabets, créer ou supprimer des zones, ajouter des géocaches, créer des waypoints et des notes, et **effectuer des calculs mathématiques**. **34 actions** sont disponibles.

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
| « Active la recherche web dans le Formula Solver » | Lit la préférence, la met à jour à `true` |
| « Liste mes zones » | Retourne la liste de toutes les zones |
| « Supprime cette zone » | Demande confirmation Theia, puis supprime |
| « Calcule sqrt(144) + 2^8 » | Évalue l'expression et retourne le résultat |
| « Résous les coordonnées N 48° (A+B).CDE si A=3 B=7 C=sqrt(25) » | Calcule chaque variable via aide_calculate |

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

### Préférences GeoApp

`@Aide` peut lire et modifier toutes les préférences GeoApp (IA, carte, plugins, interface, OCR, mises à jour...). Les clés API et valeurs sensibles sont **protégées** : elles ne peuvent pas être lues ni modifiées.

| Demande (exemples) | Action |
|---|---|
| « Quelles sont mes préférences IA ? » | Liste les préférences de catégorie `ai` avec valeurs courantes |
| « Quelle est la valeur de geoApp.map.defaultProvider ? » | Lit la préférence et ses valeurs possibles |
| « Active la recherche web du Formula Solver » | Modifie `geoApp.formulaSolver.ai.webSearchEnabled` à `true` |
| « Passe le zoom par défaut de la carte à 12 » | Modifie `geoApp.map.defaultZoom` à `12` (validé entre 2 et 18) |
| « Change le fournisseur de carte en satellite » | Modifie `geoApp.map.defaultProvider` à `satellite` (enum validé) |
| « Désactive le mode lazy des plugins » | Modifie `geoApp.plugins.lazyMode` à `false` |
| « Quelles sont les préférences de l'OCR ? » | Liste les préférences de catégorie `ocr` |
| « Ouvre les préférences EarthCoach » | Ouvre les préférences GeoApp directement sur la section EarthCoach |
| « Liste les préférences EarthCoach » | Liste les préférences de catégorie `earthcoach` |
| « Désactive les recherches externes EarthCoach » | Modifie `geoApp.earthCoach.references.web.enabled` à `false` |

> **Sécurité :** `@Aide` ne peut jamais lire ni modifier la clé API OpenRouter (`geoApp.ai.openRouter.apiKey`) ni aucune autre valeur marquée comme sensible.

### Calculatrice scientifique

`@Aide` dispose d'une calculatrice scientifique complète pour résoudre les formules de coordonnées et les énigmes mathématiques.

| Demande (exemples) | Action |
|---|---|
| « Calcule sqrt(144) » | Retourne `12` |
| « Combien font sin(30) en degrés ? » | Retourne `0.5` (avec angle_unit="deg") |
| « Calcule 2^10 » | Retourne `1024` |
| « Factorielle de 7 » | Calcule `factorial(7)` = `5040` |
| « Calcule log10(1000) » | Retourne `3` |
| « Résous A=floor(3.7), B=ceil(2.1), C=A+B » | Évalue via batch : `3; 3; 6` |
| « Ouvre la calculatrice » | Affiche le panneau calculatrice |

**Fonctions disponibles :**
- **Trigonométrie :** `sin`, `cos`, `tan`, `asin`, `acos`, `atan` — angles en rad par défaut, `angle_unit="deg"` pour les degrés
- **Algèbre :** `sqrt`, `cbrt`, `abs`, `floor`, `ceil`, `round`, `factorial`, `combinations`, `permutations`
- **Logarithmes :** `log` (naturel/ln), `log10`, `log2`, `exp`
- **Constantes :** `pi`, `e`
- **Opérateurs :** `+`, `-`, `*`, `/`, `^` (puissance), `%` (modulo)

> **Règle :** `@Aide` utilise systématiquement la calculatrice pour tout résultat numérique lors de la résolution d'énigmes. Les résultats sont exacts, jamais estimés.

## Conseils d'utilisation

- **Plugins et alphabets :** donnez une description en langage naturel, `@Aide` trouvera le bon outil. Inutile de connaître le nom exact.
- **Zones et caches :** démarrez par « Liste mes zones » si vous ne connaissez pas les IDs. Pour les identifiants manquants, `@Aide` les cherchera automatiquement.
- **Notes :** précisez `note_type: system` uniquement pour des notes système ; laissez vide pour une note utilisateur.
- **Coordonnées :** les waypoints doivent être au format **DDM** (ex: `N 48° 51.500 E 002° 17.600`).
- **Calculs :** pour les formules de géocaches (ex: `N 48° (A×B+C).DEF`), donnez les valeurs de chaque variable et `@Aide` calculera les coordonnées finales.
