import * as assert from 'assert/strict';
import { ToolRequest } from '@theia/ai-core';

import {
    GeoAppOutingAnalyzerAgent,
    geoAppOutingAnalyzerAgentConfiguration,
} from '../geoapp-outing-analyzer-agent';
import { GeoAppChatPolicyService } from '../geoapp-chat-policy-service';
import { GeoAppAiToolCatalog } from '../geoapp-chat-tool-catalog';
import {
    GEOAPP_OUTING_SYSTEM_PROMPT_ID,
    GEOAPP_OUTING_SYSTEM_PROMPT_VARIANT_ID,
    GeoAppOutingSystemPromptVariants,
} from '../geoapp-chat-system-prompts';
import { GEOAPP_OUTING_ANALYZER_AGENT_ID } from '../outing-analysis-types';

class FakeToolInvocationRegistry {
    getAllFunctions(): ToolRequest[] {
        return [];
    }
}

class FakePreferenceService {
    constructor(readonly values: Record<string, unknown> = {}) {}

    get<T>(key: string, defaultValue?: T): T {
        return (this.values[key] as T | undefined) ?? (defaultValue as T);
    }
}

/**
 * `promptText` vaut `undefined` pour simuler un prompt de sortie introuvable ; les autres
 * variantes (celles du chat GeoApp) restent résolues, comme en conditions réelles.
 */
function createAgent(promptText?: string): GeoAppOutingAnalyzerAgent {
    const catalog = new GeoAppAiToolCatalog();
    (catalog as any).toolRegistry = new FakeToolInvocationRegistry();

    const policyService = new GeoAppChatPolicyService();
    (policyService as any).catalog = catalog;
    (policyService as any).preferenceService = new FakePreferenceService();

    const agent = new GeoAppOutingAnalyzerAgent();
    (agent as any).chatPolicyService = policyService;
    (agent as any).promptService = {
        getResolvedPromptFragment: async (variantId: string) => {
            if (variantId === GEOAPP_OUTING_SYSTEM_PROMPT_VARIANT_ID && promptText === undefined) {
                return undefined;
            }
            const text = variantId === GEOAPP_OUTING_SYSTEM_PROMPT_VARIANT_ID
                ? promptText
                : `PROMPT CHAT ${variantId}`;
            return { id: variantId, text, functionDescriptions: new Map() };
        },
        getPromptVariantInfo: (promptId: string, variantId: string) => ({
            variantId,
            isCustomized: false,
            promptId,
        }),
    };
    return agent;
}

function createContext(): any {
    return {
        model: {},
        request: {
            id: 'request-1',
            session: { id: 'session-1', settings: {} },
            response: { cancellationToken: undefined },
        },
    };
}

function testAgentIdentityMatchesTheSharedConstant(): void {
    const agent = createAgent('PROMPT');

    // Le contrôleur épingle la session sur cet identifiant : toute divergence ferait
    // silencieusement retomber le chat sur l'agent GeoApp générique.
    assert.equal(agent.id, GEOAPP_OUTING_ANALYZER_AGENT_ID);
    assert.equal(geoAppOutingAnalyzerAgentConfiguration.id, GEOAPP_OUTING_ANALYZER_AGENT_ID);
    assert.equal(geoAppOutingAnalyzerAgentConfiguration.name, agent.name);
}

function testAgentConfigurationCarriesTheOutingPrompt(): void {
    assert.deepEqual(geoAppOutingAnalyzerAgentConfiguration.prompts, [GeoAppOutingSystemPromptVariants]);
    assert.equal(GeoAppOutingSystemPromptVariants.id, GEOAPP_OUTING_SYSTEM_PROMPT_ID);
    assert.equal(
        GeoAppOutingSystemPromptVariants.defaultVariant.id,
        GEOAPP_OUTING_SYSTEM_PROMPT_VARIANT_ID
    );
}

function testPromptStatesTheNonNegotiableRules(): void {
    const template = GeoAppOutingSystemPromptVariants.defaultVariant.template;

    // Le marqueur doit correspondre au caractère près à celui qu'écrit
    // `outing-analysis-prompt.ts`, accents compris, sinon la règle 1 ne se déclenche pas.
    assert.ok(template.includes('NON RÉSOLU'));
    assert.ok(template.includes("N'INVENTE JAMAIS UN OUTIL"));
    assert.ok(template.includes('CONFIRMÉ'));
    assert.ok(template.includes('PROBABLE'));
    assert.ok(template.includes('NON IDENTIFIÉ'));
    assert.ok(template.includes('PRÉCISE LA GRIMPE'));
    assert.ok(template.includes('sans logs locaux'));
    assert.ok(template.includes('MYSTERY NON RÉSOLUES COMME BLOQUANTES'));
    assert.ok(template.includes('injection'));
}

function testPromptDefinesTheFiveReportSections(): void {
    const template = GeoAppOutingSystemPromptVariants.defaultVariant.template;

    assert.ok(template.includes('## 1. Checklist matériel'));
    assert.ok(template.includes('## 2. Alertes'));
    assert.ok(template.includes('## 3. Détail par cache'));
    assert.ok(template.includes('## 4. Temps et priorisation'));
    assert.ok(template.includes('## 5. À vérifier avant de partir'));
}

async function testSystemMessageUsesTheOutingVariantNotTheChatOne(): Promise<void> {
    const agent = createAgent('PROMPT DE SORTIE');
    const description = await (agent as any).getSystemMessageDescription(createContext());

    assert.ok(description.text.includes('PROMPT DE SORTIE'));
    assert.equal(description.promptVariantId, GEOAPP_OUTING_SYSTEM_PROMPT_VARIANT_ID);
    // La classe de base choisirait `geoapp-chat-system-guided` : la surcharge doit gagner.
    assert.ok(!description.text.includes('geoapp-chat-system-guided'));
}

async function testSystemMessageStillCarriesTheToolPolicy(): Promise<void> {
    const agent = createAgent('PROMPT DE SORTIE');
    const description = await (agent as any).getSystemMessageDescription(createContext());

    // Sans la policy, le modèle ignorerait quels tools il peut appeler en question de suivi.
    assert.ok(description.text.includes('Politique GeoApp active :'));
}

async function testMissingPromptFallsBackInsteadOfLosingInstructions(): Promise<void> {
    const agent = createAgent(undefined);
    const description = await (agent as any).getSystemMessageDescription(createContext());

    // La classe de base reprend la main : mieux vaut le prompt générique que pas de
    // consigne du tout.
    assert.notEqual(description, undefined);
    assert.ok(description.text.includes('PROMPT CHAT geoapp-chat-system-guided'));
}

async function run(): Promise<void> {
    testAgentIdentityMatchesTheSharedConstant();
    testAgentConfigurationCarriesTheOutingPrompt();
    testPromptStatesTheNonNegotiableRules();
    testPromptDefinesTheFiveReportSections();
    await testSystemMessageUsesTheOutingVariantNotTheChatOne();
    await testSystemMessageStillCarriesTheToolPolicy();
    await testMissingPromptFallsBackInsteadOfLosingInstructions();
    // eslint-disable-next-line no-console
    console.log('geoapp-outing-analyzer-agent tests passed');
}

void run();
