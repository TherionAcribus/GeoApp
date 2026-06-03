/**
 * Widget Formula Solver principal
 * Interface utilisateur React pour résoudre les formules de coordonnées
 */

import * as React from '@theia/core/shared/react';
import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { MessageService } from '@theia/core/lib/common/message-service';
import { PreferenceService } from '@theia/core/lib/common/preferences/preference-service';
import { PreferenceScope } from '@theia/core/lib/common/preferences/preference-scope';
import { FormulaSolverService } from './formula-solver-service';
import { FormulaSolverPipeline, AnswersEngine } from './formula-solver-pipeline';
import { AnswersMode, FormulaDetectionMethod, FormulaSolverStepConfig, QuestionsMethod } from './formula-solver-config';
import { FormulaSolverAiProfile } from './geoapp-formula-solver-agents';
import { AnsweringContextCache, PreparedAnsweringContext } from './answering-context-cache';
import { AnswerDetail } from './strategies/types';
import { Formula, Question, LetterValue, FormulaSolverState } from '../common/types';
import { parseValueList } from './utils/value-parser';
import { ensureFormulaFragments } from './utils/formula-fragments';
import { CoordinatePreviewEngine } from './preview/coordinate-preview-engine';
import {
    DetectedFormulasComponent,
    QuestionFieldCard,
    ResultDisplayComponent,
    FormulaPreviewComponent,
    BruteForceComponent
} from './components';

@injectable()
export class FormulaSolverWidget extends ReactWidget {

    static readonly ID = 'formula-solver:widget';
    static readonly LABEL = 'Formula Solver';

    @inject(FormulaSolverService)
    protected readonly formulaSolverService!: FormulaSolverService;

    @inject(MessageService)
    protected readonly messageService!: MessageService;

    @inject(PreferenceService)
    protected readonly preferenceService!: PreferenceService;

    @inject(FormulaSolverPipeline)
    protected readonly pipeline!: FormulaSolverPipeline;

    @inject(AnsweringContextCache)
    protected readonly answeringContextCache!: AnsweringContextCache;


    // État du widget
    protected state: FormulaSolverState = {
        currentStep: 'detect',
        formulas: [],
        questions: [],
        values: new Map<string, LetterValue>(),
        loading: false
    };

    // Configuration des étapes (initialisée depuis les préférences, modifiable à la volée)
    protected stepConfig: FormulaSolverStepConfig = {
        formulaDetectionMethod: 'algorithm',
        questionsMethod: 'algorithm',
        answersMode: 'ai-per-question',
        aiProfileForFormula: 'fast',
        aiProfileForQuestions: 'fast',
        aiProfileForAnswers: 'fast'
    };

    protected answersEngine: AnswersEngine = 'ai';
    protected webSearchEnabled: boolean = true;
    protected webMaxResults: number = 5;
    protected previewMapOverlayEnabled: boolean = true;

    protected readonly previewEngine = new CoordinatePreviewEngine();

    // Profil IA par question (override)
    protected perQuestionProfiles: Map<string, FormulaSolverAiProfile> = new Map();

    // UI: options avancées repliées par défaut
    protected stepConfigPanelOpen: boolean = false;
    protected showAdvancedAnswerFields: boolean = false;

    // --- IA: contexte & prompts (visualisation / overrides) ---
    protected answeringContextOpen: boolean = false;
    protected answeringContextUseOverride: boolean = false;
    protected answeringContextJson: string = '';
    protected answeringContextJsonError?: string;
    protected answeringContextOverride?: PreparedAnsweringContext;
    protected answeringAdditionalInstructions: string = '';
    protected perLetterExtraInfo: Map<string, string> = new Map();

    // Aide utilisateur pour l'extraction IA des questions
    protected questionsAiHintOpen: boolean = false;
    protected questionsAiUserHint: string = '';

    // Per-question loading state, answer details, and expanded detail view
    protected loadingLetters: Set<string> = new Set();
    protected answerDetails: Map<string, AnswerDetail> = new Map();
    protected expandedDetailLetters: Set<string> = new Set();

    // Global answering loading state (for bulk operations)
    protected isAnsweringLoading: boolean = false;

    // Type de calcul global pour les valeurs
    protected globalValueType: 'value' | 'checksum' | 'reduced' | 'length' | 'custom' = 'value';

    protected manualNorth: string = '';
    protected manualEast: string = '';
    protected manualFormulaOpen: boolean = false;

    // État brute force
    protected bruteForceMode: boolean = false;
    protected bruteForceResults: Array<{
        id: string;
        label: string;
        values: Record<string, number>;
        coordinates?: any;
    }> = [];

    protected detectionRequestId: number = 0;

    protected questionsRequestId: number = 0;

    @postConstruct()
    protected init(): void {
        this.id = FormulaSolverWidget.ID;
        this.title.label = FormulaSolverWidget.LABEL;
        this.title.caption = FormulaSolverWidget.LABEL;
        this.title.closable = true;
        this.title.iconClass = 'codicon codicon-symbol-variable';

        // Les préférences seront chargées de manière asynchrone dans onAfterAttach
        this.update();
    }

    protected parseManualFormulaInputs(): { north: string; east: string } | undefined {
        const northRaw = (this.manualNorth || '').trim();
        const eastRaw = (this.manualEast || '').trim();

        if (!northRaw && !eastRaw) {
            return undefined;
        }

        if (northRaw && eastRaw) {
            return {
                north: northRaw,
                east: eastRaw
            };
        }

        const combined = northRaw || eastRaw;
        const lines = combined
            .split(/\r?\n/)
            .map(l => l.trim())
            .filter(Boolean);

        if (lines.length >= 2) {
            return {
                north: lines[0],
                east: lines[1]
            };
        }

        const northMatch = combined.match(/([NS]\s*\d{1,2}[^\n]*?)(?=\s*[EW]\s*\d{1,3}|$)/i);
        const eastMatch = combined.match(/([EW]\s*\d{1,3}[^\n]*)/i);

        if (northMatch && eastMatch) {
            return {
                north: northMatch[1].trim(),
                east: eastMatch[1].trim()
            };
        }

        return undefined;
    }

    protected async addManualFormula(): Promise<void> {
        const parsed = this.parseManualFormulaInputs();
        if (!parsed) {
            this.messageService.warn('Veuillez saisir une formule Nord et Est (ou coller 2 lignes).');
            return;
        }

        if (!/^\s*[NS]/i.test(parsed.north) || !/^\s*[EW]/i.test(parsed.east)) {
            this.messageService.warn('Format invalide. Le Nord doit commencer par N/S et l\'Est par E/W.');
            return;
        }

        const rawFormula: Formula = {
            id: `manual_${Date.now()}`,
            north: parsed.north,
            east: parsed.east,
            source: 'manual',
            text_output: `${parsed.north} ${parsed.east}`,
            confidence: 1
        };

        const [enriched] = this.annotateFormulas([rawFormula]);
        const nextFormulas = [enriched, ...this.state.formulas];

        this.updateState({
            formulas: nextFormulas,
            selectedFormula: enriched,
            currentStep: 'questions',
            questions: [],
            values: new Map<string, LetterValue>(),
            result: undefined,
            error: undefined
        });

        this.manualNorth = '';
        this.manualEast = '';
        this.update();

        await this.extractQuestions(enriched);
    }

    protected onAfterAttach(msg: unknown): void {
        super.onAfterAttach(msg as any);

        if (typeof window !== 'undefined') {
            window.addEventListener(
                'geoapp-map-remove-brute-force-point',
                this.handleExternalBruteForceRemoval as EventListener
            );
        }

        // Charger les préférences
        this.loadPreferences();
        this.update();
    }

    protected onBeforeDetach(msg: unknown): void {
        if (typeof window !== 'undefined') {
            window.removeEventListener(
                'geoapp-map-remove-brute-force-point',
                this.handleExternalBruteForceRemoval as EventListener
            );
            // Nettoyer l'overlay preview si le widget se ferme
            window.dispatchEvent(new CustomEvent('geoapp-map-formula-solver-preview-overlay-clear'));
        }

        super.onBeforeDetach(msg as any);
    }

    /**
     * Charge les préférences utilisateur
     */
    protected loadPreferences(): void {
        const legacyDefaultMethod = this.preferenceService.get('geoApp.formulaSolver.defaultMethod', 'algorithm') as string;

        const formulaMethod = (this.preferenceService.get(
            'geoApp.formulaSolver.formulaDetection.defaultMethod',
            legacyDefaultMethod
        ) as FormulaDetectionMethod) || 'algorithm';

        const questionsMethod = (this.preferenceService.get(
            'geoApp.formulaSolver.questions.defaultMethod',
            'algorithm'
        ) as QuestionsMethod) || 'algorithm';

        const answersMode = (this.preferenceService.get(
            'geoApp.formulaSolver.answers.defaultMode',
            'ai-per-question'
        ) as AnswersMode) || 'ai-per-question';

        const aiProfileForFormula = (this.preferenceService.get(
            'geoApp.formulaSolver.ai.defaultProfile.formulaDetection',
            'fast'
        ) as FormulaSolverAiProfile) || 'fast';

        const aiProfileForQuestions = (this.preferenceService.get(
            'geoApp.formulaSolver.ai.defaultProfile.questions',
            'fast'
        ) as FormulaSolverAiProfile) || 'fast';

        const aiProfileForAnswers = (this.preferenceService.get(
            'geoApp.formulaSolver.ai.defaultProfile.answers',
            'fast'
        ) as FormulaSolverAiProfile) || 'fast';

        this.webSearchEnabled = Boolean(this.preferenceService.get('geoApp.formulaSolver.ai.webSearchEnabled', true));
        this.webMaxResults = Number(this.preferenceService.get('geoApp.formulaSolver.ai.maxWebResults', 5) || 5);
        this.previewMapOverlayEnabled = Boolean(this.preferenceService.get('geoApp.formulaSolver.preview.mapOverlayEnabled', true));

        this.stepConfig = {
            formulaDetectionMethod: formulaMethod,
            questionsMethod,
            answersMode,
            aiProfileForFormula,
            aiProfileForQuestions,
            aiProfileForAnswers
        };

        // Par défaut, on laisse l'utilisateur choisir IA vs Web depuis l'UI.
        this.answersEngine = 'ai';
    }

    protected updateMapPreviewOverlay(valuesOverride?: Map<string, LetterValue>): void {
        if (typeof window === 'undefined') {
            return;
        }

        if (!this.previewMapOverlayEnabled) {
            window.dispatchEvent(new CustomEvent('geoapp-map-formula-solver-preview-overlay-clear'));
            return;
        }

        const originLat = this.state.originLat;
        const originLon = this.state.originLon;
        const hasOrigin = typeof originLat === 'number' && typeof originLon === 'number' && isFinite(originLat) && isFinite(originLon);
        const radiusMeters = 2 * 1609.344; // 2 miles

        const formula = this.state.selectedFormula;
        if (!formula) {
            // Si on connaît l'origine, on peut au moins afficher le cercle de contrainte
            if (hasOrigin) {
                window.dispatchEvent(new CustomEvent('geoapp-map-formula-solver-preview-overlay', {
                    detail: {
                        gcCode: this.state.gcCode,
                        geocacheId: this.state.geocacheId,
                        circle: { centerLat: originLat, centerLon: originLon, radiusMeters }
                    }
                }));
                return;
            }
            window.dispatchEvent(new CustomEvent('geoapp-map-formula-solver-preview-overlay-clear'));
            return;
        }

        const values = valuesOverride ?? this.state.values;
        const preview = this.previewEngine.build({ north: formula.north, east: formula.east }, values);
        const n = preview.north;
        const e = preview.east;

        const canBuildCandidate = !(n.minDecimalDegrees === undefined || n.maxDecimalDegrees === undefined ||
            e.minDecimalDegrees === undefined || e.maxDecimalDegrees === undefined);

        const candidateBounds = canBuildCandidate ? {
            minLat: n.minDecimalDegrees!,
            maxLat: n.maxDecimalDegrees!,
            minLon: e.minDecimalDegrees!,
            maxLon: e.maxDecimalDegrees!
        } : undefined;

        const makeKind = (b: { minLat: number; maxLat: number; minLon: number; maxLon: number }): 'point' | 'bbox' | 'line-lat' | 'line-lon' => {
            const latSpan = Math.abs(b.maxLat - b.minLat);
            const lonSpan = Math.abs(b.maxLon - b.minLon);
            const eps = 1e-9;
            if (latSpan < eps && lonSpan < eps) {
                return 'point';
            }
            if (latSpan < eps) {
                return 'line-lat';
            }
            if (lonSpan < eps) {
                return 'line-lon';
            }
            return 'bbox';
        };

        const formatted = (n.status === 'valid' && e.status === 'valid')
            ? `${n.display} ${e.display}`
            : undefined;

        let candidateRaw: any | undefined;
        let candidateClipped: any | undefined;

        if (candidateBounds) {
            candidateRaw = { kind: makeKind(candidateBounds), bounds: candidateBounds, formatted };

            if (hasOrigin) {
                const clippedBounds = intersectBoundsWithCircleBBox(candidateBounds, originLat, originLon, radiusMeters);
                if (clippedBounds) {
                    // On calcule le kind sur la zone clippée (peut devenir ligne/point)
                    candidateClipped = { kind: makeKind(clippedBounds), bounds: clippedBounds, formatted };
                }
            } else {
                candidateClipped = undefined;
            }
        }

        if (!candidateRaw && !candidateClipped && !hasOrigin) {
            window.dispatchEvent(new CustomEvent('geoapp-map-formula-solver-preview-overlay-clear'));
            return;
        }

        window.dispatchEvent(new CustomEvent('geoapp-map-formula-solver-preview-overlay', {
            detail: {
                gcCode: this.state.gcCode,
                geocacheId: this.state.geocacheId,
                circle: hasOrigin ? { centerLat: originLat, centerLon: originLon, radiusMeters } : undefined,
                candidateRaw,
                candidateClipped
            }
        }));
    }

