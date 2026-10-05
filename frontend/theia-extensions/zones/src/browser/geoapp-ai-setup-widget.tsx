import * as React from 'react';
import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { CommandService } from '@theia/core';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { WindowService } from '@theia/core/lib/browser/window/window-service';
import { GeoAppAiModelResolution } from '@mysterai/theia-plugins/lib/common/ai-model-contract';

import '../../src/browser/style/geoapp-ai-setup.css';
import { GeoAppAiModelResolutionService } from './geoapp-ai-model-resolution-service';
import {
    GEOAPP_AI_SETUP_FAILURE_MESSAGES,
    GeoAppAiSetupApplyResult,
    GeoAppAiSetupLocalDetection,
    GeoAppAiSetupModel,
    GeoAppAiSetupPhase,
    GeoAppAiSetupProvider,
    GeoAppAiSetupProviderId,
    GeoAppAiSetupService,
    GeoAppAiSetupStatus,
    GeoAppAiSetupTestResult,
} from './geoapp-ai-setup-service';
import { dispatchGeoAppOpenChatRequest } from './geoapp-chat-shared';

export const GeoAppAiSetupCommandId = 'geoapp.ai.setup.open';
export const GEOAPP_AI_SETUP_TRY_AIDE_PROMPT = 'Que peux-tu faire pour moi ?';

const AIDE_AGENT_ID = 'geoapp-doc-aide';

type GeoAppAiSetupView = 'loading' | 'status' | 'provider' | 'connect' | 'activate';

const PHASES: ReadonlyArray<{ id: GeoAppAiSetupPhase; label: string }> = [
    { id: 'connection', label: 'Enregistrement de la connexion' },
    { id: 'model', label: 'Enregistrement du modèle' },
    { id: 'test', label: 'Test du modèle' },
    { id: 'activation', label: 'Activation pour tous les assistants' },
];

const LOCAL_TOOLS_WARNING = '@Aide s\'appuie sur de très nombreux outils. Un petit modèle local peut répondre mais mal '
    + 'piloter l\'application. Préférez un modèle annoncé compatible avec les appels d\'outils.';

@injectable()
export class GeoAppAiSetupWidget extends ReactWidget {

    static readonly ID = 'geoapp-ai-setup';

    protected view: GeoAppAiSetupView = 'loading';
    protected status: GeoAppAiSetupStatus | undefined;
    protected detections = new Map<string, GeoAppAiSetupLocalDetection>();
    protected detectionDone = false;

    protected providerId: GeoAppAiSetupProviderId | undefined;
    protected apiKeyDraft = '';
    protected showApiKey = false;
    protected endpointDraft = '';
    protected models: GeoAppAiSetupModel[] | undefined;
    protected modelsLoading = false;
    protected modelDraft = '';
    protected connectError: string | undefined;

    protected applying = false;
    protected applyPhase: GeoAppAiSetupPhase | undefined;
    protected applyResult: GeoAppAiSetupApplyResult | undefined;
    protected justActivated = false;

    protected retesting = false;
    protected retestResult: GeoAppAiSetupTestResult | undefined;
    protected resettingTasks = new Set<string>();

    constructor(
        @inject(GeoAppAiSetupService) protected readonly setupService: GeoAppAiSetupService,
        @inject(GeoAppAiModelResolutionService) protected readonly modelResolutionService: GeoAppAiModelResolutionService,
        @inject(CommandService) protected readonly commandService: CommandService,
        @inject(WindowService) protected readonly windowService: WindowService,
    ) {
        super();
        this.id = GeoAppAiSetupWidget.ID;
        this.title.label = 'Configurer l\'IA';
        this.title.caption = 'Choisir le fournisseur et le modèle des assistants GeoApp';
        this.title.closable = true;
        this.title.iconClass = 'codicon codicon-sparkle';
        this.addClass('geoapp-ai-setup-widget');
    }

