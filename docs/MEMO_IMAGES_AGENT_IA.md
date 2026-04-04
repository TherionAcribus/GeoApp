# Memo - Strategie Images pour l'agent IA GeoApp

Ce memo cadre ce qu'il est pertinent de faire avec les images dans GeoApp, et ce qu'il ne faut pas essayer de faire de maniere trop ambitieuse ou trop fragile.

Le point de depart est simple :

- il existe potentiellement des dizaines ou des centaines de familles d'alphabets ou de codes visuels
- beaucoup de ces codes apparaissent uniquement dans des images
- il n'est pas raisonnable de creer un plugin dedie par alphabet
- l'agent IA doit donc surtout savoir detecter, router, preparer et assister, plus que "tout decoder tout seul"

## 1. Position produit

La bonne logique produit n'est pas :

- un plugin par alphabet
- un decodeur "magique" pour toutes les images
- une promesse d'automatisation complete sur des cas visuels tres heterogenes

La bonne logique produit est plutot :

- automatiser ce qui est robuste
- assister ce qui est frequent mais variable
- laisser en manuel ce qui depend trop du style visuel, de la qualite de l'image ou du contexte

Concretement :

- `QR`, `barcode`, `OCR`, `EXIF` doivent rester des branches fortement automatisees
- les alphabets symboliques visuels doivent principalement passer par un workflow assiste
- la zone `Alphabet` manuelle est donc une brique centrale du produit, pas un simple fallback temporaire

## 2. Ce qui existe deja

La branche `image_puzzle` sait deja :

- detecter qu'un listing depend d'une image
- exploiter `alt`, `title`, noms de fichiers et URLs
- utiliser `EXIF`
- lancer `qr_code_detector`
- lancer `easyocr_ocr`
- lancer `vision_ocr` en fallback avec budget
- produire un fragment principal, une recommandation metasolver et une plausibilite geographique si utile

Autrement dit :

- l'entree "image" existe deja dans l'orchestrateur
- le besoin restant n'est pas de "creer la branche image"
- le besoin restant est de mieux separer automatisation robuste et assistance utilisateur

## 3. Typologie utile des cas image

Pour piloter correctement l'agent, il faut distinguer plusieurs familles.

### 3.1 Image avec texte lisible

Exemples :

- phrase cachee
- nombres
- coordonnees
- mot OCRisable

Traitement recommande :

- OCR automatique
- extraction de texte
- reinjection dans `metasolver`, `formula`, `checker` ou validation geographique

### 3.2 Image avec code machine lisible

Exemples :

- QR
- code-barres
- payload encode directement

Traitement recommande :

- detection et extraction automatiques
- reinjection directe dans l'orchestrateur

### 3.3 Image avec alphabet symbolique

Exemples :

- templier / pigpen
- symboles inventes
- alphabet graphique de serie
- glyphes repetitifs

Traitement recommande :

- ne pas chercher a tout decoder automatiquement par defaut
- extraire une sequence ordonnee de glyphes ou de "symboles distincts"
- ouvrir ou alimenter la zone `Alphabet`
- laisser l'utilisateur definir le mapping
- reutiliser ensuite le resultat decode dans `metasolver`

### 3.4 Image a lecture visuelle libre

Exemples :

- lire un detail dans un dessin
- reperer un objet
- suivre des fleches
- compter des elements
- trouver une orientation

Traitement recommande :

- assistance, pas promesse d'automatisation forte
- extraction de metadonnees utiles
- formulation d'une hypothese de travail
- envoi eventuel vers le chat GeoApp avec le bon contexte

### 3.5 Image geometrique ou cartographique

Exemples :

- projection
- angle
- distance
- carte
- schema menant a des coordonnees

Traitement recommande :

- detection de signaux "coordonnees / projection / carte"
- bascule vers `coord_transform` ou `formula` si possible
- sinon assistance manuelle

## 4. Ce qu'il ne faut pas faire

### 4.1 Un plugin par alphabet

C'est la mauvaise direction :

- explosion du nombre de plugins
- maintenance ingouvernable
- UX confuse
- faible robustesse quand le style visuel change

### 4.2 Un decodeur universel pour toutes les images

C'est trop ambitieux et trop fragile :

- depend du contraste
- depend de la rotation
- depend de la perspective
- depend du fond
- depend du style graphique

### 4.3 Faire semblant d'etre automatique

Le systeme doit etre honnete :

- si l'image est detectee mais pas reellement decodable automatiquement, il faut le dire
- il faut alors router vers un workflow assiste, pas retourner une fausse recommandation "forte"

## 5. Architecture cible recommandee

### 5.1 Garder `image_puzzle` comme branche d'entree

Cette branche reste le point de classification principal pour les listings visuels.

Ensuite, elle doit bifurquer vers des sous-cas plus clairs :

- `image_text`
- `image_machine_code`
- `image_symbol_alphabet`
- `image_visual_reasoning`
- `image_geo_pattern`

Il ne s'agit pas forcement de cinq workflows publics des maintenant.
Mais l'orchestrateur doit au moins raisonner avec cette granularite.

