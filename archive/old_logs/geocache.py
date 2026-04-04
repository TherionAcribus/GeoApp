from datetime import datetime, timezone
from app.database import db
from geoalchemy2 import Geometry
from geoalchemy2.shape import from_shape, to_shape
from shapely.geometry import Point
from bs4 import BeautifulSoup
from flask import url_for, current_app
import os
from sqlalchemy import inspect

def decimal_to_dm(decimal_degrees):
    """Convertit des degrés décimaux en degrés et minutes décimales"""
    degrees = int(decimal_degrees)
    minutes = abs(decimal_degrees - degrees) * 60
    return degrees, minutes

def dm_to_decimal(degrees, minutes):
    """Convertit des degrés et minutes décimales en degrés décimaux"""
    return degrees + (minutes / 60) * (1 if degrees >= 0 else -1)

def gc_coords_to_decimal(gc_lat, gc_lon):
    """Convertit des coordonnées au format Geocaching.com en coordonnées décimales
    
    Format attendu:
    - gc_lat: "N 48° 51.402" ou "S 48° 51.402"
    - gc_lon: "E 002° 21.048" ou "W 002° 21.048"
    
    Retourne:
    - (latitude_decimal, longitude_decimal) ou (None, None) en cas d'erreur
    """
    try:
        lat_decimal = None
        lon_decimal = None
        
        if gc_lat and gc_lon:
            # Latitude
            lat_parts = gc_lat.split('°')
            if len(lat_parts) == 2:
                lat_deg = float(lat_parts[0].replace('N', '').replace('S', '').strip())
                lat_min = float(lat_parts[1].strip())
                lat_decimal = lat_deg + (lat_min / 60)
                if 'S' in gc_lat:
                    lat_decimal = -lat_decimal
            
            # Longitude
            lon_parts = gc_lon.split('°')
            if len(lon_parts) == 2:
                lon_deg = float(lon_parts[0].replace('E', '').replace('W', '').strip())
                lon_min = float(lon_parts[1].strip())
                lon_decimal = lon_deg + (lon_min / 60)
                if 'W' in gc_lon:
                    lon_decimal = -lon_decimal
        
        return lat_decimal, lon_decimal
    except Exception:
        return None, None

class Zone(db.Model):
    __table_args__ = {'extend_existing': True}
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    description = db.Column(db.Text)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    geocaches = db.relationship('Geocache', secondary='geocache_zone', back_populates='zones')
    
    def to_dict(self):
        """Convertit l'objet Zone en dictionnaire pour la sérialisation JSON."""
        return {
            'id': self.id,
            'name': self.name,
            'description': self.description,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'geocaches_count': len(self.geocaches) if self.geocaches else 0
        }

class GeocacheZone(db.Model):
    __table_args__ = {'extend_existing': True}
    geocache_id = db.Column(db.Integer, db.ForeignKey('geocache.id'), primary_key=True)
    zone_id = db.Column(db.Integer, db.ForeignKey('zone.id'), primary_key=True)
    added_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))

class AdditionalWaypoint(db.Model):
    __table_args__ = {'extend_existing': True}
    id = db.Column(db.Integer, primary_key=True)
    geocache_id = db.Column(db.Integer, db.ForeignKey('geocache.id'), nullable=False)
    name = db.Column(db.String(100))
    prefix = db.Column(db.String(10))
    lookup = db.Column(db.String(10))
    location = db.Column(Geometry('POINT', srid=4326))
    note = db.Column(db.Text)
    # Coordonnées au format Geocaching.com
    gc_lat = db.Column(db.String(20))  # ex: "N 48° 51.402"
    gc_lon = db.Column(db.String(20))  # ex: "E 002° 21.048"
    
    geocache = db.relationship('Geocache', back_populates='additional_waypoints')
    
    @property
    def latitude(self):
        """Retourne la latitude en degrés décimaux"""
        if self.location is not None:
            point = to_shape(self.location)
            return point.y
        return None
        
    @property
    def longitude(self):
        """Retourne la longitude en degrés décimaux"""
        if self.location is not None:
            point = to_shape(self.location)
            return point.x
        return None
    
    @property
    def gc_coords(self):
        """Retourne les coordonnées complètes au format Geocaching.com"""
        if self.gc_lat and self.gc_lon:
            return f"{self.gc_lat} {self.gc_lon}"
        return None
        
    def set_location(self, lat, lon, gc_lat=None, gc_lon=None):
        """Définit la position du waypoint"""
        if lat is not None and lon is not None:
            self.location = from_shape(Point(lon, lat), srid=4326)
            if gc_lat:
                self.gc_lat = gc_lat
            if gc_lon:
                self.gc_lon = gc_lon

