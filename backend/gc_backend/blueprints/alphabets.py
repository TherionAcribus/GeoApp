"""
Blueprint pour la gestion des alphabets personnalisés.
Réimplémentation pour Theia - API REST uniquement.
"""
import os
import json
import mimetypes
import re
import unicodedata
from functools import lru_cache
from flask import Blueprint, jsonify, send_file, request, current_app

alphabets_bp = Blueprint('alphabets', __name__)

# Fallback si accédé hors contexte Flask (ne devrait pas arriver en pratique)
_DEFAULT_ALPHABETS_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(__file__)))), 'alphabets')

# Les ressources d'alphabets (images, polices) sont quasi immuables. On autorise
# un cache navigateur long pour éviter de re-valider chaque fichier à chaque
# réouverture d'un viewer. La validation conditionnelle (ETag/Last-Modified)
# reste active via send_file(conditional=True) : un fichier remplacé finit par
# être repris après expiration, et un rechargement forcé renvoie un 304 léger.
_DEFAULT_ASSET_MAX_AGE = 60 * 60 * 24  # 1 jour

SEARCH_SYNONYMS = {
    'alien': ['extraterrestre', 'fiction', 'sf', 'science fiction', 'aurebesh', 'kryptonian', 'borg', 'fremen', 'romulan'],
    'ancien': ['antique', 'rune', 'runique', 'templier', 'theban', 'malachim', 'enochian', 'futhark'],
    'aveugle': ['braille', 'tactile', 'relief', 'malvoyant'],
    'binaire': ['binary', 'bits', 'zero un', 'informatique'],
    'chiffre': ['nombre', 'numero', 'numeral', 'numeric', 'cistercien'],
    'cochon': ['pigpen', 'pig pen', 'parc a cochons', 'franc macon', 'maconnique'],
    'couleur': ['color', 'couleurs', 'resistor', 'resistance', 'ohm', 'hexahue'],
    'drapeau': ['flag', 'flags', 'maritime', 'naval', 'semaphore', 'signal'],
    'jeu': ['game', 'video game', 'jeu video', 'space invaders', 'pokemon', 'zelda', 'final fantasy'],
    'marin': ['maritime', 'naval', 'drapeau', 'drapeaux', 'semaphore', 'signal'],
    'morse': ['telegraphe', 'telegraph', 'signal', 'radio', 'sos'],
    'musique': ['music', 'notes', 'partition'],
    'rune': ['runique', 'runes', 'futhark', 'hobbit', 'ancien'],
    'runique': ['rune', 'runes', 'futhark', 'hobbit', 'ancien'],
    'signal': ['signaux', 'communication', 'morse', 'semaphore', 'drapeau', 'telegraphe'],
    'symbole': ['symboles', 'glyphes', 'pictogramme', 'icone'],
    'telegraphe': ['telegraph', 'morse', 'chappe', 'signal', 'communication'],
}


def _get_alphabets_dir():
    """Retourne le chemin vers le répertoire des alphabets depuis la config Flask."""
    try:
        return current_app.config.get('ALPHABETS_DIR') or _DEFAULT_ALPHABETS_DIR
    except RuntimeError:
        return _DEFAULT_ALPHABETS_DIR


def _get_asset_max_age():
    """Durée de cache navigateur (en secondes) pour les ressources d'alphabets."""
    try:
        configured = current_app.config.get('ALPHABET_ASSET_MAX_AGE')
    except RuntimeError:
        configured = None
    return _DEFAULT_ASSET_MAX_AGE if configured is None else configured


def send_alphabet_file(path, **kwargs):
    """Sert une ressource d'alphabet avec les headers requis par les webfonts."""
    kwargs.setdefault('max_age', _get_asset_max_age())
    response = send_file(path, **kwargs)
    response.headers['Access-Control-Allow-Origin'] = '*'
    response.headers['Cross-Origin-Resource-Policy'] = 'cross-origin'
    return response


@lru_cache(maxsize=512)
def list_alphabet_image_files(alphabet_id, image_dir):
    """Liste les fichiers présents dans le dossier d'images d'un alphabet.

    Le résultat (tuple pour la mise en cache) permet au frontend de résoudre
    l'image d'un caractère localement, sans tester chaque URL candidate via des
    requêtes réseau qui finissent en 404. Le cache est vidé par /discover.
    """
    directory = os.path.join(_get_alphabets_dir(), alphabet_id, image_dir)
    if not os.path.isdir(directory):
        return ()
    try:
        return tuple(sorted(
            name for name in os.listdir(directory)
            if os.path.isfile(os.path.join(directory, name))
        ))
    except OSError:
        return ()


