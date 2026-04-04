/**
 * Enregistre des agents IA internes GeoApp pour le Formula Solver.
 *
 * Objectif: permettre à l'utilisateur de configurer des modèles distincts
 * (local/éco vs cloud/fort vs cloud/Internet) exactement comme pour l'OCR.
 */
import { injectable, inject } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { Agent, AgentService, LanguageModelRequirement } from '@theia/ai-core';

export type FormulaSolverAiProfile = 'local' | 'fast' | 'strong' | 'web';

export const GeoAppFormulaSolverLocalAgentId = 'geoapp-formula-solver-local';
export const GeoAppFormulaSolverFastAgentId = 'geoapp-formula-solver-fast';
export const GeoAppFormulaSolverStrongAgentId = 'geoapp-formula-solver-strong';
export const GeoAppFormulaSolverWebAgentId = 'geoapp-formula-solver-web';

export const FormulaSolverAgentIdsByProfile: Record<FormulaSolverAiProfile, string> = {
    local: GeoAppFormulaSolverLocalAgentId,
    fast: GeoAppFormulaSolverFastAgentId,
    strong: GeoAppFormulaSolverStrongAgentId,
    web: GeoAppFormulaSolverWebAgentId,
};

const languageModelRequirements: LanguageModelRequirement[] = [
    {
        purpose: 'formula-solving',
        identifier: 'default/universal'
    }
];

function buildAgent(options: { id: string; name: string; description: string; tags: string[] }): Agent {
    return {
        id: options.id,
        name: options.name,
        description: options.description,
        languageModelRequirements,
        prompts: [],
        variables: [],
        agentSpecificVariables: [],
        functions: [],
        tags: options.tags
    };
}

const geoAppFormulaSolverFastAgent = buildAgent({
    id: GeoAppFormulaSolverFastAgentId,
    name: 'GeoApp Formula Solver (Fast)',
    description: 'Agent interne utilisé par GeoApp pour des tâches simples et économiques (petit modèle).',
    tags: ['GeoApp', 'FormulaSolver', 'Fast']
});

const geoAppFormulaSolverLocalAgent = buildAgent({
    id: GeoAppFormulaSolverLocalAgentId,
    name: 'GeoApp Formula Solver (Local)',
    description: 'Agent interne utilisé par GeoApp via un LLM local (LMStudio / Ollama). Idéal pour du traitement rapide et sans coût cloud.',
    tags: ['GeoApp', 'FormulaSolver', 'Local']
});

const geoAppFormulaSolverStrongAgent = buildAgent({
    id: GeoAppFormulaSolverStrongAgentId,
    name: 'GeoApp Formula Solver (Strong)',
    description: 'Agent interne utilisé par GeoApp pour la meilleure qualité sans Internet (cloud/fort).',
    tags: ['GeoApp', 'FormulaSolver', 'Strong']
});

const geoAppFormulaSolverWebAgent = buildAgent({
    id: GeoAppFormulaSolverWebAgentId,
    name: 'GeoApp Formula Solver (Web)',
    description: 'Agent interne utilisé par GeoApp pour des questions complexes pouvant nécessiter Internet (cloud/fort/Internet).',
    tags: ['GeoApp', 'FormulaSolver', 'Web']
});

@injectable()
export class GeoAppFormulaSolverAgentsContribution implements FrontendApplicationContribution {

    @inject(AgentService)
    protected readonly agentService!: AgentService;

    async onStart(): Promise<void> {
        const agents = [
            geoAppFormulaSolverLocalAgent,
            geoAppFormulaSolverFastAgent,
            geoAppFormulaSolverStrongAgent,
            geoAppFormulaSolverWebAgent
        ];

        for (const agent of agents) {
            try {
                this.agentService.unregisterAgent(agent.id);
            } catch {
                // ignore
            }
            this.agentService.registerAgent(agent);
        }
    }
}

