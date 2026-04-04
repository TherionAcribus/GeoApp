# Agent Theia Geocaching - Reste a faire

Ce document liste le travail restant pour passer du systeme actuel, deja utile et structure, vers un agent Theia de resolution de geocaches avec davantage d'autonomie, de robustesse et de tracabilite.

## Etat actuel

Le socle deja en place couvre :

- classification multi-label des listings
- extraction de fragments secrets candidats
- recommandation dynamique de plugins `metasolver`
- UI `plugin_executor` assistee
- routage vers `formula-solver`
- exposition comme tools IA
- envoi du diagnostic vers le chat GeoApp
- transmission du `resume_state` vers le chat GeoApp
- archivage compact de `resolution_diagnostics`
- historique multi-tentatives `history_state` dans l'archive

Le point cle est que le systeme sait deja guider l'utilisateur et l'IA. Ce qui manque maintenant est surtout d'industrialiser les branches encore peu outillees, de mieux scorer les hypotheses finales et de rendre la trace plus exploitable.

## Priorites recommandees

## 1. Durcir l'orchestrateur central de resolution

L'orchestrateur central existe deja en backend et pilote deja :

- la classification
- le choix du workflow principal
- le plan d'action
- le budget et les conditions d'arret
- l'execution step-by-step des branches deja outillees

Ce qu'il reste a faire :

- mieux tracer les hypotheses acceptees et rejetees
- etendre les raisons de bifurcation explicites aux autres conflits encore limites, par exemple `word_game` vs `secret_code` ou les cas ou une piste `formula` s effondre vers une autre branche
- ouvrir plus de branches sur ce meme orchestrateur
- eviter que certaines decisions restent dupliquees entre backend, UI et prompt
- modeliser explicitement les enigmes de serie ou de collecte inter-caches, quand un listing depend de tampons, tableaux externes ou valeurs recuperees dans d'autres caches avant toute resolution locale

Pourquoi c'est prioritaire :

- c'est la condition pour aller vers une vraie autonomie
- cela reduira les comportements redondants ou incoherents entre UI et chat

## 2. Etendre la couverture des signatures et metadonnees plugins

Le moteur actuel couvre deja un bon ensemble de cas, mais il faut continuer a enrichir les heuristiques et les `plugin.json`.

Travail recommande :

- etendre `preferred_when` a davantage de plugins metasolver
- enrichir `family`, `requires_key`, `supports_grouped_input`
- ajouter des signaux pour les cas encore ambigus
- mieux differencier les plugins "mots" generiques quand aucun motif lexical fort n'est detecte

Pistes concretes :

- affiner les collisions entre `morse`, `tap_code` et certains codes symboliques courts
- enrichir les plugins a cle
- mieux traiter les cas hybrides lettres + chiffres + ponctuation

## 3. Automatiser davantage la branche `formula`

Le systeme sait deja router vers Formula Solver, mais le chainage n'est pas encore complet.

Travail recommande :

- enrichir le chainage `detect-formula -> find-questions -> search-answer -> calculate-value -> calculate-coordinates`
- mieux gerer les cas ambigus, incomplets ou contradictoires
- permettre a l'agent de revenir vers une branche alternative si la piste formule s'effondre
- mieux exposer les hypotheses formule retenues/rejetees

## 4. Integrer vraiment les checkers dans la boucle

La classification sait deja detecter `checker_available`, et l'agent a acces aux tools checkers.

Ce qui manque :

- une politique claire pour savoir quand lancer un checker
- une verification automatique des sorties plausibles
- la gestion des sessions checker sur plusieurs tentatives
- un historique des essais de validation

Objectif :

- transformer le checker en mecanisme de validation final, pas en simple outil annexe

## 5. Traiter la branche `hidden_content` de facon plus profonde

La branche `hidden_content` n'est plus seulement detectee :

- l'orchestrateur sait maintenant executer `inspect-hidden-html`
- cette etape extrait commentaires HTML et textes invisibles inline
- elle reconnait aussi les elements caches par CSS simple via classes / ids / tags
- elle couvre aussi des selecteurs structuraux simples de type descendant et enfant direct
- elle peut aussi charger quelques feuilles de style externes en best effort pour y chercher des regles cachantes
- elle tient compte de `aria-hidden` et d autres marqueurs suspects de masquage
- elle peut produire un fragment cache principal et une recommandation metasolver associee

