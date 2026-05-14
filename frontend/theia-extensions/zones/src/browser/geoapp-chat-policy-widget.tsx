import * as React from 'react';
import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { CommandService, MessageService } from '@theia/core';
import { PreferenceService } from '@theia/core/lib/common/preferences/preference-service';
import { PreferenceScope } from '@theia/core/lib/common/preferences/preference-scope';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';

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
import { GeoAppChatPolicy, GeoAppChatPolicyService, GeoAppChatSkillOverride, GeoAppChatToolOverride } from './geoapp-chat-policy-service';
import { GeoAppAiToolCatalogEntry, GeoAppAiToolCategory, GeoAppAiToolRisk } from './geoapp-chat-tool-catalog';
import { GeoAppChatSkillMetadata } from './geoapp-chat-skills';

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

const POLICY_DEFAULTS: Record<string, unknown> = {
    [GEOAPP_CHAT_BEHAVIOR_DEFAULT_PROFILE_PREF]: 'guided',
    [GEOAPP_CHAT_BEHAVIOR_SECRET_CODE_PROFILE_PREF]: 'default',
    [GEOAPP_CHAT_BEHAVIOR_FORMULA_PROFILE_PREF]: 'default',
    [GEOAPP_CHAT_BEHAVIOR_CHECKER_PROFILE_PREF]: 'default',
    [GEOAPP_CHAT_BEHAVIOR_HIDDEN_CONTENT_PROFILE_PREF]: 'default',
    [GEOAPP_CHAT_BEHAVIOR_IMAGE_PUZZLE_PROFILE_PREF]: 'default',
    [GEOAPP_CHAT_PROMPT_PACK_PREF]: 'guided',
    [GEOAPP_CHAT_SKILL_PACK_PREF]: 'workflow',
    [GEOAPP_CHAT_SKILL_POLICY_OVERRIDES_PREF]: {},
    [GEOAPP_CHAT_TOOL_POLICY_OVERRIDES_PREF]: {},
};

export const GeoAppChatPolicyCommandId = 'geoapp.chat.policy.open';

@injectable()
export class GeoAppChatPolicyWidget extends ReactWidget {

    static readonly ID = 'geoapp.chat.policy';

    protected workflowKind: GeoAppChatWorkflowKind = 'general';
    protected sessionKind: GeoAppChatSessionKind = 'auto';
    protected behaviorOverride: GeoAppChatWorkflowBehaviorProfile = 'default';
    protected importText = '';

    constructor(
        @inject(GeoAppChatPolicyService) protected readonly chatPolicyService: GeoAppChatPolicyService,
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
        this.update();
    }

    protected render(): React.ReactNode {
        const policy = this.resolvePreviewPolicy();
        const entriesByCategory = this.groupEntries(policy.entries);
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

                <section className='geoapp-chat-policy-skills'>
                    <h3>Skills GeoApp actifs</h3>
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
                        placeholder='Coller une configuration JSON exportee ici...'
                        onChange={event => this.setImportText(event.currentTarget.value)}
                    />
                    <button className='theia-button secondary' type='button' disabled={!this.importText.trim()} onClick={() => { void this.importPolicyConfiguration(); }}>
                        Importer
                    </button>
                </section>

                <div className='geoapp-chat-policy-matrix'>
                    {CATEGORY_ORDER.map(category => {
                        const entries = entriesByCategory.get(category) || [];
                        if (!entries.length) {
                            return undefined;
                        }
                        return this.renderCategoryTable(category, entries, policy);
                    })}
                </div>
            </div>
        );
    }

    protected renderCategoryTable(category: GeoAppAiToolCategory, entries: GeoAppAiToolCatalogEntry[], policy: GeoAppChatPolicy): React.ReactNode {
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
                            <th>Override</th>
                        </tr>
                    </thead>
                    <tbody>
                        {entries.map(entry => this.renderToolRow(entry, policy))}
                    </tbody>
                </table>
            </section>
        );
    }

    protected renderToolRow(entry: GeoAppAiToolCatalogEntry, policy: GeoAppChatPolicy): React.ReactNode {
        const status = this.getToolStatus(entry, policy);
        const override = this.getToolOverride(entry.registryId);
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

    protected renderSkillTable(policy: GeoAppChatPolicy): React.ReactNode {
        return (
            <table className='geoapp-chat-policy-skill-table'>
                <thead>
                    <tr>
                        <th>Statut</th>
                        <th>Skill</th>
                        <th>Workflows</th>
                        <th>Tools associes</th>
                        <th>Override</th>
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
                </td>
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
            </tr>
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

    protected groupEntries(entries: GeoAppAiToolCatalogEntry[]): Map<GeoAppAiToolCategory, GeoAppAiToolCatalogEntry[]> {
        const groups = new Map<GeoAppAiToolCategory, GeoAppAiToolCatalogEntry[]>();
        for (const entry of entries) {
            const current = groups.get(entry.category) || [];
            current.push(entry);
            groups.set(entry.category, current);
        }
        return groups;
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

    protected getPolicyConfiguration(): Record<string, unknown> {
        const config: Record<string, unknown> = {};
        for (const [key, defaultValue] of Object.entries(POLICY_DEFAULTS)) {
            config[key] = this.preferenceService.get(key, defaultValue);
        }
        return config;
    }

    protected async exportPolicyConfiguration(): Promise<void> {
        const serialized = JSON.stringify(this.getPolicyConfiguration(), null, 2);
        try {
            await navigator.clipboard.writeText(serialized);
            this.messages.info('Configuration Chat IA GeoApp copiee dans le presse-papiers.');
        } catch (error) {
            console.warn('[GeoAppChatPolicyWidget] Clipboard export failed', error);
            this.importText = serialized;
            this.messages.warn('Impossible de copier automatiquement; la configuration est affichee dans le champ import/export.');
            this.update();
        }
    }

    protected async importPolicyConfiguration(): Promise<void> {
        try {
            const parsed = JSON.parse(this.importText);
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                throw new Error('Invalid configuration shape');
            }

            const updates: Array<Promise<void>> = [];
            const record = parsed as Record<string, unknown>;
            for (const key of Object.keys(POLICY_DEFAULTS)) {
                if (Object.prototype.hasOwnProperty.call(record, key)) {
                    updates.push(this.preferenceService.set(key, record[key], PreferenceScope.User));
                }
            }
            await Promise.all(updates);
            this.importText = '';
            this.messages.info('Configuration Chat IA GeoApp importee.');
            this.update();
        } catch (error) {
            console.error('[GeoAppChatPolicyWidget] Import failed', error);
            this.messages.error('Configuration JSON invalide.');
        }
    }

    protected async resetPolicyConfiguration(): Promise<void> {
        await Promise.all(Object.entries(POLICY_DEFAULTS).map(([key, value]) =>
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
}
