import * as React from 'react';
import { ImportDialogShell, ImportCounts, ImportProgressCallback } from './import-dialog-shell';

interface BookmarkList {
    code: string;
    name: string;
    count: number;
    url: string;
}

export interface ImportBookmarkListDialogProps {
    zoneId: number;
    zoneName?: string;
    onImport: (bookmarkCode: string, updateExisting: boolean, onProgress?: ImportProgressCallback) => Promise<void>;
    onCancel: () => void;
    onCancelImport?: () => void;
    isImporting: boolean;
    backendUrl?: string;
}

export const ImportBookmarkListDialog: React.FC<ImportBookmarkListDialogProps> = ({
    zoneId,
    zoneName,
    onImport,
    onCancel,
    onCancelImport,
    isImporting,
    backendUrl = 'http://localhost:8000'
}) => {
    const [lists, setLists] = React.useState<BookmarkList[]>([]);
    const [selectedCode, setSelectedCode] = React.useState('');
    const [updateExisting, setUpdateExisting] = React.useState(false);
    const [loading, setLoading] = React.useState(true);
    const [error, setError] = React.useState('');
    const [progressVisible, setProgressVisible] = React.useState(false);
    const [progressPercentage, setProgressPercentage] = React.useState(0);
    const [progressMessage, setProgressMessage] = React.useState('');
    const [counts, setCounts] = React.useState<ImportCounts | undefined>(undefined);
    const [errorItems, setErrorItems] = React.useState<string[]>([]);

    React.useEffect(() => {
        const fetchLists = async () => {
            try {
                setLoading(true);
                setError('');
                const response = await fetch(`${backendUrl}/api/geocaches/user-bookmark-lists`);
                if (!response.ok) {
                    throw new Error('Impossible de récupérer les listes');
                }
                const data = await response.json();
                setLists(data.lists || []);
                if (data.lists && data.lists.length > 0) {
                    setSelectedCode(data.lists[0].code);
                }
            } catch (err) {
                setError('Erreur lors du chargement des listes. Assurez-vous d\'être connecté à geocaching.com.');
                console.error('Failed to fetch bookmark lists:', err);
            } finally {
                setLoading(false);
            }
        };
        fetchLists();
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
        if (selectedCode) {
            resetProgress();
            await onImport(selectedCode, updateExisting, handleProgressUpdate);
        }
    };

    const selectedList = React.useMemo(() => {
        return lists.find(l => l.code === selectedCode);
    }, [lists, selectedCode]);

    return (
        <ImportDialogShell
            title="Importer depuis une liste de favoris"
            isImporting={isImporting}
            canSubmit={!!selectedCode && !loading && lists.length > 0}
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
                    Chargement de vos listes...
                </div>
            ) : error ? (
                <div style={{ marginBottom: '16px', padding: '12px', backgroundColor: 'var(--theia-inputValidation-errorBackground)', borderRadius: '4px' }}>
                    <p style={{ fontSize: '13px', color: 'var(--theia-errorForeground)', margin: 0 }}>
                        {error}
                    </p>
                </div>
            ) : lists.length === 0 ? (
                <div style={{ marginBottom: '16px', padding: '12px', backgroundColor: 'var(--theia-input-background)', borderRadius: '4px' }}>
                    <p style={{ fontSize: '13px', color: 'var(--theia-descriptionForeground)', margin: 0 }}>
                        Aucune liste de favoris trouvée. Créez-en une sur geocaching.com.
                    </p>
                </div>
            ) : (
                <div style={{ marginBottom: '16px' }}>
                    <label
                        htmlFor="listSelect"
                        style={{ display: 'block', fontSize: '13px', marginBottom: '8px', color: 'var(--theia-foreground)' }}
                    >
                        Sélectionnez une liste de favoris
                    </label>
                    <select
                        id="listSelect"
                        value={selectedCode}
                        onChange={(e) => setSelectedCode(e.target.value)}
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
                        {lists.map(list => (
                            <option key={list.code} value={list.code}>
                                {list.name} ({list.count} caches)
                            </option>
                        ))}
                    </select>
                    {selectedList && (
                        <p style={{ fontSize: '11px', color: 'var(--theia-descriptionForeground)', marginTop: '4px' }}>
                            Code: {selectedList.code}
                        </p>
                    )}
                </div>
            )}

            <div style={{ marginBottom: '16px', padding: '12px', backgroundColor: 'var(--theia-input-background)', borderRadius: '4px' }}>
                <p style={{ fontSize: '12px', color: 'var(--theia-descriptionForeground)', margin: 0 }}>
                    <strong>Zone cible:</strong> {zoneName || `#${zoneId}`}
                </p>
                <p style={{ fontSize: '11px', color: 'var(--theia-descriptionForeground)', margin: '8px 0 0 0' }}>
                    💡 Les géocaches de la liste seront importées dans cette zone. Assurez-vous d'être connecté à geocaching.com dans votre navigateur.
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
