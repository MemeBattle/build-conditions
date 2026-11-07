/**
 * The shared `fixtures/` suite: the same cases and configs as
 * `packages/swc/tests/fixture.rs`. The expected `output.js` files are swc
 * codegen, the port keeps the original formatting, so outputs are compared as
 * normalized oxc ASTs.
 */
import { existsSync, readFileSync } from 'node:fs';

import { parseSync, rawTransferSupported } from 'oxc-parser';

import type { ResolvedConfig } from '../src/config.ts';
import { transformBuildConditions } from '../src/transform.ts';
import {
    FIXED_CONFIG,
    FIXED_OPTIONS,
    PARTIAL_CONFIG,
    caseDir,
    expectSameAst,
    listCases,
    type FixtureKind,
} from './helpers.ts';
import { fakeContext, pluginHandler } from './plugin-context.ts';

const read = (kind: FixtureKind, name: string, file: string): string =>
    readFileSync(`${caseDir(kind, name)}${file}`, 'utf8');

const RAW_MODES = [
    { label: 'deserialized', rawTransfer: false, supported: true },
    { label: 'raw transfer', rawTransfer: true, supported: rawTransferSupported() },
];

const SUITES: [FixtureKind, ResolvedConfig][] = [
    ['fixed', FIXED_CONFIG],
    ['partial', PARTIAL_CONFIG],
];

describe.each(SUITES)('%s', (kind, config) => {
    describe.each(listCases(kind))('%s', name => {
        for (const mode of RAW_MODES) {
            const run = mode.supported ? test : test.skip;

            run(mode.label, () => {
                const input = read(kind, name, 'input.js');
                const result = transformBuildConditions(input, 'input.js', config, { rawTransfer: mode.rawTransfer });

                expect(result.errors).toEqual([]);
                expectSameAst(result.code, read(kind, name, 'output.js'));
            });
        }
    });
});

/** The message of an swc diagnostic: the first line without the `x` marker */
function stderrMessage(stderr: string): string {
    return (stderr.split('\n')[0] as string).replace(/^\s*x\s+/, '');
}

/**
 * The offset of the reported span: the source line before the caret line gives
 * the line number, the first `^` column minus the gutter gives the column
 */
function stderrOffset(stderr: string, input: string): number {
    const lines = stderr.split('\n');
    const caretIndex = lines.findIndex(line => /^\s*:\s*\^/.test(line));
    const caretLine = lines[caretIndex] as string;
    const sourceLine = lines[caretIndex - 1] as string;
    const lineNumber = Number(/^\s*(\d+)\s*\|/.exec(sourceLine)?.[1]);
    const gutter = sourceLine.indexOf('|') + 2;
    const column = caretLine.indexOf('^') - gutter;
    const inputLines = input.split('\n');

    return inputLines.slice(0, lineNumber - 1).reduce((offset, line) => offset + line.length + 1, 0) + column;
}

describe.each(listCases('errors'))('errors / %s', name => {
    const input = read('errors', name, 'input.js');
    const stderr = read('errors', name, 'output.stderr');

    for (const mode of RAW_MODES) {
        const run = mode.supported ? test : test.skip;

        run(mode.label, () => {
            const result = transformBuildConditions(input, 'input.js', FIXED_CONFIG, {
                rawTransfer: mode.rawTransfer,
            });
            const [error] = result.errors;

            expect(error?.message).toBe(stderrMessage(stderr));
            expect(error?.pos).toBe(stderrOffset(stderr, input));
            expectSameAst(result.code, read('errors', name, 'output.js'));
        });
    }

    test('the plugin raises the error through this.error', () => {
        const context = fakeContext();
        const handler = pluginHandler(FIXED_OPTIONS);

        expect(() => handler.call(context, input, '/abs/input.js')).toThrow(stderrMessage(stderr));
        expect(context.errors).toEqual([{ message: stderrMessage(stderr), pos: stderrOffset(stderr, input) }]);
    });
});

describe('fixture guards', () => {
    test.each<FixtureKind>(['fixed', 'partial', 'errors'])('%s has cases', kind => {
        expect(listCases(kind).length).toBeGreaterThan(0);
    });

    test.each<FixtureKind>(['fixed', 'partial', 'errors'])('every %s case has its files', kind => {
        for (const name of listCases(kind)) {
            const dir = caseDir(kind, name);

            expect([name, existsSync(`${dir}input.js`), existsSync(`${dir}output.js`)]).toEqual([name, true, true]);
            if (kind === 'errors') {
                expect([name, existsSync(`${dir}output.stderr`)]).toEqual([name, true]);
            }
        }
    });

    // The AST comparison strips trailing digits from identifiers to undo swc
    // hygiene renames, which is valid only while inputs never end names with one
    test('no identifier of an input ends with a digit', () => {
        const offenders: string[] = [];

        for (const kind of ['fixed', 'partial', 'errors'] as const) {
            for (const name of listCases(kind)) {
                const input = read(kind, name, 'input.js');

                JSON.stringify(parseSync('input.js', input).program, (key, value: unknown) => {
                    if (
                        value !== null &&
                        typeof value === 'object' &&
                        (value as { type?: unknown }).type === 'Identifier' &&
                        /\d$/.test((value as { name: string }).name)
                    ) {
                        offenders.push(`${kind}/${name}: ${(value as { name: string }).name}`);
                    }

                    return typeof value === 'bigint' ? String(value) : value;
                });
            }
        }

        expect(offenders).toEqual([]);
    });
});
