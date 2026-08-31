import * as React from 'react';
import { GeocacheNoteDto, GeocacheNoteType } from './geocache-notes-types';
import { EmptyState, LoadingState } from './state-views';

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
    isEditingGcNote: boolean;
    editingGcNoteContent: string;
    isSavingGcNote: boolean;
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
    onStartEditGcNote: () => void;
    onCancelEditGcNote: () => void;
    onEditingGcNoteContentChange: (value: string) => void;
    onSaveGcNote: () => void;
}

// Static style objects are hoisted to module scope so they are allocated once instead of
// being recreated on every render (the parent view re-renders on each keystroke).
const containerStyle: React.CSSProperties = {
    padding: 16,
    height: '100%',
    overflow: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: 16
};


const rowBetweenStyle: React.CSSProperties = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center'
};

const headingStyle: React.CSSProperties = { margin: 0, fontSize: 16 };

const subtitleStyle: React.CSSProperties = { fontSize: 12, opacity: 0.7, marginTop: 4 };

const sectionTitleStyle: React.CSSProperties = { fontWeight: 'bold' };

const metaTextStyle: React.CSSProperties = { fontSize: 11, opacity: 0.7 };

const gcSectionStyle: React.CSSProperties = {
    background: 'var(--theia-editor-background)',
    border: '1px solid var(--theia-panel-border)',
    borderRadius: 6,
    padding: 12,
    display: 'flex',
    flexDirection: 'column',
    gap: 8
};

const appSectionStyle: React.CSSProperties = {
    background: 'var(--theia-editor-background)',
    border: '1px solid var(--theia-panel-border)',
    borderRadius: 6,
    padding: 12,
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    flex: 1,
    minHeight: 0
};

const gcNoteBoxStyle: React.CSSProperties = {
    padding: 8,
    minHeight: 60,
    background: 'var(--theia-sideBar-background)',
    borderRadius: 4,
    whiteSpace: 'pre-wrap',
    fontSize: 13
};

const newNoteSectionStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 8 };

const newNoteControlsRowStyle: React.CSSProperties = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8
};

const textareaStyle: React.CSSProperties = {
    width: '100%',
    resize: 'vertical',
    padding: 8,
    borderRadius: 4,
    border: '1px solid var(--theia-panel-border)',
    fontFamily: 'inherit',
    fontSize: 13
};

const selectStyle: React.CSSProperties = {
    padding: '4px 8px',
    borderRadius: 4,
    border: '1px solid var(--theia-panel-border)',
    fontSize: 13
};

const primaryButtonBaseStyle: React.CSSProperties = {
    background: 'var(--theia-button-background)',
    color: 'var(--theia-button-foreground)',
    border: 'none',
    borderRadius: 4,
    display: 'flex',
    alignItems: 'center',
    gap: 8
};

const listScrollStyle: React.CSSProperties = { marginTop: 8, flex: 1, overflow: 'auto' };

const listStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 8 };

const noteCardStyle: React.CSSProperties = {
    border: '1px solid var(--theia-panel-border)',
    borderRadius: 6,
    padding: 10,
    background: 'var(--theia-editor-background)',
    display: 'flex',
    flexDirection: 'column',
    gap: 6
};

const badgeRowStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8 };

const typeBadgeBaseStyle: React.CSSProperties = {
    padding: '2px 8px',
    borderRadius: 999,
    background: 'transparent',
    border: '1px solid',
    fontSize: 11,
    fontWeight: 600
};

const actionsRowStyle: React.CSSProperties = { display: 'flex', gap: 6 };

const actionButtonStyle: React.CSSProperties = {
    padding: '4px 8px',
    borderRadius: 4,
    border: '1px solid var(--theia-panel-border)',
    background: 'var(--theia-sideBar-background)',
    fontSize: 11
};

const actionButtonPointerStyle: React.CSSProperties = { ...actionButtonStyle, cursor: 'pointer' };

const editColumnStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6 };

const editButtonsRowStyle: React.CSSProperties = { display: 'flex', gap: 8 };

