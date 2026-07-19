import * as React from 'react';
import { CommandService, MessageService } from '@theia/core/lib/common';
import { ConfirmDialog, Dialog } from '@theia/core/lib/browser';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { getErrorMessage } from 'theia-ide-zones-ext/lib/browser/backend-api-client';
import { EarthCoachContext } from './earthcoach-context-service';
import { EarthCoachLoggingTaskService } from './earthcoach-logging-task-service';
import { EARTHCOACH_LOGGING_TASKS_UPDATED_EVENT } from './earthcoach-logging-task-tools';
import { EarthCoachObserveTaskCommandId, EarthCoachOpenCommandId, LoggingTaskStatus, UserObservation } from './earthcoach-types';
import {
    buildLoggingTaskInput,
    createLoggingTaskDraft,
    createLoggingTaskDraftFromDto,
    getLoggingTaskStatusLabel,
    LoggingTaskDraft,
    LoggingTaskDto,
    LOGGING_TASK_STATUS_OPTIONS,
} from './earthcoach-logging-tasks';

interface ObservationOption {
    id: number;
    label: string;
}

function buildObservationOptions(observations: UserObservation[]): ObservationOption[] {
    const options: ObservationOption[] = [];
    const seen = new Set<number>();
    for (const observation of observations) {
        const match = /^observation-(\d+)$/.exec(observation.id);
        if (!match) {
            continue;
        }
        const id = Number(match[1]);
        if (seen.has(id)) {
            continue;
        }
        seen.add(id);
        const snippet = observation.note.replace(/\s+/g, ' ').trim().slice(0, 60);
        options.push({ id, label: `#${id} - ${snippet || 'observation'}` });
    }
    return options;
}

function getObservationLabel(options: ObservationOption[], observationId?: number | null): string | undefined {
    if (observationId == null) {
        return undefined;
    }
    return options.find(option => option.id === observationId)?.label || `Observation #${observationId}`;
}

interface LoggingTaskFormProps {
    title: string;
    draft: LoggingTaskDraft;
    observationOptions: ObservationOption[];
    submitLabel: string;
    isSaving: boolean;
    onDraftChange: (draft: LoggingTaskDraft) => void;
    onSubmit: () => void | Promise<void>;
    onCancel?: () => void;
}

