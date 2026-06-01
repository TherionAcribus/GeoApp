import * as React from '@theia/core/shared/react';
import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { MessageService } from '@theia/core/lib/common/message-service';
import { PluginsService, PluginResult } from '../common/plugin-protocol';
import type { GeocacheContext } from './plugin-executor-widget';

import './style/grid-puzzle-workbench.css';

type Grid = string[][];
type WorkMode = 'edit' | 'watch';
type SudokuVariant = 'sudoku_classic' | 'sudoku_x' | 'sudoku_center_dot' | 'sudoku_windoku' | 'sudoku_greater_than';
type InequalitySymbol = '' | '>' | '<';
type InequalityGrid = InequalitySymbol[][];

const SIZE = 9;
const EMPTY_GRID: Grid = Array.from({ length: SIZE }, () => Array(SIZE).fill(''));
const EMPTY_HORIZONTAL_INEQUALITIES: InequalityGrid = Array.from({ length: SIZE }, () => Array(SIZE - 1).fill(''));
const EMPTY_VERTICAL_INEQUALITIES: InequalityGrid = Array.from({ length: SIZE - 1 }, () => Array(SIZE).fill(''));
const QUICK_TEXT_PLACEHOLDER = '0'.repeat(SIZE).concat('\n').repeat(SIZE).trim();

interface GridPuzzleWorkbenchAppProps {
    pluginsService: PluginsService;
    messageService: MessageService;
    context?: GeocacheContext;
}

interface SolveState {
    running: boolean;
    result?: PluginResult;
    error?: string;
}

interface PersistenceState {
    loading: boolean;
    saving: boolean;
    dirty: boolean;
    message?: string;
    error?: string;
    updatedAt?: string | null;
}

function cloneGrid(grid: Grid): Grid {
    return grid.map(row => [...row]);
}

function cloneInequalityGrid(grid: InequalityGrid): InequalityGrid {
    return grid.map(row => [...row]);
}

function cellRef(row: number, col: number): string {
    return `r${row + 1}c${col + 1}`;
}

function getVariantLabel(puzzleType: SudokuVariant): string {
    if (puzzleType === 'sudoku_x') {
        return 'Sudoku X';
    }
    if (puzzleType === 'sudoku_center_dot') {
        return 'Center Dot';
    }
    if (puzzleType === 'sudoku_windoku') {
        return 'Windoku';
    }
    if (puzzleType === 'sudoku_greater_than') {
        return 'Greater Than';
    }
    return 'Sudoku classique';
}

function isCenterDotCell(row: number, col: number): boolean {
    return row % 3 === 1 && col % 3 === 1;
}

function isWindokuCell(row: number, col: number): boolean {
    return ((row >= 1 && row <= 3) || (row >= 5 && row <= 7))
        && ((col >= 1 && col <= 3) || (col >= 5 && col <= 7));
}

function getWindokuBoundaryClasses(row: number, col: number): string[] {
    if (!isWindokuCell(row, col)) {
        return [];
    }
    return [
        row === 1 || row === 5 ? 'windoku-top' : '',
        row === 3 || row === 7 ? 'windoku-bottom' : '',
        col === 1 || col === 5 ? 'windoku-left' : '',
        col === 3 || col === 7 ? 'windoku-right' : '',
    ].filter(Boolean);
}

function emptyGrid(): Grid {
    return cloneGrid(EMPTY_GRID);
}

function emptyHorizontalInequalities(): InequalityGrid {
    return cloneInequalityGrid(EMPTY_HORIZONTAL_INEQUALITIES);
}

function emptyVerticalInequalities(): InequalityGrid {
    return cloneInequalityGrid(EMPTY_VERTICAL_INEQUALITIES);
}

function normalizeInequalitySymbol(value: unknown): InequalitySymbol {
    return value === '>' || value === '<' ? value : '';
}

