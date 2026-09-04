import json
from datetime import datetime, timezone

from .database import db


class Zone(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False, unique=True)
    description = db.Column(db.Text)
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    # Zone technique, absente de l'arbre par défaut : aujourd'hui la zone « Amis »,
    # qui accumule les caches importées pour cartographier les trouvailles des amis
    # et n'a pas à encombrer la navigation. `GET /api/zones?include_hidden=true`
    # la fait réapparaître.
    is_hidden = db.Column(db.Boolean, default=False, index=True)
    # Relation many-to-many avec Geocache (à implémenter plus tard)
    # geocaches = db.relationship('Geocache', secondary='geocache_zone', back_populates='zones')

    def to_dict(self):
        return {
            'id': self.id,
            'name': self.name,
            'description': self.description,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'is_hidden': bool(self.is_hidden),
            'geocaches_count': len(self.geocaches) if hasattr(self, 'geocaches') and self.geocaches else 0,
        }


class AppConfig(db.Model):
    key = db.Column(db.String(100), primary_key=True)
    value = db.Column(db.Text)

    @staticmethod
    def get_value(key: str, default: str | None = None) -> str | None:
        entry = AppConfig.query.get(key)
        return entry.value if entry is not None else default

    @staticmethod
    def set_value(key: str, value: str | None) -> None:
        entry = AppConfig.query.get(key)
        if entry is None:
            entry = AppConfig(key=key, value=value)
            db.session.add(entry)
        else:
            entry.value = value


class FriendFind(db.Model):
    """
    « Cet ami a trouvé cette cache », sans limite de date.

    Deux sources alimentent cette table (cf. documentation/amis-geocaching-technique.md) :
    - le **complément du filtre `nfb`** de la recherche web, qui donne d'un coup
      toutes les trouvailles d'un ami sur une zone, quel que soit leur âge ;
    - les **logs d'amis** relevés au rafraîchissement des logs d'une cache.

    On stocke le code GC plutôt qu'une clé étrangère : une cache trouvée par un
    ami n'est pas forcément (encore) importée dans GeoApp.
    """
    __tablename__ = 'friend_find'

    id = db.Column(db.Integer, primary_key=True)
    friend_username = db.Column(db.String(150), nullable=False, index=True)
    gc_code = db.Column(db.String(30), nullable=False, index=True)
    # Une ou plusieurs preuves, séparées par des virgules (ex. "activity,zone_search").
    # `store_finds()` n'ajoute que sa propre preuve à l'ensemble existant, et ne
    # supprime la ligne que si plus aucune source ne la confirme (services/geocaching_friend_finds.py).
    source = db.Column(db.String(60), nullable=False, default='zone_search')

    # Métadonnées relevées **au moment de la déduction** : la recherche de
    # référence (`trouvées = référence − complément`) renvoie déjà les
    # coordonnées, le nom et le type de chaque cache de la boîte. Les stocker ici
    # rend la carte des trouvailles instantanée et hors ligne, au lieu d'attendre
    # un import complet (une requête par cache). Nulles pour les lignes créées
    # avant cette colonne, ou issues des logs d'une cache (`source='cache_logs'`,
    # dont les coordonnées viennent de la jointure avec `Geocache`).
    latitude = db.Column(db.Float)
    longitude = db.Column(db.Float)
    cache_name = db.Column(db.String(255))
    cache_type = db.Column(db.String(100))

    first_seen_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    last_seen_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))

    __table_args__ = (
        db.UniqueConstraint('friend_username', 'gc_code', name='unique_find_per_friend'),
    )

    def to_dict(self) -> dict:
        return {
            'id': self.id,
            'friend_username': self.friend_username,
            'gc_code': self.gc_code,
            'source': self.source,
            'latitude': self.latitude,
            'longitude': self.longitude,
            'cache_name': self.cache_name,
            'cache_type': self.cache_type,
            'first_seen_at': self.first_seen_at.isoformat() if self.first_seen_at else None,
        }


