/**
 * Widget de liste des alphabets (panel gauche).
 * Affiche la liste des alphabets disponibles avec recherche et filtres.
 */
import * as React from '@theia/core/shared/react';
import { injectable, postConstruct, inject } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { MessageService, CommandService } from '@theia/core';
import { AlphabetsService } from './services/alphabets-service';
import { Alphabet, AlphabetsCommands } from '../common/alphabet-protocol';
import {
    ensureAlphabetFontLoaded,
    getFontFamily,
    getImageResourcePathCandidates,
    resolveAlphabetImageSource
} from './alphabet-symbol-resolver';

const PRESET_EXAMPLE_OPTIONS: Array<{ label: string; value: string }> = [
    { label: 'ABC…', value: 'ABCDEFGHIJKLM' },
    { label: 'GEOCACHING', value: 'GEOCACHING' },
    { label: 'MYSTERY AI', value: 'MYSTERY AI' },
    { label: '12345 67890', value: '12345 67890' }
];

const MAX_FONT_PREVIEW_LENGTH = 40;
const IMAGE_PREVIEW_LENGTH = 10;
const CISTERCIAN_TOOL_ID = '__geoapp_cistercian_numerals_tool__';
const LIST_PREFERENCES_STORAGE_KEY = 'geoapp.alphabets.list.preferences';
const LIST_PREFERENCES_PREF = 'geoApp.alphabets.listPreferences';
const FAVORITE_ALPHABETS_PREF = 'geoApp.alphabets.favoriteIds';
const RECENT_ALPHABETS_PREF = 'geoApp.alphabets.recentIds';
const MAX_RECENT_ALPHABETS = 8;
const PERSIST_LIST_PREFERENCES_DELAY_MS = 800;

type AlphabetFamilyFilter = 'all' | 'fiction' | 'runes' | 'communication' | 'numeric' | 'tactile' | 'visual';
type AlphabetCapabilityFilter = 'all' | 'letters' | 'numbers' | 'special';
type AlphabetScopeFilter = 'all' | 'favorites' | 'recent';
type AlphabetViewMode = 'compact' | 'detailed';
type AlphabetPreviewMode = 'hover' | 'always';

interface AlphabetListPreferencesPayload {
    showExamples?: boolean;
    exampleTextOption?: string;
    customExampleText?: string;
    fontSize?: number;
    scopeFilter?: AlphabetScopeFilter;
    familyFilter?: AlphabetFamilyFilter;
    capabilityFilter?: AlphabetCapabilityFilter;
    viewMode?: AlphabetViewMode;
    previewMode?: AlphabetPreviewMode;
}

const FAMILY_FILTERS: Array<{ id: AlphabetFamilyFilter; label: string; keywords: string[] }> = [
    { id: 'all', label: 'Toutes familles', keywords: [] },
    {
        id: 'fiction',
        label: 'Fiction',
        keywords: [
            'fiction', 'star wars', 'stargate', 'futurama', 'dune', 'fremen', 'hobbit', 'kryptonian',
            'romulan', 'wakanda', 'matoran', 'pokemon', 'zentradi', 'aurebesh', 'borg',
            'autobot', 'mandolarian', 'daedrique', 'skies of arcadia', 'final fantasy',
            'banner of the stars', 'crest of the stars', 'jeu video', 'film', 'manga',
            'serie tele', 'série télé'
        ]
    },
    {
        id: 'runes',
        label: 'Runes / ancien',
        keywords: ['ancien', 'rune', 'runes', 'futhark', 'hobbit', 'templier', 'theban', 'malachim', 'enochian', 'pictish']
    },
    {
        id: 'communication',
        label: 'Signaux',
        keywords: [
            'signaux', 'morse', 'semaphore', 'sémaphore', 'drapeaux', 'maritime', 'navire',
            'telegraphe', 'télégraphe', 'chappe', 'radio', 'sos', 'signalisation',
            'communication'
        ]
    },
    {
        id: 'numeric',
        label: 'Nombres',
        keywords: [
            'numeral', 'numeric', 'number', 'nombres', 'chiffres', 'cistercien',
            'chinese_numbers', 'resistor', 'résistance', 'ohm', 'code couleur'
        ]
    },
    {
        id: 'tactile',
        label: 'Tactile',
        keywords: ['braille', 'aveugle', 'malvoyant', 'accessibilite', 'accessibilité', 'relief', 'tactile']
    },
    {
        id: 'visual',
        label: 'Graphiques',
        keywords: [
            'graphique', 'graphiques', 'visuel', 'artistique', 'ballet', 'danse', 'danseuse', 'circle', 'circulaire',
            'points', 'traits', 'labyrinthe', 'personnage', 'personnages', 'hexahue',
            'puzzle', 'pigpen'
        ]
    }
];

const CISTERCIAN_TOOL_ALPHABET: Alphabet = {
    id: CISTERCIAN_TOOL_ID,
    name: 'Chiffres cisterciens',
    description: 'Convertir une valeur en symbole, ou composer un symbole pour retrouver sa valeur.',
    type: 'numeral-tool',
    tags: ['numeral', 'cistercien', 'geocaching'],
    alphabetConfig: {
        type: 'images',
        hasUpperCase: false,
        characters: {
            letters: [],
            numbers: [],
            special: {}
        }
    },
    source: 'official'
};

interface AlphabetPreviewProps {
    alphabet: Alphabet;
    previewText: string;
    fontSize: number;
    alphabetsService: AlphabetsService;
}

interface PreviewCharacterEntry {
    key: string;
    char: string;
    resourcePaths: string[];
}