def attach_image_files(config):
    """Ajoute la liste des fichiers d'images disponibles pour un alphabet image."""
    alphabet_config = config.get('alphabetConfig', {})
    image_dir = alphabet_config.get('imageDir')
    if alphabet_config.get('type') == 'images' and image_dir:
        alphabet_config['imageFiles'] = list(
            list_alphabet_image_files(config.get('id', ''), image_dir)
        )
    return config


def load_alphabet_config(alphabet_id):
    """Charge la configuration d'un alphabet depuis son dossier."""
    alphabet_path = os.path.join(_get_alphabets_dir(), alphabet_id, 'alphabet.json')
    if not os.path.exists(alphabet_path):
        return None

    with open(alphabet_path, 'r', encoding='utf-8') as f:
        config = json.load(f)
        # Ajouter l'ID de l'alphabet (nom du dossier)
        config['id'] = alphabet_id
        return attach_image_files(normalize_alphabet_config(config))


def normalize_character_list(value):
    """Normalise une définition de caractères vers "all" ou une liste."""
    if value == 'all':
        return 'all'
    if value is None or value is False:
        return []
    if isinstance(value, str):
        if value.strip() == '' or value.strip().lower() == 'false':
            return []
        return [value]
    if isinstance(value, list):
        return [str(item) for item in value if item is not None and str(item) != '']
    return []


def normalize_special_map(value):
    """Normalise la table caractère -> ressource des symboles spéciaux."""
    if not isinstance(value, dict):
        return {}
    return {
        str(char): str(resource)
        for char, resource in value.items()
        if char is not None and resource is not None
    }


def normalize_alphabet_config(config):
    """Normalise un alphabet pour garder l'API compatible avec les anciens JSON."""
    alphabet_config = config.setdefault('alphabetConfig', {})
    characters = alphabet_config.setdefault('characters', {})

    legacy_special = normalize_special_map(alphabet_config.pop('special', {}))
    current_special = normalize_special_map(characters.get('special', {}))

    characters['letters'] = normalize_character_list(characters.get('letters', []))
    characters['numbers'] = normalize_character_list(characters.get('numbers', []))

    merged_special = {**legacy_special, **current_special}
    if merged_special:
        characters['special'] = merged_special
    else:
        characters.pop('special', None)

    return config


@lru_cache(maxsize=512)
def load_alphabet_readme(alphabet_id):
    """Charge le contenu du README d'un alphabet s'il existe."""
    alphabet_dir = os.path.join(_get_alphabets_dir(), alphabet_id)
    possible_names = ["README.md", "Readme.md", "readme.md"]
    
    for name in possible_names:
        readme_path = os.path.join(alphabet_dir, name)
        if os.path.isfile(readme_path):
            try:
                with open(readme_path, 'r', encoding='utf-8') as f:
                    return f.read()
            except:
                continue
    return ""


def normalize_search_text(value):
    """Normalise un texte pour une recherche insensible aux accents et a la casse."""
    normalized = unicodedata.normalize('NFD', str(value or ''))
    without_accents = ''.join(char for char in normalized if unicodedata.category(char) != 'Mn')
    return re.sub(r'\s+', ' ', without_accents.lower()).strip()


def expand_search_terms(query):
    """Ajoute des synonymes utiles en contexte geocaching sans perdre la requete brute."""
    normalized_query = normalize_search_text(query)
    terms = [normalized_query]
    words = [word for word in re.split(r'[^a-z0-9]+', normalized_query) if len(word) >= 2]

    for word in words:
        if word not in terms:
            terms.append(word)
        for synonym in SEARCH_SYNONYMS.get(word, []):
            normalized_synonym = normalize_search_text(synonym)
            if normalized_synonym and normalized_synonym not in terms:
                terms.append(normalized_synonym)

    return terms


def score_text_field(field_value, terms, exact_score, related_score):
    haystack = normalize_search_text(field_value)
    if not haystack:
        return 0

    score = 0
    for index, term in enumerate(terms):
        if term and term in haystack:
            score += exact_score if index == 0 else related_score
    return score


