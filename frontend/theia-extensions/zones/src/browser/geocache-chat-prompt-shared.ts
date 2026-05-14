import {
    buildGeoAppOpenChatRequestDetail,
    GeoAppOpenChatRequestDetailPayload,
} from './geoapp-chat-shared';

export interface GeocachePromptChecker {
    name?: string;
    url?: string;
}

export interface GeocachePromptWaypoint {
    prefix?: string;
    lookup?: string;
    name?: string;
    type?: string;
    gc_coords?: string;
    latitude?: number;
    longitude?: number;
    note?: string;
}

export interface GeocachePromptData {
    id: number;
    gc_code?: string;
    name: string;
    type?: string;
    size?: string;
    owner?: string;
    difficulty?: number;
    terrain?: number;
    coordinates_raw?: string;
    original_coordinates_raw?: string;
    placed_at?: string;
    status?: string;
    description_html?: string;
    hints?: string;
    hints_decoded?: string;
    hints_decoded_override?: string;
    favorites_count?: number;
    logs_count?: number;
    waypoints?: GeocachePromptWaypoint[];
    checkers?: GeocachePromptChecker[];
}

export type GeocachePromptWorkflowKind =
    'general' | 'secret_code' | 'formula' | 'checker' | 'hidden_content' | 'image_puzzle';

function truncateText(value: string, maxLength: number): string {
    if (value.length <= maxLength) {
        return value;
    }
    return `${value.substring(0, maxLength).trim()}...`;
}

function stripHtml(value: string): string {
    if (typeof document !== 'undefined') {
        const temp = document.createElement('div');
        temp.innerHTML = value;
        return (temp.textContent || temp.innerText || '').trim();
    }
    return value.replace(/<[^>]+>/g, ' ').trim();
}

function sanitizeRichText(value?: string, maxLength = 1500): string {
    if (!value) {
        return '';
    }
    return truncateText(stripHtml(value).replace(/\s+/g, ' ').trim(), maxLength);
}

function rot13(value: string): string {
    return value.replace(/[a-zA-Z]/g, char => {
        const base = char <= 'Z' ? 65 : 97;
        const code = char.charCodeAt(0) - base;
        return String.fromCharCode(base + ((code + 13) % 26));
    });
}

function toGCFormat(lat: number, lon: number): { gcLat: string; gcLon: string } {
    const latDir = lat >= 0 ? 'N' : 'S';
    const lonDir = lon >= 0 ? 'E' : 'W';
    const absLat = Math.abs(lat);
    const absLon = Math.abs(lon);
    const latDeg = Math.floor(absLat);
    const lonDeg = Math.floor(absLon);
    const latMin = ((absLat - latDeg) * 60).toFixed(3);
    const lonMin = ((absLon - lonDeg) * 60).toFixed(3);
    return {
        gcLat: `${latDir} ${latDeg}° ${latMin}`,
        gcLon: `${lonDir} ${lonDeg}° ${lonMin}`,
    };
}

function getDecodedHints(data: GeocachePromptData): string | undefined {
    if (data.hints_decoded_override) {
        return data.hints_decoded_override;
    }
    if (data.hints_decoded) {
        return data.hints_decoded;
    }
    if (!data.hints) {
        return undefined;
    }
    return rot13(data.hints);
}

function buildWaypointsSummary(waypoints: GeocachePromptWaypoint[]): string {
    const preview = waypoints
        .slice(0, 3)
        .map(waypoint => {
            const label = waypoint.name || waypoint.prefix || 'WP';
            const coords = waypoint.gc_coords || (waypoint.latitude != null && waypoint.longitude != null
                ? `${waypoint.latitude.toFixed(5)}, ${waypoint.longitude.toFixed(5)}`
                : undefined);
            return coords ? `${label} (${coords})` : label;
        })
        .join(' • ');
    const remaining = waypoints.length > 3 ? ` ... (+${waypoints.length - 3})` : '';
    return `${preview}${remaining}`;
}

