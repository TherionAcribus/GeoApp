---
title: "Comprendre le Chat IA GeoApp"
description: "Fonctionnement du Chat IA GeoApp, profils, tools, skills, confirmations et réglages utiles."
order: 20
tags: [IA, chat, GeoApp, tools, skills, profils, geocaching]
---

# Comprendre le Chat IA GeoApp

Le Chat IA GeoApp est l'assistant intégré à l'application pour vous aider à résoudre des géocaches. Il peut lire le contexte de la cache ouverte, proposer une stratégie, utiliser certains outils GeoApp, analyser des formules, lancer des plugins, vérifier des coordonnées ou vous guider dans une énigme.

Il ne remplace pas votre vérification : l'IA peut se tromper, mal interpréter un indice ou proposer une hypothèse fragile. GeoApp distingue donc les réponses simples, les hypothèses, les résultats obtenus par outil, et les actions qui demandent confirmation.

## Où trouver les réglages

Les réglages principaux se trouvent dans **Préférences GeoApp** puis **Chat IA GeoApp**.

Dans cette section, vous pouvez régler :

- le profil de modèle utilisé par défaut ;
- les profils de modèle selon le type de résolution ;
- le comportement du chat ;
- le pack de prompt ;
- le pack de skills ;
- la sauvegarde automatique des coordonnées trouvées ;
- les tools autorisés, bloqués ou soumis à confirmation.

La section **Chat IA GeoApp** contient aussi deux boutons importants :

| Bouton | Rôle |
|---|---|
| **Policy tools** | Ouvre la vue détaillée qui montre la policy effective, les tools, les skills, les diagnostics et le prompt final. |
| **Configurer IA Theia** | Ouvre la configuration IA native de Theia : modèles, fournisseurs, agents, tools et confirmations globales. |

Vous pouvez aussi ouvrir la vue **Policy Chat IA GeoApp** depuis les menus GeoApp ou depuis la palette de commandes.

## Ce que le Chat IA peut faire

Selon les réglages actifs, le Chat IA peut notamment :

- analyser le texte d'une géocache ;
- repérer des formules et des variables ;
- chercher des questions associées aux variables ;
- calculer une coordonnée finale ;
- tester une projection ou une intersection de coordonnées ;
- lancer des plugins GeoApp ou le metasolver ;
- exploiter du contenu caché dans le HTML, le CSS ou le texte ;
- analyser des énigmes image, OCR ou QR code si les outils correspondants sont disponibles ;
- vérifier une coordonnée candidate avec un checker quand un checker est connu ;
- afficher temporairement une coordonnée sur la carte ;
- enregistrer une coordonnée trouvée, si vous le demandez ou si votre configuration l'autorise.

Les outils disponibles changent selon le workflow, le profil comportemental, les préférences utilisateur, les skills actives et les confirmations Theia.

## Les concepts importants

### Profil de modèle

Le profil de modèle choisit quel type de modèle IA est utilisé. Il répond à la question : **quelle IA va réfléchir ?**

| Profil | Usage conseillé |
|---|---|
| `local` | Modèle local, utile pour limiter l'envoi de données à un service en ligne. |
| `fast` | Modèle rapide pour les questions simples et les analyses courantes. |
| `strong` | Modèle plus puissant pour les énigmes complexes, les formules et les raisonnements longs. |
| `web` | Modèle prévu pour les cas où un accès en ligne peut être utile selon la configuration. |

Vous pouvez définir un profil par défaut, puis des profils particuliers pour les workflows : codes secrets, formules, checkers, contenu caché et images/OCR.

### Profil comportemental

Le profil comportemental choisit la façon dont le Chat IA agit. Il répond à la question : **jusqu'où l'IA peut aller automatiquement ?**

| Profil | Comportement |
|---|---|
| `guided` | Profil recommandé. L'IA aide activement, mais reste prudente sur les actions sensibles. |
| `safe` | Plus conservateur. Idéal si vous voulez davantage de confirmations et moins d'automatisation. |
| `offline` | Limite les actions réseau. Utile pour travailler localement ou réduire les échanges externes. |
| `automation` | Plus proche du comportement automatique historique. Pratique pour aller vite. |
| `debug` | Affiche et expose davantage d'éléments pour comprendre ce qui se passe. |

