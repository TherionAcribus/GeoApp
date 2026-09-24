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
import { ContextMenu, ContextMenuItem } from './context-menu';
import { buildOwnerMessageUrl, buildOwnerProfileUrl, openExternalUrl } from './geocaching-owner-links';
import { GeocacheDetailsHeaderAction } from './geocache-details-header-actions';
import { LogsRecentSummary, LogSummaryEntry } from './geocache-logs-summary';
import '../../src/browser/style/geocache-details-header.css';

type ArchiveStatus = 'synced' | 'needs_sync' | 'none' | 'loading';

type ChatProfileOption = {
    value: GeoAppChatWorkflowProfile;
    label: string;
    description?: string;
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
    onOpenGridPuzzle: () => void | Promise<void>;
    onOpenAiChat: () => void | Promise<void>;
    onOpenFreeChat: () => void | Promise<void>;
    onToggleChatProfileMenu: (event: React.MouseEvent<HTMLButtonElement>) => void;
    onSelectChatProfileOverride: (profile: GeoAppChatWorkflowProfile) => void;
    onCloseChatProfileMenu: () => void;
    onOpenLogs: () => void;
    onOpenLogEditor: () => void;
    onOpenNotes: () => void;
    onForceSyncArchive: () => void | Promise<void>;
    /**
     * Va chercher le GUID du proprietaire quand il manque en base (geocaches
     * importees avant son introduction). Appele a l'ouverture du menu, pas au
     * clic : ouvrir une fenetre apres un `await` serait bloque par le navigateur.
     */
    onResolveOwnerGuid?: () => Promise<string | undefined>;
    /** Ouverture des liens Geocaching du proprietaire ; par defaut, un onglet externe. */
    onOpenOwnerUrl?: (url: string) => void;
    onRefresh?: () => void | Promise<void>;
    /** Rafraîchissement en cours : le bouton porte l'état (icône animée) au lieu d'une notification. */
    isRefreshing?: boolean;
    extraActions?: GeocacheDetailsHeaderAction[];
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
    onOpenGridPuzzle,
    onOpenAiChat,
    onOpenFreeChat,
    onToggleChatProfileMenu,
    onSelectChatProfileOverride,
    onCloseChatProfileMenu,
    onOpenLogs,
    onOpenLogEditor,
    onOpenNotes,
    onForceSyncArchive,
    onResolveOwnerGuid,
    onOpenOwnerUrl,
    onRefresh,
    isRefreshing = false,
    extraActions = []
}) => {
    const archiveTooltip = getArchiveTooltip(archiveStatus, archiveUpdatedAt);
    const archiveColor = getArchiveColor(archiveStatus);
    const archiveLabel = getArchiveLabel(archiveStatus);
    const archiveIconClass = getArchiveIconClass(archiveStatus);

    const [isAnalyzeMenuOpen, setIsAnalyzeMenuOpen] = React.useState(false);
    const analyzeMenuRef = React.useRef<HTMLDivElement>(null);
    const chatProfileMenuRef = React.useRef<HTMLDivElement>(null);

    // --- Menu du proprietaire (message / fiche sur Geocaching.com) ---
    const ownerName = (geocacheData.owner || '').trim();
    const [ownerMenuPosition, setOwnerMenuPosition] = React.useState<{ x: number; y: number } | null>(null);
    const [resolvedOwnerGuid, setResolvedOwnerGuid] = React.useState<string | undefined>(undefined);
    const [ownerLookup, setOwnerLookup] = React.useState<'idle' | 'resolving' | 'missing'>('idle');

    // Changement de geocache : le GUID rapatrie ne vaut plus rien.
    React.useEffect(() => {
        setOwnerMenuPosition(null);
        setResolvedOwnerGuid(undefined);
        setOwnerLookup('idle');
    }, [geocacheData.gc_code]);

    const ownerGuid = geocacheData.owner_guid || resolvedOwnerGuid;
    const ownerProfileUrl = buildOwnerProfileUrl(ownerName, ownerGuid);
    const ownerMessageUrl = buildOwnerMessageUrl(ownerGuid, geocacheData.gc_code);

    const openOwnerMenu = (event: React.MouseEvent | React.KeyboardEvent, anchor?: HTMLElement | null): void => {
        event.preventDefault();
        event.stopPropagation();
        const mouse = event as React.MouseEvent;
        if (typeof mouse.clientX === 'number' && mouse.clientX > 0) {
            setOwnerMenuPosition({ x: mouse.clientX, y: mouse.clientY });
        } else {
            const rect = anchor?.getBoundingClientRect();
            setOwnerMenuPosition({ x: rect?.left ?? 0, y: (rect?.bottom ?? 0) + 2 });
        }
        // Le GUID est rapatrie des l'ouverture du menu : au moment du clic sur
        // l'item, `window.open` doit rester dans le geste utilisateur, sinon le
        // navigateur bloque l'onglet.
        if (!ownerGuid && ownerLookup === 'idle' && onResolveOwnerGuid) {
            setOwnerLookup('resolving');
            onResolveOwnerGuid().then(
                guid => {
                    setResolvedOwnerGuid(guid);
                    setOwnerLookup(guid ? 'idle' : 'missing');
                },
                () => setOwnerLookup('missing')
            );
        }
    };

    const openOwnerUrl = (url: string): void => {
        if (onOpenOwnerUrl) { onOpenOwnerUrl(url); } else { openExternalUrl(url); }
    };

    const isResolvingOwner = ownerLookup === 'resolving';
    const ownerMenuItems: ContextMenuItem[] = [
        {
            label: isResolvingOwner
                ? 'Recherche du profil...'
                : ownerMessageUrl
                    ? `Envoyer un message a propos de ${geocacheData.gc_code || 'cette cache'}`
                    : 'Message indisponible (profil introuvable)',
            iconClass: 'codicon codicon-mail',
            disabled: !ownerMessageUrl,
            action: () => { if (ownerMessageUrl) { openOwnerUrl(ownerMessageUrl); } }
        },
        {
            label: 'Ouvrir sa fiche',
            iconClass: 'codicon codicon-person',
            disabled: !ownerProfileUrl,
            action: () => { if (ownerProfileUrl) { openOwnerUrl(ownerProfileUrl); } }
        }
    ];

    React.useEffect(() => {
        if (!isAnalyzeMenuOpen) { return; }
        const handleClickOutside = (event: MouseEvent): void => {
            if (analyzeMenuRef.current && !analyzeMenuRef.current.contains(event.target as Node)) {
                setIsAnalyzeMenuOpen(false);
            }
        };
        const handleKeyDown = (event: KeyboardEvent): void => {
            if (event.key === 'Escape') { setIsAnalyzeMenuOpen(false); }
        };
        document.addEventListener('mousedown', handleClickOutside);
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [isAnalyzeMenuOpen]);

    React.useEffect(() => {
        if (!isChatProfileMenuOpen) { return; }
        const handleClickOutside = (event: MouseEvent): void => {
            if (chatProfileMenuRef.current && !chatProfileMenuRef.current.contains(event.target as Node)) {
                onCloseChatProfileMenu();
            }
        };
        const handleKeyDown = (event: KeyboardEvent): void => {
            if (event.key === 'Escape') { onCloseChatProfileMenu(); }
        };
        document.addEventListener('mousedown', handleClickOutside);
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [isChatProfileMenuOpen, onCloseChatProfileMenu]);

    // Active un item de menu au clavier (Enter / Espace), comme un clic.
    const handleMenuItemKeyDown = (event: React.KeyboardEvent, activate: () => void): void => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            activate();
        }
    };

    const analyzeActions: { label: string; iconClass: string; title: string; action: () => void; disabled?: boolean }[] = [
        { label: 'Resoudre formules', iconClass: 'codicon codicon-symbol-operator', title: 'Ouvrir le Formula Solver', action: () => { void onSolveFormula(); } },
        { label: 'Analyse page', iconClass: 'codicon codicon-file', title: 'Lancer l\'analyse complete de la page', action: () => { void onAnalyzePage(); } },
        { label: 'Analyse code', iconClass: 'codicon codicon-search', title: 'Analyser le texte avec Metasolver', action: () => { void onAnalyzeCode(); } },
        { label: 'Analyse plugins', iconClass: 'codicon codicon-extensions', title: 'Analyser cette geocache avec les plugins', action: () => { void onAnalyzeWithPlugins(); } },
        { label: 'Grilles', iconClass: 'codicon codicon-layout', title: 'Ouvrir l atelier de grilles pour cette geocache', action: () => { void onOpenGridPuzzle(); } },
        ...extraActions.map(action => ({
            label: action.label,
            iconClass: 'codicon codicon-zap',
            title: action.title || action.label,
            action: () => { void action.execute({ geocacheData }); },
            disabled: action.isEnabled ? !action.isEnabled({ geocacheData }) : false,
        })),
    ];

    const toolbarBtnStyle: React.CSSProperties = { fontSize: 12, padding: '4px 10px', whiteSpace: 'nowrap' };
    const pillBtnStyle: React.CSSProperties = { ...toolbarBtnStyle, borderRadius: 0, border: '1px solid var(--theia-panel-border)', marginLeft: -1 };
    const pillFirstStyle: React.CSSProperties = { ...pillBtnStyle, borderTopLeftRadius: 4, borderBottomLeftRadius: 4, marginLeft: 0 };
    const pillLastStyle: React.CSSProperties = { ...pillBtnStyle, borderTopRightRadius: 4, borderBottomRightRadius: 4 };
    const tbIconBtn: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6 };
    const vSep: React.CSSProperties = { width: 1, height: 20, background: 'var(--theia-panel-border)', margin: '0 2px', flexShrink: 0 };

    // Bouton de la moitié principale du split Chat IA
    const splitMainStyle: React.CSSProperties = {
        ...toolbarBtnStyle,
        ...tbIconBtn,
        background: 'var(--theia-button-background)',
        color: 'var(--theia-button-foreground)',
        border: 'none',
        borderRight: '1px solid rgba(0,0,0,0.18)',
        cursor: 'pointer',
    };
    // Moitié droite (▾) du split
    const splitArrowStyle: React.CSSProperties = {
        background: 'var(--theia-button-background)',
        color: 'var(--theia-button-foreground)',
        border: 'none',
        padding: '4px 8px',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
    };

    return (
        <div style={{ marginBottom: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                <h3 style={{ margin: 0, flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{geocacheData.name}</h3>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>

                {/* ── Analyse ── */}
                <div ref={analyzeMenuRef} style={{ position: 'relative' }}>
                    <button
                        className='theia-button secondary'
                        onClick={() => setIsAnalyzeMenuOpen(!isAnalyzeMenuOpen)}
                        style={{ ...toolbarBtnStyle, ...tbIconBtn }}
                        title="Outils d'analyse"
                        aria-haspopup='menu'
                        aria-expanded={isAnalyzeMenuOpen}
                    >
                        <i className='fa fa-flask' aria-hidden='true' />
                        <span>Analyser</span>
                        <i className='fa fa-caret-down' style={{ fontSize: 10, opacity: 0.8 }} aria-hidden='true' />
                    </button>
                    {isAnalyzeMenuOpen && (
                        <div
                            role='menu'
                            aria-label="Outils d'analyse"
                            style={{
                                position: 'absolute',
                                top: '100%',
                                left: 0,
                                marginTop: 4,
                                minWidth: 200,
                                background: 'var(--theia-menu-background)',
                                border: '1px solid var(--theia-menu-border)',
                                borderRadius: 4,
                                boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
                                zIndex: 100,
                                padding: '4px 0',
                            }}
                        >
                            {analyzeActions.map((item, index) => {
                                const activate = (): void => { if (!item.disabled) { item.action(); setIsAnalyzeMenuOpen(false); } };
                                return (
                                    <div
                                        key={index}
                                        role='menuitem'
                                        tabIndex={item.disabled ? -1 : 0}
                                        aria-disabled={item.disabled}
                                        onClick={activate}
                                        onKeyDown={(e) => handleMenuItemKeyDown(e, activate)}
                                        title={item.title}
                                        style={{
                                            padding: '7px 12px',
                                            cursor: item.disabled ? 'not-allowed' : 'pointer',
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: 8,
                                            fontSize: 12,
                                            color: 'var(--theia-menu-foreground)',
                                            opacity: item.disabled ? 0.5 : 1,
                                        }}
                                        onMouseEnter={(e) => { if (!item.disabled) { (e.currentTarget as HTMLElement).style.background = 'var(--theia-menu-selectionBackground)'; } }}
                                        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                                    >
                                        <span className={item.iconClass} aria-hidden='true' />
                                        <span>{item.label}</span>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

                <div style={vSep} />

                {/* ── Chat IA — split button unifié ── */}
                <div ref={chatProfileMenuRef} style={{ position: 'relative', display: 'inline-flex' }}>
                    {/*
                     * Les deux moitiés partagent la même couleur de fond (theia-button-background)
                     * et sont encadrées par un seul border+border-radius sur le wrapper.
                     * Une fine séparation interne distingue l'action principale du sélecteur de profil.
                     */}
                    <div style={{
                        display: 'inline-flex',
                        border: '1px solid var(--theia-button-background)',
                        borderRadius: 4,
                        overflow: 'hidden',
                    }}>
                        <button
                            onClick={() => { void onOpenAiChat(); }}
                            style={splitMainStyle}
                            title={`Chat IA dédié à cette géocache — profil : ${effectiveChatProfile}, workflow : ${chatWorkflowPreview}`}
                            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--theia-button-hoverBackground, color-mix(in srgb, var(--theia-button-background) 85%, #fff))'; }}
                            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--theia-button-background)'; }}
                        >
                            <i className='fa fa-comments' aria-hidden='true' />
                            <span>Chat IA</span>
                            {/* Badge de profil actif */}
                            <span style={{
                                fontSize: 10,
                                fontWeight: 600,
                                background: 'rgba(0,0,0,0.18)',
                                borderRadius: 3,
                                padding: '1px 5px',
                                letterSpacing: 0.2,
                                opacity: isChatRoutingPreviewLoading ? 0.5 : 1,
                                transition: 'opacity 0.2s',
                            }}>
                                {isChatRoutingPreviewLoading
                                    ? <i className='fa fa-circle-o-notch fa-spin' aria-hidden='true' />
                                    : effectiveChatProfile}
                            </span>
                        </button>
                        <button
                            onClick={onToggleChatProfileMenu}
                            style={splitArrowStyle}
                            aria-label={`Choisir le profil de chat IA (actuel : ${chatProfileOverrideLabel})`}
                            aria-haspopup='menu'
                            aria-expanded={isChatProfileMenuOpen}
                            title={`Choisir le profil de chat IA (actuel : ${chatProfileOverrideLabel})`}
                            onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--theia-button-hoverBackground, color-mix(in srgb, var(--theia-button-background) 85%, #fff))'; }}
                            onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--theia-button-background)'; }}
                        >
                            <i className='fa fa-caret-down' style={{ fontSize: 11 }} aria-hidden='true' />
                        </button>
                    </div>

                    {/* Menu de sélection du profil IA */}
                    {isChatProfileMenuOpen ? (
                        <div
                            role='menu'
                            aria-label='Profil de chat IA'
                            style={{
                                position: 'absolute',
                                top: '100%',
                                right: 0,
                                marginTop: 4,
                                minWidth: 200,
                                display: 'flex',
                                flexDirection: 'column',
                                background: 'var(--theia-menu-background)',
                                border: '1px solid var(--theia-menu-border)',
                                borderRadius: 4,
                                boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
                                zIndex: 100,
                                padding: '4px 0',
                            }}
                        >
                            {chatProfileOptions.map(option => {
                                const isSelected = chatProfileOverride === option.value;
                                const autoSuffix = option.value === 'default' ? ` → ${chatProfilePreview}` : '';
                                return (
                                    <div
                                        key={option.value}
                                        role='menuitemradio'
                                        aria-checked={isSelected}
                                        tabIndex={0}
                                        onClick={() => onSelectChatProfileOverride(option.value)}
                                        onKeyDown={(e) => handleMenuItemKeyDown(e, () => onSelectChatProfileOverride(option.value))}
                                        style={{
                                            fontSize: 12,
                                            padding: '7px 12px',
                                            cursor: 'pointer',
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: 8,
                                            background: isSelected ? 'var(--theia-list-activeSelectionBackground)' : 'transparent',
                                            color: isSelected ? 'var(--theia-list-activeSelectionForeground)' : 'var(--theia-menu-foreground)',
                                        }}
                                        title={option.value === 'default'
                                            ? `Profil déterminé automatiquement par le workflow (${chatProfilePreview})${option.description ? ` — ${option.description}` : ''}`
                                            : `Forcer le profil ${option.label}${option.description ? ` — ${option.description}` : ''}`}
                                        onMouseEnter={(e) => {
                                            if (!isSelected) { (e.currentTarget as HTMLElement).style.background = 'var(--theia-menu-selectionBackground)'; }
                                        }}
                                        onMouseLeave={(e) => {
                                            if (!isSelected) { (e.currentTarget as HTMLElement).style.background = 'transparent'; }
                                        }}
                                    >
                                        <i
                                            className={isSelected ? 'fa fa-dot-circle-o' : 'fa fa-circle-o'}
                                            style={{ fontSize: 11, width: 14, textAlign: 'center' }}
                                            aria-hidden='true'
                                        />
                                        <span>{`${option.label}${autoSuffix}`}</span>
                                    </div>
                                );
                            })}
                        </div>
                    ) : undefined}
                </div>

                {/* ── Chat libre ── */}
                <button
                    className='theia-button secondary'
                    onClick={() => { void onOpenFreeChat(); }}
                    style={{ ...toolbarBtnStyle, ...tbIconBtn }}
                    title="Chat libre lié à cette géocache (message modifiable avant envoi, possibilité d'ajouter des images)"
                >
                    <i className='fa fa-comment-o' aria-hidden='true' />
                    <span>Chat libre</span>
                </button>

                <div style={vSep} />

                {/* ── Pill group : Logs / Loguer / Notes ── */}
                <div style={{ display: 'flex', alignItems: 'stretch' }}>
                    <button
                        className='theia-button secondary'
                        onClick={onOpenLogs}
                        style={{ ...pillFirstStyle, ...tbIconBtn }}
                        title='Voir les logs de cette géocache'
                    >
                        <i className='fa fa-list-alt' aria-hidden='true' />
                        <span>Logs</span>
                    </button>
                    <button
                        className='theia-button secondary'
                        onClick={onOpenLogEditor}
                        style={{ ...pillBtnStyle, ...tbIconBtn }}
                        title='Rédiger un log pour cette géocache'
                    >
                        <i className='fa fa-pencil' aria-hidden='true' />
                        <span>Loguer</span>
                    </button>
                    <button
                        className='theia-button secondary'
                        onClick={onOpenNotes}
                        style={{ ...pillLastStyle, ...tbIconBtn }}
                        title='Notes personnelles sur cette géocache'
                    >
                        <i className='fa fa-sticky-note-o' aria-hidden='true' />
                        <span>Notes</span>
                        {typeof notesCount === 'number' && notesCount > 0 && (
                            <span style={{
                                background: 'var(--theia-badge-background, #0078d4)',
                                color: 'var(--theia-badge-foreground, #fff)',
                                borderRadius: 8,
                                fontSize: 10,
                                fontWeight: 600,
                                lineHeight: 1.4,
                                padding: '1px 5px',
                                marginLeft: 2,
                            }}>
                                {notesCount}
                            </span>
                        )}
                    </button>
                </div>
            </div>

            <div style={{ display: 'flex', gap: 16, alignItems: 'center', fontSize: 14, flexWrap: 'wrap' }}>
                <span style={{ opacity: 0.7 }}>{geocacheData.gc_code}</span>
                <span style={{ opacity: 0.7 }}>|</span>
                <span style={{ opacity: 0.7 }}>{geocacheData.type}</span>
                <span style={{ opacity: 0.7 }}>|</span>
                {(geocacheData.difficulty !== undefined || geocacheData.terrain !== undefined) && (
                    <>
                        <span style={{ opacity: 0.7 }}>{`D ${geocacheData.difficulty ?? '?'}/T ${geocacheData.terrain ?? '?'}`}</span>
                        <span style={{ opacity: 0.7 }}>|</span>
                    </>
                )}
                {ownerName ? (
                    <span style={{ opacity: 0.7, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        Par
                        <span
                            role='button'
                            tabIndex={0}
                            aria-haspopup='menu'
                            onClick={(e) => openOwnerMenu(e, e.currentTarget)}
                            onContextMenu={(e) => openOwnerMenu(e, e.currentTarget)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                    openOwnerMenu(e, e.currentTarget);
                                }
                            }}
                            title={`${ownerName} — clic pour le contacter ou ouvrir sa fiche sur Geocaching.com`}
                            style={{
                                cursor: 'pointer',
                                textDecoration: 'underline dotted',
                                textUnderlineOffset: 3,
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 4,
                            }}
                        >
                            {ownerName}
                            <i className='fa fa-caret-down' style={{ fontSize: 10, opacity: 0.8 }} aria-hidden='true' />
                        </span>
                    </span>
                ) : (
                    <span style={{ opacity: 0.7 }}>Par Inconnu</span>
                )}
                {ownerMenuPosition ? (
                    <ContextMenu
                        items={ownerMenuItems}
                        x={ownerMenuPosition.x}
                        y={ownerMenuPosition.y}
                        onClose={() => setOwnerMenuPosition(null)}
                    />
                ) : undefined}
                {renderFoundBadge(geocacheData)}
                {geocacheData.status === 'archived' && (
                    <span style={{
                        background: 'var(--theia-inputValidation-errorBackground)',
                        color: 'var(--theia-errorForeground)',
                        border: '1px solid var(--theia-inputValidation-errorBorder, var(--theia-errorForeground))',
                        borderRadius: 4,
                        padding: '2px 8px',
                        fontSize: 11,
                        fontWeight: 'bold',
                    }}>
                        <span className='codicon codicon-circle-slash' aria-hidden='true' /> Archivée
                    </span>
                )}
                {geocacheData.status === 'disabled' && (
                    <span style={{
                        background: 'var(--theia-inputValidation-warningBackground)',
                        color: 'var(--theia-warningForeground)',
                        border: '1px solid var(--theia-inputValidation-warningBorder, var(--theia-warningForeground))',
                        borderRadius: 4,
                        padding: '2px 8px',
                        fontSize: 11,
                        fontWeight: 'bold',
                    }}>
                        <span className='codicon codicon-warning' aria-hidden='true' /> Désactivée
                    </span>
                )}
                {onRefresh && (
                    <button
                        className='theia-button secondary'
                        onClick={() => { void onRefresh(); }}
                        disabled={isRefreshing}
                        style={{ fontSize: 11, padding: '2px 8px', borderRadius: 12, cursor: isRefreshing ? 'wait' : undefined }}
                        title={isRefreshing ? 'Rafraîchissement en cours…' : 'Rafraîchir cette géocache'}
                        aria-label={isRefreshing ? 'Rafraîchissement en cours…' : 'Rafraîchir cette géocache'}
                        aria-busy={isRefreshing}
                    >
                        <span
                            aria-hidden='true'
                            className={`codicon codicon-refresh geoapp-gcd-refresh-icon${isRefreshing ? ' geoapp-gcd-refresh-icon--spinning' : ''}`}
                        />
                    </button>
                )}
                {archiveStatus !== 'none' ? (
                    <button
                        onClick={() => { void onForceSyncArchive(); }}
                        disabled={archiveStatus === 'loading' || isSyncingArchive}
                        title={archiveTooltip}
                        aria-label={archiveTooltip}
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
                        <span className={archiveIconClass} aria-hidden='true' />
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
    logsSummaryEntries?: LogSummaryEntry[];
    logsSummaryTotalCount?: number;
    isLogsSummaryLoading?: boolean;
    onOpenLogs?: () => void;
}

export const GeocacheOverviewSection: React.FC<GeocacheOverviewSectionProps> = ({
    geocacheData,
    coordinatesEditor,
    logsSummaryEntries,
    logsSummaryTotalCount,
    isLogsSummaryLoading,
    onOpenLogs,
}) => (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(300px, 100%), 1fr))', gap: 12 }}>
        <div style={cardStyle}>
            <h4 style={{ margin: '0 0 16px 0', fontSize: 16 }}>Statistiques</h4>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div>
                    <div style={{ opacity: 0.7, fontSize: 12, marginBottom: 4 }}>Difficulte</div>
                    <div>{renderStars(geocacheData.difficulty, 'var(--theia-charts-yellow, #fbbf24)')}</div>
                </div>
                <div>
                    <div style={{ opacity: 0.7, fontSize: 12, marginBottom: 4 }}>Terrain</div>
                    <div>{renderStars(geocacheData.terrain, 'var(--theia-charts-green, #10b981)')}</div>
                </div>
                <div>
                    <div style={{ opacity: 0.7, fontSize: 12, marginBottom: 4 }}>Taille</div>
                    <div style={{ color: 'var(--theia-charts-blue, #60a5fa)' }}>{geocacheData.size || 'N/A'}</div>
                </div>
                <div>
                    <div style={{ opacity: 0.7, fontSize: 12, marginBottom: 4 }}>Favoris</div>
                    <div style={{ color: 'var(--theia-charts-purple, #a78bfa)' }}>{geocacheData.favorites_count || 0}</div>
                </div>
            </div>

            {(logsSummaryEntries && logsSummaryEntries.length > 0) || isLogsSummaryLoading ? (
                <div style={{ marginTop: 16 }}>
                    <LogsRecentSummary
                        entries={logsSummaryEntries ?? []}
                        totalCount={logsSummaryTotalCount ?? 0}
                        isLoading={isLogsSummaryLoading ?? false}
                        onOpenLogs={onOpenLogs}
                    />
                </div>
            ) : undefined}

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
                {renderRow('Trouvee', geocacheData.found ? 'Oui' : 'Non')}
                {renderRow('Trouvee le', formatFoundDate(geocacheData.found_date))}
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
        <div style={cardStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <h4 style={{ margin: 0, fontSize: 16 }}>Indices</h4>
                <button
                    className='theia-button secondary'
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

type CheckerLinkOpenMode = 'same-group' | 'new-group' | 'external-window';

interface GeocacheCheckersSectionProps {
    checkers?: GeocacheChecker[];
    linkOpenMode?: CheckerLinkOpenMode;
    onOpenUrl?: (url: string, mode: CheckerLinkOpenMode) => void;
    contextMenu?: { x: number; y: number; url: string } | null;
    onShowContextMenu?: (x: number, y: number, url: string) => void;
    onCloseContextMenu?: () => void;
}

export const GeocacheCheckersSection: React.FC<GeocacheCheckersSectionProps> = ({
    checkers,
    linkOpenMode = 'same-group',
    onOpenUrl,
    contextMenu,
    onShowContextMenu,
    onCloseContextMenu
}) => {
    if (!checkers || checkers.length === 0) {
        return undefined;
    }

    const handleClick = (e: React.MouseEvent, url: string): void => {
        e.preventDefault();
        e.stopPropagation();
        if (onOpenUrl) {
            onOpenUrl(url, linkOpenMode);
        } else {
            window.open(url, '_blank');
        }
    };

    const handleContextMenu = (e: React.MouseEvent, url: string): void => {
        e.preventDefault();
        e.stopPropagation();
        if (onShowContextMenu) {
            onShowContextMenu(e.clientX, e.clientY, url);
        }
    };

    const buildContextMenuItems = (url: string): ContextMenuItem[] => [
        {
            label: 'Ouvrir dans un nouvel onglet (même groupe)',
            iconClass: 'codicon codicon-multiple-windows',
            action: () => {
                if (onOpenUrl) { onOpenUrl(url, 'same-group'); } else { window.open(url, '_blank'); }
            }
        },
        {
            label: 'Ouvrir dans un nouveau groupe d\'onglets',
            iconClass: 'codicon codicon-split-horizontal',
            action: () => {
                if (onOpenUrl) { onOpenUrl(url, 'new-group'); } else { window.open(url, '_blank'); }
            }
        },
        {
            label: 'Ouvrir dans une fenêtre externe',
            iconClass: 'codicon codicon-link-external',
            action: () => {
                if (onOpenUrl) { onOpenUrl(url, 'external-window'); } else { window.open(url, '_blank', 'noopener,noreferrer'); }
            }
        }
    ];

    const isGeocheckUrl = (url: string): boolean => {
        try { return new URL(url).hostname.includes('geocheck.org'); } catch { return false; }
    };

    return (
        <div style={cardStyle}>
            <h4 style={{ margin: '0 0 16px 0', fontSize: 16 }}>Checkers</h4>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
                {checkers.map((checker, index) => (
                    <li key={checker.id ?? index} style={{ marginBottom: 4 }}>
                        {checker.url ? (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                <a
                                    href={checker.url}
                                    onClick={(e) => handleClick(e, checker.url!)}
                                    onContextMenu={(e) => handleContextMenu(e, checker.url!)}
                                    style={{ cursor: 'pointer' }}
                                    rel='noreferrer'
                                >
                                    {checker.name || checker.url}
                                </a>
                                {isGeocheckUrl(checker.url) && (
                                    <span
                                        title="GeoCheck utilise un captcha dynamique qui ne s'affiche pas dans le mini-navigateur intégré. Utilisez « Ouvrir dans une fenêtre externe » (clic droit) pour accéder au captcha."
                                        style={{
                                            fontSize: '0.75em',
                                            color: 'var(--theia-warningForeground, #d4a017)',
                                            border: '1px solid var(--theia-warningForeground, #d4a017)',
                                            borderRadius: 3,
                                            padding: '0 4px',
                                            cursor: 'help',
                                            whiteSpace: 'nowrap',
                                            opacity: 0.85,
                                        }}
                                    >
                                        <span className='codicon codicon-warning' aria-hidden='true' /> captcha → fenêtre externe
                                    </span>
                                )}
                            </span>
                        ) : (checker.name || '')}
                    </li>
                ))}
            </ul>
            {contextMenu && onCloseContextMenu && (
                <ContextMenu
                    items={buildContextMenuItems(contextMenu.url)}
                    x={contextMenu.x}
                    y={contextMenu.y}
                    onClose={onCloseContextMenu}
                />
            )}
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

/** Date de decouverte au format court FR, ou `undefined` si absente / invalide. */
function formatFoundDate(iso?: string): string | undefined {
    if (!iso) {
        return undefined;
    }
    const timestamp = Date.parse(iso);
    if (!Number.isFinite(timestamp)) {
        return undefined;
    }
    return new Date(timestamp).toLocaleDateString('fr-FR');
}

/**
 * Pastille « trouvee / non trouvee » affichee dans l'entete. Les deux etats sont rendus
 * (et non seulement « trouvee ») pour que le statut soit toujours explicite : une absence
 * de pastille serait ambigue avec une donnee non chargee.
 */
function renderFoundBadge(geocacheData: GeocacheDto): React.ReactNode {
    const isFound = geocacheData.found === true;
    const foundDate = formatFoundDate(geocacheData.found_date);
    const label = isFound
        ? (foundDate ? `Trouvée le ${foundDate}` : 'Trouvée')
        : 'Non trouvée';
    const tooltip = isFound
        ? (foundDate ? `Géocache trouvée le ${foundDate}` : 'Géocache trouvée (date inconnue)')
        : 'Géocache pas encore trouvée';
    const green = 'var(--theia-charts-green, #10b981)';

    return (
        <span
            title={tooltip}
            aria-label={tooltip}
            style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                borderRadius: 12,
                padding: '2px 10px',
                fontSize: 12,
                fontWeight: 'bold',
                border: `1px solid ${isFound ? green : 'var(--theia-panel-border)'}`,
                background: isFound ? green : 'transparent',
                color: isFound ? 'var(--theia-editor-background)' : 'var(--theia-descriptionForeground, var(--theia-foreground))',
                opacity: isFound ? 1 : 0.85,
            }}
        >
            <span aria-hidden='true'>{isFound ? '✔' : '○'}</span>
            <span>{label}</span>
        </span>
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
        return 'var(--theia-charts-green, #10b981)';
    }
    if (status === 'loading') {
        return 'var(--theia-charts-blue, #60a5fa)';
    }
    return 'var(--theia-charts-orange, #f59e0b)';
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

function getArchiveIconClass(status: ArchiveStatus): string {
    if (status === 'synced') {
        return 'codicon codicon-archive';
    }
    if (status === 'loading') {
        return 'codicon codicon-loading codicon-modifier-spin';
    }
    return 'codicon codicon-warning';
}
