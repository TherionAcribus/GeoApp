/**
 * Tool Functions pour l'exécution automatisée des checkers (Certitude, Geocaching, etc.).
 */

import { injectable, inject } from '@theia/core/shared/inversify';
import { MessageService } from '@theia/core';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { PreferenceService } from '@theia/core/lib/common/preferences/preference-service';
import {
    ToolInvocationRegistry,
    ToolRequest,
    ToolRequestParameters,
    ToolRequestParametersProperties,
    ToolCallResult
} from '@theia/ai-core';

@injectable()
export class CheckerToolsManager implements FrontendApplicationContribution {

    static readonly PROVIDER_NAME = 'geoapp.checkers';

    @inject(ToolInvocationRegistry)
    protected readonly toolRegistry!: ToolInvocationRegistry;

    @inject(MessageService)
    protected readonly messages!: MessageService;

    @inject(PreferenceService)
    protected readonly preferenceService!: PreferenceService;

    async onStart(): Promise<void> {
        console.log('[CHECKERS-TOOLS] Enregistrement des tools IA...');
        await this.registerTools();
        console.log('[CHECKERS-TOOLS] Tools IA enregistrés avec succès');
    }

    private async registerTools(): Promise<void> {
        const tools: ToolRequest[] = [
            this.createRunCheckerTool(),
            this.createEnsureSessionTool(),
            this.createLoginSessionTool(),
            this.createResetSessionTool()
        ];

        for (const tool of tools) {
            try {
                await this.toolRegistry.registerTool(tool);
                console.log(`[CHECKERS-TOOLS] Tool enregistré: ${tool.name}`);
            } catch (error) {
                console.error(`[CHECKERS-TOOLS] Erreur enregistrement tool ${tool.name}:`, error);
            }
        }
    }