class Attribute(db.Model):
    __table_args__ = {'extend_existing': True}
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(50), nullable=False, unique=True)
    icon_url = db.Column(db.String(200))
    is_negative = db.Column(db.Boolean, default=False)
    base_name = db.Column(db.String(50))  # Stocke le nom de base sans le suffixe yes/no
    
    geocaches = db.relationship('Geocache', secondary='geocache_attribute', back_populates='attributes')
    
    @property
    def opposite_attribute(self):
        """Retourne l'attribut opposé (positif si négatif, négatif si positif)"""
        if not self.base_name:
            return None
            
        # Vérifier si la colonne existe
        inspector = inspect(db.engine)
        columns = [c['name'] for c in inspector.get_columns('attribute')]
        if 'is_negative' not in columns or 'base_name' not in columns:
            return None
        
        # Chercher l'attribut opposé
        opposite_is_negative = not self.is_negative
        return Attribute.query.filter_by(
            base_name=self.base_name, 
            is_negative=opposite_is_negative
        ).first()
    
    @property
    def icon_full_url(self):
        """Retourne l'URL complète de l'icône"""
        from flask import current_app, url_for
        if not self.icon_url:
            return None
        try:
            return url_for('static', filename=f'images/attributes/{self.icon_url}')
        except:
            # En cas d'erreur (hors contexte Flask), retourne simplement le chemin relatif
            return f'/static/images/attributes/{self.icon_url}'
    
    @staticmethod
    def get_by_base_name(base_name, is_negative=False):
        """Récupère un attribut par son nom de base et son type (positif/négatif)"""
        # Vérifier si les colonnes existent
        inspector = inspect(db.engine)
        columns = [c['name'] for c in inspector.get_columns('attribute')]
        if 'is_negative' not in columns or 'base_name' not in columns:
            return None
            
        return Attribute.query.filter_by(
            base_name=base_name,
            is_negative=is_negative
        ).first()
        
    @staticmethod
    def has_new_columns():
        """Vérifie si les nouvelles colonnes existent déjà"""
        inspector = inspect(db.engine)
        columns = [c['name'] for c in inspector.get_columns('attribute')]
        return 'is_negative' in columns and 'base_name' in columns
    
    @staticmethod
    def debug_all_attributes():
        """Affiche tous les attributs en base de données pour debug"""
        from app.utils.logger import setup_logger
        logger = setup_logger()
        
        attributes = Attribute.query.all()
        logger.debug(f"Total des attributs en base: {len(attributes)}")
        
        for attr in attributes:
            logger.debug(f"ID: {attr.id}, Nom: {attr.name}, Icône: {attr.icon_url}, " +
                         f"Base name: {attr.base_name}, Négatif: {attr.is_negative}")
        
        return attributes

class GeocacheAttribute(db.Model):
    __table_args__ = {'extend_existing': True}
    geocache_id = db.Column(db.Integer, db.ForeignKey('geocache.id'), primary_key=True)
    attribute_id = db.Column(db.Integer, db.ForeignKey('attribute.id'), primary_key=True)
    is_on = db.Column(db.Boolean, default=True)

class Checker(db.Model):
    __table_args__ = {'extend_existing': True}
    id = db.Column(db.Integer, primary_key=True)
    geocache_id = db.Column(db.Integer, db.ForeignKey('geocache.id'), nullable=False)
    name = db.Column(db.String(100))
    url = db.Column(db.String(500))
    
    geocache = db.relationship('Geocache', back_populates='checkers')

class Note(db.Model):
    __table_args__ = {'extend_existing': True}
    id = db.Column(db.Integer, primary_key=True)
    content = db.Column(db.Text, nullable=False)
    note_type = db.Column(db.String(50), nullable=False)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))
    
    geocaches = db.relationship('Geocache', secondary='geocache_note', back_populates='notes')

class GeocacheNote(db.Model):
    __table_args__ = {'extend_existing': True}
    geocache_id = db.Column(db.Integer, db.ForeignKey('geocache.id'), primary_key=True)
    note_id = db.Column(db.Integer, db.ForeignKey('note.id'), primary_key=True)
    added_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))

