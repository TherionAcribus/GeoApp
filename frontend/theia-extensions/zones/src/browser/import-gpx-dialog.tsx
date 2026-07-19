import * as React from 'react';
import { ImportDialogShell, ImportCounts, ImportProgressCallback } from './import-dialog-shell';

export interface ImportGpxDialogProps {
    zoneId: number;
    onImport: (file: File, updateExisting: boolean, onProgress?: ImportProgressCallback) => Promise<void>;
    onCancel: () => void;
    onCancelImport?: () => void;
    isImporting: boolean;
}

export const ImportGpxDialog: React.FC<ImportGpxDialogProps> = ({
    onImport,
    onCancel,
    onCancelImport,
    isImporting
}) => {
    const [selectedFile, setSelectedFile] = React.useState<File | null>(null);
    const [updateExisting, setUpdateExisting] = React.useState(false);
    const [dragOver, setDragOver] = React.useState(false);
    const [progressVisible, setProgressVisible] = React.useState(false);
    const [progressPercentage, setProgressPercentage] = React.useState(0);
    const [progressMessage, setProgressMessage] = React.useState('');
    const [counts, setCounts] = React.useState<ImportCounts | undefined>(undefined);
    const [errorItems, setErrorItems] = React.useState<string[]>([]);
    const fileInputRef = React.useRef<HTMLInputElement>(null);

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

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            setSelectedFile(e.target.files[0]);
        }
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setDragOver(false);
        if (isImporting) { return; }
        const file = e.dataTransfer.files && e.dataTransfer.files[0];
        if (file && /\.(gpx|zip)$/i.test(file.name)) {
            setSelectedFile(file);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (selectedFile) {
            resetProgress();
            await onImport(selectedFile, updateExisting, handleProgressUpdate);
        }
    };

    return (
        <ImportDialogShell
            title="Importer des géocaches"
            isImporting={isImporting}
            canSubmit={!!selectedFile}
            onSubmit={handleSubmit}
            onCancel={onCancel}
            onCancelImport={onCancelImport}
            progressVisible={progressVisible}
            progressPercentage={progressPercentage}
            progressMessage={progressMessage}
            counts={counts}
            errorItems={errorItems}
        >
            <div style={{ marginBottom: '16px' }}>
                <label
                    htmlFor="gpxFileInput"
                    style={{ display: 'block', fontSize: '13px', marginBottom: '8px', color: 'var(--theia-foreground)' }}
                >
                    Fichier GPX ou ZIP
                </label>
                <div
                    onDragOver={(e) => { e.preventDefault(); if (!isImporting) { setDragOver(true); } }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={handleDrop}
                    onClick={() => { if (!isImporting) { fileInputRef.current?.click(); } }}
                    style={{
                        display: 'block',
                        width: '100%',
                        padding: '16px',
                        textAlign: 'center',
                        backgroundColor: dragOver ? 'var(--theia-list-dropBackground, var(--theia-input-background))' : 'var(--theia-input-background)',
                        color: 'var(--theia-input-foreground)',
                        border: `1px dashed ${dragOver ? 'var(--theia-focusBorder)' : 'var(--theia-input-border)'}`,
                        borderRadius: '4px',
                        cursor: isImporting ? 'not-allowed' : 'pointer',
                        boxSizing: 'border-box'
                    }}
                >
                    {selectedFile
                        ? `📄 ${selectedFile.name}`
                        : 'Glissez un fichier ici, ou cliquez pour parcourir'}
                </div>
                <input
                    ref={fileInputRef}
                    type="file"
                    id="gpxFileInput"
                    accept=".gpx,.zip"
                    onChange={handleFileChange}
                    disabled={isImporting}
                    style={{ display: 'none' }}
                />
                <p style={{ fontSize: '11px', color: 'var(--theia-descriptionForeground)', marginTop: '4px' }}>
                    Formats acceptés: .gpx (Pocket Query) ou .zip contenant des fichiers GPX
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
                    Si coché, les géocaches déjà importées sont mises à jour avec les données du fichier
                    (nom, coordonnées, difficulté…). Vos coordonnées résolues localement et notes personnelles sont préservées.
                </p>
            </div>
        </ImportDialogShell>
    );
};
