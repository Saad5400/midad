export function plainText(value: unknown): string {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
    const node = value as { type?: string; text?: unknown; content?: unknown[] };
    if (node.type === 'text') return typeof node.text === 'string' ? node.text : '';
    if (node.type === 'hardBreak') return '\n';
    const text = (Array.isArray(node.content) ? node.content : []).map(plainText).join('');
    return text + (['paragraph', 'heading', 'clauseTitle'].includes(node.type ?? '') ? '\n\n' : '');
}

export { plainText as clmPlainText };
