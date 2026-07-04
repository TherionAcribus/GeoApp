# Démarrage de l'application — Spécification des corrections

> Document de travail destiné à l'implémentation des corrections identifiées lors de
> l'audit du démarrage (backend Flask + frontend Theia) de juillet 2026.
> Organisé en lots indépendants, par priorité décroissante. Chaque lot peut être
> implémenté et commité séparément.
>
> Conventions du dépôt : messages de commit en français au format
> `Domaine > description` (voir `git log`). Tests backend : `cd backend && python -m pytest tests/ -x -q`.
> Build frontend : `cd frontend && yarn build:extensions` (ou build ciblé du workspace concerné).

---

## Contexte : mesures de l'audit

- Backend seul (`create_app()`) : **~1,2 s** au total — import 0,47 s, `init_db` 0,05 s,
  `discover_plugins` (88 plugins) 0,29 s, `TaskManager` négligeable, `lazy_mode=True`.
  → Aucun problème de performance backend ; ne pas y toucher.
- Frontend : `PluginToolsManager.onStart` est **awaité par Theia avant d'attacher le shell**
  et déclenche **~89 requêtes HTTP** (1 liste + 1 par plugin) → c'est le principal point
  de latence perçue au démarrage.
- Bug bloquant environnemental : la variable `SSLKEYLOGFILE` (injectée par un logiciel
  tiers — Norton soupçonné, investigation en cours côté utilisateur) fait crasher
  `import requests` dans le venv backend → le backend ne démarre pas du tout.

## Vue d'ensemble des lots

| Lot | Priorité | Contenu | Risque de régression |
|---|---|---|---|
| 1 | P0 | Contournement `SSLKEYLOGFILE` (crash au démarrage backend) | Très faible |
| 2 | P1 | Backend : `include_metadata` sur `GET /api/plugins` (suppression du N+1) | Faible |
| 3 | P1 | Frontend : sync des tools IA non bloquant + 1 seule requête | Faible |
| 4 | P2 | Frontend : résilience « backend pas encore prêt » (retry/backoff) | Faible |
| 5 | P3 | Frontend : robustesse menus sidebar + réduction du bruit console | Faible |

Ordre recommandé : 1 → 2 → 3 → 4 → 5. Le lot 3 dépend du lot 2. Les lots 4 et 5 sont indépendants.

---

## LOT 1 — Contournement `SSLKEYLOGFILE` (P0)

**Fichier** : `backend/gc_backend/__init__.py` (tout en haut, avant tout autre import).

**Constat** : un logiciel de monitoring réseau injecte
`SSLKEYLOGFILE=\\.\nllMonFltProxy\...` dans l'environnement de tous les processus.
Au premier `import requests`, urllib3 lit cette variable et fait
`context.keylog_filename = ...` (`urllib3/util/ssl_.py` ~ligne 321). Le Python du venv
(build uv/python-build-standalone, OpenSSL statique sans applink) s'arrête net avec
`OPENSSL_Uplink(...): no OPENSSL_Applink`, exit 1. Le backend ne peut pas démarrer.

**Implémentation** :
1. En toute première ligne utile de `backend/gc_backend/__init__.py` (avant les imports
   Flask/blueprints, qui importent `requests` transitivement) :
   ```python
   import os

   # Neutralise SSLKEYLOGFILE injectée par certains logiciels de monitoring réseau
   # (antivirus/panels) : urllib3 tenterait d'ouvrir ce pseudo-fichier via OpenSSL,
   # ce qui tue le process sur ce build Python (pas d'OPENSSL_Applink). Évite aussi
   # de divulguer les clés TLS des sessions geocaching.com à un logiciel tiers.
   os.environ.pop('SSLKEYLOGFILE', None)
   ```
2. Placer le pop dans `gc_backend/__init__.py` (et non dans `run.py`) pour couvrir
   **tous** les points d'entrée : `run.py`, `app.py`, `flask db ...`, pytest.

**Vérification** :
- `cd backend && SSLKEYLOGFILE='\\.\test' ./.venv/Scripts/python.exe -c "from gc_backend import create_app; create_app(); print('OK')"`
  doit afficher `OK` (avant le fix : crash `OPENSSL_Uplink`).
- La suite de tests existante passe.

**Commit suggéré** : `Backend > Contournement SSLKEYLOGFILE au démarrage`

---

## LOT 2 — Backend : `include_metadata` sur la liste des plugins (P1)

