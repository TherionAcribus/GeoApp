# Lexique géocaching — documentation technique

Le vocabulaire du géocaching résiste à la traduction automatique. « DNF », « FTF » ou « TFTC »
ne doivent jamais être traduits ; « container » n'est pas un conteneur de transport et « log »
n'est ni un rondin ni un journal système ; et un « PAT » français devient « FTF » en anglais
sans que l'inverse soit vrai.

Le lexique donne ce savoir aux trois moteurs IA qui manipulent du texte de géocaching :
la traduction d'un log, la rédaction d'un log, et la traduction d'un listing.

## 1. Les trois choix structurants

### 1.1 Les règles sont indexées sur le terme source, pas sur un couple de langues

L'entrée `PAT` porte « en anglais, écris FTF » ; l'entrée `FTF` porte « ne traduis jamais ».
Traduire un log français vers l'anglais donne donc FTF, et traduire un log anglais vers le
français **garde** FTF. L'asymétrie voulue tombe toute seule : il n'y a aucune règle inverse à
écrire, et aucune table par paire de langues à maintenir.

C'est ce qui rend le modèle de données si plat — une entrée, un terme, une règle — alors que le
besoin (« PAT → FTF mais pas FTF → PAT ») semblait appeler une matrice.

### 1.2 Seuls les termes présents dans le texte partent dans le prompt

Cinquante entrées glosées à chaque traduction d'un log de 400 caractères, ce serait payer des
tokens pour **noyer** la consigne. Le texte source est donc balayé avant l'appel, et le bloc de
lexique ne contient que ce qui a matché. Aucun terme repéré, aucun bloc — pas même un en-tête.

C'est exactement le principe déjà appliqué aux `@patterns` dans `log-translator.ts`.

### 1.3 Rien n'est réécrit dans le texte

Le lexique **informe** le modèle, il ne substitue jamais de chaîne. Une substitution locale
casserait le Markdown, pourrait manger un `@pattern` et produirait des accords faux. Le texte
soumis au modèle est le texte de l'utilisateur, inchangé.

## 2. Où vivent les données

| Fichier | Contenu |
|---|---|
| `shared/lexicons/geocaching-lexicon.json` | Le **fond intégré** : une cinquantaine d'entrées curatées, versionnées avec l'application |
| `shared/lexicons/language-keys.json` | Table des noms de langue vers un code ISO 639-1 |
| Préférence `geoApp.ai.lexicon.entries` | Les seules entrées **personnelles** : ajouts, surcharges, désactivations |

Le fond intégré reste dans le code plutôt que dans la valeur de la préférence. C'est ce qui
permet à une correction du lexique livrée avec une mise à jour d'atteindre **aussi** les
utilisateurs qui ont déjà ajouté leurs propres termes : un lexique entièrement stocké dans la
préférence serait figé à la première modification de l'utilisateur.

Le prix de ce découpage est payé dans l'éditeur, qui doit afficher une liste que la préférence
ne contient pas et décider, à chaque modification, s'il faut créer une surcharge, la mettre à
jour ou la retirer (§ 5).

### 2.1 Pourquoi `require` et non `import`

Les deux extensions Theia chargent ces fichiers par `require`, pas par `import` :

```ts
const lexiconFile = require('../../../../../shared/lexicons/geocaching-lexicon.json') as LexiconFile;
```

Un `import` ferait entrer ces fichiers dans le graphe du projet TypeScript, où ils tombent hors
du `rootDir` de l'extension : TS6059 et TS6307, sur un projet (`zones`) qui compile aujourd'hui
proprement. `require` laisse la résolution à webpack, qui trouve exactement le même fichier —
`lib/browser` est à la même profondeur que `src/browser`, le chemin relatif est inchangé après
compilation. Le typage est rétabli à la frontière, par un cast vers une interface déclarée sur
place.

## 3. Forme d'une entrée

```ts
interface LexiconEntry {
    term: string;                            // forme canonique, telle qu'elle s'écrit dans un log
    aliases?: string[];                      // variantes détectées : « log book », « P.A.T. »
    gloss?: string;                          // sens en une ligne, envoyé au modèle
    policy: 'keep' | 'map';                  // ne jamais traduire / utiliser l'équivalent
    translations?: Record<string, string>;   // clé = code de `normalizeLanguageKey`
    disabled?: boolean;                      // entrées personnelles : masque l'entrée intégrée
}
```

