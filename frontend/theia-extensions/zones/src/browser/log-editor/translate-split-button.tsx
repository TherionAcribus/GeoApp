/**
 * Bouton « Traduire » en deux moitiés : l'action à gauche, le choix de la langue à droite.
 *
 * Même motif que le split button « Chat IA » de `geocache-details-sections.tsx` : les deux
 * moitiés partagent le fond, un liseré interne les sépare, et la moitié droite (▾) ouvre un
 * menu radio. Le menu porte aussi l'épinglage de la langue, sur le modèle de la punaise de la
 * date : épinglée, la langue est réappliquée aux logs suivants ; dé-épinglée, on revient à la
 * langue par défaut des préférences.
 *
 * Les classes `geoapp-log-split*` sont partagées avec `improve-split-button.tsx` : les deux
 * boutons voisinent dans la même barre d'outils et doivent être indiscernables à l'œil.
 *
 * L'état d'ouverture est détenu par le widget (comme `historyDropdownOpen`) : un seul menu de
 * langue existe à la fois, le mode « texte identique » et le mode « par cache » n'affichant
 * jamais leur barre d'action en même temps.
 */

import * as React from '@theia/core/shared/react';
import { activateMenuItemOnKey, useDismissMenu } from './use-dismiss-menu';

export const TranslateSplitButton: React.FC<{
    /** Texte de la moitié principale, hors langue (« Traduire », « Traduire tous les blocs »…). */
    label: string;
    /** Langues proposées, dans l'ordre configuré en préférences. */
    languages: string[];
    logLanguage: string;
    isLogLanguagePinned: boolean;
    /** Désactive l'action principale sans empêcher le choix de la langue. */
    translateDisabled: boolean;
    /** Non vide quand la traduction est impossible : sert d'infobulle sur la moitié principale. */
    translateDisabledReason?: string;
    isTranslating: boolean;
    open: boolean;
    onToggleMenu: () => void;
    onCloseMenu: () => void;
    onSelectLanguage: (language: string) => void;
    onToggleLogLanguagePin: () => void;
    onTranslate: () => void;
}> = ({
    label, languages, logLanguage, isLogLanguagePinned,
    translateDisabled, translateDisabledReason, isTranslating,
    open, onToggleMenu, onCloseMenu, onSelectLanguage, onToggleLogLanguagePin, onTranslate,
}) => {
    const containerRef = React.useRef<HTMLDivElement>(null);
    useDismissMenu(open, containerRef, onCloseMenu);

    // La langue épinglée peut avoir été retirée des préférences depuis : on l'affiche quand même
    // en tête du menu pour ne pas la perdre silencieusement.
    const options = logLanguage !== '' && !languages.includes(logLanguage)
        ? [logLanguage, ...languages]
        : languages;

    const noLanguage = logLanguage === '';

    return (
        <div ref={containerRef} className='geoapp-log-split'>
            <div className='geoapp-log-split__group'>
                <button
                    className='geoapp-log-split__main'
                    onClick={onTranslate}
                    disabled={translateDisabled || isTranslating}
                    title={translateDisabledReason ?? `${label} en ${logLanguage} avec l'IA`}
                >
                    {isTranslating
                        ? <i className='fa fa-spinner fa-spin' aria-hidden='true' />
                        : <i className='fa fa-globe' aria-hidden='true' />}
                    <span>{isTranslating ? 'Traduction…' : label}</span>
                    <span className='geoapp-log-split__badge'>
                        {isLogLanguagePinned && (
                            <i className='fa fa-thumb-tack' aria-hidden='true' title='Langue épinglée' />
                        )}
                        {noLanguage ? '—' : logLanguage}
                    </span>
                </button>
                <button
                    className='geoapp-log-split__arrow'
                    onClick={onToggleMenu}
                    aria-haspopup='menu'
                    aria-expanded={open}
                    aria-label={`Choisir la langue de traduction (actuelle : ${noLanguage ? 'aucune' : logLanguage})`}
                    title={`Choisir la langue de traduction (actuelle : ${noLanguage ? 'aucune' : logLanguage})`}
                >
                    <i className='fa fa-caret-down' aria-hidden='true' />
                </button>
            </div>

            {open && (
                <div role='menu' aria-label='Langue de traduction' className='geoapp-log-split-menu'>
                    {options.length === 0 ? (
                        <div className='geoapp-log-split-menu__empty'>
                            Aucune langue configurée.
                            <br />
                            Préférences → Logs → Traduction.
                        </div>
                    ) : options.map(language => {
                        const isSelected = language === logLanguage;
                        return (
                            <div
                                key={language}
                                role='menuitemradio'
                                aria-checked={isSelected}
                                tabIndex={0}
                                className={isSelected
                                    ? 'geoapp-log-split-menu__item geoapp-log-split-menu__item--selected'
                                    : 'geoapp-log-split-menu__item'}
                                onClick={() => onSelectLanguage(language)}
                                onKeyDown={e => activateMenuItemOnKey(e, () => onSelectLanguage(language))}
                                title={`Traduire en ${language}`}
                            >
                                <i
                                    className={isSelected ? 'fa fa-dot-circle-o' : 'fa fa-circle-o'}
                                    aria-hidden='true'
                                />
                                <span>{language}</span>
                            </div>
                        );
                    })}

                    <div className='geoapp-log-split-menu__separator' />

                    <div
                        role='menuitemcheckbox'
                        aria-checked={isLogLanguagePinned}
                        tabIndex={0}
                        className={isLogLanguagePinned
                            ? 'geoapp-log-split-menu__item geoapp-log-split-menu__item--pinned'
                            : 'geoapp-log-split-menu__item'}
                        onClick={onToggleLogLanguagePin}
                        onKeyDown={e => activateMenuItemOnKey(e, onToggleLogLanguagePin)}
                        title={isLogLanguagePinned
                            ? 'Langue épinglée : elle sera réutilisée pour les prochains logs. Cliquer pour revenir à la langue par défaut.'
                            : 'Épingler la langue pour la réutiliser lors des prochains logs'}
                    >
                        <i
                            className={isLogLanguagePinned ? 'fa fa-thumb-tack' : 'fa fa-thumb-tack fa-rotate-90'}
                            aria-hidden='true'
                        />
                        <span>{isLogLanguagePinned ? 'Langue épinglée' : 'Épingler la langue'}</span>
                    </div>
                </div>
            )}
        </div>
    );
};
