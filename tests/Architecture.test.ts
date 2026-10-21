// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const root = resolve('src');
const files = (directory: string): string[] =>
    readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const path = resolve(directory, entry.name);
        return entry.isDirectory() ? files(path) : path.endsWith('.ts') ? [path] : [];
    });
const sources = files(root);
const sourceSet = new Set(sources);
const name = (path: string): string => relative(root, path).replaceAll('\\', '/');
const layer = (path: string): string => name(path).split('/')[0];
const allowed: Record<string, readonly string[]> = {
    document: [],
    typography: ['document'],
    editing: ['document', 'typography'],
    content: ['document', 'typography', 'editing'],
    rendering: ['document', 'typography', 'content'],
    layout: ['document', 'typography', 'editing', 'content', 'rendering'],
    pdf: ['document', 'typography', 'editing', 'content', 'rendering', 'layout'],
    browser: ['document', 'typography', 'editing', 'content', 'rendering', 'layout'],
    collaboration: ['document', 'editing', 'content'],
    interchange: ['document', 'typography', 'editing', 'content'],
    compat: ['typography', 'rendering'],
};

function dependencies(path: string): { specifier: string; runtime: boolean }[] {
    const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
    const result: { specifier: string; runtime: boolean }[] = [];
    const visit = (node: ts.Node): void => {
        if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
            const clause = node.importClause;
            const bindings = clause?.namedBindings;
            const types =
                clause?.isTypeOnly ||
                (bindings &&
                    ts.isNamedImports(bindings) &&
                    !clause?.name &&
                    bindings.elements.length > 0 &&
                    bindings.elements.every((item) => item.isTypeOnly));
            result.push({ specifier: node.moduleSpecifier.text, runtime: !types });
        } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
            const bindings = node.exportClause;
            const types =
                node.isTypeOnly ||
                (bindings &&
                    ts.isNamedExports(bindings) &&
                    bindings.elements.length > 0 &&
                    bindings.elements.every((item) => item.isTypeOnly));
            result.push({ specifier: node.moduleSpecifier.text, runtime: !types });
        } else if (
            ts.isImportTypeNode(node) &&
            ts.isLiteralTypeNode(node.argument) &&
            ts.isStringLiteral(node.argument.literal)
        ) {
            result.push({ specifier: node.argument.literal.text, runtime: false });
        } else if (
            ts.isCallExpression(node) &&
            node.expression.kind === ts.SyntaxKind.ImportKeyword &&
            node.arguments[0] &&
            ts.isStringLiteral(node.arguments[0])
        ) {
            result.push({ specifier: node.arguments[0].text, runtime: true });
        }
        ts.forEachChild(node, visit);
    };
    visit(source);
    return result;
}

const graph = new Map(sources.map((path) => [path, dependencies(path)]));
const target = (path: string, specifier: string): string => resolve(dirname(path), specifier.replace(/\.js$/, '.ts'));

describe('source architecture', () => {
    it('keeps all relative imports resolvable inside the package', () => {
        const failures: string[] = [];
        for (const [path, imports] of graph)
            for (const dependency of imports) {
                if (dependency.specifier.startsWith('.') && !sourceSet.has(target(path, dependency.specifier)))
                    failures.push(`${name(path)} → ${dependency.specifier}`);
            }
        expect(failures).toEqual([]);
    });

    it('keeps runtime dependencies pointing toward the document foundation', () => {
        const failures: string[] = [];
        for (const [path, imports] of graph)
            for (const dependency of imports) {
                if (!dependency.specifier.startsWith('.')) continue;
                const child = target(path, dependency.specifier);
                if (path === resolve(root, 'index.ts') || layer(path) === layer(child)) continue;
                const contract =
                    !dependency.runtime &&
                    ['content', 'rendering'].includes(layer(path)) &&
                    name(child) === 'layout/scene.ts';
                if (!contract && !allowed[layer(path)]?.includes(layer(child)))
                    failures.push(`${name(path)} → ${name(child)}`);
            }
        expect(failures).toEqual([]);
    });

    it('keeps layout measurers independent of cache and page orchestration', () => {
        const phases: Record<string, number> = {
            'layout/scene.ts': 0,
            'layout/context.ts': 0,
            'layout/text-reading.ts': 0,
            'layout/bands.ts': 1,
            'layout/fields.ts': 1,
            'layout/finalize.ts': 1,
            'layout/text.ts': 2,
            'layout/columns.ts': 2,
            'layout/tables.ts': 2,
            'layout/measurement.ts': 3,
            'layout/pages.ts': 4,
            'layout/document.ts': 5,
        };
        const failures: string[] = [];
        for (const [path, imports] of graph) {
            const phase = phases[name(path)];
            if (phase === undefined) continue;
            for (const dependency of imports) {
                if (!dependency.runtime || !dependency.specifier.startsWith('.')) continue;
                const child = name(target(path, dependency.specifier));
                if (phases[child] !== undefined && phases[child] > phase) failures.push(`${name(path)} → ${child}`);
            }
        }
        expect(failures).toEqual([]);
    });

    it('keeps internal dependencies away from public barrels', () => {
        const failures: string[] = [];
        for (const [path, imports] of graph) {
            if (name(path) === 'index.ts' || name(path).endsWith('/index.ts')) continue;
            for (const dependency of imports) {
                if (
                    dependency.specifier.startsWith('.') &&
                    name(target(path, dependency.specifier)).endsWith('/index.ts')
                )
                    failures.push(`${name(path)} → ${dependency.specifier}`);
            }
        }
        expect(failures).toEqual([]);
    });

    it.each(['rendering/index.ts', 'content/fields/queries.ts', 'content/presentation/queries.ts'])(
        'keeps %s independent of editing mutations',
        (entry) => {
            const visited = new Set<string>();
            const visit = (path: string): void => {
                if (visited.has(path)) return;
                visited.add(path);
                for (const dependency of graph.get(path) ?? [])
                    if (dependency.runtime && dependency.specifier.startsWith('.'))
                        visit(target(path, dependency.specifier));
            };
            visit(resolve(root, entry));
            expect(
                [...visited].map(name).filter((path) => path.startsWith('editing/') || path.endsWith('/commands.ts')),
            ).toEqual([]);
        },
    );

    it('has no circular runtime imports', () => {
        const complete = new Set<string>(),
            active = new Set<string>(),
            cycles: string[] = [];
        const visit = (path: string, chain: string[]): void => {
            if (active.has(path)) {
                cycles.push([...chain, path].map(name).join(' → '));
                return;
            }
            if (complete.has(path)) return;
            active.add(path);
            for (const dependency of graph.get(path) ?? []) {
                if (dependency.runtime && dependency.specifier.startsWith('.'))
                    visit(target(path, dependency.specifier), [...chain, path]);
            }
            active.delete(path);
            complete.add(path);
        };
        sources.forEach((path) => visit(path, []));
        expect(cycles).toEqual([]);
    });

    it('keeps the document entrypoint free of renderer, collaboration and browser packages', () => {
        const visited = new Set<string>(),
            external = new Set<string>();
        const visit = (path: string): void => {
            if (visited.has(path)) return;
            visited.add(path);
            for (const dependency of graph.get(path) ?? []) {
                if (!dependency.runtime) continue;
                if (dependency.specifier.startsWith('.')) visit(target(path, dependency.specifier));
                else external.add(dependency.specifier);
            }
        };
        visit(resolve(root, 'document/index.ts'));
        expect([...external]).toEqual([]);
    });
});
