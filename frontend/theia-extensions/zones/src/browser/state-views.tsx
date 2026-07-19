import * as React from 'react';

// Composants d'état partagés (vide / chargement / erreur) pour uniformiser le rendu
// des widgets de l'extension zones. Les styles sont hoistés au module scope afin de
// n'être alloués qu'une seule fois (les vues parentes se re-rendent à chaque frappe).

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

const errorIconStyle: React.CSSProperties = { ...iconStyle, color: 'var(--theia-errorForeground)' };

const errorTitleStyle: React.CSSProperties = { ...titleStyle, color: 'var(--theia-errorForeground)' };

export interface EmptyStateProps {
    /** Classe d'icône Font Awesome (ex: 'fa-comments'). */
    icon?: string;
    title: string;
    description?: string;
    /** Action optionnelle (ex: bouton « Créer »). */
    action?: React.ReactNode;
    /** Occupe toute la hauteur disponible (utile quand l'état vide est seul dans le panneau). */
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

export interface LoadingStateProps {
    message?: string;
    fullHeight?: boolean;
}

export function LoadingState({ message = 'Chargement…', fullHeight }: LoadingStateProps): React.JSX.Element {
    return (
        <div role='status' aria-busy='true' aria-live='polite' style={fullHeight ? fullHeightStyle : centeredStyle}>
            <i className='fa fa-spinner fa-spin' style={iconStyle} aria-hidden='true' />
            <p style={titleStyle}>{message}</p>
        </div>
    );
}

export interface ErrorStateProps {
    title?: string;
    message?: string;
    /** Callback de relance ; affiche un bouton « Réessayer » si fourni. */
    onRetry?: () => void;
    retryLabel?: string;
    fullHeight?: boolean;
}

export function ErrorState({ title = 'Une erreur est survenue', message, onRetry, retryLabel = 'Réessayer', fullHeight }: ErrorStateProps): React.JSX.Element {
    return (
        <div role='alert' style={fullHeight ? fullHeightStyle : centeredStyle}>
            <i className='fa fa-exclamation-triangle' style={errorIconStyle} aria-hidden='true' />
            <p style={errorTitleStyle}>{title}</p>
            {message ? <p style={descriptionStyle}>{message}</p> : undefined}
            {onRetry ? (
                <button className='theia-button secondary' style={{ marginTop: 8 }} onClick={onRetry} type='button'>
                    {retryLabel}
                </button>
            ) : undefined}
        </div>
    );
}
