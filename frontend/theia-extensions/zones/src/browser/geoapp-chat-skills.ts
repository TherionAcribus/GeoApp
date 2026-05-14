import { GeoAppChatWorkflowKind } from './geoapp-chat-shared';

export const GeoAppChatSkillNames = {
    formula: 'geoapp-formula',
    checkers: 'geoapp-checkers',
    imagePuzzle: 'geoapp-image-puzzle',
    secretCode: 'geoapp-secret-code',
    coordinates: 'geoapp-coordinates',
} as const;

export type GeoAppChatSkillName = typeof GeoAppChatSkillNames[keyof typeof GeoAppChatSkillNames];

export interface GeoAppChatSkillMetadata {
    name: GeoAppChatSkillName;
    label: string;
    description: string;
    workflows: GeoAppChatWorkflowKind[];
    content: string;
}

const MANAGED_SKILL_MARKER = '<!-- geoapp-managed-skill -->';

function skillFrontmatter(name: GeoAppChatSkillName, description: string, allowedTools: string[]): string {
    return [
        '---',
        `name: ${name}`,
        `description: ${description}`,
        'metadata:',
        '  provider: geoapp',
        '  version: "1"',
        'allowedTools:',
        ...allowedTools.map(tool => `  - ${tool}`),
        '---',
        '',
        MANAGED_SKILL_MARKER,
        '',
    ].join('\n');
}

