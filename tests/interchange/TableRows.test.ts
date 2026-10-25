import { fragmentHtml, parseHtmlFragment } from '@saad5400/midad/interchange';
import { expect, it } from 'vitest';

it.each(['height="192"', 'style="height:192px"', 'style="height:144pt"', 'style="height:2in"'])(
    'preserves a row height through HTML clipboard serialization: %s',
    (height) => {
        const fragment = parseHtmlFragment(`<table><tr ${height}><td>Row</td></tr></table>`);
        expect(fragment.blocks[0].children![0].attributes?.rowHeight).toBe(192);
        const html = fragmentHtml(fragment);
        expect(html).toContain('height:192px');
        expect(parseHtmlFragment(html).blocks[0].children![0].attributes?.rowHeight).toBe(192);
    },
);
