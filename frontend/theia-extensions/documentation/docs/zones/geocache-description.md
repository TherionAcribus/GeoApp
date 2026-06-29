---
title: "Description et traduction d'une géocache"
description: "Consulter, traduire et modifier la description d'une géocache — variantes originale/modifiée, éditeur WYSIWYG, mise en forme enrichie."
chapter: zones
order: 15
tags: [description, traduction, édition, wysiwyg, mise en forme, géocache, html, ia]
---

# Description et traduction d'une géocache

La section **Description** de la fiche d'une géocache vous permet de consulter le listing original, de le traduire automatiquement en français grâce à l'IA, et de le modifier librement avec un éditeur enrichi qui préserve toute la mise en page HTML d'origine.

## La barre d'actions de la fiche

En haut de chaque fiche de géocache, une barre d'outils donne accès aux fonctions principales :

| Bouton | Rôle |
|--------|------|
| **Analyser ▾** | Ouvre un menu déroulant avec les outils d'analyse : formula solver, analyse de page, analyse de code, plugins, atelier de grilles. |
| **Chat IA · `profil`** | Ouvre un chat IA guidé dédié à cette géocache, avec le profil actif affiché. |
| **▾** (à droite de Chat IA) | Sélectionne le profil d'IA à utiliser (automatique, rapide, puissant…). |
| **Chat libre** | Ouvre un chat libre lié à la géocache, où vous rédigez vous-même le message de départ. |
| **Logs** | Accède aux logs de la géocache. |
| **Loguer** | Ouvre l'éditeur de log pour cette géocache. |
| **Notes** | Ouvre le panneau de notes personnelles (avec un badge indiquant le nombre de notes existantes). |

> 💡 Le bouton **Chat IA** et le sélecteur **▾** forment un seul élément visuel : cliquez sur la partie gauche pour lancer immédiatement le chat, ou sur **▾** pour choisir un autre profil IA avant de démarrer.

---

## La description : variante originale et modifiée

La description d'une géocache peut exister en deux variantes :

- **Originale** : le listing tel que publié sur Geocaching.com, en anglais pour la plupart des Mystery et Multi.
- **Modifiée** : une version que vous avez créée — soit via la traduction automatique, soit via l'éditeur manuel.

Un **contrôle segmenté** vous permet de basculer entre les deux :

```
[ Originale ]  [ Modifiée ]
```

Un badge coloré **✦ Modifiée · JJ/MM/AA** apparaît dès qu'une version modifiée existe, avec la date de la dernière mise à jour. Quand aucune version modifiée n'existe, la mention *Aucune modification* est affichée discrètement.

> ℹ️ La bascule est désactivée pendant une édition en cours — terminez ou annulez d'abord l'édition.

---

## Traduire la description

Le bouton **Traduire ▾** ouvre un menu proposant deux options :

### Description seule

Traduit uniquement le texte de la description principale. Le HTML d'origine (tableaux, images, formatage) est **conservé** — seul le contenu textuel est traduit. C'est l'option recommandée pour les listings classiques.

### Tout le contenu

Traduit en une seule passe :
- la description principale ;
- les indices (hints) ;
- les notes des waypoints additionnels.

Utilisez cette option quand vous souhaitez une vue d'ensemble complète en français sans avoir à lancer plusieurs traductions.

### Pendant la traduction

Une bannière s'affiche sous les contrôles pour indiquer la progression, et la description est légèrement estompée pendant l'opération. Les autres actions (édition, bascule de variante) sont temporairement désactivées.

Une fois la traduction terminée, la variante **Modifiée** est sélectionnée automatiquement et le badge de date est mis à jour.

> ⚠️ La traduction est réalisée par l'IA et peut contenir des imprécisions sur du vocabulaire technique (noms propres, balises de cache, coordonnées encodées). Relisez toujours la traduction avant de résoudre la cache.

---

## Éditer la description

