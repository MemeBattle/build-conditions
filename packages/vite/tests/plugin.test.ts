import { buildConditions } from '../src/index.ts';
import { FIXED_OPTIONS } from './helpers.ts';
import { fakeContext, transformHook } from './plugin-context.ts';

const plugin = buildConditions(FIXED_OPTIONS);
const hook = transformHook(plugin);

const CHANGED = [
    "import { isBuildConditions } from '@memebattle/build-conditions';",
    "export const flag = isBuildConditions('desktop');",
    '',
].join('\n');

describe('buildConditions', () => {
    test('name and order', () => {
        expect(plugin.name).toBe('build-conditions');
        expect(plugin.enforce).toBe('pre');
        expect(plugin.apply).toBeUndefined();
    });

    test.each(['a.js', 'a.jsx', 'a.ts', 'a.tsx', 'a.mjs', 'a.cjs', 'a.mts', 'a.cts'])('the filter includes %s', id => {
        expect(hook.filter.id.include.test(`/src/${id}`)).toBe(true);
    });

    test.each(['a.css', 'a.vue', 'a.ts?raw'])('the filter does not include %s', id => {
        expect(hook.filter.id.include.test(`/src/${id}`)).toBe(false);
    });

    test('the filter excludes node_modules', () => {
        expect(hook.filter.id.exclude.test('/x/node_modules/y.ts')).toBe(true);
        expect(hook.filter.id.exclude.test('/x/src/y.ts')).toBe(false);
    });

    test('the code filter is the package name', () => {
        expect(hook.filter.code).toBe('@memebattle/build-conditions');
    });

    test('an unchanged file and a file without the package name return null', () => {
        const context = fakeContext();

        expect(
            hook.handler.call(context, "import { a } from '@memebattle/build-conditions';\na();\n", '/src/a.ts')
        ).toBeNull();
        expect(hook.handler.call(context, 'export const a = 1;\n', '/src/a.ts')).toBeNull();
    });

    test('a changed file returns code and a map', () => {
        const result = hook.handler.call(fakeContext(), CHANGED, '/src/a.ts') as {
            code: string;
            map: { sources: string[] };
        };

        expect(result.code).toBe('export const flag = true;\n');
        expect(result.map.sources).toEqual(['/src/a.ts']);
    });

    test('an id with a query is handled after stripping it', () => {
        const result = hook.handler.call(fakeContext(), CHANGED, '/src/a.ts?v=123') as {
            code: string;
            map: { sources: string[] };
        };

        expect(result.code).toBe('export const flag = true;\n');
        expect(result.map.sources).toEqual(['/src/a.ts']);
    });

    test('an invalid config throws the Rust message', () => {
        expect(() => buildConditions({ groups: { platform: ['desktop', 'mobile'] }, conditions: {} } as never)).toThrow(
            "build-conditions: group 'platform' is present in groups but missing from conditions"
        );
    });
});
