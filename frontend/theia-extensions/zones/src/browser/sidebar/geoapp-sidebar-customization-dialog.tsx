/**
 * Dialogue « Personnaliser les barres latérales » (spec §4.2, §5.7).
 *
 * Cases à cocher pilotées par `GeoAppSidebarController` — cocher attache et
 * révèle la vue, décocher la ferme ; le dialogue ne manipule jamais le DOM de
 * l'Activity Bar. Les groupes (Barre gauche / Barre droite / Autre
 * emplacement / Masquées) reflètent le layout courant, y compris après un
 * glisser-déposer natif.
 */

import * as React from 'react';
import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { DialogProps, ConfirmDialog } from '@theia/core/lib/browser/dialogs';
import { ReactDialog } from '@theia/core/lib/browser/dialogs/react-dialog';
import { nls } from '@theia/core/lib/common/nls';
import { GeoAppSidebarController, GeoAppSidebarViewPlacement } from './geoapp-sidebar-controller';
import { GeoAppSidebarViewDescriptor } from './geoapp-sidebar-views';

export class GeoAppSidebarCustomizationDialogProps extends DialogProps {
}

interface ViewGroup {
    readonly placement: GeoAppSidebarViewPlacement;
    readonly title: string;
}

const VIEW_GROUPS: readonly ViewGroup[] = [
    { placement: 'left', title: 'Barre gauche' },
    { placement: 'right', title: 'Barre droite' },
    { placement: 'other', title: 'Autre emplacement' },
    { placement: 'hidden', title: 'Masquées' },
];

@injectable()
export class GeoAppSidebarCustomizationDialog extends ReactDialog<undefined> {

    @inject(GeoAppSidebarController)
    protected readonly controller: GeoAppSidebarController;

    protected readonly closeButton: HTMLButtonElement;
    protected readonly resetButton: HTMLButtonElement;

    /** Vue en cours de bascule : sa case reste inactive le temps de l'opération. */
    protected busyViewId: string | undefined;
    protected actionError: string | undefined;

    constructor(
        @inject(GeoAppSidebarCustomizationDialogProps) protected override readonly props: GeoAppSidebarCustomizationDialogProps,
    ) {
        super(props);
        this.title.iconClass = 'codicon codicon-layout-sidebar-left';
        this.addClass('geoapp-sidebar-customization-dialog');

        this.resetButton = this.createButton('Restaurer les valeurs par défaut');
        this.resetButton.classList.add('secondary');
        this.controlPanel.insertBefore(this.resetButton, this.controlPanel.firstChild);
        this.addAction(this.resetButton, () => void this.requestReset(), 'click');

        this.closeButton = this.appendCloseButton('Fermer');
    }

    @postConstruct()
    protected init(): void {
        this.controller.onDidChange(() => this.update());
    }

    get value(): undefined {
        return undefined;
    }

    protected render(): React.ReactNode {
        const states = this.controller.getViewStates();
        return <React.Fragment>
            <p className="geoapp-sidebar-customize-help">
                Cochez les vues à afficher. Une vue visible peut ensuite être déplacée
                ou réordonnée par glisser-déposer dans les barres latérales.
            </p>
            {this.actionError && (
                <div className="geoapp-sidebar-customize-error" role="alert">
                    {this.actionError}
                </div>
            )}
            {VIEW_GROUPS.map(group => {
                const entries = states.filter(state => state.placement === group.placement);
                if (entries.length === 0) {
                    return undefined;
                }
                return <fieldset key={group.placement} className="geoapp-sidebar-customize-group">
                    <legend>{group.title}</legend>
                    <ul className="geoapp-sidebar-customize-list">
                        {entries.map(state => this.renderViewItem(state.descriptor, state.visible))}
                    </ul>
                </fieldset>;
            })}
        </React.Fragment>;
    }

    protected renderViewItem(descriptor: GeoAppSidebarViewDescriptor, visible: boolean): React.ReactNode {
        const inputId = `geoapp-sidebar-view-${descriptor.id.replace(/[^a-zA-Z0-9-]/g, '-')}`;
        return <li key={descriptor.id} className="geoapp-sidebar-customize-item">
            <input
                type="checkbox"
                id={inputId}
                checked={visible}
                disabled={this.busyViewId === descriptor.id}
                onChange={event => void this.toggleView(descriptor, event.currentTarget.checked)}
            />
            <label htmlFor={inputId}>
                <span className={`geoapp-sidebar-customize-icon ${descriptor.iconClass}`} aria-hidden="true" />
                {descriptor.label}
            </label>
        </li>;
    }

    protected async toggleView(descriptor: GeoAppSidebarViewDescriptor, visible: boolean): Promise<void> {
        this.busyViewId = descriptor.id;
        this.actionError = undefined;
        this.update();
        try {
            await this.controller.setViewVisible(descriptor, visible);
        } catch (error) {
            // La case est contrôlée par l'état réel du widget : après l'échec
            // elle reprend automatiquement sa valeur effective (pas d'état mensonger).
            console.error(`[GeoAppSidebar] Bascule impossible pour « ${descriptor.label} »`, error);
            this.actionError = `Impossible de ${visible ? 'afficher' : 'masquer'} « ${descriptor.label} ».`;
        } finally {
            this.busyViewId = undefined;
            this.update();
        }
    }

    protected async requestReset(): Promise<void> {
        const confirmed = await new ConfirmDialog({
            title: 'Restaurer les barres latérales',
            msg: 'Restaurer les vues latérales GeoApp à leur position et visibilité par défaut ? '
                + 'Les éditeurs, terminaux et autres panneaux ne sont pas affectés.',
            ok: 'Restaurer',
            cancel: 'Annuler',
        }).open();
        if (!confirmed) {
            return;
        }
        this.actionError = undefined;
        this.update();
        try {
            await this.controller.resetToDefaults();
        } catch (error) {
            console.error('[GeoAppSidebar] Échec du reset des barres latérales', error);
            this.actionError = nls.localize('geoapp/sidebar/reset-failed', 'La restauration des barres latérales a échoué.');
        }
        this.update();
    }
}
