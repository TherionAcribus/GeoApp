# Agent Theia Geocaching - Fonctionnement

Ce document decrit ce qui a ete mis en place pour rendre GeoApp capable d'analyser un listing de geocache, de detecter des familles d'enigmes, de recommander dynamiquement des plugins `metasolver`, de router vers `formula-solver` quand c'est plus pertinent, et d'exposer tout cela a la fois dans l'interface Theia et au chat IA GeoApp.

## Objectif

L'objectif de cette implementation est de sortir d'un usage purement manuel du `metasolver` pour aller vers un systeme plus guide et plus modulaire :

- analyser un listing complet avant de lancer des plugins au hasard
- detecter les familles d'enigmes probables
- extraire des fragments de code secret candidats
- recommander une sous-liste de plugins `metasolver` adaptee a la signature du texte
- laisser l'utilisateur garder le controle dans l'UI
- exposer les memes capacites a l'IA via des tools
- conserver une trace resumee de ce qui a ete tente

## Vue d'ensemble

Le systeme livre repose sur 5 briques principales :

1. Un moteur backend de signature d'entree pour les "codes secrets"
2. Un moteur backend de classification multi-label des listings
3. Une UI `plugin_executor` enrichie pour guider l'utilisateur
4. Une exposition de ces capacites comme tools IA
5. Un pont vers le chat GeoApp et l'archive de resolution

Le flux principal vise aujourd'hui est le suivant :

1. Classifier le listing
2. Si `secret_code`, choisir un bon fragment
3. Calculer la signature de ce fragment
4. Recommander une `plugin_list` `metasolver`
5. Executer `metasolver`
6. Si `formula`, basculer plutot vers `formula-solver`
7. Si besoin, envoyer le diagnostic au chat GeoApp
8. Archiver un snapshot compact du diagnostic

## Architecture generale

### Backend Flask

Le backend porte l'intelligence de recommandation. C'est volontaire, pour eviter de dupliquer les heuristiques entre Python et TypeScript.

Composants principaux :

- `gc-backend/gc_backend/blueprints/plugins.py`
  - analyse de signature d'entree
  - scoring et recommandation des plugins `metasolver`
  - classification multi-label des listings
  - extraction de `candidate_secret_fragments`
- `gc-backend/gc_backend/plugins/schemas/plugin.schema.json`
  - schema des metadonnees plugin, etendu pour mieux decrire l'eligibilite `metasolver`
- `gc-backend/gc_backend/blueprints/archive.py`
  - endpoint de sauvegarde du diagnostic dans l'archive
- `gc-backend/gc_backend/geocaches/archive_service.py`
  - persistence de `resolution_diagnostics` et fusion automatique de `history_state`

### Frontend Theia

Le frontend consomme les routes backend et fournit deux points d'entree :

- l'utilisateur via `plugin_executor`
- l'IA via les tools `geoapp.plugins.*`

Composants principaux :

- `theia-blueprint/theia-extensions/plugins/src/browser/plugin-executor-widget.tsx`
  - panneau metasolver enrichi
  - affichage de la classification
  - recommandation de plugins
  - execution du meilleur fragment
  - ouverture du Formula Solver
  - envoi vers le chat GeoApp
  - journal local du workflow
- `theia-blueprint/theia-extensions/plugins/src/browser/services/plugins-service.ts`
  - client frontend vers les endpoints backend
- `theia-blueprint/theia-extensions/plugins/src/common/plugin-protocol.ts`
  - contrats TypeScript pour les signatures, recommandations et classifications

Pour la strategie produit / agent autour des images, voir aussi :

- `docs/MEMO_IMAGES_AGENT_IA.md`

### Integrations IA

L'IA n'appelle pas le backend directement. Elle passe par des tools Theia.

Composants principaux :

- `theia-blueprint/theia-extensions/plugins/src/browser/plugin-tools-manager.ts`
  - expose `recommend_metasolver_plugins`
  - expose `classify_geocache_listing`
  - expose aussi les plugins eux-memes comme tools, y compris `plugin.metasolver`
- `theia-blueprint/theia-extensions/zones/src/browser/geoapp-chat-agent.ts`
  - ajoute ces tools aux tools permanents de l'agent GeoApp
