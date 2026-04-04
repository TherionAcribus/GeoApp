import * as React from 'react';

export interface ContextMenuItem {
    label?: string;
    icon?: string;
    action?: () => void;
    danger?: boolean;
    separator?: boolean;
    disabled?: boolean;
}

export interface ContextMenuProps {
    items: ContextMenuItem[];
    x: number;
    y: number;
    onClose: () => void;
}

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
                position: 'fixed',
                left: x,
                top: y,
                background: 'var(--theia-menu-background)',
                border: '1px solid var(--theia-menu-border)',
                borderRadius: 4,
                boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
                zIndex: 10000,
                minWidth: 180,
                padding: '4px 0',
            }}
        >
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

                return (
                    <div
                        key={index}
                        onClick={() => {
                            if (!item.disabled && item.action) {
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
                        }}
                        onMouseEnter={(e) => {
                            if (!item.disabled) {
                                (e.currentTarget as HTMLElement).style.background = 'var(--theia-menu-selectionBackground)';
                            }
                        }}
                        onMouseLeave={(e) => {
                            (e.currentTarget as HTMLElement).style.background = 'transparent';
                        }}
                    >
                        {item.icon && <span>{item.icon}</span>}
                        <span>{item.label || ''}</span>
                    </div>
                );
            })}
        </div>
    );
};

