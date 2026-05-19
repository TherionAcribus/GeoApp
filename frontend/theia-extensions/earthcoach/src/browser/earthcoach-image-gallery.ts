import { GeoImage, ImageOrigin } from './earthcoach-types';

export interface EarthCoachImageGallerySection {
    origin: ImageOrigin;
    title: string;
    description: string;
    warning: string;
    images: GeoImage[];
}

export interface EarthCoachImageGallery {
    sections: EarthCoachImageGallerySection[];
}

const SECTION_COPY: Record<ImageOrigin, Omit<EarthCoachImageGallerySection, 'images'>> = {
    cache_listing: {
        origin: 'cache_listing',
        title: 'Images du listing',
        description: 'Images fournies par le descriptif de la cache.',
        warning: 'Elles aident a comprendre le contexte, mais ne prouvent pas ce que vous avez observe sur place.',
    },
    user_observation: {
        origin: 'user_observation',
        title: 'Photos utilisateur',
        description: 'Photos ajoutees comme observations personnelles ou prises sur le terrain.',
        warning: 'Elles peuvent servir a analyser vos observations, avec confirmation terrain si necessaire.',
    },
    educational_reference: {
        origin: 'educational_reference',
        title: 'References pedagogiques',
        description: 'Images generiques issues de references externes ou d illustrations pedagogiques.',
        warning: 'Elles ne doivent jamais etre presentees comme une observation de terrain.',
    },
};

export function buildEarthCoachImageGallery(images: GeoImage[]): EarthCoachImageGallery {
    return {
        sections: (['user_observation', 'cache_listing', 'educational_reference'] as ImageOrigin[]).map(origin => ({
            ...SECTION_COPY[origin],
            images: images.filter(image => image.origin === origin),
        })),
    };
}