    /**
     * Charge le Formula Solver depuis une geocache
     */
    async loadFromGeocache(geocacheId: number): Promise<void> {
        console.log(`[FORMULA-SOLVER] Chargement depuis geocache ${geocacheId}`);
        
        try {
            // Clear overlay preview (nouvelle géocache)
            this.updateMapPreviewOverlay(new Map());
            this.detectionRequestId++;
            this.manualNorth = '';
            this.manualEast = '';
            this.manualFormulaOpen = false;
            this.updateState({
                loading: true,
                error: undefined,
                currentStep: 'detect',
                geocacheId: undefined,
                gcCode: undefined,
                text: '',
                originLat: undefined,
                originLon: undefined,
                formulas: [],
                selectedFormula: undefined,
                questions: [],
                values: new Map<string, LetterValue>(),
                result: undefined
            });
            this.bruteForceMode = false;
            this.bruteForceResults = [];
            
            // Récupérer les données de la geocache
            const geocache = await this.formulaSolverService.getGeocache(geocacheId);
            
            console.log(`[FORMULA-SOLVER] Geocache ${geocache.gc_code} chargée`);
            
            // Mettre à jour l'état avec les données de la geocache
            this.updateState({
                geocacheId: geocache.id,
                gcCode: geocache.gc_code,
                geocacheName: geocache.name,
                text: geocache.description,
                originLat: geocache.latitude,
                originLon: geocache.longitude
            });
            
            // Détecter automatiquement les formules
            if (geocache.description) {
                await this.detectFormulasFromText(geocache.description);
            } else {
                this.updateState({ loading: false });
            }
            
            this.messageService.info(`Formula Solver chargé pour ${geocache.gc_code} - ${geocache.name}`);
            
        } catch (error) {
            console.error('[FORMULA-SOLVER] Erreur lors du chargement:', error);
            const errorMsg = error instanceof Error ? error.message : 'Erreur inconnue';
            this.updateState({ 
                error: `Erreur lors du chargement de la geocache: ${errorMsg}`,
                loading: false 
            });
            this.messageService.error(`Erreur: ${errorMsg}`);
        }
    }

    /**
     * Met à jour l'état et rafraîchit l'UI
     */
    protected updateState(updates: Partial<FormulaSolverState>): void {
        this.state = { ...this.state, ...updates };
        this.update();
    }

    /**
     * Génère les fragments pour chaque formule
     */
    protected annotateFormulas(formulas: Formula[]): Formula[] {
        return formulas.map(formula => {
            const cloned: Formula = { ...formula };
            ensureFormulaFragments(cloned);
            return cloned;
        });
    }

    /**
     * Affiche le résultat sur la carte via événement window
     */
    protected showOnMap(): void {
        if (!this.state.result || !this.state.result.coordinates) {
            this.messageService.error('Aucun résultat à afficher sur la carte');
            return;
        }

        try {
            // Préparer les informations pour le popup
            const formulaText = this.state.selectedFormula 
                ? `${this.state.selectedFormula.north} ${this.state.selectedFormula.east}`
                : 'Formule inconnue';
            
            const valueEntries: Array<[string, LetterValue]> = Array.from(this.state.values.entries());
            const valuesText = valueEntries
                .map(([letter, value]) => `${letter}=${value.value} (${value.rawValue})`)
                .join(', ');

            const coords = this.state.result.coordinates;
            const formattedCoords = `${coords.ddm}\n${coords.dms}\n${coords.decimal}`;

            // Construire la note détaillée
            const note = `Solution Formula Solver\n\nFormule: ${formulaText}\nValeurs: ${valuesText}\n\nCoordonnées:\n${formattedCoords}`;

            console.log('[FORMULA-SOLVER] Émission événement geoapp-map-highlight-coordinate', {
                lat: coords.latitude,
                lon: coords.longitude,
                formatted: coords.ddm
            });

            // Émettre événement pour la carte (compatible avec MapService de zones)
            window.dispatchEvent(new CustomEvent('geoapp-map-highlight-coordinate', {
                detail: {
                    gcCode: this.state.gcCode,
                    pluginName: 'Formula Solver',
                    coordinates: {
                        latitude: coords.latitude,
                        longitude: coords.longitude,
                        formatted: coords.ddm
                    },
                    waypointTitle: 'Solution formule',
                    waypointNote: note,
                    sourceResultText: formattedCoords
                }
            }));

            this.messageService.info('Coordonnées affichées sur la carte !');
            
        } catch (error) {
            console.error('[FORMULA-SOLVER] Erreur lors de l\'affichage sur la carte:', error);
            this.messageService.error('Erreur lors de l\'affichage sur la carte');
        }
    }

    /**
     * Crée un waypoint depuis le résultat
     * Utilise le système d'événements pour créer le waypoint (comme les plugins)
     */
    protected async createWaypoint(autoSave: boolean = false): Promise<void> {
        if (!this.state.geocacheId || !this.state.result || !this.state.result.coordinates) {
            this.messageService.error('Impossible de créer le waypoint : données manquantes');
            return;
        }

        try {
            const coords = this.state.result.coordinates;
            const note = this.buildWaypointNote(coords);

            this.dispatchWaypointCreation({
                coords,
                note,
                title: 'Solution formule',
                pluginName: 'Formula Solver',
                autoSave
            });

        } catch (error) {
            console.error('[FORMULA-SOLVER] Erreur lors de la préparation du waypoint:', error);
            const errorMsg = error instanceof Error ? error.message : 'Erreur inconnue';
            this.messageService.error(`Erreur: ${errorMsg}`);
        }
    }

    /**
     * Définit les coordonnées calculées comme coordonnées corrigées de la géocache
     */
    protected async setCorrectedCoords(): Promise<void> {
        if (!this.state.geocacheId || !this.state.result?.coordinates) {
            this.messageService.error('Aucune géocache ou coordonnées disponibles');
            return;
        }

        const coords = this.state.result.coordinates;
        // Format: "N 48° 51.123 E 002° 17.456"
        const gcCoords = coords.ddm || `${coords.decimal}`;

        try {
            await this.formulaSolverService.setCorrectedCoordinates(this.state.geocacheId, gcCoords);
            this.messageService.info('Coordonnées corrigées mises à jour');

            // Dispatch event to refresh geocache details widget if open
            window.dispatchEvent(new CustomEvent('geoapp-geocache-coordinates-updated', {
                detail: { geocacheId: this.state.geocacheId }
            }));
        } catch (error) {
            console.error('[Formula Solver] Erreur lors de la correction des coordonnées:', error);
            this.messageService.error('Erreur lors de la mise à jour des coordonnées corrigées');
        }
    }

    protected createWaypointFromBrute(resultId: string, autoSave: boolean = false): void {
        if (!this.state.geocacheId) {
            this.messageService.error('Aucune géocache chargée, impossible de créer le waypoint');
            return;
        }

        const result = this.bruteForceResults.find(r => r.id === resultId);
        if (!result) {
            this.messageService.error('Résultat brute force introuvable');
            return;
        }

        if (!result.coordinates) {
            this.messageService.error('Ce résultat ne contient pas de coordonnées valides');
            return;
        }

        try {
            const note = this.buildWaypointNote(result.coordinates, result.values);

            this.dispatchWaypointCreation({
                coords: result.coordinates,
                note,
                title: result.label || 'Solution brute force',
                pluginName: 'Formula Solver (Brute Force)',
                autoSave
            });

        } catch (error) {
            console.error('[FORMULA-SOLVER] Erreur lors de la préparation du waypoint brute force:', error);
            const errorMsg = error instanceof Error ? error.message : 'Erreur inconnue';
            this.messageService.error(`Erreur: ${errorMsg}`);
        }
    }

    private dispatchWaypointCreation(options: {
        coords: {
            latitude: number;
            longitude: number;
            ddm?: string;
            dms?: string;
            decimal?: string;
        };
        note: string;
        title: string;
        pluginName: string;
        autoSave: boolean;
    }): void {
        const { coords, note, title, pluginName, autoSave } = options;

        const gcCoords = this.formatGeocachingCoordinates(coords.latitude, coords.longitude);

        window.dispatchEvent(new CustomEvent('geoapp-plugin-add-waypoint', {
            detail: {
                gcCoords,
                pluginName,
                geocache: this.state.gcCode ? { gcCode: this.state.gcCode } : undefined,
                waypointTitle: title,
                waypointNote: note,
                sourceResultText: note,
                decimalLatitude: coords.latitude,
                decimalLongitude: coords.longitude,
                autoSave
            }
        }));

        if (autoSave) {
            this.messageService.info(`${title} validé automatiquement en waypoint`);
        } else {
            this.messageService.info(`${title}: formulaire de waypoint ouvert`);
        }
    }

    private buildWaypointNote(coords: { ddm?: string; dms?: string; decimal?: string }, valuesOverride?: Record<string, number>): string {
        const formulaText = this.state.selectedFormula
            ? `${this.state.selectedFormula.north} ${this.state.selectedFormula.east}`
            : 'Formule inconnue';

        let valuesText: string;
        if (valuesOverride) {
            const entries = Object.entries(valuesOverride)
                .map(([letter, value]) => `${letter}=${value}`)
                .join('\n');
            valuesText = entries || 'Aucune valeur';
        } else {
            const valueEntries: Array<[string, LetterValue]> = Array.from(this.state.values.entries());
            valuesText = valueEntries
                .map(([letter, value]) => `${letter}=${value.value} (${value.rawValue}, type: ${value.type})`)
                .join('\n');
        }

        const coordDetails = [coords.ddm, coords.dms, coords.decimal].filter(Boolean).join('\n');

        return `Solution Formula Solver\n\nFormule:\n${formulaText}\n\nValeurs:\n${valuesText}\n\nCoordonnées:\n${coordDetails}`;
    }

    /**
     * Convertit des coordonnées décimales au format Geocaching
     */
    private formatGeocachingCoordinates(lat: number, lon: number): string {
        const latDir = lat >= 0 ? 'N' : 'S';
        const lonDir = lon >= 0 ? 'E' : 'W';

        const absLat = Math.abs(lat);
        const absLon = Math.abs(lon);

        const latDeg = Math.floor(absLat);
        const latMin = (absLat - latDeg) * 60;

        const lonDeg = Math.floor(absLon);
        const lonMin = (absLon - lonDeg) * 60;

        return `${latDir} ${latDeg}° ${latMin.toFixed(3)} ${lonDir} ${String(lonDeg).padStart(3, '0')}° ${lonMin.toFixed(3)}`;
    }

