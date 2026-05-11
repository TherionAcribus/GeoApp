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

    // Filtrer les champs techniques déjà gérés ailleurs
    const technicalFields = ['mode', 'text', 'input_text'];
    const filteredEntries = Object.entries(schema.properties).filter(
        ([key]) => !technicalFields.includes(key)
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
                {renderInputField(key, prop, value, onChange, disabled, metaField)}
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
    metaField?: any
): React.ReactNode {
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
        return (
            <input
                type='number'
                value={value || 0}
                min={schema.minimum}
                max={schema.maximum}
                step={schema.type === 'integer' ? 1 : 'any'}
                onChange={(e) => onChange(key, parseFloat(e.target.value))}
                disabled={disabled}
            />
        );
    }

    // String avec format multiline -> Textarea
    if (schema.type === 'string' && schema.format === 'multiline') {
        return (
            <textarea
                value={value || ''}
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
            onChange={(e) => onChange(key, e.target.value)}
            disabled={disabled}
        />
    );
}
