import { injectable, inject } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution, FrontendApplication } from '@theia/core/lib/browser';
import { FrontendApplicationStateService } from '@theia/core/lib/browser/frontend-application-state';

@injectable()
export class LoadingStatusContribution implements FrontendApplicationContribution {

    @inject(FrontendApplicationStateService)
    protected readonly stateService: FrontendApplicationStateService;

    initialize(): void {
        this.sendLoadingState('starting_contributions');

        this.stateService.onStateChanged(state => {
            this.sendLoadingState(state);
        });
    }

    async onStart(_app: FrontendApplication): Promise<void> {
        this.sendLoadingState('attached_shell');
    }

    protected sendLoadingState(state: string): void {
        try {
            const event = new CustomEvent('theia-loading-state', {
                detail: { state }
            });
            window.dispatchEvent(event);

            if (typeof (window as any).updateLoadingStatus === 'function') {
                (window as any).updateLoadingStatus(state);
            }
        } catch (error) {
            console.debug('[LoadingStatus] Could not send loading state:', error);
        }
    }
}
