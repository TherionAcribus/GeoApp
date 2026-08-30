/**
 * Enveloppe mémoïsée d'un fragment de rendu.
 *
 * Extrait de `geocache-log-editor-widget.tsx` (découpage phase 1).
 *
 * Le widget est un `ReactWidget` monolithique : chaque frappe appelle `this.update()`,
 * qui redessine tout l'arbre (tableau, N blocs par cache, surlignages, aperçus). Ce
 * composant coupe la propagation : il ne rappelle `render` que si l'une des valeurs de
 * `deps` a changé, à la manière d'un `useMemo`.
 *
 * `render` est une nouvelle closure à chaque rendu du parent : elle est volontairement
 * exclue de la comparaison. Quand `deps` change, React re-rend avec les *nouvelles*
 * props, donc la closure appelée est toujours la plus récente.
 */

import * as React from '@theia/core/shared/react';

export const MemoizedFragment = React.memo(
    ({ render }: { render: () => React.ReactNode; deps: readonly unknown[] }) => <>{render()}</>,
    (prev, next) =>
        prev.deps.length === next.deps.length
        && prev.deps.every((value, index) => Object.is(value, next.deps[index]))
);
