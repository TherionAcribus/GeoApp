/**
 * Agent chat dédié à l'analyse de sortie.
 *
 * Contrairement aux agents internes de GeoApp (`geoapp-logs-analyzer`,
 * `geoapp-ai-scorer`…), qui sont de simples `Agent` appelés directement via
 * `LanguageModelService`, celui-ci est un vrai **`ChatAgent`** : la restitution passe par
 * le Chat Theia, pour que l'utilisateur puisse rebondir sur le rapport (« et si je n'ai
 * pas de lampe UV ? », « donne-moi l'ordre de visite »).
 *
 * Il dérive de `BaseGeoAppChatAgent` afin de conserver la policy de tools GeoApp : les
 * questions de suivi peuvent avoir besoin de `get_geocache_listing` ou d'un plugin. Seul
 * le prompt système change — d'où la surcharge de `getSystemMessageDescription`, car la
 * classe de base choisit sa variante depuis le profil comportemental, sans regarder
 * `systemPromptId`.
 */

import { inject, injectable } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { Agent, AgentService, AIVariableContext } from '@theia/ai-core';
import { ChatSessionContext, SystemMessageDescription } from '@theia/ai-chat/lib/common/chat-agents';
import { MutableChatRequestModel } from '@theia/ai-chat/lib/common/chat-model';
import { BaseGeoAppChatAgent, GeoAppChatLanguageModelRequirements } from './geoapp-chat-agent';
import {
    GEOAPP_OUTING_SYSTEM_PROMPT_ID,
    GEOAPP_OUTING_SYSTEM_PROMPT_VARIANT_ID,
    GeoAppOutingSystemPromptVariants,
} from './geoapp-chat-system-prompts';
import { GEOAPP_OUTING_ANALYZER_AGENT_ID } from './outing-analysis-types';

export { GEOAPP_OUTING_ANALYZER_AGENT_ID };

const OUTING_AGENT_NAME = 'GeoApp Analyse de sortie';
const OUTING_AGENT_DESCRIPTION =
    'Agent GeoApp qui prépare une sortie à partir d\'un lot de géocaches : checklist '
    + 'matériel, temps à prévoir, alertes de santé et priorisation.';

/** Configuration exposée aux réglages IA de Theia, pour y assigner un modèle dédié. */
export const geoAppOutingAnalyzerAgentConfiguration: Agent = {
    id: GEOAPP_OUTING_ANALYZER_AGENT_ID,
    name: OUTING_AGENT_NAME,
    description: OUTING_AGENT_DESCRIPTION,
    languageModelRequirements: GeoAppChatLanguageModelRequirements,
    prompts: [GeoAppOutingSystemPromptVariants],
    variables: [],
    agentSpecificVariables: [],
    functions: [],
    tags: ['GeoApp', 'Chat', 'Geocaching', 'Sortie'],
};

@injectable()
export class GeoAppOutingAnalyzerAgent extends BaseGeoAppChatAgent {

    id: string = GEOAPP_OUTING_ANALYZER_AGENT_ID;
    name: string = OUTING_AGENT_NAME;

    override description = OUTING_AGENT_DESCRIPTION;

    protected override systemPromptId = GEOAPP_OUTING_SYSTEM_PROMPT_ID;

    /**
     * Prompt de préparation de sortie, suivi de la policy de tools active.
     *
     * La policy est conservée : sans elle, le modèle ignorerait quels tools il a le droit
     * d'appeler pour les questions de suivi. En cas de prompt introuvable, on retombe sur
     * le comportement de la classe de base plutôt que de partir sans consigne.
     */
    protected override async getSystemMessageDescription(
        context: AIVariableContext
    ): Promise<SystemMessageDescription | undefined> {
        const resolvedPrompt = await this.promptService.getResolvedPromptFragment(
            GEOAPP_OUTING_SYSTEM_PROMPT_VARIANT_ID,
            undefined,
            context
        );

        if (!resolvedPrompt) {
            return super.getSystemMessageDescription(context);
        }

        const request = ChatSessionContext.is(context) ? context.request : undefined;
        const policy = this.chatPolicyService.resolvePolicy(request as MutableChatRequestModel | undefined);
        const variantInfo = this.promptService.getPromptVariantInfo(
            GEOAPP_OUTING_SYSTEM_PROMPT_ID,
            GEOAPP_OUTING_SYSTEM_PROMPT_VARIANT_ID
        );

        return {
            text: [
                resolvedPrompt.text,
                '',
                this.chatPolicyService.describePolicyForPrompt(policy),
            ].join('\n'),
            functionDescriptions: resolvedPrompt.functionDescriptions,
            promptVariantId: variantInfo?.variantId || GEOAPP_OUTING_SYSTEM_PROMPT_VARIANT_ID,
            isPromptVariantCustomized: variantInfo?.isCustomized ?? false,
        };
    }
}

/**
 * Enregistrement auprès de Theia.
 *
 * Contribution séparée de `GeoAppChatAgentContribution` : faire enregistrer cet agent par
 * celle-ci obligerait `geoapp-chat-agent.ts` à importer ce fichier, qui importe déjà
 * `BaseGeoAppChatAgent` — un cycle. C'est aussi le motif des autres agents GeoApp.
 */
@injectable()
export class GeoAppOutingAnalyzerAgentContribution implements FrontendApplicationContribution {

    @inject(AgentService)
    protected readonly agentService!: AgentService;

    async onStart(): Promise<void> {
        try {
            this.agentService.unregisterAgent(GEOAPP_OUTING_ANALYZER_AGENT_ID);
        } catch {
            // Premier démarrage : l'agent n'existe pas encore, rien à désenregistrer.
        }

        this.agentService.registerAgent(geoAppOutingAnalyzerAgentConfiguration);
    }
}
