import * as React from 'react';

export interface ImportGpxDialogProps {
    zoneId: number;
    onImport: (file: File, updateExisting: boolean, onProgress?: (percentage: number, message: string) => void) => Promise<void>;
    onCancel: () => void;
    isImporting: boolean;
}

export const ImportGpxDialog: React.FC<ImportGpxDialogProps> = ({
    zoneId,
    onImport,
    onCancel,
    isImporting
}) => {
    const [selectedFile, setSelectedFile] = React.useState<File | null>(null);
    const [updateExisting, setUpdateExisting] = React.useState(false);
    const [progressVisible, setProgressVisible] = React.useState(false);
    const [progressPercentage, setProgressPercentage] = React.useState(0);
    const [progressMessage, setProgressMessage] = React.useState('');
    const fileInputRef = React.useRef<HTMLInputElement>(null);

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

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            setSelectedFile(e.target.files[0]);
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
                        Importer des géocaches
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
                            opacity: isImporting ? 0.5 : 1
                        }}
                    >
                        ✕
                    </button>
                </div>

                <form onSubmit={handleSubmit}>
                    <div style={{ marginBottom: '16px' }}>
                        <label 
                            htmlFor="gpxFileInput"
                            style={{ 
                                display: 'block', 
                                fontSize: '13px', 
                                marginBottom: '8px',
                                color: 'var(--theia-foreground)'
                            }}
                        >
                            Fichier GPX ou ZIP
                        </label>
                        <input
                            ref={fileInputRef}
                            type="file"
                            id="gpxFileInput"
                            accept=".gpx,.zip"
                            onChange={handleFileChange}
                            disabled={isImporting}
                            required
                            style={{
                                display: 'block',
                                width: '100%',
                                padding: '8px',
                                backgroundColor: 'var(--theia-input-background)',
                                color: 'var(--theia-input-foreground)',
                                border: '1px solid var(--theia-input-border)',
                                borderRadius: '4px',
                                cursor: isImporting ? 'not-allowed' : 'pointer'
                            }}
                        />
                        <p style={{ fontSize: '11px', color: 'var(--theia-descriptionForeground)', marginTop: '4px' }}>
                            Formats acceptés: .gpx (Pocket Query) ou .zip contenant des fichiers GPX
                        </p>
                    </div>

                    <div style={{ marginBottom: '16px' }}>
                        <label style={{ display: 'flex', alignItems: 'center', fontSize: '13px', cursor: 'pointer' }}>
                            <input
                                type="checkbox"
                                checked={updateExisting}
                                onChange={(e) => setUpdateExisting(e.target.checked)}
                                disabled={isImporting}
                                style={{ marginRight: '8px', cursor: isImporting ? 'not-allowed' : 'pointer' }}
                            />
                            <span style={{ color: 'var(--theia-foreground)' }}>
                                Mettre à jour les waypoints des géocaches existantes
                            </span>
                        </label>
                        <p style={{ fontSize: '11px', color: 'var(--theia-descriptionForeground)', marginTop: '4px', marginLeft: '24px' }}>
                            Si coché, les waypoints additionnels seront ajoutés aux géocaches déjà existantes
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
                            disabled={!selectedFile || isImporting}
                            style={{
                                padding: '8px 16px',
                                backgroundColor: (!selectedFile || isImporting) ? 'var(--theia-button-disabledBackground)' : 'var(--theia-button-background)',
                                color: (!selectedFile || isImporting) ? 'var(--theia-button-disabledForeground)' : 'var(--theia-button-foreground)',
                                border: 'none',
                                borderRadius: '4px',
                                cursor: (!selectedFile || isImporting) ? 'not-allowed' : 'pointer',
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

