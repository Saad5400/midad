// @vitest-environment node
import { DocumentSession, exportDocument, importDocument } from '@saad5400/midad';
import { getDefaultVariableSettings } from '@saad5400/midad/content/fields';
import { NATIVE_RENDERER_VERSION } from '@saad5400/midad/rendering';
import { fontAssets } from '@saad5400/midad/typography';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('standalone package entrypoints', () => {
    it('ships explicit entrypoints and keeps implementation files private', async () => {
        const packageJson = JSON.parse(await readFile('package.json', 'utf8'));
        expect(packageJson.exports['./*']).toBeUndefined();
        for (const entry of Object.values(packageJson.exports)) {
            if (typeof entry === 'string') continue;
            const target = entry as { types: string; import: string };
            expect((await readFile(target.types)).length).toBeGreaterThan(0);
            expect((await readFile(target.import)).length).toBeGreaterThan(0);
        }
        const resolution = JSON.parse(
            execFileSync(
                process.execPath,
                [
                    '--input-type=module',
                    '--eval',
                    `
            const paths = ['@saad5400/midad/document', '@saad5400/midad/layout/measurement', '@saad5400/midad/document/model', '@saad5400/midad/collaboration/shared/store', '@saad5400/midad/interchange/clipboard/html-reader', '@saad5400/midad/rendering/text/fonts', '@saad5400/midad/collaboration/sync/presence'];
            console.log(JSON.stringify(paths.map((path) => {
                try { return import.meta.resolve(path); } catch (error) { return error.code; }
            })));
        `,
                ],
                { encoding: 'utf8' },
            ),
        );
        expect(resolution[0]).toContain('/dist/document/index.js');
        expect(resolution.slice(1)).toEqual(Array(6).fill('ERR_PACKAGE_PATH_NOT_EXPORTED'));
    });

    it('preserves existing integration entrypoints through the same implementations', async () => {
        const [oldFields, fields, oldFonts, typography, rendering, oldPaint] = await Promise.all([
            import('@saad5400/midad/fields'),
            import('@saad5400/midad/content/fields'),
            import('@saad5400/midad/fonts'),
            import('@saad5400/midad/typography'),
            import('@saad5400/midad/rendering'),
            import('@saad5400/midad/paint'),
        ]);
        expect(oldFields.nativeFields).toBe(fields.nativeFields);
        expect(oldFonts.chooseFont).toBe(typography.chooseFont);
        expect(oldFonts.neededFontFiles).toBe(rendering.neededFontFiles);
        expect(oldPaint.paintPage).toBe(rendering.paintPage);
        const [document, editing] = await Promise.all([
            import('@saad5400/midad/document'),
            import('@saad5400/midad/editing'),
        ]);
        expect(document.blockText).toBe(editing.blockText);
        expect(document.textBlocks).toBe(editing.textBlocks);
    });
    it('offers focused browser APIs while preserving earlier individual imports', async () => {
        const [browser, input, view, commands, pointer, canvas, navigation] = await Promise.all([
            import('@saad5400/midad/browser'),
            import('@saad5400/midad/browser/input'),
            import('@saad5400/midad/browser/view'),
            import('@saad5400/midad/browser/commands'),
            import('@saad5400/midad/browser/page-pointer'),
            import('@saad5400/midad/browser/page-canvas'),
            import('@saad5400/midad/navigation'),
        ]);
        expect(input.PagePointerController).toBe(pointer.PagePointerController);
        expect(view.PageCanvasController).toBe(canvas.PageCanvasController);
        expect(input.NativeNavigation).toBe(navigation.NativeNavigation);
        expect(commands.DocumentCommandController).toBe(browser.DocumentCommandController);
        expect(Object.keys(input)).not.toContain('PageView');
        expect(Object.keys(view)).not.toContain('DocumentCommandController');
        expect(Object.keys(commands)).not.toContain('SelectionController');
    });

    it('identifies its renderer without an application build definition', () => {
        expect(NATIVE_RENDERER_VERSION).toMatch(/^[a-f0-9]{64}$/);
    });
    it('edits stored document content through its public API without a CLM loader', () => {
        const content = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'عقد ABC' }] }] };
        const document = importDocument(content, 'standalone');
        const session = new DocumentSession(document);
        expect(exportDocument(session.document)).toMatchObject(content);
        expect(getDefaultVariableSettings('date')).toMatchObject({ calendarType: 'gregorian', required: true });
    });
    it('fingerprints source and fonts deterministically without hashing its generated output', async () => {
        const directory = await mkdtemp(join(tmpdir(), 'midad-build-'));
        try {
            await cp('build.mjs', join(directory, 'build.mjs'));
            await mkdir(join(directory, 'src'));
            await mkdir(join(directory, 'assets'));
            await writeFile(
                join(directory, 'package.json'),
                JSON.stringify({
                    version: '1',
                    midad: { layoutVersion: 1, layoutGolden: '1'.repeat(64) },
                    dependencies: { 'canvaskit-wasm': '1' },
                }),
            );
            await writeFile(
                join(directory, 'package-lock.json'),
                JSON.stringify({
                    packages: { 'node_modules/canvaskit-wasm': { version: '1', integrity: 'wasm-one' } },
                }),
            );
            await writeFile(join(directory, 'src/entry.ts'), 'export const value = 1;');
            await writeFile(join(directory, 'assets/font.ttf'), 'font-one');
            await mkdir(join(directory, 'dist'));
            await writeFile(join(directory, 'dist/removed-module.js'), 'stale implementation');
            const build = async () => {
                execFileSync(process.execPath, [join(directory, 'build.mjs')]);
                return readFile(join(directory, 'src/rendering/build-version.ts'), 'utf8');
            };
            const original = await build();
            const layout = (output: string) => output.match(/BUILD_LAYOUT_ID = '([^']+)'/)![1];
            await expect(readFile(join(directory, 'dist/removed-module.js'))).rejects.toThrow();
            expect(await build()).toBe(original);
            await writeFile(join(directory, 'src/entry.ts'), 'export const value = 2;');
            const updated = await build();
            expect(updated).not.toBe(original);
            expect(layout(updated)).toBe(layout(original));
            await writeFile(join(directory, 'src/entry.ts'), 'export const value = 1;');
            expect(await build()).toBe(original);
            await writeFile(join(directory, 'assets/font.ttf'), 'font-two');
            expect(layout(await build())).not.toBe(layout(original));
            await writeFile(join(directory, 'assets/font.ttf'), 'font-one');
            await writeFile(
                join(directory, 'package.json'),
                JSON.stringify({
                    version: '2',
                    midad: { layoutVersion: 1, layoutGolden: '1'.repeat(64) },
                    dependencies: { 'canvaskit-wasm': '1', yjs: '2' },
                }),
            );
            expect(layout(await build())).toBe(layout(original));
            await writeFile(
                join(directory, 'package-lock.json'),
                JSON.stringify({
                    packages: { 'node_modules/canvaskit-wasm': { version: '2', integrity: 'wasm-two' } },
                }),
            );
            expect(layout(await build())).not.toBe(layout(original));
        } finally {
            await rm(directory, { recursive: true, force: true });
        }
    });
    it('resolves every bundled font as an installed package asset', async () => {
        expect(Object.keys(fontAssets).length).toBeGreaterThan(40);
        for (const url of Object.values(fontAssets)) {
            const bytes = await readFile(new URL(url));
            expect(bytes.length).toBeGreaterThan(1000);
        }
    });
});