const AlphabetPreview: React.FC<AlphabetPreviewProps> = React.memo(
    ({ alphabet, previewText, fontSize, alphabetsService }) => {
        const { alphabetConfig } = alphabet;
        const fontFamily = React.useMemo(() => getFontFamily(alphabet.id), [alphabet.id]);
        const [resolvedPreviewSources, setResolvedPreviewSources] = React.useState<Record<string, string | null>>({});
        const characterArray = React.useMemo(() => {
            if (!previewText) {
                return [];
            }
            return Array.from(previewText);
        }, [previewText]);
        const previewEntries = React.useMemo<PreviewCharacterEntry[]>(() => {
            if (alphabetConfig.type !== 'images') {
                return [];
            }

            return characterArray.slice(0, IMAGE_PREVIEW_LENGTH).map((char, index) => ({
                key: `${alphabet.id}-${index}-${char}`,
                char,
                resourcePaths: getImageResourcePathCandidates(alphabetConfig, char)
            }));
        }, [alphabet.id, alphabetConfig, characterArray]);

        React.useEffect(() => {
            let cancelled = false;

            if (alphabetConfig.type !== 'images') {
                return () => {
                    cancelled = true;
                };
            }

            previewEntries.forEach(entry => {
                if (entry.resourcePaths.length === 0) {
                    return;
                }

                void resolveAlphabetImageSource(alphabet.id, alphabetConfig, entry.char, alphabetsService)
                    .then(resolvedSource => {
                        if (cancelled) {
                            return;
                        }

                        setResolvedPreviewSources(currentState => {
                            if (currentState[entry.key] === resolvedSource) {
                                return currentState;
                            }
                            return {
                                ...currentState,
                                [entry.key]: resolvedSource
                            };
                        });
                    });
            });

            return () => {
                cancelled = true;
            };
        }, [alphabet.id, alphabetConfig.type, previewEntries, alphabetsService]);

        React.useEffect(() => {
            if (typeof document === 'undefined' || typeof FontFace === 'undefined') {
                return;
            }
            if (!previewText || alphabetConfig.type !== 'font') {
                return;
            }
            try {
                const fontUrl = alphabetsService.getFontUrl(alphabet.id);
                void ensureAlphabetFontLoaded(alphabet.id, fontUrl).catch(error =>
                    console.error(`AlphabetsListWidget: Erreur de chargement de police ${alphabet.id}`, error)
                );
            } catch (error) {
                console.error(`AlphabetsListWidget: FontFace non disponible pour ${alphabet.id}`, error);
            }
        }, [alphabet.id, alphabetConfig.type, previewText, alphabetsService, fontFamily]);

        if (!previewText) {
            return null;
        }

        if (!alphabetConfig) {
            return (
                <div style={{ color: 'var(--theia-descriptionForeground)', fontSize: '11px' }}>
                    Prévisualisation indisponible
                </div>
            );
        }

        if (alphabetConfig.type === 'font') {
            return (
                <div
                    style={{
                        marginTop: '10px',
                        padding: '8px',
                        borderRadius: '4px',
                        backgroundColor: 'var(--theia-editor-background)',
                        overflowX: 'auto'
                    }}
                >
                    <span
                        style={{
                            fontFamily,
                            fontSize: `${fontSize}px`,
                            color: 'var(--theia-foreground)'
                        }}
                    >
                        {characterArray.slice(0, MAX_FONT_PREVIEW_LENGTH).join('')}
                    </span>
                </div>
            );
        }

        const hasImageConfig = Boolean(alphabetConfig.imageDir && alphabetConfig.imageFormat);

        if (alphabetConfig.type === 'images' && hasImageConfig) {
            const size = Math.round(fontSize * 1.5);

            return (
                <div
                    style={{
                        marginTop: '10px',
                        padding: '8px',
                        borderRadius: '4px',
                        backgroundColor: 'var(--theia-editor-background)',
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: '6px'
                    }}
                >
                    {previewEntries.map(entry => {
                        const resolvedSource = resolvedPreviewSources[entry.key];

                        if (resolvedSource) {
                            return (
                                <img
                                    key={entry.key}
                                    src={resolvedSource}
                                    alt={entry.char}
                                    onError={() => {
                                        setResolvedPreviewSources(currentState => {
                                            if (currentState[entry.key] === null) {
                                                return currentState;
                                            }
                                            return {
                                                ...currentState,
                                                [entry.key]: null
                                            };
                                        });
                                    }}
                                    style={{
                                        width: `${size}px`,
                                        height: `${size}px`,
                                        objectFit: 'contain',
                                        backgroundColor: 'var(--theia-layout-color1)',
                                        borderRadius: '3px'
                                    }}
                                />
                            );
                        }
                        return (
                            <div
                                key={entry.key}
                                style={{
                                    width: `${size}px`,
                                    height: `${size}px`,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    backgroundColor: 'var(--theia-layout-color2)',
                                    borderRadius: '3px',
                                    color: 'var(--theia-descriptionForeground)',
                                    fontSize: '12px'
                                }}
                            >
                                {entry.char}
                            </div>
                        );
                    })}
                </div>
            );
        }

        return (
            <div style={{ color: 'var(--theia-descriptionForeground)', fontSize: '11px', marginTop: '8px' }}>
                Prévisualisation non disponible pour ce type d'alphabet
            </div>
        );
    }
);

const alphabetHasLetters = (alphabet: Alphabet): boolean => {
    const letters = alphabet.alphabetConfig.characters?.letters;
    return letters === 'all' || (Array.isArray(letters) && letters.length > 0);
};

const alphabetHasNumbers = (alphabet: Alphabet): boolean => {
    const numbers = alphabet.alphabetConfig.characters?.numbers;
    return numbers === 'all' || (Array.isArray(numbers) && numbers.length > 0);
};

const alphabetHasSpecialCharacters = (alphabet: Alphabet): boolean => {
    const special = alphabet.alphabetConfig.characters?.special;
    return Boolean(special && Object.keys(special).length > 0);
};

const computeAlphabetBadges = (alphabet: Alphabet, isCistercianTool: boolean): string[] => {
    const badges: string[] = [];
    if (isCistercianTool) {
        badges.push('outil');
    } else {
        badges.push(alphabet.alphabetConfig.type === 'font' ? 'font' : 'images');
    }
    if (alphabetHasLetters(alphabet)) {
        badges.push('A-Z');
    }
    if (alphabetHasNumbers(alphabet)) {
        badges.push('0-9');
    }
    if (alphabetHasSpecialCharacters(alphabet)) {
        badges.push('special');
    }
    return badges;
};

