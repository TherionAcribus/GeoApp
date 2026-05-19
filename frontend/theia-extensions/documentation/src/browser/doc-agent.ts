import { injectable, inject } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import {
    AgentService,
    AIVariableContext,
    LanguageModelRequirement,
    LanguageModel,
    LanguageModelResponse,
    ToolRequest,
} from '@theia/ai-core';
import {
    AbstractStreamParsingChatAgent,
    SystemMessageDescription,
} from '@theia/ai-chat/lib/common/chat-agents';
import { MutableChatRequestModel } from '@theia/ai-chat/lib/common/chat-model';
import { LanguageModelMessage } from '@theia/ai-core/lib/common/language-model';
import { DocContentService } from './doc-content-service';
import { DocActionToolsManager } from './doc-action-tools';
import { DocActionContextService } from './doc-action-context-service';

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

    @inject(DocActionToolsManager)
    protected readonly actionToolsManager!: DocActionToolsManager;

    @inject(DocActionContextService)
    protected readonly actionContextService!: DocActionContextService;

    protected override async sendLlmRequest(
        request: MutableChatRequestModel,
        messages: LanguageModelMessage[],
        toolRequests: ToolRequest[],
        languageModel: LanguageModel,
        promptVariantId?: string,
        isPromptVariantCustomized?: boolean
    ): Promise<LanguageModelResponse> {
        const docToolIds = new Set(this.actionToolsManager.buildAllTools().map(t => t.id));
        const nonDocTools = toolRequests.filter(t => !docToolIds.has(t.id));
        const docTools = this.actionToolsManager.buildAllTools();
        return super.sendLlmRequest(
            request,
            messages,
            [...nonDocTools, ...docTools],
            languageModel,
            promptVariantId,
            isPromptVariantCustomized
        );
    }

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

        let uiContextBlock = '';
        try {
            const ctx = await this.actionContextService.collectContext();
            uiContextBlock = this.actionContextService.formatContextForPrompt(ctx);
        } catch {
            uiContextBlock = '## Contexte UI actuel\nNon disponible.';
        }

        const systemPrompt = [
            'Tu es @Aide, l\'assistant documentation et assistant IA de GeoApp.',
            'GeoApp est une application de résolution de géocaches mystères basée sur Eclipse Theia.',
            '',
            '## Règles générales',
            '- Réponds toujours en français.',
            '- Sois concis, pratique et orienté action.',
            '- Pour les questions (comment, qu\'est-ce que, pourquoi, où, quel), réponds depuis la documentation officielle et cite le chapitre concerné.',
            '- Si la réponse n\'est pas dans la doc, dis-le clairement.',
            '- Ne fais pas d\'hypothèses sur des fonctionnalités non documentées.',
            '',
            '## Règles pour les actions applicatives',
            '- Appelle le tool IMMÉDIATEMENT dans la même réponse — ne réponds jamais en texte pour annoncer une action future, puis attendre un nouveau message.',
            '- Les formulations suivantes sont toutes des demandes d\'action directe : verbe impératif (crée, ouvre, supprime...), "Peux-tu...", "Pourrais-tu...", "Ouvre...", "Lance...", "Vas-y", "Fais-le".',
            '- Si les identifiants nécessaires (zone_id, geocache_id...) sont inconnus, utilise d\'abord aide_list_zones ou aide_list_geocaches_in_zone pour les obtenir, puis enchaîne immédiatement avec l\'action.',
            '- Quand le contexte indique « Dernier widget GeoApp actif » avec une géocache, c\'est la cache que l\'utilisateur avait à l\'écran avant d\'ouvrir le chat. Utilise son geocache_id pour résoudre « cette cache », « à l\'écran », etc. Si l\'utilisateur demande son contenu (description, indices, waypoints), appelle immédiatement aide_get_geocache_details avec cet id.',
            '- En cas de doute réel sur l\'intention (paramètre manquant, action irréversible sans confirmation possible), pose UNE question courte.',
            '- Pour les actions ⚠, la confirmation Theia est gérée automatiquement — ne demande pas de validation verbale supplémentaire.',
            '- Utilise le « Contexte UI actuel » ci-dessous pour résoudre « cette zone », « cette cache », « l\'onglet actif ».',
            '',
            '## Tools @Aide disponibles',
            '',
            '**Navigation :**',
            '- aide_open_documentation — Ouvre la documentation',
            '- aide_open_preferences — Ouvre les préférences',
            '- aide_open_plugins_panel — Ouvre le panneau plugins',
            '- aide_open_alphabets_panel — Ouvre la liste des alphabets',
            '- aide_open_map — Affiche la carte',
            '- aide_open_archive_manager — Ouvre le gestionnaire d\'archive',
            '- aide_open_zones_list — Ouvre la liste des zones',
            '- aide_open_zone_tab(zone_id) — Ouvre l\'onglet d\'une zone',
            '- aide_open_geocache(geocache_id) — Ouvre la fiche d\'une géocache',
            '',
            '**Zones :**',
            '- aide_list_zones — Liste toutes les zones',
            '- aide_create_zone(name, description?) — Crée une zone',
            '- aide_set_active_zone(zone_id) — Définit la zone active',
            '- aide_delete_zone(zone_id, zone_name) ⚠ — Supprime une zone (irréversible)',
            '',
            '**Géocaches :**',
            '- aide_get_geocache_details(geocache_id) — Contenu complet : description, indices, waypoints, coordonnées, statut',
            '- aide_list_geocaches_in_zone(zone_id) — Liste les géocaches d\'une zone',
            '- aide_add_geocache_by_code(zone_id, gc_code) ⚠ — Ajoute via code GC (réseau)',
            '- aide_copy_geocache_to_zone(geocache_id, target_zone_id) ⚠ — Copie vers une zone',
            '- aide_delete_geocache(geocache_id) ⚠ — Supprime une géocache (irréversible)',
            '',
            '**Waypoints :**',
            '- aide_create_waypoint(geocache_id, name, gc_coords, note?, type?) — Crée un waypoint',
            '- aide_delete_waypoint(geocache_id, waypoint_id) ⚠ — Supprime un waypoint (irréversible)',
            '',
            '**Notes :**',
            '- aide_create_note(geocache_id, content, note_type?) — Crée une note',
            '- aide_update_note(note_id, content, note_type?) — Met à jour une note',
            '- aide_delete_note(note_id) ⚠ — Supprime une note (irréversible)',
            '',
            '**Plugins de déchiffrement :**',
            '- aide_list_plugins(category?) — Liste COMPLÈTE des plugins avec catégories et tags (pas de filtre texte)',
            '- aide_get_plugin_info(plugin_name) — Détails d\'un plugin (description, catégories, paramètres)',
            '- aide_open_plugin_tab(plugin_name) — Ouvre l\'executor avec ce plugin pré-sélectionné',
            '  ⚡ Pour les plugins : appelez toujours aide_list_plugins() SANS filtre, puis identifiez le plugin par vos propres connaissances sémantiques (ex: "magicien" → houdini_cipher, "téléphone mobile" → multitap, "pigpen" → pig_pen_cipher).',
            '',
            '**Alphabets de symboles :**',
            '- aide_list_alphabets(search?) — Liste/recherche les alphabets (par nom, tag, description)',
            '- aide_get_alphabet_info(alphabet_id) — Détails d\'un alphabet (caractères, type de rendu)',
            '- aide_open_alphabet_tab(alphabet_id) — Ouvre le décodeur pour cet alphabet',
            '',
            '**Préférences GeoApp :**',
            '- aide_list_preferences(category?) — Liste les préférences avec valeurs courantes. Catégories : ai, formulaSolver, chat, ui, map, plugins, ocr, images, updates, backend, logs, search.',
            '- aide_get_preference(key) — Valeur courante + métadonnées d\'une préférence spécifique.',
            '- aide_set_preference(key, value) — Modifie une préférence (validation type/enum/plage automatique). Clés API protégées.',
            '',
            '**Recherche globale :**',
            '- aide_open_global_search — Ouvre le panneau de recherche globale (sidebar gauche)',
            '- aide_search(query, scope?) — Recherche dans GeoApp. Scopes : "all", "open_tabs", "database", "geocaches", "logs", "notes", "plugins", "alphabets".',
            '  ⚡ Pour « trouve toutes les caches qui mentionnent X » ou « cherche X dans mes notes », appelle aide_search directement sans demander confirmation.',
            '',
            '**Calculatrice :**',
            '- aide_calculate(expression, angle_unit?) — Évalue une expression mathématique. Angles en RADIANS par défaut, utiliser angle_unit="deg" pour les degrés. Ex: "sqrt(144)", "sin(pi/6)", "factorial(10)", "log10(1000)", "2^10", "combinations(10,3)".',
            '- aide_calculate_batch(expressions, angle_unit?) — Évalue plusieurs expressions séparées par ";". Idéal pour résoudre plusieurs formules de coordonnées en parallèle.',
            '- aide_open_calculator — Ouvre le panneau calculatrice dans la barre latérale.',
            '  ⚡ RÈGLE ABSOLUE : utiliser aide_calculate pour TOUT calcul numérique lors de la résolution d\'énigmes. Ne jamais estimer ni calculer mentalement.',
            '',
            uiContextBlock,
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
