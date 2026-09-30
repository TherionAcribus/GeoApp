
# Audit des trackables — rapport d'implémentation pour LLM

Date de l'audit : 2026-09-29

Périmètre : backend Flask/SQLAlchemy, client Geocaching.com, stockage local, éditeur de logs Theia/React, styles, migrations, documentation et tests.

Nature de l'audit : lecture du code et exécution des tests locaux. Aucun appel réel à Geocaching.com et aucune modification fonctionnelle n'ont été effectués.

## 1. Résultat exécutif

La base actuelle est saine et bien découpée : le réseau/parsing, le stockage, les routes et la logique pure du frontend sont séparés. Les lots 1 à 3 décrits dans `trackables-spec.md` sont réellement présents : inventaire personnel, stockage local, actions « Rien / Visité / Déposé » dans les logs de cache, brouillon et tests.

La partie n'est toutefois pas terminée : les lots 4 et 5 restent absents du frontend. Il n'existe ni section des trackables présents dans une cache, ni widget Trackables, ni interface de log autonome ou de découverte en masse. Le backend du log autonome existe déjà.

Avant d'exposer ce backend dans un nouveau widget, corriger en priorité les points P1 suivants :

1. ne jamais transmettre un code de suivi par URL GET ;
2. faire respecter les règles métier par le backend, pas seulement par le frontend ;
3. corriger les incohérences possibles du cache local lors des déplacements et remplacements d'inventaire ;
4. rendre le lot de logs conscient des échecs d'un dépôt et figer un instantané avant confirmation ;
5. fiabiliser la restauration, l'abandon et l'historique des choix de trackables ;
6. définir un résultat « état distant inconnu » après un timeout d'un POST, pour éviter les doublons.

Les performances sont acceptables avec l'inventaire de référence d'environ 70 objets, mais le stockage fait des requêtes SQL N+1, le remplacement d'une cache contient une boucle O(n²), l'API renvoie des champs HTML inutiles dans la liste et chaque icône est chargée immédiatement.

## 2. État vérifié de l'implémentation

### Livré

- Client Geocaching.com : `backend/gc_backend/services/geocaching_trackables.py`.
- Modèles `Trackable` et `GeocacheTrackable` : `backend/gc_backend/models.py:317` et `backend/gc_backend/models.py:399`.
- Migration unique et en tête Alembic : `backend/migrations/versions/add_trackable_tables.py`.
- Stockage local : `backend/gc_backend/services/trackable_store.py`.
- Routes `/api/trackables` : `backend/gc_backend/blueprints/trackables.py`.
- Actions de trackables dans un log de cache : `backend/gc_backend/blueprints/logs.py:503-528` et `backend/gc_backend/blueprints/logs.py:637-689`.
- Envoi tRPC des logs de cache et de trackable : `backend/gc_backend/services/geocaching_submit_logs.py:300-446`.
- Section d'inventaire dans l'éditeur de logs : `frontend/theia-extensions/zones/src/browser/log-editor/trackables-section.tsx`.
- Répartition pure des actions dans un lot : `frontend/theia-extensions/zones/src/browser/log-editor/trackables.ts`.
- Préférence de visite automatique, brouillon, confirmation et résumé par cache.

### Non livré

- Lot 4 de la spec, annoncé à `documentation/trackables-spec.md:126` : trackables présents dans une cache, affichage dans la fiche de cache, actions Retirer/Découvrir.
- Lot 5, annoncé à `documentation/trackables-spec.md:134` : widget Trackables, recherche, fiche, log autonome et file de découvertes en masse.
- Lot 6, annoncé à `documentation/trackables-spec.md:150` : suppression de log, photos, field notes et finitions.
- Aucun fichier `trackables-widget.tsx` et aucune intégration trackable dans `geocache-details-widget.tsx` ou `zones-frontend-module.ts`.

## 3. Contraintes à préserver

Le LLM chargé du code doit conserver ces invariants :

- Le code de suivi est un secret permettant de loguer un trackable. Il ne doit apparaître ni dans une URL, ni dans les logs applicatifs ou d'accès, ni dans une réponse API, ni dans un message d'erreur, ni dans un contexte envoyé à une IA.
- Le code de suivi peut rester stocké dans la base locale, conformément au choix actuel.
- Un POST dont le résultat distant est ambigu ne doit jamais être rejoué automatiquement à l'aveugle.
- « Ne rien faire » n'est jamais envoyé à Geocaching.com ; il sert uniquement à mémoriser le choix local.
- Un dépôt ne peut viser qu'une cache du lot réellement loguée en « Found it ».
- Une visite peut accompagner un log « Found it » ou une note, jamais un DNF.
- Un trackable déposé ne doit plus être traité comme étant en main après le succès effectif du dépôt.
- Les choix explicites de l'utilisateur doivent survivre à un plantage, mais les valeurs qui n'étaient que des défauts ne doivent pas devenir des choix explicites lors d'une restauration.
- Geocaching.com reste la seule marque active ; conserver `brand` pour une extension future.
- Ne pas envoyer les objectifs, descriptions, logs ou codes de suivi des trackables à une IA sans action explicite de l'utilisateur.

