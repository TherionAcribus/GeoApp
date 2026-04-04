/**
 * Composant de prévisualisation en temps réel de la formule
 * Affiche la substitution des variables avec codes couleur
 */

import * as React from '@theia/core/shared/react';
import { Formula, LetterValue } from '../../common/types';
import { CoordinatePreviewEngine } from '../preview/coordinate-preview-engine';
import type { AxisPreview } from '../preview/types';

interface FormulaPreviewProps {
    formula: Formula;
    values: Map<string, LetterValue>;
    onPartialCalculate?: (part: 'north' | 'east', result: string) => void;
}

const InnerFormulaPreviewComponent: React.FC<FormulaPreviewProps> = ({ formula, values, onPartialCalculate }) => {
    const engine = React.useMemo(() => new CoordinatePreviewEngine(), []);
    const preview = React.useMemo(() => engine.build({ north: formula.north, east: formula.east }, values), [engine, formula.north, formula.east, values]);

    const northPreview = preview.north;
    const eastPreview = preview.east;

    // Calculer automatiquement les parties complètes
    React.useEffect(() => {
        if (northPreview.status === 'valid' && onPartialCalculate) {
            onPartialCalculate('north', northPreview.display);
        }
    }, [northPreview.status, northPreview.display]);

    React.useEffect(() => {
        if (eastPreview.status === 'valid' && onPartialCalculate) {
            onPartialCalculate('east', eastPreview.display);
        }
    }, [eastPreview.status, eastPreview.display]);

    /**
     * Retourne la classe CSS selon le statut
     */
    const getStatusClass = (status: 'valid' | 'incomplete' | 'invalid'): string => {
        switch (status) {
            case 'valid': return 'theia-success';
            case 'incomplete': return 'theia-warn';
            case 'invalid': return 'theia-error';
        }
    };

    /**
     * Retourne l'icône selon le statut
     */
    const getStatusIcon = (status: 'valid' | 'incomplete' | 'invalid'): string => {
        switch (status) {
            case 'valid': return 'codicon codicon-check';
            case 'incomplete': return 'codicon codicon-circle-outline';
            case 'invalid': return 'codicon codicon-error';
        }
    };

    const renderSegmentsForAxis = (axisPreview: AxisPreview) => {
        const renderSegment = (label: string, value: string, title?: string) => (
            <div className="coordinate-fragment-chip fragment-chip-pending" title={title || label}>
                <span className="coordinate-fragment-label">{label}</span>
                <span className="coordinate-fragment-value">{value || '—'}</span>
            </div>
        );

        const suspects = (axisPreview.issues || [])
            .filter(i => i.level === 'error' || i.level === 'warn')
            .flatMap(i => i.suspectLetters || []);
        const suspectsText = suspects.length ? `Suspects: ${Array.from(new Set(suspects)).sort().join(', ')}` : undefined;

        return (
            <div className="coordinate-fragments">
                {renderSegment('Cardinal', axisPreview.cardinal, suspectsText)}
                {renderSegment('Degrés', axisPreview.degrees.displayText, buildSegmentTooltip(axisPreview, 'degrees'))}
                {renderSegment('Minutes', axisPreview.minutes.displayText, buildSegmentTooltip(axisPreview, 'minutes'))}
                {renderSegment('Décimales', axisPreview.decimals.displayText, buildSegmentTooltip(axisPreview, 'decimals'))}
            </div>
        );
    };

    return (
        <div className="formula-preview-container" style={{ marginBottom: '20px' }}>
            <h3 style={{ fontSize: '14px', fontWeight: 'bold', marginBottom: '10px' }}>
                📍 Prévisualisation en temps réel
            </h3>

            {/* Latitude / Nord */}
            <div className="formula-part" style={{ marginBottom: '12px' }}>
                <div style={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    gap: '8px',
                    marginBottom: '4px'
                }}>
                    <span className={getStatusIcon(northPreview.status)} />
                    <strong>Latitude :</strong>
                    <span className={getStatusClass(northPreview.status)}>
                        {northPreview.status === 'valid' ? '✓ Valide' : 
                         northPreview.status === 'incomplete' ? '○ Incomplète' : '✗ Invalide'}
                    </span>
                </div>
                <div style={{
                    padding: '8px',
                    backgroundColor: 'var(--theia-input-background)',
                    border: `1px solid ${
                        northPreview.status === 'valid' ? 'var(--theia-successText)' :
                        northPreview.status === 'incomplete' ? 'var(--theia-warningText)' :
                        'var(--theia-errorText)'
                    }`,
                    borderRadius: '4px',
                    fontFamily: 'monospace',
                    fontSize: '13px'
                }}>
                    {northPreview.display || formula.north}
                </div>
                <div style={{ 
                    fontSize: '11px', 
                    color: 'var(--theia-descriptionForeground)',
                    marginTop: '4px',
                    fontStyle: 'italic'
                }}>
                    {northPreview.message}
                </div>
                {renderSegmentsForAxis(northPreview)}
            </div>

            {/* Longitude / Est */}
            <div className="formula-part">
                <div style={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    gap: '8px',
                    marginBottom: '4px'
                }}>
                    <span className={getStatusIcon(eastPreview.status)} />
                    <strong>Longitude :</strong>
                    <span className={getStatusClass(eastPreview.status)}>
                        {eastPreview.status === 'valid' ? '✓ Valide' : 
                         eastPreview.status === 'incomplete' ? '○ Incomplète' : '✗ Invalide'}
                    </span>
                </div>
                <div style={{
                    padding: '8px',
                    backgroundColor: 'var(--theia-input-background)',
                    border: `1px solid ${
                        eastPreview.status === 'valid' ? 'var(--theia-successText)' :
                        eastPreview.status === 'incomplete' ? 'var(--theia-warningText)' :
                        'var(--theia-errorText)'
                    }`,
                    borderRadius: '4px',
                    fontFamily: 'monospace',
                    fontSize: '13px'
                }}>
                    {eastPreview.display || formula.east}
                </div>
                <div style={{ 
                    fontSize: '11px', 
                    color: 'var(--theia-descriptionForeground)',
                    marginTop: '4px',
                    fontStyle: 'italic'
                }}>
                    {eastPreview.message}
                </div>
                {renderSegmentsForAxis(eastPreview)}
            </div>

            {/* Résumé global */}
            {northPreview.status === 'valid' && eastPreview.status === 'valid' && (
                <div style={{
                    marginTop: '12px',
                    padding: '8px',
                    backgroundColor: 'var(--theia-successBackground)',
                    border: '1px solid var(--theia-successText)',
                    borderRadius: '4px',
                    fontSize: '12px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px'
                }}>
                    <span className="codicon codicon-check" />
                    <span>Les coordonnées complètes sont prêtes pour le calcul final !</span>
                </div>
            )}
        </div>
    );
};

