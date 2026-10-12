"""Execution des plugins pour le blueprint plugins.

Route d'execution synchrone ``/<plugin_name>/execute``, taches batch
(``BatchPluginTask``) et routes ``/batch-*``.
"""

import re
import threading
import time
import uuid
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor, as_completed
from flask import jsonify, request, current_app
from loguru import logger
from typing import Dict, Any, List, Optional

from ...database import db
from ...geocaches.models import Geocache

from ._common import (
    bp,
    get_plugin_manager,
)
from . import _common

# Stockage des taches batch en memoire (en production, utiliser Redis ou une base de donnees)
batch_tasks: Dict[str, 'BatchPluginTask'] = {}


class BatchPluginTask:
    """
    Classe pour gérer l'exécution batch d'un plugin sur plusieurs géocaches.
    """
    
    def __init__(
        self,
        task_id: str,
        plugin_name: str,
        geocaches: List[Dict],
        inputs: Dict[str, Any],
        execution_mode: str = 'sequential',
        max_concurrency: int = 3,
        detect_coordinates: bool = True,
        app=None,
        include_images: bool = False,
    ):
        self.task_id = task_id
        self.plugin_name = plugin_name
        self.geocaches = geocaches
        self.inputs = inputs
        self.execution_mode = execution_mode
        self.max_concurrency = max_concurrency
        self.detect_coordinates = detect_coordinates
        self.app = app
        self.include_images = include_images
        
        # État de la tâche
        self.status = 'pending'  # pending, running, completed, failed, cancelled
        self.started_at: Optional[datetime] = None
        self.completed_at: Optional[datetime] = None
        self.cancelled = False
        
        # Résultats par géocache
        self.results: List[Dict] = []
        for geocache in geocaches:
            self.results.append({
                'geocache_id': geocache['id'],
                'gc_code': geocache['gc_code'],
                'name': geocache['name'],
                'status': 'pending',
                'result': None,
                'error': None,
                'execution_time': None,
                'coordinates': None,
                'started_at': None,
                'completed_at': None
            })
    
    def execute(self):
        """
        Exécute la tâche batch selon le mode configuré.
        """
        try:
            self.status = 'running'
            self.started_at = datetime.utcnow()
            
            logger.info(f"Starting batch task {self.task_id}: {self.plugin_name} on {len(self.geocaches)} geocaches")

            if self.app is not None:
                with self.app.app_context():
                    if self.execution_mode == 'sequential':
                        self._execute_sequential()
                    else:
                        self._execute_parallel()
            else:
                if self.execution_mode == 'sequential':
                    self._execute_sequential()
                else:
                    self._execute_parallel()
            
            if not self.cancelled:
                self.status = 'completed'
                logger.info(f"Batch task {self.task_id} completed successfully")
            
        except Exception as e:
            self.status = 'failed'
            logger.error(f"Batch task {self.task_id} failed: {str(e)}")
        finally:
            self.completed_at = datetime.utcnow()
    
    def _execute_sequential(self):
        """
        Exécution séquentielle des géocaches.
        """
        for i, geocache in enumerate(self.geocaches):
            if self.cancelled:
                break
            
            result = self.results[i]
            result['status'] = 'executing'
            result['started_at'] = datetime.utcnow()
            
            try:
                start_time = time.time()
                
                # Préparer les inputs pour cette géocache
                geocache_inputs = self._prepare_inputs_for_geocache(geocache)
                
                # Exécuter le plugin
                plugin_manager = get_plugin_manager()
                plugin_result = plugin_manager.execute_plugin(
                    self.plugin_name, 
                    geocache_inputs
                )
                
                execution_time = (time.time() - start_time) * 1000  # en ms
                
                # Traiter les résultats
                processed_result = self._process_plugin_result(plugin_result, geocache)
                
                result.update({
                    'status': 'completed',
                    'result': plugin_result,
                    'coordinates': processed_result.get('coordinates'),
                    'execution_time': execution_time,
                    'completed_at': datetime.utcnow()
                })
                
            except Exception as e:
                result.update({
                    'status': 'error',
                    'error': str(e),
                    'completed_at': datetime.utcnow()
                })
                logger.error(f"Error executing plugin on {geocache['gc_code']}: {str(e)}")
            finally:
                try:
                    db.session.remove()
                except Exception:
                    pass
    
    def _execute_parallel(self):
        """
        Exécution parallèle des géocaches avec ThreadPoolExecutor.
        """
        def execute_single_geocache(geocache_data):
            geocache, result_index = geocache_data
            result = self.results[result_index]
            
            if self.cancelled:
                return result
            
            result['status'] = 'executing'
            result['started_at'] = datetime.utcnow()
            
            try:
                if self.app is not None:
                    ctx = self.app.app_context()
                    ctx.push()
                else:
                    ctx = None

                start_time = time.time()
                
                # Préparer les inputs pour cette géocache
                geocache_inputs = self._prepare_inputs_for_geocache(geocache)
                
                # Exécuter le plugin
                plugin_manager = get_plugin_manager()
                plugin_result = plugin_manager.execute_plugin(
                    self.plugin_name, 
                    geocache_inputs
                )
                
                execution_time = (time.time() - start_time) * 1000  # en ms
                
                # Traiter les résultats
                processed_result = self._process_plugin_result(plugin_result, geocache)
                
                result.update({
                    'status': 'completed',
                    'result': plugin_result,
                    'coordinates': processed_result.get('coordinates'),
                    'execution_time': execution_time,
                    'completed_at': datetime.utcnow()
                })
                
            except Exception as e:
                result.update({
                    'status': 'error',
                    'error': str(e),
                    'completed_at': datetime.utcnow()
                })
                logger.error(f"Error executing plugin on {geocache['gc_code']}: {str(e)}")
            finally:
                try:
                    db.session.remove()
                except Exception:
                    pass
                if ctx is not None:
                    try:
                        ctx.pop()
                    except Exception:
                        pass
            
            return result
        
        # Exécuter en parallèle avec ThreadPoolExecutor
        with ThreadPoolExecutor(max_workers=self.max_concurrency) as executor:
            # Soumettre toutes les tâches
            future_to_index = {
                executor.submit(execute_single_geocache, (geocache, i)): i 
                for i, geocache in enumerate(self.geocaches)
            }
            
            # Traiter les résultats au fur et à mesure
            for future in as_completed(future_to_index):
                if self.cancelled:
                    break
                try:
                    future.result()
                except Exception as e:
                    index = future_to_index[future]
                    self.results[index].update({
                        'status': 'error',
                        'error': str(e),
                        'completed_at': datetime.utcnow()
                    })
    
    def _prepare_inputs_for_geocache(self, geocache: Dict) -> Dict[str, Any]:
        """
        Prépare les inputs du plugin pour une géocache spécifique.
        """
        inputs = self.inputs.copy()
        
        # Injecter les données spécifiques à la géocache
        plugin_manager = get_plugin_manager()
        plugin_info = plugin_manager.get_plugin_info(self.plugin_name)
        if plugin_info and 'metadata' in plugin_info and 'input_types' in plugin_info['metadata']:
            input_types = plugin_info['metadata']['input_types']
            
            for key, input_type in input_types.items():
                default_value_source = input_type.get('default_value_source')
                
                if default_value_source == 'geocache_id':
                    inputs[key] = geocache['gc_code']
                elif default_value_source == 'geocache_description' and 'description' in geocache:
                    inputs[key] = geocache['description']
                elif default_value_source == 'geocache_coordinates' and geocache.get('coordinates'):
                    coords = geocache['coordinates']
                    inputs[key] = coords.get('coordinates_raw') or f"{coords['latitude']}, {coords['longitude']}"

            if self.include_images and 'images' in input_types and geocache.get('images') and not inputs.get('images'):
                inputs['images'] = geocache['images']

            if 'waypoints' in input_types and geocache.get('waypoints') and not isinstance(inputs.get('waypoints'), list):
                inputs['waypoints'] = geocache.get('waypoints') or []
        
        return inputs
    
    def _process_plugin_result(self, plugin_result: Dict, geocache: Dict) -> Dict:
        """
        Traite les résultats du plugin (détection de coordonnées, etc.).
        """
        processed = {}

        primary = plugin_result.get('primary_coordinates')
        if isinstance(primary, dict):
            lat = primary.get('latitude')
            lon = primary.get('longitude')
            if lat is not None and lon is not None:
                formatted = None
                for item in plugin_result.get('results') or []:
                    coords = item.get('coordinates')
                    if isinstance(coords, dict) and coords.get('formatted'):
                        formatted = coords.get('formatted')
                        break
                if not formatted:
                    formatted = f"{lat}, {lon}"
                try:
                    processed['coordinates'] = {
                        'latitude': float(lat),
                        'longitude': float(lon),
                        'formatted': str(formatted)
                    }
                    return processed
                except Exception:
                    pass

        if plugin_result.get('results'):
            for item in plugin_result.get('results'):
                lat = item.get('decimal_latitude')
                lon = item.get('decimal_longitude')
                if lat is not None and lon is not None:
                    formatted = None
                    coords = item.get('coordinates')
                    if isinstance(coords, dict):
                        formatted = coords.get('formatted')
                    if not formatted:
                        formatted = f"{lat}, {lon}"
                    try:
                        processed['coordinates'] = {
                            'latitude': float(lat),
                            'longitude': float(lon),
                            'formatted': str(formatted)
                        }
                        return processed
                    except Exception:
                        continue
        
        if self.detect_coordinates and plugin_result.get('results'):
            for item in plugin_result['results']:
                text_output = item.get('text_output')
                if text_output:
                    try:
                        # Utiliser directement la fonction de détection (pas l'API)
                        from gc_backend.blueprints.coordinates import detect_gps_coordinates
                        
                        logger.info(f"[Batch] Détection de coordonnées dans: {text_output[:100]}...")
                        
                        coords = detect_gps_coordinates(text_output, include_numeric_only=False)
                        
                        if coords.get('exist'):
                            logger.info(f"[Batch] Coordonnées trouvées: {coords.get('ddm')}")
                            processed['coordinates'] = {
                                'latitude': coords.get('decimal_latitude', 0),
                                'longitude': coords.get('decimal_longitude', 0),
                                'formatted': coords.get('ddm', '')
                            }
                            break
                        else:
                            logger.info(f"[Batch] Aucune coordonnée détectée dans ce résultat")
                    except Exception as e:
                        logger.warning(f"Error detecting coordinates: {str(e)}")
                        import traceback
                        traceback.print_exc()
        
        return processed
    
    def cancel(self):
        """
        Annule la tâche.
        """
        self.cancelled = True
        if self.status == 'running':
            self.status = 'cancelled'
        logger.info(f"Batch task {self.task_id} cancellation requested")
    
    def get_status(self) -> Dict:
        """
        Retourne le statut actuel de la tâche.
        """
        completed_count = len([r for r in self.results if r['status'] == 'completed'])
        error_count = len([r for r in self.results if r['status'] == 'error'])
        total_count = len(self.results)
        
        progress_percentage = (completed_count / total_count * 100) if total_count > 0 else 0
        
        return {
            'task_id': self.task_id,
            'plugin_name': self.plugin_name,
            'status': self.status,
            'progress': {
                'completed': completed_count,
                'errors': error_count,
                'total': total_count,
                'percentage': round(progress_percentage, 1)
            },
            'results': self.results,
            'started_at': self.started_at.isoformat() if self.started_at else None,
            'completed_at': self.completed_at.isoformat() if self.completed_at else None,
            'execution_mode': self.execution_mode,
            'cancelled': self.cancelled
        }