    @postConstruct()
    protected init(): void {
        this.toDispose.push(this.setupService.onDidChangeStatus(status => {
            this.status = status;
            this.update();
        }));
        void this.showStart();
    }

    /** Écran d'état si l'IA est prête, choix du fournisseur sinon. */
    async showStart(): Promise<void> {
        this.justActivated = false;
        this.retestResult = undefined;
        await this.refreshStatus();
        if (this.status?.ready) {
            this.view = 'status';
        } else {
            this.openProviderChoice();
        }
        this.update();
    }

    /** Ouvre directement l'étape de connexion d'un fournisseur (commande, @Aide). */
    openProvider(providerId: GeoAppAiSetupProviderId): void {
        this.selectProvider(this.setupService.getProvider(providerId));
    }

    protected async refreshStatus(): Promise<void> {
        try {
            this.status = await this.setupService.getStatus();
        } catch (error) {
            console.debug('[GeoAppAiSetup] état illisible', error);
        }
    }

    protected openProviderChoice = (): void => {
        this.view = 'provider';
        this.applyResult = undefined;
        this.update();
        this.detectionDone = false;
        this.setupService.detectLocalProviders().then(detections => {
            this.detections = new Map(detections.map(detection => [detection.id, detection]));
        }).catch(() => undefined).then(() => {
            this.detectionDone = true;
            this.update();
        });
    };

    protected selectProvider(provider: GeoAppAiSetupProvider): void {
        this.providerId = provider.id;
        this.view = 'connect';
        this.apiKeyDraft = '';
        this.showApiKey = false;
        this.models = undefined;
        this.modelDraft = '';
        this.connectError = undefined;
        this.applyResult = undefined;
        this.endpointDraft = this.detections.get(provider.id)?.endpoint
            || this.setupService.getProviderState(provider.id).endpoint
            || '';
        this.update();
    }

    protected loadModels = async (): Promise<void> => {
        const provider = this.currentProvider();
        if (!provider || this.modelsLoading) {
            return;
        }
        const alreadyConfigured = this.setupService.getProviderState(provider.id).configured;
        if (provider.kind === 'cloud' && !this.apiKeyDraft.trim() && !alreadyConfigured) {
            this.connectError = 'Saisissez votre clé API.';
            this.update();
            return;
        }
        this.modelsLoading = true;
        this.connectError = undefined;
        this.update();
        try {
            await this.setupService.saveCredentials(provider.id, {
                apiKey: this.apiKeyDraft,
                endpoint: this.endpointDraft,
            });
            // La clé est enregistrée : elle ne doit plus rester dans le champ ni dans le DOM.
            this.apiKeyDraft = '';
            this.showApiKey = false;
            const models = await this.setupService.listModels(provider.id);
            this.models = models;
            if (!this.modelDraft) {
                this.modelDraft = this.setupService.getPreselectedModel(provider.id, models) ?? '';
            }
            if (!models.length) {
                this.connectError = this.emptyModelsMessage(provider);
            }
        } catch (error) {
            this.connectError = this.setupService.redact(error instanceof Error ? error.message : String(error));
        } finally {
            this.modelsLoading = false;
            this.update();
        }
    };

    protected emptyModelsMessage(provider: GeoAppAiSetupProvider): string {
        if (provider.id === 'ollama') {
            return 'Aucun serveur ne répond à cette adresse. Lancez Ollama, puis réessayez.';
        }
        if (provider.id === 'lmstudio') {
            return 'Aucun serveur ne répond à cette adresse. Lancez le serveur local de LM Studio, puis réessayez. '
                + 'Activez aussi l\'option CORS du serveur local dans LM Studio.';
        }
        if (provider.id === 'openrouter') {
            return 'La liste des modèles OpenRouter n\'a pas pu être chargée. Vous pouvez saisir le nom du modèle à la main.';
        }
        return `Aucun modèle n'a été trouvé avec cette clé. Vérifiez la clé ${provider.label}, ou saisissez le nom du modèle à la main.`;
    }

