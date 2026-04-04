import * as React from 'react';
import { injectable, inject } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { ConfirmSaveDialog, Dialog } from '@theia/core/lib/browser/dialogs';
import { PreferenceService } from '@theia/core/lib/common/preferences/preference-service';
import { MessageService } from '@theia/core';

interface NoteDto {
    id: number;
    content: string;
    note_type: string;
    source: string;
    source_plugin?: string | null;
    created_at: string | null;
    updated_at: string | null;
}

interface GeocacheNotesApiResponse {
    geocache_id: number;
    gc_code: string;
    name: string;
    gc_personal_note: string | null;
    gc_personal_note_synced_at: string | null;
    gc_personal_note_last_pushed_at: string | null;
    notes: NoteDto[];
}

interface SyncFromGcResponse {
    geocache_id: number;
    gc_code: string;
    gc_personal_note: string | null;
    gc_personal_note_synced_at: string | null;
}

@injectable()
export class GeocacheNotesWidget extends ReactWidget {
    static readonly ID = 'geocache.notes.widget';

    protected backendBaseUrl = 'http://localhost:8000';
    protected geocacheId?: number;
    protected geocacheCode?: string;
    protected geocacheName?: string;

    protected notes: NoteDto[] = [];
    protected gcPersonalNote: string | null = null;
    protected gcPersonalNoteSyncedAt: string | null = null;
    protected gcPersonalNoteLastPushedAt: string | null = null;

    protected isLoading = false;
    protected isCreating = false;
    protected isSyncingFromGc = false;
    protected syncingNoteId?: number;

    protected newNoteContent = '';
    protected newNoteType: 'user' | 'system' = 'user';

    protected editingNoteId?: number;
    protected editingContent = '';
    protected editingType: 'user' | 'system' = 'user';

    constructor(
        @inject(MessageService) protected readonly messages: MessageService,
        @inject(PreferenceService) protected readonly preferenceService: PreferenceService
    ) {
        super();
        this.id = GeocacheNotesWidget.ID;
        this.title.label = 'Notes';
        this.title.caption = 'Notes de la géocache';
        this.title.closable = true;
        this.title.iconClass = 'fa fa-sticky-note';
        this.addClass('theia-geocache-notes-widget');
    }

    setGeocache(params: { geocacheId: number; gcCode?: string; name?: string }): void {
        this.geocacheId = params.geocacheId;
        this.geocacheCode = params.gcCode;
        this.geocacheName = params.name;
        this.notes = [];
        this.gcPersonalNote = null;
        this.gcPersonalNoteSyncedAt = null;
        this.gcPersonalNoteLastPushedAt = null;
        this.newNoteContent = '';
        this.newNoteType = 'user';
        this.editingNoteId = undefined;
        this.editingContent = '';
        this.editingType = 'user';

        this.title.label = params.gcCode ? `Notes - ${params.gcCode}` : 'Notes';

        this.loadNotes();
        const mode = this.getGcPersonalNoteAutoSyncMode();
        if (mode === 'onNotesOpen') {
            void this.syncFromGeocaching(true);
        }
    }

    protected getGcPersonalNoteAutoSyncMode(): 'manual' | 'onNotesOpen' | 'onDetailsOpen' {
        const raw = this.preferenceService.get('geoApp.notes.gcPersonalNote.autoSyncMode', 'manual') as string;
        if (raw === 'onNotesOpen' || raw === 'onDetailsOpen' || raw === 'manual') {
            return raw;
        }
        return 'manual';
    }

    protected async loadNotes(): Promise<void> {
        if (!this.geocacheId || this.isLoading) {
            return;
        }
        this.isLoading = true;
        this.update();
        try {
            const url = `${this.backendBaseUrl}/api/geocaches/${this.geocacheId}/notes`;
            const response = await fetch(url, { credentials: 'include' });
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            const data: GeocacheNotesApiResponse = await response.json();
            this.geocacheCode = data.gc_code;
            this.geocacheName = data.name;
            this.notes = data.notes || [];
            this.gcPersonalNote = data.gc_personal_note;
            this.gcPersonalNoteSyncedAt = data.gc_personal_note_synced_at;
            this.gcPersonalNoteLastPushedAt = data.gc_personal_note_last_pushed_at;
        } catch (error) {
            console.error('[GeocacheNotesWidget] Failed to load notes:', error);
            this.messages.error('Impossible de charger les notes');
        } finally {
            this.isLoading = false;
            this.update();
        }
    }