    /**
     * Détecte les formules depuis un texte (selon la méthode choisie)
     */
    protected async detectFormulasFromText(text: string): Promise<void> {
        if (!text.trim()) {
            this.messageService.warn('Veuillez saisir un texte à analyser');
            return;
        }

        const requestId = ++this.detectionRequestId;
        this.bruteForceMode = false;
        this.bruteForceResults = [];

        this.updateState({
            loading: true,
            error: undefined,
            formulas: [],
            selectedFormula: undefined,
            questions: [],
            values: new Map<string, LetterValue>(),
            result: undefined,
            currentStep: 'detect'
        });

        try {
            const method = this.stepConfig.formulaDetectionMethod;
            console.log(`[FORMULA-SOLVER] 🎯 Étape Formule: ${method}`);

            const detection = await this.pipeline.detectFormula({
                text,
                geocacheId: this.state.geocacheId,
                method,
                aiProfile: this.stepConfig.aiProfileForFormula
            });

            if (requestId !== this.detectionRequestId) {
                return;
            }

            if (method === 'manual' && detection.formulas.length === 0) {
                this.messageService.info('Mode manuel: utilisez "Formule manuelle" pour ajouter une formule.');
                this.updateState({ loading: false });
                return;
            }

            if (detection.formulas.length === 0) {
                this.messageService.info('Aucune formule détectée dans le texte');
                this.updateState({
                    loading: false,
                    formulas: [],
                    selectedFormula: undefined,
                    currentStep: 'detect',
                    questions: [],
                    values: new Map<string, LetterValue>(),
                    result: undefined
                });
                return;
            }

            const enrichedFormulas = this.annotateFormulas(detection.formulas);
            this.messageService.info(`${enrichedFormulas.length} formule(s) détectée(s)`);
            this.updateState({
                loading: false,
                formulas: enrichedFormulas,
                selectedFormula: enrichedFormulas[0],
                currentStep: 'questions',
                questions: [],
                values: new Map<string, LetterValue>(),
                result: undefined
            });

            await this.runQuestionsStep(enrichedFormulas[0]);
        } catch (error) {
            if (requestId !== this.detectionRequestId) {
                return;
            }
            const message = error instanceof Error ? error.message : 'Erreur inconnue';
            this.messageService.error(`Erreur : ${message}`);
            this.updateState({ loading: false, error: message });
        }
    }


    /**
     * Modifie manuellement une formule détectée
     * Préserve les questions et valeurs existantes pour les lettres communes
     */
    protected async handleEditFormula(formula: Formula, updatedNorth: string, updatedEast: string): Promise<void> {
        // Mise à jour de la formule dans la liste
        const updatedFormulasRaw = this.state.formulas.map((f: Formula) => {
            if (f.id === formula.id) {
                return {
                    ...f,
                    north: updatedNorth,
                    east: updatedEast,
                    text_output: `${updatedNorth} ${updatedEast}`,
                    confidence: 1.0 // Formule manuellement corrigée = confiance maximale
                };
            }
            return f;
        });

        const updatedFormulas = this.annotateFormulas(updatedFormulasRaw);

        // Si c'est la formule sélectionnée, la mettre à jour aussi
        const updatedSelectedFormula = this.state.selectedFormula?.id === formula.id
            ? updatedFormulas.find(f => f.id === formula.id)
            : this.state.selectedFormula;

        this.updateState({
            formulas: updatedFormulas,
            selectedFormula: updatedSelectedFormula
        });

        // Si la formule sélectionnée a changé, préserver les questions/valeurs existantes
        if (updatedSelectedFormula && this.state.selectedFormula?.id === formula.id) {
            // Extraire les lettres de la nouvelle formule
            const newLetters = this.extractVariablesFromFormula(updatedNorth, updatedEast);
            const previousQuestions = new Map(this.state.questions.map(q => [q.letter, q]));
            const previousValues = new Map(this.state.values);

            // Identifier les nouvelles lettres (pas dans les questions précédentes)
            const newLetterIds = newLetters.filter(l => !previousQuestions.has(l));

            // Conserver les questions et valeurs pour les lettres existantes
            const preservedQuestions = newLetters
                .filter(l => previousQuestions.has(l))
                .map(l => previousQuestions.get(l)!);
            const preservedValues = new Map<string, LetterValue>();
            for (const letter of newLetters) {
                const existing = previousValues.get(letter);
                if (existing) {
                    preservedValues.set(letter, existing);
                }
            }

            if (newLetterIds.length > 0) {
                // Il y a de nouvelles lettres, extraire les questions pour celles-ci
                this.messageService.info(`Nouvelles variables détectées : ${newLetterIds.join(', ')}. Extraction des questions...`);

                // Créer une formule temporaire avec seulement les nouvelles lettres pour l'extraction
                const tempFormula: Formula = {
                    ...updatedSelectedFormula,
                    north: updatedNorth,
                    east: updatedEast,
                    text_output: `${updatedNorth} ${updatedEast}`
                };

                // Extraire les questions pour les nouvelles lettres
                await this.extractQuestionsForNewLetters(
                    tempFormula,
                    preservedQuestions,
                    preservedValues,
                    new Set(newLetterIds)
                );
            } else {
                // Pas de nouvelles lettres, juste mettre à jour l'état et recalculer si possible
                this.updateState({
                    questions: preservedQuestions,
                    values: preservedValues
                });

                // Recalculer automatiquement si toutes les valeurs sont présentes
                this.tryAutoCalculateOrBruteForce();
            }
        }

        this.messageService.info('Formule modifiée avec succès');
    }

    /**
     * Extrait les variables (lettres) d'une formule
     */
    protected extractVariablesFromFormula(north: string, east: string): string[] {
        const allText = `${north} ${east}`;
        const matches = allText.match(/[A-Z]/g) || [];
        return [...new Set(matches)].sort();
    }

    /**
     * Extrait les questions uniquement pour les nouvelles lettres
     * et fusionne avec les questions/valeurs préservées
     */
    protected async extractQuestionsForNewLetters(
        formula: Formula,
        preservedQuestions: Question[],
        preservedValues: Map<string, LetterValue>,
        newLetters: Set<string>
    ): Promise<void> {
        const requestId = ++this.questionsRequestId;
        const method = this.stepConfig.questionsMethod;
        const aiProfile = this.stepConfig.aiProfileForQuestions;

        this.updateState({
            loading: true,
            error: undefined
        });

        try {
            const discovery = await this.pipeline.discoverQuestions({
                text: this.state.text || '',
                formula,
                method,
                aiProfile,
                userHint: method === 'ai' ? this.questionsAiUserHint : undefined
            });

            if (requestId !== this.questionsRequestId) {
                return;
            }

            const discoveredLetters = Array.from(discovery.questionsByLetter.keys());

            // Construire la liste complète des questions
            const allQuestions: Question[] = [...preservedQuestions];
            const allValues = new Map<string, LetterValue>(preservedValues);

            // Ajouter les questions pour les nouvelles lettres
            for (const letter of discoveredLetters) {
                if (newLetters.has(letter) && !allValues.has(letter)) {
                    allQuestions.push({
                        letter,
                        question: discovery.questionsByLetter.get(letter) || ''
                    });
                }
            }

            // S'assurer que toutes les lettres de la formule ont une entrée
            const formulaLetters = this.extractVariablesFromFormula(formula.north, formula.east);
            for (const letter of formulaLetters) {
                if (!allValues.has(letter)) {
                    const existingQuestion = discovery.questionsByLetter.get(letter);
                    if (existingQuestion && !allQuestions.find(q => q.letter === letter)) {
                        allQuestions.push({ letter, question: existingQuestion });
                    }
                }
            }

            this.updateState({
                loading: false,
                questions: allQuestions,
                values: allValues,
                currentStep: 'values'
            });

            // Auto-lancer les réponses IA si le mode est configuré pour IA et moteur = IA
            const shouldAutoAnswer = this.answersEngine === 'ai' &&
                (this.stepConfig.answersMode === 'ai-bulk' || this.stepConfig.answersMode === 'ai-per-question');
            console.log('[FORMULA-SOLVER] Auto-answer check:', {
                answersEngine: this.answersEngine,
                answersMode: this.stepConfig.answersMode,
                shouldAutoAnswer,
                questionsCount: allQuestions.length
            });
            if (shouldAutoAnswer && allQuestions.length > 0) {
                console.log('[FORMULA-SOLVER] Auto-lancement des réponses IA après extraction des questions');
                // Petit délai pour laisser l'UI se mettre à jour
                setTimeout(() => {
                    void this.answerAllQuestions({ overwrite: false });
                }, 100);
            } else {
                console.log('[FORMULA-SOLVER] Auto-answer skipped: engine=' + this.answersEngine + ', mode=' + this.stepConfig.answersMode);
            }

            // Recalculer automatiquement si toutes les valeurs sont présentes
            this.tryAutoCalculateOrBruteForce();
        } catch (error) {
            if (requestId !== this.questionsRequestId) {
                return;
            }
            const message = error instanceof Error ? error.message : 'Erreur inconnue';
            this.messageService.error(`Erreur lors de l'extraction : ${message}`);
            this.updateState({ loading: false, error: message });
        }
    }

    /**
     * Extrait les questions pour une formule
     */
    protected async extractQuestions(formula: Formula): Promise<void> {
        // Backward-compat: l'ancien code appelait extractQuestions().
        // La logique est désormais déléguée au pipeline rejouable.
        await this.runQuestionsStep(formula);
    }

    protected async runQuestionsStep(
        formula: Formula,
        options?: { method?: QuestionsMethod; aiProfile?: FormulaSolverAiProfile }
    ): Promise<void> {
        const requestId = ++this.questionsRequestId;
        const method = options?.method ?? this.stepConfig.questionsMethod;
        const aiProfile = options?.aiProfile ?? this.stepConfig.aiProfileForQuestions;

        console.log('[FORMULA-SOLVER] runQuestionsStep start', {
            requestId,
            method,
            answersEngine: this.answersEngine,
            answersMode: this.stepConfig.answersMode,
            geocacheId: this.state.geocacheId,
            gcCode: this.state.gcCode
        });

        // Conserver les valeurs déjà saisies si la lettre existe toujours
        const previousValues = new Map(this.state.values);

        this.updateState({
            loading: true,
            error: undefined,
            questions: [],
            values: new Map<string, LetterValue>(),
            result: undefined
        });

        try {
            const discovery = await this.pipeline.discoverQuestions({
                text: this.state.text || '',
                formula,
                method,
                aiProfile,
                userHint: method === 'ai' ? this.questionsAiUserHint : undefined
            });

            if (requestId !== this.questionsRequestId) {
                return;
            }

            const letters = Array.from(discovery.questionsByLetter.keys());
            if (letters.length === 0) {
                this.messageService.warn('Aucune variable détectée dans la formule');
                this.updateState({ loading: false });
                return;
            }

            const questions: Question[] = letters.map(letter => ({
                letter,
                question: discovery.questionsByLetter.get(letter) || ''
            }));

            const values = new Map<string, LetterValue>();
            for (const letter of letters) {
                const existing = previousValues.get(letter);
                if (existing) {
                    values.set(letter, existing);
                }

                if (!this.perQuestionProfiles.has(letter)) {
                    this.perQuestionProfiles.set(letter, this.stepConfig.aiProfileForAnswers);
                }
            }

            this.updateState({
                loading: false,
                questions,
                values,
                currentStep: 'values'
            });

            // Auto-lancer les réponses IA si le mode est configuré pour IA et moteur = IA
            const shouldAutoAnswer = this.answersEngine === 'ai' &&
                (this.stepConfig.answersMode === 'ai-bulk' || this.stepConfig.answersMode === 'ai-per-question');
            console.log('[FORMULA-SOLVER] Auto-answer check (runQuestionsStep):', {
                answersEngine: this.answersEngine,
                answersMode: this.stepConfig.answersMode,
                shouldAutoAnswer,
                questionsCount: questions.length
            });
            if (shouldAutoAnswer && questions.length > 0) {
                console.log('[FORMULA-SOLVER] Auto-lancement des réponses IA après extraction des questions');
                setTimeout(() => {
                    void this.answerAllQuestions({ overwrite: false });
                }, 100);
            }
        } catch (error) {
            if (requestId !== this.questionsRequestId) {
                return;
            }
            const message = error instanceof Error ? error.message : 'Erreur inconnue';
            this.messageService.error(`Erreur : ${message}`);
            this.updateState({ loading: false, error: message });
        }
    }

