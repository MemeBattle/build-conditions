import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { parseSync } from 'oxc-parser';

import { resolveConfig, type ResolvedConfig } from '../src/config.ts';

/** The fixtures shared with the cargo suite of the SWC plugin */
export const FIXTURES_DIR: string = fileURLToPath(new URL('../../../fixtures/', import.meta.url));

/** The configs of `packages/swc/tests/fixture.rs` */
export const FIXED_OPTIONS = {
    groups: { platform: ['desktop', 'mobile'], runtime: ['server', 'client'] },
    conditions: { platform: 'desktop', runtime: 'client' },
} as const;

export const PARTIAL_OPTIONS = {
    groups: { platform: ['desktop', 'mobile'], runtime: ['server', 'client'] },
    conditions: { platform: null, runtime: 'client' },
} as const;

export const FIXED_CONFIG: ResolvedConfig = resolveConfig(FIXED_OPTIONS);
export const PARTIAL_CONFIG: ResolvedConfig = resolveConfig(PARTIAL_OPTIONS);

export type FixtureKind = 'fixed' | 'partial' | 'errors';

export function listCases(kind: FixtureKind): string[] {
    return readdirSync(`${FIXTURES_DIR}${kind}`, { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name)
        .sort();
}

export function caseDir(kind: FixtureKind, name: string): string {
    return `${FIXTURES_DIR}${kind}/${name}/`;
}

const DROPPED_KEYS = new Set(['start', 'end', 'range', 'loc', 'raw']);

const STATEMENT_LISTS: Record<string, string> = {
    Program: 'body',
    BlockStatement: 'body',
    StaticBlock: 'body',
    SwitchCase: 'consequent',
    TSModuleBlock: 'body',
};

/**
 * The difference between swc's printed output and the port's edited text that
 * carries no meaning: parentheses, shorthand properties, raw literal text, the
 * hygiene digits swc appends to renamed bindings, and empty statements in
 * statement lists (swc drops them all, the port keeps the user's and may add
 * `;` at statement boundaries).
 */
function normalize(value: unknown, listOwner: string | null = null): unknown {
    if (Array.isArray(value)) {
        const items = listOwner === null ? value : value.filter(item => item?.type !== 'EmptyStatement');

        return items.map(item => normalize(item));
    }

    if (typeof value === 'bigint' || value instanceof RegExp) {
        return String(value);
    }

    if (typeof value !== 'object' || value === null) {
        return value;
    }

    const node = value as Record<string, unknown>;

    if (node.type === 'ParenthesizedExpression') {
        return normalize(node.expression);
    }

    const result: Record<string, unknown> = {};

    for (const [key, child] of Object.entries(node)) {
        if (DROPPED_KEYS.has(key)) {
            continue;
        }

        if (key === 'shorthand' && node.type === 'Property') {
            result[key] = false;
        } else if (key === 'name' && node.type === 'Identifier' && typeof child === 'string') {
            result[key] = child.replace(/\d+$/, '');
        } else {
            const owner = typeof node.type === 'string' && STATEMENT_LISTS[node.type] === key ? node.type : null;

            result[key] = normalize(child, owner);
        }
    }

    return result;
}

export function parseProgram(code: string, filename: string): { body: unknown[]; errors: string[] } {
    const result = parseSync(filename, code);

    return {
        body: result.program.body as unknown[],
        errors: result.errors.map(error => error.message),
    };
}

/** The normalized program body; throws with the code when it does not parse */
export function normalizeAst(code: string, filename: string): unknown {
    const { body, errors } = parseProgram(code, filename);

    if (errors.length > 0) {
        throw new Error(`${filename} does not parse (${errors.join('; ')}):\n${code}`);
    }

    return normalize(body, 'Program');
}

export function expectSameAst(actual: string, expected: string, filename = 'input.js'): void {
    expect(normalizeAst(actual, filename)).toEqual(normalizeAst(expected, filename));
}
