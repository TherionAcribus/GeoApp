/**
 * Exemples d'utilisation du système d'icônes de géocaches
 * 
 * Ce fichier contient des exemples pratiques pour vous aider à démarrer.
 * Vous pouvez copier-coller ces exemples dans vos composants.
 */

import * as React from 'react';
import { GeocacheIcon, GeocacheIconLegend } from './geocache-icon';
import { getIconByCacheType, getAllIcons } from './geocache-icon-config';

// ============================================================================
// EXEMPLE 1 : Utilisation basique dans une liste
// ============================================================================

interface Geocache {
    id: number;
    name: string;
    cache_type: string;
}

export const GeocacheList: React.FC<{ geocaches: Geocache[] }> = ({ geocaches }) => {
    return (
        <div>
            {geocaches.map(gc => (
                <div 
                    key={gc.id}
                    style={{ 
                        display: 'flex', 
                        alignItems: 'center', 
                        gap: 12,
                        padding: 8,
                        borderBottom: '1px solid #ddd'
                    }}
                >
                    <GeocacheIcon type={gc.cache_type} size={32} />
                    <span>{gc.name}</span>
                </div>
            ))}
        </div>
    );
};

// ============================================================================
// EXEMPLE 2 : Carte avec compteur par type
// ============================================================================

export const TypeCard: React.FC<{ type: string; count: number; onClick?: () => void }> = ({ 
    type, 
    count, 
    onClick 
}) => {
    return (
        <div
            onClick={onClick}
            style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 8,
                padding: 16,
                border: '1px solid var(--theia-panel-border)',
                borderRadius: 4,
                cursor: onClick ? 'pointer' : 'default',
                background: 'var(--theia-editor-background)',
            }}
        >
            <GeocacheIcon type={type} size={48} />
            <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '0.85em', opacity: 0.8 }}>
                    {getIconByCacheType(type)?.label || type}
                </div>
                <div style={{ fontSize: '1.5em', fontWeight: 600 }}>
                    {count}
                </div>
            </div>
        </div>
    );
};

// ============================================================================
// EXEMPLE 3 : Statistiques en grille
// ============================================================================

export const TypeStatistics: React.FC<{ geocaches: Geocache[] }> = ({ geocaches }) => {
    const stats = React.useMemo(() => {
        const counts: Record<string, number> = {};
        geocaches.forEach(gc => {
            counts[gc.cache_type] = (counts[gc.cache_type] || 0) + 1;
        });
        return Object.entries(counts).sort((a, b) => b[1] - a[1]);
    }, [geocaches]);

    return (
        <div style={{ 
            display: 'grid', 
            gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
            gap: 12 
        }}>
            {stats.map(([type, count]) => (
                <TypeCard key={type} type={type} count={count} />
            ))}
        </div>
    );
};

// ============================================================================
// EXEMPLE 4 : Filtre de types avec sélection multiple
// ============================================================================

export const TypeFilter: React.FC<{
    selectedTypes: string[];
    onToggle: (key: string) => void;
}> = ({ selectedTypes, onToggle }) => {
    const icons = getAllIcons();

    return (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {icons.map(icon => {
                const isSelected = selectedTypes.includes(icon.key);
                return (
                    <button
                        key={icon.key}
                        onClick={() => onToggle(icon.key)}
                        title={icon.label}
                        style={{
                            padding: 8,
                            border: '2px solid',
                            borderColor: isSelected 
                                ? 'var(--theia-focusBorder)' 
                                : 'var(--theia-panel-border)',
                            borderRadius: 4,
                            background: isSelected 
                                ? 'var(--theia-list-activeSelectionBackground)' 
                                : 'transparent',
                            cursor: 'pointer',
                        }}
                    >
                        <GeocacheIcon iconKey={icon.key} size={28} />
                    </button>
                );
            })}
        </div>
    );
};

// ============================================================================
// EXEMPLE 5 : Badge avec icône
// ============================================================================

export const TypeBadge: React.FC<{ 
    type: string; 
    showCount?: boolean;
    count?: number;
}> = ({ type, showCount, count }) => {
    return (
        <div
            style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '4px 10px',
                background: 'var(--theia-badge-background)',
                color: 'var(--theia-badge-foreground)',
                borderRadius: 12,
                fontSize: '0.85em',
            }}
        >
            <GeocacheIcon type={type} size={18} />
            <span>{getIconByCacheType(type)?.label || type}</span>
            {showCount && count !== undefined && (
                <span style={{ 
                    fontWeight: 600,
                    marginLeft: 4,
                    padding: '0 4px',
                    background: 'rgba(255,255,255,0.2)',
                    borderRadius: 8,
                }}>
                    {count}
                </span>
            )}
        </div>
    );
};

