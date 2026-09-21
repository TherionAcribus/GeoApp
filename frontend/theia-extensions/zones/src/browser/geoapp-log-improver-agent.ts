/**
 * Agent IA dédié à la correction et à la mise en forme du texte d'un log de géocache.
 *
 * Remplace l'agent `geoapp-log-writer`, qui rédigeait un log entier à partir de mots-clés :
 * cet agent-ci ne reçoit que du texte déjà écrit par l'utilisateur et ne fait que le corriger
 * ou le mettre en forme. L'identifiant change avec le rôle — une assignation de modèle faite
 * pour l'ancien agent n'est pas reprise, l'agent repart sur `default/universal`.
 *
 * Distinct de `geoapp-log-translator` pour la même raison que celui-ci l'est de
 * `geoapp-translate-description` : corriger quelques phrases est une tâche légère, qui mérite
 * de pouvoir recevoir son propre modèle.
 */

import { injectable, inject } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { Agent, AgentService, LanguageModelRequirement } from '@theia/ai-core';

export const GeoAppLogImproverAgentId = 'geoapp-log-improver';

const languageModelRequirements: LanguageModelRequirement[] = [
    {
        purpose: 'chat',
        identifier: 'default/universal',
    },
];

const geoAppLogImproverAgent: Agent = {
    id: GeoAppLogImproverAgentId,
    name: 'GeoApp Correction de Logs',
    description: 'Agent interne utilisé par GeoApp pour corriger les fautes d\'un log de géocache, ou mettre en forme une suite de notes en un texte suivi, sans y ajouter d\'idée absente de l\'original.',
    languageModelRequirements,
    prompts: [],
    variables: [],
    agentSpecificVariables: [],
    functions: [],
    tags: ['GeoApp', 'Logs', 'Correction'],
};

@injectable()
export class GeoAppLogImproverAgentContribution implements FrontendApplicationContribution {

    @inject(AgentService)
    protected readonly agentService!: AgentService;

    async onStart(): Promise<void> {
        try {
            this.agentService.unregisterAgent(GeoAppLogImproverAgentId);
        } catch {
            // ignore
        }

        this.agentService.registerAgent(geoAppLogImproverAgent);
    }
}
