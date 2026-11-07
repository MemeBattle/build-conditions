/**
 * Exact string outputs: everything outside the edited ranges stays byte for
 * byte, and every inserted `(`, `)`, `;` or space is visible here.
 */
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

import { transformBuildConditions } from '../src/transform.ts';
import { FIXED_CONFIG, FIXED_OPTIONS, caseDir, parseProgram } from './helpers.ts';
import { fakeContext, pluginHandler } from './plugin-context.ts';

const IMPORT_IS = "import { isBuildConditions } from '@memebattle/build-conditions';\n";
const IMPORT_SWITCH = "import { switchBuildCondition } from '@memebattle/build-conditions';\n";
const REQUIRE_BOTH = "const { isBuildConditions, switchBuildCondition } = require('@memebattle/build-conditions');\n";
const REQUIRE_SWITCH = "const { switchBuildCondition } = require('@memebattle/build-conditions');\n";

function transform(code: string, filename = 'x.js'): string {
    const result = transformBuildConditions(code, filename, FIXED_CONFIG);

    expect(result.errors).toEqual([]);

    return result.code;
}

/** The output must parse, and its top-level statements are returned */
function reparse(code: string, filename = 'x.js'): { type: string; [key: string]: unknown }[] {
    const { body, errors } = parseProgram(code, filename);

    expect(errors).toEqual([]);

    return body as { type: string; [key: string]: unknown }[];
}

describe('untouched outside the edited ranges', () => {
    test('a TSX file keeps its types, comments and spacing', () => {
        const input = [
            "import type React from 'react';",
            IMPORT_SWITCH.trimEnd(),
            "import { Desktop } from './Desktop';",
            "import { Mobile } from './Mobile';",
            '',
            '// The header props',
            'interface Props   {  title :  string  }',
            '',
            '/* the header */  export const Header: React.FC<Props>   =   switchBuildCondition({ desktop: Desktop, mobile: Mobile }) ;',
            'export const node = <Header   title="x" />; // trailing',
            '',
        ].join('\n');

        expect(transform(input, 'Header.tsx')).toBe(
            [
                "import type React from 'react';",
                "import { Desktop } from './Desktop';",
                '',
                '// The header props',
                'interface Props   {  title :  string  }',
                '',
                '/* the header */  export const Header: React.FC<Props>   =   Desktop ;',
                'export const node = <Header   title="x" />; // trailing',
                '',
            ].join('\n')
        );
    });

    test('type imports from the package', () => {
        const input = [
            "import type { PluginOptions, isBuildConditions } from '@memebattle/build-conditions';",
            IMPORT_SWITCH.trimEnd(),
            'export const options: PluginOptions | null = null;',
            "export const flag = isBuildConditions('desktop');",
            'export const value = switchBuildCondition({ desktop: a, mobile: b });',
            '',
        ].join('\n');

        expect(transform(input, 'x.ts')).toBe(
            [
                "import type { PluginOptions, isBuildConditions } from '@memebattle/build-conditions';",
                'export const options: PluginOptions | null = null;',
                "export const flag = isBuildConditions('desktop');",
                'export const value = a;',
                '',
            ].join('\n')
        );

        // Only a type import: the module does not reference the package
        const typeOnly =
            "import type { isBuildConditions } from '@memebattle/build-conditions';\nisBuildConditions('desktop');\n";

        expect(transformBuildConditions(typeOnly, 'x.ts', FIXED_CONFIG).map).toBeNull();
    });

    test('a usage in a type position does not keep an import', () => {
        const input = [
            IMPORT_IS.trimEnd(),
            "import { MobileThing } from './mobile';",
            "if (isBuildConditions('mobile')) { new MobileThing(); }",
            'export let thing: MobileThing | null = null;',
            '',
        ].join('\n');

        expect(transform(input, 'x.ts')).toBe('export let thing: MobileThing | null = null;\n');
    });
});

