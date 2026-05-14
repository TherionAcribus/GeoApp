import * as React from 'react';
import { DocPageMeta, DocSearchResult } from './doc-types';

interface DocViewerProps {
    page: DocPageMeta | null;
    searchResults: DocSearchResult[];
    searchQuery: string;
    highlightAnchor: string | null;
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
        const { page, searchQuery } = this.props;
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
            a: ({ href, children, ...rest }: any) => {
                const isExternal = href?.startsWith('http://') || href?.startsWith('https://');
                if (isExternal) {
                    return (
                        <a href={href} target="_blank" rel="noopener noreferrer" {...rest}>
                            {children}
                        </a>
                    );
                }
                return <span className="doc-internal-link" title={href} {...rest}>{children}</span>;
            },
            h1: ({ children, ...rest }: any) => {
                const id = this.toAnchor(String(children));
                return <h1 id={id} {...rest}>{children}</h1>;
            },
            h2: ({ children, ...rest }: any) => {
                const id = this.toAnchor(String(children));
                return <h2 id={id} {...rest}>{children}</h2>;
            },
            h3: ({ children, ...rest }: any) => {
                const id = this.toAnchor(String(children));
                return <h3 id={id} {...rest}>{children}</h3>;
            },
        };

        return (
            <div className="doc-viewer" ref={this.contentRef}>
                {searchQuery && (
                    <div className="doc-search-notice">
                        <span className="codicon codicon-search" />
                        Résultats pour : <strong>{searchQuery}</strong>
                        <span style={{ marginLeft: 8, opacity: 0.6, fontSize: 11 }}>
                            (les sections correspondantes sont surlignées dans la navigation)
                        </span>
                    </div>
                )}
                <div className="doc-content">
                    <ReactMarkdown
                        remarkPlugins={remarkGfm ? [remarkGfm] : []}
                        components={components}
                    >
                        {content}
                    </ReactMarkdown>
                </div>
            </div>
        );
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