- `theia-blueprint/theia-extensions/zones/src/browser/geocache-details-widget.tsx`
  - guide le prompt de l'agent pour faire `classify -> choisir workflow -> metasolver ou formula-solver`
- `theia-blueprint/theia-extensions/zones/src/browser/geoapp-chat-bridge.ts`
  - ouvre ou reutilise une session GeoApp, lui envoie le diagnostic courant et injecte maintenant le `resume_state` structure du panneau

## 1. Recommandation dynamique de plugins metasolver

### Principe

Le simple select manuel d'une liste de plugins ne suffisait plus. Le systeme recommande maintenant une sous-liste de plugins adaptee au texte saisi.

Le backend expose :

- `POST /api/plugins/metasolver/recommend`

Entree typique :

```json
{
  "text": "8 5 12 12 15",
  "preset": "all",
  "mode": "decode",
  "max_plugins": 8
}
```

Sortie typique :

```json
{
  "effective_preset": "digits_only",
  "signature": {
    "looks_like_a1z26": true,
    "dominant_input_kind": "digits"
  },
  "selected_plugins": ["alpha_decoder", "roman_code"],
  "plugin_list": "alpha_decoder,roman_code",
  "recommendations": [
    {
      "name": "alpha_decoder",
      "score": 97.0,
      "confidence": 0.97,
      "reasons": ["Input looks like A1Z26 groups"]
    }
  ]
}
```

### Signature d'entree detectee

Le backend calcule une `MetasolverSignature` a partir du texte :

- longueur brute et longueur utile
- nombre de lettres, chiffres, symboles, espaces
- nombre de mots et de groupes
- separateurs detectes
- type d'entree dominant
- preset suggere

Et surtout une serie de drapeaux heuristiques :

- `looks_like_morse`
- `looks_like_binary`
- `looks_like_hex`
- `looks_like_phone_keypad`
- `looks_like_roman_numerals`
- `looks_like_decimal_sequence`
- `looks_like_a1z26`
- `looks_like_tap_code`
- `looks_like_polybius`
- `looks_like_multitap`
- `looks_like_chemical_symbols`
- `looks_like_houdini_words`
- `looks_like_nak_nak`
- `looks_like_shadok`
- `looks_like_tom_tom`
- `looks_like_gold_bug`
- `looks_like_postnet`
- `looks_like_prime_sequence`
- `looks_like_bacon`
- `looks_like_coordinate_fragment`

### Plugins actuellement mieux reconnus

Les heuristiques et les metadonnees plugin ont ete enrichies pour mieux faire remonter notamment :

- `alpha_decoder`
- `t9_code`
- `morse_code`
- `base_converter`
- `vigenere_cipher`
- `chemical_elements`
- `prime_numbers`
- `houdini_code`
- `nak_nak_code`
- `shadok_numbers`
- `postnet_barcode`
- `gold_bug`
- `tom_tom`

### Metadonnees plugin enrichies

Le schema et plusieurs `plugin.json` ont ete etendus pour rendre le classement plus declaratif.

Champs utiles :

- `family`
- `preferred_when`
- `requires_key`
- `supports_grouped_input`
- `input_charset`
- `tags`
- `priority`

Le scoring combine :

- preset effectif
- compatibilite globale `input_charset`
- correspondances heuristiques fortes
- `preferred_when` declares dans les metadonnees
- priorite historique du plugin

L'idee est simple : `metasolver` ne doit plus tester "un peu tout", mais d'abord ce qui est structurellement plausible.

## 2. Classification multi-label des listings

### Principe

Avant d'attaquer un code, le systeme peut maintenant classifier un listing complet.

Le backend expose :

- `POST /api/plugins/listing/classify`

Entree possible :

```json
{
  "geocache_id": 123
}
```

ou en entree directe :

```json
{
  "title": "Mon enigme",
  "description": "...",
  "description_html": "<!-- secret --> ...",
  "hint": "regarde le titre"
}
```

### Labels detectes

La classification retourne plusieurs labels, chacun avec score, confiance, preuves et suggestion de prochain pas.

Labels actuellement supportes :

- `secret_code`
- `hidden_content`
- `formula`
- `word_game`
- `image_puzzle`
- `coord_transform`
- `checker_available`

### Donnees utiles retournees

La reponse de classification contient aussi :

- `recommended_actions`
- `candidate_secret_fragments`
- `hidden_signals`
- `formula_signals`
- `signal_summary`