## 4. Anomalies et améliorations prioritaires

### P1-01 — Le lookup par code de suivi utilise une URL GET

Constat vérifié : `GET /api/trackables/lookup?code=` lit le code à `backend/gc_backend/blueprints/trackables.py:155-166`. Un code de suivi saisi par l'utilisateur se retrouve donc dans l'URL, avec un risque de présence dans les logs d'accès, outils réseau et proxys. Le commentaire « le code ne sort jamais » n'est pas respecté sur ce trajet. De plus, `_request` réinjecte le texte brut d'une exception réseau dans une erreur (`geocaching_trackables.py:318-323`) ; une exception `requests` peut contenir l'URL distante et sa query string `tracker=<secret>`.

Modification demandée :

- Ajouter `POST /api/trackables/lookup` avec `{ "code": "..." }` dans le corps JSON.
- Réserver éventuellement un GET à un code public TB déjà validé, sans accepter un code de suivi.
- Faire migrer tout nouveau frontend vers le POST.
- Ne jamais journaliser le corps de cette route.
- Redacter les URLs et paramètres sensibles dans les exceptions du client réseau ; retourner une erreur générique corrélée par un identifiant technique non secret.
- Déprécier puis supprimer la forme GET acceptant un code quelconque.

Critères d'acceptation :

- Une recherche par code de suivi ne place jamais ce code dans `request.url`.
- Le secret est absent de `response.get_data()`, des logs capturés et des exceptions sérialisées, y compris sur timeout, 404, 429 et réponse non JSON.
- Une recherche par code public continue de fonctionner.
- Ajouter un test de non-divulgation qui recherche le secret dans la réponse et dans `caplog.text`.

### P1-02 — Les règles métier sont seulement garanties par l'interface

Constat vérifié : `_parse_trackable_actions` contrôle la forme et les valeurs, mais pas le type du log de cache ni l'appartenance du TB à l'inventaire (`logs.py:503-528`, puis envoi à `logs.py:637-658`). Un client API peut joindre une visite ou un dépôt à un DNF, ou déposer un TB inconnu. Pour le log autonome, la route accepte tout identifiant présent dans la table statique (`trackables.py:231-233`) sans vérifier qu'il figure dans `allowed_log_type_ids`; la cache fournie n'est pas contrôlée contre la cache courante (`trackables.py:253-269`).

Modification demandée :

- Centraliser une validation métier backend indépendante du frontend.
- Log de cache : refuser toute action TB sur un DNF/skip ; autoriser `drop` uniquement sur un log de trouvaille ; vérifier que `visit` et `drop` concernent un TB actuellement en inventaire local, ou effectuer un préflight distant si la copie est périmée.
- Log autonome : charger `log-info`, vérifier le type autorisé, vérifier la cache courante pour un retrait et refuser une cache contradictoire.
- Limiter le nombre d'entrées et la taille des champs avant l'appel distant.
- Retourner des codes d'erreur stables et spécifiques : `TRACKABLE_NOT_IN_INVENTORY`, `TRACKABLE_ACTION_NOT_ALLOWED`, `TRACKABLE_LOCATION_CONFLICT`, etc.

Critères d'acceptation :

- Un DNF avec `visit` ou `drop` est refusé localement sans appel réseau.
- Une note avec `drop` est refusée localement.
- Un type autonome absent de `allowed_log_type_ids` est refusé localement.
- Un retrait avec une cache différente de la localisation courante demande une confirmation/rafraîchissement au lieu d'être envoyé silencieusement.
- Les cas valides actuels restent inchangés.

### P1-03 — Le cache local peut conserver une ancienne localisation

Constat vérifié : `upsert_trackable` ne remplace `current_geocache_*` que si le nouveau résumé contient un code (`trackable_store.py:80-82`). Cette stratégie confond « champ non fourni par une source pauvre » et « source complète indiquant qu'il n'y a plus de cache ». De plus, `save_cache_inventory` supprime les relations d'une cache puis recrée celles vues (`trackable_store.py:129-145`), mais ne vide pas `Trackable.current_geocache_*` pour les TB disparus du relevé.

