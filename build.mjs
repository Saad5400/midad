import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);

const root = dirname(fileURLToPath(import.meta.url));
const files = (directory) =>
    readdirSync(directory, { withFileTypes: true })
        .flatMap((entry) => {
            const path = join(directory, entry.name);
            return entry.isDirectory() ? files(path) : [path];
        })
        .sort();

export function dependencyIdentity(lock, roots) {
    const packages = lock.packages;
    if (!packages) throw new Error('The runtime dependency lock is missing');
    const locate = (name, parent) => {
        let directory = parent;
        while (true) {
            if (!directory.endsWith('node_modules')) {
                const candidate = `${directory ? `${directory}/` : ''}node_modules/${name}`;
                if (packages[candidate]) return candidate;
            }
            if (!directory) return undefined;
            directory = directory.includes('/') ? directory.slice(0, directory.lastIndexOf('/')) : '';
        }
    };
    const visit = (key, name, parents) => {
        const entry = packages[key],
            cycle = parents.indexOf(key);
        if (cycle >= 0) return { name, cycle: parents.length - cycle };
        const children = Object.keys({ ...entry.dependencies, ...entry.optionalDependencies })
            .sort()
            .flatMap((dependency) => {
                const resolved = locate(dependency, key);
                if (!resolved) {
                    if (Object.hasOwn(entry.optionalDependencies ?? {}, dependency)) return [];
                    throw new Error(`The runtime dependency ${dependency} is missing`);
                }
                return [visit(resolved, dependency, [...parents, key])];
            });
        return { name, version: entry.version, integrity: entry.integrity, dependencies: children };
    };
    return JSON.stringify(
        roots.flatMap(({ name, parent = '', optional = false }) => {
            const key = locate(name, parent);
            if (!key && optional) return [];
            if (!key) throw new Error(`The runtime dependency ${name} is missing`);
            return [visit(key, name, [])];
        }),
    );
}

function buildPackage(directory = root) {
    const metadata = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
    const compatibility = metadata.midad;
    if (
        !Number.isSafeInteger(compatibility?.layoutVersion) ||
        compatibility.layoutVersion < 1 ||
        !/^[a-f0-9]{64}$/.test(compatibility.layoutGolden ?? '')
    )
        throw new Error('The layout compatibility contract is missing');
    const lock = JSON.parse(readFileSync(join(directory, 'package-lock.json'), 'utf8'));
    const rendering = renderingIdentity(directory, compatibility.layoutEntries);
    const names = [...new Set(['canvaskit-wasm', ...rendering.packages])]
        .sort()
        .filter((name) => metadata.dependencies?.[name]);
    const layout = createHash('sha256').update(
        JSON.stringify([compatibility.layoutVersion, compatibility.layoutGolden]),
    );
    layout.update(rendering.fingerprint);
    layout.update(
        dependencyIdentity(
            lock,
            names.map((name) => ({ name })),
        ),
    );
    for (const file of files(join(directory, 'assets')).filter((path) => /\.(ttf|wasm)$/.test(path))) {
        layout.update(relative(directory, file).split(sep).join('/'));
        layout.update(readFileSync(file));
    }
    const artifact = createHash('sha256');
    for (const file of [
        join(directory, 'package.json'),
        join(directory, 'package-lock.json'),
        join(directory, 'build.mjs'),
        ...files(join(directory, 'src')).filter(
            (path) => path.endsWith('.ts') && basename(path) !== 'build-version.ts',
        ),
        ...files(join(directory, 'assets')).filter((path) => /\.(ttf|wasm)$/.test(path)),
    ]) {
        artifact.update(relative(directory, file).split(sep).join('/'));
        artifact.update(readFileSync(file));
    }
    rmSync(join(directory, 'dist'), { recursive: true, force: true });
    mkdirSync(join(directory, 'src/rendering'), { recursive: true });
    writeFileSync(
        join(directory, 'src/rendering/build-version.ts'),
        `export const BUILD_RENDERER_VERSION = '${artifact.digest('hex')}';\nexport const BUILD_LAYOUT_VERSION = ${compatibility.layoutVersion};\nexport const BUILD_LAYOUT_ID = '${layout.digest('hex')}';\n`,
    );
}

