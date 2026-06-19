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

const loadedFonts = new Set<string>();
const loadingFonts: Map<string, Promise<void>> = new Map();

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
            if (loadedFonts.has(fontFamily) || loadingFonts.has(fontFamily)) {
                return;
            }
            try {
                const fontUrl = alphabetsService.getFontUrl(alphabet.id);
                const fontFace = new FontFace(fontFamily, `url(${fontUrl})`);
                const loadPromise = fontFace
                    .load()
                    .then(loadedFace => {
                        document.fonts.add(loadedFace);
                        loadedFonts.add(fontFamily);
                    })
                    .catch(error =>
                        console.error(`AlphabetsListWidget: Erreur de chargement de police ${alphabet.id}`, error)
                    )
                    .finally(() => {
                        loadingFonts.delete(fontFamily);
                    });
                loadingFonts.set(fontFamily, loadPromise);
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
    private loadRequestSeq: number = 0;

    @postConstruct()
    protected init(): void {
        this.id = AlphabetsListWidget.ID;
        this.title.label = AlphabetsListWidget.LABEL;
        this.title.caption = AlphabetsListWidget.LABEL;
        this.title.closable = true;
        this.title.iconClass = 'fa fa-language'; // Icône pour les alphabets
        
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

                <div style={{ fontSize: '11px', color: 'var(--theia-descriptionForeground)' }}>
                    {this.getDisplayedAlphabets().length} alphabet(s) disponible(s)
                </div>
            </div>
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
        const hasSearchMatches = Boolean(
            this.searchQuery &&
            alphabet.search_matches &&
            alphabet.search_matches.length > 0
        );

        return (
            <div
                key={alphabet.id}
                onClick={() => this.openAlphabet(alphabet)}
                style={{
                    padding: '10px',
                    marginBottom: '8px',
                    backgroundColor: 'var(--theia-list-activeSelectionBackground)',
                    border: '1px solid var(--theia-list-inactiveSelectionBackground)',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    transition: 'all 0.2s'
                }}
                onMouseEnter={e => {
                    e.currentTarget.style.backgroundColor = 'var(--theia-list-hoverBackground)';
                }}
                onMouseLeave={e => {
                    e.currentTarget.style.backgroundColor = 'var(--theia-list-activeSelectionBackground)';
                }}
            >
                <div style={{ marginBottom: '4px' }}>
                    {isCistercianTool && <i className='fa fa-calculator' style={{ marginRight: '8px' }} />}
                    <span style={{
                        fontWeight: 'bold',
                        color: 'var(--theia-foreground)'
                    }}>
                        {alphabet.name}
                    </span>
                </div>
                <div style={{ 
                    fontSize: '11px',
                    color: 'var(--theia-descriptionForeground)',
                    marginBottom: '4px'
                }}>
                    {alphabet.description}
                </div>
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
                {alphabet.tags && alphabet.tags.length > 0 && (
                    <div style={{ 
                        fontSize: '10px',
                        color: 'var(--theia-descriptionForeground)'
                    }}>
                        {alphabet.tags.slice(0, 3).map(tag => (
                            <span key={tag} style={{ 
                                marginRight: '4px',
                                padding: '1px 4px',
                                backgroundColor: 'var(--theia-badge-background)',
                                color: 'var(--theia-badge-foreground)',
                                borderRadius: '2px'
                            }}>
                                {tag}
                            </span>
                        ))}
                    </div>
                )}
                {previewText && !isCistercianTool && (
                    <AlphabetPreview
                        alphabet={alphabet}
                        previewText={previewText}
                        fontSize={this.fontSize}
                        alphabetsService={this.alphabetsService}
                    />
                )}
            </div>
        );
    }

    /**
     * Ouvre un alphabet en exécutant la commande OPEN_VIEWER.
     */
    private openAlphabet(alphabet: Alphabet): void {
        if (alphabet.id === CISTERCIAN_TOOL_ID) {
            this.openCistercianTool();
            return;
        }

        try {
            this.commandService.executeCommand(AlphabetsCommands.OPEN_VIEWER.id, alphabet.id)
                .catch(err => console.error('AlphabetsListWidget: Error executing command:', err));
        } catch (error) {
            console.error('AlphabetsListWidget: Error calling executeCommand:', error);
        }
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
            return [...this.alphabets, ...cistercianMatches];
        }

        return [...this.alphabets, CISTERCIAN_TOOL_ALPHABET]
            .sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }));
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