interface AlphabetListItemProps {
    alphabet: Alphabet;
    isCistercianTool: boolean;
    isCompact: boolean;
    isFavorite: boolean;
    badges: string[];
    previewText: string;
    previewMode: AlphabetPreviewMode;
    fontSize: number;
    searchQuery: string;
    alphabetsService: AlphabetsService;
    onOpen: (alphabet: Alphabet) => void;
    onToggleFavorite: (alphabetId: string) => void;
}

/**
 * Item de liste isolé avec état de survol local. Le survol ne re-rend que cet
 * item (apparition de la preview + surbrillance), sans re-render du widget entier.
 */
const AlphabetListItem: React.FC<AlphabetListItemProps> = React.memo(({
    alphabet,
    isCistercianTool,
    isCompact,
    isFavorite,
    badges,
    previewText,
    previewMode,
    fontSize,
    searchQuery,
    alphabetsService,
    onOpen,
    onToggleFavorite
}) => {
    const [hovered, setHovered] = React.useState(false);

    const hasSearchMatches = Boolean(
        searchQuery && alphabet.search_matches && alphabet.search_matches.length > 0
    );
    const shouldShowPreview = Boolean(
        previewText &&
        !isCistercianTool &&
        !isCompact &&
        (previewMode === 'always' || hovered)
    );

    return (
        <div
            onClick={() => onOpen(alphabet)}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            style={{
                padding: isCompact ? '7px 8px' : '10px',
                marginBottom: isCompact ? '5px' : '8px',
                backgroundColor: hovered
                    ? 'var(--theia-list-hoverBackground)'
                    : 'var(--theia-list-activeSelectionBackground)',
                border: '1px solid var(--theia-list-inactiveSelectionBackground)',
                borderRadius: '4px',
                cursor: 'pointer',
                transition: 'all 0.2s'
            }}
        >
            <div style={{ marginBottom: isCompact ? '2px' : '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                {isCistercianTool && <i className='fa fa-calculator' style={{ marginRight: '8px' }} />}
                <button
                    onClick={event => {
                        event.stopPropagation();
                        onToggleFavorite(alphabet.id);
                    }}
                    title={isFavorite ? 'Retirer des favoris' : 'Ajouter aux favoris'}
                    style={{
                        border: 'none',
                        background: 'transparent',
                        color: isFavorite ? 'var(--theia-button-background)' : 'var(--theia-descriptionForeground)',
                        cursor: 'pointer',
                        padding: '0 2px',
                        fontSize: '14px',
                        lineHeight: 1
                    }}
                >
                    <i className={isFavorite ? 'fa fa-star' : 'fa fa-star-o'} />
                </button>
                <span style={{ fontWeight: 'bold', flex: 1, color: 'var(--theia-foreground)' }}>
                    {alphabet.name}
                </span>
                <span style={{ display: 'flex', flexWrap: 'wrap', gap: '3px', justifyContent: 'flex-end' }}>
                    {badges.map(badge => (
                        <span
                            key={`${alphabet.id}-badge-${badge}`}
                            style={{
                                padding: '1px 4px',
                                borderRadius: '2px',
                                backgroundColor: 'var(--theia-badge-background)',
                                color: 'var(--theia-badge-foreground)',
                                fontSize: '9px',
                                lineHeight: 1.4,
                                whiteSpace: 'nowrap'
                            }}
                        >
                            {badge}
                        </span>
                    ))}
                </span>
            </div>
            {!isCompact && (
                <div style={{ fontSize: '11px', color: 'var(--theia-descriptionForeground)', marginBottom: '4px' }}>
                    {alphabet.description}
                </div>
            )}
            {hasSearchMatches && (
                <div style={{ marginBottom: '4px' }}>
                    <div style={{ color: 'var(--theia-linkForeground)', fontSize: '10px', fontWeight: 600 }}>
                        Correspondances trouvées :
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '4px' }}>
                        {alphabet.search_matches!.map(match => (
                            <span
                                key={`${alphabet.id}-match-${match}`}
                                style={{
                                    backgroundColor: 'var(--theia-badge-background)',
                                    color: 'var(--theia-badge-foreground)',
                                    borderRadius: '3px',
                                    padding: '2px 6px',
                                    fontSize: '10px'
                                }}
                            >
                                {match}
                            </span>
                        ))}
                    </div>
                </div>
            )}
            {!isCompact && alphabet.tags && alphabet.tags.length > 0 && (
                <div style={{ fontSize: '10px', color: 'var(--theia-descriptionForeground)' }}>
                    {alphabet.tags.slice(0, 3).map(tag => (
                        <span
                            key={tag}
                            style={{
                                marginRight: '4px',
                                padding: '1px 4px',
                                backgroundColor: 'var(--theia-badge-background)',
                                color: 'var(--theia-badge-foreground)',
                                borderRadius: '2px'
                            }}
                        >
                            {tag}
                        </span>
                    ))}
                </div>
            )}
            {shouldShowPreview && (
                <AlphabetPreview
                    alphabet={alphabet}
                    previewText={previewText}
                    fontSize={fontSize}
                    alphabetsService={alphabetsService}
                />
            )}
        </div>
    );
});

@injectable()
export class AlphabetsListWidget extends ReactWidget {

    static readonly ID = 'alphabets-list';
    static readonly LABEL = 'Alphabets';

    @inject(AlphabetsService)
    protected readonly alphabetsService!: AlphabetsService;

    @inject(MessageService)
    protected readonly messageService!: MessageService;

    @inject(CommandService)
    protected readonly commandService!: CommandService;

    private alphabets: Alphabet[] = [];
    private loading: boolean = true;
    private searchQuery: string = '';
    private searchInName: boolean = true;
    private searchInTags: boolean = true;
    private searchInReadme: boolean = false;
    private debounceTimer: NodeJS.Timeout | null = null;
    private showExamples: boolean = false;
    private exampleTextOption: string = PRESET_EXAMPLE_OPTIONS[0].value;
    private customExampleText: string = '';
    private fontSize: number = 32;
    private scopeFilter: AlphabetScopeFilter = 'all';
    private familyFilter: AlphabetFamilyFilter = 'all';
    private capabilityFilter: AlphabetCapabilityFilter = 'all';
    private viewMode: AlphabetViewMode = 'detailed';
    private previewMode: AlphabetPreviewMode = 'hover';
    private favoriteAlphabetIds: string[] = [];
    private recentAlphabetIds: string[] = [];
    private loadRequestSeq: number = 0;
    private persistListPreferencesTimer: NodeJS.Timeout | null = null;