function LoggingTaskForm(props: LoggingTaskFormProps): React.ReactElement {
    const setDraft = (patch: Partial<LoggingTaskDraft>) => props.onDraftChange({ ...props.draft, ...patch });
    return (
        <form
            onSubmit={event => {
                event.preventDefault();
                void props.onSubmit();
            }}
            style={{
                border: '1px solid var(--theia-panel-border)',
                borderRadius: 6,
                padding: 12,
                display: 'grid',
                gap: 10,
                background: 'var(--theia-editor-background)',
            }}
        >
            <h3 style={{ margin: 0, fontSize: 14 }}>{props.title}</h3>

            <label style={{ display: 'grid', gap: 4 }}>
                <span style={{ fontSize: 12, color: 'var(--theia-descriptionForeground)' }}>Question du proprietaire</span>
                <textarea
                    className='theia-input'
                    rows={2}
                    value={props.draft.question}
                    onChange={event => setDraft({ question: event.currentTarget.value })}
                    style={{ resize: 'vertical', minHeight: 48 }}
                />
            </label>

            <label style={{ display: 'grid', gap: 4 }}>
                <span style={{ fontSize: 12, color: 'var(--theia-descriptionForeground)' }}>A observer / mesurer (optionnel)</span>
                <textarea
                    className='theia-input'
                    rows={2}
                    value={props.draft.guidance}
                    onChange={event => setDraft({ guidance: event.currentTarget.value })}
                    style={{ resize: 'vertical', minHeight: 44 }}
                />
            </label>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
                <label style={{ display: 'grid', gap: 4 }}>
                    <span style={{ fontSize: 12, color: 'var(--theia-descriptionForeground)' }}>Statut</span>
                    <select
                        className='theia-select'
                        value={props.draft.status}
                        onChange={event => setDraft({ status: event.currentTarget.value as LoggingTaskStatus })}
                    >
                        {LOGGING_TASK_STATUS_OPTIONS.map(option => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                    </select>
                </label>
                <label style={{ display: 'grid', gap: 4 }}>
                    <span style={{ fontSize: 12, color: 'var(--theia-descriptionForeground)' }}>Observation liee</span>
                    <select
                        className='theia-select'
                        value={props.draft.observationId}
                        onChange={event => setDraft({ observationId: event.currentTarget.value })}
                    >
                        <option value=''>Aucune</option>
                        {props.observationOptions.map(option => (
                            <option key={option.id} value={String(option.id)}>{option.label}</option>
                        ))}
                    </select>
                </label>
            </div>

            <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                    type='checkbox'
                    checked={props.draft.requiresPhoto}
                    onChange={event => setDraft({ requiresPhoto: event.currentTarget.checked })}
                />
                <span style={{ fontSize: 13 }}>Photo requise pour cette question</span>
            </label>

            <label style={{ display: 'grid', gap: 4 }}>
                <span style={{ fontSize: 12, color: 'var(--theia-descriptionForeground)' }}>Reponse brouillon (optionnel)</span>
                <textarea
                    className='theia-input'
                    rows={3}
                    value={props.draft.answer}
                    onChange={event => setDraft({ answer: event.currentTarget.value })}
                    style={{ resize: 'vertical', minHeight: 60 }}
                />
            </label>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                {props.onCancel ? (
                    <button className='theia-button secondary' type='button' onClick={props.onCancel} disabled={props.isSaving}>
                        Annuler
                    </button>
                ) : undefined}
                <button className='theia-button' type='submit' disabled={props.isSaving}>
                    {props.isSaving ? 'Sauvegarde...' : props.submitLabel}
                </button>
            </div>
        </form>
    );
}

interface LoggingTaskCardProps {
    task: LoggingTaskDto;
    observationOptions: ObservationOption[];
    onEdit: (task: LoggingTaskDto) => void;
    onObserve: (task: LoggingTaskDto) => void | Promise<void>;
    onDelete: (task: LoggingTaskDto) => void | Promise<void>;
    isDeleting: boolean;
}

// Memoise avec callbacks stables (voir widget): taper dans le formulaire de
// creation ne re-rend pas les cartes de questions existantes.
const LoggingTaskCard = React.memo(function LoggingTaskCard(props: LoggingTaskCardProps): React.ReactElement {
    const task = props.task;
    const badges = [
        getLoggingTaskStatusLabel(task.status),
        task.requires_photo ? 'photo requise' : undefined,
        getObservationLabel(props.observationOptions, task.observation_id),
        task.source === 'extracted' ? 'extrait IA' : undefined,
    ].filter(Boolean) as string[];
    return (
        <article
            style={{
                border: '1px solid var(--theia-panel-border)',
                borderRadius: 6,
                padding: 12,
                display: 'grid',
                gap: 8,
                background: 'var(--theia-editor-background)',
            }}
        >
            <header style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}>
                <div style={{ display: 'grid', gap: 6, minWidth: 0 }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                        <strong style={{ fontSize: 13 }}>Q{task.position}</strong>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            {badges.map(badge => (
                                <span
                                    key={badge}
                                    style={{
                                        border: '1px solid var(--theia-panel-border)',
                                        borderRadius: 4,
                                        padding: '2px 6px',
                                        fontSize: 11,
                                        color: 'var(--theia-descriptionForeground)',
                                    }}
                                >
                                    {badge}
                                </span>
                            ))}
                        </div>
                    </div>
                    <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.4 }}>{task.question}</div>
                    {task.guidance ? (
                        <div style={{ fontStyle: 'italic', opacity: 0.85, fontSize: 12 }}>A observer: {task.guidance}</div>
                    ) : undefined}
                    {task.answer ? (
                        <div style={{ whiteSpace: 'pre-wrap', fontSize: 13, borderLeft: '2px solid var(--theia-panel-border)', paddingLeft: 8 }}>
                            Reponse: {task.answer}
                        </div>
                    ) : undefined}
                </div>
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                    <button
                        className='theia-button secondary'
                        type='button'
                        onClick={() => { void props.onObserve(task); }}
                        title='Creer une observation terrain liee a cette question'
                    >
                        Observer
                    </button>
                    <button className='theia-button secondary' type='button' onClick={() => props.onEdit(task)}>
                        Modifier
                    </button>
                    <button
                        className='theia-button secondary'
                        type='button'
                        onClick={() => { void props.onDelete(task); }}
                        disabled={props.isDeleting}
                    >
                        {props.isDeleting ? 'Suppression...' : 'Supprimer'}
                    </button>
                </div>
            </header>
        </article>
    );
});

