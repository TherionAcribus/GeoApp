import * as React from 'react';
import markdownit from '@theia/core/shared/markdown-it';
import DOMPurify from '@theia/core/shared/dompurify';
import { stripEarthCoachResultBlocks } from './earthcoach-result-capture';
import { GeoImage, LoggingTask, UserObservation } from './earthcoach-types';
import {
    applicableProposalIndexes,
    findUncoveredSnapshotTasks,
    isProposalApplicable,
    proposalDiffersFromAi,
    resolveProposalPosition,
    revertProposalPatch,
    trailingNumericId,
} from './earthcoach-workspace-logic';
import { EarthCoachResult, EarthCoachResultProposal } from './earthcoach-workspace-types';

const CONFIDENCE_LABELS: Record<string, string> = {
    high: 'haute',
    medium: 'moyenne',
    low: 'basse',
};

const STATUS_LABELS: Record<EarthCoachResultProposal['status'], string> = {
    ready: 'Prête',
    partial: 'Partielle',
    missing: 'Manquante',
};

// html: false — la reponse du modele est rendue, jamais son HTML brut.
const markdown = markdownit({ html: false, linkify: true, breaks: true });

export function renderEarthCoachMarkdown(text: string): string {
    return DOMPurify.sanitize(markdown.render(text));
}

/** Libelle lisible d'une preuve citee dans une proposition (image ou observation). */
export function describeEarthCoachEvidence(id: string, images: GeoImage[], observations: UserObservation[]): string {
    const image = images.find(item => item.id === id || String(trailingNumericId(item.id)) === id);
    if (image) {
        return image.label || `image ${id}`;
    }
    const observation = observations.find(item => item.id === id || item.id === `observation-${id}`);
    if (observation) {
        const excerpt = observation.note.replace(/\s+/g, ' ').trim();
        return excerpt.length > 50 ? `${excerpt.slice(0, 50)}…` : excerpt;
    }
    return id;
}

/**
 * Callbacks du widget. L'objet est cree une fois : sa reference stable garde
 * `React.memo` efficace (saisir un commentaire ne redessine pas les resultats).
 */
export interface EarthCoachResultCardHandlers {
    onToggle(resultId: number, open: boolean): void;
    onUpdateProposal(resultId: number, proposalIndex: number, patch: Partial<EarthCoachResultProposal>): void;
    onMoveAnswerToMissing(resultId: number, proposalIndex: number): void;
    onApply(resultId: number, proposalIndex: number): void;
    onApplyAll(resultId: number): void;
    onGenerateFinal(resultId: number): void;
    onSaveNote(result: EarthCoachResult): void;
    onCopyFinal(finalAnswer: string): void;
}

export interface EarthCoachResultCardProps {
    result: EarthCoachResult;
    expanded: boolean;
    dirty: boolean;
    /** Une generation de reponse finale est en cours (tous resultats confondus). */
    finalBusy: boolean;
    generatingFinal: boolean;
    images: GeoImage[];
    observations: UserObservation[];
    loggingTasks: LoggingTask[];
    handlers: EarthCoachResultCardHandlers;
}

function questionLabel(position: number | undefined, question: string): string {
    return position !== undefined ? `Q${position} · ${question}` : question;
}

function ResultMarkdown(props: { markdown?: string | null }): React.ReactElement | null {
    const html = React.useMemo(
        () => (props.markdown ? renderEarthCoachMarkdown(stripEarthCoachResultBlocks(props.markdown)) : ''),
        [props.markdown]
    );
    return html ? <div className='ecw-markdown' dangerouslySetInnerHTML={{ __html: html }} /> : null;
}

