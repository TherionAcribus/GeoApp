import * as React from '@theia/core/shared/react';
import { injectable, inject } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { MessageService } from '@theia/core';
import { StorageService } from '@theia/core/lib/browser';
import { PreferenceService } from '@theia/core/lib/common/preferences/preference-service';
import { LanguageModelRegistry, LanguageModelService, UserRequest, getTextOfResponse, getJsonOfResponse, isLanguageModelParsedResponse } from '@theia/ai-core';
import { GeoAppLogWriterAgentId } from './geoapp-log-writer-agent';
import {
    useReactTable,
    getCoreRowModel,
    getSortedRowModel,
    ColumnDef,
    flexRender,
    SortingState,
} from '@tanstack/react-table';
import { GeocacheIcon } from './geocache-icon';

type LogTypeValue = 'found' | 'dnf' | 'note';

type SubmissionStatus = 'ok' | 'failed' | 'skipped';

type ImageUploadStatus = 'pending' | 'uploading' | 'ok' | 'failed';

interface SelectedLogImage {
    id: string;
    file: File;
    status: ImageUploadStatus;
    imageGuid?: string;
    error?: string;
}

interface GeocacheListItem {
    id: number;
    gc_code: string;
    name: string;
    owner?: string;
    favorites_count?: number;
    logs_count?: number;
    placed_at?: string | null;
    cache_type?: string;
}

interface LogHistoryEntry {
    id: string;
    createdAt: string;
    logDate: string;
    useSameTextForAll: boolean;
    globalText: string;
    perCacheText: Record<number, string>;
    logType: LogTypeValue;
    perCacheLogType: Record<number, LogTypeValue>;
    perCacheFavorite: Record<number, boolean>;
}

interface LogTextPattern {
    id: string;
    name: string;
    content: string;
    isBuiltin: boolean;
}

interface PatternSuggestion {
    id: string;
    label: string;
    description: string;
    insertText: string;
}

function findPatternTokenStart(beforeCaret: string): number | null {
    const idx = beforeCaret.lastIndexOf('@');
    if (idx === -1) {
        return null;
    }
    const prev = beforeCaret[idx - 1];
    if (idx > 0 && prev && !/\s/.test(prev)) {
        return null;
    }
    return idx;
}

function getCaretCoordinates(element: HTMLTextAreaElement, position: number): { top: number; left: number } {
    const div = document.createElement('div');
    const style = window.getComputedStyle(element);
    
    const properties = [
        'boxSizing', 'width', 'height', 'overflowX', 'overflowY',
        'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
        'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
        'fontStyle', 'fontVariant', 'fontWeight', 'fontStretch', 'fontSize',
        'fontSizeAdjust', 'lineHeight', 'fontFamily', 'textAlign', 'textTransform',
        'textIndent', 'textDecoration', 'letterSpacing', 'wordSpacing', 'tabSize'
    ];
    
    properties.forEach(prop => {
        div.style[prop as any] = style[prop as any];
    });
    
    div.style.position = 'absolute';
    div.style.visibility = 'hidden';
    div.style.whiteSpace = 'pre-wrap';
    div.style.wordWrap = 'break-word';
    div.style.top = '0px';
    div.style.left = '0px';
    
    document.body.appendChild(div);
    
    const textBefore = element.value.substring(0, position);
    div.textContent = textBefore;
    
    const span = document.createElement('span');
    span.textContent = element.value.substring(position) || '.';
    div.appendChild(span);
    
    const elementRect = element.getBoundingClientRect();
    const spanRect = span.getBoundingClientRect();
    const divRect = div.getBoundingClientRect();
    
    const relativeTop = spanRect.top - divRect.top;
    const relativeLeft = spanRect.left - divRect.left;
    
    document.body.removeChild(div);
    
    return {
        top: elementRect.top + relativeTop + element.scrollTop,
        left: elementRect.left + relativeLeft + element.scrollLeft
    };
}