# =============================================================================
# Routes d'execution
# =============================================================================

@bp.route('/<plugin_name>/execute', methods=['POST'])
def execute_plugin(plugin_name: str):
    """
    Exécute un plugin de manière synchrone.
    
    Cette route est adaptée pour les plugins rapides (< 1s).
    Pour les plugins longs, utiliser /api/tasks (Phase 2.2).
    
    Args:
        plugin_name (str): Nom du plugin à exécuter
        
    Request Body (JSON):
        inputs (dict): Paramètres d'entrée du plugin
        
    Returns:
        JSON: Résultat de l'exécution au format standardisé
        
    Example:
        POST /api/plugins/caesar/execute
        {
            "inputs": {
                "text": "HELLO",
                "mode": "encode",
                "shift": 13
            }
        }
    """
    try:
        manager = get_plugin_manager()
        
        # Récupérer les inputs depuis le body JSON (gestion explicite des erreurs JSON)
        try:
            data = request.get_json(force=True)
        except Exception as json_error:
            return jsonify({
                "error": "JSON invalide",
                "message": f"Le body de la requête doit être un JSON valide: {str(json_error)}"
            }), 400
        
        if not data or 'inputs' not in data:
            return jsonify({
                "error": "Requête invalide",
                "message": "Le champ 'inputs' est requis dans le body JSON"
            }), 400
        
        inputs = data['inputs']
        
        logger.info(
            f"Exécution synchrone du plugin {plugin_name} "
            f"avec inputs: {list(inputs.keys())}"
        )
        
        # Résolution du flag de scoring : enable_scoring dans les inputs,
        # sinon la valeur déclarée dans le plugin.json (metadata).
        plugin_info = manager.get_plugin_info(plugin_name) or {}
        metadata = plugin_info.get('metadata') if isinstance(plugin_info, dict) else {}
        plugin_enable_scoring = False
        if isinstance(metadata, dict) and 'enable_scoring' in metadata:
            plugin_enable_scoring = bool(metadata.get('enable_scoring'))
        enable_scoring = bool(inputs.get('enable_scoring', plugin_enable_scoring))

        # Exécuter le plugin : la normalisation des inputs (text_handling),
        # la normalisation du résultat et le scoring opt-in sont gérés par
        # la couche centrale d'exécution (plugins/executor.py via le manager).
        result = manager.execute_plugin(
            plugin_name, inputs, apply_scoring=enable_scoring
        )

        if not result:
            return jsonify({
                "error": "Erreur d'exécution",
                "message": f"Le plugin {plugin_name} n'a pas pu être exécuté"
            }), 500

        logger.info(
            f"Plugin {plugin_name} exécuté avec succès "
            f"(status: {result.get('status')})"
        )

        # Tracking : si le plugin s'exécute avec succès sur une géocache, enregistrer dans l'archive
        try:
            geocache_id_raw = inputs.get('geocache_id')
            # status est normalise en 'ok'/'error' par l'executor : le tracking
            # se base uniquement sur la presence de resultats.
            has_results = bool(result.get('results'))
            if geocache_id_raw and has_results:
                geocache_for_tracking = Geocache.query.get(int(geocache_id_raw))
                if geocache_for_tracking:
                    from ...geocaches.archive_service import ArchiveService
                    ArchiveService.add_resolution_plugin(geocache_for_tracking.gc_code, plugin_name)
        except Exception:
            pass  # Le tracking ne doit jamais bloquer l'exécution du plugin

        return jsonify(result), 200
        
    except Exception as e:
        logger.error(
            f"Erreur lors de l'exécution du plugin {plugin_name}: {e}",
            exc_info=True
        )
        return jsonify({
            "error": "Erreur d'exécution",
            "message": str(e)
        }), 500


