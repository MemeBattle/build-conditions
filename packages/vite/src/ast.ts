/**
 * Helpers over the oxc ESTree AST. Children are iterated through `visitorKeys`
 * from `oxc-parser`, so every node kind is covered without a hand-written
 * table. Nodes are plain mutable objects: the transform replaces children by
 * assigning their parent slot, as the Rust visitor assigns `*node`.
 */
import { visitorKeys } from 'oxc-parser';

/** An oxc ESTree node: every node has `type`, `start` and `end` (UTF-16 offsets) */
export type Node = { type: string; start: number; end: number; [key: string]: any };

/** `index` is null for a non-array slot */
export type Visit = (child: Node, parent: Node, key: string, index: number | null) => void;

export function isNode(value: unknown): value is Node {
    return typeof value === 'object' && value !== null && typeof (value as { type?: unknown }).type === 'string';
}

export function childKeys(node: Node): readonly string[] {
    return visitorKeys[node.type] ?? [];
}

/** Calls `visit` for every object child and every array element of the node */
export function forEachChild(node: Node, visit: Visit): void {
    for (const key of childKeys(node)) {
        const value: unknown = node[key];

        if (Array.isArray(value)) {
            for (let index = 0; index < value.length; index++) {
                const child: unknown = value[index];

                if (isNode(child)) {
                    visit(child, node, key, index);
                }
            }
        } else if (isNode(value)) {
            visit(value, node, key, null);
        }
    }
}

export function getSlot(parent: Node, key: string, index: number | null): unknown {
    return index === null ? parent[key] : parent[key][index];
}

export function setSlot(parent: Node, key: string, index: number | null, value: Node): void {
    if (index === null) {
        parent[key] = value;
    } else {
        parent[key][index] = value;
    }
}

/** The semantic node of a folded `isBuildConditions` call */
export function synthLiteral(value: boolean, start: number, end: number): Node {
    return { type: 'Literal', value, raw: String(value), start, end };
}

/** The semantic node of a statement removed from a non-list slot */
export function synthEmpty(start: number, end: number): Node {
    return { type: 'EmptyStatement', start, end };
}

/**
 * TypeScript nodes that hold values: the walkers descend into them. Every other
 * `TS*` node is a type and is skipped, like swc's `noop_visit_type!`. Type
 * children of the value nodes (`typeAnnotation` and friends) are `TS*` nodes
 * themselves, so they are skipped too.
 */
const VALUE_TS_NODES = new Set([
    'TSAsExpression',
    'TSSatisfiesExpression',
    'TSNonNullExpression',
    'TSTypeAssertion',
    'TSInstantiationExpression',
    'TSEnumDeclaration',
    'TSEnumBody',
    'TSEnumMember',
    'TSModuleDeclaration',
    'TSModuleBlock',
    'TSExportAssignment',
    'TSImportEqualsDeclaration',
    'TSExternalModuleReference',
    'TSQualifiedName',
    'TSParameterProperty',
]);

export function isTypeNode(node: Node): boolean {
    return node.type.startsWith('TS') && !VALUE_TS_NODES.has(node.type);
}

/** Class member keys that are property names when not computed */
const MEMBER_KEY_PARENTS = new Set([
    'MethodDefinition',
    'PropertyDefinition',
    'AccessorProperty',
    'TSAbstractMethodDefinition',
    'TSAbstractPropertyDefinition',
    'TSAbstractAccessorProperty',
]);

type IdentSink = Map<string, number> | Set<string>;

function addIdent(out: IdentSink, name: string): void {
    if (out instanceof Map) {
        out.set(name, (out.get(name) ?? 0) + 1);
    } else {
        out.add(name);
    }
}

/** A JSX element name: `<A>`, `<A.B.C>` (the root object), not `<a:b>` */
function collectJsxName(name: Node, out: IdentSink): void {
    let node = name;

    while (node.type === 'JSXMemberExpression') {
        node = node.object as Node;
    }

    if (node.type === 'JSXIdentifier') {
        addIdent(out, node.name as string);
    }
}

