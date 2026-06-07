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

## Limitations (MVP)

- Analyse Lua basée sur des expressions régulières (pas de parser complet)
- Détection des réponses limitée aux patterns courants
- Désobfuscation non implémentée (détection uniquement)
- Hash Urwigo non cracké

## Tests

```bash
cd plugins/custom/wherigo_analyzer
python -m pytest tests/ -v
```

## Licence

Ce plugin est développé indépendamment et ne contient pas de code de GC Wizard.