class GeocacheImage(db.Model):
    __table_args__ = (
        db.Index('ix_parent_image_id', 'parent_image_id'),
        {'extend_existing': True}
    )
    id = db.Column(db.Integer, primary_key=True)
    geocache_id = db.Column(db.Integer, db.ForeignKey('geocache.id'), nullable=False)
    filename = db.Column(db.String(255), nullable=False)
    original_url = db.Column(db.String(500))
    is_original = db.Column(db.Boolean, default=True, nullable=False)
    parent_image_id = db.Column(db.Integer, db.ForeignKey('geocache_image.id'))
    modified_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))
    
    # Relations
    geocache = db.relationship('Geocache', back_populates='images')
    parent_image = db.relationship('GeocacheImage', remote_side=[id], backref='derived_images')
    
    @property
    def url(self):
        # Utiliser la route pour servir l'image avec le code GC
        return url_for('geocaches.serve_image', filename=f'{self.geocache.gc_code}/{self.filename}')
        
    @property
    def name(self):
        # Retourner un nom d'affichage pour l'image basé sur le nom de fichier
        # Enlever les préfixes (comme "modified_") et l'extension
        basename = os.path.basename(self.filename)
        # Enlever les préfixes communs
        clean_name = basename
        if basename.startswith("modified_"):
            # Enlever le préfixe "modified_" et le timestamp qui suit (format: modified_1234567890_...)
            parts = basename.split("_", 2)
            if len(parts) > 2:
                clean_name = parts[2]
        # Enlever l'extension
        return os.path.splitext(clean_name)[0]

class Owner(db.Model):
    __table_args__ = {'extend_existing': True}
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False, unique=True)
    
    # Relation avec les geocaches
    geocaches = db.relationship('Geocache', back_populates='owner')
    # Relation avec les logs
    logs = db.relationship('Log', back_populates='author')
    
    def __repr__(self):
        return f"<Owner {self.name}>"    

class Log(db.Model):
    __table_args__ = {'extend_existing': True}
    id = db.Column(db.Integer, primary_key=True)
    geocache_id = db.Column(db.Integer, db.ForeignKey('geocache.id'), nullable=False)
    author_id = db.Column(db.Integer, db.ForeignKey('owner.id'), nullable=False)
    text = db.Column(db.Text)
    date = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    log_type = db.Column(db.String(50))  # Found it, Write Note, Didn't Find it, etc.
    favorite = db.Column(db.Boolean, default=False)  # Remplace favorites_count
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    
    # Relations
    geocache = db.relationship('Geocache', back_populates='logs')
    author = db.relationship('Owner', back_populates='logs')
    
    def __repr__(self):
        return f"<Log {self.id}: {self.log_type} by {self.author.name}>"

