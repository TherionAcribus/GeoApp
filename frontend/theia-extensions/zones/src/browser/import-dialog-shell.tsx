import * as React from 'react';

/** Compteurs cumulés d'un import (miroir de _new_import_counts côté backend). */
export interface ImportCounts {
    created: number;
    updated: number;
    existing: number;
    moved: number;
    errors: number;
}

/** Données structurées optionnelles transmises à chaque tick de progression. */
export interface ImportProgressExtra {
    counts?: ImportCounts;
    errorItem?: string;
}

export type ImportProgressCallback = (
    percentage: number,
    message: string,
    extra?: ImportProgressExtra
) => void;

export interface ImportDialogShellProps {
    title: string;
    isImporting: boolean;
    canSubmit: boolean;
    submitLabel?: string;
    onSubmit: (e: React.FormEvent) => void;
    onCancel: () => void;
    onCancelImport?: () => void;
    progressVisible: boolean;
    progressPercentage: number;
    progressMessage: string;
    /** Compteurs cumulés affichés en direct pendant l'import (point 9). */
    counts?: ImportCounts;
    /** Messages des caches en erreur, listés dans le dialogue (point 9). */
    errorItems?: string[];
    children?: React.ReactNode;
}

export function formatImportCounts(c: ImportCounts): string {
    const parts: string[] = [];
    if (c.created) { parts.push(`${c.created} importée(s)`); }
    if (c.updated) { parts.push(`${c.updated} mise(s) à jour`); }
    if (c.existing) { parts.push(`${c.existing} déjà présente(s)`); }
    if (c.moved) { parts.push(`${c.moved} déplacée(s)`); }
    if (c.errors) { parts.push(`${c.errors} erreur(s)`); }
    return parts.join(' · ');
}

const secondaryBtn: React.CSSProperties = {
    padding: '8px 16px',
    backgroundColor: 'var(--theia-button-secondaryBackground)',
    color: 'var(--theia-button-secondaryForeground)',
    border: 'none',
    borderRadius: '4px'
};

/**
 * Coquille commune aux dialogues d'import (GPX, Pocket Query, liste de favoris).
 *
 * Fournit l'overlay (fermeture bloquée pendant l'import — point 10), l'en-tête,
 * la barre de progression, le compteur cumulé en direct et la liste des erreurs
 * (point 9), ainsi que les boutons d'action. Le contenu spécifique à chaque
 * import (input fichier, select…) est passé en ``children``.
 */
