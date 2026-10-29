// @vitest-environment node
import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

async function convert(content: unknown): Promise<any> {
    return new Promise((resolveResult, reject) => {
        const child = execFile(
            'php',
            [
                '-r',
                String.raw`require getcwd().'/php.php'; echo json_encode((new Midad\Php\AgentContentConverter)->toDocument(json_decode(stream_get_contents(STDIN), true)), JSON_THROW_ON_ERROR);`,
            ],
            { cwd: resolve('.'), timeout: 5000 },
            (error, stdout, stderr) => {
                if (error) reject(new Error(`${error.message}: ${stderr}`));
                else {
                    try {
                        resolveResult(JSON.parse(stdout));
                    } catch {
                        reject(new Error(stdout || stderr));
                    }
                }
            },
        );
        child.stdin!.end(JSON.stringify(content));
    });
}
const agent = (content: string) => ({ type: 'doc', language: 'ar', blocks: [{ type: 'paragraph', content }] });
function variables(node: any): any[] {
    return [...(node.type === 'variable' ? [node] : []), ...(node.content ?? []).flatMap(variables)];
}
function shape(doc: any): string[] {
    return doc.content[0].content.map((node: any) =>
        node.type === 'text' ? `text:${node.text}` : `${node.attrs.type}:${node.attrs.name}`,
    );
}

