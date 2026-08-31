import * as React from 'react';
import { MessageService } from '@theia/core/lib/common';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { Message } from '@theia/core/lib/browser';
import { EarthCoachContext, EarthCoachContextService } from './earthcoach-context-service';
import {
    EARTHCOACH_LOGGING_TASKS_UPDATED_EVENT,
    EARTHCOACH_OBSERVATIONS_UPDATED_EVENT,
    EarthCoachRefreshScheduler,
    GEOAPP_GEOCACHE_IMAGES_UPDATED_EVENT,
    isUpdateForGeocache,
    subscribeEarthCoachDataUpdates,
} from './earthcoach-events';
import {
    buildEarthCoachFieldChecklist,
    buildEarthCoachFieldChecklistFileName,
    EarthCoachFieldChecklist,
    fieldChecklistItemKey,
    formatEarthCoachFieldChecklistMarkdown,
} from './earthcoach-field-checklist';
import { EmptyState } from './state-views';

interface EarthCoachFieldChecklistViewProps {
    checklist?: EarthCoachFieldChecklist;
    checkedKeys: ReadonlySet<string>;
    onToggle: (key: string) => void;
    onCopy: () => void | Promise<void>;
    onExport: () => void;
    onPrint: () => void;
}

function EarthCoachFieldChecklistView(props: EarthCoachFieldChecklistViewProps): React.ReactElement {
    const checklist = props.checklist;
    if (!checklist) {
        return <EmptyState icon='fa-globe' title='Aucune EarthCache chargée' fullHeight />;
    }
    return (
        <div style={{ padding: 16, overflow: 'auto' }}>
            <style>
                {`@media print {
                    /* window.print() imprime toute la page: on masque l'IDE entier
                       (barre laterale, editeurs, panneaux) et on ne laisse visible
                       que le widget checklist, ramene en pleine page. */
                    body * { visibility: hidden !important; }
                    .earthcoach-field-checklist-widget,
                    .earthcoach-field-checklist-widget * { visibility: visible !important; }
                    .earthcoach-field-checklist-widget {
                        position: fixed !important;
                        inset: 0 !important;
                        overflow: visible !important;
                        background: #fff !important;
                        color: #111 !important;
                    }
                    .earthcoach-field-checklist-widget * { overflow: visible !important; }
                    .earthcoach-field-actions { display: none !important; }
                    .earthcoach-field-root { color: #111 !important; background: #fff !important; }
                }`}
            </style>
            <div className='earthcoach-field-root' style={{ display: 'grid', gap: 14 }}>
                <header style={{ display: 'grid', gap: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
                        <div>
                            <h2 style={{ margin: 0, fontSize: 18 }}>{checklist.title}</h2>
                            <div style={{ opacity: 0.75 }}>{checklist.subtitle}</div>
                        </div>
                        <div className='earthcoach-field-actions' style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                            <button className='theia-button secondary' type='button' onClick={() => { void props.onCopy(); }}>
                                Copier Markdown
                            </button>
                            <button
                                className='theia-button secondary'
                                type='button'
                                title='Telecharger la checklist au format Markdown (.md)'
                                onClick={props.onExport}
                            >
                                Exporter .md
                            </button>
                            <button className='theia-button' type='button' onClick={props.onPrint}>
                                Imprimer
                            </button>
                        </div>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {checklist.meta.map(item => (
                            <span
                                key={item}
                                style={{
                                    border: '1px solid var(--theia-panel-border)',
                                    borderRadius: 4,
                                    padding: '3px 6px',
                                    fontSize: 11,
                                    opacity: 0.85,
                                }}
                            >
                                {item}
                            </span>
                        ))}
                    </div>
                </header>

                {checklist.sections.map(section => (
                    <section key={section.title} style={{ display: 'grid', gap: 8 }}>
                        <h3
                            style={{
                                margin: 0,
                                fontSize: 12,
                                textTransform: 'uppercase',
                                color: 'var(--theia-ui-font-color2)',
                            }}
                        >
                            {section.title}
                        </h3>
                        <div style={{ display: 'grid', gap: 6 }}>
                            {section.items.map(item => {
                                const key = fieldChecklistItemKey(section.title, item);
                                return (
                                    <label
                                        key={item}
                                        style={{
                                            display: 'grid',
                                            gridTemplateColumns: '18px 1fr',
                                            gap: 8,
                                            alignItems: 'start',
                                            lineHeight: 1.35,
                                        }}
                                    >
                                        <input
                                            type='checkbox'
                                            checked={props.checkedKeys.has(key)}
                                            onChange={() => props.onToggle(key)}
                                        />
                                        <span>{item}</span>
                                    </label>
                                );
                            })}
                        </div>
                    </section>
                ))}
            </div>
        </div>
    );
}

@injectable()
export class EarthCoachFieldChecklistWidget extends ReactWidget {

    static readonly ID = 'earthcoach.fieldChecklist';
    static readonly LABEL = 'Terrain EarthCoach';

    protected checklist: EarthCoachFieldChecklist | undefined;
    protected checkedKeys = new Set<string>();
    protected storageKey: string | undefined;
    protected geocacheId: number | undefined;
    protected refreshToken = 0;

    @inject(MessageService)
    protected readonly messages!: MessageService;

    @inject(EarthCoachContextService)
    protected readonly contextService!: EarthCoachContextService;

    // Un onglet lateral cache ne relance pas de collecte reseau: la demande est
    // rejouee a l'affichage.
    protected readonly refreshScheduler = new EarthCoachRefreshScheduler(
        () => this.isVisible,
        () => { void this.refreshContext(); }
    );

    @postConstruct()
    protected init(): void {
        this.id = EarthCoachFieldChecklistWidget.ID;
        this.title.label = EarthCoachFieldChecklistWidget.LABEL;
        this.title.caption = 'Checklist terrain EarthCoach';
        this.title.iconClass = 'codicon codicon-checklist';
        this.title.closable = true;
        this.addClass('earthcoach-field-checklist-widget');
        // Observations, questions et photos ajoutees ailleurs changent les
        // compteurs et la section "Questions du listing": la checklist se
        // reconstruit sans fermeture/reouverture du panneau.
        this.toDispose.push(subscribeEarthCoachDataUpdates(
            [
                EARTHCOACH_OBSERVATIONS_UPDATED_EVENT,
                EARTHCOACH_LOGGING_TASKS_UPDATED_EVENT,
                GEOAPP_GEOCACHE_IMAGES_UPDATED_EVENT,
            ],
            detail => {
                if (isUpdateForGeocache(detail, this.geocacheId)) {
                    this.refreshScheduler.request();
                }
            }
        ));
        this.update();
    }

    setContext(context: EarthCoachContext): void {
        this.geocacheId = context.geocacheData.id;
        // Un changement de cache annule un rafraichissement encore en vol.
        this.refreshToken++;
        this.applyContext(context);
    }

    /**
     * Reconstruit la checklist. Les cases cochees ne sont relues du stockage
     * local que si la cache affichee change: un rafraichissement en cours de
     * terrain ne doit jamais decocher ce que l'utilisateur vient de pointer.
     */
    protected applyContext(context: EarthCoachContext): void {
        this.checklist = buildEarthCoachFieldChecklist(context);
        const storageKey = `geoapp.earthcoach.fieldChecklist.${this.checklist.reference}`;
        if (storageKey !== this.storageKey) {
            this.storageKey = storageKey;
            this.checkedKeys = this.loadCheckedKeys(storageKey);
        }
        this.title.label = `${EarthCoachFieldChecklistWidget.LABEL} - ${context.geocacheData.gc_code || context.geocacheData.name}`;
        this.update();
    }

    protected async refreshContext(): Promise<void> {
        const geocacheId = this.geocacheId;
        if (!geocacheId) {
            return;
        }
        const requestToken = ++this.refreshToken;
        try {
            const context = await this.contextService.collectContext({ geocacheId, forceRefresh: true });
            if (!context || requestToken !== this.refreshToken || geocacheId !== this.geocacheId) {
                return;
            }
            this.applyContext(context);
        } catch (error) {
            console.warn('[EarthCoach] Unable to refresh field checklist', error);
        }
    }

    protected onAfterShow(msg: Message): void {
        super.onAfterShow(msg);
        this.refreshScheduler.flush();
    }

    protected loadCheckedKeys(storageKey: string): Set<string> {
        try {
            const raw = window.localStorage.getItem(storageKey);
            const parsed = raw ? JSON.parse(raw) : undefined;
            return Array.isArray(parsed) ? new Set(parsed.map(value => String(value))) : new Set();
        } catch {
            return new Set();
        }
    }

    protected persistCheckedKeys(): void {
        if (!this.storageKey) {
            return;
        }
        try {
            window.localStorage.setItem(this.storageKey, JSON.stringify([...this.checkedKeys]));
        } catch (error) {
            console.warn('[EarthCoach] Unable to persist field checklist state', error);
        }
    }

    protected toggleItem(key: string): void {
        if (this.checkedKeys.has(key)) {
            this.checkedKeys.delete(key);
        } else {
            this.checkedKeys.add(key);
        }
        this.persistCheckedKeys();
        this.update();
    }

    protected async copyMarkdown(): Promise<void> {
        if (!this.checklist) {
            return;
        }
        try {
            await navigator.clipboard.writeText(formatEarthCoachFieldChecklistMarkdown(this.checklist, this.checkedKeys));
            this.messages.info('Checklist EarthCoach copiee dans le presse-papiers.');
        } catch (error) {
            console.warn('[EarthCoach] Unable to copy field checklist', error);
            this.messages.warn('Impossible de copier la checklist EarthCoach.');
        }
    }

    /**
     * Export fichier du mode terrain : meme Markdown que le bouton copier
     * (cases cochees incluses), telecharge sous un nom stable par cache et par jour.
     */
    protected exportMarkdown(): void {
        if (!this.checklist) {
            return;
        }
        const fileName = buildEarthCoachFieldChecklistFileName(this.checklist);
        let objectUrl: string | undefined;
        try {
            const markdown = formatEarthCoachFieldChecklistMarkdown(this.checklist, this.checkedKeys);
            const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
            objectUrl = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = objectUrl;
            link.download = fileName;
            document.body.appendChild(link);
            link.click();
            link.remove();
            this.messages.info(`Checklist EarthCoach exportee : ${fileName}`);
        } catch (error) {
            console.warn('[EarthCoach] Unable to export field checklist', error);
            this.messages.error('Export impossible de la checklist EarthCoach.');
        } finally {
            if (objectUrl) {
                window.URL.revokeObjectURL(objectUrl);
            }
        }
    }

    protected render(): React.ReactNode {
        return (
            <EarthCoachFieldChecklistView
                checklist={this.checklist}
                checkedKeys={this.checkedKeys}
                onToggle={key => this.toggleItem(key)}
                onCopy={() => this.copyMarkdown()}
                onExport={() => this.exportMarkdown()}
                onPrint={() => window.print()}
            />
        );
    }
}