Impact : la relation `GeocacheTrackable` peut dire qu'un TB n'est plus dans la cache tandis que sa fiche locale continue d'afficher cette cache comme localisation courante.

Modification demandée :

- Introduire une politique de fusion dépendante de la source (`my_inventory`, `cache_inventory`, `trackable_full`, `details`) ou des champs à trois états `absent / null / valeur`.
- Lors du remplacement de l'inventaire d'une cache, capturer les anciens codes et vider la localisation des TB absents si leur `current_geocache_code` correspond encore à cette cache.
- Une réponse complète `fetch_trackable` avec `currentGeocache = null` doit effacer une ancienne cache ; une réponse partielle qui omet le champ ne doit pas le faire.
- Conserver la transaction atomique.

Critères d'acceptation :

- Après le remplacement `[TBA, TBB] -> [TBB]`, `TBA.current_geocache_code` n'est plus l'ancienne cache.
- Une source partielle ne détruit toujours pas le propriétaire, le code de suivi ou les autres champs riches.
- Une source complète peut explicitement vider une localisation.
- Ajouter des tests de passage cache -> utilisateur, cache -> propriétaire, cache A -> cache B et réponse partielle.

### P1-04 — Le plan d'un lot suppose qu'un dépôt prévu a réussi

Constat vérifié : tout le plan TB est figé avant la boucle (`geocache-log-editor-widget.tsx:2241-2246`). Dans `trackablesForGeocache`, le TB disparaît de tous les logs placés après la cible (`trackables.ts:210-216`). Or la boucle continue après un échec de photo ou de soumission (`geocache-log-editor-widget.tsx:2276-2289` et `2353-2361`). Si la cache cible du dépôt échoue, les logs suivants se comportent néanmoins comme si le TB avait été déposé.

Le plan figé est utile pour empêcher une cible de se déplacer silencieusement après un succès. Il ne faut pas le supprimer sans le remplacer par une machine d'état.

Modification demandée :

- Créer un `TrackableBatchPlan` immuable contenant l'instantané de l'inventaire, des choix, de l'ordre et des cibles.
- Suivre pour chaque dépôt `planned / submitted / confirmed / failed / uncertain`.
- Si la cible échoue ou est sautée, interrompre le lot avant la première cache dépendante, ou demander explicitement si le lot doit continuer sans action sur ce TB.
- Ne jamais retargeter automatiquement un dépôt après la confirmation utilisateur.
- Sur résultat « déjà logué » ou timeout ambigu de la cache cible, rafraîchir l'inventaire distant avant de décider si le TB est encore en main.
- Conserver l'état de reprise dans le brouillon.

Critères d'acceptation :

- Un test de lot `[GC1 cible dépôt, GC2]` avec échec de GC1 ne traite pas silencieusement le dépôt comme réussi.
- Un succès de GC1 retire bien le TB des payloads suivants.
- Une reprise après plantage ne redépose jamais un TB que l'inventaire distant ne contient plus.
- Le résumé final distingue « déposé », « dépôt échoué » et « état distant à vérifier ».

### P1-05 — Un POST de log trackable peut avoir un résultat distant ambigu

Constat vérifié : `_post_json` retourne `None` après une exception réseau (`geocaching_submit_logs.py:575-579`) et la route répond simplement `submit_failed`. Un timeout peut arriver après la création effective du log. Le futur bouton « réessayer » ou une file de masse risque alors de produire un doublon.

Modification demandée :

- Distinguer `rejected`, `network_failed_before_response` et `unknown_remote_outcome`.
- Ne pas réessayer automatiquement un POST ambigu.
- Après un timeout, rechercher dans les logs récents du TB une empreinte composée au minimum de `type + date + auteur courant + texte normalisé`, puis classer le résultat `confirmed / absent / ambiguous`.
- Si la réconciliation est impossible, afficher « Vérifier sur Geocaching.com » avec lien direct et conserver l'élément dans la file.
- Ajouter une clé locale d'opération pour éviter un double clic ou deux workers simultanés ; ne pas supposer que Geocaching.com supporte une clé d'idempotence.

Critères d'acceptation :

- Aucun test de timeout ne provoque un deuxième POST automatique.
- La file ne marque pas « échec certain » quand le résultat distant est inconnu.
- Un log retrouvé par réconciliation est marqué réussi sans duplication.

### P1-06 — Brouillon, abandon et historique sont incomplets

