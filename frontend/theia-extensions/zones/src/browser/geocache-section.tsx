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

interface SectionTitleProps extends CollapsibleSectionProps {
    title: React.ReactNode;
    /** Absent : la section n'est pas repliable, le titre est un simple intitulé. */
    sectionId?: string;
    collapseDisabled?: boolean;
    collapseDisabledTitle?: string;
}

/**
 * Titre d'une section de la fiche. Quand la section est repliable, le chevron et
 * l'intitulé forment un seul bouton : toute la zone du titre replie/déplie.
 */
export const SectionTitle: React.FC<SectionTitleProps> = ({
    title,
    sectionId,
    collapsed,
    onSectionCollapsedChange,
    collapseDisabled,
    collapseDisabledTitle
}) => (
    <h4 className='geoapp-gcd-section__title'>
        {sectionId && onSectionCollapsedChange ? (
            <button
                type='button'
                className='geoapp-gcd-section__toggle'
                disabled={collapseDisabled}
                aria-expanded={!collapsed}
                title={(collapseDisabled ? collapseDisabledTitle : undefined) ?? (collapsed ? 'Déplier la section' : 'Replier la section')}
                onClick={() => onSectionCollapsedChange(sectionId, !collapsed)}
            >
                <span className={`codicon ${collapsed ? 'codicon-chevron-right' : 'codicon-chevron-down'}`} aria-hidden='true' />
                <span>{title}</span>
            </button>
        ) : title}
    </h4>
);

interface GeocacheSectionProps extends SectionTitleProps {
    /** Résumé ou contrôles accolés au titre, visibles même section repliée. */
    meta?: React.ReactNode;
    /** Actions alignées à droite, masquées quand la section est repliée. */
    actions?: React.ReactNode;
    /**
     * Garde le contenu monté (display:none) quand la section est repliée, pour les
     * sections qui portent un état interne (édition en cours, sélections).
     */
    keepMounted?: boolean;
    className?: string;
    children?: React.ReactNode;
}

/** Carte commune à toutes les sections de la fiche : même cadre, même ligne de titre. */
export const GeocacheSection: React.FC<GeocacheSectionProps> = ({
    meta,
    actions,
    keepMounted,
    className,
    children,
    ...titleProps
}) => {
    const isCollapsed = Boolean(titleProps.collapsed);
    return (
        <section className={`geoapp-gcd-section${className ? ` ${className}` : ''}`}>
            <div className='geoapp-gcd-section__header'>
                <SectionTitle {...titleProps} />
                {meta ? <div className='geoapp-gcd-section__meta'>{meta}</div> : undefined}
                {actions && !isCollapsed ? <div className='geoapp-gcd-section__actions'>{actions}</div> : undefined}
            </div>
            {keepMounted
                ? <div style={{ display: isCollapsed ? 'none' : 'contents' }}>{children}</div>
                : (isCollapsed ? undefined : children)}
        </section>
    );
};