export const GeoAppChatSkills: GeoAppChatSkillMetadata[] = [
    {
        name: GeoAppChatSkillNames.formula,
        label: 'Formules',
        description: 'Strategie GeoApp pour detecter des formules, rattacher les variables, chercher des reponses et calculer une finale.',
        workflows: ['formula', 'general'],
        content: `${skillFrontmatter(GeoAppChatSkillNames.formula, 'Strategie GeoApp pour resoudre les caches a formules.', [
            'detect_formula',
            'find_questions_for_variables',
            'search_answer_online',
            'calculate_variable_value',
            'calculate_final_coordinates',
            'coordinate_projection',
            'coordinate_intersection',
            'highlight_found_coordinates_on_map',
        ])}# GeoApp Formula Skill

Use this skill when the cache looks like a formula puzzle, coordinate transform, variable substitution, bearing/distance problem, or factual Q/A puzzle.

## Workflow

- Prefer deterministic GeoApp outputs from resolve_geocache_workflow before manual parsing.
- If formulas and variables were already returned by the workflow, start from those values.
- Use detect_formula only when the formula extraction must be refreshed from new text.
- Use find_questions_for_variables to attach missing variables to listing questions or nearby clues.
- Use search_answer_online only when the active policy exposes network tools and the answer is factual.
- Convert found answers with calculate_variable_value before substituting them.
- Use calculate_final_coordinates once the north/east formulas and values are known.

## Coordinates

- If the listing gives a distance plus bearing/azimuth from posted coordinates or a waypoint, use coordinate_projection before estimating manually.
- If the listing gives two reference points and two distances/radii, use coordinate_intersection before estimating manually.
- Treat tool results as obtained evidence. Manual calculations can explain or sanity-check, but must not replace tool output silently.
- If a candidate coordinate is plausible and map tools are exposed, use highlight_found_coordinates_on_map for a temporary point.
- Use save_found_coordinates only when the user explicitly asks for saving, or the active policy clearly allows that automation.

## Reasoning Rules

- Never invent variable values.
- Keep unresolved variables explicit.
- If the result depends on a weak factual assumption, say so and keep the confidence low.
- If a checker exists and checker tools are exposed, validate the candidate before concluding.
`,
    },
    {
        name: GeoAppChatSkillNames.checkers,
        label: 'Checkers',
        description: 'Strategie GeoApp pour utiliser Certitude, Geocaching Solution Checker et autres checkers sans inventer d URL.',
        workflows: ['checker', 'formula', 'secret_code', 'general'],
        content: `${skillFrontmatter(GeoAppChatSkillNames.checkers, 'Strategie GeoApp pour valider des candidats avec des checkers.', [
            'run_checker',
            'ensure_checker_session',
            'login_checker_session',
            'reset_checker_session',
        ])}# GeoApp Checkers Skill

Use this skill when the context lists a checker URL, a Geocaching solution checker, or a validation step.

## Hard Rules

- Never invent a checker URL.
- Use only checker URLs or checker metadata present in the geocache context or returned by a GeoApp tool.
- Do not present a checker result as fact unless it was obtained through a tool call in this conversation.
- If no checker is referenced, continue without checker and do not make it a blocker.

## Tool Strategy

- Prefer run_checker with geocache_id and candidate when available; GeoApp can resolve the checker URL and wp.
- For Certitude, if the URL has no wp query and the GC code is known, pass wp with the GC code.
- For Geocaching solution checker anchors, pass wp with the GC code so GeoApp can reconstruct the usable checker URL.
- If a checker requires authentication, call ensure_checker_session first.
- If ensure_checker_session reports logged_in=false, propose login_checker_session and retry only after the user accepts.
- Use reset_checker_session only when a session is stale or explicitly requested.

## Reporting

- Report the candidate tested and the checker verdict.
- If validation fails, explain whether the candidate is wrong, formatting is uncertain, or authentication/session state blocked the check.
- If the active policy does not expose checker tools, explain the validation step without pretending it ran.
`,
    },
    {
        name: GeoAppChatSkillNames.imagePuzzle,
        label: 'Images / OCR',
        description: 'Strategie GeoApp pour inspecter les images, OCR, QR codes et descriptions vision des caches image.',
        workflows: ['image_puzzle', 'hidden_content', 'general'],
        content: `${skillFrontmatter(GeoAppChatSkillNames.imagePuzzle, 'Strategie GeoApp pour les enigmes image, OCR et vision.', [
            'run_geocache_workflow_step',
            'recommend_metasolver_plugins',
            'metasolver',
        ])}# GeoApp Image Puzzle Skill

Use this skill when the cache depends on images, OCR, QR codes, visual descriptions, hidden image metadata, or image-linked text.

## First Pass

- If resolve_geocache_workflow classifies the cache as image_puzzle and run_geocache_workflow_step is exposed, run inspect-images.
- If inspect-images returns selected_fragment, OCR text, QR content, or a metasolver recommendation, continue from that output.
- If inspect-images returns no text fragment and only visual images remain, run describe-images when exposed.
- Use describe_context when the listing suggests a theme, for example fairy tales, flags, maps, symbols, or monuments.

## Interpretation

- Treat image vision descriptions as semantic clues, not as secret code by default.
- Do not feed purely semantic image descriptions into metasolver unless the text is clearly encoded.
- If OCR/QR returns encoded text, use geoapp-secret-code after this skill.
- If visual descriptions imply a formula or count, use geoapp-formula after this skill.

## Reporting

- Separate tool evidence from hypotheses.
- Mention which images or fragments were inspected.
- If image tools are not exposed by policy, ask for the missing image information or explain the blocked automation.
`,
    },
    {
        name: GeoAppChatSkillNames.secretCode,
        label: 'Codes secrets',
        description: 'Strategie GeoApp pour codes secrets, metasolver, plugins directs et contenu cache.',
        workflows: ['secret_code', 'hidden_content', 'image_puzzle', 'general'],
        content: `${skillFrontmatter(GeoAppChatSkillNames.secretCode, 'Strategie GeoApp pour codes secrets et metasolver.', [
            'resolve_geocache_workflow',
            'run_geocache_workflow_step',
            'recommend_metasolver_plugins',
            'metasolver',
        ])}# GeoApp Secret Code Skill

Use this skill when the cache contains encoded text, suspicious fragments, HTML/CSS hidden content, symbol alphabets, or metasolver recommendations.

## Workflow

- Start from selected_fragment and metasolver recommendations returned by resolve_geocache_workflow when present.
- If a direct_plugin_candidate is marked should_run_directly=true and run-step is exposed, run execute-direct-plugin before broad metasolver attempts.
- If direct plugin output is usable, prefer it over generic decoding.
- If you change the fragment, call recommend_metasolver_plugins again to refresh the signature and plugin_list.
- Use metasolver with the recommended plugin_list to reduce noise.
- Use a broad preset only when no strong plugin recommendation exists.

## Hidden Content

- For hidden HTML/CSS/text clues, distinguish extraction from decoding.
- Do not pass long listing prose into metasolver. Select the suspicious fragment first.
- Keep original casing, spacing, punctuation, and line breaks when they may be meaningful.

## Result Handling

- Treat decoder outputs as candidates until checked against the listing, formula logic, coordinates, or checker.
- If a decoded output looks like coordinates, switch to geoapp-coordinates.
- If it yields variables or factual answers, switch to geoapp-formula.
`,
    },
    {
        name: GeoAppChatSkillNames.coordinates,
        label: 'Coordonnees',
        description: 'Strategie GeoApp pour analyser, projeter, verifier, afficher et sauvegarder des coordonnees candidates.',
        workflows: ['general', 'formula', 'checker', 'secret_code', 'hidden_content', 'image_puzzle'],
        content: `${skillFrontmatter(GeoAppChatSkillNames.coordinates, 'Strategie GeoApp pour coordonnees candidates et sauvegarde.', [
            'coordinate_projection',
            'coordinate_intersection',
            'calculate_final_coordinates',
            'highlight_found_coordinates_on_map',
            'save_found_coordinates',
        ])}# GeoApp Coordinates Skill

Use this skill whenever a candidate coordinate, projection, intersection, waypoint, or corrected coordinate appears.

## Candidate Quality

- Never invent coordinates.
- Preserve coordinate format and hemisphere.
- Check that candidates are geographically plausible relative to the posted coordinates and cache context.
- Keep confidence explicit when the derivation is incomplete.

## Tools

- Use coordinate_projection for bearing/distance/azimuth instructions.
- Use coordinate_intersection for two reference points with radii/distances.
- Use calculate_final_coordinates for formula substitution outputs.
- Use highlight_found_coordinates_on_map for plausible temporary display when exposed.
- Use save_found_coordinates only when the user explicitly requests saving or the active policy allows automatic save.

## Multiple Candidates

- If a tool returns two possible points, keep both until listing logic, terrain, logs, or checker disambiguates them.
- If map highlight is exposed, show both candidates with replace_existing=false for the second point.
- Do not silently discard a valid candidate without explaining the selection criterion.
`,
    },
];

