import { expect, it } from 'vitest';
import { INVALID_TEXT_OFFSET, utf8Index } from '../../src/rendering/text/encoding';

it('maps UTF-8 boundaries to UTF-16 positions across Unicode and malformed surrogates', () => {
    const encoder = new TextEncoder();
    const samples = ['', 'ASCII', 'العَرَبِيَّة', 'cafe\u0301', '😀x', '\uD800x', 'x\uDC00', '\n\uFFFC\t'];
    let seed = 5400;
    for (let run = 0; run < 200; run++) {
        let text = '';
        for (let at = 0; at < 24; at++) {
            seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
            text += String.fromCodePoint(seed % 0x110000);
        }
        samples.push(text);
    }
    for (const text of samples) {
        const index = utf8Index(text);
        const expected = new Map<number, number>();
        let byte = 0,
            offset = 0;
        for (const character of text) {
            expected.set(byte, offset);
            byte += encoder.encode(character).length;
            offset += character.length;
        }
        expected.set(byte, offset);
        expect(index.offsets.length).toBe(encoder.encode(text).length + 1);
        for (let at = 0; at < index.offsets.length; at++)
            expect(index.offsets[at]).toBe(expected.get(at) ?? INVALID_TEXT_OFFSET);
        expect(index.wellFormed).toBe(
            Array.from(text).every((character) => {
                const code = character.codePointAt(0)!;
                return code < 0xd800 || code > 0xdfff;
            }),
        );
    }
});
