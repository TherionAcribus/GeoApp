import * as React from 'react';
import { MessageService } from '@theia/core/lib/common';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { EarthCoachContext } from './earthcoach-context-service';
import {
    buildEarthCoachFieldChecklist,
    EarthCoachFieldChecklist,
    formatEarthCoachFieldChecklistMarkdown,
} from './earthcoach-field-checklist';

interface EarthCoachFieldChecklistViewProps {
    checklist?: EarthCoachFieldChecklist;
    onCopy: () => void | Promise<void>;
    onPrint: () => void;
}

function EarthCoachFieldChecklistView(props: EarthCoachFieldChecklistViewProps): React.ReactElement {
    const checklist = props.checklist;
    if (!checklist) {
        return <div style={{ padding: 16, opacity: 0.7 }}>Aucune EarthCache chargee.</div>;
    }
    return (
        <div style={{ padding: 16, overflow: 'auto' }}>
            <style>
                {`@media print {
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
                            {section.items.map(item => (
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
                                    <input type='checkbox' />
                                    <span>{item}</span>
                                </label>
                            ))}
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

    @inject(MessageService)
    protected readonly messages!: MessageService;

    @postConstruct()
    protected init(): void {
        this.id = EarthCoachFieldChecklistWidget.ID;
        this.title.label = EarthCoachFieldChecklistWidget.LABEL;
        this.title.caption = 'Checklist terrain EarthCoach';
        this.title.iconClass = 'codicon codicon-checklist';
        this.title.closable = true;
        this.addClass('earthcoach-field-checklist-widget');
        this.update();
    }

    setContext(context: EarthCoachContext): void {
        this.checklist = buildEarthCoachFieldChecklist(context);
        this.title.label = `${EarthCoachFieldChecklistWidget.LABEL} - ${context.geocacheData.gc_code || context.geocacheData.name}`;
        this.update();
    }

    protected async copyMarkdown(): Promise<void> {
        if (!this.checklist) {
            return;
        }
        try {
            await navigator.clipboard.writeText(formatEarthCoachFieldChecklistMarkdown(this.checklist));
            this.messages.info('Checklist EarthCoach copiee dans le presse-papiers.');
        } catch (error) {
            console.warn('[EarthCoach] Unable to copy field checklist', error);
            this.messages.warn('Impossible de copier la checklist EarthCoach.');
        }
    }

    protected render(): React.ReactNode {
        return (
            <EarthCoachFieldChecklistView
                checklist={this.checklist}
                onCopy={() => this.copyMarkdown()}
                onPrint={() => window.print()}
            />
        );
    }
}
