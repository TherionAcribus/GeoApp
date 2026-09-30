# Barres latérales Theia — stabilisation et personnalisation

> Spécification technique destinée au LLM qui implémentera les changements.
> État du dépôt audité : 30 septembre 2026, Eclipse Theia `1.76.0`.
>
> **Avancement** : lots 1 (P0), 2, 3 (P1) et 4 (P2) implémentés — registre `sidebar/geoapp-sidebar-views.ts`,
> défauts créés dans `initializeLayout` (`GeoAppSidebarDefaultsContribution`,
> migration Plugins isolée dans `GeoAppLegacyPluginsMigrationContribution`),
> auto-sauvegarde installée après `onDidInitializeLayout`, `hiddenDefaultWidgets.v1`
> supprimé, Cartes fermable avec commande `geoapp.mapManager.open`, forçage
> Formula Solver supprimé. Test : `geoapp-sidebar-views.test.ts`.
> Lot 2 : `GeoAppSidebarContribution` ne garde que l'icône Connexion via
> l'API publique `leftPanelHandler.addBottomMenu/removeBottomMenu` (rang 100)
> après `shell.initialized` ; icônes Préférences/Amis/Trackables/Documentation
> retirées ; Préférences + Connexion déplacées dans `CommonMenus.MANAGE_GENERAL`.
> Lot 3 : `sidebar/geoapp-sidebar-controller.ts` (états lus depuis le shell,
> show/hide/reset sérialisés, `requestSave` après chaque action),
> `geoapp-sidebar-customization-dialog.tsx` (`ReactDialog`, groupes
> gauche/droite/autre/masquées, reset confirmé par `ConfirmDialog`),
> `geoapp-sidebar-customization-contribution.ts` (`geoapp.sidebar.customize`
> dans `Affichage > Apparence`, `MANAGE_GENERAL`, `SHELL_TABBAR_CONTEXT_MENU`
> filtré aux panneaux latéraux ; `geoapp.sidebar.reset` en palette),
> fonctions pures `geoapp-sidebar-view-state.ts` testées par
> `geoapp-sidebar-controller.test.ts`, styles `style/geoapp-sidebar-customization.css`.
> Lot 4 : vue Cartes convertie en `MapManagerViewContribution`
> (`AbstractViewContribution`, `toggleCommandId: 'geoapp.mapManager.open'`
> conservé, menu `Vues` ordonné 0.7 réécrit sans `super.registerMenus`) ;
> doublons `VIEW_VIEWS` supprimés dans Alphabets, Calculatrice et
> PluginsBrowser (même pattern que Formula Solver) ; sauvegarde du layout sur
> `tabMoved` gauche+droite ; migration Plugins réécrite en
> `ShellLayoutTransformer` (`geoapp-plugins-layout-migration.ts`, renommage de
> `factoryId` avant inflation, testé). Zones non convertie : `zones:open`
> accepte des args (`zoneId`) et la recréation post-fermeture fonctionne —
> la conversion en `AbstractViewContribution` n'apporterait que le toggle.
> Reste : lot 5 (perspectives, optionnel) et la validation manuelle §9.
> Le document couvre le shell frontend uniquement. Il ne demande aucune modification backend.

## 1. Objectif

Rendre les barres latérales de GeoApp :

- déterministes au démarrage et après rechargement ;
- personnalisables par l'utilisateur sans modifier de fichier de configuration ;
- cohérentes avec les mécanismes natifs de Theia ;
- compactes, avec une distinction claire entre une **vue latérale** et un
  **raccourci de commande** ;
- récupérables par une commande « Restaurer les barres latérales par défaut » qui
  ne réinitialise pas tout le workbench.

Le résultat attendu n'est pas une copie complète de la personnalisation de VS Code.
Theia 1.76 ne propose pas encore de checklist native pour masquer/afficher tous les
onglets de l'Activity Bar. GeoApp doit fournir cette petite couche d'interface, tout
en laissant Theia gérer les widgets, le glisser-déposer et le layout.

## 2. Décisions d'architecture à respecter

1. **Le layout Theia est l'unique source de vérité pour les vues attachées, leur
   côté et leur ordre.** Ne pas maintenir une seconde liste permanente de widgets
   masqués.
