/**
 * Liste virtualisée à hauteurs variables.
 *
 * Ne monte dans le DOM que les éléments proches de la zone visible ; les autres
 * ne sont représentés que par la hauteur cumulée de leurs voisins. Contrairement
 * à `content-visibility`, les nœuds hors champ n'existent pas du tout : c'est ce
 * qui allège le DOM des longues listes (logs d'une cache, blocs d'une sortie).
 *
 * Les hauteurs réelles sont mesurées par `ResizeObserver` sur les éléments
 * montés et mémorisées par clé : une estimation fausse est corrigée dès le
 * premier rendu de l'élément, et un élément qui redevient visible retrouve sa
 * vraie hauteur sans que la barre de défilement ne saute.
 *
 * Le conteneur de défilement est détecté en remontant les ancêtres — la liste
 * n'a pas besoin de savoir si elle vit dans un panneau ou une page complète.
 */

import * as React from '@theia/core/shared/react';
import { computeWindowRange } from './virtualized-range';

export interface VirtualizedListProps<T> {
    items: readonly T[];
    /** Clé stable d'un élément : elle rattache la hauteur mesurée à l'élément. */
    itemKey: (item: T, index: number) => React.Key;
    renderItem: (item: T, index: number) => React.ReactNode;
    /** Hauteur de repli avant la première mesure d'un élément. */
    estimatedItemHeight: number;
    /**
     * Espacement entre éléments. Ne s'applique qu'aux écarts qui ne sont pas
     * déjà portés par une marge mesurée dans la hauteur de l'élément.
     */
    gap?: number;
    /** Marge de montage au-delà de la zone visible, en pixels. */
    overscan?: number;
    className?: string;
}

/**
 * Nombre d'éléments montés avant que le conteneur de défilement soit mesuré :
 * assez pour remplir un écran sans payer le coût d'une liste complète.
 */
const INITIAL_WINDOW_SIZE = 20;

/** Premier ancêtre qui défile réellement (`overflow-y: auto|scroll`). */
function findScrollParent(element: HTMLElement | null): HTMLElement | null {
    let node = element ? element.parentElement : null;
    while (node) {
        const { overflowY } = window.getComputedStyle(node);
        if (overflowY === 'auto' || overflowY === 'scroll') {
            return node;
        }
        node = node.parentElement;
    }
    return null;
}

