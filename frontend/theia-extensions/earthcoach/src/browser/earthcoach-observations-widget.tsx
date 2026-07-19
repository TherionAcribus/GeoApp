import * as React from 'react';
import { MessageService } from '@theia/core/lib/common';
import { ConfirmDialog, Dialog } from '@theia/core/lib/browser';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { getErrorMessage } from 'theia-ide-zones-ext/lib/browser/backend-api-client';
import { EarthCoachContext } from './earthcoach-context-service';
import { EarthCoachObservationService } from './earthcoach-observation-service';
import { EarthCoachLoggingTaskService } from './earthcoach-logging-task-service';
import { EARTHCOACH_LOGGING_TASKS_UPDATED_EVENT } from './earthcoach-logging-task-tools';
import { formatLoggingTaskSeedLabel, LoggingTaskSeed } from './earthcoach-logging-tasks';
import { EarthCoachGeocacheData, GeoImage } from './earthcoach-types';
import {
    buildEarthCoachObservationInput,
    createEarthCoachObservationDraft,
    createEarthCoachObservationDraftFromDto,
    EarthCoachObservationDraft,
    EarthCoachObservationDto,
    EarthCoachObservationImageDto,
    EarthCoachObservationType,
    toggleObservationImageId,
} from './earthcoach-observations';

const OBSERVATION_TYPE_OPTIONS: Array<{ value: EarthCoachObservationType; label: string }> = [
    { value: 'observation', label: 'Observation' },
    { value: 'hypothesis', label: 'Hypothese' },
    { value: 'interpretation', label: 'Interpretation' },
];

function parseGeoImageId(image: GeoImage): number | undefined {
    const parsed = Number(image.id);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function getSelectableImages(images: GeoImage[]): Array<{ image: GeoImage; imageId: number }> {
    const seen = new Set<number>();
    const result: Array<{ image: GeoImage; imageId: number }> = [];
    for (const image of images) {
        const imageId = parseGeoImageId(image);
        if (!imageId || seen.has(imageId)) {
            continue;
        }
        seen.add(imageId);
        result.push({ image, imageId });
    }
    return result;
}

function getObservationTypeLabel(type?: EarthCoachObservationType): string {
    return OBSERVATION_TYPE_OPTIONS.find(option => option.value === type)?.label || 'Observation';
}

function getWaypointLabel(waypoints: NonNullable<EarthCoachGeocacheData['waypoints']>, waypointId?: number | null): string | undefined {
    if (waypointId == null) {
        return undefined;
    }
    const waypoint = waypoints.find(item => item.id === waypointId);
    if (!waypoint) {
        return `Waypoint ${waypointId}`;
    }
    return [waypoint.prefix, waypoint.lookup, waypoint.name].filter(Boolean).join(' / ') || `Waypoint ${waypointId}`;
}

function formatObservationDate(value?: string | null): string | undefined {
    if (!value) {
        return undefined;
    }
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
        return date.toLocaleString();
    }
    return value;
}

function formatObservationCoordinates(observation: EarthCoachObservationDto): string | undefined {
    if (observation.coordinates_raw) {
        return observation.coordinates_raw;
    }
    if (observation.latitude != null && observation.longitude != null) {
        return `${observation.latitude.toFixed(5)}, ${observation.longitude.toFixed(5)}`;
    }
    return undefined;
}

interface ObservationFormProps {
    title: string;
    draft: EarthCoachObservationDraft;
    waypoints: NonNullable<EarthCoachGeocacheData['waypoints']>;
    images: GeoImage[];
    submitLabel: string;
    isSaving: boolean;
    isUploadingImage: boolean;
    onDraftChange: (draft: EarthCoachObservationDraft) => void;
    onSubmit: () => void | Promise<void>;
    onCancel?: () => void;
    onUploadImage: (file: File) => void | Promise<void>;
}

