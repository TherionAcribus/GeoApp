---
title: "Analyser votre première géocache"
description: "Ouvrir une géocache, lire sa description, utiliser les plugins et interagir avec l'IA."
order: 40
tags: [géocache, analyse, plugin, IA, description, waypoints]
---

# Analyser votre première géocache

Une fois vos géocaches importées, vous êtes prêt à commencer la résolution. Ce guide vous présente les outils disponibles pour une géocache mystère typique.

## Ouvrir une géocache

**Double-cliquez** sur une géocache dans la table ou dans l'arborescence des zones. Un onglet de détail s'ouvre dans la zone principale.

## L'onglet de détail — Vue d'ensemble

L'onglet est divisé en plusieurs sections :

### En-tête

- **Code GC** et **titre** de la cache
- **Type** (Mystère, Multi, Traditional...), **Difficulté** et **Terrain** (étoiles)
- **Propriétaire** avec lien direct vers son profil
- **Barre d'outils** : accès rapide aux actions principales

### Coordonnées

Deux lignes de coordonnées :

| Champ | Description |
|---|---|
| **Coordonnées officielles** | Les coordonnées publiées par le propriétaire (souvent fictives pour les mystères) |
| **Coordonnées résolues** | Vos coordonnées finales, à remplir une fois l'énigme résolue |

Cliquez sur les coordonnées pour les modifier ou les copier.

### Description

La description complète de la géocache, rendue depuis le HTML original. Les liens, images et tableaux sont préservés.

> **Astuce :** Si la description est dans une langue étrangère, utilisez le bouton **Traduire** dans la barre d'outils pour la traduire automatiquement via l'IA.

### Galerie d'images

Si la géocache a des images jointes, elles apparaissent dans un onglet dédié. Vous pouvez :
- Zoomer et faire défiler les images
- Lancer l'**OCR** sur une image pour en extraire le texte (bouton OCR dans la barre d'outils de l'image)
- Ouvrir l'**éditeur d'images** pour annoter ou traiter une image (rotation, contraste, recadrage...)

### Waypoints

Liste des waypoints additionnels publiés par le propriétaire (étapes d'une multi, parking, etc.) et vos propres waypoints résolus.

## Utiliser les plugins

Les plugins sont le cœur de la résolution dans GeoApp. Pour les utiliser :

1. Cliquez sur le bouton **Plugins** dans la barre d'outils de l'onglet géocache
2. Le panneau de plugins s'ouvre sur la droite (ou dans un nouvel onglet)
3. **Sélectionnez un plugin** dans la liste de gauche (cherchez par nom ou catégorie)
4. **Remplissez les paramètres** selon le plugin choisi
5. Cliquez sur **Lancer** pour exécuter l'analyse
6. Les résultats s'affichent à droite

### Catégories de plugins

| Catégorie | Exemples |
|---|---|
| **Chiffres classiques** | César, Vigenère, Atbash, ROT13, Morse, Braille |
| **Codes modernes** | Base64, Hex, Binaire, DTMF, NATO |
| **Chiffres historiques** | Enigma, ADFGVX, Playfair, Nihilist |
| **Alphabets alternatifs** | Elfique, Klingon, Pigpen, Sémaphore |
| **Mathématiques** | Solveur de formules, conversions de bases |
| **Coordonnées** | Conversion DD/DMS/DDM, projection, calculs |
| **Images** | OCR, stéganographie, codes QR/barre |
| **Outils divers** | Anagramme, décalage lettres, ASCII |

### Le Métasolveur

Pour les géocaches complexes avec plusieurs étapes, le **Métasolveur** propose une approche automatisée :

1. Il analyse la description complète
2. Il identifie les types de codes potentiels
3. Il lance automatiquement les plugins les plus pertinents
4. Il synthétise les résultats

Accédez-y via le bouton **Métasolveur** dans le panneau Plugins.

## Interagir avec l'IA

Le chat IA est disponible dans le panneau droit. Plusieurs agents sont à votre disposition.

### Analyse automatique

Cliquez sur **Analyser avec l'IA** dans la barre d'outils de l'onglet géocache. L'agent principal reçoit la description complète et propose :
- Les types d'encodage détectés
- Les indices cachés potentiels
- Les étapes de résolution suggérées
- Les coordonnées extraites si visibles

### Questions libres

Dans le chat, tapez directement votre question :

```
Qu'est-ce que ce code en chiffres romains pourrait signifier ?
Les lettres soulignées dans la description forment-elles un message ?
Comment calculer N 48° 12.(A×B) E 003° (C+D).EFG ?
```

### Utiliser @Aide

Pour les questions sur l'utilisation de GeoApp lui-même :

```
@Aide comment exporter mes waypoints en GPX ?
@Aide quel plugin utiliser pour un code Pigpen ?
@Aide comment fonctionne l'OCR ?
```

## Enregistrer votre progression

### Notes personnelles

L'onglet **Notes** (accessible depuis la barre d'outils ou le panneau bas) vous permet d'écrire vos hypothèses, calculs intermédiaires et observations. Les notes sont sauvegardées automatiquement.

### Archive de résolution

L'**Archive** enregistre automatiquement tous les plugins lancés avec leurs paramètres et résultats. Vous pouvez :
- Retrouver un résultat d'une session précédente
- Annoter une tentative avec une note
- Exporter l'historique complet

### Waypoints résolus

Quand un plugin ou l'IA trouve des coordonnées, un bouton **Ajouter comme waypoint** apparaît dans les résultats. Cliquez dessus pour enregistrer les coordonnées directement sur la géocache.

## Exporter pour aller sur le terrain

Une fois les coordonnées finales trouvées :

1. Vérifiez les coordonnées dans la section **Coordonnées résolues**
2. Cliquez sur **Exporter en GPX** dans la barre d'outils
3. Sélectionnez les waypoints à inclure
4. Ouvrez le fichier dans votre application GPS préférée

---

**Félicitations !** Vous connaissez maintenant les bases de GeoApp. Explorez les autres chapitres de cette documentation pour maîtriser les fonctionnalités avancées.

→ [Gérer les zones avancé](../zones/overview.md) | [Référence des plugins](../plugins/overview.md) | [Configurer l'IA](../ai/configure.md)
