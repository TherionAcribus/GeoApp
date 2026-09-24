import * as React from 'react';
import '../../src/browser/style/geocache-details-header.css';

export interface ContextMenuItem {
    label?: string;
    /** Picto texte (emoji) — préférer `iconClass` pour une icône codicon. */
    icon?: string;
    /** Classe d'icône codicon (ex. `'codicon codicon-refresh'`), prioritaire sur `icon`. */
    iconClass?: string;
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

/**
 * Navigation clavier entre les items focusables d'un menu : ArrowDown/ArrowUp
 * (cyclique), Home et End. `menu` doit porter role='menu' ; les items imbriqués
 * dans un sous-menu (autre role='menu' descendant) sont ignorés, ce qui permet
 * d'attacher le handler à chaque panneau sans interférence.
 * Retourne true si la touche a été consommée.
 */
export function handleMenuArrowKeys(event: React.KeyboardEvent, menu: HTMLElement): boolean {
    const key = event.key;
    if (key !== 'ArrowDown' && key !== 'ArrowUp' && key !== 'Home' && key !== 'End') {
        return false;
    }
    const items = Array.from(
        menu.querySelectorAll<HTMLElement>('[role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"]')
    ).filter(el =>
        el.closest('[role="menu"]') === menu &&
        el.tabIndex >= 0 &&
        el.getAttribute('aria-disabled') !== 'true' &&
        !(el instanceof HTMLButtonElement && el.disabled)
    );
    if (items.length === 0) {
        return false;
    }
    event.preventDefault();
    const currentIndex = items.indexOf(document.activeElement as HTMLElement);
    let nextIndex: number;
    if (key === 'Home') {
        nextIndex = 0;
    } else if (key === 'End') {
        nextIndex = items.length - 1;
    } else {
        const delta = key === 'ArrowDown' ? 1 : -1;
        nextIndex = currentIndex < 0
            ? (delta > 0 ? 0 : items.length - 1)
            : (currentIndex + delta + items.length) % items.length;
    }
    items[nextIndex].focus();
    return true;
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
                            className={`geoapp-menu-item${item.disabled ? ' geoapp-menu-item--disabled' : ''}${isSubmenuOpen ? ' geoapp-menu-item--open' : ''}`}
                            role='menuitem'
                            tabIndex={item.disabled ? -1 : 0}
                            aria-disabled={item.disabled || undefined}
                            onClick={() => {
                                if (item.disabled || hasSubmenu) {
                                    return;
                                }
                                if (item.action) {
                                    item.action();
                                    onClose();
                                }
                            }}
                            onKeyDown={(e) => {
                                if (e.key !== 'Enter' && e.key !== ' ') {
                                    return;
                                }
                                e.preventDefault();
                                if (item.disabled) {
                                    return;
                                }
                                if (hasSubmenu) {
                                    setOpenSubmenuIndex(index);
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
                                        : undefined,
                                opacity: item.disabled ? 0.5 : 1,
                            }}
                        >
                            <span style={{ width: 14, display: 'inline-flex', justifyContent: 'center' }}>
                                {item.checked ? '✓' : ''}
                            </span>
                            {item.iconClass
                                ? <span className={item.iconClass} aria-hidden='true' />
                                : item.icon && <span>{item.icon}</span>}
                            <span style={{ flex: 1 }}>{item.label || ''}</span>
                            {hasSubmenu && <span style={{ opacity: 0.7 }}>▸</span>}
                        </div>

                        {hasSubmenu && isSubmenuOpen && (
                            <div
                                role='menu'
                                onKeyDown={(e) => handleMenuArrowKeys(e, e.currentTarget)}
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
            role='menu'
            onKeyDown={(e) => handleMenuArrowKeys(e, e.currentTarget)}
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

