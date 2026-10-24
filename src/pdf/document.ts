import fontkit from '@pdf-lib/fontkit';
import {
    PDFBool,
    PDFDocument,
    PDFFlateStream,
    PDFHexString,
    PDFName,
    PDFNumber,
    PDFRawStream,
    PDFStreamWriter,
    PDFString,
    typedArrayFor,
    type PDFImage,
    type PDFObject,
    type PDFRef,
} from 'pdf-lib';
import {
    fieldDefinition,
    fieldDisplayValue,
    fieldSettings,
    fieldStyle,
    IMAGE_FIELD_TYPES,
} from '../content/fields/queries.js';
import type { NativeDocument } from '../document/model.js';
import { assertSceneRevision, type DocumentScene } from '../layout/scene.js';
import type { NativeTextKernel } from '../rendering/kernel.js';
import { NATIVE_RENDERER_VERSION } from '../rendering/version.js';
import { chooseFont } from '../typography/fonts.js';
import { NativePdfFont } from './font.js';
import { PdfReadingTree } from './reading.js';

export function sceneManifest(scene: DocumentScene): unknown {
    return {
        documentId: scene.documentId,
        revision: scene.revision,
        fontHash: scene.fontHash,
        pages: scene.pages.map((page) => ({ width: page.width, height: page.height, commands: page.commands })),
    };
}

