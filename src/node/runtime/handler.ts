import { NATIVE_RENDERER_VERSION } from '@saad5400/midad/version';
import { stat } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { messageHtml } from '../../interchange/message.js';
import { applyCollaboration, type CollaborationInput } from './collaboration.js';
import { importHtmlContent } from './html.js';
import type { createRendererRuntime, RenderInput } from './renderer.js';

export function createDocumentTaskHandler(
    renderer: Awaited<ReturnType<typeof createRendererRuntime>>,
    identity = NATIVE_RENDERER_VERSION,
) {
    return async (value: unknown): Promise<unknown> => {
        const job = value as { kind?: string; directory?: string; input?: unknown };
        if (!job || typeof job !== 'object') throw new Error('Invalid runtime task');
        if (job.kind === 'content') return importHtmlContent(job.input);
        if (job.kind === 'collaboration') return applyCollaboration(job.input as CollaborationInput, identity);
        if (job.kind === 'message') {
            const input = job.input as { content?: unknown; direction?: string };
            if (!input || !['rtl', 'ltr'].includes(input.direction ?? '')) throw new Error('Invalid message direction');
            return { html: messageHtml(input.content, input.direction as 'rtl' | 'ltr') };
        }
        if (job.kind !== 'render' || typeof job.directory !== 'string' || !isAbsolute(job.directory))
            throw new Error('Invalid rendering directory');
        const directory = await stat(job.directory);
        if (
            !directory.isDirectory() ||
            (directory.mode & 0o077) !== 0 ||
            (process.getuid && directory.uid !== process.getuid())
        )
            throw new Error('The rendering directory is not private');
        return renderer.render(job.input as RenderInput, job.directory);
    };
}
