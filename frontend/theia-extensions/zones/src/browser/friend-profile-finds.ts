import { ConfirmDialog, Dialog } from '@theia/core/lib/browser';
import { getErrorMessage } from './backend-api-client';
import { FriendsService } from './friends-service';

export type FriendProfileFindsOutcome =
    | { status: 'cancelled' }
    | { status: 'done'; message: string }
    | { status: 'error'; message: string; notAuthenticated: boolean };

/**
 * « Récupérer toutes ses trouvailles » : la recherche par profil (§11.2).
 *
 * C'est la réponse à la condensation du flux (§9.2) : celui-ci regroupe les
 * trouvailles d'affilée sans les nommer, cette recherche les donne une par une,
 * de la plus récente à la plus ancienne. Partagé entre le widget Amis (flux
 * filtré sur un ami) et la fiche ami, pour que l'action porte le même nom et
 * demande la même confirmation partout.
 */
export async function fetchFriendProfileFinds(
    friendsService: FriendsService,
    friend: string
): Promise<FriendProfileFindsOutcome> {
    try {
        const estimate = await friendsService.estimateFriendFinds(friend);

        if (estimate?.total !== undefined) {
            const minutes = Math.ceil((estimate.seconds || 0) / 60);
            const capped = (estimate.reachable || 0) < estimate.total;
            const confirmed = await new ConfirmDialog({
                title: `Trouvailles de ${friend}`,
                msg: `${estimate.total} trouvaille(s) annoncée(s)`
                    + (capped
                        ? `, dont les ${estimate.reachable} plus récentes accessibles `
                          + `(geocaching.com limite la pagination). `
                        : '. ')
                    + `Durée estimée : ${minutes} minute(s).`,
                ok: 'Récupérer',
                cancel: Dialog.CANCEL
            }).open();
            if (!confirmed) {
                return { status: 'cancelled' };
            }
        }

        const result = await friendsService.syncFriendFinds(friend);
        if (!result.success) {
            return {
                status: 'error',
                message: result.error_message || 'Échec de la récupération des trouvailles.',
                notAuthenticated: result.error === 'not_authenticated'
            };
        }

        return {
            status: 'done',
            message: `${result.fetched} trouvaille(s) de ${friend} récupérée(s)`
                + ` (${result.created} nouvelle(s))`
                + (result.truncated ? ', liste partielle.' : '.')
        };
    } catch (err) {
        console.error('[Friends] Profile finds fetch failed:', err);
        return {
            status: 'error',
            message: getErrorMessage(err, 'Erreur de connexion au serveur GeoApp'),
            notAuthenticated: false
        };
    }
}
