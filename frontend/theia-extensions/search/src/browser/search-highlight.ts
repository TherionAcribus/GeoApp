/**
 * Utilitaire de surlignage DOM pour la recherche GeoApp.
 * 
 * Parcourt les nœuds texte du DOM avec un TreeWalker,
 * injecte des <mark> pour surligner les occurrences trouvées.
 */

import { SearchMatch } from '../common/search-protocol';

const HIGHLIGHT_CLASS = 'geoapp-search-highlight';
const HIGHLIGHT_ACTIVE_CLASS = 'geoapp-search-highlight-active';

/**
 * Représente un nœud texte DOM avec sa position dans le texte global.
 */
interface TextNodeMapping {
    node: Text;
    globalStart: number;
    globalEnd: number;
}

/**
 * Collecte tous les nœuds texte d'un élément DOM et leur position
 * dans le textContent global concaténé.
 */
function collectTextNodes(root: HTMLElement): TextNodeMapping[] {
    const mappings: TextNodeMapping[] = [];

    // Exclure le conteneur de l'overlay de recherche
    const overlayContainer = root.querySelector('#geoapp-search-overlay-container');

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode(node: Node): number {
            // Ignorer les nœuds texte à l'intérieur de l'overlay de recherche
            if (overlayContainer && overlayContainer.contains(node)) {
                return NodeFilter.FILTER_REJECT;
            }
            return NodeFilter.FILTER_ACCEPT;
        }
    });
    let offset = 0;

    let textNode: Text | null;
    while ((textNode = walker.nextNode() as Text | null)) {
        const len = textNode.textContent?.length || 0;
        if (len > 0) {
            mappings.push({
                node: textNode,
                globalStart: offset,
                globalEnd: offset + len
            });
            offset += len;
        }
    }

    return mappings;
}

/**
 * Supprime tous les surlignages de recherche dans un élément.
 * Restaure les nœuds texte originaux.
 */
export function clearHighlights(root: HTMLElement): void {
    const marks = root.querySelectorAll(`mark.${HIGHLIGHT_CLASS}`);
    marks.forEach(mark => {
        const parent = mark.parentNode;
        if (parent) {
            // Remplacer le <mark> par son contenu texte
            const textNode = document.createTextNode(mark.textContent || '');
            parent.replaceChild(textNode, mark);
            // Fusionner les nœuds texte adjacents
            parent.normalize();
        }
    });
}

/**
 * Crée un élément <mark> avec les classes appropriées.
 */
function createHighlightMark(text: string, isActive: boolean): HTMLElement {
    const mark = document.createElement('mark');
    mark.className = isActive
        ? `${HIGHLIGHT_CLASS} ${HIGHLIGHT_ACTIVE_CLASS}`
        : HIGHLIGHT_CLASS;
    mark.textContent = text;
    return mark;
}

/**
 * Surligne les matches dans un élément DOM.
 * Opère sur le textContent global de l'élément.
 * 
 * @param root L'élément DOM racine dans lequel surligner
 * @param matches Les matches à surligner (avec startOffset/endOffset relatifs au textContent global)
 * @param activeMatchIndex L'index du match actif (surlignage différent)
 * @returns L'élément <mark> du match actif, ou null
 */
export function applyHighlights(
    root: HTMLElement,
    matches: SearchMatch[],
    activeMatchIndex: number
): HTMLElement | null {
    // D'abord nettoyer les surlignages existants
    clearHighlights(root);

    if (matches.length === 0) {
        return null;
    }

    // Collecter les nœuds texte et leur mapping de position
    const textNodes = collectTextNodes(root);
    if (textNodes.length === 0) {
        return null;
    }

    let activeElement: HTMLElement | null = null;

    // Trier les matches par offset décroissant pour les injecter de droite à gauche
    // (évite de décaler les offsets des matches suivants)
    const sortedMatches = [...matches].sort((a, b) => b.startOffset - a.startOffset);

    for (const match of sortedMatches) {
        const isActive = match.index === activeMatchIndex;
        highlightSingleMatch(textNodes, match, isActive, (mark) => {
            if (isActive) {
                activeElement = mark;
            }
        });
    }

    return activeElement;
}

/**
 * Surligne un seul match dans les nœuds texte.
 */
function highlightSingleMatch(
    textNodes: TextNodeMapping[],
    match: SearchMatch,
    isActive: boolean,
    onMarkCreated: (mark: HTMLElement) => void
): void {
    const matchStart = match.startOffset;
    const matchEnd = match.endOffset;

    // Trouver les nœuds texte qui couvrent ce match
    for (let i = 0; i < textNodes.length; i++) {
        const mapping = textNodes[i];

        // Ce nœud texte intersecte-t-il le match ?
        if (mapping.globalEnd <= matchStart || mapping.globalStart >= matchEnd) {
            continue;
        }

        const node = mapping.node;
        const nodeText = node.textContent || '';

        // Calculer les offsets locaux dans ce nœud texte
        const localStart = Math.max(0, matchStart - mapping.globalStart);
        const localEnd = Math.min(nodeText.length, matchEnd - mapping.globalStart);

        if (localStart >= localEnd) {
            continue;
        }

        const parent = node.parentNode;
        if (!parent) {
            continue;
        }

        // Découper le nœud texte en 3 parties : avant, match, après
        const before = nodeText.substring(0, localStart);
        const highlighted = nodeText.substring(localStart, localEnd);
        const after = nodeText.substring(localEnd);

        const fragment = document.createDocumentFragment();

        if (before) {
            fragment.appendChild(document.createTextNode(before));
        }

        const mark = createHighlightMark(highlighted, isActive);
        fragment.appendChild(mark);
        onMarkCreated(mark);

        if (after) {
            fragment.appendChild(document.createTextNode(after));
        }

        parent.replaceChild(fragment, node);

        // Mettre à jour les mappings pour les nœuds texte restants
        // (les offsets ont changé à cause de l'insertion)
        // Note : comme on traite de droite à gauche (sortedMatches),
        // les nœuds précédents ne sont pas affectés
        break; // Un match ne couvre généralement qu'un seul nœud texte
    }
}

/**
 * Scrolle vers un élément <mark> actif de manière fluide.
 */
export function scrollToHighlight(mark: HTMLElement): void {
    mark.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
        inline: 'nearest'
    });
}