L'exploitation reste toutefois partielle.

Travail recommande :

- analyser plus finement les attributs DOM suspects
- aller au-dela des selecteurs CSS simples deja geres pour couvrir des structures plus complexes, d autres combinateurs et des feuilles de style externes plus riches
- extraire les sequences interessantes depuis plus de sources HTML que les seuls commentaires / textes invisibles inline ou caches par CSS simple
- relier cela a `analysis_web_page` ou a un service dedie

Objectif :

- faire remonter des fragments secrets plus riches et mieux scores

## 6. Approfondir la branche `image_puzzle`

La branche `image_puzzle` n'est plus seulement detectee :

- l'orchestrateur sait maintenant executer `inspect-images`
- cette etape extrait les `alt/title` d images
- elle exploite aussi des indices faibles depuis les noms de fichiers / URLs d images
- elle accepte aussi des `images` explicites sans `geocache_id`
- elle exploite aussi `EXIF`
- elle tente `qr_code_detector` pour QR et codes-barres, puis `easyocr_ocr`
- elle sait maintenant utiliser `vision_ocr` en fallback si QR et OCR classique ne remontent rien, avec un budget dedie qui tient compte de la taille / resolution / poids des images
- elle peut produire un fragment image principal, une recommandation metasolver associee et une plausibilite geographique si des coordonnees sortent de l OCR / du QR

Voir aussi le memo de cadrage image :

- `docs/MEMO_IMAGES_AGENT_IA.md`

L'exploitation reste toutefois partielle.

Travail recommande :

- ajouter d'autres indices visuels simples au-dela de `EXIF` / QR / barcode
- affiner encore le cout `vision_ocr` avec des signaux plus fiables que les seules dimensions / taille brute
- structurer une vraie branche image independante de `metasolver` quand le probleme est purement visuel
- ajouter des decodeurs specialises pour des familles de codes symboliques visuels encore non couvertes, par exemple les codes type templier / pigpen rencontres dans des listings reels
- continuer a fiabiliser l'arbitrage texte / HTML / image dans les cas faibles, hybrides ou purement visuels

Dependances naturelles :

- OCR
- analyse d'images de geocache
- eventuellement vision plus avancee si necessaire

## 7. Approfondir la validation geographique et de plausibilite

Une validation geographique existe deja dans l'orchestrateur, sur les sorties formule, metasolver et image quand elles produisent des coordonnees. Il reste toutefois a la rendre plus fine.

Travail recommande :

- affiner les seuils et les raisons de plausibilite selon le type de geocache
- mieux exploiter les waypoints, zones et distances attendues
- verifier plus finement format, hemisphere, distance et coherence des minutes
- coupler plus intelligemment plausibilite geographique et checkers quand ils existent

Objectif :

- reduire fortement les faux positifs

## 8. Mieux persister et rejouer les traces de resolution

Le `resolution_diagnostics` sait deja :

- persister et recharger un `resume_state` utile pour le panneau metasolver
- conserver un `history_state` compact sur plusieurs tentatives
- dedupliquer les tentatives identiques
- restaurer explicitement une tentative dans le `Plugin Executor`
- rejouer une etape backend choisie depuis l'historique d'archive

Ce n'est toutefois pas encore une vraie trace rejouable complete.

Travail recommande :

- enrichir chaque tentative avec des etats intermediaires plus fins que le seul snapshot final
- distinguer hypotheses, essais, echecs, validations
- enrichir la chronologie deja visible dans l'UI archive avec plus de details exploitables

Objectif :

- faciliter le debug
- comparer plusieurs strategies
- rendre les decisions IA auditables

## 9. Ajouter une vue utilisateur dediee a la resolution

Le panneau metasolver a ete fortement enrichi, mais il reste un panneau technique. Une vue plus metier serait utile.

Travail recommande :

- creer une vue "Resolution assistant" ou "Puzzle analysis"
- afficher classification, hypotheses, plugins recommandes, resultats utiles et statut checker au meme endroit
- separer clairement les workflows `secret_code`, `formula`, `hidden_content`, `image_puzzle`

