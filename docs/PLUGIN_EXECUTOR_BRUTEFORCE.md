# Plugin Executor - Mode Brute-Force

## 📋 Vue d'ensemble

Le système de **brute-force** permet de tester automatiquement toutes les possibilités d'un plugin et de retourner tous les résultats triés par pertinence.

**Exemple avec Caesar :** Teste les 26 décalages possibles (ROT-1 à ROT-26) et affiche tous les résultats avec leur score de confiance.

---

## 🎯 Configuration du plugin

### Dans `plugin.json`

```json
{
  "name": "caesar",
  "brute_force": true,
  "enable_scoring": true,
  ...
}
```

**Propriétés :**
- `brute_force: true` → Active l'option dans l'interface
- `enable_scoring: true` → Active le scoring pour classer les résultats

---

## 🖥️ Interface utilisateur

### Section "Options avancées"

Quand un plugin supporte le brute-force, une nouvelle section apparaît :

```
┌─────────────────────────────────────────┐
│ 🔧 Options avancées                     │
├─────────────────────────────────────────┤
│ ☐ 💥 Utiliser le mode force brute       │
│    Teste toutes les possibilités et     │
│    retourne tous les résultats          │
│                                         │
│ ☑ 🎯 Activer le scoring automatique     │
│    Évalue et classe les résultats       │
│    par pertinence                       │
└─────────────────────────────────────────┘
```

### Checkbox Brute-force

```typescript
{state.pluginDetails.metadata?.brute_force && (
    <div className='form-field'>
        <label>
            <input
                type='checkbox'
                checked={state.formInputs.brute_force || false}
                onChange={(e) => handleInputChange('brute_force', e.target.checked)}
            />
            <span>💥 Utiliser le mode force brute</span>
        </label>
        <div className='field-description'>
            Teste toutes les possibilités et retourne tous les résultats
        </div>
    </div>
)}
```

### Checkbox Scoring

```typescript
{state.pluginDetails.metadata?.enable_scoring && (
    <div className='form-field'>
        <label>
            <input
                type='checkbox'
                checked={state.formInputs.enable_scoring !== false}
                onChange={(e) => handleInputChange('enable_scoring', e.target.checked)}
            />
            <span>🎯 Activer le scoring automatique</span>
        </label>
        <div className='field-description'>
            Évalue et classe les résultats par pertinence
        </div>
    </div>
)}
```

---

## 📤 Envoi des paramètres

Lors de l'exécution, les paramètres suivants sont envoyés au backend :

```typescript
const inputs = {
    text: "KHOOR ZRUOG",
    mode: "decode",
    brute_force: true,      // ✅ Activé par la checkbox
    enable_scoring: true    // ✅ Activé par défaut si disponible
};

await pluginsService.executePlugin('caesar', inputs);
```

---

## 📥 Format de réponse

### Réponse standard (brute-force désactivé)

```json
{
  "status": "ok",
  "summary": "1 résultat(s) généré(s)",
  "results": [
    {
      "id": "result_1",
      "text_output": "HELLO WORLD",
      "confidence": 0.95,
      "parameters": { "shift": 3 }
    }
  ]
}
```

### Réponse brute-force (26 résultats)

```json
{
  "status": "ok",
  "summary": "26 résultat(s) généré(s)",
  "results": [
    {
      "id": "result_1",
      "text_output": "HELLO WORLD",
      "confidence": 0.95,
      "parameters": { "shift": 3 }
    },
    {
      "id": "result_2",
      "text_output": "GDKKN VNQKC",
      "confidence": 0.12,
      "parameters": { "shift": 1 }
    },
    {
      "id": "result_3",
      "text_output": "IFMMP XPSME",
      "confidence": 0.08,
      "parameters": { "shift": 4 }
    },
    // ... 23 autres résultats
  ]
}
```

---

## 🎨 Affichage des résultats

### Détection automatique du mode brute-force

```typescript
const isBruteForce = sortedResults.length > 5;
```

Si plus de 5 résultats → considéré comme brute-force

### Tri par confiance

```typescript
const sortedResults = result.results ? [...result.results].sort((a, b) => {
    const confA = a.confidence ?? 0;
    const confB = b.confidence ?? 0;
    return confB - confA; // Tri décroissant
}) : [];
```