function buildWaypointsDetails(waypoints: GeocachePromptWaypoint[]): string[] {
    return waypoints.map(waypoint => {
        const labelParts: string[] = [];
        if (waypoint.prefix) {
            labelParts.push(waypoint.prefix);
        }
        if (waypoint.lookup) {
            labelParts.push(waypoint.lookup);
        }

        const label = labelParts.join(' / ');
        const name = (waypoint.name || '').trim();
        const title = [label || undefined, name || undefined].filter(Boolean).join(' • ') || 'Waypoint';
        const type = (waypoint.type || '').trim();

        let coords = (waypoint.gc_coords || '').trim();
        if (!coords && waypoint.latitude != null && waypoint.longitude != null) {
            const gcFormat = toGCFormat(waypoint.latitude, waypoint.longitude);
            coords = `${gcFormat.gcLat}, ${gcFormat.gcLon}`;
        }

        const decimalCoords = waypoint.latitude != null && waypoint.longitude != null
            ? `${waypoint.latitude.toFixed(5)}, ${waypoint.longitude.toFixed(5)}`
            : undefined;

        const note = (waypoint.note || '').trim();
        const notePreview = note ? truncateText(note.replace(/\s+/g, ' '), 220) : undefined;

        const parts: string[] = [
            `- ${title}${type ? ` (${type})` : ''}`,
            ...(coords ? [`  Coordonnees : ${coords}`] : []),
            ...(decimalCoords ? [`  Decimal : ${decimalCoords}`] : []),
            ...(notePreview ? [`  Note : ${notePreview}`] : []),
        ];

        return parts.join('\n');
    });
}

export function buildGeocacheChatPrompt(data: GeocachePromptData): string {
    const gcCode = (data.gc_code ?? '').trim();
    const certitudeUrl = data.checkers?.find(checker => (checker.url || '').toLowerCase().includes('certitudes.org'))?.url;
    const geocachingCheckerUrl = data.checkers?.find(checker => (checker.name || '').toLowerCase().includes('geocaching'))?.url;

    const lines: string[] = [
        `Nom : ${data.name}`,
        `ID : ${data.id}`,
        `Code : ${data.gc_code ?? 'Inconnu'} • Type : ${data.type ?? 'Inconnu'} • Taille : ${data.size ?? 'N/A'}`,
        `Difficulte / Terrain : ${data.difficulty ?? '?'} / ${data.terrain ?? '?'}`,
        `Proprietaire : ${data.owner ?? 'Inconnu'} • Statut : ${data.status ?? 'Inconnu'}`,
        `Coordonnees affichees : ${data.coordinates_raw ?? data.original_coordinates_raw ?? 'Non renseignees'}`,
        data.original_coordinates_raw && data.coordinates_raw && data.original_coordinates_raw !== data.coordinates_raw
            ? `Coordonnees originales : ${data.original_coordinates_raw}`
            : undefined,
        data.placed_at ? `Placee le : ${data.placed_at}` : undefined,
        `Favoris : ${data.favorites_count ?? 0} • Logs : ${data.logs_count ?? 0}`,
        data.waypoints?.length ? `Waypoints (${data.waypoints.length}) : ${buildWaypointsSummary(data.waypoints)}` : undefined,
        data.checkers?.length
            ? `Checkers : ${data.checkers.map(checker => (checker.url ? `${checker.name || 'Checker'}: ${checker.url}` : (checker.name || 'Checker'))).join(' • ')}`
            : undefined,
    ].filter((value): value is string => Boolean(value));

    const descriptionSnippet = sanitizeRichText(data.description_html, 1500);
    if (descriptionSnippet) {
        lines.push('', 'Description (extrait) :', descriptionSnippet);
    }

    const decodedHints = getDecodedHints(data);
    if (decodedHints) {
        lines.push('', 'Indices (extrait) :', truncateText(decodedHints.trim(), 600));
    }

    if (data.waypoints?.length) {
        lines.push('', 'Waypoints (details) :', ...buildWaypointsDetails(data.waypoints));
    }

    return [
        ...(certitudeUrl
            ? [
                'Certitude (checker) :',
                certitudeUrl,
                ...(gcCode
                    ? [
                        `Pour Certitude, si tu appelles run_checker et que l'URL n'a pas de ?wp=..., passe aussi wp="${gcCode}".`,
                        `Pour une eventuelle session Certitude: ensure_checker_session(provider="certitudes", wp="${gcCode}").`,
                    ]
                    : []),
                '',
            ]
            : []),
        ...(geocachingCheckerUrl && geocachingCheckerUrl.toLowerCase().includes('#solution-checker') && gcCode
            ? [
                `Note: le checker Geocaching peut etre stocke comme ancre (${geocachingCheckerUrl}). Dans ce cas, lors de l'appel a run_checker, passe aussi wp="${gcCode}" pour que l'app reconstruise l'URL Geocaching correcte.`,
                '',
            ]
            : []),
        '',
        '--- CONTEXTE GEOCACHE ---',
        ...lines,
        '',
        '--- OBJECTIF ---',
        "Analyse l'enigme avec les tools GeoApp exposes par la politique active. Si un checker est explicitement fourni, utilise uniquement celui du contexte quand le profil courant l'autorise; sinon fais sans checker. Resume ensuite le resultat en max 3 pistes si necessaire.",
    ].join('\n');
}

