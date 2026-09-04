/**
 * Panneau « Sortie » : le rapport d'analyse, rendu utilisable.
 *
 * Il répond à une question que le chat ne sait pas traiter : « qu'est-ce qu'il me reste à
 * mettre dans le sac ? ». D'où la seule interaction vraiment structurante de ce panneau,
 * la case à cocher — persistée côté serveur, donc retrouvée le lendemain matin, et
 * conservée quand l'analyse est relancée pour les lignes qui n'ont pas bougé.
 *
 * Le panneau n'invente rien : il affiche le plan tel que le serveur l'a normalisé. Ce
 * qu'il ajoute, c'est le contexte de provenance — quelle analyse, quand, sur combien de
 * caches — parce qu'une checklist sans date se croit valable indéfiniment.
 */

import * as React from 'react';
import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { MessageService } from '@theia/core';
import { ClipboardService } from '@theia/core/lib/browser/clipboard-service';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { ConfirmDialog } from '@theia/core/lib/browser';

import '../../src/browser/style/outing-plan.css';
import { OutingPlanCaptureService } from './outing-plan-capture';
import { buildOutingPlanMarkdown, outingPlanFileName } from './outing-plan-markdown';
import { OutingPlanService } from './outing-plan-service';
import {
    OUTING_PLAN_ALERT_KIND_LABELS,
    OUTING_PLAN_CERTAINTY_LABELS,
    OUTING_PLAN_SEVERITY_LABELS,
    OutingPlanCertainty,
    OutingPlanRecord,
    OutingPlanSeverity,
    badgesForFlags,
    formatOutingMinutes,
} from './outing-plan-types';

export const OutingPlanCommandId = 'geoapp.outing.plan.open';

const CERTAINTY_ORDER: OutingPlanCertainty[] = ['confirmed', 'probable', 'precaution'];
const SEVERITY_ORDER: OutingPlanSeverity[] = ['blocking', 'warning', 'info'];

@injectable()
export class OutingPlanWidget extends ReactWidget {

    static readonly ID = 'geoapp.outing.plan';

    protected plans: OutingPlanRecord[] = [];
    protected selected: OutingPlanRecord | undefined;
    protected isLoading = false;
    protected loadError: string | undefined;
    /** Coches en attente de confirmation serveur : l'UI ne doit pas attendre le réseau. */
    protected pendingChecked = new Set<string>();

    constructor(
        @inject(OutingPlanService) protected readonly planService: OutingPlanService,
        @inject(OutingPlanCaptureService) protected readonly capture: OutingPlanCaptureService,
        @inject(MessageService) protected readonly messages: MessageService,
        @inject(ClipboardService) protected readonly clipboard: ClipboardService,
    ) {
        super();
        this.id = OutingPlanWidget.ID;
        this.title.label = 'Sortie';
        this.title.caption = 'Checklist et alertes de la sortie analysée';
        this.title.closable = true;
        this.title.iconClass = 'fa fa-check-square-o';
        this.addClass('geoapp-outing-plan-widget');
    }

    @postConstruct()
    initialize(): void {
        // Une capture qui arrive pendant que le panneau est ouvert doit s'y afficher :
        // c'est exactement le moment où l'utilisateur regarde le résultat de son analyse.
        this.toDispose.push(this.capture.onDidCapture(result => {
            void this.reload(result.plan.id);
        }));
        void this.reload();
    }

    /** Recharge la liste, et sélectionne `planId` s'il est fourni. */
    async reload(planId?: number): Promise<void> {
        this.isLoading = true;
        this.loadError = undefined;
        this.update();
        try {
            this.plans = await this.planService.listPlans({ limit: 30 });
            const wanted = planId ?? this.selected?.id ?? this.plans[0]?.id;
            this.selected = wanted !== undefined ? await this.loadDetail(wanted) : undefined;
        } catch (error) {
            this.loadError = (error as Error)?.message ?? `${error}`;
        } finally {
            this.isLoading = false;
            this.update();
        }
    }

    /**
     * Charge le plan complet.
     *
     * La liste omet le Markdown, ce qui la garde légère ; le panneau, lui, en a besoin
     * pour l'export du rapport rédigé. D'où ce second appel sur le seul plan affiché.
     */
    protected async loadDetail(planId: number): Promise<OutingPlanRecord | undefined> {
        try {
            const plan = await this.planService.getPlan(planId);
            this.pendingChecked = new Set(plan.checked || []);
            return plan;
        } catch (error) {
            console.error('[OutingPlanWidget] Plan introuvable', error);
            return undefined;
        }
    }