function ObservationForm(props: ObservationFormProps): React.ReactElement {
    const selectableImages = getSelectableImages(props.images);
    const setDraft = (patch: Partial<EarthCoachObservationDraft>) => {
        props.onDraftChange({ ...props.draft, ...patch });
    };
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
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
                <label style={{ display: 'grid', gap: 4 }}>
                    <span style={{ fontSize: 12, color: 'var(--theia-descriptionForeground)' }}>Type</span>
                    <select
                        className='theia-select'
                        value={props.draft.observationType}
                        onChange={event => setDraft({ observationType: event.currentTarget.value as EarthCoachObservationType })}
                    >
                        {OBSERVATION_TYPE_OPTIONS.map(option => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                    </select>
                </label>
                <label style={{ display: 'grid', gap: 4 }}>
                    <span style={{ fontSize: 12, color: 'var(--theia-descriptionForeground)' }}>Date terrain</span>
                    <input
                        className='theia-input'
                        type='datetime-local'
                        value={props.draft.observedAt}
                        onChange={event => setDraft({ observedAt: event.currentTarget.value })}
                    />
                </label>
            </div>

            <label style={{ display: 'grid', gap: 4 }}>
                <span style={{ fontSize: 12, color: 'var(--theia-descriptionForeground)' }}>Contenu</span>
                <textarea
                    className='theia-input'
                    rows={5}
                    value={props.draft.content}
                    onChange={event => setDraft({ content: event.currentTarget.value })}
                    style={{ resize: 'vertical', minHeight: 96 }}
                />
            </label>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
                <label style={{ display: 'grid', gap: 4 }}>
                    <span style={{ fontSize: 12, color: 'var(--theia-descriptionForeground)' }}>Waypoint</span>
                    <select
                        className='theia-select'
                        value={props.draft.waypointId}
                        onChange={event => setDraft({ waypointId: event.currentTarget.value })}
                    >
                        <option value=''>Aucun waypoint</option>
                        {props.waypoints.map(waypoint => {
                            const label = [waypoint.prefix, waypoint.lookup, waypoint.name].filter(Boolean).join(' / ') || `Waypoint ${waypoint.id}`;
                            return waypoint.id != null ? (
                                <option key={waypoint.id} value={String(waypoint.id)}>{label}</option>
                            ) : undefined;
                        })}
                    </select>
                </label>
                <label style={{ display: 'grid', gap: 4 }}>
                    <span style={{ fontSize: 12, color: 'var(--theia-descriptionForeground)' }}>Coordonnees texte</span>
                    <input
                        className='theia-input'
                        type='text'
                        value={props.draft.coordinatesRaw}
                        onChange={event => setDraft({ coordinatesRaw: event.currentTarget.value })}
                    />
                </label>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10 }}>
                <label style={{ display: 'grid', gap: 4 }}>
                    <span style={{ fontSize: 12, color: 'var(--theia-descriptionForeground)' }}>Latitude</span>
                    <input
                        className='theia-input'
                        type='number'
                        step='any'
                        value={props.draft.latitude}
                        onChange={event => setDraft({ latitude: event.currentTarget.value })}
                    />
                </label>
                <label style={{ display: 'grid', gap: 4 }}>
                    <span style={{ fontSize: 12, color: 'var(--theia-descriptionForeground)' }}>Longitude</span>
                    <input
                        className='theia-input'
                        type='number'
                        step='any'
                        value={props.draft.longitude}
                        onChange={event => setDraft({ longitude: event.currentTarget.value })}
                    />
                </label>
            </div>

            <section style={{ display: 'grid', gap: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <h4 style={{ margin: 0, fontSize: 12, textTransform: 'uppercase', color: 'var(--theia-ui-font-color2)' }}>
                        Photos liees
                    </h4>
                    <input
                        type='file'
                        accept='image/*'
                        disabled={props.isUploadingImage || props.isSaving}
                        style={{ maxWidth: '100%' }}
                        onChange={event => {
                            const file = event.currentTarget.files?.[0];
                            event.currentTarget.value = '';
                            if (file) {
                                void props.onUploadImage(file);
                            }
                        }}
                    />
                </div>
                {selectableImages.length ? (
                    <div
                        style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
                            gap: 8,
                        }}
                    >
                        {selectableImages.map(({ image, imageId }) => (
                            <label
                                key={imageId}
                                style={{
                                    display: 'grid',
                                    gridTemplateColumns: '22px 48px 1fr',
                                    gap: 8,
                                    alignItems: 'center',
                                    border: '1px solid var(--theia-panel-border)',
                                    borderRadius: 4,
                                    padding: 6,
                                }}
                            >
                                <input
                                    type='checkbox'
                                    checked={props.draft.selectedImageIds.includes(imageId)}
                                    onChange={() => setDraft({
                                        selectedImageIds: toggleObservationImageId(props.draft.selectedImageIds, imageId),
                                    })}
                                />
                                <img
                                    src={image.fileUri}
                                    alt={image.label || image.id}
                                    loading='lazy'
                                    decoding='async'
                                    style={{ width: 48, height: 48, objectFit: 'cover', background: 'var(--theia-editorWidget-background)' }}
                                />
                                <span style={{ minWidth: 0, display: 'grid', gap: 2 }}>
                                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        {image.label || `Image ${imageId}`}
                                    </span>
                                    <span style={{ fontSize: 11, color: 'var(--theia-descriptionForeground)' }}>
                                        {image.origin}
                                    </span>
                                </span>
                            </label>
                        ))}
                    </div>
                ) : (
                    <div style={{ opacity: 0.65, fontStyle: 'italic' }}>Aucune photo disponible pour cette cache.</div>
                )}
            </section>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                {props.onCancel ? (
                    <button className='theia-button secondary' type='button' onClick={props.onCancel} disabled={props.isSaving}>
                        Annuler
                    </button>
                ) : undefined}
                <button className='theia-button' type='submit' disabled={props.isSaving || props.isUploadingImage}>
                    {props.isSaving ? 'Sauvegarde...' : props.submitLabel}
                </button>
            </div>
        </form>
    );
}

