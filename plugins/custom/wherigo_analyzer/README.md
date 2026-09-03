# Wherigo Analyzer Plugin

Plugin d'analyse de cartouches Wherigo pour GeoApp/MysterAI.

## Description

Ce plugin permet d'analyser les cartouches Wherigo (fichiers `.gwc`) et les scripts Lua décompilés pour en extraire :
- Les métadonnées (nom, GUID, description, auteur, completion code)
- Les zones géographiques avec leurs coordonnées
- Les médias (images, sons)
- Les inputs et leurs réponses probables
- Les messages et dialogs
- Les objets (personnages, items, tâches, timers)

## Installation

Le plugin se trouve dans `plugins/custom/wherigo_analyzer/`.

Pas de dépendances externes requises pour le MVP.

Pour la décompilation Lua optionnelle :
- Java doit être installé et accessible dans le PATH
- Télécharger [unluac.jar](https://sourceforge.net/projects/unluac/) et placer le fichier dans :
  - Un chemin configuré via la variable d'environnement `WHERIGO_UNLUAC_PATH`
  - Ou dans `~/bin/unluac.jar`, `~/.local/bin/unluac.jar`, ou `./unluac.jar`

## Utilisation

### Via l'interface

Dans le Plugin Executor, le champ **Cartouche Wherigo** propose une zone de dépôt : cliquez dessus pour ouvrir le sélecteur de fichiers, ou glissez-déposez directement un `.gwc` / `.lua` (50 Mo max). Le nom du fichier est repris automatiquement.

Le champ **Chemin du fichier (optionnel)** reste disponible pour analyser un fichier déjà présent sur le serveur ; il est ignoré dès qu'un fichier est déposé.

### Via l'API

```json
POST /api/plugins/wherigo_analyzer/execute
{
  "file_path": "/path/to/cartridge.gwc"
}
```

Ou avec contenu base64 :

```json
{
  "file_content": "base64encodedcontent...",
  "filename": "cartridge.gwc"
}
```

### Modes d'analyse

- `auto` (défaut) : Détection automatique du type de fichier
- `gwc` : Force l'analyse comme fichier GWC
- `lua` : Force l'analyse comme script Lua

## Structure de sortie

```json
{
  "status": "ok|partial|error",
  "summary": "Résumé de l'analyse",
  "wherigo_data": {
    "source": {
      "filename": "cartridge.gwc",
      "type": "gwc|lua",
      "status": "ok|partial|error",
      "warnings": [],
      "errors": []
    },
    "cartridge": {
      "name": "Nom de la cartouche",
      "guid": "12345678-1234-1234-1234-123456789abc",
      "description": "Description...",
      "author": "Auteur",
      "completion_code": "CODE123",
      "start": {"lat": 48.8566, "lon": 2.3522}
    },
    "lua": {
      "available": true,
      "bytecode_extracted": true,
      "decompiled": true,
      "decompiler": "unluac"
    },
    "zones": [
      {
        "internal_name": "zoneFinal",
        "name": "Zone Finale",
        "original_point": {"lat": 48.8566, "lon": 2.3522},
        "points": []
      }
    ],
    "inputs": [
      {
        "internal_name": "inputCode",
        "name": "Entrez le code",
        "answers": [
          {"value": "1234", "method": "plain_text", "confidence": "high"}
        ]
      }
    ],
    "media": [],
    "messages": [],
    "geojson": {
      "type": "FeatureCollection",
      "features": []
    }
  }
}
```

## Décompilation Lua

Le plugin tente automatiquement de décompiler le bytecode Lua contenu dans les fichiers `.gwc` si `unluac.jar` est disponible.

Si Java ou unluac.jar n'est pas trouvé, le plugin fonctionne en mode dégradé :
- Extraction des métadonnées et médias du `.gwc`
- Analyse possible d'un fichier `.lua` déjà décompilé

## Désobfuscation Urwigo

Le plugin détecte et décode automatiquement les chaînes obfusquées par Urwigo :

1. **Détection de la fonction de décodage** : identifie la fonction Urwigo (ex: `_NsWY`, `_pJ4N`) et sa table de substitution (`dtable`).
2. **Extraction de la dtable** : parse la chaîne Lua avec ses séquences d'échappement (décimal `\ddd`, hexadécimal `\xNN`, et escapes simples `\a\b\f\n\r\t\v`).
3. **Décodage par substitution** : applique le mapping `dtable[byte]` pour chaque byte 1-127, en préservant les bytes > 127.
4. **Remplacement dans le source** : remplace tous les appels `func("...")` par leur valeur décodée.

### Séquences d'échappement Lua

**Important** : Lua utilise des escapes **décimaux** (`\ddd`), contrairement au C qui utilise de l'octal. Par exemple `\019` est valide en Lua (décimal 19) mais invalide en octal C. Le décodeur gère correctement cette spécificité.

### Réponses hashées Urwigo

Les réponses protégées par `_Urwigo.Hash(string.lower(input)) == valeur` sont :
- Détectées dans les callbacks `OnGetInput`
- Comparées avec les choices de l'input pour trouver une correspondance directe
- Si une correspondance est trouvée, la réponse est marquée avec `confidence: "high"` et `method: "urwigo_hash_matched_choice"`
- Sinon, un brute-force est effectué et les candidats sont fournis avec `confidence: "low"`

## Limitations

- Analyse Lua basée sur des expressions régulières (pas de parser Lua complet)
- Les concaténations de variables (`Text = var1 .. var2 .. ...`) ne sont pas résolues
- Les long-bracket strings `[[...]]` ne sont pas supportés
- Détection des réponses limitée aux patterns courants (comparaisons directes, NoCaseEquals, hash Urwigo)

## Tests

```bash
cd plugins/custom/wherigo_analyzer
python -m pytest tests/ -v
```

Les tests incluent :
- `test_lua_analyzer.py` : tests unitaires sur un fixture Lua simple
- `test_wherigo_analyzer.py` : tests d'intégration du plugin complet
- `test_urwigo_deobfuscation.py` : tests de désobfuscation Urwigo avec fixtures réelles (mozarts_salzburg, i_love_salzburg)

### Fixtures de test

Les fixtures `tests/fixtures/mozarts_salzburg.lua` et `tests/fixtures/i_love_salzburg.lua` sont générées à partir de cartouches réelles via `unluac`. Elles permettent de valider :
- Le décodage Urwigo (127 bytes dtable, strings lisibles)
- L'extraction des zones, médias, inputs, messages
- La résolution des réponses hashées par comparaison avec les choices

## Licence

Ce plugin est développé indépendamment et ne contient pas de code de GC Wizard.