    @postConstruct()
    protected init(): void {
        this.id = AlphabetsListWidget.ID;
        this.title.label = AlphabetsListWidget.LABEL;
        this.title.caption = AlphabetsListWidget.LABEL;
        this.title.closable = true;
        this.title.iconClass = 'fa fa-language'; // Icône pour les alphabets
        
        this.loadListPreferences();
        void this.loadPersistentAlphabetState();
        this.update();
        this.loadAlphabets();
    }

    /**
     * Charge la liste des alphabets depuis le backend.
     */
    private async loadAlphabets(): Promise<void> {
        const requestSeq = ++this.loadRequestSeq;
        try {
            this.loading = true;
            this.update();
            
            // Si recherche active, utiliser les options de recherche
            if (this.searchQuery && this.searchQuery.trim() !== '') {
                const searchOptions = {
                    query: this.searchQuery,
                    search_in_name: this.searchInName,
                    search_in_tags: this.searchInTags,
                    search_in_readme: this.searchInReadme
                };
                const alphabets = await this.alphabetsService.listAlphabets(searchOptions);
                if (requestSeq !== this.loadRequestSeq) {
                    return;
                }
                this.alphabets = alphabets;
            } else {
                const alphabets = await this.alphabetsService.listAlphabets();
                if (requestSeq !== this.loadRequestSeq) {
                    return;
                }
                this.alphabets = alphabets;
            }
            
            this.loading = false;
            this.update();
        } catch (error) {
            if (requestSeq !== this.loadRequestSeq) {
                return;
            }
            console.error('Error loading alphabets:', error);
            this.messageService.error('Erreur lors du chargement des alphabets');
            this.loading = false;
            this.update();
        }
    }

    /**
     * Déclenche la recherche avec debouncing.
     */
    private async performSearch(): Promise<void> {
        // Annuler le timer précédent
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
        }

