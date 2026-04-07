import * as React from 'react';
import {
    ArchiveAutoSyncSection,
    ArchiveAutoSyncSectionProps,
    ArchiveBrowserSection,
    ArchiveBrowserSectionProps,
    ArchiveBulkDeleteSection,
    ArchiveBulkDeleteSectionProps,
    ArchiveManagerHeaderSection,
    ArchiveManagerHeaderSectionProps,
    ArchiveStatsSection,
    ArchiveStatsSectionProps,
} from './archive-manager-sections';

export interface ArchiveManagerViewProps extends
    ArchiveManagerHeaderSectionProps,
    ArchiveStatsSectionProps,
    ArchiveAutoSyncSectionProps,
    ArchiveBrowserSectionProps,
    ArchiveBulkDeleteSectionProps {}

export const ArchiveManagerView: React.FC<ArchiveManagerViewProps> = props => (
    <div style={{ padding: 16, display: 'grid', gap: 16, maxWidth: 1180 }}>
        <ArchiveManagerHeaderSection isLoading={props.isLoading} onReload={props.onReload} />
        <ArchiveStatsSection isLoading={props.isLoading} stats={props.stats} />
        <ArchiveAutoSyncSection autoSync={props.autoSync} isSaving={props.isSaving} onToggleAutoSync={props.onToggleAutoSync} />
        <ArchiveBrowserSection {...props} />
        <ArchiveBulkDeleteSection
            isDeleting={props.isDeleting}
            bulkFilter={props.bulkFilter}
            bulkStatus={props.bulkStatus}
            bulkBeforeDate={props.bulkBeforeDate}
            bulkPreviewLabel={props.bulkPreviewLabel}
            lastActionResult={props.lastActionResult}
            lastActionError={props.lastActionError}
            onBulkFilterChange={props.onBulkFilterChange}
            onBulkStatusChange={props.onBulkStatusChange}
            onBulkBeforeDateChange={props.onBulkBeforeDateChange}
            onExecuteBulkDelete={props.onExecuteBulkDelete}
        />
    </div>
);
