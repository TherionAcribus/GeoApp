/**
 * Compteur « texte final » sous une zone de saisie.
 *
 * Extrait de `geocache-log-editor-widget.tsx` (découpage phase 2). Composant pur :
 * les statistiques (texte brut vs patterns résolus) sont calculées par le widget,
 * qui les passe en props — la résolution des @patterns dépend de l'état global.
 */

import * as React from '@theia/core/shared/react';
import { GC_LOG_MAX_LENGTH } from './constants';
import { GeocacheListItem } from './types';

export interface FinalLengthStats {
    raw: number;
    min: number;
    max: number;
    worst?: GeocacheListItem;
}

export const CharCounter: React.FC<FinalLengthStats> = ({ raw, min, max, worst }) => {
    if (raw === 0 && max === 0) {
        return undefined;
    }

    const over = max > GC_LOG_MAX_LENGTH;
    const near = !over && max > GC_LOG_MAX_LENGTH * 0.9;
    const color = over
        ? 'var(--theia-errorForeground, #f85149)'
        : near
            ? 'var(--theia-editorWarning-foreground, #d29922)'
            : undefined;

    const count = min === max ? `${max}` : `${min}–${max}`;
    const hints: string[] = [];
    if (max !== raw) {
        hints.push(`${raw} saisis`);
    }
    if (over) {
        hints.push(`${max - GC_LOG_MAX_LENGTH} de trop`);
    }

    const tooltip = min === max
        ? undefined
        : `Les @patterns donnent un texte différent par géocache. La plus longue : ${worst?.gc_code ?? '?'} (${max} caractères).`;

    return (
        <div
            style={{
                marginTop: 4,
                fontSize: 11,
                textAlign: 'right',
                opacity: color ? 1 : 0.7,
                color,
                fontWeight: over ? 600 : 400,
            }}
            title={tooltip}
        >
            {over && '⚠️ '}
            Texte final : {count}/{GC_LOG_MAX_LENGTH} caractères
            {hints.length > 0 && ` (${hints.join(', ')})`}
        </div>
    );
};
