---
title: "Utiliser un plugin de decodage"
description: "Guide utilisateur pour ouvrir, configurer et executer un plugin de dechiffrement specifique dans GeoApp."
order: 30
tags: [plugin, decodage, encodage, dechiffrement, code, chiffrement, brute-force, coordonnees, geocaching]
---

# Utiliser un plugin de decodage

Le **Plugin Executor** permet d'executer un plugin de dechiffrement precis sur un texte. Il est concu pour les cas ou vous savez quel chiffrement a ete utilise : Cesar, Vigenere, Morse, Base64, Bacon, Playfair, T9, Rail Fence, et plus de 80 autres.

Si vous ne savez pas quel chiffrement identifier, utilisez plutot **MetaSolver** qui teste plusieurs plugins a la fois et propose une recommandation.

## Les deux contextes d'utilisation

Le Plugin Executor s'ouvre de deux facons differentes, avec un comportement different selon le contexte.

### Depuis le panneau Plugins

Vous ouvrez directement un plugin depuis la liste des plugins disponibles.

- Le plugin est pre-selectionne et ne peut pas etre change depuis ce panneau.
- Vous pouvez choisir le mode : **Encoder** ou **Decoder**.
- Vous pouvez associer une geocache optionnellement.

C'est le mode ideal pour tester un chiffrement precis, encoder un texte ou explorer les parametres d'un plugin.

### Depuis une fiche geocache

Quand vous ouvrez un plugin depuis la fiche d'une geocache, le comportement change :

- La geocache est fixee et ses donnees sont chargees automatiquement.
- Vous pouvez choisir le plugin a executer depuis un selecteur.
- Le mode est **Decoder** uniquement.
- Vous pouvez enchainer plusieurs plugins sur le meme texte.

C'est le mode ideal pour analyser un code trouve dans une geocache et passer le resultat d'un plugin au suivant.

## Ouvrir le panneau Plugins

Vous pouvez ouvrir le panneau de la liste des plugins :

- depuis le menu **Affichage** > **Plugins** ;
- depuis la palette de commandes avec `Plugins: Ouvrir` ;
- depuis l'aide IA `@Aide`, en demandant par exemple : "ouvre le plugin Cesar".

Le panneau s'ouvre dans la barre laterale. Cliquez sur un plugin pour ouvrir son executeur dans un onglet.

## Le formulaire d'execution

Chaque plugin affiche un formulaire genere automatiquement depuis sa definition. Les champs varies selon le plugin.

Champs communs :

| Champ | Role |
|---|---|
| **Texte** | Le texte a encoder, decoder ou analyser. |
| **Mode** | `Decoder` (par defaut), `Encoder` ou `Analyser / Detecter` selon les capacites du plugin. |

Champs speciaux selon le plugin :

| Exemple | Plugin concerne |
|---|---|
| **Decalage** (0-25) | Cesar |
| **Cle** (mot ou phrase) | Vigenere, Beaufort... |
| **Coefficient a, b** | Chiffre affine |
| **Cles A-Z** | ADFGVX, ADFGX |
| **Nbr de rails** | Rail Fence |
| **Alphabet cible** | Plugins d'alphabets speciaux |

Si un champ est pre-rempli automatiquement depuis la geocache (code GC, description, coordonnees), vous pouvez le modifier avant d'executer.

## Lancer l'execution

Cliquez sur **Executer** pour lancer le plugin avec les valeurs du formulaire.

GeoApp envoie le texte et les parametres au backend, attend le resultat et l'affiche dans le panneau de resultats. L'execution est en general immediate (quelques dizaines de millisecondes).

## Lire les resultats

Les resultats contiennent :

- **Texte decode** : la sortie principale du plugin.
- **Score de confiance** : evaluation automatique de la vraisemblance du texte produit. Un score eleve indique un texte plausible dans une langue naturelle. Un score faible indique un resultat probablement incorrect.
- **Coordonnees GPS** : si des coordonnees sont detectees dans le texte de sortie, GeoApp les extrait et les affiche separement.
- **Parametres utilises** : recapitulatif des valeurs envoyees au plugin.

Le score de confiance est calcule automatiquement par le moteur de scoring linguistique de GeoApp. Il aide a trier les hypotheses en mode brute-force, mais n'est pas infaillible. Verifiez toujours le texte obtenu par rapport au contexte de l'enigme.

## Mode brute-force

Certains plugins proposent un mode **Brute-force** ou **Toutes les cles**.

Quand ce mode est active, le plugin teste toutes les combinaisons de parametres possibles et renvoie plusieurs resultats tries par score.

Exemples :

- Cesar brute-force : teste les 26 decalages possibles.
- Affine brute-force : teste toutes les paires (a, b) valides (312 combinaisons).
- Rail Fence brute-force : teste plusieurs nombres de rails.

Conseils :

