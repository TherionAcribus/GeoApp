import * as React from '@theia/core/shared/react';
import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { MessageService } from '@theia/core/lib/common/message-service';
import { PluginsService, PluginResult } from '../common/plugin-protocol';
import type { GeocacheContext } from './plugin-executor-widget';

import './style/grid-puzzle-workbench.css';

type Grid = string[][];
type RegionGrid = number[][];
type WorkMode = 'edit' | 'watch' | 'parity' | 'chain';
type SudokuVariant = 'sudoku_classic' | 'sudoku_4x4' | 'sudoku_6x6' | 'sudoku_8x8' | 'sudoku_10x10' | 'sudoku_12x12' | 'sudoku_15x15' | 'sudoku_16x16' | 'sudoku_x' | 'sudoku_argyle' | 'sudoku_anti_diagonal' | 'sudoku_center_dot' | 'sudoku_windoku' | 'sudoku_girandola' | 'sudoku_asterisk' | 'sujiken' | 'sudoku_hoshi' | 'samurai_sudoku' | 'flower_sudoku' | 'sohei_sudoku' | 'kazaguruma_sudoku' | 'sudoku_greater_than' | 'sudoku_vudoku' | 'sudoku_rossini' | 'sudoku_xv' | 'sudoku_kropki' | 'chain_sudoku_4x4' | 'chain_sudoku_5x5' | 'chain_sudoku_6x6' | 'chain_sudoku_7x7' | 'chain_sudoku_8x8' | 'chain_sudoku_9x9' | 'sudoku_skyscraper' | 'sudoku_frame' | 'sudoku_outside' | 'sudoku_sandwich' | 'sudoku_little_killer' | 'sudoku_little_unique_killer' | 'sudoku_godoku' | 'sudoku_even_odd' | 'sudoku_non_consecutive' | 'sudoku_mine' | 'sudoku_mine_6x6' | 'sudoku_tripod' | 'sudoku_tripod_4x4' | 'sudoku_tripod_5x5' | 'sudoku_tripod_6x6' | 'sudoku_tripod_7x7' | 'sudoku_tripod_8x8' | 'nonogram' | 'kakuro' | 'hitori';
type KakuroCellKind = 'black' | 'clue' | 'white';
type KakuroTool = KakuroCellKind;
type HitoriTool = 'numbers' | 'shade';
type InequalitySymbol = '' | '>' | '<';
type InequalityGrid = InequalitySymbol[][];
type VudokuSymbol = '' | 'tl' | 'tr' | 'bl' | 'br';
type VudokuGrid = VudokuSymbol[][];
type XvSymbol = '' | 'X' | 'V';
type XvGrid = XvSymbol[][];
type KropkiSymbol = '' | 'white' | 'black';
type KropkiGrid = KropkiSymbol[][];
type ParitySymbol = '' | 'even' | 'odd';
type ParityGrid = ParitySymbol[][];
type TripodDots = boolean[][];
type ChainGrid = number[][];
type ChainPaths = CellCoord[][];
type LittleKillerDirection = 'dl' | 'dr' | 'ul' | 'ur';
type RossiniArrow = '' | '↑' | '↓' | '←' | '→';
type RossiniSide = 'top' | 'bottom' | 'left' | 'right';

type SkyscraperSide = 'top' | 'bottom' | 'left' | 'right';

interface SkyscraperClues {
    top: string[];
    bottom: string[];
    left: string[];
    right: string[];
}

interface FrameClues {
    top: string[];
    bottom: string[];
    left: string[];
    right: string[];
}

interface OutsideClues {
    top: string[];
    bottom: string[];
    left: string[];
    right: string[];
}

interface SandwichClues {
    top: string[];
    bottom: string[];
    left: string[];
    right: string[];
}

interface LittleKillerClue {
    total: string;
    direction: LittleKillerDirection;
}

interface LittleKillerClues {
    top: LittleKillerClue[];
    bottom: LittleKillerClue[];
    left: LittleKillerClue[];
    right: LittleKillerClue[];
}

interface RossiniArrows {
    top: RossiniArrow[];
    bottom: RossiniArrow[];
    left: RossiniArrow[];
    right: RossiniArrow[];
}
type CellCoord = [number, number];

interface ConstraintRegion {
    label: string;
    cells: CellCoord[];
}

interface ConflictHighlights {
    cells: Set<string>;
    messages: string[];
}

interface KakuroCell {
    kind: KakuroCellKind;
    across: string;
    down: string;
}

type KakuroLayout = KakuroCell[][];

interface HoshiCellLayout {
    row: number;
    col: number;
    left: number;
    top: number;
    width: number;
    height: number;
    clipPath: string;
}

interface HoshiCellDefinition {
    axialX: number;
    axialY: number;
    orientation: 'u' | 'd';
    region: number;
}

const SIZE = 9;
const HOSHI_TRIANGLES = 6;
const HOSHI_CELLS_PER_TRIANGLE = 9;
const HOSHI_CELL_UNIT = 34;
const HOSHI_PADDING = 8;
const FLOWER_SIZE = 15;
const SAMURAI_SIZE = 21;
const KAZAGURUMA_COLS = 21;
const SUDOKU_SYMBOL_POOL = '123456789ABCDEFG';
const SIZED_SUDOKU_CONFIGS: Record<string, { size: number; boxRows: number; boxCols: number; label: string }> = {
    sudoku_4x4: { size: 4, boxRows: 2, boxCols: 2, label: 'Sudoku 4x4' },
    sudoku_6x6: { size: 6, boxRows: 2, boxCols: 3, label: 'Sudoku 6x6' },
    sudoku_8x8: { size: 8, boxRows: 2, boxCols: 4, label: 'Sudoku 8x8' },
    sudoku_10x10: { size: 10, boxRows: 2, boxCols: 5, label: 'Sudoku 10x10' },
    sudoku_12x12: { size: 12, boxRows: 3, boxCols: 4, label: 'Sudoku 12x12' },
    sudoku_15x15: { size: 15, boxRows: 3, boxCols: 5, label: 'Sudoku 15x15' },
    sudoku_16x16: { size: 16, boxRows: 4, boxCols: 4, label: 'Sudoku 16x16' },
};
const TRIPOD_SIZE_CONFIGS: Record<string, { size: number; label: string }> = {
    sudoku_tripod: { size: 5, label: 'Tripod 5x5' },
    sudoku_tripod_4x4: { size: 4, label: 'Tripod 4x4' },
    sudoku_tripod_5x5: { size: 5, label: 'Tripod 5x5' },
    sudoku_tripod_6x6: { size: 6, label: 'Tripod 6x6' },
    sudoku_tripod_7x7: { size: 7, label: 'Tripod 7x7' },
    sudoku_tripod_8x8: { size: 8, label: 'Tripod 8x8' },
};
const CHAIN_SIZE_CONFIGS: Record<string, { size: number; label: string }> = {
    chain_sudoku_4x4: { size: 4, label: 'Chain 4x4' },
    chain_sudoku_5x5: { size: 5, label: 'Chain 5x5' },
    chain_sudoku_6x6: { size: 6, label: 'Chain 6x6' },
    chain_sudoku_7x7: { size: 7, label: 'Chain 7x7' },
    chain_sudoku_8x8: { size: 8, label: 'Chain 8x8' },
    chain_sudoku_9x9: { size: 9, label: 'Chain 9x9' },
};
const MINE_CONFIGS: Record<string, { size: number; boxRows: number; boxCols: number; minesPerUnit: number; label: string }> = {
    sudoku_mine: { size: 9, boxRows: 3, boxCols: 3, minesPerUnit: 3, label: 'Sudoku Mine 9x9' },
    sudoku_mine_6x6: { size: 6, boxRows: 2, boxCols: 3, minesPerUnit: 2, label: 'Sudoku Mine 6x6' },
};
const EMPTY_HORIZONTAL_INEQUALITIES: InequalityGrid = Array.from({ length: SIZE }, () => Array(SIZE - 1).fill(''));
const EMPTY_VERTICAL_INEQUALITIES: InequalityGrid = Array.from({ length: SIZE - 1 }, () => Array(SIZE).fill(''));
const EMPTY_VUDOKU_CORNERS: VudokuGrid = Array.from({ length: SIZE - 1 }, () => Array(SIZE - 1).fill(''));
const EMPTY_XV_HORIZONTAL_MARKS: XvGrid = Array.from({ length: SIZE }, () => Array(SIZE - 1).fill(''));
const EMPTY_XV_VERTICAL_MARKS: XvGrid = Array.from({ length: SIZE - 1 }, () => Array(SIZE).fill(''));
const EMPTY_KROPKI_HORIZONTAL_DOTS: KropkiGrid = Array.from({ length: SIZE }, () => Array(SIZE - 1).fill(''));
const EMPTY_KROPKI_VERTICAL_DOTS: KropkiGrid = Array.from({ length: SIZE - 1 }, () => Array(SIZE).fill(''));
const EMPTY_PARITY_MARKS: ParityGrid = Array.from({ length: SIZE }, () => Array(SIZE).fill(''));
const EMPTY_SKYSCRAPER_CLUES: SkyscraperClues = {
    top: Array<string>(SIZE).fill(''),
    bottom: Array<string>(SIZE).fill(''),
    left: Array<string>(SIZE).fill(''),
    right: Array<string>(SIZE).fill(''),
};
const EMPTY_FRAME_CLUES: FrameClues = {
    top: Array<string>(SIZE).fill(''),
    bottom: Array<string>(SIZE).fill(''),
    left: Array<string>(SIZE).fill(''),
    right: Array<string>(SIZE).fill(''),
};
const EMPTY_OUTSIDE_CLUES: OutsideClues = {
    top: Array<string>(SIZE).fill(''),
    bottom: Array<string>(SIZE).fill(''),
    left: Array<string>(SIZE).fill(''),
    right: Array<string>(SIZE).fill(''),
};
const EMPTY_SANDWICH_CLUES: SandwichClues = {
    top: Array<string>(SIZE).fill(''),
    bottom: Array<string>(SIZE).fill(''),
    left: Array<string>(SIZE).fill(''),
    right: Array<string>(SIZE).fill(''),
};
const DEFAULT_LITTLE_KILLER_DIRECTIONS: Record<SkyscraperSide, LittleKillerDirection> = {
    top: 'dr',
    bottom: 'ur',
    left: 'dr',
    right: 'dl',
};
const EMPTY_LITTLE_KILLER_CLUES: LittleKillerClues = {
    top: Array.from({ length: SIZE }, () => ({ total: '', direction: DEFAULT_LITTLE_KILLER_DIRECTIONS.top })),
    bottom: Array.from({ length: SIZE }, () => ({ total: '', direction: DEFAULT_LITTLE_KILLER_DIRECTIONS.bottom })),
    left: Array.from({ length: SIZE }, () => ({ total: '', direction: DEFAULT_LITTLE_KILLER_DIRECTIONS.left })),
    right: Array.from({ length: SIZE }, () => ({ total: '', direction: DEFAULT_LITTLE_KILLER_DIRECTIONS.right })),
};
const EMPTY_ROSSINI_ARROWS: RossiniArrows = {
    top: Array<RossiniArrow>(SIZE).fill(''),
    bottom: Array<RossiniArrow>(SIZE).fill(''),
    left: Array<RossiniArrow>(SIZE).fill(''),
    right: Array<RossiniArrow>(SIZE).fill(''),
};
const QUICK_TEXT_PLACEHOLDER = '0'.repeat(SIZE).concat('\n').repeat(SIZE).trim();
const SUJIKEN_TEXT_PLACEHOLDER = Array.from({ length: SIZE }, (_row, index) => '0'.repeat(index + 1)).join('\n');
const HOSHI_TEXT_PLACEHOLDER = Array.from({ length: HOSHI_TRIANGLES }, () => '0'.repeat(HOSHI_CELLS_PER_TRIANGLE)).join('\n');
const HOSHI_CELL_DEFINITIONS: HoshiCellDefinition[] = [
    { axialX: 0, axialY: 0, orientation: 'd', region: 0 },
    { axialX: 0, axialY: 0, orientation: 'u', region: 0 },
    { axialX: 1, axialY: 0, orientation: 'd', region: 0 },
    { axialX: 1, axialY: 0, orientation: 'u', region: 0 },
    { axialX: 2, axialY: 0, orientation: 'u', region: 0 },
    { axialX: 0, axialY: 1, orientation: 'd', region: 0 },
    { axialX: 0, axialY: 1, orientation: 'u', region: 0 },
    { axialX: 1, axialY: 1, orientation: 'u', region: 0 },
    { axialX: 0, axialY: 2, orientation: 'u', region: 0 },
    { axialX: 3, axialY: -1, orientation: 'd', region: 1 },
    { axialX: 2, axialY: 0, orientation: 'd', region: 1 },
    { axialX: 3, axialY: 0, orientation: 'd', region: 1 },
    { axialX: 3, axialY: 0, orientation: 'u', region: 1 },
    { axialX: 1, axialY: 1, orientation: 'd', region: 1 },
    { axialX: 2, axialY: 1, orientation: 'd', region: 1 },
    { axialX: 2, axialY: 1, orientation: 'u', region: 1 },
    { axialX: 3, axialY: 1, orientation: 'd', region: 1 },
    { axialX: 3, axialY: 1, orientation: 'u', region: 1 },
    { axialX: 2, axialY: 2, orientation: 'd', region: 2 },
    { axialX: 2, axialY: 2, orientation: 'u', region: 2 },
    { axialX: 3, axialY: 2, orientation: 'd', region: 2 },
    { axialX: 3, axialY: 2, orientation: 'u', region: 2 },
    { axialX: 4, axialY: 2, orientation: 'u', region: 2 },
    { axialX: 2, axialY: 3, orientation: 'd', region: 2 },
    { axialX: 2, axialY: 3, orientation: 'u', region: 2 },
    { axialX: 3, axialY: 3, orientation: 'u', region: 2 },
    { axialX: 2, axialY: 4, orientation: 'u', region: 2 },
    { axialX: 1, axialY: 3, orientation: 'd', region: 3 },
    { axialX: 0, axialY: 4, orientation: 'd', region: 3 },
    { axialX: 1, axialY: 4, orientation: 'd', region: 3 },
    { axialX: 1, axialY: 4, orientation: 'u', region: 3 },
    { axialX: -1, axialY: 5, orientation: 'd', region: 3 },
    { axialX: 0, axialY: 5, orientation: 'd', region: 3 },
    { axialX: 0, axialY: 5, orientation: 'u', region: 3 },
    { axialX: 1, axialY: 5, orientation: 'd', region: 3 },
    { axialX: 1, axialY: 5, orientation: 'u', region: 3 },
    { axialX: -2, axialY: 4, orientation: 'd', region: 4 },
    { axialX: -2, axialY: 4, orientation: 'u', region: 4 },
    { axialX: -1, axialY: 4, orientation: 'd', region: 4 },
    { axialX: -1, axialY: 4, orientation: 'u', region: 4 },
    { axialX: 0, axialY: 4, orientation: 'u', region: 4 },
    { axialX: -2, axialY: 5, orientation: 'd', region: 4 },
    { axialX: -2, axialY: 5, orientation: 'u', region: 4 },
    { axialX: -1, axialY: 5, orientation: 'u', region: 4 },
    { axialX: -2, axialY: 6, orientation: 'u', region: 4 },
    { axialX: -1, axialY: 1, orientation: 'd', region: 5 },
    { axialX: -2, axialY: 2, orientation: 'd', region: 5 },
    { axialX: -1, axialY: 2, orientation: 'd', region: 5 },
    { axialX: -1, axialY: 2, orientation: 'u', region: 5 },
    { axialX: -3, axialY: 3, orientation: 'd', region: 5 },
    { axialX: -2, axialY: 3, orientation: 'd', region: 5 },
    { axialX: -2, axialY: 3, orientation: 'u', region: 5 },
    { axialX: -1, axialY: 3, orientation: 'd', region: 5 },
    { axialX: -1, axialY: 3, orientation: 'u', region: 5 },
];
const FLOWER_TEXT_PLACEHOLDER = Array.from({ length: FLOWER_SIZE }, (_row, rowIndex) => (
    Array.from({ length: FLOWER_SIZE }, (_col, colIndex) => (
        isFlowerCell(rowIndex, colIndex) ? '0' : '.'
    )).join('')
)).join('\n');
const SAMURAI_TEXT_PLACEHOLDER = Array.from({ length: SAMURAI_SIZE }, (_row, rowIndex) => (
    Array.from({ length: SAMURAI_SIZE }, (_col, colIndex) => (
        isSamuraiCell(rowIndex, colIndex) ? '0' : '.'
    )).join('')
)).join('\n');
const SOHEI_TEXT_PLACEHOLDER = Array.from({ length: SAMURAI_SIZE }, (_row, rowIndex) => (
    Array.from({ length: SAMURAI_SIZE }, (_col, colIndex) => (
        isSoheiCell(rowIndex, colIndex) ? '0' : '.'
    )).join('')
)).join('\n');
const KAZAGURUMA_TEXT_PLACEHOLDER = Array.from({ length: SAMURAI_SIZE }, (_row, rowIndex) => (
    Array.from({ length: KAZAGURUMA_COLS }, (_col, colIndex) => (
        isKazagurumaCell(rowIndex, colIndex) ? '0' : '.'
    )).join('')
)).join('\n');

function hoshiAxialToXy(point: [number, number]): [number, number] {
    const [x, y] = point;
    return [x + (0.5 * y), (Math.sqrt(3) / 2) * y];
}

function hoshiCellVertices(definition: HoshiCellDefinition): Array<[number, number]> {
    const { axialX, axialY, orientation } = definition;
    if (orientation === 'u') {
        return [[axialX, axialY], [axialX + 1, axialY], [axialX, axialY + 1]];
    }
    return [[axialX + 1, axialY], [axialX, axialY + 1], [axialX + 1, axialY + 1]];
}

function createHoshiLayout(): HoshiCellLayout[] {
    const allPoints = HOSHI_CELL_DEFINITIONS.flatMap(cell => hoshiCellVertices(cell).map(hoshiAxialToXy));
    const minX = Math.min(...allPoints.map(([x]) => x));
    const minY = Math.min(...allPoints.map(([_x, y]) => y));
    const toPixel = (point: [number, number]): [number, number] => {
        const [x, y] = hoshiAxialToXy(point);
        return [
            ((x - minX) * HOSHI_CELL_UNIT) + HOSHI_PADDING,
            ((y - minY) * HOSHI_CELL_UNIT) + HOSHI_PADDING,
        ];
    };
    const localIndexes = Array<number>(HOSHI_TRIANGLES).fill(0);
    return HOSHI_CELL_DEFINITIONS.map(definition => {
        const row = definition.region;
        const col = localIndexes[row];
        localIndexes[row] += 1;
        const points = hoshiCellVertices(definition).map(toPixel);
        const minCellX = Math.min(...points.map(([x]) => x));
        const maxCellX = Math.max(...points.map(([x]) => x));
        const minCellY = Math.min(...points.map(([_x, y]) => y));
        const maxCellY = Math.max(...points.map(([_x, y]) => y));
        const width = maxCellX - minCellX;
        const height = maxCellY - minCellY;
        return {
            row,
            col,
            left: minCellX,
            top: minCellY,
            width,
            height,
            clipPath: `polygon(${points.map(([x, y]) => `${((x - minCellX) / width) * 100}% ${((y - minCellY) / height) * 100}%`).join(', ')})`,
        };
    });
}

const HOSHI_CELL_LAYOUT = createHoshiLayout();
const HOSHI_LAYOUT_BY_REF = new Map(HOSHI_CELL_LAYOUT.map(cell => [`${cell.row}:${cell.col}`, cell]));
const HOSHI_BOARD_WIDTH = Math.max(...HOSHI_CELL_LAYOUT.map(cell => cell.left + cell.width)) + HOSHI_PADDING;
const HOSHI_BOARD_HEIGHT = Math.max(...HOSHI_CELL_LAYOUT.map(cell => cell.top + cell.height)) + HOSHI_PADDING;

function sizedSudokuTextPlaceholder(size: number): string {
    return Array.from({ length: size }, () => '0'.repeat(size)).join('\n');
}

function mineTextPlaceholder(size: number): string {
    return Array.from({ length: size }, () => '.'.repeat(size)).join('\n');
}

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

function kakuroCell(kind: KakuroCellKind, across = '', down = ''): KakuroCell {
    return { kind, across, down };
}

function cloneKakuroLayout(layout: KakuroLayout): KakuroLayout {
    return layout.map(row => row.map(cell => ({ ...cell })));
}

function createKakuroStarterLayout(): KakuroLayout {
    return [
        [kakuroCell('black'), kakuroCell('clue'), kakuroCell('clue')],
        [kakuroCell('clue'), kakuroCell('white'), kakuroCell('white')],
        [kakuroCell('clue'), kakuroCell('white'), kakuroCell('white')],
    ];
}

function defaultKakuroCell(row: number, col: number): KakuroCell {
    if (row === 0 && col === 0) {
        return kakuroCell('black');
    }
    if (row === 0) {
        return kakuroCell('clue', '', '');
    }
    if (col === 0) {
        return kakuroCell('clue', '', '');
    }
    return kakuroCell('white');
}

function resizeKakuroLayout(layout: KakuroLayout, rows: number, cols: number): KakuroLayout {
    return Array.from({ length: rows }, (_row, rowIndex) => (
        Array.from({ length: cols }, (_col, colIndex) => (
            layout[rowIndex]?.[colIndex]
                ? { ...layout[rowIndex][colIndex] }
                : defaultKakuroCell(rowIndex, colIndex)
        ))
    ));
}

function normalizeKakuroValue(rawValue: unknown): string {
    const values = String(rawValue ?? '').match(/[1-9]/g);
    return values?.[values.length - 1] || '';
}

function resizeKakuroGrid(grid: Grid, layout: KakuroLayout): Grid {
    return layout.map((row, rowIndex) => row.map((cell, colIndex) => (
        cell.kind === 'white' ? normalizeKakuroValue(grid[rowIndex]?.[colIndex]) : ''
    )));
}

function normalizeKakuroTotal(rawValue: unknown): string {
    const digits = String(rawValue ?? '').replace(/[^0-9]/g, '').slice(0, 2);
    return digits === '0' ? '' : digits;
}

function normalizeKakuroLayout(value: unknown): KakuroLayout | undefined {
    if (!Array.isArray(value) || value.length < 2 || value.some(row => !Array.isArray(row))) {
        return undefined;
    }
    const cols = value[0].length;
    if (cols < 2 || value.some(row => row.length !== cols)) {
        return undefined;
    }
    return value.map(row => row.map((rawCell: unknown) => {
        if (typeof rawCell === 'object' && rawCell !== null) {
            const cell = rawCell as Record<string, unknown>;
            const kind = cell.kind === 'black' || cell.kind === 'clue' || cell.kind === 'white'
                ? cell.kind
                : cell.type === 'black' || cell.type === 'clue' || cell.type === 'white'
                    ? cell.type
                    : 'white';
            return kakuroCell(
                kind,
                normalizeKakuroTotal(cell.across ?? cell.right ?? cell.horizontal),
                normalizeKakuroTotal(cell.down ?? cell.bottom ?? cell.vertical),
            );
        }
        const text = String(rawCell ?? '').trim().toLowerCase();
        return text === '#' || text === 'black'
            ? kakuroCell('black')
            : text === 'clue' || text === 'sum'
                ? kakuroCell('clue')
                : kakuroCell('white');
    }));
}

function normalizeKakuroGrid(value: unknown, layout: KakuroLayout): Grid {
    if (!Array.isArray(value)) {
        return resizeKakuroGrid([], layout);
    }
    const rawGrid = value.map(row => Array.isArray(row) ? row.map(cell => String(cell ?? '')) : []);
    return resizeKakuroGrid(rawGrid, layout);
}

function kakuroRunCells(layout: KakuroLayout, row: number, col: number, direction: 'across' | 'down'): CellCoord[] {
    const rowStep = direction === 'down' ? 1 : 0;
    const colStep = direction === 'across' ? 1 : 0;
    const cells: CellCoord[] = [];
    let nextRow = row + rowStep;
    let nextCol = col + colStep;
    while (layout[nextRow]?.[nextCol]?.kind === 'white') {
        cells.push([nextRow, nextCol]);
        nextRow += rowStep;
        nextCol += colStep;
    }
    return cells;
}

function kakuroClueError(rawTotal: string, cells: CellCoord[]): string | undefined {
    if (!rawTotal) {
        return undefined;
    }
    const total = Number(rawTotal);
    const length = cells.length;
    if (!Number.isInteger(total) || total < 1) {
        return 'La somme doit etre un entier positif.';
    }
    if (length < 2) {
        return 'Une somme Kakuro doit couvrir au moins deux cases blanches.';
    }
    if (length > 9) {
        return 'Une somme Kakuro ne peut pas couvrir plus de neuf cases.';
    }
    const minimum = length * (length + 1) / 2;
    const maximum = Array.from({ length }, (_unused, index) => 9 - index).reduce((sum, value) => sum + value, 0);
    if (total < minimum || total > maximum) {
        return `Somme impossible pour ${length} cases : entre ${minimum} et ${maximum}.`;
    }
    return undefined;
}

function findKakuroConflicts(layout: KakuroLayout, grid: Grid): ConflictHighlights {
    const cells = new Set<string>();
    const messages: string[] = [];
    layout.forEach((row, rowIndex) => row.forEach((cell, colIndex) => {
        if (cell.kind !== 'clue') {
            return;
        }
        (['across', 'down'] as const).forEach(direction => {
            const runCells = kakuroRunCells(layout, rowIndex, colIndex, direction);
            const clueError = kakuroClueError(cell[direction], runCells);
            if (clueError) {
                messages.push(`Somme ${direction === 'across' ? 'horizontale' : 'verticale'} ${cellRef(rowIndex, colIndex)} : ${clueError}`);
                return;
            }
            const total = Number(cell[direction]);
            if (!Number.isInteger(total) || total < 1 || runCells.length < 1) {
                return;
            }
            const valuesByDigit = new Map<string, string[]>();
            let sum = 0;
            let filledCount = 0;
            runCells.forEach(([runRow, runCol]) => {
                const value = grid[runRow]?.[runCol] || '';
                if (!value) {
                    return;
                }
                const ref = cellRef(runRow, runCol);
                sum += Number(value);
                filledCount += 1;
                const refs = valuesByDigit.get(value) || [];
                refs.push(ref);
                valuesByDigit.set(value, refs);
            });
            valuesByDigit.forEach((refs, digit) => {
                if (refs.length > 1) {
                    refs.forEach(ref => cells.add(ref));
                    messages.push(`Doublon ${digit} dans la somme ${direction === 'across' ? 'horizontale' : 'verticale'} ${cellRef(rowIndex, colIndex)}.`);
                }
            });
            if (sum > total || (filledCount === runCells.length && sum !== total)) {
                runCells.forEach(([runRow, runCol]) => {
                    if (grid[runRow]?.[runCol]) {
                        cells.add(cellRef(runRow, runCol));
                    }
                });
                messages.push(`La somme ${direction === 'across' ? 'horizontale' : 'verticale'} ${cellRef(rowIndex, colIndex)} ne correspond pas a ${total}.`);
            }
        });
    }));
    return { cells, messages: [...new Set(messages)] };
}

function normalizeHitoriValue(rawValue: unknown): string {
    const digits = String(rawValue ?? '').replace(/[^0-9]/g, '').slice(0, 2);
    return digits === '0' ? '' : digits;
}

function resizeHitoriGrid(grid: Grid, rows: number, cols: number): Grid {
    return Array.from({ length: rows }, (_row, rowIndex) => (
        Array.from({ length: cols }, (_col, colIndex) => normalizeHitoriValue(grid[rowIndex]?.[colIndex]))
    ));
}

function resizeHitoriShaded(shaded: boolean[][], rows: number, cols: number): boolean[][] {
    return Array.from({ length: rows }, (_row, rowIndex) => (
        Array.from({ length: cols }, (_col, colIndex) => Boolean(shaded[rowIndex]?.[colIndex]))
    ));
}

function normalizeHitoriGrid(value: unknown, rows: number, cols: number): Grid {
    if (typeof value === 'string') {
        const parsed = value.split(/\r?\n/).filter(Boolean).map(line => {
            const text = line.trim();
            return /[\s,;|]/.test(text) ? text.split(/[\s,;|]+/) : Array.from(text);
        });
        return resizeHitoriGrid(parsed, rows, cols);
    }
    if (!Array.isArray(value)) {
        return createEmptyRectGrid(rows, cols);
    }
    const parsed = value.map(row => Array.isArray(row) ? row.map(cell => String(cell ?? '')) : []);
    return resizeHitoriGrid(parsed, rows, cols);
}

function findHitoriConflicts(grid: Grid, shaded: boolean[][]): ConflictHighlights {
    const cells = new Set<string>();
    const messages: string[] = [];
    const rows = grid.length;
    const cols = grid[0]?.length || 0;
    const hasDuplicate = (row: number, col: number): boolean => {
        const value = grid[row]?.[col] || '';
        if (!value) {
            return false;
        }
        return grid[row].some((candidate, candidateCol) => candidateCol !== col && candidate === value)
            || grid.some((candidateRow, candidateRowIndex) => candidateRowIndex !== row && candidateRow[col] === value);
    };

    for (let row = 0; row < rows; row += 1) {
        for (let col = 0; col < cols; col += 1) {
            if (!shaded[row]?.[col]) {
                continue;
            }
            const ref = cellRef(row, col);
            if (!hasDuplicate(row, col)) {
                cells.add(ref);
                messages.push(`${ref} ne peut pas etre rayee : son nombre n'est pas repete.`);
            }
            for (const [nextRow, nextCol] of [[row + 1, col], [row, col + 1]]) {
                if (shaded[nextRow]?.[nextCol]) {
                    cells.add(ref);
                    cells.add(cellRef(nextRow, nextCol));
                    messages.push(`Les cases rayees ${ref} et ${cellRef(nextRow, nextCol)} se touchent par un cote.`);
                }
            }
        }
    }

    const whiteCells: CellCoord[] = [];
    for (let row = 0; row < rows; row += 1) {
        for (let col = 0; col < cols; col += 1) {
            if (!shaded[row]?.[col]) {
                whiteCells.push([row, col]);
            }
        }
    }
    if (whiteCells.length) {
        const visited = new Set<string>();
        const queue = [whiteCells[0]];
        while (queue.length) {
            const [row, col] = queue.shift()!;
            const key = `${row}:${col}`;
            if (visited.has(key)) {
                continue;
            }
            visited.add(key);
            for (const [nextRow, nextCol] of [[row - 1, col], [row + 1, col], [row, col - 1], [row, col + 1]]) {
                if (nextRow >= 0 && nextRow < rows && nextCol >= 0 && nextCol < cols && !shaded[nextRow]?.[nextCol]) {
                    queue.push([nextRow, nextCol]);
                }
            }
        }
        if (visited.size !== whiteCells.length) {
            whiteCells.forEach(([row, col]) => {
                if (!visited.has(`${row}:${col}`)) {
                    cells.add(cellRef(row, col));
                }
            });
            messages.push('Les cases blanches ne forment plus une zone continue.');
        }
    }
    return { cells, messages: [...new Set(messages)] };
}

