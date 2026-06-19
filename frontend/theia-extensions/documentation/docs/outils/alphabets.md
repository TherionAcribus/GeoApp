---
title: "Utiliser les Alphabets"
description: "Guide utilisateur pour rechercher, afficher et utiliser les alphabets de symboles dans GeoApp."
order: 25
tags: [alphabets, symboles, codes, dechiffrement, geocaching, viewer, coordonnees, aide-ia]
---

# Utiliser les Alphabets

Le module **Alphabets** aide a reconnaitre et transcrire des alphabets de symboles utilises dans les geocaches Mystery : runes, alphabets fictifs, pictogrammes, codes visuels, polices speciales ou collections d'images.

Il ne remplace pas MetaSolver ni les plugins de decodage. Son role est de vous aider quand l'enigme montre des **symboles a identifier visuellement** et que vous devez les convertir en texte, chiffres ou ponctuation avant de poursuivre la resolution.

## Quand l'utiliser

Utilisez les Alphabets quand :

- l'image ou le listing contient des lettres dans un alphabet inconnu ;
- vous reconnaissez une famille de symboles, mais vous ne connaissez pas toutes les correspondances ;
- vous devez recopier une suite de symboles dans l'ordre ;
- vous voulez tester rapidement plusieurs alphabets proches ;
- le texte obtenu peut ensuite etre envoye a MetaSolver, Formula Solver ou un autre outil.

Exemples typiques :

- alphabet Aurebesh, runes, Pigpen, Semaphore, Drapeaux maritimes ;
- codes de jeux video ou univers fictifs ;
- alphabets rendus avec une police speciale ;
- alphabets ou chaque symbole est une image.

## Ouvrir le panneau Alphabets

Vous pouvez ouvrir la liste des alphabets :

- depuis le menu **Affichage** > **Alphabets** ;
- depuis la palette de commandes avec `Alphabets: Ouvrir la liste` ;
- depuis l'aide IA `@Aide`, en demandant par exemple : "ouvre le panneau Alphabets".

Le panneau s'ouvre dans la barre laterale gauche. Il affiche les alphabets disponibles et une entree speciale pour les **Chiffres cisterciens**.

## Rechercher un alphabet

Tapez un mot dans la barre de recherche du panneau Alphabets.

La recherche peut porter sur :

- le nom ;
- la description ;
- les tags ;
- le README de l'alphabet, si l'option est activee.

Conseils :

- cherchez le nom si vous le connaissez : `aurebesh`, `runes`, `drapeaux` ;
- cherchez un univers ou une famille : `hobbit`, `star wars`, `maritime` ;
- cherchez une caracteristique : `symboles`, `police`, `images`.
- essayez des mots descriptifs : `marin`, `alien`, `runique`, `telegraphe`,
  `couleur`, `cochon`.

La recherche comprend aussi plusieurs synonymes utiles en geocaching. Par
exemple, `marin` peut faire remonter les drapeaux maritimes et le semaphore,
`runique` peut faire remonter les runes ou le futhark, et `cochon` peut aider a
retrouver Pigpen/Pig Pen.

Quand une recherche est active, GeoApp conserve l'ordre de pertinence renvoye par le backend. Les meilleurs resultats apparaissent en premier.

## Comprendre les deux types d'alphabets

GeoApp affiche deux types d'alphabets.

| Type | Ce que vous voyez | Particularite |
|---|---|---|
| **Police** | Les symboles sont rendus par une police speciale. | Le texte insere reste la lettre normale, mais son affichage prend la forme du symbole. |
| **Images** | Chaque symbole est une image. | GeoApp cherche l'image correspondante et affiche le symbole dans le viewer. |

Dans les deux cas, ce qui compte est la **valeur inseree** : la lettre, le chiffre ou le signe choisi. Le nom du fichier image n'est pas insere dans le texte.

## Ouvrir et utiliser un alphabet

Cliquez sur un alphabet dans la liste pour ouvrir son viewer.

Le viewer contient en general :

- une zone de symboles deja saisis ;
- un champ texte decode ;
- une grille des symboles disponibles ;
- des controles de zoom ;
- des actions d'edition ;
- une zone d'association geocache ;
- une detection de coordonnees si le texte ressemble a des coordonnees GPS.

Pour decoder un message :

1. Trouvez le symbole dans la grille.
2. Cliquez dessus pour l'ajouter.
3. Continuez dans l'ordre du message original.
4. Lisez le texte decode dans la zone texte.
5. Corrigez si necessaire avec suppression, drag and drop ou edition directe.

## Ajouter, corriger et organiser les symboles

### Ajouter un symbole

Cliquez sur un symbole disponible. Il est ajoute a la fin de la sequence.

### Supprimer

Utilisez le bouton de suppression ou la commande de suppression du dernier symbole.

### Reordonner

Vous pouvez deplacer les symboles saisis par drag and drop. C'est utile si vous avez clique trop vite ou si vous recopiez une ligne dans le mauvais ordre.

### Menu contextuel

Un clic droit sur un symbole saisi donne acces aux actions selon le contexte :

- supprimer ;
- dupliquer ;
- inserer avant ou apres.

### Annuler et refaire

Le viewer garde un historique depuis l'etat vide. Utilisez undo/redo si vous avez fait une erreur de saisie ou de reorganisation.

