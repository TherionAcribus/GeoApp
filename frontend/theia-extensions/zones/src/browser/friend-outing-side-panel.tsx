import * as React from 'react';
import type { Geocache } from './geocaches-table';
import type { FriendFindsProgress, FriendZoneScanEntry, GeocachingFriend } from './friends-types';
import type { FriendAnalysisSummary, FriendFilter, FriendOuting } from './friend-outing-state';
import { friendOfFilter, missingForFriendFilter } from './friend-outing-state';
import { friendColor } from './friend-colors';
import { ZoneFriendAnalysisPanel } from './zone-friend-analysis-panel';
import '../../src/browser/style/friend-outing-panel.css';

/**
 * Panneau latéral du mode « sortie entre amis ».
 *
 * Préparer une sortie, c'est répondre à trois questions dans l'ordre : avec qui,
 * sur quelles caches, et qui a déjà fait quoi. Ces trois réponses vivaient dans
 * trois endroits distincts — une barre de puces au-dessus du tableau, une
 * sélection de lignes dont on ne savait pas si elle définissait le périmètre, et
 * un panneau de résultat intercalé qui poussait le tableau vers le bas. Le
 * panneau les rassemble à droite du tableau, où elles restent visibles pendant
 * qu'on travaille dans la liste.
 *
 * Il n'est rendu qu'en mode sortie et ne détient aucun état métier : la sortie
 * appartient au widget, qui la persiste. Le seul état local est l'aspect —
 * replié ou non, le texte de recherche.
 *
 * Le lien entre le tableau et la sortie est explicite : c'est la section
 * « Caches » qui décide ce que la sélection courante devient (le périmètre, un
 * ajout, un retrait). Cocher une ligne ne change plus rien tant qu'on ne l'a pas
 * dit ici.
 */

export interface FriendOutingSidePanelProps {
    /** La sortie en cours (source de vérité du widget). */
    outing: FriendOuting;
    /** Caches de la zone affichée. */
    rows: Geocache[];

    /** Liste complète des amis du compte (vide si non chargée / non connecté). */
    accountFriends: GeocachingFriend[];
    /** Vrai pendant le chargement de la liste d'amis. */
    friendsLoading?: boolean;
    /** Message d'erreur du chargement de la liste (null si tout va bien). */
    friendsError?: string | null;
    /** Relance le chargement de la liste d'amis. */
    onReloadFriends?: () => void;

    /** Amis cochés (= `outing.friends`, en Set pour les tests d'appartenance). */
    activeFriends: Set<string>;
    /** Coche / décoche un ami. */
    onToggleFriend: (friend: string) => void;
    /** Remplace la liste des amis cochés (boutons « Tout » / « Rien »). */
    onSetFriends: (friends: string[]) => void;

    /** « Qui a trouvé quoi » : code GC -> pseudos d'amis. */
    friendFinds: Record<string, string[]>;
    /** État des scans par ami sur la zone. */
    friendScans: FriendZoneScanEntry[];

    /** Sélection courante du tableau (IDs de géocaches). */
    selectedGeocacheIds: number[];
    /** Le périmètre devient la sélection courante. */
    onReplaceCachesWithSelection: () => void;
    /** La sélection courante s'ajoute au périmètre. */
    onAddSelectionToCaches: () => void;
    /** La sélection courante sort du périmètre. */
    onRemoveSelectionFromCaches: () => void;
    /** Le périmètre redevient « toute la zone ». */
    onResetCachesToZone: () => void;

    /** Lance l'analyse (amis cochés × périmètre). */
    onAnalyze: () => void;
    /** Progression de l'analyse en cours (null = inactive). */
    progress: FriendFindsProgress | null;
    /** Interrompt l'analyse en cours. */
    onCancelAnalyze: () => void;
    /** Compte rendu de la dernière analyse terminée. */
    lastAnalysisSummary: FriendAnalysisSummary | null;

    /** Filtre de table du mode sortie. */
    friendFilter: FriendFilter;
    /** Change le filtre de table. */
    onFriendFilterChange: (filter: FriendFilter) => void;

    /** Ouvre une géocache (clic dans la matrice de résultats). */
    onOpenGeocache?: (geocache: Geocache) => void;
    /** Termine la sortie. */
    onExit: () => void;
}

/** État d'un ami vis-à-vis du périmètre, tel qu'affiché dans la liste. */
interface FriendRow {
    name: string;
    avatarUrl: string | null;
    /** Trouvailles connues dans le périmètre. */
    found: number;
    /** Analysé au moins une fois sur cette zone. */
    scanned: boolean;
    /** Analysé, mais la zone a bougé depuis. */
    isStale: boolean;
    scannedAt: string | null;
    /** Présent dans la liste d'amis du compte (sinon : connu des seules données locales). */
    fromAccount: boolean;
}

