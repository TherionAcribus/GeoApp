/**
 * Rendu React du Markdown des logs de géocaches.
 *
 * Partagé entre l'éditeur de logs (aperçu avant envoi) et la liste des logs
 * (affichage des logs récupérés depuis Geocaching.com), pour que les deux
 * surfaces affichent exactement la même chose.
 *
 * L'analyse est dans `log-markdown.ts` (sans React, donc testable).
 */

import * as React from 'react';

import { InlineToken, MarkdownBlock, parseMarkdownBlocks, tokenizeInlineMarkdown } from './log-markdown';

function renderInlineToken(token: InlineToken, key: string): React.ReactNode {
    switch (token.kind) {
        case 'code':
            return <code key={key}>{token.content}</code>;
        case 'bold':
            return <strong key={key}>{token.content}</strong>;
        case 'italic':
            return <em key={key}>{token.content}</em>;
        case 'link':
            return token.safeUrl ? (
                <a
                    key={key}
                    href={token.safeUrl}
                    target='_blank'
                    rel='noreferrer'
                    style={{ color: 'var(--theia-textLink-foreground)' }}
                >
                    {token.label}
                </a>
            ) : (
                <React.Fragment key={key}>{token.label} ({token.url})</React.Fragment>
            );
        default:
            return <React.Fragment key={key}>{token.content}</React.Fragment>;
    }
}

/** Rend une ligne de Markdown inline (gras, italique, code, liens). */
export function renderInlineLogMarkdown(text: string, keyPrefix: string): React.ReactNode[] {
    return tokenizeInlineMarkdown(text).map((token, index) => renderInlineToken(token, `${keyPrefix}-${index}`));
}

function renderBlock(block: MarkdownBlock, key: string): React.ReactNode {
    switch (block.kind) {
        case 'code':
            return (
                <pre
                    key={key}
                    style={{
                        margin: '8px 0',
                        padding: 10,
                        borderRadius: 6,
                        border: '1px solid var(--theia-panel-border)',
                        background: 'var(--theia-editor-background)',
                        overflow: 'auto',
                        fontSize: 12,
                    }}
                >
                    <code>{block.content}</code>
                </pre>
            );
        case 'heading': {
            const Tag = (block.level === 1 ? 'h1' : block.level === 2 ? 'h2' : 'h3') as any;
            return (
                <Tag key={key} style={{ margin: '10px 0 6px 0' }}>
                    {renderInlineLogMarkdown(block.content, `${key}-in`)}
                </Tag>
            );
        }
        case 'quote':
            return (
                <blockquote
                    key={key}
                    style={{
                        margin: '8px 0',
                        paddingLeft: 10,
                        borderLeft: '3px solid var(--theia-panel-border)',
                        opacity: 0.9,
                    }}
                >
                    {renderBlocks(block.blocks, `${key}-inner`)}
                </blockquote>
            );
        case 'list':
            return (
                <ul key={key} style={{ margin: '6px 0 6px 20px' }}>
                    {block.items.map((item, index) => (
                        <li key={`${key}-li-${index}`}>
                            {renderInlineLogMarkdown(item, `${key}-li-in-${index}`)}
                        </li>
                    ))}
                </ul>
            );
        default:
            return (
                <p key={key} style={{ margin: '6px 0', whiteSpace: 'pre-wrap' }}>
                    {block.lines.map((line, index) => (
                        <React.Fragment key={`${key}-l-${index}`}>
                            {renderInlineLogMarkdown(line, `${key}-l-in-${index}`)}
                            {index < block.lines.length - 1 ? <br /> : null}
                        </React.Fragment>
                    ))}
                </p>
            );
    }
}

function renderBlocks(blocks: MarkdownBlock[], keyPrefix: string): React.ReactNode {
    return (
        <div style={{ display: 'grid', gap: 4 }}>
            {blocks.map((block, index) => renderBlock(block, `${keyPrefix}-b-${index}`))}
        </div>
    );
}

/** Rend un texte de log Markdown complet (titres, listes, citations, code, emphases). */
export function renderLogMarkdown(text: string, keyPrefix: string): React.ReactNode {
    return renderBlocks(parseMarkdownBlocks(text), keyPrefix);
}
