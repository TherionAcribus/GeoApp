/**
 * Fonctions pures du contrôleur des barres latérales (spec §8 — testables sans
 * DOM ni shell Theia). `geoapp-sidebar-controller.ts` applique ces décisions
 * via `ApplicationShell`/`WidgetManager`.
 */

import { GeoAppSidebarViewDescriptor } from './geoapp-sidebar-views';

/** Placement d'une vue tel qu'affiché dans le dialogue. */
export type GeoAppSidebarViewPlacement = 'left' | 'right' | 'other' | 'hidden';

/**
 * Zone de groupement : une vue attachée hors des panneaux latéraux (main,
 * bottom, fenêtre secondaire) est visible mais dans « Autre emplacement » —
 * elle ne doit jamais être présentée comme masquée.
 */
export function placementFor(visible: boolean, area: string | undefined): GeoAppSidebarViewPlacement {
    if (!visible) {
        return 'hidden';
    }
    return area === 'left' || area === 'right' ? area : 'other';
}

export type SidebarResetAction = 'leave' | 'close' | 'recreate';

/**
 * Décision du reset limité au registre (§5.2) :
 * - vue masquée par défaut → `close` si présente, `leave` sinon ;
 * - vue déjà dans sa zone par défaut → `leave` (état interne préservé) ;
 * - vue dans une mauvaise zone ou absente alors qu'elle est par défaut →
 *   `recreate` (fermée puis recréée au rang/zone par défaut).
 */
export function resetActionFor(
    descriptor: GeoAppSidebarViewDescriptor,
    attached: boolean,
    currentArea: string | undefined,
): SidebarResetAction {
    if (!descriptor.defaultVisible) {
        return attached ? 'close' : 'leave';
    }
    if (attached && currentArea === descriptor.defaultArea) {
        return 'leave';
    }
    return 'recreate';
}

/**
 * Sérialise les opérations utilisateur (afficher/masquer/reset) : empêche un
 * double clic de lancer deux créations concurrentes du même widget. Une
 * opération en échec n'empêche pas les suivantes.
 */
export class SidebarOperationQueue {
    private pending: Promise<void> = Promise.resolve();

    enqueue<T>(operation: () => Promise<T>): Promise<T> {
        const run = this.pending.then(operation, operation);
        this.pending = run.then(() => undefined, () => undefined);
        return run;
    }
}
