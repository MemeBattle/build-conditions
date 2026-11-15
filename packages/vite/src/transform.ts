/**
 * A port of `TransformVisitor` from `packages/swc/src/transform.rs`.
 *
 * The Rust plugin rewrites the swc AST and lets the printer emit the module.
 * This port edits the source text instead: only the helper call sites, the dead
 * branches, the dead declarations and the dead imports change, every other byte
 * stays where it was. Every replacement is made twice, at the moment Rust makes
 * it: in the text through magic-string, and in the oxc AST by assigning the
 * parent slot (the counterpart of `*node = replacement`). Every later semantic
 * step therefore reads the module as Rust sees it.
 *
 * Because swc prints a final AST, it adds parentheses, semicolons and spaces
 * where they are needed. The port does the same in four final passes over the
 * final tree (see `finalPasses`).
 */
import MagicString, { type SourceMap } from 'magic-string';
import { parseSync, rawTransferSupported, type ParserOptions } from 'oxc-parser';

import {
    childKeys,
    collectIdents,
    forEachChild,
    getSlot,
    hasHoistedVar,
    isNode,
    isPureExpr,
    isTypeNode,
    setSlot,
    synthEmpty,
    synthLiteral,
    type Node,
} from './ast.ts';
import type { ResolvedConfig } from './config.ts';

export const MODULE_SPECIFIER = '@memebattle/build-conditions';
const SWITCH_HELPER = 'switchBuildCondition';
const IS_HELPER = 'isBuildConditions';
const DEFAULT_KEY = 'default';

export interface TransformError {
    message: string;
    /** UTF-16 offset of the reported span start, as the Rust span */
    pos: number;
}

export interface TransformResult {
    code: string;
    /** null when nothing changed */
    map: SourceMap | null;
    errors: TransformError[];
}

export interface TransformOptions {
    /** oxc raw transfer; defaults to `rawTransferSupported()` */
    rawTransfer?: boolean;
}

type Helper = 'switch' | 'is';

/** Status of a condition value relative to the config */
type ConditionState = 'activeFixed' | 'inactiveFixed' | 'runtime';

/** Result of statically evaluating an isBuildConditions call: 'runtime' keeps the call */
type IsEval = boolean | 'runtime';

/** Local names of the package helpers available in scope */
interface Scope {
    switchLocal?: string;
    isLocal?: string;
    namespaceLocal?: string;
}

interface Slot {
    parent: Node | null;
    key: string;
    index: number | null;
}

/** Statement-list slots: their removed statements are spliced out, as `stmts.retain` does */
const STATEMENT_LISTS = new Map([
    ['Program', 'body'],
    ['BlockStatement', 'body'],
    ['StaticBlock', 'body'],
    ['SwitchCase', 'consequent'],
    ['TSModuleBlock', 'body'],
]);

const MODULE_DECLARATIONS = new Set([
    'ImportDeclaration',
    'ExportNamedDeclaration',
    'ExportDefaultDeclaration',
    'ExportAllDeclaration',
    'TSExportAssignment',
    'TSImportEqualsDeclaration',
    'TSNamespaceExportDeclaration',
]);

/** Marks a statement removed from a list until the list is spliced */
const REMOVED: Node = { type: 'RemovedStatement', start: -1, end: -1 };

/**
 * Expressions that bind at least as tightly as any slot a winner can land in
 * (primary and left-hand-side expressions)
 */
const PRIMARY = new Set([
    'Identifier',
    'Literal',
    'TemplateLiteral',
    'TaggedTemplateExpression',
    'ThisExpression',
    'ArrayExpression',
    'ObjectExpression',
    'FunctionExpression',
    'ClassExpression',
    'MemberExpression',
    'CallExpression',
    'ParenthesizedExpression',
    'JSXElement',
    'JSXFragment',
    'MetaProperty',
    'ImportExpression',
]);

/** Slots that accept any assignment-level expression */
const SAFE_SLOTS: Record<string, readonly string[]> = {
    VariableDeclarator: ['init'],
    AssignmentExpression: ['right'],
    AssignmentPattern: ['right'],
    Property: ['value'],
    PropertyDefinition: ['value'],
    CallExpression: ['arguments'],
    NewExpression: ['arguments'],
    ArrayExpression: ['elements'],
    ReturnStatement: ['argument'],
    ThrowStatement: ['argument'],
    YieldExpression: ['argument'],
    SpreadElement: ['argument'],
    JSXExpressionContainer: ['expression'],
    ConditionalExpression: ['consequent', 'alternate'],
    TemplateLiteral: ['expressions'],
    ParenthesizedExpression: ['expression'],
    ExpressionStatement: ['expression'],
    ExportDefaultDeclaration: ['declaration'],
    ArrowFunctionExpression: ['body'],
};

/** Statements whose grammar ends with an optional `;` */
const SEMICOLON_STATEMENTS = new Set([
    'ExpressionStatement',
    'VariableDeclaration',
    'ReturnStatement',
    'ThrowStatement',
    'BreakStatement',
    'ContinueStatement',
    'DebuggerStatement',
    'DoWhileStatement',
]);

/** Statements whose body is their trailing part */
const BODY_STATEMENTS = new Set([
    'WhileStatement',
    'ForStatement',
    'ForInStatement',
    'ForOfStatement',
    'WithStatement',
    'LabeledStatement',
]);

/** Statements that end with their own `}` and never continue into the next one */
const TERMINATED_STATEMENTS = new Set(['BlockStatement', 'FunctionDeclaration', 'ClassDeclaration', 'EmptyStatement']);

/** A statement starting with one of these may continue the previous one */
const HAZARDOUS_LEADING = new Set(['(', '[', '`', '+', '-', '/', '<']);

/** A code point of an identifier; `\` starts or continues an escape (`\u0061`, `\u{61}`) */
const IDENT_CHAR = /^[\p{ID_Continue}$‌‍\\]$/u;