export function buildGeocacheFreeChatContext(data: GeocachePromptData): string {
    const lines = [
        '--- CONTEXTE GEOCACHE ---',
        `Nom : ${data.name}`,
        data.id !== undefined ? `ID (geocache_id) : ${data.id}` : undefined,
        `Code : ${data.gc_code ?? 'Inconnu'} • Type : ${data.type ?? 'Inconnu'} • Taille : ${data.size ?? 'N/A'}`,
        `Difficulte / Terrain : ${data.difficulty ?? '?'} / ${data.terrain ?? '?'}`,
        `Proprietaire : ${data.owner ?? 'Inconnu'} • Statut : ${data.status ?? 'Inconnu'}`,
        `Coordonnees : ${data.coordinates_raw ?? data.original_coordinates_raw ?? 'Non renseignees'}`,
        data.original_coordinates_raw && data.coordinates_raw && data.original_coordinates_raw !== data.coordinates_raw
            ? `Coordonnees originales : ${data.original_coordinates_raw}`
            : undefined,
        data.placed_at ? `Placee le : ${data.placed_at}` : undefined,
        `Favoris : ${data.favorites_count ?? 0} • Logs : ${data.logs_count ?? 0}`,
        data.waypoints?.length ? `Waypoints (${data.waypoints.length}) : ${buildWaypointsSummary(data.waypoints)}` : undefined,
        data.checkers?.length
            ? `Checkers : ${data.checkers.map(c => (c.url ? `${c.name || 'Checker'}: ${c.url}` : (c.name || 'Checker'))).join(' • ')}`
            : undefined,
    ].filter((v): v is string => Boolean(v));

    const descriptionSnippet = sanitizeRichText(data.description_html, 1200);
    if (descriptionSnippet) {
        lines.push('', 'Description :', descriptionSnippet);
    }

    const decodedHints = getDecodedHints(data);
    if (decodedHints) {
        lines.push('', 'Indices :', truncateText(decodedHints.trim(), 500));
    }

    if (data.waypoints?.length) {
        lines.push('', 'Waypoints (details) :', ...buildWaypointsDetails(data.waypoints));
    }

    lines.push('', '--- FIN DU CONTEXTE ---');
    return lines.join('\n');
}

export function buildGeocacheFreeChatFinalPrompt(draft: string, imageUrls: string[]): string {
    const normalizedDraft = draft.trim();
    if (!imageUrls.length) {
        return normalizedDraft;
    }
    const count = imageUrls.length === 1 ? '1 image associee' : `${imageUrls.length} images associees`;
    return [
        normalizedDraft,
        '',
        `[${count} a cette geocache.]`,
        `Instruction : pour identifier ou decrire visuellement ce(s) image(s) (insecte, animal, objet, scene, personnage...), appelle IMMEDIATEMENT run_geocache_workflow_step(geocache_id, target_step_id="describe-images"). Le module vision backend peut decrire les images automatiquement. NE PAS demander a l utilisateur de decrire l image.`,
    ].join('\n');
}

export function buildGeocacheGeoAppOpenChatDetail(
    data: GeocachePromptData,
    workflowKind: GeocachePromptWorkflowKind,
    preferredProfile?: string,
): GeoAppOpenChatRequestDetailPayload {
    return buildGeoAppOpenChatRequestDetail({
        geocacheId: data.id,
        gcCode: data.gc_code,
        geocacheName: data.name,
        prompt: buildGeocacheChatPrompt(data),
        focus: true,
        workflowKind,
        preferredProfile,
    });
}
