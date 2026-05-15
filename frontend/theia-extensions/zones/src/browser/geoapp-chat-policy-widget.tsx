import * as React from 'react';
import { injectable, inject, optional, postConstruct } from '@theia/core/shared/inversify';
import { CommandService, MessageService } from '@theia/core';
import { PreferenceService } from '@theia/core/lib/common/preferences/preference-service';
import { PreferenceScope } from '@theia/core/lib/common/preferences/preference-scope';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { SkillService } from '@theia/ai-core/lib/browser/skill-service';
import {
    PromptFragment,
    PromptFragmentCustomizationService,
    PromptService,
    isCustomizedPromptFragment
} from '@theia/ai-core/lib/common/prompt-service';

import '../../src/browser/style/geoapp-chat-policy.css';
import {
    GEOAPP_CHAT_BEHAVIOR_CHECKER_PROFILE_PREF,
    GEOAPP_CHAT_BEHAVIOR_DEFAULT_PROFILE_PREF,
    GEOAPP_CHAT_BEHAVIOR_FORMULA_PROFILE_PREF,
    GEOAPP_CHAT_BEHAVIOR_HIDDEN_CONTENT_PROFILE_PREF,
    GEOAPP_CHAT_BEHAVIOR_IMAGE_PUZZLE_PROFILE_PREF,
    GEOAPP_CHAT_BEHAVIOR_SECRET_CODE_PROFILE_PREF,
    GEOAPP_CHAT_PROMPT_PACK_PREF,
    GEOAPP_CHAT_SKILL_PACK_PREF,
    GEOAPP_CHAT_SKILL_POLICY_OVERRIDES_PREF,
    GEOAPP_CHAT_TOOL_POLICY_OVERRIDES_PREF,
    GeoAppChatBehaviorProfile,
    GeoAppChatSkillPack,
    GeoAppChatSessionKind,
    GeoAppChatWorkflowBehaviorProfile,
    GeoAppChatWorkflowKind,
} from './geoapp-chat-shared';
import {
    GeoAppChatPolicy,
    GeoAppChatPolicyDiagnostic,
    GeoAppChatRuntimeDiagnosticOptions,
    GeoAppChatPolicyService,
    GeoAppChatSkillOverride,
    GeoAppChatSystemPromptPreview,
    GeoAppChatToolOverride
} from './geoapp-chat-policy-service';
import { GeoAppAiToolCatalogEntry, GeoAppAiToolCategory, GeoAppAiToolRisk } from './geoapp-chat-tool-catalog';
import { GeoAppChatSkillMetadata, GeoAppChatSkills } from './geoapp-chat-skills';
import { GeoAppChatSkillExport, GeoAppChatSkillState, GeoAppChatSkillStateService } from './geoapp-chat-skill-state-service';
import { GeoAppChatPromptVariantByPack, GeoAppChatSystemPromptVariants } from './geoapp-chat-system-prompts';
import { GEOAPP_CHAT_POLICY_DEFAULTS, GeoAppChatConfigurationService } from './geoapp-chat-configuration-service';

const WORKFLOW_OPTIONS: Array<{ value: GeoAppChatWorkflowKind; label: string }> = [
    { value: 'general', label: 'General' },
    { value: 'secret_code', label: 'Codes secrets' },
    { value: 'formula', label: 'Formules' },
    { value: 'checker', label: 'Checkers' },
    { value: 'hidden_content', label: 'Contenu cache' },
    { value: 'image_puzzle', label: 'Images / OCR' },
];

const BEHAVIOR_OPTIONS: Array<{ value: GeoAppChatWorkflowBehaviorProfile; label: string }> = [
    { value: 'default', label: 'Preference effective' },
    { value: 'guided', label: 'Guided' },
    { value: 'safe', label: 'Safe' },
    { value: 'offline', label: 'Offline' },
    { value: 'automation', label: 'Automation' },
    { value: 'debug', label: 'Debug' },
];

const SKILL_PACK_OPTIONS: Array<{ value: GeoAppChatSkillPack; label: string }> = [
    { value: 'workflow', label: 'Workflow' },
    { value: 'minimal', label: 'Minimal' },
    { value: 'full', label: 'Full' },
    { value: 'disabled', label: 'Disabled' },
];

const CATEGORY_ORDER: GeoAppAiToolCategory[] = [
    'workflow',
    'metasolver',
    'formula',
    'coordinates',
    'checkers',
    'image',
    'web',
    'plugins',
    'debug',
];

type GeoAppChatToolStatusFilter = 'all' | 'enabled' | 'confirm' | 'blocked';
type GeoAppChatToolSkillFilter = 'all' | 'recommended' | 'blocked_recommended';

interface GeoAppChatPromptPackRow {
    pack: string;
    variantId: string;
    name: string;
    description?: string;
    template: string;
    isCustomized: boolean;
}

interface GeoAppChatPromptPackExport {
    pack: string;
    variantId: string;
    name: string;
    description?: string;
    template: string;
    isCustomized: boolean;
}

interface GeoAppChatConfigurationExport {
    type: 'geoapp-chat-configuration';
    version: 3;
    exportedAt: string;
    policy: Record<string, unknown>;
    promptPacks: GeoAppChatPromptPackExport[];
    skills: GeoAppChatSkillExport[];
}

const RISK_OPTIONS: Array<{ value: 'all' | GeoAppAiToolRisk; label: string }> = [
    { value: 'all', label: 'Tous les risques' },
    { value: 'read_only', label: 'Lecture' },
    { value: 'local_write', label: 'Écriture locale' },
    { value: 'network', label: 'Réseau' },
    { value: 'auth', label: 'Auth' },
    { value: 'high', label: 'Élevé' },
];

const STATUS_OPTIONS: Array<{ value: GeoAppChatToolStatusFilter; label: string }> = [
    { value: 'all', label: 'Tous les statuts' },
    { value: 'enabled', label: 'Actifs' },
    { value: 'confirm', label: 'Confirmation' },
    { value: 'blocked', label: 'Bloqués' },
];

const SKILL_RECOMMENDATION_OPTIONS: Array<{ value: GeoAppChatToolSkillFilter; label: string }> = [
    { value: 'all', label: 'Toutes les recommandations' },
    { value: 'recommended', label: 'Recommandés par skill' },
    { value: 'blocked_recommended', label: 'Recommandés mais bloqués' },
];

export const GeoAppChatPolicyCommandId = 'geoapp.chat.policy.open';

@injectable()
export class GeoAppChatPolicyWidget extends ReactWidget {

    static readonly ID = 'geoapp.chat.policy';

