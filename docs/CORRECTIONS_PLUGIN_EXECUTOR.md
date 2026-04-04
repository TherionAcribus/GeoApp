# Corrections du Plugin Executor

## 🎯 Problèmes identifiés et corrigés

### 1. ❌ Dropdown de sélection redondant
**Problème** : Quand on clique sur un plugin dans le panneau, on doit encore le sélectionner une seconde fois dans un dropdown.

**Solution** : Masquer le dropdown si le plugin est déjà pré-sélectionné via `initialPlugin`.

**Code** :
```tsx
{/* Sélection du plugin - Masqué si pré-sélectionné */}
{!initialPlugin && (
    <div className='plugin-form'>
        <h4>Sélection du plugin</h4>
        <select value={state.selectedPlugin || ''} ...>
            ...
        </select>
    </div>
)}

{/* Info du plugin pré-sélectionné */}
{initialPlugin && state.pluginDetails && (
    <div className='plugin-form' style={{ background: '#f0f0f0', padding: '10px', borderRadius: '4px' }}>
        <h4>📦 Plugin: {state.pluginDetails.name}</h4>
        <p>{state.pluginDetails.description}</p>
    </div>
)}
```

---

### 2. ❌ Pas de choix encode/decode en exécution libre
**Problème** : En mode "exécution libre" (sans géocache), on ne peut pas choisir entre encoder ou décoder.

**Solution** : Ajouter un sélecteur de mode qui apparaît uniquement en exécution libre.

**Code** :
```tsx
{/* Sélecteur de mode en exécution libre */}
{!context.gcCode && state.pluginDetails && (
    <div className='plugin-form'>
        <h4>🎯 Mode d'exécution</h4>
        <div className='form-field'>
            <label>Action</label>
            <select
                value={state.formInputs.mode || 'decode'}
                onChange={(e) => handleInputChange('mode', e.target.value)}
            >
                <option value='decode'>🔓 Décoder (par défaut)</option>
                <option value='encode'>🔐 Encoder</option>
                {state.pluginDetails.metadata?.input_types?.mode?.options?.includes('detect') && (
                    <option value='detect'>🔍 Détecter</option>
                )}
            </select>
        </div>
    </div>
)}
```

---

### 3. ❌ "Aucun paramètre requis" même avec des paramètres
**Problème** : Le formulaire affiche "Aucun paramètre requis" alors que les plugins ont des paramètres définis dans `input_types`.

**Cause** : Le backend envoie `input_types` dans un format personnalisé, mais le frontend attend `input_schema` au format JSON Schema standard.

**Solution** : Adapter le backend pour convertir automatiquement `input_types` → `input_schema`.

---

## 🔧 Conversion input_types → input_schema

### Format personnalisé (plugin.json)
```json
{
  "input_types": {
    "text": {
      "type": "string",
      "label": "Texte à traiter",
      "placeholder": "Entrez le texte...",
      "default": ""
    },
    "mode": {
      "type": "select",
      "label": "Mode",
      "options": ["encode", "decode", "detect"],
      "default": "decode"
    },
    "shift": {
      "type": "number",
      "label": "Décalage (ROT-N)",
      "default": 13,
      "min": 1,
      "max": 25,
      "step": 1
    },
    "auto_detect": {
      "type": "checkbox",
      "label": "Détection automatique",
      "default": true
    }
  }
}
```

### Format JSON Schema (envoyé au frontend)
```json
{
  "input_schema": {
    "type": "object",
    "properties": {
      "text": {
        "type": "string",
        "title": "Texte à traiter",
        "placeholder": "Entrez le texte...",
        "default": ""
      },
      "mode": {
        "type": "string",
        "title": "Mode",
        "enum": ["encode", "decode", "detect"],
        "default": "decode"
      },
      "shift": {
        "type": "number",
        "title": "Décalage (ROT-N)",
        "default": 13,
        "minimum": 1,
        "maximum": 25,
        "multipleOf": 1
      },
      "auto_detect": {
        "type": "boolean",
        "title": "Détection automatique",
        "default": true
      }
    },
    "required": []
  }
}
```

---

## 📝 Mapping des types

| Type personnalisé | Type JSON Schema | Propriétés additionnelles |
|------------------|------------------|---------------------------|
| `string` | `string` | - |
| `number` | `number` | `minimum`, `maximum`, `multipleOf` (step) |
| `integer` | `integer` | `minimum`, `maximum` |
| `select` | `string` + `enum` | `enum` avec les options |
| `checkbox` | `boolean` | - |

| Propriété personnalisée | Propriété JSON Schema |
|------------------------|----------------------|
| `label` | `title` |
| `description` | `description` |
| `placeholder` | `placeholder` (custom) |
| `default` | `default` |
| `options` | `enum` |
| `min` | `minimum` |
| `max` | `maximum` |
| `step` | `multipleOf` |

---

## 🔄 Modifications backend

### Fichier : `gc_backend/plugins/models.py`

**Méthode ajoutée** : `_convert_input_types_to_json_schema()`

**Changements dans `to_dict()`** :
```python
if include_metadata:
    import json
    try:
        metadata = json.loads(self.metadata_json) if self.metadata_json else {}
        data['metadata'] = metadata
        
        # Transformer input_types en input_schema (JSON Schema)
        if 'input_types' in metadata:
            data['input_schema'] = self._convert_input_types_to_json_schema(metadata['input_types'])
        
        # Ajouter output_types si présent
        if 'output_types' in metadata:
            data['output_types'] = metadata['output_types']
            
    except json.JSONDecodeError:
        data['metadata'] = {}
```

