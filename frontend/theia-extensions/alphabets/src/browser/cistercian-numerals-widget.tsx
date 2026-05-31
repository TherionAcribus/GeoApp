import * as React from '@theia/core/shared/react';
import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { MessageService } from '@theia/core';
import {
    CistercianDigits,
    CistercianPlace,
    cistercianValueFromDigits,
    clampCistercianDigit,
    clampCistercianValue,
    digitsFromCistercianValue,
    getCistercianPolylines,
    renderCistercianSvg
} from './cistercian-numerals-utils';
import './style/alphabets.css';

type CistercianTab = 'value' | 'symbol';

const PLACE_LABELS: Record<CistercianPlace, string> = {
    thousands: 'Milliers',
    hundreds: 'Centaines',
    tens: 'Dizaines',
    units: 'Unites'
};

const PLACE_HINTS: Record<CistercianPlace, string> = {
    thousands: 'bas gauche',
    hundreds: 'bas droit',
    tens: 'haut gauche',
    units: 'haut droit'
};

const PLACE_ORDER: CistercianPlace[] = ['thousands', 'hundreds', 'tens', 'units'];
const DIGITS = Array.from({ length: 10 }, (_, index) => index);

function valueForPlaceDigit(place: CistercianPlace, digit: number): number {
    if (place === 'thousands') {
        return digit * 1000;
    }
    if (place === 'hundreds') {
        return digit * 100;
    }
    if (place === 'tens') {
        return digit * 10;
    }
    return digit;
}

const CistercianPreview: React.FC<{ value: number; compact?: boolean }> = ({ value, compact }) => {
    const polylines = getCistercianPolylines(value);
    return (
        <svg
            className={compact ? 'cistercian-preview-svg compact' : 'cistercian-preview-svg'}
            viewBox='0 0 96 144'
            role='img'
            aria-label={`Nombre cistercien ${value}`}
        >
            <g fill='none' stroke='currentColor' strokeWidth={compact ? 7 : 8} strokeLinecap='round' strokeLinejoin='round'>
                <line x1='48' y1='12' x2='48' y2='132' />
                {polylines.map(polyline => (
                    <polyline
                        key={`${polyline.place}-${polyline.digit}`}
                        points={polyline.points.map(([x, y]) => `${x},${y}`).join(' ')}
                    />
                ))}
            </g>
        </svg>
    );
};

@injectable()
export class CistercianNumeralsWidget extends ReactWidget {

    static readonly ID = 'cistercian-numerals-widget';
    static readonly LABEL = 'Chiffres cisterciens';

    @inject(MessageService)
    protected readonly messageService!: MessageService;

    private activeTab: CistercianTab = 'value';
    private value = 1492;
    private digits: CistercianDigits = digitsFromCistercianValue(this.value);

    @postConstruct()
    protected init(): void {
        this.id = CistercianNumeralsWidget.ID;
        this.title.label = CistercianNumeralsWidget.LABEL;
        this.title.caption = 'Convertisseur de chiffres cisterciens';
        this.title.iconClass = 'fa fa-calculator';
        this.title.closable = true;
        this.update();
    }

    protected render(): React.ReactNode {
        const value = clampCistercianValue(this.value);
        const digits = digitsFromCistercianValue(value);

        return (
            <div className='cistercian-widget'>
                <div className='cistercian-header'>
                    <div>
                        <h2>Chiffres cisterciens</h2>
                        <div className='cistercian-subtitle'>
                            Un symbole compose encode une valeur de 0 a 9999.
                        </div>
                    </div>
                    <div className='cistercian-tabs'>
                        <button
                            className={this.activeTab === 'value' ? 'active' : ''}
                            onClick={() => this.setActiveTab('value')}
                        >
                            Valeur {'->'} symbole
                        </button>
                        <button
                            className={this.activeTab === 'symbol' ? 'active' : ''}
                            onClick={() => this.setActiveTab('symbol')}
                        >
                            Composer {'->'} valeur
                        </button>
                    </div>
                </div>

                <div className='cistercian-layout'>
                    <section className='cistercian-panel cistercian-preview-panel'>
                        <div className='cistercian-symbol-frame'>
                            <CistercianPreview value={value} />
                        </div>
                        <div className='cistercian-value-readout'>{value}</div>
                        <div className='cistercian-breakdown'>
                            {PLACE_ORDER.map(place => (
                                <span key={place}>
                                    {PLACE_LABELS[place]}: <strong>{digits[place]}</strong>
                                </span>
                            ))}
                        </div>
                        <div className='cistercian-actions'>
                            <button className='theia-button' onClick={() => this.copyText(String(value))}>
                                Copier valeur
                            </button>
                            <button className='theia-button secondary' onClick={() => this.copySvg(value)}>
                                Copier SVG
                            </button>
                        </div>
                    </section>

                    <section className='cistercian-panel'>
                        {this.activeTab === 'value' ? this.renderValueEditor(value) : this.renderSymbolComposer()}
                    </section>
                </div>
            </div>
        );
    }