    protected workflowKind: GeoAppChatWorkflowKind = 'general';
    protected sessionKind: GeoAppChatSessionKind = 'auto';
    protected behaviorOverride: GeoAppChatWorkflowBehaviorProfile = 'default';
    protected importText = '';
    protected promptPreview?: GeoAppChatSystemPromptPreview;
    protected promptPreviewSignature = '';
    protected promptPreviewLoading = false;
    protected toolSearchTerm = '';
    protected toolStatusFilter: GeoAppChatToolStatusFilter = 'all';
    protected toolRiskFilter: 'all' | GeoAppAiToolRisk = 'all';
    protected toolCategoryFilter: 'all' | GeoAppAiToolCategory = 'all';
    protected toolSkillFilter: GeoAppChatToolSkillFilter = 'all';
    protected skillStates = new Map<string, GeoAppChatSkillState>();
    protected skillStatesLoading = false;
    protected skillStatesLoaded = false;
    protected selectedPromptVariantId = GeoAppChatPromptVariantByPack.guided;
    protected promptImportText = '';

    @inject(SkillService) @optional()
    protected readonly skillService: SkillService | undefined;

    @inject(PromptService) @optional()
    protected readonly promptService: PromptService | undefined;

    @inject(PromptFragmentCustomizationService) @optional()
    protected readonly promptCustomizationService: PromptFragmentCustomizationService | undefined;

    constructor(
        @inject(GeoAppChatPolicyService) protected readonly chatPolicyService: GeoAppChatPolicyService,
        @inject(GeoAppChatConfigurationService) protected readonly chatConfigurationService: GeoAppChatConfigurationService,
        @inject(GeoAppChatSkillStateService) protected readonly skillStateService: GeoAppChatSkillStateService,
        @inject(PreferenceService) protected readonly preferenceService: PreferenceService,
        @inject(MessageService) protected readonly messages: MessageService,
        @inject(CommandService) protected readonly commandService: CommandService,
    ) {
        super();
        this.id = GeoAppChatPolicyWidget.ID;
        this.title.label = 'Policy Chat IA';
        this.title.caption = 'Policy effective et tools GeoApp exposes au modele';
        this.title.closable = true;
        this.title.iconClass = 'codicon codicon-tools';
        this.addClass('geoapp-chat-policy-widget');
    }

    @postConstruct()
    protected init(): void {
        this.preferenceService.onPreferenceChanged(event => {
            if (event.preferenceName?.startsWith('geoApp.chat.')) {
                this.update();
            }
        });
        this.skillService?.onSkillsChanged(() => {
            this.skillStatesLoaded = false;
            this.update();
        });
        this.update();
    }

