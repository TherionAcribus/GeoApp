import * as React from '@theia/core/shared/react';
import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { MessageService } from '@theia/core/lib/common/message-service';
import { PluginsService, PluginResult } from '../common/plugin-protocol';
import type { GeocacheContext } from './plugin-executor-widget';

import './style/grid-puzzle-workbench.css';

type Grid = string[][];
type RegionGrid = number[][];
type WorkMode = 'edit' | 'watch' | 'parity';
type SudokuVariant = 'sudoku_classic' | 'sudoku_4x4' | 'sudoku_6x6' | 'sudoku_8x8' | 'sudoku_10x10' | 'sudoku_12x12' | 'sudoku_15x15' | 'sudoku_16x16' | 'sudoku_x' | 'sudoku_argyle' | 'sudoku_anti_diagonal' | 'sudoku_center_dot' | 'sudoku_windoku' | 'sudoku_girandola' | 'sudoku_asterisk' | 'sujiken' | 'samurai_sudoku' | 'flower_sudoku' | 'sohei_sudoku' | 'kazaguruma_sudoku' | 'sudoku_greater_than' | 'sudoku_rossini' | 'sudoku_xv' | 'sudoku_skyscraper' | 'sudoku_frame' | 'sudoku_godoku' | 'sudoku_even_odd' | 'sudoku_non_consecutive' | 'sudoku_mine' | 'sudoku_mine_6x6' | 'sudoku_tripod' | 'sudoku_tripod_4x4' | 'sudoku_tripod_5x5' | 'sudoku_tripod_6x6' | 'sudoku_tripod_7x7' | 'sudoku_tripod_8x8';
type InequalitySymbol = '' | '>' | '<';
type InequalityGrid = InequalitySymbol[][];
type XvSymbol = '' | 'X' | 'V';
type XvGrid = XvSymbol[][];
type ParitySymbol = '' | 'even' | 'odd';
type ParityGrid = ParitySymbol[][];
type TripodDots = boolean[][];
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

const SIZE = 9;
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
const MINE_CONFIGS: Record<string, { size: number; boxRows: number; boxCols: number; minesPerUnit: number; label: string }> = {
    sudoku_mine: { size: 9, boxRows: 3, boxCols: 3, minesPerUnit: 3, label: 'Sudoku Mine 9x9' },
    sudoku_mine_6x6: { size: 6, boxRows: 2, boxCols: 3, minesPerUnit: 2, label: 'Sudoku Mine 6x6' },
};
const EMPTY_HORIZONTAL_INEQUALITIES: InequalityGrid = Array.from({ length: SIZE }, () => Array(SIZE - 1).fill(''));
const EMPTY_VERTICAL_INEQUALITIES: InequalityGrid = Array.from({ length: SIZE - 1 }, () => Array(SIZE).fill(''));
const EMPTY_XV_HORIZONTAL_MARKS: XvGrid = Array.from({ length: SIZE }, () => Array(SIZE - 1).fill(''));
const EMPTY_XV_VERTICAL_MARKS: XvGrid = Array.from({ length: SIZE - 1 }, () => Array(SIZE).fill(''));
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
const EMPTY_ROSSINI_ARROWS: RossiniArrows = {
    top: Array<RossiniArrow>(SIZE).fill(''),
    bottom: Array<RossiniArrow>(SIZE).fill(''),
    left: Array<RossiniArrow>(SIZE).fill(''),
    right: Array<RossiniArrow>(SIZE).fill(''),
};
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

function cloneInequalityGrid(grid: InequalityGrid): InequalityGrid {
    return grid.map(row => [...row]);
}

function cloneXvGrid(grid: XvGrid): XvGrid {
    return grid.map(row => [...row]);
}

function cloneParityGrid(grid: ParityGrid): ParityGrid {
    return grid.map(row => [...row]);
}