def get_search_blob(alphabet):
    tags = alphabet.get('tags', [])
    if not isinstance(tags, list):
        tags = []
    return ' '.join([
        alphabet.get('id', ''),
        alphabet.get('name', ''),
        alphabet.get('description', ''),
        alphabet.get('category', ''),
        alphabet.get('type', ''),
        alphabet.get('source', ''),
        ' '.join(str(tag) for tag in tags),
    ])


def search_alphabets_ranked(query, alphabets, search_in_name=True, search_in_tags=True, search_in_readme=True):
    """Recherche enrichie: accents, synonymes, tags, README et metadonnees."""
    if not query or query.strip() == "":
        return alphabets

    query_terms = expand_search_terms(query)
    primary_query = query_terms[0]
    results = []

    for alphabet in alphabets:
        score = 0
        matches = []

        if search_in_name:
            name_score = score_text_field(alphabet.get('name', ''), query_terms, 14, 4)
            if name_score > 0:
                score += name_score
                matches.append(f"nom: {alphabet.get('name', '')}")

            description_score = score_text_field(alphabet.get('description', ''), query_terms, 8, 2)
            if description_score > 0:
                score += description_score
                matches.append(f"description: {alphabet.get('description', '')}")

            for value in [alphabet.get('id', ''), alphabet.get('category', ''), alphabet.get('type', ''), alphabet.get('source', '')]:
                score += score_text_field(value, query_terms, 5, 1)

        if search_in_tags:
            tags = alphabet.get('tags', [])
            if isinstance(tags, list):
                for tag in tags:
                    tag_score = score_text_field(tag, query_terms, 10, 3)
                    if tag_score > 0:
                        score += tag_score
                        matches.append(f"tag: {tag}")

        if search_in_readme:
            readme_score = score_text_field(load_alphabet_readme(alphabet.get('id', '')), query_terms, 4, 1)
            if readme_score > 0:
                score += readme_score
                matches.append("description longue (README)")

        if search_in_name or search_in_tags or search_in_readme:
            for word in primary_query.split():
                if len(word) >= 3:
                    if search_in_name:
                        if word in normalize_search_text(alphabet.get('name', '')):
                            score += 2
                        if word in normalize_search_text(alphabet.get('description', '')):
                            score += 1
                    if search_in_tags:
                        tags = alphabet.get('tags', [])
                        if isinstance(tags, list):
                            for tag in tags:
                                if word in normalize_search_text(tag):
                                    score += 1

        search_blob = get_search_blob(alphabet)
        matched_synonyms = [
            term for term in query_terms[1:]
            if term and score_text_field(search_blob, [term], 1, 1) > 0
        ]
        if matched_synonyms:
            matches.append(f"synonyme: {', '.join(matched_synonyms[:3])}")

        if score > 0:
            alphabet['search_score'] = score
            alphabet['search_matches'] = list(dict.fromkeys(matches))
            results.append(alphabet)

    results.sort(key=lambda item: item.get('search_score', 0), reverse=True)
    return results


def search_alphabets(query, alphabets, search_in_name=True, search_in_tags=True, search_in_readme=True):
    return search_alphabets_ranked(query, alphabets, search_in_name, search_in_tags, search_in_readme)
    """
    Recherche dans les alphabets selon une requête et les préférences de recherche.
    Recherche dans : nom, tags, et contenu README selon les préférences.
    """
    if not query or query.strip() == "":
        return alphabets
    
    query = query.lower().strip()
    results = []
    
    for alphabet in alphabets:
        score = 0
        matches = []
        
        # Recherche dans le nom (si activé)
        if search_in_name:
            name = alphabet.get('name', '').lower()
            if query in name:
                score += 10
                matches.append(f"nom: {alphabet.get('name', '')}")
        
        # Recherche dans la description (si activé - même checkbox que nom)
        if search_in_name:
            description = alphabet.get('description', '').lower()
            if query in description:
                score += 5
                matches.append(f"description: {alphabet.get('description', '')}")
        
        # Recherche dans les tags (si activé)
        if search_in_tags:
            tags = alphabet.get('tags', [])
            if isinstance(tags, list):
                for tag in tags:
                    if query in tag.lower():
                        score += 8
                        matches.append(f"tag: {tag}")
        
        # Recherche dans le README (si activé)
        if search_in_readme:
            readme_content = load_alphabet_readme(alphabet.get('id', ''))
            if readme_content and query in readme_content.lower():
                score += 3
                matches.append("description longue (README)")
        
        # Recherche partielle (mots séparés) - seulement si au moins une option est activée
        if search_in_name or search_in_tags or search_in_readme:
            query_words = query.split()
            for word in query_words:
                if len(word) >= 3:  # Éviter les mots trop courts
                    if search_in_name:
                        # Recherche partielle dans le nom
                        name = alphabet.get('name', '').lower()
                        if word in name:
                            score += 2
                        # Recherche partielle dans la description
                        description = alphabet.get('description', '').lower()
                        if word in description:
                            score += 1
                    
                    if search_in_tags:
                        # Recherche partielle dans les tags
                        tags = alphabet.get('tags', [])
                        if isinstance(tags, list):
                            for tag in tags:
                                if word in tag.lower():
                                    score += 1
        
        if score > 0:
            alphabet['search_score'] = score
            alphabet['search_matches'] = matches
            results.append(alphabet)
    
    # Trier par score décroissant
    results.sort(key=lambda x: x.get('search_score', 0), reverse=True)
    return results


