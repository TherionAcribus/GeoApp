---
title: "Les notes d'une géocache"
description: "Prendre des notes sur une géocache, importer et renvoyer la note personnelle Geocaching.com."
chapter: zones
order: 20
tags: [notes, géocache, note personnelle, geocaching, synchronisation, earthcoach, aide-ia]
---

# Les notes d'une géocache

Le panneau **Notes** vous permet de garder toutes vos remarques sur une géocache au même endroit : indices, pistes de résolution, observations de terrain, rappels… Il réunit **deux types de notes** :

1. **Les notes de l'application** : vos notes locales dans GeoApp. Vous pouvez en créer autant que vous voulez. Certaines peuvent aussi être ajoutées automatiquement par des outils (par exemple l'agent **EarthCoach**).
2. **La note personnelle Geocaching.com** : la note unique que Geocaching.com associe à chaque cache (« personal cache note »). GeoApp peut **l'importer** depuis le site et **y renvoyer** une de vos notes.

## Ouvrir le panneau Notes

Le panneau Notes s'ouvre depuis la fiche d'une géocache. Il affiche, de haut en bas :

- un en-tête avec le **code GC** et le nom de la cache ;
- le bloc **Note Geocaching.com** ;
- le bloc **Notes de l'application** (zone de saisie + liste de vos notes).

> 💡 Si aucune géocache n'est sélectionnée, le panneau affiche simplement une invitation à en choisir une.

## Ajouter une note

Dans le bloc **Notes de l'application** :

1. Saisissez votre texte dans la zone « Ajouter une nouvelle note… ».
2. Choisissez le type de note :
   - **Note utilisateur** : une note classique, la vôtre ;
   - **Note système** : une note à caractère plus technique/automatique.
3. Cliquez sur **Ajouter** (ou utilisez le raccourci **Ctrl/Cmd + Entrée**).

Le bouton **Ajouter** reste désactivé tant que la note est vide.

## Modifier ou supprimer une note

Chaque note affiche sa date de création (et de modification le cas échéant) ainsi qu'une étiquette de type colorée.

- **Modifier** (icône crayon) : ouvre la note en édition. Validez avec **Ctrl/Cmd + Entrée**, annulez avec **Échap**.
- **Supprimer** (icône corbeille) : une confirmation vous est demandée avant suppression.

> ℹ️ Seules **vos notes** (type « utilisateur ») peuvent être modifiées ou renvoyées vers Geocaching.com. Les notes ajoutées par un outil comme EarthCoach sont en **lecture seule** dans ce panneau.

## La note personnelle Geocaching.com

Le bloc **Note Geocaching.com** affiche la dernière version connue de votre note personnelle pour cette cache, avec, si disponibles, les dates d'**import** et d'**envoi**.

### Importer la note depuis Geocaching.com

Cliquez sur **Importer note GC.com** (en haut à droite). GeoApp récupère votre note personnelle telle qu'elle est actuellement sur le site et l'affiche dans le bloc.

> ⚙️ **Import automatique** : selon votre réglage, l'import peut se déclencher tout seul à l'ouverture du panneau. Voir la préférence *« Synchronisation de la note personnelle GC.com »* (valeurs : manuel, à l'ouverture des notes, à l'ouverture de la fiche).

### Envoyer une note vers Geocaching.com

Pour publier une de vos notes comme note personnelle GC.com, cliquez sur l'icône **flèche vers le haut** d'une note utilisateur.

Comme Geocaching.com ne stocke **qu'une seule** note personnelle par cache, si une note existe déjà sur le site, GeoApp vous propose de choisir :

- **Remplacer la note existante** : la note du site est écrasée par la vôtre ;
- **Ajouter à la note existante** : votre texte est ajouté à la suite de la note actuelle ;
- **Annuler** : rien n'est envoyé.

> 🔐 L'import et l'envoi nécessitent une session Geocaching.com valide (connexion gérée par GeoApp). En cas d'échec côté site, GeoApp vous le signale et la note locale n'est pas modifiée.

## Bon à savoir

- La note GC.com affichée dans GeoApp est une **copie locale** : elle reflète le dernier import ou envoi, pas forcément l'état en temps réel sur le site. Réimportez si besoin.
- Une même note d'application peut concerner plusieurs caches selon la façon dont elle a été créée par un outil ; la supprimer la retire de la cache courante.
- Les couleurs d'étiquette distinguent les origines : **utilisateur**, **système** et **EarthCoach**.

## Avec l'assistant @Aide

L'agent IA **@Aide** sait agir sur vos notes depuis le chat. Vous pouvez par exemple lui demander :

- « Ajoute une note sur cette cache : *parking au nord, sentier glissant* »
- « Liste les notes de la géocache ouverte »
- « Importe ma note personnelle Geocaching.com pour cette cache »

@Aide demande une confirmation avant les actions sensibles (comme la suppression). Pour en savoir plus, voir **Actions avec @Aide** dans le chapitre *Intelligence artificielle*.
