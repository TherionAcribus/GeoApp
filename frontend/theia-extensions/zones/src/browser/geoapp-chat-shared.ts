export const GeoAppChatAgentId = 'GeoApp';
export const GeoAppChatLocalAgentId = 'geoapp-chat-local';
export const GeoAppChatFastAgentId = 'geoapp-chat-fast';
export const GeoAppChatStrongAgentId = 'geoapp-chat-strong';
export const GeoAppChatWebAgentId = 'geoapp-chat-web';

export const GEOAPP_CHAT_DEFAULT_PROFILE_PREF = 'geoApp.chat.defaultProfile';
export const GEOAPP_CHAT_SECRET_CODE_PROFILE_PREF = 'geoApp.chat.workflowProfile.secretCode';
export const GEOAPP_CHAT_FORMULA_PROFILE_PREF = 'geoApp.chat.workflowProfile.formula';
export const GEOAPP_CHAT_CHECKER_PROFILE_PREF = 'geoApp.chat.workflowProfile.checker';
export const GEOAPP_CHAT_HIDDEN_CONTENT_PROFILE_PREF = 'geoApp.chat.workflowProfile.hiddenContent';
export const GEOAPP_CHAT_IMAGE_PUZZLE_PROFILE_PREF = 'geoApp.chat.workflowProfile.imagePuzzle';
export const GEOAPP_CHAT_BEHAVIOR_DEFAULT_PROFILE_PREF = 'geoApp.chat.behaviorProfile.default';
export const GEOAPP_CHAT_BEHAVIOR_SECRET_CODE_PROFILE_PREF = 'geoApp.chat.behaviorProfile.workflow.secretCode';
export const GEOAPP_CHAT_BEHAVIOR_FORMULA_PROFILE_PREF = 'geoApp.chat.behaviorProfile.workflow.formula';
export const GEOAPP_CHAT_BEHAVIOR_CHECKER_PROFILE_PREF = 'geoApp.chat.behaviorProfile.workflow.checker';
export const GEOAPP_CHAT_BEHAVIOR_HIDDEN_CONTENT_PROFILE_PREF = 'geoApp.chat.behaviorProfile.workflow.hiddenContent';
export const GEOAPP_CHAT_BEHAVIOR_IMAGE_PUZZLE_PROFILE_PREF = 'geoApp.chat.behaviorProfile.workflow.imagePuzzle';
export const GEOAPP_CHAT_PROMPT_PACK_PREF = 'geoApp.chat.promptPack';
export const GEOAPP_CHAT_TOOL_POLICY_OVERRIDES_PREF = 'geoApp.chat.toolPolicy.overrides';
export const GEOAPP_CHAT_SKILL_PACK_PREF = 'geoApp.chat.skillPack';
export const GEOAPP_CHAT_SKILL_POLICY_OVERRIDES_PREF = 'geoApp.chat.skillPolicy.overrides';

export type GeoAppChatProfile = 'local' | 'fast' | 'strong' | 'web';
export type GeoAppChatWorkflowProfile = 'default' | GeoAppChatProfile;
export type GeoAppChatWorkflowKind = 'general' | 'secret_code' | 'formula' | 'checker' | 'hidden_content' | 'image_puzzle';
export type GeoAppChatBehaviorProfile = 'guided' | 'safe' | 'offline' | 'automation' | 'debug';
export type GeoAppChatWorkflowBehaviorProfile = 'default' | GeoAppChatBehaviorProfile;
export type GeoAppChatSessionKind = 'auto' | 'libre' | 'earthcoach';
export type GeoAppChatSkillPack = 'workflow' | 'minimal' | 'full' | 'disabled';
export type GeoAppChatImageOrigin = 'cache_listing' | 'user_observation' | 'educational_reference';

export interface GeoAppChatImageContext {
    url: string;
    origin: GeoAppChatImageOrigin;
    id?: string;
    label?: string;
    description?: string;
}

export const GeoAppChatAgentIdsByProfile: Record<GeoAppChatProfile, string> = {
    local: GeoAppChatLocalAgentId,
    fast: GeoAppChatFastAgentId,
    strong: GeoAppChatStrongAgentId,
    web: GeoAppChatWebAgentId,
};

