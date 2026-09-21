/**
 * Fermeture d'un menu déroulant au clic extérieur et à `Escape`.
 *
 * Partagé par les deux split buttons de l'éditeur de logs (traduction, correction) : sans
 * mise en commun, la même vingtaine de lignes d'`addEventListener`/`removeEventListener`
 * serait recopiée, et une seule des deux serait corrigée le jour où elle fuit.
 *
 * `onClose` est lu à chaque rendu : l'abonnement se refait quand l'identité du callback change,
 * ce qui reste négligeable pour un menu ouvert.
 */

import * as React from '@theia/core/shared/react';

export function useDismissMenu(
    open: boolean,
    containerRef: React.RefObject<HTMLElement>,
    onClose: () => void
): void {
    React.useEffect(() => {
        if (!open) {
            return;
        }
        const handleClickOutside = (event: MouseEvent): void => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                onClose();
            }
        };
        const handleKeyDown = (event: KeyboardEvent): void => {
            if (event.key === 'Escape') {
                onClose();
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [open, containerRef, onClose]);
}

/** Active un item de menu au clavier (Enter / Espace), comme un clic. */
export function activateMenuItemOnKey(event: React.KeyboardEvent, activate: () => void): void {
    if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        activate();
    }
}