    private renderValueEditor(value: number): React.ReactNode {
        return (
            <div className='cistercian-editor'>
                <h3>Entrer une valeur</h3>
                <label className='cistercian-field'>
                    <span>Nombre</span>
                    <input
                        type='number'
                        min={0}
                        max={9999}
                        step={1}
                        value={value}
                        onChange={event => this.setValue(Number(event.currentTarget.value))}
                    />
                </label>
                <input
                    type='range'
                    min={0}
                    max={9999}
                    step={1}
                    value={value}
                    onChange={event => this.setValue(Number(event.currentTarget.value))}
                />
                <div className='cistercian-help'>
                    Les unites se lisent en haut a droite, les dizaines en haut a gauche,
                    les centaines en bas a droite et les milliers en bas a gauche.
                </div>
            </div>
        );
    }

    private renderSymbolComposer(): React.ReactNode {
        return (
            <div className='cistercian-editor'>
                <h3>Composer le symbole</h3>
                <div className='cistercian-help cistercian-composer-help'>
                    Cliquez sur la tuile qui correspond au trait visible dans chaque quadrant du symbole.
                    La tuile 0 laisse le quadrant vide.
                </div>
                <div className='cistercian-digit-grid'>
                    {PLACE_ORDER.map(place => this.renderDigitSelector(place))}
                </div>
            </div>
        );
    }

    private renderDigitSelector(place: CistercianPlace): React.ReactNode {
        const selected = clampCistercianDigit(this.digits[place]);
        return (
            <div key={place} className='cistercian-digit-card'>
                <div className='cistercian-digit-title'>
                    <span>{PLACE_LABELS[place]}</span>
                    <small>{PLACE_HINTS[place]}</small>
                </div>
                <div className='cistercian-digit-buttons'>
                    {DIGITS.map(digit => (
                        <button
                            key={`${place}-${digit}`}
                            className={`cistercian-digit-option ${digit === selected ? 'selected' : ''}`}
                            onClick={() => this.setDigit(place, digit)}
                            title={`${PLACE_LABELS[place]}: ${digit}`}
                        >
                            <span className='cistercian-digit-option-symbol'>
                                <CistercianPreview value={valueForPlaceDigit(place, digit)} compact={true} />
                            </span>
                            <span className='cistercian-digit-option-label'>{digit}</span>
                        </button>
                    ))}
                </div>
            </div>
        );
    }

    private setActiveTab(tab: CistercianTab): void {
        this.activeTab = tab;
        this.update();
    }

    private setValue(rawValue: number): void {
        this.value = clampCistercianValue(rawValue);
        this.digits = digitsFromCistercianValue(this.value);
        this.update();
    }

    private setDigit(place: CistercianPlace, digit: number): void {
        this.digits = {
            ...this.digits,
            [place]: clampCistercianDigit(digit)
        };
        this.value = cistercianValueFromDigits(this.digits);
        this.update();
    }

    private copySvg(value: number): void {
        this.copyText(renderCistercianSvg(value), 'SVG copie dans le presse-papier.');
    }

    private copyText(text: string, message = 'Valeur copiee dans le presse-papier.'): void {
        if (!navigator?.clipboard) {
            this.messageService.warn('Presse-papier indisponible.');
            return;
        }

        void navigator.clipboard.writeText(text)
            .then(() => this.messageService.info(message))
            .catch(error => {
                console.error('[CistercianNumeralsWidget] Clipboard error', error);
                this.messageService.error('Impossible de copier dans le presse-papier.');
            });
    }
}