/** The whole code point that ends at `index` (a surrogate pair included) */
function codePointBefore(text: string, index: number): string | undefined {
    const cp = index >= 2 ? text.codePointAt(index - 2) : undefined;

    if (cp !== undefined && cp > 0xffff) {
        return String.fromCodePoint(cp);
    }

    return index >= 1 ? text[index - 1] : undefined;
}

/** The whole code point that starts at `index` */
function codePointAt(text: string, index: number): string | undefined {
    const cp = text.codePointAt(index);

    return cp === undefined ? undefined : String.fromCodePoint(cp);
}

/**
 * Whether two adjacent code points would fuse into one token (or start a
 * comment). Conservative: an extra space is always harmless.
 */
function joins(a: string | undefined, b: string | undefined): boolean {
    if (a === undefined || b === undefined) {
        return false;
    }

    const aIdent = IDENT_CHAR.test(a);
    const bIdent = IDENT_CHAR.test(b);

    if (aIdent && bIdent) {
        return true;
    }
    // A regex literal followed by a word would gain flags
    if (a === '/' && bIdent) {
        return true;
    }
    if (a === b && (a === '+' || a === '-')) {
        return true;
    }

    return a === '/' && (b === '/' || b === '*');
}

/** The leftmost operand of an expression, the node its text starts with */
function leftOperand(node: Node): Node | null {
    switch (node.type) {
        case 'CallExpression':
            return node.callee as Node;
        case 'MemberExpression':
            return node.object as Node;
        case 'TaggedTemplateExpression':
            return node.tag as Node;
        case 'BinaryExpression':
        case 'LogicalExpression':
        case 'AssignmentExpression':
            return node.left as Node;
        case 'ConditionalExpression':
            return node.test as Node;
        case 'SequenceExpression':
            return node.expressions[0] as Node;
        case 'UpdateExpression':
            return node.prefix ? null : (node.argument as Node);
        case 'ChainExpression':
        case 'TSAsExpression':
        case 'TSSatisfiesExpression':
        case 'TSNonNullExpression':
        case 'TSInstantiationExpression':
            return node.expression as Node;
        default:
            return null;
    }
}

/**
 * Whether the child in `parent[key]` is parsed with the `[+In]` parameter
 * whatever the context of `parent`: parentheses, function and class bodies,
 * array and object literals and patterns, arguments, computed member
 * properties, template substitutions, JSX and the consequent of `? :`. An
 * arrow's concise body inherits the context.
 */
function resetsInContext(parent: Node, key: string): boolean {
    switch (parent.type) {
        case 'ParenthesizedExpression':
        case 'FunctionExpression':
        case 'FunctionDeclaration':
        case 'ArrayExpression':
        case 'ObjectExpression':
        case 'ArrayPattern':
        case 'ObjectPattern':
        case 'JSXElement':
        case 'JSXFragment':
        case 'JSXExpressionContainer':
        case 'ImportExpression':
            return true;
        case 'ArrowFunctionExpression':
            return key === 'params' || parent.body.type === 'BlockStatement';
        case 'ClassExpression':
        case 'ClassDeclaration':
            return key === 'body';
        case 'CallExpression':
        case 'NewExpression':
            return key === 'arguments';
        case 'MemberExpression':
            return key === 'property' && parent.computed === true;
        case 'TemplateLiteral':
            return key === 'expressions';
        case 'TaggedTemplateExpression':
            return key === 'quasi';
        case 'ConditionalExpression':
            return key === 'consequent';
        default:
            return false;
    }
}

function containsCallInChain(node: Node): boolean {
    let current: Node | null = node;

    while (current !== null) {
        if (current.type === 'CallExpression') {
            return true;
        }

        current = current.type === 'MemberExpression' ? (current.object as Node) : null;
    }

    return false;
}

class Transformer {
    private readonly s: MagicString;
    private readonly scopes: Scope[] = [];
    private isEsModule = false;
    private didTransform = false;
    /** Identifiers from dead branches: candidates for import removal */
    private readonly discarded = new Set<string>();
    readonly errors: TransformError[] = [];

    /** Taken `if` branches that now stand where the `if` stood */
    private readonly exposed = new Set<Node>();
    /** Inlined switch winners */
    private readonly moved = new Set<Node>();
    /** Synthetic literals of folded `isBuildConditions` calls */
    private readonly synthetic = new WeakSet<Node>();
    /** Folded boolean or inlined winner → the range of the call it replaced */
    private readonly replacedRange = new Map<Node, [number, number]>();
    /** Statement → its previous sibling in the original statement list */
    private readonly originalPrev = new Map<Node, Node | null>();

    // Final passes state
    private tree = new Map<Node, Slot>();
    private readonly wrapped = new Set<Node>();
    /** Positions of `prependRight` / `appendLeft` insertions of passes 1-3 */
    private readonly insertedBefore = new Set<number>();
    private readonly insertedAfter = new Set<number>();

    private readonly code: string;
    private readonly config: ResolvedConfig;

    constructor(code: string, config: ResolvedConfig) {
        this.code = code;
        this.config = config;
        this.s = new MagicString(code);
    }

    get magicString(): MagicString {
        return this.s;
    }

    run(program: Node): void {
        this.isEsModule = (program.body as Node[]).some(item => MODULE_DECLARATIONS.has(item.type));

        // Fast path: in an ES module a reference to the package — an import or
        // a top-level `require` — is always at the top level; without one the
        // traversal is unnecessary. Scripts are always traversed: there
        // `require` can appear in any scope.
        if (this.isEsModule && !moduleReferencesPackage(program)) {
            return;
        }

        this.scopes.push({});
        this.visitChildren(program);
        this.scopes.pop();

        if (!this.didTransform) {
            return;
        }

        if (this.isEsModule) {
            this.cleanupDeclarations(program);
            this.cleanupImports(program);
        }

        this.finalPasses(program);
    }