    private async loginSession(params: {
        backendBaseUrl: string;
        provider: string;
        wp?: string;
        timeoutSec: number;
    }): Promise<{ provider: string; logged_in: boolean } | { error: string }> {
        try {
            const res = await fetch(`${params.backendBaseUrl}/api/checkers/session/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    provider: params.provider,
                    wp: params.wp,
                    timeout_sec: params.timeoutSec
                })
            });

            const data = await res.json();
            if (!res.ok || data.status === 'error') {
                return { error: data.error || `HTTP ${res.status}` };
            }

            return { provider: data.provider, logged_in: Boolean(data.logged_in) };
        } catch (error: any) {
            return { error: error?.message || 'Unable to login checker session' };
        }
    }

    private createRunCheckerTool(): ToolRequest {
        return {
            id: 'geoapp.checkers.run',
            name: 'run_checker',
            description: 'Exécute un checker externe en remplissant le champ et en détectant succès/échec. Pour Certitude (certitudes.org) et le checker intégré Geocaching.com, un mode interactif est utilisé (fenêtre Playwright + action manuelle/captcha possible).',
            providerName: CheckerToolsManager.PROVIDER_NAME,
            parameters: this.buildParameters({
                geocache_id: {
                    type: 'number',
                    description: 'Optionnel: id de la géocache (recommandé). Si fourni, GeoApp résout automatiquement le bon checker en base et reconstruit l\'URL si nécessaire.',
                    required: false
                },
                gc_code: {
                    type: 'string',
                    description: 'Optionnel: code GC (ex: "GCAWZA2"). Utilisé pour résoudre une géocache et reconstruire certains checkers (ex: #solution-checker).',
                    required: false
                },
                zone_id: {
                    type: 'number',
                    description: 'Optionnel: id de zone (utile si plusieurs géocaches partagent le même gc_code).',
                    required: false
                },
                url: {
                    type: 'string',
                    description: 'Optionnel: URL du checker à ouvrir (mode legacy). Si geocache_id ou gc_code est fourni, url est résolu automatiquement.',
                    required: false
                },
                wp: {
                    type: 'string',
                    description: 'Optionnel: code waypoint GC (ex: "GCAWZA2"). Utile pour Certitude si l\'URL ne contient pas ?wp=...',
                    required: false
                },
                candidate: {
                    type: 'string',
                    description: 'Réponse candidate à tester (texte)',
                    required: true
                },
                auto_login: {
                    type: 'boolean',
                    description: 'Optionnel: pour Geocaching.com, déclenche automatiquement la fenêtre de login si la session n\'est pas authentifiée. Défaut: true.',
                    required: false
                },
                login_timeout_sec: {
                    type: 'number',
                    description: 'Optionnel: durée max (secondes) pour se connecter lors de l\'auto-login Geocaching.com. Défaut: 180.',
                    required: false
                },
                timeout_sec: {
                    type: 'number',
                    description: 'Optionnel: durée max (secondes) pour les checkers interactifs (ex: Certitude).',
                    required: false
                }
            }),
            handler: async (argString: string) => this.handleRunChecker(argString)
        };
    }

    private createEnsureSessionTool(): ToolRequest {
        return {
            id: 'geoapp.checkers.session.ensure',
            name: 'ensure_checker_session',
            description: 'Vérifie si une session authentifiée est disponible (ex: Geocaching.com).',
            providerName: CheckerToolsManager.PROVIDER_NAME,
            parameters: this.buildParameters({
                provider: {
                    type: 'string',
                    description: 'Provider (ex: "geocaching")',
                    required: true
                },
                wp: {
                    type: 'string',
                    description: 'Optionnel: code waypoint (ex: "GCAWZA2") pour certains providers (certitudes).',
                    required: false
                }
            }),
            handler: async (argString: string) => this.handleEnsureSession(argString)
        };
    }

    private createLoginSessionTool(): ToolRequest {
        return {
            id: 'geoapp.checkers.session.login',
            name: 'login_checker_session',
            description: 'Ouvre une fenêtre Chromium (Playwright) pour se connecter à un provider (ex: Geocaching.com) et sauvegarde la session dans le profil GeoApp.',
            providerName: CheckerToolsManager.PROVIDER_NAME,
            parameters: this.buildParameters({
                provider: {
                    type: 'string',
                    description: 'Provider (ex: "geocaching")',
                    required: true
                },
                wp: {
                    type: 'string',
                    description: 'Optionnel: code waypoint (ex: "GCAWZA2") pour certains providers (certitudes).',
                    required: false
                },
                timeout_sec: {
                    type: 'number',
                    description: 'Durée max (secondes) pour laisser le temps de se connecter',
                    required: false
                }
            }),
            handler: async (argString: string) => this.handleLoginSession(argString)
        };
    }

    private createResetSessionTool(): ToolRequest {
        return {
            id: 'geoapp.checkers.session.reset',
            name: 'reset_checker_session',
            description: 'Réinitialise le profil Playwright GeoApp (supprime cookies/session).',
            providerName: CheckerToolsManager.PROVIDER_NAME,
            parameters: this.buildParameters({
                confirm: {
                    type: 'boolean',
                    description: 'Doit être true pour confirmer la suppression',
                    required: true
                }
            }),
            handler: async (argString: string) => this.handleResetSession(argString)
        };
    }

    private async handleRunChecker(argString: string): Promise<ToolCallResult> {
        if (!(this.preferenceService.get('geoApp.checkers.enabled', true) as boolean)) {
            return { error: 'Checker automation is disabled by preferences.' };
        }

        try {
            const requestId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
            const start = performance.now();
            const args = JSON.parse(argString);
            let url = typeof args.url === 'string' ? (args.url as string) : '';
            const candidate = args.candidate as string;
            const explicitWp = typeof args.wp === 'string' ? args.wp.trim() : undefined;
            const geocacheId = typeof args.geocache_id === 'number' ? args.geocache_id : undefined;
            const gcCodeArg = typeof args.gc_code === 'string' ? (args.gc_code as string).trim() : undefined;
            const zoneIdArg = typeof args.zone_id === 'number' ? args.zone_id : undefined;
            const autoLogin = args.auto_login === undefined ? true : Boolean(args.auto_login);
            const loginTimeoutSec = typeof args.login_timeout_sec === 'number' ? args.login_timeout_sec : 180;
            const timeoutSec = typeof args.timeout_sec === 'number' ? args.timeout_sec : 300;

            const backendBaseUrl = this.getBackendBaseUrl();

            const resolved = await this.resolveCheckerTarget({
                backendBaseUrl,
                geocacheId,
                gcCode: gcCodeArg,
                zoneId: zoneIdArg,
                url,
                wp: explicitWp
            });
            if ('error' in resolved) {
                return { error: resolved.error };
            }
            url = resolved.url;
            const wp = resolved.wp;

            console.log('[CHECKERS-TOOLS] run_checker:start', {
                requestId,
                url,
                isCertitudes: this.isCertitudesUrl(url),
                isGeocaching: this.isGeocachingUrl(url),
                timeoutSec
            });

            const normalizedGeocaching = this.normalizeGeocachingUrl(url, wp);
            if ('error' in normalizedGeocaching) {
                return { error: normalizedGeocaching.error };
            }
            if (normalizedGeocaching.url !== url) {
                console.log('[CHECKERS-TOOLS] run_checker:normalized-geocaching-url', {
                    requestId,
                    from: url,
                    to: normalizedGeocaching.url
                });
                url = normalizedGeocaching.url;
            }

            const isCertitudes = this.isCertitudesUrl(url);
            const isGeocaching = this.isGeocachingUrl(url);

            if (isCertitudes) {
                const normalized = this.normalizeCertitudesUrl(url, wp);
                if ('error' in normalized) {
                    return { error: normalized.error };
                }
                if (normalized.url !== url) {
                    console.log('[CHECKERS-TOOLS] run_checker:normalized-url', {
                        requestId,
                        from: url,
                        to: normalized.url
                    });
                    url = normalized.url;
                }
            }
            if (isCertitudes) {
                void this.messages.info(
                    'Certitude nécessite une validation manuelle (Cloudflare/Turnstile). Une fenêtre Chromium va s\'ouvrir : cliquez sur “Certifier”, puis revenez ici.'
                );
            }

            if (isGeocaching) {
                void this.messages.info(
                    'Geocaching.com: le “Solution Checker” peut nécessiter une session + un reCAPTCHA. Si besoin, utilisez d\'abord ensure_checker_session(provider="geocaching") puis login_checker_session(provider="geocaching"). Une fenêtre Chromium peut s\'ouvrir : résolvez le captcha puis cliquez sur “Check Solution”.'
                );
            }

            if (isGeocaching) {
                let ensureResult = await this.ensureSession({
                    backendBaseUrl,
                    provider: 'geocaching',
                    wp
                });

                if ('error' in ensureResult) {
                    return { error: ensureResult.error };
                }

                if (!ensureResult.logged_in && autoLogin) {
                    const loginResult = await this.loginSession({
                        backendBaseUrl,
                        provider: 'geocaching',
                        wp,
                        timeoutSec: loginTimeoutSec
                    });

                    if ('error' in loginResult) {
                        return { error: loginResult.error };
                    }

                    ensureResult = await this.ensureSession({
                        backendBaseUrl,
                        provider: 'geocaching',
                        wp
                    });
                    if ('error' in ensureResult) {
                        return { error: ensureResult.error };
                    }
                }

                if (!ensureResult.logged_in) {
                    return JSON.stringify(
                        {
                            status: 'requires_login',
                            provider: 'geocaching',
                            logged_in: false,
                            message: autoLogin
                                ? 'Geocaching.com session is still not logged in after auto-login attempt. Run login_checker_session(provider="geocaching") then retry run_checker.'
                                : 'Geocaching.com session is not logged in. Call login_checker_session(provider="geocaching") then retry run_checker.'
                        },
                        null,
                        2
                    );
                }
            }

            const isInteractive = isCertitudes || isGeocaching;
            const endpoint = isInteractive ? '/api/checkers/run-interactive' : '/api/checkers/run';
            const body: any = {
                url,
                input: { candidate }
            };
            if (isInteractive) {
                body.timeout_sec = timeoutSec;
            }

            const fetchTimeoutMs = (isInteractive ? timeoutSec : 60) * 1000 + 10000;
            const controller = new AbortController();
            const timeoutHandle = window.setTimeout(() => controller.abort(), fetchTimeoutMs);

            console.log('[CHECKERS-TOOLS] run_checker:fetch', {
                requestId,
                endpoint,
                backendBaseUrl,
                fetchTimeoutMs
            });

            let res: Response;
            try {
                res = await fetch(`${backendBaseUrl}${endpoint}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify(body),
                    signal: controller.signal
                });
            } finally {
                window.clearTimeout(timeoutHandle);
            }

