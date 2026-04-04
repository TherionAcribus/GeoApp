import * as React from 'react';

interface PocketQuery {
    guid: string;
    name: string;
    count: number;
}

export interface ImportPocketQueryDialogProps {
    zoneId: number;
    onImport: (pqCode: string, onProgress?: (percentage: number, message: string) => void) => Promise<void>;
    onCancel: () => void;
    isImporting: boolean;
    backendUrl?: string;
}

export const ImportPocketQueryDialog: React.FC<ImportPocketQueryDialogProps> = ({
    zoneId,
    onImport,
    onCancel,
    isImporting,
    backendUrl = 'http://localhost:8000'
}) => {
    const [queries, setQueries] = React.useState<PocketQuery[]>([]);
    const [selectedGuid, setSelectedGuid] = React.useState('');
    const [loading, setLoading] = React.useState(true);
    const [error, setError] = React.useState('');
    const [progressVisible, setProgressVisible] = React.useState(false);
    const [progressPercentage, setProgressPercentage] = React.useState(0);
    const [progressMessage, setProgressMessage] = React.useState('');

    React.useEffect(() => {
        const fetchQueries = async () => {
            try {
                setLoading(true);
                setError('');
                const response = await fetch(`${backendUrl}/api/geocaches/user-pocket-queries`);
                if (!response.ok) {
                    throw new Error('Impossible de récupérer les Pocket Queries');
                }
                const data = await response.json();
                setQueries(data.queries || []);
                if (data.queries && data.queries.length > 0) {
                    setSelectedGuid(data.queries[0].guid);
                }
            } catch (err) {
                setError('Erreur lors du chargement des Pocket Queries. Assurez-vous d\'être connecté avec un compte Premium.');
                console.error('Failed to fetch pocket queries:', err);
            } finally {
                setLoading(false);
            }
        };
        fetchQueries();
    }, [backendUrl]);

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

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (selectedGuid) {
            resetProgress();
            await onImport(selectedGuid, handleProgressUpdate);
        }
    };

    const selectedQuery = React.useMemo(() => {
        return queries.find(q => q.guid === selectedGuid);
    }, [queries, selectedGuid]);

    return (
        <div 
            style={{
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                backgroundColor: 'rgba(0, 0, 0, 0.5)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 10000
            }}
            onClick={onCancel}
        >
            <div 
                style={{
                    backgroundColor: 'var(--theia-editor-background)',
                    padding: '24px',
                    borderRadius: '8px',
                    width: '500px',
                    maxWidth: '90vw',
                    border: '1px solid var(--theia-panel-border)',
                    boxShadow: '0 4px 6px rgba(0, 0, 0, 0.3)'
                }}
                onClick={(e) => e.stopPropagation()}
            >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                    <h3 style={{ margin: 0, fontSize: '18px', color: 'var(--theia-foreground)' }}>
                        Importer depuis une Pocket Query
                    </h3>
                    <button
                        onClick={onCancel}
                        disabled={isImporting}
                        style={{
                            background: 'none',
                            border: 'none',
                            color: 'var(--theia-foreground)',
                            cursor: isImporting ? 'not-allowed' : 'pointer',
                            padding: '4px',
                            opacity: isImporting ? 0.5 : 1,
                            fontSize: '20px'
                        }}
                    >
                        ✕
                    </button>
                </div>

                <form onSubmit={handleSubmit}>
                    {loading ? (
                        <div style={{ padding: '20px', textAlign: 'center', color: 'var(--theia-descriptionForeground)' }}>
                            Chargement de vos Pocket Queries...
                        </div>
                    ) : error ? (
                        <div style={{ marginBottom: '16px', padding: '12px', backgroundColor: 'var(--theia-inputValidation-errorBackground)', borderRadius: '4px' }}>
                            <p style={{ fontSize: '13px', color: 'var(--theia-errorForeground)', margin: 0 }}>
                                {error}
                            </p>
                        </div>
                    ) : queries.length === 0 ? (
                        <div style={{ marginBottom: '16px', padding: '12px', backgroundColor: 'var(--theia-input-background)', borderRadius: '4px' }}>
                            <p style={{ fontSize: '13px', color: 'var(--theia-descriptionForeground)', margin: 0 }}>
                                Aucune Pocket Query trouvée. Créez-en une sur geocaching.com (compte Premium requis).
                            </p>
                        </div>
                    ) : (
                        <div style={{ marginBottom: '16px' }}>
                            <label 
                                htmlFor="pqSelect"
                                style={{ 
                                    display: 'block', 
                                    fontSize: '13px', 
                                    marginBottom: '8px',
                                    color: 'var(--theia-foreground)'
                                }}
                            >
                                Sélectionnez une Pocket Query
                            </label>
                            <select
                                id="pqSelect"
                                value={selectedGuid}
                                onChange={(e) => setSelectedGuid(e.target.value)}
                                disabled={isImporting}
                                style={{
                                    display: 'block',
                                    width: '100%',
                                    padding: '8px',
                                    backgroundColor: 'var(--theia-input-background)',
                                    color: 'var(--theia-input-foreground)',
                                    border: '1px solid var(--theia-input-border)',
                                    borderRadius: '4px',
                                    cursor: isImporting ? 'not-allowed' : 'pointer',
                                    fontSize: '14px'
                                }}
                            >
                                {queries.map(query => (
                                    <option key={query.guid} value={query.guid}>
                                        {query.name} ({query.count} caches)
                                    </option>
                                ))}
                            </select>
                            {selectedQuery && (
                                <p style={{ fontSize: '11px', color: 'var(--theia-descriptionForeground)', marginTop: '4px' }}>
                                    GUID: {selectedQuery.guid.substring(0, 8)}...
                                </p>
                            )}
                        </div>
                    )}

                    <div style={{ marginBottom: '16px', padding: '12px', backgroundColor: 'var(--theia-input-background)', borderRadius: '4px' }}>
                        <p style={{ fontSize: '12px', color: 'var(--theia-descriptionForeground)', margin: 0 }}>
                            <strong>Zone cible:</strong> {zoneId}
                        </p>
                        <p style={{ fontSize: '11px', color: 'var(--theia-descriptionForeground)', margin: '8px 0 0 0' }}>
                            💡 <strong>Compte Premium requis:</strong> Les Pocket Queries sont une fonctionnalité Premium de Geocaching.com. Assurez-vous d'être connecté avec un compte Premium dans votre navigateur.
                        </p>
                    </div>

                    {progressVisible && (
                        <div style={{ marginBottom: '16px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                                <span style={{ fontSize: '13px', color: 'var(--theia-foreground)' }}>
                                    Progression
                                </span>
                                <span style={{ fontSize: '13px', color: 'var(--theia-descriptionForeground)' }}>
                                    {progressPercentage}%
                                </span>
                            </div>
                            <div
                                style={{
                                    width: '100%',
                                    height: '8px',
                                    backgroundColor: 'var(--theia-progressBar-background)',
                                    borderRadius: '4px',
                                    overflow: 'hidden'
                                }}
                            >
                                <div
                                    style={{
                                        width: `${progressPercentage}%`,
                                        height: '100%',
                                        backgroundColor: 'var(--theia-progressBar-foreground)',
                                        transition: 'width 0.3s ease'
                                    }}
                                />
                            </div>
                            {progressMessage && (
                                <p style={{ fontSize: '12px', color: 'var(--theia-descriptionForeground)', marginTop: '4px' }}>
                                    {progressMessage}
                                </p>
                            )}
                        </div>
                    )}

                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                        <button
                            type="button"
                            onClick={onCancel}
                            disabled={isImporting}
                            style={{
                                padding: '8px 16px',
                                backgroundColor: 'var(--theia-button-secondaryBackground)',
                                color: 'var(--theia-button-secondaryForeground)',
                                border: 'none',
                                borderRadius: '4px',
                                cursor: isImporting ? 'not-allowed' : 'pointer',
                                opacity: isImporting ? 0.5 : 1
                            }}
                        >
                            Annuler
                        </button>
                        <button
                            type="submit"
                            disabled={!selectedGuid || isImporting || loading || queries.length === 0}
                            style={{
                                padding: '8px 16px',
                                backgroundColor: (!selectedGuid || isImporting || loading || queries.length === 0) ? 'var(--theia-button-disabledBackground)' : 'var(--theia-button-background)',
                                color: (!selectedGuid || isImporting || loading || queries.length === 0) ? 'var(--theia-button-disabledForeground)' : 'var(--theia-button-foreground)',
                                border: 'none',
                                borderRadius: '4px',
                                cursor: (!selectedGuid || isImporting || loading || queries.length === 0) ? 'not-allowed' : 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px'
                            }}
                        >
                            <span>Importer</span>
                            {isImporting && (
                                <div 
                                    style={{
                                        width: '16px',
                                        height: '16px',
                                        border: '2px solid currentColor',
                                        borderTopColor: 'transparent',
                                        borderRadius: '50%',
                                        animation: 'spin 1s linear infinite'
                                    }}
                                />
                            )}
                        </button>
                    </div>
                </form>
            </div>

            <style>{`
                @keyframes spin {
                    to { transform: rotate(360deg); }
                }
            `}</style>
        </div>
    );
};
