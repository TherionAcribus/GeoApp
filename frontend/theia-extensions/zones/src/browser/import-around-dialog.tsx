/**
 * Dialog React pour importer en masse des géocaches autour d'un point ou d'une géocache.
 */

import * as React from 'react';
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
        map.set('size', ['Nano', 'Micro', 'Small', 'Regular', 'Large', 'Virtual', 'Other']);
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
            return;
        }
        resetProgress();
        await onImport(request, handleProgressUpdate);
    };

    const requestValid = Boolean(buildRequest());

    return (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/50" onClick={onCancel}>
            <div
                className="w-[560px] max-w-[95vw] rounded-lg border border-[var(--theia-panel-border)] bg-[var(--theia-editor-background)] p-6 shadow-lg"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="mb-4 flex items-center justify-between">
                    <h3 className="m-0 text-[18px] text-[var(--theia-foreground)]">Importer autour…</h3>
                    <button
                        onClick={onCancel}
                        disabled={isImporting}
                        className="p-1 text-[var(--theia-foreground)] disabled:cursor-not-allowed disabled:opacity-50"
                        type="button"
                    >
                        ✕
                    </button>
                </div>

                <p className="mb-3 text-[12px] text-[var(--theia-descriptionForeground)]">Zone cible: {zoneId}</p>

                <form onSubmit={handleSubmit}>
                    <div className="mb-3 flex flex-wrap gap-3">
                        <label className="flex items-center gap-2 text-[13px]">
                            <input
                                type="radio"
                                checked={mode === 'point'}
                                onChange={() => setMode('point')}
                                disabled={isImporting}
                            />
                            <span className="text-[var(--theia-foreground)]">Autour d’un point</span>
                        </label>
                        <label className="flex items-center gap-2 text-[13px]">
                            <input
                                type="radio"
                                checked={mode === 'gc_code'}
                                onChange={() => setMode('gc_code')}
                                disabled={isImporting}
                            />
                            <span className="text-[var(--theia-foreground)]">Autour d’un GC code</span>
                        </label>
                        <label className="flex items-center gap-2 text-[13px]">
                            <input
                                type="radio"
                                checked={mode === 'geocache_id'}
                                onChange={() => setMode('geocache_id')}
                                disabled={isImporting}
                            />
                            <span className="text-[var(--theia-foreground)]">Autour d’une géocache locale</span>
                        </label>
                    </div>

                    {mode === 'point' && (
                        <div className="mb-3 flex gap-3">
                            <div className="flex-1">
                                <label className="mb-1.5 block text-[13px] text-[var(--theia-foreground)]">Latitude</label>
                                <input
                                    value={lat}
                                    onChange={(e) => setLat(e.target.value)}
                                    disabled={isImporting}
                                    placeholder="48.8566"
                                    className="w-full rounded border border-[var(--theia-input-border)] bg-[var(--theia-input-background)] px-2 py-2 text-[var(--theia-input-foreground)]"
                                />
                            </div>
                            <div className="flex-1">
                                <label className="mb-1.5 block text-[13px] text-[var(--theia-foreground)]">Longitude</label>
                                <input
                                    value={lon}
                                    onChange={(e) => setLon(e.target.value)}
                                    disabled={isImporting}
                                    placeholder="2.3522"
                                    className="w-full rounded border border-[var(--theia-input-border)] bg-[var(--theia-input-background)] px-2 py-2 text-[var(--theia-input-foreground)]"
                                />
                            </div>
                        </div>
                    )}

                    {mode === 'gc_code' && (
                        <div className="mb-3">
                            <label className="mb-1.5 block text-[13px] text-[var(--theia-foreground)]">GC code</label>
                            <input
                                value={gcCode}
                                onChange={(e) => setGcCode(e.target.value)}
                                disabled={isImporting}
                                placeholder="GC12345"
                                className="w-full rounded border border-[var(--theia-input-border)] bg-[var(--theia-input-background)] px-2 py-2 text-[var(--theia-input-foreground)]"
                            />
                        </div>
                    )}

                    {mode === 'geocache_id' && (
                        <div className="mb-3 flex gap-3">
                            <div className="flex-1">
                                <label className="mb-1.5 block text-[13px] text-[var(--theia-foreground)]">Geocache ID</label>
                                <input
                                    value={geocacheId}
                                    onChange={(e) => setGeocacheId(e.target.value)}
                                    disabled={isImporting}
                                    placeholder="123"
                                    className="w-full rounded border border-[var(--theia-input-border)] bg-[var(--theia-input-background)] px-2 py-2 text-[var(--theia-input-foreground)]"
                                />
                            </div>
                            <div className="flex-1">
                                <label className="mb-1.5 block text-[13px] text-[var(--theia-foreground)]">(Optionnel) GC code</label>
                                <input
                                    value={gcCode}
                                    onChange={(e) => setGcCode(e.target.value)}
                                    disabled={isImporting}
                                    placeholder="GC12345"
                                    className="w-full rounded border border-[var(--theia-input-border)] bg-[var(--theia-input-background)] px-2 py-2 text-[var(--theia-input-foreground)]"
                                />
                            </div>
                        </div>
                    )}

                    <div className="mb-3">
                        <label className="mb-1.5 block text-[13px] text-[var(--theia-foreground)]">Limite</label>
                        <input
                            value={limit}
                            onChange={(e) => setLimit(e.target.value)}
                            disabled={isImporting}
                            placeholder="50"
                            className="w-full rounded border border-[var(--theia-input-border)] bg-[var(--theia-input-background)] px-2 py-2 text-[var(--theia-input-foreground)]"
                        />
                    </div>

                    <div className="mb-3">
                        <label className="mb-1.5 block text-[13px] text-[var(--theia-foreground)]">
                            Filtres <span className="text-[var(--theia-descriptionForeground)]">(distance, type, difficulté…)</span>
                        </label>
                        <p className="mb-2 text-[11px] text-[var(--theia-descriptionForeground)]">
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
                        <div className="mb-4">
                            <div className="mb-1 flex justify-between">
                                <span className="text-[13px] text-[var(--theia-foreground)]">Progression</span>
                                <span className="text-[13px] text-[var(--theia-descriptionForeground)]">{progressPercentage}%</span>
                            </div>
                            <div className="h-2 w-full overflow-hidden rounded bg-[var(--theia-progressBar-background)]">
                                <div
                                    className="h-full bg-[var(--theia-progressBar-foreground)] transition-[width] duration-300"
                                    style={{ width: `${progressPercentage}%` }}
                                />
                            </div>
                            {progressMessage && (
                                <p className="mt-1 text-[12px] text-[var(--theia-descriptionForeground)]">{progressMessage}</p>
                            )}
                        </div>
                    )}

                    <div className="flex justify-end gap-2">
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
                            className="theia-button flex items-center gap-2"
                        >
                            <span>Importer</span>
                            {isImporting && (
                                <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                            )}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};
