import * as React from 'react';
import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { ConfirmDialog } from '@theia/core/lib/browser';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { MessageService } from '@theia/core';
import { PluginExecutorContribution } from '@mysterai/theia-plugins/lib/browser/plugins-contribution';
import { PluginExecutorResumeSnapshot } from '@mysterai/theia-plugins/lib/browser/plugin-executor-widget';
import { getErrorMessage } from './backend-api-client';
import { ArchiveManagerController } from './archive-manager-controller';
import { ArchiveManagerService } from './archive-manager-service';
import { ArchiveManagerView } from './archive-manager-view';
import {
    ArchiveEntry,
    ArchiveHistoryEntry,
    ArchiveListSummary,
    ArchiveSettings,
    ArchiveStats,
    BulkDeleteArchivesInput,
    BulkFilter,
    ReplayableWorkflowStep
} from './archive-manager-types';

@injectable()
export class ArchiveManagerWidget extends ReactWidget {
    static readonly ID = 'geoapp.archive.manager';

    protected stats: ArchiveStats | null = null;
    protected settings: ArchiveSettings | null = null;
    protected isLoading = false;
    protected isSaving = false;
    protected isDeleting = false;
    protected bulkFilter: BulkFilter = 'orphaned';
    protected bulkStatus = 'not_solved';
    protected bulkBeforeDate = '';
    protected lastActionResult: string | null = null;
    protected lastActionError: string | null = null;
    protected archives: ArchiveEntry[] = [];
    protected archivesPage = 1;
    protected archivePages = 1;
    protected archiveTotal = 0;
    protected archiveSearch = '';
    protected archiveStatusFilter = '';
    protected isLoadingArchives = false;
    protected isLoadingArchiveDetails = false;
    protected selectedArchiveGcCode: string | null = null;
    protected selectedArchive: ArchiveEntry | null = null;
    protected restoringHistoryEntryKey: string | null = null;
    protected replayingHistoryEntryKey: string | null = null;
    protected replayStepSelections: Record<string, string> = {};

    constructor(
        @inject(MessageService) protected readonly messages: MessageService,
        @inject(PluginExecutorContribution) protected readonly pluginExecutorContribution: PluginExecutorContribution,
        @inject(ArchiveManagerService) protected readonly archiveManagerService: ArchiveManagerService,
        @inject(ArchiveManagerController) protected readonly archiveManagerController: ArchiveManagerController,
    ) {
        super();
        this.id = ArchiveManagerWidget.ID;
        this.title.label = 'Gestionnaire Archive';
        this.title.caption = 'Gerer l archive de resolution des geocaches';
        this.title.closable = true;
        this.title.iconClass = 'fa fa-database';
        this.addClass('theia-archive-manager-widget');
    }

    @postConstruct()
    initialize(): void {
        void this.loadData();
    }

    protected async loadData(): Promise<void> {
        this.isLoading = true;
        this.update();
        try {
            const [statsResult, settingsResult] = await Promise.allSettled([
                this.archiveManagerService.getStats(),
                this.archiveManagerService.getSettings(),
            ]);
            if (statsResult.status === 'fulfilled') {
                this.stats = statsResult.value;
            } else {
                console.error('[ArchiveManagerWidget] loadData stats error', statsResult.reason);
            }
            if (settingsResult.status === 'fulfilled') {
                this.settings = settingsResult.value;
            } else {
                console.error('[ArchiveManagerWidget] loadData settings error', settingsResult.reason);
            }
            await this.loadArchives(false);
        } catch (error) {
            console.error('[ArchiveManagerWidget] loadData error', error);
        } finally {
            this.isLoading = false;
            this.update();
        }
    }

    protected async loadArchives(preserveSelection: boolean = true): Promise<void> {
        this.isLoadingArchives = true;
        this.update();
        try {
            const payload = await this.archiveManagerService.listArchives({
                page: this.archivesPage,
                perPage: 12,
                solvedStatus: this.archiveStatusFilter,
                gcCode: this.archiveSearch,
            });
            this.archives = Array.isArray(payload.archives) ? payload.archives : [];
            this.archiveTotal = Number(payload.total || 0);
            this.archivePages = Math.max(1, Number(payload.pages || 1));
            this.archivesPage = Math.min(this.archivesPage, this.archivePages);

            const nextSelectedGcCode = preserveSelection
                ? (this.selectedArchiveGcCode && this.archives.some(entry => entry.gc_code === this.selectedArchiveGcCode)
                    ? this.selectedArchiveGcCode
                    : this.archives[0]?.gc_code || null)
                : this.archives[0]?.gc_code || null;

            this.selectedArchiveGcCode = nextSelectedGcCode;
            this.selectedArchive = nextSelectedGcCode
                ? (this.archives.find(entry => entry.gc_code === nextSelectedGcCode) || null)
                : null;

            if (nextSelectedGcCode) {
                await this.loadArchiveDetails(nextSelectedGcCode);
            }
        } catch (error) {
            this.lastActionError = `Erreur chargement archives : ${getErrorMessage(error, 'Erreur lors du chargement des archives')}`;
            console.error('[ArchiveManagerWidget] loadArchives error', error);
        } finally {
            this.isLoadingArchives = false;
            this.update();
        }
    }