Le comportement par défaut est `guided`. Vous pouvez aussi choisir un comportement spécifique par workflow.

### Pack de prompt

Le pack de prompt définit les consignes données à l'IA : manière de raisonner, prudence, gestion des coordonnées, utilisation des checkers, priorité aux outils, etc.

Les packs disponibles suivent les mêmes noms que les profils comportementaux : `guided`, `safe`, `offline`, `automation`, `debug`.

Dans la plupart des cas, gardez le pack de prompt aligné avec le profil comportemental. Par exemple : comportement `guided` avec prompt pack `guided`.

### Tools

Un tool est une capacité que l'IA peut demander à GeoApp d'exécuter. Par exemple : calculer une coordonnée, lancer un metasolver, vérifier un checker ou afficher un point sur la carte.

Chaque tool peut avoir un statut :

| Statut | Signification |
|---|---|
| **Actif** | L'IA peut voir le tool et demander son exécution. |
| **Confirmation** | L'IA peut demander le tool, mais GeoApp/Theia demande validation avant exécution. |
| **Bloqué** | Le tool n'est pas exposé à l'IA pour cette requête. |

Les tools sont classés par catégorie : workflow, metasolver, formules, coordonnées, checkers, image/OCR, web, plugins dynamiques et debug.

### Risques des tools

Certains tools sont sans danger particulier : ils lisent ou calculent seulement. D'autres peuvent avoir un impact plus important.

| Risque | Exemple |
|---|---|
| lecture | Analyser un texte, détecter une formule, calculer une valeur. |
| écriture locale | Ajouter ou sauvegarder une coordonnée dans GeoApp. |
| réseau | Chercher une information en ligne ou appeler un checker. |
| auth | Utiliser une session connectée, par exemple pour certains checkers. |
| élevé | Exécuter une étape pouvant combiner réseau, plugins ou écriture locale. |

Les tools sensibles peuvent être bloqués ou placés en confirmation.

### Skills

Une skill est une stratégie spécialisée que le Chat IA peut charger. Elle explique à l'IA comment aborder un type de problème.

GeoApp fournit actuellement ces skills :

| Skill | Utilité |
|---|---|
| `geoapp-formula` | Formules, variables, questions, calcul de finale. |
| `geoapp-checkers` | Utilisation prudente des checkers connus. |
| `geoapp-image-puzzle` | Images, OCR, QR codes et indices visuels. |
| `geoapp-secret-code` | Codes secrets, metasolver, contenu caché. |
| `geoapp-coordinates` | Coordonnées candidates, projections, intersections, affichage et sauvegarde. |

Les skills n'exécutent rien toutes seules. Elles guident l'IA et l'aident à choisir les bons outils.

### Pack de skills

Le pack de skills décide quelles skills sont chargées.

| Pack | Comportement |
|---|---|
| `workflow` | Recommandé. GeoApp choisit les skills adaptées au workflow courant. |
| `minimal` | Charge seulement le strict nécessaire. |
| `full` | Charge toutes les skills GeoApp. |
| `disabled` | Désactive les skills, sauf si vous forcez une skill individuellement. |

Le pack recommandé est `workflow`.

### Workflow et session

Un workflow représente le type de problème que GeoApp pense traiter :

- général ;
- codes secrets ;
- formules ;
- checkers ;
- contenu caché ;
- images / OCR.

La session peut être :

| Session | Signification |
|---|---|
| `auto` | Session lancée depuis un contexte GeoApp, par exemple une géocache ouverte. |
| `libre` | Discussion plus générale, moins attachée à une résolution précise. |

Le workflow et la session influencent les tools, les skills et le comportement effectif du Chat IA.

## La vue Policy Chat IA GeoApp

La vue **Policy Chat IA GeoApp** sert à comprendre exactement ce que l'IA peut utiliser.

Elle affiche :

