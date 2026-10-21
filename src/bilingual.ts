import { languageDirection } from './direction.js';
import { type Attributes, type NativeDocument, type NativeNode } from './document.js';
import { blockText, isTextBlock, nodePath, textBlocks, type TextCaret } from './editing.js';
import type { DocumentScene } from './layout.js';
import { selectionRanges, type NativeSelection } from './selection.js';

export interface BilingualOptions {
    readonly languages: readonly string[];
    readonly widths: 'even' | 'narrow-start' | 'narrow-end';
    readonly gap: 'sm' | 'lg';
    readonly divider: boolean;
    readonly show: string | null;
    readonly source?: string;
    readonly fill?: 'manual' | 'auto';
}
export interface BilingualScope {
    readonly kind: 'document' | 'selection' | 'clause' | 'page';
    readonly selection?: NativeSelection;
    readonly scene?: DocumentScene;
    readonly page?: number;
}
export interface BilingualResult {
    readonly document: NativeDocument;
    readonly caret: TextCaret;
    readonly rows?: readonly string[];
}

export function bilingualRows(document: NativeDocument): readonly NativeNode[] {
    const result: NativeNode[] = [];
    const visit = (node: NativeNode): void => {
        if (node.kind === 'parallelRow') result.push(node);
        node.children?.forEach(visit);
    };
    visit(document.root);
    return result;
}
export function bilingualContext(document: NativeDocument, blockId?: string): NativeNode | undefined {
    return blockId ? [...nodePath(document, blockId)].reverse().find((node) => node.kind === 'parallelRow') : undefined;
}
export function bilingualOptions(row?: NativeNode): BilingualOptions {
    const languages = row?.children?.map((cell) => String(cell.attributes?.lang ?? '')) ?? ['ar', 'en'];
    const attrs = row?.attributes;
    return {
        languages,
        widths: attrs?.widths === 'narrow-start' || attrs?.widths === 'narrow-end' ? attrs.widths : 'even',
        gap: attrs?.gap === 'lg' ? 'lg' : 'sm',
        divider: attrs?.divider !== false,
        show: typeof attrs?.show === 'string' ? attrs.show : null,
        source: 'auto',
        fill: attrs?.fill === 'auto' ? 'auto' : 'manual',
    };
}
const scripts = new Map<string, RegExp | null>();
function detectLanguage(node: NativeNode, languages: readonly string[]): string {
    const text = textBlocks(node).map(blockText).join('\n');
    let chosen = languages[0],
        score = 0;
    for (const language of languages) {
        if (language.toLowerCase().startsWith('x-c')) continue;
        if (!scripts.has(language)) {
            try {
                const script = new Intl.Locale(language).maximize().script!;
                const alias = ['Hans', 'Hant', 'Jpan'].includes(script) ? 'Han' : script === 'Kore' ? 'Hangul' : script;
                scripts.set(language, new RegExp(`\\p{Script=${alias}}`, 'gu'));
            } catch {
                scripts.set(language, null);
            }
        }
        const matches = text.match(scripts.get(language) ?? /$^/g)?.length ?? 0;
        if (matches > score) {
            score = matches;
            chosen = language;
        }
    }
    return chosen;
}
function fresh(kind: string, attributes?: Attributes, children?: readonly NativeNode[]): NativeNode {
    const id = crypto.randomUUID();
    return Object.freeze({
        id,
        kind,
        attributes: Object.freeze({
            ...attributes,
            id,
            ...(attributes?.nativeId !== undefined ? { nativeId: id } : {}),
        }),
        ...(children ? { children: Object.freeze(children) } : {}),
    });
}
function blank(node: NativeNode, from: string, to: string, direction: 'rtl' | 'ltr'): NativeNode {
    const attrs = { ...node.attributes };
    if (attrs.dir !== undefined) attrs.dir = attrs.dirLocked ? languageDirection(to, direction) : 'auto';
    if (languageDirection(from, direction) !== languageDirection(to, direction)) {
        if (attrs.textAlign === 'left') attrs.textAlign = 'right';
        else if (attrs.textAlign === 'right') attrs.textAlign = 'left';
    }
    const paragraph = () => fresh('paragraph', { dir: 'auto' }, []);
    if (isTextBlock(node)) return fresh(node.kind, attrs, []);
    if (node.kind === 'clause')
        return fresh(
            'clause',
            {
                ...attrs,
                groupId: crypto.randomUUID(),
                activeVariantId: crypto.randomUUID(),
                variants: null,
                variantCount: 1,
                contentHash: null,
            },
            [fresh('clauseTitle', { dir: 'auto' }, []), fresh('clauseBody', undefined, [paragraph()])],
        );
    if (node.kind === 'table') {
        const structure = (part: NativeNode): NativeNode =>
            fresh(
                part.kind,
                part.attributes,
                ['tableCell', 'tableHeader'].includes(part.kind) ? [paragraph()] : (part.children ?? []).map(structure),
            );
        return structure(node);
    }
    if (node.kind === 'bulletList' || node.kind === 'orderedList')
        return fresh(node.kind, attrs, [fresh('listItem', undefined, [paragraph()])]);
    if (['horizontalRule', 'image', 'variable'].includes(node.kind)) return fresh(node.kind, attrs);
    return fresh(node.kind, attrs, [paragraph()]);
}
export function emptyBilingualContent(
    nodes: readonly NativeNode[],
    from: string,
    to: string,
    direction: 'rtl' | 'ltr',
): readonly NativeNode[] {
    return Object.freeze(nodes.map((node) => blank(node, from, to, direction)));
}
export function meaningfulColumn(node: NativeNode): boolean {
    if (node.kind === 'text') return !!node.text?.length;
    if (node.kind === 'clause') return true;
    if (['image', 'variable', 'horizontalRule', 'table'].includes(node.kind)) return true;
    return node.children?.some(meaningfulColumn) ?? false;
}
function targets(document: NativeDocument, scope: BilingualScope): ReadonlySet<string> {
    if (scope.kind === 'document')
        return new Set(document.root.children?.filter((node) => node.kind !== 'pdfPage').map((node) => node.id));
    let blocks: string[] = [];
    if (
        scope.kind === 'page' &&
        (scope.scene?.documentId !== document.id || scope.scene.revision !== document.revision)
    )
        throw new Error('The bilingual page scope is stale');
    if (scope.kind === 'page')
        blocks = scope.scene?.pages[scope.page ?? 0]?.lines.map((line) => line.paragraphId) ?? [];
    else if (scope.selection) blocks = selectionRanges(document, scope.selection).map((range) => range.blockId);
    const result = new Set<string>();
    for (const block of blocks) {
        const path = nodePath(document, block);
        const row = [...path].reverse().find((node) => node.kind === 'parallelRow');
        const clause = scope.kind === 'clause' ? [...path].reverse().find((node) => node.kind === 'clause') : undefined;
        const node = row ?? clause ?? path[1];
        if (node && node.kind !== 'pdfPage') result.add(node.id);
    }
    return new Set(
        [...result].filter(
            (id) =>
                !nodePath(document, id)
                    .slice(0, -1)
                    .some((node) => result.has(node.id)),
        ),
    );
}
export function bilingualScopeTargets(document: NativeDocument, scope: BilingualScope): ReadonlySet<string> {
    return targets(document, scope);
}
export function bilingualRowsInScope(document: NativeDocument, scope: BilingualScope): readonly NativeNode[] {
    const ids = targets(document, scope);
    const rows: NativeNode[] = [];
    const visit = (node: NativeNode, selected = false): void => {
        selected ||= ids.has(node.id);
        if (selected && node.kind === 'parallelRow') rows.push(node);
        node.children?.forEach((child) => visit(child, selected));
    };
    visit(document.root);
    return rows;
}
export interface BilingualScopeState {
    readonly languages: readonly string[];
    readonly written: readonly string[];
    readonly endLanguages: readonly string[];
    readonly available: readonly string[];
    readonly availableAll: readonly string[];
    readonly hasRows: boolean;
    readonly canEnd: boolean;
}
const uniqueLanguages = (languages: readonly string[]): string[] => {
    const seen = new Set<string>();
    return languages.filter((language) => {
        const key = language.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
};
export function bilingualScopeState(document: NativeDocument, scope: BilingualScope): BilingualScopeState {
    const rows = bilingualRowsInScope(document, scope);
    const split = rows.filter((row) => !row.attributes?.show);
    const languages = uniqueLanguages(
        rows.flatMap((row) => row.children?.map((cell) => String(cell.attributes?.lang ?? '')) ?? []),
    );
    const endLanguages = uniqueLanguages(
        split.flatMap((row) => row.children?.map((cell) => String(cell.attributes?.lang ?? '')) ?? []),
    );
    return {
        languages,
        written: uniqueLanguages(
            rows.flatMap(
                (row) =>
                    row.children?.filter(meaningfulColumn).map((cell) => String(cell.attributes?.lang ?? '')) ?? [],
            ),
        ),
        endLanguages,
        availableAll: languages.filter((language) =>
            rows.every((row) =>
                row.children?.some((cell) => String(cell.attributes?.lang).toLowerCase() === language.toLowerCase()),
            ),
        ),
        available: endLanguages.filter((language) =>
            split.every((row) =>
                row.children?.some((cell) => String(cell.attributes?.lang).toLowerCase() === language.toLowerCase()),
            ),
        ),
        hasRows: rows.length > 0,
        canEnd: split.length > 0,
    };
}
export function droppedLanguages(
    document: NativeDocument,
    options: BilingualOptions,
    scope: BilingualScope,
): readonly string[] {
    const retained = new Set(options.languages.map((language) => language.toLowerCase()));
    return uniqueLanguages(
        bilingualRowsInScope(document, scope).flatMap(
            (row) =>
                row.children
                    ?.filter(
                        (cell) => !retained.has(String(cell.attributes?.lang).toLowerCase()) && meaningfulColumn(cell),
                    )
                    .map((cell) => String(cell.attributes?.lang)) ?? [],
        ),
    );
}
function mapRows(node: NativeNode, ids: ReadonlySet<string>, transform: (row: NativeNode) => NativeNode): NativeNode {
    const children = node.children?.map((child) => mapRows(child, ids, transform));
    const next = children?.some((child, index) => child !== node.children![index])
        ? Object.freeze({ ...node, children: Object.freeze(children) })
        : node;
    return ids.has(node.id) ? transform(next) : next;
}
function visibleBlocks(root: NativeNode): { blocks: NativeNode[]; rows: Map<string, NativeNode> } {
    const blocks: NativeNode[] = [];
    const rows = new Map<string, NativeNode>();
    const visit = (node: NativeNode, parents: readonly string[] = []): void => {
        if (isTextBlock(node)) {
            blocks.push(node);
            parents.forEach((id) => {
                if (!rows.has(id)) rows.set(id, node);
            });
            return;
        }
        if (node.kind === 'parallelRow') parents = [...parents, node.id];
        if (['image', 'variable', 'horizontalRule', 'pdfPage'].includes(node.kind)) return;
        node.children?.forEach((child) => {
            if (
                node.kind !== 'parallelRow' ||
                !node.attributes?.show ||
                node.attributes.show === 'all' ||
                child.attributes?.lang === node.attributes.show
            )
                visit(child, parents);
        });
    };
    visit(root);
    return { blocks, rows };
}
function finishBilingual(
    document: NativeDocument,
    root: NativeNode,
    scope: BilingualScope,
    rows: readonly string[],
): BilingualResult {
    const visible = visibleBlocks(root);
    let blocks = visible.blocks;
    if (!blocks.length) {
        const paragraph = fresh('paragraph', undefined, []);
        root = Object.freeze({ ...root, children: Object.freeze([...(root.children ?? []), paragraph]) });
        blocks = [paragraph];
    }
    const next =
        root === document.root ? document : Object.freeze({ ...document, root, revision: document.revision + 1 });
    const focus = scope.selection?.focus;
    const nearby = focus
        ? [...nodePath(document, focus.blockId)]
              .reverse()
              .map((node) => visible.rows.get(node.id))
              .find(Boolean)
        : undefined;
    const block = blocks.find((block) => block.id === focus?.blockId) ?? nearby ?? blocks[0];
    if (!block) throw new Error('The selected display has no editable text');
    return {
        document: next,
        rows,
        caret: {
            blockId: block.id,
            offset: focus?.blockId === block.id ? Math.max(0, Math.min(focus.offset, blockText(block).length)) : 0,
        },
    };
}
function configureRow(
    row: NativeNode,
    options: BilingualOptions,
    direction: 'rtl' | 'ltr',
    preserveDisplay: boolean,
): NativeNode {
    const existing = row.children ?? [];
    if (new Set(existing.map((cell) => String(cell.attributes?.lang).toLowerCase())).size !== existing.length)
        throw new Error('Duplicate retained column languages');
    const first = existing[0];
    const cells = options.languages.map((language) => {
        const cell = existing.find((cell) => String(cell.attributes?.lang).toLowerCase() === language.toLowerCase());
        if (cell)
            return cell.attributes?.lang === language
                ? cell
                : Object.freeze({ ...cell, attributes: Object.freeze({ ...cell.attributes, lang: language }) });
        return fresh(
            'parallelCell',
            { lang: language },
            (first?.children ?? [fresh('paragraph', undefined, [])]).map((child) =>
                blank(child, String(first?.attributes?.lang ?? options.languages[0]), language, direction),
            ),
        );
    });
    let show = preserveDisplay ? (row.attributes?.show ?? null) : options.show;
    if (typeof show === 'string' && show !== 'all') {
        const key = show.toLowerCase();
        show = options.languages.find((language) => language.toLowerCase() === key) ?? options.languages[0];
    }
    const attrs = {
        widths: options.languages.length === 2 ? options.widths : 'even',
        gap: options.gap,
        divider: options.divider,
        show,
        ...(options.fill ? { fill: options.fill } : {}),
    };
    if (
        cells.every((cell, index) => cell === existing[index]) &&
        cells.length === existing.length &&
        Object.entries(attrs).every(([key, value]) => row.attributes?.[key] === value)
    )
        return row;
    return Object.freeze({
        ...row,
        attributes: Object.freeze({ ...row.attributes, ...attrs }),
        children: Object.freeze(cells),
    });
}
function validateBilingualOptions(options: BilingualOptions): void {
    const languages = options.languages;
    if (
        languages.length < 1 ||
        languages.length > 3 ||
        languages.some((lang) => !lang.trim() || lang.length > 35) ||
        new Set(languages.map((lang) => lang.toLowerCase())).size !== languages.length
    )
        throw new Error('Choose one to three distinct column languages');
    if (
        !['even', 'narrow-start', 'narrow-end'].includes(options.widths) ||
        !['sm', 'lg'].includes(options.gap) ||
        typeof options.divider !== 'boolean'
    )
        throw new Error('Invalid bilingual layout');
    if (options.show !== null && options.show !== 'all' && !languages.includes(options.show))
        throw new Error('Choose a displayed language');
    if (options.source && options.source !== 'auto' && !languages.includes(options.source))
        throw new Error('Choose a source language');
}
export function configureBilingual(
    document: NativeDocument,
    options: BilingualOptions,
    scope: BilingualScope,
    allowDiscard = false,
): BilingualResult | undefined {
    validateBilingualOptions(options);
    const languages = options.languages;
    if (!allowDiscard && droppedLanguages(document, options, scope).length)
        throw new Error('Removing a written column requires confirmation');
    const ids = targets(document, scope);
    if (!ids.size) return;
    const direction = document.root.attributes?.dir === 'ltr' ? 'ltr' : 'rtl';
    const rowAttrs = {
        widths: languages.length === 2 ? options.widths : 'even',
        gap: options.gap,
        divider: options.divider,
        show: options.show,
        ...(options.fill ? { fill: options.fill } : {}),
    };
    const touched = new Set<string>();
    const make = (node: NativeNode): NativeNode => {
        if (node.kind === 'parallelRow') {
            touched.add(node.id);
            return configureRow(node, options, direction, false);
        }
        const nested = bilingualRows({ ...document, root: node });
        if (nested.length)
            return mapRows(node, new Set(nested.map((row) => row.id)), (row) => {
                touched.add(row.id);
                return configureRow(row, options, direction, false);
            });
        const source = options.source && options.source !== 'auto' ? options.source : detectLanguage(node, languages);
        const row = fresh(
            'parallelRow',
            { fill: 'manual', ...rowAttrs },
            languages.map((lang) =>
                fresh('parallelCell', { lang }, [lang === source ? node : blank(node, source, lang, direction)]),
            ),
        );
        touched.add(row.id);
        return row;
    };
    const visit = (node: NativeNode): NativeNode => {
        if (ids.has(node.id)) return make(node);
        if (!node.children) return node;
        const children = node.children.map(visit);
        return children.every((child, index) => child === node.children![index])
            ? node
            : Object.freeze({ ...node, children: Object.freeze(children) });
    };
    let root = visit(document.root);
    if (!textBlocks(root).length)
        root = Object.freeze({
            ...root,
            children: Object.freeze([...(root.children ?? []), fresh('paragraph', undefined, [])]),
        });
    return finishBilingual(document, root, scope, [...touched]);
}

export function setBilingualSettings(
    document: NativeDocument,
    options: BilingualOptions,
    scope: BilingualScope,
    allowDiscard = false,
    overrideDisplay = false,
): BilingualResult | undefined {
    validateBilingualOptions(options);
    const rows = bilingualRowsInScope(document, scope);
    if (!rows.length) return configureBilingual(document, options, scope, allowDiscard);
    if (!allowDiscard && droppedLanguages(document, options, scope).length)
        throw new Error('Removing a written column requires confirmation');
    const ids = new Set(rows.map((row) => row.id));
    const preserve = !overrideDisplay && rows.some((row) => !row.attributes?.show);
    const direction = document.root.attributes?.dir === 'ltr' ? 'ltr' : 'rtl';
    const root = mapRows(document.root, ids, (row) => configureRow(row, options, direction, preserve));
    return finishBilingual(document, root, scope, [...ids]);
}

export function endBilingual(
    document: NativeDocument,
    scope: BilingualScope,
    show: string,
    activeOnly = true,
): BilingualResult | undefined {
    const rows = bilingualRowsInScope(document, scope).filter((row) => !activeOnly || !row.attributes?.show);
    if (!rows.length) return;
    const ids = new Set(rows.map((row) => row.id));
    const root = mapRows(document.root, ids, (row) => {
        const visible =
            show === 'all'
                ? 'all'
                : row.children?.find((cell) => String(cell.attributes?.lang).toLowerCase() === show.toLowerCase())
                      ?.attributes?.lang;
        if (typeof visible !== 'string') throw new Error('The displayed language is unavailable in this scope');
        return Object.freeze({ ...row, attributes: Object.freeze({ ...row.attributes, show: visible }) });
    });
    return finishBilingual(document, root, scope, [...ids]);
}
