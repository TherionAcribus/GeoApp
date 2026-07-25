# Télégraphe à cinq aiguilles (Cooke & Wheatstone)

Encode et décode le **télégraphe à cinq aiguilles** de Cooke et Wheatstone (1837),
premier télégraphe électrique commercial. Chaque lettre était affichée en
énergisant **deux** aiguilles parmi cinq, qui pivotaient en sens opposés pour
pointer vers une lettre placée à l'intersection d'une grille en losange ; les
trois autres aiguilles restaient verticales (au repos).

## Représentation des aiguilles

| Symbole | Signification            |
|---------|--------------------------|
| `\`     | aiguille déviée à gauche |
| `\|`    | aiguille au repos        |
| `/`     | aiguille déviée à droite |

Chaque lettre = **5 symboles**. Le système ne code que **20 lettres** :
`C, J, Q, V, X, Z` sont **omises** (convention de l'outil CacheSleuth reproduit ici).

## Table

```
A /|||\    B /||\|    D |/||\    E /|\||    F |/|\|
G ||/|\    H /\|||    I |/\||    K ||/\|    L |||/\
M \\|||    N |\\||    O ||\\|    P |||\\    R \|/||
S |\|/|    T ||\|/    U \||/|    W |\||/    Y \|||/
```

## Modes

- **encode** : texte clair → codes d'aiguilles. Les lettres sont séparées par une
  espace, les mots par trois espaces. Les lettres omises sont signalées dans le
  résumé et `metadata.omitted_letters`.
- **decode** : codes d'aiguilles → texte clair. Accepte un flux continu (découpé
  par blocs de 5) ou des groupes séparés par des espaces. Un groupe inconnu
  devient `?`.
  - Option **`auto_detect`** : si le message emploie 3 caractères non standard,
    toutes les affectations aux positions d'aiguilles sont testées et proposées ;
    le scoring linguistique du backend départage.

## Exemple

`BADGER` → `/||\| /|||\ |/||\ ||/|\ /|\|| \|/||`

## Références

- <https://www.cachesleuth.com/tools/fiveneedletelegraph/>
- <https://en.wikipedia.org/wiki/Cooke_and_Wheatstone_telegraph>
