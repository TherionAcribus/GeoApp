import * as React from 'react';
import { DocPageMeta, DocSearchResult } from './doc-types';

interface DocViewerProps {
    page: DocPageMeta | null;
    searchResults: DocSearchResult[];
    searchQuery: string;
    highlightAnchor: string | null;
    prevPage?: DocPageMeta | null;
    nextPage?: DocPageMeta | null;
    onNavigate?: (href: string) => void;
    onNavigatePage?: (pageId: string) => void;
}

interface DocViewerState {
    ReactMarkdown: React.ComponentType<any> | null;
    remarkGfm: any | null;
    loadError: string | null;
}

export class DocViewer extends React.Component<DocViewerProps, DocViewerState> {

    private contentRef = React.createRef<HTMLDivElement>();

    constructor(props: DocViewerProps) {
        super(props);
        this.state = {
            ReactMarkdown: null,
            remarkGfm: null,
            loadError: null,
        };
    }

    async componentDidMount(): Promise<void> {
        try {
            const [mdModule, gfmModule] = await Promise.all([
                import('react-markdown'),
                import('remark-gfm'),
            ]);
            this.setState({
                ReactMarkdown: (mdModule as any).default || mdModule as any,
                remarkGfm: (gfmModule as any).default || gfmModule as any,
            });
        } catch (e) {
            console.error('[DocViewer] Failed to load react-markdown:', e);
            this.setState({ loadError: 'Impossible de charger le rendu Markdown.' });
        }
    }

    /**
     * Le rendu Markdown est coûteux (react-markdown re-parse tout le contenu à
     * chaque render). Le viewer ne dépend en réalité que de la page affichée, de
     * l'ancre à cibler et de l'état de chargement des libs : on saute donc les
     * re-renders déclenchés par la frappe dans la recherche (searchQuery/results),
     * qui ne changent rien à l'affichage de la page.
     */
    shouldComponentUpdate(nextProps: DocViewerProps, nextState: DocViewerState): boolean {
        return (
            nextProps.page?.id !== this.props.page?.id ||
            nextProps.highlightAnchor !== this.props.highlightAnchor ||
            nextState.ReactMarkdown !== this.state.ReactMarkdown ||
            nextState.remarkGfm !== this.state.remarkGfm ||
            nextState.loadError !== this.state.loadError
        );
    }

    componentDidUpdate(prevProps: DocViewerProps): void {
        if (prevProps.page?.id !== this.props.page?.id) {
            this.contentRef.current?.scrollTo({ top: 0, behavior: 'auto' });
        }

        if (this.props.highlightAnchor && this.props.highlightAnchor !== prevProps.highlightAnchor) {
            this.scrollToAnchor(this.props.highlightAnchor);
        }
    }

    private scrollToAnchor(anchor: string): void {
        setTimeout(() => {
            const el = this.contentRef.current?.querySelector(`[id="${anchor}"]`);
            if (el) {
                el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                // Flash de fond pour repérer où l'on vient d'atterrir.
                el.classList.remove('doc-section-flash');
                // Force un reflow pour pouvoir rejouer l'animation si on revient sur la même section.
                void (el as HTMLElement).offsetWidth;
                el.classList.add('doc-section-flash');
            }
        }, 100);
    }

    private buildImageUri(src: string | undefined): string {
        if (!src) {
            return '';
        }
        if (src.startsWith('http://') || src.startsWith('https://') || src.startsWith('data:')) {
            return src;
        }
        const filename = src.split('/').pop() || src;
        return `/docs-assets/${filename}`;
    }

    private stripFrontmatter(content: string): string {
        return content.replace(/^---\n[\s\S]*?\n---\n?/, '');
    }