2. Les vues par défaut sont ajoutées dans `initializeLayout`, appelé par Theia
   uniquement lorsqu'aucun layout valide n'a pu être restauré. Ne jamais les forcer
   dans `onStart` ou `onDidInitializeLayout`.
3. L'auto-sauvegarde ne commence qu'après `onDidInitializeLayout`. Aucune sauvegarde
   ne doit être possible pendant l'inflation/restauration du layout.
4. Une vue latérale est un vrai widget dans `area: 'left'` ou `area: 'right'`.
   L'utilisateur peut la fermer, la rouvrir et la déplacer.
5. Les actions qui ouvrent un écran central — Préférences, Amis, Trackables,
   Documentation — ne doivent pas occuper l'Activity Bar. Elles restent accessibles
   par les menus et par la barre d'outils dynamique de Theia.
6. Conserver au bas de la barre gauche au maximum :
   - le menu Réglages natif de Theia ;
   - l'état/commande de connexion Geocaching.com, car cette authentification n'est
     pas un `AuthenticationProvider` Theia.
7. Les vues techniques volontairement retirées du produit (`Explorer`, SCM,
   recherche de code, tests) restent hors périmètre. Ne pas supprimer la politique
   définie dans `theia-ide-contribution.tsx` et ne pas les proposer dans le nouveau
   sélecteur.
8. Les vues contextuelles dépendant d'une géocache ou d'une session — détails,
   logs, notes, widgets EarthCoach, éditeurs — restent ouvertes à la demande et ne
   figurent pas parmi les vues globales personnalisables.

## 3. État actuel vérifié

### 3.1 Version et fonctions disponibles

`frontend/applications/browser/package.json` fixe Theia à `1.76.0`, inclut
`@theia/toolbar` et active `toolbar.showToolbar`.

Theia sait déjà :

- fermer une vue dont `title.closable` vaut `true` ;
- rouvrir une vue enregistrée par une commande ;
- réordonner les onglets latéraux par glisser-déposer ;
- déplacer une vue entre les panneaux gauche et droit ;
- persister les panneaux, leur ordre et leur côté dans le layout ;
- envoyer les onglets qui ne tiennent plus verticalement dans le menu `…`
  (`Additional Views`) ;
- personnaliser la barre d'outils supérieure par clic droit : ajout, retrait et
  déplacement de commandes.

Theia ne sait pas encore afficher nativement une checklist globale de visibilité
des icônes de l'Activity Bar. La demande amont correspondante est :
<https://github.com/eclipse-theia/theia/issues/17124>.

### 3.2 Vues globales GeoApp à gérer

| Vue | Widget ID | Commande existante | Défaut après reset | Rang |
|---|---|---|---|---:|
| Zones | `zones.tree.widget` | `zones:open` | gauche, visible | 100 |
| Cartes | `geoapp-map-manager` | à créer, p. ex. `geoapp.mapManager.open` | gauche, visible | 200 |
| Recherche globale | `geoapp-global-search-widget` | `geoapp.globalSearch.open` | gauche, visible | 300 |
| Plugins | `mysterai-plugins-browser` | `plugins.openBrowser` | gauche, visible | 400 |
| Alphabets | `alphabets-list` | `alphabets.openList` | gauche, visible | 450 |
| Calculatrice | `geoapp.calculator` | `geoapp.calculator.open` | gauche, masquée | 480 |
| Formula Solver | `formula-solver:widget` | `formula-solver:open` ou `formula-solver:toggle` | droite, visible | 500 |

Ces valeurs préservent le comportement fonctionnel courant : la Calculatrice est
ouvrable mais n'est pas forcée dans le layout initial ; Formula Solver est actuellement
forcé à droite, il reste donc visible dans le **layout par défaut**, mais pourra enfin
être masqué ou déplacé durablement.

Ne pas ajouter à cette liste les widgets EarthCoach ou les widgets liés à une
géocache : ils ont besoin d'un contexte métier au moment de leur création.

### 3.3 Sources actuelles d'instabilité

#### A. Auto-sauvegarde active avant la restauration — P0