class FriendZoneScan(db.Model):
    """
    Mémoire des analyses « qui a trouvé quoi » sur une zone.

    Sans cette table, « absent de ``friend_find`` » est indiscernable de
    « jamais analysé » : un re-scan repaginerait intégralement la boîte pour
    chaque ami, même ceux dont on sait déjà qu'ils n'ont rien trouvé la
    semaine précédente. Ici, on enregistre le résultat de chaque scan (ami ×
    zone), ce qui permet :

    - d'afficher « vérifié le 12/08, 0/43 » à côté de chaque ami ;
    - de ne re-scanner que les amis dont le scan est ancien ou dont la boîte a
      changé (``box_signature``) ;
    - de reprendre un scan interrompu (429) sans tout reprendre depuis le
      début.
    """
    __tablename__ = 'friend_zone_scan'

    id = db.Column(db.Integer, primary_key=True)
    friend_username = db.Column(db.String(150), nullable=False, index=True)
    zone_id = db.Column(db.Integer, nullable=False, index=True)

    # Signature de la boîte englobante au moment du scan : si des caches sont
    # ajoutées à la zone, la boîte change et le scan est considéré comme obsolète.
    box_signature = db.Column(db.String(100))

    # Compteurs relevés au moment du scan, pour l'affichage sans re-scanner.
    baseline_total = db.Column(db.Integer, default=0)
    found_count = db.Column(db.Integer, default=0)
    zone_matches = db.Column(db.Integer, default=0)
    truncated = db.Column(db.Boolean, default=False)

    scanned_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))

    __table_args__ = (
        db.UniqueConstraint('friend_username', 'zone_id', name='unique_scan_per_friend_zone'),
    )

    def to_dict(self) -> dict:
        return {
            'friend_username': self.friend_username,
            'zone_id': self.zone_id,
            'box_signature': self.box_signature,
            'baseline_total': self.baseline_total,
            'found_count': self.found_count,
            'zone_matches': self.zone_matches,
            'truncated': bool(self.truncated),
            'scanned_at': self.scanned_at.isoformat() if self.scanned_at else None,
        }


class FriendActivity(db.Model):
    """
    Un log d'un ami, capturé depuis le flux d'activité de geocaching.com.

    Le flux distant est plafonné (~100 entrées, ~2 mois) : cette table accumule
    localement les synchronisations successives pour constituer un historique
    plus profond. `log_reference_code` (GLxxxxx) est la clé de déduplication.
    """
    __tablename__ = 'friend_activity'

    id = db.Column(db.Integer, primary_key=True)
    log_reference_code = db.Column(db.String(30), nullable=False, unique=True, index=True)
    activity_type = db.Column(db.Integer, nullable=False, default=2, index=True)

    author_username = db.Column(db.String(150), nullable=False, index=True)
    author_reference_code = db.Column(db.String(30))
    author_avatar_url = db.Column(db.String(500))
    # Le flux « communauté » de geocaching.com mélange mes logs et ceux de mes
    # amis : on marque les miens à la synchro pour pouvoir les masquer sans
    # avoir à connaître l'utilisateur connecté au moment de la lecture.
    is_self = db.Column(db.Boolean, default=False, index=True)

    log_type_id = db.Column(db.Integer, index=True)
    log_date = db.Column(db.DateTime, index=True)
    created_date = db.Column(db.DateTime)
    note = db.Column(db.Text)

    cache_name = db.Column(db.String(255))
    cache_reference_code = db.Column(db.String(30), index=True)
    cache_type_id = db.Column(db.Integer)
    container_type_id = db.Column(db.Integer)
    difficulty = db.Column(db.Float)
    terrain = db.Column(db.Float)

    favorite_points = db.Column(db.Integer)
    image_count = db.Column(db.Integer)
    is_premium = db.Column(db.Boolean, default=False)
    is_archived = db.Column(db.Boolean, default=False)
    is_favorited = db.Column(db.Boolean, default=False)

    latitude = db.Column(db.Float)
    longitude = db.Column(db.Float)
    location_name = db.Column(db.String(255))

    is_condensed = db.Column(db.Boolean, default=False)
    condensed_count = db.Column(db.Integer, default=0)
    action_url = db.Column(db.String(500))

    first_seen_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    last_seen_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))

    def to_dict(self) -> dict:
        return {
            'id': self.id,
            'log_reference_code': self.log_reference_code,
            'activity_type': self.activity_type,
            'author_username': self.author_username,
            'author_reference_code': self.author_reference_code,
            'author_avatar_url': self.author_avatar_url,
            'is_self': bool(self.is_self),
            'log_type_id': self.log_type_id,
            'log_date': self.log_date.isoformat() if self.log_date else None,
            'created_date': self.created_date.isoformat() if self.created_date else None,
            'note': self.note,
            'cache_name': self.cache_name,
            'cache_reference_code': self.cache_reference_code,
            'cache_type_id': self.cache_type_id,
            'container_type_id': self.container_type_id,
            'difficulty': self.difficulty,
            'terrain': self.terrain,
            'favorite_points': self.favorite_points,
            'image_count': self.image_count,
            'is_premium': self.is_premium,
            'is_archived': self.is_archived,
            'is_favorited': self.is_favorited,
            'latitude': self.latitude,
            'longitude': self.longitude,
            'location_name': self.location_name,
            'is_condensed': self.is_condensed,
            'condensed_count': self.condensed_count,
            'action_url': self.action_url,
            'first_seen_at': self.first_seen_at.isoformat() if self.first_seen_at else None,
        }




