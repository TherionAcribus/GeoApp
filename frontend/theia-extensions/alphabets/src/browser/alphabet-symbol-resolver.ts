import { AlphabetConfig } from '../common/alphabet-protocol';
import { AlphabetsService } from './services/alphabets-service';

const previewImageAvailabilityCache: Map<string, boolean> = new Map();
const previewImageAvailabilityLoading: Map<string, Promise<boolean>> = new Map();
const resolvedImageCache: Map<string, string | null> = new Map();
const resolvingImageCache: Map<string, Promise<string | null>> = new Map();
const loadedFontFamilies: Set<string> = new Set();
const loadingFontFamilies: Map<string, Promise<void>> = new Map();
const FONT_DEBUG_PREFIX = '[AlphabetsFont]';

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
    console.info(FONT_DEBUG_PREFIX, 'ensure start', { alphabetId, fontFamily, fontUrl });

    if (loadedFontFamilies.has(fontFamily)) {
        console.info(FONT_DEBUG_PREFIX, 'already loaded', { alphabetId, fontFamily });
        return Promise.resolve();
    }

    if (loadingFontFamilies.has(fontFamily)) {
        console.info(FONT_DEBUG_PREFIX, 'already loading', { alphabetId, fontFamily });
        return loadingFontFamilies.get(fontFamily)!;
    }

    if (typeof document === 'undefined' || typeof FontFace === 'undefined') {
        console.warn(FONT_DEBUG_PREFIX, 'Font Loading API unavailable', {
            alphabetId,
            hasDocument: typeof document !== 'undefined',
            hasFontFace: typeof FontFace !== 'undefined'
        });
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
    console.info(FONT_DEBUG_PREFIX, 'style injected', {
        alphabetId,
        fontFamily,
        styleId,
        css: styleElement.textContent.trim()
    });

    const loadPromise = inspectFontResponse(alphabetId, fontUrl)
        .then(() => new FontFace(fontFamily, `url("${fontUrl}")`).load())
        .then(loadedFace => {
            document.fonts.add(loadedFace);
            console.info(FONT_DEBUG_PREFIX, 'FontFace.load success', {
                alphabetId,
                fontFamily,
                status: loadedFace.status,
                documentCheck: document.fonts.check(`16px "${fontFamily}"`, 'ABC123')
            });
        })
        .catch(async fontFaceError => {
            console.warn(FONT_DEBUG_PREFIX, 'FontFace.load failed, trying CSS font load fallback', {
                alphabetId,
                fontFamily,
                errorName: fontFaceError?.name,
                errorMessage: fontFaceError?.message,
                error: fontFaceError
            });
            try {
                const loadedFaces = await document.fonts.load(`16px "${fontFamily}"`, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789');
                console.info(FONT_DEBUG_PREFIX, 'document.fonts.load fallback result', {
                    alphabetId,
                    fontFamily,
                    loadedCount: loadedFaces.length,
                    statuses: loadedFaces.map(face => face.status),
                    documentCheck: document.fonts.check(`16px "${fontFamily}"`, 'ABC123')
                });
            } catch (fallbackError) {
                console.error(FONT_DEBUG_PREFIX, 'document.fonts.load fallback failed', {
                    alphabetId,
                    fontFamily,
                    fallbackErrorName: fallbackError?.name,
                    fallbackErrorMessage: fallbackError?.message,
                    fallbackError
                });
                throw fontFaceError;
            }
        })
        .then(() => {
            loadedFontFamilies.add(fontFamily);
            console.info(FONT_DEBUG_PREFIX, 'ensure success', {
                alphabetId,
                fontFamily,
                finalCheck: document.fonts.check(`16px "${fontFamily}"`, 'ABC123'),
                loadedFontFamilies: Array.from(loadedFontFamilies)
            });
        })
        .finally(() => {
            console.info(FONT_DEBUG_PREFIX, 'ensure finished', { alphabetId, fontFamily });
            loadingFontFamilies.delete(fontFamily);
        });

    loadingFontFamilies.set(fontFamily, loadPromise);
    return loadPromise;
};

const inspectFontResponse = async (alphabetId: string, fontUrl: string): Promise<void> => {
    if (typeof fetch === 'undefined') {
        console.info(FONT_DEBUG_PREFIX, 'fetch unavailable for font inspection', { alphabetId, fontUrl });
        return;
    }

    try {
        const response = await fetch(fontUrl, { method: 'GET', cache: 'no-store' });
        const buffer = await response.clone().arrayBuffer();
        const firstBytes = Array.from(new Uint8Array(buffer.slice(0, 8)))
            .map(byte => byte.toString(16).padStart(2, '0'))
            .join(' ');

        console.info(FONT_DEBUG_PREFIX, 'font response inspection', {
            alphabetId,
            fontUrl,
            ok: response.ok,
            status: response.status,
            statusText: response.statusText,
            contentType: response.headers.get('content-type'),
            contentLength: response.headers.get('content-length'),
            accessControlAllowOrigin: response.headers.get('access-control-allow-origin'),
            byteLength: buffer.byteLength,
            firstBytes
        });
    } catch (error) {
        console.warn(FONT_DEBUG_PREFIX, 'font response inspection failed', {
            alphabetId,
            fontUrl,
            errorName: error?.name,
            errorMessage: error?.message,
            error
        });
    }
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