`layout-auto-save-contribution.ts:onStart` installe immédiatement des listeners sur
`onDidAddWidget` et `onDidRemoveWidget`. Or Theia exécute tous les `onStart` avant
`initializeLayout`. Sur un démarrage lent, le debounce de deux secondes peut donc
stocker un layout partiellement restauré et remplacer le layout complet.

#### B. Vues par défaut forcées après la restauration — P0

`geoapp-default-left-panel-contribution.ts:onDidInitializeLayout` ajoute cinq vues
absentes après que Theia a restauré le layout. Le fichier doit alors maintenir
`geoapp.leftPanel.hiddenDefaultWidgets.v1` pour distinguer une vraie disparition
d'un choix utilisateur. Cette seconde source de vérité est inutile si les défauts
sont créés au bon hook.

La vue Cartes est en plus déclarée `title.closable = false`, donc impossible à masquer.

#### C. Formula Solver contourne le layout — P0

`formula-solver-contribution.ts:onStart` attend deux secondes puis :

- déplace le widget à droite s'il est à gauche ;
- le crée et l'attache à droite s'il n'existe pas ;
- l'active systématiquement.

Ce code annule un déplacement ou une fermeture décidés par l'utilisateur.

#### D. Trop de raccourcis au bas de la barre — P1

`geoapp-sidebar-contribution.ts` ajoute Préférences, Amis, Trackables et Connexion.
`doc-contribution.ts` ajoute Documentation. Theia ajoute déjà Réglages et parfois
Comptes. Ces éléments ont `flex-shrink: 0`, réduisent la place des vraies vues et
font basculer certaines icônes dans `Additional Views`.

Plusieurs éléments partagent les rangs `0`, `1` ou `2`. L'icône d'authentification
est retirée puis recréée lorsqu'elle change d'état, ce qui rend l'ordre apparent
variable.

#### E. Initialisation des raccourcis par polling — P1

GeoApp et Documentation attendent l'état `ready`, cherchent `bottomMenu` via un cast
`any`, puis réessaient jusqu'à vingt fois avec `setTimeout`. Le code Theia lui-même
utilise `app.shell.initialized.then(...)` et l'API publique
`leftPanelHandler.addBottomMenu(...)`.

#### F. Menus et contributions hétérogènes — P2

Recherche, Plugins, Alphabets et Calculatrice utilisent `AbstractViewContribution`.
Zones et Cartes utilisent des commandes manuelles. Cartes ne possède pas de commande
de réouverture. Plusieurs contributions réenregistrent aussi dans `View > Views` une
action que `AbstractViewContribution.registerMenus` enregistre déjà.

## 4. Expérience utilisateur cible

### 4.1 Activity Bar

- Au premier démarrage ou après « Restaurer les barres latérales par défaut », les
  cinq vues gauche et Formula Solver à droite correspondent au tableau de la section
  3.2.
- Un clic sélectionne/ouvre la vue selon le comportement natif Theia.
- Un clic droit conserve les commandes natives, dont « Fermer », et ajoute
  **Personnaliser les barres latérales…**.
- Le glisser-déposer natif permet de changer l'ordre et le côté. Le nouvel ordre est
  retrouvé après rechargement.
- Le menu `…` reste le comportement normal de débordement. Une icône présente dans ce
  menu n'est pas considérée comme perdue.

### 4.2 Sélecteur « Personnaliser les barres latérales »

Créer un `ReactDialog` compact contenant :

- un titre et une phrase expliquant que les vues visibles peuvent ensuite être
  déplacées par glisser-déposer ;
- deux groupes « Barre gauche » et « Barre droite », calculés depuis le layout courant ;
- les vues masquées dans un troisième groupe « Masquées » ;
- une case à cocher par vue ;
- le nom et l'icône de la vue ;
- un bouton **Restaurer les valeurs par défaut** avec confirmation ;
- un bouton **Fermer**.

Les cases s'appliquent immédiatement :

- cocher crée/attache puis révèle la vue ;
- décocher ferme la vue et retire son icône ;
- une erreur de création rétablit la case et affiche un message explicite ;
- fermer la boîte ne réinitialise pas les changements déjà appliqués.

Ne pas inventer une seconde interface de réorganisation dans le premier lot : le
glisser-déposer Theia remplit déjà cette fonction. La boîte doit seulement refléter
le côté courant après réouverture.

