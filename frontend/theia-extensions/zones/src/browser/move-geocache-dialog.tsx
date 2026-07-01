import * as React from 'react';

export interface MoveGeocacheDialogProps {
    geocacheName?: string;
    geocacheCount?: number;
    currentZoneId: number;
    zones: Array<{ id: number; name: string }>;
    onMove: (targetZoneId: number) => void;
    onCancel: () => void;
    title?: string;
    actionLabel?: string;
}

export const MoveGeocacheDialog: React.FC<MoveGeocacheDialogProps> = ({
    geocacheName,
    geocacheCount,
    currentZoneId,
    zones,
    onMove,
    onCancel,
    title = 'Déplacer la géocache',
    actionLabel = 'Déplacer',
}) => {
    const [selectedZoneId, setSelectedZoneId] = React.useState<number | null>(null);
    const dialogRef = React.useRef<HTMLDivElement>(null);
    const listboxRef = React.useRef<HTMLDivElement>(null);
    const titleId = React.useId();

    const availableZones = zones.filter(z => z.id !== currentZoneId);
    const optionId = (zoneId: number) => `move-zone-option-${zoneId}`;

    // Fermeture sur Echap
    React.useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                onCancel();
            }
        };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [onCancel]);

    // Auto-focus à l'ouverture: la liste si des zones sont disponibles (pour la
    // navigation clavier), sinon le panneau.
    React.useEffect(() => {
        const hasOptions = zones.some(z => z.id !== currentZoneId);
        if (hasOptions) {
            listboxRef.current?.focus();
        } else {
            dialogRef.current?.focus();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const selectByIndex = (index: number): void => {
        const zone = availableZones[index];
        if (!zone) {
            return;
        }
        setSelectedZoneId(zone.id);
        window.requestAnimationFrame(() => {
            document.getElementById(optionId(zone.id))?.scrollIntoView({ block: 'nearest' });
        });
    };

    const handleListKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
        if (availableZones.length === 0) {
            return;
        }
        const currentIndex = availableZones.findIndex(z => z.id === selectedZoneId);
        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                selectByIndex(currentIndex < 0 ? 0 : Math.min(currentIndex + 1, availableZones.length - 1));
                break;
            case 'ArrowUp':
                e.preventDefault();
                selectByIndex(currentIndex < 0 ? availableZones.length - 1 : Math.max(currentIndex - 1, 0));
                break;
            case 'Home':
                e.preventDefault();
                selectByIndex(0);
                break;
            case 'End':
                e.preventDefault();
                selectByIndex(availableZones.length - 1);
                break;
            case 'Enter':
                e.preventDefault();
                if (selectedZoneId !== null) {
                    onMove(selectedZoneId);
                }
                break;
            default:
                break;
        }
    };

    return (
        <div
            style={{
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                background: 'rgba(0, 0, 0, 0.5)',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                zIndex: 10000,
            }}
            onClick={onCancel}
            aria-hidden="true"
        >
            <div
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                tabIndex={-1}
                style={{
                    background: 'var(--theia-editor-background)',
                    border: '1px solid var(--theia-panel-border)',
                    borderRadius: 6,
                    padding: 20,
                    minWidth: 400,
                    maxWidth: 500,
                    boxShadow: '0 8px 24px rgba(0, 0, 0, 0.3)',
                    outline: 'none',
                }}
                onClick={(e) => e.stopPropagation()}
            >
                <h3 id={titleId} style={{ margin: '0 0 16px 0', fontSize: '1.1em' }}>
                    {title}
                </h3>

                <p style={{ margin: '0 0 16px 0', fontSize: '0.9em', opacity: 0.8 }}>
                    {actionLabel} {geocacheName ? <strong>{geocacheName}</strong> : `${geocacheCount} géocache${geocacheCount && geocacheCount > 1 ? 's' : ''}`} vers :
                </p>

                {availableZones.length === 0 ? (
                    <p style={{ fontSize: '0.9em', opacity: 0.6, fontStyle: 'italic' }}>
                        Aucune autre zone disponible
                    </p>
                ) : (
                    <div
                        ref={listboxRef}
                        role="listbox"
                        aria-label="Zone de destination"
                        tabIndex={0}
                        aria-activedescendant={selectedZoneId !== null ? optionId(selectedZoneId) : undefined}
                        onKeyDown={handleListKeyDown}
                        style={{ marginBottom: 20, outline: 'none' }}
                    >
                        {availableZones.map(zone => (
                            <div
                                key={zone.id}
                                id={optionId(zone.id)}
                                role="option"
                                aria-selected={selectedZoneId === zone.id}
                                onClick={() => setSelectedZoneId(zone.id)}
                                onDoubleClick={() => onMove(zone.id)}
                                style={{
                                    padding: '10px 12px',
                                    marginBottom: 6,
                                    border: selectedZoneId === zone.id
                                        ? '1px solid var(--theia-focusBorder)'
                                        : '1px solid var(--theia-input-border)',
                                    borderRadius: 4,
                                    cursor: 'pointer',
                                    background: selectedZoneId === zone.id
                                        ? 'var(--theia-list-activeSelectionBackground)'
                                        : 'var(--theia-input-background)',
                                    color: 'inherit',
                                }}
                                onMouseEnter={(e) => {
                                    if (selectedZoneId !== zone.id) {
                                        (e.currentTarget as HTMLElement).style.background = 'var(--theia-list-hoverBackground)';
                                    }
                                }}
                                onMouseLeave={(e) => {
                                    if (selectedZoneId !== zone.id) {
                                        (e.currentTarget as HTMLElement).style.background = 'var(--theia-input-background)';
                                    }
                                }}
                            >
                                📁 {zone.name}
                            </div>
                        ))}
                    </div>
                )}

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                    <button
                        onClick={onCancel}
                        className="theia-button secondary"
                        style={{ padding: '6px 16px' }}
                    >
                        Annuler
                    </button>
                    <button
                        onClick={() => {
                            if (selectedZoneId !== null) {
                                onMove(selectedZoneId);
                            }
                        }}
                        className="theia-button"
                        disabled={selectedZoneId === null || availableZones.length === 0}
                        style={{ padding: '6px 16px' }}
                    >
                        {actionLabel}
                    </button>
                </div>
            </div>
        </div>
    );
};
