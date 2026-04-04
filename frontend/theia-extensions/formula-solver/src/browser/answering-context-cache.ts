import { injectable, inject } from '@theia/core/shared/inversify';
import { FormulaSolverLLMService } from './formula-solver-llm-service';
import { FormulaSolverAiProfile } from './geoapp-formula-solver-agents';

export interface PreparedAnsweringContext {
    geocache_summary: string;
    global_rules: string[];
    per_letter_rules: Record<string, string>;
}

interface BuildKeyParams {
    geocacheId?: number;
    geocacheCode?: string;
    geocacheTitle?: string;
    text: string;
    questionsByLetter: Record<string, string>;
    profile: FormulaSolverAiProfile;
}

/**
 * Cache du contexte IA (résumé + règles) utilisé pour répondre aux questions.
 *
 * Objectifs:
 * - éviter de recalculer le contexte à chaque clic "Répondre" sur une lettre
 * - stabiliser les réponses (mêmes règles appliquées sur toute la session)
 */
@injectable()
export class AnsweringContextCache {
    @inject(FormulaSolverLLMService)
    protected readonly llmService!: FormulaSolverLLMService;

    // Cache simple + petite limite (LRU rudimentaire via insertion order)
    private readonly cache = new Map<string, PreparedAnsweringContext>();
    private readonly maxItems = 10;

    async getOrBuild(params: {
        geocacheId?: number;
        geocacheCode?: string;
        geocacheTitle?: string;
        text: string;
        questionsByLetter: Record<string, string>;
        targetLetters?: string[];
        profile: FormulaSolverAiProfile;
        forceRebuild?: boolean;
    }): Promise<PreparedAnsweringContext> {
        const key = this.buildKey({
            geocacheId: params.geocacheId,
            geocacheCode: params.geocacheCode,
            geocacheTitle: params.geocacheTitle,
            text: params.text,
            questionsByLetter: params.questionsByLetter,
            profile: params.profile
        });

        const cached = this.cache.get(key);
        if (cached && !params.forceRebuild) {
            // refresh LRU
            this.cache.delete(key);
            this.cache.set(key, cached);
            return cached;
        }

        const built = await this.llmService.buildAnsweringContext({
            geocacheTitle: params.geocacheTitle,
            geocacheCode: params.geocacheCode,
            text: params.text,
            questionsByLetter: params.questionsByLetter,
            targetLetters: params.targetLetters
        }, params.profile);

        this.cache.set(key, built);
        this.enforceLimit();
        return built;
    }

    clearAll(): void {
        this.cache.clear();
    }

    private enforceLimit(): void {
        while (this.cache.size > this.maxItems) {
            const oldestKey = this.cache.keys().next().value as string | undefined;
            if (!oldestKey) {
                return;
            }
            this.cache.delete(oldestKey);
        }
    }

    private buildKey(params: BuildKeyParams): string {
        const titleLine = [params.geocacheCode, params.geocacheTitle].filter(Boolean).join(' - ');
        const questionsSorted = Object.keys(params.questionsByLetter)
            .sort()
            .map(letter => `${letter}:${params.questionsByLetter[letter] || ''}`)
            .join('\n');

        const keyMaterial = [
            `profile=${params.profile}`,
            `id=${params.geocacheId ?? ''}`,
            `title=${titleLine}`,
            `textHash=${hashString(params.text)}`,
            `questionsHash=${hashString(questionsSorted)}`
        ].join('|');

        return keyMaterial;
    }
}

function hashString(input: string): string {
    const str = (input || '').toString();
    // djb2
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) + hash) + str.charCodeAt(i);
        hash = hash | 0;
    }
    return String(hash >>> 0);
}

