---
title: "Galerie d'images d'une géocache"
description: "Parcourir, analyser et gérer les images d'une géocache — stockage local, OCR, QR, EXIF, sélection pour le chat IA."
chapter: zones
order: 20
tags: [images, galerie, ocr, qr, exif, stockage, chat, gif, analyse, vignettes]
---

# Galerie d'images d'une géocache

La **Galerie** se trouve en bas de chaque fiche de géocache. Elle regroupe toutes les images associées à la cache : illustrations du listing, photos du propriétaire, spoilers éventuels, et les photos que vous avez uploadées. Elle permet aussi d'analyser les images (OCR, QR, EXIF) et d'en sélectionner pour les envoyer au chat IA.

---

## La grille de vignettes

À gauche de la galerie, les images s'affichent sous forme de vignettes. Vous pouvez ajuster leur taille avec les boutons **S / M / L** dans la barre d'outils.

### Cliquer sur une vignette

Un clic sur une vignette **sélectionne** l'image : la colonne centrale affiche un aperçu en grand, et la colonne de droite ouvre l'inspecteur avec les métadonnées.

### Naviguer au clavier

Une fois la galerie active, vous pouvez naviguer sans souris :

| Touche | Effet |
|--------|-------|
| `←` | Image précédente |
| `→` | Image suivante |
| `↑` | Ligne du dessus |
| `↓` | Ligne du dessous |

> 💡 La galerie scrolle automatiquement pour garder l'image sélectionnée visible — y compris après un upload ou une sélection via le clavier.

### Menu contextuel (clic droit)

Un clic droit sur une vignette ouvre un menu avec toutes les actions disponibles pour cette image : éditer, dupliquer, télécharger, Google Lens, OCR, QR, EXIF, stockage…

### Badges sur les vignettes

Chaque vignette peut afficher des badges indiquant l'état ou le contenu de l'image :

| Badge | Signification |
|-------|---------------|
| `LOCAL` *(vert)* | Image stockée localement sur votre machine |
| `MANQUANT` *(rouge)* | Fichier local introuvable (image dérivée ou uploadée dont le fichier a été supprimé) |
| `SPOILER` *(rouge)* | Image marquée comme spoiler par le propriétaire |
| `PROPRIO` *(bleu)* | Image ajoutée par le propriétaire (hors listing officiel) |
| `NOTE` *(bleu)* | Une note personnelle est attachée à cette image |
| `QR` *(violet)* | Un QR code a été détecté et son contenu est enregistré |
| `OCR` *(orange)* | Du texte a été extrait par reconnaissance optique |
| `EXIF` *(bleu)* | Des données EXIF utiles ont été lues (GPS, appareil photo…) |
| `DÉRIVÉE` *(gris)* | Image créée par duplication ou découpe d'une image parente |
| `CHAT` *(violet)* | Image sélectionnée pour le prochain envoi au chat IA |

> 💡 Le badge `CHAT` est cliquable directement sur la vignette : cliquez dessus pour ajouter ou retirer l'image de la sélection chat, sans ouvrir l'aperçu.

---

## L'aperçu et la barre d'actions

Cliquer sur une vignette affiche l'image en grand dans la colonne centrale, avec une barre d'actions en dessous.

### Actions principales

| Bouton | Action |
|--------|--------|
| **Éditer** | Ouvre l'image dans l'éditeur graphique intégré (recadrage, annotations…) |
| **OCR** | Lance la reconnaissance de texte sur l'image |
| **QR** | Tente de décoder un QR code dans l'image |
| **Exif** | Lit les métadonnées EXIF (date, GPS, appareil…) |
| **Lens** | Recherche l'image sur Google Lens pour une recherche inversée |
| **Chat** | Ajoute ou retire l'image de la sélection pour le chat IA |

### Menu `…` — Actions secondaires

Le bouton **`…`** en fin de barre ouvre un menu avec les actions moins fréquentes :

| Action | Quand |
|--------|-------|
| **Dupliquer** | Crée une copie de l'image (pour l'éditer sans modifier l'original) |
| **Télécharger** | Télécharge le fichier local sur votre poste |
| **Découper GIF** | *(GIF animé uniquement)* Extrait chaque frame en image dérivée |
| **Frames GIF** | *(GIF animé uniquement)* Ouvre le visualiseur frame par frame |

