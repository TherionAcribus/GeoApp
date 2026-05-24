import * as React from 'react';
import { injectable, inject } from '@theia/core/shared/inversify';
import { CommandService } from '@theia/core';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { PreferenceScope } from '@theia/core/lib/common/preferences/preference-scope';

import { GeoPreferenceStore, GeoPreferenceSnapshot } from './geo-preference-store';
import { GeoPreferenceDefinition, GeoPreferenceKey } from './geo-preferences-schema';

export interface GeoPreferencesOpenOptions {
    category?: string;
    key?: string;
    query?: string;
}

type GeoPreferenceTargetFilter = 'all' | 'frontend' | 'backend';
type GeoPreferenceValueFilter = 'all' | 'modified';

interface GeoPreferenceSection {
    category: string;
    label: string;
    entries: Array<{ key: GeoPreferenceKey; definition: GeoPreferenceDefinition }>;
    filteredEntries: Array<{ key: GeoPreferenceKey; definition: GeoPreferenceDefinition }>;
}

const CATEGORY_LABELS: Record<string, string> = {
    ai: 'Intelligence artificielle',
    chat: 'Chat IA GeoApp',
    formulaSolver: 'Formula Solver',
    earthcoach: 'EarthCoach',
    ui: 'Interface et onglets',
    alphabets: 'Alphabets',
    map: 'Carte',
    updates: 'Mises à jour',
    search: 'Recherche',
    checkers: 'Checkers',
    auth: 'Authentification',
    plugins: 'Plugins et MetaSolver',
    backend: 'Backend',
    ocr: 'OCR',
    images: 'Images',
    notes: 'Notes et GPX',
    logs: 'Logs',
    archive: 'Archive',
    generic: 'Général'
};

const CATEGORY_ORDER = [
    'ai',
    'chat',
    'earthcoach',
    'map',
    'checkers',
    'auth',
    'plugins',
    'ui',
    'notes',
    'ocr',
    'images',
    'alphabets',
    'archive',
    'backend',
    'updates',
    'search',
    'logs',
    'generic'
];

const ENUM_VALUE_LABELS: Record<string, string> = {
    true: 'Active',
    false: 'Désactivé',
    local: 'Local',
    fast: 'Rapide',
    strong: 'Raisonnement renforcé',
    web: 'Web',
    default: 'Par défaut',
    guided: 'Guidé',
    safe: 'Prudent',
    offline: 'Hors ligne',
    automation: 'Automatisation',
    debug: 'Diagnostic',
    workflow: 'Selon le workflow',
    minimal: 'Minimal',
    full: 'Complet',
    disabled: 'Désactivé',
    manual: 'Manuel',
    confident: 'Si confiance suffisante',
    algorithm: 'Algorithme',
    ai: 'IA',
    none: 'Aucun',
    'ai-bulk': 'IA en masse',
    'ai-per-question': 'IA question par question',
    'smart-replace': 'Remplacement intelligent',
    'always-new-tab': 'Toujours nouvel onglet',
    'always-replace': 'Toujours remplacer',
    'same-group': 'Même groupe',
    'new-group': 'Nouveau groupe',
    'external-window': 'Fenêtre externe',
    'new-tab': 'Nouvel onglet',
    'new-window': 'Nouvelle fenetre',
    transparent: 'Transparent',
    hidden: 'Masqué',
    'found-icon': 'Icône trouvée',
    osm: 'OpenStreetMap',
    satellite: 'Satellite',
    topographic: 'Topographique',
    credentials: 'Identifiants',
    browser_cookies: 'Cookies navigateur',
    auto: 'Automatique',
    original: 'Originale',
    modified: 'Modifiée',
    logs: 'Logs',
    listing: 'Listing',
    fr: 'Français',
    en: 'Anglais'
};

@injectable()
export class GeoPreferencesWidget extends ReactWidget {

