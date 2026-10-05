import * as React from 'react';
import { injectable, inject } from '@theia/core/shared/inversify';
import { CommandService } from '@theia/core';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { StatefulWidget, Message } from '@theia/core/lib/browser';
import { PreferenceScope } from '@theia/core/lib/common/preferences/preference-scope';

import { GeoPreferenceStore, GeoPreferenceSnapshot } from './geo-preference-store';
import {
    GeoPreferenceDefinition,
    GeoPreferenceKey,
} from './geo-preferences-schema';
import { LexiconEntry } from './geo-lexicon-editor';
import {
    areValuesEqual,
    buildSearchHaystack,
    buildSidebarGroups,
    buildSubsections,
    categoryLabel,
    compareCategories,
    comparePreferences,
    filtersForReveal,
    GeoPreferenceSection,
    GeoPreferenceSidebarGroup,
    GeoPreferenceSubsection,
    GeoPreferenceTargetFilter,
    GeoPreferenceValueFilter,
    isAdvancedPreference,
    matchesBaseFilters,
    matchesSearchQuery,
    normalizeSearchText,
} from './geo-preference-filters';
import {
    arrayValue,
    PreferenceItem,
    PreferenceItemHandlers,
    stringListKey,
    stringListValue,
} from './geo-preference-item';

export interface GeoPreferencesOpenOptions {
    category?: string;
    key?: string;
    query?: string;
}

/** Défilement différé, exécuté après le rendu effectif du DOM (voir PendingRevealEffect). */
interface PendingReveal {
    kind: 'preference' | 'category';
    id: string;
    /** Incrémenté à chaque demande : re-déclenche l'effet même pour la même cible. */
    token: number;
}

/**
 * Exécute un défilement différé une fois le DOM réellement rendu : `update()` passe par la
 * file de messages Lumino puis React, donc un `setTimeout(0)` peut partir avant que le nœud
 * cible existe (catégorie repliée, filtre levé à l'instant). `useLayoutEffect` garantit
 * l'exécution après le commit ; si le nœud n'est pas encore là, on réessaie quelques frames.
 */
const PendingRevealEffect: React.FC<{
    reveal: PendingReveal | undefined;
    findElement: (reveal: PendingReveal) => HTMLElement | null;
    onDone: () => void;
}> = ({ reveal, findElement, onDone }) => {
    const token = reveal?.token;
    React.useLayoutEffect(() => {
        if (!reveal) {
            return;
        }
        let cancelled = false;
        let raf: number | undefined;
        let attempts = 0;
        const attempt = (): void => {
            if (cancelled) {
                return;
            }
            const element = findElement(reveal);
            if (element) {
                element.scrollIntoView({ behavior: 'smooth', block: reveal.kind === 'preference' ? 'center' : 'start' });
                onDone();
                return;
            }
            if (++attempts >= 12) {
                onDone();
                return;
            }
            raf = window.requestAnimationFrame(attempt);
        };
        attempt();
        return () => {
            cancelled = true;
            if (raf !== undefined) {
                window.cancelAnimationFrame(raf);
            }
        };
    }, [token]);
    return null;
};

@injectable()
export class GeoPreferencesWidget extends ReactWidget implements StatefulWidget {

    static readonly ID = 'geo-preferences-widget';
    static readonly LABEL = 'Préférences GeoApp';

    protected snapshot: GeoPreferenceSnapshot = {};
    protected highlightedCategory: string | undefined;
    protected highlightedPreferenceKey: string | undefined;
    /** Catégorie actuellement en tête de la zone de contenu (scroll-spy) : pilote la sidebar. */
    protected spyCategory: string | undefined;
    private spyRaf?: number;
    private highlightClearTimer?: number;
    protected expandedCategories = new Set<string>();
    protected expandedCategoriesInitialized = false;
    protected searchQuery = '';
    protected targetFilter: GeoPreferenceTargetFilter = 'all';
    protected valueFilter: GeoPreferenceValueFilter = 'all';
    /** Réglages avancés affichés par défaut (décision produit) ; décoché = masqués hors recherche. */
    protected showAdvanced = true;
    /** Mode développeur : clés, cibles et tags par ligne, filtres Theia/Flask dans la barre d'outils. */
    protected devMode = false;
    /** Défilement différé en attente, consommé par PendingRevealEffect après le rendu. */
    private pendingReveal?: PendingReveal;
    private revealToken = 0;

