import * as React from 'react';
import type { FriendZoneScanEntry } from './friends-types';
import { friendColor } from './friend-colors';

/**
 * Barre d'amis actifs — remplace le dropdown « Pas {ami} » (A2) et le dialogue
 * modal de sélection d'amis.
 *
 * Affiche une puce par ami. Chaque puce est cliquable pour activer/désactiver
 * l'ami. Les amis actifs pilotent :
 * - le code couleur des lignes de la table,
 * - la colonne « Amis »,
 * - l'analyse (on ne scanne que les amis actifs),
 * - les filtres.
 *
 * Compteurs : si l'ami a été scanné sur cette zone, on affiche found/total.
 * Sinon, un « ? » indique qu'il n'a jamais été analysé ici.
 *
 * Les amis inactifs et jamais scannés sont repliés dans « + N autres ».
 */

export interface FriendChipsBarProps {
    /** « Qui a trouvé quoi » : code GC -> pseudos d'amis. */
    friendFinds: Record<string, string[]>;
    /** État des scans par ami (vérifié le…, obsolète…). */
    friendScans: FriendZoneScanEntry[];
    /** Nombre total de caches dans la zone (pour les compteurs). */
    totalCaches: number;
    /** Amis actifs (Set de pseudos). */
    activeFriends: Set<string>;
    /** Bascule l'activation d'un ami. */
    onToggleFriend: (friend: string) => void;
    /** Active ou désactive tous les amis. */
    onToggleAllFriends?: (active: boolean) => void;
    /** Lance l'analyse sur les amis actifs × toute la zone. */
    onAnalyzeAll?: () => void;
    /** Vrai pendant une analyse streaming. */
    analyzing?: boolean;
    /** Interrompt l'analyse en cours. */
    onCancelAnalyze?: () => void;
}

// `friendColor()` vit désormais dans `friend-colors.ts` : le panneau de sortie s'en
// sert aussi, et cette barre est en cours de retrait.
export { friendColor };

export const FriendChipsBar: React.FC<FriendChipsBarProps> = props => {
    const [showAll, setShowAll] = React.useState(false);

    // Liste triée des amis connus (union de friendFinds et friendScans).
    const allNames = React.useMemo(() => {
        const names = new Set<string>();
        for (const list of Object.values(props.friendFinds)) {
            for (const name of list) { names.add(name); }
        }
        for (const scan of props.friendScans) {
            names.add(scan.friend);
        }
        return Array.from(names).sort((a, b) => a.localeCompare(b, 'fr', { sensitivity: 'base' }));
    }, [props.friendFinds, props.friendScans]);

    if (allNames.length === 0) { return null; }

    // Pour chaque ami : trouvé combien de caches dans la zone, et statut du scan.
    const friendInfo = new Map<string, {
        found: number;
        scanned: boolean;
        isStale: boolean;
    }>();
    for (const name of allNames) {
        const scan = props.friendScans.find(s => s.friend === name);
        const foundCodes = new Set<string>();
        for (const [gcCode, finders] of Object.entries(props.friendFinds)) {
            if (finders.includes(name)) { foundCodes.add(gcCode); }
        }
        friendInfo.set(name, {
            found: foundCodes.size,
            scanned: scan?.scanned ?? false,
            isStale: scan?.is_stale ?? false,
        });
    }

    // Partition : amis actifs ou scannés d'abord, les autres repliés.
    const visibleNames = allNames.filter(name => {
        const info = friendInfo.get(name)!;
        return props.activeFriends.has(name) || info.scanned;
    });
    const hiddenNames = allNames.filter(name => {
        const info = friendInfo.get(name)!;
        return !props.activeFriends.has(name) && !info.scanned;
    });

    const renderChip = (name: string) => {
        const info = friendInfo.get(name)!;
        const isActive = props.activeFriends.has(name);
        const color = friendColor(name);
        const found = info.found;
        const total = props.totalCaches;

        return (
            <button
                key={name}
                className={`geoapp-friend-chip ${isActive ? 'geoapp-friend-chip--active' : ''}`}
                onClick={() => props.onToggleFriend(name)}
                title={
                    isActive ? `Désactiver ${name}` : `Activer ${name}`
                    + (info.scanned
                        ? info.isStale
                            ? ' (scan obsolète)'
                            : ` — ${found}/${total} trouvées`
                        : ' (jamais analysé ici)')
                }
                style={{
                    // La couleur de l'ami en bordure si actif, en fond si inactif.
                    borderColor: isActive ? color : 'transparent',
                    backgroundColor: isActive ? `${color}22` : 'transparent',
                    // Bordure pointillée si scan obsolète.
                    ...(info.isStale ? { borderStyle: 'dashed' } : {}),
                }}
            >
                <span
                    className='geoapp-friend-chip__dot'
                    style={{ backgroundColor: color, opacity: isActive ? 1 : 0.4 }}
                />
                <span className='geoapp-friend-chip__name'>{name}</span>
                {info.scanned ? (
                    <span className='geoapp-friend-chip__count'>
                        {found}/{total}
                    </span>
                ) : (
                    <span className='geoapp-friend-chip__count geoapp-friend-chip__count--unknown'>
                        ?
                    </span>
                )}
            </button>
        );
    };

    return (
        <div className='geoapp-friend-chips-bar'>
            <span className='geoapp-friend-chips-bar__label'>Sortie avec :</span>
            {visibleNames.map(renderChip)}
            {!showAll && hiddenNames.length > 0 && (
                <button
                    className='geoapp-friend-chip geoapp-friend-chip--more'
                    onClick={() => setShowAll(true)}
                    title={`${hiddenNames.length} autre(s) ami(s) jamais analysés ici`}
                >
                    + {hiddenNames.length} autre{hiddenNames.length > 1 ? 's' : ''} ▾
                </button>
            )}
            {showAll && hiddenNames.map(renderChip)}
            {showAll && hiddenNames.length > 0 && (
                <button
                    className='geoapp-friend-chip geoapp-friend-chip--more'
                    onClick={() => setShowAll(false)}
                >
                    ▴ replier
                </button>
            )}
            <div style={{ flex: 1 }} />
            {props.analyzing && props.onCancelAnalyze && (
                <button
                    className='theia-button secondary geoapp-friend-chips-bar__cancel'
                    onClick={props.onCancelAnalyze}
                    title="Interrompre l'analyse"
                >
                    ✕
                </button>
            )}
            {props.onAnalyzeAll && !props.analyzing && (
                <button
                    className='theia-button secondary geoapp-friend-chips-bar__analyze'
                    onClick={props.onAnalyzeAll}
                    disabled={props.activeFriends.size === 0}
                    title={
                        props.activeFriends.size === 0
                            ? 'Activez d\'abord des amis dans la barre ci-dessus'
                            : `Analyser les ${props.activeFriends.size} ami(s) actif(s) sur toute la zone`
                    }
                >
                    {props.activeFriends.size > 0
                        ? `Analyser ${props.activeFriends.size} ami(s)`
                        : 'Analyser'}
                </button>
            )}
        </div>
    );
};
