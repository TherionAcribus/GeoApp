/**
 * Widget de visualisation d'un alphabet (panel central).
 * Affiche l'interface complète de décodage avec symboles, texte, et coordonnées.
 */
import * as React from '@theia/core/shared/react';
import { injectable, postConstruct, inject } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { MessageService } from '@theia/core';
import { ApplicationShell, StatefulWidget, WidgetManager } from '@theia/core/lib/browser';
import { PreferenceService } from '@theia/core/lib/common/preferences/preference-service';
import { PreferenceScope } from '@theia/core/lib/common/preferences/preference-scope';
import { AlphabetsService } from './services/alphabets-service';
import { Alphabet, ZoomState, PinnedState, AssociatedGeocache, DistanceInfo, DetectedCoordinates } from '../common/alphabet-protocol';
import { CoordinatesDetector } from './components/coordinates-detector';
import { GeocacheAssociation } from './components/geocache-association';
import { SymbolItem } from './components/symbol-item';
import { SymbolContextMenu } from './components/symbol-context-menu';
import './font-api';

const PREF_AVAILABLE_SYMBOLS_SHOW_VALUE = 'geoApp.alphabets.availableSymbols.showValue';

interface SerializedAlphabetViewerState {
    alphabetId?: string;
    lastAccessTimestamp?: number;
}

@injectable()
export class AlphabetViewerWidget extends ReactWidget implements StatefulWidget {

    static readonly ID_PREFIX = 'alphabet-viewer';

    @inject(AlphabetsService)
    protected readonly alphabetsService!: AlphabetsService;

    @inject(MessageService)
    protected readonly messageService!: MessageService;

    @inject(ApplicationShell)
    protected readonly shell!: ApplicationShell;

    @inject(WidgetManager)
    protected readonly widgetManager!: WidgetManager;

    @inject(PreferenceService)
    protected readonly preferenceService!: PreferenceService;

    private alphabet: Alphabet | null = null;
    private alphabetId: string;
    
    // État des symboles entrés
    private enteredChars: string[] = [];
    
    // État du zoom par section
    private zoomState: ZoomState = {
        enteredSymbols: 0.75,
        decodedText: 1,
        availableSymbols: 1,
        pinnedSymbols: 1,
        pinnedText: 1,
        pinnedCoordinates: 1
    };
    
    // État de l'épinglage
    private pinnedState: PinnedState = {
        symbols: false,
        text: false,
        coordinates: false
    };
    
    // Géocache associée et distance
    private associatedGeocache?: AssociatedGeocache;
    private distance?: DistanceInfo;
    private detectedCoordinates: DetectedCoordinates | null = null;
    private hasActiveCoordinateHighlight = false;
    private lastOpenedGeocacheCode?: string;
    
    // Polices chargées
    private fontLoaded: boolean = false;
    private loading: boolean = true;

    // État du drag & drop
    private draggedIndex: number | null = null;
    private dragOverIndex: number | null = null;

    // État du menu contextuel
    private contextMenu: {
        visible: boolean;
        x: number;
        y: number;
        symbolIndex: number;
    } | null = null;

    // Historique pour undo/redo
    private history: string[][] = [];
    private historyIndex: number = -1;
    private maxHistorySize: number = 50;

    private interactionTimerId: number | undefined;
    private lastAccessTimestamp: number = Date.now();

    private readonly handleContentClick = (): void => {
        this.emitInteraction('click');
    };

    private readonly handleContentScroll = (): void => {
        this.emitInteraction('scroll');
    };

    constructor(@inject('alphabetId') alphabetId: string) {
        super();
        console.log('AlphabetViewerWidget: constructor called with alphabetId:', alphabetId);
        this.alphabetId = alphabetId;
    }

    @postConstruct()
    protected init(): void {
        console.log('AlphabetViewerWidget: init called for:', this.alphabetId);
        console.log('AlphabetViewerWidget: Widget ID is:', this.id);
        this.title.closable = true;
        this.title.iconClass = 'fa fa-language';

        // Charger le zoom depuis localStorage
        this.loadZoomState();

        // Configurer les raccourcis clavier
        this.setupKeyboardShortcuts();

        // Re-render si la préférence change (GeoPreferencesWidget ou settings.json)
        this.toDispose.push(this.preferenceService.onPreferenceChanged(e => {
            if (e.preferenceName === PREF_AVAILABLE_SYMBOLS_SHOW_VALUE) {
                this.update();
            }
        }));

        this.update();
        console.log('AlphabetViewerWidget: Initial update called');

        // Initialiser de manière asynchrone sans bloquer la construction
        this.initializeAsync();
    }

    /**
     * Configure les raccourcis clavier.
     */
    private setupKeyboardShortcuts(): void {
        this.node.addEventListener('keydown', this.handleKeyDown);
        this.node.tabIndex = 0; // Permet de recevoir les événements clavier
    }

    /**
     * Nettoyage lors de la destruction du widget.
     */
    protected onBeforeDetach(msg: any): void {
        this.node.removeEventListener('keydown', this.handleKeyDown);
        this.removeInteractionListeners();
        super.onBeforeDetach(msg);
    }

    protected onAfterAttach(msg: any): void {
        super.onAfterAttach(msg);
        this.addInteractionListeners();
    }

