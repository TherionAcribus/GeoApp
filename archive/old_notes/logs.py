from datetime import datetime, timezone
from flask import Blueprint, jsonify, request, render_template, make_response
import json
from app.database import db
from app.models import Note, Geocache, GeocacheNote
from app.geocaching_client import GeocachingClient, PersonalNotes, GeocachingLogs
import logging

logs_bp = Blueprint('logs', __name__, url_prefix='/api/logs')


def respond_with_notification(payload: dict, body: dict, status: int = 200):
    """Retourne une réponse JSON avec en-tête HTMX HX-Trigger pour AppNotify."""
    response = make_response(jsonify(body), status)
    try:
        response.headers['HX-Trigger'] = json.dumps({'app:notify': payload})
    except Exception:
        # Ne pas bloquer la réponse si la sérialisation échoue
        pass
    return response

@logs_bp.route('/note/<note_id>/send_to_geocaching', methods=['POST'])
def send_note_to_geocaching(note_id):
    """Envoie une note à Geocaching.com en tant que note personnelle"""
    try:
        # Récupérer la note et la géocache associée
        note = Note.query.get_or_404(note_id)
        geocache_id = request.args.get('geocacheId')
        
        if not geocache_id:
            # Essayer de trouver la géocache via la relation
            geocache_note = GeocacheNote.query.filter_by(note_id=note_id).first()
            if not geocache_note:
                return jsonify({
                    'success': False,
                    'error': 'Impossible de trouver la géocache associée à cette note'
                }), 400
            geocache_id = geocache_note.geocache_id
            
        geocache = Geocache.query.get_or_404(geocache_id)
        
        # Vérifier que la note est de type 'user'
        if note.note_type != 'user':
            return jsonify({
                'success': False,
                'error': 'Seules les notes personnelles peuvent être envoyées à Geocaching.com'
            }), 400
        
        # Vérifier que la géocache a un GC code
        if not geocache.gc_code:
            return jsonify({
                'success': False,
                'error': 'Cette géocache n\'a pas de code GC valide'
            }), 400
            
        # Créer le client Geocaching et vérifier que l'utilisateur est connecté
        client = GeocachingClient()
        if not client.ensure_login():
            return respond_with_notification(
                { 'level': 'error', 'message': "Impossible de se connecter à Geocaching.com. Assurez-vous d'être connecté dans Firefox.", 'ttl': 7000 },
                { 'success': False, 'error': "Impossible de se connecter à Geocaching.com. Assurez-vous d'être connecté dans Firefox." },
                401
            )
            
        # Créer l'instance de PersonalNotes et envoyer la note
        personal_notes = PersonalNotes(client)
        if personal_notes.update(geocache.gc_code, note.content):
            return respond_with_notification(
                { 'level': 'success', 'message': 'Note envoyée avec succès à Geocaching.com', 'ttl': 5000 },
                { 'success': True, 'message': 'Note envoyée avec succès à Geocaching.com' },
                200
            )
        else:
            return respond_with_notification(
                { 'level': 'error', 'message': "Échec de l'envoi de la note à Geocaching.com", 'ttl': 7000 },
                { 'success': False, 'error': "Échec de l'envoi de la note à Geocaching.com" },
                500
            )
            
    except Exception as e:
        logging.error(f"Erreur lors de l'envoi de la note vers Geocaching.com: {str(e)}")
        return respond_with_notification(
            { 'level': 'error', 'message': f"Erreur lors de l'envoi de la note: {str(e)}", 'ttl': 7000 },
            { 'success': False, 'error': str(e) },
            500
        )

@logs_bp.route('/notes_panel')
def get_notes_panel():
    """Renvoie le template du panneau de notes."""
    geocache_id = request.args.get('geocacheId')
    if geocache_id:
        geocache = Geocache.query.get_or_404(geocache_id)
        notes = geocache.notes
        return render_template('notes_panel.html', 
                            notes=notes,
                            geocache_id=geocache_id,
                            geocache=geocache,
                            geocache_name=geocache.name)
    return render_template('notes_panel.html', notes=[], geocache_id=None, geocache=None)

