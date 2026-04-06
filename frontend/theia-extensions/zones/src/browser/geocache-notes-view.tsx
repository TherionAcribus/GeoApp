import * as React from 'react';
import { GeocacheNoteDto, GeocacheNoteType } from './geocache-notes-types';

export interface GeocacheNotesViewProps {
    geocacheId?: number;
    geocacheCode?: string;
    geocacheName?: string;
    notes: GeocacheNoteDto[];
    gcPersonalNote: string | null;
    gcPersonalNoteSyncedAt: string | null;
    gcPersonalNoteLastPushedAt: string | null;
    isLoading: boolean;
    isCreating: boolean;
    isSyncingFromGc: boolean;
    syncingNoteId?: number;
    newNoteContent: string;
    newNoteType: GeocacheNoteType;
    editingNoteId?: number;
    editingContent: string;
    editingType: GeocacheNoteType;
    onSyncFromGeocaching: () => void;
    onNewNoteContentChange: (value: string) => void;
    onNewNoteTypeChange: (value: GeocacheNoteType) => void;
    onCreateNote: () => void;
    onStartEdit: (note: GeocacheNoteDto) => void;
    onDeleteNote: (note: GeocacheNoteDto) => void;
    onSyncNoteToGeocaching: (note: GeocacheNoteDto) => void;
    onEditingContentChange: (value: string) => void;
    onEditingTypeChange: (value: GeocacheNoteType) => void;
    onCancelEdit: () => void;
    onSaveEdit: () => void;
}

function formatDateTime(value: string | null | undefined): string | undefined {
    return value ? new Date(value).toLocaleString('fr-FR') : undefined;
}

function getPersonalNoteTimestamp(
    gcPersonalNoteSyncedAt: string | null,
    gcPersonalNoteLastPushedAt: string | null
): string {
    const parts: string[] = [];
    const importedAt = formatDateTime(gcPersonalNoteSyncedAt);
    const pushedAt = formatDateTime(gcPersonalNoteLastPushedAt);

    if (importedAt) {
        parts.push(`Importee le ${importedAt}`);
    }
    if (pushedAt) {
        parts.push(`Envoyee le ${pushedAt}`);
    }

    return parts.join(' - ');
}

function renderEmptyState(): React.JSX.Element {
    return (
        <div
            style={{
                padding: 16,
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                opacity: 0.7
            }}
        >
            <i className='fa fa-sticky-note' style={{ fontSize: 48, marginBottom: 16 }} />
            <p>Selectionnez une geocache pour voir ses notes</p>
        </div>
    );
}