function normalizeInequalityGrid(value: unknown, rows: number, cols: number): InequalityGrid {
    if (!Array.isArray(value) || value.length !== rows) {
        return Array.from({ length: rows }, () => Array<InequalitySymbol>(cols).fill(''));
    }

    return value.map(row => {
        const cells = typeof row === 'string' ? row.split('') : Array.isArray(row) ? row : [];
        return Array.from({ length: cols }, (_unused, index) => normalizeInequalitySymbol(cells[index]));
    });
}

function cycleInequality(value: InequalitySymbol): InequalitySymbol {
    if (value === '') {
        return '>';
    }
    if (value === '>') {
        return '<';
    }
    return '';
}

function gridToText(grid: Grid): string {
    return grid.map(row => row.map(value => value || '0').join('')).join('\n');
}

function parseGridText(text: string): Grid | null {
    const tokens: string[] = [];
    for (const char of text) {
        if (/[1-9]/.test(char)) {
            tokens.push(char);
        } else if (char === '0' || char === '.' || char === '_') {
            tokens.push('');
        }
    }

    if (tokens.length !== SIZE * SIZE) {
        return null;
    }

    const grid = emptyGrid();
    tokens.forEach((value, index) => {
        grid[Math.floor(index / SIZE)][index % SIZE] = value;
    });
    return grid;
}

function normalizeGrid(value: unknown): Grid | undefined {
    if (typeof value === 'string') {
        return parseGridText(value) || undefined;
    }

    if (!Array.isArray(value) || value.length !== SIZE) {
        return undefined;
    }

    const normalized = value.map(row => {
        if (!Array.isArray(row) || row.length !== SIZE) {
            return undefined;
        }
        return row.map(cell => {
            const text = String(cell ?? '').replace(/[^1-9]/g, '').slice(-1);
            return text;
        });
    });

    if (normalized.some(row => row === undefined)) {
        return undefined;
    }

    return normalized as Grid;
}

function normalizeWatchCells(value: unknown): string[] {
    const values = Array.isArray(value)
        ? value
        : typeof value === 'string'
            ? value.split(/[\s,;]+/)
            : [];
    const seen = new Set<string>();
    const refs: string[] = [];

    for (const raw of values) {
        const ref = String(raw || '').trim().toLowerCase();
        if (!/^r[1-9]c[1-9]$/.test(ref) || seen.has(ref)) {
            continue;
        }
        seen.add(ref);
        refs.push(ref);
    }

    return refs;
}

function normalizeNumber(value: unknown, fallback: number, min: number, max: number): number {
    const numberValue = Number(value);
    if (!Number.isFinite(numberValue)) {
        return fallback;
    }
    return Math.max(min, Math.min(max, Math.floor(numberValue)));
}

function extractGridFromResult(result: PluginResult | undefined): Grid | undefined {
    const firstGrid = result?.results?.[0]?.grid;
    if (!Array.isArray(firstGrid)) {
        return undefined;
    }
    return firstGrid.map((row: unknown) => {
        if (!Array.isArray(row)) {
            return Array(SIZE).fill('');
        }
        return row.map(value => String(value ?? ''));
    });
}

