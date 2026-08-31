import type { Disposable } from '@theia/core/lib/common/disposable';

/**
 * Evenements de fraicheur des widgets EarthCoach.
 *
 * Les widgets lateraux figent leur contexte au moment du `setContext`: sans
 * signal, une observation ou une photo ajoutee ailleurs n'apparait qu'apres
 * fermeture/reouverture du panneau. Chaque mutation emet donc un evenement
 * `window` portant l'id de la geocache concernee, et les widgets interesses
 * rafraichissent leur contexte.
 */

/** Questions du proprietaire creees, modifiees, supprimees ou extraites. */
export const EARTHCOACH_LOGGING_TASKS_UPDATED_EVENT = 'earthcoach-logging-tasks-updated';

/** Observations structurees creees, modifiees ou supprimees. */
export const EARTHCOACH_OBSERVATIONS_UPDATED_EVENT = 'earthcoach-observations-updated';

/** Deja emis par les widgets images de GeoApp (extension zones): on s'y raccroche. */
export const GEOAPP_GEOCACHE_IMAGES_UPDATED_EVENT = 'geoapp-geocache-images-updated';

export interface EarthCoachDataUpdatedDetail {
    geocacheId?: number;
    /** Emetteur de l'evenement: un widget peut ainsi ignorer ses propres mutations. */
    origin?: string;
}

/** Lit l'id de geocache d'un detail d'evenement, en tolerant tout payload inattendu. */
export function readUpdatedGeocacheId(detail: unknown): number | undefined {
    if (!detail || typeof detail !== 'object') {
        return undefined;
    }
    const value = (detail as EarthCoachDataUpdatedDetail).geocacheId;
    const parsed = typeof value === 'number' ? value : Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) {
        return undefined;
    }
    return parsed;
}

export function readUpdateOrigin(detail: unknown): string | undefined {
    if (!detail || typeof detail !== 'object') {
        return undefined;
    }
    const origin = (detail as EarthCoachDataUpdatedDetail).origin;
    return typeof origin === 'string' && origin ? origin : undefined;
}

/**
 * Un widget ne se rafraichit que si la mutation concerne la cache qu'il affiche:
 * un evenement sans id, ou pour une autre cache, est ignore. `ignoreOrigin` sert
 * a un widget qui emet et ecoute le meme evenement: il a deja recharge lui-meme.
 */
export function isUpdateForGeocache(
    detail: unknown,
    geocacheId: number | undefined,
    options?: { ignoreOrigin?: string }
): boolean {
    const updatedId = readUpdatedGeocacheId(detail);
    if (updatedId === undefined || geocacheId === undefined || updatedId !== geocacheId) {
        return false;
    }
    const ignoreOrigin = options?.ignoreOrigin;
    return !ignoreOrigin || readUpdateOrigin(detail) !== ignoreOrigin;
}

export function dispatchEarthCoachDataUpdated(
    eventName: string,
    geocacheId: number | undefined,
    origin?: string
): void {
    if (typeof window === 'undefined' || !geocacheId) {
        return;
    }
    window.dispatchEvent(new CustomEvent(eventName, { detail: { geocacheId, origin } }));
}

/**
 * Abonne un widget a plusieurs evenements de fraicheur. Le handler recoit l'id
 * de la geocache mutee; a lui de le comparer a celle qu'il affiche.
 */
export function subscribeEarthCoachDataUpdates(
    eventNames: readonly string[],
    handler: (detail: unknown) => void
): Disposable {
    if (typeof window === 'undefined') {
        return { dispose: () => { /* pas de DOM: rien a nettoyer */ } };
    }
    const listener = (event: Event): void => handler((event as CustomEvent).detail);
    for (const eventName of eventNames) {
        window.addEventListener(eventName, listener);
    }
    return {
        dispose: () => {
            for (const eventName of eventNames) {
                window.removeEventListener(eventName, listener);
            }
        },
    };
}

/**
 * Un widget cache (onglet lateral non actif) n'a aucune raison de relancer une
 * collecte reseau: on memorise la demande et on la rejoue a l'affichage.
 */
export class EarthCoachRefreshScheduler {

    protected pending = false;

    constructor(
        protected readonly isVisible: () => boolean,
        protected readonly refresh: () => void
    ) { }

    get hasPendingRefresh(): boolean {
        return this.pending;
    }

    /** Demande un rafraichissement: immediat si le widget est visible, differe sinon. */
    request(): void {
        if (!this.isVisible()) {
            this.pending = true;
            return;
        }
        this.pending = false;
        this.refresh();
    }

    /** A appeler quand le widget redevient visible. */
    flush(): void {
        if (!this.pending) {
            return;
        }
        this.pending = false;
        this.refresh();
    }
}
