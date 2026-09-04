import * as React from 'react';
import { GeocachesTable, Geocache, GeocachesTableColumnId } from './geocaches-table';
import { OutingPlanCacheFlags } from './outing-plan-types';
import { ImportGpxDialog } from './import-gpx-dialog';
import { ImportBookmarkListDialog } from './import-bookmark-list-dialog';
import { ImportPocketQueryDialog } from './import-pocket-query-dialog';
import { MoveGeocacheDialog } from './move-geocache-dialog';
import { ImportAroundDialog, ImportAroundCenter, ImportAroundRequest } from './import-around-dialog';
import { ImportProgressCallback } from './import-dialog-shell';
import { EmptyState, LoadingState } from './state-views';
import { ZoneFriendAnalysisPanel } from './zone-friend-analysis-panel';
import type { FriendFindsProgress, FriendZoneScanEntry } from './friends-types';

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
    onExportGpxSelected: (ids: number[]) => void | Promise<void>;
    /** Un export GPX est en cours : le bouton de la barre d'actions passe en attente. */
    exportingGpx?: boolean;
    onDelete: (geocache: Geocache) => void | Promise<void>;
    onRefresh: (id: number) => void | Promise<void>;
    onMove: (geocache: Geocache, targetZoneId: number) => void | Promise<void>;
    onCopy: (geocache: Geocache, targetZoneId: number) => void | Promise<void>;
    onImportAround: (geocache: Geocache) => void | Promise<void>;
    onTableVisibleColumnIdsChange: (columnIds: GeocachesTableColumnId[]) => void;
    onFilteredDataChange?: (geocaches: Geocache[]) => void;
    onSelectionChange?: (geocacheIds: number[]) => void;
    selectedGeocacheIds?: number[];
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
    /** Liste des pseudos d'amis connus (pour le filtre « manquantes pour X »). */
    friendNames?: string[];
    /** Ami sélectionné pour le filtre « manquantes pour X » (null = aucun filtre). */
    missingForFriend?: string | null;
    /** Callback quand l'utilisateur change le filtre « manquantes pour X ». */
    onMissingForFriendChange?: (friend: string | null) => void;
    /** Signaux de la dernière analyse IA de sortie, par code GC (colonne « Sortie »). */
    outingFlags?: Record<string, OutingPlanCacheFlags>;
    /** Progression de l'analyse des amis (null = inactive). */
    friendFindsProgress?: FriendFindsProgress | null;
    /** Résumé persistant de la dernière analyse terminée. */
    lastAnalysisSummary?: {
        scanned: number;
        skipped: number;
        withFriends: number;
        rateLimited: boolean;
        cancelled: boolean;
        at: string;
    } | null;
    onAnalyzeFriendFinds?: (forceAll: boolean) => void | Promise<void>;
    /** Interrompt l'analyse streaming en cours. */
    onCancelAnalyzeFriendFinds?: () => void;
    /** Nombre d'amis dont le scan est frais (vérifié récemment). */
    friendScansFreshCount?: number;
    /** Nombre total d'amis dans la liste. */
    friendScansTotalCount?: number;
    /** État des scans par ami (pour le dialogue de sélection). */
    friendScans?: FriendZoneScanEntry[];
    /** Dialogue de sélection d'amis ouvert. */
    friendSelectionDialogOpen?: boolean;
    /** Amis sélectionnés dans le dialogue. */
    friendSelectionChecked?: Set<string>;
    /** Checkbox « forcer une réanalyse complète » dans le dialogue. */
    friendSelectionForceAll?: boolean;
    onOpenFriendSelectionDialog?: () => void;
    onCloseFriendSelectionDialog?: () => void;
    onToggleFriendSelection?: (friend: string) => void;
    onToggleAllFriendsSelection?: (selectAll: boolean) => void;
    onFriendSelectionForceAllChange?: (forceAll: boolean) => void;
    onConfirmFriendSelection?: () => void | Promise<void>;
    showImportAroundDialog: boolean;
    importAroundDialogInitialCenter?: ImportAroundCenter;
    onImportAroundDialogImport: (request: ImportAroundRequest, onProgress?: (percentage: number, message: string) => void) => Promise<void>;
    onCancelImportAroundDialog: () => void;
}