export const FriendOutingSidePanel: React.FC<FriendOutingSidePanelProps> = props => {
    const [collapsed, setCollapsed] = React.useState(false);
    const [search, setSearch] = React.useState('');

    // Le périmètre : les lignes de la zone retenues pour la sortie. Un périmètre
    // vide veut dire « toute la zone » — c'est aussi ce que comprend le backend.
    // Un périmètre dont plus aucune cache n'existe (caches supprimées depuis)
    // retombe lui aussi sur la zone entière, comme `outingScopeGcCodes()` : le
    // panneau doit annoncer ce que l'analyse fera réellement.
    const scopeRows = React.useMemo(() => {
        if (props.outing.gcCodes.length === 0) {
            return props.rows;
        }
        const wanted = new Set(props.outing.gcCodes);
        const kept = props.rows.filter(row => wanted.has(row.gc_code));
        return kept.length > 0 ? kept : props.rows;
    }, [props.rows, props.outing.gcCodes]);

    // Un ami est listé s'il est connu du compte, des données locales de la zone,
    // ou déjà emmené : une sortie restaurée alors que la liste d'amis n'est pas
    // encore chargée doit continuer d'afficher ses amis, cochés.
    const friendRows = React.useMemo<FriendRow[]>(() => {
        const accounts = new Map<string, GeocachingFriend>();
        for (const friend of props.accountFriends) {
            accounts.set(friend.username, friend);
        }
        const names = new Set<string>(accounts.keys());
        for (const list of Object.values(props.friendFinds)) {
            for (const name of list) { names.add(name); }
        }
        for (const scan of props.friendScans) { names.add(scan.friend); }
        for (const name of props.outing.friends) { names.add(name); }

        // Trouvailles dans le périmètre, comptées en une passe sur les lignes
        // retenues : `friendFinds` couvre toute la zone.
        const foundInScope = new Map<string, number>();
        for (const row of scopeRows) {
            for (const finder of props.friendFinds[row.gc_code] ?? []) {
                foundInScope.set(finder, (foundInScope.get(finder) ?? 0) + 1);
            }
        }

        return Array.from(names)
            .map<FriendRow>(name => {
                const scan = props.friendScans.find(entry => entry.friend === name);
                const account = accounts.get(name);
                return {
                    name,
                    avatarUrl: account?.avatar_url ?? null,
                    found: foundInScope.get(name) ?? 0,
                    scanned: scan?.scanned ?? false,
                    isStale: scan?.is_stale ?? false,
                    scannedAt: scan?.scanned_at ?? null,
                    fromAccount: account !== undefined,
                };
            })
            .sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }));
    }, [props.accountFriends, props.friendFinds, props.friendScans, props.outing.friends, scopeRows]);

    // « Toute la zone » est un fait, pas un champ : un périmètre qui contient
    // déjà toutes les caches vaut la zone entière, et c'est exactement ce que
    // `outingScopeGcCodes()` transmet au backend.
    const wholeZone = scopeRows.length === props.rows.length;
    // …mais la liste de codes existe quand même : le bouton de retour à la zone
    // entière a alors encore quelque chose à effacer.
    const explicitScope = props.outing.gcCodes.length > 0;

    const needle = search.trim().toLowerCase();
    const visibleRows = needle
        ? friendRows.filter(row => row.name.toLowerCase().includes(needle))
        : friendRows;

    // Replié : une bande verticale qui garde le mode visible et récupérable d'un
    // clic, sans manger la largeur du tableau.
    if (collapsed) {
        return (
            <div className='geoapp-outing-panel geoapp-outing-panel--collapsed'>
                <button
                    className='geoapp-outing-panel__icon-button'
                    onClick={() => setCollapsed(false)}
                    title='Déplier le panneau de sortie'
                >
                    <span className='codicon codicon-chevron-left' />
                </button>
                <div className='geoapp-outing-panel__spine'>
                    👥 Sortie · {props.activeFriends.size} ami(s) · {scopeRows.length} cache(s)
                </div>
            </div>
        );
    }

    return (
        <div className='geoapp-outing-panel'>
            <div className='geoapp-outing-panel__header'>
                <span className='geoapp-outing-panel__title'>👥 Sortie entre amis</span>
                <button
                    className='geoapp-outing-panel__icon-button'
                    onClick={() => setCollapsed(true)}
                    title='Replier le panneau'
                >
                    <span className='codicon codicon-chevron-right' />
                </button>
                <button
                    className='geoapp-outing-panel__icon-button'
                    onClick={props.onExit}
                    title='Quitter le mode sortie (la sortie enregistrée est supprimée)'
                >
                    <span className='codicon codicon-close' />
                </button>
            </div>

            <div className='geoapp-outing-panel__body'>
                <FriendsSection
                    rows={visibleRows}
                    totalCount={friendRows.length}
                    allNames={friendRows.map(row => row.name)}
                    scopeSize={scopeRows.length}
                    wholeZone={wholeZone}
                    activeFriends={props.activeFriends}
                    search={search}
                    onSearchChange={setSearch}
                    onToggleFriend={props.onToggleFriend}
                    onSetFriends={props.onSetFriends}
                    loading={props.friendsLoading}
                    error={props.friendsError ?? null}
                    onReload={props.onReloadFriends}
                />

                <CachesSection
                    scopeSize={scopeRows.length}
                    zoneSize={props.rows.length}
                    wholeZone={wholeZone}
                    explicitScope={explicitScope}
                    selectionSize={props.selectedGeocacheIds.length}
                    onReplace={props.onReplaceCachesWithSelection}
                    onAdd={props.onAddSelectionToCaches}
                    onRemove={props.onRemoveSelectionFromCaches}
                    onResetToZone={props.onResetCachesToZone}
                />

                <AnalysisSection
                    friendCount={props.activeFriends.size}
                    scopeSize={scopeRows.length}
                    wholeZone={wholeZone}
                    progress={props.progress}
                    summary={props.lastAnalysisSummary}
                    onAnalyze={props.onAnalyze}
                    onCancel={props.onCancelAnalyze}
                />

                <section className='geoapp-outing-panel__section'>
                    <h4 className='geoapp-outing-panel__section-title'>Résultats</h4>
                    <ZoneFriendAnalysisPanel
                        compact
                        rows={scopeRows}
                        friendFinds={props.friendFinds}
                        friendScans={props.friendScans}
                        /* Restreint aux amis cochés : le panneau répond pour la
                           sortie qu'on prépare, pas pour tous les amis connus.
                           `outing.friends` plutôt que le Set : déjà trié, et son
                           identité ne change qu'avec la sortie — les mémos du
                           panneau de résultat ne se réinvalident pas à chaque
                           rendu. */
                        friendNames={props.outing.friends.length > 0
                            ? props.outing.friends
                            : undefined}
                        missingForFriend={friendOfFilter(props.friendFilter)}
                        onMissingForFriendChange={friend =>
                            props.onFriendFilterChange(missingForFriendFilter(friend))}
                        onOpenGeocache={props.onOpenGeocache}
                    />
                </section>
            </div>
        </div>
    );
};

