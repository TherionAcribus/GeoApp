import * as React from 'react';
import { injectable, inject } from '@theia/core/shared/inversify';
import { ConfirmDialog, Dialog } from '@theia/core/lib/browser';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { ConfirmSaveDialog } from '@theia/core/lib/browser/dialogs';
import { MessageService } from '@theia/core';
import { getErrorMessage } from './backend-api-client';
import { GeocacheNoteSyncConflictDecision, GeocacheNotesController } from './geocache-notes-controller';
import { GeocacheNotesView } from './geocache-notes-view';
import {
    GeocacheNoteDto,
    GeocacheNotesApiResponse,
    GeocacheNoteType,
    SyncFromGeocachingResponse,
    SyncNoteToGeocachingResponse
} from './geocache-notes-types';

@injectable()
export class GeocacheNotesWidget extends ReactWidget {
    static readonly ID = 'geocache.notes.widget';

    protected geocacheId?: number;
    protected geocacheCode?: string;
    protected geocacheName?: string;

    protected notes: GeocacheNoteDto[] = [];
    protected gcPersonalNote: string | null = null;
    protected gcPersonalNoteSyncedAt: string | null = null;
    protected gcPersonalNoteLastPushedAt: string | null = null;

    protected isLoading = false;
    protected isCreating = false;
    protected isSyncingFromGc = false;
    protected syncingNoteId?: number;

    protected newNoteContent = '';
    protected newNoteType: GeocacheNoteType = 'user';

    protected editingNoteId?: number;
    protected editingContent = '';
    protected editingType: GeocacheNoteType = 'user';

    protected loadRequestToken = 0;

    constructor(
        @inject(MessageService) protected readonly messages: MessageService,
        @inject(GeocacheNotesController) protected readonly notesController: GeocacheNotesController
    ) {
        super();
        this.id = GeocacheNotesWidget.ID;
        this.title.label = 'Notes';
        this.title.caption = 'Notes de la geocache';
        this.title.closable = true;
        this.title.iconClass = 'fa fa-sticky-note';
        this.addClass('theia-geocache-notes-widget');
    }

    setGeocache(params: { geocacheId: number; gcCode?: string; name?: string }): void {
        this.loadRequestToken += 1;
        this.geocacheId = params.geocacheId;
        this.geocacheCode = params.gcCode;
        this.geocacheName = params.name;
        this.resetWidgetState();
        this.title.label = params.gcCode ? `Notes - ${params.gcCode}` : 'Notes';

        void this.loadNotes();

        if (this.notesController.getGcPersonalNoteAutoSyncMode() === 'onNotesOpen') {
            void this.syncFromGeocaching(true);
        }
    }

    protected resetWidgetState(): void {
        this.notes = [];
        this.gcPersonalNote = null;
        this.gcPersonalNoteSyncedAt = null;
        this.gcPersonalNoteLastPushedAt = null;
        this.isLoading = false;
        this.isCreating = false;
        this.isSyncingFromGc = false;
        this.syncingNoteId = undefined;
        this.newNoteContent = '';
        this.newNoteType = 'user';
        this.editingNoteId = undefined;
        this.editingContent = '';
        this.editingType = 'user';
    }

    protected applyNotesData(data: GeocacheNotesApiResponse): void {
        this.geocacheCode = data.gc_code;
        this.geocacheName = data.name;
        this.notes = Array.isArray(data.notes) ? data.notes : [];
        this.gcPersonalNote = data.gc_personal_note;
        this.gcPersonalNoteSyncedAt = data.gc_personal_note_synced_at;
        this.gcPersonalNoteLastPushedAt = data.gc_personal_note_last_pushed_at;
    }

    protected applyGcPersonalNoteState(data: {
        gc_personal_note?: string | null;
        gc_personal_note_synced_at?: string | null;
        gc_personal_note_last_pushed_at?: string | null;
    }): void {
        if (data.gc_personal_note !== undefined) {
            this.gcPersonalNote = data.gc_personal_note;
        }
        if (data.gc_personal_note_synced_at !== undefined) {
            this.gcPersonalNoteSyncedAt = data.gc_personal_note_synced_at;
        }
        if (data.gc_personal_note_last_pushed_at !== undefined) {
            this.gcPersonalNoteLastPushedAt = data.gc_personal_note_last_pushed_at;
        }
    }

