import { BUILD_RENDERER_VERSION } from './build-version.js';

declare const __MIDAD_RENDERER_VERSION__: string;
declare const __CLM_NATIVE_RENDERER_VERSION__: string;

export const NATIVE_RENDERER_VERSION =
    typeof __MIDAD_RENDERER_VERSION__ === 'string'
        ? __MIDAD_RENDERER_VERSION__
        : typeof __CLM_NATIVE_RENDERER_VERSION__ === 'string'
          ? __CLM_NATIVE_RENDERER_VERSION__
          : BUILD_RENDERER_VERSION;
