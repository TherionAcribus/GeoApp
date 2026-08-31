"""Plugin metasolver pour orchestrer l'exécution de plusieurs plugins MysterAI.

Ce plugin agit comme un "meta-plugin" : il peut lancer en séquence un ensemble de
plugins d'analyse (mode "detect") ou de décodage (mode "decode") et agréger leurs
résultats.

La sélection des plugins est **dynamique** : seuls les plugins déclarant
``"metasolver": {"eligible": true}`` dans leur ``plugin.json`` sont considérés.
Des **presets** (définis dans ``presets.json``) permettent de filtrer par tags ou
par type de charset (letters, digits, symbols, words, mixed).

Le comportement est configurable via les paramètres d'entrée définis dans
``plugin.json`` afin d'adapter la portée (preset), les options de bruteforce ou
encore la détection automatique de coordonnées.
"""

from __future__ import annotations

import json
import logging
import queue
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

KEY_FIELD_ALIASES = {
    "cle": "key",
    "cipher_key": "key",
    "mot_cle": "keyword",
    "motcle": "keyword",
    "keyword": "keyword",
    "candidate_key": "candidate_keys",
    "candidate_keys": "candidate_keys",
    "keys": "candidate_keys",
    "transposition_key": "transpo_key",
    "transpo_key": "transpo_key",
    "polybius_key": "polybius_key",
    "polybe_key": "polybius_key",
}

GENERIC_KEY_FIELDS = ("key", "keyword", "transpo_key", "polybius_key")

# Plafond de plugins exécutés en parallèle (évite de surcharger le backend).
# Peut être surchargé via la clé ``metasolver_config.max_parallel_workers`` du
# plugin.json (ex: pour un serveur 16 cores, mettre 12).
MAX_PARALLEL_WORKERS = 6

# Budget de temps global pour une exécution streaming (en secondes). Placé
# volontairement sous le ``timeout_seconds`` du plugin.json (120s) pour laisser
# une marge : si un sous-plugin pend, on ne bloque pas indéfiniment la file SSE
# et on rend la main au client avec un résultat partiel plutôt qu'un timeout HTTP
# brutal. Au-delà de cette deadline, les sous-plugins non terminés sont marqués
# "timeout" et la réponse partielle est renvoyée.
# Peut être surchargé via ``metasolver_config.streaming_global_timeout_s``.
STREAMING_GLOBAL_TIMEOUT_S = 110

# Pas de sondage de la file d'événements (en secondes). Court pour réagir vite
# à une annulation, mais pas trop pour éviter un busy-loop.
# Peut être surchargé via ``metasolver_config.streaming_poll_interval_s``.
_STREAMING_POLL_INTERVAL_S = 1.0

try:
    from gc_backend.plugins.scoring import score_and_rank_results as _score_and_rank
    from gc_backend.plugins.scoring.scorer import score_text_fast as _score_fast

    _BATCH_SCORING_AVAILABLE = True
except Exception:  # pragma: no cover
    _score_and_rank = None
    _score_fast = None
    _BATCH_SCORING_AVAILABLE = False


def _lazy_import_wrappers():
    """Importe les wrappers de plugin seulement si nécessaire."""

    from gc_backend.plugins.wrappers import PluginMetadata, create_plugin_wrapper  # type: ignore

    return PluginMetadata, create_plugin_wrapper


