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
type GeoPreferenceComplexityFilter = 'all' | 'simple' | 'advanced';

interface GeoPreferenceGuide {
    id: string;
    label: string;
    description: string;
    categories?: string[];
    sections?: string[];
    keyPrefixes?: string[];
    keyIncludes?: string[];
    tags?: string[];
}

interface GeoPreferenceSection {
    category: string;
    label: string;
    entries: Array<{ key: GeoPreferenceKey; definition: GeoPreferenceDefinition }>;
    filteredEntries: Array<{ key: GeoPreferenceKey; definition: GeoPreferenceDefinition }>;
    subsections: GeoPreferenceSubsection[];
}

interface GeoPreferenceSubsection {
    id: string;
    label: string;
    entries: Array<{ key: GeoPreferenceKey; definition: GeoPreferenceDefinition }>;
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

const PREFERENCE_GUIDES: GeoPreferenceGuide[] = [
    {
        id: 'aide',
        label: '@Aide et Chat IA',
        description: 'Modèles, comportements, skills, tools et sauvegarde des coordonnées trouvées.',
        categories: ['ai', 'chat'],
        sections: ['Activation', 'Profils', 'Profils par workflow', 'Comportement', 'Policy tools et skills', 'Coordonnées trouvées', 'OpenRouter', 'OpenAI Codex'],
        keyPrefixes: ['geoApp.ai.', 'geoApp.chat.'],
        tags: ['chat', 'geoapp', 'prompt', 'skills', 'tools', 'policy']
    },
    {
        id: 'map',
        label: 'Carte et coordonnées',
        description: 'Fond de carte, affichage, waypoints, coordonnées détectées et overlay Formula Solver.',
        categories: ['map'],
        sections: ['Carte', 'Affichage', 'Fournisseurs', 'Coordonnées trouvées', 'Formula Solver'],
        keyPrefixes: ['geoApp.map.'],
        keyIncludes: ['formulaSolver.preview.mapOverlayEnabled', 'ai.mapHints'],
        tags: ['map']
    },
    {
        id: 'checkers',
        label: 'Checkers',
        description: 'Automatisation, Playwright, GeoCheck, Certitude, Geocaching.com et ouverture des liens.',
        categories: ['checkers', 'auth'],
        sections: ['Général', 'Playwright', 'Sécurité', 'Navigation', 'Geocaching.com'],
        keyPrefixes: ['geoApp.checkers.', 'geoApp.auth.geocaching.'],
        tags: ['checkers', 'geocheck', 'authentication']
    },
    {
        id: 'tabs-ui',
        label: 'Interface et onglets',
        description: 'Page de démarrage, stratégie d’onglets, fiches géocaches, liens et tableaux.',
        categories: ['ui', 'alphabets', 'logs'],
        sections: ['Général', 'Onglets', 'Tableaux', 'Navigation', 'Fiche géocache', 'Affichage'],
        keyPrefixes: ['geoApp.ui.', 'geoApp.geocache.', 'geoApp.geocaches.table.', 'geoApp.logs.', 'geoApp.alphabets.'],
        tags: ['ui', 'navigation', 'table']
    },
    {
        id: 'plugins',
        label: 'Plugins et MetaSolver',
        description: 'Chargement des plugins, limites d’exécution et pipelines MetaSolver.',
        categories: ['plugins'],
        sections: ['Général', 'Exécution', 'MetaSolver'],
        keyPrefixes: ['geoApp.plugins.', 'geoApp.metasolver.'],
        tags: ['metasolver']
    },
    {
        id: 'images-ocr',
        label: 'Images et OCR',
        description: 'Galerie d’images, stockage local, moteurs OCR et fournisseurs vision.',
        categories: ['images', 'ocr'],
        sections: ['Galerie', 'Stockage', 'Général', 'Fournisseurs', 'LM Studio', 'OpenRouter'],
        keyPrefixes: ['geoApp.images.', 'geoApp.ocr.'],
        tags: ['vision', 'openrouter', 'storage']
    },
    {
        id: 'notes-gpx',
        label: 'Notes et GPX',
        description: 'Synchronisation des notes personnelles, export GPX et logs Geocaching.com.',
        categories: ['notes'],
        sections: ['Geocaching.com', 'GPX'],
        keyPrefixes: ['geoApp.notes.', 'geoApp.gpxExport.'],
        tags: ['notes', 'gpx', 'export']
    },
    {
        id: 'system',
        label: 'Système',
        description: 'Backend, archive, mises à jour, recherche et réglages de fonctionnement.',
        categories: ['backend', 'archive', 'updates', 'search', 'earthcoach'],
        sections: ['Système', 'Général', 'Références'],
        keyPrefixes: ['geoApp.backend.', 'geoApp.tasks.', 'geoApp.archive.', 'geoApp.updates.', 'geoApp.search.', 'geoApp.earthCoach.'],
        tags: ['network', 'safety', 'data-preservation', 'earthcoach']
    }
];

const ENUM_VALUE_LABELS: Record<string, string> = {
    true: 'Activé',
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
    'new-window': 'Nouvelle fenêtre',
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
    protected complexityFilter: GeoPreferenceComplexityFilter = 'all';
    protected selectedGuideId = 'all';

    /** Version incrémentée à chaque changement de valeur : sert à invalider les caches dérivés. */
    private snapshotVersion = 0;
    /** Cache des textes de recherche normalisés par clé (invalidé à chaque changement de valeur). */
    private readonly haystackCache = new Map<string, string>();
    /** Cache mémoïsé des compteurs de guides, clé = signature filtres + version. */
    private guideCountsCache?: { signature: string; counts: Map<string, number> };
    /** Brouillons des champs texte/nombre en cours d'édition (commit au blur). */
    private readonly textDrafts = new Map<string, string>();
    /** Clés dont le dernier JSON saisi était invalide (feedback inline). */
    private readonly jsonErrors = new Set<string>();

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
        this.toDispose.push(this.store.onDidChange(change => {
            this.snapshot = {
                ...this.snapshot,
                [change.key]: change.value
            };
            this.haystackCache.delete(change.key);
            this.snapshotVersion++;
            this.scheduleUpdate();
        }));

        this.update();
    }