export async function writeScenePdf(
    scene: DocumentScene,
    kernel: NativeTextKernel,
    latestDocument: () => NativeDocument,
    options: {
        title?: string;
        compress?: (contents: Uint8Array) => Uint8Array;
        objectsPerTick?: number;
    } = {},
): Promise<Uint8Array> {
    assertSceneRevision(scene, latestDocument(), kernel.fontHash);
    const pdf = await PDFDocument.create();
    pdf.registerFontkit(fontkit);
    pdf.catalog.set(
        PDFName.of('CLMNative'),
        PDFHexString.fromText(
            JSON.stringify({
                schema: 1,
                document: scene.documentId,
                renderer: NATIVE_RENDERER_VERSION,
                fontHash: scene.fontHash,
            }),
        ),
    );
    const widgets: PDFRef[] = [],
        formFonts = new Map<string, { name: string; ref: PDFRef }>();
    const fonts = new Map<string, { embedder: NativePdfFont; ref: PDFRef }>();
    const fontGlyphs = new Map<string, Map<number, Set<string>>>();
    for (const source of scene.pages)
        for (const command of source.commands) {
            if (command.kind && command.kind !== 'glyphs') continue;
            let entries = fontGlyphs.get(command.fontId);
            if (!entries) fontGlyphs.set(command.fontId, (entries = new Map()));
            command.glyphs.forEach((glyph, index) => {
                let texts = entries!.get(glyph);
                if (!texts) entries!.set(glyph, (texts = new Set()));
                texts.add(command.text[index]);
            });
        }
    for (const [id, glyphs] of fontGlyphs) {
        const embedder = await NativePdfFont.create(
            kernel.font(id).bytes,
            [...glyphs].flatMap(([glyph, texts]) => [...texts].map((text) => ({ glyph, text }))),
        );
        fonts.set(id, { embedder, ref: await embedder.embedIntoContext(pdf.context) });
    }
    const images = new Map<string, PDFImage>();
    for (const source of scene.pages)
        for (const command of source.commands) {
            if (command.kind === 'image' && !images.has(command.assetId)) {
                const image = await pdf.embedPng(kernel.images.get(command.assetId).bytes);
                await image.embed();
                const stream = pdf.context.lookup(image.ref);
                if (!(stream instanceof PDFRawStream)) throw new Error('Cannot embed the PDF image');
                stream.dict.set(PDFName.of('Interpolate'), PDFBool.True);
                const mask = pdf.context.lookup(stream.dict.get(PDFName.of('SMask')));
                if (mask instanceof PDFRawStream) mask.dict.set(PDFName.of('Interpolate'), PDFBool.True);
                images.set(command.assetId, image);
            }
        }
    pdf.setTitle(options.title ?? scene.documentId);
    pdf.setCreator('Midad');
    pdf.setSubject(`Document ${scene.documentId}, revision ${scene.revision}, font manifest SHA-256 ${scene.fontHash}`);
    const scalars = new Map<number, string>();
    const scalar = (value: number): string => {
        const cached = scalars.get(value);
        if (cached !== undefined) return cached;
        if (!Number.isFinite(value)) throw new Error('The PDF contains an invalid coordinate');
        const raw = String(value);
        const result = raw.includes('e') ? PDFNumber.of(value).toString() : raw;
        if (scalars.size < 65536) scalars.set(value, result);
        return result;
    };
    const opacityStates = new Map<number, PDFRef>();
    const reading = new PdfReadingTree(pdf);
    for (const source of scene.pages) {
        const page = pdf.addPage([source.width, source.height]);
        const text = reading.page(page, source.height);
        const fontKeys = new Map(
            [...fonts].map(([id, font]) => [id, page.node.newFontDictionary(font.embedder.fontName, font.ref)]),
        );
        const content: string[] = [];
        const imageKeys = new Map<string, PDFName>();
        const alphaKeys = new Map<number, PDFName>();
        const alpha = (opacity: number): string => {
            if (opacity === 1) return '';
            let key = alphaKeys.get(opacity);
            if (!key) {
                let ref = opacityStates.get(opacity);
                if (!ref) {
                    ref = pdf.context.register(pdf.context.obj({ Type: 'ExtGState', ca: opacity, CA: opacity }));
                    opacityStates.set(opacity, ref);
                }
                key = page.node.newExtGState('NativeAlpha', ref);
                alphaKeys.set(opacity, key);
            }
            return `${key} gs\n`;
        };
        for (const command of source.commands) {
            if (command.kind === 'clipStart') {
                content.push(
                    `q ${scalar(command.x)} ${scalar(source.height - command.y - command.height)} ${scalar(command.width)} ${scalar(command.height)} re W n`,
                );
                continue;
            }
            if (command.kind === 'clipEnd') {
                content.push('Q');
                continue;
            }
            if (command.kind === 'field') {
                const attrs = command.attributes,
                    type = String(attrs.type ?? 'text');
                if (IMAGE_FIELD_TYPES.has(type) || (typeof attrs.value === 'string' && !!attrs.value)) continue;
                const style = fieldStyle(attrs),
                    choice = chooseFont(style),
                    settings = fieldSettings(attrs);
                let font = formFonts.get(choice.id);
                if (!font) {
                    const embedded = await pdf.embedFont(kernel.font(choice.id).bytes, { subset: false });
                    font = { name: `NativeForm${formFonts.size}`, ref: embedded.ref };
                    formFonts.set(choice.id, font);
                }
                const filled = typeof attrs.value === 'string' && !!attrs.value;
                const options = Array.isArray(settings.options)
                    ? settings.options.filter((option): option is string => typeof option === 'string')
                    : [];
                const isChoice = ['choice', 'single', 'multi'].includes(type);
                const flags =
                    (settings.required ? 2 : 0) |
                    (filled ? 1 : 0) |
                    (settings.multiline ? 4096 : 0) |
                    (type === 'multi' ? 1 << 21 : type === 'choice' ? 1 << 17 : 0);
                const appearance = pdf.context.register(
                    pdf.context.flateStream('', {
                        Type: 'XObject',
                        Subtype: 'Form',
                        BBox: [0, 0, command.width, command.height],
                        Resources: {},
                    }),
                );
                const metadata = { clm: fieldDefinition(attrs) };
                const widget = pdf.context.register(
                    pdf.context.obj({
                        Type: 'Annot',
                        Subtype: 'Widget',
                        FT: isChoice ? 'Ch' : 'Tx',
                        T: PDFHexString.fromText(command.nodeId),
                        TU: PDFHexString.fromText(String(attrs.name ?? '')),
                        Rect: [
                            command.x,
                            source.height - command.y - command.height,
                            command.x + command.width,
                            source.height - command.y,
                        ],
                        P: page.ref,
                        F: 4,
                        Ff: flags,
                        DA: PDFString.of(`/${font.name} ${style.size} Tf ${style.color.slice(0, 3).join(' ')} rg`),
                        Q:
                            settings.textAlign === 'center' || !settings.textAlign
                                ? 1
                                : settings.textAlign === 'right' ||
                                    (settings.textAlign === 'start' && settings.direction !== 'ltr')
                                  ? 2
                                  : 0,
                        BS: { W: 0 },
                        AP: { N: appearance },
                        PdfEngineMeta: PDFHexString.fromText(JSON.stringify(metadata)),
                        ...(isChoice ? { Opt: options.map((option) => PDFHexString.fromText(option)) } : {}),
                        ...(filled ? { V: PDFHexString.fromText(fieldDisplayValue(attrs)) } : {}),
                    }),
                );
                page.node.addAnnot(widget);
                widgets.push(widget);
                continue;
            }
            if (command.kind === 'image') {
                let key = imageKeys.get(command.assetId);
                if (!key) {
                    key = page.node.newXObject('NativeImage', images.get(command.assetId)!.ref);
                    imageKeys.set(command.assetId, key);
                }
                content.push(
                    `q ${scalar(command.width)} 0 0 ${scalar(command.height)} ${scalar(command.x)} ${scalar(source.height - command.y - command.height)} cm ${key} Do Q`,
                );
                continue;
            }
            if (command.kind === 'link') {
                if (/^(https?:|mailto:|tel:)/i.test(command.href))
                    page.node.addAnnot(
                        pdf.context.register(
                            pdf.context.obj({
                                Type: 'Annot',
                                Subtype: 'Link',
                                Rect: [
                                    command.x,
                                    source.height - command.y - command.height,
                                    command.x + command.width,
                                    source.height - command.y,
                                ],
                                Border: [0, 0, 0],
                                A: { S: 'URI', URI: PDFString.of(command.href) },
                            }),
                        ),
                    );
                continue;
            }
            const color = command.color ?? [0, 0, 0, 1];
            const ink = color.slice(0, 3).map(scalar).join(' ');
            const state = alpha(color[3]);
            if (command.kind === 'rect') {
                content.push(
                    `q ${state}${ink} rg ${scalar(command.x)} ${scalar(source.height - command.y - command.height)} ${scalar(command.width)} ${scalar(command.height)} re f Q`,
                );
                continue;
            }
            if (command.kind === 'line') {
                content.push(
                    `q ${state}${ink} RG ${scalar(command.width)} w ${scalar(command.x)} ${scalar(source.height - command.y)} m ${scalar(command.toX)} ${scalar(source.height - command.toY)} l S Q`,
                );
                continue;
            }
            content.push(
                `q ${state}BT ${fontKeys.get(command.fontId)} ${scalar(command.size)} Tf ${ink} rg ${ink} RG ${scalar(command.size / 35)} w 4 M ${command.fauxBold ? 2 : 0} Tr`,
            );
            const font = fonts.get(command.fontId)!.embedder;
            for (let index = 0; index < command.glyphs.length; index++) {
                const start = command.reading?.find((part) => part.from === index && part.text);
                if (start) content.push(text.span(start));
                const x = scalar(command.positions[index * 2]);
                const y = scalar(source.height - command.positions[index * 2 + 1]);
                if (!command.text[index]) {
                    const scale = scalar(command.size / font.font.unitsPerEm);
                    content.push(
                        `ET q ${scale} 0 0 ${scale} ${x} ${y} cm ${scalar(font.font.unitsPerEm / 35)} w`,
                        ...font
                            .outline(command.glyphs[index], !!command.fauxItalic)
                            .map((operator) => operator.toString()),
                        `${command.fauxBold ? 'B' : 'f'} Q BT`,
                    );
                    if (command.reading?.some((part) => part.to === index + 1 && part.text)) content.push('EMC');
                    continue;
                }
                const code = font.hexCode(command.glyphs[index], command.text[index]);
                content.push(`1 0 ${command.fauxItalic ? 0.25 : 0} 1 ${x} ${y} Tm <${code}> Tj`);
                if (command.reading?.some((part) => part.to === index + 1 && part.text)) content.push('EMC');
            }
            content.push('ET Q');
        }
        const commands = content.join('\n');
        const stream = options.compress
            ? pdf.context.stream(options.compress(typedArrayFor(commands)), { Filter: PDFName.of('FlateDecode') })
            : pdf.context.flateStream(commands);
        page.node.addContentStream(pdf.context.register(stream));
        text.finish();
    }
    reading.finish();
    if (widgets.length)
        pdf.catalog.set(
            PDFName.of('AcroForm'),
            pdf.context.register(
                pdf.context.obj({
                    Fields: widgets,
                    NeedAppearances: false,
                    DR: { Font: Object.fromEntries([...formFonts.values()].map((font) => [font.name, font.ref])) },
                }),
            ),
        );
    let bytes: Uint8Array;
    if (options.compress) {
        if (!pdf.getPageCount()) pdf.addPage();
        await pdf.flush();
        const writer = PDFStreamWriter.forContext(pdf.context, options.objectsPerTick ?? 50);
        const sizing = writer as unknown as { computeIndirectObjectSize: (entry: [PDFRef, PDFObject]) => number };
        if (typeof sizing.computeIndirectObjectSize !== 'function')
            throw new Error('Unsupported PDF compression adapter');
        const size = sizing.computeIndirectObjectSize.bind(writer);
        const compressed = new WeakSet<PDFFlateStream>();
        sizing.computeIndirectObjectSize = (entry) => {
            const stream = entry[1];
            if (stream instanceof PDFFlateStream && !compressed.has(stream)) {
                const data = options.compress!(stream.getUnencodedContents());
                stream.getContents = () => data;
                stream.getContentsSize = () => data.length;
                compressed.add(stream);
            }
            return size(entry);
        };
        bytes = await writer.serializeToBuffer();
    } else bytes = await pdf.save({ objectsPerTick: options.objectsPerTick });
    assertSceneRevision(scene, latestDocument(), kernel.fontHash);
    return bytes;
}
