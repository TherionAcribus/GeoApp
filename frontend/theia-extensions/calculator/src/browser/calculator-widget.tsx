import * as React from 'react';
import { useState, useRef, useCallback, useEffect } from 'react';
import { injectable, inject, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser';
import { CalculatorService, AngleUnit } from './calculator-service';

import './style/calculator.css';

// ── Types ─────────────────────────────────────────────────────────────────────

interface HistoryEntry {
    id: number;
    expression: string;
    result: string;
    angleUnit: AngleUnit;
}

type ButtonType = 'digit' | 'operator' | 'function' | 'memory' | 'clear' | 'equals' | 'special' | 'mode' | 'empty';

interface CalcBtn {
    label: string;
    label2?: string;
    insert: string;
    insert2?: string;
    action?: string;
    type: ButtonType;
}

// ── Button layout ─────────────────────────────────────────────────────────────

function btn(label: string, insert: string, type: ButtonType, label2?: string, insert2?: string): CalcBtn {
    return { label, insert, type, label2, insert2 };
}

function act(label: string, action: string, type: ButtonType): CalcBtn {
    return { label, insert: '', action, type };
}

const BUTTON_ROWS: CalcBtn[][] = [
    [
        act('2nd',  'SECOND',        'mode'),
        act('DEG',  'TOGGLE_ANGLE',  'mode'),
        act('MC',   'MC',            'memory'),
        act('MR',   'MR',            'memory'),
        act('M+',   'M+',            'memory'),
        act('M−',   'M-',            'memory'),
        { label: '', insert: '', type: 'empty' },
    ],
    [
        btn('sin',  'sin(',   'function',  'asin', 'asin('),
        btn('cos',  'cos(',   'function',  'acos', 'acos('),
        btn('tan',  'tan(',   'function',  'atan', 'atan('),
        btn('(',    '(',      'special'),
        btn(')',    ')',      'special'),
        btn('%',   '%',      'operator'),
        btn('÷',   '/',      'operator'),
    ],
    [
        btn('√',   'sqrt(',  'function',  '∛',   'cbrt('),
        btn('x²',  '^2',     'function',  'xʸ',  '^'),
        btn('n!',  '!',      'function'),
        btn('7',   '7',      'digit'),
        btn('8',   '8',      'digit'),
        btn('9',   '9',      'digit'),
        btn('×',   '*',      'operator'),
    ],
    [
        btn('log',  'log10(', 'function',  '10ˣ', '10^('),
        btn('ln',   'log(',   'function',  'eˣ',  'exp('),
        btn('1/x',  '1/(',    'function'),
        btn('4',   '4',      'digit'),
        btn('5',   '5',      'digit'),
        btn('6',   '6',      'digit'),
        btn('−',   '-',      'operator'),
    ],
    [
        btn('e',   'e',      'special'),
        btn('π',   'pi',     'special'),
        btn('abs', 'abs(',   'function'),
        btn('1',   '1',      'digit'),
        btn('2',   '2',      'digit'),
        btn('3',   '3',      'digit'),
        btn('+',   '+',      'operator'),
    ],
    [
        act('CE',  'CE',     'clear'),
        act('C',   'C',      'clear'),
        act('⌫',   'BACK',   'clear'),
        act('±',   'NEG',    'special'),
        btn('0',   '0',      'digit'),
        btn('.',   '.',      'digit'),
        act('=',   'EVAL',   'equals'),
    ],
];

// ── React Component ────────────────────────────────────────────────────────────

interface CalculatorAppProps {
    service: CalculatorService;
}

let _historyCounter = 0;

function CalculatorApp({ service }: CalculatorAppProps): React.ReactElement {
    const [expr, setExpr] = useState('');
    const [liveResult, setLiveResult] = useState('');
    const [hasError, setHasError] = useState(false);
    const [angleUnit, setAngleUnit] = useState<AngleUnit>('deg');
    const [isSecond, setIsSecond] = useState(false);
    const [memory, setMemory] = useState(0);
    const [history, setHistory] = useState<HistoryEntry[]>([]);
    const inputRef = useRef<HTMLInputElement>(null);

    // Live evaluation while typing
    useEffect(() => {
        if (!expr.trim()) {
            setLiveResult('');
            setHasError(false);
            return;
        }
        const res = service.evaluate(expr, angleUnit);
        if (res.error || !res.result) {
            setLiveResult('');
            setHasError(false);
        } else if (res.result !== expr) {
            setLiveResult(res.result);
            setHasError(false);
        } else {
            setLiveResult('');
            setHasError(false);
        }
    }, [expr, angleUnit]);

    // Insert text at cursor position in the expression input
    const insertAtCursor = useCallback((text: string) => {
        const input = inputRef.current;
        if (!input) {
            setExpr(prev => prev + text);
            return;
        }
        const start = input.selectionStart ?? expr.length;
        const end = input.selectionEnd ?? expr.length;
        const newExpr = expr.substring(0, start) + text + expr.substring(end);
        setExpr(newExpr);
        const pos = start + text.length;
        requestAnimationFrame(() => {
            input.focus();
            input.setSelectionRange(pos, pos);
        });
    }, [expr]);

    // Evaluate the current expression
    const evaluate = useCallback(() => {
        const trimmed = expr.trim();
        if (!trimmed) { return; }
        const res = service.evaluate(trimmed, angleUnit);
        if (!res.error && res.result) {
            const entry: HistoryEntry = {
                id: ++_historyCounter,
                expression: trimmed,
                result: res.result,
                angleUnit,
            };
            setHistory(prev => [entry, ...prev].slice(0, 30));
            setLiveResult('');
            setHasError(false);
            setExpr(res.result);
            requestAnimationFrame(() => {
                const input = inputRef.current;
                if (input) { input.select(); input.focus(); }
            });
        } else {
            setLiveResult(res.error ?? 'Erreur');
            setHasError(true);
        }
    }, [expr, angleUnit, service]);

    const handleAction = useCallback((action: string) => {
        switch (action) {
            case 'SECOND':
                setIsSecond(prev => !prev);
                return;
            case 'TOGGLE_ANGLE':
                setAngleUnit(prev => prev === 'deg' ? 'rad' : 'deg');
                return;
            case 'MC':
                setMemory(0);
                inputRef.current?.focus();
                return;
            case 'MR':
                insertAtCursor(String(memory));
                return;
            case 'M+': {
                const res = service.evaluate(expr, angleUnit);
                if (!res.error && res.numericResult !== undefined) {
                    setMemory(prev => prev + (res.numericResult ?? 0));
                }
                inputRef.current?.focus();
                return;
            }
            case 'M-': {
                const res = service.evaluate(expr, angleUnit);
                if (!res.error && res.numericResult !== undefined) {
                    setMemory(prev => prev - (res.numericResult ?? 0));
                }
                inputRef.current?.focus();
                return;
            }
            case 'CE':
            case 'C':
                setExpr('');
                setLiveResult('');
                setHasError(false);
                inputRef.current?.focus();
                return;
            case 'BACK': {
                const input = inputRef.current;
                if (input) {
                    const start = input.selectionStart ?? 0;
                    const end = input.selectionEnd ?? 0;
                    if (start !== end) {
                        const newExpr = expr.substring(0, start) + expr.substring(end);
                        setExpr(newExpr);
                        requestAnimationFrame(() => { input.setSelectionRange(start, start); input.focus(); });
                    } else if (start > 0) {
                        const newExpr = expr.substring(0, start - 1) + expr.substring(start);
                        setExpr(newExpr);
                        requestAnimationFrame(() => { input.setSelectionRange(start - 1, start - 1); input.focus(); });
                    }
                } else {
                    setExpr(prev => prev.slice(0, -1));
                }
                return;
            }
            case 'NEG':
                if (expr) {
                    if (expr.startsWith('-(') && expr.endsWith(')')) {
                        setExpr(expr.slice(2, -1));
                    } else if (expr.startsWith('-') && !expr.includes(' ')) {
                        setExpr(expr.slice(1));
                    } else {
                        setExpr('-(' + expr + ')');
                    }
                }
                inputRef.current?.focus();
                return;
            case 'EVAL':
                evaluate();
                return;
        }
    }, [expr, angleUnit, memory, service, evaluate, insertAtCursor]);

    const handleButtonClick = useCallback((b: CalcBtn) => {
        if (b.action) {
            handleAction(b.action);
            return;
        }
        const text = (isSecond && b.insert2) ? b.insert2 : b.insert;
        if (text) { insertAtCursor(text); }
        if (isSecond && b.label2) { setIsSecond(false); }
    }, [isSecond, handleAction, insertAtCursor]);

    const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') { e.preventDefault(); evaluate(); }
        else if (e.key === 'Escape') { e.preventDefault(); setExpr(''); setLiveResult(''); setHasError(false); }
    }, [evaluate]);

    const handleHistoryClick = useCallback((entry: HistoryEntry) => {
        setExpr(entry.expression);
        setAngleUnit(entry.angleUnit);
        requestAnimationFrame(() => inputRef.current?.focus());
    }, []);

    const handleHistoryResultClick = useCallback((entry: HistoryEntry, e: React.MouseEvent) => {
        e.stopPropagation();
        insertAtCursor(entry.result);
    }, [insertAtCursor]);

    const renderButton = (b: CalcBtn, key: number) => {
        if (b.type === 'empty') {
            return <div key={key} className="calc-btn calc-btn--empty" />;
        }
        const isAngleBtn = b.action === 'TOGGLE_ANGLE';
        const isSecondBtn = b.action === 'SECOND';
        const label = isAngleBtn ? angleUnit.toUpperCase() : (isSecond && b.label2 ? b.label2 : b.label);
        const cls = [
            'calc-btn',
            `calc-btn--${b.type}`,
            isAngleBtn ? `calc-btn--angle-${angleUnit}` : '',
            (isSecondBtn && isSecond) ? 'calc-btn--second-active' : '',
        ].filter(Boolean).join(' ');
        return (
            <button key={key} className={cls} onClick={() => handleButtonClick(b)} title={b.label}>
                {label}
            </button>
        );
    };

    return (
        <div className="calc-root">
            {/* Display panel */}
            <div className="calc-display">
                <div className="calc-display__badges">
                    <span className={`calc-display__angle ${angleUnit === 'deg' ? 'calc-display__angle--deg' : 'calc-display__angle--rad'}`}>
                        {angleUnit.toUpperCase()}
                    </span>
                    {memory !== 0 && (
                        <span className="calc-display__mem" title={`Mémoire: ${memory}`}>M={memory}</span>
                    )}
                </div>
                <input
                    ref={inputRef}
                    className="calc-display__expr"
                    type="text"
                    value={expr}
                    onChange={e => setExpr(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Entrez ou tapez un calcul…"
                    spellCheck={false}
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="off"
                />
                <div className={`calc-display__result ${hasError ? 'calc-display__result--error' : ''}`}>
                    {liveResult || '\u00A0'}
                </div>
            </div>

            {/* Button grid */}
            <div className="calc-grid">
                {BUTTON_ROWS.map((row, ri) =>
                    row.map((b, ci) => renderButton(b, ri * 10 + ci))
                )}
            </div>

            {/* History */}
            {history.length > 0 && (
                <div className="calc-history">
                    <div className="calc-history__header">
                        <span className="calc-history__title">Historique</span>
                        <button
                            className="calc-history__clear"
                            onClick={() => setHistory([])}
                            title="Effacer l'historique"
                        >
                            ×
                        </button>
                    </div>
                    <div className="calc-history__list">
                        {history.map(entry => (
                            <div
                                key={entry.id}
                                className="calc-history__entry"
                                onClick={() => handleHistoryClick(entry)}
                                title="Cliquer pour réutiliser l'expression"
                            >
                                <span className="calc-history__entry-expr">{entry.expression}</span>
                                <span className="calc-history__entry-eq"> = </span>
                                <span
                                    className="calc-history__entry-result"
                                    onClick={e => handleHistoryResultClick(entry, e)}
                                    title="Cliquer pour insérer le résultat"
                                >
                                    {entry.result}
                                </span>
                                <span className={`calc-history__entry-unit calc-history__entry-unit--${entry.angleUnit}`}>
                                    {entry.angleUnit.toUpperCase()}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

// ── Theia ReactWidget ──────────────────────────────────────────────────────────

@injectable()
export class CalculatorWidget extends ReactWidget {

    static readonly ID = 'geoapp.calculator';
    static readonly LABEL = 'Calculatrice';

    @inject(CalculatorService)
    protected readonly calculatorService!: CalculatorService;

    @postConstruct()
    protected init(): void {
        this.id = CalculatorWidget.ID;
        this.title.label = CalculatorWidget.LABEL;
        this.title.caption = 'Calculatrice scientifique';
        this.title.iconClass = 'codicon codicon-symbol-operator';
        this.title.closable = true;
        this.addClass('calculator-widget');
        this.update();
    }

    protected render(): React.ReactNode {
        return <CalculatorApp service={this.calculatorService} />;
    }
}