    /** Version incrémentée à chaque changement de valeur : sert à invalider les caches dérivés. */
    private snapshotVersion = 0;
    /** Cache des textes de recherche normalisés par clé (invalidé à chaque changement de valeur). */
    private readonly haystackCache = new Map<string, string>();
    /** Cache `isModified` par snapshotVersion : évite de resérialiser chaque valeur à chaque rendu. */
    private readonly modifiedCache = new Map<string, boolean>();
    private modifiedCacheVersion = -1;
    /** Résultat mémoïsé de buildSections, clé = version + filtres + requête. */
    private sectionsCache?: { signature: string; sections: GeoPreferenceSection[] };
    /**
     * Options de `widget: 'select-from'`, par cle source. Recalculees seulement quand la valeur
     * de la preference source change : un tableau neuf a chaque rendu casserait le `React.memo`
     * de l'item.
     */
    private readonly dynamicOptionsCache = new Map<string, { signature: string; options: string[] }>();
    /** Feedback temporaire après clamp ou refus d'une saisie numérique. */
    private readonly numericFeedback = new Map<string, string>();
    private readonly numericFeedbackTimers = new Map<string, number>();
    /** Clés dont le dernier JSON saisi était invalide (feedback inline). */
    private readonly jsonErrors = new Set<string>();
    /** Valeur JSON figée pendant l'édition d'un textarea, pour éviter tout remount qui écraserait la saisie. */
    private readonly jsonEditingSnapshot = new Map<string, string>();

    /** Callbacks stables passés à chaque PreferenceItem (référence constante → React.memo efficace). */
    private readonly itemHandlers: PreferenceItemHandlers = {
        onBoolean: (key, checked) => { void this.handleBooleanChange(key, checked); },
        onSelect: (key, rawValue, definition) => { void this.handleSelectChange(key, rawValue, definition); },
        onTextCommit: (key, value) => { void this.handleTextCommit(key, value); },
        onNumericCommit: (key, rawValue, definition) => { void this.handleNumericCommit(key, rawValue, definition); },
        onArrayToggle: (key, option, checked, definition) => { void this.handleArrayToggle(key, option, checked, definition); },
        onStringListChange: (key, next) => { void this.store.setValue(key, next, PreferenceScope.User); },
        onLexiconChange: (key, next) => { void this.store.setValue(key, next, PreferenceScope.User); },
        onArrayJsonBlur: (key, rawValue) => { void this.handleArrayJsonBlur(key, rawValue); },
        onObjectJsonBlur: (key, rawValue) => { void this.handleObjectJsonBlur(key, rawValue); },
        onReset: (key, definition) => { void this.handleResetPreference(key, definition); },
        onJsonFocus: (key, jsonValue) => { this.jsonEditingSnapshot.set(key, jsonValue); },
        onJsonBlurClear: key => { this.jsonEditingSnapshot.delete(key); }
    };

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

    protected onAfterAttach(msg: Message): void {
        super.onAfterAttach(msg);
        // Écoute en phase de capture : l'événement scroll ne remonte pas depuis le conteneur interne.
        this.node.addEventListener('scroll', this.handleContentScroll, true);
        this.handleContentScroll();
    }

    protected onBeforeDetach(msg: Message): void {
        this.node.removeEventListener('scroll', this.handleContentScroll, true);
        if (this.spyRaf !== undefined) {
            window.cancelAnimationFrame(this.spyRaf);
            this.spyRaf = undefined;
        }
        if (this.highlightClearTimer !== undefined) {
            window.clearTimeout(this.highlightClearTimer);
            this.highlightClearTimer = undefined;
        }
        for (const timer of this.numericFeedbackTimers.values()) {
            window.clearTimeout(timer);
        }
        this.numericFeedbackTimers.clear();
        super.onBeforeDetach(msg);
    }

    /** Scroll-spy : throttlé via requestAnimationFrame pour ne pas re-render à chaque pixel. */
    private handleContentScroll = (): void => {
        if (this.spyRaf !== undefined) {
            return;
        }
        this.spyRaf = window.requestAnimationFrame(() => {
            this.spyRaf = undefined;
            this.updateScrollSpy();
        });
    };

