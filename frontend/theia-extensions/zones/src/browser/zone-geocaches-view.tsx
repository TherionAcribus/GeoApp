import * as React from 'react';
import type { SortingState } from '@tanstack/react-table';
import { GeocachesTable, Geocache, GeocachesTableColumnId } from './geocaches-table';
import type { DistanceOrigin } from './geocache-distance-origin-store';
import { OutingPlanCacheFlags } from './outing-plan-types';
import type { FriendAnalysisSummary } from './friend-outing-state';
import { ImportGpxDialog } from './import-gpx-dialog';
import { ImportBookmarkListDialog } from './import-bookmark-list-dialog';
import { ImportPocketQueryDialog } from './import-pocket-query-dialog';
import { MoveGeocacheDialog } from './move-geocache-dialog';
import { ImportAroundDialog, ImportAroundCenter, ImportAroundRequest } from './import-around-dialog';
import { ImportProgressCallback } from './import-dialog-shell';
import { EmptyState, LoadingState } from './state-views';
import { FriendOutingSidePanel } from './friend-outing-side-panel';
import type { FriendFilter, FriendOuting } from './friend-outing-state';
import type { FriendFindsProgress, FriendZoneScanEntry, GeocachingFriend } from './friends-types';

type SelectionDialogState = { geocacheIds: number[] } | null;