describe.skipIf(process.env.RUN_PHP_ADAPTER !== '1')('agent content conversion', () => {
    it('keeps a signature at its token position', async () => {
        expect(
            shape(await convert(agent('التوقيع: <variable type="signature" placeholder="توقيع العامل" />'))),
        ).toEqual(['text:التوقيع: ', 'signature:توقيع العامل']);
    });
    it('keeps text on both sides of a signature', async () => {
        expect(
            shape(await convert(agent('قبل <variable type="signature" placeholder="توقيع الطرف الأول" /> بعد'))),
        ).toEqual(['text:قبل ', 'signature:توقيع الطرف الأول', 'text: بعد']);
    });
    it.each([
        ['signature', 250, 80],
        ['stamp', 250, 80],
        ['initials', 129, 43],
    ])('retains inline dimensions for %s', async (type, width, height) => {
        const fields = variables(await convert(agent(`<variable type="${type}" placeholder="حقل"/>`)));
        expect(fields).toHaveLength(1);
        expect(fields[0].attrs).toMatchObject({ type, display: 'inline', x: 0, y: 0, width, height });
    });
    it.each(['signature', 'stamp', 'initials'])('requires %s fields', async (type) => {
        expect(
            variables(await convert(agent(`<variable type="${type}" placeholder="حقل"/>`)))[0].attrs.settings,
        ).toEqual({ required: true });
    });
    it('preserves all fields in a clause body in their original order', async () => {
        const fields = variables(
            await convert({
                type: 'doc',
                language: 'ar',
                blocks: [
                    {
                        type: 'clause',
                        title: 'التوقيعات',
                        body: [
                            {
                                type: 'paragraph',
                                content: 'الاسم: <variable type="text" placeholder="اسم ممثل الشركة" />',
                            },
                            {
                                type: 'paragraph',
                                content: 'التوقيع: <variable type="signature" placeholder="توقيع ممثل الشركة" />',
                            },
                            {
                                type: 'paragraph',
                                content: 'التوقيع: <variable type="signature" placeholder="توقيع العامل" />',
                            },
                            {
                                type: 'paragraph',
                                content:
                                    'التاريخ: <variable type="date" calendar="hijri" placeholder="تاريخ التوقيع" />',
                            },
                        ],
                    },
                ],
            }),
        );
        expect(fields.map((field) => `${field.attrs.type}:${field.attrs.name}`)).toEqual([
            'text:اسم ممثل الشركة',
            'signature:توقيع ممثل الشركة',
            'signature:توقيع العامل',
            'date:تاريخ التوقيع',
        ]);
    });
    it('retains text and date defaults and the selected calendar', async () => {
        const fields = variables(
            await convert(
                agent(
                    'المدينة: <variable type="text" placeholder="مدينة الإبرام" /> بتاريخ <variable type="date" calendar="hijri" placeholder="تاريخ العقد" />',
                ),
            ),
        );
        expect(fields[0].attrs).toMatchObject({ type: 'text', display: 'inline', width: 200, height: 24 });
        expect(fields[0].attrs).not.toHaveProperty('settings');
        expect(fields[1].attrs).toMatchObject({
            type: 'date',
            width: 92,
            height: 24,
            settings: { calendarType: 'hijri' },
        });
    });
    it('uses text defaults for an unknown type', async () => {
        const fields = variables(await convert(agent('<variable type="not_a_real_type" placeholder="حقل" />')));
        expect(fields).toHaveLength(1);
        expect(fields[0].attrs).toMatchObject({ type: 'text', width: 200, height: 24 });
    });
    it.each(['te', 'tex', 'signatur'])('coerces truncated %s to text', async (type) => {
        expect(variables(await convert(agent(`<variable type="${type}" placeholder="حقل" />`)))[0].attrs.type).toBe(
            'text',
        );
    });
    it('preserves word boundaries around marks and fields', async () => {
        const nodes = (
            await convert(agent('قبل **نص مهم** وبعد <variable type="text" placeholder="الاسم"/> ثم _نهاية_'))
        ).content[0].content;
        expect(nodes.map((node: any) => node.text ?? '[variable]')).toEqual([
            'قبل ',
            'نص مهم',
            ' وبعد ',
            '[variable]',
            ' ثم ',
            'نهاية',
        ]);
        expect(nodes[1].marks).toEqual([{ type: 'bold' }]);
        expect(nodes[5].marks).toEqual([{ type: 'italic' }]);
    });
    it('emits valid empty paragraphs inside lists and tables', async () => {
        const doc = await convert({
            type: 'doc',
            blocks: [
                { type: 'list', items: ['', 'Item'] },
                { type: 'table', records: [{ Name: '', Value: 'Value' }] },
            ],
        });
        expect(doc.content[0].content[0].content[0]).toMatchObject({ type: 'paragraph', content: [] });
        expect(doc.content[1].content[1].content[0].content[0]).toMatchObject({ type: 'paragraph', content: [] });
    });
    it('retains editable field metadata while rejecting actor and media identities', async () => {
        const fields = variables(
            await convert(
                agent(
                    '<variable type="text" placeholder="الاسم" value="اسم معروف" required="true" description="اسم الطرف" participant_id="123"/>' +
                        '<variable type="date" calendar="hijri" required="false"/>' +
                        '<variable type="signature" value="forged signature" participant_id="123" id="forged-id"/>' +
                        '<variable type="attachment" value="https://example.com/forged.pdf"/>',
                ),
            ),
        );
        expect(fields[0].attrs).toMatchObject({
            value: 'اسم معروف',
            description: 'اسم الطرف',
            settings: { required: true },
        });
        expect(fields[0].attrs).not.toHaveProperty('participant_id');
        expect(fields[1].attrs.settings).toEqual({ calendarType: 'hijri', required: false });
        expect(fields[2].attrs).not.toHaveProperty('value');
        expect(fields[2].attrs).not.toHaveProperty('participant_id');
        expect(fields[2].attrs.id).not.toBe('forged-id');
        expect(fields[3].attrs).not.toHaveProperty('value');
    });
    it.each(['choice', 'single', 'multi'])('retains %s options as strings', async (type) => {
        expect(
            variables(
                await convert(
                    agent(
                        `<variable type="${type}" options="[&quot;الأول&quot;,&quot;الثاني&quot;]" required="true"/>`,
                    ),
                ),
            )[0].attrs.settings,
        ).toEqual({ required: true, options: ['الأول', 'الثاني'] });
    });
    it('retains later columns and aligns ragged records', async () => {
        const doc = await convert({
            type: 'doc',
            blocks: [
                {
                    type: 'table',
                    records: [{ name: 'A' }, { amount: 90000, name: 'B' }, { currency: 'SAR', amount: 100 }],
                },
            ],
        });
        expect(
            doc.content[0].content.map((row: any) =>
                row.content.map((cell: any) => cell.content[0].content.map((node: any) => node.text ?? '').join('')),
            ),
        ).toEqual([
            ['name', 'amount', 'currency'],
            ['A', '', ''],
            ['B', '90000', ''],
            ['', '100', 'SAR'],
        ]);
    });
    it.each([true, false])('represents an empty ordered=%s list as a paragraph', async (ordered) => {
        const doc = await convert({ type: 'doc', language: 'ar', blocks: [{ type: 'list', ordered, items: [] }] });
        expect(doc.content).toHaveLength(1);
        expect(doc.content[0]).toMatchObject({ type: 'paragraph', attrs: { dir: 'rtl' } });
        expect(doc.content[0].content ?? []).toEqual([]);
    });
    it('preserves the paragraph text alias', async () => {
        const nodes = (
            await convert({ type: 'doc', blocks: [{ type: 'paragraph', text: 'Agreed payment **90000**' }] })
        ).content[0].content;
        expect(nodes.map((node: any) => node.text)).toEqual(['Agreed payment ', '90000']);
        expect(nodes[1].marks).toEqual([{ type: 'bold' }]);
    });
});