describe('parenthesization', () => {
    test.each([
        ['a callee', 'switchBuildCondition({ desktop: () => 1, mobile: () => 2 })();', '(() => 1)();'],
        ['a safe slot', 'const x = switchBuildCondition({ desktop: a ? b : c, mobile: d });', 'const x = a ? b : c;'],
        ['an object at statement start', 'switchBuildCondition({ desktop: { a: 1 }, mobile: {} }).a;', '({ a: 1 }).a;'],
        [
            'export default of a function',
            'export default switchBuildCondition({ desktop: function f() {}, mobile: g });',
            'export default (function f() {});',
        ],
        [
            'an arrow body',
            'export const h = () => switchBuildCondition({ desktop: { a: 1 }, mobile: {} });',
            'export const h = () => ({ a: 1 });',
        ],
        [
            'a nested callee',
            'export const value = switchBuildCondition({ desktop: switchBuildCondition({ desktop: () => 1, mobile: () => 2 }), mobile: fallback })();',
            'export const value = (() => 1)();',
        ],
        [
            'nested into a safe slot',
            'const x = switchBuildCondition({ desktop: switchBuildCondition({ desktop: a ? b : c, mobile: d }), mobile: e });',
            'const x = a ? b : c;',
        ],
        ['a numeric member object', 'switchBuildCondition({ desktop: 1, mobile: 2 }).toFixed();', '(1).toFixed();'],
        [
            'a call in a new callee',
            'new (switchBuildCondition({ desktop: make(), mobile: other }))();',
            'new (make())();',
        ],
        ['a binary operand', 'switchBuildCondition({ desktop: a ? b : c, mobile: d }) + 1;', '(a ? b : c) + 1;'],
    ])('%s', (_, input, expected) => {
        const output = transform(`${IMPORT_SWITCH}${input}\n`);

        expect(output).toBe(`${expected}\n`);
        reparse(output);
    });
});

describe('leading tokens', () => {
    const input = [
        REQUIRE_SWITCH.trimEnd(),
        "switchBuildCondition({ desktop: { run() { record('object') } }.run, mobile: fallback })();",
        "switchBuildCondition({ desktop: function () { return () => record('function') }(), mobile: fallback })();",
        "switchBuildCondition({ desktop: class { static tag = record('class') }.tag, mobile: fallback });",
        'var arrow = () => switchBuildCondition({ desktop: { a: 1 }.a, mobile: fallback });',
        "record('after')",
        'switchBuildCondition({ desktop: { b: 2 }.b, mobile: fallback }).toFixed();',
        '',
    ].join('\n');

    test('exact output, reparsed and executed', () => {
        const output = transform(input);

        expect(output).toBe(
            [
                REQUIRE_SWITCH.trimEnd(),
                "({ run() { record('object') } }).run();",
                "(function () { return () => record('function') })()();",
                "(class { static tag = record('class') }).tag;",
                'var arrow = () => ({ a: 1 }).a;',
                "record('after')",
                ';({ b: 2 }).b.toFixed();',
                '',
            ].join('\n')
        );
        expect(reparse(output)).toHaveLength(7);

        const records: string[] = [];
        const context = { require: () => ({}), record: (value: string) => records.push(value) } as Record<
            string,
            unknown
        >;

        runInNewContext(output, context);

        expect(records).toEqual(['object', 'function', 'class', 'after']);
        expect((context.arrow as () => number)()).toBe(1);
    });

    test('export default of a member of a function', () => {
        expect(
            transform(
                `${IMPORT_SWITCH}export default switchBuildCondition({ desktop: function named() {}.name, mobile: fallback });\n`
            )
        ).toBe('export default (function named() {}).name;\n');
    });
});

