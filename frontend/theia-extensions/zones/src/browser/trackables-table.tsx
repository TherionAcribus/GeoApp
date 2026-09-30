/**
 * Tableau de l'inventaire Trackables (onglet Inventaire du widget).
 *
 * Même techno que le tableau des zones : `@tanstack/react-table` (tri sur
 * en-tête cliquable, `aria-sort`) et la fenêtre de virtualisation partagée de
 * `virtualized-table-window.ts` — un inventaire peut tenir des milliers de
 * TBs, seules les lignes visibles sont rendues.
 *
 * Les classes `geoapp-gc-table*` sont celles du tableau des géocaches : mêmes
 * couleurs, mêmes survols, mêmes focus visibles.
 */

import * as React from 'react';
import {
    ColumnDef,
    SortingState,
    flexRender,
    getCoreRowModel,
    getSortedRowModel,
    useReactTable,
} from '@tanstack/react-table';
import '../../src/browser/style/geocaches-table.css';
import '../../src/browser/style/trackables-widget.css';
import { InventoryTrackable, trackableUrl } from './log-editor/trackables';
import { useRowVirtualizer } from './virtualized-table-window';

export interface TrackablesTableProps {
    trackables: InventoryTrackable[];
    onShowDetail: (code: string) => void;
    onLog: (code: string) => void;
}

/** Hauteur de ligne compacte — synchronisée avec `--geoapp-gc-row-height` ci-dessous. */
const TRACKABLE_ROW_HEIGHT = 28;

const TrackableIcon: React.FC<{ url: string | null | undefined }> = ({ url }) => {
    const [failed, setFailed] = React.useState(false);
    if (!url || failed) {
        return <span className='geoapp-trackables-widget__icon' />;
    }
    return (
        <img
            className='geoapp-trackables-widget__icon'
            src={url}
            alt=''
            loading='lazy'
            decoding='async'
            width={16}
            height={16}
            onError={() => setFailed(true)}
        />
    );
};

