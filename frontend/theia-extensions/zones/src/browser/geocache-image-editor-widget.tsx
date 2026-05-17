/**
 * Theia widget that displays and (later) edits a geocache image in a dedicated tab.
 */

import * as React from 'react';
import { injectable } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { fabric } from 'fabric';
import { CurvesEditor, CurveChannel, CurvePoint } from './curves-editor-component';

type GeocacheImageV2Dto = {
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

type ImageEditorTool = 'select' | 'draw' | 'text' | 'image' | 'shapes' | 'snippet';
type ImageEditorSnippetAction = 'create' | 'ocr' | 'qr' | 'visual-search';
type SnippetSelectionBounds = { left: number; top: number; width: number; height: number };

export interface GeocacheImageEditorContext {
    backendBaseUrl: string;
    geocacheId: number;
    imageId: number;
    imageTitle?: string;
}

@injectable()
export class GeocacheImageEditorWidget extends ReactWidget {
    static readonly ID = 'geocache.image.editor.widget';

    protected backendBaseUrl = 'http://localhost:8000';
    protected geocacheId?: number;
    protected imageId?: number;

    protected isLoading = false;
    protected error: string | null = null;
    protected image: GeocacheImageV2Dto | null = null;
    protected images: GeocacheImageV2Dto[] = [];
    protected isSaving = false;
    protected activeSnippetAction: ImageEditorSnippetAction | null = null;
    protected lastActionMessage: string | null = null;
    protected lastSnippetImage: GeocacheImageV2Dto | null = null;
    protected lastExtractedKind: 'ocr' | 'qr' | null = null;
    protected lastExtractedText: string | null = null;
    protected didApplyRemoteEditorState = false;
    protected loadedEditorStateJson: string | null = null;

    protected canvasElement: HTMLCanvasElement | null = null;
    protected fabricCanvas: any | null = null;

    protected baseImageObjectUrl: string | null = null;
    protected baseImageObjectUrlPendingRevoke: string | null = null;

    protected tool: ImageEditorTool = 'select';
    protected isRestoringHistory = false;
    protected undoStack: string[] = [];
    protected redoStack: string[] = [];

    protected snippetSelectionRect: any | null = null;
    protected snippetIsDragging = false;
    protected snippetStartX = 0;
    protected snippetStartY = 0;
    protected snippetSelectionBounds: SnippetSelectionBounds | null = null;
    protected snippetPreviewDataUrl: string | null = null;

    protected textFill = '#ffffff';
    protected textFontSize = 28;
    protected textBold = false;
    protected textItalic = false;

    protected textBackgroundEnabled = true;
    protected textBackgroundFill = '#000000';
    protected textBackgroundOpacity = 0.4;

    protected drawBrushType: 'pen' | 'highlighter' | 'eraser' = 'pen';
    protected drawBrushSize = 6;
    protected drawColor = '#ffcc00';
    protected drawOpacity = 0.85;
    protected drawLineCap: 'round' | 'butt' | 'square' = 'round';
    protected drawLineJoin: 'round' | 'bevel' | 'miter' = 'round';
    protected drawDecimate = 0.4;

    protected selectionCount = 0;
    protected selectionOpacity = 1;
    protected selectionLocked = false;

    protected imageZoom = 1;
    protected imageCanvasWidth = 0;
    protected imageCanvasHeight = 0;

    protected imageBaseScale = 1;
    protected imageScale = 1;

    protected imageBrightness = 0;
    protected imageContrast = 0;
    protected imageSaturation = 0;
    protected imageHueRotationDeg = 0;
    protected imageBlur = 0;
    protected imageGrayscale = false;
    protected imageSepia = false;
    protected imageInvert = false;
    protected imageRedChannel = 1;
    protected imageGreenChannel = 1;
    protected imageBlueChannel = 1;
    protected showCurvesEditor = false;
    protected curvesChannel: CurveChannel = 'rgb';
    protected curvesRgbPoints: CurvePoint[] = [{ x: 0, y: 0 }, { x: 1, y: 1 }];
    protected curvesRedPoints: CurvePoint[] = [{ x: 0, y: 0 }, { x: 1, y: 1 }];
    protected curvesGreenPoints: CurvePoint[] = [{ x: 0, y: 0 }, { x: 1, y: 1 }];
    protected curvesBluePoints: CurvePoint[] = [{ x: 0, y: 0 }, { x: 1, y: 1 }];
    protected curvesLuminosityPoints: CurvePoint[] = [{ x: 0, y: 0 }, { x: 1, y: 1 }];

    protected shapeType: 'rect' | 'circle' | 'triangle' | 'line' | 'arrow' = 'rect';
    protected shapeWidth = 220;
    protected shapeHeight = 140;
    protected shapeCornerRadius = 12;
    protected shapeFill = '#22c55e';
    protected shapeFillOpacity = 0.25;
    protected shapeStroke = '#22c55e';
    protected shapeStrokeWidth = 4;
    protected shapeOpacity = 1;

    constructor() {
        super();
        this.id = GeocacheImageEditorWidget.ID;
        this.title.label = 'Image Editor';
        this.title.caption = 'Éditeur d\'image';
        this.title.closable = true;
        this.title.iconClass = 'fa fa-image';
        this.addClass('theia-geocache-image-editor-widget');

        this.node.tabIndex = 0;
        this.node.addEventListener('keydown', this.onEditorKeyDown);
    }

    setContext(context: GeocacheImageEditorContext): void {
        this.backendBaseUrl = context.backendBaseUrl;
        this.geocacheId = context.geocacheId;
        this.imageId = context.imageId;
        this.didApplyRemoteEditorState = false;
        this.loadedEditorStateJson = null;
        const label = context.imageTitle ? `Image Editor - ${context.imageTitle}` : `Image Editor - #${context.imageId}`;
        this.title.label = label;
        this.update();
        void this.load();
    }

    protected override onBeforeDetach(msg: any): void {
        this.disposeFabric();
        super.onBeforeDetach(msg);
    }

    protected override onActivateRequest(msg: any): void {
        super.onActivateRequest(msg);
        this.node.focus();
    }

    override dispose(): void {
        this.node.removeEventListener('keydown', this.onEditorKeyDown);
        this.disposeFabric();
        super.dispose();
    }

    protected disposeFabric(): void {
        if (this.fabricCanvas) {
            this.fabricCanvas.dispose();
            this.fabricCanvas = null;
        }
        if (this.baseImageObjectUrl) {
            URL.revokeObjectURL(this.baseImageObjectUrl);
            this.baseImageObjectUrl = null;
        }
        if (this.baseImageObjectUrlPendingRevoke) {
            URL.revokeObjectURL(this.baseImageObjectUrlPendingRevoke);
            this.baseImageObjectUrlPendingRevoke = null;
        }
        this.canvasElement = null;
    }

    protected resolveImageUrl(url: string): string {
        if (!url) {
            return url;
        }
        if (url.startsWith('http://') || url.startsWith('https://')) {
            return url;
        }
        if (url.startsWith('/')) {
            return `${this.backendBaseUrl}${url}`;
        }
        return `${this.backendBaseUrl}/${url}`;
    }

    protected async resolveImageUrlForCanvas(url: string): Promise<string> {
        const resolved = this.resolveImageUrl(url);
        if (!resolved) {
            return resolved;
        }

        if (resolved.startsWith(this.backendBaseUrl)) {
            try {
                const res = await fetch(resolved, { credentials: 'include' });
                if (!res.ok) {
                    return resolved;
                }
                const blob = await res.blob();
                const nextUrl = URL.createObjectURL(blob);
                if (this.baseImageObjectUrl && this.baseImageObjectUrl !== nextUrl) {
                    this.baseImageObjectUrlPendingRevoke = this.baseImageObjectUrl;
                }
                this.baseImageObjectUrl = nextUrl;
                return nextUrl;
            } catch {
                return resolved;
            }
        }

        return resolved;
    }

    protected async load(): Promise<void> {
        if (!this.geocacheId || !this.imageId) {
            return;
        }
        if (this.isLoading) {
            return;
        }

        this.isLoading = true;
        this.error = null;
        this.loadedEditorStateJson = null;
        this.didApplyRemoteEditorState = false;
        this.update();

        try {
            const res = await fetch(`${this.backendBaseUrl}/api/geocaches/${this.geocacheId}/images`, {
                credentials: 'include',
            });
            if (!res.ok) {
                throw new Error(`HTTP ${res.status}`);
            }
            const images = (await res.json()) as GeocacheImageV2Dto[];
            this.images = Array.isArray(images) ? images : [];
            this.image = images.find(i => i.id === this.imageId) ?? null;
            if (!this.image) {
                this.error = 'Image introuvable';
            } else {
                this.loadedEditorStateJson = await this.fetchRemoteEditorStateJson(this.image.id);
            }
        } catch (e) {
            console.error('[GeocacheImageEditorWidget] load error', e);
            this.error = 'Impossible de charger l\'image';
        } finally {
            this.isLoading = false;
            this.didApplyRemoteEditorState = true;
            this.update();

            if (!this.error && this.image) {
                this.ensureFabricReady();
                if (this.loadedEditorStateJson) {
                    this.restoreFromJson(this.loadedEditorStateJson);
                } else {
                    this.ensureBaseImageObject();
                    void this.refreshBaseImageSource();
                }
            }
        }
    }

    protected async fetchRemoteEditorStateJson(imageId: number): Promise<string | null> {
        try {
            const res = await fetch(`${this.backendBaseUrl}/api/geocache-images/${imageId}/editor-state`, {
                credentials: 'include',
            });
            if (!res.ok) {
                return null;
            }
            const data = (await res.json()) as { editor_state_json?: string | null };
            const json = (data?.editor_state_json || '').trim();
            return json || null;
        } catch (e) {
            console.error('[GeocacheImageEditorWidget] load editor state error', e);
            return null;
        }
    }

    protected async saveAsNew(): Promise<void> {
        if (!this.fabricCanvas || !this.imageId || !this.geocacheId || !this.image) {
            return;
        }
        if (this.isSaving) {
            return;
        }

        this.isSaving = true;
        this.update();

        try {
            const editorStateJson = JSON.stringify(this.fabricCanvas.toJSON());
            const renderedBlob = await this.exportCanvasBlob({ format: 'png' });

            const form = new FormData();
            form.append('rendered_file', renderedBlob, 'edited.png');
            form.append('editor_state_json', editorStateJson);
            form.append('mime_type', 'image/png');
            if (this.image.title) {
                form.append('title', this.image.title);
            }

            const endpoint = `${this.backendBaseUrl}/api/geocache-images/${this.imageId}/edits/new`;
            const res = await fetch(endpoint, {
                method: 'POST',
                credentials: 'include',
                body: form,
            });
            if (!res.ok) {
                throw new Error(`HTTP ${res.status}`);
            }

            const created = (await res.json()) as GeocacheImageV2Dto;
            this.images = this.images
                .filter(existing => existing.id !== created.id)
                .concat(created);
            this.image = created;
            this.imageId = created.id;
            this.geocacheId = created.geocache_id;
            this.didApplyRemoteEditorState = true;
            this.loadedEditorStateJson = editorStateJson;

            const label = (created.title || '').trim()
                ? `Image Editor - ${(created.title || '').trim()}`
                : `Image Editor - #${created.id}`;
            this.title.label = label;

            await this.refreshBaseImageSource();

            window.dispatchEvent(new CustomEvent('geoapp-geocache-images-updated', {
                detail: { geocacheId: created.geocache_id }
            }));
        } catch (e) {
            console.error('[GeocacheImageEditorWidget] saveAsNew error', e);
            this.error = 'Impossible de sauvegarder l\'image';
        } finally {
            this.isSaving = false;
            this.update();
        }
    }

    protected async loadRemoteEditorStateIfAny(): Promise<void> {
        if (!this.imageId || !this.fabricCanvas) {
            return;
        }
        if (this.didApplyRemoteEditorState) {
            return;
        }

        this.didApplyRemoteEditorState = true;

        try {
            const res = await fetch(`${this.backendBaseUrl}/api/geocache-images/${this.imageId}/editor-state`, {
                credentials: 'include',
            });
            if (!res.ok) {
                return;
            }
            const data = (await res.json()) as { editor_state_json?: string | null };
            const json = (data?.editor_state_json || '').trim();
            if (!json) {
                return;
            }
            this.restoreFromJson(json);
        } catch (e) {
            console.error('[GeocacheImageEditorWidget] load editor state error', e);
        }
    }

    protected readonly setCanvasRef = (el: HTMLCanvasElement | null): void => {
        this.canvasElement = el;
        this.ensureFabricReady();
    };

    protected ensureFabricReady(): void {
        if (!this.canvasElement || !this.image || this.isLoading || this.error) {
            return;
        }

        if (!this.fabricCanvas) {
            this.fabricCanvas = new fabric.Canvas(this.canvasElement, {
                preserveObjectStacking: true,
                selection: true,
            });

            this.fabricCanvas.on('object:added', this.recordHistorySnapshot);
            this.fabricCanvas.on('object:moving', this.onObjectTransforming);
            this.fabricCanvas.on('object:scaling', this.onObjectTransforming);
            this.fabricCanvas.on('object:modified', this.recordHistorySnapshot);
            this.fabricCanvas.on('object:modified', this.onObjectModified);
            this.fabricCanvas.on('object:removed', this.recordHistorySnapshot);
            this.fabricCanvas.on('path:created', this.recordHistorySnapshot);

            this.fabricCanvas.on('selection:created', this.onSelectionChanged);
            this.fabricCanvas.on('selection:updated', this.onSelectionChanged);
            this.fabricCanvas.on('selection:cleared', this.onSelectionChanged);

            this.fabricCanvas.on('mouse:down', this.onCanvasMouseDown);
            this.fabricCanvas.on('mouse:move', this.onCanvasMouseMove);
            this.fabricCanvas.on('mouse:up', this.onCanvasMouseUp);
            this.fabricCanvas.on('mouse:wheel', this.onCanvasMouseWheel);

            this.applyTool('select');
        }

        if (this.fabricCanvas && this.fabricCanvas.getObjects().length === 0 && this.didApplyRemoteEditorState && !this.loadedEditorStateJson) {
            this.ensureBaseImageObject();
        }
    }

    protected applyTool(tool: ImageEditorTool): void {
        this.tool = tool;
        if (!this.fabricCanvas) {
            this.update();
            return;
        }

        if (tool === 'draw') {
            this.fabricCanvas.isDrawingMode = true;
            this.applyDrawOptions();
        } else {
            this.fabricCanvas.isDrawingMode = false;
        }

        this.update();
    }

    protected clearSnippetSelection(): void {
        if (!this.fabricCanvas) {
            this.snippetSelectionRect = null;
            this.snippetSelectionBounds = null;
            this.snippetPreviewDataUrl = null;
            this.update();
            return;
        }
        if (this.snippetSelectionRect) {
            try {
                this.fabricCanvas.remove(this.snippetSelectionRect);
            } catch {
                // ignore
            }
        }
        this.snippetSelectionRect = null;
        this.snippetSelectionBounds = null;
        this.snippetPreviewDataUrl = null;
        this.fabricCanvas.discardActiveObject?.();
        this.fabricCanvas.requestRenderAll?.();
        this.update();
    }

    protected readonly onObjectTransforming = (opt: any): void => {
        if (opt?.target !== this.snippetSelectionRect) {
            return;
        }
        this.updateSnippetSelectionDetails(false);
    };

    protected readonly onObjectModified = (opt: any): void => {
        if (opt?.target !== this.snippetSelectionRect) {
            return;
        }
        this.updateSnippetSelectionDetails(true);
    };

    protected readonly onEditorKeyDown = (event: KeyboardEvent): void => {
        const target = event.target as HTMLElement | null;
        const targetTag = target?.tagName?.toLowerCase();
        const isEditableTarget = Boolean(
            target?.isContentEditable ||
            targetTag === 'input' ||
            targetTag === 'textarea' ||
            targetTag === 'select'
        );
        if (isEditableTarget) {
            return;
        }

        if (event.key === 'Escape' && this.snippetSelectionRect) {
            this.clearSnippetSelection();
            event.preventDefault();
            return;
        }

        if ((event.key === 'Delete' || event.key === 'Backspace') && this.fabricCanvas?.getActiveObject?.()) {
            if (this.fabricCanvas.getActiveObject?.() === this.snippetSelectionRect) {
                this.clearSnippetSelection();
            } else {
                this.deleteSelection();
            }
            event.preventDefault();
            return;
        }

        if (this.tool !== 'snippet' || !this.snippetSelectionRect || this.isSaving || event.key !== 'Enter') {
            return;
        }

        event.preventDefault();
        if (event.altKey) {
            void this.runVisualSearchOnSnippetSelection();
            return;
        }
        if (event.ctrlKey || event.metaKey) {
            void this.runOcrOnSnippetSelection();
            return;
        }
        if (event.shiftKey) {
            void this.runQrOnSnippetSelection();
            return;
        }
        void this.createSnippetFromSelection();
    };

    protected readonly onCanvasMouseDown = (opt: any): void => {
        if (!this.fabricCanvas) {
            return;
        }
        if (this.tool !== 'snippet') {
            return;
        }

        const target = opt?.target;
        if (target && target === this.snippetSelectionRect) {
            return;
        }

        const p = this.fabricCanvas.getPointer(opt.e);
        this.snippetIsDragging = true;
        this.snippetStartX = p.x;
        this.snippetStartY = p.y;

        if (this.snippetSelectionRect) {
            try {
                this.fabricCanvas.remove(this.snippetSelectionRect);
            } catch {
                // ignore
            }
            this.snippetSelectionRect = null;
        }

        const rect = new fabric.Rect({
            left: p.x,
            top: p.y,
            originX: 'left',
            originY: 'top',
            width: 1,
            height: 1,
            fill: 'rgba(0,0,0,0.05)',
            stroke: '#f97316',
            strokeWidth: 2,
            strokeDashArray: [6, 4],
            selectable: true,
            evented: true,
            borderColor: '#f97316',
            cornerColor: '#f97316',
            cornerStrokeColor: '#111827',
            cornerSize: 11,
            cornerStyle: 'circle',
            padding: 3,
            hasRotatingPoint: false,
            lockRotation: true,
            transparentCorners: false,
        } as any);
        (rect as any).excludeFromExport = true;

        this.snippetSelectionRect = rect;
        this.fabricCanvas.add(rect);
        this.fabricCanvas.setActiveObject?.(rect);
        this.fabricCanvas.requestRenderAll?.();
        this.updateSnippetSelectionDetails(false);
    };

    protected readonly onCanvasMouseMove = (opt: any): void => {
        if (!this.fabricCanvas || !this.snippetIsDragging || this.tool !== 'snippet' || !this.snippetSelectionRect) {
            return;
        }
        const p = this.fabricCanvas.getPointer(opt.e);

        const left = Math.min(this.snippetStartX, p.x);
        const top = Math.min(this.snippetStartY, p.y);
        const width = Math.max(1, Math.abs(p.x - this.snippetStartX));
        const height = Math.max(1, Math.abs(p.y - this.snippetStartY));

        this.snippetSelectionRect.set({ left, top, width, height });
        this.snippetSelectionRect.setCoords?.();
        this.fabricCanvas.requestRenderAll?.();
        this.updateSnippetSelectionDetails(false);
    };

    protected readonly onCanvasMouseUp = (): void => {
        if (this.tool !== 'snippet') {
            return;
        }
        this.snippetIsDragging = false;
        this.updateSnippetSelectionDetails(true);
    };

    protected readonly onCanvasMouseWheel = (opt: any): void => {
        if (!this.fabricCanvas) {
            return;
        }

        const event = opt?.e as WheelEvent | undefined;
        if (!event || (!event.ctrlKey && !event.metaKey)) {
            return;
        }

        const currentZoom = typeof this.fabricCanvas.getZoom === 'function'
            ? this.fabricCanvas.getZoom()
            : this.imageZoom;
        const nextZoom = this.clamp(currentZoom * Math.pow(0.999, event.deltaY), 0.1, 6);
        const point = new (fabric as any).Point(event.offsetX, event.offsetY);

        if (typeof this.fabricCanvas.zoomToPoint === 'function') {
            this.fabricCanvas.zoomToPoint(point, nextZoom);
        } else {
            this.fabricCanvas.setViewportTransform([nextZoom, 0, 0, nextZoom, 0, 0]);
        }

        this.imageZoom = Number(nextZoom.toFixed(2));
        this.fabricCanvas.requestRenderAll?.();
        this.update();

        event.preventDefault();
        event.stopPropagation();
    };

    protected getSelectionRectForSnippet(): any | null {
        if (!this.fabricCanvas) {
            return null;
        }
        const active = this.fabricCanvas.getActiveObject?.();
        if (active && active === this.snippetSelectionRect) {
            return active;
        }
        return this.snippetSelectionRect;
    }

    protected getBoundingRectWithoutViewport(obj: any): { left: number; top: number; width: number; height: number } | null {
        if (!this.fabricCanvas || !obj || typeof obj.getBoundingRect !== 'function') {
            return null;
        }
        const canvas = this.fabricCanvas;
        const prevVpt = Array.isArray(canvas.viewportTransform) ? [...canvas.viewportTransform] : null;
        try {
            canvas.viewportTransform = [1, 0, 0, 1, 0, 0];
            const r = obj.getBoundingRect(true, true);
            return {
                left: Number(r.left) || 0,
                top: Number(r.top) || 0,
                width: Number(r.width) || 0,
                height: Number(r.height) || 0,
            };
        } finally {
            if (prevVpt) {
                canvas.viewportTransform = prevVpt;
            }
        }
    }

    protected normalizeSnippetBounds(bounds: { left: number; top: number; width: number; height: number } | null): SnippetSelectionBounds | null {
        if (!bounds) {
            return null;
        }
        return {
            left: Math.max(0, Math.floor(bounds.left)),
            top: Math.max(0, Math.floor(bounds.top)),
            width: Math.max(1, Math.floor(bounds.width)),
            height: Math.max(1, Math.floor(bounds.height)),
        };
    }

    protected areSnippetBoundsEqual(a: SnippetSelectionBounds | null, b: SnippetSelectionBounds | null): boolean {
        if (!a || !b) {
            return a === b;
        }
        return a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height;
    }

    protected updateSnippetSelectionDetails(refreshPreview: boolean): void {
        const rect = this.getSelectionRectForSnippet();
        const bounds = this.normalizeSnippetBounds(this.getBoundingRectWithoutViewport(rect));
        const changed = !this.areSnippetBoundsEqual(this.snippetSelectionBounds, bounds);

        this.snippetSelectionBounds = bounds;
        if (!bounds || bounds.width < 2 || bounds.height < 2) {
            this.snippetPreviewDataUrl = null;
            if (changed || refreshPreview) {
                this.update();
            }
            return;
        }

        if (changed && !refreshPreview) {
            this.snippetPreviewDataUrl = null;
        }

        if (refreshPreview) {
            this.snippetPreviewDataUrl = this.exportCanvasDataUrl({
                format: 'png',
                left: bounds.left,
                top: bounds.top,
                width: bounds.width,
                height: bounds.height,
                multiplier: 1,
                withoutTransform: true,
                withoutShadow: true,
            });
        }

        if (changed || refreshPreview) {
            this.update();
        }
    }

    protected exportCanvasDataUrl(options: Record<string, unknown> = {}): string {
        if (!this.fabricCanvas) {
            return '';
        }

        const rect = this.snippetSelectionRect;
        const previousVisible = rect ? rect.visible : undefined;
        const previousActive = this.fabricCanvas.getActiveObject?.();

        try {
            if (rect) {
                rect.set?.({ visible: false });
                if (previousActive === rect) {
                    this.fabricCanvas.discardActiveObject?.();
                }
                this.fabricCanvas.requestRenderAll?.();
            }
            return this.fabricCanvas.toDataURL(options);
        } finally {
            if (rect) {
                rect.set?.({ visible: previousVisible !== false });
                if (previousActive === rect) {
                    this.fabricCanvas.setActiveObject?.(rect);
                }
                this.fabricCanvas.requestRenderAll?.();
            }
        }
    }

    protected async exportCanvasBlob(options: Record<string, unknown> = {}): Promise<Blob> {
        const dataUrl = this.exportCanvasDataUrl(options);
        return fetch(dataUrl).then(r => r.blob());
    }

    protected async createSnippetFromSelection(): Promise<GeocacheImageV2Dto | null> {
        if (!this.fabricCanvas || !this.imageId || !this.image) {
            return null;
        }
        if (this.isSaving) {
            return null;
        }

        const rect = this.getSelectionRectForSnippet();
        if (!rect) {
            return null;
        }

        const bounds = this.normalizeSnippetBounds(this.getBoundingRectWithoutViewport(rect));
        if (!bounds || bounds.width < 2 || bounds.height < 2) {
            return null;
        }

        this.isSaving = true;
        this.activeSnippetAction = 'create';
        this.lastActionMessage = 'Création de la sous-image…';
        this.update();

        try {
            const { left, top, width, height } = bounds;

            const renderedBlob = await this.exportCanvasBlob({
                format: 'png',
                left,
                top,
                width,
                height,
                multiplier: 1,
                withoutTransform: true,
                withoutShadow: true,
            });

            const form = new FormData();
            form.append('rendered_file', renderedBlob, 'snippet.png');
            form.append('mime_type', 'image/png');
            form.append('crop_rect_json', JSON.stringify({ left, top, width, height }));

            const endpoint = `${this.backendBaseUrl}/api/geocache-images/${this.imageId}/snippets/new`;
            const res = await fetch(endpoint, {
                method: 'POST',
                credentials: 'include',
                body: form,
            });
            if (!res.ok) {
                throw new Error(`HTTP ${res.status}`);
            }

            const created = (await res.json()) as GeocacheImageV2Dto;
            this.images = this.images
                .filter(existing => existing.id !== created.id)
                .concat(created);
            this.lastSnippetImage = created;
            this.lastActionMessage = `Sous-image #${created.id} créée.`;

            window.dispatchEvent(new CustomEvent('geoapp-geocache-images-updated', {
                detail: { geocacheId: created.geocache_id }
            }));
            return created;
        } catch (e) {
            console.error('[GeocacheImageEditorWidget] create snippet error', e);
            this.error = 'Impossible de créer la sous-image';
            this.lastActionMessage = 'Impossible de créer la sous-image.';
            return null;
        } finally {
            this.isSaving = false;
            this.activeSnippetAction = null;
            this.update();
        }
    }

    protected stripThinkingBlocks(value: string): string {
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
    }

    protected extractTextFromPluginResult(result: any): string {
        if (!result) {
            return '';
        }
        const items = Array.isArray(result.results) ? result.results : [];
        const texts = items
            .map((item: any) => (item?.text_output ?? '').toString())
            .map((text: string) => text.trim())
            .filter((text: string) => Boolean(text));

        if (texts.length > 0) {
            return texts.join('\n\n');
        }

        return (result.text_output ?? '').toString().trim();
    }

    protected async patchImageMetadata(imageId: number, payload: Partial<GeocacheImageV2Dto>): Promise<GeocacheImageV2Dto | null> {
        try {
            const res = await fetch(`${this.backendBaseUrl}/api/geocache-images/${imageId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify(payload),
            });
            if (!res.ok) {
                throw new Error(`HTTP ${res.status}`);
            }
            const updated = (await res.json()) as GeocacheImageV2Dto;
            this.images = this.images.map(existing => existing.id === updated.id ? updated : existing);
            if (this.image?.id === updated.id) {
                this.image = updated;
            }
            window.dispatchEvent(new CustomEvent('geoapp-geocache-images-updated', {
                detail: { geocacheId: updated.geocache_id }
            }));
            return updated;
        } catch (e) {
            console.error('[GeocacheImageEditorWidget] patch image metadata error', e);
            return null;
        }
    }

    protected async executeImagePlugin(pluginName: 'easyocr_ocr' | 'qr_code_detector', image: GeocacheImageV2Dto): Promise<any> {
        const imageUrl = this.resolveImageUrl(image.url);
        const res = await fetch(`${this.backendBaseUrl}/api/plugins/${pluginName}/execute`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
                inputs: {
                    geocache_id: this.geocacheId,
                    images: [{ url: imageUrl }],
                    language: 'auto',
                }
            }),
        });
        if (!res.ok) {
            throw new Error(`HTTP ${res.status}`);
        }
        return res.json();
    }

    protected async runOcrOnSnippetSelection(): Promise<void> {
        const snippet = await this.createSnippetFromSelection();
        if (!snippet) {
            return;
        }

        this.isSaving = true;
        this.activeSnippetAction = 'ocr';
        this.lastActionMessage = `OCR de la sous-image #${snippet.id}…`;
        this.update();

        try {
            const result = await this.executeImagePlugin('easyocr_ocr', snippet);
            const text = this.stripThinkingBlocks(this.extractTextFromPluginResult(result));
            if (!text.trim()) {
                this.lastActionMessage = `OCR terminé sur #${snippet.id}, aucun texte détecté.`;
                return;
            }

            await this.patchImageMetadata(snippet.id, {
                ocr_text: text,
                ocr_language: 'auto',
            });
            this.lastSnippetImage = snippet;
            this.lastExtractedKind = 'ocr';
            this.lastExtractedText = text;
            this.lastActionMessage = `OCR enregistré sur la sous-image #${snippet.id}.`;
        } catch (e) {
            console.error('[GeocacheImageEditorWidget] OCR snippet error', e);
            this.lastActionMessage = `OCR impossible sur la sous-image #${snippet.id}.`;
        } finally {
            this.isSaving = false;
            this.activeSnippetAction = null;
            this.update();
        }
    }

    protected async runQrOnSnippetSelection(): Promise<void> {
        const snippet = await this.createSnippetFromSelection();
        if (!snippet) {
            return;
        }

        this.isSaving = true;
        this.activeSnippetAction = 'qr';
        this.lastActionMessage = `Décodage QR de la sous-image #${snippet.id}…`;
        this.update();

        try {
            const result = await this.executeImagePlugin('qr_code_detector', snippet);
            const qrPayload = (result?.qr_codes?.[0]?.data ?? '').toString().trim();
            if (!qrPayload) {
                this.lastActionMessage = `QR terminé sur #${snippet.id}, aucun code détecté.`;
                return;
            }

            await this.patchImageMetadata(snippet.id, {
                qr_payload: qrPayload,
            });
            this.lastSnippetImage = snippet;
            this.lastExtractedKind = 'qr';
            this.lastExtractedText = qrPayload;
            this.lastActionMessage = `QR enregistré sur la sous-image #${snippet.id}.`;
        } catch (e) {
            console.error('[GeocacheImageEditorWidget] QR snippet error', e);
            this.lastActionMessage = `QR impossible sur la sous-image #${snippet.id}.`;
        } finally {
            this.isSaving = false;
            this.activeSnippetAction = null;
            this.update();
        }
    }

    protected async runVisualSearchOnSnippetSelection(): Promise<void> {
        const snippet = await this.createSnippetFromSelection();
        if (!snippet) {
            return;
        }

        this.isSaving = true;
        this.activeSnippetAction = 'visual-search';
        this.lastSnippetImage = snippet;
        this.lastActionMessage = `Préparation de la recherche visuelle pour la sous-image #${snippet.id}…`;
        this.update();

        try {
            this.openSnippetVisualSearchInChat(snippet);
            this.lastActionMessage = `Sous-image #${snippet.id} envoyée au Chat IA pour recherche visuelle.`;
        } finally {
            this.isSaving = false;
            this.activeSnippetAction = null;
            this.update();
        }
    }

    protected buildLastExtractionContent(): string | null {
        const text = (this.lastExtractedText || '').trim();
        if (!text || !this.lastExtractedKind) {
            return null;
        }

        const snippet = this.lastSnippetImage;
        const kindLabel = this.lastExtractedKind === 'qr' ? 'QR' : 'OCR';
        const sourceLine = snippet
            ? `Image Editor - ${kindLabel} zone - sous-image #${snippet.id}`
            : `Image Editor - ${kindLabel} zone`;

        return [
            sourceLine,
            '',
            text,
        ].join('\n');
    }

    protected async addLastExtractionToNotes(): Promise<void> {
        if (!this.geocacheId) {
            return;
        }

        const content = this.buildLastExtractionContent();
        if (!content) {
            return;
        }

        this.isSaving = true;
        this.lastActionMessage = 'Ajout du résultat aux notes…';
        this.update();

        try {
            const res = await fetch(`${this.backendBaseUrl}/api/geocaches/${this.geocacheId}/notes`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    content,
                    note_type: 'user',
                    source: 'user',
                    source_plugin: 'image_editor',
                }),
            });
            if (!res.ok) {
                throw new Error(`HTTP ${res.status}`);
            }
            this.lastActionMessage = 'Résultat ajouté aux notes.';
            window.dispatchEvent(new CustomEvent('open-geocache-notes', {
                detail: { backendBaseUrl: this.backendBaseUrl, geocacheId: this.geocacheId }
            }));
        } catch (e) {
            console.error('[GeocacheImageEditorWidget] add extraction to notes error', e);
            this.lastActionMessage = 'Impossible d’ajouter le résultat aux notes.';
        } finally {
            this.isSaving = false;
            this.update();
        }
    }

    protected openLastExtractionInChat(): void {
        if (!this.geocacheId) {
            return;
        }

        const content = this.buildLastExtractionContent();
        if (!content) {
            return;
        }

        const snippet = this.lastSnippetImage;
        const kindLabel = this.lastExtractedKind === 'qr' ? 'QR' : 'OCR';
        const imageUrls = snippet ? [this.resolveImageUrl(snippet.url)] : undefined;
        const prompt = [
            `J’ai extrait ce résultat depuis une zone d’image de géocache (${kindLabel}).`,
            snippet ? `Sous-image: #${snippet.id}` : '',
            '',
            content,
            '',
            'Analyse ce résultat dans le contexte d’une énigme de géocaching. Cherche notamment coordonnées, codes, formules, indices exploitables ou pistes de recherche.',
        ].filter(Boolean).join('\n');

        window.dispatchEvent(new CustomEvent('geoapp-open-chat-request', {
            detail: {
                geocacheId: this.geocacheId,
                sessionTitle: `Image ${kindLabel} - géocache #${this.geocacheId}`,
                prompt,
                imageUrls,
                focus: true,
                workflowKind: 'image_puzzle',
                preferredProfile: 'default',
                sessionKind: 'auto',
                resumeState: {
                    workflow: { kind: 'image_puzzle' },
                    imageEditor: {
                        sourceImageId: this.imageId,
                        snippetImageId: snippet?.id,
                        extractionKind: this.lastExtractedKind,
                    },
                    currentText: content,
                },
            }
        }));

        this.lastActionMessage = 'Résultat envoyé au Chat IA.';
        this.update();
    }

    protected openSnippetVisualSearchInChat(snippet: GeocacheImageV2Dto): void {
        if (!this.geocacheId) {
            return;
        }

        const bounds = this.snippetSelectionBounds;
        const imageUrl = this.resolveImageUrl(snippet.url);
        const prompt = [
            'Analyse cette sous-image comme un indice visuel de géocaching.',
            snippet.title ? `Titre image: ${snippet.title}` : '',
            snippet.note ? `Note image: ${snippet.note}` : '',
            bounds ? `Zone source: x ${bounds.left}, y ${bounds.top}, ${bounds.width} × ${bounds.height}px.` : '',
            '',
            'Objectifs:',
            '- identifier les éléments visibles, logos, symboles, lieux, objets, textes partiels, QR/codes/barcodes éventuels ;',
            '- proposer des hypothèses utiles pour résoudre une énigme de géocache ;',
            '- proposer des requêtes web précises si une recherche internet peut aider ;',
            '- extraire toute piste pouvant mener à des coordonnées, une formule, un mot-clé ou un checker.',
            '',
            'Réponds avec les observations fiables d’abord, puis les pistes à vérifier.',
        ].filter(Boolean).join('\n');

        window.dispatchEvent(new CustomEvent('geoapp-open-chat-request', {
            detail: {
                geocacheId: this.geocacheId,
                sessionTitle: `Recherche image - sous-image #${snippet.id}`,
                prompt,
                imageUrls: [imageUrl],
                focus: true,
                workflowKind: 'image_puzzle',
                preferredProfile: 'web',
                sessionKind: 'auto',
                resumeState: {
                    workflow: { kind: 'image_puzzle' },
                    imageEditor: {
                        sourceImageId: this.imageId,
                        snippetImageId: snippet.id,
                        action: 'visual-search',
                        bounds,
                    },
                    currentText: prompt,
                },
            }
        }));
    }

    protected getViewportCenterPoint(): { x: number; y: number } {
        if (!this.fabricCanvas) {
            return { x: 0, y: 0 };
        }
        const canvas = this.fabricCanvas;
        const w = canvas.getWidth?.() ?? 0;
        const h = canvas.getHeight?.() ?? 0;
        const vpt = Array.isArray(canvas.viewportTransform) ? canvas.viewportTransform : [1, 0, 0, 1, 0, 0];

        const util: any = (fabric as any).util;
        if (util?.transformPoint && util?.invertTransform && (fabric as any).Point) {
            const pt = new (fabric as any).Point(w / 2, h / 2);
            const inv = util.invertTransform(vpt);
            const world = util.transformPoint(pt, inv);
            return { x: world.x, y: world.y };
        }

        return { x: w / 2, y: h / 2 };
    }

    protected addShape(): void {
        if (!this.fabricCanvas) {
            return;
        }

        const canvas = this.fabricCanvas;
        const center = this.getViewportCenterPoint();

        const w = Math.max(10, Math.floor(this.shapeWidth));
        const h = Math.max(10, Math.floor(this.shapeHeight));
        const rx = Math.max(0, Math.floor(this.shapeCornerRadius));
        const strokeW = Math.max(0, Math.floor(this.shapeStrokeWidth));
        const opacity = this.clamp(this.shapeOpacity, 0, 1);
        const fillOpacity = this.clamp(this.shapeFillOpacity, 0, 1);

        const fill = this.rgbaFromHex(this.shapeFill, fillOpacity);
        const stroke = this.shapeStroke;

        let obj: any = null;

        if (this.shapeType === 'rect') {
            obj = new fabric.Rect({
                left: center.x,
                top: center.y,
                originX: 'center',
                originY: 'center',
                width: w,
                height: h,
                rx,
                ry: rx,
                fill,
                stroke,
                strokeWidth: strokeW,
                opacity,
            });
        } else if (this.shapeType === 'circle') {
            const r = Math.max(5, Math.floor(Math.min(w, h) / 2));
            obj = new fabric.Circle({
                left: center.x,
                top: center.y,
                originX: 'center',
                originY: 'center',
                radius: r,
                fill,
                stroke,
                strokeWidth: strokeW,
                opacity,
            });
        } else if (this.shapeType === 'triangle') {
            obj = new fabric.Triangle({
                left: center.x,
                top: center.y,
                originX: 'center',
                originY: 'center',
                width: w,
                height: h,
                fill,
                stroke,
                strokeWidth: strokeW,
                opacity,
            });
        } else if (this.shapeType === 'line') {
            obj = new fabric.Line([-w / 2, 0, w / 2, 0], {
                left: center.x,
                top: center.y,
                originX: 'center',
                originY: 'center',
                stroke,
                strokeWidth: Math.max(1, strokeW),
                opacity,
            });
        } else if (this.shapeType === 'arrow') {
            const lineLen = w;
            const headLen = Math.max(10, Math.min(28, Math.floor(lineLen * 0.18)));
            const headW = Math.max(10, Math.floor(headLen * 0.9));
            const arrowStrokeW = Math.max(1, strokeW);

            const line = new fabric.Line([-(lineLen / 2), 0, (lineLen / 2) - headLen, 0], {
                left: 0,
                top: 0,
                originX: 'center',
                originY: 'center',
                stroke,
                strokeWidth: arrowStrokeW,
            });

            const head = new fabric.Triangle({
                left: (lineLen / 2) - (headLen / 2),
                top: 0,
                originX: 'center',
                originY: 'center',
                width: headLen,
                height: headW,
                angle: 90,
                fill: stroke,
                stroke: stroke,
                strokeWidth: 0,
            });

            obj = new fabric.Group([line, head], {
                left: center.x,
                top: center.y,
                originX: 'center',
                originY: 'center',
                opacity,
            });
        }

        if (!obj) {
            return;
        }

        canvas.add(obj);
        canvas.setActiveObject?.(obj);
        canvas.requestRenderAll?.();
        this.recordHistorySnapshot();
        this.onSelectionChanged();
        this.update();
    }

    protected getBaseImageObject(): any | null {
        if (!this.fabricCanvas) {
            return null;
        }
        const objects = this.fabricCanvas.getObjects?.() ?? [];
        const base = objects.find((o: any) => o && o.type === 'image' && o.selectable === false);
        return base ?? null;
    }

    protected getImageById(imageId: number | null | undefined): GeocacheImageV2Dto | null {
        if (typeof imageId !== 'number') {
            return null;
        }
        return this.images.find(img => img.id === imageId) ?? null;
    }

    protected getRootImage(image: GeocacheImageV2Dto): GeocacheImageV2Dto {
        let current = image;
        const visited = new Set<number>();

        while (current.parent_image_id && !visited.has(current.id)) {
            visited.add(current.id);
            const parent = this.getImageById(current.parent_image_id);
            if (!parent) {
                break;
            }
            current = parent;
        }

        return current;
    }

    protected shouldUseRootImageForEditableState(image: GeocacheImageV2Dto): boolean {
        if (!this.loadedEditorStateJson || !image.parent_image_id) {
            return false;
        }

        const derivationType = (image.derivation_type || '').toLowerCase();
        return derivationType.startsWith('edited') || derivationType.startsWith('copy');
    }

    protected getEditorBaseImage(): GeocacheImageV2Dto | null {
        if (!this.image) {
            return null;
        }
        if (this.shouldUseRootImageForEditableState(this.image)) {
            return this.getRootImage(this.image);
        }
        return this.image;
    }

    protected async ensureImageStoredForCanvas(image: GeocacheImageV2Dto): Promise<GeocacheImageV2Dto> {
        if (image.stored) {
            return image;
        }

        try {
            const res = await fetch(`${this.backendBaseUrl}/api/geocache-images/${image.id}/store`, {
                method: 'POST',
                credentials: 'include',
            });
            if (!res.ok) {
                return image;
            }
            const updated = (await res.json()) as GeocacheImageV2Dto;
            this.images = this.images.map(existing => existing.id === updated.id ? updated : existing);
            if (this.image?.id === updated.id) {
                this.image = updated;
            }
            return updated;
        } catch (e) {
            console.warn('[GeocacheImageEditorWidget] failed to store editor base image', e);
            return image;
        }
    }

    protected async resolveEditorBaseImageUrlForCanvas(): Promise<string> {
        const baseImage = this.getEditorBaseImage();
        if (!baseImage) {
            return '';
        }
        const storedBase = await this.ensureImageStoredForCanvas(baseImage);
        return this.resolveImageUrlForCanvas(storedBase.url);
    }

    protected ensureBaseImageObject(): void {
        if (!this.fabricCanvas || !this.canvasElement || !this.image) {
            return;
        }

        if (this.getBaseImageObject()) {
            return;
        }

        void this.resolveEditorBaseImageUrlForCanvas().then(src => {
            if (!src) {
                return;
            }
            fabric.Image.fromURL(
                src,
            (img: any) => {
                if (!this.fabricCanvas || !img) {
                    return;
                }

                const container = this.canvasElement?.parentElement;
                const containerWidth = container?.clientWidth ?? 900;
                const containerHeight = Math.min(window.innerHeight * 0.7, 700);
                this.fabricCanvas.setWidth(Math.max(300, containerWidth - 16));
                this.fabricCanvas.setHeight(Math.max(300, containerHeight));

                this.imageCanvasWidth = this.fabricCanvas.getWidth();
                this.imageCanvasHeight = this.fabricCanvas.getHeight();

                img.set({
                    selectable: false,
                    evented: false,
                    hasControls: false,
                    hoverCursor: 'default',
                    lockMovementX: true,
                    lockMovementY: true,
                    lockScalingX: true,
                    lockScalingY: true,
                    lockRotation: true,
                });

                const scaleX = this.fabricCanvas.getWidth() / (img.width || 1);
                const scaleY = this.fabricCanvas.getHeight() / (img.height || 1);
                const scale = Math.min(scaleX, scaleY);
                img.scale(scale);
                img.set({ left: 0, top: 0, originX: 'left', originY: 'top' });

                this.imageBaseScale = scale;
                this.imageScale = 1;

                this.fabricCanvas.add(img);
                this.fabricCanvas.sendToBack(img);
                this.fabricCanvas.requestRenderAll?.();

                if (!this.undoStack.length) {
                    this.undoStack = [JSON.stringify(this.fabricCanvas.toJSON())];
                    this.redoStack = [];
                    this.update();
                }
            },
            { crossOrigin: 'anonymous' }
            );
        });
    }

    protected async refreshBaseImageSource(): Promise<void> {
        if (!this.fabricCanvas || !this.image) {
            return;
        }
        const base = this.getBaseImageObject();
        if (!base) {
            this.ensureBaseImageObject();
            return;
        }

        const src = await this.resolveEditorBaseImageUrlForCanvas();
        if (!src) {
            return;
        }

        if (typeof base.setSrc === 'function') {
            const pendingRevoke = this.baseImageObjectUrlPendingRevoke;
            base.setSrc(src, () => {
                if (!this.fabricCanvas) {
                    return;
                }
                const w = this.fabricCanvas.getWidth();
                const h = this.fabricCanvas.getHeight();
                const scaleX = w / (base.width || 1);
                const scaleY = h / (base.height || 1);
                this.imageBaseScale = Math.min(scaleX, scaleY);
                base.scale(this.imageBaseScale * this.imageScale);
                base.set({ left: 0, top: 0, originX: 'left', originY: 'top' });
                base.setCoords?.();
                this.fabricCanvas.sendToBack(base);
                this.fabricCanvas.requestRenderAll?.();
                if (pendingRevoke) {
                    try {
                        URL.revokeObjectURL(pendingRevoke);
                    } finally {
                        if (this.baseImageObjectUrlPendingRevoke === pendingRevoke) {
                            this.baseImageObjectUrlPendingRevoke = null;
                        }
                    }
                }
            }, { crossOrigin: 'anonymous' });
        } else {
            try {
                this.fabricCanvas.remove(base);
            } catch {
                // ignore
            }
            this.ensureBaseImageObject();
        }
    }

    protected rgbaFromHex(hex: string, alpha: number): string {
        const rgb = this.hexToRgb(hex);
        const a = this.clamp(alpha, 0, 1);
        if (!rgb) {
            return `rgba(255,204,0,${a})`;
        }
        return `rgba(${rgb.r},${rgb.g},${rgb.b},${a})`;
    }

    protected applyDrawOptions(): void {
        if (!this.fabricCanvas) {
            return;
        }

        const canvas = this.fabricCanvas;
        let brush: any = canvas.freeDrawingBrush;

        const FabricAny = fabric as any;

        if (this.drawBrushType === 'eraser') {
            if (FabricAny.EraserBrush) {
                brush = new FabricAny.EraserBrush(canvas);
            } else {
                brush = new fabric.PencilBrush(canvas);
                brush.color = '#000000';
                brush.globalCompositeOperation = 'destination-out';
            }
        } else {
            brush = new fabric.PencilBrush(canvas);
            brush.globalCompositeOperation = 'source-over';
        }

        brush.width = this.drawBrushSize;

        if (this.drawBrushType === 'highlighter') {
            brush.color = this.rgbaFromHex(this.drawColor, this.clamp(this.drawOpacity, 0, 1) * 0.35);
        } else if (this.drawBrushType === 'pen') {
            brush.color = this.rgbaFromHex(this.drawColor, this.drawOpacity);
        }

        brush.strokeLineCap = this.drawLineCap;
        brush.strokeLineJoin = this.drawLineJoin;
        brush.decimate = this.clamp(this.drawDecimate, 0, 1);

        canvas.freeDrawingBrush = brush;
        canvas.isDrawingMode = true;
        canvas.requestRenderAll?.();
    }

    protected readonly recordHistorySnapshot = (): void => {
        if (this.isRestoringHistory || !this.fabricCanvas) {
            return;
        }
        try {
            const snapshot = JSON.stringify(this.fabricCanvas.toJSON());
            const last = this.undoStack[this.undoStack.length - 1];
            if (snapshot !== last) {
                this.undoStack.push(snapshot);
                if (this.undoStack.length > 30) {
                    this.undoStack.shift();
                }
                this.redoStack = [];
                this.update();
            }
        } catch (e) {
            console.error('[GeocacheImageEditorWidget] history snapshot error', e);
        }
    };

    protected readonly onSelectionChanged = (): void => {
        const selectedObjects = this.getSelectedObjects();
        this.selectionCount = selectedObjects.length;
        if (selectedObjects.length) {
            const opacities = selectedObjects.map(o => (typeof o.opacity === 'number' ? o.opacity : 1));
            this.selectionOpacity = opacities[0];
            this.selectionLocked = selectedObjects.every(o => o.selectable === false);
        }

        const active = this.getActiveTextObject();
        if (active) {
            const fill = (active.fill ?? '') as string;
            if (typeof fill === 'string' && fill.startsWith('#')) {
                this.textFill = fill;
            }
            const fontSize = active.fontSize as number | undefined;
            if (typeof fontSize === 'number' && Number.isFinite(fontSize) && fontSize > 0) {
                this.textFontSize = fontSize;
            }
            const fontWeight = (active.fontWeight ?? '') as string;
            this.textBold = String(fontWeight).toLowerCase() === 'bold';
            const fontStyle = (active.fontStyle ?? '') as string;
            this.textItalic = String(fontStyle).toLowerCase() === 'italic';

            const bg = (active.backgroundColor ?? '') as string;
            const parsed = this.parseRgbaBackground(bg);
            if (parsed) {
                this.textBackgroundEnabled = true;
                this.textBackgroundFill = parsed.hex;
                this.textBackgroundOpacity = parsed.alpha;
            } else {
                this.textBackgroundEnabled = false;
            }
        }
        this.update();
    };

    protected clamp(value: number, min: number, max: number): number {
        return Math.max(min, Math.min(max, value));
    }

    protected hexToRgb(hex: string): { r: number; g: number; b: number } | null {
        const normalized = hex.trim().replace('#', '');
        if (normalized.length !== 6) {
            return null;
        }
        const r = Number.parseInt(normalized.slice(0, 2), 16);
        const g = Number.parseInt(normalized.slice(2, 4), 16);
        const b = Number.parseInt(normalized.slice(4, 6), 16);
        if ([r, g, b].some(v => Number.isNaN(v))) {
            return null;
        }
        return { r, g, b };
    }

    protected rgbToHex(r: number, g: number, b: number): string {
        const toHex = (v: number): string => this.clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0');
        return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
    }

    protected parseRgbaBackground(value: string): { hex: string; alpha: number } | null {
        const v = (value || '').trim();
        if (!v) {
            return null;
        }
        const rgba = v.match(/^rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([0-9.]+)\s*\)$/i);
        if (!rgba) {
            return null;
        }
        const r = Number(rgba[1]);
        const g = Number(rgba[2]);
        const b = Number(rgba[3]);
        const a = Number(rgba[4]);
        if (![r, g, b, a].every(n => Number.isFinite(n))) {
            return null;
        }
        return {
            hex: this.rgbToHex(r, g, b),
            alpha: this.clamp(a, 0, 1),
        };
    }

    protected getActiveTextObject(): any | null {
        if (!this.fabricCanvas) {
            return null;
        }
        const obj = this.fabricCanvas.getActiveObject?.();
        if (!obj) {
            return null;
        }
        if (obj.type === 'i-text' || obj.type === 'textbox' || obj.type === 'text') {
            return obj;
        }
        return null;
    }

    protected getSelectedObjects(): any[] {
        if (!this.fabricCanvas) {
            return [];
        }
        const active = this.fabricCanvas.getActiveObject?.();
        if (!active) {
            return [];
        }
        if (active.type === 'activeSelection' && typeof active.getObjects === 'function') {
            return active.getObjects();
        }
        return [active];
    }

    protected setSelectionOpacity(value: number): void {
        if (!this.fabricCanvas) {
            return;
        }
        const v = this.clamp(value, 0, 1);
        const objects = this.getSelectedObjects();
        if (!objects.length) {
            return;
        }
        objects.forEach(obj => {
            obj.set({ opacity: v });
        });
        this.selectionOpacity = v;
        this.fabricCanvas.requestRenderAll?.();
        this.recordHistorySnapshot();
        this.update();
    }

    protected toggleSelectionLock(): void {
        if (!this.fabricCanvas) {
            return;
        }
        const objects = this.getSelectedObjects();
        if (!objects.length) {
            return;
        }
        const nextLocked = !this.selectionLocked;
        objects.forEach(obj => {
            obj.set({
                selectable: !nextLocked,
                evented: !nextLocked,
                lockMovementX: nextLocked,
                lockMovementY: nextLocked,
                lockScalingX: nextLocked,
                lockScalingY: nextLocked,
                lockRotation: nextLocked,
            });
        });
        this.selectionLocked = nextLocked;
        if (nextLocked) {
            this.fabricCanvas.discardActiveObject?.();
        }
        this.fabricCanvas.requestRenderAll?.();
        this.recordHistorySnapshot();
        this.update();
    }

    protected bringToFront(): void {
        if (!this.fabricCanvas) {
            return;
        }
        const objects = this.getSelectedObjects();
        objects.forEach(obj => {
            this.fabricCanvas.bringToFront(obj);
        });
        this.fabricCanvas.requestRenderAll?.();
        this.recordHistorySnapshot();
    }

    protected sendToBack(): void {
        if (!this.fabricCanvas) {
            return;
        }
        const objects = this.getSelectedObjects();
        objects.forEach(obj => {
            this.fabricCanvas.sendToBack(obj);
        });
        this.fabricCanvas.requestRenderAll?.();
        this.recordHistorySnapshot();
    }

    protected bringForward(): void {
        if (!this.fabricCanvas) {
            return;
        }
        const objects = this.getSelectedObjects();
        objects.forEach(obj => {
            this.fabricCanvas.bringForward(obj);
        });
        this.fabricCanvas.requestRenderAll?.();
        this.recordHistorySnapshot();
    }

    protected sendBackwards(): void {
        if (!this.fabricCanvas) {
            return;
        }
        const objects = this.getSelectedObjects();
        objects.forEach(obj => {
            this.fabricCanvas.sendBackwards(obj);
        });
        this.fabricCanvas.requestRenderAll?.();
        this.recordHistorySnapshot();
    }

    protected async duplicateSelection(): Promise<void> {
        if (!this.fabricCanvas) {
            return;
        }
        const canvas = this.fabricCanvas;
        const active = canvas.getActiveObject?.();
        if (!active) {
            return;
        }

        const clones: any[] = [];
        const cloneOne = (obj: any) => new Promise<any>((resolve) => {
            obj.clone((cloned: any) => resolve(cloned));
        });

        if (active.type === 'activeSelection') {
            const objects = active.getObjects?.() ?? [];
            for (const obj of objects) {
                const cloned = await cloneOne(obj);
                cloned.set({ left: (obj.left ?? 0) + 12, top: (obj.top ?? 0) + 12 });
                canvas.add(cloned);
                clones.push(cloned);
            }
        } else {
            const cloned = await cloneOne(active);
            cloned.set({ left: (active.left ?? 0) + 12, top: (active.top ?? 0) + 12 });
            canvas.add(cloned);
            clones.push(cloned);
        }

        if (clones.length > 1 && (fabric as any).ActiveSelection) {
            const sel = new (fabric as any).ActiveSelection(clones, { canvas });
            canvas.setActiveObject(sel);
        } else if (clones.length === 1) {
            canvas.setActiveObject(clones[0]);
        }

        canvas.requestRenderAll?.();
        this.recordHistorySnapshot();
        this.onSelectionChanged();
    }

    protected groupSelection(): void {
        if (!this.fabricCanvas) {
            return;
        }
        const active = this.fabricCanvas.getActiveObject?.();
        if (!active || active.type !== 'activeSelection') {
            return;
        }
        if (typeof active.toGroup === 'function') {
            const group = active.toGroup();
            this.fabricCanvas.setActiveObject(group);
            this.fabricCanvas.requestRenderAll?.();
            this.recordHistorySnapshot();
            this.onSelectionChanged();
        }
    }

    protected ungroupSelection(): void {
        if (!this.fabricCanvas) {
            return;
        }
        const active = this.fabricCanvas.getActiveObject?.();
        if (!active || active.type !== 'group') {
            return;
        }
        if (typeof active.toActiveSelection === 'function') {
            const sel = active.toActiveSelection();
            this.fabricCanvas.setActiveObject(sel);
            this.fabricCanvas.requestRenderAll?.();
            this.recordHistorySnapshot();
            this.onSelectionChanged();
        }
    }

    protected alignSelection(kind: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom'): void {
        if (!this.fabricCanvas) {
            return;
        }
        const active = this.fabricCanvas.getActiveObject?.();
        if (!active || active.type !== 'activeSelection') {
            return;
        }

        const objects = active.getObjects?.() ?? [];
        if (objects.length < 2) {
            return;
        }

        active.setCoords?.();
        const bounds = active.getBoundingRect?.(true, true) ?? { left: 0, top: 0, width: 0, height: 0 };
        const left = bounds.left;
        const right = bounds.left + bounds.width;
        const top = bounds.top;
        const bottom = bounds.top + bounds.height;
        const cx = bounds.left + bounds.width / 2;
        const cy = bounds.top + bounds.height / 2;

        objects.forEach((obj: any) => {
            obj.setCoords?.();
            const r = obj.getBoundingRect?.(true, true) ?? { left: obj.left ?? 0, top: obj.top ?? 0, width: 0, height: 0 };
            switch (kind) {
                case 'left':
                    obj.set({ left: (obj.left ?? 0) + (left - r.left) });
                    break;
                case 'center':
                    obj.set({ left: (obj.left ?? 0) + (cx - (r.left + r.width / 2)) });
                    break;
                case 'right':
                    obj.set({ left: (obj.left ?? 0) + (right - (r.left + r.width)) });
                    break;
                case 'top':
                    obj.set({ top: (obj.top ?? 0) + (top - r.top) });
                    break;
                case 'middle':
                    obj.set({ top: (obj.top ?? 0) + (cy - (r.top + r.height / 2)) });
                    break;
                case 'bottom':
                    obj.set({ top: (obj.top ?? 0) + (bottom - (r.top + r.height)) });
                    break;
            }
            obj.setCoords?.();
        });

        active.setCoords?.();
        this.fabricCanvas.requestRenderAll?.();
        this.recordHistorySnapshot();
    }

    protected applyTextOptionsToSelection(): void {
        if (!this.fabricCanvas) {
            return;
        }
        const active = this.getActiveTextObject();
        if (!active) {
            return;
        }

        const bg = this.textBackgroundEnabled
            ? (() => {
                const rgb = this.hexToRgb(this.textBackgroundFill);
                const alpha = this.clamp(this.textBackgroundOpacity, 0, 1);
                if (!rgb) {
                    return `rgba(0,0,0,${alpha})`;
                }
                return `rgba(${rgb.r},${rgb.g},${rgb.b},${alpha})`;
            })()
            : null;

        active.set({
            fill: this.textFill,
            fontSize: this.textFontSize,
            fontWeight: this.textBold ? 'bold' : 'normal',
            fontStyle: this.textItalic ? 'italic' : 'normal',
            backgroundColor: bg,
        });
        this.fabricCanvas.requestRenderAll?.();
        this.recordHistorySnapshot();
    }

    protected addText(): void {
        if (!this.fabricCanvas) {
            return;
        }

        const rgb = this.hexToRgb(this.textBackgroundFill);
        const alpha = this.clamp(this.textBackgroundOpacity, 0, 1);
        const backgroundColor = this.textBackgroundEnabled
            ? (rgb ? `rgba(${rgb.r},${rgb.g},${rgb.b},${alpha})` : `rgba(0,0,0,${alpha})`)
            : null;

        const text = new fabric.IText('Texte', {
            left: 50,
            top: 50,
            fill: this.textFill,
            fontSize: this.textFontSize,
            fontWeight: this.textBold ? 'bold' : 'normal',
            fontStyle: this.textItalic ? 'italic' : 'normal',
            backgroundColor,
        });
        this.fabricCanvas.add(text);
        this.fabricCanvas.setActiveObject(text);
        this.fabricCanvas.renderAll();
    }

    protected deleteSelection(): void {
        if (!this.fabricCanvas) {
            return;
        }
        const active = this.fabricCanvas.getActiveObject?.();
        if (!active) {
            return;
        }

        if (active.type === 'activeSelection') {
            const objects = active.getObjects?.() ?? [];
            objects.forEach((obj: any) => {
                this.fabricCanvas.remove(obj);
            });
            this.fabricCanvas.discardActiveObject?.();
        } else {
            this.fabricCanvas.remove(active);
            this.fabricCanvas.discardActiveObject?.();
        }

        this.fabricCanvas.requestRenderAll?.();
        this.recordHistorySnapshot();
    }

    protected undo(): void {
        if (!this.fabricCanvas || this.undoStack.length <= 1) {
            return;
        }

        const current = this.undoStack.pop();
        if (current) {
            this.redoStack.push(current);
        }
        const previous = this.undoStack[this.undoStack.length - 1];
        if (!previous) {
            return;
        }

        this.restoreFromJson(previous);
    }

    protected redo(): void {
        if (!this.fabricCanvas || !this.redoStack.length) {
            return;
        }

        const next = this.redoStack.pop();
        if (!next) {
            return;
        }

        this.undoStack.push(next);
        this.restoreFromJson(next);
    }

    protected restoreFromJson(json: string): void {
        if (!this.fabricCanvas) {
            return;
        }

        this.isRestoringHistory = true;
        this.fabricCanvas.loadFromJSON(json, () => {
            if (!this.fabricCanvas) {
                return;
            }
            this.fabricCanvas.renderAll();
            if (!this.getBaseImageObject()) {
                this.ensureBaseImageObject();
            }
            void this.refreshBaseImageSource();
            this.isRestoringHistory = false;
            this.update();
        });
    }

    protected getActiveImageObject(): any | null {
        if (!this.fabricCanvas) {
            return null;
        }
        const obj = this.fabricCanvas.getActiveObject?.();
        if (obj && obj.type === 'image') {
            return obj;
        }
        return this.getBaseImageObject();
    }

    protected applyImageFilters(): void {
        if (!this.fabricCanvas) {
            return;
        }
        const img = this.getActiveImageObject();
        if (!img) {
            return;
        }

        const filters: any[] = [];
        const F: any = (fabric as any).Image?.filters ?? (fabric as any).ImageFilters;

        if (F?.Brightness && this.imageBrightness !== 0) {
            filters.push(new F.Brightness({ brightness: this.clamp(this.imageBrightness, -1, 1) }));
        }
        if (F?.Contrast && this.imageContrast !== 0) {
            filters.push(new F.Contrast({ contrast: this.clamp(this.imageContrast, -1, 1) }));
        }
        if (F?.Saturation && this.imageSaturation !== 0) {
            filters.push(new F.Saturation({ saturation: this.clamp(this.imageSaturation, -1, 1) }));
        }
        if (F?.HueRotation && this.imageHueRotationDeg !== 0) {
            const rad = (this.imageHueRotationDeg * Math.PI) / 180;
            filters.push(new F.HueRotation({ rotation: rad }));
        }
        if (F?.Blur && this.imageBlur !== 0) {
            filters.push(new F.Blur({ blur: this.clamp(this.imageBlur, 0, 1) }));
        }
        if (F?.Grayscale && this.imageGrayscale) {
            filters.push(new F.Grayscale());
        }
        if (F?.Sepia && this.imageSepia) {
            filters.push(new F.Sepia());
        }
        if (F?.Invert && this.imageInvert) {
            filters.push(new F.Invert());
        }
        if ((F?.ColorMatrix || F?.RemoveColor) && (this.imageRedChannel !== 1 || this.imageGreenChannel !== 1 || this.imageBlueChannel !== 1)) {
            const r = this.clamp(this.imageRedChannel, 0, 2);
            const g = this.clamp(this.imageGreenChannel, 0, 2);
            const b = this.clamp(this.imageBlueChannel, 0, 2);
            if (F?.ColorMatrix) {
                const matrix = [
                    r, 0, 0, 0, 0,
                    0, g, 0, 0, 0,
                    0, 0, b, 0, 0,
                    0, 0, 0, 1, 0
                ];
                filters.push(new F.ColorMatrix({ matrix }));
            }
        }

        const hasCurves = this.curvesRgbPoints.length > 2 || this.curvesRedPoints.length > 2 ||
            this.curvesGreenPoints.length > 2 || this.curvesBluePoints.length > 2 ||
            this.curvesLuminosityPoints.length > 2 ||
            JSON.stringify(this.curvesRgbPoints) !== JSON.stringify([{ x: 0, y: 0 }, { x: 1, y: 1 }]) ||
            JSON.stringify(this.curvesRedPoints) !== JSON.stringify([{ x: 0, y: 0 }, { x: 1, y: 1 }]) ||
            JSON.stringify(this.curvesGreenPoints) !== JSON.stringify([{ x: 0, y: 0 }, { x: 1, y: 1 }]) ||
            JSON.stringify(this.curvesBluePoints) !== JSON.stringify([{ x: 0, y: 0 }, { x: 1, y: 1 }]) ||
            JSON.stringify(this.curvesLuminosityPoints) !== JSON.stringify([{ x: 0, y: 0 }, { x: 1, y: 1 }]);

        if (F?.ColorMatrix && hasCurves) {
            const rgbLUT = this.calculateCurveLUT(this.curvesRgbPoints);
            const redLUT = this.calculateCurveLUT(this.curvesRedPoints);
            const greenLUT = this.calculateCurveLUT(this.curvesGreenPoints);
            const blueLUT = this.calculateCurveLUT(this.curvesBluePoints);
            const lumLUT = this.calculateCurveLUT(this.curvesLuminosityPoints);

            const combinedLUT = {
                r: new Array(256),
                g: new Array(256),
                b: new Array(256),
            };

            for (let i = 0; i < 256; i++) {
                let r = i;
                let g = i;
                let b = i;

                r = rgbLUT[r];
                g = rgbLUT[g];
                b = rgbLUT[b];

                r = redLUT[r];
                g = greenLUT[g];
                b = blueLUT[b];

                const lum = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
                const lumMapped = lumLUT[this.clamp(lum, 0, 255)];
                const lumDelta = lumMapped - lum;

                r = this.clamp(r + lumDelta, 0, 255);
                g = this.clamp(g + lumDelta, 0, 255);
                b = this.clamp(b + lumDelta, 0, 255);

                combinedLUT.r[i] = r / 255;
                combinedLUT.g[i] = g / 255;
                combinedLUT.b[i] = b / 255;
            }

            const matrix = new Array(20).fill(0);
            matrix[18] = 1;

            const filter = new F.ColorMatrix({ matrix });
            if (typeof filter.matrix === 'undefined') {
                filter.matrix = matrix;
            }

            filter.applyTo2d = function(options: any) {
                if (!options || !options.imageData || !options.imageData.data) {
                    return;
                }
                const data = options.imageData.data;
                for (let i = 0; i < data.length; i += 4) {
                    const r = Math.min(255, Math.max(0, data[i]));
                    const g = Math.min(255, Math.max(0, data[i + 1]));
                    const b = Math.min(255, Math.max(0, data[i + 2]));
                    data[i] = combinedLUT.r[r] * 255;
                    data[i + 1] = combinedLUT.g[g] * 255;
                    data[i + 2] = combinedLUT.b[b] * 255;
                }
            };

            filter.applyTo = filter.applyTo2d;

            filters.push(filter);
        }

        img.filters = filters;

        const afterApply = () => {
            this.fabricCanvas?.requestRenderAll?.();
            this.recordHistorySnapshot();
        };

        if (typeof img.applyFilters !== 'function') {
            afterApply();
            return;
        }

        const F2: any = fabric as any;
        const prevBackend = F2.filterBackend;
        if (hasCurves && F2.Canvas2dFilterBackend) {
            F2.filterBackend = new F2.Canvas2dFilterBackend();
        }

        let applied = false;

        try {
            img.applyFilters();
            applied = true;
        } catch {
            // Ignore; we'll try other call signatures below.
        }

        if (!applied) {
            try {
                img.applyFilters(filters);
                applied = true;
            } catch {
                // Ignore; we'll log once below.
            }
        }

        if (hasCurves && F2.Canvas2dFilterBackend) {
            F2.filterBackend = prevBackend;
        }

        if (applied) {
            afterApply();
            return;
        }

        try {
            // Last resort: some Fabric builds accept (filters, callback).
            img.applyFilters(filters, afterApply);
            return;
        } catch (e) {
            console.error('[GeocacheImageEditorWidget] applyImageFilters error', e);
            this.fabricCanvas?.requestRenderAll?.();
        }
    }

    protected getCurvesPoints(channel: CurveChannel): CurvePoint[] {
        switch (channel) {
            case 'rgb':
                return this.curvesRgbPoints;
            case 'red':
                return this.curvesRedPoints;
            case 'green':
                return this.curvesGreenPoints;
            case 'blue':
                return this.curvesBluePoints;
            case 'luminosity':
                return this.curvesLuminosityPoints;
        }
    }

    protected setCurvesPoints(channel: CurveChannel, points: CurvePoint[]): void {
        switch (channel) {
            case 'rgb':
                this.curvesRgbPoints = points;
                break;
            case 'red':
                this.curvesRedPoints = points;
                break;
            case 'green':
                this.curvesGreenPoints = points;
                break;
            case 'blue':
                this.curvesBluePoints = points;
                break;
            case 'luminosity':
                this.curvesLuminosityPoints = points;
                break;
        }
    }

    protected calculateCurveLUT(points: CurvePoint[]): number[] {
        const lut: number[] = [];
        const sorted = [...points].sort((a, b) => a.x - b.x);

        for (let i = 0; i < 256; i++) {
            const x = i / 255;

            let idx = 0;
            while (idx < sorted.length - 1 && sorted[idx + 1].x < x) {
                idx++;
            }

            if (idx >= sorted.length - 1) {
                lut.push(Math.round(sorted[sorted.length - 1].y * 255));
            } else {
                const p0 = sorted[idx];
                const p1 = sorted[idx + 1];
                const t = (x - p0.x) / (p1.x - p0.x);
                const y = p0.y + t * (p1.y - p0.y);
                lut.push(Math.round(this.clamp(y, 0, 1) * 255));
            }
        }

        return lut;
    }

    protected applyCurvesPreset(preset: string): void {
        const channel = this.curvesChannel;
        let newPoints: CurvePoint[] = [];

        switch (preset) {
            case 'contrast':
                newPoints = [
                    { x: 0, y: 0.1 },
                    { x: 0.25, y: 0.2 },
                    { x: 0.5, y: 0.5 },
                    { x: 0.75, y: 0.8 },
                    { x: 1, y: 0.9 },
                ];
                break;
            case 'invert':
                newPoints = [
                    { x: 0, y: 1 },
                    { x: 1, y: 0 },
                ];
                break;
            case 'brighten-shadows':
                newPoints = [
                    { x: 0, y: 0.15 },
                    { x: 0.25, y: 0.4 },
                    { x: 0.5, y: 0.55 },
                    { x: 1, y: 1 },
                ];
                break;
            case 'darken-highlights':
                newPoints = [
                    { x: 0, y: 0 },
                    { x: 0.5, y: 0.45 },
                    { x: 0.75, y: 0.6 },
                    { x: 1, y: 0.85 },
                ];
                break;
            default:
                newPoints = [{ x: 0, y: 0 }, { x: 1, y: 1 }];
        }

        this.setCurvesPoints(channel, newPoints);
        this.applyImageFilters();
        this.update();
    }

    protected resetCurves(channel?: CurveChannel): void {
        if (channel) {
            this.setCurvesPoints(channel, [{ x: 0, y: 0 }, { x: 1, y: 1 }]);
        } else {
            this.curvesRgbPoints = [{ x: 0, y: 0 }, { x: 1, y: 1 }];
            this.curvesRedPoints = [{ x: 0, y: 0 }, { x: 1, y: 1 }];
            this.curvesGreenPoints = [{ x: 0, y: 0 }, { x: 1, y: 1 }];
            this.curvesBluePoints = [{ x: 0, y: 0 }, { x: 1, y: 1 }];
            this.curvesLuminosityPoints = [{ x: 0, y: 0 }, { x: 1, y: 1 }];
        }
        this.applyImageFilters();
        this.update();
    }

    protected resetImageEdits(): void {
        this.imageBrightness = 0;
        this.imageContrast = 0;
        this.imageSaturation = 0;
        this.imageHueRotationDeg = 0;
        this.imageBlur = 0;
        this.imageGrayscale = false;
        this.imageSepia = false;
        this.imageInvert = false;
        this.imageRedChannel = 1;
        this.imageGreenChannel = 1;
        this.imageBlueChannel = 1;
        this.resetCurves();
        this.imageZoom = 1;

        const img = this.getActiveImageObject();
        if (img) {
            img.set({ angle: 0, flipX: false, flipY: false });
            img.scale(this.imageBaseScale);
            img.set({ left: 0, top: 0 });
            img.setCoords?.();
        }
        this.imageScale = 1;
        this.applyImageFilters();
        this.applyZoom();
        this.update();
    }

    protected applyZoom(): void {
        if (!this.fabricCanvas) {
            return;
        }
        const z = this.clamp(this.imageZoom, 0.1, 6);
        this.imageZoom = z;
        this.fabricCanvas.setViewportTransform([z, 0, 0, z, 0, 0]);
        this.fabricCanvas.requestRenderAll?.();
    }

    protected applyImageScale(): void {
        if (!this.fabricCanvas) {
            return;
        }
        const base = this.getBaseImageObject();
        if (!base) {
            return;
        }
        const scale = this.imageBaseScale * this.clamp(this.imageScale, 0.1, 10);
        base.scale(scale);
        base.set({ left: 0, top: 0 });
        base.setCoords?.();
        this.fabricCanvas.requestRenderAll?.();
        this.recordHistorySnapshot();
        this.update();
    }

    protected resizeCanvas(width: number, height: number): void {
        if (!this.fabricCanvas) {
            return;
        }
        const w = Math.max(100, Math.floor(width));
        const h = Math.max(100, Math.floor(height));
        this.fabricCanvas.setWidth(w);
        this.fabricCanvas.setHeight(h);
        this.imageCanvasWidth = w;
        this.imageCanvasHeight = h;

        const base = this.getBaseImageObject();
        if (base) {
            const scaleX = w / (base.width || 1);
            const scaleY = h / (base.height || 1);
            const scale = Math.min(scaleX, scaleY);
            this.imageBaseScale = scale;
            base.scale(this.imageBaseScale * this.imageScale);
            base.set({ left: 0, top: 0 });
        }
        this.fabricCanvas.requestRenderAll?.();
        this.recordHistorySnapshot();
        this.update();
    }

    protected rotateImage(deg: number): void {
        this.rotateCanvasContent(deg);
    }

    protected flipImage(axis: 'x' | 'y'): void {
        const img = this.getActiveImageObject();
        if (!this.fabricCanvas || !img) {
            return;
        }
        const center = typeof img.getCenterPoint === 'function'
            ? img.getCenterPoint()
            : {
                x: (img.left ?? 0) + (typeof img.getScaledWidth === 'function' ? img.getScaledWidth() / 2 : 0),
                y: (img.top ?? 0) + (typeof img.getScaledHeight === 'function' ? img.getScaledHeight() / 2 : 0),
            };
        if (axis === 'x') {
            img.set({ flipX: !img.flipX });
        } else {
            img.set({ flipY: !img.flipY });
        }
        if (typeof img.setPositionByOrigin === 'function') {
            img.setPositionByOrigin(center, 'center', 'center');
        } else if (typeof img.getCenterPoint === 'function') {
            const nextCenter = img.getCenterPoint();
            const dx = center.x - nextCenter.x;
            const dy = center.y - nextCenter.y;
            img.set({ left: (img.left ?? 0) + dx, top: (img.top ?? 0) + dy });
        }
        img.setCoords?.();
        this.fabricCanvas.requestRenderAll?.();
        this.recordHistorySnapshot();
        this.update();
    }

    protected rotateCanvasContent(deg: number): void {
        if (!this.fabricCanvas) {
            return;
        }
        const base = this.getBaseImageObject();
        if (!base) {
            return;
        }

        const rad = (deg * Math.PI) / 180;
        const pivot = typeof base.getCenterPoint === 'function'
            ? base.getCenterPoint()
            : {
                x: (base.left ?? 0) + (typeof base.getScaledWidth === 'function' ? base.getScaledWidth() / 2 : 0),
                y: (base.top ?? 0) + (typeof base.getScaledHeight === 'function' ? base.getScaledHeight() / 2 : 0),
            };

        this.fabricCanvas.discardActiveObject?.();

        const objects = this.fabricCanvas.getObjects?.() ?? [];
        for (const obj of objects) {
            if (!obj) {
                continue;
            }

            const center = typeof obj.getCenterPoint === 'function'
                ? obj.getCenterPoint()
                : {
                    x: (obj.left ?? 0) + (typeof obj.getScaledWidth === 'function' ? obj.getScaledWidth() / 2 : 0),
                    y: (obj.top ?? 0) + (typeof obj.getScaledHeight === 'function' ? obj.getScaledHeight() / 2 : 0),
                };

            const dx = center.x - pivot.x;
            const dy = center.y - pivot.y;
            const nx = pivot.x + (dx * Math.cos(rad) - dy * Math.sin(rad));
            const ny = pivot.y + (dx * Math.sin(rad) + dy * Math.cos(rad));

            const currentAngle = (obj.angle ?? 0) as number;
            obj.set({ angle: currentAngle + deg });

            if (typeof obj.setPositionByOrigin === 'function') {
                obj.setPositionByOrigin({ x: nx, y: ny }, 'center', 'center');
            } else {
                obj.set({ left: nx, top: ny, originX: 'center', originY: 'center' });
            }
            obj.setCoords?.();
        }

        this.fabricCanvas.sendToBack(base);
        this.normalizeCanvasToBaseImageBounds();
        this.fabricCanvas.requestRenderAll?.();
        this.recordHistorySnapshot();
        this.update();
    }

    protected normalizeCanvasToBaseImageBounds(): void {
        if (!this.fabricCanvas) {
            return;
        }

        const base = this.getBaseImageObject();
        if (!base || typeof base.getBoundingRect !== 'function') {
            return;
        }

        const objects = this.fabricCanvas.getObjects?.() ?? [];
        if (!objects.length) {
            return;
        }

        const previousVpt = Array.isArray(this.fabricCanvas.viewportTransform)
            ? [...this.fabricCanvas.viewportTransform]
            : null;

        if (previousVpt) {
            this.fabricCanvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
        }

        const baseRect = base.getBoundingRect(true, true);
        if (![baseRect.left, baseRect.top, baseRect.width, baseRect.height].every(v => Number.isFinite(v))) {
            if (previousVpt) {
                this.fabricCanvas.setViewportTransform(previousVpt);
            }
            return;
        }

        const shiftX = -baseRect.left;
        const shiftY = -baseRect.top;

        for (const obj of objects) {
            if (!obj) {
                continue;
            }
            obj.set({ left: (obj.left ?? 0) + shiftX, top: (obj.top ?? 0) + shiftY });
            obj.setCoords?.();
        }

        const nextW = Math.max(100, Math.ceil(baseRect.width));
        const nextH = Math.max(100, Math.ceil(baseRect.height));
        this.fabricCanvas.setWidth(nextW);
        this.fabricCanvas.setHeight(nextH);
        this.imageCanvasWidth = nextW;
        this.imageCanvasHeight = nextH;

        if (previousVpt) {
            this.fabricCanvas.setViewportTransform(previousVpt);
        }
    }

    protected async save(): Promise<void> {
        if (!this.fabricCanvas || !this.imageId || !this.geocacheId || !this.image) {
            return;
        }
        if (this.isSaving) {
            return;
        }

        this.isSaving = true;
        this.update();

        try {
            const editorStateJson = JSON.stringify(this.fabricCanvas.toJSON());
            const renderedBlob = await this.exportCanvasBlob({ format: 'png' });

            const form = new FormData();
            form.append('rendered_file', renderedBlob, 'edited.png');
            form.append('editor_state_json', editorStateJson);
            form.append('mime_type', 'image/png');
            if (this.image.title) {
                form.append('title', this.image.title);
            }

            const isDerived = Boolean(this.image.parent_image_id);
            const initialEndpoint = `${this.backendBaseUrl}/api/geocache-images/${this.imageId}/edits`;
            const initialMethod = isDerived ? 'PUT' : 'POST';

            let res = await fetch(initialEndpoint, {
                method: initialMethod,
                credentials: 'include',
                body: form,
            });

            if (res.status === 409 && initialMethod === 'POST') {
                const conflictPayload = await res.json().catch(() => null);
                let existingId = conflictPayload?.existing_image_id;
                if (typeof existingId !== 'number') {
                    const listRes = await fetch(`${this.backendBaseUrl}/api/geocaches/${this.geocacheId}/images`, {
                        method: 'GET',
                        credentials: 'include',
                    });
                    if (listRes.ok) {
                        const images = (await listRes.json()) as GeocacheImageV2Dto[];
                        const match = images.find(i => i.parent_image_id === this.imageId && i.derivation_type === 'edited');
                        if (match) {
                            existingId = match.id;
                        }
                    }
                }

                if (typeof existingId === 'number') {
                    res = await fetch(`${this.backendBaseUrl}/api/geocache-images/${existingId}/edits`, {
                        method: 'PUT',
                        credentials: 'include',
                        body: form,
                    });
                }
            }

            if (!res.ok) {
                throw new Error(`HTTP ${res.status}`);
            }
            const updated = (await res.json()) as GeocacheImageV2Dto;

            this.images = this.images
                .filter(existing => existing.id !== updated.id)
                .concat(updated);
            this.image = updated;
            this.imageId = updated.id;
            this.geocacheId = updated.geocache_id;
            this.didApplyRemoteEditorState = true;
            this.loadedEditorStateJson = editorStateJson;

            const label = (updated.title || '').trim()
                ? `Image Editor - ${(updated.title || '').trim()}`
                : `Image Editor - #${updated.id}`;
            this.title.label = label;
            await this.refreshBaseImageSource();

            window.dispatchEvent(new CustomEvent('geoapp-geocache-images-updated', {
                detail: { geocacheId: updated.geocache_id }
            }));
        } catch (e) {
            console.error('[GeocacheImageEditorWidget] save error', e);
            this.error = 'Impossible de sauvegarder l\'image';
        } finally {
            this.isSaving = false;
            this.update();
        }
    }

    protected getToolLabel(tool: ImageEditorTool = this.tool): string {
        switch (tool) {
            case 'select':
                return 'Sélection';
            case 'snippet':
                return 'Découpe';
            case 'draw':
                return 'Dessin';
            case 'text':
                return 'Texte';
            case 'image':
                return 'Image';
            case 'shapes':
                return 'Formes';
        }
    }

    protected getToolHint(): string {
        switch (this.tool) {
            case 'select':
                return this.selectionCount > 0
                    ? 'Modifiez les calques sélectionnés depuis les contrôles actifs.'
                    : 'Cliquez un calque pour le déplacer, le dupliquer ou l’ordonner.';
            case 'snippet':
                return 'Tracez une zone sur l’image, puis créez une sous-image exploitable dans la galerie.';
            case 'draw':
                return 'Dessinez au pinceau, au surligneur ou avec la gomme. Les traits restent éditables.';
            case 'text':
                return 'Ajoutez du texte puis ajustez sa taille, sa couleur et son fond.';
            case 'image':
                return 'Ajustez l’image de travail : rotation, contraste, couleurs, courbes et zoom.';
            case 'shapes':
                return 'Ajoutez des repères visuels : rectangles, cercles, lignes et flèches.';
        }
    }

    protected getToolIcon(tool: ImageEditorTool): string {
        switch (tool) {
            case 'select':
                return 'fa fa-mouse-pointer';
            case 'snippet':
                return 'fa fa-crop';
            case 'draw':
                return 'fa fa-pencil';
            case 'text':
                return 'fa fa-font';
            case 'image':
                return 'fa fa-adjust';
            case 'shapes':
                return 'fa fa-square-o';
        }
    }

    protected renderToolSidebar(canEditImage: boolean): React.ReactNode {
        const tools: Array<{ id: ImageEditorTool; title: string; disabled?: boolean }> = [
            { id: 'select', title: 'Sélection' },
            { id: 'snippet', title: 'Découper une zone' },
            { id: 'draw', title: 'Dessiner' },
            { id: 'text', title: 'Ajouter du texte' },
            { id: 'shapes', title: 'Ajouter une forme' },
            { id: 'image', title: 'Ajuster l’image', disabled: !canEditImage && !this.image },
        ];

        return (
            <nav className='rounded border border-[var(--theia-panel-border)] bg-[var(--theia-editor-background)] p-1 flex flex-col items-center gap-1'>
                {tools.map(tool => {
                    const active = this.tool === tool.id;
                    return (
                        <button
                            key={tool.id}
                            type='button'
                            className={`theia-button secondary !px-0 w-10 h-9 flex items-center justify-center ${active ? 'border border-sky-500' : ''}`}
                            title={tool.title}
                            aria-label={tool.title}
                            onClick={() => {
                                this.applyTool(tool.id);
                                if (tool.id === 'image') {
                                    this.ensureBaseImageObject();
                                }
                                if (tool.id === 'text') {
                                    this.addText();
                                }
                            }}
                            disabled={Boolean(tool.disabled)}
                        >
                            <i className={this.getToolIcon(tool.id)} aria-hidden='true' />
                        </button>
                    );
                })}
            </nav>
        );
    }

    protected renderWorkflowPanel(img: GeocacheImageV2Dto): React.ReactNode {
        const baseImage = this.getEditorBaseImage();
        const isUsingSeparateBase = Boolean(baseImage && baseImage.id !== img.id);
        const objectCount = Math.max(0, (this.fabricCanvas?.getObjects?.() ?? []).length - (this.getBaseImageObject() ? 1 : 0));
        const hasTransientSnippet = Boolean(this.snippetSelectionRect);
        const snippetBounds = this.snippetSelectionBounds;
        const hasExtraction = Boolean((this.lastExtractedText || '').trim());
        const extractionPreview = (this.lastExtractedText || '').trim();

        return (
            <aside className='rounded border border-[var(--theia-panel-border)] bg-[var(--theia-editor-background)] p-3 text-xs grid gap-3'>
                <div>
                    <div className='font-semibold text-sm'>Mode actif</div>
                    <div className='mt-1 text-[var(--theia-foreground)]'>{this.getToolLabel()}</div>
                    <div className='mt-1 opacity-70 leading-relaxed'>{this.getToolHint()}</div>
                </div>

                <div className='grid gap-1'>
                    <div className='font-semibold'>État</div>
                    <div className='opacity-80'>Calques éditables : {objectCount}</div>
                    <div className='opacity-80'>Zoom : {Math.round(this.imageZoom * 100)}%</div>
                    {hasTransientSnippet && snippetBounds ? (
                        <div className='rounded border border-orange-500/50 bg-orange-500/10 p-2'>
                            <div className='font-semibold text-orange-200'>Zone de découpe</div>
                            <div className='mt-1 opacity-90'>
                                {snippetBounds.width} × {snippetBounds.height}px
                            </div>
                            <div className='opacity-70'>
                                x {snippetBounds.left}, y {snippetBounds.top}
                            </div>
                        </div>
                    ) : hasTransientSnippet ? <div className='opacity-80'>Sélection de découpe prête</div> : null}
                    {this.lastActionMessage ? (
                        <div className='mt-2 rounded border border-[var(--theia-panel-border)] bg-black/10 p-2 opacity-90'>
                            {this.lastActionMessage}
                        </div>
                    ) : null}
                </div>

                {this.snippetPreviewDataUrl ? (
                    <div className='grid gap-2'>
                        <div className='font-semibold'>Aperçu zone</div>
                        <div className='rounded border border-[var(--theia-panel-border)] bg-black/20 p-2'>
                            <img
                                src={this.snippetPreviewDataUrl}
                                alt='Aperçu de la zone sélectionnée'
                                className='max-h-36 w-full object-contain'
                            />
                        </div>
                    </div>
                ) : null}

                {hasExtraction ? (
                    <div className='grid gap-2'>
                        <div className='font-semibold'>Résultat zone</div>
                        <div className='max-h-28 overflow-auto rounded border border-[var(--theia-panel-border)] bg-black/10 p-2 whitespace-pre-wrap'>
                            {extractionPreview.length > 420 ? `${extractionPreview.slice(0, 420)}…` : extractionPreview}
                        </div>
                        <div className='flex flex-wrap gap-2'>
                            <button
                                type='button'
                                className='theia-button secondary'
                                onClick={() => { void this.addLastExtractionToNotes(); }}
                                disabled={this.isSaving}
                            >
                                Ajouter aux notes
                            </button>
                            <button
                                type='button'
                                className='theia-button secondary'
                                onClick={() => this.openLastExtractionInChat()}
                                disabled={this.isSaving}
                            >
                                Envoyer au Chat IA
                            </button>
                        </div>
                    </div>
                ) : null}

                <div className='grid gap-1'>
                    <div className='font-semibold'>Base d’édition</div>
                    <div className='opacity-80'>
                        {isUsingSeparateBase && baseImage
                            ? `Image originale #${baseImage.id}`
                            : `Image #${img.id}`}
                    </div>
                    {isUsingSeparateBase ? (
                        <div className='opacity-70 leading-relaxed'>
                            Les calques sont rouverts sur l’original pour éviter de réappliquer une annotation déjà exportée.
                        </div>
                    ) : null}
                </div>

                <div className='grid gap-1 opacity-70'>
                    <div>Ctrl + molette : zoom autour du pointeur</div>
                    <div>Découpe : Entrée crée une sous-image, Ctrl + Entrée lance l’OCR, Alt + Entrée ouvre la recherche IA/Web.</div>
                    <div>Les sous-images et exports ignorent le rectangle de découpe temporaire.</div>
                </div>
            </aside>
        );
    }

    protected renderBadges(img: GeocacheImageV2Dto): React.ReactNode {
        const badges: { label: string; className: string }[] = [];
        if (img.stored) {
            badges.push({ label: 'LOCAL', className: 'bg-emerald-600/30 text-emerald-200 border-emerald-700/60' });
        }
        if (img.parent_image_id) {
            badges.push({ label: 'DERIVED', className: 'bg-slate-600/30 text-slate-200 border-slate-700/60' });
        }
        if (!badges.length) {
            return null;
        }
        return (
            <div className='flex flex-wrap gap-1'>
                {badges.map(b => (
                    <span key={b.label} className={`text-[10px] px-1.5 py-0.5 rounded border ${b.className}`}>
                        {b.label}
                    </span>
                ))}
            </div>
        );
    }

    protected override render(): React.ReactNode {
        if (!this.geocacheId || !this.imageId) {
            return <div className='p-3 opacity-70'>Aucune image sélectionnée.</div>;
        }

        if (this.isLoading) {
            return <div className='p-3 opacity-70'>Chargement…</div>;
        }

        if (this.error) {
            return <div className='p-3 text-[var(--theia-errorForeground)]'>{this.error}</div>;
        }

        if (!this.image) {
            return <div className='p-3 opacity-70'>Aucune donnée.</div>;
        }

        const img = this.image;

        const canUndo = this.undoStack.length > 1;
        const canRedo = this.redoStack.length > 0;

        const activeText = this.getActiveTextObject();
        const showTextControls = this.tool === 'text' || Boolean(activeText);
        const showDrawControls = this.tool === 'draw';
        const showSelectControls = this.tool === 'select' && this.selectionCount > 0;
        const showImageControls = this.tool === 'image';
        const showShapesControls = this.tool === 'shapes';
        const showSnippetControls = this.tool === 'snippet';
        const activeAny = this.fabricCanvas?.getActiveObject?.();
        const canGroup = Boolean(activeAny && activeAny.type === 'activeSelection');
        const canUngroup = Boolean(activeAny && activeAny.type === 'group');

        const baseImage = this.getBaseImageObject();
        const canEditImage = Boolean(baseImage);

        return (
            <div className='p-3 grid gap-3 h-full min-h-0'>
                <div className='flex items-start justify-between gap-3'>
                    <div className='min-w-0'>
                        <div className='font-semibold truncate'>Image #{img.id}</div>
                        <div className='text-xs opacity-70 truncate'>{img.source_url}</div>
                    </div>
                    {this.renderBadges(img)}
                </div>

                <div className='grid gap-3 xl:grid-cols-[52px_minmax(0,1fr)_320px] min-h-0'>
                    {this.renderToolSidebar(canEditImage)}

                    <div className='min-w-0 grid gap-3 content-start'>
                        <div className='rounded border border-[var(--theia-panel-border)] bg-[var(--theia-editor-background)] p-2 max-h-64 overflow-y-auto'>
                            <div className='flex flex-wrap items-center gap-2'>
                                <div className='w-full flex items-center justify-between gap-2 border-b border-[var(--theia-panel-border)] pb-2 mb-1'>
                                    <div>
                                        <div className='text-xs uppercase opacity-60'>Options</div>
                                        <div className='font-semibold'>{this.getToolLabel()}</div>
                                    </div>
                                    <div className='text-xs opacity-70 text-right'>
                                        {this.selectionCount ? `${this.selectionCount} sélectionné(s)` : 'Aucun calque sélectionné'}
                                    </div>
                                </div>

                    {showSelectControls ? (
                        <div className='flex flex-wrap items-center gap-2 ml-2'>
                            <span className='text-xs opacity-70'>
                                {this.selectionCount} sélectionné(s)
                            </span>

                            <button
                                type='button'
                                className='theia-button secondary'
                                onClick={() => { void this.duplicateSelection(); }}
                            >
                                Dupliquer
                            </button>

                            <button
                                type='button'
                                className='theia-button secondary'
                                onClick={() => this.deleteSelection()}
                            >
                                Supprimer
                            </button>

                            <button
                                type='button'
                                className={`theia-button secondary ${this.selectionLocked ? 'border border-sky-500' : ''}`}
                                onClick={() => this.toggleSelectionLock()}
                            >
                                {this.selectionLocked ? 'Déverrouiller' : 'Verrouiller'}
                            </button>

                            <label className='text-xs opacity-70'>
                                Opacité
                                <input
                                    type='number'
                                    min={0}
                                    max={1}
                                    step={0.05}
                                    value={this.selectionOpacity}
                                    className='ml-2 w-20 theia-input'
                                    onChange={e => {
                                        const next = Number(e.target.value);
                                        if (Number.isFinite(next)) {
                                            this.setSelectionOpacity(next);
                                        }
                                    }}
                                />
                            </label>

                            <button type='button' className='theia-button secondary' onClick={() => this.bringToFront()}>
                                Avant
                            </button>
                            <button type='button' className='theia-button secondary' onClick={() => this.bringForward()}>
                                Monter
                            </button>
                            <button type='button' className='theia-button secondary' onClick={() => this.sendBackwards()}>
                                Descendre
                            </button>
                            <button type='button' className='theia-button secondary' onClick={() => this.sendToBack()}>
                                Arrière
                            </button>

                            <button
                                type='button'
                                className='theia-button secondary'
                                onClick={() => this.groupSelection()}
                                disabled={!canGroup}
                            >
                                Grouper
                            </button>
                            <button
                                type='button'
                                className='theia-button secondary'
                                onClick={() => this.ungroupSelection()}
                                disabled={!canUngroup}
                            >
                                Dégrouper
                            </button>

                            <button
                                type='button'
                                className='theia-button secondary'
                                onClick={() => this.alignSelection('left')}
                                disabled={!canGroup}
                            >
                                Aligner gauche
                            </button>
                            <button
                                type='button'
                                className='theia-button secondary'
                                onClick={() => this.alignSelection('center')}
                                disabled={!canGroup}
                            >
                                Centrer H
                            </button>
                            <button
                                type='button'
                                className='theia-button secondary'
                                onClick={() => this.alignSelection('right')}
                                disabled={!canGroup}
                            >
                                Aligner droite
                            </button>

                            <button
                                type='button'
                                className='theia-button secondary'
                                onClick={() => this.alignSelection('top')}
                                disabled={!canGroup}
                            >
                                Aligner haut
                            </button>
                            <button
                                type='button'
                                className='theia-button secondary'
                                onClick={() => this.alignSelection('middle')}
                                disabled={!canGroup}
                            >
                                Centrer V
                            </button>
                            <button
                                type='button'
                                className='theia-button secondary'
                                onClick={() => this.alignSelection('bottom')}
                                disabled={!canGroup}
                            >
                                Aligner bas
                            </button>
                        </div>
                    ) : null}

                    {showSnippetControls ? (
                        <div className='flex flex-wrap items-center gap-2 ml-2'>
                            {this.snippetSelectionBounds ? (
                                <span className='text-xs rounded border border-orange-500/50 bg-orange-500/10 px-2 py-1'>
                                    {this.snippetSelectionBounds.width} × {this.snippetSelectionBounds.height}px
                                </span>
                            ) : null}

                            <button
                                type='button'
                                className='theia-button secondary'
                                onClick={() => this.clearSnippetSelection()}
                                disabled={!this.snippetSelectionRect}
                            >
                                Effacer sélection
                            </button>

                            <button
                                type='button'
                                className='theia-button'
                                onClick={() => { void this.createSnippetFromSelection(); }}
                                disabled={this.isSaving || !this.snippetSelectionRect}
                            >
                                {this.activeSnippetAction === 'create' ? 'Création…' : 'Créer sous-image'}
                            </button>

                            <button
                                type='button'
                                className='theia-button secondary'
                                onClick={() => { void this.runOcrOnSnippetSelection(); }}
                                disabled={this.isSaving || !this.snippetSelectionRect}
                                title='Créer une sous-image puis lancer EasyOCR dessus'
                            >
                                {this.activeSnippetAction === 'ocr' ? 'OCR…' : 'OCR zone'}
                            </button>

                            <button
                                type='button'
                                className='theia-button secondary'
                                onClick={() => { void this.runQrOnSnippetSelection(); }}
                                disabled={this.isSaving || !this.snippetSelectionRect}
                                title='Créer une sous-image puis lancer le détecteur QR dessus'
                            >
                                {this.activeSnippetAction === 'qr' ? 'QR…' : 'QR zone'}
                            </button>

                            <button
                                type='button'
                                className='theia-button secondary'
                                onClick={() => { void this.runVisualSearchOnSnippetSelection(); }}
                                disabled={this.isSaving || !this.snippetSelectionRect}
                                title='Créer une sous-image puis ouvrir le Chat IA avec recherche web'
                            >
                                {this.activeSnippetAction === 'visual-search' ? 'Recherche…' : 'Recherche IA/Web'}
                            </button>
                        </div>
                    ) : null}

                    {showShapesControls ? (
                        <div className='flex flex-wrap items-center gap-2 ml-2'>
                            <label className='text-xs opacity-70'>
                                Type
                                <select
                                    className='ml-2 theia-input'
                                    value={this.shapeType}
                                    onChange={e => {
                                        this.shapeType = e.target.value as any;
                                        this.update();
                                    }}
                                >
                                    <option value='rect'>Rectangle</option>
                                    <option value='circle'>Cercle</option>
                                    <option value='triangle'>Triangle</option>
                                    <option value='line'>Ligne</option>
                                    <option value='arrow'>Flèche</option>
                                </select>
                            </label>

                            <label className='text-xs opacity-70'>
                                Largeur
                                <input
                                    type='number'
                                    min={10}
                                    max={4000}
                                    value={this.shapeWidth}
                                    className='ml-2 w-24 theia-input'
                                    onChange={e => {
                                        const next = Number(e.target.value);
                                        if (Number.isFinite(next) && next > 0) {
                                            this.shapeWidth = Math.floor(next);
                                            this.update();
                                        }
                                    }}
                                />
                            </label>

                            <label className='text-xs opacity-70'>
                                Hauteur
                                <input
                                    type='number'
                                    min={10}
                                    max={4000}
                                    value={this.shapeHeight}
                                    className='ml-2 w-24 theia-input'
                                    onChange={e => {
                                        const next = Number(e.target.value);
                                        if (Number.isFinite(next) && next > 0) {
                                            this.shapeHeight = Math.floor(next);
                                            this.update();
                                        }
                                    }}
                                />
                            </label>

                            {this.shapeType === 'rect' ? (
                                <label className='text-xs opacity-70'>
                                    Rayon
                                    <input
                                        type='number'
                                        min={0}
                                        max={500}
                                        value={this.shapeCornerRadius}
                                        className='ml-2 w-20 theia-input'
                                        onChange={e => {
                                            const next = Number(e.target.value);
                                            if (Number.isFinite(next) && next >= 0) {
                                                this.shapeCornerRadius = Math.floor(next);
                                                this.update();
                                            }
                                        }}
                                    />
                                </label>
                            ) : null}

                            <label className='text-xs opacity-70 flex items-center gap-2'>
                                Remplissage
                                <input
                                    type='color'
                                    value={this.shapeFill}
                                    className='h-7 w-10 bg-transparent'
                                    onChange={e => {
                                        this.shapeFill = e.target.value;
                                        this.update();
                                    }}
                                />
                            </label>

                            <label className='text-xs opacity-70'>
                                Opacité rempl.
                                <input
                                    type='number'
                                    min={0}
                                    max={1}
                                    step={0.05}
                                    value={this.shapeFillOpacity}
                                    className='ml-2 w-20 theia-input'
                                    onChange={e => {
                                        const next = Number(e.target.value);
                                        if (Number.isFinite(next)) {
                                            this.shapeFillOpacity = this.clamp(next, 0, 1);
                                            this.update();
                                        }
                                    }}
                                />
                            </label>

                            <label className='text-xs opacity-70 flex items-center gap-2'>
                                Contour
                                <input
                                    type='color'
                                    value={this.shapeStroke}
                                    className='h-7 w-10 bg-transparent'
                                    onChange={e => {
                                        this.shapeStroke = e.target.value;
                                        this.update();
                                    }}
                                />
                            </label>

                            <label className='text-xs opacity-70'>
                                Épaisseur
                                <input
                                    type='number'
                                    min={0}
                                    max={200}
                                    value={this.shapeStrokeWidth}
                                    className='ml-2 w-20 theia-input'
                                    onChange={e => {
                                        const next = Number(e.target.value);
                                        if (Number.isFinite(next) && next >= 0) {
                                            this.shapeStrokeWidth = Math.floor(next);
                                            this.update();
                                        }
                                    }}
                                />
                            </label>

                            <label className='text-xs opacity-70'>
                                Opacité
                                <input
                                    type='number'
                                    min={0}
                                    max={1}
                                    step={0.05}
                                    value={this.shapeOpacity}
                                    className='ml-2 w-20 theia-input'
                                    onChange={e => {
                                        const next = Number(e.target.value);
                                        if (Number.isFinite(next)) {
                                            this.shapeOpacity = this.clamp(next, 0, 1);
                                            this.update();
                                        }
                                    }}
                                />
                            </label>

                            <button
                                type='button'
                                className='theia-button secondary'
                                onClick={() => this.addShape()}
                            >
                                Ajouter
                            </button>
                        </div>
                    ) : null}
                    {showImageControls ? (
                        <div className='flex flex-wrap items-center gap-2 ml-2'>
                            <span className='text-xs opacity-70'>Ajustements image</span>

                            <label className='text-xs opacity-70'>
                                Zoom
                                <input
                                    type='number'
                                    min={0.1}
                                    max={6}
                                    step={0.1}
                                    value={this.imageZoom}
                                    className='ml-2 w-20 theia-input'
                                    onChange={e => {
                                        const next = Number(e.target.value);
                                        if (Number.isFinite(next)) {
                                            this.imageZoom = this.clamp(next, 0.1, 6);
                                            this.applyZoom();
                                            this.update();
                                        }
                                    }}
                                />
                            </label>

                            <button
                                type='button'
                                className='theia-button secondary'
                                onClick={() => {
                                    this.imageZoom = 1;
                                    this.applyZoom();
                                    this.update();
                                }}
                            >
                                100%
                            </button>

                            <label className='text-xs opacity-70'>
                                Échelle image
                                <input
                                    type='number'
                                    min={0.1}
                                    max={10}
                                    step={0.1}
                                    value={this.imageScale}
                                    className='ml-2 w-20 theia-input'
                                    onChange={e => {
                                        const next = Number(e.target.value);
                                        if (Number.isFinite(next)) {
                                            this.imageScale = this.clamp(next, 0.1, 10);
                                            this.applyImageScale();
                                        }
                                    }}
                                />
                            </label>

                            <button
                                type='button'
                                className='theia-button secondary'
                                onClick={() => this.rotateImage(-90)}
                            >
                                ↺ 90°
                            </button>
                            <button
                                type='button'
                                className='theia-button secondary'
                                onClick={() => this.rotateImage(90)}
                            >
                                ↻ 90°
                            </button>
                            <button
                                type='button'
                                className='theia-button secondary'
                                onClick={() => this.flipImage('x')}
                            >
                                Flip X
                            </button>
                            <button
                                type='button'
                                className='theia-button secondary'
                                onClick={() => this.flipImage('y')}
                            >
                                Flip Y
                            </button>

                            <label className='text-xs opacity-70'>
                                Canvas W
                                <input
                                    type='number'
                                    min={100}
                                    max={8000}
                                    value={this.imageCanvasWidth || (this.fabricCanvas?.getWidth?.() ?? 0)}
                                    className='ml-2 w-24 theia-input'
                                    onChange={e => {
                                        const next = Number(e.target.value);
                                        if (Number.isFinite(next) && next > 0) {
                                            this.imageCanvasWidth = Math.floor(next);
                                            this.update();
                                        }
                                    }}
                                />
                            </label>
                            <label className='text-xs opacity-70'>
                                H
                                <input
                                    type='number'
                                    min={100}
                                    max={8000}
                                    value={this.imageCanvasHeight || (this.fabricCanvas?.getHeight?.() ?? 0)}
                                    className='ml-2 w-24 theia-input'
                                    onChange={e => {
                                        const next = Number(e.target.value);
                                        if (Number.isFinite(next) && next > 0) {
                                            this.imageCanvasHeight = Math.floor(next);
                                            this.update();
                                        }
                                    }}
                                />
                            </label>
                            <button
                                type='button'
                                className='theia-button secondary'
                                onClick={() => this.resizeCanvas(this.imageCanvasWidth, this.imageCanvasHeight)}
                            >
                                Appliquer taille
                            </button>

                            <button
                                type='button'
                                className='theia-button secondary'
                                onClick={() => this.resetImageEdits()}
                            >
                                Reset image
                            </button>

                            <div className='w-full' />

                            <label className='text-xs opacity-70'>
                                Luminosité
                                <input
                                    type='number'
                                    min={-1}
                                    max={1}
                                    step={0.05}
                                    value={this.imageBrightness}
                                    className='ml-2 w-20 theia-input'
                                    onChange={e => {
                                        const next = Number(e.target.value);
                                        if (Number.isFinite(next)) {
                                            this.imageBrightness = this.clamp(next, -1, 1);
                                            this.applyImageFilters();
                                            this.update();
                                        }
                                    }}
                                />
                            </label>

                            <label className='text-xs opacity-70'>
                                Contraste
                                <input
                                    type='number'
                                    min={-1}
                                    max={1}
                                    step={0.05}
                                    value={this.imageContrast}
                                    className='ml-2 w-20 theia-input'
                                    onChange={e => {
                                        const next = Number(e.target.value);
                                        if (Number.isFinite(next)) {
                                            this.imageContrast = this.clamp(next, -1, 1);
                                            this.applyImageFilters();
                                            this.update();
                                        }
                                    }}
                                />
                            </label>

                            <label className='text-xs opacity-70'>
                                Saturation
                                <input
                                    type='number'
                                    min={-1}
                                    max={1}
                                    step={0.05}
                                    value={this.imageSaturation}
                                    className='ml-2 w-20 theia-input'
                                    onChange={e => {
                                        const next = Number(e.target.value);
                                        if (Number.isFinite(next)) {
                                            this.imageSaturation = this.clamp(next, -1, 1);
                                            this.applyImageFilters();
                                            this.update();
                                        }
                                    }}
                                />
                            </label>

                            <label className='text-xs opacity-70'>
                                Hue (°)
                                <input
                                    type='number'
                                    min={-180}
                                    max={180}
                                    step={1}
                                    value={this.imageHueRotationDeg}
                                    className='ml-2 w-20 theia-input'
                                    onChange={e => {
                                        const next = Number(e.target.value);
                                        if (Number.isFinite(next)) {
                                            this.imageHueRotationDeg = this.clamp(next, -180, 180);
                                            this.applyImageFilters();
                                            this.update();
                                        }
                                    }}
                                />
                            </label>

                            <label className='text-xs opacity-70'>
                                Flou
                                <input
                                    type='number'
                                    min={0}
                                    max={1}
                                    step={0.05}
                                    value={this.imageBlur}
                                    className='ml-2 w-20 theia-input'
                                    onChange={e => {
                                        const next = Number(e.target.value);
                                        if (Number.isFinite(next)) {
                                            this.imageBlur = this.clamp(next, 0, 1);
                                            this.applyImageFilters();
                                            this.update();
                                        }
                                    }}
                                />
                            </label>

                            <label className='text-xs opacity-70 flex items-center gap-2'>
                                N&B
                                <input
                                    type='checkbox'
                                    checked={this.imageGrayscale}
                                    onChange={e => {
                                        this.imageGrayscale = e.target.checked;
                                        this.applyImageFilters();
                                        this.update();
                                    }}
                                />
                            </label>
                            <label className='text-xs opacity-70 flex items-center gap-2'>
                                Sépia
                                <input
                                    type='checkbox'
                                    checked={this.imageSepia}
                                    onChange={e => {
                                        this.imageSepia = e.target.checked;
                                        this.applyImageFilters();
                                        this.update();
                                    }}
                                />
                            </label>
                            <label className='text-xs opacity-70 flex items-center gap-2'>
                                Inverser
                                <input
                                    type='checkbox'
                                    checked={this.imageInvert}
                                    onChange={e => {
                                        this.imageInvert = e.target.checked;
                                        this.applyImageFilters();
                                        this.update();
                                    }}
                                />
                            </label>

                            <div className='w-full' />
                            <span className='text-xs opacity-70 font-semibold'>Canaux RGB</span>

                            <label className='text-xs opacity-70'>
                                Rouge
                                <input
                                    type='number'
                                    min={0}
                                    max={2}
                                    step={0.05}
                                    value={this.imageRedChannel}
                                    className='ml-2 w-20 theia-input'
                                    onChange={e => {
                                        const next = Number(e.target.value);
                                        if (Number.isFinite(next)) {
                                            this.imageRedChannel = this.clamp(next, 0, 2);
                                            this.applyImageFilters();
                                            this.update();
                                        }
                                    }}
                                />
                            </label>

                            <label className='text-xs opacity-70'>
                                Vert
                                <input
                                    type='number'
                                    min={0}
                                    max={2}
                                    step={0.05}
                                    value={this.imageGreenChannel}
                                    className='ml-2 w-20 theia-input'
                                    onChange={e => {
                                        const next = Number(e.target.value);
                                        if (Number.isFinite(next)) {
                                            this.imageGreenChannel = this.clamp(next, 0, 2);
                                            this.applyImageFilters();
                                            this.update();
                                        }
                                    }}
                                />
                            </label>

                            <label className='text-xs opacity-70'>
                                Bleu
                                <input
                                    type='number'
                                    min={0}
                                    max={2}
                                    step={0.05}
                                    value={this.imageBlueChannel}
                                    className='ml-2 w-20 theia-input'
                                    onChange={e => {
                                        const next = Number(e.target.value);
                                        if (Number.isFinite(next)) {
                                            this.imageBlueChannel = this.clamp(next, 0, 2);
                                            this.applyImageFilters();
                                            this.update();
                                        }
                                    }}
                                />
                            </label>

                            <div className='w-full' />

                            <button
                                type='button'
                                className={`theia-button secondary ${this.showCurvesEditor ? 'border border-sky-500' : ''}`}
                                onClick={() => {
                                    this.showCurvesEditor = !this.showCurvesEditor;
                                    this.update();
                                }}
                            >
                                {this.showCurvesEditor ? 'Masquer courbes' : 'Courbes'}
                            </button>

                            {this.showCurvesEditor ? (
                                <div className='w-full mt-2 p-3 border border-[var(--theia-panel-border)] rounded bg-[var(--theia-editor-background)]'>
                                    <CurvesEditor
                                        channel={this.curvesChannel}
                                        points={this.getCurvesPoints(this.curvesChannel)}
                                        onPointsChange={points => {
                                            this.setCurvesPoints(this.curvesChannel, points);
                                            this.applyImageFilters();
                                            this.update();
                                        }}
                                        onChannelChange={channel => {
                                            this.curvesChannel = channel;
                                            this.update();
                                        }}
                                        onReset={() => this.resetCurves(this.curvesChannel)}
                                        onApplyPreset={preset => this.applyCurvesPreset(preset)}
                                    />
                                </div>
                            ) : null}
                        </div>
                    ) : null}

                    {showDrawControls ? (
                        <div className='flex flex-wrap items-center gap-2 ml-2'>
                            <label className='text-xs opacity-70'>
                                Mode
                                <select
                                    className='ml-2 theia-input'
                                    value={this.drawBrushType}
                                    onChange={e => {
                                        this.drawBrushType = e.target.value as any;
                                        this.applyDrawOptions();
                                        this.update();
                                    }}
                                >
                                    <option value='pen'>Pinceau</option>
                                    <option value='highlighter'>Surligneur</option>
                                    <option value='eraser'>Gomme</option>
                                </select>
                            </label>

                            <label className='text-xs opacity-70'>
                                Taille
                                <input
                                    type='number'
                                    min={1}
                                    max={200}
                                    value={this.drawBrushSize}
                                    className='ml-2 w-20 theia-input'
                                    onChange={e => {
                                        const next = Number(e.target.value);
                                        if (Number.isFinite(next) && next > 0) {
                                            this.drawBrushSize = this.clamp(next, 1, 200);
                                            this.applyDrawOptions();
                                            this.update();
                                        }
                                    }}
                                />
                            </label>

                            <label className='text-xs opacity-70 flex items-center gap-2'>
                                Couleur
                                <input
                                    type='color'
                                    value={this.drawColor}
                                    className='h-7 w-10 bg-transparent'
                                    disabled={this.drawBrushType === 'eraser'}
                                    onChange={e => {
                                        this.drawColor = e.target.value;
                                        this.applyDrawOptions();
                                        this.update();
                                    }}
                                />
                            </label>

                            <label className='text-xs opacity-70'>
                                Opacité
                                <input
                                    type='number'
                                    min={0}
                                    max={1}
                                    step={0.05}
                                    value={this.drawOpacity}
                                    disabled={this.drawBrushType === 'eraser'}
                                    className='ml-2 w-20 theia-input'
                                    onChange={e => {
                                        const next = Number(e.target.value);
                                        if (Number.isFinite(next)) {
                                            this.drawOpacity = this.clamp(next, 0, 1);
                                            this.applyDrawOptions();
                                            this.update();
                                        }
                                    }}
                                />
                            </label>

                            <label className='text-xs opacity-70'>
                                Cap
                                <select
                                    className='ml-2 theia-input'
                                    value={this.drawLineCap}
                                    onChange={e => {
                                        this.drawLineCap = e.target.value as any;
                                        this.applyDrawOptions();
                                        this.update();
                                    }}
                                >
                                    <option value='round'>Round</option>
                                    <option value='butt'>Butt</option>
                                    <option value='square'>Square</option>
                                </select>
                            </label>

                            <label className='text-xs opacity-70'>
                                Join
                                <select
                                    className='ml-2 theia-input'
                                    value={this.drawLineJoin}
                                    onChange={e => {
                                        this.drawLineJoin = e.target.value as any;
                                        this.applyDrawOptions();
                                        this.update();
                                    }}
                                >
                                    <option value='round'>Round</option>
                                    <option value='bevel'>Bevel</option>
                                    <option value='miter'>Miter</option>
                                </select>
                            </label>

                            <label className='text-xs opacity-70'>
                                Lissage
                                <input
                                    type='number'
                                    min={0}
                                    max={1}
                                    step={0.05}
                                    value={this.drawDecimate}
                                    className='ml-2 w-20 theia-input'
                                    onChange={e => {
                                        const next = Number(e.target.value);
                                        if (Number.isFinite(next)) {
                                            this.drawDecimate = this.clamp(next, 0, 1);
                                            this.applyDrawOptions();
                                            this.update();
                                        }
                                    }}
                                />
                            </label>

                            <button
                                type='button'
                                className='theia-button secondary'
                                onClick={() => this.deleteSelection()}
                            >
                                Supprimer sélection
                            </button>
                        </div>
                    ) : null}
                    {showTextControls ? (
                        <div className='flex flex-wrap items-center gap-2 ml-2'>
                            <label className='text-xs opacity-70'>
                                Taille
                                <input
                                    type='number'
                                    min={8}
                                    max={200}
                                    value={this.textFontSize}
                                    className='ml-2 w-20 theia-input'
                                    onChange={e => {
                                        const next = Number(e.target.value);
                                        if (Number.isFinite(next) && next > 0) {
                                            this.textFontSize = next;
                                            this.applyTextOptionsToSelection();
                                            this.update();
                                        }
                                    }}
                                />
                            </label>

                            <label className='text-xs opacity-70 flex items-center gap-2'>
                                Couleur
                                <input
                                    type='color'
                                    value={this.textFill}
                                    className='h-7 w-10 bg-transparent'
                                    onChange={e => {
                                        this.textFill = e.target.value;
                                        this.applyTextOptionsToSelection();
                                        this.update();
                                    }}
                                />
                            </label>

                            <button
                                type='button'
                                className={`theia-button secondary ${this.textBold ? 'border border-sky-500' : ''}`}
                                onClick={() => {
                                    this.textBold = !this.textBold;
                                    this.applyTextOptionsToSelection();
                                    this.update();
                                }}
                            >
                                Gras
                            </button>

                            <button
                                type='button'
                                className={`theia-button secondary ${this.textItalic ? 'border border-sky-500' : ''}`}
                                onClick={() => {
                                    this.textItalic = !this.textItalic;
                                    this.applyTextOptionsToSelection();
                                    this.update();
                                }}
                            >
                                Italique
                            </button>

                            <label className='text-xs opacity-70 flex items-center gap-2 ml-2'>
                                Fond
                                <input
                                    type='checkbox'
                                    checked={this.textBackgroundEnabled}
                                    onChange={e => {
                                        this.textBackgroundEnabled = e.target.checked;
                                        this.applyTextOptionsToSelection();
                                        this.update();
                                    }}
                                />
                            </label>

                            <label className='text-xs opacity-70 flex items-center gap-2'>
                                Couleur fond
                                <input
                                    type='color'
                                    value={this.textBackgroundFill}
                                    className='h-7 w-10 bg-transparent'
                                    disabled={!this.textBackgroundEnabled}
                                    onChange={e => {
                                        this.textBackgroundFill = e.target.value;
                                        this.applyTextOptionsToSelection();
                                        this.update();
                                    }}
                                />
                            </label>

                            <label className='text-xs opacity-70'>
                                Opacité
                                <input
                                    type='number'
                                    min={0}
                                    max={1}
                                    step={0.05}
                                    value={this.textBackgroundOpacity}
                                    disabled={!this.textBackgroundEnabled}
                                    className='ml-2 w-20 theia-input'
                                    onChange={e => {
                                        const next = Number(e.target.value);
                                        if (Number.isFinite(next)) {
                                            this.textBackgroundOpacity = this.clamp(next, 0, 1);
                                            this.applyTextOptionsToSelection();
                                            this.update();
                                        }
                                    }}
                                />
                            </label>
                        </div>
                    ) : null}

                    <div className='flex-1' />

                    <button
                        type='button'
                        className='theia-button'
                        onClick={() => { void this.save(); }}
                        disabled={this.isSaving}
                    >
                        {this.isSaving ? 'Sauvegarde…' : 'Mettre à jour'}
                    </button>

                    <button
                        type='button'
                        className='theia-button secondary'
                        onClick={() => { void this.saveAsNew(); }}
                        disabled={this.isSaving}
                    >
                        Créer version
                    </button>

                    <button
                        type='button'
                        className='theia-button secondary'
                        onClick={() => this.undo()}
                        disabled={!canUndo}
                    >
                        Annuler
                    </button>
                    <button
                        type='button'
                        className='theia-button secondary'
                        onClick={() => this.redo()}
                        disabled={!canRedo}
                    >
                        Rétablir
                    </button>
                </div>
                        </div>

                        <div className='rounded border border-[var(--theia-panel-border)] bg-[var(--theia-editor-background)] p-2 overflow-auto'>
                            <canvas className='w-full rounded bg-black/20' ref={this.setCanvasRef} />
                        </div>

                        <div className='text-xs opacity-70'>
                            {img.title ? <div>Titre: {img.title}</div> : null}
                            {img.note ? <div>Note: {img.note}</div> : null}
                        </div>
                    </div>

                    {this.renderWorkflowPanel(img)}
                </div>
            </div>
        );
    }
}