export function VirtualizedList<T>(props: VirtualizedListProps<T>): React.ReactElement {
    const {
        items, itemKey, renderItem,
        estimatedItemHeight, gap = 0, overscan = 600, className,
    } = props;

    const containerRef = React.useRef<HTMLDivElement | null>(null);
    // `undefined` : pas encore sondé ; `null` : aucun ancêtre défilant trouvé.
    const [scrollParent, setScrollParent] = React.useState<HTMLElement | null | undefined>(undefined);
    const scrollParentRef = React.useRef<HTMLElement | null>(null);
    const [viewport, setViewport] = React.useState({ top: 0, height: 0 });
    const viewportRef = React.useRef(viewport);
    const heightsRef = React.useRef(new Map<React.Key, number>());
    const offsetsRef = React.useRef<number[]>([]);
    const nodesRef = React.useRef(new Map<React.Key, HTMLDivElement>());
    const rafRef = React.useRef(0);
    const [, bumpMeasurements] = React.useReducer((c: number) => c + 1, 0);
    const itemsRef = React.useRef(items);
    itemsRef.current = items;
    const itemKeyRef = React.useRef(itemKey);
    itemKeyRef.current = itemKey;
    const estimatedHeightRef = React.useRef(estimatedItemHeight);
    estimatedHeightRef.current = estimatedItemHeight;

    // Un seul observer pour tous les éléments montés : chaque changement de
    // hauteur réelle (contenu, textarea redimensionné, aperçu ouvert) remplace
    // l'estimation.
    const observerRef = React.useRef<ResizeObserver | null>(null);
    const getObserver = React.useCallback((): ResizeObserver | undefined => {
        if (typeof ResizeObserver === 'undefined') {
            return undefined;
        }
        if (!observerRef.current) {
            observerRef.current = new ResizeObserver(entries => {
                let changed = false;
                let scrollAdjust = 0;
                for (const entry of entries) {
                    const el = entry.target as HTMLDivElement;
                    const index = Number(el.dataset.vindex);
                    const item = itemsRef.current[index];
                    if (item === undefined) {
                        continue;
                    }
                    const key = itemKeyRef.current(item, index);
                    const height = el.offsetHeight;
                    const previous = heightsRef.current.get(key);
                    if (height <= 0 || previous === height) {
                        continue;
                    }
                    heightsRef.current.set(key, height);
                    changed = true;
                    // Élément entièrement au-dessus de la fenêtre : compenser le
                    // défilement pour que le contenu visible ne saute pas.
                    const previousHeight = previous ?? estimatedHeightRef.current;
                    if (offsetsRef.current[index] + previousHeight < viewportRef.current.top) {
                        scrollAdjust += height - previousHeight;
                    }
                }
                const sp = scrollParentRef.current;
                if (scrollAdjust !== 0 && sp) {
                    sp.scrollTop += scrollAdjust;
                }
                if (changed) {
                    bumpMeasurements();
                }
            });
        }
        return observerRef.current;
    }, []);

    const attachItem = React.useCallback((key: React.Key, el: HTMLDivElement | null) => {
        const nodes = nodesRef.current;
        if (el) {
            if (nodes.get(key) !== el) {
                nodes.set(key, el);
                getObserver()?.observe(el);
            }
        } else {
            // La clé est démontée : sans `unobserve`, l'observer retiendrait le
            // nœud détaché — et tout son sous-arbre — indéfiniment.
            const previous = nodes.get(key);
            if (previous) {
                getObserver()?.unobserve(previous);
                nodes.delete(key);
            }
        }
    }, [getObserver]);

    // Une lambda de ref nouvelle à chaque rendu serait appelée `null` puis `el`
    // par React, et déclencherait unobserve/observe à chaque frappe : les
    // callbacks sont donc mémorisés par clé, stables tant que l'élément vit.
    const refCallbacksRef = React.useRef(new Map<React.Key, (el: HTMLDivElement | null) => void>());
    const getRefCallback = React.useCallback(
        (key: React.Key): ((el: HTMLDivElement | null) => void) => {
            let callback = refCallbacksRef.current.get(key);
            if (!callback) {
                callback = el => attachItem(key, el);
                refCallbacksRef.current.set(key, callback);
            }
            return callback;
        },
        [attachItem]
    );

    const updateViewport = React.useCallback(() => {
        const container = containerRef.current;
        const sp = scrollParentRef.current;
        if (!container || !sp) {
            return;
        }
        // Position du haut de la liste dans le repère du contenu défilant : la
        // liste n'est pas forcément en tête du conteneur scrollable (l'éditeur a
        // un en-tête, un tableau et l'éditeur global au-dessus).
        const containerTop = container.getBoundingClientRect().top
            - sp.getBoundingClientRect().top + sp.scrollTop;
        const next = {
            top: Math.max(0, sp.scrollTop - containerTop),
            height: sp.clientHeight,
        };
        const prev = viewportRef.current;
        if (Math.abs(next.top - prev.top) > 0.5 || Math.abs(next.height - prev.height) > 0.5) {
            viewportRef.current = next;
            setViewport(next);
        }
    }, []);

    React.useEffect(() => {
        const sp = findScrollParent(containerRef.current);
        scrollParentRef.current = sp;
        setScrollParent(sp ?? null);
        if (!sp) {
            return;
        }
        const schedule = () => {
            cancelAnimationFrame(rafRef.current);
            rafRef.current = requestAnimationFrame(updateViewport);
        };
        sp.addEventListener('scroll', schedule, { passive: true });
        window.addEventListener('resize', schedule);
        // La hauteur du viewport change avec la taille du panneau, pas avec le défilement.
        const resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(schedule) : undefined;
        resizeObserver?.observe(sp);
        updateViewport();
        return () => {
            sp.removeEventListener('scroll', schedule);
            window.removeEventListener('resize', schedule);
            resizeObserver?.disconnect();
            cancelAnimationFrame(rafRef.current);
        };
    }, [updateViewport]);

    // Le contenu placé au-dessus de la liste peut changer de hauteur sans
    // défiler (panneau repliable, aperçu ouvert…) : chaque rendu est l'occasion
    // de recaler la fenêtre.
    React.useEffect(() => {
        updateViewport();
    });

    React.useEffect(() => () => {
        observerRef.current?.disconnect();
        cancelAnimationFrame(rafRef.current);
    }, []);

    const count = items.length;
    const heights = heightsRef.current;
    const offsets: number[] = new Array(count);
    let total = 0;
    for (let i = 0; i < count; i++) {
        offsets[i] = total;
        total += (heights.get(itemKey(items[i], i)) ?? estimatedItemHeight) + gap;
    }
    if (count > 0) {
        total -= gap;
    }
    offsetsRef.current = offsets;

    let startIndex: number;
    let endIndex: number;
    if (scrollParent === undefined) {
        // Première passe : le conteneur n'est pas encore mesuré. Monter une
        // fenêtre initiale plutôt que la liste complète, puisque la mesure qui
        // suit corrigera immédiatement la fenêtre.
        startIndex = 0;
        endIndex = Math.min(count, INITIAL_WINDOW_SIZE) - 1;
    } else if (scrollParent === null) {
        // Aucun conteneur défilant : on renonce à virtualiser plutôt que de
        // risquer de ne rien afficher.
        startIndex = 0;
        endIndex = count - 1;
    } else {
        const range = computeWindowRange(
            offsets,
            i => heights.get(itemKey(items[i], i)) ?? estimatedItemHeight,
            gap,
            viewport.top - overscan,
            viewport.top + viewport.height + overscan,
        );
        startIndex = range.startIndex;
        endIndex = range.endIndex;
    }

    const rendered: React.ReactNode[] = [];
    for (let i = startIndex; i <= endIndex && i < count; i++) {
        const item = items[i];
        const key = itemKey(item, i);
        rendered.push(
            <div
                key={key}
                data-vindex={i}
                ref={getRefCallback(key)}
                // Positionnement absolu : la marge du contenu (carte de log)
                // reste comprise dans la hauteur mesurée du contenant.
                style={{ position: 'absolute', top: offsets[i], left: 0, right: 0 }}
            >
                {renderItem(item, i)}
            </div>
        );
    }

    return (
        <div
            ref={containerRef}
            className={className}
            style={{ position: 'relative', height: total }}
        >
            {rendered}
        </div>
    );
}