    // ---- Scopes and helper resolution

    private currentScope(): Scope {
        return this.scopes[this.scopes.length - 1] as Scope;
    }

    private resolveLocal(name: string): Helper | null {
        for (let index = this.scopes.length - 1; index >= 0; index--) {
            const scope = this.scopes[index] as Scope;

            if (scope.switchLocal === name) {
                return 'switch';
            }
            if (scope.isLocal === name) {
                return 'is';
            }
        }

        return null;
    }

    private isNamespace(name: string): boolean {
        return this.scopes.some(scope => scope.namespaceLocal === name);
    }

    /**
     * Determines whether the callee is one of the package helpers. Supports a
     * direct identifier, `ns.helper` and `(0, ns.helper)`.
     */
    private resolveHelper(callee: Node): Helper | null {
        if (callee.type === 'ParenthesizedExpression' && callee.expression.type === 'SequenceExpression') {
            const last = (callee.expression.expressions as Node[]).at(-1);

            if (last !== undefined) {
                return this.resolveHelper(last);
            }
        }

        if (callee.type === 'Identifier') {
            return this.resolveLocal(callee.name as string);
        }

        if (callee.type === 'MemberExpression' && !callee.computed && !callee.optional) {
            const object = callee.object as Node;
            const property = callee.property as Node;

            if (object.type !== 'Identifier' || !this.isNamespace(object.name as string)) {
                return null;
            }
            if (property.type !== 'Identifier') {
                return null;
            }
            if (property.name === SWITCH_HELPER) {
                return 'switch';
            }
            if (property.name === IS_HELPER) {
                return 'is';
            }
        }

        return null;
    }

    private asIsCall(expr: Node): Node | null {
        if (expr.type !== 'CallExpression' || expr.optional) {
            return null;
        }

        return this.resolveHelper(expr.callee as Node) === 'is' ? expr : null;
    }

    private registerExportName(exportName: string, local: string): void {
        if (exportName === SWITCH_HELPER) {
            this.currentScope().switchLocal = local;
        } else if (exportName === IS_HELPER) {
            this.currentScope().isLocal = local;
        }
    }

    private registerImport(node: Node): void {
        // `import type` never brings a value helper into scope
        if (node.source.value !== MODULE_SPECIFIER || node.importKind === 'type') {
            return;
        }

        for (const specifier of node.specifiers as Node[]) {
            if (specifier.type === 'ImportNamespaceSpecifier') {
                this.currentScope().namespaceLocal = specifier.local.name as string;
            } else if (specifier.type === 'ImportSpecifier') {
                if (specifier.importKind === 'type') {
                    continue;
                }

                if (specifier.imported.type !== 'Identifier') {
                    this.error('build-conditions: string literals in imports are not supported', node.start);

                    continue;
                }

                this.registerExportName(specifier.imported.name as string, specifier.local.name as string);
            }
        }
    }

    private registerRequire(node: Node): void {
        const init = node.init as Node | null;

        if (init === null || init.type !== 'CallExpression' || !isRequireFromModule(init)) {
            return;
        }

        const id = node.id as Node;

        if (id.type === 'Identifier') {
            this.currentScope().namespaceLocal = id.name as string;

            return;
        }

        if (id.type !== 'ObjectPattern') {
            return;
        }

        for (const property of id.properties as Node[]) {
            if (property.type !== 'Property') {
                continue;
            }

            const key = property.key as Node;
            const value = property.value as Node;

            if (property.shorthand) {
                if (key.type === 'Identifier') {
                    this.registerExportName(key.name as string, key.name as string);
                }
            } else if (!property.computed && key.type === 'Identifier' && value.type === 'Identifier') {
                this.registerExportName(key.name as string, value.name as string);
            }
        }
    }

    // ---- Condition evaluation

    /** Status of a condition value, or null when the value is in no group */
    private resolveCondition(value: string): ConditionState | null {
        const group = this.config.valueToGroup.get(value);

        if (group === undefined) {
            return null;
        }

        const chosen = this.config.conditions.get(group) ?? null;

        if (chosen === null) {
            return 'runtime';
        }

        return chosen === value ? 'activeFixed' : 'inactiveFixed';
    }

    private error(message: string, pos: number): void {
        this.errors.push({ message, pos });
    }

    private unknownValueError(pos: number, value: string): void {
        this.error(
            `build-conditions: condition value '${value}' is not found in any group of the config (groups: ${this.config.groupNames.join(', ')})`,
            pos
        );
    }

    /**
     * Extracts condition values from an isBuildConditions argument. A number
     * is the position of the error: the argument is neither a string literal
     * nor an array of them.
     */
    private static extractIsValues(call: Node): string[] | number {
        const arg = (call.arguments as Node[])[0];

        if (arg === undefined) {
            return call.start;
        }
        if (arg.type === 'SpreadElement') {
            return (arg.argument as Node).start;
        }
        if (arg.type === 'Literal' && typeof arg.value === 'string') {
            return [arg.value];
        }
        if (arg.type !== 'ArrayExpression') {
            return arg.start;
        }

        const values: string[] = [];

        for (const element of arg.elements as (Node | null)[]) {
            if (element === null) {
                return arg.start;
            }
            if (element.type === 'SpreadElement') {
                return (element.argument as Node).start;
            }
            if (element.type !== 'Literal' || typeof element.value !== 'string') {
                return element.start;
            }

            values.push(element.value);
        }

        return values;
    }

    /** Static evaluation of isBuildConditions values. `unknown` is the first value that is in no group */
    private evalIsValues(values: string[]): IsEval | { unknown: string } {
        let hasRuntime = false;

        for (const value of values) {
            switch (this.resolveCondition(value)) {
                case null:
                    return { unknown: value };
                // A condition from a fixed group did not match: the whole call
                // is statically false, even if other conditions are runtime
                case 'inactiveFixed':
                    return false;
                case 'runtime':
                    hasRuntime = true;
                    break;
                case 'activeFixed':
                    break;
            }
        }

        return hasRuntime ? 'runtime' : true;
    }

