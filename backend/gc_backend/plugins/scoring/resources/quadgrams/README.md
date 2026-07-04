# quadgrams

Tables de log-probabilités (log10) de quadgrammes par langue, utilisées par
`_quadgram_fitness` (`gc_backend/plugins/scoring/scorer.py`) pour évaluer à quel
point un texte ressemble à une langue naturelle (« vrai texte vs charabia »).

## Format

Un fichier `<lang>.json` par langue : objet `{ "ABCD": log10_prob, ... }`.
Le scorer prend le **best-of** sur toutes les langues présentes ici (via
`available_quadgram_langs()`), donc ajouter une langue = créer son fichier.

Un quadgramme absent est pénalisé (plancher −6.0 dans le scorer). L'échelle
log10 doit rester cohérente entre langues pour que le best-of soit équitable.

## Provenance (deux origines)

- **en, fr, de** : générés par `generate_quadgrams.py --from-bigrams`, à partir
  de matrices de bigrammes publiées + chaîne de Markov. Couverture dense
  (~120 k quadgrammes) car combinatoire.
- **es, it, nl, pt, pl** : générés par `generate_quadgrams.py --from-wordfreq`,
  à partir des fréquences réelles du paquet [`wordfreq`](https://pypi.org/project/wordfreq/)
  (Wikipédia, sous-titres…), pondérées par fréquence de mot. Couverture plus
  fine (~15–22 k quadgrammes attestés).

Les tables wordfreq sont un peu moins denses que les tables bigrammes : un texte
roman (es/it/pt) peut obtenir son meilleur score via la table `fr` plutôt que la
sienne, ce qui est linguistiquement normal (quadgrammes partagés). Le signal
`ngram_fitness` reste > 0.3 pour les 8 langues sur du texte valide.

`wordfreq` est un **outil de génération uniquement**, pas une dépendance runtime
(le backend ne lit que ces JSON statiques) — absent de `requirements.txt`.

## Régénération

```bash
# en / fr / de (matrices de bigrammes embarquées)
python backend/scripts/generate_quadgrams.py --langs en fr de

# es / it / nl / pt / pl (wordfreq ; pip install wordfreq)
python backend/scripts/generate_quadgrams.py --from-wordfreq --langs es it nl pt pl
```
