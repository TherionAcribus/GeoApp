import * as React from '@theia/core/shared/react';
import type { StreamingEvent, StreamingProgress, CoordsDetectionProgress } from './plugin-executor-widget';

export const MetasolverStreamingPanel: React.FC<{
    events: StreamingEvent[];
    progress: StreamingProgress | null;
    verbosity: 'minimal' | 'normal' | 'detailed';
    coordsDetectionProgress?: CoordsDetectionProgress | null;
}> = ({ events, progress, verbosity, coordsDetectionProgress }) => {
    const scrollRef = React.useRef<HTMLDivElement>(null);

    // Auto-scroll vers le bas quand de nouveaux événements arrivent
    React.useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [events.length]);

    const initEvent = events.find(e => e.event === 'init');
    const totalPlugins = initEvent?.data?.total_plugins || progress?.total || 0;
    const pluginNames: string[] = initEvent?.data?.plugins || [];

    // Construire le statut de chaque plugin
    const pluginStatuses = React.useMemo(() => {
        const statuses: Record<string, { status: 'pending' | 'running' | 'done' | 'error'; time_ms?: number; result_count?: number; reason?: string; results?: any[] }> = {};
        for (const name of pluginNames) {
            statuses[name] = { status: 'pending' };
        }
        for (const evt of events) {
            const name = evt.data?.plugin;
            if (!name) continue;
            if (evt.event === 'plugin_start') {
                statuses[name] = { status: 'running' };
            } else if (evt.event === 'plugin_done') {
                statuses[name] = {
                    status: 'done',
                    time_ms: evt.data.execution_time_ms,
                    result_count: evt.data.result_count,
                    results: evt.data.results,
                };
            } else if (evt.event === 'plugin_error') {
                statuses[name] = {
                    status: 'error',
                    time_ms: evt.data.execution_time_ms,
                    reason: evt.data.reason,
                };
            }
        }
        return statuses;
    }, [events, pluginNames]);

    const pct = progress?.percentage ?? 0;
    const elapsed = progress?.elapsed_ms ? (progress.elapsed_ms / 1000).toFixed(1) : '0';
    const phase1Done = pct >= 100;

    const statusIcon = (s: string) => {
        switch (s) {
            case 'running': return '⏳';
            case 'done': return '✅';
            case 'error': return '❌';
            default: return '⬜';
        }
    };

    // Phase 2 progress
    const cdp = coordsDetectionProgress;
    const coordsPct = cdp && cdp.total > 0 ? Math.round((cdp.current / cdp.total) * 100) : 0;

    return (
        <div className='plugin-form' style={{ padding: '10px' }}>
            <h4 style={{ margin: '0 0 8px 0' }}>📡 Progression en direct</h4>

            {/* Phase 1: Exécution des plugins */}
            <div style={{ fontSize: '11px', fontWeight: 'bold', opacity: 0.6, marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                {phase1Done ? '✅' : '⏳'} Phase 1 – Exécution des plugins
            </div>

            {/* Barre de progression Phase 1 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                <div style={{
                    flex: 1,
                    height: '6px',
                    background: 'var(--theia-editor-background)',
                    borderRadius: '3px',
                    overflow: 'hidden',
                }}>
                    <div style={{
                        width: `${pct}%`,
                        height: '100%',
                        background: phase1Done
                            ? 'var(--theia-successBackground, #4caf50)'
                            : 'var(--theia-progressBar-background, #0078d4)',
                        borderRadius: '3px',
                        transition: 'width 0.3s ease',
                    }} />
                </div>
                <span style={{ fontSize: '11px', fontWeight: 'bold', minWidth: '36px', textAlign: 'right' }}>
                    {pct.toFixed(0)}%
                </span>
            </div>

            {/* Résumé Phase 1 */}
            <div style={{ fontSize: '11px', opacity: 0.7, marginBottom: '8px', display: 'flex', gap: '10px' }}>
                <span>{progress?.completed ?? 0}/{totalPlugins} plugins</span>
                <span>{progress?.results_so_far ?? 0} rés.</span>
                {(progress?.failures_so_far ?? 0) > 0 && (
                    <span style={{ color: 'var(--theia-errorForeground)' }}>
                        {progress!.failures_so_far} err.
                    </span>
                )}
                <span style={{ opacity: 0.6 }}>{elapsed}s</span>
            </div>

            {/* Phase 2: Détection de coordonnées */}
            {cdp && (
                <>
                    <div style={{
                        fontSize: '11px', fontWeight: 'bold', opacity: 0.6, marginBottom: '4px',
                        textTransform: 'uppercase', letterSpacing: '0.5px',
                        borderTop: '1px solid var(--theia-panel-border)',
                        paddingTop: '8px',
                    }}>
                        {cdp.phase === 'done' ? '✅' : '⏳'} Phase 2 – Détection de coordonnées
                    </div>

                    {/* Barre de progression Phase 2 */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                        <div style={{
                            flex: 1,
                            height: '6px',
                            background: 'var(--theia-editor-background)',
                            borderRadius: '3px',
                            overflow: 'hidden',
                        }}>
                            <div style={{
                                width: `${coordsPct}%`,
                                height: '100%',
                                background: cdp.phase === 'done'
                                    ? 'var(--theia-successBackground, #4caf50)'
                                    : '#e6a817',
                                borderRadius: '3px',
                                transition: 'width 0.2s ease',
                            }} />
                        </div>
                        <span style={{ fontSize: '11px', fontWeight: 'bold', minWidth: '36px', textAlign: 'right' }}>
                            {coordsPct}%
                        </span>
                    </div>

                    {/* Résumé Phase 2 */}
                    <div style={{ fontSize: '11px', opacity: 0.7, marginBottom: '4px', display: 'flex', gap: '10px' }}>
                        <span>{cdp.current}/{cdp.total} textes analysés</span>
                        <span>📍 {cdp.found} coordonnée(s)</span>
                    </div>

                    {/* Texte en cours d'analyse (verbosity normal ou detailed) */}
                    {verbosity !== 'minimal' && cdp.phase === 'running' && cdp.currentText && (
                        <div style={{
                            fontSize: '11px',
                            opacity: 0.5,
                            fontStyle: 'italic',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            marginBottom: '4px',
                        }}>
                            🔍 {cdp.currentText}
                        </div>
                    )}
                </>
            )}

            {/* Liste des plugins (verbosity normal ou detailed) */}
            {verbosity !== 'minimal' && pluginNames.length > 0 && (
                <div
                    ref={scrollRef}
                    style={{
                        maxHeight: verbosity === 'detailed' ? '400px' : '200px',
                        overflowY: 'auto',
                        fontSize: '12px',
                        borderTop: '1px solid var(--theia-panel-border)',
                        paddingTop: '6px',
                    }}
                >
                    {pluginNames.map(name => {
                        const s = pluginStatuses[name] || { status: 'pending' };
                        return (
                            <div key={name} style={{ marginBottom: verbosity === 'detailed' ? '6px' : '2px' }}>
                                <div style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '6px',
                                    opacity: s.status === 'pending' ? 0.4 : 1,
                                }}>
                                    <span>{statusIcon(s.status)}</span>
                                    <span style={{
                                        fontWeight: s.status === 'running' ? 'bold' : 'normal',
                                        minWidth: '130px',
                                    }}>
                                        {name}
                                    </span>
                                    {s.status === 'done' && (
                                        <span style={{ opacity: 0.6 }}>
                                            {s.result_count} rés. · {s.time_ms}ms
                                        </span>
                                    )}
                                    {s.status === 'error' && (
                                        <span style={{ color: 'var(--theia-errorForeground)', opacity: 0.8 }}>
                                            {s.reason ? (s.reason.length > 60 ? s.reason.slice(0, 60) + '…' : s.reason) : 'Erreur'}
                                            {s.time_ms ? ` · ${s.time_ms}ms` : ''}
                                        </span>
                                    )}
                                    {s.status === 'running' && (
                                        <span style={{ opacity: 0.6, fontStyle: 'italic' }}>en cours…</span>
                                    )}
                                </div>

                                {/* Résultats inline (verbosity detailed) */}
                                {verbosity === 'detailed' && s.status === 'done' && s.results && s.results.length > 0 && (
                                    <div style={{
                                        marginLeft: '24px',
                                        marginTop: '2px',
                                        padding: '4px 8px',
                                        background: 'var(--theia-editor-background)',
                                        borderRadius: '3px',
                                        fontSize: '11px',
                                        maxHeight: '80px',
                                        overflowY: 'auto',
                                    }}>
                                        {s.results.slice(0, 3).map((r: any, i: number) => (
                                            <div key={i} style={{ marginBottom: '2px' }}>
                                                <span style={{ opacity: 0.6 }}>#{i + 1}</span>{' '}
                                                {r.text_output
                                                    ? (r.text_output.length > 120
                                                        ? r.text_output.slice(0, 120) + '…'
                                                        : r.text_output)
                                                    : '(pas de texte)'}
                                                {r.confidence !== undefined && (
                                                    <span style={{ marginLeft: '6px', opacity: 0.5 }}>
                                                        [{(r.confidence * 100).toFixed(0)}%]
                                                    </span>
                                                )}
                                            </div>
                                        ))}
                                        {s.results.length > 3 && (
                                            <div style={{ opacity: 0.5 }}>+{s.results.length - 3} autres résultats</div>
                                        )}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};
