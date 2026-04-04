# Améliorations UX du Plugin Executor

## 🎯 Problème résolu

**Problème initial** :
- Le formulaire dynamique ne s'affichait qu'après sélection du plugin
- L'utilisateur ne pouvait pas modifier le texte de l'énigme
- Les données de la géocache n'étaient pas visibles/modifiables
- Le backend recevait `inputs: []` (vide) au lieu des données du formulaire

**Solution implémentée** :
- Champ textarea **toujours visible** en haut du widget
- Pré-rempli automatiquement avec la description de la géocache
- **Modifiable par l'utilisateur** avant l'exécution du plugin
- Les balises HTML sont automatiquement retirées

---

## 📝 Interface améliorée

### Avant
```
┌─────────────────────────────────────────────┐
│ GC123AB - Mystery Cache                    │
│ 📍 N 48° 51.400 E 002° 21.050             │
├─────────────────────────────────────────────┤
│ Plugin: [Sélectionner ▾]                   │
│                                             │
│ (Rien d'autre tant qu'on n'a pas sélectionné)
└─────────────────────────────────────────────┘
```

### Après
```
┌─────────────────────────────────────────────┐
│ GC123AB - Mystery Cache                    │
│ 📍 N 48° 51.400 E 002° 21.050             │
├─────────────────────────────────────────────┤
│ 📝 Texte à analyser                        │
│ ┌───────────────────────────────────────┐   │
│ │ Le code secret est ABC...            │   │
│ │ Les coordonnées finales sont...      │   │
│ │                                       │   │
│ │ (Modifiable)                          │   │
│ │                                       │   │
│ └───────────────────────────────────────┘   │
├─────────────────────────────────────────────┤
│ Plugin: [Caesar ▾]                         │
│                                             │
│ Paramètres                                  │
│ ┌───────────────────────────────────────┐   │
│ │ Shift: [13_________________________]  │   │
│ │ Mode:  ⦿ Encoder  ○ Décoder          │   │
│ └───────────────────────────────────────┘   │
│                                             │
│ ⦿ Synchrone  ○ Asynchrone  [Exécuter]     │
└─────────────────────────────────────────────┘
```

---

## 🔧 Modifications techniques

### 1. Ajout du champ textarea fixe

**Fichier** : `plugin-executor-widget.tsx`

**Nouveau champ ajouté avant la sélection du plugin** :
```tsx
<div className='plugin-form'>
    <h4>📝 Texte à analyser</h4>
    <div className='form-field'>
        <label>
            Description / Énigme
            <span>(Modifiez le texte avant d'exécuter le plugin)</span>
        </label>
        <textarea
            value={state.formInputs.text || ''}
            onChange={(e) => handleInputChange('text', e.target.value)}
            rows={8}
            placeholder="Collez ici le texte à analyser ou extraire de l'énigme..."
        />
    </div>
</div>
```

### 2. Initialisation automatique

**Au montage du widget** :
```typescript
React.useEffect(() => {
    loadPlugins();
    
    // Pré-remplir avec description → hint → coordonnées
    const initialText = context.description || context.hint || context.coordinates?.coordinatesRaw || '';
    if (initialText) {
        // Retirer les balises HTML
        const div = document.createElement('div');
        div.innerHTML = initialText;
        const textContent = div.textContent || div.innerText || initialText;
        
        setState(prev => ({
            ...prev,
            formInputs: { ...prev.formInputs, text: textContent }
        }));
    }
}, []);
```

### 3. Fusion intelligente des inputs

**Lors du chargement d'un plugin** :
```typescript
const loadPluginDetails = async (pluginName: string) => {
    const details = await pluginsService.getPlugin(pluginName);
    const initialInputs = generateInitialInputs(details);
    
    setState(prev => ({
        ...prev,
        pluginDetails: details,
        // Fusionner SANS écraser le texte déjà modifié
        formInputs: { ...initialInputs, ...prev.formInputs },
        result: null,
        error: null
    }));
};
```

