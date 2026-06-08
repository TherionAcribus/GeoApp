/**
 * Agent IA spécialisé dans le scoring des résultats de plugins.
 *
 * Cet agent est distinct des agents de chat GeoApp. Il est utilisé en interne
 * pour permettre à l'utilisateur de choisir un modèle LLM dédié à l'analyse
 * et au scoring des résultats de déchiffrement (alternative à l'algo de scoring).
 *
 * Le modèle assigné à cet agent sera appelé par le backend via /api/plugins/ai-score.
 * La résolution du modèle (base_url, api_key, etc.) est gérée par les préférences
 * existantes (geoApp.ocr.visionProvider, geoApp.ai.openRouter.*, etc.).
 */

import { injectable, inject } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { Agent, AgentService, LanguageModelRequirement } from '@theia/ai-core';

export const GeoAppAiScorerAgentId = 'geoapp-ai-scorer';

const languageModelRequirements: LanguageModelRequirement[] = [
    {
        purpose: 'chat',
        identifier: 'default/universal',
    },
];

const geoAppAiScorerAgent: Agent = {
    id: GeoAppAiScorerAgentId,
    name: 'GeoApp AI Scorer',
    description:
        "Agent interne utilisé par GeoApp pour analyser et scorer les résultats de déchiffrement de plugins. " +
        "Alternative au scoring algorithmique : détecte le langage naturel, les mots collés et les coordonnées " +
        "en toutes lettres dans les résultats du Metasolver et des autres plugins.",
    languageModelRequirements,
    prompts: [],
    variables: [],
    agentSpecificVariables: [],
    functions: [],
    tags: ['GeoApp', 'Scorer', 'AI'],
};

@injectable()
export class GeoAppAiScorerAgentContribution implements FrontendApplicationContribution {

    @inject(AgentService)
    protected readonly agentService!: AgentService;

    async onStart(): Promise<void> {
        try {
            this.agentService.unregisterAgent(GeoAppAiScorerAgentId);
        } catch {
            // ignore si l'agent n'existe pas encore
        }

        this.agentService.registerAgent(geoAppAiScorerAgent);
    }
}
