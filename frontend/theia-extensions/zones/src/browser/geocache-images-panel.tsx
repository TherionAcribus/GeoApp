/**
 * UI panel for browsing geocache images and editing their metadata (OCR/QR/notes).
 */

import * as React from 'react';
import { MessageService } from '@theia/core';
import { LanguageModelRegistry, LanguageModelService, UserRequest, getJsonOfResponse, getTextOfResponse, isLanguageModelParsedResponse } from '@theia/ai-core';
import { ContextMenu, ContextMenuItem } from './context-menu';

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
    ocrLmstudioBaseUrl?: string;
    ocrLmstudioModel?: string;
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
    ocrLmstudioBaseUrl = 'http://localhost:1234',
    ocrLmstudioModel = '',
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

    const [detailsMode, setDetailsMode] = React.useState<'hidden' | 'fields' | 'preview'>('hidden');

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
                return 'h-24 w-36 rounded object-cover';
            case 'medium':
                return 'h-16 w-24 rounded object-cover';
            default:
                return 'h-12 w-16 rounded object-cover';
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
        return `theia-button secondary ${isActive ? 'border border-sky-500' : ''}`;
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
        if (!normalizedHiddenDomains.length) {
            return images;
        }
        return images.filter(img => !isHiddenByDomain(img.source_url));
    }, [images, isHiddenByDomain, normalizedHiddenDomains.length]);

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
        if (selectedId !== imageId) {
            setSelectedId(imageId);
            setDetailsMode('fields');
            return;
        }

        if (detailsMode === 'hidden') {
            setDetailsMode('fields');
            return;
        }

        if (detailsMode === 'fields') {
            setDetailsMode('preview');
            return;
        }

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
        if (!img) {
            return false;
        }

        // Simplification: recherche Internet uniquement pour les images "en ligne".
        // Les images dérivées (snippets/edits/crops) ne sont pas en ligne -> pas de recherche.
        if (img.parent_image_id) {
            return false;
        }

        const url = (img.source_url || '').trim();
        return Boolean(url) && /^https?:\/\//i.test(url);
    }, []);

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
            const res = await fetch(`${backendBaseUrl}/api/geocache-images/${imageId}/duplicate`, {
                method: 'POST',
                credentials: 'include',
            });
            if (!res.ok) {
                throw new Error(`HTTP ${res.status}`);
            }
            const created = (await res.json()) as GeocacheImageV2Dto;
            window.dispatchEvent(new CustomEvent('geoapp-geocache-images-updated', {
                detail: { geocacheId }
            }));
            setSelectedId(created.id);
            setDetailsMode('fields');
        } catch (e) {
            console.error('[GeocacheImagesPanel] duplicate image error', e);
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
                inputs.base_url = (ocrLmstudioBaseUrl || 'http://localhost:1234').toString();
                inputs.model = (ocrLmstudioModel || '').toString();
            }

            const res = await fetch(`${backendBaseUrl}/api/plugins/${pluginName}/execute`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ inputs }),
                signal: abortController.signal,
            });
            if (!res.ok) {
                throw new Error(`HTTP ${res.status}`);
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
                throw new Error(`HTTP ${res.status}`);
            }
            const updated = (await res.json()) as GeocacheImageV2Dto;
            setImages(prev => prev.map(i => (i.id === updated.id ? updated : i)));
            return updated;
        } catch (e) {
            console.error('[GeocacheImagesPanel] patch image error', e);
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
            await patchImage(selected.id, payload);
        } catch (e) {
            console.error('[GeocacheImagesPanel] save metadata error', e);
        } finally {
            setIsSaving(false);
        }
    };

    const decodeQrFromImage = async (imageId: number): Promise<void> => {
        const img = visibleImages.find(i => i.id === imageId);
        if (!img) {
            return;
        }

        setIsSaving(true);
        try {
            const imageUrlForPlugin = resolveImageUrl(img.url);
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
            const qrPayload: string | undefined = result?.qr_codes?.[0]?.data;
            if (!qrPayload || !String(qrPayload).trim()) {
                return;
            }

            setSelectedId(imageId);
            setDetailsMode('fields');
            await patchImage(imageId, { qr_payload: String(qrPayload) });
        } catch (e) {
            console.error('[GeocacheImagesPanel] decode qr error', e);
        } finally {
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
        setIsSaving(true);
        try {
            const res = await fetch(`${backendBaseUrl}/api/geocache-images/${imageId}/store`, {
                method: 'POST',
                credentials: 'include'
            });
            if (!res.ok) {
                throw new Error(`HTTP ${res.status}`);
            }
            const updated = (await res.json()) as GeocacheImageV2Dto;
            setImages(prev => prev.map(i => (i.id === updated.id ? updated : i)));
        } catch (e) {
            console.error('[GeocacheImagesPanel] store image error', e);
        } finally {
            setIsSaving(false);
        }
    };

    const unstoreImageById = async (imageId: number): Promise<void> => {
        setIsSaving(true);
        try {
            const res = await fetch(`${backendBaseUrl}/api/geocache-images/${imageId}/unstore`, {
                method: 'POST',
                credentials: 'include',
            });
            if (!res.ok) {
                throw new Error(`HTTP ${res.status}`);
            }
            const updated = (await res.json()) as GeocacheImageV2Dto;
            setImages(prev => prev.map(i => (i.id === updated.id ? updated : i)));
        } catch (e) {
            console.error('[GeocacheImagesPanel] unstore image error', e);
            messages.error(`Impossible de supprimer le stockage local : ${String(e)}`);
        } finally {
            setIsSaving(false);
        }
    };

    const deleteImageById = async (imageId: number): Promise<void> => {
        setIsSaving(true);
        try {
            const res = await fetch(`${backendBaseUrl}/api/geocache-images/${imageId}`, {
                method: 'DELETE',
                credentials: 'include',
            });
            if (!res.ok) {
                throw new Error(`HTTP ${res.status}`);
            }

            setImages(prev => prev.filter(i => i.id !== imageId));
            setSelectedId(prev => (prev === imageId ? null : prev));
            await loadImages();
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
        setIsSaving(true);
        try {
            const res = await fetch(`${backendBaseUrl}/api/geocaches/${geocacheId}/images/store`, {
                method: 'POST',
                credentials: 'include'
            });
            if (!res.ok) {
                throw new Error(`HTTP ${res.status}`);
            }
            await loadImages();
        } catch (e) {
            console.error('[GeocacheImagesPanel] store all images error', e);
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

        const badges: { label: string; className: string }[] = [];
        if (img.stored) {
            badges.push({ label: 'LOCAL', className: 'bg-emerald-600/30 text-emerald-200 border-emerald-700/60' });
        }
        if (hasNote) {
            badges.push({ label: 'NOTE', className: 'bg-sky-600/30 text-sky-200 border-sky-700/60' });
        }
        if (hasQr) {
            badges.push({ label: 'QR', className: 'bg-purple-600/30 text-purple-200 border-purple-700/60' });
        }
        if (hasOcr) {
            badges.push({ label: 'OCR', className: 'bg-amber-600/30 text-amber-200 border-amber-700/60' });
        }
        if (isDerived) {
            badges.push({ label: 'DERIVED', className: 'bg-slate-600/30 text-slate-200 border-slate-700/60' });
        }

        if (!badges.length) {
            return null;
        }

        return (
            <div className='mt-1 flex flex-wrap gap-1'>
                {badges.map(b => (
                    <span key={b.label} className={`text-[10px] px-1.5 py-0.5 rounded border ${b.className}`}>
                        {b.label}
                    </span>
                ))}
            </div>
        );
    };

    if (isLoading) {
        return <div className='opacity-70'>Chargement des images…</div>;
    }

    const selectedImage = selected;
    const showDetails = detailsMode !== 'hidden' && Boolean(selectedImage);
    const showPreview = detailsMode === 'preview' && Boolean(selectedImage);
    const isContextMenuOcrBusy = contextMenu ? Boolean(ocrInProgressById[contextMenu.imageId]) : false;
    const contextMenuImage = contextMenu ? (visibleImages.find(i => i.id === contextMenu.imageId) ?? null) : null;
    const isContextMenuUploadedImage = Boolean((contextMenuImage?.source_url || '').startsWith('geoapp-upload://'));
    const isContextMenuGoogleSearchEnabled = canSearchImageOnGoogle(contextMenuImage);

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
            label: 'OCR (IA - LMStudio)',
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
            disabled: isSaving || Boolean(contextMenuImage?.stored),
        },
        ...(!isContextMenuUploadedImage ? [{
            label: 'Supprimer stockage local',
            action: () => { void unstoreImageById(contextMenu.imageId); },
            disabled: isSaving || !Boolean(contextMenuImage?.stored),
            danger: true,
        }] : []),
        ...(isContextMenuUploadedImage ? [{
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

    return (
        <div className='grid gap-3 relative'>
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

            <div className='flex items-center justify-between'>
                <div className='font-semibold'>Images</div>
                <div className='flex items-center gap-2'>
                    <button className='theia-button secondary' onClick={triggerUploadDialog} disabled={isSaving} type='button'>
                        + Ajouter image…
                    </button>

                    <div className='flex items-center gap-1'>
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

                    <button className='theia-button secondary' onClick={storeAll} disabled={isSaving} type='button'>
                        Stocker tout
                    </button>
                </div>
            </div>

            {onHiddenDomainsTextChange && (
                <details className='rounded border border-[var(--theia-panel-border)] bg-[var(--theia-editor-background)] p-2'>
                    <summary className='cursor-pointer select-none text-sm opacity-80'>
                        Domaines masqués (1 par ligne)
                    </summary>
                    <div className='mt-2 grid gap-2'>
                        <textarea
                            className='theia-input w-full resize-y'
                            rows={3}
                            value={hiddenDomainsDraft}
                            onChange={e => setHiddenDomainsDraft(e.target.value)}
                            placeholder={'geocheck.org\ncertitudes.org'}
                        />
                        <div className='flex items-center justify-end gap-2'>
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
                <div className='opacity-70 italic'>Aucune image</div>
            ) : (
                <div className='flex gap-3'>
                    <div className={showDetails ? 'w-64 shrink-0' : 'min-w-0 flex-1'}>
                        <div className='flex gap-2 overflow-x-auto pb-2'>
                            {visibleImages.map(img => (
                                (() => {
                                    const isOcrBusy = Boolean(ocrInProgressById[img.id]);
                                    return (
                                        <div key={img.id} className='relative shrink-0'>
                                            <button
                                                type='button'
                                                className={`relative rounded border ${img.id === selectedId ? 'border-sky-500' : 'border-[var(--theia-panel-border)]'} p-1`}
                                                onClick={() => handleThumbnailClick(img.id)}
                                                onContextMenu={(e) => openThumbnailContextMenu(e, img.id)}
                                                title={img.source_url}
                                                disabled={isSaving}
                                                aria-busy={isOcrBusy}
                                            >
                                                <img
                                                    className={`${thumbnailImageClassName} ${isOcrBusy ? 'opacity-50' : ''}`}
                                                    src={resolveImageUrl(img.url)}
                                                    alt=''
                                                    width={thumbnailDimensions.width}
                                                    height={thumbnailDimensions.height}
                                                />

                                                {renderBadges(img)}
                                            </button>

                                            {isOcrBusy && (
                                                <div className='absolute inset-0 flex items-center justify-center rounded pointer-events-none'>
                                                    <div className='flex flex-col items-center gap-1 bg-black/60 rounded px-2 py-1'>
                                                        <div className='h-5 w-5 animate-spin rounded-full border-2 border-white/70 border-t-transparent' />
                                                        <div className='text-[10px] font-medium text-white/90'>OCR…</div>
                                                    </div>
                                                </div>
                                            )}

                                            {isOcrBusy && (
                                                <button
                                                    type='button'
                                                    className='absolute -top-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-red-600 text-white text-xs font-bold hover:bg-red-700 shadow-md'
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        cancelOcrForImage(img.id);
                                                    }}
                                                    title="Annuler l'OCR"
                                                >
                                                    ✕
                                                </button>
                                            )}
                                        </div>
                                    );
                                })()
                            ))}
                        </div>
                    </div>

                    {showDetails && selectedImage && (
                        <div className='min-w-0 flex-1'>
                            <div className='grid gap-3 rounded border border-[var(--theia-panel-border)] bg-[var(--theia-editor-background)] p-3'>
                                <div className='flex items-start justify-between gap-3'>
                                    <div className='min-w-0'>
                                        <div className='truncate font-semibold'>Image #{selectedImage.id}</div>
                                        <div className='truncate text-xs opacity-70'>{selectedImage.source_url}</div>
                                    </div>
                                    <div className='flex gap-2'>
                                        {!selectedImage.stored && (
                                            <button className='theia-button secondary' onClick={storeSelected} disabled={isSaving} type='button'>
                                                Stocker
                                            </button>
                                        )}
                                    </div>
                                </div>

                            {showPreview && (
                                <img className='max-h-72 w-full rounded object-contain bg-black/20' src={resolveImageUrl(selectedImage.url)} alt='' />
                            )}

                            <div className='grid gap-2'>
                                <div>
                                    <label className='block text-xs opacity-70'>Titre</label>
                                    <input className='theia-input w-full' value={draftTitle} onChange={e => setDraftTitle(e.target.value)} />
                                </div>

                                <div>
                                    <label className='block text-xs opacity-70'>Note</label>
                                    <textarea
                                        className='theia-input w-full resize-y'
                                        rows={4}
                                        value={draftNote}
                                        onChange={e => setDraftNote(e.target.value)}
                                    />
                                </div>

                                {Boolean((draftQr || '').trim()) && (
                                    <div>
                                        <label className='block text-xs opacity-70'>QR payload</label>
                                        <textarea
                                            className='theia-input w-full resize-y'
                                            rows={3}
                                            value={draftQr}
                                            onChange={e => setDraftQr(e.target.value)}
                                        />
                                    </div>
                                )}

                                {Boolean((draftOcr || '').trim()) && (
                                    <div>
                                        <label className='block text-xs opacity-70'>OCR</label>
                                        <textarea
                                            className='theia-input w-full resize-y'
                                            rows={5}
                                            value={draftOcr}
                                            onChange={e => setDraftOcr(e.target.value)}
                                        />
                                    </div>
                                )}
                            </div>

                                <div className='flex justify-end'>
                                    <button className='theia-button' onClick={saveMetadata} disabled={isSaving} type='button'>
                                        Sauvegarder
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};