export interface GeoAppChatPreset {
    id: string;
    label: string;
    description: string;
    behavior: GeoAppChatBehaviorProfile;
    promptPack: GeoAppChatBehaviorProfile;
    skillPack: GeoAppChatSkillPack;
}

// Presets combines : reglent d'un clic les trois axes (profil comportemental par
// defaut, prompt pack, skill pack). Partages entre la vue Policy et le tool IA
// `aide_apply_chat_preset`.
export const GEOAPP_CHAT_PRESET_OPTIONS: GeoAppChatPreset[] = [
    { id: 'discovery', label: 'Découverte', description: 'Aide active, confirmation sur les actions sensibles.', behavior: 'guided', promptPack: 'guided', skillPack: 'workflow' },
    { id: 'autonomous', label: 'Autonome', description: 'Exécute davantage d\'étapes, toutes les skills exposées.', behavior: 'automation', promptPack: 'automation', skillPack: 'full' },
    { id: 'cautious', label: 'Prudent', description: 'Peu d\'automatisation, skills essentielles seulement.', behavior: 'safe', promptPack: 'safe', skillPack: 'minimal' },
    { id: 'offline', label: 'Hors-ligne', description: 'Aucun réseau ni checker, calculs locaux.', behavior: 'offline', promptPack: 'offline', skillPack: 'minimal' },
];

export interface GeoAppChatPreferenceValues {
    [GEOAPP_CHAT_DEFAULT_PROFILE_PREF]?: unknown;
    [GEOAPP_CHAT_SECRET_CODE_PROFILE_PREF]?: unknown;
    [GEOAPP_CHAT_FORMULA_PROFILE_PREF]?: unknown;
    [GEOAPP_CHAT_CHECKER_PROFILE_PREF]?: unknown;
    [GEOAPP_CHAT_HIDDEN_CONTENT_PROFILE_PREF]?: unknown;
    [GEOAPP_CHAT_IMAGE_PUZZLE_PROFILE_PREF]?: unknown;
}

export interface GeoAppChatBehaviorPreferenceValues {
    [GEOAPP_CHAT_BEHAVIOR_DEFAULT_PROFILE_PREF]?: unknown;
    [GEOAPP_CHAT_BEHAVIOR_SECRET_CODE_PROFILE_PREF]?: unknown;
    [GEOAPP_CHAT_BEHAVIOR_FORMULA_PROFILE_PREF]?: unknown;
    [GEOAPP_CHAT_BEHAVIOR_CHECKER_PROFILE_PREF]?: unknown;
    [GEOAPP_CHAT_BEHAVIOR_HIDDEN_CONTENT_PROFILE_PREF]?: unknown;
    [GEOAPP_CHAT_BEHAVIOR_IMAGE_PUZZLE_PROFILE_PREF]?: unknown;
}

export interface GeoAppAgentLike {
    id?: string;
    name?: string;
}

export interface GeoAppListingClassificationPreview {
    labels?: Array<{ name: string; confidence?: number }>;
}

export interface GeoAppWorkflowResolutionPreview {
    workflow?: { kind?: string };
    classification?: GeoAppListingClassificationPreview;
}

export interface GeoAppOpenChatRequestDetailPayload {
    geocacheId?: number;
    gcCode?: string;
    geocacheName?: string;
    sessionTitle?: string;
    prompt?: string;
    imageUrls?: string[];
    imageContexts?: GeoAppChatImageContext[];
    focus?: boolean;
    workflowKind?: GeoAppChatWorkflowKind | string;
    preferredProfile?: GeoAppChatWorkflowProfile | string;
    preferredBehaviorProfile?: GeoAppChatWorkflowBehaviorProfile | string;
    preferredAgentId?: string;
    earthcoachMode?: string;
    earthcoachVerbosity?: string;
    /** Langue choisie pour les reponses EarthCoach (code: fr, en, de...). */
    earthcoachResponseLanguage?: string;
    /**
     * Correlation d'une requete EarthCoach dossier terrain : propagee dans
     * l'evenement de fin de reponse pour que le Markdown soit attache a la
     * requete exacte, jamais a "la derniere preparee".
     */
    earthcoachRequestId?: string;
    /**
     * Qualite de reencodage des images transmises. `high` pour les flux ou le
     * modele doit lire de petits details (EarthCoach); defaut `standard`.
     */
    imageQuality?: GeoAppChatImageQuality;
    resumeState?: Record<string, unknown>;
    sessionKind?: GeoAppChatSessionKind;
}

