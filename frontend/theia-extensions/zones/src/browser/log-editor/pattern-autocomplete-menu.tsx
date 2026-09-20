/**
 * Menu d'autocomplétion des @patterns.
 *
 * Le même menu sert à l'éditeur global et aux blocs par cache : il était écrit
 * deux fois à l'identique, et le passage en feuille de styles a rendu la
 * duplication inutile. Le positionnement reste `fixed` d'après la position du
 * curseur, calculée par le widget.
 */

import * as React from '@theia/core/shared/react';
import { PatternSuggestion } from './types';

export const PatternAutocompleteMenu: React.FC<{
    suggestions: PatternSuggestion[];
    activeIndex: number;
    /** Position du curseur dans la page ; le menu s'ouvre juste en dessous. */
    position: { top: number; left: number };
    onHover: (index: number) => void;
    onSelect: (suggestion: PatternSuggestion) => void;
}> = ({ suggestions, activeIndex, position, onHover, onSelect }) => (
    <div
        className='geoapp-log-autocomplete'
        // Suit le curseur : seule la position est dynamique.
        style={{ top: `${position.top + 20}px`, left: `${position.left}px` }}
        // Garde le focus dans la zone de texte : un blur fermerait le menu
        // avant que le clic ne soit traité.
        onMouseDown={e => e.preventDefault()}
    >
        {suggestions.map((suggestion, index) => (
            <div
                key={suggestion.id}
                className={index === activeIndex
                    ? 'geoapp-log-autocomplete__item geoapp-log-autocomplete__item--active'
                    : 'geoapp-log-autocomplete__item'}
                onMouseEnter={() => onHover(index)}
                onClick={() => onSelect(suggestion)}
            >
                <div className='geoapp-log-autocomplete__label'>{suggestion.label}</div>
                <div className='geoapp-log-autocomplete__description'>{suggestion.description}</div>
            </div>
        ))}
    </div>
);