- le workflow de preview ;
- le type de session ;
- le profil comportemental appliqué ;
- le prompt pack ;
- le skill pack ;
- le nombre de tools actifs, bloqués ou soumis à confirmation ;
- les diagnostics runtime ;
- l'aperçu du prompt final envoyé au modèle ;
- les skills actives et leur état ;
- la matrice filtrable des tools ;
- les overrides manuels.

Cette vue est utile quand vous vous demandez : "Pourquoi l'IA n'a pas utilisé ce checker ?", "Pourquoi ce tool demande confirmation ?" ou "Pourquoi une skill n'est pas disponible ?"

### Tester une policy

En haut de la vue, vous pouvez changer :

- **Workflow** : simule une résolution de type formule, checker, image/OCR, etc.
- **Session** : compare `auto` et `libre`.
- **Profil preview** : teste un comportement sans forcément changer toutes les préférences.
- **Skill pack** : change le pack de skills actif.

La vue se met à jour pour montrer la policy effective.

## Diagnostic runtime

Le bloc **Diagnostic runtime** signale les problèmes qui peuvent expliquer un comportement inattendu du chat.

Il peut par exemple indiquer :

- qu'un tool GeoApp attendu n'est pas enregistré dans Theia ;
- que `getSkillFileContent` n'est pas disponible ;
- qu'une skill GeoApp active n'a pas encore été découverte par Theia ;
- qu'une skill recommande un tool absent ;
- qu'une skill recommande un tool bloqué par la policy.

Ces messages ne signifient pas toujours qu'il y a une erreur grave. Ils servent surtout à comprendre ce que le modèle voit réellement.

## Aperçu du prompt final

La vue **Policy Chat IA GeoApp** contient aussi un **Aperçu du prompt final**.

Cet aperçu montre :

- le variant de prompt utilisé ;
- si le prompt est la version GeoApp par défaut ou une version personnalisée ;
- le prompt système résolu par Theia ;
- la policy injectée dans le prompt ;
- les tools référencés directement par le prompt.

C'est l'endroit le plus utile pour vérifier ce que l'IA reçoit vraiment comme consignes avant de répondre.

## Matrice des tools

La matrice des tools affiche les outils GeoApp visibles par la policy courante.

Vous pouvez filtrer la matrice par :

- recherche texte : nom, registry ID, description ou skill ;
- statut : actifs, confirmation, bloqués ;
- risque : lecture, écriture locale, réseau, auth, élevé ;
- catégorie : workflow, metasolver, formules, coordonnées, checkers, image/OCR, web, plugins ;
- recommandation de skill.

Le compteur indique combien de tools sont affichés par rapport au total.

### Recommandations skill/tool

La colonne **Skills** montre quelles skills actives recommandent un tool.

Si vous voyez **Skill recommande, tool bloqué**, cela veut dire :

- une skill active sait que ce tool serait utile ;
- mais la policy actuelle ne l'expose pas à l'IA ;
- l'IA devra donc proposer une étape manuelle ou utiliser une autre stratégie.

Vous pouvez corriger cela en changeant le profil comportemental, le workflow, ou l'override du tool.

### Changer le statut d'un tool

Dans la matrice, chaque tool possède un champ **Override** :

| Valeur | Effet |
|---|---|
| `default` | Utilise la règle normale du profil. |
| `enabled` | Force l'activation du tool. |
| `disabled` | Bloque le tool. |
| `confirm` | Autorise le tool, mais demande confirmation. |

Pour un usage quotidien, évitez de tout mettre en `enabled`. Le mode `default` permet à GeoApp d'adapter les tools au contexte.

## État des skills GeoApp

La table des skills affiche maintenant l'état de chaque skill GeoApp.

| État | Signification |
|---|---|
| **GeoApp** | La skill active correspond à la version intégrée de GeoApp. |
| **Personnalisée** | La skill a été modifiée par l'utilisateur. GeoApp ne l'écrase pas automatiquement. |
| **À mettre à jour** | La skill est une ancienne version GeoApp. |
| **Absente** | Le fichier de skill n'existe pas dans le dossier de configuration. |
| **Non découverte** | Le fichier existe, mais Theia ne l'a pas encore chargé. |
| **Illisible** | Theia connaît la skill, mais GeoApp ne peut pas lire son fichier. |