interface ObservationCardProps {
    observation: EarthCoachObservationDto;
    waypoints: NonNullable<EarthCoachGeocacheData['waypoints']>;
    toGeoImage: (image: EarthCoachObservationImageDto, index: number) => GeoImage | undefined;
    onEdit: (observation: EarthCoachObservationDto) => void;
    onDelete: (observation: EarthCoachObservationDto) => void | Promise<void>;
    isDeleting: boolean;
}

function ObservationCard(props: ObservationCardProps): React.ReactElement {
    const observation = props.observation;
    const images = (observation.images || [])
        .map((image, index) => props.toGeoImage(image, index))
        .filter((image): image is GeoImage => Boolean(image));
    const meta = [
        getObservationTypeLabel(observation.observation_type),
        formatObservationDate(observation.observed_at),
        getWaypointLabel(props.waypoints, observation.waypoint_id),
        formatObservationCoordinates(observation),
    ].filter(Boolean);
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
                <div style={{ display: 'grid', gap: 4, minWidth: 0 }}>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {meta.map(item => (
                            <span
                                key={item}
                                style={{
                                    border: '1px solid var(--theia-panel-border)',
                                    borderRadius: 4,
                                    padding: '2px 6px',
                                    fontSize: 11,
                                    color: 'var(--theia-descriptionForeground)',
                                }}
                            >
                                {item}
                            </span>
                        ))}
                    </div>
                    <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.4 }}>
                        {observation.content || observation.note}
                    </div>
                </div>
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                    <button className='theia-button secondary' type='button' onClick={() => props.onEdit(observation)}>
                        Modifier
                    </button>
                    <button
                        className='theia-button secondary'
                        type='button'
                        onClick={() => { void props.onDelete(observation); }}
                        disabled={props.isDeleting}
                    >
                        {props.isDeleting ? 'Suppression...' : 'Supprimer'}
                    </button>
                </div>
            </header>
            {images.length ? (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {images.map(image => (
                        <a key={image.id} href={image.fileUri} target='_blank' rel='noreferrer' title={image.label || image.id}>
                            <img
                                src={image.fileUri}
                                alt={image.label || image.id}
                                loading='lazy'
                                decoding='async'
                                style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 4, background: 'var(--theia-editorWidget-background)' }}
                            />
                        </a>
                    ))}
                </div>
            ) : undefined}
        </article>
    );
}