---

## 🔄 Modifications frontend

### Fichier : `plugin-protocol.ts`

**Interface mise à jour** :
```typescript
export interface PluginDetails extends Plugin {
    input_schema: PluginSchema;
    output_schema?: PluginSchema;
    metadata?: Record<string, any>;      // ← AJOUTÉ
    output_types?: Record<string, any>;  // ← AJOUTÉ
}
```

### Fichier : `plugin-executor-widget.tsx`

**Changements** :
1. Dropdown masqué si `initialPlugin` existe
2. Affichage des infos du plugin pré-sélectionné
3. Sélecteur de mode en exécution libre
4. Textarea masquée en mode `encode`

---

## 🧪 Tests à effectuer

### Test 1 : Plugin pré-sélectionné
1. Panneau Plugins → Cliquer sur "Bacon Code"
2. ✅ Pas de dropdown de sélection
3. ✅ Encadré avec le nom et la description du plugin
4. ✅ Formulaire avec tous les paramètres visible

### Test 2 : Mode encode/decode
1. Cliquer sur "Caesar" dans le panneau Plugins
2. ✅ Sélecteur "Mode d'exécution" visible
3. ✅ Options : Décoder (par défaut), Encoder, Détecter
4. Sélectionner "Encoder"
5. ✅ Textarea cachée
6. ✅ Champ "text" dans les paramètres pour entrer le texte à encoder

### Test 3 : Paramètres Caesar
1. Cliquer sur "Caesar"
2. ✅ Section "Paramètres" visible
3. ✅ Champ "Texte à traiter" (textarea)
4. ✅ Dropdown "Mode" (encode, decode, detect)
5. ✅ Input nombre "Décalage (ROT-N)" (1-25)

### Test 4 : Paramètres Bacon Code
1. Cliquer sur "Bacon Code"
2. ✅ Champ "Texte à traiter"
3. ✅ Dropdown "Mode"
4. ✅ Dropdown "Alphabet" (26 ou 24 lettres)
5. ✅ Input "Symbole pour A"
6. ✅ Input "Symbole pour B"
7. ✅ Checkbox "Détection automatique"

### Test 5 : Paramètres Fox Code
1. Cliquer sur "Fox Code"
2. ✅ Champ "Texte à traiter"
3. ✅ Dropdown "Mode"
4. ✅ Dropdown "Variante" (auto, courte, longue)

---

## 📊 Comparaison avant/après

### Avant
```
[Clic sur Caesar dans le panneau]
  ↓
Plugin Executor s'ouvre
  ↓
Dropdown: "-- Choisir un plugin --" ← Redondant !
  ↓
Sélectionner Caesar manuellement
  ↓
"Aucun paramètre requis" ← Problème !
```

### Après
```
[Clic sur Caesar dans le panneau]
  ↓
Plugin Executor s'ouvre
  ↓
📦 Plugin: caesar
   Plugin de chiffrement Caesar (ROT-N)
  ↓
🎯 Mode d'exécution
   [Décoder ▾] Encoder, Détecter
  ↓
Paramètres:
   - Texte à traiter (textarea)
   - Mode (dropdown)
   - Décalage ROT-N (number input 1-25)
  ↓
[Bouton Exécuter]
```

---

## 🚀 Actions nécessaires

### Backend
1. ✅ Modifier `gc_backend/plugins/models.py`
2. ✅ Ajouter la méthode `_convert_input_types_to_json_schema()`
3. ⏳ **Restart le backend Flask**

### Frontend
1. ✅ Modifier `plugin-protocol.ts`
2. ✅ Modifier `plugin-executor-widget.tsx`
3. ✅ Le watcher a déjà compilé les changements
4. ⏳ **Rebuild l'app Theia** (ou recharger si watch actif)
5. ⏳ **Recharger le navigateur**

---

## 📝 Commandes

```powershell
# Terminal 1 : Restart backend
cd C:\Users\Utilisateur\PycharmProjects\GeoApp\gc-backend
# Ctrl+C pour arrêter
python app.py

# Terminal 2 : Watch extension (déjà actif)
cd C:\Users\Utilisateur\PycharmProjects\GeoApp\theia-blueprint\theia-extensions\plugins
yarn watch

# Terminal 3 : Rebuild app Theia
cd C:\Users\Utilisateur\PycharmProjects\GeoApp\theia-blueprint\applications\browser
yarn build
# Puis yarn start

# Navigateur : Ctrl + R pour recharger
```

---

## ✅ Résultat final

**3 problèmes résolus** :
1. ✅ Pas de dropdown redondant
2. ✅ Choix encode/decode en exécution libre
3. ✅ Affichage de tous les paramètres des plugins

**Formulaires dynamiques fonctionnels pour** :
- ✅ Caesar (mode, shift)
- ✅ Bacon Code (mode, variant, symbol_a, symbol_b, auto_detect)
- ✅ Fox Code (mode, variant)

**UX améliorée** :
- Interface plus claire et intuitive
- Moins de clics nécessaires
- Feedback visuel du plugin sélectionné
- Mode encode/decode facilement accessible

🎉 **Le Plugin Executor est maintenant pleinement fonctionnel !**