// Évite les recalculs/évaluations à chaque re-render du widget parent.
// On ne rerender que si la formule ou les valeurs changent (référence).
export const FormulaPreviewComponent = React.memo(InnerFormulaPreviewComponent);

function buildSegmentTooltip(axisPreview: AxisPreview, segmentId: 'degrees' | 'minutes' | 'decimals'): string {
    const seg = axisPreview[segmentId];
    const lines: string[] = [];
    lines.push(`${segmentId} : ${seg.rawExpression || '(vide)'}`);
    lines.push(`Affichage: ${seg.displayText || '—'}`);
    lines.push(`Digits: ${seg.displayDigits || '—'}`);
    if (seg.usedLetters?.length) {
        lines.push(`Lettres: ${seg.usedLetters.join(', ')}`);
    }
    if (seg.missingLetters?.length) {
        lines.push(`Manquantes: ${seg.missingLetters.join(', ')}`);
    }
    if (seg.minValue !== undefined && seg.maxValue !== undefined) {
        lines.push(`Range: ${seg.minValue} .. ${seg.maxValue}`);
    }
    const related = (axisPreview.issues || []).filter(i => i.segmentId === segmentId);
    related.forEach(i => lines.push(`${i.level.toUpperCase()}: ${i.message}`));
    return lines.join('\n');
}
