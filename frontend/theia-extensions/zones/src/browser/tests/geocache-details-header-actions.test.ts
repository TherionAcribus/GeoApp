import * as assert from 'assert/strict';
import {
    GeocacheDetailsHeaderActionContribution,
    GeocacheDetailsHeaderActionRegistry,
    isEarthCacheGeocache,
} from '../geocache-details-header-actions';

class FakeContributionProvider {
    constructor(readonly contributions: GeocacheDetailsHeaderActionContribution[]) {}

    getContributions(): GeocacheDetailsHeaderActionContribution[] {
        return this.contributions;
    }
}

function createRegistry(contributions: GeocacheDetailsHeaderActionContribution[]): GeocacheDetailsHeaderActionRegistry {
    const registry = new GeocacheDetailsHeaderActionRegistry();
    (registry as any).contributionProvider = new FakeContributionProvider(contributions);
    return registry;
}

function testEarthCacheDetection(): void {
    assert.equal(isEarthCacheGeocache({ type: 'EarthCache' }), true);
    assert.equal(isEarthCacheGeocache({ type: 'Earth Cache' }), true);
    assert.equal(isEarthCacheGeocache({ type: 'Mystery Cache' }), false);
}

function testRegistryReturnsSortedActions(): void {
    const registry = createRegistry([
        {
            getGeocacheDetailsHeaderActions: () => [
                { id: 'b', label: 'B', order: '20', execute: () => undefined },
                { id: 'a', label: 'A', order: '10', execute: () => undefined },
            ],
        },
    ]);

    const actions = registry.getActions({
        geocacheData: {
            id: 1,
            name: 'Earth',
            type: 'EarthCache',
        },
    });

    assert.deepEqual(actions.map(action => action.id), ['a', 'b']);
}

function run(): void {
    testEarthCacheDetection();
    testRegistryReturnsSortedActions();
    // eslint-disable-next-line no-console
    console.log('geocache-details-header-actions tests passed');
}

run();
