# Plugin Chiffrement Multiplicatif

Ce plugin implémente le **chiffrement multiplicatif** – un algorithme de cryptographie classique basé
sur l'arithmétique modulaire. Chaque lettre est convertie en un nombre (A=0, B=1, …, Z=25) puis
multipliée par un coefficient **a** premier avec 26 :

\[ E(x) = (a \times x) \mod 26 \]

Pour déchiffrer, on utilise l'inverse modulaire **a⁻¹** de *a* :

\[ D(y) = (a^{-1} \times y) \mod 26 \]

## Coefficients autorisés

Un coefficient est **valide** si \(\gcd(a,26)=1\). Les 12 valeurs possibles sont :

```
1, 3, 5, 7, 9, 11, 15, 17, 19, 21, 23, 25
```

> ⚠️  Un coefficient non premier avec 26 ne possède pas d'inverse modulaire ; le plugin renverra donc une erreur.

---

## Modes de fonctionnement

| Mode | Description |
|------|-------------|
| **encode** | Chiffre un texte clair avec le coefficient *a* sélectionné |
| **decode** | Déchiffre un texte en utilisant *a* (nécessite l'inverse modulaire) |
| **bruteforce** | Teste automatiquement les 12 valeurs possibles de *a* et classe les résultats par score |

Le mode **bruteforce** est également activable via la case à cocher *brute_force*.

---

## Paramètres

| Nom | Type | Description |
|-----|------|-------------|
| **text** | string | Texte à chiffrer / déchiffrer |
| **mode** | select | encode / decode / bruteforce (défaut : decode) |
| **a** | select | Coefficient multiplicatif (ignoré si bruteforce) |
| **brute_force** | checkbox | Active la recherche exhaustive des 12 clés |
| **enable_scoring** | checkbox | Évalue automatiquement les résultats (score lexical, GPS…) |

---

## Exemples d'utilisation

### Encodage

| Entrée | Paramètres | Sortie |
|--------|-----------|--------|
| `HELLO` | mode : encode, a : 5 | `CZGGJ` |

*Détail* : H(7) → 5×7=35→9 (J), E(4) → 5×4=20 (U)…

### Décodage

```text
Entrée  : CZGGJ
Mode    : decode
Coefficient a : 5
Résultat: HELLO
```

### Bruteforce

```json
{
  "mode": "bruteforce",
  "text": "CZGGJ",
  "enable_scoring": "on"
}
```

Renvoie les 12 décryptages possibles ; le meilleur (score le plus élevé) est indiqué dans `summary.best_result_id`.

---

## Scoring automatique

Comme les autres plugins MysteryAI, **multiplicative_code** peut faire évaluer les textes décodés via le service de
scoring interne :

* fréquence lexicale (Zipf)
* détection de coordonnées GPS
* heuristiques linguistiques (français)

Le score (0 – 1) est stocké dans chaque résultat et utilisé pour trier les solutions lors d'un bruteforce.

---

## Notes techniques

* Inversion modulaire calculée par recherche naïve (suffisant pour 26).
* Les caractères hors [A-Z] sont conservés tels quels.
* Compatible avec le **format de sortie standardisé** du système de plugins (voir `docs/plugin_system.md`).
* Point d'entrée : `plugins/official/multiplicative_code/main.py`. 