    protected setNewNoteContent(value: string): void {
        this.newNoteContent = value;
        this.update();
    }

    protected setNewNoteType(value: GeocacheNoteType): void {
        this.newNoteType = value;
        this.update();
    }

    protected setEditingContent(value: string): void {
        this.editingContent = value;
        this.update();
    }

    protected setEditingType(value: GeocacheNoteType): void {
        this.editingType = value;
        this.update();
    }

    protected async loadNotes(): Promise<void> {
        const geocacheId = this.geocacheId;
        if (!geocacheId || this.isLoading) {
            return;
        }

        const requestToken = ++this.loadRequestToken;
        this.isLoading = true;
        this.update();

        try {
            const data = await this.notesController.loadNotes(geocacheId);
            if (requestToken !== this.loadRequestToken || geocacheId !== this.geocacheId) {
                return;
            }
            this.applyNotesData(data);
        } catch (error) {
            if (requestToken !== this.loadRequestToken || geocacheId !== this.geocacheId) {
                return;
            }
            console.error('[GeocacheNotesWidget] Failed to load notes:', error);
            this.messages.error(getErrorMessage(error, 'Impossible de charger les notes'));
        } finally {
            if (requestToken === this.loadRequestToken) {
                this.isLoading = false;
                this.update();
            }
        }
    }

    protected async createNote(): Promise<void> {
        const geocacheId = this.geocacheId;
        if (!geocacheId || this.isCreating) {
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
            await this.notesController.createNote(geocacheId, content, this.newNoteType);
            this.newNoteContent = '';
            this.newNoteType = 'user';
            await this.loadNotes();
            this.messages.info('Note creee');
        } catch (error) {
            console.error('[GeocacheNotesWidget] Failed to create note:', error);
            this.messages.error(getErrorMessage(error, 'Impossible de creer la note'));
        } finally {
            this.isCreating = false;
            this.update();
        }
    }

