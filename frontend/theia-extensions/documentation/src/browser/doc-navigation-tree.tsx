import * as React from 'react';
import { DocChapter, DocPageMeta } from './doc-types';

interface DocNavigationTreeProps {
    chapters: DocChapter[];
    activePage: string | null;
    onSelectPage: (pageId: string) => void;
}

interface DocNavigationTreeState {
    expandedChapters: Set<string>;
}

export class DocNavigationTree extends React.Component<DocNavigationTreeProps, DocNavigationTreeState> {

    constructor(props: DocNavigationTreeProps) {
        super(props);
        const expandedChapters = new Set<string>();
        for (const chapter of props.chapters) {
            if (chapter.pages.some(p => p.id === props.activePage)) {
                expandedChapters.add(chapter.id);
            }
        }
        if (expandedChapters.size === 0 && props.chapters.length > 0) {
            expandedChapters.add(props.chapters[0].id);
        }
        this.state = { expandedChapters };
    }

    componentDidUpdate(prevProps: DocNavigationTreeProps): void {
        if (prevProps.activePage !== this.props.activePage && this.props.activePage) {
            const chapter = this.props.chapters.find(c => c.pages.some(p => p.id === this.props.activePage));
            if (chapter && !this.state.expandedChapters.has(chapter.id)) {
                this.setState(prev => ({
                    expandedChapters: new Set([...prev.expandedChapters, chapter.id]),
                }));
            }
        }
    }

    toggleChapter(chapterId: string): void {
        this.setState(prev => {
            const next = new Set(prev.expandedChapters);
            if (next.has(chapterId)) {
                next.delete(chapterId);
            } else {
                next.add(chapterId);
            }
            return { expandedChapters: next };
        });
    }

    render(): React.ReactNode {
        const { chapters, activePage, onSelectPage } = this.props;

        return (
            <div className="doc-nav-tree">
                {chapters.map(chapter => (
                    <div key={chapter.id} className="doc-nav-chapter">
                        <button
                            className="doc-nav-chapter-header"
                            onClick={() => this.toggleChapter(chapter.id)}
                            aria-expanded={this.state.expandedChapters.has(chapter.id)}
                        >
                            <span className={`doc-nav-arrow ${this.state.expandedChapters.has(chapter.id) ? 'expanded' : ''}`}>
                                ▶
                            </span>
                            <span className="doc-nav-chapter-title">{chapter.title}</span>
                        </button>

                        {this.state.expandedChapters.has(chapter.id) && (
                            <ul className="doc-nav-pages">
                                {chapter.pages.map(page => (
                                    <li key={page.id}>
                                        <button
                                            className={`doc-nav-page ${activePage === page.id ? 'active' : ''}`}
                                            onClick={() => onSelectPage(page.id)}
                                            title={page.description}
                                        >
                                            {page.title}
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                ))}
            </div>
        );
    }
}
