import { inject, injectable } from '@theia/core/shared/inversify';
import { PreferenceService } from '@theia/core/lib/common/preferences/preference-service';
import { PreferenceScope } from '@theia/core/lib/common/preferences/preference-scope';
import { DescriptionVariant, GeocacheDto } from './geocache-details-types';

export type GeocacheImagesStorageDefaultMode = 'never' | 'prompt' | 'always';
export type GeocacheImagesGalleryThumbnailSize = 'small' | 'medium' | 'large';
export type GeocacheOcrDefaultEngine = 'easyocr_ocr' | 'vision_ocr';
export type GeocacheExternalLinksOpenMode = 'new-tab' | 'new-window';
export type GcPersonalNoteAutoSyncMode = 'manual' | 'onNotesOpen' | 'onDetailsOpen';

@injectable()
export class GeocacheDetailsPreferencesController {
    private readonly displayDecodedHintsPreferenceKey = 'geoApp.geocache.hints.displayDecoded';
    private readonly descriptionDefaultVariantPreferenceKey = 'geoApp.geocache.description.defaultVariant';
    private readonly externalLinksOpenModePreferenceKey = 'geoApp.geocache.externalLinks.openMode';
    private readonly imagesStorageDefaultModePreferenceKey = 'geoApp.images.storage.defaultMode';
    private readonly imagesGalleryThumbnailSizePreferenceKey = 'geoApp.images.gallery.thumbnailSize';
    private readonly imagesGalleryHiddenDomainsPreferenceKey = 'geoApp.images.gallery.hiddenDomains';
    private readonly ocrDefaultEnginePreferenceKey = 'geoApp.ocr.defaultEngine';
    private readonly ocrDefaultLanguagePreferenceKey = 'geoApp.ocr.defaultLanguage';
    private readonly ocrLmstudioBaseUrlPreferenceKey = 'geoApp.ocr.lmstudio.baseUrl';
    private readonly ocrLmstudioModelPreferenceKey = 'geoApp.ocr.lmstudio.model';

    constructor(
        @inject(PreferenceService) protected readonly preferenceService: PreferenceService
    ) {}

    getGcPersonalNoteAutoSyncMode(): GcPersonalNoteAutoSyncMode {
        const raw = this.preferenceService.get('geoApp.notes.gcPersonalNote.autoSyncMode', 'manual') as string;
        if (raw === 'onNotesOpen' || raw === 'onDetailsOpen' || raw === 'manual') {
            return raw;
        }
        return 'manual';
    }

    getDefaultDescriptionVariant(data: GeocacheDto): DescriptionVariant {
        const raw = this.preferenceService.get(this.descriptionDefaultVariantPreferenceKey, 'auto') as string;
        const hasModified = Boolean(data.description_override_raw) || Boolean(data.description_override_html);
        if (raw === 'original') {
            return 'original';
        }
        if (raw === 'modified') {
            return hasModified ? 'modified' : 'original';
        }
        return hasModified ? 'modified' : 'original';
    }

    getDisplayDecodedHints(): boolean {
        return this.preferenceService.get(this.displayDecodedHintsPreferenceKey, false) as boolean;
    }

    async toggleHintsDisplayMode(): Promise<void> {
        const current = this.getDisplayDecodedHints();
        await this.preferenceService.set(this.displayDecodedHintsPreferenceKey, !current, PreferenceScope.User);
    }

    getExternalLinksOpenMode(): GeocacheExternalLinksOpenMode {
        const raw = this.preferenceService.get(this.externalLinksOpenModePreferenceKey, 'new-tab') as string;
        return raw === 'new-window' ? 'new-window' : 'new-tab';
    }

    getImagesStorageDefaultMode(): GeocacheImagesStorageDefaultMode {
        const raw = this.preferenceService.get(this.imagesStorageDefaultModePreferenceKey, 'prompt') as string;
        if (raw === 'never' || raw === 'prompt' || raw === 'always') {
            return raw;
        }
        return 'prompt';
    }

    getImagesGalleryThumbnailSize(): GeocacheImagesGalleryThumbnailSize {
        const raw = this.preferenceService.get(this.imagesGalleryThumbnailSizePreferenceKey, 'small') as string;
        if (raw === 'small' || raw === 'medium' || raw === 'large') {
            return raw;
        }
        return 'small';
    }

    async setImagesGalleryThumbnailSize(size: GeocacheImagesGalleryThumbnailSize): Promise<void> {
        await this.preferenceService.set(this.imagesGalleryThumbnailSizePreferenceKey, size, PreferenceScope.User);
    }

    getImagesGalleryHiddenDomainsText(): string {
        const raw = this.preferenceService.get(this.imagesGalleryHiddenDomainsPreferenceKey, '') as unknown;
        if (typeof raw === 'string') {
            return raw;
        }
        if (Array.isArray(raw)) {
            return raw.filter((value): value is string => typeof value === 'string').join('\n');
        }
        return '';
    }

    async setImagesGalleryHiddenDomainsText(value: string): Promise<void> {
        await this.preferenceService.set(this.imagesGalleryHiddenDomainsPreferenceKey, value ?? '', PreferenceScope.User);
    }

    getOcrDefaultEngine(): GeocacheOcrDefaultEngine {
        const raw = this.preferenceService.get(this.ocrDefaultEnginePreferenceKey, 'easyocr_ocr') as string;
        return raw === 'vision_ocr' ? 'vision_ocr' : 'easyocr_ocr';
    }

    getOcrDefaultLanguage(): string {
        const raw = this.preferenceService.get(this.ocrDefaultLanguagePreferenceKey, 'auto') as string;
        return (raw || 'auto').toString();
    }

    getOcrLmstudioBaseUrl(): string {
        const raw = this.preferenceService.get(this.ocrLmstudioBaseUrlPreferenceKey, 'http://localhost:1234') as string;
        return (raw || 'http://localhost:1234').toString();
    }

    getOcrLmstudioModel(): string {
        const raw = this.preferenceService.get(this.ocrLmstudioModelPreferenceKey, '') as string;
        return (raw || '').toString();
    }

    getImagesGalleryHiddenDomains(): string[] {
        const raw = this.preferenceService.get(this.imagesGalleryHiddenDomainsPreferenceKey, '') as unknown;
        if (Array.isArray(raw)) {
            return raw
                .filter((value): value is string => typeof value === 'string')
                .map(value => value.trim().toLowerCase())
                .filter(value => Boolean(value));
        }

        if (typeof raw !== 'string') {
            return [];
        }

        return raw
            .split(/[\n\r,;]+/g)
            .map(value => value.trim().toLowerCase())
            .filter(value => Boolean(value));
    }
}