### 4.3 Points d'entrée

Enregistrer la commande `geoapp.sidebar.customize` dans :

- `Affichage > Apparence` ;
- le menu contextuel `SHELL_TABBAR_CONTEXT_MENU`, visible uniquement lorsqu'il
  concerne un onglet latéral gauche ou droit ;
- le menu Réglages natif (`CommonMenus.MANAGE_GENERAL` ou sous-menu équivalent).

Enregistrer `geoapp.sidebar.reset` dans le dialogue et dans la palette de commandes,
mais ne pas l'ajouter comme icône permanente.

### 4.4 Raccourcis retirés du bas

- **Préférences GeoApp** : menu Réglages natif et raccourci clavier existant.
- **Connexion Geocaching.com** : conserver l'icône inférieure avec son état connecté /
  déconnecté, plus une entrée dans le menu Réglages.
- **Amis** et **Trackables** : conserver `Affichage > Vues` et les commandes existantes.
- **Documentation** : conserver le menu Aide et `Shift+F1`.
- Toutes ces commandes restent ajoutables par l'utilisateur dans la barre d'outils
  dynamique Theia.

## 5. Architecture cible

### 5.1 Registre statique des vues gérées

Créer dans l'extension Zones, par exemple :

`frontend/theia-extensions/zones/src/browser/sidebar/geoapp-sidebar-views.ts`

```ts
export type GeoAppSidebarArea = 'left' | 'right';

export interface GeoAppSidebarViewDescriptor {
    readonly id: string;
    readonly label: string;
    readonly iconClass: string;
    readonly openCommandId: string;
    readonly defaultArea: GeoAppSidebarArea;
    readonly defaultRank: number;
    readonly defaultVisible: boolean;
}

export const GEOAPP_SIDEBAR_VIEWS: readonly GeoAppSidebarViewDescriptor[] = [
    // valeurs exactes du tableau 3.2
];
```

Les IDs externes peuvent rester des littéraux centralisés, comme dans le code actuel,
afin de ne pas créer de dépendances circulaires entre Zones, Plugins, Alphabets,
Recherche et Calculatrice. Ajouter un test qui vérifie l'unicité des IDs, commandes et
rangs.

### 5.2 Contrôleur

Créer :

`frontend/theia-extensions/zones/src/browser/sidebar/geoapp-sidebar-controller.ts`

Responsabilités :

- `getViewStates()` : retourne visibilité, zone courante et index courant ;
- `showView(descriptor)` : exécute de préférence la commande d'ouverture existante,
  puis utilise `WidgetManager` en fallback ;
- `hideView(descriptor)` : ferme le widget avec l'API `ApplicationShell` ;
- `resetToDefaults()` : ne touche qu'aux IDs du registre, ferme les vues dont
  `defaultVisible=false`, attache les autres dans leur zone/rang par défaut ;
- déclenche une demande de sauvegarde après une opération utilisateur aboutie ;
- sérialise les opérations afin d'empêcher un double clic de lancer deux créations ;
- publie un événement de changement pour mettre à jour le dialogue.

Le contrôleur ne doit pas écrire une liste `hiddenWidgets`. La visibilité est
`Boolean(widget?.isAttached)`, la zone vient de `shell.getAreaFor(widget)` et l'ordre
vient des widgets retournés par `shell.getWidgets(area)` ou des titres du SideTabBar.

Attention : le `toggleView()` natif d'`AbstractViewContribution` replie le panneau
quand la vue latérale active est déjà affichée ; il ne garantit pas le détachement de
son icône. Pour **masquer une icône**, le contrôleur doit donc fermer explicitement le
widget. La commande d'ouverture ne doit être utilisée que pour une vue absente.

### 5.3 Layout initial

Remplacer le rôle de `GeoAppDefaultLeftPanelContribution` par une contribution qui
implémente `initializeLayout(app)` :

```ts
async initializeLayout(app: FrontendApplication): Promise<void> {
    for (const item of GEOAPP_SIDEBAR_VIEWS.filter(item => item.defaultVisible)) {
        const widget = await this.widgetManager.getOrCreateWidget(item.id);
        if (!widget.isAttached) {
            await app.shell.addWidget(widget, {
                area: item.defaultArea,
                rank: item.defaultRank
            });
        }
    }
}
```

