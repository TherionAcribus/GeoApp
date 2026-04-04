import * as React from 'react';

export interface SymbolItemProps {
    char: string;
    index: number;
    scale: number;
    size?: number;  // Taille de base en pixels (défaut: 96)
    fontFamily?: string;
    imagePath?: string;
    isDraggable?: boolean;
    showIndex?: boolean;
    /**
     * Affiche la "valeur" (caractère) sous le symbole.
     * Utile quand le symbole est rendu via une police (glyph) ou une image.
     */
    showValue?: boolean;
    /**
     * Libellé à afficher pour la valeur (par défaut: `char`).
     * Permet de personnaliser l'affichage (ex: espace -> ␠).
     */
    valueLabel?: string;
    compact?: boolean;  // Mode compact (case ajustée à la taille de la font)
    onDragStart?: (index: number) => void;
    onDragOver?: (index: number) => void;
    onDragEnd?: () => void;
    onContextMenu?: (e: React.MouseEvent, index: number) => void;
    onClick?: (char: string) => void;
}

/**
 * Composant pour afficher un symbole d'alphabet (avec drag & drop et menu contextuel).
 */
export class SymbolItem extends React.Component<SymbolItemProps> {

    private handleDragStart = (e: React.DragEvent) => {
        if (this.props.isDraggable && this.props.onDragStart) {
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', this.props.index.toString());
            this.props.onDragStart(this.props.index);
        }
    };

    private handleDragOver = (e: React.DragEvent) => {
        if (this.props.isDraggable && this.props.onDragOver) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            this.props.onDragOver(this.props.index);
        }
    };

    private handleDragEnd = () => {
        if (this.props.isDraggable && this.props.onDragEnd) {
            this.props.onDragEnd();
        }
    };

    private handleContextMenu = (e: React.MouseEvent) => {
        if (this.props.onContextMenu) {
            e.preventDefault();
            this.props.onContextMenu(e, this.props.index);
        }
    };

    private handleClick = () => {
        if (this.props.onClick) {
            this.props.onClick(this.props.char);
        }
    };

    render(): React.ReactNode {
        const { char, index, scale, size = 96, fontFamily, imagePath, isDraggable, showIndex, compact = false, showValue, valueLabel } = this.props;

        // En mode compact, la case s'adapte à la taille de la font
        const fontSize = compact ? Math.round(size * 0.42) : Math.round(size * 0.42);
        const baseSize = compact ? fontSize + 8 : size; // Font + petit padding en compact
        const valueText = valueLabel ?? (char === ' ' ? '␠' : char);
        const shouldShowValue = Boolean(showValue) && !showIndex;
        const valueFontSize = Math.max(10, Math.round(fontSize * 0.35));
        const valueLineHeightPx = Math.round(valueFontSize * 1.2);

        const symbolStyle = {
            width: `${baseSize * scale}px`,
            height: `${(baseSize + (shouldShowValue ? valueLineHeightPx + 6 : 0)) * scale}px`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexDirection: shouldShowValue ? 'column' : 'row',
            fontSize: `${fontSize * scale}px`,
            position: 'relative',
            cursor: isDraggable ? 'move' : (this.props.onClick ? 'pointer' : 'default'),
            backgroundColor: compact ? 'transparent' : 'var(--theia-input-background)',
            border: compact ? 'none' : '1px solid var(--theia-input-border)',
            borderRadius: compact ? '0px' : '2px',
            transition: 'all 0.2s',
            userSelect: 'none',
            margin: '0px'
        } as React.CSSProperties;

        const symbolContent = fontFamily ? (
            <span style={{
                fontFamily: `"${fontFamily}", monospace`,
                fontSize: `${fontSize * scale}px`
            } as React.CSSProperties}>
                {char}
            </span>
        ) : imagePath ? (
            <img
                src={imagePath}
                alt={char}
                style={{
                    maxWidth: '80%',
                    maxHeight: '80%',
                    objectFit: 'contain'
                } as React.CSSProperties}
            />
        ) : (
            <span>{char}</span>
        );

        return (
            <div
                draggable={isDraggable}
                onDragStart={this.handleDragStart}
                onDragOver={this.handleDragOver}
                onDragEnd={this.handleDragEnd}
                onContextMenu={this.handleContextMenu}
                onClick={this.handleClick}
                style={symbolStyle}
                title={showIndex ? `Position: ${index + 1}` : char}
                className='alphabet-symbol-item'
            >
                {symbolContent}
                {shouldShowValue && (
                    <span
                        style={{
                            marginTop: `${2 * scale}px` as unknown as React.CSSProperties['marginTop'],
                            fontSize: `${valueFontSize * scale}px` as unknown as React.CSSProperties['fontSize'],
                            lineHeight: 1,
                            fontFamily: 'var(--theia-ui-font-family)' as unknown as React.CSSProperties['fontFamily'],
                            color: 'var(--theia-descriptionForeground)' as unknown as React.CSSProperties['color'],
                            fontWeight: 400,
                            textAlign: 'center',
                            width: '100%',
                            display: 'block',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            padding: '0 2px'
                        } as React.CSSProperties}
                        title={valueText}
                    >
                        {valueText}
                    </span>
                )}
                {showIndex && (
                    <div style={{
                        position: 'absolute' as unknown as React.CSSProperties['position'],
                        bottom: '2px' as unknown as React.CSSProperties['bottom'],
                        right: '4px' as unknown as React.CSSProperties['right'],
                        fontSize: `${Math.max(10, Math.round(fontSize * 0.3)) * scale}px` as unknown as React.CSSProperties['fontSize'],
                        color: 'var(--theia-descriptionForeground)' as unknown as React.CSSProperties['color'],
                        fontWeight: 'bold' as unknown as React.CSSProperties['fontWeight'],
                        backgroundColor: 'var(--theia-editor-background)' as unknown as React.CSSProperties['backgroundColor'],
                        padding: '1px 3px' as unknown as React.CSSProperties['padding'],
                        borderRadius: '2px' as unknown as React.CSSProperties['borderRadius'],
                        lineHeight: 1
                    } as React.CSSProperties}>
                        {index + 1}
                    </div>
                )}
            </div>
        );
    }
}

