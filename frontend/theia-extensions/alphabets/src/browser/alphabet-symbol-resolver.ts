import { AlphabetConfig } from '../common/alphabet-protocol';
import { AlphabetsService } from './services/alphabets-service';

const previewImageAvailabilityCache: Map<string, boolean> = new Map();
const previewImageAvailabilityLoading: Map<string, Promise<boolean>> = new Map();
const resolvedImageCache: Map<string, string | null> = new Map();
const resolvingImageCache: Map<string, Promise<string | null>> = new Map();
const loadedFontFamilies: Set<string> = new Set();
const loadingFontFamilies: Map<string, Promise<void>> = new Map();

export const FONT_FAMILY_PREFIX = 'alphabet-font-';

export const sanitizeAlphabetId = (alphabetId: string): string =>
    alphabetId.replace(/[^a-zA-Z0-9_-]/g, '-');

export const getFontFamily = (alphabetId: string): string =>
    `${FONT_FAMILY_PREFIX}${sanitizeAlphabetId(alphabetId)}`;

export const ensureAlphabetFontLoaded = (
    alphabetId: string,
    fontUrl: string
): Promise<void> => {
    const fontFamily = getFontFamily(alphabetId);

    if (loadedFontFamilies.has(fontFamily)) {
        return Promise.resolve();
    }

    if (loadingFontFamilies.has(fontFamily)) {
        return loadingFontFamilies.get(fontFamily)!;
    }

    if (typeof document === 'undefined' || typeof FontFace === 'undefined') {
        return Promise.resolve();
    }

    const styleId = `font-style-${sanitizeAlphabetId(alphabetId)}`;
    let styleElement = document.getElementById(styleId) as HTMLStyleElement | null;

    if (!styleElement) {
        styleElement = document.createElement('style');
        styleElement.id = styleId;
        document.head.appendChild(styleElement);
    }

    styleElement.textContent = `
        @font-face {
            font-family: "${fontFamily}";
            src: url("${fontUrl}");
            font-display: block;
        }
    `;

    const loadPromise = new FontFace(fontFamily, `url("${fontUrl}")`)
        .load()
        .then(loadedFace => {
            document.fonts.add(loadedFace);
        })
        .catch(async fontFaceError => {
            try {
                await document.fonts.load(`16px "${fontFamily}"`, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789');
            } catch {
                throw fontFaceError;
            }
        })
        .then(() => {
            loadedFontFamilies.add(fontFamily);
        })
        .finally(() => {
            loadingFontFamilies.delete(fontFamily);
        });

    loadingFontFamilies.set(fontFamily, loadPromise);
    return loadPromise;
};

export const getSpecialCharactersMap = (alphabetConfig: AlphabetConfig): Record<string, string> => {
    const specialCharacters = alphabetConfig.characters?.special;
    if (!specialCharacters || typeof specialCharacters !== 'object') {
        return {};
    }
    return specialCharacters;
};

export const getAlphabetLetters = (alphabetConfig: AlphabetConfig, uppercase: boolean): string[] => {
    if (alphabetConfig.upperCaseOnly && !uppercase) {
        return [];
    }

    const configuredLetters = alphabetConfig.characters?.letters;
    const letters = configuredLetters === 'all'
        ? Array.from({ length: 26 }, (_, index) => String.fromCharCode('a'.charCodeAt(0) + index))
        : Array.isArray(configuredLetters)
            ? configuredLetters
            : [];

    return uppercase ? letters.map(letter => letter.toUpperCase()) : letters;
};

export const getAlphabetNumbers = (alphabetConfig: AlphabetConfig): string[] => {
    const configuredNumbers = alphabetConfig.characters?.numbers;
    if (configuredNumbers === 'all') {
        return Array.from({ length: 10 }, (_, index) => String(index));
    }
    return Array.isArray(configuredNumbers) ? configuredNumbers : [];
};

export const isConfiguredCharacterSupported = (configuredCharacters: unknown, char: string): boolean => {
    if (configuredCharacters === 'all') {
        return true;
    }

    if (!Array.isArray(configuredCharacters)) {
        return false;
    }

    return configuredCharacters.some(candidate =>
        typeof candidate === 'string' && candidate.toLowerCase() === char.toLowerCase()
    );
};

export const getImageResourcePathCandidates = (
    alphabetConfig: AlphabetConfig,
    char: string
): string[] => {
    const { imageDir, imageFormat, hasUpperCase, upperCaseOnly } = alphabetConfig;
    if (!imageDir || !imageFormat || !char) {
        return [];
    }

    const specialCharacters = getSpecialCharactersMap(alphabetConfig);
    const specialResourceName = specialCharacters[char];
    if (specialResourceName) {
        return [`${imageDir}/${specialResourceName}.${imageFormat}`];
    }

    if (/^[0-9]+$/.test(char) && isConfiguredCharacterSupported(alphabetConfig.characters?.numbers, char)) {
        return [`${imageDir}/${char}.${imageFormat}`];
    }

    if (/^[a-zA-Z]$/.test(char) && isConfiguredCharacterSupported(alphabetConfig.characters?.letters, char)) {
        const lowerChar = char.toLowerCase();
        const upperChar = char.toUpperCase();
        const lowercaseSuffix = alphabetConfig.lowercaseSuffix || 'lowercase';
        const uppercaseSuffix = alphabetConfig.uppercaseSuffix || 'uppercase';
        const preferUpper = upperCaseOnly || (hasUpperCase && char === upperChar);
        const candidates = preferUpper
            ? [
                `${imageDir}/${upperChar}.${imageFormat}`,
                `${imageDir}/${lowerChar}.${imageFormat}`,
                `${imageDir}/${upperChar}_${uppercaseSuffix}.${imageFormat}`,
                `${imageDir}/${lowerChar}_${uppercaseSuffix}.${imageFormat}`
            ]
            : [
                `${imageDir}/${lowerChar}.${imageFormat}`,
                `${imageDir}/${upperChar}.${imageFormat}`,
                `${imageDir}/${lowerChar}_${lowercaseSuffix}.${imageFormat}`,
                `${imageDir}/${upperChar}_${lowercaseSuffix}.${imageFormat}`
            ];

        return Array.from(new Set(candidates));
    }

    return [];
};

export const probeImageUrl = (src: string): Promise<boolean> => {
    if (previewImageAvailabilityCache.has(src)) {
        return Promise.resolve(previewImageAvailabilityCache.get(src)!);
    }

    if (previewImageAvailabilityLoading.has(src)) {
        return previewImageAvailabilityLoading.get(src)!;
    }

    if (typeof Image === 'undefined') {
        return Promise.resolve(false);
    }

    const loadPromise = new Promise<boolean>(resolve => {
        const image = new Image();
        image.onload = () => resolve(true);
        image.onerror = () => resolve(false);
        image.src = src;
    }).then(isAvailable => {
        previewImageAvailabilityCache.set(src, isAvailable);
        return isAvailable;
    }).finally(() => {
        previewImageAvailabilityLoading.delete(src);
    });

    previewImageAvailabilityLoading.set(src, loadPromise);
    return loadPromise;
};

const getResourceBasename = (resourcePath: string): string => {
    const separatorIndex = resourcePath.lastIndexOf('/');
    return separatorIndex >= 0 ? resourcePath.slice(separatorIndex + 1) : resourcePath;
};

/**
 * Résout localement le fichier d'un caractère à partir de la liste `imageFiles`
 * fournie par le backend. Retourne `undefined` si la liste n'est pas disponible
 * (anciens payloads), auquel cas l'appelant retombe sur le probing réseau.
 */
const resolveImageSourceFromManifest = (
    alphabetId: string,
    alphabetConfig: AlphabetConfig,
    resourcePaths: string[],
    alphabetsService: AlphabetsService
): string | null | undefined => {
    const imageFiles = alphabetConfig.imageFiles;
    if (!Array.isArray(imageFiles)) {
        return undefined;
    }

    const availableFiles = new Set(imageFiles);
    for (const resourcePath of resourcePaths) {
        if (availableFiles.has(getResourceBasename(resourcePath))) {
            return alphabetsService.getResourceUrl(alphabetId, resourcePath);
        }
    }
    return null;
};

export const resolveAlphabetImageSource = async (
    alphabetId: string,
    alphabetConfig: AlphabetConfig,
    char: string,
    alphabetsService: AlphabetsService
): Promise<string | null> => {
    const resourcePaths = getImageResourcePathCandidates(alphabetConfig, char);
    const cacheKey = `${alphabetId}:${resourcePaths.join('|')}`;

    if (resolvedImageCache.has(cacheKey)) {
        return resolvedImageCache.get(cacheKey)!;
    }

    if (resolvingImageCache.has(cacheKey)) {
        return resolvingImageCache.get(cacheKey)!;
    }

    // Résolution déterministe via le manifeste backend : aucun aller-retour réseau.
    const manifestResult = resolveImageSourceFromManifest(
        alphabetId,
        alphabetConfig,
        resourcePaths,
        alphabetsService
    );
    if (manifestResult !== undefined) {
        resolvedImageCache.set(cacheKey, manifestResult);
        return manifestResult;
    }

    const resolvePromise = (async () => {
        for (const resourcePath of resourcePaths) {
            const src = alphabetsService.getResourceUrl(alphabetId, resourcePath);
            if (await probeImageUrl(src)) {
                resolvedImageCache.set(cacheKey, src);
                return src;
            }
        }

        resolvedImageCache.set(cacheKey, null);
        return null;
    })().finally(() => {
        resolvingImageCache.delete(cacheKey);
    });

    resolvingImageCache.set(cacheKey, resolvePromise);
    return resolvePromise;
};