export const GEOAPP_OPEN_CHAT_REQUEST_EVENT = 'geoapp-open-chat-request';

/** Long cote cible pour les images envoyees au modele : optimum tokens/qualite pour la vision. */
export const GEOAPP_CHAT_IMAGE_MAX_DIMENSION = 1568;

export type GeoAppChatImageQuality = 'standard' | 'high';

/**
 * La taille de l'image fixe le cout en tokens, pas son poids : monter la
 * qualite JPEG ne coute rien cote modele et evite que les artefacts de
 * compression effacent les textures fines (grain, strates, fossiles).
 */
export function geoAppChatJpegQuality(quality?: GeoAppChatImageQuality): number {
    return quality === 'high' ? 0.95 : 0.85;
}

export interface GeoAppPreparedChatImage {
    data: string;
    mimeType: string;
}

/**
 * Decode puis reencode l'image comme le bridge l'envoie au modele. Cette
 * operation retire les metadonnees EXIF, meme sans redimensionnement.
 */
export async function encodeGeoAppChatImage(
    blob: Blob,
    options: { maxDimension?: number; quality?: GeoAppChatImageQuality } = {}
): Promise<GeoAppPreparedChatImage> {
    const maxDimension = options.maxDimension ?? GEOAPP_CHAT_IMAGE_MAX_DIMENSION;
    const image = await loadGeoAppChatImageSource(blob);
    try {
        const largestSide = Math.max(image.width, image.height);
        if (!largestSide) {
            throw new Error('Invalid image dimensions');
        }
        const scale = Math.min(1, maxDimension / largestSide);
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        const context = canvas.getContext('2d');
        if (!context) {
            throw new Error('Canvas is unavailable');
        }
        if (scale < 1) {
            context.imageSmoothingQuality = 'high';
        }
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        const preserveTransparency = blob.type === 'image/png';
        const mimeType = preserveTransparency ? 'image/png' : 'image/jpeg';
        const dataUrl = canvas.toDataURL(mimeType, preserveTransparency ? undefined : geoAppChatJpegQuality(options.quality));
        return { data: dataUrl.substring(dataUrl.indexOf(',') + 1), mimeType };
    } finally {
        if ('close' in image && typeof image.close === 'function') {
            image.close();
        }
    }
}

async function loadGeoAppChatImageSource(blob: Blob): Promise<CanvasImageSource & { width: number; height: number; close?: () => void }> {
    if (typeof createImageBitmap === 'function') {
        return await createImageBitmap(blob);
    }
    const objectUrl = URL.createObjectURL(blob);
    try {
        return await new Promise<HTMLImageElement>((resolve, reject) => {
            const image = new Image();
            image.onload = () => resolve(image);
            image.onerror = () => reject(new Error('image illisible par le navigateur'));
            image.src = objectUrl;
        });
    } finally {
        URL.revokeObjectURL(objectUrl);
    }
}

const PREPARED_CHAT_IMAGE_TTL_MS = 5 * 60 * 1000;
const PREPARED_CHAT_IMAGE_MAX_ENTRIES = 40;
const preparedChatImages = new Map<string, { image: GeoAppPreparedChatImage; expiresAt: number }>();

function preparedChatImageKey(url: string, quality?: GeoAppChatImageQuality): string {
    return `${url}|${quality || 'standard'}`;
}

/**
 * Un appelant qui a deja telecharge et encode une image (le dossier terrain
 * EarthCoach, pour la valider) la depose ici : le bridge la reprend au lieu
 * de la telecharger et de la decoder une seconde fois.
 */