    protected runActivation = async (): Promise<void> => {
        const provider = this.currentProvider();
        const model = this.modelDraft.trim();
        if (!provider || !model || this.applying) {
            return;
        }
        this.view = 'activate';
        this.applying = true;
        this.applyPhase = undefined;
        this.applyResult = undefined;
        this.update();
        try {
            this.applyResult = await this.setupService.apply(provider.id, model, phase => {
                this.applyPhase = phase;
                this.update();
            });
        } catch (error) {
            this.applyResult = {
                ok: false,
                phase: this.applyPhase ?? 'connection',
                reason: 'unknown',
                detail: this.setupService.redact(error instanceof Error ? error.message : String(error)),
            };
        }
        this.applying = false;
        if (this.applyResult.ok === true) {
            this.status = this.applyResult.status;
            this.justActivated = true;
            this.retestResult = undefined;
            this.view = 'status';
        }
        this.update();
    };

    protected retest = async (): Promise<void> => {
        const modelId = this.status?.defaultModelId;
        if (!modelId || this.retesting) {
            return;
        }
        this.retesting = true;
        this.retestResult = undefined;
        this.update();
        this.retestResult = await this.setupService.testModel(modelId);
        this.retesting = false;
        this.update();
    };

    protected resetTask = async (taskId: string): Promise<void> => {
        this.resettingTasks.add(taskId);
        this.update();
        try {
            await this.modelResolutionService.resetTaskModel(taskId);
            await this.refreshStatus();
        } catch (error) {
            console.debug('[GeoAppAiSetup] remise par défaut impossible', error);
        }
        this.resettingTasks.delete(taskId);
        this.update();
    };

    protected tryAide = (): void => {
        dispatchGeoAppOpenChatRequest(window, CustomEvent, {
            sessionTitle: 'Découvrir @Aide',
            prompt: GEOAPP_AI_SETUP_TRY_AIDE_PROMPT,
            preferredAgentId: AIDE_AGENT_ID,
        });
    };

    protected openAideChat = (): void => {
        dispatchGeoAppOpenChatRequest(window, CustomEvent, {
            sessionTitle: '@Aide',
            preferredAgentId: AIDE_AGENT_ID,
        });
    };

    protected runCommand(commandId: string): void {
        this.commandService.executeCommand(commandId).catch(error =>
            console.debug(`[GeoAppAiSetup] commande ${commandId} indisponible`, error));
    }

    protected currentProvider(): GeoAppAiSetupProvider | undefined {
        return this.providerId ? this.setupService.getProvider(this.providerId) : undefined;
    }

    protected render(): React.ReactNode {
        return (
            <div className='geoapp-ai-setup-root'>
                <header className='geoapp-ai-setup-header'>
                    <h2>Configurer l'IA</h2>
                    <p>Choisissez un fournisseur et un modèle : tous les assistants GeoApp l'utiliseront, à commencer par @Aide.</p>
                </header>
                {this.view !== 'status' && this.view !== 'loading' && this.renderSteps()}
                {this.view === 'loading' && <p className='geoapp-ai-setup-muted'>Lecture de la configuration…</p>}
                {this.view === 'status' && this.renderStatus()}
                {this.view === 'provider' && this.renderProviderChoice()}
                {this.view === 'connect' && this.renderConnect()}
                {this.view === 'activate' && this.renderActivation()}
            </div>
        );
    }

    protected renderSteps(): React.ReactNode {
        const steps: Array<{ view: GeoAppAiSetupView; label: string }> = [
            { view: 'provider', label: '1. Fournisseur' },
            { view: 'connect', label: '2. Connexion et modèle' },
            { view: 'activate', label: '3. Activation' },
        ];
        return (
            <ol className='geoapp-ai-setup-steps'>
                {steps.map(step => (
                    <li key={step.view} className={step.view === this.view ? 'active' : undefined}>{step.label}</li>
                ))}
            </ol>
        );
    }

    // --- Étape 1 -----------------------------------------------------------

