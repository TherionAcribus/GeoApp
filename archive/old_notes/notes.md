# Système de Notes pour les Géocaches

## Vue d'ensemble

Le système de notes permet aux utilisateurs de gérer des annotations pour chaque géocache. Les notes sont organisées par type et affichées dans un panneau dédié dans l'interface principale.

De plus, les notes de type "personnelle" peuvent être synchronisées avec Geocaching.com, permettant ainsi de maintenir les mêmes notes entre notre application et le site officiel.

## Types de Notes

- **Note personnelle** (user) : Notes générales de l'utilisateur, peuvent être synchronisées avec Geocaching.com
- **Note système** (system) : Informations générées par le système
- **Indice** (hint) : Indices supplémentaires pour la résolution
- **Spoiler** (spoiler) : Informations révélant la solution

## Interface Utilisateur

### Panneau de Notes

Le panneau de notes est accessible depuis la barre de navigation inférieure. Il affiche :
- Le nom de la géocache sélectionnée
- Un bouton pour ajouter une nouvelle note
- La liste des notes existantes, triées par date de création (plus récentes en premier)

Chaque note affiche :
- Son type (avec code couleur)
- Sa date de création
- Son contenu
- Des boutons d'actions :
  - Synchroniser avec Geocaching.com (uniquement pour les notes personnelles)
  - Éditer
  - Supprimer

### Formulaire de Note

Le formulaire permet de :
- Sélectionner le type de note
- Saisir le contenu
- Sauvegarder ou annuler les modifications

## Synchronisation avec Geocaching.com

Les notes de type "personnelle" peuvent être envoyées vers Geocaching.com. Pour ce faire :

1. Créez une note de type "user" (personnelle)
2. Cliquez sur l'icône de synchronisation (nuage) à côté de la note
3. Confirmez l'envoi vers Geocaching.com

La synchronisation nécessite que l'utilisateur soit connecté à Geocaching.com dans Firefox. Les cookies de Firefox sont utilisés pour authentifier les requêtes vers Geocaching.com.

> **Note:** Actuellement, la synchronisation est unidirectionnelle (de l'application vers Geocaching.com). La récupération des notes depuis Geocaching.com n'est pas encore implémentée.

## Architecture Technique

### Modèles de Données

```python
class Note(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    content = db.Column(db.Text, nullable=False)
    note_type = db.Column(db.String(50), nullable=False)
    created_at = db.Column(db.DateTime)
    updated_at = db.Column(db.DateTime)
    
    geocaches = db.relationship('Geocache', secondary='geocache_note', back_populates='notes')

class GeocacheNote(db.Model):
    geocache_id = db.Column(db.Integer, db.ForeignKey('geocache.id'), primary_key=True)
    note_id = db.Column(db.Integer, db.ForeignKey('note.id'), primary_key=True)
    added_at = db.Column(db.DateTime)
```

### Routes API

- `GET /api/logs/notes_panel` : Charge le panneau de notes
- `GET /api/logs/note_form` : Charge le formulaire de note
- `POST /api/logs/geocache/<id>/notes` : Crée une nouvelle note
- `PUT /api/logs/note/<id>` : Modifie une note existante
- `DELETE /api/logs/note/<id>` : Supprime une note
- `POST /api/logs/note/<id>/send_to_geocaching` : Envoie une note vers Geocaching.com

### Composants Frontend

- **Stimulus Controller** : `notes_controller.js`
  - Gère le chargement des notes
  - Maintient la synchronisation avec la géocache sélectionnée

- **Templates** :
  - `notes_panel.html` : Structure principale du panneau
  - `note_form.html` : Formulaire d'ajout/édition
  - `note_item.html` : Affichage d'une note individuelle

### Intégration HTMX

- Chargement dynamique du contenu
- Mises à jour partielles de l'interface
- Gestion des formulaires sans rechargement
- Animations de transition

### Intégration avec Geocaching.com

L'envoi des notes vers Geocaching.com est géré par la classe `PersonalNotes` dans le module `geocaching_client.py`. Cette classe utilise les cookies Firefox pour authentifier les requêtes vers l'API de Geocaching.com.

Pour plus de détails sur l'intégration avec Geocaching.com, voir le document [geocaching_integration.md](geocaching_integration.md).

## Exemples d'Utilisation

### Ajouter une Note

1. Cliquer sur "Ajouter une note"
2. Sélectionner le type
3. Saisir le contenu
4. Cliquer sur "Ajouter"

### Modifier une Note

1. Cliquer sur l'icône d'édition
2. Modifier le contenu ou le type
3. Cliquer sur "Modifier"

### Supprimer une Note

1. Cliquer sur l'icône de suppression
2. Confirmer la suppression

### Envoyer une Note vers Geocaching.com

1. Ajouter ou modifier une note avec le type "personnelle" (user)
2. Cliquer sur l'icône de synchronisation (nuage)
3. Confirmer l'envoi
4. L'icône devient verte si l'envoi est réussi