function cloneInequalityGrid(grid: InequalityGrid): InequalityGrid {
    return grid.map(row => [...row]);
}

function cloneVudokuGrid(grid: VudokuGrid): VudokuGrid {
    return grid.map(row => [...row]);
}

function cloneXvGrid(grid: XvGrid): XvGrid {
    return grid.map(row => [...row]);
}

function cloneKropkiGrid(grid: KropkiGrid): KropkiGrid {
    return grid.map(row => [...row]);
}

function cloneParityGrid(grid: ParityGrid): ParityGrid {
    return grid.map(row => [...row]);
}

function cloneTripodDots(dots: TripodDots): TripodDots {
    return dots.map(row => [...row]);
}

function cloneChainPaths(paths: ChainPaths): ChainPaths {
    return paths.map(path => path.map(([row, col]): CellCoord => [row, col]));
}

function cloneSkyscraperClues(clues: SkyscraperClues): SkyscraperClues {
    return {
        top: [...clues.top],
        bottom: [...clues.bottom],
        left: [...clues.left],
        right: [...clues.right],
    };
}

function cloneFrameClues(clues: FrameClues): FrameClues {
    return {
        top: [...clues.top],
        bottom: [...clues.bottom],
        left: [...clues.left],
        right: [...clues.right],
    };
}

function cloneOutsideClues(clues: OutsideClues): OutsideClues {
    return {
        top: [...clues.top],
        bottom: [...clues.bottom],
        left: [...clues.left],
        right: [...clues.right],
    };
}

function cloneSandwichClues(clues: SandwichClues): SandwichClues {
    return {
        top: [...clues.top],
        bottom: [...clues.bottom],
        left: [...clues.left],
        right: [...clues.right],
    };
}

function cloneLittleKillerClues(clues: LittleKillerClues): LittleKillerClues {
    return {
        top: clues.top.map(clue => ({ ...clue })),
        bottom: clues.bottom.map(clue => ({ ...clue })),
        left: clues.left.map(clue => ({ ...clue })),
        right: clues.right.map(clue => ({ ...clue })),
    };
}

function cloneRossiniArrows(arrows: RossiniArrows): RossiniArrows {
    return {
        top: [...arrows.top],
        bottom: [...arrows.bottom],
        left: [...arrows.left],
        right: [...arrows.right],
    };
}

function cellRef(row: number, col: number): string {
    return `r${row + 1}c${col + 1}`;
}

