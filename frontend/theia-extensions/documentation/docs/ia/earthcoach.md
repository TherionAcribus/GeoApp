---
title: "EarthCoach pour les EarthCaches"
description: "Utiliser l'agent EarthCoach pour comprendre une EarthCache, preparer le terrain, illustrer des termes geologiques et enregistrer une synthese dans les notes."
order: 25
tags: [IA, EarthCoach, EarthCache, geologie, references, images, notes, terrain]
---

# EarthCoach pour les EarthCaches

EarthCoach est l'agent IA specialise de GeoApp pour les **EarthCaches**. Il aide a comprendre le listing, preparer la visite, expliquer les notions geologiques, analyser vos observations et construire une synthese prudente.

EarthCoach est disponible dans le chat sous le nom `@EarthCoach`. Il est aussi accessible depuis le bouton **EarthCoach** visible dans l'en-tete d'une fiche EarthCache.

## Ce qu'EarthCoach peut faire

EarthCoach peut vous aider a :

- comprendre le texte et les questions d'une EarthCache ;
- expliquer un terme geologique avec des mots simples ;
- preparer une visite terrain ;
- enregistrer des observations structurees avec date, waypoint, coordonnees et photos ;
- separer observation, interpretation et hypothese ;
- analyser vos notes personnelles ;
- chercher des references pedagogiques externes ;
- afficher des images pedagogiques generiques ;
- enregistrer une synthese dans les notes GeoApp, si vous le demandez explicitement.

EarthCoach ne remplace pas vos observations terrain. Il ne doit pas inventer une couleur, une mesure, une orientation, une strate, un fossile, une texture ou une visite.

## Modes disponibles

EarthCoach a deux modes.

| Mode | Usage |
|---|---|
| `coach` | Mode par defaut. Il guide, explique et aide a observer sans donner une reponse finale prete a envoyer. |
| `resolver` | Mode explicite pour aider a resoudre avec vos observations. Il peut proposer une formulation candidate, mais ne doit pas inventer les donnees manquantes. |

Le mode `resolver` n'est pas un hack cache. C'est un mode assumé qui reste contraint par les donnees fournies : listing, notes, observations et images identifiees.

## Actions rapides

Quand vous ouvrez EarthCoach depuis une EarthCache, GeoApp propose plusieurs actions.

| Action | Resultat attendu |
|---|---|
| **Comprendre cette EarthCache** | Resume le but geologique, explique le contexte et les questions utiles. |
| **Preparer ma visite** | Produit une checklist terrain : observer, mesurer, photographier, noter. |
| **Mode terrain compact** | Ouvre une checklist imprimable/mobile sans attendre une reponse du chat. |
| **Observations terrain** | Ouvre la vue de creation, edition et liaison de photos aux observations structurees. |
| **Questions du proprietaire** | Ouvre la vue de suivi des questions du log : ajout, edition, statut, photo requise et extraction IA. |
| **Galerie images EarthCoach** | Separe visuellement images du listing, photos utilisateur et references pedagogiques. |
| **Illustrer un terme** | Ouvre les references EarthCoach avec articles et images pedagogiques. |
| **Expliquer un mot** | Explique un terme geologique dans le contexte de la cache. |
| **Analyser mes observations** | Classe vos notes entre observation, interpretation et hypothese. |
| **Resoudre avec mes observations** | Lance le mode `resolver` pour construire une synthese prudente. |

## Images et origines

EarthCoach distingue strictement trois origines d'images.

| Origine | Signification |
|---|---|
| `cache_listing` | Image issue du listing ou de la description de la cache. |
| `user_observation` | Photo fournie par vous, prise sur le terrain ou ajoutee comme observation personnelle. |
| `educational_reference` | Image pedagogique generique, par exemple quartz, calcaire coquillier, faille ou strate. |

Une image pedagogique ne doit jamais etre presentee comme une photo de terrain. Une image du listing ne remplace pas vos observations personnelles.

## Galerie images EarthCoach

La **Galerie images EarthCoach** est une vue dediee a la separation des images par origine.

Elle affiche trois sections distinctes :

| Section | Contenu | Rappel affiche |
|---|---|---|
| **Photos utilisateur** | Photos ajoutees comme observations personnelles. | Elles peuvent aider a analyser vos observations, avec confirmation terrain si necessaire. |
| **Images du listing** | Images fournies par la description de la cache. | Elles ne prouvent pas ce que vous avez observe sur place. |
| **References pedagogiques** | Images generiques issues de references externes. | Elles ne doivent jamais etre presentees comme observation terrain. |