class OutingPlan(db.Model):
    """
    Le rapport de préparation de sortie, sorti du chat et rendu exploitable.

    Le rapport vit d'abord dans une conversation : il s'y perd dès qu'on la referme, et
    rien d'autre dans GeoApp ne peut le lire. Cette table en garde la partie structurée
    (checklist, alertes, drapeaux par cache) plus le texte complet, ce qui autorise le
    panneau cochable, les badges dans les tables et l'export Markdown.

    Clé métier : ``(zone_name, outing_date)`` — la même que le titre de session du chat.
    Deux analyses de la même sortie écrasent donc le même plan au lieu d'empiler des
    doublons, exactement comme elles reprennent la même conversation. L'état coché
    (``checked``) survit à cet écrasement pour les lignes dont la clé n'a pas bougé :
    relancer l'analyse ne doit pas vider un sac à moitié fait.

    ``payload`` et ``gc_codes`` sont du JSON stocké en texte : SQLite n'a rien à
    requêter là-dedans, et le plan est toujours lu en entier.
    """
    __tablename__ = 'outing_plan'

    id = db.Column(db.Integer, primary_key=True)

    # '' est une valeur légitime : le bouton du log-editor n'a pas de zone à nommer.
    zone_name = db.Column(db.String(150), nullable=False, default='')
    outing_date = db.Column(db.String(10), nullable=False, index=True)

    gc_codes = db.Column(db.Text)
    payload = db.Column(db.Text, nullable=False)
    markdown = db.Column(db.Text)
    checked = db.Column(db.Text)

    # 'tool' quand le modèle a appelé save_outing_plan, 'parsed' quand le front a repêché
    # le bloc JSON dans la réponse. Sert au diagnostic : si tout arrive en 'parsed', c'est
    # que le tool n'est pas exposé ou que le modèle l'ignore.
    source = db.Column(db.String(20), default='tool')
    model_name = db.Column(db.String(120))

    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = db.Column(
        db.DateTime,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

    __table_args__ = (
        db.UniqueConstraint('zone_name', 'outing_date', name='unique_plan_per_zone_date'),
    )

    def to_dict(self, include_markdown: bool = True) -> dict:
        def _load(raw, fallback):
            if not raw:
                return fallback
            try:
                return json.loads(raw)
            except (TypeError, ValueError):
                return fallback

        data = {
            'id': self.id,
            'zone_name': self.zone_name or '',
            'outing_date': self.outing_date,
            'gc_codes': _load(self.gc_codes, []),
            'plan': _load(self.payload, {}),
            'checked': _load(self.checked, []),
            'source': self.source or 'tool',
            'model_name': self.model_name,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None,
        }
        if include_markdown:
            data['markdown'] = self.markdown or ''
        return data
