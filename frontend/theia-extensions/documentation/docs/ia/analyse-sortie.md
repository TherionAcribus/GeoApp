---
title: "Analyser une sortie avec l'IA"
description: "Préparer une sortie géocaching : checklist matériel, temps à prévoir, alertes et priorisation, à partir d'une sélection de géocaches."
order: 28
tags: [IA, sortie, matériel, préparation, logs, attributs, geocaching]
---

# Analyser une sortie avec l'IA

Vous avez repéré les géocaches du jour et vous voulez savoir quoi mettre dans le sac ?
L'analyse de sortie envoie le lot à l'IA et vous rend un rapport : ce qu'il faut emporter,
ce qui va prendre du temps, ce qui risque de mal tourner.

## Où cliquer

| Depuis | Bouton | Ce qui est analysé |
|---|---|---|
| Le tableau des géocaches d'une zone | **🧠 Analyser IA** dans la barre d'actions | Les géocaches cochées |
| L'éditeur de logs | **🧠 Analyser la sortie** en haut à droite | **Toute** la liste à loguer |

Le second est le plus direct pour une sortie du jour : la liste des caches à loguer est
déjà votre sortie.

GeoApp vous demande ensuite **quand vous partez** — aujourd'hui, demain, après-demain, ou
une date saisie au format `AAAA-MM-JJ`. Ce n'est pas une formalité : c'est de cette date
que dépend l'heure du coucher du soleil, donc le nombre de caches qui tiennent dans la
journée. Une sortie préparée le mercredi pour le samedi n'a pas la même lumière.

Puis un **niveau de détail** :

| Niveau | Ce qui est envoyé | Quand l'utiliser |
|---|---|---|
| **Standard** | Extrait de listing, 5 logs récents | Le bon compromis, à garder par défaut |
| **Léger** | Pas de listing : attributs, hint et logs seulement | Grosse sélection, ou réponse rapide |
| **Complet** | Listing long, 10 logs récents | Peu de caches, mais des listings touffus |

Le rapport arrive dans le Chat IA, dans une conversation intitulée
`SORTIE - <zone> - <date de sortie>`. Vous pouvez y rebondir librement : « et si je n'ai
pas de lampe UV ? », « inverse l'ordre de visite », « lesquelles sont faisables avec des
enfants ? ».

Relancer une analyse sur la même zone pour la même date de sortie reprend la même
conversation, même préparée un autre jour.

## Ce que contient le rapport

1. **Checklist matériel** — l'union de tout ce qu'il faut emporter, groupée par niveau de
   certitude, avec les codes GC concernés. C'est la section à relire devant le sac.
2. **Alertes** — mystery non résolues, caches en mauvaise santé, contraintes horaires ou
   saisonnières, autorisations, risques.
3. **Détail par cache** — matériel, temps à prévoir, points d'attention.
4. **Temps et priorisation** — ce qui va être long, et ce qu'on garde si le temps manque.
5. **À vérifier avant de partir** — ce qui reste à lever en amont.

## Comment GeoApp trouve le matériel

C'est le point le plus utile à comprendre, parce qu'il explique la forme des réponses.

Les attributs Geocaching.com ne suffisent pas. L'attribut « Outil spécial requis » vous
dit qu'il faut un outil, jamais **lequel** : canne à pêche, aimant, crochet, de quoi
crocheter une serrure ? De même, « matériel d'escalade » ne distingue pas une échelle
d'un baudrier ou de matériel arboricole — ce ne sont pas les mêmes sorties.

GeoApp lit donc aussi le **listing**, le **hint** et surtout les **logs**. Et pas seulement
les logs récents : il cherche dans tout l'historique local les logs qui parlent de
matériel. C'est souvent un log de plusieurs années en arrière qui dit « prévoir une canne
à pêche », et il ne serait jamais remonté autrement.

Le rapport classe chaque outil en trois niveaux :

- **Confirmé** — l'objet est nommé dans le texte, avec sa source (« canne à pêche — log de
  *Toto*, 12/04/2023 »).
- **Probable** — déduit d'un faisceau d'indices (terrain 5 + « en hauteur » + attribut
  grimpe).