const cancelButtonStyle: React.CSSProperties = { ...actionButtonStyle, padding: '4px 10px', cursor: 'pointer' };

const saveButtonStyle: React.CSSProperties = {
    padding: '4px 10px',
    borderRadius: 4,
    border: 'none',
    background: 'var(--theia-button-background)',
    color: 'var(--theia-button-foreground)',
    cursor: 'pointer',
    fontSize: 11
};

const saveButtonDisabledStyle: React.CSSProperties = { ...saveButtonStyle, cursor: 'not-allowed', opacity: 0.6 };

const addButtonBaseStyle: React.CSSProperties = { ...primaryButtonBaseStyle, padding: '6px 14px' };
const addButtonDisabledStyle: React.CSSProperties = { ...addButtonBaseStyle, cursor: 'not-allowed', opacity: 0.6 };
const addButtonActiveStyle: React.CSSProperties = { ...addButtonBaseStyle, cursor: 'pointer' };
const addButtonWaitingStyle: React.CSSProperties = { ...addButtonBaseStyle, cursor: 'wait' };

const syncFromGcButtonBaseStyle: React.CSSProperties = { ...primaryButtonBaseStyle, padding: '8px 16px' };
const syncFromGcButtonActiveStyle: React.CSSProperties = { ...syncFromGcButtonBaseStyle, cursor: 'pointer' };
const syncFromGcButtonWaitingStyle: React.CSSProperties = { ...syncFromGcButtonBaseStyle, cursor: 'wait' };

const editGcButtonActiveStyle: React.CSSProperties = { ...actionButtonStyle, cursor: 'pointer' };
const editGcButtonWaitingStyle: React.CSSProperties = { ...actionButtonStyle, cursor: 'wait' };

const syncNoteButtonActiveStyle: React.CSSProperties = { ...actionButtonStyle, cursor: 'pointer' };
const syncNoteButtonWaitingStyle: React.CSSProperties = { ...actionButtonStyle, cursor: 'wait' };

const earthcoachBadgeStyle: React.CSSProperties = {
    ...typeBadgeBaseStyle,
    color: 'var(--theia-charts-green, #047857)',
    borderColor: 'var(--theia-charts-green, #047857)'
};
const systemBadgeStyle: React.CSSProperties = {
    ...typeBadgeBaseStyle,
    color: 'var(--theia-charts-lines, #6b7280)',
    borderColor: 'var(--theia-charts-lines, #6b7280)'
};
const userBadgeStyle: React.CSSProperties = {
    ...typeBadgeBaseStyle,
    color: 'var(--theia-charts-blue, #3b82f6)',
    borderColor: 'var(--theia-charts-blue, #3b82f6)'
};

const noteContentStyle: React.CSSProperties = { marginTop: 4, whiteSpace: 'pre-wrap', fontSize: 13 };

// Formatting via Intl (toLocaleString) is relatively costly and timestamps are stable
// strings that recur across renders/notes, so we memoize on the raw value.
const dateTimeCache = new Map<string, string>();

function formatDateTime(value: string | null | undefined): string | undefined {
    if (!value) {
        return undefined;
    }
    const cached = dateTimeCache.get(value);
    if (cached !== undefined) {
        return cached;
    }
    const formatted = new Date(value).toLocaleString('fr-FR');
    dateTimeCache.set(value, formatted);
    return formatted;
}

// Date relative ("il y a 2 h", "il y a 3 j") avec fallback sur la date absolue
// au-dela de 7 jours. Non memoisee : le resultat depend de l'heure courante.
function formatRelativeDateTime(value: string | null | undefined): string | undefined {
    if (!value) {
        return undefined;
    }
    const date = new Date(value);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    const diffH = Math.floor(diffMin / 60);
    const diffD = Math.floor(diffH / 24);

    if (diffMin < 1) {
        return 'à l\'instant';
    }
    if (diffMin < 60) {
        return `il y a ${diffMin} min`;
    }
    if (diffH < 24) {
        return `il y a ${diffH} h`;
    }
    if (diffD < 7) {
        return `il y a ${diffD} j`;
    }
    // Au-dela de 7 jours, on retombe sur la date absolue (memoisee).
    return formatDateTime(value);
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
    return <EmptyState fullHeight icon='fa-sticky-note' title='Sélectionnez une géocache pour voir ses notes' />;
}

