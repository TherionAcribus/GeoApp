import * as React from '@theia/core/shared/react';
import { MessageService } from '@theia/core/lib/common/message-service';
import { PluginResult } from '../common/plugin-protocol';
import { PluginsService } from '../common/plugin-protocol';
import type { PluginExecutorMode, GeocacheContext } from './plugin-executor-widget';
import { extractDecimalCoordinates, deriveCoordinatesFromItem } from './plugin-executor-coords-utils';

export interface AddWaypointEventDetail {
    gcCoords: string;
    pluginName?: string;
    geocache?: {
        gcCode: string;
        name?: string;
    };
    sourceResultText?: string;
    waypointTitle?: string;
    waypointNote?: string;
    autoSave?: boolean;
    decimalLatitude?: number;
    decimalLongitude?: number;
}

export const PluginResultDisplay: React.FC<{
    result: PluginResult;
    configMode: PluginExecutorMode;
    geocacheContext?: GeocacheContext;
    pluginName?: string | null;
    pluginsService: PluginsService;
    onRequestAddWaypoint?: (detail: AddWaypointEventDetail) => void;
    onVerifyCoordinates?: (coords?: { formatted?: string; latitude?: string; longitude?: string }) => Promise<{ status?: 'success' | 'failure' | 'unknown'; message?: string }>;
    onSetAsCorrectedCoords?: (gcCoords: string) => Promise<void>;
    messageService: MessageService;
}> = ({ result, configMode, geocacheContext, pluginName, pluginsService, onRequestAddWaypoint, onVerifyCoordinates, onSetAsCorrectedCoords, messageService }) => {
    console.log('=== PluginResultDisplay RENDER ===');
    console.log('Received result:', result);
    console.log('result.results:', result.results);
    console.log('result.summary:', result.summary);

    const [verifiedCoordinates, setVerifiedCoordinates] = React.useState<Record<string, { status?: string; message?: string }>>({});
    const [verifyingCoordinates, setVerifyingCoordinates] = React.useState<Record<string, boolean>>({});
    const [detectingCoordinates, setDetectingCoordinates] = React.useState<Record<string, boolean>>({});
    const [manualDetectedCoordinates, setManualDetectedCoordinates] = React.useState<Record<string, { latitude?: string; longitude?: string; formatted?: string }>>({});
    const dispatchedCoordinatesRef = React.useRef<Set<string>>(new Set());

    // Vérifications de sécurité
    if (!result) {
        console.error('PluginResultDisplay: result is null/undefined');
        return <div>Erreur: Aucun résultat à afficher</div>;
    }

    // Fonction pour copier du texte dans le presse-papier
    const copyToClipboard = (text: string) => {
        navigator.clipboard.writeText(text);
    };

    const toPercent = (value: any): number => {
        const v = typeof value === 'number' ? value : Number(value);
        if (!Number.isFinite(v)) {
            return 0;
        }
        return Math.max(0, Math.min(100, Math.round(v * 100)));
    };

    const getScoreColor = (score: any): string => {
        const v = typeof score === 'number' ? score : Number(score);
        if (!Number.isFinite(v)) {
            return 'var(--theia-editor-background)';
        }
        if (v >= 0.8) {
            return 'var(--theia-button-background)';
        }
        if (v >= 0.5) {
            return 'var(--theia-list-hoverBackground)';
        }
        return 'var(--theia-editor-background)';
    };
    
    // Trier les résultats par confiance (décroissante) si disponible
    let sortedResults: any[] = [];
    try {
        sortedResults = result.results ? [...result.results].sort((a, b) => {
            const confA = a.confidence ?? 0;
            const confB = b.confidence ?? 0;
            return confB - confA;
        }) : [];
        console.log('sortedResults:', sortedResults);
    } catch (error) {
        console.error('Erreur lors du tri des résultats:', error);
        sortedResults = result.results || [];
    }

    const isBruteForce = sortedResults.length > 5; // Considérer comme brute-force si plus de 5 résultats
    const canRequestWaypoint = configMode === 'geocache' && !!geocacheContext && !!onRequestAddWaypoint;
    const canVerifyCoordinates = configMode === 'geocache' && !!geocacheContext?.checkers?.length && !!onVerifyCoordinates;
    const canSetAsCorrectedCoords = configMode === 'geocache' && !!geocacheContext?.geocacheId && !!onSetAsCorrectedCoords;

    const getCoordsKey = (coords?: { formatted?: string; latitude?: string; longitude?: string }): string => {
        if (!coords) {
            return '';
        }
        const formatted = (coords.formatted || '').toString().trim();
        if (formatted) {
            return formatted;
        }
        const lat = (coords.latitude || '').toString().trim();
        const lon = (coords.longitude || '').toString().trim();
        return `${lat} ${lon}`.trim();
    };

    const getItemKey = (item: any, index: number): string => {
        const id = (item && (item.id || item._id)) ? String(item.id || item._id) : '';
        if (id) {
            return id;
        }
        const text = (item && item.text_output) ? String(item.text_output).slice(0, 40) : '';
        return `${pluginName || 'result'}_${index}_${text}`;
    };

    const buildOriginCoords = (): { ddm_lat: string; ddm_lon: string } | undefined => {
        if (!geocacheContext?.coordinates?.latitude || !geocacheContext?.coordinates?.longitude) {
            return undefined;
        }
        return {
            ddm_lat: `N ${geocacheContext.coordinates.latitude}`,
            ddm_lon: `E ${geocacheContext.coordinates.longitude}`
        };
    };

    const buildGcCoords = (coords?: {
        latitude?: number | string;
        longitude?: number | string;
        formatted?: string;
    }): string | null => {
        if (!coords) {
            return null;
        }
        if (coords.latitude && coords.longitude) {
            return `${coords.latitude}, ${coords.longitude}`;
        }
        if (coords.formatted) {
            // Assurer un séparateur virgule pour WaypointsEditor
            const formatted = coords.formatted.trim();
            if (formatted.includes(',')) {
                return formatted;
            }
            const compact = formatted.replace(/\s+/g, ' ').trim();
            const tokens = compact.split(' ');
            if (tokens.length >= 4) {
                const latPart = tokens.slice(0, 2).join(' ');
                const lonPart = tokens.slice(2).join(' ');
                return `${latPart}, ${lonPart}`;
            }
            return formatted;
        }
        return null;
    };

    React.useEffect(() => {
        dispatchedCoordinatesRef.current.clear();
    }, [result, geocacheContext?.gcCode, geocacheContext?.geocacheId]);

    React.useEffect(() => {
        if (typeof window === 'undefined' || !geocacheContext) {
            return;
        }

        sortedResults.forEach((item, index) => {
            const itemKey = getItemKey(item, index);
            const manualCoords = manualDetectedCoordinates[itemKey];
            const resolvedCoordinates = manualCoords || deriveCoordinatesFromItem(item);
            if (!resolvedCoordinates) {
                return;
            }

            const gcCoords = buildGcCoords(resolvedCoordinates) || resolvedCoordinates.formatted;
            const decimalCoords = extractDecimalCoordinates(resolvedCoordinates, gcCoords || undefined);
            if (!decimalCoords) {
                return;
            }

            const dispatchKey = `${itemKey}-${decimalCoords.latitude}-${decimalCoords.longitude}`;
            if (dispatchedCoordinatesRef.current.has(dispatchKey)) {
                return;
            }

            dispatchedCoordinatesRef.current.add(dispatchKey);

            window.dispatchEvent(new CustomEvent('geoapp-map-highlight-coordinate', {
                detail: {
                    gcCode: geocacheContext.gcCode,
                    geocacheId: geocacheContext.geocacheId,
                    pluginName: result.plugin_info?.name || pluginName || 'Coordonnées détectées',
                    coordinates: {
                        latitude: decimalCoords.latitude,
                        longitude: decimalCoords.longitude,
                        formatted: resolvedCoordinates.formatted || gcCoords || `${decimalCoords.latitude}, ${decimalCoords.longitude}`
                    },
                    autoSaved: false,
                    replaceExisting: false,
                    waypointTitle: geocacheContext.name || pluginName || 'Coordonnée détectée',
                    waypointNote: item.text_output,
                    sourceResultText: item.text_output
                }
            }));
        });
    }, [sortedResults, manualDetectedCoordinates, geocacheContext, pluginName, result.plugin_info?.name]);

    console.log('PluginResultDisplay final render');
    console.log('result.status:', result.status);
    console.log('result.summary:', result.summary);
    console.log('sortedResults.length:', sortedResults.length);

    const isAnalysisWebPageResult =
        pluginName === 'analysis_web_page' ||
        result.plugin_info?.name === 'analysis_web_page' ||
        Boolean((result as any).combined_results);
    const analysisGroups = isAnalysisWebPageResult
        ? sortedResults.reduce<Record<string, any[]>>((groups, item) => {
            const source = String(item.source_plugin || item.plugin_name || 'resultats');
            groups[source] = groups[source] || [];
            groups[source].push(item);
            return groups;
        }, {})
        : {};
    const analysisSourceLabels: Record<string, string> = {
        coordinates_finder: 'Coordonnées détectées',
        coordinate_projection: 'Projections',
        color_text_detector: 'Textes invisibles',
        formula_parser: 'Formules',
        html_comments_finder: 'Commentaires HTML',
        image_alt_text_extractor: "Textes d'images",
        qr_code_detector: 'QR codes',
        additional_waypoints_analyzer: 'Waypoints additionnels',
        written_coords_converter: 'Coordonnées écrites',
        resultats: 'Résultats',
    };
    const primaryCoordinates = (result as any).primary_coordinates;

    return (
        <div className='result-display'>
            <div className='result-status'>
                <strong>Statut:</strong> {result.status === 'ok' ? '✓ OK' : '⚠ ' + (result.status || 'Erreur')}
            </div>

            {/* Afficher le summary si disponible */}
            {result.summary && (
                <div style={{ marginBottom: '10px', opacity: 0.8 }}>
                    {typeof result.summary === 'string' ? result.summary :
                     typeof result.summary === 'object' && (result.summary as any).message ?
                         (result.summary as any).message :
                         JSON.stringify(result.summary, null, 2)}
                </div>
            )}

            {isAnalysisWebPageResult && (
                <div
                    style={{
                        border: '1px solid var(--theia-panel-border)',
                        borderRadius: '4px',
                        background: 'var(--theia-editor-background)',
                        padding: '10px 12px',
                        marginBottom: '15px'
                    }}
                >
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
                        <div>
                            <strong>Analyse complète de page</strong>
                            <div style={{ fontSize: '12px', opacity: 0.75, marginTop: '2px' }}>
                                {sortedResults.length} résultat(s) agrégé(s) depuis {Object.keys(analysisGroups).length} analyseur(s)
                            </div>
                        </div>
                        {primaryCoordinates ? (
                            <div style={{
                                fontFamily: 'monospace',
                                padding: '6px 8px',
                                border: '1px solid var(--theia-panel-border)',
                                borderRadius: '4px',
                                background: 'var(--theia-input-background)',
                                fontSize: '12px'
                            }}>
                                {primaryCoordinates.formatted ||
                                    primaryCoordinates.ddm ||
                                    `${primaryCoordinates.latitude ?? primaryCoordinates.decimal_latitude ?? ''}, ${primaryCoordinates.longitude ?? primaryCoordinates.decimal_longitude ?? ''}`}
                            </div>
                        ) : undefined}
                    </div>
                    {Object.keys(analysisGroups).length > 0 ? (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '10px' }}>
                            {Object.entries(analysisGroups).map(([source, items]) => (
                                <span
                                    key={source}
                                    style={{
                                        fontSize: '11px',
                                        padding: '2px 7px',
                                        borderRadius: '999px',
                                        border: '1px solid var(--theia-panel-border)',
                                        background: 'var(--theia-input-background)'
                                    }}
                                >
                                    {analysisSourceLabels[source] || source}: {items.length}
                                </span>
                            ))}
                        </div>
                    ) : undefined}
                </div>
            )}
            
            {/* Indicateur de mode brute-force */}
            {isBruteForce && (
                <div style={{ 
                    padding: '8px 12px', 
                    background: 'var(--theia-editor-background)', 
                    borderLeft: '3px solid var(--theia-focusBorder)',
                    marginBottom: '15px',
                    fontSize: '13px'
                }}>
                    💥 <strong>Mode force brute activé</strong> - {sortedResults.length} résultats trouvés (triés par pertinence)
                </div>
            )}

            {/* Afficher tous les résultats du tableau */}
            {sortedResults.length > 0 && (
                <div>
                    {sortedResults.map((item, index) => {
                        console.log(`Rendering result ${index}:`, item);
                        try {
                            const itemKey = getItemKey(item, index);
                            const manualCoords = manualDetectedCoordinates[itemKey];
                            const resolvedCoordinates = manualCoords || deriveCoordinatesFromItem(item);
                            return (
                                <div 
                                    key={item.id || index} 
                                    style={{ 
                                        marginBottom: '15px',
                                        padding: '12px',
                                        background: index === 0 && isBruteForce ? 'var(--theia-list-hoverBackground)' : 'transparent',
                                        border: '1px solid var(--theia-panel-border)',
                                        borderRadius: '4px',
                                        position: 'relative'
                                    }}
                                >
                                    {/* Badge de confiance en haut à droite */}
                                    {(item.confidence !== undefined || (item.metadata as any)?.plugin_confidence !== undefined) && (
                                        <div style={{
                                            position: 'absolute',
                                            top: '8px',
                                            right: '8px',
                                            display: 'flex',
                                            flexDirection: 'column',
                                            gap: '4px',
                                            alignItems: 'flex-end'
                                        }}>
                                            {item.confidence !== undefined && (
                                                <div style={{
                                                    padding: '4px 8px',
                                                    background: getScoreColor(item.confidence),
                                                    borderRadius: '3px',
                                                    fontSize: '11px',
                                                    fontWeight: 'bold'
                                                }}>
                                                    🎯 Score {toPercent(item.confidence)}%
                                                </div>
                                            )}
                                            {(item.metadata as any)?.plugin_confidence !== undefined && (
                                                <div style={{
                                                    padding: '3px 8px',
                                                    background: 'var(--theia-editor-background)',
                                                    border: '1px solid var(--theia-panel-border)',
                                                    borderRadius: '3px',
                                                    fontSize: '10px',
                                                    opacity: 0.9
                                                }}>
                                                    🔎 Plugin {toPercent((item.metadata as any).plugin_confidence)}%
                                                </div>
                                            )}
                                        </div>
                                    )}
                                    
                                    {/* Always show text output if exists */}
                                    {item.text_output ? (
                                        <div className='result-text'>
                                            <strong>
                                                {isBruteForce ? `#${index + 1}` : 'Résultat'}
                                                {item.parameters?.shift !== undefined && item.parameters.shift !== null && ` (décalage: ${item.parameters.shift})`}
                                                {index === 0 && isBruteForce && ' 🏆'}
                                            </strong>
                                            <div className='output-content' style={{ position: 'relative', marginTop: '8px' }}>
                                                <pre style={{
                                                    whiteSpace: 'pre-wrap',
                                                    margin: 0,
                                                    paddingRight: '40px',
                                                    fontFamily: 'monospace',
                                                    fontSize: '13px'
                                                }}>{item.text_output}</pre>
                                                <button
                                                    className='theia-button secondary'
                                                    onClick={async () => {
                                                        const text = item.text_output ? String(item.text_output) : '';
                                                        if (!text.trim()) {
                                                            return;
                                                        }

                                                        setDetectingCoordinates(prev => ({ ...prev, [itemKey]: true }));
                                                        try {
                                                            const coords = await pluginsService.detectCoordinates(text, {
                                                                includeNumericOnly: false,
                                                                includeWritten: true,
                                                                writtenLanguages: ['fr', 'en'],
                                                                writtenMaxCandidates: 50,
                                                                writtenIncludeDeconcat: true,
                                                                originCoords: buildOriginCoords(),
                                                            });

                                                            if (coords && coords.exist) {
                                                                setManualDetectedCoordinates(prev => ({
                                                                    ...prev,
                                                                    [itemKey]: {
                                                                        latitude: coords.ddm_lat || '',
                                                                        longitude: coords.ddm_lon || '',
                                                                        formatted: coords.ddm || '',
                                                                    }
                                                                }));
                                                                messageService.info('Coordonnées détectées et ajoutées au résultat.');
                                                            } else {
                                                                messageService.info('Aucune coordonnée détectée sur ce résultat.');
                                                            }
                                                        } catch (e) {
                                                            messageService.error(`Erreur détection coordonnées: ${String(e)}`);
                                                        } finally {
                                                            setDetectingCoordinates(prev => ({ ...prev, [itemKey]: false }));
                                                        }
                                                    }}
                                                    title='Détecter coordonnées (texte, toutes langues)'
                                                    disabled={!!detectingCoordinates[itemKey]}
                                                    style={{ position: 'absolute', top: '5px', right: '45px', padding: '4px 8px' }}
                                                >
                                                    {detectingCoordinates[itemKey] ? '⏳' : '📍'}
                                                </button>
                                                <button
                                                    className='theia-button secondary'
                                                    onClick={() => copyToClipboard(item.text_output!)}
                                                    title='Copier'
                                                    style={{ position: 'absolute', top: '5px', right: '5px', padding: '4px 8px' }}
                                                >
                                                    📋
                                                </button>
                                            </div>
                                        </div>
                                    ) : (
                                        <div style={{ color: 'orange' }}>No text_output for result {index}</div>
                                    )}

                                    {resolvedCoordinates && (
                                        <div className='result-coordinates' style={{ 
                                            marginTop: '8px',
                                            padding: '10px',
                                            background: 'var(--theia-editor-background)',
                                            border: '1px solid var(--theia-focusBorder)',
                                            borderRadius: '4px'
                                        }}>
                                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                                                <strong>📍 Coordonnées détectéees :</strong>
                                                <button
                                                    className='theia-button secondary'
                                                    onClick={() => copyToClipboard(resolvedCoordinates?.formatted ||
                                                        (resolvedCoordinates?.latitude && resolvedCoordinates?.longitude
                                                         ? `${resolvedCoordinates.latitude} ${resolvedCoordinates.longitude}`
                                                         : 'Coordonnées invalides'))}
                                                    title='Copier les coordonnées'
                                                    style={{ padding: '4px 8px', fontSize: '11px' }}
                                                >
                                                    📋 Copier
                                                </button>
                                                {canVerifyCoordinates && (
                                                    <button
                                                        className='theia-button'
                                                        onClick={async () => {
                                                            const key = resolvedCoordinates ? getCoordsKey(resolvedCoordinates) : undefined;
                                                            if (!key || !onVerifyCoordinates || !resolvedCoordinates) {
                                                                return;
                                                            }
                                                            setVerifyingCoordinates(prev => ({ ...prev, [key]: true }));
                                                            try {
                                                                const verifyResult = await onVerifyCoordinates(resolvedCoordinates);
                                                                const status = verifyResult?.status || 'unknown';
                                                                setVerifiedCoordinates(prev => ({
                                                                    ...prev,
                                                                    [key]: { status, message: verifyResult?.message }
                                                                }));

                                                                if (status === 'success') {
                                                                    messageService.info('Checker: coordonnées validées.');
                                                                } else if (status === 'failure') {
                                                                    messageService.warn('Checker: coordonnées refusées.');
                                                                } else {
                                                                    messageService.warn(verifyResult?.message || 'Checker: résultat indéterminé.');
                                                                }
                                                            } catch (error: any) {
                                                                messageService.error(error?.message || 'Erreur lors de la vérification via checker.');
                                                            } finally {
                                                                setVerifyingCoordinates(prev => ({ ...prev, [key]: false }));
                                                            }
                                                        }}
                                                        title='Envoyer ces coordonnées au checker de la géocache'
                                                        style={{ padding: '4px 8px', fontSize: '11px' }}
                                                        disabled={resolvedCoordinates ? verifyingCoordinates[getCoordsKey(resolvedCoordinates)] === true : false}
                                                    >
                                                        {resolvedCoordinates && verifyingCoordinates[getCoordsKey(resolvedCoordinates)] === true
                                                            ? '⏳ Vérification...'
                                                            : '🔎 Vérifier via Checkeur'}
                                                    </button>
                                                )}
                                                {canRequestWaypoint && resolvedCoordinates && buildGcCoords(resolvedCoordinates) && (
                                                    <>
                                                        {(['manual', 'auto'] as const).map(mode => (
                                                            <button
                                                                key={mode}
                                                                className='theia-button'
                                                                onClick={() => {
                                                                    const gcCoords = buildGcCoords(resolvedCoordinates);
                                                                    if (!gcCoords) {
                                                                        return;
                                                                    }
                                                                    const decimalCoords = extractDecimalCoordinates(resolvedCoordinates, gcCoords);
                                                                    if (!decimalCoords) {
                                                                        console.warn('[Plugin Executor] Impossible de convertir les coordonnées pour la carte', {
                                                                            coordinates: resolvedCoordinates,
                                                                            fallback: gcCoords
                                                                        });
                                                                    }
                                                                    onRequestAddWaypoint?.({
                                                                        gcCoords,
                                                                        pluginName: pluginName || result.plugin_info?.name,
                                                                        geocache: geocacheContext ? {
                                                                            gcCode: geocacheContext.gcCode,
                                                                            name: geocacheContext.name
                                                                        } : undefined,
                                                                        sourceResultText: item.text_output,
                                                                        waypointTitle: `${result.plugin_info?.name || pluginName || 'Coordonnées détectées'}`,
                                                                        waypointNote: item.text_output,
                                                                        autoSave: mode === 'auto',
                                                                        decimalLatitude: decimalCoords?.latitude,
                                                                        decimalLongitude: decimalCoords?.longitude
                                                                    });
                                                                }}
                                                                title={mode === 'auto'
                                                                    ? 'Créer immédiatement un waypoint validé'
                                                                    : 'Ajouter ces coordonnées comme nouveau waypoint'}
                                                                style={{ padding: '4px 8px', fontSize: '11px' }}
                                                            >
                                                                {mode === 'auto' ? '✅ Ajouter et valider' : '➕ Ajouter comme waypoint'}
                                                            </button>
                                                        ))}
                                                    </>
                                                )}
                                                {canSetAsCorrectedCoords && resolvedCoordinates && buildGcCoords(resolvedCoordinates) && (
                                                    <button
                                                        className='theia-button secondary'
                                                        onClick={() => {
                                                            const gcCoords = buildGcCoords(resolvedCoordinates);
                                                            if (gcCoords) {
                                                                onSetAsCorrectedCoords?.(gcCoords);
                                                            }
                                                        }}
                                                        title='Définir ces coordonnées comme coordonnées corrigées de la géocache'
                                                        style={{ padding: '4px 8px', fontSize: '11px' }}
                                                    >
                                                        📍 Corriger la cache
                                                    </button>
                                                )}
                                            </div>
                                            <div style={{ marginTop: '8px', fontFamily: 'monospace', fontSize: '14px', fontWeight: 'bold' }}>
                                                {(() => {
                                                    // Priorité 1: formatted ou ddm
                                                    if (resolvedCoordinates.formatted) {
                                                        return resolvedCoordinates.formatted;
                                                    }
                                                    if ((resolvedCoordinates as any).ddm) {
                                                        return (resolvedCoordinates as any).ddm;
                                                    }
                                                    // Priorité 2: ddm_lat + ddm_lon
                                                    if ((resolvedCoordinates as any).ddm_lat && (resolvedCoordinates as any).ddm_lon) {
                                                        return `${(resolvedCoordinates as any).ddm_lat} ${(resolvedCoordinates as any).ddm_lon}`;
                                                    }
                                                    // Priorité 3: decimal_latitude + decimal_longitude
                                                    if ((resolvedCoordinates as any).decimal_latitude !== undefined && (resolvedCoordinates as any).decimal_longitude !== undefined) {
                                                        return `${(resolvedCoordinates as any).decimal_latitude}, ${(resolvedCoordinates as any).decimal_longitude}`;
                                                    }
                                                    // Priorité 4: latitude + longitude (legacy)
                                                    if (resolvedCoordinates.latitude && resolvedCoordinates.longitude) {
                                                        return `${resolvedCoordinates.latitude} ${resolvedCoordinates.longitude}`;
                                                    }
                                                    return 'Coordonnées invalides';
                                                })()}
                                            </div>
                                            {(() => {
                                                const key = getCoordsKey(resolvedCoordinates);
                                                const record = key ? verifiedCoordinates[key] : undefined;
                                                if (!record) {
                                                    return null;
                                                }
                                                if (record.status === 'failure') {
                                                    return (
                                                        <div style={{ marginTop: '6px', fontSize: '12px', opacity: 0.85 }}>
                                                            ❌ Coordonnées refusées
                                                        </div>
                                                    );
                                                }
                                                if (record.status !== 'success') {
                                                    return null;
                                                }
                                                return (
                                                    <div style={{ marginTop: '6px', fontSize: '12px', opacity: 0.85 }}>
                                                        ✅ Coordonnées vérifiées
                                                    </div>
                                                );
                                            })()}
                                        </div>
                                    )}

                                    {(() => {
                                        const scoring = (item.metadata as any)?.scoring;
                                        if (!scoring || typeof scoring !== 'object') {
                                            return null;
                                        }

                                        const features = scoring.features || {};
                                        return (
                                            <div style={{ marginTop: '10px' }}>
                                                <details>
                                                    <summary style={{ cursor: 'pointer', fontSize: '12px', opacity: 0.85 }}>
                                                        🧠 Détails scoring
                                                    </summary>
                                                    <div style={{
                                                        marginTop: '8px',
                                                        padding: '10px',
                                                        background: 'var(--theia-editor-background)',
                                                        border: '1px solid var(--theia-panel-border)',
                                                        borderRadius: '4px',
                                                        fontSize: '12px'
                                                    }}>
                                                        {scoring.explanation && (
                                                            <div style={{ marginBottom: '6px', opacity: 0.9 }}>
                                                                <strong>Explication:</strong> {String(scoring.explanation)}
                                                            </div>
                                                        )}
                                                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', opacity: 0.85 }}>
                                                            {scoring.language_detected && (
                                                                <div>
                                                                    <strong>Langue:</strong> {String(scoring.language_detected)}
                                                                    {scoring.language_confidence !== undefined && (
                                                                        <> ({toPercent(scoring.language_confidence)}%)</>
                                                                    )}
                                                                </div>
                                                            )}
                                                            {scoring.early_exit && (
                                                                <div>
                                                                    <strong>Early-exit:</strong> {String(scoring.early_exit)}
                                                                </div>
                                                            )}
                                                        </div>
                                                        <div style={{ marginTop: '8px', display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '6px 12px' }}>
                                                            {features.gps_confidence !== undefined && (
                                                                <div><strong>GPS</strong>: {toPercent(features.gps_confidence)}%</div>
                                                            )}
                                                            {features.coord_words !== undefined && (
                                                                <div><strong>Mots coords</strong>: {toPercent(features.coord_words)}%</div>
                                                            )}
                                                            {features.lexical_coverage !== undefined && (
                                                                <div><strong>Lexical</strong>: {toPercent(features.lexical_coverage)}%</div>
                                                            )}
                                                            {features.ngram_fitness !== undefined && (
                                                                <div><strong>N-grams</strong>: {toPercent(features.ngram_fitness)}%</div>
                                                            )}
                                                            {features.quadgram_fitness !== undefined && (
                                                                <div><strong>Quadgrams</strong>: {toPercent(features.quadgram_fitness)}%</div>
                                                            )}
                                                            {features.repetition_quality !== undefined && (
                                                                <div><strong>Répétitions</strong>: {toPercent(features.repetition_quality)}%</div>
                                                            )}
                                                            {features.ic !== undefined && (
                                                                <div><strong>IC</strong>: {Number(features.ic).toFixed ? Number(features.ic).toFixed(3) : String(features.ic)}</div>
                                                            )}
                                                            {features.entropy !== undefined && (
                                                                <div><strong>Entropie</strong>: {Number(features.entropy).toFixed ? Number(features.entropy).toFixed(2) : String(features.entropy)}</div>
                                                            )}
                                                        </div>
                                                    </div>
                                                </details>
                                            </div>
                                        );
                                    })()}

                                    {item.metadata && Object.keys(item.metadata).length > 0 && (
                                        <div className='result-metadata'>
                                            <strong>Métadonnées:</strong>
                                            <ul>
                                                {Object.entries(item.metadata)
                                                    .filter(([k]) => k !== 'scoring')
                                                    .map(([k, v]) => (
                                                    <li key={k}>
                                                        <strong>{k}:</strong>{' '}
                                                        {v !== null && typeof v === 'object'
                                                            ? JSON.stringify(v)
                                                            : String(v)}
                                                    </li>
                                                ))}
                                            </ul>
                                        </div>
                                    )}

                                    {item.parameters && Object.keys(item.parameters).length > 0 && (
                                        <div style={{ fontSize: '12px', opacity: 0.7, marginTop: '8px' }}>
                                            <strong>Paramètres utilisés:</strong> {JSON.stringify(item.parameters, null, 2)}
                                        </div>
                                    )}
                                </div>
                            );
                        } catch (error) {
                            console.error(`Erreur lors du rendu du résultat ${index}:`, error, item);
                            return (
                                <div key={`error-${index}`} style={{
                                    marginBottom: '15px',
                                    padding: '12px',
                                    background: 'var(--theia-error-foreground)',
                                    color: 'white',
                                    borderRadius: '4px'
                                }}>
                                    Erreur lors de l'affichage du résultat #{index + 1}
                                </div>
                            );
                        }
                    })}
                </div>
            )}

            {/* Afficher les infos du plugin */}
            {result.plugin_info && (
                <div style={{ fontSize: '12px', opacity: 0.6, marginTop: '10px', borderTop: '1px solid var(--theia-panel-border)', paddingTop: '8px' }}>
                    Plugin: {result.plugin_info.name} v{result.plugin_info.version}
                    {result.plugin_info.execution_time_ms !== undefined && ` • Temps: ${result.plugin_info.execution_time_ms}ms`}
                </div>
            )}

            {/* Compatibilité : affichage des propriétés à la racine (ancien format) */}
            {!result.results && result.text_output && (
                <div className='result-text'>
                    <strong>Résultat texte:</strong>
                    <div className='output-content'>
                        {result.text_output}
                        <button
                            className='theia-button secondary'
                            onClick={() => copyToClipboard(result.text_output!)}
                            title='Copier'
                        >
                            📋
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};