export const ZoneGeocachesView: React.FC<ZoneGeocachesViewProps> = props => (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <h3 style={{ margin: 0 }}>{props.titleLabel}</h3>
            <div style={{ display: 'flex', gap: 8 }}>
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
                            title="Importer cette géocache dans la zone"
                            style={{
                                borderRadius: 0,
                                margin: 0,
                                border: 'none',
                                borderLeft: '1px solid var(--theia-input-border)',
                            }}
                        >
                            Importer
                        </button>
                    </div>
                </form>
                <button
                    className='theia-button secondary'
                    onClick={props.onOpenImportDialog}
                    title='Importer des géocaches depuis un fichier GPX'
                >
                    📂 GPX
                </button>
                <button
                    className='theia-button secondary'
                    onClick={props.onOpenBookmarkListDialog}
                    title='Importer depuis une Bookmark List Geocaching.com'
                >
                    📋 Liste
                </button>
                <button
                    className='theia-button secondary'
                    onClick={props.onOpenPocketQueryDialog}
                    title='Importer depuis une Pocket Query Geocaching.com (PQ)'
                >
                    🔍 Pocket Query
                </button>
                <button
                    className='theia-button secondary'
                    onClick={props.onStartImportAround}
                    title="Rechercher et importer des géocaches autour d'un point ou d'une cache"
                >
                    📍 Importer autour…
                </button>
                {props.onMissingForFriendChange && props.friendNames && props.friendNames.length > 0 && (
                    <select
                        className='theia-select'
                        value={props.missingForFriend ?? ''}
                        onChange={e => props.onMissingForFriendChange?.(e.target.value || null)}
                        title="Filtrer : caches que cet ami n'a pas encore trouvées"
                        style={{ maxWidth: 140 }}
                    >
                        <option value=''>Tous les amis</option>
                        {props.friendNames.map(name => (
                            <option key={name} value={name}>
                                Pas {name}
                            </option>
                        ))}
                    </select>
                )}
                {props.onAnalyzeFriendFinds && (
                    <>
                        <button
                            className='theia-button secondary'
                            onClick={e => {
                                if (e.shiftKey) {
                                    // Maj+clic : analyse complète de tous les amis (raccourci).
                                    props.onAnalyzeFriendFinds?.(true);
                                } else if (props.onOpenFriendSelectionDialog) {
                                    // Clic normal : ouvrir le dialogue de sélection.
                                    props.onOpenFriendSelectionDialog();
                                } else {
                                    props.onAnalyzeFriendFinds?.(false);
                                }
                            }}
                            disabled={!!props.friendFindsProgress}
                            title={
                                "Déterminer, pour chaque cache de la zone, lesquels de vos amis l'ont trouvée "
                                + '(sur tout leur historique). Maj+clic pour forcer une réanalyse complète de tous les amis.'
                            }
                        >
                            {props.friendFindsProgress
                                ? `👥 ${props.friendFindsProgress.done}/${props.friendFindsProgress.total}…`
                                : props.friendScansTotalCount && props.friendScansTotalCount > 0
                                    ? `👥 Amis ${props.friendScansFreshCount}/${props.friendScansTotalCount}`
                                    : '👥 Amis'}
                        </button>
                        {props.friendFindsProgress && props.onCancelAnalyzeFriendFinds && (
                            <button
                                className='theia-button secondary'
                                onClick={props.onCancelAnalyzeFriendFinds}
                                title="Interrompre l'analyse en cours"
                            >
                                ✕
                            </button>
                        )}
                    </>
                )}
            </div>
        </div>

        {/* Barre d'état de l'analyse des amis : progression live + résumé persistant. */}
        {(props.friendFindsProgress || props.lastAnalysisSummary) && (
            <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '6px 10px',
                marginBottom: 8,
                borderRadius: 4,
                border: '1px solid var(--theia-panel-border)',
                background: 'var(--theia-editor-background)',
                fontSize: '0.85em',
            }}>
                {props.friendFindsProgress ? (
                    <>
                        <span className='codicon codicon-loading codicon-spin' style={{ fontSize: '1em' }} />
                        <span style={{ fontWeight: 'bold' }}>
                            Analyse en cours : {props.friendFindsProgress.done}/{props.friendFindsProgress.total}
                        </span>
                        {props.friendFindsProgress.friend && (
                            <span style={{ color: 'var(--theia-descriptionForeground)' }}>
                                ({props.friendFindsProgress.friend})
                            </span>
                        )}
                        {props.friendFindsProgress.total > 0 && (
                            <div style={{
                                flex: 1,
                                height: 4,
                                borderRadius: 2,
                                backgroundColor: 'var(--theia-panel-border)',
                                overflow: 'hidden',
                            }}>
                                <div style={{
                                    width: `${Math.round(100 * props.friendFindsProgress.done / props.friendFindsProgress.total)}%`,
                                    height: '100%',
                                    backgroundColor: 'var(--theia-charts-blue)',
                                    transition: 'width 0.3s',
                                }} />
                            </div>
                        )}
                        {props.onCancelAnalyzeFriendFinds && (
                            <button
                                className='theia-button secondary'
                                onClick={props.onCancelAnalyzeFriendFinds}
                                title='Interrompre'
                                style={{ padding: '2px 8px', fontSize: '0.9em' }}
                            >
                                ✕
                            </button>
                        )}
                    </>
                ) : props.lastAnalysisSummary && (
                    <>
                        <span
                            className={`codicon ${props.lastAnalysisSummary.cancelled ? 'codicon-debug-stop' : 'codicon-check'}`}
                            style={{
                                color: props.lastAnalysisSummary.cancelled
                                    ? 'var(--theia-descriptionForeground)'
                                    : 'var(--theia-charts-green)',
                            }}
                        />
                        <span>
                            {props.lastAnalysisSummary.cancelled
                                ? `Interrompue après ${props.lastAnalysisSummary.scanned} ami(s)`
                                : `${props.lastAnalysisSummary.scanned} ami(s) analysé(s)`}
                            {props.lastAnalysisSummary.skipped > 0
                                && ` (${props.lastAnalysisSummary.skipped} skip)`}
                            {' — '}
                            <strong>{props.lastAnalysisSummary.withFriends}</strong>
                            {` cache(s) trouvée(s) par au moins un ami`}
                            {props.lastAnalysisSummary.rateLimited
                                && <span style={{ color: 'var(--theia-charts-orange)' }}> — throttling geocaching.com</span>}
                        </span>
                        <span style={{ color: 'var(--theia-descriptionForeground)', marginLeft: 'auto' }}>
                            {new Date(props.lastAnalysisSummary.at).toLocaleTimeString('fr-FR')}
                        </span>
                    </>
                )}
            </div>
        )}

        {/* Panneau de résultat de l'analyse amis (matrice ami × cache). */}
        {!props.loading && props.rows.length > 0 && props.friendFinds && props.onMissingForFriendChange && (
            <ZoneFriendAnalysisPanel
                rows={props.rows}
                friendFinds={props.friendFinds}
                friendScans={props.friendScans ?? []}
                missingForFriend={props.missingForFriend ?? null}
                onMissingForFriendChange={props.onMissingForFriendChange}
                onOpenGeocache={props.onRowClick}
            />
        )}

        {props.loading ? (
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
                onExportGpxSelected={props.onExportGpxSelected}
                exportingGpx={props.exportingGpx}
                onDelete={geocache => props.onDelete(geocache)}
                onRefresh={props.onRefresh}
                onMove={props.onMove}
                onCopy={props.onCopy}
                onImportAround={props.onImportAround}
                zones={props.zones}
                currentZoneId={props.currentZoneId}
                visibleColumnIds={props.tableVisibleColumnIds}
                onVisibleColumnIdsChange={props.onTableVisibleColumnIdsChange}
                onFilteredDataChange={props.onFilteredDataChange}
                onSelectionChange={props.onSelectionChange}
                selectedGeocacheIds={props.selectedGeocacheIds}
                friendFinds={props.friendFinds}
                missingForFriend={props.missingForFriend}
                outingFlags={props.outingFlags}
            />
        )}

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

        {props.friendSelectionDialogOpen && (
            <div
                style={{
                    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                    background: 'rgba(0,0,0,0.4)', zIndex: 10000,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
                onClick={props.onCloseFriendSelectionDialog}
            >
                <div
                    style={{
                        background: 'var(--theia-editor-background, #fff)',
                        borderRadius: '4px', padding: '16px', minWidth: '360px',
                        maxWidth: '500px', maxHeight: '80vh', overflow: 'auto',
                        boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                    }}
                    onClick={e => e.stopPropagation()}
                >
                    <div style={{ fontWeight: 'bold', marginBottom: '12px', fontSize: '14px' }}>
                        Sélectionner les amis à analyser
                    </div>
                    <div style={{ marginBottom: '8px', display: 'flex', gap: '8px' }}>
                        <button
                            className='theia-button secondary'
                            style={{ fontSize: '12px' }}
                            onClick={() => props.onToggleAllFriendsSelection?.(true)}
                        >
                            Tout cocher
                        </button>
                        <button
                            className='theia-button secondary'
                            style={{ fontSize: '12px' }}
                            onClick={() => props.onToggleAllFriendsSelection?.(false)}
                        >
                            Tout décocher
                        </button>
                    </div>
                    <div style={{ maxHeight: '300px', overflow: 'auto', border: '1px solid var(--theia-border, #ccc)', borderRadius: '2px' }}>
                        {(props.friendScans ?? []).map(scan => {
                            const checked = props.friendSelectionChecked?.has(scan.friend) ?? false;
                            return (
                                <label
                                    key={scan.friend}
                                    style={{
                                        display: 'flex', alignItems: 'center', gap: '8px',
                                        padding: '4px 8px', cursor: 'pointer',
                                        borderBottom: '1px solid var(--theia-border, #eee)',
                                    }}
                                >
                                    <input
                                        type='checkbox'
                                        checked={checked}
                                        onChange={() => props.onToggleFriendSelection?.(scan.friend)}
                                    />
                                    <span style={{ flex: 1 }}>{scan.friend}</span>
                                    {scan.scanned && !scan.is_stale && (
                                        <span style={{ fontSize: '11px', color: 'var(--theia-descriptionForeground, #888)' }}>
                                            ✓ {scan.found_count ?? 0} trouvée(s)
                                        </span>
                                    )}
                                    {scan.is_stale && (
                                        <span style={{ fontSize: '11px', color: 'var(--theia-editorWarning-foreground, #c4a000)' }}>
                                            obsolète
                                        </span>
                                    )}
                                </label>
                            );
                        })}
                        {(props.friendScans ?? []).length === 0 && (
                            <div style={{ padding: '12px', color: 'var(--theia-descriptionForeground, #888)', fontSize: '12px' }}>
                                Aucun ami à afficher. La liste d'amis sera chargée au prochain lancement.
                            </div>
                        )}
                    </div>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '12px', fontSize: '12px' }}>
                        <input
                            type='checkbox'
                            checked={props.friendSelectionForceAll ?? false}
                            onChange={e => props.onFriendSelectionForceAllChange?.(e.target.checked)}
                        />
                        Forcer une réanalyse complète (ignorer les scans récents)
                    </label>
                    <div style={{ display: 'flex', gap: '8px', marginTop: '16px', justifyContent: 'flex-end' }}>
                        <button
                            className='theia-button secondary'
                            onClick={props.onCloseFriendSelectionDialog}
                        >
                            Annuler
                        </button>
                        <button
                            className='theia-button main'
                            disabled={(props.friendSelectionChecked?.size ?? 0) === 0}
                            onClick={props.onConfirmFriendSelection}
                        >
                            Analyser ({props.friendSelectionChecked?.size ?? 0})
                        </button>
                    </div>
                </div>
            </div>
        )}
    </div>
);
