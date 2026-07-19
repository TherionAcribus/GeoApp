/**
 * Correspondance type de log Geocaching.com -> icône Font Awesome / couleur.
 *
 * Mutualisé entre `geocache-logs-widget.tsx` et `geocache-logs-summary.tsx` (ils
 * dupliquaient chacun leur propre mapping). Les couleurs utilisent les variables de
 * thème Theia (`--theia-charts-*`) avec une couleur de repli pour rester lisibles
 * même si le thème actif ne les définit pas, au lieu de couleurs hexadécimales figées.
 */

export function getLogTypeColor(logType: string): string {
    const type = logType.toLowerCase();
    if (type === 'found' || type.includes('found')) {
        return 'var(--theia-charts-green, #22c55e)';
    }
    if (type === 'did not find' || type === 'dnf' || type === 'needs archived') {
        return 'var(--theia-charts-red, #ef4444)';
    }
    if (type === 'note' || type === 'write note' || type === 'attended' || type === 'will attend') {
        return 'var(--theia-charts-blue, #3b82f6)';
    }
    if (type.includes('owner') || type.includes('maintenance')) {
        return 'var(--theia-charts-orange, #f59e0b)';
    }
    if (type.includes('reviewer')) {
        return 'var(--theia-charts-purple, #8b5cf6)';
    }
    if (type.includes('disable') || type.includes('archive')) {
        return 'var(--theia-charts-lines, #6b7280)';
    }
    return 'var(--theia-charts-lines, #9ca3af)';
}

export function getLogTypeIcon(logType: string): string {
    const type = logType.toLowerCase();
    if (type === 'found' || type.includes('found')) {
        return 'fa-check';
    }
    if (type === 'did not find' || type === 'dnf') {
        return 'fa-times';
    }
    if (type === 'note' || type === 'write note') {
        return 'fa-sticky-note';
    }
    if (type.includes('owner') || type === 'owner maintenance') {
        return 'fa-wrench';
    }
    if (type === 'needs maintenance') {
        return 'fa-exclamation-triangle';
    }
    if (type === 'needs archived') {
        return 'fa-exclamation-circle';
    }
    if (type.includes('reviewer')) {
        return 'fa-shield';
    }
    if (type === 'temporarily disabled' || type.includes('disable')) {
        return 'fa-pause';
    }
    if (type === 'archived' || type.includes('archive')) {
        return 'fa-archive';
    }
    if (type === 'enabled' || type === 'published' || type.includes('enable') || type.includes('publish')) {
        return 'fa-play';
    }
    if (type === 'attended' || type === 'will attend') {
        return 'fa-calendar-check';
    }
    if (type === 'webcam') {
        return 'fa-camera';
    }
    return 'fa-comment';
}