interface NoteItemProps {
    note: GeocacheNoteDto;
    isEditing: boolean;
    isSyncing: boolean;
    editingContent: string;
    editingType: GeocacheNoteType;
    onStartEdit: (note: GeocacheNoteDto) => void;
    onDeleteNote: (note: GeocacheNoteDto) => void;
    onSyncNoteToGeocaching: (note: GeocacheNoteDto) => void;
    onEditingContentChange: (value: string) => void;
    onEditingTypeChange: (value: GeocacheNoteType) => void;
    onCancelEdit: () => void;
    onSaveEdit: () => void;
}

const NoteItem = React.memo(function NoteItem(props: NoteItemProps): React.JSX.Element {
    const { note, isEditing, isSyncing } = props;
    const isUserNote = note.source === 'user';
    const isEarthcoach = note.source === 'earthcoach';
    const isSystem = note.note_type === 'system';
    const typeLabel = isEarthcoach ? 'EarthCoach' : isSystem ? 'Systeme' : 'Utilisateur';
    const badgeStyle = isEarthcoach ? earthcoachBadgeStyle : isSystem ? systemBadgeStyle : userBadgeStyle;
    const createdRelative = formatRelativeDateTime(note.created_at);
    const createdAbsolute = formatDateTime(note.created_at);
    const updatedRelative = formatRelativeDateTime(note.updated_at);
    const isModified = note.updated_at && note.updated_at !== note.created_at;

    const handleCopy = (): void => {
        if (note.content) {
            void navigator.clipboard.writeText(note.content);
        }
    };

    return (
        <div style={noteCardStyle} data-note-id={note.id}>
            <div style={rowBetweenStyle}>
                <div style={badgeRowStyle}>
                    <span style={badgeStyle}>
                        {typeLabel}
                    </span>
                    {createdRelative && (
                        <span style={metaTextStyle} title={createdAbsolute}>
                            {createdRelative}
                            {isModified && updatedRelative ? ` - modifiée ${updatedRelative}` : ''}
                        </span>
                    )}
                </div>
                <div style={actionsRowStyle}>
                    <button
                        onClick={handleCopy}
                        style={actionButtonPointerStyle}
                        title='Copier le contenu de la note'
                        aria-label='Copier le contenu de la note'
                    >
                        <i className='fa fa-copy' aria-hidden='true' />
                    </button>
                    {isUserNote && (
                        <button
                            onClick={() => props.onSyncNoteToGeocaching(note)}
                            disabled={isSyncing}
                            style={isSyncing ? syncNoteButtonWaitingStyle : syncNoteButtonActiveStyle}
                            title='Envoyer cette note vers Geocaching.com'
                            aria-label='Envoyer cette note vers Geocaching.com'
                        >
                            <i className={`fa ${isSyncing ? 'fa-spinner fa-spin' : 'fa-upload'}`} aria-hidden='true' />
                        </button>
                    )}
                    {isUserNote && (
                        <button
                            onClick={() => props.onStartEdit(note)}
                            style={actionButtonPointerStyle}
                            title='Modifier la note'
                            aria-label='Modifier la note'
                        >
                            <i className='fa fa-pencil' aria-hidden='true' />
                        </button>
                    )}
                    <button
                        onClick={() => props.onDeleteNote(note)}
                        style={actionButtonPointerStyle}
                        title='Supprimer la note'
                        aria-label='Supprimer la note'
                    >
                        <i className='fa fa-trash' aria-hidden='true' />
                    </button>
                </div>
            </div>
            {isEditing ? (
                <div style={editColumnStyle}>
                    <textarea
                        value={props.editingContent}
                        onChange={event => props.onEditingContentChange(event.target.value)}
                        onKeyDown={event => {
                            if (event.key === 'Escape') {
                                event.preventDefault();
                                props.onCancelEdit();
                            } else if ((event.ctrlKey || event.metaKey) && event.key === 'Enter'
                                && props.editingContent.trim().length > 0) {
                                event.preventDefault();
                                props.onSaveEdit();
                            }
                        }}
                        autoFocus={true}
                        rows={3}
                        style={textareaStyle}
                    />
                    <div style={rowBetweenStyle}>
                        <span style={metaTextStyle}>Note utilisateur</span>
                        <div style={editButtonsRowStyle}>
                            <button
                                onClick={props.onCancelEdit}
                                style={cancelButtonStyle}
                            >
                                Annuler
                            </button>
                            <button
                                onClick={props.onSaveEdit}
                                disabled={props.editingContent.trim().length === 0}
                                style={props.editingContent.trim().length === 0 ? saveButtonDisabledStyle : saveButtonStyle}
                            >
                                Sauvegarder
                            </button>
                        </div>
                    </div>
                </div>
            ) : (
                <div style={noteContentStyle}>
                    {note.content}
                </div>
            )}
        </div>
    );
});