    protected async selectPlan(planId: number): Promise<void> {
        this.selected = await this.loadDetail(planId);
        this.update();
    }

    /**
     * Coche ou décoche une ligne.
     *
     * L'affichage bascule tout de suite et le serveur suit : une case à cocher qui attend
     * un aller-retour donne l'impression de ne pas répondre. En cas d'échec, l'état est
     * remis tel que le serveur le connaît, et l'erreur est dite.
     */
    protected async toggleChecked(key: string): Promise<void> {
        const plan = this.selected;
        if (!plan) {
            return;
        }

        if (this.pendingChecked.has(key)) {
            this.pendingChecked.delete(key);
        } else {
            this.pendingChecked.add(key);
        }
        this.update();

        try {
            const updated = await this.planService.setChecked(plan.id, Array.from(this.pendingChecked));
            this.selected = { ...plan, checked: updated.checked };
            this.pendingChecked = new Set(updated.checked || []);
        } catch (error) {
            this.pendingChecked = new Set(plan.checked || []);
            this.messages.error(`Coche non enregistrée : ${(error as Error)?.message ?? error}`);
        } finally {
            this.update();
        }
    }

    protected async copyMarkdown(kind: 'fiche' | 'rapport'): Promise<void> {
        const text = this.markdownFor(kind);
        if (!text) {
            return;
        }
        try {
            await this.clipboard.writeText(text);
            this.messages.info(kind === 'fiche' ? 'Fiche de sortie copiée.' : 'Rapport copié.');
        } catch (error) {
            this.messages.error(`Copie impossible : ${(error as Error)?.message ?? error}`);
        }
    }

    protected downloadMarkdown(kind: 'fiche' | 'rapport'): void {
        const plan = this.selected;
        const text = this.markdownFor(kind);
        if (!plan || !text) {
            return;
        }

        const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = outingPlanFileName(plan, kind);
        document.body.appendChild(anchor);
        anchor.click();
        document.body.removeChild(anchor);
        // Sans révocation, le blob reste en mémoire tant que l'onglet vit.
        setTimeout(() => URL.revokeObjectURL(url), 0);
    }

    /**
     * Le texte à exporter.
     *
     * La fiche est toujours disponible : elle se génère depuis la structure. Le rapport
     * rédigé, lui, peut manquer — le tool ne le transmet pas, seule la lecture de la
     * réponse l'attache — et c'est un cas à expliquer, pas à masquer par un fichier vide.
     */
    protected markdownFor(kind: 'fiche' | 'rapport'): string | undefined {
        const plan = this.selected;
        if (!plan) {
            return undefined;
        }
        if (kind === 'fiche') {
            return buildOutingPlanMarkdown({ ...plan, checked: Array.from(this.pendingChecked) });
        }
        if (!plan.markdown) {
            this.messages.warn(
                'Le rapport rédigé n\'a pas été capturé pour cette sortie : seule la fiche '
                + 'structurée est disponible. Il est resté dans la conversation du chat.'
            );
            return undefined;
        }
        return plan.markdown;
    }

    protected async deleteSelected(): Promise<void> {
        const plan = this.selected;
        if (!plan) {
            return;
        }
        const confirmed = await new ConfirmDialog({
            title: 'Supprimer le plan de sortie',
            msg: `Supprimer l'analyse « ${plan.zone_name || 'sélection'} » du ${plan.outing_date} ? `
                + 'La conversation du chat, elle, reste.',
            ok: 'Supprimer',
            cancel: 'Annuler',
        }).open();

        if (!confirmed) {
            return;
        }

        try {
            await this.planService.deletePlan(plan.id);
            this.selected = undefined;
            await this.reload();
        } catch (error) {
            this.messages.error(`Suppression impossible : ${(error as Error)?.message ?? error}`);
        }
    }

    protected render(): React.ReactNode {
        return (
            <div className='geoapp-outing-plan-root'>
                {this.renderHeader()}
                {this.loadError && (
                    <div className='geoapp-outing-plan-error'>{this.loadError}</div>
                )}
                {this.isLoading && !this.selected && (
                    <div className='geoapp-outing-plan-empty'>Chargement…</div>
                )}
                {!this.isLoading && this.plans.length === 0 && this.renderNoPlans()}
                {this.selected && this.renderPlan(this.selected)}
            </div>
        );
    }

