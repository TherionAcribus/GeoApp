# common_words

Listes de mots à haute fréquence par langue, utilisées par
`_lexical_features` (`gc_backend/plugins/scoring/scorer.py`) pour mesurer la
**reconnaissance réelle de mots** — et non plus le simple nombre de tokens.
C'est ce qui permet à `lexical_coverage` et `coherence` de distinguer une
phrase valide d'un charabia de même longueur.

## Format

Un fichier JSON par langue : `common_words.<lang>.json`, tableau de chaînes.
Langues couvertes (les 8 de `DEFAULT_LANGS_EUROPE`) :
`fr, en, de, es, it, nl, pt, pl`. ~3 800–3 950 mots par langue.

Les mots sont **normalisés** (NFKD, accents retirés, minuscules) au moment de
la génération, exactement comme les tokens le sont au scoring
(`_norm_lex_token`). Cela permet au texte décodé souvent en ASCII majuscules
sans accents (« TROUVE ») de matcher la forme accentuée du dictionnaire
(« trouvé »).

À l'exécution, le scorer met en cache l'**union** de toutes les langues
(`_all_known_words`) : la reconnaissance est volontairement agnostique à la
langue, car la détection de langue (langid) est peu fiable sur du texte court
ou en majuscules (confusion fr/en fréquente).

## Provenance

Généré à partir du paquet [`wordfreq`](https://pypi.org/project/wordfreq/)
(listes de fréquences dérivées de corpus libres : Wikipédia, sous-titres
OpenSubtitles, etc.), via `top_n_list(lang, N)`.

`wordfreq` est un **outil de génération uniquement** : il n'est PAS une
dépendance runtime du backend (le code ne lit que ces JSON statiques) et ne
figure donc pas dans `requirements.txt`.

## Régénération

```bash
pip install wordfreq          # build-time only
python backend/scripts/generate_common_words.py            # ~4000 mots/langue
python backend/scripts/generate_common_words.py --top-n 5000
```

Voir `backend/scripts/generate_common_words.py`.
