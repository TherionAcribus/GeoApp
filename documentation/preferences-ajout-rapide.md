# Ajouter une préférence GeoApp - fiche courte pour IA/codeurs

Cette fiche donne la procédure courte pour ajouter une nouvelle préférence GeoApp sans casser la page Préférences, la synchro backend ou `@Aide`.

## Règle d'or

Le fichier source de vérité est :

```text
shared/preferences/geo-preferences-schema.json
```

Ne pas créer une préférence uniquement dans un composant React, un service Theia ou un module Flask. Toujours la déclarer dans le schéma partagé.

## Checklist

1. Ajouter la clé dans `shared/preferences/geo-preferences-schema.json`.
2. Utiliser une clé `geoApp.<domaine>.<option>`.
3. Renseigner obligatoirement `type`, `default`, `title`, `description`, `x-category`, `x-targets`, `x-ui`.
4. Ajouter `enum` ou `minimum` / `maximum` si la valeur doit être contrainte.
5. Ajouter `x-ui.enumLabels` si les valeurs techniques ne sont pas lisibles.
6. Mettre `x-ui.advanced: true` si le réglage est technique, rare, risqué ou réservé au diagnostic.
7. Mettre `x-sensitive: true` pour une clé API, un token ou un secret.
8. Lire la préférence dans le module concerné avec le bon service.
9. Si la préférence est backend, vérifier que son type est supporté par `backend/gc_backend/utils/preferences.py`.
10. Lancer les validations.

## Modèle conseillé

```json
"geoApp.monDomaine.monOption": {
  "type": "boolean",
  "default": true,
  "title": "Nom lisible de la préférence",
  "description": "Explique précisément ce que change cette préférence.",
  "x-ui": {
    "section": "Général",
    "label": "Libellé court dans l'interface",
    "order": 10,
    "keywords": [
      "mot clé utilisateur",
      "synonyme"
    ]
  },
  "x-category": "ui",
  "x-targets": [
    "frontend"
  ],
  "x-tags": [
    "ui"
  ]
}
```

## Choisir `x-targets`

Utiliser `frontend` si la préférence est lue seulement par Theia :

```json
"x-targets": ["frontend"]
```

Utiliser `backend` si elle est lue par Flask :

```json
"x-targets": ["backend"]
```

Utiliser les deux si elle doit être cohérente des deux côtés :

```json
"x-targets": ["frontend", "backend"]
```

Attention : le backend normalise actuellement surtout les types scalaires (`boolean`, `string`, `integer`, `number`). Pour synchroniser un `array` ou un `object` vers Flask, étendre d'abord `_normalize_value` dans `backend/gc_backend/utils/preferences.py`.

## Lire la préférence côté frontend

Dans une extension Theia, utiliser `PreferenceService` :

```ts
const enabled = this.preferenceService.get('geoApp.monDomaine.monOption', true) as boolean;
```

Pour écrire depuis un widget ou service :

```ts
await this.preferenceService.set('geoApp.monDomaine.monOption', false, PreferenceScope.User);
```

Si la clé a `backend` dans `x-targets`, `PreferenceSyncService` enverra automatiquement la valeur au backend.

## Lire la préférence côté backend

Dans Flask, utiliser :

```py
from gc_backend.utils.preferences import get_value_or_default

enabled = bool(get_value_or_default('geoApp.monDomaine.monOption', True))
```

Ne pas lire directement `AppConfig` sauf cas exceptionnel.

## Ajouter une enum

Toujours ajouter des libellés humains si les valeurs sont techniques.

```json
"geoApp.map.foundGeocacheDisplayMode": {
  "type": "string",
  "enum": ["transparent", "hidden", "found-icon"],
  "default": "found-icon",
  "title": "Caches déjà trouvées",
  "description": "Mode d'affichage des géocaches déjà trouvées sur la carte.",
  "x-ui": {
    "section": "Affichage",
    "label": "Affichage des caches trouvées",
    "order": 40,
    "enumLabels": {
      "transparent": "Transparentes",
      "hidden": "Masquées",
      "found-icon": "Icône trouvée"
    }
  },
  "x-category": "map",
  "x-targets": ["frontend"]
}
```