Points impératifs :

- ne rien ajouter dans `onDidInitializeLayout` ;
- supprimer la lecture/écriture de
  `geoapp.leftPanel.hiddenDefaultWidgets.v1` ;
- ne pas activer successivement les vues pendant la création du layout ;
- attraper une erreur par vue pour ne pas empêcher les autres valeurs par défaut ;
- utiliser le même registre pour le dialogue et le reset.

Conserver temporairement la migration de l'ancien widget Plugins dans une classe
séparée si elle est encore nécessaire, mais ne pas la mélanger à la visibilité. Une
migration d'ID doit idéalement utiliser `ApplicationShellLayoutMigration` avant
l'inflation du layout.

### 5.4 Auto-sauvegarde

Modifier `LayoutAutoSaveContribution` :

- installer les listeners dans `onDidInitializeLayout(app)`, pas dans `onStart` ;
- garder une garde `layoutInitialized` dans `scheduleSave` ;
- écouter `onDidAddWidget` et `onDidRemoveWidget` ;
- écouter aussi `tabMoved` sur les SideTabBar gauche et droit afin qu'un simple
  réordonnancement soit sauvegardé sans attendre la fermeture de la fenêtre ;
- conserver un debounce raisonnable, entre 500 ms et 2 s ;
- exposer une méthode ou un petit service `requestSave()` utilisée par le contrôleur ;
- annuler le timer dans `onStop` et effectuer un dernier stockage si nécessaire ;
- ne pas dupliquer le format de sérialisation : continuer à appeler
  `ShellLayoutRestorer.storeLayout(app)`.

Ne pas sauvegarder à chaque changement de vue active : cela créerait des écritures
inutiles et n'est pas nécessaire pour la visibilité ou l'ordre.

### 5.5 Contributions de vues

#### Cartes

- passer `MapManagerWidget.title.closable` à `true` ;
- créer une commande d'ouverture stable ;
- idéalement ajouter une `AbstractViewContribution<MapManagerWidget>` avec
  `defaultWidgetOptions: { area: 'left', rank: 200 }` ;
- enregistrer une seule entrée `Affichage > Vues`.

#### Zones

La commande existante peut être conservée si elle recrée correctement un widget
fermé. Une conversion vers `AbstractViewContribution<ZonesTreeWidget>` est souhaitable
pour homogénéiser les vues, mais ne doit pas casser les autres commandes Zones.

#### Formula Solver

Supprimer entièrement `onStart`, le `setTimeout` et `migrateToRightPanel`.

- La zone droite est seulement la valeur par défaut du registre.
- Une vue restaurée à gauche doit rester à gauche.
- Une vue absente du layout doit rester absente.
- Les commandes `formula-solver:open`, `formula-solver:toggle` et
  `formula-solver:solve-from-geocache` continuent de fonctionner.

Vérifier au passage que `registerCommands` conserve le comportement fourni par la
classe de base ou enregistre explicitement toutes les commandes requises. Ne pas
introduire deux handlers pour la même commande.

#### Recherche, Plugins, Alphabets et Calculatrice

Conserver leurs `AbstractViewContribution`. Supprimer seulement les enregistrements
manuels en double dans `CommonMenus.VIEW_VIEWS` lorsqu'ils utilisent le même
`commandId` que la classe de base. Conserver les commandes secondaires propres à
chaque extension.

### 5.6 Menu inférieur

Simplifier `GeoAppSidebarContribution` :

- supprimer les menus inférieurs Préférences, Amis et Trackables ;
- conserver uniquement le menu Connexion Geocaching.com ;
- l'ajouter avec
  `app.shell.initialized.then(() => app.shell.leftPanelHandler.addBottomMenu(...))` ;
- utiliser directement `leftPanelHandler.addBottomMenu` et
  `leftPanelHandler.removeBottomMenu`, sans cast `any` ;
- utiliser un rang distinct des rangs Theia, par exemple `100` ;
- supprimer `FrontendApplicationStateService`, `scheduleSidebarSetup`,
  `trySetupSidebar` et les retries associés ;
