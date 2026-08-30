/**
 * Badge "Didn't find it" partagé par le tableau des géocaches et les blocs par cache.
 *
 * Extrait de `geocache-log-editor-widget.tsx` (découpage phase 1).
 */

import * as React from '@theia/core/shared/react';
import { LogTypeIcon } from '../geocache-log-type-icons';
import { DNF_ACCENT, DNF_ROW_BACKGROUND, DNF_TOOLTIP } from './constants';

/**
 * "Didn't find it" : l'icône Geocaching.com seule dans le tableau (l'espace y est compté),
 * doublée du texte "DNF" dans les blocs par cache, où le libellé reste lisible sans la couleur.
 */
export const DnfBadge: React.FC<{ compact?: boolean }> = ({ compact = false }) => {
    if (compact) {
        return <LogTypeIcon kind='dnf' size={15} title={DNF_TOOLTIP} />;
    }
    return (
        <span
            style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                padding: '2px 6px',
                borderRadius: 3,
                fontSize: 12,
                background: DNF_ROW_BACKGROUND,
                color: DNF_ACCENT,
                border: `1px solid ${DNF_ACCENT}`,
                fontWeight: 700,
                whiteSpace: 'nowrap'
            }}
            title={DNF_TOOLTIP}
        >
            <LogTypeIcon kind='dnf' size={14} title={DNF_TOOLTIP} />
            DNF
        </span>
    );
};
