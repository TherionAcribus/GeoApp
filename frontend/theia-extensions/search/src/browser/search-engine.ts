/**
 * Moteur de recherche GeoApp.
 * 
 * Supporte trois modes : texte simple, wildcards (* et ?), regex.
 * Opère sur du texte brut et retourne des SearchMatch[].
 */

import { SearchMatch, SearchOptions, SearchableContent } from '../common/search-protocol';

/**
 * Échappe les caractères spéciaux d'une regex.
 */
function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Convertit un pattern wildcard en regex.
 * * → .* (n'importe quoi)
 * ? → .  (un caractère)
 */
function wildcardToRegex(pattern: string): string {
    // Échapper tout sauf * et ?
    let result = '';
    for (const ch of pattern) {
        if (ch === '*') {
            result += '.*';
        } else if (ch === '?') {
            result += '.';
        } else {
            result += escapeRegex(ch);
        }
    }
    return result;
}

/**
 * Normalise un texte pour la recherche insensible aux accents.
 * Supprime les diacritiques (accents) via décomposition Unicode.
 */
function normalizeForSearch(text: string): string {
    return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/**
 * Construit la RegExp à partir de la query et des options.
 * Retourne null si la query est invalide.
 */
export function buildSearchRegex(query: string, options: SearchOptions): RegExp | null {
    if (!query) {
        return null;
    }

    let pattern: string;
    let flags = 'g'; // global pour trouver toutes les occurrences

    if (!options.caseSensitive) {
        flags += 'i';
    }

    if (options.useRegex) {
        pattern = query;
    } else if (options.useWildcard) {
        pattern = wildcardToRegex(query);
    } else {
        pattern = escapeRegex(query);
    }

    try {
        return new RegExp(pattern, flags);
    } catch {
        // Regex invalide (ex: parenthèse non fermée)
        return null;
    }
}

/**
 * Recherche dans un tableau de SearchableContent.
 * Retourne tous les matches trouvés, indexés globalement.
 */
export function searchInContents(
    contents: SearchableContent[],
    query: string,
    options: SearchOptions
): SearchMatch[] {
    const matches: SearchMatch[] = [];

    if (!query) {
        return matches;
    }

    // Pour la recherche insensible aux accents (mode non-regex, non case-sensitive),
    // on normalise le texte et la query
    const shouldNormalize = !options.useRegex && !options.caseSensitive;

    const searchQuery = shouldNormalize ? normalizeForSearch(query) : query;
    const regex = buildSearchRegex(searchQuery, options);

    if (!regex) {
        return matches;
    }

    let globalIndex = 0;

    for (const content of contents) {
        const text = shouldNormalize ? normalizeForSearch(content.text) : content.text;

        // Reset lastIndex pour chaque nouveau contenu
        regex.lastIndex = 0;

        let match: RegExpExecArray | null;
        while ((match = regex.exec(text)) !== null) {
            matches.push({
                index: globalIndex++,
                contentId: content.id,
                startOffset: match.index,
                endOffset: match.index + match[0].length,
                matchText: content.text.substring(match.index, match.index + match[0].length)
            });

            // Éviter les boucles infinies sur des matches de longueur 0
            if (match[0].length === 0) {
                regex.lastIndex++;
            }
        }
    }

    return matches;
}

/**
 * Extrait le textContent d'un nœud DOM en excluant certains éléments.
 */
function getTextContentExcluding(node: HTMLElement, excludeSelector?: string): string {
    if (!excludeSelector) {
        return node.textContent || '';
    }

    // Cloner le nœud pour ne pas modifier le DOM original
    const clone = node.cloneNode(true) as HTMLElement;
    const excluded = clone.querySelectorAll(excludeSelector);
    excluded.forEach(el => el.remove());
    return clone.textContent || '';
}

/**
 * Recherche dans le texte brut d'un nœud DOM (mode fallback).
 * Extrait le textContent du nœud et retourne les matches.
 * Exclut le conteneur de l'overlay de recherche pour éviter
 * de matcher le texte de l'UI de recherche elle-même.
 */
export function searchInDomNode(
    node: HTMLElement,
    query: string,
    options: SearchOptions
): SearchMatch[] {
    const textContent = getTextContentExcluding(node, '#geoapp-search-overlay-container');
    const content: SearchableContent = {
        id: '__dom_fallback__',
        text: textContent,
        element: node
    };
    return searchInContents([content], query, options);
}