    /**
     * Gestionnaire des événements clavier.
     */
    private handleKeyDown = (e: KeyboardEvent): void => {
        // Vérifier si le focus est dans un textarea (édition normale)
        const activeElement = document.activeElement;
        const isTextareaFocused = activeElement && activeElement.tagName === 'TEXTAREA';

        // Undo: Ctrl+Z (ou Cmd+Z sur Mac)
        if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
            e.preventDefault();
            this.undo();
        }
        // Redo: Ctrl+Y ou Ctrl+Shift+Z (ou Cmd+Y/Cmd+Shift+Z sur Mac)
        else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
            e.preventDefault();
            this.redo();
        }
        // Supprimer le dernier symbole: Backspace (seulement si pas dans textarea)
        else if (e.key === 'Backspace' && !e.ctrlKey && !e.metaKey && !isTextareaFocused) {
            e.preventDefault();
            this.deleteLastSymbol();
        }
        // Tout effacer: Ctrl+Backspace
        else if ((e.ctrlKey || e.metaKey) && e.key === 'Backspace') {
            e.preventDefault();
            this.clearSymbols();
        }
        // Export: Ctrl+E
        else if ((e.ctrlKey || e.metaKey) && e.key === 'e') {
            e.preventDefault();
            this.exportState();
        }
        // Import: Ctrl+I
        else if ((e.ctrlKey || e.metaKey) && e.key === 'i') {
            e.preventDefault();
            this.importState();
        }
    };

    private addInteractionListeners(): void {
        if (typeof window === 'undefined') {
            return;
        }
        this.node.addEventListener('click', this.handleContentClick, true);
        this.node.addEventListener('scroll', this.handleContentScroll, true);
    }

    private removeInteractionListeners(): void {
        if (typeof window === 'undefined') {
            return;
        }
        this.node.removeEventListener('click', this.handleContentClick, true);
        this.node.removeEventListener('scroll', this.handleContentScroll, true);
        this.clearMinOpenTimeTimer();
    }

    private emitInteraction(type: 'click' | 'scroll' | 'min-open-time'): void {
        if (typeof window === 'undefined') {
            return;
        }
        window.dispatchEvent(new CustomEvent('geoapp-alphabet-tab-interaction', {
            detail: {
                widgetId: this.id,
                type
            }
        }));
    }

    private setupMinOpenTimeTimer(): void {
        this.clearMinOpenTimeTimer();

        if (typeof window === 'undefined') {
            return;
        }

        const enabled = this.preferenceService.get('geoApp.ui.tabs.smartReplace.interaction.minOpenTimeEnabled', true) as boolean;
        if (!enabled) {
            return;
        }

        const timeoutSeconds = this.preferenceService.get('geoApp.ui.tabs.smartReplaceTimeout', 30) as number;
        if (!timeoutSeconds || timeoutSeconds <= 0) {
            return;
        }

        this.interactionTimerId = window.setTimeout(() => {
            this.emitInteraction('min-open-time');
        }, timeoutSeconds * 1000);
    }

    private clearMinOpenTimeTimer(): void {
        if (typeof window === 'undefined') {
            return;
        }
        if (this.interactionTimerId !== undefined) {
            window.clearTimeout(this.interactionTimerId);
            this.interactionTimerId = undefined;
        }
    }

    storeState(): object | undefined {
        if (!this.alphabetId) {
            return undefined;
        }
        this.lastAccessTimestamp = Date.now();
        const state: SerializedAlphabetViewerState = {
            alphabetId: this.alphabetId,
            lastAccessTimestamp: this.lastAccessTimestamp
        };
        return state;
    }

    restoreState(oldState: object): void {
        const state = oldState as Partial<SerializedAlphabetViewerState> | undefined;
        if (!state || typeof state.alphabetId !== 'string') {
            return;
        }
        if (state.lastAccessTimestamp && typeof state.lastAccessTimestamp === 'number') {
            this.lastAccessTimestamp = state.lastAccessTimestamp;
        }
        this.setAlphabet(state.alphabetId);
    }

    private formatGeocachingCoordinates(lat: number, lon: number): string {
        const latDir = lat >= 0 ? 'N' : 'S';
        const lonDir = lon >= 0 ? 'E' : 'W';

        const absLat = Math.abs(lat);
        const absLon = Math.abs(lon);

        const latDeg = Math.floor(absLat);
        const lonDeg = Math.floor(absLon);

        const latMin = (absLat - latDeg) * 60;
        const lonMin = (absLon - lonDeg) * 60;

        return `${latDir} ${latDeg.toString().padStart(2, '0')}° ${latMin.toFixed(3)} ${lonDir} ${lonDeg.toString().padStart(3, '0')}° ${lonMin.toFixed(3)}`;
    }

    private async initializeAsync(): Promise<void> {
        try {
            await this.loadAlphabet();
            console.log('AlphabetViewerWidget: loadAlphabet completed');
        } catch (error) {
            console.error('AlphabetViewerWidget: Error during async initialization:', error);
        }
    }

    /**
     * Charge l'alphabet depuis le backend.
     */
    private async loadAlphabet(): Promise<void> {
        console.log('AlphabetViewerWidget: loadAlphabet started for:', this.alphabetId);
        try {
            this.loading = true;
            this.update();
            console.log('AlphabetViewerWidget: Set loading=true and updated');
            
            this.alphabet = await this.alphabetsService.getAlphabet(this.alphabetId);
            console.log('AlphabetViewerWidget: Alphabet loaded:', this.alphabet);
            this.title.label = this.alphabet.name;
            this.title.caption = this.alphabet.description;
            console.log('AlphabetViewerWidget: Title set to:', this.alphabet.name);
            
            // Si alphabet basé sur police, charger la police
            if (this.alphabet.alphabetConfig.type === 'font') {
                console.log('AlphabetViewerWidget: Loading font...');
                await this.loadFont();
            } else {
                console.log('AlphabetViewerWidget: No font to load (images type)');
                this.fontLoaded = true;
            }
            
            this.loading = false;
            this.update();
            console.log('AlphabetViewerWidget: Loading complete, updated widget');
            this.setupMinOpenTimeTimer();
        } catch (error) {
            console.error('AlphabetViewerWidget: Error loading alphabet:', error);
            this.messageService.error(`Erreur lors du chargement de l'alphabet ${this.alphabetId}`);
            this.loading = false;
            this.update();
        }
    }

    public setAlphabet(alphabetId: string): void {
        console.log('AlphabetViewerWidget: setAlphabet called with:', alphabetId);
        this.alphabetId = alphabetId;
        this.lastAccessTimestamp = Date.now();
        this.alphabet = null;
        this.enteredChars = [];
        this.history = [];
        this.historyIndex = -1;
        this.detectedCoordinates = null;
        this.associatedGeocache = undefined;
        this.distance = undefined;
        this.hasActiveCoordinateHighlight = false;
        this.lastOpenedGeocacheCode = undefined;
        this.loadZoomState();
        void this.loadAlphabet();
    }

    /**
     * Charge la police d'un alphabet basé sur police.
     */
    private async loadFont(): Promise<void> {
        if (!this.alphabet || this.alphabet.alphabetConfig.type !== 'font') {
            return;
        }

        const fontUrl = this.alphabetsService.getFontUrl(this.alphabetId);
        const fontName = `Alphabet-${this.alphabetId}`;

        // Créer un élément style pour @font-face
        const styleId = `font-style-${this.alphabetId}`;
        let styleElement = document.getElementById(styleId) as HTMLStyleElement;
        
        if (!styleElement) {
            styleElement = document.createElement('style');
            styleElement.id = styleId;
            document.head.appendChild(styleElement);
        }

        styleElement.textContent = `
            @font-face {
                font-family: "${fontName}";
                src: url("${fontUrl}") format("truetype");
                font-display: block;
            }
        `;

        // Attendre le chargement de la police
        try {
            const font = new FontFace(fontName, `url(${fontUrl})`);
            await font.load();
            document.fonts.add(font);
            this.fontLoaded = true;
            this.update();
        } catch (error) {
            console.error('Error loading font:', error);
            this.messageService.warn('Impossible de charger la police, affichage en texte brut');
            this.fontLoaded = true; // Continuer quand même
            this.update();
        }
    }

    /**
     * Charge l'état du zoom depuis localStorage.
     */
    private loadZoomState(): void {
        const saved = localStorage.getItem(`alphabet_${this.alphabetId}_zoom`);
        if (saved) {
            try {
                const loaded = JSON.parse(saved);
                // Appliquer les nouvelles limites
                this.zoomState = {
                    enteredSymbols: Math.max(0.25, Math.min(1.5, loaded.enteredSymbols || 0.75)),
                    decodedText: Math.max(0.5, Math.min(2.0, loaded.decodedText || 1)),
                    availableSymbols: Math.max(0.5, Math.min(2.0, loaded.availableSymbols || 1)),
                    pinnedSymbols: Math.max(0.25, Math.min(1.5, loaded.pinnedSymbols || 1)),
                    pinnedText: Math.max(0.5, Math.min(2.0, loaded.pinnedText || 1)),
                    pinnedCoordinates: Math.max(0.5, Math.min(2.0, loaded.pinnedCoordinates || 1))
                };
            } catch (e) {
                console.error('Error loading zoom state:', e);
            }
        }
    }

    /**
     * Sauvegarde l'état du zoom dans localStorage.
     */
    private saveZoomState(): void {
        localStorage.setItem(`alphabet_${this.alphabetId}_zoom`, JSON.stringify(this.zoomState));
    }

    /**
     * Ajuste le zoom d'une section.
     */
    private adjustZoom(section: keyof ZoomState, delta: number): void {
        const newZoom = this.zoomState[section] + delta;

        // Limites différentes selon la section
        let minZoom = 0.5;
        let maxZoom = 2.0;

        if (section === 'enteredSymbols' || section === 'pinnedSymbols') {
            minZoom = 0.25;
            maxZoom = 1.5;
        }

        if (newZoom >= minZoom && newZoom <= maxZoom) {
            this.zoomState[section] = newZoom;
            this.saveZoomState();
            this.update();
        }
    }

    /**
     * Ajoute un symbole aux symboles entrés.
     */
    private addSymbol(char: string): void {
        this.enteredChars.push(char);
        this.saveState();
        this.update();
    }

    /**
     * Supprime le dernier symbole.
     */
    public deleteLastSymbol(): void {
        if (this.enteredChars.length > 0) {
            this.enteredChars.pop();
            this.saveState();
            this.update();
        }
    }

    /**
     * Efface tous les symboles.
     */
    private clearSymbols(): void {
        this.enteredChars = [];
        this.saveState();
        this.update();
    }

    /**
     * Obtient le texte décodé à partir des symboles entrés.
     */
    private getDecodedText(): string {
        return this.enteredChars.join('');
    }

    // =================== Gestion du drag & drop ===================

    /**
     * Début du drag d'un symbole.
     */
    private handleDragStart = (index: number): void => {
        this.draggedIndex = index;
    };

    /**
     * Survol d'un symbole pendant le drag.
     */
    private handleDragOver = (index: number): void => {
        if (this.draggedIndex !== null && this.draggedIndex !== index) {
            // Réorganiser les symboles
            const newChars = [...this.enteredChars];
            const [draggedChar] = newChars.splice(this.draggedIndex, 1);
            newChars.splice(index, 0, draggedChar);
            
            this.enteredChars = newChars;
            this.draggedIndex = index;
            this.update();
        }
    };

    /**
     * Fin du drag.
     */
    private handleDragEnd = (): void => {
        if (this.draggedIndex !== null) {
            this.saveState();
        }
        this.draggedIndex = null;
        this.dragOverIndex = null;
        this.update();
    };

    // =================== Gestion du menu contextuel ===================

    /**
     * Affiche le menu contextuel pour un symbole.
     */
    private handleContextMenu = (e: React.MouseEvent, index: number): void => {
        e.preventDefault();
        this.contextMenu = {
            visible: true,
            x: e.clientX,
            y: e.clientY,
            symbolIndex: index
        };
        this.update();
    };

    /**
     * Ferme le menu contextuel.
     */
    private closeContextMenu = (): void => {
        this.contextMenu = null;
        this.update();
    };

    /**
     * Supprime un symbole à l'index donné.
     */
    private deleteSymbol = (index: number): void => {
        this.enteredChars.splice(index, 1);
        this.saveState();
        this.update();
    };

    /**
     * Duplique un symbole à l'index donné.
     */
    private duplicateSymbol = (index: number): void => {
        const char = this.enteredChars[index];
        this.enteredChars.splice(index + 1, 0, char);
        this.saveState();
        this.update();
    };

    /**
     * Insère un espace avant le symbole à l'index donné.
     */
    private insertBefore = (index: number): void => {
        this.enteredChars.splice(index, 0, ' ');
        this.saveState();
        this.update();
    };

    /**
     * Insère un espace après le symbole à l'index donné.
     */
    private insertAfter = (index: number): void => {
        this.enteredChars.splice(index + 1, 0, ' ');
        this.saveState();
        this.update();
    };

    // =================== Historique (Undo/Redo) ===================

    /**
     * Sauvegarde l'état actuel dans l'historique.
     */
    private saveState(): void {
        // Supprimer tout l'historique après l'index actuel
        this.history = this.history.slice(0, this.historyIndex + 1);
        
        // Ajouter le nouvel état
        this.history.push([...this.enteredChars]);
        
        // Limiter la taille de l'historique
        if (this.history.length > this.maxHistorySize) {
            this.history.shift();
        } else {
            this.historyIndex++;
        }
    }

    /**
     * Annule la dernière action (Undo).
     */
    private undo(): void {
        if (this.historyIndex > 0) {
            this.historyIndex--;
            this.enteredChars = [...this.history[this.historyIndex]];
            this.update();
            this.messageService.info(`Annulation (${this.history.length - this.historyIndex - 1} à refaire)`);
        } else {
            this.messageService.info('Rien à annuler');
        }
    }

    /**
     * Refait la dernière action annulée (Redo).
     */
    private redo(): void {
        if (this.historyIndex < this.history.length - 1) {
            this.historyIndex++;
            this.enteredChars = [...this.history[this.historyIndex]];
            this.update();
            this.messageService.info(`Rétablissement (${this.historyIndex + 1}/${this.history.length})`);
        } else {
            this.messageService.info('Rien à refaire');
        }
    }

    // =================== Export/Import ===================

    /**
     * Exporte l'état actuel (symboles, zoom, épinglage).
     */
    private exportState(): void {
        const state = {
            alphabetId: this.alphabetId,
            enteredChars: this.enteredChars,
            zoomState: this.zoomState,
            pinnedState: this.pinnedState,
            associatedGeocache: this.associatedGeocache,
            timestamp: new Date().toISOString()
        };

        const json = JSON.stringify(state, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = `alphabet-${this.alphabetId}-${Date.now()}.json`;
        a.click();
        
        URL.revokeObjectURL(url);
        this.messageService.info('État exporté avec succès');
    }

    /**
     * Importe un état depuis un fichier JSON.
     */
    private importState(): void {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'application/json';
        
        input.onchange = async (e: Event) => {
            const file = (e.target as HTMLInputElement).files?.[0];
            if (!file) return;
            
            try {
                const text = await file.text();
                const state = JSON.parse(text);
                
                // Valider que c'est le bon alphabet
                if (state.alphabetId !== this.alphabetId) {
                    this.messageService.warn(
                        `Cet export est pour l'alphabet "${state.alphabetId}", pas "${this.alphabetId}"`
                    );
                    return;
                }
                
                // Restaurer l'état
                this.enteredChars = state.enteredChars || [];
                this.zoomState = { ...this.zoomState, ...state.zoomState };
                this.pinnedState = { ...this.pinnedState, ...state.pinnedState };
                this.associatedGeocache = state.associatedGeocache;
                
                this.saveState();
                this.saveZoomState();
                this.update();
                
                this.messageService.info('État importé avec succès');
            } catch (error) {
                this.messageService.error(`Erreur lors de l'import: ${error}`);
            }
        };
        
        input.click();
    };

    // =================== Épinglage ===================

    /**
     * Bascule l'état d'épinglage pour une section.
     */
    private togglePin = (section: 'symbols' | 'text' | 'coordinates'): void => {
        this.pinnedState[section] = !this.pinnedState[section];
        this.update();
        
        const status = this.pinnedState[section] ? 'épinglée' : 'désépinglée';
        this.messageService.info(`Section ${section} ${status}`);
    };

    /**
     * Rendu du widget.
     */
    protected render(): React.ReactNode {
        if (this.loading) {
            return this.renderLoading();
        }

        if (!this.alphabet) {
            return this.renderError();
        }

        return (
            <div className='alphabet-viewer-container' style={{
                height: '100%',
                overflow: 'auto',
                backgroundColor: 'var(--theia-editor-background)',
                color: 'var(--theia-editor-foreground)',
                position: 'relative'
            }}>
                {this.renderHeader()}
                {this.renderToolbar()}
                {this.renderGeocacheAssociation()}
                
                {/* Zone épinglée */}
                {(this.pinnedState.symbols || this.pinnedState.text || this.pinnedState.coordinates) && (
                    <div className='pinned-area' style={{
                        position: 'sticky',
                        top: 0,
                        zIndex: 100,
                        backgroundColor: 'var(--theia-sideBar-background)',
                        borderBottom: '2px solid var(--theia-sideBar-border)',
                        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.15)',
                        marginBottom: '16px'
                    }}>
                        {this.pinnedState.symbols && this.renderEnteredSymbols(true)}
                        {this.pinnedState.text && this.renderDecodedText(true)}
                        {this.pinnedState.coordinates && this.renderCoordinatesDetector(true)}
                    </div>
                )}
                
                {/* Contenu normal */}
                {!this.pinnedState.symbols && this.renderEnteredSymbols(false)}
                {!this.pinnedState.text && this.renderDecodedText(false)}
                {!this.pinnedState.coordinates && this.renderCoordinatesDetector(false)}
                {this.renderAvailableSymbols()}
                {this.renderSources()}
            </div>
        );
    }

    /**
     * Rendu de la barre d'outils.
     */
    private renderToolbar(): React.ReactNode {
        const canUndo = this.historyIndex > 0;
        const canRedo = this.historyIndex < this.history.length - 1;

        return (
            <div style={{
                padding: '12px 16px',
                backgroundColor: 'var(--theia-toolbar-background)',
                borderBottom: '1px solid var(--theia-panel-border)',
                display: 'flex',
                gap: '8px',
                alignItems: 'center',
                flexWrap: 'wrap'
            }}>
                <div style={{ display: 'flex', gap: '4px' }}>
                    <button
                        onClick={() => this.undo()}
                        disabled={!canUndo}
                        title='Annuler (Ctrl+Z)'
                        style={{
                            padding: '6px 12px',
                            backgroundColor: 'var(--theia-button-background)',
                            color: 'var(--theia-button-foreground)',
                            border: 'none',
                            borderRadius: '3px',
                            cursor: canUndo ? 'pointer' : 'not-allowed',
                            opacity: canUndo ? 1 : 0.5
                        }}
                    >
                        <i className='fa fa-undo'></i>
                    </button>
                    <button
                        onClick={() => this.redo()}
                        disabled={!canRedo}
                        title='Refaire (Ctrl+Y)'
                        style={{
                            padding: '6px 12px',
                            backgroundColor: 'var(--theia-button-background)',
                            color: 'var(--theia-button-foreground)',
                            border: 'none',
                            borderRadius: '3px',
                            cursor: canRedo ? 'pointer' : 'not-allowed',
                            opacity: canRedo ? 1 : 0.5
                        }}
                    >
                        <i className='fa fa-redo'></i>
                    </button>
                </div>

                <div style={{ width: '1px', height: '24px', backgroundColor: 'var(--theia-panel-border)' }}></div>

                <button
                    onClick={() => this.exportState()}
                    title='Exporter (Ctrl+E)'
                    style={{
                        padding: '6px 12px',
                        backgroundColor: 'var(--theia-button-background)',
                        color: 'var(--theia-button-foreground)',
                        border: 'none',
                        borderRadius: '3px',
                        cursor: 'pointer'
                    }}
                >
                    <i className='fa fa-download'></i> Exporter
                </button>

                <button
                    onClick={() => this.importState()}
                    title='Importer (Ctrl+I)'
                    style={{
                        padding: '6px 12px',
                        backgroundColor: 'var(--theia-button-background)',
                        color: 'var(--theia-button-foreground)',
                        border: 'none',
                        borderRadius: '3px',
                        cursor: 'pointer'
                    }}
                >
                    <i className='fa fa-upload'></i> Importer
                </button>

                {this.history.length > 0 && (
                    <span style={{
                        marginLeft: 'auto',
                        fontSize: '12px',
                        color: 'var(--theia-descriptionForeground)'
                    }}>
                        {this.historyIndex + 1} / {this.history.length}
                    </span>
                )}
            </div>
        );
    }

    /**
     * Rendu du chargement.
     */
    private renderLoading(): React.ReactNode {
        return (
            <div style={{
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                height: '100%',
                color: 'var(--theia-descriptionForeground)'
            }}>
                <i className='fa fa-spinner fa-spin' style={{ marginRight: '8px', fontSize: '24px' }}></i>
                <span>Chargement de l'alphabet...</span>
            </div>
        );
    }

    /**
     * Rendu de l'erreur.
     */
    private renderError(): React.ReactNode {
        return (
            <div style={{
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
                alignItems: 'center',
                height: '100%',
                color: 'var(--theia-errorForeground)',
                padding: '20px'
            }}>
                <i className='fa fa-exclamation-triangle' style={{ fontSize: '48px', marginBottom: '16px' }}></i>
                <h3>Erreur de chargement</h3>
                <p>Impossible de charger l'alphabet "{this.alphabetId}"</p>
            </div>
        );
    }

    /**
     * Gestionnaire pour afficher la géocache sur la carte.
     */
    private handleShowMap = async (geocache: AssociatedGeocache): Promise<void> => {
        try {
            console.log('[AlphabetViewerWidget] Ouverture carte pour géocache:', geocache.code);
            this.lastOpenedGeocacheCode = geocache.code;

            // Convertir les données AssociatedGeocache vers le format attendu par l'événement
            const geocacheData = {
                id: geocache.databaseId || geocache.id,
                gc_code: geocache.code,
                name: geocache.name,
                latitude: this.parseCoordinates(geocache.gc_lat || ''),
                longitude: this.parseCoordinates(geocache.gc_lon || ''),
                cache_type: 'Unknown', // On ne l'a pas dans AssociatedGeocache
                difficulty: undefined,
                terrain: undefined,
                found: false,
                is_corrected: false,
                original_latitude: undefined,
                original_longitude: undefined,
                waypoints: []
            };

            console.log('[AlphabetViewerWidget] Données géocache préparées:', geocacheData);

            // Approche alternative : utiliser window.postMessage pour communiquer entre extensions
            console.log('[AlphabetViewerWidget] Utilisation de window.postMessage pour communiquer avec l\'extension zones');

            window.postMessage({
                type: 'open-geocache-map',
                geocache: geocacheData,
                source: 'alphabets-extension'
            }, '*');

            // Fallback : événement avec délai plus long
            console.log('[AlphabetViewerWidget] Fallback vers événement avec délai de 2 secondes');

            setTimeout(() => {
                console.log('[AlphabetViewerWidget] Dispatch de l\'événement open-geocache-map (fallback)');
                const event = new CustomEvent('open-geocache-map', {
                    detail: { geocache: geocacheData },
                    bubbles: true,
                    cancelable: true
                });

                // Essayer sur tous les contextes possibles
                let result = false;
                result = result || document.dispatchEvent(event);
                result = result || window.dispatchEvent(event);

                // Essayer aussi sur le document body et html
                if (document.body) {
                    result = result || document.body.dispatchEvent(event);
                }
                if (document.documentElement) {
                    result = result || document.documentElement.dispatchEvent(event);
                }

                console.log('[AlphabetViewerWidget] Événement dispatché sur tous les contextes, result:', result);
            }, 2000); // Délai plus long

            this.messageService.info(`Ouverture de la carte pour ${geocache.code}...`);
        } catch (error) {
            console.error('[AlphabetViewerWidget] Erreur lors de l\'ouverture de la carte:', error);
            this.messageService.error('Erreur lors de l\'ouverture de la carte');
        }
    };

    /**
     * Parse les coordonnées du format Geocaching (ex: "N 48° 35.220") vers décimal.
     */
    private parseCoordinates(coordStr: string): number | undefined {
        if (!coordStr || coordStr.trim() === '') return undefined;

        try {
            // Format: "N 48° 35.220" ou "E 006° 29.770"
            const parts = coordStr.trim().split(/\s+/);
            if (parts.length < 3) return undefined;

            const direction = parts[0].toUpperCase();
            const degrees = parseInt(parts[1].replace('°', ''));
            const minutes = parseFloat(parts[2]);

            let decimal = degrees + (minutes / 60);

            // Ajuster selon la direction
            if (direction === 'S' || direction === 'W') {
                decimal = -decimal;
            }

            return decimal;
        } catch (error) {
            console.warn('[AlphabetViewerWidget] Erreur parsing coordonnées:', coordStr, error);
            return undefined;
        }
    }

    /**
     * Rendu de l'association de géocache.
     */
    private renderGeocacheAssociation(): React.ReactNode {
        return (
            <div style={{ padding: '16px' }}>
                <GeocacheAssociation
                    associatedGeocache={this.associatedGeocache}
                    onAssociate={(geocache) => {
                        this.associatedGeocache = geocache;
                        this.lastOpenedGeocacheCode = geocache.code;
                        this.update();
                        this.messageService.info(`Géocache ${geocache.code} associée`);
                        if (this.detectedCoordinates) {
                            this.highlightDetectedCoordinateOnMap(this.detectedCoordinates);
                        }
                    }}
                    onClear={() => {
                        this.associatedGeocache = undefined;
                        this.distance = undefined;
                         this.lastOpenedGeocacheCode = undefined;
                         this.clearDetectedCoordinateHighlight();
                        if (this.detectedCoordinates) {
                            this.highlightDetectedCoordinateOnMap(this.detectedCoordinates);
                        }
                        this.update();
                        this.messageService.info('Association supprimée');
                    }}
                    onShowMap={this.handleShowMap}
                    distanceInfo={this.distance}
                />
            </div>
        );
    }

    /**
     * Rendu de l'en-tête.
     */
    private renderHeader(): React.ReactNode {
        if (!this.alphabet) return null;

        return (
            <div style={{
                padding: '16px',
                borderBottom: '1px solid var(--theia-panel-border)',
                backgroundColor: 'var(--theia-sideBar-background)'
            }}>
                <h2 style={{ margin: '0 0 8px 0', fontSize: '20px' }}>{this.alphabet.name}</h2>
                <p style={{ margin: '0', color: 'var(--theia-descriptionForeground)', fontSize: '13px' }}>
                    {this.alphabet.description}
                </p>
                {this.alphabet.tags && this.alphabet.tags.length > 0 && (
                    <div style={{ marginTop: '8px' }}>
                        {this.alphabet.tags.map(tag => (
                            <span key={tag} style={{
                                display: 'inline-block',
                                marginRight: '6px',
                                padding: '2px 8px',
                                fontSize: '11px',
                                backgroundColor: 'var(--theia-badge-background)',
                                color: 'var(--theia-badge-foreground)',
                                borderRadius: '3px'
                            }}>
                                {tag}
                            </span>
                        ))}
                    </div>
                )}
            </div>
        );
    }

    /**
     * Rendu des symboles entrés.
     */
    private renderEnteredSymbols(isPinned: boolean): React.ReactNode {
        const scale = isPinned ? this.zoomState.pinnedSymbols : this.zoomState.enteredSymbols;
        const fontName = this.alphabet?.alphabetConfig?.type === 'font' 
            ? `Alphabet-${this.alphabetId}` 
            : undefined;

        return (
            <div style={{ padding: '16px' }}>
                <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '12px'
                }}>
                    <h3 style={{ margin: 0, fontSize: '16px' }}>
                        Symboles entrés {isPinned && <i className='fa fa-thumbtack' style={{ marginLeft: '8px', fontSize: '12px' }}></i>}
                    </h3>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        <div className='zoom-controls'>
                            <button
                                onClick={() => this.adjustZoom(isPinned ? 'pinnedSymbols' : 'enteredSymbols', -0.25)}
                                disabled={scale <= 0.25}
                                title='Diminuer'
                            >
                                <i className='fa fa-minus'></i>
                            </button>
                            <span style={{ fontSize: '11px', padding: '0 8px' }}>{Math.round(scale * 100)}%</span>
                            <button
                                onClick={() => this.adjustZoom(isPinned ? 'pinnedSymbols' : 'enteredSymbols', 0.25)}
                                disabled={scale >= 1.5}
                                title='Augmenter'
                            >
                                <i className='fa fa-plus'></i>
                            </button>
                        </div>
                        <button
                            onClick={() => this.togglePin('symbols')}
                            title={this.pinnedState.symbols ? 'Désépingler les symboles' : 'Épingler les symboles'}
                            style={{
                                padding: '4px 8px',
                                backgroundColor: this.pinnedState.symbols
                                    ? 'var(--theia-button-hoverBackground)'
                                    : 'var(--theia-button-background)',
                                color: 'var(--theia-button-foreground)',
                                border: 'none',
                                borderRadius: '3px',
                                cursor: 'pointer'
                            }}
                        >
                            📌
                        </button>
                        <button
                            onClick={() => this.clearSymbols()}
                            title='Tout effacer'
                            style={{
                                padding: '4px 8px',
                                backgroundColor: 'var(--theia-button-background)',
                                color: 'var(--theia-button-foreground)',
                                border: 'none',
                                borderRadius: '3px',
                                cursor: 'pointer'
                            }}
                        >
                            <i className='fa fa-trash'></i> Effacer
                        </button>
                    </div>
                </div>
                <div style={{
                    minHeight: '30px',
                    padding: '0px',
                    backgroundColor: 'var(--theia-input-background)',
                    border: '1px solid var(--theia-input-border)',
                    borderRadius: '4px',
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: '-1px',
                    alignItems: 'center'
                }}>
                    {this.enteredChars.length === 0 ? (
                        <span style={{ color: 'var(--theia-descriptionForeground)', fontSize: '13px', padding: '8px' }}>
                            Cliquez sur les symboles ci-dessous pour commencer...
                        </span>
                    ) : (
                        this.enteredChars.map((char, idx) => (
                            <SymbolItem
                                key={`entered-${idx}`}
                                char={char}
                                index={idx}
                                scale={scale}
                                fontFamily={fontName}
                                isDraggable={true}
                                showIndex={false}
                                compact={true}
                                onDragStart={this.handleDragStart}
                                onDragOver={this.handleDragOver}
                                onDragEnd={this.handleDragEnd}
                                onContextMenu={this.handleContextMenu}
                            />
                        ))
                    )}
                </div>
                {this.contextMenu && (
                    <SymbolContextMenu
                        x={this.contextMenu.x}
                        y={this.contextMenu.y}
                        symbolChar={this.enteredChars[this.contextMenu.symbolIndex]}
                        symbolIndex={this.contextMenu.symbolIndex}
                        onDelete={() => this.deleteSymbol(this.contextMenu!.symbolIndex)}
                        onDuplicate={() => this.duplicateSymbol(this.contextMenu!.symbolIndex)}
                        onClose={this.closeContextMenu}
                    />
                )}
            </div>
        );
    }

    /**
     * Rendu du texte décodé.
     */
    private renderDecodedText(isPinned: boolean): React.ReactNode {
        const scale = isPinned ? this.zoomState.pinnedText : this.zoomState.decodedText;
        const decodedText = this.getDecodedText();

        return (
            <div style={{ padding: '16px' }}>
                <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '12px'
                }}>
                    <h3 style={{ margin: 0, fontSize: '16px' }}>
                        Texte décodé {isPinned && <i className='fa fa-thumbtack' style={{ marginLeft: '8px', fontSize: '12px' }}></i>}
                    </h3>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        <div className='zoom-controls'>
                            <button
                                onClick={() => this.adjustZoom(isPinned ? 'pinnedText' : 'decodedText', -0.25)}
                                disabled={scale <= 0.5}
                                title='Diminuer'
                            >
                                <i className='fa fa-minus'></i>
                            </button>
                            <span style={{ fontSize: '11px', padding: '0 8px' }}>{Math.round(scale * 100)}%</span>
                            <button
                                onClick={() => this.adjustZoom(isPinned ? 'pinnedText' : 'decodedText', 0.25)}
                                disabled={scale >= 2.0}
                                title='Augmenter'
                            >
                                <i className='fa fa-plus'></i>
                            </button>
                        </div>
                        <button
                            onClick={() => this.togglePin('text')}
                            title={this.pinnedState.text ? 'Désépingler le texte' : 'Épingler le texte'}
                            style={{
                                padding: '4px 8px',
                                backgroundColor: this.pinnedState.text
                                    ? 'var(--theia-button-hoverBackground)'
                                    : 'var(--theia-button-background)',
                                color: 'var(--theia-button-foreground)',
                                border: 'none',
                                borderRadius: '3px',
                                cursor: 'pointer'
                            }}
                        >
                            📌
                        </button>
                    </div>
                </div>
                <textarea
                    value={decodedText}
                    onChange={e => {
                        // Synchroniser le textarea avec le tableau des caractères
                        this.enteredChars = e.target.value.split('');
                        this.saveState();
                        this.update();
                    }}
                    onKeyDown={(e) => {
                        // Sauvegarder l'état pour undo/redo lors de modifications
                        if (e.key.length === 1 || e.key === 'Backspace' || e.key === 'Delete') {
                            // Délayer la sauvegarde pour permettre au onChange de se déclencher d'abord
                            setTimeout(() => this.saveState(), 0);
                        }
                    }}
                    placeholder='Le texte décodé apparaîtra ici...'
                    style={{
                        width: '100%',
                        minHeight: '100px',
                        padding: '12px',
                        fontSize: `${14 * scale}px`,
                        backgroundColor: 'var(--theia-input-background)',
                        color: 'var(--theia-input-foreground)',
                        border: '1px solid var(--theia-input-border)',
                        borderRadius: '4px',
                        fontFamily: 'monospace',
                        resize: 'vertical'
                    }}
                />
            </div>
        );
    }

    /**
     * Rendu du détecteur de coordonnées.
     */
    private renderCoordinatesDetector(isPinned: boolean): React.ReactNode {
        const decodedText = this.getDecodedText();
        
        // Obtenir les coordonnées d'origine depuis la géocache associée
        const originCoords = this.associatedGeocache ? {
            ddm_lat: this.associatedGeocache.gc_lat || '',
            ddm_lon: this.associatedGeocache.gc_lon || ''
        } : undefined;

        return (
            <div style={{ padding: '0 16px' }}>
                <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '12px'
                }}>
                    <h3 style={{ margin: 0, fontSize: '16px' }}>
                        Détecteur de coordonnées {isPinned && <i className='fa fa-thumbtack' style={{ marginLeft: '8px', fontSize: '12px' }}></i>}
                    </h3>
                    <button
                        onClick={() => this.togglePin('coordinates')}
                        title={this.pinnedState.coordinates ? 'Désépingler les coordonnées' : 'Épingler les coordonnées'}
                        style={{
                            padding: '4px 8px',
                            backgroundColor: this.pinnedState.coordinates
                                ? 'var(--theia-button-hoverBackground)'
                                : 'var(--theia-button-background)',
                            color: 'var(--theia-button-foreground)',
                            border: 'none',
                            borderRadius: '3px',
                            cursor: 'pointer'
                        }}
                    >
                        📌
                    </button>
                </div>
                <CoordinatesDetector
                    text={decodedText}
                    alphabetsService={this.alphabetsService}
                    originCoords={originCoords}
                    associatedGeocache={this.associatedGeocache}
                    onDistanceCalculated={(dist) => {
                        this.distance = dist;
                        this.update();
                    }}
                    onCoordinatesDetected={this.handleCoordinatesDetected}
                />
                {this.renderWaypointActions()}
            </div>
        );
    }

    private handleCoordinatesDetected = (coordinates: DetectedCoordinates | null): void => {
        const normalized = coordinates && coordinates.exist ? coordinates : null;
        if (!this.haveDetectedCoordinatesChanged(normalized)) {
            return;
        }

        this.detectedCoordinates = normalized;
        this.update();

        if (normalized) {
            this.highlightDetectedCoordinateOnMap(normalized);
        } else {
            this.clearDetectedCoordinateHighlight();
        }
    };

    private haveDetectedCoordinatesChanged(newCoords: DetectedCoordinates | null): boolean {
        if (!this.detectedCoordinates && !newCoords) {
            return false;
        }
        if (!this.detectedCoordinates || !newCoords) {
            return true;
        }

        return (
            this.detectedCoordinates.ddm !== newCoords.ddm ||
            this.detectedCoordinates.ddm_lat !== newCoords.ddm_lat ||
            this.detectedCoordinates.ddm_lon !== newCoords.ddm_lon ||
            this.detectedCoordinates.decimal_latitude !== newCoords.decimal_latitude ||
            this.detectedCoordinates.decimal_longitude !== newCoords.decimal_longitude
        );
    }

    private renderWaypointActions(): React.ReactNode {
        const coords = this.detectedCoordinates;

        if (!coords || !coords.exist) {
            if (this.associatedGeocache) {
                return null;
            }

            if (this.getDecodedText().trim().length === 0) {
                return null;
            }

            return (
                <div style={{
                    marginTop: '12px',
                    padding: '12px',
                    backgroundColor: 'var(--theia-editor-background)',
                    border: '1px dashed var(--theia-panel-border)',
                    borderRadius: '4px',
                    fontSize: '12px',
                    color: 'var(--theia-descriptionForeground)'
                }}>
                    Associez une géocache pour transformer les coordonnées détectées en waypoint.
                </div>
            );
        }

        if (!this.associatedGeocache) {
            return (
                <div style={{
                    marginTop: '12px',
                    padding: '12px',
                    backgroundColor: 'var(--theia-editor-background)',
                    border: '1px solid var(--theia-panel-border)',
                    borderRadius: '4px',
                    fontSize: '12px'
                }}>
                    <div style={{ fontWeight: 'bold', marginBottom: '6px' }}>
                        Coordonnées prêtes
                    </div>
                    <div style={{ fontFamily: 'monospace', marginBottom: '8px' }}>
                        {this.formatDetectedDdm(coords)}
                    </div>
                    <div style={{ color: 'var(--theia-descriptionForeground)' }}>
                        Associez une géocache pour pouvoir créer un waypoint automatiquement.
                    </div>
                </div>
            );
        }

        const ddmDisplay = this.formatDetectedDdm(coords);

        return (
            <div style={{
                marginTop: '16px',
                padding: '16px',
                backgroundColor: 'var(--theia-editor-background)',
                border: '1px solid var(--theia-panel-border)',
                borderRadius: '6px'
            }}>
                <div style={{ fontWeight: 'bold', marginBottom: '8px', fontSize: '14px' }}>
                    Waypoints pour {this.associatedGeocache.code} · {this.associatedGeocache.name}
                </div>
                <div style={{
                    fontFamily: 'monospace',
                    backgroundColor: 'var(--theia-input-background)',
                    borderRadius: '4px',
                    padding: '10px',
                    fontSize: '13px',
                    marginBottom: '10px'
                }}>
                    {ddmDisplay}
                </div>
                {this.distance && (
                    <div style={{
                        fontSize: '12px',
                        color: 'var(--theia-descriptionForeground)',
                        marginBottom: '12px'
                    }}>
                        Distance estimée: {Math.round(this.distance.meters)} m ({this.distance.status})
                    </div>
                )}
                <div style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: '10px'
                }}>
                    <button
                        style={{
                            flex: '1 1 200px',
                            padding: '10px 14px',
                            backgroundColor: 'var(--theia-button-background)',
                            color: 'var(--theia-button-foreground)',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            fontSize: '13px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '6px'
                        }}
                        onClick={() => this.createWaypointFromDetectedCoordinates(false)}
                    >
                        <span className='codicon codicon-add'></span>
                        Créer waypoint
                    </button>
                    <button
                        style={{
                            flex: '1 1 200px',
                            padding: '10px 14px',
                            backgroundColor: 'var(--theia-button-background)',
                            color: 'var(--theia-button-foreground)',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            fontSize: '13px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '6px'
                        }}
                        onClick={() => this.createWaypointFromDetectedCoordinates(true)}
                    >
                        <span className='codicon codicon-pass-filled'></span>
                        Ajouter & valider
                    </button>
                </div>
            </div>
        );
    }

    private highlightDetectedCoordinateOnMap(coords: DetectedCoordinates): void {
        if (typeof window === 'undefined') {
            return;
        }

        const lat = this.getDecimalLatitudeFromDetection(coords);
        const lon = this.getDecimalLongitudeFromDetection(coords);

        if (lat === undefined || lon === undefined) {
            console.warn('[AlphabetViewerWidget] Coordonnées détectées invalides, impossible de les afficher sur la carte', coords);
            this.hasActiveCoordinateHighlight = false;
            return;
        }

        if (this.associatedGeocache) {
            this.ensureGeocacheMapOpen(this.associatedGeocache);
        } else {
            this.ensureGeneralMapOpen();
        }

        const ddmDisplay = this.formatDetectedDdm(coords);
        const decimalDisplay = `${lat.toFixed(6)}, ${lon.toFixed(6)}`;
        const note = this.buildDetectedWaypointNote(coords, ddmDisplay, decimalDisplay);

        console.log('[AlphabetViewerWidget] Highlight des coordonnées détectées sur la carte', {
            lat,
            lon,
            gc: this.associatedGeocache?.code || 'general'
        });

        try {
            window.dispatchEvent(new CustomEvent('geoapp-map-highlight-coordinate', {
                detail: {
                    gcCode: this.associatedGeocache?.code,
                    pluginName: 'Alphabet Viewer',
                    coordinates: {
                        latitude: lat,
                        longitude: lon,
                        formatted: ddmDisplay
                    },
                    waypointTitle: this.associatedGeocache
                        ? `Coordonnées détectées (${this.associatedGeocache.code})`
                        : 'Coordonnées détectées',
                    waypointNote: note,
                    sourceResultText: ddmDisplay,
                    replaceExisting: true
                }
            }));
            this.hasActiveCoordinateHighlight = true;
        } catch (error) {
            console.error('[AlphabetViewerWidget] Échec de l\'envoi de l\'événement highlight carte', error);
        }
    }

    private ensureGeocacheMapOpen(geocache?: AssociatedGeocache): void {
        if (!geocache) {
            return;
        }

        if (this.lastOpenedGeocacheCode === geocache.code) {
            return;
        }

        console.log('[AlphabetViewerWidget] Ouverture forcée de la carte géocache pour highlight', geocache.code);
        this.lastOpenedGeocacheCode = geocache.code;
        void this.handleShowMap(geocache);
    }

    private ensureGeneralMapOpen(): void {
        console.log('[AlphabetViewerWidget] Demande d\'ouverture de la carte générale');
        this.requestGeneralMapOpen();
    }

    private requestGeneralMapOpen(): void {
        if (typeof window === 'undefined' || typeof document === 'undefined') {
            return;
        }

        try {
            window.postMessage({
                type: 'open-general-map',
                source: 'alphabets-extension'
            }, '*');

            const targets: Array<EventTarget | null | undefined> = [
                document,
                window,
                document.body,
                document.documentElement
            ];

            targets.forEach(target => {
                if (!target) {
                    return;
                }
                const event = new CustomEvent('open-general-map', {
                    detail: { source: 'alphabets-extension' },
                    bubbles: true,
                    cancelable: true
                });
                target.dispatchEvent(event);
            });
        } catch (error) {
            console.error('[AlphabetViewerWidget] Erreur lors de la demande d\'ouverture de la carte générale', error);
        }
    }

    private clearDetectedCoordinateHighlight(): void {
        if (!this.hasActiveCoordinateHighlight || typeof window === 'undefined') {
            this.hasActiveCoordinateHighlight = false;
            return;
        }

        try {
            window.dispatchEvent(new CustomEvent('geoapp-map-highlight-clear'));
        } catch (error) {
            console.error('[AlphabetViewerWidget] Impossible de nettoyer le highlight de la carte', error);
        }
        this.hasActiveCoordinateHighlight = false;
    }

    private createWaypointFromDetectedCoordinates(autoSave: boolean): void {
        if (!this.associatedGeocache) {
            this.messageService.warn('Associez une géocache pour créer un waypoint.');
            return;
        }

        if (!this.detectedCoordinates || !this.detectedCoordinates.exist) {
            this.messageService.warn('Aucune coordonnée détectée à transformer en waypoint.');
            return;
        }

        const lat = this.getDecimalLatitudeFromDetection(this.detectedCoordinates);
        const lon = this.getDecimalLongitudeFromDetection(this.detectedCoordinates);

        if (lat === undefined || lon === undefined) {
            this.messageService.error('Impossible de convertir les coordonnées détectées.');
            return;
        }

        const ddmDisplay = this.formatDetectedDdm(this.detectedCoordinates);
        const decimalDisplay = `${lat.toFixed(6)}, ${lon.toFixed(6)}`;

        const note = this.buildDetectedWaypointNote(this.detectedCoordinates, ddmDisplay, decimalDisplay);

        this.dispatchWaypointCreation({
            coords: {
                latitude: lat,
                longitude: lon,
                ddm: ddmDisplay,
                decimal: decimalDisplay
            },
            note,
            title: 'Coordonnées détectées',
            pluginName: 'Alphabet Viewer',
            autoSave
        });
    }

    private buildDetectedWaypointNote(coords: DetectedCoordinates, ddmDisplay: string, decimalDisplay: string): string {
        const lines: string[] = [
            'Coordonnées détectées via Alphabet Viewer',
            this.alphabet ? `Alphabet: ${this.alphabet.name}` : undefined,
            this.associatedGeocache ? `Geocache: ${this.associatedGeocache.code} - ${this.associatedGeocache.name}` : undefined,
            '',
            'Coordonnées:',
            ddmDisplay,
            `Décimal: ${decimalDisplay}`,
            this.distance ? `Distance estimée: ${Math.round(this.distance.meters)} m (${this.distance.status})` : undefined,
            coords.source ? `Source: ${coords.source}` : undefined
        ].filter((line): line is string => Boolean(line));

        return lines.join('\n');
    }

    private formatDetectedDdm(coords: DetectedCoordinates): string {
        if (coords.ddm && coords.ddm.trim()) {
            return coords.ddm.trim();
        }

        const lat = coords.ddm_lat?.trim() ?? '';
        const lon = coords.ddm_lon?.trim() ?? '';
        const combined = `${lat} ${lon}`.trim();
        return combined || 'Coordonnées indisponibles';
    }

    private getDecimalLatitudeFromDetection(coords: DetectedCoordinates): number | undefined {
        if (typeof coords.decimal_latitude === 'number') {
            return coords.decimal_latitude;
        }
        if (coords.ddm_lat) {
            return this.parseCoordinates(coords.ddm_lat);
        }
        return undefined;
    }

    private getDecimalLongitudeFromDetection(coords: DetectedCoordinates): number | undefined {
        if (typeof coords.decimal_longitude === 'number') {
            return coords.decimal_longitude;
        }
        if (coords.ddm_lon) {
            return this.parseCoordinates(coords.ddm_lon);
        }
        return undefined;
    }

    private dispatchWaypointCreation(options: {
        coords: {
            latitude: number;
            longitude: number;
            ddm?: string;
            decimal?: string;
        };
        note: string;
        title: string;
        pluginName: string;
        autoSave: boolean;
    }): void {
        if (typeof window === 'undefined') {
            return;
        }

        const gcCoords = options.coords.ddm || this.formatGeocachingCoordinates(options.coords.latitude, options.coords.longitude);

        window.dispatchEvent(new CustomEvent('geoapp-plugin-add-waypoint', {
            detail: {
                gcCoords,
                pluginName: options.pluginName,
                geocache: this.associatedGeocache?.code ? { gcCode: this.associatedGeocache.code } : undefined,
                waypointTitle: options.title,
                waypointNote: options.note,
                sourceResultText: options.note,
                decimalLatitude: options.coords.latitude,
                decimalLongitude: options.coords.longitude,
                autoSave: options.autoSave
            }
        }));

        if (options.autoSave) {
            this.messageService.info(`${options.title} validé automatiquement en waypoint`);
        } else {
            this.messageService.info(`${options.title}: formulaire de waypoint ouvert`);
        }
    }

    /**
     * Rendu des symboles disponibles.
     */
    private renderAvailableSymbols(): React.ReactNode {
        if (!this.alphabet || !this.fontLoaded) {
            return null;
        }

        const scale = this.zoomState.availableSymbols;
        const config = this.alphabet.alphabetConfig;
        const showValue = this.preferenceService.get(PREF_AVAILABLE_SYMBOLS_SHOW_VALUE, false) as boolean;

        return (
            <div style={{ padding: '16px' }}>
                <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '12px'
                }}>
                    <h3 style={{ margin: 0, fontSize: '16px' }}>Symboles disponibles</h3>
                    <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                        <label
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '6px',
                                fontSize: '12px',
                                color: 'var(--theia-descriptionForeground)',
                                cursor: 'pointer',
                                userSelect: 'none'
                            }}
                            title='Affiche la valeur (ex: a, b, 1…) sous chaque symbole'
                        >
                            <input
                                type='checkbox'
                                checked={showValue}
                                onChange={e => { void this.setAvailableSymbolsShowValue(e.currentTarget.checked); }}
                            />
                            Afficher la valeur
                        </label>
                        <div className='zoom-controls'>
                            <button
                                onClick={() => this.adjustZoom('availableSymbols', -0.25)}
                                disabled={scale <= 0.5}
                                title='Diminuer'
                            >
                                <i className='fa fa-minus'></i>
                            </button>
                            <span style={{ fontSize: '11px', padding: '0 8px' }}>{Math.round(scale * 100)}%</span>
                            <button
                                onClick={() => this.adjustZoom('availableSymbols', 0.25)}
                                disabled={scale >= 2.0}
                                title='Augmenter'
                            >
                                <i className='fa fa-plus'></i>
                            </button>
                        </div>
                    </div>
                </div>

                {/* Lettres minuscules */}
                {this.renderSymbolSection('Lettres minuscules', this.getLetters(false), scale)}

                {/* Lettres majuscules (si disponibles) */}
                {config.hasUpperCase && this.renderSymbolSection('Lettres majuscules', this.getLetters(true), scale)}

                {/* Chiffres */}
                {this.renderSymbolSection('Chiffres', this.getNumbers(), scale)}

                {/* Symboles spéciaux */}
                {config.characters.special && Object.keys(config.characters.special).length > 0 && 
                    this.renderSymbolSection('Symboles spéciaux', Object.keys(config.characters.special), scale)}
            </div>
        );
    }

    private async setAvailableSymbolsShowValue(enabled: boolean): Promise<void> {
        try {
            await this.preferenceService.set(PREF_AVAILABLE_SYMBOLS_SHOW_VALUE, enabled, PreferenceScope.User);
            this.update();
        } catch (error) {
            console.error('[AlphabetViewerWidget] Impossible de modifier la préférence showValue', error);
            this.messageService.error('Impossible de modifier la préférence d’affichage de valeur');
        }
    }

    /**
     * Rendu d'une section de symboles.
     */
    private renderSymbolSection(title: string, chars: string[], scale: number): React.ReactNode {
        if (chars.length === 0) {
            return null;
        }

        const config = this.alphabet?.alphabetConfig;
        const fontName = config?.type === 'font' 
            ? `Alphabet-${this.alphabetId}` 
            : undefined;
        const showValue = this.preferenceService.get(PREF_AVAILABLE_SYMBOLS_SHOW_VALUE, false) as boolean;

        return (
            <div style={{ marginBottom: '20px' }}>
                <h4 style={{ margin: '0 0 8px 0', fontSize: '14px', color: 'var(--theia-descriptionForeground)' }}>
                    {title}
                </h4>
                <div className='alphabet-symbols-grid' style={{
                    display: 'grid',
                    gridTemplateColumns: `repeat(auto-fill, minmax(${96 * scale}px, 1fr))`,
                    gap: `${12 * scale}px`
                }}>
                    {chars.map((char, idx) => (
                        <SymbolItem
                            key={`available-${title}-${char}`}
                            char={char}
                            index={idx}
                            scale={scale}
                            fontFamily={fontName}
                            imagePath={config?.type === 'images' ? this.getImageUrl(char) : undefined}
                            isDraggable={false}
                            showIndex={false}
                            showValue={showValue}
                            onClick={(c) => this.addSymbol(c)}
                        />
                    ))}
                </div>
            </div>
        );
    }

    /**
     * Obtient l'URL d'une image de symbole.
     */
    private getImageUrl(char: string): string {
        if (!this.alphabet) return '';

        const config = this.alphabet.alphabetConfig;
        const imageDir = config.imageDir || 'images';
        const format = config.imageFormat || 'png';

        // Déterminer le nom du fichier
        let filename: string;
        
        if (char.match(/[a-z]/)) {
            // Lettre minuscule
            const suffix = config.lowercaseSuffix || 'lowercase';
            filename = `${char}_${suffix}.${format}`;
        } else if (char.match(/[A-Z]/)) {
            // Lettre majuscule
            const suffix = config.uppercaseSuffix || 'uppercase';
            filename = `${char.toLowerCase()}_${suffix}.${format}`;
        } else if (char.match(/[0-9]/)) {
            // Chiffre
            filename = `${char}.${format}`;
        } else {
            // Symbole spécial
            const specialName = config.characters.special?.[char] || char;
            filename = `${specialName}.${format}`;
        }

        return this.alphabetsService.getResourceUrl(this.alphabetId, `${imageDir}/${filename}`);
    }

    /**
     * Obtient la liste des lettres.
     */
    private getLetters(uppercase: boolean): string[] {
        if (!this.alphabet) return [];

        const config = this.alphabet.alphabetConfig;
        const letters = config.characters.letters;

        if (letters === 'all') {
            const start = uppercase ? 'A'.charCodeAt(0) : 'a'.charCodeAt(0);
            return Array.from({ length: 26 }, (_, i) => String.fromCharCode(start + i));
        } else {
            return uppercase ? letters.map(l => l.toUpperCase()) : letters;
        }
    }

    /**
     * Obtient la liste des chiffres.
     */
    private getNumbers(): string[] {
        if (!this.alphabet) return [];

        const config = this.alphabet.alphabetConfig;
        const numbers = config.characters.numbers;

        if (numbers === 'all') {
            return Array.from({ length: 10 }, (_, i) => String(i));
        } else {
            return numbers;
        }
    }

    /**
     * Rendu des sources et crédits.
     */
    private renderSources(): React.ReactNode {
        if (!this.alphabet || !this.alphabet.sources || this.alphabet.sources.length === 0) {
            return null;
        }

        return (
            <div style={{
                padding: '16px',
                borderTop: '1px solid var(--theia-panel-border)',
                backgroundColor: 'var(--theia-sideBar-background)'
            }}>
                <h3 style={{ margin: '0 0 12px 0', fontSize: '16px' }}>Sources et crédits</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {this.alphabet.sources.map((source, idx) => (
                        <div key={idx} style={{
                            padding: '8px',
                            backgroundColor: 'var(--theia-list-activeSelectionBackground)',
                            borderRadius: '4px',
                            fontSize: '12px'
                        }}>
                            <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>
                                {source.type === 'reference' && '📚 '}
                                {source.type === 'font' && '🔤 '}
                                {source.type === 'author' && '👤 '}
                                {source.type === 'credit' && '©️ '}
                                {source.label}
                            </div>
                            {source.url && (
                                <a
                                    href={source.url}
                                    target='_blank'
                                    rel='noopener noreferrer'
                                    style={{
                                        color: 'var(--theia-textLink-foreground)',
                                        textDecoration: 'none'
                                    }}
                                >
                                    {source.url}
                                </a>
                            )}
                            {source.author && <div>Auteur: {source.author}</div>}
                            {source.description && (
                                <div style={{ color: 'var(--theia-descriptionForeground)', marginTop: '4px' }}>
                                    {source.description}
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            </div>
        );
    }

    /**
     * Cleanup lors de la destruction du widget.
     */
    dispose(): void {
        // Supprimer le style de police si présent
        const styleId = `font-style-${this.alphabetId}`;
        const styleElement = document.getElementById(styleId);
        if (styleElement) {
            styleElement.remove();
        }
        super.dispose();
    }
}

