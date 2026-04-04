/**
 * Composant React pour afficher les icônes de géocaches
 * 
 * Ce composant utilise le sprite sheet des géocaches pour afficher les icônes
 * de manière optimisée. Il supporte plusieurs tailles et modes d'affichage.
 */

import * as React from 'react';
import { 
    GEOCACHE_SPRITE_CONFIG, 
    getIconByCacheType, 
    getIconByKey,
    GeocacheIconDefinition 
} from './geocache-icon-config';

/**
 * Props du composant GeocacheIcon
 */
export interface GeocacheIconProps {
    /** Type de géocache (ex: 'Traditional Cache') ou clé directe (ex: 'traditional') */
    type?: string;
    /** Clé d'icône directe (alternative à type) */
    iconKey?: string;
    /** Taille de l'icône en pixels (default: 24) */
    size?: number;
    /** Titre à afficher au survol (default: le label du type) */
    title?: string;
    /** Style CSS supplémentaire */
    style?: React.CSSProperties;
    /** Classe CSS supplémentaire */
    className?: string;
    /** Afficher le label à côté de l'icône */
    showLabel?: boolean;
    /** Style du label */
    labelStyle?: React.CSSProperties;
}

/**
 * Composant pour afficher une icône de géocache
 * 
 * @example
 * ```tsx
 * // Utilisation avec le type complet
 * <GeocacheIcon type="Traditional Cache" size={32} />
 * 
 * // Utilisation avec la clé
 * <GeocacheIcon iconKey="traditional" size={24} />
 * 
 * // Avec label
 * <GeocacheIcon type="Multi-Cache" showLabel />
 * ```
 */
export const GeocacheIcon: React.FC<GeocacheIconProps> = ({
    type,
    iconKey,
    size = 24,
    title,
    style,
    className,
    showLabel = false,
    labelStyle,
}) => {
    // Récupérer la définition de l'icône
    const iconDef = React.useMemo(() => {
        if (iconKey) {
            return getIconByKey(iconKey);
        }
        if (type) {
            return getIconByCacheType(type);
        }
        return undefined;
    }, [type, iconKey]);

    // Si aucune icône n'est trouvée, afficher un placeholder
    if (!iconDef) {
        return (
            <div
                style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    ...style,
                } as any}
                className={className}
                title={title || type || 'Type inconnu'}
            >
                <span
                    style={{
                        display: 'inline-block',
                        width: size,
                        height: size,
                        background: '#999',
                        borderRadius: '50%',
                        fontSize: size * 0.6,
                        lineHeight: `${size}px`,
                        textAlign: 'center',
                        color: '#fff',
                    } as any}
                >
                    ?
                </span>
                {showLabel && (
                    <span style={{ fontSize: '0.9em', ...labelStyle } as any}>
                        {type || 'Inconnu'}
                    </span>
                )}
            </div>
        );
    }

    // Calculer le ratio de mise à l'échelle
    const scale = size / iconDef.w;
    const scaledWidth = iconDef.w * scale;
    const scaledHeight = iconDef.h * scale;

    const iconStyle: React.CSSProperties = {
        display: 'inline-block',
        width: scaledWidth,
        height: scaledHeight,
        backgroundImage: `url(${GEOCACHE_SPRITE_CONFIG.url})`,
        backgroundPosition: `-${iconDef.x * scale}px -${iconDef.y * scale}px`,
        backgroundSize: `${GEOCACHE_SPRITE_CONFIG.sheetWidth * scale}px ${GEOCACHE_SPRITE_CONFIG.sheetHeight * scale}px`,
        backgroundRepeat: 'no-repeat',
        verticalAlign: 'middle',
    };

    if (!showLabel) {
        return (
            <span
                style={{ ...iconStyle, ...style } as any}
                className={className}
                title={title || iconDef.label}
            />
        );
    }

    return (
        <div
            style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                ...style,
            } as any}
            className={className}
            title={title || iconDef.label}
        >
            <span style={iconStyle as any} />
            <span style={{ fontSize: '0.9em', ...labelStyle } as any}>
                {iconDef.label}
            </span>
        </div>
    );
};

/**
 * Hook personnalisé pour obtenir la définition d'une icône
 * 
 * @param type - Type de géocache ou clé d'icône
 * @returns La définition de l'icône ou undefined
 * 
 * @example
 * ```tsx
 * const MyComponent = ({ cacheType }) => {
 *   const icon = useGeocacheIcon(cacheType);
 *   
 *   if (!icon) {
 *     return <div>Type inconnu</div>;
 *   }
 *   
 *   return <div>{icon.label}</div>;
 * };
 * ```
 */
export function useGeocacheIcon(type?: string): GeocacheIconDefinition | undefined {
    return React.useMemo(() => {
        if (!type) return undefined;
        
        // Essayer d'abord comme clé
        let icon = getIconByKey(type);
        if (icon) return icon;
        
        // Sinon essayer comme type de cache
        return getIconByCacheType(type);
    }, [type]);
}

/**
 * Composant pour afficher une légende des types de géocaches
 * 
 * @example
 * ```tsx
 * <GeocacheIconLegend columns={3} />
 * ```
 */
export interface GeocacheIconLegendProps {
    /** Nombre de colonnes (default: 2) */
    columns?: number;
    /** Taille des icônes (default: 24) */
    iconSize?: number;
    /** Style du conteneur */
    style?: React.CSSProperties;
}

export const GeocacheIconLegend: React.FC<GeocacheIconLegendProps> = ({
    columns = 2,
    iconSize = 24,
    style,
}) => {
    const items = GEOCACHE_SPRITE_CONFIG.items;

    return (
        <div
            style={{
                display: 'grid',
                gridTemplateColumns: `repeat(${columns}, 1fr)`,
                gap: 12,
                padding: 16,
                ...style,
            } as any}
        >
            {items.map(item => (
                <div
                    key={item.key}
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                    }}
                >
                    <GeocacheIcon iconKey={item.key} size={iconSize} />
                    <span style={{ fontSize: '0.9em' }}>{item.label}</span>
                </div>
            ))}
        </div>
    );
};