interface EarthCoachObservationsViewProps {
    context?: EarthCoachContext;
    observations: EarthCoachObservationDto[];
    images: GeoImage[];
    createDraft: EarthCoachObservationDraft;
    editingObservationId?: number;
    editingDraft: EarthCoachObservationDraft;
    pendingLinkTask?: LoggingTaskSeed;
    isLoading: boolean;
    isSaving: boolean;
    isUploadingImage: boolean;
    deletingObservationId?: number;
    onRefresh: () => void | Promise<void>;
    onClearPendingLink: () => void;
    onCreateDraftChange: (draft: EarthCoachObservationDraft) => void;
    onEditingDraftChange: (draft: EarthCoachObservationDraft) => void;
    onCreate: () => void | Promise<void>;
    onStartEdit: (observation: EarthCoachObservationDto) => void;
    onCancelEdit: () => void;
    onSaveEdit: () => void | Promise<void>;
    onDelete: (observation: EarthCoachObservationDto) => void | Promise<void>;
    onUploadCreateImage: (file: File) => void | Promise<void>;
    onUploadEditImage: (file: File) => void | Promise<void>;
    toGeoImage: (image: EarthCoachObservationImageDto, index: number) => GeoImage | undefined;
}

function EarthCoachObservationsView(props: EarthCoachObservationsViewProps): React.ReactElement {
    const context = props.context;
    if (!context) {
        return <div style={{ padding: 16, opacity: 0.7 }}>Aucune EarthCache chargee.</div>;
    }
    const waypoints = context.geocacheData.waypoints || [];
    const title = `Observations - ${context.geocacheData.gc_code || context.geocacheData.name}`;
    return (
        <div style={{ padding: 16, overflow: 'auto', display: 'grid', gap: 14 }}>
            <header style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
                <div>
                    <h2 style={{ margin: 0, fontSize: 18 }}>{title}</h2>
                    <div style={{ opacity: 0.75 }}>
                        {props.observations.length} observation(s) structuree(s)
                    </div>
                </div>
                <button
                    className='theia-button secondary'
                    type='button'
                    onClick={() => { void props.onRefresh(); }}
                    disabled={props.isLoading}
                >
                    {props.isLoading ? 'Chargement...' : 'Actualiser'}
                </button>
            </header>

            {props.pendingLinkTask ? (
                <div
                    style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: 10,
                        flexWrap: 'wrap',
                        border: '1px solid var(--theia-focusBorder)',
                        borderRadius: 6,
                        padding: '8px 12px',
                        background: 'var(--theia-editorWidget-background)',
                    }}
                >
                    <span style={{ fontSize: 13 }}>{formatLoggingTaskSeedLabel(props.pendingLinkTask)}</span>
                    <button className='theia-button secondary' type='button' onClick={props.onClearPendingLink}>
                        Ne pas lier
                    </button>
                </div>
            ) : undefined}

            <ObservationForm
                title={props.pendingLinkTask ? `Nouvelle observation pour Q${props.pendingLinkTask.position}` : 'Nouvelle observation'}
                draft={props.createDraft}
                waypoints={waypoints}
                images={props.images}
                submitLabel='Ajouter'
                isSaving={props.isSaving}
                isUploadingImage={props.isUploadingImage}
                onDraftChange={props.onCreateDraftChange}
                onSubmit={props.onCreate}
                onUploadImage={props.onUploadCreateImage}
            />

            <section style={{ display: 'grid', gap: 10 }}>
                <h3 style={{ margin: 0, fontSize: 14 }}>Observations enregistrees</h3>
                {props.isLoading ? (
                    <div style={{ opacity: 0.7 }}>Chargement des observations...</div>
                ) : props.observations.length ? (
                    props.observations.map(observation => (
                        props.editingObservationId === observation.id ? (
                            <ObservationForm
                                key={observation.id}
                                title={`Modifier #${observation.id}`}
                                draft={props.editingDraft}
                                waypoints={waypoints}
                                images={props.images}
                                submitLabel='Enregistrer'
                                isSaving={props.isSaving}
                                isUploadingImage={props.isUploadingImage}
                                onDraftChange={props.onEditingDraftChange}
                                onSubmit={props.onSaveEdit}
                                onCancel={props.onCancelEdit}
                                onUploadImage={props.onUploadEditImage}
                            />
                        ) : (
                            <ObservationCard
                                key={observation.id}
                                observation={observation}
                                waypoints={waypoints}
                                toGeoImage={props.toGeoImage}
                                onEdit={props.onStartEdit}
                                onDelete={props.onDelete}
                                isDeleting={props.deletingObservationId === observation.id}
                            />
                        )
                    ))
                ) : (
                    <div style={{ opacity: 0.65, fontStyle: 'italic' }}>
                        Aucune observation structuree pour cette EarthCache.
                    </div>
                )}
            </section>
        </div>
    );
}

