/**
 * UI panel for browsing geocache images and editing their metadata (OCR/QR/notes).
 */

import * as React from 'react';
import { MessageService } from '@theia/core';
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

type ThumbnailContextMenuState = {
    x: number;
    y: number;
    imageId: number;
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
}

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
}) => {
    const [images, setImages] = React.useState<GeocacheImageV2Dto[]>([]);
    const [isLoading, setIsLoading] = React.useState(false);
    const [selectedId, setSelectedId] = React.useState<number | null>(null);
    const [isSaving, setIsSaving] = React.useState(false);

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

    const uploadInputRef = React.useRef<HTMLInputElement | null>(null);

    const [effectiveThumbnailSize, setEffectiveThumbnailSize] = React.useState<GalleryThumbnailSize>(thumbnailSize);

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

    const selected = React.useMemo(() => visibleImages.find(i => i.id === selectedId) ?? null, [visibleImages, selectedId]);

    React.useEffect(() => {
        if (selectedId === null) {
            return;
        }
        const stillVisible = visibleImages.some(img => img.id === selectedId);
        if (!stillVisible) {
            setSelectedId(null);
            setDetailsMode('hidden');
        }
    }, [selectedId, visibleImages]);

    const [draftTitle, setDraftTitle] = React.useState('');
    const [draftNote, setDraftNote] = React.useState('');
    const [draftQr, setDraftQr] = React.useState('');
    const [draftOcr, setDraftOcr] = React.useState('');

    const resolveImageUrl = React.useCallback((url: string) => {
        if (!url) {
            return url;
        }
        if (url.startsWith('/')) {
            return `${backendBaseUrl}${url}`;
        }
        return url;
    }, [backendBaseUrl]);

    const loadImages = React.useCallback(async () => {
        if (!geocacheId) {
            return;
        }
        setIsLoading(true);
        try {
            const res = await fetch(`${backendBaseUrl}/api/geocaches/${geocacheId}/images`, { credentials: 'include' });
            if (!res.ok) {
                throw new Error(`HTTP ${res.status}`);
            }
            const data = (await res.json()) as GeocacheImageV2Dto[];
            setImages(Array.isArray(data) ? data : []);
            setSelectedId(prev => (prev && data.some(x => x.id === prev) ? prev : null));
        } catch (e) {
            console.error('[GeocacheImagesPanel] load images error', e);
            setImages([]);
            setSelectedId(null);
        } finally {
            setIsLoading(false);
        }
    }, [backendBaseUrl, geocacheId]);

    React.useEffect(() => {
        void loadImages();
    }, [loadImages]);

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
        if (!selected) {
            setDraftTitle('');
            setDraftNote('');
            setDraftQr('');
            setDraftOcr('');
            return;
        }
        setDraftTitle(selected.title ?? '');
        setDraftNote(selected.note ?? '');
        setDraftQr(selected.qr_payload ?? '');
        setDraftOcr(selected.ocr_text ?? '');
    }, [selected]);

    const handleThumbnailClick = (imageId: number): void => {
        setSelectedId(imageId);
        setDetailsMode('fields');
    };

    const openThumbnailContextMenu = (e: React.MouseEvent, imageId: number): void => {
        e.preventDefault();
        e.stopPropagation();
        setContextMenu({
            x: e.clientX,
            y: e.clientY,
            imageId,
        });
    };

    const isUploadedImage = React.useCallback((img: GeocacheImageV2Dto | null | undefined): boolean => {
        return Boolean((img?.source_url || '').startsWith('geoapp-upload://'));
    }, []);

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

    const uploadNewImage = async (file: File): Promise<void> => {
        if (!file) {
            return;
        }

        setIsSaving(true);
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
            await loadImages();
            messages.info('Image ajoutée');
        } catch (e) {
            console.error('[GeocacheImagesPanel] upload image error', e);
            messages.error(`Impossible d'ajouter l'image (${String(e)})`);
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

    const duplicateImageById = async (imageId: number): Promise<void> => {
        setIsSaving(true);
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
            setIsSaving(false);
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
                        imageUrlForFetch = resolveImageUrl((img.source_url || img.url) as string);
                    }
                } catch {
                    imageUrlForFetch = resolveImageUrl((img.source_url || img.url) as string);
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
            }
        } catch (e) {
            if ((e as Error).name === 'AbortError') {
                console.log('[GeocacheImagesPanel] cloud ocr aborted', imageId);
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
            }
        } catch (e) {
            if ((e as Error).name === 'AbortError') {
                console.log('[GeocacheImagesPanel] ocr plugin aborted', imageId);
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

    const patchImage = async (imageId: number, payload: Partial<GeocacheImageV2Dto>): Promise<GeocacheImageV2Dto | null> => {
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
            messages.error(`Impossible d'enregistrer l'image : ${String(e)}`);
            return null;
        }
    };

    const saveMetadata = async () => {
        if (!selected) {
            return;
        }
        setIsSaving(true);
        try {
            const payload = {
                title: draftTitle,
                note: draftNote,
                qr_payload: draftQr,
                ocr_text: draftOcr
            };
            const updated = await patchImage(selected.id, payload);
            if (updated) {
                messages.info('Métadonnées enregistrées');
            }
        } catch (e) {
            console.error('[GeocacheImagesPanel] save metadata error', e);
        } finally {
            setIsSaving(false);
        }
    };

    const decodeQrFromImage = async (imageId: number): Promise<void> => {
        const img = visibleImages.find(i => i.id === imageId);
        if (!img) {
            console.warn('[GeocacheImagesPanel] decodeQrFromImage: image not found', imageId);
            return;
        }

        setIsSaving(true);
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
            console.log('[GeocacheImagesPanel] decodeQrFromImage: calling plugin with url', imageUrlForPlugin);
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
            console.log('[GeocacheImagesPanel] decodeQrFromImage: plugin result', result);

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
            await patchImage(imageId, { qr_payload: String(qrPayload) });
            messages.info(`QR code décodé: ${String(qrPayload).substring(0, 50)}${String(qrPayload).length > 50 ? '...' : ''}`);
        } catch (e) {
            console.error('[GeocacheImagesPanel] decode qr error', e);
            messages.error(`Erreur décodage QR: ${String(e)}`);
        } finally {
            progress.cancel();
            setIsSaving(false);
        }
    };

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

        setIsSaving(true);
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
            setIsSaving(false);
        }
    };

    const unstoreImageById = async (imageId: number): Promise<void> => {
        const img = images.find(i => i.id === imageId) ?? visibleImages.find(i => i.id === imageId);
        if (!canUnstoreImage(img)) {
            return;
        }

        setIsSaving(true);
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
            setIsSaving(false);
        }
    };

    const deleteImageById = async (imageId: number): Promise<void> => {
        const img = images.find(i => i.id === imageId) ?? visibleImages.find(i => i.id === imageId);
        if (!canDeleteImage(img)) {
            return;
        }

        const confirmed = window.confirm(`Supprimer ${img ? getImageTitle(img) : 'cette image'} et ses dérivés éventuels ?`);
        if (!confirmed) {
            return;
        }

        setIsSaving(true);
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
            setIsSaving(false);
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

    const renderBadges = (img: GeocacheImageV2Dto) => {
        const hasNote = Boolean((img.note || '').trim());
        const hasQr = Boolean((img.qr_payload || '').trim());
        const hasOcr = Boolean((img.ocr_text || '').trim());
        const isDerived = Boolean(img.parent_image_id);
        const isMissing = isMissingLocalImage(img);

        const badges: { label: string; tone: string }[] = [];
        if (img.stored) {
            badges.push({ label: 'LOCAL', tone: 'success' });
        }
        if (isMissing) {
            badges.push({ label: 'MANQUANT', tone: 'danger' });
        }
        if (hasNote) {
            badges.push({ label: 'NOTE', tone: 'info' });
        }
        if (hasQr) {
            badges.push({ label: 'QR', tone: 'accent' });
        }
        if (hasOcr) {
            badges.push({ label: 'OCR', tone: 'warning' });
        }
        if (isDerived) {
            badges.push({ label: 'DÉRIVÉE', tone: 'neutral' });
        }

        if (!badges.length) {
            return null;
        }

        return (
            <div className='geoapp-images-badges'>
                {badges.map(b => (
                    <span key={b.label} className={`geoapp-images-badge geoapp-images-badge--${b.tone}`}>
                        {b.label}
                    </span>
                ))}
            </div>
        );
    };

    if (isLoading) {
        return <div className='geoapp-images-loading'>Chargement des images...</div>;
    }

    const selectedImage = selected;
    const showDetails = Boolean(selectedImage);
    const isContextMenuOcrBusy = contextMenu ? Boolean(ocrInProgressById[contextMenu.imageId]) : false;
    const contextMenuImage = contextMenu ? (visibleImages.find(i => i.id === contextMenu.imageId) ?? null) : null;
    const isContextMenuGoogleSearchEnabled = canSearchImageOnGoogle(contextMenuImage);
    const isContextMenuStoreEnabled = canStoreImage(contextMenuImage);
    const isContextMenuUnstoreEnabled = canUnstoreImage(contextMenuImage);
    const isContextMenuDeleteEnabled = canDeleteImage(contextMenuImage);

    const contextMenuItems: ContextMenuItem[] = contextMenu ? [
        {
            label: 'Éditer l\'image…',
            action: () => { openImageEditor(contextMenu.imageId); },
            disabled: isSaving,
        },
        {
            label: 'Dupliquer l\'image',
            action: () => { void duplicateImageById(contextMenu.imageId); },
            disabled: isSaving,
        },
        {
            label: 'Télécharger l\'image',
            action: () => { void downloadImageById(contextMenu.imageId); },
            disabled: isSaving || !Boolean(contextMenuImage?.stored),
        },
        {
            label: 'Rechercher sur Google (Lens)',
            action: () => { void searchImageOnGoogleById(contextMenu.imageId); },
            disabled: isSaving || !isContextMenuGoogleSearchEnabled,
        },
        {
            separator: true,
        },
        {
            label: 'Décoder QR (plugin)',
            action: () => { void decodeQrFromImage(contextMenu.imageId); },
            disabled: isSaving,
        },
        {
            label: `OCR (défaut: ${ocrDefaultEngine === 'vision_ocr' ? 'IA' : 'EasyOCR'})`,
            action: () => { void runDefaultOcrForImage(contextMenu.imageId); },
            disabled: isSaving || isContextMenuOcrBusy,
        },
        {
            label: 'OCR (EasyOCR)',
            action: () => { void runOcrPluginForImage(contextMenu.imageId, 'easyocr_ocr'); },
            disabled: isSaving || isContextMenuOcrBusy,
        },
        {
            label: `OCR (IA - ${ocrVisionProvider === 'openrouter' ? 'OpenRouter' : 'LMStudio'})`,
            action: () => { void runOcrPluginForImage(contextMenu.imageId, 'vision_ocr'); },
            disabled: isSaving || isContextMenuOcrBusy,
        },
        {
            label: 'OCR (IA - Cloud)',
            action: () => { void runCloudOcrForImage(contextMenu.imageId); },
            disabled: isSaving || isContextMenuOcrBusy,
        },
        {
            separator: true,
        },
        {
            label: 'Stocker localement',
            action: () => { void storeImageById(contextMenu.imageId); },
            disabled: isSaving || !isContextMenuStoreEnabled,
        },
        ...(isContextMenuUnstoreEnabled ? [{
            label: 'Supprimer stockage local',
            action: () => { void unstoreImageById(contextMenu.imageId); },
            disabled: isSaving,
            danger: true,
        }] : []),
        ...(isContextMenuDeleteEnabled ? [{
            label: 'Supprimer l\'image',
            action: () => { void deleteImageById(contextMenu.imageId); },
            disabled: isSaving,
            danger: true,
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
    const selectedCanStore = canStoreImage(selectedImage);
    const selectedCanUnstore = canUnstoreImage(selectedImage);
    const selectedCanDelete = canDeleteImage(selectedImage);
    const selectedCanGoogle = canSearchImageOnGoogle(selectedImage);
    const selectedIsOcrBusy = selectedImage ? Boolean(ocrInProgressById[selectedImage.id]) : false;
    const selectedIsHidden = Boolean(selectedImage && isHiddenByDomain(selectedImage.source_url));
    const selectedIsMissing = isMissingLocalImage(selectedImage);
    const selectedPreviewUrl = selectedImage && selectedImage.url ? resolveImageUrl(selectedImage.url) : '';

    return (
        <div className='geoapp-images-panel'>
            <input
                ref={uploadInputRef}
                type='file'
                accept='image/png,image/jpeg,image/webp'
                hidden
                onChange={(e) => {
                    const file = e.currentTarget.files?.[0];
                    e.currentTarget.value = '';
                    if (file) {
                        void uploadNewImage(file);
                    }
                }}
            />

            <header className='geoapp-images-header'>
                <div className='geoapp-images-title-block'>
                    <div className='geoapp-images-title'>Galerie</div>
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

            {!visibleImages.length ? (
                <div className='geoapp-images-empty'>
                    {images.length > 0 ? 'Toutes les images sont masquées.' : 'Aucune image'}
                </div>
            ) : (
                <div className='geoapp-images-body'>
                    <section className='geoapp-images-browser' aria-label='Images de la géocache'>
                        <div className='geoapp-images-grid'>
                            {visibleImages.map(img => (
                                (() => {
                                    const isOcrBusy = Boolean(ocrInProgressById[img.id]);
                                    const isCurrentHidden = isHiddenByDomain(img.source_url);
                                    const isMissing = isMissingLocalImage(img);
                                    return (
                                        <button
                                            key={img.id}
                                            type='button'
                                            className={`geoapp-images-thumbnail ${img.id === selectedId ? 'is-selected' : ''} ${isCurrentHidden ? 'is-hidden-domain' : ''}`}
                                            onClick={() => handleThumbnailClick(img.id)}
                                            onContextMenu={(e) => openThumbnailContextMenu(e, img.id)}
                                            title={img.source_url}
                                            disabled={isSaving}
                                            aria-busy={isOcrBusy}
                                            aria-pressed={img.id === selectedId}
                                        >
                                            <div className='geoapp-images-thumbnail-frame'>
                                                {isMissing || !img.url ? (
                                                    <div className='geoapp-images-thumbnail-placeholder'>
                                                        <span className='codicon codicon-warning' />
                                                    </div>
                                                ) : (
                                                    <img
                                                        className={`${thumbnailImageClassName} ${isOcrBusy ? 'is-busy' : ''}`}
                                                        src={resolveImageUrl(img.url)}
                                                        alt=''
                                                        width={thumbnailDimensions.width}
                                                        height={thumbnailDimensions.height}
                                                    />
                                                )}

                                                {isOcrBusy && (
                                                    <div className='geoapp-images-thumbnail-busy'>
                                                        <div className='geoapp-images-spinner' />
                                                        <span>OCR</span>
                                                    </div>
                                                )}

                                                {isOcrBusy && (
                                                    <span
                                                        role='button'
                                                        tabIndex={0}
                                                        className='geoapp-images-thumbnail-cancel'
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            cancelOcrForImage(img.id);
                                                        }}
                                                        onKeyDown={(e) => {
                                                            if (e.key === 'Enter' || e.key === ' ') {
                                                                e.preventDefault();
                                                                e.stopPropagation();
                                                                cancelOcrForImage(img.id);
                                                            }
                                                        }}
                                                        title="Annuler l'OCR"
                                                    >
                                                        ×
                                                    </span>
                                                )}
                                            </div>

                                            <div className='geoapp-images-thumbnail-meta'>
                                                <span>{getImageTitle(img)}</span>
                                                <small>{getImageKindLabel(img)}</small>
                                            </div>
                                            {renderBadges(img)}
                                        </button>
                                    );
                                })()
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
                                            {getImageKindLabel(selectedImage)}
                                            {selectedIsHidden ? ' · domaine masqué' : ''}
                                        </div>
                                    </div>
                                    <div className='geoapp-images-selected-status'>
                                        {selectedImage.stored ? 'Local' : selectedCanStore ? 'Distant' : selectedIsMissing ? 'Fichier manquant' : 'Non stockée'}
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
                                    <button className='theia-button geoapp-images-icon-button' type='button' onClick={() => openImageEditor(selectedImage.id)} disabled={isSaving || selectedIsMissing}>
                                        <span className='codicon codicon-edit' />
                                        Éditer
                                    </button>
                                    <button className='theia-button secondary geoapp-images-icon-button' type='button' onClick={() => { void runDefaultOcrForImage(selectedImage.id); }} disabled={isSaving || selectedIsOcrBusy || selectedIsMissing}>
                                        <span className='codicon codicon-whole-word' />
                                        OCR
                                    </button>
                                    <button className='theia-button secondary geoapp-images-icon-button' type='button' onClick={() => { void decodeQrFromImage(selectedImage.id); }} disabled={isSaving || selectedIsMissing}>
                                        <span className='codicon codicon-key' />
                                        QR
                                    </button>
                                    <button className='theia-button secondary geoapp-images-icon-button' type='button' onClick={() => { void searchImageOnGoogleById(selectedImage.id); }} disabled={isSaving || !selectedCanGoogle}>
                                        <span className='codicon codicon-search' />
                                        Lens
                                    </button>
                                    <button className='theia-button secondary geoapp-images-icon-button' type='button' onClick={() => { void duplicateImageById(selectedImage.id); }} disabled={isSaving || selectedIsMissing}>
                                        <span className='codicon codicon-copy' />
                                        Dupliquer
                                    </button>
                                    <button className='theia-button secondary geoapp-images-icon-button' type='button' onClick={() => { void downloadImageById(selectedImage.id); }} disabled={isSaving || !selectedImage.stored}>
                                        <span className='codicon codicon-desktop-download' />
                                        Télécharger
                                    </button>
                                </div>
                            </section>

                            <aside className='geoapp-images-inspector'>
                                <div className='geoapp-images-inspector-section'>
                                    <h4>Informations</h4>
                                    <div className='geoapp-images-field'>
                                        <label>Titre</label>
                                        <input className='theia-input geoapp-images-input' value={draftTitle} onChange={e => setDraftTitle(e.target.value)} />
                                    </div>

                                    <div className='geoapp-images-field'>
                                        <label>Note</label>
                                        <textarea
                                            className='theia-input geoapp-images-textarea'
                                            rows={4}
                                            value={draftNote}
                                            onChange={e => setDraftNote(e.target.value)}
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
                                            onChange={e => setDraftQr(e.target.value)}
                                            placeholder='Résultat QR ou saisie manuelle'
                                        />
                                    </div>

                                    <div className='geoapp-images-field'>
                                        <label>OCR</label>
                                        <textarea
                                            className='theia-input geoapp-images-textarea'
                                            rows={7}
                                            value={draftOcr}
                                            onChange={e => setDraftOcr(e.target.value)}
                                            placeholder='Texte détecté ou transcription manuelle'
                                        />
                                    </div>

                                    <div className='geoapp-images-form-actions'>
                                        {Boolean((draftQr || '').trim()) && (
                                            <button className='theia-button secondary' type='button' onClick={() => { void copyQrPayload(selectedImage.id); }}>
                                                Copier QR
                                            </button>
                                        )}
                                        <button className='theia-button' onClick={saveMetadata} disabled={isSaving} type='button'>
                                            Sauvegarder
                                        </button>
                                    </div>
                                </div>

                                <div className='geoapp-images-inspector-section'>
                                    <h4>Stockage</h4>
                                    <div className='geoapp-images-storage-actions'>
                                        <button className='theia-button secondary' onClick={storeSelected} disabled={isSaving || !selectedCanStore} type='button'>
                                            Stocker localement
                                        </button>
                                        <button className='theia-button secondary' onClick={() => { void unstoreImageById(selectedImage.id); }} disabled={isSaving || !selectedCanUnstore} type='button'>
                                            Retirer local
                                        </button>
                                        <button className='theia-button secondary geoapp-images-danger-button' onClick={() => { void deleteImageById(selectedImage.id); }} disabled={isSaving || !selectedCanDelete} type='button'>
                                            Supprimer
                                        </button>
                                    </div>
                                </div>
                            </aside>
                        </>
                    )}
                </div>
            )}
        </div>
    );
};
