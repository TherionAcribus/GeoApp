# Scoring V3 (Plugins Executor) — TODO

## Objectif

- Remettre en fonctionnement un **scoring centralisé** (source de vérité backend) pour les résultats des plugins.
- Implémenter un pipeline **fail-fast** (Couche A/B/C) + système **Features** pondérées.
- LangID **léger** basé trigrammes (codes langues **ISO-639-1**) et ressources versionnées (out-of-the-box).

## Périmètre langues (standard Europe)

- fr
- en
- de
- es
- it
- nl
- pt
- pl

Ordre par défaut: fr → en → de → es → it → nl → pt → pl

## Contrat de sortie (rappel)

- Le tri/affichage UI doit se baser sur une **confidence centralisée**.
- La confiance native du plugin (si présente) doit être conservée pour audit sous `metadata.plugin_confidence`.
- La confiance finale (score) doit être écrite dans `results[*].confidence`.
- Les détails doivent être stockés dans `results[*].metadata.scoring`.
- En mode `detect`, neutraliser `results[*].confidence = 0.0` (ne pas polluer le tri global).

## Spécificité géocaching (coordonnées en mots)

- Les énigmes géocaching contiennent souvent des coordonnées au format texte :
  - chiffres (ex: `N 48° 33.787 E 006° 38.803`)
  - **nombres écrits en toutes lettres** (ex: `north forty six degrees ...` / `nord quarante six degres ...`)
- Le scoring backend doit donc inclure une feature `coord_words` qui détecte :
  - directions (`north/south/east/west`, `nord/sud/est/ouest`, etc.)
  - unités / séparateurs (`degrees/degres/grad`, `minutes`, `point/dot/virgule/...`)
  - nombres en mots (sur les 8 langues supportées)
- Cette feature est utilisée pour **éviter** un early-exit trop agressif (`ngram_low`) qui aplatirait tous les candidats à `0.05` en brute-force.

## Jalons

### J1 — Backend: moteur de scoring (V1)

- [ ] Créer module `gc_backend/plugins/scoring/`
- [ ] Implémenter normalisation fail-fast (maj, suppression ponctuation) pour IC/N-grams
- [ ] Couche A:
  - [ ] Indice de coïncidence (IC) + veto IC < 0.045 (sauf GPS fort)
  - [ ] Entropie de Shannon (uniforme/chaotique)
  - [ ] GPS gatekeeper (regex ultra-rapide) + validation numérique stricte
- [ ] Couche B:
  - [ ] N-gram fitness via quadgrams (lazy-load)
  - [ ] Pénalité de répétition/cycles
- [ ] Couche C (light):
  - [ ] LangID trigrammes (ISO-639-1, 8 langues)
  - [ ] Segmentation (wordninja) uniquement si nécessaire
  - [ ] Lexical coverage (Bloom/Set) + stopwords + geo_terms
  - [ ] Coherence factor (longest run)
- [ ] Fusion V3 (somme pondérée saturée + bonus combo)
- [ ] Cache LRU (1000 entrées) pour textes scorés

### J2 — API scoring

- [ ] Ajouter endpoint `POST /api/plugins/score`
- [ ] Paramètres:
  - [ ] `text` (ou liste) + `context` optionnel (coords géocache)
- [ ] Réponse:
  - [ ] `score` + `metadata.scoring` complet

### J3 — Intégration scoring dans exécution plugin

- [ ] Dans `POST /api/plugins/<name>/execute`:
  - [ ] Si `enable_scoring` (plugin.json ou input): scorer `results[*].text_output`
  - [ ] Écrire `results[*].confidence = score`
  - [ ] Sauver confiance plugin si existante (`metadata.plugin_confidence`)
  - [ ] Mode `detect`: confidence neutralisée

### J4 — Ressources versionnées

- [ ] Ajouter `resources/` versionné:
  - [ ] stopwords (8 langues)
  - [ ] geo_terms (8 langues)
  - [ ] quadgrams (8 langues, compressé)
  - [ ] lexicon (Bloom/Set, 8 langues)
- [ ] Lazy-loading (ne charger que top 2 langues + fallback en)

### J5 — Tests & benchmarks

- [ ] Tests des cas attendus:
  - [ ] Succès GPS
  - [ ] Succès texte naturel
  - [ ] Faux positif GPS invalide
  - [ ] Bruit
- [ ] Benchmark latence (moyenne + p95) et taux de rejet Couche A

### J6 — UI Plugin Executor

- [ ] Toggle scoring
- [ ] Tri/badges (vert/orange/gris)
- [ ] Afficher `metadata.scoring.explanation` + features
- [ ] Pré-filtrage frontend ultra-léger (optionnel)