interface LoggingTasksViewProps {
    context?: EarthCoachContext;
    tasks: LoggingTaskDto[];
    observationOptions: ObservationOption[];
    createDraft: LoggingTaskDraft;
    editingTaskId?: number;
    editingDraft: LoggingTaskDraft;
    isLoading: boolean;
    loadError?: string;
    isSaving: boolean;
    deletingTaskId?: number;
    onRefresh: () => void | Promise<void>;
    onExtract: () => void | Promise<void>;
    onCreateDraftChange: (draft: LoggingTaskDraft) => void;
    onEditingDraftChange: (draft: LoggingTaskDraft) => void;
    onCreate: () => void | Promise<void>;
    onStartEdit: (task: LoggingTaskDto) => void;
    onObserve: (task: LoggingTaskDto) => void | Promise<void>;
    onCancelEdit: () => void;
    onSaveEdit: () => void | Promise<void>;
    onDelete: (task: LoggingTaskDto) => void | Promise<void>;
}

function LoggingTasksView(props: LoggingTasksViewProps): React.ReactElement {
    const context = props.context;
    if (!context) {
        return <div style={{ padding: 16, opacity: 0.7 }}>Aucune EarthCache chargee.</div>;
    }
    const title = `Questions du proprietaire - ${context.geocacheData.gc_code || context.geocacheData.name}`;
    return (
        <div style={{ padding: 16, overflow: 'auto', display: 'grid', gap: 14 }}>
            <header style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
                <div>
                    <h2 style={{ margin: 0, fontSize: 18 }}>{title}</h2>
                    <div style={{ opacity: 0.75 }}>{props.tasks.length} question(s) enregistree(s)</div>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button
                        className='theia-button'
                        type='button'
                        onClick={() => { void props.onExtract(); }}
                        disabled={props.isLoading}
                        title='Demander a EarthCoach d extraire les questions du listing (remplace les questions existantes)'
                    >
                        Extraire via EarthCoach (IA)
                    </button>
                    <button
                        className='theia-button secondary'
                        type='button'
                        onClick={() => { void props.onRefresh(); }}
                        disabled={props.isLoading}
                    >
                        {props.isLoading ? 'Chargement...' : 'Actualiser'}
                    </button>
                </div>
            </header>

            <div style={{ fontSize: 12, opacity: 0.75, lineHeight: 1.5 }}>
                Suivez ici chaque question imposee par le proprietaire. EarthCoach reutilise ces questions dans le
                mode terrain compact et dans le mode resolver pour structurer la resolution.
            </div>

            <LoggingTaskForm
                title='Nouvelle question'
                draft={props.createDraft}
                observationOptions={props.observationOptions}
                submitLabel='Ajouter'
                isSaving={props.isSaving}
                onDraftChange={props.onCreateDraftChange}
                onSubmit={props.onCreate}
            />

            <section style={{ display: 'grid', gap: 10 }}>
                <h3 style={{ margin: 0, fontSize: 14 }}>Questions enregistrees</h3>
                {props.isLoading ? (
                    <div style={{ opacity: 0.7 }}>Chargement des questions...</div>
                ) : props.loadError ? (
                    <div
                        style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            gap: 10,
                            flexWrap: 'wrap',
                            border: '1px solid var(--theia-errorForeground)',
                            borderRadius: 6,
                            padding: '8px 12px',
                        }}
                    >
                        <span style={{ color: 'var(--theia-errorForeground)' }}>{props.loadError}</span>
                        <button className='theia-button secondary' type='button' onClick={() => { void props.onRefresh(); }}>
                            Reessayer
                        </button>
                    </div>
                ) : props.tasks.length ? (
                    props.tasks.map(task => (
                        props.editingTaskId === task.id ? (
                            <LoggingTaskForm
                                key={task.id}
                                title={`Modifier Q${task.position}`}
                                draft={props.editingDraft}
                                observationOptions={props.observationOptions}
                                submitLabel='Enregistrer'
                                isSaving={props.isSaving}
                                onDraftChange={props.onEditingDraftChange}
                                onSubmit={props.onSaveEdit}
                                onCancel={props.onCancelEdit}
                            />
                        ) : (
                            <LoggingTaskCard
                                key={task.id}
                                task={task}
                                observationOptions={props.observationOptions}
                                onEdit={props.onStartEdit}
                                onObserve={props.onObserve}
                                onDelete={props.onDelete}
                                isDeleting={props.deletingTaskId === task.id}
                            />
                        )
                    ))
                ) : (
                    <div style={{ opacity: 0.65, fontStyle: 'italic' }}>
                        Aucune question enregistree. Ajoutez-les manuellement ou utilisez "Extraire via EarthCoach (IA)".
                    </div>
                )}
            </section>
        </div>
    );
}

@injectable()
export class EarthCoachLoggingTasksWidget extends ReactWidget {

    static readonly ID = 'earthcoach.loggingTasks';
    static readonly LABEL = 'Questions EarthCoach';

