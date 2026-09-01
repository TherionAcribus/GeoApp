/**
 * UI panel for browsing geocache images and editing their metadata (OCR/QR/notes).
 */

import * as React from 'react';
import { MessageService } from '@theia/core';
import { ConfirmDialog, ConfirmSaveDialog } from '@theia/core/lib/browser';
import { LanguageModelRegistry, LanguageModelService, UserRequest, getJsonOfResponse, getTextOfResponse, isLanguageModelParsedResponse } from '@theia/ai-core';
import { ContextMenu, ContextMenuItem } from './context-menu';
import '../../src/browser/style/geocache-images-panel.css';

export type GeocacheImageV2Dto = {
    id: number;
    geocache_id: number;
    url: string;
    source_url: string;
    stored: boolean;
    parent_image_id?: number | null;
    derivation_type?: string;
    image_type?: 'listing' | 'owner' | 'spoiler' | null;
    title?: string | null;
    note?: string | null;
    mime_type?: string | null;
    byte_size?: number | null;
    qr_payload?: string | null;
    ocr_text?: string | null;
    ocr_language?: string | null;
    detected_features?: Record<string, unknown> | null;
};

export type GalleryThumbnailSize = 'small' | 'medium' | 'large';

export interface GeocacheImageChatSelection {
    id: number;
    url: string;
    source_url: string;
    origin: 'user_observation' | 'cache_listing';
    originLabel: string;
    title?: string | null;
    note?: string | null;
}

type ThumbnailContextMenuState = {
    x: number;
    y: number;
    imageId: number;
};

type ExifReadOptions = {
    silent?: boolean;
    preserveSelection?: boolean;
};

export interface GeocacheImagesPanelProps {
    backendBaseUrl: string;
    geocacheId: number;
    messages: MessageService;
    languageModelRegistry: LanguageModelRegistry;
    languageModelService: LanguageModelService;
    storageDefaultMode?: 'never' | 'prompt' | 'always';
    onConfirmStoreAll?: (options: { geocacheId: number; pendingCount: number }) => Promise<boolean>;
    thumbnailSize?: GalleryThumbnailSize;
    onThumbnailSizeChange?: (size: GalleryThumbnailSize) => Promise<void> | void;
    hiddenDomains?: string[];
    hiddenDomainsText?: string;
    onHiddenDomainsTextChange?: (value: string) => Promise<void> | void;
    ocrDefaultEngine?: 'easyocr_ocr' | 'vision_ocr';
    ocrDefaultLanguage?: string;
    ocrVisionProvider?: 'lmstudio' | 'openrouter';
    ocrLmstudioBaseUrl?: string;
    ocrLmstudioModel?: string;
    ocrOpenRouterModel?: string;
    /**
     * Recommended image count for chat prompts. Users may exceed it manually.
     */
    maxChatImages?: number;
    onAnalyzeImages?: (images: GeocacheImageChatSelection[]) => Promise<void> | void;
}

// ---- ThumbnailItem ----------------------------------------------------------

interface ThumbnailItemProps {
    img: GeocacheImageV2Dto;
    isSelected: boolean;
    isOcrBusy: boolean;
    isHiddenDomain: boolean;
    isMissing: boolean;
    isChatSelected: boolean;
    isBusy: boolean;
    thumbnailImageClassName: string;
    thumbnailDimensions: { width: number; height: number };
    resolvedUrl: string;
    showChatToggle: boolean;
    hasUsefulExifFeature: (img: GeocacheImageV2Dto | null | undefined) => boolean;
    onCancelOcr: (imageId: number) => void;
    onClick: (imageId: number) => void;
    onContextMenu: (e: React.MouseEvent, imageId: number) => void;
    onToggleChat: (imageId: number) => void;
}

const ThumbnailItem = React.memo<ThumbnailItemProps>(function ThumbnailItem({
    img, isSelected, isOcrBusy, isHiddenDomain, isMissing, isChatSelected, isBusy,
    thumbnailImageClassName, thumbnailDimensions, resolvedUrl, showChatToggle,
    hasUsefulExifFeature, onCancelOcr, onClick, onContextMenu, onToggleChat,
}) {
    const title = (img.title || '').trim() || `Image #${img.id}`;
    const isUploaded = (img.source_url || '').startsWith('geoapp-upload://');
    const originLabel = isUploaded ? 'Photo utilisateur locale' : 'Image du listing';
    let kindLabel = 'Image du listing';
    if (isUploaded) { kindLabel = 'Ajout manuel'; }
    else if (img.derivation_type?.startsWith('edited')) { kindLabel = 'Image éditée'; }
    else if (img.derivation_type?.startsWith('snippet')) { kindLabel = 'Sous-image'; }
    else if (img.derivation_type?.startsWith('copy')) { kindLabel = 'Copie'; }
    else if (img.parent_image_id) { kindLabel = 'Dérivée'; }
    else if (img.image_type === 'spoiler') { kindLabel = 'Spoiler'; }
    else if (img.image_type === 'owner') { kindLabel = 'Image propriétaire'; }

    const badges: { label: string; tone: string }[] = [];
    if (img.image_type === 'spoiler') { badges.push({ label: 'SPOILER', tone: 'danger' }); }
    else if (img.image_type === 'owner') { badges.push({ label: 'PROPRIO', tone: 'info' }); }
    if (img.stored) { badges.push({ label: 'LOCAL', tone: 'success' }); }
    if (isMissing) { badges.push({ label: 'MANQUANT', tone: 'danger' }); }
    if ((img.note || '').trim()) { badges.push({ label: 'NOTE', tone: 'info' }); }
    if ((img.qr_payload || '').trim()) { badges.push({ label: 'QR', tone: 'accent' }); }
    if ((img.ocr_text || '').trim()) { badges.push({ label: 'OCR', tone: 'warning' }); }
    if (hasUsefulExifFeature(img)) { badges.push({ label: 'EXIF', tone: 'info' }); }
    if (img.parent_image_id) { badges.push({ label: 'DÉRIVÉE', tone: 'neutral' }); }

    return (
        <div
            role='button'
            tabIndex={isBusy ? -1 : 0}
            data-image-id={img.id}
            className={`geoapp-images-thumbnail ${isSelected ? 'is-selected' : ''} ${isHiddenDomain ? 'is-hidden-domain' : ''} ${isBusy ? 'is-disabled' : ''}`}
            onClick={() => { if (!isBusy) { onClick(img.id); } }}
            onContextMenu={(e) => { if (!isBusy) { onContextMenu(e, img.id); } }}
            onKeyDown={(e) => {
                if (isBusy) {
                    return;
                }
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onClick(img.id);
                }
            }}
            title={img.source_url}
            aria-busy={isOcrBusy}
            aria-pressed={isSelected}
            aria-disabled={isBusy || undefined}
        >
            <div className='geoapp-images-thumbnail-frame'>
                {isMissing || !img.url ? (
                    <div className='geoapp-images-thumbnail-placeholder'>
                        <span className='codicon codicon-warning' />
                    </div>
                ) : (
                    <img
                        className={`${thumbnailImageClassName} ${isOcrBusy ? 'is-busy' : ''}`}
                        src={resolvedUrl}
                        alt=''
                        width={thumbnailDimensions.width}
                        height={thumbnailDimensions.height}
                        loading='lazy'
                    />
                )}

                {isOcrBusy && (
                    <div className='geoapp-images-thumbnail-busy'>
                        <div className='geoapp-images-spinner' />
                        <span>OCR</span>
                    </div>
                )}

                {isOcrBusy && (
                    <button
                        type='button'
                        className='geoapp-images-thumbnail-cancel'
                        onClick={(e) => {
                            e.stopPropagation();
                            onCancelOcr(img.id);
                        }}
                        title="Annuler l'OCR"
                        aria-label="Annuler l'OCR"
                    >
                        ×
                    </button>
                )}
            </div>

            <div className='geoapp-images-thumbnail-meta'>
                <span>{title}</span>
                <small>{originLabel} - {kindLabel}</small>
            </div>
            {(badges.length > 0 || showChatToggle) && (
                <div className='geoapp-images-badges'>
                    {badges.map(b => (
                        <span key={b.label} className={`geoapp-images-badge geoapp-images-badge--${b.tone}`}>
                            {b.label}
                        </span>
                    ))}
                    {showChatToggle && (
                        <button
                            type='button'
                            role='checkbox'
                            aria-checked={isChatSelected}
                            className={`geoapp-images-badge geoapp-images-badge--interactive ${isChatSelected ? 'geoapp-images-badge--accent' : 'geoapp-images-badge--neutral'}`}
                            onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                onToggleChat(img.id);
                            }}
                            title='Ajouter ou retirer cette image de la sélection chat'
                            disabled={isBusy}
                        >
                            CHAT
                        </button>
                    )}
                </div>
            )}
        </div>
    );
});

// ---- GeocacheImagesPanel ----------------------------------------------------