// ============================================================================
// EXEMPLE 6 : Dropdown de sélection de type
// ============================================================================

export const TypeSelector: React.FC<{
    value: string;
    onChange: (type: string) => void;
}> = ({ value, onChange }) => {
    const icons = getAllIcons();

    return (
        <select
            value={value}
            onChange={(e) => onChange(e.target.value)}
            style={{
                padding: '6px 12px',
                background: 'var(--theia-input-background)',
                color: 'var(--theia-input-foreground)',
                border: '1px solid var(--theia-input-border)',
                borderRadius: 3,
            }}
        >
            <option value="">Sélectionner un type...</option>
            {icons.map(icon => (
                <option key={icon.key} value={icon.key}>
                    {icon.label}
                </option>
            ))}
        </select>
    );
};

// Alternative avec icônes visibles
export const TypeSelectorWithIcons: React.FC<{
    value: string;
    onChange: (type: string) => void;
}> = ({ value, onChange }) => {
    const icons = getAllIcons();
    const [isOpen, setIsOpen] = React.useState(false);

    return (
        <div style={{ position: 'relative' }}>
            <button
                onClick={() => setIsOpen(!isOpen)}
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '6px 12px',
                    background: 'var(--theia-input-background)',
                    color: 'var(--theia-input-foreground)',
                    border: '1px solid var(--theia-input-border)',
                    borderRadius: 3,
                    cursor: 'pointer',
                }}
            >
                {value ? (
                    <>
                        <GeocacheIcon iconKey={value} size={20} />
                        <span>{getIconByCacheType(value)?.label}</span>
                    </>
                ) : (
                    <span>Sélectionner un type...</span>
                )}
                <span style={{ marginLeft: 'auto' }}>▼</span>
            </button>

            {isOpen && (
                <div
                    style={{
                        position: 'absolute',
                        top: '100%',
                        left: 0,
                        right: 0,
                        marginTop: 4,
                        background: 'var(--theia-dropdown-background)',
                        border: '1px solid var(--theia-dropdown-border)',
                        borderRadius: 3,
                        maxHeight: 300,
                        overflow: 'auto',
                        zIndex: 1000,
                    }}
                >
                    {icons.map(icon => (
                        <div
                            key={icon.key}
                            onClick={() => {
                                onChange(icon.key);
                                setIsOpen(false);
                            }}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 8,
                                padding: '8px 12px',
                                cursor: 'pointer',
                                background: value === icon.key 
                                    ? 'var(--theia-list-activeSelectionBackground)' 
                                    : 'transparent',
                            }}
                        >
                            <GeocacheIcon iconKey={icon.key} size={24} />
                            <span>{icon.label}</span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

// ============================================================================
// EXEMPLE 7 : Légende complète
// ============================================================================

export const GeocacheTypeLegend: React.FC = () => {
    return (
        <div style={{ padding: 16 }}>
            <h3 style={{ marginTop: 0, marginBottom: 16 }}>
                Types de géocaches disponibles
            </h3>
            <GeocacheIconLegend columns={3} iconSize={28} />
        </div>
    );
};

// ============================================================================
// EXEMPLE 8 : Vue compacte pour tableaux
// ============================================================================

export const CompactTypeCell: React.FC<{ type: string }> = ({ type }) => {
    return (
        <div style={{ display: 'flex', justifyContent: 'center' }}>
            <GeocacheIcon type={type} size={28} />
        </div>
    );
};

// ============================================================================
// EXEMPLE 9 : Vue détaillée avec info
// ============================================================================

export const DetailedTypeView: React.FC<{ type: string }> = ({ type }) => {
    const icon = getIconByCacheType(type);

    if (!icon) {
        return <div>Type inconnu : {type}</div>;
    }

    return (
        <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: 12,
            background: 'var(--theia-editor-background)',
            border: '1px solid var(--theia-panel-border)',
            borderRadius: 4,
        }}>
            <GeocacheIcon iconKey={icon.key} size={48} />
            <div>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>
                    {icon.label}
                </div>
                <div style={{ fontSize: '0.85em', opacity: 0.7 }}>
                    Type : {type}
                </div>
            </div>
        </div>
    );
};

