import { inject, injectable } from '@theia/core/shared/inversify';
import { BackendApiClient } from 'theia-ide-zones-ext/lib/browser/backend-api-client';
import {
    LoggingTaskDto,
    LoggingTaskInput,
    LoggingTasksApiResponse,
} from './earthcoach-logging-tasks';

interface LoggingTaskMutationResponse {
    logging_task: LoggingTaskDto;
    geocache_id?: number;
}

@injectable()
export class EarthCoachLoggingTaskService {

    @inject(BackendApiClient)
    protected readonly apiClient!: BackendApiClient;

    async listLoggingTasks(geocacheId: number): Promise<LoggingTasksApiResponse> {
        return this.apiClient.requestJson<LoggingTasksApiResponse>(
            `/api/geocaches/${geocacheId}/logging-tasks`,
            {},
            'Erreur lors du chargement des questions du proprietaire'
        );
    }

    async createLoggingTask(geocacheId: number, payload: LoggingTaskInput): Promise<LoggingTaskDto> {
        const response = await this.apiClient.requestJson<LoggingTaskMutationResponse>(
            `/api/geocaches/${geocacheId}/logging-tasks`,
            this.apiClient.createJsonInit('POST', payload),
            'Erreur lors de la creation de la question'
        );
        return response.logging_task;
    }

    async updateLoggingTask(taskId: number, payload: LoggingTaskInput): Promise<LoggingTaskDto> {
        const response = await this.apiClient.requestJson<LoggingTaskMutationResponse>(
            `/api/logging-tasks/${taskId}`,
            this.apiClient.createJsonInit('PUT', payload),
            'Erreur lors de la mise a jour de la question'
        );
        return response.logging_task;
    }

    async linkObservation(taskId: number, observationId: number | null): Promise<LoggingTaskDto> {
        const response = await this.apiClient.requestJson<LoggingTaskMutationResponse>(
            `/api/logging-tasks/${taskId}`,
            this.apiClient.createJsonInit('PUT', { observation_id: observationId }),
            'Erreur lors de la liaison de l observation a la question'
        );
        return response.logging_task;
    }

    async deleteLoggingTask(taskId: number): Promise<void> {
        await this.apiClient.requestVoid(
            `/api/logging-tasks/${taskId}`,
            { method: 'DELETE' },
            'Erreur lors de la suppression de la question'
        );
    }

    async replaceLoggingTasks(
        geocacheId: number,
        tasks: LoggingTaskInput[],
        source = 'extracted'
    ): Promise<LoggingTasksApiResponse> {
        return this.apiClient.requestJson<LoggingTasksApiResponse>(
            `/api/geocaches/${geocacheId}/logging-tasks`,
            this.apiClient.createJsonInit('PUT', { tasks, source }),
            'Erreur lors du remplacement des questions du proprietaire'
        );
    }
}