Cette vue sert a eviter les confusions. Si vous voulez chercher des exemples pedagogiques supplementaires, utilisez le bouton **References pedagogiques** ou l'action **Illustrer un terme**.

## Questions du proprietaire (logging tasks)

L'action **Questions du proprietaire** ouvre une vue EarthCoach dediee au suivi des questions imposees par le proprietaire de l'EarthCache.

Chaque question peut contenir :

- le texte de la question ;
- une consigne d'observation (ce qu'il faut observer ou mesurer) ;
- un statut : a traiter, a observer sur le terrain ou repondu ;
- l'indication d'une photo requise ;
- un brouillon de reponse ;
- une observation terrain liee.

Le bouton **Extraire via EarthCoach (IA)** demande a l'agent de lire le listing et de remplir automatiquement la liste des questions. Cette extraction **remplace** les questions deja enregistrees : EarthCoach ne la lance que si vous le demandez explicitement, et n'invente jamais de question ni de reponse. Vous pouvez ensuite corriger, completer ou supprimer chaque question a la main.

Ces questions sont reutilisees par EarthCoach :

- dans le **mode terrain compact**, pour la section des questions a verifier sur place ;
- dans le **mode resolver**, qui traite chaque question selon un gabarit structure : reponse proposee, observation qui la fonde, niveau de confiance et ce qu'il reste a completer.

## Calculs geologiques

Beaucoup d'EarthCaches posent des questions chiffrees (hauteur, pente, distance, age, debit...). EarthCoach dispose d'un outil de calcul deterministe `earthcoach_calculate` : il applique une formule exacte aux mesures que vous fournissez, au lieu d'estimer le resultat de tete.

Il peut notamment :

- estimer une **hauteur a partir d'une ombre** de reference ;
- estimer une **taille reelle a partir d'un objet de reference** (echelle) ;
- calculer un **angle de pente** (degres et pourcentage) ;
- calculer la **distance entre deux coordonnees** ;
- estimer un **age a partir d'un taux** (sedimentation, erosion...) ;
- calculer un **debit** (volume / temps) ;
- convertir une **circonference en diametre** ;
- faire la **moyenne** de plusieurs mesures.

EarthCoach n'invente jamais les mesures d'entree : si une donnee terrain manque, il vous la demande ou la laisse a completer. Le resultat depend toujours de la qualite de vos mesures.

Exemples :

```text
@EarthCoach la roche de reference fait 2 m et son ombre 1,5 m, l ombre de la falaise fait 9 m, quelle hauteur ?
@EarthCoach quelle distance entre N 48 00.000 E 002 00.000 et le waypoint d observation ?
```

## References externes

L'action **Illustrer un terme** et le tool IA `earthcoach_search_reference` peuvent chercher des references pedagogiques externes.

Les sources disponibles sont :

- Wikipedia ;
- Wikimedia Commons ;
- BRGM ;
- InfoTerre BRGM, pour les cartes geologiques, notices explicatives, rapports et donnees de sous-sol ;
- GeoWiki ;
- Planet-Terre ENS Lyon.

Les resultats sont marques comme `educational_reference`. Ils servent a comprendre un concept, pas a prouver ce que vous avez vu sur place.

Pour les sources BRGM, InfoTerre, GeoWiki et Planet-Terre, EarthCoach peut afficher un portail de recherche fiable plutot qu'un article unique. C'est volontaire : ces sites sont plus utiles quand vous croisez le terme geologique avec le lieu, la carte ou la notice concernee.

## Mode terrain compact

Le **Mode terrain compact** ouvre une vue EarthCoach separee du chat. Elle genere immediatement une checklist pratique pour la visite.

La checklist contient :

- les informations de la cache ;
- les points a observer ;
- les mesures ou estimations utiles ;
- les photos a prendre ;
- les questions du listing detectees ;
- les waypoints et reperes ;
- les rappels de prudence.

La vue propose deux actions :

| Action | Effet |
|---|---|
| **Copier Markdown** | Copie la checklist avec cases a cocher dans le presse-papiers. |
| **Imprimer** | Lance l'impression de la checklist. |

Ce mode ne remplace pas EarthCoach dans le chat. Il sert surtout avant ou pendant la visite, quand vous voulez une fiche courte a garder sous les yeux.

## Observations terrain

L'action **Observations terrain** ouvre une vue EarthCoach separee du chat pour enregistrer les donnees de terrain de facon structuree.

Chaque observation peut contenir :

- un type : observation, hypothese ou interpretation ;
- une date terrain ;
- un waypoint ;
- des coordonnees texte ou decimales ;
- une ou plusieurs photos liees.

