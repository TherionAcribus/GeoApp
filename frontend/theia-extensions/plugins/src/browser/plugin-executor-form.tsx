import * as React from '@theia/core/shared/react';
import type { GeocacheContext } from './plugin-executor-widget';

export const AnalysisWebPagePanel: React.FC<{
    pipeline?: Array<{ plugin_name?: string; description?: string }>;
    geocacheContext?: GeocacheContext;
    autoExecute: boolean;
    isExecuting: boolean;
}> = ({ pipeline, geocacheContext, autoExecute, isExecuting }) => {
    const steps = Array.isArray(pipeline) ? pipeline : [];

    return (
        <div className='plugin-form'>
            <h4>Analyse complète de page</h4>
            <div style={{ fontSize: '12px', opacity: 0.8, marginBottom: '10px' }}>
                {geocacheContext?.gcCode ? (
                    <>Pipeline dédié à <strong>{geocacheContext.gcCode}</strong>{geocacheContext.name ? ` - ${geocacheContext.name}` : ''}</>
                ) : (
                    <>Pipeline dédié à l'analyse complète du listing</>
                )}
                {autoExecute ? (
                    <span style={{ marginLeft: 8 }}>
                        {isExecuting ? 'Execution en cours...' : 'Execution automatique activee'}
                    </span>
                ) : undefined}
            </div>
            {steps.length > 0 ? (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '8px' }}>
                    {steps.map((step, index) => (
                        <div
                            key={`${step.plugin_name || 'step'}-${index}`}
                            style={{
                                border: '1px solid var(--theia-panel-border)',
                                borderRadius: '4px',
                                padding: '8px 10px',
                                background: 'var(--theia-editor-background)',
                                minHeight: '58px',
                            }}
                        >
                            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '4px' }}>
                                <span style={{
                                    fontSize: '10px',
                                    minWidth: '22px',
                                    textAlign: 'center',
                                    padding: '1px 4px',
                                    borderRadius: '3px',
                                    background: 'var(--theia-input-background)',
                                    border: '1px solid var(--theia-panel-border)'
                                }}>
                                    {index + 1}
                                </span>
                                <strong>{step.plugin_name || 'Plugin'}</strong>
                            </div>
                            {step.description ? (
                                <div style={{ fontSize: '11px', opacity: 0.75 }}>{step.description}</div>
                            ) : undefined}
                        </div>
                    ))}
                </div>
            ) : (
                <div style={{ fontSize: '12px', opacity: 0.7 }}>
                    Pipeline non décrit par le plugin, mais le méta-plugin sera lancé avec le contexte de la géocache.
                </div>
            )}
        </div>
    );
};

/** Taille maximale par défaut (Mo) pour un champ de type `file`. */
const DEFAULT_MAX_FILE_SIZE_MB = 25;

