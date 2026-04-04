import * as React from 'react';

export type CurveChannel = 'rgb' | 'red' | 'green' | 'blue' | 'luminosity';

export interface CurvePoint {
    x: number;
    y: number;
}

export interface CurvesEditorProps {
    channel: CurveChannel;
    points: CurvePoint[];
    onPointsChange: (points: CurvePoint[]) => void;
    onChannelChange: (channel: CurveChannel) => void;
    onReset: () => void;
    onApplyPreset: (preset: string) => void;
}

export const CurvesEditor: React.FC<CurvesEditorProps> = ({
    channel,
    points,
    onPointsChange,
    onChannelChange,
    onReset,
    onApplyPreset,
}) => {
    const canvasRef = React.useRef<HTMLCanvasElement>(null);
    const [draggingIndex, setDraggingIndex] = React.useState<number | null>(null);
    const [hoveredIndex, setHoveredIndex] = React.useState<number | null>(null);

    const CANVAS_SIZE = 256;
    const GRID_DIVISIONS = 4;
    const POINT_RADIUS = 5;

    const sortedPoints = React.useMemo(() => {
        return [...points].sort((a, b) => a.x - b.x);
    }, [points]);

    const getLUT = React.useCallback((): number[] => {
        const lut: number[] = [];
        const sorted = sortedPoints;

        for (let i = 0; i < 256; i++) {
            const x = i / 255;

            let idx = 0;
            while (idx < sorted.length - 1 && sorted[idx + 1].x < x) {
                idx++;
            }

            if (idx >= sorted.length - 1) {
                lut.push(Math.round(sorted[sorted.length - 1].y * 255));
            } else {
                const p0 = sorted[idx];
                const p1 = sorted[idx + 1];
                const t = (x - p0.x) / (p1.x - p0.x);
                const y = p0.y + t * (p1.y - p0.y);
                lut.push(Math.round(y * 255));
            }
        }

        return lut;
    }, [sortedPoints]);

    const drawCanvas = React.useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas) {
            return;
        }

        const ctx = canvas.getContext('2d');
        if (!ctx) {
            return;
        }

        ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

        ctx.fillStyle = '#1e1e1e';
        ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

        ctx.strokeStyle = '#333333';
        ctx.lineWidth = 1;
        for (let i = 1; i < GRID_DIVISIONS; i++) {
            const pos = (i * CANVAS_SIZE) / GRID_DIVISIONS;
            ctx.beginPath();
            ctx.moveTo(pos, 0);
            ctx.lineTo(pos, CANVAS_SIZE);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(0, pos);
            ctx.lineTo(CANVAS_SIZE, pos);
            ctx.stroke();
        }

        ctx.strokeStyle = '#555555';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, CANVAS_SIZE);
        ctx.lineTo(CANVAS_SIZE, 0);
        ctx.stroke();

        const lut = getLUT();
        ctx.strokeStyle = getChannelColor(channel);
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let i = 0; i < 256; i++) {
            const x = i;
            const y = CANVAS_SIZE - lut[i];
            if (i === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        }
        ctx.stroke();

        sortedPoints.forEach((point, index) => {
            const px = point.x * CANVAS_SIZE;
            const py = (1 - point.y) * CANVAS_SIZE;

            ctx.fillStyle = getChannelColor(channel);
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 2;

            if (index === hoveredIndex || index === draggingIndex) {
                ctx.beginPath();
                ctx.arc(px, py, POINT_RADIUS + 2, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();
            } else {
                ctx.beginPath();
                ctx.arc(px, py, POINT_RADIUS, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();
            }
        });
    }, [sortedPoints, channel, hoveredIndex, draggingIndex, getLUT]);

    React.useEffect(() => {
        drawCanvas();
    }, [drawCanvas]);

    const getChannelColor = (ch: CurveChannel): string => {
        switch (ch) {
            case 'red':
                return '#ff4444';
            case 'green':
                return '#44ff44';
            case 'blue':
                return '#4444ff';
            case 'luminosity':
                return '#cccccc';
            default:
                return '#ffffff';
        }
    };

    const canvasToPoint = (clientX: number, clientY: number): CurvePoint => {
        const canvas = canvasRef.current;
        if (!canvas) {
            return { x: 0, y: 0 };
        }

        const rect = canvas.getBoundingClientRect();
        const x = Math.max(0, Math.min(1, (clientX - rect.left) / CANVAS_SIZE));
        const y = Math.max(0, Math.min(1, 1 - (clientY - rect.top) / CANVAS_SIZE));

        return { x, y };
    };

    const findPointIndex = (clientX: number, clientY: number): number | null => {
        const canvas = canvasRef.current;
        if (!canvas) {
            return null;
        }

        const rect = canvas.getBoundingClientRect();
        const mx = clientX - rect.left;
        const my = clientY - rect.top;

        for (let i = 0; i < sortedPoints.length; i++) {
            const point = sortedPoints[i];
            const px = point.x * CANVAS_SIZE;
            const py = (1 - point.y) * CANVAS_SIZE;

            const dist = Math.sqrt((mx - px) ** 2 + (my - py) ** 2);
            if (dist <= POINT_RADIUS + 3) {
                return i;
            }
        }

        return null;
    };

    const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
        const index = findPointIndex(e.clientX, e.clientY);

        if (index !== null) {
            setDraggingIndex(index);
        } else {
            const point = canvasToPoint(e.clientX, e.clientY);
            const newPoints = [...points, point];
            onPointsChange(newPoints);
        }
    };

    const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
        if (draggingIndex !== null) {
            const point = canvasToPoint(e.clientX, e.clientY);
            const newPoints = [...points];

            const isFirstOrLast = draggingIndex === 0 || draggingIndex === sortedPoints.length - 1;
            if (isFirstOrLast) {
                newPoints[points.indexOf(sortedPoints[draggingIndex])] = {
                    x: sortedPoints[draggingIndex].x,
                    y: point.y,
                };
            } else {
                newPoints[points.indexOf(sortedPoints[draggingIndex])] = point;
            }

            onPointsChange(newPoints);
        } else {
            const index = findPointIndex(e.clientX, e.clientY);
            setHoveredIndex(index);
        }
    };

    const handleMouseUp = () => {
        setDraggingIndex(null);
    };

    const handleMouseLeave = () => {
        setDraggingIndex(null);
        setHoveredIndex(null);
    };

    const handleDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
        const index = findPointIndex(e.clientX, e.clientY);

        if (index !== null && index !== 0 && index !== sortedPoints.length - 1) {
            const pointToRemove = sortedPoints[index];
            const newPoints = points.filter(p => p !== pointToRemove);
            onPointsChange(newPoints);
        }
    };

    return (
        <div className='flex flex-col gap-2'>
            <div className='flex items-center gap-2 flex-wrap'>
                <label className='text-xs opacity-70'>
                    Canal
                    <select
                        className='ml-2 theia-input'
                        value={channel}
                        onChange={e => onChannelChange(e.target.value as CurveChannel)}
                    >
                        <option value='rgb'>RGB</option>
                        <option value='red'>Rouge</option>
                        <option value='green'>Vert</option>
                        <option value='blue'>Bleu</option>
                        <option value='luminosity'>Luminosité</option>
                    </select>
                </label>

                <button
                    type='button'
                    className='theia-button secondary'
                    onClick={onReset}
                >
                    Reset
                </button>

                <button
                    type='button'
                    className='theia-button secondary'
                    onClick={() => onApplyPreset('contrast')}
                >
                    Contraste
                </button>

                <button
                    type='button'
                    className='theia-button secondary'
                    onClick={() => onApplyPreset('invert')}
                >
                    Inverser
                </button>

                <button
                    type='button'
                    className='theia-button secondary'
                    onClick={() => onApplyPreset('brighten-shadows')}
                >
                    Éclaircir ombres
                </button>

                <button
                    type='button'
                    className='theia-button secondary'
                    onClick={() => onApplyPreset('darken-highlights')}
                >
                    Assombrir lumières
                </button>
            </div>

            <div className='flex items-start gap-2'>
                <canvas
                    ref={canvasRef}
                    width={CANVAS_SIZE}
                    height={CANVAS_SIZE}
                    className='border border-[var(--theia-panel-border)] cursor-crosshair'
                    onMouseDown={handleMouseDown}
                    onMouseMove={handleMouseMove}
                    onMouseUp={handleMouseUp}
                    onMouseLeave={handleMouseLeave}
                    onDoubleClick={handleDoubleClick}
                    style={{ width: CANVAS_SIZE, height: CANVAS_SIZE }}
                />

                <div className='text-xs opacity-70 flex-1'>
                    <div className='font-semibold mb-1'>Instructions:</div>
                    <ul className='list-disc list-inside space-y-1'>
                        <li>Cliquez pour ajouter un point</li>
                        <li>Glissez pour déplacer un point</li>
                        <li>Double-clic pour supprimer un point</li>
                        <li>Les points de début/fin ne bougent qu'en Y</li>
                    </ul>
                    <div className='mt-2'>
                        <div className='font-semibold mb-1'>Points: {points.length}</div>
                    </div>
                </div>
            </div>
        </div>
    );
};
