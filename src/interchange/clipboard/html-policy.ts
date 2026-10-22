import { normalizeLink } from '../../editing/formatting.js';

export function safeLink(value: unknown): string | undefined {
    if (typeof value !== 'string') return;
    try {
        return normalizeLink(value);
    } catch {
        return;
    }
}