function formatFileSize(bytes: number): string {
    if (bytes < 1024) {
        return `${bytes} o`;
    }
    if (bytes < 1024 * 1024) {
        return `${(bytes / 1024).toFixed(1)} Ko`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

/** Encode un fichier en base64 sans saturer la pile d'appels sur les gros fichiers. */
async function fileToBase64(file: File): Promise<string> {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const chunkSize = 0x8000;
    let binary = '';
    for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
}

/**
 * Champ de sélection de fichier : clic ou glisser-déposer.
 * La valeur du champ est le contenu encodé en base64 ; le nom du fichier est
 * recopié dans le champ désigné par `filename_field` du plugin.json.
 */
export const FileInputField: React.FC<{
    fieldKey: string;
    schema: any;
    values: Record<string, any>;
    onChange: (key: string, value: any) => void;
    disabled: boolean;
    metaField?: any;
}> = ({ fieldKey, schema, values, onChange, disabled, metaField }) => {
    const inputRef = React.useRef<HTMLInputElement>(null);
    const [isDragging, setIsDragging] = React.useState(false);
    const [error, setError] = React.useState<string | undefined>(undefined);
    const [isReading, setIsReading] = React.useState(false);

    const accept: string = schema.accept ?? metaField?.accept ?? '';
    const filenameField: string | undefined = schema.filename_field ?? metaField?.filename_field;
    const clearFields: string[] = schema.clear_fields ?? metaField?.clear_fields ?? [];
    const maxSizeMb: number = schema.max_size_mb ?? metaField?.max_size_mb ?? DEFAULT_MAX_FILE_SIZE_MB;

    const content = typeof values[fieldKey] === 'string' ? values[fieldKey] as string : '';
    const hasContent = content.length > 0;
    const storedName = filenameField ? values[filenameField] : undefined;
    const displayName = (typeof storedName === 'string' && storedName) || (hasContent ? 'Fichier chargé' : '');
    // Le base64 fait 4 caractères pour 3 octets : suffisant pour un affichage indicatif.
    const approxSize = hasContent ? Math.floor((content.length * 3) / 4) : 0;

    const handleFile = React.useCallback(async (file: File | undefined) => {
        if (!file) {
            return;
        }
        setError(undefined);
        if (maxSizeMb > 0 && file.size > maxSizeMb * 1024 * 1024) {
            setError(`Fichier trop volumineux (${formatFileSize(file.size)}), maximum ${maxSizeMb} Mo.`);
            return;
        }
        setIsReading(true);
        try {
            const base64 = await fileToBase64(file);
            onChange(fieldKey, base64);
            if (filenameField) {
                onChange(filenameField, file.name);
            }
            for (const other of clearFields) {
                onChange(other, '');
            }
        } catch (e) {
            setError(`Lecture du fichier impossible: ${(e as Error)?.message || String(e)}`);
        } finally {
            setIsReading(false);
        }
    }, [fieldKey, filenameField, clearFields, maxSizeMb, onChange]);

    const handleClear = React.useCallback(() => {
        setError(undefined);
        onChange(fieldKey, '');
        if (filenameField) {
            onChange(filenameField, '');
        }
        if (inputRef.current) {
            inputRef.current.value = '';
        }
    }, [fieldKey, filenameField, onChange]);

    const openPicker = () => {
        if (!disabled && !isReading) {
            inputRef.current?.click();
        }
    };

    return (
        <div className='file-input-field'>
            <input
                ref={inputRef}
                type='file'
                accept={accept || undefined}
                style={{ display: 'none' }}
                onChange={(e) => {
                    const file = e.target.files?.[0];
                    // Réinitialiser pour qu'une re-sélection du même fichier redéclenche l'événement.
                    e.target.value = '';
                    void handleFile(file);
                }}
                disabled={disabled}
            />
            <div
                className={`file-input-dropzone${isDragging ? ' dragging' : ''}${disabled ? ' disabled' : ''}`}
                onClick={openPicker}
                onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        openPicker();
                    }
                }}
                onDragOver={(e) => { e.preventDefault(); if (!disabled) { setIsDragging(true); } }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(e) => {
                    e.preventDefault();
                    setIsDragging(false);
                    if (disabled) {
                        return;
                    }
                    void handleFile(e.dataTransfer?.files?.[0]);
                }}
                role='button'
                tabIndex={disabled ? -1 : 0}
                aria-label='Sélectionner un fichier'
            >
                {isReading ? (
                    <span className='file-input-hint'>Lecture du fichier...</span>
                ) : hasContent ? (
                    <>
                        <span className='file-input-name' title={displayName}>📄 {displayName}</span>
                        <span className='file-input-hint'>{formatFileSize(approxSize)}</span>
                    </>
                ) : (
                    <>
                        <span className='file-input-name'>📁 Choisir un fichier</span>
                        <span className='file-input-hint'>
                            ou glissez-déposez le fichier ici{accept ? ` (${accept})` : ''}
                        </span>
                    </>
                )}
            </div>
            {hasContent && !isReading && (
                <button
                    type='button'
                    className='theia-button secondary file-input-clear'
                    onClick={(e) => { e.stopPropagation(); handleClear(); }}
                    disabled={disabled}
                >
                    Retirer le fichier
                </button>
            )}
            {error && <div className='file-input-error'>{error}</div>}
        </div>
    );
};

/**
 * Génère le formulaire dynamique basé sur le schéma JSON
 * Filtre les champs techniques déjà gérés ailleurs (mode, text, input_text)
 */