export interface ZoneGeocachesViewProps {
    titleLabel: string;
    zoneId?: number;
    rows: Geocache[];
    zones: Array<{ id: number; name: string }>;
    currentZoneId?: number;
    tableVisibleColumnIds: GeocachesTableColumnId[];
    loading: boolean;
    isImporting: boolean;
    /** Vrai pendant l'import d'une géocache par code GC : le bouton « Importer » passe en attente. */
    isAddingGeocache: boolean;
    showImportDialog: boolean;
    showBookmarkListDialog: boolean;
    showPocketQueryDialog: boolean;
    copySelectedDialog: SelectionDialogState;
    moveSelectedDialog: SelectionDialogState;
    onSubmitAddGeocache: (event: React.FormEvent<HTMLFormElement>) => void | Promise<void>;
    onOpenImportDialog: () => void;
    onOpenBookmarkListDialog: () => void;
    onOpenPocketQueryDialog: () => void;
    onStartImportAround: () => void;
    onRowClick: (geocache: Geocache) => void | Promise<void>;
    onDeleteSelected: (ids: number[]) => void | Promise<void>;
    onRefreshSelected: (ids: number[]) => void | Promise<void>;
    onLogSelected: (ids: number[]) => void;
    onCopySelected: (ids: number[]) => void | Promise<void>;
    onMoveSelected: (ids: number[]) => void | Promise<void>;
    onApplyPluginSelected: (ids: number[]) => void | Promise<void>;
    onAnalyzeWithAiSelected: (ids: number[]) => void | Promise<void>;
    /** Une analyse IA est en cours : le bouton de la barre d'actions passe en attente. */
    analyzingWithAi?: boolean;
    /** Hors mode sortie : la sélection du tableau ouvre une sortie. */
    onStartOutingWithSelection?: (ids: number[]) => void;
    /** En mode sortie : la sélection du tableau s'ajoute au périmètre. */
    onAddSelectionToOuting?: (ids: number[]) => void;
    onExportGpxSelected: (ids: number[]) => void | Promise<void>;
    /** Un export GPX est en cours : le bouton de la barre d'actions passe en attente. */
    exportingGpx?: boolean;
    onDelete: (geocache: Geocache) => void | Promise<void>;
    /** Lignes en attente de suppression (fenêtre d'undo) : affichées estompées. */
    pendingDeleteIds?: ReadonlySet<number>;
    onRefresh: (id: number) => void | Promise<void>;
    onMove: (geocache: Geocache, targetZoneId: number) => void | Promise<void>;
    onCopy: (geocache: Geocache, targetZoneId: number) => void | Promise<void>;
    onImportAround: (geocache: Geocache) => void | Promise<void>;
    onTableVisibleColumnIdsChange: (columnIds: GeocachesTableColumnId[]) => void;
    /** Tri du tableau, persisté par zone dans le widget. */
    tableSorting: SortingState;
    onTableSortingChange: (sorting: SortingState) => void;
    /** Origine des distances (colonne « Distance », filtre `@distance:`), persistée par zone. */
    distanceOrigin?: DistanceOrigin | null;
    /** La géocache devient l'origine des distances. */
    onSetDistanceOrigin?: (geocache: Geocache) => void;
    /** Retire l'origine des distances. */
    onClearDistanceOrigin?: () => void;
    onFilteredDataChange?: (geocaches: Geocache[]) => void;
    onSelectionChange?: (geocacheIds: number[]) => void;
    selectedGeocacheIds?: number[];
    /** Requête de filtre poussée par l'IA (§26) : chaque `seq` applique `value`. */
    appliedSearchQuery?: { value: string; seq: number };
    onImportGpx: (file: File, updateExisting: boolean, onProgress?: ImportProgressCallback) => Promise<void>;
    onImportBookmarkList: (bookmarkCode: string, updateExisting: boolean, onProgress?: ImportProgressCallback) => Promise<void>;
    onImportPocketQuery: (pqCode: string, updateExisting: boolean, onProgress?: ImportProgressCallback) => Promise<void>;
    onCancelImportDialog: () => void;
    onCancelBookmarkListDialog: () => void;
    onCancelPocketQueryDialog: () => void;
    onCancelImport: () => void;
    onConfirmCopySelected: (targetZoneId: number) => void | Promise<void>;
    onCancelCopySelected: () => void;
    onConfirmMoveSelected: (targetZoneId: number) => void | Promise<void>;
    onCancelMoveSelected: () => void;
    /** « Qui a trouvé quoi » : code GC -> pseudos d'amis. */
    friendFinds?: Record<string, string[]>;
    /** Signaux de la dernière analyse IA de sortie, par code GC (colonne « Sortie »). */
    outingFlags?: Record<string, OutingPlanCacheFlags>;
    /** Progression de l'analyse des amis (null = inactive). */
    friendFindsProgress?: FriendFindsProgress | null;
    /** Résumé persistant de la dernière analyse terminée. */
    lastAnalysisSummary?: FriendAnalysisSummary | null;
    /** Interrompt l'analyse streaming en cours. */
    onCancelAnalyzeFriendFinds?: () => void;
    /** État des scans par ami (pour le panneau de sortie et la table). */
    friendScans?: FriendZoneScanEntry[];
    /**
     * La sortie en cours, ou `null` hors mode sortie. Source unique du mode :
     * le panneau latéral, le bandeau de restauration et le code couleur du
     * tableau ne s'affichent que si elle existe.
     */
    outing?: FriendOuting | null;
    /**
     * Ouvre une sortie sur la sélection courante. Entrée et sortie du mode sont
     * deux actions distinctes (`onExitOutingMode` pour l'autre sens) : une seule
     * bascule booléenne laissait deux chemins vers la même fermeture.
     */
    onEnterOutingMode?: () => void;
    /** Vrai quand la sortie affichée vient d'être restaurée depuis le stockage. */
    outingRestored?: boolean;
    /** Ferme le bandeau de restauration. */
    onDismissOutingRestored?: () => void;
    /** Liste d'amis du compte (avatars et pseudos du panneau). */
    accountFriends?: GeocachingFriend[];
    /** Vrai pendant le chargement de la liste d'amis. */
    friendsListLoading?: boolean;
    /** Erreur du chargement de la liste d'amis (null si tout va bien). */
    friendsListError?: string | null;
    /** Relance le chargement de la liste d'amis. */
    onReloadFriends?: () => void;
    /**
     * Amis de la sortie, en Set : le tableau mémoïse sur son identité, une
     * dérivation à chaque rendu invaliderait le calcul des couleurs de lignes.
     */
    activeFriends?: Set<string>;
    /** Coche / décoche un ami de la sortie. */
    onToggleActiveFriend?: (friend: string) => void;
    /** Remplace la liste des amis de la sortie (« Tout » / « Rien »). */
    onSetActiveFriends?: (friends: string[]) => void;
    /** Lance l'analyse sur les amis cochés × le périmètre de la sortie. */
    onAnalyzeActiveFriends?: () => void | Promise<void>;
    /** Le périmètre de la sortie devient la sélection courante du tableau. */
    onReplaceOutingCaches?: () => void;
    /** La sélection courante s'ajoute au périmètre. */
    onAddSelectionToOutingCaches?: () => void;
    /** La sélection courante sort du périmètre. */
    onRemoveSelectionFromOutingCaches?: () => void;
    /** Le périmètre redevient « toute la zone ». */
    onResetOutingCachesToZone?: () => void;
    /** Filtre de table du mode sortie. */
    friendFilter?: FriendFilter;
    /** Change le filtre de table. */
    onFriendFilterChange?: (filter: FriendFilter) => void;
    /** Termine la sortie. */
    onExitOutingMode?: () => void;
    showImportAroundDialog: boolean;
    importAroundDialogInitialCenter?: ImportAroundCenter;
    onImportAroundDialogImport: (request: ImportAroundRequest, onProgress?: (percentage: number, message: string) => void) => Promise<void>;
    onCancelImportAroundDialog: () => void;
}

