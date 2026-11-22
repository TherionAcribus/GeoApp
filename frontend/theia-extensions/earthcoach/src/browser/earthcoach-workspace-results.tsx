import * as React from 'react';
import markdownit from '@theia/core/shared/markdown-it';
import DOMPurify from '@theia/core/shared/dompurify';
import { EARTHCOACH_LANGUAGE_OPTIONS, labelFor } from './earthcoach-description-selector';
import { stripEarthCoachResultBlocks } from './earthcoach-result-capture';
import { GeoImage, LoggingTask, UserObservation } from './earthcoach-types';
import {
    applicableProposalIndexes,
    EarthCoachCarriedCorrection,
    findUncoveredSnapshotTasks,
    isFinalAnswerEdited,
    proposalApplyBlocker,
    proposalDiffersFromAi,
    proposalNumber,
    revertProposalPatch,
    trailingNumericId,
} from './earthcoach-workspace-logic';
import { EarthCoachRefineFocus, EarthCoachResult, EarthCoachResultProposal } from './earthcoach-workspace-types';

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

const QUESTION_TYPE_LABELS: Record<string, string> = {
    knowledge: 'Connaissance',
    photo: 'Photo',
    field: 'Terrain',
};

const BASIS_LABELS: Record<string, string> = {
    observation: 'observation',
    photo: 'photo',
    listing: 'listing',
    geology: 'géologie',
    tool: 'outil',
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
/** Reponse de l'utilisateur a une proposition : precision libre et/ou nouvelles photos. */
export interface EarthCoachProposalReply {
    text: string;
    files: File[];
}

export interface EarthCoachResultCardHandlers {
    onToggle(resultId: number, open: boolean): void;
    onUpdateProposal(resultId: number, proposalIndex: number, patch: Partial<EarthCoachResultProposal>): void;
    onMoveAnswerToMissing(resultId: number, proposalIndex: number): void;
    onRefineProposal(resultId: number, proposalIndex: number, focus: EarthCoachRefineFocus): void;
    /** Resout `true` quand la reponse est partie dans le chat ; le widget efface alors le brouillon. */
    onReplyProposal(resultId: number, proposalIndex: number, reply: EarthCoachProposalReply): Promise<boolean>;
    /** Brouillon de reponse : garde par le widget pour survivre au repli du resultat. */
    onReplyDraftChange(resultId: number, proposalIndex: number, draft: EarthCoachProposalReply): void;
    onApply(resultId: number, proposalIndex: number): void;
    onApplyAll(resultId: number): void;
    onGenerateFinal(resultId: number): void;
    onSaveNote(result: EarthCoachResult): void;
    onCopyFinal(finalAnswer: string): void;
    /** Copie le message puis ouvre le centre de messages Geocaching.com adressé au propriétaire. */
    onCopyFinalAndMessage(finalAnswer: string): void;
    /** Retouche du message final : gardée en brouillon par le widget, enregistrée après une pause. */
    onFinalAnswerChange(resultId: number, text: string): void;
    onRevertFinal(resultId: number): void;
    onFinalLanguageChange(choice: string): void;
    onOpenConversation(sessionId: string): void;
    onSetReference(resultId: number, reference: boolean): void;
    onDeleteResult(resultId: number): void;
    /** Reprend les corrections d'une résolution précédente sur ces questions. */
    onApplyCarried(resultId: number, proposalIndexes: number[]): void;
}

export interface EarthCoachResultCardProps {
    result: EarthCoachResult;
    expanded: boolean;
    dirty: boolean;
    /** Une generation de reponse finale est en cours (tous resultats confondus). */
    finalBusy: boolean;
    generatingFinal: boolean;
    /** Une reprise ciblee (approfondir / contester) est en preparation. */
    refineBusy: boolean;
    images: GeoImage[];
    observations: UserObservation[];
    loggingTasks: LoggingTask[];
    /** `auto` ou un code de langue imposé pour le message au propriétaire. */
    finalLanguageChoice: string;
    /** Langue retenue en automatique, si le listing permet de la déduire. */
    autoFinalLanguage?: string;
    /** Photos à joindre au log, déjà jointes en une ligne (prop primitive pour `React.memo`). */
    photoReminder?: string;
    /** Brouillons de réponse par index de proposition (référence stable tant qu'ils ne changent pas). */
    replyDrafts: ReadonlyMap<number, EarthCoachProposalReply>;
    /** Retouche du message final pas encore enregistrée. */
    finalDraft?: string;
    /** Corrections d'une résolution précédente reportables, par index de proposition. */
    carried: ReadonlyMap<number, EarthCoachCarriedCorrection>;
    handlers: EarthCoachResultCardHandlers;
}

/** Numero et lieu en tete : deux stations peuvent poser la meme question mot pour mot. */
function QuestionTitle(props: { number?: number; proposal: EarthCoachResultProposal }): React.ReactElement {
    const location = props.proposal.location?.trim();
    return <strong className='ecw-question-title'>
        {props.number !== undefined && <span className='ecw-question-number'>Q{props.number}</span>}
        {location && <span className='ecw-location' title='Lieu auquel la question se rapporte'>{location}</span>}
        <span>{props.proposal.question}</span>
    </strong>;
}

const STATUS_ORDER: Array<EarthCoachResultProposal['status']> = ['ready', 'partial', 'missing'];

/** Pastille d'état : la couleur suffit à repérer d'un coup d'œil ce qui attend l'utilisateur. */
function StatusPill(props: { status: EarthCoachResultProposal['status']; children?: React.ReactNode }): React.ReactElement {
    return <span className={`ecw-status ecw-status-${props.status}`}>
        {props.children ?? STATUS_LABELS[props.status] ?? props.status}
    </span>;
}

function countAwaiting(proposals: EarthCoachResultProposal[]): number {
    return proposals.filter(proposal => proposal.status !== 'ready').length;
}

/** Bilan en tête de résolution : « 3 prêtes · 1 partielle · 2 manquantes ». */
function StatusSummary(props: { proposals: EarthCoachResultProposal[] }): React.ReactElement | null {
    const counts = STATUS_ORDER
        .map(status => ({ status, count: props.proposals.filter(proposal => proposal.status === status).length }))
        .filter(item => item.count > 0);
    if (!counts.length) {
        return null;
    }
    const awaiting = countAwaiting(props.proposals);
    return <div className='ecw-status-summary'>
        {counts.map(({ status, count }) => <StatusPill key={status} status={status}>
            {count} {STATUS_LABELS[status].toLowerCase()}{count > 1 ? 's' : ''}
        </StatusPill>)}
        <span className='ecw-muted'>{awaiting
            ? `${awaiting} question${awaiting > 1 ? 's attendent' : ' attend'} votre réponse`
            : 'Toutes les réponses sont prêtes'}</span>
    </div>;
}

/**
 * Dialogue sur une question : l'utilisateur precise ce qu'il a (ou n'a pas)
 * et peut joindre des photos. EarthCoach reprend alors cette seule question.
 * Ouvert d'office quand le modele attend quelque chose, replie sinon.
 */
const EMPTY_REPLY: EarthCoachProposalReply = { text: '', files: [] };

function ProposalReply(props: {
    status: EarthCoachResultProposal['status'];
    busy: boolean;
    draft?: EarthCoachProposalReply;
    onChange(draft: EarthCoachProposalReply): void;
    onSend(reply: EarthCoachProposalReply): Promise<boolean>;
}): React.ReactElement {
    const awaiting = props.status !== 'ready';
    const { text, files } = props.draft || EMPTY_REPLY;
    const [open, setOpen] = React.useState(awaiting || Boolean(text || files.length));
    const inputRef = React.useRef<HTMLInputElement>(null);
    const setText = (value: string) => props.onChange({ text: value, files });
    const setFiles = (value: File[]) => props.onChange({ text, files: value });
    if (!open) {
        return <div className='ecw-row'>
            <button className='theia-button secondary' onClick={() => setOpen(true)}>Répondre à EarthCoach…</button>
        </div>;
    }
    const canSend = !props.busy && (text.trim().length > 0 || files.length > 0);
    const send = () => props.onSend({ text, files });
    return <div className='ecw-reply'>
        <label>Votre réponse à EarthCoach
            <textarea className='theia-input' rows={2} value={text}
                placeholder='Ex. : je n’ai pas de meilleure photo — ou décrivez ce que vous avez observé sur place'
                onChange={event => setText(event.currentTarget.value)} />
        </label>
        {files.length > 0 && <div className='ecw-reply-files'>
            {files.map((file, index) => <span key={`${file.name}-${index}`} className='ecw-reply-file'>
                📷 {file.name}
                <button className='ecw-reply-remove' title='Retirer cette photo'
                    onClick={() => setFiles(files.filter((_, position) => position !== index))}>×</button>
            </span>)}
        </div>}
        <div className='ecw-row'>
            <input ref={inputRef} type='file' accept='image/*' multiple hidden
                onChange={event => {
                    const picked = Array.from(event.currentTarget.files || []);
                    event.currentTarget.value = '';
                    setFiles([...files, ...picked]);
                }} />
            <button className='theia-button secondary' disabled={props.busy} onClick={() => inputRef.current?.click()}>Joindre une photo</button>
            {!awaiting && <button className='theia-button secondary' onClick={() => setOpen(false)}>Annuler</button>}
            <span className='ecw-grow' />
            <button className='theia-button' disabled={!canSend}
                title='La photo est ajoutée au dossier et rattachée à cette question, puis EarthCoach reprend la question avec votre réponse'
                onClick={() => { void send(); }}>{props.busy ? 'Envoi…' : 'Envoyer à EarthCoach'}</button>
        </div>
    </div>;
}

function carriedOrigin(correction: EarthCoachCarriedCorrection): string {
    const when = correction.createdAt ? ` du ${new Date(correction.createdAt).toLocaleDateString()}` : '';
    return correction.reference ? `la résolution de référence${when}` : `la résolution${when}`;
}

/** Correction faite sur une résolution précédente : la nouvelle repart de la version du modèle. */
function CarriedCorrection(props: { correction: EarthCoachCarriedCorrection; onApply(): void }): React.ReactElement {
    const { patch } = props.correction;
    const answer = patch.answer?.trim();
    return <div className='ecw-carried'>
        <span className='ecw-muted'>Vous aviez corrigé cette question dans {carriedOrigin(props.correction)} :</span>
        <span><StatusPill status={patch.status} />{' '}{answer ? `« ${answer.length > 160 ? `${answer.slice(0, 160)}…` : answer} »` : 'sans réponse'}</span>
        {patch.missing?.trim() && <span className='ecw-muted'>À compléter : {patch.missing}</span>}
        <div className='ecw-row'>
            <button className='theia-button secondary' title='Remplace l’état, la réponse et les éléments à compléter par votre correction'
                onClick={props.onApply}>Reprendre ma correction</button>
        </div>
    </div>;
}

/** Actions sur le résultat lui-même : conversation, référence, suppression. */
function ResultToolbar(props: EarthCoachResultCardProps): React.ReactElement {
    const { result, handlers } = props;
    const sessionId = result.session_id?.trim();
    return <div className='ecw-row'>
        {sessionId && <button className='theia-button secondary' title='Ouvre dans le chat la conversation qui a produit ce résultat'
            onClick={() => handlers.onOpenConversation(sessionId)}>Ouvrir la conversation</button>}
        {result.action === 'resolve' && <button className='theia-button secondary'
            title={result.is_reference
                ? 'Ce résultat ne sera plus mis en avant'
                : 'Place ce résultat en tête du dossier ; ses corrections seront proposées aux prochaines résolutions'}
            onClick={() => handlers.onSetReference(result.id, !result.is_reference)}>
            {result.is_reference ? 'Ne plus en faire la référence' : 'Marquer comme référence'}
        </button>}
        <span className='ecw-grow' />
        <button className='theia-button secondary' disabled={props.generatingFinal}
            onClick={() => handlers.onDeleteResult(result.id)}>Supprimer ce résultat</button>
    </div>;
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
    // Sans question enregistrée, aucune réponse ne peut être reportée : on le
    // dit une fois plutôt que de laisser des boutons grisés sans explication.
    const unregistered = result.proposals.some(proposal =>
        proposal.status === 'ready' && trailingNumericId(proposal.task_id) === undefined
    );
    const carriedIndexes = [...props.carried.keys()];
    return <>
        <ResultToolbar {...props} />
        <StatusSummary proposals={result.proposals} />
        {carriedIndexes.length > 0 && <div className='ecw-carried'>
            <span>{carriedIndexes.length > 1
                ? `${carriedIndexes.length} questions ont été corrigées par vous dans une résolution précédente.`
                : 'Une question a été corrigée par vous dans une résolution précédente.'}</span>
            <div className='ecw-row'>
                <button className='theia-button secondary' onClick={() => handlers.onApplyCarried(result.id, carriedIndexes)}>
                    {carriedIndexes.length > 1 ? `Reprendre mes ${carriedIndexes.length} corrections` : 'Reprendre ma correction'}
                </button>
            </div>
        </div>}
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
        {unregistered && <div className='ecw-muted'>
            Certaines réponses ne sont rattachées à aucune question enregistrée : enregistrez les questions (« Gérer les questions ») puis relancez la résolution pour pouvoir les reporter.
        </div>}
        {result.proposals.map((proposal, proposalIndex) => {
            const position = proposalNumber(proposal, result.snapshot_tasks, props.loggingTasks);
            const ai = result.ai_proposals?.[proposalIndex];
            const edited = proposalDiffersFromAi(proposal, ai);
            const applyBlocker = proposalApplyBlocker(proposal);
            const founded = [
                ...(proposal.basis || []).map(basis => BASIS_LABELS[basis] || basis),
                ...(proposal.evidence_ids || []).map(id => describeEarthCoachEvidence(id, props.images, props.observations)),
            ];
            const meta = [
                proposal.question_type ? QUESTION_TYPE_LABELS[proposal.question_type] || proposal.question_type : '',
                proposal.confidence ? `Confiance ${CONFIDENCE_LABELS[proposal.confidence] || proposal.confidence}` : '',
                founded.length ? `Fondée sur : ${founded.join(', ')}` : '',
            ].filter(Boolean).join(' · ');
            return <div key={`${result.id}-${proposalIndex}`} className={`ecw-proposal ecw-proposal-${proposal.status}`}>
                <div className='ecw-question'>
                    <div className='ecw-question-head'>
                        <QuestionTitle number={position} proposal={proposal} />
                        <StatusPill status={proposal.status}>
                            {STATUS_LABELS[proposal.status] || proposal.status}{proposal.status !== 'ready' ? ' · votre réponse attendue' : ''}
                        </StatusPill>
                    </div>
                    {proposal.question_translation && proposal.question_translation.trim() !== proposal.question.trim() &&
                        <div className='ecw-translation'><span>Traduction :</span> {proposal.question_translation}</div>}
                </div>
                {props.carried.get(proposalIndex) && <CarriedCorrection correction={props.carried.get(proposalIndex)!}
                    onApply={() => handlers.onApplyCarried(result.id, [proposalIndex])} />}
                {meta && <div className='ecw-muted ecw-evidence'>{meta}</div>}
                {proposal.reasoning?.trim() && <div className='ecw-muted'>{proposal.reasoning}</div>}
                <label>État<select className='theia-select' value={proposal.status}
                    onChange={event => handlers.onUpdateProposal(result.id, proposalIndex, { status: event.currentTarget.value as EarthCoachResultProposal['status'] })}>
                    <option value='ready'>Prête</option><option value='partial'>Partielle</option><option value='missing'>Manquante</option>
                </select></label>
                <label>Réponse candidate — uniquement ce qui répond à la question<textarea className='theia-input' rows={4} value={proposal.answer || ''}
                    onChange={event => handlers.onUpdateProposal(result.id, proposalIndex, { answer: event.currentTarget.value })} /></label>
                <label className='ecw-missing-field'>Éléments à compléter — actions, mesures ou informations manquantes<textarea className='theia-input' rows={2} value={proposal.missing || ''}
                    placeholder='Ex. mesurer l’épaisseur sur place'
                    onChange={event => handlers.onUpdateProposal(result.id, proposalIndex, { missing: event.currentTarget.value || null })} /></label>
                <ProposalReply status={proposal.status} busy={props.refineBusy} draft={props.replyDrafts.get(proposalIndex)}
                    onChange={draft => handlers.onReplyDraftChange(result.id, proposalIndex, draft)}
                    onSend={reply => handlers.onReplyProposal(result.id, proposalIndex, reply)} />
                <div className='ecw-row'>
                    <button className='theia-button secondary' disabled={props.refineBusy}
                        title='Relance une résolution ciblée sur cette seule question, avec les outils à disposition'
                        onClick={() => handlers.onRefineProposal(result.id, proposalIndex, 'deepen')}>Approfondir</button>
                    <button className='theia-button secondary' disabled={props.refineBusy}
                        title='Demande au modèle de réexaminer cette question de façon critique'
                        onClick={() => handlers.onRefineProposal(result.id, proposalIndex, 'contest')}>Contester</button>
                    <button className='theia-button secondary' disabled={!proposal.answer?.trim()}
                        onClick={() => handlers.onMoveAnswerToMissing(result.id, proposalIndex)}>Déplacer la réponse vers « À compléter »</button>
                    {edited && ai && <button className='theia-button secondary' title='Annule vos corrections sur cette question'
                        onClick={() => handlers.onUpdateProposal(result.id, proposalIndex, revertProposalPatch(ai))}>Revenir à la version IA</button>}
                    <span className='ecw-grow' />
                    <button className='theia-button' disabled={applyBlocker !== undefined}
                        title={applyBlocker ?? 'Enregistre cette réponse dans la question'}
                        onClick={() => handlers.onApply(result.id, proposalIndex)}>Reporter dans la question</button>
                </div>
            </div>;
        })}
        <div className='ecw-final-answer'>
            <button className='theia-button' disabled={props.finalBusy} onClick={() => handlers.onGenerateFinal(result.id)}>
                {props.generatingFinal ? 'Préparation…' : (result.final_answer || result.final_answer_generated ? 'Régénérer la réponse finale' : 'Générer la réponse finale avec mes corrections')}
            </button>
            <button className='theia-button secondary' onClick={() => handlers.onSaveNote(result)}>Enregistrer la synthèse dans les notes</button>
            <label>Langue du message <select className='theia-select' value={props.finalLanguageChoice}
                title='Automatique : votre langue si le listing la propose, sinon l’anglais'
                onChange={event => handlers.onFinalLanguageChange(event.currentTarget.value)}>
                <option value='auto'>{props.autoFinalLanguage
                    ? `Automatique — ${labelFor(props.autoFinalLanguage)}`
                    : 'Automatique — la vôtre si c’est celle du poseur, sinon English'}</option>
                {EARTHCOACH_LANGUAGE_OPTIONS.map(language => <option key={language.value} value={language.value}>{language.label}</option>)}
            </select></label>
        </div>
        {props.photoReminder && <div className='ecw-muted'>📷 Pense à joindre au log : {props.photoReminder}</div>}
        <FinalAnswer {...props} />
    </>;
}

/**
 * Message au propriétaire, modifiable sur place : plus besoin de le copier
 * ailleurs pour corriger une phrase. Le message généré reste la référence.
 */
function FinalAnswer(props: EarthCoachResultCardProps): React.ReactElement | null {
    const { result, handlers } = props;
    if (!result.final_answer && !result.final_answer_generated && props.finalDraft === undefined) {
        return null;
    }
    const message = props.finalDraft ?? result.final_answer ?? '';
    const edited = isFinalAnswerEdited(message, result.final_answer_generated);
    const rows = Math.min(24, Math.max(6, message.split('\n').length + 1));
    const canSend = message.trim().length > 0;
    return <div className='ecw-proposal'>
        <div className={result.final_answer_control ? 'ecw-final-pair' : undefined}>
            <div className='ecw-final-part'>
                <div className='ecw-question'><strong>Réponse finale prête à envoyer</strong>
                    <span className='ecw-muted'>{edited ? 'Retouchée par vous.' : 'Vous pouvez la retoucher directement ici.'}</span></div>
                <textarea className='theia-input ecw-final-text' rows={rows} value={message}
                    aria-label='Réponse finale au propriétaire'
                    onChange={event => handlers.onFinalAnswerChange(result.id, event.currentTarget.value)} />
            </div>
            {result.final_answer_control && <div className='ecw-final-part ecw-final-control'>
                <div className='ecw-question'><strong>Version de contrôle dans votre langue</strong>
                    <span className='ecw-muted'>{edited
                        ? 'Traduit le message généré : vos retouches n’y figurent pas.'
                        : 'Pour relire avant envoi — elle n’est pas copiée.'}</span></div>
                <pre>{result.final_answer_control}</pre>
            </div>}
        </div>
        <div className='ecw-row'>
            <button className='theia-button' disabled={!canSend}
                title='Copie le message, puis ouvre la messagerie Geocaching.com adressée au propriétaire : il ne reste qu’à coller'
                onClick={() => handlers.onCopyFinalAndMessage(message)}>Copier et écrire au propriétaire</button>
            <button className='theia-button secondary' disabled={!canSend} onClick={() => handlers.onCopyFinal(message)}>Copier la réponse</button>
            {edited && <button className='theia-button secondary' title='Annule vos retouches du message'
                onClick={() => handlers.onRevertFinal(result.id)}>Revenir au message généré</button>}
        </div>
    </div>;
}

function AnalysisBody(props: EarthCoachResultCardProps): React.ReactElement {
    const { result, handlers } = props;
    // L'analyse rend, par question, ce qu'il reste a relever : une liste de
    // travail terrain plutot que des formulaires de reponse.
    const todo = result.proposals
        .map(proposal => ({ proposal, position: proposalNumber(proposal, result.snapshot_tasks, props.loggingTasks) }))
        .filter(item => item.proposal.missing?.trim() || item.proposal.status !== 'ready')
        .sort((left, right) => (left.position ?? Number.MAX_SAFE_INTEGER) - (right.position ?? Number.MAX_SAFE_INTEGER));
    return <>
        <ResultToolbar {...props} />
        {todo.length > 0 && <div className='ecw-todo'>
            <strong>À relever sur le terrain</strong>
            <ul>{todo.map(({ proposal, position }, index) => <li key={index}>
                <StatusPill status={proposal.status} />{' '}
                <QuestionTitle number={position} proposal={proposal} />
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
    const awaiting = result.action === 'resolve' ? countAwaiting(result.proposals) : 0;
    return <details open={props.expanded} onToggle={event => {
        const open = event.currentTarget.open;
        if (open !== props.expanded) {
            handlers.onToggle(result.id, open);
        }
    }}>
        <summary>{result.is_reference && <><span className='ecw-reference' title='Résultat de référence'>★ Référence</span>{' · '}</>}
            {result.action === 'resolve' ? 'Résolution' : 'Analyse'} — {result.created_at ? new Date(result.created_at).toLocaleString() : result.request_id}
            {result.proposals_edited ? ' · corrigé' : ''}{props.dirty ? ' · modifications en cours…' : ''}
            {awaiting > 0 && <>{' '}<StatusPill status={result.proposals.some(proposal => proposal.status === 'missing') ? 'missing' : 'partial'}>
                {awaiting} en attente
            </StatusPill></>}</summary>
        {/* Contenu rendu seulement une fois deplie : les anciens resultats ne coutent rien. */}
        {props.expanded && (result.action === 'resolve' ? <ResolutionBody {...props} /> : <AnalysisBody {...props} />)}
    </details>;
});
