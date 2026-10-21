import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const files = (directory) =>
    readdirSync(directory, { withFileTypes: true })
        .flatMap((entry) => {
            const path = join(directory, entry.name);
            return entry.isDirectory() ? files(path) : [path];
        })
        .sort();
const hash = createHash('sha256');
for (const file of [
    join(root, 'package.json'),
    join(root, 'build.mjs'),
    ...files(join(root, 'src')).filter((path) => path.endsWith('.ts') && basename(path) !== 'build-version.ts'),
    ...files(join(root, 'assets')).filter((path) => /\.(ttf|wasm)$/.test(path)),
]) {
    hash.update(relative(root, file).split(sep).join('/'));
    hash.update(readFileSync(file));
}
rmSync(join(root, 'dist'), { recursive: true, force: true });
mkdirSync(join(root, 'src/rendering'), { recursive: true });
writeFileSync(
    join(root, 'src/rendering/build-version.ts'),
    `export const BUILD_RENDERER_VERSION = '${hash.digest('hex')}';\n`,
);