interface NewNoteSectionProps {
    content: string;
    isCreating: boolean;
    onContentChange: (value: string) => void;
    onCreate: () => void;
}

const NewNoteSection = React.memo(function NewNoteSection(props: NewNoteSectionProps): React.JSX.Element {
    const isDisabled = props.isCreating || props.content.trim().length === 0;
    const charCount = props.content.length;

    return (
        <div style={newNoteSectionStyle}>
            <textarea
                value={props.content}
                onChange={event => props.onContentChange(event.target.value)}
                onKeyDown={event => {
                    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && !isDisabled) {
                        event.preventDefault();
                        props.onCreate();
                    }
                }}
                placeholder='Ajouter une nouvelle note... (Ctrl+Entrée pour ajouter)'
                rows={3}
                style={textareaStyle}
            />
            <div style={newNoteControlsRowStyle}>
                <span style={metaTextStyle}>
                    {charCount} caractère{charCount !== 1 ? 's' : ''}
                </span>
                <button
                    onClick={props.onCreate}
                    disabled={isDisabled}
                    style={isDisabled ? addButtonDisabledStyle : (props.isCreating ? addButtonWaitingStyle : addButtonActiveStyle)}
                >
                    <i className={`fa ${props.isCreating ? 'fa-spinner fa-spin' : 'fa-plus'}`} aria-hidden='true' />
                    {props.isCreating ? 'Création...' : 'Ajouter'}
                </button>
            </div>
        </div>
    );
});

