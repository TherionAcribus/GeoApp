/**
 * URL publiques Geocaching.com liées au propriétaire d'une géocache.
 *
 * Deux identifiants coexistent côté Geocaching : le pseudo, qui suffit pour la
 * fiche publique, et le GUID, seule clé acceptée par le centre de messages. Le
 * GUID est lu sur le listing au scrape et stocké dans `geocache.owner_guid` ;
 * il peut manquer sur les géocaches importées avant son introduction, d'où les
 * retours `undefined` que l'appelant doit gérer.
 */

const GEOCACHING_BASE_URL = 'https://www.geocaching.com';

/**
 * Fiche publique du propriétaire. Le GUID est préféré (stable même après un
 * renommage du joueur) ; à défaut, le pseudo fait l'affaire.
 */
export function buildOwnerProfileUrl(owner?: string, ownerGuid?: string): string | undefined {
    const guid = (ownerGuid || '').trim();
    if (guid) {
        return `${GEOCACHING_BASE_URL}/p/?guid=${encodeURIComponent(guid)}`;
    }
    const name = (owner || '').trim();
    if (name) {
        return `${GEOCACHING_BASE_URL}/p/?u=${encodeURIComponent(name)}`;
    }
    return undefined;
}

/**
 * Centre de messages, pré-rempli avec le destinataire et, si on le connaît, le
 * code GC : Geocaching l'affiche alors comme contexte de la conversation.
 * Sans GUID, il n'existe aucune URL d'envoi : on renvoie `undefined`.
 */
export function buildOwnerMessageUrl(ownerGuid?: string, gcCode?: string): string | undefined {
    const guid = (ownerGuid || '').trim();
    if (!guid) {
        return undefined;
    }
    const code = (gcCode || '').trim();
    const suffix = code ? `&gcCode=${encodeURIComponent(code)}` : '';
    return `${GEOCACHING_BASE_URL}/account/messagecenter?recipientId=${encodeURIComponent(guid)}${suffix}`;
}

/** Ouvre une URL hors de GeoApp, dans le navigateur de l'utilisateur. */
export function openExternalUrl(url: string): void {
    window.open(url, '_blank', 'noopener,noreferrer');
}
