---
title: "Configurer l'intelligence artificielle"
description: "Comment choisir le modèle de langage utilisé par chaque agent IA (EarthCoach, Chat GeoApp, @Aide, OCR...) et régler les modèles OpenRouter."
order: 10
tags: [IA, configuration, modèle, changer de modèle, agent, EarthCoach, OpenRouter, OpenAI, Anthropic, Ollama, alias, default/universal, Configuration IA]
---

# Configurer l'intelligence artificielle

> **Première configuration ?** Utilisez l'assistant : `Ctrl+Shift+P` → **GeoApp : Configurer l'IA**. Il enregistre votre clé, teste le modèle et le branche sur tous les assistants en trois étapes (voir « Configurer l'IA » dans Premiers pas). Cette page décrit les réglages fins, agent par agent.

Le réglage se fait à deux niveaux :

1. **Les fournisseurs** (OpenRouter, OpenAI, Anthropic, Ollama...) rendent des **modèles** disponibles dans l'application.
2. **Chaque agent** (EarthCoach, Chat GeoApp, @Aide, OCR, traduction...) utilise **un modèle** parmi ceux disponibles. Ce choix se fait agent par agent.

Pour changer le modèle d'une tâche, on change donc le modèle **de l'agent** qui réalise cette tâche.

## Changer le modèle d'un agent

Le choix du modèle par agent se fait dans la vue **Configuration IA** :

1. Ouvrez la vue **Configuration IA**, au choix :
   - **Préférences GeoApp** → section **IA** → bouton **« Configurer Agent Theia (IA) »** (les sections Chat et OCR ont un bouton équivalent) ;
   - palette de commandes (`Ctrl+Shift+P`) → **AI Configuration** ;
   - ou demandez-le à `@Aide` : « Ouvre la configuration IA ».
2. Onglet **Agents** → sélectionnez l'agent (par exemple **EarthCoach**).
3. Dans **LLM Requirements**, choisissez le modèle dans la liste.

Le changement s'applique immédiatement, aux prochaines requêtes de l'agent.

> **Astuce :** `@Aide` peut faire le changement pour vous (voir « Changer de modèle avec @Aide » plus bas).

### Modèle par défaut : l'alias `default/universal`

Tant que vous n'avez rien choisi pour un agent, il utilise l'alias **`default/universal`**, partagé par tous les agents GeoApp. Modifier cet alias (onglet **Model Aliases** de la Configuration IA) change donc le modèle de **tous** les agents qui n'ont pas de choix propre. Pour ne changer qu'une tâche, choisissez un modèle sur l'agent concerné.

## Les modèles OpenRouter de GeoApp

Quand une clé API OpenRouter est renseignée (**Préférences GeoApp → IA → OpenRouter**), GeoApp enregistre quatre modèles. Chacun correspond à un **modèle OpenRouter réel**, défini par une préférence :

| Modèle dans la Configuration IA | Préférence (libellé) | Défaut |
|---|---|---|
| `openrouter/fast` | `geoApp.ai.openRouter.model.fast` (Modèle rapide) | `openai/gpt-4o-mini` |
| `openrouter/strong` | `geoApp.ai.openRouter.model.strong` (Modèle qualité) | `openai/gpt-4o` |
| `openrouter/web` | `geoApp.ai.openRouter.model.web` (Modèle web) | `openai/gpt-4o` |
| `openrouter/vision` | `geoApp.ocr.openRouter.model` (Modèle vision OpenRouter) | `openai/gpt-4o-mini` |

Les préférences de modèle attendent l'identifiant OpenRouter du modèle (ex. `anthropic/claude-sonnet-4.5`, `google/gemini-2.5-pro`), tel qu'affiché sur openrouter.ai.

**Deux façons de changer de modèle OpenRouter**, avec des effets différents :

- **Attribuer un autre slot à l'agent** (ex. passer EarthCoach de `openrouter/fast` à `openrouter/strong`) : seul cet agent change.
- **Changer le modèle réel d'un slot** (ex. mettre `geoApp.ai.openRouter.model.strong` à un autre modèle) : **tous les agents** qui utilisent ce slot changent de modèle.

## Exemple : changer le modèle d'EarthCoach

EarthCoach (le chat du Dossier terrain, « Analyser mes observations », « Résoudre avec mon dossier ») utilise **toujours le modèle attribué à l'agent EarthCoach**. Le profil « qualité » demandé par « Résoudre avec mon dossier » ne sert qu'en secours, si aucun modèle n'est disponible pour EarthCoach.

Pour lui donner un modèle OpenRouter précis :

1. Configuration IA → Agents → **EarthCoach** → choisissez par exemple `openrouter/strong`.
2. Si le modèle réel derrière ce slot ne convient pas, changez **Modèle qualité** (`geoApp.ai.openRouter.model.strong`) dans Préférences GeoApp → IA → OpenRouter, en gardant en tête que les autres agents sur ce slot changent aussi.

## Changer de modèle avec @Aide

`@Aide` sait lire et modifier le modèle de chaque agent :

| Demande (exemples) | Action |
|---|---|
| « Quel modèle utilise EarthCoach ? » | Indique le modèle choisi, le modèle réellement utilisé et, pour OpenRouter, le modèle réel du slot |
| « Quels modèles utilisent mes agents ? » | Liste tous les agents et leur modèle |
| « Quels modèles sont disponibles ? » | Liste les modèles enregistrés, leur statut et les alias |
| « Fais utiliser openrouter/strong à EarthCoach » | Attribue ce modèle à l'agent EarthCoach |
| « Remets EarthCoach sur son modèle par défaut » | Supprime le choix, l'agent revient à `default/universal` |
| « Mets anthropic/claude-sonnet-4.5 comme modèle qualité OpenRouter » | Modifie `geoApp.ai.openRouter.model.strong` (tous les agents du slot) |
| « Ouvre la configuration IA » | Ouvre la vue Configuration IA |

## Dépannage

- **Aucun assistant ne répond** : ouvrez l'assistant **GeoApp : Configurer l'IA**. Son écran d'état indique si un modèle par défaut est disponible et quelles fonctions sont prêtes ; **Tester à nouveau** dit pourquoi le modèle ne répond pas (clé refusée, crédit épuisé, serveur local arrêté).
- **Vous n'avez qu'une clé OpenRouter ou un modèle local** : l'alias `default/universal` ne les vise pas de lui-même. L'assistant fait ce branchement ; à la main, sélectionnez le modèle dans l'onglet **Model Aliases**.
- **Le modèle voulu n'apparaît pas dans la liste** : le fournisseur n'est pas configuré ou sa clé API manque. Pour OpenRouter, vérifiez **Activer OpenRouter** et **Clé API** dans Préférences GeoApp → IA → OpenRouter.
- **L'agent répond « aucun modèle »** : le modèle choisi n'est pas prêt (fournisseur indisponible). Choisissez-en un autre, ou remettez l'agent sur son modèle par défaut.
- **Un outil manque dans le chat** : ce n'est pas un problème de modèle, voir la vue **Policy Chat IA** (`@Aide` : « Ouvre la policy du chat »).