Constats vérifiés :

- `LogDraft` contient les choix TB (`types.ts:116-136`), mais `LogHistoryEntry` ne les contient pas (`types.ts:95-107`). `buildHistoryEntry` ne reçoit pas les trackables (`log-history-store.ts:190-213`), contrairement à ce qu'annonce la spec.
- « Repartir de zéro » réinitialise le texte et les options par cache, mais pas `trackableSelection` (`geocache-log-editor-widget.tsx:596-613`). Les choix restaurés restent actifs.
- Dès qu'un seul choix diffère, le brouillon sérialise toute la table `actions`, y compris les valeurs qui ne sont que des défauts (`geocache-log-editor-widget.tsx:2032-2038`). À la restauration, ces anciens défauts deviennent des choix explicites et peuvent écraser une nouvelle préférence ou une nouvelle dernière action.

Modification demandée :

- Ajouter au brouillon une représentation d'overrides seulement : action explicite différente du défaut, plus cible explicite d'un dépôt.
- Réappliquer les défauts courants à la restauration, puis les overrides.
- Réinitialiser ces overrides dans « Repartir de zéro » sans toucher aux statuts de logs déjà envoyés.
- Ajouter au minimum au journal d'historique le plan réellement envoyé et le résultat par cache. Ne jamais y mettre les codes de suivi.
- Versionner la forme du brouillon pour migrer les données existantes.

Critères d'acceptation :

- Un brouillon ne contenant que `TB1=visit` ne fige pas les défauts de 69 autres TBs.
- Un changement de préférence entre sauvegarde et restauration s'applique aux TBs sans override.
- « Repartir de zéro » remet les actions aux défauts courants.
- L'historique permet de savoir quels TBs ont visité quelle cache et où chaque dépôt a réellement réussi.

### P1-07 — Les contenus HTML distants ont besoin d'un contrat de rendu sûr

Constat vérifié : `goal_html`, `details_html` et `text_html` sont extraits de pages distantes puis renvoyés tels quels (`geocaching_trackables.py:484-500`, `models.py:371-396`). Aucun widget ne les rend encore, mais le lot 5 prévoit de le faire.

Modification demandée avant le widget :

- Choisir explicitement entre texte normalisé et HTML assaini.
- Si du HTML est nécessaire, utiliser un assainisseur avec liste blanche restrictive ; interdire scripts, événements `on*`, styles actifs, iframes et URLs non sûres.
- Normaliser les URLs relatives vers le domaine Geocaching.com seulement quand le schéma est sûr.
- Ne jamais utiliser `dangerouslySetInnerHTML` sur la valeur brute.

Critères d'acceptation :

- Des fixtures contenant `<script>`, `onerror`, `javascript:` et iframe sont neutralisées.
- Les paragraphes, listes et liens HTTPS légitimes restent lisibles.

## 5. Performance et robustesse — priorité P2

### P2-01 — Réduire les requêtes SQL et le coût des remplacements

Constat vérifié : `upsert_trackable` fait une requête par TB (`trackable_store.py:63-83`). `save_cache_inventory` reconstruit un set à chaque itération (`trackable_store.py:140`), soit O(n²). Les relations sont supprimées puis recréées intégralement.

Travail demandé :

- Précharger tous les `reference_code` concernés en une seule requête et construire un dictionnaire.
- Dédupliquer les résumés en mémoire une seule fois.
- Calculer les ensembles `added / retained / removed` puis faire des opérations groupées.
- Garder une transaction unique et tester le rollback sur erreur.
- Mesurer le nombre de requêtes avec 1, 70, 1 000 et 5 000 TBs.

Acceptation : le nombre de requêtes SQL ne croît pas linéairement avec le nombre de TBs et le résultat fonctionnel reste identique.

### P2-02 — Alléger les réponses de liste et les icônes

Constat vérifié : l'inventaire utilise `Trackable.to_dict()` et renvoie notamment `goal_html`, localisation et autres champs inutiles à la section compacte (`trackables.py:118-125`, `models.py:371-396`). Chaque ligne charge immédiatement une image distante (`trackables-section.tsx:205-207`).

Travail demandé :

- Créer un DTO de liste minimal : code public, nom, icône, type, propriétaire si filtrable, présence du code de suivi, dernière action, date de mise à jour.
- Garder les champs riches pour la fiche uniquement.
- Ajouter `loading="lazy"`, `decoding="async"`, dimensions fixes et fallback d'erreur aux icônes.
- Envisager un cache/proxy local d'icônes seulement si le profilage réseau le justifie.

