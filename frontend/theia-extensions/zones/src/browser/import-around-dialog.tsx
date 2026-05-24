/**
 * Dialog React pour importer en masse des géocaches autour d'un point ou d'une géocache.
 */

import * as React from 'react';
import * as ReactDOM from 'react-dom';
import { GeocacheFilterBar } from './geocache-filter-bar';
import {
    AdvancedFilterClause,
    DISTANCE_KM_FIELD_DEFINITION,
    STANDARD_GEOCACHE_FIELD_DEFINITIONS,
    TokenFilter,
    parseSearchQuery,
} from './geocache-filter-shared';

export type ImportAroundCenter =
    | { type: 'point'; lat: number; lon: number }
    | { type: 'geocache_id'; geocache_id: number; gc_code?: string; name?: string }
    | { type: 'gc_code'; gc_code: string };

export interface ImportAroundRequest {
    center: ImportAroundCenter;
    limit: number;
    radius_km?: number;
    min_km?: number;
    filters?: TokenFilter[];
}

export interface ImportAroundDialogProps {
    zoneId: number;
    initialCenter?: ImportAroundCenter;
    onImport: (
        request: ImportAroundRequest,
        onProgress?: (percentage: number, message: string) => void
    ) => Promise<void>;
    onCancel: () => void;
    isImporting: boolean;
}

