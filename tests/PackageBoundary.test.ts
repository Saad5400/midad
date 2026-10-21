// @vitest-environment node
import { DocumentSession, exportDocument, importDocument } from '@saad5400/midad';
import { getDefaultVariableSettings } from '@saad5400/midad/field-schema';
import { fontAssets } from '@saad5400/midad/font-assets';
import { NATIVE_RENDERER_VERSION } from '@saad5400/midad/version';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('standalone package entrypoints', () => {
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
            await writeFile(join(directory, 'package.json'), '{}');
            await writeFile(join(directory, 'src/entry.ts'), 'export const value = 1;');
            await writeFile(join(directory, 'assets/font.ttf'), 'font-one');
            const build = async () => {
                execFileSync(process.execPath, [join(directory, 'build.mjs')]);
                return readFile(join(directory, 'src/build-version.ts'), 'utf8');
            };
            const original = await build();
            expect(await build()).toBe(original);
            await writeFile(join(directory, 'src/entry.ts'), 'export const value = 2;');
            expect(await build()).not.toBe(original);
            await writeFile(join(directory, 'src/entry.ts'), 'export const value = 1;');
            expect(await build()).toBe(original);
            await writeFile(join(directory, 'assets/font.ttf'), 'font-two');
            expect(await build()).not.toBe(original);
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