export const ImportDialogShell: React.FC<ImportDialogShellProps> = ({
    title,
    isImporting,
    canSubmit,
    submitLabel = 'Importer',
    onSubmit,
    onCancel,
    onCancelImport,
    progressVisible,
    progressPercentage,
    progressMessage,
    counts,
    errorItems,
    children
}) => {
    const countsLabel = counts ? formatImportCounts(counts) : '';
    const hasErrors = !!(errorItems && errorItems.length > 0);

    return (
        <div
            style={{
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                backgroundColor: 'rgba(0, 0, 0, 0.5)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 10000
            }}
            onClick={() => { if (!isImporting) { onCancel(); } }}
        >
            <div
                style={{
                    backgroundColor: 'var(--theia-editor-background)',
                    padding: '24px',
                    borderRadius: '8px',
                    width: '500px',
                    maxWidth: '90vw',
                    border: '1px solid var(--theia-panel-border)',
                    boxShadow: '0 4px 6px rgba(0, 0, 0, 0.3)'
                }}
                onClick={(e) => e.stopPropagation()}
            >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                    <h3 style={{ margin: 0, fontSize: '18px', color: 'var(--theia-foreground)' }}>
                        {title}
                    </h3>
                    <button
                        type="button"
                        onClick={onCancel}
                        disabled={isImporting}
                        style={{
                            background: 'none',
                            border: 'none',
                            color: 'var(--theia-foreground)',
                            cursor: isImporting ? 'not-allowed' : 'pointer',
                            padding: '4px',
                            opacity: isImporting ? 0.5 : 1,
                            fontSize: '20px'
                        }}
                    >
                        ✕
                    </button>
                </div>

                <form onSubmit={onSubmit}>
                    {children}

                    {progressVisible && (
                        <div style={{ marginBottom: '16px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                                <span style={{ fontSize: '13px', color: 'var(--theia-foreground)' }}>
                                    Progression
                                </span>
                                <span style={{ fontSize: '13px', color: 'var(--theia-descriptionForeground)' }}>
                                    {progressPercentage}%
                                </span>
                            </div>
                            <div
                                style={{
                                    width: '100%',
                                    height: '8px',
                                    backgroundColor: 'var(--theia-panel-border)',
                                    borderRadius: '4px',
                                    overflow: 'hidden'
                                }}
                            >
                                <div
                                    style={{
                                        width: `${progressPercentage}%`,
                                        height: '100%',
                                        backgroundColor: 'var(--theia-progressBar-background, #0078d4)',
                                        transition: 'width 0.3s ease'
                                    }}
                                />
                            </div>
                            {progressMessage && (
                                <p style={{ fontSize: '12px', color: 'var(--theia-descriptionForeground)', marginTop: '4px' }}>
                                    {progressMessage}
                                </p>
                            )}
                            {countsLabel && (
                                <p style={{ fontSize: '12px', color: 'var(--theia-foreground)', marginTop: '4px', fontWeight: 500 }}>
                                    {countsLabel}
                                </p>
                            )}
                        </div>
                    )}

                    {hasErrors && (
                        <div style={{ marginBottom: '16px' }}>
                            <p style={{ fontSize: '12px', color: 'var(--theia-errorForeground)', margin: '0 0 4px 0' }}>
                                {errorItems!.length} erreur(s) :
                            </p>
                            <div
                                style={{
                                    maxHeight: '96px',
                                    overflowY: 'auto',
                                    padding: '8px',
                                    backgroundColor: 'var(--theia-inputValidation-errorBackground)',
                                    border: '1px solid var(--theia-inputValidation-errorBorder)',
                                    borderRadius: '4px'
                                }}
                            >
                                {errorItems!.map((item, i) => (
                                    <div key={i} style={{ fontSize: '11px', color: 'var(--theia-errorForeground)', fontFamily: 'monospace' }}>
                                        {item}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                        {isImporting && onCancelImport && (
                            <button
                                type="button"
                                onClick={onCancelImport}
                                style={{
                                    padding: '8px 16px',
                                    backgroundColor: 'var(--theia-inputValidation-errorBackground)',
                                    color: 'var(--theia-errorForeground)',
                                    border: '1px solid var(--theia-inputValidation-errorBorder)',
                                    borderRadius: '4px',
                                    cursor: 'pointer'
                                }}
                            >
                                Interrompre
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={onCancel}
                            disabled={isImporting}
                            style={{
                                ...secondaryBtn,
                                cursor: isImporting ? 'not-allowed' : 'pointer',
                                opacity: isImporting ? 0.5 : 1
                            }}
                        >
                            Annuler
                        </button>
                        <button
                            type="submit"
                            disabled={!canSubmit || isImporting}
                            style={{
                                padding: '8px 16px',
                                backgroundColor: (!canSubmit || isImporting) ? 'var(--theia-button-disabledBackground)' : 'var(--theia-button-background)',
                                color: (!canSubmit || isImporting) ? 'var(--theia-button-disabledForeground)' : 'var(--theia-button-foreground)',
                                border: 'none',
                                borderRadius: '4px',
                                cursor: (!canSubmit || isImporting) ? 'not-allowed' : 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px'
                            }}
                        >
                            <span>{submitLabel}</span>
                            {isImporting && (
                                <div
                                    style={{
                                        width: '16px',
                                        height: '16px',
                                        border: '2px solid currentColor',
                                        borderTopColor: 'transparent',
                                        borderRadius: '50%',
                                        animation: 'spin 1s linear infinite'
                                    }}
                                />
                            )}
                        </button>
                    </div>
                </form>
            </div>

            <style>{`
                @keyframes spin {
                    to { transform: rotate(360deg); }
                }
            `}</style>
        </div>
    );
};
