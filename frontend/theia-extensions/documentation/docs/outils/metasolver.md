---
title: "Utiliser MetaSolver"
description: "Guide utilisateur pour analyser un code, choisir les plugins et lancer MetaSolver dans GeoApp."
order: 20
tags: [metasolver, decodeur, codes, plugins, geocaching, aide-ia]
---

# Utiliser MetaSolver

MetaSolver sert a essayer plusieurs plugins de decodage sur un meme texte. Il est concu pour les codes numeriques, alphabetiques, alphanumeriques ou contenant des symboles.

Il ne remplace pas les autres workflows GeoApp. Il ne fait pas d'OCR, n'analyse pas les images, ne cherche pas le HTML cache, ne resout pas les formules et ne calcule pas les projections. Si une enigme demande ce type d'analyse, utilisez les outils dedies ou le Chat IA GeoApp avant de revenir a MetaSolver avec le fragment a decoder.

## Quand l'utiliser

Utilisez MetaSolver quand vous avez un fragment qui ressemble a un code :

- une suite de chiffres : `78325257423248544650495032` ;
- des groupes de nombres : `8 5 12 12 15` ;
- du Morse : `.... . .-.. .-.. ---` ;
- du texte suspect : `URYYB JBEYQ` ;
- des symboles, groupes, paires ou caracteres repetitifs.

Evitez de lancer MetaSolver sur un listing complet si le texte contient surtout de la prose. Vous pouvez coller un texte plus large pour extraire un fragment, mais le meilleur resultat vient presque toujours d'un fragment court et structure.

## Principe general

1. Collez le code ou le texte contenant le code dans **Texte a decoder**.
2. Cliquez sur **Analyser / recommander** pour laisser GeoApp proposer une selection de plugins.
3. Si des fragments sont detectes, ouvrez **Voir les details** et cliquez sur **Utiliser ce fragment** pour remplacer le texte courant.
4. Cliquez sur **Appliquer la recommandation** si vous voulez utiliser la sous-liste proposee.
5. Cliquez sur **Executer les plugins** pour lancer les plugins selectionnes.
6. Lisez les resultats, puis verifiez manuellement les coordonnees ou le texte obtenu.

MetaSolver ne se lance pas automatiquement a l'ouverture. Les analyses et executions partent uniquement quand vous cliquez sur un bouton.

## Les controles

| Controle | Role |
|---|---|
| **Selection** | Choisit la liste de plugins a executer : recommandation, preset ou selection personnalisee. |
| **Max plugins** | Limite le nombre de plugins executes. `0` signifie illimite. Une petite valeur reduit le bruit et accelere les essais. |
| **Detecter coordonnees GPS** | Cherche des coordonnees GPS dans les resultats produits par les plugins. |
| **Inclure coordonnees ecrites** | Cherche aussi des coordonnees exprimees avec des mots. Cette option apparait seulement si la detection GPS est activee. |
| **Langue mots** | Langue utilisee pour les coordonnees ecrites : Auto, FR, EN ou FR + EN. |
| **Detail** | Niveau de detail de l'affichage pendant l'execution : Min, Normal ou Detaille. |

## Selection des plugins

La liste **Selection** peut afficher plusieurs modes :

- **Recommandation** : GeoApp a analyse le texte et propose une sous-liste de plugins adaptee a sa signature.
- **Selection personnalisee** : vous avez coche ou decoche des plugins dans la liste complete.
- **Tous les codes** ou un autre preset : MetaSolver utilise un groupe large de plugins correspondant au preset choisi.

Si vous cliquez sur **Appliquer la recommandation**, la selection passe explicitement en mode **Recommandation**. Si vous modifiez ensuite la liste complete, la selection passe en mode **Selection personnalisee**.

## Fragments detectes

Le bouton **Analyser / recommander** peut extraire des fragments probables depuis le texte courant. Les fragments apparaissent dans **Voir les details**.

Cliquez sur **Utiliser ce fragment** pour remplacer le contenu de **Texte a decoder**. Cette action ne lance pas les plugins : elle prepare seulement le texte courant. Vous gardez donc le controle sur le moment ou l'execution demarre.

## Resultats et coordonnees

Les resultats peuvent contenir :

- du texte decode ;
- plusieurs hypotheses classees par score ;
- des coordonnees candidates ;
- des erreurs de plugins individuels.

Un resultat bien score n'est pas toujours une solution correcte. Verifiez les coordonnees obtenues avec la logique de l'enigme, la zone geographique attendue et, si disponible, un checker.

## Bonnes pratiques

- Commencez par un fragment court plutot que par toute la description.
- Utilisez **Analyser / recommander** avant de lancer tous les plugins.
- Gardez **Max plugins** autour de 6 a 10 pour limiter le bruit, sauf si vous voulez explorer large.
- Activez **Detecter coordonnees GPS** quand vous cherchez une position finale.
- Activez **Inclure coordonnees ecrites** seulement si vous pensez que la solution peut etre en mots.
- Si la recommandation semble mauvaise, ouvrez la liste complete et ajoutez ou retirez les plugins manuellement.

## Pour l'aide IA GeoApp

Quand vous aidez un utilisateur avec MetaSolver :

- traitez MetaSolver comme un decodeur de fragments, pas comme un orchestrateur complet de resolution ;
- ne demandez pas a MetaSolver de faire OCR, image, contenu cache, formule ou projection ;
- si le listing est long, identifiez d'abord le fragment le plus structure ;
- recommandez d'utiliser **Analyser / recommander** pour obtenir une sous-liste de plugins ;
- recommandez **Utiliser ce fragment** avant **Executer les plugins** quand un fragment pertinent est detecte ;
- rappelez que l'execution est manuelle et que les coordonnees doivent etre verifiees.

Exemple de consigne utile : "Colle le bloc numerique dans Texte a decoder, clique sur Analyser / recommander, applique la recommandation, puis execute les plugins. Si GeoApp detecte un fragment plus propre, utilise ce fragment avant d'executer."
