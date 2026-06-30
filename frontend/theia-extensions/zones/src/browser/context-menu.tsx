import * as React from 'react';

export interface ContextMenuItem {
    label?: string;
    icon?: string;
    action?: () => void;
    danger?: boolean;
    separator?: boolean;
    disabled?: boolean;
    /** Affiche une coche à gauche (état sélectionné, ex. critère de tri actif). */
    checked?: boolean;
    /** Sous-menu déroulé au survol; rend l'item non cliquable directement. */
    submenu?: ContextMenuItem[];
}

export interface ContextMenuProps {
    items: ContextMenuItem[];
    x: number;
    y: number;
    onClose: () => void;
}

const MENU_PANEL_STYLE: React.CSSProperties = {
    background: 'var(--theia-menu-background)',
    border: '1px solid var(--theia-menu-border)',
    borderRadius: 4,
    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
    zIndex: 10000,
    minWidth: 180,
    padding: '4px 0',
};

const MenuList: React.FC<{ items: ContextMenuItem[]; onClose: () => void }> = ({ items, onClose }) => {
    const [openSubmenuIndex, setOpenSubmenuIndex] = React.useState<number | null>(null);

    return (
        <>
            {items.map((item, index) => {
                if (item.separator) {
                    return (
                        <div
                            key={index}
                            style={{
                                height: 1,
                                background: 'var(--theia-menu-separatorBackground)',
                                margin: '4px 0',
                            }}
                        />
                    );
                }

                const hasSubmenu = !!item.submenu && item.submenu.length > 0;
                const isSubmenuOpen = openSubmenuIndex === index;

                return (
                    <div
                        key={index}
                        style={{ position: 'relative' }}
                        onMouseEnter={() => setOpenSubmenuIndex(hasSubmenu ? index : null)}
                    >
                        <div
                            onClick={() => {
                                if (item.disabled || hasSubmenu) {
                                    return;
                                }
                                if (item.action) {
                                    item.action();
                                    onClose();
                                }
                            }}
                            style={{
                                padding: '6px 12px',
                                cursor: item.disabled ? 'not-allowed' : 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: 8,
                                fontSize: '0.9em',
                                color: item.danger
                                    ? 'var(--theia-errorForeground)'
                                    : item.disabled
                                        ? 'var(--theia-descriptionForeground)'
                                        : 'var(--theia-menu-foreground)',
                                opacity: item.disabled ? 0.5 : 1,
                                background: isSubmenuOpen ? 'var(--theia-menu-selectionBackground)' : 'transparent',
                            }}
                            onMouseEnter={(e) => {
                                if (!item.disabled) {
                                    (e.currentTarget as HTMLElement).style.background = 'var(--theia-menu-selectionBackground)';
                                }
                            }}
                            onMouseLeave={(e) => {
                                if (!isSubmenuOpen) {
                                    (e.currentTarget as HTMLElement).style.background = 'transparent';
                                }
                            }}
                        >
                            <span style={{ width: 14, display: 'inline-flex', justifyContent: 'center' }}>
                                {item.checked ? '✓' : ''}
                            </span>
                            {item.icon && <span>{item.icon}</span>}
                            <span style={{ flex: 1 }}>{item.label || ''}</span>
                            {hasSubmenu && <span style={{ opacity: 0.7 }}>▸</span>}
                        </div>

                        {hasSubmenu && isSubmenuOpen && (
                            <div
                                style={{
                                    ...MENU_PANEL_STYLE,
                                    position: 'absolute',
                                    left: '100%',
                                    top: -5,
                                }}
                            >
                                <MenuList items={item.submenu!} onClose={onClose} />
                            </div>
                        )}
                    </div>
                );
            })}
        </>
    );
};

export const ContextMenu: React.FC<ContextMenuProps> = ({ items, x, y, onClose }) => {
    const menuRef = React.useRef<HTMLDivElement>(null);

    React.useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
                onClose();
            }
        };

        const handleEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                onClose();
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        document.addEventListener('keydown', handleEscape);

        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('keydown', handleEscape);
        };
    }, [onClose]);

    return (
        <div
            ref={menuRef}
            style={{
                ...MENU_PANEL_STYLE,
                position: 'fixed',
                left: x,
                top: y,
            }}
        >
            <MenuList items={items} onClose={onClose} />
        </div>
    );
};