**Ordre de priorité** :
1. Les inputs déjà présents (texte modifié par l'utilisateur) → **priorité maximale**
2. Les valeurs par défaut du schéma du plugin
3. Les valeurs vides selon le type

---

## 🎬 Workflow utilisateur

### Cas d'usage typique

1. **Ouvrir une Mystery Cache** :
   - Cliquer sur une géocache dans le Zones Tree
   - Le widget GeocacheDetailsWidget s'ouvre

2. **Analyser avec plugins** :
   - Cliquer sur "🔌 Analyser avec plugins"
   - Le Plugin Executor s'ouvre avec :
     - GC code et nom de la cache
     - Coordonnées affichées
     - **Description de la cache dans le textarea**

3. **Modifier le texte** :
   - L'utilisateur voit : "Le code secret est ABC123 et les coordonnées finales..."
   - Il sélectionne et garde seulement : "ABC123"
   - Ou colle un autre texte extrait de l'énigme

4. **Sélectionner un plugin** :
   - Choisir "Caesar" dans la liste
   - Les paramètres du plugin apparaissent (shift, mode)
   - **Le texte modifié reste intact**

5. **Ajuster les paramètres** :
   - Shift = 13
   - Mode = Encoder

6. **Exécuter** :
   - Cliquer "Exécuter"
   - Le plugin reçoit : `{ "text": "ABC123", "shift": 13, "mode": "encode" }`
   - Le résultat s'affiche : "NOP123"

---

## 🔍 Débogage

### Logs console ajoutés

Lors de l'exécution, vérifier dans la console navigateur (F12) :

```javascript
=== DEBUG Plugin Executor ===
Plugin sélectionné: caesar
Inputs du formulaire: {
  text: "ABC123",
  shift: 13,
  mode: "encode"
}
Schéma du plugin: {
  type: "object",
  properties: {
    text: { type: "string", title: "Texte" },
    shift: { type: "integer", default: 13 },
    mode: { type: "string", enum: ["encode", "decode"], default: "encode" }
  }
}
```

### Backend Flask

Vérifier les logs Flask :

```
2025-11-02 17:XX:XX.XXX | INFO | Exécution du plugin caesar
2025-11-02 17:XX:XX.XXX | DEBUG | Exécution du plugin caesar avec inputs: {'text': 'ABC123', 'shift': 13, 'mode': 'encode'}
```

**Si `inputs: []`** :
- Le formulaire n'envoie pas les données
- Vérifier les logs console pour voir `state.formInputs`
- Vérifier que `handleInputChange` est bien appelé

---

## 📊 Avantages de cette approche

### 1. **Toujours visible et modifiable**
- L'utilisateur voit immédiatement le texte de l'énigme
- Peut le modifier avant même de choisir un plugin
- Gain de temps dans le workflow

### 2. **Flexibilité**
- Supprimer les parties inutiles du texte
- Isoler seulement le code secret
- Coller un texte externe
- Combiner plusieurs sources

### 3. **Transparence**
- L'utilisateur voit exactement ce qui sera envoyé au plugin
- Pas de surprise sur les données transmises
- Facilite le débogage

### 4. **Compatibilité**
- Le champ `text` est standard pour tous les plugins de cryptographie
- Fonctionne avec Caesar, ROT13, Vigenère, etc.
- Si un plugin n'a pas de champ `text`, le formulaire dynamique prend le relais

---

## 🚀 Prochaines améliorations possibles

### 1. **Détection automatique du texte pertinent**
- Parser la description HTML pour extraire automatiquement les codes
- Détecter les patterns (ex: suite de lettres majuscules)
- Proposer des suggestions

### 2. **Historique des textes**
- Garder un historique local des textes analysés
- Bouton "Textes récents"
- Réutiliser rapidement un texte précédent

### 3. **Formats multiples**
- Bouton "Utiliser les coordonnées" pour remplir avec les coords
- Bouton "Utiliser le hint" pour remplir avec l'indice
- Bouton "Tout nettoyer" pour vider le champ

### 4. **Pré-traitement**
- Bouton "Retirer espaces"
- Bouton "Majuscules seulement"
- Bouton "Nombres seulement"
- Compter les caractères

### 5. **Drag & Drop**
- Permettre de glisser-déposer un fichier texte
- Ou une image avec OCR pour extraire le texte

---

## 📋 Fichiers modifiés

- ✅ `theia-extensions/plugins/src/browser/plugin-executor-widget.tsx`
  - Ajout du champ textarea fixe
  - Initialisation automatique avec la description
  - Fusion intelligente des inputs
  - Logs de débogage

---

## 🎉 Résultat

**Avant** : ❌ Formulaire vide, inputs non envoyés, frustration

**Après** : ✅ Texte visible, modifiable, workflow fluide, plugins fonctionnels

L'utilisateur peut maintenant **extraire, modifier et analyser** le texte des énigmes de manière intuitive et efficace ! 🎯