## Saisir directement dans le texte

Vous pouvez aussi modifier directement le champ de texte decode.

C'est pratique quand :

- vous connaissez une partie du message ;
- vous voulez ajouter des espaces ;
- vous voulez corriger une lettre sans rechercher le symbole ;
- l'alphabet sert seulement de table de correspondance.

Le texte et la zone de symboles restent synchronises.

## Majuscules, minuscules, chiffres et signes

Certains alphabets distinguent majuscules et minuscules. D'autres n'ont que des majuscules ou seulement certaines lettres.

GeoApp affiche uniquement les symboles declares disponibles par l'alphabet :

- lettres ;
- chiffres ;
- signes speciaux comme `.`, `,`, espace ou caracteres accentues ;
- variantes propres a certains alphabets.

Si un symbole semble manquer, verifiez que vous avez ouvert le bon alphabet ou essayez une recherche plus large.

## Associer une geocache

Dans le viewer, vous pouvez associer une geocache avec son code GC.

Cette association sert notamment a :

- garder le contexte du travail ;
- calculer une distance si des coordonnees sont detectees ;
- verifier si le resultat obtenu tombe dans une zone plausible.

Saisissez le code GC, puis validez. Si la geocache existe dans GeoApp, son nom et ses coordonnees d'origine sont utilises par le viewer.

## Detection de coordonnees

Quand le texte decode ressemble a des coordonnees GPS, GeoApp peut les detecter automatiquement.

Si une geocache est associee, GeoApp peut aussi afficher la distance entre les coordonnees d'origine et les coordonnees detectees.

Bonnes pratiques :

- ajoutez les espaces et ponctuations manquants si la detection echoue ;
- verifiez que les coordonnees sont au bon format ;
- comparez la distance avec le rayon attendu d'une Mystery ;
- utilisez un checker si disponible.

## Chiffres cisterciens

Les **Chiffres cisterciens** sont un outil special accessible depuis la liste Alphabets.

Ils ne fonctionnent pas comme un alphabet classique. Utilisez-les quand une enigme affiche des symboles cisterciens representant des nombres.

Ouvrez l'entree **Chiffres cisterciens**, puis utilisez l'outil dedie pour lire ou composer les valeurs.

## Enchainer avec les autres outils

Une fois le texte decode obtenu :

- envoyez un fragment suspect a **MetaSolver** si le resultat ressemble encore a un code ;
- utilisez **Formula Solver** si le texte contient une formule de coordonnees ;
- utilisez le **Chat IA GeoApp** si vous avez besoin d'interpreter une phrase, un indice ou un theme ;
- creez ou verifiez un waypoint si des coordonnees finales sont detectees.

Le module Alphabets est souvent la premiere etape : il transforme des symboles visuels en texte exploitable par les autres outils.

## Depannage

| Probleme | Solution |
|---|---|
| Aucun alphabet ne s'affiche | Verifiez que le backend GeoApp est lance. |
| La recherche ne trouve rien | Essayez un mot plus large, un tag, ou des termes en anglais/francais. |
| Les symboles images ne s'affichent pas | Essayez de rafraichir la liste ou de rouvrir le viewer. Si le probleme persiste, l'alphabet peut avoir une ressource manquante. |
| Une police ne s'affiche pas | Verifiez que le backend est accessible et que le navigateur n'a pas bloque le chargement de police. |
| Le texte decode est incoherent | Verifiez l'ordre des symboles et les majuscules/minuscules. |
| Les coordonnees ne sont pas detectees | Ajoutez les espaces, points ou lettres N/E/W attendus, puis reessayez. |

## Bonnes pratiques

- Travaillez ligne par ligne si le message est long.
- Ajoutez les espaces des que vous les identifiez : cela aide la lecture et la detection de coordonnees.
- Comparez plusieurs alphabets proches si les symboles se ressemblent.
- Gardez le message original visible a cote pour eviter les inversions.
- Utilisez undo/redo plutot que de tout effacer si vous faites une erreur.
- Verifiez toujours le texte obtenu avant de lancer d'autres outils.

## Pour l'aide IA GeoApp

Quand vous aidez un utilisateur avec les Alphabets :

- commencez par identifier s'il s'agit bien d'un alphabet visuel, pas d'un code texte pur ;
- proposez d'ouvrir le panneau Alphabets avec `aide_open_alphabets_panel` si l'utilisateur veut travailler dans l'interface ;
- utilisez `aide_list_alphabets(search)` pour rechercher une famille ou un nom d'alphabet ;
- recommandez d'ouvrir le viewer correspondant et de cliquer les symboles dans l'ordre ;
- expliquez que le texte decode est la valeur des symboles, pas le nom des fichiers image ;
- si le texte obtenu ressemble encore a un code, orientez ensuite vers MetaSolver ;
- si le texte obtenu contient une formule, orientez ensuite vers Formula Solver ;
- si des coordonnees apparaissent, recommandez de les verifier avec la distance et un checker.

Exemple de consigne utile : "Ouvre le panneau Alphabets, cherche `drapeaux`, ouvre Drapeaux maritimes, puis clique les symboles dans l'ordre de ton image. Une fois le texte obtenu, copie le fragment dans MetaSolver si cela ressemble encore a un code."
