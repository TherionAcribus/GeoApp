# Notes - Documentation technique

## Vue d'ensemble

Le systeme de Notes permet d'attacher du texte libre (au format **Markdown**, cf. section dediee) a une geocache. Il distingue **deux familles** de notes :

1. **Notes applicatives** (locales, stockees en base GeoApp) : notes saisies par l'utilisateur ou ajoutees par des plugins/agents (ex. EarthCoach). Chaque note a un `source` (`user`, `system`, `earthcoach`, ...) et un `note_type` (`user` / `system`).
2. **Note personnelle Geocaching.com** : la "personal cache note" d'une geocache sur GC.com. Elle est unique par cache, importable (scraping de la page) et reenvoyable (API GC.com). Elle est mise en cache cote GeoApp sur la geocache elle-meme.

La fonctionnalite couvre le CRUD des notes applicatives, l'import de la note GC.com, et le push d'une note applicative vers la note GC.com (avec gestion de conflit).

Cote frontend, l'extension concernee est `zones` :

```text
frontend/theia-extensions/zones/src/browser/geocache-notes-*
```

Cote backend (Flask) :

```text
backend/gc_backend/blueprints/notes.py
backend/gc_backend/services/geocaching_personal_notes.py
```

## Architecture

### Fichiers frontend

| Fichier | Role |
|---|---|
| `geocache-notes-widget.tsx` | `ReactWidget` Theia. Detient tout l'etat (notes, note GC.com, flags de chargement, edition en cours), orchestre les actions et appelle le controller. Rend une `GeocacheNotesView` purement presentationnelle. |
| `geocache-notes-view.tsx` | Composant React **sans etat** (props in / callbacks out). Contient le sous-composant memoise `NoteItem` et tous les styles. |
| `geocache-notes-controller.ts` | Couche metier sans dependance Theia UI. Expose le CRUD, l'import GC.com, et la logique de push avec resolution de conflit (`append` / `replace` / `cancel`). Lit la preference d'auto-sync. |
| `geocache-notes-service.ts` | Client HTTP (via `BackendApiClient`). Mappe chaque action sur un endpoint backend. |
| `geocache-notes-types.ts` | DTO et types partages (`GeocacheNoteDto`, reponses d'API, inputs). |
| `geocache-notes-markdown-editor.tsx` | `NotesMarkdownEditor` : zone de saisie Markdown autonome (barre d'outils + textarea + apercu). Utilisee par les trois surfaces d'edition (nouvelle note, edition de note, note GC.com). |

Separation des responsabilites : **View** (rendu) -> **Widget** (etat + orchestration) -> **Controller** (metier) -> **Service** (HTTP). Le controller et la view ne dependent pas l'un de l'autre.

### Fichiers backend

| Fichier | Role |
|---|---|
| `blueprints/notes.py` | Blueprint Flask. CRUD des notes applicatives + endpoints de sync GC.com (import / push). |
| `services/geocaching_personal_notes.py` | `GeocachingPersonalNotesClient` : lecture de la note perso (scraping HTML de la page cache) et ecriture (`SetUserCacheNote`). |
| `geocaches/models.py` | Modeles `Note`, `GeocacheNote` (table de liaison) et champs `gc_personal_note*` sur `Geocache`. |

## Modele de donnees

### Backend

`Note` (table `note`) :

| Colonne | Type | Notes |
|---|---|---|
| `id` | Integer (PK) | |
| `content` | Text (not null) | |
| `note_type` | String(50) (not null) | `user` ou `system` |
| `source` | String(50) (not null, def. `user`) | `user`, `system`, `earthcoach`, ... |
| `source_plugin` | String(100) (nullable) | plugin emetteur eventuel |
| `created_at` / `updated_at` | DateTime UTC | `updated_at` auto via `onupdate` |

`GeocacheNote` (table `geocache_note`) : liaison **N-N** entre `geocache` et `note` (`geocache_id` + `note_id` en cle primaire composite, `added_at`). Une note peut donc etre liee a plusieurs geocaches.

`Geocache` (champs lies a la note GC.com) :

| Colonne | Sens |
|---|---|
| `gc_personal_note` | Dernier texte connu de la note perso GC.com (cache local). |
| `gc_personal_note_synced_at` | Date du dernier **import** depuis GC.com. |
| `gc_personal_note_last_pushed_at` | Date du dernier **envoi** vers GC.com. |

### Frontend (DTO)

`GeocacheNoteDto` : `{ id, content, note_type, source, source_plugin?, created_at, updated_at }` (miroir de `Note.to_dict()`).

`GeocacheNotesApiResponse` (reponse du GET liste) : `{ geocache_id, gc_code, name, gc_personal_note, gc_personal_note_synced_at, gc_personal_note_last_pushed_at, notes: GeocacheNoteDto[] }`.

## API backend

Toutes les routes renvoient du JSON. Les erreurs serveur sont `500 { error }`.

| Methode | Route | Role |
|---|---|---|
| GET | `/api/geocaches/<geocache_id>/notes` | Liste les notes applicatives (triees `created_at DESC`) + etat de la note GC.com. |
| POST | `/api/geocaches/<geocache_id>/notes` | Cree une note applicative et la lie a la cache. |
| PUT | `/api/notes/<note_id>` | Modifie une note (contenu / type). **Notes `source == user` uniquement.** |
| DELETE | `/api/notes/<note_id>` | Supprime la note et ses liaisons. |
| POST | `/api/geocaches/<geocache_id>/notes/sync-from-geocaching` | Importe la note perso GC.com (scraping) et met a jour le cache local. |
| POST | `/api/notes/<note_id>/sync-to-geocaching?geocacheId=<id>` | Pousse une note `user` vers la note perso GC.com. |

### Details notables

- **Creation** (`POST .../notes`) : `content` requis (sinon `400`). `note_type` defaut `user`, `source` defaut `user`. Apres commit, `ArchiveService.sync_from_geocache(geocache)` met a jour le snapshot d'archive. Reponse `201 { note, geocache_id }`.
- **Edition** (`PUT /api/notes/<id>`) : refusee si `note.source != 'user'` (`400 Only user notes can be edited`). Resynchronise l'archive de **toutes** les geocaches liees a la note.
- **Suppression** : retire d'abord les lignes `GeocacheNote` (liaisons) puis la `Note`. Reponse `{ deleted: true }`.
- **Import GC.com** : requiert `gc_code` (sinon `400`). Ecrit `gc_personal_note` + `gc_personal_note_synced_at`.
- **Push GC.com** : `source == user` requis. `geocacheId` lu dans la query string ; a defaut, la premiere liaison de la note est utilisee. Le corps peut fournir un `content` final (cas `append`/`replace` resolu cote front) ; sinon le contenu de la note est envoye tel quel. Echec GC.com -> `502`. Succes -> ecrit `gc_personal_note` + `gc_personal_note_last_pushed_at`.

### Codes d'erreur courants

- `400` : `content` manquant / vide, note non editable (source != user), absence de `gc_code`.
- `404` : geocache ou note inconnue.
- `502` : echec de l'ecriture sur Geocaching.com.

## Integration Geocaching.com

`GeocachingPersonalNotesClient` reutilise la session authentifiee centrale (`get_auth_service().get_session()`).

- **Lecture (`get_personal_note`)** : GET de la page publique `https://www.geocaching.com/geocache/<GC_CODE>`, puis extraction de la note par plusieurs strategies successives (tolerance aux evolutions du HTML) :
  1. nouveau design : `div#srOnlyCacheNote` / `button#viewCacheNote` ;
  2. ancien design : `<textarea ... cacheNote ...>` ;
  3. patterns JSON integres (`"cacheNote"`, `"UserCacheNote"`, `"PersonalCacheNote"`).
  Le texte est nettoye (suppression des balises, decodage des entites, normalisation des espaces). `404` GC.com -> `None`.
- **Ecriture (`update_personal_note`)** : recupere un `userToken` (via `GeocachingLogsClient`), puis POST `https://www.geocaching.com/seek/cache_details.aspx/SetUserCacheNote` avec `{ dto: { et: <note>, ut: <token> } }`. Renvoie un booleen de succes.

Point d'attention : la lecture depend du **scraping** de la page ; un changement de structure GC.com peut casser l'extraction (d'ou les multiples fallbacks et le logging de diagnostic quand `cacheNote` est present mais non parse).

## Frontend : etat et flux

### Etat du widget

Le widget (`geocache-notes-widget.tsx`) detient notamment :

- contexte : `geocacheId`, `geocacheCode`, `geocacheName` ;
- donnees : `notes: GeocacheNoteDto[]`, `gcPersonalNote`, `gcPersonalNoteSyncedAt`, `gcPersonalNoteLastPushedAt` ;
- flags : `isLoading`, `isCreating`, `isSyncingFromGc`, `syncingNoteId` ;
- saisie : `newNoteContent`, `newNoteType` ;
- edition : `editingNoteId`, `editingContent`, `editingType` ;
- `loadRequestToken` : jeton d'annulation des chargements concurrents.

`this.update()` (de `ReactWidget`) re-rend la `View` apres chaque mutation d'etat.

### Selection d'une geocache

`setGeocache({ geocacheId, gcCode, name })` :
1. pose le contexte, `resetWidgetState()`, met a jour le titre de l'onglet ;
2. `loadNotes()` (asynchrone) ;
3. si la preference `geoApp.notes.gcPersonalNote.autoSyncMode === 'onNotesOpen'`, declenche un import GC.com **silencieux**.

`loadRequestToken` : `loadNotes()` incremente le jeton a chaque appel ; au retour, si le jeton ou le `geocacheId` ont change, le resultat est ignore. Cela evite qu'un chargement lent d'une cache precedente n'ecrase l'affichage de la cache courante.

### Preference d'auto-sync

`geoApp.notes.gcPersonalNote.autoSyncMode` (type `GcPersonalNoteAutoSyncMode`) :

| Valeur | Effet |
|---|---|
| `manual` (defaut) | Import GC.com uniquement via le bouton "Importer note GC.com". |
| `onNotesOpen` | Import automatique a l'ouverture du panneau Notes. |
| `onDetailsOpen` | Import declenche a l'ouverture de la fiche (cote details). |

### Push d'une note vers GC.com (resolution de conflit)

`GeocacheNotesController.syncUserNoteToGeocaching` :
1. note `user` requise ;
2. si aucune note GC.com connue localement, un import prealable est tente pour detecter une note existante ;
3. si une note GC.com existe deja, l'utilisateur choisit via un dialogue (`ConfirmSaveDialog`) :
   - **Remplacer** (`replace`) : envoie le texte de la note ;
   - **Ajouter** (`append`) : concatene `note GC existante` + `\n\n` + `nouveau texte` ;
   - **Annuler** (`cancel`) : aucune ecriture.
4. le contenu final est envoye via `POST /api/notes/<id>/sync-to-geocaching`.

## Markdown

Depuis aout 2026, les notes sont saisies et affichees en **Markdown** (auparavant : texte brut).

### Syntaxe et moteur

Le moteur est celui **deja utilise par l'editeur de logs**, reutilise tel quel :

| Module | Role |
|---|---|
| `log-markdown.ts` | Parsing pur (sans React, donc teste : `tests/log-markdown.test.ts`). Blocs (titres `#`/`##`/`###`, listes `-`, citations `>`, blocs de code ```` ``` ````) et inline (`**gras**`, `*italique*`, `` `code` ``, `[lien](url)`). |
| `log-markdown-renderer.tsx` | Rendu React des blocs et des tokens inline. |
| `log-editor/markdown-toolbar.tsx` | `MarkdownToolbar` : boutons B / I / code / lien / H1 / H2 / liste / citation. |
| `log-editor/markdown-preview.tsx` | `MarkdownPreview` : bloc `<details>` « Apercu Markdown (texte final) » + avertissement sur les asterisques non interpretees. |
| `log-editor/markdown-editor-helpers.ts` | Calculs purs : appliquer/retirer un format, appliquer un prefixe de ligne, detecter le format sous le curseur, borner une selection. |

C'est **la syntaxe de Geocaching.com** (voir <https://www.geocaching.com/guide/markdown.aspx>) : une emphase n'est reconnue que si les delimiteurs sont **colles** au texte (`**gras**` oui, `**gras **` non). Ce choix est volontaire : une note applicative peut etre poussee vers la note personnelle GC.com, et l'apercu doit donc correspondre a ce que GC.com affichera.

Effet de bord utile pour le geocaching : `A * B` (formule avec espaces) reste **litteral**, seul `A*B*C` serait interprete comme une emphase.

### Ou le Markdown s'applique

| Surface | Saisie | Affichage |
|---|---|---|
| Nouvelle note applicative | `NotesMarkdownEditor` | — |
| Edition d'une note applicative (`source == 'user'`) | `NotesMarkdownEditor` | `renderLogMarkdown` |
| Notes en lecture (toutes sources, y compris `system` / `earthcoach`) | — | `renderLogMarkdown` |
| Note personnelle GC.com | `NotesMarkdownEditor` | `renderLogMarkdown` |

### Pas de migration de donnees

Aucun changement de schema : le Markdown **est** du texte, `Note.content` reste un `Text` et l'API est inchangee. Les notes creees avant ce changement sont simplement rendues avec le meme moteur ; les regles conservatrices ci-dessus rendent le risque de reinterpretation quasi nul.

### `NotesMarkdownEditor` : conception

L'editeur de logs a **une seule** barre d'outils, qui pilote la zone de texte actuellement active (le widget detient `activeEditor` et `activeCaretFormat`). Le panneau Notes a fait le choix inverse : **chaque zone de saisie embarque sa propre barre**, et tout l'etat d'edition Markdown (position du curseur, format sous le curseur, apercu deplie) est **local au composant**.

Consequence : `geocache-notes-widget.tsx` n'a **pas** ete modifie — il ne connait rien du Markdown, il continue de detenir uniquement le texte.

Points techniques :

- **Valeur controlee + selection differee** : la valeur du textarea appartient au widget. Apres l'application d'un format, la nouvelle selection est stockee dans un `ref` et appliquee dans un `useLayoutEffect` **sans tableau de dependances** (le rendu suivant peut venir du widget pour une autre raison ; la selection en attente doit etre consommee des le premier rendu qui suit).
- **`footer`** : les controles propres a chaque surface (compteur de caracteres, boutons Ajouter / Sauvegarder / Envoyer) sont passes en prop et rendus **entre** le textarea et l'apercu, pour que deplier l'apercu ne repousse pas les boutons hors de vue.
- **Apercu paresseux** : `MarkdownPreview` ne construit l'arbre React du rendu que lorsque le `<details>` est ouvert.
- **Focus** : cliquer un bouton de la barre fait perdre le focus au textarea, mais `selectionStart` / `selectionEnd` sont conserves par le navigateur ; le `useLayoutEffect` redonne ensuite le focus et repositionne le curseur.

### Recherche

`getSearchableContent()` continue d'exposer le **texte source** (Markdown brut), pas le texte rendu : la recherche porte donc sur ce que l'utilisateur a tape.

## Performance (rendu React)

Le panneau peut afficher de nombreuses notes ; le rendu a ete optimise pour que la saisie reste fluide :

- **`NoteItem` memoise (`React.memo`)** : chaque carte de note est isolee. Taper dans la zone "nouvelle note" re-rend la `View` mais les `NoteItem` existants **court-circuitent** leur rendu.
- **Callbacks stables** : le widget expose des handlers en champs-fleches `readonly` (references figees) au lieu d'arrow functions recreees a chaque `render()`. C'est la condition pour que `React.memo` soit efficace.
- **Props d'edition neutralisees hors edition** : `editingContent` / `editingType` ne sont passes a leur valeur courante que pour la note reellement editee (`isEditing ? ... : ''`). Taper en edition ne re-rend **que** la note concernee.
- **Cache de formatage des dates** : `formatDateTime` memoise ses resultats dans une `Map` indexee par la chaine ISO brute (locale figee `fr-FR`, donc deterministe). Evite des `new Date().toLocaleString()` repetes.
- **Styles statiques hisses au niveau module** : ~25 objets `React.CSSProperties` constants alloues une seule fois ; seules les parties dynamiques (`cursor`, `opacity`, couleur du badge) restent inline.

Effet net : le cout d'une frappe est quasi independant du nombre de notes affichees.

## UX et accessibilite

- **Boutons desactives sur contenu vide** : "Ajouter" et "Sauvegarder" sont `disabled` (curseur `not-allowed` + `opacity`) tant que le contenu (apres `trim()`) est vide, en plus du blocage pendant les operations en cours.
- **Raccourcis clavier** :
  - zone "nouvelle note" : `Ctrl/Cmd+Enter` ajoute la note (si non vide) ;
  - zone d'edition : `Ctrl/Cmd+Enter` sauvegarde, `Escape` annule.
- **Autofocus** : le textarea d'edition prend le focus a l'entree en mode edition.
- **Barre d'outils Markdown** : presente au-dessus de chaque zone de saisie (nouvelle note, edition, note GC.com), avec le bouton du format sous le curseur allume (`aria-pressed`). Desactivee pendant une operation en cours (creation, envoi vers GC.com).
- **Apercu repliable** : « Apercu Markdown (texte final) » sous chaque zone de saisie, ferme par defaut ; son etat ouvert/ferme est conserve tant que la zone reste montee.
- **Couleurs themisees** : le badge de type utilise les variables de theme (`var(--theia-charts-green|lines|blue, <fallback>)`) en chip *outline* (texte + bordure colores), pour un contraste correct en theme clair comme sombre.
- **ARIA** : les boutons icone-seule (envoyer / editer / supprimer) portent un `aria-label` ; les `<i class="fa ...">` decoratives portent `aria-hidden="true"`.

## Points d'attention

- L'edition et le push sont reserves aux notes `source == 'user'` (cote backend ET cote UI). Les notes `system` / `earthcoach` sont en lecture seule dans le panneau.
- La note GC.com est **unique par cache** : pousser une note applicative ecrase ou complete cette note unique, d'ou la resolution de conflit.
- La lecture de la note GC.com repose sur du scraping HTML : prevoir une maintenance si GC.com change sa page.
- `gc_personal_note` cote GeoApp est un **cache** : il reflete le dernier import/push, pas forcement l'etat temps reel sur GC.com.

## References code

- Frontend
  - `frontend/theia-extensions/zones/src/browser/geocache-notes-widget.tsx`
  - `frontend/theia-extensions/zones/src/browser/geocache-notes-view.tsx`
  - `frontend/theia-extensions/zones/src/browser/geocache-notes-controller.ts`
  - `frontend/theia-extensions/zones/src/browser/geocache-notes-service.ts`
  - `frontend/theia-extensions/zones/src/browser/geocache-notes-types.ts`
  - `frontend/theia-extensions/zones/src/browser/geocache-notes-markdown-editor.tsx`
  - Markdown partage avec l'editeur de logs : `log-markdown.ts`, `log-markdown-renderer.tsx`, `log-editor/markdown-toolbar.tsx`, `log-editor/markdown-preview.tsx`, `log-editor/markdown-editor-helpers.ts`
- Backend
  - `backend/gc_backend/blueprints/notes.py`
  - `backend/gc_backend/services/geocaching_personal_notes.py`
  - `backend/gc_backend/geocaches/models.py` (`Note`, `GeocacheNote`, champs `gc_personal_note*`)
