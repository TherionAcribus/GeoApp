/**
 * Icônes de type de log dans l'esprit de Geocaching.com : le smiley jaune du "Found it"
 * et la tête bleue dépitée du "Didn't find it".
 *
 * Dessinées en SVG inline plutôt que chargées depuis geocaching.com : aucune requête
 * réseau, aucune image à empaqueter, et elles restent nettes à n'importe quelle taille.
 * Chaque disque porte un cerne plus sombre pour rester détouré sur un fond clair, et les
 * traits du visage contrastent avec leur disque (sombres sur le jaune, blancs sur le bleu).
 */
import * as React from '@theia/core/shared/react';

/** Jaune du smiley "Found it" de Geocaching.com. */
export const FOUND_IT_YELLOW = '#ffc700';

/** Bleu du "Didn't find it" de Geocaching.com. */
export const DNF_BLUE = '#3b82f6';

export type LogTypeIconKind = 'found' | 'dnf';

const FACE: Record<LogTypeIconKind, { fill: string; ring: string; ink: string; mouth: string; label: string }> = {
    found: {
        fill: FOUND_IT_YELLOW,
        ring: '#d19c00',
        ink: '#1f1f1f',
        mouth: 'M7.5 14.2c1 2 2.6 3 4.5 3s3.5-1 4.5-3',
        label: 'Found it',
    },
    dnf: {
        fill: DNF_BLUE,
        ring: '#2563eb',
        ink: '#ffffff',
        // Moue inversée : même tracé que le sourire, retourné.
        mouth: 'M7.5 17.2c1-2 2.6-3 4.5-3s3.5 1 4.5 3',
        label: "Didn't find it",
    },
};

export const LogTypeIcon: React.FC<{
    kind: LogTypeIconKind;
    size?: number;
    /** Par défaut la couleur Geocaching.com du type ; à surcharger pour suivre un accent local. */
    color?: string;
    title?: string;
}> = ({ kind, size = 16, color, title }) => {
    const face = FACE[kind];
    return (
        <span
            style={{ display: 'inline-flex', alignItems: 'center', lineHeight: 0 }}
            title={title ?? face.label}
            role='img'
            aria-label={face.label}
        >
            <svg width={size} height={size} viewBox='0 0 24 24' aria-hidden='true' focusable='false'>
                <circle cx='12' cy='12' r='11' fill={color ?? face.fill} stroke={face.ring} strokeWidth='1' />
                <circle cx='8.6' cy='9.4' r='1.6' fill={face.ink} />
                <circle cx='15.4' cy='9.4' r='1.6' fill={face.ink} />
                <path d={face.mouth} fill='none' stroke={face.ink} strokeWidth='2' strokeLinecap='round' />
            </svg>
        </span>
    );
};
