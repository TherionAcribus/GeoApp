import { ArchiveWorkflowLogEntry } from './archive-manager-types';

export const truncateArchiveText = (value: string | undefined | null, maxLength: number = 180): string => {
    const normalized = String(value || '').replace(/\s+/g, ' ').trim();
    if (!normalized) {
        return '';
    }
    if (normalized.length <= maxLength) {
        return normalized;
    }
    return `${normalized.slice(0, Math.max(0, maxLength - 3))}...`;
};

export const formatArchiveDate = (value?: string | null): string => {
    if (!value) {
        return '';
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return value;
    }
    return date.toLocaleString('fr-FR');
};

export const formatCheckerCandidateFromCoordinates = (coordinates: unknown): string => {
    if (!coordinates || typeof coordinates !== 'object') {
        return '';
    }

    const coordinateRecord = coordinates as Record<string, unknown>;
    if (typeof coordinateRecord.ddm === 'string' && coordinateRecord.ddm.trim()) {
        return coordinateRecord.ddm.trim();
    }
    if (typeof coordinateRecord.formatted === 'string' && coordinateRecord.formatted.trim()) {
        return coordinateRecord.formatted.trim();
    }
    if (typeof coordinateRecord.decimal === 'string' && coordinateRecord.decimal.trim()) {
        return coordinateRecord.decimal.trim();
    }
    if (coordinateRecord.latitude !== undefined && coordinateRecord.longitude !== undefined) {
        return `${coordinateRecord.latitude}, ${coordinateRecord.longitude}`;
    }
    return '';
};

export const prependArchiveWorkflowEntry = (
    entries: ArchiveWorkflowLogEntry[] | undefined,
    category: ArchiveWorkflowLogEntry['category'],
    message: string,
    detail?: string,
): ArchiveWorkflowLogEntry[] => [
    {
        id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
        category,
        message,
        detail,
        timestamp: new Date().toLocaleTimeString('fr-FR', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
        }),
    },
    ...(entries || []),
].slice(0, 12);
