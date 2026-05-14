#!/usr/bin/env node
/**
 * Script de génération du registre de documentation.
 * Parcourt docs/ récursivement, lit le frontmatter YAML,
 * génère src/browser/generated/doc-registry.ts avec les imports webpack-ready.
 */

import { readFileSync, readdirSync, statSync, mkdirSync, writeFileSync } from 'fs';
import { join, relative, dirname, extname, basename } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');
const DOCS_DIR = join(ROOT, 'docs');
const OUT_DIR = join(ROOT, 'src', 'browser', 'generated');
const OUT_FILE = join(OUT_DIR, 'doc-registry.ts');

/**
 * Parse le frontmatter YAML minimal (sans dépendances externes au moment du build).
 */
function parseFrontmatter(content) {
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    if (!match) {
        return { data: {}, content };
    }
    const yamlBlock = match[1];
    const data = {};
    for (const line of yamlBlock.split('\n')) {
        const sep = line.indexOf(':');
        if (sep === -1) continue;
        const key = line.slice(0, sep).trim();
        let value = line.slice(sep + 1).trim();
        if (value.startsWith('"') && value.endsWith('"')) {
            value = value.slice(1, -1);
        }
        if (value.startsWith('[') && value.endsWith(']')) {
            data[key] = value.slice(1, -1).split(',').map(s => s.trim().replace(/^['"]|['"]$/g, ''));
        } else if (!isNaN(Number(value)) && value !== '') {
            data[key] = Number(value);
        } else {
            data[key] = value;
        }
    }
    const body = content.slice(match[0].length).trim();
    return { data, content: body };
}

/**
 * Parcourt récursivement un dossier et retourne tous les fichiers .md.
 */
function collectMarkdownFiles(dir, base = dir) {
    const results = [];
    for (const entry of readdirSync(dir)) {
        const fullPath = join(dir, entry);
        const stat = statSync(fullPath);
        if (stat.isDirectory()) {
            results.push(...collectMarkdownFiles(fullPath, base));
        } else if (extname(entry) === '.md') {
            results.push(fullPath);
        }
    }
    return results;
}

/**
 * Convertit un chemin de fichier en identifiant de page lisible.
 * Ex: docs/getting-started/interface.md -> "getting-started.interface"
 */
function pathToId(filePath) {
    const rel = relative(DOCS_DIR, filePath);
    return rel.replace(/\\/g, '/').replace(/\.md$/, '').replace(/\//g, '.');
}

/**
 * Convertit un identifiant de page en chemin de chapitre (groupe).
 */
function pathToChapter(filePath) {
    const rel = relative(DOCS_DIR, filePath);
    const parts = rel.replace(/\\/g, '/').split('/');
    return parts.length > 1 ? parts[0] : 'root';
}

/**
 * Génère un nom de variable TypeScript valide depuis l'id de page.
 */
function idToVarName(id) {
    return 'page_' + id.replace(/[^a-zA-Z0-9]/g, '_');
}

// Collecte tous les fichiers markdown
const mdFiles = collectMarkdownFiles(DOCS_DIR);
mdFiles.sort();

if (mdFiles.length === 0) {
    console.warn('[generate-docs-manifest] Aucun fichier .md trouvé dans docs/');
    process.exit(0);
}

// Analyse chaque fichier
const pages = mdFiles.map((filePath) => {
    const raw = readFileSync(filePath, 'utf-8');
    const { data, content } = parseFrontmatter(raw);
    const id = pathToId(filePath);
    const chapter = pathToChapter(filePath);
    const varName = idToVarName(id);

    // Chemin d'import relatif depuis le fichier généré vers docs/
    // src/browser/generated/doc-registry.ts -> ../../../docs/...
    const relPath = relative(OUT_DIR, filePath).replace(/\\/g, '/');

    return {
        id,
        chapter,
        varName,
        relPath,
        title: data.title || basename(filePath, '.md'),
        description: data.description || '',
        order: data.order !== undefined ? data.order : 999,
        tags: Array.isArray(data.tags) ? data.tags : [],
    };
});

// Génère le fichier TypeScript
mkdirSync(OUT_DIR, { recursive: true });

const imports = pages.map(p => `import ${p.varName} from '${p.relPath}';`).join('\n');

const pagesArray = pages.map(p => `    {
        id: ${JSON.stringify(p.id)},
        chapter: ${JSON.stringify(p.chapter)},
        title: ${JSON.stringify(p.title)},
        description: ${JSON.stringify(p.description)},
        order: ${p.order},
        tags: ${JSON.stringify(p.tags)},
        content: ${p.varName},
    }`).join(',\n');

const output = `// FICHIER GÉNÉRÉ AUTOMATIQUEMENT - NE PAS MODIFIER MANUELLEMENT
// Généré par scripts/generate-docs-manifest.mjs
// Relancez "yarn build" dans l'extension documentation pour le régénérer.

${imports}

export interface DocPageMeta {
    id: string;
    chapter: string;
    title: string;
    description: string;
    order: number;
    tags: string[];
    content: string;
}

export const DOC_PAGES: DocPageMeta[] = [
${pagesArray}
];
`;

writeFileSync(OUT_FILE, output, 'utf-8');
console.log(`[generate-docs-manifest] ${pages.length} page(s) générée(s) dans doc-registry.ts`);
