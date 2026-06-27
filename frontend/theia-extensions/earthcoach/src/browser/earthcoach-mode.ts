import { EarthCoachMode } from './earthcoach-types';

export const EARTHCOACH_MODE_LABELS: Record<EarthCoachMode, string> = {
    coach: 'coach',
    resolver: 'resolution',
};

export function normalizeEarthCoachMode(value: unknown): EarthCoachMode | undefined {
    if (value === 'resolver' || value === 'resolution') {
        return 'resolver';
    }
    if (value === 'coach') {
        return 'coach';
    }
    return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Renvoie une copie des settings de session avec le mode EarthCoach mis a jour,
 * en preservant le reste de `commonSettings.geoapp`. Pure et testable.
 */
export function applyEarthCoachModeToSettings(settings: unknown, mode: EarthCoachMode): Record<string, unknown> {
    const base = isRecord(settings) ? settings : {};
    const common = isRecord(base.commonSettings) ? base.commonSettings : {};
    const geoapp = isRecord(common.geoapp) ? common.geoapp : {};
    return {
        ...base,
        commonSettings: {
            ...common,
            geoapp: {
                ...geoapp,
                earthcoachMode: mode,
            },
        },
    };
}

/** Lit le mode EarthCoach courant dans des settings de session. */
export function readEarthCoachModeFromSettings(settings: unknown): EarthCoachMode {
    const base = isRecord(settings) ? settings : {};
    const common = isRecord(base.commonSettings) ? base.commonSettings : {};
    const geoapp = isRecord(common.geoapp) ? common.geoapp : {};
    return geoapp.earthcoachMode === 'resolver' ? 'resolver' : 'coach';
}
