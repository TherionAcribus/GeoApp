import * as React from 'react';
import { getAttributeIconUrl } from './geocache-attributes-icons-data';
import {
    GeocacheAttribute,
    GeocacheChecker,
    GeocacheDto
} from './geocache-details-types';
import {
    GeoAppChatProfile,
    GeoAppChatWorkflowKind,
    GeoAppChatWorkflowProfile
} from './geoapp-chat-agent';

type ArchiveStatus = 'synced' | 'needs_sync' | 'none' | 'loading';

type ChatProfileOption = {
    value: GeoAppChatWorkflowProfile;
    label: string;
};

const cardStyle: React.CSSProperties = {
    background: 'var(--theia-editor-background)',
    border: '1px solid var(--theia-panel-border)',
    borderRadius: 6,
    padding: 16
};

interface GeocacheDetailsHeaderProps {
    geocacheData: GeocacheDto;
    notesCount?: number;
    chatWorkflowPreview: GeoAppChatWorkflowKind;
    chatProfilePreview: GeoAppChatProfile;
    chatProfileOverride: GeoAppChatWorkflowProfile;
    effectiveChatProfile: GeoAppChatProfile;
    chatProfileOverrideLabel: string;
    isChatRoutingPreviewLoading: boolean;
    isChatProfileMenuOpen: boolean;
    chatProfileOptions: ChatProfileOption[];
    archiveStatus: ArchiveStatus;
    archiveUpdatedAt?: string;
    isSyncingArchive: boolean;
    onSolveFormula: () => void | Promise<void>;
    onAnalyzePage: () => void | Promise<void>;
    onAnalyzeCode: () => void | Promise<void>;
    onAnalyzeWithPlugins: () => void | Promise<void>;
    onOpenAiChat: () => void | Promise<void>;
    onToggleChatProfileMenu: (event: React.MouseEvent<HTMLButtonElement>) => void;
    onSelectChatProfileOverride: (profile: GeoAppChatWorkflowProfile) => void;
    onOpenLogs: () => void;
    onOpenLogEditor: () => void;
    onOpenNotes: () => void;
    onForceSyncArchive: () => void | Promise<void>;
}

