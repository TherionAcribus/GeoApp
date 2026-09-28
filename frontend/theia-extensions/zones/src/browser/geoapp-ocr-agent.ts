/**
 * Enregistre l'agent IA "geoapp-ocr" (non-chat) pour l'OCR exécuté via LanguageModelService.
 */

import { injectable, inject } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { Agent, AgentService, LanguageModelRequirement } from '@theia/ai-core';

export const GeoAppOcrAgentId = 'geoapp-ocr';

export const GeoAppOcrLanguageModelRequirements: LanguageModelRequirement[] = [
    {
        purpose: 'vision-ocr',
        identifier: 'default/universal',
    },
];

export const geoAppOcrAgent: Agent = {
    id: GeoAppOcrAgentId,
    name: 'GeoApp OCR',
    description: 'Agent interne utilisé par GeoApp pour l\'OCR vision exécuté via Theia/LanguageModelService depuis la galerie d\'images. Le plugin backend vision_ocr utilise séparément les préférences geoApp.ocr.*.',
    languageModelRequirements: GeoAppOcrLanguageModelRequirements,
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