function GridPuzzleWorkbenchApp({
    pluginsService,
    messageService,
    context,
}: GridPuzzleWorkbenchAppProps): React.ReactElement {
    const [grid, setGrid] = React.useState<Grid>(() => emptyGrid());
    const [quickText, setQuickText] = React.useState('');
    const [puzzleType, setPuzzleType] = React.useState<SudokuVariant>('sudoku_classic');
    const [horizontalInequalities, setHorizontalInequalities] = React.useState<InequalityGrid>(() => emptyHorizontalInequalities());
    const [verticalInequalities, setVerticalInequalities] = React.useState<InequalityGrid>(() => emptyVerticalInequalities());
    const [watchCells, setWatchCells] = React.useState<string[]>([]);
    const [mode, setMode] = React.useState<WorkMode>('edit');
    const [maxSolutions, setMaxSolutions] = React.useState(2);
    const [timeoutMs, setTimeoutMs] = React.useState(10000);
    const [solveState, setSolveState] = React.useState<SolveState>({ running: false });
    const [persistence, setPersistence] = React.useState<PersistenceState>({
        loading: false,
        saving: false,
        dirty: false,
    });
    const cellRefs = React.useRef<Array<Array<HTMLInputElement | null>>>(
        Array.from({ length: SIZE }, () => Array<HTMLInputElement | null>(SIZE).fill(null))
    );

    const solvedGrid = extractGridFromResult(solveState.result);
    const watchedValues = (solveState.result as any)?.watched_values as Record<string, string> | undefined;
    const watchedText = String((solveState.result as any)?.watched_text || '');
    const geocacheId = context?.geocacheId;
    const variantLabel = getVariantLabel(puzzleType);
    const contextLabel = context ? `${context.gcCode} - ${context.name}` : 'Mode libre';
    const isGreaterThan = puzzleType === 'sudoku_greater_than';

    const markDirty = React.useCallback(() => {
        if (!geocacheId) {
            return;
        }
        setPersistence(previous => ({
            ...previous,
            dirty: true,
            message: undefined,
            error: undefined,
        }));
    }, [geocacheId]);

    const setGridAndQuickText = React.useCallback((nextGrid: Grid) => {
        setGrid(nextGrid);
        setQuickText(gridToText(nextGrid));
    }, []);

    const focusCell = React.useCallback((row: number, col: number) => {
        const nextRow = Math.max(0, Math.min(SIZE - 1, row));
        const nextCol = Math.max(0, Math.min(SIZE - 1, col));
        cellRefs.current[nextRow]?.[nextCol]?.focus();
        cellRefs.current[nextRow]?.[nextCol]?.select();
    }, []);

    const applyStateSnapshot = React.useCallback((snapshot: Record<string, any> | undefined) => {
        const restoredGrid = normalizeGrid(snapshot?.grid) || emptyGrid();
        const restoredResult = snapshot?.lastResult && typeof snapshot.lastResult === 'object'
            ? snapshot.lastResult as PluginResult
            : undefined;

        setGridAndQuickText(restoredGrid);
        setWatchCells(normalizeWatchCells(snapshot?.watchCells ?? snapshot?.watchedCells));
        setHorizontalInequalities(normalizeInequalityGrid(snapshot?.inequalities?.horizontal, SIZE, SIZE - 1));
        setVerticalInequalities(normalizeInequalityGrid(snapshot?.inequalities?.vertical, SIZE - 1, SIZE));
        setMaxSolutions(normalizeNumber(snapshot?.maxSolutions, 2, 1, 25));
        setTimeoutMs(normalizeNumber(snapshot?.solverTimeoutMs ?? snapshot?.timeoutMs, 10000, 1000, 30000));
        setSolveState({ running: false, result: restoredResult });
    }, [setGridAndQuickText]);

    const loadPersistedState = React.useCallback(async () => {
        if (!geocacheId) {
            return;
        }

        setPersistence(previous => ({ ...previous, loading: true, error: undefined }));
        try {
            const response = await pluginsService.getPuzzleState(geocacheId, puzzleType, 'default');
            if (response.state) {
                applyStateSnapshot(response.state.state);
                setPersistence({
                    loading: false,
                    saving: false,
                    dirty: false,
                    message: 'Etat charge.',
                    updatedAt: response.state.updated_at,
                });
            } else {
                applyStateSnapshot(undefined);
                setPersistence({
                    loading: false,
                    saving: false,
                    dirty: false,
                    message: 'Aucun etat sauvegarde.',
                });
            }
        } catch (error) {
            setPersistence(previous => ({
                ...previous,
                loading: false,
                error: error instanceof Error ? error.message : String(error),
            }));
        }
    }, [applyStateSnapshot, geocacheId, pluginsService, puzzleType]);

    React.useEffect(() => {
        void loadPersistedState();
    }, [loadPersistedState]);

    const saveState = React.useCallback(async (resultOverride?: PluginResult) => {
        if (!geocacheId) {
            messageService.info('Ouvrez l atelier depuis une geocache pour sauvegarder cet etat.');
            return;
        }

        setPersistence(previous => ({ ...previous, saving: true, error: undefined }));
        try {
            const response = await pluginsService.savePuzzleState(geocacheId, {
                puzzle_type: puzzleType,
                state_key: 'default',
                title: context?.gcCode ? `${variantLabel} ${context.gcCode}` : variantLabel,
                state: {
                    grid,
                    puzzleType,
                    quickText,
                    inequalities: {
                        horizontal: horizontalInequalities,
                        vertical: verticalInequalities,
                    },
                    watchCells,
                    maxSolutions,
                    solverTimeoutMs: timeoutMs,
                    lastResult: resultOverride || solveState.result,
                    updatedAt: new Date().toISOString(),
                },
            });
            setPersistence({
                loading: false,
                saving: false,
                dirty: false,
                message: 'Etat sauvegarde.',
                updatedAt: response.state.updated_at,
            });
        } catch (error) {
            setPersistence(previous => ({
                ...previous,
                saving: false,
                error: error instanceof Error ? error.message : String(error),
            }));
        }
    }, [
        context?.gcCode,
        geocacheId,
        grid,
        horizontalInequalities,
        maxSolutions,
        messageService,
        pluginsService,
        puzzleType,
        quickText,
        solveState.result,
        timeoutMs,
        variantLabel,
        verticalInequalities,
        watchCells,
    ]);

    const updateCell = React.useCallback((row: number, col: number, rawValue: string) => {
        const value = rawValue.replace(/[^1-9]/g, '').slice(-1);
        setGrid(previous => {
            const next = cloneGrid(previous);
            next[row][col] = value;
            setQuickText(gridToText(next));
            return next;
        });
        setSolveState({ running: false });
        markDirty();
    }, [markDirty]);

    const toggleHorizontalInequality = React.useCallback((row: number, col: number) => {
        setHorizontalInequalities(previous => {
            const next = cloneInequalityGrid(previous);
            next[row][col] = cycleInequality(next[row][col]);
            return next;
        });
        setSolveState({ running: false });
        markDirty();
    }, [markDirty]);

    const toggleVerticalInequality = React.useCallback((row: number, col: number) => {
        setVerticalInequalities(previous => {
            const next = cloneInequalityGrid(previous);
            next[row][col] = cycleInequality(next[row][col]);
            return next;
        });
        setSolveState({ running: false });
        markDirty();
    }, [markDirty]);

    const handleCellKeyDown = React.useCallback((row: number, col: number, event: React.KeyboardEvent<HTMLInputElement>) => {
        const moves: Record<string, [number, number]> = {
            ArrowUp: [-1, 0],
            ArrowDown: [1, 0],
            ArrowLeft: [0, -1],
            ArrowRight: [0, 1],
        };
        const move = moves[event.key];
        if (move) {
            event.preventDefault();
            focusCell(row + move[0], col + move[1]);
            return;
        }

        if (event.key === 'Backspace' || event.key === 'Delete') {
            event.preventDefault();
            updateCell(row, col, '');
            return;
        }

        if (/^[1-9]$/.test(event.key)) {
            event.preventDefault();
            updateCell(row, col, event.key);
            return;
        }

        if (event.key === '0' || event.key === '.' || event.key === '_') {
            event.preventDefault();
            updateCell(row, col, '');
        }
    }, [focusCell, updateCell]);

    const toggleWatchCell = React.useCallback((ref: string) => {
        setWatchCells(previous => (
            previous.includes(ref)
                ? previous.filter(item => item !== ref)
                : [...previous, ref]
        ));
        markDirty();
    }, [markDirty]);

    const handleCellClick = React.useCallback((row: number, col: number, event: React.MouseEvent) => {
        const ref = cellRef(row, col);
        if (mode === 'watch' || event.ctrlKey || event.metaKey) {
            event.preventDefault();
            toggleWatchCell(ref);
        }
    }, [mode, toggleWatchCell]);

    const applyQuickText = React.useCallback((text: string) => {
        const parsed = parseGridText(text);
        if (!parsed) {
            messageService.error('La saisie rapide doit contenir exactement 81 cases.');
            return;
        }
        setGridAndQuickText(parsed);
        setSolveState({ running: false });
        markDirty();
    }, [markDirty, messageService, setGridAndQuickText]);

    const handleQuickTextChange = React.useCallback((text: string) => {
        setQuickText(text);
        const parsed = parseGridText(text);
        if (parsed) {
            setGrid(parsed);
            setSolveState({ running: false });
        }
        markDirty();
    }, [markDirty]);

    const handlePuzzleTypeChange = React.useCallback((value: string) => {
        const nextPuzzleType = value === 'sudoku_x'
            || value === 'sudoku_center_dot'
            || value === 'sudoku_windoku'
            || value === 'sudoku_greater_than'
            ? value
            : 'sudoku_classic';
        setPuzzleType(nextPuzzleType);
        setSolveState({ running: false });
        markDirty();
    }, [markDirty]);

    const clearGrid = React.useCallback(() => {
        setGridAndQuickText(emptyGrid());
        setHorizontalInequalities(emptyHorizontalInequalities());
        setVerticalInequalities(emptyVerticalInequalities());
        setWatchCells([]);
        setSolveState({ running: false });
        markDirty();
    }, [markDirty, setGridAndQuickText]);

    const solve = React.useCallback(async () => {
        setSolveState({ running: true });
        try {
            const result = await pluginsService.executePlugin('grid_puzzle_solver', {
                puzzle_type: puzzleType,
                grid: gridToText(grid),
                watched_cells: watchCells.join(' '),
                inequalities: {
                    horizontal: horizontalInequalities,
                    vertical: verticalInequalities,
                },
                max_solutions: maxSolutions,
                solver_timeout_ms: timeoutMs,
            });
            setSolveState({
                running: false,
                result,
                error: result.status === 'error' ? result.summary || 'Erreur de resolution' : undefined,
            });
            if (geocacheId) {
                await saveState(result);
            }
        } catch (error) {
            setSolveState({
                running: false,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }, [geocacheId, grid, horizontalInequalities, maxSolutions, pluginsService, puzzleType, saveState, timeoutMs, verticalInequalities, watchCells]);

    const useSolvedGrid = React.useCallback(() => {
        if (solvedGrid) {
            setGridAndQuickText(solvedGrid);
            setSolveState({ running: false });
            markDirty();
        }
    }, [markDirty, setGridAndQuickText, solvedGrid]);

    const cellStyle = (rowIndex: number, colIndex: number): React.CSSProperties | undefined => (
        isGreaterThan
            ? {
                gridColumn: String(colIndex * 2 + 1),
                gridRow: String(rowIndex * 2 + 1),
            }
            : undefined
    );

    const cellClassName = (rowIndex: number, colIndex: number, value: string, readonly = false): string => {
        const ref = cellRef(rowIndex, colIndex);
        return [
            'sudoku-cell',
            readonly ? 'readonly' : '',
            value ? 'given' : '',
            watchCells.includes(ref) ? 'watched' : '',
            puzzleType === 'sudoku_x' && (rowIndex === colIndex || rowIndex + colIndex === SIZE - 1) ? 'diagonal' : '',
            puzzleType === 'sudoku_center_dot' && isCenterDotCell(rowIndex, colIndex) ? 'center-dot' : '',
            puzzleType === 'sudoku_windoku' && isWindokuCell(rowIndex, colIndex) ? 'windoku' : '',
            ...(puzzleType === 'sudoku_windoku' ? getWindokuBoundaryClasses(rowIndex, colIndex) : []),
            colIndex === 2 || colIndex === 5 ? 'block-right' : '',
            rowIndex === 2 || rowIndex === 5 ? 'block-bottom' : '',
        ].filter(Boolean).join(' ');
    };

    const renderInequalityControls = (readonly = false): React.ReactNode => {
        if (!isGreaterThan) {
            return null;
        }

        return (
            <>
                {horizontalInequalities.map((row, rowIndex) => (
                    row.map((value, colIndex) => (
                        <button
                            key={`h-${rowIndex}-${colIndex}`}
                            type='button'
                            className={[
                                'inequality-control',
                                'horizontal',
                                value ? 'active' : '',
                            ].filter(Boolean).join(' ')}
                            style={{
                                gridColumn: String(colIndex * 2 + 2),
                                gridRow: String(rowIndex * 2 + 1),
                            }}
                            title={`Contrainte entre ${cellRef(rowIndex, colIndex)} et ${cellRef(rowIndex, colIndex + 1)}`}
                            aria-label={`Contrainte entre ${cellRef(rowIndex, colIndex)} et ${cellRef(rowIndex, colIndex + 1)}`}
                            disabled={readonly}
                            onClick={() => toggleHorizontalInequality(rowIndex, colIndex)}
                        >
                            {value}
                        </button>
                    ))
                ))}
                {verticalInequalities.map((row, rowIndex) => (
                    row.map((value, colIndex) => (
                        <button
                            key={`v-${rowIndex}-${colIndex}`}
                            type='button'
                            className={[
                                'inequality-control',
                                'vertical',
                                value ? 'active' : '',
                            ].filter(Boolean).join(' ')}
                            style={{
                                gridColumn: String(colIndex * 2 + 1),
                                gridRow: String(rowIndex * 2 + 2),
                            }}
                            title={`Contrainte entre ${cellRef(rowIndex, colIndex)} et ${cellRef(rowIndex + 1, colIndex)}`}
                            aria-label={`Contrainte entre ${cellRef(rowIndex, colIndex)} et ${cellRef(rowIndex + 1, colIndex)}`}
                            disabled={readonly}
                            onClick={() => toggleVerticalInequality(rowIndex, colIndex)}
                        >
                            {value}
                        </button>
                    ))
                ))}
                {Array.from({ length: SIZE - 1 }, (_row, rowIndex) => (
                    Array.from({ length: SIZE - 1 }, (_col, colIndex) => (
                        <span
                            key={`corner-${rowIndex}-${colIndex}`}
                            className='inequality-corner'
                            style={{
                                gridColumn: String(colIndex * 2 + 2),
                                gridRow: String(rowIndex * 2 + 2),
                            }}
                        />
                    ))
                ))}
            </>
        );
    };

    return (
        <div className='grid-puzzle-workbench'>
            <div className='grid-puzzle-toolbar'>
                <div className='grid-puzzle-title'>
                    <h3>Atelier de grille</h3>
                    <span>{contextLabel} - {variantLabel}, moteur Z3</span>
                </div>
                <div className='grid-puzzle-actions'>
                    <button className={mode === 'edit' ? 'active' : ''} onClick={() => setMode('edit')}>
                        Saisie
                    </button>
                    <button className={mode === 'watch' ? 'active' : ''} onClick={() => setMode('watch')}>
                        Surveiller
                    </button>
                    <select
                        className='grid-puzzle-variant-select'
                        value={puzzleType}
                        onChange={event => handlePuzzleTypeChange(event.currentTarget.value)}
                    >
                        <option value='sudoku_classic'>Classique</option>
                        <option value='sudoku_x'>Sudoku X</option>
                        <option value='sudoku_center_dot'>Center Dot</option>
                        <option value='sudoku_windoku'>Windoku</option>
                        <option value='sudoku_greater_than'>Greater Than</option>
                    </select>
                    <button onClick={solve} disabled={solveState.running}>
                        {solveState.running ? 'Resolution...' : 'Resoudre'}
                    </button>
                    <button onClick={() => { void saveState(); }} disabled={!geocacheId || persistence.saving || persistence.loading}>
                        {persistence.saving ? 'Sauvegarde...' : 'Sauver'}
                    </button>
                    <button onClick={() => { void loadPersistedState(); }} disabled={!geocacheId || persistence.loading}>
                        Recharger
                    </button>
                </div>
            </div>

            <div className='grid-puzzle-layout'>
                <section className='grid-puzzle-main'>
                    <div
                        className={['sudoku-board', isGreaterThan ? 'greater-than-board' : ''].filter(Boolean).join(' ')}
                        aria-label='Grille Sudoku interactive'
                    >
                        {grid.map((row, rowIndex) => (
                            row.map((value, colIndex) => {
                                const ref = cellRef(rowIndex, colIndex);
                                return (
                                    <input
                                        key={ref}
                                        className={cellClassName(rowIndex, colIndex, value)}
                                        style={cellStyle(rowIndex, colIndex)}
                                        ref={element => {
                                            cellRefs.current[rowIndex][colIndex] = element;
                                        }}
                                        aria-label={ref}
                                        value={value}
                                        inputMode='numeric'
                                        maxLength={1}
                                        onClick={event => handleCellClick(rowIndex, colIndex, event)}
                                        onKeyDown={event => handleCellKeyDown(rowIndex, colIndex, event)}
                                        onChange={event => updateCell(rowIndex, colIndex, event.currentTarget.value)}
                                    />
                                );
                            })
                        ))}
                        {renderInequalityControls()}
                    </div>

                    <div className='grid-puzzle-hint'>
                        En mode Surveiller, cliquez les cases a extraire pour la reponse. En mode Saisie, Ctrl+clic fonctionne aussi.
                        {isGreaterThan ? ' Cliquez les bords pour alterner entre >, < et vide.' : ''}
                    </div>

                    {solvedGrid && (
                        <div className='grid-puzzle-solution'>
                            <div className='grid-puzzle-section-title'>
                                <strong>Solution</strong>
                                <button onClick={useSolvedGrid}>Reprendre dans la grille</button>
                            </div>
                            <div
                                className={[
                                    'sudoku-board',
                                    'solved',
                                    isGreaterThan ? 'greater-than-board' : '',
                                ].filter(Boolean).join(' ')}
                                aria-label='Solution Sudoku'
                            >
                                {solvedGrid.map((row, rowIndex) => (
                                    row.map((value, colIndex) => {
                                        const ref = cellRef(rowIndex, colIndex);
                                        return (
                                            <div
                                                key={`solved-${ref}`}
                                                className={cellClassName(rowIndex, colIndex, grid[rowIndex][colIndex], true)}
                                                style={cellStyle(rowIndex, colIndex)}
                                            >
                                                {value}
                                            </div>
                                        );
                                    })
                                ))}
                                {renderInequalityControls(true)}
                            </div>
                        </div>
                    )}
                </section>

                <aside className='grid-puzzle-side'>
                    <section>
                        <div className='grid-puzzle-section-title'>
                            <strong>Saisie rapide</strong>
                        </div>
                        <textarea
                            value={quickText}
                            onChange={event => handleQuickTextChange(event.currentTarget.value)}
                            placeholder={QUICK_TEXT_PLACEHOLDER}
                            rows={8}
                        />
                        <div className='grid-puzzle-actions inline'>
                            <button onClick={() => applyQuickText(quickText)}>Appliquer</button>
                            <button onClick={clearGrid}>Vider</button>
                        </div>
                    </section>

                    <section>
                        <strong>Options</strong>
                        <label>
                            Solutions max
                            <input
                                type='number'
                                min={1}
                                max={25}
                                value={maxSolutions}
                                onChange={event => {
                                    setMaxSolutions(Number(event.currentTarget.value) || 1);
                                    markDirty();
                                }}
                            />
                        </label>
                        <label>
                            Timeout Z3 (ms)
                            <input
                                type='number'
                                min={1000}
                                max={30000}
                                step={1000}
                                value={timeoutMs}
                                onChange={event => {
                                    setTimeoutMs(Number(event.currentTarget.value) || 10000);
                                    markDirty();
                                }}
                            />
                        </label>
                    </section>

                    <section>
                        <strong>Cellules surveillees</strong>
                        {watchCells.length ? (
                            <div className='watch-list'>
                                {watchCells.map(ref => (
                                    <button key={ref} onClick={() => toggleWatchCell(ref)}>
                                        {ref}{watchedValues?.[ref] ? ` = ${watchedValues[ref]}` : ''}
                                    </button>
                                ))}
                            </div>
                        ) : (
                            <div className='empty-state'>Aucune cellule surveillee.</div>
                        )}
                        {watchedText && (
                            <div className='watched-output'>
                                <span>Valeur extraite</span>
                                <code>{watchedText}</code>
                            </div>
                        )}
                    </section>

                    <section>
                        <strong>Etat</strong>
                        {solveState.error ? (
                            <div className='grid-puzzle-error'>{solveState.error}</div>
                        ) : (
                            <div className='grid-puzzle-status'>
                                {solveState.result?.summary || 'Pret.'}
                            </div>
                        )}
                        {persistence.error ? (
                            <div className='grid-puzzle-error'>{persistence.error}</div>
                        ) : (
                            <div className='grid-puzzle-status'>
                                {geocacheId
                                    ? persistence.loading
                                        ? 'Chargement de la grille sauvegardee...'
                                        : persistence.dirty
                                            ? 'Modifications non sauvegardees.'
                                            : persistence.message || 'Etat synchronise avec la geocache.'
                                    : 'Ouvrez depuis une geocache pour activer la sauvegarde.'}
                            </div>
                        )}
                        {persistence.updatedAt && (
                            <div className='grid-puzzle-muted'>Derniere sauvegarde: {new Date(persistence.updatedAt).toLocaleString()}</div>
                        )}
                    </section>
                </aside>
            </div>
        </div>
    );
}

@injectable()
export class GridPuzzleWorkbenchWidget extends ReactWidget {
    static readonly ID = 'mysterai-grid-puzzle-workbench';
    static readonly LABEL = 'Grilles';

    protected context?: GeocacheContext;

    @inject(PluginsService)
    protected readonly pluginsService!: PluginsService;

    @inject(MessageService)
    protected readonly messageService!: MessageService;

    constructor() {
        super();
        this.id = GridPuzzleWorkbenchWidget.ID;
        this.title.label = GridPuzzleWorkbenchWidget.LABEL;
        this.title.caption = 'Atelier de grilles de logique';
        this.title.closable = true;
        this.title.iconClass = 'fa fa-th';
    }

    @postConstruct()
    protected init(): void {
        this.update();
    }

    initializeForGeocache(context: GeocacheContext): void {
        this.context = context;
        this.title.label = context.gcCode ? `Grilles - ${context.gcCode}` : GridPuzzleWorkbenchWidget.LABEL;
        this.title.caption = context.name ? `Atelier de grilles - ${context.name}` : 'Atelier de grilles de logique';
        this.update();
    }

    protected render(): React.ReactNode {
        return (
            <GridPuzzleWorkbenchApp
                pluginsService={this.pluginsService}
                messageService={this.messageService}
                context={this.context}
            />
        );
    }
}
