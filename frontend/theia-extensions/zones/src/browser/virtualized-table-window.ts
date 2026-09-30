/**
 * Fenêtre de virtualisation partagée par les tableaux (zones, trackables) :
 * ne rend que les lignes visibles + un overscan, en conservant la hauteur
 * totale via deux lignes espaceurs.
 *
 * La hauteur de ligne doit rester synchronisée avec la variable CSS
 * `--geoapp-gc-row-height` posée sur le conteneur de scroll — en cas de dérive,
 * le scroll se décale sous le contenu.
 */
import * as React from 'react';

export const VIRTUAL_ROW_HEIGHT = 34;
export const VIRTUAL_OVERSCAN = 8;

export interface VirtualWindow {
    startIndex: number;
    endIndex: number;
    paddingTop: number;
    paddingBottom: number;
}

/**
 * Virtualisation maison (windowing) : ne rend que les lignes visibles + un
 * overscan, en conservant la hauteur totale via deux lignes espaceurs.
 * Évite d'ajouter une dépendance externe (@tanstack/react-virtual).
 */
export function useRowVirtualizer(
    rowCount: number,
    scrollRef: React.RefObject<HTMLElement>,
    rowHeight: number = VIRTUAL_ROW_HEIGHT,
): VirtualWindow {
    const [scrollTop, setScrollTop] = React.useState(0);
    const [viewportHeight, setViewportHeight] = React.useState(0);

    React.useEffect(() => {
        const el = scrollRef.current;
        if (!el) {
            return;
        }

        let frame = 0;
        const sync = (): void => {
            setScrollTop(el.scrollTop);
            setViewportHeight(el.clientHeight);
        };
        const onScroll = (): void => {
            if (frame) {
                return;
            }
            frame = window.requestAnimationFrame(() => {
                frame = 0;
                sync();
            });
        };

        sync();
        el.addEventListener('scroll', onScroll, { passive: true });
        const resizeObserver = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(sync) : undefined;
        resizeObserver?.observe(el);

        return () => {
            if (frame) {
                window.cancelAnimationFrame(frame);
            }
            el.removeEventListener('scroll', onScroll);
            resizeObserver?.disconnect();
        };
    }, [scrollRef]);

    const totalHeight = rowCount * rowHeight;
    const startIndex = Math.max(0, Math.floor(scrollTop / rowHeight) - VIRTUAL_OVERSCAN);
    const rowsInViewport = viewportHeight > 0 ? Math.ceil(viewportHeight / rowHeight) : 0;
    const visibleCount = rowsInViewport + VIRTUAL_OVERSCAN * 2;
    const endIndex = Math.min(rowCount, startIndex + visibleCount);
    const paddingTop = startIndex * rowHeight;
    const paddingBottom = Math.max(0, totalHeight - endIndex * rowHeight);

    return { startIndex, endIndex, paddingTop, paddingBottom };
}