    /**
     * Static evaluation of an if-statement test: a direct isBuildConditions
     * call or its negation (`!!` included). No errors are emitted here: when the
     * evaluation fails, the call goes through the regular expression path.
     */
    private tryEvalIfTest(test: Node): boolean | null {
        if (test.type === 'UnaryExpression') {
            if (test.operator !== '!') {
                return null;
            }

            const value = this.tryEvalIfTest(test.argument as Node);

            return value === null ? null : !value;
        }

        const call = this.asIsCall(test);

        if (call === null) {
            return null;
        }

        const values = Transformer.extractIsValues(call);

        if (typeof values === 'number') {
            return null;
        }

        const result = this.evalIsValues(values);

        return typeof result === 'boolean' ? result : null;
    }

    // ---- Traversal

    private visit(parent: Node, key: string, index: number | null): void {
        const node = getSlot(parent, key, index);

        if (!isNode(node) || isTypeNode(node)) {
            return;
        }

        switch (node.type) {
            case 'IfStatement':
                if (this.visitIf(parent, key, index, node)) {
                    return;
                }
                break;
            case 'ImportDeclaration':
                this.registerImport(node);

                return;
            case 'VariableDeclarator':
                this.visitChildren(node);
                this.registerRequire(node);

                return;
            case 'CallExpression':
                this.visitChildren(node);
                this.transformCall(parent, key, index, node);

                return;
        }

        this.visitChildren(node);
    }

    private visitChildren(node: Node): void {
        const listKey = STATEMENT_LISTS.get(node.type);
        // In a script `require` can appear in any block, so each block opens a scope
        const scoped = !this.isEsModule && (node.type === 'BlockStatement' || node.type === 'StaticBlock');

        if (scoped) {
            this.scopes.push({});
        }

        for (const key of childKeys(node)) {
            const value: unknown = node[key];

            if (Array.isArray(value)) {
                if (key === listKey) {
                    this.visitStatementList(node, key);
                } else {
                    for (let index = 0; index < value.length; index++) {
                        this.visit(node, key, index);
                    }
                }
            } else {
                this.visit(node, key, null);
            }
        }

        if (scoped) {
            this.scopes.pop();
        }
    }

    private visitStatementList(node: Node, key: string): void {
        const list = node[key] as Node[];

        list.forEach((stmt, index) => this.originalPrev.set(stmt, index > 0 ? (list[index - 1] as Node) : null));

        for (let index = 0; index < list.length; index++) {
            this.visit(node, key, index);
        }

        node[key] = list.filter(stmt => stmt !== REMOVED);
    }

    /**
     * Dead `if (isBuildConditions(...))` branches are removed before visiting
     * children: once the call is replaced by a literal, it is indistinguishable
     * from a hand-written one. Returns false when the `if` takes the regular path.
     */
    private visitIf(parent: Node, key: string, index: number | null, node: Node): boolean {
        const result = this.tryEvalIfTest(node.test as Node);

        if (result === null) {
            return false;
        }

        const consequent = node.consequent as Node;
        const alternate = node.alternate as Node | null;
        const dropped = result ? alternate : consequent;

        // A `var` in the dropped branch hoists out of it, so the `if` is kept
        // as `if (false)` for the minifier
        if (dropped !== null && hasHoistedVar(dropped)) {
            return false;
        }

        if (dropped !== null) {
            collectIdents(dropped, this.discarded);
        }

        const taken = result ? consequent : alternate;

        this.didTransform = true;

        if (taken === null) {
            this.deleteStatement(parent, key, index, node);

            return true;
        }

        // The taken branch keeps its braces, so its `let` and `const` stay block-scoped
        this.removeRange(node.start, taken.start);
        this.removeRange(taken.end, node.end);
        setSlot(parent, key, index, taken);
        this.exposed.add(taken);

        // The surviving branch is traversed again: it may contain nested
        // helper calls and else-if chains
        this.visit(parent, key, index);

        const occupant = getSlot(parent, key, index);

        if (isNode(occupant) && occupant !== taken && occupant !== REMOVED) {
            this.exposed.add(occupant);
        }

        return true;
    }

    private isListSlot(parent: Node, key: string, index: number | null): boolean {
        return index !== null && STATEMENT_LISTS.get(parent.type) === key;
    }

    /**
     * Removes a statement. From a statement list it disappears entirely; any
     * other slot (an `if` branch, a loop body, a labeled statement) gets `;`,
     * the counterpart of the swc `EmptyStmt` that is dropped from vectors only.
     */
    private deleteStatement(parent: Node, key: string, index: number | null, node: Node): void {
        if (this.isListSlot(parent, key, index)) {
            this.removeOwnedLines(node.start, node.end);
            setSlot(parent, key, index, REMOVED);
        } else {
            this.s.overwrite(node.start, node.end, ';');
            setSlot(parent, key, index, synthEmpty(node.start, node.end));
        }
    }

    private removeRange(start: number, end: number): void {
        if (start < end) {
            this.s.remove(start, end);
        }
    }

    /** Removes a range, together with its line when it owns the line */
    private removeOwnedLines(start: number, end: number): void {
        const code = this.code;
        let lineStart = start;
        let lineEnd = end;

        while (lineStart > 0 && (code[lineStart - 1] === ' ' || code[lineStart - 1] === '\t')) {
            lineStart--;
        }
        while (lineEnd < code.length && (code[lineEnd] === ' ' || code[lineEnd] === '\t')) {
            lineEnd++;
        }

        const ownsStart = lineStart === 0 || code[lineStart - 1] === '\n';

        if (ownsStart && lineEnd === code.length) {
            this.removeRange(lineStart, lineEnd);
        } else if (ownsStart && code[lineEnd] === '\n') {
            this.removeRange(lineStart, lineEnd + 1);
        } else if (ownsStart && code.startsWith('\r\n', lineEnd)) {
            this.removeRange(lineStart, lineEnd + 2);
        } else {
            this.removeRange(start, end);
        }
    }

