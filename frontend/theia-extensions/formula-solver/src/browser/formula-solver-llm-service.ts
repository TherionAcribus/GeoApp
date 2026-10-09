import { getJsonOfResponse, isLanguageModelParsedResponse, getTextOfResponse } from '@theia/ai-core';
import { injectable, inject } from '@theia/core/shared/inversify';
import {
    GeoAppAiExecutionService,
    GeoAppAiOutputError,
} from 'theia-ide-zones-ext/lib/browser/geoapp-ai-execution-service';
import { Formula } from '../common/types';
import { FormulaSolverAiProfile, FormulaSolverTaskIdsByProfile } from './geoapp-formula-solver-agents';

@injectable()
export class FormulaSolverLLMService {
    @inject(GeoAppAiExecutionService)
    protected readonly aiExecutionService!: GeoAppAiExecutionService;

    /**
     * Effectue un appel direct à un LLM pour résoudre une tâche spécifique
     */
    protected async callLLM(prompt: string, task: string, profile: FormulaSolverAiProfile = 'fast'): Promise<string> {
        try {
            const taskId = FormulaSolverTaskIdsByProfile[profile] ?? FormulaSolverTaskIdsByProfile.fast;
            let execution;
            try {
                execution = await this.aiExecutionService.beginTaskExecution(taskId, {
                    operationId: `formula-${task}-${Date.now()}`,
                });
            } catch (error) {
                if (profile === 'local') {
                    throw new Error(`Le profil local de Formula Solver ne peut pas utiliser ce modèle : ${error instanceof Error ? error.message : String(error)} Aucun repli cloud n'a été appliqué.`);
                }
                throw error;
            }

            const response = (await execution.sendRequest({
                messages: [
                    {
                        actor: 'user',
                        type: 'text',
                        text: prompt
                    }
                ],
            })).response;

            // Extraire le texte de la réponse
            let responseText: string;
            if (isLanguageModelParsedResponse(response)) {
                responseText = JSON.stringify(response.parsed);
            } else {
                // Utiliser la fonction utilitaire de Theia pour extraire le texte
                try {
                    responseText = await getTextOfResponse(response);
                } catch (textError) {
                    console.warn(`[FORMULA-SOLVER-LLM] ⚠️ Erreur extraction texte, tentative avec getJsonOfResponse:`, textError);
                    // Fallback : essayer getJsonOfResponse, mais ne pas masquer l'erreur originale (ex: quota 429)
                    try {
                        const jsonResponse = await getJsonOfResponse(response) as any;
                        responseText = typeof jsonResponse === 'string' ? jsonResponse : JSON.stringify(jsonResponse);
                    } catch (jsonError) {
                        console.error(`[FORMULA-SOLVER-LLM] ❌ Impossible d'extraire la réponse (texte+json).`, jsonError);
                        // Remonter l'erreur initiale (souvent plus explicite: 429, 401, etc.)
                        throw textError;
                    }
                }
            }

            const cleaned = this.stripThinkingBlocks(responseText);
            return cleaned;
        } catch (error) {
            console.error(`[FORMULA-SOLVER-LLM] ❌ Erreur LLM pour ${task}:`, error);
            throw error;
        }
    }

    private stripThinkingBlocks(text: string): string {
        if (!text) {
            return text;
        }

        // Défense en profondeur (mêmes patterns que OCR + variantes)
        return text
            .replace(/\[THINK\][\s\S]*?\[\/THINK\]/gi, '')
            .replace(/<think>[\s\S]*?<\/think>/gi, '')
            .replace(/\[ANALYSIS\][\s\S]*?\[\/ANALYSIS\]/gi, '')
            .replace(/<analysis>[\s\S]*?<\/analysis>/gi, '')
            .trim();
    }

