import { BUILD_LAYOUT_ID } from './build-version.js';

export {
    BUILD_LAYOUT_ID as LAYOUT_COMPATIBILITY_ID,
    BUILD_LAYOUT_VERSION as LAYOUT_VERSION,
    BUILD_RENDERER_VERSION as RENDERER_BUILD_VERSION,
} from './build-version.js';

declare const __MIDAD_RENDERER_VERSION__: string;
declare const __CLM_NATIVE_RENDERER_VERSION__: string;

export const NATIVE_RENDERER_VERSION =
    typeof __MIDAD_RENDERER_VERSION__ === 'string'
        ? __MIDAD_RENDERER_VERSION__
        : typeof __CLM_NATIVE_RENDERER_VERSION__ === 'string'
          ? __CLM_NATIVE_RENDERER_VERSION__
          : BUILD_LAYOUT_ID;
