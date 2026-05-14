export interface DocPageMeta {
    id: string;
    chapter: string;
    title: string;
    description: string;
    order: number;
    tags: string[];
    content: string;
}

export interface DocSection {
    id: string;
    pageId: string;
    anchor: string;
    level: number;
    title: string;
    text: string;
}

export interface DocSearchResult {
    pageId: string;
    sectionAnchor: string;
    pageTitle: string;
    sectionTitle: string;
    excerpt: string;
    score: number;
}

export interface DocChapter {
    id: string;
    title: string;
    pages: DocPageMeta[];
}

export const CHAPTER_LABELS: Record<string, string> = {
    'getting-started': 'Bien démarrer',
    'zones': 'Zones',
    'outils': 'Outils de déchiffrement',
    'ia': 'Intelligence artificielle',
    'depannage': 'Dépannage',
    'root': 'Général',
};
