/**
 * Service de communication avec l'API backend pour les tâches asynchrones.
 * 
 * Ce service encapsule toutes les requêtes HTTP vers le backend Flask
 * pour la gestion des tâches d'exécution de plugins en arrière-plan.
 */

import { injectable } from '@theia/core/shared/inversify';
import axios, { AxiosInstance } from 'axios';
import {
    Task,
    TaskFilters,
    TaskStatistics,
    TasksService as ITasksService
} from '../../common/task-protocol';
import { PluginInputs } from '../../common/plugin-protocol';

@injectable()
export class TasksServiceImpl implements ITasksService {
    
    private readonly client: AxiosInstance;
    private readonly baseUrl: string;
    
    constructor() {
        // URL du backend Flask
        // TODO: Rendre configurable via les préférences Theia
        this.baseUrl = 'http://localhost:8000';
        
        this.client = axios.create({
            baseURL: this.baseUrl,
            timeout: 30000, // 30 secondes
            headers: {
                'Content-Type': 'application/json'
            }
        });
    }
    
    /**
     * Crée une nouvelle tâche asynchrone.
     */
    async createTask(pluginName: string, inputs: PluginInputs): Promise<Task> {
        try {
            const response = await this.client.post('/api/tasks', {
                plugin_name: pluginName,
                inputs
            });
            
            // L'API retourne { task_id, status, message }
            // On transforme en objet Task complet
            const data = response.data;
            return {
                task_id: data.task_id,
                plugin_name: pluginName,
                status: data.status || 'queued',
                created_at: new Date().toISOString(),
                inputs
            };
            
        } catch (error) {
            console.error(`Erreur lors de la création de la tâche pour ${pluginName}:`, error);
            throw new Error(`Échec de la création de la tâche: ${this.getErrorMessage(error)}`);
        }
    }
    
    /**
     * Récupère le statut d'une tâche.
     */
    async getTaskStatus(taskId: string): Promise<Task> {
        try {
            const response = await this.client.get(`/api/tasks/${taskId}`);
            return response.data;
            
        } catch (error) {
            console.error(`Erreur lors de la récupération de la tâche ${taskId}:`, error);
            throw new Error(`Tâche ${taskId} introuvable: ${this.getErrorMessage(error)}`);
        }
    }
    
    /**
     * Récupère la liste des tâches.
     */
    async listTasks(filters?: TaskFilters): Promise<Task[]> {
        try {
            const params: Record<string, string> = {};
            
            if (filters?.status) {
                params.status = filters.status;
            }
            if (filters?.plugin_name) {
                params.plugin_name = filters.plugin_name;
            }
            if (filters?.limit) {
                params.limit = filters.limit.toString();
            }
            
            const response = await this.client.get('/api/tasks', { params });
            
            // L'API retourne { tasks: Task[], total: number }
            return response.data.tasks || [];
            
        } catch (error) {
            console.error('Erreur lors de la récupération des tâches:', error);
            throw new Error(`Impossible de récupérer les tâches: ${this.getErrorMessage(error)}`);
        }
    }
    
    /**
     * Annule une tâche.
     */
    async cancelTask(taskId: string): Promise<void> {
        try {
            await this.client.post(`/api/tasks/${taskId}/cancel`);
            
        } catch (error) {
            console.error(`Erreur lors de l'annulation de la tâche ${taskId}:`, error);
            throw new Error(`Échec de l'annulation: ${this.getErrorMessage(error)}`);
        }
    }
    
    /**
     * Récupère les statistiques des tâches.
     */
    async getStatistics(): Promise<TaskStatistics> {
        try {
            const response = await this.client.get('/api/tasks/statistics');
            return response.data;
            
        } catch (error) {
            console.error('Erreur lors de la récupération des statistiques:', error);
            throw new Error(`Impossible de récupérer les statistiques: ${this.getErrorMessage(error)}`);
        }
    }
    
    /**
     * Nettoie les anciennes tâches terminées.
     */
    async cleanupOldTasks(olderThanHours: number = 24): Promise<{ deleted: number }> {
        try {
            const response = await this.client.post('/api/tasks/cleanup', {
                older_than_hours: olderThanHours
            });
            
            return { deleted: response.data.tasks_deleted || 0 };
            
        } catch (error) {
            console.error('Erreur lors du nettoyage des tâches:', error);
            throw new Error(`Échec du nettoyage: ${this.getErrorMessage(error)}`);
        }
    }
    
    /**
     * Extrait le message d'erreur depuis une erreur Axios.
     */
    private getErrorMessage(error: any): string {
        if (axios.isAxiosError(error)) {
            if (error.response) {
                // Erreur retournée par le serveur
                const data = error.response.data;
                return data?.message || data?.error || error.message;
            } else if (error.request) {
                // Pas de réponse du serveur
                return 'Le backend ne répond pas. Vérifiez que le serveur Flask est démarré.';
            }
        }
        
        return error.message || 'Erreur inconnue';
    }
}
