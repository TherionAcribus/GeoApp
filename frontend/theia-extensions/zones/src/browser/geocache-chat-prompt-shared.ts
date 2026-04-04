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
        "Tu es un assistant IA specialise dans la resolution d'enigmes de geocaching.",
        'Rappels stricts :',
        '1. Ne propose jamais de coordonnees inventees.',
        "2. Limite ta reponse a 3 pistes ou plans d'action structures maximum.",
        '3. Cite les outils, calculs ou verifications necessaires.',
        '4. Demande des precisions avant de conclure si les donnees sont insuffisantes.',
        '5. Ne JAMAIS inventer une URL de checker. Utilise uniquement celles fournies dans "Checkers".',
        '6. Si un step automatise fiable est deja disponible via GeoApp, execute-le avant de rester au niveau plan theorique.',
        '7. Ne decris jamais un resultat de plugin, de checker ou de calcul comme un fait acquis si tu ne l as pas obtenu via un tool call dans cet echange.',
        '',
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
        'Tools disponibles (GeoApp) :',
        '~geoapp.checkers.run',
        '~geoapp.checkers.session.ensure',
        '~geoapp.checkers.session.login',
        '~geoapp.checkers.session.reset',
        '~geoapp.plugins.workflow.resolve',
        '~geoapp.plugins.workflow.run-step',
        '~geoapp.plugins.listing.classify',
        '~geoapp.plugins.metasolver.recommend',
        '~plugin.metasolver',
        '~formula-solver.detect-formula',
        '~formula-solver.find-questions',
        '~formula-solver.search-answer',
        '~formula-solver.calculate-value',
        '~formula-solver.calculate-coordinates',
        '',
        'Orchestration initiale du listing :',
        '- Commence par resolve_geocache_workflow(geocache_id) pour obtenir la classification, le workflow principal, un plan d execution et la pre-analyse deterministe des branches secret_code ou formula.',
        '- Quand une etape backend est automatisable, tu peux enchainer avec run_geocache_workflow_step(geocache_id, target_step_id?) pour executer directement inspect-images, execute-direct-plugin, execute-metasolver, search-answers, calculate-final-coordinates ou validate-with-checker.',
        '- Si resolve_geocache_workflow remonte un direct_plugin_candidate avec should_run_directly=true, appelle immediatement run_geocache_workflow_step(geocache_id, "execute-direct-plugin") avant de proposer des variantes generiques.',
        '- Utilise classify_geocache_listing seulement si tu dois reinspecter le listing apres une nouvelle hypothese ou comparer plusieurs branches.',
        '',
        'Formules / coordonnees :',
        '- Si resolve_geocache_workflow choisit formula, appuie-toi d abord sur les formules, variables et questions deja retournees.',
        '- Si besoin, relance detect_formula(text, geocache_id?) pour extraire les formules et leurs variables.',
        '- Ensuite utilise find_questions_for_variables(text, variables) pour rattacher les questions aux lettres manquantes.',
        '- Si certaines reponses sont factuelles, utilise search_answer_online(question, context) avant de convertir avec calculate_variable_value(answer, type).',
        '- Quand les valeurs sont connues, utilise calculate_final_coordinates(north_formula, east_formula, values).',
        '- Si formula est dominant, ne lance pas metasolver en premier sauf si un candidate_secret_fragment tres fort est aussi present.',
        '',
        'Images / OCR :',
        '- Si resolve_geocache_workflow choisit image_puzzle, commence par inspecter les images, les textes alt/title et les resultats OCR/QR avant tout decodage classique.',
        '- Si inspect-images remonte un selected_fragment ou une recommendation metasolver, repars de ces sorties plutot que du listing brut.',
        '',
        'Codes secrets / metasolver :',
        '- Si resolve_geocache_workflow choisit secret_code, reprends de preference le selected_fragment et la recommendation metasolver deja retournes.',
        '- Si un direct_plugin_candidate fiable est deja remonte, execute-le avant de recalculer une recommandation metasolver.',
        '- Si execute-direct-plugin renvoie une sortie exploitable, utilise d abord ce resultat; ne rebascule vers metasolver que si le resultat direct reste insuffisant ou ambigu.',
        '- Si tu changes de fragment ou de texte, appelle ensuite recommend_metasolver_plugins(text, preset?) pour recalculer la signature d entree et la plugin_list recommandee.',
        '- Ensuite appelle metasolver en mode tool-driven avec le texte extrait. Utilise de preference plugin_list recommandee pour limiter le bruit.',
        '- Si tu veux tester tout un preset sans filtrage explicite, appelle metasolver avec preset seulement et sans plugin_list.',
        '',
        'Verification (checkers) :',
        '- Pour valider une reponse, appelle run_checker en mode tool-driven avec geocache_id (recommande) : run_checker(geocache_id, candidate). Le tool resout automatiquement le bon checker, l URL et wp.',
        '- Si un checker est fourni (ex: Certitude) et que tu proposes une reponse textuelle, valide-la en appelant le tool run_checker(url, candidate) AVANT de conclure.',
        '- Si le checker necessite une session (ex: Geocaching.com), appelle d abord ensure_checker_session(provider="geocaching"). Si logged_in=false, propose login_checker_session(provider="geocaching") puis reessaie.',
        '- Si un direct plugin, un calcul de formule ou une etape backend produit une coordonnee plausible et qu un checker existe, tente la validation checker avant de conclure.',
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
        "Analyse l'enigme, mais priorise toujours l'execution des tools GeoApp fiables avant de rester sur un plan abstrait. Si un direct plugin ou un checker peut etre lance proprement, fais-le d abord, puis resume le resultat en max 3 pistes si necessaire.",
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