export function renderDynamicForm(
    schema: any,
    values: Record<string, any>,
    onChange: (key: string, value: any) => void,
    disabled: boolean,
    metadata?: any
): React.ReactNode {
    if (!schema?.properties) {
        return <div>Aucun paramètre requis</div>;
    }

    // Filtrer les champs techniques déjà gérés ailleurs, ainsi que les champs
    // marqués `hidden` dans le plugin.json (renseignés par un autre champ).
    const technicalFields = ['mode', 'text', 'input_text'];
    const filteredEntries = Object.entries(schema.properties).filter(
        ([key, propSchema]) => !technicalFields.includes(key) && (propSchema as any)?.hidden !== true
    );
    
    if (filteredEntries.length === 0) {
        return <div style={{ fontSize: '13px', opacity: 0.7 }}>Aucun paramètre supplémentaire requis</div>;
    }

    // Construire un map de labels pour les options de type select
    const inputTypes = metadata?.input_types || {};

    return filteredEntries.map(([key, propSchema]) => {
        const prop = propSchema as any;
        const value = values[key];
        const isRequired = schema.required?.includes(key);
        const metaField = inputTypes[key];

        return (
            <div key={key} className='form-field'>
                <label>
                    {prop.title || key}
                    {isRequired && <span className='required'>*</span>}
                </label>
                {prop.description && <div className='field-description'>{prop.description}</div>}
                {renderInputField(key, prop, value, onChange, disabled, metaField, values)}
            </div>
        );
    });
}

/**
 * Génère le champ d'entrée approprié selon le type
 */
export function renderInputField(
    key: string,
    schema: any,
    value: any,
    onChange: (key: string, value: any) => void,
    disabled: boolean,
    metaField?: any,
    allValues?: Record<string, any>
): React.ReactNode {
    // Fichier -> sélecteur + zone de glisser-déposer
    if (schema.format === 'file') {
        return (
            <FileInputField
                fieldKey={key}
                schema={schema}
                values={allValues || {}}
                onChange={onChange}
                disabled={disabled}
                metaField={metaField}
            />
        );
    }

    // Enum -> Select (with optional labels from metadata)
    if (schema.enum) {
        // Build a value->label map from metadata options if available
        const labelMap: Record<string, string> = {};
        const metaOptions = metaField?.options;
        if (Array.isArray(metaOptions)) {
            for (const opt of metaOptions) {
                if (typeof opt === 'object' && opt.value !== undefined) {
                    labelMap[String(opt.value)] = opt.label || String(opt.value);
                }
            }
        }

        return (
            <select
                value={value || ''}
                onChange={(e) => onChange(key, e.target.value)}
                disabled={disabled}
            >
                {schema.enum.map((option: string) => (
                    <option key={option} value={option}>{labelMap[option] || option}</option>
                ))}
            </select>
        );
    }

    // Boolean -> Checkbox
    if (schema.type === 'boolean') {
        return (
            <input
                type='checkbox'
                checked={!!value}
                onChange={(e) => onChange(key, e.target.checked)}
                disabled={disabled}
            />
        );
    }

    // Number/Integer -> Number input
    if (schema.type === 'number' || schema.type === 'integer') {
        // Laisser le champ se vider (value '' plutôt que 0 forcé) et ne jamais
        // transmettre NaN au backend : un champ vide => valeur non définie
        // (le plugin appliquera son défaut).
        const displayValue = (value === undefined || value === null) ? '' : value;
        return (
            <input
                type='number'
                value={displayValue}
                min={schema.minimum}
                max={schema.maximum}
                step={schema.type === 'integer' ? 1 : (schema.multipleOf ?? 'any')}
                placeholder={schema.placeholder}
                onChange={(e) => {
                    const raw = e.target.value;
                    if (raw === '') {
                        onChange(key, undefined);
                        return;
                    }
                    const parsed = schema.type === 'integer' ? parseInt(raw, 10) : parseFloat(raw);
                    onChange(key, Number.isNaN(parsed) ? undefined : parsed);
                }}
                disabled={disabled}
            />
        );
    }

    // String avec format multiline -> Textarea
    if (schema.type === 'string' && schema.format === 'multiline') {
        return (
            <textarea
                value={value || ''}
                placeholder={schema.placeholder}
                onChange={(e) => onChange(key, e.target.value)}
                disabled={disabled}
                rows={5}
            />
        );
    }

    // String -> Text input par défaut
    return (
        <input
            type='text'
            value={value || ''}
            placeholder={schema.placeholder}
            onChange={(e) => onChange(key, e.target.value)}
            disabled={disabled}
        />
    );
}