**Fichiers** :
- `backend/gc_backend/blueprints/plugins.py`, route `GET /api/plugins` (`list_plugins`, ~ligne 6208).
- `backend/gc_backend/plugins/plugin_manager.py`, méthode `PluginManager.list_plugins` (~ligne 469).

**Constat** : la liste renvoie `Plugin.to_dict()` **sans** `include_metadata`, donc sans
`input_schema`. Le frontend doit alors appeler `GET /api/plugins/<name>` pour chacun des
~88 plugins afin de construire les tools IA (N+1).

**Implémentation** :
1. `PluginManager.list_plugins` : ajouter un paramètre `include_metadata: bool = False`,
   transmis à `p.to_dict(include_metadata=include_metadata)` (ligne ~508). Ne rien
   changer d'autre à la méthode.
2. Route `list_plugins` du blueprint : lire un query param `include_metadata`
   (même convention que `enabled` : `lower() in ['true', '1', 'yes']`, défaut `False`)
   et le passer au manager. L'ajouter au bloc `filters` de la réponse.
3. **Compatibilité** : sans le paramètre, la réponse reste strictement identique à
   aujourd'hui (les autres consommateurs de la route ne doivent rien voir changer).

**Tests** (backend) :
- `GET /api/plugins` → les entrées n'ont pas de clé `input_schema` ni `metadata`.
- `GET /api/plugins?include_metadata=true` → chaque entrée dont le `plugin.json`
  déclare des `input_types` possède `input_schema` de forme
  `{"type": "object", "properties": {...}, "required": [...]}` (conversion déjà
  implémentée dans `Plugin.to_dict` / `_convert_input_types_to_json_schema`).
- Les filtres existants (`source`, `enabled`) fonctionnent inchangés avec le nouveau paramètre.

**Commit suggéré** : `Plugins > include_metadata sur GET /api/plugins`

---

## LOT 3 — Frontend : sync des tools IA non bloquant et sans N+1 (P1)

**Fichiers** :
- `frontend/theia-extensions/plugins/src/browser/plugin-tools-manager.ts`
- `frontend/theia-extensions/plugins/src/browser/services/plugins-service.ts`
- `frontend/theia-extensions/plugins/src/common/plugin-protocol.ts` (si le type `PluginFilters` doit être étendu)

**Constat** :
1. `onStart` fait `await this.refreshTools({ silent: true })`. Theia attend la fin de
   tous les `onStart` **avant** d'attacher le shell : la fenêtre reste sur l'écran de
   chargement pendant toute la synchronisation.
2. `refreshTools` appelle `listPlugins` (sans schémas, cf. lot 2) puis
   `resolvePluginDetails` retombe sur `getPlugin(name)` pour chaque plugin → ~89 requêtes.

**Implémentation** :
1. **Ne plus bloquer `onStart`** : remplacer l'`await` par une planification en idle,
   sur le modèle exact de `scheduleBackgroundTask` dans
   `frontend/theia-extensions/preferences/src/browser/services/preference-sync-service.ts`
   (~lignes 64–72) : `requestIdleCallback(..., { timeout: 2000 })` avec fallback
   `setTimeout(task, 0)`. `onStart` devient synchrone et retourne immédiatement.
2. **Supprimer le N+1** :
   - `PluginsService.listPlugins` : accepter un filtre `includeMetadata?: boolean` et
     l'envoyer en query param `include_metadata=true` (dépend du lot 2).
   - `PluginToolsManager.refreshTools` : appeler
     `listPlugins({ enabled: true, includeMetadata: true })`. La méthode existante
     `resolvePluginDetails` garde son fallback `getPlugin(name)` via
     `hasUsableSchema(plugin.input_schema)` — il ne jouera plus que pour les plugins
     sans schéma exploitable, ce qui rend le changement sans risque.
3. **Garder le comportement actuel en cas d'échec** (catch + log) — la résilience
   fait l'objet du lot 4.

**Vérification** :
- Rebuild du workspace : `cd frontend && yarn workspace @mysterai/theia-plugins build`
  (puis build de l'application si nécessaire).
- Au démarrage avec backend actif : l'onglet Réseau du navigateur ne montre plus
  qu'**une** requête `GET /api/plugins?...include_metadata=true` (plus la grappe de
  `GET /api/plugins/<name>`), et les tools IA sont bien enregistrés (log récapitulatif
  `[PluginTools] N tools IA synchronisés`).