    private transformCall(parent: Node, key: string, index: number | null, call: Node): void {
        if (call.optional) {
            return;
        }

        const helper = this.resolveHelper(call.callee as Node);

        if (helper === null) {
            return;
        }

        const replacement = helper === 'switch' ? this.transformSwitch(call) : this.transformIs(call);

        if (replacement !== null) {
            setSlot(parent, key, index, replacement);
        }
    }

    /**
     * Transformation of `isBuildConditions(condition | [conditions])`. Returns
     * a boolean literal, or null when the call stays in runtime mode.
     */
    private transformIs(call: Node): Node | null {
        const values = Transformer.extractIsValues(call);

        if (typeof values === 'number') {
            this.error(
                'build-conditions: isBuildConditions accepts only a string literal or an array of string literals; use getBuildConditions for dynamic checks',
                values
            );

            return null;
        }

        const result = this.evalIsValues(values);

        if (result === 'runtime') {
            return null;
        }
        if (typeof result === 'object') {
            this.unknownValueError(call.start, result.unknown);

            return null;
        }

        this.s.overwrite(call.start, call.end, String(result));

        const literal = synthLiteral(result, call.start, call.end);

        this.synthetic.add(literal);
        this.replacedRange.set(literal, [call.start, call.end]);
        this.didTransform = true;

        return literal;
    }

    /** Key of a condition map property: `key: value` or shorthand `{ key }` */
    private static propKey(property: Node): string | null {
        if (property.type !== 'Property' || property.computed || property.kind !== 'init' || property.method) {
            return null;
        }

        const key = property.key as Node;

        if (key.type === 'Identifier') {
            return key.name as string;
        }
        if (key.type === 'Literal' && typeof key.value === 'string') {
            return key.value;
        }

        return null;
    }

    /**
     * Transformation of `switchBuildCondition(map)`. Returns the replacement
     * expression, or null when the call stays in runtime mode.
     */
    private transformSwitch(call: Node): Node | null {
        const arg = (call.arguments as Node[])[0];

        if (arg === undefined) {
            return null;
        }

        if (arg.type !== 'ObjectExpression') {
            this.error(
                'build-conditions: switchBuildCondition accepts only an object literal with condition branches',
                arg.type === 'SpreadElement' ? (arg.argument as Node).start : arg.start
            );

            return null;
        }

        const properties = arg.properties as Node[];
        const keys: string[] = [];

        for (const property of properties) {
            const key = Transformer.propKey(property);

            if (key === null) {
                this.error(
                    'build-conditions: switchBuildCondition supports only properties of the form `condition: value`',
                    property.start
                );

                return null;
            }

            keys.push(key);
        }

        // Resolve the group of every branch; the keys other than default must
        // belong to one group, as the `SingleGroup` type requires
        let mapGroup: string | null = null;

        for (const key of keys) {
            if (key === DEFAULT_KEY) {
                continue;
            }

            const group = this.config.valueToGroup.get(key);

            if (group === undefined) {
                this.unknownValueError(call.start, key);

                return null;
            }

            if (mapGroup === null) {
                mapGroup = group;
            } else if (mapGroup !== group) {
                this.error(
                    `build-conditions: switchBuildCondition branches belong to different condition groups ('${mapGroup}' and '${group}')`,
                    call.start
                );

                return null;
            }
        }

        // The map's group is in runtime mode: the call stays
        if (mapGroup !== null && (this.config.conditions.get(mapGroup) ?? null) === null) {
            return null;
        }

        let winnerIndex = keys.findIndex(key => key !== DEFAULT_KEY && this.resolveCondition(key) === 'activeFixed');

        if (winnerIndex === -1) {
            winnerIndex = keys.indexOf(DEFAULT_KEY);
        }

        if (winnerIndex === -1) {
            this.error(
                'build-conditions: no switchBuildCondition branch matches the fixed conditions and there is no default branch',
                call.start
            );

            return null;
        }

        // The losing values are dropped; their identifiers are collected for
        // the import cleanup. Inner switches were already folded.
        properties.forEach((property, index) => {
            if (index !== winnerIndex) {
                collectIdents(property.value as Node, this.discarded);
            }
        });

        // The winner is the current node in the value slot (for a shorthand,
        // the value identifier); after an inner fold it is the inner winner
        const kept = (properties[winnerIndex] as Node).value as Node;

        // Keep the winner's own characters: inner edits survive and the map
        // points at the winner's original position
        this.removeRange(call.start, kept.start);
        this.removeRange(kept.end, call.end);
        this.moved.add(kept);
        this.replacedRange.set(kept, [call.start, call.end]);
        this.didTransform = true;

        return kept;
    }

    // ---- Cleanup (ES modules)

