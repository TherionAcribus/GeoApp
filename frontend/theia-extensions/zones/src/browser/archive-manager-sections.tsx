import * as React from 'react';
import { PluginExecutorResumeSnapshot } from '@mysterai/theia-plugins/lib/browser/plugin-executor-widget';
import {
    ARCHIVE_STATUS_FILTER_OPTIONS,
    ArchiveEntry,
    ArchiveHistoryEntry,
    ArchiveListSummary,
    ArchiveStats,
    BulkFilter,
    BULK_FILTER_LABELS,
    CONTROL_STATUS_LABELS,
    ReplayableWorkflowStep,
    STATUS_OPTIONS,
    WORKFLOW_KIND_LABELS,
} from './archive-manager-types';
import { formatArchiveDate, truncateArchiveText } from './archive-manager-utils';

const sectionStyle: React.CSSProperties = {
    background: 'var(--theia-editor-background)',
    border: '1px solid var(--theia-panel-border)',
    borderRadius: 6,
    padding: 16,
};

const inputStyle: React.CSSProperties = {
    background: 'var(--theia-input-background)',
    color: 'var(--theia-input-foreground)',
    border: '1px solid var(--theia-panel-border)',
    borderRadius: 4,
};

export interface ArchiveManagerHeaderSectionProps {
    isLoading: boolean;
    onReload: () => void;
}

export interface ArchiveStatsSectionProps {
    isLoading: boolean;
    stats: ArchiveStats | null;
}

export interface ArchiveAutoSyncSectionProps {
    autoSync: boolean;
    isSaving: boolean;
    onToggleAutoSync: () => void;
}

export interface ArchiveBrowserSectionProps {
    archiveTotal: number;
    archiveSearch: string;
    archiveStatusFilter: string;
    archives: ArchiveEntry[];
    archivesPage: number;
    archivePages: number;
    isLoadingArchives: boolean;
    isLoadingArchiveDetails: boolean;
    selectedArchiveGcCode: string | null;
    selectedArchive: ArchiveEntry | null;
    historyEntries: ArchiveHistoryEntry[];
    restoringHistoryEntryKey: string | null;
    replayingHistoryEntryKey: string | null;
    replayStepSelections: Record<string, string>;
    onArchiveSearchChange: (value: string) => void;
    onArchiveStatusFilterChange: (value: string) => void;
    onLoadArchives: () => void;
    onSelectArchive: (gcCode: string) => void;
    onPreviousArchivesPage: () => void;
    onNextArchivesPage: () => void;
    onReloadSelectedArchive: (gcCode: string) => void;
    onRestoreHistoryEntry: (entry: ArchiveHistoryEntry, index: number) => void;
    onReplayHistoryEntry: (entry: ArchiveHistoryEntry, index: number, targetStepId?: string) => void;
    onReplayStepSelectionChange: (historyEntryKey: string, value: string) => void;
    getArchiveListSummary: (entry: ArchiveEntry) => ArchiveListSummary | null;
    getHistoryEntryKey: (entry: ArchiveHistoryEntry, index: number) => string;
    getReplayableSteps: (resumeSnapshot: PluginExecutorResumeSnapshot) => ReplayableWorkflowStep[];
    getNextReplayableStep: (resumeSnapshot: PluginExecutorResumeSnapshot) => ReplayableWorkflowStep | null;
}

export interface ArchiveBulkDeleteSectionProps {
    isDeleting: boolean;
    bulkFilter: BulkFilter;
    bulkStatus: string;
    bulkBeforeDate: string;
    bulkPreviewLabel: string;
    lastActionResult: string | null;
    lastActionError: string | null;
    onBulkFilterChange: (value: BulkFilter) => void;
    onBulkStatusChange: (value: string) => void;
    onBulkBeforeDateChange: (value: string) => void;
    onExecuteBulkDelete: () => void;
}

export const ArchiveManagerHeaderSection: React.FC<ArchiveManagerHeaderSectionProps> = ({ isLoading, onReload }) => (
    <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
        Gestionnaire d'Archive
        <button
            className='theia-button secondary'
            onClick={onReload}
            disabled={isLoading}
            style={{ fontSize: 12, padding: '3px 10px', marginLeft: 8 }}
            title='Rafraichir les statistiques'
        >
            {isLoading ? '...' : 'Rafraichir'}
        </button>
    </h2>
);

