import * as React from '@theia/core/shared/react';

// Composants d'état partagés (vide / chargement) pour uniformiser le rendu des
// sections du Formula Solver. Styles hoistés au module scope.

const centeredStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    textAlign: 'center',
    gap: 8,
    padding: 20
};

const iconStyle: React.CSSProperties = { fontSize: 32, opacity: 0.5, marginBottom: 4 };

const titleStyle: React.CSSProperties = { margin: 0, fontSize: 13 };

const descriptionStyle: React.CSSProperties = {
    margin: 0,
    fontSize: 12,
    opacity: 0.7,
    maxWidth: 320,
    lineHeight: 1.5
};

export interface EmptyStateProps {
    icon?: string;
    title: string;
    description?: string;
}

export function EmptyState({ icon = 'codicon-inbox', title, description }: EmptyStateProps): React.JSX.Element {
    return (
        <div role='status' style={centeredStyle}>
            <span className={`codicon ${icon}`} style={iconStyle} aria-hidden='true' />
            <p style={titleStyle}>{title}</p>
            {description ? <p style={descriptionStyle}>{description}</p> : undefined}
        </div>
    );
}

export interface LoadingStateProps {
    message?: string;
}

export function LoadingState({ message = 'Chargement…' }: LoadingStateProps): React.JSX.Element {
    return (
        <div role='status' aria-busy='true' aria-live='polite' style={{ textAlign: 'center', marginTop: 20 }}>
            <span className='theia-animation-spin codicon codicon-loading' aria-hidden='true' />
            <span style={{ marginLeft: 10 }}>{message}</span>
        </div>
    );
}