La table affiche aussi le chemin du fichier actif quand il est connu.

### Restaurer une skill GeoApp

Le bouton **Restaurer GeoApp** remplace la skill par la version GeoApp intégrée.

Si la skill est personnalisée, GeoApp demande confirmation avant de remplacer le fichier. Cela évite d'écraser silencieusement vos modifications.

Après restauration, GeoApp demande à Theia de rafraîchir les skills. Si la skill reste affichée comme **Non découverte**, redémarrez GeoApp ou relancez le chargement des skills côté Theia.

### Changer le statut d'une skill

Chaque skill peut aussi être forcée :

| Valeur | Effet |
|---|---|
| `default` | Utilise le pack de skills actif. |
| `enabled` | Force la skill active. |
| `disabled` | Désactive la skill. |

## Configurations recommandées

| Besoin | Réglage conseillé |
|---|---|
| Utilisation normale | Modèle `fast` ou `strong`, comportement `guided`, prompt pack `guided`, skill pack `workflow`. |
| Énigme complexe | Modèle `strong`, comportement `guided`, skill pack `workflow` ou `full`. |
| Travail prudent | Comportement `safe`, tools réseau ou écriture en confirmation. |
| Travail local | Modèle `local`, comportement `offline`, vérifier que les tools réseau sont bloqués. |
| Résolution rapide | Comportement `automation`, en gardant les actions sensibles en confirmation. |
| Comprendre un problème de configuration | Comportement `debug`, vue **Policy Chat IA GeoApp** ouverte. |

## Coordonnées trouvées

Le Chat IA peut repérer des coordonnées candidates et vous aider à les utiliser.

Selon la configuration, il peut :

- les afficher temporairement sur la carte ;
- les enregistrer comme waypoint ;
- les enregistrer comme coordonnées corrigées ;
- les ajouter en note.

Le réglage **Chat IA - Sauvegarde auto des coordonnées** contrôle l'automatisation :

| Valeur | Effet |
|---|---|
| `manual` | Rien n'est enregistré sans demande explicite. |
| `confident` | GeoApp peut enregistrer automatiquement si le résultat est suffisamment confiant. |

Le seuil de confiance est réglé par **Chat IA - Seuil confiance coordonnées**.

## Checkers et validation

Le Chat IA peut utiliser un checker seulement si GeoApp connaît le checker ou si le contexte fournit une URL exploitable. Il ne doit pas inventer une URL de checker.

Quand un checker est disponible, l'IA peut :

- tester une coordonnée candidate ;
- vous indiquer le verdict ;
- signaler un problème de format ;
- demander une connexion si le checker exige une session authentifiée.

Si le tool checker est bloqué, l'IA peut vous expliquer quoi vérifier, mais elle ne doit pas prétendre avoir testé la coordonnée.

## Confidentialité et données

GeoApp fonctionne localement sur votre PC, mais le Chat IA peut utiliser un modèle local ou un fournisseur en ligne selon votre configuration.

Retenez ces principes :

- avec un modèle `local`, le raisonnement peut rester sur votre machine si votre fournisseur local est correctement configuré ;
- avec un modèle cloud, le texte envoyé au chat peut être transmis au fournisseur IA choisi ;
- les tools réseau peuvent appeler des services externes, par exemple une recherche web ou un checker ;
- les tools d'authentification peuvent utiliser une session connectée ;
- les tools d'écriture locale peuvent modifier vos données GeoApp.

Pour réduire les échanges externes, utilisez le profil comportemental `offline`, un modèle `local`, et vérifiez dans **Policy Chat IA GeoApp** que les tools réseau sont bloqués.

## Importer, exporter et réinitialiser

Dans **Policy Chat IA GeoApp**, vous pouvez :

