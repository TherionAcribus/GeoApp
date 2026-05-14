---
title: "Bienvenue dans GeoApp"
description: "Introduction générale à GeoApp et ses grandes fonctionnalités."
order: 10
tags: [introduction, présentation, géocaching]
---

# Bienvenue dans GeoApp

GeoApp est un environnement de travail dédié à la **résolution de géocaches mystères**. Il combine un gestionnaire de géocaches, une carte interactive, des dizaines d'outils de déchiffrement (plugins), et un système d'intelligence artificielle configurable pour vous aider à résoudre les énigmes les plus complexes.

## Ce que GeoApp vous permet de faire

### Gérer vos géocaches

Importez vos géocaches depuis Geocaching.com (pocket queries, listes de favoris, zone géographique) ou depuis des fichiers GPX. Organisez-les dans des **zones** — des dossiers thématiques qui vous permettent de regrouper les caches par secteur, niveau de difficulté, ou par projet de résolution.

### Analyser les descriptions

Chaque géocache s'ouvre dans un onglet dédié avec sa description complète, ses coordonnées officielles, ses attributs, ses waypoints et ses logs. GeoApp parse automatiquement le HTML pour vous présenter un contenu lisible et cliquable.

### Résoudre les énigmes avec les plugins

Le cœur de GeoApp est son moteur de **plugins** : plus de 50 outils spécialisés couvrent les chiffres classiques (César, Vigenère, Morse, Braille, ADFGVX, Enigma...), les systèmes de coordonnées, les codes visuels, les formules mathématiques, l'analyse d'images, et bien plus.

### Utiliser l'intelligence artificielle

GeoApp intègre un système d'IA configurable (OpenAI, Anthropic, Ollama, OpenRouter...) avec plusieurs agents spécialisés :

- **@Aide** — répond à vos questions sur l'utilisation de GeoApp
- **Agent principal** — analyse les descriptions de géocaches et propose des pistes de résolution
- **Agent formules** — résout les formules mathématiques dans les descriptions
- **Agent traduction** — traduit les descriptions dans votre langue
- **Agent OCR** — extrait du texte depuis les images de la galerie
- **Agent logs** — analyse les logs des autres utilisateurs pour trouver des indices

### Générer des waypoints et exporter

Lorsque vous avez trouvé les coordonnées finales, enregistrez-les comme waypoints, visualisez-les sur la carte, et exportez en GPX pour votre GPS ou l'application Geocaching.

---

## Architecture de l'interface

L'interface de GeoApp est construite sur **Eclipse Theia**, un environnement de développement adapté aux besoins spécifiques de la résolution de géocaches.

```
┌────────────────────────────────────────────────────────────────┐
│  Barre de menus                                               │
├──────────┬─────────────────────────────────────┬──────────────┤
│ Panneau  │                                     │ Panneau      │
│ gauche   │    Zone principale (onglets)        │ droit        │
│          │                                     │              │
│ Zones    │  Géocache / Carte / Plugins /       │ Chat IA /    │
│ Plugins  │  Archive / Notes...                 │ Logs...      │
│ Carte    │                                     │              │
├──────────┴─────────────────────────────────────┴──────────────┤
│  Panneau bas (terminal, sortie, résultats...)                  │
└────────────────────────────────────────────────────────────────┘
```

---

## Premiers pas recommandés

1. **Configurer un modèle IA** — Allez dans `Fichier > Préférences > Préférences ouvertes` et cherchez `GeoApp` pour configurer vos clés API
2. **Créer une zone** — Cliquez sur `+` dans le panneau Zones pour créer votre premier regroupement
3. **Importer des géocaches** — Utilisez le menu `GeoApp > Importer` pour charger un fichier GPX ou une pocket query
4. **Ouvrir une géocache** — Double-cliquez sur une géocache dans la liste pour l'analyser

→ Continuez avec [Présentation de l'interface](./interface.md) pour un tour complet de l'écran.