Acceptation : comparer la taille JSON et le nombre de requêtes images avant/après sur 70 et 1 000 entrées.

### P2-03 — Uniformiser fraîcheur, repli et concurrence des synchronisations

Constat vérifié : l'inventaire personnel gère `max_age` et sert la copie locale après l'échec d'un rafraîchissement automatique (`trackables.py:96-126`). La route d'une cache annonce une logique similaire, mais son code ne lit pas `max_age` et remonte directement toute erreur (`trackables.py:129-150`). Plusieurs widgets peuvent également déclencher le même rafraîchissement en parallèle.

Travail demandé :

- Extraire une politique de cache commune pour inventaire personnel, inventaire d'une cache, fiche et log-info.
- Ajouter `max_age`, `stale`, `sync_error` et repli local à la route cache.
- Borner et valider `max_age` ; une valeur négative ou non finie ne doit pas forcer des rafraîchissements illimités.
- Coalescer les rafraîchissements concurrents par ressource (`single-flight`).
- Ajouter un garde-fou sur une transition brutale vers un inventaire vide : conserver la copie précédente lors d'un refresh automatique et demander confirmation/second relevé avant de la remplacer. Un refresh explicite doit pouvoir confirmer un vrai inventaire vide.

Acceptation : deux appels concurrents périmés déclenchent un seul appel distant et reçoivent un résultat cohérent.

### P2-04 — Réseau : timeouts, 429, pagination et cache de fiche

Constat vérifié : les GET ont un timeout global de 60 s sans backoff (`geocaching_trackables.py:318-337`). Un 429 devient immédiatement une erreur. La pagination s'arrête uniquement sur `len(page) < 1000` et ignore le champ `total` de l'inventaire d'une cache (`geocaching_trackables.py:225-263`). La fiche déclenche deux appels distants séquentiels (`trackables.py:183-186`).

Travail demandé :

- Utiliser des timeouts connexion/lecture distincts et raisonnables.
- Pour les GET seulement, respecter `Retry-After` et appliquer un backoff borné avec jitter.
- Ne pas réessayer automatiquement les POST ambigus.
- Pour l'inventaire d'une cache, utiliser `total` pour détecter une réponse tronquée ou un plafond serveur.
- À l'atteinte de `MAX_PAGES`, retourner une erreur explicite `partial_result` au lieu d'un résultat silencieusement incomplet.
- Mettre en cache court les détails et `log-info`, avec bouton de rafraîchissement explicite.
- Si les deux lectures de la fiche sont indépendantes, les paralléliser côté backend avec la même session seulement si celle-ci est sûre en concurrence ; sinon conserver le séquentiel et privilégier le cache.

### P2-05 — Rendre les parseurs tolérants et observables

Constat vérifié : les API JSON sont privilégiées, ce qui est bon. La fiche historique repose toutefois sur des regex d'identifiants ASP.NET (`geocaching_trackables.py:457-542`). Les tests utilisent des fixtures, mais aucune alerte n'indique une dérive partielle du gabarit.

Travail demandé :

- Conserver les parseurs comme fonctions pures et leurs fixtures.
- Ajouter des marqueurs de complétude : code trouvé mais nom/logs/localisation non parsables.
- Journaliser un diagnostic sans HTML complet ni secret.
- Enregistrer des fixtures anonymisées de plusieurs langues/formats de compte.
- Conserver la date brute quand l'interprétation est ambiguë ; ne pas inventer une date.

## 6. UX/UI et accessibilité — priorité P2

### P2-06 — Adapter la section aux panneaux étroits

Constat fondé sur le code CSS, non vérifié par capture visuelle : une ligne est un flex horizontal sans retour (`log-editor.css:1338-1345`), les trois boutons imposent au moins 156 px (`log-editor.css:1382-1391`) et la cible peut prendre 260 px (`log-editor.css:1450-1453`). La liste ne définit qu'un overflow vertical. Aucun breakpoint ou container query spécifique n'est présent.

Travail demandé :

- Utiliser une grille ou une container query.
- Largeur normale : actions, identité et cible sur une ligne.
- Panneau étroit : identité sur une ligne, actions et cible sur une seconde ; aucun scroll horizontal.
- L'en-tête doit pouvoir placer la date et Rafraîchir sur une seconde ligne.
- Tester à 320, 480, 768 et 1 200 px, zoom 200 %, thèmes clair et sombre.

Critères d'acceptation : aucun contrôle ou code TB tronqué sans moyen de l'obtenir, aucune barre horizontale, cible de dépôt toujours associée visuellement au bon TB.