    private updateScrollSpy(): void {
        const content = this.node.querySelector<HTMLElement>('.geo-preferences-content');
        if (!content) {
            return;
        }
        const contentTop = content.getBoundingClientRect().top;
        const sections = Array.from(content.querySelectorAll<HTMLElement>('[data-geo-preference-category]'));
        let current: string | undefined;
        for (const section of sections) {
            // La dernière section dont le haut a franchi (ou effleure) le haut du conteneur est active.
            if (section.getBoundingClientRect().top - contentTop <= 8) {
                current = section.dataset.geoPreferenceCategory;
            } else {
                break;
            }
        }
        if (current === undefined && sections.length > 0) {
            current = sections[0].dataset.geoPreferenceCategory;
        }
        if (current !== this.spyCategory) {
            this.spyCategory = current;
            this.update();
        }
    }

    storeState(): object {
        return {
            // searchQuery volontairement non persistée : une recherche d'une session
            // précédente masquerait la cible des liens profonds à la réouverture.
            targetFilter: this.targetFilter,
            valueFilter: this.valueFilter,
            showAdvanced: this.showAdvanced,
            devMode: this.devMode,
            expandedCategories: Array.from(this.expandedCategories)
        };
    }

    restoreState(state: object): void {
        const restored = state as Partial<{
            /** Anciens champs tolérés mais ignorés : searchQuery, selectedGuideId. */
            searchQuery: string;
            targetFilter: GeoPreferenceTargetFilter;
            valueFilter: GeoPreferenceValueFilter;
            /** Ancien axe simple/avancé, converti en showAdvanced si ce champ manque. */
            complexityFilter: 'all' | 'simple' | 'advanced';
            selectedGuideId: string;
            showAdvanced: boolean;
            devMode: boolean;
            expandedCategories: string[];
        }>;
        if (restored.targetFilter) {
            this.targetFilter = restored.targetFilter;
        }
        if (restored.valueFilter) {
            this.valueFilter = restored.valueFilter;
        }
        if (typeof restored.showAdvanced === 'boolean') {
            this.showAdvanced = restored.showAdvanced;
        } else if (restored.complexityFilter) {
            this.showAdvanced = restored.complexityFilter !== 'simple';
        }
        if (typeof restored.devMode === 'boolean') {
            this.devMode = restored.devMode;
        }
        if (Array.isArray(restored.expandedCategories)) {
            this.expandedCategories = new Set(restored.expandedCategories);
            // On a un état explicite : ne pas ré-déplier toutes les catégories au premier render.
            this.expandedCategoriesInitialized = true;
        }
        this.update();
    }

    revealCategory(category?: string): void {
        if (!category) {
            this.highlightedCategory = undefined;
            this.highlightedPreferenceKey = undefined;
            this.update();
            return;
        }
        const entries = this.store.definitionsByCategory.get(category);
        if (!entries) {
            return;
        }
        // Si les filtres masquent toute la catégorie ciblée, les lever : un lien profond
        // qui n'affiche rien est pire que des filtres oubliés.
        if (!entries.some(({ key, definition }) => this.shouldShowPreference(key, definition))) {
            this.resetFilters();
        }
        this.focusCategory(category);
    }

    revealPreference(key?: string): void {
        if (!key) {
            return;
        }
        const definition = this.store.getDefinition(key);
        if (!definition) {
            return;
        }
        // Lever uniquement les filtres qui masqueraient la cible.
        const next = filtersForReveal(
            {
                searchQuery: this.searchQuery,
                valueFilter: this.valueFilter,
                targetFilter: this.targetFilter,
                showAdvanced: this.showAdvanced
            },
            {
                matchesSearch: this.matchesSearch(key as GeoPreferenceKey, definition),
                advanced: isAdvancedPreference(definition),
                modified: this.isModified(key, definition),
                targets: definition['x-targets'] ?? ['frontend']
            }
        );
        this.searchQuery = next.searchQuery;
        this.valueFilter = next.valueFilter;
        this.targetFilter = next.targetFilter;
        this.showAdvanced = next.showAdvanced;

        const category = definition['x-category'] || 'generic';
        this.expandedCategories.add(category);
        this.highlightedCategory = category;
        this.highlightedPreferenceKey = key;
        this.scheduleHighlightClear();
        this.requestReveal({ kind: 'preference', id: key });
        this.update();
    }