export const ArchiveStatsSection: React.FC<ArchiveStatsSectionProps> = ({ isLoading, stats }) => (
    <div style={sectionStyle}>
        <h4 style={{ margin: '0 0 12px 0' }}>Statistiques de l'archive</h4>
        {isLoading ? <div style={{ opacity: 0.7 }}>Chargement...</div> : stats ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
                {[
                    { label: 'Total archivees', value: stats.total_archived, color: '#60a5fa' },
                    { label: 'Resolues', value: stats.solved, color: '#10b981' },
                    { label: 'En cours', value: stats.in_progress, color: '#f59e0b' },
                    { label: 'Trouvees', value: stats.found, color: '#a78bfa' },
                ].map(({ label, value, color }) => (
                    <div key={label} style={{ textAlign: 'center', background: 'var(--theia-sideBar-background)', borderRadius: 4, padding: 8 }}>
                        <div style={{ fontSize: 22, fontWeight: 'bold', color }}>{value}</div>
                        <div style={{ fontSize: 11, opacity: 0.7 }}>{label}</div>
                    </div>
                ))}
            </div>
        ) : <div style={{ opacity: 0.7 }}>Aucune donnee disponible.</div>}
    </div>
);

export const ArchiveAutoSyncSection: React.FC<ArchiveAutoSyncSectionProps> = ({ autoSync, isSaving, onToggleAutoSync }) => (
    <div style={{ ...sectionStyle, border: `1px solid ${autoSync ? 'var(--theia-panel-border)' : '#f59e0b'}` }}>
        <h4 style={{ margin: '0 0 8px 0' }}>Archivage automatique</h4>
        {!autoSync ? (
            <div style={{ background: '#92400e22', border: '1px solid #f59e0b', borderRadius: 4, padding: '8px 12px', marginBottom: 12, fontSize: 12, color: '#fbbf24' }}>
                <strong>Archivage automatique desactive.</strong> Les donnees de resolution ne sont plus sauvegardees automatiquement. Le snapshot avant suppression reste actif.
            </div>
        ) : undefined}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
                <div style={{ fontWeight: 'bold', fontSize: 13 }}>{autoSync ? 'Active (recommande)' : 'Desactive (non recommande)'}</div>
                <div style={{ fontSize: 11, opacity: 0.7, marginTop: 4, maxWidth: 480 }}>
                    Synchronise automatiquement l'archive lors des changements d'etat (statut, coordonnees, notes, waypoints). Le snapshot avant suppression reste toujours actif.
                </div>
            </div>
            <button
                className={`theia-button ${autoSync ? 'secondary' : ''}`}
                onClick={onToggleAutoSync}
                disabled={isSaving}
                style={{ fontSize: 12, padding: '6px 14px', whiteSpace: 'nowrap' }}
            >
                {isSaving ? '...' : autoSync ? 'Desactiver' : 'Activer'}
            </button>
        </div>
    </div>
);

interface ArchiveHistoryCardProps {
    entry: ArchiveHistoryEntry;
    index: number;
    restoringHistoryEntryKey: string | null;
    replayingHistoryEntryKey: string | null;
    replayStepSelections: Record<string, string>;
    onRestoreHistoryEntry: (entry: ArchiveHistoryEntry, index: number) => void;
    onReplayHistoryEntry: (entry: ArchiveHistoryEntry, index: number, targetStepId?: string) => void;
    onReplayStepSelectionChange: (historyEntryKey: string, value: string) => void;
    getHistoryEntryKey: (entry: ArchiveHistoryEntry, index: number) => string;
    getReplayableSteps: (resumeSnapshot: PluginExecutorResumeSnapshot) => ReplayableWorkflowStep[];
    getNextReplayableStep: (resumeSnapshot: PluginExecutorResumeSnapshot) => ReplayableWorkflowStep | null;
}

