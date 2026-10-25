import { PDFObject } from 'pdf-lib';

const encoder = new TextEncoder();

export class EncodedReadingSpan extends PDFObject {
    constructor(private readonly contents: string) {
        super();
    }

    clone(): EncodedReadingSpan {
        return new EncodedReadingSpan(this.contents);
    }

    toString(): string {
        return this.contents;
    }

    sizeInBytes(): number {
        return this.contents.length;
    }

    copyBytesInto(buffer: Uint8Array, offset: number): number {
        const result = encoder.encodeInto(this.contents, buffer.subarray(offset, offset + this.contents.length));
        if (result.read !== this.contents.length || result.written !== this.contents.length)
            throw new Error('Invalid PDF reading span encoding');
        return result.written;
    }
}