### 5.2 Introduire une vraie branche assistee `symbol_alphabet`

C'est probablement la prochaine brique la plus utile.

Objectif :

- detecter qu'on est face a un alphabet symbolique
- preparer le travail utilisateur
- memoriser le mapping utilisateur
- reutiliser automatiquement le texte decode ensuite

Sorties attendues :

- sequence de glyphes
- ordre de lecture
- regroupement des symboles identiques
- apercu des occurrences
- mapping symbole -> lettre saisi par l'utilisateur
- texte decode reconstruit

### 5.3 Faire de la zone `Alphabet` un workflow officiel de l'agent

La zone `Alphabet` ne doit pas etre un outil isole.
Elle doit etre un maillon explicite du pipeline.

Flux recommande :

1. le backend classe le listing en `image_puzzle`
2. `inspect-images` constate qu'on a probablement un alphabet symbolique
3. le systeme cree un `alphabet_session_payload`
4. l'UI ouvre la zone `Alphabet`
5. l'utilisateur renseigne le mapping
6. le texte decode repart vers `metasolver`, `formula` ou `checker`
7. l'archive conserve cette tentative

## 6. Niveau d'automatisation recommande

### 6.1 Ce qu'il faut automatiser fort

- OCR texte lisible
- QR / barcode
- EXIF
- extraction de noms de fichiers / `alt` / `title`
- plausibilite geographique
- routage de workflow

### 6.2 Ce qu'il faut automatiser avec prudence

- detection "probable alphabet symbolique"
- segmentation grossiere de glyphes
- ordre de lecture
- regroupement des symboles similaires

### 6.3 Ce qu'il faut laisser manuel

- attribution finale symbole -> lettre pour les alphabets exotiques
- interpretation des images tres creatives
- resolution d'images dependant trop du contexte de serie

## 7. Proposition technique concrete

### Phase 1 - Assistance sans vision lourde

Objectif :

- preparer un workflow `Alphabet` propre sans promettre de reconnaissance visuelle parfaite

Travail :

- ajouter un sous-type `image_symbol_alphabet` dans l'orchestrateur
- enrichir `inspect-images` pour produire un `alphabet_candidate`
- exposer ce candidat a l'UI
- permettre a la zone `Alphabet` d'etre prechargee depuis l'agent

### Phase 2 - Extraction de glyphes

Objectif :

- aider l'utilisateur a ne pas retranscrire l'image a la main

Travail :

- detection de zones a fort contraste
- segmentation de symboles
- ordre de lecture
- dedoublonnage des glyphes proches

Sortie :

- une sequence de tokens stables de type `S1 S2 S3 S1 ...`

### Phase 3 - Aide au mapping

Objectif :

- assister le dechiffrement sans imposer une famille d'alphabet

Travail :

- frequence des symboles
- positions repetees
- motifs de mots
- longueur des groupes
- hypotheses lexicales si la langue probable est connue

### Phase 4 - Decodeurs specialises optionnels

Uniquement pour quelques familles tres frequentes et robustes.

Exemples possibles :

- pigpen / templier si le corpus reel le justifie
- semaphore graphique si la detection est fiable

Important :

- ces decodeurs doivent etre des accelerateurs optionnels
- pas la colonne vertebrale du systeme image

## 8. Donnees et tests a prevoir

Pour rendre cette branche utile sans la rendre fragile, il faut un corpus explicite.

A collecter :

- images OCR propres
- images QR / barcode
- images a alphabet symbolique
- images visuelles ambiguës
- images impossibles a automatiser proprement

Les fixtures devront conserver :

- type de cas attendu
- niveau d'automatisation attendu
- branche de workflow attendue
- limitation connue si non resolu automatiquement

## 9. Decision recommandee

Decision de cadrage recommandee :

- ne pas multiplier les plugins par alphabet
- garder les images dans `image_puzzle`
- ajouter une vraie sous-branche assistee `symbol_alphabet`
- faire de la zone `Alphabet` un workflow officiel de l'agent
- reserver les decodeurs specialises a quelques familles vraiment rentables

## 10. Impact sur la partie agent IA generale

Cette decision simplifie aussi l'agent general.

L'agent n'a pas besoin de "connaitre cent alphabets".
Il doit surtout savoir :

- reconnaitre qu'on est sur un probleme image
- distinguer texte, QR, alphabet symbolique ou lecture visuelle libre
- router vers le bon outil
- conserver la trace de ce qui a ete fait
- reutiliser correctement le resultat manuel si l'utilisateur decode lui-meme

Autrement dit :

- la bonne IA n'est pas celle qui pretend tout decouvrir seule
- c'est celle qui sait quand automatiser, quand assister, et quand laisser la main

## 11. Recommandation immediate

Pour la suite du projet :

1. ne pas ouvrir maintenant un plugin `templar_code` texte
2. documenter que les cas type templier restent des cas `image_puzzle`
3. a terme, introduire une branche `symbol_alphabet`
4. brancher cette branche sur la zone `Alphabet`

Cette approche est plus maintenable, plus scalable, et mieux alignee avec l'usage reel du produit.