# Cache mémoire de la liste complète des alphabets normalisés. Évite de relire et
# re-parser les dizaines de fichiers alphabet.json à chaque GET /api/alphabets
# (notamment lors des recherches débouncées). Invalidé automatiquement par une
# signature basée sur les mtime des fichiers alphabet.json (donc une édition est
# détectée) et explicitement par POST /api/alphabets/discover.
_alphabets_cache = None
_alphabets_cache_signature = None


def _compute_alphabets_signature(base_dir):
    """Signature du dossier : (nom, mtime) de chaque alphabet.json, triée."""
    try:
        names = os.listdir(base_dir)
    except OSError:
        return None

    entries = []
    for name in names:
        config_path = os.path.join(base_dir, name, 'alphabet.json')
        try:
            entries.append((name, os.stat(config_path).st_mtime))
        except OSError:
            continue
    entries.sort()
    return tuple(entries)


def invalidate_alphabets_cache():
    """Force la reconstruction du cache liste au prochain appel."""
    global _alphabets_cache, _alphabets_cache_signature
    _alphabets_cache = None
    _alphabets_cache_signature = None


def get_all_alphabets():
    """Récupère tous les alphabets disponibles (avec cache mémoire)."""
    global _alphabets_cache, _alphabets_cache_signature

    base_dir = _get_alphabets_dir()
    signature = _compute_alphabets_signature(base_dir)

    if (
        signature is not None
        and signature == _alphabets_cache_signature
        and _alphabets_cache is not None
    ):
        return _alphabets_cache

    alphabets = []
    if os.path.exists(base_dir):
        for dirname in os.listdir(base_dir):
            alphabet_dir = os.path.join(base_dir, dirname)
            if os.path.isdir(alphabet_dir):
                config = load_alphabet_config(dirname)
                if config:
                    # Ajouter source (official/custom) basé sur la présence d'un fichier marker ou convention
                    # Pour l'instant, tous sont considérés comme "official"
                    config['source'] = 'official'
                    alphabets.append(config)

    _alphabets_cache = alphabets
    _alphabets_cache_signature = signature
    return alphabets


# =============================================================================
# Routes API REST
# =============================================================================

@alphabets_bp.route('/api/alphabets', methods=['GET'])
def get_alphabets():
    """
    Récupère la liste de tous les alphabets disponibles au format JSON.
    Supporte la recherche avec les paramètres:
    - search: terme de recherche
    - search_in_name: true/false (défaut: true)
    - search_in_tags: true/false (défaut: true)
    - search_in_readme: true/false (défaut: false)
    """
    alphabets = get_all_alphabets()
    
    # Gérer la recherche
    search_query = request.args.get('search', '').strip()
    search_in_name = request.args.get('search_in_name', 'true').lower() == 'true'
    search_in_tags = request.args.get('search_in_tags', 'true').lower() == 'true'
    search_in_readme = request.args.get('search_in_readme', 'false').lower() == 'true'
    
    if search_query:
        # Copie défensive : search_alphabets ajoute search_score/search_matches
        # sur les dicts. On protège ainsi les objets partagés du cache mémoire.
        alphabets = search_alphabets(
            search_query,
            [dict(alphabet) for alphabet in alphabets],
            search_in_name,
            search_in_tags,
            search_in_readme
        )

    return jsonify(alphabets)