/**
 * Collects the identifiers of a subtree, a port of `IdentCollector` (Set) and
 * `IdentCounter` (Map with multiplicity), which visit swc `Ident` nodes: every
 * binding and reference, but not property names (`IdentName` in swc) and not
 * type positions.
 */
export function collectIdents(root: Node, out: IdentSink): void {
    const walk = (node: Node): void => {
        if (isTypeNode(node)) {
            return;
        }

        switch (node.type) {
            case 'Identifier':
                addIdent(out, node.name as string);
                break;
            case 'JSXIdentifier':
            case 'JSXNamespacedName':
            case 'MetaProperty':
            case 'ImportAttribute':
                return;
        }

        forEachChild(node, (child, parent, key) => {
            if (!parent.computed) {
                if (key === 'property' && parent.type === 'MemberExpression') {
                    return;
                }
                if (key === 'key' && (parent.type === 'Property' || MEMBER_KEY_PARENTS.has(parent.type))) {
                    return;
                }
            }

            // `export { a }` and `import { a }` carry one swc Ident; oxc gives
            // both slots a node with the same span
            if (key === 'exported' && parent.type === 'ExportSpecifier' && child.start === parent.local.start) {
                return;
            }
            if (key === 'imported' && parent.type === 'ImportSpecifier' && child.start === parent.local.start) {
                return;
            }

            if (key === 'name') {
                if (parent.type === 'JSXOpeningElement' || parent.type === 'JSXClosingElement') {
                    collectJsxName(child, out);
                }
                if (parent.type.startsWith('JSX')) {
                    return;
                }
            }

            walk(child);
        });
    };

    walk(root);
}

/**
 * An expression without side effects on evaluation: functions, literals,
 * identifiers and object/array literals made of such values. A port of `is_pure_expr`.
 */
export function isPureExpr(expr: Node): boolean {
    switch (expr.type) {
        case 'ArrowFunctionExpression':
        case 'FunctionExpression':
        case 'Literal':
        case 'Identifier':
            return true;
        case 'TemplateLiteral':
            return expr.expressions.length === 0;
        case 'ParenthesizedExpression':
        case 'TSAsExpression':
        case 'TSSatisfiesExpression':
        case 'TSTypeAssertion':
        case 'TSNonNullExpression':
        case 'TSInstantiationExpression':
            return isPureExpr(expr.expression as Node);
        case 'ArrayExpression':
            return (expr.elements as (Node | null)[]).every(
                element => element === null || (element.type !== 'SpreadElement' && isPureExpr(element))
            );
        case 'ObjectExpression':
            return (expr.properties as Node[]).every(property => {
                if (property.type !== 'Property') {
                    return false;
                }
                if (property.shorthand) {
                    return true;
                }
                if (property.computed) {
                    return false;
                }

                return property.kind !== 'init' || property.method || isPureExpr(property.value as Node);
            });
        default:
            return false;
    }
}

/**
 * Whether the statement contains `var` declarations that hoist out of it, a
 * port of `HoistedVarFinder`. Nested functions are not descended into: they
 * have their own scope. Getters, setters and class constructors are, because
 * swc models their bodies without a `Function` node.
 */
export function hasHoistedVar(stmt: Node): boolean {
    let found = false;

    const walk = (node: Node, parent: Node | null): void => {
        if (found || isTypeNode(node)) {
            return;
        }

        if (node.type === 'VariableDeclaration' && node.kind === 'var') {
            found = true;

            return;
        }

        if (node.type === 'FunctionDeclaration' || node.type === 'ArrowFunctionExpression') {
            return;
        }

        if (node.type === 'FunctionExpression' && !isSwcBodyWithoutFunction(parent)) {
            return;
        }

        forEachChild(node, child => walk(child, node));
    };

    walk(stmt, null);

    return found;
}

function isSwcBodyWithoutFunction(parent: Node | null): boolean {
    if (parent === null) {
        return false;
    }
    if (parent.type === 'Property') {
        return parent.kind === 'get' || parent.kind === 'set';
    }

    return parent.type === 'MethodDefinition' && parent.kind === 'constructor';
}