        // Créer un nouveau timer
        this.debounceTimer = setTimeout(async () => {
            await this.loadAlphabets();
        }, 500); // 500ms de debounce
    }

    private loadListPreferences(): void {
        try {
            const saved = localStorage.getItem(LIST_PREFERENCES_STORAGE_KEY);
            if (!saved) {
                return;
            }
            const preferences = JSON.parse(saved);
            this.showExamples = Boolean(preferences.showExamples);
            this.exampleTextOption = typeof preferences.exampleTextOption === 'string'
                ? preferences.exampleTextOption
                : this.exampleTextOption;
            this.customExampleText = typeof preferences.customExampleText === 'string'
                ? preferences.customExampleText
                : '';
            this.fontSize = typeof preferences.fontSize === 'number' ? preferences.fontSize : this.fontSize;
            this.scopeFilter = this.isScopeFilter(preferences.scopeFilter) ? preferences.scopeFilter : this.scopeFilter;
            this.familyFilter = this.isFamilyFilter(preferences.familyFilter)
                ? preferences.familyFilter
                : this.familyFilter;
            this.capabilityFilter = this.isCapabilityFilter(preferences.capabilityFilter)
                ? preferences.capabilityFilter
                : this.capabilityFilter;
            this.viewMode = preferences.viewMode === 'compact' || preferences.viewMode === 'detailed'
                ? preferences.viewMode
                : this.viewMode;
            this.previewMode = preferences.previewMode === 'always' || preferences.previewMode === 'hover'
                ? preferences.previewMode
                : this.previewMode;
            this.favoriteAlphabetIds = this.normalizeStoredIds(preferences.favoriteAlphabetIds);
            this.recentAlphabetIds = this.normalizeStoredIds(preferences.recentAlphabetIds).slice(0, MAX_RECENT_ALPHABETS);
        } catch (error) {
            console.warn('AlphabetsListWidget: unable to load list preferences', error);
        }
    }

    private saveListPreferences(): void {
        try {
            localStorage.setItem(LIST_PREFERENCES_STORAGE_KEY, JSON.stringify({
                ...this.getListPreferencesPayload(),
                favoriteAlphabetIds: this.favoriteAlphabetIds,
                recentAlphabetIds: this.recentAlphabetIds
            }));
        } catch (error) {
            console.warn('AlphabetsListWidget: unable to save list preferences', error);
        }
        this.schedulePersistentListPreferencesSave();
    }

    private async loadPersistentAlphabetState(): Promise<void> {
        const localFavorites = [...this.favoriteAlphabetIds];
        const localRecents = [...this.recentAlphabetIds];

        // Un seul appel réseau pour les trois préférences (au lieu de trois).
        const allPreferences = await this.alphabetsService.getAllPreferences();
        const storedListPreferences = allPreferences[LIST_PREFERENCES_PREF];
        const storedFavorites = allPreferences[FAVORITE_ALPHABETS_PREF];
        const storedRecents = allPreferences[RECENT_ALPHABETS_PREF];

        if (this.isRecord(storedListPreferences) && Object.keys(storedListPreferences).length > 0) {
            this.applyListPreferences(storedListPreferences);
        } else {
            void this.savePersistentListPreferences();
        }

        const remoteFavorites = this.normalizeStoredIds(storedFavorites);
        const remoteRecents = this.normalizeStoredIds(storedRecents).slice(0, MAX_RECENT_ALPHABETS);
        const shouldMigrateLocalState = remoteFavorites.length === 0 && remoteRecents.length === 0
            && (localFavorites.length > 0 || localRecents.length > 0);

        if (shouldMigrateLocalState) {
            void this.savePersistentAlphabetState();
            return;
        }

        this.favoriteAlphabetIds = remoteFavorites;
        this.recentAlphabetIds = remoteRecents;
        this.saveListPreferences();
        this.update();
    }

    private savePersistentAlphabetState(): Promise<void> {
        return this.alphabetsService.updatePreferences({
            [FAVORITE_ALPHABETS_PREF]: this.favoriteAlphabetIds,
            [RECENT_ALPHABETS_PREF]: this.recentAlphabetIds
        }).catch(error => {
            console.warn('AlphabetsListWidget: unable to persist alphabet favorites/recent state', error);
        });
    }

    private getListPreferencesPayload(): AlphabetListPreferencesPayload {
        return {
            showExamples: this.showExamples,
            exampleTextOption: this.exampleTextOption,
            customExampleText: this.customExampleText,
            fontSize: this.fontSize,
            scopeFilter: this.scopeFilter,
            familyFilter: this.familyFilter,
            capabilityFilter: this.capabilityFilter,
            viewMode: this.viewMode,
            previewMode: this.previewMode
        };
    }

    private applyListPreferences(preferences: Record<string, unknown>): void {
        if ('showExamples' in preferences) {
            this.showExamples = Boolean(preferences.showExamples);
        }
        if (typeof preferences.exampleTextOption === 'string') {
            this.exampleTextOption = preferences.exampleTextOption;
        }
        if (typeof preferences.customExampleText === 'string') {
            this.customExampleText = preferences.customExampleText;
        }
        if (typeof preferences.fontSize === 'number') {
            this.fontSize = preferences.fontSize;
        }
        if (this.isScopeFilter(preferences.scopeFilter)) {
            this.scopeFilter = preferences.scopeFilter;
        }
        if (this.isFamilyFilter(preferences.familyFilter)) {
            this.familyFilter = preferences.familyFilter;
        }
        if (this.isCapabilityFilter(preferences.capabilityFilter)) {
            this.capabilityFilter = preferences.capabilityFilter;
        }
        if (preferences.viewMode === 'compact' || preferences.viewMode === 'detailed') {
            this.viewMode = preferences.viewMode;
        }
        if (preferences.previewMode === 'always' || preferences.previewMode === 'hover') {
            this.previewMode = preferences.previewMode;
        }
    }

    private schedulePersistentListPreferencesSave(): void {
        if (this.persistListPreferencesTimer) {
            clearTimeout(this.persistListPreferencesTimer);
        }
        this.persistListPreferencesTimer = setTimeout(() => {
            this.persistListPreferencesTimer = null;
            void this.savePersistentListPreferences();
        }, PERSIST_LIST_PREFERENCES_DELAY_MS);
    }

    private savePersistentListPreferences(): Promise<void> {
        return this.alphabetsService.updatePreferences({
            [LIST_PREFERENCES_PREF]: this.getListPreferencesPayload()
        }).catch(error => {
            console.warn('AlphabetsListWidget: unable to persist list preferences', error);
        });
    }

    private isFamilyFilter(value: unknown): value is AlphabetFamilyFilter {
        return FAMILY_FILTERS.some(filter => filter.id === value);
    }

    private isScopeFilter(value: unknown): value is AlphabetScopeFilter {
        return value === 'all' || value === 'favorites' || value === 'recent';
    }

    private isCapabilityFilter(value: unknown): value is AlphabetCapabilityFilter {
        return value === 'all' || value === 'letters' || value === 'numbers' || value === 'special';
    }

    private normalizeStoredIds(value: unknown): string[] {
        return Array.isArray(value)
            ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
            : [];
    }

    private isRecord(value: unknown): value is Record<string, unknown> {
        return typeof value === 'object' && value !== null && !Array.isArray(value);
    }

    /**
     * Retourne le texte à afficher pour les exemples.
     */
    private getPreviewText(): string {
        if (!this.showExamples) {
            return '';
        }

        if (this.exampleTextOption === 'custom') {
            return (this.customExampleText || '').substring(0, MAX_FONT_PREVIEW_LENGTH);
        }

        return this.exampleTextOption.substring(0, MAX_FONT_PREVIEW_LENGTH);
    }

    /**
     * Actualise la liste des alphabets.
     */
    public async refresh(): Promise<void> {
        this.alphabetsService.invalidateCache();
        await this.loadAlphabets();
        this.messageService.info('Liste des alphabets actualisée');
    }

    /**
     * Force la redécouverte des alphabets.
     */
    public async discover(): Promise<void> {
        try {
            const result = await this.alphabetsService.discoverAlphabets();
            this.alphabets = result.alphabets;
            this.update();
            this.messageService.info(`${result.count} alphabet(s) découvert(s)`);
        } catch (error) {
            console.error('Error discovering alphabets:', error);
            this.messageService.error('Erreur lors de la découverte des alphabets');
        }
    }

    /**
     * Rendu du widget.
     */
    protected render(): React.ReactNode {
        return (
            <div className='alphabets-list-container' style={{ 
                height: '100%', 
                overflow: 'auto',
                padding: '10px',
                backgroundColor: 'var(--theia-layout-color1)'
            }}>
                {this.renderHeader()}
                {this.renderExampleControls()}
                {this.renderContent()}
            </div>
        );
    }

    /**
     * Rendu de l'en-tête avec recherche.
     */
    private renderHeader(): React.ReactNode {
        return (
            <div style={{ marginBottom: '15px' }}>
                <div style={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    marginBottom: '10px',
                    gap: '8px'
                }}>
                    <input
                        type='text'
                        placeholder='Rechercher...'
                        value={this.searchQuery}
                        onChange={e => {
                            this.searchQuery = e.target.value;
                            this.update();
                            this.performSearch();
                        }}
                        onKeyDown={e => {
                            if (e.key === 'Enter') {
                                // Recherche immédiate sur Enter
                                if (this.debounceTimer) {
                                    clearTimeout(this.debounceTimer);
                                }
                                this.loadAlphabets();
                            }
                        }}
                        style={{
                            flex: 1,
                            padding: '6px 10px',
                            backgroundColor: 'var(--theia-input-background)',
                            color: 'var(--theia-input-foreground)',
                            border: '1px solid var(--theia-input-border)',
                            borderRadius: '3px'
                        }}
                    />
                    {this.searchQuery && (
                        <button
                            onClick={() => {
                                this.searchQuery = '';
                                this.update();
                                this.loadAlphabets();
                            }}
                            title='Effacer la recherche'
                            style={{
                                padding: '6px 10px',
                                backgroundColor: 'var(--theia-button-background)',
                                color: 'var(--theia-button-foreground)',
                                border: 'none',
                                borderRadius: '3px',
                                cursor: 'pointer'
                            }}
                        >
                            <i className='fa fa-times'></i>
                        </button>
                    )}
                    <button
                        onClick={() => this.refresh()}
                        title='Actualiser'
                        style={{
                            padding: '6px 10px',
                            backgroundColor: 'var(--theia-button-background)',
                            color: 'var(--theia-button-foreground)',
                            border: 'none',
                            borderRadius: '3px',
                            cursor: 'pointer'
                        }}
                    >
                        <i className='fa fa-refresh'></i>
                    </button>
                </div>
                
                {/* Options de recherche */}
                <div style={{ 
                    marginBottom: '8px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '4px',
                    fontSize: '11px'
                }}>
                    <label style={{ 
                        display: 'flex', 
                        alignItems: 'center',
                        cursor: 'pointer',
                        color: 'var(--theia-foreground)'
                    }}>
                        <input
                            type='checkbox'
                            checked={this.searchInName}
                            onChange={e => {
                                this.searchInName = e.target.checked;
                                this.update();
                                if (this.searchQuery) {
                                    this.performSearch();
                                }
                            }}
                            style={{ marginRight: '6px' }}
                        />
                        Nom & Description
                    </label>
                    <label style={{ 
                        display: 'flex', 
                        alignItems: 'center',
                        cursor: 'pointer',
                        color: 'var(--theia-foreground)'
                    }}>
                        <input
                            type='checkbox'
                            checked={this.searchInTags}
                            onChange={e => {
                                this.searchInTags = e.target.checked;
                                this.update();
                                if (this.searchQuery) {
                                    this.performSearch();
                                }
                            }}
                            style={{ marginRight: '6px' }}
                        />
                        Tags
                    </label>
                    <label style={{ 
                        display: 'flex', 
                        alignItems: 'center',
                        cursor: 'pointer',
                        color: 'var(--theia-foreground)'
                    }}>
                        <input
                            type='checkbox'
                            checked={this.searchInReadme}
                            onChange={e => {
                                this.searchInReadme = e.target.checked;
                                this.update();
                                if (this.searchQuery) {
                                    this.performSearch();
                                }
                            }}
                            style={{ marginRight: '6px' }}
                        />
                        Description longue (README)
                    </label>
                </div>

                {this.renderQuickFilters()}

                <div style={{ fontSize: '11px', color: 'var(--theia-descriptionForeground)' }}>
                    {this.getDisplayedAlphabets().length} alphabet(s) disponible(s)
                </div>
            </div>
        );
    }

    private isFavorite(alphabetId: string): boolean {
        return this.favoriteAlphabetIds.includes(alphabetId);
    }

    private toggleFavorite(alphabetId: string): void {
        if (this.isFavorite(alphabetId)) {
            this.favoriteAlphabetIds = this.favoriteAlphabetIds.filter(id => id !== alphabetId);
        } else {
            this.favoriteAlphabetIds = [alphabetId, ...this.favoriteAlphabetIds];
        }
        this.saveListPreferences();
        void this.savePersistentAlphabetState();
        this.update();
    }

    private renderQuickFilters(): React.ReactNode {
        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', margin: '10px 0' }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                    {this.renderFilterButton('Tous', this.scopeFilter === 'all', () => {
                        this.scopeFilter = 'all';
                        this.saveListPreferences();
                        this.update();
                    })}
                    {this.renderFilterButton(`Favoris (${this.favoriteAlphabetIds.length})`, this.scopeFilter === 'favorites', () => {
                        this.scopeFilter = 'favorites';
                        this.saveListPreferences();
                        this.update();
                    })}
                    {this.renderFilterButton(`Recents (${this.recentAlphabetIds.length})`, this.scopeFilter === 'recent', () => {
                        this.scopeFilter = 'recent';
                        this.saveListPreferences();
                        this.update();
                    })}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                    {FAMILY_FILTERS.map(filter => this.renderFilterButton(filter.label, this.familyFilter === filter.id, () => {
                        this.familyFilter = filter.id;
                        this.saveListPreferences();
                        this.update();
                    }))}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                    {this.renderFilterButton('Tout contenu', this.capabilityFilter === 'all', () => {
                        this.capabilityFilter = 'all';
                        this.saveListPreferences();
                        this.update();
                    })}
                    {this.renderFilterButton('Lettres', this.capabilityFilter === 'letters', () => {
                        this.capabilityFilter = 'letters';
                        this.saveListPreferences();
                        this.update();
                    })}
                    {this.renderFilterButton('Chiffres', this.capabilityFilter === 'numbers', () => {
                        this.capabilityFilter = 'numbers';
                        this.saveListPreferences();
                        this.update();
                    })}
                    {this.renderFilterButton('Speciaux', this.capabilityFilter === 'special', () => {
                        this.capabilityFilter = 'special';
                        this.saveListPreferences();
                        this.update();
                    })}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center' }}>
                    <select
                        value={this.viewMode}
                        onChange={e => {
                            this.viewMode = e.target.value === 'compact' ? 'compact' : 'detailed';
                            this.saveListPreferences();
                            this.update();
                        }}
                        title='Densite de la liste'
                        style={{
                            flex: '1 1 120px',
                            minWidth: '120px',
                            padding: '4px 8px',
                            borderRadius: '3px',
                            backgroundColor: 'var(--theia-input-background)',
                            color: 'var(--theia-input-foreground)',
                            border: '1px solid var(--theia-input-border)',
                            fontSize: '11px'
                        }}
                    >
                        <option value='detailed'>Vue detaillee</option>
                        <option value='compact'>Vue compacte</option>
                    </select>
                    <select
                        value={this.previewMode}
                        onChange={e => {
                            this.previewMode = e.target.value === 'always' ? 'always' : 'hover';
                            this.saveListPreferences();
                            this.update();
                        }}
                        disabled={!this.showExamples}
                        title='Chargement des exemples'
                        style={{
                            flex: '1 1 120px',
                            minWidth: '120px',
                            padding: '4px 8px',
                            borderRadius: '3px',
                            backgroundColor: 'var(--theia-input-background)',
                            color: 'var(--theia-input-foreground)',
                            border: '1px solid var(--theia-input-border)',
                            fontSize: '11px',
                            opacity: this.showExamples ? 1 : 0.6
                        }}
                    >
                        <option value='hover'>Preview au survol</option>
                        <option value='always'>Preview partout</option>
                    </select>
                </div>
            </div>
        );
    }

    private renderFilterButton(label: string, active: boolean, onClick: () => void): React.ReactNode {
        return (
            <button
                onClick={onClick}
                style={{
                    border: `1px solid ${active ? 'var(--theia-focusBorder)' : 'var(--theia-input-border)'}`,
                    backgroundColor: active ? 'var(--theia-button-background)' : 'var(--theia-input-background)',
                    color: active ? 'var(--theia-button-foreground)' : 'var(--theia-input-foreground)',
                    borderRadius: '3px',
                    padding: '3px 7px',
                    cursor: 'pointer',
                    fontSize: '11px'
                }}
            >
                {label}
            </button>
        );
    }

    /**
     * Rendu des contrôles d'exemple (texte, taille, affichage).
     */
    private renderExampleControls(): React.ReactNode {
        const showCustomInput = this.showExamples && this.exampleTextOption === 'custom';
        const controlsDisabled = !this.showExamples;

        return (
            <div
                style={{
                    marginBottom: '15px',
                    borderBottom: '1px solid var(--theia-border-color1)',
                    paddingBottom: '12px'
                }}
            >
                <div
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        marginBottom: '10px'
                    }}
                >
                    <span style={{ fontSize: '12px', color: 'var(--theia-foreground)' }}>Exemples :</span>
                    <select
                        value={this.showExamples ? 'true' : 'false'}
                        onChange={e => {
                            this.showExamples = e.target.value === 'true';
                            this.saveListPreferences();
                            this.update();
                        }}
                        style={{
                            padding: '4px 8px',
                            borderRadius: '3px',
                            backgroundColor: 'var(--theia-input-background)',
                            color: 'var(--theia-input-foreground)',
                            border: '1px solid var(--theia-input-border)'
                        }}
                    >
                        <option value='false'>Masquer</option>
                        <option value='true'>Afficher</option>
                    </select>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '11px' }}>
                    <div
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            opacity: controlsDisabled ? 0.6 : 1
                        }}
                    >
                        <span style={{ width: '70px', color: 'var(--theia-descriptionForeground)' }}>Texte :</span>
                        <select
                            value={this.exampleTextOption}
                            onChange={e => {
                                this.exampleTextOption = e.target.value;
                                this.saveListPreferences();
                                this.update();
                            }}
                            disabled={controlsDisabled}
                            style={{
                                flex: 1,
                                padding: '4px 8px',
                                borderRadius: '3px',
                                backgroundColor: 'var(--theia-input-background)',
                                color: 'var(--theia-input-foreground)',
                                border: '1px solid var(--theia-input-border)'
                            }}
                        >
                            {PRESET_EXAMPLE_OPTIONS.map(option => (
                                <option key={option.value} value={option.value}>
                                    {option.label}
                                </option>
                            ))}
                            <option value='custom'>Personnalisé</option>
                        </select>
                    </div>

                    {showCustomInput && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={{ width: '70px', color: 'var(--theia-descriptionForeground)' }}>Texte perso :</span>
                            <input
                                type='text'
                                value={this.customExampleText}
                                onChange={e => {
                                    this.customExampleText = e.target.value;
                                    this.saveListPreferences();
                                    this.update();
                                }}
                                placeholder='Saisissez votre texte...'
                                style={{
                                    flex: 1,
                                    padding: '4px 8px',
                                    borderRadius: '3px',
                                    backgroundColor: 'var(--theia-input-background)',
                                    color: 'var(--theia-input-foreground)',
                                    border: '1px solid var(--theia-input-border)'
                                }}
                            />
                        </div>
                    )}

                    <div
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            opacity: controlsDisabled ? 0.6 : 1
                        }}
                    >
                        <span style={{ width: '70px', color: 'var(--theia-descriptionForeground)' }}>Taille :</span>
                        <select
                            value={String(this.fontSize)}
                            onChange={e => {
                                const value = parseInt(e.target.value, 10);
                                this.fontSize = Number.isNaN(value) ? 32 : value;
                                this.saveListPreferences();
                                this.update();
                            }}
                            disabled={controlsDisabled}
                            style={{
                                flex: 1,
                                padding: '4px 8px',
                                borderRadius: '3px',
                                backgroundColor: 'var(--theia-input-background)',
                                color: 'var(--theia-input-foreground)',
                                border: '1px solid var(--theia-input-border)'
                            }}
                        >
                            <option value='16'>Petite</option>
                            <option value='24'>Moyenne</option>
                            <option value='32'>Grande</option>
                            <option value='48'>Très grande</option>
                        </select>
                    </div>
                </div>
            </div>
        );
    }

    /**
     * Rendu du contenu (liste des alphabets ou loading).
     */
    private renderContent(): React.ReactNode {
        if (this.loading) {
            return (
                <div style={{ textAlign: 'center', padding: '20px', color: 'var(--theia-descriptionForeground)' }}>
                    <i className='fa fa-spinner fa-spin' style={{ marginRight: '8px' }}></i>
                    Chargement...
                </div>
            );
        }

        const displayedAlphabets = this.getDisplayedAlphabets();

        if (displayedAlphabets.length === 0) {
            return (
                <div style={{ textAlign: 'center', padding: '20px', color: 'var(--theia-descriptionForeground)' }}>
                    {this.searchQuery ? 'Aucun alphabet trouvé pour cette recherche' : 'Aucun alphabet disponible'}
                </div>
            );
        }

        const previewText = this.getPreviewText();
        const shouldRenderPreview = this.showExamples && previewText.length > 0;

        return (
            <div>
                {displayedAlphabets.map(alphabet =>
                    this.renderAlphabetItem(alphabet, shouldRenderPreview ? previewText : '')
                )}
            </div>
        );
    }

    /**
     * Rendu d'un item d'alphabet.
     */
    private renderAlphabetItem(alphabet: Alphabet, previewText: string): React.ReactNode {
        const isCistercianTool = alphabet.id === CISTERCIAN_TOOL_ID;
        return (
            <AlphabetListItem
                key={alphabet.id}
                alphabet={alphabet}
                isCistercianTool={isCistercianTool}
                isCompact={this.viewMode === 'compact'}
                isFavorite={this.isFavorite(alphabet.id)}
                badges={computeAlphabetBadges(alphabet, isCistercianTool)}
                previewText={previewText}
                previewMode={this.previewMode}
                fontSize={this.fontSize}
                searchQuery={this.searchQuery}
                alphabetsService={this.alphabetsService}
                onOpen={this.handleOpenAlphabet}
                onToggleFavorite={this.handleToggleFavorite}
            />
        );
    }

    private readonly handleOpenAlphabet = (alphabet: Alphabet): void => {
        this.openAlphabet(alphabet);
    };

    private readonly handleToggleFavorite = (alphabetId: string): void => {
        this.toggleFavorite(alphabetId);
    };

    /**
     * Ouvre un alphabet en exécutant la commande OPEN_VIEWER.
     */
    private openAlphabet(alphabet: Alphabet): void {
        if (alphabet.id === CISTERCIAN_TOOL_ID) {
            this.markRecentAlphabet(alphabet.id);
            this.openCistercianTool();
            return;
        }

        try {
            this.markRecentAlphabet(alphabet.id);
            this.commandService.executeCommand(AlphabetsCommands.OPEN_VIEWER.id, alphabet.id)
                .catch(err => console.error('AlphabetsListWidget: Error executing command:', err));
        } catch (error) {
            console.error('AlphabetsListWidget: Error calling executeCommand:', error);
        }
    }

    private markRecentAlphabet(alphabetId: string): void {
        this.recentAlphabetIds = [
            alphabetId,
            ...this.recentAlphabetIds.filter(id => id !== alphabetId)
        ].slice(0, MAX_RECENT_ALPHABETS);
        this.saveListPreferences();
        void this.savePersistentAlphabetState();
        this.update();
    }

    private openCistercianTool(): void {
        try {
            this.commandService.executeCommand(AlphabetsCommands.OPEN_CISTERCIAN.id)
                .catch(err => console.error('AlphabetsListWidget: Error opening cistercian tool:', err));
        } catch (error) {
            console.error('AlphabetsListWidget: Error calling cistercian command:', error);
        }
    }

    private getDisplayedAlphabets(): Alphabet[] {
        const query = this.searchQuery.trim().toLowerCase();
        if (query) {
            const cistercianMatches = this.matchesLocalSearch(CISTERCIAN_TOOL_ALPHABET, query)
                ? [CISTERCIAN_TOOL_ALPHABET]
                : [];
            return [...this.alphabets, ...cistercianMatches]
                .filter(alphabet => this.matchesActiveFilters(alphabet));
        }

        return [...this.alphabets, CISTERCIAN_TOOL_ALPHABET]
            .filter(alphabet => this.matchesActiveFilters(alphabet))
            .sort((a, b) => this.compareDisplayedAlphabets(a, b));
    }

    private matchesActiveFilters(alphabet: Alphabet): boolean {
        if (this.scopeFilter === 'favorites' && !this.isFavorite(alphabet.id)) {
            return false;
        }
        if (this.scopeFilter === 'recent' && !this.recentAlphabetIds.includes(alphabet.id)) {
            return false;
        }

        if (!this.matchesFamilyFilter(alphabet)) {
            return false;
        }

        if (this.capabilityFilter === 'letters' && !alphabetHasLetters(alphabet)) {
            return false;
        }
        if (this.capabilityFilter === 'numbers' && !alphabetHasNumbers(alphabet)) {
            return false;
        }
        if (this.capabilityFilter === 'special' && !alphabetHasSpecialCharacters(alphabet)) {
            return false;
        }

        return true;
    }

    private compareDisplayedAlphabets(a: Alphabet, b: Alphabet): number {
        if (this.scopeFilter === 'recent') {
            const aIndex = this.recentAlphabetIds.indexOf(a.id);
            const bIndex = this.recentAlphabetIds.indexOf(b.id);
            if (aIndex !== bIndex) {
                return aIndex - bIndex;
            }
        }

        if (this.scopeFilter === 'favorites') {
            const aIndex = this.favoriteAlphabetIds.indexOf(a.id);
            const bIndex = this.favoriteAlphabetIds.indexOf(b.id);
            if (aIndex !== bIndex) {
                return aIndex - bIndex;
            }
        }

        return a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' });
    }

    private matchesFamilyFilter(alphabet: Alphabet): boolean {
        if (this.familyFilter === 'all') {
            return true;
        }

        const family = FAMILY_FILTERS.find(filter => filter.id === this.familyFilter);
        if (!family) {
            return true;
        }

        const haystack = this.getAlphabetFamilyHaystack(alphabet);
        return family.keywords.some(keyword => haystack.includes(this.normalizeFamilyText(keyword)));
    }

    private getAlphabetFamilyHaystack(alphabet: Alphabet): string {
        return [
            alphabet.id,
            alphabet.name,
            alphabet.description,
            alphabet.category,
            alphabet.type,
            ...(alphabet.tags || [])
        ]
            .filter(Boolean)
            .map(value => this.normalizeFamilyText(String(value)))
            .join(' ');
    }

    private normalizeFamilyText(value: string): string {
        return value
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase();
    }

    private matchesLocalSearch(alphabet: Alphabet, query: string): boolean {
        const haystacks: string[] = [];
        if (this.searchInName) {
            haystacks.push(alphabet.name, alphabet.description);
        }
        if (this.searchInTags && alphabet.tags) {
            haystacks.push(...alphabet.tags);
        }
        if (alphabet.search_matches?.length) {
            haystacks.push(...alphabet.search_matches);
        }

        return haystacks.some(value => (value || '').toLowerCase().includes(query));
    }
}