Les `candidate_secret_fragments` sont importants :

- ils representent des morceaux de texte juges prometteurs
- ils sont tries par score
- chacun transporte deja une `signature` metasolver
- ils servent ensuite a pre-remplir le metasolver ou a lancer l'auto-execution

### Usage concret

Exemple de logique actuellement possible :

1. Le listing contient un commentaire HTML cache
2. La classification remonte `hidden_content`
3. Un fragment `8 5 12 12 15` apparait dans `candidate_secret_fragments`
4. Le panneau metasolver propose ce fragment a l'utilisateur
5. La recommandation met `alpha_decoder` en tete
6. `metasolver` est execute avec cette sous-liste

## 3. Evolution du plugin executor

Le `plugin_executor` a ete transforme pour guider a la fois l'utilisateur expert et l'usage semi-autonome.

### Comportements ajoutes

- affichage de la classification du listing
- affichage des labels detectes
- affichage des actions recommandees
- affichage des signaux HTML suspects
- affichage des meilleurs fragments secrets
- affichage des badges de signature
- recommandation dynamique de plugins
- conservation d'un mode manuel
- execution automatique du meilleur fragment
- ouverture directe du Formula Solver
- envoi du diagnostic au chat GeoApp
- journal local du workflow

### Modes de travail conserves

Le systeme n'a pas retire le controle manuel. Il combine plusieurs usages :

- mode recommande
- mode preset
- mode manuel

En pratique :

- l'utilisateur peut appliquer la recommandation backend
- il peut partir d'un preset classique
- il peut ensuite ajuster la `plugin_list` a la main

### Boutons et actions utiles

Le panneau metasolver dispose maintenant de capacites d'orchestration locale :

- `Executer le meilleur fragment`
  - prend le meilleur `candidate_secret_fragment`
  - remplace le texte courant
  - recalcule la recommandation
  - execute `metasolver`
- `Ouvrir Formula Solver`
  - disponible quand `formula` est detecte
  - bascule vers le workflow Formula Solver sur la geocache courante
- `Envoyer au chat GeoApp`
  - construit un prompt de diagnostic
  - ouvre ou reutilise une session GeoApp
  - archive aussi un resume compact si une geocache est disponible

### Journal local du workflow

Le panneau conserve une trace locale des etapes importantes :

- classification
- choix du fragment
- recommandation
- execution metasolver
- ouverture Formula Solver
- envoi vers le chat
- tentative d'archivage

Ce journal aide a comprendre ce qui s'est passe sans relire toute la sortie brute du plugin.

## 4. Exposition comme tools IA

### Tools ajoutes

Le `PluginToolsManager` expose maintenant explicitement deux tools de haut niveau :

- `classify_geocache_listing`
- `recommend_metasolver_plugins`

En complement, les plugins eux-memes restent exposes comme tools, par exemple :

- `plugin.metasolver`

### Pourquoi c'est important

Cela evite de forcer l'agent a improviser une logique de selection purement depuis le prompt.

Le pattern voulu est :

1. L'agent appelle `classify_geocache_listing`
2. Il choisit un workflow
3. Si `secret_code`, il appelle `recommend_metasolver_plugins`
4. Il execute ensuite `plugin.metasolver`
5. Si `formula`, il utilise plutot les tools Formula Solver

### Tools permanents du chat GeoApp

L'agent GeoApp embarque maintenant en permanence :

- les tools checkers
- `geoapp.plugins.listing.classify`
- `geoapp.plugins.metasolver.recommend`
- `plugin.metasolver`
- les tools `formula-solver.*`

L'agent dispose donc d'un socle minimum coherent pour decider quel chemin prendre.

## 5. Routage vers Formula Solver

Le systeme ne traite plus `metasolver` comme solution universelle.

Quand la classification fait remonter `formula` :

- le panneau propose `Ouvrir Formula Solver`
- le prompt de l'agent GeoApp indique explicitement qu'il faut privilegier le workflow `formula-solver`
- les tools formula sont disponibles en permanence dans le chat

Consequence pratique :

- les cas de formules et de calcul de coordonnees ne sont plus noyes dans la logique "code secret"
- on evite de lancer `metasolver` sur des cas qui relevent d'abord d'un solveur de formules

## 6. Pont vers le chat GeoApp