Vous pouvez aussi importer une photo depuis cette vue. GeoApp l'ajoute aux images de la cache, puis EarthCoach la lie automatiquement au brouillon en cours.

Ces observations sont ensuite reprises par EarthCoach dans les actions **Analyser mes observations** et **Resoudre avec mes observations**. Si aucune observation structuree n'existe encore, EarthCoach garde le fallback historique vers les notes utilisateur.

### Cache local des recherches

EarthCoach garde un cache local en memoire pour eviter de refaire les memes recherches pendant la session. Une recherche comme `basalte` ou `calcaire coquillier` peut donc etre servie depuis le cache si elle a deja ete faite avec les memes parametres.

## Preferences EarthCoach

Les reglages se trouvent dans **Preferences GeoApp > EarthCoach**.

| Preference | Effet |
|---|---|
| **EarthCoach - Verbosite des reponses** | Regle la longueur des premiers comptes rendus : `compact`, `normal` ou `detailed`. Le mode `compact` privilegie un resume rapide du listing. |
| **EarthCoach - Recherches externes** | Active ou desactive les appels Wikipedia/Wikimedia. |
| **EarthCoach - Langue des references** | Choisit `fr` ou `en` par defaut. |
| **EarthCoach - Articles maximum** | Limite le nombre d'articles Wikipedia retournes. |
| **EarthCoach - Images maximum** | Limite le nombre d'images pedagogiques retournees. |
| **EarthCoach - Sources autorisees** | Liste CSV des sources autorisees. Valeurs : `wikipedia,wikimedia,brgm,infoterre,geowiki,planet-terre`. |

Depuis la vue **References EarthCoach**, le bouton **Preferences** ouvre directement la section EarthCoach.

Vous pouvez aussi demander a `@Aide` :

```text
@Aide ouvre les preferences EarthCoach
@Aide liste les preferences de la categorie earthcoach
@Aide desactive les recherches externes EarthCoach
@Aide regle EarthCoach en reponses compactes
```

## Notes GeoApp

EarthCoach peut enregistrer une synthese dans les notes GeoApp avec le tool `earthcoach_save_note`, uniquement si vous le demandez explicitement.

Exemples :

```text
@EarthCoach enregistre cette checklist dans les notes
@EarthCoach sauvegarde cette synthese EarthCoach sur la cache
```

La note est marquee :

- source : `earthcoach` ;
- type : `system` ;
- prefixe : `[EarthCoach]`.

Dans la liste des notes, elle apparait avec un badge **EarthCoach**. Elle n'est pas traitee comme une note utilisateur synchronisable vers Geocaching.com.

## Exemples d'utilisation

### Comprendre une EarthCache

```text
@EarthCoach aide-moi a comprendre cette EarthCache
```

EarthCoach explique les notions, repere les questions importantes et indique ce qu'il faudra verifier sur place.

### Preparer le terrain

```text
@EarthCoach prepare ma visite et fais une checklist courte
```

EarthCoach peut proposer des rubriques comme :

- a observer ;
- a mesurer ;
- a photographier ;
- a noter ;
- questions a garder ouvertes.

### Illustrer un terme

```text
@EarthCoach illustre "calcaire coquillier"
```

EarthCoach peut utiliser les references externes et afficher des images pedagogiques. Il doit rappeler que ces images sont generiques.

### Resoudre avec vos observations

```text
@EarthCoach passe en mode resolution avec mes observations
```

Le mode `resolver` peut aider a formuler une reponse candidate, mais il doit laisser les informations absentes sous forme de points a completer.

## Bonnes pratiques

- Ajoutez vos observations structurees quand elles sont disponibles, ou au minimum vos observations dans les notes de la cache avant de lancer le mode `resolver`.
- Demandez toujours a EarthCoach de distinguer observation, interpretation et hypothese.
- Pour les images, verifiez toujours l'origine : listing, observation utilisateur ou reference pedagogique.
- Gardez les recherches externes comme aide de comprehension, pas comme preuve terrain.
- Enregistrez dans les notes uniquement les syntheses que vous voulez garder.

## Limites actuelles

EarthCoach sait lire les observations structurees GeoApp avec type observation / hypothese / interpretation, date, waypoint, coordonnees et photos liees. Si aucune observation structuree n'existe encore, il utilise les notes utilisateur comme fallback textuel.

Les sources BRGM, InfoTerre, GeoWiki et Planet-Terre sont exposees comme portails fiables. Une integration plus profonde, capable de retrouver automatiquement une notice de carte geologique precise depuis une position ou un numero de carte, reste prevue pour une version ulterieure.
