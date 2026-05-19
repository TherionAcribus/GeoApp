import { inject, injectable, named } from '@theia/core/shared/inversify';
import { ContributionProvider } from '@theia/core/lib/common/contribution-provider';
import { GeocacheDto } from './geocache-details-types';

export interface GeocacheDetailsHeaderActionContext {
    geocacheData: GeocacheDto;
}

export interface GeocacheDetailsHeaderAction {
    id: string;
    label: string;
    title?: string;
    order?: string;
    className?: string;
    isEnabled?: (context: GeocacheDetailsHeaderActionContext) => boolean;
    execute: (context: GeocacheDetailsHeaderActionContext) => void | Promise<void>;
}

export interface GeocacheDetailsHeaderActionContribution {
    getGeocacheDetailsHeaderActions(context: GeocacheDetailsHeaderActionContext): GeocacheDetailsHeaderAction[];
}

export const GeocacheDetailsHeaderActionContribution = Symbol('GeocacheDetailsHeaderActionContribution');

@injectable()
export class GeocacheDetailsHeaderActionRegistry {

    @inject(ContributionProvider) @named(GeocacheDetailsHeaderActionContribution)
    protected readonly contributionProvider!: ContributionProvider<GeocacheDetailsHeaderActionContribution>;

    getActions(context: GeocacheDetailsHeaderActionContext): GeocacheDetailsHeaderAction[] {
        return this.contributionProvider.getContributions()
            .flatMap(contribution => contribution.getGeocacheDetailsHeaderActions(context))
            .sort((left, right) => (left.order || '').localeCompare(right.order || ''));
    }
}

export function isEarthCacheGeocache(geocacheData?: Pick<GeocacheDto, 'type'>): boolean {
    const type = (geocacheData?.type || '').toLowerCase().replace(/\s+/g, '');
    return type === 'earthcache' || type.includes('earthcache');
}