Un bridge frontend a ete ajoute pour relier le panneau metasolver et le chat GeoApp.

### Comportement

Le bridge :

- ecoute un evenement frontend `geoapp-open-chat-request`
- retrouve une session existante si elle correspond a la meme geocache
- sinon cree une nouvelle session
- selectionne de preference l'agent GeoApp
- injecte un prompt preformatte si fourni

### Interet

Le diagnostic du panneau metasolver devient reutilisable immediatement dans un contexte conversationnel IA, sans recopier manuellement le contexte.

## 7. Archivage de diagnostics

L'archive de resolution sait maintenant stocker un snapshot compact du diagnostic.

### Champ ajoute

Dans `SolvedGeocacheArchive`, un champ JSON texte a ete ajoute :

- `resolution_diagnostics`

### Endpoint ajoute

- `PUT /api/archive/<gc_code>/resolution-diagnostics`

### Contenu attendu

Le snapshot archive reste compact, mais il embarque maintenant aussi :

- un `resume_state` exploitable par le panneau metasolver
- un `history_state` multi-tentatives compact et deduplique

Le `resume_state` resume :

- le contexte geocache
- les labels de classification
- les actions recommandees
- les meilleurs fragments
- la recommandation metasolver
- les plugins selectionnes
- quelques entrees du journal local
- l'etat courant de l'orchestrateur
- l'etat formule (`answer_search`, coordonnees calculees)
- l'etat checker courant

L'objectif n'est pas de sauvegarder toute l'execution brute, mais une trace exploitable plus tard et rechargeable par l'UI.

Depuis le Gestionnaire d'Archive, une tentative peut maintenant etre :

- restauree dans le `Plugin Executor`
- rejouee cote backend sur une etape automatisable choisie (`execute-metasolver`, `search-answers`, `calculate-final-coordinates`, `validate-with-checker`), avec persistence immediate du nouveau snapshot
- reperee plus vite dans la liste d'archives grace a un resume compact du dernier workflow et du dernier evenement

## 8. Workflow cible actuel

### Cas `secret_code`

1. La geocache est chargee
2. Le listing est classe par `classify_geocache_listing`
3. Les meilleurs fragments sont extraits
4. L'utilisateur ou l'agent choisit un fragment
5. `recommend_metasolver_plugins` produit une `plugin_list`
6. `plugin.metasolver` est execute avec cette liste
7. Le diagnostic peut etre envoye au chat et archive

### Cas `formula`

1. La geocache est chargee
2. Le listing est classe
3. La classification remonte `formula`
4. L'utilisateur ouvre `Formula Solver` ou l'agent appelle les tools formula
5. La piste formule est traitee avant toute tentative metasolver

### Cas mixte

Le systeme supporte deja le cas ou plusieurs labels remontent a la fois.

Exemple :

- `hidden_content`
- `secret_code`
- `checker_available`

Dans ce cas, le diagnostic aide a structurer la suite, mais l'orchestration finale reste encore partiellement guidee par l'utilisateur ou l'agent.

### Cas `hidden_content`

1. La geocache est chargee
2. Le listing est classe avec detection des signaux HTML caches
3. L'orchestrateur peut maintenant executer `inspect-hidden-html`
4. Cette etape extrait :
   - commentaires HTML
   - texte d'elements invisibles (`display:none`, `visibility:hidden`, `opacity:0`, `font-size:0`, `color:transparent`, attribut `hidden`, `aria-hidden`)
   - texte d elements caches par regles CSS simples sur classes / ids / tags
   - texte d elements caches par selecteurs structuraux simples de type descendant ou enfant direct
   - texte d elements caches via quelques feuilles de style externes chargees en best effort
5. Si un fragment structure est extrait, une recommandation metasolver est calculee sur ce fragment
6. Le panneau peut ensuite injecter ce fragment dans le texte courant ou envoyer le diagnostic enrichi au chat GeoApp

### Cas `image_puzzle`

1. La geocache est chargee
2. Le listing est classe avec le label `image_puzzle` si le HTML ou les metadonnees indiquent des images / OCR / QR
3. L'orchestrateur peut maintenant executer `inspect-images`
4. Cette etape extrait d'abord les indices deterministes accessibles sans vision lourde :
   - `alt`
   - `title`
   - noms de fichiers / segments utiles des URLs d images
   - URLs d images
   - metadonnees `EXIF`