    protected async loadArchiveDetails(gcCode: string): Promise<void> {
        if (!gcCode) {
            this.selectedArchive = null;
            this.selectedArchiveGcCode = null;
            this.update();
            return;
        }

        this.isLoadingArchiveDetails = true;
        this.selectedArchiveGcCode = gcCode;
        this.update();

        try {
            this.selectedArchive = await this.archiveManagerService.getArchive(gcCode);
        } catch (error) {
            this.selectedArchive = this.archives.find(entry => entry.gc_code === gcCode) || null;
            this.lastActionError = `Erreur chargement detail archive : ${getErrorMessage(error, 'Erreur lors du chargement du detail archive')}`;
            console.error('[ArchiveManagerWidget] loadArchiveDetails error', error);
        } finally {
            this.isLoadingArchiveDetails = false;
            this.update();
        }
    }

    protected setArchiveSearch(value: string): void {
        this.archiveSearch = value;
        this.update();
    }

    protected setArchiveStatusFilter(value: string): void {
        this.archiveStatusFilter = value;
        this.archivesPage = 1;
        this.update();
    }

    protected goToPreviousArchivesPage(): void {
        this.archivesPage = Math.max(1, this.archivesPage - 1);
        void this.loadArchives(true);
    }

    protected goToNextArchivesPage(): void {
        this.archivesPage = Math.min(this.archivePages, this.archivesPage + 1);
        void this.loadArchives(true);
    }

    protected setReplayStepSelection(historyEntryKey: string, value: string): void {
        this.replayStepSelections[historyEntryKey] = value;
        this.update();
    }

    protected setBulkFilter(value: BulkFilter): void {
        this.bulkFilter = value;
        this.update();
    }

    protected setBulkStatus(value: string): void {
        this.bulkStatus = value;
        this.update();
    }

    protected setBulkBeforeDate(value: string): void {
        this.bulkBeforeDate = value;
        this.update();
    }

    protected getHistoryEntries(entry: ArchiveEntry | null): ArchiveHistoryEntry[] {
        return this.archiveManagerController.getHistoryEntries(entry);
    }

    protected getHistoryEntryKey(entry: ArchiveHistoryEntry, index: number): string {
        return this.archiveManagerController.getHistoryEntryKey(entry, index);
    }

    protected getArchiveListSummary(entry: ArchiveEntry): ArchiveListSummary | null {
        return this.archiveManagerController.getArchiveListSummary(entry);
    }

    protected getReplayableSteps(resumeSnapshot: PluginExecutorResumeSnapshot): ReplayableWorkflowStep[] {
        return this.archiveManagerController.getReplayableSteps(resumeSnapshot);
    }

    protected getNextReplayableStep(resumeSnapshot: PluginExecutorResumeSnapshot): ReplayableWorkflowStep | null {
        return this.archiveManagerController.getNextReplayableStep(resumeSnapshot);
    }

    protected async restoreHistoryEntry(entry: ArchiveHistoryEntry, index: number): Promise<void> {
        const archive = this.selectedArchive;
        if (!archive || !entry.resume_state) {
            this.messages.warn('Aucun snapshot exploitable pour cette tentative.');
            return;
        }

        const historyEntryKey = this.getHistoryEntryKey(entry, index);
        this.restoringHistoryEntryKey = historyEntryKey;
        this.update();

        try {
            const { context, usedArchiveFallback } = await this.archiveManagerController.prepareHistoryRestoreContext(archive, entry);
            await this.pluginExecutorContribution.openWithContext(context, 'metasolver', false);

            if (usedArchiveFallback) {
                this.messages.warn(`Tentative restauree depuis l archive pour ${archive.gc_code} (contexte live indisponible).`);
            } else {
                this.messages.info(`Tentative restauree dans le Plugin Executor pour ${archive.gc_code}.`);
            }
        } catch (error) {
            console.error('[ArchiveManagerWidget] restoreHistoryEntry error', error);
            this.messages.error(`Erreur restauration tentative : ${getErrorMessage(error, 'Erreur lors de la restauration de tentative')}`);
        } finally {
            this.restoringHistoryEntryKey = null;
            this.update();
        }
    }

