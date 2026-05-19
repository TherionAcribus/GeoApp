import * as React from 'react';
import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { BackendApiClient } from './backend-api-client';

import '../../src/browser/style/server-log-terminal.css';

type StreamStatus = 'idle' | 'connecting' | 'connected' | 'paused' | 'error';

interface ServerLogEntry {
    id: number;
    timestamp: string;
    level: string;
    source: string;
    message: string;
    thread?: string;
    exception?: string;
    dropped?: number;
}

const MAX_LOG_ENTRIES = 1000;

@injectable()
export class ServerLogTerminalWidget extends ReactWidget {
    static readonly ID = 'geoapp-server-log-terminal';
    static readonly LABEL = 'Terminal serveur';

    private eventSource: EventSource | undefined;
    private status: StreamStatus = 'idle';
    private entries: ServerLogEntry[] = [];
    private paused = false;
    private autoScroll = true;
    private level = 'INFO';
    private logContainer: HTMLDivElement | null = null;

    constructor(
        @inject(BackendApiClient) protected readonly backendApi: BackendApiClient
    ) {
        super();
        this.node.tabIndex = 0;
    }

    @postConstruct()
    protected init(): void {
        this.id = ServerLogTerminalWidget.ID;
        this.title.label = ServerLogTerminalWidget.LABEL;
        this.title.caption = 'Logs du serveur GeoApp';
        this.title.closable = true;
        this.title.iconClass = 'codicon codicon-terminal';
        this.addClass('geoapp-server-log-terminal-widget');
        this.update();
    }

    protected onAfterAttach(msg: any): void {
        super.onAfterAttach(msg);
        this.startStreamIfNeeded();
    }

    protected onBeforeDetach(msg: any): void {
        this.stopStream('idle');
        super.onBeforeDetach(msg);
    }

    protected onAfterShow(msg: any): void {
        super.onAfterShow(msg);
        this.startStreamIfNeeded();
    }

    protected onBeforeHide(msg: any): void {
        this.stopStream(this.paused ? 'paused' : 'idle');
        super.onBeforeHide(msg);
    }

    protected onActivateRequest(msg: any): void {
        super.onActivateRequest(msg);
        this.node.focus();
        this.startStreamIfNeeded();
    }

    protected onCloseRequest(msg: any): void {
        this.stopStream('idle');
        super.onCloseRequest(msg);
    }

    dispose(): void {
        this.stopStream('idle');
        super.dispose();
    }

    protected render(): React.ReactNode {
        return (
            <div className='geoapp-server-log-terminal'>
                <div className='geoapp-server-log-toolbar'>
                    <div className={`geoapp-server-log-status geoapp-server-log-status-${this.status}`}>
                        <span className='geoapp-server-log-status-dot' />
                        <span>{this.getStatusLabel()}</span>
                    </div>
                    <div className='geoapp-server-log-actions'>
                        <select
                            className='theia-select geoapp-server-log-level'
                            title='Niveau minimum'
                            value={this.level}
                            onChange={event => this.setLevel(event.currentTarget.value)}
                        >
                            <option value='INFO'>INFO</option>
                            <option value='DEBUG'>DEBUG</option>
                            <option value='WARNING'>WARNING</option>
                            <option value='ERROR'>ERROR</option>
                        </select>
                        <button
                            className='theia-button secondary geoapp-server-log-icon-button'
                            title={this.paused ? 'Reprendre le flux' : 'Mettre en pause'}
                            onClick={this.togglePause}
                        >
                            <span className={`codicon ${this.paused ? 'codicon-debug-start' : 'codicon-debug-pause'}`} />
                        </button>
                        <button
                            className='theia-button secondary geoapp-server-log-icon-button'
                            title='Reconnexion'
                            onClick={this.reconnect}
                            disabled={this.paused}
                        >
                            <span className='codicon codicon-refresh' />
                        </button>
                        <button
                            className='theia-button secondary geoapp-server-log-icon-button'
                            title={this.autoScroll ? 'Desactiver le defilement automatique' : 'Activer le defilement automatique'}
                            onClick={this.toggleAutoScroll}
                        >
                            <span className={`codicon ${this.autoScroll ? 'codicon-arrow-down' : 'codicon-lock'}`} />
                        </button>
                        <button
                            className='theia-button secondary geoapp-server-log-icon-button'
                            title='Effacer'
                            onClick={this.clear}
                        >
                            <span className='codicon codicon-clear-all' />
                        </button>
                    </div>
                </div>
                <div
                    className='geoapp-server-log-output'
                    ref={element => {
                        this.logContainer = element;
                    }}
                >
                    {this.entries.length === 0 ? (
                        <div className='geoapp-server-log-empty'>En attente d'activite serveur...</div>
                    ) : (
                        this.entries.map(entry => this.renderEntry(entry))
                    )}
                </div>
            </div>
        );
    }