5. Elle peut fonctionner soit depuis une geocache live, soit depuis une liste d images explicites fournie directement a l agent ou au tool
6. Si des images explicites sont fournies, elle ne depend plus d un `geocache_id`
7. Ensuite, elle tente les plugins image en best effort :
   - `qr_code_detector` pour QR et codes-barres
   - `easyocr_ocr`
   - `vision_ocr` en fallback seulement si QR et OCR classique ne sortent rien et si le budget `vision_ocr` du workflow n est pas epuise
   - ce budget `vision_ocr` est maintenant un cout estime par image selon sa taille / resolution / poids, avec limitation partielle possible si le lot depasse le quota restant
8. Les textes extraits depuis les images sont rescannes comme fragments secrets potentiels
9. Si un fragment structure est detecte, une recommandation metasolver est calculee sur ce fragment
10. Si des coordonnees sont detectees dans un QR ou un OCR, une plausibilite geographique est aussi calculee
11. Le panneau peut ensuite injecter le fragment image principal, reutiliser la recommandation metasolver ou envoyer le diagnostic enrichi au chat GeoApp
12. L'orchestrateur arbitre maintenant plus explicitement entre piste texte, HTML cache, image, formule et projection en tenant compte de la source du meilleur fragment, des signaux caches, des indices image bon marche, des signaux formels, des cas `image_puzzle` purement visuels et d un score de domaine `direct / hidden / image` pour les listings hybrides

## 9. Validation realisee pendant l'implementation

Pendant les differentes etapes de mise en oeuvre, les validations suivantes ont ete passees :

- `powershell -ExecutionPolicy Bypass -File scripts/run-geoapp-agent-suite.ps1`
  - lance la suite unifiee backend + frontend GeoApp
- `python -m pytest gc-backend/tests/test_plugins_api.py`
  - actuellement `123 passed` sur les cas metasolver, orchestration, arbitrage de workflow, `hidden_content`, `image_puzzle`, `formula`, `coord_transform`, `checker`, plusieurs scenarios end-to-end, des cas hybrides ambigus, des cas de budget epuise et un corpus reutilisable de cas proches du reel, desormais externalise en fixture JSON, branche sur `classify`, `resolve` et `run-next-step`
  - ce corpus JSON couvre maintenant aussi des listings fournis par l utilisateur, notamment un cas formule + checker sur questions sportives, un cas serie avec image a code symbolique type templier, et un cas polyglotte image + checker
- `python -m pytest gc-backend/tests/test_archive_api.py`
  - validation du stockage `resolution_diagnostics`, `resume_state` et `history_state`
- `yarn --cwd theia-blueprint/theia-extensions/plugins build`
  - build frontend plugins OK
- `yarn --cwd theia-blueprint/theia-extensions/plugins test:geoapp`
  - validation du choix de workflow GeoApp dans le `plugin_executor`, du payload envoye au chat GeoApp depuis le panneau metasolver, du format du prompt diagnostique transmis au chat et de l emission de l evenement d ouverture de chat
- `yarn --cwd theia-blueprint/theia-extensions/zones build`
  - build frontend zones OK
- `yarn --cwd theia-blueprint/theia-extensions/zones test:geoapp`
  - validation du prompt metier de la fiche geocache, du payload complet d ouverture GeoApp depuis la fiche, du routage de profil GeoApp, du choix du workflow de preview, du payload d ouverture de chat, du format de prompt `resume_state`, du titre de session, du nettoyage des settings, de la creation de session, de la reutilisation de session, du cycle `window event -> bridge -> session`, de l emission de l evenement d ouverture depuis la fiche geocache, du fallback vers un agent pret et de l integration entre la fiche geocache, le `plugin_executor` et le bridge

Les tests metasolver couvrent notamment :

- morse
- chiffres
- T9
- multitap
- Houdini
- Nak Nak
- Shadok
- Tom Tom
- Gold-Bug
- POSTNET
- nombres premiers
- symboles chimiques
- Bacon
- Polybius
- chiffres romains
- classification de listing et extraction de fragments

## 10. Limites connues

Le systeme livre est solide pour une premiere phase, mais il ne constitue pas encore un agent completement autonome.

Limites connues :