    protected renderProviderChoice(): React.ReactNode {
        const providers = this.setupService.getProviders();
        return (
            <section>
                <h3>En ligne</h3>
                <div className='geoapp-ai-setup-cards'>
                    {providers.filter(provider => provider.kind === 'cloud').map(provider => this.renderProviderCard(provider))}
                </div>
                <h3>Sur cet ordinateur</h3>
                <div className='geoapp-ai-setup-cards'>
                    {providers.filter(provider => provider.kind === 'local').map(provider => this.renderProviderCard(provider))}
                </div>
                <p className='geoapp-ai-setup-muted'>
                    Vous hésitez ? OpenRouter convient à la plupart des usages : une seule clé, et vous changez de modèle quand vous voulez.
                </p>
                {this.status?.ready && (
                    <div className='geoapp-ai-setup-actions'>
                        <button className='theia-button secondary' onClick={() => { void this.showStart(); }}>Retour à l'état</button>
                    </div>
                )}
            </section>
        );
    }

    protected renderProviderCard(provider: GeoAppAiSetupProvider): React.ReactNode {
        const select = (): void => this.selectProvider(provider);
        const badges: React.ReactNode[] = [];
        if (provider.recommended) {
            badges.push(<span key='recommended' className='geoapp-ai-setup-badge accent'>Recommandé</span>);
        }
        if (provider.kind === 'cloud' && this.setupService.getProviderState(provider.id).configured) {
            badges.push(<span key='configured' className='geoapp-ai-setup-badge'>Déjà configuré</span>);
        }
        if (provider.kind === 'local') {
            const detection = this.detections.get(provider.id);
            if (detection) {
                const count = detection.models.length;
                badges.push(
                    <span key='detected' className='geoapp-ai-setup-badge success'>
                        Détecté · {count} modèle{count > 1 ? 's' : ''}
                    </span>
                );
            } else {
                badges.push(
                    <span key='detected' className='geoapp-ai-setup-badge'>
                        {this.detectionDone ? 'Non détecté' : 'Recherche…'}
                    </span>
                );
            }
        }
        return (
            <div
                key={provider.id}
                className='geoapp-ai-setup-card'
                role='button'
                tabIndex={0}
                onClick={select}
                onKeyDown={event => {
                    if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        select();
                    }
                }}
            >
                <div className='geoapp-ai-setup-card-title'>
                    <span>{provider.label}</span>
                    {badges}
                </div>
                <div className='geoapp-ai-setup-card-desc'>{provider.tagline}</div>
            </div>
        );
    }

    // --- Étape 2 -----------------------------------------------------------

    protected renderConnect(): React.ReactNode {
        const provider = this.currentProvider();
        if (!provider) {
            return undefined;
        }
        const configured = this.setupService.getProviderState(provider.id).configured;
        const submitOnEnter = (event: React.KeyboardEvent): void => {
            if (event.key === 'Enter') {
                void this.loadModels();
            }
        };
        return (
            <section className='geoapp-ai-setup-form'>
                <h3>{provider.label}</h3>
                {provider.kind === 'cloud' ? (
                    <div className='geoapp-ai-setup-field'>
                        <label htmlFor='geoapp-ai-setup-key'>Clé API</label>
                        <div className='geoapp-ai-setup-row'>
                            <input
                                id='geoapp-ai-setup-key'
                                // Jamais type='password' : le navigateur y injecterait un mot de passe
                                // mémorisé pour ce site (celui de Geocaching.com). Le masquage est en CSS.
                                className={`theia-input${this.showApiKey ? '' : ' geoapp-ai-setup-secret'}`}
                                type='text'
                                name='geoapp-ai-provider-key'
                                autoComplete='off'
                                autoCorrect='off'
                                autoCapitalize='off'
                                data-lpignore='true'
                                data-1p-ignore='true'
                                data-form-type='other'
                                spellCheck={false}
                                value={this.apiKeyDraft}
                                placeholder={configured ? 'Une clé est déjà enregistrée — laissez vide pour la conserver' : ''}
                                onChange={event => { this.apiKeyDraft = event.target.value; this.update(); }}
                                onKeyDown={submitOnEnter}
                            />
                            <button
                                className='theia-button secondary'
                                title={this.showApiKey ? 'Masquer la clé' : 'Afficher la clé'}
                                onClick={() => { this.showApiKey = !this.showApiKey; this.update(); }}
                            >
                                <span className={`codicon ${this.showApiKey ? 'codicon-eye-closed' : 'codicon-eye'}`} />
                            </button>
                        </div>
                        <div className='geoapp-ai-setup-hint'>
                            <a
                                href={provider.keyUrl}
                                onClick={event => {
                                    event.preventDefault();
                                    this.windowService.openNewWindow(provider.keyUrl!, { external: true });
                                }}
                            >
                                Créer une clé sur {provider.label}
                            </a>
                            {' · '}La clé est enregistrée en clair dans les préférences de cet ordinateur.
                        </div>
                    </div>
                ) : (
                    <div className='geoapp-ai-setup-field'>
                        <label htmlFor='geoapp-ai-setup-endpoint'>Adresse</label>
                        <input
                            id='geoapp-ai-setup-endpoint'
                            className='theia-input'
                            type='text'
                            spellCheck={false}
                            value={this.endpointDraft}
                            placeholder={provider.defaultEndpoint}
                            onChange={event => { this.endpointDraft = event.target.value; this.update(); }}
                            onKeyDown={submitOnEnter}
                        />
                    </div>
                )}
                <div className='geoapp-ai-setup-actions'>
                    <button className='theia-button secondary' disabled={this.modelsLoading} onClick={() => { void this.loadModels(); }}>
                        {this.modelsLoading
                            ? 'Recherche des modèles…'
                            : provider.kind === 'cloud' ? 'Vérifier la clé' : 'Rechercher les modèles'}
                    </button>
                </div>
                {this.connectError && <div className='geoapp-ai-setup-message error'>{this.connectError}</div>}
                {this.models !== undefined && this.renderModelChoice(provider)}
                <div className='geoapp-ai-setup-actions footer'>
                    <button className='theia-button secondary' onClick={this.openProviderChoice}>Retour</button>
                    <button
                        className='theia-button main'
                        disabled={!this.modelDraft.trim() || this.modelsLoading || this.models === undefined}
                        onClick={() => { void this.runActivation(); }}
                    >
                        Tester et activer
                    </button>
                </div>
            </section>
        );
    }

    protected renderModelChoice(provider: GeoAppAiSetupProvider): React.ReactNode {
        const models = this.models ?? [];
        const listId = `${this.id}-models`;
        const freeChoice = provider.id === 'openrouter' || provider.kind === 'local';
        return (
            <div className='geoapp-ai-setup-field'>
                <label htmlFor='geoapp-ai-setup-model'>Modèle</label>
                <input
                    id='geoapp-ai-setup-model'
                    className='theia-input'
                    type='text'
                    list={listId}
                    spellCheck={false}
                    value={this.modelDraft}
                    placeholder={models.length ? `Rechercher parmi ${models.length} modèles ou saisir un nom` : 'Nom du modèle'}
                    onChange={event => { this.modelDraft = event.target.value; this.update(); }}
                />
                <datalist id={listId}>
                    {models.map(model => (
                        <option key={model.id} value={model.id}>
                            {model.recommended ? `Recommandé · ${model.label}` : model.label}
                        </option>
                    ))}
                </datalist>
                <div className='geoapp-ai-setup-hint'>
                    {freeChoice
                        ? `Saisissez ou choisissez le nom du modèle, tel qu'il apparaît chez ${provider.label}`
                            + (provider.id === 'openrouter' ? ' (format éditeur/modèle).' : '.')
                        : 'Choisissez un modèle dans la liste, ou saisissez son nom.'}
                </div>
                {provider.kind === 'local' && <div className='geoapp-ai-setup-message warning'>{LOCAL_TOOLS_WARNING}</div>}
            </div>
        );
    }

    // --- Étape 3 -----------------------------------------------------------

    protected renderActivation(): React.ReactNode {
        const result = this.applyResult;
        const failure = result && result.ok === false ? result : undefined;
        const currentIndex = PHASES.findIndex(phase => phase.id === (failure?.phase ?? this.applyPhase));
        return (
            <section>
                <ul className='geoapp-ai-setup-phases'>
                    {PHASES.map((phase, index) => {
                        const state = failure && index === currentIndex
                            ? 'failed'
                            : index < currentIndex
                                ? 'done'
                                : index === currentIndex && this.applying ? 'running' : 'pending';
                        const icon = state === 'failed'
                            ? 'codicon-error'
                            : state === 'done'
                                ? 'codicon-check'
                                : state === 'running' ? 'codicon-loading codicon-modifier-spin' : 'codicon-circle-outline';
                        return (
                            <li key={phase.id} className={state}>
                                <span className={`codicon ${icon}`} />
                                {phase.label}
                            </li>
                        );
                    })}
                </ul>
                {failure && (
                    <div className='geoapp-ai-setup-message error'>
                        {GEOAPP_AI_SETUP_FAILURE_MESSAGES[failure.reason]}
                        {failure.detail && (
                            <details>
                                <summary>Détail</summary>
                                <pre>{failure.detail}</pre>
                            </details>
                        )}
                        <div>Rien n'a été changé : l'ancien modèle par défaut reste en place.</div>
                    </div>
                )}
                {!this.applying && (
                    <div className='geoapp-ai-setup-actions footer'>
                        <button className='theia-button secondary' onClick={() => { this.view = 'connect'; this.update(); }}>Retour</button>
                        {failure && (
                            <button className='theia-button main' onClick={() => { void this.runActivation(); }}>Réessayer</button>
                        )}
                    </div>
                )}
            </section>
        );
    }

    // --- Écran d'état ------------------------------------------------------

    protected renderStatus(): React.ReactNode {
        const status = this.status;
        if (!status) {
            return <p className='geoapp-ai-setup-muted'>Lecture de la configuration…</p>;
        }
        const provider = status.providerId ? this.setupService.getProvider(status.providerId) : undefined;
        const groups = this.groupTasks(status.tasks);
        return (
            <section>
                {this.justActivated && (
                    <div className='geoapp-ai-setup-message success'>
                        <strong>L'IA est prête.</strong> Tous les assistants utilisent maintenant ce modèle.
                        <div className='geoapp-ai-setup-actions'>
                            <button className='theia-button main' onClick={this.tryAide}>Essayer @Aide</button>
                        </div>
                    </div>
                )}
                <div className='geoapp-ai-setup-summary'>
                    <div>
                        <div className={`geoapp-ai-setup-state ${status.ready ? 'ready' : 'missing'}`}>
                            <span className={`codicon ${status.ready ? 'codicon-pass-filled' : 'codicon-warning'}`} />
                            {status.ready ? 'IA prête' : 'IA non configurée'}
                        </div>
                        <div className='geoapp-ai-setup-muted'>
                            {status.defaultModelId
                                ? `${provider?.label ?? 'Fournisseur'} · ${status.defaultModelLabel ?? status.defaultModelId}`
                                : 'Aucun modèle par défaut disponible.'}
                        </div>
                    </div>
                    <div className='geoapp-ai-setup-actions'>
                        <button className='theia-button secondary' disabled={!status.defaultModelId || this.retesting} onClick={() => { void this.retest(); }}>
                            {this.retesting ? 'Test en cours…' : 'Tester à nouveau'}
                        </button>
                        <button className='theia-button' onClick={this.openProviderChoice}>Changer de modèle ou de fournisseur</button>
                    </div>
                </div>
                {this.retestResult && (
                    this.retestResult.ok === true
                        ? <div className='geoapp-ai-setup-message success'>Le modèle a répondu.</div>
                        : (
                            <div className='geoapp-ai-setup-message error'>
                                {GEOAPP_AI_SETUP_FAILURE_MESSAGES[this.retestResult.reason]}
                                {this.retestResult.detail && (
                                    <details>
                                        <summary>Détail</summary>
                                        <pre>{this.retestResult.detail}</pre>
                                    </details>
                                )}
                            </div>
                        )
                )}
                {this.renderTaskGroup('Assistants', groups.assistants, false)}
                {this.renderTaskGroup('Fonctions spécialisées', groups.specialised, true)}
                {this.renderTaskGroup('Hors ligne', groups.local, true)}
                <h3>Aller plus loin</h3>
                <div className='geoapp-ai-setup-links'>
                    <a href='#' onClick={event => { event.preventDefault(); this.openAideChat(); }}>Demander à @Aide</a>
                    <a href='#' onClick={event => { event.preventDefault(); this.runCommand('aiConfiguration:open'); }}>Configuration IA avancée</a>
                    <a href='#' onClick={event => { event.preventDefault(); this.runCommand('geo-preferences:open'); }}>Préférences GeoApp</a>
                </div>
            </section>
        );
    }

    protected groupTasks(tasks: readonly GeoAppAiModelResolution[]): {
        assistants: GeoAppAiModelResolution[];
        specialised: GeoAppAiModelResolution[];
        local: GeoAppAiModelResolution[];
    } {
        const groups = { assistants: [] as GeoAppAiModelResolution[], specialised: [] as GeoAppAiModelResolution[], local: [] as GeoAppAiModelResolution[] };
        for (const task of tasks) {
            if (task.requiresLocalModel) {
                groups.local.push(task);
            } else if (task.requiredCapabilities?.length || task.optionalCapabilities?.length) {
                groups.specialised.push(task);
            } else {
                groups.assistants.push(task);
            }
        }
        return groups;
    }

    protected renderTaskGroup(title: string, tasks: readonly GeoAppAiModelResolution[], optional: boolean): React.ReactNode {
        if (!tasks.length) {
            return undefined;
        }
        return (
            <>
                <h3>{title}</h3>
                <table className='geoapp-ai-setup-tasks'>
                    <tbody>
                        {tasks.map(task => {
                            const ready = task.status === 'ready';
                            const stateClass = ready ? 'ready' : optional ? 'optional' : 'missing';
                            const stateLabel = ready ? 'Prête' : optional ? 'Optionnel' : 'Non prête';
                            const detail = ready
                                ? task.displayModel || task.resolvedModelId || ''
                                : this.taskReason(task);
                            const canReset = !optional && !ready && task.source === 'agent';
                            return (
                                <tr key={task.taskId}>
                                    <td>{task.taskLabel}</td>
                                    <td><span className={`geoapp-ai-setup-task-state ${stateClass}`}>{stateLabel}</span></td>
                                    <td className='geoapp-ai-setup-muted'>
                                        {detail}
                                        {canReset && (
                                            <button
                                                className='theia-button secondary'
                                                disabled={this.resettingTasks.has(task.taskId)}
                                                onClick={() => { void this.resetTask(task.taskId); }}
                                            >
                                                Remettre sur le modèle par défaut
                                            </button>
                                        )}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </>
        );
    }

    protected taskReason(task: GeoAppAiModelResolution): string {
        if (task.requiresLocalModel && task.locality !== 'local') {
            return 'Nécessite un modèle local.';
        }
        const missing = task.capabilityChecks?.find(check => check.required && check.status !== 'supported');
        if (missing) {
            const labels: Record<string, string> = {
                'vision': 'avec vision',
                'web': 'avec accès Web',
                'tools': 'avec appels d\'outils',
                'structured-output': 'avec sortie structurée',
            };
            return `Nécessite un modèle ${labels[missing.capability] ?? missing.capability}.`;
        }
        return this.setupService.redact(task.diagnostics[0] ?? 'Aucun modèle prêt.');
    }
}
