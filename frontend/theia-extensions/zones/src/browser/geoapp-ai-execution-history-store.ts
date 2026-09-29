import { inject, injectable } from '@theia/core/shared/inversify';
import { StorageService } from '@theia/core/lib/browser';
import {
    GEOAPP_AI_EXECUTION_HISTORY_STORAGE_KEY,
    GeoAppAiExecutionHistoryPayload,
    GeoAppAiExecutionHistoryStore,
} from './geoapp-ai-execution-service';

@injectable()
export class TheiaGeoAppAiExecutionHistoryStore implements GeoAppAiExecutionHistoryStore {

    @inject(StorageService)
    protected readonly storageService!: StorageService;

    load(): Promise<unknown> {
        return this.storageService.getData<unknown>(GEOAPP_AI_EXECUTION_HISTORY_STORAGE_KEY);
    }

    save(payload: GeoAppAiExecutionHistoryPayload): Promise<void> {
        return this.storageService.setData(GEOAPP_AI_EXECUTION_HISTORY_STORAGE_KEY, payload);
    }

    clear(): Promise<void> {
        return this.storageService.setData(GEOAPP_AI_EXECUTION_HISTORY_STORAGE_KEY, undefined);
    }
}
