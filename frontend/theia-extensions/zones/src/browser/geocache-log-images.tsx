/**
 * Photos jointes à un log : vignettes, téléchargement ponctuel, agrandissement.
 *
 * Trois états à rendre, et ils comptent autant l'un que l'autre :
 *
 * - **stockées** : une grille de vignettes servies par le backend ;
 * - **connues, non stockées** : un bandeau qui annonce combien de photos le log
 *   porte, avec un bouton pour les récupérer. C'est ce que voit l'utilisateur
 *   qui a désactivé `geoApp.logs.downloadImages` — il garde la main log par
 *   log, sans qu'aucune requête ne parte tant qu'il n'a pas cliqué ;
 * - **en cours** : le bouton se verrouille, pour qu'un double-clic ne relance
 *   pas le téléchargement.
 *
 * Aucune image n'est jamais affichée depuis `source_url` : cette URL pointe
 * vers Geocaching.com, et s'en servir viderait la préférence de son sens.
 * Seule `display_url`, qui n'existe qu'une fois la photo sur disque, alimente
 * un `<img src>`.
 *
 * La visionneuse est un modal local d'une centaine de lignes plutôt qu'un
 * composant partagé : le projet n'a pas de lightbox générique, et le seul
 * overlay existant est codé en dur dans le panneau d'images de géocache
 * (123 Ko) — l'en extraire pour trois vignettes coûterait plus que ça ne
 * rapporte.
 */
import * as React from 'react';
import { GeocacheLogImageDto } from './geocache-logs-types';

export interface LogImagesProps {
    images: GeocacheLogImageDto[];
    /** Résout une URL relative du backend en URL absolue. */
    resolveUrl: (url: string) => string;
    /** Téléchargement demandé explicitement pour ce log. */
    onDownload: () => void;
    isDownloading: boolean;
}

/** Libellé « 3 photos » / « 1 photo ». */
function describeCount(count: number): string {
    return `${count} photo${count > 1 ? 's' : ''}`;
}

/**
 * Visionneuse plein panneau d'une photo de log.
 *
 * Ne monte que sur demande : tant qu'aucune photo n'est ouverte, il n'y a ni
 * overlay ni écouteur clavier.
 */
const LogImageViewer: React.FC<{
    images: GeocacheLogImageDto[];
    index: number;
    resolveUrl: (url: string) => string;
    onClose: () => void;
    onNavigate: (index: number) => void;
}> = ({ images, index, resolveUrl, onClose, onNavigate }) => {
    const image = images[index];

    const goPrevious = React.useCallback(
        () => onNavigate((index - 1 + images.length) % images.length),
        [index, images.length, onNavigate]
    );
    const goNext = React.useCallback(
        () => onNavigate((index + 1) % images.length),
        [index, images.length, onNavigate]
    );

    React.useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                onClose();
            } else if (event.key === 'ArrowLeft') {
                goPrevious();
            } else if (event.key === 'ArrowRight') {
                goNext();
            }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [onClose, goPrevious, goNext]);

    if (!image || !image.display_url) {
        return null;
    }

    const caption = image.title || image.description;

    return (
        <div className='geoapp-log-image-viewer' onClick={onClose} role='dialog' aria-modal='true'>
            {/* Le clic sur la photo ne doit pas refermer : seul le fond le fait. */}
            <div className='geoapp-log-image-viewer__stage' onClick={event => event.stopPropagation()}>
                <img
                    className='geoapp-log-image-viewer__image'
                    src={resolveUrl(image.display_url)}
                    alt={caption || 'Photo de log'}
                />
                {(caption || images.length > 1) && (
                    <div className='geoapp-log-image-viewer__caption'>
                        {caption && <span>{caption}</span>}
                        {images.length > 1 && (
                            <span className='geoapp-log-image-viewer__position'>
                                {index + 1} / {images.length}
                            </span>
                        )}
                    </div>
                )}
                {images.length > 1 && (
                    <>
                        <button
                            className='geoapp-log-image-viewer__nav geoapp-log-image-viewer__nav--previous'
                            onClick={goPrevious}
                            title='Photo précédente (←)'
                            aria-label='Photo précédente'
                        >
                            <i className='fa fa-chevron-left' />
                        </button>
                        <button
                            className='geoapp-log-image-viewer__nav geoapp-log-image-viewer__nav--next'
                            onClick={goNext}
                            title='Photo suivante (→)'
                            aria-label='Photo suivante'
                        >
                            <i className='fa fa-chevron-right' />
                        </button>
                    </>
                )}
                <button
                    className='geoapp-log-image-viewer__close'
                    onClick={onClose}
                    title='Fermer (Échap)'
                    aria-label='Fermer'
                >
                    <i className='fa fa-times' />
                </button>
            </div>
        </div>
    );
};

export const LogImages: React.FC<LogImagesProps> = ({
    images, resolveUrl, onDownload, isDownloading
}) => {
    const [viewerIndex, setViewerIndex] = React.useState<number | undefined>(undefined);

    if (images.length === 0) {
        return null;
    }

    const stored = images.filter(image => image.display_url);

    if (stored.length === 0) {
        return (
            <div className='geoapp-log-images geoapp-log-images--pending'>
                <span className='geoapp-log-images__banner'>
                    <i className='fa fa-image' />
                    {describeCount(images.length)} jointe{images.length > 1 ? 's' : ''}
                </span>
                <button
                    className='geoapp-log-images__download'
                    onClick={onDownload}
                    disabled={isDownloading}
                    title='Télécharger ces photos pour les consulter, y compris hors ligne'
                >
                    <i className={`fa ${isDownloading ? 'fa-spinner fa-spin' : 'fa-cloud-download'}`} />
                    {isDownloading ? 'Téléchargement…' : 'Télécharger les photos'}
                </button>
            </div>
        );
    }

    return (
        <div className='geoapp-log-images'>
            <div className='geoapp-log-images__grid'>
                {stored.map((image, index) => (
                    <button
                        key={image.id}
                        className='geoapp-log-images__thumb'
                        onClick={() => setViewerIndex(index)}
                        title={image.title || image.description || 'Agrandir la photo'}
                    >
                        <img
                            src={resolveUrl(image.display_url!)}
                            alt={image.title || 'Photo de log'}
                            loading='lazy'
                            decoding='async'
                        />
                    </button>
                ))}
            </div>

            {/* Un téléchargement partiel reste possible : une photo retirée de
                Geocaching.com échoue là où les autres passent. */}
            {stored.length < images.length && (
                <button
                    className='geoapp-log-images__download geoapp-log-images__download--partial'
                    onClick={onDownload}
                    disabled={isDownloading}
                    title='Réessayer les photos qui manquent'
                >
                    <i className={`fa ${isDownloading ? 'fa-spinner fa-spin' : 'fa-cloud-download'}`} />
                    {isDownloading
                        ? 'Téléchargement…'
                        : `${images.length - stored.length} photo${images.length - stored.length > 1 ? 's' : ''} non téléchargée${images.length - stored.length > 1 ? 's' : ''}`}
                </button>
            )}

            {viewerIndex !== undefined && (
                <LogImageViewer
                    images={stored}
                    index={viewerIndex}
                    resolveUrl={resolveUrl}
                    onClose={() => setViewerIndex(undefined)}
                    onNavigate={setViewerIndex}
                />
            )}
        </div>
    );
};