    protected getQuestionsByLetter(): Map<string, string> {
        return new Map<string, string>(
            (this.state.questions || []).map(q => [q.letter, q.question || ''])
        );
    }

    protected buildQuestionsRecord(source?: Map<string, string>): Record<string, string> {
        const map = source ?? this.getQuestionsByLetter();
        const obj: Record<string, string> = {};
        map.forEach((v, k) => { obj[k] = v || ''; });
        return obj;
    }

    protected async refreshAnsweringContext(forceRebuild: boolean = false): Promise<void> {
        try {
            const questions = this.buildQuestionsRecord(this.getQuestionsByLetter());
            const ctx = await this.answeringContextCache.getOrBuild({
                geocacheId: this.state.geocacheId,
                geocacheCode: this.state.gcCode,
                geocacheTitle: this.state.geocacheName,
                text: this.state.text || '',
                questionsByLetter: questions,
                targetLetters: Object.keys(questions),
                profile: this.stepConfig.aiProfileForAnswers,
                forceRebuild
            });

            this.answeringContextJson = JSON.stringify(ctx, null, 2);
            this.answeringContextJsonError = undefined;
            this.answeringContextOverride = ctx;
            this.update();
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Erreur inconnue';
            this.answeringContextJsonError = message;
            this.update();
        }
    }

    protected parseAnsweringContextOverrideFromJson(): void {
        const raw = (this.answeringContextJson || '').trim();
        if (!raw) {
            this.answeringContextOverride = undefined;
            this.answeringContextJsonError = undefined;
            return;
        }

        try {
            const parsed = JSON.parse(raw) as PreparedAnsweringContext;
            if (!parsed || typeof parsed !== 'object') {
                throw new Error('JSON invalide');
            }
            if (typeof (parsed as any).geocache_summary !== 'string') {
                throw new Error('Champ manquant: geocache_summary (string)');
            }
            if (!Array.isArray((parsed as any).global_rules)) {
                throw new Error('Champ manquant: global_rules (array)');
            }
            if (!(parsed as any).per_letter_rules || typeof (parsed as any).per_letter_rules !== 'object') {
                throw new Error('Champ manquant: per_letter_rules (object)');
            }

            this.answeringContextOverride = parsed;
            this.answeringContextJsonError = undefined;
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Erreur inconnue';
            this.answeringContextJsonError = message;
        }
    }

    protected async answerAllQuestions(options?: { overwrite?: boolean }): Promise<void> {
        const overwrite = Boolean(options?.overwrite);

        if (this.answersEngine === 'backend-web-search' && !this.webSearchEnabled) {
            this.messageService.warn('La recherche web est désactivée dans les préférences.');
            return;
        }

        const questionsByLetter = this.getQuestionsByLetter();
        if (questionsByLetter.size === 0) {
            this.messageService.warn('Aucune question à résoudre.');
            return;
        }

        // Si le mode est 'manual', utiliser 'ai-per-question' par défaut pour le bulk
        const effectiveMode = this.stepConfig.answersMode === 'manual' ? 'ai-per-question' : this.stepConfig.answersMode;

        this.isAnsweringLoading = true;
        this.updateState({ loading: true, error: undefined });
        try {
            const allQuestionsByLetter = this.getQuestionsByLetter();

            // Callback pour mise à jour progressive (streaming)
            const onAnswer = effectiveMode === 'ai-per-question' ? (letter: string, answer: string, detail: AnswerDetail) => {
                // Mettre à jour le détail
                this.answerDetails.set(letter, detail);

                // Mettre à jour la valeur si on doit la remplir
                const existing = this.state.values.get(letter);
                const shouldFill = overwrite || !existing || !existing.rawValue || existing.rawValue.trim() === '';
                if (shouldFill && answer && answer.trim()) {
                    const aiValueType = detail.valueType;
                    const type = aiValueType || existing?.type || this.globalValueType;
                    this.updateValue(letter, answer, type);
                }
            } : undefined;

            const result = await this.pipeline.answerQuestions({
                text: this.state.text || '',
                questionsByLetter,
                allQuestionsByLetter,
                geocacheId: this.state.geocacheId,
                geocacheTitle: this.state.geocacheName,
                geocacheCode: this.state.gcCode,
                preparedContextOverride: this.answeringContextUseOverride ? this.answeringContextOverride : undefined,
                additionalInstructions: this.answeringAdditionalInstructions,
                perLetterExtraInfo: Object.fromEntries(this.perLetterExtraInfo.entries()),
                mode: effectiveMode,
                engine: this.answersEngine,
                aiProfile: this.stepConfig.aiProfileForAnswers,
                perQuestionProfile: this.perQuestionProfiles,
                webMaxResults: this.webMaxResults,
                webContext: (this.state.text || '').substring(0, 200),
                onAnswer
            });

            // Store answer details (pour les modes non-streaming)
            if (result.detailsByLetter && effectiveMode !== 'ai-per-question') {
                result.detailsByLetter.forEach((detail, letter) => {
                    this.answerDetails.set(letter, detail);
                });
            }

            // Mettre à jour les valeurs (pour les modes non-streaming, car en streaming c'est déjà fait)
            if (effectiveMode !== 'ai-per-question') {
                result.answersByLetter.forEach((answer, letter) => {
                    const existing = this.state.values.get(letter);
                    const shouldFill = overwrite || !existing || !existing.rawValue || existing.rawValue.trim() === '';
                    if (!shouldFill) {
                        return;
                    }

                    if (answer && answer.trim()) {
                        // Use valueType from AI if available
                        const aiValueType = result.detailsByLetter?.get(letter)?.valueType;
                        const type = aiValueType || existing?.type || this.globalValueType;
                        this.updateValue(letter, answer, type);
                    }
                });
            }

            const filled = Array.from(result.answersByLetter.values()).filter(v => v && v.trim()).length;
            this.messageService.info(`Réponses obtenues: ${filled}/${questionsByLetter.size}`);
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Erreur inconnue';
            console.error('[FORMULA-SOLVER] Erreur answerAllQuestions:', error);
            this.messageService.error(`Erreur réponses: ${message}`);
            this.updateState({ error: message });
        } finally {
            this.isAnsweringLoading = false;
            this.updateState({ loading: false });
        }
    }

