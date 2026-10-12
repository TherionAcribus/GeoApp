# common_words

Listes de mots par langue, classés du plus au moins fréquent. Deux usages dans
`gc_backend/plugins/scoring/scorer.py` :

- `_lexical_features` : mesurer la **reconnaissance réelle de mots** — et non le
  simple nombre de tokens. C'est ce qui permet à `lexical_coverage` et
  `coherence` de distinguer une phrase valide d'un charabia de même longueur.
- `_segment_glued_words` : redécouper un texte sans espaces. Le **rang** de
  chaque mot (sa position dans la liste) sert de coût : un mot fréquent est
  préféré, ce qui fait choisir « trouve au » plutôt que « trou veau ».

## Format

Un fichier JSON par langue : `common_words.<lang>.json`, tableau de chaînes
**dans l'ordre de fréquence** (ne pas le trier). Langues couvertes (les 8 de
`DEFAULT_LANGS_EUROPE`) : `fr, en, de, es, it, nl, pt, pl`. Environ 26 000 à
27 700 mots par langue.

Les mots sont **normalisés** au moment de la génération, exactement comme les
tokens le sont au scoring (`_norm_lex_token`) : accents retirés, minuscules, et
translittération des lettres que NFKD ne décompose pas (`ß` → `ss`, `ł` → `l`,
`œ` → `oe`, `æ` → `ae`, `ø` → `o`, `đ` → `d`). Cela permet au texte décodé,
souvent en ASCII majuscules sans accents (« TROUVE », « STRASSE »), de matcher
la forme du dictionnaire (« trouvé », « Straße »).

## Profondeur selon la longueur du mot

| Longueur du mot | Rang de fréquence maximal |
|---|---|
| 2 ou 3 lettres | 4 000 |
| 4 lettres | 12 000 |
| 5 lettres et plus | 30 000 |

Les mots courts sont ceux qu'une suite de lettres quelconque reconnaît par
hasard : 59 % des paires de lettres tirées au hasard sont un « mot » de 2
lettres dans au moins une des 8 langues. Et passé les premiers milliers de
rangs, les entrées courtes d'une liste de fréquences sont surtout des
abréviations, des initiales et des bribes étrangères (`ii`, `th`, `dvd`). Les
mots longs ne présentent presque pas ce risque (0,3 % à 6 lettres) et sont donc
pris beaucoup plus profond.

Jusqu'en octobre 2026, la liste s'arrêtait au rang 4 000 pour toutes les
longueurs : `panneau`, `banc`, `souche`, `félicitations`, `treasure` ou
`versteckt` y étaient inconnus.

À l'exécution, `lexical_coverage` utilise l'**union** de toutes les langues
(`_all_known_words`) : la reconnaissance est volontairement agnostique à la
langue, car la détection de langue (langid) est peu fiable sur du texte court
ou en majuscules. La segmentation, elle, travaille **langue par langue**
(`_lang_vocabulary`).

## Provenance

Généré à partir du paquet [`wordfreq`](https://pypi.org/project/wordfreq/)
(listes de fréquences dérivées de corpus libres : Wikipédia, sous-titres
OpenSubtitles, etc.), via `top_n_list(lang, N)`.

`wordfreq` est un **outil de génération uniquement** : il n'est PAS une
dépendance runtime du backend (le code ne lit que ces JSON statiques) et ne
figure donc pas dans `requirements.txt`.

## Régénération

```bash
pip install wordfreq          # dans un environnement à part, pas celui du backend
python backend/scripts/generate_common_words.py
```

Les limites par longueur sont dans `RANK_LIMITS` du script. Après régénération,
lancer `pytest backend/tests/test_scoring_calibration.py` : `TestVocabulary`
vérifie la couverture et que le nombre de mots courts n'a pas enflé,
`TestGluedWordSegmentation` que les découpages restent naturels.
