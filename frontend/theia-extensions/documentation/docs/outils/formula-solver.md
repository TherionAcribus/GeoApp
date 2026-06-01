---
title: "Formula Solver"
description: "Guide utilisateur pour resoudre les formules de coordonnees GPS des geocaches Mystery avec Formula Solver."
order: 15
tags: [formula-solver, formule, coordonnees, mystery, variables, questions, ia, brute-force, waypoint]
---

# Formula Solver

Formula Solver est l'outil de GeoApp dedie a la resolution des **geocaches Mystery** dont les coordonnees contiennent une formule avec des variables. Il vous guide en quatre etapes : detecter la formule, identifier les questions, trouver les reponses, puis calculer les coordonnees finales.

## Quand l'utiliser

Utilisez Formula Solver quand :

- la description d'une geocache contient des coordonnees avec des lettres : `N 47° 5A.BCD  E 006° 5(E+F).GHI` ;
- le listing pose des questions dont les reponses remplacent les variables ;
- vous avez besoin de calculer des coordonnees finales a partir de valeurs numeriques.

Formula Solver ne fait pas de decodage de codes chiffres (utilisez MetaSolver ou les plugins) ni d'analyse d'image (utilisez l'OCR). Il se concentre uniquement sur les formules de coordonnees et les questions associees.

## Ouvrir Formula Solver

- Depuis le **panneau droit** : cliquez sur l'icone Formula Solver
- Depuis une **fiche geocache** : cliquez sur le bouton **Resoudre la formule** dans l'onglet de la geocache. Formula Solver s'ouvre pre-rempli avec le texte de la description.

## Etape 1 — Detecter la formule

La premiere etape extrait la formule GPS depuis le texte de la geocache.

### Methodes de detection

| Methode | Description |
|---------|-------------|
| **Algorithme** | Detection automatique par analyse du texte (regex). Rapide et gratuit. |
| **IA** | Un modele IA analyse le texte et extrait la formule. Plus fiable sur les listings complexes. |
| **Manuel** | Vous saisissez la formule Nord et Est directement. |

Pour changer de methode, ouvrez le panneau **Configuration** en haut du widget.

### Resultat

Les formules detectees s'affichent sous forme de cartes. Chaque carte montre :

- la formule Nord et Est
- un score de confiance
- la source de detection

Cliquez sur une formule pour la selectionner. Vous pouvez aussi **modifier** la formule si la detection n'est pas parfaite : cliquez sur les champs Nord ou Est pour editer directement le texte.

Si aucune formule n'est trouvee, essayez la methode IA ou collez le texte manuellement.

## Etape 2 — Identifier les questions

Une fois la formule selectionnee, Formula Solver extrait les **variables** (lettres A, B, C...) et cherche les **questions** associees dans le texte.

### Methodes d'extraction

| Methode | Description |
|---------|-------------|
| **Aucune** | Extrait uniquement les lettres de la formule, sans question. |
| **Algorithme** | Cherche les questions par analyse du texte (regex). |
| **IA** | Un modele IA analyse le texte et associe chaque lettre a sa question. |

### Indice utilisateur pour l'IA

Si la detection IA des questions ne fonctionne pas bien, vous pouvez ajouter un **indice** en cliquant sur **Aide IA (questions)**. Tapez un texte libre pour guider l'IA, par exemple : "Les questions sont numerotees 1 a 10 en bas du listing" ou "A correspond au nombre de fenetres du batiment".

## Etape 3 — Repondre aux questions

C'est l'etape centrale. Pour chaque variable, vous devez trouver la valeur numerique qui remplacera la lettre dans la formule.

### La carte question

Chaque variable apparait dans une carte contenant :

- **Lettre** : la variable (A, B, C...)
- **Question** : le texte de la question, **editable**. Vous pouvez le modifier pour affiner les recherches IA ou Internet. Ctrl+Z fonctionne pour annuler.
- **Profil IA** : selecteur Local / Fast / Strong / Web pour cette lettre
- **Bouton IA** : lance la resolution par intelligence artificielle
- **Bouton Internet** : lance une recherche web DuckDuckGo pour trouver la reponse
- **Valeur** : le champ ou vous saisissez (ou ou l'IA saisit) la reponse
- **Type de calcul** : Valeur, Checksum, Checksum reduit, ou Longueur

### Repondre automatiquement

- **IA** : cliquez sur le bouton **IA** a cote d'une question pour que l'IA cherche la reponse. Le profil selectionne (Local/Fast/Strong/Web) determine le modele utilise.
- **Internet** : cliquez sur **Internet** pour lancer une recherche web. DuckDuckGo est interroge et la meilleure reponse est extraite automatiquement.
- **Tout repondre** : utilisez les boutons en haut de la section pour repondre a toutes les questions en une seule fois (IA ou Internet).

### Repondre manuellement

Tapez directement la valeur dans le champ **Valeur** de chaque lettre. Selectionnez le bon type de calcul :

| Type | Ce qu'il fait | Exemple |
|------|---------------|---------|
| **Valeur** | Utilise le nombre tel quel | `1867` → `1867` |
| **Checksum** | Somme des chiffres (ou positions alphabetiques A=1..Z=26) | `Paris` → `16+1+18+9+19 = 63` |
| **Checksum reduit** | Checksum iteratif jusqu'a un seul chiffre | `63` → `6+3 = 9` |
| **Longueur** | Nombre de caracteres (sans espaces) | `Paris` → `5` |

Quand l'IA repond, elle detecte automatiquement le bon type de calcul d'apres la question. Vous pouvez toujours le modifier manuellement.

### Details de la reponse

Apres une reponse IA ou Internet, un bouton **i** apparait a cote de la lettre. Cliquez dessus pour voir :

- la source (IA ou Internet) et le profil utilise
- l'explication du raisonnement de l'IA
- les sources web avec leurs URL cliquables (s'ouvrent dans le navigateur)
- le type de calcul applique

### Profils IA

Vous pouvez choisir un profil IA different pour chaque lettre :

| Profil | Quand l'utiliser |
|--------|-----------------|
| **Local** | Modele local (LMStudio/Ollama). Gratuit, rapide, mais moins precis. |
| **Fast** | Modele cloud leger. Bon equilibre cout/qualite pour les questions simples. |
| **Strong** | Modele cloud puissant. Pour les questions difficiles qui necessitent du raisonnement. |
| **Web** | Combine recherche web + IA. Recherche d'abord sur Internet, puis l'IA extrait la reponse des resultats. Ideal pour les questions factuelles. |

### Contexte IA avance

Cliquez sur **Afficher champs IA** pour acceder aux options avancees :

- **Info complementaire par lettre** : ajoutez des indices specifiques pour aider l'IA sur une question particuliere
- **Contexte IA (JSON)** : visualisez et editez le contexte que l'IA utilise (resume geocache, regles globales, regles par lettre)
- **Instructions supplementaires** : ajoutez des consignes appliquees a chaque question (ex: "Respecte la casse exacte")
- **Rafraichir le contexte** : recalcule le contexte IA si vous avez modifie les questions

## Etape 4 — Calculer les coordonnees

### Previsualisation en temps reel

Des que vous entrez des valeurs, la **previsualisation** affiche les coordonnees en cours de construction. Pour chaque axe (Nord / Est), vous voyez :

- les **chiffres resolus** (en vert) et les **lettres manquantes** (en gris)
- un indicateur de **validite** : les valeurs hors limites (degres > 90, minutes > 59...) sont signalees en rouge
- les **lettres suspectes** identifiees comme cause probable d'une incoherence

La previsualisation n'attend pas que toutes les valeurs soient remplies : elle montre l'etat partiel a chaque instant.

### Calcul automatique

Quand toutes les variables sont remplies et que la previsualisation est valide, le calcul final se lance automatiquement. Le resultat affiche :

- les coordonnees en format DDM (degres minutes decimales), DMS et decimal
- la distance par rapport aux coordonnees d'origine de la geocache
- un bouton **Copier** pour copier les coordonnees
- un bouton **Creer waypoint** pour enregistrer le resultat
- un bouton **Afficher sur la carte** pour visualiser le point

### Brute Force

Si certaines variables restent inconnues, vous pouvez utiliser le **Brute Force** :

1. Selectionnez les lettres a tester et la plage de valeurs (0-9 par defaut)
2. Cliquez sur **Executer**
3. Formula Solver teste toutes les combinaisons et garde celles qui produisent des coordonnees valides
4. Les resultats apparaissent avec leurs valeurs et coordonnees
5. Pour chaque resultat, vous pouvez **Creer un waypoint** ou **Ajouter et valider** directement

Le brute force est utile quand il reste une ou deux lettres inconnues. Au-dela de 3 lettres, le nombre de combinaisons devient tres grand.

## Configuration

Ouvrez le panneau de configuration (icone engrenage en haut du widget) pour regler :

| Option | Description |
|--------|-------------|
| **Detection** | Algorithme, IA ou Manuel |
| **Questions** | Aucune, Algorithme ou IA |
| **Reponses** | IA par question, IA en bloc, ou Manuel |
| **Profil IA (Formule)** | Modele utilise pour la detection IA |
| **Profil IA (Questions)** | Modele utilise pour l'extraction des questions |
| **Profil IA (Reponses)** | Profil par defaut pour les reponses (peut etre surcharge par lettre) |

## Bonnes pratiques

- **Commencez par l'algorithme** pour la detection : c'est le plus rapide. Passez a l'IA uniquement si rien n'est trouve.
- **Verifiez la formule** detectee avant de passer aux questions. Une erreur dans la formule se propagera dans tout le calcul.
- **Editez les questions** si elles sont mal extraites. La qualite de la question conditionne la qualite de la reponse IA ou web.
- **Utilisez le profil Web** pour les questions factuelles (dates, noms propres, lieux). Il combine le meilleur d'Internet et de l'IA.
- **Utilisez le profil Strong** pour les questions de raisonnement (enigmes, deductions logiques).
- **Surveillez la previsualisation** : les alertes rouges vous evitent d'attendre le calcul final pour detecter une erreur.
- **Utilisez le brute force** avec parcimonie : 1-2 lettres maximum pour rester rapide.
- **Verifiez toujours** les coordonnees obtenues avec un checker si disponible, et verifiez qu'elles tombent dans une zone coherente.

## Pour l'aide IA GeoApp

Quand vous aidez un utilisateur avec Formula Solver :

- guidez-le a travers les 4 etapes dans l'ordre ;
- si la detection echoue, suggerez de passer en mode IA ou de saisir la formule manuellement ;
- si une reponse IA est fausse, suggerez de modifier la question ou d'essayer le profil Web ;
- rappelez que la previsualisation montre les erreurs en temps reel ;
- si le listing est complexe, suggerez d'utiliser le mode "Aide IA (questions)" avec un indice utilisateur ;
- ne suggerez pas de calculer les checksums manuellement : Formula Solver le fait automatiquement selon le type de calcul selectionne ;
- pour les questions factuelles simples, recommandez le bouton Internet plutot que l'IA.

Exemple de consigne utile : "Ouvre Formula Solver depuis la fiche de ta geocache, lance la detection algorithme, verifie la formule, puis clique sur 'Tout repondre IA' pour que l'IA cherche les reponses. Verifie la previsualisation et corrige les lettres en rouge."