            const rawText = await res.text();
            let data: any;
            try {
                data = rawText ? JSON.parse(rawText) : {};
            } catch (parseError) {
                console.error('[CHECKERS-TOOLS] run_checker:invalid-json', {
                    requestId,
                    status: res.status,
                    rawText: rawText?.slice(0, 2000)
                });
                return { error: `Invalid JSON response (HTTP ${res.status})` };
            }

            console.log('[CHECKERS-TOOLS] run_checker:response', {
                requestId,
                status: res.status,
                ok: res.ok,
                dataStatus: data?.status
            });
            if (!res.ok || data.status === 'error') {
                console.error('[CHECKERS-TOOLS] run_checker:error', {
                    requestId,
                    status: res.status,
                    data
                });
                return { error: data.error || `HTTP ${res.status}` };
            }

            if (isCertitudes) {
                void this.messages.info('Certitude: résultat récupéré depuis la fenêtre interactive.');
            }

            if (isGeocaching) {
                void this.messages.info('Geocaching.com: résultat récupéré depuis la fenêtre interactive.');
            }

            console.log('[CHECKERS-TOOLS] run_checker:done', {
                requestId,
                durationMs: Math.round(performance.now() - start)
            });

            return JSON.stringify(data.result, null, 2);
        } catch (error: any) {
            console.error('[CHECKERS-TOOLS] Erreur run_checker:', error);
            return { error: error.message || 'Erreur run_checker' };
        }
    }

    private async resolveCheckerTarget(params: {
        backendBaseUrl: string;
        geocacheId?: number;
        gcCode?: string;
        zoneId?: number;
        url?: string;
        wp?: string;
    }): Promise<{ url: string; wp?: string } | { error: string }> {
        const inputUrl = (params.url || '').trim();
        const inputWp = (params.wp || '').trim();
        const inputGcCode = (params.gcCode || '').trim();

        if (inputUrl) {
            return { url: inputUrl, wp: inputWp || inputGcCode || undefined };
        }

        if (!params.geocacheId && !inputGcCode) {
            return { error: 'Missing url. Provide geocache_id (recommended), gc_code, or url.' };
        }

        let geocache: any;
        try {
            if (params.geocacheId) {
                const res = await fetch(`${params.backendBaseUrl}/api/geocaches/${params.geocacheId}`, {
                    method: 'GET',
                    credentials: 'include'
                });
                if (!res.ok) {
                    return { error: `Unable to fetch geocache ${params.geocacheId} (HTTP ${res.status})` };
                }
                geocache = await res.json();
            } else {
                const zoneQuery = typeof params.zoneId === 'number' ? `?zone_id=${encodeURIComponent(String(params.zoneId))}` : '';
                const res = await fetch(
                    `${params.backendBaseUrl}/api/geocaches/by-code/${encodeURIComponent(inputGcCode)}${zoneQuery}`,
                    { method: 'GET', credentials: 'include' }
                );
                if (!res.ok) {
                    return { error: `Unable to fetch geocache ${inputGcCode} (HTTP ${res.status})` };
                }
                geocache = await res.json();
            }
        } catch (e: any) {
            return { error: e?.message || 'Unable to fetch geocache details' };
        }

        const gcCode = (geocache?.gc_code || inputGcCode || '').toString().trim();
        const wp = inputWp || gcCode || undefined;

        const checkers: any[] = Array.isArray(geocache?.checkers) ? geocache.checkers : [];
        if (!checkers.length) {
            if (typeof geocache?.url === 'string' && geocache.url.trim()) {
                return { url: geocache.url.trim(), wp };
            }
            return { error: 'No checkers available for this geocache' };
        }

        const pick = (...predicates: Array<(c: any) => boolean>) => {
            for (const pred of predicates) {
                const found = checkers.find(pred);
                if (found) {
                    return found;
                }
            }
            return undefined;
        };

        const chosen = pick(
            c => (c?.url || '').toLowerCase().includes('certitudes.org'),
            c => (c?.name || '').toLowerCase().includes('certitude'),
            c => (c?.name || '').toLowerCase().includes('geocaching'),
            c => (c?.url || '').toLowerCase().includes('geocaching.com'),
            c => true
        );

        const chosenUrl = (chosen?.url || '').toString().trim();
        if (!chosenUrl) {
            return { error: 'Checker URL is missing for this geocache' };
        }
        return { url: chosenUrl, wp };
    }

    private async ensureSession(params: {
        backendBaseUrl: string;
        provider: string;
        wp?: string;
    }): Promise<{ provider: string; logged_in: boolean } | { error: string }> {
        try {
            const res = await fetch(`${params.backendBaseUrl}/api/checkers/session/ensure`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ provider: params.provider, wp: params.wp })
            });

            const data = await res.json();
            if (!res.ok || data.status === 'error') {
                return { error: data.error || `HTTP ${res.status}` };
            }

            return { provider: data.provider, logged_in: Boolean(data.logged_in) };
        } catch (error: any) {
            return { error: error?.message || 'Unable to ensure checker session' };
        }
    }

    private normalizeCertitudesUrl(url: string, wp?: string): { url: string } | { error: string } {
        if (!url || !url.trim()) {
            return { error: 'Missing url' };
        }

        const raw = url.trim();
        let parsed: URL;
        try {
            parsed = new URL(raw);
        } catch {
            try {
                parsed = new URL(`https://${raw}`);
            } catch {
                return { error: `Invalid url: ${url}` };
            }
        }

        const host = (parsed.hostname || '').toLowerCase();
        if (!host.endsWith('certitudes.org')) {
            return { url: parsed.toString() };
        }

        // Prefer the canonical host.
        parsed.hostname = 'www.certitudes.org';
        parsed.protocol = 'https:';

        // Prefer the canonical certitude path.
        const path = (parsed.pathname || '').toLowerCase();
        if (!path.includes('certitude')) {
            parsed.pathname = '/certitude';
        }

        // Ensure wp is present when provided.
        if (!parsed.searchParams.get('wp') && wp) {
            parsed.searchParams.set('wp', wp);
        }

        return { url: parsed.toString() };
    }

    private isCertitudesUrl(url: string): boolean {
        const raw = (url || '').toLowerCase();
        return raw.includes('certitudes.org') || raw.includes('www.certitudes.org');
    }

    private isGeocachingUrl(url: string): boolean {
        const raw = (url || '').toLowerCase();
        if (!raw.includes('geocaching.com')) {
            return false;
        }
        return raw.includes('/geocache/') || raw.includes('cache_details.aspx');
    }

    private normalizeGeocachingUrl(url: string, wp?: string): { url: string } | { error: string } {
        const raw = (url || '').trim();
        if (!raw) {
            return { error: 'Missing url' };
        }

        if (raw.startsWith('#') || raw === 'solution-checker' || raw === '#solution-checker') {
            if (!wp) {
                return { error: 'Invalid checker url (#solution-checker). Provide wp (GC code) to build a valid Geocaching URL.' };
            }
            return { url: `https://www.geocaching.com/geocache/${encodeURIComponent(wp)}` };
        }

        if (raw.toLowerCase().includes('/geocache/#solution-checker') || raw.toLowerCase().includes('/geocache/#')) {
            if (!wp) {
                return { error: 'Geocaching checker url is missing the GC code. Provide wp (GC code) to build a valid Geocaching URL.' };
            }
            return { url: `https://www.geocaching.com/geocache/${encodeURIComponent(wp)}` };
        }

        if (raw.startsWith('/')) {
            return { url: `https://www.geocaching.com${raw}` };
        }

        try {
            // eslint-disable-next-line no-new
            new URL(raw);
            return { url: raw };
        } catch {
            if (raw.toLowerCase().includes('geocaching.com')) {
                return { url: `https://${raw.replace(/^https?:\/\//i, '')}` };
            }
        }

        return { url: raw };
    }

    private async handleEnsureSession(argString: string): Promise<ToolCallResult> {
        try {
            const args = JSON.parse(argString);
            const provider = args.provider as string;
            const wp = typeof args.wp === 'string' ? args.wp : undefined;

            const backendBaseUrl = this.getBackendBaseUrl();
            const res = await fetch(`${backendBaseUrl}/api/checkers/session/ensure`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ provider, wp })
            });

            const data = await res.json();
            if (!res.ok || data.status === 'error') {
                return { error: data.error || `HTTP ${res.status}` };
            }

            return JSON.stringify({ provider: data.provider, logged_in: data.logged_in }, null, 2);
        } catch (error: any) {
            console.error('[CHECKERS-TOOLS] Erreur ensure_checker_session:', error);
            return { error: error.message || 'Erreur ensure_checker_session' };
        }
    }

    private async handleLoginSession(argString: string): Promise<ToolCallResult> {
        try {
            const args = JSON.parse(argString);
            const provider = args.provider as string;
            const wp = typeof args.wp === 'string' ? args.wp : undefined;
            const timeoutSec = typeof args.timeout_sec === 'number' ? args.timeout_sec : 180;

            const backendBaseUrl = this.getBackendBaseUrl();
            const res = await fetch(`${backendBaseUrl}/api/checkers/session/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ provider, wp, timeout_sec: timeoutSec })
            });

            const data = await res.json();
            if (!res.ok || data.status === 'error') {
                return { error: data.error || `HTTP ${res.status}` };
            }

            return JSON.stringify({ provider: data.provider, logged_in: data.logged_in }, null, 2);
        } catch (error: any) {
            console.error('[CHECKERS-TOOLS] Erreur login_checker_session:', error);
            return { error: error.message || 'Erreur login_checker_session' };
        }
    }

    private async handleResetSession(argString: string): Promise<ToolCallResult> {
        try {
            const args = JSON.parse(argString);
            const confirm = Boolean(args.confirm);

            const backendBaseUrl = this.getBackendBaseUrl();
            const res = await fetch(`${backendBaseUrl}/api/checkers/session/reset`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ confirm })
            });

            const data = await res.json();
            if (!res.ok || data.status === 'error') {
                return { error: data.error || `HTTP ${res.status}` };
            }

            return JSON.stringify(data, null, 2);
        } catch (error: any) {
            console.error('[CHECKERS-TOOLS] Erreur reset_checker_session:', error);
            return { error: error.message || 'Erreur reset_checker_session' };
        }
    }

    private getBackendBaseUrl(): string {
        const value = this.preferenceService.get('geoApp.backend.apiBaseUrl', 'http://localhost:8000') as string;
        return (value || 'http://localhost:8000').replace(/\/$/, '');
    }

    private buildParameters(props: Record<string, any>): ToolRequestParameters {
        const properties: ToolRequestParametersProperties = {};
        const required: string[] = [];

        for (const [key, value] of Object.entries(props)) {
            properties[key] = this.normalizeProperty(value);

            if (value.required) {
                required.push(key);
            }
        }

        return {
            type: 'object',
            properties,
            required,
            additionalProperties: false
        } as ToolRequestParameters;
    }

    private normalizeProperty(value: Record<string, any>): Record<string, any> {
        const property: Record<string, any> = { ...value };
        delete property.required;

        if (property.properties && typeof property.properties === 'object') {
            const nestedProperties: Record<string, any> = {};
            for (const [key, nestedValue] of Object.entries(property.properties)) {
                nestedProperties[key] = this.normalizeProperty(nestedValue as Record<string, any>);
            }
            property.properties = nestedProperties;
        }

        if (property.items && typeof property.items === 'object') {
            property.items = this.normalizeProperty(property.items);
        }

        if (property.type === 'object' && property.additionalProperties === undefined) {
            property.additionalProperties = false;
        }

        return property;
    }
}
