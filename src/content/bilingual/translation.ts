import { type Attributes, type NativeDocument, type NativeMark, type NativeNode } from '../../document/model.js';
import { isTextBlock, textBlocks } from '../../editing/text.js';
import { bilingualRows, emptyBilingualContent } from './columns.js';
import { bilingualContentKey, copyBilingualContent } from './copy.js';

export interface BilingualSegment {
    readonly id: string;
    readonly text: string;
}
export interface BilingualTranslationRequest {
    readonly from: string;
    readonly to: string;
    readonly segments: readonly BilingualSegment[];
    readonly context: {
        readonly title?: string | null;
        readonly summary?: string | null;
        readonly glossary?: readonly { source: string; target: string }[];
        readonly before?: string | null;
        readonly after?: string | null;
    };
}
export interface BilingualTranslator {
    translate(
        request: BilingualTranslationRequest,
        signal?: AbortSignal,
    ): Promise<{ segments: readonly BilingualSegment[]; failed: readonly string[] }>;
    glossary?(
        request: { from: string; to: string; text: string },
        signal?: AbortSignal,
    ): Promise<{ summary: string; glossary: readonly { source: string; target: string }[] }>;
    title?(): string | null;
    languages?(): readonly string[];
}
export interface BilingualSourceSegment extends BilingualSegment {
    readonly blockId: string;
    readonly plain: string;
    readonly marks: ReadonlyMap<string, readonly NativeMark[]>;
    readonly atoms: ReadonlyMap<string, NativeNode>;
}
export interface BilingualTranslationJob {
    readonly key: string;
    readonly rowId: string;
    readonly sourceId: string;
    readonly targetId: string;
    readonly from: string;
    readonly to: string;
    readonly sourceKey: string;
    readonly targetKey: string;
    readonly segments: readonly BilingualSourceSegment[];
}
const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const unescape = (text: string) => text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
export function bilingualDigest(text: string): string {
    let a = 2166136261,
        b = 5381;
    for (let index = 0; index < text.length; index++) {
        a = Math.imul(a ^ text.charCodeAt(index), 16777619);
        b = Math.imul(b, 33) ^ text.charCodeAt(index);
    }
    return `${(a >>> 0).toString(16)}-${(b >>> 0).toString(16)}`;
}
export function serializeBilingualBlock(block: NativeNode, id: string): BilingualSourceSegment {
    const marks = new Map<string, readonly NativeMark[]>(),
        atoms = new Map<string, NativeNode>(),
        styles = new Map<string, string>();
    let text = '',
        plain = '';
    for (const child of block.children ?? []) {
        if (child.kind === 'text') {
            const value = escape(child.text ?? '');
            plain += child.text ?? '';
            if (!child.marks?.length) {
                text += value;
                continue;
            }
            const key = JSON.stringify(child.marks);
            let tag = styles.get(key);
            if (!tag) {
                tag = `t${styles.size + 1}`;
                styles.set(key, tag);
                marks.set(tag, child.marks);
            }
            text += `<${tag}>${value}</${tag}>`;
        } else {
            const tag = `x${atoms.size + 1}`;
            atoms.set(tag, child);
            text += `<${tag}/>`;
            plain += ' ';
        }
    }
    return { id, blockId: block.id, text: text.replace(/<\/(t\d+)><\1>/g, ''), plain, marks, atoms };
}
export function parseBilingualSegment(
    text: string,
    source: BilingualSourceSegment,
    atoms: ReadonlyMap<string, NativeNode>,
): readonly NativeNode[] {
    const nodes: NativeNode[] = [],
        open: string[] = [],
        used = new Map<string, number>(),
        seen = new Set<string>();
    let cursor = 0;
    const append = (raw: string): void => {
        const value = unescape(raw);
        if (!value) return;
        const marks = new Map<string, NativeMark>();
        open.forEach((tag) =>
            source.marks.get(tag)?.forEach((mark) => {
                if (mark.kind === 'subscript') marks.delete('superscript');
                if (mark.kind === 'superscript') marks.delete('subscript');
                marks.set(mark.kind, mark);
            }),
        );
        nodes.push(
            Object.freeze({
                id: crypto.randomUUID(),
                kind: 'text',
                text: value,
                ...(marks.size ? { marks: Object.freeze([...marks.values()]) } : {}),
            }),
        );
    };
    for (const match of text.matchAll(/<(\/?)(t\d+|x\d+)\s*(\/?)>/g)) {
        append(text.slice(cursor, match.index));
        cursor = match.index + match[0].length;
        const [, closing, tag, selfClosing] = match;
        if (tag.startsWith('x')) {
            if (closing || !selfClosing || !source.atoms.has(tag)) throw new Error('Invalid translated placeholder');
            used.set(tag, (used.get(tag) ?? 0) + 1);
            const atom = atoms.get(source.atoms.get(tag)!.id);
            if (!atom) throw new Error('Missing translated placeholder');
            nodes.push(atom);
        } else {
            if (!source.marks.has(tag) || selfClosing) throw new Error('Invalid translated formatting');
            seen.add(tag);
            if (closing) {
                if (open.pop() !== tag) throw new Error('Unbalanced translated formatting');
            } else open.push(tag);
        }
    }
    append(text.slice(cursor));
    if (
        open.length ||
        [...source.atoms.keys()].some((tag) => used.get(tag) !== 1) ||
        [...source.marks.keys()].some((tag) => !seen.has(tag))
    )
        throw new Error('Translation did not retain rich content');
    return Object.freeze(nodes);
}
function emptyTarget(
    target: NativeNode,
    source: NativeNode,
    from: string,
    to: string,
    direction: 'rtl' | 'ltr',
): boolean {
    const plain = (node: NativeNode): boolean =>
        ['paragraph', 'heading', 'codeBlock', 'blockquote', 'bulletList', 'orderedList', 'listItem'].includes(
            node.kind,
        ) && (node.children ?? []).every(plain);
    return (
        (target.children ?? []).every(plain) ||
        bilingualContentKey(emptyBilingualContent(source.children ?? [], from, to, direction)) ===
            bilingualContentKey(target.children ?? [])
    );
}
export function bilingualTranslationJobs(
    document: NativeDocument,
    rowIds: ReadonlySet<string>,
    supported?: readonly string[],
): readonly BilingualTranslationJob[] {
    const result: BilingualTranslationJob[] = [];
    const allowed = supported?.length ? new Set(supported.map((language) => language.toLowerCase())) : undefined;
    const direction = document.root.attributes?.dir === 'ltr' ? 'ltr' : 'rtl';
    let sequence = 0;
    for (const row of bilingualRows(document)) {
        if (!rowIds.has(row.id) || row.attributes?.fill !== 'auto' || row.attributes?.show) continue;
        const cells = (row.children ?? []).filter(
            (cell) => !String(cell.attributes?.lang).toLowerCase().startsWith('x-c'),
        );
        const source =
            cells.find(
                (cell) =>
                    textBlocks(cell).some((block) => serializeBilingualBlock(block, '').text.trim()) &&
                    (!cell.attributes?.translatedFrom ||
                        cell.attributes.ownDigest !== bilingualDigest(bilingualContentKey(cell.children ?? []))),
            ) ?? cells.find((cell) => textBlocks(cell).some((block) => serializeBilingualBlock(block, '').text.trim()));
        if (!source) continue;
        const from = String(source.attributes?.lang).toLowerCase();
        if (allowed && !allowed.has(from)) continue;
        for (const target of cells) {
            if (target === source) continue;
            const to = String(target.attributes?.lang).toLowerCase();
            if (to === from || (allowed && !allowed.has(to))) continue;
            if (!emptyTarget(target, source, from, to, direction)) continue;
            const segments = textBlocks(source)
                .map((block) => serializeBilingualBlock(block, `s${sequence++}`))
                .filter((segment) => segment.text.trim());
            if (!segments.length) continue;
            result.push({
                key: target.id,
                rowId: row.id,
                sourceId: source.id,
                targetId: target.id,
                from,
                to,
                sourceKey: bilingualContentKey(source.children ?? []),
                targetKey: bilingualContentKey(target.children ?? []),
                segments,
            });
        }
    }
    return result;
}
export interface BilingualApplied {
    readonly document: NativeDocument;
    readonly applied: readonly string[];
    readonly stale: readonly string[];
    readonly failed: readonly string[];
}
export function applyBilingualTranslations(
    document: NativeDocument,
    jobs: readonly BilingualTranslationJob[],
    results: ReadonlyMap<string, string>,
): BilingualApplied {
    const rows = new Map(bilingualRows(document).map((row) => [row.id, row]));
    const updates = new Map<string, NativeNode>();
    const applied: string[] = [],
        stale: string[] = [],
        failed: string[] = [];
    const direction = document.root.attributes?.dir === 'ltr' ? 'ltr' : 'rtl';
    for (const job of jobs) {
        const row = rows.get(job.rowId),
            source = row?.children?.find((cell) => cell.id === job.sourceId),
            target = row?.children?.find((cell) => cell.id === job.targetId);
        if (
            !source ||
            !target ||
            row?.attributes?.fill !== 'auto' ||
            row.attributes?.show ||
            String(source.attributes?.lang).toLowerCase() !== job.from ||
            String(target.attributes?.lang).toLowerCase() !== job.to ||
            bilingualContentKey(source.children ?? []) !== job.sourceKey ||
            bilingualContentKey(target.children ?? []) !== job.targetKey
        ) {
            stale.push(job.key);
            continue;
        }
        if (job.segments.some((segment) => !results.has(segment.id))) {
            failed.push(job.key);
            continue;
        }
        try {
            const copied = copyBilingualContent(
                source.children ?? [],
                job.from,
                job.to,
                direction,
                target.children ?? [],
            );
            const atoms = new Map<string, NativeNode>();
            const pair = (before: NativeNode, after: NativeNode): void => {
                atoms.set(before.id, after);
                before.children?.forEach((child, index) => {
                    if (after.children?.[index]) pair(child, after.children[index]);
                });
            };
            source.children?.forEach((child, index) => pair(child, copied[index]));
            const segments = new Map(job.segments.map((segment) => [atoms.get(segment.blockId)?.id, segment]));
            const fill = (node: NativeNode): NativeNode => {
                if (isTextBlock(node)) {
                    const segment = segments.get(node.id);
                    if (!segment) return node;
                    return Object.freeze({
                        ...node,
                        children: parseBilingualSegment(results.get(segment.id)!, segment, atoms),
                    });
                }
                return node.children
                    ? Object.freeze({ ...node, children: Object.freeze(node.children.map(fill)) })
                    : node;
            };
            const children = Object.freeze(copied.map(fill));
            updates.set(
                target.id,
                Object.freeze({
                    ...target,
                    children,
                    attributes: Object.freeze({
                        ...target.attributes,
                        translatedFrom: job.from,
                        sourceDigest: bilingualDigest(job.sourceKey),
                        ownDigest: bilingualDigest(bilingualContentKey(children)),
                    }) as Attributes,
                }),
            );
            applied.push(job.key);
        } catch {
            failed.push(job.key);
        }
    }
    const visit = (node: NativeNode): NativeNode => {
        const changed = updates.get(node.id);
        if (changed) return changed;
        const children = node.children?.map(visit);
        return children?.some((child, index) => child !== node.children![index])
            ? Object.freeze({ ...node, children: Object.freeze(children) })
            : node;
    };
    return {
        document: updates.size
            ? Object.freeze({ ...document, root: visit(document.root), revision: document.revision + 1 })
            : document,
        applied,
        stale,
        failed,
    };
}

