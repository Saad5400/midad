export const MARGIN_SIDES = ['top', 'bottom', 'left', 'right'] as const;
export type MarginSide = (typeof MARGIN_SIDES)[number];
export type PageMargins = Readonly<Record<MarginSide, number>>;
export interface PageLayout {
    readonly orientation: 'portrait' | 'landscape';
    readonly margins: PageMargins;
    readonly size?: PaperSize;
    readonly background?: PageBackground | null;
    readonly header?: boolean;
    readonly footer?: boolean;
}
export const MARGIN_MIN = 38;
export const MARGIN_MAX = 200;
export const PX_PER_CM = 96 / 2.54;
export const MARGIN_PRESETS = Object.freeze({
    normal: Object.freeze({ top: 96, bottom: 96, left: 96, right: 96 }),
    narrow: Object.freeze({ top: 48, bottom: 48, left: 48, right: 48 }),
    moderate: Object.freeze({ top: 96, bottom: 96, left: 72, right: 72 }),
    wide: Object.freeze({ top: 96, bottom: 96, left: 192, right: 192 }),
});

export const PAPER_SIZES = Object.freeze({
    a3: Object.freeze({ width: (297 * 72) / 25.4, height: (420 * 72) / 25.4 }),
    a4: Object.freeze({ width: (210 * 72) / 25.4, height: (297 * 72) / 25.4 }),
    a5: Object.freeze({ width: (148 * 72) / 25.4, height: (210 * 72) / 25.4 }),
    letter: Object.freeze({ width: 612, height: 792 }),
    legal: Object.freeze({ width: 612, height: 1008 }),
});
export type PaperSize = keyof typeof PAPER_SIZES | Readonly<{ width: number; height: number }>;
export interface PageBackground {
    readonly color?: string;
    readonly src?: string;
    readonly fit?: 'cover' | 'contain' | 'stretch';
}

export type PageLayoutOverride = Partial<Omit<PageLayout, 'margins'>> & { readonly margins?: Partial<PageMargins> };