### Bannière d'information

```
┌─────────────────────────────────────────────────────┐
│ 💥 Mode force brute activé - 26 résultats trouvés  │
│    (triés par pertinence)                           │
└─────────────────────────────────────────────────────┘
```

### Affichage des résultats

```
┌─────────────────────────────────────────┐
│ #1 (décalage: 3) 🏆          🎯 95%     │
├─────────────────────────────────────────┤
│ HELLO WORLD                      [📋]   │
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│ #2 (décalage: 1)                🎯 12%  │
├─────────────────────────────────────────┤
│ GDKKN VNQKC                      [📋]   │
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│ #3 (décalage: 4)                🎯 8%   │
├─────────────────────────────────────────┤
│ IFMMP XPSME                      [📋]   │
└─────────────────────────────────────────┘

... (23 autres résultats)
```

### Mise en évidence du meilleur résultat

- **Background différent** pour le résultat #1
- **Icône trophée** 🏆 sur le meilleur résultat
- **Badge de confiance** en haut à droite de chaque résultat

---

## 💻 Code d'affichage

### Composant PluginResultDisplay

```typescript
const PluginResultDisplay: React.FC<{ result: PluginResult }> = ({ result }) => {
    // Tri par confiance
    const sortedResults = result.results ? [...result.results].sort((a, b) => {
        const confA = a.confidence ?? 0;
        const confB = b.confidence ?? 0;
        return confB - confA;
    }) : [];
    
    const isBruteForce = sortedResults.length > 5;

    return (
        <div className='result-display'>
            {/* Bannière brute-force */}
            {isBruteForce && (
                <div style={{ 
                    padding: '8px 12px', 
                    background: 'var(--theia-editor-background)', 
                    borderLeft: '3px solid var(--theia-focusBorder)',
                    marginBottom: '15px'
                }}>
                    💥 <strong>Mode force brute activé</strong> - {sortedResults.length} résultats trouvés
                </div>
            )}

            {/* Liste des résultats */}
            {sortedResults.map((item, index) => (
                <div 
                    key={item.id || index}
                    style={{ 
                        padding: '12px',
                        background: index === 0 && isBruteForce ? 
                            'var(--theia-list-hoverBackground)' : 'transparent',
                        border: '1px solid var(--theia-panel-border)',
                        borderRadius: '4px',
                        position: 'relative'
                    }}
                >
                    {/* Badge de confiance */}
                    {item.confidence !== undefined && (
                        <div style={{ 
                            position: 'absolute', 
                            top: '8px', 
                            right: '8px',
                            padding: '4px 8px',
                            background: item.confidence > 0.7 ? 
                                'var(--theia-button-background)' : 
                                'var(--theia-editor-background)',
                            borderRadius: '3px',
                            fontSize: '11px',
                            fontWeight: 'bold'
                        }}>
                            🎯 {Math.round(item.confidence * 100)}%
                        </div>
                    )}
                    
                    {/* Titre du résultat */}
                    <strong>
                        {isBruteForce ? `#${index + 1}` : 'Résultat'}
                        {item.parameters?.shift !== undefined && 
                            ` (décalage: ${item.parameters.shift})`}
                        {index === 0 && isBruteForce && ' 🏆'}
                    </strong>
                    
                    {/* Contenu */}
                    <div style={{ marginTop: '8px' }}>
                        <pre>{item.text_output}</pre>
                        <button onClick={() => copyToClipboard(item.text_output!)}>
                            📋
                        </button>
                    </div>
                </div>
            ))}
        </div>
    );
};
```

---

## 🔄 Workflow utilisateur

### Cas d'usage : Décoder un message Caesar

1. **Ouvrir le plugin Caesar** depuis le Panel Plugins
2. **Saisir le texte** : "KHOOR ZRUOG"
3. **Cocher** "💥 Utiliser le mode force brute"
4. **Cocher** "🎯 Activer le scoring automatique" (déjà coché par défaut)
5. **Cliquer** "Exécuter"
6. **Résultat** :
   - Bannière : "💥 Mode force brute activé - 26 résultats trouvés"
   - #1 (décalage: 3) 🏆 → "HELLO WORLD" 🎯 95%
   - #2 (décalage: 1) → "GDKKN VNQKC" 🎯 12%
   - ... 24 autres résultats
7. **Copier** le meilleur résultat avec le bouton 📋

---

## 🎯 Avantages

### 1. **Gain de temps**
- Teste automatiquement toutes les possibilités
- Plus besoin de tester manuellement chaque décalage

### 2. **Scoring intelligent**
- Les résultats sont triés par pertinence
- Le meilleur résultat est mis en évidence

### 3. **Visibilité complète**
- Tous les résultats sont affichés
- Possibilité de voir les alternatives

### 4. **UX claire**
- Bannière explicite en mode brute-force
- Badge de confiance sur chaque résultat
- Trophée sur le meilleur résultat

---

## 🧪 Tests

### Test 1 : Caesar avec brute-force

```bash
# Ouvrir Caesar
# Texte : "KHOOR ZRUOG"
# Cocher brute-force
# Exécuter

