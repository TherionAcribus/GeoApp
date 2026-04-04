from loguru import logger  # noqa: F401

class MetaDetectionPlugin:
    """
    Plugin de détection et décodage de codes.
    
    Ce plugin permet de détecter automatiquement les codes potentiels dans un texte
    et de les décoder en utilisant les plugins appropriés.
    """

    def __init__(self):
        """
        Initialise le plugin de détection de codes.
        """
        self.name = "metadetection"
        self.description = "Détecte et décode automatiquement les codes"

    def execute(self, inputs: dict) -> dict:
        """
        Point d'entrée principal du plugin.
        
        Args:
            inputs: Dictionnaire contenant les paramètres d'entrée
                - mode: "detect" ou "decode"
                - text: Texte à analyser ou décoder
                - strict: "strict" ou "smooth" pour le mode d'analyse
                - allowed_chars: Liste de caractères autorisés pour le mode smooth
                - embedded: True si le texte peut contenir du code intégré, False si tout le texte doit être du code
                - plugin_name: Nom du plugin à utiliser (optionnel)
                - enable_gps_detection: True pour activer la détection des coordonnées GPS (optionnel)
                - enable_bruteforce: True pour activer la force brute (optionnel)
                
        Returns:
            Dictionnaire contenant le résultat de l'opération au format standardisé
        """
        mode = inputs.get("mode", "detect").lower()
        text = inputs.get("text", "")
        plugin_name = inputs.get("plugin_name")
        key = inputs.get("key")
        ws_session_id = inputs.get("ws_session_id")
        # Coordonnées d'origine éventuelles (DDM)
        origin_coords = inputs.get("origin_coords")

        # Prépare l'accès au service WebSocket si disponible
        ws_service = None
        try:
            from app.services.websocket_service import get_websocket_service
            ws_service = get_websocket_service()
        except Exception:
            ws_service = None

        def emit_progress(step: str, message: str, progress: int | None = None, data: dict | None = None):
            if ws_service and ws_session_id:
                try:
                    ws_service.emit_progress(ws_session_id, step, message, progress, data or {})
                except Exception:
                    pass
        
        # Récupération du mode strict/smooth
        strict = inputs.get("strict", True) == "strict"
        strict_param = "strict" if strict else "smooth"
        
        print('param strict', strict, mode)
        
        # Récupération des caractères autorisés
        allowed_chars = inputs.get("allowed_chars", None)
        
        # Récupération du mode embedded
        embedded = inputs.get("embedded", False)
        
        # Récupération du paramètre de détection GPS
        enable_gps_detection = inputs.get("enable_gps_detection", True)  # noqa: F841
        
        # Récupération du paramètre de force brute
        enable_bruteforce = inputs.get("enable_bruteforce", True)
        
        if not text:
            return {
                "status": "error",
                "plugin_info": {
                    "name": self.name,
                    "version": "1.1.3"
                },
                "results": [],
                "summary": {
                    "message": "Aucun texte fourni",
                    "total_results": 0
                }
            }
            
        # Mesurer le temps d'exécution
        import time
        start_time = time.time()
            
        if mode == "detect":
            emit_progress('prepare', 'Préparation de la détection...', 5, {
                'phase': 'detect',
            })
            # Ancien format pour rétrocompatibilité avec l'UI
            # Passer plugin_scope si fourni en entrée
            scope = inputs.get("plugin_scope")
            try:
                from loguru import logger as _lg
                _lg.debug(f"MetaDetection.detect: plugin_scope={scope}")
            except Exception:
                pass
            old_result = self.detect_codes(text, strict, allowed_chars, embedded, plugin_scope=scope or "selected")
            
            # Conversion au nouveau format standardisé
            possible_codes = old_result.get("result", {}).get("possible_codes", [])
            
            # Préparation des résultats standardisés
            standardized_results = []
            combined_results = {}
            tested_plugins_meta = old_result.get("result", {}).get("tested_plugins", [])
            skipped_plugins_meta = old_result.get("result", {}).get("skipped_plugins", [])
            
            for idx, code in enumerate(possible_codes):
                plugin_name = code.get("plugin_name", "unknown")
                score = code.get("score", 0)
                fragments = code.get("fragments", [])
                fragment_values = [f.get("value", "") for f in fragments if "value" in f]
                
                result_id = f"result_{idx+1}"
                
                # Créer un résultat standardisé pour chaque plugin détecté
                standardized_results.append({
                    "id": result_id,
                    "text_output": f"Plugin: {plugin_name}\nFragments détectés: {', '.join(fragment_values)}",
                    # Neutraliser la confiance en mode détection pour ne pas polluer le tri central
                    "confidence": 0.0,
                    "plugin_confidence": score,
                    "parameters": {
                        "plugin": plugin_name,
                        "mode": "detect",
                        "strict": "strict" if strict else "smooth"
                    },
                    "metadata": {
                        "fragments": fragment_values,
                        "can_decode": code.get("can_decode", False)
                    }
                })

                # Émettre une progression pour chaque plugin détecté
                try:
                    progress_pct = 10 + int((idx + 1) / max(1, len(possible_codes)) * 60)
                except Exception:
                    progress_pct = None
                emit_progress('detect_found', f"Détection: {plugin_name} (score {score})", progress_pct, {
                    'plugin': plugin_name,
                    'fragments': fragment_values,
                    'score': score,
                    'can_decode': code.get('can_decode', False)
                })
                
                # Ajouter au dictionnaire combined_results pour la rétrocompatibilité
                combined_results[plugin_name] = {
                    "fragments": fragment_values,
                    # Conserver la confiance brute détectée, mais l'UI sera écrasée par la propagation centrale
                    "confidence": 0.0,
                    "plugin_confidence": score,
                    "can_decode": code.get("can_decode", False)
                }
            
            # Format standardisé complet
            execution_time = int((time.time() - start_time) * 1000)
            
            return {
                "status": "success" if standardized_results else "partial_success",
                "plugin_info": {
                    "name": self.name,
                    "version": "1.1.3",
                    "execution_time": execution_time
                },
                "inputs": {
                    "mode": mode,
                    "text": text,
                    "strict": "strict" if strict else "smooth",
                    "embedded": embedded,
                    "enable_bruteforce": enable_bruteforce
                },
                "results": standardized_results,
                "combined_results": combined_results,
                "tested_plugins": tested_plugins_meta,
                "skipped_plugins": skipped_plugins_meta,
                "summary": {
                    "best_result_id": standardized_results[0]["id"] if standardized_results else None,
                    "total_results": len(standardized_results),
                    "message": f"{len(standardized_results)} plugins détectés" if standardized_results else "Aucun code détecté"
                }
            }
            
        elif mode == "decode":
            # Récupérer plugin_scope depuis les inputs
            scope = inputs.get("plugin_scope", "selected")
            try:
                from loguru import logger as _lg
                _lg.debug(f"MetaDetection.decode: plugin_scope={scope}")
            except Exception:
                pass

            # Récupérer les résultats de décodage (format standardisé uniquement)
            emit_progress('decode_start', 'Début du décodage...', 10, {
                'phase': 'decode',
                'plugin': plugin_name or 'auto'
            })
            # Logs: liste explicite de plugins si fournie
            try:
                from loguru import logger as _lg
                _lg.debug(f"MetaDetection.decode: explicit decode_plugins? count={(len(inputs.get('decode_plugins')) if isinstance(inputs.get('decode_plugins'), list) else 0)}")
            except Exception:
                pass
            decode_results = self.decode_code(
                plugin_name,
                text,
                strict_param,
                allowed_chars,
                embedded,
                key,
                enable_bruteforce,
                ws_session_id=ws_session_id,
                ws_service=ws_service,
                origin_coords=origin_coords,
                plugin_scope=scope,
                decode_plugins=inputs.get('decode_plugins')
            )
            
            # Mesure du temps d'exécution
            execution_time = int((time.time() - start_time) * 1000)
            
            # En cas d'absence de résultat, retourner une erreur formatée
            if not decode_results["results"]:
                emit_progress('finalizing', "Finalisation: aucun résultat", 100)
                return {
                    "status": "error",
                    "plugin_info": {
                        "name": self.name,
                        "version": "1.1.3",
                        "execution_time": execution_time
                    },
                    "results": [],
                    "summary": {
                        "message": "Aucun plugin n'a pu décoder le texte",
                        "total_results": 0
                    }
                }
            
            # Sinon, retourner les résultats formatés (pas de recalcul lourd ici)
            emit_progress('finalizing', "Finalisation des résultats...", 95, {
                'results': len(decode_results["results"]) if isinstance(decode_results, dict) else 0
            })
            return {
                "status": "success",
                "plugin_info": {
                    "name": self.name,
                    "version": "1.1.3",
                    "execution_time": execution_time
                },
                "inputs": {
                    "mode": mode,
                    "text": text,
                    "strict": strict_param,
                    "embedded": embedded,
                    "plugin_name": plugin_name,
                    "enable_bruteforce": enable_bruteforce
                },
                "results": decode_results["results"],
                "combined_results": decode_results["combined_results"],
                "primary_coordinates": decode_results["primary_coordinates"],
                "failed_plugins": decode_results.get("failed_plugins", []),
                "summary": {
                    "best_result_id": decode_results["best_result_id"],
                    "total_results": len(decode_results["results"]),
                    "message": f"{len(decode_results['results'])} résultats de décodage"
                }
            }
        else:
            return {
                "status": "error",
                "plugin_info": {
                    "name": self.name,
                    "version": "1.1.3"
                },
                "results": [],
                "summary": {
                    "message": f"Mode non reconnu : {mode}",
                    "total_results": 0
                }
            }

    def detect_codes(self, text: str, strict: bool = True, allowed_chars: list = None, embedded: bool = False, plugin_scope: str = "selected") -> dict:
        """
        Détecte les codes potentiels dans un texte.
        
        Args:
            text: Texte à analyser
            strict: Mode strict (True) ou smooth (False)
            allowed_chars: Liste de caractères autorisés pour le mode smooth
            embedded: True si le texte peut contenir du code intégré, False si tout le texte doit être du code
            
        Returns:
            Un dictionnaire contenant les codes détectés
        """
        from app import get_plugin_manager
        plugin_manager = get_plugin_manager()
        
        # Résolution dynamique des plugins éligibles à l'analyse
        scope = (plugin_scope or "selected").lower()
        if scope == "all":
            # Ignorer les overrides pour avoir tous les éligibles
            resolved_plugins = plugin_manager.get_plugins_for(role="analysis", ignore_overrides=True)
        else:
            # Respecter la sélection utilisateur (enabled/disabled)
            resolved_plugins = plugin_manager.get_plugins_for(role="analysis", ignore_overrides=False)
        try:
            from loguru import logger as _lg
            _lg.debug(f"MetaDetection.detect_codes: scope={scope}, resolved_plugins={len(resolved_plugins)}")
        except Exception:
            pass

        # Préparer la liste des plugins chargés (hors metadetection) pour indiquer ceux non testés
        all_loaded = [name for name in plugin_manager.loaded_plugins.keys() if name != "metadetection"]
        names_to_test = set(resolved_plugins)
        tested_plugins: list[dict] = []
        skipped_plugins: list[dict] = []

        # Marquer les non testés avec une raison approximative
        for name in all_loaded:
            if name not in names_to_test:
                wrapper = plugin_manager.loaded_plugins.get(name)
                inst = getattr(wrapper, "_instance", None) if wrapper else None
                reason = "disabled_by_preferences_or_metadata"
                if not inst:
                    reason = "not_initialized"
                elif not hasattr(inst, "check_code"):
                    reason = "no_check_code"
                skipped_plugins.append({"plugin": name, "reason": reason})
        
        if not text:
            return {"result": {"possible_codes": []}}
        
        possible_codes = []
        
        # Récupérer les plugins éligibles via le résolveur
        for plugin_name in resolved_plugins:
            plugin_wrapper = plugin_manager.loaded_plugins.get(plugin_name)
            if not plugin_wrapper:
                continue
            
            # Obtenir l'instance du plugin
            p_instance = getattr(plugin_wrapper, "_instance", None)
            if not p_instance:
                continue
            
            # Vérifier si le plugin a une méthode check_code
            if not hasattr(p_instance, "check_code"):
                continue
            
            # Essayer d'analyser avec ce plugin
            try:
                import time as _time
                _t0 = _time.time()
                # Convertir le paramètre strict en booléen pour check_code
                strict_bool = strict if isinstance(strict, bool) else strict == "strict"
                
                # Appeler la méthode check_code avec les paramètres appropriés
                check_result = p_instance.check_code(text, strict_bool, allowed_chars, embedded)
                
                if check_result and isinstance(check_result, dict):
                    # Si le plugin a détecté quelque chose
                    if check_result.get("is_match", False):
                        code_info = {
                            "plugin_name": plugin_name,
                            "score": check_result.get("score", 1.0),
                            "can_decode": hasattr(p_instance, "execute"),
                            "fragments": check_result.get("fragments", [])
                        }
                        
                        possible_codes.append(code_info)
                    # Ajouter au rapport testé
                    tested_plugins.append({
                        "plugin": plugin_name,
                        "is_match": bool(check_result.get("is_match", False)),
                        "score": float(check_result.get("score", 0.0) or 0.0),
                        "fragments_count": len(check_result.get("fragments", []) or []),
                        "time_ms": int((_time.time() - _t0) * 1000),
                        "can_decode": bool(hasattr(p_instance, "execute")),
                        "error": None
                    })
            except Exception as e:
                print(f"Erreur lors de l'analyse avec {plugin_name}: {str(e)}")
                try:
                    import time as _time
                    time_ms = int((_time.time() - _t0) * 1000)
                except Exception:
                    time_ms = None
                tested_plugins.append({
                    "plugin": plugin_name,
                    "is_match": False,
                    "score": 0.0,
                    "fragments_count": 0,
                    "time_ms": time_ms,
                    "can_decode": False,
                    "error": str(e)
                })
                continue
        
        # Trier les résultats par score décroissant
        possible_codes.sort(key=lambda x: x["score"], reverse=True)
        
        return {
            "result": {
                "possible_codes": possible_codes,
                "tested_plugins": tested_plugins,
                "skipped_plugins": skipped_plugins
            }
        }

    def decode_code(self, plugin_name: str = None, text: str = "", strict: str = "smooth", allowed_chars: list = None, embedded: bool = False, key: str = None, brute_force: bool = True, ws_session_id: str | None = None, ws_service=None, origin_coords: dict | None = None, plugin_scope: str = "selected", decode_plugins: list | None = None) -> dict:
        """
        Décode un texte en utilisant soit un plugin spécifique, soit tous les plugins ayant une méthode execute.
        
        Args:
            plugin_name: Nom du plugin à utiliser pour le décodage (optionnel)
            text: Texte à décoder
            strict: Mode de décodage "strict" ou "smooth"
            allowed_chars: Liste de caractères autorisés pour le mode smooth
            embedded: True si le texte peut contenir du code intégré, False si tout le texte doit être du code
            
        Returns:
            Un dictionnaire contenant le résultat du décodage au format standardisé
        """
        from app import get_plugin_manager
        plugin_manager = get_plugin_manager()
        
        # Liste des plugins à exclure pour éviter les boucles récursives
        excluded_plugins = ["metadetection"]

        # Si une liste explicite est fournie, l'utiliser en priorité
        if isinstance(decode_plugins, list) and len(decode_plugins) > 0:
            included_plugins = [p for p in decode_plugins if p not in excluded_plugins]
            try:
                from loguru import logger as _lg
                _lg.debug(f"MetaDetection.decode_code: using explicit decode_plugins list, count={len(included_plugins)}")
            except Exception:
                pass
        else:
            # Déterminer si on doit ignorer les overrides utilisateur
            ignore_overrides = plugin_scope.lower() == "all"

            # Utiliser PluginManager pour obtenir la liste des plugins selon la portée
            try:
                plugins_to_test = plugin_manager.get_plugins_for("decode", ignore_overrides=ignore_overrides)
                # Filtrer les plugins exclus
                included_plugins = [p for p in plugins_to_test if p not in excluded_plugins]
                try:
                    from loguru import logger as _lg
                    _lg.debug(f"MetaDetection.decode_code: scope={plugin_scope}, ignore_overrides={ignore_overrides}, resolved_plugins={len(included_plugins)}")
                except Exception:
                    pass
            except Exception as e:
                # Fallback vers une liste vide si PluginManager échoue
                included_plugins = []
                try:
                    from loguru import logger as _lg
                    _lg.error(f"MetaDetection.decode_code: échec récupération plugins via PluginManager: {e}")
                except Exception:
                    pass
        
        # Structure du résultat standardisé
        result_structure = {
            "results": [],
            "combined_results": {},
            "primary_coordinates": None,
            "best_result_id": None,
            "failed_plugins": []  # Suivi des échecs
        }
        
        def emit_progress(step: str, message: str, progress: int | None = None, data: dict | None = None):
            if ws_service and ws_session_id:
                try:
                    ws_service.emit_progress(ws_session_id, step, message, progress, data or {})
                except Exception:
                    pass

        def _check_controls() -> str | None:
            """Retourne 'canceled' si annulé, 'paused' si en pause, sinon None."""
            if not (ws_service and ws_session_id):
                return None
            try:
                control = ws_service.get_control(ws_session_id)
            except Exception:
                control = None
            if not control:
                return None
            if control.get('canceled'):
                return 'canceled'
            if control.get('paused'):
                return 'paused'
            return None

        def _handle_pause_loop():
            """Boucle d'attente pendant la pause, jusqu'à reprise/annulation."""
            import time
            while True:
                state = _check_controls()
                if state == 'paused':
                    try:
                        ws_service.emit_progress(ws_session_id, 'paused', 'En pause', None, {})
                    except Exception:
                        pass
                    time.sleep(0.3)
                    continue
                break

        # Cache local de scoring pour éviter de rescorrer plusieurs fois le même texte
        scoring_cache: dict[str, dict] = {}

        if plugin_name:
            # Si un plugin spécifique est demandé
            if plugin_name in excluded_plugins:
                return result_structure
            
            # Vérifier si le plugin est dans la liste des plugins inclus en phase de test
            if included_plugins and plugin_name not in included_plugins:
                return result_structure
            
            # Obtenir le plugin directement depuis loaded_plugins
            plugin_wrapper = plugin_manager.loaded_plugins.get(plugin_name)
            if not plugin_wrapper:
                return result_structure
            
            # Obtenir l'instance du plugin
            p_instance = getattr(plugin_wrapper, "_instance", None)
            if not p_instance:
                return result_structure
            
            # Utiliser la méthode execute du plugin
            try:
                # Contrôles utilisateur avant d'exécuter
                state = _check_controls()
                if state == 'canceled':
                    emit_progress('completed', 'Annulé par utilisateur', 100)
                    return result_structure
                if state == 'paused':
                    _handle_pause_loop()
                emit_progress('decode_try_plugin', f"Décodage avec {plugin_name}...", 30, {'plugin': plugin_name})
                inputs = {
                    "text": text,
                    "strict": strict,
                    "mode": "decode",
                    "embedded": embedded,
                    "enable_gps_detection": True,
                    "enable_bruteforce": brute_force,
                    "bruteforce": brute_force,
                    "brute_force": brute_force
                }
                if key:
                    inputs["key"] = key
                
                # Ajouter les caractères autorisés si fournis
                if allowed_chars:
                    inputs["allowed_chars"] = allowed_chars
                
                plugin_result = p_instance.execute(inputs)
                
                # Traiter uniquement les résultats au format standardisé
                return self._process_standardized_result(plugin_result, plugin_name, scoring_cache=scoring_cache, origin_coords=origin_coords)
                
            except Exception as e:
                print(f"Erreur lors du décodage avec {plugin_name}: {str(e)}")
                result_structure["failed_plugins"].append({"plugin": plugin_name, "reason": str(e)})
                return result_structure
        else:
            # Si aucun plugin spécifique n'est demandé, essayer tous les plugins
            all_results = []
            combined_results = {}
            primary_coordinates = None
            
            # Parcourir tous les plugins chargés
            total_plugins = sum(1 for name in plugin_manager.loaded_plugins.keys() if name not in excluded_plugins and (not included_plugins or name in included_plugins))
            processed_count = 0
            for plugin_name, plugin_wrapper in plugin_manager.loaded_plugins.items():
                # Ignorer les plugins exclus
                if plugin_name in excluded_plugins:
                    continue
                
                # Ignorer les plugins non inclus dans la liste de test
                if included_plugins and plugin_name not in included_plugins:
                    continue
                
                # Obtenir l'instance du plugin
                p_instance = getattr(plugin_wrapper, "_instance", None)
                if not p_instance:
                    continue
                
                # Vérifier si le plugin a une méthode execute
                if not hasattr(p_instance, "execute"):
                    continue
                
                # Essayer de décoder avec ce plugin
                print(f"Décodage avec {plugin_name}")
                try:
                    # Contrôles utilisateur au fil de l'eau
                    state = _check_controls()
                    if state == 'canceled':
                        emit_progress('completed', 'Annulé par utilisateur', 100)
                        return result_structure
                    if state == 'paused':
                        _handle_pause_loop()
                    processed_count += 1
                    try:
                        progress_pct = 20 + int(processed_count / max(1, total_plugins) * 70)
                    except Exception:
                        progress_pct = None
                    emit_progress('decode_try_plugin', f"Décodage avec {plugin_name}...", progress_pct, {'plugin': plugin_name})
                    inputs = {
                        "text": text,
                        "strict": strict,
                        "mode": "decode",
                        "embedded": embedded,
                        "enable_gps_detection": True,
                        "enable_bruteforce": brute_force,
                        "bruteforce": brute_force,
                        "brute_force": brute_force
                    }
                    if key:
                        inputs["key"] = key
                    
                    # Ajouter les caractères autorisés si fournis
                    if allowed_chars:
                        inputs["allowed_chars"] = allowed_chars
                    
                    plugin_result = p_instance.execute(inputs)
                    print('result', plugin_result)
                    
                    # Traiter uniquement les formats standardisés
                    if self._is_standardized_format(plugin_result):
                        plugin_processed = self._process_plugin_result(plugin_result, plugin_name, scoring_cache=scoring_cache, origin_coords=origin_coords)
                        # Émettre un résultat partiel si disponible
                        if plugin_processed["results"]:
                            first = plugin_processed["results"][0]
                            emit_progress('partial_result', f"Résultat {plugin_name}", None, {
                                'plugin': plugin_name,
                                'text_output': first.get('text_output', '')[:500],
                                'confidence': first.get('confidence', 0)
                            })
                        
                        # Ajouter les résultats à notre collection
                        all_results.extend(plugin_processed["results"])
                        
                        # Mettre à jour les résultats combinés
                        for comb_key, comb_value in plugin_processed["combined_results"].items():
                            combined_results[comb_key] = comb_value
                        
                        # Fusionner les échecs
                        if plugin_processed.get("failed_plugins"):
                            result_structure["failed_plugins"].extend(plugin_processed["failed_plugins"])
                        
                        # Mettre à jour les coordonnées primaires si présentes
                        if plugin_processed["primary_coordinates"]:
                            primary_coordinates = plugin_processed["primary_coordinates"]
                    
                except Exception as e:
                    print(f"Erreur lors du décodage avec {plugin_name}: {str(e)}")
                    result_structure["failed_plugins"].append({"plugin": plugin_name, "reason": str(e)})
                    continue
            
            # Trier les résultats par confiance
            all_results.sort(key=lambda x: x.get("confidence", 0), reverse=True)
            
            # Définir le meilleur résultat
            best_result_id = all_results[0]["id"] if all_results else None
            
            result_structure.update({
                "results": all_results,
                "combined_results": combined_results,
                "primary_coordinates": primary_coordinates,
                "best_result_id": best_result_id
            })
            return result_structure
    
    def _is_standardized_format(self, result):
        """
        Vérifie si le résultat utilise le format standardisé
        """
        # Un résultat standardisé doit avoir le champ status et results
        if not isinstance(result, dict):
            return False
        
        return "status" in result and "results" in result
    
    def _process_plugin_result(self, plugin_result, plugin_name, scoring_cache: dict | None = None, origin_coords: dict | None = None):
        """
        Traite le résultat d'un plugin au format standardisé
        """
        processed = {
            "results": [],
            "combined_results": {},
            "primary_coordinates": None,
            "failed_plugins": []
        }
        
        # Considérer comme échec si :
        #   - status différent de "success"
        #   - aucun résultat
        #   - tous les text_output commencent par "Erreur:"
        status_val = plugin_result.get("status", "success")
        results_list = plugin_result.get("results", [])
        all_error_outputs = True
        for res in results_list:
            text_out = res.get("text_output", "")
            if not str(text_out).startswith("Erreur:"):
                all_error_outputs = False
                break

        if status_val != "success" or not results_list or all_error_outputs:
            reason = plugin_result.get("summary", {}).get("message", "aucun résultat")
            if all_error_outputs and status_val == "success":
                # cas particulier : status succès mais contenu erreur
                reason = "aucun résultat (contenu Erreur)"
            processed["failed_plugins"].append({"plugin": plugin_name, "reason": reason})
            return processed
        
        # Traiter chaque résultat du plugin
        for result in plugin_result.get("results", []):
            # Ajouter le nom du plugin si non spécifié
            if "parameters" not in result:
                result["parameters"] = {"plugin": plugin_name}
            elif "plugin" not in result["parameters"]:
                result["parameters"]["plugin"] = plugin_name
            
            # Appliquer le scoring et l'enrichissement coordonnées
            try:
                from app.services.scoring_service import get_scoring_service
                scoring_service = get_scoring_service()
                text_out = result.get("text_output", "")
                if isinstance(text_out, str) and text_out.strip():
                    # Cache local pour éviter recalculs
                    if scoring_cache is not None and text_out in scoring_cache:
                        score_res = scoring_cache[text_out]
                    else:
                        score_res = scoring_service.score_text(text_out)
                        if scoring_cache is not None:
                            scoring_cache[text_out] = score_res
                    # Attacher les infos de scoring
                    result["scoring"] = {
                        "score": score_res.get("score"),
                        "confidence_level": score_res.get("confidence_level"),
                        "coordinates": score_res.get("coordinates"),
                        "status": score_res.get("status")
                    }
                    # Toujours utiliser le score centralisé comme confiance affichée
                    if isinstance(score_res.get("score"), (int, float)):
                        if "plugin_confidence" not in result and "confidence" in result:
                            result["plugin_confidence"] = result.get("confidence")
                        central_score = float(score_res.get("score") or 0.0)
                        if score_res.get("status") == "rejected":
                            central_score = 0.0
                        result["confidence"] = central_score
                    # Propager des coordonnées détectées si absentes ou non-existantes
                    coords = score_res.get("coordinates", {})
                    if coords and coords.get("exist"):
                        if ("coordinates" not in result) or (not result["coordinates"].get("exist")):
                            result["coordinates"] = coords
                        # Mettre à jour primary_coordinates si pertinent
                        if (processed["primary_coordinates"] is None) and ("decimal" in coords):
                            processed["primary_coordinates"] = coords["decimal"]
            except Exception:
                # En cas d'erreur de scoring, continuer sans bloquer
                pass

            # Ajouter à la liste des résultats
            processed["results"].append(result)
            
            # Extraire le texte de sortie et la confiance pour combined_results
            text_output = result.get("text_output", "")
            confidence = result.get("confidence", 0.0)
            
            processed["combined_results"][plugin_name] = {
                "decoded_text": text_output,
                "confidence": confidence
            }
            
            # Si le résultat contient des coordonnées, les extraire
            if "coordinates" in result and result["coordinates"].get("exist", False):
                processed["combined_results"][plugin_name]["coordinates"] = result["coordinates"]
                
                # Définir comme coordonnées primaires si présentes et valides
                if "decimal" in result["coordinates"]:
                    processed["primary_coordinates"] = result["coordinates"]["decimal"]

                # Si des coordonnées d'origine sont fournies, calculer la distance et l'attacher au résultat
                try:
                    if origin_coords and origin_coords.get('ddm_lat') and origin_coords.get('ddm_lon'):
                        from app.routes.coordinates import calculate_distance_between_coords
                        # Construire les DDM de destination à partir des champs ddm_lat/ddm_lon si présents
                        dest_ddm_lat = result["coordinates"].get("ddm_lat")
                        dest_ddm_lon = result["coordinates"].get("ddm_lon")
                        # Si DDM non fournis mais décimal présent, générer une approximation DDM simple
                        if (not dest_ddm_lat or not dest_ddm_lon) and "decimal" in result["coordinates"]:
                            lat = result["coordinates"]["decimal"].get("latitude") or result["coordinates"]["decimal"].get("lat")
                            lon = result["coordinates"]["decimal"].get("longitude") or result["coordinates"]["decimal"].get("lon")
                            def to_ddm(value: float, is_lat: bool) -> str:
                                if value is None:
                                    return None
                                direction = ('N' if value >= 0 else 'S') if is_lat else ('E' if value >= 0 else 'W')
                                abs_val = abs(float(value))
                                deg = int(abs_val)
                                minutes = (abs_val - deg) * 60
                                return f"{direction} {deg}° {minutes:.3f}'"
                            if isinstance(lat, (int, float)) and isinstance(lon, (int, float)):
                                dest_ddm_lat = to_ddm(lat, True)
                                dest_ddm_lon = to_ddm(lon, False)
                        if dest_ddm_lat and dest_ddm_lon:
                            distance_info = calculate_distance_between_coords(
                                origin_lat=origin_coords['ddm_lat'],
                                origin_lon=origin_coords['ddm_lon'],
                                dest_lat=dest_ddm_lat,
                                dest_lon=dest_ddm_lon
                            )
                            # Attacher au résultat et au combined_results
                            result["distance_from_origin"] = distance_info
                            processed["combined_results"][plugin_name]["distance_from_origin"] = distance_info
                except Exception:
                    # Ne pas bloquer en cas d'erreur
                    pass
        
        return processed
    
    def _process_standardized_result(self, plugin_result, plugin_name, scoring_cache: dict | None = None, origin_coords: dict | None = None):
        """
        Traite le résultat d'un plugin spécifique au format standardisé
        """
        # Structure de base pour le résultat
        processed = {
            "results": [],
            "combined_results": {},
            "primary_coordinates": None,
            "best_result_id": None
        }
        
        # Si le résultat n'est pas au format standardisé ou est une erreur
        if not self._is_standardized_format(plugin_result) or plugin_result.get("status") == "error":
            return processed
        
        # Traiter chaque résultat individuel
        for result in plugin_result.get("results", []):
            # Ajouter le nom du plugin si non spécifié
            if "parameters" not in result:
                result["parameters"] = {"plugin": plugin_name}
            elif "plugin" not in result["parameters"]:
                result["parameters"]["plugin"] = plugin_name
            
            # Appliquer le scoring et l'enrichissement coordonnées
            try:
                from app.services.scoring_service import get_scoring_service
                scoring_service = get_scoring_service()
                text_out = result.get("text_output", "")
                if isinstance(text_out, str) and text_out.strip():
                    if scoring_cache is not None and text_out in scoring_cache:
                        score_res = scoring_cache[text_out]
                    else:
                        score_res = scoring_service.score_text(text_out)
                        if scoring_cache is not None:
                            scoring_cache[text_out] = score_res
                    result["scoring"] = {
                        "score": score_res.get("score"),
                        "confidence_level": score_res.get("confidence_level"),
                        "coordinates": score_res.get("coordinates"),
                        "status": score_res.get("status")
                    }
                    # Toujours utiliser le score centralisé comme confiance affichée
                    if isinstance(score_res.get("score"), (int, float)):
                        if "plugin_confidence" not in result and "confidence" in result:
                            result["plugin_confidence"] = result.get("confidence")
                        central_score = float(score_res.get("score") or 0.0)
                        if score_res.get("status") == "rejected":
                            central_score = 0.0
                        result["confidence"] = central_score
                    coords = score_res.get("coordinates", {})
                    if coords and coords.get("exist"):
                        if ("coordinates" not in result) or (not result["coordinates"].get("exist")):
                            result["coordinates"] = coords
                        if (processed["primary_coordinates"] is None) and ("decimal" in coords):
                            processed["primary_coordinates"] = coords["decimal"]
            except Exception:
                pass

            processed["results"].append(result)
            
            # Extraire pour combined_results
            processed["combined_results"][plugin_name] = {
                "decoded_text": result.get("text_output", ""),
                "confidence": result.get("confidence", 0.0)
            }
            
            # Traiter les coordonnées si présentes
            if "coordinates" in result and result["coordinates"].get("exist", False):
                processed["combined_results"][plugin_name]["coordinates"] = result["coordinates"]
                
                # Définir comme coordonnées primaires
                if "decimal" in result["coordinates"]:
                    processed["primary_coordinates"] = result["coordinates"]["decimal"]

                # Calculer la distance si origin_coords fournie
                try:
                    if origin_coords and origin_coords.get('ddm_lat') and origin_coords.get('ddm_lon'):
                        from app.routes.coordinates import calculate_distance_between_coords
                        dest_ddm_lat = result["coordinates"].get("ddm_lat")
                        dest_ddm_lon = result["coordinates"].get("ddm_lon")
                        if (not dest_ddm_lat or not dest_ddm_lon) and "decimal" in result["coordinates"]:
                            lat = result["coordinates"]["decimal"].get("latitude") or result["coordinates"]["decimal"].get("lat")
                            lon = result["coordinates"]["decimal"].get("longitude") or result["coordinates"]["decimal"].get("lon")
                            def to_ddm(value: float, is_lat: bool) -> str:
                                if value is None:
                                    return None
                                direction = ('N' if value >= 0 else 'S') if is_lat else ('E' if value >= 0 else 'W')
                                abs_val = abs(float(value))
                                deg = int(abs_val)
                                minutes = (abs_val - deg) * 60
                                return f"{direction} {deg}° {minutes:.3f}'"
                            if isinstance(lat, (int, float)) and isinstance(lon, (int, float)):
                                dest_ddm_lat = to_ddm(lat, True)
                                dest_ddm_lon = to_ddm(lon, False)
                        if dest_ddm_lat and dest_ddm_lon:
                            distance_info = calculate_distance_between_coords(
                                origin_lat=origin_coords['ddm_lat'],
                                origin_lon=origin_coords['ddm_lon'],
                                dest_lat=dest_ddm_lat,
                                dest_lon=dest_ddm_lon
                            )
                            result["distance_from_origin"] = distance_info
                            processed["combined_results"][plugin_name]["distance_from_origin"] = distance_info
                except Exception:
                    pass
        
        # Définir le meilleur résultat
        if processed["results"]:
            processed["best_result_id"] = processed["results"][0]["id"]
        
        return processed