export const GeocacheImagesPanel: React.FC<GeocacheImagesPanelProps> = ({
    backendBaseUrl,
    geocacheId,
    messages,
    languageModelRegistry,
    languageModelService,
    storageDefaultMode = 'prompt',
    onConfirmStoreAll,
    thumbnailSize = 'small',
    onThumbnailSizeChange,
    hiddenDomains = [],
    hiddenDomainsText,
    onHiddenDomainsTextChange,
    ocrDefaultEngine = 'easyocr_ocr',
    ocrDefaultLanguage = 'auto',
    ocrVisionProvider = 'lmstudio',
    ocrLmstudioBaseUrl = 'http://localhost:1234',
    ocrLmstudioModel = '',
    ocrOpenRouterModel = 'openai/gpt-4o-mini',
    maxChatImages = 5,
    onAnalyzeImages,
}) => {
    const [images, setImages] = React.useState<GeocacheImageV2Dto[]>([]);
    const [isLoading, setIsLoading] = React.useState(false);
    const [selectedId, setSelectedId] = React.useState<number | null>(null);
    // `isSaving` ne bloque plus que les opérations globales (upload, store-all,
    // analyze-chat). Les opérations par image utilisent `busyImageIds` pour ne
    // pas geler toute la galerie pendant une action sur une seule vignette.
    const [isSaving, setIsSaving] = React.useState(false);

    // Opérations par image en cours (stockage, suppression, QR, EXIF, etc.).
    // Permet de désactiver uniquement les actions sur l'image concernée, pas
    // toute la galerie. L'OCR a son propre état (ocrInProgressById) car il est
    // annulable.
    const [busyImageIds, setBusyImageIds] = React.useState<Record<number, true>>({});
    const setBusyImage = React.useCallback((imageId: number, busy: boolean): void => {
        setBusyImageIds(prev => {
            const next = { ...prev };
            if (busy) {
                next[imageId] = true;
            } else {
                delete next[imageId];
            }
            return next;
        });
    }, []);
    const isImageBusy = React.useCallback((imageId: number): boolean => {
        return Boolean(busyImageIds[imageId]) || Boolean(ocrInProgressById[imageId]);
    }, [busyImageIds, ocrInProgressById]);

    const [ocrInProgressById, setOcrInProgressById] = React.useState<Record<number, true>>({});
    const ocrAbortControllersRef = React.useRef<Record<number, AbortController>>({});

    const setOcrInProgress = React.useCallback((imageId: number, inProgress: boolean): void => {
        setOcrInProgressById(prev => {
            const next = { ...prev };
            if (inProgress) {
                next[imageId] = true;
            } else {
                delete next[imageId];
            }
            return next;
        });
        if (!inProgress) {
            delete ocrAbortControllersRef.current[imageId];
        }
    }, []);

    const cancelOcrForImage = React.useCallback((imageId: number): void => {
        const controller = ocrAbortControllersRef.current[imageId];
        if (controller) {
            controller.abort();
            delete ocrAbortControllersRef.current[imageId];
        }
        setOcrInProgress(imageId, false);
        messages.info('OCR annulé');
    }, [messages, setOcrInProgress]);

    const createOcrAbortController = React.useCallback((imageId: number): AbortController => {
        const existing = ocrAbortControllersRef.current[imageId];
        if (existing) {
            existing.abort();
        }
        const controller = new AbortController();
        ocrAbortControllersRef.current[imageId] = controller;
        return controller;
    }, []);

    const [hiddenDomainsDraft, setHiddenDomainsDraft] = React.useState(hiddenDomainsText ?? '');
    const [isSavingHiddenDomains, setIsSavingHiddenDomains] = React.useState(false);
    const [showHiddenImages, setShowHiddenImages] = React.useState(false);

    const [, setDetailsMode] = React.useState<'hidden' | 'fields' | 'preview'>('hidden');

    const [contextMenu, setContextMenu] = React.useState<ThumbnailContextMenuState | null>(null);
    const [previewMenuAnchor, setPreviewMenuAnchor] = React.useState<{ x: number; y: number } | null>(null);
    const [chatImageIds, setChatImageIds] = React.useState<number[]>([]);
    const chatImageIdsSet = React.useMemo(() => new Set(chatImageIds), [chatImageIds]);

    const uploadInputRef = React.useRef<HTMLInputElement | null>(null);
    const gridRef = React.useRef<HTMLDivElement | null>(null);
    const initializedChatSelectionForRef = React.useRef<number | null>(null);
    const didWarnChatImageLimitRef = React.useRef(false);
    const autoExifImageIdsRef = React.useRef<Set<number>>(new Set());
    const autoExifInProgressRef = React.useRef(false);

    const [effectiveThumbnailSize, setEffectiveThumbnailSize] = React.useState<GalleryThumbnailSize>(thumbnailSize);

    // États pour le visualiseur de GIF frame par frame
    const [gifFrameViewerOpen, setGifFrameViewerOpen] = React.useState(false);
    const [gifFrameViewerImage, setGifFrameViewerImage] = React.useState<GeocacheImageV2Dto | null>(null);
    const [gifFrameViewerFrames, setGifFrameViewerFrames] = React.useState<string[]>([]);
    const [gifFrameViewerCurrentFrame, setGifFrameViewerCurrentFrame] = React.useState(0);
    const [gifFrameViewerLoading, setGifFrameViewerLoading] = React.useState(false);

    const didApplyDefaultStorageRef = React.useRef<Record<number, boolean>>({});

    React.useEffect(() => {
        setEffectiveThumbnailSize(thumbnailSize);
    }, [thumbnailSize]);

    React.useEffect(() => {
        setHiddenDomainsDraft(hiddenDomainsText ?? '');
    }, [hiddenDomainsText]);

    const thumbnailImageClassName = React.useMemo(() => {
        switch (effectiveThumbnailSize) {
            case 'large':
                return 'geoapp-images-thumbnail-image geoapp-images-thumbnail-image--large';
            case 'medium':
                return 'geoapp-images-thumbnail-image geoapp-images-thumbnail-image--medium';
            default:
                return 'geoapp-images-thumbnail-image geoapp-images-thumbnail-image--small';
        }
    }, [effectiveThumbnailSize]);

    const thumbnailDimensions = React.useMemo(() => {
        switch (effectiveThumbnailSize) {
            case 'large':
                return { width: 144, height: 96 };
            case 'medium':
                return { width: 96, height: 64 };
            default:
                return { width: 64, height: 48 };
        }
    }, [effectiveThumbnailSize]);

    const sizeButtonClassName = (size: GalleryThumbnailSize): string => {
        const isActive = effectiveThumbnailSize === size;
        return `theia-button secondary geoapp-images-size-button ${isActive ? 'is-active' : ''}`;
    };

    const changeThumbnailSize = (size: GalleryThumbnailSize): void => {
        setEffectiveThumbnailSize(size);
        void Promise.resolve(onThumbnailSizeChange?.(size));
    };

    const normalizeDomainEntry = React.useCallback((entry: string): string | null => {
        const raw = (entry || '').trim();
        if (!raw) {
            return null;
        }

        const normalizeHost = (host: string): string | null => {
            const cleaned = (host || '').trim().toLowerCase().replace(/^www\./, '');
            if (!cleaned) {
                return null;
            }
            if (cleaned.includes('/')) {
                return cleaned.split('/')[0] || null;
            }
            return cleaned;
        };

        try {
            const url = new URL(raw);
            return normalizeHost(url.hostname);
        } catch {
        }

        const withoutProtocol = raw.replace(/^https?:\/\//i, '');
        const base = withoutProtocol.split(/[/?#]/)[0] || '';
        return normalizeHost(base);
    }, []);

    const normalizedHiddenDomains = React.useMemo(() => {
        return (hiddenDomains || [])
            .filter((d): d is string => typeof d === 'string')
            .map(d => normalizeDomainEntry(d))
            .filter((d): d is string => Boolean(d));
    }, [hiddenDomains, normalizeDomainEntry]);

    const isHiddenByDomain = React.useCallback((sourceUrl: string): boolean => {
        const trimmed = (sourceUrl || '').trim();
        if (!trimmed) {
            return false;
        }
        try {
            const host = new URL(trimmed).hostname.toLowerCase().replace(/^www\./, '');
            if (!host) {
                return false;
            }
            return normalizedHiddenDomains.some(domain => host === domain || host.endsWith(`.${domain}`));
        } catch {
            return false;
        }
    }, [normalizedHiddenDomains]);

    const visibleImages = React.useMemo(() => {
        if (showHiddenImages) {
            return images;
        }
        if (!normalizedHiddenDomains.length) {
            return images;
        }
        return images.filter(img => !isHiddenByDomain(img.source_url));
    }, [images, isHiddenByDomain, normalizedHiddenDomains.length, showHiddenImages]);

    const selectableChatImageIds = React.useMemo(() => {
        return new Set(visibleImages.filter(image => Boolean(image.url)).map(image => image.id));
    }, [visibleImages]);

    const getPersistedChatSelectionKey = React.useCallback((): string => {
        return `geoapp.earthcoach.chatImageSelection.${geocacheId}`;
    }, [geocacheId]);

    const persistChatImageIds = React.useCallback((ids: number[]): void => {
        if (!geocacheId) {
            return;
        }
        try {
            window.localStorage.setItem(getPersistedChatSelectionKey(), JSON.stringify(ids));
        } catch {
            // localStorage may be unavailable in tests or restricted browser contexts.
        }
    }, [geocacheId, getPersistedChatSelectionKey]);

    const readPersistedChatImageIds = React.useCallback((): number[] => {
        try {
            const raw = window.localStorage.getItem(getPersistedChatSelectionKey());
            const parsed = raw ? JSON.parse(raw) : undefined;
            if (!Array.isArray(parsed)) {
                return [];
            }
            return parsed
                .map(value => Number.parseInt(String(value), 10))
                .filter(value => Number.isFinite(value));
        } catch {
            return [];
        }
    }, [getPersistedChatSelectionKey]);

    const warnIfChatSelectionIsHeavy = React.useCallback((count: number): void => {
        if (count <= maxChatImages || didWarnChatImageLimitRef.current) {
            return;
        }
        didWarnChatImageLimitRef.current = true;
        messages.info(`Plus de ${maxChatImages} image(s) selectionnees: le prompt sera plus lourd et pourra ralentir l'analyse.`);
    }, [maxChatImages, messages]);

    const selected = React.useMemo(() => visibleImages.find(i => i.id === selectedId) ?? null, [visibleImages, selectedId]);

    React.useEffect(() => {
        if (selectedId === null || isLoading) {
            // Pendant un refresh, visibleImages reflète encore l'ancienne liste :
            // ne pas désélectionner (la nouvelle image peut ne pas y figurer).
            return;
        }
        const stillVisible = visibleImages.some(img => img.id === selectedId);
        if (!stillVisible) {
            setSelectedId(null);
            setDetailsMode('hidden');
        }
    }, [selectedId, visibleImages, isLoading]);

    React.useEffect(() => {
        if (selectedId === null || !gridRef.current) {
            return;
        }
        const el = gridRef.current.querySelector<HTMLElement>(`[data-image-id="${selectedId}"]`);
        el?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }, [selectedId]);

    React.useEffect(() => {
        setChatImageIds(prev => {
            const next = prev.filter(id => selectableChatImageIds.has(id));
            if (next.length <= maxChatImages) {
                didWarnChatImageLimitRef.current = false;
            }
            if (next.length !== prev.length || !next.every((id, index) => id === prev[index])) {
                persistChatImageIds(next);
            }
            return next.length === prev.length && next.every((id, index) => id === prev[index]) ? prev : next;
        });
    }, [maxChatImages, persistChatImageIds, selectableChatImageIds]);

    const [draftTitle, setDraftTitle] = React.useState('');
    const [draftNote, setDraftNote] = React.useState('');
    const [draftQr, setDraftQr] = React.useState('');
    const [draftOcr, setDraftOcr] = React.useState('');

    // Champs modifiés par l'utilisateur mais non encore sauvegardés.
    // Sert à ne pas écraser les saisies en cours quand l'objet `selected` est
    // rafraîchi (ex: OCR/QR/EXIF qui déclenche un patchImage) et à proposer une
    // confirmation avant de changer d'image avec des modifications en cours.
    type DirtyField = 'title' | 'note' | 'qr' | 'ocr';
    const [dirtyFields, setDirtyFields] = React.useState<Set<DirtyField>>(new Set());
    const markFieldDirty = React.useCallback((field: DirtyField): void => {
        setDirtyFields(prev => prev.has(field) ? prev : (() => { const next = new Set(prev); next.add(field); return next; })());
    }, []);
    const clearDirtyFields = React.useCallback((): void => {
        setDirtyFields(prev => prev.size === 0 ? prev : new Set());
    }, []);
    const clearDirtyField = React.useCallback((field: DirtyField): void => {
        setDirtyFields(prev => {
            if (!prev.has(field)) {
                return prev;
            }
            const next = new Set(prev);
            next.delete(field);
            return next;
        });
    }, []);
    const prevSelectedIdRef = React.useRef<number | null>(null);
    // Ref vers la fonction de changement de sélection (définie plus bas, après
    // saveMetadata) pour éviter une dépendance circulaire avec handleThumbnailClick.
    const requestSelectionChangeRef = React.useRef<(imageId: number | null) => Promise<boolean>>(async () => false);

    const resolveImageUrl = React.useCallback((url: string) => {
        if (!url) {
            return url;
        }
        if (url.startsWith('/')) {
            return `${backendBaseUrl}${url}`;
        }
        return url;
    }, [backendBaseUrl]);

    const loadImages = React.useCallback(async (): Promise<GeocacheImageV2Dto[]> => {
        if (!geocacheId) {
            return [];
        }
        setIsLoading(true);
        try {
            const res = await fetch(`${backendBaseUrl}/api/geocaches/${geocacheId}/images`, { credentials: 'include' });
            if (!res.ok) {
                throw new Error(`HTTP ${res.status}`);
            }
            const data = (await res.json()) as GeocacheImageV2Dto[];
            const safeData = Array.isArray(data) ? data : [];
            setImages(safeData);
            setSelectedId(prev => (prev && safeData.some(x => x.id === prev) ? prev : null));
            return safeData;
        } catch (e) {
            console.error('[GeocacheImagesPanel] load images error', e);
            setImages([]);
            setSelectedId(null);
            return [];
        } finally {
            setIsLoading(false);
        }
    }, [backendBaseUrl, geocacheId]);

    React.useEffect(() => {
        void loadImages();
    }, [loadImages]);

    React.useEffect(() => {
        initializedChatSelectionForRef.current = null;
        didWarnChatImageLimitRef.current = false;
        autoExifImageIdsRef.current = new Set();
        autoExifInProgressRef.current = false;
        setChatImageIds([]);
    }, [geocacheId]);

    React.useEffect(() => {
        const handler = (event: Event): void => {
            const custom = event as CustomEvent<{ geocacheId?: number }>;
            const targetGeocacheId = custom.detail?.geocacheId;
            if (targetGeocacheId && targetGeocacheId === geocacheId) {
                void loadImages();
            }
        };
        window.addEventListener('geoapp-geocache-images-updated', handler);
        return () => {
            window.removeEventListener('geoapp-geocache-images-updated', handler);
        };
    }, [geocacheId, loadImages]);

    React.useEffect(() => {
        const currentId = selected?.id ?? null;
        const prevId = prevSelectedIdRef.current;
        prevSelectedIdRef.current = currentId;

        if (!selected) {
            setDraftTitle('');
            setDraftNote('');
            setDraftQr('');
            setDraftOcr('');
            clearDirtyFields();
            return;
        }

        if (prevId === currentId) {
            // Même image, objet rafraîchi (ex: OCR/QR/EXIF qui appelle patchImage).
            // On n'écrase que les champs que l'utilisateur n'a pas modifiés.
            if (!dirtyFields.has('title')) {
                setDraftTitle(selected.title ?? '');
            }
            if (!dirtyFields.has('note')) {
                setDraftNote(selected.note ?? '');
            }
            if (!dirtyFields.has('qr')) {
                setDraftQr(selected.qr_payload ?? '');
            }
            if (!dirtyFields.has('ocr')) {
                setDraftOcr(selected.ocr_text ?? '');
            }
            return;
        }

        // Changement d'image : on recharge les drafts depuis la nouvelle sélection.
        setDraftTitle(selected.title ?? '');
        setDraftNote(selected.note ?? '');
        setDraftQr(selected.qr_payload ?? '');
        setDraftOcr(selected.ocr_text ?? '');
        clearDirtyFields();
    }, [selected, dirtyFields, clearDirtyFields]);

    const handleThumbnailClick = React.useCallback((imageId: number): void => {
        void requestSelectionChangeRef.current(imageId);
    }, []);

    const closeSelectedImage = (): void => {
        void requestSelectionChangeRef.current(null);
    };

    const openThumbnailContextMenu = React.useCallback((e: React.MouseEvent, imageId: number): void => {
        e.preventDefault();
        e.stopPropagation();
        setContextMenu({
            x: e.clientX,
            y: e.clientY,
            imageId,
        });
    }, []);

    const handleGridKeyDown = React.useCallback((e: React.KeyboardEvent<HTMLDivElement>): void => {
        const isArrow = e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown';
        if (!isArrow || !visibleImages.length) {
            return;
        }
        e.preventDefault();

        const currentIndex = selectedId !== null
            ? visibleImages.findIndex(img => img.id === selectedId)
            : -1;

        if (currentIndex === -1) {
            const firstId = visibleImages[0].id;
            void requestSelectionChangeRef.current(firstId).then(proceeded => {
                if (proceeded) {
                    gridRef.current?.querySelector<HTMLElement>(`[data-image-id="${firstId}"]`)?.focus();
                }
            });
            return;
        }

        let nextIndex: number;
        if (e.key === 'ArrowLeft') {
            nextIndex = Math.max(0, currentIndex - 1);
        } else if (e.key === 'ArrowRight') {
            nextIndex = Math.min(visibleImages.length - 1, currentIndex + 1);
        } else {
            const colCount = gridRef.current
                ? window.getComputedStyle(gridRef.current).gridTemplateColumns.split(' ').length
                : 1;
            nextIndex = e.key === 'ArrowUp'
                ? Math.max(0, currentIndex - colCount)
                : Math.min(visibleImages.length - 1, currentIndex + colCount);
        }

        if (nextIndex !== currentIndex) {
            const targetId = visibleImages[nextIndex].id;
            void requestSelectionChangeRef.current(targetId).then(proceeded => {
                if (proceeded) {
                    gridRef.current?.querySelector<HTMLElement>(`[data-image-id="${targetId}"]`)?.focus();
                }
            });
        }
    }, [selectedId, visibleImages]);

    const isUploadedImage = React.useCallback((img: GeocacheImageV2Dto | null | undefined): boolean => {
        return Boolean((img?.source_url || '').startsWith('geoapp-upload://'));
    }, []);

    const getChatImageOrigin = React.useCallback((img: GeocacheImageV2Dto): 'user_observation' | 'cache_listing' => {
        return isUploadedImage(img) ? 'user_observation' : 'cache_listing';
    }, [isUploadedImage]);

    const getChatImageOriginLabel = React.useCallback((img: GeocacheImageV2Dto): string => {
        return getChatImageOrigin(img) === 'user_observation' ? 'Photo utilisateur locale' : 'Image du listing';
    }, [getChatImageOrigin]);

    React.useEffect(() => {
        if (!onAnalyzeImages || initializedChatSelectionForRef.current === geocacheId || !visibleImages.length) {
            return;
        }
        initializedChatSelectionForRef.current = geocacheId;
        const priority: Record<'user_observation' | 'cache_listing', number> = {
            user_observation: 0,
            cache_listing: 1,
        };
        const persistedImageIds = readPersistedChatImageIds().filter(id => selectableChatImageIds.has(id));
        if (persistedImageIds.length) {
            setChatImageIds(persistedImageIds);
            persistChatImageIds(persistedImageIds);
            warnIfChatSelectionIsHeavy(persistedImageIds.length);
            return;
        }
        const defaultImageIds = visibleImages
            .filter(image => Boolean(image.url) && getChatImageOrigin(image) === 'user_observation')
            .map((image, index) => ({ image, index }))
            .sort((left, right) => {
                const priorityDelta = priority[getChatImageOrigin(left.image)] - priority[getChatImageOrigin(right.image)];
                return priorityDelta || left.index - right.index;
            })
            .slice(0, maxChatImages)
            .map(item => item.image.id);
        if (defaultImageIds.length) {
            setChatImageIds(defaultImageIds);
            persistChatImageIds(defaultImageIds);
        }
    }, [geocacheId, getChatImageOrigin, maxChatImages, onAnalyzeImages, persistChatImageIds, readPersistedChatImageIds, selectableChatImageIds, visibleImages, warnIfChatSelectionIsHeavy]);

    const isRemoteOriginalImage = React.useCallback((img: GeocacheImageV2Dto | null | undefined): boolean => {
        if (!img || img.parent_image_id) {
            return false;
        }
        return /^https?:\/\//i.test((img.source_url || '').trim());
    }, []);

    const canStoreImage = React.useCallback((img: GeocacheImageV2Dto | null | undefined): boolean => {
        return Boolean(img && !img.stored && isRemoteOriginalImage(img));
    }, [isRemoteOriginalImage]);

    const canUnstoreImage = React.useCallback((img: GeocacheImageV2Dto | null | undefined): boolean => {
        return Boolean(img?.stored && isRemoteOriginalImage(img));
    }, [isRemoteOriginalImage]);

    const canDeleteImage = React.useCallback((img: GeocacheImageV2Dto | null | undefined): boolean => {
        return Boolean(img && (Boolean(img.parent_image_id) || isUploadedImage(img)));
    }, [isUploadedImage]);

    const isMissingLocalImage = React.useCallback((img: GeocacheImageV2Dto | null | undefined): boolean => {
        return Boolean(img && !img.stored && (Boolean(img.parent_image_id) || isUploadedImage(img)));
    }, [isUploadedImage]);

    const isAnimatedGifImage = React.useCallback((img: GeocacheImageV2Dto | null | undefined): boolean => {
        // Vérifier d'abord le mime_type si disponible
        if (img?.mime_type) {
            const mime = img.mime_type.toLowerCase();
            if (mime === 'image/gif') {
                return true;
            }
        }
        // Fallback: détection par extension de fichier dans l'URL
        const url = (img?.source_url || img?.url || '').toLowerCase();
        if (url) {
            // Extraire l'extension avant les paramètres de requête
            const urlWithoutParams = url.split('?')[0];
            if (urlWithoutParams.endsWith('.gif')) {
                return true;
            }
        }
        return false;
    }, []);

    const splitAnimatedGif = React.useCallback(async (imageId: number): Promise<void> => {
        const img = visibleImages.find(i => i.id === imageId);
        if (!img) {
            messages.error('Image introuvable');
            return;
        }

        if (!isAnimatedGifImage(img)) {
            messages.error('Cette image n\'est pas un GIF');
            return;
        }

        setBusyImage(imageId, true);
        messages.info('Découpage du GIF en cours...');

        try {
            const splitRes = await fetch(`${backendBaseUrl}/api/geocache-images/${imageId}/split-gif`, {
                method: 'POST',
                credentials: 'include',
            });

            if (!splitRes.ok) {
                const errorData = await splitRes.json().catch(() => ({ error: 'Erreur inconnue' })) as { error?: string; frames?: number };
                if (errorData.frames !== undefined && errorData.frames <= 1) {
                    messages.info('Ce GIF ne contient pas d\'animation multiple');
                    return;
                }
                throw new Error(errorData.error || `HTTP ${splitRes.status}`);
            }

            const result = await splitRes.json() as { frames?: number; created_ids?: number[] };

            await loadImages();
            messages.info(`${result.frames || 0} frames extraites (${result.created_ids?.length || 0} images créées)`);
        } catch (e) {
            console.error('[GeocacheImagesPanel] split GIF error', e);
            messages.error(`Impossible de découper le GIF: ${String(e)}`);
        } finally {
            setBusyImage(imageId, false);
        }
    }, [backendBaseUrl, messages, isAnimatedGifImage, visibleImages, loadImages, setBusyImage]);

    // Fonctions pour le visualiseur de GIF frame par frame
    const openGifFrameViewer = React.useCallback(async (imageId: number): Promise<void> => {
        const img = visibleImages.find(i => i.id === imageId);
        if (!img) {
            messages.error('Image introuvable');
            return;
        }

        if (!isAnimatedGifImage(img)) {
            messages.error('Cette image n\'est pas un GIF');
            return;
        }

        setGifFrameViewerLoading(true);
        setGifFrameViewerImage(img);
        setGifFrameViewerOpen(true);
        setGifFrameViewerCurrentFrame(0);
        setGifFrameViewerFrames([]);

        try {
            // Appeler le backend pour extraire les frames
            const response = await fetch(`${backendBaseUrl}/api/geocache-images/${imageId}/extract-frames`, {
                method: 'POST',
                credentials: 'include',
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ error: 'Erreur inconnue' })) as { error?: string };
                throw new Error(errorData.error || `HTTP ${response.status}`);
            }

            const result = await response.json() as { frames: string[]; count: number };
            setGifFrameViewerFrames(result.frames);
            messages.info(`${result.count} frames chargées`);
        } catch (e) {
            console.error('[GeocacheImagesPanel] GIF frame viewer error', e);
            messages.error(`Impossible de charger les frames: ${String(e)}`);
            setGifFrameViewerOpen(false);
        } finally {
            setGifFrameViewerLoading(false);
        }
    }, [backendBaseUrl, messages, isAnimatedGifImage, visibleImages]);

    const closeGifFrameViewer = React.useCallback((): void => {
        setGifFrameViewerOpen(false);
        setGifFrameViewerImage(null);
        setGifFrameViewerFrames([]);
        setGifFrameViewerCurrentFrame(0);
    }, []);

    const goToNextFrame = React.useCallback((): void => {
        setGifFrameViewerCurrentFrame(prev =>
            prev < gifFrameViewerFrames.length - 1 ? prev + 1 : prev
        );
    }, [gifFrameViewerFrames.length]);

    const goToPrevFrame = React.useCallback((): void => {
        setGifFrameViewerCurrentFrame(prev => prev > 0 ? prev - 1 : prev);
    }, []);

    // Navigation au clavier pour le visualiseur de GIF
    React.useEffect(() => {
        if (!gifFrameViewerOpen) {
            return;
        }

        const handleKeyDown = (e: KeyboardEvent): void => {
            if (e.key === 'ArrowLeft') {
                goToPrevFrame();
            } else if (e.key === 'ArrowRight') {
                goToNextFrame();
            } else if (e.key === 'Escape') {
                closeGifFrameViewer();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [gifFrameViewerOpen, goToPrevFrame, goToNextFrame, closeGifFrameViewer]);

    const getImageKindLabel = React.useCallback((img: GeocacheImageV2Dto): string => {
        if (isUploadedImage(img)) {
            return 'Ajout manuel';
        }
        if (img.derivation_type?.startsWith('edited')) {
            return 'Image éditée';
        }
        if (img.derivation_type?.startsWith('snippet')) {
            return 'Sous-image';
        }
        if (img.derivation_type?.startsWith('copy')) {
            return 'Copie';
        }
        if (img.parent_image_id) {
            return 'Dérivée';
        }
        if (img.image_type === 'spoiler') {
            return 'Spoiler';
        }
        if (img.image_type === 'owner') {
            return 'Image propriétaire';
        }
        return 'Image du listing';
    }, [isUploadedImage]);

    const getImageTitle = React.useCallback((img: GeocacheImageV2Dto): string => {
        const title = (img.title || '').trim();
        return title || `Image #${img.id}`;
    }, []);

    const formatByteSize = React.useCallback((value?: number | null): string => {
        if (!value || value <= 0) {
            return 'taille inconnue';
        }
        if (value < 1024) {
            return `${value} o`;
        }
        if (value < 1024 * 1024) {
            return `${(value / 1024).toFixed(1)} Ko`;
        }
        return `${(value / (1024 * 1024)).toFixed(1)} Mo`;
    }, []);

    const readResponseError = async (res: Response): Promise<string> => {
        try {
            const data = await res.json() as any;
            if (data?.error) {
                return String(data.error);
            }
        } catch {
        }
        try {
            const txt = await res.text();
            if (txt) {
                return txt;
            }
        } catch {
        }
        return `HTTP ${res.status}`;
    };

    const uploadNewImage = async (file: File, reloadAfterUpload: boolean = true): Promise<GeocacheImageV2Dto | undefined> => {
        if (!file) {
            return undefined;
        }

        // Note : isSaving est géré par l'appelant (uploadNewImages), pas ici,
        // pour éviter le clignotement du flag entre chaque fichier d'un upload
        // multiple.
        try {
            const formData = new FormData();
            formData.append('image_file', file);

            const res = await fetch(`${backendBaseUrl}/api/geocaches/${geocacheId}/images/upload`, {
                method: 'POST',
                credentials: 'include',
                body: formData,
            });

            if (!res.ok) {
                let errorMsg = `HTTP ${res.status}`;
                try {
                    const errorData = await res.json() as any;
                    if (errorData?.error) {
                        errorMsg = String(errorData.error);
                    }
                } catch {
                    try {
                        const txt = await res.text();
                        if (txt) {
                            errorMsg = txt;
                        }
                    } catch {
                    }
                }
                throw new Error(errorMsg);
            }

            const created = (await res.json()) as GeocacheImageV2Dto;

            setSelectedId(created.id);
            setDetailsMode('fields');
            if (reloadAfterUpload) {
                await loadImages();
                messages.info('Image ajoutee');
            }
            return created;
        } catch (e) {
            console.error('[GeocacheImagesPanel] upload image error', e);
            messages.error(`Impossible d'ajouter l'image (${String(e)})`);
            return undefined;
        }
    };

    const uploadNewImages = async (files: File[]): Promise<void> => {
        const validFiles = files.filter(Boolean);
        if (!validFiles.length) {
            return;
        }

        setIsSaving(true);
        try {
            if (validFiles.length === 1) {
                await uploadNewImage(validFiles[0]);
                return;
            }

            const createdIds: number[] = [];
            for (const file of validFiles) {
                const created = await uploadNewImage(file, false);
                if (created?.id) {
                    createdIds.push(created.id);
                }
            }
            const loadedImages = await loadImages();
            if (createdIds.length) {
                setSelectedId(createdIds[createdIds.length - 1]);
                setDetailsMode('fields');
                // Calculer le set sélectionnable à partir des données fraîchement
                // chargées, pas depuis la closure périmée (selectableChatImageIds
                // capturé au moment de l'appel, avant que loadImages ne mette à
                // jour le state).
                const freshSelectableIds = new Set(
                    loadedImages
                        .filter(img => Boolean(img.url))
                        .map(img => img.id)
                );
                setChatImageIds(prev => {
                    const current = prev.filter(id => freshSelectableIds.has(id));
                    const next = [...current, ...createdIds.filter(id => !current.includes(id))];
                    warnIfChatSelectionIsHeavy(next.length);
                    persistChatImageIds(next);
                    return next;
                });
            }
            const failedCount = validFiles.length - createdIds.length;
            if (createdIds.length === 0) {
                messages.error(`Aucune image n'a pu être ajoutée (${failedCount} échec(s))`);
            } else if (failedCount > 0) {
                messages.warn(`${createdIds.length} image(s) ajoutée(s), ${failedCount} échec(s)`);
            } else {
                messages.info(`${createdIds.length} image(s) ajoutée(s)`);
            }
        } finally {
            setIsSaving(false);
        }
    };

    const canSearchImageOnGoogle = React.useCallback((img: GeocacheImageV2Dto | null): boolean => {
        return isRemoteOriginalImage(img);
    }, [isRemoteOriginalImage]);

    const searchImageOnGoogleById = async (imageId: number): Promise<void> => {
        const img = visibleImages.find(i => i.id === imageId);
        if (!img || !canSearchImageOnGoogle(img)) {
            return;
        }

        const rawUrl = (img.source_url || '').trim();
        if (!rawUrl || !/^https?:\/\//i.test(rawUrl)) {
            return;
        }

        const lensUrl = `https://lens.google.com/uploadbyurl?url=${encodeURIComponent(rawUrl)}`;
        try {
            window.open(lensUrl, '_blank', 'noopener,noreferrer');
        } catch (e) {
            console.error('[GeocacheImagesPanel] google lens open error', e);
        }
    };

    const triggerUploadDialog = (): void => {
        uploadInputRef.current?.click();
    };

    const toggleChatImage = React.useCallback((imageId: number): void => {
        setChatImageIds(prev => {
            const current = prev.filter(id => selectableChatImageIds.has(id));
            if (current.includes(imageId)) {
                const next = current.filter(id => id !== imageId);
                if (next.length <= maxChatImages) {
                    didWarnChatImageLimitRef.current = false;
                }
                persistChatImageIds(next);
                return next;
            }
            const next = [...current, imageId];
            warnIfChatSelectionIsHeavy(next.length);
            persistChatImageIds(next);
            return next;
        });
    }, [maxChatImages, persistChatImageIds, selectableChatImageIds, warnIfChatSelectionIsHeavy]);

    const clearChatImages = (): void => {
        didWarnChatImageLimitRef.current = false;
        persistChatImageIds([]);
        setChatImageIds([]);
    };

    const analyzeChatImages = async (): Promise<void> => {
        if (!onAnalyzeImages || chatImageIds.length === 0) {
            return;
        }
        const selectedImageDtos = chatImageIds
            .filter(id => selectableChatImageIds.has(id))
            .map(id => visibleImages.find(image => image.id === id))
            .filter((image): image is GeocacheImageV2Dto => Boolean(image));
        const selectedImages: GeocacheImageChatSelection[] = [];
        setIsSaving(true);
        try {
            for (const image of selectedImageDtos) {
                let preparedImage = image;
                if (canStoreImage(image)) {
                    try {
                        const storeRes = await fetch(`${backendBaseUrl}/api/geocache-images/${image.id}/store`, {
                            method: 'POST',
                            credentials: 'include',
                        });
                        if (storeRes.ok) {
                            preparedImage = (await storeRes.json()) as GeocacheImageV2Dto;
                            setImages(prev => prev.map(existing => existing.id === preparedImage.id ? preparedImage : existing));
                        } else {
                            messages.warn(`Impossible de stocker l'image ${image.id}; elle sera tentee via son URL distante.`);
                        }
                    } catch {
                        messages.warn(`Impossible de stocker l'image ${image.id}; elle sera tentee via son URL distante.`);
                    }
                }
                selectedImages.push({
                    id: preparedImage.id,
                    url: preparedImage.url ? resolveImageUrl(preparedImage.url) : '',
                    source_url: preparedImage.source_url || '',
                    origin: getChatImageOrigin(preparedImage),
                    originLabel: getChatImageOriginLabel(preparedImage),
                    title: preparedImage.title,
                    note: preparedImage.note,
                });
            }
        } finally {
            setIsSaving(false);
        }
        const sendableImages = selectedImages.filter(image => Boolean(image.url));
        if (!sendableImages.length) {
            messages.warn('Aucune image selectionnee ne peut etre envoyee au chat.');
            return;
        }
        await Promise.resolve(onAnalyzeImages(sendableImages));
    };

    const duplicateImageById = async (imageId: number): Promise<void> => {
        setBusyImage(imageId, true);
        try {
            const source = images.find(i => i.id === imageId) ?? visibleImages.find(i => i.id === imageId);
            if (source && canStoreImage(source)) {
                const storeRes = await fetch(`${backendBaseUrl}/api/geocache-images/${imageId}/store`, {
                    method: 'POST',
                    credentials: 'include',
                });
                if (!storeRes.ok) {
                    throw new Error(await readResponseError(storeRes));
                }
            }

            const res = await fetch(`${backendBaseUrl}/api/geocache-images/${imageId}/duplicate`, {
                method: 'POST',
                credentials: 'include',
            });
            if (!res.ok) {
                throw new Error(await readResponseError(res));
            }
            const created = (await res.json()) as GeocacheImageV2Dto;
            setSelectedId(created.id);
            setDetailsMode('fields');
            await loadImages();
            messages.info('Image dupliquée');
        } catch (e) {
            console.error('[GeocacheImagesPanel] duplicate image error', e);
            messages.error(`Impossible de dupliquer l'image : ${String(e)}`);
        } finally {
            setBusyImage(imageId, false);
        }
    };

    const extractTextFromPluginResult = (result: any): string => {
        if (!result) {
            return '';
        }
        const items = Array.isArray(result.results) ? result.results : [];
        const texts = items
            .map((item: any) => (item?.text_output ?? '').toString())
            .map((t: string) => t.trim())
            .filter((t: string) => Boolean(t));

        if (texts.length > 0) {
            return texts.join('\n\n');
        }

        const legacy = (result.text_output ?? '').toString().trim();
        return legacy;
    };

    const stripThinkingBlocks = (value: string): string => {
        const raw = (value ?? '').toString();
        if (!raw.trim()) {
            return '';
        }
        return raw
            .replace(/\[THINK\][\s\S]*?\[\/THINK\]/gi, '')
            .replace(/<think>[\s\S]*?<\/think>/gi, '')
            .replace(/\[ANALYSIS\][\s\S]*?\[\/ANALYSIS\]/gi, '')
            .replace(/<analysis>[\s\S]*?<\/analysis>/gi, '')
            .trim();
    };

    const getExifFeature = React.useCallback((img: GeocacheImageV2Dto | null | undefined): any => {
        const features = img?.detected_features;
        if (!features || typeof features !== 'object') {
            return null;
        }
        return (features as Record<string, unknown>).exif_reader ?? null;
    }, []);

    const formatExifFeatureForDisplay = React.useCallback((feature: any): string => {
        if (!feature || typeof feature !== 'object') {
            return '';
        }
        const lines: string[] = [];
        const summary = (feature.summary ?? '').toString().trim();
        if (summary) {
            lines.push(summary);
        }
        const gpsItems = Array.isArray(feature.gps_coordinates) ? feature.gps_coordinates : [];
        for (const gps of gpsItems) {
            const formatted = (gps?.formatted ?? gps?.decimal ?? '').toString().trim();
            if (formatted) {
                lines.push(`GPS: ${formatted}`);
            }
        }
        const exifItems = Array.isArray(feature.exif) ? feature.exif : [];
        for (const item of exifItems) {
            const tags = item?.interesting_tags && typeof item.interesting_tags === 'object'
                ? item.interesting_tags as Record<string, unknown>
                : {};
            for (const [key, value] of Object.entries(tags)) {
                if (key === 'GPSInfo') {
                    continue;
                }
                const rendered = typeof value === 'string' ? value : JSON.stringify(value);
                if (rendered && rendered !== 'null' && rendered !== 'undefined') {
                    lines.push(`${key}: ${rendered}`);
                }
            }
        }
        return lines.length ? lines.join('\n') : JSON.stringify(feature, null, 2);
    }, []);

    const hasUsefulExifFeature = React.useCallback((img: GeocacheImageV2Dto | null | undefined): boolean => {
        const feature = getExifFeature(img);
        if (!feature || typeof feature !== 'object') {
            return false;
        }
        const exifItems = Array.isArray(feature.exif) ? feature.exif : [];
        const gpsItems = Array.isArray(feature.gps_coordinates) ? feature.gps_coordinates : [];
        const hasExifTags = exifItems.some((item: any) => {
            const tags = item?.tags && typeof item.tags === 'object' ? item.tags : {};
            return Object.keys(tags).length > 0;
        });
        return hasExifTags || gpsItems.length > 0;
    }, [getExifFeature]);

    const blobToBase64 = async (blob: Blob): Promise<string> => {
        return await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onerror = () => reject(new Error('Failed to read image blob'));
            reader.onload = () => {
                const val = (reader.result ?? '').toString();
                const commaIdx = val.indexOf(',');
                if (commaIdx >= 0) {
                    resolve(val.slice(commaIdx + 1));
                } else {
                    resolve(val);
                }
            };
            reader.readAsDataURL(blob);
        });
    };

    const runCloudOcrForImage = async (imageId: number): Promise<void> => {
        const img = visibleImages.find(i => i.id === imageId);
        if (!img) {
            return;
        }

        const abortController = createOcrAbortController(imageId);
        setOcrInProgress(imageId, true);
        try {
            let imageUrlForFetch = resolveImageUrl(img.url);

            if (!img.stored) {
                if (!canStoreImage(img)) {
                    messages.error('Cette image n\'a pas de fichier local exploitable.');
                    setSelectedId(imageId);
                    setDetailsMode('fields');
                    return;
                }
                try {
                    const storeRes = await fetch(`${backendBaseUrl}/api/geocache-images/${imageId}/store`, {
                        method: 'POST',
                        credentials: 'include',
                    });
                    if (storeRes.ok) {
                        const storedImage = (await storeRes.json()) as GeocacheImageV2Dto;
                        imageUrlForFetch = resolveImageUrl(storedImage.url);
                    } else {
                        // Store échoué : utiliser le proxy backend /raw qui
                        // télécharge l'image côté serveur (évite les erreurs
                        // CORS d'un fetch direct d'URL distante depuis le
                        // navigateur).
                        imageUrlForFetch = `${backendBaseUrl}/api/geocache-images/${imageId}/raw`;
                    }
                } catch {
                    imageUrlForFetch = `${backendBaseUrl}/api/geocache-images/${imageId}/raw`;
                }
            }

            const imageRes = await fetch(imageUrlForFetch, { credentials: 'include', signal: abortController.signal });
            if (!imageRes.ok) {
                throw new Error(`HTTP ${imageRes.status}`);
            }

            const blob = await imageRes.blob();
            const mimeType = blob.type || (imageRes.headers.get('content-type') || '').split(';')[0].trim() || 'image/png';
            const base64data = await blobToBase64(blob);

            const languageModel = await languageModelRegistry.selectLanguageModel({
                agent: 'geoapp-ocr',
                purpose: 'vision-ocr',
                identifier: 'default/universal'
            });

            if (!languageModel) {
                messages.error('Aucun modèle IA n\'est configuré pour l\'OCR (vérifie la configuration IA de Theia)');
                return;
            }

            const prompt = 'Transcris précisément le texte visible sur cette image sans interprétation ni correction orthographique. Respecte les retours à la ligne.';
            const request: UserRequest = {
                messages: [
                    { actor: 'user', type: 'image', image: { base64data, mimeType } },
                    { actor: 'user', type: 'text', text: prompt },
                ],
                agentId: 'geoapp-ocr',
                requestId: `geoapp-ocr-${Date.now()}`,
                sessionId: `geoapp-ocr-session-${Date.now()}`,
            };

            const response = await languageModelService.sendRequest(languageModel, request);
            let text = '';
            if (isLanguageModelParsedResponse(response)) {
                text = JSON.stringify(response.parsed);
            } else {
                try {
                    text = await getTextOfResponse(response);
                } catch {
                    const jsonResponse = await getJsonOfResponse(response) as any;
                    text = typeof jsonResponse === 'string' ? jsonResponse : String(jsonResponse);
                }
            }

            text = stripThinkingBlocks((text || '').toString());
            if (!text) {
                messages.warn('OCR IA: réponse vide');
                setSelectedId(imageId);
                setDetailsMode('fields');
                return;
            }

            setSelectedId(imageId);
            setDetailsMode('fields');
            const updated = await patchImage(imageId, {
                ocr_text: text,
                ocr_language: (ocrDefaultLanguage || 'auto').toString(),
            });
            if (updated) {
                setDraftOcr(updated.ocr_text ?? text);
                clearDirtyField('ocr');
            }
        } catch (e) {
            if ((e as Error).name === 'AbortError') {
                return;
            }
            console.error('[GeocacheImagesPanel] cloud ocr error', e);
            messages.error(`OCR IA: erreur (${String(e)})`);
        } finally {
            setOcrInProgress(imageId, false);
        }
    };

    const runOcrPluginForImage = async (imageId: number, pluginName: 'easyocr_ocr' | 'vision_ocr'): Promise<void> => {
        const img = visibleImages.find(i => i.id === imageId);
        if (!img) {
            return;
        }

        const abortController = createOcrAbortController(imageId);
        setOcrInProgress(imageId, true);
        try {
            let imageUrlForPlugin = resolveImageUrl(img.url);

            // If the image isn't stored, /content returns 404 JSON and OCR receives non-image bytes.
            // We store the image first so the backend can serve a proper binary.
            if (!img.stored) {
                if (!canStoreImage(img)) {
                    messages.error('Cette image n\'a pas de fichier local exploitable.');
                    setSelectedId(imageId);
                    setDetailsMode('fields');
                    return;
                }
                try {
                    const storeRes = await fetch(`${backendBaseUrl}/api/geocache-images/${imageId}/store`, {
                        method: 'POST',
                        credentials: 'include',
                    });
                    if (storeRes.ok) {
                        const storedImage = (await storeRes.json()) as GeocacheImageV2Dto;
                        imageUrlForPlugin = resolveImageUrl(storedImage.url);
                    } else {
                        // Fallback to source_url if storage fails
                        imageUrlForPlugin = resolveImageUrl((img.source_url || img.url) as string);
                    }
                } catch {
                    imageUrlForPlugin = resolveImageUrl((img.source_url || img.url) as string);
                }
            }

            const inputs: Record<string, any> = {
                geocache_id: geocacheId,
                images: [{ url: imageUrlForPlugin }],
                language: (ocrDefaultLanguage || 'auto').toString(),
            };

            if (pluginName === 'vision_ocr') {
                inputs.provider = ocrVisionProvider === 'openrouter' ? 'openrouter' : 'lmstudio';
                if (inputs.provider === 'openrouter') {
                    inputs.model = (ocrOpenRouterModel || 'openai/gpt-4o-mini').toString();
                } else {
                    inputs.base_url = (ocrLmstudioBaseUrl || 'http://localhost:1234').toString();
                    inputs.model = (ocrLmstudioModel || '').toString();
                }
            }

            const res = await fetch(`${backendBaseUrl}/api/plugins/${pluginName}/execute`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ inputs }),
                signal: abortController.signal,
            });
            if (!res.ok) {
                throw new Error(await readResponseError(res));
            }

            const result = await res.json() as any;
            const text = stripThinkingBlocks(extractTextFromPluginResult(result));
            if (!text.trim()) {
                console.warn('[GeocacheImagesPanel] OCR returned empty text', {
                    pluginName,
                    imageId,
                    status: result?.status,
                    summary: result?.summary,
                    images_analyzed: result?.images_analyzed,
                    results_count: Array.isArray(result?.results) ? result.results.length : 0,
                });
                setSelectedId(imageId);
                setDetailsMode('fields');
                messages.info('OCR terminé sans texte détecté');
                return;
            }

            setSelectedId(imageId);
            setDetailsMode('fields');
            const updated = await patchImage(imageId, {
                ocr_text: text,
                ocr_language: (ocrDefaultLanguage || 'auto').toString(),
            });
            if (updated) {
                setDraftOcr(updated.ocr_text ?? text);
                clearDirtyField('ocr');
            }
        } catch (e) {
            if ((e as Error).name === 'AbortError') {
                return;
            }
            console.error('[GeocacheImagesPanel] ocr error', e);
            messages.error(`OCR: erreur (${String(e)})`);
        } finally {
            setOcrInProgress(imageId, false);
        }
    };

    const runDefaultOcrForImage = async (imageId: number): Promise<void> => {
        const engine = ocrDefaultEngine === 'vision_ocr' ? 'vision_ocr' : 'easyocr_ocr';
        await runOcrPluginForImage(imageId, engine);
    };

    const patchImage = async (imageId: number, payload: Partial<GeocacheImageV2Dto>, options: { silent?: boolean } = {}): Promise<GeocacheImageV2Dto | null> => {
        try {
            const res = await fetch(`${backendBaseUrl}/api/geocache-images/${imageId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify(payload),
            });
            if (!res.ok) {
                throw new Error(await readResponseError(res));
            }
            const updated = (await res.json()) as GeocacheImageV2Dto;
            setImages(prev => prev.map(i => (i.id === updated.id ? updated : i)));
            return updated;
        } catch (e) {
            console.error('[GeocacheImagesPanel] patch image error', e);
            if (!options.silent) {
                messages.error(`Impossible d'enregistrer l'image : ${String(e)}`);
            }
            return null;
        }
    };

    const saveMetadata = async () => {
        if (!selected) {
            return;
        }
        setBusyImage(selected.id, true);
        try {
            const payload = {
                title: draftTitle,
                note: draftNote,
                qr_payload: draftQr,
                ocr_text: draftOcr
            };
            const updated = await patchImage(selected.id, payload);
            if (updated) {
                clearDirtyFields();
                messages.info('Métadonnées enregistrées');
            }
        } catch (e) {
            console.error('[GeocacheImagesPanel] save metadata error', e);
        } finally {
            setBusyImage(selected.id, false);
        }
    };

    // Garde-fou avant de changer d'image ou de fermer l'aperçu : propose
    // d'enregistrer, d'abandonner ou d'annuler quand des champs sont modifiés.
    // Retourne true si le changement a eu lieu, false si l'utilisateur a annulé.
    const requestSelectionChange = async (imageId: number | null): Promise<boolean> => {
        if (dirtyFields.size > 0 && selected) {
            const choice = await new ConfirmSaveDialog({
                title: 'Modifications non enregistrées',
                msg: `Enregistrer les modifications de « ${getImageTitle(selected)} » avant de changer d'image ?`,
                cancel: 'Annuler',
                dontSave: 'Ne pas enregistrer',
                save: 'Enregistrer',
            }).open();
            if (choice === undefined) {
                return false;
            }
            if (choice === true) {
                await saveMetadata();
            }
        }
        if (imageId === null) {
            setSelectedId(null);
            setDetailsMode('hidden');
        } else {
            setSelectedId(imageId);
            setDetailsMode('fields');
        }
        return true;
    };
    requestSelectionChangeRef.current = requestSelectionChange;

    const decodeQrFromImage = async (imageId: number): Promise<void> => {
        const img = visibleImages.find(i => i.id === imageId);
        if (!img) {
            console.warn('[GeocacheImagesPanel] decodeQrFromImage: image not found', imageId);
            return;
        }

        setBusyImage(imageId, true);
        const progress = await messages.showProgress(
            { text: 'Décodage QR…', options: { cancelable: false, location: 'notification' } }
        );
        try {
            progress.report({ message: 'Analyse de l\'image…' });
            let imageUrlForPlugin = resolveImageUrl(img.url);
            if (!img.stored) {
                if (!canStoreImage(img)) {
                    messages.error('Cette image n\'a pas de fichier local exploitable.');
                    setSelectedId(imageId);
                    setDetailsMode('fields');
                    return;
                }
                const storeRes = await fetch(`${backendBaseUrl}/api/geocache-images/${imageId}/store`, {
                    method: 'POST',
                    credentials: 'include',
                });
                if (!storeRes.ok) {
                    throw new Error(await readResponseError(storeRes));
                }
                const storedImage = (await storeRes.json()) as GeocacheImageV2Dto;
                imageUrlForPlugin = resolveImageUrl(storedImage.url);
                setImages(prev => prev.map(i => (i.id === storedImage.id ? storedImage : i)));
            }
            const res = await fetch(`${backendBaseUrl}/api/plugins/qr_code_detector/execute`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    inputs: {
                        geocache_id: geocacheId,
                        images: [{ url: imageUrlForPlugin }],
                    }
                }),
            });
            if (!res.ok) {
                throw new Error(`HTTP ${res.status}`);
            }
            const result = await res.json() as any;

            // Vérifier si le plugin a retourné une erreur
            if (result?.status === 'error') {
                const errorMsg = result?.error || 'Erreur inconnue du plugin QR';
                console.error('[GeocacheImagesPanel] decodeQrFromImage: plugin error', errorMsg);
                messages.error(`Erreur plugin QR: ${errorMsg}`);
                return;
            }

            const qrPayload: string | undefined = result?.qr_codes?.[0]?.data;
            if (!qrPayload || !String(qrPayload).trim()) {
                console.warn('[GeocacheImagesPanel] decodeQrFromImage: no QR code detected in image', imageId);
                messages.info('Aucun QR code détecté dans cette image');
                return;
            }

            progress.report({ message: 'Enregistrement…' });
            setSelectedId(imageId);
            setDetailsMode('fields');
            const qrUpdated = await patchImage(imageId, { qr_payload: String(qrPayload) });
            if (qrUpdated) {
                setDraftQr(qrUpdated.qr_payload ?? String(qrPayload));
                clearDirtyField('qr');
            }
            messages.info(`QR code décodé: ${String(qrPayload).substring(0, 50)}${String(qrPayload).length > 50 ? '...' : ''}`);
        } catch (e) {
            console.error('[GeocacheImagesPanel] decode qr error', e);
            messages.error(`Erreur décodage QR: ${String(e)}`);
        } finally {
            progress.cancel();
            setBusyImage(imageId, false);
        }
    };

    const readExifFromImage = async (imageId: number, options: ExifReadOptions = {}): Promise<void> => {
        const img = images.find(i => i.id === imageId) ?? visibleImages.find(i => i.id === imageId);
        if (!img) {
            console.warn('[GeocacheImagesPanel] readExifFromImage: image not found', imageId);
            return;
        }

        const silent = Boolean(options.silent);
        const preserveSelection = Boolean(options.preserveSelection);
        if (!silent) {
            setBusyImage(imageId, true);
        }
        const progress = silent
            ? null
            : await messages.showProgress(
                { text: 'Lecture Exif...', options: { cancelable: false, location: 'notification' } }
            );
        try {
            progress?.report({ message: 'Preparation de l\'image...' });
            let imageUrlForPlugin = resolveImageUrl(img.url || img.source_url);
            if (!imageUrlForPlugin && !img.stored) {
                if (!canStoreImage(img)) {
                    if (!silent) {
                        messages.error('Cette image n\'a pas de fichier local exploitable.');
                        setSelectedId(imageId);
                        setDetailsMode('fields');
                    }
                    return;
                }
                const storeRes = await fetch(`${backendBaseUrl}/api/geocache-images/${imageId}/store`, {
                    method: 'POST',
                    credentials: 'include',
                });
                if (!storeRes.ok) {
                    throw new Error(await readResponseError(storeRes));
                }
                const storedImage = (await storeRes.json()) as GeocacheImageV2Dto;
                imageUrlForPlugin = resolveImageUrl(storedImage.url);
                setImages(prev => prev.map(i => (i.id === storedImage.id ? storedImage : i)));
            }

            progress?.report({ message: 'Lecture des metadonnees...' });
            const res = await fetch(`${backendBaseUrl}/api/plugins/exif_reader/execute`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    inputs: {
                        geocache_id: geocacheId,
                        images: [{ url: imageUrlForPlugin }],
                    }
                }),
            });
            if (!res.ok) {
                throw new Error(await readResponseError(res));
            }

            const result = await res.json() as any;
            if (result?.status === 'error') {
                throw new Error((result?.summary || result?.error || 'Erreur inconnue du plugin Exif').toString());
            }

            const exifFeature = {
                summary: result?.summary ?? '',
                exif: Array.isArray(result?.exif) ? result.exif : [],
                gps_coordinates: Array.isArray(result?.gps_coordinates) ? result.gps_coordinates : [],
                image_details: Array.isArray(result?.image_details) ? result.image_details : [],
                results: Array.isArray(result?.results) ? result.results : [],
                plugin_info: result?.plugin_info ?? null,
                analyzed_at: new Date().toISOString(),
            };
            const nextDetectedFeatures = {
                ...((img.detected_features && typeof img.detected_features === 'object') ? img.detected_features : {}),
                exif_reader: exifFeature,
            };

            if (!preserveSelection) {
                setSelectedId(imageId);
                setDetailsMode('fields');
            }
            const updated = await patchImage(imageId, { detected_features: nextDetectedFeatures }, { silent });
            if (updated && !silent) {
                if (exifFeature.gps_coordinates.length > 0) {
                    messages.info(`Exif lu: ${exifFeature.gps_coordinates.length} coordonnee(s) GPS detectee(s)`);
                } else if (exifFeature.exif.length > 0) {
                    messages.info('Exif lu: donnees trouvees, sans coordonnees GPS');
                } else {
                    messages.info('Aucune donnee Exif trouvee dans cette image');
                }
            }
        } catch (e) {
            console.error('[GeocacheImagesPanel] exif error', e);
            if (!silent) {
                messages.error(`Erreur lecture Exif: ${String(e)}`);
            }
        } finally {
            progress?.cancel();
            if (!silent) {
                setBusyImage(imageId, false);
            }
        }
    };

    React.useEffect(() => {
        if (isLoading || autoExifInProgressRef.current || !images.length) {
            return;
        }

        const candidates = images.filter(image => {
            if (autoExifImageIdsRef.current.has(image.id) || getExifFeature(image)) {
                return false;
            }
            if (!image.url && !image.source_url) {
                return false;
            }
            if (isMissingLocalImage(image)) {
                return false;
            }
            return true;
        });

        if (!candidates.length) {
            return;
        }

        candidates.forEach(image => autoExifImageIdsRef.current.add(image.id));
        autoExifInProgressRef.current = true;

        void (async () => {
            try {
                for (const image of candidates) {
                    await readExifFromImage(image.id, { silent: true, preserveSelection: true });
                }
            } finally {
                autoExifInProgressRef.current = false;
            }
        })();
    }, [getExifFeature, images, isLoading, isMissingLocalImage]);

    const copyQrPayload = async (imageId: number): Promise<void> => {
        const img = visibleImages.find(i => i.id === imageId);
        const payload = (img?.qr_payload || '').trim();
        if (!payload) {
            return;
        }
        try {
            await navigator.clipboard.writeText(payload);
        } catch (e) {
            console.error('[GeocacheImagesPanel] clipboard write error', e);
        }
    };

    const openImageEditor = (imageId: number): void => {
        const img = visibleImages.find(i => i.id === imageId);
        if (!img) {
            return;
        }

        window.dispatchEvent(new CustomEvent('open-geocache-image-editor', {
            detail: {
                backendBaseUrl,
                geocacheId,
                imageId,
                imageTitle: (img.title || '').trim() || undefined,
            }
        }));
    };

    const guessDownloadFilename = (img: GeocacheImageV2Dto): string => {
        const baseName = `image-${img.id}`;
        const tryExt = (value: string): string | null => {
            try {
                const url = new URL(value);
                const pathname = url.pathname || '';
                const match = pathname.match(/\.([a-zA-Z0-9]{2,5})$/);
                if (match && match[1]) {
                    return `.${match[1].toLowerCase()}`;
                }
            } catch {
            }
            return null;
        };

        const ext = tryExt(img.source_url) || tryExt(img.url) || '.jpg';
        return `${baseName}${ext}`;
    };

    const downloadImageById = async (imageId: number): Promise<void> => {
        const img = visibleImages.find(i => i.id === imageId);
        if (!img) {
            return;
        }

        if (!img.stored) {
            return;
        }

        const downloadUrl = resolveImageUrl(img.url);
        const filename = guessDownloadFilename(img);

        try {
            const res = await fetch(downloadUrl, {
                method: 'GET',
                credentials: 'include',
            });
            if (!res.ok) {
                throw new Error(`HTTP ${res.status}`);
            }
            const blob = await res.blob();
            const objectUrl = URL.createObjectURL(blob);
            try {
                const a = document.createElement('a');
                a.href = objectUrl;
                a.download = filename;
                a.rel = 'noopener';
                document.body.appendChild(a);
                a.click();
                a.remove();
            } finally {
                URL.revokeObjectURL(objectUrl);
            }
        } catch (e) {
            console.error('[GeocacheImagesPanel] download image error', e);
            try {
                window.open(downloadUrl, '_blank', 'noopener,noreferrer');
            } catch {
            }
        }
    };

    const storeImageById = async (imageId: number): Promise<void> => {
        const img = images.find(i => i.id === imageId) ?? visibleImages.find(i => i.id === imageId);
        if (!canStoreImage(img)) {
            return;
        }

        setBusyImage(imageId, true);
        try {
            const res = await fetch(`${backendBaseUrl}/api/geocache-images/${imageId}/store`, {
                method: 'POST',
                credentials: 'include'
            });
            if (!res.ok) {
                throw new Error(await readResponseError(res));
            }
            const updated = (await res.json()) as GeocacheImageV2Dto;
            setImages(prev => prev.map(i => (i.id === updated.id ? updated : i)));
            messages.info('Image stockée localement');
        } catch (e) {
            console.error('[GeocacheImagesPanel] store image error', e);
            messages.error(`Impossible de stocker l'image : ${String(e)}`);
        } finally {
            setBusyImage(imageId, false);
        }
    };

    const unstoreImageById = async (imageId: number): Promise<void> => {
        const img = images.find(i => i.id === imageId) ?? visibleImages.find(i => i.id === imageId);
        if (!canUnstoreImage(img)) {
            return;
        }

        setBusyImage(imageId, true);
        try {
            const res = await fetch(`${backendBaseUrl}/api/geocache-images/${imageId}/unstore`, {
                method: 'POST',
                credentials: 'include',
            });
            if (!res.ok) {
                throw new Error(await readResponseError(res));
            }
            const updated = (await res.json()) as GeocacheImageV2Dto;
            setImages(prev => prev.map(i => (i.id === updated.id ? updated : i)));
            messages.info('Stockage local supprimé');
        } catch (e) {
            console.error('[GeocacheImagesPanel] unstore image error', e);
            messages.error(`Impossible de supprimer le stockage local : ${String(e)}`);
        } finally {
            setBusyImage(imageId, false);
        }
    };

    const deleteImageById = async (imageId: number): Promise<void> => {
        const img = images.find(i => i.id === imageId) ?? visibleImages.find(i => i.id === imageId);
        if (!canDeleteImage(img)) {
            return;
        }

        const dialog = new ConfirmDialog({
            title: "Supprimer l'image",
            msg: `Supprimer ${img ? getImageTitle(img) : 'cette image'} et ses dérivés éventuels ?`,
        });
        const confirmed = await dialog.open();
        if (!confirmed) {
            return;
        }

        setBusyImage(imageId, true);
        try {
            const res = await fetch(`${backendBaseUrl}/api/geocache-images/${imageId}`, {
                method: 'DELETE',
                credentials: 'include',
            });
            if (!res.ok) {
                throw new Error(await readResponseError(res));
            }

            setImages(prev => prev.filter(i => i.id !== imageId));
            setSelectedId(prev => (prev === imageId ? null : prev));
            await loadImages();
            messages.info('Image supprimée');
        } catch (e) {
            console.error('[GeocacheImagesPanel] delete image error', e);
            messages.error(`Impossible de supprimer l'image : ${String(e)}`);
        } finally {
            setBusyImage(imageId, false);
        }
    };

    const storeSelected = async () => {
        if (!selected) {
            return;
        }
        await storeImageById(selected.id);
    };

    const storeAll = async () => {
        const imageIds = visibleImages
            .filter(img => canStoreImage(img))
            .map(img => img.id);

        if (!imageIds.length) {
            messages.info('Aucune image visible à stocker');
            return;
        }

        setIsSaving(true);
        try {
            const res = await fetch(`${backendBaseUrl}/api/geocaches/${geocacheId}/images/store`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ image_ids: imageIds }),
            });
            if (!res.ok) {
                throw new Error(await readResponseError(res));
            }
            const payload = await res.json() as { stored?: number; failed?: unknown[]; skipped?: unknown[] };
            await loadImages();
            if (payload.failed?.length) {
                messages.warn(`${payload.stored || 0} image(s) stockée(s), ${payload.failed.length} échec(s)`);
            } else {
                messages.info(`${payload.stored || 0} image(s) stockée(s)`);
            }
        } catch (e) {
            console.error('[GeocacheImagesPanel] store all images error', e);
            messages.error(`Impossible de stocker les images : ${String(e)}`);
        } finally {
            setIsSaving(false);
        }
    };

    const applyDefaultStorageMode = React.useCallback(async () => {
        if (!geocacheId) {
            return;
        }

        if (didApplyDefaultStorageRef.current[geocacheId]) {
            return;
        }

        if (!visibleImages.length) {
            return;
        }

        const pendingCount = visibleImages.filter(i => !i.stored).length;
        if (pendingCount <= 0) {
            didApplyDefaultStorageRef.current[geocacheId] = true;
            return;
        }

        if (storageDefaultMode === 'never') {
            didApplyDefaultStorageRef.current[geocacheId] = true;
            return;
        }

        if (storageDefaultMode === 'always') {
            didApplyDefaultStorageRef.current[geocacheId] = true;
            await storeAll();
            return;
        }

        // prompt
        didApplyDefaultStorageRef.current[geocacheId] = true;

        if (!onConfirmStoreAll) {
            return;
        }

        try {
            const shouldStore = await onConfirmStoreAll({ geocacheId, pendingCount });
            if (shouldStore) {
                await storeAll();
            }
        } catch (e) {
            console.error('[GeocacheImagesPanel] confirm store all error', e);
        }
    }, [geocacheId, onConfirmStoreAll, storageDefaultMode, visibleImages]);

    const saveHiddenDomains = async (): Promise<void> => {
        if (!onHiddenDomainsTextChange) {
            return;
        }
        setIsSavingHiddenDomains(true);
        try {
            await Promise.resolve(onHiddenDomainsTextChange(hiddenDomainsDraft));
        } catch (e) {
            console.error('[GeocacheImagesPanel] save hidden domains error', e);
        } finally {
            setIsSavingHiddenDomains(false);
        }
    };

    React.useEffect(() => {
        if (isLoading || isSaving) {
            return;
        }
        void applyDefaultStorageMode();
    }, [applyDefaultStorageMode, isLoading, isSaving]);

    // Spinner plein écran uniquement au premier chargement (aucune image à
    // afficher). Pendant un refresh (upload, duplication, suppression...), on
    // garde les images précédentes à l'écran pour éviter le flicker ; un
    // indicateur subtil dans le header signale la mise à jour en cours.
    if (isLoading && images.length === 0) {
        return <div className='geoapp-images-loading'>Chargement des images...</div>;
    }
    const isRefreshing = isLoading && images.length > 0;

    const selectedImage = selected;
    const showDetails = Boolean(selectedImage);
    const isContextMenuImageBusy = contextMenu ? (isImageBusy(contextMenu.imageId) || isSaving) : false;
    const contextMenuImage = contextMenu ? (visibleImages.find(i => i.id === contextMenu.imageId) ?? null) : null;
    const isContextMenuGoogleSearchEnabled = canSearchImageOnGoogle(contextMenuImage);
    const isContextMenuStoreEnabled = canStoreImage(contextMenuImage);
    const isContextMenuUnstoreEnabled = canUnstoreImage(contextMenuImage);
    const isContextMenuDeleteEnabled = canDeleteImage(contextMenuImage);
    const isContextMenuGifEnabled = isAnimatedGifImage(contextMenuImage);

    const contextMenuItems: ContextMenuItem[] = contextMenu ? [
        {
            label: 'Éditer l\'image…',
            action: () => { openImageEditor(contextMenu.imageId); },
            disabled: isContextMenuImageBusy,
        },
        {
            label: 'Dupliquer l\'image',
            action: () => { void duplicateImageById(contextMenu.imageId); },
            disabled: isContextMenuImageBusy,
        },
        {
            label: 'Télécharger l\'image',
            action: () => { void downloadImageById(contextMenu.imageId); },
            disabled: isContextMenuImageBusy || !Boolean(contextMenuImage?.stored),
        },
        {
            label: 'Rechercher sur Google (Lens)',
            action: () => { void searchImageOnGoogleById(contextMenu.imageId); },
            disabled: isContextMenuImageBusy || !isContextMenuGoogleSearchEnabled,
        },
        {
            separator: true,
        },
        {
            label: 'Décoder QR (plugin)',
            action: () => { void decodeQrFromImage(contextMenu.imageId); },
            disabled: isContextMenuImageBusy,
        },
        {
            label: 'Lire Exif (plugin)',
            action: () => { void readExifFromImage(contextMenu.imageId); },
            disabled: isContextMenuImageBusy,
        },
        {
            label: `OCR (défaut: ${ocrDefaultEngine === 'vision_ocr' ? 'IA' : 'EasyOCR'})`,
            action: () => { void runDefaultOcrForImage(contextMenu.imageId); },
            disabled: isContextMenuImageBusy,
        },
        {
            label: 'OCR (EasyOCR)',
            action: () => { void runOcrPluginForImage(contextMenu.imageId, 'easyocr_ocr'); },
            disabled: isContextMenuImageBusy,
        },
        {
            label: `OCR (IA - ${ocrVisionProvider === 'openrouter' ? 'OpenRouter' : 'LMStudio'})`,
            action: () => { void runOcrPluginForImage(contextMenu.imageId, 'vision_ocr'); },
            disabled: isContextMenuImageBusy,
        },
        {
            label: 'OCR (IA - Cloud)',
            action: () => { void runCloudOcrForImage(contextMenu.imageId); },
            disabled: isContextMenuImageBusy,
        },
        {
            separator: true,
        },
        {
            label: 'Stocker localement',
            action: () => { void storeImageById(contextMenu.imageId); },
            disabled: isContextMenuImageBusy || !isContextMenuStoreEnabled,
        },
        ...(isContextMenuUnstoreEnabled ? [{
            label: 'Supprimer stockage local',
            action: () => { void unstoreImageById(contextMenu.imageId); },
            disabled: isContextMenuImageBusy,
            danger: true,
        }] : []),
        ...(isContextMenuDeleteEnabled ? [{
            label: 'Supprimer l\'image',
            action: () => { void deleteImageById(contextMenu.imageId); },
            disabled: isContextMenuImageBusy,
            danger: true,
        }] : []),
        ...(isContextMenuGifEnabled ? [{
            label: 'Découper GIF animé',
            action: () => { void splitAnimatedGif(contextMenu.imageId); },
            disabled: isContextMenuImageBusy,
        }, {
            label: 'Voir frame par frame',
            action: () => { void openGifFrameViewer(contextMenu.imageId); },
            disabled: isContextMenuImageBusy,
        }] : []),
        {
            separator: true,
        },
        {
            label: 'Copier QR payload',
            action: () => { void copyQrPayload(contextMenu.imageId); },
            disabled: !Boolean((contextMenuImage?.qr_payload || '').trim()),
        },
    ] : [];

    const hiddenImagesCount = normalizedHiddenDomains.length
        ? images.filter(img => isHiddenByDomain(img.source_url)).length
        : 0;
    const visiblePendingStoreCount = visibleImages.filter(img => canStoreImage(img)).length;
    const derivedCount = images.filter(img => Boolean(img.parent_image_id)).length;
    const analyzedCount = images.filter(img => Boolean((img.ocr_text || '').trim()) || Boolean((img.qr_payload || '').trim())).length;
    const selectedChatImages = chatImageIds
        .filter(id => selectableChatImageIds.has(id))
        .map(id => visibleImages.find(image => image.id === id))
        .filter((image): image is GeocacheImageV2Dto => Boolean(image));
    const selectedChatUserCount = selectedChatImages.filter(image => getChatImageOrigin(image) === 'user_observation').length;
    const selectedChatListingCount = selectedChatImages.filter(image => getChatImageOrigin(image) === 'cache_listing').length;
    const selectedChatNoteCount = selectedChatImages.filter(image => Boolean((image.note || '').trim())).length;
    const selectedCanStore = canStoreImage(selectedImage);
    const selectedCanUnstore = canUnstoreImage(selectedImage);
    const selectedCanDelete = canDeleteImage(selectedImage);
    const selectedCanGoogle = canSearchImageOnGoogle(selectedImage);
    const selectedIsBusy = selectedImage ? (isImageBusy(selectedImage.id) || isSaving) : false;
    const selectedIsHidden = Boolean(selectedImage && isHiddenByDomain(selectedImage.source_url));
    const selectedIsMissing = isMissingLocalImage(selectedImage);
    const selectedIsAnimatedGif = isAnimatedGifImage(selectedImage);
    const selectedPreviewUrl = selectedImage && selectedImage.url ? resolveImageUrl(selectedImage.url) : '';
    const selectedExifText = formatExifFeatureForDisplay(getExifFeature(selectedImage));
    const hasDirtyMetadata = dirtyFields.size > 0;

    return (
        <div className='geoapp-images-panel'>
            <input
                ref={uploadInputRef}
                type='file'
                accept='image/png,image/jpeg,image/webp,image/gif'
                multiple
                hidden
                onChange={(e) => {
                    const files = Array.from(e.currentTarget.files || []);
                    e.currentTarget.value = '';
                    if (files.length) {
                        void uploadNewImages(files);
                    }
                }}
            />

            <header className='geoapp-images-header'>
                <div className='geoapp-images-title-block'>
                    <div className='geoapp-images-title'>
                        Galerie
                        {isRefreshing ? (
                            <span className='codicon codicon-loading codicon-modifier-spin geoapp-images-refresh-indicator' title='Mise à jour…' aria-label='Mise à jour de la galerie en cours' />
                        ) : undefined}
                    </div>
                    <div className='geoapp-images-stats'>
                        <span>{images.length} image(s)</span>
                        <span>{derivedCount} dérivée(s)</span>
                        <span>{analyzedCount} analysée(s)</span>
                        {hiddenImagesCount > 0 && <span>{hiddenImagesCount} masquée(s)</span>}
                    </div>
                </div>

                <div className='geoapp-images-toolbar'>
                    <button className='theia-button secondary geoapp-images-icon-button' onClick={triggerUploadDialog} disabled={isSaving} type='button'>
                        <span className='codicon codicon-add' />
                        Ajouter
                    </button>

                    {onAnalyzeImages ? (
                        <>
                            <button
                                className='theia-button geoapp-images-icon-button'
                                onClick={() => { void analyzeChatImages(); }}
                                disabled={isSaving || selectedChatImages.length === 0}
                                type='button'
                                title={`Envoyer les images selectionnees au chat. Conseil: ${maxChatImages} image(s) pour garder un prompt leger.`}
                            >
                                <span className='codicon codicon-comment-discussion' />
                                Chat ({selectedChatImages.length})
                            </button>
                            {selectedChatImages.length > 0 ? (
                                <button
                                    className='theia-button secondary geoapp-images-icon-button'
                                    onClick={clearChatImages}
                                    disabled={isSaving}
                                    type='button'
                                    title='Vider la selection chat'
                                >
                                    <span className='codicon codicon-clear-all' />
                                    Vider
                                </button>
                            ) : undefined}
                        </>
                    ) : undefined}

                    <div className='geoapp-images-size-group' aria-label='Taille des vignettes'>
                        <button
                            className={sizeButtonClassName('small')}
                            onClick={() => changeThumbnailSize('small')}
                            disabled={isSaving}
                            title='Vignettes petites'
                            type='button'
                        >
                            S
                        </button>
                        <button
                            className={sizeButtonClassName('medium')}
                            onClick={() => changeThumbnailSize('medium')}
                            disabled={isSaving}
                            title='Vignettes moyennes'
                            type='button'
                        >
                            M
                        </button>
                        <button
                            className={sizeButtonClassName('large')}
                            onClick={() => changeThumbnailSize('large')}
                            disabled={isSaving}
                            title='Vignettes grandes'
                            type='button'
                        >
                            L
                        </button>
                    </div>

                    <button className='theia-button secondary geoapp-images-icon-button' onClick={storeAll} disabled={isSaving || visiblePendingStoreCount <= 0} type='button'>
                        <span className='codicon codicon-cloud-download' />
                        Stocker visibles
                    </button>
                </div>
            </header>

            {onAnalyzeImages && selectedChatImages.length > 0 ? (
                <div className='geoapp-images-hidden-strip'>
                    <span>
                        Selection chat: {selectedChatUserCount} photo(s) utilisateur, {selectedChatListingCount} image(s) du listing, {selectedChatNoteCount} note(s) transmise(s).
                        {selectedChatImages.length > maxChatImages ? ` Conseil depasse (${maxChatImages}): prompt plus lourd.` : ''}
                    </span>
                    <button className='theia-button secondary' type='button' onClick={clearChatImages} disabled={isSaving}>
                        Vider
                    </button>
                </div>
            ) : undefined}

            {hiddenImagesCount > 0 && (
                <div className='geoapp-images-hidden-strip'>
                    <span>{hiddenImagesCount} image(s) correspondent aux domaines masqués.</span>
                    <button className='theia-button secondary' type='button' onClick={() => setShowHiddenImages(!showHiddenImages)}>
                        {showHiddenImages ? 'Masquer' : 'Afficher'}
                    </button>
                </div>
            )}

            {onHiddenDomainsTextChange && (
                <details className='geoapp-images-hidden-config'>
                    <summary>
                        Domaines masqués
                    </summary>
                    <div className='geoapp-images-hidden-config-body'>
                        <textarea
                            className='theia-input geoapp-images-textarea'
                            rows={3}
                            value={hiddenDomainsDraft}
                            onChange={e => setHiddenDomainsDraft(e.target.value)}
                            placeholder={'geocheck.org\ncertitudes.org'}
                        />
                        <div className='geoapp-images-form-actions'>
                            <button
                                className='theia-button secondary'
                                type='button'
                                onClick={() => setHiddenDomainsDraft(hiddenDomainsText ?? '')}
                                disabled={isSavingHiddenDomains || isSaving}
                            >
                                Annuler
                            </button>
                            <button
                                className='theia-button'
                                type='button'
                                onClick={() => { void saveHiddenDomains(); }}
                                disabled={isSavingHiddenDomains || isSaving}
                            >
                                Enregistrer
                            </button>
                        </div>
                    </div>
                </details>
            )}

            {contextMenu && (
                <ContextMenu
                    items={contextMenuItems}
                    x={contextMenu.x}
                    y={contextMenu.y}
                    onClose={() => setContextMenu(null)}
                />
            )}

            {previewMenuAnchor && selectedImage && (
                <ContextMenu
                    items={[
                        {
                            label: 'Dupliquer',
                            action: () => { void duplicateImageById(selectedImage.id); },
                            disabled: selectedIsBusy || selectedIsMissing,
                        },
                        {
                            label: 'Télécharger',
                            action: () => { void downloadImageById(selectedImage.id); },
                            disabled: selectedIsBusy || !selectedImage.stored,
                        },
                        ...(selectedIsAnimatedGif ? [
                            { separator: true } as ContextMenuItem,
                            {
                                label: 'Découper GIF',
                                action: () => { void splitAnimatedGif(selectedImage.id); },
                                disabled: selectedIsBusy || selectedIsMissing,
                            },
                            {
                                label: 'Frames GIF',
                                action: () => { void openGifFrameViewer(selectedImage.id); },
                                disabled: selectedIsBusy,
                            },
                        ] : []),
                    ]}
                    x={previewMenuAnchor.x}
                    y={previewMenuAnchor.y}
                    onClose={() => setPreviewMenuAnchor(null)}
                />
            )}

            {!visibleImages.length ? (
                <div className='geoapp-images-empty'>
                    {images.length > 0 ? 'Toutes les images sont masquées.' : 'Aucune image'}
                </div>
            ) : (
                <div className='geoapp-images-body'>
                    <section className='geoapp-images-browser' aria-label='Images de la géocache'>
                        <div className='geoapp-images-grid' ref={gridRef} onKeyDown={handleGridKeyDown}>
                            {visibleImages.map(img => (
                                <ThumbnailItem
                                    key={img.id}
                                    img={img}
                                    isSelected={img.id === selectedId}
                                    isOcrBusy={Boolean(ocrInProgressById[img.id])}
                                    isHiddenDomain={isHiddenByDomain(img.source_url)}
                                    isMissing={isMissingLocalImage(img)}
                                    isChatSelected={chatImageIdsSet.has(img.id)}
                                    isBusy={isImageBusy(img.id) || isSaving}
                                    thumbnailImageClassName={thumbnailImageClassName}
                                    thumbnailDimensions={thumbnailDimensions}
                                    resolvedUrl={resolveImageUrl(img.url)}
                                    showChatToggle={Boolean(onAnalyzeImages)}
                                    hasUsefulExifFeature={hasUsefulExifFeature}
                                    onCancelOcr={cancelOcrForImage}
                                    onClick={handleThumbnailClick}
                                    onContextMenu={openThumbnailContextMenu}
                                    onToggleChat={toggleChatImage}
                                />
                            ))}
                        </div>
                    </section>

                    {showDetails && selectedImage && (
                        <>
                            <section className='geoapp-images-preview'>
                                <div className='geoapp-images-preview-header'>
                                    <div>
                                        <div className='geoapp-images-selected-title'>{getImageTitle(selectedImage)}</div>
                                        <div className='geoapp-images-selected-subtitle'>
                                            {getChatImageOriginLabel(selectedImage)} - {getImageKindLabel(selectedImage)}
                                            {selectedIsHidden ? ' · domaine masqué' : ''}
                                        </div>
                                    </div>
                                    <div className='geoapp-images-preview-header-actions'>
                                        <div className='geoapp-images-selected-status'>
                                            {selectedImage.stored ? 'Local' : selectedCanStore ? 'Distant' : selectedIsMissing ? 'Fichier manquant' : 'Non stockée'}
                                        </div>
                                        <button
                                            className='theia-button secondary geoapp-images-close-button'
                                            type='button'
                                            onClick={closeSelectedImage}
                                            title="Fermer l'aperçu"
                                            aria-label="Fermer l'aperçu"
                                        >
                                            <span className='codicon codicon-close' aria-hidden='true' />
                                        </button>
                                    </div>
                                </div>

                                <div className='geoapp-images-preview-frame'>
                                    {selectedIsMissing || !selectedPreviewUrl ? (
                                        <div className='geoapp-images-preview-placeholder'>
                                            <span className='codicon codicon-warning' />
                                            <strong>Fichier local indisponible</strong>
                                            <span>Cette image dérivée ne peut pas être affichée tant que son fichier n'existe plus.</span>
                                        </div>
                                    ) : (
                                        <img src={selectedPreviewUrl} alt={getImageTitle(selectedImage)} />
                                    )}
                                </div>

                                <div className='geoapp-images-action-bar'>
                                    <button className='theia-button geoapp-images-icon-button' type='button' onClick={() => openImageEditor(selectedImage.id)} disabled={selectedIsBusy || selectedIsMissing}>
                                        <span className='codicon codicon-edit' />
                                        Éditer
                                    </button>
                                    <button className='theia-button secondary geoapp-images-icon-button' type='button' onClick={() => { void runDefaultOcrForImage(selectedImage.id); }} disabled={selectedIsBusy || selectedIsMissing}>
                                        <span className='codicon codicon-whole-word' />
                                        OCR
                                    </button>
                                    <button className='theia-button secondary geoapp-images-icon-button' type='button' onClick={() => { void decodeQrFromImage(selectedImage.id); }} disabled={selectedIsBusy || selectedIsMissing}>
                                        <span className='codicon codicon-key' />
                                        QR
                                    </button>
                                    <button className='theia-button secondary geoapp-images-icon-button' type='button' onClick={() => { void readExifFromImage(selectedImage.id); }} disabled={selectedIsBusy || selectedIsMissing}>
                                        <span className='codicon codicon-info' />
                                        Exif
                                    </button>
                                    <button className='theia-button secondary geoapp-images-icon-button' type='button' onClick={() => { void searchImageOnGoogleById(selectedImage.id); }} disabled={selectedIsBusy || !selectedCanGoogle}>
                                        <span className='codicon codicon-search' />
                                        Lens
                                    </button>
                                    {onAnalyzeImages ? (
                                        <button
                                            className='theia-button secondary geoapp-images-icon-button'
                                            type='button'
                                            onClick={() => toggleChatImage(selectedImage.id)}
                                            disabled={selectedIsBusy}
                                        >
                                            <span className={chatImageIdsSet.has(selectedImage.id) ? 'codicon codicon-check' : 'codicon codicon-add'} />
                                            {chatImageIdsSet.has(selectedImage.id) ? 'Retirer chat' : 'Ajouter chat'}
                                        </button>
                                    ) : undefined}
                                    <button
                                        className='theia-button secondary geoapp-images-icon-button'
                                        type='button'
                                        disabled={selectedIsBusy}
                                        title="Plus d'actions"
                                        onClick={(e) => {
                                            const rect = e.currentTarget.getBoundingClientRect();
                                            setPreviewMenuAnchor({ x: rect.left, y: rect.bottom + 4 });
                                        }}
                                    >
                                        <span className='codicon codicon-ellipsis' />
                                    </button>
                                </div>
                            </section>

                            <aside className={`geoapp-images-inspector${hasDirtyMetadata ? ' is-dirty' : ''}`}>
                                <div className='geoapp-images-inspector-section'>
                                    <h4>Informations</h4>
                                    <div className='geoapp-images-field'>
                                        <label>Titre</label>
                                        <input className='theia-input geoapp-images-input' value={draftTitle} onChange={e => { setDraftTitle(e.target.value); markFieldDirty('title'); }} />
                                    </div>

                                    <div className='geoapp-images-field'>
                                        <label>Note</label>
                                        <textarea
                                            className='theia-input geoapp-images-textarea'
                                            rows={4}
                                            value={draftNote}
                                            onChange={e => { setDraftNote(e.target.value); markFieldDirty('note'); }}
                                        />
                                    </div>

                                    <div className='geoapp-images-info-list'>
                                        <div><span>Source</span><code title={selectedImage.source_url}>{selectedImage.source_url || 'n/a'}</code></div>
                                        <div><span>Type</span><strong>{getImageKindLabel(selectedImage)}</strong></div>
                                        <div><span>Taille</span><strong>{formatByteSize(selectedImage.byte_size)}</strong></div>
                                    </div>
                                </div>

                                <div className='geoapp-images-inspector-section'>
                                    <h4>Analyse</h4>
                                    <div className='geoapp-images-field'>
                                        <label>QR payload</label>
                                        <textarea
                                            className='theia-input geoapp-images-textarea'
                                            rows={3}
                                            value={draftQr}
                                            onChange={e => { setDraftQr(e.target.value); markFieldDirty('qr'); }}
                                            placeholder='Résultat QR ou saisie manuelle'
                                        />
                                    </div>

                                    <div className='geoapp-images-field'>
                                        <label>OCR</label>
                                        <textarea
                                            className='theia-input geoapp-images-textarea'
                                            rows={7}
                                            value={draftOcr}
                                            onChange={e => { setDraftOcr(e.target.value); markFieldDirty('ocr'); }}
                                            placeholder='Texte détecté ou transcription manuelle'
                                        />
                                    </div>

                                    {selectedExifText ? (
                                        <div className='geoapp-images-field'>
                                            <label>Exif</label>
                                            <textarea
                                                className='theia-input geoapp-images-textarea'
                                                rows={5}
                                                value={selectedExifText}
                                                readOnly={true}
                                            />
                                        </div>
                                    ) : undefined}

                                    <div className='geoapp-images-form-actions'>
                                        {Boolean((draftQr || '').trim()) && (
                                            <button className='theia-button secondary' type='button' onClick={() => { void copyQrPayload(selectedImage.id); }}>
                                                Copier QR
                                            </button>
                                        )}
                                        {hasDirtyMetadata ? (
                                            <span className='geoapp-images-dirty-indicator' title='Titre, note, QR ou OCR modifié(s) non enregistré(s)'>
                                                <span className='codicon codicon-circle-filled' aria-hidden='true' />
                                                Modifié
                                            </span>
                                        ) : undefined}
                                        <button className='theia-button' onClick={saveMetadata} disabled={selectedIsBusy || !hasDirtyMetadata} type='button'>
                                            Sauvegarder
                                        </button>
                                    </div>
                                </div>

                                <div className='geoapp-images-inspector-section'>
                                    <h4>Stockage</h4>
                                    <div className='geoapp-images-storage-actions'>
                                        <button className='theia-button secondary' onClick={storeSelected} disabled={selectedIsBusy || !selectedCanStore} type='button'>
                                            Stocker localement
                                        </button>
                                        <button className='theia-button secondary' onClick={() => { void unstoreImageById(selectedImage.id); }} disabled={selectedIsBusy || !selectedCanUnstore} type='button'>
                                            Retirer local
                                        </button>
                                        <button className='theia-button secondary geoapp-images-danger-button' onClick={() => { void deleteImageById(selectedImage.id); }} disabled={selectedIsBusy || !selectedCanDelete} type='button'>
                                            Supprimer
                                        </button>
                                    </div>
                                </div>
                            </aside>
                        </>
                    )}
                </div>
            )}

            {/* Modal pour le visualiseur de GIF frame par frame */}
            {gifFrameViewerOpen && (
                <div className='geoapp-gif-frame-viewer-overlay' onClick={closeGifFrameViewer}>
                    <div className='geoapp-gif-frame-viewer-modal' onClick={e => e.stopPropagation()}>
                        <div className='geoapp-gif-frame-viewer-header'>
                            <h3>Visualiseur de GIF - Frame par frame</h3>
                            <button className='theia-button secondary' onClick={closeGifFrameViewer} type='button'>
                                <span className='codicon codicon-close' />
                                Fermer
                            </button>
                        </div>

                        <div className='geoapp-gif-frame-viewer-content'>
                            {gifFrameViewerLoading ? (
                                <div className='geoapp-gif-frame-viewer-loading'>
                                    <span className='codicon codicon-loading codicon-modifier-spin' />
                                    Chargement des frames...
                                </div>
                            ) : gifFrameViewerFrames.length > 0 ? (
                                <>
                                    <div className='geoapp-gif-frame-viewer-image-container'>
                                        <img
                                            src={gifFrameViewerFrames[gifFrameViewerCurrentFrame]}
                                            alt={`Frame ${gifFrameViewerCurrentFrame + 1}`}
                                            className='geoapp-gif-frame-viewer-image'
                                        />
                                    </div>

                                    <div className='geoapp-gif-frame-viewer-controls'>
                                        <button
                                            className='theia-button secondary'
                                            onClick={goToPrevFrame}
                                            disabled={gifFrameViewerCurrentFrame === 0}
                                            type='button'
                                        >
                                            <span className='codicon codicon-chevron-left' />
                                            Précédent
                                        </button>

                                        <span className='geoapp-gif-frame-viewer-counter'>
                                            Frame {gifFrameViewerCurrentFrame + 1} / {gifFrameViewerFrames.length}
                                        </span>

                                        <button
                                            className='theia-button secondary'
                                            onClick={goToNextFrame}
                                            disabled={gifFrameViewerCurrentFrame >= gifFrameViewerFrames.length - 1}
                                            type='button'
                                        >
                                            Suivant
                                            <span className='codicon codicon-chevron-right' />
                                        </button>
                                    </div>
                                </>
                            ) : (
                                <div className='geoapp-gif-frame-viewer-error'>
                                    Aucune frame à afficher
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