    private renderEntry(entry: ServerLogEntry): React.ReactNode {
        return (
            <div key={`${entry.id}-${entry.timestamp}`} className={`geoapp-server-log-entry geoapp-server-log-entry-${entry.level.toLowerCase()}`}>
                {entry.dropped ? (
                    <div className='geoapp-server-log-dropped'>{entry.dropped} lignes ignorees pendant une surcharge du flux.</div>
                ) : undefined}
                <span className='geoapp-server-log-time'>{this.formatTime(entry.timestamp)}</span>
                <span className='geoapp-server-log-level-badge'>{entry.level}</span>
                <span className='geoapp-server-log-source'>{entry.source}</span>
                <span className='geoapp-server-log-message'>{entry.message}</span>
                {entry.exception ? <pre className='geoapp-server-log-exception'>{entry.exception}</pre> : undefined}
            </div>
        );
    }

    private startStreamIfNeeded(): void {
        if (this.eventSource || this.paused || !this.isAttached || !this.isVisible) {
            return;
        }

        this.status = 'connecting';
        this.update();

        const url = `${this.backendApi.getBaseUrl()}/api/server-logs/stream?level=${encodeURIComponent(this.level)}`;
        const source = new EventSource(url, { withCredentials: true });
        this.eventSource = source;

        source.addEventListener('connected', () => {
            if (this.eventSource !== source) {
                return;
            }
            this.status = 'connected';
            this.update();
        });

        source.addEventListener('log', (event: MessageEvent) => {
            if (this.eventSource !== source || this.paused) {
                return;
            }
            try {
                const entry = JSON.parse(event.data) as ServerLogEntry;
                this.appendEntry(entry);
            } catch (error) {
                console.error('[ServerLogTerminal] Invalid log event', error);
            }
        });

        source.onerror = () => {
            if (this.eventSource !== source) {
                return;
            }
            this.status = 'error';
            this.update();
        };
    }

    private stopStream(nextStatus: StreamStatus): void {
        if (this.eventSource) {
            this.eventSource.close();
            this.eventSource = undefined;
        }
        this.status = nextStatus;
        this.update();
    }

    private appendEntry(entry: ServerLogEntry): void {
        this.entries = [...this.entries, entry].slice(-MAX_LOG_ENTRIES);
        this.update();
        if (this.autoScroll) {
            window.setTimeout(() => this.scrollToBottom(), 0);
        }
    }

    private scrollToBottom(): void {
        if (this.logContainer) {
            this.logContainer.scrollTop = this.logContainer.scrollHeight;
        }
    }

    private setLevel(level: string): void {
        if (this.level === level) {
            return;
        }
        this.level = level;
        if (!this.paused && this.isAttached && this.isVisible) {
            this.stopStream('connecting');
            this.startStreamIfNeeded();
        } else {
            this.update();
        }
    }

    private togglePause = (): void => {
        this.paused = !this.paused;
        if (this.paused) {
            this.stopStream('paused');
            return;
        }
        this.startStreamIfNeeded();
    };

    private reconnect = (): void => {
        if (this.paused) {
            return;
        }
        this.stopStream('connecting');
        this.startStreamIfNeeded();
    };

    private toggleAutoScroll = (): void => {
        this.autoScroll = !this.autoScroll;
        this.update();
        if (this.autoScroll) {
            window.setTimeout(() => this.scrollToBottom(), 0);
        }
    };

    private clear = (): void => {
        this.entries = [];
        this.update();
    };

    private getStatusLabel(): string {
        switch (this.status) {
            case 'connecting':
                return 'Connexion';
            case 'connected':
                return 'Connecte';
            case 'paused':
                return 'Pause';
            case 'error':
                return 'Reconnexion';
            default:
                return 'Deconnecte';
        }
    }

    private formatTime(timestamp: string): string {
        const date = new Date(timestamp);
        if (Number.isNaN(date.getTime())) {
            return timestamp;
        }
        return date.toLocaleTimeString(undefined, {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
    }
}
