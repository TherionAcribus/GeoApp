import * as React from '@theia/core/shared/react';
import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { MessageService } from '@theia/core/lib/common/message-service';
import { PluginsService, PluginResult } from '../common/plugin-protocol';
import type { GeocacheContext } from './plugin-executor-widget';

import './style/grid-puzzle-workbench.css';

type Grid = string[][];
type WorkMode = 'edit' | 'watch';
type SudokuVariant = 'sudoku_classic' | 'sudoku_x' | 'sudoku_center_dot' | 'sudoku_windoku' | 'sudoku_girandola' | 'sudoku_asterisk' | 'sujiken' | 'samurai_sudoku' | 'flower_sudoku' | 'sohei_sudoku' | 'kazaguruma_sudoku' | 'sudoku_greater_than';
type InequalitySymbol = '' | '>' | '<';
type InequalityGrid = InequalitySymbol[][];

const SIZE = 9;
const FLOWER_SIZE = 15;
const SAMURAI_SIZE = 21;
const KAZAGURUMA_COLS = 21;
const EMPTY_HORIZONTAL_INEQUALITIES: InequalityGrid = Array.from({ length: SIZE }, () => Array(SIZE - 1).fill(''));
const EMPTY_VERTICAL_INEQUALITIES: InequalityGrid = Array.from({ length: SIZE - 1 }, () => Array(SIZE).fill(''));
const QUICK_TEXT_PLACEHOLDER = '0'.repeat(SIZE).concat('\n').repeat(SIZE).trim();
const SUJIKEN_TEXT_PLACEHOLDER = Array.from({ length: SIZE }, (_row, index) => '0'.repeat(index + 1)).join('\n');
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
    if (puzzleType === 'sudoku_girandola') {
        return 'Girandola';
    }
    if (puzzleType === 'sudoku_asterisk') {
        return 'Asterisk';
    }
    if (puzzleType === 'sujiken') {
        return 'Sujiken';
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

function gridSizeForVariant(puzzleType: SudokuVariant): number {
    if (puzzleType === 'samurai_sudoku' || puzzleType === 'sohei_sudoku' || puzzleType === 'kazaguruma_sudoku') {
        return SAMURAI_SIZE;
    }
    if (puzzleType === 'flower_sudoku') {
        return FLOWER_SIZE;
    }
    return SIZE;
}

function isActiveCellForVariant(puzzleType: SudokuVariant, row: number, col: number): boolean {
    if (puzzleType === 'sujiken') {
        return isSujikenCell(row, col);
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
    return row >= 0 && row < SIZE && col >= 0 && col < SIZE;
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

function resizeGrid(grid: Grid, size: number): Grid {
    return Array.from({ length: size }, (_row, rowIndex) => (
        Array.from({ length: size }, (_col, colIndex) => grid[rowIndex]?.[colIndex] || '')
    ));
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

function gridToText(grid: Grid, puzzleType: SudokuVariant = 'sudoku_classic'): string {
    if (puzzleType === 'sujiken') {
        return Array.from({ length: SIZE }, (_row, rowIndex) => (
            Array.from({ length: rowIndex + 1 }, (_col, colIndex) => grid[rowIndex]?.[colIndex] || '0').join('')
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
    return parseGridText(text);
}

function normalizeGrid(value: unknown, puzzleType: SudokuVariant): Grid | undefined {
    if (typeof value === 'string') {
        return parsePuzzleText(value, puzzleType) || undefined;
    }

    const size = gridSizeForVariant(puzzleType);
    const requiredCols = puzzleType === 'kazaguruma_sudoku' ? KAZAGURUMA_COLS : size;
    if (!Array.isArray(value) || value.length !== size) {
        return undefined;
    }

    const normalized = value.map(row => {
        if (!Array.isArray(row) || row.length < requiredCols) {
            return undefined;
        }
        return Array.from({ length: size }, (_unused, index) => row[index]).map(cell => {
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
        Array.from({ length: SAMURAI_SIZE }, () => Array<HTMLInputElement | null>(SAMURAI_SIZE).fill(null))
    );

    const solvedGrid = extractGridFromResult(solveState.result);
    const watchedValues = (solveState.result as any)?.watched_values as Record<string, string> | undefined;
    const watchedText = String((solveState.result as any)?.watched_text || '');
    const geocacheId = context?.geocacheId;
    const variantLabel = getVariantLabel(puzzleType);
    const contextLabel = context ? `${context.gcCode} - ${context.name}` : 'Mode libre';
    const isGreaterThan = puzzleType === 'sudoku_greater_than';
    const isSujiken = puzzleType === 'sujiken';
    const isSamurai = puzzleType === 'samurai_sudoku';
    const isFlower = puzzleType === 'flower_sudoku';
    const isSohei = puzzleType === 'sohei_sudoku';
    const isKazaguruma = puzzleType === 'kazaguruma_sudoku';
    const gridSize = gridSizeForVariant(puzzleType);
    const quickTextPlaceholder = isSujiken
        ? SUJIKEN_TEXT_PLACEHOLDER
        : isFlower
            ? FLOWER_TEXT_PLACEHOLDER
        : isKazaguruma
            ? KAZAGURUMA_TEXT_PLACEHOLDER
        : isSohei
            ? SOHEI_TEXT_PLACEHOLDER
        : isSamurai
            ? SAMURAI_TEXT_PLACEHOLDER
            : QUICK_TEXT_PLACEHOLDER;

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
        setQuickText(gridToText(nextGrid, puzzleType));
    }, [puzzleType]);

    const focusCell = React.useCallback((row: number, col: number, move: [number, number] = [0, 0]) => {
        let nextRow = Math.max(0, Math.min(gridSize - 1, row));
        const maxCol = isSujiken ? nextRow : SIZE - 1;
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
        const restoredGrid = normalizeGrid(snapshot?.grid, puzzleType) || createEmptyGrid(gridSizeForVariant(puzzleType));
        const restoredResult = snapshot?.lastResult && typeof snapshot.lastResult === 'object'
            ? snapshot.lastResult as PluginResult
            : undefined;

        setGridAndQuickText(restoredGrid);
        setWatchCells(normalizeWatchCells(snapshot?.watchCells ?? snapshot?.watchedCells));
        setHorizontalInequalities(normalizeInequalityGrid(snapshot?.inequalities?.horizontal, SIZE, SIZE - 1));
        setVerticalInequalities(normalizeInequalityGrid(snapshot?.inequalities?.vertical, SIZE - 1, SIZE));
        setMaxSolutions(normalizeNumber(snapshot?.maxSolutions, 2, 1, 25));
        setTimeoutMs(normalizeNumber(snapshot?.solverTimeoutMs ?? snapshot?.timeoutMs, 10000, 1000, 120000));
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
        const parsed = parsePuzzleText(text, puzzleType);
        if (!parsed) {
            messageService.error(
                puzzleType === 'sujiken'
                    ? 'La saisie rapide Sujiken doit contenir 45 cases actives.'
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
    }, [markDirty, messageService, puzzleType, setGridAndQuickText]);

    const handleQuickTextChange = React.useCallback((text: string) => {
        setQuickText(text);
        const parsed = parsePuzzleText(text, puzzleType);
        if (parsed) {
            setGrid(parsed);
            setSolveState({ running: false });
        }
        markDirty();
    }, [markDirty, puzzleType]);

    const handlePuzzleTypeChange = React.useCallback((value: string) => {
        const nextPuzzleType = value === 'sudoku_x'
            || value === 'sudoku_center_dot'
            || value === 'sudoku_windoku'
            || value === 'sudoku_girandola'
            || value === 'sudoku_asterisk'
            || value === 'sujiken'
            || value === 'samurai_sudoku'
            || value === 'flower_sudoku'
            || value === 'sohei_sudoku'
            || value === 'kazaguruma_sudoku'
            || value === 'sudoku_greater_than'
            ? value
            : 'sudoku_classic';
        const nextGrid = resizeGrid(grid, gridSizeForVariant(nextPuzzleType));
        setGrid(nextGrid);
        setPuzzleType(nextPuzzleType);
        setQuickText(gridToText(nextGrid, nextPuzzleType));
        setSolveState({ running: false });
        markDirty();
    }, [grid, markDirty]);

    const clearGrid = React.useCallback(() => {
        setGridAndQuickText(createEmptyGrid(gridSizeForVariant(puzzleType)));
        setHorizontalInequalities(emptyHorizontalInequalities());
        setVerticalInequalities(emptyVerticalInequalities());
        setWatchCells([]);
        setSolveState({ running: false });
        markDirty();
    }, [markDirty, puzzleType, setGridAndQuickText]);

    const solve = React.useCallback(async () => {
        setSolveState({ running: true });
        try {
            const result = await pluginsService.executePlugin('grid_puzzle_solver', {
                puzzle_type: puzzleType,
                grid: gridToText(grid, puzzleType),
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
            : isSujiken
                ? {
                    gridColumn: String(colIndex + 1),
                    gridRow: String(rowIndex + 1),
                }
                : isSamurai
                    ? {
                        gridColumn: String(colIndex + 1),
                        gridRow: String(rowIndex + 1),
                    }
                    : isSohei
                        ? {
                            gridColumn: String(colIndex + 1),
                            gridRow: String(rowIndex + 1),
                        }
                    : isKazaguruma
                        ? {
                            gridColumn: String(colIndex + 1),
                            gridRow: String(rowIndex + 1),
                        }
                    : isFlower
                        ? {
                            gridColumn: String(colIndex + 1),
                            gridRow: String(rowIndex + 1),
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
            puzzleType === 'sudoku_girandola' && isGirandolaCell(rowIndex, colIndex) ? 'girandola' : '',
            puzzleType === 'sudoku_asterisk' && isAsteriskCell(rowIndex, colIndex) ? 'asterisk' : '',
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
            puzzleType !== 'samurai_sudoku' && puzzleType !== 'flower_sudoku' && puzzleType !== 'sohei_sudoku' && puzzleType !== 'kazaguruma_sudoku' && (colIndex === 2 || colIndex === 5) ? 'block-right' : '',
            puzzleType !== 'samurai_sudoku' && puzzleType !== 'flower_sudoku' && puzzleType !== 'sohei_sudoku' && puzzleType !== 'kazaguruma_sudoku' && (rowIndex === 2 || rowIndex === 5) ? 'block-bottom' : '',
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
                        <option value='sudoku_girandola'>Girandola</option>
                        <option value='sudoku_asterisk'>Asterisk</option>
                        <option value='sujiken'>Sujiken</option>
                        <option value='samurai_sudoku'>Samurai Sudoku</option>
                        <option value='flower_sudoku'>Flower Sudoku</option>
                        <option value='sohei_sudoku'>Sohei Sudoku</option>
                        <option value='kazaguruma_sudoku'>Kazaguruma</option>
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
                        className={[
                            'sudoku-board',
                            isGreaterThan ? 'greater-than-board' : '',
                            isSujiken ? 'sujiken-board' : '',
                            isSamurai ? 'samurai-board' : '',
                            isFlower ? 'flower-board' : '',
                            isSohei ? 'sohei-board' : '',
                            isKazaguruma ? 'kazaguruma-board' : '',
                        ].filter(Boolean).join(' ')}
                        aria-label='Grille Sudoku interactive'
                    >
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
                        {isSujiken ? ' Sujiken utilise les 45 cases du triangle.' : ''}
                        {isSamurai ? ' Samurai utilise les 369 cases actives des cinq grilles 9x9.' : ''}
                        {isFlower ? ' Flower utilise les 189 cases actives des cinq grilles 9x9.' : ''}
                        {isSohei ? ' Sohei utilise les 288 cases actives des quatre grilles 9x9.' : ''}
                        {isKazaguruma ? ' Kazaguruma utilise les 333 cases actives des cinq grilles 9x9 en moulin.' : ''}
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
                                    isSujiken ? 'sujiken-board' : '',
                                    isSamurai ? 'samurai-board' : '',
                                    isFlower ? 'flower-board' : '',
                                    isSohei ? 'sohei-board' : '',
                                    isKazaguruma ? 'kazaguruma-board' : '',
                                ].filter(Boolean).join(' ')}
                                aria-label='Solution Sudoku'
                            >
                                {solvedGrid.map((row, rowIndex) => (
                                    row.map((value, colIndex) => {
                                        if (!isActiveCellForVariant(puzzleType, rowIndex, colIndex)) {
                                            return null;
                                        }
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
                            placeholder={quickTextPlaceholder}
                            rows={isSamurai || isSohei || isKazaguruma ? 12 : 8}
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