    protected render(): React.ReactNode {
        const policy = this.resolvePreviewPolicy();
        this.ensureSkillStates();
        this.ensurePromptPreview(policy);
        const skillRecommendations = this.getActiveSkillRecommendations(policy);
        const filteredEntries = this.filterEntries(policy.entries, policy, skillRecommendations);
        const entriesByCategory = this.groupEntries(filteredEntries);
        const enabledCount = policy.enabledToolIds.size;
        const confirmCount = policy.confirmToolIds.size;
        const disabledCount = policy.disabledToolIds.size;

        return (
            <div className='geoapp-chat-policy-root'>
                <header className='geoapp-chat-policy-header'>
                    <div>
                        <h2>Chat IA GeoApp</h2>
                        <p>Policy effective, tools exposes au modele et overrides locaux.</p>
                    </div>
                    <div className='geoapp-chat-policy-actions'>
                        <button className='theia-button secondary' type='button' onClick={() => { void this.openTheiaAiConfiguration(); }}>
                            Config IA Theia
                        </button>
                        <button className='theia-button secondary' type='button' onClick={() => { void this.exportPolicyConfiguration(); }}>
                            Exporter
                        </button>
                        <button className='theia-button secondary' type='button' onClick={() => { void this.resetPolicyConfiguration(); }}>
                            Reinitialiser
                        </button>
                    </div>
                </header>

                <section className='geoapp-chat-policy-controls'>
                    <label>
                        Workflow
                        <select value={this.workflowKind} onChange={event => this.setWorkflowKind(event.currentTarget.value as GeoAppChatWorkflowKind)}>
                            {WORKFLOW_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                        </select>
                    </label>
                    <label>
                        Session
                        <select value={this.sessionKind} onChange={event => this.setSessionKind(event.currentTarget.value as GeoAppChatSessionKind)}>
                            <option value='auto'>Auto</option>
                            <option value='libre'>Libre</option>
                        </select>
                    </label>
                    <label>
                        Profil preview
                        <select value={this.behaviorOverride} onChange={event => this.setBehaviorOverride(event.currentTarget.value as GeoAppChatWorkflowBehaviorProfile)}>
                            {BEHAVIOR_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                        </select>
                    </label>
                    <label>
                        Skill pack
                        <select value={policy.skillPack} onChange={event => { void this.setSkillPack(event.currentTarget.value as GeoAppChatSkillPack); }}>
                            {SKILL_PACK_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                        </select>
                    </label>
                </section>

                <section className='geoapp-chat-policy-summary'>
                    <div><span>Comportement</span><strong>{policy.behaviorProfile}</strong></div>
                    <div><span>Prompt pack</span><strong>{policy.promptPack}</strong></div>
                    <div><span>Workflow</span><strong>{policy.workflowKind || 'general'}</strong></div>
                    <div><span>Tools actifs</span><strong>{enabledCount}</strong></div>
                    <div><span>Confirmation</span><strong>{confirmCount}</strong></div>
                    <div><span>Bloques</span><strong>{disabledCount}</strong></div>
                    <div><span>Skills</span><strong>{policy.recommendedSkillNames.length}</strong></div>
                </section>

                {this.renderPolicyHelp()}
                {this.renderDiagnostics()}
                {this.renderPromptPreview(policy)}
                {this.renderPromptPackEditor()}

                <section className='geoapp-chat-policy-skills'>
                    <h3>Skills GeoApp actifs</h3>
                    {this.skillStatesLoading && <p className='geoapp-chat-policy-muted'>Analyse des versions de skills en cours...</p>}
                    <div className='geoapp-chat-policy-skill-badges'>
                        {policy.recommendedSkillNames.map(skillName => <span key={skillName}>{skillName}</span>)}
                    </div>
                    {this.renderSkillTable(policy)}
                </section>

                <section className='geoapp-chat-policy-import'>
                    <textarea
                        value={this.importText}
                        rows={4}
                        spellCheck={false}
                        placeholder='Coller une configuration JSON complète ou une ancienne policy JSON exportée ici...'
                        onChange={event => this.setImportText(event.currentTarget.value)}
                    />
                    <button className='theia-button secondary' type='button' disabled={!this.importText.trim()} onClick={() => { void this.importPolicyConfiguration(); }}>
                        Importer
                    </button>
                </section>

                {this.renderToolFilters(policy.entries.length, filteredEntries.length)}

                <div className='geoapp-chat-policy-matrix'>
                    {CATEGORY_ORDER.map(category => {
                        const entries = entriesByCategory.get(category) || [];
                        if (!entries.length) {
                            return undefined;
                        }
                        return this.renderCategoryTable(category, entries, policy, skillRecommendations);
                    })}
                    {!filteredEntries.length && (
                        <section className='geoapp-chat-policy-empty'>
                            Aucun tool ne correspond aux filtres courants.
                        </section>
                    )}
                </div>
            </div>
        );
    }

    protected renderPromptPackEditor(): React.ReactNode {
        const promptRows = this.getPromptPackRows();
        const selectedRow = promptRows.find(row => row.variantId === this.selectedPromptVariantId) || promptRows[0];
        return (
            <section className='geoapp-chat-policy-prompt-editor'>
                <header>
                    <div>
                        <h3>Prompt packs GeoApp</h3>
                        <p>Consulter, éditer, exporter, importer ou réinitialiser les variantes utilisées par le Chat IA.</p>
                    </div>
                    <div className='geoapp-chat-policy-prompt-editor-actions'>
                        <button className='theia-button secondary' type='button' onClick={() => { void this.editSelectedPromptPack(); }}>
                            Éditer dans Theia
                        </button>
                        <button className='theia-button secondary' type='button' onClick={() => { void this.resetSelectedPromptPack(); }}>
                            Reset GeoApp
                        </button>
                        <button className='theia-button secondary' type='button' onClick={() => { void this.exportSelectedPromptPack(); }}>
                            Exporter
                        </button>
                    </div>
                </header>
                <div className='geoapp-chat-policy-prompt-editor-body'>
                    <div className='geoapp-chat-policy-prompt-list'>
                        {promptRows.map(row => (
                            <button
                                key={row.variantId}
                                className={row.variantId === selectedRow.variantId ? 'selected' : ''}
                                type='button'
                                onClick={() => this.setSelectedPromptVariantId(row.variantId)}
                            >
                                <strong>{row.pack}</strong>
                                <span>{row.name}</span>
                                <em>{row.isCustomized ? 'Personnalisé' : 'GeoApp'}</em>
                            </button>
                        ))}
                    </div>
                    <div className='geoapp-chat-policy-prompt-detail'>
                        <div className='geoapp-chat-policy-prompt-detail-meta'>
                            <span>Variant: <strong>{selectedRow.variantId}</strong></span>
                            <span>{selectedRow.isCustomized ? 'Version personnalisée active' : 'Version GeoApp active'}</span>
                        </div>
                        <p>{selectedRow.description || 'Aucune description.'}</p>
                        <details open>
                            <summary>Contenu effectif</summary>
                            <pre>{selectedRow.template || 'Prompt indisponible.'}</pre>
                        </details>
                        <details>
                            <summary>Importer un contenu pour ce prompt pack</summary>
                            <textarea
                                value={this.promptImportText}
                                rows={8}
                                spellCheck={false}
                                placeholder='Coller ici le contenu complet du prompt à importer...'
                                onChange={event => this.setPromptImportText(event.currentTarget.value)}
                            />
                            <button
                                className='theia-button secondary'
                                type='button'
                                disabled={!this.promptImportText.trim()}
                                onClick={() => { void this.importSelectedPromptPack(); }}
                            >
                                Importer comme personnalisation
                            </button>
                        </details>
                    </div>
                </div>
            </section>
        );
    }

    protected renderPolicyHelp(): React.ReactNode {
        return (
            <section className='geoapp-chat-policy-help'>
                <details>
                    <summary>Aide rapide : profils, skills et overrides</summary>
                    <div className='geoapp-chat-policy-help-grid'>
                        <article>
                            <h3>Profils comportement</h3>
                            <dl>
                                <dt>guided</dt>
                                <dd>Mode recommandé : aide active, confirmation sur les actions sensibles.</dd>
                                <dt>safe</dt>
                                <dd>Mode prudent : moins d'automatisation, davantage de blocages.</dd>
                                <dt>offline</dt>
                                <dd>Mode local : évite réseau, auth, checkers et services externes.</dd>
                                <dt>automation</dt>
                                <dd>Mode rapide : exécute davantage d'étapes quand les données suffisent.</dd>
                                <dt>debug</dt>
                                <dd>Mode diagnostic : expose plus d'informations pour comprendre le routage.</dd>
                            </dl>
                        </article>
                        <article>
                            <h3>Packs de skills</h3>
                            <dl>
                                <dt>workflow</dt>
                                <dd>GeoApp choisit les skills selon le type d'énigme détecté.</dd>
                                <dt>minimal</dt>
                                <dd>Charge seulement les skills essentielles pour limiter le bruit.</dd>
                                <dt>full</dt>
                                <dd>Expose toutes les skills GeoApp au chat.</dd>
                                <dt>disabled</dt>
                                <dd>Désactive les skills, sauf override manuel.</dd>
                            </dl>
                        </article>
                        <article>
                            <h3>Overrides tools</h3>
                            <dl>
                                <dt>default</dt>
                                <dd>Utilise la règle normale du profil courant.</dd>
                                <dt>enabled</dt>
                                <dd>Force l'exposition du tool au modèle.</dd>
                                <dt>confirm</dt>
                                <dd>Autorise le tool, mais garde une confirmation Theia.</dd>
                                <dt>disabled</dt>
                                <dd>Retire le tool de ce que l'IA peut utiliser.</dd>
                            </dl>
                        </article>
                        <article>
                            <h3>États des skills</h3>
                            <dl>
                                <dt>GeoApp</dt>
                                <dd>La version active correspond à la version intégrée.</dd>
                                <dt>Personnalisée</dt>
                                <dd>Le fichier a été modifié par l'utilisateur et n'est pas écrasé automatiquement.</dd>
                                <dt>À mettre à jour</dt>
                                <dd>La skill est gérée par GeoApp, mais diffère de la version actuelle.</dd>
                                <dt>Non découverte</dt>
                                <dd>Le fichier existe, mais Theia ne l'a pas encore chargé.</dd>
                            </dl>
                        </article>
                    </div>
                </details>
            </section>
        );
    }

    protected renderDiagnostics(): React.ReactNode {
        const diagnostics = this.promptPreview?.diagnostics || [];
        return (
            <section className='geoapp-chat-policy-diagnostics'>
                <h3>Diagnostic runtime</h3>
                {this.promptPreviewLoading && <p className='geoapp-chat-policy-muted'>Résolution du diagnostic en cours...</p>}
                {!this.promptPreviewLoading && diagnostics.length === 0 && (
                    <p className='geoapp-chat-policy-ok'>Aucun problème détecté pour cette policy.</p>
                )}
                {diagnostics.map((diagnostic, index) => this.renderDiagnostic(diagnostic, index))}
            </section>
        );
    }

    protected renderDiagnostic(diagnostic: GeoAppChatPolicyDiagnostic, index: number): React.ReactNode {
        return (
            <article key={`${diagnostic.title}:${index}`} className={`geoapp-chat-policy-diagnostic ${diagnostic.severity}`}>
                <strong>{this.formatDiagnosticSeverity(diagnostic.severity)} - {diagnostic.title}</strong>
                <p>{diagnostic.message}</p>
                {diagnostic.details?.length ? (
                    <ul>
                        {diagnostic.details.map(detail => <li key={detail}><code>{detail}</code></li>)}
                    </ul>
                ) : undefined}
            </article>
        );
    }

    protected renderPromptPreview(policy: GeoAppChatPolicy): React.ReactNode {
        const preview = this.promptPreview;
        return (
            <section className='geoapp-chat-policy-prompt-preview'>
                <header>
                    <div>
                        <h3>Aperçu du prompt final</h3>
                        <p>Prompt système résolu par Theia, policy injectée et tools référencés par le prompt.</p>
                    </div>
                    <div className='geoapp-chat-policy-prompt-meta'>
                        <span>Variant: <strong>{preview?.promptVariantId || policy.promptPack}</strong></span>
                        <span>{preview?.isPromptVariantCustomized ? 'Personnalisé' : 'GeoApp par défaut'}</span>
                    </div>
                </header>
                {this.promptPreviewLoading && <p className='geoapp-chat-policy-muted'>Résolution du prompt en cours...</p>}
                {preview && !this.promptPreviewLoading && (
                    <>
                        <details open>
                            <summary>Prompt final envoyé au modèle</summary>
                            <pre>{preview.finalPromptText}</pre>
                        </details>
                        <details>
                            <summary>Policy injectée seule</summary>
                            <pre>{preview.policyPromptText}</pre>
                        </details>
                        <details>
                            <summary>Tools référencés par le prompt système ({preview.functionToolNames.length})</summary>
                            {preview.functionToolNames.length ? (
                                <div className='geoapp-chat-policy-tool-list compact'>
                                    {preview.functionToolNames.map(name => <code key={name}>{name}</code>)}
                                </div>
                            ) : (
                                <p className='geoapp-chat-policy-muted'>Aucun tool référencé directement par le prompt résolu.</p>
                            )}
                        </details>
                    </>
                )}
            </section>
        );
    }

    protected renderToolFilters(totalCount: number, filteredCount: number): React.ReactNode {
        return (
            <section className='geoapp-chat-policy-tool-filters'>
                <header>
                    <h3>Matrice des tools</h3>
                    <span>{filteredCount} / {totalCount} tools affichés</span>
                </header>
                <div className='geoapp-chat-policy-tool-filter-grid'>
                    <label>
                        Recherche
                        <input
                            type='search'
                            value={this.toolSearchTerm}
                            placeholder='Nom, registry ID, description, skill...'
                            onChange={event => this.setToolSearchTerm(event.currentTarget.value)}
                        />
                    </label>
                    <label>
                        Statut
                        <select value={this.toolStatusFilter} onChange={event => this.setToolStatusFilter(event.currentTarget.value as GeoAppChatToolStatusFilter)}>
                            {STATUS_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                        </select>
                    </label>
                    <label>
                        Risque
                        <select value={this.toolRiskFilter} onChange={event => this.setToolRiskFilter(event.currentTarget.value as 'all' | GeoAppAiToolRisk)}>
                            {RISK_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                        </select>
                    </label>
                    <label>
                        Catégorie
                        <select value={this.toolCategoryFilter} onChange={event => this.setToolCategoryFilter(event.currentTarget.value as 'all' | GeoAppAiToolCategory)}>
                            <option value='all'>Toutes les catégories</option>
                            {CATEGORY_ORDER.map(category => <option key={category} value={category}>{this.formatCategory(category)}</option>)}
                        </select>
                    </label>
                    <label>
                        Skills
                        <select value={this.toolSkillFilter} onChange={event => this.setToolSkillFilter(event.currentTarget.value as GeoAppChatToolSkillFilter)}>
                            {SKILL_RECOMMENDATION_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                        </select>
                    </label>
                    <button className='theia-button secondary' type='button' onClick={() => this.resetToolFilters()}>
                        Réinitialiser filtres
                    </button>
                </div>
            </section>
        );
    }

    protected renderCategoryTable(
        category: GeoAppAiToolCategory,
        entries: GeoAppAiToolCatalogEntry[],
        policy: GeoAppChatPolicy,
        skillRecommendations: Map<string, GeoAppChatSkillMetadata[]>
    ): React.ReactNode {
        return (
            <section key={category} className='geoapp-chat-policy-category'>
                <h3>{this.formatCategory(category)}</h3>
                <table>
                    <thead>
                        <tr>
                            <th>Statut</th>
                            <th>Tool</th>
                            <th>Registry ID</th>
                            <th>Risque</th>
                            <th>Flags</th>
                            <th>Skills</th>
                            <th>Override</th>
                        </tr>
                    </thead>
                    <tbody>
                        {entries.map(entry => this.renderToolRow(entry, policy, skillRecommendations))}
                    </tbody>
                </table>
            </section>
        );
    }

    protected renderToolRow(
        entry: GeoAppAiToolCatalogEntry,
        policy: GeoAppChatPolicy,
        skillRecommendations: Map<string, GeoAppChatSkillMetadata[]>
    ): React.ReactNode {
        const status = this.getToolStatus(entry, policy);
        const override = this.getToolOverride(entry.registryId);
        const recommendingSkills = skillRecommendations.get(entry.registryId) || [];
        const blockedRecommendedTool = recommendingSkills.length > 0 && !policy.enabledToolIds.has(entry.registryId);
        return (
            <tr key={entry.registryId}>
                <td>
                    <span className={`geoapp-chat-policy-status ${status.kind}`}>{status.label}</span>
                </td>
                <td>
                    <strong>{entry.publicName}</strong>
                    {entry.description && <small>{entry.description}</small>}
                </td>
                <td><code>{entry.registryId}</code></td>
                <td><span className={`geoapp-chat-policy-risk ${entry.risk}`}>{this.formatRisk(entry.risk)}</span></td>
                <td>{this.renderFlags(entry)}</td>
                <td>{this.renderToolSkillRecommendations(recommendingSkills, blockedRecommendedTool)}</td>
                <td>
                    <select
                        value={override}
                        onChange={event => { void this.setToolOverride(entry.registryId, event.currentTarget.value as GeoAppChatToolOverride); }}
                    >
                        <option value='default'>default</option>
                        <option value='enabled'>enabled</option>
                        <option value='disabled'>disabled</option>
                        <option value='confirm'>confirm</option>
                    </select>
                </td>
            </tr>
        );
    }

    protected renderToolSkillRecommendations(recommendingSkills: GeoAppChatSkillMetadata[], blockedRecommendedTool: boolean): React.ReactNode {
        if (!recommendingSkills.length) {
            return <span className='geoapp-chat-policy-muted'>-</span>;
        }
        return (
            <div className='geoapp-chat-policy-skill-recommendations'>
                {blockedRecommendedTool && <span className='blocked-recommendation'>Skill recommande, tool bloqué</span>}
                {recommendingSkills.map(skill => <span key={skill.name}>{skill.name}</span>)}
            </div>
        );
    }

    protected renderSkillTable(policy: GeoAppChatPolicy): React.ReactNode {
        return (
            <table className='geoapp-chat-policy-skill-table'>
                <thead>
                    <tr>
                        <th>Statut</th>
                        <th>Skill</th>
                        <th>Version</th>
                        <th>Workflows</th>
                        <th>Tools associes</th>
                        <th>Override</th>
                        <th>Action</th>
                    </tr>
                </thead>
                <tbody>
                    {policy.skillEntries.map(skill => this.renderSkillRow(skill, policy))}
                </tbody>
            </table>
        );
    }

    protected renderSkillRow(skill: GeoAppChatSkillMetadata, policy: GeoAppChatPolicy): React.ReactNode {
        const enabled = policy.recommendedSkillNames.includes(skill.name);
        const override = this.getSkillOverride(skill.name);
        const state = this.skillStates.get(skill.name);
        return (
            <tr key={skill.name}>
                <td>
                    <span className={`geoapp-chat-policy-status ${enabled ? 'enabled' : 'blocked'}`}>
                        {enabled ? 'Actif' : 'Bloque'}
                    </span>
                </td>
                <td>
                    <strong>{skill.name}</strong>
                    <small>{skill.description}</small>
                    {state?.location && <small className='geoapp-chat-policy-path'>{state.location}</small>}
                </td>
                <td>{this.renderSkillState(state)}</td>
                <td>{skill.workflows.join(', ')}</td>
                <td>
                    <div className='geoapp-chat-policy-tool-list'>
                        {skill.toolRegistryIds.map(toolId => <code key={toolId}>{toolId}</code>)}
                    </div>
                </td>
                <td>
                    <select
                        value={override}
                        onChange={event => { void this.setSkillOverride(skill.name, event.currentTarget.value as GeoAppChatSkillOverride); }}
                    >
                        <option value='default'>default</option>
                        <option value='enabled'>enabled</option>
                        <option value='disabled'>disabled</option>
                    </select>
                </td>
                <td>{this.renderSkillAction(skill, state)}</td>
            </tr>
        );
    }

    protected renderSkillState(state: GeoAppChatSkillState | undefined): React.ReactNode {
        if (!state) {
            return <span className='geoapp-chat-policy-muted'>Analyse...</span>;
        }
        return (
            <div className='geoapp-chat-policy-skill-state'>
                <span className={`geoapp-chat-policy-skill-state-badge ${state.status}`}>
                    {this.formatSkillState(state.status)}
                </span>
                <small>{state.message}</small>
            </div>
        );
    }

    protected renderSkillAction(skill: GeoAppChatSkillMetadata, state: GeoAppChatSkillState | undefined): React.ReactNode {
        if (!state || state.status === 'geoapp_default') {
            return <span className='geoapp-chat-policy-muted'>-</span>;
        }
        return (
            <button className='theia-button secondary' type='button' onClick={() => { void this.restoreGeoAppSkill(skill, state); }}>
                Restaurer GeoApp
            </button>
        );
    }

    protected renderFlags(entry: GeoAppAiToolCatalogEntry): React.ReactNode {
        const flags = [
            entry.defaultEnabled ? 'default' : undefined,
            entry.network ? 'network' : undefined,
            entry.writesLocal ? 'write' : undefined,
            entry.requiresAuth ? 'auth' : undefined,
            entry.dynamic ? 'dynamic' : undefined,
        ].filter((value): value is string => Boolean(value));

        if (!flags.length) {
            return <span className='geoapp-chat-policy-muted'>-</span>;
        }

        return (
            <div className='geoapp-chat-policy-flags'>
                {flags.map(flag => <span key={flag}>{flag}</span>)}
            </div>
        );
    }

    protected resolvePreviewPolicy(): GeoAppChatPolicy {
        const geoapp: Record<string, unknown> = {
            workflowKind: this.workflowKind,
            sessionKind: this.sessionKind,
        };
        if (this.behaviorOverride !== 'default') {
            geoapp.preferredBehaviorProfile = this.behaviorOverride;
        }
        return this.chatPolicyService.resolvePolicy({
            session: {
                settings: {
                    commonSettings: { geoapp },
                },
            },
        } as any);
    }

    protected ensurePromptPreview(policy: GeoAppChatPolicy): void {
        const signature = this.getPromptPreviewSignature(policy);
        if (signature === this.promptPreviewSignature || this.promptPreviewLoading) {
            return;
        }
        this.promptPreviewSignature = signature;
        this.promptPreviewLoading = true;
        void this.chatPolicyService.resolveSystemPromptPreview(policy, undefined, this.getRuntimeDiagnosticOptions())
            .then(preview => {
                if (this.promptPreviewSignature === signature) {
                    this.promptPreview = preview;
                    this.promptPreviewLoading = false;
                    this.update();
                }
            })
            .catch(error => {
                console.error('[GeoAppChatPolicyWidget] Failed to resolve prompt preview', error);
                if (this.promptPreviewSignature === signature) {
                    this.promptPreview = undefined;
                    this.promptPreviewLoading = false;
                    this.update();
                }
            });
    }

    protected getPromptPreviewSignature(policy: GeoAppChatPolicy): string {
        return JSON.stringify({
            workflowKind: policy.workflowKind,
            sessionKind: policy.sessionKind,
            behaviorProfile: policy.behaviorProfile,
            promptPack: policy.promptPack,
            skillPack: policy.skillPack,
            enabledToolIds: Array.from(policy.enabledToolIds).sort(),
            confirmToolIds: Array.from(policy.confirmToolIds).sort(),
            disabledToolIds: Array.from(policy.disabledToolIds).sort(),
            recommendedSkillNames: [...policy.recommendedSkillNames].sort(),
            discoveredSkillNames: this.skillService?.getSkills().map(skill => skill.name).sort(),
        });
    }

    protected getRuntimeDiagnosticOptions(): GeoAppChatRuntimeDiagnosticOptions {
        return {
            skillServiceAvailable: Boolean(this.skillService),
            discoveredSkillNames: this.skillService?.getSkills().map(skill => skill.name),
        };
    }

    protected ensureSkillStates(): void {
        if (this.skillStatesLoaded || this.skillStatesLoading) {
            return;
        }
        this.skillStatesLoading = true;
        void this.skillStateService.getSkillStates()
            .then(states => {
                this.skillStates = states;
                this.skillStatesLoaded = true;
                this.skillStatesLoading = false;
                this.update();
            })
            .catch(error => {
                console.error('[GeoAppChatPolicyWidget] Failed to inspect GeoApp skill states', error);
                this.skillStatesLoading = false;
                this.update();
            });
    }

    protected groupEntries(entries: GeoAppAiToolCatalogEntry[]): Map<GeoAppAiToolCategory, GeoAppAiToolCatalogEntry[]> {
        const groups = new Map<GeoAppAiToolCategory, GeoAppAiToolCatalogEntry[]>();
        for (const entry of entries) {
            const current = groups.get(entry.category) || [];
            current.push(entry);
            groups.set(entry.category, current);
        }
        return groups;
    }

    protected filterEntries(
        entries: GeoAppAiToolCatalogEntry[],
        policy: GeoAppChatPolicy,
        skillRecommendations: Map<string, GeoAppChatSkillMetadata[]>
    ): GeoAppAiToolCatalogEntry[] {
        const searchTerm = this.toolSearchTerm.trim().toLowerCase();
        return entries.filter(entry => {
            const status = this.getToolStatus(entry, policy).kind as GeoAppChatToolStatusFilter;
            const recommendingSkills = skillRecommendations.get(entry.registryId) || [];
            const isBlockedRecommended = recommendingSkills.length > 0 && !policy.enabledToolIds.has(entry.registryId);

            if (this.toolStatusFilter !== 'all' && status !== this.toolStatusFilter) {
                return false;
            }
            if (this.toolRiskFilter !== 'all' && entry.risk !== this.toolRiskFilter) {
                return false;
            }
            if (this.toolCategoryFilter !== 'all' && entry.category !== this.toolCategoryFilter) {
                return false;
            }
            if (this.toolSkillFilter === 'recommended' && !recommendingSkills.length) {
                return false;
            }
            if (this.toolSkillFilter === 'blocked_recommended' && !isBlockedRecommended) {
                return false;
            }
            if (!searchTerm) {
                return true;
            }

            const searchable = [
                entry.publicName,
                entry.registryId,
                entry.description,
                entry.category,
                entry.risk,
                entry.provider,
                ...recommendingSkills.map(skill => skill.name),
                ...recommendingSkills.map(skill => skill.label),
            ].filter((value): value is string => Boolean(value)).join(' ').toLowerCase();
            return searchable.includes(searchTerm);
        });
    }

    protected getActiveSkillRecommendations(policy: GeoAppChatPolicy): Map<string, GeoAppChatSkillMetadata[]> {
        const recommendations = new Map<string, GeoAppChatSkillMetadata[]>();
        const activeSkillNames = new Set(policy.recommendedSkillNames);
        for (const skill of policy.skillEntries) {
            if (!activeSkillNames.has(skill.name)) {
                continue;
            }
            for (const toolId of skill.toolRegistryIds) {
                const current = recommendations.get(toolId) || [];
                current.push(skill);
                recommendations.set(toolId, current);
            }
        }
        return recommendations;
    }

    protected getToolStatus(entry: GeoAppAiToolCatalogEntry, policy: GeoAppChatPolicy): { kind: string; label: string } {
        if (!policy.enabledToolIds.has(entry.registryId)) {
            return { kind: 'blocked', label: 'Bloque' };
        }
        if (policy.confirmToolIds.has(entry.registryId)) {
            return { kind: 'confirm', label: 'Confirmation' };
        }
        return { kind: 'enabled', label: 'Actif' };
    }

    protected setWorkflowKind(value: GeoAppChatWorkflowKind): void {
        this.workflowKind = value;
        this.update();
    }

    protected setSessionKind(value: GeoAppChatSessionKind): void {
        this.sessionKind = value;
        this.update();
    }

    protected setBehaviorOverride(value: GeoAppChatWorkflowBehaviorProfile): void {
        this.behaviorOverride = value;
        this.update();
    }

    protected async setSkillPack(value: GeoAppChatSkillPack): Promise<void> {
        await this.preferenceService.set(GEOAPP_CHAT_SKILL_PACK_PREF, value, PreferenceScope.User);
        this.update();
    }

    protected setImportText(value: string): void {
        this.importText = value;
        this.update();
    }

    protected setToolSearchTerm(value: string): void {
        this.toolSearchTerm = value;
        this.update();
    }

    protected setToolStatusFilter(value: GeoAppChatToolStatusFilter): void {
        this.toolStatusFilter = value;
        this.update();
    }

    protected setToolRiskFilter(value: 'all' | GeoAppAiToolRisk): void {
        this.toolRiskFilter = value;
        this.update();
    }

    protected setToolCategoryFilter(value: 'all' | GeoAppAiToolCategory): void {
        this.toolCategoryFilter = value;
        this.update();
    }

    protected setToolSkillFilter(value: GeoAppChatToolSkillFilter): void {
        this.toolSkillFilter = value;
        this.update();
    }

    protected resetToolFilters(): void {
        this.toolSearchTerm = '';
        this.toolStatusFilter = 'all';
        this.toolRiskFilter = 'all';
        this.toolCategoryFilter = 'all';
        this.toolSkillFilter = 'all';
        this.update();
    }

    protected setSelectedPromptVariantId(value: string): void {
        this.selectedPromptVariantId = value;
        this.promptImportText = '';
        this.update();
    }

    protected setPromptImportText(value: string): void {
        this.promptImportText = value;
        this.update();
    }

    protected async restoreGeoAppSkill(skill: GeoAppChatSkillMetadata, state: GeoAppChatSkillState): Promise<void> {
        const shouldConfirm = state.status === 'customized';
        if (shouldConfirm && typeof window !== 'undefined' && !window.confirm(
            `La skill ${skill.name} semble personnalisée. Restaurer la version GeoApp remplacera le contenu actuel du fichier actif. Continuer ?`
        )) {
            return;
        }
        try {
            await this.skillStateService.restoreGeoAppSkill(skill.name);
            this.skillStatesLoaded = false;
            this.promptPreviewSignature = '';
            this.messages.info(`Skill ${skill.name} restaurée avec la version GeoApp.`);
            this.update();
        } catch (error) {
            console.error('[GeoAppChatPolicyWidget] Failed to restore GeoApp skill', error);
            this.messages.error(`Impossible de restaurer la skill ${skill.name}.`);
        }
    }

    protected getPromptPackRows(): GeoAppChatPromptPackRow[] {
        return Object.entries(GeoAppChatPromptVariantByPack).map(([pack, variantId]) => {
            const fragment = this.promptService?.getPromptFragment(variantId);
            const builtIn = this.getBuiltInPromptVariant(variantId);
            return {
                pack,
                variantId,
                name: fragment?.name || builtIn?.name || variantId,
                description: fragment?.description || builtIn?.description,
                template: fragment?.template || builtIn?.template || '',
                isCustomized: Boolean(fragment && isCustomizedPromptFragment(fragment)),
            };
        });
    }

    protected getBuiltInPromptVariant(variantId: string): PromptFragment | undefined {
        if (GeoAppChatSystemPromptVariants.defaultVariant.id === variantId) {
            return GeoAppChatSystemPromptVariants.defaultVariant;
        }
        return GeoAppChatSystemPromptVariants.variants?.find(variant => variant.id === variantId);
    }

    protected async editSelectedPromptPack(): Promise<void> {
        if (!this.promptService) {
            this.messages.warn('PromptService Theia indisponible.');
            return;
        }
        await this.promptService.editBuiltInCustomization(this.selectedPromptVariantId);
    }

    protected async resetSelectedPromptPack(): Promise<void> {
        if (!this.promptService) {
            this.messages.warn('PromptService Theia indisponible.');
            return;
        }
        if (typeof window !== 'undefined' && !window.confirm(
            `Réinitialiser ${this.selectedPromptVariantId} supprimera sa personnalisation et reviendra à la version GeoApp. Continuer ?`
        )) {
            return;
        }
        await this.promptService.resetToBuiltIn(this.selectedPromptVariantId);
        this.promptPreviewSignature = '';
        this.messages.info('Prompt pack réinitialisé avec la version GeoApp.');
        this.update();
    }

    protected async exportSelectedPromptPack(): Promise<void> {
        const row = this.getPromptPackRows().find(candidate => candidate.variantId === this.selectedPromptVariantId);
        if (!row) {
            this.messages.warn('Prompt pack introuvable.');
            return;
        }
        const serialized = JSON.stringify({
            type: 'geoapp-chat-prompt-pack',
            version: 1,
            pack: row.pack,
            variantId: row.variantId,
            name: row.name,
            description: row.description,
            template: row.template,
        }, null, 2);
        try {
            await navigator.clipboard.writeText(serialized);
            this.messages.info('Prompt pack copié dans le presse-papiers.');
        } catch (error) {
            console.warn('[GeoAppChatPolicyWidget] Prompt pack export clipboard failed', error);
            this.promptImportText = serialized;
            this.messages.warn('Impossible de copier automatiquement; l’export est affiché dans le champ import.');
            this.update();
        }
    }

    protected async importSelectedPromptPack(): Promise<void> {
        if (!this.promptCustomizationService) {
            this.messages.warn('Service de personnalisation des prompts indisponible.');
            return;
        }
        const importedTemplate = this.parsePromptImportText(this.promptImportText);
        if (!importedTemplate.trim()) {
            this.messages.warn('Contenu de prompt vide.');
            return;
        }
        if (typeof window !== 'undefined' && !window.confirm(
            `Importer ce contenu remplacera la personnalisation active de ${this.selectedPromptVariantId}. Continuer ?`
        )) {
            return;
        }
        await this.promptCustomizationService.removeAllPromptFragmentCustomizations(this.selectedPromptVariantId);
        await this.promptCustomizationService.createBuiltInPromptFragmentCustomization(this.selectedPromptVariantId, importedTemplate);
        this.promptImportText = '';
        this.promptPreviewSignature = '';
        this.messages.info('Prompt pack importé comme personnalisation Theia.');
        this.update();
    }

    protected parsePromptImportText(value: string): string {
        const trimmed = value.trim();
        if (!trimmed) {
            return '';
        }
        try {
            const parsed = JSON.parse(trimmed);
            if (
                parsed &&
                typeof parsed === 'object' &&
                !Array.isArray(parsed) &&
                typeof (parsed as { template?: unknown }).template === 'string'
            ) {
                return (parsed as { template: string }).template;
            }
        } catch {
            // Plain text imports are supported.
        }
        return value;
    }

    protected getToolOverrides(): Record<string, GeoAppChatToolOverride | boolean> {
        const raw = this.preferenceService.get(GEOAPP_CHAT_TOOL_POLICY_OVERRIDES_PREF, {});
        if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
            return { ...(raw as Record<string, GeoAppChatToolOverride | boolean>) };
        }
        if (typeof raw === 'string' && raw.trim()) {
            try {
                const parsed = JSON.parse(raw);
                if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                    return parsed as Record<string, GeoAppChatToolOverride | boolean>;
                }
            } catch {
                return {};
            }
        }
        return {};
    }

    protected getSkillOverrides(): Record<string, GeoAppChatSkillOverride | boolean> {
        const raw = this.preferenceService.get(GEOAPP_CHAT_SKILL_POLICY_OVERRIDES_PREF, {});
        if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
            return { ...(raw as Record<string, GeoAppChatSkillOverride | boolean>) };
        }
        if (typeof raw === 'string' && raw.trim()) {
            try {
                const parsed = JSON.parse(raw);
                if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                    return parsed as Record<string, GeoAppChatSkillOverride | boolean>;
                }
            } catch {
                return {};
            }
        }
        return {};
    }

    protected getToolOverride(registryId: string): GeoAppChatToolOverride {
        const override = this.getToolOverrides()[registryId];
        if (override === 'enabled' || override === 'disabled' || override === 'confirm' || override === 'default') {
            return override;
        }
        if (override === true) {
            return 'enabled';
        }
        if (override === false) {
            return 'disabled';
        }
        return 'default';
    }

    protected getSkillOverride(skillName: string): GeoAppChatSkillOverride {
        const override = this.getSkillOverrides()[skillName];
        if (override === 'enabled' || override === 'disabled' || override === 'default') {
            return override;
        }
        if (override === true) {
            return 'enabled';
        }
        if (override === false) {
            return 'disabled';
        }
        return 'default';
    }

    protected async setToolOverride(registryId: string, value: GeoAppChatToolOverride): Promise<void> {
        const overrides = this.getToolOverrides();
        if (value === 'default') {
            delete overrides[registryId];
        } else {
            overrides[registryId] = value;
        }
        await this.preferenceService.set(GEOAPP_CHAT_TOOL_POLICY_OVERRIDES_PREF, overrides, PreferenceScope.User);
        this.update();
    }

    protected async setSkillOverride(skillName: string, value: GeoAppChatSkillOverride): Promise<void> {
        const overrides = this.getSkillOverrides();
        if (value === 'default') {
            delete overrides[skillName];
        } else {
            overrides[skillName] = value;
        }
        await this.preferenceService.set(GEOAPP_CHAT_SKILL_POLICY_OVERRIDES_PREF, overrides, PreferenceScope.User);
        this.update();
    }

    protected async exportPolicyConfiguration(): Promise<void> {
        const serialized = JSON.stringify(await this.chatConfigurationService.getFullConfigurationExport(), null, 2);
        try {
            await navigator.clipboard.writeText(serialized);
            this.messages.info('Configuration complète Chat IA GeoApp copiée dans le presse-papiers.');
        } catch (error) {
            console.warn('[GeoAppChatPolicyWidget] Clipboard export failed', error);
            this.importText = serialized;
            this.messages.warn('Impossible de copier automatiquement; la configuration est affichée dans le champ import/export.');
            this.update();
        }
    }

    protected async importPolicyConfiguration(): Promise<void> {
        try {
            const result = await this.chatConfigurationService.importConfiguration(this.importText, {
                confirmPromptPacks: count => typeof window === 'undefined' || window.confirm(
                    `Importer cette configuration restaurera ${count} prompt pack(s) personnalisé(s). Continuer ?`
                ),
                confirmSkills: count => typeof window === 'undefined' || window.confirm(
                    `Importer cette configuration restaurera ${count} skill(s) personnalisée(s). Continuer ?`
                ),
                confirmOverwriteSkill: skillName => typeof window === 'undefined' || window.confirm(
                    `La skill ${skillName} est déjà personnalisée localement. Remplacer son contenu par celui de l'import ?`
                ),
            });
            if (result.promptCustomizationUnavailable) {
                this.messages.warn('Service de personnalisation des prompts indisponible; les prompt packs personnalisés n’ont pas été importés.');
            }
            this.importText = '';
            this.promptPreviewSignature = '';
            this.skillStatesLoaded = false;
            this.messages.info(`Configuration Chat IA GeoApp importée (${result.importedPolicyCount} préférences, ${result.importedPromptCount} prompt packs personnalisés, ${result.importedSkillCount} skills personnalisées).`);
            this.update();
        } catch (error) {
            console.error('[GeoAppChatPolicyWidget] Import failed', error);
            this.messages.error('Configuration JSON invalide.');
        }
    }

    protected async importPromptPackCustomizationsFromConfiguration(record: Record<string, unknown>): Promise<number> {
        if (record.type !== 'geoapp-chat-configuration' || !Array.isArray(record.promptPacks)) {
            return 0;
        }
        const promptPacks = this.getPromptPackImports(record.promptPacks);
        const customizedPromptPacks = promptPacks.filter(promptPack => promptPack.isCustomized);
        if (!customizedPromptPacks.length) {
            return 0;
        }
        if (!this.promptCustomizationService) {
            this.messages.warn('Service de personnalisation des prompts indisponible; les prompt packs personnalisés n’ont pas été importés.');
            return 0;
        }
        if (typeof window !== 'undefined' && !window.confirm(
            `Importer cette configuration restaurera ${customizedPromptPacks.length} prompt pack(s) personnalisé(s). Continuer ?`
        )) {
            return 0;
        }

        let importedCount = 0;
        const knownVariantIds = new Set<string>(Object.values(GeoAppChatPromptVariantByPack));
        for (const promptPack of customizedPromptPacks) {
            if (!knownVariantIds.has(promptPack.variantId) || !promptPack.template.trim()) {
                continue;
            }
            await this.promptCustomizationService.removeAllPromptFragmentCustomizations(promptPack.variantId);
            await this.promptCustomizationService.createBuiltInPromptFragmentCustomization(promptPack.variantId, promptPack.template);
            importedCount++;
        }
        return importedCount;
    }

    protected getPromptPackImports(value: unknown[]): GeoAppChatPromptPackExport[] {
        const imports: GeoAppChatPromptPackExport[] = [];
        for (const item of value) {
            if (!item || typeof item !== 'object' || Array.isArray(item)) {
                continue;
            }
            const record = item as Record<string, unknown>;
            if (typeof record.variantId !== 'string' || typeof record.template !== 'string') {
                continue;
            }
            imports.push({
                pack: typeof record.pack === 'string' ? record.pack : record.variantId,
                variantId: record.variantId,
                name: typeof record.name === 'string' ? record.name : record.variantId,
                description: typeof record.description === 'string' ? record.description : undefined,
                template: record.template,
                isCustomized: record.isCustomized === true,
            });
        }
        return imports;
    }

    protected async importCustomSkillsFromConfiguration(record: Record<string, unknown>): Promise<number> {
        if (record.type !== 'geoapp-chat-configuration' || !Array.isArray(record.skills)) {
            return 0;
        }
        const skills = this.getCustomSkillImports(record.skills);
        if (!skills.length) {
            return 0;
        }
        if (typeof window !== 'undefined' && !window.confirm(
            `Importer cette configuration restaurera ${skills.length} skill(s) personnalisée(s). Continuer ?`
        )) {
            return 0;
        }

        let importedCount = 0;
        const currentStates = await this.skillStateService.getSkillStates();
        for (const skill of skills) {
            const currentState = this.skillStates.get(skill.name) || currentStates.get(skill.name);
            const shouldConfirmOverwrite = currentState?.status === 'customized' && typeof window !== 'undefined';
            if (shouldConfirmOverwrite && !window.confirm(
                `La skill ${skill.name} est déjà personnalisée localement. Remplacer son contenu par celui de l'import ?`
            )) {
                continue;
            }
            const imported = await this.skillStateService.importCustomSkillContent(skill.name, skill.content);
            if (imported) {
                importedCount++;
            }
        }
        return importedCount;
    }

    protected getCustomSkillImports(value: unknown[]): Array<{ name: string; content: string }> {
        const knownSkillNames = new Set<string>(GeoAppChatSkills.map(skill => skill.name));
        const imports: Array<{ name: string; content: string }> = [];
        for (const item of value) {
            if (!item || typeof item !== 'object' || Array.isArray(item)) {
                continue;
            }
            const record = item as Record<string, unknown>;
            if (
                record.isCustomized === true &&
                typeof record.name === 'string' &&
                knownSkillNames.has(record.name) &&
                typeof record.content === 'string' &&
                record.content.trim()
            ) {
                imports.push({ name: record.name, content: record.content });
            }
        }
        return imports;
    }

    protected async resetPolicyConfiguration(): Promise<void> {
        await Promise.all(Object.entries(GEOAPP_CHAT_POLICY_DEFAULTS).map(([key, value]) =>
            this.preferenceService.set(key, value, PreferenceScope.User)
        ));
        this.messages.info('Policy Chat IA GeoApp reinitialisee.');
        this.update();
    }

    protected async openTheiaAiConfiguration(): Promise<void> {
        try {
            await this.commandService.executeCommand('aiConfiguration:open');
        } catch (error) {
            console.error('[GeoAppChatPolicyWidget] Failed to open Theia AI configuration', error);
            this.messages.warn('Impossible d ouvrir la configuration IA Theia.');
        }
    }

    protected formatCategory(category: GeoAppAiToolCategory): string {
        const labels: Record<GeoAppAiToolCategory, string> = {
            workflow: 'Workflow',
            metasolver: 'Metasolver',
            formula: 'Formules',
            coordinates: 'Coordonnees',
            checkers: 'Checkers',
            image: 'Image / OCR',
            web: 'Web',
            plugins: 'Plugins dynamiques',
            debug: 'Debug',
        };
        return labels[category] || category;
    }

    protected formatRisk(risk: GeoAppAiToolRisk): string {
        const labels: Record<GeoAppAiToolRisk, string> = {
            read_only: 'lecture',
            local_write: 'ecriture locale',
            network: 'reseau',
            auth: 'auth',
            high: 'eleve',
        };
        return labels[risk] || risk;
    }

    protected formatDiagnosticSeverity(severity: GeoAppChatPolicyDiagnostic['severity']): string {
        const labels: Record<GeoAppChatPolicyDiagnostic['severity'], string> = {
            info: 'Info',
            warning: 'Attention',
            error: 'Erreur',
        };
        return labels[severity];
    }

    protected formatSkillState(status: GeoAppChatSkillState['status']): string {
        const labels: Record<GeoAppChatSkillState['status'], string> = {
            geoapp_default: 'GeoApp',
            customized: 'Personnalisée',
            outdated: 'À mettre à jour',
            missing: 'Absente',
            not_discovered: 'Non découverte',
            unreadable: 'Illisible',
        };
        return labels[status];
    }
}