export function renderingIdentity(directory, entries) {
    if (!Array.isArray(entries) || !entries.length) throw new Error('Rendering entrypoints are missing');
    directory = resolve(directory);
    const generated = join(directory, 'src/rendering/build-version.ts');
    const ts = require('typescript'),
        seen = new Map(),
        packages = new Set();
    const visit = (file) => {
        if (seen.has(file) || file === generated) return;
        const source = readFileSync(file, 'utf8');
        const code = file.endsWith('.json')
            ? JSON.stringify(JSON.parse(source))
            : ts.transpileModule(source, {
                  compilerOptions: {
                      target: ts.ScriptTarget.ES2023,
                      module: ts.ModuleKind.ESNext,
                      removeComments: true,
                  },
              }).outputText;
        seen.set(file, code);
        if (file.endsWith('.json')) return;
        const ast = ts.createSourceFile(file, code, ts.ScriptTarget.ES2023, true, ts.ScriptKind.JS);
        const walk = (node) => {
            const specifier =
                ts.isImportDeclaration(node) || ts.isExportDeclaration(node)
                    ? node.moduleSpecifier
                    : ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword
                      ? node.arguments[0]
                      : undefined;
            if (specifier && ts.isStringLiteral(specifier)) {
                if (specifier.text.startsWith('.')) {
                    const target = resolve(dirname(file), specifier.text);
                    if (
                        target === generated ||
                        target === generated.slice(0, -3) + '.js' ||
                        target === generated.slice(0, -3)
                    )
                        return;
                    const resolved = ts.resolveModuleName(
                        specifier.text,
                        file,
                        { moduleResolution: ts.ModuleResolutionKind.Bundler, resolveJsonModule: true, allowJs: true },
                        ts.sys,
                    ).resolvedModule;
                    if (!resolved) throw new Error(`The rendering module ${specifier.text} is missing`);
                    visit(resolved.resolvedFileName);
                } else
                    packages.add(
                        specifier.text.startsWith('@')
                            ? specifier.text.split('/').slice(0, 2).join('/')
                            : specifier.text.split('/')[0],
                    );
            }
            ts.forEachChild(node, walk);
        };
        walk(ast);
    };
    entries.forEach((entry) => visit(resolve(directory, entry)));
    const hash = createHash('sha256');
    const paths = [...seen.keys()].sort();
    for (const file of paths) {
        hash.update(relative(directory, file).split(sep).join('/'));
        hash.update(seen.get(file));
    }
    return {
        fingerprint: hash.digest('hex'),
        packages: [...packages].sort(),
        files: paths.map((file) => relative(directory, file).split(sep).join('/')),
    };
}

async function buildVueAdapter(directory = root) {
    const { parse, compileScript } = await import('@vue/compiler-sfc');
    const ts = require('typescript');
    for (const path of files(join(directory, 'src/adapters/vue'))) {
        if (path.endsWith('.css')) {
            const output = join(directory, 'dist', relative(join(directory, 'src'), path));
            mkdirSync(dirname(output), { recursive: true });
            writeFileSync(output, readFileSync(path));
            continue;
        }
        if (!/\.(vue|ts)$/.test(path)) continue;
        let content = readFileSync(path, 'utf8');
        if (path.endsWith('.vue')) {
            const parsed = parse(content, { filename: path });
            if (parsed.errors.length) throw parsed.errors[0];
            content = compileScript(parsed.descriptor, {
                id: relative(directory, path), inlineTemplate: true,
                fs: { fileExists: existsSync, readFile: (file) => readFileSync(file, 'utf8') },
            }).content;
        }
        content = content.replace(/(from\s*['"]|import\s*\(\s*['"])([^'"]+)\.vue(['"])/g, '$1$2.js$3');
        const output = join(directory, 'dist', relative(join(directory, 'src'), path)).replace(/\.(vue|ts)$/, '.js');
        mkdirSync(dirname(output), { recursive: true });
        writeFileSync(output, ts.transpileModule(content, { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext } }).outputText);
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    if (process.argv.includes('--vue')) await buildVueAdapter();
    else buildPackage();
}