@bp.route('/batch-execute', methods=['POST'])
def batch_execute_plugins():
    """
    Exécute un plugin sur plusieurs géocaches en mode batch.
    
    Request body:
    {
        "plugin_name": "caesar",
        "geocache_ids": [123, 456, 789],
        "inputs": {"mode": "decode", "shift": 3},
        "options": {
            "execution_mode": "sequential",  # ou "parallel"
            "max_concurrency": 3,
            "detect_coordinates": true
        }
    }
    
    Response:
    {
        "task_id": "uuid-string",
        "status": "started",
        "total_geocaches": 3,
        "message": "Batch execution started"
    }
    """
    try:
        data = request.get_json()
        if not data:
            return jsonify({"error": "No JSON data provided"}), 400
        
        # Validation des paramètres requis
        plugin_name = data.get('plugin_name')
        geocache_ids = data.get('geocache_ids', [])
        inputs = data.get('inputs', {})
        options = data.get('options', {})
        
        if not plugin_name:
            return jsonify({"error": "plugin_name is required"}), 400
        
        if not geocache_ids or not isinstance(geocache_ids, list):
            return jsonify({"error": "geocache_ids must be a non-empty list"}), 400
        
        # Validation du plugin
        plugin_info = _common._plugin_manager.get_plugin_info(plugin_name)
        if not plugin_info:
            return jsonify({"error": f"Plugin '{plugin_name}' not found"}), 404
        
        # Options par défaut
        execution_mode = options.get('execution_mode', 'sequential')
        max_concurrency = options.get('max_concurrency', 3)
        detect_coordinates = options.get('detect_coordinates', True)
        include_images = options.get('include_images', False)
        
        # Validation du mode d'exécution
        if execution_mode not in ['sequential', 'parallel']:
            return jsonify({"error": "execution_mode must be 'sequential' or 'parallel'"}), 400
        
        # Créer une tâche batch
        task_id = str(uuid.uuid4())
        
        # Récupérer les informations des géocaches
        geocaches = []
        for gc_id in geocache_ids:
            geocache = Geocache.query.get(gc_id)
            if geocache:
                decoded_hint = geocache.hints_decoded
                if decoded_hint is None and geocache.hints:
                    decoded_hint = Geocache.decode_hint_rot13(geocache.hints)
                # Utiliser description_html en priorité (avec stripping), sinon description_raw
                description = geocache.description_raw or ''
                if geocache.description_html:
                    import re
                    # Strip HTML tags
                    description = re.sub(r'<[^>]+>', ' ', geocache.description_html)
                    description = re.sub(r'\s+', ' ', description).strip()
                geocaches.append({
                    'id': geocache.id,
                    'gc_code': geocache.gc_code,
                    'name': geocache.name,
                    'description': description,
                    'hint': decoded_hint,
                    'difficulty': geocache.difficulty,
                    'terrain': geocache.terrain,
                    'images': geocache.images or [],
                    'coordinates': {
                        'latitude': geocache.latitude,
                        'longitude': geocache.longitude,
                        'coordinates_raw': geocache.coordinates_raw
                    } if geocache.latitude and geocache.longitude else None,
                    'waypoints': geocache.waypoints or []
                })
        
        if len(geocaches) != len(geocache_ids):
            found_ids = [g['id'] for g in geocaches]
            missing_ids = [gid for gid in geocache_ids if gid not in found_ids]
            return jsonify({
                "error": f"Some geocaches not found: {missing_ids}",
                "found_count": len(geocaches),
                "requested_count": len(geocache_ids)
            }), 404
        
        # Démarrer la tâche en arrière-plan
        batch_task = BatchPluginTask(
            task_id=task_id,
            plugin_name=plugin_name,
            geocaches=geocaches,
            inputs=inputs,
            execution_mode=execution_mode,
            max_concurrency=max_concurrency,
            detect_coordinates=detect_coordinates,
            app=current_app._get_current_object(),
            include_images=include_images,
        )
        
        # Stocker la tâche
        batch_tasks[task_id] = batch_task
        
        # Démarrer l'exécution en arrière-plan
        thread = threading.Thread(target=batch_task.execute)
        thread.daemon = True
        thread.start()
        
        return jsonify({
            "task_id": task_id,
            "status": "started",
            "total_geocaches": len(geocaches),
            "execution_mode": execution_mode,
            "message": f"Batch execution started for {len(geocaches)} geocaches"
        })
        
    except Exception as e:
        current_app.logger.error(f"Error in batch_execute_plugins: {str(e)}")
        raise