export const TrackablesTable: React.FC<TrackablesTableProps> = ({
    trackables,
    onShowDetail,
    onLog,
}) => {
    const [sorting, setSorting] = React.useState<SortingState>([]);
    const tableScrollRef = React.useRef<HTMLDivElement | null>(null);

    const columns = React.useMemo<ColumnDef<InventoryTrackable>[]>(() => [
        {
            id: 'icon',
            size: 32,
            enableSorting: false,
            header: () => null,
            cell: ({ row }) => <TrackableIcon url={row.original.icon_url} />,
        },
        {
            id: 'name',
            accessorFn: tb => tb.name ?? '',
            size: 320,
            header: () => 'Nom',
            cell: ({ row }) => (
                <span
                    className='geoapp-trackables-widget__name'
                    title={[row.original.name, row.original.type_name].filter(Boolean).join(' — ') || undefined}
                >
                    {row.original.name ?? row.original.reference_code}
                </span>
            ),
        },
        {
            id: 'code',
            accessorKey: 'reference_code',
            size: 90,
            header: () => 'Code',
            cell: ({ row }) => (
                <a
                    className='geoapp-trackables-widget__code'
                    href={trackableUrl(row.original.reference_code)}
                    target='_blank'
                    rel='noopener noreferrer'
                    title='Ouvrir la fiche sur Geocaching.com'
                    onClick={e => e.stopPropagation()}
                >
                    {row.original.reference_code}
                </a>
            ),
        },
        {
            id: 'type',
            accessorFn: tb => tb.type_name ?? '',
            size: 120,
            header: () => 'Type',
            cell: ({ row }) => row.original.type_name ?? '',
        },
        {
            id: 'owner',
            accessorFn: tb => tb.owner_username ?? '',
            size: 140,
            header: () => 'Propriétaire',
            cell: ({ row }) => row.original.owner_username ?? '',
        },
        {
            id: 'actions',
            size: 120,
            enableSorting: false,
            header: () => null,
            cell: ({ row }) => (
                <span className='geoapp-trackables-widget__row-actions'>
                    <button
                        type='button'
                        className='theia-button secondary'
                        title='Ouvrir la fiche du trackable'
                        onClick={e => { e.stopPropagation(); onShowDetail(row.original.reference_code); }}
                    >
                        Fiche
                    </button>
                    <button
                        type='button'
                        className='theia-button secondary'
                        title='Préremplir l’onglet Loguer avec ce trackable'
                        onClick={e => { e.stopPropagation(); onLog(row.original.reference_code); }}
                    >
                        Loguer
                    </button>
                </span>
            ),
        },
    ], [onShowDetail, onLog]);

    const table = useReactTable({
        data: trackables,
        columns,
        state: { sorting },
        onSortingChange: setSorting,
        getCoreRowModel: getCoreRowModel(),
        getSortedRowModel: getSortedRowModel(),
        getRowId: tb => tb.reference_code,
    });

    const rows = table.getRowModel().rows;
    const { startIndex, endIndex, paddingTop, paddingBottom } =
        useRowVirtualizer(rows.length, tableScrollRef, TRACKABLE_ROW_HEIGHT);
    const virtualRows = rows.slice(startIndex, endIndex);
    const visibleColumnCount = table.getVisibleLeafColumns().length;

    return (
        <div
            ref={tableScrollRef}
            className='geoapp-gc-table__scroll geoapp-trackables-widget__table-scroll'
            style={{ ['--geoapp-gc-row-height' as string]: `${TRACKABLE_ROW_HEIGHT}px` } as React.CSSProperties}
        >
            <table className='geoapp-gc-table' aria-label='Inventaire des trackables'>
                <thead>
                    {table.getHeaderGroups().map(headerGroup => (
                        <tr key={headerGroup.id}>
                            {headerGroup.headers.map(header => (
                                <th
                                    key={header.id}
                                    className={header.column.getCanSort()
                                        ? 'geoapp-gc-table__th geoapp-gc-table__th--sortable'
                                        : 'geoapp-gc-table__th'}
                                    onClick={header.column.getToggleSortingHandler()}
                                    onKeyDown={header.column.getCanSort() ? event => {
                                        if (event.key === 'Enter' || event.key === ' ') {
                                            event.preventDefault();
                                            header.column.getToggleSortingHandler()?.(event);
                                        }
                                    } : undefined}
                                    tabIndex={header.column.getCanSort() ? 0 : undefined}
                                    aria-sort={!header.column.getCanSort() ? undefined
                                        : header.column.getIsSorted() === 'asc' ? 'ascending'
                                        : header.column.getIsSorted() === 'desc' ? 'descending'
                                        : 'none'}
                                    style={{ width: header.column.getSize() }}
                                >
                                    <div className='geoapp-gc-table__th-inner'>
                                        {flexRender(header.column.columnDef.header, header.getContext())}
                                        {header.column.getIsSorted() === 'asc' && (
                                            <span className='geoapp-gc-table__sort-icon' aria-hidden='true'>▲</span>
                                        )}
                                        {header.column.getIsSorted() === 'desc' && (
                                            <span className='geoapp-gc-table__sort-icon' aria-hidden='true'>▼</span>
                                        )}
                                    </div>
                                </th>
                            ))}
                        </tr>
                    ))}
                </thead>
                <tbody>
                    {paddingTop > 0 && (
                        <tr key='virtual-padding-top' aria-hidden='true'>
                            <td colSpan={visibleColumnCount} style={{ height: paddingTop, padding: 0, border: 'none' }} />
                        </tr>
                    )}
                    {virtualRows.map(row => (
                        <tr key={row.id} className='geoapp-gc-table__row'>
                            {row.getVisibleCells().map(cell => (
                                <td key={cell.id} className='geoapp-gc-table__cell'>
                                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                </td>
                            ))}
                        </tr>
                    ))}
                    {paddingBottom > 0 && (
                        <tr key='virtual-padding-bottom' aria-hidden='true'>
                            <td colSpan={visibleColumnCount} style={{ height: paddingBottom, padding: 0, border: 'none' }} />
                        </tr>
                    )}
                </tbody>
            </table>
        </div>
    );
};
