export async function readNativeInput(chunks: AsyncIterable<Uint8Array>, limit = 24 * 1024 * 1024): Promise<unknown> {
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let text = '',
        bytes = 0;
    for await (const chunk of chunks) {
        bytes += chunk.length;
        if (bytes > limit) throw new Error('The render input exceeds its size limit');
        text += decoder.decode(new Uint8Array(chunk), { stream: true });
    }
    return JSON.parse(text + decoder.decode());
}
