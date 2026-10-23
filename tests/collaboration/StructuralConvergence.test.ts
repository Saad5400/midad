import { SharedNativeDocument } from '@saad5400/midad/collaboration';
import { exportDocument, importDocument } from '@saad5400/midad/document';
import {
    blockText,
    formatText,
    joinPreviousTextBlock,
    moveBlock,
    replaceInlineText,
    splitTextBlock,
    textBlocks,
} from '@saad5400/midad/editing';
import { describe, expect, it, vi } from 'vitest';
import { writeFileSync } from 'node:fs';

const characters = (peer: SharedNativeDocument) =>
    textBlocks(peer.document().root)
        .flatMap((block) => [...blockText(block)])
        .sort()
        .join('');

describe('three-peer structural convergence', () => {
    it.each([0x5eed, 0xc1, 0x5400])(
        'preserves text and canonical data with delayed delivery (seed %s)',
        (seed) => {
            let identity = 0;
            const uuid = vi
                .spyOn(crypto, 'randomUUID')
                .mockImplementation(
                    () =>
                        `00000000-0000-4000-8000-${seed.toString(16).padStart(4, '0')}${(++identity).toString(16).padStart(8, '0')}`,
                );
            let random = seed;
            const next = () => (random = (Math.imul(random, 1664525) + 1013904223) >>> 0);
            const source = SharedNativeDocument.create(
                importDocument(
                    {
                        type: 'doc',
                        content: ['A😀', 'Bب', 'C'].map((text, index) => ({
                            type: 'paragraph',
                            attrs: { nativeId: `p-${index}` },
                            content: [{ type: 'text', text }],
                        })),
                    },
                    'structural-fuzz',
                ),
            );
            const peers = [0, 1, 2].map((actor) => {
                const peer = SharedNativeDocument.fromState(source.state(), source.document().id);
                peer.ydoc.clientID = 1001 + actor;
                return peer;
            });
            source.destroy();
            const expected = [...'A😀BبC'];
            let inserted = 0;
            const trace: string[] = [];
            let diagnostic: unknown;
            const synchronize = () => {
                for (let round = 0; round < 2; round++)
                    for (const from of peers)
                        for (const to of peers) if (from !== to) to.receive(from.state(to.vector()));
                const text = expected.slice().sort().join('');
                for (const peer of peers) expect(characters(peer)).toBe(text);
                expect(exportDocument(peers[1].document())).toEqual(exportDocument(peers[0].document()));
                expect(exportDocument(peers[2].document())).toEqual(exportDocument(peers[0].document()));
            };
            try {
                const steps = Number(process.env.MIDAD_STRUCTURAL_FUZZ_STEPS ?? 3334);
                for (let step = 0; step < steps; step++) {
                    const actor = next() % peers.length,
                        peer = peers[actor],
                        document = peer.document();
                    const blocks = textBlocks(document.root),
                        index = next() % blocks.length,
                        block = blocks[index];
                    const text = blockText(block),
                        offsets = [0];
                    for (const character of text) offsets.push(offsets.at(-1)! + character.length);
                    const offset = offsets[next() % offsets.length];
                    const operation = blocks.length > 24 ? 3 : next() % 5;
                    let candidate = document;
                    if (operation === 0 || (blocks.length === 1 && operation >= 3)) {
                        const character = String.fromCodePoint(0xe000 + inserted++);
                        expected.push(character);
                        candidate = replaceInlineText(document, {
                            blockId: block.id,
                            from: offset,
                            to: offset,
                            text: character,
                            expectedRevision: document.revision,
                        });
                    } else if (operation === 1) {
                        candidate = formatText(
                            document,
                            { blockId: block.id, from: 0, to: text.length, expectedRevision: document.revision },
                            { kind: 'toggle', mark: 'bold' },
                        );
                    } else if (operation === 2) {
                        candidate = splitTextBlock(document, {
                            blockId: block.id,
                            from: offset,
                            to: offset,
                            expectedRevision: document.revision,
                        }).document;
                    } else if (operation === 3) {
                        candidate = joinPreviousTextBlock(document, blocks[Math.max(1, index)].id)!.document;
                    } else {
                        candidate = moveBlock(
                            document,
                            block.id,
                            blocks[(index + 1 + (next() % (blocks.length - 1))) % blocks.length].id,
                            next() % 2 ? 'before' : 'after',
                        );
                    }
                    trace.push(`${step}:${actor}:${operation}:${index}:${offset}`);
                    if (trace.length > 20) trace.shift();
                    const intended = textBlocks(candidate.root)
                        .flatMap((entry) => [...blockText(entry)])
                        .sort()
                        .join('');
                    const intendedOrder = textBlocks(candidate.root).map(blockText).join('\n');
                    const beforeState = process.env.MIDAD_FUZZ_ARTIFACTS
                        ? Buffer.from(peer.state()).toString('base64')
                        : undefined;
                    const beforeFamilies = process.env.MIDAD_FUZZ_ARTIFACTS
                        ? Array.from(peer.ydoc.getMap('families').entries())
                        : undefined;
                    const beforeChildren = process.env.MIDAD_FUZZ_ARTIFACTS
                        ? peer.ydoc.getArray('c:' + JSON.stringify(['', document.root.id])).toArray()
                        : undefined;
                    peer.publish(candidate);
                    if (process.env.MIDAD_FUZZ_ARTIFACTS)
                        diagnostic = {
                            seed,
                            step,
                            actor,
                            operation,
                            index,
                            offset,
                            before: exportDocument(document),
                            intended: exportDocument(candidate),
                            actual: exportDocument(peer.document()),
                            beforeState,
                            beforeFamilies,
                            beforeChildren,
                            afterChildren: peer.ydoc.getArray('c:' + JSON.stringify(['', document.root.id])).toArray(),
                            families: Array.from(peer.ydoc.getMap('families').entries()),
                            flows: Array.from(peer.ydoc.getMap('flows').entries()),
                            deleted: Array.from(peer.ydoc.getMap('deleted').entries()),
                            texts: Array.from(peer.ydoc.share.keys())
                                .filter((name) => name.startsWith('t:'))
                                .map((name) => [name, peer.ydoc.getText(name).toDelta()]),
                        };
                    expect(characters(peer)).toBe(intended);
                    expect(textBlocks(peer.document().root).map(blockText).join('\n')).toBe(intendedOrder);
                    if (next() % 4 === 0) synchronize();
                }
                synchronize();
            } catch (error) {
                if (process.env.MIDAD_FUZZ_ARTIFACTS)
                    writeFileSync(
                        `${process.env.MIDAD_FUZZ_ARTIFACTS}/${seed}.json`,
                        JSON.stringify(diagnostic, null, 2),
                    );
                throw new Error(`Seed ${seed}; trace ${trace.join(', ')}; ${String(error)}`, { cause: error });
            } finally {
                peers.forEach((peer) => peer.destroy());
                uuid.mockRestore();
            }
        },
        120000,
    );
});