- Activez le brute-force si vous n'avez pas la cle et que le plugin le propose.
- Regardez les 3 ou 4 premiers resultats. Le texte correct est souvent en tete.
- Si aucun resultat ne semble lisible, le chiffrement est probablement different.

## Mode Analyser / Detecter

Certains plugins proposent un mode **Analyser** ou **Detecter**.

Dans ce mode, le plugin ne decode pas le texte mais verifie s'il ressemble a ce type de code. Il renvoie une evaluation de la probabilite que le texte soit encode avec ce chiffrement.

Ce mode est utilise automatiquement par MetaSolver pour recommander les plugins les plus adaptes. Vous pouvez aussi l'utiliser manuellement pour tester une hypothese.

## Detection de coordonnees GPS

Quand le plugin produit une sortie, GeoApp peut chercher automatiquement des coordonnees GPS dans le texte.

Si des coordonnees sont trouvees, elles sont affichees avec :

- le format standard (N dd° mm.mmm E ddd° mm.mmm) ;
- les coordonnees decimales ;
- la distance par rapport a la geocache associee, si une geocache est liee.

Bonnes pratiques :

- Verifiez que les coordonnees tombent dans une zone geographique plausible pour l'enigme.
- Si la distance depasse plusieurs dizaines de kilometres, le resultat est probablement faux.
- Comparez avec le rayon attendu pour une geocache Mystery (generalement moins de 5 km depuis les coordonnees d'origine).

## Associer une geocache

Depuis le mode Plugin, vous pouvez associer une geocache en entrant son code GC.

Cette association permet :

- de voir la distance entre les coordonnees detectees et les coordonnees d'origine ;
- de pre-remplir certains champs si le plugin utilise des donnees de geocache ;
- de sauvegarder le plugin utilise dans l'historique de resolution.

## Enchainer les plugins (mode geocache)

Depuis une fiche geocache, vous pouvez enchainer les plugins. Apres une execution, vous pouvez :

- envoyer le texte de sortie d'un plugin comme entree du suivant ;
- consulter l'historique des executions precedentes dans le panneau.

Exemple typique :

1. Plugin **Base64** decode un texte encode en base64, qui donne une suite de chiffres.
2. Vous envoyez ces chiffres au plugin **Position alphabetique** pour obtenir des lettres.
3. Les lettres donnent un mot-cle, utilise ensuite dans **Vigenere**.

## Depannage

| Probleme | Solution |
|---|---|
| Le plugin ne produit aucun resultat | Verifiez que le texte est dans le bon format pour ce plugin. Certains plugins n'acceptent que les majuscules ou les caracteres A-Z. |
| Le score est bas pour tous les resultats | Le chiffrement est peut-etre different. Essayez un autre plugin ou lancez MetaSolver. |
| Les coordonnees ne sont pas detectees | Ajoutez les espaces, points ou lettres N/E attendus dans le texte de sortie, ou verifiez si la sortie contient plusieurs fragments. |
| Le plugin renvoie une erreur | Verifiez les parametres : certains plugins rejettent des valeurs hors plage (ex. cle vide, coefficient invalide). |
| L'execution est lente | Certains plugins sont CPU-intensifs, notamment en brute-force. Patientez ou reduisez la portee. |

## Bonnes pratiques

- Commencez par identifier le type de code avant de choisir un plugin.
- Utilisez **MetaSolver** si vous hesitez entre plusieurs chiffrements.
- En brute-force, regardez d'abord les 3 ou 4 premiers resultats classes.
- Si le texte semble presque lisible (quelques lettres coherentes), essayez de corriger les parametres manuellement.
- Associez toujours une geocache pour profiter de la detection de distance.
- Verifiez les coordonnees obtenues avant de creer un waypoint.

## Pour l'aide IA GeoApp

Quand vous aidez un utilisateur avec le Plugin Executor :

- distinguez bien les deux modes : mode Plugin (librement choisi) et mode Geocache (contexte fixe, enchainement possible) ;
- si l'utilisateur ne sait pas quel plugin utiliser, orientez vers MetaSolver ou la recommandation automatique ;
- si l'utilisateur connait le chiffrement, proposez d'ouvrir directement le plugin par son nom : "ouvre le plugin Cesar" ;
- en brute-force, rappelez que le score de confiance aide a trier mais ne garantit pas la solution ;
- si les coordonnees detectees semblent loin de la geocache, signalez que le resultat est probablement incorrect ;
- n'encodez jamais par defaut : verifiez toujours si l'utilisateur cherche a decoder ou encoder.

Exemple de consigne utile : "Colle le texte dans le champ Texte, laisse le mode sur Decoder, active Brute-force si tu n'as pas la cle, et execute. Si un resultat semble lisible, verifie les coordonnees et compare la distance avec la geocache."

Exemple pour enchainer : "Lance d'abord Base64 sur le fragment. Si le resultat est une suite de chiffres, envoie-les au plugin Position alphabetique pour obtenir des lettres."