describe('statement boundaries', () => {
    // The functions of fixtures/fixed/asi-statement-boundaries as a script
    const functions = readFileSync(`${caseDir('fixed', 'asi-statement-boundaries')}input.js`, 'utf8')
        .split('\n')
        .slice(2)
        .join('\n')
        .replaceAll('export function', 'function');
    const input = `${REQUIRE_BOTH}${functions}\nvar value = switchBuildCondition({ desktop: switchBuildCondition({ desktop: () => 1, mobile: () => 2 }), mobile: fallback })();\n`;

    const expected = `${REQUIRE_BOTH}function exposed(foo, f) {
    foo()
    ;[1].forEach(f);
}

function removed(foo, f) {
    foo()
    ;[2].forEach(f)
}

function elseDropped(foo, f) {
    foo(); [3].forEach(f)
}

function elseSameLine(foo, f) {
    foo(); f(4)
}

function switchLeading(foo, f) {
    foo()
    ;[5].forEach(f)
}

function nestedIf(cond, f) {
    if (cond) f(10); f(11)
}

function loopBody(items, f) {
    for (const item of items) f(item); f(12)
}

function labeledBody(f) {
    block: f(13); f(14)
}

function outerElse(cond, f) {
    if (cond) f(16);
    else f(17)
}

function outerElseAfterBlock(cond, items, f) {
    if (cond) for (const item of items) { f(item) }
    else f(18)
}

var value = (() => 1)();
`;

    test('exact output', () => {
        expect(transform(input)).toBe(expected);
    });

    test('nested-slot functions hold two statements', () => {
        const body = reparse(transform(input));
        const fn = (name: string) =>
            (
                body.find(
                    item => item.type === 'FunctionDeclaration' && (item.id as { name: string }).name === name
                ) as unknown as {
                    body: { body: { type: string; alternate?: unknown }[] };
                }
            ).body.body;

        for (const name of ['nestedIf', 'loopBody', 'labeledBody']) {
            expect([name, fn(name).filter(stmt => stmt.type !== 'EmptyStatement').length]).toEqual([name, 2]);
        }
        for (const name of ['outerElse', 'outerElseAfterBlock']) {
            const stmts = fn(name);

            expect(stmts).toHaveLength(1);
            expect(stmts[0]?.type).toBe('IfStatement');
            expect(stmts[0]?.alternate).not.toBeNull();
        }
    });

    test('executed', () => {
        const context = { require: () => ({}) } as Record<string, unknown>;

        runInNewContext(transform(input), context);

        type Fn = (...args: unknown[]) => void;
        const call = (name: string, ...args: unknown[]): unknown[] => {
            const recorded: unknown[] = [];
            // Records the first argument only: forEach passes three
            const f = (value: unknown) => {
                recorded.push(value);
            };

            (context[name] as Fn)(...args.map(arg => (arg === 'F' ? f : arg)));

            return recorded;
        };

        for (const [name, value] of [
            ['exposed', 1],
            ['removed', 2],
            ['elseDropped', 3],
            ['elseSameLine', 4],
            ['switchLeading', 5],
        ] as const) {
            let fooCalls = 0;
            const recorded: unknown[] = [];

            (context[name] as Fn)(
                () => {
                    fooCalls++;
                },
                (item: unknown) => {
                    recorded.push(item);
                }
            );

            expect([name, fooCalls]).toEqual([name, 1]);
            expect([name, recorded]).toEqual([name, [value]]);
        }

        expect(context.value).toBe(1);
        expect(call('nestedIf', true, 'F')).toEqual([10, 11]);
        expect(call('nestedIf', false, 'F')).toEqual([11]);
        expect(call('loopBody', ['a', 'b'], 'F')).toEqual(['a', 'b', 12]);
        expect(call('loopBody', [], 'F')).toEqual([12]);
        expect(call('labeledBody', 'F')).toEqual([13, 14]);
        expect(call('outerElse', true, 'F')).toEqual([16]);
        expect(call('outerElse', false, 'F')).toEqual([17]);
        expect(call('outerElseAfterBlock', true, ['a'], 'F')).toEqual(['a']);
        expect(call('outerElseAfterBlock', false, ['a'], 'F')).toEqual([18]);
    });

    test('a removed top-level declaration between two statements', () => {
        const output = transform(
            [
                IMPORT_IS.trimEnd(),
                "import { foo, f } from './x'",
                'foo()',
                'function mobileOnly() {}',
                "if (isBuildConditions('mobile')) { mobileOnly() }",
                '[4].forEach(f)',
                '',
            ].join('\n')
        );

        expect(output).toContain(';[4].forEach(f)');

        const body = reparse(output);
        const statements = body.filter(item => item.type === 'ExpressionStatement');

        expect(body.some(item => item.type === 'FunctionDeclaration')).toBe(false);
        expect(statements).toHaveLength(2);
    });
});

