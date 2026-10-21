declare const __CLM_NATIVE_RENDERER_VERSION__: string;

export const NATIVE_RENDERER_VERSION =
    typeof __CLM_NATIVE_RENDERER_VERSION__ === 'string' ? __CLM_NATIVE_RENDERER_VERSION__ : 'unbuilt';