    protected renderHeader(): React.ReactNode {
        return (
            <div className='geoapp-outing-plan-header'>
                <div>
                    <h2>Sortie</h2>
                    <p>
                        Checklist, alertes et ordre de visite issus de la dernière analyse IA.
                    </p>
                </div>
                <div className='geoapp-outing-plan-header-actions'>
                    {this.plans.length > 0 && (
                        <select
                            value={this.selected?.id ?? ''}
                            onChange={event => void this.selectPlan(Number(event.target.value))}
                        >
                            {this.plans.map(plan => (
                                <option key={plan.id} value={plan.id}>
                                    {`${plan.outing_date} — ${plan.zone_name || 'sélection'} `
                                        + `(${plan.gc_codes.length})`}
                                </option>
                            ))}
                        </select>
                    )}
                    <button
                        className='theia-button secondary'
                        onClick={() => void this.reload()}
                        disabled={this.isLoading}
                    >
                        Rafraîchir
                    </button>
                </div>
            </div>
        );
    }

    protected renderNoPlans(): React.ReactNode {
        return (
            <div className='geoapp-outing-plan-empty'>
                <p>Aucune sortie analysée pour l'instant.</p>
                <p>
                    Lance « Analyser la sortie » depuis une sélection de géocaches ou depuis
                    le log-editor : le rapport s'affichera ici en plus du chat.
                </p>
            </div>
        );
    }

    protected renderPlan(plan: OutingPlanRecord): React.ReactNode {
        return (
            <>
                {this.renderProvenance(plan)}
                {this.renderExport(plan)}
                {this.renderChecklist(plan)}
                {this.renderAlerts(plan)}
                {this.renderPerCache(plan)}
                {this.renderRoute(plan)}
                {this.renderToVerify(plan)}
            </>
        );
    }

    /**
     * D'où vient ce plan.
     *
     * `source` est affiché parce qu'il diagnostique : un plan systématiquement « repêché »
     * signale que le tool de capture n'est pas exposé par la policy, ou que le modèle
     * l'ignore. C'est une information utile et invisible partout ailleurs.
     */
    protected renderProvenance(plan: OutingPlanRecord): React.ReactNode {
        const total = plan.plan.time_budget?.total_minutes;
        return (
            <div className='geoapp-outing-plan-provenance'>
                <span>{plan.zone_name || 'sélection'} — {plan.outing_date}</span>
                <span>{plan.gc_codes.length} géocache{plan.gc_codes.length > 1 ? 's' : ''}</span>
                {total ? <span>budget {formatOutingMinutes(total)}</span> : undefined}
                <span className='geoapp-outing-plan-source'>
                    {plan.source === 'parsed' ? 'repêché dans la réponse' : 'enregistré par le modèle'}
                </span>
                {plan.plan.summary && (
                    <p className='geoapp-outing-plan-summary'>{plan.plan.summary}</p>
                )}
            </div>
        );
    }

    protected renderExport(plan: OutingPlanRecord): React.ReactNode {
        return (
            <div className='geoapp-outing-plan-export'>
                <button className='theia-button secondary' onClick={() => void this.copyMarkdown('fiche')}>
                    Copier la fiche
                </button>
                <button className='theia-button secondary' onClick={() => this.downloadMarkdown('fiche')}>
                    Télécharger la fiche
                </button>
                <button
                    className='theia-button secondary'
                    onClick={() => void this.copyMarkdown('rapport')}
                    title={plan.markdown
                        ? 'Le texte complet rédigé par le modèle'
                        : "Ce rapport n'a pas été capturé : il est resté dans le chat"}
                    disabled={!plan.markdown}
                >
                    Copier le rapport
                </button>
                <button
                    className='theia-button secondary'
                    onClick={() => this.downloadMarkdown('rapport')}
                    disabled={!plan.markdown}
                >
                    Télécharger le rapport
                </button>
                <button className='theia-button secondary' onClick={() => void this.deleteSelected()}>
                    Supprimer
                </button>
            </div>
        );
    }