export const ZoneGeocachesView: React.FC<ZoneGeocachesViewProps> = props => {
    // Le mode et le filtre se déduisent de la sortie : aucun second champ ne peut
    // diverger d'elle.
    const outing = props.outing ?? null;
    const outingMode = outing !== null;

    // Menu « Importer ▾ » : un seul bouton dans l'en-tête, les quatre sources
    // d'import dans un menu (clic extérieur / Échap pour fermer).
    const [importMenuOpen, setImportMenuOpen] = React.useState(false);
    const importMenuContainerRef = React.useRef<HTMLDivElement | null>(null);
    React.useEffect(() => {
        if (!importMenuOpen) {
            return;
        }
        const onPointerDown = (event: MouseEvent) => {
            const container = importMenuContainerRef.current;
            if (container && !container.contains(event.target as Node)) {
                setImportMenuOpen(false);
            }
        };
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setImportMenuOpen(false);
            }
        };
        document.addEventListener('mousedown', onPointerDown);
        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('mousedown', onPointerDown);
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [importMenuOpen]);

    const importMenuItems: Array<{ iconClass: string; label: string; title: string; action: () => void }> = [
        { iconClass: 'codicon codicon-file', label: 'Fichier GPX', title: 'Importer des géocaches depuis un fichier GPX', action: props.onOpenImportDialog },
        { iconClass: 'codicon codicon-bookmark', label: 'Bookmark List', title: 'Importer depuis une Bookmark List Geocaching.com', action: props.onOpenBookmarkListDialog },
        { iconClass: 'codicon codicon-search', label: 'Pocket Query', title: 'Importer depuis une Pocket Query Geocaching.com (PQ)', action: props.onOpenPocketQueryDialog },
        { iconClass: 'codicon codicon-location', label: "Autour d'un point ou d'une cache…", title: "Rechercher et importer des géocaches autour d'un point ou d'une cache", action: props.onStartImportAround },
    ];
    // Le bandeau de mode tient sur une ligne : au-delà de trois amis, on compte.
    const outingFriendsLabel = outing && outing.friends.length > 0
        ? (outing.friends.length > 3
            ? `${outing.friends.slice(0, 3).join(', ')} +${outing.friends.length - 3}`
            : outing.friends.join(', '))
        : null;

    return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
            <h3 style={{ margin: 0 }}>{props.titleLabel}</h3>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <form onSubmit={props.onSubmitAddGeocache} style={{ display: 'flex' }}>
                    <div style={{
                        display: 'flex',
                        alignItems: 'stretch',
                        border: '1px solid var(--theia-input-border)',
                        borderRadius: 3,
                        overflow: 'hidden',
                    }}>
                        <input
                            name='gc_code'
                            placeholder='Code GC (ex: GC12345)'
                            title="Entrez un code GC pour l'importer dans cette zone"
                            disabled={props.isAddingGeocache}
                            style={{
                                width: 180,
                                padding: '4px 8px',
                                border: 'none',
                                outline: 'none',
                                background: 'var(--theia-input-background)',
                                color: 'var(--theia-input-foreground)',
                            }}
                        />
                        <button
                            type='submit'
                            className='theia-button'
                            disabled={props.isAddingGeocache}
                            aria-busy={props.isAddingGeocache}
                            title={props.isAddingGeocache ? 'Import en cours…' : 'Importer cette géocache dans la zone'}
                            style={{
                                borderRadius: 0,
                                margin: 0,
                                border: 'none',
                                borderLeft: '1px solid var(--theia-input-border)',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 6,
                            }}
                        >
                            {props.isAddingGeocache && (
                                <span className='geoapp-gc-action-btn__spinner' aria-hidden='true' />
                            )}
                            {props.isAddingGeocache ? 'Import en cours…' : 'Importer'}
                        </button>
                    </div>
                </form>
                <div ref={importMenuContainerRef} style={{ position: 'relative' }}>
                    <button
                        className='theia-button secondary'
                        onClick={() => setImportMenuOpen(open => !open)}
                        aria-expanded={importMenuOpen}
                        aria-haspopup='menu'
                        title="Importer des géocaches : GPX, Bookmark List, Pocket Query ou autour d'un point"
                    >
                        Importer <span className='codicon codicon-chevron-down' aria-hidden='true' />
                    </button>
                    {importMenuOpen && (
                        <div
                            role='menu'
                            style={{
                                position: 'absolute',
                                top: '100%',
                                right: 0,
                                marginTop: 4,
                                minWidth: 230,
                                border: '1px solid var(--theia-panel-border)',
                                background: 'var(--theia-editor-background)',
                                borderRadius: 3,
                                zIndex: 20,
                                boxShadow: '0 4px 12px rgba(0,0,0,0.35)',
                                padding: 4,
                            }}
                        >
                            {importMenuItems.map(item => (
                                <button
                                    key={item.label}
                                    role='menuitem'
                                    className='geoapp-import-menu-item'
                                    title={item.title}
                                    onClick={() => {
                                        setImportMenuOpen(false);
                                        item.action();
                                    }}
                                >
                                    <span className={item.iconClass} aria-hidden='true' />
                                    {item.label}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
                {(outingMode ? props.onExitOutingMode : props.onEnterOutingMode) && (
                    <button
                        className={`theia-button${outingMode ? '' : ' secondary'}`}
                        onClick={() => (outingMode ? props.onExitOutingMode?.() : props.onEnterOutingMode?.())}
                        title={outingMode
                            ? 'Quitter le mode sortie entre amis'
                            : 'Préparer une sortie entre amis (les caches sélectionnées en définissent le périmètre)'}
                    >
                        <span className='codicon codicon-organization' aria-hidden='true' /> Sortie
                    </button>
                )}
            </div>
        </div>

        {/* Sortie retrouvée dans le stockage : le mode s'est réactivé tout seul,
            il faut le dire — sinon la table filtre et colore sans raison apparente. */}
        {outing && props.outingRestored && (
            <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 10px',
                marginBottom: 8,
                borderRadius: 4,
                border: '1px solid var(--theia-panel-border)',
                borderLeft: '3px solid var(--theia-charts-blue)',
                background: 'var(--theia-editor-background)',
                fontSize: '0.85em',
            }}>
                <span className='codicon codicon-history' />
                <span>
                    Sortie en cours restaurée
                    {outing.friends.length > 0 && ` — ${outing.friends.length} ami(s)`}
                    {outing.gcCodes.length > 0
                        ? `, ${outing.gcCodes.length} cache(s) au périmètre`
                        : ', toute la zone'}
                </span>
                <span style={{ flex: 1 }} />
                <button
                    className='theia-button secondary'
                    onClick={props.onDismissOutingRestored}
                    title='Masquer ce message'
                    style={{ padding: '2px 8px' }}
                >
                    <span className='codicon codicon-close' />
                </button>
            </div>
        )}

        {/* Bandeau de mode : le panneau latéral peut être replié, mais un tableau
            qui colore et filtre doit toujours dire au nom de quelle sortie il le
            fait — et offrir la porte de sortie. */}
        {outing && (
            <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '4px 10px',
                marginBottom: 8,
                borderRadius: 4,
                border: '1px solid var(--theia-panel-border)',
                borderLeft: '3px solid var(--theia-charts-blue)',
                background: 'var(--theia-editor-background)',
                fontSize: '0.85em',
            }}>
                <span className='codicon codicon-organization' aria-hidden='true' />
                <span title={outing.friends.length > 0 ? outing.friends.join(', ') : undefined}>
                    {outingFriendsLabel
                        ? `Sortie avec ${outingFriendsLabel}`
                        : 'Sortie sans ami sélectionné'}
                    {' · '}
                    {outing.gcCodes.length > 0
                        ? `${outing.gcCodes.length} cache(s)`
                        : `toute la zone (${props.rows.length} cache(s))`}
                </span>
                <span style={{ flex: 1 }} />
                <button
                    className='theia-button secondary'
                    onClick={() => props.onExitOutingMode?.()}
                    title='Quitter le mode sortie (la sortie enregistrée est supprimée)'
                    style={{ padding: '2px 8px' }}
                >
                    Quitter
                </button>
            </div>
        )}

        {/* Tableau à gauche, panneau de sortie à droite. Le panneau reste monté
            même pendant un chargement ou sur une zone vide : il porte le mode, qui
            ne dépend pas de ce que le tableau a à afficher. */}
        <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, minHeight: 0, position: 'relative' }}>
            {/* Le tableau ne se démonte qu'au tout premier chargement (zone sans
                données en mémoire). Pendant un rechargement déclenché par une
                action de la page, il reste monté — sinon tri, filtres, sélection
                et scroll seraient perdus à chaque ajout/suppression/import. Un
                badge non bloquant signale que les données affichées se rafraîchissent. */}
            {props.loading && (
                <div
                    style={{
                        position: 'absolute',
                        top: 8,
                        right: 12,
                        zIndex: 5,
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                        padding: '3px 10px',
                        borderRadius: 10,
                        border: '1px solid var(--theia-panel-border)',
                        background: 'var(--theia-editor-background)',
                        fontSize: '0.8em',
                        boxShadow: '0 2px 6px rgba(0,0,0,0.25)',
                        pointerEvents: 'none',
                    }}
                    role='status'
                    aria-live='polite'
                >
                    <span className='geoapp-gc-action-btn__spinner' aria-hidden='true' />
                    Mise à jour…
                </div>
            )}
            {props.loading && props.rows.length === 0 ? (
                <div style={{ display: 'flex', flex: 1 }}>
                    <LoadingState fullHeight />
                </div>
            ) : props.rows.length === 0 ? (
                <div style={{ display: 'flex', flex: 1 }}>
                    <EmptyState
                        fullHeight
                        icon='fa-map-o'
                        title='Aucune géocache dans cette zone'
                        description='Utilisez le formulaire ci-dessus pour importer des géocaches.'
                    />
                </div>
            ) : (
                <GeocachesTable
                    data={props.rows}
                    onRowClick={props.onRowClick}
                    onDeleteSelected={props.onDeleteSelected}
                    onRefreshSelected={props.onRefreshSelected}
                    onLogSelected={props.onLogSelected}
                    onCopySelected={props.onCopySelected}
                    onMoveSelected={props.onMoveSelected}
                    onApplyPluginSelected={props.onApplyPluginSelected}
                    onAnalyzeWithAiSelected={props.onAnalyzeWithAiSelected}
                    analyzingWithAi={props.analyzingWithAi}
                    onStartOutingWithSelection={props.onStartOutingWithSelection}
                    onAddSelectionToOuting={props.onAddSelectionToOuting}
                    onExportGpxSelected={props.onExportGpxSelected}
                    exportingGpx={props.exportingGpx}
                    onDelete={geocache => props.onDelete(geocache)}
                    pendingDeleteIds={props.pendingDeleteIds}
                    onRefresh={props.onRefresh}
                    onMove={props.onMove}
                    onCopy={props.onCopy}
                    onImportAround={props.onImportAround}
                    zones={props.zones}
                    currentZoneId={props.currentZoneId}
                    visibleColumnIds={props.tableVisibleColumnIds}
                    onVisibleColumnIdsChange={props.onTableVisibleColumnIdsChange}
                    sorting={props.tableSorting}
                    onSortingChange={props.onTableSortingChange}
                    distanceOrigin={props.distanceOrigin}
                    onSetDistanceOrigin={props.onSetDistanceOrigin}
                    onClearDistanceOrigin={props.onClearDistanceOrigin}
                    onFilteredDataChange={props.onFilteredDataChange}
                    onSelectionChange={props.onSelectionChange}
                    selectedGeocacheIds={props.selectedGeocacheIds}
                    appliedSearchQuery={props.appliedSearchQuery}
                    friendFinds={props.friendFinds}
                    friendScans={props.friendScans}
                    activeFriends={props.activeFriends}
                    /* Le mode se transmet tel quel : c'est la table qui décide de
                       ce qu'il change (colonne « 👥 », couleurs, filtres, marqueur
                       de périmètre), sans que la vue ait à neutraliser chaque prop. */
                    outingMode={outingMode}
                    outingGcCodes={outing?.gcCodes}
                    friendFilter={props.friendFilter}
                    onFriendFilterChange={props.onFriendFilterChange}
                    outingFlags={props.outingFlags}
                />
            )}
            </div>

            {outing && (
                <FriendOutingSidePanel
                    outing={outing}
                    rows={props.rows}
                    accountFriends={props.accountFriends ?? []}
                    friendsLoading={props.friendsListLoading}
                    friendsError={props.friendsListError ?? null}
                    onReloadFriends={props.onReloadFriends}
                    activeFriends={props.activeFriends ?? new Set()}
                    onToggleFriend={props.onToggleActiveFriend ?? (() => undefined)}
                    onSetFriends={props.onSetActiveFriends ?? (() => undefined)}
                    friendFinds={props.friendFinds ?? {}}
                    friendScans={props.friendScans ?? []}
                    selectedGeocacheIds={props.selectedGeocacheIds ?? []}
                    onReplaceCachesWithSelection={props.onReplaceOutingCaches ?? (() => undefined)}
                    onAddSelectionToCaches={props.onAddSelectionToOutingCaches ?? (() => undefined)}
                    onRemoveSelectionFromCaches={props.onRemoveSelectionFromOutingCaches ?? (() => undefined)}
                    onResetCachesToZone={props.onResetOutingCachesToZone ?? (() => undefined)}
                    onAnalyze={() => { void props.onAnalyzeActiveFriends?.(); }}
                    progress={props.friendFindsProgress ?? null}
                    onCancelAnalyze={props.onCancelAnalyzeFriendFinds ?? (() => undefined)}
                    lastAnalysisSummary={props.lastAnalysisSummary ?? null}
                    friendFilter={props.friendFilter ?? 'none'}
                    onFriendFilterChange={props.onFriendFilterChange ?? (() => undefined)}
                    onOpenGeocache={props.onRowClick}
                    onExit={props.onExitOutingMode ?? (() => undefined)}
                />
            )}
        </div>

        {props.showImportDialog && props.zoneId && (
            <ImportGpxDialog
                zoneId={props.zoneId}
                onImport={props.onImportGpx}
                onCancel={props.onCancelImportDialog}
                onCancelImport={props.onCancelImport}
                isImporting={props.isImporting}
            />
        )}

        {props.showBookmarkListDialog && props.zoneId && (
            <ImportBookmarkListDialog
                zoneId={props.zoneId}
                zoneName={props.zones.find(z => z.id === props.zoneId)?.name}
                onImport={props.onImportBookmarkList}
                onCancel={props.onCancelBookmarkListDialog}
                onCancelImport={props.onCancelImport}
                isImporting={props.isImporting}
            />
        )}

        {props.showPocketQueryDialog && props.zoneId && (
            <ImportPocketQueryDialog
                zoneId={props.zoneId}
                zoneName={props.zones.find(z => z.id === props.zoneId)?.name}
                onImport={props.onImportPocketQuery}
                onCancel={props.onCancelPocketQueryDialog}
                onCancelImport={props.onCancelImport}
                isImporting={props.isImporting}
            />
        )}

        {props.copySelectedDialog && props.zoneId && (
            <MoveGeocacheDialog
                geocacheCount={props.copySelectedDialog.geocacheIds.length}
                currentZoneId={props.zoneId}
                zones={props.zones}
                onMove={props.onConfirmCopySelected}
                onCancel={props.onCancelCopySelected}
                title='Copier les geocaches vers une zone'
                actionLabel='Copier'
            />
        )}

        {props.moveSelectedDialog && props.zoneId && (
            <MoveGeocacheDialog
                geocacheCount={props.moveSelectedDialog.geocacheIds.length}
                currentZoneId={props.zoneId}
                zones={props.zones}
                onMove={props.onConfirmMoveSelected}
                onCancel={props.onCancelMoveSelected}
                title='Deplacer les geocaches vers une zone'
                actionLabel='Deplacer'
            />
        )}

        {props.showImportAroundDialog && props.zoneId && (
            <ImportAroundDialog
                zoneId={props.zoneId}
                zoneName={props.zones.find(z => z.id === props.zoneId)?.name}
                initialCenter={props.importAroundDialogInitialCenter}
                onImport={props.onImportAroundDialogImport}
                onCancel={props.onCancelImportAroundDialog}
                isImporting={props.isImporting}
            />
        )}

    </div>
    );
};
