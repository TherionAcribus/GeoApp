import { injectable, inject } from '@theia/core/shared/inversify';
import { DocContentService } from './doc-content-service';
import { DocSearchResult, DocSection } from './doc-types';

export interface DocSearchContentSection {
    page: string;
    section: string;
    content: string;
}

/**
 * Reconstruit le contenu complet des sections à partir de résultats de recherche.
 * Fonction pure (sans dépendance DI) : chaque hit est relié à sa section via son ancre,
 * et on retombe sur l'extrait si la section n'est pas retrouvée. C'est le contrat que
 * `aide_search_docs` expose au modèle — il dépend de l'alignement entre les ancres
 * produites par `DocContentService.extractSections` et celles renvoyées par la recherche.
 */
export function resolveDocSearchContent(
    hits: DocSearchResult[],
    getSectionsForPage: (pageId: string) => DocSection[]
): DocSearchContentSection[] {
    return hits.map(hit => {
        const section = getSectionsForPage(hit.pageId).find(s => s.anchor === hit.sectionAnchor);
        return {
            page: hit.pageTitle,
            section: hit.sectionTitle,
            content: section?.text ?? hit.excerpt,
        };
    });
}

@injectable()
export class DocSearchService {

    @inject(DocContentService)
    protected readonly contentService: DocContentService;

    private index: any = null;
    private sectionsById = new Map<string, DocSection>();
    private initialized = false;

    async initialize(): Promise<void> {
        if (this.initialized) {
            return;
        }
        this.initialized = true;

        const sections = this.contentService.getSections();

        if (sections.length === 0) {
            return;
        }

        try {
            const FlexSearch = await import('flexsearch');
            const Document = (FlexSearch as any).Document || (FlexSearch.default as any)?.Document;

            this.index = new Document({
                document: {
                    id: 'id',
                    index: [
                        { field: 'title', tokenize: 'forward', resolution: 9 },
                        { field: 'text', tokenize: 'forward', resolution: 5 },
                        { field: 'tags', tokenize: 'full', resolution: 3 },
                    ],
                    store: true,
                },
                encode: (str: string) => str
                    .toLowerCase()
                    .normalize('NFD')
                    .replace(/[\u0300-\u036f]/g, '')
                    .split(/\W+/)
                    .filter(Boolean),
            });

            for (const section of sections) {
                const page = this.contentService.getPage(section.pageId);
                this.sectionsById.set(section.id, section);
                this.index.add({
                    id: section.id,
                    title: section.title,
                    text: this.stripMarkdown(section.text),
                    tags: page?.tags?.join(' ') || '',
                });
            }
        } catch (e) {
            console.error('[DocSearchService] FlexSearch initialization failed:', e);
        }
    }

    search(query: string, limit = 8): DocSearchResult[] {
        if (!this.index || !query.trim()) {
            return [];
        }

        try {
            const rawResults = this.index.search(query, { limit, enrich: true });
            const seen = new Set<string>();
            const results: DocSearchResult[] = [];

            for (const fieldResult of rawResults) {
                for (const hit of fieldResult.result || []) {
                    const sectionId = typeof hit === 'string' ? hit : hit.id;
                    if (seen.has(sectionId)) {
                        continue;
                    }
                    seen.add(sectionId);

                    const section = this.sectionsById.get(sectionId);
                    if (!section) {
                        continue;
                    }

                    const page = this.contentService.getPage(section.pageId);
                    const excerpt = this.buildExcerpt(section.text, query);

                    results.push({
                        pageId: section.pageId,
                        sectionAnchor: section.anchor,
                        pageTitle: page?.title || section.pageId,
                        sectionTitle: section.title,
                        excerpt,
                        score: 1,
                    });
                }
            }

            return results.slice(0, limit);
        } catch (e) {
            console.error('[DocSearchService] search error:', e);
            return [];
        }
    }

    private buildExcerpt(text: string, query: string): string {
        const clean = this.stripMarkdown(text);
        const words = query.toLowerCase().split(/\s+/);
        const lower = clean.toLowerCase();

        let bestIdx = -1;
        for (const word of words) {
            const idx = lower.indexOf(word);
            if (idx !== -1 && (bestIdx === -1 || idx < bestIdx)) {
                bestIdx = idx;
            }
        }

        const start = Math.max(0, bestIdx === -1 ? 0 : bestIdx - 60);
        const end = Math.min(clean.length, start + 160);
        let excerpt = clean.slice(start, end).trim();

        if (start > 0) {
            excerpt = '...' + excerpt;
        }
        if (end < clean.length) {
            excerpt = excerpt + '...';
        }

        return excerpt;
    }

    private stripMarkdown(text: string): string {
        return text
            .replace(/```[\s\S]*?```/g, '')
            .replace(/`[^`]+`/g, match => match.slice(1, -1))
            .replace(/\*\*([^*]+)\*\*/g, '$1')
            .replace(/\*([^*]+)\*/g, '$1')
            .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
            .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
            .replace(/^#+\s+/gm, '')
            .replace(/^[-*|>]\s*/gm, '')
            .replace(/\|/g, ' ')
            .replace(/\n{2,}/g, '\n')
            .trim();
    }
}
