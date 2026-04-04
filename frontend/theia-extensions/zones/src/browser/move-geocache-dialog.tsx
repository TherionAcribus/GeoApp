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

    const availableZones = zones.filter(z => z.id !== currentZoneId);

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
        >
            <div
                style={{
                    background: 'var(--theia-editor-background)',
                    border: '1px solid var(--theia-panel-border)',
                    borderRadius: 6,
                    padding: 20,
                    minWidth: 400,
                    maxWidth: 500,
                    boxShadow: '0 8px 24px rgba(0, 0, 0, 0.3)',
                }}
                onClick={(e) => e.stopPropagation()}
            >
                <h3 style={{ margin: '0 0 16px 0', fontSize: '1.1em' }}>
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
                    <div style={{ marginBottom: 20 }}>
                        {availableZones.map(zone => (
                            <div
                                key={zone.id}
                                onClick={() => setSelectedZoneId(zone.id)}
                                style={{
                                    padding: '10px 12px',
                                    marginBottom: 6,
                                    border: '1px solid var(--theia-input-border)',
                                    borderRadius: 4,
                                    cursor: 'pointer',
                                    background: selectedZoneId === zone.id
                                        ? 'var(--theia-list-activeSelectionBackground)'
                                        : 'var(--theia-input-background)',
                                    transition: 'all 0.2s',
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