    /**
     * Removes dead top-level declarations: non-exported `function` and
     * `const`/`let`/`var` with a simple name that were referenced from a dead
     * branch, are not used anywhere else in the module and have a provably pure
     * initializer. The identifiers of a removed declaration become new
     * candidates, until a fixpoint. The occurrence counter is built once and
     * decremented by the identifiers of removed nodes.
     */
    private cleanupDeclarations(program: Node): void {
        const counts = new Map<string, number>();

        for (const item of program.body as Node[]) {
            if (item.type !== 'ImportDeclaration') {
                collectIdents(item, counts);
            }
        }

        const isDead = (name: string): boolean => this.discarded.has(name) && counts.get(name) === 1;

        const discardCounted = (nodes: Node[]): void => {
            const counter = new Map<string, number>();

            for (const node of nodes) {
                collectIdents(node, counter);
            }

            for (const [name, count] of counter) {
                const total = counts.get(name);

                if (total !== undefined) {
                    counts.set(name, Math.max(0, total - count));
                }

                this.discarded.add(name);
            }
        };

        for (;;) {
            let removed = false;

            program.body = (program.body as Node[]).filter(item => {
                if (item.type === 'FunctionDeclaration') {
                    if (item.id === null || !isDead(item.id.name as string)) {
                        return true;
                    }

                    discardCounted([...(item.params as Node[]), item.body as Node]);
                    this.removeOwnedLines(item.start, item.end);
                    removed = true;

                    return false;
                }

                if (
                    item.type !== 'VariableDeclaration' ||
                    item.declare ||
                    !['var', 'let', 'const'].includes(item.kind as string)
                ) {
                    return true;
                }

                const declarations = item.declarations as Node[];
                const keep = declarations.map(declarator => {
                    const id = declarator.id as Node;

                    if (id.type !== 'Identifier' || !isDead(id.name as string)) {
                        return true;
                    }

                    const init = declarator.init as Node | null;

                    if (init !== null) {
                        if (!isPureExpr(init)) {
                            return true;
                        }

                        discardCounted([init]);
                    }

                    removed = true;

                    return false;
                });

                if (keep.every(Boolean)) {
                    return true;
                }

                if (!keep.some(Boolean)) {
                    this.removeOwnedLines(item.start, item.end);

                    return false;
                }

                this.removeDeclarators(declarations, keep);
                item.declarations = declarations.filter((_, index) => keep[index]);

                return true;
            });

            if (!removed) {
                break;
            }
        }
    }

    /**
     * Removes runs of declarators with their commas: up to the next kept
     * declarator, or from the previous kept one for a run at the end.
     */
    private removeDeclarators(declarations: Node[], keep: boolean[]): void {
        let index = 0;

        while (index < declarations.length) {
            if (keep[index]) {
                index++;
                continue;
            }

            let last = index;

            while (last + 1 < declarations.length && !keep[last + 1]) {
                last++;
            }

            const next = declarations[last + 1];

            if (next !== undefined) {
                this.removeRange((declarations[index] as Node).start, next.start);
            } else {
                this.removeRange((declarations[index - 1] as Node).end, (declarations[last] as Node).end);
            }

            index = last + 1;
        }
    }

    /**
     * Removes imports that became unused: package helpers with no remaining
     * calls and identifiers from dead branches.
     */
    private cleanupImports(program: Node): void {
        const used = new Set<string>();

        for (const item of program.body as Node[]) {
            if (item.type !== 'ImportDeclaration') {
                collectIdents(item, used);
            }
        }

        program.body = (program.body as Node[]).filter(item => {
            if (item.type !== 'ImportDeclaration') {
                return true;
            }

            const specifiers = item.specifiers as Node[];

            // Side-effect imports (`import './styles.css'`) are kept as-is
            if (specifiers.length === 0) {
                return true;
            }

            const isModuleImport = item.source.value === MODULE_SPECIFIER;

            const kept = specifiers.filter(specifier => {
                const local = specifier.local.name as string;

                if (used.has(local)) {
                    return true;
                }

                if (!isModuleImport) {
                    // From other imports, only values from dead branches are removed
                    return !this.discarded.has(local);
                }

                // From the package import, only the transform helpers and the
                // namespace are removed; runtime helpers such as
                // `setBuildConditions` stay
                if (specifier.type === 'ImportSpecifier') {
                    if (specifier.imported.type !== 'Identifier') {
                        return true;
                    }

                    const exportName = specifier.imported.name as string;

                    return exportName !== SWITCH_HELPER && exportName !== IS_HELPER;
                }

                return specifier.type !== 'ImportNamespaceSpecifier';
            });

            if (kept.length === specifiers.length) {
                return true;
            }

            if (kept.length === 0) {
                this.removeOwnedLines(item.start, item.end);

                return false;
            }

            this.s.overwrite(item.start, item.end, this.rebuildImport(item, kept));
            item.specifiers = kept;

            return true;
        });
    }

    /**
     * The text of an import with only the surviving specifiers. Specifier slices
     * keep `type` modifiers and aliases, the declaration keeps `import type`
     * and its attributes. Comments inside the rebuilt import are lost.
     */
    private rebuildImport(item: Node, kept: Node[]): string {
        const slice = (node: Node): string => this.code.slice(node.start, node.end);
        const parts: string[] = [];
        const defaultSpecifier = kept.find(specifier => specifier.type === 'ImportDefaultSpecifier');
        const namespaceSpecifier = kept.find(specifier => specifier.type === 'ImportNamespaceSpecifier');
        const named = kept.filter(specifier => specifier.type === 'ImportSpecifier');

        if (defaultSpecifier !== undefined) {
            parts.push(slice(defaultSpecifier));
        }
        if (namespaceSpecifier !== undefined) {
            parts.push(slice(namespaceSpecifier));
        } else if (named.length > 0) {
            parts.push(`{ ${named.map(slice).join(', ')} }`);
        }

        const source = item.source as Node;
        // The attributes (`with { … }`) and the final `;` follow the source
        const rest = this.code.slice(source.end, item.end);
        const semicolon = /;\s*$/.test(rest) ? ';' : '';
        const attributes = rest.replace(/\s*;?\s*$/, '');
        const typeKeyword = item.importKind === 'type' ? 'type ' : '';

        return `import ${typeKeyword}${parts.join(', ')} from ${slice(source)}${attributes}${semicolon}`;
    }

    // ---- Final passes

