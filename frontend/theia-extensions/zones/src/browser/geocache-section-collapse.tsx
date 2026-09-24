import * as React from 'react';
import '../../src/browser/style/geocache-details-header.css';

/**
 * Props communes aux sections repliables de la fiche détail. L'état est porté
 * par le widget et persisté en préférence (`geoApp.geocache.details.collapsedSections`).
 */
export interface CollapsibleSectionProps {
    collapsed?: boolean;
    onSectionCollapsedChange?: (sectionId: string, collapsed: boolean) => void;
}

/** Chevron de repli placé dans la ligne de titre d'une section. */
export const SectionCollapseToggle: React.FC<{
    sectionId: string;
    collapsed: boolean;
    onSectionCollapsedChange?: (sectionId: string, collapsed: boolean) => void;
    disabled?: boolean;
    title?: string;
}> = ({ sectionId, collapsed, onSectionCollapsedChange, disabled, title }) => {
    if (!onSectionCollapsedChange) {
        return null;
    }
    return (
        <button
            type='button'
            className='geoapp-gcd-collapse-toggle'
            disabled={disabled}
            aria-expanded={!collapsed}
            title={title ?? (collapsed ? 'Déplier la section' : 'Replier la section')}
            onClick={() => onSectionCollapsedChange(sectionId, !collapsed)}
        >
            <span className={`codicon ${collapsed ? 'codicon-chevron-right' : 'codicon-chevron-down'}`} aria-hidden='true' />
        </button>
    );
};
