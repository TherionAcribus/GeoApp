/**
 * Export Markdown d'un plan de sortie.
 *
 * Deux documents différents sortent d'un même plan, et les confondre serait une erreur :
 *
 * - le **rapport rédigé** (`plan.markdown`) est ce que le modèle a écrit. Il se lit, il
 *   argumente, il cite ses sources ; c'est ce qu'on relit la veille au soir ;
 * - la **fiche de sortie** (ce module) est ce qu'on emporte : la checklist avec ses cases,
 *   les alertes, l'ordre de visite. Elle est générée depuis la structure, donc elle porte
 *   l'état coché, ce que le texte du modèle ne peut pas faire.
 *
 * Aucune dépendance : ni DOM, ni Theia, ni réseau. C'est ce qui permet de la tester
 * directement, et de la réutiliser si un autre format d'export vient un jour.
 */

import {
    OUTING_PLAN_ALERT_KIND_LABELS,
    OUTING_PLAN_CERTAINTY_LABELS,
    OUTING_PLAN_FLAG_BADGES,
    OUTING_PLAN_SEVERITY_LABELS,
    OutingPlanCertainty,
    OutingPlanRecord,
    OutingPlanSeverity,
    formatOutingMinutes,
} from './outing-plan-types';

const CERTAINTY_ORDER: OutingPlanCertainty[] = ['confirmed', 'probable', 'precaution'];
const SEVERITY_ORDER: OutingPlanSeverity[] = ['blocking', 'warning', 'info'];

/**
 * Fiche de sortie en Markdown, cases comprises.
 *
 * Les sections vides sont omises plutôt que rendues avec « aucun » : une fiche imprimée
 * qui tient sur une page est plus utile qu'une fiche exhaustive qu'on ne relit pas.
 */
export function buildOutingPlanMarkdown(record: OutingPlanRecord): string {
    const plan = record.plan;
    const checked = new Set(record.checked || []);
    const lines: string[] = [];

    const zone = record.zone_name || 'sélection';
    lines.push(`# Sortie — ${zone} — ${record.outing_date}`);
    lines.push('');

    if (plan.summary) {
        lines.push(plan.summary);
        lines.push('');
    }

    const budget = plan.time_budget;
    if (budget && budget.total_minutes) {
        const parts: string[] = [`total ${formatOutingMinutes(budget.total_minutes)}`];
        if (budget.on_site_minutes) {
            parts.push(`dont ${formatOutingMinutes(budget.on_site_minutes)} sur place`);
        }
        if (budget.travel_minutes) {
            parts.push(`${formatOutingMinutes(budget.travel_minutes)} de trajet`);
        }
        lines.push(`**Budget** : ${parts.join(', ')}.`);
        lines.push('');
    }

    if (plan.checklist.length > 0) {
        lines.push('## Checklist matériel');
        lines.push('');
        for (const certainty of CERTAINTY_ORDER) {
            const items = plan.checklist.filter(item => item.certainty === certainty);
            if (items.length === 0) {
                continue;
            }
            lines.push(`### ${OUTING_PLAN_CERTAINTY_LABELS[certainty]}`);
            lines.push('');
            for (const item of items) {
                const box = checked.has(item.key) ? '[x]' : '[ ]';
                const codes = item.gc_codes.length > 0 ? ` — ${item.gc_codes.join(', ')}` : '';
                const reason = item.reason ? ` _(${item.reason})_` : '';
                lines.push(`- ${box} ${item.item}${codes}${reason}`);
            }
            lines.push('');
        }
    }

    if (plan.alerts.length > 0) {
        lines.push('## Alertes');
        lines.push('');
        for (const severity of SEVERITY_ORDER) {
            const alerts = plan.alerts.filter(alert => alert.severity === severity);
            for (const alert of alerts) {
                const code = alert.gc_code ? `**${alert.gc_code}** — ` : '';
                const kind = OUTING_PLAN_ALERT_KIND_LABELS[alert.kind] || alert.kind;
                lines.push(
                    `- ${OUTING_PLAN_SEVERITY_LABELS[severity]} · ${kind} : ${code}${alert.message}`
                );
            }
        }
        lines.push('');
    }

    if (plan.order.length > 0) {
        lines.push('## Ordre de visite');
        lines.push('');
        plan.order.forEach((code, index) => lines.push(`${index + 1}. ${code}`));
        lines.push('');
    }

    if (plan.per_cache.length > 0) {
        lines.push('## Détail par cache');
        lines.push('');
        for (const entry of plan.per_cache) {
            const badges = entry.flags
                .map(flag => OUTING_PLAN_FLAG_BADGES[flag]?.label)
                .filter(Boolean);
            const duration = formatOutingMinutes(entry.minutes);
            const details = [
                entry.gear.length > 0 ? `matériel : ${entry.gear.join(', ')}` : '',
                duration ? `temps : ${duration}` : '',
                badges.length > 0 ? badges.join(' · ') : '',
                entry.note,
            ].filter(Boolean);
            lines.push(`- **${entry.gc_code}** — ${details.join(' — ') || 'rien à signaler'}`);
        }
        lines.push('');
    }

    if (plan.to_verify.length > 0) {
        lines.push('## À vérifier avant de partir');
        lines.push('');
        for (const item of plan.to_verify) {
            lines.push(`- [ ] ${item}`);
        }
        lines.push('');
    }

    lines.push('---');
    lines.push('');
    lines.push(footerLine(record));

    return lines.join('\n');
}

/**
 * Provenance, en pied de fiche.
 *
 * Elle n'est pas décorative : la fiche sort d'une analyse IA, à une date donnée, sur un
 * lot donné. Emportée sur le terrain trois semaines plus tard, elle doit dire d'où elle
 * vient — d'autant que la santé des caches, elle, a continué de bouger.
 */
function footerLine(record: OutingPlanRecord): string {
    const generated = record.updated_at || record.created_at;
    const when = generated ? formatDateTime(generated) : 'date inconnue';
    const model = record.model_name ? `, modèle ${record.model_name}` : '';
    const count = record.gc_codes.length;
    return `_Analyse IA GeoApp du ${when}${model} — ${count} géocache${count > 1 ? 's' : ''}. `
        + `Les recommandations viennent d'un modèle : vérifiez ce qui engage la sécurité._`;
}

function formatDateTime(iso: string): string {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) {
        return iso;
    }
    try {
        return date.toLocaleString('fr-FR', {
            day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
        });
    } catch {
        return iso;
    }
}

/** Nom de fichier proposé au téléchargement : trié naturellement dans un dossier. */
export function outingPlanFileName(record: OutingPlanRecord, kind: 'fiche' | 'rapport'): string {
    const zone = (record.zone_name || 'selection')
        .toLowerCase()
        .normalize('NFD')
        .split('')
        .filter(char => {
            const code = char.codePointAt(0) ?? 0;
            return code < 0x300 || code > 0x36f;
        })
        .join('')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'selection';
    return `sortie-${record.outing_date}-${zone}-${kind}.md`;
}
