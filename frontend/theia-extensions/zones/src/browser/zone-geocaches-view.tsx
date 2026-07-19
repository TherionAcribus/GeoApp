import * as React from 'react';
import { GeocachesTable, Geocache, GeocachesTableColumnId } from './geocaches-table';
import { ImportGpxDialog } from './import-gpx-dialog';
import { ImportBookmarkListDialog } from './import-bookmark-list-dialog';
import { ImportPocketQueryDialog } from './import-pocket-query-dialog';
import { MoveGeocacheDialog } from './move-geocache-dialog';
import { ImportAroundDialog, ImportAroundCenter, ImportAroundRequest } from './import-around-dialog';
import { ImportProgressCallback } from './import-dialog-shell';
import { EmptyState, LoadingState } from './state-views';

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
    onExportGpxSelected: (ids: number[]) => void | Promise<void>;
    onDelete: (geocache: Geocache) => void | Promise<void>;
    onRefresh: (id: number) => void | Promise<void>;
    onMove: (geocache: Geocache, targetZoneId: number) => void | Promise<void>;
    onCopy: (geocache: Geocache, targetZoneId: number) => void | Promise<void>;
    onImportAround: (geocache: Geocache) => void | Promise<void>;
    onTableVisibleColumnIdsChange: (columnIds: GeocachesTableColumnId[]) => void;
    onFilteredDataChange?: (geocaches: Geocache[]) => void;
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
            </div>
        </div>

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
                onExportGpxSelected={props.onExportGpxSelected}
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
                initialCenter={props.importAroundDialogInitialCenter}
                onImport={props.onImportAroundDialogImport}
                onCancel={props.onCancelImportAroundDialog}
                isImporting={props.isImporting}
            />
        )}
    </div>
);