@injectable()
export class EarthCoachObservationsWidget extends ReactWidget {

    static readonly ID = 'earthcoach.observations';
    static readonly LABEL = 'Observations EarthCoach';

    protected context: EarthCoachContext | undefined;
    protected observations: EarthCoachObservationDto[] = [];
    protected images: GeoImage[] = [];
    protected createDraft: EarthCoachObservationDraft = createEarthCoachObservationDraft();
    protected editingObservationId: number | undefined;
    protected editingDraft: EarthCoachObservationDraft = createEarthCoachObservationDraft();
    protected pendingLinkTask: LoggingTaskSeed | undefined;
    protected isLoading = false;
    protected isSaving = false;
    protected isUploadingImage = false;
    protected deletingObservationId: number | undefined;
    protected loadRequestToken = 0;

    @inject(MessageService)
    protected readonly messages!: MessageService;

    @inject(EarthCoachObservationService)
    protected readonly observationService!: EarthCoachObservationService;

    @inject(EarthCoachLoggingTaskService)
    protected readonly loggingTaskService!: EarthCoachLoggingTaskService;

    @postConstruct()
    protected init(): void {
        this.id = EarthCoachObservationsWidget.ID;
        this.title.label = EarthCoachObservationsWidget.LABEL;
        this.title.caption = 'Observations structurees EarthCoach';
        this.title.iconClass = 'codicon codicon-list-selection';
        this.title.closable = true;
        this.addClass('earthcoach-observations-widget');
        this.update();
    }

    setContext(context: EarthCoachContext): void {
        this.context = context;
        this.images = [...context.images];
        this.observations = [];
        this.createDraft = createEarthCoachObservationDraft();
        this.editingObservationId = undefined;
        this.editingDraft = createEarthCoachObservationDraft();
        this.pendingLinkTask = undefined;
        this.title.label = `${EarthCoachObservationsWidget.LABEL} - ${context.geocacheData.gc_code || context.geocacheData.name}`;
        void this.loadObservations();
        this.update();
    }

    seedFromLoggingTask(seed: LoggingTaskSeed): void {
        this.pendingLinkTask = seed;
        this.editingObservationId = undefined;
        this.createDraft = createEarthCoachObservationDraft();
        this.update();
    }

    protected clearPendingLink(): void {
        this.pendingLinkTask = undefined;
        this.update();
    }

    protected async loadObservations(): Promise<void> {
        const geocacheId = this.context?.geocacheData.id;
        if (!geocacheId) {
            return;
        }
        const requestToken = ++this.loadRequestToken;
        this.isLoading = true;
        this.update();
        try {
            const response = await this.observationService.listObservations(geocacheId);
            if (requestToken !== this.loadRequestToken || geocacheId !== this.context?.geocacheData.id) {
                return;
            }
            this.observations = response.observations || [];
        } catch (error) {
            console.error('[EarthCoach] Unable to load observations', error);
            this.messages.error(getErrorMessage(error, 'Impossible de charger les observations EarthCoach'));
        } finally {
            if (requestToken === this.loadRequestToken) {
                this.isLoading = false;
                this.update();
            }
        }
    }

