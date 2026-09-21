/**
 * Bouton « Corriger » en deux moitiés : l'action à gauche, le choix du mode à droite.
 *
 * Jumeau visuel de `translate-split-button.tsx`, dont il partage les classes `geoapp-log-split*` :
 * les deux boutons se suivent dans la même barre d'outils, et rien ne justifierait qu'ils
 * n'aient pas exactement la même allure.
 *
 * Le mode est un choix durable — on corrige ses fautes ou on fait rédiger ses notes, rarement
 * l'un puis l'autre — d'où le menu radio plutôt que deux boutons côte à côte, qui prendraient
 * la place et laisseraient croire à deux fonctions sans rapport.
 */

import * as React from '@theia/core/shared/react';
import { LOG_IMPROVEMENT_MODES, LogImprovementMode, getLogImprovementMode } from './log-improver';
import { activateMenuItemOnKey, useDismissMenu } from './use-dismiss-menu';

export const ImproveSplitButton: React.FC<{
    /** Texte de la moitié principale (« Corriger », « Corriger tous les blocs »…). */
    label: string;
    mode: LogImprovementMode;
    /** Désactive l'action principale sans empêcher le choix du mode. */
    improveDisabled: boolean;
    /** Non vide quand la correction est impossible : sert d'infobulle sur la moitié principale. */
    improveDisabledReason?: string;
    isImproving: boolean;
    open: boolean;
    onToggleMenu: () => void;
    onCloseMenu: () => void;
    onSelectMode: (mode: LogImprovementMode) => void;
    onImprove: () => void;
}> = ({
    label, mode, improveDisabled, improveDisabledReason, isImproving,
    open, onToggleMenu, onCloseMenu, onSelectMode, onImprove,
}) => {
    const containerRef = React.useRef<HTMLDivElement>(null);
    useDismissMenu(open, containerRef, onCloseMenu);

    const current = getLogImprovementMode(mode);

    return (
        <div ref={containerRef} className='geoapp-log-split'>
            <div className='geoapp-log-split__group'>
                <button
                    className='geoapp-log-split__main'
                    onClick={onImprove}
                    disabled={improveDisabled || isImproving}
                    title={improveDisabledReason ?? `${label} avec l'IA — ${current.description}`}
                >
                    {isImproving
                        ? <i className='fa fa-spinner fa-spin' aria-hidden='true' />
                        : <i className='fa fa-magic' aria-hidden='true' />}
                    <span>{isImproving ? 'Correction…' : label}</span>
                    <span className='geoapp-log-split__badge'>{current.badge}</span>
                </button>
                <button
                    className='geoapp-log-split__arrow'
                    onClick={onToggleMenu}
                    aria-haspopup='menu'
                    aria-expanded={open}
                    aria-label={`Choisir ce que l'IA fait au texte (actuel : ${current.label})`}
                    title={`Choisir ce que l'IA fait au texte (actuel : ${current.label})`}
                >
                    <i className='fa fa-caret-down' aria-hidden='true' />
                </button>
            </div>

            {open && (
                <div role='menu' aria-label='Action de correction' className='geoapp-log-split-menu'>
                    {LOG_IMPROVEMENT_MODES.map(option => {
                        const isSelected = option.id === mode;
                        return (
                            <div
                                key={option.id}
                                role='menuitemradio'
                                aria-checked={isSelected}
                                tabIndex={0}
                                className={isSelected
                                    ? 'geoapp-log-split-menu__item geoapp-log-split-menu__item--stacked geoapp-log-split-menu__item--selected'
                                    : 'geoapp-log-split-menu__item geoapp-log-split-menu__item--stacked'}
                                onClick={() => onSelectMode(option.id)}
                                onKeyDown={e => activateMenuItemOnKey(e, () => onSelectMode(option.id))}
                                title={option.description}
                            >
                                <i
                                    className={isSelected ? 'fa fa-dot-circle-o' : 'fa fa-circle-o'}
                                    aria-hidden='true'
                                />
                                <span className='geoapp-log-split-menu__item-text'>
                                    <span>{option.label}</span>
                                    {/* La différence entre les deux modes ne tient pas dans leur
                                        libellé : sans cette ligne, « Rédiger » se choisit à l'aveugle. */}
                                    <span className='geoapp-log-split-menu__item-hint'>{option.description}</span>
                                </span>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};