class Geocache(db.Model):
    __table_args__ = {'extend_existing': True}
    id = db.Column(db.Integer, primary_key=True)
    gc_code = db.Column(db.String(10), nullable=False)
    name = db.Column(db.String(100), nullable=False)
    owner_id = db.Column(db.Integer, db.ForeignKey('owner.id'))
    cache_type = db.Column(db.String(50))
    location = db.Column(Geometry('POINT', srid=4326), nullable=False)
    location_corrected = db.Column(Geometry('POINT', srid=4326))
    # Coordonnées au format Geocaching.com
    gc_lat = db.Column(db.String(20))  # ex: "N 48° 51.402"
    gc_lon = db.Column(db.String(20))  # ex: "E 002° 21.048"
    gc_lat_corrected = db.Column(db.String(20))
    gc_lon_corrected = db.Column(db.String(20))
    description = db.Column(db.Text)
    description_modified = db.Column(db.Text)  # for translation or personal changes
    difficulty = db.Column(db.Float)
    terrain = db.Column(db.Float)
    size = db.Column(db.String(20))
    hints = db.Column(db.Text)
    favorites_count = db.Column(db.Integer, default=0)
    logs_count = db.Column(db.Integer, default=0)
    hidden_date = db.Column(db.DateTime)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    last_updated = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))
    solved = db.Column(db.String(20), default='not_solved')  # "not_solved", "solved", "ongoing"
    solved_date = db.Column(db.DateTime)
    found = db.Column(db.Boolean, default=False)
    found_date = db.Column(db.DateTime)
    last_found_date = db.Column(db.DateTime)
    gc_personnal_note = db.Column(db.Text)

    owner = db.relationship('Owner', back_populates='geocaches')
    zones = db.relationship('Zone', secondary='geocache_zone', back_populates='geocaches')
    additional_waypoints = db.relationship('AdditionalWaypoint', back_populates='geocache', cascade='all, delete-orphan')
    attributes = db.relationship('Attribute', secondary='geocache_attribute', back_populates='geocaches')
    checkers = db.relationship('Checker', back_populates='geocache', cascade='all, delete-orphan')
    notes = db.relationship('Note', secondary='geocache_note', back_populates='geocaches')
    images = db.relationship('GeocacheImage', back_populates='geocache', cascade='all, delete-orphan')
    logs = db.relationship('Log', back_populates='geocache', cascade='all, delete-orphan')
    
    @property
    def latitude(self):
        """Retourne la latitude en degrés décimaux"""
        if self.location is not None:
            point = to_shape(self.location)
            return point.y
        return None
        
    @property
    def longitude(self):
        """Retourne la longitude en degrés décimaux"""
        if self.location is not None:
            point = to_shape(self.location)
            return point.x
        return None
    
    @property
    def gc_coords(self):
        """Retourne les coordonnées complètes au format Geocaching.com"""
        if self.gc_lat and self.gc_lon:
            return f"{self.gc_lat} {self.gc_lon}"
        return None

    @property
    def latitude_corrected(self):
        """Retourne la latitude corrigée en degrés décimaux"""
        if self.location_corrected is not None:
            point = to_shape(self.location_corrected)
            return point.y
        return None
        
    @property
    def longitude_corrected(self):
        """Retourne la longitude corrigée en degrés décimaux"""
        if self.location_corrected is not None:
            point = to_shape(self.location_corrected)
            return point.x
        return None
    
    @property
    def gc_coords_corrected(self):
        """Retourne les coordonnées corrigées complètes au format Geocaching.com"""
        if self.gc_lat_corrected and self.gc_lon_corrected:
            return f"{self.gc_lat_corrected} {self.gc_lon_corrected}"
        return None
        
    def set_location(self, lat, lon, gc_lat=None, gc_lon=None):
        """Définit la position de la géocache"""
        if lat is not None and lon is not None:
            self.location = from_shape(Point(lon, lat), srid=4326)
            if gc_lat:
                self.gc_lat = gc_lat
            if gc_lon:
                self.gc_lon = gc_lon

    def set_location_corrected(self, lat, lon, gc_lat=None, gc_lon=None):
        """Définit la position corrigée de la géocache"""
        if lat is not None and lon is not None:
            self.location_corrected = from_shape(Point(lon, lat), srid=4326)
            if gc_lat:
                self.gc_lat_corrected = gc_lat
            if gc_lon:
                self.gc_lon_corrected = gc_lon

    @property
    def description_text(self):
        """Convertit la description HTML en texte brut en préservant la mise en forme."""
        if not self.description:
            return ""
            
        soup = BeautifulSoup(self.description, 'html.parser')
        
        # Remplacer les balises <br> par des sauts de ligne
        for br in soup.find_all('br'):
            br.replace_with('\n')
            
        # Gérer les paragraphes
        for p in soup.find_all('p'):
            # Ajouter deux sauts de ligne après chaque paragraphe
            p.append('\n\n')
            
        # Gérer les div
        for div in soup.find_all('div'):
            # Ajouter un saut de ligne après chaque div
            div.append('\n')
            
        # Gérer les listes
        for ul in soup.find_all(['ul', 'ol']):
            # Ajouter un saut de ligne avant et après la liste
            ul.insert_before('\n')
            ul.append('\n')
            
        for li in soup.find_all('li'):
            # Ajouter un tiret et un saut de ligne pour chaque élément de liste
            li.insert_before('- ')
            li.append('\n')
            
        # Obtenir le texte et nettoyer les sauts de ligne multiples
        text = soup.get_text()
        text = '\n'.join(line.strip() for line in text.splitlines() if line.strip())
        
        return text

    @property
    def zone(self):
        """Retourne la première zone associée à la géocache (pour compatibilité)"""
        return self.zones[0] if self.zones else None
        
    @property
    def zone_id(self):
        """Retourne l'ID de la première zone associée à la géocache (pour compatibilité)"""
        return self.zones[0].id if self.zones else None

    @staticmethod
    def get_image_by_id(image_id):
        """Récupère une image par son ID."""
        try:
            # Convertir l'ID en entier
            image_id = int(image_id)
            
            # Chercher l'image directement dans la base de données
            image = GeocacheImage.query.get(image_id)
            if image:
                return {
                    'id': image.id,
                    'filename': image.filename,
                    'gc_code': image.geocache.gc_code
                }
            return None
            
        except Exception as e:
            current_app.logger.error(f"Erreur lors de la récupération de l'image {image_id}: {str(e)}")
            return None

    @staticmethod
    def get_by_image_id(image_id):
        """Récupère une géocache par l'ID d'une de ses images."""
        try:
            # Convertir l'ID en entier
            image_id = int(image_id)
            
            # Chercher l'image directement
            image = GeocacheImage.query.get(image_id)
            if image:
                return image.geocache
            return None
            
        except Exception as e:
            current_app.logger.error(f"Erreur lors de la récupération de la géocache par image {image_id}: {str(e)}")
            return None