    protected async answerSingleQuestion(letter: string, options?: { overwrite?: boolean; engine?: AnswersEngine }): Promise<void> {
        const overwrite = Boolean(options?.overwrite);
        const effectiveEngine = options?.engine || this.answersEngine;
        const question = this.state.questions.find(q => q.letter === letter)?.question || '';
        if (!question) {
            this.messageService.warn('Aucune question à résoudre pour cette lettre.');
            return;
        }

        if (effectiveEngine === 'backend-web-search' && !this.webSearchEnabled) {
            this.messageService.warn('La recherche web est désactivée dans les préférences.');
            return;
        }

        this.loadingLetters.add(letter);
        this.update();
        try {
            const questionsByLetter = new Map<string, string>([[letter, question]]);
            const allQuestionsByLetter = this.getQuestionsByLetter();
            const result = await this.pipeline.answerQuestions({
                text: this.state.text || '',
                questionsByLetter,
                allQuestionsByLetter,
                geocacheId: this.state.geocacheId,
                geocacheTitle: this.state.geocacheName,
                geocacheCode: this.state.gcCode,
                preparedContextOverride: this.answeringContextUseOverride ? this.answeringContextOverride : undefined,
                additionalInstructions: this.answeringAdditionalInstructions,
                perLetterExtraInfo: Object.fromEntries(this.perLetterExtraInfo.entries()),
                mode: 'ai-per-question',
                engine: effectiveEngine,
                aiProfile: this.stepConfig.aiProfileForAnswers,
                perQuestionProfile: this.perQuestionProfiles,
                webMaxResults: this.webMaxResults,
                webContext: (this.state.text || '').substring(0, 200)
            });

            const answer = result.answersByLetter.get(letter) || '';
            const existing = this.state.values.get(letter);
            const shouldFill = overwrite || !existing || !existing.rawValue || existing.rawValue.trim() === '';

            // Store answer detail
            const detail = result.detailsByLetter?.get(letter);
            if (detail) {
                this.answerDetails.set(letter, detail);
            }

            if (shouldFill && answer.trim()) {
                // Use valueType from AI if available, otherwise keep existing type
                const aiValueType = detail?.valueType;
                const type = aiValueType || existing?.type || this.globalValueType;
                this.updateValue(letter, answer, type);
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Erreur inconnue';
            console.error('[FORMULA-SOLVER] Erreur answerSingleQuestion:', error);
            this.messageService.error(`Erreur réponse: ${message}`);
            this.updateState({ error: message });
        } finally {
            this.loadingLetters.delete(letter);
            this.update();
        }
    }

    /**
     * Tente un calcul automatique si toutes les lettres sont remplies
     */
    protected tryAutoCalculate(): void {
        if (!this.state.selectedFormula) {
            return;
        }

        // Vérifier que toutes les valeurs sont renseignées
        const letters = this.extractLettersFromFormula(this.state.selectedFormula);
        const missingValues = letters.filter(letter => !this.state.values.has(letter));
        
        if (missingValues.length === 0) {
            // Toutes les lettres sont remplies, calculer automatiquement
            console.log('[FORMULA-SOLVER] Toutes les lettres sont remplies, calcul automatique...');
            this.calculateCoordinates();
        }
    }

    /**
     * Calcule les coordonnées finales
     */
    protected async calculateCoordinates(): Promise<void> {
        if (!this.state.selectedFormula) {
            return;
        }

        // Vérifier que toutes les valeurs sont renseignées
        const letters = this.extractLettersFromFormula(this.state.selectedFormula);
        const missingValues = letters.filter(letter => !this.state.values.has(letter));
        
        if (missingValues.length > 0) {
            // Mode silencieux : ne pas afficher de warning, c'est normal en cours de saisie
            return;
        }

        this.updateState({ loading: true, error: undefined });

        try {
            // Construire l'objet values
            const values: Record<string, number> = {};
        this.state.values.forEach((letterValue: LetterValue, letter: string) => {
            values[letter] = letterValue.value;
        });

            // Appeler l'API
            const result = await this.formulaSolverService.calculateCoordinates({
                northFormula: this.state.selectedFormula.north,
                eastFormula: this.state.selectedFormula.east,
                values
            });

            if (result.status === 'success') {
                this.messageService.info('Coordonnées calculées avec succès !');
                this.updateState({
                    loading: false,
                    result,
                    currentStep: 'calculate'
                });
                
                // Afficher automatiquement le point sur la carte
                this.showOnMap();
            } else {
                throw new Error(result.error || 'Erreur lors du calcul');
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Erreur inconnue';
            this.messageService.error(`Erreur : ${message}`);
        }
    }

    /**
     * Exécute le brute force depuis une liste de combinaisons prédéfinies
     */
    protected async executeBruteForceFromCombinations(combinations: Array<Record<string, number>>): Promise<void> {
        if (!this.state.selectedFormula) {
            this.messageService.error('Aucune formule sélectionnée');
            return;
        }

        if (combinations.length === 0) {
            this.messageService.warn('Aucune combinaison à tester');
            return;
        }

        if (combinations.length > 1000) {
            this.messageService.warn(`${combinations.length} combinaisons détectées. Limité à 1000 pour éviter les calculs trop longs.`);
            combinations = combinations.slice(0, 1000);
        }

        this.bruteForceMode = true;
        this.bruteForceResults = [];
        this.updateState({ loading: true, error: undefined });

        this.messageService.info(`Calcul de ${combinations.length} combinaisons...`);

        try {
            const results: Array<{ id: string; label: string; values: Record<string, number>; coordinates?: any }> = [];

            // Calculer chaque combinaison
            for (const combination of combinations) {
                try {
                    const result = await this.formulaSolverService.calculateCoordinates({
                        northFormula: this.state.selectedFormula.north,
                        eastFormula: this.state.selectedFormula.east,
                        values: combination
                    });

                    if (result.status === 'success' && result.coordinates) {
                        // Générer un ID unique basé sur les valeurs
                        const id = Object.entries(combination)
                            .map(([k, v]) => `${k}${v}`)
                            .join('-');

                        const label = `Solution ${results.length + 1}`;

                        results.push({
                            id,
                            label,
                            values: combination,
                            coordinates: result.coordinates
                        });
                    }
                } catch (error) {
                    // Ignorer les erreurs de calcul individuelles
                    console.warn('[FORMULA-SOLVER] Erreur pour combinaison', combination, error);
                }
            }

            this.bruteForceResults = results;
            this.updateState({ loading: false });

            // Afficher tous les points sur la carte (uniquement ceux avec coordonnées)
            const validResults = results.filter((r): r is { id: string; label: string; values: Record<string, number>; coordinates: any } =>
                r.coordinates !== undefined
            );
            this.showAllResultsOnMap(validResults);

            this.messageService.info(
                `${results.length} résultat${results.length > 1 ? 's' : ''} calculé${results.length > 1 ? 's' : ''} avec succès !`
            );

        } catch (error) {
            const message = error instanceof Error ? error.message : 'Erreur inconnue';
            this.messageService.error(`Erreur brute force : ${message}`);
            this.updateState({ loading: false, error: message });
        }
    }

    /**
     * Exécute le brute force automatiquement depuis les champs remplis
     */
    protected async executeBruteForceFromFields(): Promise<void> {
        if (!this.state.selectedFormula) {
            this.messageService.error('Aucune formule sélectionnée');
            return;
        }

        // Générer les combinaisons depuis les valeurs des champs
        const letterValuesMap: Record<string, number[]> = {};
        
        for (const [letter, letterValue] of this.state.values.entries()) {
            if (letterValue.values && letterValue.values.length > 0) {
                // Utiliser la liste de valeurs
                letterValuesMap[letter] = letterValue.values;
            } else if (letterValue.value !== undefined && !isNaN(letterValue.value)) {
                // Utiliser la valeur unique
                letterValuesMap[letter] = [letterValue.value];
            }
        }

        const combinations = this.generateCombinations(letterValuesMap);
        
        if (combinations.length === 0) {
            this.messageService.warn('Aucune combinaison à tester');
            return;
        }

        if (combinations.length > 1000) {
            this.messageService.warn(`${combinations.length} combinaisons détectées. Limité à 1000 pour éviter les calculs trop longs.`);
            combinations.splice(1000);
        }

        this.bruteForceMode = true;
        this.bruteForceResults = [];
        this.updateState({ loading: true, error: undefined });

        this.messageService.info(`Calcul de ${combinations.length} combinaisons...`);

        try {
            const results: Array<{ id: string; label: string; values: Record<string, number>; coordinates?: any }> = [];

            // Calculer chaque combinaison
            for (const combination of combinations) {
                try {
                    const result = await this.formulaSolverService.calculateCoordinates({
                        northFormula: this.state.selectedFormula.north,
                        eastFormula: this.state.selectedFormula.east,
                        values: combination
                    });

                    if (result.status === 'success' && result.coordinates) {
                        // Générer un ID unique basé sur les valeurs
                        const id = Object.entries(combination)
                            .map(([k, v]) => `${k}${v}`)
                            .join('-');
                        
                        const label = `Solution ${results.length + 1}`;

                        results.push({
                            id,
                            label,
                            values: combination,
                            coordinates: result.coordinates
                        });
                    }
                } catch (error) {
                    // Ignorer les erreurs de calcul individuelles
                    console.warn('[FORMULA-SOLVER] Erreur pour combinaison', combination, error);
                }
            }

            this.bruteForceResults = results;
            this.updateState({ loading: false });

            // Afficher tous les points sur la carte (uniquement ceux avec coordonnées)
            const validResults = results.filter((r): r is { id: string; label: string; values: Record<string, number>; coordinates: any } => 
                r.coordinates !== undefined
            );
            this.showAllResultsOnMap(validResults);

            this.messageService.info(
                `${results.length} résultat${results.length > 1 ? 's' : ''} calculé${results.length > 1 ? 's' : ''} avec succès !`
            );

        } catch (error) {
            const message = error instanceof Error ? error.message : 'Erreur inconnue';
            this.messageService.error(`Erreur brute force : ${message}`);
            this.updateState({ loading: false, error: message });
        }
    }

    /**
     * Génère toutes les combinaisons possibles à partir d'un mapping de valeurs
     */
    protected generateCombinations(letterValuesMap: Record<string, number[]>): Record<string, number>[] {
        const letters = Object.keys(letterValuesMap);
        
        if (letters.length === 0) {
            return [];
        }

        const combinations: Record<string, number>[] = [];
        
        const generate = (index: number, current: Record<string, number>) => {
            if (index === letters.length) {
                combinations.push({ ...current });
                return;
            }

            const letter = letters[index];
            const values = letterValuesMap[letter];

            for (const value of values) {
                current[letter] = value;
                generate(index + 1, current);
            }
        };

        generate(0, {});
        return combinations;
    }

    /**
     * Supprime un résultat brute force spécifique
     */
    protected removeBruteForceResult(resultId: string): void {
        console.log('[FORMULA-SOLVER] Suppression du résultat', resultId);
        
        // Retirer du tableau
        this.bruteForceResults = this.bruteForceResults.filter(r => r.id !== resultId);
        
        // Émettre l'événement de suppression pour synchroniser la carte
        window.dispatchEvent(new CustomEvent('geoapp-map-remove-brute-force-point', {
            detail: { bruteForceId: resultId }
        }));
        
        if (this.bruteForceResults.length === 0) {
            // Plus de résultats, quitter le mode brute force
            this.bruteForceMode = false;
            window.dispatchEvent(new CustomEvent('geoapp-map-highlight-clear'));
        }
        
        this.update();
        this.messageService.info('Résultat supprimé');
    }

    private handleExternalBruteForceRemoval = (event: Event): void => {
        if (!this.bruteForceMode || this.bruteForceResults.length === 0) {
            return;
        }

        const customEvent = event as CustomEvent<{ bruteForceId?: string }>;
        const bruteForceId = customEvent.detail?.bruteForceId;

        if (!bruteForceId) {
            return;
        }

        if (!this.bruteForceResults.some(result => result.id === bruteForceId)) {
            return;
        }

        console.log('[FORMULA-SOLVER] Résultat supprimé depuis la carte', bruteForceId);
        this.bruteForceResults = this.bruteForceResults.filter(result => result.id !== bruteForceId);

        if (this.bruteForceResults.length === 0) {
            this.bruteForceMode = false;
        }

        this.update();
        this.messageService.info('Résultat supprimé depuis la carte');
    };

    /**
     * Affiche tous les résultats du brute force sur la carte
     */
    protected showAllResultsOnMap(results: Array<{ id: string; label: string; values: Record<string, number>; coordinates: any }>): void {
        console.log('[FORMULA-SOLVER] Affichage de', results.length, 'résultats sur la carte');

        // Effacer les points précédents
        window.dispatchEvent(new CustomEvent('geoapp-map-highlight-clear'));

        // Ajouter chaque point
        results.forEach(result => {
            const coords = result.coordinates;
            const valuesText = Object.entries(result.values)
                .map(([letter, value]) => `${letter}=${value}`)
                .join(', ');

            window.dispatchEvent(new CustomEvent('geoapp-map-highlight-coordinate', {
                detail: {
                    gcCode: this.state.gcCode,
                    pluginName: 'Formula Solver (Brute Force)',
                    coordinates: {
                        latitude: coords.latitude,
                        longitude: coords.longitude,
                        formatted: coords.ddm
                    },
                    waypointTitle: result.label,
                    waypointNote: `Valeurs: ${valuesText}\n\nCoordonnées:\n${coords.ddm}`,
                    sourceResultText: coords.ddm,
                    replaceExisting: false, // Ajouter sans remplacer
                    bruteForceId: result.id // ID pour la suppression
                }
            }));
        });
    }

    /**
     * Extrait les lettres (variables) d'une formule
     * Ignore uniquement les lettres cardinales (N, S, E, W) en début de coordonnées
     */
    protected extractLettersFromFormula(formula: Formula): string[] {
        // Supprimer les directions cardinales au début de chaque partie
        // Ex: "N 48°AB.CDE" -> "48°AB.CDE", "E 007°FG.HIJ" -> "007°FG.HIJ"
        const northCleaned = formula.north.replace(/^[NSEW]\s*/i, '');
        const eastCleaned = formula.east.replace(/^[NSEW]\s*/i, '');
        const text = `${northCleaned} ${eastCleaned}`;
        
        const letters = new Set<string>();
        
        // Extraire toutes les lettres A-Z maintenant que les directions sont retirées
        const matches = text.matchAll(/([A-Z])/g);
        for (const match of matches) {
            letters.add(match[1]);
        }
        
        console.log('[FORMULA-SOLVER] Lettres extraites:', {
            north: formula.north,
            east: formula.east,
            northCleaned,
            eastCleaned,
            letters: Array.from(letters).sort()
        });
        
        return Array.from(letters).sort();
    }

    /**
     * Met à jour la valeur d'une variable
     */
    protected updateValue(letter: string, rawValue: string, type: 'value' | 'checksum' | 'reduced' | 'length' | 'custom'): void {
        console.log(`[FORMULA-SOLVER] updateValue: ${letter} = "${rawValue}" (type: ${type})`);

        // Parser la valeur pour détecter les listes (ex: "2,3,4" ou "1-5")
        const parsed = parseValueList(rawValue);
        console.log(`[FORMULA-SOLVER] Parsed values:`, parsed.values);

        // Calculer la valeur pour le premier élément (ou appliquer le calcul sur la chaîne brute)
        let calculatedValue: number = 0;
        let calculatedValues: number[] = [];

        if (parsed.values.length > 0) {
            // Il y a des valeurs numériques parsées (nombres ou listes)
            console.log(`[FORMULA-SOLVER] Using parsed numeric values`);
            for (const val of parsed.values) {
                let calculated: number;
                const strVal = val.toString();

                switch (type) {
                    case 'checksum':
                        calculated = this.formulaSolverService.calculateChecksum(strVal);
                        break;
                    case 'reduced':
                        calculated = this.formulaSolverService.calculateReducedChecksum(strVal);
                        break;
                    case 'length':
                        calculated = this.formulaSolverService.calculateLength(strVal);
                        break;
                    case 'custom':
                    case 'value':
                    default:
                        calculated = val;
                        break;
                }

                calculatedValues.push(calculated);
            }

            calculatedValue = calculatedValues[0];
        } else if (rawValue.trim() && (type === 'checksum' || type === 'reduced' || type === 'length')) {
            // Pas de valeurs numériques parsées, mais on a du texte et un type qui travaille sur du texte
            console.log(`[FORMULA-SOLVER] Applying ${type} calculation on raw text: "${rawValue}"`);

            switch (type) {
                case 'checksum':
                    calculatedValue = this.formulaSolverService.calculateChecksum(rawValue.trim());
                    break;
                case 'reduced':
                    calculatedValue = this.formulaSolverService.calculateReducedChecksum(rawValue.trim());
                    break;
                case 'length':
                    calculatedValue = this.formulaSolverService.calculateLength(rawValue.trim());
                    break;
                default:
                    calculatedValue = 0;
                    break;
            }

            calculatedValues = [calculatedValue];
        } else {
            // Valeur vide ou type 'value' sans contenu parsable
            console.log(`[FORMULA-SOLVER] No calculation applied`);
            calculatedValue = 0;
            calculatedValues = [];
        }

        console.log(`[FORMULA-SOLVER] Final calculated value: ${calculatedValue}`);

        const letterValue: LetterValue = {
            letter,
            rawValue,
            value: calculatedValue,
            type,
            values: calculatedValues.length > 0 ? calculatedValues : undefined,
            isList: parsed.isList
        };

        const nextValues = new Map(this.state.values);
        nextValues.set(letter, letterValue);
        this.updateState({ values: nextValues });

        // Mise à jour overlay preview sur la carte (si activé)
        this.updateMapPreviewOverlay(nextValues);
        
        // Déclencher le calcul automatique ou brute force si applicable
        this.tryAutoCalculateOrBruteForce();
    }

    /**
     * Tente un calcul automatique simple ou lance le brute force si des listes sont détectées
     */
    protected tryAutoCalculateOrBruteForce(): void {
        // Vérifier si tous les champs sont remplis
        const allFilled = this.state.questions.every((q: Question) => {
            const val = this.state.values.get(q.letter);
            return val && val.rawValue.trim() !== '';
        });
        
        if (!allFilled) {
            return;
        }
        
        // Vérifier si au moins un champ contient une liste
        const hasLists = Array.from(this.state.values.values()).some((v: LetterValue) => !!v.isList);
        
        if (hasLists) {
            // Brute force automatique
            console.log('[FORMULA-SOLVER] Listes détectées, déclenchement automatique du brute force');
            this.executeBruteForceFromFields();
        } else {
            // Calcul simple
            this.tryAutoCalculate();
        }
    }

    /**
     * Render du composant React
     */
    protected render(): React.ReactNode {
        return (
            <div className='formula-solver-container' style={{ padding: '20px', height: '100%', overflow: 'auto' }}>
                <style>{`
                    @keyframes formula-solver-spin {
                        from { transform: rotate(0deg); }
                        to { transform: rotate(360deg); }
                    }
                    .formula-solver-spinner {
                        display: inline-block;
                        width: 16px;
                        height: 16px;
                        border: 2px solid var(--theia-foreground);
                        border-top-color: transparent;
                        border-radius: 50%;
                        animation: formula-solver-spin 0.8s linear infinite;
                        margin: 0 6px;
                    }
                `}</style>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                    <h2 style={{ marginTop: 0, marginBottom: 0 }}>Formula Solver</h2>
                    
                    {/* Configuration des étapes (méthodes + profils) */}
                    {this.renderStepConfigPanel()}
                </div>
                
                {/* Étape 1 : Détection de formule */}
                {this.renderDetectionStep()}
                
                {/* Étape 2 : Questions et valeurs */}
                {this.state.currentStep !== 'detect' && this.renderQuestionsStep()}
                
                {/* Étape 3 : Calcul automatique des coordonnées */}
                {this.state.questions.length > 0 && this.renderCalculateStep()}
                
                {/* État de chargement */}
                {this.state.loading && (
                    <div style={{ textAlign: 'center', marginTop: '20px' }}>
                        <span className='theia-animation-spin codicon codicon-loading'></span>
                        <span style={{ marginLeft: '10px' }}>Chargement...</span>
                    </div>
                )}
                
                {/* Message d'erreur */}
                {this.state.error && (
                    <div style={{ color: 'var(--theia-errorForeground)', marginTop: '10px', padding: '10px', backgroundColor: 'var(--theia-inputValidation-errorBackground)' }}>
                        ⚠️ {this.state.error}
                    </div>
                )}
            </div>
        );
    }

    /**
     * Render du panneau de configuration des étapes (méthodes + profils)
     */
    protected renderStepConfigPanel(): React.ReactNode {
        const profileOptions: Array<{ id: FormulaSolverAiProfile; label: string }> = [
            { id: 'local', label: 'Local (LMStudio/Ollama)' },
            { id: 'fast', label: 'Fast' },
            { id: 'strong', label: 'Strong' },
            { id: 'web', label: 'Web' }
        ];

        const selectStyle: React.CSSProperties = {
            padding: '6px 8px',
            border: '1px solid var(--theia-dropdown-border)',
            borderRadius: '3px',
            backgroundColor: 'var(--theia-dropdown-background)',
            color: 'var(--theia-dropdown-foreground)',
            fontSize: '12px'
        };

        if (!this.stepConfigPanelOpen) {
            return (
                <button
                    style={{
                        padding: '6px 10px',
                        backgroundColor: 'var(--theia-button-secondaryBackground)',
                        color: 'var(--theia-button-secondaryForeground)',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        fontSize: '12px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px'
                    }}
                    onClick={() => {
                        this.stepConfigPanelOpen = true;
                        this.update();
                    }}
                    title="Afficher les options (méthodes / profils IA)"
                >
                    <span className="codicon codicon-settings-gear" />
                    Options IA
                </button>
            );
        }

        return (
            <div style={{
                display: 'flex',
                alignItems: 'stretch',
                gap: '10px',
                flexWrap: 'wrap'
            }}>
                <button
                    style={{
                        padding: '6px 10px',
                        backgroundColor: 'transparent',
                        color: 'var(--theia-foreground)',
                        border: '1px solid var(--theia-panel-border)',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        fontSize: '12px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px'
                    }}
                    onClick={() => {
                        this.stepConfigPanelOpen = false;
                        this.update();
                    }}
                    title="Replier les options"
                >
                    <span className="codicon codicon-chevron-up" />
                    Replier
                </button>

                <div style={{
                    display: 'flex',
                    gap: '10px',
                    padding: '10px',
                    border: '1px solid var(--theia-panel-border)',
                    borderRadius: '6px',
                    backgroundColor: 'var(--theia-editor-background)',
                    alignItems: 'center',
                    flexWrap: 'wrap'
                }}>
                    <strong style={{ fontSize: '12px' }}>Formule</strong>
                    <select
                        style={selectStyle}
                        value={this.stepConfig.formulaDetectionMethod}
                        onChange={e => {
                            this.stepConfig = { ...this.stepConfig, formulaDetectionMethod: e.target.value as FormulaDetectionMethod };
                            this.update();
                        }}
                        title="Méthode de l'étape Formule"
                    >
                        <option value="algorithm">Algorithme</option>
                        <option value="ai">IA</option>
                        <option value="manual">Manuel</option>
                    </select>
                    <select
                        style={selectStyle}
                        value={this.stepConfig.aiProfileForFormula}
                        onChange={e => {
                            this.stepConfig = { ...this.stepConfig, aiProfileForFormula: e.target.value as FormulaSolverAiProfile };
                            this.update();
                        }}
                        disabled={this.stepConfig.formulaDetectionMethod !== 'ai'}
                        title="Profil IA pour l'étape Formule"
                    >
                        {profileOptions.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                    </select>
                </div>

                <div style={{
                    display: 'flex',
                    gap: '10px',
                    padding: '10px',
                    border: '1px solid var(--theia-panel-border)',
                    borderRadius: '6px',
                    backgroundColor: 'var(--theia-editor-background)',
                    alignItems: 'center',
                    flexWrap: 'wrap'
                }}>
                    <strong style={{ fontSize: '12px' }}>Questions</strong>
                    <select
                        style={selectStyle}
                        value={this.stepConfig.questionsMethod}
                        onChange={e => {
                            this.stepConfig = { ...this.stepConfig, questionsMethod: e.target.value as QuestionsMethod };
                            this.update();
                        }}
                        title="Méthode de l'étape Questions"
                    >
                        <option value="algorithm">Algorithme</option>
                        <option value="ai">IA</option>
                        <option value="none">Aucune</option>
                    </select>
                    <select
                        style={selectStyle}
                        value={this.stepConfig.aiProfileForQuestions}
                        onChange={e => {
                            this.stepConfig = { ...this.stepConfig, aiProfileForQuestions: e.target.value as FormulaSolverAiProfile };
                            this.update();
                        }}
                        disabled={this.stepConfig.questionsMethod !== 'ai'}
                        title="Profil IA pour l'étape Questions"
                    >
                        {profileOptions.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                    </select>
                </div>

                <div style={{
                    display: 'flex',
                    gap: '10px',
                    padding: '10px',
                    border: '1px solid var(--theia-panel-border)',
                    borderRadius: '6px',
                    backgroundColor: 'var(--theia-editor-background)',
                    alignItems: 'center',
                    flexWrap: 'wrap'
                }}>
                    <strong style={{ fontSize: '12px' }}>Réponses</strong>
                    <select
                        style={selectStyle}
                        value={this.stepConfig.answersMode}
                        onChange={e => {
                            this.stepConfig = { ...this.stepConfig, answersMode: e.target.value as AnswersMode };
                            this.update();
                        }}
                        title="Mode de l'étape Réponses"
                    >
                        <option value="manual">Manuel</option>
                        <option value="ai-bulk">IA (en masse)</option>
                        <option value="ai-per-question">IA (par question)</option>
                    </select>
                    <select
                        style={selectStyle}
                        value={this.answersEngine}
                        onChange={e => {
                            this.answersEngine = e.target.value as AnswersEngine;
                            this.update();
                        }}
                        disabled={this.stepConfig.answersMode === 'manual'}
                        title="Moteur de réponse (IA ou recherche web backend)"
                    >
                        <option value="ai">IA</option>
                        <option value="backend-web-search">Recherche web (backend)</option>
                    </select>
                    <select
                        style={selectStyle}
                        value={this.stepConfig.aiProfileForAnswers}
                        onChange={e => {
                            this.stepConfig = { ...this.stepConfig, aiProfileForAnswers: e.target.value as FormulaSolverAiProfile };
                            this.update();
                        }}
                        disabled={this.stepConfig.answersMode === 'manual' || this.answersEngine !== 'ai'}
                        title="Profil IA pour l'étape Réponses"
                    >
                        {profileOptions.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                    </select>

                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px' }}>
                        <input
                            type="checkbox"
                            checked={this.webSearchEnabled}
                            onChange={e => {
                                this.webSearchEnabled = e.target.checked;
                                this.update();
                            }}
                        />
                        Web
                    </label>
                    <input
                        type="number"
                        min={1}
                        max={10}
                        value={this.webMaxResults}
                        onChange={e => {
                            const parsed = parseInt(e.target.value, 10);
                            this.webMaxResults = isNaN(parsed) ? 5 : Math.max(1, Math.min(10, parsed));
                            this.update();
                        }}
                        style={{ ...selectStyle, width: '70px' }}
                        title="Nombre max de résultats web"
                        disabled={!this.webSearchEnabled}
                    />
                </div>

                <button
                    style={{
                        padding: '10px 12px',
                        borderRadius: '6px',
                        border: '1px solid var(--theia-panel-border)',
                        backgroundColor: 'var(--theia-button-secondaryBackground)',
                        color: 'var(--theia-button-secondaryForeground)',
                        cursor: 'pointer',
                        fontSize: '12px'
                    }}
                    onClick={() => void this.saveCurrentConfigAsDefault()}
                    title="Enregistre ces choix comme comportement par défaut (préférences)."
                >
                    Sauver comme défaut
                </button>
            </div>
        );
    }

    protected async saveCurrentConfigAsDefault(): Promise<void> {
        try {
            await this.preferenceService.set('geoApp.formulaSolver.formulaDetection.defaultMethod', this.stepConfig.formulaDetectionMethod, PreferenceScope.User);
            await this.preferenceService.set('geoApp.formulaSolver.questions.defaultMethod', this.stepConfig.questionsMethod, PreferenceScope.User);
            await this.preferenceService.set('geoApp.formulaSolver.answers.defaultMode', this.stepConfig.answersMode, PreferenceScope.User);
            await this.preferenceService.set('geoApp.formulaSolver.ai.defaultProfile.formulaDetection', this.stepConfig.aiProfileForFormula, PreferenceScope.User);
            await this.preferenceService.set('geoApp.formulaSolver.ai.defaultProfile.questions', this.stepConfig.aiProfileForQuestions, PreferenceScope.User);
            await this.preferenceService.set('geoApp.formulaSolver.ai.defaultProfile.answers', this.stepConfig.aiProfileForAnswers, PreferenceScope.User);
            await this.preferenceService.set('geoApp.formulaSolver.ai.webSearchEnabled', this.webSearchEnabled, PreferenceScope.User);
            await this.preferenceService.set('geoApp.formulaSolver.ai.maxWebResults', this.webMaxResults, PreferenceScope.User);
            this.messageService.info('Préférences Formula Solver sauvegardées.');
        } catch (error) {
            console.error('[FORMULA-SOLVER] Erreur sauvegarde préférences:', error);
            this.messageService.error('Impossible de sauvegarder les préférences Formula Solver.');
        }
    }

    protected renderDetectionStep(): React.ReactNode {
        return (
            <div className='detection-step' style={{ marginBottom: '20px' }}>
                <h3>1. Détecter la formule</h3>
                <textarea
                    placeholder='Collez ici la description de la géocache ou la formule directement...'
                    style={{
                        width: '100%',
                        minHeight: '100px',
                        padding: '10px',
                        fontFamily: 'monospace',
                        backgroundColor: 'var(--theia-input-background)',
                        color: 'var(--theia-input-foreground)',
                        border: '1px solid var(--theia-input-border)',
                        borderRadius: '4px'
                    }}
                    onChange={e => this.updateState({ text: e.target.value })}
                    value={this.state.text || ''}
                />
                <button
                    style={{
                        marginTop: '10px',
                        padding: '8px 16px',
                        backgroundColor: 'var(--theia-button-background)',
                        color: 'var(--theia-button-foreground)',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: 'pointer'
                    }}
                    onClick={() => this.detectFormulasFromText(this.state.text || '')}
                    disabled={this.state.loading}
                >
                    Détecter la formule
                </button>

                <div style={{
                    marginTop: '12px',
                    padding: '12px',
                    backgroundColor: 'var(--theia-editor-background)',
                    border: '1px solid var(--theia-panel-border)',
                    borderRadius: '4px'
                }}>
                    <button
                        style={{
                            width: '100%',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: 0,
                            background: 'transparent',
                            border: 'none',
                            color: 'var(--theia-foreground)',
                            cursor: 'pointer',
                            fontWeight: 'bold'
                        }}
                        onClick={() => {
                            this.manualFormulaOpen = !this.manualFormulaOpen;
                            this.update();
                        }}
                        title={this.manualFormulaOpen ? 'Replier' : 'Déplier'}
                    >
                        <span>Formule manuelle</span>
                        <span className={`codicon ${this.manualFormulaOpen ? 'codicon-chevron-down' : 'codicon-chevron-right'}`} />
                    </button>

                    {this.manualFormulaOpen && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '8px' }}>
                            <input
                                type="text"
                                placeholder="Nord (ex: N48°45.B(A+E)(D+C)) ou collez 2 lignes N... puis E..."
                                value={this.manualNorth}
                                onChange={e => {
                                    this.manualNorth = e.target.value;
                                    this.update();
                                }}
                                style={{
                                    width: '100%',
                                    padding: '8px 10px',
                                    fontFamily: 'monospace',
                                    backgroundColor: 'var(--theia-input-background)',
                                    color: 'var(--theia-input-foreground)',
                                    border: '1px solid var(--theia-input-border)',
                                    borderRadius: '4px'
                                }}
                            />
                            <input
                                type="text"
                                placeholder="Est (ex: E002°43.C(F+C)D)"
                                value={this.manualEast}
                                onChange={e => {
                                    this.manualEast = e.target.value;
                                    this.update();
                                }}
                                style={{
                                    width: '100%',
                                    padding: '8px 10px',
                                    fontFamily: 'monospace',
                                    backgroundColor: 'var(--theia-input-background)',
                                    color: 'var(--theia-input-foreground)',
                                    border: '1px solid var(--theia-input-border)',
                                    borderRadius: '4px'
                                }}
                            />
                            <div style={{ display: 'flex', gap: '8px' }}>
                                <button
                                    style={{
                                        padding: '8px 16px',
                                        backgroundColor: 'var(--theia-button-background)',
                                        color: 'var(--theia-button-foreground)',
                                        border: 'none',
                                        borderRadius: '4px',
                                        cursor: 'pointer'
                                    }}
                                    onClick={() => void this.addManualFormula()}
                                    disabled={this.state.loading}
                                    title="Ajoute la formule à la liste et passe à l'étape Questions"
                                >
                                    Ajouter la formule
                                </button>
                            </div>
                        </div>
                    )}
                </div>
                
                {/* Formules détectées avec le nouveau composant */}
                {this.state.formulas.length > 0 && (
                    <DetectedFormulasComponent
                        formulas={this.state.formulas}
                        selectedFormula={this.state.selectedFormula}
                        onSelect={(formula) => {
                            this.updateState({
                                selectedFormula: formula,
                                questions: [],
                                values: new Map<string, LetterValue>(),
                                result: undefined,
                                currentStep: 'questions'
                            });
                            this.updateMapPreviewOverlay(new Map());
                            void this.extractQuestions(formula);
                        }}
                        onEditFormula={(formula, north, east) => this.handleEditFormula(formula, north, east)}
                        loading={this.state.loading}
                    />
                )}
            </div>
        );
    }

    protected renderQuestionsStep(): React.ReactNode {
        if (!this.state.selectedFormula) return null;
        const previewSuspects = this.getPreviewSuspectLetters();

        return (
            <div className='questions-step' style={{ marginBottom: '20px' }}>
                <h3>2. Questions pour les variables</h3>
                
                <div style={{
                    padding: '20px',
                    backgroundColor: 'var(--theia-editor-background)',
                    border: '1px solid var(--theia-panel-border)',
                    borderRadius: '4px',
                    marginBottom: '20px'
                }}>
                    <h3 style={{ marginTop: 0 }}>2. Questions pour les variables</h3>

                    <div style={{
                        display: 'flex',
                        gap: '8px',
                        flexWrap: 'wrap',
                        alignItems: 'center',
                        marginBottom: '12px'
                    }}>
                        <button
                            style={{
                                padding: '6px 10px',
                                backgroundColor: 'var(--theia-button-secondaryBackground)',
                                color: 'var(--theia-button-secondaryForeground)',
                                border: 'none',
                                borderRadius: '4px',
                                cursor: 'pointer',
                                fontSize: '12px'
                            }}
                            onClick={() => void this.runQuestionsStep(this.state.selectedFormula!)}
                            disabled={this.state.loading}
                            title="Relance l'étape Questions avec la méthode choisie"
                        >
                            Rejouer questions
                        </button>

                        <button
                            style={{
                                padding: '6px 10px',
                                backgroundColor: 'var(--theia-button-secondaryBackground)',
                                color: 'var(--theia-button-secondaryForeground)',
                                border: 'none',
                                borderRadius: '4px',
                                cursor: 'pointer',
                                fontSize: '12px'
                            }}
                            onClick={() => void this.runQuestionsStep(this.state.selectedFormula!, { method: 'algorithm' })}
                            disabled={this.state.loading}
                            title="Relance l'extraction des questions via regex (backend)"
                        >
                            Questions (Regex)
                        </button>

                        <button
                            style={{
                                padding: '6px 10px',
                                backgroundColor: 'var(--theia-button-secondaryBackground)',
                                color: 'var(--theia-button-secondaryForeground)',
                                border: 'none',
                                borderRadius: '4px',
                                cursor: 'pointer',
                                fontSize: '12px'
                            }}
                            onClick={() => void this.runQuestionsStep(this.state.selectedFormula!, { method: 'ai' })}
                            disabled={this.state.loading}
                            title="Relance l'extraction des questions via IA"
                        >
                            Questions (IA)
                        </button>

                        <button
                            style={{
                                marginLeft: 'auto',
                                padding: '6px 10px',
                                backgroundColor: 'transparent',
                                color: 'var(--theia-foreground)',
                                border: '1px solid var(--theia-panel-border)',
                                borderRadius: '4px',
                                cursor: 'pointer',
                                fontSize: '12px'
                            }}
                            onClick={() => {
                                this.questionsAiHintOpen = !this.questionsAiHintOpen;
                                this.update();
                            }}
                            title="Afficher/masquer l'aide utilisateur pour l'IA (extraction questions)"
                        >
                            Aide IA (questions)
                        </button>

                        <button
                            style={{
                                padding: '6px 10px',
                                backgroundColor: 'transparent',
                                color: 'var(--theia-foreground)',
                                border: '1px solid var(--theia-panel-border)',
                                borderRadius: '4px',
                                cursor: 'pointer',
                                fontSize: '12px'
                            }}
                            onClick={() => {
                                this.showAdvancedAnswerFields = !this.showAdvancedAnswerFields;
                                this.update();
                            }}
                            title="Afficher/masquer les champs avancés (infos complémentaires IA)"
                        >
                            {this.showAdvancedAnswerFields ? 'Masquer champs IA' : 'Afficher champs IA'}
                        </button>

                        <button
                            style={{
                                padding: '6px 10px',
                                backgroundColor: 'var(--theia-button-background)',
                                color: 'var(--theia-button-foreground)',
                                border: 'none',
                                borderRadius: '4px',
                                cursor: 'pointer',
                                fontSize: '12px',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '6px'
                            }}
                            onClick={() => void this.answerAllQuestions({ overwrite: false })}
                            disabled={this.state.loading}
                            title="Remplit automatiquement les champs vides via IA ou recherche web"
                        >
                            {this.isAnsweringLoading ? <span className="formula-solver-spinner" style={{ width: '12px', height: '12px', margin: 0 }} /> : null}
                            Répondre (auto)
                        </button>
                        <button
                            style={{
                                padding: '6px 10px',
                                backgroundColor: 'var(--theia-button-secondaryBackground)',
                                color: 'var(--theia-button-secondaryForeground)',
                                border: 'none',
                                borderRadius: '4px',
                                cursor: 'pointer',
                                fontSize: '12px',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '6px'
                            }}
                            onClick={() => void this.answerAllQuestions({ overwrite: true })}
                            disabled={this.state.loading}
                            title="Écrase les champs existants via IA ou recherche web"
                        >
                            {this.isAnsweringLoading ? <span className="formula-solver-spinner" style={{ width: '12px', height: '12px', margin: 0 }} /> : null}
                            Répondre (écraser)
                        </button>

                        <button
                            style={{
                                padding: '6px 10px',
                                backgroundColor: 'var(--theia-button-secondaryBackground)',
                                color: 'var(--theia-button-secondaryForeground)',
                                border: 'none',
                                borderRadius: '4px',
                                cursor: 'pointer',
                                fontSize: '12px'
                            }}
                            onClick={() => void this.answerAllQuestions({ overwrite: false })}
                            disabled={this.state.loading}
                            title="Relance l'étape Réponses avec le mode et moteur sélectionnés (ne remplit que les champs vides)"
                        >
                            Rejouer réponses
                        </button>

                        <button
                            style={{
                                padding: '6px 10px',
                                backgroundColor: 'var(--theia-button-secondaryBackground)',
                                color: 'var(--theia-button-secondaryForeground)',
                                border: 'none',
                                borderRadius: '4px',
                                cursor: 'pointer',
                                fontSize: '12px',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '6px'
                            }}
                            onClick={() => {
                                this.answersEngine = 'ai';
                                void this.answerAllQuestions({ overwrite: true });
                            }}
                            disabled={this.state.loading}
                            title="Force le mode IA pour répondre (écrase tout)"
                        >
                            {this.isAnsweringLoading && this.answersEngine === 'ai' ? (
                                <span className="formula-solver-spinner" style={{ width: '12px', height: '12px', margin: 0 }} />
                            ) : null}
                            Réponses (IA)
                        </button>

                        <button
                            style={{
                                padding: '6px 10px',
                                backgroundColor: 'var(--theia-button-secondaryBackground)',
                                color: 'var(--theia-button-secondaryForeground)',
                                border: 'none',
                                borderRadius: '4px',
                                cursor: 'pointer',
                                fontSize: '12px',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '6px'
                            }}
                            onClick={() => {
                                this.answersEngine = 'backend-web-search';
                                void this.answerAllQuestions({ overwrite: true });
                            }}
                            disabled={this.state.loading}
                            title="Force la recherche web backend pour répondre (écrase tout)"
                        >
                            {this.isAnsweringLoading && this.answersEngine === 'backend-web-search' ? (
                                <span className="formula-solver-spinner" style={{ width: '12px', height: '12px', margin: 0 }} />
                            ) : null}
                            Réponses (Web)
                        </button>
                    </div>

                    {this.questionsAiHintOpen && (
                        <div style={{
                            padding: '10px',
                            backgroundColor: 'var(--theia-input-background)',
                            border: '1px solid var(--theia-panel-border)',
                            borderRadius: '4px',
                            marginBottom: '12px'
                        }}>
                            <div style={{ fontSize: '12px', fontWeight: 'bold', marginBottom: '6px' }}>
                                Indice (optionnel) pour l’IA lors de l’extraction des questions
                            </div>
                            <textarea
                                value={this.questionsAiUserHint}
                                onChange={e => {
                                    this.questionsAiUserHint = e.target.value;
                                    this.update();
                                }}
                                placeholder="Ex: Le listing est sous la forme 'A = ...' / 'B = ...'. Ne renvoie pas des numéros, renvoie la consigne textuelle."
                                style={{
                                    width: '100%',
                                    minHeight: '70px',
                                    padding: '8px 10px',
                                    fontFamily: 'var(--theia-code-font-family)',
                                    backgroundColor: 'var(--theia-editor-background)',
                                    color: 'var(--theia-foreground)',
                                    border: '1px solid var(--theia-input-border)',
                                    borderRadius: '4px'
                                }}
                            />
                        </div>
                    )}

                    <div style={{
                        padding: '10px',
                        backgroundColor: 'var(--theia-editor-background)',
                        border: '1px solid var(--theia-panel-border)',
                        borderRadius: '4px',
                        marginBottom: '12px'
                    }}>
                        <button
                            style={{
                                width: '100%',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                padding: 0,
                                background: 'transparent',
                                border: 'none',
                                color: 'var(--theia-foreground)',
                                cursor: 'pointer',
                                fontWeight: 'bold'
                            }}
                            onClick={() => {
                                this.answeringContextOpen = !this.answeringContextOpen;
                                this.update();
                            }}
                            title={this.answeringContextOpen ? 'Replier' : 'Déplier'}
                        >
                            <span>IA : Contexte & consignes de réponse</span>
                            <span className={`codicon ${this.answeringContextOpen ? 'codicon-chevron-down' : 'codicon-chevron-right'}`} />
                        </button>

                        {this.answeringContextOpen && (
                            <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                                    <button
                                        style={{
                                            padding: '6px 10px',
                                            backgroundColor: 'var(--theia-button-background)',
                                            color: 'var(--theia-button-foreground)',
                                            border: 'none',
                                            borderRadius: '4px',
                                            cursor: 'pointer',
                                            fontSize: '12px'
                                        }}
                                        disabled={this.state.loading}
                                        onClick={() => void this.refreshAnsweringContext(false)}
                                        title="Construit (ou relit du cache) le contexte IA"
                                    >
                                        Charger / rafraîchir
                                    </button>
                                    <button
                                        style={{
                                            padding: '6px 10px',
                                            backgroundColor: 'var(--theia-button-secondaryBackground)',
                                            color: 'var(--theia-button-secondaryForeground)',
                                            border: 'none',
                                            borderRadius: '4px',
                                            cursor: 'pointer',
                                            fontSize: '12px'
                                        }}
                                        disabled={this.state.loading}
                                        onClick={() => void this.refreshAnsweringContext(true)}
                                        title="Force le recalcul du contexte IA (ignore le cache)"
                                    >
                                        Forcer recalcul
                                    </button>

                                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px' }}>
                                        <input
                                            type="checkbox"
                                            checked={this.answeringContextUseOverride}
                                            onChange={e => {
                                                this.answeringContextUseOverride = e.target.checked;
                                                this.update();
                                            }}
                                        />
                                        Utiliser mon contexte (override)
                                    </label>
                                </div>

                                <div>
                                    <div style={{ fontSize: '12px', fontWeight: 'bold', marginBottom: '6px' }}>
                                        Contexte IA (JSON) – modifiable
                                    </div>
                                    <textarea
                                        value={this.answeringContextJson}
                                        onChange={e => {
                                            this.answeringContextJson = e.target.value;
                                            this.parseAnsweringContextOverrideFromJson();
                                            this.update();
                                        }}
                                        placeholder='{"geocache_summary":"","global_rules":[],"per_letter_rules":{}}'
                                        style={{
                                            width: '100%',
                                            minHeight: '160px',
                                            padding: '8px 10px',
                                            fontFamily: 'var(--theia-code-font-family)',
                                            backgroundColor: 'var(--theia-input-background)',
                                            color: 'var(--theia-input-foreground)',
                                            border: `1px solid ${this.answeringContextJsonError ? 'var(--theia-errorForeground)' : 'var(--theia-input-border)'}`,
                                            borderRadius: '4px'
                                        }}
                                    />
                                    {this.answeringContextJsonError && (
                                        <div style={{ marginTop: '6px', color: 'var(--theia-errorForeground)', fontSize: '12px' }}>
                                            ⚠️ {this.answeringContextJsonError}
                                        </div>
                                    )}
                                </div>

                                <div>
                                    <div style={{ fontSize: '12px', fontWeight: 'bold', marginBottom: '6px' }}>
                                        Instructions supplémentaires (ajoutées à chaque question)
                                    </div>
                                    <textarea
                                        value={this.answeringAdditionalInstructions}
                                        onChange={e => {
                                            this.answeringAdditionalInstructions = e.target.value;
                                            this.update();
                                        }}
                                        placeholder="Ex: Respecte la casse exacte, conserve les accents, ne mets pas d'article, etc."
                                        style={{
                                            width: '100%',
                                            minHeight: '70px',
                                            padding: '8px 10px',
                                            fontFamily: 'var(--theia-code-font-family)',
                                            backgroundColor: 'var(--theia-input-background)',
                                            color: 'var(--theia-input-foreground)',
                                            border: '1px solid var(--theia-input-border)',
                                            borderRadius: '4px'
                                        }}
                                    />
                                </div>
                            </div>
                        )}
                    </div>

                    {this.state.questions.length === 0 ? (
                        <div style={{ color: 'var(--theia-descriptionForeground)' }}>
                            Aucune question trouvée. Lancez la détection pour extraire les questions.
                        </div>
                    ) : (
                        <div>
                            <div style={{ marginBottom: '10px', fontSize: '14px' }}>
                                {this.state.questions.length} variable{this.state.questions.length > 1 ? 's' : ''} détectée{this.state.questions.length > 1 ? 's' : ''}
                            </div>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                {this.state.questions.map(question => {
                                    const value = this.state.values.get(question.letter);
                                    const hasValue = value && value.rawValue.trim() !== '';
                                    const perQuestionProfile = this.perQuestionProfiles.get(question.letter) || this.stepConfig.aiProfileForAnswers;
                                    const isSuspect = previewSuspects.has(question.letter);
                                    const isLetterLoading = this.loadingLetters.has(question.letter);
                                    const detail = this.answerDetails.get(question.letter);
                                    const isDetailExpanded = this.expandedDetailLetters.has(question.letter);

                                    return (
                                        <QuestionFieldCard
                                            key={question.letter}
                                            question={question}
                                            value={value}
                                            hasValue={!!hasValue}
                                            isSuspect={isSuspect}
                                            isLetterLoading={isLetterLoading}
                                            perQuestionProfile={perQuestionProfile}
                                            detail={detail}
                                            isDetailExpanded={isDetailExpanded}
                                            showAdvancedAnswerFields={this.showAdvancedAnswerFields}
                                            perLetterExtraInfo={this.perLetterExtraInfo.get(question.letter) || ''}
                                            loading={this.state.loading}
                                            onProfileChange={(letter, profile) => {
                                                this.perQuestionProfiles.set(letter, profile);
                                                this.update();
                                            }}
                                            onAnswerIA={(letter) => void this.answerSingleQuestion(letter, { overwrite: true })}
                                            onAnswerInternet={(letter) => void this.answerSingleQuestion(letter, { overwrite: true, engine: 'backend-web-search' })}
                                            onToggleDetail={(letter) => {
                                                if (this.expandedDetailLetters.has(letter)) {
                                                    this.expandedDetailLetters.delete(letter);
                                                } else {
                                                    this.expandedDetailLetters.add(letter);
                                                }
                                                this.update();
                                            }}
                                            onValueChange={(letter, rawValue, type) => this.updateValue(letter, rawValue, type as any)}
                                            onQuestionChange={(letter, newQuestion) => {
                                                const idx = this.state.questions.findIndex(q => q.letter === letter);
                                                if (idx >= 0) {
                                                    this.state.questions[idx].question = newQuestion;
                                                }
                                            }}
                                            onExtraInfoChange={(letter, val) => {
                                                if (!val.trim()) {
                                                    this.perLetterExtraInfo.delete(letter);
                                                } else {
                                                    this.perLetterExtraInfo.set(letter, val);
                                                }
                                                this.update();
                                            }}
                                        />
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        );
    }

    protected getPreviewSuspectLetters(): Set<string> {
        const formula = this.state.selectedFormula;
        if (!formula) {
            return new Set<string>();
        }
        try {
            const preview = this.previewEngine.build({ north: formula.north, east: formula.east }, this.state.values);
            const suspects = [
                ...(preview.north?.suspectLetters || []),
                ...(preview.east?.suspectLetters || [])
            ];
            return new Set<string>(suspects);
        } catch {
            return new Set<string>();
        }
    }

    protected renderCalculateStep(): React.ReactNode {
        if (!this.state.selectedFormula) return null;

        return (
            <div className='calculate-step' style={{ marginBottom: '20px' }}>
                <h3>3. Calcul des coordonnées</h3>
                
                {/* Prévisualisation en temps réel avec calcul automatique */}
                <FormulaPreviewComponent
                    formula={this.state.selectedFormula}
                    values={this.state.values}
                    onPartialCalculate={(part, result) => {
                        console.log(`[FORMULA-SOLVER] Partie ${part} calculée automatiquement:`, result);
                        // Vérifier si les deux parties sont complètes pour calculer automatiquement
                        this.tryAutoCalculate();
                    }}
                />

                {/* Mode Brute Force */}
                <BruteForceComponent
                    letters={this.extractLettersFromFormula(this.state.selectedFormula)}
                    values={this.state.values}
                    results={this.bruteForceResults}
                    onBruteForceExecute={(combinations) => this.executeBruteForceFromCombinations(combinations)}
                    onCreateWaypoint={(resultId, autoSave) => this.createWaypointFromBrute(resultId, autoSave)}
                    onRemoveResult={(resultId) => this.removeBruteForceResult(resultId)}
                    onClearAll={() => {
                        this.bruteForceMode = false;
                        this.bruteForceResults = [];
                        window.dispatchEvent(new CustomEvent('geoapp-map-highlight-clear'));
                        this.update();
                    }}
                />

                {/* Résultat du calcul normal */}
                {!this.bruteForceMode && this.state.result && this.state.result.status === 'success' && (
                    <ResultDisplayComponent
                        result={this.state.result}
                        onCopy={(text) => this.messageService.info(`Copié: ${text}`)}
                        onCreateWaypoint={this.state.geocacheId ? () => this.createWaypoint(false) : undefined}
                        onAutoSaveWaypoint={this.state.geocacheId ? () => this.createWaypoint(true) : undefined}
                        onProjectOnMap={() => this.showOnMap()}
                        onSetCorrectedCoords={this.state.geocacheId ? () => this.setCorrectedCoords() : undefined}
                    />
                )}
                
            </div>
        );
    }

}

function intersectBoundsWithCircleBBox(
    bounds: { minLat: number; maxLat: number; minLon: number; maxLon: number },
    centerLat: number,
    centerLon: number,
    radiusMeters: number
): { minLat: number; maxLat: number; minLon: number; maxLon: number } | undefined {
    // Approximation suffisante pour 2 miles: conversion mètres -> degrés
    const latRad = (centerLat * Math.PI) / 180;
    const metersPerDegreeLat = 111_320;
    const metersPerDegreeLon = Math.max(1, metersPerDegreeLat * Math.cos(latRad));

    const dLat = radiusMeters / metersPerDegreeLat;
    const dLon = radiusMeters / metersPerDegreeLon;

    const circleBBox = {
        minLat: centerLat - dLat,
        maxLat: centerLat + dLat,
        minLon: centerLon - dLon,
        maxLon: centerLon + dLon
    };

    const clipped = {
        minLat: Math.max(bounds.minLat, circleBBox.minLat),
        maxLat: Math.min(bounds.maxLat, circleBBox.maxLat),
        minLon: Math.max(bounds.minLon, circleBBox.minLon),
        maxLon: Math.min(bounds.maxLon, circleBBox.maxLon)
    };

    if (clipped.minLat > clipped.maxLat || clipped.minLon > clipped.maxLon) {
        return undefined;
    }
    return clipped;
}
