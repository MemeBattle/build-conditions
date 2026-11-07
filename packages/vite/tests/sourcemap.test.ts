/** Every kept or inserted-around token maps back to its original position */
import { readFileSync } from 'node:fs';

import { originalPositionFor, TraceMap } from '@jridgewell/trace-mapping';

import { transformBuildConditions } from '../src/transform.ts';
import { FIXED_CONFIG, caseDir } from './helpers.ts';

interface Position {
    line: number;
    column: number;
}

/** The index of the nth (0-based) occurrence of `needle` */
function indexOf(text: string, needle: string, nth = 0): number {
    let index = -1;

    for (let count = 0; count <= nth; count++) {
        index = text.indexOf(needle, index + 1);

        if (index === -1) {
            throw new Error(`occurrence ${nth} of ${JSON.stringify(needle)} not found in:\n${text}`);
        }
    }

    return index;
}

/** 1-based line, 0-based column, as trace-mapping expects */
function positionAt(text: string, index: number): Position {
    const lines = text.slice(0, index).split('\n');

    return { line: lines.length, column: (lines.at(-1) as string).length };
}

interface Expectation {
    /** The token in the output, and which occurrence of it */
    generated: [string, number?];
    /** The original token it must map to, and which occurrence of it */
    original: [string, number?];
}

function checkMappings(input: string, filename: string, expectations: Expectation[]): void {
    const result = transformBuildConditions(input, filename, FIXED_CONFIG);

    expect(result.errors).toEqual([]);
    expect(result.map).not.toBeNull();

    const map = result.map as NonNullable<typeof result.map>;

    expect(map.sourcesContent?.[0]).toBe(input);

    const tracer = new TraceMap(JSON.stringify(map));

    for (const { generated, original } of expectations) {
        const from = positionAt(result.code, indexOf(result.code, generated[0], generated[1]));
        const to = positionAt(input, indexOf(input, original[0], original[1]));
        const traced = originalPositionFor(tracer, from);

        expect({ token: generated[0], line: traced.line, column: traced.column }).toEqual({
            token: generated[0],
            ...to,
        });
    }
}

function fixture(name: string): string {
    return readFileSync(`${caseDir('fixed', name)}input.js`, 'utf8');
}

describe('sourcemap', () => {
    test('switch-inline: the winner and the first token after a removed import', () => {
        checkMappings(fixture('switch-inline'), 'input.js', [
            { generated: ['DesktopComponent;'], original: ['DesktopComponent,'] },
            { generated: ['export const'], original: ['export const'] },
        ]);
    });

    test('is-conditions: folded booleans map to their calls', () => {
        checkMappings(fixture('is-conditions'), 'input.js', [
            { generated: ['true', 0], original: ['isBuildConditions(', 0] },
            { generated: ['false', 0], original: ['isBuildConditions(', 1] },
            { generated: ['true', 1], original: ['isBuildConditions(', 2] },
            { generated: ['false', 1], original: ['isBuildConditions(', 3] },
        ]);
    });

    test('if-eliminate: the kept block', () => {
        checkMappings(fixture('if-eliminate'), 'input.js', [
            { generated: ['initDesktopMenu()'], original: ['initDesktopMenu()'] },
            { generated: ['export function'], original: ['export function'] },
        ]);
    });

    test('switch-nested: the inner winner', () => {
        checkMappings(fixture('switch-nested'), 'input.js', [
            { generated: ['PageWithStub;'], original: ['PageWithStub,'] },
        ]);
    });

    test('switch-nested-callee: the arrow after the inserted parenthesis', () => {
        checkMappings(fixture('switch-nested-callee'), 'input.js', [{ generated: ['() => 1'], original: ['() => 1'] }]);
    });

    test('asi-statement-boundaries: tokens around inserted semicolons', () => {
        checkMappings(fixture('asi-statement-boundaries'), 'input.js', [
            { generated: ['[1]'], original: ['[1]'] },
            { generated: ['f(4)'], original: ['f(4)'] },
            { generated: ['f(10)'], original: ['f(10)'] },
            { generated: ['f(11)'], original: ['f(11)'] },
        ]);
    });

    test('switch-leading-token: tokens after an inserted parenthesis', () => {
        checkMappings(fixture('switch-leading-token'), 'input.js', [
            { generated: ['run'], original: ['run'] },
            { generated: ['function'], original: ['function'] },
        ]);
    });

    test('token-boundaries: tokens around inserted spaces', () => {
        checkMappings(fixture('token-boundaries'), 'input.js', [
            { generated: ['value instanceof'], original: ['value, mobile: other })instanceof'] },
            { generated: ['instanceof'], original: ['instanceof'] },
            { generated: ['true in'], original: ["isBuildConditions('desktop')in"] },
        ]);
    });

    test('a TSX file', () => {
        const input = [
            "import { switchBuildCondition } from '@memebattle/build-conditions';",
            "import { Desktop } from './Desktop';",
            "import { Mobile } from './Mobile';",
            'interface Props { title: string }',
            'export const Header: React.FC<Props> = switchBuildCondition({ desktop: Desktop, mobile: Mobile });',
            '',
        ].join('\n');

        checkMappings(input, 'Header.tsx', [
            { generated: ['Desktop;'], original: ['Desktop,'] },
            { generated: ['interface'], original: ['interface'] },
        ]);
    });
});