    protected setCreateDraft(draft: EarthCoachObservationDraft): void {
        this.createDraft = draft;
        this.update();
    }

    protected setEditingDraft(draft: EarthCoachObservationDraft): void {
        this.editingDraft = draft;
        this.update();
    }

    protected async createObservation(): Promise<void> {
        const geocacheId = this.context?.geocacheData.id;
        if (!geocacheId || this.isSaving) {
            return;
        }
        const payload = buildEarthCoachObservationInput(this.createDraft);
        if (!payload.content) {
            this.messages.warn('Contenu de l observation requis');
            return;
        }
        const linkTask = this.pendingLinkTask;
        this.isSaving = true;
        this.update();
        try {
            const created = await this.observationService.createObservation(geocacheId, payload);
            this.createDraft = createEarthCoachObservationDraft();
            if (linkTask && created.id != null) {
                await this.linkObservationToTask(linkTask, created.id, geocacheId);
            }
            await this.loadObservations();
            this.messages.info(linkTask
                ? `Observation ajoutee et liee a la question Q${linkTask.position}`
                : 'Observation EarthCoach ajoutee');
        } catch (error) {
            console.error('[EarthCoach] Unable to create observation', error);
            this.messages.error(getErrorMessage(error, 'Impossible de creer l observation EarthCoach'));
        } finally {
            this.isSaving = false;
            this.update();
        }
    }