### P2-07 — Améliorer clavier, annonces et actions de masse

Constat : les boutons utilisent `role="radio"` dans un `radiogroup`, mais sans navigation par flèches ni roving tabindex (`trackables-section.tsx:183-203`). Les erreurs, notices et résultats de refresh ne sont pas dans une région live. « Tout mettre à » agit immédiatement sur toutes les lignes visibles sans annulation.

Travail demandé :

- Implémenter les interactions clavier attendues d'un groupe radio, ou utiliser de vrais inputs radio visuellement segmentés.
- Ajouter focus visible, labels accessibles et `aria-live="polite"` pour synchronisation/progression ; `role="alert"` seulement pour le bloquant.
- Après une action de masse, afficher le nombre de lignes modifiées et offrir « Annuler ».
- Ajouter des filtres rapides `Tous / Rien / Visités / Déposés / En erreur` et un compteur de résultats.
- Garder le bouton Rafraîchir disponible après un lot, mais ne pas appliquer un nouvel inventaire au plan déjà confirmé ; mettre le résultat en attente jusqu'à la fin.

### P2-08 — Figer l'instantané avant la confirmation

Constat : le plan est construit après la confirmation et après un éventuel `await refreshUserFindsCount()` (`geocache-log-editor-widget.tsx:2208-2245`). Le refresh d'inventaire reste volontairement disponible et peut modifier `trackableInventory` et `trackableSelection` (`trackables-section.tsx:85-93`, `geocache-log-editor-widget.tsx:2086-2091`). Le contenu confirmé et le contenu réellement envoyé peuvent donc diverger dans un scénario concurrent.

Travail demandé :

- Construire un instantané immuable avant d'ouvrir la confirmation.
- Le résumé et l'envoi doivent consommer exactement le même instantané.
- Toute modification ou synchronisation reçue pendant la confirmation/l'envoi est mise en attente ou invalide la confirmation et oblige à reconfirmer.

Acceptation : un test simulant un refresh pendant la confirmation démontre que le payload ne diffère jamais du résumé accepté.

## 7. Nouvelles fonctions recommandées

### P1 fonctionnel — Terminer les lots 4 et 5

Ce sont les ajouts les plus utiles et ils sont déjà cohérents avec l'architecture existante.

#### A. Trackables présents dans une cache

- Section compacte dans la fiche de cache : icône, nom, code, état, dernière synchronisation.
- Boutons « Découvrir » et « Retirer » ouvrant le widget Trackables prérempli.
- Rafraîchissement avec copie locale et état périmé clairement affiché.
- Dans l'éditeur de logs, actions autonomes après le log de cache, jamais mélangées au champ `trackables` de `createGeocacheLog`.
- Code de suivi obligatoire et saisi dans un champ masqué avec bouton afficher temporairement.

#### B. Widget Trackables

- Onglet Inventaire : recherche, filtres, tri, date de synchronisation, états manquant/verrouillé, action Loguer.
- Onglet Loguer/Découvrir : collage multi-code, parsing des URLs, validation préalable, texte/date communs, types autorisés par TB.
- Onglet Fiche : objectif et détails assainis, localisation, distance, image, logs paginés.
- Une route frontend dédiée et des commandes Theia dans `zones-frontend-module.ts`.

#### C. File de découvertes en masse

- Préflight de tous les codes sans envoyer de log.
- Déduplication des codes, compte des valides/inconnus/déjà traités.
- Progression par élément, pause/stop entre deux POST, reprise persistante.
- États `pending / submitting / confirmed / rejected / unknown`.
- Export CSV ou copie du bilan, sans code de suivi.
- Concurrence initiale de 1 pour les POST ; ne paralléliser qu'après validation réelle des limites du site.

### P2 fonctionnel — Fiche et historique enrichis

- Charger davantage de logs par pagination plutôt que seulement la première page.
- Carte du parcours construite à partir des caches des logs lorsque les coordonnées sont déjà connues localement ; ne pas déclencher un import massif implicite.
- Timeline filtrable par type de log et auteur.
- Indiquer clairement `En main / Dans GC… / Chez un autre joueur / Propriétaire / Inconnu`.
- Détecter les incohérences entre cache local et site et proposer « Resynchroniser », sans corriger silencieusement.

### P3 fonctionnel — Finitions intéressantes

