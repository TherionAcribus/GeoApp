---
title: "Configurer l'IA"
description: "Activer l'intelligence artificielle de GeoApp en deux minutes avec l'assistant : choisir un fournisseur, saisir sa clé, choisir un modèle."
chapter: getting-started
order: 27
tags: [IA, configuration, assistant, premier démarrage, clé API, fournisseur, OpenRouter, Anthropic, OpenAI, Google, Ollama, LM Studio, modèle, Aide]
---

# Configurer l'IA

GeoApp s'appuie sur un modèle de langage pour l'assistant `@Aide`, le chat des géocaches, EarthCoach, les traductions ou l'analyse des logs. Tant qu'aucun modèle n'est branché, ces fonctions ne répondent pas.

L'assistant **Configurer l'IA** fait ce branchement en trois étapes. Une fois terminé, **tous** les assistants de GeoApp utilisent le modèle choisi, et `@Aide` peut faire le reste des réglages à votre place.

## Ouvrir l'assistant

- depuis la **page d'accueil** : bandeau « L'IA n'est pas encore configurée », ou carte **Configurer l'IA** ;
- depuis la **barre d'état**, en bas : « IA à configurer » (affiché tant que l'IA n'est pas prête) ;
- palette de commandes (`Ctrl+Shift+P`) → **GeoApp : Configurer l'IA** ;
- **Préférences GeoApp** → catégorie **IA** → **Assistant de configuration de l'IA**.

## Étape 1 — Choisir un fournisseur

| Fournisseur | Pour qui |
|---|---|
| **OpenRouter** (recommandé) | Une seule clé donne accès aux modèles de tous les éditeurs. Paiement à l'usage. |
| **Anthropic** | Vous avez une clé Anthropic (modèles Claude). |
| **OpenAI** | Vous avez une clé OpenAI (modèles GPT). |
| **Google** | Vous avez une clé Google AI (modèles Gemini). |
| **Ollama** | Modèles installés sur votre ordinateur. Gratuit, fonctionne hors ligne. |
| **LM Studio** | Modèles chargés dans LM Studio sur votre ordinateur. Gratuit, fonctionne hors ligne. |

Ollama et LM Studio sont détectés automatiquement s'ils sont lancés.

## Étape 2 — Connexion et modèle

**Fournisseur en ligne.** Collez votre clé API (un lien mène à la page où la créer), puis cliquez sur **Vérifier la clé**. Choisissez ensuite le modèle dans la liste, ou tapez son nom.

**Fournisseur local.** Vérifiez l'adresse proposée, cliquez sur **Rechercher les modèles**, puis choisissez le modèle.

Pour OpenRouter, Ollama et LM Studio, aucun modèle n'est présélectionné : indiquez celui que vous voulez utiliser, tel qu'il est nommé chez le fournisseur (par exemple `éditeur/modèle` pour OpenRouter).

> **Modèles locaux :** `@Aide` s'appuie sur de très nombreux outils. Un petit modèle local peut répondre mais mal piloter l'application. Préférez un modèle annoncé compatible avec les appels d'outils.

> **Confidentialité :** la clé est enregistrée en clair dans les préférences de cet ordinateur. Elle ne se saisit jamais dans le chat, et `@Aide` ne peut ni la lire ni la modifier.

## Étape 3 — Tester et activer

**Tester et activer** envoie une courte question au modèle. Si la réponse arrive, le modèle devient le modèle par défaut de tous les assistants. Si le test échoue, **rien n'est changé** : le message indique la cause (clé refusée, crédit épuisé, modèle introuvable, serveur local injoignable).

Cliquez ensuite sur **Essayer @Aide** : le chat s'ouvre et `@Aide` vous présente ce qu'il sait faire.

## Revenir à l'assistant plus tard

Rouvert une fois l'IA configurée, l'assistant affiche l'**état** : fournisseur et modèle par défaut, et la liste des fonctions IA prêtes ou non.

- **Changer de modèle ou de fournisseur** relance les trois étapes.
- **Tester à nouveau** vérifie que le modèle répond toujours.
- Les fonctions marquées **Optionnel** demandent un modèle particulier (local, avec vision, avec accès Web). Leur indisponibilité est normale tant que vous n'avez pas ce type de modèle.

Vous pouvez aussi le demander à `@Aide` : « Ouvre la configuration de l'IA », « Est-ce que l'IA est bien configurée ? ».

## Ne plus voir le rappel

Dans le bandeau de la page d'accueil ou la notification, **Ne plus proposer** masque définitivement le rappel. L'assistant reste accessible par la commande et par la carte de la page d'accueil. Pour réactiver le rappel : Préférences GeoApp → IA → **Ne plus proposer la configuration de l'IA**.

## Aller plus loin

Pour donner un modèle différent à un assistant précis, ou régler les modèles rapide, web et vision d'OpenRouter, voir **Configurer l'intelligence artificielle** — ou demandez-le simplement à `@Aide`.
