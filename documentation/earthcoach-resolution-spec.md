# EarthCoach — Analyse et résolution : spec d'amélioration

Audit du 2026-09-28 sur le Dossier terrain (`earthcoach-workspace-widget.tsx`), le
prompt builder, la capture des résultats et le bridge chat. Objectif : réduire le
coût et la latence d'un aller-retour de résolution, et le nombre de gestes entre
« j'ai mes observations » et « j'ai ma réponse ».

**Contrainte non négociable** : les photos doivent garder une excellente
résolution, le modèle doit y voir de petits détails. On optimise le pipeline,
jamais la taille ni la qualité (voir lot 1 et lot 6).

## Lot 1 — Pipeline d'images : une seule préparation, qualité haute

Constat : `prepareEarthCoachImagesForTransmission` télécharge et décode chaque
image en pleine résolution pour la valider, puis le bridge (`geoapp-chat-bridge.ts`)
la retélécharge, la redécode et la réencode. 8 photos 12 Mpx = 16 décodages.
Le JPEG est réencodé à 0,85 : les artefacts brouillent les textures fines.

1.1 `zones/geoapp-chat-shared.ts` :
- `GEOAPP_CHAT_IMAGE_MAX_DIMENSION = 1568` (la constante du bridge migre ici) ;
- `GeoAppChatImageQuality = 'standard' | 'high'`, `geoAppChatJpegQuality()` :
  0,85 / 0,95 ;
- `encodeGeoAppChatImage(blob, { maxDimension, quality })` : décodage + réencodage
  canvas (logique actuelle de `downscaleImage`), PNG conservé en PNG ;
- cache mémoire des images préparées, clé `url|quality`, TTL 5 min, 40 entrées max :
  `rememberPreparedGeoAppChatImage`, `takePreparedGeoAppChatImage` (lecture qui
  consomme l'entrée, pour ne pas retenir des Mo en mémoire) ;
- champ optionnel `imageQuality` dans `GeoAppOpenChatRequestDetail`, recopié par
  `buildGeoAppOpenChatRequestDetail`.

1.2 Bridge : `fetchImageAsVariable` consulte d'abord le cache ; sinon
téléchargement + `encodeGeoAppChatImage` avec la qualité demandée (défaut
`standard` : aucun changement pour les autres agents).

1.3 Dossier terrain : la validation *est* la préparation. Le paramètre
`decodeImage` de `prepareEarthCoachImagesForTransmission` devient
`prepareImage(blob) => Promise<T>` ; le résultat est rangé dans le cache sous
l'URL finalement retenue (directe ou `/store`). EarthCoach envoie
`imageQuality: 'high'` pour les deux actions et la réponse finale.

Tests : cache (TTL, consommation, plafond), recopie de `imageQuality`, préparation
appelée une fois par image et résultat exposé.

## Lot 2 — Prompt et payloads : ne plus payer deux fois

2.1 Quand le dossier fournit un `request_id` (analyse ou résolution), le détail
question par question passe **uniquement** par `earthcoach_capture_result`. Le
chat se limite à une synthèse courte : bilan prêtes / partielles / manquantes,
points bloquants, prochaines mesures. Le gabarit de résolution décrit alors les
champs du tool, pas un texte à écrire dans le chat. Sans `request_id` (chat
libre), le gabarit texte actuel reste inchangé.

2.2 Avec un dossier préparé, le bloc « Images transmises » est omis : le bloc
« Contextes exacts des images transmises » porte aussi le libellé.

2.3 `GET /api/geocaches/<id>/earthcoach-results` n'envoie plus
`context_snapshot` (listing HTML complet par résultat, jamais lu par le front).
Il envoie à la place `snapshot_tasks` : `[{ id, position, question }]`, léger,
utile au lot 3. Les réponses POST/PATCH gardent leur forme.

## Lot 3 — Couverture par question et propositions numérotées

3.1 Helper pur `buildEarthCoachCoverage(loggingTasks, observations, images,
imageContexts)` dans `earthcoach-workspace-logic.ts`, une ligne par question :
position, question, statut, observation liée (extrait), photo exigée, photo
personnelle disponible (image liée à l'observation de la question, ou image du
dossier dont `observation_id` est celle de la question), et un état synthétique
`ready_to_resolve` / `needs_field` / `needs_photo`.

3.2 Le panneau « Observations et couverture » devient une matrice : Qn, question,
statut, observation, photo, bouton **Observer** (`earthcoach.observeTask`).
Un résumé « n question(s) sans observation » apparaît dans la vérification avant
envoi.

3.3 Les propositions affichent `Qn` (via `task_id` → `snapshot_tasks`, repli sur
les questions courantes). Un avertissement liste les questions de l'instantané
sans proposition dans une résolution.

## Lot 4 — Report groupé, retour à la version IA, fluidité

4.1 Bouton « Reporter toutes les réponses prêtes » par résultat : un seul
`POST /apply` avec les index éligibles (prête, réponse, rien à compléter).

4.2 « Revenir à la version IA » par proposition modifiée (depuis `ai_proposals`,
même index).

4.3 Rendu : la carte de résultat devient un composant `React.memo` ; son contenu
n'est rendu qu'une fois déplié (état d'ouverture tenu par le widget). Les cartes
ne se redessinent plus pendant la saisie d'un commentaire.

## Lot 5 — Frictions de l'envoi et analyse exploitable

5.1 La validation est calculée en continu dans « Vérification avant envoi » :
limite dépassée signalée avant le clic ; groupe incomplet avec boutons
« Inclure tout le groupe » / « Retirer le groupe ».

5.2 « Continuer sans photo » n'est plus remis à zéro après chaque envoi : il reste
coché pour la cache tant qu'aucune photo personnelle n'est sélectionnée.

5.3 Analyse : le prompt demande des propositions avec `status` et `missing`
(réponse vide) ; le dossier les présente comme une liste « À relever sur le
terrain » non éditable, au lieu de formulaires de réponse.

5.4 Nettoyage : sélecteur de langue unique (en-tête) ; bouton « Enregistrer » par
proposition supprimé (sauvegarde automatique, l'état reste affiché).

## Lot 6 — Recadrage pleine résolution

Pour les petits détails, un recadrage vaut mieux qu'une image entière réduite :
une zone de 800 px envoyée telle quelle est vue à 1:1.

6.1 Dans l'aperçu du dossier, bouton **Recadrer un détail** : on trace un
rectangle sur l'aperçu ; le recadrage est fait sur l'image source en pleine
résolution (canvas, JPEG 0,95 ou PNG si source PNG), puis envoyé à la route
existante `POST /api/geocache-images/<id>/snippets/new` (`rendered_file`,
`crop_rect_json`).

6.2 L'image dérivée est incluse dans l'envoi, et un groupe « Vue générale +
détail » est créé (ou complété) avec la source en `overview` et le recadrage en
`detail`.

6.3 Helper pur `computeEarthCoachCropRect(selection, displayed, natural)` testé
(conversion affichage → pixels source, bornage, taille minimale).

## Documentation

`earthcoach-technique.md` gagne une section « Dossier terrain et résolution »
(flux d'envoi, capture, propositions, report, réponse finale, pipeline d'images).