export function rememberPreparedGeoAppChatImage(
    url: string,
    quality: GeoAppChatImageQuality | undefined,
    image: GeoAppPreparedChatImage,
    now = Date.now()
): void {
    const key = preparedChatImageKey(url, quality);
    preparedChatImages.delete(key);
    preparedChatImages.set(key, { image, expiresAt: now + PREPARED_CHAT_IMAGE_TTL_MS });
    while (preparedChatImages.size > PREPARED_CHAT_IMAGE_MAX_ENTRIES) {
        const oldest = preparedChatImages.keys().next().value;
        if (oldest === undefined) {
            break;
        }
        preparedChatImages.delete(oldest);
    }
}

/** Lecture qui consomme l'entree : on ne garde pas des Mo de base64 en memoire. */
export function takePreparedGeoAppChatImage(
    url: string,
    quality: GeoAppChatImageQuality | undefined,
    now = Date.now()
): GeoAppPreparedChatImage | undefined {
    const key = preparedChatImageKey(url, quality);
    const entry = preparedChatImages.get(key);
    if (!entry) {
        return undefined;
    }
    preparedChatImages.delete(key);
    return entry.expiresAt > now ? entry.image : undefined;
}

/** Reserve aux tests. */
export function clearPreparedGeoAppChatImages(): void {
    preparedChatImages.clear();
}

/**
 * Emis par le bridge apres preparation des images, juste avant l'envoi au
 * modele. Le dossier terrain EarthCoach s'en sert pour corriger l'instantane
 * enregistre: une image qui echoue au decodage/reencodage final n'a jamais ete
 * vue par le modele et ne doit pas y figurer comme transmise.
 */
export const GEOAPP_CHAT_IMAGES_TRANSMITTED_EVENT = 'geoapp-chat-images-transmitted';

export interface GeoAppChatImagesTransmittedDetail {
    /** Correlation dossier EarthCoach, si la requete en portait un. */
    requestId?: string;
    /** Ids des images converties en variables du modele. */
    transmittedIds: string[];
    /** Ids des images abandonnees a la derniere etape. */
    failedIds: string[];
    /** Libelles lisibles des echecs (pour messages et instantane). */
    failedLabels: string[];
}

/**
 * Verifie que le navigateur sait decoder l'image, comme le fera le bridge au
 * moment de l'envoi (decodage puis reencodage canvas). Un blob dont le
 * Content-Type est image/* peut etre indechiffrable (HEIC, fichier tronque):
 * tester le decodage en amont evite de la declarer transmissible a tort.
 * En environnement sans DOM (tests Node), on ne peut pas verifier: on passe.
 */
export async function decodeGeoAppChatImage(blob: Blob): Promise<void> {
    if (typeof createImageBitmap === 'function') {
        const bitmap = await createImageBitmap(blob);
        bitmap.close();
        return;
    }
    if (typeof Image === 'undefined' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
        return;
    }
    const objectUrl = URL.createObjectURL(blob);
    try {
        await new Promise<void>((resolve, reject) => {
            const image = new Image();
            image.onload = () => resolve();
            image.onerror = () => reject(new Error('image illisible par le navigateur'));
            image.src = objectUrl;
        });
    } finally {
        URL.revokeObjectURL(objectUrl);
    }
}

export interface GeoAppOpenChatEventTarget {
    dispatchEvent(event: unknown): boolean | void;
}

export type GeoAppCustomEventConstructor = new <T>(type: string, init: { detail: T }) => {
    type: string;
    detail: T;
};

const GEOAPP_SESSION_SETTING_KEYS = new Set([
    'geoappWorkflowKind',
    'geoappPreferredProfile',
    'geoappResumeState',
    'geoappGcCode',
    'geoappGeocacheId',
    'geoappSessionKind',
    'geoappBehaviorProfile',
]);

export function normalizeGeoAppChatWorkflowKind(value?: string): GeoAppChatWorkflowKind | undefined {
    if (
        value === 'general' ||
        value === 'secret_code' ||
        value === 'formula' ||
        value === 'checker' ||
        value === 'hidden_content' ||
        value === 'image_puzzle'
    ) {
        return value;
    }
    return undefined;
}

