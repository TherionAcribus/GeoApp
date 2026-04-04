import json

class AnalysisWebPagePlugin:
    def __init__(self):
        self.name = "analysis_web_page"
        self.description = "Méta-plugin pour analyser une page de cache en lançant plusieurs plugins"

    def execute(self, inputs):
        print("inputs", inputs)
        print("START analysis_web_page")
        """
        1. Récupère l'ID de la géocache
        2. Lit la pipeline (liste de sous-plugins) dans plugin.json (ou DB).
        3. Pour chaque sous-plugin : exécute-le, agrège les résultats.
        """
        geocache_id = inputs.get('geocache_id')
        print("geocache_id", geocache_id)
        if not geocache_id:
            return {"error": "Missing 'geocache_id' in inputs."}
        
        # Récupérer la géocache depuis la base de données
        from app.models.geocache import Geocache
        from app import db
        
        geocache = db.session.query(Geocache).get(geocache_id)
        if not geocache:
            return {"error": f"Geocache with id {geocache_id} not found."}
        
        page_content = geocache.description
        if not page_content:
            return {"error": "No description found for this geocache."}
        
        # Charger la configuration (pipeline) depuis le plugin.json
        import os
        import json
        base_dir = os.path.dirname(__file__)
        plugin_json_path = os.path.join(base_dir, "plugin.json")
        with open(plugin_json_path, "r", encoding="utf-8") as f:
            config = json.load(f)

        pipeline = config.get("pipeline", [])

        # On prépare un dictionnaire pour stocker tous les résultats
        combined_results = {}

        # Importer ou récupérer PluginManager
        from app import get_plugin_manager
        plugin_manager = get_plugin_manager()

        # On itère sur les sous-plugins
        for step in pipeline:
            plugin_name = step["plugin_name"]
            # On construit les inputs pour ce sous-plugin (même paramètres que Multi Solver)
            plugin_inputs = {
                "text": page_content,
                "geocache_id": geocache_id,
                "enable_gps_detection": True,  # Paramètre clé pour la détection de coordonnées
                "mode": "decode",
                "strict": "smooth", 
                "embedded": True
                # ... on peut ajouter d'autres infos,
                # ou lire step["params"] si besoin
            }

            # Exécuter le plugin
            result = plugin_manager.execute_plugin(plugin_name, plugin_inputs)
            # On stocke le résultat dans combined_results
            combined_results[plugin_name] = result

        # **NOUVEAU** : Analyser le contenu des QR codes détectés pour les coordonnées
        if 'qr_code_detector' in combined_results:
            qr_results = combined_results['qr_code_detector']
            if qr_results and 'qr_codes' in qr_results:
                from app.routes.coordinates import detect_gps_coordinates
                
                for qr_code in qr_results['qr_codes']:
                    qr_content = qr_code.get('data', '')
                    if qr_content:
                        print(f"[DEBUG] Analyse des coordonnées dans QR code: '{qr_content}'")
                        
                        # Détecter les coordonnées dans le contenu du QR code
                        coords_result = detect_gps_coordinates(qr_content)
                        
                        if coords_result.get('exist', False):
                            print(f"[DEBUG] Coordonnées détectées dans QR code: {coords_result}")
                            
                            # Si coordinates_finder n'a pas trouvé de coordonnées, utiliser celles du QR code
                            if ('coordinates_finder' not in combined_results or 
                                not combined_results['coordinates_finder'].get('coordinates', {}).get('exist', False)):
                                
                                # Créer ou mettre à jour le résultat de coordinates_finder
                                if 'coordinates_finder' not in combined_results:
                                    combined_results['coordinates_finder'] = {'findings': [], 'coordinates': {}}
                                
                                combined_results['coordinates_finder']['coordinates'] = coords_result
                                combined_results['coordinates_finder']['coordinates']['source'] = 'qr_code_content'
                                
                                print(f"[DEBUG] Coordonnées du QR code ajoutées à coordinates_finder: {coords_result}")
                            
                            # Arrêter après le premier QR code avec des coordonnées valides
                            break

        # Déduplication intelligente des coordonnées
        # Priorité: coordinates_finder > color_text_detector > image_alt_text_extractor > formula_parser
        priority_plugins = ['coordinates_finder', 'color_text_detector', 'image_alt_text_extractor', 'formula_parser']
        detected_coordinates = []
        
        # Collecter toutes les coordonnées détectées avec leur source
        for plugin_name in priority_plugins:
            if plugin_name in combined_results:
                result = combined_results[plugin_name]
                if (result and isinstance(result, dict) and 'coordinates' in result):
                    coord_data = result['coordinates']
                    
                    # Vérifier que coord_data est un dictionnaire avant d'utiliser .get()
                    if isinstance(coord_data, dict) and coord_data.get('exist', False):
                        detected_coordinates.append({
                            'plugin': plugin_name,
                            'ddm': coord_data.get('ddm', '').strip(),
                            'confidence': coord_data.get('confidence', 0.75),
                            'data': coord_data
                        })
        
        # Si plusieurs plugins ont détecté des coordonnées, appliquer la déduplication
        if len(detected_coordinates) > 1:
            print(f"Déduplication des coordonnées : {len(detected_coordinates)} sources détectées")
            
            # Garder la source avec la plus haute priorité (premier dans la liste)
            primary_coord = detected_coordinates[0]
            primary_ddm = primary_coord['ddm']
            
            print(f"Coordonnée principale : {primary_ddm} (source: {primary_coord['plugin']})")
            
            # Supprimer les coordonnées similaires des autres plugins
            for coord in detected_coordinates[1:]:
                plugin_name = coord['plugin']
                coord_ddm = coord['ddm']
                
                # Normaliser pour comparaison
                normalized_primary = primary_ddm.replace("'", "").replace("°", "°").replace(" ", "")
                normalized_current = coord_ddm.replace("'", "").replace("°", "°").replace(" ", "")
                
                # Si les coordonnées sont similaires, supprimer de ce plugin
                if normalized_primary == normalized_current or normalized_current in normalized_primary:
                    print(f"Suppression de coordonnées dupliquées dans {plugin_name}")
                    
                    if plugin_name == 'formula_parser':
                        # Pour formula_parser, filtrer les coordonnées individuelles
                        if 'coordinates' in combined_results[plugin_name] and isinstance(combined_results[plugin_name]['coordinates'], list):
                            new_coords = []
                            for formula_coord in combined_results[plugin_name]['coordinates']:
                                # Vérifier que formula_coord est un dictionnaire avant d'utiliser .get()
                                if isinstance(formula_coord, dict):
                                    formula_ddm = f"{formula_coord.get('north', '')} {formula_coord.get('east', '')}".strip()
                                    norm_formula = formula_ddm.replace("'", "").replace("°", "°").replace(" ", "")
                                    if norm_formula not in normalized_primary:
                                        new_coords.append(formula_coord)
                                else:
                                    # Si ce n'est pas un dictionnaire, le garder tel quel
                                    new_coords.append(formula_coord)
                            combined_results[plugin_name]['coordinates'] = new_coords
                    else:
                        # Pour les autres plugins, supprimer complètement les coordonnées
                        combined_results[plugin_name]['coordinates'] = {"exist": False}
        
        # Ajouter les coordonnées décimales pour tous les résultats
        from app.routes.coordinates import convert_ddm_to_decimal
        primary_coordinates = None
        
        # Parcourir les résultats pour trouver les coordonnées principales
        for plugin_name, plugin_result in combined_results.items():
            if (plugin_result and isinstance(plugin_result, dict) and 'coordinates' in plugin_result):
                coords = plugin_result['coordinates']
                if isinstance(coords, dict) and coords.get('exist', False):
                    # Vérifier si les coordonnées ont déjà des décimales
                    if 'decimal' not in coords and coords.get('ddm_lat') and coords.get('ddm_lon'):
                        coords['decimal'] = convert_ddm_to_decimal(coords['ddm_lat'], coords['ddm_lon'])
                        print(f"Coordonnées décimales ajoutées pour {plugin_name}: {coords['decimal']}")
                    
                    # Stocker les coordonnées principales si elles ont des décimales
                    if 'decimal' in coords and coords['decimal'].get('latitude') is not None:
                        primary_coordinates = coords['decimal']
                        break
        
        # Ajouter les coordonnées principales au résultat global
        if primary_coordinates:
            print(f"Coordonnées principales détectées: {primary_coordinates}")
            combined_results['primary_coordinates'] = primary_coordinates
        
        print("combined_results", combined_results)
        # On retourne tous les résultats
        return {
            "combined_results": combined_results,
            "primary_coordinates": primary_coordinates
        }
