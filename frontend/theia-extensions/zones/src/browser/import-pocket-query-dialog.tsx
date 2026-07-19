import * as React from 'react';
import { ImportDialogShell, ImportCounts, ImportProgressCallback } from './import-dialog-shell';

interface PocketQuery {
    guid: string;
    name: string;
    count: number;
}

export interface ImportPocketQueryDialogProps {
    zoneId: number;
    zoneName?: string;
    onImport: (pqCode: string, updateExisting: boolean, onProgress?: ImportProgressCallback) => Promise<void>;
    onCancel: () => void;
    onCancelImport?: () => void;
    isImporting: boolean;
    backendUrl?: string;
}

export const ImportPocketQueryDialog: React.FC<ImportPocketQueryDialogProps> = ({
    zoneId,
    zoneName,
    onImport,
    onCancel,
    onCancelImport,
    isImporting,
    backendUrl = 'http://localhost:8000'
}) => {
    const [queries, setQueries] = React.useState<PocketQuery[]>([]);
    const [selectedGuid, setSelectedGuid] = React.useState('');
    const [updateExisting, setUpdateExisting] = React.useState(false);
    const [loading, setLoading] = React.useState(true);
    const [error, setError] = React.useState('');
    const [progressVisible, setProgressVisible] = React.useState(false);
    const [progressPercentage, setProgressPercentage] = React.useState(0);
    const [progressMessage, setProgressMessage] = React.useState('');
    const [counts, setCounts] = React.useState<ImportCounts | undefined>(undefined);
    const [errorItems, setErrorItems] = React.useState<string[]>([]);

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

    const handleProgressUpdate = React.useCallback<ImportProgressCallback>((percentage, message, extra) => {
        setProgressPercentage(percentage);
        setProgressMessage(message);
        setProgressVisible(true);
        if (extra?.counts) { setCounts(extra.counts); }
        if (extra?.errorItem) { setErrorItems(prev => [...prev, extra.errorItem!]); }
    }, []);

    const resetProgress = React.useCallback(() => {
        setProgressVisible(false);
        setProgressPercentage(0);
        setProgressMessage('');
        setCounts(undefined);
        setErrorItems([]);
    }, []);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (selectedGuid) {
            resetProgress();
            await onImport(selectedGuid, updateExisting, handleProgressUpdate);
        }
    };

    const selectedQuery = React.useMemo(() => {
        return queries.find(q => q.guid === selectedGuid);
    }, [queries, selectedGuid]);

    return (
        <ImportDialogShell
            title="Importer depuis une Pocket Query"
            isImporting={isImporting}
            canSubmit={!!selectedGuid && !loading && queries.length > 0}
            onSubmit={handleSubmit}
            onCancel={onCancel}
            onCancelImport={onCancelImport}
            progressVisible={progressVisible}
            progressPercentage={progressPercentage}
            progressMessage={progressMessage}
            counts={counts}
            errorItems={errorItems}
        >
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
                        style={{ display: 'block', fontSize: '13px', marginBottom: '8px', color: 'var(--theia-foreground)' }}
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
                    <strong>Zone cible:</strong> {zoneName || `#${zoneId}`}
                </p>
                <p style={{ fontSize: '11px', color: 'var(--theia-descriptionForeground)', margin: '8px 0 0 0' }}>
                    💡 <strong>Compte Premium requis:</strong> Les Pocket Queries sont une fonctionnalité Premium de Geocaching.com. Assurez-vous d'être connecté avec un compte Premium dans votre navigateur.
                </p>
            </div>

            <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'flex', alignItems: 'center', fontSize: '13px', cursor: isImporting ? 'not-allowed' : 'pointer' }}>
                    <input
                        type="checkbox"
                        checked={updateExisting}
                        onChange={(e) => setUpdateExisting(e.target.checked)}
                        disabled={isImporting}
                        style={{ marginRight: '8px', cursor: isImporting ? 'not-allowed' : 'pointer' }}
                    />
                    <span style={{ color: 'var(--theia-foreground)' }}>
                        Mettre à jour les géocaches déjà présentes
                    </span>
                </label>
                <p style={{ fontSize: '11px', color: 'var(--theia-descriptionForeground)', marginTop: '4px', marginLeft: '24px' }}>
                    Si coché, les géocaches déjà importées sont rafraîchies (nom, statut, difficulté…).
                    Vos coordonnées résolues localement et notes personnelles sont préservées.
                </p>
            </div>
        </ImportDialogShell>
    );
};
