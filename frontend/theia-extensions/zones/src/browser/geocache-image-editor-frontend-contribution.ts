// Frontend contribution responsible for opening image editor tabs from global events.

import { inject, injectable } from '@theia/core/shared/inversify';
import { FrontendApplication, FrontendApplicationContribution } from '@theia/core/lib/browser';
import { GeocacheImageEditorTabsManager } from './geocache-image-editor-tabs-manager';

export type OpenGeocacheImageEditorEventDetail = {
    backendBaseUrl: string;
    geocacheId: number;
    imageId: number;
    imageTitle?: string;
};

@injectable()
export class GeocacheImageEditorFrontendContribution implements FrontendApplicationContribution {

    @inject(GeocacheImageEditorTabsManager)
    protected readonly tabsManager: GeocacheImageEditorTabsManager;

    async onStart(_app: FrontendApplication): Promise<void> {
        if (typeof window === 'undefined') {
            return;
        }

        window.addEventListener('open-geocache-image-editor', (event: Event) => {
            const custom = event as CustomEvent<OpenGeocacheImageEditorEventDetail>;
            const detail = custom.detail;
            if (!detail || !detail.geocacheId || !detail.imageId) {
                return;
            }

            void this.tabsManager.openImageEditor({
                backendBaseUrl: detail.backendBaseUrl,
                geocacheId: detail.geocacheId,
                imageId: detail.imageId,
                imageTitle: detail.imageTitle,
            });
        });
    }
}
