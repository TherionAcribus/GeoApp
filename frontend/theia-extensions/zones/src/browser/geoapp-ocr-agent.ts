/**
 * Enregistre l'agent IA "geoapp-ocr" (non-chat) pour permettre le paramétrage d'un modèle dédié à l'OCR Cloud.
 */

import { injectable, inject } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { Agent, AgentService, LanguageModelRequirement } from '@theia/ai-core';

export const GeoAppOcrAgentId = 'geoapp-ocr';

const languageModelRequirements: LanguageModelRequirement[] = [
    {
        purpose: 'vision-ocr',
        identifier: 'default/universal',
    },
];

const geoAppOcrAgent: Agent = {
    id: GeoAppOcrAgentId,
    name: 'GeoApp OCR',
    description: 'Agent interne utilisé par GeoApp pour effectuer un OCR vision (Cloud) depuis la galerie d\'images. Permet de choisir un modèle dédié pour réduire les coûts ou améliorer la qualité.',
    languageModelRequirements,
    prompts: [],
    variables: [],
    agentSpecificVariables: [],
    functions: [],
    tags: ['GeoApp', 'OCR'],
};

@injectable()
export class GeoAppOcrAgentContribution implements FrontendApplicationContribution {

    @inject(AgentService)
    protected readonly agentService!: AgentService;

    async onStart(): Promise<void> {
        try {
            this.agentService.unregisterAgent(GeoAppOcrAgentId);
        } catch {
            // ignore
        }

        this.agentService.registerAgent(geoAppOcrAgent);
    }
}