    /**
     * The rules swc's fixer and printer apply for free, applied to the text over
     * the final tree. Each pass reads the `wrapped` Set of the earlier ones, and
     * the `;` of pass 3 must land before the `(` of passes 1 and 2:
     * 1. precedence: a winner is wrapped in parentheses by the slot it finally
     *    lands in, and a winner with a bare `in` inside a `for (init; …)`
     *    initializer, where the grammar is `[~In]`;
     * 2. leading tokens: `{`, `function`, `class`, `let [` never start an
     *    expression statement, `function` / `class` an `export default`
     *    expression, `{` an arrow's expression body;
     * 3. statement boundaries: exposed statements are terminated, and a changed
     *    statement that starts with `( [ \` + - / <` is guarded by `;`;
     * 4. token boundaries: a folded boolean or an inlined winner never fuses
     *    with its neighbour (`true in t`, not `truein t`).
     */
    private finalPasses(program: Node): void {
        this.tree = indexTree(program);
        this.precedencePass();
        this.forInitPass();
        this.leadingTokenPass();
        this.statementBoundaryPass();
        this.tokenBoundaryPass();
    }

    private wrap(node: Node): void {
        this.s.prependRight(node.start, '(');
        this.s.appendLeft(node.end, ')');
        this.wrapped.add(node);
        this.insertedBefore.add(node.start);
        this.insertedAfter.add(node.end);
    }

    /**
     * The nodes from `expr` down its leftmost operand. Stops at a parenthesized
     * or a wrapped node: their first emitted character is `(`.
     */
    private leftmostChain(expr: Node): Node[] {
        const chain = [expr];
        let node = expr;

        while (node.type !== 'ParenthesizedExpression' && !this.wrapped.has(node)) {
            const next = leftOperand(node);

            if (next === null) {
                break;
            }

            chain.push(next);
            node = next;
        }

        return chain;
    }

    private startsWithParen(chain: Node[]): boolean {
        const last = chain.at(-1) as Node;

        return last.type === 'ParenthesizedExpression' || this.wrapped.has(last);
    }

    private firstChar(node: Node): string | undefined {
        return this.synthetic.has(node) ? (node.raw as string)[0] : this.code[node.start];
    }

    private precedencePass(): void {
        for (const node of this.moved) {
            const slot = this.tree.get(node);

            if (slot === undefined || slot.parent === null || !this.needsParens(node, slot.parent, slot.key)) {
                continue;
            }

            this.wrap(node);
        }
    }

    /**
     * A winner that sat in the call's arguments (`[+In]`) may land in a
     * `for (init; …)` initializer (`[~In]`): `for (let f = 'a' in o; …)` would
     * not parse, so a winner with a bare `in` is wrapped there.
     */
    private forInitPass(): void {
        for (const node of this.moved) {
            if (!this.wrapped.has(node) && this.inForInit(node) && this.hasBareIn(node)) {
                this.wrap(node);
            }
        }
    }

    /** Whether the node is in a `for` initializer with no `[+In]` reset in between */
    private inForInit(node: Node): boolean {
        let child = node;

        for (;;) {
            const slot = this.tree.get(child);

            if (slot === undefined || slot.parent === null) {
                return false;
            }

            const { parent, key } = slot;

            if (parent.type === 'ForStatement') {
                return key === 'init';
            }

            if (this.wrapped.has(parent) || resetsInContext(parent, key)) {
                return false;
            }

            child = parent;
        }
    }

    /** Whether the subtree has an `in` operator outside parentheses and other `[+In]` resets */
    private hasBareIn(root: Node): boolean {
        let found = false;

        const walk = (node: Node): void => {
            if (found || isTypeNode(node)) {
                return;
            }

            if ((node.type === 'BinaryExpression' && node.operator === 'in') || node.type === 'PrivateInExpression') {
                found = true;

                return;
            }

            forEachChild(node, (child, parent, key) => {
                if (!this.wrapped.has(child) && !resetsInContext(parent, key)) {
                    walk(child);
                }
            });
        };

        walk(root);

        return found;
    }

    private needsParens(node: Node, parent: Node, key: string): boolean {
        if (PRIMARY.has(node.type) && !node.optional) {
            if (
                node.type === 'Literal' &&
                typeof node.value === 'number' &&
                parent.type === 'MemberExpression' &&
                key === 'object' &&
                !parent.computed
            ) {
                return true;
            }

            return parent.type === 'NewExpression' && key === 'callee' && containsCallInChain(node);
        }

        return !SAFE_SLOTS[parent.type]?.includes(key);
    }

    private leadingTokenPass(): void {
        for (const node of this.tree.keys()) {
            if (node.type === 'ExpressionStatement') {
                this.guardLeadingToken(node.expression as Node, (leaf, chain) => {
                    if (
                        leaf.type === 'ObjectExpression' ||
                        leaf.type === 'FunctionExpression' ||
                        leaf.type === 'ClassExpression'
                    ) {
                        return true;
                    }

                    const parent = chain.at(-2);

                    return (
                        leaf.type === 'Identifier' &&
                        leaf.name === 'let' &&
                        parent !== undefined &&
                        parent.type === 'MemberExpression' &&
                        parent.computed &&
                        parent.object === leaf
                    );
                });
            } else if (node.type === 'ExportDefaultDeclaration') {
                this.guardLeadingToken(
                    node.declaration as Node,
                    leaf => leaf.type === 'FunctionExpression' || leaf.type === 'ClassExpression'
                );
            } else if (node.type === 'ArrowFunctionExpression' && node.body.type !== 'BlockStatement') {
                this.guardLeadingToken(node.body as Node, leaf => leaf.type === 'ObjectExpression');
            }
        }
    }

    private guardLeadingToken(context: Node, forbidden: (leaf: Node, chain: Node[]) => boolean): void {
        const chain = this.leftmostChain(context);

        if (this.startsWithParen(chain)) {
            return;
        }

        const leaf = chain.at(-1) as Node;

        if (forbidden(leaf, chain)) {
            this.wrap(leaf);
        }
    }