Objectif :

- eviter que l'utilisateur doive naviguer entre plusieurs widgets pour suivre une resolution

## 10. Renforcer les tests

Les tests existants couvrent deja une bonne partie du metasolver assiste et de la classification. Il manque encore des tests de niveau superieur.

Travail recommande :

- utiliser la suite unifiee `powershell -ExecutionPolicy Bypass -File scripts/run-geoapp-agent-suite.ps1` comme point d'entree standard de validation avant d'ajouter de nouveaux comportements
- etendre encore le corpus reutilisable, maintenant externalise en fixture JSON, au-dela des cas deja couverts sur `secret_code`, `hidden_content`, `image_puzzle`, `formula`, `coord_transform`, `checker`, les hybrides ambigus, les cas de budget epuise, les formules a questions + checker et les listings image a code symbolique
- brancher ensuite ce corpus sur des tests GeoApp de plus haut niveau, pas seulement sur le backend `classify / resolve / run-next-step`
- tests UI sur le panneau metasolver
- etendre les tests GeoApp au-dela des helpers deja couverts sur le bridge, le `plugin_executor`, le prompt diagnostique, le prompt metier et le payload complet de la fiche geocache, ainsi que l emission d evenement d ouverture de chat, vers des interactions UI completes et l integration avec le chat Theia reel
- tests sur des listings reels ou des fixtures encore plus proches du reel
- tests de non regression sur les cas ambigus
- utiliser ces fixtures reelles pour documenter aussi les limites connues, par exemple les cas de dependance a une serie de caches qui retombent aujourd hui en `general`
- utiliser ces fixtures reelles pour documenter aussi les familles de codes encore non couvertes par des decodeurs dedies, par exemple les images a code templier

Objectif :

- stabiliser l'automatisation avant d'ajouter encore plus d'heuristiques

## 11. Nettoyer les points techniques restants

Points deja identifies :

- warning de validation sur `wherigo_reverse_decoder`
- dette technique potentielle sur certaines heuristiques centralisees dans `plugins.py`
- besoin probable de mieux modulariser l'analyse si le nombre de familles continue a grandir

Travail recommande :

- corriger le warning plugin restant
- extraire a terme des helpers ou services backend dedies
- eviter que `plugins.py` devienne une monolithique difficile a maintenir

## Feuille de route conseillee

## Phase 1 - Consolider l'existant

- corriger les warnings de validation restants
- etendre les metadonnees plugin les plus rentables
- etendre le corpus de scenarios backend et les tests end-to-end au-dela des premiers scenarios deja couverts, puis le relier a des tests frontend/chat
- fiabiliser les scores et les raisons retournees

## Phase 2 - Monter en autonomie

- fiabiliser la logique de decision unique sur les cas limites
- brancher les branches restantes dans cette logique de decision unique
- mieux expliquer les bascules et les arrets
- renforcer le score final de confiance

## Phase 3 - Ouvrir de nouvelles branches

- approfondir `hidden_content` complexe
- approfondir `image_puzzle` non textuel
- enrichir la persistence des traces
- industrialiser davantage la branche checker

## Phase 4 - Produit fini cote utilisateur

- creer une vue metier de resolution
- exposer un historique clair des essais
- rendre la decision de l'agent plus lisible et plus contestable

## Definition de "vraiment pret"

On pourra considerer que l'agent Theia est pret pour un usage avance quand il saura :

- classer correctement la plupart des listings mystery courants
- choisir seul le bon workflow principal
- limiter ses essais de facon raisonnable
- valider ou rejeter ses hypotheses avec des signaux objectifs
- tracer proprement ce qu'il a tente
- rester comprehensible pour l'utilisateur

## Recommandation pratique

La meilleure suite n'est pas d'ajouter immediatement encore 20 heuristiques.

La meilleure suite est :

1. consolider l'orchestration
2. approfondir `hidden_content` complexe et `image_puzzle` non textuel
3. rendre la trace de resolution plus fine et plus auditable

Autrement dit : il faut maintenant structurer la decision avant d'elargir encore plus le catalogue de cas.