## Ajouter une préférence avancée

Marquer comme avancé si l'utilisateur moyen ne devrait pas la modifier souvent.

```json
"x-ui": {
  "section": "Exécution",
  "label": "Timeout d'exécution",
  "advanced": true,
  "order": 100
}
```

Cas typiques :

- timeout ;
- workers ;
- chemin local ;
- API base URL ;
- policy, override, pipeline ;
- allowlist ;
- clé API ou secret.

## Ajouter une préférence sensible

Pour une clé API :

```json
"x-sensitive": true,
"x-ui": {
  "section": "OpenRouter",
  "label": "Clé API",
  "advanced": true,
  "order": 10
}
```

Effets :

- l'UI utilise un champ masqué ;
- `@Aide` masque la valeur ;
- `@Aide` refuse de lire ou modifier cette clé.

## Ajouter une nouvelle catégorie

À éviter si une catégorie existante suffit.

Si c'est vraiment nécessaire :

1. Ajouter `x-category` dans le schéma.
2. Ajouter le libellé dans `CATEGORY_LABELS` de `geo-preferences-widget.tsx`.
3. Ajouter l'ordre dans `CATEGORY_ORDER`.
4. Vérifier si un guide par usage doit inclure cette catégorie.
5. Documenter la catégorie dans `docs/PREFERENCES.md` ou une doc fonctionnelle.

## Ajouter au bon guide par usage

Les guides sont déclarés dans :

```text
frontend/theia-extensions/preferences/src/browser/geo-preferences-widget.tsx
```

Et exposés à `@Aide` dans :

```text
frontend/theia-extensions/documentation/src/browser/doc-action-tools.ts
```

Si la nouvelle préférence correspond à un usage déjà existant, vérifier qu'elle matchera par :

- `categories`
- `sections`
- `keyPrefixes`
- `keyIncludes`
- `tags`

Exemple : une préférence `geoApp.ocr.*` ira naturellement dans le guide `Images et OCR` si son préfixe est déjà couvert.

## Tests et validations

À lancer après modification :

```powershell
Get-Content -Raw shared/preferences/geo-preferences-schema.json | ConvertFrom-Json | Out-Null
yarn --cwd frontend/theia-extensions/preferences build
yarn --cwd frontend/theia-extensions/documentation build
```

Si la préférence touche le backend :

```powershell
pytest backend/tests/test_preferences_api.py
```

## Erreurs fréquentes à éviter

- Oublier `x-ui` : la page reste moins lisible et `@Aide` comprend moins bien.
- Oublier `default` : les snapshots et resets deviennent ambigus.
- Mettre `backend` dans `x-targets` pour une préférence jamais lue par Flask.
- Ajouter une enum sans `enumLabels` quand les valeurs sont techniques.
- Créer une clé hors préfixe `geoApp.`.
- Lire directement `AppConfig` au lieu de `get_value_or_default`.
- Ajouter un `array` ou `object` backend sans étendre la normalisation Flask.

## Exemple complet backend + frontend

Déclaration :

```json
"geoApp.checkers.exampleTimeoutMs": {
  "type": "integer",
  "minimum": 1000,
  "maximum": 120000,
  "default": 20000,
  "title": "Timeout exemple checker",
  "description": "Temps maximal d'attente pour le checker exemple.",
  "x-ui": {
    "section": "Général",
    "label": "Timeout exemple",
    "advanced": true,
    "order": 90,
    "keywords": ["checker", "timeout"]
  },
  "x-category": "checkers",
  "x-targets": ["frontend", "backend"],
  "x-tags": ["checkers"]
}
```

Lecture frontend :

```ts
const timeoutMs = this.preferenceService.get('geoApp.checkers.exampleTimeoutMs', 20000) as number;
```

Lecture backend :

```py
timeout_ms = int(get_value_or_default('geoApp.checkers.exampleTimeoutMs', 20000))
```

Validation :

```powershell
Get-Content -Raw shared/preferences/geo-preferences-schema.json | ConvertFrom-Json | Out-Null
yarn --cwd frontend/theia-extensions/preferences build
```