// -------------------------------------------------- Section « Amis »

const FriendsSection: React.FC<{
    rows: FriendRow[];
    totalCount: number;
    allNames: string[];
    scopeSize: number;
    wholeZone: boolean;
    activeFriends: Set<string>;
    search: string;
    onSearchChange: (value: string) => void;
    onToggleFriend: (friend: string) => void;
    onSetFriends: (friends: string[]) => void;
    loading?: boolean;
    error: string | null;
    onReload?: () => void;
}> = props => (
    <section className='geoapp-outing-panel__section'>
        <h4 className='geoapp-outing-panel__section-title'>
            Amis
            <span className='geoapp-outing-panel__section-count'>
                {props.activeFriends.size}/{props.totalCount}
            </span>
        </h4>

        <div className='geoapp-outing-panel__row'>
            <input
                className='theia-input geoapp-outing-panel__search'
                type='search'
                placeholder='Rechercher…'
                value={props.search}
                onChange={event => props.onSearchChange(event.target.value)}
            />
            <button
                className='theia-button secondary geoapp-outing-panel__mini-button'
                onClick={() => props.onSetFriends(props.allNames)}
                disabled={props.allNames.length === 0}
                title='Emmener tous les amis'
            >
                Tout
            </button>
            <button
                className='theia-button secondary geoapp-outing-panel__mini-button'
                onClick={() => props.onSetFriends([])}
                disabled={props.activeFriends.size === 0}
                title="N'emmener aucun ami"
            >
                Rien
            </button>
        </div>

        {props.error && (
            <div className='geoapp-outing-panel__notice geoapp-outing-panel__notice--warn'>
                <span>{props.error}</span>
                {props.onReload && (
                    <button
                        className='theia-button secondary geoapp-outing-panel__mini-button'
                        onClick={props.onReload}
                        title="Recharger la liste des amis"
                    >
                        Réessayer
                    </button>
                )}
            </div>
        )}

        {props.loading && props.rows.length === 0 && (
            <div className='geoapp-outing-panel__notice'>
                <span className='codicon codicon-loading codicon-spin' /> Chargement de la liste…
            </div>
        )}

        {!props.loading && props.rows.length === 0 && (
            <div className='geoapp-outing-panel__notice'>
                {props.totalCount === 0 ? 'Aucun ami connu.' : 'Aucun ami ne correspond.'}
            </div>
        )}

        <ul className='geoapp-outing-panel__friends'>
            {props.rows.map(row => (
                <FriendItem
                    key={row.name}
                    row={row}
                    scopeSize={props.scopeSize}
                    wholeZone={props.wholeZone}
                    active={props.activeFriends.has(row.name)}
                    onToggle={() => props.onToggleFriend(row.name)}
                />
            ))}
        </ul>
    </section>
);

