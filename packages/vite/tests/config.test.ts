/** A port of the `Config::validate` unit tests in `packages/swc/src/lib.rs` */
import { resolveConfig } from '../src/config.ts';
import { transformBuildConditions } from '../src/transform.ts';

const SHAPE_ERROR =
    'build-conditions: options must be { groups: { [group]: string[] }, conditions: { [group]: string | null } }';

describe('resolveConfig', () => {
    test('a valid config builds the value → group map', () => {
        const config = resolveConfig({
            groups: { platform: ['desktop', 'mobile'], runtime: ['server', 'client'] },
            conditions: { platform: 'desktop', runtime: null },
        });

        expect(config.valueToGroup).toEqual(
            new Map([
                ['desktop', 'platform'],
                ['mobile', 'platform'],
                ['server', 'runtime'],
                ['client', 'runtime'],
            ])
        );
        expect(config.conditions).toEqual(
            new Map([
                ['platform', 'desktop'],
                ['runtime', null],
            ])
        );
    });

    test('an empty config is valid', () => {
        expect(resolveConfig({ groups: {}, conditions: {} }).valueToGroup.size).toBe(0);
    });

    test('a group missing from conditions', () => {
        expect(() => resolveConfig({ groups: { platform: ['desktop', 'mobile'] }, conditions: {} })).toThrow(
            "build-conditions: group 'platform' is present in groups but missing from conditions"
        );
    });

    test('a group missing from groups', () => {
        expect(() => resolveConfig({ groups: {}, conditions: { platform: 'desktop' } })).toThrow(
            "build-conditions: group 'platform' is present in conditions but missing from groups"
        );
    });

    test('a value in two groups', () => {
        expect(() =>
            resolveConfig({
                groups: { platform: ['desktop', 'mobile'], runtime: ['server', 'desktop'] },
                conditions: { platform: 'desktop', runtime: 'server' },
            })
        ).toThrow(
            "build-conditions: value 'desktop' belongs to two groups at once ('platform' and 'runtime'), values must be unique across groups"
        );
    });

    test('a chosen value outside its group', () => {
        expect(() =>
            resolveConfig({ groups: { platform: ['desktop', 'mobile'] }, conditions: { platform: 'tablet' } })
        ).toThrow("build-conditions: value 'tablet' does not belong to group 'platform'");
    });

    test.each([
        ['undefined', undefined],
        ['an array of groups', { groups: [], conditions: {} }],
        ['a non-string value', { groups: { platform: ['desktop', 1] }, conditions: { platform: 'desktop' } }],
        ['a non-string condition', { groups: { platform: ['desktop'] }, conditions: { platform: 1 } }],
    ])('an invalid shape: %s', (_, options) => {
        expect(() => resolveConfig(options)).toThrow(SHAPE_ERROR);
    });

    test('the unknown-value error lists the groups sorted', () => {
        const config = resolveConfig({
            groups: { runtime: ['server', 'client'], platform: ['desktop', 'mobile'] },
            conditions: { runtime: 'client', platform: 'desktop' },
        });
        const code =
            "import { isBuildConditions } from '@memebattle/build-conditions';\nisBuildConditions('tablet');\n";

        expect(transformBuildConditions(code, 'x.js', config).errors.map(error => error.message)).toEqual([
            "build-conditions: condition value 'tablet' is not found in any group of the config (groups: platform, runtime)",
        ]);
    });
});
