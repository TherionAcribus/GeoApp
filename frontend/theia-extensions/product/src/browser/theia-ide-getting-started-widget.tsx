/********************************************************************************
 * Copyright (C) 2020 EclipseSource and others.
 *
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 *
 * SPDX-License-Identifier: MIT
 ********************************************************************************/

import * as React from 'react';

import { Message } from '@theia/core/lib/browser';
import { CommandService, PreferenceService } from '@theia/core/lib/common';
import { inject, injectable, optional } from '@theia/core/shared/inversify';
import { GettingStartedWidget } from '@theia/getting-started/lib/browser/getting-started-widget';
import { GeoAppAiSetupService, GeoAppAiSetupStatus } from 'theia-ide-zones-ext/lib/browser/geoapp-ai-setup-service';

interface WelcomeCard {
    commandId: string;
    icon: string;
    title: string;
    description: string;
    color: string;
}

const AI_SETUP_COMMAND_ID = 'geoapp.ai.setup.open';

const WELCOME_CARDS: WelcomeCard[] = [
    { commandId: 'zones:open',                  icon: 'codicon-layers',          title: 'Zones',         description: 'Gérer et organiser vos zones de géocaching',    color: '#3b82f6' },
    { commandId: 'geoapp.map.toggle',            icon: 'codicon-map',             title: 'Carte',         description: 'Visualiser les géocaches sur la carte',          color: '#22c55e' },
    { commandId: 'plugins.openBrowser',          icon: 'codicon-tools',           title: 'Plugins',       description: 'Outils de décodage, encodage et analyse',        color: '#f97316' },
    { commandId: 'alphabets.openList',           icon: 'codicon-symbol-text',     title: 'Alphabets',     description: 'Alphabets et codes secrets (66 disponibles)',    color: '#a855f7' },
    { commandId: 'geoapp.documentation.open',    icon: 'codicon-book',            title: 'Documentation', description: 'Aide, tutoriels et référence complète',          color: '#06b6d4' },
    { commandId: 'geoapp.calculator.open',       icon: 'codicon-symbol-operator', title: 'Calculatrice',  description: 'Calculs mathématiques pour coordonnées',         color: '#ec4899' },
    { commandId: AI_SETUP_COMMAND_ID,            icon: 'codicon-sparkle',         title: 'Configurer l\'IA', description: 'Choisir le fournisseur et le modèle des assistants', color: '#eab308' },
];

@injectable()
export class TheiaIDEGettingStartedWidget extends GettingStartedWidget {

    @inject(CommandService)
    protected readonly commandService: CommandService;

    @inject(PreferenceService)
    protected readonly preferenceService: PreferenceService;

    @inject(GeoAppAiSetupService) @optional()
    protected readonly aiSetupService: GeoAppAiSetupService | undefined;

    /** Indéfini tant que les fournisseurs n'ont pas fini d'enregistrer leurs modèles. */
    protected aiSetupStatus: GeoAppAiSetupStatus | undefined;
    /** « Plus tard » : masque le bandeau jusqu'au prochain démarrage. */
    protected aiSetupPostponed = false;

    protected async doInit(): Promise<void> {
        await super.doInit();
        await this.preferenceService.ready;
        this.update();
        this.watchAiSetup();
    }

    protected watchAiSetup(): void {
        const service = this.aiSetupService;
        if (!service) {
            return;
        }
        // Avant whenSettled, « non prête » serait un faux positif : le bandeau clignoterait.
        service.whenSettled.then(async () => {
            this.toDispose.push(service.onDidChangeStatus(status => {
                this.aiSetupStatus = status;
                this.update();
            }));
            this.aiSetupStatus = await service.getStatus();
            this.update();
        }).catch(error => console.debug('[GeoAppWelcome] état de l\'IA indisponible', error));
    }

    protected onActivateRequest(msg: Message): void {
        super.onActivateRequest(msg);
        const htmlElement = document.getElementById('alwaysShowWelcomePage');
        if (htmlElement) {
            htmlElement.focus();
        }
    }

    protected render(): React.ReactNode {
        return (
            <div className='geoapp-welcome'>
                <div className='geoapp-welcome-hero'>
                    <div className='geoapp-welcome-logo' />
                    <div className='geoapp-welcome-hero-text'>
                        <h1 className='geoapp-welcome-app-name'>GeoApp</h1>
                        <p className='geoapp-welcome-subtitle'>Application de Géocaching assistée par IA</p>
                    </div>
                </div>

                {this.renderAiSetup()}

                <p className='geoapp-welcome-section-label'>Accès rapide</p>

                <div className='geoapp-welcome-grid'>
                    {WELCOME_CARDS.map(card => this.renderCard(card))}
                </div>

                <div className='geoapp-welcome-tip'>
                    <span className='codicon codicon-lightbulb' />
                    <span>Utilisez <kbd className='geoapp-kbd'>Ctrl+Shift+P</kbd> pour accéder à toutes les commandes GeoApp</span>
                </div>

                <div className='gs-preference-container'>
                    {this.renderPreferences()}
                </div>
            </div>
        );
    }

    protected renderAiSetup(): React.ReactNode {
        const status = this.aiSetupStatus;
        if (!status || !status.aiEnabled) {
            return undefined;
        }
        const openSetup = (): void => { this.commandService.executeCommand(AI_SETUP_COMMAND_ID); };
        if (status.ready) {
            return (
                <div className='geoapp-welcome-ai-ready'>
                    <span className='codicon codicon-pass-filled' />
                    <span>IA prête{status.defaultModelLabel ? ` · ${status.defaultModelLabel}` : ''}</span>
                    <a href='#' onClick={event => { event.preventDefault(); openSetup(); }}>Modifier</a>
                </div>
            );
        }
        if (status.dismissed || this.aiSetupPostponed) {
            return undefined;
        }
        return (
            <div className='geoapp-welcome-ai-banner'>
                <span className='codicon codicon-sparkle' />
                <div className='geoapp-welcome-ai-banner-text'>
                    <strong>L'IA n'est pas encore configurée.</strong>
                    <span>Deux minutes suffisent pour activer l'assistant @Aide et les analyses.</span>
                </div>
                <div className='geoapp-welcome-ai-banner-actions'>
                    <button className='theia-button' onClick={openSetup}>Configurer l'IA</button>
                    <button className='theia-button secondary' onClick={() => { this.aiSetupPostponed = true; this.update(); }}>Plus tard</button>
                    <button
                        className='theia-button secondary'
                        onClick={() => { void this.aiSetupService?.setDismissed(true); this.aiSetupPostponed = true; this.update(); }}
                    >
                        Ne plus proposer
                    </button>
                </div>
            </div>
        );
    }

    protected renderCard(card: WelcomeCard): React.ReactNode {
        const handleClick = (): void => { this.commandService.executeCommand(card.commandId); };
        const handleKey = (e: React.KeyboardEvent): void => {
            if (e.key === 'Enter' || e.key === ' ') { this.commandService.executeCommand(card.commandId); }
        };
        return (
            <div
                key={card.commandId}
                className='geoapp-welcome-card'
                onClick={handleClick}
                onKeyDown={handleKey}
                role='button'
                tabIndex={0}
                title={card.title}
            >
                <div className='geoapp-welcome-card-icon' style={{ background: card.color }}>
                    <span className={`codicon ${card.icon}`} />
                </div>
                <div className='geoapp-welcome-card-body'>
                    <span className='geoapp-welcome-card-title'>{card.title}</span>
                    <span className='geoapp-welcome-card-desc'>{card.description}</span>
                </div>
            </div>
        );
    }
}
