import { injectable, inject } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { AgentService, AIVariableContext, LanguageModelRequirement } from '@theia/ai-core';
import { AbstractStreamParsingChatAgent, SystemMessageDescription } from '@theia/ai-chat/lib/common/chat-agents';
import { DocContentService } from './doc-content-service';

export const GeoAppDocAgentId = 'geoapp-doc-aide';

@injectable()
export class GeoAppDocAgent extends AbstractStreamParsingChatAgent {

    readonly id = GeoAppDocAgentId;
    readonly name = '@Aide';
    readonly description = 'Assistant documentation de GeoApp. Répond aux questions sur l\'utilisation de l\'application à partir de la documentation intégrée : zones, géocaches, outils de déchiffrement, carte, configuration IA, dépannage.';

    languageModelRequirements: LanguageModelRequirement[] = [
        { purpose: 'chat', identifier: 'default/universal' },
    ];

    readonly prompts = [];
    readonly variables = [];
    readonly agentSpecificVariables = [];
    readonly functions = [];
    readonly tags = ['GeoApp', 'Documentation', 'Aide'];

    protected defaultLanguageModelPurpose = 'chat';

    @inject(DocContentService)
    protected readonly contentService: DocContentService;

    protected override async getSystemMessageDescription(
        _context: AIVariableContext
    ): Promise<SystemMessageDescription | undefined> {
        await this.contentService.initialize();

        const pages = this.contentService.getPages();
        const chapters = this.contentService.getChapters();

        const toc = chapters.map(chapter =>
            `**${chapter.title}**\n` +
            chapter.pages.map(p => `  - ${p.title}${p.description ? ` : ${p.description}` : ''}`).join('\n')
        ).join('\n\n');

        const fullContent = pages.map(page =>
            `---\n## ${page.title}\n\n${this.stripFrontmatter(page.content)}`
        ).join('\n\n');

        const systemPrompt = [
            'Tu es @Aide, l\'assistant documentation intégré de GeoApp.',
            'GeoApp est une application de résolution de géocaches mystères basée sur Eclipse Theia.',
            '',
            'Règles :',
            '- Réponds UNIQUEMENT à partir de la documentation officielle fournie ci-dessous.',
            '- Si la réponse est dans la doc, cite le chapitre ou la section concernée.',
            '- Si la réponse n\'est pas dans la doc, dis-le clairement et suggère d\'ouvrir la documentation complète.',
            '- Réponds toujours en français.',
            '- Sois concis, pratique et orienté action.',
            '- Ne fais pas d\'hypothèses sur des fonctionnalités non documentées.',
            '',
            '## Table des matières de la documentation',
            '',
            toc,
            '',
            '## Documentation complète',
            '',
            fullContent,
        ].join('\n');

        return { text: systemPrompt };
    }

    private stripFrontmatter(content: string): string {
        return content.replace(/^---\n[\s\S]*?\n---\n?/, '').trim();
    }
}

@injectable()
export class GeoAppDocAgentContribution implements FrontendApplicationContribution {

    @inject(AgentService)
    protected readonly agentService!: AgentService;

    @inject(GeoAppDocAgent)
    protected readonly docAgent!: GeoAppDocAgent;

    async onStart(): Promise<void> {
        try {
            this.agentService.unregisterAgent(GeoAppDocAgentId);
        } catch {
            // ignore
        }
        this.agentService.registerAgent(this.docAgent);
    }
}
