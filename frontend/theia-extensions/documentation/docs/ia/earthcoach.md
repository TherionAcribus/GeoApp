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

## References externes

L'action **Illustrer un terme** et le tool IA `earthcoach_search_reference` peuvent chercher des references pedagogiques externes.

En v1, les sources disponibles sont :

- Wikipedia ;
- Wikimedia Commons.

Les resultats sont marques comme `educational_reference`. Ils servent a comprendre un concept, pas a prouver ce que vous avez vu sur place.

### Cache local des recherches

EarthCoach garde un cache local en memoire pour eviter de refaire les memes recherches pendant la session. Une recherche comme `basalte` ou `calcaire coquillier` peut donc etre servie depuis le cache si elle a deja ete faite avec les memes parametres.

## Preferences EarthCoach

Les reglages se trouvent dans **Preferences GeoApp > EarthCoach**.

| Preference | Effet |
|---|---|
| **EarthCoach - Recherches externes** | Active ou desactive les appels Wikipedia/Wikimedia. |
| **EarthCoach - Langue des references** | Choisit `fr` ou `en` par defaut. |
| **EarthCoach - Articles maximum** | Limite le nombre d'articles retournes. |
| **EarthCoach - Images maximum** | Limite le nombre d'images pedagogiques retournees. |
| **EarthCoach - Sources autorisees** | Liste CSV des sources autorisees. Valeurs v1 : `wikipedia,wikimedia`. |

Depuis la vue **References EarthCoach**, le bouton **Preferences** ouvre directement la section EarthCoach.

Vous pouvez aussi demander a `@Aide` :

```text
@Aide ouvre les preferences EarthCoach
@Aide liste les preferences de la categorie earthcoach
@Aide desactive les recherches externes EarthCoach
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

- Ajoutez vos observations dans les notes de la cache avant de lancer le mode `resolver`.
- Demandez toujours a EarthCoach de distinguer observation, interpretation et hypothese.
- Pour les images, verifiez toujours l'origine : listing, observation utilisateur ou reference pedagogique.
- Gardez les recherches externes comme aide de comprehension, pas comme preuve terrain.
- Enregistrez dans les notes uniquement les syntheses que vous voulez garder.

## Limites actuelles

La v1 utilise les notes existantes comme observations textuelles. Les vraies observations structurees avec photos, date, waypoint et coordonnees sont prevues pour une version ulterieure.

Les sources externes serieuses comme BRGM, notices de cartes geologiques, universites ou GeoWiki pourront etre ajoutees dans une version suivante.