- conserver le polling d'authentification seulement si aucun événement backend plus
  fiable n'existe ; il est indépendant de l'installation du menu.

Dans `DocContribution` :

- supprimer `SidebarBottomMenuWidget`, `FrontendApplicationStateService` et toute
  l'installation de `geoapp-doc-sidebar-menu` ;
- conserver les commandes, le menu Aide, `Shift+F1` et l'intégration `@Aide`.

Dans `ZonesMenuContribution` :

- conserver Amis et Trackables dans `Affichage > Vues` ;
- ajouter Connexion et Préférences GeoApp dans le menu Réglages natif ;
- éviter les doublons de commandes dans plusieurs sous-menus sans bénéfice UX.

### 5.7 Dialogue et styles

Fichiers proposés :

- `sidebar/geoapp-sidebar-customization-dialog.tsx` ;
- `style/geoapp-sidebar-customization.css` ;
- `sidebar/geoapp-sidebar-customization-contribution.ts`.

Utiliser `ReactDialog` de Theia, les variables de thème `--theia-*` et les composants
visuels existants. Contraintes :

- largeur utile d'environ 420 à 520 px ;
- navigation clavier complète ;
- checkbox associée à un vrai `<label>` ;
- focus visible ;
- pas de couleur codée en dur indispensable à la compréhension ;
- liste utilisable à 200 % de zoom et sur une hauteur de 600 px ;
- aucune dépendance React supplémentaire.

Le rendu doit être piloté par le contrôleur. Ne pas manipuler directement le DOM de
l'Activity Bar.

## 6. Plan d'implémentation

### Lot 1 — P0 — Empêcher la corruption et les forçages du layout

Fichiers principaux :

- `zones/src/browser/layout-auto-save-contribution.ts` ;
- `zones/src/browser/geoapp-default-left-panel-contribution.ts` ;
- `formula-solver/src/browser/formula-solver-contribution.ts` ;
- `zones/src/browser/map/map-manager-widget.tsx`.

Travail :

1. déplacer l'installation de l'auto-sauvegarde après l'initialisation du layout ;
2. créer le registre des vues ;
3. créer les valeurs par défaut uniquement dans `initializeLayout` ;
4. supprimer `hiddenDefaultWidgets.v1` de la logique active ;
5. rendre Cartes fermable ;
6. supprimer le forçage Formula Solver.

Critères d'acceptation :

- aucun appel à `storeLayout` avant `onDidInitializeLayout` ;
- fermer Plugins, Formula Solver ou Cartes puis recharger ne les fait pas réapparaître ;
- déplacer Formula Solver à gauche puis recharger le laisse à gauche ;
- un premier démarrage sans layout affiche exactement les défauts de la section 3.2 ;
- un démarrage lent ne remplace jamais le layout par une version partielle.

### Lot 2 — P1 — Désencombrer et fiabiliser le menu inférieur

Fichiers principaux :

- `zones/src/browser/geoapp-sidebar-contribution.ts` ;
- `zones/src/browser/zones-menu-contribution.ts` ;
- `documentation/src/browser/doc-contribution.ts`.

Travail :

1. retirer Préférences, Amis, Trackables et Documentation du bas ;
2. conserver Connexion avec un rang unique ;
3. utiliser `shell.initialized` et les API publiques ;
4. conserver tous les points d'entrée par menus, commandes et raccourcis ;
5. documenter dans l'aide que ces commandes peuvent être ajoutées à la barre d'outils.

Critères d'acceptation :

- aucune boucle de retry n'est nécessaire pour installer le menu inférieur ;
- la barre inférieure gauche contient Réglages Theia, éventuellement Comptes Theia,
  puis Connexion GeoApp, sans doublon Préférences ;
- Amis, Trackables et Documentation restent ouvrables ;
- un changement d'état d'authentification ne change pas l'ordre des autres éléments ;
- à 600 px de haut, les vues en débordement sont accessibles par `…` et aucune
  commande n'est perdue.

### Lot 3 — P1 — Interface de personnalisation

Fichiers principaux : nouveaux fichiers `sidebar/*`, module frontend Zones et styles.

Travail :