    protected context: EarthCoachContext | undefined;
    protected tasks: LoggingTaskDto[] = [];
    protected observationOptions: ObservationOption[] = [];
    protected createDraft: LoggingTaskDraft = createLoggingTaskDraft();
    protected editingTaskId: number | undefined;
    protected editingDraft: LoggingTaskDraft = createLoggingTaskDraft();
    protected isLoading = false;
    protected loadError: string | undefined;
    protected isSaving = false;
    protected deletingTaskId: number | undefined;
    protected loadRequestToken = 0;

    @inject(MessageService)
    protected readonly messages!: MessageService;

    @inject(CommandService)
    protected readonly commandService!: CommandService;

    @inject(EarthCoachLoggingTaskService)
    protected readonly loggingTaskService!: EarthCoachLoggingTaskService;

    // References stables pour l'efficacite de React.memo des cartes.
    protected readonly handleStartEdit = (task: LoggingTaskDto): void => this.startEdit(task);
    protected readonly handleObserve = (task: LoggingTaskDto): Promise<void> => this.observeTask(task);
    protected readonly handleDelete = (task: LoggingTaskDto): Promise<void> => this.deleteTask(task);

    protected readonly onTasksUpdated = (event: Event): void => {
        const detail = (event as CustomEvent).detail as { geocacheId?: number } | undefined;
        if (detail?.geocacheId && detail.geocacheId === this.context?.geocacheData.id) {
            void this.loadTasks();
        }
    };

    @postConstruct()
    protected init(): void {
        this.id = EarthCoachLoggingTasksWidget.ID;
        this.title.label = EarthCoachLoggingTasksWidget.LABEL;
        this.title.caption = 'Questions du proprietaire (logging tasks)';
        this.title.iconClass = 'codicon codicon-checklist';
        this.title.closable = true;
        this.addClass('earthcoach-logging-tasks-widget');
        if (typeof window !== 'undefined') {
            window.addEventListener(EARTHCOACH_LOGGING_TASKS_UPDATED_EVENT, this.onTasksUpdated);
        }
        this.toDispose.push({
            dispose: () => {
                if (typeof window !== 'undefined') {
                    window.removeEventListener(EARTHCOACH_LOGGING_TASKS_UPDATED_EVENT, this.onTasksUpdated);
                }
            },
        });
        this.update();
    }

    setContext(context: EarthCoachContext): void {
        this.context = context;
        this.tasks = [];
        this.loadError = undefined;
        this.observationOptions = buildObservationOptions(context.observations);
        this.createDraft = createLoggingTaskDraft();
        this.editingTaskId = undefined;
        this.editingDraft = createLoggingTaskDraft();
        this.title.label = `${EarthCoachLoggingTasksWidget.LABEL} - ${context.geocacheData.gc_code || context.geocacheData.name}`;
        void this.loadTasks();
        this.update();
    }

    protected async loadTasks(): Promise<void> {
        const geocacheId = this.context?.geocacheData.id;
        if (!geocacheId) {
            return;
        }
        const requestToken = ++this.loadRequestToken;
        this.isLoading = true;
        this.update();
        try {
            const response = await this.loggingTaskService.listLoggingTasks(geocacheId);
            if (requestToken !== this.loadRequestToken || geocacheId !== this.context?.geocacheData.id) {
                return;
            }
            this.tasks = response.logging_tasks || [];
            this.loadError = undefined;
        } catch (error) {
            console.error('[EarthCoach] Unable to load logging tasks', error);
            const message = getErrorMessage(error, 'Impossible de charger les questions du proprietaire');
            if (requestToken === this.loadRequestToken) {
                this.loadError = message;
            }
            this.messages.error(message);
        } finally {
            if (requestToken === this.loadRequestToken) {
                this.isLoading = false;
                this.update();
            }
        }
    }

    protected async extractViaChat(): Promise<void> {
        const geocacheData = this.context?.geocacheData;
        if (!geocacheData) {
            return;
        }
        // L'extraction remplace en masse toutes les questions existantes, y
        // compris les reponses brouillon et observations liees saisies a la main.
        // On confirme quand il y a du travail a perdre.
        if (this.tasks.length > 0) {
            const dialog = new ConfirmDialog({
                title: 'Extraire les questions via EarthCoach',
                msg: `Cette extraction remplacera les ${this.tasks.length} question(s) existante(s), y compris leurs reponses brouillon et observations liees. Continuer ?`,
                ok: 'Remplacer',
                cancel: Dialog.CANCEL,
            });
            if (!(await dialog.open())) {
                return;
            }
        }
        await this.commandService.executeCommand(EarthCoachOpenCommandId, {
            geocacheData,
            action: 'extract_logging_tasks',
        });
    }