@logs_bp.route('/logs_panel')
def get_logs_panel():
    """Renvoie le template du panneau des logs."""
    geocache_id = request.args.get('geocacheId')
    if geocache_id:
        geocache = Geocache.query.get_or_404(geocache_id)
        # Pour l'instant, utilisons les logs de la géocache directement
        logs = geocache.logs if hasattr(geocache, 'logs') else []
        return render_template('logs_panel.html', 
                            logs=logs,
                            geocache_id=geocache_id,
                            geocache_name=geocache.name)
    return render_template('logs_panel.html', logs=[], geocache_id=None)

@logs_bp.route('/map_panel')
def get_map_panel():
    """Render the map panel template"""
    geocache_id = request.args.get('geocacheId')
    
    if geocache_id:
        geocache = Geocache.query.get(geocache_id)
        if geocache:
            return render_template('map_panel.html', 
                                geocache=geocache,
                                geocache_id=geocache_id)
    
    return render_template('map_panel.html', 
                         geocache=None,
                         geocache_id=None)

@logs_bp.route('/geocache/<geocache_id>/notes', methods=['GET', 'POST'])
def geocache_notes(geocache_id):
    """Gère les notes d'une géocache."""
    geocache = Geocache.query.get_or_404(geocache_id)
    
    if request.method == 'POST':
        # Création d'une nouvelle note
        note_data = request.form
        new_note = Note(
            content=note_data.get('content'),
            note_type=note_data.get('note_type'),
            created_at=datetime.now(timezone.utc)
        )
        db.session.add(new_note)
        geocache.notes.append(new_note)  # Ajoute la note à la géocache
        db.session.commit()
        
        # Renvoie tout le panneau de notes mis à jour
        notes = Note.query.join(GeocacheNote).filter(GeocacheNote.geocache_id == geocache_id).order_by(Note.created_at.desc()).all()
        return render_template('notes_panel.html',
                            notes=notes,
                            geocache_id=geocache_id,
                            geocache=geocache,
                            geocache_name=geocache.name)
        
    # GET: renvoie toutes les notes
    notes = Note.query.join(GeocacheNote).filter(GeocacheNote.geocache_id == geocache_id).order_by(Note.created_at.desc()).all()
    return render_template('notes_panel.html', 
                         notes=notes, 
                         geocache_id=geocache_id,
                         geocache=geocache,
                         geocache_name=geocache.name)

@logs_bp.route('/note_form')
def get_note_form_template():
    """Renvoie le template du formulaire de note."""
    note_id = request.args.get('note_id')
    geocache_id = request.args.get('geocacheId')
    
    note = None
    if note_id:
        note = Note.query.get_or_404(note_id)
        # Récupérer l'ID de la géocache via la table d'association
        geocache_note = GeocacheNote.query.filter_by(note_id=note_id).first()
        if geocache_note:
            geocache_id = geocache_note.geocache_id
    
    return render_template('note_form.html', 
                         note=note,
                         geocache_id=geocache_id)

@logs_bp.route('/note/<note_id>', methods=['PUT', 'DELETE'])
def manage_note(note_id):
    """Gère la modification et la suppression d'une note."""
    note = Note.query.get_or_404(note_id)
    geocache_note = GeocacheNote.query.filter_by(note_id=note_id).first()
    geocache_id = geocache_note.geocache_id if geocache_note else None
    
    if request.method == 'DELETE':
        db.session.delete(note)
        db.session.commit()
        
        # Après la suppression, renvoyer le panneau de notes mis à jour
        if geocache_id:
            geocache = Geocache.query.get_or_404(geocache_id)
            notes = Note.query.join(GeocacheNote).filter(GeocacheNote.geocache_id == geocache_id).order_by(Note.created_at.desc()).all()
            return render_template('notes_panel.html',
                                notes=notes,
                                geocache_id=geocache_id,
                                geocache=geocache,
                                geocache_name=geocache.name)
        return '', 204
        
    # PUT: modification de la note
    data = request.form
    note.content = data.get('content')
    note.note_type = data.get('note_type')
    note.updated_at = datetime.now(timezone.utc)
    db.session.commit()
    
    # Renvoie tout le panneau de notes mis à jour
    geocache = Geocache.query.get_or_404(geocache_id)
    notes = Note.query.join(GeocacheNote).filter(GeocacheNote.geocache_id == geocache_id).order_by(Note.created_at.desc()).all()
    return render_template('notes_panel.html',
                        notes=notes,
                        geocache_id=geocache_id,
                        geocache=geocache,
                        geocache_name=geocache.name)