- **Exporter** la configuration Chat IA GeoApp au format JSON ;
- **Importer** une configuration JSON ;
- **Réinitialiser** les réglages de policy aux valeurs par défaut ;
- ouvrir **Configurer IA Theia** pour les réglages IA natifs de Theia.

L'export est pratique pour partager une configuration entre plusieurs installations locales ou revenir à un profil connu.

## Conseils d'utilisation

- Demandez à l'IA d'expliquer quelles données sont certaines et quelles données sont des hypothèses.
- Pour une finale, demandez toujours la chaîne de raisonnement utile : variables, valeurs, formule, coordonnée candidate.
- Pour les checkers, vérifiez que le verdict vient bien d'un appel tool dans la conversation.
- Si vous travaillez sur une cache sensible ou privée, préférez `local` + `offline`.
- Gardez `guided` comme base si vous ne savez pas quel profil choisir.
- Utilisez la vue **Policy Chat IA GeoApp** quand un comportement vous surprend.
- Consultez le diagnostic runtime quand une skill ou un tool semble absent.
- Utilisez les filtres de matrice pour vérifier rapidement ce qui est bloqué ou soumis à confirmation.

## Dépannage rapide

### L'IA ne voit pas un tool

Ouvrez **Policy Chat IA GeoApp**, choisissez le workflow correspondant, puis vérifiez si le tool est **Actif**, **Confirmation** ou **Bloqué**.

Si le tool est bloqué, regardez son override, le profil comportemental actif et la colonne **Skills**.

### Une skill recommande un tool bloqué

Cela signifie que la stratégie sait utiliser ce tool, mais que votre policy actuelle l'interdit.

Vous pouvez :

- passer le tool en `confirm` ;
- passer le tool en `enabled` ;
- choisir un profil comportemental moins restrictif ;
- garder le blocage et suivre une étape manuelle.

### L'IA demande une confirmation

C'est normal pour les actions sensibles : réseau, authentification, écriture locale ou exécution plus large. Vous pouvez laisser la confirmation, ou passer le tool en `enabled` si vous acceptez ce niveau d'automatisation.

### L'IA n'utilise pas un checker

Vérifiez que :

- la cache contient un checker connu ou une URL de checker ;
- les tools de catégorie **Checkers** sont actifs ;
- le workflow de la session est bien `checker`, `formula` ou `secret_code` ;
- une connexion n'est pas nécessaire ;
- le diagnostic runtime ne signale pas un tool checker absent.

### L'IA n'utilise pas la bonne stratégie

Vérifiez le workflow, le pack de skills et les skills actives. Pour une énigme à formule, la skill `geoapp-formula` doit être active. Pour une image, la skill `geoapp-image-puzzle` est souvent utile.

### Une skill est marquée personnalisée

Cela veut dire que son fichier ne correspond pas à la version GeoApp intégrée. Si c'est volontaire, gardez-la ainsi. Si vous voulez revenir à la version officielle, cliquez sur **Restaurer GeoApp**.

### Une skill est non découverte

Le fichier existe, mais Theia ne l'a pas encore chargé. Essayez de rafraîchir les skills ou de redémarrer GeoApp.

### Je veux revenir à une configuration simple

Dans **Policy Chat IA GeoApp**, cliquez sur **Réinitialiser**. La configuration revient vers le profil recommandé : comportement `guided`, prompt pack `guided`, skill pack `workflow`.

## Glossaire

| Terme | Définition |
|---|---|
| Agent | Assistant IA disponible dans le chat Theia. |
| Profil de modèle | Choix du type de modèle IA : `local`, `fast`, `strong`, `web`. |
| Profil comportemental | Règle la prudence et l'automatisation du Chat IA. |
| Prompt pack | Ensemble de consignes données à l'IA. |
| Prompt final | Prompt système résolu, complété par la policy effective. |
| Tool | Action que l'IA peut demander à GeoApp d'exécuter. |
| Skill | Stratégie spécialisée chargée pour un type de problème. |
| Policy | Résultat final des réglages : tools exposés, confirmations, skills actives et comportement appliqué. |
| Workflow | Type de résolution en cours : formule, checker, image, contenu caché, code secret ou général. |