class MetaSolverPlugin:
    """Plugin orchestrateur pour les autres plugins MysterAI."""

    def __init__(self) -> None:
        self.name = "metasolver"
        self.version = "2.0.0"
        self._plugin_manager = None
        self._presets: Optional[Dict[str, Any]] = None
        # Constantes configurables (chargées depuis plugin.json via
        # _load_config() quand le plugin manager est injecté).
        self._max_parallel_workers = MAX_PARALLEL_WORKERS
        self._streaming_global_timeout_s = STREAMING_GLOBAL_TIMEOUT_S
        self._streaming_poll_interval_s = _STREAMING_POLL_INTERVAL_S

    # ---------------------------------------------------------------------
    # Infrastructure (injection du plugin manager)
    # ---------------------------------------------------------------------
    def set_plugin_manager(self, plugin_manager) -> None:
        """Injection du plugin manager fournie par le wrapper Python."""

        self._plugin_manager = plugin_manager
        self._load_config()

    def _load_config(self) -> None:
        """Charge les constantes configurables depuis plugin.json.

        Les clés sont lues sous ``metasolver_config`` dans le plugin.json.
        En cas d'absence ou d'erreur, les valeurs par défaut du module
        sont conservées.
        """
        plugin_json_path = Path(__file__).parent / "plugin.json"
        try:
            with plugin_json_path.open("r", encoding="utf-8") as handle:
                metadata = json.load(handle)
        except Exception as exc:
            logger.debug("metasolver: plugin.json non lisible pour config: %s", exc)
            return

        config = metadata.get("metasolver_config") or {}
        if not isinstance(config, dict):
            return

        try:
            self._max_parallel_workers = int(config.get("max_parallel_workers", MAX_PARALLEL_WORKERS))
        except (TypeError, ValueError):
            pass
        try:
            self._streaming_global_timeout_s = float(config.get("streaming_global_timeout_s", STREAMING_GLOBAL_TIMEOUT_S))
        except (TypeError, ValueError):
            pass
        try:
            self._streaming_poll_interval_s = float(config.get("streaming_poll_interval_s", _STREAMING_POLL_INTERVAL_S))
        except (TypeError, ValueError):
            pass

    # ------------------------------------------------------------------
    # Presets
    # ------------------------------------------------------------------
    def _load_presets(self) -> Dict[str, Any]:
        """Charge les presets depuis presets.json (à côté de ce fichier)."""

        if self._presets is not None:
            return self._presets

        presets_path = Path(__file__).parent / "presets.json"
        try:
            with presets_path.open("r", encoding="utf-8") as handle:
                data = json.load(handle)
            self._presets = data.get("presets") or {}
        except Exception:
            self._presets = {}

        return self._presets

    def _get_preset_filter(self, preset_name: str) -> Dict[str, Any]:
        """Retourne le filtre d'un preset donné (vide si preset inconnu ou 'all').

        Log un warning si le preset demandé n'existe pas, pour aider à
        diagnostiquer les fautes de frappe (ex: ``frequet`` au lieu de
        ``frequent``). Le comportement reste identique (filtre vide = all),
        mais le warning apparaît dans les logs.
        """

        presets = self._load_presets()
        preset = presets.get(preset_name)
        if not preset:
            if preset_name and preset_name != "all":
                logger.warning(
                    "metasolver: preset inconnu '%s' — utilisation du filtre 'all'. "
                    "Presets disponibles: %s",
                    preset_name,
                    ", ".join(sorted(presets.keys())),
                )
            return {}
        return preset.get("filter") or {}

    def get_available_presets(self) -> Dict[str, Dict[str, str]]:
        """Retourne la liste des presets disponibles (label + description)."""

        presets = self._load_presets()
        return {
            name: {"label": p.get("label", name), "description": p.get("description", "")}
            for name, p in presets.items()
        }

    # ------------------------------------------------------------------
    # API principale
    # ------------------------------------------------------------------
    def execute(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        """Point d'entrée standard du plugin metasolver.

        Implémenté comme un consommateur de ``execute_streaming`` : on épuise le
        générateur et on ne retient que l'événement final ``result``. Les deux modes
        partagent ainsi la même logique d'agrégation, de rescoring et de construction
        de réponse (une seule source de vérité, plus de duplication).
        """
        final_data: Optional[Dict[str, Any]] = None
        for event in self.execute_streaming(inputs):
            if event.get("event") == "result":
                final_data = event.get("data")

        if final_data is not None:
            return final_data
        return self._error_response("Aucun résultat produit", time.time())

    # ------------------------------------------------------------------
    # API streaming (SSE)
    # ------------------------------------------------------------------
    def execute_streaming(self, inputs: Dict[str, Any], cancel_event: Optional[threading.Event] = None):
        """Générateur qui yield des événements de progression SSE.

        Chaque élément yielded est un dict sérialisable en JSON avec un champ
        ``event`` indiquant le type :
        - ``init``       : liste des candidats, paramètres
        - ``plugin_start`` : un sous-plugin démarre
        - ``plugin_done``  : un sous-plugin a terminé (succès)
        - ``plugin_error`` : un sous-plugin a échoué
        - ``progress``     : avancement global (pourcentage, compteurs)
        - ``result``       : résultat final complet (même format que execute())

        Args:
            inputs: paramètres d'entrée (text, mode, preset, ...).
            cancel_event: event optionnel permettant à l'appelant (ex. la route
                Flask) de signaler une déconnexion/annulation. Quand il est set,
                les sous-plugins non terminés sont marqués "cancelled" et la
                réponse partielle est renvoyée sans attendre les workers.
        """

        start_time = time.time()
        deadline = start_time + self._streaming_global_timeout_s

        # ── Hardening des inputs ───────────────────────────────────────
        # Coercion systématique en str pour éviter les AttributeError si
        # l'utilisateur envoie un int/list/None pour text, mode, preset ou
        # plugin_list. Sans cela, .strip() / .lower() / .split() lèveraient
        # une exception non gérée qui ferait planter le générateur.
        if not isinstance(inputs, dict):
            yield {"event": "result", "data": self._error_response("inputs doit être un dictionnaire", start_time)}
            return

        if not self._plugin_manager:
            yield {"event": "result", "data": self._error_response("PluginManager non initialisé", start_time)}
            return

        raw_text = inputs.get("text")
        text = (str(raw_text) if raw_text is not None else "").strip()
        if not text:
            yield {"event": "result", "data": self._error_response("Aucun texte fourni", start_time)}
            return

        raw_mode = inputs.get("mode")
        mode = (str(raw_mode) if raw_mode is not None else "decode").lower()
        if mode not in {"detect", "decode"}:
            yield {"event": "result", "data": self._error_response(f"Mode non supporté: {mode}", start_time)}
            return

        raw_preset = inputs.get("preset")
        preset = (str(raw_preset) if raw_preset is not None else "all").lower()
        raw_plugin_list = inputs.get("plugin_list")
        plugin_list_raw = str(raw_plugin_list) if raw_plugin_list is not None else ""
        enable_bruteforce = bool(inputs.get("enable_bruteforce", True))
        detect_coordinates = bool(inputs.get("detect_coordinates", True))
        key_entries = self._parse_key_entries(inputs)
        max_plugins = inputs.get("max_plugins")
        try:
            max_plugins_int: Optional[int] = None if max_plugins in (None, "") else int(max_plugins)
            if max_plugins_int is not None and max_plugins_int < 0:
                max_plugins_int = None
        except (TypeError, ValueError):
            max_plugins_int = None

        explicit_plugins = self._parse_plugin_list(plugin_list_raw)
        preset_filter = self._get_preset_filter(preset)

        candidates = self._collect_candidates(
            mode=mode,
            preset_filter=preset_filter,
            explicit_plugins=explicit_plugins,
            max_plugins=max_plugins_int,
        )

        if not candidates:
            yield {"event": "result", "data": self._error_response(
                f"Aucun plugin éligible pour le mode '{mode}' avec le preset '{preset}'",
                start_time,
            )}
            return

        # Événement init
        yield {
            "event": "init",
            "data": {
                "total_plugins": len(candidates),
                "plugins": [c["name"] for c in candidates],
                "mode": mode,
                "preset": preset,
            },
        }

        execution_log: List[Dict[str, Any]] = []
        aggregated_results: List[Dict[str, Any]] = []
        combined_results: Dict[str, Dict[str, Any]] = {}
        failed_plugins: List[Dict[str, Any]] = []
        primary_by_plugin: Dict[str, Any] = {}

        request_payload = {
            "text": text,
            "mode": mode,
            "detect_coordinates": detect_coordinates,
            "enable_gps_detection": detect_coordinates,
            "brute_force": enable_bruteforce,
            "enable_bruteforce": enable_bruteforce,
        }

        total_candidates = len(candidates)

        # File d'événements alimentée par les workers : permet d'émettre un
        # plugin_start au démarrage RÉEL de chaque plugin (quand un worker prend
        # la tâche) plutôt que les N d'un coup avant l'exécution. L'agrégation
        # reste faite ici, dans le générateur mono-thread : les workers ne font
        # qu'exécuter et pousser leurs événements.
        event_queue: "queue.Queue" = queue.Queue()

        def _run_streaming(candidate: Dict[str, Any], idx: int) -> None:
            """Execute a single plugin and push its events to the queue (thread-safe)."""
            pname = candidate["name"]
            event_queue.put(("start", {
                "plugin": pname,
                "index": idx,
                "total": total_candidates,
            }))
            plugin_inputs = dict(request_payload)
            plugin_inputs.update(self._build_additional_inputs(
                candidate["metadata"],
                key_entries=key_entries,
                plugin_name=pname,
                detect_coordinates=detect_coordinates,
            ))
            t0 = time.time()
            try:
                result = self._execute_with_fallback(pname, plugin_inputs, candidate)
                elapsed = round((time.time() - t0) * 1000, 2)
                event_queue.put(("done", {"name": pname, "index": idx, "result": result, "elapsed_ms": elapsed, "error": None}))
            except Exception as exc:
                elapsed = round((time.time() - t0) * 1000, 2)
                event_queue.put(("done", {"name": pname, "index": idx, "result": None, "elapsed_ms": elapsed, "error": str(exc)}))

        # Soumettre tous les plugins puis drainer la file jusqu'à ce que tous
        # aient terminé, en relayant les événements dans leur ordre réel.
        max_workers = min(self._max_parallel_workers, total_candidates)
        completed_count = 0
        completed_names: set = set()
        aborted_reason: Optional[str] = None

        # Gestion manuelle du lifecycle de l'executor (au lieu de ``with``) pour
        # pouvoir faire un shutdown non-bloquant en cas de timeout / annulation /
        # déconnexion client (GeneratorExit). Le ``with`` appellerait
        # ``shutdown(wait=True)`` et bloquerait tant que les workers pendents
        # n'auraient pas terminé — exactement le piège qu'on évite ici.
        executor = ThreadPoolExecutor(max_workers=max_workers)
        try:
            for idx_candidate, candidate in enumerate(candidates):
                executor.submit(_run_streaming, candidate, idx_candidate)

            while completed_count < total_candidates:
                # Vérifier l'annulation externe (déconnexion client) avant de
                # bloquer sur la file.
                if cancel_event is not None and cancel_event.is_set():
                    aborted_reason = "cancelled"
                    break

                remaining = deadline - time.time()
                if remaining <= 0:
                    aborted_reason = "timeout"
                    break

                # Sondage avec timeout court : permet de réévaluer
                # cancel_event / deadline régulièrement sans busy-loop.
                poll_timeout = min(self._streaming_poll_interval_s, remaining)
                try:
                    kind, payload = event_queue.get(timeout=poll_timeout)
                except queue.Empty:
                    continue

                if kind == "start":
                    yield {"event": "plugin_start", "data": payload}
                    continue

                # kind == "done"
                entry = payload
                plugin_name = entry["name"]
                result = entry["result"]
                error = entry["error"]
                exec_time_ms = entry["elapsed_ms"]
                idx_candidate = entry["index"]

                if error or not result:
                    failed_plugins.append({"plugin": plugin_name, "reason": error or "No result"})
                    execution_log.append({"plugin": plugin_name, "status": "error", "error": error})
                    yield {
                        "event": "plugin_error",
                        "data": {
                            "plugin": plugin_name,
                            "index": idx_candidate,
                            "total": len(candidates),
                            "reason": error or "No result",
                            "execution_time_ms": exec_time_ms,
                        },
                    }
                elif result.get("status") != "success" and result.get("status") != "ok":
                    reason = self._extract_summary_text(result.get("summary")) or result.get("error", {}).get("message")
                    failed_plugins.append({"plugin": plugin_name, "reason": reason})
                    execution_log.append({
                        "plugin": plugin_name,
                        "status": result.get("status"),
                        "execution_time_ms": exec_time_ms,
                    })
                    yield {
                        "event": "plugin_error",
                        "data": {
                            "plugin": plugin_name,
                            "index": idx_candidate,
                            "total": len(candidates),
                            "reason": reason,
                            "execution_time_ms": exec_time_ms,
                        },
                    }
                else:
                    execution_log.append({
                        "plugin": plugin_name,
                        "status": result.get("status"),
                        "execution_time_ms": exec_time_ms,
                    })
                    results_block = result.get("results") or []
                    combined_results[plugin_name] = self._build_combined_entry(result)
                    combined_results[plugin_name]["plugin"] = plugin_name

                    sub_primary = (
                        result.get("primary_coordinates")
                        or combined_results[plugin_name].get("coordinates")
                    )
                    if sub_primary:
                        primary_by_plugin[plugin_name] = sub_primary

                    plugin_aggregated = []
                    for idx, item in enumerate(results_block):
                        enriched = self._enrich_result_item(item, idx, plugin_name, mode)
                        aggregated_results.append(enriched)
                        plugin_aggregated.append(enriched)

                    yield {
                        "event": "plugin_done",
                        "data": {
                            "plugin": plugin_name,
                            "index": idx_candidate,
                            "total": len(candidates),
                            "execution_time_ms": exec_time_ms,
                            "result_count": len(results_block),
                            "results": plugin_aggregated,
                            "combined": combined_results[plugin_name],
                        },
                    }

                completed_names.add(plugin_name)

                # Événement progress
                completed_count += 1
                yield {
                    "event": "progress",
                    "data": {
                        "completed": completed_count,
                        "total": len(candidates),
                        "percentage": round(completed_count / len(candidates) * 100, 1),
                        "results_so_far": len(aggregated_results),
                        "failures_so_far": len(failed_plugins),
                        "elapsed_ms": round((time.time() - start_time) * 1000, 2),
                    },
                }
        finally:
            # Shutdown non-bloquant : annule les futures non démarrées et rend
            # la main immédiatement (sortie normale, timeout, annulation ou
            # GeneratorExit sur déconnexion client). Les workers en cours
            # d'exécution termineront en arrière-plan mais ne bloqueront pas le
            # générateur. ``cancel_futures`` requiert Python 3.9+.
            try:
                executor.shutdown(wait=False, cancel_futures=True)
            except TypeError:  # pragma: no cover - Python < 3.9
                executor.shutdown(wait=False)

        # Si on est sorti prématurément (timeout ou annulation), marquer les
        # sous-plugins non terminés et émettre leurs événements plugin_error
        # avant de construire la réponse partielle.
        if aborted_reason is not None:
            for candidate in candidates:
                pname = candidate["name"]
                if pname in completed_names:
                    continue
                reason_label = "Annulé par l'utilisateur" if aborted_reason == "cancelled" else "Délai dépassé"
                failed_plugins.append({"plugin": pname, "reason": reason_label})
                execution_log.append({"plugin": pname, "status": aborted_reason})
                yield {
                    "event": "plugin_error",
                    "data": {
                        "plugin": pname,
                        "index": candidate.get("index", 0),
                        "total": len(candidates),
                        "reason": reason_label,
                        "execution_time_ms": round((time.time() - start_time) * 1000, 2),
                    },
                }

        inputs_echo = {
            "mode": mode,
            "preset": preset,
            "preset_filter": preset_filter if preset_filter else None,
            "requested_plugins": sorted(explicit_plugins) if explicit_plugins else None,
            "max_plugins": max_plugins_int,
            "enable_bruteforce": enable_bruteforce,
            "detect_coordinates": detect_coordinates,
            "metasolver_keys": self._summarize_key_entries(key_entries),
        }

        response = self._build_final_response(
            candidates=candidates,
            aggregated_results=aggregated_results,
            combined_results=combined_results,
            failed_plugins=failed_plugins,
            execution_log=execution_log,
            primary_by_plugin=primary_by_plugin,
            inputs_echo=inputs_echo,
            start_time=start_time,
            max_workers=max_workers,
            aborted_reason=aborted_reason,
        )

        yield {"event": "result", "data": response}

    # ------------------------------------------------------------------
    # Utilitaires privés
    # ------------------------------------------------------------------
    def _parse_plugin_list(self, raw: str) -> List[str]:
        if not raw:
            return []
        items = [item.strip().lower() for item in raw.split(",")]
        return [item for item in items if item]

    @staticmethod
    def _matches_preset_filter(
        metasolver_meta: Dict[str, Any],
        preset_filter: Dict[str, Any],
    ) -> bool:
        """Vérifie si les métadonnées metasolver d'un plugin correspondent au filtre du preset.

        Un filtre vide (preset "all") accepte tout plugin éligible.
        Clés de filtre supportées :
        - ``tags`` (list[str])          : le plugin doit posséder **au moins un** des tags listés.
        - ``input_charset`` (list[str]) : le ``input_charset`` du plugin doit être dans la liste.
        """

        if not preset_filter:
            return True

        # Filtre par tags (OR : au moins un tag commun)
        filter_tags = preset_filter.get("tags")
        if filter_tags:
            plugin_tags = set(metasolver_meta.get("tags") or [])
            if not plugin_tags.intersection(filter_tags):
                return False

        # Filtre par input_charset
        filter_charsets = preset_filter.get("input_charset")
        if filter_charsets:
            plugin_charset = metasolver_meta.get("input_charset", "")
            if plugin_charset not in filter_charsets:
                return False

        return True

    def _collect_candidates(
        self,
        *,
        mode: str,
        preset_filter: Dict[str, Any],
        explicit_plugins: List[str],
        max_plugins: Optional[int],
    ) -> List[Dict[str, Any]]:
        """Sélectionne les plugins à exécuter.

        Logique :
        1. Lister tous les plugins activés.
        2. Pour chaque plugin, récupérer ses métadonnées complètes.
        3. Ne retenir que ceux qui déclarent ``metasolver.eligible = true``.
        4. Filtrer par capabilities (analyze/decode) selon le mode.
        5. Appliquer le filtre du preset (tags / input_charset).
        6. Si une liste explicite est fournie, ne garder que ces plugins (en
           conservant l'ordre utilisateur).
        7. Trier par priorité décroissante (champ ``metasolver.priority``).
        8. Limiter au ``max_plugins`` demandé.
        """

        all_plugins = self._plugin_manager.list_plugins(enabled_only=True) or []

        candidates: List[Dict[str, Any]] = []
        explicit_set = set(explicit_plugins)

        for plugin_entry in all_plugins:
            name = plugin_entry.get("name")
            if not name or name == self.name:
                continue

            # Si liste explicite, ne garder que les plugins demandés
            if explicit_set and name not in explicit_set:
                continue

            # Récupérer les métadonnées complètes
            info = self._plugin_manager.get_plugin_info(name) or {}
            metadata = info.get("metadata") or {}

            # Vérifier l'éligibilité metasolver
            metasolver_meta = metadata.get("metasolver") or {}
            if not metasolver_meta.get("eligible"):
                # Si le plugin est explicitement demandé, on l'accepte quand même
                if not explicit_set:
                    continue

            # Vérifier les capabilities pour le mode demandé
            capabilities = metadata.get("capabilities") or {}
            if mode == "detect" and not capabilities.get("analyze"):
                continue
            if mode == "decode" and not capabilities.get("decode"):
                continue

            # Appliquer le filtre du preset (sauf si liste explicite)
            if not explicit_set and not self._matches_preset_filter(metasolver_meta, preset_filter):
                continue

            priority = metasolver_meta.get("priority", 50)
            candidates.append({
                "name": name,
                "metadata": metadata,
                "priority": priority,
            })

        # Tri
        if explicit_set:
            # Conserver l'ordre utilisateur
            order = {plugin: idx for idx, plugin in enumerate(explicit_plugins)}
            candidates.sort(key=lambda item: order.get(item["name"], len(order)))
        else:
            # Tri par priorité décroissante puis par nom
            candidates.sort(key=lambda item: (-item["priority"], item["name"]))

        if max_plugins is not None and max_plugins > 0:
            candidates = candidates[:max_plugins]

        return candidates

    def _execute_with_fallback(
        self,
        plugin_name: str,
        inputs: Dict[str, Any],
        candidate: Dict[str, Any],
    ) -> Dict[str, Any]:
        """Tente d'exécuter via le PluginManager puis bascule sur un chargement direct."""

        # ── Protection : execute_plugin peut lever une exception ─────────
        # (ex. plugin qui crash, erreur d'import, timeout interne). Sans ce
        # try/except, l'exception remonterait jusqu'au worker de execute_streaming
        # qui la catcherait, mais on perdrait la cause racine dans les logs.
        try:
            manager_result = self._plugin_manager.execute_plugin(plugin_name, inputs)
        except Exception as exc:
            logger.warning("metasolver: exception execute_plugin(%s): %s", plugin_name, exc, exc_info=True)
            # Tenter le fallback direct avant d'abandonner
            direct_result = self._execute_plugin_direct(plugin_name, inputs)
            if direct_result:
                return direct_result
            return self._error_response(f"Plugin {plugin_name} a levé une exception: {exc}", time.time())

        # ── Type-guard : le résultat doit être un dict ou None ───────────
        # Si execute_plugin retourne une string/list/int, les .get() ci-dessous
        # lèveraient un AttributeError. On normalise en dict vide.
        if manager_result is not None and not isinstance(manager_result, dict):
            logger.warning("metasolver: execute_plugin(%s) a retourné %s, pas un dict", plugin_name, type(manager_result).__name__)
            manager_result = None

        # Détection d'indisponibilité : privilégier le code d'erreur structuré
        # renvoyé par le PluginManager ; le repli sur sous-chaînes ne sert que pour
        # d'anciennes réponses sans champ `error.code`.
        error_block = (manager_result or {}).get("error") or {}
        error_code = error_block.get("code")
        summary_text = self._extract_summary_text((manager_result or {}).get("summary"))
        legacy_summary_match = (
            manager_result is not None
            and manager_result.get("status") == "error"
            and (
                "non disponible" in summary_text.lower()
                or "introuvable" in summary_text.lower()
                or "non trouvé" in summary_text.lower()
            )
        )
        is_unavailable = (
            not manager_result
            or error_code == "plugin_unavailable"
            or legacy_summary_match
        )

        if not is_unavailable:
            return manager_result or self._error_response("Aucun résultat retourné", time.time())

        # Tentative de chargement direct depuis le répertoire officiel
        direct_result = self._execute_plugin_direct(plugin_name, inputs)

        if direct_result:
            return direct_result

        return manager_result or self._error_response("Plugin indisponible", time.time())

    def _execute_plugin_direct(self, plugin_name: str, inputs: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Charge et exécute directement un plugin depuis son répertoire officiel."""

        plugins_root = getattr(self._plugin_manager, "plugins_dir", None)
        if not plugins_root:
            return None

        plugin_dir = Path(plugins_root) / "official" / plugin_name
        plugin_json = plugin_dir / "plugin.json"

        if not plugin_json.exists():
            return None

        try:
            with plugin_json.open("r", encoding="utf-8") as handle:
                metadata = json.load(handle)
        except Exception as exc:
            logger.warning("metasolver: échec lecture plugin.json pour %s: %s", plugin_name, exc)
            return None

        try:
            PluginMetadata, create_plugin_wrapper = _lazy_import_wrappers()

            # Plafonner le timeout comme le fait le PluginManager : ce chemin de
            # secours ne doit pas échapper à la politique d'exécution (un plugin
            # sur disque ne peut pas tourner plus longtemps que via le manager).
            declared_timeout = int(metadata.get("timeout_seconds", 30))
            default_timeout = int(getattr(self._plugin_manager, "default_timeout", 60) or 60)
            allow_long_running = bool(getattr(self._plugin_manager, "allow_long_running", False))
            effective_timeout = declared_timeout if allow_long_running else min(declared_timeout, default_timeout)

            wrapper_metadata = PluginMetadata(
                name=metadata["name"],
                version=metadata.get("version", "1.0.0"),
                plugin_type=metadata.get("plugin_type"),
                entry_point=metadata.get("entry_point", "main.py"),
                path=str(plugin_dir),
                timeout_seconds=effective_timeout,
            )

            wrapper = create_plugin_wrapper(
                metadata.get("plugin_type"),
                wrapper_metadata,
                plugin_manager=self._plugin_manager,
            )

            if not wrapper:
                return None

            if not wrapper.initialize():
                return None

            return wrapper.execute(inputs)

        except Exception as exc:
            logger.warning("metasolver: échec exécution directe de %s: %s", plugin_name, exc, exc_info=True)
            return None

    def _build_additional_inputs(
        self,
        metadata: Dict[str, Any],
        *,
        key_entries: Optional[List[Dict[str, Any]]] = None,
        plugin_name: str = "",
        detect_coordinates: bool = True,
    ) -> Dict[str, Any]:
        """Prépare les champs additionnels à transmettre à un plugin cible."""

        extras: Dict[str, Any] = {}
        input_types = metadata.get("input_types") or {}

        # Propager le choix utilisateur de détection de coordonnées au plugin cible
        # (et non un True forcé qui ignorait le toggle du formulaire).
        if "detect_coordinates" in input_types:
            extras["detect_coordinates"] = detect_coordinates
        elif "enable_gps_detection" in input_types:
            extras["enable_gps_detection"] = detect_coordinates

        extras.update(self._build_key_inputs_for_plugin(
            input_types=input_types,
            key_entries=key_entries or [],
            plugin_name=plugin_name,
        ))

        return extras

    def _parse_key_entries(self, inputs: Dict[str, Any]) -> List[Dict[str, Any]]:
        entries: List[Dict[str, Any]] = []

        for raw_key in ("metasolver_keys", "key_entries", "keys"):
            if raw_key in inputs:
                entries.extend(self._normalize_key_entries(inputs.get(raw_key)))

        for field in ("key", "keyword", "candidate_keys", "transpo_key", "polybius_key"):
            value = inputs.get(field)
            if self._has_key_value(value):
                # Expand list values : candidate_keys=["abc","def"] doit
                # produire deux entries distinctes, pas une seule avec une
                # liste comme value.
                if isinstance(value, list):
                    for item in value:
                        if self._has_key_value(item):
                            entries.append({"field": field, "value": str(item).strip()})
                else:
                    entries.append({"field": field, "value": value})

        # Filtrer les entries sans valeur + dédupliquer par (field, value, plugin)
        seen: set = set()
        deduped: List[Dict[str, Any]] = []
        for entry in entries:
            if not self._has_key_value(entry.get("value")):
                continue
            # Normaliser la valeur en str pour la clé de dédup
            val_str = str(entry.get("value") or "").strip()
            if not val_str:
                continue
            entry["value"] = val_str
            dedup_key = (entry.get("field", "key"), val_str, str(entry.get("plugin") or ""))
            if dedup_key in seen:
                continue
            seen.add(dedup_key)
            deduped.append(entry)

        return deduped

    def _normalize_key_entries(self, raw_value: Any) -> List[Dict[str, Any]]:
        if raw_value is None:
            return []

        if isinstance(raw_value, list):
            entries: List[Dict[str, Any]] = []
            for item in raw_value:
                entries.extend(self._normalize_key_entries(item))
            return entries

        if isinstance(raw_value, dict):
            if "value" in raw_value or "field" in raw_value or "name" in raw_value:
                return [{
                    "field": self._normalize_key_field(raw_value.get("field") or raw_value.get("name") or "key"),
                    "value": raw_value.get("value"),
                    "plugin": raw_value.get("plugin") or raw_value.get("plugin_name"),
                }]

            # Dict sans clés value/field/name : on ne collecte que les
            # champs qui ressemblent à des clés (pas text, mode, preset, etc.)
            entries = []
            plugin_filter = raw_value.get("plugin") or raw_value.get("plugin_name")
            skip_fields = {"id", "plugin", "plugin_name", "text", "mode", "preset",
                           "max_plugins", "plugin_list", "enable_bruteforce",
                           "detect_coordinates", "inputs"}
            for field, value in raw_value.items():
                if field in skip_fields:
                    continue
                # Seulement accepter les valeurs de type str ou list[str]
                if isinstance(value, (str, list)):
                    entries.append({
                        "field": self._normalize_key_field(field),
                        "value": value,
                        "plugin": plugin_filter,
                    })
            return entries

        if isinstance(raw_value, str):
            return [{"field": "key", "value": raw_value}]

        # Types non-supportés (int, float, bool, etc.) : ignorer au lieu
        # de les traiter comme une clé valide.
        return []

    @staticmethod
    def _normalize_key_field(field: Any) -> str:
        normalized = str(field or "key").strip().lower().replace("-", "_").replace(" ", "_")
        return KEY_FIELD_ALIASES.get(normalized, normalized or "key")

    @staticmethod
    def _has_key_value(value: Any) -> bool:
        if value is None:
            return False
        if isinstance(value, str):
            return bool(value.strip())
        if isinstance(value, list):
            return any(MetaSolverPlugin._has_key_value(item) for item in value)
        return True

    def _entry_matches_plugin(self, entry: Dict[str, Any], plugin_name: str) -> bool:
        plugin_filter = str(entry.get("plugin") or "").strip().lower()
        if not plugin_filter:
            return True
        requested = {
            item.strip()
            for item in plugin_filter.replace(";", ",").split(",")
            if item.strip()
        }
        return plugin_name.strip().lower() in requested

    def _resolve_key_input_field(self, input_types: Dict[str, Any], requested_field: str) -> Optional[str]:
        requested_field = self._normalize_key_field(requested_field)
        if requested_field in input_types:
            return requested_field

        if requested_field == "key":
            for field in GENERIC_KEY_FIELDS:
                if field in input_types:
                    return field
            return None

        if requested_field == "keyword" and "key" in input_types:
            return "key"

        if requested_field.endswith("_key") and "key" in input_types:
            return "key"

        return None

    def _flatten_key_values(self, values: List[Any]) -> List[str]:
        flattened: List[str] = []
        for value in values:
            if isinstance(value, list):
                flattened.extend(self._flatten_key_values(value))
                continue
            text = str(value).strip()
            if text:
                flattened.append(text)

        unique_values: List[str] = []
        seen = set()
        for value in flattened:
            if value not in seen:
                unique_values.append(value)
                seen.add(value)
        return unique_values

    def _coerce_key_value(self, value: Any, field_def: Any) -> Any:
        field_type = (field_def or {}).get("type") if isinstance(field_def, dict) else None
        values = self._flatten_key_values(value if isinstance(value, list) else [value])
        first_value = values[0] if values else ""

        if field_type in {"number", "integer"}:
            try:
                return int(first_value) if field_type == "integer" else float(first_value)
            except (TypeError, ValueError):
                return value

        if field_type in {"checkbox", "boolean"}:
            return str(first_value).strip().lower() in {"true", "1", "yes", "on"}

        return ", ".join(values)

    def _build_key_inputs_for_plugin(
        self,
        *,
        input_types: Dict[str, Any],
        key_entries: List[Dict[str, Any]],
        plugin_name: str,
    ) -> Dict[str, Any]:
        if not input_types or not key_entries:
            return {}

        values_by_field: Dict[str, List[Any]] = {}
        fallback_values_by_field: Dict[str, List[Any]] = {}
        generic_key_values: List[Any] = []

        for entry in key_entries:
            if not self._entry_matches_plugin(entry, plugin_name):
                continue

            requested_field = self._normalize_key_field(entry.get("field"))
            value = entry.get("value")
            if not self._has_key_value(value):
                continue

            if requested_field == "key":
                generic_key_values.append(value)

            actual_field = self._resolve_key_input_field(input_types, requested_field)
            if not actual_field:
                continue

            target = fallback_values_by_field if actual_field != requested_field else values_by_field
            target.setdefault(actual_field, []).append(value)

        extras: Dict[str, Any] = {}
        fields_to_apply = set(values_by_field) | set(fallback_values_by_field)
        for field in fields_to_apply:
            if field == "candidate_keys":
                continue
            values = values_by_field.get(field) or fallback_values_by_field.get(field) or []
            if not values:
                continue
            extras[field] = self._coerce_key_value(values[0], input_types.get(field))

        if "candidate_keys" in input_types:
            candidate_values = list(values_by_field.get("candidate_keys") or [])
            candidate_values.extend(fallback_values_by_field.get("candidate_keys") or [])
            candidate_values.extend(generic_key_values)
            normalized_candidates = self._flatten_key_values(candidate_values)
            if normalized_candidates:
                extras["candidate_keys"] = ", ".join(normalized_candidates)
                extras["bruteforce"] = True
                extras["brute_force"] = True
                extras["enable_bruteforce"] = True

        return extras

    def _summarize_key_entries(self, key_entries: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        summary: List[Dict[str, Any]] = []
        for entry in key_entries:
            value = entry.get("value")
            value_text = str(value or "").strip()
            if not value_text:
                continue
            summarized = {
                "field": self._normalize_key_field(entry.get("field")),
                "value": value_text,
            }
            if entry.get("plugin"):
                summarized["plugin"] = str(entry.get("plugin"))
            summary.append(summarized)
        return summary

    @staticmethod
    def _dedup_key(text_output: Any) -> Optional[str]:
        """Clé de déduplication : texte nettoyé (espaces normalisés), casse conservée.

        Retourne None si le texte n'est pas exploitable (le résultat ne sera alors
        jamais fusionné avec un autre).
        """
        if not isinstance(text_output, str):
            return None
        stripped = text_output.strip()
        if not stripped:
            return None
        return re.sub(r"\s+", " ", stripped)

    def _deduplicate_results(self, results: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Fusionne les résultats au ``text_output`` identique.

        En metasolver, plusieurs plugins produisent souvent le même texte (ex. ROT13
        obtenu via ``caesar`` en bruteforce ET via ``rot_cipher``). On conserve le
        candidat de meilleure confiance et on agrège la liste des plugins l'ayant
        produit (``source_plugins`` / ``duplicate_count``), afin de réduire le bruit
        sans perdre l'information de provenance.
        """
        if not results:
            return results

        groups: Dict[str, Dict[str, Any]] = {}
        order: List[str] = []

        for idx, item in enumerate(results):
            key = self._dedup_key(item.get("text_output"))
            if key is None:
                # Résultat sans texte exploitable : clé unique => jamais fusionné
                key = f"__unique_{idx}__"

            plugin_name = item.get("plugin") or item.get("source_plugin")
            group = groups.get(key)

            if group is None:
                group = {"rep": item, "plugins": []}
                groups[key] = group
                order.append(key)
            else:
                current = float(group["rep"].get("confidence", 0) or 0)
                candidate = float(item.get("confidence", 0) or 0)
                if candidate > current:
                    group["rep"] = item

            if plugin_name and plugin_name not in group["plugins"]:
                group["plugins"].append(plugin_name)

        deduped: List[Dict[str, Any]] = []
        for key in order:
            group = groups[key]
            rep = group["rep"]
            plugins = group["plugins"]
            if len(plugins) > 1:
                rep["source_plugins"] = plugins
                rep["duplicate_count"] = len(plugins)
            deduped.append(rep)

        return deduped

    @staticmethod
    def _pick_primary_coordinates(
        candidates: List[Dict[str, Any]],
        primary_by_plugin: Dict[str, Any],
    ) -> Optional[Dict[str, Any]]:
        """Choisit les coordonnées primaires de façon déterministe.

        On retient le premier plugin (dans l'ordre de priorité des candidats, et non
        dans l'ordre d'achèvement des threads) ayant produit des coordonnées. Garantit
        un résultat identique en mode ``execute`` et ``execute_streaming``.
        """
        for candidate in candidates:
            coords = primary_by_plugin.get(candidate["name"])
            if coords:
                return coords
        return None

    def _enrich_result_item(
        self,
        item: Dict[str, Any],
        idx: int,
        plugin_name: str,
        mode: str,
    ) -> Dict[str, Any]:
        """Normalise et enrichit un résultat brut d'un sous-plugin.

        Attribue un identifiant unique, la provenance, et remplace la confiance
        native du plugin par le fast score de qualité de texte (tri intermédiaire ;
        le rescoring complet a lieu en fin de pipeline dans _build_final_response).
        """
        enriched = dict(item)
        parameters = dict(enriched.get("parameters") or {})
        parameters.setdefault("plugin", plugin_name)
        parameters.setdefault("mode", mode)
        enriched["parameters"] = parameters
        original_id = enriched.get("id") or f"result_{idx+1}"
        unique_id = f"{plugin_name}::{original_id}"
        enriched["id"] = unique_id
        enriched.setdefault("original_id", original_id)
        enriched.setdefault("display_id", f"{plugin_name}_{idx+1}")
        enriched.setdefault("display_label", f"Résultat {idx+1} · {plugin_name}")
        enriched.setdefault("plugin", plugin_name)
        enriched.setdefault("source_plugin", plugin_name)
        # Conserver la confiance native du plugin (audit) avant de la remplacer
        enriched["plugin_confidence"] = enriched.get("confidence", 0)
        text_output = enriched.get("text_output", "")
        if _score_fast is not None and isinstance(text_output, str) and text_output.strip():
            enriched["confidence"] = _score_fast(text_output)
        else:
            # Pas de texte exploitable → score 0
            enriched["confidence"] = 0.0
        return enriched

    def _build_final_response(
        self,
        *,
        candidates: List[Dict[str, Any]],
        aggregated_results: List[Dict[str, Any]],
        combined_results: Dict[str, Dict[str, Any]],
        failed_plugins: List[Dict[str, Any]],
        execution_log: List[Dict[str, Any]],
        primary_by_plugin: Dict[str, Any],
        inputs_echo: Dict[str, Any],
        start_time: float,
        max_workers: int,
        aborted_reason: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Construit la réponse finale (dédup + rescoring + tri déterministe).

        Partagée par execute() et execute_streaming() pour garantir des sorties
        identiques. Les structures sensibles à l'ordre (execution_log, failed_plugins,
        combined_results) sont triées par ordre de priorité des candidats afin d'être
        déterministes quel que soit l'ordre d'achèvement des threads.
        """
        order = {c["name"]: i for i, c in enumerate(candidates)}

        raw_results_count = len(aggregated_results)
        deduped = self._deduplicate_results(aggregated_results)

        # 2.1 — Rescoring complet du top-K : le fast score n'a servi qu'au tri
        # intermédiaire (pré-filtre documenté). On applique le pipeline complet
        # (lexical, quadgrams multilingues, coordonnées) sur les survivants dédupliqués.
        full_rescored = False
        if _score_and_rank is not None and deduped:
            with_text = [
                r for r in deduped
                if isinstance(r.get("text_output"), str) and r.get("text_output").strip()
            ]
            without_text = [
                r for r in deduped
                if not (isinstance(r.get("text_output"), str) and r.get("text_output").strip())
            ]
            if with_text:
                # top_k = tout, min_score = 0 : aucun résultat n'est perdu, seulement re-noté et re-trié
                ranked = _score_and_rank(with_text, top_k=len(with_text), min_score=0.0)
                deduped = ranked + without_text
                full_rescored = True

        deduped.sort(key=lambda item: float(item.get("confidence", 0)), reverse=True)

        # Ordonnancement déterministe des structures d'audit (priorité des candidats)
        execution_log = sorted(execution_log, key=lambda e: order.get(e.get("plugin"), 999))
        failed_plugins = sorted(failed_plugins, key=lambda f: order.get(f.get("plugin"), 999))
        combined_results = {
            name: combined_results[name]
            for name in sorted(combined_results, key=lambda n: order.get(n, 999))
        }

        primary_coordinates = self._pick_primary_coordinates(candidates, primary_by_plugin)

        status = "success" if deduped else "partial_success"
        summary_message = (
            f"{len(deduped)} résultat(s) collecté(s)"
            if deduped
            else "Aucun plugin n'a produit de résultat exploitable"
        )
        if aborted_reason == "cancelled":
            status = "cancelled" if not deduped else "partial_success"
            summary_message = f"Exécution annulée — {summary_message}"
        elif aborted_reason == "timeout":
            status = "timeout" if not deduped else "partial_success"
            summary_message = f"Délai dépassé — {summary_message}"

        total_ms = round((time.time() - start_time) * 1000, 2)
        plugin_times = [e.get("execution_time_ms", 0) for e in execution_log if e.get("status") in ("success", "ok")]
        slowest_plugin = max(plugin_times) if plugin_times else 0
        avg_plugin_time = round(sum(plugin_times) / len(plugin_times), 2) if plugin_times else 0

        response: Dict[str, Any] = {
            "status": status,
            "plugin_info": {
                "name": self.name,
                "version": self.version,
                "execution_time_ms": total_ms,
                "mode": inputs_echo.get("mode"),
                "preset": inputs_echo.get("preset"),
                "executed_plugins": execution_log,
            },
            "inputs": inputs_echo,
            "results": deduped,
            "combined_results": combined_results,
            "primary_coordinates": primary_coordinates,
            "failed_plugins": failed_plugins,
            "summary": summary_message,
            "summary_details": {
                "message": summary_message,
                "total_results": len(deduped),
                "raw_results": raw_results_count,
                "duplicates_merged": raw_results_count - len(deduped),
                "plugins_considered": len(candidates),
                "plugins_succeeded": len(candidates) - len(failed_plugins),
                "plugins_failed": len(failed_plugins),
            },
            "diagnostics": {
                "total_execution_ms": total_ms,
                "parallel_workers": max_workers,
                "slowest_plugin_ms": slowest_plugin,
                "avg_plugin_ms": avg_plugin_time,
                "sum_plugin_ms": round(sum(plugin_times), 2),
                "parallelism_speedup": round(sum(plugin_times) / total_ms, 2) if total_ms > 0 else 1.0,
                "total_raw_results": raw_results_count,
                "full_rescoring": full_rescored,
                "rescored_results": len(deduped) if full_rescored else 0,
                "aborted": aborted_reason,
            },
        }

        if not deduped and failed_plugins and not aborted_reason:
            response["status"] = "error"
            # Surface les causes d'échec pour permettre un diagnostic
            # programmatif (ex. tous les plugins ont-ils échoué pour la
            # même raison ? un plugin clé est-il en panne ?).
            failure_reasons = [
                f"{f.get('plugin', '?')}: {f.get('reason', 'unknown')}"
                for f in failed_plugins
            ]
            response["error_code"] = "all_plugins_failed"
            response["summary_details"]["failure_reasons"] = failure_reasons

        return response

    def _build_combined_entry(self, plugin_result: Dict[str, Any]) -> Dict[str, Any]:
        """Synthétise les informations d'un plugin exécuté."""

        combined: Dict[str, Any] = {}
        results = plugin_result.get("results") or []
        if results:
            first = results[0]
            combined["decoded_text"] = first.get("text_output")
            if "confidence" in first:
                combined["confidence"] = first.get("confidence")
            if "coordinates" in first:
                combined["coordinates"] = first.get("coordinates")
        summary = plugin_result.get("summary")
        if summary:
            combined["summary"] = summary
        return combined

    @staticmethod
    def _extract_summary_text(summary: Any) -> str:
        """Extrait un texte lisible depuis un champ summary (str ou dict)."""
        if isinstance(summary, dict):
            return str(summary.get("message", ""))
        if summary is None:
            return ""
        return str(summary)

    def _error_response(self, message: str, start_time: float) -> Dict[str, Any]:
        return {
            "status": "error",
            "summary": message,
            "results": [],
            "plugin_info": {
                "name": self.name,
                "version": self.version,
                "execution_time_ms": round((time.time() - start_time) * 1000, 2),
            },
        }


__all__ = ["MetaSolverPlugin"]
