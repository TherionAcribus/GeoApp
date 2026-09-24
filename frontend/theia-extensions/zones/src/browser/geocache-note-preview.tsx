import * as React from 'react';
import { GeocacheNotesApiResponse } from './geocache-notes-types';
import '../../src/browser/style/geocache-details-header.css';

interface GeocacheNotePreviewProps {
    geocacheId: number;
    /** Nombre de notes GeoApp (extra de fiche `notes_count`). */
    notesCount?: number;
    /** Une note perso Geocaching.com existe (extra de fiche `has_personal_note`). */
    hasPersonalNote?: boolean;
    /** Chargement lazy : appelé uniquement au premier dépliage du panneau. */
    fetchNotes: () => Promise<GeocacheNotesApiResponse>;
    onOpenNotes: () => void;
}

/*
 * Aperçu dépliable des notes sous le header : le compteur vient des extras de la
 * fiche (gratuit), le contenu n'est fetché qu'au premier clic — zéro requête si
 * l'utilisateur ne déplie jamais.
 */
export const GeocacheNotePreview: React.FC<GeocacheNotePreviewProps> = ({
    geocacheId,
    notesCount,
    hasPersonalNote,
    fetchNotes,
    onOpenNotes
}) => {
    const [expanded, setExpanded] = React.useState(false);
    const [data, setData] = React.useState<GeocacheNotesApiResponse | null>(null);
    const [loading, setLoading] = React.useState(false);
    const [error, setError] = React.useState(false);

    // Garde anti-race : la réponse fetch doit correspondre à la fiche affichée.
    const geocacheIdRef = React.useRef(geocacheId);
    geocacheIdRef.current = geocacheId;

    // Nouvelle fiche ou nombre de notes modifié (édition dans le panneau Notes) :
    // les données chargées sont obsolètes, on re-fetch au prochain dépliage.
    React.useEffect(() => {
        setExpanded(false);
        setData(null);
        setLoading(false);
        setError(false);
    }, [geocacheId, notesCount]);

    const totalCount = (notesCount ?? 0) + (hasPersonalNote ? 1 : 0);
    if (totalCount === 0) {
        return null;
    }

    const toggle = (): void => {
        const next = !expanded;
        setExpanded(next);
        if (next && !data && !loading) {
            const forId = geocacheId;
            setLoading(true);
            setError(false);
            fetchNotes().then(
                res => {
                    if (geocacheIdRef.current !== forId) { return; }
                    setData(res);
                    setLoading(false);
                },
                () => {
                    if (geocacheIdRef.current !== forId) { return; }
                    setError(true);
                    setLoading(false);
                }
            );
        }
    };

    return (
        <div className='geoapp-gcd-note-preview'>
            <button
                type='button'
                className='geoapp-gcd-note-preview-toggle'
                onClick={toggle}
                aria-expanded={expanded}
            >
                <span className={`codicon ${expanded ? 'codicon-chevron-down' : 'codicon-chevron-right'}`} aria-hidden='true' />
                <span className='codicon codicon-note' aria-hidden='true' />
                <span>{totalCount > 1 ? 'Notes' : 'Note'}</span>
                <span className='geoapp-gcd-note-count'>{totalCount}</span>
            </button>
            {expanded ? (
                <div className='geoapp-gcd-note-preview-body'>
                    {loading ? (
                        <span style={{ opacity: 0.7, fontSize: 12 }}>
                            <i className='fa fa-spinner fa-spin' aria-hidden='true' /> Chargement…
                        </span>
                    ) : undefined}
                    {error ? (
                        <span style={{ fontSize: 12, color: 'var(--theia-errorForeground)' }}>
                            Impossible de charger les notes
                        </span>
                    ) : undefined}
                    {data ? (
                        <>
                            {data.gc_personal_note ? (
                                <div className='geoapp-gcd-note-item'>
                                    <div className='geoapp-gcd-note-kind'>
                                        <span className='codicon codicon-cloud' aria-hidden='true' />
                                        Geocaching.com
                                    </div>
                                    <div className='geoapp-gcd-note-text'>{data.gc_personal_note}</div>
                                </div>
                            ) : undefined}
                            {data.notes.map(note => (
                                <div key={note.id} className='geoapp-gcd-note-item'>
                                    <div className='geoapp-gcd-note-kind'>
                                        <span className='codicon codicon-edit' aria-hidden='true' />
                                        {note.note_type || 'note'}
                                    </div>
                                    <div className='geoapp-gcd-note-text'>{note.content}</div>
                                </div>
                            ))}
                            <div>
                                <button
                                    type='button'
                                    className='theia-button secondary'
                                    onClick={onOpenNotes}
                                    style={{ fontSize: 11, padding: '2px 8px', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                                >
                                    <span className='codicon codicon-go-to-file' aria-hidden='true' />
                                    Ouvrir les notes
                                </button>
                            </div>
                        </>
                    ) : undefined}
                </div>
            ) : undefined}
        </div>
    );
};
