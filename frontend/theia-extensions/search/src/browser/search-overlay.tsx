/**
 * Composant React de l'overlay de recherche GeoApp.
 * 
 * Barre flottante positionnée en haut à droite du widget actif,
 * avec champ de saisie, toggles (regex/case/wildcard),
 * compteur d'occurrences et navigation prev/next.
 */

import * as React from '@theia/core/shared/react';
import { SearchOptions, SearchMatch } from '../common/search-protocol';

export interface SearchOverlayProps {
    /** Terme de recherche initial */
    initialQuery: string;
    /** Options de recherche initiales */
    initialOptions: SearchOptions;
    /** Matches trouvés */
    matches: SearchMatch[];
    /** Index du match actif */
    activeMatchIndex: number;
    /** Erreur de regex (si invalide) */
    regexError: string | null;

    /** Callback quand la query change */
    onQueryChange: (query: string) => void;
    /** Callback quand les options changent */
    onOptionsChange: (options: SearchOptions) => void;
    /** Callback pour aller au match suivant */
    onNextMatch: () => void;
    /** Callback pour aller au match précédent */
    onPreviousMatch: () => void;
    /** Callback pour fermer l'overlay */
    onClose: () => void;
}

export const SearchOverlay: React.FC<SearchOverlayProps> = ({
    initialQuery,
    initialOptions,
    matches,
    activeMatchIndex,
    regexError,
    onQueryChange,
    onOptionsChange,
    onNextMatch,
    onPreviousMatch,
    onClose
}) => {
    const [query, setQuery] = React.useState(initialQuery);
    const [options, setOptions] = React.useState<SearchOptions>(initialOptions);
    const inputRef = React.useRef<HTMLInputElement>(null);

    // Focus l'input à l'ouverture
    React.useEffect(() => {
        if (inputRef.current) {
            inputRef.current.focus();
            inputRef.current.select();
        }
    }, []);

    // Synchroniser si initialQuery change de l'extérieur
    React.useEffect(() => {
        setQuery(initialQuery);
    }, [initialQuery]);

    React.useEffect(() => {
        setOptions(initialOptions);
    }, [initialOptions]);

    const handleQueryChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const newQuery = e.target.value;
        setQuery(newQuery);
        onQueryChange(newQuery);
    };

    const toggleOption = (key: keyof SearchOptions) => {
        const newOptions = { ...options };

        if (key === 'useRegex' && !options.useRegex) {
            // Activer regex désactive wildcard
            newOptions.useRegex = true;
            newOptions.useWildcard = false;
        } else if (key === 'useWildcard' && !options.useWildcard) {
            // Activer wildcard désactive regex
            newOptions.useWildcard = true;
            newOptions.useRegex = false;
        } else {
            newOptions[key] = !newOptions[key];
        }

        setOptions(newOptions);
        onOptionsChange(newOptions);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            onClose();
        } else if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            onNextMatch();
        } else if (e.key === 'Enter' && e.shiftKey) {
            e.preventDefault();
            onPreviousMatch();
        } else if (e.key === 'F3' && !e.shiftKey) {
            e.preventDefault();
            onNextMatch();
        } else if (e.key === 'F3' && e.shiftKey) {
            e.preventDefault();
            onPreviousMatch();
        } else if (e.altKey && e.key === 'r') {
            e.preventDefault();
            toggleOption('useRegex');
        } else if (e.altKey && e.key === 'c') {
            e.preventDefault();
            toggleOption('caseSensitive');
        } else if (e.altKey && e.key === 'w') {
            e.preventDefault();
            toggleOption('useWildcard');
        }
    };

    const matchCount = matches.length;
    const hasQuery = query.length > 0;
    const hasResults = matchCount > 0;
    const displayIndex = hasResults ? activeMatchIndex + 1 : 0;

    // Formater le compteur
    let countText: string;
    if (!hasQuery) {
        countText = '';
    } else if (hasResults) {
        countText = `${displayIndex}/${matchCount}`;
    } else {
        countText = '0/0';
    }

    const inputClassName = [
        'geoapp-search-input',
        regexError ? 'invalid' : '',
        hasQuery && !hasResults && !regexError ? 'no-results' : ''
    ].filter(Boolean).join(' ');

    const countClassName = [
        'geoapp-search-count',
        hasQuery && !hasResults ? 'no-results' : ''
    ].filter(Boolean).join(' ');

    return (
        <div className='geoapp-search-overlay' onKeyDown={handleKeyDown}>
            {/* Champ de saisie */}
            <input
                ref={inputRef}
                type='text'
                className={inputClassName}
                value={query}
                onChange={handleQueryChange}
                placeholder='Rechercher...'
                title={regexError || 'Rechercher dans la page (Enter: suivant, Shift+Enter: précédent)'}
                spellCheck={false}
                autoComplete='off'
            />

            {/* Toggles */}
            <button
                className={`geoapp-search-toggle ${options.caseSensitive ? 'active' : ''}`}
                onClick={() => toggleOption('caseSensitive')}
                title='Respecter la casse (Alt+C)'
            >
                Aa
            </button>
            <button
                className={`geoapp-search-toggle ${options.useWildcard ? 'active' : ''}`}
                onClick={() => toggleOption('useWildcard')}
                title='Jokers : * = tout, ? = un caractère (Alt+W)'
            >
                *?
            </button>
            <button
                className={`geoapp-search-toggle ${options.useRegex ? 'active' : ''}`}
                onClick={() => toggleOption('useRegex')}
                title='Expression régulière (Alt+R)'
            >
                .*
            </button>

            <div className='geoapp-search-separator' />

            {/* Compteur */}
            {hasQuery && (
                <span className={countClassName}>{countText}</span>
            )}

            {/* Navigation */}
            <button
                className='geoapp-search-nav'
                onClick={onPreviousMatch}
                disabled={!hasResults}
                title='Occurrence précédente (Shift+F3)'
            >
                &#9650;
            </button>
            <button
                className='geoapp-search-nav'
                onClick={onNextMatch}
                disabled={!hasResults}
                title='Occurrence suivante (F3)'
            >
                &#9660;
            </button>

            <div className='geoapp-search-separator' />

            {/* Fermer */}
            <button
                className='geoapp-search-close'
                onClick={onClose}
                title='Fermer (Escape)'
            >
                &#10005;
            </button>
        </div>
    );
};