describe('positions', () => {
    test('non-ASCII text before a call', () => {
        const input = `${IMPORT_IS}const label = 'Café 🎉 naïve';\nexport const flag = isBuildConditions('desktop');\n`;

        expect(transform(input)).toBe("const label = 'Café 🎉 naïve';\nexport const flag = true;\n");

        const broken = `${IMPORT_IS}const label = 'Café 🎉 naïve';\nexport const flag = isBuildConditions('tablet');\n`;
        const [error] = transformBuildConditions(broken, 'x.js', FIXED_CONFIG).errors;

        expect(broken.slice(error?.pos).startsWith("isBuildConditions('tablet')")).toBe(true);
    });
});

describe('statements outside lists', () => {
    test.each([
        ["if (cond) { a(); } else if (isBuildConditions('mobile')) { b(); }", 'if (cond) { a(); } else ;'],
        ["if (cond) if (isBuildConditions('mobile')) b();", 'if (cond) ;'],
    ])('%s', (input, expected) => {
        const output = transform(`${IMPORT_IS}${input}\n`);

        expect(output).toBe(`${expected}\n`);
        reparse(output);
    });
});

describe('cleanup', () => {
    test('a dead declarator', () => {
        expect(
            transform(
                [
                    IMPORT_IS.trimEnd(),
                    "import { x } from './x';",
                    'const keep = 1, mobileOnly = () => x;',
                    "if (isBuildConditions('mobile')) { mobileOnly(); }",
                    'export { keep };',
                    '',
                ].join('\n')
            )
        ).toBe('const keep = 1;\nexport { keep };\n');
    });

    const deadBranch = "if (isBuildConditions('mobile')) { use(mobileX, mobileB, mobileC); }\n";

    test.each([
        ["import D, { mobileX } from './x';\nD();\n", "import D from './x';\nD();\n"],
        [
            "import { a, mobileB } from './x.json' with { type: 'json' };\na();\n",
            "import { a } from './x.json' with { type: 'json' };\na();\n",
        ],
        ["import { type T, mobileC } from './y';\nlet t: T;\n", "import { type T } from './y';\nlet t: T;\n"],
    ])('a partially removed import: %s', (imports, expected) => {
        expect(transform(`${IMPORT_IS}${imports}${deadBranch}`, 'x.ts')).toBe(expected);
    });

    test('a declaration-level import type keeps its type keyword', () => {
        const input = [
            "import type { Foo, Bar } from './types';",
            IMPORT_IS.trimEnd(),
            "if (isBuildConditions('mobile')) {",
            '    const Foo = 1;',
            '    consume(Foo);',
            '}',
            'export type Public = Bar;',
            '',
        ].join('\n');
        const output = transform(input, 'x.ts');

        expect(output).toBe("import type { Bar } from './types';\nexport type Public = Bar;\n");

        const [declaration] = reparse(output, 'x.ts');

        expect(declaration?.type).toBe('ImportDeclaration');
        expect(declaration?.importKind).toBe('type');
    });

    test('JSX element names are usages', () => {
        const input = [
            IMPORT_SWITCH.trimEnd(),
            "import { Desktop } from './Desktop';",
            "import { Mobile } from './Mobile';",
            'export const View = switchBuildCondition({ desktop: () => <Desktop />, mobile: () => <Mobile /> });',
            '',
        ].join('\n');

        expect(transform(input, 'x.jsx')).toBe(
            "import { Desktop } from './Desktop';\nexport const View = () => <Desktop />;\n"
        );
    });
});

describe('modules left alone', () => {
    test('a syntax error', () => {
        const input = `${IMPORT_IS}export const flag = isBuildConditions('desktop') +;\n`;

        expect(transformBuildConditions(input, 'x.js', FIXED_CONFIG)).toEqual({ code: input, map: null, errors: [] });
    });

    test('the package name only in a comment', () => {
        const input =
            "// uses @memebattle/build-conditions\nimport { isBuildConditions } from './local';\nisBuildConditions('desktop');\n";

        expect(transformBuildConditions(input, 'x.js', FIXED_CONFIG)).toEqual({ code: input, map: null, errors: [] });
    });

    test('an optional call stays', () => {
        const input =
            "import * as ns from '@memebattle/build-conditions';\nexport const flag = ns?.isBuildConditions('desktop');\n";

        expect(transformBuildConditions(input, 'x.js', FIXED_CONFIG).code).toBe(input);
    });
});