Le bouton **✎ Éditer** ouvre l'éditeur WYSIWYG directement dans la fiche.

### Démarrer l'édition

- S'il existe une version **modifiée** (traduction ou édition précédente), l'éditeur s'ouvre avec ce contenu.
- S'il n'existe pas encore de version modifiée, l'éditeur s'ouvre avec la **description originale** — vous partez du listing d'origine.

Dans les deux cas, la mise en page HTML complète est préservée : tableaux, listes, liens, couleurs, images imbriquées…

### Barre d'outils de mise en forme

L'éditeur affiche une barre d'outils en haut de la zone de texte :

| Groupe | Contrôles | Effet |
|--------|-----------|-------|
| **Format** | **B** · *I* · <u>U</u> | Gras, italique, souligné |
| **Taille** | Menu `Taille` | Applique une taille en pixels (10 à 48 px) au texte sélectionné |
| **Listes** | • — · 1. — | Liste à puces / liste numérotée |
| **Alignement** | ⇤ ⇔ ⇥ ⇌ | Gauche, centré, droite, justifié |
| **Couleurs** | **A** · 🖌 | Couleur du texte / couleur de fond (surlignage) |
| **Liens** | ⛓ · ⛓̸ | Insérer un lien (demande l'URL) / Supprimer un lien |
| **Nettoyage** | ✕ | Supprime toute mise en forme du texte sélectionné |

> 💡 Pour **changer la taille ou la couleur** d'un texte, sélectionnez-le d'abord, puis utilisez le menu ou le sélecteur de couleur. Si rien n'est sélectionné, la taille et la couleur ne s'appliquent pas.

### Coller du contenu

Quand vous collez du contenu depuis une page web ou un autre document :

- Si le presse-papier contient du **HTML formaté**, la mise en page est conservée (gras, listes, liens…). Le contenu est automatiquement nettoyé pour supprimer les scripts ou balises dangereuses.
- Si le presse-papier contient du **texte brut**, il est inséré tel quel avec les sauts de ligne.

### Terminer l'édition

Trois actions sont disponibles en bas de l'éditeur :

- **Sauvegarder** : enregistre la version modifiée. La variante **Modifiée** devient active et le badge de date est mis à jour.
- **Annuler** : ferme l'éditeur sans rien enregistrer. La description revient à son état précédent.
- **Revenir à l'originale** : supprime définitivement la version modifiée et rétablit la description d'origine. Ce bouton n'est actif que si une version modifiée existe. Une confirmation peut être demandée.

---

## Bon à savoir

- La **mise en forme HTML** du listing original est entièrement préservée lors de l'édition : vous ne travaillez pas sur du texte brut, mais directement sur le rendu visuel.
- La description affichée provient de Geocaching.com ; des balises JavaScript ou des scripts éventuels sont neutralisés avant affichage pour des raisons de sécurité.
- **Traduction et édition sont cumulables** : vous pouvez d'abord traduire avec l'IA, puis corriger ou compléter manuellement le résultat dans l'éditeur.
- La variante modifiée est **stockée localement** dans GeoApp — elle ne modifie pas le listing sur Geocaching.com.
- Vous pouvez **re-traduire** à tout moment, même si une version modifiée existe déjà : la nouvelle traduction remplace l'ancienne.

---

## Avec l'assistant @Aide

L'agent **@Aide** peut vous guider dans l'utilisation de la description et de ses fonctionnalités. Exemples de questions utiles :

- « Comment traduire la description de cette géocache ? »
- « Quelle est la différence entre "Description seule" et "Tout le contenu" pour la traduction ? »
- « Comment revenir à la description originale après une traduction ? »
- « Je veux modifier manuellement la traduction, comment faire ? »

> ℹ️ @Aide ne peut pas déclencher lui-même la traduction ou l'édition de description — ces actions restent sous votre contrôle dans la fiche. Il peut en revanche vous expliquer le processus et répondre à vos questions.
