import { PDFArray, PDFDict, PDFName, PDFNumber, StandardFontEmbedder } from 'pdf-lib';
import { macSourceEncoding } from './source-encoding-tables.js';

function ansiNames(): string[] {
    const ansi = StandardFontEmbedder.for('Helvetica' as Parameters<typeof StandardFontEmbedder.for>[0]).encoding;
    const names = new Array<string>(256).fill('.notdef');
    for (const point of ansi.supportedCodePoints) {
        const entry = ansi.encodeUnicodeCodePoint(point);
        names[entry.code] = entry.name;
    }
    for (const code of [127, 129, 141, 143, 144, 157]) names[code] = 'bullet';
    names[159] = 'Ydieresis';
    names[160] = 'space';
    names[173] = 'hyphen';
    return names;
}

function standardNames(): string[] {
    const ansi = ansiNames();
    const names = new Array<string>(256).fill('.notdef');
    for (let code = 32; code <= 126; code++) names[code] = ansi[code];
    names[39] = 'quoteright';
    names[96] = 'quoteleft';
    const extensions: Record<number, string> = {
        161: 'exclamdown',
        162: 'cent',
        163: 'sterling',
        164: 'fraction',
        165: 'yen',
        166: 'florin',
        167: 'section',
        168: 'currency',
        169: 'quotesingle',
        170: 'quotedblleft',
        171: 'guillemotleft',
        172: 'guilsinglleft',
        173: 'guilsinglright',
        174: 'fi',
        175: 'fl',
        177: 'endash',
        178: 'dagger',
        179: 'daggerdbl',
        180: 'periodcentered',
        182: 'paragraph',
        183: 'bullet',
        184: 'quotesinglbase',
        185: 'quotedblbase',
        186: 'quotedblright',
        187: 'guillemotright',
        188: 'ellipsis',
        189: 'perthousand',
        191: 'questiondown',
        193: 'grave',
        194: 'acute',
        195: 'circumflex',
        196: 'tilde',
        197: 'macron',
        198: 'breve',
        199: 'dotaccent',
        200: 'dieresis',
        202: 'ring',
        203: 'cedilla',
        205: 'hungarumlaut',
        206: 'ogonek',
        207: 'caron',
        208: 'emdash',
        225: 'AE',
        227: 'ordfeminine',
        232: 'Lslash',
        233: 'Oslash',
        234: 'OE',
        235: 'ordmasculine',
        241: 'ae',
        245: 'dotlessi',
        248: 'lslash',
        249: 'oslash',
        250: 'oe',
        251: 'germandbls',
    };
    for (const [code, name] of Object.entries(extensions)) names[Number(code)] = name;
    return names;
}

export function sourceFontEncoding(font: PDFDict, metrics: StandardFontEmbedder): readonly string[] {
    const encoding = font.lookup(PDFName.of('Encoding'));
    const base = encoding instanceof PDFDict ? encoding.lookupMaybe(PDFName.of('BaseEncoding'), PDFName) : encoding;
    let names: string[];
    if (metrics.encoding.name !== 'WinAnsi') {
        names = new Array<string>(256).fill('.notdef');
        for (const point of metrics.encoding.supportedCodePoints) {
            const entry = metrics.encoding.encodeUnicodeCodePoint(point);
            names[entry.code] = entry.name;
        }
    } else if (base === PDFName.of('WinAnsiEncoding')) names = ansiNames();
    else if (base === undefined || base === PDFName.of('StandardEncoding')) names = standardNames();
    else {
        const predefined = base instanceof PDFName ? macSourceEncoding(base.decodeText(), ansiNames()) : undefined;
        if (!predefined) throw new Error('The source font encoding requires explicit glyph widths');
        names = predefined;
    }
    if (encoding instanceof PDFDict) {
        let code = 0;
        for (const entry of encoding.lookupMaybe(PDFName.of('Differences'), PDFArray)?.asArray() ?? []) {
            if (entry instanceof PDFNumber) code = entry.asNumber();
            else if (entry instanceof PDFName && Number.isInteger(code) && code >= 0 && code < 256)
                names[code++] = entry.decodeText();
            else throw new Error('Invalid source font encoding differences');
        }
    }
    return names;
}
