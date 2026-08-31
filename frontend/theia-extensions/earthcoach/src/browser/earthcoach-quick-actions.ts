import type { QuickPickValue, QuickPickSeparator } from '@theia/core/lib/common/quick-pick-service';
import { EarthCoachQuickAction } from './earthcoach-types';

// Icone prefixant chaque action pour signaler son comportement:
// - chat: l'action envoie une requete a l'agent @EarthCoach dans le chat.
// - panneau: l'action ouvre directement un widget lateral, sans requete LLM.
export const CHAT_ICON = '$(comment-discussion)';
export const PANEL_ICON = '$(layout-sidebar-right)';

export interface EarthCoachQuickActionGroup {
    label: string;
    actions: Array<QuickPickValue<EarthCoachQuickAction>>;
}

export const QUICK_ACTION_GROUPS: EarthCoachQuickActionGroup[] = [
    {
        label: 'Comprendre',
        actions: [
            {
                label: `${CHAT_ICON} Comprendre cette EarthCache`,
                description: 'Notions, contexte geologique et questions a clarifier',
                value: 'understand',
            },
            {
                label: `${CHAT_ICON} Expliquer un mot`,
                description: 'Definition simple d un terme geologique',
                value: 'explain_word',
            },
            {
                label: `${CHAT_ICON} Contexte geologique`,
                description: 'Lithologie, age et formation aux coordonnees (Macrostrat)',
                value: 'geology_context',
            },
        ],
    },
    {
        label: 'Preparer le terrain',
        actions: [
            {
                label: `${CHAT_ICON} Preparer ma visite`,
                description: 'Checklist terrain et observations a relever',
                value: 'prepare_visit',
            },
            {
                label: `${PANEL_ICON} Mode terrain compact`,
                description: 'Checklist imprimable/mobile sans attendre le chat',
                value: 'field_checklist',
            },
            {
                label: `${PANEL_ICON} Observations terrain`,
                description: 'Creer, editer et lier des photos aux observations structurees',
                value: 'observations',
            },
        ],
    },
    {
        label: 'Images & references',
        actions: [
            {
                label: `${PANEL_ICON} Galerie images EarthCoach`,
                description: 'Separe listing, photos utilisateur et references pedagogiques',
                value: 'image_gallery',
            },
            {
                label: `${PANEL_ICON} Illustrer un terme`,
                description: 'Images et references pedagogiques externes',
                value: 'illustrate_term',
            },
        ],
    },
    {
        label: 'Analyser & resoudre',
        actions: [
            {
                label: `${PANEL_ICON} Questions du proprietaire`,
                description: 'Suivre, editer et extraire les logging tasks de la cache',
                value: 'logging_tasks',
            },
            {
                label: `${CHAT_ICON} Analyser mes observations`,
                description: 'Tri observation / interpretation / hypothese',
                value: 'analyze_observations',
            },
            {
                label: `${CHAT_ICON} Resoudre avec mes observations`,
                description: 'Mode resolver explicite, sans inventer le terrain',
                value: 'resolve',
            },
        ],
    },
];

export function buildQuickActionPicks(): Array<QuickPickValue<EarthCoachQuickAction> | QuickPickSeparator> {
    const picks: Array<QuickPickValue<EarthCoachQuickAction> | QuickPickSeparator> = [];
    for (const group of QUICK_ACTION_GROUPS) {
        picks.push({ type: 'separator', label: group.label });
        picks.push(...group.actions);
    }
    return picks;
}

// Le placeHolder du QuickPick est pose sur l'attribut `placeholder` d'un input DOM:
// les codicons n'y sont pas rendus (ils s'afficheraient tels quels) et des emojis de
// substitution ne ressembleraient a aucune icone de la liste. La legende nomme donc
// les deux familles d'icones en toutes lettres.
export function buildQuickActionPlaceHolder(): string {
    return 'Choisir une aide (icone bulle = reponse dans le chat, icone panneau = ouvre un panneau lateral)';
}