const GeocacheLogEditorGeocachesTable: React.FC<{
    data: GeocacheListItem[];
    logType: LogTypeValue;
    perCacheLogType: Record<number, LogTypeValue>;
    perCacheFavorite: Record<number, boolean>;
    perCacheSubmitStatus: Record<number, SubmissionStatus>;
    perCacheSubmitReference: Record<number, string | undefined>;
    onToggleFavorite: (geocacheId: number, nextValue: boolean) => void;
    onToggleLogType: (geocacheId: number, nextValue: LogTypeValue) => void;
    remainingFavoritePoints: number;
    maxHeight?: number;
}> = ({ data, logType, perCacheLogType, perCacheFavorite, perCacheSubmitStatus, perCacheSubmitReference, onToggleFavorite, onToggleLogType, remainingFavoritePoints, maxHeight = 220 }) => {
    const [sorting, setSorting] = React.useState<SortingState>([]);

    const columns = React.useMemo<ColumnDef<GeocacheListItem>[]>(() => {
        const typeLabel = (value: LogTypeValue): string => {
            if (value === 'found') {
                return 'Found it';
            }
            if (value === 'dnf') {
                return "Didn't find it";
            }
            return 'Write note';
        };

        const getPct = (favoritesCount: number | undefined, logsCount: number | undefined): number | undefined => {
            if (typeof favoritesCount !== 'number' || typeof logsCount !== 'number' || logsCount <= 0) {
                return undefined;
            }
            const pct = (favoritesCount / logsCount) * 100;
            return isFinite(pct) ? pct : undefined;
        };

        const getPlacedTs = (iso: string | null | undefined): number | undefined => {
            if (!iso) {
                return undefined;
            }
            const ts = Date.parse(iso);
            return isFinite(ts) ? ts : undefined;
        };

        const formatPlaced = (iso: string | null | undefined): string => {
            if (!iso) {
                return '—';
            }
            const ts = Date.parse(iso);
            if (!isFinite(ts)) {
                return '—';
            }
            return new Date(ts).toISOString().slice(0, 10);
        };

        const statusBadge = (gc: GeocacheListItem): React.ReactNode => {
            const status = perCacheSubmitStatus[gc.id];
            if (status === 'ok') {
                const ref = perCacheSubmitReference[gc.id];
                return (
                    <span
                        style={{
                            padding: '2px 6px',
                            borderRadius: 3,
                            fontSize: 12,
                            background: '#2ecc71',
                            color: '#fff',
                            fontWeight: 700,
                            whiteSpace: 'nowrap'
                        }}
                        title={ref ? `logReferenceCode: ${ref}` : 'Log envoyé'}
                    >
                        ✅
                    </span>
                );
            }
            if (status === 'skipped') {
                return (
                    <span
                        style={{
                            padding: '2px 6px',
                            borderRadius: 3,
                            fontSize: 12,
                            background: '#f39c12',
                            color: '#fff',
                            fontWeight: 700,
                            whiteSpace: 'nowrap'
                        }}
                        title='Cache déjà loguée (précédemment)'
                    >
                        ↩️
                    </span>
                );
            }
            if (status === 'failed') {
                return (
                    <span
                        style={{
                            padding: '2px 6px',
                            borderRadius: 3,
                            fontSize: 12,
                            background: 'var(--theia-errorForeground)',
                            color: '#fff',
                            fontWeight: 700,
                            whiteSpace: 'nowrap'
                        }}
                        title='Dernière tentative en échec'
                    >
                        ⚠️
                    </span>
                );
            }
            return (
                <span
                    style={{
                        padding: '2px 6px',
                        borderRadius: 3,
                        fontSize: 12,
                        background: '#7f8c8d',
                        color: '#fff',
                        fontWeight: 700,
                        whiteSpace: 'nowrap'
                    }}
                    title='Pas encore envoyé'
                >
                    ⏳
                </span>
            );
        };

        return [
            {
                id: 'status',
                header: 'Statut',
                cell: ({ row }) => statusBadge(row.original),
                sortingFn: (a, b) => {
                    const rank = (s: SubmissionStatus | undefined): number => {
                        if (s === 'failed') {
                            return 0;
                        }
                        if (s === 'skipped') {
                            return 1;
                        }
                        if (s === 'ok') {
                            return 2;
                        }
                        return 3;
                    };
                    return rank(perCacheSubmitStatus[a.original.id]) - rank(perCacheSubmitStatus[b.original.id]);
                },
            },
            {
                accessorKey: 'gc_code',
                header: 'GC',
                cell: info => <strong>{info.getValue() as string}</strong>,
            },
            {
                id: 'log_type',
                header: 'Log',
                cell: ({ row }) => {
                    const gc = row.original;
                    const disabled = perCacheSubmitStatus[gc.id] === 'ok';
                    const current = perCacheLogType[gc.id] ?? logType;
                    return (
                        <select
                            className='theia-select'
                            value={current}
                            onChange={e => onToggleLogType(gc.id, e.target.value as LogTypeValue)}
                            disabled={disabled}
                            style={{ fontSize: 12 }}
                        >
                            <option value='found'>{typeLabel('found')}</option>
                            <option value='dnf'>{typeLabel('dnf')}</option>
                            <option value='note'>{typeLabel('note')}</option>
                        </select>
                    );
                },
                enableSorting: false,
            },
            {
                accessorKey: 'name',
                header: 'Nom',
                cell: info => (
                    <div style={{ maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={info.getValue() as string}>
                        {info.getValue() as string}
                    </div>
                ),
            },
            {
                accessorKey: 'cache_type',
                header: 'Type',
                cell: info => {
                    const type = (info.getValue() as string | undefined) || '';
                    if (!type) {
                        return <span style={{ opacity: 0.7 }}>—</span>;
                    }
                    return (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <GeocacheIcon type={type} size={18} showLabel={false} />
                            <span style={{ fontSize: 12, opacity: 0.85, whiteSpace: 'nowrap' }}>{type}</span>
                        </div>
                    );
                },
                sortingFn: 'alphanumeric',
            },
            {
                id: 'placed_at',
                header: 'Posée',
                accessorFn: row => getPlacedTs(row.placed_at),
                cell: ({ row }) => <span style={{ fontSize: 12, opacity: 0.85 }}>{formatPlaced(row.original.placed_at)}</span>,
            },
            {
                accessorKey: 'favorites_count',
                header: 'PF',
                cell: info => <span style={{ fontSize: 12 }}>{typeof info.getValue() === 'number' ? (info.getValue() as number) : '—'}</span>,
            },
            {
                id: 'pf_pct',
                header: '%PF',
                accessorFn: row => getPct(row.favorites_count, row.logs_count),
                cell: ({ row }) => {
                    const pct = getPct(row.original.favorites_count, row.original.logs_count);
                    return <span style={{ fontSize: 12, opacity: 0.85 }}>{typeof pct === 'number' ? `${pct.toFixed(1)}%` : '—'}</span>;
                },
            },
            {
                id: 'fav',
                header: 'Donner PF',
                cell: ({ row }) => {
                    const gc = row.original;
                    const currentLogType = perCacheLogType[gc.id] ?? logType;
                    const isChecked = perCacheFavorite[gc.id] === true;
                    const disabled = currentLogType !== 'found' || perCacheSubmitStatus[gc.id] === 'ok' || (!isChecked && remainingFavoritePoints <= 0);
                    return (
                        <input
                            type='checkbox'
                            checked={isChecked}
                            onChange={e => onToggleFavorite(gc.id, e.target.checked)}
                            disabled={disabled}
                            title={!isChecked && remainingFavoritePoints <= 0 ? 'Plus de PF disponibles' : ''}
                        />
                    );
                },
                enableSorting: false,
            },
        ];
    }, [logType, perCacheLogType, perCacheFavorite, perCacheSubmitStatus, perCacheSubmitReference, onToggleFavorite, onToggleLogType]);

    const table = useReactTable({
        data,
        columns,
        state: { sorting },
        onSortingChange: setSorting,
        getCoreRowModel: getCoreRowModel(),
        getSortedRowModel: getSortedRowModel(),
    });

    return (
        <div style={{ border: '1px solid var(--theia-panel-border)', borderRadius: 6, overflow: 'hidden' }}>
            <div style={{ padding: '6px 10px', fontSize: 12, fontWeight: 700, background: 'var(--theia-editor-background)' }}>
                Géocaches
            </div>
            <div style={{ overflow: 'auto', maxHeight }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead>
                        {table.getHeaderGroups().map(headerGroup => (
                            <tr key={headerGroup.id}>
                                {headerGroup.headers.map(header => (
                                    <th
                                        key={header.id}
                                        onClick={header.column.getToggleSortingHandler()}
                                        style={{
                                            textAlign: 'left',
                                            padding: '6px 8px',
                                            borderTop: '1px solid var(--theia-panel-border)',
                                            borderBottom: '1px solid var(--theia-panel-border)',
                                            background: 'var(--theia-editor-background)',
                                            position: 'sticky',
                                            top: 0,
                                            zIndex: 1,
                                            cursor: header.column.getCanSort() ? 'pointer' : 'default',
                                            whiteSpace: 'nowrap'
                                        }}
                                    >
                                        {flexRender(header.column.columnDef.header, header.getContext())}
                                        {header.column.getIsSorted() === 'asc' && <span style={{ marginLeft: 6 }}>▲</span>}
                                        {header.column.getIsSorted() === 'desc' && <span style={{ marginLeft: 6 }}>▼</span>}
                                    </th>
                                ))}
                            </tr>
                        ))}
                    </thead>
                    <tbody>
                        {table.getRowModel().rows.map(row => (
                            <tr key={row.id}>
                                {row.getVisibleCells().map(cell => (
                                    <td key={cell.id} style={{ padding: '6px 8px', borderBottom: '1px solid var(--theia-panel-border)', verticalAlign: 'middle' }}>
                                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                    </td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

@injectable()
export class GeocacheLogEditorWidget extends ReactWidget {
    static readonly ID = 'geocache.logEditor.widget';

    protected readonly legacyLogHistoryLocalStorageKey = 'geoApp.logs.history.v1';
    protected readonly logHistoryStorageKey = 'geoApp.logs.history.v2';
    protected readonly logHistoryMaxItemsPreferenceKey = 'geoApp.logs.history.maxItems';

    protected backendBaseUrl = 'http://localhost:8000';

    protected geocacheIds: number[] = [];
    protected geocaches: GeocacheListItem[] = [];
    protected isLoading = false;

    protected logDate = new Date().toISOString().slice(0, 10);
    protected logType: LogTypeValue = 'found';

    protected useSameTextForAll = true;
    protected globalText = '';
    protected perCacheText: Record<number, string> = {};
    protected perCacheLogType: Record<number, LogTypeValue> = {};
    protected perCacheFavorite: Record<number, boolean> = {};

    protected globalImages: SelectedLogImage[] = [];
    protected perCacheImages: Record<number, SelectedLogImage[]> = {};

    protected isSubmitting = false;
    protected lastSubmitSummary: { ok: number; failed: number } | undefined;
    protected perCacheSubmitStatus: Record<number, SubmissionStatus> = {};
    protected perCacheSubmitReference: Record<number, string | undefined> = {};

    protected globalTextArea: HTMLTextAreaElement | null = null;
    protected perCacheTextAreas: Record<number, HTMLTextAreaElement | null> = {};
    protected activeEditor: { type: 'global' } | { type: 'per-cache'; geocacheId: number } | undefined;

    protected pendingSelection:
        | { editor: { type: 'global' } | { type: 'per-cache'; geocacheId: number }; start: number; end: number }
        | undefined;

    protected logHistory: LogHistoryEntry[] = [];
    protected logHistoryCursor: number = -1;
    protected isLoadingHistory = false;

    protected totalFavoritePoints: number = 0;
    protected isFetchingFavoritePoints = false;
    protected userFindsCount: number = 0;

    protected readonly logPatternsStorageKey = 'geoApp.logs.patterns.v1';
    protected customPatterns: LogTextPattern[] = [];
    protected isLoadingPatterns = false;
    protected showPatternManager = false;
    protected editingPattern: LogTextPattern | null = null;
    protected patternNameInput = '';
    protected patternContentInput = '';

    protected patternAutocompleteOpen = false;
    protected patternAutocompleteSuggestions: PatternSuggestion[] = [];
    protected patternAutocompleteActiveIndex = 0;
    protected patternAutocompleteReplaceRange: { start: number; end: number } | null = null;
    protected patternAutocompleteTargetGeocacheId: number | null = null;
    protected patternAutocompletePosition: { top: number; left: number } | null = null;

    protected historyDropdownOpen = false;

    protected aiKeywords = '';
    protected aiCustomInstructions = '';
    protected aiExampleLogs = '';
    protected isGeneratingAi = false;
    protected showAiPanel = false;

    constructor(
        @inject(MessageService) protected readonly messages: MessageService,
        @inject(LanguageModelRegistry) protected readonly languageModelRegistry: LanguageModelRegistry,
        @inject(LanguageModelService) protected readonly languageModelService: LanguageModelService,
        @inject(StorageService) protected readonly storageService: StorageService,
        @inject(PreferenceService) protected readonly preferenceService: PreferenceService,
    ) {
        super();
        this.title.label = 'Logs';
        this.title.caption = 'Édition de logs';
        this.title.closable = true;
        this.title.iconClass = 'fa fa-pen';
        this.addClass('theia-geocache-log-editor-widget');
    }

    protected getLogHistoryMaxItems(): number {
        const raw = this.preferenceService.get<number>(this.logHistoryMaxItemsPreferenceKey, 10);
        const value = typeof raw === 'number' && isFinite(raw) ? Math.floor(raw) : 10;
        return Math.max(1, Math.min(50, value));
    }


    protected readLegacyLocalStorageHistory(): LogHistoryEntry[] {
        try {
            if (typeof window === 'undefined' || !window.localStorage) {
                return [];
            }
            const raw = window.localStorage.getItem(this.legacyLogHistoryLocalStorageKey);
            if (!raw) {
                return [];
            }
            const parsed = JSON.parse(raw);
            if (!Array.isArray(parsed)) {
                return [];
            }
            return (parsed as any[])
                .filter(x => x && typeof x === 'object')
                .map((x: any): LogHistoryEntry => ({
                    id: typeof x.id === 'string' ? x.id : this.generateId(),
                    createdAt: typeof x.createdAt === 'string' ? x.createdAt : new Date().toISOString(),
                    logDate: typeof x.logDate === 'string' ? x.logDate : new Date().toISOString().slice(0, 10),
                    useSameTextForAll: x.useSameTextForAll === true,
                    globalText: typeof x.globalText === 'string' ? x.globalText : '',
                    perCacheText: (x.perCacheText && typeof x.perCacheText === 'object') ? x.perCacheText as Record<number, string> : {},
                    logType: x.logType === 'found' || x.logType === 'dnf' || x.logType === 'note' ? x.logType : 'found',
                    perCacheLogType: (x.perCacheLogType && typeof x.perCacheLogType === 'object') ? x.perCacheLogType as Record<number, LogTypeValue> : {},
                    perCacheFavorite: (x.perCacheFavorite && typeof x.perCacheFavorite === 'object') ? x.perCacheFavorite as Record<number, boolean> : {},
                }));
        } catch {
            return [];
        }
    }

    protected async refreshLogHistory(): Promise<void> {
        this.isLoadingHistory = true;
        this.logHistoryCursor = -1;
        this.update();

        let stored = await this.storageService.getData<LogHistoryEntry[]>(this.logHistoryStorageKey, []);
        if (!Array.isArray(stored)) {
            stored = [];
        }

        if (stored.length === 0) {
            const legacy = this.readLegacyLocalStorageHistory();
            if (legacy.length > 0) {
                stored = legacy;
                await this.storageService.setData(this.logHistoryStorageKey, stored);
            }
        }

        this.logHistory = stored;
        this.isLoadingHistory = false;
        this.update();
    }

    protected async saveCurrentStateToHistory(): Promise<void> {
        const entry: LogHistoryEntry = {
            id: this.generateId(),
            createdAt: new Date().toISOString(),
            logDate: this.logDate,
            useSameTextForAll: this.useSameTextForAll,
            globalText: this.globalText,
            perCacheText: { ...this.perCacheText },
            logType: this.logType,
            perCacheLogType: { ...this.perCacheLogType },
            perCacheFavorite: { ...this.perCacheFavorite },
        };

        const maxItems = this.getLogHistoryMaxItems();
        const next = [entry, ...this.logHistory].slice(0, maxItems);
        this.logHistory = next;
        await this.storageService.setData(this.logHistoryStorageKey, next);
        this.logHistoryCursor = -1;
        this.update();
    }

    protected applyHistoryEntry(entry: LogHistoryEntry): void {
        const safeLogType = entry.logType === 'found' || entry.logType === 'dnf' || entry.logType === 'note' ? entry.logType : this.logType;

        const perCacheValues = entry.perCacheText && typeof entry.perCacheText === 'object'
            ? entry.perCacheText as Record<number, string>
            : {};

        const perCacheLogTypeValues = entry.perCacheLogType && typeof entry.perCacheLogType === 'object'
            ? entry.perCacheLogType as Record<number, LogTypeValue>
            : {};

        const perCacheFavoriteValues = entry.perCacheFavorite && typeof entry.perCacheFavorite === 'object'
            ? entry.perCacheFavorite as Record<number, boolean>
            : {};

        this.logDate = entry.logDate;
        this.useSameTextForAll = entry.useSameTextForAll ?? false;
        this.globalText = entry.globalText ?? '';
        this.perCacheText = perCacheValues;
        this.logType = safeLogType;
        this.perCacheLogType = perCacheLogTypeValues;
        this.perCacheFavorite = perCacheFavoriteValues;

        this.update();
    }

    protected applyHistoryTextOnly(entry: LogHistoryEntry): void {
        if (this.useSameTextForAll) {
            this.globalText = entry.globalText ?? '';
        } else {
            const perCacheValues = entry.perCacheText && typeof entry.perCacheText === 'object'
                ? entry.perCacheText as Record<number, string>
                : {};
            this.perCacheText = perCacheValues;
        }
        this.historyDropdownOpen = false;
        this.update();
    }

    protected navigateHistory(delta: number): void {
        if (this.logHistory.length === 0) {
            return;
        }

        let nextCursor: number;
        if (this.logHistoryCursor < 0) {
            if (delta <= 0) {
                return;
            }
            nextCursor = 0;
        } else {
            nextCursor = this.logHistoryCursor + delta;
        }

        nextCursor = Math.max(0, Math.min(this.logHistory.length - 1, nextCursor));
        this.logHistoryCursor = nextCursor;
        this.applyHistoryEntry(this.logHistory[nextCursor]);
    }

    protected escapeHtml(value: string): string {
        return (value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    protected sanitizeUrl(url: string): string | undefined {
        const trimmed = (url || '').trim();
        if (!trimmed) {
            return undefined;
        }
        if (/^https?:\/\//i.test(trimmed)) {
            return trimmed;
        }
        return undefined;
    }

    protected scheduleRestoreSelection(
        editor: { type: 'global' } | { type: 'per-cache'; geocacheId: number },
        start: number,
        end: number,
    ): void {
        this.pendingSelection = { editor, start, end };
        setTimeout(() => {
            const pending = this.pendingSelection;
            if (!pending) {
                return;
            }
            const ta = this.getEditorTextArea(pending.editor);
            if (!ta) {
                return;
            }
            try {
                const safeStart = Math.max(0, Math.min(pending.start, ta.value.length));
                const safeEnd = Math.max(0, Math.min(pending.end, ta.value.length));
                ta.setSelectionRange(safeStart, safeEnd);
            } catch {
                // ignore
            }
        }, 0);
    }

    protected renderInlineMarkdown(text: string, keyPrefix: string): React.ReactNode[] {
        const nodes: React.ReactNode[] = [];
        let remaining = text || '';
        let idx = 0;

        const pushText = (t: string) => {
            if (t) {
                nodes.push(<React.Fragment key={`${keyPrefix}-t-${idx++}`}>{t}</React.Fragment>);
            }
        };

        while (remaining.length > 0) {
            const candidates: Array<{ kind: 'code' | 'bold' | 'italic' | 'link'; pos: number }> = [];
            const codePos = remaining.indexOf('`');
            if (codePos >= 0) candidates.push({ kind: 'code', pos: codePos });
            const boldPos = remaining.indexOf('**');
            if (boldPos >= 0) candidates.push({ kind: 'bold', pos: boldPos });
            const italicPos = remaining.indexOf('*');
            if (italicPos >= 0) candidates.push({ kind: 'italic', pos: italicPos });
            const linkPos = remaining.indexOf('[');
            if (linkPos >= 0) candidates.push({ kind: 'link', pos: linkPos });

            if (candidates.length === 0) {
                pushText(remaining);
                break;
            }

            candidates.sort((a, b) => a.pos - b.pos);
            const next = candidates[0];
            if (next.pos > 0) {
                pushText(remaining.slice(0, next.pos));
                remaining = remaining.slice(next.pos);
            }

            if (next.kind === 'code' && remaining.startsWith('`')) {
                const end = remaining.indexOf('`', 1);
                if (end > 0) {
                    const content = remaining.slice(1, end);
                    nodes.push(<code key={`${keyPrefix}-c-${idx++}`}>{content}</code>);
                    remaining = remaining.slice(end + 1);
                    continue;
                }
            }

            if (next.kind === 'bold' && remaining.startsWith('**')) {
                const end = remaining.indexOf('**', 2);
                if (end > 1) {
                    const content = remaining.slice(2, end);
                    nodes.push(<strong key={`${keyPrefix}-b-${idx++}`}>{content}</strong>);
                    remaining = remaining.slice(end + 2);
                    continue;
                }
            }

            if (next.kind === 'italic' && remaining.startsWith('*') && !remaining.startsWith('**')) {
                const end = remaining.indexOf('*', 1);
                if (end > 0) {
                    const content = remaining.slice(1, end);
                    nodes.push(<em key={`${keyPrefix}-i-${idx++}`}>{content}</em>);
                    remaining = remaining.slice(end + 1);
                    continue;
                }
            }

            if (next.kind === 'link' && remaining.startsWith('[')) {
                const closeBracket = remaining.indexOf(']');
                if (closeBracket > 0 && remaining[closeBracket + 1] === '(') {
                    const closeParen = remaining.indexOf(')', closeBracket + 2);
                    if (closeParen > closeBracket + 2) {
                        const label = remaining.slice(1, closeBracket);
                        const url = remaining.slice(closeBracket + 2, closeParen);
                        const safeUrl = this.sanitizeUrl(url);
                        if (safeUrl) {
                            nodes.push(
                                <a
                                    key={`${keyPrefix}-l-${idx++}`}
                                    href={safeUrl}
                                    target='_blank'
                                    rel='noreferrer'
                                    style={{ color: 'var(--theia-textLink-foreground)' }}
                                >
                                    {label}
                                </a>
                            );
                        } else {
                            nodes.push(<React.Fragment key={`${keyPrefix}-l-${idx++}`}>{label} ({url})</React.Fragment>);
                        }
                        remaining = remaining.slice(closeParen + 1);
                        continue;
                    }
                }
            }

            pushText(remaining.slice(0, 1));
            remaining = remaining.slice(1);
        }

        return nodes;
    }

    protected renderMarkdown(text: string, keyPrefix: string): React.ReactNode {
        const lines = (text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
        const blocks: React.ReactNode[] = [];
        let i = 0;

        const pushParagraph = (paragraphLines: string[], key: string) => {
            const joined = paragraphLines.join('\n');
            const parts = joined.split('\n');
            blocks.push(
                <p key={key} style={{ margin: '6px 0', whiteSpace: 'pre-wrap' }}>
                    {parts.map((p, pi) => (
                        <React.Fragment key={`${key}-p-${pi}`}>
                            {this.renderInlineMarkdown(p, `${key}-in-${pi}`)}
                            {pi < parts.length - 1 ? <br /> : null}
                        </React.Fragment>
                    ))}
                </p>
            );
        };

        while (i < lines.length) {
            const raw = lines[i];
            const line = raw ?? '';

            if (/^```/.test(line.trim())) {
                const start = i;
                i += 1;
                const codeLines: string[] = [];
                while (i < lines.length && !/^```/.test((lines[i] ?? '').trim())) {
                    codeLines.push(lines[i] ?? '');
                    i += 1;
                }
                if (i < lines.length) {
                    i += 1;
                }
                const code = codeLines.join('\n');
                blocks.push(
                    <pre
                        key={`${keyPrefix}-code-${start}`}
                        style={{
                            margin: '8px 0',
                            padding: 10,
                            borderRadius: 6,
                            border: '1px solid var(--theia-panel-border)',
                            background: 'var(--theia-editor-background)',
                            overflow: 'auto',
                            fontSize: 12,
                        }}
                    >
                        <code>{code}</code>
                    </pre>
                );
                continue;
            }

            const hMatch = /^(#{1,3})\s+(.*)$/.exec(line);
            if (hMatch) {
                const level = hMatch[1].length;
                const content = hMatch[2] || '';
                const Tag = (level === 1 ? 'h1' : level === 2 ? 'h2' : 'h3') as any;
                blocks.push(
                    <Tag key={`${keyPrefix}-h-${i}`} style={{ margin: '10px 0 6px 0' }}>
                        {this.renderInlineMarkdown(content, `${keyPrefix}-h-in-${i}`)}
                    </Tag>
                );
                i += 1;
                continue;
            }

            if (/^>\s+/.test(line)) {
                const quoteLines: string[] = [];
                const start = i;
                while (i < lines.length && /^>\s+/.test(lines[i] ?? '')) {
                    quoteLines.push((lines[i] ?? '').replace(/^>\s+/, ''));
                    i += 1;
                }
                blocks.push(
                    <blockquote
                        key={`${keyPrefix}-q-${start}`}
                        style={{
                            margin: '8px 0',
                            paddingLeft: 10,
                            borderLeft: '3px solid var(--theia-panel-border)',
                            opacity: 0.9,
                        }}
                    >
                        {this.renderMarkdown(quoteLines.join('\n'), `${keyPrefix}-q-inner-${start}`)}
                    </blockquote>
                );
                continue;
            }

            if (/^\s*[-*]\s+/.test(line)) {
                const items: string[] = [];
                const start = i;
                while (i < lines.length && /^\s*[-*]\s+/.test(lines[i] ?? '')) {
                    items.push((lines[i] ?? '').replace(/^\s*[-*]\s+/, ''));
                    i += 1;
                }
                blocks.push(
                    <ul key={`${keyPrefix}-ul-${start}`} style={{ margin: '6px 0 6px 20px' }}>
                        {items.map((it, ii) => (
                            <li key={`${keyPrefix}-ul-${start}-${ii}`}>
                                {this.renderInlineMarkdown(it, `${keyPrefix}-ul-in-${start}-${ii}`)}
                            </li>
                        ))}
                    </ul>
                );
                continue;
            }

            if (!line.trim()) {
                i += 1;
                continue;
            }

            const paragraphLines: string[] = [];
            const start = i;
            while (
                i < lines.length &&
                (lines[i] ?? '').trim() &&
                !/^(#{1,3})\s+/.test(lines[i] ?? '') &&
                !/^```/.test((lines[i] ?? '').trim()) &&
                !/^>\s+/.test(lines[i] ?? '') &&
                !/^\s*[-*]\s+/.test(lines[i] ?? '')
            ) {
                paragraphLines.push(lines[i] ?? '');
                i += 1;
            }
            pushParagraph(paragraphLines, `${keyPrefix}-p-${start}`);
        }

        return <div style={{ display: 'grid', gap: 4 }}>{blocks}</div>;
    }

    protected applyEditorValue(editor: { type: 'global' } | { type: 'per-cache'; geocacheId: number }, nextValue: string): void {
        if (editor.type === 'global') {
            this.globalText = nextValue;
        } else {
            this.perCacheText = { ...this.perCacheText, [editor.geocacheId]: nextValue };
        }
    }

    protected getEditorValue(editor: { type: 'global' } | { type: 'per-cache'; geocacheId: number }): string {
        return editor.type === 'global' ? this.globalText : (this.perCacheText[editor.geocacheId] ?? '');
    }

    protected getEditorTextArea(editor: { type: 'global' } | { type: 'per-cache'; geocacheId: number }): HTMLTextAreaElement | null {
        return editor.type === 'global' ? this.globalTextArea : (this.perCacheTextAreas[editor.geocacheId] ?? null);
    }

    protected applyMarkdownWrap(before: string, after: string, placeholder: string): void {
        const editor = this.activeEditor;
        if (!editor) {
            this.messages.warn('Clique dans une zone de texte pour appliquer le Markdown.');
            return;
        }

        const ta = this.getEditorTextArea(editor);
        const value = this.getEditorValue(editor);
        const start = ta ? ta.selectionStart : value.length;
        const end = ta ? ta.selectionEnd : value.length;
        const hasSelection = start !== end;
        const selected = value.slice(start, end);
        const insert = hasSelection ? selected : placeholder;
        const nextValue = value.slice(0, start) + before + insert + after + value.slice(end);

        this.applyEditorValue(editor, nextValue);
        this.update();

        setTimeout(() => {
            const nextTa = this.getEditorTextArea(editor);
            if (!nextTa) {
                return;
            }
            nextTa.focus();
            if (!hasSelection) {
                const selStart = start + before.length;
                nextTa.setSelectionRange(selStart, selStart + insert.length);
            } else {
                const selStart = start + before.length;
                const selEnd = selStart + insert.length;
                nextTa.setSelectionRange(selStart, selEnd);
            }
        }, 0);
    }

    protected applyMarkdownPrefix(prefix: string, placeholder: string): void {
        const editor = this.activeEditor;
        if (!editor) {
            this.messages.warn('Clique dans une zone de texte pour appliquer le Markdown.');
            return;
        }

        const ta = this.getEditorTextArea(editor);
        const value = this.getEditorValue(editor);
        const start = ta ? ta.selectionStart : value.length;
        const end = ta ? ta.selectionEnd : value.length;

        const lineStart = value.lastIndexOf('\n', start - 1) + 1;
        const lineEnd = value.indexOf('\n', end);
        const safeLineEnd = lineEnd === -1 ? value.length : lineEnd;

        const selectedBlock = value.slice(lineStart, safeLineEnd);
        const isEmpty = !selectedBlock.trim();
        const toProcess = isEmpty ? placeholder : selectedBlock;

        const processed = toProcess
            .split('\n')
            .map(l => (l.trim() ? `${prefix}${l}` : l))
            .join('\n');

        const nextValue = value.slice(0, lineStart) + processed + value.slice(safeLineEnd);
        this.applyEditorValue(editor, nextValue);
        this.update();

        setTimeout(() => {
            const nextTa = this.getEditorTextArea(editor);
            if (!nextTa) {
                return;
            }
            nextTa.focus();
            const selStart = lineStart + prefix.length;
            if (isEmpty) {
                nextTa.setSelectionRange(selStart, selStart + placeholder.length);
            } else {
                nextTa.setSelectionRange(lineStart, lineStart + processed.length);
            }
        }, 0);
    }

    setContext(params: { geocacheIds: number[]; title?: string }): void {
        const ids = (params.geocacheIds || []).filter((v): v is number => typeof v === 'number');
        this.geocacheIds = Array.from(new Set(ids));
        this.geocaches = [];
        this.perCacheText = {};
        this.perCacheLogType = {};
        this.perCacheFavorite = {};
        this.perCacheSubmitStatus = {};
        this.perCacheSubmitReference = {};
        this.globalImages = [];
        this.perCacheImages = {};

        if (params.title) {
            this.title.label = params.title;
        } else if (this.geocacheIds.length === 1) {
            this.title.label = 'Log - 1 géocache';
        } else {
            this.title.label = `Log - ${this.geocacheIds.length} géocaches`;
        }

        void this.loadGeocaches();
        void this.refreshLogHistory();
        void this.fetchFavoritePoints();
        void this.loadPatterns();
        this.update();
    }

    protected toggleUseSameTextForAll(checked: boolean): void {
        if (this.useSameTextForAll && !checked) {
            const nextPerCacheText: Record<number, string> = { ...this.perCacheText };
            const nextPerCacheImages: Record<number, SelectedLogImage[]> = { ...this.perCacheImages };

            const globalText = this.globalText;
            const globalImages = this.globalImages;

            for (const gc of this.geocaches) {
                const existingText = nextPerCacheText[gc.id] ?? '';
                if (!existingText && globalText) {
                    nextPerCacheText[gc.id] = globalText;
                }

                const existingImages = nextPerCacheImages[gc.id] ?? [];
                const existingKeys = new Set(existingImages.map(i => `${i.file.name}:${i.file.size}:${i.file.lastModified}`));
                const additions = globalImages
                    .filter(i => !existingKeys.has(`${i.file.name}:${i.file.size}:${i.file.lastModified}`))
                    .map(i => ({
                        id: this.generateId(),
                        file: i.file,
                        status: 'pending' as ImageUploadStatus,
                    }));

                if (additions.length > 0) {
                    nextPerCacheImages[gc.id] = [...existingImages, ...additions];
                } else {
                    nextPerCacheImages[gc.id] = existingImages;
                }
            }

            this.perCacheText = nextPerCacheText;
            this.perCacheImages = nextPerCacheImages;
        }

        this.useSameTextForAll = checked;
        this.update();
    }

    protected generateId(): string {
        try {
            const w: any = window as any;
            if (w?.crypto?.randomUUID) {
                return w.crypto.randomUUID();
            }
        } catch {
        }
        return `img-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    }

    protected addSelectedImages(files: FileList | File[], target: 'global' | { geocacheId: number }): void {
        const list = Array.from(files as any as File[]).filter(f => f instanceof File);
        if (list.length === 0) {
            return;
        }

        const mapped: SelectedLogImage[] = list.map(file => ({
            id: this.generateId(),
            file,
            status: 'pending',
        }));

        if (target === 'global') {
            this.globalImages = [...this.globalImages, ...mapped];
        } else {
            const current = this.perCacheImages[target.geocacheId] ?? [];
            this.perCacheImages = { ...this.perCacheImages, [target.geocacheId]: [...current, ...mapped] };
        }
        this.update();
    }

    protected removeSelectedImage(target: 'global' | { geocacheId: number }, imageId: string): void {
        if (target === 'global') {
            this.globalImages = this.globalImages.filter(img => img.id !== imageId);
        } else {
            const current = this.perCacheImages[target.geocacheId] ?? [];
            this.perCacheImages = { ...this.perCacheImages, [target.geocacheId]: current.filter(img => img.id !== imageId) };
        }
        this.update();
    }

    protected getImagesForGeocacheId(geocacheId: number): SelectedLogImage[] {
        return this.useSameTextForAll ? this.globalImages : (this.perCacheImages[geocacheId] ?? []);
    }

    protected setImagesForGeocacheId(geocacheId: number, images: SelectedLogImage[]): void {
        if (this.useSameTextForAll) {
            this.globalImages = images;
        } else {
            this.perCacheImages = { ...this.perCacheImages, [geocacheId]: images };
        }
        this.update();
    }

    protected async uploadOneLogImage(geocacheId: number, img: SelectedLogImage): Promise<SelectedLogImage> {
        try {
            const form = new FormData();
            form.append('image_file', img.file, img.file.name);

            const res = await fetch(`${this.backendBaseUrl}/api/geocaches/${geocacheId}/logs/images/upload`, {
                method: 'POST',
                credentials: 'include',
                body: form,
            });

            let body: any = undefined;
            try {
                body = await res.json();
            } catch {
                body = undefined;
            }

            if (!res.ok) {
                const detail = body?.error ? `: ${body.error}` : '';
                return { ...img, status: 'failed', error: `HTTP ${res.status}${detail}` };
            }

            const guid = typeof body?.image_guid === 'string' ? body.image_guid : undefined;
            if (!guid) {
                return { ...img, status: 'failed', error: 'Missing image_guid' };
            }

            return { ...img, status: 'ok', imageGuid: guid, error: undefined };
        } catch (e) {
            console.error('[GeocacheLogEditorWidget] uploadOneLogImage error', e);
            return { ...img, status: 'failed', error: 'Erreur réseau/backend' };
        }
    }

    protected async uploadImagesForGeocache(geocacheId: number): Promise<string[]> {
        const current = this.getImagesForGeocacheId(geocacheId);
        if (current.length === 0) {
            return [];
        }

        let working = [...current];
        if (this.useSameTextForAll) {
            working = working.map(img => ({
                ...img,
                status: 'pending',
                imageGuid: undefined,
                error: undefined,
            }));
            this.setImagesForGeocacheId(geocacheId, working);
        }
        for (let i = 0; i < working.length; i += 1) {
            const img = working[i];
            if (img.status === 'ok' && img.imageGuid) {
                continue;
            }
            working[i] = { ...img, status: 'uploading', error: undefined };
            this.setImagesForGeocacheId(geocacheId, working);
            const uploaded = await this.uploadOneLogImage(geocacheId, working[i]);
            working[i] = uploaded;
            this.setImagesForGeocacheId(geocacheId, working);
        }

        return working.filter(x => x.status === 'ok' && typeof x.imageGuid === 'string').map(x => x.imageGuid as string);
    }

    protected renderImagesSection(target: 'global' | { geocacheId: number }, disabled: boolean): React.ReactNode {
        const images = target === 'global' ? this.globalImages : (this.perCacheImages[target.geocacheId] ?? []);
        const title = target === 'global' ? 'Photos (appliquées à toutes les géocaches)' : 'Photos';

        const onDrop = (e: React.DragEvent) => {
            e.preventDefault();
            if (disabled) {
                return;
            }
            const files = e.dataTransfer?.files;
            if (files && files.length > 0) {
                this.addSelectedImages(files, target === 'global' ? 'global' : { geocacheId: target.geocacheId });
            }
        };

        const onDragOver = (e: React.DragEvent) => {
            e.preventDefault();
        };

        return (
            <div style={{ border: '1px solid var(--theia-panel-border)', borderRadius: 6, padding: 10, background: 'var(--theia-editor-background)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
                    <div style={{ fontWeight: 700 }}>{title}</div>
                    <label style={{ fontSize: 12, opacity: disabled ? 0.6 : 0.9, cursor: disabled ? 'not-allowed' : 'pointer' }}>
                        <input
                            type='file'
                            accept='image/png,image/jpeg,image/jpg,image/webp'
                            multiple
                            disabled={disabled}
                            style={{ display: 'none' }}
                            onChange={e => {
                                const files = e.currentTarget.files;
                                if (files && files.length > 0) {
                                    this.addSelectedImages(files, target === 'global' ? 'global' : { geocacheId: target.geocacheId });
                                }
                                e.currentTarget.value = '';
                            }}
                        />
                        + Ajouter…
                    </label>
                </div>

                <div
                    onDrop={onDrop}
                    onDragOver={onDragOver}
                    style={{
                        border: '1px dashed var(--theia-panel-border)',
                        borderRadius: 6,
                        padding: 10,
                        fontSize: 12,
                        opacity: disabled ? 0.6 : 0.9,
                        background: 'var(--theia-editor-background)',
                    }}
                >
                    Glisse-dépose tes images ici
                </div>

                {images.length === 0 ? (
                    <div style={{ marginTop: 8, fontSize: 12, opacity: 0.7 }}>Aucune photo</div>
                ) : (
                    <div style={{ marginTop: 8, display: 'grid', gap: 6 }}>
                        {images.map(img => (
                            <div key={img.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', fontSize: 12 }}>
                                <div style={{ minWidth: 0 }}>
                                    <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={img.file.name}>
                                        {img.file.name}
                                    </div>
                                    <div style={{ opacity: 0.8 }}>
                                        {img.status === 'pending' && '⏳ en attente'}
                                        {img.status === 'uploading' && '⬆️ upload…'}
                                        {img.status === 'ok' && `✅ ${img.imageGuid ?? 'ok'}`}
                                        {img.status === 'failed' && `⚠️ ${img.error ?? 'échec'}`}
                                    </div>
                                </div>
                                <button
                                    className='theia-button secondary'
                                    style={{ fontSize: 12, padding: '2px 10px' }}
                                    disabled={disabled || img.status === 'uploading'}
                                    onClick={() => this.removeSelectedImage(target === 'global' ? 'global' : { geocacheId: target.geocacheId }, img.id)}
                                    title='Retirer cette image'
                                >
                                    Supprimer
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        );
    }

    protected getRemainingFavoritePoints(): number {
        const usedCount = Object.values(this.perCacheFavorite).filter(v => v === true).length;
        return Math.max(0, this.totalFavoritePoints - usedCount);
    }

    protected async fetchFavoritePoints(): Promise<void> {
        if (this.isFetchingFavoritePoints) {
            return;
        }

        this.isFetchingFavoritePoints = true;
        this.update();

        try {
            const res = await fetch(`${this.backendBaseUrl}/api/auth/status`, { credentials: 'include' });
            if (!res.ok) {
                console.warn('[GeocacheLogEditorWidget] Failed to fetch auth status');
                return;
            }
            const authState = await res.json();
            const awardedPoints = authState?.user?.awarded_favorite_points;
            if (typeof awardedPoints === 'number') {
                this.totalFavoritePoints = awardedPoints;
            } else {
                this.totalFavoritePoints = 0;
            }
            const findsCount = authState?.user?.finds_count;
            if (typeof findsCount === 'number') {
                this.userFindsCount = findsCount;
            } else {
                this.userFindsCount = 0;
            }
        } catch (e) {
            console.error('[GeocacheLogEditorWidget] fetchFavoritePoints error', e);
            this.totalFavoritePoints = 0;
        } finally {
            this.isFetchingFavoritePoints = false;
            this.update();
        }
    }

    protected async loadGeocaches(): Promise<void> {
        if (!this.geocacheIds.length || this.isLoading) {
            return;
        }

        this.isLoading = true;
        this.update();

        try {
            const results = await Promise.all(this.geocacheIds.map(async (id) => {
                const res = await fetch(`${this.backendBaseUrl}/api/geocaches/${id}`, { credentials: 'include' });
                if (!res.ok) {
                    throw new Error(`HTTP ${res.status}`);
                }
                const data = await res.json();
                return {
                    id: data.id as number,
                    gc_code: (data.gc_code || '').toString(),
                    name: (data.name || '').toString(),
                    owner: (data.owner || '').toString() || undefined,
                    favorites_count: typeof data.favorites_count === 'number' ? (data.favorites_count as number) : undefined,
                    logs_count: typeof data.logs_count === 'number' ? (data.logs_count as number) : undefined,
                    placed_at: (data.placed_at ?? null) as string | null,
                    cache_type: (data.type || '').toString(),
                } as GeocacheListItem;
            }));

            this.geocaches = results;

            const nextTypes: Record<number, LogTypeValue> = { ...this.perCacheLogType };
            for (const gc of results) {
                const existing = nextTypes[gc.id];
                if (existing !== 'found' && existing !== 'dnf' && existing !== 'note') {
                    nextTypes[gc.id] = this.logType;
                }
            }
            this.perCacheLogType = nextTypes;

            const nextFav: Record<number, boolean> = { ...this.perCacheFavorite };
            for (const gc of results) {
                if (typeof nextFav[gc.id] !== 'boolean') {
                    nextFav[gc.id] = false;
                }
            }
            this.perCacheFavorite = nextFav;
        } catch (e) {
            console.error('[GeocacheLogEditorWidget] loadGeocaches error', e);
            this.messages.error('Impossible de charger la liste des géocaches.');
        } finally {
            this.isLoading = false;
            this.update();
        }
    }

    protected formatFavoritePercent(favoritesCount: number | undefined, logsCount: number | undefined): string {
        if (typeof favoritesCount !== 'number' || typeof logsCount !== 'number' || logsCount <= 0) {
            return '—';
        }
        const pct = (favoritesCount / logsCount) * 100;
        if (!isFinite(pct)) {
            return '—';
        }
        return `${pct.toFixed(1)}%`;
    }

    protected toggleFavoriteForGeocacheId(geocacheId: number, nextValue: boolean): void {
        const currentValue = this.perCacheFavorite[geocacheId] === true;
        
        if (nextValue && !currentValue) {
            const remaining = this.getRemainingFavoritePoints();
            if (remaining <= 0) {
                this.messages.warn('Plus de PF disponibles');
                return;
            }
        }
        
        this.perCacheFavorite = { ...this.perCacheFavorite, [geocacheId]: nextValue };
        this.update();
    }

    protected getBuiltinPatterns(): LogTextPattern[] {
        return [
            { id: 'builtin-date', name: 'date', content: '', isBuiltin: true },
            { id: 'builtin-cache_count', name: 'cache_count', content: '', isBuiltin: true },
            { id: 'builtin-cache_name', name: 'cache_name', content: '', isBuiltin: true },
            { id: 'builtin-cache_owner', name: 'cache_owner', content: '', isBuiltin: true },
            { id: 'builtin-gc_code', name: 'gc_code', content: '', isBuiltin: true },
        ];
    }

    protected getAllPatterns(): LogTextPattern[] {
        return [...this.getBuiltinPatterns(), ...this.customPatterns];
    }

    protected async loadPatterns(): Promise<void> {
        this.isLoadingPatterns = true;
        this.update();

        try {
            let stored = await this.storageService.getData<LogTextPattern[]>(this.logPatternsStorageKey, []);
            if (!Array.isArray(stored)) {
                stored = [];
            }
            this.customPatterns = stored.filter(p => p && typeof p === 'object' && typeof p.id === 'string' && typeof p.name === 'string');
        } catch (e) {
            console.error('[GeocacheLogEditorWidget] loadPatterns error', e);
            this.customPatterns = [];
        } finally {
            this.isLoadingPatterns = false;
            this.update();
        }
    }

    protected async savePatterns(): Promise<void> {
        try {
            await this.storageService.setData(this.logPatternsStorageKey, this.customPatterns);
        } catch (e) {
            console.error('[GeocacheLogEditorWidget] savePatterns error', e);
        }
    }

    protected addPattern(name: string, content: string): void {
        const trimmedName = name.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
        if (!trimmedName) {
            this.messages.warn('Le nom du pattern est invalide');
            return;
        }
        const existing = this.getAllPatterns().find(p => p.name === trimmedName);
        if (existing) {
            this.messages.warn(`Le pattern "@${trimmedName}" existe déjà`);
            return;
        }
        const newPattern: LogTextPattern = {
            id: this.generateId(),
            name: trimmedName,
            content: content.trim(),
            isBuiltin: false,
        };
        this.customPatterns = [...this.customPatterns, newPattern];
        void this.savePatterns();
        this.patternNameInput = '';
        this.patternContentInput = '';
        this.update();
    }

    protected updatePattern(patternId: string, name: string, content: string): void {
        const trimmedName = name.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
        if (!trimmedName) {
            this.messages.warn('Le nom du pattern est invalide');
            return;
        }
        const existing = this.getAllPatterns().find(p => p.name === trimmedName && p.id !== patternId);
        if (existing) {
            this.messages.warn(`Le pattern "@${trimmedName}" existe déjà`);
            return;
        }
        this.customPatterns = this.customPatterns.map(p =>
            p.id === patternId ? { ...p, name: trimmedName, content: content.trim() } : p
        );
        void this.savePatterns();
        this.editingPattern = null;
        this.patternNameInput = '';
        this.patternContentInput = '';
        this.update();
    }

    protected deletePattern(patternId: string): void {
        this.customPatterns = this.customPatterns.filter(p => p.id !== patternId);
        void this.savePatterns();
        this.update();
    }

    protected getCacheCountForIndex(geocacheIndex: number): number {
        const foundCountBefore = this.geocaches.slice(0, geocacheIndex).filter(gc => {
            const logType = this.perCacheLogType[gc.id] ?? this.logType;
            return logType === 'found';
        }).length;
        return this.userFindsCount + foundCountBefore + 1;
    }

    protected resolvePatternValue(patternName: string, geocacheId: number | null): string {
        const geocacheIndex = geocacheId !== null ? this.geocaches.findIndex(gc => gc.id === geocacheId) : -1;
        const geocache = geocacheIndex >= 0 ? this.geocaches[geocacheIndex] : null;

        switch (patternName) {
            case 'date': {
                const d = new Date(this.logDate);
                return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
            }
            case 'cache_count':
                if (geocacheIndex >= 0) {
                    return String(this.getCacheCountForIndex(geocacheIndex));
                }
                return String(this.userFindsCount + 1);
            case 'cache_name':
                return geocache?.name ?? '[cache_name]';
            case 'cache_owner':
                return geocache?.owner ?? '[cache_owner]';
            case 'gc_code':
                return geocache?.gc_code ?? '[gc_code]';
            default: {
                const custom = this.customPatterns.find(p => p.name === patternName);
                return custom?.content ?? `@${patternName}`;
            }
        }
    }

    protected resolveAllPatterns(text: string, geocacheId: number | null): string {
        const allPatternNames = this.getAllPatterns().map(p => p.name);
        let result = text;
        const regex = /@([a-zA-Z_][a-zA-Z0-9_]*)/g;
        result = result.replace(regex, (match, patternName) => {
            if (allPatternNames.includes(patternName)) {
                return this.resolvePatternValue(patternName, geocacheId);
            }
            return match;
        });
        return result;
    }

    protected getResolvedTextForGeocacheId(geocacheId: number): string {
        const rawText = this.getTextForGeocacheId(geocacheId);
        return this.resolveAllPatterns(rawText, geocacheId);
    }

    protected renderTextWithHighlightedPatterns(text: string, geocacheId: number | null, key: string): React.ReactNode {
        const allPatternNames = this.getAllPatterns().map(p => p.name);
        const regex = /@([a-zA-Z_][a-zA-Z0-9_]*)/g;
        const parts: React.ReactNode[] = [];
        let lastIndex = 0;
        let match: RegExpExecArray | null;
        let partIndex = 0;

        while ((match = regex.exec(text)) !== null) {
            const patternName = match[1];
            const isValidPattern = allPatternNames.includes(patternName);

            if (match.index > lastIndex) {
                parts.push(<span key={`${key}-text-${partIndex++}`}>{text.slice(lastIndex, match.index)}</span>);
            }

            if (isValidPattern) {
                const resolvedValue = this.resolvePatternValue(patternName, geocacheId);
                parts.push(
                    <span
                        key={`${key}-pattern-${partIndex++}`}
                        style={{
                            color: 'var(--theia-textLink-foreground)',
                            textDecoration: 'underline',
                            cursor: 'help'
                        }}
                        title={`${match[0]} → ${resolvedValue}`}
                    >
                        {match[0]}
                    </span>
                );
            } else {
                parts.push(<span key={`${key}-text-${partIndex++}`}>{match[0]}</span>);
            }

            lastIndex = regex.lastIndex;
        }

        if (lastIndex < text.length) {
            parts.push(<span key={`${key}-text-${partIndex++}`}>{text.slice(lastIndex)}</span>);
        }

        return parts.length > 0 ? parts : text;
    }

    protected renderTextareaWithOverlay(
        value: string,
        geocacheId: number | null,
        textareaProps: React.TextareaHTMLAttributes<HTMLTextAreaElement>,
        textareaRef: (el: HTMLTextAreaElement | null) => void,
        overlayKey: string
    ): React.ReactNode {
        const allPatternNames = this.getAllPatterns().map(p => p.name);
        const regex = /@([a-zA-Z_][a-zA-Z0-9_]*)/g;
        const parts: React.ReactNode[] = [];
        let lastIndex = 0;
        let match: RegExpExecArray | null;
        let partIndex = 0;

        while ((match = regex.exec(value)) !== null) {
            const patternName = match[1];
            const isValidPattern = allPatternNames.includes(patternName);

            if (match.index > lastIndex) {
                parts.push(<span key={`${overlayKey}-text-${partIndex++}`}>{value.slice(lastIndex, match.index)}</span>);
            }

            if (isValidPattern) {
                const resolvedValue = this.resolvePatternValue(patternName, geocacheId);
                parts.push(
                    <span
                        key={`${overlayKey}-pattern-${partIndex++}`}
                        style={{
                            backgroundColor: 'rgba(0, 122, 204, 0.15)',
                            color: 'var(--theia-textLink-foreground)',
                            borderRadius: 2
                        }}
                        title={`${match[0]} → ${resolvedValue}`}
                    >
                        {match[0]}
                    </span>
                );
            } else {
                parts.push(<span key={`${overlayKey}-text-${partIndex++}`}>{match[0]}</span>);
            }

            lastIndex = regex.lastIndex;
        }

        if (lastIndex < value.length) {
            parts.push(<span key={`${overlayKey}-text-${partIndex++}`}>{value.slice(lastIndex)}</span>);
        }

        const { onFocus, onBlur, style: textareaStyle, ...restTextareaProps } = textareaProps;

        const mergedTextareaStyle: React.CSSProperties = {
            ...textareaStyle,
            position: 'relative',
            backgroundColor: 'transparent',
            zIndex: 2,
            color: 'transparent',
            caretColor: 'var(--theia-editor-foreground)',
            border: 'none',
            outline: 'none',
            width: '100%'
        };

        const textareaMergedProps: React.TextareaHTMLAttributes<HTMLTextAreaElement> = {
            ...restTextareaProps,
            style: mergedTextareaStyle as React.CSSProperties & { [key: string]: string | number | undefined },
            onFocus: e => {
                onFocus?.(e);
            },
            onBlur: e => {
                onBlur?.(e);
            },
        };

        return (
            <div
                style={{
                    position: 'relative',
                    border: '1px solid var(--theia-panel-border)',
                    borderRadius: 3,
                    background: 'var(--theia-editor-background)'
                }}
            >
                <textarea
                    {...textareaMergedProps}
                    ref={textareaRef}
                />
                <div
                    style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        padding: textareaStyle?.padding || '6px 8px',
                        font: 'inherit',
                        fontSize: 'inherit',
                        fontFamily: 'inherit',
                        lineHeight: 'inherit',
                        whiteSpace: 'pre-wrap',
                        wordWrap: 'break-word',
                        overflow: 'hidden',
                        pointerEvents: 'none',
                        zIndex: 1,
                        color: 'var(--theia-editor-foreground)'
                    }}
                >
                    {parts.length > 0 ? parts : value}
                </div>
            </div>
        );
    }

    protected refreshPatternAutocomplete(value: string, textArea: HTMLTextAreaElement, geocacheId: number | null): void {
        const caret = textArea.selectionStart ?? value.length;
        const before = value.slice(0, caret);
        const tokenStart = findPatternTokenStart(before);

        if (tokenStart === null) {
            this.patternAutocompleteOpen = false;
            this.update();
            return;
        }

        const fragment = before.slice(tokenStart + 1);
        if (fragment.includes(' ') || fragment.includes('\n')) {
            this.patternAutocompleteOpen = false;
            this.update();
            return;
        }

        const prefix = fragment.toLowerCase();
        const suggestions: PatternSuggestion[] = [];

        for (const pattern of this.getAllPatterns()) {
            if (!prefix || pattern.name.startsWith(prefix) || pattern.name.includes(prefix)) {
                const resolvedValue = this.resolvePatternValue(pattern.name, geocacheId);
                suggestions.push({
                    id: pattern.id,
                    label: `@${pattern.name}`,
                    description: pattern.isBuiltin ? `→ ${resolvedValue}` : pattern.content.slice(0, 50),
                    insertText: `@${pattern.name}`,
                });
            }
        }

        if (suggestions.length === 0) {
            this.patternAutocompleteOpen = false;
            this.update();
            return;
        }

        const coords = getCaretCoordinates(textArea, tokenStart);
        this.patternAutocompletePosition = coords;
        this.patternAutocompleteReplaceRange = { start: tokenStart, end: caret };
        this.patternAutocompleteSuggestions = suggestions;
        this.patternAutocompleteActiveIndex = 0;
        this.patternAutocompleteTargetGeocacheId = geocacheId;
        this.patternAutocompleteOpen = true;
        this.update();
    }

    protected applyPatternSuggestion(suggestion: PatternSuggestion): void {
        const range = this.patternAutocompleteReplaceRange;
        if (!range) {
            return;
        }

        const geocacheId = this.patternAutocompleteTargetGeocacheId;

        if (geocacheId === null) {
            const current = this.globalText;
            const next = current.slice(0, range.start) + suggestion.insertText + current.slice(range.end);
            this.globalText = next;
            const newPos = range.start + suggestion.insertText.length;
            this.patternAutocompleteOpen = false;
            this.update();
            requestAnimationFrame(() => {
                if (this.globalTextArea) {
                    this.globalTextArea.focus();
                    this.globalTextArea.setSelectionRange(newPos, newPos);
                }
            });
        } else {
            const current = this.perCacheText[geocacheId] ?? '';
            const next = current.slice(0, range.start) + suggestion.insertText + current.slice(range.end);
            this.perCacheText = { ...this.perCacheText, [geocacheId]: next };
            const newPos = range.start + suggestion.insertText.length;
            this.patternAutocompleteOpen = false;
            this.update();
            requestAnimationFrame(() => {
                const textArea = this.perCacheTextAreas[geocacheId];
                if (textArea) {
                    textArea.focus();
                    textArea.setSelectionRange(newPos, newPos);
                }
            });
        }
    }

    protected handleTextAreaKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>, geocacheId: number | null): void {
        if (!this.patternAutocompleteOpen) {
            return;
        }

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            this.patternAutocompleteActiveIndex = Math.min(
                this.patternAutocompleteActiveIndex + 1,
                this.patternAutocompleteSuggestions.length - 1
            );
            this.update();
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            this.patternAutocompleteActiveIndex = Math.max(this.patternAutocompleteActiveIndex - 1, 0);
            this.update();
        } else if (e.key === 'Enter' || e.key === 'Tab') {
            const suggestion = this.patternAutocompleteSuggestions[this.patternAutocompleteActiveIndex];
            if (suggestion) {
                e.preventDefault();
                this.applyPatternSuggestion(suggestion);
            }
        } else if (e.key === 'Escape') {
            e.preventDefault();
            this.patternAutocompleteOpen = false;
            this.update();
        }
    }

    protected handleTextAreaBlur(): void {
        window.setTimeout(() => {
            this.patternAutocompleteOpen = false;
            this.update();
        }, 150);
    }

    protected setGlobalLogType(nextValue: LogTypeValue): void {
        this.logType = nextValue;
        const nextTypes: Record<number, LogTypeValue> = { ...this.perCacheLogType };
        for (const gc of this.geocaches) {
            nextTypes[gc.id] = nextValue;
        }
        this.perCacheLogType = nextTypes;
        this.update();
    }

    protected setLogTypeForGeocacheId(geocacheId: number, nextValue: LogTypeValue): void {
        const nextTypes: Record<number, LogTypeValue> = { ...this.perCacheLogType, [geocacheId]: nextValue };
        this.perCacheLogType = nextTypes;

        const values = this.geocaches.map(gc => nextTypes[gc.id] ?? this.logType);
        if (values.length > 0 && values.every(v => v === values[0])) {
            this.logType = values[0];
        }
        this.update();
    }

    protected getLogTypeForGeocacheId(geocacheId: number): LogTypeValue {
        return this.perCacheLogType[geocacheId] ?? this.logType;
    }

    protected isGeocacheSubmittedOk(geocacheId: number): boolean {
        return this.perCacheSubmitStatus[geocacheId] === 'ok';
    }

    protected renderSubmitBadge(geocacheId: number): React.ReactNode {
        const status = this.perCacheSubmitStatus[geocacheId];
        if (status === 'ok') {
            return (
                <span
                    style={{
                        padding: '2px 6px',
                        borderRadius: 3,
                        fontSize: 12,
                        background: '#2ecc71',
                        color: '#fff',
                        fontWeight: 700,
                        whiteSpace: 'nowrap'
                    }}
                    title={this.perCacheSubmitReference[geocacheId] ? `logReferenceCode: ${this.perCacheSubmitReference[geocacheId]}` : 'Log envoyé'}
                >
                    ✅ Log envoyé
                </span>
            );
        }
        if (status === 'skipped') {
            return (
                <span
                    style={{
                        padding: '2px 6px',
                        borderRadius: 3,
                        fontSize: 12,
                        background: '#f39c12',
                        color: '#fff',
                        fontWeight: 700,
                        whiteSpace: 'nowrap'
                    }}
                    title='Cache déjà loguée (non soumise)'
                >
                    ↩️ Déjà loguée
                </span>
            );
        }
        if (status === 'failed') {
            return (
                <span
                    style={{
                        padding: '2px 6px',
                        borderRadius: 3,
                        fontSize: 12,
                        background: 'var(--theia-errorForeground)',
                        color: '#fff',
                        fontWeight: 700,
                        whiteSpace: 'nowrap'
                    }}
                    title='Dernière tentative en échec'
                >
                    ⚠️ Échec
                </span>
            );
        }
        return (
            <span
                style={{
                    padding: '2px 6px',
                    borderRadius: 3,
                    fontSize: 12,
                    background: '#7f8c8d',
                    color: '#fff',
                    fontWeight: 700,
                    whiteSpace: 'nowrap'
                }}
                title='Pas encore envoyé'
            >
                ⏳ À envoyer
            </span>
        );
    }

    protected getTextForGeocacheId(geocacheId: number): string {
        return this.useSameTextForAll ? this.globalText : (this.perCacheText[geocacheId] ?? '');
    }

    protected async submitLogsToGeocaching(): Promise<void> {
        if (this.isSubmitting) {
            return;
        }
        if (this.isLoading || this.geocaches.length === 0) {
            this.messages.warn('Aucune géocache à loguer.');
            return;
        }

        const missingText = this.geocaches
            .filter(gc => !this.isGeocacheSubmittedOk(gc.id))
            .map(gc => ({ gc, text: (this.getTextForGeocacheId(gc.id) || '').trim() }))
            .filter(x => !x.text);

        if (missingText.length > 0) {
            if (this.useSameTextForAll) {
                this.messages.warn('Le texte du log est vide.');
            } else {
                this.messages.warn(`Texte manquant pour ${missingText.length} géocache(s).`);
            }
            return;
        }

        this.isSubmitting = true;
        this.lastSubmitSummary = undefined;
        this.update();

        let ok = 0;
        let failed = 0;

        try {
            for (const gc of this.geocaches) {
                if (this.isGeocacheSubmittedOk(gc.id)) {
                    continue;
                }
                const logTypeForGc = this.getLogTypeForGeocacheId(gc.id);
                const payload = {
                    text: this.getResolvedTextForGeocacheId(gc.id),
                    date: this.logDate,
                    logType: logTypeForGc,
                    favorite: logTypeForGc === 'found' ? (this.perCacheFavorite[gc.id] === true) : false,
                };

                const imageGuids = await this.uploadImagesForGeocache(gc.id);
                const payloadWithImages = imageGuids.length > 0 ? { ...payload, images: imageGuids } : payload;

                let responseBody: any = undefined;
                try {
                    const res = await fetch(`${this.backendBaseUrl}/api/geocaches/${gc.id}/logs/submit`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        credentials: 'include',
                        body: JSON.stringify(payloadWithImages),
                    });

                    try {
                        responseBody = await res.json();
                    } catch {
                        responseBody = undefined;
                    }

                    if (res.ok) {
                        ok += 1;
                        this.perCacheSubmitStatus = { ...this.perCacheSubmitStatus, [gc.id]: 'ok' };
                        const ref = typeof responseBody?.log_reference_code === 'string' ? responseBody.log_reference_code : undefined;
                        this.perCacheSubmitReference = { ...this.perCacheSubmitReference, [gc.id]: ref };

                        if (typeof window !== 'undefined') {
                            window.dispatchEvent(new CustomEvent('geoapp-geocache-log-submitted', {
                                detail: {
                                    geocacheId: gc.id,
                                    gcCode: gc.gc_code,
                                    logType: logTypeForGc,
                                    logDate: this.logDate,
                                    found: logTypeForGc === 'found',
                                    logReferenceCode: ref,
                                }
                            }));
                        }
                    } else {
                        const errorCode = typeof responseBody?.error_code === 'string' ? responseBody.error_code : undefined;
                        if (res.status === 409 && errorCode === 'ALREADY_LOGGED') {
                            this.perCacheSubmitStatus = { ...this.perCacheSubmitStatus, [gc.id]: 'skipped' };
                            this.messages.warn(`${gc.gc_code} - déjà loguée (ignorée)`);
                        } else {
                            failed += 1;
                            this.perCacheSubmitStatus = { ...this.perCacheSubmitStatus, [gc.id]: 'failed' };
                            const detail = responseBody?.error ? `: ${responseBody.error}` : '';
                            this.messages.warn(`${gc.gc_code} - échec${detail}`);
                        }
                    }
                } catch (e) {
                    console.error('[GeocacheLogEditorWidget] submit log error', gc, e, responseBody);
                    failed += 1;
                    this.perCacheSubmitStatus = { ...this.perCacheSubmitStatus, [gc.id]: 'failed' };
                    this.messages.warn(`${gc.gc_code} - erreur réseau/backend`);
                }

                this.update();
            }

            this.lastSubmitSummary = { ok, failed };
            if (ok > 0) {
                await this.saveCurrentStateToHistory();
            }
            if (failed === 0) {
                this.messages.info(`Logs envoyés sur Geocaching.com: ${ok}/${ok}`);
            } else {
                this.messages.warn(`Logs envoyés sur Geocaching.com: ${ok} ok, ${failed} échec(s)`);
            }
        } finally {
            this.isSubmitting = false;
            this.update();
        }
    }

    protected formatVisitedIso(dateOnly: string): string {
        const safe = (dateOnly || '').trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(safe)) {
            return `${new Date().toISOString().slice(0, 10)}T12:00Z`;
        }
        return `${safe}T12:00Z`;
    }

    protected getLogTypeLabel(value: LogTypeValue): string {
        if (value === 'found') {
            return 'Found it';
        }
        if (value === 'dnf') {
            return "Didn't find it";
        }
        return 'Write note';
    }

    protected escapeFieldNotesText(value: string): string {
        return (value || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/"/g, '""');
    }

    protected buildFieldNotes(): string {
        const visited = this.formatVisitedIso(this.logDate);
        const logType = this.getLogTypeLabel(this.logType);

        const lines = this.geocaches.map(gc => {
            const rawText = this.useSameTextForAll ? this.globalText : (this.perCacheText[gc.id] ?? '');
            const escaped = this.escapeFieldNotesText(rawText);
            return `${gc.gc_code},${visited},${logType},"${escaped}"`;
        });

        return lines.join('\n');
    }

    protected async copyFieldNotes(): Promise<void> {
        try {
            const content = this.buildFieldNotes();
            await navigator.clipboard.writeText(content);
            this.messages.info('Field notes copiées dans le presse-papiers.');
        } catch (e) {
            console.error('[GeocacheLogEditorWidget] copyFieldNotes error', e);
            this.messages.error('Impossible de copier dans le presse-papiers.');
        }
    }

    protected downloadFieldNotes(): void {
        try {
            const content = this.buildFieldNotes();
            const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'geocache_visits.txt';
            document.body.appendChild(a);
            a.click();
            a.remove();
            window.URL.revokeObjectURL(url);
        } catch (e) {
            console.error('[GeocacheLogEditorWidget] downloadFieldNotes error', e);
            this.messages.error('Impossible de télécharger le fichier.');
        }
    }

    protected async generateLogWithAi(): Promise<void> {
        if (this.isGeneratingAi) {
            return;
        }

        const keywords = (this.aiKeywords || '').trim();
        if (!keywords) {
            this.messages.warn('Veuillez entrer des mots-clés ou idées pour générer le log.');
            return;
        }

        this.isGeneratingAi = true;
        this.update();

        try {
            const languageModel = await this.languageModelRegistry.selectLanguageModel({
                agent: GeoAppLogWriterAgentId,
                purpose: 'chat',
                identifier: 'default/universal'
            });

            if (!languageModel) {
                this.messages.error('Aucun modèle IA n\'est configuré (vérifie la configuration IA de Theia)');
                return;
            }

            const logTypeLabel = this.logType === 'found' ? 'trouvaille (Found it)'
                : this.logType === 'dnf' ? 'non trouvée (Did Not Find)'
                : 'note (Write note)';

            const geocacheContext = this.geocaches.length > 0
                ? `\n\nContexte des géocaches à loguer :\n${this.geocaches.slice(0, 5).map(gc => `- ${gc.gc_code}: "${gc.name}" (type: ${gc.cache_type || 'inconnu'}, owner: ${gc.owner || 'inconnu'})`).join('\n')}${this.geocaches.length > 5 ? `\n... et ${this.geocaches.length - 5} autre(s)` : ''}`
                : '';

            const customInstructions = (this.aiCustomInstructions || '').trim();
            const exampleLogs = (this.aiExampleLogs || '').trim();

            let prompt = `Tu es un rédacteur de logs de géocache. Génère un log de type "${logTypeLabel}" basé sur les mots-clés et idées suivants :

**Mots-clés / idées :** ${keywords}
${geocacheContext}`;

            if (customInstructions) {
                prompt += `\n\n**Instructions personnalisées de l'utilisateur :**\n${customInstructions}`;
            }

            if (exampleLogs) {
                prompt += `\n\n**Exemples de logs de l'utilisateur (style à reproduire) :**\n${exampleLogs}`;
            }

            prompt += `\n\n**Règles importantes :**
- Écris UNIQUEMENT le texte du log, sans introduction ni explication.
- Le log doit être naturel et personnel, comme s'il était écrit par un géocacheur.
- Adapte le ton au type de log (enthousiaste pour une trouvaille, déçu mais positif pour un DNF, informatif pour une note).
- Tu peux utiliser du Markdown simple (gras, italique) si approprié.
- Le log doit faire entre 2 et 6 phrases.
- NE PAS inclure de signature ou de "TFTC" sauf si demandé dans les instructions.`;

            const request: UserRequest = {
                messages: [
                    { actor: 'user', type: 'text', text: prompt },
                ],
                agentId: GeoAppLogWriterAgentId,
                requestId: `geoapp-log-writer-${Date.now()}`,
                sessionId: `geoapp-log-writer-session-${Date.now()}`,
            };

            const response = await this.languageModelService.sendRequest(languageModel, request);
            let generatedText = '';

            if (isLanguageModelParsedResponse(response)) {
                generatedText = JSON.stringify(response.parsed);
            } else {
                try {
                    generatedText = await getTextOfResponse(response);
                } catch {
                    const jsonResponse = await getJsonOfResponse(response) as any;
                    generatedText = typeof jsonResponse === 'string' ? jsonResponse : String(jsonResponse);
                }
            }

            generatedText = (generatedText || '').toString().trim();

            generatedText = generatedText
                .replace(/\[THINK\][\s\S]*?\[\/THINK\]/gi, '')
                .replace(/<think>[\s\S]*?<\/think>/gi, '')
                .replace(/\[ANALYSIS\][\s\S]*?\[\/ANALYSIS\]/gi, '')
                .replace(/<analysis>[\s\S]*?<\/analysis>/gi, '')
                .trim();

            if (!generatedText) {
                this.messages.warn('L\'IA n\'a pas généré de texte.');
                return;
            }

            if (this.useSameTextForAll) {
                this.globalText = generatedText;
            } else {
                const firstGeocacheId = this.geocaches[0]?.id;
                if (firstGeocacheId !== undefined) {
                    this.perCacheText = { ...this.perCacheText, [firstGeocacheId]: generatedText };
                }
            }

            this.messages.info('Log généré par IA !');

        } catch (error) {
            console.error('[GeocacheLogEditorWidget] generateLogWithAi error', error);
            this.messages.error(`Erreur lors de la génération IA: ${error}`);
        } finally {
            this.isGeneratingAi = false;
            this.update();
        }
    }

    protected renderAiGenerationPanel(allSubmitted: boolean): React.ReactNode {
        return (
            <details
                open={this.showAiPanel}
                onToggle={(e: React.SyntheticEvent<HTMLDetailsElement>) => {
                    this.showAiPanel = (e.target as HTMLDetailsElement).open;
                }}
                style={{ marginBottom: 8 }}
            >
                <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: 12 }}>
                    🤖 Génération de log par IA
                </summary>
                <div style={{
                    marginTop: 8,
                    padding: 12,
                    background: 'var(--theia-editor-background)',
                    border: '1px solid var(--theia-panel-border)',
                    borderRadius: 6,
                    display: 'grid',
                    gap: 12
                }}>
                    <div>
                        <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                            Mots-clés / Idées *
                        </label>
                        <input
                            className='theia-input'
                            value={this.aiKeywords}
                            onChange={e => { this.aiKeywords = e.target.value; this.update(); }}
                            placeholder='Ex: belle balade, vue magnifique, cache bien cachée, famille...'
                            disabled={this.isGeneratingAi || allSubmitted}
                            style={{ width: '100%', fontSize: 12 }}
                        />
                        <div style={{ fontSize: 11, opacity: 0.7, marginTop: 2 }}>
                            Les idées principales pour le contenu du log
                        </div>
                    </div>

                    <div>
                        <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                            Instructions personnalisées (optionnel)
                        </label>
                        <textarea
                            className='theia-input'
                            value={this.aiCustomInstructions}
                            onChange={e => { this.aiCustomInstructions = e.target.value; this.update(); }}
                            placeholder='Ex: Toujours terminer par TFTC, utiliser un ton humoristique, mentionner la météo...'
                            disabled={this.isGeneratingAi || allSubmitted}
                            rows={3}
                            style={{ width: '100%', fontSize: 12, resize: 'vertical' }}
                        />
                        <div style={{ fontSize: 11, opacity: 0.7, marginTop: 2 }}>
                            Instructions générales pour personnaliser le style de génération
                        </div>
                    </div>

                    <div>
                        <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                            Exemples de logs (optionnel)
                        </label>
                        <textarea
                            className='theia-input'
                            value={this.aiExampleLogs}
                            onChange={e => { this.aiExampleLogs = e.target.value; this.update(); }}
                            placeholder="Colle ici 1 ou 2 exemples de logs que tu as déjà écrits pour que l'IA reproduise ton style..."
                            disabled={this.isGeneratingAi || allSubmitted}
                            rows={4}
                            style={{ width: '100%', fontSize: 12, resize: 'vertical' }}
                        />
                        <div style={{ fontSize: 11, opacity: 0.7, marginTop: 2 }}>
                            L'IA s'inspirera de ces exemples pour adopter ton style d'écriture
                        </div>
                    </div>

                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <button
                            className='theia-button primary'
                            onClick={() => { void this.generateLogWithAi(); }}
                            disabled={this.isGeneratingAi || allSubmitted || !this.aiKeywords.trim()}
                            style={{ fontSize: 12, padding: '6px 16px' }}
                        >
                            {this.isGeneratingAi ? (
                                <>
                                    <i className='fa fa-spinner fa-spin' style={{ marginRight: 6 }} />
                                    Génération...
                                </>
                            ) : (
                                <>
                                    🤖 Générer le log
                                </>
                            )}
                        </button>
                        {this.isGeneratingAi && (
                            <span style={{ fontSize: 12, opacity: 0.7 }}>
                                L'IA rédige le log...
                            </span>
                        )}
                    </div>
                </div>
            </details>
        );
    }

    protected render(): React.ReactNode {
        const allSubmitted = this.geocaches.length > 0 && this.geocaches.every(gc => this.isGeocacheSubmittedOk(gc.id));
        const canPrev = !this.isLoadingHistory && this.logHistory.length > 0 && (this.logHistoryCursor < this.logHistory.length - 1);
        const canNext = !this.isLoadingHistory && this.logHistory.length > 0 && (this.logHistoryCursor > 0);
        return (
            <div style={{ padding: 12, height: '100%', overflow: 'auto', display: 'grid', gap: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                    <div style={{ display: 'grid', gap: 8 }}>
                        <div>
                            <h3 style={{ margin: 0 }}>Logs</h3>
                            <div style={{ opacity: 0.7, fontSize: 12, marginTop: 4 }}>
                                {this.geocacheIds.length} géocache(s)
                            </div>
                        </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                        <button
                            className='theia-button secondary'
                            onClick={() => this.navigateHistory(+1)}
                            disabled={this.isLoading || this.isLoadingHistory || !canPrev}
                            title='Log précédent'
                            style={{ fontSize: 12, padding: '4px 10px' }}
                        >
                            ⬅️
                        </button>
                        <button
                            className='theia-button secondary'
                            onClick={() => this.navigateHistory(-1)}
                            disabled={this.isLoading || this.isLoadingHistory || !canNext}
                            title='Log suivant'
                            style={{ fontSize: 12, padding: '4px 10px' }}
                        >
                            ➡️
                        </button>
                        <button
                            className='theia-button primary'
                            onClick={() => { void this.submitLogsToGeocaching(); }}
                            disabled={
                                this.isLoading ||
                                this.isSubmitting ||
                                this.geocaches.length === 0 ||
                                this.geocaches.every(gc => this.isGeocacheSubmittedOk(gc.id))
                            }
                            title='Envoyer le(s) log(s) sur Geocaching.com via le backend'
                            style={{ fontSize: 12, padding: '4px 12px' }}
                        >
                            ✅ Envoyer sur GC
                        </button>
                        <button
                            className='theia-button secondary'
                            onClick={() => { void this.copyFieldNotes(); }}
                            disabled={this.isLoading || this.geocaches.length === 0}
                            title='Copier le format geocache_visits.txt (field notes)'
                            style={{ fontSize: 12, padding: '4px 12px' }}
                        >
                            📋 Copier field notes
                        </button>
                        <button
                            className='theia-button secondary'
                            onClick={() => this.downloadFieldNotes()}
                            disabled={this.isLoading || this.geocaches.length === 0}
                            title='Télécharger un fichier geocache_visits.txt'
                            style={{ fontSize: 12, padding: '4px 12px' }}
                        >
                            ⬇️ Télécharger
                        </button>
                    </div>
                </div>

                <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
                    {this.lastSubmitSummary && (
                        <div style={{ opacity: 0.85, fontSize: 12 }}>
                            Résultat: {this.lastSubmitSummary.ok} ok, {this.lastSubmitSummary.failed} échec(s)
                        </div>
                    )}
                    <div style={{ display: 'flex', gap: 12, alignItems: 'center', fontSize: 12 }}>
                        <div style={{ opacity: 0.85 }}>
                            <strong>PF disponibles:</strong> {this.totalFavoritePoints}
                        </div>
                        <div style={{ opacity: 0.85 }}>
                            <strong>PF restants:</strong> <span style={{ color: this.getRemainingFavoritePoints() === 0 ? 'var(--theia-errorForeground)' : 'inherit' }}>{this.getRemainingFavoritePoints()}</span>
                        </div>
                        <div style={{ opacity: 0.85 }}>
                            <strong>Trouvailles:</strong> {this.userFindsCount}
                        </div>
                    </div>
                </div>

                <details style={{ marginBottom: 8 }}>
                    <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: 12 }}>
                        📝 Patterns de texte ({this.getAllPatterns().length}) - Tapez @ dans le texte pour les utiliser
                    </summary>
                    <div style={{ marginTop: 8, padding: 10, background: 'var(--theia-editor-background)', border: '1px solid var(--theia-panel-border)', borderRadius: 6 }}>
                        <div style={{ marginBottom: 12 }}>
                            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Patterns intégrés</div>
                            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', fontSize: 11 }}>
                                {this.getBuiltinPatterns().map(p => (
                                    <span key={p.id} style={{ padding: '2px 6px', background: 'var(--theia-badge-background)', borderRadius: 3 }}>
                                        @{p.name} → {this.resolvePatternValue(p.name, this.geocaches[0]?.id ?? null)}
                                    </span>
                                ))}
                            </div>
                        </div>

                        <div style={{ marginBottom: 12 }}>
                            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Patterns personnalisés</div>
                            {this.customPatterns.length === 0 && (
                                <div style={{ fontSize: 11, opacity: 0.7 }}>Aucun pattern personnalisé</div>
                            )}
                            {this.customPatterns.length > 0 && (
                                <div style={{ display: 'grid', gap: 6 }}>
                                    {this.customPatterns.map(p => (
                                        <div key={p.id} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 11 }}>
                                            <span style={{ padding: '2px 6px', background: 'var(--theia-badge-background)', borderRadius: 3, fontWeight: 600 }}>
                                                @{p.name}
                                            </span>
                                            <span style={{ opacity: 0.8, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                {p.content}
                                            </span>
                                            <button
                                                className='theia-button secondary'
                                                style={{ fontSize: 10, padding: '2px 6px' }}
                                                onClick={() => {
                                                    this.editingPattern = p;
                                                    this.patternNameInput = p.name;
                                                    this.patternContentInput = p.content;
                                                    this.update();
                                                }}
                                            >
                                                ✏️
                                            </button>
                                            <button
                                                className='theia-button secondary'
                                                style={{ fontSize: 10, padding: '2px 6px' }}
                                                onClick={() => this.deletePattern(p.id)}
                                            >
                                                🗑️
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        <div style={{ borderTop: '1px solid var(--theia-panel-border)', paddingTop: 10 }}>
                            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
                                {this.editingPattern ? 'Modifier le pattern' : 'Ajouter un pattern'}
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr auto', gap: 8, alignItems: 'end' }}>
                                <div>
                                    <label style={{ display: 'block', fontSize: 10, opacity: 0.8, marginBottom: 2 }}>Nom (sans @)</label>
                                    <input
                                        className='theia-input'
                                        value={this.patternNameInput}
                                        onChange={e => { this.patternNameInput = e.target.value; this.update(); }}
                                        placeholder='mon_pattern'
                                        style={{ width: '100%', fontSize: 11 }}
                                    />
                                </div>
                                <div>
                                    <label style={{ display: 'block', fontSize: 10, opacity: 0.8, marginBottom: 2 }}>Contenu</label>
                                    <input
                                        className='theia-input'
                                        value={this.patternContentInput}
                                        onChange={e => { this.patternContentInput = e.target.value; this.update(); }}
                                        placeholder='Texte à insérer...'
                                        style={{ width: '100%', fontSize: 11 }}
                                    />
                                </div>
                                <div style={{ display: 'flex', gap: 4 }}>
                                    {this.editingPattern ? (
                                        <>
                                            <button
                                                className='theia-button primary'
                                                style={{ fontSize: 11, padding: '4px 8px' }}
                                                onClick={() => this.updatePattern(this.editingPattern!.id, this.patternNameInput, this.patternContentInput)}
                                                disabled={!this.patternNameInput.trim() || !this.patternContentInput.trim()}
                                            >
                                                Enregistrer
                                            </button>
                                            <button
                                                className='theia-button secondary'
                                                style={{ fontSize: 11, padding: '4px 8px' }}
                                                onClick={() => {
                                                    this.editingPattern = null;
                                                    this.patternNameInput = '';
                                                    this.patternContentInput = '';
                                                    this.update();
                                                }}
                                            >
                                                Annuler
                                            </button>
                                        </>
                                    ) : (
                                        <button
                                            className='theia-button primary'
                                            style={{ fontSize: 11, padding: '4px 8px' }}
                                            onClick={() => this.addPattern(this.patternNameInput, this.patternContentInput)}
                                            disabled={!this.patternNameInput.trim() || !this.patternContentInput.trim()}
                                        >
                                            Ajouter
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                </details>

                {this.renderAiGenerationPanel(allSubmitted)}

                {!this.isLoading && this.geocaches.length > 0 && (
                    <div style={{ background: 'var(--theia-editor-background)' }}>
                        <GeocacheLogEditorGeocachesTable
                            data={this.geocaches}
                            logType={this.logType}
                            perCacheLogType={this.perCacheLogType}
                            perCacheFavorite={this.perCacheFavorite}
                            perCacheSubmitStatus={this.perCacheSubmitStatus}
                            perCacheSubmitReference={this.perCacheSubmitReference}
                            onToggleFavorite={(geocacheId, nextValue) => this.toggleFavoriteForGeocacheId(geocacheId, nextValue)}
                            onToggleLogType={(geocacheId, nextValue) => this.setLogTypeForGeocacheId(geocacheId, nextValue)}
                            remainingFavoritePoints={this.getRemainingFavoritePoints()}
                            maxHeight={220}
                        />
                    </div>
                )}

                {allSubmitted && (
                    <div
                        style={{
                            border: '1px solid var(--theia-panel-border)',
                            background: 'var(--theia-editor-background)',
                            borderRadius: 6,
                            padding: '8px 10px',
                            fontSize: 12,
                            fontWeight: 600,
                        }}
                    >
                        ✅ Tous les logs ont été envoyés.
                    </div>
                )}
                <div style={{ display: 'grid', gridTemplateColumns: '160px 220px 1fr', gap: 12, alignItems: 'end' }}>
                    <div>
                        <label style={{ display: 'block', fontSize: 12, opacity: 0.8, marginBottom: 4 }}>Date</label>
                        <input
                            type='date'
                            className='theia-input'
                            value={this.logDate}
                            onChange={e => { this.logDate = e.target.value; this.update(); }}
                            style={{ width: '100%' }}
                        />
                    </div>
                    <div>
                        <label style={{ display: 'block', fontSize: 12, opacity: 0.8, marginBottom: 4 }}>Type</label>
                        <select
                            className='theia-select'
                            value={this.logType}
                            onChange={e => { this.setGlobalLogType(e.target.value as LogTypeValue); }}
                            style={{ width: '100%' }}
                        >
                            <option value='found'>Found it</option>
                            <option value='dnf'>Didn't find it</option>
                            <option value='note'>Write note</option>
                        </select>
                    </div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <input
                            type='checkbox'
                            checked={this.useSameTextForAll}
                            onChange={e => { this.toggleUseSameTextForAll(e.target.checked); }}
                        />
                        <span style={{ fontSize: 12, opacity: 0.85 }}>Texte identique pour toutes les géocaches</span>
                    </div>
                </div>

                {this.useSameTextForAll && (
                    <div>
                        <label style={{ display: 'block', fontSize: 12, opacity: 0.8, marginBottom: 4 }}>Texte (Markdown)</label>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 6 }}>
                            <div style={{ position: 'relative' }}>
                                <button
                                    className='theia-button secondary'
                                    style={{ fontSize: 12, padding: '2px 10px' }}
                                    onClick={() => { this.historyDropdownOpen = !this.historyDropdownOpen; this.update(); }}
                                    disabled={this.isLoading || this.isSubmitting || allSubmitted || this.logHistory.length === 0}
                                    title='Réutiliser un log récent'
                                >
                                    📝 Logs récents ({this.logHistory.length})
                                </button>
                                {this.historyDropdownOpen && this.logHistory.length > 0 && (
                                    <div
                                        style={{
                                            position: 'absolute',
                                            top: '100%',
                                            left: 0,
                                            marginTop: 4,
                                            width: 400,
                                            maxHeight: 300,
                                            overflowY: 'auto',
                                            border: '1px solid var(--theia-panel-border)',
                                            background: 'var(--theia-editor-background)',
                                            borderRadius: 3,
                                            zIndex: 1000,
                                            boxShadow: '0 4px 12px rgba(0,0,0,0.35)'
                                        }}
                                    >
                                        <div style={{ padding: '6px 8px', borderBottom: '1px solid var(--theia-panel-border)', fontSize: 11, fontWeight: 600, opacity: 0.8 }}>
                                            Cliquez pour réutiliser le texte
                                        </div>
                                        {this.logHistory.map((entry, idx) => {
                                            const date = new Date(entry.createdAt);
                                            const dateStr = date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
                                            const timeStr = date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
                                            const preview = (entry.globalText ?? '').slice(0, 80);
                                            return (
                                                <div
                                                    key={entry.id}
                                                    style={{
                                                        padding: '8px',
                                                        cursor: 'pointer',
                                                        borderBottom: idx < this.logHistory.length - 1 ? '1px solid var(--theia-panel-border)' : 'none',
                                                        background: 'transparent'
                                                    }}
                                                    onMouseEnter={e => { e.currentTarget.style.background = 'var(--theia-list-hoverBackground)'; }}
                                                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                                                    onClick={() => this.applyHistoryTextOnly(entry)}
                                                >
                                                    <div style={{ fontSize: 11, opacity: 0.7, marginBottom: 2 }}>
                                                        {dateStr} à {timeStr}
                                                    </div>
                                                    <div style={{ fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                        {preview || '(vide)'}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                            <span style={{ fontSize: 12, opacity: 0.75, marginRight: 6 }}>Markdown</span>
                            <button className='theia-button secondary' style={{ fontSize: 12, padding: '2px 10px' }} onClick={() => this.applyMarkdownWrap('**', '**', 'texte')} disabled={this.isLoading || this.isSubmitting || allSubmitted} title='Gras'>
                                <strong>B</strong>
                            </button>
                            <button className='theia-button secondary' style={{ fontSize: 12, padding: '2px 10px' }} onClick={() => this.applyMarkdownWrap('*', '*', 'texte')} disabled={this.isLoading || this.isSubmitting || allSubmitted} title='Italique'>
                                <em>I</em>
                            </button>
                            <button className='theia-button secondary' style={{ fontSize: 12, padding: '2px 10px' }} onClick={() => this.applyMarkdownWrap('`', '`', 'code')} disabled={this.isLoading || this.isSubmitting || allSubmitted} title='Code inline'>
                                {'</>'}
                            </button>
                            <button className='theia-button secondary' style={{ fontSize: 12, padding: '2px 10px' }} onClick={() => this.applyMarkdownWrap('[', '](https://example.com)', 'lien')} disabled={this.isLoading || this.isSubmitting || allSubmitted} title='Lien'>
                                🔗
                            </button>
                            <button className='theia-button secondary' style={{ fontSize: 12, padding: '2px 10px' }} onClick={() => this.applyMarkdownPrefix('# ', 'Titre')} disabled={this.isLoading || this.isSubmitting || allSubmitted} title='Titre'>
                                H1
                            </button>
                            <button className='theia-button secondary' style={{ fontSize: 12, padding: '2px 10px' }} onClick={() => this.applyMarkdownPrefix('## ', 'Sous-titre')} disabled={this.isLoading || this.isSubmitting || allSubmitted} title='Sous-titre'>
                                H2
                            </button>
                            <button className='theia-button secondary' style={{ fontSize: 12, padding: '2px 10px' }} onClick={() => this.applyMarkdownPrefix('- ', 'item')} disabled={this.isLoading || this.isSubmitting || allSubmitted} title='Liste'>
                                -
                            </button>
                            <button className='theia-button secondary' style={{ fontSize: 12, padding: '2px 10px' }} onClick={() => this.applyMarkdownPrefix('> ', 'Citation')} disabled={this.isLoading || this.isSubmitting || allSubmitted} title='Citation'>
                                &gt;
                            </button>
                        </div>
                        <div style={{ position: 'relative' }}>
                            {this.renderTextareaWithOverlay(
                                this.globalText,
                                this.geocaches[0]?.id ?? null,
                                {
                                    className: 'theia-input',
                                    value: this.globalText,
                                    onChange: e => {
                                        const start = e.currentTarget.selectionStart;
                                        const end = e.currentTarget.selectionEnd;
                                        this.globalText = e.currentTarget.value;
                                        this.refreshPatternAutocomplete(e.currentTarget.value, e.currentTarget, null);
                                        this.update();
                                        this.scheduleRestoreSelection({ type: 'global' }, start, end);
                                    },
                                    onKeyDown: e => this.handleTextAreaKeyDown(e, null),
                                    onBlur: () => this.handleTextAreaBlur(),
                                    onFocus: () => { this.activeEditor = { type: 'global' }; },
                                    disabled: this.geocaches.length > 0 && this.geocaches.every(gc => this.isGeocacheSubmittedOk(gc.id)),
                                    rows: 10,
                                    style: { width: '100%', resize: 'vertical' }
                                },
                                el => { this.globalTextArea = el; },
                                'global-overlay'
                            )}
                            {this.patternAutocompleteOpen && this.patternAutocompleteTargetGeocacheId === null && this.patternAutocompleteSuggestions.length > 0 && this.patternAutocompletePosition && (
                                <div
                                    style={{
                                        position: 'fixed',
                                        top: `${this.patternAutocompletePosition.top + 20}px`,
                                        left: `${this.patternAutocompletePosition.left}px`,
                                        width: 320,
                                        maxHeight: 200,
                                        overflowY: 'auto',
                                        border: '1px solid var(--theia-panel-border)',
                                        background: 'var(--theia-editor-background)',
                                        borderRadius: 3,
                                        zIndex: 1000,
                                        boxShadow: '0 4px 12px rgba(0,0,0,0.35)'
                                    }}
                                    onMouseDown={e => e.preventDefault()}
                                >
                                    {this.patternAutocompleteSuggestions.map((s, idx) => (
                                        <div
                                            key={s.id}
                                            style={{
                                                padding: '6px 8px',
                                                cursor: 'pointer',
                                                background: idx === this.patternAutocompleteActiveIndex
                                                    ? 'var(--theia-list-activeSelectionBackground)'
                                                    : 'transparent'
                                            }}
                                            onMouseEnter={() => { this.patternAutocompleteActiveIndex = idx; this.update(); }}
                                            onClick={() => this.applyPatternSuggestion(s)}
                                        >
                                            <div style={{ fontSize: '0.9em', fontWeight: 600 }}>{s.label}</div>
                                            <div style={{ fontSize: '0.8em', opacity: 0.7 }}>{s.description}</div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        <div style={{ marginTop: 10 }}>
                            {this.renderImagesSection('global', this.isLoading || this.isSubmitting || allSubmitted)}
                        </div>

                        <details style={{ marginTop: 8 }}>
                            <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Aperçu Markdown (texte final)</summary>
                            <div style={{ marginTop: 8, background: 'var(--theia-editor-background)', border: '1px solid var(--theia-panel-border)', borderRadius: 6, padding: 10, fontSize: 13, overflow: 'auto' }}>
                                {this.renderMarkdown(this.resolveAllPatterns(this.globalText, this.geocaches[0]?.id ?? null), 'global-preview')}
                            </div>
                        </details>
                    </div>
                )}

                {this.isLoading && (
                    <div style={{ opacity: 0.7 }}>
                        Chargement…
                    </div>
                )}

                {!this.isLoading && this.geocaches.length === 0 && (
                    <div style={{ opacity: 0.7 }}>
                        Aucune géocache
                    </div>
                )}

                {!this.isLoading && this.geocaches.length > 0 && !this.useSameTextForAll && (
                    <div style={{ display: 'grid', gap: 10 }}>
                        {this.geocaches.map(gc => (
                            <div key={gc.id} style={{ border: '1px solid var(--theia-panel-border)', borderRadius: 6, padding: 10, background: 'var(--theia-editor-background)' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                                    <div style={{ fontWeight: 700 }}>{gc.gc_code}</div>
                                    <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                                        {this.perCacheSubmitStatus[gc.id] === 'ok' && (
                                            <span
                                                style={{
                                                    padding: '2px 6px',
                                                    borderRadius: 3,
                                                    fontSize: 12,
                                                    background: '#2ecc71',
                                                    color: '#fff',
                                                    fontWeight: 700,
                                                    whiteSpace: 'nowrap'
                                                }}
                                                title={this.perCacheSubmitReference[gc.id] ? `logReferenceCode: ${this.perCacheSubmitReference[gc.id]}` : 'Log envoyé'}
                                            >
                                                ✅ Log envoyé
                                            </span>
                                        )}
                                        {this.perCacheSubmitStatus[gc.id] === 'failed' && (
                                            <span
                                                style={{
                                                    padding: '2px 6px',
                                                    borderRadius: 3,
                                                    fontSize: 12,
                                                    background: 'var(--theia-errorForeground)',
                                                    color: '#fff',
                                                    fontWeight: 700,
                                                    whiteSpace: 'nowrap'
                                                }}
                                                title='Dernière tentative en échec'
                                            >
                                                ⚠️ Échec
                                            </span>
                                        )}
                                        <div style={{ opacity: 0.8, fontSize: 12, textAlign: 'right' }}>{gc.name}</div>
                                    </div>
                                </div>

                                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center', marginTop: 8 }}>
                                    <div style={{ fontSize: 12, opacity: 0.85 }}>
                                        PF: {typeof gc.favorites_count === 'number' ? gc.favorites_count : '—'}
                                        {'  '}(
                                        {this.formatFavoritePercent(gc.favorites_count, gc.logs_count)}
                                        )
                                    </div>
                                    <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                                        <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12 }}>
                                            <span style={{ opacity: 0.85 }}>Type</span>
                                            <select
                                                className='theia-select'
                                                value={this.getLogTypeForGeocacheId(gc.id)}
                                                onChange={e => this.setLogTypeForGeocacheId(gc.id, e.target.value as LogTypeValue)}
                                                disabled={this.isGeocacheSubmittedOk(gc.id)}
                                                style={{ fontSize: 12 }}
                                            >
                                                <option value='found'>{this.getLogTypeLabel('found')}</option>
                                                <option value='dnf'>{this.getLogTypeLabel('dnf')}</option>
                                                <option value='note'>{this.getLogTypeLabel('note')}</option>
                                            </select>
                                        </label>

                                        <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, opacity: this.getLogTypeForGeocacheId(gc.id) === 'found' ? 0.9 : 0.5 }}>
                                            <input
                                                type='checkbox'
                                                checked={this.perCacheFavorite[gc.id] === true}
                                                onChange={e => this.toggleFavoriteForGeocacheId(gc.id, e.target.checked)}
                                                disabled={this.getLogTypeForGeocacheId(gc.id) !== 'found' || (!this.perCacheFavorite[gc.id] && this.getRemainingFavoritePoints() <= 0)}
                                                title={!this.perCacheFavorite[gc.id] && this.getRemainingFavoritePoints() <= 0 ? 'Plus de PF disponibles' : ''}
                                            />
                                            Donner un PF
                                        </label>
                                    </div>
                                </div>

                                <div style={{ marginTop: 10 }}>
                                    {this.renderImagesSection({ geocacheId: gc.id }, this.isLoading || this.isSubmitting || this.isGeocacheSubmittedOk(gc.id))}
                                </div>

                                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginTop: 8, marginBottom: 6 }}>
                                    <span style={{ fontSize: 12, opacity: 0.75, marginRight: 6 }}>Markdown</span>
                                    <button className='theia-button secondary' style={{ fontSize: 12, padding: '2px 10px' }} onClick={() => this.applyMarkdownWrap('**', '**', 'texte')} disabled={this.isLoading || this.isSubmitting} title='Gras'>
                                        <strong>B</strong>
                                    </button>
                                    <button className='theia-button secondary' style={{ fontSize: 12, padding: '2px 10px' }} onClick={() => this.applyMarkdownWrap('*', '*', 'texte')} disabled={this.isLoading || this.isSubmitting} title='Italique'>
                                        <em>I</em>
                                    </button>
                                    <button className='theia-button secondary' style={{ fontSize: 12, padding: '2px 10px' }} onClick={() => this.applyMarkdownWrap('`', '`', 'code')} disabled={this.isLoading || this.isSubmitting} title='Code inline'>
                                        {'</>'}
                                    </button>
                                    <button className='theia-button secondary' style={{ fontSize: 12, padding: '2px 10px' }} onClick={() => this.applyMarkdownWrap('[', '](https://example.com)', 'lien')} disabled={this.isLoading || this.isSubmitting} title='Lien'>
                                        🔗
                                    </button>
                                    <button className='theia-button secondary' style={{ fontSize: 12, padding: '2px 10px' }} onClick={() => this.applyMarkdownPrefix('# ', 'Titre')} disabled={this.isLoading || this.isSubmitting} title='Titre'>
                                        H1
                                    </button>
                                    <button className='theia-button secondary' style={{ fontSize: 12, padding: '2px 10px' }} onClick={() => this.applyMarkdownPrefix('## ', 'Sous-titre')} disabled={this.isLoading || this.isSubmitting} title='Sous-titre'>
                                        H2
                                    </button>
                                    <button className='theia-button secondary' style={{ fontSize: 12, padding: '2px 10px' }} onClick={() => this.applyMarkdownPrefix('- ', 'item')} disabled={this.isLoading || this.isSubmitting} title='Liste'>
                                        -
                                    </button>
                                    <button className='theia-button secondary' style={{ fontSize: 12, padding: '2px 10px' }} onClick={() => this.applyMarkdownPrefix('> ', 'Citation')} disabled={this.isLoading || this.isSubmitting} title='Citation'>
                                        &gt;
                                    </button>
                                </div>
                                <div style={{ position: 'relative', marginTop: 8 }}>
                                    {this.renderTextareaWithOverlay(
                                        this.perCacheText[gc.id] ?? '',
                                        gc.id,
                                        {
                                            className: 'theia-input',
                                            value: this.perCacheText[gc.id] ?? '',
                                            onChange: e => {
                                                const start = e.currentTarget.selectionStart;
                                                const end = e.currentTarget.selectionEnd;
                                                const newValue = e.target.value;
                                                this.perCacheText = { ...this.perCacheText, [gc.id]: newValue };
                                                this.refreshPatternAutocomplete(newValue, e.currentTarget, gc.id);
                                                this.update();
                                                this.scheduleRestoreSelection({ type: 'per-cache', geocacheId: gc.id }, start, end);
                                            },
                                            onKeyDown: e => this.handleTextAreaKeyDown(e, gc.id),
                                            onBlur: () => this.handleTextAreaBlur(),
                                            onFocus: () => { this.activeEditor = { type: 'per-cache', geocacheId: gc.id }; },
                                            disabled: this.isGeocacheSubmittedOk(gc.id),
                                            rows: 6,
                                            style: { width: '100%', resize: 'vertical' },
                                            placeholder: 'Texte (Markdown) - Tapez @ pour insérer un pattern'
                                        },
                                        el => { this.perCacheTextAreas = { ...this.perCacheTextAreas, [gc.id]: el }; },
                                        `per-cache-overlay-${gc.id}`
                                    )}
                                    {this.patternAutocompleteOpen && this.patternAutocompleteTargetGeocacheId === gc.id && this.patternAutocompleteSuggestions.length > 0 && this.patternAutocompletePosition && (
                                        <div
                                            style={{
                                                position: 'fixed',
                                                top: `${this.patternAutocompletePosition.top + 20}px`,
                                                left: `${this.patternAutocompletePosition.left}px`,
                                                width: 320,
                                                maxHeight: 200,
                                                overflowY: 'auto',
                                                border: '1px solid var(--theia-panel-border)',
                                                background: 'var(--theia-editor-background)',
                                                borderRadius: 3,
                                                zIndex: 1000,
                                                boxShadow: '0 4px 12px rgba(0,0,0,0.35)'
                                            }}
                                            onMouseDown={e => e.preventDefault()}
                                        >
                                            {this.patternAutocompleteSuggestions.map((s, idx) => (
                                                <div
                                                    key={s.id}
                                                    style={{
                                                        padding: '6px 8px',
                                                        cursor: 'pointer',
                                                        background: idx === this.patternAutocompleteActiveIndex
                                                            ? 'var(--theia-list-activeSelectionBackground)'
                                                            : 'transparent'
                                                    }}
                                                    onMouseEnter={() => { this.patternAutocompleteActiveIndex = idx; this.update(); }}
                                                    onClick={() => this.applyPatternSuggestion(s)}
                                                >
                                                    <div style={{ fontSize: '0.9em', fontWeight: 600 }}>{s.label}</div>
                                                    <div style={{ fontSize: '0.8em', opacity: 0.7 }}>{s.description}</div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                <details style={{ marginTop: 8 }}>
                                    <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Aperçu Markdown (texte final)</summary>
                                    <div style={{ marginTop: 8, background: 'var(--theia-editor-background)', border: '1px solid var(--theia-panel-border)', borderRadius: 6, padding: 10, fontSize: 13, overflow: 'auto' }}>
                                        {this.renderMarkdown(this.resolveAllPatterns(this.perCacheText[gc.id] ?? '', gc.id), `per-preview-${gc.id}`)}
                                    </div>
                                </details>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        );
    }
}
