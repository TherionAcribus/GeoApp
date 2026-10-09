import { CoordinatePreviewState } from '../preview/types';
import { MYSTERY_MAX_DISTANCE_KM } from './distance';

interface Bounds {
    minLat: number;
    maxLat: number;
    minLon: number;
    maxLon: number;
}

type CandidateKind = 'point' | 'bbox' | 'line-lat' | 'line-lon';

interface OverlayCandidate {
    kind: CandidateKind;
    bounds: Bounds;
    formatted?: string;
}

/** Contenu de l'événement `geoapp-map-formula-solver-preview-overlay` */
export interface PreviewOverlayDetail {
    gcCode?: string;
    geocacheId?: number;
    /** Cercle des 2 miles autour des coordonnées publiées */
    circle?: { centerLat: number; centerLon: number; radiusMeters: number };
    /** Zone où peut se trouver la finale d'après les valeurs déjà saisies */
    candidateRaw?: OverlayCandidate;
    /** La même zone, limitée au cercle */
    candidateClipped?: OverlayCandidate;
}

/**
 * Construit l'overlay de résolution à afficher sur la carte : le cercle des
 * 2 miles autour de l'origine et la zone estimée de la finale. Retourne
 * undefined quand il n'y a rien à afficher (l'overlay doit alors être effacé).
 */
export function buildPreviewOverlayDetail(params: {
    gcCode?: string;
    geocacheId?: number;
    originLat?: number;
    originLon?: number;
    /** Preview de la formule sélectionnée, undefined si aucune formule */
    preview?: CoordinatePreviewState;
}): PreviewOverlayDetail | undefined {
    const { gcCode, geocacheId, originLat, originLon, preview } = params;
    const hasOrigin = typeof originLat === 'number' && typeof originLon === 'number' && isFinite(originLat) && isFinite(originLon);
    const radiusMeters = MYSTERY_MAX_DISTANCE_KM * 1000; // 2 miles
    const circle = hasOrigin ? { centerLat: originLat as number, centerLon: originLon as number, radiusMeters } : undefined;

    if (!preview) {
        // Sans formule, on peut au moins afficher le cercle de contrainte
        return circle ? { gcCode, geocacheId, circle } : undefined;
    }

    const n = preview.north;
    const e = preview.east;

    const canBuildCandidate = !(n.minDecimalDegrees === undefined || n.maxDecimalDegrees === undefined ||
        e.minDecimalDegrees === undefined || e.maxDecimalDegrees === undefined);

    const candidateBounds: Bounds | undefined = canBuildCandidate ? {
        minLat: n.minDecimalDegrees!,
        maxLat: n.maxDecimalDegrees!,
        minLon: e.minDecimalDegrees!,
        maxLon: e.maxDecimalDegrees!
    } : undefined;

    const formatted = (n.status === 'valid' && e.status === 'valid')
        ? `${n.display} ${e.display}`
        : undefined;

    let candidateRaw: OverlayCandidate | undefined;
    let candidateClipped: OverlayCandidate | undefined;

    if (candidateBounds) {
        candidateRaw = { kind: kindOf(candidateBounds), bounds: candidateBounds, formatted };

        if (circle) {
            const clippedBounds = intersectBoundsWithCircleBBox(candidateBounds, circle.centerLat, circle.centerLon, radiusMeters);
            if (clippedBounds) {
                // On calcule le kind sur la zone clippée (peut devenir ligne/point)
                candidateClipped = { kind: kindOf(clippedBounds), bounds: clippedBounds, formatted };
            }
        }
    }

    if (!candidateRaw && !candidateClipped && !circle) {
        return undefined;
    }

    return { gcCode, geocacheId, circle, candidateRaw, candidateClipped };
}

function kindOf(b: Bounds): CandidateKind {
    const latSpan = Math.abs(b.maxLat - b.minLat);
    const lonSpan = Math.abs(b.maxLon - b.minLon);
    const eps = 1e-9;
    if (latSpan < eps && lonSpan < eps) {
        return 'point';
    }
    if (latSpan < eps) {
        return 'line-lat';
    }
    if (lonSpan < eps) {
        return 'line-lon';
    }
    return 'bbox';
}

function intersectBoundsWithCircleBBox(
    bounds: Bounds,
    centerLat: number,
    centerLon: number,
    radiusMeters: number
): Bounds | undefined {
    // Approximation suffisante pour 2 miles: conversion mètres -> degrés
    const latRad = (centerLat * Math.PI) / 180;
    const metersPerDegreeLat = 111_320;
    const metersPerDegreeLon = Math.max(1, metersPerDegreeLat * Math.cos(latRad));

    const dLat = radiusMeters / metersPerDegreeLat;
    const dLon = radiusMeters / metersPerDegreeLon;

    const circleBBox = {
        minLat: centerLat - dLat,
        maxLat: centerLat + dLat,
        minLon: centerLon - dLon,
        maxLon: centerLon + dLon
    };

    const clipped = {
        minLat: Math.max(bounds.minLat, circleBBox.minLat),
        maxLat: Math.min(bounds.maxLat, circleBBox.maxLat),
        minLon: Math.max(bounds.minLon, circleBBox.minLon),
        maxLon: Math.min(bounds.maxLon, circleBBox.maxLon)
    };

    if (clipped.minLat > clipped.maxLat || clipped.minLon > clipped.maxLon) {
        return undefined;
    }
    return clipped;
}
