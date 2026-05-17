import { injectable } from '@theia/core/shared/inversify';
import { create, all } from 'mathjs';

export type AngleUnit = 'deg' | 'rad';

export interface CalcResult {
    expression: string;
    result: string;
    numericResult?: number;
    error?: string;
}

const mathBase = create(all, {});

function buildScope(angleUnit: AngleUnit): Record<string, unknown> {
    if (angleUnit === 'rad') { return {}; }
    const DEG = Math.PI / 180;
    const RAD = 180 / Math.PI;
    return {
        sin:  (x: number) => Math.sin(x * DEG),
        cos:  (x: number) => Math.cos(x * DEG),
        tan:  (x: number) => Math.tan(x * DEG),
        asin: (x: number) => Math.asin(x) * RAD,
        acos: (x: number) => Math.acos(x) * RAD,
        atan: (x: number) => Math.atan(x) * RAD,
        atan2: (y: number, x: number) => Math.atan2(y, x) * RAD,
        sinh: (x: number) => Math.sinh(x),
        cosh: (x: number) => Math.cosh(x),
        tanh: (x: number) => Math.tanh(x),
    };
}

@injectable()
export class CalculatorService {

    evaluate(expression: string, angleUnit: AngleUnit = 'rad'): CalcResult {
        if (!expression || !expression.trim()) {
            return { expression, result: '' };
        }
        try {
            const scope = buildScope(angleUnit);
            const raw = mathBase.evaluate(expression, scope);
            const numeric = typeof raw === 'number' ? raw : (typeof raw === 'object' && raw !== null && 'toNumber' in raw ? (raw as any).toNumber() : undefined);
            const result = this.formatValue(raw);
            return { expression, result, numericResult: numeric };
        } catch (e: any) {
            return { expression, result: 'Erreur', error: e?.message ?? String(e) };
        }
    }

    private formatValue(value: unknown): string {
        if (value === null || value === undefined) { return 'undefined'; }
        if (typeof value === 'boolean') { return String(value); }
        if (typeof value === 'string') { return value; }
        if (typeof value === 'number') { return this.formatNumber(value); }
        if (typeof value === 'object' && 'toNumber' in (value as any)) {
            return this.formatNumber((value as any).toNumber());
        }
        try {
            return mathBase.format(value as any, { precision: 14 });
        } catch {
            return String(value);
        }
    }

    private formatNumber(n: number): string {
        if (isNaN(n)) { return 'NaN'; }
        if (!isFinite(n)) { return n > 0 ? 'Infinity' : '-Infinity'; }
        const abs = Math.abs(n);
        if (abs !== 0 && (abs < 1e-10 || abs >= 1e13)) {
            return n.toExponential(10).replace(/\.?0+e/, 'e');
        }
        const str = parseFloat(n.toPrecision(14)).toString();
        return str;
    }
}
