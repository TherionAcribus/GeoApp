# Notes - Documentation technique

## Vue d'ensemble

Le systeme de Notes permet d'attacher du texte libre a une geocache. Il distingue **deux familles** de notes :

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
- Backend
  - `backend/gc_backend/blueprints/notes.py`
  - `backend/gc_backend/services/geocaching_personal_notes.py`
  - `backend/gc_backend/geocaches/models.py` (`Note`, `GeocacheNote`, champs `gc_personal_note*`)