export function normalizeGeoAppChatProfile(value?: unknown): GeoAppChatProfile | undefined {
    if (value === 'local' || value === 'fast' || value === 'strong' || value === 'web') {
        return value;
    }
    return undefined;
}

export function normalizeGeoAppChatWorkflowProfile(value?: unknown): GeoAppChatWorkflowProfile | undefined {
    if (value === 'default' || value === 'local' || value === 'fast' || value === 'strong' || value === 'web') {
        return value;
    }
    return undefined;
}

export function normalizeGeoAppChatBehaviorProfile(value?: unknown): GeoAppChatBehaviorProfile | undefined {
    if (value === 'guided' || value === 'safe' || value === 'offline' || value === 'automation' || value === 'debug') {
        return value;
    }
    return undefined;
}

export function normalizeGeoAppChatWorkflowBehaviorProfile(value?: unknown): GeoAppChatWorkflowBehaviorProfile | undefined {
    if (value === 'default' || value === 'guided' || value === 'safe' || value === 'offline' || value === 'automation' || value === 'debug') {
        return value;
    }
    return undefined;
}

export function resolveGeoAppChatProfileForWorkflow(
    workflowKind: string | undefined,
    preferredProfile: string | undefined,
    preferences: GeoAppChatPreferenceValues = {}
): GeoAppChatProfile {
    const explicit = normalizeGeoAppChatWorkflowProfile(preferredProfile);
    if (explicit && explicit !== 'default') {
        return explicit;
    }

    const defaultProfile = normalizeGeoAppChatProfile(preferences[GEOAPP_CHAT_DEFAULT_PROFILE_PREF]) || 'fast';
    const normalizedWorkflowKind = normalizeGeoAppChatWorkflowKind(workflowKind);
    if (!normalizedWorkflowKind || normalizedWorkflowKind === 'general') {
        return defaultProfile;
    }

    const workflowPreferenceKey = normalizedWorkflowKind === 'secret_code'
        ? GEOAPP_CHAT_SECRET_CODE_PROFILE_PREF
        : normalizedWorkflowKind === 'formula'
            ? GEOAPP_CHAT_FORMULA_PROFILE_PREF
            : normalizedWorkflowKind === 'checker'
                ? GEOAPP_CHAT_CHECKER_PROFILE_PREF
                : normalizedWorkflowKind === 'hidden_content'
                    ? GEOAPP_CHAT_HIDDEN_CONTENT_PROFILE_PREF
                    : GEOAPP_CHAT_IMAGE_PUZZLE_PROFILE_PREF;

    const workflowProfile = normalizeGeoAppChatWorkflowProfile(preferences[workflowPreferenceKey]);
    if (!workflowProfile || workflowProfile === 'default') {
        return defaultProfile;
    }

    return workflowProfile;
}

export function resolveGeoAppChatBehaviorProfileForWorkflow(
    workflowKind: string | undefined,
    preferredProfile: string | undefined,
    preferences: GeoAppChatBehaviorPreferenceValues = {}
): GeoAppChatBehaviorProfile {
    const explicit = normalizeGeoAppChatWorkflowBehaviorProfile(preferredProfile);
    if (explicit && explicit !== 'default') {
        return explicit;
    }

    const defaultProfile = normalizeGeoAppChatBehaviorProfile(preferences[GEOAPP_CHAT_BEHAVIOR_DEFAULT_PROFILE_PREF]) || 'guided';
    const normalizedWorkflowKind = normalizeGeoAppChatWorkflowKind(workflowKind);
    if (!normalizedWorkflowKind || normalizedWorkflowKind === 'general') {
        return defaultProfile;
    }

    const workflowPreferenceKey = normalizedWorkflowKind === 'secret_code'
        ? GEOAPP_CHAT_BEHAVIOR_SECRET_CODE_PROFILE_PREF
        : normalizedWorkflowKind === 'formula'
            ? GEOAPP_CHAT_BEHAVIOR_FORMULA_PROFILE_PREF
            : normalizedWorkflowKind === 'checker'
                ? GEOAPP_CHAT_BEHAVIOR_CHECKER_PROFILE_PREF
                : normalizedWorkflowKind === 'hidden_content'
                    ? GEOAPP_CHAT_BEHAVIOR_HIDDEN_CONTENT_PROFILE_PREF
                    : GEOAPP_CHAT_BEHAVIOR_IMAGE_PUZZLE_PROFILE_PREF;

    const workflowProfile = normalizeGeoAppChatWorkflowBehaviorProfile(preferences[workflowPreferenceKey]);
    if (!workflowProfile || workflowProfile === 'default') {
        return defaultProfile;
    }

    return workflowProfile;
}