    protected async replayHistoryEntry(entry: ArchiveHistoryEntry, index: number, targetStepId?: string): Promise<void> {
        const archive = this.selectedArchive;
        const resumeSnapshot = entry.resume_state || null;
        if (!archive || !resumeSnapshot) {
            this.messages.warn('Aucun snapshot exploitable pour cette tentative.');
            return;
        }

        const replayableSteps = this.getReplayableSteps(resumeSnapshot);
        const nextStep = targetStepId
            ? replayableSteps.find(step => step.id === targetStepId) || null
            : this.getNextReplayableStep(resumeSnapshot);
        if (!nextStep) {
            this.messages.warn('Aucune etape backend rejouable pour cette tentative.');
            return;
        }

        const historyEntryKey = this.getHistoryEntryKey(entry, index);
        this.replayingHistoryEntryKey = historyEntryKey;
        this.update();

        try {
            const replayResult = await this.archiveManagerController.replayHistoryEntry(archive, entry, nextStep.id);
            await this.loadArchives(true);

            const fallbackMessageSuffix = replayResult.usedArchiveFallback
                ? ' Contexte live indisponible, rejeu base sur le snapshot archive.'
                : '';
            if (replayResult.response.status === 'success') {
                this.messages.info(`${replayResult.response.message}${fallbackMessageSuffix}`);
            } else {
                this.messages.warn(`${replayResult.response.message}${fallbackMessageSuffix}`);
            }
        } catch (error) {
            console.error('[ArchiveManagerWidget] replayHistoryEntry error', error);
            this.messages.error(`Erreur rejeu tentative : ${getErrorMessage(error, 'Erreur lors du rejeu de tentative')}`);
        } finally {
            this.replayingHistoryEntryKey = null;
            this.update();
        }
    }

    protected toggleAutoSync = async (): Promise<void> => {
        if (!this.settings) {
            return;
        }

        const current = this.settings.auto_sync_enabled;
        if (current) {
            const dialog = new ConfirmDialog({
                title: 'Desactiver l archivage automatique',
                msg: [
                    'Attention : action non recommandee.',
                    '',
                    'Desactiver l archivage automatique signifie que les donnees de resolution',
                    '(statut, coordonnees corrigees, notes, waypoints) ne seront plus sauvegardees',
                    'automatiquement. En cas de suppression d une geocache, ces donnees seront perdues.',
                    '',
                    'Le snapshot avant suppression restera actif comme filet de securite minimal.',
                    '',
                    'Etes-vous sur de vouloir desactiver cette protection ?',
                ].join('\n'),
                ok: 'Desactiver quand meme',
                cancel: 'Annuler',
            });
            const confirmed = await dialog.open();
            if (!confirmed) {
                return;
            }
        }

        this.isSaving = true;
        this.update();
        try {
            const result = await this.archiveManagerService.updateSettings(!current);
            this.settings = { auto_sync_enabled: result.auto_sync_enabled };
            if (result.warning) {
                this.messages.warn(result.warning);
            } else {
                this.messages.info('Archivage automatique active.');
            }
        } catch (error) {
            this.messages.error(`Erreur : ${getErrorMessage(error, 'Erreur lors de la mise a jour des parametres archive')}`);
        } finally {
            this.isSaving = false;
            this.update();
        }
    };

    protected getBulkPreviewLabel(): string {
        return this.archiveManagerController.getBulkPreviewLabel(this.bulkFilter, this.bulkStatus, this.bulkBeforeDate);
    }