function getVariantLabel(puzzleType: SudokuVariant): string {
    const sizedConfig = getSizedSudokuConfig(puzzleType);
    if (sizedConfig) {
        return sizedConfig.label;
    }
    const tripodConfig = getTripodConfig(puzzleType);
    if (tripodConfig) {
        return tripodConfig.label;
    }
    const mineConfig = getMineConfig(puzzleType);
    if (mineConfig) {
        return mineConfig.label;
    }
    if (puzzleType === 'sudoku_x') {
        return 'Sudoku X';
    }
    if (puzzleType === 'sudoku_argyle') {
        return 'Argyle';
    }
    if (puzzleType === 'sudoku_anti_diagonal') {
        return 'Anti Diagonal';
    }
    if (puzzleType === 'sudoku_center_dot') {
        return 'Center Dot';
    }
    if (puzzleType === 'sudoku_windoku') {
        return 'Windoku';
    }
    if (puzzleType === 'sudoku_girandola') {
        return 'Girandola';
    }
    if (puzzleType === 'sudoku_asterisk') {
        return 'Asterisk';
    }
    if (puzzleType === 'sujiken') {
        return 'Sujiken';
    }
    if (puzzleType === 'sudoku_hoshi') {
        return 'Hoshi';
    }
    if (puzzleType === 'samurai_sudoku') {
        return 'Samurai Sudoku';
    }
    if (puzzleType === 'flower_sudoku') {
        return 'Flower Sudoku';
    }
    if (puzzleType === 'sohei_sudoku') {
        return 'Sohei Sudoku';
    }
    if (puzzleType === 'kazaguruma_sudoku') {
        return 'Kazaguruma';
    }
    if (puzzleType === 'sudoku_greater_than') {
        return 'Greater Than';
    }
    if (puzzleType === 'sudoku_vudoku') {
        return 'Vudoku';
    }
    if (puzzleType === 'sudoku_rossini') {
        return 'Rossini';
    }
    if (puzzleType === 'sudoku_xv') {
        return 'Sudoku XV';
    }
    if (puzzleType === 'sudoku_kropki') {
        return 'Kropki';
    }
    if (puzzleType.startsWith('chain_sudoku_')) {
        return `Chain ${gridSizeForVariant(puzzleType)}x${gridSizeForVariant(puzzleType)}`;
    }
    if (puzzleType === 'sudoku_skyscraper') {
        return 'Skyscraper';
    }
    if (puzzleType === 'sudoku_frame') {
        return 'Frame';
    }
    if (puzzleType === 'sudoku_outside') {
        return 'Outside';
    }
    if (puzzleType === 'sudoku_sandwich') {
        return 'Sandwich';
    }
    if (puzzleType === 'sudoku_little_killer') {
        return 'Little Killer';
    }
    if (puzzleType === 'sudoku_little_unique_killer') {
        return 'Little Unique Killer';
    }
    if (puzzleType === 'sudoku_godoku') {
        return 'Godoku';
    }
    if (puzzleType === 'sudoku_even_odd') {
        return 'Even-Odd';
    }
    if (puzzleType === 'sudoku_non_consecutive') {
        return 'Non-Consecutive';
    }
    if (puzzleType === 'nonogram') {
        return 'Nonogram / Picross';
    }
    if (puzzleType === 'kakuro') {
        return 'Kakuro / Cross Sums';
    }
    if (puzzleType === 'hitori') {
        return 'Hitori';
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

function isGirandolaCell(row: number, col: number): boolean {
    return (row === 0 && (col === 0 || col === 8))
        || (row === 1 && col === 4)
        || (row === 4 && (col === 1 || col === 4 || col === 7))
        || (row === 7 && col === 4)
        || (row === 8 && (col === 0 || col === 8));
}

function isAsteriskCell(row: number, col: number): boolean {
    return (row === 1 && col === 4)
        || (row === 2 && (col === 2 || col === 6))
        || (row === 4 && (col === 1 || col === 4 || col === 7))
        || (row === 6 && (col === 2 || col === 6))
        || (row === 7 && col === 4);
}

function isMainDiagonalCell(row: number, col: number): boolean {
    return row === col || row + col === SIZE - 1;
}

function getArgyleDiagonalRegions(): ConstraintRegion[] {
    const regions: CellCoord[][] = [
        [[0, 4], [1, 5], [2, 6], [3, 7], [4, 8]],
        [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 8]],
        [[1, 0], [2, 1], [3, 2], [4, 3], [5, 4], [6, 5], [7, 6], [8, 7]],
        [[4, 0], [5, 1], [6, 2], [7, 3], [8, 4]],
        [[0, 4], [1, 3], [2, 2], [3, 1], [4, 0]],
        [[0, 7], [1, 6], [2, 5], [3, 4], [4, 3], [5, 2], [6, 1], [7, 0]],
        [[1, 8], [2, 7], [3, 6], [4, 5], [5, 4], [6, 3], [7, 2], [8, 1]],
        [[4, 8], [5, 7], [6, 6], [7, 5], [8, 4]],
    ];
    return regions.map((cells, index) => ({
        label: `Argyle diagonale ${index + 1}`,
        cells,
    }));
}

function getArgyleCellClasses(row: number, col: number): string[] {
    let hasDown = false;
    let hasUp = false;
    getArgyleDiagonalRegions().forEach((region, index) => {
        if (!region.cells.some(([regionRow, regionCol]) => regionRow === row && regionCol === col)) {
            return;
        }
        if (index < 4) {
            hasDown = true;
        } else {
            hasUp = true;
        }
    });
    return [
        hasDown ? 'argyle-down' : '',
        hasUp ? 'argyle-up' : '',
    ].filter(Boolean);
}

function isSujikenCell(row: number, col: number): boolean {
    return col <= row;
}

function isSamuraiCell(row: number, col: number): boolean {
    return isInsideSquare(row, col, 0, 0)
        || isInsideSquare(row, col, 0, 12)
        || isInsideSquare(row, col, 6, 6)
        || isInsideSquare(row, col, 12, 0)
        || isInsideSquare(row, col, 12, 12);
}

function isFlowerCell(row: number, col: number): boolean {
    return isInsideSquare(row, col, 0, 3)
        || isInsideSquare(row, col, 3, 0)
        || isInsideSquare(row, col, 3, 3)
        || isInsideSquare(row, col, 3, 6)
        || isInsideSquare(row, col, 6, 3);
}

function isSoheiCell(row: number, col: number): boolean {
    return isInsideSquare(row, col, 0, 6)
        || isInsideSquare(row, col, 6, 0)
        || isInsideSquare(row, col, 6, 12)
        || isInsideSquare(row, col, 12, 6);
}

function isKazagurumaCell(row: number, col: number): boolean {
    return isInsideSquare(row, col, 0, 3)
        || isInsideSquare(row, col, 3, 12)
        || isInsideSquare(row, col, 6, 6)
        || isInsideSquare(row, col, 9, 0)
        || isInsideSquare(row, col, 12, 9);
}

function isInsideSquare(row: number, col: number, offsetRow: number, offsetCol: number): boolean {
    return row >= offsetRow && row < offsetRow + SIZE
        && col >= offsetCol && col < offsetCol + SIZE;
}

function getSizedSudokuConfig(puzzleType: SudokuVariant): { size: number; boxRows: number; boxCols: number; label: string } | undefined {
    return SIZED_SUDOKU_CONFIGS[puzzleType];
}

function getTripodConfig(puzzleType: SudokuVariant): { size: number; label: string } | undefined {
    return TRIPOD_SIZE_CONFIGS[puzzleType];
}

function getChainConfig(puzzleType: SudokuVariant): { size: number; label: string } | undefined {
    return CHAIN_SIZE_CONFIGS[puzzleType];
}

function getMineConfig(
    puzzleType: SudokuVariant,
): { size: number; boxRows: number; boxCols: number; minesPerUnit: number; label: string } | undefined {
    return MINE_CONFIGS[puzzleType];
}

function getSingleGridSudokuConfig(puzzleType: SudokuVariant): { size: number; boxRows: number; boxCols: number; label: string } | undefined {
    if (puzzleType === 'nonogram' || puzzleType === 'kakuro' || puzzleType === 'hitori') {
        return undefined;
    }
    return getSizedSudokuConfig(puzzleType) || {
        size: SIZE,
        boxRows: 3,
        boxCols: 3,
        label: 'Sudoku 9x9',
    };
}

function sudokuSymbolsForSize(size: number): string[] {
    return SUDOKU_SYMBOL_POOL.slice(0, size).split('');
}

function gridSizeForVariant(puzzleType: SudokuVariant): number {
    if (puzzleType === 'samurai_sudoku' || puzzleType === 'sohei_sudoku' || puzzleType === 'kazaguruma_sudoku') {
        return SAMURAI_SIZE;
    }
    if (puzzleType === 'flower_sudoku') {
        return FLOWER_SIZE;
    }
    if (puzzleType === 'sudoku_hoshi') {
        return SIZE;
    }
    const tripodConfig = getTripodConfig(puzzleType);
    if (tripodConfig) {
        return tripodConfig.size;
    }
    const chainConfig = getChainConfig(puzzleType);
    if (chainConfig) {
        return chainConfig.size;
    }
    const mineConfig = getMineConfig(puzzleType);
    if (mineConfig) {
        return mineConfig.size;
    }
    if (puzzleType === 'nonogram' || puzzleType === 'kakuro' || puzzleType === 'hitori') {
        return SIZE;
    }
    return getSingleGridSudokuConfig(puzzleType)?.size || SIZE;
}

function isActiveCellForVariant(puzzleType: SudokuVariant, row: number, col: number): boolean {
    if (puzzleType === 'nonogram' || puzzleType === 'kakuro' || puzzleType === 'hitori') {
        return row >= 0 && col >= 0;
    }
    if (puzzleType === 'sujiken') {
        return isSujikenCell(row, col);
    }
    if (puzzleType === 'sudoku_hoshi') {
        return row >= 0 && row < HOSHI_TRIANGLES && col >= 0 && col < HOSHI_CELLS_PER_TRIANGLE;
    }
    if (puzzleType === 'samurai_sudoku') {
        return isSamuraiCell(row, col);
    }
    if (puzzleType === 'flower_sudoku') {
        return isFlowerCell(row, col);
    }
    if (puzzleType === 'sohei_sudoku') {
        return isSoheiCell(row, col);
    }
    if (puzzleType === 'kazaguruma_sudoku') {
        return isKazagurumaCell(row, col);
    }
    const tripodConfig = getTripodConfig(puzzleType);
    if (tripodConfig) {
        return row >= 0 && row < tripodConfig.size && col >= 0 && col < tripodConfig.size;
    }
    const chainConfig = getChainConfig(puzzleType);
    if (chainConfig) {
        return row >= 0 && row < chainConfig.size && col >= 0 && col < chainConfig.size;
    }
    const mineConfig = getMineConfig(puzzleType);
    if (mineConfig) {
        return row >= 0 && row < mineConfig.size && col >= 0 && col < mineConfig.size;
    }
    const config = getSingleGridSudokuConfig(puzzleType);
    return row >= 0 && row < (config?.size || SIZE) && col >= 0 && col < (config?.size || SIZE);
}

function buildSudokuRegions(
    offsetRow = 0,
    offsetCol = 0,
    label = 'Sudoku',
    size = SIZE,
    boxRows = 3,
    boxCols = 3,
): ConstraintRegion[] {
    const regions: ConstraintRegion[] = [];
    for (let row = 0; row < size; row += 1) {
        regions.push({
            label: `${label} ligne ${row + 1}`,
            cells: Array.from({ length: size }, (_unused, col) => [offsetRow + row, offsetCol + col]),
        });
    }
    for (let col = 0; col < size; col += 1) {
        regions.push({
            label: `${label} colonne ${col + 1}`,
            cells: Array.from({ length: size }, (_unused, row) => [offsetRow + row, offsetCol + col]),
        });
    }
    for (let boxRow = 0; boxRow < size; boxRow += boxRows) {
        for (let boxCol = 0; boxCol < size; boxCol += boxCols) {
            const boxesPerRow = size / boxCols;
            const boxIndex = Math.floor(boxRow / boxRows) * boxesPerRow + Math.floor(boxCol / boxCols) + 1;
            regions.push({
                label: `${label} bloc ${boxIndex}`,
                cells: Array.from({ length: size }, (_unused, index) => [
                    offsetRow + boxRow + Math.floor(index / boxCols),
                    offsetCol + boxCol + (index % boxCols),
                ]),
            });
        }
    }
    return regions;
}

function buildLatinRegions(size: number, label: string): ConstraintRegion[] {
    const regions: ConstraintRegion[] = [];
    for (let row = 0; row < size; row += 1) {
        regions.push({
            label: `${label} ligne ${row + 1}`,
            cells: Array.from({ length: size }, (_unused, col) => [row, col]),
        });
    }
    for (let col = 0; col < size; col += 1) {
        regions.push({
            label: `${label} colonne ${col + 1}`,
            cells: Array.from({ length: size }, (_unused, row) => [row, col]),
        });
    }
    return regions;
}

function buildChainRegions(chainGrid: ChainGrid, size: number): ConstraintRegion[] {
    const regions = new Map<number, CellCoord[]>();
    for (let row = 0; row < size; row += 1) {
        for (let col = 0; col < size; col += 1) {
            const chain = Number(chainGrid[row]?.[col] || 0);
            if (chain < 1 || chain > size) {
                continue;
            }
            const cells = regions.get(chain) || [];
            cells.push([row, col]);
            regions.set(chain, cells);
        }
    }
    return Array.from(regions.entries()).map(([chain, cells]) => ({
        label: `Chain ${chain}`,
        cells,
    }));
}

function buildCompositeSudokuRegions(offsets: Array<[number, number, string]>): ConstraintRegion[] {
    return offsets.flatMap(([row, col, label]) => buildSudokuRegions(row, col, label));
}

function getAllDifferentRegions(puzzleType: SudokuVariant): ConstraintRegion[] {
    const tripodConfig = getTripodConfig(puzzleType);
    const chainConfig = getChainConfig(puzzleType);
    if (getMineConfig(puzzleType)) {
        return [];
    }
    const regions = puzzleType === 'sujiken'
        ? getSujikenRegions()
        : puzzleType === 'sudoku_hoshi'
            ? Array.from({ length: HOSHI_TRIANGLES }, (_unused, region) => ({
                label: `Hoshi triangle ${region + 1}`,
                cells: Array.from({ length: HOSHI_CELLS_PER_TRIANGLE }, (_cell, localIndex): CellCoord => [region, localIndex]),
            }))
        : puzzleType === 'samurai_sudoku'
            ? buildCompositeSudokuRegions([
                [0, 0, 'Samurai haut gauche'],
                [0, 12, 'Samurai haut droit'],
                [6, 6, 'Samurai centre'],
                [12, 0, 'Samurai bas gauche'],
                [12, 12, 'Samurai bas droit'],
            ])
        : puzzleType === 'flower_sudoku'
            ? buildCompositeSudokuRegions([
                [0, 3, 'Flower haut'],
                [3, 0, 'Flower gauche'],
                [3, 3, 'Flower centre'],
                [3, 6, 'Flower droite'],
                [6, 3, 'Flower bas'],
            ])
        : puzzleType === 'sohei_sudoku'
            ? buildCompositeSudokuRegions([
                [0, 6, 'Sohei haut'],
                [6, 0, 'Sohei gauche'],
                [6, 12, 'Sohei droite'],
                [12, 6, 'Sohei bas'],
            ])
        : puzzleType === 'kazaguruma_sudoku'
            ? buildCompositeSudokuRegions([
                [0, 3, 'Kazaguruma haut'],
                [3, 12, 'Kazaguruma droite'],
                [6, 6, 'Kazaguruma centre'],
                [9, 0, 'Kazaguruma gauche'],
                [12, 9, 'Kazaguruma bas'],
            ])
        : tripodConfig
            ? buildLatinRegions(tripodConfig.size, tripodConfig.label)
        : chainConfig
            ? buildLatinRegions(chainConfig.size, chainConfig.label)
        : (() => {
            const config = getSingleGridSudokuConfig(puzzleType);
            return buildSudokuRegions(0, 0, config?.label || 'Sudoku', config?.size, config?.boxRows, config?.boxCols);
        })();

    if (puzzleType === 'sudoku_x') {
        regions.push(
            {
                label: 'Sudoku X diagonale principale',
                cells: Array.from({ length: SIZE }, (_unused, index) => [index, index]),
            },
            {
                label: 'Sudoku X diagonale secondaire',
                cells: Array.from({ length: SIZE }, (_unused, index) => [index, SIZE - 1 - index]),
            }
        );
    }
    if (puzzleType === 'sudoku_argyle') {
        regions.push(...getArgyleDiagonalRegions());
    }
    if (puzzleType === 'sudoku_center_dot') {
        regions.push({
            label: 'Center Dot',
            cells: Array.from({ length: SIZE }, (_unused, index) => [
                Math.floor(index / 3) * 3 + 1,
                (index % 3) * 3 + 1,
            ]),
        });
    }
    if (puzzleType === 'sudoku_windoku') {
        for (const row of [1, 5]) {
            for (const col of [1, 5]) {
                regions.push({
                    label: `Windoku region r${row + 1}c${col + 1}`,
                    cells: Array.from({ length: SIZE }, (_unused, index) => [
                        row + Math.floor(index / 3),
                        col + (index % 3),
                    ]),
                });
            }
        }
    }
    if (puzzleType === 'sudoku_girandola') {
        regions.push({
            label: 'Girandola',
            cells: [[0, 0], [0, 8], [1, 4], [4, 1], [4, 4], [4, 7], [7, 4], [8, 0], [8, 8]],
        });
    }
    if (puzzleType === 'sudoku_asterisk') {
        regions.push({
            label: 'Asterisk',
            cells: [[1, 4], [2, 2], [2, 6], [4, 1], [4, 4], [4, 7], [6, 2], [6, 6], [7, 4]],
        });
    }
    return regions;
}

function getSujikenRegions(): ConstraintRegion[] {
    const regions: ConstraintRegion[] = [];
    for (let row = 0; row < SIZE; row += 1) {
        regions.push({
            label: `Sujiken rangee ${row + 1}`,
            cells: Array.from({ length: row + 1 }, (_unused, col) => [row, col]),
        });
    }
    for (let col = 0; col < SIZE; col += 1) {
        regions.push({
            label: `Sujiken colonne ${col + 1}`,
            cells: Array.from({ length: SIZE - col }, (_unused, index) => [col + index, col]),
        });
    }
    for (let diagonal = 0; diagonal < SIZE; diagonal += 1) {
        regions.push({
            label: `Sujiken diagonale ${diagonal + 1}`,
            cells: Array.from({ length: SIZE - diagonal }, (_unused, index) => [
                diagonal + index,
                index,
            ]),
        });
    }
    regions.push(
        {
            label: 'Sujiken region 1',
            cells: Array.from({ length: 6 }, (_unused, index) => {
                const row = index < 1 ? 0 : index < 3 ? 1 : 2;
                const start = row === 0 ? 0 : row === 1 ? 1 : 3;
                return [row, index - start];
            }),
        },
        {
            label: 'Sujiken region 2',
            cells: Array.from({ length: 9 }, (_unused, index) => [3 + Math.floor(index / 3), index % 3]),
        },
        {
            label: 'Sujiken region 3',
            cells: Array.from({ length: 6 }, (_unused, index) => {
                const row = index < 1 ? 3 : index < 3 ? 4 : 5;
                const start = row === 3 ? 0 : row === 4 ? 1 : 3;
                return [row, 3 + index - start];
            }),
        },
        {
            label: 'Sujiken region 4',
            cells: Array.from({ length: 9 }, (_unused, index) => [6 + Math.floor(index / 3), index % 3]),
        },
        {
            label: 'Sujiken region 5',
            cells: Array.from({ length: 9 }, (_unused, index) => [6 + Math.floor(index / 3), 3 + (index % 3)]),
        },
        {
            label: 'Sujiken region 6',
            cells: Array.from({ length: 6 }, (_unused, index) => {
                const row = index < 1 ? 6 : index < 3 ? 7 : 8;
                const start = row === 6 ? 0 : row === 7 ? 1 : 3;
                return [row, 6 + index - start];
            }),
        }
    );
    return regions;
}

function findConstraintConflicts(
    grid: Grid,
    puzzleType: SudokuVariant,
    horizontalInequalities: InequalityGrid,
    verticalInequalities: InequalityGrid,
    vudokuCorners: VudokuGrid,
    rossiniArrows: RossiniArrows,
    xvHorizontalMarks: XvGrid,
    xvVerticalMarks: XvGrid,
    kropkiHorizontalDots: KropkiGrid,
    kropkiVerticalDots: KropkiGrid,
    chainGrid: ChainGrid,
    skyscraperClues: SkyscraperClues,
    frameClues: FrameClues,
    outsideClues: OutsideClues,
    sandwichClues: SandwichClues,
    littleKillerClues: LittleKillerClues,
    parityMarks: ParityGrid,
): ConflictHighlights {
    const cells = new Set<string>();
    const messages: string[] = [];

    if (puzzleType === 'nonogram' || puzzleType === 'kakuro' || puzzleType === 'hitori') {
        return { cells, messages };
    }

    const chainConfig = getChainConfig(puzzleType);
    const regions = getAllDifferentRegions(puzzleType);
    if (chainConfig) {
        regions.push(...buildChainRegions(chainGrid, chainConfig.size));
    }

    for (const region of regions) {
        const byValue = new Map<string, string[]>();
        for (const [row, col] of region.cells) {
            if (!isActiveCellForVariant(puzzleType, row, col)) {
                continue;
            }
            const value = grid[row]?.[col] || '';
            if (!value) {
                continue;
            }
            const refs = byValue.get(value) || [];
            refs.push(cellRef(row, col));
            byValue.set(value, refs);
        }
        for (const [value, refs] of byValue.entries()) {
            if (refs.length < 2) {
                continue;
            }
            refs.forEach(ref => cells.add(ref));
            messages.push(`Doublon ${value} dans ${region.label} : ${refs.join(', ')}`);
        }
    }

    if (puzzleType === 'sudoku_anti_diagonal') {
        addMaxDistinctConflict(
            grid,
            cells,
            messages,
            'Anti Diagonal diagonale principale',
            Array.from({ length: SIZE }, (_unused, index) => [index, index]),
            3,
        );
        addMaxDistinctConflict(
            grid,
            cells,
            messages,
            'Anti Diagonal diagonale secondaire',
            Array.from({ length: SIZE }, (_unused, index) => [index, SIZE - 1 - index]),
            3,
        );
    }

    if (puzzleType === 'sudoku_greater_than') {
        horizontalInequalities.forEach((row, rowIndex) => {
            row.forEach((relation, colIndex) => {
                addInequalityConflict(grid, cells, messages, relation, rowIndex, colIndex, rowIndex, colIndex + 1);
            });
        });
        verticalInequalities.forEach((row, rowIndex) => {
            row.forEach((relation, colIndex) => {
                addInequalityConflict(grid, cells, messages, relation, rowIndex, colIndex, rowIndex + 1, colIndex);
            });
        });
    }

    if (puzzleType === 'sudoku_vudoku') {
        addVudokuConflicts(grid, cells, messages, vudokuCorners);
    }

    if (puzzleType === 'sudoku_rossini') {
        addRossiniConflicts(grid, cells, messages, rossiniArrows);
    }

    if (puzzleType === 'sudoku_xv') {
        xvHorizontalMarks.forEach((row, rowIndex) => {
            row.forEach((mark, colIndex) => {
                addXvConflict(grid, cells, messages, mark, rowIndex, colIndex, rowIndex, colIndex + 1);
            });
        });
        xvVerticalMarks.forEach((row, rowIndex) => {
            row.forEach((mark, colIndex) => {
                addXvConflict(grid, cells, messages, mark, rowIndex, colIndex, rowIndex + 1, colIndex);
            });
        });
    }

    if (puzzleType === 'sudoku_kropki') {
        kropkiHorizontalDots.forEach((row, rowIndex) => {
            row.forEach((mark, colIndex) => {
                addKropkiConflict(grid, cells, messages, mark, rowIndex, colIndex, rowIndex, colIndex + 1);
            });
        });
        kropkiVerticalDots.forEach((row, rowIndex) => {
            row.forEach((mark, colIndex) => {
                addKropkiConflict(grid, cells, messages, mark, rowIndex, colIndex, rowIndex + 1, colIndex);
            });
        });
    }

    if (puzzleType === 'sudoku_skyscraper') {
        addSkyscraperConflicts(grid, cells, messages, skyscraperClues);
    }

    if (puzzleType === 'sudoku_frame') {
        addFrameConflicts(grid, cells, messages, frameClues);
    }

    if (puzzleType === 'sudoku_outside') {
        addOutsideConflicts(grid, cells, messages, outsideClues);
    }

    if (puzzleType === 'sudoku_sandwich') {
        addSandwichConflicts(grid, cells, messages, activeSandwichClues(sandwichClues));
    }

    if (puzzleType === 'sudoku_little_killer' || puzzleType === 'sudoku_little_unique_killer') {
        addLittleKillerConflicts(
            grid,
            cells,
            messages,
            littleKillerClues,
            puzzleType === 'sudoku_little_unique_killer',
        );
    }

    if (puzzleType === 'sudoku_even_odd') {
        addParityConflicts(grid, cells, messages, parityMarks);
    }

    if (puzzleType === 'sudoku_non_consecutive') {
        addNonConsecutiveConflicts(grid, cells, messages);
    }

    return { cells, messages };
}

function addMaxDistinctConflict(
    grid: Grid,
    cells: Set<string>,
    messages: string[],
    label: string,
    regionCells: CellCoord[],
    limit: number,
): void {
    const values = new Map<string, string[]>();
    for (const [row, col] of regionCells) {
        const value = grid[row]?.[col] || '';
        if (!value) {
            continue;
        }
        const refs = values.get(value) || [];
        refs.push(cellRef(row, col));
        values.set(value, refs);
    }
    if (values.size <= limit) {
        return;
    }
    const refs = [...values.values()].flat();
    refs.forEach(ref => cells.add(ref));
    messages.push(`${label} utilise ${values.size} chiffres differents, maximum ${limit} : ${refs.join(', ')}`);
}

function addInequalityConflict(
    grid: Grid,
    cells: Set<string>,
    messages: string[],
    relation: InequalitySymbol,
    firstRow: number,
    firstCol: number,
    secondRow: number,
    secondCol: number,
): void {
    if (!relation) {
        return;
    }
    const firstValue = Number(grid[firstRow]?.[firstCol] || 0);
    const secondValue = Number(grid[secondRow]?.[secondCol] || 0);
    if (!firstValue || !secondValue) {
        return;
    }
    const valid = relation === '>' ? firstValue > secondValue : firstValue < secondValue;
    if (valid) {
        return;
    }
    const firstRef = cellRef(firstRow, firstCol);
    const secondRef = cellRef(secondRow, secondCol);
    cells.add(firstRef);
    cells.add(secondRef);
    messages.push(`Inegalite ${firstRef} ${relation} ${secondRef} non respectee`);
}

function addVudokuConflicts(
    grid: Grid,
    cells: Set<string>,
    messages: string[],
    corners: VudokuGrid,
): void {
    corners.forEach((row, rowIndex) => {
        row.forEach((corner, colIndex) => {
            if (!corner) {
                return;
            }
            const [vertex, firstArm, secondArm] = vudokuCells(rowIndex, colIndex, corner);
            const vertexValue = Number(grid[vertex[0]]?.[vertex[1]] || 0);
            const firstValue = Number(grid[firstArm[0]]?.[firstArm[1]] || 0);
            const secondValue = Number(grid[secondArm[0]]?.[secondArm[1]] || 0);
            if (!vertexValue || !firstValue || !secondValue) {
                return;
            }
            if (vertexValue === firstValue + secondValue || vertexValue === Math.abs(firstValue - secondValue)) {
                return;
            }
            const refs = [vertex, firstArm, secondArm].map(([cellRow, cellCol]) => cellRef(cellRow, cellCol));
            refs.forEach(ref => cells.add(ref));
            messages.push(`Coin Vudoku ${rowIndex + 1},${colIndex + 1} non respecte : ${refs.join(', ')}`);
        });
    });
}

function vudokuCells(row: number, col: number, corner: VudokuSymbol): [CellCoord, CellCoord, CellCoord] {
    if (corner === 'tl') {
        return [[row, col], [row, col + 1], [row + 1, col]];
    }
    if (corner === 'tr') {
        return [[row, col + 1], [row, col], [row + 1, col + 1]];
    }
    if (corner === 'bl') {
        return [[row + 1, col], [row, col], [row + 1, col + 1]];
    }
    return [[row + 1, col + 1], [row, col + 1], [row + 1, col]];
}

function cycleVudokuCorner(value: VudokuSymbol): VudokuSymbol {
    const sequence: VudokuSymbol[] = ['', 'tl', 'tr', 'br', 'bl'];
    const currentIndex = sequence.indexOf(value);
    return sequence[(currentIndex + 1) % sequence.length];
}

function addXvConflict(
    grid: Grid,
    cells: Set<string>,
    messages: string[],
    mark: XvSymbol,
    firstRow: number,
    firstCol: number,
    secondRow: number,
    secondCol: number,
): void {
    const firstValue = Number(grid[firstRow]?.[firstCol] || 0);
    const secondValue = Number(grid[secondRow]?.[secondCol] || 0);
    if (!firstValue || !secondValue) {
        return;
    }
    const total = firstValue + secondValue;
    const valid = mark === 'X'
        ? total === 10
        : mark === 'V'
            ? total === 5
            : total !== 5 && total !== 10;
    if (valid) {
        return;
    }
    const firstRef = cellRef(firstRow, firstCol);
    const secondRef = cellRef(secondRow, secondCol);
    cells.add(firstRef);
    cells.add(secondRef);
    messages.push(
        mark
            ? `Marque XV ${mark} non respectee entre ${firstRef} et ${secondRef} : somme ${total}`
            : `Absence de marque XV entre ${firstRef} et ${secondRef} : somme ${total}`,
    );
}

function addKropkiConflict(
    grid: Grid,
    cells: Set<string>,
    messages: string[],
    mark: KropkiSymbol,
    firstRow: number,
    firstCol: number,
    secondRow: number,
    secondCol: number,
): void {
    const firstValue = Number(grid[firstRow]?.[firstCol] || 0);
    const secondValue = Number(grid[secondRow]?.[secondCol] || 0);
    if (!firstValue || !secondValue) {
        return;
    }
    const isConsecutive = Math.abs(firstValue - secondValue) === 1;
    const isDouble = firstValue === secondValue * 2 || secondValue === firstValue * 2;
    const valid = mark === 'white'
        ? isConsecutive
        : mark === 'black'
            ? isDouble
            : !isConsecutive && !isDouble;
    if (valid) {
        return;
    }
    const firstRef = cellRef(firstRow, firstCol);
    const secondRef = cellRef(secondRow, secondCol);
    cells.add(firstRef);
    cells.add(secondRef);
    const relation = isConsecutive && isDouble
        ? 'consecutifs et doubles'
        : isConsecutive
            ? 'consecutifs'
            : isDouble
                ? 'doubles'
                : 'sans relation Kropki';
    messages.push(
        mark
            ? `Rond Kropki ${mark === 'white' ? 'blanc' : 'noir'} non respecte entre ${firstRef} et ${secondRef}`
            : `Absence de rond Kropki entre ${firstRef} et ${secondRef} : chiffres ${relation}`,
    );
}

function addParityConflicts(
    grid: Grid,
    cells: Set<string>,
    messages: string[],
    parityMarks: ParityGrid,
): void {
    parityMarks.forEach((row, rowIndex) => {
        row.forEach((mark, colIndex) => {
            if (!mark) {
                return;
            }
            const value = Number(grid[rowIndex]?.[colIndex] || 0);
            if (!value) {
                return;
            }
            const valid = mark === 'even' ? value % 2 === 0 : value % 2 === 1;
            if (valid) {
                return;
            }
            const ref = cellRef(rowIndex, colIndex);
            cells.add(ref);
            messages.push(`Parite ${mark === 'even' ? 'paire' : 'impaire'} non respectee en ${ref}`);
        });
    });
}

function addNonConsecutiveConflicts(
    grid: Grid,
    cells: Set<string>,
    messages: string[],
): void {
    for (let row = 0; row < SIZE; row += 1) {
        for (let col = 0; col < SIZE; col += 1) {
            if (col < SIZE - 1) {
                addNonConsecutiveConflict(grid, cells, messages, row, col, row, col + 1);
            }
            if (row < SIZE - 1) {
                addNonConsecutiveConflict(grid, cells, messages, row, col, row + 1, col);
            }
        }
    }
}

function addNonConsecutiveConflict(
    grid: Grid,
    cells: Set<string>,
    messages: string[],
    firstRow: number,
    firstCol: number,
    secondRow: number,
    secondCol: number,
): void {
    const firstValue = Number(grid[firstRow]?.[firstCol] || 0);
    const secondValue = Number(grid[secondRow]?.[secondCol] || 0);
    if (!firstValue || !secondValue || Math.abs(firstValue - secondValue) !== 1) {
        return;
    }
    const firstRef = cellRef(firstRow, firstCol);
    const secondRef = cellRef(secondRow, secondCol);
    cells.add(firstRef);
    cells.add(secondRef);
    messages.push(`Voisins consecutifs interdits entre ${firstRef} et ${secondRef}`);
}

function addSkyscraperConflicts(
    grid: Grid,
    cells: Set<string>,
    messages: string[],
    clues: SkyscraperClues,
): void {
    (['top', 'bottom', 'left', 'right'] as SkyscraperSide[]).forEach(side => {
        clues[side].forEach((clue, index) => {
            if (!clue) {
                return;
            }
            const lineCells = skyscraperCells(side, index);
            const values = lineCells.map(([row, col]) => Number(grid[row]?.[col] || 0));
            if (values.some(value => !value)) {
                return;
            }
            const visible = countVisibleSkyscrapers(values);
            if (visible === Number(clue)) {
                return;
            }
            const refs = lineCells.map(([row, col]) => cellRef(row, col));
            refs.forEach(ref => cells.add(ref));
            messages.push(`Indice Skyscraper ${skyscraperSideLabel(side)} ${index + 1} attendu ${clue}, visible ${visible} : ${refs.join(', ')}`);
        });
    });
}

function skyscraperCells(side: SkyscraperSide, index: number): CellCoord[] {
    if (side === 'left') {
        return Array.from({ length: SIZE }, (_unused, col): CellCoord => [index, col]);
    }
    if (side === 'right') {
        return Array.from({ length: SIZE }, (_unused, offset): CellCoord => [index, SIZE - 1 - offset]);
    }
    if (side === 'top') {
        return Array.from({ length: SIZE }, (_unused, row): CellCoord => [row, index]);
    }
    return Array.from({ length: SIZE }, (_unused, offset): CellCoord => [SIZE - 1 - offset, index]);
}

function countVisibleSkyscrapers(values: number[]): number {
    let highest = 0;
    let visible = 0;
    values.forEach(value => {
        if (value > highest) {
            highest = value;
            visible += 1;
        }
    });
    return visible;
}

function skyscraperSideLabel(side: SkyscraperSide): string {
    return side === 'top' ? 'haut' : side === 'bottom' ? 'bas' : side === 'left' ? 'gauche' : 'droite';
}

function addFrameConflicts(
    grid: Grid,
    cells: Set<string>,
    messages: string[],
    clues: FrameClues,
): void {
    (['top', 'bottom', 'left', 'right'] as SkyscraperSide[]).forEach(side => {
        clues[side].forEach((clue, index) => {
            if (!clue) {
                return;
            }
            const triplet = frameCells(side, index);
            const values = triplet.map(([row, col]) => Number(grid[row]?.[col] || 0));
            if (values.some(value => !value)) {
                return;
            }
            const total = values.reduce((sum, value) => sum + value, 0);
            if (total === Number(clue)) {
                return;
            }
            const refs = triplet.map(([row, col]) => cellRef(row, col));
            refs.forEach(ref => cells.add(ref));
            messages.push(`Indice Frame ${skyscraperSideLabel(side)} ${index + 1} attendu ${clue}, somme ${total} : ${refs.join(', ')}`);
        });
    });
}

function frameCells(side: SkyscraperSide, index: number): CellCoord[] {
    if (side === 'left') {
        return [[index, 0], [index, 1], [index, 2]];
    }
    if (side === 'right') {
        return [[index, 6], [index, 7], [index, 8]];
    }
    if (side === 'top') {
        return [[0, index], [1, index], [2, index]];
    }
    return [[6, index], [7, index], [8, index]];
}

function addOutsideConflicts(
    grid: Grid,
    cells: Set<string>,
    messages: string[],
    clues: OutsideClues,
): void {
    (['top', 'bottom', 'left', 'right'] as SkyscraperSide[]).forEach(side => {
        clues[side].forEach((clue, index) => {
            if (!clue) {
                return;
            }
            const triplet = outsideCells(side, index);
            const values = triplet.map(([row, col]) => grid[row]?.[col] || '');
            if (values.some(value => !value)) {
                return;
            }
            const missing = clue.split('').filter(digit => !values.includes(digit));
            if (!missing.length) {
                return;
            }
            const refs = triplet.map(([row, col]) => cellRef(row, col));
            refs.forEach(ref => cells.add(ref));
            messages.push(`Indice Outside ${skyscraperSideLabel(side)} ${index + 1} absent (${missing.join(', ')}) dans ${refs.join(', ')}`);
        });
    });
}

function outsideCells(side: SkyscraperSide, index: number): CellCoord[] {
    if (side === 'left') {
        return [[index, 0], [index, 1], [index, 2]];
    }
    if (side === 'right') {
        return [[index, 8], [index, 7], [index, 6]];
    }
    if (side === 'top') {
        return [[0, index], [1, index], [2, index]];
    }
    return [[8, index], [7, index], [6, index]];
}

function addSandwichConflicts(
    grid: Grid,
    cells: Set<string>,
    messages: string[],
    clues: SandwichClues,
): void {
    (['top', 'bottom', 'left', 'right'] as SkyscraperSide[]).forEach(side => {
        clues[side].forEach((clue, index) => {
            if (clue === '') {
                return;
            }
            const lineCells = skyscraperCells(side, index);
            const values = lineCells.map(([row, col]) => Number(grid[row]?.[col] || 0));
            if (values.some(value => !value)) {
                return;
            }
            const oneIndex = values.indexOf(1);
            const nineIndex = values.indexOf(9);
            if (oneIndex < 0 || nineIndex < 0) {
                return;
            }
            const start = Math.min(oneIndex, nineIndex) + 1;
            const end = Math.max(oneIndex, nineIndex);
            const total = values.slice(start, end).reduce((sum, value) => sum + value, 0);
            if (total === Number(clue)) {
                return;
            }
            const involvedCells = lineCells.slice(Math.min(oneIndex, nineIndex), Math.max(oneIndex, nineIndex) + 1);
            const refs = involvedCells.map(([row, col]) => cellRef(row, col));
            refs.forEach(ref => cells.add(ref));
            messages.push(`Indice Sandwich ${skyscraperSideLabel(side)} ${index + 1} attendu ${clue}, somme ${total} : ${refs.join(', ')}`);
        });
    });
}

function addLittleKillerConflicts(
    grid: Grid,
    cells: Set<string>,
    messages: string[],
    clues: LittleKillerClues,
    unique = false,
): void {
    (['top', 'bottom', 'left', 'right'] as SkyscraperSide[]).forEach(side => {
        clues[side].forEach((clue, index) => {
            if (!clue.total) {
                return;
            }
            const diagonal = littleKillerCells(side, index, clue.direction);
            if (unique) {
                const byValue = new Map<string, string[]>();
                diagonal.forEach(([row, col]) => {
                    const value = grid[row]?.[col] || '';
                    if (!value) {
                        return;
                    }
                    const refs = byValue.get(value) || [];
                    refs.push(cellRef(row, col));
                    byValue.set(value, refs);
                });
                for (const [value, refs] of byValue.entries()) {
                    if (refs.length > 1) {
                        refs.forEach(ref => cells.add(ref));
                        messages.push(`Doublon ${value} sur Little Unique Killer ${skyscraperSideLabel(side)} ${index + 1} : ${refs.join(', ')}`);
                    }
                }
            }
            const values = diagonal.map(([row, col]) => Number(grid[row]?.[col] || 0));
            if (values.some(value => !value)) {
                return;
            }
            const total = values.reduce((sum, value) => sum + value, 0);
            if (total === Number(clue.total)) {
                return;
            }
            const refs = diagonal.map(([row, col]) => cellRef(row, col));
            refs.forEach(ref => cells.add(ref));
            messages.push(`Indice Little Killer ${skyscraperSideLabel(side)} ${index + 1} attendu ${clue.total}, somme ${total} : ${refs.join(', ')}`);
        });
    });
}

function littleKillerCells(side: SkyscraperSide, index: number, direction: LittleKillerDirection): CellCoord[] {
    const starts: Record<SkyscraperSide, CellCoord> = {
        top: [0, index],
        bottom: [SIZE - 1, index],
        left: [index, 0],
        right: [index, SIZE - 1],
    };
    const deltas: Record<LittleKillerDirection, CellCoord> = {
        dl: [1, -1],
        dr: [1, 1],
        ul: [-1, -1],
        ur: [-1, 1],
    };
    const [rowDelta, colDelta] = deltas[direction];
    let [row, col] = starts[side];
    const diagonal: CellCoord[] = [];
    while (row >= 0 && row < SIZE && col >= 0 && col < SIZE) {
        diagonal.push([row, col]);
        row += rowDelta;
        col += colDelta;
    }
    return diagonal;
}

function addRossiniConflicts(
    grid: Grid,
    cells: Set<string>,
    messages: string[],
    arrows: RossiniArrows,
): void {
    (['top', 'bottom', 'left', 'right'] as RossiniSide[]).forEach(side => {
        arrows[side].forEach((arrow, index) => {
            const triplet = rossiniCells(side, index);
            const values = triplet.map(([row, col]) => Number(grid[row]?.[col] || 0));
            if (values.some(value => !value)) {
                return;
            }
            const increasing = values[0] < values[1] && values[1] < values[2];
            const decreasing = values[0] > values[1] && values[1] > values[2];
            const expectsIncreasing = arrow === '→' || arrow === '↓';
            const expectsDecreasing = arrow === '←' || arrow === '↑';
            const violatesArrow = expectsIncreasing ? !increasing : expectsDecreasing ? !decreasing : false;
            const violatesAbsence = !arrow && (increasing || decreasing);
            if (!violatesArrow && !violatesAbsence) {
                return;
            }
            const refs = triplet.map(([row, col]) => cellRef(row, col));
            refs.forEach(ref => cells.add(ref));
            if (arrow) {
                messages.push(`Fleche Rossini ${rossiniSideLabel(side)} ${index + 1} non respectee : ${refs.join(', ')}`);
            } else {
                messages.push(`Absence de fleche Rossini ${rossiniSideLabel(side)} ${index + 1} : les trois cases forment une suite`);
            }
        });
    });
}

function rossiniCells(side: RossiniSide, index: number): CellCoord[] {
    if (side === 'left') {
        return [[index, 0], [index, 1], [index, 2]];
    }
    if (side === 'right') {
        return [[index, 6], [index, 7], [index, 8]];
    }
    if (side === 'top') {
        return [[0, index], [1, index], [2, index]];
    }
    return [[6, index], [7, index], [8, index]];
}

function rossiniSideLabel(side: RossiniSide): string {
    return side === 'top' ? 'haut' : side === 'bottom' ? 'bas' : side === 'left' ? 'gauche' : 'droite';
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

function getSamuraiBoundaryClasses(row: number, col: number): string[] {
    if (!isSamuraiCell(row, col)) {
        return [];
    }

    const classes = new Set<string>();
    for (const [offsetRow, offsetCol] of [[0, 0], [0, 12], [6, 6], [12, 0], [12, 12]]) {
        if (!isInsideSquare(row, col, offsetRow, offsetCol)) {
            continue;
        }
        const localRow = row - offsetRow;
        const localCol = col - offsetCol;
        if (localCol === 0 && !isSamuraiCell(row, col - 1)) {
            classes.add('block-left');
        }
        if (localCol === 2 || localCol === 5 || localCol === 8) {
            classes.add('block-right');
        }
        if (localRow === 0 && !isSamuraiCell(row - 1, col)) {
            classes.add('block-top');
        }
        if (localRow === 2 || localRow === 5 || localRow === 8) {
            classes.add('block-bottom');
        }
    }
    return [...classes];
}

function getFlowerBoundaryClasses(row: number, col: number): string[] {
    if (!isFlowerCell(row, col)) {
        return [];
    }

    const classes = new Set<string>();
    for (const [offsetRow, offsetCol] of [[0, 3], [3, 0], [3, 3], [3, 6], [6, 3]]) {
        if (!isInsideSquare(row, col, offsetRow, offsetCol)) {
            continue;
        }
        const localRow = row - offsetRow;
        const localCol = col - offsetCol;
        if (localCol === 0 && !isFlowerCell(row, col - 1)) {
            classes.add('block-left');
        }
        if (localCol === 2 || localCol === 5 || localCol === 8) {
            classes.add('block-right');
        }
        if (localRow === 0 && !isFlowerCell(row - 1, col)) {
            classes.add('block-top');
        }
        if (localRow === 2 || localRow === 5 || localRow === 8) {
            classes.add('block-bottom');
        }
    }
    return [...classes];
}

function getSoheiBoundaryClasses(row: number, col: number): string[] {
    if (!isSoheiCell(row, col)) {
        return [];
    }

    const classes = new Set<string>();
    for (const [offsetRow, offsetCol] of [[0, 6], [6, 0], [6, 12], [12, 6]]) {
        if (!isInsideSquare(row, col, offsetRow, offsetCol)) {
            continue;
        }
        const localRow = row - offsetRow;
        const localCol = col - offsetCol;
        if (localCol === 0 && !isSoheiCell(row, col - 1)) {
            classes.add('block-left');
        }
        if (localCol === 2 || localCol === 5 || localCol === 8) {
            classes.add('block-right');
        }
        if (localRow === 0 && !isSoheiCell(row - 1, col)) {
            classes.add('block-top');
        }
        if (localRow === 2 || localRow === 5 || localRow === 8) {
            classes.add('block-bottom');
        }
    }
    return [...classes];
}

function getKazagurumaBoundaryClasses(row: number, col: number): string[] {
    if (!isKazagurumaCell(row, col)) {
        return [];
    }

    const classes = new Set<string>();
    for (const [offsetRow, offsetCol] of [[0, 3], [3, 12], [6, 6], [9, 0], [12, 9]]) {
        if (!isInsideSquare(row, col, offsetRow, offsetCol)) {
            continue;
        }
        const localRow = row - offsetRow;
        const localCol = col - offsetCol;
        if (localCol === 0 && !isKazagurumaCell(row, col - 1)) {
            classes.add('block-left');
        }
        if (localCol === 2 || localCol === 5 || localCol === 8) {
            classes.add('block-right');
        }
        if (localRow === 0 && !isKazagurumaCell(row - 1, col)) {
            classes.add('block-top');
        }
        if (localRow === 2 || localRow === 5 || localRow === 8) {
            classes.add('block-bottom');
        }
    }
    return [...classes];
}

function emptyGrid(): Grid {
    return Array.from({ length: SIZE }, () => Array(SIZE).fill(''));
}

function createEmptyGrid(size: number): Grid {
    return Array.from({ length: size }, () => Array(size).fill(''));
}

function createEmptyRectGrid(rows: number, cols: number): Grid {
    return Array.from({ length: rows }, () => Array(cols).fill(''));
}

function resizeGrid(grid: Grid, size: number): Grid {
    return Array.from({ length: size }, (_row, rowIndex) => (
        Array.from({ length: size }, (_col, colIndex) => grid[rowIndex]?.[colIndex] || '')
    ));
}

function resizeNonogramGrid(grid: Grid, rows: number, cols: number): Grid {
    return Array.from({ length: rows }, (_row, rowIndex) => (
        Array.from({ length: cols }, (_col, colIndex) => {
            const value = grid[rowIndex]?.[colIndex];
            return value === '#' || value === '.' ? value : '';
        })
    ));
}

function emptyHorizontalInequalities(): InequalityGrid {
    return cloneInequalityGrid(EMPTY_HORIZONTAL_INEQUALITIES);
}

function emptyVerticalInequalities(): InequalityGrid {
    return cloneInequalityGrid(EMPTY_VERTICAL_INEQUALITIES);
}

function emptyVudokuCorners(): VudokuGrid {
    return cloneVudokuGrid(EMPTY_VUDOKU_CORNERS);
}

function emptyXvHorizontalMarks(): XvGrid {
    return cloneXvGrid(EMPTY_XV_HORIZONTAL_MARKS);
}

function emptyXvVerticalMarks(): XvGrid {
    return cloneXvGrid(EMPTY_XV_VERTICAL_MARKS);
}

function emptyKropkiHorizontalDots(): KropkiGrid {
    return cloneKropkiGrid(EMPTY_KROPKI_HORIZONTAL_DOTS);
}

function emptyKropkiVerticalDots(): KropkiGrid {
    return cloneKropkiGrid(EMPTY_KROPKI_VERTICAL_DOTS);
}

function emptyParityMarks(): ParityGrid {
    return cloneParityGrid(EMPTY_PARITY_MARKS);
}

function emptyTripodDots(size = SIZE): TripodDots {
    return Array.from({ length: size + 1 }, () => Array(size + 1).fill(false));
}

function emptyChainGrid(size = SIZE): ChainGrid {
    return Array.from({ length: size }, () => Array(size).fill(0));
}

function emptyChainPaths(size = SIZE): ChainPaths {
    return Array.from({ length: size }, () => []);
}

function chainPathKey(row: number, col: number): string {
    return `${row}:${col}`;
}

function chainGridFromPaths(paths: ChainPaths, size = SIZE): ChainGrid {
    const grid = emptyChainGrid(size);
    const seen = new Set<string>();
    paths.slice(0, size).forEach((path, chainIndex) => {
        path.forEach(([row, col]) => {
            const key = chainPathKey(row, col);
            if (row < 0 || row >= size || col < 0 || col >= size || seen.has(key)) {
                return;
            }
            grid[row][col] = chainIndex + 1;
            seen.add(key);
        });
    });
    return grid;
}

function chainPathsFromGrid(grid: ChainGrid, size = SIZE): ChainPaths {
    const paths = emptyChainPaths(size);
    for (let row = 0; row < size; row += 1) {
        for (let col = 0; col < size; col += 1) {
            const chain = Number(grid[row]?.[col] || 0);
            if (chain >= 1 && chain <= size) {
                paths[chain - 1].push([row, col]);
            }
        }
    }
    return paths;
}

function nextIncompleteChain(counts: number[], size: number, currentChain: number): number {
    for (let offset = 1; offset <= size; offset += 1) {
        const candidate = ((currentChain - 1 + offset) % size) + 1;
        if ((counts[candidate - 1] || 0) < size) {
            return candidate;
        }
    }
    return currentChain;
}

function emptySkyscraperClues(): SkyscraperClues {
    return cloneSkyscraperClues(EMPTY_SKYSCRAPER_CLUES);
}

function emptyFrameClues(): FrameClues {
    return cloneFrameClues(EMPTY_FRAME_CLUES);
}

function emptyOutsideClues(): OutsideClues {
    return cloneOutsideClues(EMPTY_OUTSIDE_CLUES);
}

function emptySandwichClues(): SandwichClues {
    return cloneSandwichClues(EMPTY_SANDWICH_CLUES);
}

function emptyLittleKillerClues(): LittleKillerClues {
    return cloneLittleKillerClues(EMPTY_LITTLE_KILLER_CLUES);
}

function emptyRossiniArrows(): RossiniArrows {
    return cloneRossiniArrows(EMPTY_ROSSINI_ARROWS);
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

function normalizeVudokuSymbol(value: unknown): VudokuSymbol {
    const text = String(value ?? '').trim().toLowerCase();
    const aliases: Record<string, VudokuSymbol> = {
        a: 'tl',
        '1': 'tl',
        tl: 'tl',
        nw: 'tl',
        b: 'tr',
        '2': 'tr',
        tr: 'tr',
        ne: 'tr',
        c: 'bl',
        '3': 'bl',
        bl: 'bl',
        sw: 'bl',
        d: 'br',
        '4': 'br',
        br: 'br',
        se: 'br',
    };
    return aliases[text] || '';
}

function normalizeVudokuGrid(value: unknown): VudokuGrid {
    const rawGrid = value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>).grid ?? (value as Record<string, unknown>).matrix ?? (value as Record<string, unknown>).corners
        : value;
    if (!Array.isArray(rawGrid) || rawGrid.length !== SIZE - 1) {
        return emptyVudokuCorners();
    }
    return rawGrid.map(row => {
        const cells = typeof row === 'string' ? row.split('') : Array.isArray(row) ? row : [];
        return Array.from({ length: SIZE - 1 }, (_unused, index) => normalizeVudokuSymbol(cells[index]));
    });
}

function normalizeXvSymbol(value: unknown): XvSymbol {
    const text = String(value ?? '').trim().toUpperCase();
    return text === 'X' || text === 'V' ? text : '';
}

function normalizeXvGrid(value: unknown, rows: number, cols: number): XvGrid {
    if (!Array.isArray(value) || value.length !== rows) {
        return Array.from({ length: rows }, () => Array<XvSymbol>(cols).fill(''));
    }

    return value.map(row => {
        const cells = typeof row === 'string' ? row.split('') : Array.isArray(row) ? row : [];
        return Array.from({ length: cols }, (_unused, index) => normalizeXvSymbol(cells[index]));
    });
}

function normalizeKropkiSymbol(value: unknown): KropkiSymbol {
    const text = String(value ?? '').trim().toLowerCase();
    if (['w', 'white', 'o', '○'].includes(text)) {
        return 'white';
    }
    if (['b', 'black', '●'].includes(text)) {
        return 'black';
    }
    return '';
}

function normalizeKropkiGrid(value: unknown, rows: number, cols: number): KropkiGrid {
    if (!Array.isArray(value) || value.length !== rows) {
        return Array.from({ length: rows }, () => Array<KropkiSymbol>(cols).fill(''));
    }
    return value.map(row => {
        const cells = typeof row === 'string' ? row.split('') : Array.isArray(row) ? row : [];
        return Array.from({ length: cols }, (_unused, index) => normalizeKropkiSymbol(cells[index]));
    });
}

function normalizeParitySymbol(value: unknown): ParitySymbol {
    const text = String(value ?? '').trim().toLowerCase();
    if (text === 'even' || text === 'e' || text === 'pair' || text === 'p') {
        return 'even';
    }
    if (text === 'odd' || text === 'o' || text === 'impair' || text === 'i') {
        return 'odd';
    }
    return '';
}

function normalizeParityGrid(value: unknown): ParityGrid {
    const rawGrid = value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>).grid ?? (value as Record<string, unknown>).matrix
        : value;
    if (!Array.isArray(rawGrid) || rawGrid.length !== SIZE) {
        return emptyParityMarks();
    }
    return rawGrid.map(row => {
        const cells = typeof row === 'string' ? row.split('') : Array.isArray(row) ? row : [];
        return Array.from({ length: SIZE }, (_unused, index) => normalizeParitySymbol(cells[index]));
    });
}

function cycleParitySymbol(value: ParitySymbol): ParitySymbol {
    if (value === '') {
        return 'even';
    }
    if (value === 'even') {
        return 'odd';
    }
    return '';
}

function parityLabel(value: ParitySymbol): string {
    return value === 'even' ? 'pair' : value === 'odd' ? 'impair' : '';
}

function normalizeTripodDot(value: unknown): boolean {
    if (typeof value === 'boolean') {
        return value;
    }
    const text = String(value ?? '').trim().toLowerCase();
    return text === '1' || text === 'x' || text === '*' || text === '#' || text === 'true' || text === 'dot' || text === 'point' || text === 'o';
}

function normalizeTripodDots(value: unknown, size = SIZE): TripodDots {
    const rawDots = value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>).dots ?? (value as Record<string, unknown>).points ?? (value as Record<string, unknown>).grid
        : value;
    if (!Array.isArray(rawDots) || rawDots.length !== size + 1) {
        return emptyTripodDots(size);
    }
    return rawDots.map(row => {
        const cells = typeof row === 'string' ? row.split('') : Array.isArray(row) ? row : [];
        return Array.from({ length: size + 1 }, (_unused, index) => normalizeTripodDot(cells[index]));
    });
}

function normalizeChainGrid(value: unknown, size = SIZE): ChainGrid {
    const rawGrid = value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>).grid ?? (value as Record<string, unknown>).matrix ?? (value as Record<string, unknown>).chains
        : value;
    if (!Array.isArray(rawGrid) || rawGrid.length !== size) {
        return emptyChainGrid(size);
    }
    const chainIds = new Map<string, number>();
    const normalizeId = (cell: unknown): number => {
        const text = String(cell ?? '').trim().toUpperCase();
        if (!text || text === '.' || text === '0' || text === '_' || text === '-' || text === '?') {
            return 0;
        }
        const numeric = Number(text);
        if (Number.isInteger(numeric) && numeric >= 1 && numeric <= size) {
            return numeric;
        }
        if (!chainIds.has(text)) {
            chainIds.set(text, Math.min(chainIds.size + 1, size));
        }
        return chainIds.get(text) || 0;
    };
    return rawGrid.map(row => {
        const cells = typeof row === 'string' ? row.split('').filter(char => !/\s|[|,]/.test(char)) : Array.isArray(row) ? row : [];
        return Array.from({ length: size }, (_unused, index) => normalizeId(cells[index]));
    });
}

function normalizeChainPathCell(value: unknown, size = SIZE): CellCoord | undefined {
    if (Array.isArray(value) && value.length >= 2) {
        const row = Number(value[0]);
        const col = Number(value[1]);
        if (Number.isInteger(row) && Number.isInteger(col) && row >= 0 && row < size && col >= 0 && col < size) {
            return [row, col];
        }
        return undefined;
    }

    if (value && typeof value === 'object') {
        const raw = value as Record<string, unknown>;
        const row = Number(raw.row ?? raw.r);
        const col = Number(raw.col ?? raw.c);
        if (Number.isInteger(row) && Number.isInteger(col)) {
            const zeroBasedRow = row >= 1 && row <= size ? row - 1 : row;
            const zeroBasedCol = col >= 1 && col <= size ? col - 1 : col;
            if (zeroBasedRow >= 0 && zeroBasedRow < size && zeroBasedCol >= 0 && zeroBasedCol < size) {
                return [zeroBasedRow, zeroBasedCol];
            }
        }
    }

    return undefined;
}