const FriendItem: React.FC<{
    row: FriendRow;
    scopeSize: number;
    wholeZone: boolean;
    active: boolean;
    onToggle: () => void;
}> = ({ row, scopeSize, wholeZone, active, onToggle }) => {
    const color = friendColor(row.name);
    const scannedOn = row.scannedAt ? ` le ${new Date(row.scannedAt).toLocaleDateString('fr-FR')}` : '';
    // « Analysé » vient de l'état de scan de la **zone** : le backend ne suit pas
    // la fraîcheur périmètre par périmètre. Sur un sous-ensemble, c'est donc une
    // approximation — le titre le dit, plutôt que de laisser croire à une garantie.
    const status = !row.scanned
        ? { label: 'jamais', className: 'geoapp-outing-panel__status--never' }
        : row.isStale
            ? { label: 'obsolète', className: 'geoapp-outing-panel__status--stale' }
            : { label: 'analysé', className: 'geoapp-outing-panel__status--fresh' };
    const statusTitle = !row.scanned
        ? `${row.name} n'a jamais été analysé sur cette zone.`
        : row.isStale
            ? `Analyse obsolète : la zone a changé depuis${scannedOn}.`
            : `Analysé sur la zone${scannedOn}`
                + (wholeZone ? '' : " — l'état de fraîcheur est celui de la zone, pas du périmètre.");

    return (
        <li className={`geoapp-outing-panel__friend${active ? ' geoapp-outing-panel__friend--active' : ''}`}>
            <label className='geoapp-outing-panel__friend-label'>
                <input
                    type='checkbox'
                    checked={active}
                    onChange={onToggle}
                    title={active ? `Retirer ${row.name} de la sortie` : `Emmener ${row.name}`}
                />
                {row.avatarUrl ? (
                    <img
                        className='geoapp-outing-panel__avatar'
                        src={row.avatarUrl}
                        alt=''
                        style={{ borderColor: color }}
                    />
                ) : (
                    <span
                        className='geoapp-outing-panel__avatar geoapp-outing-panel__avatar--fallback'
                        style={{ backgroundColor: color }}
                    >
                        {row.name.charAt(0).toUpperCase()}
                    </span>
                )}
                <span className='geoapp-outing-panel__friend-text'>
                    <span className='geoapp-outing-panel__friend-name' title={row.name}>
                        {row.name}
                        {!row.fromAccount && (
                            <span
                                className='geoapp-outing-panel__friend-tag'
                                title="Connu par les analyses de cette zone, absent de votre liste d'amis."
                            >
                                ?
                            </span>
                        )}
                    </span>
                    <span className='geoapp-outing-panel__friend-meta'>
                        <span className={`geoapp-outing-panel__status ${status.className}`} title={statusTitle}>
                            {status.label}
                        </span>
                        {row.scanned && (
                            <span
                                className='geoapp-outing-panel__friend-count'
                                title={`${row.found} trouvée(s) sur les ${scopeSize} cache(s) ${wholeZone ? 'de la zone' : 'de la sortie'}`}
                            >
                                {row.found}/{scopeSize}
                            </span>
                        )}
                    </span>
                </span>
            </label>
        </li>
    );
};

// -------------------------------------------------- Section « Caches »

