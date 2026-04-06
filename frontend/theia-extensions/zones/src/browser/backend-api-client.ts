import { inject, injectable } from '@theia/core/shared/inversify';
import { PreferenceChange, PreferenceService } from '@theia/core/lib/common/preferences/preference-service';

export class BackendApiError extends Error {
    constructor(
        readonly status: number,
        message: string
    ) {
        super(message);
        this.name = 'BackendApiError';
    }
}

@injectable()
export class BackendApiClient {
    protected baseUrl: string;

    constructor(
        @inject(PreferenceService) protected readonly preferenceService: PreferenceService
    ) {
        const initialUrl = String(this.preferenceService.get('geoApp.backend.apiBaseUrl', 'http://localhost:8000') || 'http://localhost:8000');
        this.baseUrl = this.normalizeBaseUrl(initialUrl);

        this.preferenceService.onPreferenceChanged((event: PreferenceChange) => {
            if (event.preferenceName === 'geoApp.backend.apiBaseUrl') {
                this.baseUrl = this.normalizeBaseUrl(String(event.newValue || 'http://localhost:8000'));
            }
        });
    }

    async request(path: string, init: RequestInit = {}): Promise<Response> {
        const headers = new Headers(init.headers ?? undefined);
        return fetch(this.toUrl(path), {
            ...init,
            headers,
            credentials: init.credentials ?? 'include'
        });
    }

    getBaseUrl(): string {
        return this.baseUrl;
    }

    async requestJson<T>(path: string, init: RequestInit = {}, fallbackMessage?: string): Promise<T> {
        const response = await this.request(path, init);
        await this.ensureOk(response, fallbackMessage);
        return response.json() as Promise<T>;
    }

    async requestOptionalJson<T>(path: string, init: RequestInit = {}, fallbackMessage?: string): Promise<T | undefined> {
        const response = await this.request(path, init);
        await this.ensureOk(response, fallbackMessage);
        return this.readOptionalJson<T>(response);
    }

    async requestResponse(path: string, init: RequestInit = {}, fallbackMessage?: string): Promise<Response> {
        const response = await this.request(path, init);
        await this.ensureOk(response, fallbackMessage);
        return response;
    }

    async requestVoid(path: string, init: RequestInit = {}, fallbackMessage?: string): Promise<void> {
        const response = await this.request(path, init);
        await this.ensureOk(response, fallbackMessage);
    }

    createJsonInit(method: string, body?: unknown, init: RequestInit = {}): RequestInit {
        const headers = new Headers(init.headers ?? undefined);
        if (body !== undefined && !headers.has('Content-Type')) {
            headers.set('Content-Type', 'application/json');
        }
        return {
            ...init,
            method,
            headers,
            body: body !== undefined ? JSON.stringify(body) : init.body
        };
    }

    async ensureOk(response: Response, fallbackMessage?: string): Promise<void> {
        if (response.ok) {
            return;
        }
        throw await this.toError(response, fallbackMessage);
    }

    async readOptionalJson<T>(response: Response): Promise<T | undefined> {
        const contentType = response.headers.get('Content-Type') || '';
        if (!contentType.toLowerCase().includes('json')) {
            const text = (await response.text()).trim();
            if (!text) {
                return undefined;
            }
            return JSON.parse(text) as T;
        }

        const text = (await response.text()).trim();
        if (!text) {
            return undefined;
        }
        return JSON.parse(text) as T;
    }

    protected async toError(response: Response, fallbackMessage?: string): Promise<BackendApiError> {
        const statusMessage = `HTTP ${response.status}`;
        const payload = await response.text();
        const text = payload.trim();

        if (text) {
            try {
                const parsed = JSON.parse(text) as Record<string, unknown>;
                const candidate = parsed.error || parsed.message || parsed.detail;
                if (typeof candidate === 'string' && candidate.trim()) {
                    return new BackendApiError(response.status, candidate.trim());
                }
            } catch {
                return new BackendApiError(response.status, text);
            }
            return new BackendApiError(response.status, text);
        }

        return new BackendApiError(response.status, fallbackMessage || statusMessage);
    }

    protected toUrl(path: string): string {
        const normalizedPath = path.startsWith('/') ? path : `/${path}`;
        return `${this.baseUrl}${normalizedPath}`;
    }

    protected normalizeBaseUrl(url: string): string {
        const trimmed = (url || '').trim();
        if (!trimmed) {
            return 'http://localhost:8000';
        }
        return trimmed.replace(/\/+$/, '');
    }
}

export function getErrorMessage(error: unknown, fallbackMessage: string): string {
    if (error instanceof Error && error.message.trim()) {
        return error.message;
    }
    return fallbackMessage;
}