function normalizeChainPaths(value: unknown, fallbackGrid: ChainGrid, size = SIZE): ChainPaths {
    const rawPaths = value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>).paths ?? (value as Record<string, unknown>).chains
        : value;
    if (!Array.isArray(rawPaths) || rawPaths.length !== size) {
        return chainPathsFromGrid(fallbackGrid, size);
    }

    const used = new Set<string>();
    return Array.from({ length: size }, (_unused, chainIndex) => {
        const rawPath = rawPaths[chainIndex];
        if (!Array.isArray(rawPath)) {
            return [];
        }
        const path: CellCoord[] = [];
        rawPath.forEach(cell => {
            const coord = normalizeChainPathCell(cell, size);
            if (!coord) {
                return;
            }
            const key = chainPathKey(coord[0], coord[1]);
            if (used.has(key)) {
                return;
            }
            used.add(key);
            path.push(coord);
        });
        return path;
    });
}

function normalizeCellValueForVariant(rawValue: string, puzzleType: SudokuVariant): string {
    if (getMineConfig(puzzleType)) {
        return rawValue.replace(/[^0-8]/g, '').slice(-1);
    }
    const symbolConfig = getSizedSudokuConfig(puzzleType) || getTripodConfig(puzzleType) || getChainConfig(puzzleType);
    if (symbolConfig) {
        const symbols = new Set(sudokuSymbolsForSize(symbolConfig.size));
        const value = rawValue.trim().slice(-1).toUpperCase();
        return symbols.has(value) ? value : '';
    }
    if (puzzleType === 'sudoku_godoku') {
        return rawValue.replace(/[^A-Za-z]/g, '').slice(-1).toUpperCase();
    }
    return rawValue.replace(/[^1-9]/g, '').slice(-1);
}

function normalizeSkyscraperClue(value: unknown): string {
    const text = String(value ?? '').replace(/[^1-9]/g, '').slice(-1);
    return text;
}

function normalizeSkyscraperSide(value: unknown): string[] {
    const rawValues = typeof value === 'string'
        ? value.split('')
        : Array.isArray(value)
            ? value
            : [];
    return Array.from({ length: SIZE }, (_unused, index) => normalizeSkyscraperClue(rawValues[index]));
}

function normalizeSkyscraperClues(value: unknown): SkyscraperClues {
    if (!value || typeof value !== 'object') {
        return emptySkyscraperClues();
    }
    const record = value as Record<string, unknown>;
    return {
        top: normalizeSkyscraperSide(record.top ?? record.t),
        bottom: normalizeSkyscraperSide(record.bottom ?? record.b),
        left: normalizeSkyscraperSide(record.left ?? record.l),
        right: normalizeSkyscraperSide(record.right ?? record.r),
    };
}

function normalizeFrameClue(value: unknown): string {
    const text = String(value ?? '').replace(/[^0-9]/g, '').slice(0, 2);
    if (!text) {
        return '';
    }
    const numberValue = Number(text);
    return numberValue >= 1 && numberValue <= 27 ? String(numberValue) : '';
}

function normalizeFrameSide(value: unknown): string[] {
    const rawValues = typeof value === 'string'
        ? value.trim().split(/[\s,;|]+/).filter(Boolean)
        : Array.isArray(value)
            ? value
            : [];
    return Array.from({ length: SIZE }, (_unused, index) => normalizeFrameClue(rawValues[index]));
}

function normalizeFrameClues(value: unknown): FrameClues {
    if (!value || typeof value !== 'object') {
        return emptyFrameClues();
    }
    const record = value as Record<string, unknown>;
    return {
        top: normalizeFrameSide(record.top ?? record.t),
        bottom: normalizeFrameSide(record.bottom ?? record.b),
        left: normalizeFrameSide(record.left ?? record.l),
        right: normalizeFrameSide(record.right ?? record.r),
    };
}

function normalizeOutsideClue(value: unknown): string {
    const seen = new Set<string>();
    const digits = String(value ?? '').replace(/[^1-9]/g, '').split('').filter(digit => {
        if (seen.has(digit)) {
            return false;
        }
        seen.add(digit);
        return true;
    });
    return digits.slice(0, 3).join('');
}

function normalizeOutsideSide(value: unknown): string[] {
    const rawValues = typeof value === 'string'
        ? value.trim().split(/[\s,;|]+/).filter(Boolean)
        : Array.isArray(value)
            ? value
            : [];
    if (rawValues.length === SIZE) {
        return Array.from({ length: SIZE }, (_unused, index) => normalizeOutsideClue(rawValues[index]));
    }
    if (typeof value === 'string' && value.trim().length === SIZE) {
        return value.trim().split('').map(normalizeOutsideClue);
    }
    return Array.from({ length: SIZE }, (_unused, index) => normalizeOutsideClue(rawValues[index]));
}

function normalizeOutsideClues(value: unknown): OutsideClues {
    if (!value || typeof value !== 'object') {
        return emptyOutsideClues();
    }
    const record = value as Record<string, unknown>;
    return {
        top: normalizeOutsideSide(record.top ?? record.t),
        bottom: normalizeOutsideSide(record.bottom ?? record.b),
        left: normalizeOutsideSide(record.left ?? record.l),
        right: normalizeOutsideSide(record.right ?? record.r),
    };
}

function normalizeSandwichClue(value: unknown): string {
    const text = String(value ?? '').replace(/[^0-9]/g, '').slice(0, 2);
    if (text === '') {
        return '';
    }
    const numberValue = Number(text);
    return numberValue >= 0 && numberValue <= 35 ? String(numberValue) : '';
}

function normalizeSandwichSide(value: unknown): string[] {
    const rawValues = typeof value === 'string'
        ? value.trim().split(/[\s,;|]+/).filter(Boolean)
        : Array.isArray(value)
            ? value
            : [];
    return Array.from({ length: SIZE }, (_unused, index) => normalizeSandwichClue(rawValues[index]));
}

function normalizeSandwichClues(value: unknown): SandwichClues {
    if (!value || typeof value !== 'object') {
        return emptySandwichClues();
    }
    const record = value as Record<string, unknown>;
    return {
        top: normalizeSandwichSide(record.top ?? record.t),
        bottom: normalizeSandwichSide(record.bottom ?? record.b),
        left: normalizeSandwichSide(record.left ?? record.l),
        right: normalizeSandwichSide(record.right ?? record.r),
    };
}

function activeSandwichClues(clues: SandwichClues): SandwichClues {
    return {
        top: [...clues.top],
        left: [...clues.left],
        bottom: Array<string>(SIZE).fill(''),
        right: Array<string>(SIZE).fill(''),
    };
}

function normalizeLittleKillerTotal(value: unknown): string {
    const text = String(value ?? '').replace(/[^0-9]/g, '').slice(0, 2);
    if (!text) {
        return '';
    }
    const numberValue = Number(text);
    return numberValue >= 1 && numberValue <= 81 ? String(numberValue) : '';
}

function defaultLittleKillerDirection(side: SkyscraperSide): LittleKillerDirection {
    return DEFAULT_LITTLE_KILLER_DIRECTIONS[side];
}

function allowedLittleKillerDirections(side: SkyscraperSide): LittleKillerDirection[] {
    if (side === 'top') {
        return ['dr', 'dl'];
    }
    if (side === 'bottom') {
        return ['ur', 'ul'];
    }
    if (side === 'left') {
        return ['dr', 'ur'];
    }
    return ['dl', 'ul'];
}

function normalizeLittleKillerDirection(value: unknown, side: SkyscraperSide): LittleKillerDirection {
    const text = String(value ?? '').trim().toLowerCase();
    const aliases: Record<string, LittleKillerDirection> = {
        dl: 'dl',
        'down-left': 'dl',
        downleft: 'dl',
        sw: 'dl',
        dr: 'dr',
        'down-right': 'dr',
        downright: 'dr',
        se: 'dr',
        ul: 'ul',
        'up-left': 'ul',
        upleft: 'ul',
        nw: 'ul',
        ur: 'ur',
        'up-right': 'ur',
        upright: 'ur',
        ne: 'ur',
        '\\': side === 'top' || side === 'left' ? 'dr' : 'ul',
        '/': side === 'top' || side === 'right' ? 'dl' : 'ur',
    };
    const direction = aliases[text] || defaultLittleKillerDirection(side);
    return allowedLittleKillerDirections(side).includes(direction) ? direction : defaultLittleKillerDirection(side);
}

function normalizeLittleKillerClue(value: unknown, side: SkyscraperSide): LittleKillerClue {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        const record = value as Record<string, unknown>;
        return {
            total: normalizeLittleKillerTotal(record.total ?? record.sum ?? record.value),
            direction: normalizeLittleKillerDirection(record.direction ?? record.dir ?? record.arrow, side),
        };
    }
    const text = String(value ?? '').trim();
    const match = text.match(/^(\d+)\s*(dl|dr|ul|ur|[\\/])?$/i);
    return {
        total: normalizeLittleKillerTotal(match ? match[1] : text),
        direction: normalizeLittleKillerDirection(match?.[2], side),
    };
}

function normalizeLittleKillerSide(value: unknown, side: SkyscraperSide): LittleKillerClue[] {
    const rawValues = typeof value === 'string'
        ? value.trim().split(/[\s,;|]+/).filter(Boolean)
        : Array.isArray(value)
            ? value
            : [];
    return Array.from({ length: SIZE }, (_unused, index) => normalizeLittleKillerClue(rawValues[index], side));
}

function normalizeLittleKillerClues(value: unknown): LittleKillerClues {
    if (!value || typeof value !== 'object') {
        return emptyLittleKillerClues();
    }
    const record = value as Record<string, unknown>;
    return {
        top: normalizeLittleKillerSide(record.top ?? record.t, 'top'),
        bottom: normalizeLittleKillerSide(record.bottom ?? record.b, 'bottom'),
        left: normalizeLittleKillerSide(record.left ?? record.l, 'left'),
        right: normalizeLittleKillerSide(record.right ?? record.r, 'right'),
    };
}

function cycleLittleKillerDirection(side: SkyscraperSide, current: LittleKillerDirection): LittleKillerDirection {
    const sequence = allowedLittleKillerDirections(side);
    const currentIndex = sequence.indexOf(current);
    return sequence[(currentIndex + 1) % sequence.length];
}

function littleKillerArrow(direction: LittleKillerDirection): string {
    const arrows: Record<LittleKillerDirection, string> = {
        dl: '\u2199',
        dr: '\u2198',
        ul: '\u2196',
        ur: '\u2197',
    };
    return arrows[direction];
}

function normalizeRossiniArrow(value: unknown, side: RossiniSide): RossiniArrow {
    const text = String(value ?? '').trim();
    const normalized: Record<string, RossiniArrow> = {
        '^': '↑',
        U: '↑',
        u: '↑',
        '↑': '↑',
        v: '↓',
        V: '↓',
        D: '↓',
        d: '↓',
        '↓': '↓',
        '<': '←',
        L: '←',
        l: '←',
        '←': '←',
        '>': '→',
        R: '→',
        r: '→',
        '→': '→',
    };
    const arrow = normalized[text] || '';
    if ((side === 'top' || side === 'bottom') && (arrow === '←' || arrow === '→')) {
        return '';
    }
    if ((side === 'left' || side === 'right') && (arrow === '↑' || arrow === '↓')) {
        return '';
    }
    return arrow;
}

function normalizeRossiniSide(value: unknown, side: RossiniSide): RossiniArrow[] {
    const rawValues = typeof value === 'string'
        ? value.split('')
        : Array.isArray(value)
            ? value
            : [];
    return Array.from({ length: SIZE }, (_unused, index) => normalizeRossiniArrow(rawValues[index], side));
}

function normalizeRossiniArrows(value: unknown): RossiniArrows {
    if (!value || typeof value !== 'object') {
        return emptyRossiniArrows();
    }
    const record = value as Record<string, unknown>;
    return {
        top: normalizeRossiniSide(record.top ?? record.t, 'top'),
        bottom: normalizeRossiniSide(record.bottom ?? record.b, 'bottom'),
        left: normalizeRossiniSide(record.left ?? record.l, 'left'),
        right: normalizeRossiniSide(record.right ?? record.r, 'right'),
    };
}

