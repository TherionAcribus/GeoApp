import * as React from 'react';
import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { MessageService } from '@theia/core';
import { PluginInfo, PluginListResponse, ResolutionWorkflowStepRunResponse } from '../common/plugin-protocol';

export interface GeocacheContext {
    geocacheId?: number;
    gcCode: string;
    name?: string;
    coordinates?: {
        latitude?: number;
        longitude?: number;
        coordinatesRaw?: string;
    };
    description?: string;
    hint?: string;
    difficulty?: number;
    terrain?: number;
    waypoints?: unknown[];
    images?: Array<{ url?: string }>;
    checkers?: Array<{ id?: number; name?: string; url?: string }>;
    resumeSnapshot?: PluginExecutorResumeSnapshot;
}

export interface PluginExecutorWorkflowEntry {
    category: 'classification' | 'recommendation' | 'execute' | 'archive' | 'secret' | 'formula' | 'checker' | 'chat';
    message: string;
    detail?: string;
    timestamp?: string;
}

export interface PluginExecutorResumeSnapshot {
    updatedAt?: string;
    currentText?: string;
    recommendationSourceText?: string;
    classification?: any;
    recommendation?: any;
    workflowResolution?: ResolutionWorkflowStepRunResponse['workflow_resolution'];
    workflowEntries: PluginExecutorWorkflowEntry[];
}

export interface PluginExecutorWidgetOptions {
    context?: GeocacheContext;
    pluginName?: string;
    autoExecute?: boolean;
}

@injectable()
export class PluginExecutorWidget extends ReactWidget {
    static readonly ID = 'plugin-executor-widget';
    static readonly LABEL = 'Plugins';

    protected context?: GeocacheContext;
    protected pluginName?: string;
    protected autoExecute = false;
    protected plugins: PluginInfo[] = [];
    protected isLoading = false;
    protected lastResult?: Record<string, any>;
    protected lastWorkflow?: ResolutionWorkflowStepRunResponse['workflow_resolution'];
    protected error?: string;

    constructor(
        @inject(MessageService) protected readonly messages: MessageService
    ) {
        super();
        this.id = PluginExecutorWidget.ID;
        this.title.label = PluginExecutorWidget.LABEL;
        this.title.caption = 'Executer les plugins GeoApp';
        this.title.closable = true;
        this.title.iconClass = 'fa fa-puzzle-piece';
        this.addClass('plugin-executor-widget');
    }

    @postConstruct()
    protected init(): void {
        void this.loadPlugins();
    }

    setOptions(options: PluginExecutorWidgetOptions): void {
        this.context = options.context;
        this.pluginName = options.pluginName;
        this.autoExecute = Boolean(options.autoExecute);
        this.title.label = this.context?.gcCode ? `Plugins - ${this.context.gcCode}` : PluginExecutorWidget.LABEL;
        this.update();
        if (this.autoExecute && this.pluginName) {
            void this.executeSelectedPlugin();
        }
    }

    protected async loadPlugins(): Promise<void> {
        this.isLoading = true;
        this.error = undefined;
        this.update();
        try {
            const response = await fetch('/api/plugins');
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            const data = await response.json() as PluginListResponse | PluginInfo[];
            this.plugins = Array.isArray(data) ? data : data.plugins || [];
        } catch (error) {
            this.error = `Impossible de charger les plugins: ${this.getErrorMessage(error)}`;
        } finally {
            this.isLoading = false;
            this.update();
        }
    }

    protected executeSelectedPlugin = async (): Promise<void> => {
        if (!this.pluginName) {
            this.messages.warn('Aucun plugin selectionne');
            return;
        }
        this.isLoading = true;
        this.error = undefined;
        this.update();
        try {
            if (this.pluginName === 'analysis_web_page' || this.pluginName === 'metasolver') {
                await this.resolveWorkflow(this.pluginName === 'metasolver' ? 'secret_code' : undefined);
            } else {
                const response = await fetch(`/api/plugins/${encodeURIComponent(this.pluginName)}/execute`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ inputs: this.buildPluginInputs() }),
                });
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }
                this.lastResult = await response.json();
            }
        } catch (error) {
            this.error = this.getErrorMessage(error);
            this.messages.error(`Erreur plugin: ${this.error}`);
        } finally {
            this.isLoading = false;
            this.update();
        }
    };

    protected async resolveWorkflow(preferredWorkflow?: string): Promise<void> {
        const response = await fetch('/api/plugins/workflow/resolve', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                geocache_id: this.context?.geocacheId,
                title: this.context?.name,
                description: this.context?.description,
                hint: this.context?.hint,
                waypoints: this.context?.waypoints,
                checkers: this.context?.checkers,
                images: this.context?.images,
                preferred_workflow: preferredWorkflow,
                auto_execute: true,
            }),
        });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        const data = await response.json() as { workflow_resolution?: ResolutionWorkflowStepRunResponse['workflow_resolution'] };
        this.lastWorkflow = data.workflow_resolution;
        this.lastResult = data as Record<string, any>;
    }

    protected buildPluginInputs(): Record<string, unknown> {
        return {
            text: this.context?.description || '',
            hint: this.context?.hint || '',
            gc_code: this.context?.gcCode,
            geocache_name: this.context?.name,
            coordinates: this.context?.coordinates,
            waypoints: this.context?.waypoints || [],
            images: this.context?.images || [],
        };
    }

    protected selectPlugin = (event: React.ChangeEvent<HTMLSelectElement>): void => {
        this.pluginName = event.target.value || undefined;
        this.update();
    };

    protected getErrorMessage(error: unknown): string {
        return error instanceof Error ? error.message : String(error);
    }

    protected render(): React.ReactNode {
        const pluginOptions = this.plugins.map(plugin => (
            <option key={plugin.name} value={plugin.name}>
                {plugin.display_name || plugin.name}
            </option>
        ));
        return (
            <div style={{ padding: 12 }}>
                <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                    <select value={this.pluginName || ''} onChange={this.selectPlugin} style={{ flex: 1 }}>
                        <option value=''>Selectionner un plugin</option>
                        <option value='analysis_web_page'>Analyse de page</option>
                        <option value='metasolver'>Metasolver</option>
                        {pluginOptions}
                    </select>
                    <button disabled={this.isLoading || !this.pluginName} onClick={this.executeSelectedPlugin}>
                        Executer
                    </button>
                </div>
                {this.context && (
                    <div style={{ marginBottom: 12 }}>
                        <strong>{this.context.gcCode}</strong>
                        {this.context.name ? ` - ${this.context.name}` : ''}
                    </div>
                )}
                {this.isLoading && <div>Chargement...</div>}
                {this.error && <div style={{ color: 'var(--theia-errorForeground)' }}>{this.error}</div>}
                {this.lastWorkflow && (
                    <pre style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(this.lastWorkflow.plan || [], null, 2)}</pre>
                )}
                {this.lastResult && !this.lastWorkflow && (
                    <pre style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(this.lastResult, null, 2)}</pre>
                )}
            </div>
        );
    }
}
