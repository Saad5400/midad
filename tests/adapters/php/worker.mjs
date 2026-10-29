import { serveTaskWorker } from '../../../dist/node/index.js';
import { createDocumentTaskHandler } from '../../../dist/node/runtime/handler.js';
import { createRendererRuntime } from '../../../dist/node/runtime/renderer.js';

const identity = 'a'.repeat(64);
const renderer = await createRendererRuntime({ identity });
serveTaskWorker(createDocumentTaskHandler(renderer, identity));