function cycleRossiniArrow(side: RossiniSide, current: RossiniArrow): RossiniArrow {
    const sequence: RossiniArrow[] = side === 'top' || side === 'bottom'
        ? ['', '↓', '↑']
        : side === 'left'
            ? ['', '←', '→']
            : ['', '→', '←'];
    const currentIndex = sequence.indexOf(current);
    return sequence[(currentIndex + 1) % sequence.length];
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

function cycleXvMark(value: XvSymbol): XvSymbol {
    if (value === '') {
        return 'X';
    }
    if (value === 'X') {
        return 'V';
    }
    return '';
}

function cycleKropkiDot(value: KropkiSymbol): KropkiSymbol {
    if (value === '') {
        return 'white';
    }
    if (value === 'white') {
        return 'black';
    }
    return '';
}

function gridToText(grid: Grid, puzzleType: SudokuVariant = 'sudoku_classic'): string {
    if (puzzleType === 'nonogram') {
        return grid.map(row => row.map(value => value === '#' ? '#' : value === '.' ? '.' : '?').join('')).join('\n');
    }

    const mineConfig = getMineConfig(puzzleType);
    if (mineConfig) {
        return Array.from({ length: mineConfig.size }, (_row, rowIndex) => (
            Array.from({ length: mineConfig.size }, (_col, colIndex) => grid[rowIndex]?.[colIndex] || '.').join('')
        )).join('\n');
    }

    const symbolConfig = getSizedSudokuConfig(puzzleType) || getTripodConfig(puzzleType) || getChainConfig(puzzleType);
    if (symbolConfig) {
        return Array.from({ length: symbolConfig.size }, (_row, rowIndex) => (
            Array.from({ length: symbolConfig.size }, (_col, colIndex) => grid[rowIndex]?.[colIndex] || '0').join('')
        )).join('\n');
    }

    if (puzzleType === 'sujiken') {
        return Array.from({ length: SIZE }, (_row, rowIndex) => (
            Array.from({ length: rowIndex + 1 }, (_col, colIndex) => grid[rowIndex]?.[colIndex] || '0').join('')
        )).join('\n');
    }

    if (puzzleType === 'sudoku_hoshi') {
        return Array.from({ length: HOSHI_TRIANGLES }, (_row, rowIndex) => (
            Array.from({ length: HOSHI_CELLS_PER_TRIANGLE }, (_col, colIndex) => grid[rowIndex]?.[colIndex] || '0').join('')
        )).join('\n');
    }

    if (puzzleType === 'samurai_sudoku') {
        return Array.from({ length: SAMURAI_SIZE }, (_row, rowIndex) => (
            Array.from({ length: SAMURAI_SIZE }, (_col, colIndex) => (
                isSamuraiCell(rowIndex, colIndex) ? grid[rowIndex]?.[colIndex] || '0' : '.'
            )).join('')
        )).join('\n');
    }

    if (puzzleType === 'sohei_sudoku') {
        return Array.from({ length: SAMURAI_SIZE }, (_row, rowIndex) => (
            Array.from({ length: SAMURAI_SIZE }, (_col, colIndex) => (
                isSoheiCell(rowIndex, colIndex) ? grid[rowIndex]?.[colIndex] || '0' : '.'
            )).join('')
        )).join('\n');
    }

    if (puzzleType === 'kazaguruma_sudoku') {
        return Array.from({ length: SAMURAI_SIZE }, (_row, rowIndex) => (
            Array.from({ length: KAZAGURUMA_COLS }, (_col, colIndex) => (
                isKazagurumaCell(rowIndex, colIndex) ? grid[rowIndex]?.[colIndex] || '0' : '.'
            )).join('')
        )).join('\n');
    }

    if (puzzleType === 'flower_sudoku') {
        return Array.from({ length: FLOWER_SIZE }, (_row, rowIndex) => (
            Array.from({ length: FLOWER_SIZE }, (_col, colIndex) => (
                isFlowerCell(rowIndex, colIndex) ? grid[rowIndex]?.[colIndex] || '0' : '.'
            )).join('')
        )).join('\n');
    }

    return Array.from({ length: SIZE }, (_row, rowIndex) => (
        Array.from({ length: SIZE }, (_col, colIndex) => grid[rowIndex]?.[colIndex] || '0').join('')
    )).join('\n');
}

function parseGridText(text: string, puzzleType: SudokuVariant = 'sudoku_classic'): Grid | null {
    if (puzzleType === 'sudoku_hoshi') {
        const tokens: string[] = [];
        for (const char of text) {
            if (/[1-9]/.test(char)) {
                tokens.push(char);
            } else if (char === '0' || char === '.' || char === '_') {
                tokens.push('');
            }
        }
        if (tokens.length !== HOSHI_TRIANGLES * HOSHI_CELLS_PER_TRIANGLE) {
            return null;
        }
        const grid = createEmptyGrid(SIZE);
        tokens.forEach((value, index) => {
            grid[Math.floor(index / HOSHI_CELLS_PER_TRIANGLE)][index % HOSHI_CELLS_PER_TRIANGLE] = value;
        });
        return grid;
    }

    const config = getSizedSudokuConfig(puzzleType) || getTripodConfig(puzzleType) || getChainConfig(puzzleType) || { size: SIZE };
    const symbols = sudokuSymbolsForSize(config.size);
    const symbolSet = new Set(symbols);
    const tokens: string[] = [];
    for (const char of text) {
        const normalized = char.toUpperCase();
        if (symbolSet.has(normalized)) {
            tokens.push(normalized);
        } else if (char === '0' || char === '.' || char === '_') {
            tokens.push('');
        }
    }

    if (tokens.length !== config.size * config.size) {
        return null;
    }

    const grid = createEmptyGrid(config.size);
    tokens.forEach((value, index) => {
        grid[Math.floor(index / config.size)][index % config.size] = value;
    });
    return grid;
}

function parseMineText(text: string, puzzleType: SudokuVariant): Grid | null {
    const config = getMineConfig(puzzleType);
    if (!config) {
        return null;
    }
    const tokens: string[] = [];
    for (const char of text) {
        if (/[0-8]/.test(char)) {
            tokens.push(char);
        } else if (char === '.' || char === '_' || char === '-') {
            tokens.push('');
        }
    }

    if (tokens.length !== config.size * config.size) {
        return null;
    }

    const grid = createEmptyGrid(config.size);
    tokens.forEach((value, index) => {
        grid[Math.floor(index / config.size)][index % config.size] = value;
    });
    return grid;
}

function parseGodokuText(text: string): Grid | null {
    const tokens: string[] = [];
    for (const char of text) {
        if (/[A-Za-z]/.test(char)) {
            tokens.push(char.toUpperCase());
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

function parseSujikenText(text: string): Grid | null {
    const rows = text
        .split(/\r?\n/)
        .map(line => {
            const tokens: string[] = [];
            for (const char of line) {
                if (/[1-9]/.test(char)) {
                    tokens.push(char);
                } else if (char === '0' || char === '.' || char === '_') {
                    tokens.push('');
                }
            }
            return tokens;
        })
        .filter(row => row.length > 0);

    const grid = emptyGrid();
    if (rows.length === SIZE && rows.every((row, rowIndex) => row.length >= rowIndex + 1)) {
        rows.forEach((row, rowIndex) => {
            row.slice(0, rowIndex + 1).forEach((value, colIndex) => {
                grid[rowIndex][colIndex] = value;
            });
        });
        return grid;
    }

    const tokens = rows.flat();
    if (tokens.length !== 45) {
        return null;
    }

    let index = 0;
    for (let rowIndex = 0; rowIndex < SIZE; rowIndex += 1) {
        for (let colIndex = 0; colIndex <= rowIndex; colIndex += 1) {
            grid[rowIndex][colIndex] = tokens[index];
            index += 1;
        }
    }
    return grid;
}

function parseSamuraiText(text: string): Grid | null {
    const rows = text
        .split(/\r?\n/)
        .map(line => {
            const tokens: string[] = [];
            for (const char of line) {
                if (/[1-9]/.test(char)) {
                    tokens.push(char);
                } else if (char === '0' || char === '.' || char === '_') {
                    tokens.push('');
                }
            }
            return tokens;
        })
        .filter(row => row.length > 0);

    const grid = createEmptyGrid(SAMURAI_SIZE);
    if (rows.length === SAMURAI_SIZE && rows.every(row => row.length >= SAMURAI_SIZE)) {
        rows.forEach((row, rowIndex) => {
            row.slice(0, SAMURAI_SIZE).forEach((value, colIndex) => {
                if (isSamuraiCell(rowIndex, colIndex)) {
                    grid[rowIndex][colIndex] = value;
                }
            });
        });
        return grid;
    }

    const tokens = rows.flat();
    const activeCells: Array<[number, number]> = [];
    for (let rowIndex = 0; rowIndex < SAMURAI_SIZE; rowIndex += 1) {
        for (let colIndex = 0; colIndex < SAMURAI_SIZE; colIndex += 1) {
            if (isSamuraiCell(rowIndex, colIndex)) {
                activeCells.push([rowIndex, colIndex]);
            }
        }
    }

    if (tokens.length !== activeCells.length) {
        return null;
    }

    activeCells.forEach(([rowIndex, colIndex], index) => {
        grid[rowIndex][colIndex] = tokens[index];
    });
    return grid;
}

function parseSoheiText(text: string): Grid | null {
    const rows = text
        .split(/\r?\n/)
        .map(line => {
            const tokens: string[] = [];
            for (const char of line) {
                if (/[1-9]/.test(char)) {
                    tokens.push(char);
                } else if (char === '0' || char === '.' || char === '_') {
                    tokens.push('');
                }
            }
            return tokens;
        })
        .filter(row => row.length > 0);

    const grid = createEmptyGrid(SAMURAI_SIZE);
    if (rows.length === SAMURAI_SIZE && rows.every(row => row.length >= SAMURAI_SIZE)) {
        rows.forEach((row, rowIndex) => {
            row.slice(0, SAMURAI_SIZE).forEach((value, colIndex) => {
                if (isSoheiCell(rowIndex, colIndex)) {
                    grid[rowIndex][colIndex] = value;
                }
            });
        });
        return grid;
    }

    const tokens = rows.flat();
    const activeCells: Array<[number, number]> = [];
    for (let rowIndex = 0; rowIndex < SAMURAI_SIZE; rowIndex += 1) {
        for (let colIndex = 0; colIndex < SAMURAI_SIZE; colIndex += 1) {
            if (isSoheiCell(rowIndex, colIndex)) {
                activeCells.push([rowIndex, colIndex]);
            }
        }
    }

    if (tokens.length !== activeCells.length) {
        return null;
    }

    activeCells.forEach(([rowIndex, colIndex], index) => {
        grid[rowIndex][colIndex] = tokens[index];
    });
    return grid;
}

function parseKazagurumaText(text: string): Grid | null {
    const rows = text
        .split(/\r?\n/)
        .map(line => {
            const tokens: string[] = [];
            for (const char of line) {
                if (/[1-9]/.test(char)) {
                    tokens.push(char);
                } else if (char === '0' || char === '.' || char === '_') {
                    tokens.push('');
                }
            }
            return tokens;
        })
        .filter(row => row.length > 0);

    const grid = createEmptyGrid(SAMURAI_SIZE);
    if (rows.length === SAMURAI_SIZE && rows.every(row => row.length >= KAZAGURUMA_COLS)) {
        rows.forEach((row, rowIndex) => {
            row.slice(0, KAZAGURUMA_COLS).forEach((value, colIndex) => {
                if (isKazagurumaCell(rowIndex, colIndex)) {
                    grid[rowIndex][colIndex] = value;
                }
            });
        });
        return grid;
    }

    const tokens = rows.flat();
    const activeCells: Array<[number, number]> = [];
    for (let rowIndex = 0; rowIndex < SAMURAI_SIZE; rowIndex += 1) {
        for (let colIndex = 0; colIndex < KAZAGURUMA_COLS; colIndex += 1) {
            if (isKazagurumaCell(rowIndex, colIndex)) {
                activeCells.push([rowIndex, colIndex]);
            }
        }
    }

    if (tokens.length !== activeCells.length) {
        return null;
    }

    activeCells.forEach(([rowIndex, colIndex], index) => {
        grid[rowIndex][colIndex] = tokens[index];
    });
    return grid;
}

function parseFlowerText(text: string): Grid | null {
    const rows = text
        .split(/\r?\n/)
        .map(line => {
            const tokens: string[] = [];
            for (const char of line) {
                if (/[1-9]/.test(char)) {
                    tokens.push(char);
                } else if (char === '0' || char === '.' || char === '_') {
                    tokens.push('');
                }
            }
            return tokens;
        })
        .filter(row => row.length > 0);

    const grid = createEmptyGrid(FLOWER_SIZE);
    if (rows.length === FLOWER_SIZE && rows.every(row => row.length >= FLOWER_SIZE)) {
        rows.forEach((row, rowIndex) => {
            row.slice(0, FLOWER_SIZE).forEach((value, colIndex) => {
                if (isFlowerCell(rowIndex, colIndex)) {
                    grid[rowIndex][colIndex] = value;
                }
            });
        });
        return grid;
    }

    const tokens = rows.flat();
    const activeCells: Array<[number, number]> = [];
    for (let rowIndex = 0; rowIndex < FLOWER_SIZE; rowIndex += 1) {
        for (let colIndex = 0; colIndex < FLOWER_SIZE; colIndex += 1) {
            if (isFlowerCell(rowIndex, colIndex)) {
                activeCells.push([rowIndex, colIndex]);
            }
        }
    }

    if (tokens.length !== activeCells.length) {
        return null;
    }

    activeCells.forEach(([rowIndex, colIndex], index) => {
        grid[rowIndex][colIndex] = tokens[index];
    });
    return grid;
}

function parsePuzzleText(text: string, puzzleType: SudokuVariant): Grid | null {
    if (getMineConfig(puzzleType)) {
        return parseMineText(text, puzzleType);
    }
    if (puzzleType === 'sujiken') {
        return parseSujikenText(text);
    }
    if (puzzleType === 'samurai_sudoku') {
        return parseSamuraiText(text);
    }
    if (puzzleType === 'sohei_sudoku') {
        return parseSoheiText(text);
    }
    if (puzzleType === 'kazaguruma_sudoku') {
        return parseKazagurumaText(text);
    }
    if (puzzleType === 'flower_sudoku') {
        return parseFlowerText(text);
    }
    if (puzzleType === 'sudoku_godoku') {
        return parseGodokuText(text);
    }
    return parseGridText(text, puzzleType);
}

function normalizeGrid(value: unknown, puzzleType: SudokuVariant): Grid | undefined {
    if (puzzleType === 'nonogram') {
        if (typeof value === 'string') {
            const rows = value.trim().split(/\r?\n/).filter(Boolean);
            if (!rows.length) {
                return undefined;
            }
            const parsed = rows.map(row => Array.from(row).map(char => (
                char === '#' || char === 'X' || char === 'x' || char === '1'
                    ? '#'
                    : char === '.' || char === '-' || char === '0'
                        ? '.'
                        : ''
            )));
            const cols = Math.max(...parsed.map(row => row.length));
            return resizeNonogramGrid(parsed, parsed.length, cols);
        }
        if (!Array.isArray(value) || !value.length || value.some(row => !Array.isArray(row))) {
            return undefined;
        }
        const cols = Math.max(...value.map(row => (row as unknown[]).length));
        return resizeNonogramGrid(value as Grid, value.length, cols);
    }

    if (typeof value === 'string') {
        return parsePuzzleText(value, puzzleType) || undefined;
    }

    if (puzzleType === 'sudoku_hoshi') {
        if (!Array.isArray(value) || value.length < HOSHI_TRIANGLES) {
            return undefined;
        }
        const normalized = createEmptyGrid(SIZE);
        for (let rowIndex = 0; rowIndex < HOSHI_TRIANGLES; rowIndex += 1) {
            const row = value[rowIndex];
            if (!Array.isArray(row) || row.length < HOSHI_CELLS_PER_TRIANGLE) {
                return undefined;
            }
            for (let colIndex = 0; colIndex < HOSHI_CELLS_PER_TRIANGLE; colIndex += 1) {
                normalized[rowIndex][colIndex] = String(row[colIndex] ?? '').replace(/[^1-9]/g, '').slice(-1);
            }
        }
        return normalized;
    }

    const size = gridSizeForVariant(puzzleType);
    const requiredCols = puzzleType === 'kazaguruma_sudoku' ? KAZAGURUMA_COLS : size;
    const symbolConfig = getSizedSudokuConfig(puzzleType) || getTripodConfig(puzzleType) || getChainConfig(puzzleType);
    const sizedSymbols = symbolConfig ? new Set(sudokuSymbolsForSize(symbolConfig.size)) : undefined;
    const mineConfig = getMineConfig(puzzleType);
    if (!Array.isArray(value) || value.length !== size) {
        return undefined;
    }

    const normalized = value.map(row => {
        if (!Array.isArray(row) || row.length < requiredCols) {
            return undefined;
        }
        return Array.from({ length: size }, (_unused, index) => row[index]).map(cell => {
            if (sizedSymbols) {
                const text = String(cell ?? '').trim().slice(-1).toUpperCase();
                return sizedSymbols.has(text) ? text : '';
            }
            if (mineConfig) {
                return String(cell ?? '').replace(/[^0-8]/g, '').slice(-1);
            }
            const text = puzzleType === 'sudoku_godoku'
                ? String(cell ?? '').replace(/[^A-Za-z]/g, '').slice(-1).toUpperCase()
                : String(cell ?? '').replace(/[^1-9]/g, '').slice(-1);
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
        if (!/^r(?:[1-9]|1[0-9]|2[0-1])c(?:[1-9]|1[0-9]|2[0-1])$/.test(ref) || seen.has(ref)) {
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

function normalizeGodokuAlphabet(value: unknown): string {
    const letters: string[] = [];
    const seen = new Set<string>();
    for (const char of String(value ?? '').toUpperCase()) {
        if (!/[A-Z]/.test(char) || seen.has(char)) {
            continue;
        }
        seen.add(char);
        letters.push(char);
        if (letters.length === SIZE) {
            break;
        }
    }
    return letters.join('');
}

function normalizeMultilineText(value: unknown): string {
    return String(value ?? '').replace(/\r\n/g, '\n').trim();
}

function nonogramClueLines(text: string, fallbackCount = 5): string[] {
    const normalized = String(text ?? '').replace(/\r\n/g, '\n');
    if (!normalized.trim()) {
        return Array<string>(fallbackCount).fill('0');
    }
    return normalized.split('\n').map(line => line.trim() || '0');
}

function serializeNonogramClueLines(lines: string[]): string {
    return lines.map(line => line.trim() || '0').join('\n');
}

function normalizeNonogramClue(value: string): string {
    const normalized = value
        .replace(/[^0-9\s,;]+/g, ' ')
        .replace(/[\s,;]+/g, ' ')
        .trim();
    return normalized || '0';
}

function nonogramClueValueCount(value: string): number {
    return normalizeNonogramClue(value).split(' ').length;
}

function nonogramColumnClueEditorValue(value: string): string {
    return normalizeNonogramClue(value).split(' ').join('\n');
}

function nonogramClueValidationError(value: string, lineLength: number): string | undefined {
    const tokens = value.trim().split(/[\s,;]+/).filter(Boolean);
    if (!tokens.length) {
        return undefined;
    }
    if (tokens.some(token => !/^\d+$/.test(token))) {
        return 'Utilisez uniquement des nombres separes par des espaces, virgules ou retours a la ligne.';
    }
    const clues = tokens.map(Number);
    if (clues.length > 1 && clues.includes(0)) {
        return '0 represente une ligne vide et ne peut pas etre associe a un autre nombre.';
    }
    if (clues.some(clue => clue <= 0)) {
        return 'Chaque bloc doit etre strictement positif.';
    }
    const requiredLength = clues.reduce((total, clue) => total + clue, 0) + clues.length - 1;
    if (requiredLength > lineLength) {
        return `Ces blocs necessitent ${requiredLength} cases, mais cette ligne en compte ${lineLength}.`;
    }
    return undefined;
}

function cycleNonogramCell(value: string, direction = 1): string {
    const states = ['', '#', '.'];
    const currentIndex = Math.max(0, states.indexOf(value));
    return states[(currentIndex + direction + states.length) % states.length];
}

function extractGridFromSolution(solution: unknown): Grid | undefined {
    const grid = (solution as { grid?: unknown } | undefined)?.grid;
    if (!Array.isArray(grid)) {
        return undefined;
    }
    return grid.map((row: unknown) => {
        if (!Array.isArray(row)) {
            return Array(SIZE).fill('');
        }
        return row.map(value => String(value ?? ''));
    });
}

function extractRegionGridFromSolution(solution: unknown, size: number): RegionGrid | undefined {
    const regionGrid = (solution as { region_grid?: unknown } | undefined)?.region_grid;
    if (!Array.isArray(regionGrid) || regionGrid.length !== size) {
        return undefined;
    }
    const parsed = regionGrid.map((row: unknown) => {
        if (!Array.isArray(row) || row.length !== size) {
            return undefined;
        }
        return row.map(value => Number(value));
    });
    if (parsed.some(row => row === undefined || row.some(value => !Number.isFinite(value)))) {
        return undefined;
    }
    return parsed as RegionGrid;
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
    const [vudokuCorners, setVudokuCorners] = React.useState<VudokuGrid>(() => emptyVudokuCorners());
    const [xvHorizontalMarks, setXvHorizontalMarks] = React.useState<XvGrid>(() => emptyXvHorizontalMarks());
    const [xvVerticalMarks, setXvVerticalMarks] = React.useState<XvGrid>(() => emptyXvVerticalMarks());
    const [kropkiHorizontalDots, setKropkiHorizontalDots] = React.useState<KropkiGrid>(() => emptyKropkiHorizontalDots());
    const [kropkiVerticalDots, setKropkiVerticalDots] = React.useState<KropkiGrid>(() => emptyKropkiVerticalDots());
    const [parityMarks, setParityMarks] = React.useState<ParityGrid>(() => emptyParityMarks());
    const [tripodDots, setTripodDots] = React.useState<TripodDots>(() => emptyTripodDots());
    const [chainGrid, setChainGrid] = React.useState<ChainGrid>(() => emptyChainGrid());
    const [chainPaths, setChainPaths] = React.useState<ChainPaths>(() => emptyChainPaths());
    const [activeChain, setActiveChain] = React.useState(1);
    const [skyscraperClues, setSkyscraperClues] = React.useState<SkyscraperClues>(() => emptySkyscraperClues());
    const [frameClues, setFrameClues] = React.useState<FrameClues>(() => emptyFrameClues());
    const [outsideClues, setOutsideClues] = React.useState<OutsideClues>(() => emptyOutsideClues());
    const [sandwichClues, setSandwichClues] = React.useState<SandwichClues>(() => emptySandwichClues());
    const [littleKillerClues, setLittleKillerClues] = React.useState<LittleKillerClues>(() => emptyLittleKillerClues());
    const [rossiniArrows, setRossiniArrows] = React.useState<RossiniArrows>(() => emptyRossiniArrows());
    const [godokuAlphabet, setGodokuAlphabet] = React.useState('');
    const [nonogramRowClues, setNonogramRowClues] = React.useState('');
    const [nonogramColumnClues, setNonogramColumnClues] = React.useState('');
    const [nonogramClueDrafts, setNonogramClueDrafts] = React.useState<Record<string, string>>({});
    const [kakuroLayout, setKakuroLayout] = React.useState<KakuroLayout>(() => createKakuroStarterLayout());
    const [kakuroTool, setKakuroTool] = React.useState<KakuroTool>('white');
    const [hitoriRows, setHitoriRows] = React.useState(5);
    const [hitoriCols, setHitoriCols] = React.useState(5);
    const [hitoriShaded, setHitoriShaded] = React.useState<boolean[][]>(() => resizeHitoriShaded([], 5, 5));
    const [hitoriTool, setHitoriTool] = React.useState<HitoriTool>('numbers');
    const [watchCells, setWatchCells] = React.useState<string[]>([]);
    const [mode, setMode] = React.useState<WorkMode>('edit');
    const [maxSolutions, setMaxSolutions] = React.useState(2);
    const [timeoutMs, setTimeoutMs] = React.useState(10000);
    const [solveState, setSolveState] = React.useState<SolveState>({ running: false });
    const [selectedSolutionIndex, setSelectedSolutionIndex] = React.useState(0);
    const [persistence, setPersistence] = React.useState<PersistenceState>({
        loading: false,
        saving: false,
        dirty: false,
    });
    const cellRefs = React.useRef<Array<Array<HTMLInputElement | null>>>(
        Array.from({ length: SAMURAI_SIZE }, () => Array<HTMLInputElement | null>(SAMURAI_SIZE).fill(null))
    );
    const nonogramCellRefs = React.useRef<Array<Array<HTMLButtonElement | null>>>([]);
    const hitoriCellRefs = React.useRef<Array<Array<HTMLElement | null>>>([]);

    const solutionResults = Array.isArray(solveState.result?.results) ? solveState.result.results : [];
    const activeSolutionIndex = solutionResults.length
        ? Math.min(selectedSolutionIndex, solutionResults.length - 1)
        : 0;
    const activeSolution = solutionResults[activeSolutionIndex] as any;
    const solvedGrid = extractGridFromSolution(activeSolution);
    const watchedValues = activeSolution?.watched_values as Record<string, string> | undefined;
    const watchedText = String(activeSolution?.watched_text || '');
    const geocacheId = context?.geocacheId;
    const variantLabel = getVariantLabel(puzzleType);
    const contextLabel = context ? `${context.gcCode} - ${context.name}` : 'Mode libre';
    const isGreaterThan = puzzleType === 'sudoku_greater_than';
    const isVudoku = puzzleType === 'sudoku_vudoku';
    const isRossini = puzzleType === 'sudoku_rossini';
    const isXv = puzzleType === 'sudoku_xv';
    const isKropki = puzzleType === 'sudoku_kropki';
    const isSkyscraper = puzzleType === 'sudoku_skyscraper';
    const isFrame = puzzleType === 'sudoku_frame';
    const isOutside = puzzleType === 'sudoku_outside';
    const isSandwich = puzzleType === 'sudoku_sandwich';
    const isLittleKiller = puzzleType === 'sudoku_little_killer' || puzzleType === 'sudoku_little_unique_killer';
    const isLittleUniqueKiller = puzzleType === 'sudoku_little_unique_killer';
    const isGodoku = puzzleType === 'sudoku_godoku';
    const isEvenOdd = puzzleType === 'sudoku_even_odd';
    const isNonConsecutive = puzzleType === 'sudoku_non_consecutive';
    const isNonogram = puzzleType === 'nonogram';
    const isKakuro = puzzleType === 'kakuro';
    const isHitori = puzzleType === 'hitori';
    const mineConfig = getMineConfig(puzzleType);
    const isMine = Boolean(mineConfig);
    const tripodConfig = getTripodConfig(puzzleType);
    const isTripod = Boolean(tripodConfig);
    const chainConfig = getChainConfig(puzzleType);
    const isChain = Boolean(chainConfig);
    const sizedSudokuConfig = getSizedSudokuConfig(puzzleType);
    const isSujiken = puzzleType === 'sujiken';
    const isHoshi = puzzleType === 'sudoku_hoshi';
    const isSamurai = puzzleType === 'samurai_sudoku';
    const isFlower = puzzleType === 'flower_sudoku';
    const isSohei = puzzleType === 'sohei_sudoku';
    const isKazaguruma = puzzleType === 'kazaguruma_sudoku';
    const gridSize = gridSizeForVariant(puzzleType);
    const solvedRegionGrid = isTripod ? extractRegionGridFromSolution(activeSolution, gridSize) : undefined;
    const variableGridConfig = sizedSudokuConfig || tripodConfig || chainConfig || mineConfig;
    const sizedCellSize = variableGridConfig
        ? variableGridConfig.size >= 15
            ? 32
            : variableGridConfig.size >= 10
                ? 36
                : 44
        : 44;
    const sizedBoardStyle: React.CSSProperties | undefined = variableGridConfig ? {
        gridTemplateColumns: `repeat(${variableGridConfig.size}, ${sizedCellSize}px)`,
        gridTemplateRows: `repeat(${variableGridConfig.size}, ${sizedCellSize}px)`,
    } : undefined;
    const boardStyle: React.CSSProperties | undefined = isHoshi
        ? { width: HOSHI_BOARD_WIDTH, height: HOSHI_BOARD_HEIGHT }
        : sizedBoardStyle;
    const nonogramRowClueLines = React.useMemo(
        () => nonogramClueLines(nonogramRowClues),
        [nonogramRowClues],
    );
    const nonogramColumnClueLines = React.useMemo(
        () => nonogramClueLines(nonogramColumnClues),
        [nonogramColumnClues],
    );
    const nonogramRows = nonogramRowClueLines.length;
    const nonogramCols = nonogramColumnClueLines.length;
    const kakuroRows = kakuroLayout.length;
    const kakuroCols = kakuroLayout[0]?.length || 0;
    const nonogramMaxColumnClues = Math.max(
        1,
        ...nonogramColumnClueLines.map(nonogramClueValueCount),
    );
    const nonogramHeaderHeight = Math.min(132, Math.max(44, nonogramMaxColumnClues * 18 + 10));
    const nonogramEditorStyle: React.CSSProperties | undefined = isNonogram ? {
        gridTemplateColumns: `minmax(128px, 196px) repeat(${nonogramCols}, 42px)`,
        gridTemplateRows: `${nonogramHeaderHeight}px repeat(${nonogramRows}, 42px)`,
    } : undefined;
    const nonogramSolutionBoardStyle: React.CSSProperties | undefined = isNonogram ? {
        gridTemplateColumns: `repeat(${solvedGrid?.[0]?.length || nonogramCols}, 28px)`,
        gridTemplateRows: `repeat(${solvedGrid?.length || nonogramRows}, 28px)`,
    } : undefined;
    const kakuroBoardStyle: React.CSSProperties | undefined = isKakuro ? {
        gridTemplateColumns: `repeat(${kakuroCols}, 52px)`,
        gridTemplateRows: `repeat(${kakuroRows}, 52px)`,
    } : undefined;
    const hitoriBoardStyle: React.CSSProperties | undefined = isHitori ? {
        gridTemplateColumns: `repeat(${hitoriCols}, 46px)`,
        gridTemplateRows: `repeat(${hitoriRows}, 46px)`,
    } : undefined;
    const solutionBoardStyle = isNonogram ? nonogramSolutionBoardStyle : boardStyle;
    const chainCounts = React.useMemo(() => {
        return Array.from({ length: chainConfig?.size || 0 }, (_unused, index) => chainPaths[index]?.length || 0);
    }, [chainConfig?.size, chainPaths]);
    const areChainsComplete = Boolean(
        chainConfig
        && chainCounts.length === chainConfig.size
        && chainCounts.every(count => count === chainConfig.size),
    );
    const quickTextPlaceholder = isSujiken
        ? SUJIKEN_TEXT_PLACEHOLDER
        : isHoshi
            ? HOSHI_TEXT_PLACEHOLDER
        : mineConfig
            ? mineTextPlaceholder(mineConfig.size)
        : variableGridConfig
            ? sizedSudokuTextPlaceholder(variableGridConfig.size)
        : isFlower
            ? FLOWER_TEXT_PLACEHOLDER
        : isKazaguruma
            ? KAZAGURUMA_TEXT_PLACEHOLDER
        : isSohei
            ? SOHEI_TEXT_PLACEHOLDER
        : isSamurai
            ? SAMURAI_TEXT_PLACEHOLDER
            : QUICK_TEXT_PLACEHOLDER;
    const constraintConflicts = React.useMemo(
        () => isKakuro
            ? findKakuroConflicts(kakuroLayout, grid)
            : isHitori
                ? findHitoriConflicts(grid, hitoriShaded)
                : findConstraintConflicts(grid, puzzleType, horizontalInequalities, verticalInequalities, vudokuCorners, rossiniArrows, xvHorizontalMarks, xvVerticalMarks, kropkiHorizontalDots, kropkiVerticalDots, chainGrid, skyscraperClues, frameClues, outsideClues, sandwichClues, littleKillerClues, parityMarks),
        [chainGrid, frameClues, grid, horizontalInequalities, hitoriShaded, isHitori, isKakuro, kakuroLayout, kropkiHorizontalDots, kropkiVerticalDots, littleKillerClues, outsideClues, parityMarks, puzzleType, rossiniArrows, sandwichClues, skyscraperClues, verticalInequalities, vudokuCorners, xvHorizontalMarks, xvVerticalMarks],
    );
    const visibleConflictMessages = constraintConflicts.messages.slice(0, 4);

    React.useEffect(() => {
        if (isTripod && timeoutMs < 30000) {
            setTimeoutMs(30000);
        }
    }, [isTripod, timeoutMs]);

    React.useEffect(() => {
        if (!isNonogram) {
            return;
        }
        setGrid(previous => resizeNonogramGrid(previous, nonogramRows, nonogramCols));
        setWatchCells(previous => previous.filter(ref => {
            const match = ref.match(/^r(\d+)c(\d+)$/i);
            return Boolean(
                match
                && Number(match[1]) <= nonogramRows
                && Number(match[2]) <= nonogramCols,
            );
        }));
    }, [isNonogram, nonogramCols, nonogramRows]);

    React.useEffect(() => {
        if (!isKakuro) {
            return;
        }
        setGrid(previous => resizeKakuroGrid(previous, kakuroLayout));
        setWatchCells(previous => previous.filter(ref => {
            const match = ref.match(/^r(\d+)c(\d+)$/i);
            return Boolean(
                match
                && Number(match[1]) <= kakuroRows
                && Number(match[2]) <= kakuroCols
                && kakuroLayout[Number(match[1]) - 1]?.[Number(match[2]) - 1]?.kind === 'white',
            );
        }));
    }, [isKakuro, kakuroCols, kakuroLayout, kakuroRows]);

    React.useEffect(() => {
        if (!isHitori) {
            return;
        }
        setGrid(previous => resizeHitoriGrid(previous, hitoriRows, hitoriCols));
        setHitoriShaded(previous => resizeHitoriShaded(previous, hitoriRows, hitoriCols));
        setWatchCells(previous => previous.filter(ref => {
            const match = ref.match(/^r(\d+)c(\d+)$/i);
            return Boolean(
                match
                && Number(match[1]) <= hitoriRows
                && Number(match[2]) <= hitoriCols,
            );
        }));
    }, [hitoriCols, hitoriRows, isHitori]);

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

    const updateNonogramClue = React.useCallback((axis: 'row' | 'column', index: number, value: string) => {
        const currentLines = axis === 'row'
            ? nonogramClueLines(nonogramRowClues)
            : nonogramClueLines(nonogramColumnClues);
        currentLines[index] = normalizeNonogramClue(value);
        const serialized = serializeNonogramClueLines(currentLines);
        if (axis === 'row') {
            setNonogramRowClues(serialized);
        } else {
            setNonogramColumnClues(serialized);
        }
        setSolveState({ running: false });
        markDirty();
    }, [markDirty, nonogramColumnClues, nonogramRowClues]);

    const updateNonogramClueDraft = React.useCallback((axis: 'row' | 'column', index: number, value: string) => {
        setNonogramClueDrafts(previous => ({
            ...previous,
            [`${axis}:${index}`]: value,
        }));
    }, []);

    const commitNonogramClueDraft = React.useCallback((axis: 'row' | 'column', index: number) => {
        const key = `${axis}:${index}`;
        const value = nonogramClueDrafts[key];
        if (value === undefined) {
            return;
        }
        updateNonogramClue(axis, index, value);
        setNonogramClueDrafts(previous => {
            const next = { ...previous };
            delete next[key];
            return next;
        });
    }, [nonogramClueDrafts, updateNonogramClue]);

    const setNonogramDimension = React.useCallback((axis: 'row' | 'column', rawValue: number) => {
        const size = Number.isFinite(rawValue)
            ? Math.min(50, Math.max(1, Math.floor(rawValue)))
            : 1;
        const currentLines = axis === 'row'
            ? nonogramClueLines(nonogramRowClues)
            : nonogramClueLines(nonogramColumnClues);
        const nextLines = Array.from(
            { length: size },
            (_unused, index) => currentLines[index] || '0',
        );
        const serialized = serializeNonogramClueLines(nextLines);
        if (axis === 'row') {
            setNonogramRowClues(serialized);
        } else {
            setNonogramColumnClues(serialized);
        }
        setNonogramClueDrafts({});
        setSolveState({ running: false });
        markDirty();
    }, [markDirty, nonogramColumnClues, nonogramRowClues]);

    const updateKakuroCellKind = React.useCallback((row: number, col: number, kind: KakuroCellKind) => {
        const nextLayout = cloneKakuroLayout(kakuroLayout);
        const current = nextLayout[row]?.[col];
        if (!current || current.kind === kind) {
            return;
        }
        nextLayout[row][col] = kakuroCell(kind);
        setKakuroLayout(nextLayout);
        setGrid(previous => resizeKakuroGrid(previous, nextLayout));
        setSolveState({ running: false });
        markDirty();
    }, [kakuroLayout, markDirty]);

    const updateKakuroClue = React.useCallback((row: number, col: number, direction: 'across' | 'down', rawValue: string) => {
        const nextLayout = cloneKakuroLayout(kakuroLayout);
        const current = nextLayout[row]?.[col];
        if (!current || current.kind !== 'clue') {
            return;
        }
        current[direction] = normalizeKakuroTotal(rawValue);
        setKakuroLayout(nextLayout);
        setSolveState({ running: false });
        markDirty();
    }, [kakuroLayout, markDirty]);

    const updateKakuroValue = React.useCallback((row: number, col: number, rawValue: string) => {
        setGrid(previous => {
            const next = resizeKakuroGrid(previous, kakuroLayout);
            next[row][col] = normalizeKakuroValue(rawValue);
            return next;
        });
        setSolveState({ running: false });
        markDirty();
    }, [kakuroLayout, markDirty]);

    const setKakuroDimension = React.useCallback((axis: 'row' | 'column', rawValue: number) => {
        const size = Number.isFinite(rawValue)
            ? Math.min(20, Math.max(2, Math.floor(rawValue)))
            : 2;
        const nextLayout = resizeKakuroLayout(
            kakuroLayout,
            axis === 'row' ? size : kakuroRows,
            axis === 'column' ? size : kakuroCols,
        );
        setKakuroLayout(nextLayout);
        setGrid(previous => resizeKakuroGrid(previous, nextLayout));
        setSolveState({ running: false });
        markDirty();
    }, [kakuroCols, kakuroLayout, kakuroRows, markDirty]);

    const clearKakuroValues = React.useCallback(() => {
        setGrid(previous => resizeKakuroGrid(createEmptyRectGrid(previous.length, previous[0]?.length || 0), kakuroLayout));
        setSolveState({ running: false });
        markDirty();
    }, [kakuroLayout, markDirty]);

    const resetKakuroLayout = React.useCallback(() => {
        const nextLayout = createKakuroStarterLayout();
        setKakuroLayout(nextLayout);
        setGrid(resizeKakuroGrid([], nextLayout));
        setKakuroTool('white');
        setSolveState({ running: false });
        markDirty();
    }, [markDirty]);

    const setHitoriDimension = React.useCallback((axis: 'row' | 'column', rawValue: number) => {
        const size = Number.isFinite(rawValue)
            ? Math.min(20, Math.max(2, Math.floor(rawValue)))
            : 2;
        const rows = axis === 'row' ? size : hitoriRows;
        const cols = axis === 'column' ? size : hitoriCols;
        setHitoriRows(rows);
        setHitoriCols(cols);
        setGrid(previous => resizeHitoriGrid(previous, rows, cols));
        setHitoriShaded(previous => resizeHitoriShaded(previous, rows, cols));
        setSolveState({ running: false });
        markDirty();
    }, [hitoriCols, hitoriRows, markDirty]);

    const updateHitoriValue = React.useCallback((row: number, col: number, rawValue: string) => {
        setGrid(previous => {
            const next = resizeHitoriGrid(previous, hitoriRows, hitoriCols);
            next[row][col] = normalizeHitoriValue(rawValue);
            return next;
        });
        setSolveState({ running: false });
        markDirty();
    }, [hitoriCols, hitoriRows, markDirty]);

    const toggleHitoriShade = React.useCallback((row: number, col: number) => {
        setHitoriShaded(previous => {
            const next = resizeHitoriShaded(previous, hitoriRows, hitoriCols);
            next[row][col] = !next[row][col];
            return next;
        });
        setSolveState({ running: false });
        markDirty();
    }, [hitoriCols, hitoriRows, markDirty]);

    const clearHitori = React.useCallback(() => {
        setGrid(createEmptyRectGrid(hitoriRows, hitoriCols));
        setHitoriShaded(resizeHitoriShaded([], hitoriRows, hitoriCols));
        setHitoriTool('numbers');
        setSolveState({ running: false });
        markDirty();
    }, [hitoriCols, hitoriRows, markDirty]);

    const clearHitoriShades = React.useCallback(() => {
        setHitoriShaded(resizeHitoriShaded([], hitoriRows, hitoriCols));
        setSolveState({ running: false });
        markDirty();
    }, [hitoriCols, hitoriRows, markDirty]);

    const updateNonogramCell = React.useCallback((row: number, col: number, value: string) => {
        setGrid(previous => {
            const next = resizeNonogramGrid(previous, nonogramRows, nonogramCols);
            next[row][col] = value === '#' || value === '.' ? value : '';
            return next;
        });
        setSolveState({ running: false });
        markDirty();
    }, [markDirty, nonogramCols, nonogramRows]);

    const cycleNonogramGridCell = React.useCallback((row: number, col: number, direction = 1) => {
        setGrid(previous => {
            const next = resizeNonogramGrid(previous, nonogramRows, nonogramCols);
            next[row][col] = cycleNonogramCell(next[row][col], direction);
            return next;
        });
        setSolveState({ running: false });
        markDirty();
    }, [markDirty, nonogramCols, nonogramRows]);

    const clearNonogramMarks = React.useCallback(() => {
        setGrid(createEmptyRectGrid(nonogramRows, nonogramCols));
        setSolveState({ running: false });
        markDirty();
    }, [markDirty, nonogramCols, nonogramRows]);

    const setGridAndQuickText = React.useCallback((nextGrid: Grid) => {
        setGrid(nextGrid);
        setQuickText(gridToText(nextGrid, puzzleType));
    }, [puzzleType]);

    const focusCell = React.useCallback((row: number, col: number, move: [number, number] = [0, 0]) => {
        let nextRow = Math.max(0, Math.min(gridSize - 1, row));
        const maxCol = isSujiken ? nextRow : gridSize - 1;
        let nextCol = Math.max(0, Math.min(isSamurai || isFlower || isSohei || isKazaguruma ? gridSize - 1 : maxCol, col));
        if (!isActiveCellForVariant(puzzleType, nextRow, nextCol)) {
            for (let step = 1; step < gridSize; step += 1) {
                const candidateRow = Math.max(0, Math.min(gridSize - 1, row + move[0] * step));
                const candidateCol = Math.max(0, Math.min(gridSize - 1, col + move[1] * step));
                if (candidateRow === nextRow && candidateCol === nextCol) {
                    continue;
                }
                if (isActiveCellForVariant(puzzleType, candidateRow, candidateCol)) {
                    nextRow = candidateRow;
                    nextCol = candidateCol;
                    break;
                }
            }
            if (!isActiveCellForVariant(puzzleType, nextRow, nextCol)) {
                return;
            }
        }
        cellRefs.current[nextRow]?.[nextCol]?.focus();
        cellRefs.current[nextRow]?.[nextCol]?.select();
    }, [gridSize, isFlower, isKazaguruma, isSamurai, isSohei, isSujiken, puzzleType]);

    const applyStateSnapshot = React.useCallback((snapshot: Record<string, any> | undefined) => {
        const variantSize = gridSizeForVariant(puzzleType);
        const inferredHitoriRows = Array.isArray(snapshot?.grid) ? snapshot.grid.length : 5;
        const inferredHitoriCols = Array.isArray(snapshot?.grid) && Array.isArray(snapshot.grid[0]) ? snapshot.grid[0].length : 5;
        const restoredHitoriRows = normalizeNumber(snapshot?.hitori?.rows, inferredHitoriRows, 2, 20);
        const restoredHitoriCols = normalizeNumber(snapshot?.hitori?.cols, inferredHitoriCols, 2, 20);
        const restoredKakuroLayout = normalizeKakuroLayout(snapshot?.kakuro?.layout ?? snapshot?.kakuroLayout)
            || createKakuroStarterLayout();
        const restoredGrid = puzzleType === 'kakuro'
            ? normalizeKakuroGrid(snapshot?.grid, restoredKakuroLayout)
            : puzzleType === 'hitori'
                ? normalizeHitoriGrid(snapshot?.grid, restoredHitoriRows, restoredHitoriCols)
            : normalizeGrid(snapshot?.grid, puzzleType) || createEmptyGrid(variantSize);
        const restoredChainGrid = normalizeChainGrid(snapshot?.chains ?? snapshot?.chainGrid, variantSize);
        const restoredResult = snapshot?.lastResult && typeof snapshot.lastResult === 'object'
            ? snapshot.lastResult as PluginResult
            : undefined;

        if (puzzleType === 'nonogram') {
            setGrid(restoredGrid);
            setQuickText(normalizeMultilineText(snapshot?.quickText ?? snapshot?.knownGrid ?? snapshot?.known_grid));
        } else if (puzzleType === 'kakuro') {
            setKakuroLayout(restoredKakuroLayout);
            setKakuroTool('white');
            setGrid(restoredGrid);
            setQuickText('');
        } else if (puzzleType === 'hitori') {
            setHitoriRows(restoredHitoriRows);
            setHitoriCols(restoredHitoriCols);
            setHitoriShaded(resizeHitoriShaded(snapshot?.hitori?.shaded ?? snapshot?.hitoriShaded ?? [], restoredHitoriRows, restoredHitoriCols));
            setHitoriTool('numbers');
            setGrid(restoredGrid);
            setQuickText('');
        } else {
            setGridAndQuickText(restoredGrid);
        }
        setWatchCells(normalizeWatchCells(snapshot?.watchCells ?? snapshot?.watchedCells));
        setHorizontalInequalities(normalizeInequalityGrid(snapshot?.inequalities?.horizontal, SIZE, SIZE - 1));
        setVerticalInequalities(normalizeInequalityGrid(snapshot?.inequalities?.vertical, SIZE - 1, SIZE));
        setVudokuCorners(normalizeVudokuGrid(snapshot?.vudoku ?? snapshot?.vudokuCorners));
        setXvHorizontalMarks(normalizeXvGrid(snapshot?.xv?.horizontal ?? snapshot?.xvMarks?.horizontal, SIZE, SIZE - 1));
        setXvVerticalMarks(normalizeXvGrid(snapshot?.xv?.vertical ?? snapshot?.xvMarks?.vertical, SIZE - 1, SIZE));
        setKropkiHorizontalDots(normalizeKropkiGrid(snapshot?.kropki?.horizontal ?? snapshot?.kropkiDots?.horizontal, SIZE, SIZE - 1));
        setKropkiVerticalDots(normalizeKropkiGrid(snapshot?.kropki?.vertical ?? snapshot?.kropkiDots?.vertical, SIZE - 1, SIZE));
        setChainGrid(restoredChainGrid);
        setChainPaths(normalizeChainPaths(snapshot?.chains?.paths ?? snapshot?.chainPaths, restoredChainGrid, variantSize));
        setActiveChain(previous => Math.min(previous, variantSize));
        setParityMarks(normalizeParityGrid(snapshot?.parity ?? snapshot?.parityMarks));
        setTripodDots(normalizeTripodDots(snapshot?.tripod ?? snapshot?.tripodDots, variantSize));
        setSkyscraperClues(normalizeSkyscraperClues(snapshot?.skyscraper ?? snapshot?.skyscraperClues));
        setFrameClues(normalizeFrameClues(snapshot?.frame ?? snapshot?.frameClues));
        setOutsideClues(normalizeOutsideClues(snapshot?.outside ?? snapshot?.outsideClues));
        setSandwichClues(normalizeSandwichClues(snapshot?.sandwich ?? snapshot?.sandwichClues));
        setLittleKillerClues(normalizeLittleKillerClues(snapshot?.littleKiller ?? snapshot?.little_killer ?? snapshot?.littleKillerClues));
        setRossiniArrows(normalizeRossiniArrows(snapshot?.rossini ?? snapshot?.rossiniArrows));
        setGodokuAlphabet(normalizeGodokuAlphabet(snapshot?.godokuAlphabet ?? snapshot?.alphabet));
        setNonogramRowClues(normalizeMultilineText(snapshot?.nonogram?.rowClues ?? snapshot?.rowClues ?? snapshot?.row_clues));
        setNonogramColumnClues(normalizeMultilineText(snapshot?.nonogram?.columnClues ?? snapshot?.columnClues ?? snapshot?.column_clues));
        setMaxSolutions(normalizeNumber(snapshot?.maxSolutions, 2, 1, 25));
        setTimeoutMs(normalizeNumber(snapshot?.solverTimeoutMs ?? snapshot?.timeoutMs, 10000, 1000, 120000));
        setSelectedSolutionIndex(0);
        setSolveState({ running: false, result: restoredResult });
    }, [puzzleType, setGridAndQuickText]);

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
                    vudoku: {
                        grid: vudokuCorners,
                    },
                    xv: {
                        horizontal: xvHorizontalMarks,
                        vertical: xvVerticalMarks,
                    },
                    kropki: {
                        horizontal: kropkiHorizontalDots,
                        vertical: kropkiVerticalDots,
                    },
                    chains: {
                        grid: chainGrid,
                        paths: chainPaths,
                    },
                    parity: {
                        grid: parityMarks,
                    },
                    tripod: {
                        dots: tripodDots,
                    },
                    skyscraper: skyscraperClues,
                    frame: frameClues,
                    outside: outsideClues,
                    sandwich: sandwichClues,
                    littleKiller: littleKillerClues,
                    rossini: rossiniArrows,
                    godokuAlphabet,
                    nonogram: {
                        rowClues: nonogramRowClues,
                        columnClues: nonogramColumnClues,
                    },
                    kakuro: {
                        layout: kakuroLayout,
                    },
                    hitori: {
                        rows: hitoriRows,
                        cols: hitoriCols,
                        shaded: hitoriShaded,
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
        chainGrid,
        chainPaths,
        frameClues,
        geocacheId,
        godokuAlphabet,
        grid,
        horizontalInequalities,
        hitoriCols,
        hitoriRows,
        hitoriShaded,
        kakuroLayout,
        kropkiHorizontalDots,
        kropkiVerticalDots,
        littleKillerClues,
        maxSolutions,
        messageService,
        nonogramColumnClues,
        nonogramRowClues,
        outsideClues,
        parityMarks,
        pluginsService,
        puzzleType,
        quickText,
        rossiniArrows,
        sandwichClues,
        skyscraperClues,
        solveState.result,
        timeoutMs,
        tripodDots,
        variantLabel,
        verticalInequalities,
        vudokuCorners,
        watchCells,
        xvHorizontalMarks,
        xvVerticalMarks,
    ]);

    const updateCell = React.useCallback((row: number, col: number, rawValue: string) => {
        const value = normalizeCellValueForVariant(rawValue, puzzleType);
        setGrid(previous => {
            const next = cloneGrid(previous);
            next[row][col] = value;
            setQuickText(gridToText(next, puzzleType));
            return next;
        });
        setSolveState({ running: false });
        markDirty();
    }, [markDirty, puzzleType]);

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

    const toggleVudokuCorner = React.useCallback((row: number, col: number) => {
        setVudokuCorners(previous => {
            const next = cloneVudokuGrid(previous);
            next[row][col] = cycleVudokuCorner(next[row][col]);
            return next;
        });
        setSolveState({ running: false });
        markDirty();
    }, [markDirty]);

    const toggleHorizontalXvMark = React.useCallback((row: number, col: number) => {
        setXvHorizontalMarks(previous => {
            const next = cloneXvGrid(previous);
            next[row][col] = cycleXvMark(next[row][col]);
            return next;
        });
        setSolveState({ running: false });
        markDirty();
    }, [markDirty]);

    const toggleVerticalXvMark = React.useCallback((row: number, col: number) => {
        setXvVerticalMarks(previous => {
            const next = cloneXvGrid(previous);
            next[row][col] = cycleXvMark(next[row][col]);
            return next;
        });
        setSolveState({ running: false });
        markDirty();
    }, [markDirty]);

    const toggleParityCell = React.useCallback((row: number, col: number) => {
        setParityMarks(previous => {
            const next = cloneParityGrid(previous);
            next[row][col] = cycleParitySymbol(next[row][col]);
            return next;
        });
        setSolveState({ running: false });
        markDirty();
    }, [markDirty]);

    const toggleTripodDot = React.useCallback((row: number, col: number) => {
        setTripodDots(previous => {
            const next = cloneTripodDots(previous);
            next[row][col] = !next[row][col];
            return next;
        });
        setSolveState({ running: false });
        markDirty();
    }, [markDirty]);

    const toggleRossiniArrow = React.useCallback((side: RossiniSide, index: number) => {
        setRossiniArrows(previous => {
            const next = cloneRossiniArrows(previous);
            next[side][index] = cycleRossiniArrow(side, next[side][index]);
            return next;
        });
        setSolveState({ running: false });
        markDirty();
    }, [markDirty]);

    const updateSkyscraperClue = React.useCallback((side: SkyscraperSide, index: number, rawValue: string) => {
        const value = normalizeSkyscraperClue(rawValue);
        setSkyscraperClues(previous => {
            const next = cloneSkyscraperClues(previous);
            next[side][index] = value;
            return next;
        });
        setSolveState({ running: false });
        markDirty();
    }, [markDirty]);

    const updateFrameClue = React.useCallback((side: SkyscraperSide, index: number, rawValue: string) => {
        const value = normalizeFrameClue(rawValue);
        setFrameClues(previous => {
            const next = cloneFrameClues(previous);
            next[side][index] = value;
            return next;
        });
        setSolveState({ running: false });
        markDirty();
    }, [markDirty]);

    const updateOutsideClue = React.useCallback((side: SkyscraperSide, index: number, rawValue: string) => {
        const value = normalizeOutsideClue(rawValue);
        setOutsideClues(previous => {
            const next = cloneOutsideClues(previous);
            next[side][index] = value;
            return next;
        });
        setSolveState({ running: false });
        markDirty();
    }, [markDirty]);

    const updateSandwichClue = React.useCallback((side: SkyscraperSide, index: number, rawValue: string) => {
        const value = normalizeSandwichClue(rawValue);
        setSandwichClues(previous => {
            const next = cloneSandwichClues(previous);
            next[side][index] = value;
            return next;
        });
        setSolveState({ running: false });
        markDirty();
    }, [markDirty]);

    const toggleHorizontalKropkiDot = React.useCallback((row: number, col: number) => {
        setKropkiHorizontalDots(previous => {
            const next = cloneKropkiGrid(previous);
            next[row][col] = cycleKropkiDot(next[row][col]);
            return next;
        });
        setSolveState({ running: false });
        markDirty();
    }, [markDirty]);

    const toggleVerticalKropkiDot = React.useCallback((row: number, col: number) => {
        setKropkiVerticalDots(previous => {
            const next = cloneKropkiGrid(previous);
            next[row][col] = cycleKropkiDot(next[row][col]);
            return next;
        });
        setSolveState({ running: false });
        markDirty();
    }, [markDirty]);

    const assignChainCell = React.useCallback((row: number, col: number) => {
        const size = chainConfig?.size;
        if (!size || row < 0 || row >= size || col < 0 || col >= size) {
            return;
        }

        setChainPaths(previous => {
            const next = cloneChainPaths(previous);
            while (next.length < size) {
                next.push([]);
            }
            next.length = size;

            let targetChain = Math.max(1, Math.min(activeChain, size));
            let targetIndex = targetChain - 1;
            const existingIndex = next.findIndex(path => path.some(([cellRow, cellCol]) => cellRow === row && cellCol === col));

            if (existingIndex >= 0) {
                next[existingIndex] = next[existingIndex].filter(([cellRow, cellCol]) => cellRow !== row || cellCol !== col);
                targetChain = existingIndex + 1;
                targetIndex = existingIndex;
            } else {
                if (next[targetIndex].length >= size) {
                    const incompleteIndex = next.findIndex(path => path.length < size);
                    if (incompleteIndex >= 0) {
                        targetIndex = incompleteIndex;
                        targetChain = incompleteIndex + 1;
                    }
                }

                if (next[targetIndex].length < size) {
                    next[targetIndex] = [...next[targetIndex], [row, col]];
                }
            }

            const counts = next.map(path => path.length);
            setActiveChain(counts[targetIndex] >= size ? nextIncompleteChain(counts, size, targetChain) : targetChain);
            setChainGrid(chainGridFromPaths(next, size));
            return next;
        });
        setSolveState({ running: false });
        markDirty();
    }, [activeChain, chainConfig?.size, markDirty]);

    const clearActiveChain = React.useCallback(() => {
        const size = chainConfig?.size;
        if (!size) {
            return;
        }
        setChainPaths(previous => {
            const next = cloneChainPaths(previous);
            while (next.length < size) {
                next.push([]);
            }
            next.length = size;
            next[Math.max(0, Math.min(activeChain - 1, size - 1))] = [];
            setChainGrid(chainGridFromPaths(next, size));
            return next;
        });
        setSolveState({ running: false });
        markDirty();
    }, [activeChain, chainConfig?.size, markDirty]);

    const updateLittleKillerTotal = React.useCallback((side: SkyscraperSide, index: number, rawValue: string) => {
        const value = normalizeLittleKillerTotal(rawValue);
        setLittleKillerClues(previous => {
            const next = cloneLittleKillerClues(previous);
            next[side][index] = {
                ...next[side][index],
                total: value,
            };
            return next;
        });
        setSolveState({ running: false });
        markDirty();
    }, [markDirty]);

    const toggleLittleKillerDirection = React.useCallback((side: SkyscraperSide, index: number) => {
        setLittleKillerClues(previous => {
            const next = cloneLittleKillerClues(previous);
            next[side][index] = {
                ...next[side][index],
                direction: cycleLittleKillerDirection(side, next[side][index].direction),
            };
            return next;
        });
        setSolveState({ running: false });
        markDirty();
    }, [markDirty]);

    const invertLittleKillerSideDirections = React.useCallback((side?: SkyscraperSide) => {
        const sides: SkyscraperSide[] = side ? [side] : ['top', 'bottom', 'left', 'right'];
        setLittleKillerClues(previous => {
            const next = cloneLittleKillerClues(previous);
            sides.forEach(currentSide => {
                next[currentSide] = next[currentSide].map(clue => ({
                    ...clue,
                    direction: cycleLittleKillerDirection(currentSide, clue.direction),
                }));
            });
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
            focusCell(row + move[0], col + move[1], move);
            return;
        }

        if (event.key === 'Backspace' || event.key === 'Delete') {
            event.preventDefault();
            updateCell(row, col, '');
            return;
        }

        if (normalizeCellValueForVariant(event.key, puzzleType)) {
            event.preventDefault();
            updateCell(row, col, event.key);
            return;
        }

        if (event.key === '0' || event.key === '.' || event.key === '_') {
            event.preventDefault();
            updateCell(row, col, '');
        }
    }, [focusCell, puzzleType, updateCell]);

    const toggleWatchCell = React.useCallback((ref: string) => {
        setWatchCells(previous => (
            previous.includes(ref)
                ? previous.filter(item => item !== ref)
                : [...previous, ref]
        ));
        markDirty();
    }, [markDirty]);

    const focusNonogramCell = React.useCallback((row: number, col: number) => {
        const targetRow = Math.max(0, Math.min(nonogramRows - 1, row));
        const targetCol = Math.max(0, Math.min(nonogramCols - 1, col));
        nonogramCellRefs.current[targetRow]?.[targetCol]?.focus();
    }, [nonogramCols, nonogramRows]);

    const focusHitoriCell = React.useCallback((row: number, col: number) => {
        const targetRow = Math.max(0, Math.min(hitoriRows - 1, row));
        const targetCol = Math.max(0, Math.min(hitoriCols - 1, col));
        const target = hitoriCellRefs.current[targetRow]?.[targetCol];
        target?.focus();
        if (target instanceof HTMLInputElement) {
            target.select();
        }
    }, [hitoriCols, hitoriRows]);

    const handleHitoriCellKeyDown = React.useCallback((row: number, col: number, event: React.KeyboardEvent<HTMLElement>) => {
        const moves: Record<string, [number, number]> = {
            ArrowUp: [-1, 0],
            ArrowDown: [1, 0],
            ArrowLeft: [0, -1],
            ArrowRight: [0, 1],
        };
        const move = moves[event.key];
        if (!move) {
            return;
        }
        event.preventDefault();
        focusHitoriCell(row + move[0], col + move[1]);
    }, [focusHitoriCell]);

    const handleNonogramCellClick = React.useCallback((row: number, col: number, event: React.MouseEvent<HTMLButtonElement>) => {
        const ref = cellRef(row, col);
        if (mode === 'watch' || event.ctrlKey || event.metaKey) {
            event.preventDefault();
            toggleWatchCell(ref);
            return;
        }
        cycleNonogramGridCell(row, col);
    }, [cycleNonogramGridCell, mode, toggleWatchCell]);

    const handleNonogramCellContextMenu = React.useCallback((row: number, col: number, event: React.MouseEvent<HTMLButtonElement>) => {
        event.preventDefault();
        if (mode === 'watch') {
            toggleWatchCell(cellRef(row, col));
            return;
        }
        cycleNonogramGridCell(row, col, -1);
    }, [cycleNonogramGridCell, mode, toggleWatchCell]);

    const handleNonogramCellKeyDown = React.useCallback((row: number, col: number, event: React.KeyboardEvent<HTMLButtonElement>) => {
        const moves: Record<string, [number, number]> = {
            ArrowUp: [-1, 0],
            ArrowDown: [1, 0],
            ArrowLeft: [0, -1],
            ArrowRight: [0, 1],
        };
        const move = moves[event.key];
        if (move) {
            event.preventDefault();
            focusNonogramCell(row + move[0], col + move[1]);
            return;
        }
        if (event.key === ' ' || event.key === 'Enter') {
            event.preventDefault();
            if (mode === 'watch') {
                toggleWatchCell(cellRef(row, col));
            } else {
                cycleNonogramGridCell(row, col);
            }
            return;
        }
        if (event.key === '#' || event.key.toLowerCase() === 'x' || event.key === '1') {
            event.preventDefault();
            updateNonogramCell(row, col, '#');
            return;
        }
        if (event.key === '.' || event.key === '-' || event.key === '0') {
            event.preventDefault();
            updateNonogramCell(row, col, '.');
            return;
        }
        if (event.key === 'Backspace' || event.key === 'Delete') {
            event.preventDefault();
            updateNonogramCell(row, col, '');
        }
    }, [cycleNonogramGridCell, focusNonogramCell, mode, toggleWatchCell, updateNonogramCell]);

    const handleCellClick = React.useCallback((row: number, col: number, event: React.MouseEvent) => {
        const ref = cellRef(row, col);
        if (isEvenOdd && mode === 'parity') {
            event.preventDefault();
            if (event.detail === 1) {
                toggleParityCell(row, col);
            }
            return;
        }
        if (isChain && mode === 'chain') {
            event.preventDefault();
            assignChainCell(row, col);
            return;
        }
        if (mode === 'watch' || event.ctrlKey || event.metaKey) {
            event.preventDefault();
            toggleWatchCell(ref);
        }
    }, [assignChainCell, isChain, isEvenOdd, mode, toggleParityCell, toggleWatchCell]);

    const handleCellDoubleClick = React.useCallback((row: number, col: number, event: React.MouseEvent) => {
        if (!isEvenOdd || mode === 'parity') {
            return;
        }
        event.preventDefault();
        toggleParityCell(row, col);
    }, [isEvenOdd, mode, toggleParityCell]);

    const applyQuickText = React.useCallback((text: string) => {
        const parsed = parsePuzzleText(text, puzzleType);
        if (!parsed) {
            messageService.error(
                puzzleType === 'sujiken'
                    ? 'La saisie rapide Sujiken doit contenir 45 cases actives.'
                    : puzzleType === 'sudoku_hoshi'
                        ? 'La saisie rapide Hoshi doit contenir 54 cellules triangulaires, ou 6 lignes de 9.'
                    : sizedSudokuConfig
                        ? `La saisie rapide ${sizedSudokuConfig.label} doit contenir exactement ${sizedSudokuConfig.size * sizedSudokuConfig.size} cases, avec symboles ${sudokuSymbolsForSize(sizedSudokuConfig.size).join('')} ou cases vides.`
                    : tripodConfig
                        ? `La saisie rapide ${tripodConfig.label} doit contenir exactement ${tripodConfig.size * tripodConfig.size} cases, avec symboles ${sudokuSymbolsForSize(tripodConfig.size).join('')} ou cases vides.`
                    : chainConfig
                        ? `La saisie rapide ${chainConfig.label} doit contenir exactement ${chainConfig.size * chainConfig.size} ronds, avec symboles ${sudokuSymbolsForSize(chainConfig.size).join('')} ou ronds vides.`
                    : mineConfig
                        ? `La saisie rapide ${mineConfig.label} doit contenir exactement ${mineConfig.size * mineConfig.size} cases, avec chiffres 0-8 pour les indices et . pour les cases inconnues.`
                    : puzzleType === 'sudoku_godoku'
                        ? 'La saisie rapide Godoku doit contenir exactement 81 cases, avec lettres ou cases vides.'
                    : puzzleType === 'samurai_sudoku'
                        ? 'La saisie rapide Samurai doit contenir 369 cases actives ou une matrice 21x21.'
                        : puzzleType === 'flower_sudoku'
                            ? 'La saisie rapide Flower doit contenir 189 cases actives ou une matrice 15x15.'
                            : puzzleType === 'kazaguruma_sudoku'
                                ? 'La saisie rapide Kazaguruma doit contenir 333 cases actives ou une matrice 21x21.'
                            : puzzleType === 'sohei_sudoku'
                                ? 'La saisie rapide Sohei doit contenir 288 cases actives ou une matrice 21x21.'
                    : 'La saisie rapide doit contenir exactement 81 cases.'
            );
            return;
        }
        setGridAndQuickText(parsed);
        setSolveState({ running: false });
        markDirty();
    }, [chainConfig, markDirty, messageService, puzzleType, setGridAndQuickText, sizedSudokuConfig, tripodConfig, mineConfig]);

    const handleQuickTextChange = React.useCallback((text: string) => {
        setQuickText(text);
        if (isNonogram) {
            setSolveState({ running: false });
            markDirty();
            return;
        }
        const parsed = parsePuzzleText(text, puzzleType);
        if (parsed) {
            setGrid(parsed);
            setSolveState({ running: false });
        }
        markDirty();
    }, [isNonogram, markDirty, puzzleType]);

    const handlePuzzleTypeChange = React.useCallback((value: string) => {
        const nextPuzzleType = value === 'sudoku_4x4'
            || value === 'sudoku_6x6'
            || value === 'sudoku_8x8'
            || value === 'sudoku_10x10'
            || value === 'sudoku_12x12'
            || value === 'sudoku_15x15'
            || value === 'sudoku_16x16'
            || value === 'sudoku_x'
            || value === 'sudoku_argyle'
            || value === 'sudoku_anti_diagonal'
            || value === 'sudoku_center_dot'
            || value === 'sudoku_windoku'
            || value === 'sudoku_girandola'
            || value === 'sudoku_asterisk'
            || value === 'sujiken'
            || value === 'sudoku_hoshi'
            || value === 'samurai_sudoku'
            || value === 'flower_sudoku'
            || value === 'sohei_sudoku'
            || value === 'kazaguruma_sudoku'
            || value === 'sudoku_greater_than'
            || value === 'sudoku_vudoku'
            || value === 'sudoku_rossini'
            || value === 'sudoku_xv'
            || value === 'sudoku_kropki'
            || value === 'chain_sudoku_4x4'
            || value === 'chain_sudoku_5x5'
            || value === 'chain_sudoku_6x6'
            || value === 'chain_sudoku_7x7'
            || value === 'chain_sudoku_8x8'
            || value === 'chain_sudoku_9x9'
            || value === 'sudoku_skyscraper'
            || value === 'sudoku_frame'
            || value === 'sudoku_outside'
            || value === 'sudoku_sandwich'
            || value === 'sudoku_little_killer'
            || value === 'sudoku_little_unique_killer'
            || value === 'sudoku_godoku'
            || value === 'sudoku_even_odd'
            || value === 'sudoku_non_consecutive'
            || value === 'sudoku_mine'
            || value === 'sudoku_mine_6x6'
            || value === 'sudoku_tripod'
            || value === 'sudoku_tripod_4x4'
            || value === 'sudoku_tripod_5x5'
            || value === 'sudoku_tripod_6x6'
            || value === 'sudoku_tripod_7x7'
            || value === 'sudoku_tripod_8x8'
            || value === 'nonogram'
            || value === 'kakuro'
            || value === 'hitori'
            ? value
            : 'sudoku_classic';
        const nextGrid = nextPuzzleType === 'hitori'
            ? resizeHitoriGrid(puzzleType === 'hitori' ? grid : [], hitoriRows, hitoriCols)
            : nextPuzzleType === 'kakuro'
                ? resizeKakuroGrid(puzzleType === 'kakuro' ? grid : [], kakuroLayout)
                : resizeGrid(grid, gridSizeForVariant(nextPuzzleType));
        setGrid(nextGrid);
        setPuzzleType(nextPuzzleType);
        if (nextPuzzleType !== 'sudoku_even_odd' && mode === 'parity') {
            setMode('edit');
        }
        if (!getChainConfig(nextPuzzleType) && mode === 'chain') {
            setMode('edit');
        }
        if (nextPuzzleType === 'kakuro') {
            setMode('edit');
            setKakuroTool('white');
        }
        if (nextPuzzleType === 'hitori') {
            setMode('edit');
            setHitoriTool('numbers');
            setHitoriShaded(resizeHitoriShaded([], hitoriRows, hitoriCols));
        }
        if (getTripodConfig(nextPuzzleType)) {
            setTripodDots(emptyTripodDots(gridSizeForVariant(nextPuzzleType)));
        }
        if (getChainConfig(nextPuzzleType)) {
            const nextSize = gridSizeForVariant(nextPuzzleType);
            setChainGrid(emptyChainGrid(nextSize));
            setChainPaths(emptyChainPaths(nextSize));
            setActiveChain(1);
            setMode('chain');
        }
        setQuickText(nextPuzzleType === 'nonogram' || nextPuzzleType === 'kakuro' || nextPuzzleType === 'hitori' ? '' : gridToText(nextGrid, nextPuzzleType));
        setSolveState({ running: false });
        markDirty();
    }, [grid, hitoriCols, hitoriRows, kakuroLayout, markDirty, mode, puzzleType]);

    const clearGrid = React.useCallback(() => {
        if (isNonogram) {
            setGrid(createEmptyGrid(SIZE));
            setQuickText('');
            setNonogramRowClues('');
            setNonogramColumnClues('');
        } else if (isKakuro) {
            setGrid(resizeKakuroGrid([], kakuroLayout));
            setQuickText('');
        } else if (isHitori) {
            setGrid(createEmptyRectGrid(hitoriRows, hitoriCols));
            setHitoriShaded(resizeHitoriShaded([], hitoriRows, hitoriCols));
            setQuickText('');
        } else {
            setGridAndQuickText(createEmptyGrid(gridSizeForVariant(puzzleType)));
        }
        setHorizontalInequalities(emptyHorizontalInequalities());
        setVerticalInequalities(emptyVerticalInequalities());
        setVudokuCorners(emptyVudokuCorners());
        setXvHorizontalMarks(emptyXvHorizontalMarks());
        setXvVerticalMarks(emptyXvVerticalMarks());
        setKropkiHorizontalDots(emptyKropkiHorizontalDots());
        setKropkiVerticalDots(emptyKropkiVerticalDots());
        setParityMarks(emptyParityMarks());
        setTripodDots(emptyTripodDots(gridSizeForVariant(puzzleType)));
        setChainGrid(emptyChainGrid(gridSizeForVariant(puzzleType)));
        setChainPaths(emptyChainPaths(gridSizeForVariant(puzzleType)));
        setActiveChain(1);
        setSkyscraperClues(emptySkyscraperClues());
        setFrameClues(emptyFrameClues());
        setOutsideClues(emptyOutsideClues());
        setSandwichClues(emptySandwichClues());
        setLittleKillerClues(emptyLittleKillerClues());
        setRossiniArrows(emptyRossiniArrows());
        setWatchCells([]);
        setSolveState({ running: false });
        markDirty();
    }, [hitoriCols, hitoriRows, isHitori, isKakuro, isNonogram, kakuroLayout, markDirty, puzzleType, setGridAndQuickText]);

    const solve = React.useCallback(async () => {
        if (constraintConflicts.messages.length > 0) {
            setSolveState({
                running: false,
                error: 'Corrigez les conflits en rouge avant de lancer la resolution.',
            });
            return;
        }
        if (isChain && !areChainsComplete) {
            setSolveState({
                running: false,
                error: `Completez les chaines avant de lancer la resolution : chaque chaine doit contenir ${chainConfig?.size} ronds.`,
            });
            return;
        }
        setSelectedSolutionIndex(0);
        setSolveState({ running: true });
        try {
            const result = await pluginsService.executePlugin('grid_puzzle_solver', {
                puzzle_type: puzzleType,
                grid: isHitori
                    ? resizeHitoriGrid(grid, hitoriRows, hitoriCols)
                    : isKakuro
                        ? resizeKakuroGrid(grid, kakuroLayout)
                        : isNonogram
                            ? gridToText(resizeNonogramGrid(grid, nonogramRows, nonogramCols), puzzleType)
                            : gridToText(grid, puzzleType),
                kakuro: isKakuro ? { cells: kakuroLayout } : undefined,
                shaded: isHitori ? hitoriShaded : undefined,
                row_clues: isNonogram ? serializeNonogramClueLines(nonogramRowClueLines) : undefined,
                column_clues: isNonogram ? serializeNonogramClueLines(nonogramColumnClueLines) : undefined,
                watched_cells: watchCells.join(' '),
                inequalities: {
                    horizontal: horizontalInequalities,
                    vertical: verticalInequalities,
                },
                vudoku: isVudoku ? { grid: vudokuCorners } : undefined,
                rossini: isRossini ? {
                    ...rossiniArrows,
                    enforce_absent: true,
                } : undefined,
                xv: isXv ? {
                    horizontal: xvHorizontalMarks,
                    vertical: xvVerticalMarks,
                    enforce_absent: true,
                } : undefined,
                kropki: isKropki ? {
                    horizontal: kropkiHorizontalDots,
                    vertical: kropkiVerticalDots,
                    enforce_absent: true,
                } : undefined,
                skyscraper: isSkyscraper ? skyscraperClues : undefined,
                frame: isFrame ? frameClues : undefined,
                outside: isOutside ? outsideClues : undefined,
                sandwich: isSandwich ? activeSandwichClues(sandwichClues) : undefined,
                little_killer: isLittleKiller ? littleKillerClues : undefined,
                alphabet: isGodoku && godokuAlphabet ? godokuAlphabet : undefined,
                parity: isEvenOdd ? { grid: parityMarks } : undefined,
                tripod: isTripod ? { dots: tripodDots } : undefined,
                chains: isChain ? { grid: chainGrid } : undefined,
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
    }, [areChainsComplete, chainConfig?.size, chainGrid, constraintConflicts.messages.length, frameClues, geocacheId, godokuAlphabet, grid, hitoriCols, hitoriRows, hitoriShaded, horizontalInequalities, isChain, isEvenOdd, isFrame, isGodoku, isHitori, isKakuro, isKropki, isLittleKiller, isNonogram, isOutside, isRossini, isSandwich, isSkyscraper, isTripod, isVudoku, isXv, kakuroLayout, kropkiHorizontalDots, kropkiVerticalDots, littleKillerClues, maxSolutions, nonogramCols, nonogramColumnClueLines, nonogramRows, nonogramRowClueLines, outsideClues, parityMarks, pluginsService, puzzleType, rossiniArrows, sandwichClues, saveState, skyscraperClues, timeoutMs, tripodDots, verticalInequalities, vudokuCorners, watchCells, xvHorizontalMarks, xvVerticalMarks]);

    const useSolvedGrid = React.useCallback(() => {
        if (solvedGrid) {
            if (isHitori) {
                setHitoriShaded(resizeHitoriShaded(solvedGrid.map(row => row.map(value => value === '#')), hitoriRows, hitoriCols));
            } else if (isKakuro) {
                setGrid(resizeKakuroGrid(solvedGrid, kakuroLayout));
            } else {
                setGridAndQuickText(solvedGrid);
            }
            setSolveState({ running: false });
            markDirty();
        }
    }, [hitoriCols, hitoriRows, isHitori, isKakuro, kakuroLayout, markDirty, setGridAndQuickText, solvedGrid]);

    const cellStyle = (rowIndex: number, colIndex: number): React.CSSProperties | undefined => {
        if (variableGridConfig) {
            return {
                gridColumn: String(colIndex + 1),
                gridRow: String(rowIndex + 1),
                width: sizedCellSize,
                height: sizedCellSize,
                fontSize: sizedCellSize <= 32 ? 14 : sizedCellSize <= 36 ? 16 : 19,
            };
        }
        if (isGreaterThan || isVudoku || isXv || isKropki) {
            return {
                gridColumn: String(colIndex * 2 + 1),
                gridRow: String(rowIndex * 2 + 1),
            };
        }
        if (isHoshi) {
            const layout = HOSHI_LAYOUT_BY_REF.get(`${rowIndex}:${colIndex}`);
            if (!layout) {
                return undefined;
            }
            return {
                position: 'absolute',
                left: layout.left,
                top: layout.top,
                width: layout.width,
                height: layout.height,
                clipPath: layout.clipPath,
            };
        }
        if (isRossini || isSkyscraper || isFrame || isOutside || isSandwich || isLittleKiller) {
            return {
                gridColumn: String(colIndex + 2),
                gridRow: String(rowIndex + 2),
            };
        }
        if (isSujiken || isSamurai || isSohei || isKazaguruma || isFlower) {
            return {
                gridColumn: String(colIndex + 1),
                gridRow: String(rowIndex + 1),
            };
        }
        return undefined;
    };

    const tripodRegionBoundaryClasses = (rowIndex: number, colIndex: number): string[] => {
        if (!solvedRegionGrid) {
            return [];
        }
        const region = solvedRegionGrid[rowIndex]?.[colIndex];
        if (!Number.isFinite(region)) {
            return [];
        }
        return [
            colIndex < gridSize - 1 && solvedRegionGrid[rowIndex]?.[colIndex + 1] !== region ? 'tripod-region-right' : '',
            rowIndex < gridSize - 1 && solvedRegionGrid[rowIndex + 1]?.[colIndex] !== region ? 'tripod-region-bottom' : '',
        ].filter(Boolean);
    };

    const cellClassName = (
        rowIndex: number,
        colIndex: number,
        value: string,
        readonly = false,
        extraClasses: string[] = [],
    ): string => {
        const ref = cellRef(rowIndex, colIndex);
        const blockConfig = isTripod || isChain || isHoshi ? undefined : mineConfig || getSingleGridSudokuConfig(puzzleType);
        const isCompositeSudoku = puzzleType === 'samurai_sudoku'
            || puzzleType === 'flower_sudoku'
            || puzzleType === 'sohei_sudoku'
            || puzzleType === 'kazaguruma_sudoku';
        const hasBlockRight = blockConfig
            && !isCompositeSudoku
            && (colIndex + 1) % blockConfig.boxCols === 0
            && colIndex !== blockConfig.size - 1;
        const hasBlockBottom = blockConfig
            && !isCompositeSudoku
            && (rowIndex + 1) % blockConfig.boxRows === 0
            && rowIndex !== blockConfig.size - 1;
        return [
            'sudoku-cell',
            readonly ? 'readonly' : '',
            value ? 'given' : '',
            !readonly && value && constraintConflicts.cells.has(ref) ? 'conflict' : '',
            watchCells.includes(ref) ? 'watched' : '',
            puzzleType === 'sudoku_x' && isMainDiagonalCell(rowIndex, colIndex) ? 'diagonal' : '',
            ...(puzzleType === 'sudoku_argyle' ? getArgyleCellClasses(rowIndex, colIndex) : []),
            puzzleType === 'sudoku_anti_diagonal' && isMainDiagonalCell(rowIndex, colIndex) ? 'anti-diagonal' : '',
            puzzleType === 'sudoku_center_dot' && isCenterDotCell(rowIndex, colIndex) ? 'center-dot' : '',
            puzzleType === 'sudoku_windoku' && isWindokuCell(rowIndex, colIndex) ? 'windoku' : '',
            puzzleType === 'sudoku_girandola' && isGirandolaCell(rowIndex, colIndex) ? 'girandola' : '',
            puzzleType === 'sudoku_asterisk' && isAsteriskCell(rowIndex, colIndex) ? 'asterisk' : '',
            puzzleType === 'sudoku_even_odd' && parityMarks[rowIndex]?.[colIndex] === 'even' ? 'even-parity' : '',
            puzzleType === 'sudoku_even_odd' && parityMarks[rowIndex]?.[colIndex] === 'odd' ? 'odd-parity' : '',
            isMine && value ? 'mine-clue' : '',
            isChain ? 'chain-cell' : '',
            isChain ? `chain-${chainGrid[rowIndex]?.[colIndex] || 0}` : '',
            isChain && mode === 'chain' && chainGrid[rowIndex]?.[colIndex] === activeChain ? 'chain-active' : '',
            isHoshi ? `hoshi-cell hoshi-region-${rowIndex + 1}` : '',
            puzzleType === 'sujiken' ? 'sujiken-cell' : '',
            puzzleType === 'samurai_sudoku' ? 'samurai-cell' : '',
            puzzleType === 'flower_sudoku' ? 'flower-cell' : '',
            puzzleType === 'sohei_sudoku' ? 'sohei-cell' : '',
            puzzleType === 'kazaguruma_sudoku' ? 'kazaguruma-cell' : '',
            puzzleType === 'kazaguruma_sudoku' && isInsideSquare(rowIndex, colIndex, 6, 6) ? 'kazaguruma-center' : '',
            ...(puzzleType === 'sudoku_windoku' ? getWindokuBoundaryClasses(rowIndex, colIndex) : []),
            ...(puzzleType === 'samurai_sudoku' ? getSamuraiBoundaryClasses(rowIndex, colIndex) : []),
            ...(puzzleType === 'flower_sudoku' ? getFlowerBoundaryClasses(rowIndex, colIndex) : []),
            ...(puzzleType === 'sohei_sudoku' ? getSoheiBoundaryClasses(rowIndex, colIndex) : []),
            ...(puzzleType === 'kazaguruma_sudoku' ? getKazagurumaBoundaryClasses(rowIndex, colIndex) : []),
            hasBlockRight ? 'block-right' : '',
            hasBlockBottom ? 'block-bottom' : '',
            ...extraClasses,
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

    const renderVudokuControls = (readonly = false): React.ReactNode => {
        if (!isVudoku) {
            return null;
        }

        return (
            <>
                {vudokuCorners.map((row, rowIndex) => (
                    row.map((value, colIndex) => (
                        <button
                            key={`vudoku-${rowIndex}-${colIndex}`}
                            type='button'
                            className={[
                                'vudoku-control',
                                value ? 'active' : '',
                                value,
                            ].filter(Boolean).join(' ')}
                            style={{
                                gridColumn: String(colIndex * 2 + 2),
                                gridRow: String(rowIndex * 2 + 2),
                            }}
                            title={`Coin Vudoku entre r${rowIndex + 1}c${colIndex + 1} et r${rowIndex + 2}c${colIndex + 2}`}
                            aria-label={`Coin Vudoku ${rowIndex + 1},${colIndex + 1}`}
                            disabled={readonly}
                            onClick={() => toggleVudokuCorner(rowIndex, colIndex)}
                        />
                    ))
                ))}
            </>
        );
    };

    const renderXvControls = (readonly = false): React.ReactNode => {
        if (!isXv) {
            return null;
        }

        return (
            <>
                {xvHorizontalMarks.map((row, rowIndex) => (
                    row.map((value, colIndex) => (
                        <button
                            key={`xv-h-${rowIndex}-${colIndex}`}
                            type='button'
                            className={[
                                'xv-control',
                                'horizontal',
                                value ? 'active' : '',
                            ].filter(Boolean).join(' ')}
                            style={{
                                gridColumn: String(colIndex * 2 + 2),
                                gridRow: String(rowIndex * 2 + 1),
                            }}
                            title={`Marque XV entre ${cellRef(rowIndex, colIndex)} et ${cellRef(rowIndex, colIndex + 1)}. Vide = somme differente de 5 et 10.`}
                            aria-label={`Marque XV entre ${cellRef(rowIndex, colIndex)} et ${cellRef(rowIndex, colIndex + 1)}`}
                            disabled={readonly}
                            onClick={() => toggleHorizontalXvMark(rowIndex, colIndex)}
                        >
                            {value}
                        </button>
                    ))
                ))}
                {xvVerticalMarks.map((row, rowIndex) => (
                    row.map((value, colIndex) => (
                        <button
                            key={`xv-v-${rowIndex}-${colIndex}`}
                            type='button'
                            className={[
                                'xv-control',
                                'vertical',
                                value ? 'active' : '',
                            ].filter(Boolean).join(' ')}
                            style={{
                                gridColumn: String(colIndex * 2 + 1),
                                gridRow: String(rowIndex * 2 + 2),
                            }}
                            title={`Marque XV entre ${cellRef(rowIndex, colIndex)} et ${cellRef(rowIndex + 1, colIndex)}. Vide = somme differente de 5 et 10.`}
                            aria-label={`Marque XV entre ${cellRef(rowIndex, colIndex)} et ${cellRef(rowIndex + 1, colIndex)}`}
                            disabled={readonly}
                            onClick={() => toggleVerticalXvMark(rowIndex, colIndex)}
                        >
                            {value}
                        </button>
                    ))
                ))}
                {Array.from({ length: SIZE - 1 }, (_row, rowIndex) => (
                    Array.from({ length: SIZE - 1 }, (_col, colIndex) => (
                        <span
                            key={`xv-corner-${rowIndex}-${colIndex}`}
                            className='xv-corner'
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

    const renderKropkiControls = (readonly = false): React.ReactNode => {
        if (!isKropki) {
            return null;
        }

        return (
            <>
                {kropkiHorizontalDots.map((row, rowIndex) => (
                    row.map((value, colIndex) => (
                        <button
                            key={`kropki-h-${rowIndex}-${colIndex}`}
                            type='button'
                            className={[
                                'kropki-control',
                                'horizontal',
                                value ? 'active' : '',
                                value,
                            ].filter(Boolean).join(' ')}
                            style={{
                                gridColumn: String(colIndex * 2 + 2),
                                gridRow: String(rowIndex * 2 + 1),
                            }}
                            title={`Rond Kropki entre ${cellRef(rowIndex, colIndex)} et ${cellRef(rowIndex, colIndex + 1)}. Vide = ni consecutif, ni double.`}
                            aria-label={`Rond Kropki entre ${cellRef(rowIndex, colIndex)} et ${cellRef(rowIndex, colIndex + 1)}`}
                            disabled={readonly}
                            onClick={() => toggleHorizontalKropkiDot(rowIndex, colIndex)}
                        />
                    ))
                ))}
                {kropkiVerticalDots.map((row, rowIndex) => (
                    row.map((value, colIndex) => (
                        <button
                            key={`kropki-v-${rowIndex}-${colIndex}`}
                            type='button'
                            className={[
                                'kropki-control',
                                'vertical',
                                value ? 'active' : '',
                                value,
                            ].filter(Boolean).join(' ')}
                            style={{
                                gridColumn: String(colIndex * 2 + 1),
                                gridRow: String(rowIndex * 2 + 2),
                            }}
                            title={`Rond Kropki entre ${cellRef(rowIndex, colIndex)} et ${cellRef(rowIndex + 1, colIndex)}. Vide = ni consecutif, ni double.`}
                            aria-label={`Rond Kropki entre ${cellRef(rowIndex, colIndex)} et ${cellRef(rowIndex + 1, colIndex)}`}
                            disabled={readonly}
                            onClick={() => toggleVerticalKropkiDot(rowIndex, colIndex)}
                        />
                    ))
                ))}
                {Array.from({ length: SIZE - 1 }, (_row, rowIndex) => (
                    Array.from({ length: SIZE - 1 }, (_col, colIndex) => (
                        <span
                            key={`kropki-corner-${rowIndex}-${colIndex}`}
                            className='kropki-corner'
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

    const renderRossiniControls = (readonly = false): React.ReactNode => {
        if (!isRossini) {
            return null;
        }

        const renderButton = (side: RossiniSide, index: number, style: React.CSSProperties) => {
            const value = rossiniArrows[side][index];
            const label = `${rossiniSideLabel(side)} ${index + 1}`;
            return (
                <button
                    key={`rossini-${side}-${index}`}
                    type='button'
                    className={[
                        'rossini-control',
                        side,
                        value ? 'active' : '',
                    ].filter(Boolean).join(' ')}
                    style={style}
                    title={`Fleche Rossini ${label}. Vide = pas de suite monotone.`}
                    aria-label={`Fleche Rossini ${label}`}
                    disabled={readonly}
                    onClick={() => toggleRossiniArrow(side, index)}
                >
                    {value}
                </button>
            );
        };

        return (
            <>
                {rossiniArrows.top.map((_value, index) => renderButton('top', index, {
                    gridColumn: String(index + 2),
                    gridRow: '1',
                }))}
                {rossiniArrows.bottom.map((_value, index) => renderButton('bottom', index, {
                    gridColumn: String(index + 2),
                    gridRow: '11',
                }))}
                {rossiniArrows.left.map((_value, index) => renderButton('left', index, {
                    gridColumn: '1',
                    gridRow: String(index + 2),
                }))}
                {rossiniArrows.right.map((_value, index) => renderButton('right', index, {
                    gridColumn: '11',
                    gridRow: String(index + 2),
                }))}
            </>
        );
    };

    const renderSkyscraperControls = (readonly = false): React.ReactNode => {
        if (!isSkyscraper) {
            return null;
        }

        const renderInput = (side: SkyscraperSide, index: number, style: React.CSSProperties) => {
            const value = skyscraperClues[side][index];
            const label = `${skyscraperSideLabel(side)} ${index + 1}`;
            return (
                <input
                    key={`skyscraper-${side}-${index}`}
                    className={[
                        'skyscraper-clue',
                        side,
                        value ? 'active' : '',
                    ].filter(Boolean).join(' ')}
                    style={style}
                    aria-label={`Indice Skyscraper ${label}`}
                    title={`Indice Skyscraper ${label}`}
                    value={value}
                    inputMode='numeric'
                    maxLength={1}
                    disabled={readonly}
                    onChange={event => updateSkyscraperClue(side, index, event.currentTarget.value)}
                />
            );
        };

        return (
            <>
                {skyscraperClues.top.map((_value, index) => renderInput('top', index, {
                    gridColumn: String(index + 2),
                    gridRow: '1',
                }))}
                {skyscraperClues.bottom.map((_value, index) => renderInput('bottom', index, {
                    gridColumn: String(index + 2),
                    gridRow: '11',
                }))}
                {skyscraperClues.left.map((_value, index) => renderInput('left', index, {
                    gridColumn: '1',
                    gridRow: String(index + 2),
                }))}
                {skyscraperClues.right.map((_value, index) => renderInput('right', index, {
                    gridColumn: '11',
                    gridRow: String(index + 2),
                }))}
            </>
        );
    };

    const renderFrameControls = (readonly = false): React.ReactNode => {
        if (!isFrame) {
            return null;
        }

        const renderInput = (side: SkyscraperSide, index: number, style: React.CSSProperties) => {
            const value = frameClues[side][index];
            const label = `${skyscraperSideLabel(side)} ${index + 1}`;
            return (
                <input
                    key={`frame-${side}-${index}`}
                    className={[
                        'frame-clue',
                        side,
                        value ? 'active' : '',
                    ].filter(Boolean).join(' ')}
                    style={style}
                    aria-label={`Somme Frame ${label}`}
                    title={`Somme Frame ${label}`}
                    value={value}
                    inputMode='numeric'
                    maxLength={2}
                    disabled={readonly}
                    onChange={event => updateFrameClue(side, index, event.currentTarget.value)}
                />
            );
        };

        return (
            <>
                {frameClues.top.map((_value, index) => renderInput('top', index, {
                    gridColumn: String(index + 2),
                    gridRow: '1',
                }))}
                {frameClues.bottom.map((_value, index) => renderInput('bottom', index, {
                    gridColumn: String(index + 2),
                    gridRow: '11',
                }))}
                {frameClues.left.map((_value, index) => renderInput('left', index, {
                    gridColumn: '1',
                    gridRow: String(index + 2),
                }))}
                {frameClues.right.map((_value, index) => renderInput('right', index, {
                    gridColumn: '11',
                    gridRow: String(index + 2),
                }))}
            </>
        );
    };

    const renderOutsideControls = (readonly = false): React.ReactNode => {
        if (!isOutside) {
            return null;
        }

        const renderInput = (side: SkyscraperSide, index: number, style: React.CSSProperties) => {
            const value = outsideClues[side][index];
            const label = `${skyscraperSideLabel(side)} ${index + 1}`;
            return (
                <input
                    key={`outside-${side}-${index}`}
                    className={[
                        'outside-clue',
                        value ? 'active' : '',
                    ].filter(Boolean).join(' ')}
                    style={style}
                    aria-label={`Indice Outside ${label}`}
                    title={`Indice Outside ${label} - jusqu'a 3 chiffres`}
                    value={value}
                    disabled={readonly}
                    inputMode='numeric'
                    maxLength={3}
                    placeholder='123'
                    onChange={event => updateOutsideClue(side, index, event.currentTarget.value)}
                />
            );
        };

        return (
            <>
                {outsideClues.top.map((_value, index) => renderInput('top', index, {
                    gridColumn: String(index + 2),
                    gridRow: '1',
                }))}
                {outsideClues.bottom.map((_value, index) => renderInput('bottom', index, {
                    gridColumn: String(index + 2),
                    gridRow: String(SIZE + 2),
                }))}
                {outsideClues.left.map((_value, index) => renderInput('left', index, {
                    gridColumn: '1',
                    gridRow: String(index + 2),
                }))}
                {outsideClues.right.map((_value, index) => renderInput('right', index, {
                    gridColumn: String(SIZE + 2),
                    gridRow: String(index + 2),
                }))}
            </>
        );
    };

    const renderSandwichControls = (readonly = false): React.ReactNode => {
        if (!isSandwich) {
            return null;
        }

        const renderInput = (side: SkyscraperSide, index: number, style: React.CSSProperties) => {
            const value = sandwichClues[side][index];
            const label = `${skyscraperSideLabel(side)} ${index + 1}`;
            return (
                <input
                    key={`sandwich-${side}-${index}`}
                    className={[
                        'sandwich-clue',
                        value !== '' ? 'active' : '',
                    ].filter(Boolean).join(' ')}
                    style={style}
                    aria-label={`Somme Sandwich ${label}`}
                    title={`Somme Sandwich ${label} - somme entre 1 et 9`}
                    value={value}
                    disabled={readonly}
                    inputMode='numeric'
                    maxLength={2}
                    placeholder='0'
                    onChange={event => updateSandwichClue(side, index, event.currentTarget.value)}
                />
            );
        };

        return (
            <>
                {sandwichClues.top.map((_value, index) => renderInput('top', index, {
                    gridColumn: String(index + 2),
                    gridRow: '1',
                }))}
                {sandwichClues.left.map((_value, index) => renderInput('left', index, {
                    gridColumn: '1',
                    gridRow: String(index + 2),
                }))}
            </>
        );
    };

    const renderLittleKillerControls = (readonly = false): React.ReactNode => {
        if (!isLittleKiller) {
            return null;
        }

        const renderClue = (side: SkyscraperSide, index: number, style: React.CSSProperties) => {
            const clue = littleKillerClues[side][index];
            const label = `${skyscraperSideLabel(side)} ${index + 1}`;
            return (
                <div
                    key={`little-killer-${side}-${index}`}
                    className={['little-killer-clue', side, clue.direction, clue.total ? 'active' : ''].filter(Boolean).join(' ')}
                    style={style}
                >
                    <button
                        type='button'
                        className='little-killer-direction'
                        aria-label={`Direction Little Killer ${label}`}
                        title={`Direction Little Killer ${label}`}
                        disabled={readonly}
                        onClick={() => toggleLittleKillerDirection(side, index)}
                    >
                        {littleKillerArrow(clue.direction)}
                    </button>
                    <input
                        aria-label={`Somme Little Killer ${label}`}
                        title={`Somme Little Killer ${label}`}
                        value={clue.total}
                        disabled={readonly}
                        inputMode='numeric'
                        maxLength={2}
                        onChange={event => updateLittleKillerTotal(side, index, event.currentTarget.value)}
                    />
                </div>
            );
        };

        return (
            <>
                {littleKillerClues.top.map((_value, index) => renderClue('top', index, {
                    gridColumn: String(index + 2),
                    gridRow: '1',
                }))}
                {littleKillerClues.bottom.map((_value, index) => renderClue('bottom', index, {
                    gridColumn: String(index + 2),
                    gridRow: String(SIZE + 2),
                }))}
                {littleKillerClues.left.map((_value, index) => renderClue('left', index, {
                    gridColumn: '1',
                    gridRow: String(index + 2),
                }))}
                {littleKillerClues.right.map((_value, index) => renderClue('right', index, {
                    gridColumn: String(SIZE + 2),
                    gridRow: String(index + 2),
                }))}
            </>
        );
    };

    const renderTripodDotControls = (readonly = false): React.ReactNode => {
        if (!isTripod) {
            return null;
        }

        return (
            <>
                {tripodDots.map((row, rowIndex) => (
                    row.map((active, colIndex) => (
                        <button
                            key={`tripod-dot-${rowIndex}-${colIndex}`}
                            type='button'
                            className={['tripod-dot-control', active ? 'active' : ''].filter(Boolean).join(' ')}
                            style={{
                                left: `${colIndex * 44}px`,
                                top: `${rowIndex * 44}px`,
                            }}
                            aria-label={`Point Tripod r${rowIndex + 1}c${colIndex + 1}`}
                            title='Point Tripod'
                            disabled={readonly}
                            onClick={() => toggleTripodDot(rowIndex, colIndex)}
                        />
                    ))
                ))}
            </>
        );
    };

    const renderChainConnectors = (): React.ReactNode => {
        if (!isChain || !chainConfig) {
            return null;
        }
        const gap = 4;
        const connectors: React.ReactNode[] = [];
        chainPaths.slice(0, chainConfig.size).forEach((path, chainIndex) => {
            const chain = chainIndex + 1;
            for (let index = 0; index < path.length - 1; index += 1) {
                const [startRow, startCol] = path[index];
                const [endRow, endCol] = path[index + 1];
                if (
                    startRow < 0 || startRow >= chainConfig.size
                    || startCol < 0 || startCol >= chainConfig.size
                    || endRow < 0 || endRow >= chainConfig.size
                    || endCol < 0 || endCol >= chainConfig.size
                ) {
                    continue;
                }
                const startX = startCol * (sizedCellSize + gap) + (sizedCellSize / 2);
                const startY = startRow * (sizedCellSize + gap) + (sizedCellSize / 2);
                const endX = endCol * (sizedCellSize + gap) + (sizedCellSize / 2);
                const endY = endRow * (sizedCellSize + gap) + (sizedCellSize / 2);
                const dx = endX - startX;
                const dy = endY - startY;
                connectors.push(
                    <span
                        key={`chain-path-${chain}-${index}-${startRow}-${startCol}-${endRow}-${endCol}`}
                        className={['chain-connector', 'path', `chain-${chain}`].join(' ')}
                        style={{
                            left: startX,
                            top: startY - 3,
                            width: Math.sqrt((dx * dx) + (dy * dy)),
                            transform: `rotate(${Math.atan2(dy, dx)}rad)`,
                        }}
                    />
                );
            }
        });
        return connectors;
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
                    {isEvenOdd ? (
                        <button className={mode === 'parity' ? 'active' : ''} onClick={() => setMode('parity')}>
                            Parite
                        </button>
                    ) : null}
                    {isChain ? (
                        <button className={mode === 'chain' ? 'active' : ''} onClick={() => setMode('chain')}>
                            Chaines
                        </button>
                    ) : null}
                    <select
                        className='grid-puzzle-variant-select'
                        value={puzzleType}
                        onChange={event => handlePuzzleTypeChange(event.currentTarget.value)}
                    >
                        <option value='sudoku_classic'>Classique</option>
                        <option value='sudoku_4x4'>Classique 4x4</option>
                        <option value='sudoku_6x6'>Classique 6x6</option>
                        <option value='sudoku_8x8'>Classique 8x8</option>
                        <option value='sudoku_10x10'>Classique 10x10</option>
                        <option value='sudoku_12x12'>Classique 12x12</option>
                        <option value='sudoku_15x15'>Classique 15x15</option>
                        <option value='sudoku_16x16'>Classique 16x16</option>
                        <option value='sudoku_x'>Sudoku X</option>
                        <option value='sudoku_argyle'>Argyle</option>
                        <option value='sudoku_anti_diagonal'>Anti Diagonal</option>
                        <option value='sudoku_center_dot'>Center Dot</option>
                        <option value='sudoku_windoku'>Windoku</option>
                        <option value='sudoku_girandola'>Girandola</option>
                        <option value='sudoku_asterisk'>Asterisk</option>
                        <option value='sujiken'>Sujiken</option>
                        <option value='sudoku_hoshi'>Hoshi</option>
                        <option value='samurai_sudoku'>Samurai Sudoku</option>
                        <option value='flower_sudoku'>Flower Sudoku</option>
                        <option value='sohei_sudoku'>Sohei Sudoku</option>
                        <option value='kazaguruma_sudoku'>Kazaguruma</option>
                        <option value='sudoku_greater_than'>Greater Than</option>
                        <option value='sudoku_vudoku'>Vudoku</option>
                        <option value='sudoku_rossini'>Rossini</option>
                        <option value='sudoku_xv'>Sudoku XV</option>
                        <option value='sudoku_kropki'>Kropki</option>
                        <option value='chain_sudoku_4x4'>Chain / Strimko 4x4</option>
                        <option value='chain_sudoku_5x5'>Chain / Strimko 5x5</option>
                        <option value='chain_sudoku_6x6'>Chain / Strimko 6x6</option>
                        <option value='chain_sudoku_7x7'>Chain / Strimko 7x7</option>
                        <option value='chain_sudoku_8x8'>Chain / Strimko 8x8</option>
                        <option value='chain_sudoku_9x9'>Chain / Strimko 9x9</option>
                        <option value='sudoku_skyscraper'>Skyscraper</option>
                        <option value='sudoku_frame'>Frame</option>
                        <option value='sudoku_outside'>Outside</option>
                        <option value='sudoku_sandwich'>Sandwich</option>
                        <option value='sudoku_little_killer'>Little Killer</option>
                        <option value='sudoku_little_unique_killer'>Little Unique Killer</option>
                        <option value='sudoku_godoku'>Godoku</option>
                        <option value='sudoku_even_odd'>Even-Odd</option>
                        <option value='sudoku_non_consecutive'>Non-Consecutive</option>
                        <option value='sudoku_mine'>Sudoku Mine 9x9</option>
                        <option value='sudoku_mine_6x6'>Sudoku Mine 6x6</option>
                        <option value='sudoku_tripod_4x4'>Tripod 4x4</option>
                        <option value='sudoku_tripod_5x5'>Tripod 5x5</option>
                        <option value='sudoku_tripod_6x6'>Tripod 6x6</option>
                        <option value='sudoku_tripod_7x7'>Tripod 7x7</option>
                        <option value='sudoku_tripod_8x8'>Tripod 8x8</option>
                        <option value='nonogram'>Nonogram / Picross</option>
                        <option value='kakuro'>Kakuro / Cross Sums</option>
                        <option value='hitori'>Hitori</option>
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
                    {isNonogram ? (
                        <div className='nonogram-editor'>
                            <div
                                className='nonogram-board nonogram-editor-board'
                                style={nonogramEditorStyle}
                                aria-label='Grille Nonogram interactive'
                            >
                                <div className='nonogram-corner'>
                                    <label>
                                        Lignes
                                        <input
                                            type='number'
                                            min={1}
                                            max={50}
                                            value={nonogramRows}
                                            aria-label='Nombre de lignes Nonogram'
                                            title='Nombre de lignes Nonogram'
                                            onFocus={event => event.currentTarget.select()}
                                            onChange={event => setNonogramDimension('row', Number(event.currentTarget.value))}
                                        />
                                    </label>
                                    <span aria-hidden='true'>x</span>
                                    <label>
                                        Colonnes
                                        <input
                                            type='number'
                                            min={1}
                                            max={50}
                                            value={nonogramCols}
                                            aria-label='Nombre de colonnes Nonogram'
                                            title='Nombre de colonnes Nonogram'
                                            onFocus={event => event.currentTarget.select()}
                                            onChange={event => setNonogramDimension('column', Number(event.currentTarget.value))}
                                        />
                                    </label>
                                </div>
                                {nonogramColumnClueLines.map((value, colIndex) => {
                                    const inputValue = nonogramClueDrafts[`column:${colIndex}`] ?? nonogramColumnClueEditorValue(value);
                                    const validationError = nonogramClueValidationError(inputValue, nonogramRows);
                                    return (
                                        <textarea
                                            key={`nonogram-column-${colIndex}`}
                                            className={`nonogram-clue-input column${validationError ? ' invalid' : ''}`}
                                            style={{ gridColumn: String(colIndex + 2), gridRow: '1' }}
                                            value={inputValue}
                                            placeholder={'1\n2'}
                                            rows={nonogramMaxColumnClues}
                                            aria-label={`Indice colonne ${colIndex + 1}`}
                                            aria-invalid={Boolean(validationError)}
                                            title={validationError || `Indice colonne ${colIndex + 1}`}
                                            onFocus={event => {
                                                if (event.currentTarget.value === '0') {
                                                    event.currentTarget.select();
                                                }
                                            }}
                                            onChange={event => updateNonogramClueDraft('column', colIndex, event.currentTarget.value)}
                                            onBlur={() => commitNonogramClueDraft('column', colIndex)}
                                        />
                                    );
                                })}
                                {nonogramRowClueLines.map((value, rowIndex) => {
                                    const inputValue = nonogramClueDrafts[`row:${rowIndex}`] ?? value;
                                    const validationError = nonogramClueValidationError(inputValue, nonogramCols);
                                    return (
                                        <textarea
                                            key={`nonogram-row-${rowIndex}`}
                                            className={`nonogram-clue-input row${validationError ? ' invalid' : ''}`}
                                            style={{ gridColumn: '1', gridRow: String(rowIndex + 2) }}
                                            value={inputValue}
                                            placeholder='1 2'
                                            rows={2}
                                            aria-label={`Indice ligne ${rowIndex + 1}`}
                                            aria-invalid={Boolean(validationError)}
                                            title={validationError || `Indice ligne ${rowIndex + 1}`}
                                            onFocus={event => {
                                                if (event.currentTarget.value === '0') {
                                                    event.currentTarget.select();
                                                }
                                            }}
                                            onChange={event => updateNonogramClueDraft('row', rowIndex, event.currentTarget.value)}
                                            onBlur={() => commitNonogramClueDraft('row', rowIndex)}
                                        />
                                    );
                                })}
                                {Array.from({ length: nonogramRows }, (_row, rowIndex) => (
                                    Array.from({ length: nonogramCols }, (_col, colIndex) => {
                                        const value = grid[rowIndex]?.[colIndex] || '';
                                        const ref = cellRef(rowIndex, colIndex);
                                        const stateLabel = value === '#'
                                            ? 'noircie'
                                            : value === '.'
                                                ? 'blanche'
                                                : 'inconnue';
                                        return (
                                            <button
                                                key={`nonogram-cell-${ref}`}
                                                type='button'
                                                className={[
                                                    'nonogram-manual-cell',
                                                    value === '#' ? 'filled' : '',
                                                    value === '.' ? 'empty' : '',
                                                    !value ? 'unknown' : '',
                                                    watchCells.includes(ref) ? 'watched' : '',
                                                ].filter(Boolean).join(' ')}
                                                style={{ gridColumn: String(colIndex + 2), gridRow: String(rowIndex + 2) }}
                                                ref={element => {
                                                    nonogramCellRefs.current[rowIndex] = nonogramCellRefs.current[rowIndex] || [];
                                                    nonogramCellRefs.current[rowIndex][colIndex] = element;
                                                }}
                                                aria-label={`${ref}, ${stateLabel}`}
                                                aria-pressed={value === '#'}
                                                title={mode === 'watch'
                                                    ? `${ref}, ${stateLabel}. Cliquez pour surveiller cette case.`
                                                    : `${ref}, ${stateLabel}. Clic: noir, clic droit: etat precedent.`}
                                                onClick={event => handleNonogramCellClick(rowIndex, colIndex, event)}
                                                onContextMenu={event => handleNonogramCellContextMenu(rowIndex, colIndex, event)}
                                                onKeyDown={event => handleNonogramCellKeyDown(rowIndex, colIndex, event)}
                                            />
                                        );
                                    })
                                ))}
                            </div>
                            <div className='grid-puzzle-actions inline'>
                                <button type='button' onClick={clearNonogramMarks}>Effacer les marques</button>
                                <button type='button' onClick={clearGrid}>Reinitialiser</button>
                            </div>
                        </div>
                    ) : isKakuro ? (
                        <div className='kakuro-editor'>
                            <div className='kakuro-toolbar'>
                                <label>
                                    Lignes
                                    <input
                                        type='number'
                                        min={2}
                                        max={20}
                                        value={kakuroRows}
                                        aria-label='Nombre de lignes Kakuro'
                                        title='Nombre de lignes Kakuro'
                                        onFocus={event => event.currentTarget.select()}
                                        onChange={event => setKakuroDimension('row', Number(event.currentTarget.value))}
                                    />
                                </label>
                                <span aria-hidden='true'>x</span>
                                <label>
                                    Colonnes
                                    <input
                                        type='number'
                                        min={2}
                                        max={20}
                                        value={kakuroCols}
                                        aria-label='Nombre de colonnes Kakuro'
                                        title='Nombre de colonnes Kakuro'
                                        onFocus={event => event.currentTarget.select()}
                                        onChange={event => setKakuroDimension('column', Number(event.currentTarget.value))}
                                    />
                                </label>
                                <div className='kakuro-toolset' role='toolbar' aria-label='Outil Kakuro'>
                                    <button
                                        type='button'
                                        className={kakuroTool === 'white' ? 'active' : ''}
                                        onClick={() => setKakuroTool('white')}
                                    >
                                        Chiffre
                                    </button>
                                    <button
                                        type='button'
                                        className={kakuroTool === 'black' ? 'active' : ''}
                                        onClick={() => setKakuroTool('black')}
                                    >
                                        Noire
                                    </button>
                                    <button
                                        type='button'
                                        className={kakuroTool === 'clue' ? 'active' : ''}
                                        onClick={() => setKakuroTool('clue')}
                                    >
                                        Somme
                                    </button>
                                </div>
                            </div>
                            <div className='kakuro-board' style={kakuroBoardStyle} aria-label='Grille Kakuro interactive'>
                                {kakuroLayout.map((row, rowIndex) => row.map((cell, colIndex) => {
                                    const ref = cellRef(rowIndex, colIndex);
                                    if (cell.kind === 'black') {
                                        return (
                                            <button
                                                key={`kakuro-${ref}`}
                                                type='button'
                                                className='kakuro-cell black'
                                                aria-label={`${ref}, case noire`}
                                                title={kakuroTool === 'black' ? 'Case noire' : `Transformer en case ${kakuroTool === 'clue' ? 'somme' : 'blanche'}`}
                                                onClick={() => updateKakuroCellKind(rowIndex, colIndex, kakuroTool)}
                                            />
                                        );
                                    }
                                    if (cell.kind === 'clue') {
                                        const acrossError = kakuroClueError(cell.across, kakuroRunCells(kakuroLayout, rowIndex, colIndex, 'across'));
                                        const downError = kakuroClueError(cell.down, kakuroRunCells(kakuroLayout, rowIndex, colIndex, 'down'));
                                        return (
                                            <div
                                                key={`kakuro-${ref}`}
                                                className='kakuro-cell clue'
                                                role='button'
                                                tabIndex={0}
                                                aria-label={`${ref}, case somme`}
                                                title={kakuroTool === 'clue' ? 'Somme horizontale en haut a droite, verticale en bas a gauche' : `Transformer en case ${kakuroTool === 'black' ? 'noire' : 'blanche'}`}
                                                onClick={() => {
                                                    if (kakuroTool !== 'clue') {
                                                        updateKakuroCellKind(rowIndex, colIndex, kakuroTool);
                                                    }
                                                }}
                                                onKeyDown={event => {
                                                    if ((event.key === 'Enter' || event.key === ' ') && kakuroTool !== 'clue') {
                                                        event.preventDefault();
                                                        updateKakuroCellKind(rowIndex, colIndex, kakuroTool);
                                                    }
                                                }}
                                            >
                                                <input
                                                    className={`kakuro-clue-value across${acrossError ? ' invalid' : ''}`}
                                                    value={cell.across}
                                                    inputMode='numeric'
                                                    maxLength={2}
                                                    aria-label={`Somme horizontale ${ref}`}
                                                    aria-invalid={Boolean(acrossError)}
                                                    title={acrossError || 'Somme horizontale'}
                                                    onClick={event => event.stopPropagation()}
                                                    onChange={event => updateKakuroClue(rowIndex, colIndex, 'across', event.currentTarget.value)}
                                                />
                                                <input
                                                    className={`kakuro-clue-value down${downError ? ' invalid' : ''}`}
                                                    value={cell.down}
                                                    inputMode='numeric'
                                                    maxLength={2}
                                                    aria-label={`Somme verticale ${ref}`}
                                                    aria-invalid={Boolean(downError)}
                                                    title={downError || 'Somme verticale'}
                                                    onClick={event => event.stopPropagation()}
                                                    onChange={event => updateKakuroClue(rowIndex, colIndex, 'down', event.currentTarget.value)}
                                                />
                                            </div>
                                        );
                                    }
                                    return (
                                        <input
                                            key={`kakuro-${ref}`}
                                            className={`kakuro-cell white${watchCells.includes(ref) ? ' watched' : ''}${constraintConflicts.cells.has(ref) ? ' conflict' : ''}`}
                                            value={grid[rowIndex]?.[colIndex] || ''}
                                            inputMode='numeric'
                                            maxLength={1}
                                            aria-label={ref}
                                            title={mode === 'watch' ? `${ref}, cliquez pour surveiller cette case.` : ref}
                                            onPointerDown={event => {
                                                if (mode === 'watch') {
                                                    event.preventDefault();
                                                    return;
                                                }
                                                if (kakuroTool !== 'white') {
                                                    event.preventDefault();
                                                    updateKakuroCellKind(rowIndex, colIndex, kakuroTool);
                                                }
                                            }}
                                            onClick={event => {
                                                if (mode === 'watch' || event.ctrlKey || event.metaKey) {
                                                    event.preventDefault();
                                                    toggleWatchCell(ref);
                                                }
                                            }}
                                            onChange={event => updateKakuroValue(rowIndex, colIndex, event.currentTarget.value)}
                                        />
                                    );
                                }))}
                            </div>
                            <div className='grid-puzzle-actions inline'>
                                <button type='button' onClick={clearKakuroValues}>Effacer les chiffres</button>
                                <button type='button' onClick={resetKakuroLayout}>Gabarit vierge</button>
                            </div>
                            {visibleConflictMessages.length > 0 ? (
                                <div className='grid-puzzle-conflicts'>
                                    {visibleConflictMessages.map(message => (
                                        <div key={message}>{message}</div>
                                    ))}
                                    {constraintConflicts.messages.length > visibleConflictMessages.length ? (
                                        <div>+{constraintConflicts.messages.length - visibleConflictMessages.length} autre(s) conflit(s).</div>
                                    ) : null}
                                </div>
                            ) : null}
                            {solvedGrid ? (
                                <div className='grid-puzzle-solution'>
                                    <div className='grid-puzzle-section-title'>
                                        <strong>
                                            Solution {solutionResults.length > 1 ? `${activeSolutionIndex + 1}/${solutionResults.length}` : ''}
                                        </strong>
                                        <div className='solution-actions'>
                                            {solutionResults.length > 1 ? (
                                                <select
                                                    value={activeSolutionIndex}
                                                    onChange={event => setSelectedSolutionIndex(Number(event.currentTarget.value) || 0)}
                                                    aria-label='Solution affichee'
                                                >
                                                    {solutionResults.map((_solution, index) => (
                                                        <option key={`solution-option-${index}`} value={index}>
                                                            Solution {index + 1}
                                                        </option>
                                                    ))}
                                                </select>
                                            ) : null}
                                            <button onClick={useSolvedGrid}>Reprendre dans la grille</button>
                                        </div>
                                    </div>
                                    <div className='kakuro-board solved' style={kakuroBoardStyle} aria-label='Solution Kakuro'>
                                        {kakuroLayout.map((row, rowIndex) => row.map((cell, colIndex) => (
                                            cell.kind === 'black' ? (
                                                <div key={`solved-kakuro-${rowIndex}-${colIndex}`} className='kakuro-cell black' />
                                            ) : cell.kind === 'clue' ? (
                                                <div key={`solved-kakuro-${rowIndex}-${colIndex}`} className='kakuro-cell clue'>
                                                    <span className='kakuro-clue-display across'>{cell.across}</span>
                                                    <span className='kakuro-clue-display down'>{cell.down}</span>
                                                </div>
                                            ) : (
                                                <div key={`solved-kakuro-${rowIndex}-${colIndex}`} className='kakuro-cell white'>
                                                    {solvedGrid[rowIndex]?.[colIndex] || ''}
                                                </div>
                                            )
                                        )))}
                                    </div>
                                </div>
                            ) : null}
                        </div>
                    ) : isHitori ? (
                        <div className='hitori-editor'>
                            <div className='hitori-toolbar'>
                                <label>
                                    Lignes
                                    <input
                                        type='number'
                                        min={2}
                                        max={20}
                                        value={hitoriRows}
                                        aria-label='Nombre de lignes Hitori'
                                        title='Nombre de lignes Hitori'
                                        onFocus={event => event.currentTarget.select()}
                                        onChange={event => setHitoriDimension('row', Number(event.currentTarget.value))}
                                    />
                                </label>
                                <span aria-hidden='true'>x</span>
                                <label>
                                    Colonnes
                                    <input
                                        type='number'
                                        min={2}
                                        max={20}
                                        value={hitoriCols}
                                        aria-label='Nombre de colonnes Hitori'
                                        title='Nombre de colonnes Hitori'
                                        onFocus={event => event.currentTarget.select()}
                                        onChange={event => setHitoriDimension('column', Number(event.currentTarget.value))}
                                    />
                                </label>
                                <div className='hitori-toolset' role='toolbar' aria-label='Outil Hitori'>
                                    <button
                                        type='button'
                                        className={hitoriTool === 'numbers' ? 'active' : ''}
                                        onClick={() => setHitoriTool('numbers')}
                                    >
                                        Nombres
                                    </button>
                                    <button
                                        type='button'
                                        className={hitoriTool === 'shade' ? 'active' : ''}
                                        onClick={() => setHitoriTool('shade')}
                                    >
                                        Rayer
                                    </button>
                                </div>
                            </div>
                            <div className='hitori-board' style={hitoriBoardStyle} aria-label='Grille Hitori interactive'>
                                {Array.from({ length: hitoriRows }, (_row, rowIndex) => (
                                    Array.from({ length: hitoriCols }, (_col, colIndex) => {
                                        const ref = cellRef(rowIndex, colIndex);
                                        const isShaded = Boolean(hitoriShaded[rowIndex]?.[colIndex]);
                                        const className = [
                                            'hitori-cell',
                                            isShaded ? 'shaded' : '',
                                            watchCells.includes(ref) ? 'watched' : '',
                                            constraintConflicts.cells.has(ref) ? 'conflict' : '',
                                        ].filter(Boolean).join(' ');
                                        if (hitoriTool === 'numbers' && mode !== 'watch') {
                                            return (
                                                <input
                                                    key={`hitori-${ref}`}
                                                    className={className}
                                                    ref={element => {
                                                        hitoriCellRefs.current[rowIndex] = hitoriCellRefs.current[rowIndex] || [];
                                                        hitoriCellRefs.current[rowIndex][colIndex] = element;
                                                    }}
                                                    value={grid[rowIndex]?.[colIndex] || ''}
                                                    inputMode='numeric'
                                                    maxLength={2}
                                                    aria-label={ref}
                                                    title={ref}
                                                    onClick={event => {
                                                        if (event.ctrlKey || event.metaKey) {
                                                            event.preventDefault();
                                                            toggleWatchCell(ref);
                                                        }
                                                    }}
                                                    onKeyDown={event => handleHitoriCellKeyDown(rowIndex, colIndex, event)}
                                                    onChange={event => updateHitoriValue(rowIndex, colIndex, event.currentTarget.value)}
                                                />
                                            );
                                        }
                                        return (
                                            <button
                                                key={`hitori-${ref}`}
                                                type='button'
                                                className={className}
                                                ref={element => {
                                                    hitoriCellRefs.current[rowIndex] = hitoriCellRefs.current[rowIndex] || [];
                                                    hitoriCellRefs.current[rowIndex][colIndex] = element;
                                                }}
                                                aria-label={`${ref}${isShaded ? ', rayee' : ', blanche'}`}
                                                title={mode === 'watch' ? `${ref}, cliquez pour surveiller cette case.` : `${ref}, cliquez pour ${isShaded ? 'retirer le rayage' : 'rayer la case'}.`}
                                                onClick={event => {
                                                    if (mode === 'watch' || event.ctrlKey || event.metaKey) {
                                                        toggleWatchCell(ref);
                                                    } else {
                                                        toggleHitoriShade(rowIndex, colIndex);
                                                    }
                                                }}
                                                onKeyDown={event => handleHitoriCellKeyDown(rowIndex, colIndex, event)}
                                            >
                                                {grid[rowIndex]?.[colIndex] || ''}
                                            </button>
                                        );
                                    })
                                ))}
                            </div>
                            <div className='grid-puzzle-actions inline'>
                                <button type='button' onClick={clearHitoriShades}>Effacer les rayures</button>
                                <button type='button' onClick={clearHitori}>Reinitialiser</button>
                            </div>
                            {visibleConflictMessages.length > 0 ? (
                                <div className='grid-puzzle-conflicts'>
                                    {visibleConflictMessages.map(message => (
                                        <div key={message}>{message}</div>
                                    ))}
                                    {constraintConflicts.messages.length > visibleConflictMessages.length ? (
                                        <div>+{constraintConflicts.messages.length - visibleConflictMessages.length} autre(s) conflit(s).</div>
                                    ) : null}
                                </div>
                            ) : null}
                            {solvedGrid ? (
                                <div className='grid-puzzle-solution'>
                                    <div className='grid-puzzle-section-title'>
                                        <strong>
                                            Solution {solutionResults.length > 1 ? `${activeSolutionIndex + 1}/${solutionResults.length}` : ''}
                                        </strong>
                                        <div className='solution-actions'>
                                            {solutionResults.length > 1 ? (
                                                <select
                                                    value={activeSolutionIndex}
                                                    onChange={event => setSelectedSolutionIndex(Number(event.currentTarget.value) || 0)}
                                                    aria-label='Solution affichee'
                                                >
                                                    {solutionResults.map((_solution, index) => (
                                                        <option key={`solution-option-${index}`} value={index}>
                                                            Solution {index + 1}
                                                        </option>
                                                    ))}
                                                </select>
                                            ) : null}
                                            <button onClick={useSolvedGrid}>Reprendre dans la grille</button>
                                        </div>
                                    </div>
                                    <div className='hitori-board solved' style={hitoriBoardStyle} aria-label='Solution Hitori'>
                                        {Array.from({ length: hitoriRows }, (_row, rowIndex) => (
                                            Array.from({ length: hitoriCols }, (_col, colIndex) => {
                                                const isShaded = solvedGrid[rowIndex]?.[colIndex] === '#';
                                                return (
                                                    <div
                                                        key={`solved-hitori-${rowIndex}-${colIndex}`}
                                                        className={`hitori-cell${isShaded ? ' shaded' : ''}`}
                                                    >
                                                        {isShaded ? grid[rowIndex]?.[colIndex] || '' : solvedGrid[rowIndex]?.[colIndex] || ''}
                                                    </div>
                                                );
                                            })
                                        ))}
                                    </div>
                                </div>
                            ) : null}
                        </div>
                    ) : (
                        <>
                    <div
                        className={[
                            'sudoku-board',
                            isGreaterThan ? 'greater-than-board' : '',
                            isVudoku ? 'vudoku-board' : '',
                            isXv ? 'xv-board' : '',
                            isKropki ? 'kropki-board' : '',
                            isChain ? 'chain-board' : '',
                            isRossini ? 'rossini-board' : '',
                            isSkyscraper ? 'skyscraper-board' : '',
                            isFrame ? 'frame-board' : '',
                            isOutside ? 'outside-board' : '',
                            isSandwich ? 'sandwich-board' : '',
                            isLittleKiller ? 'little-killer-board' : '',
                            isTripod ? 'tripod-board' : '',
                            isHoshi ? 'hoshi-board' : '',
                            isSujiken ? 'sujiken-board' : '',
                            isSamurai ? 'samurai-board' : '',
                            isFlower ? 'flower-board' : '',
                            isSohei ? 'sohei-board' : '',
                            isKazaguruma ? 'kazaguruma-board' : '',
                        ].filter(Boolean).join(' ')}
                        style={boardStyle}
                        aria-label='Grille Sudoku interactive'
                    >
                        {renderChainConnectors()}
                        {grid.map((row, rowIndex) => (
                            row.map((value, colIndex) => {
                                if (!isActiveCellForVariant(puzzleType, rowIndex, colIndex)) {
                                    return null;
                                }
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
                                        title={isChain ? `${ref} - chaine ${chainGrid[rowIndex]?.[colIndex] || '?'}` : isEvenOdd && parityMarks[rowIndex]?.[colIndex] ? `Contrainte ${parityLabel(parityMarks[rowIndex][colIndex])}` : ref}
                                        value={value}
                                        placeholder={isChain && mode === 'chain' ? String(chainGrid[rowIndex]?.[colIndex] || '') : undefined}
                                        inputMode={isGodoku || (variableGridConfig?.size || 0) > SIZE ? 'text' : 'numeric'}
                                        maxLength={1}
                                        onClick={event => handleCellClick(rowIndex, colIndex, event)}
                                        onDoubleClick={event => handleCellDoubleClick(rowIndex, colIndex, event)}
                                        onKeyDown={event => handleCellKeyDown(rowIndex, colIndex, event)}
                                        onChange={event => updateCell(rowIndex, colIndex, event.currentTarget.value)}
                                    />
                                );
                            })
                        ))}
                        {renderInequalityControls()}
                        {renderVudokuControls()}
                        {renderXvControls()}
                        {renderKropkiControls()}
                        {renderRossiniControls()}
                        {renderSkyscraperControls()}
                        {renderFrameControls()}
                        {renderOutsideControls()}
                        {renderSandwichControls()}
                        {renderLittleKillerControls()}
                        {renderTripodDotControls()}
                    </div>

                    <div className='grid-puzzle-hint'>
                        En mode Surveiller, cliquez les cases a extraire pour la reponse. En mode Saisie, Ctrl+clic fonctionne aussi.
                        {isGreaterThan ? ' Cliquez les bords pour alterner entre >, < et vide.' : ''}
                        {isVudoku ? ' Cliquez les intersections pour poser un coin Vudoku. La case au sommet vaut la somme ou la difference des deux cases sur les cotes du V.' : ''}
                        {isRossini ? ' Cliquez les bords exterieurs pour poser les fleches Rossini. Un bord vide impose aussi que les trois premieres cases ne forment pas une suite.' : ''}
                        {isXv ? ' Cliquez les bords pour alterner entre X, V et vide. Un bord vide interdit les sommes 5 et 10.' : ''}
                        {isKropki ? ' Cliquez les bords pour alterner entre rond blanc, rond noir et vide. Un bord vide interdit les chiffres consecutifs et les rapports double/moitie.' : ''}
                        {isChain ? ` Aucune chaine n'est posee au depart. En mode Chaines, choisissez une couleur puis cliquez les ronds dans l'ordre de la chaine. Cliquez un rond colore pour l'effacer; chaque compteur doit finir a ${chainConfig?.size}/${chainConfig?.size}.` : ''}
                        {isSkyscraper ? ' Renseignez les indices exterieurs visibles depuis chaque cote de la grille.' : ''}
                        {isFrame ? ' Renseignez les sommes exterieures des trois cases les plus proches du bord.' : ''}
                        {isOutside ? ' Renseignez les chiffres exterieurs : ils doivent apparaitre dans les trois premieres cases vues depuis ce cote. Plusieurs chiffres peuvent partager un meme indice.' : ''}
                        {isSandwich ? ' Renseignez les sommes en haut et a gauche : chaque nombre est la somme des chiffres situes entre le 1 et le 9 de la colonne ou de la ligne.' : ''}
                        {isLittleKiller ? ` Renseignez les sommes Little Killer et cliquez la fleche pour choisir la diagonale visee.${isLittleUniqueKiller ? ' Les diagonales flechees ne peuvent pas contenir de doublon.' : ''}` : ''}
                        {isGodoku ? ' Saisissez les lettres directement dans la grille. L alphabet peut etre renseigne dans les options si la grille ne montre pas les 9 lettres.' : ''}
                        {sizedSudokuConfig || tripodConfig || chainConfig ? ` Symboles utilises : ${sudokuSymbolsForSize((sizedSudokuConfig || tripodConfig || chainConfig)!.size).join(' ')}.` : ''}
                        {puzzleType === 'sudoku_argyle' ? ' Les diagonales orange du motif Argyle ne peuvent pas contenir deux fois le meme chiffre.' : ''}
                        {isEvenOdd ? ' Double-cliquez une case pour alterner entre pair, impair et vide. En mode Parite, un simple clic suffit.' : ''}
                        {isNonConsecutive ? ' Les cases adjacentes horizontalement ou verticalement ne peuvent pas contenir deux chiffres consecutifs.' : ''}
                        {isMine ? ` Saisissez les indices 0-8. La solution place ${mineConfig?.minesPerUnit} mines par ligne, colonne et region ${mineConfig?.boxCols}x${mineConfig?.boxRows}.` : ''}
                        {isTripod ? ` Cliquez les intersections pour placer les points noirs Tripod (${tripodConfig?.size}x${tripodConfig?.size}). Le moteur reconstruit ensuite les regions.` : ''}
                        {puzzleType === 'sudoku_anti_diagonal' ? ' Anti Diagonal limite chaque grande diagonale a trois chiffres differents.' : ''}
                        {isSujiken ? ' Sujiken utilise les 45 cases du triangle.' : ''}
                        {isHoshi ? ' Hoshi utilise 54 cellules triangulaires reparties en six grands triangles. Les chiffres ne se repetent pas dans un grand triangle ni sur une ligne de l etoile.' : ''}
                        {isSamurai ? ' Samurai utilise les 369 cases actives des cinq grilles 9x9.' : ''}
                        {isFlower ? ' Flower utilise les 189 cases actives des cinq grilles 9x9.' : ''}
                        {isSohei ? ' Sohei utilise les 288 cases actives des quatre grilles 9x9.' : ''}
                        {isKazaguruma ? ' Kazaguruma utilise les 333 cases actives des cinq grilles 9x9 en moulin.' : ''}
                    </div>
                    {visibleConflictMessages.length > 0 ? (
                        <div className='grid-puzzle-conflicts'>
                            {visibleConflictMessages.map(message => (
                                <div key={message}>{message}</div>
                            ))}
                            {constraintConflicts.messages.length > visibleConflictMessages.length ? (
                                <div>+{constraintConflicts.messages.length - visibleConflictMessages.length} autre(s) conflit(s).</div>
                            ) : null}
                        </div>
                    ) : null}
                        </>
                    )}

                    {solvedGrid && !isKakuro && !isHitori && (
                        <div className='grid-puzzle-solution'>
                            <div className='grid-puzzle-section-title'>
                                <strong>
                                    Solution {solutionResults.length > 1 ? `${activeSolutionIndex + 1}/${solutionResults.length}` : ''}
                                </strong>
                                <div className='solution-actions'>
                                    {solutionResults.length > 1 ? (
                                        <select
                                            value={activeSolutionIndex}
                                            onChange={event => setSelectedSolutionIndex(Number(event.currentTarget.value) || 0)}
                                            aria-label='Solution affichee'
                                        >
                                            {solutionResults.map((_solution, index) => (
                                                <option key={`solution-option-${index}`} value={index}>
                                                    Solution {index + 1}
                                                </option>
                                            ))}
                                        </select>
                                    ) : null}
                                    {!isMine && !isNonogram ? <button onClick={useSolvedGrid}>Reprendre dans la grille</button> : null}
                                </div>
                            </div>
                            <div
                                className={[
                                    'sudoku-board',
                                    'solved',
                                    isNonogram ? 'nonogram-board' : '',
                                    isGreaterThan ? 'greater-than-board' : '',
                                    isVudoku ? 'vudoku-board' : '',
                                    isXv ? 'xv-board' : '',
                                    isKropki ? 'kropki-board' : '',
                                    isChain ? 'chain-board' : '',
                                    isRossini ? 'rossini-board' : '',
                                    isSkyscraper ? 'skyscraper-board' : '',
                                    isFrame ? 'frame-board' : '',
                                    isOutside ? 'outside-board' : '',
                                    isSandwich ? 'sandwich-board' : '',
                                    isLittleKiller ? 'little-killer-board' : '',
                                    isTripod ? 'tripod-board' : '',
                                    isHoshi ? 'hoshi-board' : '',
                                    isSujiken ? 'sujiken-board' : '',
                                    isSamurai ? 'samurai-board' : '',
                                    isFlower ? 'flower-board' : '',
                                    isSohei ? 'sohei-board' : '',
                                    isKazaguruma ? 'kazaguruma-board' : '',
                                ].filter(Boolean).join(' ')}
                                style={solutionBoardStyle}
                                aria-label={isNonogram ? 'Solution Nonogram' : 'Solution Sudoku'}
                            >
                                {!isNonogram ? renderChainConnectors() : null}
                                {solvedGrid.map((row, rowIndex) => (
                                    row.map((value, colIndex) => {
                                        if (!isNonogram && !isActiveCellForVariant(puzzleType, rowIndex, colIndex)) {
                                            return null;
                                        }
                                        const ref = cellRef(rowIndex, colIndex);
                                        const displayedValue = isNonogram
                                            ? ''
                                            : isMine
                                            ? value === 'M'
                                                ? 'M'
                                                : grid[rowIndex]?.[colIndex] || ''
                                            : value;
                                        return (
                                            <div
                                                key={`solved-${ref}`}
                                                className={cellClassName(
                                                    rowIndex,
                                                    colIndex,
                                                    isNonogram ? value : grid[rowIndex]?.[colIndex],
                                                    true,
                                                    [
                                                        ...tripodRegionBoundaryClasses(rowIndex, colIndex),
                                                        isMine && value === 'M' ? 'mine-solved' : '',
                                                        isNonogram ? 'nonogram-cell' : '',
                                                        isNonogram && value === '#' ? 'nonogram-filled' : '',
                                                        isNonogram && value !== '#' ? 'nonogram-empty' : '',
                                                    ],
                                                )}
                                                style={isNonogram ? undefined : cellStyle(rowIndex, colIndex)}
                                            >
                                                {displayedValue}
                                            </div>
                                        );
                                    })
                                ))}
                                {!isNonogram ? renderInequalityControls(true) : null}
                                {!isNonogram ? renderVudokuControls(true) : null}
                                {!isNonogram ? renderXvControls(true) : null}
                                {!isNonogram ? renderKropkiControls(true) : null}
                                {!isNonogram ? renderRossiniControls(true) : null}
                                {!isNonogram ? renderSkyscraperControls(true) : null}
                                {!isNonogram ? renderFrameControls(true) : null}
                                {!isNonogram ? renderOutsideControls(true) : null}
                                {!isNonogram ? renderSandwichControls(true) : null}
                                {!isNonogram ? renderLittleKillerControls(true) : null}
                                {!isNonogram ? renderTripodDotControls(true) : null}
                            </div>
                        </div>
                    )}
                </section>

                <aside className='grid-puzzle-side'>
                    {!isNonogram && !isKakuro && !isHitori ? (
                    <section>
                        <div className='grid-puzzle-section-title'>
                            <strong>Saisie rapide</strong>
                        </div>
                        <textarea
                            value={quickText}
                            onChange={event => handleQuickTextChange(event.currentTarget.value)}
                            placeholder={quickTextPlaceholder}
                            rows={isSamurai || isSohei || isKazaguruma ? 12 : 8}
                        />
                        <div className='grid-puzzle-actions inline'>
                            <button onClick={() => applyQuickText(quickText)}>Appliquer</button>
                            <button onClick={clearGrid}>Vider</button>
                        </div>
                    </section>
                    ) : null}

                    <section>
                        <strong>Options</strong>
                        {isGodoku ? (
                            <label>
                                Alphabet Godoku
                                <input
                                    type='text'
                                    maxLength={17}
                                    value={godokuAlphabet}
                                    placeholder='ORESNMBAU'
                                    onChange={event => {
                                        setGodokuAlphabet(normalizeGodokuAlphabet(event.currentTarget.value));
                                        setSolveState({ running: false });
                                        markDirty();
                                    }}
                                />
                            </label>
                        ) : null}
                        {isChain && chainConfig ? (
                            <div className='chain-tools'>
                                <span>Chaine active</span>
                                <div className='chain-palette'>
                                    {Array.from({ length: chainConfig.size }, (_unused, index) => {
                                        const chain = index + 1;
                                        return (
                                            <button
                                                key={`chain-palette-${chain}`}
                                                type='button'
                                                className={[
                                                    'chain-palette-button',
                                                    `chain-${chain}`,
                                                    activeChain === chain ? 'active' : '',
                                                    chainCounts[index] === chainConfig.size ? 'complete' : 'incomplete',
                                                ].filter(Boolean).join(' ')}
                                                title={`Chaine ${chain}: ${chainCounts[index]}/${chainConfig.size} ronds`}
                                                onClick={() => setActiveChain(chain)}
                                            >
                                                <span>{chain}</span>
                                                <small>{chainCounts[index] === chainConfig.size ? 'OK' : `${chainCounts[index]}/${chainConfig.size}`}</small>
                                            </button>
                                        );
                                    })}
                                </div>
                                <button
                                    type='button'
                                    onClick={clearActiveChain}
                                >
                                    Effacer la chaine active
                                </button>
                                <button
                                    type='button'
                                    onClick={() => {
                                        setChainGrid(emptyChainGrid(chainConfig.size));
                                        setChainPaths(emptyChainPaths(chainConfig.size));
                                        setActiveChain(1);
                                        setSolveState({ running: false });
                                        markDirty();
                                    }}
                                >
                                    Effacer les chaines
                                </button>
                            </div>
                        ) : null}
                        {isLittleKiller ? (
                            <div className='little-killer-direction-tools'>
                                <span>Directions Little Killer</span>
                                <div className='grid-puzzle-actions inline'>
                                    <button type='button' onClick={() => invertLittleKillerSideDirections('top')}>
                                        Inverser haut
                                    </button>
                                    <button type='button' onClick={() => invertLittleKillerSideDirections('bottom')}>
                                        Inverser bas
                                    </button>
                                    <button type='button' onClick={() => invertLittleKillerSideDirections('left')}>
                                        Inverser gauche
                                    </button>
                                    <button type='button' onClick={() => invertLittleKillerSideDirections('right')}>
                                        Inverser droite
                                    </button>
                                    <button type='button' onClick={() => invertLittleKillerSideDirections()}>
                                        Tout inverser
                                    </button>
                                </div>
                            </div>
                        ) : null}
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
                                min={isTripod ? 30000 : 1000}
                                max={120000}
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