function cloneTripodDots(dots: TripodDots): TripodDots {
    return dots.map(row => [...row]);
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
    if (puzzleType === 'sudoku_rossini') {
        return 'Rossini';
    }
    if (puzzleType === 'sudoku_xv') {
        return 'Sudoku XV';
    }
    if (puzzleType === 'sudoku_skyscraper') {
        return 'Skyscraper';
    }
    if (puzzleType === 'sudoku_frame') {
        return 'Frame';
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

function getMineConfig(
    puzzleType: SudokuVariant,
): { size: number; boxRows: number; boxCols: number; minesPerUnit: number; label: string } | undefined {
    return MINE_CONFIGS[puzzleType];
}

function getSingleGridSudokuConfig(puzzleType: SudokuVariant): { size: number; boxRows: number; boxCols: number; label: string } | undefined {
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
    const tripodConfig = getTripodConfig(puzzleType);
    if (tripodConfig) {
        return tripodConfig.size;
    }
    const mineConfig = getMineConfig(puzzleType);
    if (mineConfig) {
        return mineConfig.size;
    }
    return getSingleGridSudokuConfig(puzzleType)?.size || SIZE;
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
    const tripodConfig = getTripodConfig(puzzleType);
    if (tripodConfig) {
        return row >= 0 && row < tripodConfig.size && col >= 0 && col < tripodConfig.size;
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

function buildCompositeSudokuRegions(offsets: Array<[number, number, string]>): ConstraintRegion[] {
    return offsets.flatMap(([row, col, label]) => buildSudokuRegions(row, col, label));
}

function getAllDifferentRegions(puzzleType: SudokuVariant): ConstraintRegion[] {
    const tripodConfig = getTripodConfig(puzzleType);
    if (getMineConfig(puzzleType)) {
        return [];
    }
    const regions = puzzleType === 'sujiken'
        ? getSujikenRegions()
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
    rossiniArrows: RossiniArrows,
    xvHorizontalMarks: XvGrid,
    xvVerticalMarks: XvGrid,
    skyscraperClues: SkyscraperClues,
    frameClues: FrameClues,
    parityMarks: ParityGrid,
): ConflictHighlights {
    const cells = new Set<string>();
    const messages: string[] = [];

    for (const region of getAllDifferentRegions(puzzleType)) {
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

    if (puzzleType === 'sudoku_skyscraper') {
        addSkyscraperConflicts(grid, cells, messages, skyscraperClues);
    }

    if (puzzleType === 'sudoku_frame') {
        addFrameConflicts(grid, cells, messages, frameClues);
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

function emptyXvHorizontalMarks(): XvGrid {
    return cloneXvGrid(EMPTY_XV_HORIZONTAL_MARKS);
}

function emptyXvVerticalMarks(): XvGrid {
    return cloneXvGrid(EMPTY_XV_VERTICAL_MARKS);
}

function emptyParityMarks(): ParityGrid {
    return cloneParityGrid(EMPTY_PARITY_MARKS);
}

function emptyTripodDots(size = SIZE): TripodDots {
    return Array.from({ length: size + 1 }, () => Array(size + 1).fill(false));
}

function emptySkyscraperClues(): SkyscraperClues {
    return cloneSkyscraperClues(EMPTY_SKYSCRAPER_CLUES);
}

function emptyFrameClues(): FrameClues {
    return cloneFrameClues(EMPTY_FRAME_CLUES);
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

function normalizeCellValueForVariant(rawValue: string, puzzleType: SudokuVariant): string {
    if (getMineConfig(puzzleType)) {
        return rawValue.replace(/[^0-8]/g, '').slice(-1);
    }
    const symbolConfig = getSizedSudokuConfig(puzzleType) || getTripodConfig(puzzleType);
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

function gridToText(grid: Grid, puzzleType: SudokuVariant = 'sudoku_classic'): string {
    const mineConfig = getMineConfig(puzzleType);
    if (mineConfig) {
        return Array.from({ length: mineConfig.size }, (_row, rowIndex) => (
            Array.from({ length: mineConfig.size }, (_col, colIndex) => grid[rowIndex]?.[colIndex] || '.').join('')
        )).join('\n');
    }

    const symbolConfig = getSizedSudokuConfig(puzzleType) || getTripodConfig(puzzleType);
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
    const config = getSizedSudokuConfig(puzzleType) || getTripodConfig(puzzleType) || { size: SIZE };
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
    if (typeof value === 'string') {
        return parsePuzzleText(value, puzzleType) || undefined;
    }

    const size = gridSizeForVariant(puzzleType);
    const requiredCols = puzzleType === 'kazaguruma_sudoku' ? KAZAGURUMA_COLS : size;
    const symbolConfig = getSizedSudokuConfig(puzzleType) || getTripodConfig(puzzleType);
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
    const [xvHorizontalMarks, setXvHorizontalMarks] = React.useState<XvGrid>(() => emptyXvHorizontalMarks());
    const [xvVerticalMarks, setXvVerticalMarks] = React.useState<XvGrid>(() => emptyXvVerticalMarks());
    const [parityMarks, setParityMarks] = React.useState<ParityGrid>(() => emptyParityMarks());
    const [tripodDots, setTripodDots] = React.useState<TripodDots>(() => emptyTripodDots());
    const [skyscraperClues, setSkyscraperClues] = React.useState<SkyscraperClues>(() => emptySkyscraperClues());
    const [frameClues, setFrameClues] = React.useState<FrameClues>(() => emptyFrameClues());
    const [rossiniArrows, setRossiniArrows] = React.useState<RossiniArrows>(() => emptyRossiniArrows());
    const [godokuAlphabet, setGodokuAlphabet] = React.useState('');
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
    const isRossini = puzzleType === 'sudoku_rossini';
    const isXv = puzzleType === 'sudoku_xv';
    const isSkyscraper = puzzleType === 'sudoku_skyscraper';
    const isFrame = puzzleType === 'sudoku_frame';
    const isGodoku = puzzleType === 'sudoku_godoku';
    const isEvenOdd = puzzleType === 'sudoku_even_odd';
    const isNonConsecutive = puzzleType === 'sudoku_non_consecutive';
    const mineConfig = getMineConfig(puzzleType);
    const isMine = Boolean(mineConfig);
    const tripodConfig = getTripodConfig(puzzleType);
    const isTripod = Boolean(tripodConfig);
    const sizedSudokuConfig = getSizedSudokuConfig(puzzleType);
    const isSujiken = puzzleType === 'sujiken';
    const isSamurai = puzzleType === 'samurai_sudoku';
    const isFlower = puzzleType === 'flower_sudoku';
    const isSohei = puzzleType === 'sohei_sudoku';
    const isKazaguruma = puzzleType === 'kazaguruma_sudoku';
    const gridSize = gridSizeForVariant(puzzleType);
    const solvedRegionGrid = isTripod ? extractRegionGridFromSolution(activeSolution, gridSize) : undefined;
    const variableGridConfig = sizedSudokuConfig || tripodConfig || mineConfig;
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
    const quickTextPlaceholder = isSujiken
        ? SUJIKEN_TEXT_PLACEHOLDER
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
        () => findConstraintConflicts(grid, puzzleType, horizontalInequalities, verticalInequalities, rossiniArrows, xvHorizontalMarks, xvVerticalMarks, skyscraperClues, frameClues, parityMarks),
        [frameClues, grid, horizontalInequalities, parityMarks, puzzleType, rossiniArrows, skyscraperClues, verticalInequalities, xvHorizontalMarks, xvVerticalMarks],
    );
    const visibleConflictMessages = constraintConflicts.messages.slice(0, 4);

    React.useEffect(() => {
        if (isTripod && timeoutMs < 30000) {
            setTimeoutMs(30000);
        }
    }, [isTripod, timeoutMs]);

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
        const restoredGrid = normalizeGrid(snapshot?.grid, puzzleType) || createEmptyGrid(gridSizeForVariant(puzzleType));
        const restoredResult = snapshot?.lastResult && typeof snapshot.lastResult === 'object'
            ? snapshot.lastResult as PluginResult
            : undefined;

        setGridAndQuickText(restoredGrid);
        setWatchCells(normalizeWatchCells(snapshot?.watchCells ?? snapshot?.watchedCells));
        setHorizontalInequalities(normalizeInequalityGrid(snapshot?.inequalities?.horizontal, SIZE, SIZE - 1));
        setVerticalInequalities(normalizeInequalityGrid(snapshot?.inequalities?.vertical, SIZE - 1, SIZE));
        setXvHorizontalMarks(normalizeXvGrid(snapshot?.xv?.horizontal ?? snapshot?.xvMarks?.horizontal, SIZE, SIZE - 1));
        setXvVerticalMarks(normalizeXvGrid(snapshot?.xv?.vertical ?? snapshot?.xvMarks?.vertical, SIZE - 1, SIZE));
        setParityMarks(normalizeParityGrid(snapshot?.parity ?? snapshot?.parityMarks));
        setTripodDots(normalizeTripodDots(snapshot?.tripod ?? snapshot?.tripodDots, gridSizeForVariant(puzzleType)));
        setSkyscraperClues(normalizeSkyscraperClues(snapshot?.skyscraper ?? snapshot?.skyscraperClues));
        setFrameClues(normalizeFrameClues(snapshot?.frame ?? snapshot?.frameClues));
        setRossiniArrows(normalizeRossiniArrows(snapshot?.rossini ?? snapshot?.rossiniArrows));
        setGodokuAlphabet(normalizeGodokuAlphabet(snapshot?.godokuAlphabet ?? snapshot?.alphabet));
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
                    xv: {
                        horizontal: xvHorizontalMarks,
                        vertical: xvVerticalMarks,
                    },
                    parity: {
                        grid: parityMarks,
                    },
                    tripod: {
                        dots: tripodDots,
                    },
                    skyscraper: skyscraperClues,
                    frame: frameClues,
                    rossini: rossiniArrows,
                    godokuAlphabet,
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
        frameClues,
        geocacheId,
        godokuAlphabet,
        grid,
        horizontalInequalities,
        maxSolutions,
        messageService,
        parityMarks,
        pluginsService,
        puzzleType,
        quickText,
        rossiniArrows,
        skyscraperClues,
        solveState.result,
        timeoutMs,
        tripodDots,
        variantLabel,
        verticalInequalities,
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

    const handleCellClick = React.useCallback((row: number, col: number, event: React.MouseEvent) => {
        const ref = cellRef(row, col);
        if (isEvenOdd && mode === 'parity') {
            event.preventDefault();
            if (event.detail === 1) {
                toggleParityCell(row, col);
            }
            return;
        }
        if (mode === 'watch' || event.ctrlKey || event.metaKey) {
            event.preventDefault();
            toggleWatchCell(ref);
        }
    }, [isEvenOdd, mode, toggleParityCell, toggleWatchCell]);

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
                    : sizedSudokuConfig
                        ? `La saisie rapide ${sizedSudokuConfig.label} doit contenir exactement ${sizedSudokuConfig.size * sizedSudokuConfig.size} cases, avec symboles ${sudokuSymbolsForSize(sizedSudokuConfig.size).join('')} ou cases vides.`
                    : tripodConfig
                        ? `La saisie rapide ${tripodConfig.label} doit contenir exactement ${tripodConfig.size * tripodConfig.size} cases, avec symboles ${sudokuSymbolsForSize(tripodConfig.size).join('')} ou cases vides.`
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
    }, [markDirty, messageService, puzzleType, setGridAndQuickText, sizedSudokuConfig, tripodConfig, mineConfig]);

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
            || value === 'samurai_sudoku'
            || value === 'flower_sudoku'
            || value === 'sohei_sudoku'
            || value === 'kazaguruma_sudoku'
            || value === 'sudoku_greater_than'
            || value === 'sudoku_rossini'
            || value === 'sudoku_xv'
            || value === 'sudoku_skyscraper'
            || value === 'sudoku_frame'
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
            ? value
            : 'sudoku_classic';
        const nextGrid = resizeGrid(grid, gridSizeForVariant(nextPuzzleType));
        setGrid(nextGrid);
        setPuzzleType(nextPuzzleType);
        if (nextPuzzleType !== 'sudoku_even_odd' && mode === 'parity') {
            setMode('edit');
        }
        if (getTripodConfig(nextPuzzleType)) {
            setTripodDots(emptyTripodDots(gridSizeForVariant(nextPuzzleType)));
        }
        setQuickText(gridToText(nextGrid, nextPuzzleType));
        setSolveState({ running: false });
        markDirty();
    }, [grid, markDirty, mode]);

    const clearGrid = React.useCallback(() => {
        setGridAndQuickText(createEmptyGrid(gridSizeForVariant(puzzleType)));
        setHorizontalInequalities(emptyHorizontalInequalities());
        setVerticalInequalities(emptyVerticalInequalities());
        setXvHorizontalMarks(emptyXvHorizontalMarks());
        setXvVerticalMarks(emptyXvVerticalMarks());
        setParityMarks(emptyParityMarks());
        setTripodDots(emptyTripodDots(gridSizeForVariant(puzzleType)));
        setSkyscraperClues(emptySkyscraperClues());
        setFrameClues(emptyFrameClues());
        setRossiniArrows(emptyRossiniArrows());
        setWatchCells([]);
        setSolveState({ running: false });
        markDirty();
    }, [markDirty, puzzleType, setGridAndQuickText]);

    const solve = React.useCallback(async () => {
        if (constraintConflicts.messages.length > 0) {
            setSolveState({
                running: false,
                error: 'Corrigez les conflits en rouge avant de lancer la resolution.',
            });
            return;
        }
        setSelectedSolutionIndex(0);
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
                rossini: isRossini ? {
                    ...rossiniArrows,
                    enforce_absent: true,
                } : undefined,
                xv: isXv ? {
                    horizontal: xvHorizontalMarks,
                    vertical: xvVerticalMarks,
                    enforce_absent: true,
                } : undefined,
                skyscraper: isSkyscraper ? skyscraperClues : undefined,
                frame: isFrame ? frameClues : undefined,
                alphabet: isGodoku && godokuAlphabet ? godokuAlphabet : undefined,
                parity: isEvenOdd ? { grid: parityMarks } : undefined,
                tripod: isTripod ? { dots: tripodDots } : undefined,
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
    }, [constraintConflicts.messages.length, frameClues, geocacheId, godokuAlphabet, grid, horizontalInequalities, isEvenOdd, isFrame, isGodoku, isRossini, isSkyscraper, isTripod, isXv, maxSolutions, parityMarks, pluginsService, puzzleType, rossiniArrows, saveState, skyscraperClues, timeoutMs, tripodDots, verticalInequalities, watchCells, xvHorizontalMarks, xvVerticalMarks]);

    const useSolvedGrid = React.useCallback(() => {
        if (solvedGrid) {
            setGridAndQuickText(solvedGrid);
            setSolveState({ running: false });
            markDirty();
        }
    }, [markDirty, setGridAndQuickText, solvedGrid]);

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
        if (isGreaterThan || isXv) {
            return {
                gridColumn: String(colIndex * 2 + 1),
                gridRow: String(rowIndex * 2 + 1),
            };
        }
        if (isRossini || isSkyscraper || isFrame) {
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
        const blockConfig = isTripod ? undefined : mineConfig || getSingleGridSudokuConfig(puzzleType);
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
                        <option value='samurai_sudoku'>Samurai Sudoku</option>
                        <option value='flower_sudoku'>Flower Sudoku</option>
                        <option value='sohei_sudoku'>Sohei Sudoku</option>
                        <option value='kazaguruma_sudoku'>Kazaguruma</option>
                        <option value='sudoku_greater_than'>Greater Than</option>
                        <option value='sudoku_rossini'>Rossini</option>
                        <option value='sudoku_xv'>Sudoku XV</option>
                        <option value='sudoku_skyscraper'>Skyscraper</option>
                        <option value='sudoku_frame'>Frame</option>
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
                            isXv ? 'xv-board' : '',
                            isRossini ? 'rossini-board' : '',
                            isSkyscraper ? 'skyscraper-board' : '',
                            isFrame ? 'frame-board' : '',
                            isTripod ? 'tripod-board' : '',
                            isSujiken ? 'sujiken-board' : '',
                            isSamurai ? 'samurai-board' : '',
                            isFlower ? 'flower-board' : '',
                            isSohei ? 'sohei-board' : '',
                            isKazaguruma ? 'kazaguruma-board' : '',
                        ].filter(Boolean).join(' ')}
                        style={sizedBoardStyle}
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
                                        title={isEvenOdd && parityMarks[rowIndex]?.[colIndex] ? `Contrainte ${parityLabel(parityMarks[rowIndex][colIndex])}` : ref}
                                        value={value}
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
                        {renderXvControls()}
                        {renderRossiniControls()}
                        {renderSkyscraperControls()}
                        {renderFrameControls()}
                        {renderTripodDotControls()}
                    </div>

                    <div className='grid-puzzle-hint'>
                        En mode Surveiller, cliquez les cases a extraire pour la reponse. En mode Saisie, Ctrl+clic fonctionne aussi.
                        {isGreaterThan ? ' Cliquez les bords pour alterner entre >, < et vide.' : ''}
                        {isRossini ? ' Cliquez les bords exterieurs pour poser les fleches Rossini. Un bord vide impose aussi que les trois premieres cases ne forment pas une suite.' : ''}
                        {isXv ? ' Cliquez les bords pour alterner entre X, V et vide. Un bord vide interdit les sommes 5 et 10.' : ''}
                        {isSkyscraper ? ' Renseignez les indices exterieurs visibles depuis chaque cote de la grille.' : ''}
                        {isFrame ? ' Renseignez les sommes exterieures des trois cases les plus proches du bord.' : ''}
                        {isGodoku ? ' Saisissez les lettres directement dans la grille. L alphabet peut etre renseigne dans les options si la grille ne montre pas les 9 lettres.' : ''}
                        {sizedSudokuConfig || tripodConfig ? ` Symboles utilises : ${sudokuSymbolsForSize((sizedSudokuConfig || tripodConfig)!.size).join(' ')}.` : ''}
                        {puzzleType === 'sudoku_argyle' ? ' Les diagonales orange du motif Argyle ne peuvent pas contenir deux fois le meme chiffre.' : ''}
                        {isEvenOdd ? ' Double-cliquez une case pour alterner entre pair, impair et vide. En mode Parite, un simple clic suffit.' : ''}
                        {isNonConsecutive ? ' Les cases adjacentes horizontalement ou verticalement ne peuvent pas contenir deux chiffres consecutifs.' : ''}
                        {isMine ? ` Saisissez les indices 0-8. La solution place ${mineConfig?.minesPerUnit} mines par ligne, colonne et region ${mineConfig?.boxCols}x${mineConfig?.boxRows}.` : ''}
                        {isTripod ? ` Cliquez les intersections pour placer les points noirs Tripod (${tripodConfig?.size}x${tripodConfig?.size}). Le moteur reconstruit ensuite les regions.` : ''}
                        {puzzleType === 'sudoku_anti_diagonal' ? ' Anti Diagonal limite chaque grande diagonale a trois chiffres differents.' : ''}
                        {isSujiken ? ' Sujiken utilise les 45 cases du triangle.' : ''}
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

                    {solvedGrid && (
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
                                    {!isMine ? <button onClick={useSolvedGrid}>Reprendre dans la grille</button> : null}
                                </div>
                            </div>
                            <div
                                className={[
                                    'sudoku-board',
                                    'solved',
                                    isGreaterThan ? 'greater-than-board' : '',
                                    isXv ? 'xv-board' : '',
                                    isRossini ? 'rossini-board' : '',
                                    isSkyscraper ? 'skyscraper-board' : '',
                                    isFrame ? 'frame-board' : '',
                                    isTripod ? 'tripod-board' : '',
                                    isSujiken ? 'sujiken-board' : '',
                                    isSamurai ? 'samurai-board' : '',
                                    isFlower ? 'flower-board' : '',
                                    isSohei ? 'sohei-board' : '',
                                    isKazaguruma ? 'kazaguruma-board' : '',
                                ].filter(Boolean).join(' ')}
                                style={sizedBoardStyle}
                                aria-label='Solution Sudoku'
                            >
                                {solvedGrid.map((row, rowIndex) => (
                                    row.map((value, colIndex) => {
                                        if (!isActiveCellForVariant(puzzleType, rowIndex, colIndex)) {
                                            return null;
                                        }
                                        const ref = cellRef(rowIndex, colIndex);
                                        const displayedValue = isMine
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
                                                    grid[rowIndex][colIndex],
                                                    true,
                                                    [
                                                        ...tripodRegionBoundaryClasses(rowIndex, colIndex),
                                                        isMine && value === 'M' ? 'mine-solved' : '',
                                                    ],
                                                )}
                                                style={cellStyle(rowIndex, colIndex)}
                                            >
                                                {displayedValue}
                                            </div>
                                        );
                                    })
                                ))}
                                {renderInequalityControls(true)}
                                {renderXvControls(true)}
                                {renderRossiniControls(true)}
                                {renderSkyscraperControls(true)}
                                {renderFrameControls(true)}
                                {renderTripodDotControls(true)}
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