export const GeocacheDetailsHeader: React.FC<GeocacheDetailsHeaderProps> = ({
    geocacheData,
    notesCount,
    chatWorkflowPreview,
    chatProfilePreview,
    chatProfileOverride,
    effectiveChatProfile,
    chatProfileOverrideLabel,
    isChatRoutingPreviewLoading,
    isChatProfileMenuOpen,
    chatProfileOptions,
    archiveStatus,
    archiveUpdatedAt,
    isSyncingArchive,
    onSolveFormula,
    onAnalyzePage,
    onAnalyzeCode,
    onAnalyzeWithPlugins,
    onOpenAiChat,
    onToggleChatProfileMenu,
    onSelectChatProfileOverride,
    onOpenLogs,
    onOpenLogEditor,
    onOpenNotes,
    onForceSyncArchive
}) => {
    const archiveTooltip = getArchiveTooltip(archiveStatus, archiveUpdatedAt);
    const archiveColor = getArchiveColor(archiveStatus);
    const archiveLabel = getArchiveLabel(archiveStatus);
    const archiveIcon = getArchiveIcon(archiveStatus);

    return (
        <div style={{ marginBottom: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                <h3 style={{ margin: 0 }}>{geocacheData.name}</h3>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    <button
                        className='theia-button secondary'
                        onClick={() => { void onSolveFormula(); }}
                        style={{ fontSize: 12, padding: '4px 12px' }}
                        title='Ouvrir le Formula Solver'
                    >
                        Resoudre formule
                    </button>
                    <button
                        className='theia-button secondary'
                        onClick={() => { void onAnalyzePage(); }}
                        style={{ fontSize: 12, padding: '4px 12px' }}
                        title='Lancer l analyse complete de la page'
                    >
                        Analyse page
                    </button>
                    <button
                        className='theia-button secondary'
                        onClick={() => { void onAnalyzeCode(); }}
                        style={{ fontSize: 12, padding: '4px 12px' }}
                        title='Analyser le texte avec Metasolver'
                    >
                        Analyse code
                    </button>
                    <button
                        className='theia-button secondary'
                        onClick={() => { void onAnalyzeWithPlugins(); }}
                        style={{ fontSize: 12, padding: '4px 12px' }}
                        title='Analyser cette geocache avec les plugins'
                    >
                        Analyse plugins
                    </button>
                    <div style={{ position: 'relative', display: 'flex', alignItems: 'stretch' }}>
                        <button
                            className='theia-button'
                            onClick={() => { void onOpenAiChat(); }}
                            style={{ fontSize: 12, padding: '4px 12px', borderTopRightRadius: 0, borderBottomRightRadius: 0 }}
                            title={`Ouvrir un chat IA dedie a cette geocache${isChatRoutingPreviewLoading ? ' (analyse du profil en cours)' : ` - profil effectif ${effectiveChatProfile}, workflow ${chatWorkflowPreview}, selection ${chatProfileOverrideLabel}`}`}
                        >
                            {`Chat IA [${isChatRoutingPreviewLoading ? '...' : effectiveChatProfile}]`}
                        </button>
                        <button
                            className='theia-button secondary'
                            onClick={onToggleChatProfileMenu}
                            style={{ fontSize: 12, padding: '4px 8px', borderTopLeftRadius: 0, borderBottomLeftRadius: 0 }}
                            title={`Choisir le profil de chat IA (actuel: ${chatProfileOverrideLabel})`}
                        >
                            v
                        </button>
                        {isChatProfileMenuOpen ? (
                            <div
                                style={{
                                    position: 'absolute',
                                    top: '100%',
                                    right: 0,
                                    marginTop: 4,
                                    minWidth: 150,
                                    display: 'flex',
                                    flexDirection: 'column',
                                    background: 'var(--theia-editorWidget-background)',
                                    border: '1px solid var(--theia-panel-border)',
                                    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.25)',
                                    zIndex: 20,
                                }}
                            >
                                {chatProfileOptions.map(option => {
                                    const isSelected = chatProfileOverride === option.value;
                                    const autoSuffix = option.value === 'default' ? ` -> ${chatProfilePreview}` : '';
                                    return (
                                        <button
                                            key={option.value}
                                            className='theia-button secondary'
                                            onClick={() => onSelectChatProfileOverride(option.value)}
                                            style={{
                                                fontSize: 12,
                                                padding: '6px 10px',
                                                textAlign: 'left',
                                                border: 0,
                                                borderRadius: 0,
                                                background: isSelected ? 'var(--theia-list-activeSelectionBackground)' : 'transparent',
                                                color: isSelected ? 'var(--theia-list-activeSelectionForeground)' : 'inherit',
                                            }}
                                            title={option.value === 'default'
                                                ? `Utiliser le profil determine automatiquement par le workflow (${chatProfilePreview})`
                                                : `Forcer le profil ${option.label}`}
                                        >
                                            {`${isSelected ? '* ' : ''}${option.label}${autoSuffix}`}
                                        </button>
                                    );
                                })}
                            </div>
                        ) : undefined}
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <button
                            className='theia-button secondary'
                            onClick={onOpenLogs}
                            style={{ fontSize: 12, padding: '4px 12px' }}
                            title='Voir les logs de cette geocache'
                        >
                            Logs
                        </button>
                        <button
                            className='theia-button secondary'
                            onClick={onOpenLogEditor}
                            style={{ fontSize: 12, padding: '4px 12px' }}
                            title='Loguer cette geocache'
                        >
                            Loguer
                        </button>
                        <button
                            className='theia-button secondary'
                            onClick={onOpenNotes}
                            style={{ fontSize: 12, padding: '4px 12px' }}
                            title='Voir les notes de cette geocache'
                        >
                            {`Notes${typeof notesCount === 'number' && notesCount > 0 ? ` (${notesCount})` : ''}`}
                        </button>
                    </div>
                </div>
            </div>

            <div style={{ display: 'flex', gap: 16, alignItems: 'center', fontSize: 14, flexWrap: 'wrap' }}>
                <span style={{ opacity: 0.7 }}>{geocacheData.gc_code}</span>
                <span style={{ opacity: 0.7 }}>|</span>
                <span style={{ opacity: 0.7 }}>{geocacheData.type}</span>
                <span style={{ opacity: 0.7 }}>|</span>
                <span style={{ opacity: 0.7 }}>{`Par ${geocacheData.owner || 'Inconnu'}`}</span>
                {archiveStatus !== 'none' ? (
                    <button
                        onClick={() => { void onForceSyncArchive(); }}
                        disabled={archiveStatus === 'loading' || isSyncingArchive}
                        title={archiveTooltip}
                        style={{
                            background: 'none',
                            border: '1px solid',
                            borderRadius: 12,
                            cursor: archiveStatus === 'loading' ? 'wait' : 'pointer',
                            padding: '2px 8px',
                            fontSize: 11,
                            display: 'flex',
                            alignItems: 'center',
                            gap: 4,
                            borderColor: archiveColor,
                            color: archiveColor,
                            opacity: isSyncingArchive ? 0.6 : 1,
                        }}
                    >
                        <span>{archiveIcon}</span>
                        <span>{archiveLabel}</span>
                    </button>
                ) : undefined}
            </div>
        </div>
    );
};

interface GeocacheOverviewSectionProps {
    geocacheData: GeocacheDto;
    coordinatesEditor: React.ReactNode;
}

export const GeocacheOverviewSection: React.FC<GeocacheOverviewSectionProps> = ({
    geocacheData,
    coordinatesEditor
}) => (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div style={cardStyle}>
            <h4 style={{ margin: '0 0 16px 0', fontSize: 16 }}>Statistiques</h4>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div>
                    <div style={{ opacity: 0.7, fontSize: 12, marginBottom: 4 }}>Difficulte</div>
                    <div>{renderStars(geocacheData.difficulty, '#fbbf24')}</div>
                </div>
                <div>
                    <div style={{ opacity: 0.7, fontSize: 12, marginBottom: 4 }}>Terrain</div>
                    <div>{renderStars(geocacheData.terrain, '#10b981')}</div>
                </div>
                <div>
                    <div style={{ opacity: 0.7, fontSize: 12, marginBottom: 4 }}>Taille</div>
                    <div style={{ color: '#60a5fa' }}>{geocacheData.size || 'N/A'}</div>
                </div>
                <div>
                    <div style={{ opacity: 0.7, fontSize: 12, marginBottom: 4 }}>Favoris</div>
                    <div style={{ color: '#a78bfa' }}>{geocacheData.favorites_count || 0}</div>
                </div>
            </div>

            {geocacheData.attributes && geocacheData.attributes.length > 0 ? (
                <div style={{ marginTop: 16 }}>
                    <div style={{ opacity: 0.7, fontSize: 12, marginBottom: 8 }}>Attributs</div>
                    {renderAttributes(geocacheData.attributes)}
                </div>
            ) : undefined}
        </div>

        <div style={cardStyle}>
            <h4 style={{ margin: '0 0 16px 0', fontSize: 16 }}>Coordonnees</h4>
            {coordinatesEditor}
        </div>
    </div>
);

interface GeocacheDetailedInfoSectionProps {
    geocacheData: GeocacheDto;
}

export const GeocacheDetailedInfoSection: React.FC<GeocacheDetailedInfoSectionProps> = ({ geocacheData }) => (
    <details style={cardStyle}>
        <summary style={{ cursor: 'pointer', fontWeight: 'bold', marginBottom: 8 }}>Informations detaillees</summary>
        <table className='theia-table' style={{ width: '100%', marginTop: 8 }}>
            <tbody>
                {renderRow('Code', geocacheData.gc_code)}
                {renderRow('Proprietaire', geocacheData.owner)}
                {renderRow('Type', geocacheData.type)}
                {renderRow('Taille', geocacheData.size)}
                {renderRow('Difficulte', geocacheData.difficulty?.toString())}
                {renderRow('Terrain', geocacheData.terrain?.toString())}
                {renderRow('Favoris', geocacheData.favorites_count?.toString())}
                {renderRow('Logs', geocacheData.logs_count?.toString())}
                {renderRow('Placee le', geocacheData.placed_at)}
                {renderRow('Statut', geocacheData.status)}
                {renderRow('Lien', geocacheData.url ? <a href={geocacheData.url} target='_blank' rel='noreferrer'>{geocacheData.url}</a> : undefined)}
            </tbody>
        </table>
    </details>
);

interface GeocacheHintsSectionProps {
    displayedHints?: string;
    displayDecodedHints: boolean;
    onToggleDisplayMode: () => void | Promise<void>;
}

export const GeocacheHintsSection: React.FC<GeocacheHintsSectionProps> = ({
    displayedHints,
    displayDecodedHints,
    onToggleDisplayMode
}) => {
    if (!displayedHints) {
        return undefined;
    }

    return (
        <div>
            <div style={{ display: 'flex', justifyContent: 'flex-start', alignItems: 'center', gap: 12 }}>
                <h4 style={{ margin: '8px 0' }}>Indices</h4>
                <button
                    className='theia-button'
                    onClick={() => { void onToggleDisplayMode(); }}
                    title={displayDecodedHints ? 'Coder (ROT13)' : 'Decoder (ROT13)'}
                >
                    {displayDecodedHints ? 'Coder' : 'Decoder'}
                </button>
            </div>
            <div style={{ whiteSpace: 'pre-wrap', opacity: 0.9 }}>{displayedHints}</div>
        </div>
    );
};

interface GeocacheCheckersSectionProps {
    checkers?: GeocacheChecker[];
}

export const GeocacheCheckersSection: React.FC<GeocacheCheckersSectionProps> = ({ checkers }) => {
    if (!checkers || checkers.length === 0) {
        return undefined;
    }

    return (
        <div>
            <h4 style={{ margin: '8px 0' }}>Checkers</h4>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
                {checkers.map((checker, index) => (
                    <li key={checker.id ?? index}>
                        {checker.url ? <a href={checker.url} target='_blank' rel='noreferrer'>{checker.name || checker.url}</a> : (checker.name || '')}
                    </li>
                ))}
            </ul>
        </div>
    );
};

function renderRow(label: string, value?: React.ReactNode): React.ReactNode {
    if (value === undefined || value === null || value === '') {
        return undefined;
    }

    return (
        <tr>
            <td style={{ opacity: 0.7, paddingRight: 8 }}>{label}</td>
            <td>{value}</td>
        </tr>
    );
}

function renderStars(rating?: number, color: string = 'gold'): React.ReactNode {
    if (!rating) {
        return undefined;
    }

    const fullStars = Math.floor(rating);
    const hasHalfStar = rating % 1 >= 0.5;
    const emptyStars = 5 - fullStars - (hasHalfStar ? 1 : 0);

    return (
        <span style={{ color, fontSize: 16 }}>
            {'★'.repeat(fullStars)}
            {hasHalfStar ? '◐' : ''}
            {emptyStars > 0 ? <span style={{ opacity: 0.3 }}>{'☆'.repeat(emptyStars)}</span> : undefined}
        </span>
    );
}

function renderAttributes(attributes?: GeocacheAttribute[]): React.ReactNode {
    if (!attributes || attributes.length === 0) {
        return undefined;
    }

    return (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {attributes.map((attribute, index) => {
                const iconUrl = getAttributeIconUrlFromAttribute(attribute);
                const tooltipText = `${attribute.is_negative ? 'No ' : ''}${attribute.name}`;

                if (!iconUrl) {
                    return (
                        <span
                            key={index}
                            style={{
                                border: '1px solid var(--theia-foreground)',
                                borderRadius: 4,
                                padding: '2px 6px',
                                fontSize: 12,
                                opacity: attribute.is_negative ? 0.7 : 1
                            }}
                            title={tooltipText}
                        >
                            {attribute.is_negative ? 'No ' : ''}{attribute.name}
                        </span>
                    );
                }

                return (
                    <img
                        key={index}
                        src={iconUrl}
                        alt={tooltipText}
                        title={tooltipText}
                        style={{
                            width: 24,
                            height: 24,
                            opacity: attribute.is_negative ? 0.7 : 1,
                            cursor: 'help'
                        }}
                    />
                );
            })}
        </div>
    );
}

function getAttributeIconUrlFromAttribute(attribute: GeocacheAttribute): string | undefined {
    const iconFilename = attribute.base_filename || `${attribute.name.toLowerCase().replace(/\s+/g, '')}-${attribute.is_negative ? 'no' : 'yes'}`;
    return getAttributeIconUrl(iconFilename);
}

function getArchiveTooltip(status: ArchiveStatus, updatedAt?: string): string {
    if (status === 'synced') {
        return `Archive a jour${updatedAt ? ` (${new Date(updatedAt).toLocaleString()})` : ''} - Cliquer pour re-synchroniser`;
    }
    if (status === 'loading') {
        return 'Synchronisation en cours...';
    }
    return 'Archive non synchronisee - Cliquer pour synchroniser';
}

function getArchiveColor(status: ArchiveStatus): string {
    if (status === 'synced') {
        return '#10b981';
    }
    if (status === 'loading') {
        return '#60a5fa';
    }
    return '#f59e0b';
}

function getArchiveLabel(status: ArchiveStatus): string {
    if (status === 'synced') {
        return 'Archive';
    }
    if (status === 'loading') {
        return 'Sync...';
    }
    return 'Non archivee';
}

function getArchiveIcon(status: ArchiveStatus): string {
    if (status === 'synced') {
        return '💾';
    }
    if (status === 'loading') {
        return '⏳';
    }
    return '⚠️';
}