1. créer le contrôleur ;
2. créer le `ReactDialog` ;
3. enregistrer les commandes et menus ;
4. implémenter le reset limité aux vues gérées ;
5. demander explicitement une sauvegarde après chaque changement réussi.

Critères d'acceptation :

- toutes les vues du registre apparaissent dans le dialogue ;
- l'état des cases correspond toujours à `widget.isAttached` ;
- afficher/masquer est immédiat et persiste après deux rechargements ;
- une vue déplacée à droite apparaît dans le groupe droit à la réouverture du dialogue ;
- le reset ne ferme aucun éditeur central, carte inférieure, terminal ou vue non gérée ;
- une erreur de création ne laisse pas une case dans un état mensonger.

### Lot 4 — P2 — Homogénéisation et tests de non-régression

Travail :

1. convertir Cartes, puis éventuellement Zones, vers `AbstractViewContribution` ;
2. supprimer les entrées `View > Views` en double ;
3. ajouter la sauvegarde explicite des événements `tabMoved` ;
4. isoler ou retirer la migration de l'ancien widget Plugins ;
5. compléter la documentation utilisateur et technique.

Critères d'acceptation :

- une seule action par vue dans `Affichage > Vues` ;
- toutes les commandes d'ouverture fonctionnent après fermeture/disposition ;
- aucun `setTimeout` de migration de panneau ne subsiste ;
- aucun accès `(shell as any).leftPanelHandler` ou `.bottomMenu` ne subsiste dans les
  contributions GeoApp concernées.

### Lot 5 — P3 optionnel — Perspectives

Seulement après stabilisation, évaluer trois perspectives :

- **Minimal** : Zones + Cartes ;
- **Géocaching** : Zones + Cartes + Recherche + Amis accessible dans la toolbar ;
- **Résolution** : Plugins + Alphabets + Formula Solver + Chat IA.

Les Perspectives sont expérimentales dans Theia 1.76. Ne pas en faire la seule voie
de personnalisation et ne pas bloquer les lots précédents sur cette API.

## 7. Migration et compatibilité

### Utilisateurs existants

- Au premier démarrage de la nouvelle version, laisser Theia restaurer le layout
  existant sans rajouter de vue absente.
- Ne pas effacer la clé `layout` ni appeler le reset global.
- Ne plus lire `geoapp.leftPanel.hiddenDefaultWidgets.v1`. La clé peut rester inerte
  une version ; sa suppression n'est pas nécessaire au fonctionnement.
- Formula Solver déjà présent reste présent à l'endroit enregistré. Il ne sera plus
  recréé après une fermeture ultérieure.
- Le retrait des raccourcis inférieurs est intentionnel, mais leurs commandes et
  raccourcis clavier doivent être conservés.

### Premier démarrage / layout invalide

`initializeLayout` installe les valeurs par défaut. Si une factory de widget manque,
journaliser une erreur préfixée `[GeoAppSidebar]` et continuer les autres vues.

### Reset

Le reset GeoApp ne doit pas appeler la commande Theia `reset.layout`, car celle-ci
réinitialise tout le workbench et le thème. Il agit seulement sur les IDs du registre.

## 8. Tests à ajouter

Créer des tests unitaires sans DOM lourd en séparant les fonctions pures et en
injectant des fakes du shell/widget manager lorsque nécessaire.

Fichiers suggérés :

- `zones/src/browser/tests/geoapp-sidebar-views.test.ts` ;
- `zones/src/browser/tests/geoapp-sidebar-controller.test.ts` ;
- `zones/src/browser/tests/layout-auto-save-contribution.test.ts`.

Cas minimum :

1. IDs, commandes et rangs du registre uniques.
2. Liste exacte des vues visibles par défaut.
3. `initializeLayout` ajoute les défauts dans le bon côté et le bon ordre.
4. Une restauration existante n'appelle pas l'initialisation par défaut.
5. Aucun événement add/remove reçu avant l'initialisation ne sauvegarde le layout.
6. Plusieurs événements rapprochés produisent une seule sauvegarde.
7. Masquer ferme uniquement l'ID demandé.
8. Afficher utilise la commande puis révèle la vue.
9. Reset ferme la Calculatrice si elle est visible, restaure les six vues par défaut
   et ne touche pas à un widget étranger.
