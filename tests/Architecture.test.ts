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
            'layout/intrinsic.ts': 1,
            'layout/fields.ts': 1,
            'layout/object-regions.ts': 1,
            'layout/pdf-overlays.ts': 3,
            'layout/finalize.ts': 1,
            'layout/table-borders.ts': 1,
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

    it('keeps collaboration storage, reading and writing below the public lifecycle', () => {
        const phases: Record<string, number> = {
            'collaboration/values.ts': 0,
            'collaboration/shared/schema.ts': 0,
            'collaboration/shared/variants.ts': 1,
            'collaboration/shared/store.ts': 1,
            'collaboration/shared/reader.ts': 2,
            'collaboration/shared/inline.ts': 2,
            'collaboration/shared/writer.ts': 3,
            'collaboration/document.ts': 4,
            'collaboration/client.ts': 5,
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

    it('keeps renderer resources and shaping below the kernel lifecycle', () => {
        const failures: string[] = [];
        for (const [path, imports] of graph) {
            if (!name(path).startsWith('rendering/text/')) continue;
            for (const dependency of imports) {
                if (!dependency.specifier.startsWith('.')) continue;
                const child = name(target(path, dependency.specifier));
                if (child.startsWith('rendering/') && !child.startsWith('rendering/text/'))
                    failures.push(`${name(path)} → ${child}`);
                if (name(path) === 'rendering/text/fonts.ts' && child === 'rendering/text/shaping.ts')
                    failures.push(`${name(path)} → ${child}`);
            }
        }
        expect(failures).toEqual([]);
    });

    it('keeps sync protocol, presence and selection independent of the client coordinator', () => {
        const failures: string[] = [];
        for (const [path, imports] of graph) {
            if (!name(path).startsWith('collaboration/sync/')) continue;
            for (const dependency of imports) {
                if (!dependency.specifier.startsWith('.')) continue;
                const child = name(target(path, dependency.specifier));
                if (child === 'collaboration/client.ts' || child === 'collaboration/index.ts')
                    failures.push(`${name(path)} → ${child}`);
                if (name(path) === 'collaboration/sync/contracts.ts' && dependency.runtime)
                    failures.push(`${name(path)} → ${child}`);
            }
        }
        expect(failures).toEqual([]);
    });

    it('loads layout and canvas painting without initializing the text engine or collaboration', () => {
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
        visit(resolve(root, 'layout/index.ts'));
        visit(resolve(root, 'rendering/canvas.ts'));
        expect([...visited].map(name)).not.toContain('rendering/kernel.ts');
        expect([...external].filter((name) => /^(canvaskit-wasm|pdf-lib|yjs)(\/|$)/.test(name))).toEqual([]);
    });

    it('keeps browser input, page views and command menus independent', () => {
        const areas = new Set(['input', 'view', 'commands']);
        const failures: string[] = [];
        for (const [path, imports] of graph) {
            const [module, area] = name(path).split('/');
            if (module !== 'browser' || !areas.has(area)) continue;
            for (const dependency of imports) {
                if (!dependency.runtime || !dependency.specifier.startsWith('.')) continue;
                const [childModule, childArea] = name(target(path, dependency.specifier)).split('/');
                if (childModule === 'browser' && areas.has(childArea) && childArea !== area)
                    failures.push(`${name(path)} → ${childArea}`);
            }
        }
        expect(failures).toEqual([]);
    });

    it('keeps clipboard codecs independent of selection and insertion', () => {
        const codecs = ['model', 'html-policy', 'html-reader', 'html-writer', 'native-format'];
        const failures: string[] = [];
        for (const file of codecs) {
            const path = resolve(root, `interchange/clipboard/${file}.ts`);
            for (const dependency of graph.get(path) ?? []) {
                if (!dependency.specifier.startsWith('.')) continue;
                const child = name(target(path, dependency.specifier));
                if (
                    [
                        'interchange/clipboard.ts',
                        'interchange/clipboard/selection.ts',
                        'interchange/clipboard/paste.ts',
                    ].includes(child)
                )
                    failures.push(`${name(path)} → ${child}`);
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

    it.each([
        'rendering/index.ts',
        'content/fields/queries.ts',
        'content/presentation/queries.ts',
        'content/clauses/queries.ts',
        'content/fields/geometry.ts',
        'layout/pdf-overlays.ts',
        'layout/object-regions.ts',
        'collaboration/shared/reader.ts',
    ])('keeps %s independent of editing mutations', (entry) => {
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
    });

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
