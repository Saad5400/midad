import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

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
    const names = ['canvaskit-wasm', '@pdf-lib/fontkit', 'pdf-lib', 'color'].filter(
        (name) => metadata.dependencies?.[name],
    );
    const layout = createHash('sha256').update(
        JSON.stringify([compatibility.layoutVersion, compatibility.layoutGolden]),
    );
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

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) buildPackage();