export function getGeoAppAgentSessionLabel(agent?: GeoAppAgentLike): string | undefined {
    const id = (agent?.id || '').toLowerCase();
    if (!id) {
        return undefined;
    }
    if (id === GeoAppChatLocalAgentId) {
        return 'Local';
    }
    if (id === GeoAppChatFastAgentId) {
        return 'Fast';
    }
    if (id === GeoAppChatStrongAgentId) {
        return 'Strong';
    }
    if (id === GeoAppChatWebAgentId) {
        return 'Web';
    }
    if (id === GeoAppChatAgentId.toLowerCase()) {
        return 'GeoApp';
    }
    return agent?.name || agent?.id;
}

export function buildGeoAppChatDisplaySessionTitle(baseSessionTitle: string, agent?: GeoAppAgentLike): string {
    const agentLabel = getGeoAppAgentSessionLabel(agent);
    return agentLabel ? `${baseSessionTitle} [${agentLabel}]` : baseSessionTitle;
}

export function buildGeoAppBaseSessionTitle(gcCode?: string, geocacheName?: string, explicitTitle?: string): string {
    const normalizedExplicitTitle = (explicitTitle || '').trim();
    if (normalizedExplicitTitle) {
        return normalizedExplicitTitle;
    }
    return `CHAT IA - ${gcCode || geocacheName || 'GeoApp'}`;
}

export function buildGeoAppResumeStateBlock(resumeState?: Record<string, unknown>): string | undefined {
    if (!resumeState || typeof resumeState !== 'object' || Object.keys(resumeState).length === 0) {
        return undefined;
    }

    try {
        return `\`\`\`json\n${JSON.stringify(resumeState, null, 2)}\n\`\`\``;
    } catch {
        return undefined;
    }
}

export function buildGeoAppChatPrompt(basePrompt?: string, resumeState?: Record<string, unknown>): string {
    const normalizedPrompt = (basePrompt || '').trim();
    const resumeStateBlock = buildGeoAppResumeStateBlock(resumeState);
    if (!resumeStateBlock) {
        return normalizedPrompt;
    }

    const parts: string[] = [];
    if (normalizedPrompt) {
        parts.push(normalizedPrompt, '');
    }
    parts.push(
        'RESUME_STATE_JSON',
        resumeStateBlock,
        '',
        'Utilise ce resume_state comme état de reprise prioritaire du workflow courant. Si son contenu contredit un résumé textuel plus haut, privilégie ce JSON structuré.'
    );
    return parts.join('\n');
}

export function resolveGeoAppChatWorkflowKindFromClassification(
    classification?: GeoAppListingClassificationPreview
): GeoAppChatWorkflowKind {
    const labelNames = new Set((classification?.labels || []).map(label => label.name));
    if (labelNames.has('formula')) {
        return 'formula';
    }
    if (labelNames.has('image_puzzle')) {
        return 'image_puzzle';
    }
    if (labelNames.has('hidden_content') && !labelNames.has('secret_code')) {
        return 'hidden_content';
    }
    if (labelNames.has('checker_available') && !labelNames.has('secret_code')) {
        return 'checker';
    }
    if (labelNames.has('secret_code')) {
        return 'secret_code';
    }
    return 'general';
}