function ResolutionBody(props: EarthCoachResultCardProps): React.ReactElement {
    const { result, handlers } = props;
    const uncovered = findUncoveredSnapshotTasks(result.proposals, result.snapshot_tasks);
    const applicable = applicableProposalIndexes(result.proposals);
    return <>
        <ResultMarkdown markdown={result.markdown} />
        {uncovered.length > 0 && <div className='ecw-warning'>
            Aucune proposition pour {uncovered.map(task => `Q${task.position ?? '?'}`).join(', ')} : relancez la résolution ou complétez à la main.
        </div>}
        {applicable.length > 1 && <div className='ecw-row'>
            <span className='ecw-grow' />
            <button className='theia-button' onClick={() => handlers.onApplyAll(result.id)}>
                Reporter les {applicable.length} réponses prêtes dans les questions
            </button>
        </div>}
        {result.proposals.map((proposal, proposalIndex) => {
            const position = resolveProposalPosition(proposal, result.snapshot_tasks, props.loggingTasks);
            const ai = result.ai_proposals?.[proposalIndex];
            const edited = proposalDiffersFromAi(proposal, ai);
            return <div key={`${result.id}-${proposalIndex}`} className='ecw-proposal'>
                <div className='ecw-question'><strong>{questionLabel(position, proposal.question)}</strong>
                    {proposal.question_translation && proposal.question_translation.trim() !== proposal.question.trim() &&
                        <div className='ecw-translation'><span>Traduction :</span> {proposal.question_translation}</div>}
                </div>
                {(proposal.confidence || Boolean(proposal.evidence_ids?.length)) && <div className='ecw-muted ecw-evidence'>
                    {proposal.confidence ? `Confiance ${CONFIDENCE_LABELS[proposal.confidence] || proposal.confidence}` : ''}
                    {proposal.evidence_ids?.length
                        ? `${proposal.confidence ? ' · ' : ''}Fondée sur : ${proposal.evidence_ids.map(id => describeEarthCoachEvidence(id, props.images, props.observations)).join(', ')}`
                        : ''}
                </div>}
                <label>État<select className='theia-select' value={proposal.status}
                    onChange={event => handlers.onUpdateProposal(result.id, proposalIndex, { status: event.currentTarget.value as EarthCoachResultProposal['status'] })}>
                    <option value='ready'>Prête</option><option value='partial'>Partielle</option><option value='missing'>Manquante</option>
                </select></label>
                <label>Réponse candidate — uniquement ce qui répond à la question<textarea className='theia-input' rows={4} value={proposal.answer || ''}
                    onChange={event => handlers.onUpdateProposal(result.id, proposalIndex, { answer: event.currentTarget.value })} /></label>
                <label>Éléments à compléter — actions, mesures ou informations manquantes<textarea className='theia-input' rows={2} value={proposal.missing || ''}
                    placeholder='Ex. mesurer l’épaisseur sur place'
                    onChange={event => handlers.onUpdateProposal(result.id, proposalIndex, { missing: event.currentTarget.value || null })} /></label>
                <div className='ecw-row'>
                    <button className='theia-button secondary' disabled={!proposal.answer?.trim()}
                        onClick={() => handlers.onMoveAnswerToMissing(result.id, proposalIndex)}>Déplacer la réponse vers « À compléter »</button>
                    {edited && ai && <button className='theia-button secondary' title='Annule vos corrections sur cette question'
                        onClick={() => handlers.onUpdateProposal(result.id, proposalIndex, revertProposalPatch(ai))}>Revenir à la version IA</button>}
                    <span className='ecw-grow' />
                    <button className='theia-button' disabled={!isProposalApplicable(proposal)}
                        title={isProposalApplicable(proposal) ? 'Enregistre cette réponse dans la question' : 'Seule une réponse prête, sans élément à compléter, peut être reportée'}
                        onClick={() => handlers.onApply(result.id, proposalIndex)}>Reporter dans la question</button>
                </div>
            </div>;
        })}
        <div className='ecw-final-answer'>
            <button className='theia-button' disabled={props.finalBusy} onClick={() => handlers.onGenerateFinal(result.id)}>
                {props.generatingFinal ? 'Préparation…' : (result.final_answer ? 'Régénérer la réponse finale' : 'Générer la réponse finale avec mes corrections')}
            </button>
            <button className='theia-button secondary' onClick={() => handlers.onSaveNote(result)}>Enregistrer la synthèse dans les notes</button>
            <span className='ecw-muted'>Langue : celle choisie en haut du dossier.</span>
        </div>
        {result.final_answer && <div className='ecw-proposal'>
            <div className='ecw-question'><strong>Réponse finale prête à envoyer</strong></div>
            <pre>{result.final_answer}</pre>
            <div className='ecw-row'>
                <button className='theia-button' onClick={() => handlers.onCopyFinal(result.final_answer as string)}>Copier la réponse</button>
            </div>
        </div>}
    </>;
}

function AnalysisBody(props: EarthCoachResultCardProps): React.ReactElement {
    const { result, handlers } = props;
    // L'analyse rend, par question, ce qu'il reste a relever : une liste de
    // travail terrain plutot que des formulaires de reponse.
    const todo = result.proposals
        .map(proposal => ({ proposal, position: resolveProposalPosition(proposal, result.snapshot_tasks, props.loggingTasks) }))
        .filter(item => item.proposal.missing?.trim() || item.proposal.status !== 'ready')
        .sort((left, right) => (left.position ?? Number.MAX_SAFE_INTEGER) - (right.position ?? Number.MAX_SAFE_INTEGER));
    return <>
        {todo.length > 0 && <div className='ecw-todo'>
            <strong>À relever sur le terrain</strong>
            <ul>{todo.map(({ proposal, position }, index) => <li key={index}>
                <span className={`ecw-badge ecw-badge-${proposal.status}`}>{STATUS_LABELS[proposal.status] || proposal.status}</span>{' '}
                <strong>{questionLabel(position, proposal.question)}</strong>
                {proposal.missing?.trim() ? <div className='ecw-muted'>{proposal.missing}</div> : undefined}
            </li>)}</ul>
        </div>}
        <ResultMarkdown markdown={result.markdown} />
        <div className='ecw-final-answer'>
            <button className='theia-button secondary' onClick={() => handlers.onSaveNote(result)}>Enregistrer la synthèse dans les notes</button>
        </div>
    </>;
}

export const EarthCoachResultCard = React.memo(function EarthCoachResultCard(props: EarthCoachResultCardProps): React.ReactElement {
    const { result, handlers } = props;
    return <details open={props.expanded} onToggle={event => {
        const open = event.currentTarget.open;
        if (open !== props.expanded) {
            handlers.onToggle(result.id, open);
        }
    }}>
        <summary>{result.action === 'resolve' ? 'Résolution' : 'Analyse'} — {result.created_at ? new Date(result.created_at).toLocaleString() : result.request_id}
            {result.proposals_edited ? ' · corrigé' : ''}{props.dirty ? ' · modifications en cours…' : ''}</summary>
        {/* Contenu rendu seulement une fois deplie : les anciens resultats ne coutent rien. */}
        {props.expanded && (result.action === 'resolve' ? <ResolutionBody {...props} /> : <AnalysisBody {...props} />)}
    </details>;
});