- Photos sur logs de trackables, en réutilisant l'upload existant.
- Suppression d'un log personnel avec confirmation forte et vérification distante.
- Export field notes enrichi des actions TB si un format réellement compatible est défini.
- Scan caméra/QR ou presse-papiers pour les codes lors d'un event, derrière une permission explicite.
- Règles rapides personnelles : toujours visiter certains TBs, ne jamais auto-visiter certains autres, avec prévisualisation et override par lot.
- GeoKrety seulement après isolation réelle des connecteurs, types de log et identifiants ; ne pas réutiliser de force les règles Groundspeak.

## 8. Ordre d'implémentation conseillé

### Phase A — Socle fiable avant nouveau widget

1. P1-01 lookup POST et redaction des secrets.
2. P1-02 validation métier backend.
3. P1-03 fusion source-aware et cohérence des localisations.
4. P1-05 gestion des résultats distants ambigus.
5. P1-04 plan de lot et états de dépôt.
6. P1-06 brouillon/historique versionnés.
7. P1-07 assainissement HTML.

Livrable : backend et éditeur actuel robustes, sans changement de fonctionnalité visible majeur.

### Phase B — Performance et UX de l'existant

1. Batch SQL et déduplication.
2. DTO de liste minimal et lazy loading des icônes.
3. Politique de cache commune, single-flight et backoff GET.
4. Instantané de confirmation.
5. Responsive, clavier, annonces live et annulation des actions de masse.

### Phase C — Lot 4

1. Route cache avec `max_age` fiable.
2. Section fiche cache.
3. Actions Retirer/Découvrir dirigées vers le widget.
4. Tests d'intégration cache -> widget -> log autonome -> inventaire.

### Phase D — Lot 5

1. Coquille du widget et onglet Inventaire.
2. Fiche sûre et paginée.
3. Log autonome unitaire.
4. File de masse persistante avec états ambigus.

### Phase E — Lot 6 et fonctions P3

Ne commencer qu'après validation réelle sur un TB de test et observation des limites de débit.

## 9. Plan de tests obligatoire

### Backend

- Non-divulgation du code de suivi dans URL, réponse, logs et exceptions.
- Validation action/type/localisation/inventaire sans appel distant sur erreur.
- Fusion selon la source et nettoyage des localisations disparues.
- Synchronisation vide, partielle, concurrente, 429, timeout et pagination tronquée.
- Transaction rollback : aucune demi-synchronisation en base.
- Timeout POST : aucun retry aveugle, état `unknown` et réconciliation.
- HTML hostile assaini.
- Mesure du nombre de requêtes SQL sur grand inventaire.

### Frontend logique

- Instantané confirmation = payload.
- Dépôt réussi, rejeté, timeout, cache déjà loguée, arrêt et reprise.
- Overrides de brouillon, migration d'un ancien brouillon et nouvelle préférence.
- « Repartir de zéro » remet les TBs aux défauts.
- Historique des actions réellement confirmées.
- Refresh reçu pendant confirmation et pendant lot.

### Frontend composant / E2E

- Clavier complet sans souris.
- 0, 1, 8, 9, 70 et 1 000 TBs.
- 320/480/768/1200 px, zoom 200 %, clair/sombre.
- Icône cassée, nom très long, cache très longue, caractères non latins.
- Backend hors ligne avec copie locale, session expirée, 429.
- File de 100+ découvertes : pause, arrêt, reprise, résultat ambigu.

### Validation réelle minimale et prudente

À faire uniquement avec accord explicite et un TB personnel/de test :

1. lectures inventaire, cache, lookup public et lookup code de suivi ;
2. une note autonome, action la moins intrusive ;
3. un log de cache avec une visite ;
4. un dépôt puis une reprise ;
5. vérification manuelle de l'absence du code de suivi dans les logs locaux.

## 10. Commandes de validation connues

Depuis `backend` :

```powershell
.\.venv\Scripts\python.exe -m pytest tests\test_geocaching_trackables.py tests\test_geocaching_submit_logs.py tests\test_trackables_api.py -q --basetemp=C:\tmp\geoapp-trackables-pytest
.\.venv\Scripts\python.exe -m flask --app gc_backend:create_app db heads
```

Depuis `frontend/theia-extensions/zones` :

```powershell
npm.cmd run build
npm.cmd run test:geoapp
```

Résultats pendant cet audit :

- 90 tests backend ciblés réussis ;
- test TypeScript trackables réussi ;
- compilation TypeScript réussie ;
- suite `test:geoapp` complète réussie ;
- Alembic : `add_trackable_tables (head)`.

Les messages d'erreur visibles pendant `test:geoapp` proviennent de scénarios de panne volontairement simulés ; la commande termine avec le code 0.