    private statementBoundaryPass(): void {
        // (a) Terminate exposed statements, in every slot: they may have lost
        // the separator a removed `else` branch took with it
        const terminated = new Set<Node>();

        for (const node of this.exposed) {
            if (!this.tree.has(node)) {
                continue;
            }

            let leaf = node;

            for (;;) {
                if (leaf.type === 'IfStatement') {
                    leaf = (leaf.alternate ?? leaf.consequent) as Node;
                } else if (BODY_STATEMENTS.has(leaf.type)) {
                    leaf = leaf.body as Node;
                } else {
                    break;
                }
            }

            if (!SEMICOLON_STATEMENTS.has(leaf.type) || this.code[leaf.end - 1] === ';' || terminated.has(leaf)) {
                continue;
            }

            this.s.appendLeft(leaf.end, ';');
            this.insertedAfter.add(leaf.end);
            terminated.add(leaf);
        }

        // (b) Guard the leading token of changed statements, in statement lists
        for (const owner of this.tree.keys()) {
            const listKey = STATEMENT_LISTS.get(owner.type);

            if (listKey === undefined) {
                continue;
            }

            const list = owner[listKey] as Node[];

            list.forEach((stmt, index) => {
                const prev = list[index - 1] ?? null;

                if (prev === null || this.endsTerminated(prev)) {
                    return;
                }

                let first: string | undefined;
                let position = stmt.start;

                if (stmt.type === 'ExpressionStatement') {
                    const chain = this.leftmostChain(stmt.expression as Node);
                    const last = chain.at(-1) as Node;

                    position = last.start;
                    first = this.startsWithParen(chain) ? '(' : this.firstChar(last);
                } else {
                    first = this.code[stmt.start];
                }

                const changed =
                    this.exposed.has(stmt) || this.originalPrev.get(stmt) !== prev || first !== this.code[stmt.start];

                if (changed && first !== undefined && HAZARDOUS_LEADING.has(first)) {
                    this.s.prependRight(position, ';');
                    this.insertedBefore.add(position);
                }
            });
        }
    }

    /**
     * Whether the statement can never continue into the next one: its emitted
     * text ends with `;` (the terminator of step (a) included), or it is a
     * declaration or block that ends with its own `}`
     */
    private endsTerminated(stmt: Node): boolean {
        if (TERMINATED_STATEMENTS.has(stmt.type)) {
            return true;
        }

        return this.emittedText(stmt).trimEnd().endsWith(';');
    }

    private tokenBoundaryPass(): void {
        for (const [node, [start, end]] of this.replacedRange) {
            if (!this.tree.has(node)) {
                continue;
            }

            // The emitted text of the node, insertions of passes 1-3 included
            const emitted = this.emittedText(node);

            const before = codePointBefore(this.code, start);
            const after = codePointAt(this.code, end);

            if (!this.insertedBefore.has(node.start) && joins(before, codePointAt(emitted, 0))) {
                this.s.prependRight(node.start, ' ');
            }

            const last = codePointBefore(emitted, emitted.length);
            // A trailing `}` may close an identifier escape (`\u{61}in`)
            const closesEscape = last === '}' && after !== undefined && IDENT_CHAR.test(after);

            if (!this.insertedAfter.has(node.end) && (closesEscape || joins(last, after))) {
                this.s.appendLeft(node.end, ' ');
            }
        }
    }

    private emittedText(node: Node): string {
        if (this.synthetic.has(node)) {
            return node.raw as string;
        }

        try {
            return this.s.slice(node.start, node.end);
        } catch {
            return this.code.slice(node.start, node.end);
        }
    }
}

/** Every node of the final tree with its slot */
function indexTree(program: Node): Map<Node, Slot> {
    const tree = new Map<Node, Slot>([[program, { parent: null, key: '', index: null }]]);

    const walk = (node: Node): void => {
        forEachChild(node, (child, parent, key, index) => {
            tree.set(child, { parent, key, index });
            walk(child);
        });
    };

    walk(program);

    return tree;
}

function isRequireFromModule(call: Node): boolean {
    if (call.optional || call.callee.type !== 'Identifier' || call.callee.name !== 'require') {
        return false;
    }

    const arg = (call.arguments as Node[])[0];

    return arg !== undefined && arg.type === 'Literal' && arg.value === MODULE_SPECIFIER;
}

/**
 * Whether the module references the package at the top level: an import with
 * its specifier or a var declaration with a `require` of the package in the
 * initializer.
 */
function moduleReferencesPackage(program: Node): boolean {
    return (program.body as Node[]).some(item => {
        if (item.type === 'ImportDeclaration') {
            return item.source.value === MODULE_SPECIFIER && item.importKind !== 'type';
        }

        if (item.type === 'VariableDeclaration') {
            return (item.declarations as Node[]).some(declarator => {
                const init = declarator.init as Node | null;

                return init !== null && init.type === 'CallExpression' && isRequireFromModule(init);
            });
        }

        return false;
    });
}

/**
 * Transforms one module. `filename` has its query stripped: oxc infers the
 * language from its extension. A file that does not parse is returned
 * unchanged: the downstream transform reports the syntax error with its frame.
 */
export function transformBuildConditions(
    code: string,
    filename: string,
    config: ResolvedConfig,
    options: TransformOptions = {}
): TransformResult {
    const parserOptions: ParserOptions & { experimentalRawTransfer?: boolean } = {
        experimentalRawTransfer: options.rawTransfer ?? rawTransferSupported(),
    };
    const result = parseSync(filename, code, parserOptions);

    if (result.errors.length > 0) {
        return { code, map: null, errors: [] };
    }

    const transformer = new Transformer(code, config);

    transformer.run(result.program as unknown as Node);

    const s = transformer.magicString;

    if (!s.hasChanged()) {
        return { code, map: null, errors: transformer.errors };
    }

    return {
        code: s.toString(),
        map: s.generateMap({ hires: 'boundary', source: filename, includeContent: true }),
        errors: transformer.errors,
    };
}