    /** Arme un défilement différé : PendingRevealEffect l'exécute après le rendu réel. */
    private requestReveal(reveal: Omit<PendingReveal, 'token'>): void {
        this.pendingReveal = { ...reveal, token: ++this.revealToken };
    }

    private findRevealElement(reveal: PendingReveal): HTMLElement | null {
        const selector = reveal.kind === 'preference'
            ? `[data-geo-preference-key="${CSS.escape(reveal.id)}"]`
            : `[data-geo-preference-category="${CSS.escape(reveal.id)}"]`;
        return this.node.querySelector<HTMLElement>(selector);
    }

    /** Efface recherche et filtres ; utilisé par l'état vide et avant un reveal masqué. */
    private resetFilters(): void {
        this.searchQuery = '';
        this.valueFilter = 'all';
        this.targetFilter = 'all';
        this.showAdvanced = true;
        this.update();
    }

    /** Le surlignage d'une préférence ciblée s'estompe automatiquement après quelques secondes. */
    private scheduleHighlightClear(): void {
        if (this.highlightClearTimer !== undefined) {
            window.clearTimeout(this.highlightClearTimer);
        }
        this.highlightClearTimer = window.setTimeout(() => {
            this.highlightClearTimer = undefined;
            this.highlightedPreferenceKey = undefined;
            this.update();
        }, 2600);
    }

    setSearchQuery(query?: string): void {
        this.searchQuery = query ?? '';
        this.update();
    }

    private openAiSetup = async (): Promise<void> => {
        try {
            await this.commandService.executeCommand('geoapp.ai.setup.open');
        } catch (error) {
            console.error('[GeoPreferencesWidget] Failed to open AI setup assistant', error);
        }
    };

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
        const totalCount = sections.reduce((sum, section) => sum + section.entries.length, 0);
        const visibleCount = visibleSections.reduce((sum, section) => sum + section.filteredEntries.length, 0);
        const modifiedCount = this.store.definitions
            .filter(({ key, definition }) => this.isModified(key, definition))
            .length;
        // Réglages avancés réellement masqués (une recherche les réaffiche quand ils matchent).
        const hiddenAdvancedCount = !this.showAdvanced && !this.searchQuery.trim()
            ? this.store.definitions.filter(({ definition }) => isAdvancedPreference(definition)).length
            : 0;

        return <div className='geo-preferences-root'>
            <div className='geo-preferences-toolbar'>
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
                    <button
                        className={`theia-button secondary geo-preferences-filter-button${this.valueFilter === 'modified' ? ' active' : ''}`}
                        type='button'
                        aria-pressed={this.valueFilter === 'modified'}
                        onClick={() => {
                            this.valueFilter = this.valueFilter === 'modified' ? 'all' : 'modified';
                            this.update();
                        }}
                    >
                        Modifiées ({modifiedCount})
                    </button>
                    <label className='geo-preferences-advanced-toggle'>
                        <input
                            type='checkbox'
                            checked={this.showAdvanced}
                            onChange={event => {
                                this.showAdvanced = event.currentTarget.checked;
                                this.update();
                            }}
                        />
                        <span>Afficher les réglages avancés</span>
                    </label>
                    {hiddenAdvancedCount > 0 && (
                        <span className='geo-preferences-advanced-count'>
                            {hiddenAdvancedCount} réglages avancés masqués
                        </span>
                    )}
                    {this.devMode && (
                        <>
                            <button
                                className={`theia-button secondary geo-preferences-filter-button${this.targetFilter === 'frontend' ? ' active' : ''}`}
                                type='button'
                                aria-pressed={this.targetFilter === 'frontend'}
                                onClick={() => {
                                    this.targetFilter = this.targetFilter === 'frontend' ? 'all' : 'frontend';
                                    this.update();
                                }}
                            >
                                Theia
                            </button>
                            <button
                                className={`theia-button secondary geo-preferences-filter-button${this.targetFilter === 'backend' ? ' active' : ''}`}
                                type='button'
                                aria-pressed={this.targetFilter === 'backend'}
                                onClick={() => {
                                    this.targetFilter = this.targetFilter === 'backend' ? 'all' : 'backend';
                                    this.update();
                                }}
                            >
                                Flask
                            </button>
                        </>
                    )}
                </div>
            </div>

