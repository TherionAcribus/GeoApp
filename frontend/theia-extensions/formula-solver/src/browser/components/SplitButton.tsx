import * as React from '@theia/core/shared/react';

export interface SplitButtonProps {
    id: string;
    label: string;
    title: string;
    onClick: () => void;
    disabled?: boolean;
    loading?: boolean;
    primary?: boolean;
    isMenuOpen: boolean;
    onToggleMenu: () => void;
    menuItems: Array<{ label: string; title?: string; onClick: () => void }>;
}

/**
 * Bouton "split" : action principale + caret ouvrant un menu d'actions alternatives.
 * Remplace des groupes de boutons redondants (ex: "Répondre" / "Écraser" / "Forcer IA"
 * / "Forcer Web") par un seul contrôle compact.
 *
 * Le conteneur porte `data-fs-menu-root` : le widget s'en sert pour fermer le menu
 * au clic en dehors.
 */
export const SplitButton: React.FC<SplitButtonProps> = ({
    id, label, title, onClick, disabled, loading, primary, isMenuOpen, onToggleMenu, menuItems
}) => {
    const backgroundColor = primary ? 'var(--theia-button-background)' : 'var(--theia-button-secondaryBackground)';
    const color = primary ? 'var(--theia-button-foreground)' : 'var(--theia-button-secondaryForeground)';

    return (
        <div data-fs-menu-root={id} style={{ position: 'relative', display: 'inline-flex' }}>
            <button
                style={{
                    padding: '6px 10px',
                    backgroundColor,
                    color,
                    border: 'none',
                    borderRadius: '4px 0 0 4px',
                    cursor: disabled ? 'default' : 'pointer',
                    fontSize: '12px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px'
                }}
                onClick={onClick}
                disabled={disabled}
                title={title}
            >
                {loading ? <span className="formula-solver-spinner" style={{ width: '12px', height: '12px', margin: 0 }} /> : null}
                {label}
            </button>
            <button
                style={{
                    padding: '6px 6px',
                    backgroundColor,
                    color,
                    border: 'none',
                    borderLeft: '1px solid var(--theia-panel-border)',
                    borderRadius: '0 4px 4px 0',
                    cursor: disabled ? 'default' : 'pointer',
                    fontSize: '12px'
                }}
                onClick={onToggleMenu}
                disabled={disabled}
                title="Autres options"
            >
                <span className="codicon codicon-chevron-down" />
            </button>

            {isMenuOpen && (
                <div style={{
                    position: 'absolute',
                    top: '100%',
                    left: 0,
                    marginTop: '4px',
                    backgroundColor: 'var(--theia-dropdown-background)',
                    border: '1px solid var(--theia-dropdown-border)',
                    borderRadius: '4px',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
                    zIndex: 10,
                    minWidth: '220px',
                    display: 'flex',
                    flexDirection: 'column',
                    overflow: 'hidden'
                }}>
                    {menuItems.map((item, idx) => (
                        <button
                            key={idx}
                            className="formula-solver-menu-item"
                            style={{
                                padding: '8px 12px',
                                backgroundColor: 'transparent',
                                color: 'var(--theia-dropdown-foreground)',
                                border: 'none',
                                textAlign: 'left',
                                cursor: 'pointer',
                                fontSize: '12px',
                                whiteSpace: 'nowrap'
                            }}
                            onClick={item.onClick}
                            title={item.title}
                        >
                            {item.label}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
};