const ArchiveHistoryCard: React.FC<ArchiveHistoryCardProps> = ({
    entry,
    index,
    restoringHistoryEntryKey,
    replayingHistoryEntryKey,
    replayStepSelections,
    onRestoreHistoryEntry,
    onReplayHistoryEntry,
    onReplayStepSelectionChange,
    getHistoryEntryKey,
    getReplayableSteps,
    getNextReplayableStep,
}) => {
    const historyEntryKey = getHistoryEntryKey(entry, index);
    const isRestoring = restoringHistoryEntryKey === historyEntryKey;
    const isReplaying = replayingHistoryEntryKey === historyEntryKey;
    const replayableSteps = entry.resume_state ? getReplayableSteps(entry.resume_state) : [];
    const defaultReplayableStep = entry.resume_state ? getNextReplayableStep(entry.resume_state) : null;
    const selectedReplayStepId = replayStepSelections[historyEntryKey] || defaultReplayableStep?.id || replayableSteps[0]?.id || '';
    const replayableStep = replayableSteps.find(step => step.id === selectedReplayStepId) || defaultReplayableStep || null;
    const canReplay = Boolean(
        replayableStep
        && entry.resume_state?.workflowResolution?.control?.status !== 'budget_exhausted'
        && entry.resume_state?.workflowResolution?.control?.status !== 'stopped'
    );

    return (
        <div style={{ border: '1px solid var(--theia-panel-border)', borderRadius: 6, padding: '10px 12px', background: index === 0 ? 'var(--theia-list-activeSelectionBackground)' : 'var(--theia-input-background)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}>
                <div style={{ fontWeight: 600 }}>
                    {WORKFLOW_KIND_LABELS[entry.workflow_kind || ''] || entry.workflow_kind || 'Workflow inconnu'}
                    {index === 0 ? ' - courant' : ''}
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    <div style={{ fontSize: 11, opacity: 0.72 }}>{formatArchiveDate(entry.recorded_at)}</div>
                    <button
                        className='theia-button secondary'
                        disabled={!entry.resume_state || isRestoring}
                        onClick={() => onRestoreHistoryEntry(entry, index)}
                        style={{ fontSize: 11, padding: '3px 8px' }}
                        title={entry.resume_state ? 'Ouvrir cette tentative dans le Plugin Executor' : 'Aucun resume_state disponible pour cette tentative'}
                    >
                        {isRestoring ? 'Restauration...' : 'Restaurer'}
                    </button>
                    <select
                        value={selectedReplayStepId}
                        disabled={replayableSteps.length === 0 || isReplaying}
                        onChange={event => onReplayStepSelectionChange(historyEntryKey, event.target.value)}
                        style={{ ...inputStyle, padding: '3px 6px', fontSize: 11, maxWidth: 220 }}
                        title='Etape backend a rejouer'
                    >
                        {replayableSteps.length === 0 ? <option value=''>Aucune etape</option> : replayableSteps.map(step => (
                            <option key={step.id} value={step.id}>
                                {`${step.title || step.id}${step.status ? ` [${step.status}]` : ''}`}
                            </option>
                        ))}
                    </select>
                    <button
                        className='theia-button secondary'
                        disabled={!canReplay || isReplaying}
                        onClick={() => onReplayHistoryEntry(entry, index, selectedReplayStepId || undefined)}
                        style={{ fontSize: 11, padding: '3px 8px' }}
                        title={canReplay
                            ? `Rejouer l'etape: ${replayableStep?.title || replayableStep?.id || 'workflow'}`
                            : (entry.resume_state?.workflowResolution?.control?.summary || 'Aucune etape backend rejouable')}
                    >
                        {isReplaying ? 'Rejeu...' : 'Rejouer'}
                    </button>
                </div>
            </div>
            <div style={{ marginTop: 4, fontSize: 11, opacity: 0.76 }}>
                {entry.control_status ? `${CONTROL_STATUS_LABELS[entry.control_status] || entry.control_status} | ` : ''}
                {typeof entry.final_confidence === 'number' ? `confiance finale ${(entry.final_confidence * 100).toFixed(0)}%` : ''}
                {typeof entry.workflow_confidence === 'number' ? ` | workflow ${(entry.workflow_confidence * 100).toFixed(0)}%` : ''}
            </div>
            {replayableStep ? <div style={{ marginTop: 6, fontSize: 11, opacity: 0.72 }}>Etape backend selectionnee : {replayableStep.title || replayableStep.id}</div> : undefined}
            {entry.latest_event?.message ? <div style={{ marginTop: 6, fontSize: 12 }}><strong>{entry.latest_event.message}</strong>{entry.latest_event.detail ? ` | ${truncateArchiveText(entry.latest_event.detail, 120)}` : ''}</div> : undefined}
            {entry.current_text ? <div style={{ marginTop: 6, fontSize: 12, opacity: 0.84 }}>{truncateArchiveText(entry.current_text, 220)}</div> : undefined}
            {entry.recommendation_source_text ? <div style={{ marginTop: 6, fontSize: 11, opacity: 0.72 }}>Source recommandation : {truncateArchiveText(entry.recommendation_source_text, 140)}</div> : undefined}
        </div>
    );
};

const ArchiveListPane: React.FC<ArchiveBrowserSectionProps> = props => (
    <div style={{ border: '1px solid var(--theia-panel-border)', borderRadius: 6, overflow: 'hidden', minHeight: 280 }}>
        <div style={{ display: 'grid', gap: 1, background: 'var(--theia-panel-border)' }}>
            {props.archives.length === 0 ? <div style={{ background: 'var(--theia-editor-background)', padding: 12, fontSize: 12, opacity: 0.7 }}>{props.isLoadingArchives ? 'Chargement des archives...' : 'Aucune archive trouvee pour ce filtre.'}</div> : props.archives.map(entry => {
                const isSelected = entry.gc_code === props.selectedArchiveGcCode;
                const historyCount = entry.resolution_diagnostics?.history_state?.length || (entry.resolution_diagnostics?.resume_state ? 1 : 0);
                const archiveSummary = props.getArchiveListSummary(entry);
                return (
                    <button
                        key={entry.gc_code}
                        type='button'
                        onClick={() => props.onSelectArchive(entry.gc_code)}
                        style={{ textAlign: 'left', background: isSelected ? 'var(--theia-list-activeSelectionBackground)' : 'var(--theia-editor-background)', color: 'inherit', border: 'none', padding: '10px 12px', cursor: 'pointer', display: 'grid', gap: 4 }}
                    >
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                            <strong>{entry.gc_code}</strong>
                            <span style={{ fontSize: 10, opacity: 0.7 }}>{entry.solved_status || 'unknown'}</span>
                        </div>
                        <div style={{ fontSize: 12 }}>{truncateArchiveText(entry.name || 'Sans nom', 56)}</div>
                        <div style={{ fontSize: 11, opacity: 0.72 }}>{historyCount} tentative(s) - {formatArchiveDate(entry.updated_at)}</div>
                        {archiveSummary?.meta ? <div style={{ fontSize: 10, opacity: 0.76 }}>{archiveSummary.meta}</div> : undefined}
                        {archiveSummary?.eventText ? <div style={{ fontSize: 11, opacity: 0.82 }}><strong>{archiveSummary.eventLabel}:</strong> {archiveSummary.eventText}</div> : undefined}
                    </button>
                );
            })}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 10px', borderTop: '1px solid var(--theia-panel-border)', fontSize: 11 }}>
            <button className='theia-button secondary' disabled={props.archivesPage <= 1 || props.isLoadingArchives} onClick={props.onPreviousArchivesPage}>Precedent</button>
            <span>Page {props.archivesPage}/{props.archivePages}</span>
            <button className='theia-button secondary' disabled={props.archivesPage >= props.archivePages || props.isLoadingArchives} onClick={props.onNextArchivesPage}>Suivant</button>
        </div>
    </div>
);

const ArchiveDetailsPane: React.FC<ArchiveBrowserSectionProps> = props => {
    if (!props.selectedArchive) {
        return (
            <div style={{ border: '1px solid var(--theia-panel-border)', borderRadius: 6, padding: 14, minHeight: 280, background: 'var(--theia-editor-background)' }}>
                <div style={{ opacity: 0.7, fontSize: 12 }}>
                    Selectionnez une archive pour afficher son diagnostic et son historique.
                </div>
            </div>
        );
    }

    const primaryWorkflow = props.selectedArchive.resolution_diagnostics?.workflow_resolution?.primary;

    return (
        <div style={{ border: '1px solid var(--theia-panel-border)', borderRadius: 6, padding: 14, minHeight: 280, background: 'var(--theia-editor-background)' }}>
            <div style={{ display: 'grid', gap: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
                    <div>
                        <div style={{ fontSize: 18, fontWeight: 700 }}>{props.selectedArchive.gc_code}</div>
                        <div style={{ fontSize: 13, marginTop: 4 }}>{props.selectedArchive.name || 'Sans nom'}</div>
                        <div style={{ fontSize: 11, opacity: 0.72, marginTop: 4 }}>
                            Mis a jour le {formatArchiveDate(props.selectedArchive.updated_at)}
                            {props.selectedArchive.cache_type ? ` - ${props.selectedArchive.cache_type}` : ''}
                            {props.selectedArchive.resolution_method ? ` - methode ${props.selectedArchive.resolution_method}` : ''}
                        </div>
                    </div>
                    <button
                        className='theia-button secondary'
                        onClick={() => props.onReloadSelectedArchive(props.selectedArchive!.gc_code)}
                        disabled={props.isLoadingArchiveDetails}
                    >
                        {props.isLoadingArchiveDetails ? 'Chargement...' : 'Recharger le detail'}
                    </button>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10 }}>
                    <div style={{ padding: '8px 10px', borderRadius: 4, background: 'var(--theia-sideBar-background)' }}>
                        <div style={{ fontSize: 10, opacity: 0.7 }}>Workflow courant</div>
                        <div style={{ marginTop: 3, fontWeight: 600 }}>{WORKFLOW_KIND_LABELS[primaryWorkflow?.kind || ''] || primaryWorkflow?.kind || 'Inconnu'}</div>
                    </div>
                    <div style={{ padding: '8px 10px', borderRadius: 4, background: 'var(--theia-sideBar-background)' }}>
                        <div style={{ fontSize: 10, opacity: 0.7 }}>Confiance workflow</div>
                        <div style={{ marginTop: 3, fontWeight: 600 }}>{typeof primaryWorkflow?.confidence === 'number' ? `${(primaryWorkflow.confidence * 100).toFixed(0)}%` : 'n/a'}</div>
                    </div>
                    <div style={{ padding: '8px 10px', borderRadius: 4, background: 'var(--theia-sideBar-background)' }}>
                        <div style={{ fontSize: 10, opacity: 0.7 }}>Tentatives archivees</div>
                        <div style={{ marginTop: 3, fontWeight: 600 }}>{props.historyEntries.length}</div>
                    </div>
                </div>
                {props.selectedArchive.resolution_diagnostics?.current_text ? (
                    <div style={{ padding: '10px 12px', border: '1px solid var(--theia-panel-border)', borderRadius: 4, background: 'var(--theia-input-background)' }}>
                        <div style={{ fontSize: 11, opacity: 0.7, marginBottom: 4 }}>Snapshot courant</div>
                        <div style={{ fontSize: 12 }}>{truncateArchiveText(props.selectedArchive.resolution_diagnostics.current_text, 260)}</div>
                    </div>
                ) : undefined}
                <div>
                    <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Historique des tentatives</div>
                    {props.historyEntries.length === 0 ? <div style={{ fontSize: 12, opacity: 0.7 }}>Aucun historique de tentative disponible pour cette archive.</div> : (
                        <div style={{ display: 'grid', gap: 10 }}>
                            {props.historyEntries.map((entry, index) => (
                                <ArchiveHistoryCard
                                    key={props.getHistoryEntryKey(entry, index)}
                                    entry={entry}
                                    index={index}
                                    restoringHistoryEntryKey={props.restoringHistoryEntryKey}
                                    replayingHistoryEntryKey={props.replayingHistoryEntryKey}
                                    replayStepSelections={props.replayStepSelections}
                                    onRestoreHistoryEntry={props.onRestoreHistoryEntry}
                                    onReplayHistoryEntry={props.onReplayHistoryEntry}
                                    onReplayStepSelectionChange={props.onReplayStepSelectionChange}
                                    getHistoryEntryKey={props.getHistoryEntryKey}
                                    getReplayableSteps={props.getReplayableSteps}
                                    getNextReplayableStep={props.getNextReplayableStep}
                                />
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export const ArchiveBrowserSection: React.FC<ArchiveBrowserSectionProps> = props => (
    <div style={sectionStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 12 }}>
            <div>
                <h4 style={{ margin: 0 }}>Tentatives archivees</h4>
                <div style={{ fontSize: 11, opacity: 0.7, marginTop: 4 }}>
                    Visualise les snapshots de diagnostic et l'historique multi-tentatives.
                </div>
            </div>
            <div style={{ fontSize: 11, opacity: 0.7 }}>{props.archiveTotal} archive(s)</div>
        </div>
        <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
            <input
                type='text'
                value={props.archiveSearch}
                onChange={event => props.onArchiveSearchChange(event.target.value)}
                placeholder='Filtrer par GC code'
                style={{ ...inputStyle, padding: '6px 8px', fontSize: 12, minWidth: 180 }}
            />
            <select
                value={props.archiveStatusFilter}
                onChange={event => props.onArchiveStatusFilterChange(event.target.value)}
                style={{ ...inputStyle, padding: '6px 8px', fontSize: 12, minWidth: 180 }}
            >
                {ARCHIVE_STATUS_FILTER_OPTIONS.map(option => (
                    <option key={option.value || 'all'} value={option.value}>{option.label}</option>
                ))}
            </select>
            <button className='theia-button secondary' onClick={props.onLoadArchives} disabled={props.isLoadingArchives}>
                {props.isLoadingArchives ? 'Chargement...' : 'Charger'}
            </button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '340px minmax(0, 1fr)', gap: 16 }}>
            <ArchiveListPane {...props} />
            <ArchiveDetailsPane {...props} />
        </div>
    </div>
);

export const ArchiveBulkDeleteSection: React.FC<ArchiveBulkDeleteSectionProps> = props => (
    <div style={{ ...sectionStyle, border: '1px solid #ef444466' }}>
        <h4 style={{ margin: '0 0 4px 0', color: '#f87171' }}>Suppression en masse</h4>
        <p style={{ fontSize: 11, opacity: 0.7, margin: '0 0 14px 0' }}>
            Operation irreversible. Une double confirmation sera demandee.
            Les donnees supprimees ne pourront pas etre recuperees.
        </p>
        <div style={{ display: 'grid', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <label style={{ fontSize: 12, minWidth: 80 }}>Cible :</label>
                <select
                    value={props.bulkFilter}
                    onChange={event => props.onBulkFilterChange(event.target.value as BulkFilter)}
                    style={{ ...inputStyle, padding: '4px 8px', fontSize: 12, flex: 1 }}
                >
                    {(Object.entries(BULK_FILTER_LABELS) as [BulkFilter, string][]).map(([key, label]) => (
                        <option key={key} value={key}>{label}</option>
                    ))}
                </select>
            </div>
            {props.bulkFilter === 'by_status' ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <label style={{ fontSize: 12, minWidth: 80 }}>Statut :</label>
                    <select
                        value={props.bulkStatus}
                        onChange={event => props.onBulkStatusChange(event.target.value)}
                        style={{ ...inputStyle, padding: '4px 8px', fontSize: 12, flex: 1 }}
                    >
                        {STATUS_OPTIONS.map(option => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                    </select>
                </div>
            ) : undefined}
            {props.bulkFilter === 'before_date' ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <label style={{ fontSize: 12, minWidth: 80 }}>Avant le :</label>
                    <input
                        type='date'
                        value={props.bulkBeforeDate}
                        onChange={event => props.onBulkBeforeDateChange(event.target.value)}
                        style={{ ...inputStyle, padding: '4px 8px', fontSize: 12, flex: 1 }}
                    />
                </div>
            ) : undefined}
            <div style={{ background: '#ef444411', border: '1px solid #ef444444', borderRadius: 4, padding: '6px 10px', fontSize: 11, color: '#fca5a5' }}>
                Cible selectionnee : <strong>{props.bulkPreviewLabel}</strong>
            </div>
            {props.lastActionResult ? <div style={{ fontSize: 12, color: '#10b981', padding: '4px 0' }}>{props.lastActionResult}</div> : undefined}
            {props.lastActionError ? <div style={{ fontSize: 12, color: '#f87171', padding: '4px 0' }}>{props.lastActionError}</div> : undefined}
            <div>
                <button
                    onClick={props.onExecuteBulkDelete}
                    disabled={props.isDeleting || (props.bulkFilter === 'before_date' && !props.bulkBeforeDate)}
                    style={{ background: '#ef4444', color: 'white', border: 'none', borderRadius: 4, padding: '7px 18px', fontSize: 12, cursor: props.isDeleting ? 'wait' : 'pointer', opacity: props.isDeleting ? 0.6 : 1 }}
                >
                    {props.isDeleting ? 'Suppression...' : 'Supprimer (double confirmation)'}
                </button>
            </div>
        </div>
    </div>
);
