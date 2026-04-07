import * as React from 'react';
import { GeocachesTable, Geocache } from './geocaches-table';
import { ImportGpxDialog } from './import-gpx-dialog';
import { ImportBookmarkListDialog } from './import-bookmark-list-dialog';
import { ImportPocketQueryDialog } from './import-pocket-query-dialog';
import { MoveGeocacheDialog } from './move-geocache-dialog';

type SelectionDialogState = { geocacheIds: number[] } | null;

export interface ZoneGeocachesViewProps {
    titleLabel: string;
    zoneId?: number;
    rows: Geocache[];
    zones: Array<{ id: number; name: string }>;
    currentZoneId?: number;
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
    onImportGpx: (file: File, updateExisting: boolean, onProgress?: (percentage: number, message: string) => void) => Promise<void>;
    onImportBookmarkList: (bookmarkCode: string, onProgress?: (percentage: number, message: string) => void) => Promise<void>;
    onImportPocketQuery: (pqCode: string, onProgress?: (percentage: number, message: string) => void) => Promise<void>;
    onCancelImportDialog: () => void;
    onCancelBookmarkListDialog: () => void;
    onCancelPocketQueryDialog: () => void;
    onConfirmCopySelected: (targetZoneId: number) => void | Promise<void>;
    onCancelCopySelected: () => void;
    onConfirmMoveSelected: (targetZoneId: number) => void | Promise<void>;
    onCancelMoveSelected: () => void;
}

export const ZoneGeocachesView: React.FC<ZoneGeocachesViewProps> = props => (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <h3 style={{ margin: 0 }}>{props.titleLabel}</h3>
            <div style={{ display: 'flex', gap: 8 }}>
                <form onSubmit={props.onSubmitAddGeocache} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <input name='gc_code' placeholder='Code GC (ex: GC12345)' style={{ width: 180, padding: '4px 8px' }} />
                    <button type='submit' className='theia-button'>+ Importer</button>
                </form>
                <button
                    className='theia-button secondary'
                    onClick={props.onOpenImportDialog}
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                        backgroundColor: 'var(--theia-button-secondaryBackground)',
                        color: 'var(--theia-button-secondaryForeground)',
                    }}
                >
                    <span>GPX</span>
                </button>
                <button
                    className='theia-button secondary'
                    onClick={props.onOpenBookmarkListDialog}
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                        backgroundColor: 'var(--theia-button-secondaryBackground)',
                        color: 'var(--theia-button-secondaryForeground)',
                    }}
                >
                    <span>Liste</span>
                </button>
                <button
                    className='theia-button secondary'
                    onClick={props.onOpenPocketQueryDialog}
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                        backgroundColor: 'var(--theia-button-secondaryBackground)',
                        color: 'var(--theia-button-secondaryForeground)',
                    }}
                >
                    <span>PQ</span>
                </button>
                <button className='theia-button secondary' onClick={props.onStartImportAround}>
                    Importer autour...
                </button>
            </div>
        </div>

        {props.loading ? (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', flex: 1 }}>
                <span>Chargement...</span>
            </div>
        ) : props.rows.length === 0 ? (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', flex: 1, opacity: 0.6 }}>
                <div style={{ textAlign: 'center' }}>
                    <p>Aucune geocache dans cette zone</p>
                    <p style={{ fontSize: '0.9em' }}>Utilisez le formulaire ci-dessus pour importer des geocaches</p>
                </div>
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
            />
        )}

        {props.showImportDialog && props.zoneId && (
            <ImportGpxDialog
                zoneId={props.zoneId}
                onImport={props.onImportGpx}
                onCancel={props.onCancelImportDialog}
                isImporting={props.isImporting}
            />
        )}

        {props.showBookmarkListDialog && props.zoneId && (
            <ImportBookmarkListDialog
                zoneId={props.zoneId}
                onImport={props.onImportBookmarkList}
                onCancel={props.onCancelBookmarkListDialog}
                isImporting={props.isImporting}
            />
        )}

        {props.showPocketQueryDialog && props.zoneId && (
            <ImportPocketQueryDialog
                zoneId={props.zoneId}
                onImport={props.onImportPocketQuery}
                onCancel={props.onCancelPocketQueryDialog}
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
    </div>
);
