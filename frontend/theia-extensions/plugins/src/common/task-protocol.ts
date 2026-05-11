/**
 * Interfaces pour la gestion des tâches asynchrones.
 * 
 * Ces interfaces correspondent aux structures retournées par l'API
 * /api/tasks du backend Flask.
 */

import { PluginInputs, PluginResult } from './plugin-protocol';

/**
 * Statut d'une tâche.
 */
export type TaskStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

/**
 * Représente une tâche asynchrone d'exécution de plugin.
 */
export interface Task {
    /** ID unique de la tâche */
    task_id: string;
    
    /** Nom du plugin exécuté */
    plugin_name: string;
    
    /** Statut actuel de la tâche */
    status: TaskStatus;
    
    /** Date de création de la tâche */
    created_at: string;
    
    /** Date de début d'exécution */
    started_at?: string;
    
    /** Date de fin d'exécution */
    completed_at?: string;
    
    /** Entrées fournies au plugin */
    inputs?: PluginInputs;
    
    /** Résultat de l'exécution (si completed) */
    result?: PluginResult;
    
    /** Message d'erreur (si failed) */
    error?: string;
    
    /** Progression (0-100, optionnel) */
    progress?: number;
    
    /** Métadonnées additionnelles */
    metadata?: Record<string, any>;
}

/**
 * Filtres pour la liste des tâches.
 */
export interface TaskFilters {
    /** Filtrer par statut */
    status?: TaskStatus;
    
    /** Filtrer par nom de plugin */
    plugin_name?: string;
    
    /** Limiter le nombre de résultats */
    limit?: number;
}

/**
 * Statistiques sur les tâches.
 */
export interface TaskStatistics {
    /** Nombre total de tâches */
    total: number;
    
    /** Nombre de tâches en file d'attente */
    queued: number;
    
    /** Nombre de tâches en cours d'exécution */
    running: number;
    
    /** Nombre de tâches terminées */
    completed: number;
    
    /** Nombre de tâches échouées */
    failed: number;
    
    /** Nombre de tâches annulées */
    cancelled: number;
    
    /** Taille de la file d'attente */
    queue_size: number;
}

/**
 * Le symbole utilisé pour injecter le service des tâches.
 */
export const TasksService = Symbol('TasksService');

/**
 * Interface du service de gestion des tâches.
 */
export interface TasksService {
    /**
     * Crée une nouvelle tâche asynchrone.
     */
    createTask(pluginName: string, inputs: PluginInputs): Promise<Task>;
    
    /**
     * Récupère le statut d'une tâche.
     */
    getTaskStatus(taskId: string): Promise<Task>;
    
    /**
     * Récupère la liste des tâches.
     */
    listTasks(filters?: TaskFilters): Promise<Task[]>;
    
    /**
     * Annule une tâche.
     */
    cancelTask(taskId: string): Promise<void>;
    
    /**
     * Récupère les statistiques des tâches.
     */
    getStatistics(): Promise<TaskStatistics>;
    
    /**
     * Nettoie les anciennes tâches terminées.
     */
    cleanupOldTasks(olderThanHours?: number): Promise<{ deleted: number }>;
}