    protected startEdit(note: GeocacheNoteDto): void {
        if (note.source !== 'user') {
            return;
        }
        this.editingNoteId = note.id;
        this.editingContent = note.content || '';
        this.editingType = note.note_type === 'system' ? 'system' : 'user';
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
            await this.notesController.updateNote(this.editingNoteId, content, this.editingType);
            this.cancelEdit();
            await this.loadNotes();
            this.messages.info('Note mise a jour');
        } catch (error) {
            console.error('[GeocacheNotesWidget] Failed to update note:', error);
            this.messages.error(getErrorMessage(error, 'Impossible de mettre a jour la note'));
        }
    }

    protected async confirmDeleteNote(): Promise<boolean> {
        const dialog = new ConfirmDialog({
            title: 'Supprimer la note',
            msg: 'Supprimer cette note ?',
            ok: 'Supprimer',
            cancel: Dialog.CANCEL
        });
        return dialog.open();
    }

    protected async deleteNote(note: GeocacheNoteDto): Promise<void> {
        if (!note.id) {
            return;
        }
        if (!(await this.confirmDeleteNote())) {
            return;
        }

        try {
            await this.notesController.deleteNote(note.id);
            await this.loadNotes();
            this.messages.info('Note supprimee');
        } catch (error) {
            console.error('[GeocacheNotesWidget] Failed to delete note:', error);
            this.messages.error(getErrorMessage(error, 'Impossible de supprimer la note'));
        }
    }

    protected async syncFromGeocaching(silent: boolean = false): Promise<void> {
        const geocacheId = this.geocacheId;
        if (!geocacheId || this.isSyncingFromGc) {
            return;
        }

        this.isSyncingFromGc = true;
        this.update();

        try {
            const data = await this.notesController.syncFromGeocaching(geocacheId);
            if (geocacheId !== this.geocacheId) {
                return;
            }
            this.applyGcPersonalNoteState(data);
            if (!silent) {
                this.messages.info('Note Geocaching.com synchronisee');
            }
        } catch (error) {
            console.error('[GeocacheNotesWidget] Failed to sync from Geocaching.com:', error);
            if (!silent) {
                this.messages.error(getErrorMessage(error, 'Impossible de synchroniser la note Geocaching.com'));
            }
        } finally {
            if (geocacheId === this.geocacheId) {
                this.isSyncingFromGc = false;
                this.update();
            }
        }
    }

    protected async resolveSyncConflict(
        _existingGcNote: string,
        _newText: string
    ): Promise<GeocacheNoteSyncConflictDecision> {
        const dialog = new ConfirmSaveDialog({
            title: 'Note Geocaching.com existante',
            msg: 'Une note personnelle existe deja sur Geocaching.com pour cette geocache. Que souhaitez-vous faire avec la note selectionnee ?',
            cancel: Dialog.CANCEL,
            dontSave: 'Ajouter a la note existante',
            save: 'Remplacer la note existante'
        });
        const decision = await dialog.open();
        if (decision === undefined) {
            return 'cancel';
        }
        return decision === false ? 'append' : 'replace';
    }

    protected async syncNoteToGeocaching(note: GeocacheNoteDto): Promise<void> {
        const geocacheId = this.geocacheId;
        if (!geocacheId || note.source !== 'user') {
            return;
        }

        this.syncingNoteId = note.id;
        this.update();

        try {
            const result = await this.notesController.syncUserNoteToGeocaching(
                {
                    geocacheId,
                    note,
                    gcPersonalNote: this.gcPersonalNote
                },
                (existingGcNote, newText) => this.resolveSyncConflict(existingGcNote, newText)
            );

            if (geocacheId !== this.geocacheId) {
                return;
            }

            if (result.syncedFromGeocaching) {
                this.applyGcPersonalNoteState(result.syncedFromGeocaching);
            }

            if (result.cancelled) {
                return;
            }

            if (result.syncedToGeocaching) {
                this.applyGcPersonalNoteState(result.syncedToGeocaching);
                this.messages.info('Note envoyee vers Geocaching.com');
            }
        } catch (error) {
            console.error('[GeocacheNotesWidget] Failed to sync note to Geocaching.com:', error);
            this.messages.error(getErrorMessage(error, 'Impossible d\'envoyer la note vers Geocaching.com'));
        } finally {
            if (this.syncingNoteId === note.id) {
                this.syncingNoteId = undefined;
                this.update();
            }
        }
    }

    protected render(): React.ReactNode {
        return (
            <GeocacheNotesView
                geocacheId={this.geocacheId}
                geocacheCode={this.geocacheCode}
                geocacheName={this.geocacheName}
                notes={this.notes}
                gcPersonalNote={this.gcPersonalNote}
                gcPersonalNoteSyncedAt={this.gcPersonalNoteSyncedAt}
                gcPersonalNoteLastPushedAt={this.gcPersonalNoteLastPushedAt}
                isLoading={this.isLoading}
                isCreating={this.isCreating}
                isSyncingFromGc={this.isSyncingFromGc}
                syncingNoteId={this.syncingNoteId}
                newNoteContent={this.newNoteContent}
                newNoteType={this.newNoteType}
                editingNoteId={this.editingNoteId}
                editingContent={this.editingContent}
                editingType={this.editingType}
                onSyncFromGeocaching={() => {
                    void this.syncFromGeocaching();
                }}
                onNewNoteContentChange={value => this.setNewNoteContent(value)}
                onNewNoteTypeChange={value => this.setNewNoteType(value)}
                onCreateNote={() => {
                    void this.createNote();
                }}
                onStartEdit={note => this.startEdit(note)}
                onDeleteNote={note => {
                    void this.deleteNote(note);
                }}
                onSyncNoteToGeocaching={note => {
                    void this.syncNoteToGeocaching(note);
                }}
                onEditingContentChange={value => this.setEditingContent(value)}
                onEditingTypeChange={value => this.setEditingType(value)}
                onCancelEdit={() => this.cancelEdit()}
                onSaveEdit={() => {
                    void this.saveEdit();
                }}
            />
        );
    }
}
