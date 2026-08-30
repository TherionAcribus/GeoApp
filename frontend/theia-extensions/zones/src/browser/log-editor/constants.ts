/**
 * Constantes partagées du module d'édition de logs.
 *
 * Extrait de `geocache-log-editor-widget.tsx` (découpage phase 1).
 */

import { DNF_BLUE } from '../geocache-log-type-icons';

/**
 * Longueur maximale du texte d'un log acceptée par geocaching.com (même limite que c:geo).
 * Au-delà le site rejette l'envoi : on compte donc le texte **final** (patterns résolus).
 */
export const GC_LOG_MAX_LENGTH = 4000;

/** Actions proposées quand l'envoi d'une photo échoue juste avant la soumission du log. */
export const IMAGE_FAILURE_SEND = 'Envoyer sans les photos';
export const IMAGE_FAILURE_SEND_ALL = 'Envoyer sans les photos (tout le lot)';
export const IMAGE_FAILURE_SKIP = 'Ne pas loguer cette cache';

/** Violet : lisible en thème clair comme sombre, et déjà distinct du vert/orange/rouge des statuts d'envoi. */
export const ALREADY_FOUND_ACCENT = '#8b5cf6';
export const ALREADY_FOUND_ROW_BACKGROUND = 'rgba(139, 92, 246, 0.13)';

export const JUST_LOGGED_ACCENT = 'var(--theia-charts-green, #22c55e)';
export const JUST_LOGGED_ROW_BACKGROUND = 'rgba(34, 197, 94, 0.13)';

/** Bleu : la couleur du "Didn't find it" chez Geocaching.com, partagée avec son icône. */
export const DNF_ACCENT = DNF_BLUE;
export const DNF_ROW_BACKGROUND = 'rgba(59, 130, 246, 0.14)';

export const DNF_TOOLTIP = "Didn't find it — cache non trouvée";

/** Délai avant l'ouverture du menu d'autocomplétion @pattern (cf. refreshPatternAutocomplete). */
export const PATTERN_AUTOCOMPLETE_DELAY_MS = 120;