export function GeocacheNotesView(props: GeocacheNotesViewProps): React.JSX.Element {
    if (!props.geocacheId) {
        return renderEmptyState();
    }

    const personalNoteTimestamp = getPersonalNoteTimestamp(
        props.gcPersonalNoteSyncedAt,
        props.gcPersonalNoteLastPushedAt
    );

    return (
        <div
            style={{
                padding: 16,
                height: '100%',
                overflow: 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: 16
            }}
        >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                    <h3 style={{ margin: 0, fontSize: 16 }}>
                        {props.geocacheCode ? `Notes - ${props.geocacheCode}` : 'Notes'}
                    </h3>
                    {props.geocacheName && (
                        <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>
                            {props.geocacheName}
                        </div>
                    )}
                </div>
                <button
                    onClick={props.onSyncFromGeocaching}
                    disabled={props.isSyncingFromGc}
                    style={{
                        padding: '8px 16px',
                        background: 'var(--theia-button-background)',
                        color: 'var(--theia-button-foreground)',
                        border: 'none',
                        borderRadius: 4,
                        cursor: props.isSyncingFromGc ? 'wait' : 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8
                    }}
                    title='Importer la note personnelle depuis Geocaching.com'
                >
                    <i className={`fa ${props.isSyncingFromGc ? 'fa-spinner fa-spin' : 'fa-cloud-download-alt'}`} />
                    {props.isSyncingFromGc ? 'Synchronisation...' : 'Importer note GC.com'}
                </button>
            </div>

            <div
                style={{
                    background: 'var(--theia-editor-background)',
                    border: '1px solid var(--theia-panel-border)',
                    borderRadius: 6,
                    padding: 12,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8
                }}
            >
                <div style={{ fontWeight: 'bold' }}>Note Geocaching.com</div>
                <div
                    style={{
                        padding: 8,
                        minHeight: 60,
                        background: 'var(--theia-sideBar-background)',
                        borderRadius: 4,
                        whiteSpace: 'pre-wrap',
                        fontSize: 13
                    }}
                >
                    {props.gcPersonalNote && props.gcPersonalNote.trim().length > 0
                        ? props.gcPersonalNote
                        : 'Aucune note personnelle trouvee sur Geocaching.com.'}
                </div>
                {personalNoteTimestamp && (
                    <div style={{ fontSize: 11, opacity: 0.7 }}>
                        {personalNoteTimestamp}
                    </div>
                )}
            </div>

            <div
                style={{
                    background: 'var(--theia-editor-background)',
                    border: '1px solid var(--theia-panel-border)',
                    borderRadius: 6,
                    padding: 12,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 12,
                    flex: 1,
                    minHeight: 0
                }}
            >
                <div style={{ fontWeight: 'bold' }}>Notes de l'application</div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <textarea
                        value={props.newNoteContent}
                        onChange={event => props.onNewNoteContentChange(event.target.value)}
                        placeholder='Ajouter une nouvelle note...'
                        rows={3}
                        style={{
                            width: '100%',
                            resize: 'vertical',
                            padding: 8,
                            borderRadius: 4,
                            border: '1px solid var(--theia-panel-border)',
                            fontFamily: 'inherit',
                            fontSize: 13
                        }}
                    />
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                        <select
                            value={props.newNoteType}
                            onChange={event => props.onNewNoteTypeChange(event.target.value === 'system' ? 'system' : 'user')}
                            style={{
                                padding: '4px 8px',
                                borderRadius: 4,
                                border: '1px solid var(--theia-panel-border)',
                                fontSize: 13
                            }}
                        >
                            <option value='user'>Note utilisateur</option>
                            <option value='system'>Note systeme</option>
                        </select>
                        <button
                            onClick={props.onCreateNote}
                            disabled={props.isCreating}
                            style={{
                                padding: '6px 14px',
                                background: 'var(--theia-button-background)',
                                color: 'var(--theia-button-foreground)',
                                border: 'none',
                                borderRadius: 4,
                                cursor: props.isCreating ? 'wait' : 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: 8
                            }}
                        >
                            <i className={`fa ${props.isCreating ? 'fa-spinner fa-spin' : 'fa-plus'}`} />
                            {props.isCreating ? 'Creation...' : 'Ajouter'}
                        </button>
                    </div>
                </div>

                <div style={{ marginTop: 8, flex: 1, overflow: 'auto' }}>
                    {props.isLoading && props.notes.length === 0 ? (
                        <div style={{ textAlign: 'center', padding: 20, opacity: 0.7 }}>
                            <i className='fa fa-spinner fa-spin' style={{ marginRight: 8 }} />
                            Chargement des notes...
                        </div>
                    ) : props.notes.length === 0 ? (
                        <div style={{ textAlign: 'center', padding: 20, opacity: 0.7 }}>
                            <i className='fa fa-sticky-note' style={{ marginRight: 8 }} />
                            Aucune note pour cette geocache
                        </div>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            {props.notes.map(note => {
                                const isEditing = props.editingNoteId === note.id;
                                const isUserNote = note.source === 'user';
                                const typeLabel = note.note_type === 'system' ? 'Systeme' : 'Utilisateur';
                                const typeColor = note.note_type === 'system' ? '#6b7280' : '#3b82f6';
                                const created = formatDateTime(note.created_at);
                                const updated = formatDateTime(note.updated_at);

                                return (
                                    <div
                                        key={note.id}
                                        style={{
                                            border: '1px solid var(--theia-panel-border)',
                                            borderRadius: 6,
                                            padding: 10,
                                            background: 'var(--theia-editor-background)',
                                            display: 'flex',
                                            flexDirection: 'column',
                                            gap: 6
                                        }}
                                    >
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                                <span
                                                    style={{
                                                        padding: '2px 8px',
                                                        borderRadius: 999,
                                                        background: typeColor,
                                                        color: 'white',
                                                        fontSize: 11
                                                    }}
                                                >
                                                    {typeLabel}
                                                </span>
                                                {created && (
                                                    <span style={{ fontSize: 11, opacity: 0.7 }}>
                                                        {created}
                                                        {updated && updated !== created ? ` - modifiee le ${updated}` : ''}
                                                    </span>
                                                )}
                                            </div>
                                            <div style={{ display: 'flex', gap: 6 }}>
                                                {isUserNote && (
                                                    <button
                                                        onClick={() => props.onSyncNoteToGeocaching(note)}
                                                        disabled={props.syncingNoteId === note.id}
                                                        style={{
                                                            padding: '4px 8px',
                                                            borderRadius: 4,
                                                            border: '1px solid var(--theia-panel-border)',
                                                            background: 'var(--theia-sideBar-background)',
                                                            cursor: props.syncingNoteId === note.id ? 'wait' : 'pointer',
                                                            fontSize: 11
                                                        }}
                                                        title='Envoyer cette note vers Geocaching.com'
                                                    >
                                                        <i className={`fa ${props.syncingNoteId === note.id ? 'fa-spinner fa-spin' : 'fa-upload'}`} />
                                                    </button>
                                                )}
                                                {isUserNote && (
                                                    <button
                                                        onClick={() => props.onStartEdit(note)}
                                                        style={{
                                                            padding: '4px 8px',
                                                            borderRadius: 4,
                                                            border: '1px solid var(--theia-panel-border)',
                                                            background: 'var(--theia-sideBar-background)',
                                                            cursor: 'pointer',
                                                            fontSize: 11
                                                        }}
                                                        title='Modifier la note'
                                                    >
                                                        <i className='fa fa-pencil' />
                                                    </button>
                                                )}
                                                <button
                                                    onClick={() => props.onDeleteNote(note)}
                                                    style={{
                                                        padding: '4px 8px',
                                                        borderRadius: 4,
                                                        border: '1px solid var(--theia-panel-border)',
                                                        background: 'var(--theia-sideBar-background)',
                                                        cursor: 'pointer',
                                                        fontSize: 11
                                                    }}
                                                    title='Supprimer la note'
                                                >
                                                    <i className='fa fa-trash' />
                                                </button>
                                            </div>
                                        </div>
                                        {isEditing ? (
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                                <textarea
                                                    value={props.editingContent}
                                                    onChange={event => props.onEditingContentChange(event.target.value)}
                                                    rows={3}
                                                    style={{
                                                        width: '100%',
                                                        resize: 'vertical',
                                                        padding: 8,
                                                        borderRadius: 4,
                                                        border: '1px solid var(--theia-panel-border)',
                                                        fontFamily: 'inherit',
                                                        fontSize: 13
                                                    }}
                                                />
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                    <select
                                                        value={props.editingType}
                                                        onChange={event => props.onEditingTypeChange(event.target.value === 'system' ? 'system' : 'user')}
                                                        style={{
                                                            padding: '4px 8px',
                                                            borderRadius: 4,
                                                            border: '1px solid var(--theia-panel-border)',
                                                            fontSize: 13
                                                        }}
                                                    >
                                                        <option value='user'>Note utilisateur</option>
                                                        <option value='system'>Note systeme</option>
                                                    </select>
                                                    <div style={{ display: 'flex', gap: 8 }}>
                                                        <button
                                                            onClick={props.onCancelEdit}
                                                            style={{
                                                                padding: '4px 10px',
                                                                borderRadius: 4,
                                                                border: '1px solid var(--theia-panel-border)',
                                                                background: 'var(--theia-sideBar-background)',
                                                                cursor: 'pointer',
                                                                fontSize: 11
                                                            }}
                                                        >
                                                            Annuler
                                                        </button>
                                                        <button
                                                            onClick={props.onSaveEdit}
                                                            style={{
                                                                padding: '4px 10px',
                                                                borderRadius: 4,
                                                                border: 'none',
                                                                background: 'var(--theia-button-background)',
                                                                color: 'var(--theia-button-foreground)',
                                                                cursor: 'pointer',
                                                                fontSize: 11
                                                            }}
                                                        >
                                                            Sauvegarder
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        ) : (
                                            <div
                                                style={{
                                                    marginTop: 4,
                                                    whiteSpace: 'pre-wrap',
                                                    fontSize: 13
                                                }}
                                            >
                                                {note.content}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
