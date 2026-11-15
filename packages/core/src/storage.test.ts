import { AsyncLocalStorage } from 'node:async_hooks';

import type { PartialBuildConditions } from './index';
import { getBuildConditions, isBuildConditions, setBuildConditions, setBuildConditionsStorage } from './index';
import { resetBuildConditionsStorage } from './testing';

// Restore the default storage so tests do not depend on execution order
beforeEach(() => {
    resetBuildConditionsStorage();
});

describe('default storage (globalThis)', () => {
    it('getBuildConditions throws when conditions are not set', () => {
        expect(() => getBuildConditions()).toThrow('build conditions are not set');
    });

    it('setBuildConditions writes to globalThis.__BUILD_CONDITIONS__', () => {
        setBuildConditions({ platform: 'desktop' });

        expect(globalThis.__BUILD_CONDITIONS__).toEqual({ platform: 'desktop' });
        expect(getBuildConditions()).toEqual({ platform: 'desktop' });
    });

    it('a repeated setBuildConditions merges the conditions', () => {
        setBuildConditions({ platform: 'desktop', runtime: 'client' });
        setBuildConditions({ platform: 'mobile' });

        expect(getBuildConditions()).toEqual({ platform: 'mobile', runtime: 'client' });
    });
});

describe('setBuildConditionsStorage', () => {
    it('replaces the conditions source for all helpers', () => {
        setBuildConditionsStorage({ get: () => ({ platform: 'mobile' }) });

        expect(getBuildConditions()).toEqual({ platform: 'mobile' });
        expect(isBuildConditions('mobile')).toBe(true);
    });

    it('setBuildConditions throws when the storage does not support writes', () => {
        setBuildConditionsStorage({ get: () => ({ platform: 'desktop' }) });

        expect(() => setBuildConditions({ platform: 'mobile' })).toThrow('storage does not support setBuildConditions');
    });

    it('an AsyncLocalStorage-backed storage isolates conditions of concurrent calls', async () => {
        const als = new AsyncLocalStorage<PartialBuildConditions>();
        setBuildConditionsStorage({ get: () => als.getStore() });

        const nextTick = () => new Promise<void>(resolve => setTimeout(resolve, 0));

        const run = (conditions: PartialBuildConditions) =>
            als.run(conditions, async () => {
                await nextTick();
                const first = getBuildConditions();
                await nextTick();
                const second = getBuildConditions();

                return { first, second };
            });

        const [desktop, mobile] = await Promise.all([
            run({ platform: 'desktop', runtime: 'server' }),
            run({ platform: 'mobile', runtime: 'server' }),
        ]);

        expect(desktop.first).toEqual({ platform: 'desktop', runtime: 'server' });
        expect(desktop.second).toEqual({ platform: 'desktop', runtime: 'server' });
        expect(mobile.first).toEqual({ platform: 'mobile', runtime: 'server' });
        expect(mobile.second).toEqual({ platform: 'mobile', runtime: 'server' });
    });

    it('outside AsyncLocalStorage.run the conditions count as not set', () => {
        const als = new AsyncLocalStorage<PartialBuildConditions>();
        setBuildConditionsStorage({ get: () => als.getStore() });

        expect(() => getBuildConditions()).toThrow('build conditions are not set');
    });
});

describe('resetBuildConditionsStorage', () => {
    it('restores the default storage and clears the conditions', () => {
        setBuildConditions({ platform: 'desktop' });
        setBuildConditionsStorage({ get: () => ({ platform: 'mobile' }) });

        resetBuildConditionsStorage();

        expect(() => getBuildConditions()).toThrow('build conditions are not set');

        // The default storage is active again — direct writes work
        setBuildConditions({ runtime: 'client' });
        expect(getBuildConditions()).toEqual({ runtime: 'client' });
    });
});