const scripts = new Map<string, RegExp | null>();
export function alignBilingualSources(document: NativeDocument, rowIds: ReadonlySet<string>): NativeDocument {
    const updates = new Map<string, NativeNode>();
    const direction = document.root.attributes?.dir === 'ltr' ? 'ltr' : 'rtl';
    for (const row of bilingualRows(document)) {
        if (!rowIds.has(row.id) || row.attributes?.fill !== 'auto' || row.attributes?.show) continue;
        const cells = (row.children ?? []).filter(
            (cell) => !String(cell.attributes?.lang).toLowerCase().startsWith('x-c'),
        );
        const written = cells.filter((cell) =>
            textBlocks(cell).some((block) => serializeBilingualBlock(block, '').text.trim()),
        );
        if (written.length !== 1) continue;
        const source = written[0],
            from = String(source.attributes?.lang);
        const text = textBlocks(source)
            .map((block) => serializeBilingualBlock(block, '').plain)
            .join('\n');
        let language = from,
            score = 0;
        const ordered = [source, ...cells.filter((cell) => cell !== source)];
        for (const cell of ordered) {
            const lang = String(cell.attributes?.lang);
            if (!scripts.has(lang)) {
                try {
                    const script = new Intl.Locale(lang).maximize().script!;
                    scripts.set(
                        lang,
                        new RegExp(
                            `\\p{Script=${['Hans', 'Hant', 'Jpan'].includes(script) ? 'Han' : script === 'Kore' ? 'Hangul' : script}}`,
                            'gu',
                        ),
                    );
                } catch {
                    scripts.set(lang, null);
                }
            }
            const count = text.match(scripts.get(lang) ?? /$^/g)?.length ?? 0;
            if (count > score) {
                score = count;
                language = lang;
            }
        }
        if (!score || language.toLowerCase() === from.toLowerCase()) continue;
        const target = cells.find((cell) => cell.attributes?.lang === language);
        if (!target || !emptyTarget(target, source, from, language, direction)) continue;
        const clean = (attrs?: Attributes): Attributes => {
            const value = { ...attrs };
            delete value.translatedFrom;
            delete value.sourceDigest;
            delete value.ownDigest;
            return Object.freeze(value);
        };
        updates.set(
            target.id,
            Object.freeze({ ...target, attributes: clean(target.attributes), children: source.children }),
        );
        updates.set(
            source.id,
            Object.freeze({
                ...source,
                attributes: clean(source.attributes),
                children: emptyBilingualContent(source.children ?? [], language, from, direction),
            }),
        );
    }
    if (!updates.size) return document;
    const visit = (node: NativeNode): NativeNode => {
        const value = updates.get(node.id);
        if (value) return value;
        const children = node.children?.map(visit);
        return children?.some((child, index) => child !== node.children![index])
            ? Object.freeze({ ...node, children: Object.freeze(children) })
            : node;
    };
    return Object.freeze({ ...document, root: visit(document.root), revision: document.revision + 1 });
}
