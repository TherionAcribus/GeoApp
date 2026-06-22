---
title: "Execution par lot (Batch)"
description: "Guide utilisateur pour executer un plugin de decodage sur plusieurs geocaches en meme temps dans GeoApp."
order: 35
tags: [batch, lot, plugin, decodage, geocaches, masse, coordonnees, geocaching]
---

# Execution par lot (Batch)

L'execution par lot permet de lancer un plugin de dechiffrement sur **plusieurs geocaches en meme temps**. Elle est utile quand vous voulez appliquer le meme chiffrement a un groupe de geocaches, par exemple pour trouver des coordonnees sur toutes les caches d'une serie.

## Quand l'utiliser

Utilisez l'execution par lot quand :

- vous avez une serie de geocaches du meme auteur avec le meme type de code ;
- vous voulez tester un plugin sur toutes les geocaches d'une zone ;
- vous souhaitez extraire automatiquement les coordonnees finales d'une liste de caches ;
- vous voulez appliquer le meme traitement a des dizaines ou centaines de geocaches sans les ouvrir une par une.

Ce n'est pas l'outil approprie si vous ne savez pas encore quel plugin utiliser. Dans ce cas, utilisez MetaSolver d'abord sur quelques caches, puis revenez au batch une fois le bon plugin identifie.

## Ouvrir l'executeur par lot

Vous pouvez ouvrir l'executeur par lot :

- depuis le menu **Affichage** > **Execution par lot** ;
- depuis la palette de commandes avec `Plugins: Execution par lot` ;
- depuis l'aide IA `@Aide`, en demandant par exemple : "ouvre l'execution par lot".

## Configurer l'execution

### Choisir le plugin

Selectionnez le plugin a utiliser dans la liste. Seuls les plugins actives et disponibles sont affiches.

Choisissez un plugin adapte au type de code que vous attendez dans ces geocaches. Si vous n'etes pas sur, testez d'abord sur une seule geocache avec le Plugin Executor.

### Choisir les geocaches

Selectionnez les geocaches sur lesquelles le plugin doit etre execute. Vous pouvez :

- choisir toutes les geocaches d'une zone ;
- selectionner manuellement une liste de geocaches.

GeoApp utilise les donnees de geocache disponibles (description, hint, coordonnees, images, waypoints) pour pre-remplir automatiquement les champs du plugin si celui-ci les utilise.

### Parametres du plugin

Configurez les parametres du plugin comme dans le Plugin Executor normal : mode, cle, decalage ou tout autre parametre specifique au plugin choisi.

Ces parametres seront appliques de la meme facon a toutes les geocaches.

### Options d'execution

| Option | Role |
|---|---|
| **Mode d'execution** | `Sequentiel` : les geocaches sont traitees les unes apres les autres. `Parallele` : plusieurs geocaches sont traitees simultanement (plus rapide). |
| **Concurrence max** | Nombre de geocaches traitees en parallele (mode Parallele uniquement). Augmenter cette valeur accelere l'execution mais consomme plus de ressources. |
| **Detecter les coordonnees GPS** | GeoApp cherche des coordonnees GPS dans les resultats produits par le plugin. |
| **Inclure les images** | Transmet les images des geocaches au plugin, si celui-ci peut les utiliser. |

## Lancer l'execution

Cliquez sur **Lancer** pour demarrer le traitement.

GeoApp affiche une barre de progression avec :

- le nombre de geocaches traitees ;
- le nombre d'erreurs rencontrees ;
- le pourcentage de completion.

Vous pouvez continuer a utiliser GeoApp pendant l'execution. La tache s'execute en arriere-plan.

## Suivre la progression

Le panneau de progression affiche l'etat de chaque geocache :

| Etat | Signification |
|---|---|
| **En attente** | La geocache n'a pas encore ete traitee. |
| **En cours** | Le plugin est en train de s'executer sur cette geocache. |
| **Termine** | Le plugin a produit un resultat. |
| **Erreur** | Le plugin a rencontre une erreur sur cette geocache. |

