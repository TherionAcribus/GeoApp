/**
 * Portée du panneau Logs : quelle géocache il affiche, et ce que le bandeau
 * doit en dire.
 *
 * Module sans React ni Theia — c'est ce qui le rend testable tel quel. La règle
 * est courte mais a plusieurs cas de bord (aucune géocache affichée, plusieurs
 * onglets sur la même cache, suivi suspendu) : mieux vaut qu'elle vive ailleurs
 * que dans un composant.
 */

/** Identité d'une géocache, telle qu'un panneau a besoin de la connaître. */
export interface GeocacheTabRef {
    geocacheId: number;
    gcCode?: string;
    name?: string;
}

/** Libellé court d'une géocache : son code, à défaut son nom, à défaut son identifiant. */
export function describeGeocacheTab(ref: GeocacheTabRef): string {
    return ref.gcCode || ref.name || `#${ref.geocacheId}`;
}

export interface LogsScopeInput {
    /** Géocache dont les logs sont affichés, `undefined` si le panneau est vide. */
    current?: GeocacheTabRef;
    /** Géocache de l'onglet au premier plan, `undefined` si aucun n'est ouvert. */
    active?: GeocacheTabRef;
    /** Géocaches des onglets ouverts, celle du panneau comprise. */
    openTabs: readonly GeocacheTabRef[];
    /** `true` quand le panneau est réglé sur « suivre l'onglet actif ». */
    following: boolean;
    /** En mode suivi, `true` quand l'utilisateur a choisi une autre géocache. */
    followSuspended: boolean;
}

export interface LogsScopeView {
    /** Les logs affichés ne sont pas ceux de la géocache au premier plan. */
    mismatch: boolean;
    /** Autres géocaches ouvertes, vers lesquelles le panneau peut basculer. */
    others: GeocacheTabRef[];
    /** Proposer de reprendre le suivi automatique. */
    canResumeFollow: boolean;
    /** Le bandeau a quelque chose à dire. */
    visible: boolean;
}

export function resolveLogsScope(input: LogsScopeInput): LogsScopeView {
    const { current, active, openTabs, following, followSuspended } = input;

    // Pas d'onglet de géocache ouvert : il n'y a rien à rattraper, même si le
    // panneau affiche encore les logs d'une géocache dont l'onglet est fermé.
    const mismatch = !!active && active.geocacheId !== current?.geocacheId;
    const others = openTabs.filter(ref => ref.geocacheId !== current?.geocacheId);

    // Reprendre un suivi qui n'est pas suspendu n'aurait aucun effet visible :
    // le bouton ne se propose que quand il change quelque chose.
    const canResumeFollow = following && followSuspended;

    return {
        mismatch,
        others,
        canResumeFollow,
        // Un bandeau permanent qui ne dit rien est du bruit : il ne s'affiche
        // que s'il annonce un décalage ou offre une destination.
        visible: mismatch || canResumeFollow || others.length > 0
    };
}

/**
 * Clé de la préférence qui dit quelle géocache le panneau affiche.
 *
 * - `on-demand` : le panneau ne change de géocache que sur demande explicite
 *   (clic sur « Logs » dans la fiche, ou choix dans le bandeau) ;
 * - `follow-active` : il suit l'onglet de géocache au premier plan.
 */
export const LOGS_PANEL_SYNC_MODE_PREF = 'geoApp.logs.panelSyncMode';

export type LogsPanelSyncMode = 'on-demand' | 'follow-active';

/** Le défaut conserve le comportement historique du panneau. */
export const DEFAULT_LOGS_PANEL_SYNC_MODE: LogsPanelSyncMode = 'on-demand';

export function normalizeLogsPanelSyncMode(value: unknown): LogsPanelSyncMode {
    return value === 'follow-active' ? 'follow-active' : DEFAULT_LOGS_PANEL_SYNC_MODE;
}