export function getGeoAppChatSkillNames(): GeoAppChatSkillName[] {
    return GeoAppChatSkills.map(skill => skill.name);
}

export function getGeoAppChatSkill(name: string): GeoAppChatSkillMetadata | undefined {
    return GeoAppChatSkills.find(skill => skill.name === name);
}

export function getRecommendedGeoAppChatSkillNames(workflowKind?: GeoAppChatWorkflowKind): GeoAppChatSkillName[] {
    if (workflowKind === 'formula') {
        return [GeoAppChatSkillNames.formula, GeoAppChatSkillNames.coordinates, GeoAppChatSkillNames.checkers];
    }
    if (workflowKind === 'checker') {
        return [GeoAppChatSkillNames.checkers, GeoAppChatSkillNames.coordinates];
    }
    if (workflowKind === 'secret_code') {
        return [GeoAppChatSkillNames.secretCode, GeoAppChatSkillNames.coordinates, GeoAppChatSkillNames.checkers];
    }
    if (workflowKind === 'hidden_content') {
        return [GeoAppChatSkillNames.secretCode, GeoAppChatSkillNames.imagePuzzle, GeoAppChatSkillNames.coordinates];
    }
    if (workflowKind === 'image_puzzle') {
        return [GeoAppChatSkillNames.imagePuzzle, GeoAppChatSkillNames.secretCode, GeoAppChatSkillNames.coordinates];
    }
    return [GeoAppChatSkillNames.coordinates, GeoAppChatSkillNames.secretCode, GeoAppChatSkillNames.formula];
}

export function isGeoAppManagedSkillContent(content: string): boolean {
    return content.includes(MANAGED_SKILL_MARKER);
}