Vous pouvez consulter le detail de chaque resultat en cliquant sur une geocache dans la liste.

## Lire les resultats

Apres l'execution, chaque geocache dispose d'un resultat individuel contenant :

- le **texte decode** produit par le plugin ;
- le **score de confiance** ;
- les **coordonnees GPS detectees**, si la detection est activee ;
- la **duree d'execution** pour cette geocache ;
- un message d'erreur si l'execution a echoue.

Les geocaches avec des coordonnees detectees sont mises en evidence. Vous pouvez les consulter directement depuis la liste.

## Vue cartographique

Si des coordonnees ont ete detectees, vous pouvez afficher une vue cartographique des resultats.

La carte montre les coordonnees obtenues pour chaque geocache, ce qui permet de reperer rapidement les resultats plausibles et les outliers (coordonnees loin de la zone attendue).

## Annuler une execution

Si vous souhaitez stopper l'execution avant qu'elle soit terminee, cliquez sur **Annuler**.

Les geocaches deja traitees conservent leurs resultats. Les geocaches en attente ne seront pas traitees.

## Historique des taches

GeoApp conserve la liste des taches batch executees (actives et terminees). Vous pouvez les consulter depuis le menu **Execution par lot** > **Historique**.

Chaque tache affiche son statut (`En attente`, `En cours`, `Terminee`, `Echouee`, `Annulee`) et ses resultats.

## Depannage

| Probleme | Solution |
|---|---|
| L'execution est tres lente | Reduisez la valeur de Concurrence max ou passez en mode Sequentiel si le plugin est CPU-intensif. |
| Beaucoup d'erreurs sur les geocaches | Verifiez que les donnees des geocaches sont completes et que le plugin attend bien ce type de texte. |
| Les coordonnees ne sont pas detectees | Activez l'option Detecter les coordonnees GPS et assurez-vous que le texte de sortie contient des coordonnees lisibles. |
| Le plugin renvoie des resultats vides | Certains plugins necessitent un champ specifique (description, hint) qui n'est pas disponible pour toutes les geocaches. |
| La carte ne s'affiche pas | Verifiez que des coordonnees ont bien ete detectees dans les resultats. |

## Bonnes pratiques

- Testez d'abord le plugin sur une ou deux geocaches avec le Plugin Executor avant de lancer un batch.
- Commencez avec **Sequentiel** pour verifier que le plugin fonctionne, puis passez en **Parallele** pour les gros volumes.
- Gardez **Concurrence max** autour de 3 a 5 pour eviter de surcharger le backend.
- Activez toujours **Detecter les coordonnees GPS** si vous cherchez des positions finales.
- Utilisez la **vue cartographique** pour reperer rapidement les resultats coherents.
- Annulez et corrigez les parametres si les premiers resultats semblent incorrects, plutot que d'attendre la fin de l'execution.

## Pour l'aide IA GeoApp

Quand vous aidez un utilisateur avec l'execution par lot :

- verifiez toujours que le bon plugin a ete identifie avant de suggerer un batch (recommandez le Plugin Executor ou MetaSolver en premier si ce n'est pas le cas) ;
- guidez l'utilisateur vers le mode Sequentiel pour les premiers tests, puis Parallele pour les gros volumes ;
- rappelez que les coordonnees detectees doivent etre verifiees : un score de confiance eleve ne garantit pas une solution correcte ;
- si l'utilisateur veut appliquer le meme code sur une serie, proposez de configurer les parametres du plugin une seule fois et de le lancer sur toutes les geocaches de la zone ;
- signalez les resultats geographiquement incoherents : si des coordonnees tombent loin de la zone d'une serie, le parametre utilise est probablement faux.

Exemple de consigne utile : "Choisis le plugin Cesar avec le decalage que tu as identifie, selectionne toutes les geocaches de la zone, active Detecter les coordonnees GPS, puis lance en mode Sequentiel pour commencer. Consulte ensuite la vue cartographique pour reperer les resultats coherents."