    protected async linkObservationToTask(seed: LoggingTaskSeed, observationId: number, geocacheId: number): Promise<void> {
        try {
            await this.loggingTaskService.linkObservation(seed.taskId, observationId);
            this.pendingLinkTask = undefined;
            if (typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent(EARTHCOACH_LOGGING_TASKS_UPDATED_EVENT, { detail: { geocacheId } }));
            }
        } catch (error) {
            console.error('[EarthCoach] Unable to link observation to logging task', error);
            this.messages.warn('Observation creee, mais impossible de la lier automatiquement a la question.');
        }
    }

    protected startEdit(observation: EarthCoachObservationDto): void {
        this.editingObservationId = observation.id;
        this.editingDraft = createEarthCoachObservationDraftFromDto(observation);
        this.update();
    }

    protected cancelEdit(): void {
        this.editingObservationId = undefined;
        this.editingDraft = createEarthCoachObservationDraft();
        this.update();
    }

    protected async saveEdit(): Promise<void> {
        if (!this.editingObservationId || this.isSaving) {
            return;
        }
        const payload = buildEarthCoachObservationInput(this.editingDraft);
        if (!payload.content) {
            this.messages.warn('Contenu de l observation requis');
            return;
        }
        const observationId = this.editingObservationId;
        this.isSaving = true;
        this.update();
        try {
            await this.observationService.updateObservation(observationId, payload);
            this.cancelEdit();
            await this.loadObservations();
            this.messages.info('Observation EarthCoach mise a jour');
        } catch (error) {
            console.error('[EarthCoach] Unable to update observation', error);
            this.messages.error(getErrorMessage(error, 'Impossible de mettre a jour l observation EarthCoach'));
        } finally {
            this.isSaving = false;
            this.update();
        }
    }

    protected async confirmDelete(): Promise<boolean> {
        const dialog = new ConfirmDialog({
            title: 'Supprimer l observation',
            msg: 'Supprimer cette observation structuree ?',
            ok: 'Supprimer',
            cancel: Dialog.CANCEL,
        });
        return dialog.open();
    }

    protected async deleteObservation(observation: EarthCoachObservationDto): Promise<void> {
        if (!(await this.confirmDelete())) {
            return;
        }
        this.deletingObservationId = observation.id;
        this.update();
        try {
            await this.observationService.deleteObservation(observation.id);
            if (this.editingObservationId === observation.id) {
                this.cancelEdit();
            }
            await this.loadObservations();
            this.messages.info('Observation EarthCoach supprimee');
        } catch (error) {
            console.error('[EarthCoach] Unable to delete observation', error);
            this.messages.error(getErrorMessage(error, 'Impossible de supprimer l observation EarthCoach'));
        } finally {
            if (this.deletingObservationId === observation.id) {
                this.deletingObservationId = undefined;
                this.update();
            }
        }
    }

    protected addImageToAvailable(image: GeoImage): void {
        const imageId = parseGeoImageId(image);
        if (!imageId) {
            return;
        }
        const index = this.images.findIndex(existing => parseGeoImageId(existing) === imageId);
        if (index >= 0) {
            this.images[index] = image;
        } else {
            this.images = [image, ...this.images];
        }
    }

    protected selectImageInDraft(target: 'create' | 'edit', imageId: number): void {
        const draft = target === 'edit' ? this.editingDraft : this.createDraft;
        if (draft.selectedImageIds.includes(imageId)) {
            return;
        }
        const nextDraft = {
            ...draft,
            selectedImageIds: [...draft.selectedImageIds, imageId],
        };
        if (target === 'edit') {
            this.editingDraft = nextDraft;
        } else {
            this.createDraft = nextDraft;
        }
    }

    protected async uploadImage(target: 'create' | 'edit', file: File): Promise<void> {
        const geocacheId = this.context?.geocacheData.id;
        if (!geocacheId || this.isUploadingImage) {
            return;
        }
        this.isUploadingImage = true;
        this.update();
        try {
            const uploaded = await this.observationService.uploadImage(geocacheId, file);
            const image = this.observationService.toGeoImage(geocacheId, uploaded, 0);
            const imageId = uploaded.id || (image ? parseGeoImageId(image) : undefined);
            if (!imageId) {
                this.messages.warn('Photo ajoutee, mais impossible de la lier automatiquement.');
                return;
            }
            if (image) {
                this.addImageToAvailable(image);
            }
            this.selectImageInDraft(target, imageId);
            if (typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent('geoapp-geocache-images-updated', { detail: { geocacheId } }));
            }
            this.messages.info('Photo ajoutee a l observation');
        } catch (error) {
            console.error('[EarthCoach] Unable to upload observation image', error);
            this.messages.error(getErrorMessage(error, 'Impossible d ajouter la photo EarthCoach'));
        } finally {
            this.isUploadingImage = false;
            this.update();
        }
    }

    protected toGeoImage(image: EarthCoachObservationImageDto, index: number): GeoImage | undefined {
        const geocacheId = this.context?.geocacheData.id;
        if (!geocacheId) {
            return undefined;
        }
        return this.observationService.toGeoImage(geocacheId, image, index);
    }

    protected render(): React.ReactNode {
        return (
            <EarthCoachObservationsView
                context={this.context}
                observations={this.observations}
                images={this.images}
                createDraft={this.createDraft}
                editingObservationId={this.editingObservationId}
                editingDraft={this.editingDraft}
                pendingLinkTask={this.pendingLinkTask}
                isLoading={this.isLoading}
                isSaving={this.isSaving}
                isUploadingImage={this.isUploadingImage}
                deletingObservationId={this.deletingObservationId}
                onRefresh={() => this.loadObservations()}
                onClearPendingLink={() => this.clearPendingLink()}
                onCreateDraftChange={draft => this.setCreateDraft(draft)}
                onEditingDraftChange={draft => this.setEditingDraft(draft)}
                onCreate={() => this.createObservation()}
                onStartEdit={observation => this.startEdit(observation)}
                onCancelEdit={() => this.cancelEdit()}
                onSaveEdit={() => this.saveEdit()}
                onDelete={observation => this.deleteObservation(observation)}
                onUploadCreateImage={file => this.uploadImage('create', file)}
                onUploadEditImage={file => this.uploadImage('edit', file)}
                toGeoImage={(image, index) => this.toGeoImage(image, index)}
            />
        );
    }
}