## 11. Définition globale de « terminé »

Le chantier peut être considéré terminé lorsque :

- tous les P1 sont couverts par des tests de régression ;
- le code de suivi n'est observable sur aucun trajet interdit ;
- le résumé confirmé, le payload envoyé, le résultat distant et l'historique sont cohérents ;
- une erreur partielle ne suppose jamais à tort qu'un TB a été déposé ou repris ;
- les inventaires ne conservent pas de localisation contradictoire ;
- les lots 4 et 5 offrent une expérience clavier et panneau étroit utilisable ;
- les commandes de validation ci-dessus passent ;
- les opérations réelles minimales ont été validées séparément, sans utiliser un TB tiers pour les essais destructifs.

## 12. État d'avancement des corrections

Phases P1 et P2 implémentées et couvertes par les tests (`backend/tests/test_trackables_api.py`, `test_geocaching_trackables.py`, `test_html_sanitize.py`, `trackables-submission.test.ts`). Détail complet dans `trackables-technique.md`.

| Phase | État | Notes |
|---|---|---|
| P1-01 Lookup sécurisé | Fait | `POST /lookup` ; GET déprécié et limité aux codes publics ; codes absents des URL/réponses/logs/exceptions |
| P1-02 Validation métier backend | Fait | Actions/type/cible/inventaire vérifiés côté serveur ; `locationConflictConfirmed` |
| P1-03 Fusion source-aware | Fait | `location_known`, merge par champ, purge des localisations obsolètes, O(n²) supprimé |
| P1-04 Plan de lot et dépôts | Fait | Plan immuable, états `planned…uncertain`, choix continuer/arrêter, réconciliation inventaire distant |
| P1-05 Résultat distant ambigu | Fait | `LogSubmitNetworkError`, `unknown_remote_outcome`, pas de renvoi automatique, IDs d'opération |
| P1-06 Brouillon/historique | Fait | Brouillon v2 = overrides seuls, défauts recalculés à la restauration, journal TB sans codes de suivi |
| P1-07 Assainissement HTML | Fait | `html_sanitize.py` à l'extraction + à la sérialisation des lignes héritées |
| P2-01 Requêtes groupées | Fait | Préchargement paquets de 500, insert/update bulk, transaction unique, bornes mesurées |
| P2-02 DTO liste + icônes | Fait | `to_list_dict()` (−61 % JSON mesuré), `loading="lazy"`, dimensions fixes, repli |
| P2-03 Cache et single-flight | Fait | `max_age` borné, `stale`/`sync_error`, verrou par ressource, garde-fou relevé vide |
| P2-04 Robustesse réseau | Fait | Timeouts 10 s/30 s, rejouage GET 429/5xx avec `Retry-After`, `partial_result`, cache fiche 5 min |
| P2-05 Parseurs tolérants | Fait | `parse_warnings`, `log_date_ambiguous`, diagnostics sans HTML ni secret |
| P2-06 Panneaux étroits | Fait | Grille + `container-type` ; reste la vérification visuelle manuelle (320–1200 px, zoom, thèmes) |
| P2-07 Clavier/annonces/masse | Fait | Roving tabindex + flèches, `role="alert"`/`status`, annulation d'action de masse, filtres rapides |
| P2-08 Instantané confirmation | Fait | `TrackableSubmitSnapshot` gelé, `trackablesRevision`, reconfirmation sur mutation |
| Lot 4 — section fiche cache | En cours | `geocache-trackables-section.tsx` : liste + refresh + copie locale périmée + boutons Retirer/Découvrir → widget prérempli ; « TBs dans cette cache » de l'éditeur reste à faire |
| Lot 5 — coquille + inventaire | Fait | `trackables-widget.tsx` : 3 onglets, commande `geoapp.trackables.open`, événement `open-trackables` ; onglet Inventaire fonctionnel |
| Lot 5.2 — onglet Loguer/Découvrir | Fait | `trackables-log-queue.ts` (pur) : collage multi-codes, dédoublonnage, lookup POST, types via `log-info`, file séquentielle avec `operationId`, états `pending→…→confirmed/rejected/unknown`, persistance sans codes de suivi, champ masqué + affichage temporaire |
| Lot 5.3 — onglet Fiche | À faire | Détail assaini, localisation, image, logs paginés |

Reste : lot 5.3 (fiche assainie paginée), file de découvertes en masse (étendre la file 5.2 : export CSV du bilan — déjà copiable — et préflight groupé), lot 4 restant dans l'éditeur, lot 6 — et la validation visuelle P2-06.