const CachesSection: React.FC<{
    scopeSize: number;
    zoneSize: number;
    wholeZone: boolean;
    explicitScope: boolean;
    selectionSize: number;
    onReplace: () => void;
    onAdd: () => void;
    onRemove: () => void;
    onResetToZone: () => void;
}> = props => {
    const noSelection = props.selectionSize === 0;
    const selectionHint = "Cochez d'abord des lignes dans le tableau.";
    return (
        <section className='geoapp-outing-panel__section'>
            <h4 className='geoapp-outing-panel__section-title'>
                Caches
                <span className='geoapp-outing-panel__section-count'>{props.scopeSize}</span>
            </h4>

            <div className='geoapp-outing-panel__notice'>
                {props.wholeZone
                    ? `Toute la zone — ${props.zoneSize} cache(s)`
                    : `${props.scopeSize} cache(s) dans la sortie`}
            </div>

            <button
                className='theia-button secondary geoapp-outing-panel__wide-button'
                onClick={props.onReplace}
                disabled={noSelection}
                title={noSelection
                    ? selectionHint
                    : `Le périmètre devient les ${props.selectionSize} cache(s) sélectionnée(s)`}
            >
                Remplacer par la sélection ({props.selectionSize})
            </button>
            <div className='geoapp-outing-panel__row'>
                <button
                    className='theia-button secondary geoapp-outing-panel__mini-button'
                    onClick={props.onAdd}
                    /* Ajouter à « toute la zone » ne changerait rien : un périmètre
                       vide contient déjà toutes les caches. */
                    disabled={noSelection || props.wholeZone}
                    title={props.wholeZone
                        ? 'Le périmètre est déjà toute la zone.'
                        : noSelection ? selectionHint : 'Ajouter la sélection au périmètre'}
                >
                    Ajouter
                </button>
                <button
                    className='theia-button secondary geoapp-outing-panel__mini-button'
                    onClick={props.onRemove}
                    disabled={noSelection}
                    title={noSelection ? selectionHint : 'Retirer la sélection du périmètre'}
                >
                    Retirer
                </button>
                <button
                    className='theia-button secondary geoapp-outing-panel__mini-button'
                    onClick={props.onResetToZone}
                    disabled={!props.explicitScope}
                    title='Reprendre toute la zone comme périmètre'
                >
                    Toute la zone
                </button>
            </div>
        </section>
    );
};

// -------------------------------------------------- Section « Analyse »

const AnalysisSection: React.FC<{
    friendCount: number;
    scopeSize: number;
    wholeZone: boolean;
    progress: FriendFindsProgress | null;
    summary: FriendAnalysisSummary | null;
    onAnalyze: () => void;
    onCancel: () => void;
}> = props => (
    <section className='geoapp-outing-panel__section'>
        <h4 className='geoapp-outing-panel__section-title'>Analyse</h4>

        {props.progress ? (
            <>
                <div className='geoapp-outing-panel__row'>
                    <span className='codicon codicon-loading codicon-spin' />
                    <span className='geoapp-outing-panel__progress-label'>
                        {props.progress.done}/{props.progress.total}
                        {props.progress.friend && ` · ${props.progress.friend}`}
                    </span>
                    <button
                        className='theia-button secondary geoapp-outing-panel__mini-button'
                        onClick={props.onCancel}
                        title="Interrompre l'analyse"
                    >
                        Interrompre
                    </button>
                </div>
                {props.progress.total > 0 && (
                    <div className='geoapp-outing-panel__bar'>
                        <div
                            className='geoapp-outing-panel__bar-fill'
                            style={{ width: `${Math.round(100 * props.progress.done / props.progress.total)}%` }}
                        />
                    </div>
                )}
            </>
        ) : (
            <button
                className='theia-button geoapp-outing-panel__wide-button'
                onClick={props.onAnalyze}
                disabled={props.friendCount === 0 || props.scopeSize === 0}
                title={props.friendCount === 0
                    ? 'Cochez au moins un ami.'
                    : `Analyser ${props.friendCount} ami(s) sur ${props.scopeSize} cache(s)`
                        + (props.wholeZone ? ' (toute la zone)' : '')}
            >
                Analyser {props.friendCount} ami(s) × {props.scopeSize} cache(s)
            </button>
        )}

        {props.summary && !props.progress && (
            <div
                className='geoapp-outing-panel__notice'
                title={new Date(props.summary.at).toLocaleString('fr-FR')}
            >
                <span className={`codicon ${props.summary.cancelled ? 'codicon-debug-stop' : 'codicon-check'}`} />
                <span>
                    {props.summary.cancelled
                        ? `Interrompue après ${props.summary.scanned} ami(s)`
                        : `${props.summary.scanned} ami(s) analysé(s)`}
                    {props.summary.skipped > 0 && ` (${props.summary.skipped} skip)`}
                    {' — '}
                    <strong>{props.summary.withFriends}</strong> cache(s) trouvée(s)
                    {props.summary.rateLimited && (
                        <span className='geoapp-outing-panel__status--stale'> · throttling</span>
                    )}
                </span>
            </div>
        )}
    </section>
);