    render(): React.ReactNode {
        const { page } = this.props;
        const { ReactMarkdown, remarkGfm, loadError } = this.state;

        if (!page) {
            return (
                <div className="doc-viewer doc-viewer-empty" ref={this.contentRef}>
                    <div className="doc-viewer-welcome">
                        <span className="codicon codicon-book" style={{ fontSize: 48, opacity: 0.3 }} />
                        <p>Sélectionnez une page dans la navigation à gauche.</p>
                    </div>
                </div>
            );
        }

        if (loadError) {
            return (
                <div className="doc-viewer" ref={this.contentRef}>
                    <div className="doc-viewer-error">
                        <p>{loadError}</p>
                        <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, opacity: 0.7 }}>
                            {this.stripFrontmatter(page.content)}
                        </pre>
                    </div>
                </div>
            );
        }

        if (!ReactMarkdown) {
            return (
                <div className="doc-viewer" ref={this.contentRef}>
                    <div className="doc-viewer-loading">
                        <span className="codicon codicon-loading codicon-modifier-spin" />
                        <span>Chargement...</span>
                    </div>
                </div>
            );
        }

        const content = this.stripFrontmatter(page.content);

        const components: Record<string, any> = {
            img: ({ src, alt, ...rest }: any) => (
                <img
                    src={this.buildImageUri(src)}
                    alt={alt || ''}
                    className="doc-image"
                    loading="lazy"
                    {...rest}
                />
            ),
            a: ({ href, children, node, ...rest }: any) => {
                const isExternal = href?.startsWith('http://') || href?.startsWith('https://');
                if (isExternal) {
                    return (
                        <a href={href} target="_blank" rel="noopener noreferrer" {...rest}>
                            {children}
                        </a>
                    );
                }
                if (href && this.props.onNavigate) {
                    return (
                        <a
                            href={href}
                            className="doc-internal-link"
                            title={href}
                            onClick={e => {
                                e.preventDefault();
                                this.props.onNavigate!(href);
                            }}
                            {...rest}
                        >
                            {children}
                        </a>
                    );
                }
                return <span className="doc-internal-link" title={href} {...rest}>{children}</span>;
            },
            h1: ({ children, node, ...rest }: any) => {
                const id = this.toAnchor(this.extractText(children));
                return <h1 id={id} {...rest}>{children}</h1>;
            },
            h2: ({ children, node, ...rest }: any) => {
                const id = this.toAnchor(this.extractText(children));
                return <h2 id={id} {...rest}>{children}</h2>;
            },
            h3: ({ children, node, ...rest }: any) => {
                const id = this.toAnchor(this.extractText(children));
                return <h3 id={id} {...rest}>{children}</h3>;
            },
        };

        const { prevPage, nextPage, onNavigatePage } = this.props;
        const showPageNav = onNavigatePage && (prevPage || nextPage);

        return (
            <div className="doc-viewer" ref={this.contentRef}>
                <div className="doc-content">
                    <ReactMarkdown
                        remarkPlugins={remarkGfm ? [remarkGfm] : []}
                        components={components}
                    >
                        {content}
                    </ReactMarkdown>
                </div>
                {showPageNav && (
                    <nav className="doc-page-nav" aria-label="Navigation entre les pages">
                        {prevPage ? (
                            <button
                                className="doc-page-nav-btn doc-page-nav-prev"
                                onClick={() => onNavigatePage!(prevPage.id)}
                                title={prevPage.title}
                            >
                                <span className="codicon codicon-arrow-left" aria-hidden="true" />
                                <span className="doc-page-nav-labels">
                                    <span className="doc-page-nav-dir">Précédent</span>
                                    <span className="doc-page-nav-title">{prevPage.title}</span>
                                </span>
                            </button>
                        ) : <span />}
                        {nextPage ? (
                            <button
                                className="doc-page-nav-btn doc-page-nav-next"
                                onClick={() => onNavigatePage!(nextPage.id)}
                                title={nextPage.title}
                            >
                                <span className="doc-page-nav-labels">
                                    <span className="doc-page-nav-dir">Suivant</span>
                                    <span className="doc-page-nav-title">{nextPage.title}</span>
                                </span>
                                <span className="codicon codicon-arrow-right" aria-hidden="true" />
                            </button>
                        ) : <span />}
                    </nav>
                )}
            </div>
        );
    }

    /**
     * Extrait le texte brut d'un arbre de children React. Un titre format\u00e9
     * (ex. `## Utiliser \`@Aide\``) arrive sous forme de tableau d'\u00e9l\u00e9ments React :
     * `String(children)` produirait \u00ab [object Object] \u00bb et casserait l'ancre.
     */
    private extractText(children: React.ReactNode): string {
        if (children === null || children === undefined || typeof children === 'boolean') {
            return '';
        }
        if (typeof children === 'string' || typeof children === 'number') {
            return String(children);
        }
        if (Array.isArray(children)) {
            return children.map(child => this.extractText(child)).join('');
        }
        if (React.isValidElement(children)) {
            return this.extractText((children.props as any)?.children);
        }
        return '';
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
