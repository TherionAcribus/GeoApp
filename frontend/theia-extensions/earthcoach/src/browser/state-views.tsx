import * as React from 'react';

// Composants d'état partagés (vide / chargement / erreur) pour uniformiser le rendu
// des widgets de l'extension earthcoach. Les styles sont hoistés au module scope afin
// de n'être alloués qu'une seule fois.

const centeredStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    textAlign: 'center',
    gap: 8,
    padding: 24
};

const fullHeightStyle: React.CSSProperties = { ...centeredStyle, height: '100%' };

const iconStyle: React.CSSProperties = { fontSize: 40, opacity: 0.5, marginBottom: 4 };

const titleStyle: React.CSSProperties = { margin: 0, fontSize: 14, fontWeight: 600 };

const descriptionStyle: React.CSSProperties = {
    margin: 0,
    fontSize: 12,
    opacity: 0.7,
    maxWidth: 320,
    lineHeight: 1.5
};

export interface EmptyStateProps {
    /** Classe d'icône Font Awesome (ex: 'fa-globe'). */
    icon?: string;
    title: string;
    description?: string;
    action?: React.ReactNode;
    fullHeight?: boolean;
}

export function EmptyState({ icon = 'fa-inbox', title, description, action, fullHeight }: EmptyStateProps): React.JSX.Element {
    return (
        <div role='status' style={fullHeight ? fullHeightStyle : centeredStyle}>
            <i className={`fa ${icon}`} style={iconStyle} aria-hidden='true' />
            <p style={titleStyle}>{title}</p>
            {description ? <p style={descriptionStyle}>{description}</p> : undefined}
            {action ? <div style={{ marginTop: 8 }}>{action}</div> : undefined}
        </div>
    );
}