- Le shell Theia s'affiche sans attendre la réponse du backend (tester en démarrant
  le frontend **sans** backend : l'UI doit apparaître immédiatement).

**Commit suggéré** : `Plugins > Sync des tools IA non bloquante au démarrage`

---

## LOT 4 — Frontend : résilience « backend pas encore prêt » (P2)

**Fichiers** :
- `frontend/theia-extensions/plugins/src/browser/plugin-tools-manager.ts`
- `frontend/theia-extensions/preferences/src/browser/services/preference-sync-service.ts`

**Constat** : si le backend Flask démarre après le frontend (ou redémarre), la
synchronisation initiale échoue **une seule fois, silencieusement** :
- les tools IA ne sont jamais enregistrés pour la session ;
- le pull initial des préférences backend échoue sans retry.
Seul le statut d'authentification se rattrape (polling 60 s dans
`geoapp-sidebar-contribution.ts`).

**Implémentation** (approche simple retenue : retry local avec backoff, **pas** de
service de readiness transverse — éviter d'introduire une dépendance entre extensions) :
1. Écrire un petit helper de retry (dans chaque extension, ou dupliqué — c'est 15 lignes) :
   tentatives avec backoff exponentiel plafonné, p.ex. délais 2 s, 4 s, 8 s, 16 s,
   30 s, 30 s… avec un plafond total d'environ 3 minutes, abandon ensuite avec un
   log `warn` explicite.
2. `PluginToolsManager` : si `refreshTools` échoue parce que le backend est
   injoignable (erreur réseau axios — distinguer des erreurs HTTP 4xx/5xx qui, elles,
   ne doivent pas boucler), replanifier via le helper. À la première réussite, arrêter.
3. `PreferenceSyncService.pullFromBackend` : même traitement pour l'échec de
   `this.apiClient.fetchAll()`.
4. Optionnel (si simple avec l'API `StatusBar` de Theia) : pendant que le backend est
   injoignable, afficher une entrée de barre de statut « Backend hors ligne » retirée
   à la première réussite. Sinon, reporter ce point.

**Vérification** :
- Démarrer le frontend **sans** backend, lancer le backend ~30 s plus tard :
  les tools IA apparaissent tout seuls (log `[PluginTools] ... synchronisés`) et les
  préférences backend sont bien tirées, sans recharger la fenêtre.
- Avec backend déjà actif : aucun retry ne se déclenche (une seule requête liste).

**Commit suggéré** : `Frontend > Retry au démarrage quand le backend n'est pas prêt`

---

## LOT 5 — Frontend : robustesse sidebar + bruit console (P3)

### 5.1 Menus sidebar sans `setTimeout` en cascade

**Fichier** : `frontend/theia-extensions/zones/src/browser/geoapp-sidebar-contribution.ts`,
`scheduleSidebarSetup` (~lignes 66–81).

**Constat** : l'installation des menus repose sur deux `setTimeout` fixes (500 ms puis
2 s). Si le shell met plus de ~2,5 s à se construire (machine lente, premier
démarrage), les menus GeoApp n'apparaissent jamais.

**Implémentation** : injecter `FrontendApplicationStateService` et remplacer la
cascade par :
```typescript
this.stateService.reachedState('ready').then(() => this.trySetupSidebar());
```
où `trySetupSidebar` tente `findSidebarBottomMenu()` puis, si non trouvé, réessaie
toutes les 500 ms avec un plafond (p.ex. 20 tentatives) avant d'abandonner avec un
`console.warn`. Même traitement pour l'équivalent dans
`frontend/theia-extensions/documentation/src/browser/doc-contribution.ts`
(`scheduleSidebarSetup`, même motif à ~lignes 70–81).

### 5.2 Réduire les logs au démarrage

**Fichier** : `frontend/theia-extensions/plugins/src/browser/plugin-tools-manager.ts`.

**Constat** : un `console.log` par tool enregistré (~90 lignes à chaque démarrage).

**Implémentation** : supprimer le log par tool (ligne ~77) ; conserver uniquement le
log récapitulatif (`N tools IA synchronisés` + liste des noms) déjà présent.

**Vérification** : menus sidebar présents après démarrage (y compris démarrage lent —
simulable avec l'onglet Performance du navigateur en throttling CPU) ; console réduite
aux logs récapitulatifs.

**Commit suggéré** : `Frontend > Sidebar robuste et logs de démarrage réduits`
