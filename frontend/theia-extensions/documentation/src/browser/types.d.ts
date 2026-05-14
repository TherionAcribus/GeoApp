declare module '*.md' {
    const content: string;
    export default content;
}

declare module 'flexsearch' {
    export class Document {
        constructor(options: any);
        add(doc: any): void;
        search(query: string, options?: any): any[];
    }
    export class Index {
        constructor(options?: any);
        add(id: any, content: string): void;
        search(query: string, options?: any): any[];
    }
}

declare module 'react-markdown' {
    import * as React from 'react';
    interface ReactMarkdownProps {
        children: string;
        remarkPlugins?: any[];
        rehypePlugins?: any[];
        components?: Record<string, any>;
        [key: string]: any;
    }
    const ReactMarkdown: React.ComponentType<ReactMarkdownProps>;
    export default ReactMarkdown;
}

declare module 'remark-gfm' {
    const remarkGfm: any;
    export default remarkGfm;
}

declare module 'gray-matter' {
    interface GrayMatterFile {
        data: Record<string, any>;
        content: string;
        excerpt?: string;
    }
    function matter(input: string, options?: any): GrayMatterFile;
    export = matter;
}
