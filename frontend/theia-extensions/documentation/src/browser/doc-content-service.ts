import { injectable } from '@theia/core/shared/inversify';
import { DocPageMeta, DocSection, DocChapter, CHAPTER_LABELS } from './doc-types';

@injectable()
export class DocContentService {

    private pages: DocPageMeta[] = [];
    private sections: DocSection[] = [];
    private initialized = false;

    async initialize(): Promise<void> {
        if (this.initialized) {
            return;
        }
        this.initialized = true;

        try {
            const { DOC_PAGES } = await import('./generated/doc-registry');
            this.pages = [...DOC_PAGES].sort((a, b) => {
                if (a.chapter !== b.chapter) {
                    return a.chapter.localeCompare(b.chapter);
                }
                return a.order - b.order;
            });
            this.sections = this.extractAllSections();
        } catch (e) {
            console.warn('[DocContentService] doc-registry not generated yet. Run yarn build in documentation extension.', e);
            this.pages = [];
            this.sections = [];
        }
    }

    getPages(): DocPageMeta[] {
        return this.pages;
    }

    getPage(id: string): DocPageMeta | undefined {
        return this.pages.find(p => p.id === id);
    }

    getSections(): DocSection[] {
        return this.sections;
    }

    getSectionsForPage(pageId: string): DocSection[] {
        return this.sections.filter(s => s.pageId === pageId);
    }

    getChapters(): DocChapter[] {
        const chaptersMap = new Map<string, DocPageMeta[]>();
        for (const page of this.pages) {
            if (!chaptersMap.has(page.chapter)) {
                chaptersMap.set(page.chapter, []);
            }
            chaptersMap.get(page.chapter)!.push(page);
        }

        const chapters: DocChapter[] = [];
        const chapterOrder = ['getting-started', 'zones', 'outils', 'ia', 'depannage', 'root'];

        for (const chapterId of chapterOrder) {
            if (chaptersMap.has(chapterId)) {
                chapters.push({
                    id: chapterId,
                    title: CHAPTER_LABELS[chapterId] || chapterId,
                    pages: chaptersMap.get(chapterId)!,
                });
                chaptersMap.delete(chapterId);
            }
        }

        for (const [chapterId, pages] of chaptersMap) {
            chapters.push({
                id: chapterId,
                title: CHAPTER_LABELS[chapterId] || chapterId,
                pages,
            });
        }

        return chapters;
    }

    private extractAllSections(): DocSection[] {
        const sections: DocSection[] = [];
        for (const page of this.pages) {
            sections.push(...this.extractSections(page));
        }
        return sections;
    }

    extractSections(page: DocPageMeta): DocSection[] {
        const sections: DocSection[] = [];
        const lines = page.content.split('\n');

        let currentSection: { level: number; title: string; lines: string[]; anchor: string } | null = null;

        const flushSection = () => {
            if (currentSection) {
                sections.push({
                    id: `${page.id}#${currentSection.anchor}`,
                    pageId: page.id,
                    anchor: currentSection.anchor,
                    level: currentSection.level,
                    title: currentSection.title,
                    text: currentSection.lines.join('\n').trim(),
                });
            }
        };

        let introLines: string[] = [];
        let inHeadings = false;

        for (const line of lines) {
            const h2Match = line.match(/^## (.+)/);
            const h3Match = line.match(/^### (.+)/);
            const h1Match = line.match(/^# (.+)/);

            if (h1Match && !inHeadings) {
                inHeadings = true;
                if (introLines.length > 0) {
                    sections.push({
                        id: `${page.id}#intro`,
                        pageId: page.id,
                        anchor: 'intro',
                        level: 1,
                        title: page.title,
                        text: introLines.join('\n').trim(),
                    });
                }
                currentSection = { level: 1, title: h1Match[1], lines: [], anchor: this.headingAnchor(h1Match[1]) };
            } else if (h2Match) {
                flushSection();
                currentSection = { level: 2, title: h2Match[1], lines: [], anchor: this.headingAnchor(h2Match[1]) };
            } else if (h3Match) {
                if (currentSection?.level === 2) {
                    flushSection();
                    currentSection = { level: 3, title: h3Match[1], lines: [], anchor: this.headingAnchor(h3Match[1]) };
                } else if (currentSection) {
                    currentSection.lines.push(line);
                }
            } else {
                if (currentSection) {
                    currentSection.lines.push(line);
                } else {
                    introLines.push(line);
                }
            }
        }

        flushSection();

        if (sections.length === 0 && introLines.length > 0) {
            sections.push({
                id: `${page.id}#intro`,
                pageId: page.id,
                anchor: 'intro',
                level: 1,
                title: page.title,
                text: introLines.join('\n').trim(),
            });
        }

        return sections;
    }

    /**
     * Calcule l'ancre d'un titre \u00e0 partir de son texte *visible*, en retirant
     * d'abord le formatage inline Markdown (code, gras, italique, liens). Cela
     * garantit que l'ancre correspond \u00e0 celle g\u00e9n\u00e9r\u00e9e c\u00f4t\u00e9 rendu (DocViewer),
     * qui part du texte affich\u00e9 \u2014 sinon le scroll vers la section \u00e9choue.
     */
    private headingAnchor(rawTitle: string): string {
        const visible = rawTitle
            .replace(/`([^`]+)`/g, '$1')
            .replace(/\*\*([^*]+)\*\*/g, '$1')
            .replace(/\*([^*]+)\*/g, '$1')
            .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
            .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
        return this.toAnchor(visible);
    }

    private toAnchor(title: string): string {
        return title
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '');
    }
}