10. Une erreur de création est remontée et l'état visible reste faux.

Ajouter les nouveaux tests à `test:geoapp` du package Zones.

## 9. Validation manuelle obligatoire

Effectuer au minimum cette matrice dans l'application navigateur :

| Scénario | Résultat attendu |
|---|---|
| Premier démarrage avec stockage local vierge | valeurs par défaut exactes |
| Fermer Plugins, recharger deux fois | Plugins reste absent |
| Rouvrir Plugins depuis le dialogue | icône présente et vue activable |
| Fermer Cartes, recharger | Cartes reste absente |
| Déplacer Formula Solver à gauche, recharger | reste à gauche |
| Réordonner trois icônes, recharger | ordre conservé |
| Réduire la hauteur à 600 px | surplus présent dans `…` |
| Basculer connecté/déconnecté | icône Connexion mise à jour sans permutation |
| Reset GeoApp avec des éditeurs ouverts | éditeurs intacts, seules les vues gérées changent |
| Démarrage avec CPU fortement ralenti | aucun layout partiel enregistré |
| Backend arrêté | la personnalisation du shell continue de fonctionner |

Dans les DevTools, vérifier l'absence des warnings d'abandon
`Menu bas de sidebar introuvable après 20 tentatives` et l'absence d'exceptions de
création de widget.

## 10. Commandes de validation

Depuis `frontend/` :

```powershell
yarn workspace theia-ide-zones-ext build
yarn workspace @mysterai/theia-formula-solver build
yarn workspace theia-ide-documentation-ext build
yarn workspace theia-ide-product-ext build
yarn workspace theia-ide-zones-ext test:geoapp
yarn workspace theia-ide-documentation-ext test:documentation
yarn build:extensions
```

Si PowerShell bloque `yarn.ps1`, utiliser `yarn.cmd` avec les mêmes arguments.

À la racine :

```powershell
git diff --check
git status --short
```

Ne pas lancer de formatage global et ne pas modifier les fichiers sans rapport avec
le shell.

## 11. Fichiers à lire avant de coder

Ordre recommandé :

1. `frontend/node_modules/@theia/core/src/browser/frontend-application.ts` — ordre
   des hooks de démarrage ;
2. `frontend/node_modules/@theia/core/src/browser/shell/side-panel-handler.ts` —
   layout, menus, overflow et déplacement ;
3. `frontend/node_modules/@theia/core/src/browser/shell/view-contribution.ts` —
   comportement d'`AbstractViewContribution` ;
4. `frontend/node_modules/@theia/core/src/browser/shell/shell-layout-restorer.ts` —
   stockage/restauration ;
5. les cinq fichiers GeoApp cités en section 3.3 ;
6. les contributions Recherche, Plugins, Alphabets, Calculatrice et Formula Solver.

Ne pas patcher `node_modules`. Ces sources servent uniquement à vérifier le contrat
de Theia 1.76.

## 12. Définition de terminé

Le chantier est terminé uniquement si :

- tous les critères des lots 1 à 4 sont satisfaits ;
- les builds ciblés et les tests passent ;
- `git diff --check` passe ;
- les tests manuels couvrent démarrage vierge, layout existant, fermeture,
  réouverture, déplacement, ordre, débordement et reset ;
- aucune vue n'est recréée hors `initializeLayout` ou action explicite de l'utilisateur ;
- la documentation explique où retrouver une vue masquée et comment ajouter une
  commande GeoApp à la toolbar ;
- le compte-rendu final distingue les validations automatisées des vérifications
  manuelles réellement effectuées.

## 13. Consignes de livraison pour le LLM

- Implémenter lot par lot et garder le dépôt compilable entre les lots.
- Préserver les modifications utilisateur déjà présentes dans le worktree.
- Ne pas modifier le backend.
- Ne pas réactiver Explorer/SCM/Tests/recherche de code.
- Ne pas introduire une nouvelle bibliothèque UI ou de persistance.
- Ne pas présenter comme « testé » un scénario seulement raisonné depuis le code.
- En cas d'écart nécessaire à cette spec, documenter précisément l'écart, sa raison
  et son impact dans le compte-rendu final.
