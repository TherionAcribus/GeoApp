# Guide d'utilisation - Waypoints Éditables

## 🎯 Vue d'ensemble

Les waypoints sont maintenant entièrement éditables directement depuis les détails d'une géocache. Vous pouvez ajouter, modifier et supprimer des waypoints, ainsi qu'utiliser des outils de calcul géographique avancés.

## 📍 Ajouter un waypoint

### Méthode simple
1. Ouvrez les détails d'une géocache
2. Descendez jusqu'à la section "Waypoints"
3. Cliquez sur le bouton **"+ Ajouter un waypoint"**
4. Remplissez les champs :
   - **Préfixe** : Ex: "WP", "PK", "QA"
   - **Lookup** : Code du waypoint (ex: "GC12345-01")
   - **Nom** : Description du waypoint
   - **Type** : Parking, Question, Final, etc.
   - **Coordonnées** : Format GC (N 48° 51.402, E 002° 21.048)
   - **Note** : Informations complémentaires
5. Cliquez sur **"Sauvegarder"**

### Avec calculs géographiques
Lors de l'ajout ou de la modification, vous avez accès à deux outils de calcul :

#### 🌍 Calcul d'antipode
L'antipode est le point diamétralement opposé sur Terre.

**Exemple d'utilisation :**
- Coordonnées de départ : N 48° 51.402, E 002° 21.048 (Paris)
- Antipode calculé : S 48° 51.402, W 177° 38.952 (Pacifique Sud)

**Comment faire :**
1. Entrez les coordonnées de départ
2. Cliquez sur **"Calculer l'antipode"**
3. Le résultat s'affiche dans le champ "Résultat"
4. Cliquez sur **"Appliquer"** pour l'utiliser

#### 📐 Calcul de projection
Calculez un point à une distance et un angle donnés.

**Paramètres :**
- **Distance** : Valeur numérique (ex: 100)
- **Unité** : mètres, kilomètres ou miles
- **Angle** : 0-359° (0° = Nord, 90° = Est, 180° = Sud, 270° = Ouest)

**Exemple :**
- Point de départ : N 48° 51.402, E 002° 21.048
- Distance : 500 mètres
- Angle : 45° (Nord-Est)
- Résultat : Point situé à 500m au Nord-Est

**Comment faire :**
1. Entrez les coordonnées de départ
2. Configurez distance, unité et angle
3. Cliquez sur **"Calculer la projection"**
4. Cliquez sur **"Appliquer"** pour utiliser le résultat

## ✏️ Modifier un waypoint

1. Dans la liste des waypoints, cliquez sur l'icône **✏️** (crayon)
2. Le formulaire d'édition s'ouvre avec les données actuelles
3. Modifiez les champs souhaités
4. Vous pouvez recalculer les coordonnées si nécessaire
5. Cliquez sur **"Sauvegarder"** ou **"Annuler"**

## 🗑️ Supprimer un waypoint

1. Dans la liste des waypoints, cliquez sur l'icône **🗑️** (poubelle)
2. Confirmez la suppression
3. Le waypoint est immédiatement supprimé

## 🧭 Exemples d'utilisation pratiques

### Cas 1 : Waypoint de parking
```
Préfixe: PK
Nom: Parking principal
Type: Parking
Coordonnées: N 48° 51.402, E 002° 21.048
Note: Parking gratuit, 20 places
```

### Cas 2 : Question avec projection
Vous devez trouver un point à 150m au Nord d'un panneau :
1. Entrez les coordonnées du panneau
2. Distance : 150, Unité : mètres, Angle : 0°
3. Calculez et appliquez
4. Sauvegardez le waypoint

### Cas 3 : Point final calculé
L'énigme donne : "Allez à 2.5km à l'Ouest du point de départ"
1. Coordonnées de départ : celles de la géocache
2. Distance : 2.5, Unité : kilomètres, Angle : 270°
3. Calculez et appliquez
4. Type : Final
5. Sauvegardez

## 📊 Angles de référence

```
        0° (Nord)
           |
           |
270° ------+------ 90°
(Ouest)    |    (Est)
           |
        180° (Sud)
```

**Angles intermédiaires :**
- 45° : Nord-Est
- 135° : Sud-Est
- 225° : Sud-Ouest
- 315° : Nord-Ouest

## 💡 Astuces

### Format des coordonnées
Le système accepte le format Geocaching standard :
- Latitude : `N 48° 51.402` ou `S 48° 51.402`
- Longitude : `E 002° 21.048` ou `W 002° 21.048`

### Conversion automatique
Lorsque vous appliquez des coordonnées calculées, elles sont automatiquement converties en format décimal pour la base de données.

### Coordonnées pré-remplies
Lors de l'ajout d'un nouveau waypoint, les coordonnées de la géocache sont automatiquement pré-remplies comme point de départ.

### Calculs en chaîne
Vous pouvez :
1. Calculer une projection
2. Appliquer le résultat
3. Recalculer une nouvelle projection depuis ce point
4. Etc.

### Notes détaillées
Utilisez le champ "Note" pour :
- Décrire le waypoint
- Noter les indices trouvés
- Ajouter les détails de calcul
- Mémoriser les étapes de résolution

## ⚠️ Points d'attention

- **Un seul waypoint éditable à la fois** : Vous ne pouvez éditer qu'un waypoint à la fois
- **Sauvegarde manuelle** : N'oubliez pas de cliquer sur "Sauvegarder"
- **Confirmation de suppression** : La suppression est définitive après confirmation
- **Format des coordonnées** : Respectez le format GC (avec °)

## 🔄 Workflow typique de résolution

1. **Import de la géocache** avec ses waypoints existants
2. **Ajout de waypoints personnels** pour vos découvertes
3. **Calculs intermédiaires** avec les outils de projection
4. **Modification progressive** au fur et à mesure de la résolution
5. **Waypoint final** avec les coordonnées corrigées

## 🎓 Exemples de calculs courants

### Distance en pas
1 pas ≈ 0.75m
- 100 pas = 75m
- 200 pas = 150m

### Conversions d'unités
- 1 km = 1000 m
- 1 mile = 1609.34 m
- 1 mile nautique = 1852 m

### Angles cardinaux
- Nord : 0° ou 360°
- Est : 90°
- Sud : 180°
- Ouest : 270°

## 📞 Support

En cas de problème :
1. Vérifiez le format des coordonnées
2. Consultez les logs du backend
3. Rechargez la page si nécessaire
4. Vérifiez que le backend est démarré (port 8000)

---

**Bonne chasse aux géocaches ! 🏆**
