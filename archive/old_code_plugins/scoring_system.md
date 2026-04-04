# Système de Scoring pour les Plugins MysteryAI

Ce document décrit le système d'évaluation de confiance implémenté pour les plugins de décryptage de MysteryAI, avec une attention particulière aux spécificités du géocaching.

## Table des matières

- [Problématique](#problématique)
- [Vue d'ensemble du système](#vue-densemble-du-système)
- [1. Pré-filtrage ultra-léger](#1-pré-filtrage-ultra-léger)
- [2. Normalisation "géocaching"](#2-normalisation-géocaching)
- [3. Segmentation de texte](#3-segmentation-de-texte)
- [4. Détection & confiance « GPS »](#4-détection--confiance-gps)
- [5. Score lexical](#5-score-lexical)
- [6. Score global](#6-score-global)
- [7. Architecture pratique](#7-architecture-pratique)
- [8. Optimisations & garde-fous](#8-optimisations--garde-fous)
- [9. Cas particuliers et retours terrain](#9-cas-particuliers-et-retours-terrain)
- [10. Améliorations récentes](#10-améliorations-récentes)
- [11. Améliorations futures](#11-améliorations-futures)

## Problématique

Le système précédent de score de confiance, basé principalement sur le nombre de fragments décryptés, présente des limitations importantes :

- Un texte décrypté par rotation de l'alphabet donne toujours le même score peu importe la rotation
- De nombreux textes sont techniquement déchiffrables mais ne produisent rien d'intéressant
- Absence de contexte sémantique dans l'évaluation

Le nouveau système se base principalement sur la reconnaissance de mots réels dans les langues connues, avec des adaptations spécifiques au contexte du géocaching.

## Vue d'ensemble du système

Le système complet de scoring suit un processus en plusieurs étapes, depuis le pré-filtrage rapide jusqu'à l'attribution d'un score global normalisé entre 0 et 1.

## 1. Pré-filtrage ultra-léger

Ce filtrage initial, extrêmement rapide (≤ 0,1 ms), rejette d'emblée les textes peu prometteurs :

| Test | Rejette | Méthode |
|------|---------|---------|
| Longueur < 20 caractères | Texte trop court pour être fiable | Sauf si regex coordonnées (voir section 4) |
| Ratio voyelles/consonnes aberrant | Chaînes générées aléatoirement | Implémenté (seuils heuristiques) |
| Explosion de caractères non alphabétiques | Dumps hexadécimaux, Base64, etc. | Seuil ~ 40% non-alpha |
| Séquences binaires/hex sans mots | Bruit technique sans intérêt | Regex binaire/hex + absence de mots et pas de GPS |

> **Astuce d'implémentation** : Réaliser cette étape dans le plugin JS/Electron pour éviter d'appeler l'API Python lorsque l'échec est prévisible.

## 2. Normalisation "géocaching"

### Réduction des espaces

- Transformation de textes comme « H E L L O » en « HELLO » (si ≥ 5 lettres)
- Création d'une variante sans aucun espace (utile pour les formats de coordonnées comme N48°13.123E2°34.567)

### Création de candidats

- Génération de 4 "candidats" maximum à partir du texte original :
  - Texte original
  - Sans doubles espaces
  - Sans espaces
  - Autres normalisations pertinentes

> **⚠️ Attention** : Ne pas multiplier excessivement les variantes. Au-delà de 4 candidats, le temps de calcul explose sans gain significatif.

## 3. Segmentation de texte

Lorsque les espaces sont absents, une segmentation est nécessaire pour identifier des mots potentiels :

| Langue probable | Méthode de segmentation | Latence typique |
|-----------------|------------------------|-----------------|
| Langues alphabétiques (en/fr/es/de...) | Wordninja ou DP Zipf | 0,1–2 ms |
| Langues asiatiques (zh/ja/ko/th) | Jieba / Tiny-Segment | 0,5–4 ms |
| Texte > 200 caractères | Algorithme "Triangular Matrix" (TM) | ~ 0,8 ms |

> **Astuce** : Utiliser fastText (lid.176.ftz, 917 kB) avant de segmenter pour déterminer la langue probable et charger le dictionnaire approprié.

## 4. Détection & confiance « GPS »

La détection des coordonnées GPS est désormais centrale :

1. Le service `detect_gps_coordinates` renvoie :
   * `exist` (bool) : coordonnée détectée ou non.  
   * `confidence` (float ∈ [0-1]) : fiabilité du format reconnu (ex. DDM complet → 0,95 ; pattern flexible → 0,75).  
   * `source` : nom du détecteur qui a fait mouche.

2. Si `exist==True` → le score final du texte = `confidence`.  
   **Aucune autre composante n'est prise en compte.**  
   L'idée : une coordonnée valide vaut à elle seule quasi-certitude.

3. Si aucune coordonnée n'est détectée → on tombe sur la partie lexicale (sections 5-6).

> Les anciens bonus fixes (0,3) et la pondération 70 / 30 sont obsolètes.

### Anti faux-positifs
Certaines séquences ambiguës (ex. « N E N E ») abaissent la `confidence` à ≤ 0,2.

## 5. Score lexical

### Détection de langue robuste

- **Normalisation préalable** : Conversion en minuscules pour améliorer la précision
- **Double vérification** pour les langues ambiguës :
  - Liste de mots spécifiquement français pour détecter les cas ambigus français/anglais
  - Fallback intelligent : si score < 0.2, essayer une autre langue et conserver le meilleur résultat

### Stop-list géocaching

Mots à exclure avant le scoring pour éviter les faux positifs liés au domaine :
- n, s, e, w, o
- est, nord, sud, ouest
- geocache, cache, treasure...

### Dictionnaire de termes géocaching

- **Base de termes spécialisés** organisée par langue :
  - Termes communs à toutes les langues (environ 40 termes)
  - Termes par langue (40-50 termes par langue principale)
  - Phrases complètes (15-20 phrases par langue)
- **Valorisation des termes de géocaching** :
  - Bonus de 50% sur le score Zipf pour les termes de géocaching
  - Bonus supplémentaire proportionnel au nombre de termes géocaching trouvés
  - Priorisation des termes de géocaching dans la liste des mots reconnus
- **Optimisation multiculturelle** :
  - Fallback vers l'anglais pour les langues sans dictionnaire dédié
  - Reconnaissance des formes plurielles/singulières
- **Traitement normalisé de la casse** :
  - Conversion systématique de tous les termes en minuscules lors de la création des filtres
  - Normalisation des segments analysés en minuscules pour assurer une comparaison cohérente
  - Support des textes en majuscules, minuscules ou mixtes durant l'analyse

### Méthode d'évaluation

- **Bloom filter** par langue :
  - Filtres générés à partir des mots les plus fréquents de wordfreq
  - 20 000 mots pour les langues principales (fr, en, de, es, it)
  - 10 000 mots pour les langues secondaires
  - Support pour 14 langues européennes
  - ~28 KB par langue prioritaire, ~14 KB par langue secondaire
  - Taux de faux positifs ≃ 1%

- **Couverture** : proportion des mots trouvés dans le filtre de Bloom

- **Zipf moyen** (avec wordfreq) :
  - Calcul réel des fréquences d'usage via la bibliothèque wordfreq
  - Ajustement sur une courbe en cloche pour éviter de survaloriser les mots très communs
  - Score Zipf typique entre 0 et 7, où 7+ représente les mots les plus fréquents
  - Fonction d'ajustement qui normalise les scores :
    ```
    Si score > 6.5 (mots extrêmement courants) → 4.5
    Si score > 5.5 (mots très courants) → 5.0
    Si score < 1.5 (mots très rares) → 2.0
    Sinon → score inchangé
    ```

- **Formule du score lexical** :
  ```
  score_lexical = 0,7 × coverage + 0,3 × (zipf_moyen/7)
  ```

## 6. Score global

```
si coordonnées GPS détectées :
    score_global = confidence_GPS   # 0,0 – 1,0
sinon :
    score_global = score_lexical
```

### Interprétation

| Score | Interprétation | Interface |
|-------|----------------|-----------|
| ≥ 0,80 | Coordonnée fiable | Badge vert |
| 0,50–0,79 | Résultat probable | Badge orange |
| < 0,50 | Indice faible | Badge gris |

## 7. Architecture pratique

### Architecture standard (appel API)
```
Plugin JS/Electron
   ├─ pré-filtrage (1)
   ├─ normalisation (2)
   └─► appel API Flask /score
            │
            ├─ fastText → langue
            ├─ segmentation (3)
            ├─ regex GPS (4)
            ├─ Bloom + Zipf (5)
            └─ renvoie {texte, langue, score, détails}
UI GoldenLayout
   ├─ trie par score
   └─ affiche top N + badges
```

### Politique d'agrégation et d'affichage (UI)

- La confiance affichée dans l'UI provient toujours du score centralisé (service de scoring).
- La confiance fournie par les plugins est conservée dans `plugin_confidence` à titre informatif, mais n'influence pas le tri.
- En mode "détection" (détecter quels plugins pourraient s'appliquer), la confiance est neutralisée côté résultats standardisés (`confidence=0.0`) pour éviter de polluer le tri global.

### Architecture optimisée (appel direct)
```
Plugin Python
   ├─ pré-filtrage (1)
   ├─ normalisation (2)
   └─► appel direct au service de scoring
            │
            ├─ fastText → langue
            ├─ segmentation (3)
            ├─ regex GPS (4)
            ├─ Bloom + Zipf (5)
            └─ retourne {texte, langue, score, détails}
   └─► fallback sur API si service non disponible
UI GoldenLayout
   ├─ trie par score
   └─ affiche top N + badges
```

- **Cache LRU côté service** : dictionnaires Bloom chargés à la volée puis conservés
- **Fiabilité améliorée** : le système fonctionne même si le serveur Flask n'est pas disponible
- **Performance optimisée** : élimination de la latence réseau pour les appels directs
- Possibilité d'utiliser WebSocket pour obtenir le score en temps réel pendant la saisie

## 8. Optimisations & garde-fous

| Optimisation | Justification |
|--------------|---------------|
| Modèles et Bloom compressés (zstd) | 40 langues ≈ 30 Mo au lieu de 120 Mo |
| Priorité aux 4 langues régionales | Gain de 50% sur le premier appel (ex: fr/en/de/nl pour l'Europe centrale) |
| Limite de 10 000 candidats par énigme | Au-delà, suggérer un algorithme différent plutôt que d'évaluer tous les candidats |
| Journalisation systématique | Ré-entraînement des pondérations sur données réelles (cipher, plain, lang, score, verdict) |
| Pré-filtrage binaire/hex | Évite de scorer du bruit (0/1, hex), si aucun mot ni GPS |
| Ratio voyelles/consonnes | Rejet des chaînes pseudo-aléatoires à faible diversité |
| Confiance centralisée en UI | Empêche des plugins d'imposer des confiances aberrantes |
| Plafond sans mots (base_converter) | Évite des scores élevés basés uniquement sur des caractères imprimables |

## 9. Cas particuliers et retours terrain

| Cas problématique | Solution |
|-------------------|----------|
| Textes très courts (< 10 car.) | Basculer vers détecteur d'indices GPS ou d'hexadécimal |
| Langues agglutinantes (fi, tr) | Utiliser perplexité n-gram plutôt que Bloom (couverture naturellement faible) |
| ROT13 de directions (« A = N, N = A ») | Combiner regex GPS + stop-list pour éliminer la fausse piste |
| Listes de nombres sans direction | Au lieu de "aucun résultat", proposer essai de Vigenère ou bruteforce d'offset numérique |

## 10. Améliorations récentes

### Détection de langue robuste
- **✅ Normalisation automatique** des textes en majuscules et suppression des variations typographiques
- **✅ Traitement cohérent de la casse** avec conversion systématique en minuscules pour l'analyse
- **✅ Détection améliorée français/anglais** grâce à une liste de mots spécifiquement français
- **✅ Mécanisme de fallback intelligent** qui teste plusieurs langues quand le score est faible

### Gestion de texte plus flexible
- **✅ Segmentation intelligente** par wordninja pour les textes sans espaces
- **✅ Filtres de Bloom** pour reconnaissance rapide des mots
- **✅ Évaluation multi-candidats** avec différentes normalisations du texte

### Détection GPS améliorée
- **✅ Support multi-formats** avec expressions régulières enrichies
- **✅ Détection de faux positifs** (nord-est, etc.) via une liste de motifs connus
- **✅ Structure de données coordonnées** pour exploitation future

### Structure de métadonnées enrichie
- **✅ Liste des mots reconnus** dans le résultat
- **✅ Niveau de confiance linguistique**
- **✅ Détails des candidats évalués**

### Analyse Zipf complète
- **✅ Calcul réel des fréquences Zipf** avec la bibliothèque wordfreq
- **✅ Ajustement intelligent des scores** pour valoriser les mots de fréquence moyenne
- **✅ Métadonnées détaillées** incluant statistiques Zipf (min, max, moyenne)
- **✅ Pondération équilibrée** entre couverture lexicale et pertinence des mots

### Termes de géocaching enrichis

### Agrégation et garde-fous UI
- ✅ Confiance affichée toujours issue du score central (propagation automatique vers `combined_results`).
- ✅ Conservation de la confiance plugin sous `plugin_confidence` à des fins d’audit.
- ✅ Neutralisation des confiances en mode détection (évite de perturber le tri global).
- ✅ Plafond des résultats sans mots (ex. conversions ASCII imprimables) dans `base_converter`.

### Pré-filtrage renforcé
- ✅ Rejet des séquences binaires/hexadécimales sans mots ni motif GPS.
- ✅ Rejet sur ratio voyelles/consonnes aberrant pour longs textes non-GPS.
- **✅ Dictionnaire spécialisé** avec plus de 100 termes pour le français et près de 200 pour l'anglais
- **✅ Reconnaissance insensible à la casse** permettant de détecter les termes quelle que soit leur capitalisation
- **✅ Support explicite pour des termes spécifiques** comme "moldus", "geocaching" adaptés au contexte
- **✅ Valorisation renforcée** des termes de géocaching dans le calcul du score final
- **✅ Traitement cohérent des termes** avec normalisation systématique en minuscules lors de la création des filtres

## 11. Améliorations futures

Sur la base du système actuel, voici les améliorations planifiées pour enrichir notre système de scoring:

### API de scoring standardisée

- ✅ Implémentation d'un endpoint dédié `/api/plugins/score` pour centraliser la logique d'évaluation
- ✅ Ajout dans le `plugin.json` d'un champ `scoring_method` permettant aux plugins de spécifier leur méthode préférée:
  ```json
  "scoring_method": {
    "type": "lexical",
    "custom_weights": {
      "lexical": 0.8,
      "gps": 0.2
    }
  }
  ```
- ✅ Ajout d'un accès direct au service de scoring dans les plugins Python pour améliorer la fiabilité et les performances

### Contextualisation par géocache

- Prise en compte des coordonnées GPS de la géocache originale (paramètre optionnel):
  ```json
  "context": {
    "geocache_coords": {
      "latitude": 49.60117,
      "longitude": 5.35098
    }
  }
  ```
- Utilisation de ces coordonnées pour:
  - Prioriser les résultats pointant vers des lieux à proximité
  - Éliminer les résultats trop éloignés (>20km de la cache d'origine)
  - Adapter la priorité des langues selon la région

### Extension du format de sortie standardisé

Enrichissement de la section `metadata` avec des informations détaillées sur le scoring:

```json
"metadata": {
  "scoring": {
    "words_found": ["mot1", "mot2", "mot3"],
    "language_detected": "fr",
    "language_confidence": 0.92,
    "word_coverage": 0.78,
    "zipf_info": {
      "average": 4.3,
      "max": 6.1,
      "min": 2.2,
      "word_frequencies": {
        "mot1": 4.2,
        "mot2": 6.1,
        "mot3": 2.6
      }
    },
    "gps_patterns": ["N 49° 36.070'"],
    "explanation": "Haute confiance car 9 mots français reconnus et format GPS détecté"
  }
}
```

### Optimisations techniques additionnelles

| Optimisation | Mise en œuvre |
|--------------|---------------|
| ✅ Appel direct au service | Utilisation directe du service de scoring dans les plugins Python avec fallback API |
| Cache distribué | Redis pour partager les modèles linguistiques entre instances |
| Préchargement intelligent | Modèles pré-chargés selon géolocalisation de l'utilisateur |
| ✅ Expressions régulières GPS | Expressions régulières améliorées et optimisées pour la détection de coordonnées |
| ✅ Filtres de Bloom adaptatifs | Implémentation et ajustement dynamique selon les besoins |

### Interface utilisateur améliorée

- Visualisation interactive des scores:
  - Graphiques radar montrant les composantes du score (lexical, GPS, proximité)
  - Code couleur sur le texte déchiffré mettant en évidence les mots reconnus
  - Scores de confiance animés lors du calcul en temps réel
- Explication visuelle du scoring:
  - Surlignage des mots reconnus dans le dictionnaire
  - Mise en évidence des motifs de coordonnées GPS
  - Indication des seuils de décision entre les différents niveaux de confiance

Ces améliorations seront déployées progressivement pour enrichir l'expérience utilisateur tout en maintenant les performances du système.

## Résumé

1. **Filtrer** rapidement (ratios, longueurs)
2. **Normaliser** (suppression/condensation d'espaces, majuscules → minuscules)  
3. **Détecter** la langue avec fiabilité et fallback intelligent
4. **Segmenter** si nécessaire, après détection de langue
5. **Chercher** motifs GPS → bonus dédié
6. **Calculer** score lexical (coverage Bloom + Zipf)
7. **Combiner** : si GPS détecté → score = confiance GPS, sinon → score lexical
8. **Ignorer** directions & jargon pour le scoring
9. **Sélectionner** les meilleurs résultats
10. **Journaliser** et apprendre des faux positifs

Cette approche multicritère permet une évaluation plus fiable des résultats de décryptage dans le contexte spécifique du géocaching. 