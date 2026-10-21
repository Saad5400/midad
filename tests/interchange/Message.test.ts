import { exportDocument, importDocument } from '@saad5400/midad/document';
import { persistNativeIdentities } from '@saad5400/midad/document';
import {
    messageContent,
    messageHtml,
    messageIdentities,
    messageSource,
    sameMessageContent,
} from '@saad5400/midad/interchange';
import { describe, expect, it } from 'vitest';

describe('native saved messages', () => {
    it('renders safe formatting, direction, indentation and lists for welcome messages', () => {
        const html = messageHtml({
            type: 'doc',
            content: [
                {
                    type: 'paragraph',
                    attrs: { dir: 'rtl', indent: 2, textAlign: 'center' },
                    content: [
                        { type: 'text', text: '<welcome> & مرحبًا', marks: [{ type: 'bold' }, { type: 'underline' }] },
                    ],
                },
                {
                    type: 'bulletList',
                    content: [
                        {
                            type: 'listItem',
                            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Item' }] }],
                        },
                    ],
                },
            ],
        });
        expect(html).toContain('dir="rtl"');
        expect(html).toContain('margin-inline-start:36pt');
        expect(html).toContain('text-align:center');
        expect(html).toContain('<strong>');
        expect(html).toContain('text-decoration:underline');
        expect(html).toContain('&lt;welcome&gt; &amp; مرحبًا');
        expect(html).toContain('<ul dir="ltr">');
    });

    it('never renders executable links, unsafe font declarations or raw user markup', () => {
        const html = messageHtml({
            type: 'doc',
            content: [
                {
                    type: 'paragraph',
                    content: [
                        {
                            type: 'text',
                            text: '<img src=x onerror=alert(1)>',
                            marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }],
                        },
                    ],
                },
            ],
        });
        expect(html).not.toContain('href="javascript:');
        expect(html).not.toContain('<img');
        const font = messageHtml({
            type: 'doc',
            content: [
                {
                    type: 'paragraph',
                    content: [
                        {
                            type: 'text',
                            text: '<safe>',
                            marks: [
                                {
                                    type: 'textStyle',
                                    attrs: { fontFamily: 'Arial;background:url(https://invalid.test/x)' },
                                },
                            ],
                        },
                    ],
                },
            ],
        });
        expect(font).not.toContain('url(');
        expect(font).toContain('&lt;safe&gt;');
    });
    const content = {
        type: 'doc',
        content: [
            {
                type: 'paragraph',
                attrs: { dir: 'auto', id: null },
                content: [{ type: 'text', text: 'Welcome العربية', marks: [{ type: 'bold' }] }],
            },
        ],
    };
    it('keeps message formatting and whitespace without storing editor viewport settings', () => {
        const source = messageSource(content, 'ltr');
        const rendered = persistNativeIdentities(importDocument(source, 'message-test'));
        const saved = messageContent(exportDocument(rendered), messageIdentities(content), content);
        expect(saved.attrs).toBeUndefined();
        expect(sameMessageContent(content, saved)).toBe(true);
        expect(JSON.stringify(saved)).not.toContain('message-test');
        expect(JSON.stringify(saved)).toContain('Welcome العربية');
        expect(JSON.stringify(saved)).toContain('bold');
    });
    it('retains explicit source identities while discarding newly generated ones', () => {
        const original = {
            type: 'doc',
            attrs: { dir: 'rtl' },
            content: [
                { type: 'heading', attrs: { id: 'my-anchor', level: 2 }, content: [{ type: 'text', text: 'عنوان' }] },
            ],
        };
        const saved = messageContent(
            exportDocument(persistNativeIdentities(importDocument(messageSource(original, 'ltr'), 'message-test'))),
            messageIdentities(original),
            original,
        );
        expect((saved.content as Array<{ attrs: unknown }>)[0].attrs).toEqual({
            id: 'my-anchor',
            level: 2,
            dir: 'rtl',
            dirLocked: false,
        });
        expect(saved.attrs).toEqual({ dir: 'rtl' });
    });
    it('compares semantic message content without losing whitespace or formatting changes', () => {
        expect(sameMessageContent(content, JSON.parse(JSON.stringify(content)))).toBe(true);
        const change = JSON.parse(JSON.stringify(content));
        change.content[0].content[0].text += ' ';
        expect(sameMessageContent(content, change)).toBe(false);
        change.content[0].content[0].text = 'Welcome العربية';
        change.content[0].content[0].marks = [{ type: 'italic' }];
        expect(sameMessageContent(content, change)).toBe(false);
    });
    it('treats an old empty message and its initialized paragraph as the same content', () => {
        expect(sameMessageContent({}, { type: 'doc', content: [{ type: 'paragraph', content: [] }] })).toBe(true);
    });
    it('can show malformed old message data without breaking the verification screen', () => {
        expect(messageHtml({ type: 'doc', content: 'invalid' })).toBe('');
    });
    it('persists the displayed automatic direction for server-rendered email without changing message semantics', () => {
        const original = {
            type: 'doc',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'English message' }] }],
        };
        const saved = messageContent(messageSource(original, 'rtl'), messageIdentities(original), original);
        expect((saved.content as Array<{ attrs: unknown }>)[0].attrs).toEqual({ dir: 'ltr', dirLocked: false });
        expect(sameMessageContent(saved, original)).toBe(true);
    });
    it('keeps document metadata and unsupported private field values out of welcome HTML', () => {
        const html = messageHtml({
            type: 'doc',
            content: [
                {
                    type: 'paragraph',
                    attrs: { internal: 'private-metadata' },
                    content: [{ type: 'text', text: 'Public message' }],
                },
            ],
        });
        expect(html).toContain('Public message');
        expect(html).not.toContain('private-metadata');
        expect(html).not.toContain('data-clm-attrs');
        const field = messageHtml({
            type: 'doc',
            content: [
                {
                    type: 'paragraph',
                    content: [
                        { type: 'text', text: 'Public text' },
                        { type: 'variable', attrs: { id: 'field', type: 'text', value: 'private-field-value' } },
                    ],
                },
            ],
        });
        expect(field).toContain('Public text');
        expect(field).not.toContain('private-field-value');
    });
});