    protected async observeTask(task: LoggingTaskDto): Promise<void> {
        const geocacheData = this.context?.geocacheData;
        if (!geocacheData) {
            return;
        }
        await this.commandService.executeCommand(EarthCoachObserveTaskCommandId, { geocacheData, task });
    }

    protected setCreateDraft(draft: LoggingTaskDraft): void {
        this.createDraft = draft;
        this.update();
    }

    protected setEditingDraft(draft: LoggingTaskDraft): void {
        this.editingDraft = draft;
        this.update();
    }

    protected async createTask(): Promise<void> {
        const geocacheId = this.context?.geocacheData.id;
        if (!geocacheId || this.isSaving) {
            return;
        }
        const payload = buildLoggingTaskInput(this.createDraft);
        if (!payload.question) {
            this.messages.warn('La question est requise');
            return;
        }
        this.isSaving = true;
        this.update();
        try {
            await this.loggingTaskService.createLoggingTask(geocacheId, payload);
            this.createDraft = createLoggingTaskDraft();
            await this.loadTasks();
            this.messages.info('Question ajoutee');
        } catch (error) {
            console.error('[EarthCoach] Unable to create logging task', error);
            this.messages.error(getErrorMessage(error, 'Impossible de creer la question'));
        } finally {
            this.isSaving = false;
            this.update();
        }
    }

    protected startEdit(task: LoggingTaskDto): void {
        this.editingTaskId = task.id;
        this.editingDraft = createLoggingTaskDraftFromDto(task);
        this.update();
    }

    protected cancelEdit(): void {
        this.editingTaskId = undefined;
        this.editingDraft = createLoggingTaskDraft();
        this.update();
    }

    protected async saveEdit(): Promise<void> {
        if (!this.editingTaskId || this.isSaving) {
            return;
        }
        const payload = buildLoggingTaskInput(this.editingDraft);
        if (!payload.question) {
            this.messages.warn('La question est requise');
            return;
        }
        const taskId = this.editingTaskId;
        this.isSaving = true;
        this.update();
        try {
            await this.loggingTaskService.updateLoggingTask(taskId, payload);
            this.cancelEdit();
            await this.loadTasks();
            this.messages.info('Question mise a jour');
        } catch (error) {
            console.error('[EarthCoach] Unable to update logging task', error);
            this.messages.error(getErrorMessage(error, 'Impossible de mettre a jour la question'));
        } finally {
            this.isSaving = false;
            this.update();
        }
    }

    protected async confirmDelete(): Promise<boolean> {
        const dialog = new ConfirmDialog({
            title: 'Supprimer la question',
            msg: 'Supprimer cette question du proprietaire ?',
            ok: 'Supprimer',
            cancel: Dialog.CANCEL,
        });
        return Boolean(await dialog.open());
    }

    protected async deleteTask(task: LoggingTaskDto): Promise<void> {
        if (!(await this.confirmDelete())) {
            return;
        }
        this.deletingTaskId = task.id;
        this.update();
        try {
            await this.loggingTaskService.deleteLoggingTask(task.id);
            if (this.editingTaskId === task.id) {
                this.cancelEdit();
            }
            await this.loadTasks();
            this.messages.info('Question supprimee');
        } catch (error) {
            console.error('[EarthCoach] Unable to delete logging task', error);
            this.messages.error(getErrorMessage(error, 'Impossible de supprimer la question'));
        } finally {
            if (this.deletingTaskId === task.id) {
                this.deletingTaskId = undefined;
                this.update();
            }
        }
    }

    protected render(): React.ReactNode {
        return (
            <LoggingTasksView
                context={this.context}
                tasks={this.tasks}
                observationOptions={this.observationOptions}
                createDraft={this.createDraft}
                editingTaskId={this.editingTaskId}
                editingDraft={this.editingDraft}
                isLoading={this.isLoading}
                loadError={this.loadError}
                isSaving={this.isSaving}
                deletingTaskId={this.deletingTaskId}
                onRefresh={() => this.loadTasks()}
                onExtract={() => this.extractViaChat()}
                onCreateDraftChange={draft => this.setCreateDraft(draft)}
                onEditingDraftChange={draft => this.setEditingDraft(draft)}
                onCreate={() => this.createTask()}
                onStartEdit={this.handleStartEdit}
                onObserve={this.handleObserve}
                onCancelEdit={() => this.cancelEdit()}
                onSaveEdit={() => this.saveEdit()}
                onDelete={this.handleDelete}
            />
        );
    }
}