- **Non identifié** — l'attribut signale un besoin, les textes sont muets. L'IA vous le
  dit franchement et recommande d'emporter la trousse polyvalente.

Ce dernier cas n'est pas un échec : savoir qu'il faut un outil sans savoir lequel reste
utile pour faire son sac.

## Distances, ordre de visite et coucher du soleil

GeoApp calcule la géographie de la sortie avant de la transmettre à l'IA :

- **l'étendue** de la zone — utile pour savoir d'emblée si tout tient dans un village ou
  s'il faudra reprendre la voiture ;
- un **ordre de visite** qui passe une fois par chaque cache en limitant les allers-retours.
  C'est une proposition, pas un itinéraire : l'IA la réorganise dès qu'une contrainte le
  demande (cache de nuit, commerce fermé le midi, marée), et vous pouvez lui demander autre
  chose ;
- les **groupes à faire à pied** : les caches distantes de moins de 400 mètres, qui
  s'enchaînent depuis un même stationnement ;
- l'**heure du coucher du soleil** à la date de votre sortie, avec la fin du crépuscule
  civil — le moment où l'on ne cherche plus rien sans lampe — et la durée du jour.

Deux points à connaître :

- **toutes les distances sont à vol d'oiseau.** GeoApp ne connaît ni les routes, ni les
  sentiers, ni le dénivelé : le trajet réel est toujours plus long. L'IA a pour consigne de
  ne jamais les présenter comme des distances de marche ;
- **les mystery non résolues sont exclues du calcul**, comme les caches sans coordonnées en
  base. Leurs coordonnées publiées sont un leurre, parfois à plusieurs kilomètres du vrai
  final : les inclure fausserait tout le reste. Elles sont listées à part, et le rapport dit
  pourquoi elles n'apparaissent pas dans l'ordre de visite.

## Santé des caches

GeoApp calcule lui-même l'état de chaque cache à partir des logs déjà téléchargés :
nombre de DNF consécutifs, ancienneté de la dernière trouvaille, demande de maintenance
restée sans réponse, cache désactivée ou archivée. L'IA reçoit ce diagnostic comme un
fait, elle ne l'invente pas.

## Si des caches n'ont pas de logs

Les logs ne sont en base que si la géocache a été **rafraîchie** au moins une fois. Sans
log local, GeoApp ne dit pas que la cache va bien : il dit qu'il ne sait pas.

Ces caches sont signalées à deux endroits — une notification après l'analyse, et une
section « Fiabilité des données » en tête du rapport. L'IA a pour consigne de ne rien en
conclure.

GeoApp ne lance **aucun** rafraîchissement automatique : c'est long et cela sollicite
Geocaching.com. Si ces caches vous importent, rafraîchissez-les avant de relancer
l'analyse.

## Limites à garder en tête

- L'IA lit ce qu'on lui donne. Un listing qui ne mentionne pas le matériel, des logs
  avares en détails, et elle n'aura rien de plus que vous.
- Les durées et les priorités sont des estimations, pas des mesures.
- Une mystery non résolue est signalée comme bloquante : sans coordonnées corrigées, s'y
  déplacer ne sert à rien.
- L'analyse est limitée à 60 géocaches. Au-delà de 25, GeoApp vous prévient du volume :
  la réponse sera longue et coûteuse. Le mode « Léger » aide.

## Choisir le modèle

L'analyse de sortie utilise un agent dédié, **GeoApp Analyse de sortie**. Vous pouvez lui
assigner un modèle précis dans la configuration IA de Theia, indépendamment du chat de
résolution d'énigmes — une synthèse de texte n'a pas les mêmes besoins qu'un raisonnement
sur une énigme.

La vue **Policy Chat IA GeoApp** affiche le modèle effectivement utilisé, sur la ligne
« Analyse de sortie ».

Quatre réglages sont disponibles dans les Paramètres (cherchez `geoApp.outing`) :

| Réglage | Défaut | Rôle |
|---|---|---|
| `detailLevel` | `standard` | Niveau proposé en premier |
| `recentLogsCount` | `5` | Logs récents envoyés par cache |
| `gearLogsCount` | `8` | Logs « matériel » envoyés par cache |
| `warnAboveCount` | `25` | Seuil d'avertissement sur le volume |