export const ImportAroundDialog: React.FC<ImportAroundDialogProps> = ({
    zoneId,
    initialCenter,
    onImport,
    onCancel,
    isImporting
}) => {
    const [mode, setMode] = React.useState<'point' | 'geocache_id' | 'gc_code'>(() => {
        if (!initialCenter) {
            return 'point';
        }
        return initialCenter.type;
    });

    const [lat, setLat] = React.useState<string>(() => {
        if (initialCenter?.type === 'point') {
            return String(initialCenter.lat);
        }
        return '';
    });

    const [lon, setLon] = React.useState<string>(() => {
        if (initialCenter?.type === 'point') {
            return String(initialCenter.lon);
        }
        return '';
    });

    const [gcCode, setGcCode] = React.useState<string>(() => {
        if (initialCenter?.type === 'gc_code') {
            return initialCenter.gc_code;
        }
        if (initialCenter?.type === 'geocache_id' && initialCenter.gc_code) {
            return initialCenter.gc_code;
        }
        return '';
    });

    const [geocacheId, setGeocacheId] = React.useState<string>(() => {
        if (initialCenter?.type === 'geocache_id') {
            return String(initialCenter.geocache_id);
        }
        return '';
    });

    const [limit, setLimit] = React.useState<string>('50');
    const [filterQuery, setFilterQuery] = React.useState<string>('');
    const [filterClauses, setFilterClauses] = React.useState<AdvancedFilterClause[]>([]);

    const [progressVisible, setProgressVisible] = React.useState(false);
    const [progressPercentage, setProgressPercentage] = React.useState(0);
    const [progressMessage, setProgressMessage] = React.useState('');

    const filterFieldDefinitions = React.useMemo(
        () => [DISTANCE_KM_FIELD_DEFINITION, ...STANDARD_GEOCACHE_FIELD_DEFINITIONS],
        []
    );

    const filterEnumOptions = React.useMemo(() => {
        const map = new Map<string, string[]>();
        map.set('cache_type', ['Traditional', 'Mystery', 'Multi', 'EarthCache', 'Wherigo', 'Virtual', 'Letterbox']);
        map.set('size', ['Micro', 'Small', 'Regular', 'Large', 'Virtual', 'Not chosen', 'Other']);
        map.set('solved', ['not_solved', 'in_progress', 'solved']);
        map.set('found', ['true', 'false']);
        return map;
    }, []);

    const handleProgressUpdate = React.useCallback((percentage: number, message: string) => {
        setProgressPercentage(percentage);
        setProgressMessage(message);
        setProgressVisible(true);
    }, []);

    const resetProgress = React.useCallback(() => {
        setProgressVisible(false);
        setProgressPercentage(0);
        setProgressMessage('');
    }, []);

    const buildRequest = React.useCallback((): ImportAroundRequest | null => {
        const parsedLimit = parseInt(limit, 10);
        if (!Number.isFinite(parsedLimit) || parsedLimit <= 0) {
            return null;
        }

        const allTokens: TokenFilter[] = [];
        const { tokenFilters } = parseSearchQuery(filterQuery);
        for (const t of tokenFilters) {
            allTokens.push(t);
        }
        for (const c of filterClauses) {
            allTokens.push({ field: c.field, operator: c.operator, value: c.value, value2: c.value2, values: c.values });
        }

        let radius_km: number | undefined;
        let min_km: number | undefined;
        const geocacheFilters: TokenFilter[] = [];

        for (const t of allTokens) {
            if (t.field === 'distance_km') {
                const op = t.operator;
                if (op === 'lte' || op === 'lt' || op === 'eq') {
                    const v = parseFloat(t.value ?? '');
                    if (Number.isFinite(v) && v > 0) {
                        radius_km = v;
                    }
                } else if (op === 'gte' || op === 'gt') {
                    const v = parseFloat(t.value ?? '');
                    if (Number.isFinite(v) && v >= 0) {
                        min_km = v;
                    }
                } else if (op === 'between') {
                    const v1 = parseFloat(t.value ?? '');
                    const v2 = parseFloat(t.value2 ?? '');
                    if (Number.isFinite(v1) && Number.isFinite(v2)) {
                        min_km = Math.min(v1, v2);
                        radius_km = Math.max(v1, v2);
                    }
                }
            } else {
                geocacheFilters.push(t);
            }
        }

        if (mode === 'point') {
            const latValue = Number(lat);
            const lonValue = Number(lon);
            if (!Number.isFinite(latValue) || !Number.isFinite(lonValue)) {
                return null;
            }
            return {
                center: { type: 'point', lat: latValue, lon: lonValue },
                limit: parsedLimit,
                ...(radius_km !== undefined ? { radius_km } : {}),
                ...(min_km !== undefined ? { min_km } : {}),
                ...(geocacheFilters.length > 0 ? { filters: geocacheFilters } : {}),
            };
        }

        if (mode === 'geocache_id') {
            const idValue = parseInt(geocacheId, 10);
            if (!Number.isFinite(idValue) || idValue <= 0) {
                return null;
            }
            return {
                center: {
                    type: 'geocache_id',
                    geocache_id: idValue,
                    ...(gcCode.trim() ? { gc_code: gcCode.trim().toUpperCase() } : {})
                },
                limit: parsedLimit,
                ...(radius_km !== undefined ? { radius_km } : {}),
                ...(min_km !== undefined ? { min_km } : {}),
                ...(geocacheFilters.length > 0 ? { filters: geocacheFilters } : {}),
            };
        }

        const code = gcCode.trim().toUpperCase();
        if (!code) {
            return null;
        }
        return {
            center: { type: 'gc_code', gc_code: code },
            limit: parsedLimit,
            ...(radius_km !== undefined ? { radius_km } : {}),
            ...(min_km !== undefined ? { min_km } : {}),
            ...(geocacheFilters.length > 0 ? { filters: geocacheFilters } : {}),
        };
    }, [gcCode, geocacheId, lat, limit, lon, mode, filterQuery, filterClauses]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const request = buildRequest();
        if (!request) {
            console.warn('[ImportAroundDialog] buildRequest() returned null — invalid form state');
            return;
        }
        console.log('[ImportAroundDialog] submitting request:', JSON.stringify(request, null, 2));
        resetProgress();
        await onImport(request, handleProgressUpdate);
    };

    const requestValid = Boolean(buildRequest());

    const overlayStyle: React.CSSProperties = {
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 10000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0, 0, 0, 0.5)',
    };

    const panelStyle: React.CSSProperties = {
        width: 560,
        maxWidth: '95vw',
        maxHeight: '90vh',
        overflowY: 'auto',
        borderRadius: 8,
        border: '1px solid var(--theia-panel-border)',
        background: 'var(--theia-editor-background)',
        padding: 24,
        boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4)',
    };

    const inputStyle: React.CSSProperties = {
        width: '100%',
        borderRadius: 3,
        border: '1px solid var(--theia-input-border)',
        background: 'var(--theia-input-background)',
        color: 'var(--theia-input-foreground)',
        padding: '6px 8px',
    };

    const labelStyle: React.CSSProperties = {
        display: 'block',
        marginBottom: 4,
        fontSize: 13,
        color: 'var(--theia-foreground)',
    };

    const dialog = (
        <div style={overlayStyle} onMouseDown={onCancel}>
            <div style={panelStyle} onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
                <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <h3 style={{ margin: 0, fontSize: 18, color: 'var(--theia-foreground)' }}>Importer autour…</h3>
                    <button
                        onClick={onCancel}
                        disabled={isImporting}
                        style={{ padding: 4, background: 'none', border: 'none', color: 'var(--theia-foreground)', cursor: 'pointer', fontSize: 16 }}
                        type="button"
                    >
                        ✕
                    </button>
                </div>

                <p style={{ marginBottom: 12, fontSize: 12, color: 'var(--theia-descriptionForeground)' }}>Zone cible: {zoneId}</p>

                <form onSubmit={handleSubmit}>
                    <div style={{ marginBottom: 12, display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                            <input
                                type="radio"
                                checked={mode === 'point'}
                                onChange={() => setMode('point')}
                                disabled={isImporting}
                            />
                            <span style={{ color: 'var(--theia-foreground)' }}>Autour d'un point</span>
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                            <input
                                type="radio"
                                checked={mode === 'gc_code'}
                                onChange={() => setMode('gc_code')}
                                disabled={isImporting}
                            />
                            <span style={{ color: 'var(--theia-foreground)' }}>Autour d'un GC code</span>
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                            <input
                                type="radio"
                                checked={mode === 'geocache_id'}
                                onChange={() => setMode('geocache_id')}
                                disabled={isImporting}
                            />
                            <span style={{ color: 'var(--theia-foreground)' }}>Autour d'une géocache locale</span>
                        </label>
                    </div>

                    {mode === 'point' && (
                        <div style={{ marginBottom: 12, display: 'flex', gap: 12 }}>
                            <div style={{ flex: 1 }}>
                                <label style={labelStyle}>Latitude</label>
                                <input
                                    value={lat}
                                    onChange={(e) => setLat(e.target.value)}
                                    disabled={isImporting}
                                    placeholder="48.8566"
                                    style={inputStyle}
                                />
                            </div>
                            <div style={{ flex: 1 }}>
                                <label style={labelStyle}>Longitude</label>
                                <input
                                    value={lon}
                                    onChange={(e) => setLon(e.target.value)}
                                    disabled={isImporting}
                                    placeholder="2.3522"
                                    style={inputStyle}
                                />
                            </div>
                        </div>
                    )}

                    {mode === 'gc_code' && (
                        <div style={{ marginBottom: 12 }}>
                            <label style={labelStyle}>GC code</label>
                            <input
                                value={gcCode}
                                onChange={(e) => setGcCode(e.target.value)}
                                disabled={isImporting}
                                placeholder="GC12345"
                                style={inputStyle}
                            />
                        </div>
                    )}

                    {mode === 'geocache_id' && (
                        <div style={{ marginBottom: 12, display: 'flex', gap: 12 }}>
                            <div style={{ flex: 1 }}>
                                <label style={labelStyle}>Geocache ID</label>
                                <input
                                    value={geocacheId}
                                    onChange={(e) => setGeocacheId(e.target.value)}
                                    disabled={isImporting}
                                    placeholder="123"
                                    style={inputStyle}
                                />
                            </div>
                            <div style={{ flex: 1 }}>
                                <label style={labelStyle}>(Optionnel) GC code</label>
                                <input
                                    value={gcCode}
                                    onChange={(e) => setGcCode(e.target.value)}
                                    disabled={isImporting}
                                    placeholder="GC12345"
                                    style={inputStyle}
                                />
                            </div>
                        </div>
                    )}

                    <div style={{ marginBottom: 12 }}>
                        <label style={labelStyle}>Nombre de géocaches à importer</label>
                        <input
                            type="number"
                            min="1"
                            max="200"
                            value={limit}
                            onChange={(e) => setLimit(e.target.value)}
                            disabled={isImporting}
                            placeholder="50"
                            style={inputStyle}
                        />
                        <p style={{ marginTop: 4, fontSize: 11, color: 'var(--theia-descriptionForeground)' }}>
                            Avec filtres : recherche parmi ~{Math.min(200, Math.max(parseInt(limit) * 10 || 100, 100))} candidats dans un rayon de 50 km max.
                        </p>
                    </div>

                    <div style={{ marginBottom: 12 }}>
                        <label style={labelStyle}>
                            Filtres <span style={{ color: 'var(--theia-descriptionForeground)' }}>(distance, type, difficulté…)</span>
                        </label>
                        <p style={{ marginBottom: 8, fontSize: 11, color: 'var(--theia-descriptionForeground)' }}>
                            Utilisez <code>@distance:&lt;=5</code> pour limiter le rayon en km, ou ajoutez des filtres via "Filtres supplémentaires".
                        </p>
                        <GeocacheFilterBar
                            searchQuery={filterQuery}
                            advancedClauses={filterClauses}
                            onSearchQueryChange={setFilterQuery}
                            onAdvancedClausesChange={setFilterClauses}
                            fieldDefinitions={filterFieldDefinitions}
                            enumOptionsByField={filterEnumOptions}
                            placeholder="@distance:<=5 @type:Traditional…"
                            disabled={isImporting}
                        />
                    </div>

                    {progressVisible && (
                        <div style={{ marginBottom: 16 }}>
                            <div style={{ marginBottom: 4, display: 'flex', justifyContent: 'space-between' }}>
                                <span style={{ fontSize: 13, color: 'var(--theia-foreground)' }}>Progression</span>
                                <span style={{ fontSize: 13, color: 'var(--theia-descriptionForeground)' }}>{progressPercentage}%</span>
                            </div>
                            <div style={{ height: 6, width: '100%', overflow: 'hidden', borderRadius: 3, background: 'var(--theia-progressBar-background)' }}>
                                <div
                                    style={{ height: '100%', width: `${progressPercentage}%`, background: 'var(--theia-progressBar-foreground)', transition: 'width 0.3s' }}
                                />
                            </div>
                            {progressMessage && (
                                <p style={{ marginTop: 4, fontSize: 12, color: 'var(--theia-descriptionForeground)' }}>{progressMessage}</p>
                            )}
                        </div>
                    )}

                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                        <button
                            type="button"
                            onClick={onCancel}
                            disabled={isImporting}
                            className="theia-button secondary"
                        >
                            Annuler
                        </button>
                        <button
                            type="submit"
                            disabled={!requestValid || isImporting}
                            className="theia-button"
                            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                        >
                            <span>Importer</span>
                            {isImporting && (
                                <div style={{ width: 14, height: 14, border: '2px solid currentColor', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                            )}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );

    return ReactDOM.createPortal(dialog, document.body);
};
