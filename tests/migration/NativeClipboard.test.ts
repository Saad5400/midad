import {
    clipboardPayload,
    fragmentHtml,
    parseHtmlFragment,
    parseNativeFragment,
    pasteFragment,
    plainTextFragment,
    readClipboard,
    selectionFragment,
} from '@saad5400/midad/clipboard';
import { findNode, importDocument, type NativeNode } from '@saad5400/midad/document';
import { blockText } from '@saad5400/midad/editing';
import { selectNodeText } from '@saad5400/midad/selection';
import { nodeTextStyle } from '@saad5400/midad/style';
import { describe, expect, it } from 'vitest';

const paragraph = (id: string, text: string) => ({
    type: 'paragraph',
    attrs: { id },
    content: [{ type: 'text', text }],
});

describe('native clipboard', () => {
    it('keeps relative font sizes relative to the inherited size', () => {
        const fragment = parseHtmlFragment(
            '<p style="font-size:18pt"><span style="font-size:150%">Relative</span></p>',
        );
        expect(nodeTextStyle(fragment.blocks[0].children![0]).size).toBe(27);
    });
    it('snapshots pasted metadata so clipboard objects cannot mutate the committed document', () => {
        const doc = importDocument({ type: 'doc', content: [paragraph('p', '')] }, 'immutable');
        const attributes = { color: 'red' };
        const fragment = {
            blocks: [
                {
                    id: 'pasted',
                    kind: 'paragraph',
                    attributes: { dir: 'ltr' },
                    children: [
                        { id: 'text', kind: 'text', text: 'Original', marks: [{ kind: 'textStyle', attributes }] },
                    ],
                },
            ],
        };
        const result = pasteFragment(
            doc,
            { anchor: { blockId: 'p', offset: 0 }, focus: { blockId: 'p', offset: 0 } },
            fragment,
        );
        attributes.color = 'blue';
        fragment.blocks[0].attributes.dir = 'rtl';
        expect(result.document.root.children![0].attributes?.dir).toBe('ltr');
        expect(nodeTextStyle(result.document.root.children![0].children![0]).color).toEqual([1, 0, 0, 1]);
        expect(Object.isFrozen(result.document.root.children![0].children![0].marks)).toBe(true);
    });
    it('retains the ordinal of a selected list segment and keeps quote structure', () => {
        const doc = importDocument(
            {
                type: 'doc',
                content: [
                    {
                        type: 'orderedList',
                        attrs: { start: 3 },
                        content: ['a', 'b', 'c'].map((id) => ({ type: 'listItem', content: [paragraph(id, id)] })),
                    },
                    { type: 'blockquote', content: [paragraph('quote-a', 'First'), paragraph('quote-b', 'Last')] },
                ],
            },
            'structure',
        );
        const list = selectionFragment(doc, {
            anchor: { blockId: 'b', offset: 0 },
            focus: { blockId: 'c', offset: 1 },
        });
        expect(list.blocks[0].kind).toBe('orderedList');
        expect(list.blocks[0].attributes?.start).toBe(4);
        expect(list.blocks[0].children).toHaveLength(2);
        const quote = selectionFragment(doc, {
            anchor: { blockId: 'quote-a', offset: 0 },
            focus: { blockId: 'quote-b', offset: 4 },
        });
        expect(quote.blocks[0].kind).toBe('blockquote');
        expect(quote.blocks[0].children).toHaveLength(2);
    });
    it('leaves a selection intact for an empty clipboard and inherits destination marks for plain paste', () => {
        const doc = importDocument(
            {
                type: 'doc',
                content: [
                    {
                        type: 'paragraph',
                        attrs: { id: 'p' },
                        content: [{ type: 'text', text: 'Bold', marks: [{ type: 'bold' }] }],
                    },
                ],
            },
            'plain',
        );
        const selection = { anchor: { blockId: 'p', offset: 1 }, focus: { blockId: 'p', offset: 3 } };
        expect(pasteFragment(doc, selection, plainTextFragment('')).document).toBe(doc);
        const result = pasteFragment(doc, selection, plainTextFragment('new'));
        expect(blockText(result.document.root.children![0])).toBe('Bnewd');
        expect(
            result.document.root.children![0].children!.every((node) =>
                node.marks?.some((mark) => mark.kind === 'bold'),
            ),
        ).toBe(true);
    });
    it('exports resolved text styles when explicit normal weight overrides an inherited heading', () => {
        const html = fragmentHtml({
            blocks: [
                {
                    id: 'h',
                    kind: 'heading',
                    attributes: { level: 1 },
                    children: [
                        {
                            id: 't',
                            kind: 'text',
                            text: 'Normal title',
                            marks: [
                                { kind: 'bold' },
                                {
                                    kind: 'textStyle',
                                    attributes: { fontWeight: 'normal', fontSize: 20, lineHeight: 1.8 },
                                },
                            ],
                        },
                    ],
                },
            ],
        });
        const restored = parseHtmlFragment(html);
        const style = nodeTextStyle(restored.blocks[0].children![0]);
        expect(style.bold).toBe(false);
        expect(style.size).toBe(15);
        expect(style.lineHeight).toBe(1.8);
    });

    it('copies styled text losslessly and supplies safe HTML and plain text', () => {
        const doc = importDocument(
            {
                type: 'doc',
                content: [
                    {
                        type: 'paragraph',
                        attrs: { id: 'p' },
                        content: [
                            { type: 'text', text: 'Hello ' },
                            {
                                type: 'text',
                                text: '<world>',
                                marks: [{ type: 'bold' }, { type: 'link', attrs: { href: 'https://example.test' } }],
                            },
                        ],
                    },
                ],
            },
            'copy',
        );
        const payload = clipboardPayload(doc, {
            anchor: { blockId: 'p', offset: 6 },
            focus: { blockId: 'p', offset: 13 },
        });
        expect(payload.text).toBe('<world>');
        expect(payload.html).toContain('<strong>');
        expect(payload.html).toContain('&lt;world&gt;');
        expect(payload.html).toContain('href="https://example.test/"');
        const fragment = parseNativeFragment(payload.native);
        expect(fragment.blocks[0].children![0].marks?.map((mark) => mark.kind)).toEqual(['bold', 'link']);
    });

    it('keeps native table merges, fields and bilingual metadata when copying a whole document', () => {
        const doc = importDocument(
            {
                type: 'doc',
                content: [
                    {
                        type: 'parallelRow',
                        attrs: { id: 'row', translationVersion: 9 },
                        content: [
                            {
                                type: 'parallelCell',
                                attrs: { lang: 'ar' },
                                content: [
                                    {
                                        type: 'table',
                                        content: [
                                            {
                                                type: 'tableRow',
                                                content: [
                                                    {
                                                        type: 'tableCell',
                                                        attrs: { colspan: 2 },
                                                        content: [
                                                            {
                                                                type: 'paragraph',
                                                                attrs: { id: 'cell-p' },
                                                                content: [
                                                                    {
                                                                        type: 'variable',
                                                                        attrs: {
                                                                            id: 'field',
                                                                            type: 'text',
                                                                            participant_id: 'participant',
                                                                            value: 'قيمة',
                                                                        },
                                                                    },
                                                                ],
                                                            },
                                                        ],
                                                    },
                                                ],
                                            },
                                        ],
                                    },
                                ],
                            },
                            { type: 'parallelCell', attrs: { lang: 'en' }, content: [paragraph('en', 'Value')] },
                        ],
                    },
                ],
            },
            'rich',
        );
        const payload = clipboardPayload(doc, selectNodeText(doc.root)!);
        const decoded = parseNativeFragment(payload.native);
        expect(decoded.blocks[0].attributes?.translationVersion).toBe(9);
        expect(payload.html).toContain('colspan="2"');
        expect(payload.native).toContain('participant_id');
        expect(payload.text).toContain('قيمة');
        const portable = parseHtmlFragment(payload.html);
        expect(portable.blocks[0].kind).toBe('parallelRow');
        expect(portable.blocks[0].attributes?.translationVersion).toBe(9);
        expect(portable.blocks[0].children![0].children![0].children![0].children![0].attributes?.colspan).toBe(2);
        const field = portable.blocks[0].children![0].children![0].children![0].children![0].children![0].children![0];
        expect(field.kind).toBe('variable');
        expect(field.attributes?.participant_id).toBe('participant');
        const target = importDocument({ type: 'doc', content: [paragraph('target', '')] }, 'target');
        const pasted = pasteFragment(
            target,
            { anchor: { blockId: 'target', offset: 0 }, focus: { blockId: 'target', offset: 0 } },
            decoded,
        );
        expect(pasted.document.root.children![0].kind).toBe('parallelRow');
        expect(pasted.document.root.children!.at(-1)!.kind).toBe('paragraph');
        const ids: string[] = [];
        const visit = (node: NativeNode): void => {
            ids.push(node.id);
            node.children?.forEach(visit);
        };
        visit(pasted.document.root);
        expect(new Set(ids).size).toBe(ids.length);
        expect(ids).not.toContain('field');
        expect(JSON.stringify(pasted.document)).toContain('participant_id');
    });

    it('copies a word from a nested cell as inline content and retains a table when copying across cells', () => {
        const doc = importDocument(
            {
                type: 'doc',
                content: [
                    {
                        type: 'table',
                        content: [
                            {
                                type: 'tableRow',
                                content: [
                                    { type: 'tableCell', content: [paragraph('a', 'First cell')] },
                                    { type: 'tableCell', content: [paragraph('b', 'Last cell')] },
                                ],
                            },
                        ],
                    },
                ],
            },
            'table',
        );
        expect(
            selectionFragment(doc, { anchor: { blockId: 'a', offset: 0 }, focus: { blockId: 'a', offset: 5 } })
                .blocks[0].kind,
        ).toBe('paragraph');
        const fragment = selectionFragment(doc, {
            anchor: { blockId: 'a', offset: 6 },
            focus: { blockId: 'b', offset: 4 },
        });
        expect(fragment.blocks[0].kind).toBe('table');
        expect(JSON.stringify(fragment)).toContain('cell');
    });

    it('pastes rich inline content between the original prefix and suffix without duplicating identities', () => {
        const doc = importDocument({ type: 'doc', content: [paragraph('p', 'Before after')] }, 'paste');
        const fragment = parseHtmlFragment('<p><strong>styled</strong> <a href="https://example.test">link</a></p>');
        const result = pasteFragment(
            doc,
            { anchor: { blockId: 'p', offset: 7 }, focus: { blockId: 'p', offset: 7 } },
            fragment,
        );
        expect(blockText(findNode(result.document, 'p')!)).toBe('Before styled linkafter');
        expect(result.document.revision).toBe(1);
        expect(result.caret.offset).toBe(18);
        expect(
            findNode(result.document, 'p')!.children!.some((node) => node.marks?.some((mark) => mark.kind === 'bold')),
        ).toBe(true);
    });

    it('pastes multiple paragraphs as blocks and restores the unselected suffix', () => {
        const doc = importDocument({ type: 'doc', content: [paragraph('p', 'Prefix suffix')] }, 'paste');
        const result = pasteFragment(
            doc,
            { anchor: { blockId: 'p', offset: 7 }, focus: { blockId: 'p', offset: 7 } },
            plainTextFragment('First\nSecond'),
        );
        expect(result.document.root.children!.map(blockText)).toEqual(['Prefix First', 'Secondsuffix']);
        expect(result.caret.offset).toBe(6);
        const again = pasteFragment(
            result.document,
            { anchor: result.caret, focus: result.caret },
            plainTextFragment('X\nY'),
        );
        expect(again.document.root.children!.map(blockText)).toEqual(['Prefix First', 'SecondX', 'Ysuffix']);
    });

    it('replaces a backward selection across paragraphs as one revision', () => {
        const doc = importDocument(
            { type: 'doc', content: [paragraph('p', 'First part'), paragraph('q', 'Last suffix')] },
            'paste',
        );
        const result = pasteFragment(
            doc,
            { anchor: { blockId: 'q', offset: 5 }, focus: { blockId: 'p', offset: 6 } },
            plainTextFragment('A\nB'),
        );
        expect(result.document.revision).toBe(1);
        expect(result.document.root.children!.map(blockText)).toEqual(['First A', 'Bsuffix']);
    });

    it('imports HTML headings, list starts, table spans, Arabic direction and inline CSS', () => {
        const fragment = parseHtmlFragment(
            '<div dir="rtl"><h2>عنوان</h2>\n<ol start="3"><li>أول</li><li><em>ثانٍ</em></li></ol><table><tr><th colspan="2">عنوان</th></tr><tr><td rowspan="2"><span style="color:red;font-size:18pt;background-color:#fff000">نص</span></td><td>آخر</td></tr></table></div>',
        );
        expect(fragment.blocks.map((node) => node.kind)).toEqual(['heading', 'orderedList', 'table']);
        expect(fragment.blocks[0].attributes).toMatchObject({ level: 2, dir: 'rtl' });
        expect(fragment.blocks[1].attributes?.start).toBe(3);
        const header = fragment.blocks[2].children![0].children![0];
        expect(header.attributes?.colspan).toBe(2);
        const text = fragment.blocks[2].children![1].children![0].children![0].children![0];
        expect(text.marks).toContainEqual({
            kind: 'textStyle',
            attributes: { color: 'red', fontSize: '18pt', backgroundColor: '#fff000' },
        });
    });

    it('collapses ordinary HTML whitespace while preserving preformatted text and explicit breaks', () => {
        const normal = parseHtmlFragment(
            '<p>  Hello\n <b> world </b> </p><pre>  a\n\tb  </pre><p><span style="white-space:pre-wrap">  keep  spaces\nand lines </span><br>tail</p>',
        );
        expect(normal.blocks.map(blockText)).toEqual(['Hello world', '  a\n\tb  ', '  keep  spaces\nand lines \ntail']);
    });

    it('strips executable HTML and unsafe links while retaining visible text', () => {
        const fragment = parseHtmlFragment(
            '<script>alert(1)</script><p onclick="alert(2)">Safe <a href="javascript:alert(3)">link</a><img src="https://evil.test/image" onerror="alert(4)"></p><iframe src="https://evil.test">Hidden</iframe>',
        );
        expect(fragment.blocks.map(blockText)).toEqual(['Safe link']);
        const html = JSON.stringify(fragment);
        expect(html).not.toMatch(/evil|javascript|alert|onclick|onerror|Hidden/);
    });

    it('falls back from an invalid native payload and supports paste without formatting', () => {
        const get = (type: string): string =>
            type === 'text/plain' ? 'Plain\r\nText' : type === 'text/html' ? '<p><b>Rich</b></p>' : '{bad';
        expect(readClipboard(get).blocks[0].children![0].marks?.[0].kind).toBe('bold');
        expect(readClipboard(get, true).blocks.map(blockText)).toEqual(['Plain', 'Text']);
        expect(() => parseHtmlFragment('x'.repeat(2_000_001))).toThrow('too large');
    });
});