    /**
     * Regroupe les rafraîchissements rapprochés (ex. pull initial du backend qui
     * applique les préférences une par une) en un seul render via microtask.
     */
    private updateScheduled = false;
    private scheduleUpdate(): void {
        if (this.updateScheduled) {
            return;
        }
        this.updateScheduled = true;
        Promise.resolve().then(() => {
            this.updateScheduled = false;
            this.update();
        });
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
        const guideCounts = this.buildGuideCounts();
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
                        this.complexityFilter = 'all';
                        this.selectedGuideId = 'all';
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
                    {this.renderFilterButton('Simples', this.complexityFilter === 'simple', () => {
                        this.complexityFilter = this.complexityFilter === 'simple' ? 'all' : 'simple';
                        this.update();
                    })}
                    {this.renderFilterButton('Avancées', this.complexityFilter === 'advanced', () => {
                        this.complexityFilter = this.complexityFilter === 'advanced' ? 'all' : 'advanced';
                        this.update();
                    })}
                </div>
                <div className='geo-preferences-guide-row'>
                    {this.renderGuideButton('Tous les usages', undefined, this.selectedGuideId === 'all', () => {
                        this.selectedGuideId = 'all';
                        this.update();
                    })}
                    {PREFERENCE_GUIDES.map(guide => this.renderGuideButton(
                        guide.label,
                        guideCounts.get(guide.id) ?? 0,
                        this.selectedGuideId === guide.id,
                        () => {
                            this.selectedGuideId = this.selectedGuideId === guide.id ? 'all' : guide.id;
                            this.highlightedPreferenceKey = undefined;
                            this.update();
                        },
                        guide.description
                    ))}
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

    private renderGuideButton(
        label: string,
        count: number | undefined,
        active: boolean,
        onClick: () => void,
        title?: string
    ): React.ReactNode {
        return (
            <button
                className={`theia-button secondary geo-preferences-guide-button${active ? ' active' : ''}`}
                type='button'
                onClick={onClick}
                title={title ?? label}
            >
                <span>{label}</span>
                {count !== undefined && <span>{count}</span>}
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
                        {section.subsections.map(subsection => this.renderSubsection(section, subsection))}
                    </div>
                )}
            </section>
        );
    }

    private renderSubsection(section: GeoPreferenceSection, subsection: GeoPreferenceSubsection): React.ReactNode {
        const showHeading = section.subsections.length > 1 || subsection.label !== section.label;
        return (
            <div key={subsection.id} className='geo-preferences-subsection'>
                {showHeading && (
                    <h3>
                        <span>{subsection.label}</span>
                        <span>{subsection.entries.length}</span>
                    </h3>
                )}
                <div className='geo-preferences-subsection-items'>
                    {subsection.entries.map(({ key, definition }) => this.renderPreference(key, definition))}
                </div>
            </div>
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
        const description = definition['x-ui']?.shortDescription ?? definition.description;
        const label = definition['x-ui']?.label ?? definition.title ?? this.toPreferenceLabel(key);
        const targets = definition['x-targets'] ?? ['frontend'];
        const backend = targets.includes('backend');
        const modified = this.isModified(key, definition);
        const tags = definition['x-tags'] ?? [];
        const highlighted = this.highlightedPreferenceKey === key;
        const advanced = this.isAdvancedPreference(key, definition);

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
                        {advanced && <span className='geo-preference-tag advanced'>Avancé</span>}
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
                            {this.toEnumOptionLabel(option, definition)}
                        </option>
                    ))}
                </select>
            );
        }

        if (definition.type === 'number' || definition.type === 'integer') {
            const draft = this.textDrafts.get(key);
            const displayValue = draft !== undefined ? draft : String(value ?? definition.default ?? 0);
            return (
                <input
                    id={key}
                    type='number'
                    value={displayValue}
                    min={definition.minimum as number | undefined}
                    max={definition.maximum as number | undefined}
                    step={definition.type === 'integer' ? 1 : 0.1}
                    onChange={event => this.handleDraftChange(key, event.currentTarget.value)}
                    onBlur={() => { void this.commitNumericDraft(key, definition); }}
                    onKeyDown={event => this.handleDraftKeyDown(event)}
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
                                    <span>{this.toEnumOptionLabel(option, definition)}</span>
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

        const textDraft = this.textDrafts.get(key);
        const textValue = textDraft !== undefined ? textDraft : String(value ?? definition.default ?? '');
        return (
            <input
                id={key}
                type={definition['x-sensitive'] ? 'password' : 'text'}
                value={textValue}
                autoComplete={definition['x-sensitive'] ? 'off' : undefined}
                onChange={event => this.handleDraftChange(key, event.currentTarget.value)}
                onBlur={() => { void this.commitTextDraft(key); }}
                onKeyDown={event => this.handleDraftKeyDown(event)}
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
        const hasError = this.jsonErrors.has(key);
        return (
            <div className='geo-preference-json-wrapper'>
                <textarea
                    key={`${key}:${jsonValue}`}
                    id={key}
                    className={`geo-preference-json${hasError ? ' invalid' : ''}`}
                    rows={8}
                    defaultValue={jsonValue}
                    spellCheck={false}
                    aria-invalid={hasError}
                    onBlur={event => onBlur(event.currentTarget.value)}
                />
                {hasError && (
                    <p className='geo-preference-json-error' role='alert'>
                        JSON invalide : la valeur n’a pas été enregistrée.
                    </p>
                )}
            </div>
        );
    }

    private async handleBooleanChange(key: string, value: boolean): Promise<void> {
        await this.store.setValue(key, value, PreferenceScope.User);
    }

    /** Met à jour le brouillon local sans écrire dans les préférences (ni sync réseau). */
    private handleDraftChange(key: string, value: string): void {
        this.textDrafts.set(key, value);
        this.update();
    }

    /** Enter valide immédiatement (via blur), Échap annule le brouillon. */
    private handleDraftKeyDown(event: React.KeyboardEvent<HTMLInputElement>): void {
        if (event.key === 'Enter') {
            event.currentTarget.blur();
        } else if (event.key === 'Escape') {
            const key = event.currentTarget.id;
            this.textDrafts.delete(key);
            this.update();
        }
    }

    private async commitTextDraft(key: string): Promise<void> {
        const draft = this.textDrafts.get(key);
        this.textDrafts.delete(key);
        if (draft === undefined) {
            return;
        }
        await this.store.setValue(key, draft, PreferenceScope.User);
    }

    private async commitNumericDraft(key: string, definition: GeoPreferenceDefinition): Promise<void> {
        const draft = this.textDrafts.get(key);
        this.textDrafts.delete(key);
        if (draft === undefined || draft.trim() === '') {
            this.update();
            return;
        }
        const parsed = definition.type === 'integer'
            ? parseInt(draft, 10)
            : parseFloat(draft);
        if (Number.isNaN(parsed)) {
            // Saisie invalide (ex. « - ») : on rétablit l'affichage de la valeur courante.
            this.update();
            return;
        }
        await this.store.setValue(key, parsed, PreferenceScope.User);
    }

    private async handleSelectChange(key: string, rawValue: string, definition: GeoPreferenceDefinition): Promise<void> {
        let value: string | number = rawValue;
        if ((definition.type === 'number' || definition.type === 'integer') && rawValue !== '') {
            value = definition.type === 'integer' ? parseInt(rawValue, 10) : parseFloat(rawValue);
        }
        await this.store.setValue(key, value, PreferenceScope.User);
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
            this.clearJsonError(key);
            await this.store.setValue(key, {}, PreferenceScope.User);
            return;
        }
        try {
            const parsed = JSON.parse(trimmed);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                this.clearJsonError(key);
                await this.store.setValue(key, parsed, PreferenceScope.User);
            } else {
                this.setJsonError(key, 'Un objet JSON est attendu');
            }
        } catch (error) {
            this.setJsonError(key, error);
        }
    }

    private async handleArrayJsonBlur(key: string, rawValue: string): Promise<void> {
        const trimmed = rawValue.trim();
        if (!trimmed) {
            this.clearJsonError(key);
            await this.store.setValue(key, [], PreferenceScope.User);
            return;
        }
        try {
            const parsed = JSON.parse(trimmed);
            if (Array.isArray(parsed)) {
                this.clearJsonError(key);
                await this.store.setValue(key, parsed, PreferenceScope.User);
            } else {
                this.setJsonError(key, 'Un tableau JSON est attendu');
            }
        } catch (error) {
            this.setJsonError(key, error);
        }
    }

    private setJsonError(key: string, error: unknown): void {
        console.warn(`[GeoPreferencesWidget] Invalid JSON preference for ${key}`, error);
        if (!this.jsonErrors.has(key)) {
            this.jsonErrors.add(key);
            this.update();
        }
    }

    private clearJsonError(key: string): void {
        if (this.jsonErrors.delete(key)) {
            this.update();
        }
    }

    private async handleResetPreference(key: string, definition: GeoPreferenceDefinition): Promise<void> {
        this.textDrafts.delete(key);
        this.jsonErrors.delete(key);
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
            .map(([category, entries]) => {
                const filteredEntries = entries
                    .filter(({ key, definition }) => this.shouldShowPreference(key, definition))
                    .sort((left, right) => this.comparePreferences(left.key, left.definition, right.key, right.definition));
                return {
                    category,
                    label: this.toCategoryLabel(category),
                    entries,
                    filteredEntries,
                    subsections: this.buildSubsections(category, filteredEntries)
                };
            });
    }

    private buildGuideCounts(): Map<string, number> {
        const signature = `${this.snapshotVersion}|${this.valueFilter}|${this.targetFilter}|${this.complexityFilter}`;
        if (this.guideCountsCache?.signature === signature) {
            return this.guideCountsCache.counts;
        }
        const counts = new Map<string, number>();
        for (const guide of PREFERENCE_GUIDES) {
            const count = this.store.definitions.filter(({ key, definition }) =>
                this.matchesGuide(key, definition, guide) && this.matchesBaseFilters(key, definition)
            ).length;
            counts.set(guide.id, count);
        }
        this.guideCountsCache = { signature, counts };
        return counts;
    }

    private buildSubsections(
        category: string,
        entries: Array<{ key: GeoPreferenceKey; definition: GeoPreferenceDefinition }>
    ): GeoPreferenceSubsection[] {
        const map = new Map<string, GeoPreferenceSubsection>();
        for (const entry of entries) {
            const label = this.toPreferenceSectionLabel(category, entry.key, entry.definition);
            const id = this.toSubsectionId(label);
            if (!map.has(id)) {
                map.set(id, { id, label, entries: [] });
            }
            map.get(id)?.entries.push(entry);
        }
        return Array.from(map.values()).sort((left, right) => this.compareSubsections(left.label, right.label));
    }

    private initializeExpandedCategories(categories: string[]): void {
        if (this.expandedCategoriesInitialized) {
            return;
        }
        categories.forEach(category => this.expandedCategories.add(category));
        this.expandedCategoriesInitialized = true;
    }

    private shouldShowPreference(key: GeoPreferenceKey, definition: GeoPreferenceDefinition): boolean {
        if (!this.matchesBaseFilters(key, definition)) {
            return false;
        }

        const guide = this.getSelectedGuide();
        if (guide && !this.matchesGuide(key, definition, guide)) {
            return false;
        }

        return this.matchesSearchQuery(key, definition);
    }

    private matchesBaseFilters(key: GeoPreferenceKey, definition: GeoPreferenceDefinition): boolean {
        if (this.valueFilter === 'modified' && !this.isModified(key, definition)) {
            return false;
        }

        const advanced = this.isAdvancedPreference(key, definition);
        if (this.complexityFilter === 'simple' && advanced) {
            return false;
        }
        if (this.complexityFilter === 'advanced' && !advanced) {
            return false;
        }

        const targets = definition['x-targets'] ?? ['frontend'];
        if (this.targetFilter !== 'all' && !targets.includes(this.targetFilter)) {
            return false;
        }

        return true;
    }

    private matchesSearchQuery(key: GeoPreferenceKey, definition: GeoPreferenceDefinition): boolean {
        const query = this.normalizeSearchText(this.searchQuery);
        if (!query) {
            return true;
        }
        return this.getHaystack(key, definition).includes(query);
    }

    /** Texte de recherche normalisé pour une préférence, mémoïsé jusqu'au prochain changement de valeur. */
    private getHaystack(key: GeoPreferenceKey, definition: GeoPreferenceDefinition): string {
        const cached = this.haystackCache.get(key);
        if (cached !== undefined) {
            return cached;
        }
        const value = this.snapshot[key];
        const haystack = this.normalizeSearchText([
            key,
            definition.title,
            this.toPreferenceLabel(key),
            definition.description,
            definition['x-category'],
            this.toCategoryLabel(definition['x-category'] || 'generic'),
            definition['x-ui']?.label,
            definition['x-ui']?.section,
            definition['x-ui']?.shortDescription,
            ...(definition['x-tags'] ?? []),
            ...(definition['x-ui']?.keywords ?? []),
            ...(definition.enum ?? []).map(String),
            ...(definition.items?.enum ?? []).map(String),
            this.stringifyForSearch(value)
        ]
            .filter(Boolean)
            .join(' '));
        this.haystackCache.set(key, haystack);
        return haystack;
    }

    private getSelectedGuide(): GeoPreferenceGuide | undefined {
        if (this.selectedGuideId === 'all') {
            return undefined;
        }
        return PREFERENCE_GUIDES.find(guide => guide.id === this.selectedGuideId);
    }

    private matchesGuide(key: GeoPreferenceKey, definition: GeoPreferenceDefinition, guide: GeoPreferenceGuide): boolean {
        const keyText = String(key);
        const category = definition['x-category'] || 'generic';
        const section = definition['x-ui']?.section ?? this.toPreferenceSectionLabel(category, key, definition);
        const tags = definition['x-tags'] ?? [];

        return Boolean(
            guide.categories?.includes(category)
            || guide.sections?.includes(section)
            || guide.keyPrefixes?.some(prefix => keyText.startsWith(prefix))
            || guide.keyIncludes?.some(fragment => keyText.includes(fragment))
            || guide.tags?.some(tag => tags.includes(tag))
        );
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

    private comparePreferences(
        leftKey: GeoPreferenceKey,
        leftDefinition: GeoPreferenceDefinition,
        rightKey: GeoPreferenceKey,
        rightDefinition: GeoPreferenceDefinition
    ): number {
        const leftOrder = leftDefinition['x-ui']?.order;
        const rightOrder = rightDefinition['x-ui']?.order;
        if (leftOrder !== undefined || rightOrder !== undefined) {
            return (leftOrder ?? Number.MAX_SAFE_INTEGER) - (rightOrder ?? Number.MAX_SAFE_INTEGER);
        }
        return String(leftKey).localeCompare(String(rightKey));
    }

    private compareSubsections(left: string, right: string): number {
        const order = [
            'Général',
            'Activation',
            'Profils',
            'Profils par workflow',
            'Comportement',
            'Policy tools et skills',
            'Coordonnées trouvées',
            'Carte',
            'Affichage',
            'Onglets',
            'Tableaux',
            'Navigation',
            'Fiche géocache',
            'Exécution',
            'MetaSolver',
            'Fournisseurs',
            'OpenRouter',
            'OpenAI Codex',
            'LM Studio',
            'Playwright',
            'Sécurité',
            'Références',
            'Stockage',
            'Galerie',
            'GPX',
            'Geocaching.com',
            'Système'
        ];
        const leftIndex = order.indexOf(left);
        const rightIndex = order.indexOf(right);
        if (leftIndex !== -1 || rightIndex !== -1) {
            return (leftIndex === -1 ? Number.MAX_SAFE_INTEGER : leftIndex)
                - (rightIndex === -1 ? Number.MAX_SAFE_INTEGER : rightIndex);
        }
        return left.localeCompare(right);
    }

    private toPreferenceSectionLabel(category: string, key: string, definition: GeoPreferenceDefinition): string {
        if (definition['x-ui']?.section) {
            return definition['x-ui'].section;
        }
        if (key.includes('.openRouter.')) {
            return 'OpenRouter';
        }
        if (key.includes('.codex.')) {
            return 'OpenAI Codex';
        }
        if (key.includes('.lmstudio.')) {
            return 'LM Studio';
        }
        if (key.includes('.workflowProfile.')) {
            return 'Profils par workflow';
        }
        if (key.includes('.behaviorProfile.')) {
            return 'Comportement';
        }
        if (key.includes('.promptPack') || key.includes('.skillPack') || key.includes('.toolPolicy.') || key.includes('.skillPolicy.')) {
            return 'Policy tools et skills';
        }
        if (key.includes('.foundCoordinates.')) {
            return 'Coordonnées trouvées';
        }
        if (key.includes('.formulaSolver.')) {
            return 'Formula Solver';
        }
        if (key.includes('.tabs.')) {
            return 'Onglets';
        }
        if (key.includes('.geocaches.table.')) {
            return 'Tableaux';
        }
        if (key.includes('.geocache.externalLinks.') || key.includes('.linkOpenMode')) {
            return 'Navigation';
        }
        if (key.includes('.geocache.')) {
            return 'Fiche géocache';
        }
        if (key.includes('.executor.')) {
            return 'Exécution';
        }
        if (key.includes('.metasolver.')) {
            return 'MetaSolver';
        }
        if (key.includes('.playwright.') || key.includes('profileDir')) {
            return 'Playwright';
        }
        if (key.includes('allowedDomains')) {
            return 'Sécurité';
        }
        if (key.includes('.gpxExport.')) {
            return 'GPX';
        }
        if (key.includes('.geocaching.')) {
            return 'Geocaching.com';
        }
        if (key.includes('.references.')) {
            return 'Références';
        }
        if (key.includes('.gallery.')) {
            return 'Galerie';
        }
        if (key.includes('.storage.')) {
            return 'Stockage';
        }
        if (category === 'backend') {
            return 'Système';
        }
        if (category === 'map') {
            return 'Carte';
        }
        if (category === 'checkers') {
            return 'Général';
        }
        return 'Général';
    }

    private toSubsectionId(label: string): string {
        return this.normalizeSearchText(label).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'general';
    }

    private isAdvancedPreference(key: GeoPreferenceKey | string, definition: GeoPreferenceDefinition): boolean {
        if (definition['x-ui']?.advanced !== undefined) {
            return Boolean(definition['x-ui'].advanced);
        }
        const keyText = String(key);
        const tags = definition['x-tags'] ?? [];
        if (definition.type === 'object' || definition['x-sensitive'] || tags.includes('secret') || tags.includes('safety')) {
            return true;
        }
        return [
            '.openRouter.',
            '.codex.',
            '.lmstudio.',
            '.executor.',
            '.tasks.',
            '.metasolver.profiles.',
            '.toolPolicy.',
            '.skillPolicy.',
            'allowedDomains',
            'profileDir',
            'apiBaseUrl',
            'archive.autoSync',
            'autoDiscoverOnStart'
        ].some(fragment => keyText.includes(fragment));
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

    private toEnumOptionLabel(option: string | number, definition?: GeoPreferenceDefinition): string {
        const raw = String(option);
        const contextualLabel = definition?.['x-ui']?.enumLabels?.[raw];
        if (contextualLabel) {
            return `${contextualLabel} (${raw})`;
        }
        const label = ENUM_VALUE_LABELS[raw] ?? this.toHumanSegment(raw);
        return label === raw ? raw : `${label} (${raw})`;
    }
}