✅ Vérifier : 26 résultats affichés
✅ Vérifier : Triés par confiance (décroissant)
✅ Vérifier : Meilleur résultat = "HELLO WORLD"
✅ Vérifier : Badge 🏆 sur le #1
✅ Vérifier : Bannière "Mode force brute activé"
```

### Test 2 : Bacon avec brute-force

```bash
# Ouvrir Bacon Code
# Texte : "AAABBAAABBAABBA"
# Cocher brute-force
# Exécuter

✅ Vérifier : Plusieurs résultats affichés
✅ Vérifier : Scoring appliqué
✅ Vérifier : Paramètres affichés (variant, symboles)
```

### Test 3 : Plugin sans brute-force

```bash
# Ouvrir un plugin sans brute_force: true
# Vérifier : Section "Options avancées" absente
# OU : Seulement checkbox scoring visible
```

---

## 📚 Plugins supportant le brute-force

D'après l'analyse du code :

1. **caesar** ✅
   - Teste les 26 décalages (ROT-1 à ROT-26)
   - Scoring basé sur la fréquence des lettres

2. **bacon_code** ✅
   - Teste différentes variantes d'alphabet
   - Détection automatique des symboles

3. **fox_code** ✅
   - Teste différentes configurations

---

## 🔧 Implémentation backend

Le backend doit implémenter une fonction `bruteforce()` ou gérer le paramètre `brute_force: true` :

```python
def execute(inputs):
    if inputs.get('brute_force', False):
        # Mode brute-force : tester toutes les possibilités
        results = []
        for shift in range(1, 26):
            result = decode_with_shift(inputs['text'], shift)
            confidence = calculate_confidence(result)
            results.append({
                'id': f'result_{shift}',
                'text_output': result,
                'confidence': confidence,
                'parameters': {'shift': shift}
            })
        
        # Trier par confiance si scoring activé
        if inputs.get('enable_scoring', True):
            results.sort(key=lambda x: x['confidence'], reverse=True)
        
        return {
            'status': 'ok',
            'summary': f'{len(results)} résultat(s) généré(s)',
            'results': results
        }
    else:
        # Mode normal : un seul résultat
        shift = inputs.get('shift', 13)
        result = decode_with_shift(inputs['text'], shift)
        return {
            'status': 'ok',
            'summary': '1 résultat(s) généré(s)',
            'results': [{
                'id': 'result_1',
                'text_output': result,
                'confidence': 1.0,
                'parameters': {'shift': shift}
            }]
        }
```

---

## ✅ Résumé

Le système de brute-force est maintenant **complètement intégré** dans le Plugin Executor :

1. ✅ **Checkbox** "Mode force brute" si disponible
2. ✅ **Envoi** du paramètre `brute_force: true`
3. ✅ **Tri** automatique par confiance
4. ✅ **Affichage** adapté avec bannière et badges
5. ✅ **Mise en évidence** du meilleur résultat
6. ✅ **Copie** facile de chaque résultat

**Prochaine étape :** Tester avec Caesar et vérifier que les 26 résultats sont bien affichés et triés ! 🚀