    protected executeBulkDelete = async (): Promise<void> => {
        if (this.bulkFilter === 'before_date' && !this.bulkBeforeDate) {
            this.messages.warn('Veuillez saisir une date avant de continuer.');
            return;
        }

        const step1 = new ConfirmDialog({
            title: 'Suppression en masse - Etape 1/2',
            msg: [
                'Attention : cette operation est irreversible.',
                '',
                `Vous allez supprimer : ${this.getBulkPreviewLabel()}`,
                '',
                'Les donnees supprimees ne peuvent pas etre recuperees.',
                'Souhaitez-vous continuer ?',
            ].join('\n'),
            ok: 'Continuer vers la confirmation finale',
            cancel: 'Annuler',
        });
        const ok1 = await step1.open();
        if (!ok1) {
            return;
        }

        const step2 = new ConfirmDialog({
            title: 'Suppression en masse - Confirmation finale',
            msg: [
                'Derniere chance : confirmez-vous la suppression irreversible ?',
                '',
                `Cible : ${this.getBulkPreviewLabel()}`,
                '',
                'Cliquer sur "Supprimer definitivement" lancera immediatement l operation.',
            ].join('\n'),
            ok: 'Supprimer definitivement',
            cancel: 'Annuler',
        });
        const ok2 = await step2.open();
        if (!ok2) {
            return;
        }

        this.isDeleting = true;
        this.lastActionResult = null;
        this.lastActionError = null;
        this.update();

        try {
            const body: BulkDeleteArchivesInput = {
                confirm: true,
                filter: this.bulkFilter,
            };
            if (this.bulkFilter === 'by_status') {
                body.status = this.bulkStatus;
            }
            if (this.bulkFilter === 'before_date') {
                body.before_date = this.bulkBeforeDate;
            }

            const result = await this.archiveManagerService.bulkDeleteArchives(body);
            this.lastActionResult = `${result.deleted} entree(s) supprimee(s).`;
            this.messages.info(`Archive : ${result.deleted} entree(s) supprimee(s).`);
            await this.loadData();
        } catch (error) {
            const message = getErrorMessage(error, 'Erreur lors de la suppression archive');
            this.lastActionError = `Erreur : ${message}`;
            this.messages.error(`Erreur suppression archive : ${message}`);
        } finally {
            this.isDeleting = false;
            this.update();
        }
    };

    protected render(): React.ReactNode {
        return (
            <ArchiveManagerView
                isLoading={this.isLoading}
                stats={this.stats}
                autoSync={this.settings?.auto_sync_enabled ?? true}
                isSaving={this.isSaving}
                isDeleting={this.isDeleting}
                archiveTotal={this.archiveTotal}
                archiveSearch={this.archiveSearch}
                archiveStatusFilter={this.archiveStatusFilter}
                archives={this.archives}
                archivesPage={this.archivesPage}
                archivePages={this.archivePages}
                isLoadingArchives={this.isLoadingArchives}
                isLoadingArchiveDetails={this.isLoadingArchiveDetails}
                selectedArchiveGcCode={this.selectedArchiveGcCode}
                selectedArchive={this.selectedArchive}
                historyEntries={this.getHistoryEntries(this.selectedArchive)}
                restoringHistoryEntryKey={this.restoringHistoryEntryKey}
                replayingHistoryEntryKey={this.replayingHistoryEntryKey}
                replayStepSelections={this.replayStepSelections}
                bulkFilter={this.bulkFilter}
                bulkStatus={this.bulkStatus}
                bulkBeforeDate={this.bulkBeforeDate}
                bulkPreviewLabel={this.getBulkPreviewLabel()}
                lastActionResult={this.lastActionResult}
                lastActionError={this.lastActionError}
                onReload={() => { void this.loadData(); }}
                onToggleAutoSync={() => { void this.toggleAutoSync(); }}
                onArchiveSearchChange={value => this.setArchiveSearch(value)}
                onArchiveStatusFilterChange={value => this.setArchiveStatusFilter(value)}
                onLoadArchives={() => { void this.loadArchives(false); }}
                onSelectArchive={gcCode => { void this.loadArchiveDetails(gcCode); }}
                onPreviousArchivesPage={() => this.goToPreviousArchivesPage()}
                onNextArchivesPage={() => this.goToNextArchivesPage()}
                onReloadSelectedArchive={gcCode => { void this.loadArchiveDetails(gcCode); }}
                onRestoreHistoryEntry={(entry, index) => { void this.restoreHistoryEntry(entry, index); }}
                onReplayHistoryEntry={(entry, index, targetStepId) => { void this.replayHistoryEntry(entry, index, targetStepId); }}
                onReplayStepSelectionChange={(historyEntryKey, value) => this.setReplayStepSelection(historyEntryKey, value)}
                onBulkFilterChange={value => this.setBulkFilter(value)}
                onBulkStatusChange={value => this.setBulkStatus(value)}
                onBulkBeforeDateChange={value => this.setBulkBeforeDate(value)}
                onExecuteBulkDelete={() => { void this.executeBulkDelete(); }}
                getArchiveListSummary={entry => this.getArchiveListSummary(entry)}
                getHistoryEntryKey={(entry, index) => this.getHistoryEntryKey(entry, index)}
                getReplayableSteps={resumeSnapshot => this.getReplayableSteps(resumeSnapshot)}
                getNextReplayableStep={resumeSnapshot => this.getNextReplayableStep(resumeSnapshot)}
            />
        );
    }
}