> ℹ️ **Télécharger** n'est disponible que si l'image est stockée localement (badge `LOCAL` présent). Si l'image est distante, stockez-la d'abord via l'inspecteur.

---

## L'inspecteur (colonne droite)

L'inspecteur affiche les métadonnées de l'image sélectionnée, réparties en trois sections.

### Informations

- **Titre** : nom affiché sous la vignette. Modifiable.
- **Note** : note personnelle libre attachée à l'image. Modifiable.
- **Source** : URL d'origine de l'image.
- **Type** : nature de l'image (listing, propriétaire, spoiler, upload…).
- **Taille** : poids du fichier.

### Analyse

- **QR payload** : résultat du décodage QR (ou saisie manuelle). Un bouton **Copier QR** apparaît si un contenu est présent.
- **OCR** : texte extrait par reconnaissance optique (ou transcription manuelle).
- **Exif** : données EXIF lisibles (affiché en lecture seule si des données ont été lues).

Cliquez sur **Sauvegarder** pour enregistrer les modifications de titre, note, QR et OCR.

### Stockage

| Bouton | Action |
|--------|--------|
| **Stocker localement** | Télécharge l'image depuis son URL distante et la stocke sur votre machine |
| **Retirer local** | Supprime la copie locale (l'image reste accessible via son URL distante) |
| **Supprimer** | Supprime définitivement l'image (disponible uniquement pour les uploads et les dérivées) |

---

## Barre d'outils de la galerie

La barre en haut de la section galerie contient :

| Contrôle | Rôle |
|----------|------|
| **S / M / L** | Taille des vignettes (Petite / Moyenne / Grande) |
| **Ajouter** | Upload d'une ou plusieurs images depuis votre ordinateur (PNG, JPEG, WebP) |
| **Chat (n)** | Envoie les *n* images sélectionnées au chat IA |
| **Vider** | Retire toutes les images de la sélection chat *(visible si au moins une image est sélectionnée)* |
| **Stocker visibles** | Télécharge et stocke localement toutes les images visibles qui ne le sont pas encore |

### Statistiques

Sous le titre « Galerie », un résumé indique le nombre total d'images, le nombre de dérivées, le nombre analysées (OCR/QR/EXIF), et le nombre masquées le cas échéant.

---

## Sélection d'images pour le chat IA

La galerie permet de choisir les images à envoyer au chat IA lors d'une analyse.

### Sélectionner / désélectionner

Deux façons de modifier la sélection :
- **Cliquer le badge `CHAT`** directement sur une vignette.
- **Bouton Chat** dans la barre d'actions de l'aperçu.

Le badge est **violet** quand l'image est sélectionnée, **gris** quand elle ne l'est pas.

### Envoyer au chat

Cliquez sur **Chat (n)** dans la barre d'outils pour ouvrir le chat IA avec les images sélectionnées pré-chargées. Les images distantes sont automatiquement stockées en local si nécessaire avant envoi.

> ⚠️ Envoyer plus de 5 images alourdit significativement le prompt et peut ralentir la réponse de l'IA. Un avertissement s'affiche au-delà de ce seuil (configurable dans les préférences).

### Sélection persistée

La sélection est **mémorisée par géocache** : si vous fermez et rouvrez la fiche, les images précédemment sélectionnées sont restaurées automatiquement.

---

## OCR — Reconnaissance de texte

L'OCR extrait le texte visible dans une image (coordonnées cachées dans une photo, texte sur un panneau, etc.).

### Lancer l'OCR

- Via le bouton **OCR** dans la barre d'actions de l'aperçu.
- Via le menu contextuel (clic droit) sur une vignette.

Une animation de chargement apparaît sur la vignette pendant le traitement. Vous pouvez **annuler** en cliquant le bouton `×` qui s'affiche sur la vignette.

### Résultat

Le texte extrait est placé dans le champ **OCR** de l'inspecteur. Vous pouvez le modifier manuellement avant de sauvegarder.

### Moteurs disponibles

Le moteur par défaut est configurable dans les préférences :

| Moteur | Description |
|--------|-------------|
| **EasyOCR** | Moteur local, fonctionne hors ligne, supporte de nombreuses langues |
| **Vision IA** | Moteur IA (LMStudio ou OpenRouter), meilleur sur les textes complexes ou peu lisibles |

---

## QR — Décodage de QR codes

Le bouton **QR** tente de détecter et décoder automatiquement un QR code dans l'image.

Le résultat (URL, coordonnées, texte encodé…) est stocké dans le champ **QR payload** de l'inspecteur. Si un contenu est présent, un bouton **Copier QR** permet de le copier en un clic.

> 💡 Vous pouvez aussi saisir manuellement le contenu du QR dans l'inspecteur si le décodage automatique échoue.

---

## EXIF — Métadonnées de l'image

Le bouton **Exif** lit les données techniques embarquées dans le fichier image :

- **Date et heure** de la prise de vue
- **Coordonnées GPS** (si enregistrées par l'appareil)
- **Modèle d'appareil photo** / smartphone

Ces informations s'affichent dans l'inspecteur en lecture seule. Elles peuvent contenir des indications précieuses pour les Mystery caches ou les Earth Caches avec observations photo.

---

## Google Lens

Le bouton **Lens** ouvre Google Lens avec l'image pour une **recherche inversée** : identifier un monument, une plante, un objet, retrouver l'origine d'une image…

> ℹ️ Lens utilise l'URL de l'image. Si l'image est stockée localement, l'URL locale est utilisée — elle peut ne pas être accessible depuis Google. Dans ce cas, utilisez la version distante (retirez le stockage local si nécessaire).

---

## Visualiseur GIF animé

Pour les GIF animés, deux options supplémentaires sont disponibles dans le menu `…` :

### Frames GIF

Ouvre un visualiseur modal qui affiche le GIF **frame par frame**, avec des boutons Précédent / Suivant. Utile pour lire un message caché dans les frames d'un GIF.

### Découper GIF

Extrait automatiquement chaque frame en une **image dérivée** distincte, stockée dans la galerie. Ces dérivées peuvent ensuite être analysées individuellement (OCR, QR…).

---

## Images masquées par domaine

Certains domaines peuvent être configurés pour masquer automatiquement leurs images (ex : geocheck.org, certitudes.org). Les images concernées ne s'affichent plus dans la grille.

Si des images sont masquées, un **bandeau d'avertissement** apparaît avec le nombre d'images cachées et un bouton **Afficher** pour les révéler temporairement.

La liste des domaines masqués est configurable dans un menu déroulant **Domaines masqués** visible sous la barre d'outils.

---

## Upload d'images

Le bouton **Ajouter** dans la barre d'outils permet d'uploader vos propres images (PNG, JPEG ou WebP).

Ces images apparaissent dans la galerie avec le badge `LOCAL` et l'origine **Photo utilisateur locale**. Elles peuvent être sélectionnées pour le chat IA et sont distinctes des images du listing.

> ℹ️ Les images uploadées ne peuvent pas être « dé-stockées » (elles n'ont pas d'URL distante). Pour les supprimer, utilisez **Supprimer** dans l'inspecteur.

---

## Dupliquer une image

La duplication crée une **copie dérivée** de l'image sélectionnée, indépendante de l'original. Elle apparaît dans la galerie avec le badge `DÉRIVÉE`.

Usage typique : dupliquer une image avant de l'éditer pour conserver l'original intact.

Les images dérivées peuvent être supprimées librement via l'inspecteur.

---

## Avec l'assistant @Aide

L'agent **@Aide** peut vous guider dans l'utilisation de la galerie. Exemples de questions utiles :

- « Comment lancer l'OCR sur une image ? »
- « Quelle est la différence entre EasyOCR et Vision IA ? »
- « Comment envoyer des images au chat IA ? »
- « Comment stocker une image localement ? »
- « À quoi sert le badge EXIF ? »
- « Comment naviguer dans la galerie au clavier ? »
- « Comment voir les frames d'un GIF animé ? »
- « Comment masquer les images d'un domaine particulier ? »

> ℹ️ @Aide ne peut pas déclencher directement l'OCR, le stockage ou l'upload d'images — ces actions restent sous votre contrôle dans la galerie. Il peut en revanche vous expliquer le fonctionnement et répondre à vos questions.