@logs_bp.route('/refresh', methods=['POST'])
def refresh_logs():
    """Récupère les logs frais depuis Geocaching.com et les enregistre en base de données."""
    geocache_id = request.args.get('geocacheId')
    logging.info(f"Tentative de rafraîchissement des logs pour la géocache ID: {geocache_id}")
    
    if not geocache_id:
        logging.error("Aucun ID de géocache fourni")
        return "Identifiant de géocache manquant", 400
    
    # Récupérer la géocache
    geocache = Geocache.query.get_or_404(geocache_id)
    gc_code = geocache.gc_code
    logging.info(f"Géocache trouvée: {gc_code} - {geocache.name}")
    
    # Créer une instance du client Geocaching
    client = GeocachingClient()
    
    # Vérifier si le client est connecté
    if not client.ensure_login():
        logging.error("Impossible de se connecter à Geocaching.com via Firefox")
        return render_template('logs_panel.html', 
                            logs=geocache.logs,
                            geocache_id=geocache_id,
                            geocache_name=geocache.name,
                            error="Impossible de se connecter à Geocaching.com. Assurez-vous d'être connecté dans Firefox.")
    
    # Récupérer les logs depuis l'API
    logs_api = GeocachingLogs(client)
    try:
        logging.info(f"Récupération des logs pour {gc_code}")
        gc_logs = logs_api.get_logs(gc_code, log_type="ALL", count=20)
        logging.info(f"Nombre de logs récupérés: {len(gc_logs) if gc_logs else 0}")
        
        if not gc_logs:
            logging.warning(f"Aucun log trouvé pour {gc_code}")
            return render_template('logs_panel.html', 
                                logs=geocache.logs,
                                geocache_id=geocache_id,
                                geocache_name=geocache.name,
                                error="Aucun log trouvé pour cette géocache sur Geocaching.com")
        
        # Supprimer les anciens logs
        from app.models.geocache import Log, Owner
        from app import db
        
        # Enregistrer les nouveaux logs
        existing_logs_by_id = {log.id: log for log in geocache.logs if hasattr(log, 'id')}
        
        for gc_log in gc_logs:
            # Vérifier si le log existe déjà par son ID
            log_id = gc_log.get('id')
            
            if log_id in existing_logs_by_id:
                # Mettre à jour le log existant
                log = existing_logs_by_id[log_id]
                logging.info(f"Mise à jour du log existant: {log_id}")
            else:
                # Créer un nouveau log
                log = Log()
                log.id = log_id
                logging.info(f"Création d'un nouveau log: {log_id}")
                
                # Trouver ou créer l'auteur du log
                author_name = gc_log.get('author')
                if author_name:
                    author = Owner.query.filter_by(name=author_name).first()
                    if not author:
                        # Pas besoin du paramètre guid qui n'existe pas dans le modèle Owner
                        author = Owner(name=author_name)
                        db.session.add(author)
                        logging.info(f"Création d'un nouvel auteur: {author_name}")
                    log.author = author
                
                geocache.logs.append(log)
            
            # Mettre à jour les champs du log
            log.text = gc_log.get('text', '')
            log.date = gc_log.get('date')
            
            # Normaliser le type de log pour avoir une cohérence
            log_type = gc_log.get('type', 'unknown')
            
            # Importer la fonction de normalisation des types de logs
            from app.routes.geocaches import normalize_log_type
            log.log_type = normalize_log_type(log_type)
            
        # Enregistrer les modifications
        db.session.commit()
        logging.info(f"Logs enregistrés en base de données pour {gc_code}")
        
        # Mettre à jour le nombre de logs
        geocache.logs_count = len(geocache.logs)
        db.session.commit()
        
        return render_template('logs_panel.html', 
                            logs=geocache.logs,
                            geocache_id=geocache_id,
                            geocache_name=geocache.name,
                            success="Logs rafraîchis avec succès")
    
    except Exception as e:
        from flask import current_app
        current_app.logger.error(f"Erreur lors du rafraîchissement des logs: {str(e)}")
        import traceback
        current_app.logger.error(traceback.format_exc())
        return render_template('logs_panel.html', 
                            logs=geocache.logs,
                            geocache_id=geocache_id,
                            geocache_name=geocache.name,
                            error=f"Erreur lors du rafraîchissement des logs: {str(e)}")