    protected renderChecklist(plan: OutingPlanRecord): React.ReactNode {
        const checklist = plan.plan.checklist;
        if (checklist.length === 0) {
            return undefined;
        }

        const done = checklist.filter(item => this.pendingChecked.has(item.key)).length;

        return (
            <section className='geoapp-outing-plan-section'>
                <h3>Checklist matériel <span>{done}/{checklist.length}</span></h3>
                {CERTAINTY_ORDER.map(certainty => {
                    const items = checklist.filter(item => item.certainty === certainty);
                    if (items.length === 0) {
                        return undefined;
                    }
                    return (
                        <div key={certainty} className={`geoapp-outing-plan-group certainty-${certainty}`}>
                            <h4>{OUTING_PLAN_CERTAINTY_LABELS[certainty]}</h4>
                            <ul>
                                {items.map(item => (
                                    <li key={item.key}>
                                        <label>
                                            <input
                                                type='checkbox'
                                                checked={this.pendingChecked.has(item.key)}
                                                onChange={() => void this.toggleChecked(item.key)}
                                            />
                                            <span className='geoapp-outing-plan-item'>{item.item}</span>
                                        </label>
                                        {item.gc_codes.length > 0 && (
                                            <span className='geoapp-outing-plan-codes'>
                                                {item.gc_codes.join(', ')}
                                            </span>
                                        )}
                                        {item.reason && (
                                            <span className='geoapp-outing-plan-reason'>{item.reason}</span>
                                        )}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    );
                })}
            </section>
        );
    }

    protected renderAlerts(plan: OutingPlanRecord): React.ReactNode {
        const alerts = plan.plan.alerts;
        if (alerts.length === 0) {
            return undefined;
        }

        return (
            <section className='geoapp-outing-plan-section'>
                <h3>Alertes <span>{alerts.length}</span></h3>
                <ul className='geoapp-outing-plan-alerts'>
                    {SEVERITY_ORDER.flatMap(severity =>
                        alerts
                            .filter(alert => alert.severity === severity)
                            .map((alert, index) => (
                                <li key={`${severity}-${index}`} className={`severity-${severity}`}>
                                    <span className='geoapp-outing-plan-severity'>
                                        {OUTING_PLAN_SEVERITY_LABELS[severity]}
                                    </span>
                                    <span className='geoapp-outing-plan-kind'>
                                        {OUTING_PLAN_ALERT_KIND_LABELS[alert.kind] || alert.kind}
                                    </span>
                                    {alert.gc_code && (
                                        <span className='geoapp-outing-plan-codes'>{alert.gc_code}</span>
                                    )}
                                    <span>{alert.message}</span>
                                </li>
                            ))
                    )}
                </ul>
            </section>
        );
    }

    protected renderPerCache(plan: OutingPlanRecord): React.ReactNode {
        const entries = plan.plan.per_cache;
        if (entries.length === 0) {
            return undefined;
        }

        return (
            <section className='geoapp-outing-plan-section'>
                <h3>Détail par cache <span>{entries.length}</span></h3>
                <table className='geoapp-outing-plan-table'>
                    <thead>
                        <tr>
                            <th>Cache</th>
                            <th>Signaux</th>
                            <th>Matériel</th>
                            <th>Temps</th>
                        </tr>
                    </thead>
                    <tbody>
                        {entries.map(entry => (
                            <tr key={entry.gc_code}>
                                <td>{entry.gc_code}</td>
                                <td>
                                    {badgesForFlags(entry.flags).map(badge => (
                                        <span
                                            key={badge.label}
                                            className={`geoapp-outing-badge severity-${badge.severity}`}
                                            title={badge.label}
                                        >
                                            {badge.short}
                                        </span>
                                    ))}
                                </td>
                                <td>{entry.gear.join(', ')}</td>
                                <td>{formatOutingMinutes(entry.minutes)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                {entries.some(entry => entry.note) && (
                    <ul className='geoapp-outing-plan-notes'>
                        {entries.filter(entry => entry.note).map(entry => (
                            <li key={entry.gc_code}>
                                <strong>{entry.gc_code}</strong> — {entry.note}
                            </li>
                        ))}
                    </ul>
                )}
            </section>
        );
    }

    protected renderRoute(plan: OutingPlanRecord): React.ReactNode {
        if (plan.plan.order.length === 0) {
            return undefined;
        }
        return (
            <section className='geoapp-outing-plan-section'>
                <h3>Ordre de visite</h3>
                <ol className='geoapp-outing-plan-order'>
                    {plan.plan.order.map(code => <li key={code}>{code}</li>)}
                </ol>
            </section>
        );
    }

    protected renderToVerify(plan: OutingPlanRecord): React.ReactNode {
        if (plan.plan.to_verify.length === 0) {
            return undefined;
        }
        return (
            <section className='geoapp-outing-plan-section'>
                <h3>À vérifier avant de partir</h3>
                <ul>
                    {plan.plan.to_verify.map((item, index) => <li key={index}>{item}</li>)}
                </ul>
            </section>
        );
    }
}