describe('helper calls', () => {
    test('a namespace call through a sequence', () => {
        expect(
            transform(
                "import * as ns from '@memebattle/build-conditions';\nexport const flag = (0, ns.isBuildConditions)('desktop');\n"
            )
        ).toBe('export const flag = true;\n');
    });

    test.each([
        ['switchBuildCondition({ ...rest });', 'switchBuildCondition({ '.length],
        ['switchBuildCondition({ desktop() {} });', 'switchBuildCondition({ '.length],
    ])('%s reports at the property', (call, column) => {
        const input = `${IMPORT_SWITCH}${call}\n`;
        const result = transformBuildConditions(input, 'x.js', FIXED_CONFIG);

        expect(result.errors).toEqual([
            {
                message:
                    'build-conditions: switchBuildCondition supports only properties of the form `condition: value`',
                pos: IMPORT_SWITCH.length + column,
            },
        ]);
        expect(result.code).toBe(input);
    });

    test('switchBuildCondition() is kept silently', () => {
        const input = `${IMPORT_SWITCH}switchBuildCondition();\n`;

        expect(transformBuildConditions(input, 'x.js', FIXED_CONFIG)).toEqual({ code: input, map: null, errors: [] });
    });

    test('isBuildConditions() reports at the call', () => {
        const input = `${IMPORT_IS}isBuildConditions();\n`;

        expect(transformBuildConditions(input, 'x.js', FIXED_CONFIG).errors).toEqual([
            {
                message:
                    'build-conditions: isBuildConditions accepts only a string literal or an array of string literals; use getBuildConditions for dynamic checks',
                pos: IMPORT_IS.length,
            },
        ]);
    });

    test('two errors are both returned and the plugin raises the first', () => {
        const first = "isBuildConditions('tablet');\n";
        const input = `${IMPORT_IS}${first}isBuildConditions(value);\n`;
        const result = transformBuildConditions(input, 'x.js', FIXED_CONFIG);

        expect(result.errors.map(error => error.pos)).toEqual([
            IMPORT_IS.length,
            IMPORT_IS.length + first.length + 'isBuildConditions('.length,
        ]);

        const context = fakeContext();

        expect(() => pluginHandler(FIXED_OPTIONS).call(context, input, '/src/x.js')).toThrow();
        expect(context.errors).toEqual([result.errors[0]]);
    });
});

describe('effective AST parity with the Rust plugin', () => {
    test('a folded callee resolves as the helper', () => {
        expect(
            transform(
                `${IMPORT_SWITCH.replace('switchBuildCondition', 'isBuildConditions, switchBuildCondition')}export const flag = switchBuildCondition({ desktop: isBuildConditions, mobile: other })('client');\n`
            )
        ).toBe('export const flag = true;\n');
    });

    test('a folded boolean initializer is pure', () => {
        expect(
            transform(
                `${IMPORT_IS}const flag = isBuildConditions('client'), keep = 1;\nif (isBuildConditions('mobile')) { use(flag); }\nexport { keep };\n`
            )
        ).toBe('const keep = 1;\nexport { keep };\n');
    });
});

describe('token boundaries', () => {
    test('the shared fixture', () => {
        const input = readFileSync(`${caseDir('fixed', 'token-boundaries')}input.js`, 'utf8');
        const output = transform(input);

        expect(output).toBe(
            [
                "import { value } from './values';",
                '',
                'export const found = true in table;',
                'export const typed = typeof false;',
                'export const inst = value instanceof Object;',
                'export const kind = typeof value;',
                'export const flags = /x/ in table;',
                '',
            ].join('\n')
        );
        reparse(output);
    });

    test('no extra space where there is one already', () => {
        expect(
            transform(
                `${IMPORT_IS}export const found = isBuildConditions('desktop') in table;\nx = isBuildConditions('desktop');\n`
            )
        ).toBe('export const found = true in table;\nx = true;\n');
    });

    test('executed', () => {
        const output = transform(
            `${REQUIRE_SWITCH}var r = switchBuildCondition({ desktop: 'a', mobile: 'b' })in { a: 1 };\n`
        );
        const context = { require: () => ({}) } as Record<string, unknown>;

        runInNewContext(output, context);

        expect(context.r).toBe(true);
    });
});