    private extractJsonObject(text: string): Record<string, unknown> {
        const trimmed = (text || '').trim();
        if (!trimmed) {
            throw new GeoAppAiOutputError('empty-response', 'Formula Solver : réponse IA vide.', true);
        }

        // Essayer d'extraire le premier objet JSON complet
        const start = trimmed.indexOf('{');
        const end = trimmed.lastIndexOf('}');
        if (start === -1 || end === -1 || end <= start) {
            throw new GeoAppAiOutputError('invalid-json', 'Formula Solver : la réponse IA ne contient pas d’objet JSON.', true);
        }

        const candidate = trimmed.slice(start, end + 1);
        try {
            const parsed = JSON.parse(candidate) as unknown;
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                throw new GeoAppAiOutputError('schema-mismatch', 'Formula Solver : le JSON retourné n’est pas un objet.', true);
            }
            return parsed as Record<string, unknown>;
        } catch (error) {
            if (error instanceof GeoAppAiOutputError) {
                throw error;
            }
            throw new GeoAppAiOutputError('invalid-json', 'Formula Solver : réponse JSON invalide.', true);
        }
    }

    private limitTextForPrompt(text: string, maxChars: number = 9000): string {
        const raw = (text || '').toString();
        if (raw.length <= maxChars) {
            return raw;
        }
        const half = Math.floor(maxChars / 2);
        const head = raw.slice(0, half);
        const tail = raw.slice(raw.length - half);
        return `${head}\n\n[...TRONQUÉ - milieu supprimé pour limiter la taille...]\n\n${tail}`;
    }

    /**
     * Détecte les formules GPS dans un texte avec IA
     */
    async detectFormulasWithAI(text: string, profile: FormulaSolverAiProfile = 'fast'): Promise<Formula[]> {
        const prompt = `Analyse ce texte de géocache et détecte les formules de coordonnées GPS qu'il contient.

Texte à analyser:
${text}

INSTRUCTIONS IMPORTANTES:
- Cherche les patterns de coordonnées GPS comme N49°12.345 E006°12.345
- Identifie les formules avec variables (A, B, C, etc.) dans les expressions mathématiques
- Les lettres N, S, E, W isolées au début des coordonnées sont des POINTS CARDINAUX, pas des variables
- Seules les lettres utilisées DANS les parenthèses () sont des variables à résoudre
- Les champs "north" et "east" doivent contenir UNIQUEMENT la partie coordonnée, SANS le signe "=" au début
- Par exemple : "north": "N49°12.(A+B+C)" et NON "north": "N=N49°12.(A+B+C)"
- Retourne UNIQUEMENT un objet JSON valide avec cette structure:
{
  "formulas": [
    {
      "id": "formula_1",
      "north": "N49°12.(A+B+C)",
      "east": "E006°00.(D-E)",
      "text_output": "N49°12.(A+B+C) E006°00.(D-E)",
      "confidence": 0.95,
      "source": "ai-detected"
    }
  ]
}

Si aucune formule n'est trouvée, retourne {"formulas": []}`;

        const response = await this.callLLM(prompt, 'détection-formules', profile);

        const parsed = this.extractJsonObject(response);
        const formulasRaw = parsed.formulas;
        if (!Array.isArray(formulasRaw)) {
            throw new GeoAppAiOutputError(
                'schema-mismatch',
                'Formula Solver : le JSON retourné ne contient pas de tableau « formulas ».',
                true
            );
        }

        return formulasRaw.map((f: any, index: number) => ({
            id: String(f?.id || `ai_formula_${index + 1}`),
            north: String(f?.north || ''),
            east: String(f?.east || ''),
            text_output: String(f?.text_output || `${f?.north || ''} ${f?.east || ''}`).trim(),
            confidence: typeof f?.confidence === 'number' ? f.confidence : 0.7,
            source: String(f?.source || 'ai')
        })).filter((f: Formula) => Boolean(f.north) && Boolean(f.east));
    }

    /**
     * Extrait les questions pour les variables avec IA
     */
    async extractQuestionsWithAI(
        text: string,
        variables: string[],
        profile: FormulaSolverAiProfile = 'fast',
        options?: { userHint?: string }
    ): Promise<{ [key: string]: string }> {
        const hint = (options?.userHint || '').trim();
        const hintBlock = hint ? `\n\nINFOS FOURNIES PAR L'UTILISATEUR (prioritaires):\n${hint}\n` : '';
        const limitedText = this.limitTextForPrompt(text);

        const prompt = `Analyse ce texte de géocache et EXTRAIS les consignes/questions associées à ces variables: ${variables.join(', ')}

IMPORTANT: Ces variables (${variables.join(', ')}) sont les LETTRES utilisées dans les formules mathématiques.
NE CONFONDS PAS avec les points cardinaux (N, S, E, W) qui sont au début des coordonnées !

        Texte complet:
        ${limitedText}
${hintBlock}

INSTRUCTIONS:
- Objectif: pour chaque lettre, renvoyer le TEXTE DE LA CONSIGNE permettant de calculer la valeur de la lettre.
- Formats fréquents à capturer (exemples):
  - "A = valeur du nom complet (en 4 mots) (avec A=1..Z=26)"
  - "B: nombre de marches"
  - "1/ ...", suivi plus bas de "A = ..."
- Ne renvoie JAMAIS un numéro seul comme "1" ou "2" (ce sont des numéros de paragraphe, pas des consignes).
- Si aucune consigne n'est trouvée pour une variable, mets une chaîne vide.
- Retourne UNIQUEMENT un JSON strict SANS balises markdown, SANS blocs de code :
${JSON.stringify(Object.fromEntries(variables.map(v => [v, ''])), null, 2)}`;

        const response = await this.callLLM(prompt, `extraction-questions-${variables.join('')}`, profile);
        const parsed = this.extractJsonObject(response);
        const result: Record<string, string> = {};
        let returnedKeys = 0;
        for (const variable of variables) {
            if (Object.prototype.hasOwnProperty.call(parsed, variable)) {
                returnedKeys++;
            }
            result[variable] = String(parsed[variable] ?? '');
        }
        if (variables.length > 0 && returnedKeys === 0) {
            throw new GeoAppAiOutputError(
                'schema-mismatch',
                'Formula Solver : le JSON de questions ne contient aucune lettre demandée.',
                true
            );
        }
        return result;
    }

    /**
     * Recherche des réponses avec IA
     */
    async searchAnswersWithAI(questions: { [key: string]: string }, context: string, profile: FormulaSolverAiProfile = 'fast'): Promise<{ [key: string]: string }> {
        const questionsText = Object.entries(questions)
            .map(([var_name, question]) => `${var_name}: ${question}`)
            .join('\n');

        const keys = Object.keys(questions);
        const exampleKeys = keys.slice(0, 4);
        const exampleObject = exampleKeys.reduce<Record<string, string>>((acc, key) => {
            acc[key] = `réponse pour ${key}`;
            return acc;
        }, {});

        const prompt = `Trouve les réponses à ces questions pour une géocache mystère.

Contexte de la géocache: ${context}

Questions à résoudre:
${questionsText}

INSTRUCTIONS:
- Réponds uniquement pour les clés fournies (${keys.join(', ')})
- Respecte strictement les consignes de format si elles sont présentes dans le contexte
- Retourne UNIQUEMENT un objet JSON (pas de texte autour), exactement de cette forme:
${JSON.stringify(exampleObject, null, 2)}`;

        const response = await this.callLLM(prompt, 'recherche-réponses', profile);
        const parsed = this.extractJsonObject(response);
        const result: Record<string, string> = {};
        let returnedKeys = 0;
        for (const key of keys) {
            if (Object.prototype.hasOwnProperty.call(parsed, key)) {
                returnedKeys++;
            }
            result[key] = String(parsed[key] ?? '');
        }
        if (keys.length > 0 && returnedKeys === 0) {
            throw new GeoAppAiOutputError(
                'schema-mismatch',
                'Formula Solver : le JSON de réponses ne contient aucune lettre demandée.',
                true
            );
        }
        return result;
    }

    /**
     * Construit un contexte global (résumé + règles) pour répondre aux questions d'une géocache.
     * Objectif: capturer les consignes implicites (articles, prénom/nom, singulier/pluriel, etc.).
     */
    async buildAnsweringContext(params: {
        geocacheTitle?: string;
        geocacheCode?: string;
        text: string;
        questionsByLetter: Record<string, string>;
        targetLetters?: string[];
    }, profile: FormulaSolverAiProfile = 'fast'): Promise<{
        geocache_summary: string;
        global_rules: string[];
        per_letter_rules: Record<string, string>;
    }> {
        const letters = Object.keys(params.questionsByLetter);
        const questionLines = letters.map(letter => `${letter}: ${params.questionsByLetter[letter] || ''}`).join('\n');
        const limitedText = this.limitTextForPrompt(params.text);

        const titleLine = [params.geocacheCode, params.geocacheTitle].filter(Boolean).join(' - ');
        const targetHint = params.targetLetters && params.targetLetters.length > 0
            ? `Lettres cibles (priorité): ${params.targetLetters.join(', ')}`
            : 'Lettres cibles: toutes';

        const prompt = `Tu es un assistant de géocaching. Ton but est d'aider à répondre à des questions (lettres) en respectant STRICTEMENT les consignes du listing.

Géocache: ${titleLine || '(titre inconnu)'}

${targetHint}

Texte (listing / contexte):
${limitedText}

Questions (lettre -> question):
${questionLines}

INSTRUCTIONS:
- Analyse le texte et les questions pour déduire toutes les consignes de format de réponse possibles.
- Exemples de consignes à détecter: "donner seulement le nom", "nom+prénom", présence d'articles (Le/La/Les), singulier/pluriel, accents, majuscules, retirer les espaces, etc.
- Si une consigne n'est pas explicitement déductible, ne l'invente pas.
- Retourne UNIQUEMENT un JSON strict avec cette forme:
{
  "geocache_summary": "résumé très court utile",
  "global_rules": ["...","..."],
  "per_letter_rules": {
    "A": "règle spécifique si déductible sinon vide",
    "B": "",
    "...": ""
  }
}`;

        const response = await this.callLLM(prompt, 'construction-contexte-reponses', profile);
        const parsed = this.extractJsonObject(response);
        const perLetterRules = parsed.per_letter_rules && typeof parsed.per_letter_rules === 'object' && !Array.isArray(parsed.per_letter_rules)
            ? Object.fromEntries(Object.entries(parsed.per_letter_rules).map(([key, value]) => [key, String(value)]))
            : {};
        return {
            geocache_summary: String(parsed.geocache_summary || ''),
            global_rules: Array.isArray(parsed.global_rules) ? parsed.global_rules.map((v: any) => String(v)) : [],
            per_letter_rules: perLetterRules
        };
    }

    /**
     * Répond à une seule lettre avec contexte + règles.
     * Retourne un JSON strict { "<LETTER>": "<ANSWER>" } pour éviter les confusions.
     */
    async answerSingleQuestionWithContext(params: {
        letter: string;
        question: string;
        geocacheTitle?: string;
        geocacheCode?: string;
        context: {
            geocache_summary: string;
            global_rules: string[];
            per_letter_rules: Record<string, string>;
        };
        extraUserInfo?: string;
    }, profile: FormulaSolverAiProfile = 'fast'): Promise<{ answer: string; explanation: string; valueType: string }> {
        const rule = params.context.per_letter_rules?.[params.letter] || '';
        const rulesText = [
            ...(params.context.global_rules || []),
            rule ? `Règle spécifique ${params.letter}: ${rule}` : ''
        ].filter(Boolean).join('\n- ');

        const titleLine = [params.geocacheCode, params.geocacheTitle].filter(Boolean).join(' - ');
        const extra = (params.extraUserInfo || '').trim();
        const extraBlock = extra ? `\nInfos complémentaires (utilisateur):\n${extra}\n` : '';

        const prompt = `Tu dois répondre UNIQUEMENT à la question suivante pour une géocache.

Géocache: ${titleLine || '(titre inconnu)'}
Résumé utile: ${params.context.geocache_summary || '(vide)'}

Règles à respecter:
- ${rulesText || 'Aucune règle explicite détectée'}
${extraBlock}

Question:
${params.letter}: ${params.question}

INSTRUCTIONS IMPORTANTES:
- Réponds uniquement pour la lettre ${params.letter}.
- TRÈS IMPORTANT: NE FAIS PAS de calcul toi-même (checksum, nombre de lettres, etc.). Le calcul sera fait automatiquement par le logiciel.
- Tu dois retourner la RÉPONSE BRUTE (le mot, le nom, le texte, l'année, le nombre...) et indiquer quel type de calcul doit être appliqué.
- Types de calcul possibles pour "valueType":
  - "value" : la réponse est directement un nombre ou une valeur numérique (année, quantité, etc.). Pas de calcul à faire.
  - "checksum" : la question demande un checksum (somme des chiffres, ou somme des positions alphabétiques A=1..Z=26).
  - "reduced" : la question demande un checksum réduit (somme itérative jusqu'à un seul chiffre).
  - "length" : la question demande le nombre de lettres / la longueur du mot.
- Exemples:
  - Question "Capitale de la France en checksum ?" → réponse "Paris", valueType "checksum"
  - Question "Nombre de lettres du prénom de Voltaire ?" → réponse "François-Marie", valueType "length"
  - Question "En quelle année est née Marie Curie ?" → réponse "1867", valueType "value"
  - Question "Checksum réduit du nom de l'inventeur de la radio ?" → réponse "Marconi", valueType "reduced"
- Retourne UNIQUEMENT un JSON strict sans texte autour, avec cette forme:
{ "${params.letter}": "<réponse brute>", "valueType": "<value|checksum|reduced|length>", "explanation": "<explication courte de ton raisonnement et de la source de ta réponse>" }`;

        const response = await this.callLLM(prompt, `reponse-${params.letter}`, profile);
        const parsed = this.extractJsonObject(response);
        if (!Object.prototype.hasOwnProperty.call(parsed, params.letter)) {
            throw new GeoAppAiOutputError(
                'schema-mismatch',
                `Formula Solver : la réponse JSON ne contient pas la lettre « ${params.letter} ».`,
                true
            );
        }
        const rawValueType = String(parsed.valueType ?? 'value').toLowerCase().trim();
        const validTypes = ['value', 'checksum', 'reduced', 'length'];
        if (!validTypes.includes(rawValueType)) {
            throw new GeoAppAiOutputError(
                'schema-mismatch',
                `Formula Solver : valueType « ${rawValueType} » non reconnu.`,
                true
            );
        }
        return {
            answer: String(parsed[params.letter] ?? ''),
            explanation: String(parsed.explanation ?? ''),
            valueType: rawValueType
        };
    }
}
