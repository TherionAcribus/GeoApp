import * as React from 'react';
import { injectable, inject } from '@theia/core/shared/inversify';
import { CommandService } from '@theia/core';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { PreferenceScope } from '@theia/core/lib/common/preferences/preference-scope';

import { GeoPreferenceStore, GeoPreferenceSnapshot } from './geo-preference-store';
import { GeoPreferenceDefinition, GeoPreferenceKey } from './geo-preferences-schema';

@injectable()
export class GeoPreferencesWidget extends ReactWidget {

    static readonly ID = 'geo-preferences-widget';
    static readonly LABEL = 'Préférences GeoApp';

    protected snapshot: GeoPreferenceSnapshot = {};

    constructor(
        @inject(GeoPreferenceStore) private readonly store: GeoPreferenceStore,
        @inject(CommandService) private readonly commandService: CommandService,
    ) {
        super();
        this.id = GeoPreferencesWidget.ID;
        this.title.label = GeoPreferencesWidget.LABEL;
        this.title.caption = GeoPreferencesWidget.LABEL;
        this.title.closable = true;
        this.title.iconClass = 'codicon codicon-settings-gear';
        this.addClass('geo-preferences-widget');

        this.snapshot = this.store.getSnapshot();
        this.store.onDidChange(change => {
            this.snapshot = {
                ...this.snapshot,
                [change.key]: change.value
            };
            this.update();
        });

        this.update();
    }

    private openAiConfiguration = async (): Promise<void> => {
        try {
            await this.commandService.executeCommand('aiConfiguration:open');
        } catch (error) {
            console.error('[GeoPreferencesWidget] Failed to open AI Configuration view', error);
        }
    };

    protected render(): React.ReactNode {
        const sections = Array.from(this.store.definitionsByCategory.entries())
            .sort(([a], [b]) => a.localeCompare(b));

        const backendUrl = String(this.snapshot['geoApp.backend.apiBaseUrl'] ?? 'http://localhost:8000');

        return <div className='geo-preferences-root'>
            <div className='geo-preferences-status'>
                <span>API Flask : {backendUrl}</span>
            </div>
            {sections.map(([category, entries]) => (
                <section key={category} className='geo-preferences-section'>
                    <header>
                        <div className='flex items-center justify-between gap-2'>
                            <h2>{this.toCategoryLabel(category)}</h2>
                            {category === 'ocr' && (
                                <button
                                    className='theia-button secondary'
                                    type='button'
                                    onClick={() => { void this.openAiConfiguration(); }}
                                    title='Ouvrir la configuration IA pour choisir le modèle utilisé par GeoApp OCR (Cloud)'
                                >
                                    Configurer OCR (IA)
                                </button>
                            )}
                            {category === 'ai' && (
                                <button
                                    className='theia-button secondary'
                                    type='button'
                                    onClick={() => { void this.openAiConfiguration(); }}
                                    title='Ouvrir la configuration IA pour choisir le modèle utilisé par les agents Theia (ex: Traduction GeoApp)'
                                >
                                    Configurer Agent Theia (IA)
                                </button>
                            )}
                        </div>
                    </header>
                    <div className='geo-preferences-items'>
                        {entries.map(({ key, definition }) => this.renderPreference(key, definition))}
                    </div>
                </section>
            ))}
        </div>;
    }

    private renderPreference(key: GeoPreferenceKey, definition: GeoPreferenceDefinition): React.ReactNode {
        const currentValue = this.snapshot[key];
        const description = definition.description;
        const label = definition.title ?? this.toPreferenceLabel(key);
        const targets = definition['x-targets'] ?? ['frontend'];
        const backend = targets.includes('backend');

        return (
            <div key={key} className='geo-preference-item'>
                <div className='geo-preference-main'>
                    <label htmlFor={key}>{label}</label>
                    {this.renderControl(key, definition, currentValue)}
                </div>
                <div className='geo-preference-meta'>
                    {description && <p>{description}</p>}
                    <div className='geo-preference-tags'>
                        <span className='geo-preference-tag'>{definition['x-category'] || 'général'}</span>
                        {backend && <span className='geo-preference-tag backend'>Flask</span>}
                        {targets.includes('frontend') && <span className='geo-preference-tag frontend'>Theia</span>}
                    </div>
                </div>
            </div>
        );
    }

    private renderControl(key: GeoPreferenceKey, definition: GeoPreferenceDefinition, value: unknown): React.ReactNode {
        if (definition.type === 'boolean') {
            return (
                <input
                    id={key}
                    type='checkbox'
                    checked={Boolean(value)}
                    onChange={event => this.handleBooleanChange(key, event.currentTarget.checked)}
                />
            );
        }

        if ((definition.type === 'string' || definition.type === 'number' || definition.type === 'integer') && Array.isArray(definition.enum)) {
            return (
                <select
                    id={key}
                    value={String(value ?? definition.default ?? '')}
                    onChange={event => this.handleSelectChange(key, event.currentTarget.value, definition)}
                >
                    {definition.enum.map((option: string | number) => (
                        <option key={option} value={option}>
                            {option}
                        </option>
                    ))}
                </select>
            );
        }

        if (definition.type === 'number' || definition.type === 'integer') {
            return (
                <input
                    id={key}
                    type='number'
                    value={Number(value ?? definition.default ?? 0)}
                    min={definition.minimum as number | undefined}
                    max={definition.maximum as number | undefined}
                    step={definition.type === 'integer' ? 1 : 0.1}
                    onChange={event => this.handleNumericChange(key, event.currentTarget.value, definition)}
                />
            );
        }

        return (
            <input
                id={key}
                type='text'
                value={String(value ?? definition.default ?? '')}
                    onChange={event => this.handleTextChange(key, event.currentTarget.value)}
            />
        );
    }

    private async handleBooleanChange(key: string, value: boolean): Promise<void> {
        await this.store.setValue(key, value, PreferenceScope.User);
    }

    private async handleTextChange(key: string, value: string): Promise<void> {
        await this.store.setValue(key, value, PreferenceScope.User);
    }

    private async handleSelectChange(key: string, rawValue: string, definition: GeoPreferenceDefinition): Promise<void> {
        let value: string | number = rawValue;
        if ((definition.type === 'number' || definition.type === 'integer') && rawValue !== '') {
            value = definition.type === 'integer' ? parseInt(rawValue, 10) : parseFloat(rawValue);
        }
        await this.store.setValue(key, value, PreferenceScope.User);
    }

    private async handleNumericChange(key: string, rawValue: string, definition: GeoPreferenceDefinition): Promise<void> {
        if (rawValue === '') {
            return;
        }
        const parsed = definition.type === 'integer'
            ? parseInt(rawValue, 10)
            : parseFloat(rawValue);
        await this.store.setValue(key, parsed, PreferenceScope.User);
    }

    private toCategoryLabel(category: string): string {
        const map: Record<string, string> = {
            ai: 'Intelligence Artificielle',
            ui: 'Interface utilisateur',
            alphabets: 'Alphabets',
            map: 'Carte',
            updates: 'Mises à jour',
            search: 'Recherche',
            checkers: 'Checkers',
            plugins: 'Plugins',
            backend: 'Backend',
            notes: 'Notes',
            generic: 'Général'
        };
        return map[category] ?? category;
    }

    private toPreferenceLabel(key: string): string {
        const raw = key.split('.').pop() ?? key;
        return raw
            .replace(/([A-Z])/g, ' $1')
            .replace(/-/g, ' ')
            .replace(/_/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .replace(/^\w/, char => char.toUpperCase());
    }
}