    protected async createNote(): Promise<void> {
        if (!this.geocacheId || this.isCreating) {
            return;
        }
        const content = this.newNoteContent.trim();
        if (!content) {
            this.messages.warn('Contenu de la note requis');
            return;
        }
        this.isCreating = true;
        this.update();
        try {
            const body = {
                content,
                note_type: this.newNoteType,
                source: 'user'
            };
            const url = `${this.backendBaseUrl}/api/geocaches/${this.geocacheId}/notes`;
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify(body)
            });
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || `HTTP ${response.status}`);
            }
            this.newNoteContent = '';
            this.newNoteType = 'user';
            await this.loadNotes();
            this.messages.info('Note créée');
        } catch (error) {
            console.error('[GeocacheNotesWidget] Failed to create note:', error);
            this.messages.error('Impossible de créer la note');
        } finally {
            this.isCreating = false;
            this.update();
        }
    }

    protected startEdit(note: NoteDto): void {
        if (note.source !== 'user') {
            return;
        }
        this.editingNoteId = note.id;
        this.editingContent = note.content || '';
        this.editingType = (note.note_type === 'system' ? 'system' : 'user');
        this.update();
    }

    protected cancelEdit(): void {
        this.editingNoteId = undefined;
        this.editingContent = '';
        this.editingType = 'user';
        this.update();
    }

    protected async saveEdit(): Promise<void> {
        if (!this.editingNoteId) {
            return;
        }
        const content = this.editingContent.trim();
        if (!content) {
            this.messages.warn('Contenu de la note requis');
            return;
        }
        try {
            const body: any = { content };
            if (this.editingType) {
                body.note_type = this.editingType;
            }
            const url = `${this.backendBaseUrl}/api/notes/${this.editingNoteId}`;
            const response = await fetch(url, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify(body)
            });
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || `HTTP ${response.status}`);
            }
            this.editingNoteId = undefined;
            this.editingContent = '';
            this.editingType = 'user';
            await this.loadNotes();
            this.messages.info('Note mise à jour');
        } catch (error) {
            console.error('[GeocacheNotesWidget] Failed to update note:', error);
            this.messages.error('Impossible de mettre à jour la note');
        } finally {
            this.update();
        }
    }

    protected async deleteNote(note: NoteDto): Promise<void> {
        if (!note.id) {
            return;
        }
        if (!window.confirm('Supprimer cette note ?')) {
            return;
        }
        try {
            const url = `${this.backendBaseUrl}/api/notes/${note.id}`;
            const response = await fetch(url, {
                method: 'DELETE',
                credentials: 'include'
            });
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || `HTTP ${response.status}`);
            }
            await this.loadNotes();
            this.messages.info('Note supprimée');
        } catch (error) {
            console.error('[GeocacheNotesWidget] Failed to delete note:', error);
            this.messages.error('Impossible de supprimer la note');
        }
    }

    protected async syncFromGeocaching(silent: boolean = false): Promise<void> {
        if (!this.geocacheId || this.isSyncingFromGc) {
            return;
        }
        this.isSyncingFromGc = true;
        this.update();
        try {
            const url = `${this.backendBaseUrl}/api/geocaches/${this.geocacheId}/notes/sync-from-geocaching`;
            const response = await fetch(url, {
                method: 'POST',
                credentials: 'include'
            });
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error((errorData as any).error || `HTTP ${response.status}`);
            }

            const data: SyncFromGcResponse = await response.json();
            this.gcPersonalNote = data.gc_personal_note;
            this.gcPersonalNoteSyncedAt = data.gc_personal_note_synced_at;

            if (!silent) {
                this.messages.info('Note Geocaching.com synchronisée');
            }
        } catch (error) {
            console.error('[GeocacheNotesWidget] Failed to sync from Geocaching.com:', error);
            if (!silent) {
                this.messages.error('Impossible de synchroniser la note Geocaching.com');
            }
        } finally {
            this.isSyncingFromGc = false;
            this.update();
        }
    }

    protected async syncNoteToGeocaching(note: NoteDto): Promise<void> {
        if (!this.geocacheId || note.source !== 'user') {
            return;
        }

        const newText = (note.content || '').trim();
        let finalContent = newText;

        // S'assurer de l'état réel de la note personnelle sur Geocaching.com
        let existingGcNote = (this.gcPersonalNote || '').trim();
        if (!existingGcNote) {
            try {
                const url = `${this.backendBaseUrl}/api/geocaches/${this.geocacheId}/notes/sync-from-geocaching`;
                const response = await fetch(url, {
                    method: 'POST',
                    credentials: 'include'
                });
                if (!response.ok) {
                    const errorData = await response.json().catch(() => ({}));
                    console.error('[GeocacheNotesWidget] Failed to pre-sync note from Geocaching.com before push:', errorData);
                    this.messages.error('Impossible de vérifier la note existante sur Geocaching.com');
                    return;
                }
                const data: SyncFromGcResponse = await response.json();
                this.gcPersonalNote = data.gc_personal_note;
                this.gcPersonalNoteSyncedAt = data.gc_personal_note_synced_at;
                existingGcNote = (this.gcPersonalNote || '').trim();
            } catch (error) {
                console.error('[GeocacheNotesWidget] Failed to pre-sync note from Geocaching.com before push:', error);
                this.messages.error('Impossible de vérifier la note existante sur Geocaching.com');
                return;
            }
        }

        if (existingGcNote.length > 0) {
            const dialog = new ConfirmSaveDialog({
                title: 'Note Geocaching.com existante',
                msg: 'Une note personnelle existe déjà sur Geocaching.com pour cette géocache. Que souhaitez-vous faire avec la note sélectionnée ?',
                cancel: Dialog.CANCEL,
                dontSave: 'Ajouter à la note existante',
                save: 'Remplacer la note existante'
            });
            const decision = await dialog.open();

            // Annuler
            if (decision === undefined) {
                return;
            }

            if (decision === false) {
                // Ajouter à la note existante
                if (existingGcNote && newText) {
                    finalContent = `${existingGcNote}\n\n${newText}`;
                } else if (existingGcNote) {
                    finalContent = existingGcNote;
                } else {
                    finalContent = newText;
                }
            } else {
                // Remplacer : on garde finalContent = newText
                finalContent = newText;
            }
        }

        this.syncingNoteId = note.id;
        this.update();
        try {
            const url = `${this.backendBaseUrl}/api/notes/${note.id}/sync-to-geocaching?geocacheId=${this.geocacheId}`;
            const body = { content: finalContent };
            const response = await fetch(url, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || `HTTP ${response.status}`);
            }
            const data = await response.json();
            this.gcPersonalNote = data.gc_personal_note ?? this.gcPersonalNote;
            this.gcPersonalNoteLastPushedAt = data.gc_personal_note_last_pushed_at ?? this.gcPersonalNoteLastPushedAt;
            this.messages.info('Note envoyée vers Geocaching.com');
        } catch (error) {
            console.error('[GeocacheNotesWidget] Failed to sync note to Geocaching.com:', error);
            this.messages.error('Impossible d\'envoyer la note vers Geocaching.com');
        } finally {
            this.syncingNoteId = undefined;
            this.update();
        }
    }

    protected render(): React.ReactNode {
        if (!this.geocacheId) {
            return (
                <div style={{ 
                    padding: 16,
                    height: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    opacity: 0.7
                }}>
                    <i className='fa fa-sticky-note' style={{ fontSize: 48, marginBottom: 16 }} />
                    <p>Sélectionnez une géocache pour voir ses notes</p>
                </div>
            );
        }

        const personalNoteTimestampParts: string[] = [];
        if (this.gcPersonalNoteSyncedAt) {
            personalNoteTimestampParts.push(`Importée le ${new Date(this.gcPersonalNoteSyncedAt).toLocaleString('fr-FR')}`);
        }
        if (this.gcPersonalNoteLastPushedAt) {
            personalNoteTimestampParts.push(`Envoyée le ${new Date(this.gcPersonalNoteLastPushedAt).toLocaleString('fr-FR')}`);
        }
        const personalNoteTimestamp = personalNoteTimestampParts.join(' • ');

        return (
            <div style={{ 
                padding: 16, 
                height: '100%', 
                overflow: 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: 16
            }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                        <h3 style={{ margin: 0, fontSize: 16 }}>
                            {this.geocacheCode ? (
                                <>Notes - {this.geocacheCode}</>
                            ) : (
                                <>Notes</>
                            )}
                        </h3>
                        {this.geocacheName && (
                            <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>
                                {this.geocacheName}
                            </div>
                        )}
                    </div>
                    <button
                        onClick={() => this.syncFromGeocaching()}
                        disabled={this.isSyncingFromGc}
                        style={{
                            padding: '8px 16px',
                            background: 'var(--theia-button-background)',
                            color: 'var(--theia-button-foreground)',
                            border: 'none',
                            borderRadius: 4,
                            cursor: this.isSyncingFromGc ? 'wait' : 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8
                        }}
                        title='Importer la note personnelle depuis Geocaching.com'
                    >
                        <i className={`fa ${this.isSyncingFromGc ? 'fa-spinner fa-spin' : 'fa-cloud-download-alt'}`} />
                        {this.isSyncingFromGc ? 'Synchronisation...' : 'Importer note GC.com'}
                    </button>
                </div>

                <div style={{
                    background: 'var(--theia-editor-background)',
                    border: '1px solid var(--theia-panel-border)',
                    borderRadius: 6,
                    padding: 12,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8
                }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ fontWeight: 'bold' }}>Note Geocaching.com</div>
                    </div>
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
                        {this.gcPersonalNote && this.gcPersonalNote.trim().length > 0
                            ? this.gcPersonalNote
                            : 'Aucune note personnelle trouvée sur Geocaching.com.'}
                    </div>
                    {personalNoteTimestamp && (
                        <div style={{ fontSize: 11, opacity: 0.7 }}>
                            {personalNoteTimestamp}
                        </div>
                    )}
                </div>

                <div style={{
                    background: 'var(--theia-editor-background)',
                    border: '1px solid var(--theia-panel-border)',
                    borderRadius: 6,
                    padding: 12,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 12,
                    flex: 1,
                    minHeight: 0
                }}>
                    <div style={{ fontWeight: 'bold' }}>Notes de l'application</div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <textarea
                            value={this.newNoteContent}
                            onChange={e => {
                                this.newNoteContent = e.target.value;
                                this.update();
                            }}
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
                                value={this.newNoteType}
                                onChange={e => {
                                    const v = e.target.value === 'system' ? 'system' : 'user';
                                    this.newNoteType = v;
                                    this.update();
                                }}
                                style={{
                                    padding: '4px 8px',
                                    borderRadius: 4,
                                    border: '1px solid var(--theia-panel-border)',
                                    fontSize: 13
                                }}
                            >
                                <option value='user'>Note utilisateur</option>
                                <option value='system'>Note système</option>
                            </select>
                            <button
                                onClick={() => this.createNote()}
                                disabled={this.isCreating}
                                style={{
                                    padding: '6px 14px',
                                    background: 'var(--theia-button-background)',
                                    color: 'var(--theia-button-foreground)',
                                    border: 'none',
                                    borderRadius: 4,
                                    cursor: this.isCreating ? 'wait' : 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 8
                                }}
                            >
                                <i className={`fa ${this.isCreating ? 'fa-spinner fa-spin' : 'fa-plus'}`} />
                                {this.isCreating ? 'Création...' : 'Ajouter'}
                            </button>
                        </div>
                    </div>

                    <div style={{ marginTop: 8, flex: 1, overflow: 'auto' }}>
                        {this.isLoading && this.notes.length === 0 ? (
                            <div style={{ textAlign: 'center', padding: 20, opacity: 0.7 }}>
                                <i className='fa fa-spinner fa-spin' style={{ marginRight: 8 }} />
                                Chargement des notes...
                            </div>
                        ) : this.notes.length === 0 ? (
                            <div style={{ textAlign: 'center', padding: 20, opacity: 0.7 }}>
                                <i className='fa fa-sticky-note' style={{ marginRight: 8 }} />
                                Aucune note pour cette géocache
                            </div>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                {this.notes.map(note => {
                                    const isEditing = this.editingNoteId === note.id;
                                    const isUserNote = note.source === 'user';
                                    const typeLabel = note.note_type === 'system' ? 'Système' : 'Utilisateur';
                                    const typeColor = note.note_type === 'system' ? '#6b7280' : '#3b82f6';
                                    const created = note.created_at ? new Date(note.created_at).toLocaleString('fr-FR') : undefined;
                                    const updated = note.updated_at ? new Date(note.updated_at).toLocaleString('fr-FR') : undefined;
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
                                                            {updated && updated !== created ? ` • modifiée le ${updated}` : ''}
                                                        </span>
                                                    )}
                                                </div>
                                                <div style={{ display: 'flex', gap: 6 }}>
                                                    {isUserNote && (
                                                        <button
                                                            onClick={() => this.syncNoteToGeocaching(note)}
                                                            disabled={this.syncingNoteId === note.id}
                                                            style={{
                                                                padding: '4px 8px',
                                                                borderRadius: 4,
                                                                border: '1px solid var(--theia-panel-border)',
                                                                background: 'var(--theia-sideBar-background)',
                                                                cursor: this.syncingNoteId === note.id ? 'wait' : 'pointer',
                                                                fontSize: 11
                                                            }}
                                                            title='Envoyer cette note vers Geocaching.com'
                                                        >
                                                            <i className={`fa ${this.syncingNoteId === note.id ? 'fa-spinner fa-spin' : 'fa-upload'}`} />
                                                        </button>
                                                    )}
                                                    {isUserNote && (
                                                        <button
                                                            onClick={() => this.startEdit(note)}
                                                            style={{
                                                                padding: '4px 8px',
                                                                borderRadius: 4,
                                                                border: '1px solid var(--theia-panel-border)',
                                                                background: 'var(--theia-sideBar-background)',
                                                                cursor: 'pointer',
                                                                fontSize: 11
                                                            }}
                                                        >
                                                            ✏️
                                                        </button>
                                                    )}
                                                    <button
                                                        onClick={() => this.deleteNote(note)}
                                                        style={{
                                                            padding: '4px 8px',
                                                            borderRadius: 4,
                                                            border: '1px solid var(--theia-panel-border)',
                                                            background: 'var(--theia-sideBar-background)',
                                                            cursor: 'pointer',
                                                            fontSize: 11
                                                        }}
                                                    >
                                                        🗑️
                                                    </button>
                                                </div>
                                            </div>
                                            {isEditing ? (
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                                    <textarea
                                                        value={this.editingContent}
                                                        onChange={e => {
                                                            this.editingContent = e.target.value;
                                                            this.update();
                                                        }}
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
                                                            value={this.editingType}
                                                            onChange={e => {
                                                                const v = e.target.value === 'system' ? 'system' : 'user';
                                                                this.editingType = v;
                                                                this.update();
                                                            }}
                                                            style={{
                                                                padding: '4px 8px',
                                                                borderRadius: 4,
                                                                border: '1px solid var(--theia-panel-border)',
                                                                fontSize: 13
                                                            }}
                                                        >
                                                            <option value='user'>Note utilisateur</option>
                                                            <option value='system'>Note système</option>
                                                        </select>
                                                        <div style={{ display: 'flex', gap: 8 }}>
                                                            <button
                                                                onClick={() => this.cancelEdit()}
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
                                                                onClick={() => this.saveEdit()}
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
}