            <div className='geo-preferences-layout'>
                <aside className='geo-preferences-sidebar'>
                    {buildSidebarGroups(sections, this.store.guides).map(group => this.renderSidebarGroup(group))}
                    <div className='geo-preferences-sidebar-footer'>
                        <div>{visibleCount} / {totalCount} préférences affichées</div>
                        <label className='geo-preferences-dev-toggle'>
                            <input
                                type='checkbox'
                                checked={this.devMode}
                                onChange={event => {
                                    this.devMode = event.currentTarget.checked;
                                    this.update();
                                }}
                            />
                            <span>Mode développeur</span>
                        </label>
                    </div>
                </aside>
                <div className='geo-preferences-content'>
                    {visibleSections.length === 0 && this.renderEmptyState()}
                    {visibleSections.map(section => this.renderSection(section))}
                </div>
            </div>
            <PendingRevealEffect
                reveal={this.pendingReveal}
                findElement={reveal => this.findRevealElement(reveal)}
                onDone={() => { this.pendingReveal = undefined; }}
            />
        </div>;
    }

    private renderEmptyState(): React.ReactNode {
        const query = this.searchQuery.trim();
        return (
            <div className='geo-preferences-empty'>
                {query
                    ? <p>Aucune préférence ne correspond à « {query} » ni aux filtres actifs.</p>
                    : <p>Aucune préférence ne correspond aux filtres actifs.</p>}
                <button
                    className='theia-button secondary'
                    type='button'
                    onClick={() => this.resetFilters()}
                >
                    Réinitialiser les filtres
                </button>
            </div>
        );
    }

    private renderSidebarGroup(group: GeoPreferenceSidebarGroup): React.ReactNode {
        // Un en-tête de guide défile jusqu'à sa première catégorie visible.
        const firstVisible = group.sections.find(section => section.filteredEntries.length > 0) ?? group.sections[0];
        return (
            <div key={group.id} className='geo-preferences-sidebar-group'>
                <button
                    type='button'
                    className='geo-preferences-sidebar-guide'
                    title={group.description ?? group.label}
                    onClick={() => this.focusCategory(firstVisible.category)}
                >
                    {group.label}
                </button>
                {group.sections.map(section => this.renderSidebarEntry(section))}
            </div>
        );
    }

    private renderSidebarEntry(section: GeoPreferenceSection): React.ReactNode {
        const total = section.entries.length;
        const visible = section.filteredEntries.length;
        // Une fois qu'un défilement a eu lieu, la sidebar suit la section visible (spy) ;
        // avant tout scroll, elle reflète la dernière catégorie ciblée explicitement.
        const active = section.category === (this.spyCategory ?? this.highlightedCategory);
        return (
            <button
                key={section.category}
                type='button'
                className={`geo-preferences-sidebar-entry${active ? ' active' : ''}${visible === 0 ? ' empty' : ''}`}
                aria-current={active ? 'true' : undefined}
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
                        aria-expanded={expanded}
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
                <div className='geo-preferences-header-actions'>
                    <button
                        className='theia-button'
                        type='button'
                        onClick={() => { void this.openAiSetup(); }}
                        title='Choisir le fournisseur et le modèle utilisés par tous les assistants GeoApp'
                    >
                        Assistant de configuration de l'IA
                    </button>
                    <button
                        className='theia-button secondary'
                        type='button'
                        onClick={() => { void this.openAiConfiguration(); }}
                        title='Ouvrir la configuration IA pour choisir le modèle utilisé par les agents Theia'
                    >
                        Configurer Agent Theia (IA)
                    </button>
                </div>
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

    /**
     * Options d'un `widget: 'select-from'` ou `'lexicon'`, lues dans la ou les preferences
     * designees par `optionsFrom`.
     *
     * Plusieurs sources sont reunies sans doublon : les langues d'equivalents du lexique viennent
     * a la fois de la liste de l'editeur de logs et de la langue cible des listings, et rien ne
     * garantit que la seconde figure dans la premiere. Une preference scalaire contribue sa propre
     * valeur, une preference `array` ses entrees.
     */
    private resolveDynamicOptions(definition: GeoPreferenceDefinition): string[] | undefined {
        const ui = definition['x-ui'];
        if (ui?.widget !== 'select-from' && ui?.widget !== 'lexicon') {
            return undefined;
        }
        const sourceKeys = ui.optionsFrom === undefined
            ? []
            : (Array.isArray(ui.optionsFrom) ? ui.optionsFrom : [ui.optionsFrom]);
        if (sourceKeys.length === 0) {
            return [];
        }

        const seen = new Set<string>();
        const options: string[] = [];
        for (const sourceKey of sourceKeys) {
            const sourceDefinition = this.store.getDefinition(sourceKey);
            const raw = this.snapshot[sourceKey] ?? sourceDefinition?.default;
            const values = Array.isArray(raw) || Array.isArray(sourceDefinition?.default)
                ? stringListValue(this.snapshot[sourceKey], sourceDefinition?.default)
                : [String(raw ?? '')];
            for (const value of values) {
                const trimmed = value.trim();
                const key = stringListKey(trimmed);
                if (trimmed !== '' && !seen.has(key)) {
                    seen.add(key);
                    options.push(trimmed);
                }
            }
        }

        const cacheKey = sourceKeys.join('|');
        const signature = JSON.stringify(options);
        const cached = this.dynamicOptionsCache.get(cacheKey);
        if (cached?.signature === signature) {
            return cached.options;
        }
        this.dynamicOptionsCache.set(cacheKey, { signature, options });
        return options;
    }

    private renderPreference(key: GeoPreferenceKey, definition: GeoPreferenceDefinition): React.ReactNode {
        return (
            <PreferenceItem
                key={key}
                prefKey={key}
                definition={definition}
                value={this.snapshot[key]}
                dynamicOptions={this.resolveDynamicOptions(definition)}
                hasJsonError={this.jsonErrors.has(key)}
                frozenJson={this.jsonEditingSnapshot.get(key)}
                modified={this.isModified(key, definition)}
                highlighted={this.highlightedPreferenceKey === key}
                advanced={isAdvancedPreference(definition)}
                devMode={this.devMode}
                numericFeedback={this.numericFeedback.get(key)}
                handlers={this.itemHandlers}
            />
        );
    }

    private async handleBooleanChange(key: string, value: boolean): Promise<void> {
        await this.store.setValue(key, value, PreferenceScope.User);
    }

    /** Brouillon texte validé par l'item : une valeur inchangée ne déclenche ni écriture ni sync. */
    private async handleTextCommit(key: string, value: string): Promise<void> {
        const definition = this.store.getDefinition(key);
        if (areValuesEqual(value, this.snapshot[key] ?? definition?.default)) {
            return;
        }
        await this.store.setValue(key, value, PreferenceScope.User);
    }

    private async handleNumericCommit(key: string, rawValue: string, definition: GeoPreferenceDefinition): Promise<void> {
        const trimmed = rawValue.trim();
        if (!trimmed) {
            // Champ vidé : rien à écrire, l'item réaffiche déjà la valeur courante.
            return;
        }
        // Un entier refuse une saisie décimale plutôt que de la tronquer en silence.
        if (definition.type === 'integer' && !/^-?\d+$/.test(trimmed)) {
            this.setNumericFeedback(key, 'Un nombre entier est attendu');
            return;
        }
        let parsed = parseFloat(trimmed);
        if (Number.isNaN(parsed)) {
            // Saisie invalide (ex. « - ») : l'affichage de la valeur courante est déjà rétabli.
            return;
        }
        // Theia borne silencieusement à la lecture : on borne avant l'écriture et on
        // le dit à l'utilisateur, sinon 500 serait enregistré et 18 affiché sans explication.
        if (typeof definition.maximum === 'number' && parsed > definition.maximum) {
            parsed = definition.maximum;
            this.setNumericFeedback(key, `Valeur ramenée à ${definition.maximum} (maximum)`);
        } else if (typeof definition.minimum === 'number' && parsed < definition.minimum) {
            parsed = definition.minimum;
            this.setNumericFeedback(key, `Valeur ramenée à ${definition.minimum} (minimum)`);
        }
        await this.store.setValue(key, parsed, PreferenceScope.User);
    }

    private setNumericFeedback(key: string, message: string): void {
        const existing = this.numericFeedbackTimers.get(key);
        if (existing !== undefined) {
            window.clearTimeout(existing);
        }
        this.numericFeedback.set(key, message);
        this.numericFeedbackTimers.set(key, window.setTimeout(() => {
            this.numericFeedbackTimers.delete(key);
            this.numericFeedback.delete(key);
            this.update();
        }, 4000));
        this.update();
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
        const current = arrayValue(this.snapshot[key], definition.default);
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
        this.jsonErrors.delete(key);
        this.numericFeedback.delete(key);
        // Retirer la clé du scope utilisateur plutôt que d'y copier le défaut :
        // une copie figerait l'ancien défaut si une mise à jour le changeait.
        await this.store.reset(key, PreferenceScope.User);
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
        // Reflète immédiatement la sélection dans la sidebar, même sans événement de scroll.
        this.spyCategory = category;
        this.requestReveal({ kind: 'category', id: category });
        this.update();
    }

    private buildSections(): GeoPreferenceSection[] {
        const signature = [
            this.snapshotVersion,
            this.valueFilter,
            this.targetFilter,
            this.showAdvanced,
            normalizeSearchText(this.searchQuery)
        ].join('|');
        if (this.sectionsCache?.signature === signature) {
            return this.sectionsCache.sections;
        }
        const sections = Array.from(this.store.definitionsByCategory.entries())
            .sort(([a], [b]) => compareCategories(a, b))
            .map(([category, entries]) => {
                const filteredEntries = entries
                    .filter(({ key, definition }) => this.shouldShowPreference(key, definition))
                    .sort((left, right) => comparePreferences(left.key, left.definition, right.key, right.definition));
                return {
                    category,
                    label: categoryLabel(category),
                    entries,
                    filteredEntries,
                    subsections: buildSubsections(filteredEntries)
                };
            });
        this.sectionsCache = { signature, sections };
        return sections;
    }

    private initializeExpandedCategories(categories: string[]): void {
        if (this.expandedCategoriesInitialized) {
            return;
        }
        categories.forEach(category => this.expandedCategories.add(category));
        this.expandedCategoriesInitialized = true;
    }

    private shouldShowPreference(key: GeoPreferenceKey, definition: GeoPreferenceDefinition): boolean {
        return matchesBaseFilters({
            modified: this.isModified(key, definition),
            advanced: isAdvancedPreference(definition),
            targets: definition['x-targets'] ?? ['frontend'],
            valueFilter: this.valueFilter,
            targetFilter: this.targetFilter,
            showAdvanced: this.showAdvanced,
            searchActive: this.searchQuery.trim() !== ''
        }) && this.matchesSearch(key, definition);
    }

    private matchesSearch(key: GeoPreferenceKey, definition: GeoPreferenceDefinition): boolean {
        const query = normalizeSearchText(this.searchQuery);
        return matchesSearchQuery(this.getHaystack(key, definition), query);
    }

    /** Texte de recherche normalisé pour une préférence, mémoïsé jusqu'au prochain changement de valeur. */
    private getHaystack(key: GeoPreferenceKey, definition: GeoPreferenceDefinition): string {
        const cached = this.haystackCache.get(key);
        if (cached !== undefined) {
            return cached;
        }
        const haystack = buildSearchHaystack(key, definition, this.snapshot[key]);
        this.haystackCache.set(key, haystack);
        return haystack;
    }

    private isModified(key: GeoPreferenceKey | string, definition: GeoPreferenceDefinition): boolean {
        if (this.modifiedCacheVersion !== this.snapshotVersion) {
            this.modifiedCache.clear();
            this.modifiedCacheVersion = this.snapshotVersion;
        }
        let cached = this.modifiedCache.get(key);
        if (cached === undefined) {
            cached = 'default' in definition
                && !areValuesEqual(this.snapshot[key] ?? definition.default, definition.default);
            this.modifiedCache.set(key, cached);
        }
        return cached;
    }

}