- heuristiques principalement rule-based
- pas encore d'automatisation profonde des checkers
- branche `image_puzzle` exploitable, avec `alt/title`, `EXIF`, QR / barcode, OCR classique et `vision_ocr` budgete, mais sans analyse visuelle plus riche
- pas encore de decodeur specialise pour certains codes symboliques visuels type templier / pigpen ; ces cas sont aujourd hui bien routes vers `image_puzzle`, mais pas encore resolus de bout en bout par un plugin dedie
- classification utile mais encore perfectible sur les cas tres ambigus

Point technique connu :

- un warning de validation de plugin subsiste sur `wherigo_reverse_decoder`
- ce point est connu, non traite dans cette serie, et non bloque le flux documente ici

## 11. Fichiers cles

### Backend

- `gc-backend/gc_backend/blueprints/plugins.py`
- `gc-backend/gc_backend/blueprints/archive.py`
- `gc-backend/gc_backend/geocaches/archive_service.py`
- `gc-backend/gc_backend/geocaches/models.py`
- `gc-backend/gc_backend/plugins/schemas/plugin.schema.json`
- `gc-backend/tests/test_plugins_api.py`
- `gc-backend/tests/workflow_scenario_cases.py`
- `gc-backend/tests/fixtures/realistic_workflow_cases.json`
- `gc-backend/tests/fixtures/realistic_workflow_cases.template.json`
- `gc-backend/tests/fixtures/README.md`
- `gc-backend/tests/test_archive_api.py`

### Plugins official enrichis

- `gc-backend/plugins/official/alpha_decoder/plugin.json`
- `gc-backend/plugins/official/t9_code/plugin.json`
- `gc-backend/plugins/official/morse_code/plugin.json`
- `gc-backend/plugins/official/base_converter/plugin.json`
- `gc-backend/plugins/official/vigenere_cipher/plugin.json`
- `gc-backend/plugins/official/chemical_elements/plugin.json`
- `gc-backend/plugins/official/prime_numbers/plugin.json`
- `gc-backend/plugins/official/houdini_code/plugin.json`
- `gc-backend/plugins/official/nak_nak_code/plugin.json`
- `gc-backend/plugins/official/shadok_numbers/plugin.json`
- `gc-backend/plugins/official/postnet_barcode/plugin.json`
- `gc-backend/plugins/official/gold_bug/plugin.json`
- `gc-backend/plugins/official/tom_tom/plugin.json`

### Frontend Theia

- `theia-blueprint/theia-extensions/plugins/src/common/plugin-protocol.ts`
- `theia-blueprint/theia-extensions/plugins/src/browser/services/plugins-service.ts`
- `theia-blueprint/theia-extensions/plugins/src/browser/plugin-tools-manager.ts`
- `theia-blueprint/theia-extensions/plugins/src/browser/plugin-executor-widget.tsx`
- `theia-blueprint/theia-extensions/plugins/src/browser/plugin-executor-geoapp-shared.ts`
- `theia-blueprint/theia-extensions/plugins/src/browser/tests/plugin-executor-geoapp-shared.test.ts`
- `theia-blueprint/theia-extensions/zones/src/browser/geoapp-chat-agent.ts`
- `theia-blueprint/theia-extensions/zones/src/browser/geoapp-chat-shared.ts`
- `theia-blueprint/theia-extensions/zones/src/browser/geoapp-chat-bridge.ts`
- `theia-blueprint/theia-extensions/zones/src/browser/tests/geoapp-chat-shared.test.ts`
- `theia-blueprint/theia-extensions/zones/src/browser/tests/geoapp-chat-bridge.test.ts`
- `theia-blueprint/theia-extensions/zones/src/browser/geocache-details-widget.tsx`
- `theia-blueprint/theia-extensions/zones/src/browser/zones-frontend-module.ts`

## 12. Relation avec les autres documents

Ce document complete les docs existantes, sans les remplacer :

- `docs/PLUGINS_FONCTIONNEMENT.md`
  - reference generale du systeme de plugins
- `docs/FORMULA_SOLVER_FONCTIONNEMENT.md`
  - details du workflow formula
- `docs/ARCHIVE_FEATURE.md`
  - details du systeme d'archive

Ce document doit etre considere comme la vue d'ensemble de la couche "agent geocaching / metasolver assiste / routage de workflow".
