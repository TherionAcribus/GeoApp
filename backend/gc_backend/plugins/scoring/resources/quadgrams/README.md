# quadgrams

Tables de log-probabilités (log10) de quadgrammes par langue, utilisées par
`_quadgram_fitness` (`gc_backend/plugins/scoring/scorer.py`) pour évaluer à quel
point un texte ressemble à une langue naturelle (« vrai texte vs charabia »).

## Format

Un fichier `<lang>.json` par langue : objet `{ "ABCD": log10_prob, ... }`.
Le scorer prend le **best-of** sur toutes les langues présentes ici (via
`available_quadgram_langs()`), donc ajouter une langue = créer son fichier.

Un quadgramme absent vaut −6.0 dans le scorer. Les tables ne contiennent donc
aucune entrée sous −6.0 : elle noterait un quadgramme connu plus bas qu'un
inconnu.

## Provenance

Les 8 tables (en, fr, de, es, it, nl, pt, pl) sont générées par
`generate_quadgrams.py --from-wordfreq`, à partir des fréquences de mots du
paquet [`wordfreq`](https://pypi.org/project/wordfreq/) (Wikipédia,
sous-titres…) :

1. on tire au hasard 3 millions de mots parmi les 30 000 plus fréquents, chacun
   selon sa fréquence (graine fixe, résultat reproductible) ;
2. on les colle sans espaces ;
3. on compte toutes les fenêtres de 4 lettres.

Coller les mots est essentiel : le scorer retire les espaces avant de faire
glisser sa fenêtre, donc la plupart des fenêtres chevauchent une frontière de
mots (« DE LA RIVIERE » → `ELAR`, à cheval sur trois mots). Une table qui ne
compterait que l'intérieur des mots laisserait ces quadgrammes inconnus.

Chaque table compte 32 000 à 54 000 quadgrammes (460 à 780 Ko).

### Historique

Jusqu'en octobre 2026, en/fr/de étaient synthétisées depuis des matrices de
bigrammes (chaîne de Markov, ~120 000 entrées). C'était un modèle de bigrammes
déguisé : il distinguait à peine un texte réel des mêmes lettres mélangées
(0.56 contre 0.41 en français), et comme le scorer retient la meilleure table,
ces tables faibles masquaient les bonnes. Le mode `--from-bigrams` reste dans le
script comme repli sans dépendance, mais n'est plus utilisé.

Les tables es/it/nl/pt/pl venaient déjà de `wordfreq`, mais en ne comptant que
l'intérieur des mots.

`wordfreq` est un **outil de génération uniquement**, pas une dépendance runtime
(le backend ne lit que ces JSON statiques) — absent de `requirements.txt`.

## Régénération

```bash
pip install wordfreq        # dans un environnement à part, pas celui du backend
python backend/scripts/generate_quadgrams.py --from-wordfreq --langs en fr de es it nl pt pl
```

Après régénération, lancer `pytest backend/tests/test_scoring_calibration.py` :
`TestMultilingualNgram` vérifie que chaque table reconnaît sa langue mieux que
les autres et distingue un texte réel de ses lettres mélangées.

La normalisation des lettres (accents retirés, `ß` → `ss`, `ł` → `l`, `œ` → `oe`…)
doit rester identique dans le script (`_TRANSLITERATION`) et dans le scorer
(`_STATS_TRANSLITERATION`).