@bp.route('/batch-status/<task_id>', methods=['GET'])
def get_batch_status(task_id):
    """
    Récupère le statut d'une tâche batch.
    
    Response:
    {
        "task_id": "uuid-string",
        "status": "running|completed|failed",
        "progress": {
            "completed": 2,
            "total": 3,
            "percentage": 66.7
        },
        "results": [
            {
                "geocache_id": 123,
                "gc_code": "GC123",
                "status": "completed|error",
                "result": {...},
                "error": "Error message if any",
                "execution_time": 1500,
                "coordinates": {
                    "latitude": 48.123,
                    "longitude": 2.456,
                    "formatted": "N 48° 07.380 E 002° 27.360"
                }
            }
        ],
        "started_at": "2023-...",
        "completed_at": "2023-..."  # si terminé
    }
    """
    if task_id not in batch_tasks:
        return jsonify({"error": "Task not found"}), 404
    
    task = batch_tasks[task_id]
    return jsonify(task.get_status())


@bp.route('/batch-cancel/<task_id>', methods=['POST'])
def cancel_batch_task(task_id):
    """
    Annule une tâche batch en cours.
    
    Response:
    {
        "message": "Task cancelled successfully"
    }
    """
    if task_id not in batch_tasks:
        return jsonify({"error": "Task not found"}), 404
    
    task = batch_tasks[task_id]
    task.cancel()
    
    return jsonify({"message": "Task cancellation requested"})


@bp.route('/batch-list', methods=['GET'])
def list_batch_tasks():
    """
    Liste toutes les tâches batch (actives et terminées).
    
    Response:
    {
        "tasks": [
            {
                "task_id": "uuid",
                "plugin_name": "caesar",
                "status": "completed",
                "total_geocaches": 5,
                "completed_geocaches": 5,
                "started_at": "2023-...",
                "completed_at": "2023-..."
            }
        ]
    }
    """
    tasks_info = []
    for task_id, task in batch_tasks.items():
        tasks_info.append({
            "task_id": task_id,
            "plugin_name": task.plugin_name,
            "status": task.status,
            "total_geocaches": len(task.geocaches),
            "completed_geocaches": len([r for r in task.results if r['status'] == 'completed']),
            "started_at": task.started_at.isoformat() if task.started_at else None,
            "completed_at": task.completed_at.isoformat() if task.completed_at else None
        })
    
    return jsonify({"tasks": tasks_info})