export function resolveGeoAppChatWorkflowKindFromOrchestrator(
    preview?: GeoAppWorkflowResolutionPreview
): GeoAppChatWorkflowKind {
    const workflowKind = preview?.workflow?.kind;
    if (workflowKind === 'formula') {
        return 'formula';
    }
    if (workflowKind === 'secret_code') {
        return 'secret_code';
    }
    if (workflowKind === 'checker') {
        return 'checker';
    }
    if (workflowKind === 'hidden_content') {
        return 'hidden_content';
    }
    if (workflowKind === 'image_puzzle') {
        return 'image_puzzle';
    }
    if (workflowKind === 'coord_transform') {
        return 'formula';
    }
    return resolveGeoAppChatWorkflowKindFromClassification(preview?.classification);
}

export function buildGeoAppOpenChatRequestDetail(
    detail: GeoAppOpenChatRequestDetailPayload
): GeoAppOpenChatRequestDetailPayload {
    return {
        geocacheId: detail.geocacheId,
        gcCode: detail.gcCode,
        geocacheName: detail.geocacheName,
        sessionTitle: buildGeoAppBaseSessionTitle(detail.gcCode, detail.geocacheName, detail.sessionTitle),
        prompt: detail.prompt,
        imageContexts: detail.imageContexts?.length ? detail.imageContexts : undefined,
        imageUrls: detail.imageUrls?.length ? detail.imageUrls : undefined,
        focus: detail.focus !== false,
        workflowKind: detail.workflowKind,
        preferredProfile: detail.preferredProfile,
        preferredBehaviorProfile: detail.preferredBehaviorProfile,
        preferredAgentId: detail.preferredAgentId,
        earthcoachMode: detail.earthcoachMode,
        earthcoachVerbosity: detail.earthcoachVerbosity,
        earthcoachResponseLanguage: detail.earthcoachResponseLanguage,
        earthcoachRequestId: detail.earthcoachRequestId,
        imageQuality: detail.imageQuality,
        resumeState: detail.resumeState,
        sessionKind: detail.sessionKind,
    };
}

export function dispatchGeoAppOpenChatRequest(
    eventTarget: GeoAppOpenChatEventTarget,
    customEventConstructor: GeoAppCustomEventConstructor,
    detail: GeoAppOpenChatRequestDetailPayload
): void {
    eventTarget.dispatchEvent(new customEventConstructor(
        GEOAPP_OPEN_CHAT_REQUEST_EVENT,
        { detail: buildGeoAppOpenChatRequestDetail(detail) }
    ));
}

export function sanitizeGeoAppSessionSettings(
    settings?: { [key: string]: unknown }
): { [key: string]: unknown } {
    const safeSettings: { [key: string]: unknown } = {};
    for (const [key, value] of Object.entries(settings || {})) {
        if (!GEOAPP_SESSION_SETTING_KEYS.has(key)) {
            safeSettings[key] = value;
        }
    }
    return safeSettings;
}

/**
 * Point d'extension : être prévenu qu'une réponse du chat GeoApp est terminée.
 *
 * Le bridge sait ouvrir une session et attendre sa réponse ; il n'a pas à savoir ce qu'on
 * veut en faire. L'analyse de sortie s'en sert pour repêcher le bloc JSON de plan quand le
 * modèle n'a pas appelé le tool de capture — un besoin qui n'a aucune raison de figurer
 * dans un module de plomberie de chat, et qui ne sera pas le dernier du genre.
 *
 * Un observateur qui lève ne doit pas casser l'ouverture de session : le bridge isole
 * chaque appel.
 */
export const GeoAppChatResponseObserver = Symbol('GeoAppChatResponseObserver');

export interface GeoAppChatResponseEvent {
    sessionId: string;
    /** Titre de base, sans le suffixe d'agent ajouté à l'affichage. */
    sessionTitle: string;
    agentId?: string;
    /** Identifiant de correlation fourni par le dispatch (ex. dossier EarthCoach), s'il existe. */
    requestId?: string;
    /** Texte complet de la réponse, tel qu'il s'affiche dans la conversation. */
    text: string;
}

export interface GeoAppChatResponseObserver {
    handleChatResponse(event: GeoAppChatResponseEvent): void | Promise<void>;
}