export function GeocacheNotesView(props: GeocacheNotesViewProps): React.JSX.Element {
    if (!props.geocacheId) {
        return renderEmptyState();
    }

    const personalNoteTimestamp = getPersonalNoteTimestamp(
        props.gcPersonalNoteSyncedAt,
        props.gcPersonalNoteLastPushedAt
    );

    return (
        <div style={containerStyle}>
            <div style={rowBetweenStyle}>
                <div>
                    <h3 style={headingStyle}>
                        {props.geocacheCode ? `Notes - ${props.geocacheCode}` : 'Notes'}
                    </h3>
                    {props.geocacheName && (
                        <div style={subtitleStyle}>
                            {props.geocacheName}
                        </div>
                    )}
                </div>
                <button
                    onClick={props.onSyncFromGeocaching}
                    disabled={props.isSyncingFromGc}
                    style={props.isSyncingFromGc ? syncFromGcButtonWaitingStyle : syncFromGcButtonActiveStyle}
                    title='Importer la note personnelle depuis Geocaching.com'
                >
                    <i className={`fa ${props.isSyncingFromGc ? 'fa-spinner fa-spin' : 'fa-cloud-download-alt'}`} aria-hidden='true' />
                    {props.isSyncingFromGc ? 'Synchronisation...' : 'Importer note GC.com'}
                </button>
            </div>

            <div style={gcSectionStyle}>
                <div style={rowBetweenStyle}>
                    <div style={sectionTitleStyle}>Note Geocaching.com</div>
                    {!props.isEditingGcNote && (
                        <button
                            onClick={props.onStartEditGcNote}
                            disabled={props.isSavingGcNote || props.isSyncingFromGc}
                            style={(props.isSavingGcNote || props.isSyncingFromGc) ? editGcButtonWaitingStyle : editGcButtonActiveStyle}
                            title='Éditer et envoyer la note vers Geocaching.com'
                            aria-label='Éditer la note Geocaching.com'
                        >
                            <i className='fa fa-pencil' aria-hidden='true' />
                            <span>Éditer</span>
                        </button>
                    )}
                </div>
                {props.isEditingGcNote ? (
                    <div style={editColumnStyle}>
                        <textarea
                            value={props.editingGcNoteContent}
                            onChange={event => props.onEditingGcNoteContentChange(event.target.value)}
                            onKeyDown={event => {
                                if (event.key === 'Escape') {
                                    event.preventDefault();
                                    props.onCancelEditGcNote();
                                } else if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                                    event.preventDefault();
                                    props.onSaveGcNote();
                                }
                            }}
                            autoFocus={true}
                            rows={5}
                            placeholder='Contenu de la note Geocaching.com (vide pour effacer)...'
                            style={textareaStyle}
                        />
                        <div style={rowBetweenStyle}>
                            <span style={metaTextStyle}>
                                {props.editingGcNoteContent.length} / 2500 caractères
                            </span>
                            <div style={editButtonsRowStyle}>
                                <button
                                    onClick={props.onCancelEditGcNote}
                                    style={cancelButtonStyle}
                                >
                                    Annuler
                                </button>
                                <button
                                    onClick={props.onSaveGcNote}
                                    disabled={props.isSavingGcNote || props.editingGcNoteContent.length > 2500}
                                    style={(props.isSavingGcNote || props.editingGcNoteContent.length > 2500) ? saveButtonDisabledStyle : saveButtonStyle}
                                >
                                    <i className={`fa ${props.isSavingGcNote ? 'fa-spinner fa-spin' : 'fa-upload'}`} aria-hidden='true' />
                                    {props.isSavingGcNote ? 'Envoi...' : 'Envoyer vers GC.com'}
                                </button>
                            </div>
                        </div>
                    </div>
                ) : (
                    <>
                        <div style={gcNoteBoxStyle} data-gc-note='true'>
                            {props.gcPersonalNote && props.gcPersonalNote.trim().length > 0
                                ? props.gcPersonalNote
                                : 'Aucune note personnelle trouvée sur Geocaching.com.'}
                        </div>
                        {personalNoteTimestamp && (
                            <div style={metaTextStyle}>
                                {personalNoteTimestamp}
                            </div>
                        )}
                    </>
                )}
            </div>

            <div style={appSectionStyle}>
                <div style={sectionTitleStyle}>Notes de l'application</div>

                <NewNoteSection
                    content={props.newNoteContent}
                    isCreating={props.isCreating}
                    onContentChange={props.onNewNoteContentChange}
                    onCreate={props.onCreateNote}
                />

                <div style={listScrollStyle}>
                    {props.isLoading && props.notes.length === 0 ? (
                        <LoadingState message='Chargement des notes…' />
                    ) : props.notes.length === 0 ? (
                        <EmptyState icon='fa-sticky-note' title='Aucune note pour cette géocache' />
                    ) : (
                        <div style={listStyle}>
                            {props.notes.map(note => {
                                const isEditing = props.editingNoteId === note.id;
                                return (
                                    <NoteItem
                                        key={note.id}
                                        note={note}
                                        isEditing={isEditing}
                                        isSyncing={props.syncingNoteId === note.id}
                                        editingContent={isEditing ? props.editingContent : ''}
                                        editingType={isEditing ? props.editingType : 'user'}
                                        onStartEdit={props.onStartEdit}
                                        onDeleteNote={props.onDeleteNote}
                                        onSyncNoteToGeocaching={props.onSyncNoteToGeocaching}
                                        onEditingContentChange={props.onEditingContentChange}
                                        onEditingTypeChange={props.onEditingTypeChange}
                                        onCancelEdit={props.onCancelEdit}
                                        onSaveEdit={props.onSaveEdit}
                                    />
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