    static readonly ID = 'geo-preferences-widget';
    static readonly LABEL = 'Préférences GeoApp';

    protected snapshot: GeoPreferenceSnapshot = {};
    protected highlightedCategory: string | undefined;
    protected highlightedPreferenceKey: string | undefined;
    protected expandedCategories = new Set<string>();
    protected expandedCategoriesInitialized = false;
    protected searchQuery = '';
    protected targetFilter: GeoPreferenceTargetFilter = 'all';
    protected valueFilter: GeoPreferenceValueFilter = 'all';

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

    revealCategory(category?: string): void {
        if (!category) {
            this.highlightedCategory = undefined;
            this.highlightedPreferenceKey = undefined;
            this.update();
            return;
        }
        if (!this.store.definitionsByCategory.has(category)) {
            return;
        }
        this.focusCategory(category);
    }

    revealPreference(key?: string): void {
        if (!key) {
            return;
        }
        const definition = this.store.schema.properties?.[key] as GeoPreferenceDefinition | undefined;
        if (!definition) {
            return;
        }
        const category = definition['x-category'] || 'generic';
        this.expandedCategories.add(category);
        this.highlightedCategory = category;
        this.highlightedPreferenceKey = key;
        this.update();
        window.setTimeout(() => {
            const preference = Array.from(this.node.querySelectorAll<HTMLElement>('[data-geo-preference-key]'))
                .find(element => element.dataset.geoPreferenceKey === key);
            preference?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 0);
    }

    setSearchQuery(query?: string): void {
        this.searchQuery = query ?? '';
        this.update();
    }

    private openAiConfiguration = async (): Promise<void> => {
        try {
            await this.commandService.executeCommand('aiConfiguration:open');
        } catch (error) {
            console.error('[GeoPreferencesWidget] Failed to open AI Configuration view', error);
        }
    };

    private openChatPolicy = async (): Promise<void> => {
        try {
            await this.commandService.executeCommand('geoapp.chat.policy.open');
        } catch (error) {
            console.error('[GeoPreferencesWidget] Failed to open Chat IA policy view', error);
        }
    };

    protected render(): React.ReactNode {
        const sections = this.buildSections();
        this.initializeExpandedCategories(sections.map(section => section.category));

        const visibleSections = sections.filter(section => section.filteredEntries.length > 0);
        const backendUrl = String(this.snapshot['geoApp.backend.apiBaseUrl'] ?? 'http://localhost:8000');
        const totalCount = sections.reduce((sum, section) => sum + section.entries.length, 0);
        const visibleCount = visibleSections.reduce((sum, section) => sum + section.filteredEntries.length, 0);
        const modifiedCount = this.store.definitions
            .filter(({ key, definition }) => this.isModified(key, definition))
            .length;

        return <div className='geo-preferences-root'>
            <div className='geo-preferences-toolbar'>
                <div className='geo-preferences-status'>
                    <span>API Flask : {backendUrl}</span>
                    <span>{visibleCount} / {totalCount} préférences affichées</span>
                    <span>{modifiedCount} modifiées</span>
                </div>
                <div className='geo-preferences-search-row'>
                    <input
                        type='search'
                        value={this.searchQuery}
                        placeholder='Rechercher une préférence, une valeur, un tag...'
                        onChange={event => this.handleSearchChange(event.currentTarget.value)}
                    />
                    {this.searchQuery && (
                        <button
                            className='theia-button secondary'
                            type='button'
                            onClick={() => this.handleSearchChange('')}
                            title='Effacer la recherche'
                        >
                            Effacer
                        </button>
                    )}
                </div>
                <div className='geo-preferences-filter-row'>
                    {this.renderFilterButton('Toutes', this.valueFilter === 'all' && this.targetFilter === 'all', () => {
                        this.valueFilter = 'all';
                        this.targetFilter = 'all';
                        this.update();
                    })}
                    {this.renderFilterButton('Modifiées', this.valueFilter === 'modified', () => {
                        this.valueFilter = this.valueFilter === 'modified' ? 'all' : 'modified';
                        this.update();
                    })}
                    {this.renderFilterButton('Theia', this.targetFilter === 'frontend', () => {
                        this.targetFilter = this.targetFilter === 'frontend' ? 'all' : 'frontend';
                        this.update();
                    })}
                    {this.renderFilterButton('Flask', this.targetFilter === 'backend', () => {
                        this.targetFilter = this.targetFilter === 'backend' ? 'all' : 'backend';
                        this.update();
                    })}
                </div>
            </div>

            <div className='geo-preferences-layout'>
                <aside className='geo-preferences-sidebar'>
                    {sections.map(section => this.renderSidebarEntry(section))}
                </aside>
                <div className='geo-preferences-content'>
                    {visibleSections.length === 0 && (
                        <div className='geo-preferences-empty'>
                            Aucune préférence ne correspond aux filtres actifs.
                        </div>
                    )}
                    {visibleSections.map(section => this.renderSection(section))}
                </div>
            </div>
        </div>;
    }

    private renderFilterButton(label: string, active: boolean, onClick: () => void): React.ReactNode {
        return (
            <button
                className={`theia-button secondary geo-preferences-filter-button${active ? ' active' : ''}`}
                type='button'
                onClick={onClick}
            >
                {label}
            </button>
        );
    }

    private renderSidebarEntry(section: GeoPreferenceSection): React.ReactNode {
        const total = section.entries.length;
        const visible = section.filteredEntries.length;
        const active = this.highlightedCategory === section.category;
        return (
            <button
                key={section.category}
                type='button'
                className={`geo-preferences-sidebar-entry${active ? ' active' : ''}${visible === 0 ? ' empty' : ''}`}
                onClick={() => this.focusCategory(section.category)}
                title={section.label}
            >
                <span>{section.label}</span>
                <span className='geo-preferences-sidebar-count'>{visible}/{total}</span>
            </button>
        );
    }

    private renderSection(section: GeoPreferenceSection): React.ReactNode {
        const expanded = this.searchQuery.trim()
            ? true
            : this.expandedCategories.has(section.category);
        return (
            <section
                key={section.category}
                className={`geo-preferences-section${this.highlightedCategory === section.category ? ' highlighted' : ''}`}
                data-geo-preference-category={section.category}
            >
                <header>
                    <button
                        className='geo-preferences-section-toggle'
                        type='button'
                        onClick={() => this.toggleCategory(section.category)}
                        title={expanded ? 'Replier la section' : 'Déplier la section'}
                    >
                        <span className={`codicon ${expanded ? 'codicon-chevron-down' : 'codicon-chevron-right'}`} />
                        <h2>{section.label}</h2>
                        <span className='geo-preferences-section-count'>{section.filteredEntries.length}</span>
                    </button>
                    {this.renderSectionActions(section.category)}
                </header>
                {expanded && (
                    <div className='geo-preferences-items'>
                        {section.filteredEntries.map(({ key, definition }) => this.renderPreference(key, definition))}
                    </div>
                )}
            </section>
        );
    }

    private renderSectionActions(category: string): React.ReactNode {
        if (category === 'ocr') {
            return (
                <button
                    className='theia-button secondary'
                    type='button'
                    onClick={() => { void this.openAiConfiguration(); }}
                    title='Ouvrir la configuration IA pour choisir le modèle utilisé par GeoApp OCR (Cloud)'
                >
                    Configurer OCR (IA)
                </button>
            );
        }

        if (category === 'ai') {
            return (
                <button
                    className='theia-button secondary'
                    type='button'
                    onClick={() => { void this.openAiConfiguration(); }}
                    title='Ouvrir la configuration IA pour choisir le modèle utilisé par les agents Theia'
                >
                    Configurer Agent Theia (IA)
                </button>
            );
        }

        if (category === 'chat') {
            return (
                <div className='geo-preferences-header-actions'>
                    <button
                        className='theia-button secondary'
                        type='button'
                        onClick={() => { void this.openChatPolicy(); }}
                        title='Voir la policy effective et la matrice des tools GeoApp'
                    >
                        Policy tools
                    </button>
                    <button
                        className='theia-button secondary'
                        type='button'
                        onClick={() => { void this.openAiConfiguration(); }}
                        title='Ouvrir la configuration IA Theia pour les agents, prompts et tools du chat'
                    >
                        Configurer IA Theia
                    </button>
                </div>
            );
        }

        return undefined;
    }

    private renderPreference(key: GeoPreferenceKey, definition: GeoPreferenceDefinition): React.ReactNode {
        const currentValue = this.snapshot[key];
        const description = definition.description;
        const label = definition.title ?? this.toPreferenceLabel(key);
        const targets = definition['x-targets'] ?? ['frontend'];
        const backend = targets.includes('backend');
        const modified = this.isModified(key, definition);
        const tags = definition['x-tags'] ?? [];
        const highlighted = this.highlightedPreferenceKey === key;

        return (
            <div
                key={key}
                className={`geo-preference-item${modified ? ' modified' : ''}${highlighted ? ' highlighted' : ''}`}
                data-geo-preference-key={key}
            >
                <div className='geo-preference-main'>
                    <div className='geo-preference-title'>
                        <label htmlFor={key}>{label}</label>
                        <code>{key}</code>
                    </div>
                    <div className='geo-preference-control'>
                        {this.renderControl(key, definition, currentValue)}
                        <button
                            className='theia-button secondary geo-preference-reset'
                            type='button'
                            disabled={!modified}
                            onClick={() => { void this.handleResetPreference(key, definition); }}
                            title={modified ? 'Revenir à la valeur par défaut' : 'Valeur par défaut déjà active'}
                        >
                            Réinitialiser
                        </button>
                    </div>
                </div>
                <div className='geo-preference-meta'>
                    {description && <p>{description}</p>}
                    <div className='geo-preference-tags'>
                        <span className='geo-preference-tag'>{definition['x-category'] || 'général'}</span>
                        {modified
                            ? <span className='geo-preference-tag modified'>Modifiée</span>
                            : <span className='geo-preference-tag default'>Défaut</span>}
                        {backend && <span className='geo-preference-tag backend'>Flask</span>}
                        {targets.includes('frontend') && <span className='geo-preference-tag frontend'>Theia</span>}
                        {definition['x-sensitive'] && <span className='geo-preference-tag sensitive'>Sensible</span>}
                        {tags.slice(0, 4).map(tag => (
                            <span key={tag} className='geo-preference-tag muted'>{tag}</span>
                        ))}
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
                            {this.toEnumOptionLabel(option)}
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

        if (definition.type === 'array') {
            const options = definition.items?.enum;
            if (Array.isArray(options)) {
                const values = this.getArrayValue(value, definition.default);
                return (
                    <div id={key} className='geo-preference-array'>
                        {options.map(option => {
                            const selected = values.includes(option);
                            return (
                                <label key={option} className='geo-preference-array-option'>
                                    <input
                                        type='checkbox'
                                        checked={selected}
                                        onChange={event => this.handleArrayToggle(key, option, event.currentTarget.checked, definition)}
                                    />
                                    <span>{this.toEnumOptionLabel(option)}</span>
                                </label>
                            );
                        })}
                    </div>
                );
            }
            return this.renderJsonControl(key, value, definition.default, raw => this.handleArrayJsonBlur(key, raw));
        }

        if (definition.type === 'object') {
            return this.renderJsonControl(key, value, definition.default, raw => this.handleObjectJsonBlur(key, raw));
        }

        return (
            <input
                id={key}
                type={definition['x-sensitive'] ? 'password' : 'text'}
                value={String(value ?? definition.default ?? '')}
                autoComplete={definition['x-sensitive'] ? 'off' : undefined}
                onChange={event => this.handleTextChange(key, event.currentTarget.value)}
            />
        );
    }

    private renderJsonControl(
        key: GeoPreferenceKey,
        value: unknown,
        fallback: unknown,
        onBlur: (rawValue: string) => void
    ): React.ReactNode {
        const jsonValue = this.formatJsonValue(value, fallback);
        return (
            <textarea
                key={`${key}:${jsonValue}`}
                id={key}
                className='geo-preference-json'
                rows={8}
                defaultValue={jsonValue}
                spellCheck={false}
                onBlur={event => onBlur(event.currentTarget.value)}
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

    private async handleArrayToggle(
        key: string,
        option: string | number,
        checked: boolean,
        definition: GeoPreferenceDefinition
    ): Promise<void> {
        const current = this.getArrayValue(this.snapshot[key], definition.default);
        const next = checked
            ? [...current.filter(value => value !== option), option]
            : current.filter(value => value !== option);
        await this.store.setValue(key, next, PreferenceScope.User);
    }

    private async handleObjectJsonBlur(key: string, rawValue: string): Promise<void> {
        const trimmed = rawValue.trim();
        if (!trimmed) {
            await this.store.setValue(key, {}, PreferenceScope.User);
            return;
        }
        try {
            const parsed = JSON.parse(trimmed);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                await this.store.setValue(key, parsed, PreferenceScope.User);
            }
        } catch (error) {
            console.warn(`[GeoPreferencesWidget] Invalid JSON preference for ${key}`, error);
        }
    }

    private async handleArrayJsonBlur(key: string, rawValue: string): Promise<void> {
        const trimmed = rawValue.trim();
        if (!trimmed) {
            await this.store.setValue(key, [], PreferenceScope.User);
            return;
        }
        try {
            const parsed = JSON.parse(trimmed);
            if (Array.isArray(parsed)) {
                await this.store.setValue(key, parsed, PreferenceScope.User);
            }
        } catch (error) {
            console.warn(`[GeoPreferencesWidget] Invalid JSON array preference for ${key}`, error);
        }
    }

    private async handleResetPreference(key: string, definition: GeoPreferenceDefinition): Promise<void> {
        const defaultValue = 'default' in definition ? this.cloneValue(definition.default) : undefined;
        await this.store.setValue(key, defaultValue, PreferenceScope.User);
    }

    private handleSearchChange(value: string): void {
        this.searchQuery = value;
        this.highlightedPreferenceKey = undefined;
        this.update();
    }

    private toggleCategory(category: string): void {
        if (this.expandedCategories.has(category)) {
            this.expandedCategories.delete(category);
        } else {
            this.expandedCategories.add(category);
        }
        this.update();
    }

    private focusCategory(category: string): void {
        this.expandedCategories.add(category);
        this.highlightedCategory = category;
        this.highlightedPreferenceKey = undefined;
        this.update();
        window.setTimeout(() => {
            const section = this.node.querySelector<HTMLElement>(`[data-geo-preference-category="${category}"]`);
            section?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 0);
    }

    private buildSections(): GeoPreferenceSection[] {
        return Array.from(this.store.definitionsByCategory.entries())
            .sort(([a], [b]) => this.compareCategories(a, b))
            .map(([category, entries]) => ({
                category,
                label: this.toCategoryLabel(category),
                entries,
                filteredEntries: entries.filter(({ key, definition }) => this.shouldShowPreference(key, definition))
            }));
    }

    private initializeExpandedCategories(categories: string[]): void {
        if (this.expandedCategoriesInitialized) {
            return;
        }
        categories.forEach(category => this.expandedCategories.add(category));
        this.expandedCategoriesInitialized = true;
    }

    private shouldShowPreference(key: GeoPreferenceKey, definition: GeoPreferenceDefinition): boolean {
        if (this.valueFilter === 'modified' && !this.isModified(key, definition)) {
            return false;
        }

        const targets = definition['x-targets'] ?? ['frontend'];
        if (this.targetFilter !== 'all' && !targets.includes(this.targetFilter)) {
            return false;
        }

        const query = this.normalizeSearchText(this.searchQuery);
        if (!query) {
            return true;
        }

        const value = this.snapshot[key];
        const haystack = [
            key,
            definition.title,
            this.toPreferenceLabel(key),
            definition.description,
            definition['x-category'],
            this.toCategoryLabel(definition['x-category'] || 'generic'),
            ...(definition['x-tags'] ?? []),
            ...(definition['x-ui']?.keywords ?? []),
            ...(definition.enum ?? []).map(String),
            ...(definition.items?.enum ?? []).map(String),
            this.stringifyForSearch(value)
        ]
            .filter(Boolean)
            .join(' ');

        return this.normalizeSearchText(haystack).includes(query);
    }

    private isModified(key: GeoPreferenceKey | string, definition: GeoPreferenceDefinition): boolean {
        if (!('default' in definition)) {
            return false;
        }
        const current = this.snapshot[key] ?? definition.default;
        return !this.areValuesEqual(current, definition.default);
    }

    private areValuesEqual(left: unknown, right: unknown): boolean {
        if (left === right) {
            return true;
        }
        try {
            return JSON.stringify(left) === JSON.stringify(right);
        } catch {
            return false;
        }
    }

    private cloneValue<T>(value: T): T {
        if (value === undefined || value === null) {
            return value;
        }
        try {
            return JSON.parse(JSON.stringify(value)) as T;
        } catch {
            return value;
        }
    }

    private getArrayValue(value: unknown, fallback: unknown): Array<string | number> {
        const source = Array.isArray(value) ? value : fallback;
        if (!Array.isArray(source)) {
            return [];
        }
        return source.filter((entry): entry is string | number => typeof entry === 'string' || typeof entry === 'number');
    }

    private formatJsonValue(value: unknown, fallback: unknown): string {
        const source = value ?? fallback ?? {};
        try {
            return JSON.stringify(source, null, 2);
        } catch {
            return '{}';
        }
    }

    private stringifyForSearch(value: unknown): string {
        if (value === undefined || value === null) {
            return '';
        }
        if (typeof value === 'string') {
            return value;
        }
        try {
            return JSON.stringify(value);
        } catch {
            return String(value);
        }
    }

    private normalizeSearchText(value: string | undefined): string {
        return (value ?? '')
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .trim();
    }

    private compareCategories(a: string, b: string): number {
        const aIndex = CATEGORY_ORDER.indexOf(a);
        const bIndex = CATEGORY_ORDER.indexOf(b);
        if (aIndex !== -1 || bIndex !== -1) {
            return (aIndex === -1 ? Number.MAX_SAFE_INTEGER : aIndex)
                - (bIndex === -1 ? Number.MAX_SAFE_INTEGER : bIndex);
        }
        return a.localeCompare(b);
    }

    private toCategoryLabel(category: string): string {
        return CATEGORY_LABELS[category] ?? category;
    }

    private toPreferenceLabel(key: string): string {
        return key
            .replace(/^geoApp\./, '')
            .split('.')
            .map(part => this.toHumanSegment(part))
            .join(' / ');
    }

    private toHumanSegment(value: string): string {
        return value
            .replace(/([A-Z])/g, ' $1')
            .replace(/-/g, ' ')
            .replace(/_/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .replace(/^\w/, char => char.toUpperCase());
    }

    private toEnumOptionLabel(option: string | number): string {
        const raw = String(option);
        const label = ENUM_VALUE_LABELS[raw] ?? this.toHumanSegment(raw);
        return label === raw ? raw : `${label} (${raw})`;
    }
}