La **glose** part dans le prompt avec le terme. Elle coûte quelques dizaines de tokens et évite
les contresens sur les sigles (« TB » n'est pas « to be ») ; surtout, elle permet au modèle de
traduire correctement la phrase *autour* du terme. C'est aussi le filet des entrées `map` dont
la langue cible n'a pas d'équivalent : la glose suffit alors à traduire d'après le sens.

## 4. Le moteur — `zones/src/browser/geocaching-lexicon.ts`

Module pur, sans dépendance Theia, testé par `src/browser/tests/geocaching-lexicon.test.ts`.

| Fonction | Rôle |
|---|---|
| `resolveLexicon(userEntries)` | Fusionne le fond intégré et les entrées personnelles |
| `findLexiconMentions(text, entries)` | Entrées mentionnées dans un texte, **dans l'ordre du lexique** |
| `buildLexiconTranslationBlock(mentions, langue)` | Bloc de prompt pour une traduction |
| `buildLexiconWritingBlock(mentions, langue)` | Bloc de prompt pour une rédaction |
| `findLexiconDeviations(source, traduction, mentions, langue)` | Garde-fou de sortie (§ 6) |
| `normalizeLanguageKey(nom)` | « Anglais », « English », « EN » → `en` |

### 4.1 Fusion

Une entrée personnelle de même terme **remplace** l'entrée intégrée — elle ne la complète pas :
une surcharge partielle laisserait l'utilisateur deviner ce qui reste de l'original. Avec
`disabled: true`, elle la supprime. Les termes inconnus du fond sont ajoutés à la fin.
L'appariement se fait sur le terme normalisé (minuscules, sans accents).

### 4.2 Détection

Deux régimes, décidés par la graphie du terme :

- **Formes tout en capitales** (`DNF`, `FTF`, `P.A.T.`) : recherche **sensible à la casse**,
  dans le texte brut. Chercher « PAT » sans tenir compte de la casse matcherait « pat » dans
  « n'importe quel pattern », et « CO » la moitié des mots d'un log.
- **Toutes les autres formes** (`logbook`, `boîte`, `point favori`) : recherche insensible à la
  casse **et aux accents**, dans le texte normalisé — « Logbook », « logbook » et « la boite »
  doivent tous matcher.

Dans les deux cas, le motif est encadré par des frontières de mot et tolère un pluriel
optionnel. Sans ces frontières, « DNF » matcherait « DNFinder » et « boîte » matcherait
« emboîtement ».

Les frontières comptent le **souligné** comme un caractère de mot, et refusent un `@` juste
avant le terme :

```
(?<![\p{L}\p{N}_])(?<!@) terme (?![\p{L}\p{N}_])
```

Ce n'est pas un raffinement. Sans cela, le terme « cache » se retrouve **dans** le token
`@cache_owner`, et le bloc de lexique demande solennellement au modèle de préserver un mot qui
n'existe pas dans le texte. Les noms de `@patterns` sont en snake_case et pleins de mots du
jargon (`cache_name`, `gc_code`, `cache_owner`, `cache_count`) : c'est le cas courant, pas le
cas tordu.

L'ordre des mentions vient du **lexique**, jamais du texte : le bloc de prompt reste ainsi
stable d'un appel à l'autre, ce qui rend les tests déterministes et le cache de prompt du
fournisseur utile.

Les motifs compilés et le résultat de la fusion sont mémoïsés par `WeakMap` sur le tableau
d'entrées.

## 5. Les trois points de branchement

| Moteur | Fichier | Détection portée sur | Bloc |
|---|---|---|---|
| Traduction d'un log | `log-editor/log-translator.ts` | Le texte soumis, mention de traduction comprise | traduction |
| Rédaction d'un log | `log-editor/ai-log-generator.ts` | Mots-clés + instructions personnalisées | rédaction |
| Traduction d'un listing | `geocache-details-translation-controller.ts` | Le texte brut de **chaque chunk**, puis indices + notes de waypoints | traduction |

Trois précisions qui ne se devinent pas :

- **Rédaction** : la détection ne porte pas sur les *exemples de logs* de l'utilisateur. Un
  lexique déduit d'un corpus d'exemples imposerait à chaque log tout le jargon que l'utilisateur
  a employé un jour ; ce qu'il faut, c'est le vocabulaire de *ce* log, donc ses mots-clés.
- **Listing** : la détection porte sur `htmlToRawText(chunk)` et non sur le HTML. Chercher les
  termes dans le balisage ferait matcher les classes, les attributs et les URLs — et un listing
  est assez long pour que ça compte. Elle est refaite **par chunk**, puisque c'est chunk par
  chunk que le prompt part.
- **Traduction de log** : la détection porte sur le texte *avec* la mention de traduction
  automatique, puisque c'est lui que le modèle va lire.

## 6. Garde-fou de sortie

`findLexiconDeviations` compare l'entrée et la sortie : pour chaque terme repéré à l'entrée, la
forme attendue (le terme lui-même pour `keep`, l'équivalent pour `map`) doit se retrouver dans
la traduction. Sinon, l'éditeur de logs affiche un avertissement **non bloquant** :

> Termes du lexique non repris dans la traduction : « PAT » → « FTF ».

Même rôle que `findLostPatterns` pour les `@patterns` : ça n'empêche rien. Un « DNF » devenu
« je n'ai pas trouvé » n'est pas une erreur de syntaxe, seulement une consigne ignorée, et c'est
à l'utilisateur — qui a le texte sous les yeux — de trancher.

Les entrées `map` sans équivalent dans la langue cible sont ignorées par le garde-fou : rien
n'était attendu, rien ne peut manquer.

## 7. Préférences (catégorie IA, section « Lexique géocaching »)

| Clé | Type | Défaut |
|---|---|---|
| `geoApp.ai.lexicon.enabled` | boolean | `true` |
| `geoApp.ai.lexicon.entries` | array d'objets, rendu `lexicon` | `[]` |

Désactiver revient à traduire sans aucune consigne de vocabulaire : le fond intégré n'est pas
consulté non plus.

## 8. L'éditeur — `preferences/src/browser/geo-lexicon-editor.tsx`

Contrôle dédié (`x-ui.widget: "lexicon"`), une ligne par terme, dépliable en formulaire.

- Le **filtre** cherche dans le terme, les alias, la glose et les équivalents.
- Les **badges** disent d'où vient la ligne : rien pour une entrée intégrée, « modifié » pour
  une surcharge, « perso » pour un terme ajouté.
- `↺` retire la surcharge et rend la définition livrée avec GeoApp.
- `⊘` désactive une entrée intégrée (elle reste affichée, barrée, pour pouvoir la réactiver) ou
  supprime un terme personnel.
- Les **colonnes d'équivalents** sont les langues de `x-ui.optionsFrom`, qui accepte ici un
  **tableau** de clés : les langues de l'éditeur de logs *et* la langue cible des listings, sans
  doublon. Rien ne garantissant que la seconde figure dans la première, une seule source aurait
  laissé une langue sans colonne.

Chaque champ tient un brouillon local et n'écrit dans la préférence qu'au `blur` : sans ça,
chaque frappe déclencherait une écriture de préférence et un rendu de toute la page.

Le terme lui-même n'est pas modifiable : c'est la clé d'appariement avec le fond intégré. Pour
corriger une faute de frappe dans un terme personnel, il faut le supprimer et le ressaisir ; une
variante d'écriture, elle, relève du champ « autres formes détectées ».

L'éditeur et le moteur ne partagent **aucun code** : ils se rejoignent sur les fichiers de
`shared/lexicons/`. Les trois lignes de normalisation (minuscules sans accents) sont donc
volontairement recopiées de part et d'autre — mieux vaut ça qu'une dépendance croisée entre deux
extensions Theia. La table des langues, elle, est trop grosse pour être dupliquée : c'est
pourquoi elle est sortie dans `shared/lexicons/language-keys.json`.

## 9. Tests

`frontend/theia-extensions/zones/src/browser/tests/geocaching-lexicon.test.ts`, dans la chaîne
`test:geoapp` de l'extension `zones`. Couvre la normalisation des langues, les deux régimes de
détection, les frontières de mot, la fusion (surcharge, désactivation, ajout), les trois formes
de rendu du bloc et le garde-fou.

Deux tests portent sur le **fond intégré lui-même** : aucun terme en double, toute entrée `map`
a au moins un équivalent, et **chaque terme se détecte lui-même** — sans quoi une entrée serait
morte sans que personne ne s'en aperçoive.

## 10. Ajouter un terme au fond intégré

1. Ajouter l'entrée dans `shared/lexicons/geocaching-lexicon.json`.
2. Vérifier la graphie : tout en capitales ⇒ détection sensible à la casse (voir § 4.2).
3. Pour une entrée `map`, renseigner au moins un équivalent, et l'équivalent dans la langue du
   terme lui-même (`fr` pour un terme français) — sans quoi traduire vers cette langue tombera
   dans la branche « aucune forme consacrée ».
4. Lancer `npm run test:geoapp` dans `frontend/theia-extensions/zones`.

## Références code

- `shared/lexicons/geocaching-lexicon.json`, `shared/lexicons/language-keys.json`
- `frontend/theia-extensions/zones/src/browser/geocaching-lexicon.ts`
- `frontend/theia-extensions/zones/src/browser/log-editor/log-translator.ts`
- `frontend/theia-extensions/zones/src/browser/log-editor/ai-log-generator.ts`
- `frontend/theia-extensions/zones/src/browser/geocache-details-translation-controller.ts`
- `frontend/theia-extensions/preferences/src/browser/geo-lexicon-editor.tsx`
- `docs/LOGS_SYSTEM_TECHNICAL.md` § 13 (traduction IA du log)
