import { Emitter, Event } from '@theia/core';
import { inject, injectable } from '@theia/core/shared/inversify';
import { EarthCoachPreparedRequest, EarthCoachResult, EarthCoachResultProposal } from './earthcoach-workspace-types';
import { EarthCoachWorkspaceService } from './earthcoach-workspace-service';

export interface EarthCoachCapturePayload {
    request_id: string;
    geocache_id: number;
    action: 'analyze' | 'resolve';
    proposals?: EarthCoachResultProposal[];
}

@injectable()
export class EarthCoachResultCaptureService {
    protected readonly requests = new Map<string, EarthCoachPreparedRequest>();
    protected readonly capturedEmitter = new Emitter<EarthCoachResult>();

    @inject(EarthCoachWorkspaceService)
    protected readonly workspaceService!: EarthCoachWorkspaceService;

    get onDidCapture(): Event<EarthCoachResult> {
        return this.capturedEmitter.event;
    }

    register(request: EarthCoachPreparedRequest): void {
        this.requests.set(request.requestId, request);
        if (this.requests.size > 20) {
            const oldest = this.requests.keys().next().value;
            if (oldest) {
                this.requests.delete(oldest);
            }
        }
    }

    async attachLatestMarkdown(markdown: string, sessionId?: string): Promise<EarthCoachResult | undefined> {
        const requests = Array.from(this.requests.values());
        const snapshot = requests[requests.length - 1];
        if (!snapshot || !markdown.trim()) {
            return undefined;
        }
        return this.capture({
            request_id: snapshot.requestId,
            geocache_id: snapshot.geocacheId,
            action: snapshot.action === 'resolve' ? 'resolve' : 'analyze',
            proposals: [],
        }, { markdown, sessionId });
    }

    async capture(payload: EarthCoachCapturePayload, options: { markdown?: string; sessionId?: string } = {}): Promise<EarthCoachResult> {
        const snapshot = this.requests.get(payload.request_id);
        if (!snapshot) {
            throw new Error('Instantané EarthCoach introuvable pour cette réponse.');
        }
        if (snapshot.geocacheId !== payload.geocache_id) {
            throw new Error('La réponse EarthCoach ne correspond pas à la géocache préparée.');
        }
        const expectedAction = snapshot.action === 'resolve' ? 'resolve' : 'analyze';
        if (payload.action !== expectedAction) {
            throw new Error('La réponse EarthCoach ne correspond pas à l action préparée.');
        }
        const result = await this.workspaceService.captureResult({
            geocacheId: payload.geocache_id,
            requestId: payload.request_id,
            action: payload.action,
            contextSnapshot: snapshot,
            proposals: payload.proposals || [],
            markdown: options.markdown,
            sessionId: options.sessionId,
        });
        this.capturedEmitter.fire(result);
        return result;
    }
}

export function extractEarthCoachResultBlock(markdown: string): EarthCoachCapturePayload | undefined {
    const pattern = /```earthcoach-result\s*\n([\s\S]*?)\n?```/gi;
    let latest: EarthCoachCapturePayload | undefined;
    let match = pattern.exec(markdown || '');
    while (match) {
        try {
            const parsed = JSON.parse(match[1]) as EarthCoachCapturePayload;
            if (
                parsed && typeof parsed.request_id === 'string' &&
                Number.isInteger(parsed.geocache_id) &&
                (parsed.action === 'analyze' || parsed.action === 'resolve')
            ) {
                latest = parsed;
            }
        } catch {
            // Un bloc invalide ne doit pas masquer un éventuel bloc valide suivant.
        }
        match = pattern.exec(markdown || '');
    }
    return latest;
}
