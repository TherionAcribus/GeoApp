/**
 * Composant réutilisable affichant un résumé des logs récents d'une géocache
 * sous forme d'une série d'icônes colorées.
 *
 * Peut être utilisé dans le widget des logs ET dans la fiche détail de la géocache.
 */
import * as React from 'react';

/**
 * Entrée légère d'un résumé de log (pas de texte complet)
 */
export interface LogSummaryEntry {
    log_type: string;
    date: string | null;
    author: string;
    is_favorite: boolean;
}

/**
 * Réponse de l'API /logs/recent-summary
 */
export interface LogsRecentSummaryApiResponse {
    geocache_id: number;
    gc_code: string;
    total_count: number;
    entries: LogSummaryEntry[];
}

/**
 * Props du composant LogsRecentSummary
 */
export interface LogsRecentSummaryProps {
    entries: LogSummaryEntry[];
    totalCount: number;
    isLoading: boolean;
    /** Si fourni, affiche un lien/bouton pour ouvrir le panneau de logs complet */
    onOpenLogs?: () => void;
}

/**
 * Retourne la couleur associée à un type de log
 */
function getSummaryColor(logType: string): string {
    const type = logType.toLowerCase();
    if (type === 'found' || type.includes('found')) return '#22c55e';
    if (type === 'did not find' || type === 'dnf') return '#ef4444';
    if (type === 'note' || type === 'write note') return '#3b82f6';
    if (type.includes('owner') || type.includes('maintenance')) return '#f59e0b';
    if (type.includes('reviewer')) return '#8b5cf6';
    if (type.includes('disable') || type.includes('archive')) return '#6b7280';
    if (type === 'needs maintenance') return '#f97316';
    if (type === 'needs archived') return '#dc2626';
    if (type === 'attended' || type === 'will attend') return '#06b6d4';
    return '#9ca3af';
}

/**
 * Retourne l'icône Font Awesome associée à un type de log
 */
function getSummaryIcon(logType: string): string {
    const type = logType.toLowerCase();
    if (type === 'found' || type.includes('found')) return 'fa-check';
    if (type === 'did not find' || type === 'dnf') return 'fa-times';
    if (type === 'note' || type === 'write note') return 'fa-sticky-note';
    if (type.includes('owner') || type === 'owner maintenance') return 'fa-wrench';
    if (type === 'needs maintenance') return 'fa-exclamation-triangle';
    if (type === 'needs archived') return 'fa-exclamation-circle';
    if (type.includes('reviewer')) return 'fa-shield';
    if (type === 'temporarily disabled') return 'fa-pause';
    if (type === 'archived' || type.includes('archive')) return 'fa-archive';
    if (type === 'enabled' || type === 'published') return 'fa-play';
    if (type === 'attended' || type === 'will attend') return 'fa-calendar-check';
    if (type === 'webcam') return 'fa-camera';
    return 'fa-comment';
}

/**
 * Formate une date ISO en format court lisible
 */
function formatShortDate(dateStr: string | null): string {
    if (!dateStr) return '—';
    try {
        const d = new Date(dateStr);
        return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
    } catch {
        return dateStr;
    }
}

/**
 * Composant affichant le résumé des logs récents sous forme de série d'icônes.
 * Chaque icône représente un log récent et affiche un tooltip avec le type, l'auteur et la date.
 */
export const LogsRecentSummary: React.FC<LogsRecentSummaryProps> = ({
    entries,
    totalCount,
    isLoading,
    onOpenLogs,
}) => {
    if (isLoading) {
        return (
            <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '8px 0',
                opacity: 0.6,
                fontSize: 12,
            }}>
                <i className="fa fa-spinner fa-spin" style={{ marginRight: 4 }} />
                Chargement du résumé...
            </div>
        );
    }

    if (entries.length === 0) {
        return null;
    }

    return (
        <div
            style={{
                background: 'var(--theia-editor-background)',
                border: '1px solid var(--theia-panel-border)',
                borderRadius: 6,
                padding: '10px 12px',
                marginBottom: 12,
                flexShrink: 0,
            }}
        >
            {/* Titre */}
            <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 8,
            }}>
                <span style={{ fontSize: 11, fontWeight: 600, opacity: 0.7, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Derniers logs
                    {totalCount > 0 && (
                        <span style={{ fontWeight: 'normal', marginLeft: 4 }}>({totalCount} au total)</span>
                    )}
                </span>
                {onOpenLogs && (
                    <button
                        onClick={onOpenLogs}
                        title="Ouvrir le panneau des logs"
                        style={{
                            background: 'none',
                            border: 'none',
                            color: 'var(--theia-textLink-foreground)',
                            cursor: 'pointer',
                            padding: '0 2px',
                            fontSize: 11,
                            opacity: 0.8,
                        }}
                    >
                        <i className="fa fa-external-link-alt" style={{ marginRight: 3 }} />
                        Voir tout
                    </button>
                )}
            </div>

            {/* Série d'icônes */}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {entries.map((entry, idx) => {
                    const color = getSummaryColor(entry.log_type);
                    const icon = getSummaryIcon(entry.log_type);
                    const tooltip = `${entry.log_type}\n${entry.author}\n${formatShortDate(entry.date)}`;
                    return (
                        <div
                            key={idx}
                            title={tooltip}
                            style={{
                                display: 'inline-flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                gap: 3,
                                cursor: 'default',
                            }}
                        >
                            <span
                                style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    width: 32,
                                    height: 32,
                                    borderRadius: '50%',
                                    background: color,
                                    color: 'white',
                                    fontSize: 13,
                                    flexShrink: 0,
                                    boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
                                    position: 'relative',
                                }}
                            >
                                <i className={`fa ${icon}`} />
                                {entry.is_favorite && (
                                    <span
                                        style={{
                                            position: 'absolute',
                                            top: -2,
                                            right: -2,
                                            fontSize: 8,
                                            color: '#fbbf24',
                                            lineHeight: 1,
                                        }}
                                        title="Log favori"
                                    >
                                        <i className="fa fa-star" />
                                    </span>
                                )}
                            </span>
                            <span style={{ fontSize: 9, opacity: 0.65, textAlign: 'center', maxWidth: 36, lineHeight: 1.2 }}>
                                {formatShortDate(entry.date)}
                            </span>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};