@alphabets_bp.route('/api/alphabets/<alphabet_id>', methods=['GET'])
def get_alphabet(alphabet_id):
    """Récupère la configuration complète d'un alphabet spécifique."""
    alphabet_dir = os.path.join(_get_alphabets_dir(), alphabet_id)
    
    if not os.path.exists(alphabet_dir):
        return jsonify({"error": f"Alphabet {alphabet_id} non trouvé"}), 404
        
    config = load_alphabet_config(alphabet_id)
    if not config:
        return jsonify({"error": "Configuration de l'alphabet invalide"}), 500
        
    return jsonify(config)


@alphabets_bp.route('/api/alphabets/<alphabet_id>/resource/<path:resource_path>')
def get_alphabet_resource(alphabet_id, resource_path):
    """
    Récupère une ressource (image ou police) d'un alphabet.
    Utilisé pour les images individuelles des symboles.
    """
    resource_full_path = os.path.join(_get_alphabets_dir(), alphabet_id, resource_path)
    
    current_app.logger.info(f"Requested resource: {resource_full_path}")
    
    if not os.path.exists(resource_full_path) or not os.path.isfile(resource_full_path):
        current_app.logger.error(f"Resource not found: {resource_full_path}")
        return jsonify({"error": f"Resource {resource_path} not found"}), 404
        
    return send_alphabet_file(resource_full_path)


@alphabets_bp.route('/api/alphabets/<alphabet_id>/font')
def get_alphabet_font(alphabet_id):
    """
    Récupère la police TTF d'un alphabet basé sur police.
    Retourne le fichier binaire de la police.
    """
    config = load_alphabet_config(alphabet_id)
    if not config:
        current_app.logger.error(f"Alphabet not found: {alphabet_id}")
        return jsonify({"error": f"Alphabet {alphabet_id} non trouvé"}), 404
        
    if config['alphabetConfig']['type'] != 'font':
        current_app.logger.error(f"Not a font-based alphabet: {alphabet_id}")
        return jsonify({"error": "Not a font-based alphabet"}), 404
    
    font_path = os.path.join(_get_alphabets_dir(), alphabet_id, config['alphabetConfig']['fontFile'])
    
    current_app.logger.info(f"Loading font: {font_path}")
    
    if not os.path.exists(font_path):
        current_app.logger.error(f"Font file not found: {font_path}")
        return jsonify({"error": f"Police {config['alphabetConfig']['fontFile']} non trouvée"}), 404
    
    mimetype = mimetypes.guess_type(font_path)[0]
    if font_path.lower().endswith('.ttf'):
        mimetype = 'font/ttf'
    elif font_path.lower().endswith('.otf'):
        mimetype = 'font/otf'
    elif font_path.lower().endswith('.woff'):
        mimetype = 'font/woff'
    elif font_path.lower().endswith('.woff2'):
        mimetype = 'font/woff2'

    return send_alphabet_file(font_path, mimetype=mimetype)


@alphabets_bp.route('/api/alphabets/<alphabet_id>/sources', methods=['GET'])
def get_alphabet_sources(alphabet_id):
    """Récupère les sources et crédits d'un alphabet."""
    config = load_alphabet_config(alphabet_id)
    if not config:
        return jsonify({"error": f"Alphabet {alphabet_id} non trouvé"}), 404
        
    sources = config.get('sources', [])
    return jsonify({
        "alphabet_id": alphabet_id,
        "alphabet_name": config.get('name', alphabet_id),
        "sources": sources
    })


@alphabets_bp.route('/api/alphabets/<alphabet_id>/readme', methods=['GET'])
def get_alphabet_readme(alphabet_id):
    """Récupère le contenu du README d'un alphabet."""
    alphabet_dir = os.path.join(_get_alphabets_dir(), alphabet_id)
    
    if not os.path.exists(alphabet_dir):
        return jsonify({"error": f"Alphabet {alphabet_id} not found"}), 404
    
    readme_content = load_alphabet_readme(alphabet_id)
    
    return jsonify({
        "alphabet_id": alphabet_id,
        "readme": readme_content
    })


@alphabets_bp.route('/api/alphabets/discover', methods=['POST'])
def discover_alphabets():
    """
    Force la redécouverte des alphabets (scan du répertoire).
    Retourne la liste mise à jour des alphabets.
    """
    # Vider les caches pour refléter d'éventuels ajouts/modifications.
    invalidate_alphabets_cache()
    list_alphabet_image_files.cache_clear()
    load_alphabet_readme.cache_clear()
    alphabets = get_all_alphabets()
    return jsonify({
        "status": "success",
        "count": len(alphabets),
        "alphabets": alphabets
    })




