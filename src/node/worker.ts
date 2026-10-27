import { parentPort } from 'node:worker_threads';

export function serveTaskWorker(handler: (input: unknown) => unknown | Promise<unknown>): void {
    if (!parentPort) throw new Error('This handler must run in a task worker');
    const port = parentPort;
    let busy = false;
    port.on('message', async (message: { type?: string; id?: number; payload?: unknown }) => {
        if (busy || message.type !== 'task' || !Number.isSafeInteger(message.id)) {
            port.postMessage({ type: 'invalid' });
            return;
        }
        busy = true;
        try {
            const value = await handler(message.payload);
            port.postMessage({ type: 'result', id: message.id, ok: true, value });
        } catch (error) {
            port.postMessage({
                type: 'result',
                id: message.id,
                ok: false,
                error: error instanceof Error ? error.message : 'The task failed',
            });
        } finally {
            busy = false;
        }
    });
    port.postMessage({ type: 'ready' });
}
