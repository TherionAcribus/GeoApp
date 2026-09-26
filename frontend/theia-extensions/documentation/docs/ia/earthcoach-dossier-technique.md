---
title: "Dossier terrain EarthCoach - architecture"
description: "Persistance, preparation des requetes IA et capture des resultats du dossier terrain EarthCoach."
order: 26
tags: [IA, EarthCoach, architecture, API, images]
---

# Dossier terrain EarthCoach - architecture

## Persistance

Le dossier est cree a la premiere sauvegarde. `earthcoach_workspace` porte le commentaire general, la langue, l'empreinte du listing et la version optimiste. Les tables `earthcoach_image_context`, `earthcoach_image_group` et `earthcoach_image_group_member` conservent la selection, les commentaires, waypoints, observations, groupes, roles et ordres.

Une image peut appartenir a plusieurs groupes. Les references a une image sont supprimees avec elle. Images, observations et waypoints sont valides cote serveur pour appartenir a la meme geocache.

API :

- `GET /api/geocaches/<id>/earthcoach-workspace` ;
- `PUT /api/geocaches/<id>/earthcoach-workspace` ;
- `GET /api/geocaches/<id>/earthcoach-results` ;
- `POST /api/geocaches/<id>/earthcoach-results` ;
- `PATCH /api/earthcoach-results/<id>` ;
- `POST /api/earthcoach-results/<id>/apply`.

Le `PUT` remplace atomiquement les contextes et groupes. Le client envoie la version lue ; une version depassee retourne `409` avec le dossier courant.

## Preparation IA

L'onglet attend la fin de l'autosauvegarde, controle la limite d'images, refuse une selection partielle de groupe et demande une confirmation par envoi sans photo personnelle. Les images inaccessibles sont retirees de l'instantane et affichees dans le resume.

`EarthCoachPreparedRequest` est l'instantane immuable transmis au chat : langue et empreinte du listing, langue de reponse, commentaire general, questions, observations, images disponibles, groupes, roles, waypoints et commentaires. La verbosite ne retire aucune preuve des actions d'analyse et de resolution.

Le bridge chat decode puis reencode chaque image dans un canvas, y compris sans redimensionnement. Le modele ne recoit donc pas les metadonnees EXIF du fichier original. Lorsqu'une image owner ou listing distante est bloquee par CORS dans le navigateur, le dossier demande au backend de la stocker puis transmet cette copie locale. Si les deux voies echouent, l'image n'est pas jointe et le resume affiche la cause exacte.

## Capture et validation

Le modele appelle `earthcoach_capture_result` sans afficher son JSON technique. L'ancien bloc `earthcoach-result` reste reconnu par l'observateur comme compatibilite de secours, mais il est retire du Markdown conserve et n'est plus demande au modele. Le `request_id` rend la capture idempotente.

Les propositions restent modifiables dans le dossier et peuvent porter la traduction de la question originale. L'application d'une reponse exige une proposition `ready`, une reponse non vide et aucun element manquant. La generation finale sauvegarde d'abord ces propositions puis les reinjecte explicitement dans le chat, ce qui evite de dependre de l'etat implicite de la conversation. Seule la question existante est alors mise a jour ; aucun log Geocaching n'est cree.
